import { MediaStorageException } from '../storage/storage.error.js';
import type {
  FileStorage,
  MultipartUploadHandle,
  MultipartUploadPart,
  StorageBody,
  StorageHealth,
  StorageOperationOptions,
} from '../storage/storage.interfaces.js';
import type { StorageModuleOptions } from '../storage/storage.options.js';
import { STORAGE_OPTIONS } from '../storage/tokens/storage.token.js';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { OmnixysLogger } from '@omnixys/logger-ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_SIZE = 8 * 1024 * 1024;

@Injectable()
export class MinioStorageService implements FileStorage, OnModuleDestroy {
  private readonly client: S3Client;
  private activeOperations = 0;
  private closing = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private readonly drainWaiters = new Set<() => void>();
  private readonly operationScope = new AsyncLocalStorage<boolean>();
  private readonly log;

  constructor(
    @Inject(STORAGE_OPTIONS) private readonly options: StorageModuleOptions,
    @Optional() private readonly logger?: OmnixysLogger,
  ) {
    this.log = this.logger?.log(this.constructor.name);
    validateOptions(options);
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(params: {
    key: string;
    buffer: Uint8Array;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<string> {
    return this.operate('upload', params.key, params.signal, async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: params.key,
          Body: params.buffer,
          ContentType: params.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
        { abortSignal: params.signal },
      );
      return this.buildPublicUrl(params.key);
    });
  }

  async uploadStream(params: {
    key: string;
    body: StorageBody;
    contentType: string;
    contentLength?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    return this.operate('upload_stream', params.key, params.signal, async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: params.key,
          Body: params.body instanceof Readable ? params.body : Readable.from(params.body),
          ContentType: params.contentType,
          ContentLength: params.contentLength,
        }),
        { abortSignal: params.signal },
      );
      return this.buildPublicUrl(params.key);
    });
  }

  async uploadMultipart(params: {
    key: string;
    body: StorageBody;
    contentType: string;
    partSizeBytes?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    return this.operate('upload_multipart', params.key, params.signal, () =>
      this.performMultipartUpload(params),
    );
  }

  private async performMultipartUpload(params: {
    key: string;
    body: StorageBody;
    contentType: string;
    partSizeBytes?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const partSize = params.partSizeBytes ?? DEFAULT_MULTIPART_PART_SIZE;
    if (!Number.isSafeInteger(partSize) || partSize < MIN_MULTIPART_PART_SIZE) {
      this.log?.error('Multipart upload rejected, part size too small', {
        key: params.key,
        partSizeBytes: partSize,
        minimumBytes: MIN_MULTIPART_PART_SIZE,
      });
      throw new RangeError('Multipart partSizeBytes must be at least 5 MiB');
    }

    const handle = await this.createMultipartUpload(params);
    const parts: MultipartUploadPart[] = [];
    let pending = Buffer.alloc(0);
    let partNumber = 1;

    try {
      for await (const chunk of params.body) {
        params.signal?.throwIfAborted();
        pending = Buffer.concat([pending, Buffer.from(chunk)]);
        while (pending.length >= partSize) {
          const body = pending.subarray(0, partSize);
          pending = pending.subarray(partSize);
          parts.push(
            await this.uploadPart({
              ...handle,
              partNumber: partNumber++,
              body,
              signal: params.signal,
            }),
          );
        }
      }

      if (pending.length > 0 || parts.length === 0) {
        parts.push(
          await this.uploadPart({
            ...handle,
            partNumber,
            body: pending,
            signal: params.signal,
          }),
        );
      }
      return await this.completeMultipartUpload({
        ...handle,
        parts,
        signal: params.signal,
      });
    } catch (error) {
      try {
        await this.abortMultipartUpload(handle);
      } catch (abortError) {
        this.log?.error('Multipart cleanup failed', { key: params.key, error: abortError });
      }
      this.log?.error('Multipart upload failed', { key: params.key, error });
      throw error;
    }
  }

  async createMultipartUpload(params: {
    key: string;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<MultipartUploadHandle> {
    return this.operate('multipart_create', params.key, params.signal, async () => {
      const response = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.options.bucket,
          Key: params.key,
          ContentType: params.contentType,
        }),
        { abortSignal: params.signal },
      );
      if (!response.UploadId) {
        this.log?.error('Storage provider did not return a multipart upload ID', {
          key: params.key,
        });
        throw new MediaStorageException(
          'MEDIA_MULTIPART_ID_MISSING',
          'Storage provider did not return a multipart upload ID',
          { key: params.key },
        );
      }
      return { key: params.key, uploadId: response.UploadId };
    });
  }

  async uploadPart(
    params: MultipartUploadHandle & {
      partNumber: number;
      body: Uint8Array;
      signal?: AbortSignal;
    },
  ): Promise<MultipartUploadPart> {
    if (!Number.isSafeInteger(params.partNumber) || params.partNumber < 1) {
      this.log?.error('Multipart part rejected, invalid part number', {
        key: params.key,
        partNumber: params.partNumber,
      });
      throw new RangeError('Multipart partNumber must be a positive integer');
    }
    return this.operate('multipart_part', params.key, params.signal, async () => {
      const response = await this.client.send(
        new UploadPartCommand({
          Bucket: this.options.bucket,
          Key: params.key,
          UploadId: params.uploadId,
          PartNumber: params.partNumber,
          Body: params.body,
        }),
        { abortSignal: params.signal },
      );
      if (!response.ETag) {
        this.log?.error('Storage provider did not return a multipart ETag', {
          key: params.key,
          partNumber: params.partNumber,
        });
        throw new MediaStorageException(
          'MEDIA_MULTIPART_ETAG_MISSING',
          'Storage provider did not return a multipart ETag',
          { key: params.key, partNumber: params.partNumber },
        );
      }
      return { partNumber: params.partNumber, etag: response.ETag };
    });
  }

  async completeMultipartUpload(
    params: MultipartUploadHandle & {
      parts: readonly MultipartUploadPart[];
      signal?: AbortSignal;
    },
  ): Promise<string> {
    if (params.parts.length === 0) {
      this.log?.error('Multipart upload rejected, no parts provided', { key: params.key });
      throw new RangeError('Multipart upload requires at least one part');
    }
    return this.operate('multipart_complete', params.key, params.signal, async () => {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.options.bucket,
          Key: params.key,
          UploadId: params.uploadId,
          MultipartUpload: {
            Parts: [...params.parts]
              .sort((left, right) => left.partNumber - right.partNumber)
              .map((part) => ({
                ETag: part.etag,
                PartNumber: part.partNumber,
              })),
          },
        }),
        { abortSignal: params.signal },
      );
      return this.buildPublicUrl(params.key);
    });
  }

  async abortMultipartUpload(
    params: MultipartUploadHandle & StorageOperationOptions,
  ): Promise<void> {
    await this.operate('multipart_abort', params.key, params.signal, () =>
      this.client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: this.options.bucket,
            Key: params.key,
            UploadId: params.uploadId,
          }),
          { abortSignal: params.signal },
        )
        .then(() => undefined),
    );
  }

  async delete(params: { key: string; signal?: AbortSignal }): Promise<void> {
    await this.operate('delete', params.key, params.signal, () =>
      this.client
        .send(
          new DeleteObjectCommand({
            Bucket: this.options.bucket,
            Key: params.key,
          }),
          { abortSignal: params.signal },
        )
        .then(() => undefined),
    );
  }

  async getStream(params: { key: string; signal?: AbortSignal }): Promise<Readable> {
    const stream = await this.operate('get_stream', params.key, params.signal, async () => {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: params.key }),
        { abortSignal: params.signal },
      );
      return toReadable(response.Body);
    });
    return this.trackReadable(stream);
  }

  async get(params: { key: string; signal?: AbortSignal }): Promise<Buffer> {
    const stream = await this.getStream(params);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      params.signal?.throwIfAborted();
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getSignedUploadUrl(params: {
    key: string;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<{ uploadUrl: string; fileUrl: string }> {
    return this.operate('sign_upload', params.key, params.signal, async () => {
      params.signal?.throwIfAborted();
      const uploadUrl = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: params.key,
          ContentType: params.contentType,
        }),
        { expiresIn: this.options.linkTTL },
      );
      return { uploadUrl, fileUrl: this.buildPublicUrl(params.key) };
    });
  }

  async getSignedDownloadUrl(params: { key: string; signal?: AbortSignal }): Promise<string> {
    return this.operate('sign_download', params.key, params.signal, async () => {
      params.signal?.throwIfAborted();
      return getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.options.bucket, Key: params.key }),
        { expiresIn: this.options.linkTTL },
      );
    });
  }

  getPublicUrl(params: { key: string }): string {
    return this.buildPublicUrl(params.key);
  }

  async health(options: StorageOperationOptions = {}): Promise<StorageHealth> {
    if (this.closed) return { healthy: false, status: 'closed' };
    const startedAt = Date.now();
    try {
      await this.operate('health', this.options.bucket, options.signal, () =>
        this.client
          .send(new HeadBucketCommand({ Bucket: this.options.bucket }), {
            abortSignal: options.signal,
          })
          .then(() => undefined),
      );
      return {
        healthy: true,
        status: 'ready',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (isAbortError(error, options.signal)) throw error;
      this.log?.error('Storage health check failed', { error });
      return {
        healthy: false,
        status: 'unavailable',
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  status(): 'closed' | 'closing' | 'ready' {
    if (this.closed) return 'closed';
    return this.closing ? 'closing' : 'ready';
  }

  diagnostics() {
    return {
      status: this.status(),
      activeOperations: this.activeOperations,
      bucket: this.options.bucket,
      endpoint: this.options.endpoint,
    };
  }

  async drain(timeoutMs = 10_000): Promise<void> {
    if (this.activeOperations === 0) return;
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.drainWaiters.delete(waiter);
        const error = new MediaStorageException(
          'MEDIA_DRAIN_TIMEOUT',
          `Storage drain timed out after ${timeoutMs}ms`,
          { timeoutMs, activeOperations: this.activeOperations },
        );
        this.log?.error('Storage drain timed out', {
          timeoutMs,
          activeOperations: this.activeOperations,
          error,
        });
        reject(error);
      }, timeoutMs);
      this.drainWaiters.add(waiter);
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return Promise.resolve();
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  shutdown(): Promise<void> {
    return this.close();
  }

  onModuleDestroy(): Promise<void> {
    return this.close();
  }

  private async operate<T>(
    operation: string,
    key: string,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.closed || (this.closing && !this.operationScope.getStore())) {
      this.log?.error('Storage operation rejected, client not accepting operations', {
        operation,
        key,
        status: this.status(),
      });
      throw new MediaStorageException(
        'MEDIA_STORAGE_CLOSED',
        'Storage client is not accepting operations',
        { operation },
      );
    }
    signal?.throwIfAborted();
    this.activeOperations += 1;
    try {
      return await this.operationScope.run(true, task);
    } catch (error) {
      if (error instanceof MediaStorageException || isAbortError(error, signal)) {
        throw error;
      }
      this.log?.error('Storage operation failed', { operation, key, error });
      throw new MediaStorageException(
        `MEDIA_${operation.toUpperCase()}_FAILED`,
        'Storage operation failed',
        { operation, key },
        { cause: error },
      );
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        for (const waiter of this.drainWaiters) waiter();
        this.drainWaiters.clear();
      }
    }
  }

  private async closeInternal(): Promise<void> {
    this.closing = true;
    try {
      await this.drain();
    } finally {
      this.client.destroy();
      this.closed = true;
      this.closing = false;
    }
  }

  private buildPublicUrl(key: string): string {
    const base = (this.options.publicUrl ?? this.options.endpoint).replace(/\/$/, '');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${base}/${encodeURIComponent(this.options.bucket)}/${encodedKey}`;
  }

  private trackReadable(stream: Readable): Readable {
    this.activeOperations += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        for (const waiter of this.drainWaiters) waiter();
        this.drainWaiters.clear();
      }
    };
    stream.once('end', release);
    stream.once('error', release);
    stream.once('close', release);
    return stream;
  }
}

function validateOptions(options: StorageModuleOptions): void {
  if (!options.bucket || !options.endpoint || !options.region) {
    throw new TypeError('Storage region, endpoint, and bucket are required');
  }
  if (!Number.isSafeInteger(options.linkTTL) || options.linkTTL <= 0) {
    throw new RangeError('Storage linkTTL must be a positive integer');
  }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new MediaStorageException(
    'MEDIA_BODY_UNSUPPORTED',
    'Storage provider returned an unsupported response body',
  );
}

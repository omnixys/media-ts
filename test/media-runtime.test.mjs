import {
  FILE_STORAGE,
  MediaStorageException,
  MinioStorageService,
  StorageModule,
} from '../dist/index.js';
import { ContextAccessor } from '@omnixys/context-ts/accessor';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

const FIVE_MIB = 5 * 1024 * 1024;

test('public URLs derive from endpoint while legacy publicUrl remains compatible', () => {
  const endpointService = createService().service;
  assert.equal(
    endpointService.getPublicUrl({ key: 'users/avatar one.png' }),
    'https://storage.example.com/media/users/avatar%20one.png',
  );

  const legacyService = createService({
    publicUrl: 'https://cdn.example.com/',
  }).service;
  assert.equal(
    legacyService.getPublicUrl({ key: 'avatar.png' }),
    'https://cdn.example.com/media/avatar.png',
  );
});

test('upload and download streaming forward AbortSignal and avoid buffering APIs', async () => {
  const { service, client, calls } = createService();
  const controller = new AbortController();

  await service.uploadStream({
    key: 'stream.bin',
    body: Readable.from([Buffer.from('payload')]),
    contentType: 'application/octet-stream',
    contentLength: 7,
    signal: controller.signal,
  });
  assert.equal(calls[0].name, 'PutObjectCommand');
  assert.equal(calls[0].options.abortSignal, controller.signal);
  assert.equal(calls[0].input.ContentLength, 7);

  client.responses.GetObjectCommand = {
    Body: Readable.from(['hello', ' world']),
  };
  assert.equal(
    (await service.get({ key: 'stream.bin' })).toString(),
    'hello world',
  );
});

test('pre-aborted operations reject without contacting storage', async () => {
  const { service, calls } = createService();
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled', 'AbortError'));

  await assert.rejects(
    service.upload({
      key: 'cancelled.bin',
      buffer: new Uint8Array(),
      contentType: 'application/octet-stream',
      signal: controller.signal,
    }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls.length, 0);
});

test('multipart upload chunks streams, completes in order, and returns file URL', async () => {
  const { service, calls } = createService();
  const url = await service.uploadMultipart({
    key: 'large.bin',
    body: Readable.from([Buffer.alloc(FIVE_MIB), Buffer.from('tail')]),
    contentType: 'application/octet-stream',
    partSizeBytes: FIVE_MIB,
  });

  assert.equal(url, 'https://storage.example.com/media/large.bin');
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ],
  );
  assert.equal(calls[1].input.Body.byteLength, FIVE_MIB);
  assert.equal(calls[2].input.Body.toString(), 'tail');
  assert.deepEqual(calls[3].input.MultipartUpload.Parts, [
    { ETag: 'etag-1', PartNumber: 1 },
    { ETag: 'etag-2', PartNumber: 2 },
  ]);
});

test('failed multipart uploads are aborted before the error is returned', async () => {
  const { service, client, calls } = createService();
  client.failUploadPart = true;

  await assert.rejects(
    service.uploadMultipart({
      key: 'failed.bin',
      body: Readable.from([Buffer.alloc(FIVE_MIB)]),
      contentType: 'application/octet-stream',
      partSizeBytes: FIVE_MIB,
    }),
    MediaStorageException,
  );
  assert.equal(calls.at(-1).name, 'AbortMultipartUploadCommand');
});

test('storage failures contain canonical diagnostic identifiers', async () => {
  const { service, client } = createService();
  client.failDelete = true;

  await ContextAccessor.run(
    {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      traceId: 'trace-1',
      actorId: 'actor-1',
      tenantId: 'tenant-1',
    },
    async () => {
      await assert.rejects(service.delete({ key: 'file.bin' }), (error) => {
        assert.ok(error instanceof MediaStorageException);
        assert.equal(error.code, 'MEDIA_DELETE_FAILED');
        assert.equal(error.requestId, 'request-1');
        assert.equal(error.correlationId, 'correlation-1');
        assert.equal(error.traceId, 'trace-1');
        assert.equal(error.actorId, 'actor-1');
        assert.equal(error.tenantId, 'tenant-1');
        return true;
      });
    },
  );
});

test('health, diagnostics, drain, and close expose deterministic lifecycle', async () => {
  const { service, client } = createService();
  assert.equal((await service.health()).healthy, true);
  assert.equal(service.status(), 'ready');
  assert.equal(service.diagnostics().activeOperations, 0);

  client.responses.GetObjectCommand = { Body: new Readable({ read() {} }) };
  const stream = await service.getStream({ key: 'open.bin' });
  let drained = false;
  const draining = service.drain().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  stream.push(null);
  stream.resume();
  await draining;

  await service.close();
  await service.close();
  assert.equal(client.destroyCalls, 1);
  assert.equal(service.status(), 'closed');
  assert.equal((await service.health()).status, 'closed');
});

test('module supports sync/async registration and exports canonical token and class', () => {
  const sync = StorageModule.forRoot(options());
  const asyncModule = StorageModule.forRootAsync({ useFactory: options });

  assert.ok(sync.exports.includes(FILE_STORAGE));
  assert.ok(sync.exports.includes(MinioStorageService));
  assert.ok(asyncModule.providers.length >= 3);
});

function createService(overrides = {}) {
  const service = new MinioStorageService(options(overrides));
  const calls = [];
  const client = {
    responses: {},
    destroyCalls: 0,
    failDelete: false,
    failUploadPart: false,
    async send(command, sendOptions) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input, options: sendOptions });
      if (name === 'DeleteObjectCommand' && this.failDelete) {
        throw new Error('delete failed');
      }
      if (name === 'UploadPartCommand' && this.failUploadPart) {
        throw new Error('part failed');
      }
      if (name === 'CreateMultipartUploadCommand')
        return { UploadId: 'upload-1' };
      if (name === 'UploadPartCommand')
        return { ETag: `etag-${command.input.PartNumber}` };
      return this.responses[name] ?? {};
    },
    destroy() {
      this.destroyCalls += 1;
    },
  };
  service.client = client;
  return { service, client, calls };
}

function options(overrides = {}) {
  return {
    region: 'eu-central-1',
    endpoint: 'https://storage.example.com',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'media',
    linkTTL: 900,
    ...overrides,
  };
}

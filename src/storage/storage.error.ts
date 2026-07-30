import { InternalServerErrorException } from '@nestjs/common';
import { ContextAccessor } from '@omnixys/context-ts/accessor';

export class MediaStorageException extends InternalServerErrorException {
  readonly requestId!: string;
  readonly correlationId!: string;
  readonly traceId?: string;
  readonly actorId?: string;
  readonly tenantId?: string;

  constructor(
    readonly code: string,
    message: string,
    readonly metadata: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    const context = ContextAccessor.get();
    const details = {
      code,
      message,
      requestId: context?.requestId ?? 'unscoped',
      correlationId: context?.correlationId ?? context?.requestId ?? 'unscoped',
      traceId: context?.trace?.traceId,
      actorId: context?.principal?.actorId,
      tenantId: context?.tenant?.tenantId ?? context?.principal?.tenantId,
      metadata,
    };
    super(details, options);
    Object.assign(this, details);
  }
}

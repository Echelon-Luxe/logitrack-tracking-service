import { z } from 'zod';
import type { EventEnvelope, ShipmentEventPayload } from '../events/envelope.js';

// Unknown fields are ignored so a producer can add fields without breaking
// consumers that have not been redeployed.
const PayloadSchema = z.object({
  shipmentId: z.string().min(1),
  reference: z.string().min(1),
  status: z.string().min(1),
  driverId: z.string().nullable().default(null),
  origin: z.string().default(''),
  destination: z.string().default(''),
});

const EnvelopeSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO timestamp'),
  traceId: z.string().default(''),
  producer: z.string().default('unknown'),
  payload: PayloadSchema,
});

export class UnparseableEventError extends Error {
  constructor(readonly reason: string) {
    super(`Cannot parse event: ${reason}`);
    this.name = 'UnparseableEventError';
  }
}

// Throws UnparseableEventError; callers dead-letter rather than retry.
export function parseEvent(raw: string | Buffer | null): EventEnvelope<ShipmentEventPayload> {
  if (raw === null) throw new UnparseableEventError('null message body');

  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new UnparseableEventError('not valid JSON');
  }

  const result = EnvelopeSchema.safeParse(json);
  if (!result.success) {
    throw new UnparseableEventError(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  if (result.data.eventVersion > 1) {
    throw new UnparseableEventError(`unsupported eventVersion ${result.data.eventVersion}`);
  }

  return result.data as EventEnvelope<ShipmentEventPayload>;
}

export const isShipmentEvent = (eventType: string): boolean => eventType.startsWith('shipment.');

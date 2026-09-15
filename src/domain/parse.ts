import { z } from 'zod';
import type { EventEnvelope, ShipmentEventPayload } from '../events/envelope.js';

/**
 * Deliberately tolerant.
 *
 * Unknown fields are IGNORED rather than rejected (zod's default, made explicit
 * here). If the producer adds a field in a later version, this consumer keeps
 * working instead of dead-lettering every message until it is redeployed. That
 * property is what lets the six services deploy independently.
 *
 * Only fields this service actually uses are required.
 */
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

/** Throws UnparseableEventError; the caller dead-letters rather than retrying. */
export function parseEvent(raw: string | Buffer | null): EventEnvelope<ShipmentEventPayload> {
  if (raw === null) throw new UnparseableEventError('null message body');

  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    // Malformed JSON will never become valid on retry - dead-letter it.
    throw new UnparseableEventError('not valid JSON');
  }

  const result = EnvelopeSchema.safeParse(json);
  if (!result.success) {
    throw new UnparseableEventError(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  // A version we do not understand is not an error we can fix by retrying.
  if (result.data.eventVersion > 1) {
    throw new UnparseableEventError(`unsupported eventVersion ${result.data.eventVersion}`);
  }

  return result.data as EventEnvelope<ShipmentEventPayload>;
}

/** Only shipment.* events belong on this timeline. */
export const isShipmentEvent = (eventType: string): boolean => eventType.startsWith('shipment.');

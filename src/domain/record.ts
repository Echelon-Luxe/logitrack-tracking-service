import type { PrismaClient } from '@prisma/client';
import type { EventEnvelope, ShipmentEventPayload } from '../events/envelope.js';

export interface RecordResult {
  recorded: boolean;
  /** True when this eventId had already been processed. */
  duplicate: boolean;
}

/**
 * Append one event to the timeline, exactly once.
 *
 * Idempotency is enforced by the unique constraint on eventId and a
 * createMany({ skipDuplicates }) - NOT by "check then insert", which has a race:
 * two consumer instances can both see "not present" and both insert. Letting
 * the database arbitrate is the only version that is correct under concurrency.
 */
export async function recordEvent(
  db: PrismaClient,
  env: EventEnvelope<ShipmentEventPayload>,
): Promise<RecordResult> {
  const { payload } = env;
  const result = await db.trackingEvent.createMany({
    data: [{
      eventId: env.eventId,
      shipmentId: payload.shipmentId,
      reference: payload.reference,
      eventType: env.eventType,
      status: payload.status,
      driverId: payload.driverId,
      origin: payload.origin,
      destination: payload.destination,
      occurredAt: new Date(env.occurredAt),
    }],
    skipDuplicates: true,
  });
  return { recorded: result.count === 1, duplicate: result.count === 0 };
}

export async function getTimeline(db: PrismaClient, shipmentId: string) {
  return db.trackingEvent.findMany({
    where: { shipmentId },
    orderBy: { occurredAt: 'asc' },
  });
}

export async function getLatest(db: PrismaClient, shipmentId: string) {
  return db.trackingEvent.findFirst({
    where: { shipmentId },
    orderBy: { occurredAt: 'desc' },
  });
}

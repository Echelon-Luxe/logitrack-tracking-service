import type { PrismaClient } from '@prisma/client';
import type { EventEnvelope, ShipmentEventPayload } from '../events/envelope.js';

export interface RecordResult {
  recorded: boolean;
  duplicate: boolean;
}

// Dedup via the unique constraint on eventId, not read-then-insert: the latter
// races, letting two consumers both see "absent" and both insert.
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

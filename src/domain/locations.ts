import type { PrismaClient, TrackingEvent } from '@prisma/client';
import { isStaff, type Identity } from '../authz.js';

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Shipment not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// Statuses during which the parcel is physically moving with a driver.
export const MOVING = new Set(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']);

type Ownership = Pick<TrackingEvent, 'customerId' | 'driverUserId' | 'status'>;

// The newest event carries the current owner and driver: assignment changes
// driverUserId, and every later event repeats it.
export async function ownership(db: PrismaClient, shipmentId: string): Promise<Ownership | null> {
  return db.trackingEvent.findFirst({
    where: { shipmentId },
    orderBy: { occurredAt: 'desc' },
    select: { customerId: true, driverUserId: true, status: true },
  });
}

export function canView(id: Identity, o: Ownership | null): boolean {
  if (isStaff(id)) return true;
  if (!o) return false;
  if (id.role === 'CUSTOMER') return o.customerId === id.userId;
  if (id.role === 'DRIVER') return o.driverUserId === id.userId;
  return false;
}

/**
 * Only the assigned driver may report a position, and only while the parcel
 * is moving. Anyone else posting would let them draw a fake route on a
 * customer's map.
 */
export function assertCanReport(id: Identity, o: Ownership | null): asserts o is Ownership {
  if (id.role !== 'DRIVER') throw new ForbiddenError('Only the assigned driver can report a location');
  if (!o || o.driverUserId !== id.userId) throw new NotFoundError();
  if (!MOVING.has(o.status)) {
    throw new ConflictError(`Location is only recorded while the shipment is moving (it is ${o.status})`);
  }
}

export async function recordPing(
  db: PrismaClient,
  input: { shipmentId: string; driverUserId: string; lat: number; lng: number; heading?: number; speedKph?: number; accuracyM?: number },
) {
  return db.locationPing.create({
    data: {
      shipmentId: input.shipmentId,
      driverUserId: input.driverUserId,
      lat: input.lat,
      lng: input.lng,
      heading: input.heading ?? null,
      speedKph: input.speedKph ?? null,
      accuracyM: input.accuracyM ?? null,
    },
  });
}

export async function trail(db: PrismaClient, shipmentId: string, limit = 500) {
  // Newest N, returned oldest-first so the client can draw the line in order.
  const rows = await db.locationPing.findMany({
    where: { shipmentId },
    orderBy: { recordedAt: 'desc' },
    take: Math.min(limit, 2000),
    select: { lat: true, lng: true, heading: true, speedKph: true, recordedAt: true },
  });
  return rows.reverse();
}

export async function latestPing(db: PrismaClient, shipmentId: string) {
  return db.locationPing.findFirst({
    where: { shipmentId },
    orderBy: { recordedAt: 'desc' },
    select: { lat: true, lng: true, heading: true, speedKph: true, recordedAt: true },
  });
}

/** Latest position of every shipment that reported within `withinMinutes`. */
export async function livePositions(db: PrismaClient, opts: { driverUserId?: string; withinMinutes?: number }) {
  const since = new Date(Date.now() - (opts.withinMinutes ?? 60) * 60_000);
  return db.locationPing.findMany({
    where: { recordedAt: { gte: since }, ...(opts.driverUserId ? { driverUserId: opts.driverUserId } : {}) },
    distinct: ['shipmentId'],
    orderBy: [{ shipmentId: 'asc' }, { recordedAt: 'desc' }],
    select: { shipmentId: true, driverUserId: true, lat: true, lng: true, heading: true, speedKph: true, recordedAt: true },
    take: 500,
  });
}

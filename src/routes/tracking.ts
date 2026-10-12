import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { getTimeline, getLatest } from '../domain/record.js';
import {
  ownership, canView, assertCanReport, recordPing, trail, latestPing, livePositions, NotFoundError,
} from '../domain/locations.js';
import { publish, subscribe, type LiveEvent } from '../domain/live.js';
import { identity, isStaff, requireRole } from '../authz.js';

const ShipmentParam = z.object({ shipmentId: z.string().uuid() });

const PingBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speedKph: z.number().min(0).max(300).optional(),
  accuracyM: z.number().min(0).max(10_000).optional(),
});

const HEARTBEAT_MS = 15_000;

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  // Staff fleet view, or a driver's own jobs. Registered before /:shipmentId
  // so "live" is never parsed as an id.
  app.get('/tracking/live', async (req) => {
    const id = identity(req);
    if (!isStaff(id) && id.role !== 'DRIVER') return [];
    return livePositions(prisma, id.role === 'DRIVER' ? { driverUserId: id.userId } : {});
  });

  app.get('/tracking/dead-letters', async (req) => {
    requireRole(identity(req), ['ADMIN']);
    return prisma.deadLetter.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  });

  app.get('/tracking/:shipmentId', async (req, reply) => {
    const id = identity(req);
    const { shipmentId } = ShipmentParam.parse(req.params);
    const owner = await ownership(prisma, shipmentId);
    // Empty is not 404: consumer lag would otherwise look like a missing
    // shipment. With no events there is also nothing to leak.
    if (!owner) return reply.code(200).send({ shipmentId, events: [], note: 'no events recorded yet' });
    if (!canView(id, owner)) throw new NotFoundError();
    const events = await getTimeline(prisma, shipmentId);
    return { shipmentId, reference: events[0]!.reference, events };
  });

  app.get('/tracking/:shipmentId/latest', async (req, reply) => {
    const id = identity(req);
    const { shipmentId } = ShipmentParam.parse(req.params);
    if (!canView(id, await ownership(prisma, shipmentId))) throw new NotFoundError();
    const latest = await getLatest(prisma, shipmentId);
    if (!latest) return reply.code(404).send({ error: 'NotFound', message: 'no events for shipment' });
    return latest;
  });

  app.get('/tracking/:shipmentId/locations', async (req) => {
    const id = identity(req);
    const { shipmentId } = ShipmentParam.parse(req.params);
    const { limit } = z.object({ limit: z.coerce.number().int().positive().max(2000).default(500) }).parse(req.query);
    if (!canView(id, await ownership(prisma, shipmentId))) throw new NotFoundError();
    return trail(prisma, shipmentId, limit);
  });

  app.post('/tracking/:shipmentId/location', async (req, reply) => {
    const id = identity(req);
    const { shipmentId } = ShipmentParam.parse(req.params);
    const body = PingBody.parse(req.body);
    const owner = await ownership(prisma, shipmentId);
    assertCanReport(id, owner);
    const ping = await recordPing(prisma, {
      shipmentId,
      driverUserId: id.userId,
      lat: body.lat,
      lng: body.lng,
      ...(body.heading !== undefined ? { heading: body.heading } : {}),
      ...(body.speedKph !== undefined ? { speedKph: body.speedKph } : {}),
      ...(body.accuracyM !== undefined ? { accuracyM: body.accuracyM } : {}),
    });
    publish(shipmentId, {
      type: 'location',
      data: { lat: ping.lat, lng: ping.lng, heading: ping.heading, speedKph: ping.speedKph, recordedAt: ping.recordedAt.toISOString() },
    });
    return reply.code(201).send({ id: ping.id, recordedAt: ping.recordedAt });
  });

  /**
   * Server-Sent Events: one-way, plain HTTP, so it passes through the
   * gateway's proxy unchanged (WebSockets would need upgrade support there).
   * Sends a snapshot first, then location and status events as they happen.
   */
  app.get('/tracking/:shipmentId/stream', async (req, reply) => {
    const id = identity(req);
    const { shipmentId } = ShipmentParam.parse(req.params);
    const owner = await ownership(prisma, shipmentId);
    if (!canView(id, owner)) throw new NotFoundError();

    const last = await latestPing(prisma, shipmentId);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells nginx-style proxies not to buffer the stream into one response.
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('snapshot', {
      status: owner?.status ?? null,
      location: last ? { ...last, recordedAt: last.recordedAt.toISOString() } : null,
    });

    const off = subscribe(shipmentId, (e: LiveEvent) => send(e.type, e.data));
    // Comments keep idle connections from being reaped by proxies and let the
    // client notice a dead stream.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    heartbeat.unref();

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      off();
    });
  });
}

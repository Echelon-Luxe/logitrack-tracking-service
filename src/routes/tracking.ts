import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { getTimeline, getLatest } from '../domain/record.js';

const ShipmentParam = z.object({ shipmentId: z.string().uuid() });

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tracking/:shipmentId', async (req, reply) => {
    const { shipmentId } = ShipmentParam.parse(req.params);
    const events = await getTimeline(prisma, shipmentId);
    // An empty timeline is not an error: the shipment may exist but its event
    // may not have been consumed yet. 404 would make normal lag look like a bug.
    if (events.length === 0) {
      return reply.code(200).send({ shipmentId, events: [], note: 'no events recorded yet' });
    }
    return { shipmentId, reference: events[0]!.reference, events };
  });

  app.get('/tracking/:shipmentId/latest', async (req, reply) => {
    const { shipmentId } = ShipmentParam.parse(req.params);
    const latest = await getLatest(prisma, shipmentId);
    if (!latest) return reply.code(404).send({ error: 'NotFound', message: 'no events for shipment' });
    return latest;
  });

  // Operational visibility: what failed to parse, and why.
  app.get('/tracking/dead-letters', async () => {
    return prisma.deadLetter.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  });
}

import Fastify, { type FastifyInstance } from 'fastify';
import { registry, httpRequests } from './metrics.js';
import { trackingRoutes } from './routes/tracking.js';
import { registerErrorHandler } from './errors.js';
import { pingDb } from './db/client.js';

export const SERVICE_NAME = 'logitrack-tracking-service';

let ready = false;
export const setReady = (v: boolean): void => { ready = v; };

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  app.addHook('onResponse', (req, reply, done) => {
    httpRequests.inc({
      method: req.method,
      route: req.routeOptions.url ?? 'unknown',
      status: String(reply.statusCode),
    });
    done();
  });

  // Liveness: never checks dependencies. Failing it KILLS the container, so a
  // database or broker blip would restart every pod at once.
  app.get('/healthz', () => ({ status: 'ok', service: SERVICE_NAME }));

  app.get('/readyz', async (_req, reply) => {
    if (!ready) return reply.code(503).send({ status: 'not-ready', service: SERVICE_NAME });

    // Readiness checks the database because the read API cannot serve a
    // timeline without it. Kafka is deliberately NOT checked: this service
    // serves reads perfectly well while the broker is down - it just falls
    // behind. Refusing traffic would turn degraded into unavailable.
    const db = await pingDb();
    if (!db) return reply.code(503).send({ status: 'not-ready', service: SERVICE_NAME, db: false });
    return { status: 'ready', service: SERVICE_NAME, db: true };
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  registerErrorHandler(app);
  void app.register(trackingRoutes);

  return app;
}

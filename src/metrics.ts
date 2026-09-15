import { Registry, collectDefaultMetrics, Counter, Gauge } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'logitrack-tracking-service' });
collectDefaultMetrics({ register: registry });

export const eventsProcessed = new Counter({
  name: 'tracking_events_processed_total',
  help: 'Events appended to the timeline',
  labelNames: ['event_type'] as const,
  registers: [registry],
});

export const eventsDuplicate = new Counter({
  name: 'tracking_events_duplicate_total',
  help: 'Events skipped because the eventId was already recorded',
  labelNames: ['event_type'] as const,
  registers: [registry],
});

export const eventsDeadLettered = new Counter({
  name: 'tracking_events_dead_lettered_total',
  help: 'Events parked in the dead-letter table',
  labelNames: ['reason'] as const,
  registers: [registry],
});

/**
 * Seconds between an event being produced and this service handling it.
 *
 * The single most important metric for a consumer. Pods can be Ready, CPU flat
 * and error rate zero while the service falls further and further behind -
 * every other signal looks healthy.
 */
export const consumerLag = new Gauge({
  name: 'tracking_consumer_lag_seconds',
  help: 'Seconds between event occurrence and processing',
  labelNames: ['topic'] as const,
  registers: [registry],
});

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

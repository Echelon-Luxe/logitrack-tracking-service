import { describe, it, expect, vi } from 'vitest';
import { recordEvent } from '../src/domain/record.js';
import type { EventEnvelope, ShipmentEventPayload } from '../src/events/envelope.js';

const env = (over: Partial<ShipmentEventPayload> = {}, top: Record<string, unknown> = {}) => ({
  eventId: 'evt-1',
  eventType: 'shipment.delivered',
  eventVersion: 1,
  occurredAt: '2026-09-15T10:00:00.000Z',
  traceId: 't',
  producer: 'p',
  payload: {
    shipmentId: 'ship-1',
    reference: 'LT-ABC123',
    status: 'DELIVERED',
    customerId: 'cust-1',
    driverId: 'driver-1',
    origin: 'London',
    destination: 'Manchester',
    ...over,
  },
  ...top,
}) as EventEnvelope<ShipmentEventPayload>;

// Each test builds its own mock. A module-scope vi.fn() reset in beforeEach
// leaks state between tests, and vitest reports errors thrown by such a mock
// as unhandled failures even when the test catches them.
const withDb = (impl: () => unknown) => {
  const createMany = vi.fn(impl);
  return { db: { trackingEvent: { createMany } } as never, createMany };
};

describe('recordEvent idempotency', () => {
  it('reports a first-time event as recorded', async () => {
    const { db } = withDb(() => ({ count: 1 }));
    expect(await recordEvent(db, env())).toEqual({ recorded: true, duplicate: false });
  });

  // Kafka is at-least-once: redelivery during a rebalance is normal, not an error.
  it('reports a redelivered event as a duplicate, not an error', async () => {
    const { db } = withDb(() => ({ count: 0 }));
    expect(await recordEvent(db, env())).toEqual({ recorded: false, duplicate: true });
  });

  /**
   * Deduplication must come from the database's unique constraint via
   * skipDuplicates, not from "read then insert". The read-first version races:
   * two consumer instances can both see "absent" and both insert, producing a
   * duplicated timeline entry no happy-path test would catch.
   */
  it('delegates deduplication to the database', async () => {
    const { db, createMany } = withDb(() => ({ count: 1 }));
    await recordEvent(db, env());
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('uses eventId as the deduplication key', async () => {
    const { db, createMany } = withDb(() => ({ count: 1 }));
    await recordEvent(db, env({}, { eventId: 'evt-unique' }));
    const arg = createMany.mock.calls[0]![0] as { data: Array<{ eventId: string }> };
    expect(arg.data[0]!.eventId).toBe('evt-unique');
  });

  it('converts occurredAt to a Date so ordering is chronological, not lexical', async () => {
    const { db, createMany } = withDb(() => ({ count: 1 }));
    await recordEvent(db, env());
    const arg = createMany.mock.calls[0]![0] as { data: Array<{ occurredAt: Date }> };
    expect(arg.data[0]!.occurredAt).toBeInstanceOf(Date);
    expect(arg.data[0]!.occurredAt.toISOString()).toBe('2026-09-15T10:00:00.000Z');
  });

  it('preserves a null driverId rather than coercing it', async () => {
    const { db, createMany } = withDb(() => ({ count: 1 }));
    await recordEvent(db, env({ driverId: null }));
    const arg = createMany.mock.calls[0]![0] as { data: Array<{ driverId: string | null }> };
    expect(arg.data[0]!.driverId).toBeNull();
  });

  it('propagates database errors so kafkajs retries without committing', async () => {
    // A DB outage is transient. Swallowing it would silently drop events:
    // kafkajs commits the offset when eachMessage resolves, so returning
    // normally on failure marks an event consumed that never was.
    const { db } = withDb(() => { throw new Error('connection terminated'); });
    let thrown: unknown;
    try {
      await recordEvent(db, env());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('connection terminated');
  });
});

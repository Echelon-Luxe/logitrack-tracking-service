import { describe, it, expect } from 'vitest';
import { parseEvent, isShipmentEvent, UnparseableEventError } from '../src/domain/parse.js';

const valid = {
  eventId: '11111111-1111-1111-1111-111111111111',
  eventType: 'shipment.delivered',
  eventVersion: 1,
  occurredAt: '2026-09-15T10:00:00.000Z',
  traceId: 'trace-1',
  producer: 'logitrack-shipment-service',
  payload: {
    shipmentId: '22222222-2222-2222-2222-222222222222',
    reference: 'LT-ABC123',
    status: 'DELIVERED',
    customerId: 'cust-1',
    driverId: 'driver-1',
    origin: 'London',
    destination: 'Manchester',
  },
};
const json = (o: unknown) => JSON.stringify(o);

describe('parseEvent', () => {
  it('parses a well-formed envelope', () => {
    const e = parseEvent(json(valid));
    expect(e.eventId).toBe(valid.eventId);
    expect(e.payload.shipmentId).toBe(valid.payload.shipmentId);
  });

  // The forward-compatibility guarantee: a producer can add fields without
  // breaking consumers that have not been redeployed.
  it('ignores unknown fields the producer added later', () => {
    const e = parseEvent(json({
      ...valid,
      brandNewTopLevelField: 'whatever',
      payload: { ...valid.payload, newNestedField: { a: 1 } },
    }));
    expect(e.payload.shipmentId).toBe(valid.payload.shipmentId);
  });

  it('accepts a null driverId', () => {
    const e = parseEvent(json({ ...valid, payload: { ...valid.payload, driverId: null } }));
    expect(e.payload.driverId).toBeNull();
  });

  it('defaults optional strings rather than failing', () => {
    const { origin: _o, destination: _d, ...rest } = valid.payload;
    const e = parseEvent(json({ ...valid, payload: rest }));
    expect(e.payload.origin).toBe('');
  });

  describe('rejects (and must be dead-lettered, never retried)', () => {
    it('a null body', () => {
      expect(() => parseEvent(null)).toThrow(UnparseableEventError);
    });
    it('malformed JSON', () => {
      expect(() => parseEvent('{not json')).toThrow(UnparseableEventError);
    });
    it('a missing shipmentId', () => {
      const { shipmentId: _s, ...rest } = valid.payload;
      expect(() => parseEvent(json({ ...valid, payload: rest }))).toThrow(UnparseableEventError);
    });
    it('an invalid timestamp', () => {
      expect(() => parseEvent(json({ ...valid, occurredAt: 'not-a-date' }))).toThrow(UnparseableEventError);
    });
    it('a future eventVersion this code cannot interpret', () => {
      expect(() => parseEvent(json({ ...valid, eventVersion: 2 }))).toThrow(/unsupported eventVersion 2/);
    });
  });

  it('reports every validation problem, not just the first', () => {
    try {
      parseEvent(json({ ...valid, eventId: '', payload: { ...valid.payload, reference: '' } }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as UnparseableEventError).reason).toContain('eventId');
      expect((e as UnparseableEventError).reason).toContain('reference');
    }
  });
});

describe('isShipmentEvent', () => {
  it('accepts shipment events', () => {
    expect(isShipmentEvent('shipment.created')).toBe(true);
    expect(isShipmentEvent('shipment.out_for_delivery')).toBe(true);
  });
  it('rejects anything else sharing the topic', () => {
    expect(isShipmentEvent('driver.updated')).toBe(false);
    expect(isShipmentEvent('')).toBe(false);
  });
});

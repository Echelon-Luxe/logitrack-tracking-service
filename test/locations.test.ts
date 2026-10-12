import { describe, it, expect } from 'vitest';
import { canView, assertCanReport, ForbiddenError, NotFoundError, ConflictError } from '../src/domain/locations.js';
import { publish, subscribe, listenerCount } from '../src/domain/live.js';
import type { Identity, Role } from '../src/authz.js';

const who = (role: Role, userId = `${role.toLowerCase()}-1`): Identity => ({ userId, role, email: '', name: '' });
const owner = (over: Record<string, unknown> = {}) => ({ customerId: 'customer-1', driverUserId: 'driver-1', status: 'IN_TRANSIT', ...over }) as never;

describe('who can see live tracking', () => {
  it('shows staff everything and owners their own', () => {
    expect(canView(who('SUPPORT'), owner())).toBe(true);
    expect(canView(who('CUSTOMER'), owner())).toBe(true);
    expect(canView(who('CUSTOMER', 'customer-2'), owner())).toBe(false);
    expect(canView(who('DRIVER', 'driver-2'), owner())).toBe(false);
  });
  // No events yet means no known owner; only staff may look.
  it('hides untracked shipments from non-staff', () => {
    expect(canView(who('CUSTOMER'), null)).toBe(false);
    expect(canView(who('ADMIN'), null)).toBe(true);
  });
});

// Anyone else posting could draw a fake route on a customer's map.
describe('who can report a location', () => {
  it('accepts the assigned driver while the parcel moves', () => {
    expect(() => assertCanReport(who('DRIVER'), owner())).not.toThrow();
  });
  it('rejects non-drivers, even admins', () => {
    expect(() => assertCanReport(who('ADMIN'), owner())).toThrow(ForbiddenError);
  });
  it('rejects a driver who is not assigned', () => {
    expect(() => assertCanReport(who('DRIVER', 'driver-2'), owner())).toThrow(NotFoundError);
  });
  it('rejects pings before pickup and after delivery', () => {
    expect(() => assertCanReport(who('DRIVER'), owner({ status: 'CREATED' }))).toThrow(ConflictError);
    expect(() => assertCanReport(who('DRIVER'), owner({ status: 'DELIVERED' }))).toThrow(ConflictError);
  });
});

describe('live fan-out', () => {
  it('delivers events to subscribers of that shipment only, and unsubscribes', () => {
    const got: string[] = [];
    const off = subscribe('ship-a', (e) => got.push(e.type));
    subscribe('ship-b', () => got.push('wrong'))();
    publish('ship-a', { type: 'status', data: { status: 'IN_TRANSIT', eventType: 'shipment.in_transit', occurredAt: '' } });
    publish('ship-b', { type: 'status', data: { status: 'IN_TRANSIT', eventType: 'shipment.in_transit', occurredAt: '' } });
    expect(got).toEqual(['status']);
    off();
    expect(listenerCount('ship-a')).toBe(0);
  });
});

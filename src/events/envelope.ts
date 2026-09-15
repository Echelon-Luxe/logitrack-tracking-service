/**
 * Wire contract, duplicated from the producer rather than shared via a package.
 *
 * A shared library would couple the deploy cycles of all six services. This
 * consumer must keep working when the producer adds a field it does not know
 * about, which is what eventVersion and tolerant parsing are for.
 */
export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  traceId: string;
  producer: string;
  payload: T;
}

export interface ShipmentEventPayload {
  shipmentId: string;
  reference: string;
  status: string;
  customerId: string;
  driverId: string | null;
  origin: string;
  destination: string;
}

export const SHIPMENT_EVENTS_TOPIC = 'logitrack.shipment.events';
export const SHIPMENT_EVENTS_DLQ = 'logitrack.shipment.events.dlq';
export const CONSUMER_GROUP = 'tracking-service';

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

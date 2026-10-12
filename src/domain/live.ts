import { EventEmitter } from 'node:events';

// Fan-out for live map updates: the HTTP handler and the Kafka consumer
// publish, open SSE streams subscribe.
//
// In-process only. With more than one replica a ping lands on one pod while
// the viewer's stream may be held by another, so production needs Redis
// pub/sub (or Kafka) behind this same interface. One replica locally is fine.

export type LiveEvent =
  | { type: 'location'; data: { lat: number; lng: number; heading: number | null; speedKph: number | null; recordedAt: string } }
  | { type: 'status'; data: { status: string; eventType: string; occurredAt: string } };

const bus = new EventEmitter();
// One listener per open stream; the default cap of 10 would warn at the 11th viewer.
bus.setMaxListeners(0);

export function publish(shipmentId: string, event: LiveEvent): void {
  bus.emit(shipmentId, event);
  bus.emit('*', { shipmentId, ...event });
}

export function subscribe(shipmentId: string, fn: (e: LiveEvent) => void): () => void {
  bus.on(shipmentId, fn);
  return () => bus.off(shipmentId, fn);
}

export const listenerCount = (shipmentId: string): number => bus.listenerCount(shipmentId);

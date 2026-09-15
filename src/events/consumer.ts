import { Kafka, type Consumer, logLevel, type Producer } from 'kafkajs';
import { prisma } from '../db/client.js';
import { parseEvent, isShipmentEvent, UnparseableEventError } from '../domain/parse.js';
import { recordEvent } from '../domain/record.js';
import { SHIPMENT_EVENTS_TOPIC, SHIPMENT_EVENTS_DLQ, CONSUMER_GROUP } from './envelope.js';
import { eventsProcessed, eventsDuplicate, eventsDeadLettered, consumerLag } from '../metrics.js';

const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'logitrack-tracking-service',
  brokers,
  logLevel: logLevel.ERROR,
  retry: { initialRetryTime: 300, retries: 8 },
});

let consumer: Consumer | null = null;
let dlqProducer: Producer | null = null;
let running = false;

export const isConsumerRunning = (): boolean => running;

export async function startConsumer(): Promise<void> {
  // groupId is what makes this service's offsets independent. notification-service
  // reads the same topic under its own group, so a slow consumer here never
  // blocks notifications - and vice versa.
  consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
  dlqProducer = kafka.producer();

  await Promise.all([consumer.connect(), dlqProducer.connect()]);
  // fromBeginning matters for a projection: a fresh deployment must replay the
  // whole log to rebuild the timeline, not start from "now" with a blank table.
  await consumer.subscribe({ topic: SHIPMENT_EVENTS_TOPIC, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value;

      let env;
      try {
        env = parseEvent(raw);
      } catch (err) {
        // Unparseable will never become parseable on retry. Retrying forever
        // would block this partition and stall every shipment on it.
        await deadLetter(topic, partition, message.offset, raw, err);
        return;
      }

      if (!isShipmentEvent(env.eventType)) return;

      try {
        const { duplicate } = await recordEvent(prisma, env);
        if (duplicate) eventsDuplicate.inc({ event_type: env.eventType });
        else eventsProcessed.inc({ event_type: env.eventType });

        // How far behind the producer we are. This is the SLI to alert on -
        // a healthy pod with a growing lag is invisible to every other check.
        const lagMs = Date.now() - new Date(env.occurredAt).getTime();
        consumerLag.set({ topic }, Math.max(0, lagMs) / 1000);
      } catch (err) {
        // A DATABASE failure IS transient, so rethrow and let kafkajs retry
        // without committing the offset. Dead-lettering here would silently
        // drop real events during a brief Postgres blip.
        throw err;
      }
    },
  });
  running = true;
}

async function deadLetter(
  topic: string,
  partition: number,
  offset: string,
  raw: Buffer | null,
  err: unknown,
): Promise<void> {
  const reason = err instanceof UnparseableEventError ? err.reason : String(err);
  const payload = raw ? raw.toString('utf8').slice(0, 10_000) : '';

  await prisma.deadLetter.create({
    data: { topic, partition, offset, payload, error: reason },
  });
  await dlqProducer?.send({
    topic: SHIPMENT_EVENTS_DLQ,
    messages: [{ value: payload, headers: { error: reason } }],
  });
  eventsDeadLettered.inc({ reason: err instanceof UnparseableEventError ? 'unparseable' : 'unknown' });
}

export async function stopConsumer(): Promise<void> {
  running = false;
  await consumer?.disconnect();
  await dlqProducer?.disconnect();
  consumer = null;
  dlqProducer = null;
}

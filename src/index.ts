import { buildApp, setReady, SERVICE_NAME } from './app.js';
import { startConsumer, stopConsumer } from './events/consumer.js';
import { pingDb } from './db/client.js';

const PORT = Number(process.env['PORT'] ?? 3004);
const app = buildApp();

async function main(): Promise<void> {
  await app.listen({ port: PORT, host: '0.0.0.0' });

  if (!(await pingDb())) {
    app.log.error('database unreachable at startup; staying un-ready');
  }

  try {
    await startConsumer();
    app.log.info('kafka consumer running');
  } catch (err) {
    app.log.error({ err }, 'kafka unavailable; timeline will not advance');
  }

  setReady(true);
  app.log.info({ service: SERVICE_NAME, port: PORT }, 'service started');
}

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    setReady(false);
    void (async () => {
      // Disconnect first so Kafka rebalances now, not after the session timeout.
      await stopConsumer();
      await app.close();
      process.exit(0);
    })();
  });
}

main().catch((err: unknown) => {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
});

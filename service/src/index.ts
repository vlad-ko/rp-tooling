import { Kafka, logLevel } from 'kafkajs';
import { loadConfig } from './config.js';
import { startConsumer, wireCrashExit } from './consumer.js';
import { createDb } from './db.js';
import { createDiffFetcher } from './enrich.js';
import { createOllamaClient } from './ollama.js';
import { createClassifiedPublisher } from './producer.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ollama = createOllamaClient({
    url: cfg.ollamaUrl,
    model: cfg.ollamaModel,
    requestTimeoutMs: cfg.ollamaRequestTimeoutMs,
  });
  const db = createDb(cfg.databaseUrl);

  console.log('[service] waiting for ollama and postgres to become ready');
  await Promise.all([
    ollama.waitUntilReady(cfg.ollamaStartupTimeoutMs),
    db.waitUntilReady(cfg.ollamaStartupTimeoutMs),
  ]);

  const kafka = new Kafka({ clientId: 'triage-service', brokers: cfg.brokers, logLevel: logLevel.WARN });
  const producer = kafka.producer();
  const consumer = kafka.consumer({ groupId: cfg.groupId });
  wireCrashExit(consumer);
  await producer.connect();
  await consumer.connect();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[service] ${signal} received; shutting down`);
    try {
      await consumer.disconnect();
      await producer.disconnect();
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await startConsumer({
    consumer,
    cfg,
    chat: ollama.chat,
    fetchDiff: createDiffFetcher({ timeoutMs: cfg.compareTimeoutMs, maxChars: cfg.diffMaxChars }),
    upsertEdit: db.upsertEdit,
    publishClassified: createClassifiedPublisher(producer, cfg.topicClassified),
    isOllamaReady: ollama.isReady,
    isDbReady: db.isReady,
  });
  console.log(`[service] consuming ${cfg.topicFiltered} as group ${cfg.groupId}`);
}

process.on('unhandledRejection', (reason) => {
  console.error('[service] unhandled promise rejection; exiting for container restart', reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('[service] fatal startup error', err);
  process.exit(1);
});

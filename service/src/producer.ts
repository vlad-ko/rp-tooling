import type { Producer } from 'kafkajs';
import { withRetry } from './retry.js';
import type { ClassifiedMessage } from './types.js';

export type PublishClassifiedFn = (msg: ClassifiedMessage) => Promise<void>;

export function createClassifiedPublisher(producer: Producer, topic: string): PublishClassifiedFn {
  return async function publishClassified(msg: ClassifiedMessage): Promise<void> {
    try {
      await withRetry(
        () =>
          producer.send({
            topic,
            messages: [{ key: String(msg.rc_id), value: JSON.stringify(msg) }],
          }),
        { attempts: 3, baseMs: 500, capMs: 5000 },
      );
    } catch (err) {
      // Best-effort audit trail: Postgres is the read model, so a publish
      // failure must never fail the message.
      console.warn(
        `[producer] failed to publish classified rc_id=${msg.rc_id} to ${topic}; continuing: ${String(err)}`,
      );
    }
  };
}

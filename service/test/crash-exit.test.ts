import type { Consumer, ConsumerCrashEvent } from 'kafkajs';
import { describe, expect, it } from 'vitest';
import { wireCrashExit } from '../src/consumer.js';

function makeStubConsumer(): {
  consumer: Consumer;
  listeners: Map<string, (event: ConsumerCrashEvent) => void>;
} {
  const listeners = new Map<string, (event: ConsumerCrashEvent) => void>();
  const consumer = {
    events: { CRASH: 'consumer.crash' },
    on: (eventName: string, listener: (event: ConsumerCrashEvent) => void) => {
      listeners.set(eventName, listener);
      return () => {};
    },
  } as unknown as Consumer;
  return { consumer, listeners };
}

function crashEvent(restart: boolean): ConsumerCrashEvent {
  return {
    id: '1',
    type: 'consumer.crash',
    timestamp: Date.now(),
    payload: {
      error: new Error('KafkaJSNotImplemented: Snappy compression is not implemented'),
      groupId: 'triage',
      restart,
    },
  };
}

describe('wireCrashExit', () => {
  it('subscribes to the consumer.crash instrumentation event', () => {
    const { consumer, listeners } = makeStubConsumer();
    wireCrashExit(consumer, () => {});
    expect(listeners.has('consumer.crash')).toBe(true);
  });

  it('exits 1 on a non-retriable crash (restart === false)', () => {
    const { consumer, listeners } = makeStubConsumer();
    const exits: number[] = [];
    wireCrashExit(consumer, (code) => exits.push(code));
    listeners.get('consumer.crash')!(crashEvent(false));
    expect(exits).toEqual([1]);
  });

  it('does NOT exit when kafkajs will self-restart (restart === true)', () => {
    const { consumer, listeners } = makeStubConsumer();
    const exits: number[] = [];
    wireCrashExit(consumer, (code) => exits.push(code));
    listeners.get('consumer.crash')!(crashEvent(true));
    expect(exits).toEqual([]);
  });
});

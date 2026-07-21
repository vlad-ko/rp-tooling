import { describe, expect, it } from 'vitest';
import { buildClassifyMessages } from '../src/prompt.js';
import { makeEdit } from './helpers.js';

describe('classify system prompt', () => {
  const system = buildClassifyMessages(makeEdit())[0].content.toLowerCase();

  it('defines vandalism narrowly (deliberate damage), not a catch-all', () => {
    expect(system).toContain('blanking');
    expect(system).toContain('not vandalism');
  });

  it('forbids judging whether the subject/event is real or notable (knowledge-cutoff guardrail)', () => {
    expect(system).toContain('knowledge may be out of date');
  });

  it('tells the model a revert/undo/restore is a repair, not vandalism', () => {
    expect(system).toMatch(/revert|undo|restore/);
    expect(system).toMatch(/repair|fixing|not vandalism/);
  });
});

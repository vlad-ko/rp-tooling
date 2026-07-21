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

  it('tells the model a revert can be EITHER a repair or damage (not a blanket rule)', () => {
    expect(system).toMatch(/revert|undo|restore/);
    expect(system).toMatch(/either|re-add|edit-war/);
  });

  it('gives concrete examples spanning the vandalism boundary', () => {
    expect(system).toContain('example');
    expect(system).toContain('hoax');
    expect(system).toContain('spam');
    // the bad-actor revert case: re-adding removed spam IS vandalism
    expect(system).toMatch(/re-add|edit-war/);
    // and unsourced additions are NOT vandalism
    expect(system).toMatch(/without a (citation|source)/);
  });
});

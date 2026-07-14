import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FilteredEdit } from '../src/types.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dirty-output');

export function fixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

export function makeEdit(overrides: Partial<FilteredEdit> = {}): FilteredEdit {
  return {
    rc_id: 144234786,
    title: 'Example Page',
    title_url: 'https://en.wikipedia.org/wiki/Example_Page',
    comment: 'expanded the history section',
    user: 'ExampleUser',
    bot: false,
    minor: false,
    length_old: 1000,
    length_new: 1100,
    rev_old: 500,
    rev_new: 501,
    server_url: 'https://en.wikipedia.org',
    notify_url: 'https://en.wikipedia.org/w/index.php?diff=501&oldid=500',
    domain: 'en.wikipedia.org',
    event_time: '2026-07-13T12:00:00Z',
    ...overrides,
  };
}

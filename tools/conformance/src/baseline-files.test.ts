import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASELINE_DIR, readBaseline, writeBaseline } from './baseline-files.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'callis-baseline-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeBaseline and readBaseline', () => {
  it('write one sorted file per suite and read them back', () => {
    writeBaseline({ r4: ['b', 'a'], r5: ['c'] }, dir);
    expect(readFileSync(join(dir, 'r4.txt'), 'utf8')).toBe('a\nb\n');
    expect(readFileSync(join(dir, 'r5.txt'), 'utf8')).toBe('c\n');
    expect(readBaseline(dir)).toEqual({ r4: ['a', 'b'], r5: ['c'] });
  });

  it('create the directory', () => {
    const nested = join(dir, 'a', 'baseline');
    writeBaseline({ r4: [], r5: [] }, nested);
    expect(readBaseline(nested)).toEqual({ r4: [], r5: [] });
  });

  it('name the missing file', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'r4.txt'), 'a\n');
    expect(() => readBaseline(dir)).toThrow(/r5\.txt: baseline file not found/);
  });
});

describe('the committed baseline', () => {
  it('has a file for every suite', () => {
    const baseline = readBaseline(BASELINE_DIR);
    expect(baseline.r4.length).toBeGreaterThan(0);
    expect(baseline.r5.length).toBeGreaterThan(0);
  });
});

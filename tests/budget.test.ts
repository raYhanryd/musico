import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioBudget, dirBytes, freeBytes } from '../src/core/budget';

describe('disk budget', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'musico-budget-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('counts files in nested playlist folders', () => {
    mkdirSync(join(dir, 'session', 'playlist'), { recursive: true });
    writeFileSync(join(dir, 'session', 'playlist', 'one.mp3'), Buffer.alloc(1000));
    writeFileSync(join(dir, 'session', 'playlist', 'two.zip'), Buffer.alloc(2000));
    writeFileSync(join(dir, 'top.zip'), Buffer.alloc(500));

    expect(dirBytes(dir)).toBe(3500);
  });

  test('a missing directory is zero, not a crash', () => {
    expect(dirBytes(join(dir, 'nope'))).toBe(0);
  });

  test('reports positive free space', () => {
    expect(freeBytes(dir)).toBeGreaterThan(0);
  });

  test('audio gets 40% of the cap, leaving room for the zip', () => {
    expect(audioBudget(1000)).toBe(400);
    expect(audioBudget(1024 * 1024 * 800)).toBe(335544320);
    expect(audioBudget(0)).toBe(0);
    expect(audioBudget(-5)).toBe(0);
  });
});

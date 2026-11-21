import { expect, test } from 'bun:test';
import { shouldSkip } from '../src/core/sync';

test('skips a track whose mp3 has bytes', () => {
  expect(shouldSkip(1000)).toBe(true);
});

test('downloads a track whose mp3 is missing or empty', () => {
  expect(shouldSkip(null)).toBe(false);
  expect(shouldSkip(0)).toBe(false);
});

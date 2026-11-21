import { expect, test } from 'bun:test';
import { shouldSkip } from '../src/core/sync';

test('skips a track whose mp3 is already on disk', () => {
  expect(shouldSkip(true)).toBe(true);
});

test('downloads a track whose mp3 is missing', () => {
  expect(shouldSkip(false)).toBe(false);
});

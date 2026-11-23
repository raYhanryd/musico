import { expect, test } from 'bun:test';
import { invalidCookies } from '../src/core/config';

test('accepts no browser or a documented one', () => {
  for (const value of ['', 'chrome', 'safari', 'firefox', 'edge']) {
    expect(invalidCookies(value)).toBeNull();
  }
});

test('rejects an unknown browser', () => {
  expect(invalidCookies('netscape')).toBe('Choose Chrome, Safari, Firefox or Edge.');
});

import { expect, test } from 'bun:test';
import { sameOrigin } from '../src/server';

const post = (origin?: string) =>
  new Request('http://127.0.0.1:7777/api/sync', {
    method: 'POST',
    headers: origin ? { origin } : {},
  });

test('allows the dashboard and non-browser clients', () => {
  expect(sameOrigin(post())).toBe(true);
  expect(sameOrigin(post('http://127.0.0.1:7777'))).toBe(true);
});

test('refuses another site', () => {
  expect(sameOrigin(post('https://evil.example'))).toBe(false);
  expect(sameOrigin(post('null'))).toBe(false);
});

import { expect, test } from 'bun:test';
import { isLocalHost } from '../src/server';

const at = (url: string) => new Request(url);

test('accepts the loopback hosts the launcher can produce', () => {
  expect(isLocalHost(at('http://127.0.0.1:7777/'))).toBe(true);
  expect(isLocalHost(at('http://localhost:7777/'))).toBe(true);
  expect(isLocalHost(at('http://[::1]:7777/'))).toBe(true);
});

test('refuses a host that merely resolves to loopback', () => {
  expect(isLocalHost(at('http://evil.example:7777/'))).toBe(false);
  expect(isLocalHost(at('http://127.0.0.1.evil.example:7777/'))).toBe(false);
});

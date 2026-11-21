import { expect, test } from 'bun:test';
import { killAfter } from '../src/core/download';
import { emptyPlaylistError } from '../src/core/ytmusic';

test('kills a child process when its deadline passes', async () => {
  const proc = Bun.spawn(['/bin/sleep', '30']);
  const guard = killAfter(proc, 300);

  const code = await proc.exited;
  guard.cancel();

  expect(guard.expired()).toBe(true);
  expect(code).not.toBe(0);
}, 10000);

test('hosted empty-playlist copy does not mention the local config', () => {
  const hosted = emptyPlaylistError(true);
  expect(hosted).not.toContain('musico.config.json');
  expect(hosted.toLowerCase()).toContain('public');

  expect(emptyPlaylistError(false)).toContain('cookiesFromBrowser');
});

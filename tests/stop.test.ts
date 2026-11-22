import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, type Config } from '../src/core/config';
import { listTracks, openDb } from '../src/core/db';
import { killActiveChild, trackChild } from '../src/core/download';
import { runSync, stopSync } from '../src/core/sync';

test('a stop with nothing running changes nothing', () => {
  const db = openDb(':memory:');
  try {
    expect(stopSync(db)).toBe(false);
  } finally {
    db.close();
  }
});

test('a stop kills the tracked child', async () => {
  const child = Bun.spawn(['sleep', '5'], { stdout: 'ignore', stderr: 'ignore' });
  trackChild(child);
  killActiveChild();
  expect(await child.exited).not.toBe(0);
}, 3000);

test(
  'stopping during conversion deletes the partial mp3',
  async () => {
    const work = join(ROOT, '.tmp-partial-test');
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = [
      '#!/bin/bash',
      'if [[ "$*" == *"-J"* ]]; then',
      `  echo '{"id":"PLpartial","title":"Partial test","entries":[{"id":"abc","title":"Song"}]}'`,
      '  exit 0',
      'fi',
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi',
      '  prev="$arg"',
      'done',
      'out="${out//%(ext)s/mp3}"',
      'mkdir -p "$(dirname "$out")"',
      'printf partial > "$out"',
      'printf "MUSICO-PP ffmpeg\\n"',
      'exec sleep 5',
    ].join('\n');
    writeFileSync(join(bin, 'yt-dlp'), script, { mode: 0o755 });

    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    const db = openDb(':memory:');
    const config: Config = {
      playlist: 'https://music.youtube.com/playlist?list=PLpartial',
      outDir: '.tmp-partial-test/downloads',
      cookiesFromBrowser: null,
    };
    const target = join(ROOT, config.outDir, 'Partial test', 'Song [abc].mp3');

    try {
      const run = runSync(config, db);
      for (let i = 0; i < 60; i += 1) {
        if (existsSync(target) && listTracks(db, 'PLpartial')[0]?.status === 'transcoding') break;
        await Bun.sleep(50);
      }
      expect(existsSync(target)).toBe(true);
      expect(listTracks(db, 'PLpartial')[0]?.status).toBe('transcoding');

      expect(stopSync(db)).toBe(true);
      await run;

      expect(existsSync(target)).toBe(false);
      expect(listTracks(db, 'PLpartial')[0]?.status).toBe('queued');
    } finally {
      killActiveChild();
      db.close();
      process.env.PATH = oldPath;
      rmSync(work, { recursive: true, force: true });
    }
  },
  8000,
);

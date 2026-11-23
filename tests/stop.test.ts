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

test(
  'stopping during conversion removes the mp3 and yt-dlp sidecars',
  async () => {
    const work = join(ROOT, '.tmp-sidecar-test');
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = [
      '#!/bin/bash',
      'if [[ "$*" == *"-J"* ]]; then',
      `  echo '{"id":"PLsidecar","title":"Sidecar test","entries":[{"id":"side","title":"Song"}]}'`,
      '  exit 0',
      'fi',
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi',
      '  prev="$arg"',
      'done',
      'stem="${out//.%(ext)s/}"',
      'out="$stem.mp3"',
      'mkdir -p "$(dirname "$out")"',
      // What yt-dlp has on disk when it is interrupted during post-processing.
      'printf partial > "$out"',
      'printf source > "$stem.webm"',
      'printf thumb > "$stem.jpg"',
      'printf part > "$stem.part"',
      'printf "MUSICO-PP ffmpeg\\n"',
      'exec sleep 5',
    ].join('\n');
    writeFileSync(join(bin, 'yt-dlp'), script, { mode: 0o755 });

    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    const db = openDb(':memory:');
    const config: Config = {
      playlist: 'https://music.youtube.com/playlist?list=PLsidecar',
      outDir: '.tmp-sidecar-test/downloads',
      cookiesFromBrowser: null,
    };
    const dir = join(ROOT, config.outDir, 'Sidecar test');
    const target = join(dir, 'Song [side].mp3');
    const sidecars = ['Song [side].webm', 'Song [side].jpg', 'Song [side].part'].map((name) => join(dir, name));

    try {
      const run = runSync(config, db);
      for (let i = 0; i < 60; i += 1) {
        if (existsSync(target) && listTracks(db, 'PLsidecar')[0]?.status === 'transcoding') break;
        await Bun.sleep(50);
      }
      const status = listTracks(db, 'PLsidecar')[0]?.status;
      const targetBefore = existsSync(target);
      const sidecarsBefore = sidecars.every((path) => existsSync(path));

      expect(stopSync(db)).toBe(true);
      await run;

      expect(status).toBe('transcoding');
      expect(targetBefore).toBe(true);
      expect(sidecarsBefore).toBe(true);
      expect(existsSync(target)).toBe(false);
      expect(sidecars.some((path) => existsSync(path))).toBe(false);
      expect(listTracks(db, 'PLsidecar')[0]?.status).toBe('queued');
    } finally {
      killActiveChild();
      db.close();
      process.env.PATH = oldPath;
      rmSync(work, { recursive: true, force: true });
    }
  },
  8000,
);

test(
  'a failed conversion does not leave a partial mp3 or sidecars',
  async () => {
    const work = join(ROOT, '.tmp-failed-test');
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = [
      '#!/bin/bash',
      'if [[ "$*" == *"-J"* ]]; then',
      `  echo '{"id":"PLfailed","title":"Failed test","entries":[{"id":"bad","title":"Song"}]}'`,
      '  exit 0',
      'fi',
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi',
      '  prev="$arg"',
      'done',
      'stem="${out//.%(ext)s/}"',
      'mkdir -p "$(dirname "$stem.mp3")"',
      'printf partial > "$stem.mp3"',
      'printf source > "$stem.webm"',
      'printf thumb > "$stem.jpg"',
      'printf "MUSICO-PP ffmpeg\\n"',
      'echo "ERROR: conversion failed" >&2',
      'exit 1',
    ].join('\n');
    writeFileSync(join(bin, 'yt-dlp'), script, { mode: 0o755 });

    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    const db = openDb(':memory:');
    const config: Config = {
      playlist: 'https://music.youtube.com/playlist?list=PLfailed',
      outDir: '.tmp-failed-test/downloads',
      cookiesFromBrowser: null,
    };
    const dir = join(ROOT, config.outDir, 'Failed test');
    const files = ['Song [bad].mp3', 'Song [bad].webm', 'Song [bad].jpg'].map((name) => join(dir, name));

    try {
      await runSync(config, db);
      expect(listTracks(db, 'PLfailed')[0]?.status).toBe('failed');
      expect(files.some((path) => existsSync(path))).toBe(false);
    } finally {
      db.close();
      process.env.PATH = oldPath;
      rmSync(work, { recursive: true, force: true });
    }
  },
  8000,
);

test(
  'an exit 0 without the final move does not count as a finished mp3',
  async () => {
    const work = join(ROOT, '.tmp-nodone-test');
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = [
      '#!/bin/bash',
      'if [[ "$*" == *"-J"* ]]; then',
      `  echo '{"id":"PLnodone","title":"No done test","entries":[{"id":"nodone","title":"Song"}]}'`,
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
      // yt-dlp can exit 0 after KeyboardInterrupt, before after_move runs.
      'printf partial > "$out"',
      'printf "MUSICO-PP ffmpeg\\n"',
      'exit 0',
    ].join('\n');
    writeFileSync(join(bin, 'yt-dlp'), script, { mode: 0o755 });

    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    const db = openDb(':memory:');
    const config: Config = {
      playlist: 'https://music.youtube.com/playlist?list=PLnodone',
      outDir: '.tmp-nodone-test/downloads',
      cookiesFromBrowser: null,
    };
    const target = join(ROOT, config.outDir, 'No done test', 'Song [nodone].mp3');

    try {
      await runSync(config, db);
      expect(existsSync(target)).toBe(false);
      expect(listTracks(db, 'PLnodone')[0]?.status).toBe('failed');
    } finally {
      db.close();
      process.env.PATH = oldPath;
      rmSync(work, { recursive: true, force: true });
    }
  },
  8000,
);

test(
  'stopping during conversion also kills the encoder, so no late mp3 appears',
  async () => {
    const work = join(ROOT, '.tmp-encoder-test');
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = [
      '#!/bin/bash',
      'if [[ "$*" == *"-J"* ]]; then',
      `  echo '{"id":"PLencoder","title":"Encoder test","entries":[{"id":"enc","title":"Song"}]}'`,
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
      // Stand-in for ffmpeg: it outlives the parent and does not hold yt-dlp's pipes.
      '( sleep 1.2; printf late > "$out" ) >/dev/null 2>&1 &',
      'encoder=$!',
      `trap 'kill "$encoder" 2>/dev/null; exit 130' INT`,
      `trap 'exit 143' TERM`,
      'while :; do sleep 0.05; done',
    ].join('\n');
    writeFileSync(join(bin, 'yt-dlp'), script, { mode: 0o755 });

    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    const db = openDb(':memory:');
    const config: Config = {
      playlist: 'https://music.youtube.com/playlist?list=PLencoder',
      outDir: '.tmp-encoder-test/downloads',
      cookiesFromBrowser: null,
    };
    const target = join(ROOT, config.outDir, 'Encoder test', 'Song [enc].mp3');

    try {
      const run = runSync(config, db);
      for (let i = 0; i < 60; i += 1) {
        if (existsSync(target) && listTracks(db, 'PLencoder')[0]?.status === 'transcoding') break;
        await Bun.sleep(50);
      }
      expect(listTracks(db, 'PLencoder')[0]?.status).toBe('transcoding');

      expect(stopSync(db)).toBe(true);
      await run;
      expect(existsSync(target)).toBe(false);

      // If ffmpeg outlived yt-dlp, it writes the finished mp3 back after cleanup.
      await Bun.sleep(1600);
      expect(existsSync(target)).toBe(false);
    } finally {
      killActiveChild();
      db.close();
      process.env.PATH = oldPath;
      rmSync(work, { recursive: true, force: true });
    }
  },
  10000,
);

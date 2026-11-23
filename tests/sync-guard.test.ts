import { expect, test } from 'bun:test';
import { finishRun, openDb, startRun } from '../src/core/db';
import { syncBusy } from '../src/server';

test('a tracked sync promise keeps the endpoint busy', () => {
  const db = openDb(':memory:');
  try {
    expect(syncBusy(db, Promise.resolve())).toBe(true);
  } finally {
    db.close();
  }
});

test('a run registered by another process keeps the endpoint busy', () => {
  const db = openDb(':memory:');
  try {
    const id = startRun(db, 'https://music.youtube.com/playlist?list=PLguard', process.pid);
    expect(syncBusy(db, null)).toBe(true);
    finishRun(db, id);
    expect(syncBusy(db, null)).toBe(false);
  } finally {
    db.close();
  }
});

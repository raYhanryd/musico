import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTracks, openDb, pruneTracks, upsertTracks } from '../src/core/db';

test('rows that left the playlist are dropped and the survivors take the new order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'musico-prune-'));
  const db = openDb(join(dir, 'musico.db'));

  upsertTracks(db, 'PL1', [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ]);
  // The playlist now lists only two of them, renumbered.
  upsertTracks(db, 'PL1', [
    { id: 'c', title: 'C' },
    { id: 'a', title: 'A' },
  ]);
  pruneTracks(db, 'PL1', ['c', 'a']);

  const rows = listTracks(db, 'PL1').map((row) => [row.id, row.position]);
  db.close();
  rmSync(dir, { recursive: true, force: true });

  expect(rows).toEqual([
    ['c', 1],
    ['a', 2],
  ]);
});

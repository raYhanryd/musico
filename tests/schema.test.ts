import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/core/db';

const dir = mkdtempSync(join(tmpdir(), 'musico-schema-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const columnsOf = (db: Database): string[] =>
  (db.query("select name from pragma_table_info('runs')").all() as { name: string }[]).map((column) => column.name);

test('a new database has no run counters nothing reads', () => {
  const db = openDb(join(dir, 'fresh.db'));
  const columns = columnsOf(db);
  db.close();

  expect(columns).toContain('started_at');
  expect(columns).toContain('finished_at');
  for (const dead of ['total', 'added', 'skipped', 'failed']) expect(columns).not.toContain(dead);
});

test('an older database loses the run counters when opened, keeping its rows', () => {
  const path = join(dir, 'old.db');
  const old = new Database(path, { create: true });
  old.exec(`create table runs (
    id integer primary key autoincrement,
    playlist_id text not null,
    started_at integer not null,
    finished_at integer,
    total integer not null default 0,
    added integer not null default 0,
    skipped integer not null default 0,
    failed integer not null default 0,
    pid integer
  )`);
  old.exec("insert into runs (playlist_id, started_at, added) values ('https://example.com/p', 1, 3)");
  old.close();

  const db = openDb(path);
  const columns = columnsOf(db);
  const survivors = db.query('select count(*) as heavy from runs').get() as { heavy: number };
  db.close();

  for (const dead of ['total', 'added', 'skipped', 'failed']) expect(columns).not.toContain(dead);
  expect(columns).toContain('playlist_id');
  expect(survivors.heavy).toBe(1);
});

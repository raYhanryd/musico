import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Status = 'queued' | 'downloading' | 'transcoding' | 'done' | 'failed';

export type StoredTrack = {
  id: string;
  position: number;
  title: string;
  duration: number | null;
  status: Status;
  progress: number;
  bytes: number | null;
  error: string | null;
};

export type Run = {
  id: number;
  started_at: number;
  finished_at: number | null;
  pid: number | null;
};

export type TrackPatch = Partial<Pick<StoredTrack, 'status' | 'progress' | 'bytes' | 'error' | 'duration'>>;
const PATCHABLE = new Set(['status', 'progress', 'bytes', 'error', 'duration']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  playlist_id TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  duration INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  bytes INTEGER,
  error TEXT,
  PRIMARY KEY (playlist_id, id)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  pid INTEGER
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  // WAL lets the dashboard read while a sync (in either process) writes.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Databases created before the counters were dropped still carry them.
  // shortcut: a fixed column list per version, add a real migration chain when the schema moves again
  for (const column of ['total', 'added', 'skipped', 'failed']) {
    try {
      db.exec(`alter table runs drop column ${column}`);
    } catch {
      // Already gone.
    }
  }
  return db;
}

export function upsertTracks(db: Database, playlistId: string, entries: { id: string; title: string }[]): void {
  const stmt = db.query(
    `insert into tracks (playlist_id, id, position, title, status, progress)
     values (?, ?, ?, ?, 'queued', 0)
     on conflict(playlist_id, id) do update set position = excluded.position, title = excluded.title`,
  );
  db.transaction(() => {
    entries.forEach((entry, index) => stmt.run(playlistId, entry.id, index + 1, entry.title));
  })();
}

// Songs removed from the playlist would otherwise linger in the table with stale positions.
// The MP3 stays on disk; only the row goes.
export function pruneTracks(db: Database, playlistId: string, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.query(`delete from tracks where playlist_id = ? and id not in (${placeholders})`).run(playlistId, ...ids);
}

export function listTracks(db: Database, playlistId: string): StoredTrack[] {
  return db
    .query(
      `select id, position, title, duration, status, progress, bytes, error
       from tracks where playlist_id = ? order by position`,
    )
    .all(playlistId) as StoredTrack[];
}

export function setTrack(db: Database, playlistId: string, id: string, patch: TrackPatch): void {
  const columns = Object.keys(patch).filter((key) => PATCHABLE.has(key));
  if (columns.length === 0) return;
  const assignments = columns.map((column) => `${column} = ?`).join(', ');
  const values = columns.map((column) => (patch as Record<string, unknown>)[column]);
  db.query(`update tracks set ${assignments} where playlist_id = ? and id = ?`).run(
    ...(values as (string | number | null)[]),
    playlistId,
    id,
  );
}

export function startRun(db: Database, playlistUrl: string, pid: number): number {
  const result = db
    .query('insert into runs (playlist_id, started_at, pid) values (?, ?, ?)')
    .run(playlistUrl, Date.now(), pid);
  return Number(result.lastInsertRowid);
}

export function finishRun(db: Database, runId: number): void {
  db.query('update runs set finished_at = ? where id = ?').run(Date.now(), runId);
}

export function activeRun(db: Database): Run | null {
  const run = db.query('select * from runs where finished_at is null order by id desc limit 1').get() as Run | null;
  if (!run) return null;
  if (isAlive(run.pid)) return run;
  // A killed process leaves its run open; close it so the lock cannot wedge forever.
  db.query('update runs set finished_at = ? where id = ?').run(Date.now(), run.id);
  return null;
}

export function latestRun(db: Database): Run | null {
  return db.query('select * from runs where finished_at is not null order by id desc limit 1').get() as Run | null;
}

export function getMeta(db: Database, key: string): string | null {
  const row = db.query('select value from meta where key = ?').get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(
    key,
    value,
  );
}

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

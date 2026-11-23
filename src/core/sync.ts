import type { Database } from 'bun:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, type Config } from './config';
import { fileName, sanitizeName, splitTitle, downloadTrack, killActiveChild } from './download';
import { activeRun, finishRun, pruneTracks, setMeta, setTrack, startRun, upsertTracks } from './db';
import { listPlaylist } from './ytmusic';

export type TrackInfo = { id: string; position: number; song: string; title: string };

export type Hooks = {
  onListed?: (title: string, total: number) => void;
  onSkip?: (track: TrackInfo) => void;
  onStart?: (track: TrackInfo) => void;
  onProgress?: (track: TrackInfo, phase: 'fetch' | 'convert', percent: number) => void;
  onDone?: (track: TrackInfo) => void;
  onFail?: (track: TrackInfo, error: string) => void;
};

export type Summary = { title: string; total: number; skipped: number; added: number; failed: number };

// The file on disk is the only source of truth for "already downloaded": a stale
// database row must never cause a re-download, and a missing or empty file must be
// fetched again.
export function shouldSkip(fileBytes: number | null): boolean {
  return fileBytes !== null && fileBytes > 0;
}

let stopRun: number | null = null;

// Kill the running yt-dlp and let the loop stop at its next boundary.
export function stopSync(db: Database): boolean {
  const run = activeRun(db);
  if (!run) return false;
  stopRun = run.id;
  killActiveChild();
  return true;
}

export async function runSync(config: Config, db: Database, hooks: Hooks = {}): Promise<Summary> {
  if (!config.playlist) throw new Error('No playlist set yet. Paste a YouTube Music playlist link in the dashboard.');

  const current = activeRun(db);
  if (current) throw new Error('A sync is already running.');

  // The run row is written before the first await so two triggers cannot race.
  const runId = startRun(db, config.playlist, process.pid);
  const counts = { added: 0, skipped: 0, failed: 0 };
  const stopped = () => stopRun === runId;
  setMeta(db, 'lastError', '');

  try {
    const playlist = await listPlaylist(config.playlist, config.cookiesFromBrowser);
    setMeta(db, 'playlistId', playlist.id);
    setMeta(db, 'playlistTitle', playlist.title);
    upsertTracks(db, playlist.id, playlist.entries);
    pruneTracks(
      db,
      playlist.id,
      playlist.entries.map((entry) => entry.id),
    );
    hooks.onListed?.(playlist.title, playlist.entries.length);

    const dir = join(ROOT, config.outDir, sanitizeName(playlist.title));
    mkdirSync(dir, { recursive: true });

    for (const [index, entry] of playlist.entries.entries()) {
      if (stopped()) break;
      const track: TrackInfo = {
        id: entry.id,
        position: index + 1,
        song: splitTitle(entry.title).song,
        title: entry.title,
      };
      const base = `${sanitizeName(entry.title)} [${entry.id}]`;
      const target = join(dir, fileName({ id: entry.id, title: entry.title }));

      if (shouldSkip(sizeOf(target))) {
        setTrack(db, playlist.id, entry.id, {
          status: 'done',
          progress: 1,
          bytes: sizeOf(target),
          error: null,
        });
        counts.skipped += 1;
        hooks.onSkip?.(track);
        continue;
      }

      setTrack(db, playlist.id, entry.id, { status: 'downloading', progress: 0, error: null });
      hooks.onStart?.(track);

      try {
        const result = await downloadTrack({
          id: entry.id,
          dir,
          base,
          cookiesFromBrowser: config.cookiesFromBrowser,
          onEvent: (event) => {
            if (event.kind === 'download' && event.total && event.total > 0) {
              const percent = Math.min(1, event.downloaded / event.total);
              setTrack(db, playlist.id, entry.id, { progress: percent });
              hooks.onProgress?.(track, 'fetch', percent);
            } else if (event.kind === 'transcode') {
              setTrack(db, playlist.id, entry.id, { status: 'transcoding', progress: 1 });
              hooks.onProgress?.(track, 'convert', 1);
            }
          },
        });
        setTrack(db, playlist.id, entry.id, {
          status: 'done',
          progress: 1,
          bytes: sizeOf(result.file),
          duration: result.duration,
          error: null,
        });
        counts.added += 1;
        hooks.onDone?.(track);
      } catch (error) {
        // A killed or failed conversion leaves a truncated mp3 and yt-dlp's source,
        // thumbnail and .part files behind. None of them are safe to trust next run.
        removeTrackFiles(dir, base);
        if (stopped()) {
          setTrack(db, playlist.id, entry.id, { status: 'queued', progress: 0, error: null });
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        setTrack(db, playlist.id, entry.id, { status: 'failed', progress: 0, error: message });
        counts.failed += 1;
        hooks.onFail?.(track, message);
      }
    }

    return { title: playlist.title, total: playlist.entries.length, ...counts };
  } catch (error) {
    // A user stop is not a failure; the run just ends quietly.
    if (stopped()) return { title: '', total: 0, ...counts };
    const message = error instanceof Error ? error.message : String(error);
    setMeta(db, 'lastError', message);
    throw error;
  } finally {
    if (stopped()) stopRun = null;
    finishRun(db, runId);
  }
}

function removeTrackFiles(dir: string, base: string): void {
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(`${base}.`)) rmSync(join(dir, name), { force: true });
    }
  } catch {
    // The folder may not exist if listing failed before it was created.
  }
}

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

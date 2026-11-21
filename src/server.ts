import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig, saveConfig } from './core/config';
import { activeRun, getMeta, latestRun, listTracks, openDb, setMeta } from './core/db';
import { fileName, killActiveChild, sanitizeName, splitTitle } from './core/download';
import { runSync } from './core/sync';
import { invalidPlaylistUrl } from './core/ytmusic';

const PORT = Number(process.env.PORT) || 7777;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function asset(name: string, type: string): Response {
  return new Response(Bun.file(join(ROOT, 'src/web', name)), { headers: { 'content-type': type } });
}

// Any page can POST to loopback; refuse writes that name a different origin.
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export function start(): void {
  const db = openDb(join(ROOT, 'data', 'musico.db'));

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: PORT,
      fetch: async (request) => {
        const { pathname } = new URL(request.url);

        if (request.method === 'POST' && !sameOrigin(request)) {
          return json({ error: 'Cross-origin request refused.' }, 403);
        }

        if (pathname === '/api/state' && request.method === 'GET') return json(buildState(db));

        if (pathname === '/api/config' && request.method === 'POST') {
          const body = (await request.json().catch(() => null)) as { playlist?: unknown } | null;
          const playlist = typeof body?.playlist === 'string' ? body.playlist.trim() : '';
          const invalid = invalidPlaylistUrl(playlist);
          if (invalid) return json({ error: invalid }, 400);
          saveConfig({ playlist });
          return json({ ok: true });
        }

        if (pathname === '/api/sync' && request.method === 'POST') {
          const config = loadConfig();
          if (!config.playlist) return json({ error: 'No playlist set yet.' }, 400);
          // Fire and forget: the dashboard polls the database for progress.
          runSync(config, db).catch((error) => {
            setMeta(db, 'lastError', error instanceof Error ? error.message : String(error));
          });
          return json({ started: true }, 202);
        }

        if (pathname === '/') return asset('index.html', 'text/html; charset=utf-8');
        if (pathname === '/app.js') return asset('app.js', 'text/javascript; charset=utf-8');
        if (pathname === '/style.css') return asset('style.css', 'text/css; charset=utf-8');

        return new Response('Not found', { status: 404 });
      },
    });
  } catch (error) {
    console.error(
      `Could not start on 127.0.0.1:${PORT} — something else is using that port.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  // Ctrl-c should take a running rip down too, not just the dashboard.
  const shutdown = () => {
    killActiveChild();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`Musico is at http://127.0.0.1:${server.port}  (ctrl-c to stop)`);
}

function buildState(db: Database) {
  const config = loadConfig();
  const playlistId = getMeta(db, 'playlistId');
  const playlistTitle = getMeta(db, 'playlistTitle');
  const stored = playlistId ? listTracks(db, playlistId) : [];
  const dir = playlistTitle ? join(ROOT, config.outDir, sanitizeName(playlistTitle)) : null;

  const tracks = stored.map((track) => {
    const path = dir ? join(dir, fileName({ id: track.id, title: track.title })) : null;
    const bytes = path ? sizeOf(path) : null;
    const { artist, song } = splitTitle(track.title);
    return {
      id: track.id,
      position: track.position,
      title: track.title,
      song,
      artist,
      duration: track.duration,
      status: track.status,
      progress: track.progress,
      error: track.error,
      onDisk: bytes !== null,
      bytes,
    };
  });

  const active = activeRun(db);
  const last = latestRun(db);
  const run = active
    ? { running: true, elapsedMs: Date.now() - active.started_at }
    : last
      ? { running: false, elapsedMs: (last.finished_at ?? last.started_at) - last.started_at }
      : null;

  const onDisk = tracks.filter((track) => track.onDisk).length;

  return {
    config,
    playlist: playlistTitle ? { id: playlistId, title: playlistTitle } : null,
    tracks,
    totals: {
      onDisk,
      todo: tracks.length - onDisk,
      failed: tracks.filter((track) => track.status === 'failed' && !track.onDisk).length,
      bytes: tracks.reduce((sum, track) => sum + (track.bytes ?? 0), 0),
    },
    run,
    error: getMeta(db, 'lastError') ?? '',
  };
}

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

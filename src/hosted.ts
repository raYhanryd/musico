import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './core/config';
import { downloadTrack, fileName, sanitizeName, splitTitle } from './core/download';
import { invalidPlaylistUrl, listPlaylist } from './core/ytmusic';

// Hosted, multi-user mode: no config file, no database, one job per browser session,
// everything lives in a temp dir that is deleted after TTL_MS.
const PORT = Number(process.env.PORT ?? 8787);
const JOBS_DIR = join(tmpdir(), 'musico-jobs');
const TTL_MS = 45 * 60 * 1000;
const MAX_TRACKS = Number(process.env.MAX_TRACKS ?? 50);
const MAX_JOBS = 20;
const MAX_CONCURRENT = 2;
const RIPS_PER_HOUR = 3;

type Status = 'queued' | 'downloading' | 'transcoding' | 'done' | 'failed';

type Track = {
  id: string;
  position: number;
  title: string;
  song: string;
  artist: string;
  duration: number | null;
  status: Status;
  progress: number;
  error: string | null;
  bytes: number | null;
};

type Job = {
  id: string;
  dir: string;
  playlist: string;
  playlistId: string;
  title: string;
  tracks: Track[];
  files: string[];
  running: boolean;
  error: string;
  startedAt: number;
  finishedAt: number | null;
  zipPath: string | null;
  zipBytes: number;
};

const sessions = new Map<string, Job>();
const pendingPlaylist = new Map<string, string>();
const ripsByIp = new Map<string, number[]>();
let activeJobs = 0;

const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    },
  });

const asset = (name: string, type: string) =>
  new Response(Bun.file(join(ROOT, 'src/web', name)), { headers: { 'content-type': type } });

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name) return value ?? null;
  }
  return null;
}

function sessionOf(request: Request): { id: string; cookie?: string } {
  const existing = readCookie(request, 'musico_sid');
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return { id: existing };
  const id = randomUUID();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return { id, cookie: `musico_sid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}` };
}

function clientIp(request: Request, server: { requestIP: (r: Request) => { address: string } | null }): string {
  // Behind Fly/Render/Cloudflare the proxy appends the real client; direct hits have no header.
  const forwarded = request.headers.get('x-forwarded-for');
  // Take the last hop: earlier entries are client-supplied and spoofable.
  if (forwarded) return forwarded.split(',').at(-1)!.trim();
  return server.requestIP(request)?.address ?? 'unknown';
}

function snapshot(job: Job | null, playlist: string) {
  const tracks = job?.tracks ?? [];
  const onDisk = tracks.filter((track) => track.status === 'done').length;
  return {
    hosted: true,
    config: { playlist: playlist || job?.playlist || '', outDir: 'zip', cookiesFromBrowser: null },
    playlist: job ? { id: job.playlistId, title: job.title } : null,
    tracks,
    totals: {
      onDisk,
      todo: tracks.length - onDisk,
      failed: tracks.filter((track) => track.status === 'failed').length,
      bytes: tracks.reduce((sum, track) => sum + (track.bytes ?? 0), 0),
    },
    run: job ? { running: job.running, elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt } : null,
    error: job?.error ?? '',
    zip: { ready: Boolean(job?.zipPath), bytes: job?.zipBytes ?? 0 },
  };
}

async function runJob(job: Job): Promise<void> {
  try {
    const playlist = await listPlaylist(job.playlist);
    job.title = playlist.title;
    const entries = playlist.entries.slice(0, MAX_TRACKS);
    const dir = join(job.dir, sanitizeName(playlist.title));
    mkdirSync(dir, { recursive: true });

    job.tracks = entries.map((entry, index) => ({
      id: entry.id,
      position: index + 1,
      title: entry.title,
      ...splitTitle(entry.title),
      duration: null,
      status: 'queued' as Status,
      progress: 0,
      error: null,
      bytes: null,
    }));

    for (const track of job.tracks) {
      const target = join(dir, fileName({ id: track.id, title: track.title }));
      if (existsSync(target)) {
        track.status = 'done';
        track.progress = 1;
        track.bytes = statSync(target).size;
        job.files.push(target);
        continue;
      }

      track.status = 'downloading';
      try {
        const result = await downloadTrack({
          id: track.id,
          dir,
          base: `${sanitizeName(track.title)} [${track.id}]`,
          onEvent: (event) => {
            if (event.kind === 'download' && event.total && event.total > 0) {
              track.progress = Math.min(1, event.downloaded / event.total);
            } else if (event.kind === 'transcode') {
              track.status = 'transcoding';
              track.progress = 1;
            }
          },
        });
        track.status = 'done';
        track.progress = 1;
        track.bytes = statSync(result.file).size;
        track.duration = result.duration;
        job.files.push(result.file);
      } catch (error) {
        track.status = 'failed';
        track.progress = 0;
        track.error = error instanceof Error ? error.message : String(error);
      }
    }

    // Build it now: the download button is only shown once this exists.
    if (job.files.length > 0) buildZip(job);
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
  } finally {
    job.running = false;
    job.finishedAt = Date.now();
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (ripsByIp.get(ip) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  if (recent.length >= RIPS_PER_HOUR) return true;
  recent.push(now);
  ripsByIp.set(ip, recent);
  return false;
}

function buildZip(job: Job): string {
  if (job.zipPath) return job.zipPath;
  if (job.files.length === 0) throw new Error('Nothing has downloaded yet.');
  const path = join(job.dir, `${sanitizeName(job.title) || 'musico'}.zip`);
  // Rebuild from scratch so a track dropped from the playlist cannot survive in the zip.
  rmSync(path, { force: true });
  const result = Bun.spawnSync(['zip', '-j', '-q', path, ...job.files]);
  if (result.exitCode !== 0) throw new Error('Could not build the zip file.');
  job.zipPath = path;
  job.zipBytes = statSync(path).size;
  return path;
}

// One job per session: a new rip replaces the previous directory deliberately.
function startJob(session: string, playlist: string, ip: string): Job {
  const current = sessions.get(session);
  if (current?.running) throw new Error('A rip is already running for this session.');
  if (activeJobs >= MAX_CONCURRENT) throw new Error('Musico is busy right now. Try again in a minute.');
  if (sessions.size >= MAX_JOBS) throw new Error('Musico is at capacity right now. Try again shortly.');
  if (rateLimited(ip)) throw new Error(`Limit reached: ${RIPS_PER_HOUR} rips per hour. Try again later.`);

  // Keep the directory: a second rip in this session skips what is already on disk.
  const dir = join(JOBS_DIR, session);
  mkdirSync(dir, { recursive: true });

  const job: Job = {
    id: session,
    dir,
    playlist,
    playlistId: new URL(playlist).searchParams.get('list') ?? playlist,
    title: 'Playlist',
    tracks: [],
    files: [],
    running: true,
    error: '',
    startedAt: Date.now(),
    finishedAt: null,
    zipPath: null,
    zipBytes: 0,
  };

  sessions.set(session, job);
  activeJobs += 1;
  void runJob(job);
  return job;
}

rmSync(JOBS_DIR, { recursive: true, force: true });
mkdirSync(JOBS_DIR, { recursive: true });

setInterval(() => {
  const now = Date.now();
  for (const [session, job] of sessions) {
    if (job.running || job.startedAt + TTL_MS > now) continue;
    rmSync(job.dir, { recursive: true, force: true });
    sessions.delete(session);
    pendingPlaylist.delete(session);
  }
  for (const [ip, times] of ripsByIp) {
    if (times.every((at) => now - at >= 60 * 60 * 1000)) ripsByIp.delete(ip);
  }
  // Visitors who never pressed rip must not grow this map forever.
  while (pendingPlaylist.size > 500) pendingPlaylist.delete(pendingPlaylist.keys().next().value!);
}, 5 * 60 * 1000);

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  fetch: async (request, server) => {
    const { pathname } = new URL(request.url);
    const session = sessionOf(request);
    const cookie = session.cookie;
    const job = sessions.get(session.id) ?? null;
    const playlist = pendingPlaylist.get(session.id) ?? '';

    if (pathname === '/api/state' && request.method === 'GET') return json(snapshot(job, playlist), 200, cookie);

    if (pathname === '/api/config' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { playlist?: unknown } | null;
      const value = typeof body?.playlist === 'string' ? body.playlist.trim() : '';
      const invalid = invalidPlaylistUrl(value);
      if (invalid) return json({ error: invalid }, 400, cookie);
      pendingPlaylist.set(session.id, value);
      return json({ ok: true }, 200, cookie);
    }

    if (pathname === '/api/sync' && request.method === 'POST') {
      const value = playlist;
      const invalid = invalidPlaylistUrl(value);
      if (invalid) return json({ error: invalid }, 400, cookie);
      try {
        startJob(session.id, value, clientIp(request, server));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 429, cookie);
      }
      return json({ started: true }, 202, cookie);
    }

    if (pathname === '/api/zip') {
      const current = sessions.get(session.id);
      if (!current || current.files.length === 0) return new Response('Nothing to download yet.', { status: 404 });
      let path: string;
      try {
        path = buildZip(current);
      } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Zip failed.', { status: 409 });
      }
      return new Response(Bun.file(path), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${(sanitizeName(current.title) || 'musico').replace(/"/g, '')}.zip"`,
          'cache-control': 'no-store',
        },
      });
    }

    if (pathname === '/') return asset('index.html', 'text/html; charset=utf-8');
    if (pathname === '/app.js') return asset('app.js', 'text/javascript; charset=utf-8');
    if (pathname === '/style.css') return asset('style.css', 'text/css; charset=utf-8');

    return new Response('Not found', { status: 404 });
  },
});

console.log(`Musico (hosted mode) is at http://localhost:${PORT}`);

const DASH = /^(.+?)\s[-–—]\s(.+)$/;
const STRIP = /[:*?"<>|%\u0000-\u001f]/g;
const NAME_BYTES = 180; // leaves room for " [id].mp3" under the 255-byte limit

// Filesystem limits count UTF-8 bytes, so a long CJK or emoji title must not be
// clamped by character count alone.
function truncateBytes(text: string, max: number): string {
  let out = '';
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > max) break;
    out += char;
    bytes += size;
  }
  return out;
}

// yt-dlp treats -o as a template, so a stray % in a title breaks the output path.
export function sanitizeName(input: string): string {
  const cleaned = input
    .replace(/[/\\]/g, '-')
    .replace(STRIP, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  // A name made only of dashes and dots reads as noise in a folder listing.
  const usable = /[^.\-\s]/.test(cleaned) ? cleaned : '';
  return truncateBytes(usable || 'untitled', NAME_BYTES).trim() || 'untitled';
}

export function fileName(track: { id: string; title: string }): string {
  return `${sanitizeName(track.title)} [${sanitizeName(track.id)}].mp3`;
}

// Display only: YouTube Music shows "Artist - Song" in one string, so the artist line
// is a guess. Track identity always comes from the video id, never from this split.
export function splitTitle(title: string): { artist: string; song: string } {
  const match = title.match(DASH);
  if (!match) return { artist: '', song: title };
  return { artist: match[1].trim(), song: match[2].trim() };
}

export type ProgressEvent =
  | { kind: 'begin'; id: string; duration: number | null }
  | { kind: 'download'; status: string; downloaded: number; total: number | null; speed: number | null }
  | { kind: 'transcode' }
  | { kind: 'done'; file: string };

const BEGIN = 'MUSICO-BEGIN ';
const DONE = 'MUSICO-DONE ';
const BYTES = 'MUSICO-DL|';

export function parseProgressLine(line: string): ProgressEvent | null {
  const text = line.trim();

  if (text.startsWith(BEGIN)) {
    const [, id, raw] = text.split(/\s+/);
    const duration = Number(raw);
    return { kind: 'begin', id: id ?? '', duration: Number.isFinite(duration) && duration > 0 ? duration : null };
  }

  if (text.startsWith(BYTES)) {
    const [, status, downloaded, total, estimate, speed] = text.split('|');
    const num = (value: string | undefined) => {
      if (!value || value === 'NA') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      kind: 'download',
      status: status ?? '',
      downloaded: num(downloaded) ?? 0,
      total: num(total) ?? num(estimate),
      speed: num(speed),
    };
  }

  if (text.startsWith('MUSICO-PP')) return { kind: 'transcode' };
  if (text.startsWith(DONE)) return { kind: 'done', file: text.slice(DONE.length) };

  return null;
}

export function friendlyError(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes('sign in to confirm') || text.includes('not a bot')) {
    return 'YouTube asked for a sign-in. Run "brew upgrade yt-dlp"; if that does not help, set "cookiesFromBrowser": "firefox" in musico.config.json.';
  }
  if (text.includes('private') || text.includes('members-only') || text.includes('join this channel')) {
    return 'This playlist is not public. Set "cookiesFromBrowser": "firefox" in musico.config.json so Musico can see it.';
  }
  if (text.includes('command not found') || text.includes('no such file or directory')) {
    return 'yt-dlp or ffmpeg is missing. Run "brew install yt-dlp ffmpeg".';
  }
  const last = stderr
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return last ? last.replace(/^ERROR:\s*/i, '') : 'yt-dlp failed.';
}

// The child currently downloading, so ctrl-c can take yt-dlp down with the server.
let activeChild: ReturnType<typeof Bun.spawn> | null = null;

export function killActiveChild(): void {
  try {
    activeChild?.kill();
  } catch {
    // Already gone.
  }
  activeChild = null;
}

// The playlist listing shares this slot so a stop can end a stuck listing too.
export function trackChild(child: ReturnType<typeof Bun.spawn>): void {
  activeChild = child;
}

export function untrackChild(): void {
  activeChild = null;
}

type DownloadOptions = {
  id: string;
  dir: string;
  base: string;
  cookiesFromBrowser?: string | null;
  onEvent?: (event: ProgressEvent) => void;
};

export async function downloadTrack(options: DownloadOptions): Promise<{ file: string; duration: number | null }> {
  const output = `${options.dir}/${options.base}.%(ext)s`;
  const args = [
    '-f',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
    '--embed-thumbnail',
    '--embed-metadata',
    '--convert-thumbnails',
    'jpg',
    '--no-playlist',
    // sync only calls this when the file is missing or empty, so replace it.
    '--force-overwrites',
    '--no-simulate', // --print implies --simulate, and implies --quiet, which hides progress
    '--progress',
    '--newline',
    '--no-warnings',
    '--progress-delta',
    '0.1',
    '--progress-template',
    'download:MUSICO-DL|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s',
    '--print',
    'before_dl:MUSICO-BEGIN %(id)s %(duration)s',
    '--print',
    'post_process:MUSICO-PP %(postprocessor)s',
    '--print',
    'after_move:MUSICO-DONE %(filepath)s',
    '-o',
    output,
    `https://music.youtube.com/watch?v=${options.id}`,
  ];
  if (options.cookiesFromBrowser) args.unshift('--cookies-from-browser', options.cookiesFromBrowser);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['yt-dlp', ...args], { env: process.env, stdout: 'pipe', stderr: 'pipe' });
  } catch {
    throw new Error('yt-dlp is not installed. Run "brew install yt-dlp ffmpeg".');
  }
  activeChild = proc;

  // Drain stderr immediately: an unread pipe fills and blocks yt-dlp mid-download.
  const stderrText = new Response(proc.stderr as ReadableStream<Uint8Array>).text();

  const decoder = new TextDecoder();
  let buffer = '';
  let file = '';
  let duration: number | null = null;

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const event = parseProgressLine(line);
      if (event) {
        if (event.kind === 'done') file = event.file;
        if (event.kind === 'begin') duration = event.duration;
        options.onEvent?.(event);
      }
      newline = buffer.indexOf('\n');
    }
  }

  const code = await proc.exited;
  if (activeChild === proc) activeChild = null;
  if (code !== 0) throw new Error(friendlyError(await stderrText));

  const finalFile = file || `${options.dir}/${options.base}.mp3`;
  if (!exists(finalFile)) throw new Error('yt-dlp finished but no MP3 was written.');
  return { file: finalFile, duration };
}

function exists(path: string): boolean {
  try {
    return Bun.file(path).size > 0;
  } catch {
    return false;
  }
}

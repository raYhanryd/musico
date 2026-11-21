import { friendlyError } from './download';

export function invalidPlaylistUrl(value: string): string | null {
  if (!value) return 'Paste a playlist link.';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'That is not a link Musico can read.';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use an https link.';
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return 'Use a music.youtube.com playlist link.';
  if (!url.searchParams.get('list')) return 'That link has no playlist id. Use the playlist share link.';
  return null;
}

export type Entry = { id: string; title: string };
export type Playlist = { id: string; title: string; entries: Entry[] };

export async function listPlaylist(url: string, cookiesFromBrowser?: string | null): Promise<Playlist> {
  const args = ['-J', '--flat-playlist', '--no-warnings', url];
  if (cookiesFromBrowser) args.unshift('--cookies-from-browser', cookiesFromBrowser);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['yt-dlp', ...args], { stdout: 'pipe', stderr: 'pipe' });
  } catch {
    throw new Error('yt-dlp is not installed. Run "brew install yt-dlp ffmpeg".');
  }

  const stderrText = new Response(proc.stderr as ReadableStream<Uint8Array>).text();
  const stdoutText = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(friendlyError(await stderrText));

  const jsonLine = stdoutText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .pop();
  if (!jsonLine) throw new Error('yt-dlp returned no playlist data.');

  const info = JSON.parse(jsonLine) as {
    id?: string;
    title?: string;
    _type?: string;
    entries?: { id?: string; title?: string }[];
  };

  // A single video link is still one track worth ripping.
  const raw = Array.isArray(info.entries) ? info.entries : info._type === 'video' ? [info] : [];
  const entries: Entry[] = raw
    .filter((entry) => typeof entry?.id === 'string' && entry.id.length > 0)
    .map((entry) => ({
      id: entry.id as string,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : '(untitled)',
    }));

  if (entries.length === 0) {
    throw new Error(
      'No playable tracks in that playlist. If it is private, set "cookiesFromBrowser": "firefox" in musico.config.json, then run it again.',
    );
  }

  return {
    id: info.id ?? 'playlist',
    title: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Playlist',
    entries,
  };
}

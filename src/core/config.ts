import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '../..');
const FILE = join(ROOT, 'musico.config.json');

export type Config = {
  playlist: string;
  outDir: string;
  cookiesFromBrowser: string | null;
};

const BROWSERS = ['chrome', 'safari', 'firefox', 'edge'];

// yt-dlp reads the cookies of a signed-in browser; anything else is a typo.
export function invalidCookies(value: string): string | null {
  return value && !BROWSERS.includes(value) ? 'Choose Chrome, Safari, Firefox or Edge.' : null;
}

export function loadConfig(): Config {
  let raw: Partial<Config> = {};
  try {
    raw = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Config>;
  } catch {
    // A missing or hand-edited config falls back to defaults; the UI rewrites it on save.
  }
  return {
    playlist: typeof raw.playlist === 'string' ? raw.playlist : '',
    outDir: typeof raw.outDir === 'string' && raw.outDir ? raw.outDir : 'downloads',
    cookiesFromBrowser: typeof raw.cookiesFromBrowser === 'string' && raw.cookiesFromBrowser ? raw.cookiesFromBrowser : null,
  };
}

export function saveConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch };
  // Write-then-rename: a crash cannot leave a half-written config behind.
  const temp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temp, FILE);
  return next;
}

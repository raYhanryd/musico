import { readdirSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The zip is roughly the size of the audio it holds, so audio may only use part of
// the disk cap; the rest is headroom for packaging. A single oversized track can
// still overshoot by its own size, which the cap absorbs.
export const AUDIO_SHARE = 0.4;

export function audioBudget(capBytes: number): number {
  return Math.floor(Math.max(0, capBytes) * AUDIO_SHARE);
}

export function dirBytes(dir: string): number {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    try {
      const info = statSync(join(dir, entry));
      if (info.isFile()) total += info.size;
    } catch {
      // A file deleted by a concurrent cleanup must not break accounting.
    }
  }
  return total;
}

// Infinity means "unknown", so a failed statfs never blocks downloads.
export function freeBytes(dir: string): number {
  try {
    const stats = statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

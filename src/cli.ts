import { join } from 'node:path';
import { ROOT, loadConfig } from './core/config';
import { openDb } from './core/db';
import { runSync } from './core/sync';

const command = process.argv[2] ?? 'help';

if (command === 'ui') {
  const { start } = await import('./server');
  start();
} else if (command === 'sync') {
  const db = openDb(join(ROOT, 'data', 'musico.db'));
  const config = loadConfig();

  if (!config.playlist) {
    console.error('No playlist set. Run "bun run ui" and paste a link, or set "playlist" in musico.config.json.');
    process.exit(1);
  }

  const tty = process.stdout.isTTY;
  let lastPaint = 0;

  const paint = (line: string) => {
    if (tty) process.stdout.write(`\r\x1b[K  ${line}`);
  };
  const endLine = () => {
    if (tty) process.stdout.write('\n');
  };

  try {
    const summary = await runSync(config, db, {
      onListed: (title, total) => console.log(`\n${title} — ${total} tracks`),
      onStart: (track) => paint(`↓ ${track.position}  ${track.title}`),
      onProgress: (track, phase, percent) => {
        const now = Date.now();
        if (now - lastPaint < 200) return;
        lastPaint = now;
        paint(phase === 'fetch' ? `↓ ${Math.round(percent * 100)}%  ${track.song}` : `⟳ converting  ${track.song}`);
      },
      onDone: (track) => {
        endLine();
        console.log(`  ✓ ${track.song}`);
      },
      onFail: (track, error) => {
        endLine();
        console.log(`  ! ${track.song}: ${error}`);
      },
    });

    const parts = [`✓ ${summary.skipped} already here`, `↓ ${summary.added} downloaded`];
    if (summary.failed > 0) parts.push(`! ${summary.failed} failed`);
    console.log(`\n${parts.join('   ')}`);
    console.log(`  saved under ${join(ROOT, config.outDir)}/<playlist name>/`);
  } catch (error) {
    endLine();
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
} else {
  console.log(`
Musico — pull a YouTube Music playlist down as MP3 files.

  bun run sync     download anything new into downloads/, skip what is already there
  bun run ui       open the dashboard at http://127.0.0.1:7777
  bun test         run the unit tests
`);
}

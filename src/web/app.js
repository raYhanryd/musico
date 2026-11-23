const $ = (id) => document.getElementById(id);

const rows = new Map();
const announced = new Map();
let stripSignature = '';
let editing = false;
let cookiesLoaded = false;
let timer = null;
let metaA = null;
let metaB = null;

const pad2 = (value) => String(value).padStart(2, '0');

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function length(seconds) {
  if (!seconds) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

function size(bytes) {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

function view(track) {
  if (track.status === 'downloading') {
    return { cls: 'run', glyph: '↓', word: `fetching ${Math.round(track.progress * 100)}%`, percent: track.progress };
  }
  if (track.status === 'transcoding') return { cls: 'run', glyph: '⟳', word: 'converting', percent: null };
  if (track.status === 'failed') return { cls: 'fail', glyph: '!', word: 'failed', percent: null };
  if (track.onDisk) return { cls: 'done', glyph: '✓', word: 'on disk', percent: null };
  return { cls: 'wait', glyph: '', word: 'waiting', percent: null };
}

function row(track) {
  const existing = rows.get(track.id);
  if (existing) return existing;

  const tr = document.createElement('tr');

  const indexCell = document.createElement('td');
  indexCell.className = 'c-at';
  const index = document.createElement('span');
  index.className = 'at';
  indexCell.appendChild(index);

  const trackCell = document.createElement('td');
  const tt = document.createElement('span');
  tt.className = 'tt';
  const ar = document.createElement('span');
  ar.className = 'ar';
  trackCell.append(tt, ar);

  const lengthCell = document.createElement('td');
  lengthCell.className = 'c-len';
  const len = document.createElement('span');
  len.className = 'len';
  lengthCell.appendChild(len);

  const stateCell = document.createElement('td');
  stateCell.className = 'c-state';
  const stateLine = document.createElement('span');
  stateLine.className = 'st';
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const word = document.createElement('span');
  word.className = 'word';
  stateLine.append(glyph, word);
  const bar = document.createElement('span');
  bar.className = 'bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('i');
  bar.appendChild(fill);
  stateCell.append(stateLine, bar);

  tr.append(indexCell, trackCell, lengthCell, stateCell);
  $('rows').appendChild(tr);

  const entry = { tr, index, tt, ar, len, stateLine, glyph, word, bar, fill };
  rows.set(track.id, entry);
  return entry;
}

function render(state) {
  const configured = Boolean(state.config?.playlist);
  if (!cookiesLoaded) {
    $('cookies').value = state.config?.cookiesFromBrowser ?? '';
    cookiesLoaded = true;
  }
  // A bad saved link must not trap the user: let them paste another one.
  $('setup').hidden = configured && !state.error && !editing;
  $('table-wrap').hidden = !configured;
  $('change').hidden = !configured || editing || Boolean(state.error);
  $('change').disabled = Boolean(state.run?.running);
  // When the saved link is broken the form is the only way out, so it stays open.
  $('cancel-change').hidden = !editing || Boolean(state.error);
  setText($('title'), state.playlist?.title || 'Musico');
  renderMeta(state, configured);
  $('banner').hidden = !state.error;
  setText($('banner'), state.error || '');

  if (!configured) {
    $('strip').hidden = true;
    $('stop').hidden = true;
    $('download').disabled = true;
    return;
  }
  $('strip').hidden = false;

  const tracks = state.tracks ?? [];
  const live = new Set(tracks.map((track) => track.id));
  for (const [id, entry] of rows) {
    if (!live.has(id)) {
      entry.tr.remove();
      rows.delete(id);
    }
  }

  for (const track of tracks) paintTrack(track);
  orderRows(tracks);
  paintStrip(tracks, state.totals);
  paintTransport(state, tracks);
  paintEmpty(state, tracks);
}

// Rows are created once, so a renumbered playlist needs them re-sequenced.
function orderRows(tracks) {
  const body = $('rows');
  tracks.forEach((track, index) => {
    const entry = rows.get(track.id);
    if (entry && body.children[index] !== entry.tr) body.insertBefore(entry.tr, body.children[index] ?? null);
  });
}

function renderMeta(state, configured) {
  if (!configured) {
    setText($('meta'), '');
    return;
  }
  if (!metaA) {
    metaA = document.createElement('span');
    metaB = document.createElement('span');
    $('meta').append(metaA, metaB);
  }
  const count = state.tracks.length;
  setText(metaA, `${count} ${count === 1 ? 'track' : 'tracks'}`);
  setText(metaB, state.totals.bytes ? `${size(state.totals.bytes)} on disk` : '');
}

function paintTrack(track) {
  const entry = row(track);
  const state = view(track);

  setText(entry.index, pad2(track.position));
  setText(entry.tt, track.song);
  setText(entry.ar, track.artist || '');
  entry.ar.hidden = !track.artist;
  setText(entry.len, length(track.duration));

  entry.stateLine.className = `st ${state.cls}`;
  setText(entry.glyph, state.glyph);
  setText(entry.word, state.word);

  const determinate = state.percent !== null;
  entry.bar.hidden = !determinate && track.status !== 'transcoding';
  entry.bar.classList.toggle('indet', track.status === 'transcoding');
  entry.bar.setAttribute('aria-label', `Download progress for ${track.song}`);
  entry.fill.style.transform = determinate ? `scaleX(${state.percent})` : '';

  if (determinate) {
    entry.bar.setAttribute('aria-valuenow', String(Math.round(state.percent * 100)));
  } else {
    entry.bar.removeAttribute('aria-valuenow');
  }
  entry.bar.setAttribute('aria-valuetext', state.word);

  if (state.cls === 'done' || state.cls === 'fail') {
    if (announced.get(track.id) !== state.cls) {
      announced.set(track.id, state.cls);
      setText(
        $('live'),
        state.cls === 'done'
          ? `On disk: ${track.song}`
          : `Failed: ${track.song}. ${track.error || ''}`.trim(),
      );
    }
  } else {
    announced.delete(track.id);
  }
}

function paintStrip(tracks, totals) {
  const strip = $('strip');
  const signature = tracks.map((track) => track.id).join(',');

  if (signature !== stripSignature) {
    stripSignature = signature;
    strip.textContent = '';
    for (const track of tracks) {
      const segment = document.createElement('span');
      segment.className = 'seg';
      segment.dataset.id = track.id;
      // Unknown lengths share equally; known ones keep the tape proportional.
      segment.style.flexGrow = String(Math.max(1, track.duration || 1));
      strip.appendChild(segment);
    }
  }

  for (const track of tracks) {
    const segment = strip.querySelector(`.seg[data-id="${CSS.escape(track.id)}"]`);
    if (!segment) continue;
    const state = view(track);
    segment.className = `seg${state.cls === 'wait' ? '' : ` ${state.cls}`}`;
  }

  strip.setAttribute(
    'aria-label',
    `${totals.onDisk} of ${tracks.length} tracks on disk${totals.failed ? `, ${totals.failed} failed` : ''}`,
  );
}

function paintTransport(state, tracks) {
  const running = Boolean(state.run?.running);
  const failed = state.totals.failed;

  setText($('n-done'), String(state.totals.onDisk));
  setText($('n-todo'), String(state.totals.todo));
  setText($('n-fail'), String(failed));
  $('fail-readout').hidden = failed === 0;

  setText($('elapsed-lbl'), running ? 'elapsed' : 'last run');
  const total = Math.floor((state.run?.elapsedMs ?? 0) / 1000);
  const minutes = Math.min(99, Math.floor(total / 60));
  const digits = `${pad2(minutes)}${pad2(total % 60)}`;
  const cells = $('odo').querySelectorAll('.d');
  for (let index = 0; index < cells.length; index += 1) setText(cells[index], digits[index]);

  $('stop').hidden = !running;
  const button = $('download');
  button.disabled = running;
  setText(
    button,
    running ? 'Downloading…' : state.totals.todo > 0 ? `Download ${state.totals.todo} new` : 'Download new',
  );
}

function paintEmpty(state, tracks) {
  const empty = $('empty');
  empty.hidden = tracks.length > 0;
  if (tracks.length > 0) return;
  setText(
    empty,
    state.run?.running
      ? 'Reading the playlist…'
      : 'Nothing listed yet. Download new reads the playlist and fetches what is not here.',
  );
}

async function tick() {
  clearTimeout(timer);
  let running = false;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    const state = await response.json();
    running = Boolean(state.run?.running);
    render(state);
  } catch {
    $('banner').hidden = false;
    setText($('banner'), 'Lost the connection to Musico. Is the server still running?');
  }
  // Downloads finish faster than a slow poll can show, so sample tightly while one runs.
  timer = setTimeout(tick, running ? 300 : 1500);
}

$('setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const playlist = $('playlist-url').value.trim();
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playlist, cookiesFromBrowser: $('cookies').value || null }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    $('banner').hidden = false;
    setText($('banner'), body.error || 'Could not save that link.');
    return;
  }
  $('playlist-url').value = '';
  editing = false;
  const started = await fetch('/api/sync', { method: 'POST' });
  if (!started.ok) {
    const error = await started.json().catch(() => ({}));
    $('banner').hidden = false;
    setText($('banner'), error.error || 'Could not start the download.');
  }
  tick();
});

$('cookies').addEventListener('change', async () => {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookiesFromBrowser: $('cookies').value || null }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    $('banner').hidden = false;
    setText($('banner'), body.error || 'Could not save that setting.');
  }
});

$('change').addEventListener('click', () => {
  editing = true;
  $('setup').hidden = false;
  $('change').hidden = true;
  $('cancel-change').hidden = false;
  $('playlist-url').focus();
});

$('cancel-change').addEventListener('click', () => {
  editing = false;
  $('playlist-url').value = '';
  tick();
});

$('stop').addEventListener('click', async () => {
  const response = await fetch('/api/stop', { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    $('banner').hidden = false;
    setText($('banner'), body.error || 'Could not stop the download.');
  }
  tick();
});

$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  const response = await fetch('/api/sync', { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    $('banner').hidden = false;
    setText($('banner'), body.error || 'Could not start the download.');
  }
  tick();
});

tick();

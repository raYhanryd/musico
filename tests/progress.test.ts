import { expect, test } from 'bun:test';
import { parseProgressLine } from '../src/core/download';

test('reads a download progress line and falls back to the size estimate', () => {
  expect(parseProgressLine('MUSICO-DL|downloading|1234|NA|5678|123.5')).toEqual({
    kind: 'download',
    status: 'downloading',
    downloaded: 1234,
    total: 5678,
    speed: 123.5,
  });
});

test('reads the begin line so the duration can be recorded', () => {
  expect(parseProgressLine('MUSICO-BEGIN dQw4w9WgXcQ 213')).toEqual({
    kind: 'begin',
    id: 'dQw4w9WgXcQ',
    duration: 213,
  });
});

test('reads a begin line with no duration', () => {
  expect(parseProgressLine('MUSICO-BEGIN dQw4w9WgXcQ NA')).toEqual({
    kind: 'begin',
    id: 'dQw4w9WgXcQ',
    duration: null,
  });
});

test('reads the transcode line', () => {
  expect(parseProgressLine('MUSICO-PP ExtractAudio')).toEqual({ kind: 'transcode' });
});

test('reads the done line including a path with spaces', () => {
  expect(parseProgressLine('MUSICO-DONE /Users/ray/Musico/downloads/My Mix/Song [abc].mp3')).toEqual({
    kind: 'done',
    file: '/Users/ray/Musico/downloads/My Mix/Song [abc].mp3',
  });
});

test('ignores anything yt-dlp prints that is not ours', () => {
  expect(parseProgressLine('[youtube] Extracting URL')).toBeNull();
});

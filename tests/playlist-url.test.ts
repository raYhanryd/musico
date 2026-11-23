import { expect, test } from 'bun:test';
import { invalidPlaylistUrl } from '../src/core/ytmusic';

test('accepts YouTube Music and plain YouTube playlist links', () => {
  expect(invalidPlaylistUrl('https://music.youtube.com/playlist?list=PL123')).toBeNull();
  expect(invalidPlaylistUrl('https://www.youtube.com/playlist?list=PL123')).toBeNull();
});

test('asks for a link, then for a readable one', () => {
  expect(invalidPlaylistUrl('')).toBe('Paste a playlist link.');
  expect(invalidPlaylistUrl('not a link')).toBe('That is not a link Musico can read.');
  expect(invalidPlaylistUrl('ftp://music.youtube.com/playlist?list=PL123')).toBe('Use an https link.');
  expect(invalidPlaylistUrl('http://music.youtube.com/playlist?list=PL123')).toBe('Use an https link.');
});

test('accepts only youtube.com and only with a playlist id', () => {
  expect(invalidPlaylistUrl('https://music.youtube.com.evil.example/playlist?list=PL123')).toBe(
    'Use a music.youtube.com playlist link.',
  );
  expect(invalidPlaylistUrl('https://music.youtube.com/watch?v=abc')).toBe(
    'That link has no playlist id. Use the playlist share link.',
  );
});

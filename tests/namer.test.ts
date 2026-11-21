import { describe, expect, test } from 'bun:test';
import { fileName, sanitizeName, splitTitle } from '../src/core/download';

describe('sanitizeName', () => {
  test('replaces path separators so a title cannot escape the folder', () => {
    expect(sanitizeName('AC/DC: Back in Black')).toBe('AC-DC Back in Black');
  });

  test('drops characters macOS rejects and trims leftover space', () => {
    expect(sanitizeName('Song <live> "take" 2?')).toBe('Song live take 2');
  });

  test('clamps long titles so the id still fits in a 255 byte name', () => {
    expect(sanitizeName('x'.repeat(400)).length).toBe(180);
  });

  test('falls back to a usable name when everything was stripped', () => {
    expect(sanitizeName('///')).toBe('untitled');
  });

  test('strips percent signs that would break the yt-dlp output template', () => {
    expect(fileName({ id: 'x1', title: '100% Pure' })).toBe('100 Pure [x1].mp3');
  });
});

describe('fileName', () => {
  test('keeps the video id in the name so dedupe survives a lost database', () => {
    expect(fileName({ id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up' })).toBe(
      'Rick Astley - Never Gonna Give You Up [dQw4w9WgXcQ].mp3',
    );
  });
});

describe('splitTitle', () => {
  test('splits the artist off a YouTube Music display title', () => {
    expect(splitTitle('The Weeknd - Blinding Lights')).toEqual({
      artist: 'The Weeknd',
      song: 'Blinding Lights',
    });
  });

  test('treats a title with no separator as the song', () => {
    expect(splitTitle('Untitled Demo')).toEqual({ artist: '', song: 'Untitled Demo' });
  });

  test('accepts en and em dashes as the separator', () => {
    expect(splitTitle('Sade – No Ordinary Love')).toEqual({
      artist: 'Sade',
      song: 'No Ordinary Love',
    });
  });
});

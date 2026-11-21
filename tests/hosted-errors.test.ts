import { expect, test } from 'bun:test';
import { friendlyError } from '../src/core/download';

const blocked =
  '[youtube] fOT0BUpITw8: Failed to extract any player response; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U';

test('hosted mode explains the IP block instead of the raw extractor error', () => {
  const message = friendlyError(blocked, true);
  expect(message).not.toContain('please report this issue');
  expect(message.toLowerCase()).toContain('server');
});

test('hosted mode maps the bot wall to the same explanation', () => {
  const message = friendlyError("ERROR: [youtube] x: Sign in to confirm you're not a bot", true);
  expect(message.toLowerCase()).toContain('server');
});

test('hosted mode does not send visitors to the local config file', () => {
  const message = friendlyError('ERROR: This playlist is private', true);
  expect(message).not.toContain('musico.config.json');
  expect(message.toLowerCase()).toContain('public');
});

test('local mode keeps its local advice', () => {
  expect(friendlyError("ERROR: Sign in to confirm you're not a bot")).toContain('cookiesFromBrowser');
});

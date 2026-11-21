import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePlaybackObserver, observerCredentialsConfigured, parseObserverTokens } from '../apps/node-service/src/playback-observer-auth.ts';
const alpha = 'alpha-' + 'a'.repeat(38);
const beta = 'beta-' + 'b'.repeat(38);
const config = JSON.stringify({observer_a: alpha, observer_b: beta});
const env = { TSM_PLAYBACK_OBSERVER_TOKENS: config, TSM_PLAYBACK_OBSERVER_TOKEN: 'legacy-' + 'x'.repeat(40) };

test('only the token belonging to report observerId is authorized', () => {
  assert.equal(authorizePlaybackObserver({ observerId:'observer_a' },alpha,env),true);
  assert.equal(authorizePlaybackObserver({ observerId:'observer_b' },beta,env),true);
  assert.equal(authorizePlaybackObserver({ observerId:'observer_b' },alpha,env),false);
  assert.equal(authorizePlaybackObserver({ observerId:'observer_a' },beta,env),false);
  assert.equal(authorizePlaybackObserver({},alpha,env),false);
  assert.equal(authorizePlaybackObserver({ observerId:'unknown' },alpha,env),false);
});
test('malformed per-worker credentials fail closed and never revert to shared secret', () => {
  for (const raw of ['{oops', '{}', '[]', JSON.stringify({observer_a:'short'}), JSON.stringify({observer_a:alpha,observer_b:alpha}), JSON.stringify({'../../other':alpha})]) {
    assert.equal(parseObserverTokens(raw),null);
    assert.equal(authorizePlaybackObserver({observerId:'observer_a'},env.TSM_PLAYBACK_OBSERVER_TOKEN,{...env,TSM_PLAYBACK_OBSERVER_TOKENS:raw}),false);
    assert.equal(observerCredentialsConfigured({...env,TSM_PLAYBACK_OBSERVER_TOKENS:raw}),false);
  }
});
test('legacy secret remains usable until per-observer credentials are configured', () => {
  const legacy = { TSM_PLAYBACK_OBSERVER_TOKEN: 'legacy-' + 'x'.repeat(40) };
  assert.equal(authorizePlaybackObserver({},legacy.TSM_PLAYBACK_OBSERVER_TOKEN,legacy),true);
  assert.equal(authorizePlaybackObserver({observerId:'worker_b'},legacy.TSM_PLAYBACK_OBSERVER_TOKEN,legacy),true);
  assert.equal(authorizePlaybackObserver({},'short',legacy),false);
  assert.equal(observerCredentialsConfigured(legacy),true);
});
test('rejects overly large tokens and unsafe observer names', () => {
  assert.equal(parseObserverTokens(JSON.stringify({observer_a:'x'.repeat(513)})),null);
  assert.equal(authorizePlaybackObserver({observerId:'observer_a'},'x'.repeat(513),env),false);
  assert.equal(parseObserverTokens(JSON.stringify({observer_a:alpha}))?.get('observer_a'),alpha);
});

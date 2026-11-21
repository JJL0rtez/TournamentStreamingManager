import test from 'node:test';
import assert from 'node:assert/strict';
import { nextObserverRestart, SUPERVISION } from '../packages/playback-observer/supervision.mjs';
test('observer restart backs off and exhausts after bounded failures', () => {
  let attempts = [];
  for(let i=0; i<SUPERVISION.maxRestarts; i++) {
    const result=nextObserverRestart(attempts,1_000_000+i*1000,100);
    assert.equal(result.allowed,true);
    assert.equal(result.delayMs,Math.min(30_000,2000*2**i));
    attempts=result.attempts;
  }
  assert.equal(nextObserverRestart(attempts,1_006_000,100).allowed,false);
});
test('window expiry and a healthy sustained run reset restart budget', () => {
  const history=[1000,1100,1200,1300,1400];
  assert.equal(nextObserverRestart(history,2000,100).allowed,false);
  assert.equal(nextObserverRestart(history,700_000,100).allowed,true);
  assert.equal(nextObserverRestart(history,2000,SUPERVISION.healthyResetMs).delayMs,2000);
});
test('reject invalid state',()=> {
  assert.throws(()=>nextObserverRestart([1],Number.NaN,0));
  assert.throws(()=>nextObserverRestart([1],100,-1));
});

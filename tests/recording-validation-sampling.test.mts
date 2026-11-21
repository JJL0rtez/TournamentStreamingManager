import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSegmentSamples } from '../apps/node-service/src/recording-sampling.ts';

test('sampling includes first and last segment', () => {
  const result = selectSegmentSamples(Array.from({length: 100}, (_, i) => i), 5);
  assert.deepEqual(result, [0,24,49,74,99]);
});
test('small recordings are fully inspected', () => {
  assert.deepEqual(selectSegmentSamples([0,1,2],40),[0,1,2]);
});
test('single sample inspects the most recent segment', () => {
  assert.deepEqual(selectSegmentSamples([0,1,2],1),[2]);
});
test('invalid sampling limits are rejected', () => {
  for (const limit of [0,-1,1.5,201,NaN]) assert.throws(() => selectSegmentSamples([1],limit));
});
test('sampling never duplicates segments', () => {
  const result = selectSegmentSamples(Array.from({length: 201}, (_, i) => i),200);
  assert.equal(new Set(result).size,200);
});

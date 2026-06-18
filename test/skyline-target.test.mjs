import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedValueToIndex, normalizedValueToSample } from '../skyline-target.mjs';

test('maps normalized pitch endpoints to skyline endpoints', () => {
  assert.deepEqual(normalizedValueToSample(0, 70), {
    lowerIndex: 0,
    upperIndex: 1,
    mix: 0
  });
  assert.deepEqual(normalizedValueToSample(1, 70), {
    lowerIndex: 69,
    upperIndex: 69,
    mix: 0
  });
});

test('maps normalized pitch midpoint between the center buildings', () => {
  assert.deepEqual(normalizedValueToSample(0.5, 70), {
    lowerIndex: 34,
    upperIndex: 35,
    mix: 0.5
  });
});

test('maps normalized pitch to the nearest skyline building', () => {
  assert.equal(normalizedValueToIndex(0, 70), 0);
  assert.equal(normalizedValueToIndex(1, 70), 69);
  assert.equal(normalizedValueToIndex(0.5, 70), 35);
});

test('switches buildings at the midpoint between adjacent targets', () => {
  const midpoint = 0.5 / 69;

  assert.equal(normalizedValueToIndex(midpoint - 1e-6, 70), 0);
  assert.equal(normalizedValueToIndex(midpoint, 70), 1);
  assert.equal(normalizedValueToIndex(midpoint + 1e-6, 70), 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedValueToSample } from '../skyline-target.mjs';

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

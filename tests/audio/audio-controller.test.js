import assert from 'node:assert/strict';
import test from 'node:test';
import { findStableWaveformStart } from '../../src/audio/audio-controller.js';

test('centers the waveform on the nearest rising zero crossing', () => {
  const samples = new Float32Array([-1, -0.5, 0.5, 1, -1, -0.25, 0.25, 1]);
  assert.equal(findStableWaveformStart(samples, 4), 2);
});

test('uses the midpoint when no rising zero crossing exists', () => {
  const samples = new Float32Array([1, 1, 1, 1, 1, 1]);
  assert.equal(findStableWaveformStart(samples, 2), 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFilterMultipliers,
  getBandCenterFrequency
} from '../../src/world/skyline/spectrum.js';

const CONFIG = { buildingCount: 70, minHz: 20, maxHz: 20000 };

test('maps skyline bands across the configured logarithmic range', () => {
  assert.ok(getBandCenterFrequency(0, CONFIG) > CONFIG.minHz);
  assert.ok(getBandCenterFrequency(69, CONFIG) > CONFIG.maxHz);
});

test('low-pass response attenuates high skyline bands more than low bands', () => {
  const response = computeFilterMultipliers(CONFIG, {
    type: 'lowpass',
    cutoff: 0.5,
    resonance: 0.1,
    gain: 0.5
  });
  assert.equal(response.length, CONFIG.buildingCount);
  assert.ok(response[0] > response.at(-1));
});

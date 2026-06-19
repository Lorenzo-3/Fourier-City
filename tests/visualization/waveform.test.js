import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWaveformDisplayBounds,
  mapWaveformSampleToY
} from '../../src/visualization/waveform.js';

const GLASS_BOX = {
  centerX: 0,
  centerY: 1.8,
  centerZ: -0.5,
  width: 3,
  height: 1.1
};

test('derives waveform bounds with a margin inside the glass box', () => {
  const bounds = createWaveformDisplayBounds(GLASS_BOX);

  assert.ok(bounds.minX > GLASS_BOX.centerX - GLASS_BOX.width / 2);
  assert.ok(bounds.maxX < GLASS_BOX.centerX + GLASS_BOX.width / 2);
  assert.ok(bounds.minY > GLASS_BOX.centerY - GLASS_BOX.height / 2);
  assert.ok(bounds.maxY < GLASS_BOX.centerY + GLASS_BOX.height / 2);
});

test('soft-limits a +18 dB boosted waveform inside the display bounds', () => {
  const bounds = createWaveformDisplayBounds(GLASS_BOX);
  const peakingGain = 10 ** (18 / 20);
  const samples = [-1, -0.5, 0, 0.5, 1].map(sample => sample * peakingGain);
  const positions = samples.map(sample => mapWaveformSampleToY(sample, bounds));

  for (const y of positions) {
    assert.ok(Number.isFinite(y));
    assert.ok(y >= bounds.minY, `${y} fell below ${bounds.minY}`);
    assert.ok(y <= bounds.maxY, `${y} exceeded ${bounds.maxY}`);
  }

  assert.ok(positions[1] < positions[2]);
  assert.ok(positions[2] < positions[3]);
});

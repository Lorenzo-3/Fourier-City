import assert from 'node:assert/strict';
import test from 'node:test';
import {
  frequencyToNormalizedPitch,
  normalizedPitchToFrequency,
  normalizedPitchToPlaybackRate
} from '../pitch-control.mjs';
import {
  createPeriodicOscillator,
  FUNDAMENTAL_HZ,
  PROCEDURAL_SIGNALS
} from '../procedural-signals.js';

test('maps the music pitch knob to playback speed', () => {
  assert.equal(normalizedPitchToPlaybackRate(0), 0.5);
  assert.equal(normalizedPitchToPlaybackRate(0.5), 1);
  assert.equal(normalizedPitchToPlaybackRate(1), 1.5);
});

test('maps the periodic pitch knob to a logarithmic frequency range', () => {
  assert.equal(normalizedPitchToFrequency(0), 20);
  assert.ok(Math.abs(normalizedPitchToFrequency(1) - 20000) < 1e-9);

  const defaultPitchValue = frequencyToNormalizedPitch(FUNDAMENTAL_HZ);
  assert.ok(Math.abs(normalizedPitchToFrequency(defaultPitchValue) - FUNDAMENTAL_HZ) < 1e-9);
});

test('creates periodic signals as oscillators at the requested frequency', () => {
  const context = createMockAudioContext();
  const frequency = normalizedPitchToFrequency(0.5);

  for (const signal of [
    PROCEDURAL_SIGNALS.sine,
    PROCEDURAL_SIGNALS.square,
    PROCEDURAL_SIGNALS.triangle,
    PROCEDURAL_SIGNALS.saw,
    PROCEDURAL_SIGNALS.rich
  ]) {
    const oscillator = createPeriodicOscillator(context, signal, frequency);
    assert.ok(Math.abs(oscillator.frequency.value - frequency) < 1e-9);
  }

  assert.equal(context.oscillators[0].type, 'sine');
  assert.equal(context.oscillators[1].type, 'square');
  assert.equal(context.oscillators[2].type, 'triangle');
  assert.equal(context.oscillators[3].type, 'sawtooth');
  assert.ok(context.oscillators[4].periodicWave);
});

test('rejects oscillator creation for non-periodic noise', () => {
  assert.throws(
    () => createPeriodicOscillator(createMockAudioContext(), PROCEDURAL_SIGNALS.noise),
    /non-periodic/
  );
});

function createMockAudioContext() {
  const oscillators = [];

  return {
    oscillators,
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        type: 'sine',
        periodicWave: null,
        setPeriodicWave(periodicWave) {
          this.periodicWave = periodicWave;
        }
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createPeriodicWave(real, imaginary) {
      return { real, imaginary };
    }
  };
}

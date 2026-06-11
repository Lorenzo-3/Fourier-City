import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizedPitchToFrequencyRatio,
  normalizedPitchToSemitones
} from '../pitch-control.mjs';
import {
  createPeriodicOscillator,
  FUNDAMENTAL_HZ,
  PROCEDURAL_SIGNALS
} from '../procedural-signals.js';

test('maps the pitch knob from one octave down to one octave up', () => {
  assert.equal(normalizedPitchToSemitones(0), -12);
  assert.equal(normalizedPitchToSemitones(0.5), 0);
  assert.equal(normalizedPitchToSemitones(1), 12);
  assert.equal(normalizedPitchToFrequencyRatio(0), 0.5);
  assert.equal(normalizedPitchToFrequencyRatio(0.5), 1);
  assert.equal(normalizedPitchToFrequencyRatio(1), 2);
});

test('creates periodic signals as oscillators at the requested frequency', () => {
  const context = createMockAudioContext();

  for (const signal of [
    PROCEDURAL_SIGNALS.sine,
    PROCEDURAL_SIGNALS.square,
    PROCEDURAL_SIGNALS.triangle,
    PROCEDURAL_SIGNALS.saw,
    PROCEDURAL_SIGNALS.rich
  ]) {
    const frequency = FUNDAMENTAL_HZ * normalizedPitchToFrequencyRatio(1);
    const oscillator = createPeriodicOscillator(context, signal, frequency);
    assert.equal(oscillator.frequency.value, 440);
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

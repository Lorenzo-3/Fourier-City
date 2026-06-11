import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PhaseVocoderPitchShifter,
  semitonesToPitchRatio
} from '../public/audio/pitch-shifter-core.mjs';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;

test('shifts pitch by -12, 0, and +12 semitones without changing sample count', () => {
  for (const semitones of [-12, 0, 12]) {
    const input = createSineWave(440, 3);
    const output = processInBlocks(input, semitonesToPitchRatio(semitones));
    const measuredFrequency = estimateFrequencyFromZeroCrossings(
      output.subarray(SAMPLE_RATE, SAMPLE_RATE * 2.75)
    );
    const expectedFrequency = 440 * semitonesToPitchRatio(semitones);

    assert.equal(output.length, input.length);
    assert.ok(
      Math.abs(measuredFrequency - expectedFrequency) / expectedFrequency < 0.03,
      `${semitones} st produced ${measuredFrequency.toFixed(1)} Hz instead of ${expectedFrequency} Hz`
    );
  }
});

test('shifts the fundamental of harmonic-rich audio', () => {
  for (const semitones of [-12, 0, 12]) {
    const input = createHarmonicWave(220, 3);
    const output = processInBlocks(input, semitonesToPitchRatio(semitones));
    const expectedFrequency = 220 * semitonesToPitchRatio(semitones);
    const measuredFrequency = estimatePeakNear(
      output.subarray(SAMPLE_RATE, SAMPLE_RATE * 2.75),
      expectedFrequency,
      35
    );

    assert.equal(output.length, input.length);
    assert.ok(
      Math.abs(measuredFrequency - expectedFrequency) / expectedFrequency < 0.03,
      `${semitones} st produced a ${measuredFrequency.toFixed(1)} Hz fundamental instead of ${expectedFrequency} Hz`
    );
  }
});

test('produces finite, stable mono and stereo output during pitch changes', () => {
  const leftInput = createSineWave(220, 2);
  const rightInput = createSineWave(330, 2);
  const leftShifter = new PhaseVocoderPitchShifter(SAMPLE_RATE);
  const rightShifter = new PhaseVocoderPitchShifter(SAMPLE_RATE);
  const leftOutput = new Float32Array(leftInput.length);
  const rightOutput = new Float32Array(rightInput.length);

  for (let offset = 0; offset < leftInput.length; offset += BLOCK_SIZE) {
    const end = Math.min(offset + BLOCK_SIZE, leftInput.length);
    const progress = offset / leftInput.length;
    const pitchRatio = semitonesToPitchRatio(-12 + progress * 24);
    leftShifter.process(leftInput.subarray(offset, end), pitchRatio, leftOutput.subarray(offset, end));
    rightShifter.process(rightInput.subarray(offset, end), pitchRatio, rightOutput.subarray(offset, end));
  }

  assert.equal(leftOutput.length, leftInput.length);
  assert.equal(rightOutput.length, rightInput.length);
  assertFiniteAndStable(leftOutput);
  assertFiniteAndStable(rightOutput);
});

function createSineWave(frequency, durationSeconds) {
  const samples = new Float32Array(SAMPLE_RATE * durationSeconds);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE) * 0.5;
  }
  return samples;
}

function createHarmonicWave(frequency, durationSeconds) {
  const samples = new Float32Array(SAMPLE_RATE * durationSeconds);
  for (let index = 0; index < samples.length; index += 1) {
    const phase = 2 * Math.PI * frequency * index / SAMPLE_RATE;
    samples[index] = (
      Math.sin(phase) * 0.45
      + Math.sin(phase * 2) * 0.22
      + Math.sin(phase * 3) * 0.12
      + Math.sin(phase * 5) * 0.06
    );
  }
  return samples;
}

function processInBlocks(input, pitchRatio) {
  const shifter = new PhaseVocoderPitchShifter(SAMPLE_RATE);
  const output = new Float32Array(input.length);

  for (let offset = 0; offset < input.length; offset += BLOCK_SIZE) {
    const end = Math.min(offset + BLOCK_SIZE, input.length);
    shifter.process(input.subarray(offset, end), pitchRatio, output.subarray(offset, end));
  }

  return output;
}

function estimateFrequencyFromZeroCrossings(samples) {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) crossings += 1;
  }
  return crossings / (samples.length / SAMPLE_RATE);
}

function estimatePeakNear(samples, centerFrequency, radius) {
  let peakFrequency = centerFrequency;
  let peakMagnitude = -Infinity;

  for (
    let frequency = Math.max(20, centerFrequency - radius);
    frequency <= centerFrequency + radius;
    frequency += 1
  ) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < samples.length; index += 4) {
      const phase = 2 * Math.PI * frequency * index / SAMPLE_RATE;
      real += samples[index] * Math.cos(phase);
      imaginary -= samples[index] * Math.sin(phase);
    }
    const magnitude = real * real + imaginary * imaginary;
    if (magnitude > peakMagnitude) {
      peakMagnitude = magnitude;
      peakFrequency = frequency;
    }
  }

  return peakFrequency;
}

function assertFiniteAndStable(samples) {
  let peak = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
  }
  assert.ok(peak > 0.01, 'output should contain an audible signal');
  assert.ok(peak < 2, `output peak ${peak} indicates unstable processing`);
}

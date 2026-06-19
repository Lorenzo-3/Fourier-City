export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 1.5;
export const MIN_PITCH_FREQUENCY_HZ = 20;
export const MAX_PITCH_FREQUENCY_HZ = 20000;

export function normalizedPitchToPlaybackRate(value) {
  return MIN_PLAYBACK_RATE
    + clampNormalizedValue(value) * (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE);
}

export function normalizedPitchToFrequency(value) {
  return MIN_PITCH_FREQUENCY_HZ
    * ((MAX_PITCH_FREQUENCY_HZ / MIN_PITCH_FREQUENCY_HZ) ** clampNormalizedValue(value));
}

export function frequencyToNormalizedPitch(frequency) {
  const clampedFrequency = Math.min(
    MAX_PITCH_FREQUENCY_HZ,
    Math.max(MIN_PITCH_FREQUENCY_HZ, Number.isFinite(frequency) ? frequency : MIN_PITCH_FREQUENCY_HZ)
  );
  return Math.log(clampedFrequency / MIN_PITCH_FREQUENCY_HZ)
    / Math.log(MAX_PITCH_FREQUENCY_HZ / MIN_PITCH_FREQUENCY_HZ);
}

function clampNormalizedValue(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

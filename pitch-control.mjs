export const MIN_PITCH_SEMITONES = -12;
export const MAX_PITCH_SEMITONES = 12;

export function normalizedPitchToSemitones(value) {
  return MIN_PITCH_SEMITONES
    + clampNormalizedValue(value) * (MAX_PITCH_SEMITONES - MIN_PITCH_SEMITONES);
}

export function semitonesToFrequencyRatio(semitones) {
  return 2 ** (semitones / 12);
}

export function normalizedPitchToFrequencyRatio(value) {
  return semitonesToFrequencyRatio(normalizedPitchToSemitones(value));
}

function clampNormalizedValue(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

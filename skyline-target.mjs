export function normalizedValueToSample(value, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    return null;
  }

  const normalizedValue = clampNormalizedValue(value);
  const position = normalizedValue * (itemCount - 1);
  const lowerIndex = Math.floor(position);

  return {
    lowerIndex,
    upperIndex: Math.min(itemCount - 1, lowerIndex + 1),
    mix: position - lowerIndex
  };
}

function clampNormalizedValue(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

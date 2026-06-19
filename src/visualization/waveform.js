export const DEFAULT_WAVEFORM_MARGIN = 0.08;
export const DEFAULT_WAVEFORM_SOFT_LIMIT_DRIVE = 1.25;

export function createWaveformDisplayBounds({
  centerX,
  centerY,
  centerZ,
  width,
  height,
  margin = DEFAULT_WAVEFORM_MARGIN
}) {
  const horizontalMargin = Math.min(margin, width / 2);
  const verticalMargin = Math.min(margin, height / 2);

  return {
    centerY,
    z: centerZ,
    minX: centerX - width / 2 + horizontalMargin,
    maxX: centerX + width / 2 - horizontalMargin,
    minY: centerY - height / 2 + verticalMargin,
    maxY: centerY + height / 2 - verticalMargin
  };
}

export function mapWaveformSampleToY(
  sample,
  bounds,
  drive = DEFAULT_WAVEFORM_SOFT_LIMIT_DRIVE
) {
  const halfHeight = Math.max(0, (bounds.maxY - bounds.minY) / 2);
  const safeSample = Number.isFinite(sample) ? sample : 0;
  return bounds.centerY + Math.tanh(safeSample * drive) * halfHeight;
}

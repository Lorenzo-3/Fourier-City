import * as THREE from 'three';

const COLOR_ANCHORS = [
  { frequency: 20, color: new THREE.Color(0x3b3bff) },
  { frequency: 40, color: new THREE.Color(0x3b7bff) },
  { frequency: 80, color: new THREE.Color(0x3bcbff) },
  { frequency: 160, color: new THREE.Color(0x3bffcb) },
  { frequency: 300, color: new THREE.Color(0x7bff3b) },
  { frequency: 600, color: new THREE.Color(0xcbff3b) },
  { frequency: 1200, color: new THREE.Color(0xffcb3b) },
  { frequency: 2400, color: new THREE.Color(0xff7b3b) },
  { frequency: 5000, color: new THREE.Color(0xff3b5b) },
  { frequency: 10000, color: new THREE.Color(0xff3bab) },
  { frequency: 20000, color: new THREE.Color(0xbf3bff) }
];

export function getBandCenterFrequency(index, config) {
  const ratio = (config.maxHz / config.minHz) ** (1 / (config.buildingCount - 1));
  return config.minHz * ratio ** (index + 0.5);
}

export function computeFilterMultipliers(config, filterState) {
  const multipliers = new Float32Array(config.buildingCount).fill(1);
  if (!filterState?.type) return multipliers;

  const cutoff = Math.exp(
    Math.log(20) + filterState.cutoff * (Math.log(20000) - Math.log(20))
  );
  const resonance = 0.1 + filterState.resonance * 19.9;
  const amplitude = 10 ** ((-18 + filterState.gain * 36) / 40);

  for (let index = 0; index < config.buildingCount; index += 1) {
    const ratio = getBandCenterFrequency(index, config) / cutoff;
    const base = (1 - ratio * ratio) ** 2;
    let magnitude = 1;
    if (filterState.type === 'lowpass') {
      magnitude = 1 / Math.sqrt(base + (ratio / resonance) ** 2);
    } else if (filterState.type === 'highpass') {
      magnitude = ratio ** 2 / Math.sqrt(base + (ratio / resonance) ** 2);
    } else if (filterState.type === 'bandpass') {
      magnitude = (ratio / resonance) / Math.sqrt(base + (ratio / resonance) ** 2);
    } else if (filterState.type === 'peaking') {
      const numerator = base + (ratio * amplitude / resonance) ** 2;
      const denominator = base + (ratio / (amplitude * resonance)) ** 2;
      magnitude = Math.sqrt(numerator / denominator);
    }
    multipliers[index] = Math.max(0, Math.min(magnitude, 10));
  }
  return multipliers;
}

export function buildBaseBuildingColors(config, target) {
  const color = new THREE.Color();
  for (let index = 0; index < config.buildingCount; index += 1) {
    const ratio = config.buildingCount > 1 ? index / (config.buildingCount - 1) : 0;
    const frequency = config.minHz * (config.maxHz / config.minHz) ** ratio;
    sampleSpectrumColor(frequency, color);
    const offset = index * 3;
    target[offset] = color.r;
    target[offset + 1] = color.g;
    target[offset + 2] = color.b;
  }
}

export function sampleSpectrumColor(frequency, target) {
  const clamped = THREE.MathUtils.clamp(
    frequency,
    COLOR_ANCHORS[0].frequency,
    COLOR_ANCHORS.at(-1).frequency
  );
  for (let index = 1; index < COLOR_ANCHORS.length; index += 1) {
    const lower = COLOR_ANCHORS[index - 1];
    const upper = COLOR_ANCHORS[index];
    if (clamped <= upper.frequency) {
      const ratio = (Math.log(clamped) - Math.log(lower.frequency))
        / (Math.log(upper.frequency) - Math.log(lower.frequency));
      return target.copy(lower.color).lerp(upper.color, ratio);
    }
  }
  return target.copy(COLOR_ANCHORS.at(-1).color);
}

export function buildLogFrequencyBands(sampleRate, fftSize, frequencyBinCount, bandCount) {
  const breakpoints = [20, 40, 80, 160, 300, 600, 1200, 2400, 5000, 10000, 20000];
  const rangeCount = breakpoints.length - 1;
  const nyquist = sampleRate / 2;
  const hzPerBin = sampleRate / fftSize;
  const clampedBreakpoints = breakpoints.map((frequency) => Math.min(frequency, nyquist));
  const bandsPerRange = new Array(rangeCount).fill(0);
  let remaining = bandCount;

  for (let index = 0; index < rangeCount; index += 1) {
    const weight = Math.log(clampedBreakpoints[index + 1]) - Math.log(clampedBreakpoints[index]);
    bandsPerRange[index] = Math.max(
      1,
      Math.round(weight * bandCount / (Math.log(nyquist) - Math.log(20)))
    );
    remaining -= bandsPerRange[index];
  }
  for (let index = 0; index < remaining; index += 1) bandsPerRange[index % rangeCount] += 1;

  const bands = [];
  for (let range = 0; range < rangeCount; range += 1) {
    const lowHz = clampedBreakpoints[range];
    const highHz = clampedBreakpoints[range + 1];
    const count = bandsPerRange[range];
    for (let subrange = 0; subrange < count; subrange += 1) {
      const ratio = subrange / count;
      const frequency = Math.exp(Math.log(lowHz) + ratio * (Math.log(highHz) - Math.log(lowHz)));
      const startBin = Math.max(1, Math.floor(frequency / hzPerBin));
      let endBin;
      if (subrange === count - 1) {
        endBin = Math.min(frequencyBinCount - 1, Math.ceil(highHz / hzPerBin) - 1);
      } else {
        const nextRatio = (subrange + 1) / count;
        const nextFrequency = Math.exp(
          Math.log(lowHz) + nextRatio * (Math.log(highHz) - Math.log(lowHz))
        );
        endBin = Math.max(startBin, Math.floor(nextFrequency / hzPerBin) - 1);
      }
      endBin = Math.min(endBin, frequencyBinCount - 1);
      bands.push({ startBin, endBin, binCount: endBin - startBin + 1 });
    }
  }
  while (bands.length < bandCount) bands.push({ startBin: 1, endBin: 1, binCount: 1 });
  return bands.slice(0, bandCount);
}

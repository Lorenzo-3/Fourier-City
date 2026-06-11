const TWO_PI = Math.PI * 2;

export class PhaseVocoderPitchShifter {
  constructor(sampleRate, {
    frameSize = 2048,
    oversampling = 4,
    smoothingSeconds = 0.04
  } = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error('PhaseVocoderPitchShifter requires a positive sample rate');
    }
    if ((frameSize & (frameSize - 1)) !== 0) {
      throw new Error('frameSize must be a power of two');
    }
    if (frameSize % oversampling !== 0) {
      throw new Error('frameSize must be divisible by oversampling');
    }

    this.sampleRate = sampleRate;
    this.frameSize = frameSize;
    this.oversampling = oversampling;
    this.stepSize = frameSize / oversampling;
    this.latency = frameSize - this.stepSize;
    this.frequencyPerBin = sampleRate / frameSize;
    this.expectedPhaseAdvance = TWO_PI * this.stepSize / frameSize;
    this.smoothingSeconds = smoothingSeconds;
    this.pitchRatio = 1;
    this.rover = this.latency;

    const halfFrame = frameSize / 2;
    this.inputFifo = new Float32Array(frameSize);
    this.outputFifo = new Float32Array(frameSize);
    this.fftWorkspace = new Float64Array(frameSize * 2);
    this.lastPhase = new Float64Array(halfFrame + 1);
    this.sumPhase = new Float64Array(halfFrame + 1);
    this.outputAccumulator = new Float64Array(frameSize * 2);
    this.analysisFrequency = new Float64Array(halfFrame + 1);
    this.analysisMagnitude = new Float64Array(halfFrame + 1);
    this.synthesisFrequency = new Float64Array(halfFrame + 1);
    this.synthesisMagnitude = new Float64Array(halfFrame + 1);
  }

  reset() {
    this.inputFifo.fill(0);
    this.outputFifo.fill(0);
    this.fftWorkspace.fill(0);
    this.lastPhase.fill(0);
    this.sumPhase.fill(0);
    this.outputAccumulator.fill(0);
    this.analysisFrequency.fill(0);
    this.analysisMagnitude.fill(0);
    this.synthesisFrequency.fill(0);
    this.synthesisMagnitude.fill(0);
    this.pitchRatio = 1;
    this.rover = this.latency;
  }

  process(input, targetPitchRatio = 1, output = new Float32Array(input.length)) {
    if (output.length !== input.length) {
      throw new Error('Pitch shifter input and output lengths must match');
    }

    const safeTarget = clamp(Number.isFinite(targetPitchRatio) ? targetPitchRatio : 1, 0.5, 2);
    const smoothingSamples = Math.max(1, this.sampleRate * this.smoothingSeconds);
    const smoothing = 1 - Math.exp(-input.length / smoothingSamples);
    this.pitchRatio += (safeTarget - this.pitchRatio) * smoothing;

    for (let index = 0; index < input.length; index += 1) {
      this.inputFifo[this.rover] = input[index];
      output[index] = this.outputFifo[this.rover - this.latency];
      this.rover += 1;

      if (this.rover >= this.frameSize) {
        this.rover = this.latency;
        this.processFrame(this.pitchRatio);
      }
    }

    return output;
  }

  processFrame(pitchRatio) {
    const {
      frameSize,
      oversampling,
      stepSize,
      latency,
      frequencyPerBin,
      expectedPhaseAdvance
    } = this;
    const halfFrame = frameSize / 2;

    for (let index = 0; index < frameSize; index += 1) {
      const window = 0.5 - 0.5 * Math.cos(TWO_PI * index / frameSize);
      this.fftWorkspace[index * 2] = this.inputFifo[index] * window;
      this.fftWorkspace[index * 2 + 1] = 0;
    }

    shortTimeFourierTransform(this.fftWorkspace, frameSize, -1);

    for (let bin = 0; bin <= halfFrame; bin += 1) {
      const real = this.fftWorkspace[bin * 2];
      const imaginary = this.fftWorkspace[bin * 2 + 1];
      const magnitude = 2 * Math.hypot(real, imaginary);
      const phase = Math.atan2(imaginary, real);
      let phaseDifference = phase - this.lastPhase[bin];
      this.lastPhase[bin] = phase;

      phaseDifference -= bin * expectedPhaseAdvance;
      phaseDifference = wrapPhase(phaseDifference);

      const binDeviation = oversampling * phaseDifference / TWO_PI;
      this.analysisMagnitude[bin] = magnitude;
      this.analysisFrequency[bin] = bin * frequencyPerBin + binDeviation * frequencyPerBin;
    }

    this.synthesisMagnitude.fill(0);
    this.synthesisFrequency.fill(0);

    for (let bin = 0; bin <= halfFrame; bin += 1) {
      const shiftedBin = Math.floor(bin * pitchRatio);
      if (shiftedBin <= halfFrame) {
        const magnitude = this.analysisMagnitude[bin];
        const totalMagnitude = this.synthesisMagnitude[shiftedBin] + magnitude;
        if (totalMagnitude > 0) {
          this.synthesisFrequency[shiftedBin] = (
            this.synthesisFrequency[shiftedBin] * this.synthesisMagnitude[shiftedBin]
            + this.analysisFrequency[bin] * pitchRatio * magnitude
          ) / totalMagnitude;
        }
        this.synthesisMagnitude[shiftedBin] = totalMagnitude;
      }
    }

    this.fftWorkspace.fill(0);

    for (let bin = 0; bin <= halfFrame; bin += 1) {
      const magnitude = this.synthesisMagnitude[bin];
      let frequencyDifference = this.synthesisFrequency[bin] - bin * frequencyPerBin;
      frequencyDifference /= frequencyPerBin;
      frequencyDifference = TWO_PI * frequencyDifference / oversampling;
      frequencyDifference += bin * expectedPhaseAdvance;
      this.sumPhase[bin] += frequencyDifference;

      this.fftWorkspace[bin * 2] = magnitude * Math.cos(this.sumPhase[bin]);
      this.fftWorkspace[bin * 2 + 1] = magnitude * Math.sin(this.sumPhase[bin]);
    }

    shortTimeFourierTransform(this.fftWorkspace, frameSize, 1);

    for (let index = 0; index < frameSize; index += 1) {
      const window = 0.5 - 0.5 * Math.cos(TWO_PI * index / frameSize);
      this.outputAccumulator[index] += (
        2 * window * this.fftWorkspace[index * 2]
      ) / (halfFrame * oversampling);
    }

    for (let index = 0; index < stepSize; index += 1) {
      this.outputFifo[index] = this.outputAccumulator[index];
    }

    this.outputAccumulator.copyWithin(0, stepSize);
    this.outputAccumulator.fill(0, frameSize, frameSize + stepSize);
    this.inputFifo.copyWithin(0, stepSize, stepSize + latency);
  }
}

export function semitonesToPitchRatio(semitones) {
  return 2 ** (semitones / 12);
}

function wrapPhase(phase) {
  return phase - TWO_PI * Math.round(phase / TWO_PI);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function shortTimeFourierTransform(buffer, frameSize, sign) {
  for (let index = 2; index < frameSize * 2 - 2; index += 2) {
    let bitReversed = 0;
    for (let bitMask = 2; bitMask < frameSize * 2; bitMask <<= 1) {
      if (index & bitMask) bitReversed += 1;
      bitReversed <<= 1;
    }

    if (index < bitReversed) {
      const real = buffer[index];
      const imaginary = buffer[index + 1];
      buffer[index] = buffer[bitReversed];
      buffer[index + 1] = buffer[bitReversed + 1];
      buffer[bitReversed] = real;
      buffer[bitReversed + 1] = imaginary;
    }
  }

  for (let butterflySize = 2; butterflySize < frameSize * 2; butterflySize <<= 1) {
    const stepSize = butterflySize << 1;
    const theta = sign * TWO_PI / butterflySize;
    const sineHalfTheta = Math.sin(theta * 0.5);
    const rotationReal = -2 * sineHalfTheta * sineHalfTheta;
    const rotationImaginary = Math.sin(theta);
    let twiddleReal = 1;
    let twiddleImaginary = 0;

    for (let butterfly = 0; butterfly < butterflySize; butterfly += 2) {
      for (let index = butterfly; index < frameSize * 2; index += stepSize) {
        const pairedIndex = index + butterflySize;
        const pairedReal = (
          twiddleReal * buffer[pairedIndex]
          - twiddleImaginary * buffer[pairedIndex + 1]
        );
        const pairedImaginary = (
          twiddleReal * buffer[pairedIndex + 1]
          + twiddleImaginary * buffer[pairedIndex]
        );

        buffer[pairedIndex] = buffer[index] - pairedReal;
        buffer[pairedIndex + 1] = buffer[index + 1] - pairedImaginary;
        buffer[index] += pairedReal;
        buffer[index + 1] += pairedImaginary;
      }

      const previousReal = twiddleReal;
      twiddleReal += previousReal * rotationReal - twiddleImaginary * rotationImaginary;
      twiddleImaginary += twiddleImaginary * rotationReal + previousReal * rotationImaginary;
    }
  }
}

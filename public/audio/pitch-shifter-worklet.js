import { PhaseVocoderPitchShifter } from './pitch-shifter-core.mjs';

class FourierCityPitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'pitchRatio',
      defaultValue: 1,
      minValue: 0.5,
      maxValue: 2,
      automationRate: 'k-rate'
    }];
  }

  constructor() {
    super();
    this.channelProcessors = [];
    this.port.onmessage = (event) => {
      if (event.data?.type === 'ping') {
        this.port.postMessage({ type: 'ready' });
      } else if (event.data?.type === 'reset') {
        for (const processor of this.channelProcessors) processor.reset();
      }
    };
  }

  process(inputs, outputs, parameters) {
    const inputChannels = inputs[0];
    const outputChannels = outputs[0];
    const pitchRatio = parameters.pitchRatio[0] ?? 1;

    for (let channel = 0; channel < outputChannels.length; channel += 1) {
      const output = outputChannels[channel];
      const input = inputChannels[channel] ?? inputChannels[0];

      if (!input) {
        output.fill(0);
        continue;
      }

      if (!this.channelProcessors[channel]) {
        this.channelProcessors[channel] = new PhaseVocoderPitchShifter(sampleRate);
      }

      this.channelProcessors[channel].process(input, pitchRatio, output);
    }

    return true;
  }
}

registerProcessor('fourier-city-pitch-shifter', FourierCityPitchShifterProcessor);

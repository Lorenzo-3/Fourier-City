const FUNDAMENTAL_HZ = 220;
const MAX_HZ = 10000;
const OUTPUT_LEVEL = 0.35;
const BUFFER_CYCLES = 220;
const DISPLAY_CYCLES = 4;
const NOISE_DISPLAY_SAMPLES = 1024;

export const PROCEDURAL_SIGNALS = Object.freeze({
    sine: Object.freeze({ id: 'sine', periodic: true }),
    square: Object.freeze({ id: 'square', periodic: true }),
    triangle: Object.freeze({ id: 'triangle', periodic: true }),
    saw: Object.freeze({ id: 'saw', periodic: true }),
    noise: Object.freeze({ id: 'noise', periodic: false }),
    rich: Object.freeze({ id: 'rich', periodic: true })
});

export function createProceduralSignal(audioContext, signal) {
    const definition = resolveSignal(signal);
    const sampleRate = audioContext.sampleRate;
    const periodSamples = Math.max(1, Math.round(sampleRate / FUNDAMENTAL_HZ));
    const fundamentalHz = sampleRate / periodSamples;
    const sampleCount = periodSamples * BUFFER_CYCLES;
    const samples = new Float32Array(sampleCount);

    if (definition.id === 'noise') {
        fillDeterministicNoise(samples);
    } else {
        fillPeriodicSignal(samples, definition.id, fundamentalHz, sampleRate);
    }

    normalizeSamples(samples);

    const buffer = audioContext.createBuffer(1, sampleCount, sampleRate);
    buffer.copyToChannel(samples, 0);

    return {
        buffer,
        visualizationSamples: definition.periodic
            ? copyPeriodicDisplaySamples(samples, periodSamples)
            : samples.slice(0, NOISE_DISPLAY_SAMPLES)
    };
}

function resolveSignal(signal) {
    const signalId = typeof signal === 'string' ? signal : signal?.id;
    const definition = PROCEDURAL_SIGNALS[signalId];

    if (!definition) {
        throw new Error(`Unknown procedural signal: ${signalId}`);
    }

    return definition;
}

function fillPeriodicSignal(samples, signalId, fundamentalHz, sampleRate) {
    const maxHarmonic = Math.max(1, Math.floor(MAX_HZ / fundamentalHz));
    const richAmplitudes = [1, 0.78, 0.62, 0.49, 0.38, 0.29, 0.22, 0.16];

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
        const phase = 2 * Math.PI * fundamentalHz * sampleIndex / sampleRate;
        let value = 0;

        switch (signalId) {
            case 'sine':
                value = Math.sin(phase);
                break;
            case 'square':
                for (let harmonic = 1; harmonic <= maxHarmonic; harmonic += 2) {
                    value += Math.sin(phase * harmonic) / harmonic;
                }
                break;
            case 'triangle':
                for (let harmonic = 1; harmonic <= maxHarmonic; harmonic += 2) {
                    const sign = harmonic % 4 === 1 ? 1 : -1;
                    value += sign * Math.sin(phase * harmonic) / (harmonic * harmonic);
                }
                break;
            case 'saw':
                for (let harmonic = 1; harmonic <= maxHarmonic; harmonic += 1) {
                    value += Math.sin(phase * harmonic) / harmonic;
                }
                break;
            case 'rich':
                for (let harmonic = 1; harmonic <= richAmplitudes.length; harmonic += 1) {
                    value += richAmplitudes[harmonic - 1] * Math.sin(phase * harmonic);
                }
                break;
        }

        samples[sampleIndex] = value;
    }
}

function fillDeterministicNoise(samples) {
    let state = 0x46f0c1a5;

    for (let index = 0; index < samples.length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        samples[index] = state / 0xffffffff * 2 - 1;
    }
}

function normalizeSamples(samples) {
    let peak = 0;

    for (let index = 0; index < samples.length; index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]));
    }

    const scale = peak > 0 ? OUTPUT_LEVEL / peak : 1;

    for (let index = 0; index < samples.length; index += 1) {
        samples[index] *= scale;
    }
}

function copyPeriodicDisplaySamples(samples, periodSamples) {
    const displayLength = periodSamples * DISPLAY_CYCLES;
    const displaySamples = new Float32Array(displayLength + 1);

    displaySamples.set(samples.subarray(0, displayLength));
    displaySamples[displayLength] = displaySamples[0];
    return displaySamples;
}

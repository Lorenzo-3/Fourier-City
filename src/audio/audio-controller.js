import * as THREE from 'three';
import {
  createPeriodicOscillator,
  createProceduralSignal,
  FUNDAMENTAL_HZ,
  PROCEDURAL_OUTPUT_LEVEL
} from './procedural-signals.js';
import {
  frequencyToNormalizedPitch,
  normalizedPitchToFrequency,
  normalizedPitchToPlaybackRate
} from './pitch-control.js';
import { mapWaveformSampleToY } from '../visualization/waveform.js';

const LIVE_WAVEFORM_POINTS = 2048;

export function createMp3Source(url) {
  return { kind: 'mp3', url };
}

export function createGeneratedSource(signal) {
  return { kind: 'procedural', signal };
}

export function createAudioController({ scene, listener, waveformBounds, attachSound }) {
  const sound = new THREE.PositionalAudio(listener);
  const audioLoader = new THREE.AudioLoader();
  attachSound(sound);

  let filters = null;
  let filtersInitialized = false;
  let waveformAnalyser = null;
  let waveformTimeData = null;
  let activePeriodicSource = null;
  let activeFilter = null;
  let waveformData = null;
  let currentSource = createMp3Source('assets/audio/default-track.mp3');
  let pitchValue = 0.5;
  let sourceRequestVersion = 1;
  let pendingSourceVersion = 1;
  let soundReady = false;
  let waveformReady = false;
  let waveformMesh = null;
  let paused = false;
  const filterValues = {
    cutoff: 0.5,
    gain: 0.5,
    resonance: 0.1
  };

  function initializeFilters() {
    if (filtersInitialized) return;
    const context = listener.context;
    if (!context) return;
    filters = {
      lowpass: context.createBiquadFilter(),
      highpass: context.createBiquadFilter(),
      bandpass: context.createBiquadFilter(),
      peaking: context.createBiquadFilter()
    };
    filters.lowpass.type = 'lowpass';
    filters.highpass.type = 'highpass';
    filters.bandpass.type = 'bandpass';
    filters.peaking.type = 'peaking';
    filters.lowpass.frequency.value = 20000;
    filters.highpass.frequency.value = 20;
    filters.bandpass.frequency.value = 1000;
    filters.peaking.frequency.value = 1000;
    filters.peaking.gain.value = 0;
    for (const filter of Object.values(filters)) filter.Q.value = 1;

    waveformAnalyser = context.createAnalyser();
    waveformAnalyser.fftSize = 2048;
    waveformAnalyser.smoothingTimeConstant = 0;
    waveformTimeData = new Float32Array(waveformAnalyser.fftSize);
    filtersInitialized = true;
  }

  function rewireAudioGraph() {
    if (!filtersInitialized || !waveformAnalyser) return;
    const processingNodes = [];
    if (activeFilter && filters?.[activeFilter]) processingNodes.push(filters[activeFilter]);
    processingNodes.push(waveformAnalyser);
    sound.setFilters(processingNodes);
  }

  function selectSource(source) {
    stopCurrentPlayback();
    resetWaveform();
    waveformData = null;
    currentSource = source;
    pitchValue = getPitchMode(source) === 'frequency'
      ? frequencyToNormalizedPitch(FUNDAMENTAL_HZ)
      : 0.5;
    sourceRequestVersion += 1;
    pendingSourceVersion = sourceRequestVersion;
    soundReady = false;
    waveformReady = false;
    paused = false;
    return pitchValue;
  }

  function stopCurrentPlayback() {
    if (activePeriodicSource) {
      if (sound._connected) sound.disconnect();
      if (activePeriodicSource.started) activePeriodicSource.oscillator.stop();
      activePeriodicSource.oscillator.disconnect();
      activePeriodicSource.gain.disconnect();
      activePeriodicSource = null;
      sound.isPlaying = false;
    } else {
      if (sound.isPlaying) sound.stop();
      if (sound._connected) sound.disconnect();
    }
    if (waveformData) waveformData.soundStarted = false;
  }

  function loadSource(source, requestVersion) {
    soundReady = false;
    waveformReady = false;
    initializeFilters();
    rewireAudioGraph();

    if (source.kind === 'procedural') {
      if (source.signal.periodic) {
        finishLoadingPeriodicSource(source, requestVersion);
        return;
      }
      const generated = createProceduralSignal(listener.context, source.signal);
      finishLoadingBufferSource(generated.buffer, requestVersion);
      return;
    }

    audioLoader.load(
      source.url,
      (buffer) => finishLoadingBufferSource(buffer, requestVersion),
      null,
      (error) => {
        if (requestVersion === sourceRequestVersion) console.error('Audio Load Error:', error);
      }
    );
  }

  function finishLoadingPeriodicSource(source, requestVersion) {
    if (requestVersion !== sourceRequestVersion) return;
    const oscillator = createPeriodicOscillator(
      listener.context,
      source.signal,
      normalizedPitchToFrequency(pitchValue)
    );
    const gain = listener.context.createGain();
    gain.gain.value = PROCEDURAL_OUTPUT_LEVEL;
    oscillator.connect(gain);
    sound.setNodeSource(gain);
    activePeriodicSource = { oscillator, gain, started: false };
    finishLoadingSource(requestVersion);
  }

  function finishLoadingBufferSource(buffer, requestVersion) {
    if (requestVersion !== sourceRequestVersion) return;
    sound.hasPlaybackControl = true;
    sound.setBuffer(buffer);
    sound.setLoop(true);
    sound.setPlaybackRate(
      currentSource.kind === 'mp3' ? normalizedPitchToPlaybackRate(pitchValue) : 1
    );
    finishLoadingSource(requestVersion);
  }

  function finishLoadingSource(requestVersion) {
    if (requestVersion !== sourceRequestVersion) return;
    sound.setRefDistance(2);
    sound.setRolloffFactor(1);
    sound.setDistanceModel('inverse');
    sound.setDirectionalCone(360, 360, 1);
    applyFilterValues();
    rewireAudioGraph();
    ensureWaveform();
    resetWaveform();
    waveformData = { soundStarted: false };
    waveformReady = true;
    soundReady = true;
  }

  function ensureWaveform() {
    if (waveformMesh) return;
    const positions = new Float32Array(LIVE_WAVEFORM_POINTS * 3);
    for (let index = 0; index < LIVE_WAVEFORM_POINTS; index += 1) {
      positions[index * 3] = THREE.MathUtils.lerp(
        waveformBounds.minX,
        waveformBounds.maxX,
        index / (LIVE_WAVEFORM_POINTS - 1)
      );
      positions[index * 3 + 1] = waveformBounds.centerY;
      positions[index * 3 + 2] = waveformBounds.z;
    }
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    waveformMesh = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xff0000 })
    );
    waveformMesh.renderOrder = 20;
    scene.add(waveformMesh);
  }

  function resetWaveform() {
    if (!waveformMesh) return;
    const positions = waveformMesh.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, waveformBounds.centerY);
    }
    positions.needsUpdate = true;
  }

  function updateWaveform() {
    if (!waveformData?.soundStarted || !waveformAnalyser || !waveformTimeData || !waveformMesh) return;
    waveformAnalyser.getFloatTimeDomainData(waveformTimeData);
    const positions = waveformMesh.geometry.getAttribute('position');
    const startIndex = findStableWaveformStart(waveformTimeData, positions.count);
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(
        index,
        mapWaveformSampleToY(waveformTimeData[startIndex + index], waveformBounds)
      );
    }
    positions.needsUpdate = true;
  }

  function setPitch(value, immediately = false) {
    pitchValue = Math.max(0, Math.min(1, value));
    const pitchMode = getPitchMode();
    if (pitchMode === 'disabled') return;
    const currentTime = listener.context.currentTime;
    if (pitchMode === 'frequency' && activePeriodicSource) {
      const frequency = activePeriodicSource.oscillator.frequency;
      const target = normalizedPitchToFrequency(pitchValue);
      frequency.cancelScheduledValues(currentTime);
      if (immediately) frequency.setValueAtTime(target, currentTime);
      else frequency.setTargetAtTime(target, currentTime, 0.03);
    } else if (pitchMode === 'playbackRate' && soundReady) {
      sound.setPlaybackRate(normalizedPitchToPlaybackRate(pitchValue));
    }
  }

  function setFilter(type) {
    activeFilter = type;
    initializeFilters();
    applyFilterValues();
    rewireAudioGraph();
  }

  function setFilterParameter(name, value) {
    if (!(name in filterValues)) return;
    filterValues[name] = Math.max(0, Math.min(1, value));
    applyFilterParameter(name);
  }

  function applyFilterValues() {
    for (const name of Object.keys(filterValues)) applyFilterParameter(name);
  }

  function applyFilterParameter(name) {
    if (!filtersInitialized || !activeFilter || !filters?.[activeFilter]) return;
    const filter = filters[activeFilter];
    const value = filterValues[name];
    if (name === 'cutoff') {
      filter.frequency.value = Math.exp(Math.log(20) + (Math.log(20000) - Math.log(20)) * value);
    } else if (name === 'resonance') {
      filter.Q.value = 0.1 + value * 19.9;
    } else if (name === 'gain') {
      filter.gain.value = -18 + value * 36;
    }
  }

  function togglePaused() {
    paused = !paused;
    if (paused && waveformData?.soundStarted) {
      pauseCurrentSource();
      waveformData.soundStarted = false;
    } else if (!paused && waveformData && !waveformData.soundStarted) {
      playCurrentSource();
      waveformData.soundStarted = true;
    }
    return paused;
  }

  function update() {
    let started = false;
    if (pendingSourceVersion !== null) {
      const requestVersion = pendingSourceVersion;
      pendingSourceVersion = null;
      loadSource(currentSource, requestVersion);
    }
    if (soundReady && waveformReady && waveformData && !waveformData.soundStarted && !paused) {
      waveformReady = false;
      playCurrentSource();
      waveformData.soundStarted = true;
      started = true;
    }
    updateWaveform();
    return { started, paused };
  }

  function playCurrentSource() {
    if (activePeriodicSource) {
      const currentTime = listener.context.currentTime;
      activePeriodicSource.gain.gain.cancelScheduledValues(currentTime);
      activePeriodicSource.gain.gain.setTargetAtTime(PROCEDURAL_OUTPUT_LEVEL, currentTime, 0.01);
      if (!activePeriodicSource.started) {
        activePeriodicSource.oscillator.start();
        activePeriodicSource.started = true;
      }
      sound.isPlaying = true;
    } else {
      sound.play();
    }
  }

  function pauseCurrentSource() {
    if (activePeriodicSource) {
      const currentTime = listener.context.currentTime;
      activePeriodicSource.gain.gain.cancelScheduledValues(currentTime);
      activePeriodicSource.gain.gain.setTargetAtTime(0, currentTime, 0.01);
      sound.isPlaying = false;
    } else if (sound.isPlaying) {
      sound.pause();
    }
  }

  function getPitchMode(source = currentSource) {
    if (source.kind === 'mp3') return 'playbackRate';
    if (source.kind === 'procedural' && source.signal.periodic) return 'frequency';
    return 'disabled';
  }

  function getFilterState() {
    return { type: activeFilter, ...filterValues };
  }

  return {
    sound,
    selectSource,
    stop: stopCurrentPlayback,
    togglePaused,
    setPitch,
    setFilter,
    setFilterParameter,
    getPitchMode,
    getPitchValue: () => pitchValue,
    getFilterState,
    update
  };
}

export function findStableWaveformStart(samples, displayLength) {
  const maximumStart = Math.max(0, samples.length - displayLength);
  const targetStart = Math.floor(maximumStart / 2);
  const searchRadius = Math.min(displayLength / 2, maximumStart);
  let bestStart = targetStart;
  let bestDistance = Infinity;
  for (
    let index = Math.max(1, Math.floor(targetStart - searchRadius));
    index <= Math.min(maximumStart, Math.ceil(targetStart + searchRadius));
    index += 1
  ) {
    if (samples[index - 1] <= 0 && samples[index] > 0) {
      const distance = Math.abs(index - targetStart);
      if (distance < bestDistance) {
        bestStart = index;
        bestDistance = distance;
      }
    }
  }
  return bestStart;
}

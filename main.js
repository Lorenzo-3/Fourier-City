import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  initializeLore,
  updateLore,
  computeFilterMultipliers,
  getBandCenterFrequency,
  getSkylineTargetPosition
} from './lore.js';
import { createPitchRobotArm } from './pitch-robot-arm.js';
import {
  createPeriodicOscillator,
  createProceduralSignal,
  FUNDAMENTAL_HZ,
  PROCEDURAL_OUTPUT_LEVEL,
  PROCEDURAL_SIGNALS
} from './procedural-signals.js';
import {
  frequencyToNormalizedPitch,
  normalizedPitchToFrequency,
  normalizedPitchToPlaybackRate
} from './pitch-control.mjs';
import { createWaveformDisplayBounds, mapWaveformSampleToY } from './waveform-visualization.mjs';
import { collidesWithCircle } from './player-collision.mjs';
import { restrictShadowCastingToLight } from './shadow-caster-filter.js';

// ============================================================
// RENDERER SETUP (Improved shading, shadows, tone mapping)
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;

document.body.appendChild(renderer.domElement);

const SHADOW_MAP_SIZE = Math.min(8192, renderer.capabilities.maxTextureSize);
const SHADOW_CAMERA_HALF_SIZE = 90; 
const TABLE_SHADOW_MAP_SIZE = Math.min(8192, renderer.capabilities.maxTextureSize);

const PLAYER_EYE_HEIGHT = 2.3;
const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 3.8;
const SPRINT_SPEED = 7.0;
const WORLD_LIMIT = 48;

renderer.domElement.style.display = 'block';
renderer.domElement.tabIndex = 0;

const crosshair = document.createElement('div');
crosshair.textContent = '+';
Object.assign(crosshair.style, {
  position: 'fixed',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  color: '#ffffff',
  font: '20px monospace',
  lineHeight: '20px',
  pointerEvents: 'none',
  userSelect: 'none',
  zIndex: '10',
  display: 'none'
});
document.body.appendChild(crosshair);

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

// File input for custom MP3
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.mp3';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const url = URL.createObjectURL(file);
    const source = createMp3Source(url);

    if (selectedMusicObjectUrl) {
      URL.revokeObjectURL(selectedMusicObjectUrl);
    }
    selectedMusicObjectUrl = url;
    if (musicbutton) {
      musicbutton.userData.source = source;
    }
    resetPlayingButtonVisual(currentPlayingButton);
    resetStopButtonVisual();
    selectAudioSource(source);
    currentPlayingButton = musicbutton;
    fileInput.value = '';
  }
  setTimeout(() => lockPointer(), 100);
});

fileInput.addEventListener('cancel', () => {
  setTimeout(() => lockPointer(), 100);
});

const scene = new THREE.Scene();

// ============================================================
// HDRI ENVIRONMENT & LIGHTING
// ============================================================
scene.background = new THREE.Color(0x020308);
scene.backgroundIntensity = 0.7;
scene.environmentIntensity = 1.0;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new EXRLoader().load(
  'img/night-sky-4k.exr',
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const environmentRenderTarget = pmremGenerator.fromEquirectangular(texture);

    scene.background = texture;
    scene.environment = environmentRenderTarget.texture;
    pmremGenerator.dispose();
  },
  undefined,
  (error) => {
    pmremGenerator.dispose();
    console.error('HDRI environment failed to load; using dark background fallback:', error);
  }
);

// Wide shadow pass reserved for the robotic arm.
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(100, 200, 50);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
dirLight.shadow.camera.left = -SHADOW_CAMERA_HALF_SIZE;
dirLight.shadow.camera.right = SHADOW_CAMERA_HALF_SIZE;
dirLight.shadow.camera.top = SHADOW_CAMERA_HALF_SIZE;
dirLight.shadow.camera.bottom = -SHADOW_CAMERA_HALF_SIZE;
dirLight.shadow.camera.updateProjectionMatrix();

scene.add(dirLight);

// Tight shadow pass for the table and its controls. Keeping both lights aligned
// prevents doubled shadow edges while preserving the original total intensity.
const tableDetailLight = new THREE.DirectionalLight(0xffffff, 0.9);
tableDetailLight.position.set(25, 50, 12.5);
tableDetailLight.castShadow = true;
tableDetailLight.shadow.mapSize.set(TABLE_SHADOW_MAP_SIZE, TABLE_SHADOW_MAP_SIZE);
tableDetailLight.shadow.camera.updateProjectionMatrix();

scene.add(tableDetailLight);

// Camera and listener
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, PLAYER_EYE_HEIGHT, 5);
camera.lookAt(0, 1.3, 0);

const listener = new THREE.AudioListener();
camera.add(listener);

const controls = new PointerLockControls(camera, renderer.domElement);
let lastFrameMs = performance.now();

controls.addEventListener('lock', () => {
  crosshair.style.display = 'block';
});
controls.addEventListener('unlock', () => {
  crosshair.style.display = 'none';
});

const movementState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false
};
const playerMove = new THREE.Vector3();
const playerForward = new THREE.Vector3();
const playerRight = new THREE.Vector3();
const candidatePosition = new THREE.Vector3();
const axisCandidatePosition = new THREE.Vector3();
let tableCollisionBox = null;
let introPanelOpen = true;
let introOverlay = null;
let introStartButton = null;

function lockPointer() {
  if (introPanelOpen) return;
  if (document.pointerLockElement === renderer.domElement) return;
  const lockPromise = renderer.domElement.requestPointerLock?.();
  if (lockPromise?.catch) lockPromise.catch(() => {});
}

function createIntroPanel() {
  introOverlay = document.createElement('div');
  introOverlay.id = 'intro-overlay';
  introOverlay.hidden = true;
  introOverlay.setAttribute('role', 'dialog');
  introOverlay.setAttribute('aria-modal', 'true');
  introOverlay.setAttribute('aria-labelledby', 'intro-title');
  introOverlay.setAttribute('aria-describedby', 'intro-description');

  const panel = document.createElement('section');
  panel.className = 'intro-panel';

  const title = document.createElement('h1');
  title.id = 'intro-title';
  title.textContent = 'Fourier City';

  const description = document.createElement('p');
  description.id = 'intro-description';
  description.textContent = 'A playable audio visualization: choose a waveform or MP3, shape it with filters and knobs, and watch the skyline react across the frequency spectrum.';

  const controlsList = document.createElement('div');
  controlsList.className = 'intro-controls';

  const controlRows = [
    ['WASD', 'Move through the city'],
    ['Shift', 'Sprint'],
    ['Mouse', 'Look around and aim at tabletop controls'],
    ['Click', 'Press waveform, music, and filter buttons'],
    ['Drag knobs', 'Adjust pitch, cutoff, gain, and resonance'],
    ['Space', 'Stop or resume the current sound']
  ];

  for (const [shortcut, explanation] of controlRows) {
    const row = document.createElement('div');
    row.className = 'intro-control-row';

    const key = document.createElement('kbd');
    key.textContent = shortcut;

    const text = document.createElement('span');
    text.textContent = explanation;

    row.append(key, text);
    controlsList.appendChild(row);
  }

  introStartButton = document.createElement('button');
  introStartButton.type = 'button';
  introStartButton.className = 'intro-start-button';
  introStartButton.textContent = 'Start Exploring';
  introStartButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideIntroPanel(true);
  });

  panel.append(title, description, controlsList, introStartButton);
  introOverlay.appendChild(panel);

  for (const eventName of ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'pointerdown', 'pointerup']) {
    introOverlay.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  }

  document.body.appendChild(introOverlay);
}

function showIntroPanel() {
  introPanelOpen = true;
  introOverlay.hidden = false;
  if (document.pointerLockElement === renderer.domElement) {
    controls.unlock();
  }
  requestAnimationFrame(() => introStartButton.focus({ preventScroll: true }));
}

function hideIntroPanel(lockAfterDismiss = false) {
  if (!introPanelOpen) return;
  introPanelOpen = false;
  introOverlay.hidden = true;
  renderer.domElement.focus({ preventScroll: true });
  if (lockAfterDismiss) lockPointer();
}

createIntroPanel();
showIntroPanel();

// Floor (receives shadows, white with black grid)
const floorGeometry = new THREE.PlaneGeometry(300, 300);
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.4,
  metalness: 0.05
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const gridHelper = new THREE.GridHelper(300, 75, 0x000000, 0x000000);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// Glass box (physical material)
const boxGeometry = new THREE.BoxGeometry(3, 1.1, 0.2);
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0.9,
  roughness: 0.1,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
  transmission: 0.9,
  thickness: 0.5,
  ior: 1.5,
});
const glassBox = new THREE.Mesh(boxGeometry, glassMaterial);
glassBox.position.set(0, 1.8, -0.5);
glassBox.receiveShadow = true;
scene.add(glassBox);
const waveformDisplayBounds = createWaveformDisplayBounds({
  centerX: glassBox.position.x,
  centerY: glassBox.position.y,
  centerZ: glassBox.position.z,
  width: boxGeometry.parameters.width,
  height: boxGeometry.parameters.height
});

// ============================================================
// LOADERS & TEXT CREATION
// ============================================================
const loader = new OBJLoader();
const textureLoader = new THREE.TextureLoader();

function createTextTexture(text, size = 256, color = 0xffffff) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const colorStr = `rgb(${r}, ${g}, ${b})`;

  ctx.save();
  ctx.shadowColor = colorStr;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.font = 'bold 32px "Arial", "Helvetica", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Black outline for legibility
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(text, size / 2, size / 2);

  ctx.fillStyle = colorStr;
  ctx.fillText(text, size / 2, size / 2);
  ctx.restore();

  return new THREE.CanvasTexture(canvas);
}

function createTextSprite(text, position, color = 0xffffff) {
  const texture = createTextTexture(text, 256, color);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.position.y += 0.15;
  sprite.scale.set(0.3, 0.3, 1);
  return sprite;
}

// ============================================================
// TABLE MODEL LOADING (with shadows)
// ============================================================
let tableObject;
loader.load('models/table.obj', (object) => {
  const tableMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.1
  });

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = tableMaterial;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  restrictShadowCastingToLight(object, tableDetailLight);

  object.position.set(0, 0, 0);
  scene.add(object);
  tableObject = object;

  tableObject.updateMatrixWorld(true);
  tableCollisionBox = new THREE.Box3().setFromObject(tableObject);
  tableCollisionBox.expandByVector(new THREE.Vector3(PLAYER_RADIUS, 0, PLAYER_RADIUS));
});

let tablewireframeObject;
loader.load('models/table_wireframe.obj', (object) => {
  const wireframeMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000,
    wireframe: true,
    roughness: 0.2,
    metalness: 0.1
  });

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = wireframeMaterial;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  restrictShadowCastingToLight(object, tableDetailLight);

  object.position.set(0, 0, 0);
  scene.add(object);
  tablewireframeObject = object;

  tablewireframeObject.updateMatrixWorld(true);
  tableCollisionBox = new THREE.Box3().setFromObject(tablewireframeObject);
  tableCollisionBox.expandByVector(new THREE.Vector3(PLAYER_RADIUS, 0, PLAYER_RADIUS));
});

// ============================================================
// AUDIO SYSTEM (procedural + MP3, waveform display)
// ============================================================
const sound = new THREE.PositionalAudio(listener);
const audioLoader = new THREE.AudioLoader();
initializeLore({ scene, camera, audio: sound });
const pitchRobotArm = createPitchRobotArm(scene);
restrictShadowCastingToLight(pitchRobotArm.root, dirLight);
const pitchRobotTarget = new THREE.Vector3();

// Web Audio processing
let filters = null;
let filtersInitialized = false;
let waveformAnalyser = null;
let waveformTimeData = null;
let pitchknob = null;
let activePeriodicSource = null;

function initializeFilters() {
  if (filtersInitialized) return;
  const audioContext = listener.context;
  if (!audioContext) return;

  filters = {
    lowpass: audioContext.createBiquadFilter(),
    highpass: audioContext.createBiquadFilter(),
    bandpass: audioContext.createBiquadFilter(),
    peaking: audioContext.createBiquadFilter()
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
  filters.lowpass.Q.value = 1;
  filters.highpass.Q.value = 1;
  filters.bandpass.Q.value = 1;
  filters.peaking.Q.value = 1;

  waveformAnalyser = audioContext.createAnalyser();
  waveformAnalyser.fftSize = 2048;
  waveformAnalyser.smoothingTimeConstant = 0;
  waveformTimeData = new Float32Array(waveformAnalyser.fftSize);
  filtersInitialized = true;
}

function initializeAudioProcessing() {
  initializeFilters();
  rewireAudioGraph();
}

let activeFilter = null;
const filterConfig = {
  lowpass: { knobs: ['cutoffknob', 'resonanceknob'] },
  highpass: { knobs: ['cutoffknob', 'resonanceknob'] },
  bandpass: { knobs: ['cutoffknob', 'resonanceknob'] },
  peaking: { knobs: ['cutoffknob', 'gainknob', 'resonanceknob'] }
};

const knobToFilter = {
  'pitchknob': 'pitch',
  'cutoffknob': 'cutoff',
  'gainknob': 'gain',
  'resonanceknob': 'resonance'
};

function rewireAudioGraph() {
  if (!sound || !filtersInitialized || !waveformAnalyser) return;
  const processingNodes = [];
  if (activeFilter && filters?.[activeFilter]) processingNodes.push(filters[activeFilter]);
  processingNodes.push(waveformAnalyser);
  sound.setFilters(processingNodes);
}

function applyActiveFilterParameters() {
  const activeKnobNames = filterConfig[activeFilter]?.knobs ?? [];
  for (const knobName of activeKnobNames) {
    const knob = knobObjects.find(candidate => candidate.userData.name === knobName);
    if (knob) updateFilterParameter(knobName, knob.userData.value);
  }
}

const LIVE_WAVEFORM_POINTS = 2048;
let waveformData = null;
let currentSource = createMp3Source('sounds/ijustthrewouthelovefmydreams.mp3');
let sourceRequestVersion = 1;
let pendingSourceVersion = 1;
let selectedMusicObjectUrl = null;
let soundReady = false;
let waveformReady = false;
let currentWaveformMesh = null;

function createMp3Source(url) {
  return { kind: 'mp3', url };
}

function createGeneratedSource(signal) {
  return { kind: 'procedural', signal };
}

function getPitchMode(source = currentSource) {
  if (source.kind === 'mp3') return 'playbackRate';
  if (source.kind === 'procedural' && source.signal.periodic) return 'frequency';
  return 'disabled';
}

function setKnobNormalizedValue(knob, value) {
  knob.userData.value = Math.max(0, Math.min(1, value));
  const angleRange = 270 * Math.PI / 180;
  knob.rotation.y = Math.PI - (knob.userData.value - 0.5) * angleRange;
  updateKnobValueDisplay(knob);
}

function resetPitchForSource(source) {
  if (!pitchknob) return;
  const value = getPitchMode(source) === 'frequency'
    ? frequencyToNormalizedPitch(FUNDAMENTAL_HZ)
    : 0.5;
  setKnobNormalizedValue(pitchknob, value);
}

function isKnobInteractive(knob) {
  return knob.userData.name !== 'pitchknob' || getPitchMode() !== 'disabled';
}

function selectAudioSource(source) {
  stopCurrentPlayback();
  resetCurrentWaveform();
  waveformData = null;
  currentSource = source;
  resetPitchForSource(source);
  sourceRequestVersion += 1;
  pendingSourceVersion = sourceRequestVersion;
  soundReady = false;
  waveformReady = false;
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

function loadAudioSource(source, requestVersion) {
  soundReady = false;
  waveformReady = false;
  initializeAudioProcessing();

  if (source.kind === 'procedural') {
    if (source.signal.periodic) {
      finishLoadingPeriodicSource(source, requestVersion);
      return;
    }
    const generatedSignal = createProceduralSignal(listener.context, source.signal);
    finishLoadingBufferSource(generatedSignal.buffer, requestVersion);
    return;
  }

  audioLoader.load(source.url, (buffer) => {
    if (requestVersion !== sourceRequestVersion) return;
    finishLoadingBufferSource(buffer, requestVersion);
  }, null, (err) => {
    if (requestVersion === sourceRequestVersion) console.error('Audio Load Error:', err);
  });
}

function finishLoadingPeriodicSource(source, requestVersion) {
  if (requestVersion !== sourceRequestVersion) return;

  const oscillator = createPeriodicOscillator(
    listener.context,
    source.signal,
    normalizedPitchToFrequency(pitchknob.userData.value)
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
    currentSource.kind === 'mp3'
      ? normalizedPitchToPlaybackRate(pitchknob.userData.value)
      : 1
  );
  finishLoadingSource(requestVersion);
}

function finishLoadingSource(requestVersion) {
  if (requestVersion !== sourceRequestVersion) return;

  sound.setRefDistance(2);
  sound.setRolloffFactor(1);
  sound.setDistanceModel('inverse');
  sound.setDirectionalCone(360, 360, 1);
  applyActiveFilterParameters();
  rewireAudioGraph();
  ensureLiveWaveform();
  resetCurrentWaveform();

  waveformData = {
    line: currentWaveformMesh,
    sound,
    soundStarted: false
  };

  if (tableObject) {
    tableObject.add(sound);
  } else {
    scene.add(sound);
  }

  waveformReady = true;
  soundReady = true;
}

function ensureLiveWaveform() {
  if (currentWaveformMesh) return;

  const positions = new Float32Array(LIVE_WAVEFORM_POINTS * 3);
  for (let index = 0; index < LIVE_WAVEFORM_POINTS; index += 1) {
    positions[index * 3] = THREE.MathUtils.lerp(
      waveformDisplayBounds.minX,
      waveformDisplayBounds.maxX,
      index / (LIVE_WAVEFORM_POINTS - 1)
    );
    positions[index * 3 + 1] = waveformDisplayBounds.centerY;
    positions[index * 3 + 2] = waveformDisplayBounds.z;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  currentWaveformMesh = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xff0000
    })
  );
  currentWaveformMesh.renderOrder = 20;
  scene.add(currentWaveformMesh);
}

function resetCurrentWaveform() {
  if (!currentWaveformMesh) return;
  const positions = currentWaveformMesh.geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, waveformDisplayBounds.centerY);
  }
  positions.needsUpdate = true;
}

function updateLiveWaveform() {
  if (!waveformData?.soundStarted || !waveformAnalyser || !waveformTimeData || !currentWaveformMesh) return;

  waveformAnalyser.getFloatTimeDomainData(waveformTimeData);
  const positions = currentWaveformMesh.geometry.getAttribute('position');
  const startIndex = findStableWaveformStart(waveformTimeData, positions.count);

  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(
      index,
      mapWaveformSampleToY(waveformTimeData[startIndex + index], waveformDisplayBounds)
    );
  }
  positions.needsUpdate = true;
}

function findStableWaveformStart(samples, displayLength) {
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

function applyPitchValue(value, immediately = false) {
  const pitchMode = getPitchMode();
  if (pitchMode === 'disabled') return;

  const currentTime = listener.context.currentTime;

  if (pitchMode === 'frequency' && activePeriodicSource) {
    const frequency = activePeriodicSource.oscillator.frequency;
    const targetFrequency = normalizedPitchToFrequency(value);
    frequency.cancelScheduledValues(currentTime);
    if (immediately) {
      frequency.setValueAtTime(targetFrequency, currentTime);
    } else {
      frequency.setTargetAtTime(targetFrequency, currentTime, 0.03);
    }
  } else if (pitchMode === 'playbackRate' && soundReady) {
    sound.setPlaybackRate(normalizedPitchToPlaybackRate(value));
  }
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

function togglePauseResume() {
  if (!stopbutton.userData.clicked) {
    stopbutton.userData.clicked = true;
    if (waveformData?.soundStarted) {
      pauseCurrentSource();
      waveformData.soundStarted = false;
    }
  } else {
    stopbutton.userData.clicked = false;
    if (waveformData && !waveformData.soundStarted) {
      playCurrentSource();
      waveformData.soundStarted = true;
    }
  }
  animateClick(stopbutton);
}

// ============================================================
// UI BUTTONS & KNOBS
// ============================================================
const raycaster = new THREE.Raycaster();
const mouseClick = new THREE.Vector2();
const clickableObjects = [];
const knobObjects = [];
let currentPlayingButton = null;
let currentFilterButton = null;
const buttonPositions = {};
let activeKnob = null;
let previousMouseY = 0;
let isDraggingKnob = false;

function animateClick(button) {
  if (!buttonPositions[button.userData.name]) {
    buttonPositions[button.userData.name] = button.position.y;
  }
  button.userData.pressed = !button.userData.pressed;
  button.userData.isAnimating = true;
  button.userData.animationStart = Date.now();
  button.userData.originalY = buttonPositions[button.userData.name];
}

function resetPlayingButtonVisual(button) {
  if (!button) return;
  button.userData.pressed = false;
  button.userData.isAnimating = false;
  const originalY = buttonPositions[button.userData.name];
  if (originalY !== undefined) {
    button.position.y = originalY;
    if (button.userData.textSprite) button.userData.textSprite.position.y = originalY + 0.15;
  }
}

function resetStopButtonVisual() {
  stopbutton.userData.clicked = false;
  resetPlayingButtonVisual(stopbutton);
}

function getClickedObject(event) {
  if (controls.isLocked) {
    mouseClick.set(0, 0);
  } else {
    mouseClick.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseClick.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }
  raycaster.setFromCamera(mouseClick, camera);
  const intersects = raycaster.intersectObjects(clickableObjects);
  for (let intersection of intersects) {
    if (intersection.object.userData.type === 'clickable') return intersection.object;
  }
  return null;
}

// ============================================================
// FREQUENCY RESPONSE RED LINE + CUTOFF INDICATOR SPHERE
// ============================================================
let frequencyResponseLine = null;
let cutoffIndicatorSphere = null;

function createFrequencyResponseLine() {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color: 0xff0000
  });
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  scene.add(line);

  // Create the yellow sphere that marks the cutoff frequency
  const sphereGeom = new THREE.SphereGeometry(1, 16, 16);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0xffff00
  });
  cutoffIndicatorSphere = new THREE.Mesh(sphereGeom, sphereMat);
  cutoffIndicatorSphere.visible = false;
  scene.add(cutoffIndicatorSphere);

  return line;
}

function updateFrequencyResponseLine() {
  if (!frequencyResponseLine) return;

  if (!activeFilter || !filtersInitialized) {
    frequencyResponseLine.visible = false;
    if (cutoffIndicatorSphere) cutoffIndicatorSphere.visible = false;
    return;
  }

  const lore = window.__fourierCityLore;
  if (!lore || !lore.buildings) {
    frequencyResponseLine.visible = false;
    if (cutoffIndicatorSphere) cutoffIndicatorSphere.visible = false;
    return;
  }

  const multipliers = computeFilterMultipliers();
  const numPoints = multipliers.length;

  // === FIXED dB RANGE – visual scale never changes ===
  const FIXED_MIN_DB = -48;
  const FIXED_MAX_DB = 12;
  const dbRange = FIXED_MAX_DB - FIXED_MIN_DB;

  const buildings = lore.buildings;
  const positions = new Float32Array(numPoints * 3);
  const visualMinY = 0.6;
  const visualMaxY = 30;

  for (let i = 0; i < numPoints; i++) {
    const building = buildings[i];
    const mag = multipliers[i];
    const db = mag > 0 ? 20 * Math.log10(mag) : -60;

    const t = THREE.MathUtils.clamp((db - FIXED_MIN_DB) / dbRange, 0, 1);
    const y = visualMinY + t * (visualMaxY - visualMinY);

    positions[i * 3] = building.position.x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = building.position.z;
  }

  frequencyResponseLine.geometry.dispose();
  frequencyResponseLine.geometry = new THREE.BufferGeometry();
  frequencyResponseLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  frequencyResponseLine.visible = true;

  // --- Place the cutoff indicator sphere (directly mapped to knob value) ---
  if (cutoffIndicatorSphere && cutoffknob) {
    const cutoffValue = cutoffknob.userData.value;
    const nearestIndex = Math.round(cutoffValue * (numPoints - 1));

    const building = buildings[nearestIndex];
    cutoffIndicatorSphere.position.set(
      building.position.x,
      positions[nearestIndex * 3 + 1],   // y from the line
      building.position.z
    );
    cutoffIndicatorSphere.visible = true;
  } else {
    if (cutoffIndicatorSphere) cutoffIndicatorSphere.visible = false;
  }
}

function handleClickedObject(clickedObject) {
  if (clickedObject.userData.name === 'Stop/Resume') {
    togglePauseResume();
  } else if (clickedObject.userData.name === 'SelectMusic') {
    if (controls.isLocked) {
      controls.unlock();
      setTimeout(() => fileInput.click(), 0);
    } else {
      fileInput.click();
    }
  } else if (clickedObject.userData.band) {
    if (currentFilterButton === clickedObject) {
      animateClick(clickedObject);
      currentFilterButton = null;
      activeFilter = null;
      rewireAudioGraph();
      updateGlobalFilterState();
      updateFrequencyResponseLine();
    } else {
      if (currentFilterButton) {
        currentFilterButton.userData.pressed = false;
        currentFilterButton.userData.isAnimating = false;
        if (buttonPositions[currentFilterButton.userData.name]) {
          currentFilterButton.position.y = buttonPositions[currentFilterButton.userData.name];
        }
      }
      currentFilterButton = clickedObject;
      activeFilter = clickedObject.userData.name.toLowerCase();
      applyActiveFilterParameters();
      updateGlobalFilterState();
      animateClick(clickedObject);
      rewireAudioGraph();
      updateFrequencyResponseLine();
    }
  } else if (clickedObject !== currentPlayingButton) {
    stopCurrentPlayback();
    resetPlayingButtonVisual(currentPlayingButton);
    resetStopButtonVisual();
    selectAudioSource(clickedObject.userData.source);
    currentPlayingButton = clickedObject;
    animateClick(clickedObject);
  }
}

// Knob creation
function createKnobCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#888888';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#666666';
  ctx.beginPath();
  ctx.arc(64, 64, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(angle) * 30, 64 + Math.sin(angle) * 30);
    ctx.lineTo(64 + Math.cos(angle) * 45, 64 + Math.sin(angle) * 45);
    ctx.stroke();
  }
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(64, 64, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 64);
  ctx.lineTo(104, 64);
  ctx.stroke();
  return canvas;
}

function createKnobLabel(text, position, color = 0xffffff) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `rgb(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255})`;
  ctx.font = 'Bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 15);
  ctx.font = '20px Arial';
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText('Value: 0.00', canvas.width / 2, canvas.height / 2 + 20);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.position.y += 0.15;
  sprite.scale.set(0.4, 0.2, 1);
  return sprite;
}

function updateKnobValueDisplay(knob) {
  if (knob.userData.labelSprite) {
    const canvas = knob.userData.labelSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = `rgb(${(knob.userData.labelColor >> 16) & 255}, ${(knob.userData.labelColor >> 8) & 255}, ${knob.userData.labelColor & 255})`;
    ctx.font = 'Bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(knob.userData.labelName, width / 2, height / 2 - 15);

    let displayValue;
    if (knob.userData.name === 'pitchknob') {
      const pitchMode = getPitchMode();
      if (pitchMode === 'playbackRate') {
        displayValue = `${normalizedPitchToPlaybackRate(knob.userData.value).toFixed(2)}x`;
      } else if (pitchMode === 'frequency') {
        displayValue = `${Math.round(normalizedPitchToFrequency(knob.userData.value))}Hz`;
      } else {
        displayValue = 'N/A';
      }
    } else if (knob.userData.name === 'cutoffknob') {
      const minFreq = 20;
      const maxFreq = 20000;
      const logMin = Math.log(minFreq);
      const logMax = Math.log(maxFreq);
      const frequency = Math.exp(logMin + (logMax - logMin) * knob.userData.value);
      displayValue = Math.round(frequency) + 'Hz';
    } else if (knob.userData.name === 'gainknob') {
      const gain = -18 + knob.userData.value * 36;
      displayValue = gain.toFixed(1) + 'dB';
    } else if (knob.userData.name === 'resonanceknob') {
      const Q = 0.1 + knob.userData.value * 19.9;
      displayValue = Q.toFixed(2);
    } else {
      displayValue = knob.userData.value.toFixed(2);
    }

    ctx.font = '20px Arial';
    ctx.fillStyle = '#ffff00';
    ctx.fillText(displayValue, width / 2, height / 2 + 20);
    knob.userData.labelSprite.material.map.needsUpdate = true;
  }
}

function createKnobMesh(position, name, initialValue, minValue, maxValue) {
  const knobGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 32);
  const topMaterial = new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(createKnobCanvas()),
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.7
  });
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.3 }),
    topMaterial,
    new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.2 })
  ];

  const knob = new THREE.Mesh(knobGeometry, materials);
  knob.position.copy(position);
  knob.castShadow = true;
  knob.receiveShadow = true;
  restrictShadowCastingToLight(knob, tableDetailLight);

  knob.userData.type = 'knob';
  knob.userData.name = name;
  knob.userData.value = initialValue;
  knob.userData.minValue = minValue;
  knob.userData.maxValue = maxValue;

  const angleRange = 270 * Math.PI / 180;
  const rotationAngle = Math.PI - (initialValue - 0.5) * angleRange;
  knob.rotation.y = rotationAngle;

  let labelText = '';
  let labelColor = 0xffffff;
  switch (name) {
    case 'pitchknob':
      labelText = 'PITCH';
      labelColor = 0xff66ff;
      break;
    case 'cutoffknob':
      labelText = 'CUTOFF';
      labelColor = 0x66ff66;
      break;
    case 'gainknob':
      labelText = 'GAIN';
      labelColor = 0x66ff66;
      break;
    case 'resonanceknob':
      labelText = 'RESONANCE';
      labelColor = 0x66ff66;
      break;
  }

  const labelSprite = createKnobLabel(labelText, position, labelColor);
  knob.userData.labelSprite = labelSprite;
  knob.userData.labelName = labelText;
  knob.userData.labelColor = labelColor;
  scene.add(labelSprite);

  updateKnobValueDisplay(knob);
  scene.add(knob);
  knobObjects.push(knob);
  return knob;
}

function updateGlobalFilterState() {
  const state = window.__fourierCityLore;
  if (!state) return;
  state.filterState = {
    type: activeFilter,
    cutoff: cutoffknob.userData.value,
    gain: gainknob.userData.value,
    resonance: resonanceknob.userData.value
  };
}

// Button creation with improved shading
function createButton(position, name, color, text, isBand = false, source = null, isMusic = false, isSelect = false) {
  let geometry, button;

  if (isMusic) {
    geometry = new THREE.BoxGeometry(0.8, 0.1, 0.1, 4, 4, 4);
  } else if (isSelect) {
    geometry = new THREE.CylinderGeometry(0.05, 0.05, 0.05);
  } else if (isBand) {
    geometry = new THREE.CylinderGeometry(0.06, 0.06, 0.1);
  } else {
    geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
  }

  const material = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.25,
    metalness: 0.0
  });

  button = new THREE.Mesh(geometry, material);
  button.position.copy(position);
  button.castShadow = true;
  button.receiveShadow = true;
  restrictShadowCastingToLight(button, tableDetailLight);
  button.userData.type = 'clickable';
  button.userData.name = name;
  button.userData.clicked = false;
  if (isBand) button.userData.band = true;
  if (source) button.userData.source = source;
  if (name === 'Music') button.userData.pressed = false;

  scene.add(button);
  clickableObjects.push(button);
  const textSprite = createTextSprite(text, position, color);
  button.userData.textSprite = textSprite;
  scene.add(textSprite);
  return button;
}

// Create UI elements
const stopbutton = createButton(
  new THREE.Vector3(0, 1.26, 0.05),
  'Stop/Resume',
  0xff0000,
  'STOP'
);
buttonPositions['Stop/Resume'] = stopbutton.position.y;

// Waveform type buttons (procedural signals)
const sinebutton = createButton(
  new THREE.Vector3(-0.9, 1.28, 0.05),
  'Sine',
  0x00ff00,
  'SINE',
  false,
  createGeneratedSource(PROCEDURAL_SIGNALS.sine)
);
const squarebutton = createButton(
  new THREE.Vector3(-0.5, 1.26, 0.05),
  'Square',
  0x00ff00,
  'SQUARE',
  false,
  createGeneratedSource(PROCEDURAL_SIGNALS.square)
);
const trianglebutton = createButton(
  new THREE.Vector3(0.5, 1.26, 0.05),
  'Triangle',
  0x00ff00,
  'TRIANGLE',
  false,
  createGeneratedSource(PROCEDURAL_SIGNALS.triangle)
);
const sawbutton = createButton(
  new THREE.Vector3(0.9, 1.26, 0.05),
  'Saw',
  0x00ff00,
  'SAW',
  false,
  createGeneratedSource(PROCEDURAL_SIGNALS.saw)
);
const noisebutton = createButton(
  new THREE.Vector3(-0.7, 1.26, 0.35),
  'Noise',
  0x00ff00,
  'NOISE',
  false,
  createGeneratedSource(PROCEDURAL_SIGNALS.noise)
);
const richbutton = createButton(
  new THREE.Vector3(0.7, 1.26, 0.35),
  'Rich',
  0x00ff00,
  'RICH',
  false,
  createGeneratedSource(PROCEDURAL_SIGNALS.rich)
);

// Music button (default MP3)
const musicbutton = createButton(
  new THREE.Vector3(-0.05, 1.28, 0.45),
  'Music',
  0x0000ff,
  'MUSIC',
  false,
  createMp3Source('sounds/ijustthrewouthelovefmydreams.mp3'),
  true
);
buttonPositions['Music'] = musicbutton.position.y;
currentPlayingButton = musicbutton;
currentSource = musicbutton.userData.source;

const selectmusicbutton = createButton(
  new THREE.Vector3(0.45, 1.26, 0.45),
  'SelectMusic',
  0xffff00,
  'SELECT',
  false,
  null,
  false,
  true
);

// Filter buttons
const lowpassbutton = createButton(
  new THREE.Vector3(-0.45, 1.26, 0.75),
  'Lowpass',
  0xff00ff,
  'LOWP',
  true
);
const highpassbutton = createButton(
  new THREE.Vector3(-0.15, 1.26, 0.75),
  'Highpass',
  0xff00ff,
  'HIGHP',
  true
);
const bandpassbutton = createButton(
  new THREE.Vector3(0.15, 1.26, 0.75),
  'Bandpass',
  0xff00ff,
  'BANDP',
  true
);
const peakingbutton = createButton(
  new THREE.Vector3(0.45, 1.26, 0.75),
  'Peaking',
  0xff00ff,
  'PEAK',
  true
);

// Knobs
pitchknob = createKnobMesh(new THREE.Vector3(0.0, 1.24, 1.3), 'pitchknob', 0.5, 0, 1);
const cutoffknob = createKnobMesh(new THREE.Vector3(-0.3, 1.24, 1.05), 'cutoffknob', 0.5, 20, 20000);
const gainknob = createKnobMesh(new THREE.Vector3(0.0, 1.24, 1.05), 'gainknob', 0.5, -18, 18);
const resonanceknob = createKnobMesh(new THREE.Vector3(0.3, 1.24, 1.05), 'resonanceknob', 0.1, 0.1, 20);

function updateFilterParameter(knobName, value) {
  const paramType = knobToFilter[knobName];
  if (paramType === 'pitch') {
    applyPitchValue(value);
    return;
  }
  if (!filtersInitialized) return;
  if (!activeFilter || !filters) return;
  const filter = filters[activeFilter];
  if (!filter) return;
  switch (paramType) {
    case 'cutoff': {
      const minFreq = 20;
      const maxFreq = 20000;
      const logMin = Math.log(minFreq);
      const logMax = Math.log(maxFreq);
      filter.frequency.value = Math.exp(logMin + (logMax - logMin) * value);
      break;
    }
    case 'resonance':
      filter.Q.value = 0.1 + value * 19.9;
      break;
    case 'gain':
      filter.gain.value = -18 + value * 36;
      break;
  }
}

// ============================================================
// COLLISION DETECTION & MOVEMENT
// ============================================================
function collidesWithTable(position) {
  if (!tableCollisionBox) return false;
  const centerX = (tableCollisionBox.min.x + tableCollisionBox.max.x) / 2;
  const centerZ = (tableCollisionBox.min.z + tableCollisionBox.max.z) / 2;
  const dx = position.x - centerX;
  const dz = position.z - centerZ;
  const radius = Math.max(
    Math.abs(tableCollisionBox.max.x - centerX),
    Math.abs(tableCollisionBox.max.z - centerZ)
  );
  return (dx * dx + dz * dz) <= (radius * radius);
}

function collidesWithObstacle(position) {
  return (
    collidesWithTable(position)
    || collidesWithCircle(position, pitchRobotArm.collision, PLAYER_RADIUS)
  );
}

function clampToWorld(position) {
  position.x = THREE.MathUtils.clamp(position.x, -WORLD_LIMIT, WORLD_LIMIT);
  position.z = THREE.MathUtils.clamp(position.z, -WORLD_LIMIT, WORLD_LIMIT);
}

function updatePlayerMovement(delta) {
  camera.position.y = PLAYER_EYE_HEIGHT;
  if (!controls.isLocked) return;

  const forwardInput = Number(movementState.forward) - Number(movementState.backward);
  const rightInput = Number(movementState.right) - Number(movementState.left);
  if (forwardInput === 0 && rightInput === 0) return;

  controls.getDirection(playerForward);
  playerForward.y = 0;
  if (playerForward.lengthSq() === 0) return;
  playerForward.normalize();

  playerRight.setFromMatrixColumn(camera.matrix, 0);
  playerRight.y = 0;
  playerRight.normalize();

  playerMove.set(0, 0, 0)
    .addScaledVector(playerForward, forwardInput)
    .addScaledVector(playerRight, rightInput);
  if (playerMove.lengthSq() === 0) return;

  const speed = movementState.sprint ? SPRINT_SPEED : WALK_SPEED;
  playerMove.normalize().multiplyScalar(speed * delta);

  candidatePosition.copy(camera.position).add(playerMove);
  candidatePosition.y = PLAYER_EYE_HEIGHT;
  clampToWorld(candidatePosition);

  if (!collidesWithObstacle(candidatePosition)) {
    camera.position.copy(candidatePosition);
    return;
  }

  axisCandidatePosition.copy(camera.position);
  axisCandidatePosition.x = candidatePosition.x;
  clampToWorld(axisCandidatePosition);
  if (!collidesWithObstacle(axisCandidatePosition)) {
    camera.position.x = axisCandidatePosition.x;
  }

  axisCandidatePosition.copy(camera.position);
  axisCandidatePosition.z = candidatePosition.z;
  clampToWorld(axisCandidatePosition);
  if (!collidesWithObstacle(axisCandidatePosition)) {
    camera.position.z = axisCandidatePosition.z;
  }

  camera.position.y = PLAYER_EYE_HEIGHT;
}

// ============================================================
// ANIMATION LOOP & PLAYBACK
// ============================================================
function playmusic() {
  if (pendingSourceVersion !== null) {
    const requestVersion = pendingSourceVersion;
    pendingSourceVersion = null;
    loadAudioSource(currentSource, requestVersion);
  }

  if (soundReady && waveformReady && waveformData && !waveformData.soundStarted && !stopbutton.userData.clicked) {
    waveformReady = false;
    playCurrentSource();
    waveformData.soundStarted = true;
    if (currentPlayingButton && !currentPlayingButton.userData.pressed) {
      currentPlayingButton.userData.pressed = true;
      currentPlayingButton.userData.isAnimating = true;
      currentPlayingButton.userData.animationStart = Date.now();
      currentPlayingButton.userData.originalY = buttonPositions[currentPlayingButton.userData.name];
    }
  }

  updateLiveWaveform();
}

function clickanimation() {
  clickableObjects.forEach(button => {
    if (button.userData.isAnimating) {
      const elapsed = Date.now() - button.userData.animationStart;
      const duration = 150;
      const progress = Math.min(elapsed / duration, 1);
      let movement = button.userData.pressed ? progress * -0.06 : (1 - progress) * -0.06;
      button.position.y = button.userData.originalY + movement;
      if (button.userData.textSprite) {
        button.userData.textSprite.position.y = button.userData.originalY + movement + 0.15;
      }
      if (progress >= 1) button.userData.isAnimating = false;
    } else if (button.userData.pressed) {
      button.position.y = button.userData.originalY - 0.06;
      if (button.userData.textSprite) button.userData.textSprite.position.y = button.userData.originalY - 0.06 + 0.15;
    } else if (button.userData.originalY !== undefined) {
      button.position.y = button.userData.originalY;
      if (button.userData.textSprite) button.userData.textSprite.position.y = button.userData.originalY + 0.15;
    }
  });
}

// ============================================================
// EVENT LISTENERS (mouse / pointer lock)
// ============================================================
window.addEventListener('mousedown', (event) => {
  if (introPanelOpen) return;

  if (controls.isLocked) {
    mouseClick.set(0, 0);
    raycaster.setFromCamera(mouseClick, camera);
    const intersects = raycaster.intersectObjects(knobObjects);
    if (intersects.length > 0 && isKnobInteractive(intersects[0].object)) {
      activeKnob = intersects[0].object;
      isDraggingKnob = true;
      event.preventDefault();
      renderer.domElement.style.cursor = 'grabbing';
      activeKnob.userData.dragStartValue = activeKnob.userData.value;
      activeKnob.userData.lastMovementY = 0;
    }
  } else {
    mouseClick.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseClick.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseClick, camera);
    const intersects = raycaster.intersectObjects(knobObjects);
    if (intersects.length > 0 && isKnobInteractive(intersects[0].object)) {
      activeKnob = intersects[0].object;
      previousMouseY = event.clientY;
      isDraggingKnob = true;
      event.preventDefault();
    }
  }
});

window.addEventListener('mouseup', () => {
  if (introPanelOpen) return;

  if (activeKnob) {
    activeKnob = null;
    isDraggingKnob = false;
    renderer.domElement.style.cursor = 'none';
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    document.addEventListener('mousemove', onPointerLockMove);
  } else {
    document.removeEventListener('mousemove', onPointerLockMove);
  }
});

function onPointerLockMove(event) {
  if (introPanelOpen) return;

  if (activeKnob && isDraggingKnob && isKnobInteractive(activeKnob)) {
    const deltaY = event.movementY;
    activeKnob.userData.value += deltaY * 0.01;
    activeKnob.userData.value = Math.max(0, Math.min(1, activeKnob.userData.value));
    setKnobNormalizedValue(activeKnob, activeKnob.userData.value);
    updateFilterParameter(activeKnob.userData.name, activeKnob.userData.value);
    updateGlobalFilterState();
    updateFrequencyResponseLine();
    event.stopPropagation();
  }
}

window.addEventListener('mousemove', (event) => {
  if (introPanelOpen) return;

  if (!controls.isLocked && activeKnob && isDraggingKnob && isKnobInteractive(activeKnob)) {
    const deltaY = previousMouseY - event.clientY;
    activeKnob.userData.value += deltaY * 0.005;
    activeKnob.userData.value = Math.max(0, Math.min(1, activeKnob.userData.value));
    setKnobNormalizedValue(activeKnob, activeKnob.userData.value);
    updateFilterParameter(activeKnob.userData.name, activeKnob.userData.value);
    updateGlobalFilterState();
    updateFrequencyResponseLine();
    previousMouseY = event.clientY;
  }
});

window.addEventListener('click', (event) => {
  if (introPanelOpen) return;

  if (isDraggingKnob) {
    isDraggingKnob = false;
    if (activeKnob) {
      activeKnob = null;
      renderer.domElement.style.cursor = 'none';
    }
    return;
  }
  if (controls.isLocked) {
    mouseClick.set(0, 0);
    raycaster.setFromCamera(mouseClick, camera);
    const intersects = raycaster.intersectObjects(clickableObjects);
    for (let intersection of intersects) {
      if (intersection.object.userData.type === 'clickable') {
        handleClickedObject(intersection.object);
        event.preventDefault();
        break;
      }
    }
  } else {
    const clickedObject = getClickedObject(event);
    if (clickedObject) {
      handleClickedObject(clickedObject);
      return;
    }
    if (!controls.isLocked && event.target === renderer.domElement) {
      lockPointer();
    }
  }
});

window.addEventListener('keydown', (event) => {
  if (introPanelOpen) {
    if (event.code === 'Escape') {
      hideIntroPanel(false);
      event.preventDefault();
    }
    return;
  }

  switch (event.code) {
    case 'KeyW': movementState.forward = true; break;
    case 'KeyS': movementState.backward = true; break;
    case 'KeyA': movementState.left = true; break;
    case 'KeyD': movementState.right = true; break;
    case 'ShiftLeft': movementState.sprint = true; break;
    case 'Space': togglePauseResume(); event.preventDefault(); break;
  }
});

window.addEventListener('keyup', (event) => {
  if (introPanelOpen) return;

  switch (event.code) {
    case 'KeyW': movementState.forward = false; break;
    case 'KeyS': movementState.backward = false; break;
    case 'KeyA': movementState.left = false; break;
    case 'KeyD': movementState.right = false; break;
    case 'ShiftLeft': movementState.sprint = false; break;
  }
});

// ============================================================
// INITIALIZATION & ANIMATE
// ============================================================
frequencyResponseLine = createFrequencyResponseLine();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = Math.min((now - lastFrameMs) / 1000, 0.05);
  lastFrameMs = now;

  updatePlayerMovement(delta);
  playmusic();
  clickanimation();
  updateLore();

  const pitchIsPeriodic = getPitchMode() === 'frequency';
  if (pitchIsPeriodic) {
    const skylinePitchTarget = getSkylineTargetPosition(pitchknob.userData.value, pitchRobotTarget);
    pitchRobotArm.update(skylinePitchTarget, delta, true);
  } else {
    pitchRobotArm.update(null, delta, false);
  }

  // Red response line + cutoff sphere now clearly show filter effects
  updateFrequencyResponseLine();

  renderer.render(scene, camera);
}
updateGlobalFilterState();

animate();

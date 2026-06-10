import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { initializeLore, updateLore, computeFilterMultipliers, getBandCenterFrequency } from './lore.js';
import { createProceduralSignal, PROCEDURAL_SIGNALS } from './procedural-signals.js';

// ============================================================
// RENDERER SETUP (Improved shading, shadows, tone mapping)
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;

document.body.appendChild(renderer.domElement);

const PLAYER_EYE_HEIGHT = 2.3;
const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 3.8;
const SPRINT_SPEED = 7.0;
const WORLD_LIMIT = 48;

renderer.domElement.style.display = 'block';

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
// ENVIRONMENT MAP & LIGHTING (from the "shadowing" code)
// ============================================================
let envMap = null;
const cubeTextureLoader = new THREE.CubeTextureLoader();
const cubeMap = cubeTextureLoader.load(
  ['img/stars.jpg', 'img/stars.jpg', 'img/stars.jpg', 'img/stars.jpg', 'img/stars.jpg', 'img/stars.jpg'],
  (cubeMap) => {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    envMap = pmremGenerator.fromCubemap(cubeMap).texture;
    pmremGenerator.dispose();
    updateAllMaterialEnvMaps(envMap);
    scene.background = envMap;   // use the filtered environment as background
  }
);
scene.background = cubeMap;      // fallback until envMap is ready

function updateAllMaterialEnvMaps(envMap) {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.envMap = envMap;
            mat.envMapIntensity = 0.8;
            mat.needsUpdate = true;
          }
        });
      } else if (child.material instanceof THREE.MeshStandardMaterial) {
        child.material.envMap = envMap;
        child.material.envMapIntensity = 0.8;
        child.material.needsUpdate = true;
      }
    }
  });
}

// Directional light (with shadows)
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(10, 20, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096;
dirLight.shadow.mapSize.height = 4096;

scene.add(dirLight);

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

function lockPointer() {
  if (document.pointerLockElement === renderer.domElement) return;
  const lockPromise = renderer.domElement.requestPointerLock?.();
  if (lockPromise?.catch) lockPromise.catch(() => {});
}

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
  envMap: envMap,
  envMapIntensity: 0.8,
  transmission: 0.9,
  thickness: 0.5,
  ior: 1.5,
});
const glassBox = new THREE.Mesh(boxGeometry, glassMaterial);
glassBox.position.set(0, 1.8, -0.5);
glassBox.receiveShadow = true;
scene.add(glassBox);

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
// TABLE MODEL LOADING (with shadows and envMap)
// ============================================================
let tableObject;
loader.load('models/table.obj', (object) => {
  const tableMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.1,
    envMap: envMap,
    envMapIntensity: 0.8
  });

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = tableMaterial;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  object.position.set(0, 0, 0);
  scene.add(object);
  tableObject = object;

  if (envMap) {
    object.traverse((child) => {
      if (child.material) {
        child.material.envMap = envMap;
        child.material.envMapIntensity = 0.8;
        child.material.needsUpdate = true;
      }
    });
  }

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
    metalness: 0.1,
    envMap: envMap,
    envMapIntensity: 0.8
  });

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = wireframeMaterial;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  object.position.set(0, 0, 0);
  scene.add(object);
  tablewireframeObject = object;

  if (envMap) {
    object.traverse((child) => {
      if (child.material) {
        child.material.envMap = envMap;
        child.material.envMapIntensity = 0.8;
        child.material.needsUpdate = true;
      }
    });
  }

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

// Web Audio filters
let filters = null;
let filtersInitialized = false;

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

  filtersInitialized = true;
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
  if (!sound || !filtersInitialized) return;
  const activeAudioFilter = activeFilter && filters?.[activeFilter]
    ? [filters[activeFilter]]
    : [];
  sound.setFilters(activeAudioFilter);
}

function applyActiveFilterParameters() {
  const activeKnobNames = filterConfig[activeFilter]?.knobs ?? [];
  for (const knobName of activeKnobNames) {
    const knob = knobObjects.find(candidate => candidate.userData.name === knobName);
    if (knob) updateFilterParameter(knobName, knob.userData.value);
  }
}

// Waveform display material (shader)
const waveformMaterial = new THREE.ShaderMaterial({
  uniforms: {
    minX: { value: -1.5 },
    maxX: { value: 1.5 },
    linePositionX: { value: 0 },
    color: { value: new THREE.Color(0xff0000) }
  },
  vertexShader: `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float minX;
    uniform float maxX;
    uniform float linePositionX;
    uniform vec3 color;
    varying vec3 vPos;
    void main() {
      float worldX = vPos.x + linePositionX;
      if (worldX < minX || worldX > maxX) discard;
      gl_FragColor = vec4(color, 1.0);
    }
  `
});

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

function selectAudioSource(source) {
  stopCurrentPlayback();
  disposeCurrentWaveform();
  waveformData = null;
  currentSource = source;
  sourceRequestVersion += 1;
  pendingSourceVersion = sourceRequestVersion;
  soundReady = false;
  waveformReady = false;
}

function stopCurrentPlayback() {
  if (sound.isPlaying) sound.stop();
  if (waveformData) waveformData.soundStarted = false;
}

function loadAudioSource(source, requestVersion) {
  soundReady = false;
  waveformReady = false;
  initializeFilters();

  if (source.kind === 'procedural') {
    const generatedSignal = createProceduralSignal(listener.context, source.signal);
    finishLoadingSource(generatedSignal.buffer, generatedSignal.visualizationSamples, true, requestVersion);
    return;
  }

  audioLoader.load(source.url, (buffer) => {
    if (requestVersion !== sourceRequestVersion) return;
    finishLoadingSource(buffer, buffer.getChannelData(0), false, requestVersion);
  }, null, (err) => {
    if (requestVersion === sourceRequestVersion) console.error('Audio Load Error:', err);
  });
}

function finishLoadingSource(buffer, visualizationSamples, isStatic, requestVersion) {
  if (requestVersion !== sourceRequestVersion) return;

  disposeCurrentWaveform();
  sound.setBuffer(buffer);
  sound.setLoop(true);
  sound.setPlaybackRate(getPitchPlaybackRate());
  sound.setRefDistance(2);
  sound.setRolloffFactor(1);
  sound.setDistanceModel('inverse');
  sound.setDirectionalCone(360, 360, 1);
  applyActiveFilterParameters();
  rewireAudioGraph();

  const totalWidth = isStatic ? 3 : buffer.duration * 20;
  const fullWaveformGeometry = new THREE.BufferGeometry();
  const fullPositions = new Float32Array(visualizationSamples.length * 3);
  const amplitude = isStatic ? 2 : 0.8;

  for (let index = 0; index < visualizationSamples.length; index += 1) {
    fullPositions[index * 3] = (index / Math.max(visualizationSamples.length - 1, 1)) * totalWidth - 1.5;
    fullPositions[index * 3 + 1] = 1.8 + visualizationSamples[index] * amplitude;
    fullPositions[index * 3 + 2] = -0.5;
  }

  fullWaveformGeometry.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
  const fullWaveform = new THREE.Line(fullWaveformGeometry, waveformMaterial);
  fullWaveform.position.x = 0;
  waveformMaterial.uniforms.linePositionX.value = 0;
  currentWaveformMesh = fullWaveform;
  scene.add(fullWaveform);

  waveformData = {
    line: fullWaveform,
    duration: buffer.duration,
    totalWidth,
    isStatic,
    sound,
    startTime: null,
    pausedElapsed: 0,
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

function disposeCurrentWaveform() {
  if (!currentWaveformMesh) return;
  scene.remove(currentWaveformMesh);
  currentWaveformMesh.geometry.dispose();
  currentWaveformMesh = null;
}

function getPitchPlaybackRate() {
  const pitch = knobObjects.find(knob => knob.userData.name === 'pitchknob');
  return pitch ? 0.5 + pitch.userData.value : 1;
}

function togglePauseResume() {
  if (!stopbutton.userData.clicked) {
    stopbutton.userData.clicked = true;
    if (waveformData?.soundStarted) {
      sound.pause();
      const currentTime = listener.context.currentTime;
      waveformData.pausedElapsed = currentTime - waveformData.startTime;
      waveformData.soundStarted = false;
    }
  } else {
    stopbutton.userData.clicked = false;
    if (waveformData && !sound.isPlaying) {
      sound.play();
      waveformData.startTime = listener.context.currentTime - waveformData.pausedElapsed;
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
    color: 0xff0000,
    depthTest: false,
    depthWrite: false
  });
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  scene.add(line);

  // Create the yellow sphere that marks the cutoff frequency
  const sphereGeom = new THREE.SphereGeometry(1, 16, 16);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    depthTest: false,
    depthWrite: false
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
      const playbackRate = 0.5 + knob.userData.value * 1.0;
      displayValue = playbackRate.toFixed(2) + 'x';
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
    metalness: 0.0,
    envMap: envMap,
    envMapIntensity: 0.6
  });

  button = new THREE.Mesh(geometry, material);
  button.position.copy(position);
  button.castShadow = true;
  button.receiveShadow = true;
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
const pitchknob = createKnobMesh(new THREE.Vector3(0.0, 1.24, 1.3), 'pitchknob', 0.5, 0.5, 1.5);
const cutoffknob = createKnobMesh(new THREE.Vector3(-0.3, 1.24, 1.05), 'cutoffknob', 0.5, 20, 20000);
const gainknob = createKnobMesh(new THREE.Vector3(0.0, 1.24, 1.05), 'gainknob', 0.5, -18, 18);
const resonanceknob = createKnobMesh(new THREE.Vector3(0.3, 1.24, 1.05), 'resonanceknob', 0.1, 0.1, 20);

function updateFilterParameter(knobName, value) {
  if (!filtersInitialized) return;
  const paramType = knobToFilter[knobName];
  if (paramType === 'pitch') {
    if (waveformData && waveformData.sound) {
      const playbackRate = 0.5 + value * 1.0;
      waveformData.sound.setPlaybackRate(playbackRate);
    }
    return;
  }
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

  if (!collidesWithTable(candidatePosition)) {
    camera.position.copy(candidatePosition);
    return;
  }

  axisCandidatePosition.copy(camera.position);
  axisCandidatePosition.x = candidatePosition.x;
  clampToWorld(axisCandidatePosition);
  if (!collidesWithTable(axisCandidatePosition)) {
    camera.position.x = axisCandidatePosition.x;
  }

  axisCandidatePosition.copy(camera.position);
  axisCandidatePosition.z = candidatePosition.z;
  clampToWorld(axisCandidatePosition);
  if (!collidesWithTable(axisCandidatePosition)) {
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
    sound.play();
    waveformData.startTime = listener.context.currentTime;
    waveformData.soundStarted = true;
    if (currentPlayingButton && !currentPlayingButton.userData.pressed) {
      currentPlayingButton.userData.pressed = true;
      currentPlayingButton.userData.isAnimating = true;
      currentPlayingButton.userData.animationStart = Date.now();
      currentPlayingButton.userData.originalY = buttonPositions[currentPlayingButton.userData.name];
    }
  }

  if (waveformData && waveformData.soundStarted && !waveformData.isStatic && !stopbutton.userData.clicked) {
    const currentTime = listener.context.currentTime;
    const elapsed = currentTime - waveformData.startTime;
    const playbackElapsed = elapsed * sound.getPlaybackRate();
    const progressRatio = (playbackElapsed % waveformData.duration) / waveformData.duration;
    const offset = progressRatio * waveformData.totalWidth;
    waveformData.line.position.x = -offset;
    waveformData.line.material.uniforms.linePositionX.value = waveformData.line.position.x;
  }
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
  if (controls.isLocked) {
    mouseClick.set(0, 0);
    raycaster.setFromCamera(mouseClick, camera);
    const intersects = raycaster.intersectObjects(knobObjects);
    if (intersects.length > 0) {
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
    if (intersects.length > 0) {
      activeKnob = intersects[0].object;
      previousMouseY = event.clientY;
      isDraggingKnob = true;
      event.preventDefault();
    }
  }
});

window.addEventListener('mouseup', () => {
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
  if (activeKnob && isDraggingKnob) {
    const deltaY = event.movementY;
    activeKnob.userData.value += deltaY * 0.01;
    activeKnob.userData.value = Math.max(0, Math.min(1, activeKnob.userData.value));
    const angleRange = 270 * Math.PI / 180;
    const rotationAngle = Math.PI - (activeKnob.userData.value - 0.5) * angleRange;
    activeKnob.rotation.y = rotationAngle;
    updateFilterParameter(activeKnob.userData.name, activeKnob.userData.value);
    updateKnobValueDisplay(activeKnob);
    updateGlobalFilterState();
    updateFrequencyResponseLine();
    event.stopPropagation();
  }
}

window.addEventListener('mousemove', (event) => {
  if (!controls.isLocked && activeKnob && isDraggingKnob) {
    const deltaY = previousMouseY - event.clientY;
    activeKnob.userData.value += deltaY * 0.005;
    activeKnob.userData.value = Math.max(0, Math.min(1, activeKnob.userData.value));
    const angleRange = 270 * Math.PI / 180;
    const rotationAngle = Math.PI - (activeKnob.userData.value - 0.5) * angleRange;
    activeKnob.rotation.y = rotationAngle;
    updateFilterParameter(activeKnob.userData.name, activeKnob.userData.value);
    updateKnobValueDisplay(activeKnob);
    updateGlobalFilterState();
    updateFrequencyResponseLine();
    previousMouseY = event.clientY;
  }
});

window.addEventListener('click', (event) => {
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

  // Red response line + cutoff sphere now clearly show filter effects
  updateFrequencyResponseLine();

  renderer.render(scene, camera);
}
updateGlobalFilterState();

animate();
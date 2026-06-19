import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const PLAYER_EYE_HEIGHT = 2.3;
const ARM_SHADOW_CAMERA_HALF_SIZE = 90;

export function createSceneRuntime() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.physicallyCorrectLights = true;
  renderer.domElement.style.display = 'block';
  renderer.domElement.tabIndex = 0;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020308);
  scene.backgroundIntensity = 0.7;
  scene.environmentIntensity = 1;

  loadEnvironment(renderer, scene);

  const armLight = createArmLight(renderer);
  const tableLight = createTableLight(renderer);
  scene.add(armLight, tableLight);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, PLAYER_EYE_HEIGHT, 5);
  camera.lookAt(0, 1.3, 0);

  const listener = new THREE.AudioListener();
  camera.add(listener);

  const controls = new PointerLockControls(camera, renderer.domElement);
  const crosshair = createCrosshair();
  controls.addEventListener('lock', () => {
    crosshair.style.display = 'block';
  });
  controls.addEventListener('unlock', () => {
    crosshair.style.display = 'none';
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function lockPointer() {
    if (document.pointerLockElement === renderer.domElement) return;
    const lockPromise = renderer.domElement.requestPointerLock?.();
    if (lockPromise?.catch) lockPromise.catch(() => {});
  }

  return {
    renderer,
    scene,
    camera,
    listener,
    controls,
    armLight,
    tableLight,
    lockPointer
  };
}

function loadEnvironment(renderer, scene) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  new EXRLoader().load(
    'assets/environment/night-sky-4k.exr',
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
}

function createArmLight(renderer) {
  const light = new THREE.DirectionalLight(0xffffff, 0.9);
  const mapSize = Math.min(8192, renderer.capabilities.maxTextureSize);
  light.position.set(100, 200, 50);
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.camera.left = -ARM_SHADOW_CAMERA_HALF_SIZE;
  light.shadow.camera.right = ARM_SHADOW_CAMERA_HALF_SIZE;
  light.shadow.camera.top = ARM_SHADOW_CAMERA_HALF_SIZE;
  light.shadow.camera.bottom = -ARM_SHADOW_CAMERA_HALF_SIZE;
  light.shadow.camera.updateProjectionMatrix();
  return light;
}

function createTableLight(renderer) {
  const light = new THREE.DirectionalLight(0xffffff, 0.9);
  const mapSize = Math.min(8192, renderer.capabilities.maxTextureSize);
  light.position.set(25, 50, 12.5);
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.camera.updateProjectionMatrix();
  return light;
}

function createCrosshair() {
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
  return crosshair;
}

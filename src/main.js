import * as THREE from 'three';
import './styles/main.css';
import { createAudioController } from './audio/audio-controller.js';
import { createSceneRuntime } from './core/scene-runtime.js';
import { createControlPanel } from './controls/control-panel.js';
import { createPlayerController, PLAYER_CONFIG } from './player/player-controller.js';
import { restrictShadowCastingToLight } from './rendering/shadow-caster.js';
import { createPitchRobotArm } from './robot/pitch-robot-arm.js';
import { createIntroDialog } from './ui/intro-dialog.js';
import { createSkylineVisualizer } from './world/skyline/skyline-visualizer.js';
import { createWorld } from './world/world.js';

const runtime = createSceneRuntime();
const {
  renderer,
  scene,
  camera,
  listener,
  controls,
  armLight,
  tableLight,
  lockPointer
} = runtime;

const world = createWorld({
  scene,
  tableLight,
  playerRadius: PLAYER_CONFIG.radius
});

const introDialog = createIntroDialog({
  renderer,
  controls,
  lockPointer
});

const audio = createAudioController({
  scene,
  listener,
  waveformBounds: world.waveformBounds,
  attachSound: world.attachToTable
});

const skyline = createSkylineVisualizer({
  scene,
  camera,
  audio: audio.sound
});

const pitchRobotArm = createPitchRobotArm(scene);
restrictShadowCastingToLight(pitchRobotArm.root, armLight);
const pitchRobotTarget = new THREE.Vector3();

const player = createPlayerController({
  camera,
  controls,
  getTableCollisionBox: world.getTableCollisionBox,
  getRobotCollision: () => pitchRobotArm.collision
});

const controlPanel = createControlPanel({
  scene,
  camera,
  renderer,
  controls,
  tableLight,
  introDialog,
  lockPointer,
  audio,
  skyline
});

window.addEventListener('keydown', (event) => {
  if (introDialog.isOpen()) {
    if (event.code === 'Escape') {
      introDialog.hide(false);
      event.preventDefault();
    }
    return;
  }

  if (event.code === 'Space') {
    controlPanel.togglePlayback();
    event.preventDefault();
    return;
  }
  player.setKey(event.code, true);
});

window.addEventListener('keyup', (event) => {
  if (!introDialog.isOpen()) player.setKey(event.code, false);
});

let lastFrameMs = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = Math.min((now - lastFrameMs) / 1000, 0.05);
  lastFrameMs = now;

  player.update(delta);
  const audioState = audio.update();
  controlPanel.update(audioState);
  skyline.update();

  if (audio.getPitchMode() === 'frequency') {
    const target = skyline.getTargetPosition(controlPanel.getPitchValue(), pitchRobotTarget);
    pitchRobotArm.update(target, delta, true);
  } else {
    pitchRobotArm.update(null, delta, false);
  }

  renderer.render(scene, camera);
}

animate();

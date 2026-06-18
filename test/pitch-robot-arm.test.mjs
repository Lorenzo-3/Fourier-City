import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createPitchRobotArm } from '../pitch-robot-arm.js';

const FRAME_SECONDS = 1 / 60;
const CONTACT_TOLERANCE = 1e-4;

test('places the pyramid tip exactly on an active target', () => {
  const scene = new THREE.Scene();
  const arm = createPitchRobotArm(scene);
  const target = new THREE.Vector3(100, 24, -75);

  arm.update(target, FRAME_SECONDS, true);

  assert.ok(getNeedleTip(scene).distanceTo(target) < CONTACT_TOLERANCE);
});

test('keeps contact when the target roof rises abruptly', () => {
  const scene = new THREE.Scene();
  const arm = createPitchRobotArm(scene);
  const target = new THREE.Vector3(0, 1, -135);

  arm.update(target, FRAME_SECONDS, true);
  target.y = 60;
  arm.update(target, FRAME_SECONDS, true);

  assert.ok(getNeedleTip(scene).distanceTo(target) < CONTACT_TOLERANCE);
});

function getNeedleTip(scene) {
  scene.updateMatrixWorld(true);
  const needle = scene.getObjectByName('PitchRobotArmNeedleHead');
  const positions = needle.geometry.getAttribute('position');
  const vertex = new THREE.Vector3();
  const tip = new THREE.Vector3();
  let minimumY = Infinity;

  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index).applyMatrix4(needle.matrixWorld);
    if (vertex.y < minimumY) {
      minimumY = vertex.y;
      tip.copy(vertex);
    }
  }

  return tip;
}

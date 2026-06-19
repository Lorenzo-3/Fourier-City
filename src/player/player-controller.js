import * as THREE from 'three';
import { collidesWithCircle } from './collision.js';

export const PLAYER_CONFIG = Object.freeze({
  eyeHeight: 2.3,
  radius: 0.35,
  walkSpeed: 3.8,
  sprintSpeed: 7,
  worldLimit: 48
});

export function createPlayerController({ camera, controls, getTableCollisionBox, getRobotCollision }) {
  const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false
  };
  const move = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const candidate = new THREE.Vector3();
  const axisCandidate = new THREE.Vector3();

  function setKey(code, pressed) {
    switch (code) {
      case 'KeyW': movement.forward = pressed; return true;
      case 'KeyS': movement.backward = pressed; return true;
      case 'KeyA': movement.left = pressed; return true;
      case 'KeyD': movement.right = pressed; return true;
      case 'ShiftLeft': movement.sprint = pressed; return true;
      default: return false;
    }
  }

  function update(delta) {
    camera.position.y = PLAYER_CONFIG.eyeHeight;
    if (!controls.isLocked) return;

    const forwardInput = Number(movement.forward) - Number(movement.backward);
    const rightInput = Number(movement.right) - Number(movement.left);
    if (forwardInput === 0 && rightInput === 0) return;

    controls.getDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() === 0) return;
    forward.normalize();

    right.setFromMatrixColumn(camera.matrix, 0);
    right.y = 0;
    right.normalize();

    move.set(0, 0, 0)
      .addScaledVector(forward, forwardInput)
      .addScaledVector(right, rightInput);
    if (move.lengthSq() === 0) return;

    const speed = movement.sprint ? PLAYER_CONFIG.sprintSpeed : PLAYER_CONFIG.walkSpeed;
    move.normalize().multiplyScalar(speed * delta);
    candidate.copy(camera.position).add(move);
    candidate.y = PLAYER_CONFIG.eyeHeight;
    clampToWorld(candidate);

    if (!collidesWithObstacle(candidate)) {
      camera.position.copy(candidate);
      return;
    }

    axisCandidate.copy(camera.position);
    axisCandidate.x = candidate.x;
    clampToWorld(axisCandidate);
    if (!collidesWithObstacle(axisCandidate)) camera.position.x = axisCandidate.x;

    axisCandidate.copy(camera.position);
    axisCandidate.z = candidate.z;
    clampToWorld(axisCandidate);
    if (!collidesWithObstacle(axisCandidate)) camera.position.z = axisCandidate.z;
    camera.position.y = PLAYER_CONFIG.eyeHeight;
  }

  function collidesWithObstacle(position) {
    return collidesWithTable(position)
      || collidesWithCircle(position, getRobotCollision(), PLAYER_CONFIG.radius);
  }

  function collidesWithTable(position) {
    const box = getTableCollisionBox();
    if (!box) return false;
    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    const dx = position.x - centerX;
    const dz = position.z - centerZ;
    const radius = Math.max(
      Math.abs(box.max.x - centerX),
      Math.abs(box.max.z - centerZ)
    );
    return (dx * dx + dz * dz) <= radius * radius;
  }

  function clampToWorld(position) {
    position.x = THREE.MathUtils.clamp(
      position.x,
      -PLAYER_CONFIG.worldLimit,
      PLAYER_CONFIG.worldLimit
    );
    position.z = THREE.MathUtils.clamp(
      position.z,
      -PLAYER_CONFIG.worldLimit,
      PLAYER_CONFIG.worldLimit
    );
  }

  return { setKey, update };
}

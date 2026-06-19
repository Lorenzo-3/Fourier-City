import * as THREE from 'three';
import { solveTwoLinkArm } from './two-link-kinematics.js';

const BASE_POSITION = new THREE.Vector3(0, 0, 9.5);
const SHOULDER_HEIGHT = 5;
const PEDESTAL_RADIUS = 1.35;
const LINK_LENGTH = 90;
const LINK_THICKNESS = 0.9;
const NEEDLE_HEIGHT = 4.5;
const NEEDLE_RADIUS = 1.4;
const BASE_DAMPING = 2.8;
const SHOULDER_DAMPING = 4.1;
const ELBOW_DAMPING = 3.2;
const WRIST_DAMPING = 5.5;
const ACTIVE_COLOR = new THREE.Color(0xff33ff);
const DISABLED_COLOR = new THREE.Color(0x512551);

export function createPitchRobotArm(scene) {
  const root = new THREE.Group();
  root.name = 'PitchRobotArm';
  root.position.copy(BASE_POSITION);

  const baseYaw = new THREE.Group();
  baseYaw.name = 'PitchRobotArmBaseYaw';
  baseYaw.position.y = SHOULDER_HEIGHT;
  root.add(baseYaw);

  const shoulder = new THREE.Group();
  shoulder.name = 'PitchRobotArmShoulder';
  baseYaw.add(shoulder);

  const elbow = new THREE.Group();
  elbow.name = 'PitchRobotArmElbow';
  elbow.position.z = LINK_LENGTH;
  shoulder.add(elbow);

  const wrist = new THREE.Group();
  wrist.name = 'PitchRobotArmWrist';
  wrist.position.z = LINK_LENGTH;
  elbow.add(wrist);

  const armMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9c7d6,
    emissive: 0x172432,
    roughness: 0.28,
    metalness: 0.72
  });
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: 0x293746,
    emissive: 0x09121d,
    roughness: 0.2,
    metalness: 0.85
  });
  const sliderMaterial = new THREE.MeshStandardMaterial({
    color: ACTIVE_COLOR,
    emissive: ACTIVE_COLOR,
    emissiveIntensity: 1.6,
    roughness: 0.2,
    metalness: 0.45
  });

  const basePlate = createCylinderMesh(PEDESTAL_RADIUS, PEDESTAL_RADIUS, 0.6, jointMaterial);
  basePlate.position.y = 0.3;
  root.add(basePlate);

  const pedestal = createCylinderMesh(0.45, 0.8, SHOULDER_HEIGHT - 0.6, armMaterial);
  pedestal.position.y = (SHOULDER_HEIGHT + 0.6) / 2;
  root.add(pedestal);

  const rotatingBase = createCylinderMesh(0.9, 0.9, 0.9, jointMaterial);
  rotatingBase.position.y = -0.55;
  baseYaw.add(rotatingBase);

  const shoulderJoint = createJointMesh(jointMaterial, 0.9);
  shoulder.add(shoulderJoint);
  const shoulderMotorRing = createMotorRing(armMaterial, 1.25);
  shoulder.add(shoulderMotorRing);

  const firstLink = createLinkMesh(armMaterial);
  shoulder.add(firstLink);

  const elbowJoint = createJointMesh(jointMaterial, 1.1);
  elbow.add(elbowJoint);
  const elbowMotorRing = createMotorRing(armMaterial, 1.45);
  elbow.add(elbowMotorRing);

  const secondLink = createLinkMesh(armMaterial);
  elbow.add(secondLink);

  const wristJoint = createJointMesh(jointMaterial, 0.8);
  wrist.add(wristJoint);

  const needleHead = createInvertedPyramidMesh(NEEDLE_RADIUS, NEEDLE_HEIGHT, sliderMaterial);
  needleHead.name = 'PitchRobotArmNeedleHead';
  wrist.add(needleHead);

  scene.add(root);

  const shoulderWorldPosition = new THREE.Vector3();
  const targetOffset = new THREE.Vector3();
  let currentYaw = 0;
  let currentShoulder = 0;
  let currentElbow = 0;
  let currentWrist = 0;
  let movementEnergy = 0;

  return {
    root,
    collision: {
      x: BASE_POSITION.x,
      z: BASE_POSITION.z,
      radius: PEDESTAL_RADIUS
    },
    update(target, deltaSeconds, active) {
      const safeDelta = Math.max(0, deltaSeconds);
      const isTracking = Boolean(target && active);
      let targetYaw = 0;
      let targetShoulder = -Math.PI / 2;
      let targetElbow = 0;

      if (isTracking) {
        shoulderWorldPosition.copy(root.position);
        shoulderWorldPosition.y += SHOULDER_HEIGHT;
        targetOffset.copy(target).sub(shoulderWorldPosition);
        targetOffset.y += NEEDLE_HEIGHT;
        targetYaw = Math.atan2(targetOffset.x, targetOffset.z);
        const horizontalDistance = Math.hypot(targetOffset.x, targetOffset.z);
        const solution = solveTwoLinkArm(
          horizontalDistance,
          -targetOffset.y,
          LINK_LENGTH,
          LINK_LENGTH
        );
        targetShoulder = solution.shoulderAngle;
        targetElbow = solution.elbowAngle;
      }

      const yawDifference = angleDifference(currentYaw, targetYaw);
      movementEnergy = THREE.MathUtils.lerp(
        movementEnergy,
        isTracking ? Math.min(1, Math.abs(yawDifference) * 2.5) : 0,
        1 - Math.exp(-5 * safeDelta)
      );

      if (isTracking) {
        currentYaw = targetYaw;
        currentShoulder = targetShoulder;
        currentElbow = targetElbow;
        currentWrist = -(currentShoulder + currentElbow);
      } else {
        currentYaw = dampAngle(currentYaw, targetYaw, dampingBlend(BASE_DAMPING, safeDelta));
        currentShoulder = dampAngle(
          currentShoulder,
          targetShoulder,
          dampingBlend(SHOULDER_DAMPING, safeDelta)
        );
        currentElbow = dampAngle(
          currentElbow,
          targetElbow,
          dampingBlend(ELBOW_DAMPING, safeDelta)
        );
        currentWrist = dampAngle(
          currentWrist,
          -(currentShoulder + currentElbow),
          dampingBlend(WRIST_DAMPING, safeDelta)
        );
      }

      baseYaw.rotation.y = currentYaw;
      shoulder.rotation.x = currentShoulder;
      elbow.rotation.x = currentElbow;
      wrist.rotation.x = currentWrist;

      const motorSpeed = isTracking ? 0.7 + movementEnergy * 5 : 0;
      shoulderMotorRing.rotation.z += safeDelta * motorSpeed;
      elbowMotorRing.rotation.z -= safeDelta * motorSpeed * 1.35;
      wrist.rotation.z = 0;

      const materialBlend = dampingBlend(4, safeDelta);
      sliderMaterial.color.lerp(isTracking ? ACTIVE_COLOR : DISABLED_COLOR, materialBlend);
      sliderMaterial.emissive.copy(sliderMaterial.color);
      sliderMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        sliderMaterial.emissiveIntensity,
        isTracking ? 1.6 : 0.18,
        materialBlend
      );
    }
  };
}

function createLinkMesh(material) {
  const geometry = new THREE.BoxGeometry(LINK_THICKNESS, LINK_THICKNESS, LINK_LENGTH);
  geometry.translate(0, 0, LINK_LENGTH / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createJointMesh(material, radius = 7) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createMotorRing(material, radius) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.24, 10, 32), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createInvertedPyramidMesh(radius, height, material) {
  const geometry = new THREE.ConeGeometry(radius, height, 4);
  geometry.rotateX(Math.PI);
  geometry.translate(0, -height / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createCylinderMesh(topRadius, bottomRadius, height, material) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius, bottomRadius, height, 24),
    material
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function dampAngle(current, target, blend) {
  return current + angleDifference(current, target) * blend;
}

function angleDifference(current, target) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function dampingBlend(damping, deltaSeconds) {
  return 1 - Math.exp(-damping * deltaSeconds);
}

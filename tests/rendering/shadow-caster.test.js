import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { restrictShadowCastingToLight } from '../../src/rendering/shadow-caster.js';

test('writes mesh depth during the assigned light shadow pass', () => {
  const mesh = createRestrictedMesh();
  const group = new THREE.Group();
  group.add(mesh);
  const assignedLight = new THREE.DirectionalLight();

  restrictShadowCastingToLight(group, assignedLight);
  runBeforeShadow(mesh, assignedLight);

  assert.equal(mesh.customDepthMaterial.colorWrite, true);
  assert.equal(mesh.customDepthMaterial.depthWrite, true);
});

test('does not write mesh depth during another light shadow pass', () => {
  const mesh = createRestrictedMesh();
  const assignedLight = new THREE.DirectionalLight();
  const otherLight = new THREE.DirectionalLight();

  restrictShadowCastingToLight(mesh, assignedLight);
  runBeforeShadow(mesh, otherLight);

  assert.equal(mesh.customDepthMaterial.colorWrite, false);
  assert.equal(mesh.customDepthMaterial.depthWrite, false);

  runBeforeShadow(mesh, assignedLight);
  assert.equal(mesh.customDepthMaterial.colorWrite, true);
  assert.equal(mesh.customDepthMaterial.depthWrite, true);
});

function createRestrictedMesh() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
}

function runBeforeShadow(mesh, light) {
  mesh.onBeforeShadow(
    null,
    mesh,
    null,
    light.shadow.camera,
    mesh.geometry,
    mesh.customDepthMaterial,
    null
  );
}

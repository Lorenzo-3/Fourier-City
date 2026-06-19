import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function loadText(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    return response.text();
  });
}

export function getNormalizeMatrix(model, yawDegrees = 0) {
  model.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const minimum = bounds.min;
  return new THREE.Matrix4().makeTranslation(-center.x, -minimum.y, -center.z);
}

export function buildInstancedGeometry(model, normalizeMatrix) {
  const geometries = [];
  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    geometry.applyMatrix4(normalizeMatrix);
    geometries.push(geometry);
  });
  if (geometries.length === 0) throw new Error('Skyline model contains no mesh geometry');
  const mergedGeometry = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  if (!mergedGeometry) throw new Error('Unable to merge skyline model geometry');
  mergedGeometry.computeBoundingBox();
  mergedGeometry.computeBoundingSphere();
  return mergedGeometry;
}

export function buildQuadWireframeGeometry(objText, normalizeMatrix, yawDegrees = 0) {
  const vertices = [];
  const segments = [];
  const edgeKeys = new Set();
  const addEdge = (a, b) => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    segments.push([low, high]);
  };

  const transform = new THREE.Matrix4()
    .makeRotationY(THREE.MathUtils.degToRad(yawDegrees))
    .premultiply(normalizeMatrix);
  for (const line of objText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const [, x, y, z] = trimmed.split(/\s+/);
      vertices.push(new THREE.Vector3(Number(x), Number(y), Number(z)).applyMatrix4(transform));
    } else if (trimmed.startsWith('f ')) {
      const indices = trimmed.split(/\s+/).slice(1).map((entry) => Number(entry.split('/')[0]) - 1);
      for (let index = 0; index < indices.length; index += 1) {
        addEdge(indices[index], indices[(index + 1) % indices.length]);
      }
    }
  }

  const positions = new Float32Array(segments.length * 6);
  for (let index = 0; index < segments.length; index += 1) {
    const [startIndex, endIndex] = segments[index];
    const start = vertices[startIndex];
    const end = vertices[endIndex];
    positions.set([start.x, start.y, start.z, end.x, end.y, end.z], index * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

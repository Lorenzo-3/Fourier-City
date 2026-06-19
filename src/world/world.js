import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { restrictShadowCastingToLight } from '../rendering/shadow-caster.js';
import { createWaveformDisplayBounds } from '../visualization/waveform.js';

export function createWorld({ scene, tableLight, playerRadius }) {
  createFloor(scene);
  const waveformBounds = createWaveformDisplay(scene);
  const loader = new OBJLoader();
  const pendingTableChildren = [];
  let table = null;
  let tableCollisionBox = null;

  loadTableModel({
    loader,
    url: 'assets/models/table/table.obj',
    material: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1
    }),
    scene,
    tableLight,
    onLoad: setTable
  });

  loadTableModel({
    loader,
    url: 'assets/models/table/table-wireframe.obj',
    material: new THREE.MeshStandardMaterial({
      color: 0x000000,
      wireframe: true,
      roughness: 0.2,
      metalness: 0.1
    }),
    scene,
    tableLight,
    onLoad: setTable
  });

  function setTable(object) {
    table = object;
    table.updateMatrixWorld(true);
    tableCollisionBox = new THREE.Box3().setFromObject(table);
    tableCollisionBox.expandByVector(new THREE.Vector3(playerRadius, 0, playerRadius));
    while (pendingTableChildren.length > 0) table.add(pendingTableChildren.shift());
  }

  function attachToTable(object) {
    if (table) table.add(object);
    else pendingTableChildren.push(object);
  }

  return {
    waveformBounds,
    attachToTable,
    getTableCollisionBox: () => tableCollisionBox
  };
}

function createFloor(scene) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.05
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(300, 75, 0x000000, 0x000000);
  grid.position.y = 0.01;
  scene.add(grid);
}

function createWaveformDisplay(scene) {
  const geometry = new THREE.BoxGeometry(3, 1.1, 0.2);
  const display = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      transmission: 0.9,
      thickness: 0.5,
      ior: 1.5
    })
  );
  display.position.set(0, 1.8, -0.5);
  display.receiveShadow = true;
  scene.add(display);

  return createWaveformDisplayBounds({
    centerX: display.position.x,
    centerY: display.position.y,
    centerZ: display.position.z,
    width: geometry.parameters.width,
    height: geometry.parameters.height
  });
}

function loadTableModel({ loader, url, material, scene, tableLight, onLoad }) {
  loader.load(url, (object) => {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    restrictShadowCastingToLight(object, tableLight);
    object.position.set(0, 0, 0);
    scene.add(object);
    onLoad(object);
  });
}

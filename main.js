import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );


const scene = new THREE.Scene();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const camera = new THREE.PerspectiveCamera( 
    75, 
    window.innerWidth / window.innerHeight, 
    0.1, 
    1000 
);

camera.position.set(0, 5, 5);

const orbit = new OrbitControls( camera, renderer.domElement );
orbit.update();

const axesHelper = new THREE.AxesHelper( 3 );
scene.add( axesHelper );

const floorGeometry = new THREE.PlaneGeometry( 100, 100 );
const floorMaterial = new THREE.MeshBasicMaterial( { color: 0xffff, side: THREE.DoubleSide } );
const floor = new THREE.Mesh( floorGeometry, floorMaterial );
floor.rotation.x = -Math.PI / 2;
scene.add( floor );

const gridfloorhelper = new THREE.GridHelper( 100, 100);
scene.add( gridfloorhelper );

const loader = new OBJLoader();
loader.load('models/table.obj', (object) => {
    const blackMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = blackMaterial;
        }
    });
    object.position.set(0, 0, 0);
    scene.add(object);
});
loader.load('models/table_wireframe.obj', (object) => {
    const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = wireframeMaterial;
        }
        

    });
    object.position.set(0, 0, 0);
    scene.add(object);
});



renderer.render( scene, camera );

function animate() {
    requestAnimationFrame( animate );
    renderer.render( scene, camera );
}

animate();
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio);
document.body.appendChild( renderer.domElement );


const scene = new THREE.Scene();
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const camera = new THREE.PerspectiveCamera( 
    75, 
    window.innerWidth / window.innerHeight, 
    0.1, 
    1000 
);

camera.position.set(0, 5, 5);

// Audio listener
const listener = new THREE.AudioListener();
camera.add( listener );


const orbit = new OrbitControls( camera, renderer.domElement );
orbit.update();

const floorGeometry = new THREE.PlaneGeometry( 100, 100 );
const floorMaterial = new THREE.MeshBasicMaterial( { color: 0x808080 } );
const floor = new THREE.Mesh( floorGeometry, floorMaterial );
floor.rotation.x = -Math.PI / 2;
scene.add( floor );

const gridfloorhelper = new THREE.GridHelper( 100, 100);
scene.add( gridfloorhelper );

// Create glass parallelepiped for waveform
const boxGeometry = new THREE.BoxGeometry(3, 1.1, 0.2);
const glassMaterial = new THREE.MeshPhongMaterial({
    color: 0xcccccc,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    wireframe: false
});
const glassBox = new THREE.Mesh(boxGeometry, glassMaterial);
glassBox.position.set(0, 1.8, -0.5);
scene.add(glassBox);

const loader = new OBJLoader();

let tableObject;
loader.load('models/table.obj', (object) => {
    const blackMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = blackMaterial;
        }
    });
    object.position.set(0, 0, 0);
    scene.add(object);
    tableObject = object;
});

let tablewireframeObject;
loader.load('models/table_wireframe.obj', (object) => {
    const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = wireframeMaterial;
        }
   });
    object.position.set(0, 0, 0);
    scene.add(object);
    tablewireframeObject = object;
});

// Load audio
const sound = new THREE.PositionalAudio( listener );
const audioLoader = new THREE.AudioLoader();

let waveformData = null;  
audioLoader.load( 'sounds/ijustthrewouthelovefmydreams.mp3', function( buffer ) {
    sound.setBuffer( buffer );
    sound.setRefDistance( 2 );
    sound.setRolloffFactor( 1 );
    sound.setDistanceModel( 'inverse' );
    sound.setDirectionalCone( 360, 360, 1 );
    
    // Extract full waveform data from audio buffer
    const rawAudioData = buffer.getChannelData(0);
    
    // Create full waveform geometry
    const fullWaveformGeometry = new THREE.BufferGeometry();
    const fullPositions = new Float32Array(rawAudioData.length * 3);
    const duration = buffer.duration;
    const width = 20; // units per second
    const totalWidth = duration * width;

    const amplitude = 0.8; // Scale factor for waveform height
    for (let i = 0; i < rawAudioData.length; i++) {
        // X-axis: Time progression
        fullPositions[i * 3] = (i / rawAudioData.length) * totalWidth -1.5; 
        // Y-axis: Sound amplitude
        fullPositions[i * 3 + 1] = 1.8 + rawAudioData[i] * amplitude;
        // Z-axis: Flat plane
        fullPositions[i * 3 + 2] = -0.5;
    }
    
    fullWaveformGeometry.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
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

            gl_Position = projectionMatrix *
                          modelViewMatrix *
                          vec4(position, 1.0);
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

            if (worldX < minX || worldX > maxX) {
                discard;
            }

            gl_FragColor = vec4(color, 1.0);
        }
    `
    });

    const fullWaveform = new THREE.Line(fullWaveformGeometry, waveformMaterial);
    scene.add(fullWaveform);
    
    // Store waveform data for scrolling
    waveformData = {
        line: fullWaveform,
        duration: duration,
        totalWidth: totalWidth,
        sound: sound,
        startTime: null
    };
    
    // Add sound to the table object when available, otherwise add to scene
    if (tableObject) {
        tableObject.add(sound);
    } else {
        scene.add(sound);
    }
});

renderer.render( scene, camera );

function animate() {
    requestAnimationFrame( animate );

    if (waveformData && !waveformData.soundStarted) {
        waveformData.sound.play();
        waveformData.startTime = listener.context.currentTime;
        waveformData.soundStarted = true;
    }
    // Update waveform position based on playback
    if (waveformData && waveformData.soundStarted) {
        const currentTime = listener.context.currentTime;
        const elapsed = currentTime - waveformData.startTime;
        const progressRatio = elapsed / waveformData.duration;
        const offset = progressRatio * waveformData.totalWidth;
        waveformData.line.position.x = -offset;
        
        // Update shader uniform to track line position
        waveformData.line.material.uniforms.linePositionX.value = waveformData.line.position.x;
    }
    
    renderer.render( scene, camera );
}

animate();
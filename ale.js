import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio);
renderer.setClearColor(0x000000); // Set background to black
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
let newsong = true;
let song = 'sounds/ijustthrewouthelovefmydreams.mp3';
let isLoading = false; // Prevent multiple loading requests at once
let currentWaveformMesh = null; // Track current waveform mesh for cleanup

// Global shader material - created once, reused for all waveforms (avoids recompilation)
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

function loadsong(song) {
    if (isLoading) return; // Block if already loading
    isLoading = true;

    audioLoader.load(song, function(buffer) {
        // Clean up old geometry from GPU memory
        if (currentWaveformMesh) {
            scene.remove(currentWaveformMesh);
            currentWaveformMesh.geometry.dispose();
            currentWaveformMesh = null;
        }

        sound.setBuffer(buffer);
        sound.setRefDistance(2);
        sound.setRolloffFactor(1);
        sound.setDistanceModel('inverse');
        sound.setDirectionalCone(360, 360, 1);
        
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

        const fullWaveform = new THREE.Line(fullWaveformGeometry, waveformMaterial);
        currentWaveformMesh = fullWaveform; // Track for cleanup
        scene.add(fullWaveform);
        
        // Store waveform data for scrolling
        waveformData = {
            line: fullWaveform,
            duration: duration,
            totalWidth: totalWidth,
            sound: sound,
            startTime: null,
            pausedElapsed: 0
        };
        
        // Add sound to the table object when available, otherwise add to scene
        if (tableObject) {
            tableObject.add(sound);
        } else {
            scene.add(sound);
        }

        isLoading = false; // Loading complete
    }, null, function(err) {
        console.error("Audio Load Error:", err);
        isLoading = false; // Reset flag on error
    });
}


// Creating a clickable buttons
const raycaster = new THREE.Raycaster();
const mouseClick = new THREE.Vector2();

window.addEventListener('click', (event) => {

    // Calculate mouse position in normalized device coordinates
    mouseClick.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouseClick.y = - (event.clientY / window.innerHeight) * 2 + 1;

    // Update the raycaster with the camera and mouse position
    raycaster.setFromCamera(mouseClick, camera);

    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    // Find first clickable object
    let clickedObject = null;
    for (let intersection of intersects) {
        if (intersection.object.userData.type === 'clickable') {
            clickedObject = intersection.object;
            break; // Stop at first match
        }
    }

    if (clickedObject) {
        console.log('Clicked object:', clickedObject.userData.name);
        if (clickedObject.userData.name === 'SelectMusic') {
            // Open file dialog to select music file
        }else if (!clickedObject.userData.clicked) {
            // Change to  wave or music sound
            newsong = true;
            song = clickedObject.userData.mp3file;
            }
        }
});

// Space key to pause/resume
window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        event.preventDefault(); // Prevent page scroll
        
        if (!stopbutton.userData.clicked) {
            stopbutton.userData.clicked = true;
            // Pause immediately
            if (waveformData && waveformData.soundStarted) {
                waveformData.sound.pause();
                const currentTime = listener.context.currentTime;
                waveformData.pausedElapsed = currentTime - waveformData.startTime;
                waveformData.soundStarted = false;
            }
        } else {
            stopbutton.userData.clicked = false;
            // Resume immediately
            if (waveformData && waveformData.sound) {
                waveformData.sound.play();
                waveformData.startTime = listener.context.currentTime - waveformData.pausedElapsed;
                waveformData.soundStarted = true;
            }
        }
    }
});



// Stop button
const stopbuttonGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.1);
const stopbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const stopbutton = new THREE.Mesh(stopbuttonGeometry, stopbuttonMaterial);
stopbutton.position.set(0, 1.3, 0.1);
stopbutton.userData.name = 'Stop/Resume'; // Mark as clickable
stopbutton.userData.clicked = false; // Track click state (if clicked music stops, if clicked again music resumes)
scene.add(stopbutton);

// Sine, Square, Triangle, Saw Waves buttons
const sinebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const sinebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const sinebutton = new THREE.Mesh(sinebuttonGeometry, sinebuttonMaterial);
sinebutton.position.set(-0.9, 1.3, 0.1);
sinebutton.userData.type = 'clickable'; // Mark as clickable
sinebutton.userData.name = 'Sine'; // Mark as clickable
sinebutton.userData.clicked = false; // Track click state
sinebutton.userData.mp3file = 'sounds/sine_wave.mp3'; // Store associated mp3 file
scene.add(sinebutton);

const squarebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const squarebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const squarebutton = new THREE.Mesh(squarebuttonGeometry, squarebuttonMaterial);
squarebutton.position.set(-0.5, 1.3, 0.1);
squarebutton.userData.type = 'clickable'; // Mark as clickable
squarebutton.userData.name = 'Square'; // Mark as clickable
squarebutton.userData.clicked = false; // Track click state
squarebutton.userData.mp3file = 'sounds/square_wave.mp3'; // Store associated mp3 file
scene.add(squarebutton);

const trianglebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const trianglebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const trianglebutton = new THREE.Mesh(trianglebuttonGeometry, trianglebuttonMaterial);
trianglebutton.position.set(0.5, 1.3, 0.1);
trianglebutton.userData.type = 'clickable'; // Mark as clickable
trianglebutton.userData.name = 'Triangle'; // Mark as clickable
trianglebutton.userData.clicked = false; // Track click state
trianglebutton.userData.mp3file = 'sounds/triangle_wave.mp3'; // Store associated mp3 file
scene.add(trianglebutton);

const sawbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const sawbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const sawbutton = new THREE.Mesh(sawbuttonGeometry, sawbuttonMaterial);
sawbutton.position.set(0.9, 1.3, 0.1);
sawbutton.userData.type = 'clickable'; // Mark as clickable
sawbutton.userData.name = 'Saw'; // Mark as clickable
sawbutton.userData.clicked = false; // Track click state
sawbutton.userData.mp3file = 'sounds/saw_wave.mp3'; // Store associated mp3 file
scene.add(sawbutton);

const musicbuttonGeometry = new THREE.BoxGeometry(0.8, 0.1, 0.1, 4, 4, 4);
const musicbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
const musicbutton = new THREE.Mesh(musicbuttonGeometry, musicbuttonMaterial);
musicbutton.position.set(0, 1.3, 0.5);
musicbutton.userData.type = 'clickable'; // Mark as clickable
musicbutton.userData.name = 'Music'; // Mark as clickable
musicbutton.userData.clicked = true; // Track click state
musicbutton.userData.mp3file = 'sounds/ijustthrewouthelovefmydreams.mp3'; // Store associated mp3 file
scene.add(musicbutton);

const selectmusicbuttonGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.05);
const selectmusicbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xffff00 });
const selectmusicbutton = new THREE.Mesh(selectmusicbuttonGeometry, selectmusicbuttonMaterial);
selectmusicbutton.position.set(0.5, 1.3, 0.5);
selectmusicbutton.userData.type = 'clickable'; // Mark as clickable
selectmusicbutton.userData.name = 'SelectMusic'; // Mark as clickable
scene.add(selectmusicbutton);


// Pitch, Lowcut, Midcut, Highcut, Lowcut Sliders



function playmusic() {
    if (newsong) {
        loadsong(song);
        newsong = false;
    }

    // Auto-play when song is loaded and not yet started
    if (waveformData && !waveformData.soundStarted && !stopbutton.userData.clicked) {
        waveformData.sound.play();
        waveformData.startTime = listener.context.currentTime;
        waveformData.soundStarted = true;
    }
    
    // Only handle waveform animation
    if (waveformData && waveformData.soundStarted && !stopbutton.userData.clicked) {
        const currentTime = listener.context.currentTime;
        const elapsed = currentTime - waveformData.startTime;
        
        // Auto-resume when music finishes
        if (elapsed >= waveformData.duration) {
            waveformData.sound.stop();
            waveformData.sound.play();
            waveformData.startTime = listener.context.currentTime;
        }
        
        const progressRatio = elapsed / waveformData.duration;
        const offset = progressRatio * waveformData.totalWidth;
        waveformData.line.position.x = -offset;
        // Update shader uniform to track line position
        waveformData.line.material.uniforms.linePositionX.value = waveformData.line.position.x;
    }
};

function animate() {
    requestAnimationFrame( animate );
    playmusic()

    renderer.render( scene, camera );
}

animate();
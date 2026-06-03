import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio);
renderer.setClearColor(0x000000); // Set background to black
document.body.appendChild( renderer.domElement );

const PLAYER_EYE_HEIGHT = 2.5;
const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 3.8;
const SPRINT_SPEED = 7.0;
const WORLD_LIMIT = 48;

renderer.domElement.style.display = 'block';

const crosshair = document.createElement('div');
crosshair.textContent = '+';
Object.assign(crosshair.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#ffffff',
    font: '20px monospace',
    lineHeight: '20px',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '10',
    display: 'none'
});
document.body.appendChild(crosshair);

// Handle window resize
window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update renderer
    renderer.setSize(width, height);
    
    // Update camera aspect ratio
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
});

// Create hidden file input for music selection
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.mp3';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        // Stop current sound if playing
        if (waveformData && waveformData.sound && waveformData.soundStarted) {
            waveformData.sound.stop();
            waveformData.soundStarted = false;
        }
        // Update musicbutton with new file
        if (musicbutton) {
            musicbutton.userData.mp3file = url;
        }
        newsong = true;
        song = url;
        stopbutton.userData.clicked = false;
        currentPlayingButton = musicbutton;
    }
});

const scene = new THREE.Scene();
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const camera = new THREE.PerspectiveCamera( 
    75, 
    window.innerWidth / window.innerHeight, 
    0.1, 
    1000 
);

camera.position.set(0, PLAYER_EYE_HEIGHT, 5);
camera.lookAt(0, 1.3, 0);

// Audio listener
const listener = new THREE.AudioListener();
camera.add( listener );

const controls = new PointerLockControls( camera, renderer.domElement );
let lastFrameMs = performance.now();

controls.addEventListener('lock', () => {
    crosshair.style.display = 'block';
});

controls.addEventListener('unlock', () => {
    crosshair.style.display = 'none';
});

const movementState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false
};
const playerMove = new THREE.Vector3();
const playerForward = new THREE.Vector3();
const playerRight = new THREE.Vector3();
const candidatePosition = new THREE.Vector3();
const axisCandidatePosition = new THREE.Vector3();
let tableCollisionBox = null;

function lockPointer() {
    if (document.pointerLockElement === renderer.domElement) {
        return;
    }

    const lockPromise = renderer.domElement.requestPointerLock?.();

    if (lockPromise?.catch) {
        lockPromise.catch(() => {});
    }
}

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

// Create text texture from canvas
function createTextTexture(text, size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Transparent background
    ctx.clearRect(0, 0, size, size);
    
    // Text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

// Create sprite above button
function createTextSprite(text, position) {
    const texture = createTextTexture(text);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.position.y += 0.1; // Height above button
    sprite.scale.set(0.3, 0.3, 1);
    return sprite;
}

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
    tableObject.updateMatrixWorld(true);
    tableCollisionBox = new THREE.Box3().setFromObject(tableObject);
    tableCollisionBox.expandByVector(new THREE.Vector3(PLAYER_RADIUS, 0, PLAYER_RADIUS));
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
let soundReady = false; // Track if sound is fully loaded
let waveformReady = false; // Track if waveform graphic is created and added to scene
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
    soundReady = false; // Mark sound as not ready while loading
    waveformReady = false; // Mark waveform as not ready

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
        waveformReady = true; // Waveform is now added to scene
        
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

        soundReady = true; // Sound is now ready to play
        isLoading = false; // Loading complete
    }, null, function(err) {
        console.error("Audio Load Error:", err);
        isLoading = false; // Reset flag on error
    });
}


// Toggle pause/resume for audio
function togglePauseResume() {
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

// Creating a clickable buttons
const raycaster = new THREE.Raycaster();
const mouseClick = new THREE.Vector2();
const clickableObjects = []; // Only raycasts against clickable objects for performance
let currentPlayingButton = null; // Track which song button is currently playing
let currentFilterButton = null; // Track which filter is currently selected
const buttonPositions = {}; // Store original button positions for animation

// Animate button press (stays down on click, pops up on second click)
function animateClick(button) {
    if (!buttonPositions[button.userData.name]) {
        buttonPositions[button.userData.name] = button.position.y;
    }
    // Toggle pressed state
    button.userData.pressed = !button.userData.pressed;
    button.userData.isAnimating = true;
    button.userData.animationStart = Date.now();
    button.userData.originalY = buttonPositions[button.userData.name];
}

function getClickedObject(event) {
    if (controls.isLocked) {
        mouseClick.set(0, 0);
    } else {
        mouseClick.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouseClick.y = - (event.clientY / window.innerHeight) * 2 + 1;
    }

    raycaster.setFromCamera(mouseClick, camera);

    const intersects = raycaster.intersectObjects(clickableObjects);

    for (let intersection of intersects) {
        if (intersection.object.userData.type === 'clickable') {
            return intersection.object;
        }
    }

    return null;
}

function handleClickedObject(clickedObject) {
    console.log('Clicked object:', clickedObject.userData.name);

    if (clickedObject.userData.name === 'Stop/Resume') {
        animateClick(clickedObject);
        togglePauseResume();
    }
    else if (clickedObject.userData.name === 'SelectMusic') {
        if (controls.isLocked) {
            controls.unlock();
        }
        fileInput.click();
    }
    else if (clickedObject.userData.band) {
        // Handle filter button logic (mutually exclusive)
        if (currentFilterButton === clickedObject) {
            animateClick(clickedObject);
            currentFilterButton = null;
        } else {
            if (currentFilterButton) {
                currentFilterButton.userData.pressed = false;
                currentFilterButton.userData.isAnimating = false;
                if (buttonPositions[currentFilterButton.userData.name]) {
                    currentFilterButton.position.y = buttonPositions[currentFilterButton.userData.name];
                }
            }
            currentFilterButton = clickedObject;
            animateClick(clickedObject);
        }
    }
    else if (clickedObject !== currentPlayingButton) {
        if (waveformData && waveformData.sound && waveformData.soundStarted) {
            waveformData.sound.stop();
            waveformData.soundStarted = false;
        }
        if (currentPlayingButton) {
            currentPlayingButton.userData.pressed = false;
            currentPlayingButton.userData.isAnimating = false;
            if (buttonPositions[currentPlayingButton.userData.name]) {
                currentPlayingButton.position.y = buttonPositions[currentPlayingButton.userData.name];
            }
        }
        stopbutton.userData.clicked = false;
        newsong = true;
        song = clickedObject.userData.mp3file;
        currentPlayingButton = clickedObject;
        animateClick(clickedObject);
    }
}

window.addEventListener('click', (event) => {
    const clickedObject = getClickedObject(event);

    if (clickedObject) {
        handleClickedObject(clickedObject);
        return;
    }

    if (!controls.isLocked && event.target === renderer.domElement) {
        lockPointer();
    }
});

function setMovementKey(code, isPressed) {
    switch (code) {
        case 'KeyW':
        case 'ArrowUp':
            movementState.forward = isPressed;
            return true;
        case 'KeyS':
        case 'ArrowDown':
            movementState.backward = isPressed;
            return true;
        case 'KeyA':
        case 'ArrowLeft':
            movementState.left = isPressed;
            return true;
        case 'KeyD':
        case 'ArrowRight':
            movementState.right = isPressed;
            return true;
        case 'ShiftLeft':
        case 'ShiftRight':
            movementState.sprint = isPressed;
            return true;
        default:
            return false;
    }
}

window.addEventListener('keydown', (event) => {
    if (setMovementKey(event.code, true)) {
        event.preventDefault();
        return;
    }

    if (event.code === 'Space') {
        event.preventDefault(); // Prevent page scroll
        if (event.repeat) {
            return;
        }
        animateClick(stopbutton);
        togglePauseResume();
    }
});

window.addEventListener('keyup', (event) => {
    if (setMovementKey(event.code, false)) {
        event.preventDefault();
    }
});

// Stop button
const stopbuttonGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.1);
const stopbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
const stopbutton = new THREE.Mesh(stopbuttonGeometry, stopbuttonMaterial);
stopbutton.position.set(0, 1.28, 0.05);
stopbutton.userData.name = 'Stop/Resume'; // Mark as clickable
stopbutton.userData.clicked = false; // Track click state (if clicked music stops, if clicked again music resumes)
stopbutton.userData.type = 'clickable';
scene.add(stopbutton);
clickableObjects.push(stopbutton);
scene.add(createTextSprite('STOP', stopbutton.position));

// Sine, Square, Triangle, Saw, Noise, Rich Waves buttons
const sinebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const sinebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const sinebutton = new THREE.Mesh(sinebuttonGeometry, sinebuttonMaterial);
sinebutton.position.set(-0.9, 1.28, 0.05);
sinebutton.userData.type = 'clickable'; // Mark as clickable
sinebutton.userData.name = 'Sine'; // Mark as clickable
sinebutton.userData.clicked = false; // Track click state
sinebutton.userData.mp3file = 'sounds/sine_wave.mp3'; // Store associated mp3 file
scene.add(sinebutton);
clickableObjects.push(sinebutton);
scene.add(createTextSprite('SINE', sinebutton.position));

const squarebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const squarebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const squarebutton = new THREE.Mesh(squarebuttonGeometry, squarebuttonMaterial);
squarebutton.position.set(-0.5, 1.28, 0.05);
squarebutton.userData.type = 'clickable'; // Mark as clickable
squarebutton.userData.name = 'Square'; // Mark as clickable
squarebutton.userData.clicked = false; // Track click state
squarebutton.userData.mp3file = 'sounds/square_wave.mp3'; // Store associated mp3 file
scene.add(squarebutton);
clickableObjects.push(squarebutton);
scene.add(createTextSprite('SQUARE', squarebutton.position));

const trianglebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const trianglebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const trianglebutton = new THREE.Mesh(trianglebuttonGeometry, trianglebuttonMaterial);
trianglebutton.position.set(0.5, 1.28, 0.05);
trianglebutton.userData.type = 'clickable'; // Mark as clickable
trianglebutton.userData.name = 'Triangle'; // Mark as clickable
trianglebutton.userData.clicked = false; // Track click state
trianglebutton.userData.mp3file = 'sounds/triangle_wave.mp3'; // Store associated mp3 file
scene.add(trianglebutton);
clickableObjects.push(trianglebutton);
scene.add(createTextSprite('TRIANGLE', trianglebutton.position));

const sawbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const sawbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const sawbutton = new THREE.Mesh(sawbuttonGeometry, sawbuttonMaterial);
sawbutton.position.set(0.9, 1.28, 0.05);
sawbutton.userData.type = 'clickable'; // Mark as clickable
sawbutton.userData.name = 'Saw'; // Mark as clickable
sawbutton.userData.clicked = false; // Track click state
sawbutton.userData.mp3file = 'sounds/saw_wave.mp3'; // Store associated mp3 file
scene.add(sawbutton);
clickableObjects.push(sawbutton);
scene.add(createTextSprite('SAW', sawbutton.position));

const noisebuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const noisebuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const noisebutton = new THREE.Mesh(noisebuttonGeometry, noisebuttonMaterial);
noisebutton.position.set(-0.7, 1.28, 0.35);
noisebutton.userData.type = 'clickable'; // Mark as clickable
noisebutton.userData.name = 'Noise'; // Mark as clickable
noisebutton.userData.clicked = false; // Track click state
noisebutton.userData.mp3file = 'sounds/noise_wave.mp3'; // Store associated mp3 file
scene.add(noisebutton);
clickableObjects.push(noisebutton);
scene.add(createTextSprite('NOISE', noisebutton.position));

const richbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const richbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const richbutton = new THREE.Mesh(richbuttonGeometry, richbuttonMaterial);
richbutton.position.set(0.7, 1.28, 0.35);
richbutton.userData.type = 'clickable'; // Mark as clickable
richbutton.userData.name = 'Rich'; // Mark as clickable
richbutton.userData.clicked = false; // Track click state
richbutton.userData.mp3file = 'sounds/rich_wave.mp3'; // Store associated mp3 file
scene.add(richbutton);
clickableObjects.push(richbutton);
scene.add(createTextSprite('RICH', richbutton.position));

const musicbuttonGeometry = new THREE.BoxGeometry(0.8, 0.1, 0.1, 4, 4, 4);
const musicbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
const musicbutton = new THREE.Mesh(musicbuttonGeometry, musicbuttonMaterial);
musicbutton.position.set(-0.05, 1.28, 0.45);
musicbutton.userData.type = 'clickable'; // Mark as clickable
musicbutton.userData.name = 'Music'; // Mark as clickable
musicbutton.userData.clicked = false; // Track click state
musicbutton.userData.mp3file = 'sounds/ijustthrewouthelovefmydreams.mp3'; // Store associated mp3 file
musicbutton.userData.pressed = false; // Start unpressed
scene.add(musicbutton);
clickableObjects.push(musicbutton);
scene.add(createTextSprite('MUSIC', musicbutton.position));

// Initialize music button as starting selection
buttonPositions['Music'] = musicbutton.position.y; // Store original position
currentPlayingButton = musicbutton;
song = musicbutton.userData.mp3file;
newsong = true;

const selectmusicbuttonGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.05);
const selectmusicbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xffff00 });
const selectmusicbutton = new THREE.Mesh(selectmusicbuttonGeometry, selectmusicbuttonMaterial);
selectmusicbutton.position.set(0.45, 1.28, 0.45);
selectmusicbutton.userData.type = 'clickable'; // Mark as clickable
selectmusicbutton.userData.name = 'SelectMusic'; // Mark as clickable
scene.add(selectmusicbutton);
clickableObjects.push(selectmusicbutton);
scene.add(createTextSprite('SELECT', selectmusicbutton.position));

// Lowpass, Highpass, Bandpass, Peaking buttons
const lowpassbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const lowpassbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xff00ff });
const lowpassbutton = new THREE.Mesh(lowpassbuttonGeometry, lowpassbuttonMaterial);
lowpassbutton.position.set(-0.45, 1.28, 0.75);
lowpassbutton.userData.type = 'clickable'; // Mark as clickable
lowpassbutton.userData.band = true; // Mark as band control
lowpassbutton.userData.name = 'Lowpass'; // Mark as clickable
lowpassbutton.userData.clicked = false; // Track click state
scene.add(lowpassbutton);
clickableObjects.push(lowpassbutton);
scene.add(createTextSprite('LOWP', lowpassbutton.position));

const highpassbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const highpassbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xff00ff });
const highpassbutton = new THREE.Mesh(highpassbuttonGeometry, highpassbuttonMaterial);
highpassbutton.position.set(-0.15, 1.28, 0.75);
highpassbutton.userData.type = 'clickable'; // Mark as clickable
highpassbutton.userData.band = true; // Mark as band control
highpassbutton.userData.name = 'Highpass'; // Mark as clickable
highpassbutton.userData.clicked = false; // Track click state
scene.add(highpassbutton);
clickableObjects.push(highpassbutton);
scene.add(createTextSprite('HIGHP', highpassbutton.position));

const bandpassbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const bandpassbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xff00ff });
const bandpassbutton = new THREE.Mesh(bandpassbuttonGeometry, bandpassbuttonMaterial);
bandpassbutton.position.set(0.15, 1.28, 0.75);
bandpassbutton.userData.type = 'clickable'; // Mark as clickable
bandpassbutton.userData.band = true; // Mark as band control
bandpassbutton.userData.name = 'Bandpass'; // Mark as clickable
bandpassbutton.userData.clicked = false; // Track click state
scene.add(bandpassbutton);
clickableObjects.push(bandpassbutton);
scene.add(createTextSprite('BANDP', bandpassbutton.position));

const peakingbuttonGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
const peakingbuttonMaterial = new THREE.MeshPhongMaterial({ color: 0xff00ff });
const peakingbutton = new THREE.Mesh(peakingbuttonGeometry, peakingbuttonMaterial);
peakingbutton.position.set(0.45, 1.28, 0.75);
peakingbutton.userData.type = 'clickable'; // Mark as clickable
peakingbutton.userData.band = true; // Mark as band control
peakingbutton.userData.name = 'Peaking'; // Mark as clickable
peakingbutton.userData.clicked = false; // Track click state
scene.add(peakingbutton);
clickableObjects.push(peakingbutton);
scene.add(createTextSprite('PEAK', peakingbutton.position));

// Pitch, Cutoff, Gain, Resonance, Sliders
const pitchsliderGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.1);
const pitchsliderMaterial = new THREE.MeshPhongMaterial({ color: 0xffc0cb});
const pitchslider = new THREE.Mesh(pitchsliderGeometry, pitchsliderMaterial);
pitchslider.position.set(0.0, 1.28, 1.3);
pitchslider.userData.type = 'slidable'; // Mark as slidable
pitchslider.userData.band = true; // Mark as band control
scene.add(pitchslider);
clickableObjects.push(pitchslider);

const cutoffsliderGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.1);
const cutoffsliderMaterial = new THREE.MeshPhongMaterial({ color: 0x999999});
const cutoffslider = new THREE.Mesh(cutoffsliderGeometry, cutoffsliderMaterial);
cutoffslider.position.set(-0.3, 1.28, 1.05);
cutoffslider.userData.type = 'slidable'; // Mark as slidable
cutoffslider.userData.band = true; // Mark as band control
scene.add(cutoffslider);
clickableObjects.push(cutoffslider);

const gainsliderGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.1);
const gainsliderMaterial = new THREE.MeshPhongMaterial({ color: 0x999999});
const gainslider = new THREE.Mesh(gainsliderGeometry, gainsliderMaterial);
gainslider.position.set(0.0, 1.28, 1.05);
gainslider.userData.type = 'slidable'; // Mark as slidable
gainslider.userData.band = true; // Mark as band control
scene.add(gainslider);
clickableObjects.push(gainslider);

const resoncesliderGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.1);
const resoncesliderMaterial = new THREE.MeshPhongMaterial({ color: 0x999999});
const resonceslider = new THREE.Mesh(resoncesliderGeometry, resoncesliderMaterial);
resonceslider.position.set(0.3, 1.28, 1.05);
resonceslider.userData.type = 'slidable'; // Mark as slidable
resonceslider.userData.band = true; // Mark as band control
scene.add(resonceslider);
clickableObjects.push(resonceslider);

function collidesWithTable(position) {
    if (!tableCollisionBox) {
        return false;
    }

    return position.x >= tableCollisionBox.min.x
        && position.x <= tableCollisionBox.max.x
        && position.z >= tableCollisionBox.min.z
        && position.z <= tableCollisionBox.max.z;
}

function clampToWorld(position) {
    position.x = THREE.MathUtils.clamp(position.x, -WORLD_LIMIT, WORLD_LIMIT);
    position.z = THREE.MathUtils.clamp(position.z, -WORLD_LIMIT, WORLD_LIMIT);
}

function updatePlayerMovement(delta) {
    camera.position.y = PLAYER_EYE_HEIGHT;

    if (!controls.isLocked) {
        return;
    }

    const forwardInput = Number(movementState.forward) - Number(movementState.backward);
    const rightInput = Number(movementState.right) - Number(movementState.left);

    if (forwardInput === 0 && rightInput === 0) {
        return;
    }

    controls.getDirection(playerForward);
    playerForward.y = 0;

    if (playerForward.lengthSq() === 0) {
        return;
    }

    playerForward.normalize();
    playerRight.setFromMatrixColumn(camera.matrix, 0);
    playerRight.y = 0;
    playerRight.normalize();

    playerMove.set(0, 0, 0)
        .addScaledVector(playerForward, forwardInput)
        .addScaledVector(playerRight, rightInput);

    if (playerMove.lengthSq() === 0) {
        return;
    }

    const speed = movementState.sprint ? SPRINT_SPEED : WALK_SPEED;
    playerMove.normalize().multiplyScalar(speed * delta);

    candidatePosition.copy(camera.position).add(playerMove);
    candidatePosition.y = PLAYER_EYE_HEIGHT;
    clampToWorld(candidatePosition);

    if (!collidesWithTable(candidatePosition)) {
        camera.position.copy(candidatePosition);
        return;
    }

    axisCandidatePosition.copy(camera.position);
    axisCandidatePosition.x = candidatePosition.x;
    clampToWorld(axisCandidatePosition);

    if (!collidesWithTable(axisCandidatePosition)) {
        camera.position.x = axisCandidatePosition.x;
    }

    axisCandidatePosition.copy(camera.position);
    axisCandidatePosition.z = candidatePosition.z;
    clampToWorld(axisCandidatePosition);

    if (!collidesWithTable(axisCandidatePosition)) {
        camera.position.z = axisCandidatePosition.z;
    }

    camera.position.y = PLAYER_EYE_HEIGHT;
}

function playmusic() {
    if (newsong) {
        loadsong(song);
        newsong = false;
    }

    // Auto-play when song is loaded and waveform is ready
    if (soundReady && waveformReady && waveformData && !waveformData.soundStarted && !stopbutton.userData.clicked) {
        waveformReady = false; // Reset for next song
        waveformData.sound.play();
        waveformData.startTime = listener.context.currentTime;
        waveformData.soundStarted = true;
        
        // Press music button when playback starts
        if (currentPlayingButton && !currentPlayingButton.userData.pressed) {
            currentPlayingButton.userData.pressed = true;
            currentPlayingButton.userData.isAnimating = true;
            currentPlayingButton.userData.animationStart = Date.now();
            currentPlayingButton.userData.originalY = buttonPositions[currentPlayingButton.userData.name];
        }
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
            
            // Press button again on auto-repeat
            if (currentPlayingButton && !currentPlayingButton.userData.pressed) {
                currentPlayingButton.userData.pressed = true;
                currentPlayingButton.userData.isAnimating = true;
                currentPlayingButton.userData.animationStart = Date.now();
                currentPlayingButton.userData.originalY = buttonPositions[currentPlayingButton.userData.name];
            }
        }
        
        const progressRatio = elapsed / waveformData.duration;
        const offset = progressRatio * waveformData.totalWidth;
        waveformData.line.position.x = -offset;
        // Update shader uniform to track line position
        waveformData.line.material.uniforms.linePositionX.value = waveformData.line.position.x;
    }
};

function clickanimation() {
    clickableObjects.forEach(button => {
        if (button.userData.isAnimating) {
            const elapsed = Date.now() - button.userData.animationStart;
            const duration = 150; // Animation duration
            const progress = Math.min(elapsed / duration, 1);
            
            let movement = 0;
            
            if (button.userData.pressed) {
                // Button pressed: move down smoothly
                movement = progress * -0.08;
            } else {
                // Button released: move back up smoothly
                movement = (1 - progress) * -0.08;
            }
            
            button.position.y = button.userData.originalY + movement;
            
            if (progress >= 1) {
                button.userData.isAnimating = false;
            }
        } else if (button.userData.pressed) {
            // Keep button in pressed position if pressed but not animating
            button.position.y = button.userData.originalY - 0.08;
        } else if (button.userData.originalY !== undefined) {
            // Keep button at original position if not pressed
            button.position.y = button.userData.originalY;
        }
    });
}

function animate() {
    requestAnimationFrame( animate );
    const now = performance.now();
    const delta = Math.min((now - lastFrameMs) / 1000, 0.05);
    lastFrameMs = now;

    updatePlayerMovement(delta);
    playmusic();
    clickanimation();

    renderer.render( scene, camera );
}

animate();

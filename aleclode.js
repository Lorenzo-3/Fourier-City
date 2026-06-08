import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { initializeLore, updateLore } from './lore.js';
import { createProceduralSignal, PROCEDURAL_SIGNALS } from './procedural-signals.js';

const renderer = new THREE.WebGLRenderer({ antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio);
renderer.setClearColor(0x000000);
document.body.appendChild( renderer.domElement );

const PLAYER_EYE_HEIGHT = 2.3;
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

window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
});

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.mp3';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        const source = createMp3Source(url);

        if (selectedMusicObjectUrl) {
            URL.revokeObjectURL(selectedMusicObjectUrl);
        }
        selectedMusicObjectUrl = url;
        if (musicbutton) {
            musicbutton.userData.source = source;
        }
        resetPlayingButtonVisual(currentPlayingButton);
        resetStopButtonVisual();
        selectAudioSource(source);
        currentPlayingButton = musicbutton;
        fileInput.value = '';
    }
    // Re-lock pointer after file selection
    setTimeout(() => lockPointer(), 100);
});

fileInput.addEventListener('cancel', () => {
    // Re-lock pointer if dialog was cancelled
    setTimeout(() => lockPointer(), 100);
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
const textureLoader = new THREE.TextureLoader();
let knobTexture = null;

function createTextTexture(text, size = 256, color = 0xffffff) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    
    // Convert hex color to rgb
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    const colorStr = `rgb(${r}, ${g}, ${b})`;
    
    // Add text with colored glow effect
    ctx.shadowColor = colorStr;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Render text with button color
    ctx.fillStyle = colorStr;
    ctx.font = 'bold 32px "Arial", "Helvetica", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createTextSprite(text, position, color = 0xffffff) {
    const texture = createTextTexture(text, 256, color);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.position.y += 0.15;
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

// Audio setup
const sound = new THREE.PositionalAudio( listener );
const audioLoader = new THREE.AudioLoader();
initializeLore({ scene, camera, audio: sound });

// Web Audio filter nodes
let filters = null;
let filtersInitialized = false;

function initializeFilters() {
    if (filtersInitialized) return;
    
    const audioContext = listener.context;
    if (!audioContext) return;
    
    filters = {
        lowpass: audioContext.createBiquadFilter(),
        highpass: audioContext.createBiquadFilter(),
        bandpass: audioContext.createBiquadFilter(),
        peaking: audioContext.createBiquadFilter()
    };
    
    filters.lowpass.type = 'lowpass';
    filters.highpass.type = 'highpass';
    filters.bandpass.type = 'bandpass';
    filters.peaking.type = 'peaking';
    
    filters.lowpass.frequency.value = 20000;
    filters.highpass.frequency.value = 20;
    filters.bandpass.frequency.value = 1000;
    filters.peaking.frequency.value = 1000;
    filters.peaking.gain.value = 0;
    filters.lowpass.Q.value = 1;
    filters.highpass.Q.value = 1;
    filters.bandpass.Q.value = 1;
    filters.peaking.Q.value = 1;
    
    filtersInitialized = true;
}

let activeFilter = null;
const filterConfig = {
    lowpass: { knobs: ['cutoffknob', 'resonanceknob'] },
    highpass: { knobs: ['cutoffknob', 'resonanceknob'] },
    bandpass: { knobs: ['cutoffknob', 'resonanceknob'] },
    peaking: { knobs: ['cutoffknob', 'gainknob', 'resonanceknob'] }
};

const knobToFilter = {
    'pitchknob': 'pitch',
    'cutoffknob': 'cutoff',
    'gainknob': 'gain',
    'resonanceknob': 'resonance'
};

function rewireAudioGraph() {
    if (!sound || !filtersInitialized) return;

    const activeAudioFilter = activeFilter && filters?.[activeFilter]
        ? [filters[activeFilter]]
        : [];

    sound.setFilters(activeAudioFilter);
}

let waveformData = null; 
let currentSource = createMp3Source('sounds/ijustthrewouthelovefmydreams.mp3');
let sourceRequestVersion = 1;
let pendingSourceVersion = 1;
let selectedMusicObjectUrl = null;
let soundReady = false;
let waveformReady = false;
let currentWaveformMesh = null;

// EXACT SAME waveform material from first code
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

function createMp3Source(url) {
    return { kind: 'mp3', url };
}

function createGeneratedSource(signal) {
    return { kind: 'procedural', signal };
}

function selectAudioSource(source) {
    stopCurrentPlayback();
    disposeCurrentWaveform();
    waveformData = null;
    currentSource = source;
    sourceRequestVersion += 1;
    pendingSourceVersion = sourceRequestVersion;
    soundReady = false;
    waveformReady = false;
}

function stopCurrentPlayback() {
    if (sound.isPlaying) {
        sound.stop();
    }

    if (waveformData) {
        waveformData.soundStarted = false;
    }
}

function loadAudioSource(source, requestVersion) {
    soundReady = false;
    waveformReady = false;
    
    initializeFilters();

    if (source.kind === 'procedural') {
        const generatedSignal = createProceduralSignal(listener.context, source.signal);
        finishLoadingSource(
            generatedSignal.buffer,
            generatedSignal.visualizationSamples,
            true,
            requestVersion
        );
        return;
    }

    audioLoader.load(source.url, function(buffer) {
        if (requestVersion !== sourceRequestVersion) {
            return;
        }

        finishLoadingSource(buffer, buffer.getChannelData(0), false, requestVersion);
    }, null, function(err) {
        if (requestVersion === sourceRequestVersion) {
            console.error('Audio Load Error:', err);
        }
    });
}

function finishLoadingSource(buffer, visualizationSamples, isStatic, requestVersion) {
    if (requestVersion !== sourceRequestVersion) {
        return;
    }

    disposeCurrentWaveform();
    sound.setBuffer(buffer);
    sound.setLoop(true);
    sound.setPlaybackRate(getPitchPlaybackRate());
    sound.setRefDistance(2);
    sound.setRolloffFactor(1);
    sound.setDistanceModel('inverse');
    sound.setDirectionalCone(360, 360, 1);
    applyActiveFilterParameters();
    rewireAudioGraph();

    const totalWidth = isStatic ? 3 : buffer.duration * 20;
    const fullWaveformGeometry = new THREE.BufferGeometry();
    const fullPositions = new Float32Array(visualizationSamples.length * 3);
    const amplitude = isStatic ? 2 : 0.8;

    for (let index = 0; index < visualizationSamples.length; index += 1) {
        fullPositions[index * 3] = (index / Math.max(visualizationSamples.length - 1, 1)) * totalWidth - 1.5;
        fullPositions[index * 3 + 1] = 1.8 + visualizationSamples[index] * amplitude;
        fullPositions[index * 3 + 2] = -0.5;
    }

    fullWaveformGeometry.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));

    const fullWaveform = new THREE.Line(fullWaveformGeometry, waveformMaterial);
    fullWaveform.position.x = 0;
    waveformMaterial.uniforms.linePositionX.value = 0;
    currentWaveformMesh = fullWaveform;
    scene.add(fullWaveform);

    waveformData = {
        line: fullWaveform,
        duration: buffer.duration,
        totalWidth,
        isStatic,
        sound,
        startTime: null,
        pausedElapsed: 0,
        soundStarted: false
    };

    if (tableObject) {
        tableObject.add(sound);
    } else {
        scene.add(sound);
    }

    waveformReady = true;
    soundReady = true;
}

function disposeCurrentWaveform() {
    if (!currentWaveformMesh) {
        return;
    }

    scene.remove(currentWaveformMesh);
    currentWaveformMesh.geometry.dispose();
    currentWaveformMesh = null;
}

function getPitchPlaybackRate() {
    const pitch = knobObjects.find(knob => knob.userData.name === 'pitchknob');
    return pitch ? 0.5 + pitch.userData.value : 1;
}

function togglePauseResume() {
    if (!stopbutton.userData.clicked) {
        stopbutton.userData.clicked = true;
        if (waveformData?.soundStarted) {
            sound.pause();
            const currentTime = listener.context.currentTime;
            waveformData.pausedElapsed = currentTime - waveformData.startTime;
            waveformData.soundStarted = false;
        }
    } else {
        stopbutton.userData.clicked = false;
        if (waveformData && !sound.isPlaying) {
            sound.play();
            waveformData.startTime = listener.context.currentTime - waveformData.pausedElapsed;
            waveformData.soundStarted = true;
        }
    }
    // Trigger animation after state change
    animateClick(stopbutton);
}

const raycaster = new THREE.Raycaster();
const mouseClick = new THREE.Vector2();
const clickableObjects = [];
const knobObjects = [];
let currentPlayingButton = null;
let currentFilterButton = null;
const buttonPositions = {};
let activeKnob = null;
let previousMouseY = 0;
let isDraggingKnob = false;

function animateClick(button) {
    if (!buttonPositions[button.userData.name]) {
        buttonPositions[button.userData.name] = button.position.y;
    }
    button.userData.pressed = !button.userData.pressed;
    button.userData.isAnimating = true;
    button.userData.animationStart = Date.now();
    button.userData.originalY = buttonPositions[button.userData.name];
}

function resetPlayingButtonVisual(button) {
    if (!button) {
        return;
    }

    button.userData.pressed = false;
    button.userData.isAnimating = false;

    const originalY = buttonPositions[button.userData.name];
    if (originalY !== undefined) {
        button.position.y = originalY;
        if (button.userData.textSprite) {
            button.userData.textSprite.position.y = originalY + 0.15;
        }
    }
}

function resetStopButtonVisual() {
    stopbutton.userData.clicked = false;
    resetPlayingButtonVisual(stopbutton);
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
        togglePauseResume();
    }
    else if (clickedObject.userData.name === 'SelectMusic') {
        if (controls.isLocked) {
            controls.unlock();
            // Defer file input click to allow unlock to complete
            setTimeout(() => fileInput.click(), 0);
        } else {
            fileInput.click();
        }
    }
    else if (clickedObject.userData.band) {
        if (currentFilterButton === clickedObject) {
            animateClick(clickedObject);
            currentFilterButton = null;
            activeFilter = null;
            rewireAudioGraph();
        } else {
            if (currentFilterButton) {
                currentFilterButton.userData.pressed = false;
                currentFilterButton.userData.isAnimating = false;
                if (buttonPositions[currentFilterButton.userData.name]) {
                    currentFilterButton.position.y = buttonPositions[currentFilterButton.userData.name];
                }
            }
            currentFilterButton = clickedObject;
            activeFilter = clickedObject.userData.name.toLowerCase();
            applyActiveFilterParameters();
            animateClick(clickedObject);
            rewireAudioGraph();
        }
    }
    else if (clickedObject !== currentPlayingButton) {
        stopCurrentPlayback();
        resetPlayingButtonVisual(currentPlayingButton);
        resetStopButtonVisual();
        selectAudioSource(clickedObject.userData.source);
        currentPlayingButton = clickedObject;
        animateClick(clickedObject);
    }
}

// Create knob canvas fallback texture
function createKnobCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Outer ring
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner circle
    ctx.fillStyle = '#666666';
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.fill();
    
    // Knob grip lines
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(64 + Math.cos(angle) * 30, 64 + Math.sin(angle) * 30);
        ctx.lineTo(64 + Math.cos(angle) * 45, 64 + Math.sin(angle) * 45);
        ctx.stroke();
    }
    
    // Center dot
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(64, 64, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Indicator line pointing to the right (0° direction)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(104, 64);  // Point to the right (0°)
    ctx.stroke();
    
    return canvas;
}

// Function to create text label for knobs
function createKnobLabel(text, position, color = 0xffffff) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgb(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255})`;
    ctx.font = 'Bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 15);
    
    // Add value placeholder
    ctx.font = '20px Arial';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('Value: 0.00', canvas.width / 2, canvas.height / 2 + 20);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.position.y += 0.15;
    sprite.scale.set(0.4, 0.2, 1);
    return sprite;
}

// Function to update knob value display
function updateKnobValueDisplay(knob) {
    if (knob.userData.labelSprite) {
        const canvas = knob.userData.labelSprite.material.map.image;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear and redraw
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = `rgb(${(knob.userData.labelColor >> 16) & 255}, ${(knob.userData.labelColor >> 8) & 255}, ${knob.userData.labelColor & 255})`;
        ctx.font = 'Bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(knob.userData.labelName, width / 2, height / 2 - 15);
        
        // Format value based on knob type
        let displayValue;
        if (knob.userData.name === 'pitchknob') {
            const playbackRate = 0.5 + knob.userData.value * 1.0;
            displayValue = playbackRate.toFixed(2) + 'x';
        } else if (knob.userData.name === 'cutoffknob') {
            const minFreq = 20;
            const maxFreq = 20000;
            const logMin = Math.log(minFreq);
            const logMax = Math.log(maxFreq);
            const frequency = Math.exp(logMin + (logMax - logMin) * knob.userData.value);
            displayValue = Math.round(frequency) + 'Hz';
        } else if (knob.userData.name === 'gainknob') {
            const gain = -18 + knob.userData.value * 36;
            displayValue = gain.toFixed(1) + 'dB';
        } else if (knob.userData.name === 'resonanceknob') {
            const Q = 0.1 + knob.userData.value * 19.9;
            displayValue = Q.toFixed(2);
        } else {
            displayValue = knob.userData.value.toFixed(2);
        }
        
        ctx.font = '20px Arial';
        ctx.fillStyle = '#ffff00';
        ctx.fillText(displayValue, width / 2, height / 2 + 20);
        
        knob.userData.labelSprite.material.map.needsUpdate = true;
    }
}

function createKnobMesh(position, name, initialValue, minValue, maxValue) {
    const knobGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 32);
    
    // Use canvas-generated knob texture
    const topMaterial = new THREE.MeshPhongMaterial({ 
        map: new THREE.CanvasTexture(createKnobCanvas()), 
        color: 0xffffff 
    });
    
    const materials = [
        new THREE.MeshPhongMaterial({ color: 0x888888 }), // side
        topMaterial, // top
        new THREE.MeshPhongMaterial({ color: 0x444444 })  // bottom
    ];
    
    const knob = new THREE.Mesh(knobGeometry, materials);
    knob.position.copy(position);
    
    knob.userData.type = 'knob';
    knob.userData.name = name;
    knob.userData.value = initialValue;
    knob.userData.minValue = minValue;
    knob.userData.maxValue = maxValue;
    
    // Set initial rotation: at value 0.5, point to +90° (rotated +90° around y axis)
    const angleRange = 270 * Math.PI / 180;   // 270° range
    const rotationAngle = Math.PI - (initialValue - 0.5) * angleRange;
    knob.rotation.y = rotationAngle;
    
    knob.userData.topMaterial = materials[1];
    
    // Create label based on knob name
    let labelText = '';
    let labelColor = 0xffffff;
    switch(name) {
        case 'pitchknob':
            labelText = 'PITCH';
            labelColor = 0xff66ff;
            break;
        case 'cutoffknob':
            labelText = 'CUTOFF';
            labelColor = 0x66ff66;
            break;
        case 'gainknob':
            labelText = 'GAIN';
            labelColor = 0x66ff66;
            break;
        case 'resonanceknob':
            labelText = 'RESONANCE';
            labelColor = 0x66ff66;
            break;
    }
    
    // Create label sprite
    const labelSprite = createKnobLabel(labelText, position, labelColor);
    knob.userData.labelSprite = labelSprite;
    knob.userData.labelName = labelText;
    knob.userData.labelColor = labelColor;
    scene.add(labelSprite);
    
    // Initial value update
    updateKnobValueDisplay(knob);
    
    scene.add(knob);
    knobObjects.push(knob);
    
    return knob;
}

// Knobs use canvas-generated texture (no external image file needed)

// Helper function to create buttons
function createButton(position, name, color, text, isBand = false, source = null, isMusic = false, isSelect = false) {
    let geometry, material, button;
    
    if (isMusic) {
        geometry = new THREE.BoxGeometry(0.8, 0.1, 0.1, 4, 4, 4);
    } else if (isSelect) {
        geometry = new THREE.CylinderGeometry(0.05, 0.05, 0.05);
    } else if (isBand) {
        geometry = new THREE.CylinderGeometry(0.06, 0.06, 0.1);
    } else {
        geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);
    }
    
    material = new THREE.MeshPhongMaterial({ color: color });
    button = new THREE.Mesh(geometry, material);
    button.position.copy(position);
    button.userData.type = 'clickable';
    button.userData.name = name;
    button.userData.clicked = false;
    
    if (isBand) {
        button.userData.band = true;
    }
    
    if (source) {
        button.userData.source = source;
    }
    
    if (name === 'Music') {
        button.userData.pressed = false;
    }
    
    scene.add(button);
    clickableObjects.push(button);
    const textSprite = createTextSprite(text, position, color);
    button.userData.textSprite = textSprite;
    scene.add(textSprite);
    
    return button;
}

// Stop button
const stopbutton = createButton(
    new THREE.Vector3(0, 1.26, 0.05),
    'Stop/Resume',
    0xff0000,
    'STOP'
);
buttonPositions['Stop/Resume'] = stopbutton.position.y;
stopbutton.userData.originalY = stopbutton.position.y;
stopbutton.userData.pressed = false;

// Wave buttons
const sinebutton = createButton(
    new THREE.Vector3(-0.9, 1.28, 0.05),
    'Sine',
    0x00ff00,
    'SINE',
    false,
    createGeneratedSource(PROCEDURAL_SIGNALS.sine)
);

const squarebutton = createButton(
    new THREE.Vector3(-0.5, 1.26, 0.05),
    'Square',
    0x00ff00,
    'SQUARE',
    false,
    createGeneratedSource(PROCEDURAL_SIGNALS.square)
);

const trianglebutton = createButton(
    new THREE.Vector3(0.5, 1.26, 0.05),
    'Triangle',
    0x00ff00,
    'TRIANGLE',
    false,
    createGeneratedSource(PROCEDURAL_SIGNALS.triangle)
);

const sawbutton = createButton(
    new THREE.Vector3(0.9, 1.26, 0.05),
    'Saw',
    0x00ff00,
    'SAW',
    false,
    createGeneratedSource(PROCEDURAL_SIGNALS.saw)
);

const noisebutton = createButton(
    new THREE.Vector3(-0.7, 1.26, 0.35),
    'Noise',
    0x00ff00,
    'NOISE',
    false,
    createGeneratedSource(PROCEDURAL_SIGNALS.noise)
);

const richbutton = createButton(
    new THREE.Vector3(0.7, 1.26, 0.35),
    'Rich',
    0x00ff00,
    'RICH',
    false,
    createGeneratedSource(PROCEDURAL_SIGNALS.rich)
);

const musicbutton = createButton(
    new THREE.Vector3(-0.05, 1.28, 0.45),
    'Music',
    0x0000ff,
    'MUSIC',
    false,
    createMp3Source('sounds/ijustthrewouthelovefmydreams.mp3'),
    true
);

buttonPositions['Music'] = musicbutton.position.y;
currentPlayingButton = musicbutton;
currentSource = musicbutton.userData.source;

const selectmusicbutton = createButton(
    new THREE.Vector3(0.45, 1.26, 0.45),
    'SelectMusic',
    0xffff00,
    'SELECT',
    false,
    null,
    false,
    true
);

// Filter buttons
const lowpassbutton = createButton(
    new THREE.Vector3(-0.45, 1.26, 0.75),
    'Lowpass',
    0xff00ff,
    'LOWP',
    true
);

const highpassbutton = createButton(
    new THREE.Vector3(-0.15, 1.26, 0.75),
    'Highpass',
    0xff00ff,
    'HIGHP',
    true
);

const bandpassbutton = createButton(
    new THREE.Vector3(0.15, 1.26, 0.75),
    'Bandpass',
    0xff00ff,
    'BANDP',
    true
);

const peakingbutton = createButton(
    new THREE.Vector3(0.45, 1.26, 0.75),
    'Peaking',
    0xff00ff,
    'PEAK',
    true
);

// Create knobs
// Pitch knob: initial value 0.5 gives default 1.0x (0.5 + 0.5 * 1.0 = 1.0), range 0.5x to 1.5x
const pitchknob = createKnobMesh(new THREE.Vector3(0.0, 1.24, 1.3), 'pitchknob', 0.5, 0.5, 1.5);
const cutoffknob = createKnobMesh(new THREE.Vector3(-0.3, 1.24, 1.05), 'cutoffknob', 0.5, 20, 20000);
const gainknob = createKnobMesh(new THREE.Vector3(0.0, 1.24, 1.05), 'gainknob', 0.5, -18, 18);
const resonanceknob = createKnobMesh(new THREE.Vector3(0.3, 1.24, 1.05), 'resonanceknob', 0.5, 0.1, 20);

function updateFilterParameter(knobName, value) {
    if (!filtersInitialized) return;
    
    const paramType = knobToFilter[knobName];
    
    if (paramType === 'pitch') {
        if (waveformData && waveformData.sound) {
            const playbackRate = 0.5 + value * 1.0;
            waveformData.sound.setPlaybackRate(playbackRate);
        }
        return;
    }
    
    if (!activeFilter || !filters) return;
    
    const filter = filters[activeFilter];
    if (!filter) return;
    
    switch(paramType) {
        case 'cutoff':
            const minFreq = 20;
            const maxFreq = 20000;
            const logMin = Math.log(minFreq);
            const logMax = Math.log(maxFreq);
            const frequency = Math.exp(logMin + (logMax - logMin) * value);
            filter.frequency.value = frequency;
            break;
        case 'resonance':
            const Q = 0.1 + value * 19.9;
            filter.Q.value = Q;
            break;
        case 'gain':
            const gain = -18 + value * 36;
            filter.gain.value = gain;
            break;
    }
}

function applyActiveFilterParameters() {
    const activeKnobNames = filterConfig[activeFilter]?.knobs ?? [];

    for (const knobName of activeKnobNames) {
        const knob = knobObjects.find(candidate => candidate.userData.name === knobName);
        if (knob) {
            updateFilterParameter(knobName, knob.userData.value);
        }
    }
}

function collidesWithTable(position) {
    if (!tableCollisionBox) {
        return false;
    }
    
    // Get table center
    const centerX = (tableCollisionBox.min.x + tableCollisionBox.max.x) / 2;
    const centerZ = (tableCollisionBox.min.z + tableCollisionBox.max.z) / 2;
    
    // Calculate distance squared (avoids sqrt)
    const dx = position.x - centerX;
    const dz = position.z - centerZ;
    const distSq = dx * dx + dz * dz;
    
    // Collision radius is the larger half-dimension
    const radius = Math.max(
        Math.abs(tableCollisionBox.max.x - centerX),
        Math.abs(tableCollisionBox.max.z - centerZ)
    );
    
    return distSq <= radius * radius;
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
    if (pendingSourceVersion !== null) {
        const requestVersion = pendingSourceVersion;
        pendingSourceVersion = null;
        loadAudioSource(currentSource, requestVersion);
    }

    if (soundReady && waveformReady && waveformData && !waveformData.soundStarted && !stopbutton.userData.clicked) {
        waveformReady = false;
        sound.play();
        waveformData.startTime = listener.context.currentTime;
        waveformData.soundStarted = true;
        
        if (currentPlayingButton && !currentPlayingButton.userData.pressed) {
            currentPlayingButton.userData.pressed = true;
            currentPlayingButton.userData.isAnimating = true;
            currentPlayingButton.userData.animationStart = Date.now();
            currentPlayingButton.userData.originalY = buttonPositions[currentPlayingButton.userData.name];
        }
    }
    
    if (waveformData && waveformData.soundStarted && !waveformData.isStatic && !stopbutton.userData.clicked) {
        const currentTime = listener.context.currentTime;
        const elapsed = currentTime - waveformData.startTime;
        const playbackElapsed = elapsed * sound.getPlaybackRate();
        const progressRatio = (playbackElapsed % waveformData.duration) / waveformData.duration;
        const offset = progressRatio * waveformData.totalWidth;
        waveformData.line.position.x = -offset;
        waveformData.line.material.uniforms.linePositionX.value = waveformData.line.position.x;
    }
}

function clickanimation() {
    clickableObjects.forEach(button => {
        if (button.userData.isAnimating) {
            const elapsed = Date.now() - button.userData.animationStart;
            const duration = 150;
            const progress = Math.min(elapsed / duration, 1);
            
            let movement = 0;
            
            if (button.userData.pressed) {
                movement = progress * -0.06;
            } else {
                movement = (1 - progress) * -0.06;
            }
            
            button.position.y = button.userData.originalY + movement;
            
            // Move text sprite along with button
            if (button.userData.textSprite) {
                button.userData.textSprite.position.y = button.userData.originalY + movement + 0.15;
            }
            
            if (progress >= 1) {
                button.userData.isAnimating = false;
            }
        } else if (button.userData.pressed) {
            button.position.y = button.userData.originalY - 0.06;
            // Keep text sprite in sync
            if (button.userData.textSprite) {
                button.userData.textSprite.position.y = button.userData.originalY - 0.06 + 0.15;
            }
        } else if (button.userData.originalY !== undefined) {
            button.position.y = button.userData.originalY;
            // Keep text sprite in sync
            if (button.userData.textSprite) {
                button.userData.textSprite.position.y = button.userData.originalY + 0.15;
            }
        }
    });
}

// Knob drag events for FPS mode
window.addEventListener('mousedown', (event) => {
    if (controls.isLocked) {
        // Raycast from center of screen to check if looking at a knob
        mouseClick.set(0, 0);
        raycaster.setFromCamera(mouseClick, camera);
        const intersects = raycaster.intersectObjects(knobObjects);
        
        if (intersects.length > 0) {
            activeKnob = intersects[0].object;
            isDraggingKnob = true;
            event.preventDefault();
            renderer.domElement.style.cursor = 'grabbing';
            
            // Store initial values
            activeKnob.userData.dragStartValue = activeKnob.userData.value;
            activeKnob.userData.lastMovementY = 0;
        }
    } else {
        // Normal mode - use screen coordinates
        mouseClick.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouseClick.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        raycaster.setFromCamera(mouseClick, camera);
        const intersects = raycaster.intersectObjects(knobObjects);
        
        if (intersects.length > 0) {
            activeKnob = intersects[0].object;
            previousMouseY = event.clientY;
            isDraggingKnob = true;
            event.preventDefault();
        }
    }
});

window.addEventListener('mouseup', () => {
    if (activeKnob) {
        activeKnob = null;
        isDraggingKnob = false;
        renderer.domElement.style.cursor = 'none';
    }
});

// Use the pointer lock movement event for FPS mode
document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
        // Add movement event listener when locked
        document.addEventListener('mousemove', onPointerLockMove);
    } else {
        // Remove movement event listener when unlocked
        document.removeEventListener('mousemove', onPointerLockMove);
    }
});

function onPointerLockMove(event) {
    if (activeKnob && isDraggingKnob) {
        // Use movementY from the pointer lock API
        const deltaY = event.movementY;
        activeKnob.userData.value += deltaY * 0.01;
        activeKnob.userData.value = Math.max(0, Math.min(1, activeKnob.userData.value));
        
        const angleRange = 270 * Math.PI / 180;
        const rotationAngle = Math.PI - (activeKnob.userData.value - 0.5) * angleRange;
        activeKnob.rotation.y = rotationAngle;
        
        updateFilterParameter(activeKnob.userData.name, activeKnob.userData.value);
        updateKnobValueDisplay(activeKnob);
        
        // Prevent camera movement while dragging knob
        event.stopPropagation();
    }
}

// Regular mousemove for non-locked mode
window.addEventListener('mousemove', (event) => {
    if (!controls.isLocked && activeKnob && isDraggingKnob) {
        const deltaY = previousMouseY - event.clientY;
        activeKnob.userData.value += deltaY * 0.005;
        activeKnob.userData.value = Math.max(0, Math.min(1, activeKnob.userData.value));
        
        const angleRange = 270 * Math.PI / 180;
        const rotationAngle = Math.PI - (activeKnob.userData.value - 0.5) * angleRange;
        activeKnob.rotation.y = rotationAngle;
        
        updateFilterParameter(activeKnob.userData.name, activeKnob.userData.value);
        updateKnobValueDisplay(activeKnob);
        previousMouseY = event.clientY;
    }
});

// Click handler for FPS mode buttons
window.addEventListener('click', (event) => {
    // Don't handle click if we were dragging a knob
    if (isDraggingKnob) {
        isDraggingKnob = false;
        if (activeKnob) {
            activeKnob = null;
            renderer.domElement.style.cursor = 'none';
        }
        return;
    }
    
    if (controls.isLocked) {
        // Raycast from center of screen for button clicks
        mouseClick.set(0, 0);
        raycaster.setFromCamera(mouseClick, camera);
        const intersects = raycaster.intersectObjects(clickableObjects);
        
        for (let intersection of intersects) {
            if (intersection.object.userData.type === 'clickable') {
                handleClickedObject(intersection.object);
                event.preventDefault();
                break;
            }
        }
    } else {
        const clickedObject = getClickedObject(event);
        if (clickedObject) {
            handleClickedObject(clickedObject);
            return;
        }

        if (!controls.isLocked && event.target === renderer.domElement) {
            lockPointer();
        }
    }
});

// Add keyboard event listeners for movement
window.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'KeyW':
            movementState.forward = true;
            break;
        case 'KeyS':
            movementState.backward = true;
            break;
        case 'KeyA':
            movementState.left = true;
            break;
        case 'KeyD':
            movementState.right = true;
            break;
        case 'ShiftLeft':
            movementState.sprint = true;
            break;
        case 'Space':
            togglePauseResume();
            event.preventDefault();
            break;
    }
});

window.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW':
            movementState.forward = false;
            break;
        case 'KeyS':
            movementState.backward = false;
            break;
        case 'KeyA':
            movementState.left = false;
            break;
        case 'KeyD':
            movementState.right = false;
            break;
        case 'ShiftLeft':
            movementState.sprint = false;
            break;
    }
});

function animate() {
    requestAnimationFrame( animate );
    const now = performance.now();
    const delta = Math.min((now - lastFrameMs) / 1000, 0.05);
    lastFrameMs = now;

    updatePlayerMovement(delta);
    playmusic();
    clickanimation();
    updateLore();

    renderer.render( scene, camera );
}

animate();

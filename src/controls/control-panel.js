import * as THREE from 'three';
import { PROCEDURAL_SIGNALS } from '../audio/procedural-signals.js';
import { createGeneratedSource, createMp3Source } from '../audio/audio-controller.js';
import { normalizedPitchToFrequency, normalizedPitchToPlaybackRate } from '../audio/pitch-control.js';
import { restrictShadowCastingToLight } from '../rendering/shadow-caster.js';
import { createTextSprite } from '../ui/text-sprite.js';

export function createControlPanel({
  scene,
  camera,
  renderer,
  controls,
  tableLight,
  introDialog,
  lockPointer,
  audio,
  skyline
}) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const clickableObjects = [];
  const knobObjects = [];
  const buttonPositions = {};
  let currentPlayingButton = null;
  let currentFilterButton = null;
  let activeKnob = null;
  let previousMouseY = 0;
  let isDraggingKnob = false;
  let selectedMusicObjectUrl = null;

  const fileInput = createFileInput();
  const responseDisplay = createFrequencyResponseDisplay(scene);

  const stopButton = createButton(new THREE.Vector3(0, 1.26, 0.05), 'Stop/Resume', 0xff0000, 'STOP');
  buttonPositions['Stop/Resume'] = stopButton.position.y;

  createButton(
    new THREE.Vector3(-0.9, 1.28, 0.05),
    'Sine',
    0x00ff00,
    'SINE',
    { source: createGeneratedSource(PROCEDURAL_SIGNALS.sine) }
  );
  createButton(
    new THREE.Vector3(-0.5, 1.26, 0.05),
    'Square',
    0x00ff00,
    'SQUARE',
    { source: createGeneratedSource(PROCEDURAL_SIGNALS.square) }
  );
  createButton(
    new THREE.Vector3(0.5, 1.26, 0.05),
    'Triangle',
    0x00ff00,
    'TRIANGLE',
    { source: createGeneratedSource(PROCEDURAL_SIGNALS.triangle) }
  );
  createButton(
    new THREE.Vector3(0.9, 1.26, 0.05),
    'Saw',
    0x00ff00,
    'SAW',
    { source: createGeneratedSource(PROCEDURAL_SIGNALS.saw) }
  );
  createButton(
    new THREE.Vector3(-0.7, 1.26, 0.35),
    'Noise',
    0x00ff00,
    'NOISE',
    { source: createGeneratedSource(PROCEDURAL_SIGNALS.noise) }
  );
  createButton(
    new THREE.Vector3(0.7, 1.26, 0.35),
    'Rich',
    0x00ff00,
    'RICH',
    { source: createGeneratedSource(PROCEDURAL_SIGNALS.rich) }
  );

  const musicButton = createButton(
    new THREE.Vector3(-0.05, 1.28, 0.45),
    'Music',
    0x0000ff,
    'MUSIC',
    { source: createMp3Source('assets/audio/default-track.mp3'), music: true }
  );
  buttonPositions.Music = musicButton.position.y;
  currentPlayingButton = musicButton;
  audio.selectSource(musicButton.userData.source);

  createButton(
    new THREE.Vector3(0.45, 1.26, 0.45),
    'SelectMusic',
    0xffff00,
    'SELECT',
    { select: true }
  );

  createButton(new THREE.Vector3(-0.45, 1.26, 0.75), 'Lowpass', 0xff00ff, 'LOWP', { band: true });
  createButton(new THREE.Vector3(-0.15, 1.26, 0.75), 'Highpass', 0xff00ff, 'HIGHP', { band: true });
  createButton(new THREE.Vector3(0.15, 1.26, 0.75), 'Bandpass', 0xff00ff, 'BANDP', { band: true });
  createButton(new THREE.Vector3(0.45, 1.26, 0.75), 'Peaking', 0xff00ff, 'PEAK', { band: true });

  const pitchKnob = createKnob(new THREE.Vector3(0, 1.24, 1.3), 'pitchKnob', 0.5, 'PITCH', 0xff66ff);
  const cutoffKnob = createKnob(new THREE.Vector3(-0.3, 1.24, 1.05), 'cutoffKnob', 0.5, 'CUTOFF', 0x66ff66);
  const gainKnob = createKnob(new THREE.Vector3(0, 1.24, 1.05), 'gainKnob', 0.5, 'GAIN', 0x66ff66);
  const resonanceKnob = createKnob(new THREE.Vector3(0.3, 1.24, 1.05), 'resonanceKnob', 0.1, 'RESONANCE', 0x66ff66);

  installPointerHandlers();

  function createFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
        const url = URL.createObjectURL(file);
        if (selectedMusicObjectUrl) URL.revokeObjectURL(selectedMusicObjectUrl);
        selectedMusicObjectUrl = url;
        musicButton.userData.source = createMp3Source(url);
        resetPlayingButton(currentPlayingButton);
        resetStopButton();
        selectSource(musicButton);
        input.value = '';
      }
      setTimeout(lockPointer, 100);
    });
    input.addEventListener('cancel', () => setTimeout(lockPointer, 100));
    return input;
  }

  function createButton(position, name, color, text, options = {}) {
    let geometry;
    if (options.music) geometry = new THREE.BoxGeometry(0.8, 0.1, 0.1, 4, 4, 4);
    else if (options.select) geometry = new THREE.CylinderGeometry(0.05, 0.05, 0.05);
    else if (options.band) geometry = new THREE.CylinderGeometry(0.06, 0.06, 0.1);
    else geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.1);

    const button = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0 })
    );
    button.position.copy(position);
    button.castShadow = true;
    button.receiveShadow = true;
    restrictShadowCastingToLight(button, tableLight);
    Object.assign(button.userData, {
      type: 'clickable',
      name,
      clicked: false,
      band: Boolean(options.band),
      source: options.source,
      pressed: false
    });
    const textSprite = createTextSprite(text, position, color);
    button.userData.textSprite = textSprite;
    scene.add(button, textSprite);
    clickableObjects.push(button);
    return button;
  }

  function createKnob(position, name, initialValue, labelText, labelColor) {
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(createKnobCanvas()),
        color: 0xffffff,
        roughness: 0.3,
        metalness: 0.7
      }),
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.2 })
    ];
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 32), materials);
    knob.position.copy(position);
    knob.castShadow = true;
    knob.receiveShadow = true;
    restrictShadowCastingToLight(knob, tableLight);
    Object.assign(knob.userData, {
      type: 'knob',
      name,
      value: initialValue,
      labelName: labelText,
      labelColor
    });
    const labelSprite = createKnobLabel(labelText, position, labelColor);
    knob.userData.labelSprite = labelSprite;
    setKnobValue(knob, initialValue);
    scene.add(knob, labelSprite);
    knobObjects.push(knob);
    return knob;
  }

  function createKnobCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#888888';
    context.beginPath();
    context.arc(64, 64, 60, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#666666';
    context.beginPath();
    context.arc(64, 64, 50, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#444444';
    context.lineWidth = 2;
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      context.beginPath();
      context.moveTo(64 + Math.cos(angle) * 30, 64 + Math.sin(angle) * 30);
      context.lineTo(64 + Math.cos(angle) * 45, 64 + Math.sin(angle) * 45);
      context.stroke();
    }
    context.fillStyle = '#000000';
    context.beginPath();
    context.arc(64, 64, 8, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ff0000';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(64, 64);
    context.lineTo(104, 64);
    context.stroke();
    return canvas;
  }

  function createKnobLabel(text, position, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.position.copy(position);
    sprite.position.y += 0.15;
    sprite.scale.set(0.4, 0.2, 1);
    sprite.userData.labelText = text;
    sprite.userData.labelColor = color;
    return sprite;
  }

  function setKnobValue(knob, value) {
    knob.userData.value = Math.max(0, Math.min(1, value));
    const angleRange = 270 * Math.PI / 180;
    knob.rotation.y = Math.PI - (knob.userData.value - 0.5) * angleRange;
    updateKnobLabel(knob);
  }

  function updateKnobLabel(knob) {
    const canvas = knob.userData.labelSprite.material.map.image;
    const context = canvas.getContext('2d');
    const color = knob.userData.labelColor;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = `rgb(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255})`;
    context.font = 'Bold 24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(knob.userData.labelName, canvas.width / 2, canvas.height / 2 - 15);
    context.font = '20px Arial';
    context.fillStyle = '#ffff00';
    context.fillText(formatKnobValue(knob), canvas.width / 2, canvas.height / 2 + 20);
    knob.userData.labelSprite.material.map.needsUpdate = true;
  }

  function formatKnobValue(knob) {
    if (knob.userData.name === 'pitchKnob') {
      const pitchMode = audio.getPitchMode();
      if (pitchMode === 'playbackRate') return `${normalizedPitchToPlaybackRate(knob.userData.value).toFixed(2)}x`;
      if (pitchMode === 'frequency') return `${Math.round(normalizedPitchToFrequency(knob.userData.value))}Hz`;
      return 'N/A';
    }
    if (knob.userData.name === 'cutoffKnob') {
      const frequency = Math.exp(Math.log(20) + (Math.log(20000) - Math.log(20)) * knob.userData.value);
      return `${Math.round(frequency)}Hz`;
    }
    if (knob.userData.name === 'gainKnob') return `${(-18 + knob.userData.value * 36).toFixed(1)}dB`;
    return (0.1 + knob.userData.value * 19.9).toFixed(2);
  }

  function handleClickedObject(button) {
    if (button === stopButton) {
      togglePlayback();
      return;
    }
    if (button.userData.name === 'SelectMusic') {
      if (controls.isLocked) {
        controls.unlock();
        setTimeout(() => fileInput.click(), 0);
      } else {
        fileInput.click();
      }
      return;
    }
    if (button.userData.band) {
      selectFilter(button);
      return;
    }
    if (button !== currentPlayingButton) selectSource(button);
  }

  function selectSource(button) {
    resetPlayingButton(currentPlayingButton);
    resetStopButton();
    const pitch = audio.selectSource(button.userData.source);
    setKnobValue(pitchKnob, pitch);
    currentPlayingButton = button;
    animateButton(button);
  }

  function selectFilter(button) {
    if (currentFilterButton === button) {
      animateButton(button);
      currentFilterButton = null;
      audio.setFilter(null);
    } else {
      resetPlayingButton(currentFilterButton);
      currentFilterButton = button;
      audio.setFilter(button.userData.name.toLowerCase());
      animateButton(button);
    }
    updateFrequencyResponse();
  }

  function togglePlayback() {
    stopButton.userData.clicked = audio.togglePaused();
    animateButton(stopButton);
  }

  function updateKnob(knob, value) {
    setKnobValue(knob, value);
    if (knob === pitchKnob) audio.setPitch(knob.userData.value);
    else if (knob === cutoffKnob) audio.setFilterParameter('cutoff', knob.userData.value);
    else if (knob === gainKnob) audio.setFilterParameter('gain', knob.userData.value);
    else if (knob === resonanceKnob) audio.setFilterParameter('resonance', knob.userData.value);
    updateFrequencyResponse();
  }

  function isKnobInteractive(knob) {
    return knob !== pitchKnob || audio.getPitchMode() !== 'disabled';
  }

  function animateButton(button) {
    if (buttonPositions[button.userData.name] === undefined) {
      buttonPositions[button.userData.name] = button.position.y;
    }
    button.userData.pressed = !button.userData.pressed;
    button.userData.isAnimating = true;
    button.userData.animationStart = Date.now();
    button.userData.originalY = buttonPositions[button.userData.name];
  }

  function resetPlayingButton(button) {
    if (!button) return;
    button.userData.pressed = false;
    button.userData.isAnimating = false;
    const originalY = buttonPositions[button.userData.name];
    if (originalY !== undefined) {
      button.position.y = originalY;
      if (button.userData.textSprite) button.userData.textSprite.position.y = originalY + 0.15;
    }
  }

  function resetStopButton() {
    stopButton.userData.clicked = false;
    resetPlayingButton(stopButton);
  }

  function updateButtonAnimations() {
    for (const button of clickableObjects) {
      if (button.userData.isAnimating) {
        const progress = Math.min((Date.now() - button.userData.animationStart) / 150, 1);
        const movement = button.userData.pressed ? progress * -0.06 : (1 - progress) * -0.06;
        button.position.y = button.userData.originalY + movement;
        if (button.userData.textSprite) button.userData.textSprite.position.y = button.position.y + 0.15;
        if (progress >= 1) button.userData.isAnimating = false;
      } else if (button.userData.pressed) {
        button.position.y = button.userData.originalY - 0.06;
        if (button.userData.textSprite) button.userData.textSprite.position.y = button.position.y + 0.15;
      } else if (button.userData.originalY !== undefined) {
        button.position.y = button.userData.originalY;
        if (button.userData.textSprite) button.userData.textSprite.position.y = button.position.y + 0.15;
      }
    }
  }

  function updateFrequencyResponse() {
    const filterState = audio.getFilterState();
    const buildings = skyline.getBuildings();
    if (!filterState.type || buildings.length === 0) {
      responseDisplay.line.visible = false;
      responseDisplay.indicator.visible = false;
      return;
    }
    const multipliers = skyline.computeFilterMultipliers(filterState);
    const positions = new Float32Array(multipliers.length * 3);
    for (let index = 0; index < multipliers.length; index += 1) {
      const decibels = multipliers[index] > 0 ? 20 * Math.log10(multipliers[index]) : -60;
      const normalized = THREE.MathUtils.clamp((decibels + 48) / 60, 0, 1);
      positions[index * 3] = buildings[index].position.x;
      positions[index * 3 + 1] = 0.6 + normalized * 29.4;
      positions[index * 3 + 2] = buildings[index].position.z;
    }
    responseDisplay.line.geometry.dispose();
    responseDisplay.line.geometry = new THREE.BufferGeometry();
    responseDisplay.line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    responseDisplay.line.visible = true;
    const cutoffIndex = Math.round(cutoffKnob.userData.value * (multipliers.length - 1));
    responseDisplay.indicator.position.set(
      buildings[cutoffIndex].position.x,
      positions[cutoffIndex * 3 + 1],
      buildings[cutoffIndex].position.z
    );
    responseDisplay.indicator.visible = true;
  }

  function installPointerHandlers() {
    window.addEventListener('mousedown', (event) => {
      if (introDialog.isOpen()) return;
      setMouseFromEvent(event);
      raycaster.setFromCamera(mouse, camera);
      const intersection = raycaster.intersectObjects(knobObjects)[0];
      if (!intersection || !isKnobInteractive(intersection.object)) return;
      activeKnob = intersection.object;
      previousMouseY = event.clientY;
      isDraggingKnob = true;
      event.preventDefault();
      if (controls.isLocked) renderer.domElement.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      if (introDialog.isOpen()) return;
      activeKnob = null;
      isDraggingKnob = false;
      renderer.domElement.style.cursor = 'none';
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === renderer.domElement) {
        document.addEventListener('mousemove', onPointerLockMove);
      } else {
        document.removeEventListener('mousemove', onPointerLockMove);
      }
    });

    window.addEventListener('mousemove', (event) => {
      if (introDialog.isOpen() || controls.isLocked || !activeKnob || !isDraggingKnob) return;
      const deltaY = previousMouseY - event.clientY;
      updateKnob(activeKnob, activeKnob.userData.value + deltaY * 0.005);
      previousMouseY = event.clientY;
    });

    window.addEventListener('click', (event) => {
      if (introDialog.isOpen()) return;
      if (isDraggingKnob) {
        isDraggingKnob = false;
        activeKnob = null;
        renderer.domElement.style.cursor = 'none';
        return;
      }
      setMouseFromEvent(event);
      raycaster.setFromCamera(mouse, camera);
      const button = raycaster.intersectObjects(clickableObjects)
        .map((intersection) => intersection.object)
        .find((object) => object.userData.type === 'clickable');
      if (button) {
        handleClickedObject(button);
        event.preventDefault();
      } else if (!controls.isLocked && event.target === renderer.domElement) {
        lockPointer();
      }
    });
  }

  function onPointerLockMove(event) {
    if (introDialog.isOpen() || !activeKnob || !isDraggingKnob || !isKnobInteractive(activeKnob)) return;
    updateKnob(activeKnob, activeKnob.userData.value + event.movementY * 0.01);
    event.stopPropagation();
  }

  function setMouseFromEvent(event) {
    if (controls.isLocked) {
      mouse.set(0, 0);
    } else {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }
  }

  function update(audioState) {
    if (audioState.started && currentPlayingButton && !currentPlayingButton.userData.pressed) {
      currentPlayingButton.userData.pressed = true;
      currentPlayingButton.userData.isAnimating = true;
      currentPlayingButton.userData.animationStart = Date.now();
      currentPlayingButton.userData.originalY = buttonPositions[currentPlayingButton.userData.name];
    }
    updateButtonAnimations();
    updateFrequencyResponse();
  }

  return {
    update,
    togglePlayback,
    getPitchValue: () => pitchKnob.userData.value
  };
}

function createFrequencyResponseDisplay(scene) {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xff0000 })
  );
  line.visible = false;
  const indicator = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00 })
  );
  indicator.visible = false;
  scene.add(line, indicator);
  return { line, indicator };
}

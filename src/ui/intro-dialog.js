export function createIntroDialog({ renderer, controls, lockPointer }) {
  const overlay = document.createElement('div');
  overlay.id = 'intro-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'intro-title');
  overlay.setAttribute('aria-describedby', 'intro-description');

  const panel = document.createElement('section');
  panel.className = 'intro-panel';

  const title = document.createElement('h1');
  title.id = 'intro-title';
  title.textContent = 'Fourier City';

  const description = document.createElement('p');
  description.id = 'intro-description';
  description.textContent = 'A playable audio visualization: choose a waveform or MP3, shape it with filters and knobs, and watch the skyline react across the frequency spectrum.';

  const controlsList = document.createElement('div');
  controlsList.className = 'intro-controls';
  const controlRows = [
    ['WASD', 'Move through the city'],
    ['Shift', 'Sprint'],
    ['Mouse', 'Look around and aim at tabletop controls'],
    ['Click', 'Press waveform, music, and filter buttons'],
    ['Drag knobs', 'Adjust pitch, cutoff, gain, and resonance'],
    ['Space', 'Stop or resume the current sound']
  ];

  for (const [shortcut, explanation] of controlRows) {
    const row = document.createElement('div');
    row.className = 'intro-control-row';
    const key = document.createElement('kbd');
    key.textContent = shortcut;
    const text = document.createElement('span');
    text.textContent = explanation;
    row.append(key, text);
    controlsList.appendChild(row);
  }

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'intro-start-button';
  startButton.textContent = 'Start Exploring';
  startButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hide(true);
  });

  panel.append(title, description, controlsList, startButton);
  overlay.appendChild(panel);
  for (const eventName of ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'pointerdown', 'pointerup']) {
    overlay.addEventListener(eventName, (event) => event.stopPropagation());
  }
  document.body.appendChild(overlay);

  let open = true;

  function show() {
    open = true;
    overlay.hidden = false;
    if (document.pointerLockElement === renderer.domElement) controls.unlock();
    requestAnimationFrame(() => startButton.focus({ preventScroll: true }));
  }

  function hide(lockAfterDismiss = false) {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    renderer.domElement.focus({ preventScroll: true });
    if (lockAfterDismiss) lockPointer();
  }

  show();
  return { isOpen: () => open, show, hide };
}

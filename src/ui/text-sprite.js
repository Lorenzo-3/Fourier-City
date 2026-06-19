import * as THREE from 'three';

export function createTextSprite(text, position, color = 0xffffff) {
  const texture = createTextTexture(text, 256, color);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.position.y += 0.15;
  sprite.scale.set(0.3, 0.3, 1);
  return sprite;
}

function createTextTexture(text, size, color) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  const red = (color >> 16) & 255;
  const green = (color >> 8) & 255;
  const blue = color & 255;
  const colorString = `rgb(${red}, ${green}, ${blue})`;
  context.font = 'bold 32px "Arial", "Helvetica", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 5;
  context.strokeStyle = '#000000';
  context.strokeText(text, size / 2, size / 2);
  context.fillStyle = colorString;
  context.fillText(text, size / 2, size / 2);
  return new THREE.CanvasTexture(canvas);
}

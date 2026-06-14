import assert from 'node:assert/strict';
import test from 'node:test';
import { collidesWithCircle } from '../player-collision.mjs';

const PEDESTAL = { x: 0, z: -6, radius: 1.35 };

test('detects a player position inside the pedestal collision area', () => {
  assert.equal(collidesWithCircle({ x: 0.5, z: -6.5 }, PEDESTAL), true);
});

test('allows a player position outside the pedestal collision area', () => {
  assert.equal(collidesWithCircle({ x: 2, z: -6 }, PEDESTAL), false);
});

test('treats the pedestal collision boundary as blocked', () => {
  assert.equal(collidesWithCircle({ x: 1.35, z: -6 }, PEDESTAL), true);
});

test('supports padding the pedestal footprint for the player radius', () => {
  assert.equal(collidesWithCircle({ x: 1.65, z: -6 }, PEDESTAL, 0.35), true);
});

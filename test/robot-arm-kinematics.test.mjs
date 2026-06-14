import assert from 'node:assert/strict';
import test from 'node:test';
import { solveTwoLinkArm } from '../robot-arm-kinematics.mjs';

const LINK_LENGTH = 90;

test('solves a reachable two-link arm target', () => {
  const solution = solveTwoLinkArm(135, 60, LINK_LENGTH, LINK_LENGTH);
  const endpoint = getEndpoint(solution);

  assert.ok(Math.abs(endpoint.horizontal - 135) < 1e-6);
  assert.ok(Math.abs(endpoint.vertical - 60) < 1e-6);
  assert.equal(solution.clamped, false);
});

test('solves a target at the arm reach edge', () => {
  const solution = solveTwoLinkArm(180, 0, LINK_LENGTH, LINK_LENGTH);
  const endpoint = getEndpoint(solution);

  assert.ok(Math.abs(endpoint.horizontal - solution.reach) < 1e-6);
  assert.ok(Math.abs(endpoint.vertical) < 1e-6);
  assert.ok(solution.elbowAngle < 0.001);
});

test('clamps an unreachable target to the arm maximum reach', () => {
  const solution = solveTwoLinkArm(300, 0, LINK_LENGTH, LINK_LENGTH);
  const endpoint = getEndpoint(solution);

  assert.equal(solution.clamped, true);
  assert.ok(solution.reach < 180);
  assert.ok(Math.abs(endpoint.horizontal - solution.reach) < 1e-6);
});

function getEndpoint(solution) {
  return {
    horizontal: (
      LINK_LENGTH * Math.cos(solution.shoulderAngle)
      + LINK_LENGTH * Math.cos(solution.shoulderAngle + solution.elbowAngle)
    ),
    vertical: (
      LINK_LENGTH * Math.sin(solution.shoulderAngle)
      + LINK_LENGTH * Math.sin(solution.shoulderAngle + solution.elbowAngle)
    )
  };
}

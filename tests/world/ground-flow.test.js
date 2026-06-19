import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initializeGroundFlowData,
  updateGroundFlowData
} from '../../src/world/skyline/ground-flow.js';

const CONFIG = {
  buildingCount: 2,
  groundFlowEnergyExponent: 1,
  groundFlowAttack: 12,
  groundFlowDecay: 70,
  groundFlowPeakWeight: 0.8,
  groundFlowAverageWeight: 2
};

test('stores spectrum colors and animated energy in one RGBA texture row', () => {
  const data = new Uint8Array(8);
  initializeGroundFlowData(new Float32Array([1, 0.5, 0, 0, 0.5, 1]), data, 2);
  assert.deepEqual([...data], [255, 128, 0, 0, 0, 128, 255, 0]);

  const overallEnergy = updateGroundFlowData({
    energies: new Float32Array([1, 0]),
    deltaSeconds: 1 / 60,
    config: CONFIG,
    energyData: data,
    overallEnergy: 0
  });
  assert.ok(data[3] > 0);
  assert.equal(data[7], 0);
  assert.ok(overallEnergy > 0);
});

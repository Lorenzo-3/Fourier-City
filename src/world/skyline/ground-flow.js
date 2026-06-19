import * as THREE from 'three';

export function initializeGroundFlowData(baseColors, energyData, buildingCount) {
  for (let index = 0; index < buildingCount; index += 1) {
    const colorOffset = index * 3;
    const dataOffset = index * 4;
    energyData[dataOffset] = Math.round(baseColors[colorOffset] * 255);
    energyData[dataOffset + 1] = Math.round(baseColors[colorOffset + 1] * 255);
    energyData[dataOffset + 2] = Math.round(baseColors[colorOffset + 2] * 255);
    energyData[dataOffset + 3] = 0;
  }
}

export function updateGroundFlowData({ energies, deltaSeconds, config, energyData, overallEnergy }) {
  let peakEnergy = 0;
  let summedEnergy = 0;
  for (let index = 0; index < config.buildingCount; index += 1) {
    const shapedEnergy = Math.pow(
      THREE.MathUtils.clamp(energies[index] ?? 0, 0, 1),
      config.groundFlowEnergyExponent
    );
    const offset = index * 4;
    const currentEnergy = energyData[offset + 3] / 255;
    const rate = shapedEnergy > currentEnergy ? config.groundFlowAttack : config.groundFlowDecay;
    const blend = 1 - Math.exp(-rate * deltaSeconds);
    const nextEnergy = THREE.MathUtils.lerp(currentEnergy, shapedEnergy, blend);
    energyData[offset + 3] = Math.round(nextEnergy * 255);
    peakEnergy = Math.max(peakEnergy, nextEnergy);
    summedEnergy += nextEnergy;
  }

  const averageEnergy = summedEnergy / config.buildingCount;
  const target = Math.min(
    peakEnergy * config.groundFlowPeakWeight + averageEnergy * config.groundFlowAverageWeight,
    1
  );
  const rate = target > overallEnergy ? config.groundFlowAttack : config.groundFlowDecay;
  return THREE.MathUtils.lerp(overallEnergy, target, 1 - Math.exp(-rate * deltaSeconds));
}

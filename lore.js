import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CONFIG = {
    buildingCount:100,
    arcDegrees: 300,
    gapCenterRadians: 0,
    radius: 135,
    modelScale: 0.6,
    modelYawCorrectionDegrees: 0,
    solidColor: 0x05070b,
    solidEmissiveColor: 0x010306,
    wireframeColor: 0x00fff0,
    wireframeLineWidth: 1,
    wireframeSurfaceScale: 1.004,
    skylineUpdateFps: 30,
    fftSize: 1024,
    analyserMinDecibels: -90,
    analyserMaxDecibels: -8,
    analyserSmoothingTimeConstant: 0.05,
    minHz: 40,
    maxHz: 10000,
    heightBoost: 4,
    attack: 200,
    decay: 16,
    visualEnergyExponent: 1.05,
    groundFlowSize: 320,
    groundFlowYOffset: 0.018,
    groundFlowOuterRadius: 152,
    groundFlowInnerRadius: 1.6,
    groundFlowArcEdgeFade: 0.1,
    groundFlowAttack: 12,
    groundFlowDecay: 70,
    groundFlowEnergyExponent: 1.45,
    groundFlowPeakWeight: 0.80,
    groundFlowAverageWeight: 2
};

const PATCH_VERSION = 9;

const INSTANCE_CENTER = new THREE.Vector3(0, 0, 0);
const INSTANCE_SCALE = new THREE.Vector3();
const INSTANCE_MATRIX = new THREE.Matrix4();
const INSTANCE_ORIENTER = new THREE.Object3D();
const WIREFRAME_POINT = new THREE.Vector3();

const state = window.__fourierCityLore ?? {
    patched: false,
    patchVersion: 0,
    scene: null,
    camera: null,
    skyline: null,
    skylineLoading: false,
    animationLoopStarted: false,
    buildings: [],
    solidInstances: null,
    wireframeLines: null,
    wireframePositions: null,
    wireframeLineBuffer: null,
    wireframeMaterial: null,
    wireframeYFactors: null,
    groundFlow: null,
    groundFlowMaterial: null,
    groundFlowEnergyTexture: null,
    groundFlowEnergyData: new Uint8Array(CONFIG.buildingCount * 4),
    groundFlowOverallEnergy: 0,
    currentAudio: null,
    analyser: null,
    frequencyDbData: null,
    frequencyBands: null,
    rawBandDecibels: new Float32Array(CONFIG.buildingCount).fill(CONFIG.analyserMinDecibels),
    bandEnergies: new Float32Array(CONFIG.buildingCount),
    currentScales: new Float32Array(CONFIG.buildingCount),
    lastUpdateMs: performance.now()
};

window.__fourierCityLore = state;

if (state.bandEnergies.length !== CONFIG.buildingCount) {
    state.bandEnergies = new Float32Array(CONFIG.buildingCount);
    state.currentScales = new Float32Array(CONFIG.buildingCount);
}

if (!state.rawBandDecibels || state.rawBandDecibels.length !== CONFIG.buildingCount) {
    state.rawBandDecibels = new Float32Array(CONFIG.buildingCount);
    state.rawBandDecibels.fill(CONFIG.analyserMinDecibels);
}

if (!state.groundFlowEnergyData || state.groundFlowEnergyData.length !== CONFIG.buildingCount * 4) {
    state.groundFlowEnergyData = new Uint8Array(CONFIG.buildingCount * 4);
    state.groundFlowEnergyTexture = null;
}

if (typeof state.groundFlowOverallEnergy !== 'number') {
    state.groundFlowOverallEnergy = 0;
}

if (!state.patched) {
    patchSceneGraph();
    patchAudio();
    installAudioResumeHandlers();
    state.patched = true;
}

if (state.patchVersion !== PATCH_VERSION) {
    resetSkylineState();
    state.patchVersion = PATCH_VERSION;
}

startAnimationLoop();

function patchSceneGraph() {
    const originalAdd = THREE.Object3D.prototype.add;

    THREE.Object3D.prototype.add = function addWithLore(...objects) {
        const result = originalAdd.apply(this, objects);

        if (this instanceof THREE.Scene) {
            state.scene = this;
            ensureGroundFlow(this);
            ensureSkyline(this);
        } else if (this instanceof THREE.Camera) {
            state.camera = this;
        }

        return result;
    };
}

function startAnimationLoop() {
    if (state.animationLoopStarted) {
        return;
    }

    state.animationLoopStarted = true;

    const tick = () => {
        updateSkyline();
        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}

function patchAudio() {
    const originalSetBuffer = THREE.Audio.prototype.setBuffer;
    const originalPlay = THREE.Audio.prototype.play;

    THREE.Audio.prototype.setBuffer = function setBufferWithLore(buffer) {
        const result = originalSetBuffer.call(this, buffer);
        bindAudio(this, true);
        return result;
    };

    THREE.Audio.prototype.play = function playWithLore(delay = 0) {
        const result = originalPlay.call(this, delay);
        bindAudio(this);
        return result;
    };
}

function bindAudio(audio, resetCalibration = false) {
    if (!audio || !audio.context) {
        return;
    }

    const needsAnalyser = state.currentAudio !== audio || !state.analyser;

    if (needsAnalyser) {
        state.currentAudio = audio;
        state.analyser = new THREE.AudioAnalyser(audio, CONFIG.fftSize);
        state.analyser.analyser.minDecibels = CONFIG.analyserMinDecibels;
        state.analyser.analyser.maxDecibels = CONFIG.analyserMaxDecibels;
        state.analyser.analyser.smoothingTimeConstant = CONFIG.analyserSmoothingTimeConstant;
        state.frequencyDbData = new Float32Array(state.analyser.analyser.frequencyBinCount);
        state.frequencyBands = buildLogFrequencyBands(
            audio.context.sampleRate,
            state.analyser.analyser.fftSize,
            state.analyser.analyser.frequencyBinCount,
            CONFIG.buildingCount
        );
    }

    if (needsAnalyser || resetCalibration) {
        resetEnergyCalibration();
    }
}

function resetEnergyCalibration() {
    state.rawBandDecibels?.fill(CONFIG.analyserMinDecibels);
    state.bandEnergies?.fill(0);
}

function installAudioResumeHandlers() {
    const resumeAudioContext = () => {
        const context = state.currentAudio?.context;

        if (context?.state === 'suspended') {
            context.resume();
        }
    };

    window.addEventListener('pointerdown', resumeAudioContext);
    window.addEventListener('keydown', resumeAudioContext);
}

function resetSkylineState() {
    if (state.skyline?.parent) {
        state.skyline.parent.remove(state.skyline);
    }

    disposeGroundFlow();

    state.skyline = null;
    state.skylineLoading = false;
    state.buildings = [];
    state.solidInstances = null;
    state.wireframeLines = null;
    state.wireframePositions = null;
    state.wireframeLineBuffer = null;
    state.wireframeMaterial = null;
    state.wireframeYFactors = null;
    state.currentScales.fill(0);
    resetEnergyCalibration();

    if (state.scene) {
        ensureGroundFlow(state.scene);
        ensureSkyline(state.scene);
    }
}

function ensureGroundFlow(scene) {
    if (state.groundFlow) {
        if (state.groundFlow.parent !== scene) {
            scene.add(state.groundFlow);
        }

        return;
    }

    const energyTexture = createGroundFlowEnergyTexture();
    const material = createGroundFlowMaterial(energyTexture);
    const geometry = new THREE.PlaneGeometry(CONFIG.groundFlowSize, CONFIG.groundFlowSize);
    const groundFlow = new THREE.Mesh(geometry, material);

    groundFlow.name = 'FrequencyGroundFlow';
    groundFlow.rotation.x = -Math.PI / 2;
    groundFlow.position.y = CONFIG.groundFlowYOffset;
    groundFlow.frustumCulled = false;
    groundFlow.renderOrder = 4;

    state.groundFlow = groundFlow;
    state.groundFlowMaterial = material;
    state.groundFlowEnergyTexture = energyTexture;
    scene.add(groundFlow);
}

function disposeGroundFlow() {
    if (state.groundFlow?.parent) {
        state.groundFlow.parent.remove(state.groundFlow);
    }

    state.groundFlow?.geometry?.dispose();
    state.groundFlowMaterial?.dispose();
    state.groundFlowEnergyTexture?.dispose();

    state.groundFlow = null;
    state.groundFlowMaterial = null;
    state.groundFlowEnergyTexture = null;
    state.groundFlowOverallEnergy = 0;
    state.groundFlowEnergyData?.fill(0);
}

function createGroundFlowEnergyTexture() {
    const texture = new THREE.DataTexture(
        state.groundFlowEnergyData,
        CONFIG.buildingCount,
        1,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
    );

    texture.name = 'FrequencyGroundFlowEnergy';
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    return texture;
}

function createGroundFlowMaterial(energyTexture) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uEnergyMap: { value: energyTexture },
            uTime: { value: 0 },
            uStartAngle: { value: getArcStartAngle() },
            uArcRadians: { value: getArcRadians() },
            uOuterRadius: { value: CONFIG.groundFlowOuterRadius },
            uInnerRadius: { value: CONFIG.groundFlowInnerRadius },
            uArcEdgeFade: { value: CONFIG.groundFlowArcEdgeFade },
            uOverallEnergy: { value: 0 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;

            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            precision mediump float;

            uniform sampler2D uEnergyMap;
            uniform float uTime;
            uniform float uStartAngle;
            uniform float uArcRadians;
            uniform float uOuterRadius;
            uniform float uInnerRadius;
            uniform float uArcEdgeFade;
            uniform float uOverallEnergy;

            varying vec3 vWorldPosition;

            const float TWO_PI = 6.28318530718;

            float saturate(float value) {
                return clamp(value, 0.0, 1.0);
            }

            void main() {
                vec2 groundPosition = vWorldPosition.xz;
                float radius = length(groundPosition);
                float angle = atan(groundPosition.x, groundPosition.y);
                float clockwiseDelta = mod(uStartAngle - angle + TWO_PI, TWO_PI);
                float bandUv = saturate(clockwiseDelta / max(uArcRadians, 0.0001));
                float bandEnergy = max(
                    texture2D(uEnergyMap, vec2(bandUv, 0.5)).r,
                    uOverallEnergy * 0.05
                );

                float leadingEdge = smoothstep(0.0, uArcEdgeFade, clockwiseDelta);
                float trailingEdge = 1.0 - smoothstep(uArcRadians - uArcEdgeFade, uArcRadians, clockwiseDelta);
                float arcMask = leadingEdge * trailingEdge * step(clockwiseDelta, uArcRadians);

                float radialStart = smoothstep(uInnerRadius, uInnerRadius + 10.0, radius);
                float radialEnd = 1.0 - smoothstep(uOuterRadius - 18.0, uOuterRadius + 10.0, radius);
                float radialMask = radialStart * radialEnd;

                float outwardWave = 0.5 + 0.5 * sin(radius * 0.21 - uTime * 3.2);
                float pulse = smoothstep(0.25, 1.0, outwardWave) * (0.35 + 0.65 * uOverallEnergy);
                float activeFan = bandEnergy * arcMask * radialMask * (0.66 + 0.26 * pulse);
                float idleFan = arcMask * radialMask * (0.01 + uOverallEnergy * 0.07);

                float sourceGlow = (1.0 - smoothstep(0.0, 22.0, radius)) * (0.07 + 0.46 * uOverallEnergy);
                float skylineContact = bandEnergy
                    * arcMask
                    * smoothstep(uOuterRadius - 38.0, uOuterRadius - 6.0, radius)
                    * (1.0 - smoothstep(uOuterRadius - 6.0, uOuterRadius + 5.0, radius))
                    * 0.42;
                float intensity = sourceGlow + activeFan * 0.9 + idleFan + skylineContact;

                if (intensity < 0.004) {
                    discard;
                }

                vec3 deepCyan = vec3(0.0, 0.34, 0.45);
                vec3 cyan = vec3(0.0, 1.0, 0.92);
                vec3 whiteHot = vec3(1.0, 1.0, 0.92);
                vec3 color = mix(deepCyan, cyan, saturate(activeFan * 1.6 + uOverallEnergy * 0.28));
                color = mix(color, whiteHot, saturate(sourceGlow * 0.65 + bandEnergy * 0.05));

                gl_FragColor = vec4(color * (0.82 + intensity * 0.9), saturate(intensity * 0.78));
            }
        `,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false
    });
}

async function ensureSkyline(scene) {
    if (state.skyline) {
        if (state.skyline.parent !== scene) {
            scene.add(state.skyline);
        }

        return;
    }

    if (state.skylineLoading) {
        return;
    }

    state.skylineLoading = true;

    try {
        const loader = new OBJLoader();
        const [model, objText] = await Promise.all([
            loader.loadAsync('models/skyscraper.obj'),
            loadText('models/skyscraper.obj')
        ]);
        const normalizeMatrix = getNormalizeMatrix(model);
        const geometry = buildInstancedGeometry(model, normalizeMatrix);
        const wireframeGeometry = buildQuadWireframeGeometry(objText, normalizeMatrix);
        const skyline = buildSkyline(geometry, wireframeGeometry);

        state.skyline = skyline;
        scene.add(skyline);
    } catch (error) {
        console.error('Fourier City lore skyline failed to load:', error);
    } finally {
        state.skylineLoading = false;
    }
}

function loadText(url) {
    return new Promise((resolve, reject) => {
        new THREE.FileLoader().load(url, resolve, undefined, reject);
    });
}

function getNormalizeMatrix(model) {
    model.rotation.y = THREE.MathUtils.degToRad(CONFIG.modelYawCorrectionDegrees);
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    return new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
}

function buildInstancedGeometry(model, normalizeMatrix) {
    const geometries = [];

    model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            const geometry = child.geometry.clone();
            geometry.applyMatrix4(child.matrixWorld);
            geometry.applyMatrix4(normalizeMatrix);
            geometries.push(geometry);
        }
    });

    if (!geometries.length) {
        throw new Error('No mesh geometry found in skyscraper.obj');
    }

    const mergedGeometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);

    if (!mergedGeometry) {
        throw new Error('Unable to merge skyscraper geometry');
    }

    mergedGeometry.computeBoundingBox();
    mergedGeometry.computeBoundingSphere();

    return mergedGeometry;
}

function buildQuadWireframeGeometry(objText, normalizeMatrix) {
    const vertices = [];
    const uniqueEdges = new Set();
    const positions = [];
    const transformMatrix = new THREE.Matrix4()
        .makeRotationY(THREE.MathUtils.degToRad(CONFIG.modelYawCorrectionDegrees))
        .premultiply(normalizeMatrix);
    const point = new THREE.Vector3();

    for (const line of objText.split('\n')) {
        if (line.startsWith('v ')) {
            const [, x, y, z] = line.trim().split(/\s+/).map(Number);
            vertices.push(new THREE.Vector3(x, y, z).applyMatrix4(transformMatrix));
        } else if (line.startsWith('f ')) {
            const face = line.trim().split(/\s+/).slice(1).map((part) => {
                const rawIndex = Number(part.split('/')[0]);
                return rawIndex > 0 ? rawIndex - 1 : vertices.length + rawIndex;
            });

            for (let index = 0; index < face.length; index += 1) {
                const a = face[index];
                const b = face[(index + 1) % face.length];
                const key = a < b ? `${a}/${b}` : `${b}/${a}`;

                if (!uniqueEdges.has(key)) {
                    uniqueEdges.add(key);
                    point.copy(vertices[a]);
                    positions.push(point.x, point.y, point.z);
                    point.copy(vertices[b]);
                    positions.push(point.x, point.y, point.z);
                }
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
}

function buildSkyline(geometry, wireframeGeometry) {
    const skyline = new THREE.Group();
    skyline.name = 'AudioReactiveSkyline';

    const solidMaterial = new THREE.MeshPhongMaterial({
        color: CONFIG.solidColor,
        emissive: CONFIG.solidEmissiveColor,
        shininess: 80,
        specular: 0x2f3842
    });
    const wireframeMaterial = new LineMaterial({
        color: CONFIG.wireframeColor,
        linewidth: CONFIG.wireframeLineWidth,
        worldUnits: false,
        depthTest: true,
        depthWrite: false,
        transparent: false,
        alphaToCoverage: true
    });
    const solidInstances = new THREE.InstancedMesh(geometry, solidMaterial, CONFIG.buildingCount);
    const wireframeData = buildSkylineWireframe(wireframeGeometry, wireframeMaterial);
    const wireframeLines = wireframeData.lines;
    const startAngle = getArcStartAngle();
    const arcRadians = getArcRadians();
    const step = -arcRadians / (CONFIG.buildingCount - 1);

    state.buildings = [];
    state.solidInstances = solidInstances;
    state.wireframeLines = wireframeLines;
    state.wireframePositions = wireframeData.positions;
    state.wireframeLineBuffer = wireframeData.lineBuffer;
    state.wireframeMaterial = wireframeMaterial;
    state.wireframeYFactors = wireframeData.yFactors;

    solidInstances.name = 'AudioReactiveSkylineSolid';
    wireframeLines.name = 'AudioReactiveSkylineQuadWireframe';
    solidInstances.frustumCulled = false;
    wireframeLines.frustumCulled = false;
    solidInstances.renderOrder = 10;
    wireframeLines.renderOrder = 11;

    for (let index = 0; index < CONFIG.buildingCount; index += 1) {
        const angle = startAngle + step * index;
        const restHeight = 0.06;
        const position = new THREE.Vector3(
            Math.sin(angle) * CONFIG.radius,
            0,
            Math.cos(angle) * CONFIG.radius
        );

        INSTANCE_ORIENTER.position.copy(position);
        INSTANCE_ORIENTER.lookAt(INSTANCE_CENTER);
        INSTANCE_SCALE.set(CONFIG.modelScale, CONFIG.modelScale * restHeight, CONFIG.modelScale);
        INSTANCE_MATRIX.compose(position, INSTANCE_ORIENTER.quaternion, INSTANCE_SCALE);

        solidInstances.setMatrixAt(index, INSTANCE_MATRIX);
        state.currentScales[index] = INSTANCE_SCALE.y;
        state.buildings.push({
            position,
            quaternion: INSTANCE_ORIENTER.quaternion.clone(),
            restHeight,
            frequencyBand: index
        });
    }

    solidInstances.instanceMatrix.needsUpdate = true;
    syncWireframeResolution();
    syncWireframePositions();
    skyline.add(solidInstances, wireframeLines);

    return skyline;
}

function buildSkylineWireframe(wireframeGeometry, material) {
    const sourcePositions = wireframeGeometry.getAttribute('position');
    const sourceCount = sourcePositions.count;
    const positions = new Float32Array(sourceCount * CONFIG.buildingCount * 3);
    const yFactors = new Float32Array(sourceCount * CONFIG.buildingCount);
    const lineGeometry = new LineSegmentsGeometry();
    const line = new LineSegments2(lineGeometry, material);

    for (let buildingIndex = 0; buildingIndex < CONFIG.buildingCount; buildingIndex += 1) {
        const angle = getBuildingAngle(buildingIndex);
        const position = new THREE.Vector3(
            Math.sin(angle) * CONFIG.radius,
            0,
            Math.cos(angle) * CONFIG.radius
        );

        INSTANCE_ORIENTER.position.copy(position);
        INSTANCE_ORIENTER.lookAt(INSTANCE_CENTER);

        for (let vertexIndex = 0; vertexIndex < sourceCount; vertexIndex += 1) {
            const sourceOffset = vertexIndex * 3;
            const targetIndex = buildingIndex * sourceCount + vertexIndex;
            const targetOffset = targetIndex * 3;
            const localY = sourcePositions.array[sourceOffset + 1];

            WIREFRAME_POINT.set(
                sourcePositions.array[sourceOffset] * CONFIG.modelScale * CONFIG.wireframeSurfaceScale,
                0,
                sourcePositions.array[sourceOffset + 2] * CONFIG.modelScale * CONFIG.wireframeSurfaceScale
            ).applyQuaternion(INSTANCE_ORIENTER.quaternion);

            positions[targetOffset] = position.x + WIREFRAME_POINT.x;
            positions[targetOffset + 1] = localY * CONFIG.modelScale * 0.06;
            positions[targetOffset + 2] = position.z + WIREFRAME_POINT.z;
            yFactors[targetIndex] = localY;
        }
    }

    lineGeometry.setPositions(positions);

    return {
        lines: line,
        positions,
        lineBuffer: lineGeometry.attributes.instanceStart.data,
        yFactors
    };
}

function getBuildingAngle(index) {
    const startAngle = getArcStartAngle();
    const arcRadians = getArcRadians();
    const step = -arcRadians / (CONFIG.buildingCount - 1);

    return startAngle + step * index;
}

function getArcRadians() {
    return THREE.MathUtils.degToRad(CONFIG.arcDegrees);
}

function getArcStartAngle() {
    const arcRadians = getArcRadians();
    const gapRadians = Math.PI * 2 - arcRadians;
    return CONFIG.gapCenterRadians - gapRadians / 2;
}

function updateSkyline() {
    if (!state.buildings.length || !state.solidInstances || !state.wireframeLines) {
        return;
    }

    const now = performance.now();
    const minUpdateIntervalMs = 1000 / CONFIG.skylineUpdateFps;

    if (now - state.lastUpdateMs < minUpdateIntervalMs) {
        return;
    }

    const deltaSeconds = Math.min((now - state.lastUpdateMs) / 1000, 0.08);
    state.lastUpdateMs = now;

    const energies = readFrequencyBandEnergies();
    updateGroundFlow(energies, deltaSeconds);

    for (let index = 0; index < state.buildings.length; index += 1) {
        const building = state.buildings[index];
        const energy = energies[index] ?? 0;
        const targetScale = CONFIG.modelScale * (
            building.restHeight + energy * CONFIG.heightBoost
        );
        const currentScale = state.currentScales[index] || CONFIG.modelScale * building.restHeight;
        const rate = targetScale > currentScale ? CONFIG.attack : CONFIG.decay;
        const blend = 1 - Math.exp(-rate * deltaSeconds);
        const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, blend);

        state.currentScales[index] = nextScale;
        INSTANCE_SCALE.set(CONFIG.modelScale, nextScale, CONFIG.modelScale);
        INSTANCE_MATRIX.compose(building.position, building.quaternion, INSTANCE_SCALE);
        state.solidInstances.setMatrixAt(index, INSTANCE_MATRIX);
    }

    state.solidInstances.instanceMatrix.needsUpdate = true;
    syncWireframeResolution();
    syncWireframePositions();
}

function updateGroundFlow(energies, deltaSeconds) {
    if (!state.groundFlowMaterial || !state.groundFlowEnergyTexture || !state.groundFlowEnergyData) {
        return;
    }

    const data = state.groundFlowEnergyData;
    let peakEnergy = 0;
    let summedEnergy = 0;

    for (let index = 0; index < CONFIG.buildingCount; index += 1) {
        const shapedEnergy = Math.pow(
            THREE.MathUtils.clamp(energies[index] ?? 0, 0, 1),
            CONFIG.groundFlowEnergyExponent
        );
        const value = Math.round(shapedEnergy * 255);
        const offset = index * 4;

        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
        peakEnergy = Math.max(peakEnergy, shapedEnergy);
        summedEnergy += shapedEnergy;
    }

    state.groundFlowEnergyTexture.needsUpdate = true;

    const averageEnergy = summedEnergy / CONFIG.buildingCount;
    const targetOverallEnergy = Math.min(
        peakEnergy * CONFIG.groundFlowPeakWeight
            + averageEnergy * CONFIG.groundFlowAverageWeight,
        1
    );
    const groundFlowRate = targetOverallEnergy > state.groundFlowOverallEnergy
        ? CONFIG.groundFlowAttack
        : CONFIG.groundFlowDecay;
    const blend = 1 - Math.exp(-groundFlowRate * deltaSeconds);

    state.groundFlowOverallEnergy = THREE.MathUtils.lerp(
        state.groundFlowOverallEnergy,
        targetOverallEnergy,
        blend
    );
    state.groundFlowMaterial.uniforms.uTime.value = performance.now() / 1000;
    state.groundFlowMaterial.uniforms.uOverallEnergy.value = state.groundFlowOverallEnergy;
}

function syncWireframeResolution() {
    const material = state.wireframeMaterial;

    if (!material?.resolution) {
        return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    material.resolution.set(
        window.innerWidth * pixelRatio,
        window.innerHeight * pixelRatio
    );
}

function syncWireframePositions() {
    const positions = state.wireframePositions;
    const lineBuffer = state.wireframeLineBuffer;
    const yFactors = state.wireframeYFactors;

    if (!positions || !lineBuffer || !yFactors) {
        return;
    }

    const verticesPerBuilding = yFactors.length / CONFIG.buildingCount;

    for (let index = 0; index < yFactors.length; index += 1) {
        const buildingIndex = Math.floor(index / verticesPerBuilding);
        positions[index * 3 + 1] = yFactors[index] * state.currentScales[buildingIndex];
    }

    lineBuffer.needsUpdate = true;
}

function readFrequencyBandEnergies() {
    if (!state.analyser || !state.currentAudio || !state.currentAudio.isPlaying || !state.frequencyBands || !state.frequencyDbData) {
        state.rawBandDecibels.fill(CONFIG.analyserMinDecibels);
        state.bandEnergies.fill(0);
        return state.bandEnergies;
    }

    state.analyser.analyser.getFloatFrequencyData(state.frequencyDbData);

    for (let bandIndex = 0; bandIndex < state.frequencyBands.length; bandIndex += 1) {
        const band = state.frequencyBands[bandIndex];
        let decibelSum = 0;

        for (let index = band.startBin; index <= band.endBin; index += 1) {
            decibelSum += state.frequencyDbData[index];
        }

        const averageDecibels = Math.max(
            decibelSum / band.binCount,
            CONFIG.analyserMinDecibels
        );
        const rawEnergy = THREE.MathUtils.clamp(
            (averageDecibels - CONFIG.analyserMinDecibels)
                / (CONFIG.analyserMaxDecibels - CONFIG.analyserMinDecibels),
            0,
            1
        );

        state.rawBandDecibels[bandIndex] = averageDecibels;
        state.bandEnergies[bandIndex] = Math.pow(rawEnergy, CONFIG.visualEnergyExponent);
    }

    return state.bandEnergies;
}

function buildLogFrequencyBands(sampleRate, fftSize, frequencyBinCount, bandCount) {
    const nyquist = sampleRate / 2;
    const maxHz = Math.min(CONFIG.maxHz, nyquist);
    const minHz = Math.max(CONFIG.minHz, sampleRate / fftSize);
    const hzPerBin = sampleRate / fftSize;

    return Array.from({ length: bandCount }, (_, bandIndex) => {
        const lowerRatio = bandIndex / bandCount;
        const upperRatio = (bandIndex + 1) / bandCount;
        const lowerHz = minHz * ((maxHz / minHz) ** lowerRatio);
        const upperHz = minHz * ((maxHz / minHz) ** upperRatio);
        const startBin = THREE.MathUtils.clamp(
            Math.floor(lowerHz / hzPerBin),
            1,
            frequencyBinCount - 1
        );
        const endBin = THREE.MathUtils.clamp(
            Math.max(startBin, Math.ceil(upperHz / hzPerBin) - 1),
            1,
            frequencyBinCount - 1
        );
        return {
            startBin,
            endBin,
            binCount: endBin - startBin + 1
        };
    });
}

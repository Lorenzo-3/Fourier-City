import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalizedValueToSample } from './skyline-target.mjs';

const CONFIG = {
    buildingCount:70,
    arcDegrees: 210,
    gapCenterRadians: 0,
    radius: 135,
    modelScale: 0.6,
    modelYawCorrectionDegrees: 0,
    solidColor: 0x05070b,
    solidEmissiveColor: 0x010306,
    wireframeLineWidth: 1,
    wireframeSurfaceScale: 1.004,
    wireframeIdleBrightness: 0.35,
    wireframeEnergyBrightness: 0.65,
    skylineUpdateFps: 30,
    fftSize: 2048,
    analyserMinDecibels: -90,
    analyserMaxDecibels: -8,
    analyserSmoothingTimeConstant: 0.05,
    minHz: 20,
    maxHz: 20000,
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
    groundFlowAverageWeight: 2,
    groundVoronoiCellSize: 0.5,
    groundVoronoiIdleIntensity: 0.10,
    groundVoronoiMusicBoost: 0.18,
    groundVoronoiSpecularSharpness: 38,
    groundVoronoiEdgeFade: 38
};

const SPECTRUM_COLOR_ANCHORS = [
    { frequency: 20, color: new THREE.Color(0x3b3bff) },   // Deep Bass
    { frequency: 40, color: new THREE.Color(0x3b7bff) },   // Low Bass
    { frequency: 80, color: new THREE.Color(0x3bcbff) },   // Mild Bass
    { frequency: 160, color: new THREE.Color(0x3bffcb) },  // Upper Bass
    { frequency: 300, color: new THREE.Color(0x7bff3b) },  // Lower Midrange
    { frequency: 600, color: new THREE.Color(0xcbff3b) },  // Middle Midrange
    { frequency: 1200, color: new THREE.Color(0xffcb3b) }, // Upper Midrange
    { frequency: 2400, color: new THREE.Color(0xff7b3b) }, // Presence Range
    { frequency: 5000, color: new THREE.Color(0xff3b5b) }, // High End
    { frequency: 10000, color: new THREE.Color(0xff3bab) }, // Extreme High End
    { frequency: 20000, color: new THREE.Color(0xbf3bff) }
];

const PATCH_VERSION = 12;

const INSTANCE_CENTER = new THREE.Vector3(0, 0, 0);
const INSTANCE_SCALE = new THREE.Vector3();
const INSTANCE_MATRIX = new THREE.Matrix4();
const INSTANCE_ORIENTER = new THREE.Object3D();
const WIREFRAME_POINT = new THREE.Vector3();

const state = window.__fourierCityLore ?? {
    patchVersion: 0,
    scene: null,
    camera: null,
    skyline: null,
    skylineLoading: false,
    resumeHandlersInstalled: false,
    buildings: [],
    solidInstances: null,
    wireframeLines: null,
    wireframePositions: null,
    wireframeLineBuffer: null,
    wireframeColors: null,
    wireframeColorBuffer: null,
    wireframeMaterial: null,
    wireframeYFactors: null,
    skylineModelHeight: 0,
    baseBuildingColors: new Float32Array(CONFIG.buildingCount * 3),
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

if (!state.baseBuildingColors || state.baseBuildingColors.length !== CONFIG.buildingCount * 3) {
    state.baseBuildingColors = new Float32Array(CONFIG.buildingCount * 3);
}

if (typeof state.skylineModelHeight !== 'number') {
    state.skylineModelHeight = 0;
}

buildBaseBuildingColors();

if (typeof state.groundFlowOverallEnergy !== 'number') {
    state.groundFlowOverallEnergy = 0;
}

if (state.patchVersion !== PATCH_VERSION) {
    resetSkylineState();
    state.patchVersion = PATCH_VERSION;
}

export function initializeLore({ scene, camera, audio }) {
    if (!scene || !camera || !audio) {
        throw new Error('initializeLore requires a scene, camera, and audio source');
    }

    state.scene = scene;
    state.camera = camera;

    ensureGroundFlow(scene);
    ensureSkyline(scene);
    bindAudio(audio, true);
    installAudioResumeHandlers();
}

export function updateLore() {
    updateSkyline();
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
    if (state.resumeHandlersInstalled) {
        return;
    }

    const resumeAudioContext = () => {
        const context = state.currentAudio?.context;

        if (context?.state === 'suspended') {
            context.resume();
        }
    };

    window.addEventListener('pointerdown', resumeAudioContext);
    window.addEventListener('keydown', resumeAudioContext);
    state.resumeHandlersInstalled = true;
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
    state.wireframeColors = null;
    state.wireframeColorBuffer = null;
    state.wireframeMaterial = null;
    state.wireframeYFactors = null;
    state.skylineModelHeight = 0;
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
    initializeGroundFlowSpectrumData();

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
            uOverallEnergy: { value: 0 },
            uGroundHalfSize: { value: CONFIG.groundFlowSize * 0.5 },
            uVoronoiCellSize: { value: CONFIG.groundVoronoiCellSize },
            uVoronoiIdleIntensity: { value: CONFIG.groundVoronoiIdleIntensity },
            uVoronoiMusicBoost: { value: CONFIG.groundVoronoiMusicBoost },
            uVoronoiSpecularSharpness: { value: CONFIG.groundVoronoiSpecularSharpness },
            uVoronoiEdgeFade: { value: CONFIG.groundVoronoiEdgeFade }
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
            uniform float uGroundHalfSize;
            uniform float uVoronoiCellSize;
            uniform float uVoronoiIdleIntensity;
            uniform float uVoronoiMusicBoost;
            uniform float uVoronoiSpecularSharpness;
            uniform float uVoronoiEdgeFade;
            varying vec3 vWorldPosition;

            const float TWO_PI = 6.28318530718;

            float saturate(float value) { return clamp(value, 0.0, 1.0); }

            vec2 hash22(vec2 point) {
                vec2 hashed = vec2(dot(point, vec2(127.1, 311.7)), dot(point, vec2(269.5, 183.3)));
                return fract(sin(hashed) * 43758.5453);
            }

            vec3 getVoronoiData(vec2 point) {
                vec2 cell = floor(point);
                vec2 localPoint = fract(point);
                float closestDistance = 8.0;
                float secondDistance = 8.0;
                vec2 closestCell = vec2(0.0);
                for (int y = -1; y <= 1; y++) {
                    for (int x = -1; x <= 1; x++) {
                        vec2 offset = vec2(float(x), float(y));
                        vec2 featurePoint = offset + hash22(cell + offset);
                        float distanceToPoint = length(featurePoint - localPoint);
                        if (distanceToPoint < closestDistance) {
                            secondDistance = closestDistance;
                            closestDistance = distanceToPoint;
                            closestCell = cell + offset;
                        } else if (distanceToPoint < secondDistance) {
                            secondDistance = distanceToPoint;
                        }
                    }
                }
                return vec3(closestDistance, secondDistance - closestDistance, hash22(closestCell).x);
            }

            void main() {
                vec2 groundPosition = vWorldPosition.xz;
                float radius = length(groundPosition);
                float angle = atan(groundPosition.x, groundPosition.y);
                float clockwiseDelta = mod(uStartAngle - angle + TWO_PI, TWO_PI);
                float bandUv = saturate(clockwiseDelta / max(uArcRadians, 0.0001));
                vec4 bandSample = texture2D(uEnergyMap, vec2(bandUv, 0.5));
                vec3 bandColor = bandSample.rgb;
                float bandEnergy = max(bandSample.a, uOverallEnergy * 0.05);

                float leadingEdge = smoothstep(0.0, uArcEdgeFade, clockwiseDelta);
                float trailingEdge = 1.0 - smoothstep(uArcRadians - uArcEdgeFade, uArcRadians, clockwiseDelta);
                float arcMask = leadingEdge * trailingEdge * step(clockwiseDelta, uArcRadians);

                float radialStart = smoothstep(uInnerRadius, uInnerRadius + 10.0, radius);
                float radialEnd = 1.0 - smoothstep(uOuterRadius - 18.0, uOuterRadius + 10.0, radius);
                float radialMask = radialStart * radialEnd;
                float flowMask = arcMask * radialMask;

                float outwardWave = 0.5 + 0.5 * sin(radius * 0.21 - uTime * 3.2);
                float pulse = smoothstep(0.25, 1.0, outwardWave) * (0.35 + 0.65 * uOverallEnergy);
                float activeFan = bandEnergy * flowMask * (0.66 + 0.26 * pulse);
                float idleFan = flowMask * (0.01 + uOverallEnergy * 0.07);

                float sourceGlow = (1.0 - smoothstep(0.0, 22.0, radius)) * (0.07 + 0.46 * uOverallEnergy);
                float skylineContact = bandEnergy * flowMask *
                    smoothstep(uOuterRadius - 38.0, uOuterRadius - 6.0, radius) *
                    (1.0 - smoothstep(uOuterRadius - 6.0, uOuterRadius + 5.0, radius)) * 0.42;
                float intensity = sourceGlow + activeFan * 0.9 + idleFan + skylineContact;

                vec3 voronoi = getVoronoiData(groundPosition / uVoronoiCellSize);
                float cellEdge = 1.0 - smoothstep(0.025, 0.18, voronoi.y);
                float cellInterior = smoothstep(0.08, 0.72, voronoi.x) * (1.0 - smoothstep(0.72, 1.12, voronoi.x));
                float facetAngle = voronoi.z * TWO_PI + sin(uTime * 0.12 + voronoi.z * 9.0) * 0.22;
                vec3 facetNormal = normalize(vec3(cos(facetAngle) * 0.30, 1.0, sin(facetAngle) * 0.30));
                vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
                vec3 lightDirection = normalize(vec3(0.34, 0.92, -0.20));
                vec3 halfDirection = normalize(viewDirection + lightDirection);
                float specular = pow(max(dot(facetNormal, halfDirection), 0.0), uVoronoiSpecularSharpness);
                float fresnel = pow(1.0 - saturate(dot(facetNormal, viewDirection)), 2.0);
                float movingGlint = 0.55 + 0.45 * sin(dot(groundPosition, vec2(0.035, -0.027)) - uTime * 0.32 + voronoi.z * 7.0);
                float cellVariation = 0.78 + voronoi.z * 0.30;
                float glassPattern = cellInterior * (0.30 + specular * 1.9 + fresnel * 0.42) + cellEdge * (0.22 + specular * 0.68);
                glassPattern *= cellVariation;
                glassPattern *= 0.72 + movingGlint * 0.28;

                float squareDistance = max(abs(groundPosition.x), abs(groundPosition.y));
                float groundEdgeMask = 1.0 - smoothstep(uGroundHalfSize - uVoronoiEdgeFade, uGroundHalfSize, squareDistance);
                float voronoiStrength = (uVoronoiIdleIntensity + uOverallEnergy * uVoronoiMusicBoost + bandEnergy * flowMask * 0.26) * groundEdgeMask;
                float voronoiIntensity = glassPattern * voronoiStrength;

                if (intensity + voronoiIntensity < 0.004) discard;

                vec3 whiteHot = vec3(1.0, 1.0, 0.92);
                vec3 silver = vec3(0.78, 0.86, 0.94);
                vec3 color = mix(bandColor * 0.28, bandColor, saturate(activeFan * 1.6 + uOverallEnergy * 0.28));
                color = mix(color, whiteHot, saturate(sourceGlow * 2.0 + bandEnergy * 0.05));
                vec3 voronoiColor = mix(silver, bandColor * 1.16, flowMask * saturate(0.20 + bandEnergy * 0.92));
                vec3 combinedColor = color * (0.82 + intensity * 0.9) + voronoiColor * voronoiIntensity;
                float combinedAlpha = saturate(intensity * 0.78 + voronoiIntensity * 0.92);
                gl_FragColor = vec4(combinedColor, combinedAlpha);
            }
        `,
        blending: THREE.NormalBlending,
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

    if (state.skylineLoading) return;

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
    if (!geometries.length) throw new Error('No mesh geometry found in skyscraper.obj');
    const mergedGeometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!mergedGeometry) throw new Error('Unable to merge skyscraper geometry');
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
            for (let index = 0; index < face.length; index++) {
                const a = face[index];
                const b = face[(index + 1) % face.length];
                const key = a < b ? `${a}/${b}` : `${b}/${a}`;
                if (!uniqueEdges.has(key)) {
                    uniqueEdges.add(key);
                    point.copy(vertices[a]); positions.push(point.x, point.y, point.z);
                    point.copy(vertices[b]); positions.push(point.x, point.y, point.z);
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

    const solidMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.3,
        metalness: 0.1,
        emissive: CONFIG.solidEmissiveColor
    });
    const wireframeMaterial = new LineMaterial({
        color: 0xffffff,
        linewidth: CONFIG.wireframeLineWidth,
        worldUnits: false,
        vertexColors: true,
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
    state.wireframeColors = wireframeData.colors;
    state.wireframeColorBuffer = wireframeData.colorBuffer;
    state.wireframeMaterial = wireframeMaterial;
    state.wireframeYFactors = wireframeData.yFactors;
    state.skylineModelHeight = geometry.boundingBox?.max.y ?? 0;

    solidInstances.name = 'AudioReactiveSkylineSolid';
    wireframeLines.name = 'AudioReactiveSkylineQuadWireframe';
    solidInstances.frustumCulled = false;
    wireframeLines.frustumCulled = false;
    solidInstances.renderOrder = 10;
    wireframeLines.renderOrder = 11;

    for (let index = 0; index < CONFIG.buildingCount; index++) {
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
    const colors = new Float32Array(sourceCount * CONFIG.buildingCount * 3);
    const yFactors = new Float32Array(sourceCount * CONFIG.buildingCount);
    const lineGeometry = new LineSegmentsGeometry();
    const line = new LineSegments2(lineGeometry, material);

    for (let buildingIndex = 0; buildingIndex < CONFIG.buildingCount; buildingIndex++) {
        const angle = getBuildingAngle(buildingIndex);
        const position = new THREE.Vector3(
            Math.sin(angle) * CONFIG.radius,
            0,
            Math.cos(angle) * CONFIG.radius
        );
        INSTANCE_ORIENTER.position.copy(position);
        INSTANCE_ORIENTER.lookAt(INSTANCE_CENTER);
        const colorOffset = buildingIndex * 3;
        const red = state.baseBuildingColors[colorOffset] * CONFIG.wireframeIdleBrightness;
        const green = state.baseBuildingColors[colorOffset + 1] * CONFIG.wireframeIdleBrightness;
        const blue = state.baseBuildingColors[colorOffset + 2] * CONFIG.wireframeIdleBrightness;

        for (let vertexIndex = 0; vertexIndex < sourceCount; vertexIndex++) {
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
            colors[targetOffset] = red;
            colors[targetOffset + 1] = green;
            colors[targetOffset + 2] = blue;
            yFactors[targetIndex] = localY;
        }
    }

    lineGeometry.setPositions(positions);
    lineGeometry.setColors(colors);
    return {
        lines: line,
        positions,
        lineBuffer: lineGeometry.attributes.instanceStart.data,
        colors,
        colorBuffer: lineGeometry.attributes.instanceColorStart.data,
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

// ==========================================================================
// EXPORT: getBandCenterFrequency
// ==========================================================================
export function getBandCenterFrequency(index) {
    const minFreq = CONFIG.minHz;
    const maxFreq = CONFIG.maxHz;
    const ratio = Math.pow(maxFreq / minFreq, 1 / (CONFIG.buildingCount - 1));
    return minFreq * Math.pow(ratio, index + 0.5);
}

export function getSkylineTargetPosition(normalizedValue, target = new THREE.Vector3()) {
    const sample = normalizedValueToSample(normalizedValue, state.buildings.length);
    if (!sample || !state.skylineModelHeight) return null;

    const lowerBuilding = state.buildings[sample.lowerIndex];
    const upperBuilding = state.buildings[sample.upperIndex];
    const lowerHeight = state.currentScales[sample.lowerIndex] * state.skylineModelHeight;
    const upperHeight = state.currentScales[sample.upperIndex] * state.skylineModelHeight;

    target.copy(lowerBuilding.position).lerp(upperBuilding.position, sample.mix);
    target.y = THREE.MathUtils.lerp(lowerHeight, upperHeight, sample.mix) + 4;
    return target;
}

// ==========================================================================
// EXPORT: computeFilterMultipliers (now used only for the red response line)
// ==========================================================================
export function computeFilterMultipliers() {
    const fp = window.__fourierCityLore?.filterState;
    const multipliers = new Float32Array(CONFIG.buildingCount).fill(1);
    if (!fp || !fp.type) return multipliers;   // no filter active

    const minFreq = 20;
    const maxFreq = 20000;
    const fc = Math.exp(Math.log(minFreq) + fp.cutoff * (Math.log(maxFreq) - Math.log(minFreq)));
    const Q = 0.1 + fp.resonance * 19.9;
    const gainDB = -18 + fp.gain * 36;
    const A = Math.pow(10, gainDB / 40);

    for (let i = 0; i < CONFIG.buildingCount; i++) {
        const f = getBandCenterFrequency(i);
        const w = f / fc;

        let mag = 1;
        switch (fp.type) {
            case 'lowpass':
                mag = 1 / Math.sqrt((1 - w * w) * (1 - w * w) + (w / Q) * (w / Q));
                break;
            case 'highpass':
                mag = (w * w) / Math.sqrt((1 - w * w) * (1 - w * w) + (w / Q) * (w / Q));
                break;
            case 'bandpass':
                mag = (w / Q) / Math.sqrt((1 - w * w) * (1 - w * w) + (w / Q) * (w / Q));
                break;
            case 'peaking':
                const num = (1 - w * w) * (1 - w * w) + (w * A / Q) * (w * A / Q);
                const den = (1 - w * w) * (1 - w * w) + (w / (A * Q)) * (w / (A * Q));
                mag = Math.sqrt(num / den);
                break;
            default:
                mag = 1;
        }
        multipliers[i] = Math.max(0, Math.min(mag, 10));
    }
    return multipliers;
}

// ==========================================================================
// MODIFIED: updateSkyline uses the unfiltered analyser energies only
// (the analyser already “sees” the effect of the active filter)
// ==========================================================================
function updateSkyline() {
    if (!state.buildings.length || !state.solidInstances || !state.wireframeLines) return;

    const now = performance.now();
    const minUpdateIntervalMs = 1000 / CONFIG.skylineUpdateFps;
    if (now - state.lastUpdateMs < minUpdateIntervalMs) return;

    const deltaSeconds = Math.min((now - state.lastUpdateMs) / 1000, 0.08);
    state.lastUpdateMs = now;

    const energies = readFrequencyBandEnergies();

    for (let index = 0; index < state.buildings.length; index++) {
        const building = state.buildings[index];
        const energy = energies[index] ?? 0;
        const targetScale = CONFIG.modelScale * (building.restHeight + energy * CONFIG.heightBoost);
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
    syncWireframeColors();
    updateGroundFlow(energies, deltaSeconds);
}

function updateGroundFlow(energies, deltaSeconds) {
    if (!state.groundFlowMaterial || !state.groundFlowEnergyTexture || !state.groundFlowEnergyData) return;

    const data = state.groundFlowEnergyData;
    let peakEnergy = 0;
    let summedEnergy = 0;

    for (let index = 0; index < CONFIG.buildingCount; index++) {
        const shapedEnergy = Math.pow(
            THREE.MathUtils.clamp(energies[index] ?? 0, 0, 1),
            CONFIG.groundFlowEnergyExponent
        );
        const offset = index * 4;
        const currentEnergy = data[offset + 3] / 255;
        const rate = shapedEnergy > currentEnergy ? CONFIG.groundFlowAttack : CONFIG.groundFlowDecay;
        const blend = 1 - Math.exp(-rate * deltaSeconds);
        const nextEnergy = THREE.MathUtils.lerp(currentEnergy, shapedEnergy, blend);
        data[offset + 3] = Math.round(nextEnergy * 255);
        peakEnergy = Math.max(peakEnergy, nextEnergy);
        summedEnergy += nextEnergy;
    }

    state.groundFlowEnergyTexture.needsUpdate = true;

    const averageEnergy = summedEnergy / CONFIG.buildingCount;
    const targetOverallEnergy = Math.min(
        peakEnergy * CONFIG.groundFlowPeakWeight + averageEnergy * CONFIG.groundFlowAverageWeight,
        1
    );
    const groundFlowRate = targetOverallEnergy > state.groundFlowOverallEnergy
        ? CONFIG.groundFlowAttack : CONFIG.groundFlowDecay;
    const blend = 1 - Math.exp(-groundFlowRate * deltaSeconds);
    state.groundFlowOverallEnergy = THREE.MathUtils.lerp(
        state.groundFlowOverallEnergy, targetOverallEnergy, blend
    );
    state.groundFlowMaterial.uniforms.uTime.value = performance.now() / 1000;
    state.groundFlowMaterial.uniforms.uOverallEnergy.value = state.groundFlowOverallEnergy;
}

function syncWireframeResolution() {
    const material = state.wireframeMaterial;
    if (!material?.resolution) return;
    const pixelRatio = window.devicePixelRatio || 1;
    material.resolution.set(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio);
}

function syncWireframePositions() {
    const positions = state.wireframePositions;
    const lineBuffer = state.wireframeLineBuffer;
    const yFactors = state.wireframeYFactors;
    if (!positions || !lineBuffer || !yFactors) return;
    const verticesPerBuilding = yFactors.length / CONFIG.buildingCount;
    for (let index = 0; index < yFactors.length; index++) {
        const buildingIndex = Math.floor(index / verticesPerBuilding);
        positions[index * 3 + 1] = yFactors[index] * state.currentScales[buildingIndex];
    }
    lineBuffer.needsUpdate = true;
}

function syncWireframeColors() {
    const colors = state.wireframeColors;
    const colorBuffer = state.wireframeColorBuffer;
    const yFactors = state.wireframeYFactors;
    if (!colors || !colorBuffer || !yFactors) return;
    const verticesPerBuilding = yFactors.length / CONFIG.buildingCount;
    for (let index = 0; index < yFactors.length; index++) {
        const buildingIndex = Math.floor(index / verticesPerBuilding);
        const building = state.buildings[buildingIndex];
        const buildingColorOffset = buildingIndex * 3;
        const colorOffset = index * 3;
        const visualEnergy = THREE.MathUtils.clamp(
            (state.currentScales[buildingIndex] / CONFIG.modelScale - building.restHeight) / CONFIG.heightBoost,
            0, 1
        );
        const brightness = CONFIG.wireframeIdleBrightness + CONFIG.wireframeEnergyBrightness * visualEnergy;
        colors[colorOffset] = state.baseBuildingColors[buildingColorOffset] * brightness;
        colors[colorOffset + 1] = state.baseBuildingColors[buildingColorOffset + 1] * brightness;
        colors[colorOffset + 2] = state.baseBuildingColors[buildingColorOffset + 2] * brightness;
    }
    colorBuffer.needsUpdate = true;
}

function buildBaseBuildingColors() {
    const color = new THREE.Color();
    for (let index = 0; index < CONFIG.buildingCount; index++) {
        const ratio = CONFIG.buildingCount > 1 ? index / (CONFIG.buildingCount - 1) : 0;
        const frequency = CONFIG.minHz * ((CONFIG.maxHz / CONFIG.minHz) ** ratio);
        const offset = index * 3;
        sampleSpectrumColor(frequency, color);
        state.baseBuildingColors[offset] = color.r;
        state.baseBuildingColors[offset + 1] = color.g;
        state.baseBuildingColors[offset + 2] = color.b;
    }
}

function sampleSpectrumColor(frequency, target) {
    const clampedFrequency = THREE.MathUtils.clamp(
        frequency,
        SPECTRUM_COLOR_ANCHORS[0].frequency,
        SPECTRUM_COLOR_ANCHORS[SPECTRUM_COLOR_ANCHORS.length - 1].frequency
    );
    for (let index = 1; index < SPECTRUM_COLOR_ANCHORS.length; index++) {
        const lower = SPECTRUM_COLOR_ANCHORS[index - 1];
        const upper = SPECTRUM_COLOR_ANCHORS[index];
        if (clampedFrequency <= upper.frequency) {
            const lowerLog = Math.log(lower.frequency);
            const upperLog = Math.log(upper.frequency);
            const ratio = (Math.log(clampedFrequency) - lowerLog) / (upperLog - lowerLog);
            return target.copy(lower.color).lerp(upper.color, ratio);
        }
    }
    return target.copy(SPECTRUM_COLOR_ANCHORS[SPECTRUM_COLOR_ANCHORS.length - 1].color);
}

function initializeGroundFlowSpectrumData() {
    const data = state.groundFlowEnergyData;
    for (let index = 0; index < CONFIG.buildingCount; index++) {
        const colorOffset = index * 3;
        const dataOffset = index * 4;
        data[dataOffset] = Math.round(state.baseBuildingColors[colorOffset] * 255);
        data[dataOffset + 1] = Math.round(state.baseBuildingColors[colorOffset + 1] * 255);
        data[dataOffset + 2] = Math.round(state.baseBuildingColors[colorOffset + 2] * 255);
        data[dataOffset + 3] = 0;
    }
}

function readFrequencyBandEnergies() {
    if (!state.analyser || !state.currentAudio || !state.currentAudio.isPlaying || !state.frequencyBands || !state.frequencyDbData) {
        state.rawBandDecibels.fill(CONFIG.analyserMinDecibels);
        state.bandEnergies.fill(0);
        return state.bandEnergies;
    }
    state.analyser.analyser.getFloatFrequencyData(state.frequencyDbData);
    for (let bandIndex = 0; bandIndex < state.frequencyBands.length; bandIndex++) {
        const band = state.frequencyBands[bandIndex];
        let decibelSum = 0;
        for (let index = band.startBin; index <= band.endBin; index++) {
            decibelSum += state.frequencyDbData[index];
        }
        const averageDecibels = Math.max(decibelSum / band.binCount, CONFIG.analyserMinDecibels);
        const rawEnergy = THREE.MathUtils.clamp(
            (averageDecibels - CONFIG.analyserMinDecibels) / (CONFIG.analyserMaxDecibels - CONFIG.analyserMinDecibels),
            0, 1
        );
        state.rawBandDecibels[bandIndex] = averageDecibels;
        state.bandEnergies[bandIndex] = Math.pow(rawEnergy, CONFIG.visualEnergyExponent);
    }
    return state.bandEnergies;
}

function buildLogFrequencyBands(sampleRate, fftSize, frequencyBinCount, bandCount) {
    const breakpoints = [20, 40, 80, 160, 300, 600, 1200, 2400, 5000, 10000, 20000];
    const numRanges = breakpoints.length - 1;
    const nyquist = sampleRate / 2;
    const hzPerBin = sampleRate / fftSize;
    const clampedBreakpoints = breakpoints.map(f => Math.min(f, nyquist));
    const buildingsPerRange = new Array(numRanges).fill(0);
    let remaining = bandCount;
    for (let i = 0; i < numRanges; i++) {
        const lowLog = Math.log(clampedBreakpoints[i]);
        const highLog = Math.log(clampedBreakpoints[i + 1]);
        const weight = highLog - lowLog;
        buildingsPerRange[i] = Math.max(1, Math.round(weight * bandCount / (Math.log(nyquist) - Math.log(20))));
        remaining -= buildingsPerRange[i];
    }
    for (let i = 0; i < remaining; i++) buildingsPerRange[i % numRanges]++;

    const bands = [];
    let buildingIdx = 0;
    for (let range = 0; range < numRanges; range++) {
        const lowHz = clampedBreakpoints[range];
        const highHz = clampedBreakpoints[range + 1];
        const countInRange = buildingsPerRange[range];
        for (let sub = 0; sub < countInRange; sub++) {
            const t = sub / countInRange;
            const logLow = Math.log(lowHz);
            const logHigh = Math.log(highHz);
            const bandFreq = Math.exp(logLow + t * (logHigh - logLow));
            const startBin = Math.max(1, Math.floor(bandFreq / hzPerBin));
            let endBin;
            if (sub === countInRange - 1) {
                endBin = Math.min(frequencyBinCount - 1, Math.ceil(highHz / hzPerBin) - 1);
            } else {
                const nextT = (sub + 1) / countInRange;
                const nextBandFreq = Math.exp(logLow + nextT * (logHigh - logLow));
                endBin = Math.max(startBin, Math.floor(nextBandFreq / hzPerBin) - 1);
            }
            endBin = Math.min(endBin, frequencyBinCount - 1);
            bands[buildingIdx++] = { startBin, endBin, binCount: endBin - startBin + 1 };
        }
    }
    while (bands.length < bandCount) {
        bands.push({ startBin: 1, endBin: 1, binCount: 1 });
    }
    return bands.slice(0, bandCount);
}

export { CONFIG };

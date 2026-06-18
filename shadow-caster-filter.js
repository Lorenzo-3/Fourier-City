import * as THREE from 'three';

export function restrictShadowCastingToLight(object, light) {
  const allowedShadowCamera = light.shadow.camera;

  object.traverse((child) => {
    if (!child.isMesh) return;

    child.customDepthMaterial = new THREE.MeshDepthMaterial();
    const originalOnBeforeShadow = child.onBeforeShadow;

    child.onBeforeShadow = function onBeforeShadow(...args) {
      originalOnBeforeShadow.call(this, ...args);

      const shadowCamera = args[3];
      const depthMaterial = args[5];
      const writesToThisShadowMap = shadowCamera === allowedShadowCamera;
      depthMaterial.colorWrite = writesToThisShadowMap;
      depthMaterial.depthWrite = writesToThisShadowMap;
    };
  });
}

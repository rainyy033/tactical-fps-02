// The four first-person view models (pistol, SMG, rifle, sniper), each a handful of boxes hung off
// the camera, plus a shared muzzle flash and its point light. The module owns only the visuals and
// their kick/reload animation; the weapon numbers live in config.js and the combat in game.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createViewModels(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.85, metalness: 0.05 });

  function part(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  }
  function barrel(parent, radius, length, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), metal);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  const models = {};
  const muzzles = {};

  function register(id, muzzle, build) {
    const model = new THREE.Group();
    build(model);
    model.position.set(0.26, -0.2, -0.42);
    camera.add(model);
    model.visible = false;
    models[id] = model;
    muzzles[id] = muzzle;
  }

  // Pistol: a compact sidearm.
  register('pistol', new THREE.Vector3(0, 0.02, -0.32), (m) => {
    part(m, dark, 0.06, 0.09, 0.22, 0, 0, 0);
    part(m, metal, 0.05, 0.05, 0.18, 0, 0.015, -0.18);
    part(m, grip, 0.06, 0.15, 0.09, 0, -0.11, 0.02, 0.18);
  });

  // SMG: a compact automatic with a forward grip.
  register('smg', new THREE.Vector3(0, 0.0, -0.46), (m) => {
    part(m, dark, 0.07, 0.1, 0.36, 0, 0, 0);
    part(m, metal, 0.04, 0.04, 0.26, 0, 0.02, -0.3);
    part(m, grip, 0.05, 0.17, 0.08, 0, -0.15, -0.02, 0.12);
    part(m, grip, 0.06, 0.07, 0.18, 0, -0.01, 0.26);
  });

  // Rifle: a mid-length automatic.
  register('rifle', new THREE.Vector3(0, 0.02, -0.78), (m) => {
    part(m, dark, 0.08, 0.11, 0.5, 0, 0, 0);
    barrel(m, 0.022, 0.5, 0, 0.03, -0.5);
    part(m, grip, 0.06, 0.16, 0.09, 0, -0.16, -0.02, 0.1);
    part(m, metal, 0.06, 0.06, 0.3, 0, 0.02, -0.24);
    part(m, grip, 0.07, 0.09, 0.24, 0, -0.01, 0.36);
  });

  // Sniper: a long rifle with a scope.
  register('sniper', new THREE.Vector3(0, 0.03, -1.05), (m) => {
    part(m, dark, 0.08, 0.1, 0.62, 0, 0, 0);
    barrel(m, 0.024, 0.72, 0, 0.03, -0.68);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), metal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.05);
    m.add(scope);
    part(m, grip, 0.07, 0.1, 0.32, 0, -0.02, 0.46);
    part(m, metal, 0.04, 0.05, 0.12, 0.06, 0, -0.08);
  });

  // Muzzle flash: a flickering plane and a bright point light, moved to the active muzzle.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  camera.add(flashLight);

  let current = null;

  function setWeapon(id) {
    current = models[id] ? id : 'pistol';
    for (const key of Object.keys(models)) models[key].visible = key === current;
    positionMuzzle();
  }

  function positionMuzzle() {
    const model = models[current];
    const muzzle = muzzles[current];
    // Muzzle sits at the model's local origin offset, transformed into camera space.
    flash.position.copy(model.position).add(muzzle);
    flashLight.position.copy(model.position).add(muzzle.clone().multiplyScalar(0.4));
  }

  function step(dt, state) {
    if (!current) return;
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[current];
    model.position.z = -0.42 + state.kick * 0.06;
    model.rotation.x = state.kick * 2.0;
    if (state.reloadLeft > 0) {
      const progress = 1 - state.reloadLeft / 1.9;
      model.rotation.x = -0.6 * Math.sin(Math.min(1, progress) * Math.PI);
    }
    flash.visible = state.flash > 0;
    flash.rotation.z += dt * 40;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    positionMuzzle();
  }

  return { setWeapon, step, muzzleOffset: (id) => muzzles[id] };
}

// The map: an original three-lane arena — a mid corridor and two side sites (HELIOS west, NOVA
// east) — built from plain boxes. Every box is a collider for movement and a surface bullets and
// sight stop on. The file also lays out the waypoint graph the bots navigate and the spawn rows.
// Plain geometry only: no models, no textures, no network.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { NAMES } from './config.js';

const WALL_H = 4.6;

// The navigation graph. Each waypoint is { x, z, n: [indices of neighbours] }. Three vertical
// lanes (west x=-13, mid x=0, east x=13) chain from the friendly row (z=+15) to the enemy row
// (z=-15), and the two sites join mid through a central cross corridor at z=0. Cover is placed
// off these straight segments so a bot walking waypoint to waypoint never collides with furniture.
//
//   west: 0 -> 1 -> 2 -> 3 -> 4         (2 is the HELIOS site)
//   mid:  5 -> 6 -> 7 -> 8 -> 9         (7 is the central cross)
//   east: 13 -> 11 -> 10 -> 12 -> 14    (10 is the NOVA site)
//   cross: 2 <-> 7 <-> 10
const WAYPOINTS = [
  { x: -13, z: 15, n: [1] },       // 0  W0 west-friendly
  { x: -13, z: 7, n: [0, 2] },     // 1  W1
  { x: -13, z: 0, n: [1, 3, 7] },  // 2  W2 west site (HELIOS)
  { x: -13, z: -7, n: [2, 4] },    // 3  W3
  { x: -13, z: -15, n: [3] },      // 4  W4 west-enemy
  { x: 0, z: 15, n: [6] },         // 5  M0 mid-friendly
  { x: 0, z: 7, n: [5, 7] },       // 6  M1
  { x: 0, z: 0, n: [6, 8, 2, 10] }, // 7  MC mid cross
  { x: 0, z: -7, n: [7, 9] },      // 8  M2
  { x: 0, z: -15, n: [8] },        // 9  M3 mid-enemy
  { x: 13, z: 0, n: [11, 12, 7] }, // 10 E2 east site (NOVA)
  { x: 13, z: 7, n: [13, 10] },    // 11 E1
  { x: 13, z: -7, n: [10, 14] },   // 12 E3
  { x: 13, z: 15, n: [11] },       // 13 E0 east-friendly
  { x: 13, z: -15, n: [12] },      // 14 E4 east-enemy
];

const SPAWNS = {
  friendly: [
    new THREE.Vector3(0, 0, 15),
    new THREE.Vector3(-13, 0, 15),
    new THREE.Vector3(13, 0, 15),
    new THREE.Vector3(-3, 0, 14),
    new THREE.Vector3(3, 0, 14),
  ],
  enemy: [
    new THREE.Vector3(0, 0, -15),
    new THREE.Vector3(-13, 0, -15),
    new THREE.Vector3(13, 0, -15),
    new THREE.Vector3(-3, 0, -14),
    new THREE.Vector3(3, 0, -14),
  ],
};

// A floor "ring" plus a floating site name, drawn with a canvas texture so the sites are named in
// the world itself (own names, no network or font files).
function makeTextSprite(text, color, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 88px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(5 * scale, 2.5 * scale, 1);
  return sprite;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.96, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.9, metalness: 0.04 }),
    cover: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.82, metalness: 0.06 }),
    trim: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.6, metalness: 0.1 }),
  };

  const colliders = [];
  const shootables = [];

  function place(mesh, opts = {}) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.noCollide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (!opts.noShoot) shootables.push(mesh);
    return mesh;
  }

  function box(width, height, depth, x, y, z, mat = 'wall', opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[mat]);
    mesh.position.set(x, y, z);
    return place(mesh, opts);
  }

  // A 40 x 40 m floor, open to the sky.
  box(40, 0.4, 40, 0, -0.2, 0, 'floor');

  // Outer walls.
  box(40, WALL_H, 0.4, 0, WALL_H / 2, 20);
  box(40, WALL_H, 0.4, 0, WALL_H / 2, -20);
  box(0.4, WALL_H, 40, -20, WALL_H / 2, 0);
  box(0.4, WALL_H, 40, 20, WALL_H / 2, 0);

  // The two mid walls carve the three lanes; a 6 m doorway in each (z in -3..3) joins the lanes.
  box(0.4, WALL_H, 17, -6, WALL_H / 2, 11.5);
  box(0.4, WALL_H, 17, -6, WALL_H / 2, -11.5);
  box(0.4, WALL_H, 17, 6, WALL_H / 2, 11.5);
  box(0.4, WALL_H, 17, 6, WALL_H / 2, -11.5);

  // Mid lane cover: pillars and crates framing the x=0 corridor, never on it.
  const midCover = [
    [-3, 8], [3, 8], [-3, -8], [3, -8],
    [-3.5, 5], [3.5, 5], [-3.5, -5], [3.5, -5],
    [-2.5, 11], [2.5, 11], [-2.5, -11], [2.5, -11],
  ];
  midCover.forEach(([x, z], i) => {
    const tall = i < 4;
    box(tall ? 1.2 : 1.4, tall ? 3.2 : 1.1, tall ? 1.2 : 1.4, x, tall ? 1.6 : 0.55, z, 'cover');
  });

  // West site (HELIOS) cover, off x=-13 and z=0.
  const westCover = [
    [-15, 6], [-11, 6], [-15, -6], [-11, -6],
    [-16, 10], [-10, 10], [-16, -10], [-10, -10],
    [-8, 6], [-8, -6],
  ];
  westCover.forEach(([x, z], i) => {
    const pillar = i >= 8;
    box(pillar ? 1.0 : 1.5, pillar ? 2.6 : 1.1, pillar ? 1.0 : 1.5, x, pillar ? 1.3 : 0.55, z, 'cover');
  });

  // East site (NOVA) cover, mirror of west.
  const eastCover = [
    [15, 6], [11, 6], [15, -6], [11, -6],
    [16, 10], [10, 10], [16, -10], [10, -10],
    [8, 6], [8, -6],
  ];
  eastCover.forEach(([x, z], i) => {
    const pillar = i >= 8;
    box(pillar ? 1.0 : 1.5, pillar ? 2.6 : 1.1, pillar ? 1.0 : 1.5, x, pillar ? 1.3 : 0.55, z, 'cover');
  });

  // Near-spawn cover on both rows.
  box(1.6, 1.1, 1.6, -3, 0.55, 13, 'cover');
  box(1.6, 1.1, 1.6, 3, 0.55, 13, 'cover');
  box(1.6, 1.1, 1.6, -3, 0.55, -13, 'cover');
  box(1.6, 1.1, 1.6, 3, 0.55, -13, 'cover');

  // Site markers: a ring on the floor and a floating name, purely visual (no collision, no hit).
  function siteMarker(x, z, name) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.09, 8, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.site), transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    place(ring, { noCollide: true, noShoot: true });

    const sprite = makeTextSprite(name, PALETTE.site, 1.0);
    sprite.position.set(x, 2.4, z);
    place(sprite, { noCollide: true, noShoot: true });
  }
  siteMarker(-13, 0, NAMES.siteA);
  siteMarker(13, 0, NAMES.siteB);

  // Light: a warm key with shadows, a cool fill, an ambient sky, and a soft accent at each site.
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.15));

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.0);
  key.position.set(14, 30, 18);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.55);
  fill.position.set(-10, 12, -14);
  scene.add(fill);

  const siteA = new THREE.PointLight(new THREE.Color(PALETTE.site), 14, 16, 1.6);
  siteA.position.set(-13, 2.6, 0);
  scene.add(siteA);
  const siteB = new THREE.PointLight(new THREE.Color(PALETTE.site), 14, 16, 1.6);
  siteB.position.set(13, 2.6, 0);
  scene.add(siteB);

  return {
    colliders,
    shootables,
    group,
    waypoints: WAYPOINTS.map((w) => ({ x: w.x, z: w.z, n: w.n })),
    spawns: SPAWNS,
    sites: [
      { name: NAMES.siteA, x: -13, z: 0 },
      { name: NAMES.siteB, x: 13, z: 0 },
    ],
  };
}

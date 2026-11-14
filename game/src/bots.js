// The bots: nine simple humanoids (four friendly, five enemy) that navigate the waypoint graph,
// acquire a target when they can see it, and shoot with imperfect accuracy. Each bot owns its own
// money and weapon, and buys every round. Movement is the same box-against-colliders resolution
// the player uses, minus jump and crouch, so a bot never walks through a wall.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { NAMES, WEAPONS, WEAPON_ORDER, ROUND, ECONOMY, clamp, lerp } from './config.js';

const SIGHT_RANGE = 42;
const FOV_DOT = 0.36; // cos of a generous ~110 degree view cone
const STUCK_TIME = 0.9;

export function createBots(scene, world, player, ctx) {
  const bots = [];
  const random = ctx.random;
  const raycaster = new THREE.Raycaster();
  const probe = new THREE.Box3();
  const forward = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const targetEye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const wish = new THREE.Vector3();

  const teamMaterials = {
    friendly: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.friendly), roughness: 0.5, metalness: 0.12 }),
    enemy: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.12 }),
  };
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.72, metalness: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8, metalness: 0 });

  function buildModel(team) {
    const root = new THREE.Group();
    const teamMat = teamMaterials[team];

    const legs = new THREE.Group();
    legs.position.y = 0.48;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.18), dark);
    legL.position.set(-0.12, -0.24, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.18), dark);
    legR.position.set(0.12, -0.24, 0);
    legs.add(legL, legR);
    root.add(legs);

    const upper = new THREE.Group();
    upper.position.y = 0.98;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), teamMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    head.position.y = 0.44;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), teamMat);
    helmet.position.y = 0.47;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.34), dark);
    gun.position.set(0.28, 0.06, -0.28);
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    flash.position.set(0.28, 0.06, -0.5);
    flash.visible = false;
    upper.add(torso, head, helmet, gun, flash);
    root.add(upper);

    root.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(root);
    return { root, upper, legs, legL, legR, flash };
  }

  function makeBot(team, name, spawn, index) {
    const weapon = WEAPONS.pistol;
    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      isPlayer: false,
      spawn: spawn.clone(),
      position: spawn.clone(),
      velocity: new THREE.Vector3(),
      yaw: team === 'friendly' ? 0 : Math.PI,
      eye: ROUND.eyeHeight,
      height: ROUND.bodyHeight,
      radius: ROUND.bodyRadius,
      health: ROUND.maxHealth,
      alive: true,
      weapon: 'pistol',
      mag: weapon.mag,
      reserve: weapon.reserve,
      cooldown: 0,
      reloadLeft: 0,
      flashTimer: 0,
      money: ECONOMY.start,
      skill: 0.45 + random() * 0.55,
      // AI
      path: [],
      pathIndex: 0,
      goal: new THREE.Vector3(),
      target: null,
      aimYaw: team === 'friendly' ? 0 : Math.PI,
      aimPitch: 0,
      reaction: 0,
      burst: 0,
      strafeDir: random() < 0.5 ? -1 : 1,
      strafeTimer: 0,
      stuck: 0,
      walkPhase: random() * Math.PI * 2,
    };
    bot.model = buildModel(team);
    bot.model.root.position.copy(spawn);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < NAMES.friendlyBots.length; i += 1) {
    makeBot('friendly', NAMES.friendlyBots[i], world.spawns.friendly[i + 1], i);
  }
  for (let i = 0; i < NAMES.enemyBots.length; i += 1) {
    makeBot('enemy', NAMES.enemyBots[i], world.spawns.enemy[i], i);
  }

  const waypoints = world.waypoints.map((w) => new THREE.Vector3(w.x, 0, w.z));
  const neighbours = world.waypoints.map((w) => w.n);

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - ROUND.bodyRadius, y + lift, z - ROUND.bodyRadius);
    probe.max.set(x + ROUND.bodyRadius, y + height - lift, z + ROUND.bodyRadius);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function eyeOf(combatant, out) {
    return out.set(combatant.position.x, combatant.position.y + combatant.eye, combatant.position.z);
  }

  function hasLOS(from, to) {
    raycaster.set(from, dir.copy(to).sub(from).normalize());
    raycaster.far = from.distanceTo(to) - 0.15;
    const hits = raycaster.intersectObjects(world.shootables, false);
    return hits.length === 0;
  }

  function enemiesOf(bot) {
    if (bot.team === 'enemy') {
      return [player].concat(bots.filter((b) => b.team === 'friendly'));
    }
    return bots.filter((b) => b.team === 'enemy');
  }

  function nearestWaypoint(position) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const d = waypoints[i].distanceToSquared(position);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Breadth-first path from the nearest waypoint to a random enemy-side waypoint.
  function planPath(bot) {
    const start = nearestWaypoint(bot.position);
    const goalCandidates = bot.team === 'friendly' ? [4, 9, 14] : [0, 5, 13];
    const goal = goalCandidates[Math.floor(random() * goalCandidates.length)];
    const prev = new Array(waypoints.length).fill(-1);
    const queue = [start];
    const seen = new Array(waypoints.length).fill(false);
    seen[start] = true;
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of neighbours[current]) {
        if (!seen[next]) {
          seen[next] = true;
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    const path = [];
    let node = prev[goal] === -1 && goal !== start ? start : goal;
    if (prev[goal] === -1 && goal !== start) node = start;
    while (node !== -1) {
      path.unshift(node);
      node = prev[node];
    }
    bot.path = path;
    bot.pathIndex = 0;
  }

  function acquire(bot) {
    let best = null;
    let bestDist = Infinity;
    eyeOf(bot, origin);
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    for (const enemy of enemiesOf(bot)) {
      if (!enemy.alive) continue;
      eyeOf(enemy, targetEye);
      const dist = origin.distanceTo(targetEye);
      if (dist > SIGHT_RANGE) continue;
      toTarget.copy(targetEye).sub(origin).normalize();
      if (forward.dot(toTarget) < FOV_DOT) continue;
      if (!hasLOS(origin, targetEye)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    return best;
  }

  function aimAt(bot, target, dt) {
    eyeOf(bot, origin);
    eyeOf(target, targetEye);
    toTarget.copy(targetEye).sub(origin);
    const dist = Math.max(0.01, toTarget.length());
    const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
    const desiredPitch = Math.asin(clamp(toTarget.y / dist, -1, 1));
    const turn = lerp(6, 14, bot.skill) * dt;
    bot.aimYaw = angleLerp(bot.aimYaw, desiredYaw, turn);
    bot.aimPitch = clamp(lerp(bot.aimPitch, desiredPitch, turn), -1.2, 1.2);
  }

  function angleLerp(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }

  function shotDir(bot, target) {
    eyeOf(bot, origin);
    eyeOf(target, targetEye);
    dir.copy(targetEye).sub(origin).normalize();
    const weapon = WEAPONS[bot.weapon];
    const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    const move = clamp(speed / weapon.moveRef, 0, 1);
    let spread = weapon.spreadStill + move * (weapon.spreadMoving - weapon.spreadStill);
    spread += (1 - bot.skill) * 0.02;
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    return dir;
  }

  function moveBody(bot, dt) {
    const speed = 4.2;
    const blend = Math.min(1, 34 * dt / speed);
    bot.velocity.x += (wish.x * speed - bot.velocity.x) * blend;
    bot.velocity.z += (wish.z * speed - bot.velocity.z) * blend;
    bot.velocity.y -= 20 * dt;
    let blocked = false;
    const nextX = bot.position.x + bot.velocity.x * dt;
    if (!overlaps(nextX, bot.position.y, bot.position.z, bot.height, 0.04)) bot.position.x = nextX;
    else { bot.velocity.x = 0; blocked = true; }
    const nextZ = bot.position.z + bot.velocity.z * dt;
    if (!overlaps(bot.position.x, bot.position.y, nextZ, bot.height, 0.04)) bot.position.z = nextZ;
    else { bot.velocity.z = 0; blocked = true; }
    if (blocked) bot.stuck += dt;
    else bot.stuck = Math.max(0, bot.stuck - dt);
    bot.position.y += bot.velocity.y * dt;
    const hit = overlaps(bot.position.x, bot.position.y, bot.position.z, bot.height, 0);
    if (hit && bot.velocity.y <= 0) {
      bot.position.y = hit.max.y;
      bot.velocity.y = 0;
    } else if (hit) {
      bot.position.y = hit.min.y - bot.height;
      bot.velocity.y = 0;
    }
    if (bot.position.y < 0) {
      bot.position.y = 0;
      bot.velocity.y = 0;
    }
  }

  function navigate(bot, dt) {
    if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) planPath(bot);
    if (bot.path.length === 0) {
      wish.set(0, 0, 0);
      return;
    }
    const wp = waypoints[bot.path[bot.pathIndex]];
    const dx = wp.x - bot.position.x;
    const dz = wp.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      bot.pathIndex += 1;
      bot.stuck = 0;
    } else if (bot.stuck > STUCK_TIME) {
      planPath(bot);
      bot.stuck = 0;
    } else {
      wish.set(dx / dist, 0, dz / dist);
      bot.yaw = angleLerp(bot.yaw, Math.atan2(-wish.x, -wish.z), dt * 6);
    }
  }

  function engage(bot, target, dt) {
    eyeOf(bot, origin);
    eyeOf(target, targetEye);
    const dist = origin.distanceTo(targetEye);
    if (dist > 20) {
      // Close distance to stay in an effective range.
      toTarget.copy(targetEye).sub(origin);
      toTarget.y = 0;
      toTarget.normalize();
      wish.copy(toTarget);
    } else {
      // Stand still and shoot: accuracy over movement.
      wish.set(0, 0, 0);
    }
    aimAt(bot, target, dt);
    bot.yaw = bot.aimYaw;

    const weapon = WEAPONS[bot.weapon];
    bot.reaction = Math.max(0, bot.reaction - dt);
    if (bot.reaction === 0 && bot.cooldown === 0 && bot.mag > 0 && bot.reloadLeft === 0) {
      eyeOf(bot, origin);
      ctx.fire(bot, origin, shotDir(bot, target));
      bot.mag -= 1;
      bot.cooldown = weapon.fireGap;
      bot.flashTimer = 0.06;
      bot.burst -= 1;
      if (bot.burst <= 0) {
        bot.burst = Math.max(1, Math.round((weapon.auto ? 5 : 1) * bot.skill) + 1);
        bot.reaction = 0.18 + (1 - bot.skill) * 0.5;
      }
      if (bot.mag === 0 && bot.reserve > 0) startReload(bot);
    }
    if (bot.mag === 0 && bot.reserve > 0 && bot.reloadLeft === 0) startReload(bot);
  }

  function startReload(bot) {
    const weapon = WEAPONS[bot.weapon];
    bot.reloadLeft = weapon.reload;
  }

  function finishReload(bot, dt) {
    if (bot.reloadLeft > 0) {
      bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      if (bot.reloadLeft === 0) {
        const weapon = WEAPONS[bot.weapon];
        const need = weapon.mag - bot.mag;
        const take = Math.min(need, bot.reserve);
        bot.mag += take;
        bot.reserve -= take;
      }
    }
  }

  function syncModel(bot) {
    const model = bot.model;
    if (!bot.alive) {
      model.root.rotation.x = lerp(model.root.rotation.x, -1.5, 0.18);
      model.root.position.y = lerp(model.root.position.y, 0.06, 0.2);
      return;
    }
    model.root.position.x = bot.position.x;
    model.root.position.z = bot.position.z;
    model.root.rotation.x = 0;
    model.root.rotation.y = bot.yaw;
    model.upper.rotation.x = bot.aimPitch;
    const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    if (speed > 0.4) bot.walkPhase += speed * 3.2 * (1 / 60);
    const swing = Math.sin(bot.walkPhase) * Math.min(0.9, speed * 0.2);
    model.legL.rotation.x = swing;
    model.legR.rotation.x = -swing;
    model.flash.visible = bot.flashTimer > 0;
  }

  function update(dt) {
    for (const bot of bots) {
      if (!bot.alive) {
        syncModel(bot);
        continue;
      }
      bot.cooldown = Math.max(0, bot.cooldown - dt);
      bot.flashTimer = Math.max(0, bot.flashTimer - dt);
      finishReload(bot, dt);

      const target = acquire(bot);
      if (target) {
        if (bot.target !== target) bot.reaction = 0.15 + (1 - bot.skill) * 0.35;
        bot.target = target;
        engage(bot, target, dt);
      } else {
        bot.target = null;
        navigate(bot, dt);
      }
      moveBody(bot, dt);
      syncModel(bot);
    }
  }

  function refill(bot) {
    const weapon = WEAPONS[bot.weapon];
    bot.mag = weapon.mag;
    bot.reserve = weapon.reserve;
    bot.cooldown = 0;
    bot.reloadLeft = 0;
  }

  function equip(bot, id) {
    bot.weapon = id;
    const weapon = WEAPONS[id];
    bot.mag = weapon.mag;
    bot.reserve = weapon.reserve;
    bot.cooldown = 0;
    bot.reloadLeft = 0;
  }

  // Every bot buys once per round: refill ammo, then upgrade to the best weapon it can afford.
  function buy() {
    for (const bot of bots) {
      refill(bot);
      let best = bot.weapon;
      let bestCost = WEAPONS[bot.weapon].cost;
      for (const id of WEAPON_ORDER) {
        const weapon = WEAPONS[id];
        if (weapon.cost <= bot.money && weapon.cost > bestCost) {
          best = id;
          bestCost = weapon.cost;
        }
      }
      if (best !== bot.weapon) {
        bot.money -= WEAPONS[best].cost;
        equip(bot, best);
      }
    }
  }

  function resetRound() {
    for (const bot of bots) {
      bot.position.copy(bot.spawn);
      bot.velocity.set(0, 0, 0);
      bot.yaw = bot.team === 'friendly' ? 0 : Math.PI;
      bot.aimYaw = bot.yaw;
      bot.aimPitch = 0;
      bot.health = ROUND.maxHealth;
      bot.alive = true;
      bot.target = null;
      bot.reaction = 0;
      bot.burst = 0;
      bot.stuck = 0;
      bot.path = [];
      bot.pathIndex = 0;
      refill(bot);
      syncModel(bot);
    }
  }

  return { list: bots, update, buy, resetRound, refill, equip };
}

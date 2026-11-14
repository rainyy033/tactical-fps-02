// The round-based tactical game itself: the buy/combat state machine, the economy, the kill feed,
// and box-based hitscan combat shared by the player and every bot. The player and bots are treated
// as one uniform list of "combatants" (a position plus an eye, height and radius), so a shot is a
// single ray traced against the world's walls and every living combatant's box.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, ROUND, ECONOMY, NAMES, clamp } from './config.js';
import { PALETTE } from './palette.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createViewModels } from './weapons.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';

export function createGame({ scene, camera, canvas, world, random }) {
  const hud = createHud();
  const audio = createAudio();
  const player = createPlayer(world.colliders, world.spawns.friendly[0]);
  const viewmodels = createViewModels(camera);

  const raycaster = new THREE.Raycaster();
  const ray = new THREE.Ray();
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const dirVec = new THREE.Vector3();
  const cameraPos = new THREE.Vector3();

  const impacts = createImpacts(scene);

  let bots;
  function botFire(bot, origin, dir) {
    const weapon = WEAPONS[bot.weapon];
    audio.gunshot(bot.weapon, { distant: true });
    const result = resolveShot(bot, origin, dir, weapon);
    const outcome = applyHit(bot, result, weapon);
    if (outcome.point) impacts.spawn(outcome.point);
  }
  bots = createBots(scene, world, player, { fire: botFire, random });
  const combatants = [player].concat(bots.list);

  const input = createInput(canvas, onLockChange);

  // ---------------------------------------------------------------- game state
  let phase = 'menu'; // menu | buy | combat | roundEnd
  let overlayMode = 'menu';
  let round = 0;
  let buyTime = 0;
  let roundTime = 0;
  let prevFiring = false;
  const scores = { friendly: 0, enemy: 0 };

  viewmodels.setWeapon('pistol');
  hud.setHealth(player.health, ROUND.maxHealth);
  hud.setMoney(player.money);
  hud.setAmmo(player.mag, player.reserve, player.weapon);
  hud.setRound(1, 0, 0);
  hud.setAlive(aliveCount('friendly'), aliveCount('enemy'));
  showMenu();

  // ---------------------------------------------------------------- combat

  function combatantBox(c, out) {
    out.min.set(c.position.x - c.radius, c.position.y, c.position.z - c.radius);
    out.max.set(c.position.x + c.radius, c.position.y + c.height, c.position.z + c.radius);
    return out;
  }

  function rayBox(origin, dir, targetBox, out) {
    ray.origin.copy(origin);
    ray.direction.copy(dir);
    return ray.intersectBox(targetBox, out);
  }

  function resolveShot(shooter, origin, dir, weapon) {
    raycaster.set(origin, dir);
    raycaster.far = weapon.range;
    const wallHits = raycaster.intersectObjects(world.shootables, false);
    const wall = wallHits[0] || null;
    const wallDist = wall ? wall.distance : Infinity;

    let best = null;
    let bestDist = Infinity;
    for (const c of combatants) {
      if (c === shooter || !c.alive) continue;
      combatantBox(c, box);
      const hitPoint = rayBox(origin, dir, box, point);
      if (hitPoint) {
        const d = hitPoint.distanceTo(origin);
        if (d < bestDist) {
          bestDist = d;
          best = { c, point: hitPoint.clone() };
        }
      }
    }
    if (best && bestDist < wallDist) {
      const part = best.point.y - best.c.position.y > best.c.eye - 0.28 ? 'head' : 'body';
      return { type: 'combatant', combatant: best.c, part, point: best.point };
    }
    if (wall) return { type: 'wall', point: wall.point.clone() };
    return { type: 'miss', point: null };
  }

  function applyHit(shooter, result, weapon) {
    if (result.type === 'combatant') {
      const c = result.combatant;
      if (c.team === shooter.team) {
        // Friendly fire is off: a teammate's body stops the bullet but takes no damage.
        return { hit: false, blocked: true, point: result.point };
      }
      const damage = result.part === 'head' ? weapon.damage.head : weapon.damage.body;
      c.health -= damage;
      let killed = false;
      if (c.health <= 0) {
        c.health = 0;
        c.alive = false;
        killed = true;
        onKill(shooter, c, weapon, result.part);
      }
      return { hit: true, killed, point: result.point, combatant: c, part: result.part };
    }
    return { hit: false, killed: false, point: result.point };
  }

  function onKill(killer, victim, weapon, part) {
    const killerName = killer.isPlayer ? NAMES.player : killer.name;
    const victimName = victim.isPlayer ? NAMES.player : victim.name;
    hud.pushKillFeed(killerName, victimName, weapon.label, killer.team, { headshot: part === 'head' });
    killer.money = Math.min(ECONOMY.max, killer.money + ECONOMY.kill);
    if (victim.isPlayer) {
      hud.setDeadBanner(true);
      input.exitLock();
    }
    hud.setAlive(aliveCount('friendly'), aliveCount('enemy'));
    checkWin();
  }

  function aliveCount(team) {
    let n = 0;
    if (team === 'friendly' && player.alive) n += 1;
    for (const b of bots.list) if (b.team === team && b.alive) n += 1;
    return n;
  }

  function checkWin() {
    if (phase !== 'combat') return;
    if (aliveCount('enemy') === 0) endRound('friendly');
    else if (aliveCount('friendly') === 0) endRound('enemy');
  }

  function winnerByCount() {
    const f = aliveCount('friendly');
    const e = aliveCount('enemy');
    if (f > e) return 'friendly';
    if (e > f) return 'enemy';
    return null;
  }

  function awardMoney(winner) {
    for (const c of combatants) {
      let amt = ECONOMY.tie;
      if (winner === 'friendly') amt = c.team === 'friendly' ? ECONOMY.win : ECONOMY.loss;
      else if (winner === 'enemy') amt = c.team === 'enemy' ? ECONOMY.win : ECONOMY.loss;
      c.money = Math.min(ECONOMY.max, c.money + amt);
    }
  }

  // ---------------------------------------------------------------- weapon handling

  function playerSpread() {
    const weapon = WEAPONS[player.weapon];
    const move = clamp(player.groundSpeed() / weapon.moveRef, 0, 1);
    let spread = weapon.spreadStill + move * (weapon.spreadMoving - weapon.spreadStill);
    if (player.crouching) spread *= 0.72;
    return spread;
  }

  function playerFire() {
    const weapon = WEAPONS[player.weapon];
    if (player.cooldown > 0 || player.reloadLeft > 0 || player.mag <= 0) return false;
    player.mag -= 1;
    player.cooldown = weapon.fireGap;
    player.flash = 0.06;
    player.kick = 0.05;

    camera.getWorldDirection(dirVec);
    const spread = playerSpread();
    dirVec.x += (random() * 2 - 1) * spread;
    dirVec.y += (random() * 2 - 1) * spread;
    dirVec.z += (random() * 2 - 1) * spread;
    dirVec.normalize();
    cameraPos.copy(camera.position);

    const result = resolveShot(player, cameraPos, dirVec, weapon);
    const outcome = applyHit(player, result, weapon);
    player.recoil(weapon.recoil + random() * 0.004, (random() * 2 - 1) * 0.004);
    audio.gunshot(player.weapon);
    if (outcome.hit) {
      hud.hitMarker(outcome.killed, outcome.killed ? 240 : 90, outcome.part === 'head');
      audio.hitMarker(outcome.killed);
    }
    if (outcome.point) impacts.spawn(outcome.point);
    hud.setAmmo(player.mag, player.reserve, player.weapon);
    return true;
  }

  function reloadPlayer() {
    const weapon = WEAPONS[player.weapon];
    if (player.reloadLeft > 0 || player.mag === weapon.mag || player.reserve === 0) return;
    player.reloadLeft = weapon.reload;
    audio.reload();
  }

  function buyWeapon(id) {
    const weapon = WEAPONS[id];
    if (!weapon) return;
    if (id === player.weapon) {
      player.refill();
      hud.refreshBuy(player.money);
      hud.setAmmo(player.mag, player.reserve, player.weapon);
      return;
    }
    if (player.money < weapon.cost) return;
    player.money -= weapon.cost;
    player.equip(id);
    viewmodels.setWeapon(id);
    hud.setMoney(player.money);
    hud.refreshBuy(player.money);
    hud.setAmmo(player.mag, player.reserve, player.weapon);
  }

  function toggleBuy() {
    if (hud.isBuyOpen()) hud.closeBuy();
    else hud.openBuy(player.money);
  }

  // ---------------------------------------------------------------- phases

  function showMenu() {
    overlayMode = 'menu';
    hud.showOverlay(NAMES.title, NAMES.subtitle, 'Single player vs five Wraith bots.', 'Click to play');
  }

  function startMatch() {
    round = 0;
    scores.friendly = 0;
    scores.enemy = 0;
    player.money = ECONOMY.start;
    for (const b of bots.list) b.money = ECONOMY.start;
    startBuy();
  }

  function startBuy() {
    round += 1;
    phase = 'buy';
    overlayMode = null;
    buyTime = ROUND.buyTime;
    player.resetRound(world.spawns.friendly[0]);
    bots.resetRound();
    bots.buy();
    hud.hideOverlay();
    hud.closeBuy();
    hud.setBuyBanner(true);
    hud.setDeadBanner(false);
    hud.setRound(round, scores.friendly, scores.enemy);
    hud.setMoney(player.money);
    hud.setAlive(aliveCount('friendly'), aliveCount('enemy'));
    viewmodels.setWeapon(player.weapon);
    audio.roundStart();
    input.requestLock();
  }

  function startCombat() {
    phase = 'combat';
    roundTime = ROUND.combatTime;
    hud.setBuyBanner(false);
    hud.closeBuy();
  }

  function endRound(winner) {
    phase = 'roundEnd';
    overlayMode = 'roundEnd';
    awardMoney(winner);
    if (winner) scores[winner] += 1;
    hud.setScore(scores.friendly, scores.enemy);
    hud.setBuyBanner(false);
    hud.setDeadBanner(false);
    input.exitLock();
    const sub = `${NAMES.friendly} ${scores.friendly} — ${scores.enemy} ${NAMES.enemy}`;
    if (winner === 'friendly') hud.showOverlay('ROUND WON', 'Aegis eliminated every Wraith.', sub, 'Next round');
    else if (winner === 'enemy') hud.showOverlay('ROUND LOST', 'Wraith overran Aegis.', sub, 'Next round');
    else hud.showOverlay('ROUND DRAWN', 'Time expired with both teams standing.', sub, 'Next round');
  }

  function onLockChange(locked) {
    if (locked) {
      audio.unlock();
      if (overlayMode === 'pause') {
        overlayMode = null;
        hud.hideOverlay();
      }
      return;
    }
    if ((phase === 'buy' || phase === 'combat') && player.alive) {
      hud.closeBuy();
      overlayMode = 'pause';
      hud.showOverlay(NAMES.title, 'Paused. Click to resume.', '', 'Resume');
    }
  }

  hud.onPlay(() => {
    audio.unlock();
    if (overlayMode === 'menu') startMatch();
    else if (overlayMode === 'roundEnd') startBuy();
    else if (overlayMode === 'pause') input.requestLock();
  });

  hud.onKey((code) => {
    if (phase !== 'buy') return;
    if (code === 'KeyB') toggleBuy();
    else if (hud.isBuyOpen() && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(code)) {
      buyWeapon(WEAPON_ORDER[Number(code.slice(5)) - 1]);
    }
  });

  // ---------------------------------------------------------------- update / camera

  function spectateTarget() {
    return bots.list.find((b) => b.team === 'friendly' && b.alive) || null;
  }

  function syncCamera() {
    if (player.alive) {
      camera.position.set(player.position.x, player.position.y + player.eye, player.position.z);
      camera.rotation.set(player.pitch, player.yaw + player.recoilYaw, 0, 'YXZ');
    } else {
      const spect = spectateTarget();
      if (spect) {
        camera.position.set(spect.position.x, spect.position.y + spect.eye, spect.position.z);
        camera.rotation.set(spect.aimPitch, spect.aimYaw, 0, 'YXZ');
      }
    }
  }

  function update(dt) {
    // Shared decay and animation.
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.flash = Math.max(0, player.flash - dt);
    player.recoilYaw *= Math.max(0, 1 - dt * 8);
    if (player.reloadLeft > 0) {
      player.reloadLeft = Math.max(0, player.reloadLeft - dt);
      if (player.reloadLeft === 0) {
        const weapon = WEAPONS[player.weapon];
        const need = weapon.mag - player.mag;
        const take = Math.min(need, player.reserve);
        player.mag += take;
        player.reserve -= take;
        hud.setAmmo(player.mag, player.reserve, player.weapon);
      }
    }
    impacts.step(dt);

    const look = input.takeLook();
    const canControl = player.alive && (phase === 'buy' || phase === 'combat');
    if (canControl && (look.x || look.y)) player.look(look.x, look.y);

    if (phase === 'buy') {
      buyTime -= dt;
      if (buyTime <= 0) startCombat();
      hud.setTimer(buyTime, 'BUY');
    } else if (phase === 'combat') {
      roundTime -= dt;
      if (roundTime <= 0) {
        endRound(winnerByCount());
        syncCamera();
        viewmodels.step(dt, player);
        return;
      }
      hud.setTimer(roundTime, 'ROUND');
      if (player.alive) {
        player.step(dt, input.state.keys);
        const weapon = WEAPONS[player.weapon];
        if (input.state.keys.has('KeyR')) reloadPlayer();
        if (weapon.auto) {
          if (input.state.firing) playerFire();
        } else if (input.state.firing && !prevFiring) {
          playerFire();
        }
      }
      bots.update(dt);
    }
    prevFiring = input.state.firing;

    viewmodels.step(dt, player);
    syncCamera();
    hud.setHealth(player.health, ROUND.maxHealth);
    hud.setAlive(aliveCount('friendly'), aliveCount('enemy'));
    hud.setCrosshairExpanded(playerSpread());
  }

  // ---------------------------------------------------------------- screenshot setup

  function placeBot(bot, x, z, yaw, alive = true, health = 100) {
    bot.position.set(x, 0, z);
    bot.yaw = yaw;
    bot.aimYaw = yaw;
    bot.aimPitch = 0;
    bot.health = health;
    bot.alive = alive;
    bot.velocity.set(0, 0, 0);
    if (alive) {
      bot.model.root.position.set(x, 0, z);
      bot.model.root.rotation.set(0, yaw, 0);
    } else {
      bot.model.root.position.set(x, 0.06, z);
      bot.model.root.rotation.set(-1.5, yaw, 0);
    }
  }

  function setupShot(name) {
    // Reset the player to a clean deterministic state.
    player.resetRound(world.spawns.friendly[0]);
    bots.resetRound();
    player.money = ECONOMY.start;
    hud.setBuyBanner(false);
    hud.setDeadBanner(false);
    hud.closeBuy();
    hud.hideOverlay();

    if (name === 'start') {
      phase = 'menu';
      overlayMode = 'menu';
      player.position.set(0, 0, 14);
      player.yaw = 0;
      player.pitch = 0;
      hud.showOverlay(NAMES.title, NAMES.subtitle, 'Single player vs five Wraith bots.', 'Click to play');
      return;
    }

    if (name === 'play') {
      phase = 'combat';
      overlayMode = null;
      round = 3;
      scores.friendly = 1;
      scores.enemy = 1;
      roundTime = 47;
      player.health = 78;
      player.money = 3400;
      player.weapon = 'rifle';
      player.mag = 23;
      player.reserve = 90;
      player.position.set(0, 0, 9);
      player.yaw = 0;
      player.pitch = 0;
      viewmodels.setWeapon('rifle');

      // A living enemy up the corridor, another flanking, and a friend on the left.
      placeBot(bots.list[4], 0, -6, Math.PI, true, 100); // enemy Hex, facing the player
      placeBot(bots.list[5], -4, -3, Math.PI * 0.8, true, 100);
      placeBot(bots.list[6], 4, -4, Math.PI * 1.2, true, 100);
      placeBot(bots.list[0], -3, 5, 0.4, true, 100); // friend Kestrel
      placeBot(bots.list[1], 3, 6, -0.4, true, 100); // friend Onyx
      placeBot(bots.list[2], -2, 2, 0.5, true, 100);
      placeBot(bots.list[3], 2, 2, -0.5, true, 100);
      placeBot(bots.list[7], 0, -9, Math.PI, false, 0); // a fallen enemy
      placeBot(bots.list[8], -6, -5, Math.PI, true, 60);

      hud.setHealth(78, ROUND.maxHealth);
      hud.setMoney(3400);
      hud.setRound(3, 1, 1);
      hud.setAlive(4, 3);
      hud.setAmmo(23, 90, 'rifle');
      hud.pushKillFeed(NAMES.player, 'Rook', 'Longshot', 'friendly');
      hud.pushKillFeed('Fang', 'Onyx', 'Viper', 'enemy');
      hud.pushKillFeed(NAMES.player, 'Vex', 'Longshot', 'friendly');
      return;
    }

    // 'end': a won round.
    phase = 'roundEnd';
    overlayMode = 'roundEnd';
    round = 3;
    scores.friendly = 2;
    scores.enemy = 1;
    player.health = 82;
    player.money = 4900;
    player.position.set(0, 0, 13);
    player.yaw = 0;
    player.pitch = 0;

    placeBot(bots.list[0], -3, 10, 0.4, true, 100);
    placeBot(bots.list[1], 3, 11, -0.4, true, 100);
    placeBot(bots.list[2], -2, 13, 0.5, true, 100);
    placeBot(bots.list[3], 2, 14, -0.5, true, 100);
    placeBot(bots.list[4], 0, -4, Math.PI, false, 0);
    placeBot(bots.list[5], -4, -3, Math.PI, false, 0);
    placeBot(bots.list[6], 4, -3, Math.PI, false, 0);
    placeBot(bots.list[7], -2, -5, Math.PI, false, 0);
    placeBot(bots.list[8], 2, -5, Math.PI, false, 0);

    hud.setHealth(82, ROUND.maxHealth);
    hud.setMoney(4900);
    hud.setRound(3, 2, 1);
    hud.setAlive(5, 0);
    hud.setAmmo(player.mag, player.reserve, player.weapon);
    hud.pushKillFeed(NAMES.player, 'Hex', 'Avalanche', 'friendly');
    hud.pushKillFeed('Kestrel', 'Sable', 'Viper', 'friendly');
    hud.showOverlay('ROUND WON', 'Aegis eliminated every Wraith.', `${NAMES.friendly} ${scores.friendly} — ${scores.enemy} ${NAMES.enemy}`, 'Next round');
  }

  return {
    update,
    syncCamera,
    setupShot,
    state: {
      get phase() { return phase; },
      get player() { return player; },
    },
  };
}

// ---------------------------------------------------------------- impact flashes

function createImpacts(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.35, PALETTE.accent);
  gradient.addColorStop(1, 'rgba(240,168,48,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  const pool = [];
  for (let i = 0; i < 40; i += 1) {
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.scale.setScalar(0.28);
    scene.add(sprite);
    pool.push({ sprite, life: 0 });
  }

  function spawn(position) {
    let slot = pool.find((s) => s.life <= 0);
    if (!slot) slot = pool[0];
    slot.sprite.position.copy(position);
    slot.sprite.visible = true;
    slot.life = 0.12;
    slot.sprite.scale.setScalar(0.28);
    slot.sprite.material.opacity = 0.95;
  }

  function step(dt) {
    for (const slot of pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.sprite.visible = false;
      } else {
        const t = slot.life / 0.12;
        slot.sprite.material.opacity = t * 0.95;
        slot.sprite.scale.setScalar(0.28 + (1 - t) * 0.4);
      }
    }
  }

  return { spawn, step };
}

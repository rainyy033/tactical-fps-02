// The DOM HUD: crosshair, hit marker, health, money, round, timer, ammo, the kill feed, the buy
// menu, and the start/round-end/pause overlay. It never touches the simulation; game.js pushes
// numbers in and reads the play/buy callbacks out.
import { WEAPONS, WEAPON_ORDER, NAMES } from './config.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const overlaySub = $('overlay-sub');
  const play = $('play');

  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const headshot = $('headshot');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const moneyValue = $('money-value');
  const roundValue = $('round-value');
  const scoreValue = $('score-value');
  const timerValue = $('timer-value');
  const timerPhase = $('timer-phase');
  const aliveFriendly = $('alive-friendly');
  const aliveEnemy = $('alive-enemy');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const killfeed = $('killfeed');
  const buyBanner = $('buy-banner');
  const deadBanner = $('dead-banner');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');

  const buyRows = WEAPON_ORDER.map((id, i) => {
    const row = $(`buy-${i}`);
    const key = $(`buy-${i}-key`);
    const name = $(`buy-${i}-name`);
    const price = $(`buy-${i}-price`);
    return { id, row, key, name, price };
  });

  const entries = new Map(); // kill feed line -> element
  let hitTimer = 0;
  let headshotTimer = 0;
  let last = { mag: -1, reserve: -1, health: -1, money: -1, round: -1, timer: -1, weapon: '' };

  return {
    setAmmo(mag, reserve, weaponId) {
      if (last.mag === mag && last.reserve === reserve && last.weapon === weaponId) return;
      last.mag = mag;
      last.reserve = reserve;
      last.weapon = weaponId;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = WEAPONS[weaponId] ? WEAPONS[weaponId].name : weaponId;
    },
    setHealth(value, max) {
      if (last.health === value) return;
      last.health = value;
      healthValue.textContent = String(Math.max(0, value));
      healthFill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
      healthFill.classList.toggle('low', value <= 35);
    },
    setMoney(value) {
      if (last.money === value) return;
      last.money = value;
      moneyValue.textContent = `$${value}`;
    },
    setRound(value, scoreF, scoreE) {
      if (last.round === value) return;
      last.round = value;
      roundValue.textContent = String(value);
      scoreValue.textContent = `${scoreF} — ${scoreE}`;
    },
    setScore(scoreF, scoreE) {
      scoreValue.textContent = `${scoreF} — ${scoreE}`;
    },
    setAlive(friendly, enemy) {
      aliveFriendly.textContent = String(friendly);
      aliveEnemy.textContent = String(enemy);
    },
    setTimer(seconds, phase) {
      if (last.timer === seconds && timerPhase.textContent === phase) return;
      last.timer = seconds;
      timerPhase.textContent = phase;
      const s = Math.max(0, Math.ceil(seconds));
      timerValue.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },
    hitMarker(killed, holdMs = 90, headshotHit = false) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
      if (headshotHit) this.showHeadshot();
    },
    showHeadshot() {
      headshot.classList.remove('on');
      // Force a reflow so a rapid second headshot restarts the flash animation.
      void headshot.offsetWidth;
      headshot.classList.add('on');
      clearTimeout(headshotTimer);
      headshotTimer = setTimeout(() => headshot.classList.remove('on'), 520);
    },
    setCrosshairExpanded(value) {
      // The crosshair opens a little while moving, as a spread cue.
      crosshair.style.setProperty('--gap', `${4 + value * 10}px`);
    },
    pushKillFeed(killerName, victimName, weaponLabel, team, opts = {}) {
      const line = document.createElement('div');
      line.className = `killfeed-line ${team}`;
      if (killerName === NAMES.player) line.classList.add('self');
      const killer = document.createElement('span');
      killer.className = 'killer';
      killer.textContent = killerName;
      const weapon = document.createElement('span');
      weapon.className = 'weapon';
      weapon.textContent = weaponLabel;
      const victim = document.createElement('span');
      victim.className = 'victim';
      victim.textContent = victimName;
      line.append(killer, weapon, victim);
      if (opts.headshot) {
        const hs = document.createElement('span');
        hs.className = 'hs';
        hs.textContent = '☠';
        hs.title = 'Headshot';
        line.append(hs);
      }
      killfeed.prepend(line);
      const key = {};
      entries.set(line, key);
      setTimeout(() => {
        if (entries.has(line)) {
          line.style.opacity = '0';
          setTimeout(() => {
            line.remove();
            entries.delete(line);
          }, 300);
        }
      }, 6000);
      while (killfeed.children.length > 6) {
        const lastLine = killfeed.lastChild;
        if (lastLine && entries.has(lastLine)) entries.delete(lastLine);
        lastLine && lastLine.remove();
      }
    },
    setBuyBanner(visible) {
      buyBanner.classList.toggle('on', visible);
    },
    setDeadBanner(visible) {
      deadBanner.classList.toggle('on', visible);
    },
    // Buy menu ---------------------------------------------------------------------------
    openBuy(money) {
      buyMenu.classList.add('open');
      buyMenu.hidden = false;
      this.refreshBuy(money);
    },
    closeBuy() {
      buyMenu.classList.remove('open');
      buyMenu.hidden = true;
    },
    isBuyOpen() {
      return !buyMenu.hidden && buyMenu.classList.contains('open');
    },
    refreshBuy(money) {
      buyMoney.textContent = `$${money}`;
      for (const row of buyRows) {
        const weapon = WEAPONS[row.id];
        const affordable = money >= weapon.cost;
        row.row.classList.toggle('affordable', affordable);
        row.row.classList.toggle('owned', row.id === last.weapon);
        row.key.textContent = String(buyRows.indexOf(row) + 1);
        row.name.textContent = `${weapon.name} · ${weapon.label}`;
        row.price.textContent = weapon.cost === 0 ? 'FREE' : `$${weapon.cost}`;
      }
    },
    // Overlay -----------------------------------------------------------------------------
    showOverlay(title, copy, sub, action) {
      overlayTitle.textContent = title;
      overlayCopy.textContent = copy;
      overlaySub.textContent = sub ?? '';
      play.textContent = action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onKey(handler) {
      window.addEventListener('keydown', (event) => handler(event.code));
    },
  };
}

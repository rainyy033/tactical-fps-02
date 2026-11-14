// Procedural audio: every sound in the game is synthesised with the Web Audio API at play time,
// so there are no audio files to ship. A single shared AudioContext plus a short noise buffer feed
// gunshots (a filtered crack over a pitched-down body), mechanical reload clicks, a hit tick/ding,
// and the round-start beep. The context is created lazily on the first user gesture (the play
// button or pointer lock), which is what browsers require before any sound may start.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    const seconds = 1.5;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  // A filtered burst of the shared noise buffer.
  function noiseBurst(t, { gain = 0.5, duration = 0.1, type = 'lowpass', from = 2000, to = 500, q = 0.7 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // A pitched oscillator with its own attack/decay envelope.
  function tone(t, { type = 'sine', from = 440, to = null, gain = 0.3, duration = 0.1, attack = 0.004 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env);
    env.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const GUNSHOTS = {
    pistol: { bodyFrom: 220, bodyTo: 90, bodyDur: 0.09, bodyGain: 0.5, crackFrom: 2400, crackTo: 500, crackDur: 0.07, crackGain: 0.5 },
    smg: { bodyFrom: 260, bodyTo: 120, bodyDur: 0.06, bodyGain: 0.4, crackFrom: 2800, crackTo: 700, crackDur: 0.05, crackGain: 0.42 },
    rifle: { bodyFrom: 190, bodyTo: 70, bodyDur: 0.11, bodyGain: 0.55, crackFrom: 1900, crackTo: 400, crackDur: 0.09, crackGain: 0.58 },
    sniper: { bodyFrom: 130, bodyTo: 45, bodyDur: 0.2, bodyGain: 0.7, crackFrom: 1100, crackTo: 200, crackDur: 0.16, crackGain: 0.68 },
  };

  function gunshot(id, opts = {}) {
    if (!ensure()) return;
    const spec = GUNSHOTS[id] || GUNSHOTS.pistol;
    const distance = opts.distant ? 0.32 : 1;
    const t = ctx.currentTime + 0.001;
    tone(t, { type: 'sine', from: spec.bodyFrom, to: spec.bodyTo, gain: spec.bodyGain * distance, duration: spec.bodyDur });
    noiseBurst(t, { gain: spec.crackGain * distance, duration: spec.crackDur, from: spec.crackFrom, to: spec.crackTo });
  }

  // Three short mechanical clicks: mag out, mag in, bolt forward.
  function reload() {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.001;
    noiseBurst(t, { gain: 0.25, duration: 0.035, type: 'bandpass', from: 1200, to: 1200, q: 6 });
    noiseBurst(t + 0.12, { gain: 0.2, duration: 0.03, type: 'bandpass', from: 1600, to: 1600, q: 8 });
    noiseBurst(t + 0.42, { gain: 0.3, duration: 0.04, type: 'bandpass', from: 700, to: 700, q: 5 });
  }

  function hitMarker(killed) {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.001;
    if (killed) {
      tone(t, { type: 'sine', from: 880, gain: 0.22, duration: 0.07 });
      tone(t + 0.06, { type: 'sine', from: 1318, gain: 0.2, duration: 0.12 });
    } else {
      tone(t, { type: 'triangle', from: 1600, gain: 0.16, duration: 0.035 });
    }
  }

  function roundStart() {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.001;
    tone(t, { type: 'sine', from: 660, gain: 0.22, duration: 0.09 });
    tone(t + 0.1, { type: 'sine', from: 880, gain: 0.22, duration: 0.16 });
  }

  return { unlock, gunshot, reload, hitMarker, roundStart };
}

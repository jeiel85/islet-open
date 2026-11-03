// Every sound is synthesised with Web Audio — there are no audio files.
// Umpire calls use the browser's speech synthesis when it is available.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voice = true;
    this.crowdLevel = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(2);
    this.claps = this.makeClaps(3.2);
    this.startMurmur();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
    if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  makeNoise(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeClaps(sec) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * sec);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let c = 0; c < 900; c++) {
        const start = Math.floor(Math.pow(Math.random(), 1.4) * (n - 2000));
        const len = 300 + Math.floor(Math.random() * 500);
        const amp = 0.2 + Math.random() * 0.5;
        for (let i = 0; i < len; i++) d[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 120);
      }
      for (let i = 0; i < n; i++) d[i] *= 0.5;
    }
    return buf;
  }

  play(buf, { gain = 0.5, rate = 1, filter = null, freq = 1000, q = 1, at = 0 } = {}) {
    if (!this.ctx || !this.enabled) return null;
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = src;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master);
    src.start(t);
    return { src, g, t };
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, to = null, at = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, opts) {
    const p = this.play(this.noise, opts);
    if (!p) return;
    p.g.gain.setValueAtTime(opts.gain, p.t);
    p.g.gain.exponentialRampToValueAtTime(0.0001, p.t + dur);
    p.src.stop(p.t + dur + 0.02);
  }

  hit(speedKmh, q = 1, perfect = false) {
    const v = Math.min(1, speedKmh / 180);
    this.burst(0.05, { gain: 0.25 + 0.35 * v, filter: 'bandpass', freq: 1500 + 900 * q, q: 1.2 });
    this.tone(220 + 120 * v, 0.07, { type: 'triangle', gain: 0.35 + 0.2 * v, to: 90 });
    if (perfect) this.tone(1900, 0.12, { type: 'sine', gain: 0.08, to: 2400 });
  }

  bounce(surface, speed = 15) {
    const v = Math.min(1, speed / 35);
    const freq = surface === 'clay' ? 500 : surface === 'grass' ? 380 : 900;
    this.burst(0.04, { gain: 0.12 + 0.25 * v, filter: 'lowpass', freq, q: 0.8 });
    this.tone(surface === 'hard' ? 160 : 110, 0.06, { gain: 0.18 * v + 0.05, to: 60 });
  }

  net() {
    this.burst(0.18, { gain: 0.35, filter: 'lowpass', freq: 420 });
    this.tone(90, 0.15, { gain: 0.25, to: 50 });
  }

  whoosh() {
    this.burst(0.16, { gain: 0.12, filter: 'bandpass', freq: 700, q: 0.7 });
  }

  applause(level = 1) {
    if (!this.ctx || !this.enabled) return;
    const p = this.play(this.claps, { gain: 0, filter: 'bandpass', freq: 2200, q: 0.5, rate: 0.9 + Math.random() * 0.2 });
    if (!p) return;
    const peak = 0.25 + 0.35 * Math.min(1.5, level);
    p.g.gain.setValueAtTime(0, p.t);
    p.g.gain.linearRampToValueAtTime(peak, p.t + 0.15);
    p.g.gain.setTargetAtTime(0, p.t + 1.2 + level, 0.6);
    p.src.stop(p.t + 3.2);
  }

  ooh() {
    if (!this.ctx || !this.enabled) return;
    const p = this.play(this.noise, { gain: 0, filter: 'bandpass', freq: 420, q: 6 });
    if (!p) return;
    p.g.gain.setValueAtTime(0, p.t);
    p.g.gain.linearRampToValueAtTime(0.5, p.t + 0.25);
    p.g.gain.exponentialRampToValueAtTime(0.001, p.t + 1.3);
    p.src.stop(p.t + 1.4);
  }

  chime() {
    this.tone(660, 0.18, { type: 'square', gain: 0.06 });
    this.tone(990, 0.3, { type: 'square', gain: 0.06, at: 0.16 });
  }

  startMurmur() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    this.murmurGain = this.ctx.createGain();
    this.murmurGain.gain.value = 0;
    src.connect(f);
    f.connect(this.murmurGain);
    this.murmurGain.connect(this.master);
    src.start();
  }

  setMurmur(level) {
    if (!this.murmurGain) return;
    this.murmurGain.gain.setTargetAtTime(0.05 * level, this.ctx.currentTime, 0.5);
  }

  say(text) {
    if (!this.enabled || !this.voice || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      u.rate = 1.02;
      u.pitch = 0.9;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch {
      // Speech synthesis is optional; ignore platforms that refuse it.
    }
  }
}

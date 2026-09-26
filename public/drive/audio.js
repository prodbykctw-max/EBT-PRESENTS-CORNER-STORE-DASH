// Drive audio built on real recordings (see sfx/CREDITS.txt), mixed the way racing games do it:
//   engine: two looping V8 recordings, on-throttle and off-throttle, both pitched with rpm and
//           crossfaded by throttle, over a 5-speed automatic you can hear shift
//   tyres:  a recorded squeal loop that swells with lateral slip; a recorded screech on hard hits
//   crash:  recorded sheet-metal hit (+ glass on big ones) over a low synthesised body thump
//   horn / distant horns / token clink: recordings, slightly re-pitched each time so they never repeat
//   bed:    low brown-noise city rumble
// Mobile browsers only start audio after a user gesture: unlock() is called from pointerdown / keydown.

const SFX = new URL('./sfx/', import.meta.url);
const FILES = {
  on: 'engine_on.wav', off: 'engine_off.wav', squeal: 'squeal_loop.wav', screech: 'screech.mp3', horn: 'horn.mp3',
  hornFar: 'horn_far.mp3', coin: 'coin.mp3', metal1: 'crash_metal_1.mp3', metal2: 'crash_metal_2.mp3', metal3: 'crash_metal_3.mp3', glass: 'crash_glass.mp3',
};
const RATIOS = [0, 3.4, 2.25, 1.62, 1.22, 0.96];   // "gear × speed" → rpm
const IDLE = 850, REDLINE = 6400, UPSHIFT = 5800, DOWNSHIFT = 2300;
const rnd = (a, b) => a + Math.random() * (b - a);

export class DriveAudio {
  constructor({ muted = false } = {}) { this.muted = muted; this.ctx = null; this.buf = {}; this.gear = 1; this.rpm = IDLE; this.shiftT = 0; }

  unlock() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.out = ctx.createGain(); this.out.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.out.connect(comp).connect(ctx.destination);
    this.bus = { engine: gain(ctx, 0, this.out), fx: gain(ctx, 0.85, this.out), bed: gain(ctx, 0, this.out) };
    this.bus.bed.gain.setTargetAtTime(0.1, ctx.currentTime, 1.5);
    this.buildBed();
    this.ready = Promise.all(Object.entries(FILES).map(async ([k, f]) => {
      const data = await (await fetch(new URL(f, SFX))).arrayBuffer();
      this.buf[k] = await new Promise((ok, err) => ctx.decodeAudioData(data, ok, err));
    })).then(() => this.buildEngine()).catch((e) => console.warn('drive audio: some sounds failed to load', e));
  }

  buildEngine() {
    const ctx = this.ctx;
    // a touch of low-end weight and a gentle top roll-off make the small recording read as a big V8
    const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 180; shelf.gain.value = 5;
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 5000; this.engLP.Q.value = 0.4;
    shelf.connect(this.engLP).connect(this.bus.engine);
    this.layers = ['on', 'off'].map((k) => {
      const src = ctx.createBufferSource(); src.buffer = this.buf[k]; src.loop = true;
      const g = gain(ctx, 0, shelf); src.connect(g); src.start(0, Math.random() * src.buffer.duration);
      return { src, g };
    });
    const sq = ctx.createBufferSource(); sq.buffer = this.buf.squeal; sq.loop = true;
    this.squeal = gain(ctx, 0, this.bus.fx); sq.connect(this.squeal); sq.start();
    this.bus.engine.gain.setTargetAtTime(0.75, ctx.currentTime, 0.4);
  }
  buildBed() {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const n = ctx.createBufferSource(); n.buffer = b; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    n.connect(lp).connect(this.bus.bed); n.start();
    this.bedTimer = setInterval(() => { if (Math.random() < 0.3) this.play('hornFar', { gain: rnd(0.12, 0.25), rate: rnd(0.88, 1.08), bus: this.bus.bed }); }, 5000);
  }

  setMuted(m) { this.muted = m; if (this.out) this.out.gain.value = m ? 0 : 0.9; }

  /** speed m/s, load 0..1 (throttle), slip 0..1 */
  update(speed, load, slip, dt) {
    if (!this.ctx || !this.layers) return;
    const t = this.ctx.currentTime;
    const target = () => IDLE + speed * RATIOS[this.gear] * 60;
    if (target() > UPSHIFT && this.gear < 5 && this.shiftT <= 0) { this.gear++; this.shiftT = 0.18; }
    else if (target() < DOWNSHIFT && this.gear > 1) this.gear--;
    this.shiftT -= dt;
    const want = Math.min(REDLINE, Math.max(IDLE, target()));
    this.rpm += (want - this.rpm) * Math.min(1, dt * (this.shiftT > 0 ? 16 : 6));
    const l = this.shiftT > 0 ? 0 : load;          // lift during the shift: you hear the off-throttle loop
    // recordings sit around mid revs: idle plays them at ~0.55×, the redline at ~1.7×
    const rate = 0.55 + (this.rpm - IDLE) / (REDLINE - IDLE) * 1.15;
    const [on, off] = this.layers;
    for (const ly of this.layers) ly.src.playbackRate.setTargetAtTime(rate, t, 0.04);
    on.g.gain.setTargetAtTime(Math.sin(l * Math.PI / 2) * 0.9, t, 0.06);          // equal-power crossfade
    off.g.gain.setTargetAtTime(Math.cos(l * Math.PI / 2) * 0.75, t, 0.06);
    this.engLP.frequency.setTargetAtTime(2400 + this.rpm * 0.6, t, 0.08);
    this.squeal.gain.setTargetAtTime(slip > 0.3 ? Math.min(0.55, (slip - 0.3) * 1.1) : 0, t, 0.05);
  }

  play(name, { gain: g = 1, rate = 1, bus, delay = 0 } = {}) {
    if (!this.ctx || !this.buf[name]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[name]; s.playbackRate.value = rate;
    const gn = this.ctx.createGain(); gn.gain.value = g;
    s.connect(gn).connect(bus || this.bus.fx); s.start(this.ctx.currentTime + delay);
  }

  crash(power = 1) {
    if (!this.ctx) return;
    const p = Math.max(0.35, power);
    this.play('metal' + (1 + ((Math.random() * 3) | 0)), { gain: 0.9 * p, rate: rnd(0.8, 0.95) });
    if (power > 0.8) { this.play('glass', { gain: 0.5, rate: rnd(0.95, 1.1), delay: 0.03 }); this.play('screech', { gain: 0.35, rate: rnd(0.95, 1.05) }); }
    // low body thump under the recording: that's what makes a car hit feel heavy
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.8 * p, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.bus.fx); o.start(t); o.stop(t + 0.32);
  }
  horn() { this.play('horn', { gain: 0.8, rate: 1 }); }
  token() { this.play('coin', { gain: 0.75, rate: rnd(1.25, 1.4) }); }
  whoosh() { this.air(); }
  air() { // near miss: a short band-passed air rush
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, b = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = b;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.15); bp.frequency.exponentialRampToValueAtTime(350, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(bp).connect(g).connect(this.bus.fx); n.start(t);
  }
  bell(gain = 0.5) { // streetcar gong: "ding-ding", synthesised from bell-like inharmonic partials
    const ctx = this.ctx; if (!ctx) return;
    for (const [at, k] of [[0, 1], [0.22, 0.85]]) {
      const t = ctx.currentTime + at;
      for (const [f, a] of [[1180, 1], [1180 * 2.76, 0.45], [1180 * 5.4, 0.18], [590, 0.3]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * a * k * 0.25, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (f > 2000 ? 0.35 : 0.9));
        o.connect(g).connect(this.bus.fx); o.start(t); o.stop(t + 1);
      }
    }
  }
  chime() { // parked: coin clinks rising
    [1, 1.26, 1.5, 2].forEach((r, i) => this.play('coin', { gain: 0.6, rate: r, delay: i * 0.09 }));
  }

  stop() {
    clearInterval(this.bedTimer);
    if (!this.ctx) return;
    const ctx = this.ctx; this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => ctx.close(), 600);
  }
}

function gain(ctx, v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }

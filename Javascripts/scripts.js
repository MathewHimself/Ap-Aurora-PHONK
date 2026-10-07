(() => {
  const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const COW_DEG = [0, 3, 5, 7, 10, 12];
  const COW_LBL = ['1', 'b3', '4', '5', 'b7', '8'];
  const COW_KEYS = ['a','s','d','f','g','h'];
  const DRUMS = [['kick','Kick','q'],['clap','Clap','w'],['hat','Хэт','e'],['ohat','Откр.','r'],['roll','Ролл','t'],['impact','Impact','y']];
  const BASS = [['root','Тоника','z',0],['fifth','Квинта','x',7],['oct','Октава','c',12],['glide','Глайд','v',0]];

  const state = { bpm: 130, vol: 80, key: 1, glide: 0.25 };
  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const pct = (el) => Number(el.value) / 100;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- pads ---------- */
  function padCol(name, sub, key, cls, id) {
    const col = document.createElement('div');
    col.className = 'pad-col';
    col.innerHTML = `<span class="pad-name">${name}</span><button class="pad ${cls}" data-id="${id}" aria-label="${name}"><kbd>${key.toUpperCase()}</kbd></button>` + (sub ? `<span class="pad-sub">${sub}</span>` : '');
    return col;
  }
  function renderCowPads() {
    const box = $('#cowPads'); box.innerHTML = '';
    COW_DEG.forEach((d, i) => box.appendChild(padCol(NOTES[(state.key + d) % 12], COW_LBL[i], COW_KEYS[i], '', 'cow' + i)));
  }
  renderCowPads();
  DRUMS.forEach(([id, n, k]) => $('#drumPads').appendChild(padCol(n, '', k, 'round', id)));
  BASS.forEach(([id, n, k]) => $('#bassPads').appendChild(padCol(n, '', k, '', 'b_' + id)));

  const keyMap = {};
  COW_KEYS.forEach((k, i) => keyMap[k] = 'cow' + i);
  DRUMS.forEach(([id, , k]) => keyMap[k] = id);
  BASS.forEach(([id, , k]) => keyMap[k] = 'b_' + id);

  function flash(id) {
    const el = $(`.pad[data-id="${id}"]`);
    if (!el) return;
    el.classList.add('hit');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('hit'), 140);
  }

  /* ---------- audio ---------- */
  let A = null;
  function crushCurve(bits) {
    const steps = Math.pow(2, bits);
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * steps / 2) / (steps / 2); }
    return c;
  }

  async function initAudio() {
    if (A) return A;
    await Tone.start();
    Tone.context.lookAhead = 0.01;
    const master = new Tone.Volume(Tone.gainToDb(state.vol / 100)).toDestination();
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    master.connect(meter);
    const limiter = new Tone.Limiter(-0.3).connect(master);
    const comp = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.15 }).connect(limiter);

    // cowbell bus
    const cowRev = new Tone.Reverb({ decay: 2.5, preDelay: 0.02, wet: 0.35 }).connect(comp);
    const cowDist = new Tone.Distortion({ distortion: 0.4, wet: 0.6, oversample: '2x' }).connect(cowRev);
    const cowIn = new Tone.Gain(0.55).connect(cowDist);

    // 808 bus
    const bassFilter = new Tone.Filter({ frequency: 1200, type: 'lowpass', rolloff: -24 }).connect(comp);
    const bassDist = new Tone.Distortion({ distortion: 0.55, wet: 0.7, oversample: '4x' }).connect(bassFilter);
    const bass = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 1.5, oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 1.4, sustain: 0, release: 0.1 }, volume: -3 }).connect(bassDist);
    const glide = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 1.4, sustain: 0, release: 0.1 }, volume: -3 }).connect(bassDist);

    // drums bus
    const drumRev = new Tone.Reverb({ decay: 1.2, wet: 0.15 }).connect(comp);
    const crushMix = new Tone.CrossFade(0).connect(drumRev);
    const crusher = new Tone.WaveShaper(crushCurve(6)).connect(crushMix.b);
    const drumIn = new Tone.Gain(1);
    drumIn.connect(crushMix.a); drumIn.connect(crusher);
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.06, octaves: 6, envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.05 }, volume: -2 }).connect(drumIn);
    const clapBp = new Tone.Filter({ frequency: 1300, type: 'bandpass', Q: 1.2 }).connect(drumIn);
    const clap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.14, sustain: 0 }, volume: -4 }).connect(clapBp);
    const hatHp = new Tone.Filter({ frequency: 7000, type: 'highpass' }).connect(drumIn);
    const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -10 }).connect(hatHp);
    const ohat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.03 }, volume: -12 }).connect(hatHp);
    const impRev = new Tone.Reverb({ decay: 4, wet: 0.65 }).connect(comp);
    const impNoise = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 1.6, sustain: 0 }, volume: -8 }).connect(impRev);
    const impBoom = new Tone.MembraneSynth({ pitchDecay: 0.2, octaves: 4, envelope: { attack: 0.001, decay: 1.5, sustain: 0 }, volume: -2 }).connect(impRev);

    A = { master, meter, limiter, comp, cowRev, cowDist, cowIn, bassFilter, bassDist, bass, glide, drumRev, crushMix, crusher, kick, clap, hat, ohat, impNoise, impBoom };
    applyAll();
    return A;
  }

  function cowbell(freq, t) {
    const env = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.32, sustain: 0, release: 0.02 }).connect(A.cowIn);
    const bp = new Tone.Filter({ frequency: freq * 1.45, type: 'bandpass', Q: 0.9 }).connect(env);
    const o1 = new Tone.Oscillator(freq, 'square').connect(bp);
    const o2 = new Tone.Oscillator(freq * 1.48, 'square').connect(bp);
    o1.volume.value = -8; o2.volume.value = -8;
    o1.start(t); o2.start(t); env.triggerAttackRelease(0.32, t);
    o1.stop(t + 0.6); o2.stop(t + 0.6);
    setTimeout(() => [o1, o2, bp, env].forEach((n) => n.dispose()), 1500);
  }

  let lastNoise = 0;
  const after = (t) => { const s = Math.max(t, lastNoise + 0.005); lastNoise = s; return s; };

  async function play(id) {
    await initAudio();
    const t = Tone.now() + 0.005;
    flash(id);
    if (id.startsWith('cow')) {
      const i = Number(id.slice(3));
      cowbell(midiToHz(72 + state.key + COW_DEG[i]), t);
      return;
    }
    const bassRoot = 36 + state.key;
    switch (id) {
      case 'b_root': A.bass.triggerAttackRelease(midiToHz(bassRoot), 1.4, t); break;
      case 'b_fifth': A.bass.triggerAttackRelease(midiToHz(bassRoot + 7), 1.4, t); break;
      case 'b_oct': A.bass.triggerAttackRelease(midiToHz(bassRoot + 12), 1.4, t); break;
      case 'b_glide': {
        const hi = midiToHz(bassRoot + 12), lo = midiToHz(bassRoot);
        A.glide.triggerAttackRelease(hi, 1.4, t);
        A.glide.frequency.setValueAtTime(hi, t + 0.01);
        A.glide.frequency.exponentialRampToValueAtTime(lo, t + 0.01 + state.glide);
        break;
      }
      case 'kick': A.kick.triggerAttackRelease('C1', 0.4, t); break;
      case 'clap': for (let k = 0; k < 3; k++) A.clap.triggerAttackRelease(0.14, after(t + k * 0.011)); break;
      case 'hat': A.ohat.triggerRelease(t); A.hat.triggerAttackRelease(0.05, after(t)); break;
      case 'ohat': A.ohat.triggerAttackRelease(0.45, after(t)); break;
      case 'roll': {
        const step = 60 / state.bpm / 6;
        for (let k = 0; k < 6; k++) A.hat.triggerAttackRelease(0.04, after(t + k * step));
        break;
      }
      case 'impact': A.impBoom.triggerAttackRelease('C1', 1.2, t); A.impNoise.triggerAttackRelease(1.6, after(t)); break;
    }
  }

  /* ---------- controls ---------- */
  const fxOn = {};
  $$('[data-fx]').forEach((c) => fxOn[c.dataset.fx] = $('.toggle', c).getAttribute('aria-pressed') === 'true');
  const val = (p) => pct($(`[data-p="${p}"]`));
  const seg = (s) => $(`[data-seg="${s}"] [aria-pressed="true"]`).dataset.v;

  const MAP = {
    'cowDist.wet': (v) => `${Math.round(v * 100)}%`,
    'cowDist.drive': (v) => `${Math.round(v * 100)}%`,
    'cowRev.wet': (v) => `${Math.round(v * 100)}%`,
    'cowRev.decay': (v) => `${(0.5 + v * 5.5).toFixed(1)} с`,
    'cowRev.pre': (v) => `${Math.round(v * 100)} мс`,
    'crush.wet': (v) => `${Math.round(v * 100)}%`,
    'crush.bits': (v) => `${Math.round(2 + v * 10)} бит`,
    'drumRev.wet': (v) => `${Math.round(v * 100)}%`,
    'drumRev.decay': (v) => `${(0.5 + v * 4.5).toFixed(1)} с`,
    'bassDist.wet': (v) => `${Math.round(v * 100)}%`,
    'bassDist.drive': (v) => `${Math.round(v * 100)}%`,
    'bassFilter.cutoff': (v) => { const f = 80 * Math.pow(100, v); return f >= 1000 ? `${(f / 1000).toFixed(1)} кГц` : `${Math.round(f)} Гц`; },
    'bassFilter.glide': (v) => `${Math.round(20 + v * 580)} мс`,
    'comp.threshold': (v) => `${Math.round(-40 + v * 40)} дБ`,
    'comp.ratio': (v) => `${Math.round(1 + v * 19)}:1`,
    'limiter.ceiling': (v) => `${(-12 + v * 12).toFixed(1)} дБ`,
  };
  function updateOutputs() {
    $$('[data-p]').forEach((inp) => { const o = inp.closest('.ctrl').querySelector('output'); if (o) o.textContent = MAP[inp.dataset.p](pct(inp)); });
  }

  let revTimer = null;
  function applyAll() {
    updateOutputs();
    state.glide = (20 + val('bassFilter.glide') * 580) / 1000;
    if (!A) return;
    A.cowDist.wet.value = fxOn.cowDist ? val('cowDist.wet') : 0;
    A.cowDist.distortion = val('cowDist.drive');
    A.cowDist.oversample = seg('cowDist.os');
    A.cowRev.wet.value = fxOn.cowRev ? val('cowRev.wet') : 0;
    A.crushMix.fade.value = fxOn.crush ? val('crush.wet') : 0;
    A.drumRev.wet.value = fxOn.drumRev ? val('drumRev.wet') : 0;
    A.bassDist.wet.value = fxOn.bassDist ? val('bassDist.wet') : 0;
    A.bassDist.distortion = val('bassDist.drive');
    A.bassDist.oversample = seg('bassDist.os');
    A.bassFilter.type = fxOn.bassFilter ? seg('bassFilter.type') : 'lowpass';
    A.bassFilter.frequency.rampTo(fxOn.bassFilter ? 80 * Math.pow(100, val('bassFilter.cutoff')) : 20000, 0.05);
    A.comp.threshold.value = fxOn.comp ? -40 + val('comp.threshold') * 40 : 0;
    A.comp.ratio.value = fxOn.comp ? 1 + val('comp.ratio') * 19 : 1;
    A.limiter.threshold.value = fxOn.limiter ? -12 + val('limiter.ceiling') * 12 : 0;
    A.master.volume.rampTo(state.vol === 0 ? -Infinity : Tone.gainToDb(state.vol / 100), 0.05);
    // regenerating reverbs is costly, so debounce it
    clearTimeout(revTimer);
    revTimer = setTimeout(() => {
      const cd = 0.5 + val('cowRev.decay') * 5.5, cp = val('cowRev.pre') * 0.1, dd = 0.5 + val('drumRev.decay') * 4.5;
      if (Math.abs(A.cowRev.decay - cd) > 0.05) A.cowRev.decay = cd;
      if (Math.abs(A.cowRev.preDelay - cp) > 0.002) A.cowRev.preDelay = cp;
      if (Math.abs(A.drumRev.decay - dd) > 0.05) A.drumRev.decay = dd;
      const bits = Math.round(2 + val('crush.bits') * 10);
      if (A.crusher._bits !== bits) { A.crusher.curve = crushCurve(bits); A.crusher._bits = bits; }
    }, 200);
  }

  $$('[data-p]').forEach((inp) => inp.addEventListener('input', applyAll));
  $$('[data-seg]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', g).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    applyAll();
  }));
  $$('[data-fx]').forEach((card) => $('.toggle', card).addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    card.classList.toggle('off', !on);
    fxOn[card.dataset.fx] = on;
    applyAll();
  }));

  function setBpm(v) {
    state.bpm = Math.max(80, Math.min(180, v));
    $('#bpm').value = state.bpm; $('#bpmLabel').textContent = state.bpm; $('#bpmBig').textContent = state.bpm;
  }
  function setVol(v) {
    state.vol = Math.max(0, Math.min(100, v));
    $('#vol').value = state.vol; $('#volLabel').textContent = state.vol;
    applyAll();
  }
  $('#bpm').addEventListener('input', (e) => setBpm(Number(e.target.value)));
  $('#vol').addEventListener('input', (e) => setVol(Number(e.target.value)));
  $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.dir);
    if (b.dataset.step === 'bpm') setBpm(state.bpm + d); else setVol(state.vol + d * 5);
  }));
  function setKey(k) { state.key = (k + 12) % 12; $('#keyName').textContent = `${NOTES[state.key]} минор`; renderCowPads(); }
  $('#keyPrev').addEventListener('click', () => setKey(state.key - 1));
  $('#keyNext').addEventListener('click', () => setKey(state.key + 1));

  $$('.chip').forEach((c) => c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    c.setAttribute('aria-pressed', String(on));
    document.getElementById(c.dataset.layer).classList.toggle('is-hidden', !on);
  }));

  document.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (pad) { e.preventDefault(); play(pad.dataset.id); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches('input')) return;
    const id = keyMap[e.key.toLowerCase()];
    if (id) { e.preventDefault(); play(id); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.pad')) { e.preventDefault(); play(e.target.closest('.pad').dataset.id); }
  });

  $('#startBtn').addEventListener('click', async () => { await initAudio(); $('#start').hidden = true; });

  /* ---------- aurora reacts to level ---------- */
  const disp = $('#disp'), turb = $('#turb'), svg = $('#aurora');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lvl = 0, frame = 0;
  function tick(ts) {
    requestAnimationFrame(tick);
    if (!A || still) return;
    if (++frame % 2) return;
    const m = A.meter.getValue();
    const raw = Array.isArray(m) ? Math.max(...m) : m;
    lvl += (Math.min(1, raw * 2.2) - lvl) * 0.35;
    disp.setAttribute('scale', (380 + lvl * 360).toFixed(0));
    const fx = 0.0035 + Math.sin(ts / 4000) * 0.0005;
    turb.setAttribute('baseFrequency', `${fx.toFixed(5)} 0.011`);
    svg.style.filter = `brightness(${(1 + lvl * 0.6).toFixed(2)}) saturate(${(1 + lvl * 0.5).toFixed(2)})`;
  }
  requestAnimationFrame(tick);

  setBpm(130); updateOutputs();
})();

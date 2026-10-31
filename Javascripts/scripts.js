(() => {
  // note names are Russian too, short with ♯ so they fit on the pads
  const NOTES = ['до', 'до♯', 'ре', 'ре♯', 'ми', 'фа', 'фа♯', 'соль', 'соль♯', 'ля', 'ля♯', 'си'];
  const COW_DEG = [0, 3, 5, 7, 10, 12];
  const COW_LBL = ['1', 'b3', '4', '5', 'b7', '8'];
  const COW_KEYS = ['a','s','d','f','g','h'];
  const DRUMS = [['kick','Kick','q'],['clap','Clap','w'],['hat','Хэт','e'],['ohat','Откр.','r'],['roll','Ролл','t'],['impact','Impact','y']];
  const BASS = [['root','Тоника','z',0],['fifth','Квинта','x',7],['oct','Октава','c',12],['glide','Глайд','v',0]];

  // tonality names in the header spell the sharp out
  const KEY_NAMES = ['до', 'до-диез', 'ре', 'ре-диез', 'ми', 'фа', 'фа-диез', 'соль', 'соль-диез', 'ля', 'ля-диез', 'си'];
  const state = { bpm: 130, vol: 34, key: 3, glide: 0.25 }; // D# minor, master at −9.4 dB
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
    // WebAudio's compressor adds its own makeup gain, so lowering a limiter threshold
    // barely lowers the peaks; the limiter catches overs and a gain after it sets the ceiling
    const ceiling = new Tone.Gain(1).connect(master);
    const limiter = new Tone.Limiter(-1).connect(ceiling);
    const comp = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.15 }).connect(limiter);

    // mixer channels: every bus ends in its own strip (volume, pan, mute, solo) before the comp.
    // Tone.Channel defaults to channelCount 1, which would fold the stereo reverbs to mono
    // and drop the centre 3 dB; 2 keeps 0 dB on the fader sounding exactly like before
    const channel = () => {
      const ch = new Tone.Channel({ channelCount: 2 }).connect(comp);
      const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
      ch.connect(meter);
      return [ch, meter];
    };
    const [chCow, meterCow] = channel();
    const [ch808, meter808] = channel();
    const [chDrums, meterDrums] = channel();

    // synth bus (the ids stay "cow" from the cowbell days)
    const cowRev = new Tone.Reverb({ decay: 2.5, preDelay: 0.02, wet: 0.35 }).connect(chCow);
    const cowDist = new Tone.Distortion({ distortion: 0.4, wet: 0.6, oversample: '2x' }).connect(cowRev);
    const cowIn = new Tone.Gain(0.55).connect(cowDist);

    // 808 bus
    const bassFilter = new Tone.Filter({ frequency: 1200, type: 'lowpass', rolloff: -24 }).connect(ch808);
    const bassDist = new Tone.Distortion({ distortion: 0.55, wet: 0.7, oversample: '4x' }).connect(bassFilter);
    const bassGrit = new Tone.Distortion({ distortion: 0.35, wet: 0.6, oversample: '2x' }).connect(bassDist);
    const bass = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 2.5, oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 1.6, sustain: 0, release: 0.1 }, volume: -6.3 }).connect(bassGrit);
    const glide = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.003, decay: 1.6, sustain: 0, release: 0.1 }, volume: -6.3 }).connect(bassGrit);

    // drums bus
    const drumRev = new Tone.Reverb({ decay: 1.2, wet: 0.15 }).connect(chDrums);
    const crushMix = new Tone.CrossFade(0).connect(drumRev);
    const crusher = new Tone.WaveShaper(crushCurve(6)).connect(crushMix.b);
    const drumIn = new Tone.Gain(1);
    drumIn.connect(crushMix.a); drumIn.connect(crusher);
    const kickDrive = new Tone.Distortion({ distortion: 0.3, wet: 0.5 }).connect(drumIn);
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.09, octaves: 7, envelope: { attack: 0.001, decay: 0.55, sustain: 0, release: 0.05 }, volume: -5.8 }).connect(kickDrive);
    const clapBp = new Tone.Filter({ frequency: 1300, type: 'bandpass', Q: 1.2 }).connect(drumIn);
    const clap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.14, sustain: 0 }, volume: -4 }).connect(clapBp);
    const hatHp = new Tone.Filter({ frequency: 7000, type: 'highpass' }).connect(drumIn);
    const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -10 }).connect(hatHp);
    const ohat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.03 }, volume: -12 }).connect(hatHp);
    // impact keeps its own long reverb but still belongs to the drums strip
    const impRev = new Tone.Reverb({ decay: 4, wet: 0.65 }).connect(chDrums);
    const impNoise = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 1.6, sustain: 0 }, volume: -8 }).connect(impRev);
    const impBoom = new Tone.MembraneSynth({ pitchDecay: 0.2, octaves: 4, envelope: { attack: 0.001, decay: 1.5, sustain: 0 }, volume: -2 }).connect(impRev);

    Tone.Transport.bpm.value = state.bpm;
    A = { master, meter, limiter, ceiling, comp, chCow, ch808, chDrums, meterCow, meter808, meterDrums, cowRev, cowDist, cowIn, bassFilter, bassDist, bass, glide, drumRev, crushMix, crusher, kick, clap, hat, ohat, impNoise, impBoom };
    applyAll();
    applyMixer();
    return A;
  }

  // synth pluck: three detuned saws and a sub triangle, the low-pass closes right after the attack
  function pluck(freq, t) {
    const env = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.6, sustain: 0, release: 0.05 }).connect(A.cowIn);
    const lp = new Tone.Filter({ type: 'lowpass', rolloff: -24, Q: 1.5 }).connect(env);
    const saw = new Tone.FatOscillator({ frequency: freq, type: 'sawtooth', count: 3, spread: 24 }).connect(lp);
    const sub = new Tone.Oscillator(freq / 2, 'triangle').connect(lp);
    saw.volume.value = -3.5; sub.volume.value = -1.5;
    lp.frequency.setValueAtTime(freq * 9, t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.32);
    saw.start(t); sub.start(t); env.triggerAttackRelease(0.55, t);
    saw.stop(t + 0.9); sub.stop(t + 0.9);
    setTimeout(() => [saw, sub, lp, env].forEach((n) => n.dispose()), 2000);
  }

  // a monophonic noise synth needs strictly increasing start times, so keep them apart per synth
  const lastStart = new Map();
  const after = (synth, t) => { const s = Math.max(t, (lastStart.get(synth) || 0) + 0.005); lastStart.set(synth, s); return s; };

  async function play(id) {
    await initAudio();
    flash(id);
    trigger(id, Tone.now() + 0.005);
  }

  // until: the roll stops there, so the next written hat is not pushed back by it
  function trigger(id, t, until) {
    t = Math.max(t, Tone.context.currentTime + 0.002); // a late event must not land in the past
    if (id.startsWith('cow')) {
      const i = Number(id.slice(3));
      pluck(midiToHz(60 + state.key + COW_DEG[i]), t);
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
      case 'clap': for (let k = 0; k < 3; k++) A.clap.triggerAttackRelease(0.14, after(A.clap, t + k * 0.011)); break;
      case 'hat': A.ohat.triggerRelease(t); A.hat.triggerAttackRelease(0.05, after(A.hat, t)); break;
      case 'ohat': A.ohat.triggerAttackRelease(0.45, after(A.ohat, t)); break;
      case 'roll': {
        const step = 60 / state.bpm / 6;
        for (let k = 0; k < 6 && !(until && t + k * step > until - 0.01); k++) A.hat.triggerAttackRelease(0.04, after(A.hat, t + k * step));
        break;
      }
      case 'impact': A.impBoom.triggerAttackRelease('C1', 1.2, t); A.impNoise.triggerAttackRelease(1.6, after(A.impNoise, t)); break;
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
    A.limiter.threshold.value = fxOn.limiter ? -1 : 0;
    A.ceiling.gain.rampTo(fxOn.limiter ? Tone.dbToGain(-12 + val('limiter.ceiling') * 12) : 1, 0.05);
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
    if (A) Tone.Transport.bpm.value = state.bpm;
  }
  function setVol(v) {
    state.vol = Math.max(0, Math.min(100, v));
    $('#vol').value = state.vol; $('#volLabel').textContent = state.vol;
    // the master strip drives the same state.vol as the corner control
    const s = strip('master'), fader = $('.strip-fader', s);
    fader.value = state.vol;
    const txt = fmtDb(state.vol === 0 ? -Infinity : 20 * Math.log10(state.vol / 100));
    $('.strip-value', s).textContent = txt; fader.setAttribute('aria-valuetext', txt);
    applyAll();
  }
  $('#bpm').addEventListener('input', (e) => setBpm(Number(e.target.value)));
  $('#vol').addEventListener('input', (e) => setVol(Number(e.target.value)));
  $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.dir);
    if (b.dataset.step === 'bpm') setBpm(state.bpm + d); else setVol(state.vol + d * 5);
  }));
  /* ---------- mixer ---------- */
  const STRIPS = { cow: 'chCow', drums: 'chDrums', '808': 'ch808' };
  const MUTE_KEYS = { 1: 'cow', 2: 'drums', 3: '808' };
  const FADER_FLOOR = -60; // the bottom of the fader means −∞
  const strip = (ch) => $(`.strip[data-ch="${ch}"]`);
  const pressed = (b) => b.getAttribute('aria-pressed') === 'true';
  const fmtDb = (db) => db <= FADER_FLOOR ? '−∞ дБ' : `${db > 0.04 ? '+' : db < -0.04 ? '−' : ''}${Math.abs(db).toFixed(1)} дБ`;
  const fmtPan = (p) => p === 0 ? 'C' : `${p < 0 ? 'L' : 'R'} ${Math.abs(p)}`;

  function applyStrip(ch) {
    const s = strip(ch), fader = $('.strip-fader', s), pan = $('.strip-pan', s);
    const db = Number(fader.value), p = Number(pan.value);
    const dbTxt = fmtDb(db), panTxt = fmtPan(p);
    $('.strip-value', s).textContent = dbTxt; fader.setAttribute('aria-valuetext', dbTxt);
    $('.strip-pan-value', s).textContent = panTxt; pan.setAttribute('aria-valuetext', panTxt === 'C' ? 'центр' : panTxt);
    if (!A) return;
    const c = A[STRIPS[ch]];
    c.volume.rampTo(db <= FADER_FLOOR ? -Infinity : db, 0.05);
    c.pan.rampTo(p / 100, 0.05);
    c.mute = pressed($('.strip-mute', s));
    c.solo = pressed($('.strip-solo', s));
  }
  function applyMixer() {
    const chs = Object.keys(STRIPS);
    chs.forEach(applyStrip);
    // the sequencer's M and S are the same switches as the mixer's
    $$('.seq-mute, .seq-solo').forEach((b) => b.setAttribute('aria-pressed', String(pressed($(b.classList.contains('seq-mute') ? '.strip-mute' : '.strip-solo', strip(b.dataset.ch))))));
    // dim strips that are silent: muted, or left out while another strip is soloed
    const anySolo = chs.some((ch) => pressed($('.strip-solo', strip(ch))));
    chs.forEach((ch) => {
      const s = strip(ch);
      const silent = pressed($('.strip-mute', s)) || (anySolo && !pressed($('.strip-solo', s)));
      s.classList.toggle('is-silent', silent);
      const g = $(`.seq-group[data-ch="${ch}"]`);
      if (g) g.classList.toggle('is-silent', silent);
    });
  }
  function toggleButton(b) {
    b.setAttribute('aria-pressed', String(!pressed(b)));
    applyMixer();
  }

  Object.keys(STRIPS).forEach((ch) => {
    const s = strip(ch);
    [['.strip-fader', 0], ['.strip-pan', 0]].forEach(([sel, home]) => {
      const inp = $(sel, s);
      inp.addEventListener('input', () => applyStrip(ch));
      inp.addEventListener('dblclick', () => { inp.value = home; applyStrip(ch); });
    });
    $$('.strip-mute, .strip-solo', s).forEach((b) => b.addEventListener('click', () => toggleButton(b)));
  });
  const masterFader = $('.strip-fader', strip('master'));
  masterFader.addEventListener('input', () => setVol(Number(masterFader.value)));
  masterFader.addEventListener('dblclick', () => setVol(100));

  function setKey(k) { state.key = (k + 12) % 12; $('#keyName').textContent = `${KEY_NAMES[state.key]} минор`; renderCowPads(); renderSeqNotes(); }
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
    if (e.target.matches('input:not([type=range])')) return; // sliders keep focus after a drag, letters must still play
    if (MUTE_KEYS[e.key]) { e.preventDefault(); toggleButton($('.strip-mute', strip(MUTE_KEYS[e.key]))); return; }
    const id = keyMap[e.key.toLowerCase()];
    if (id) { e.preventDefault(); play(id); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.pad')) { e.preventDefault(); play(e.target.closest('.pad').dataset.id); }
  });

  /* ---------- sequencer: 16 steps of 1/16, the loop that ▶ plays ---------- */
  const STEPS = 16;
  const SEQ_GROUPS = [
    { ch: 'cow', bus: 'bus-cow', title: 'СИНТ', rows: COW_DEG.map((d, i) => ({ id: 'cow' + i, sub: COW_LBL[i], key: COW_KEYS[i] })) },
    { ch: 'drums', bus: 'bus-drums', title: 'УДАРНЫЕ', rows: DRUMS.map(([id, n, k]) => ({ id, name: id === 'ohat' ? 'Откр. хэт' : n, key: k })) },
    { ch: '808', bus: 'bus-808', title: '808', rows: BASS.map(([id, n, k]) => ({ id: 'b_' + id, name: n, key: k })) },
  ];
  // step numbers count from 1. A is the pattern from the design; B–D follow the mood of the
  // sections of «shiratoki!» (130 BPM, E minor, Em → G → Cmaj7), E–G the mood of «Montagem Solar
  // Atmosfera» (142 BPM, A minor, F → C → Am → E), played with our own sounds.
  // bpm and key (index in NOTES) are applied when the pattern is chosen, the mood depends on them
  const PATTERNS = {
    A: { name: 'Базовый', bpm: 130, key: 3, notes: {
      cow1: [12], cow2: [11, 13], cow3: [4, 9, 15], cow4: [3, 7], cow5: [1, 5],
      kick: [1, 7, 11], clap: [5, 13], hat: [1, 3, 5, 7, 9, 11, 13], ohat: [15], roll: [16], impact: [1],
      b_root: [1], b_fifth: [11], b_oct: [15], b_glide: [7],
    } },
    // intro: a lone 8th-note arpeggio, root–fifth–octave over the minor chord, then the relative major
    B: { name: 'Интро', bpm: 130, key: 4, notes: {
      cow0: [1, 7], cow3: [3, 11], cow5: [5], cow1: [9, 15], cow4: [13],
    } },
    // 0:14: the same arpeggio over a pitch-dropping kick on every beat, doubled by the 808
    C: { name: 'Бит', bpm: 130, key: 4, notes: {
      cow0: [1, 7], cow3: [3, 11], cow5: [5], cow1: [9, 15], cow4: [13],
      kick: [1, 5, 9, 13],
      b_root: [1, 5, 9], b_glide: [13],
    } },
    // drop: four on the floor, 8th hats, claps on 1, 9 and 11, 808 on every beat and a sparse lead
    D: { name: 'Дроп', bpm: 130, key: 4, notes: {
      cow5: [1], cow4: [7], cow3: [11], cow1: [14],
      kick: [1, 5, 9, 13], clap: [1, 9, 11], hat: [1, 3, 5, 7, 9, 11, 13], ohat: [15],
      b_root: [1, 5], b_fifth: [9], b_glide: [13],
    } },
    // montagem intro: a lone three-note motif on 1, 5 and 10, answered on 14
    E: { name: 'Атмосфера', bpm: 142, key: 9, notes: {
      cow0: [1], cow3: [5], cow4: [10], cow1: [14],
    } },
    // break: the motif over a syncopated kick without bass, a clap and a roll into the drop
    F: { name: 'Брейк', bpm: 142, key: 9, notes: {
      cow0: [1], cow3: [5], cow4: [10], cow1: [14],
      kick: [1, 5, 9, 11, 13], clap: [12], roll: [16],
    } },
    // drop: punchy kick on every beat, the 808 pumps on 1, 4, 9, 13 (root, then fifth) under the motif
    G: { name: 'Солар', bpm: 142, key: 9, notes: {
      cow0: [1], cow3: [5], cow4: [10], cow1: [14],
      kick: [1, 5, 9, 13],
      b_root: [1, 4], b_fifth: [9, 13],
    } },
  };
  // every pattern keeps its own grid, so edits survive switching back and forth
  const banks = {};
  Object.entries(PATTERNS).forEach(([k, p]) => {
    banks[k] = {};
    SEQ_GROUPS.forEach((g) => g.rows.forEach((r) => { banks[k][r.id] = Array.from({ length: STEPS }, (_, s) => (p.notes[r.id] || []).includes(s + 1)); }));
  });
  let current = 'A';
  let pattern = banks[current];

  const seqCols = Array.from({ length: STEPS }, () => []); // every element of a step column, for the playhead
  const isBeat = (s) => s % 4 === 0;
  function addSteps(parent, make) {
    for (let s = 0; s < STEPS; s++) {
      if (s && isBeat(s)) parent.appendChild(Object.assign(document.createElement('span'), { className: 'seq-gap' }));
      const el = make(s);
      el.classList.toggle('is-beat', isBeat(s));
      parent.appendChild(el);
      seqCols[s].push(el);
    }
  }
  addSteps($('#seqTimeline'), () => Object.assign(document.createElement('div'), { className: 'seq-col' }));
  addSteps($('#seqNums'), (s) => Object.assign(document.createElement('span'), { textContent: s + 1 }));

  SEQ_GROUPS.forEach((g) => {
    const group = document.createElement('div');
    group.className = `seq-group ${g.bus}`;
    group.dataset.ch = g.ch;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', g.title);
    const gen = { cow: 'синт', drums: 'ударные', '808': '808' }[g.ch];
    group.innerHTML = `<div class="seq-group-head"><span class="sw"></span><span class="card-title">${g.title}</span>`
      + `<button class="seq-mute" data-ch="${g.ch}" aria-pressed="false" aria-label="Заглушить ${gen}">M</button>`
      + `<button class="seq-solo" data-ch="${g.ch}" aria-pressed="false" aria-label="Соло: ${gen}">S</button></div>`;
    g.rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'seq-cols seq-row';
      row.innerHTML = `<div class="seq-label"><span><span class="seq-name" data-row="${r.id}">${r.name || ''}</span>${r.sub ? `<span class="seq-sub">${r.sub}</span>` : ''}</span><kbd class="seq-key">${r.key.toUpperCase()}</kbd></div>`;
      addSteps(row, (s) => {
        const b = document.createElement('button');
        b.className = 'seq-step';
        b.dataset.row = r.id;
        b.dataset.step = s;
        b.setAttribute('aria-pressed', String(pattern[r.id][s]));
        return b;
      });
      group.appendChild(row);
    });
    $('#seqGrid').appendChild(group);
  });
  function renderSeqNotes() {
    COW_DEG.forEach((d, i) => { $(`.seq-name[data-row="cow${i}"]`).textContent = NOTES[(state.key + d) % 12]; });
    $$('.seq-step').forEach((b) => {
      const name = $(`.seq-name[data-row="${b.dataset.row}"]`).textContent;
      const sub = b.dataset.row.startsWith('cow') ? ' ' + COW_LBL[Number(b.dataset.row.slice(3))] : '';
      b.setAttribute('aria-label', `${name}${sub}, шаг ${Number(b.dataset.step) + 1}`);
    });
  }
  renderSeqNotes();

  $('#seqGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.seq-step');
    if (b) {
      const on = !pattern[b.dataset.row][b.dataset.step];
      pattern[b.dataset.row][b.dataset.step] = on;
      b.setAttribute('aria-pressed', String(on));
      return;
    }
    const ms = e.target.closest('.seq-mute, .seq-solo');
    if (ms) toggleButton($(ms.classList.contains('seq-mute') ? '.strip-mute' : '.strip-solo', strip(ms.dataset.ch)));
  });

  function selectPattern(k) {
    current = k;
    pattern = banks[k];
    $$('.seq-step').forEach((b) => b.setAttribute('aria-pressed', String(pattern[b.dataset.row][b.dataset.step])));
    $$('[data-pattern]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pattern === k)));
    $('#seqPatternKey').textContent = k;
    $('#seqPatternName').textContent = PATTERNS[k].name;
    setBpm(PATTERNS[k].bpm);
    setKey(PATTERNS[k].key);
  }
  $$('[data-pattern]').forEach((b) => b.addEventListener('click', () => selectPattern(b.dataset.pattern)));
  selectPattern('A');

  let playhead = 0;
  function setPlayhead(s) {
    seqCols[playhead].forEach((el) => el.classList.remove('is-playhead'));
    seqCols[s].forEach((el) => el.classList.add('is-playhead'));
    playhead = s;
    $('#seqStepNum').textContent = String(s + 1).padStart(2, '0');
  }
  setPlayhead(0);

  // the roll runs until the next written hat or roll, at most one beat
  function rollUntil(s, time) {
    const sixteenth = Tone.Time('16n').toSeconds();
    for (let k = 1; k < 4; k++) {
      const n = (s + k) % STEPS;
      if (pattern.hat[n] || pattern.roll[n]) return time + k * sixteenth;
    }
    return undefined;
  }

  let loopId = null, loopStep = 0;
  function startLoop() {
    if (loopId === null) {
      loopStep = 0;
      loopId = Tone.Transport.scheduleRepeat((time) => {
        const s = loopStep;
        SEQ_GROUPS.forEach((g) => g.rows.forEach((r) => {
          if (!pattern[r.id][s]) return;
          trigger(r.id, time, r.id === 'roll' ? rollUntil(s, time) : undefined);
          Tone.Draw.schedule(() => flash(r.id), time);
        }));
        Tone.Draw.schedule(() => setPlayhead(s), time);
        loopStep = (s + 1) % STEPS;
      }, '16n');
    }
    // pads want the shortest latency, the loop needs headroom to stay in time
    Tone.context.lookAhead = 0.06;
    Tone.Transport.start('+0.05');
  }

  /* ---------- screen tabs ---------- */
  const tabs = $$('.tab');
  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t)));
  $('.tabs').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (next) { e.preventDefault(); selectTab(tabs[(i + next + tabs.length) % tabs.length], true); }
  });

  // one of three states: stopped (both up), playing (play down), paused (pause down)
  function setTransportUi(mode) {
    $('#playBtn').setAttribute('aria-pressed', String(mode === 'playing'));
    $('#pauseBtn').setAttribute('aria-pressed', String(mode === 'paused'));
  }
  function pauseLoop() {
    Tone.Transport.pause();
    Tone.context.lookAhead = 0.01;
    setTransportUi('paused');
  }

  $('#playBtn').addEventListener('click', async () => {
    await initAudio();
    $('#start').hidden = true;
    if (Tone.Transport.state === 'started') { pauseLoop(); return; }
    startLoop();
    setTransportUi('playing');
  });
  $('#pauseBtn').addEventListener('click', () => {
    if (!A) return;
    const s = Tone.Transport.state;
    if (s === 'started') pauseLoop();
    else if (s === 'paused') { startLoop(); setTransportUi('playing'); }
  });

  $('#startBtn').addEventListener('click', async () => { await initAudio(); $('#start').hidden = true; });

  /* ---------- aurora and strip meters react to level ---------- */
  const disp = $('#disp'), turb = $('#turb'), svg = $('#aurora');
  const seqDisp = $('#seqDisp'), seqSvg = $('#seqAurora');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const meterBars = ['cow', 'drums', '808', 'master'].map((ch) => [ch, $('.strip-meter span', strip(ch))]);
  const METERS = { cow: 'meterCow', drums: 'meterDrums', '808': 'meter808', master: 'meter' };
  const peak = (meter) => { const m = meter.getValue(); return Array.isArray(m) ? Math.max(...m) : m; };
  let lvl = 0, frame = 0;
  function tick(ts) {
    requestAnimationFrame(tick);
    if (!A) return;
    if (++frame % 2) return;
    // meters show −60…+6 dB, the same span as the faders
    meterBars.forEach(([ch, bar]) => {
      const v = peak(A[METERS[ch]]);
      const pos = v > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(v) - FADER_FLOOR) / (6 - FADER_FLOOR))) : 0;
      bar.style.setProperty('--level', pos.toFixed(3));
    });
    if (still) return;
    const raw = peak(A.meter);
    lvl += (Math.min(1, raw * 2.2) - lvl) * 0.35;
    disp.setAttribute('scale', (380 + lvl * 360).toFixed(0));
    const fx = 0.0035 + Math.sin(ts / 4000) * 0.0005;
    turb.setAttribute('baseFrequency', `${fx.toFixed(5)} 0.011`);
    // the nebula is pale already, so it brightens less than the old acid one did
    const glow = `brightness(${(1 + lvl * 0.3).toFixed(2)}) saturate(${(1 + lvl * 0.5).toFixed(2)})`;
    svg.style.filter = glow;
    seqSvg.style.filter = glow;
    seqDisp.setAttribute('scale', (240 + lvl * 220).toFixed(0));
  }
  requestAnimationFrame(tick);

  setBpm(130); setVol(state.vol); applyMixer();
})();

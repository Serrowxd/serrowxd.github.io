// The drone. Opt-in, synthesized in Web Audio (no asset). Exterior: sub-bass rumble + wind pulled past you,
// pitch dropping with depth. Inside the Sanctum the sound thins to a held, slowly detuning chord.
export function initAudio(button, { getS }) {
  let ctx = null, master, ext, inn, sub = [], windFilter, windGain, chord = [], on = false, interior = false;
  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    // ---- exterior bus ----
    ext = ctx.createGain(); ext.gain.value = 1; ext.connect(master);
    const subLP = ctx.createBiquadFilter(); subLP.type = 'lowpass'; subLP.frequency.value = 140; subLP.connect(ext);
    const subGain = ctx.createGain(); subGain.gain.value = 0.55; subGain.connect(subLP);
    for (const [f, g] of [[41, 0.6], [41.7, 0.5], [82.4, 0.22], [27.5, 0.35]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(subGain); o.start(); sub.push({ o, base: f });
    }
    // wind: looping noise through a wandering bandpass
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 420; windFilter.Q.value = 0.9;
    windGain = ctx.createGain(); windGain.gain.value = 0.16;
    noise.connect(windFilter); windFilter.connect(windGain); windGain.connect(ext); noise.start();
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.07; lfo.connect(lfoG); lfoG.connect(windGain.gain); lfo.start();
    // ---- interior bus: a chord that never resolves ----
    inn = ctx.createGain(); inn.gain.value = 0; inn.connect(master);
    const innLP = ctx.createBiquadFilter(); innLP.type = 'lowpass'; innLP.frequency.value = 900; innLP.connect(inn);
    for (const [f, g] of [[110, 0.35], [164.8, 0.28], [220, 0.22], [277.2, 0.16], [329.6, 0.1]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(innLP); o.start();
      const dl = ctx.createOscillator(); dl.type = 'sine'; dl.frequency.value = 0.03 + Math.random() * 0.05;
      const dg = ctx.createGain(); dg.gain.value = f * 0.004; dl.connect(dg); dg.connect(o.frequency); dl.start();
      chord.push(o);
    }
    const trem = ctx.createOscillator(); trem.frequency.value = 0.07; const tg = ctx.createGain(); tg.gain.value = 0.12; trem.connect(tg); tg.connect(innLP.frequency); trem.start();
  }
  function toggle() {
    if (!ctx) build();
    if (ctx.state === 'suspended') ctx.resume();
    on = !on;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(on ? 0.7 : 0, t, on ? 1.6 : 0.8);
    button.classList.toggle('on', on);
    button.lastChild.textContent = on ? ' drone · on' : ' drone · off';
  }
  button.addEventListener('click', toggle);
  function update() {
    if (!ctx || !on) return;
    const s = getS(), t = ctx.currentTime;
    for (const { o, base } of sub) o.frequency.setTargetAtTime(base * (1 - 0.3 * s), t, 0.5);
    windFilter.frequency.setTargetAtTime(340 + 1100 * s, t, 0.5);
    windGain.gain.setTargetAtTime(0.12 + 0.22 * s, t, 0.5);
  }
  function setInterior(v) {
    interior = v; if (!ctx) return;
    const t = ctx.currentTime;
    ext.gain.setTargetAtTime(v ? 0 : 1, t, 1.2);
    inn.gain.setTargetAtTime(v ? 1 : 0, t, 1.4);
  }
  return { update, setInterior, get on() { return on; } };
}

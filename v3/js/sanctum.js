// THE SANCTUM — inside the singularity. A faithful port of the 2D interior (v2.9) into Three:
// an iridescent particle disk clustered on the photon ring, Doppler-bright lower arc, a dark heart that grows as you fall,
// the disk tilting toward face-on with depth, the rare "naming" event (a feeling tagged on the ring + a swelling ripple),
// and the tiny self-writing affirmations that only surface at full depth.
import * as THREE from 'three';
const NS = 'http://www.w3.org/2000/svg', TAU = Math.PI * 2;
const LABELS = ['JOY', 'HOPE', 'WONDER', 'AWE', 'LOVE', 'CALM', 'PEACE', 'BLISS', 'DELIGHT', 'GRATITUDE', 'SERENITY', 'WARMTH', 'CURIOSITY', 'TENDERNESS', 'CONTENTMENT', 'ELATION', 'RELIEF', 'TRUST', 'EXCITEMENT', 'AFFECTION', 'COMFORT', 'NOSTALGIA', 'LONGING', 'WISTFULNESS'];
const AFFIRM = ['You are enough', 'You are loved', 'You belong here', 'You are safe', 'You are free', 'Rest now', 'You are home', 'Breathe', 'You are becoming', 'You did enough today'];
const svgEl = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

export function initSanctum({ renderer, renderPass, bloom, lens, audio, black, onExit }) {
  const it = document.getElementById('interior');
  const tl = document.getElementById('in-tl'), tr = document.getElementById('in-tr'), br = document.getElementById('in-br');
  const surf = document.getElementById('in-surface'), cue = document.getElementById('in-cue'), mEl = document.getElementById('in-markers'), affirmEl = document.getElementById('affirm');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x03040a);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  camera.position.set(0, 0, 3.16); camera.lookAt(0, 0, 0);
  const disk = new THREE.Group(); scene.add(disk);
  const D0 = 3.16;

  // ---- the cloud ----
  const N = 42000;
  const seed = new Float32Array(N * 4), sp = new Float32Array(N);
  const rg = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let i = 0; i < N; i++) {
    seed[i * 4] = Math.random() * TAU; seed[i * 4 + 1] = Math.max(0.12, 1.0 + rg() * 0.42);
    seed[i * 4 + 2] = 0.5 + Math.random() * 0.9; seed[i * 4 + 3] = Math.random();
    sp[i] = 0.55 + 0.7 * Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('sp', new THREE.BufferAttribute(sp, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.5);
  const U = {
    uSpin: { value: 0 }, uDepth: { value: 0 }, uFade: { value: 0 }, uBreath: { value: 1 }, uFocal: { value: 600 }, uPixelRatio: { value: renderer.getPixelRatio() },
    uRip: { value: new THREE.Vector4(0, 0, 0, 0) }, uRipParam: { value: new THREE.Vector3(0.5, 0, 0.2) }, uRipCol: { value: new THREE.Vector3(1, 1, 1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 seed; attribute float sp;
      uniform float uSpin, uDepth, uFade, uBreath, uFocal, uPixelRatio;
      uniform vec4 uRip; uniform vec3 uRipParam, uRipCol;
      varying vec3 vCol; varying float vAlpha;
      vec3 hsl2rgb(vec3 c){ vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); return c.z + c.y*(rgb-0.5)*(1.0-abs(2.0*c.z-1.0)); }
      void main(){
        float a = seed.x + uSpin * sp; float rr = seed.y;
        float ringB = exp(-((rr-1.0)*(rr-1.0))/(2.0*0.22*0.22));
        float dopp = 0.55 + 0.65*(0.5 + 0.5*cos(a - 1.5708));
        float b = ringB * dopp * (0.8 + uDepth*0.5);
        vec2 p2 = vec2(cos(a), -sin(a)) * rr;
        float al = b*0.7*uBreath*uFade, flashI = 0.0;
        if (uRip.w > 0.0) {
          vec2 dv = p2 - uRip.xy; float dd = length(dv) + 0.001;
          float env = exp(-((dd-uRip.z)*(dd-uRip.z))/(2.0*uRipParam.x*uRipParam.x));
          p2 += dv/dd * env * uRip.w; al += env*0.22*uFade;
          flashI = uRipParam.y * exp(-(dd*dd)/(2.0*uRipParam.z*uRipParam.z));
        }
        vec3 col = (b > 0.85 && rr < 1.02) ? hsl2rgb(vec3(42.0/360.0, 0.82, 0.58 + 0.22*ringB))
                 : hsl2rgb(vec3((188.0 + 72.0*sin((seed.w + a*0.03)*6.2831853))/360.0, 0.74, 0.44 + 0.30*min(1.0, b)));
        col = mix(col, uRipCol, clamp(flashI*0.8, 0.0, 1.0));
        vCol = col; vAlpha = min(0.97, al);
        vec4 mv = modelViewMatrix * vec4(p2, 0.0, 1.0);
        gl_PointSize = (0.8 + 1.4*ringB) * seed.z * uPixelRatio * (3.16 / max(0.2, -mv.z)) * 2.6;
        gl_Position = (b < 0.025) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float; varying vec3 vCol; varying float vAlpha;
      void main(){ vec2 c = gl_PointCoord - 0.5; float q = length(c)*2.0; float a = smoothstep(1.0, 0.2, q); if (a < 0.01) discard; gl_FragColor = vec4(vCol * a, a * vAlpha * 0.7); }`,
  });
  const cloud = new THREE.Points(geo, mat); cloud.frustumCulled = false; disk.add(cloud);
  // ---- the dark heart: the one direction no light comes from; grows as you fall ----
  const heart = new THREE.Mesh(new THREE.CircleGeometry(0.82, 96), new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform float uFade; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = mix(0.97, 0.92, smoothstep(0.0, 0.72, d)) * (1.0 - smoothstep(0.72, 1.0, d)); gl_FragColor = vec4(vec3(2.0, 3.0, 9.0)/255.0, a * uFade); }`,
  }));
  heart.position.z = 0.02; heart.renderOrder = 2; disk.add(heart);

  // ---- state ----
  let active = false, depth = 0, target = 0, fade = 0, spin = 0, time = 0, tag = null, tagReady = false, tagTimer = 0, telT = 0, affT = 0, affirmIdx = (Math.random() * AFFIRM.length) | 0, scrollAnim = 0;
  function readScroll() { const m = it.scrollHeight - it.clientHeight; const f = m > 0 ? Math.min(1, it.scrollTop / m) : 0; target = f * f * (3 - 2 * f); }
  it.addEventListener('scroll', () => { readScroll(); revealInView(); }, { passive: true });
  function fallTo(to, dur) {
    cancelAnimationFrame(scrollAnim);
    const start = it.scrollTop, dist = to - start, t0 = performance.now();
    function step(now) { const p = Math.min(1, (now - t0) / dur); const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; it.scrollTop = start + dist * e; if (p < 1) scrollAnim = requestAnimationFrame(step); }
    scrollAnim = requestAnimationFrame(step);
  }
  it.addEventListener('wheel', () => cancelAnimationFrame(scrollAnim), { passive: true });
  if (cue) cue.addEventListener('click', () => fallTo(it.scrollHeight - it.clientHeight, 6000));
  const spyTop = it.querySelector('.in-vnav a[data-spy="sanctum"]'), spyIn = it.querySelector('.in-vnav a[data-spy="inward"]');
  if (spyTop) spyTop.addEventListener('click', () => fallTo(0, 2600));
  if (spyIn) spyIn.addEventListener('click', () => fallTo(it.scrollHeight - it.clientHeight, 6000));
  function revealInView() {
    if (surf) surf.style.opacity = Math.max(0, 1 - it.scrollTop / (innerHeight * 0.5));
    if (cue) { const o = Math.max(0, 1 - it.scrollTop / (innerHeight * 0.22)); cue.style.opacity = o; cue.style.pointerEvents = o > 0.05 ? 'auto' : 'none'; }
    const m = it.scrollHeight - it.clientHeight, f = m > 0 ? it.scrollTop / m : 0, deep = f >= 0.5;
    if (spyTop) spyTop.classList.toggle('active', !deep); if (spyIn) spyIn.classList.toggle('active', deep);
  }
  document.getElementById('resurface').addEventListener('click', () => exit());
  addEventListener('keydown', e => { if (e.key === 'Escape' && active) exit(); });

  const rnd = n => Math.floor(Math.random() * n), hx = v => ('0' + v.toString(16)).slice(-2).toUpperCase();
  function updateTel() {
    const m = it.scrollHeight - it.clientHeight, dp = m > 0 ? Math.min(1, it.scrollTop / m) : 0;
    tl.innerHTML = '◢ SPEC-00-1 // SINGULARITY\nstate · <span class="t">???</span>\nnode  0x' + hx(rnd(255)) + hx(rnd(255));
    tr.innerHTML = 'DEPTH <span class="t">∞</span>\nREDSHIFT z <span class="t">' + (0.4 + dp * 9 + Math.random()).toFixed(1) + '</span>\n<span class="r">●</span> REC ' + rnd(9999).toString().padStart(4, '0');
    br.innerHTML = 'HAWKING <span class="t">' + (Math.random() * 0.9 + 0.05).toFixed(4) + '</span> nK\nSHADOW <span class="t">' + (0.2 + dp * 0.78).toFixed(2) + '</span> r_s\n<span class="t">// WITHIN HORIZON</span>';
  }

  // ---- the naming event ----
  const v3 = new THREE.Vector3();
  function spawnTag() {
    const ta = Math.random() * TAU, zoom = 1 + depth * 1.35;
    v3.set(Math.cos(ta), -Math.sin(ta), 0); disk.localToWorld(v3); v3.project(camera);
    const tx = (v3.x * 0.5 + 0.5) * innerWidth, ty = (-v3.y * 0.5 + 0.5) * innerHeight, cxs = innerWidth / 2, cys = innerHeight / 2;
    const dx = tx - cxs, dy = ty - cys, dl = Math.hypot(dx, dy) || 1;
    const ox = Math.max(60, Math.min(innerWidth - 60, tx + dx / dl * 74)), oy = Math.max(40, Math.min(innerHeight - 40, ty + dy / dl * 74));
    const left = ox < cxs, hue = (Math.random() * 360) | 0, c = 'hsl(' + hue + ',88%,70%)';
    tag = { x: Math.cos(ta), y: -Math.sin(ta), t0: time, hue, life: 3.0, flashLife: 0.92, amp: 0.047 / zoom, speed: 1.41 / zoom, envW: 0.59 / zoom, decay: 1.33, flashSig: 0.265 / zoom };
    U.uRipCol.value.set(...new THREE.Color().setHSL(hue / 360, 0.88, 0.66).toArray());
    const g = svgEl('g', { class: 'in-mk' });
    const line = svgEl('line', { x1: ox, y1: oy, x2: tx, y2: ty, class: 'lead', stroke: c, pathLength: 1 });
    const dot = svgEl('circle', { cx: tx, cy: ty, r: 2.6, fill: c, style: 'opacity:0' });
    const lab = svgEl('text', { x: ox + (left ? -9 : 9), y: oy - 9, fill: c, 'text-anchor': left ? 'end' : 'start' });
    lab.textContent = LABELS[(Math.random() * LABELS.length) | 0];
    g.appendChild(line); g.appendChild(dot); g.appendChild(lab); mEl.appendChild(g);
    g.getBoundingClientRect(); line.style.strokeDashoffset = '0'; lab.style.opacity = '0.95'; dot.style.opacity = '0.95';
    setTimeout(() => { line.style.strokeDashoffset = '1'; lab.style.opacity = '0'; dot.style.opacity = '0'; }, 2400);
    setTimeout(() => g.remove(), 3300);
  }
  window.__tag = spawnTag;
  function writeAffirm() {
    if (depth < 0.88 || Math.random() > 0.32) return;
    const md = Math.min(innerWidth, innerHeight), ang = Math.random() * TAU, rad = Math.sqrt(Math.random()) * md * 0.4;
    const s = document.createElement('span'); s.textContent = AFFIRM[affirmIdx++ % AFFIRM.length];
    s.style.left = (innerWidth / 2 + Math.cos(ang) * rad) + 'px'; s.style.top = (innerHeight / 2 + Math.sin(ang) * rad * 0.94) + 'px';
    affirmEl.appendChild(s);
    setTimeout(() => s.classList.add('writing'), 30); setTimeout(() => s.classList.add('gone'), 3000); setTimeout(() => s.remove(), 4200);
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    U.uFocal.value = innerHeight * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(25)));
    U.uPixelRatio.value = renderer.getPixelRatio();
  }
  addEventListener('resize', resize); resize();

  function update(dt) {
    time += dt;
    depth += (target - depth) * (1 - Math.exp(-dt * 3.0));
    fade += (1 - fade) * (1 - Math.exp(-dt * 2.1));
    spin += dt * 60 * 0.0014 * (1 + depth * 1.7);
    U.uSpin.value = spin; U.uDepth.value = depth; U.uFade.value = fade; U.uBreath.value = 0.85 + 0.15 * Math.sin(time * 1.02);
    heart.material.uniforms.uFade.value = fade;
    camera.position.z = D0 / (1 + depth * 1.35);
    disk.rotation.x = Math.acos(Math.min(1, 0.80 + depth * 0.16));
    if (tag) {
      const age = time - tag.t0;
      if (age > tag.life) { tag = null; U.uRip.value.w = 0; }
      else { const onset = 1 - Math.exp(-age * 8.6); U.uRip.value.set(tag.x, tag.y, age * tag.speed, tag.amp * onset * Math.exp(-age / tag.decay)); U.uRipParam.value.set(tag.envW, Math.sin(Math.PI * Math.min(1, age / tag.flashLife)), tag.flashSig); }
    }
    tagTimer += dt; if (tagTimer > 1.5) { tagTimer = 0; if (tagReady && !tag && Math.random() < 0.35) spawnTag(); }
    telT += dt; if (telT > 0.17) { telT = 0; updateTel(); }
    affT += dt; if (affT > 4.2) { affT = 0; writeAffirm(); }
  }

  let tagReadyTimer = 0;
  function enter() {
    active = true; depth = 0; target = 0; fade = 0; tag = null; U.uRip.value.w = 0; tagReady = false;
    it.style.display = 'block'; it.scrollTop = 0; readScroll(); revealInView();
    requestAnimationFrame(() => it.classList.add('show'));
    renderPass.scene = scene; renderPass.camera = camera;
    bloom.strength = 0.75; bloom.threshold = 0.35; bloom.radius = 0.6;
    lens.uniforms.uK.value = 0.03; lens.uniforms.uCA.value = 0.012; lens.uniforms.uVig.value = 0.5; lens.uniforms.uGrain.value = 0.05;
    renderer.toneMappingExposure = 1.0;
    resize(); updateTel();
    audio.setInterior(true);
    clearTimeout(tagReadyTimer); tagReadyTimer = setTimeout(() => { tagReady = true; }, 4000);
    setTimeout(() => { black.style.opacity = 0; }, 120);
    dispatchEvent(new CustomEvent('serrow:descended'));
  }
  function exit() {
    if (!active) return;
    black.style.opacity = 1;
    setTimeout(() => {
      active = false; it.classList.remove('show'); it.style.display = 'none';
      mEl.innerHTML = ''; affirmEl.innerHTML = ''; tag = null; U.uRip.value.w = 0; clearTimeout(tagReadyTimer);
      audio.setInterior(false);
      onExit();
    }, 650);
  }
  return { enter, exit, update, get active() { return active; }, scene, camera };
}

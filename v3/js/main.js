// SERROW // SPEC-00 — DESCENT v3
// One continuous Three.js scene: the 417 funnel (Blender lookdev pass 5, params mirrored 1:1),
// GPU dust in two passes (lit far side / dark near side), orbit-descent camera driven by scroll,
// HDR bloom + lens pass, HTML codex-plates anchored to 3D points.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { NOISE_GLSL } from './noise.js';
import { initMarkers } from './markers.js';
import { initAudio } from './audio.js';
import { initBreach } from './breach.js';
import { initSanctum } from './sanctum.js';

// ---------------- params (mirror of Blender params-p5.json) ----------------
export const P = {
  L: 12, RT: 0.9, RM: 9, PW: 1.7, VB: 0.28, rings: 120, segs: 192,
  wall: { pitch: 6, ringsN: 30, distort: 1.6, grooveAmt: 0.42, noiseU: 1.4, noiseV: 34, noiseLo: 0.28, noiseHi: 0.82, flow: 0.007, warp: 0.35, shell: 1.7, density: 2.6,
    cloudScale: 0.35, cloudAmt: 0.35, radialPow: 2.4, radialFloor: 0.05, strength: 7, tg: 0.9, tgW: 0.08, nearFloor: 0.02,
    colThroat: [1, 0.68, 0.30], colMid: [1, 0.86, 0.60], colMidPos: 0.28, colRim: [0.55, 0.47, 0.36], breath: 0.018, spin: 0.009, patGamma: 1.35 },
  dust: { n: 220000, thick: 0.5, sizeMin: 0.7, sizeMax: 2.1, strength: 6.5, nearFloor: 0.10, speed: 0.02, omega: 0.045, wind: 1.8 },
  cam: { z0: 12.4, z1: 2.3, rho0: 8.38, phi0: Math.atan2(-8.0, -2.5), turns: 1.5, lensH: 84, fwd0: 1.4, right0: -2.31, zt0: 4.0, zt1: 0.5 },
  bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 },
  plates: { dist: 6.2, right: -2.3, up: 0.25, win: 0.13, core: 0.05 },
};
const TAU = Math.PI * 2;
const R = v => v < 0 ? P.RT * Math.pow(0.22, -v / P.VB) : P.RT + (P.RM - P.RT) * Math.pow(v, P.PW);

// ---------------- renderer ----------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); }, false);
canvas.addEventListener('webglcontextrestored', () => { location.reload(); }, false);
let quality = 1.0;                                   // adaptive: 1 → 0.55 when the GPU can't hold ~45fps
function applyPixelRatio() { const cap = Math.min(1, 1600 / innerWidth); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * cap * quality); }
applyPixelRatio();
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(54, 1, 0.05, 200);
camera.up.set(0, 0, 1);

// ---------------- funnel wall ----------------
function funnelGeometry() {
  const { rings, segs, L } = P, cols = segs + 1;
  const pos = new Float32Array((rings + 1) * cols * 3), uv = new Float32Array((rings + 1) * cols * 2);
  for (let i = 0; i <= rings; i++) {
    const t = -P.VB + (1 + P.VB) * i / rings, z = t * L, r = R(t);
    for (let j = 0; j <= segs; j++) {
      const a = TAU * j / segs, k = i * cols + j;
      pos[k * 3] = r * Math.cos(a); pos[k * 3 + 1] = r * Math.sin(a); pos[k * 3 + 2] = z;
      uv[k * 2] = j / segs; uv[k * 2 + 1] = t;
    }
  }
  const idx = [];
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * cols + j, b = a + 1, c = (i + 1) * cols + j + 1, d = (i + 1) * cols + j;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const W = P.wall;
const wallUniforms = {
  uTime: { value: 0 }, uL: { value: P.L }, uCamAz: { value: new THREE.Vector2(0, -1) }, uSpin: { value: 0 },
  uFlow: { value: W.flow }, uWarp: { value: W.warp }, uRT: { value: P.RT }, uRM: { value: P.RM }, uPW: { value: P.PW }, uVB: { value: P.VB }, uShell: { value: W.shell }, uDensity: { value: W.density },
  uPitch: { value: W.pitch }, uRingsN: { value: W.ringsN }, uDistort: { value: W.distort }, uGrooveAmt: { value: W.grooveAmt },
  uNoiseU: { value: W.noiseU }, uNoiseV: { value: W.noiseV }, uNoiseLo: { value: W.noiseLo }, uNoiseHi: { value: W.noiseHi },
  uCloudScale: { value: W.cloudScale }, uCloudAmt: { value: W.cloudAmt },
  uRadialPow: { value: W.radialPow }, uRadialFloor: { value: W.radialFloor }, uStrength: { value: W.strength },
  uTg: { value: W.tg }, uTgW: { value: W.tgW }, uNearFloor: { value: W.nearFloor }, uBreath: { value: W.breath }, uPatGamma: { value: W.patGamma },
  uColThroat: { value: new THREE.Vector3(...W.colThroat) }, uColMid: { value: new THREE.Vector3(...W.colMid) },
  uColMidPos: { value: W.colMidPos }, uColRim: { value: new THREE.Vector3(...W.colRim) },
};
const RAMP_GLSL = `
vec3 ramp(float v){
  float a = smoothstep(0.0, uColMidPos, v);
  float b = smoothstep(uColMidPos, 1.0, v);
  return v < uColMidPos ? mix(uColThroat, uColMid, a) : mix(uColMid, uColRim, b);
}`;
const wallMat = new THREE.ShaderMaterial({
  uniforms: wallUniforms, side: THREE.DoubleSide,
  vertexShader: `
    uniform float uTime, uL, uBreath;
    varying vec3 vPos; varying vec2 vUv;
    void main(){
      float v = position.z / uL; float ang = atan(position.y, position.x);
      float br = 1.0 + uBreath * (0.6*sin(uTime*0.23 + v*5.0) + 0.4*sin(uTime*0.17 + ang*2.0 + v*3.0));
      vec3 p = vec3(position.xy * br, position.z);
      vPos = p; vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  // volumetric dust shell: march back from the wall surface toward the camera through a thin cloud
  fragmentShader: `
    precision highp float;
    ${NOISE_GLSL}
    #define STEPS 6
    uniform float uTime, uL, uSpin, uPitch, uRingsN, uDistort, uGrooveAmt, uNoiseU, uNoiseV, uNoiseLo, uNoiseHi;
    uniform float uCloudScale, uCloudAmt, uRadialPow, uRadialFloor, uStrength, uTg, uTgW, uNearFloor, uColMidPos, uPatGamma, uFlow, uWarp;
    uniform float uRT, uRM, uPW, uVB, uShell, uDensity;
    uniform vec2 uCamAz;
    uniform vec3 uColThroat, uColMid, uColRim;
    varying vec3 vPos; varying vec2 vUv;
    ${RAMP_GLSL}
    float fbm2(vec3 p){ return 0.5 + 0.5*(0.62*snoise(p) + 0.38*snoise(p*2.1 + 5.3)); }
    float Rf(float v){ return v < 0.0 ? uRT * pow(0.22, -v/uVB) : uRT + (uRM-uRT)*pow(v, uPW); }
    // dust density at a point in the funnel frame
    float density(vec3 p, float warp, out float vOut){
      float v = p.z / uL; vOut = v;
      float vc = clamp(v, 0.0, 1.0);
      float rho = length(p.xy);
      float dd = (Rf(v) - rho) / uShell;                 // 0 at the wall, 1 at the inner edge of the shell
      if (dd < 0.0 || dd > 1.0) return 0.0;
      float u = atan(p.y, p.x) / 6.2831853 - uSpin;      // rotates WITH the dust (counter-clockwise from above)
      float cu = cos(u*6.2831853), su_ = sin(u*6.2831853);
      float fv = vc + uTime*uFlow;                        // feeding: features march toward the throat
      float churn = uDistort * 0.3 * snoise(vec3(cu*1.6, su_*1.6, fv*7.0 + uTime*0.09 + dd*0.8));
      float phase = u*uPitch + fv*uRingsN + warp + churn;
      float wave = pow(0.5 + 0.5*sin(6.2831853*phase), 1.6);
      float groove = mix(1.0-uGrooveAmt, 1.0, wave);
      float brk = smoothstep(uNoiseLo, uNoiseHi, 0.5 + 0.5*snoise(vec3(cu*uNoiseU, su_*uNoiseU, fv*uNoiseV + dd*1.3)));
      float shell = smoothstep(0.0, 0.18, dd) * (1.0 - smoothstep(0.3, 1.0, dd));
      return pow(groove * brk, uPatGamma) * shell;
    }
    void main(){
      vec3 rd = normalize(vPos - cameraPosition);
      float vs = vPos.z / uL, vsc = clamp(vs, 0.0, 1.0);
      float us = atan(vPos.y, vPos.x) / 6.2831853 - uSpin;
      float warp = uWarp * snoise(vec3(cos(us*6.2831853)*0.8, sin(us*6.2831853)*0.8, vsc*2.5 + uTime*0.06));
      float cloud = mix(1.0-uCloudAmt, 1.0, smoothstep(0.3, 0.7, fbm2(vPos*uCloudScale + vec3(0.0,0.0,uTime*0.015))));
      float tube = smoothstep(0.0, -uVB, vs);
      // the wall core behind the shell: dim, plus the throat glow and the tube light
      float dS = dot(normalize(vPos.xy), uCamAz);
      float nfS = mix(uNearFloor, 1.0, clamp((0.6 - dS)/1.1, 0.0, 1.0));
      vec3 acc = ramp(vsc) * uStrength * (0.12*nfS*(uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vsc, uRadialPow)) + uTg*exp(-vsc/uTgW)) + vec3(1.0,0.86,0.62)*uStrength*2.2*tube*tube;
      float len = uShell * 2.4, dt = len / float(STEPS);
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + 0.5) * dt;
        vec3 p = vPos - rd * t;                           // walk from the wall toward the camera (back to front)
        float v; float dens = density(p, warp, v);
        if (dens < 0.002) continue;
        float vc = clamp(v, 0.0, 1.0);
        float rad = uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vc, uRadialPow) + 1.4*smoothstep(0.0, -uVB, v);
        float d = dot(normalize(p.xy), uCamAz);
        float nf = mix(uNearFloor, 1.0, clamp((0.6 - d)/1.1, 0.0, 1.0));
        float nearCam = smoothstep(0.35, 1.6, distance(p, cameraPosition));
        vec3 col = ramp(vc) * uStrength * rad * nf * cloud;
        float a = (1.0 - exp(-dens * uDensity * dt)) * nearCam;
        acc = acc * (1.0 - a) + col * a;
      }
      gl_FragColor = vec4(acc, 1.0);
    }`,
});
const wall = new THREE.Mesh(funnelGeometry(), wallMat);
wall.renderOrder = 0;
scene.add(wall);

// ---------------- the throat: an open hole. nothing is placed in it; the tube walls carry the light ----------------

// ---------------- dust (two passes) ----------------
const D = P.dust;
function dustGeometry(n) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, P.L / 2), P.L);
  return g;
}
const dustGeo = dustGeometry(D.n);
function dustMaterial(side) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uL: { value: P.L }, uRT: { value: P.RT }, uRM: { value: P.RM }, uPW: { value: P.PW },
      uThick: { value: D.thick }, uSide: { value: side }, uVB: { value: P.VB }, uOmega: { value: D.omega }, uSpeed: { value: D.speed }, uWind: { value: D.wind },
      uSizeMin: { value: D.sizeMin }, uSizeMax: { value: D.sizeMax }, uFocal: { value: 600 }, uPixelRatio: { value: renderer.getPixelRatio() },
      uCamAz: { value: new THREE.Vector2(0, -1) }, uStrength: { value: D.strength }, uNearFloor: { value: D.nearFloor },
      uRadialPow: { value: W.radialPow }, uRadialFloor: { value: W.radialFloor }, uTg: { value: W.tg }, uTgW: { value: W.tgW },
      uColThroat: wallUniforms.uColThroat, uColMid: wallUniforms.uColMid, uColMidPos: wallUniforms.uColMidPos, uColRim: wallUniforms.uColRim,
      uGather: { value: 0 }, uScale: { value: 1 },
    },
    vertexShader: `
      attribute vec4 seed;
      uniform float uTime, uL, uRT, uRM, uPW, uThick, uSide, uOmega, uSpeed, uWind, uSizeMin, uSizeMax, uFocal, uPixelRatio, uVB;
      uniform float uStrength, uNearFloor, uRadialPow, uRadialFloor, uTg, uTgW, uColMidPos, uGather, uScale;
      uniform vec2 uCamAz; uniform vec3 uColThroat, uColMid, uColRim;
      varying float vAlpha; varying vec3 vCol; varying float vHard;
      ${RAMP_GLSL}
      float Rf(float v){ return v < 0.0 ? uRT * pow(0.22, -v/uVB) : uRT + (uRM-uRT)*pow(v, uPW); }
      void main(){
        float spd = uSpeed * mix(0.55, 1.45, seed.w);
        float ph = fract(seed.x + uTime*spd);
        float v = pow(1.0 - ph, 0.72) * (1.0 + uVB) - uVB;   // 1 (mouth) → -VB (swallowed down the tube)
        v = mix(v, 0.06 + clamp(v,0.0,1.0)*0.12, uGather);     // breach: gather at the throat rim
        float ang = seed.y*6.2831853 + uOmega*uTime + uWind*6.2831853*pow(1.0-v, 2.0);
        float vc = clamp(v, 0.0, 1.0);
        float r = Rf(v) + (seed.z-0.5)*2.0*uThick*(0.3+0.7*vc)*(v < 0.0 ? 0.35 : 1.0);
        vec3 p = vec3(r*cos(ang), r*sin(ang), v*uL);
        float d = dot(normalize(p.xy), uCamAz);
        float near = clamp((d + 0.5)/1.1, 0.0, 1.0);   // 1 = camera side (dark), 0 = far (lit)
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = length(mv.xyz);
        float sz = mix(uSizeMin, uSizeMax, fract(seed.w*7.31 + seed.z*3.7));
        gl_PointSize = sz * uScale * uPixelRatio * (uFocal / max(dist, 0.2)) * 0.01;
        gl_Position = projectionMatrix * mv;
        float a = smoothstep(-uVB, -uVB*0.55, v) * smoothstep(1.0, 0.93, v) * smoothstep(0.25*uScale, 1.6*uScale, dist);
        float rad = uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vc, uRadialPow) + 1.6*smoothstep(0.0, -uVB, v);
        float bright = uStrength * (rad*0.75 + uTg*exp(-vc/uTgW));
        vec3 base = ramp(vc);
        if (uSide < 0.5) { vCol = base * bright; vAlpha = a * (1.0-near) * 0.85; vHard = 0.0; }
        else { vCol = base * bright * uNearFloor; vAlpha = a * near * 0.9; vHard = 1.0; }
      }`,
    fragmentShader: `
      precision highp float;
      varying float vAlpha; varying vec3 vCol; varying float vHard;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float q = length(c)*2.0;
        float a = mix(smoothstep(1.0, 0.45, q), smoothstep(1.0, 0.78, q), vHard);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol, a*vAlpha);
      }`,
  });
}
const dustFar = new THREE.Points(dustGeo, dustMaterial(0)); dustFar.renderOrder = 1; dustFar.frustumCulled = false; scene.add(dustFar);
const dustNear = new THREE.Points(dustGeo, dustMaterial(1)); dustNear.renderOrder = 2; dustNear.frustumCulled = false; scene.add(dustNear);

// ---------------- post ----------------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), P.bloom.strength, P.bloom.radius, P.bloom.threshold);
composer.addPass(bloom);
const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uK: { value: 0.0 }, uCA: { value: 0.0 }, uGrain: { value: 0.05 }, uVig: { value: 0.55 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime, uK, uCA, uGrain, uVig; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 d = c * (1.0 + uK * r2);
      float ca = uCA * r2;
      float rr = texture2D(tDiffuse, 0.5 + d*(1.0 + ca)).r;
      float gg = texture2D(tDiffuse, 0.5 + d).g;
      float bb = texture2D(tDiffuse, 0.5 + d*(1.0 - ca)).b;
      vec3 col = vec3(rr, gg, bb);
      float g = hash(vUv*uRes + fract(uTime*7.3)) - 0.5;
      col += g * uGrain * (0.3 + col);
      col *= 1.0 - uVig * r2 * 1.6;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(lens);
composer.addPass(new OutputPass());

// ---------------- camera path (orbit + descent) ----------------
const C = P.cam;
const easeS = s => s * s * (3 - 2 * s);
export function camState(s) {
  const e = easeS(s);
  const z = C.z0 + (C.z1 - C.z0) * e;
  const rho = s < 0.001 ? C.rho0 : Math.min(C.rho0, R(Math.min(z / P.L, 1)) * 0.86);
  const phi = C.phi0 + s * TAU * C.turns;
  const dir = new THREE.Vector2(Math.cos(phi), Math.sin(phi));          // axis → camera (near side)
  const fwd = dir.clone().multiplyScalar(-1), right = new THREE.Vector2(fwd.y, -fwd.x);
  const pos = new THREE.Vector3(dir.x * rho, dir.y * rho, z);
  const k = Math.max(0.16, rho / C.rho0);
  const zt = C.zt0 + (C.zt1 - C.zt0) * e;
  const tx = fwd.x * C.fwd0 * k + right.x * C.right0 * k, ty = fwd.y * C.fwd0 * k + right.y * C.right0 * k;
  const target = new THREE.Vector3(tx, ty, zt);
  const roll = THREE.MathUtils.degToRad(5 * Math.sin(s * Math.PI * 1.5) - 2 * s);
  return { pos, target, roll, dir, fwd, right, z, s, rho };
}
const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpAxis = new THREE.Vector3();
function applyCam(cam, st) {
  cam.position.copy(st.pos);
  tmpM.lookAt(st.pos, st.target, cam.up); tmpQ.setFromRotationMatrix(tmpM);
  cam.quaternion.copy(tmpQ);
  tmpAxis.set(0, 0, 1).applyQuaternion(cam.quaternion);
  cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(tmpAxis, st.roll));
  cam.updateMatrixWorld();
}

// ---------------- scroll ----------------
let sTarget = 0, s = 0;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);
const track = document.getElementById('track');
function readScroll() { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); sTarget = Math.min(1, Math.max(0, scrollY / max)); }
addEventListener('scroll', readScroll, { passive: true }); readScroll();
document.querySelectorAll('.vnav a').forEach(a => a.addEventListener('click', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollTo({ top: parseFloat(a.dataset.s) * max, behavior: 'smooth' });
}));

// ---------------- plates anchored to 3D points ----------------
const plates = [...document.querySelectorAll('.plate')].map(el => {
  const si = parseFloat(el.dataset.s);
  const st = camState(si);
  const cam = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 200); cam.up.set(0, 0, 1); applyCam(cam, st);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const anchor = st.pos.clone().addScaledVector(fwd, P.plates.dist).addScaledVector(right, P.plates.right).addScaledVector(up, P.plates.up);
  return { el, si, anchor, inner: el.querySelector('.reveal'), live: false };
});
const v3 = new THREE.Vector3();
function updatePlates() {
  const vw = innerWidth, vh = innerHeight;
  for (const p of plates) {
    const ds = Math.abs(s - p.si);
    const op = 1 - THREE.MathUtils.smoothstep(ds, P.plates.core, P.plates.win);
    v3.copy(p.anchor).project(camera);
    const behind = v3.z > 1;
    const x = (v3.x * 0.5 + 0.5) * vw, y = (-v3.y * 0.5 + 0.5) * vh;
    const dist = p.anchor.distanceTo(camera.position);
    const sc = THREE.MathUtils.clamp(P.plates.dist / dist, 0.55, 1.5);
    const o = behind ? 0 : op;
    p.el.style.opacity = o.toFixed(3);
    p.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${sc.toFixed(3)})`;
    const live = o > 0.6;
    if (live !== p.live) { p.live = live; p.el.classList.toggle('live', live); if (live) p.inner.classList.add('in'); }
    if (o < 0.05) p.inner.classList.remove('in');
  }
  document.querySelectorAll('.vnav a').forEach(a => { const si = parseFloat(a.dataset.s); a.classList.toggle('active', Math.abs(s - si) < 0.11 || (si === 0 && s < 0.11)); });
}

// ---------------- chrome (driven from the scene) ----------------
const eTL = document.getElementById('e-tl'), eTR = document.getElementById('e-tr'), eBR = document.getElementById('e-br');
const surface = document.getElementById('surface'), scrolldown = document.getElementById('scrolldown');
let rec = 2197, telT = 0;
function updateChrome(st, dt) {
  telT += dt; if (telT < 0.17) return; telT = 0; rec++;
  const depth = Math.round((C.z0 - st.z) / (C.z0 - C.z1) * 9000);
  const orbit = ((THREE.MathUtils.radToDeg(st.dir.angle()) % 360) + 360) % 360;
  const infall = (0.051 + s * 0.9 + charge * 2.4 + Math.random() * 0.004).toFixed(3);
  const state = charge > 0.85 ? 'BREACH' : charge > 0.3 ? 'COUPLING' : s < 0.15 ? 'CONSUMING' : s < 0.6 ? 'INFALLING' : s < 0.9 ? 'COUPLING' : 'HORIZON';
  eTL.innerHTML = `<span class="k">◢</span> SPEC-00-2 // MAW\nstate · ${state}\norbit · <span class="g">${orbit.toFixed(1).padStart(5, '0')}°</span>`;
  eTR.innerHTML = `depth <span class="g">${String(depth).padStart(4, '0')} M</span>\ninfall <span class="g">${infall} R/S</span>\n<span class="r">●</span> REC ${rec}`;
  eBR.innerHTML = `warmth <span class="g">${(0.88 + Math.random() * 0.03).toFixed(3)}</span>\nentropy <span class="g">${(0.03 + s * 0.6 + Math.random() * 0.005).toFixed(5)}</span>\n// observing`;
  const fade = 1 - THREE.MathUtils.smoothstep(s, 0.02, 0.12);
  surface.style.opacity = fade; scrolldown.style.opacity = fade;
}

// ---------------- the Whirl (egress mark) ----------------
(function () { const el = document.getElementById('egresswhirl'); if (!el) return;
  let d = ''; const turns = 5.0, r0 = 1.0, Rw = 49, n = 320;
  for (let i = 0; i <= n; i++) { const t = i / n, th = t * turns * TAU, rad = r0 * Math.pow(Rw / r0, t);
    d += (i ? 'L' : 'M') + (60 + rad * Math.cos(th)).toFixed(1) + ' ' + (60 + rad * Math.sin(th)).toFixed(1) + ' '; }
  el.setAttribute('d', d); })();

// ---------------- resize ----------------
let baseFov = 54;
function resize() {
  const w = innerWidth, h = innerHeight;
  if (w < 2 || h < 2) return;                          // a hidden/collapsed pane reports 0×0: never allocate zero-size targets
  applyPixelRatio();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(Math.floor(w / 2), Math.floor(h / 2));
  const aspect = w / h;
  camera.aspect = aspect;
  baseFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(C.lensH / 2)) / aspect));
  camera.fov = baseFov; camera.updateProjectionMatrix();
  const focal = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  for (const m of [dustFar.material, dustNear.material]) { m.uniforms.uFocal.value = focal; m.uniforms.uPixelRatio.value = renderer.getPixelRatio(); }
  lens.uniforms.uRes.value.set(w, h);
}
addEventListener('resize', resize); resize();

// ---------------- markers · drone · breach · sanctum ----------------
let lastState = camState(0);
const markers = initMarkers({ camera, getState: () => lastState, R, L: P.L, omega: D.omega, wind: D.wind });
const audio = initAudio(document.getElementById('audio'), { getS: () => s });
const black = document.getElementById('black');
let breachT = -1, boost = 0, charge = 0, sBeforeBreach = 0;
const sanctum = initSanctum({ renderer, renderPass, bloom, lens, audio, black, onExit: () => {
  renderPass.scene = scene; renderPass.camera = camera; document.body.classList.remove('inside');
  sTarget = sBeforeBreach; s = sBeforeBreach; boost = 0; breach.rearm(); markers.clear();
  setTimeout(() => { black.style.opacity = 0; }, 80);
} });
const breach = initBreach({ camera, prompt: document.getElementById('breach'), onCharge: c => { charge = c; },
  onBreak: () => { breachT = 0; sBeforeBreach = s; boost = 1; } });
function enterSanctum() { document.body.classList.add('inside'); sanctum.enter(); }

// ---------------- loop ----------------
const clock = new THREE.Clock();
let time = 0, fpsAcc = 0, fpsN = 0, spinAcc = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta()); time += dt;
  // adaptive quality: average 40 frames, step the render scale down (or back up) to hold ~45fps
  if (document.visibilityState === 'visible' && dt < 0.049) { fpsAcc += dt; fpsN++; } else { fpsAcc = 0; fpsN = 0; }
  if (fpsN >= 40) { const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (avg > 1 / 42 && quality > 0.55) { quality = Math.max(0.55, quality - 0.15); resize(); }
    else if (avg < 1 / 70 && quality < 1) { quality = Math.min(1, quality + 0.1); resize(); } }
  if (sanctum.active) { sanctum.update(dt); audio.update(); composer.render(); requestAnimationFrame(frame); return; }
  s += (sTarget - s) * (1 - Math.exp(-dt * 3.2));
  let sEff = s;
  if (breachT >= 0) {                                   // the dam breaks: plunge to the throat, fade to black, cross
    breachT += dt / 4.2; const e = Math.min(1, breachT * breachT * breachT);
    sEff = s + (1 - s) * e;
    black.style.opacity = Math.min(1, Math.max(0, (breachT - 0.62) / 0.34));
    if (breachT >= 1) { breachT = -1; enterSanctum(); }
  }
  boost = Math.max(0, boost - dt / 1.6);
  const st = camState(sEff); lastState = st;
  applyCam(camera, st);
  camera.fov = baseFov * (1 - 0.14 * charge * charge); camera.updateProjectionMatrix();   // the field leans in while held
  spinAcc += dt * W.spin * (1 + 4 * charge * charge + 3 * boost);
  const spin = spinAcc;
  wallUniforms.uTime.value = time; wallUniforms.uSpin.value = spin; wallUniforms.uCamAz.value.copy(st.dir);
  for (const m of [dustFar.material, dustNear.material]) { m.uniforms.uTime.value = time; m.uniforms.uCamAz.value.copy(st.dir); m.uniforms.uGather.value = charge * charge * (breachT >= 0 ? 0 : 1); m.uniforms.uSpeed.value = D.speed * (1 + 2.5 * boost); }
  // lens: distortion + aberration grow with depth
  lens.uniforms.uTime.value = time;
  lens.uniforms.uK.value = 0.04 + 0.22 * s * s;
  lens.uniforms.uCA.value = 0.006 + 0.03 * s;
  lens.uniforms.uGrain.value = 0.045 + 0.03 * s;
  const expo = 1.0 / (1.0 + 4.5 * s * s);            // the eye adapts as the throat fills the frame
  wallUniforms.uStrength.value = W.strength * (1.0 - 0.35 * s);
  const kd = 0.3 + 0.7 * Math.min(1, st.rho / C.rho0);
  for (const m of [dustFar.material, dustNear.material]) { m.uniforms.uStrength.value = D.strength * (1.0 - 0.35 * s); m.uniforms.uScale.value = kd; }
  wallUniforms.uTg.value = W.tg * (1.0 - 0.6 * s);
  lens.uniforms.uVig.value = 0.55 + 0.35 * s;
  renderer.toneMappingExposure = expo;
  bloom.strength = P.bloom.strength + 0.15 * s + 0.5 * charge * charge + 0.4 * boost;
  bloom.threshold = P.bloom.threshold / expo;          // bloom only what will still read as bright after exposure
  updatePlates(); updateChrome(st, dt); markers.update(dt); breach.update(dt); audio.update();
  composer.render();
  requestAnimationFrame(frame);
}
frame();
window.__descent = { P, camState, sanctum, enterSanctum, breach, audio, markers, get s() { return s; }, set s(v) { sTarget = v; }, wallUniforms, dustFar, dustNear, bloom, lens, camera, renderer };

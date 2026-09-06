// SERROW // SPEC-00 — DESCENT v3
// One continuous Three.js scene: the 417 funnel (Blender lookdev pass 5, params mirrored 1:1) as a raymarched
// volumetric dust shell, GPU dust as velocity-stretched streaks in two passes (lit far side / dark near side),
// volumetric cloud puffs in the outer funnel, orbit-descent camera driven by scroll ending at Egress,
// HDR bloom + lens pass, HTML codex-plates anchored to 3D points, the breach as a tearing wound.
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

// ---------------- params (mirror of Blender params-p5.json + the refinement rounds) ----------------
export const P = {
  L: 12, RT: 0.9, RM: 9, PW: 1.7, VB: 0.28, VT: 0.35, rings: 132, segs: 192,
  wall: { pitch: 5, ringsN: 9, distort: 1.6, grooveAmt: 0.0, noiseU: 0.55, noiseV: 6.0, noiseLo: 0.3, noiseHi: 0.8, flow: 0.022, warp: 0.35,
    shell: 1.5, density: 2.0, billow: 0.42, cloudScale: 0.35, cloudAmt: 0.35, radialPow: 2.4, radialFloor: 0.05, strength: 7, tg: 0.9, tgW: 0.08, nearFloor: 0.05,
    colThroat: [1, 0.68, 0.30], colMid: [1, 0.86, 0.60], colMidPos: 0.28, colRim: [0.55, 0.47, 0.36], breath: 0.014, convulse: 0.04, spin: 0.009, patGamma: 1.5 },
  dust: { n: 220000, thick: 0.5, sizeMin: 0.6, sizeMax: 1.8, strength: 6.5, nearFloor: 0.07, speed: 0.02, omega: 0.045, wind: 1.8, turb: 0.1, gust: 0.6, streak: 0.12 },
  puffs: { n: 5200, sizeMin: 0.8, sizeMax: 2.0, strength: 4.2, nearFloor: 0.05, speed: 0.011, alpha: 0.24 },
  cam: { z0: 13.6, z1: 5.2, rho0: 8.9, phi0: Math.atan2(-8.0, -2.5), turns: 1.15, lensH: 84, fwd0: 1.0, right0: -2.1, zt0: 2.4, zt1: 1.0 },
  bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 },
  plates: { dist: 6.2, right: -2.3, up: 0.25, win: 0.2, core: 0.045 },
};
const TAU = Math.PI * 2;
const R = v => v < 0 ? P.RT * Math.pow(0.22, -v / P.VB) : P.RT + (P.RM - P.RT) * Math.pow(v, P.PW);

// ---------------- renderer ----------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); }, false);
canvas.addEventListener('webglcontextrestored', () => { location.reload(); }, false);
let quality = 1.0;
function applyPixelRatio() { const cap = Math.min(1, 1600 / innerWidth); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * cap * quality); }
applyPixelRatio();
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(54, 1, 0.05, 200);
camera.up.set(0, 0, 1);

// ---------------- shared GLSL ----------------
const W = P.wall, D = P.dust, Q = P.puffs;
const RAMP_GLSL = `
vec3 ramp(float v){
  float a = smoothstep(0.0, uColMidPos, v);
  float b = smoothstep(uColMidPos, 1.0, v);
  return v < uColMidPos ? mix(uColThroat, uColMid, a) : mix(uColMid, uColRim, b);
}`;
// the wall's own deformation (breath + convulsion + tear) — used by the vertex shader AND the shell density
const DEFORM_GLSL = `
float Rf(float v){ return v < 0.0 ? uRT * pow(0.22, -v/uVB) : uRT + (uRM-uRT)*pow(v, uPW); }
float deform(float ang, float v){
  float br = 1.0 + uBreath * (0.6*sin(uTime*0.23 + v*5.0) + 0.4*sin(uTime*0.17 + ang*2.0 + v*3.0));
  float cv = uConvulse * snoise(vec3(cos(ang)*1.5, sin(ang)*1.5, v*4.0 + uTime*0.35)) * (0.4 + 0.6*v);
  float tear = 1.0 + uTear * 1.8 * smoothstep(0.38, 0.0, v);
  return (br + cv) * tear;
}`;
const colorUniforms = {
  uColThroat: { value: new THREE.Vector3(...W.colThroat) }, uColMid: { value: new THREE.Vector3(...W.colMid) },
  uColMidPos: { value: W.colMidPos }, uColRim: { value: new THREE.Vector3(...W.colRim) },
};
const shapeUniforms = { uL: { value: P.L }, uRT: { value: P.RT }, uRM: { value: P.RM }, uPW: { value: P.PW }, uVB: { value: P.VB },
  uBreath: { value: W.breath }, uConvulse: { value: W.convulse }, uTear: { value: 0 }, uTime: { value: 0 } };

// ---------------- funnel wall ----------------
function funnelGeometry() {
  const { rings, segs, L } = P, cols = segs + 1;
  const pos = new Float32Array((rings + 1) * cols * 3), uv = new Float32Array((rings + 1) * cols * 2);
  for (let i = 0; i <= rings; i++) {
    const t = -P.VB + (1 + P.VB + P.VT) * i / rings, z = t * L, r = R(t);
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
const wallUniforms = {
  ...shapeUniforms, ...colorUniforms,
  uCamAz: { value: new THREE.Vector2(0, -1) }, uSpin: { value: 0 },
  uPitch: { value: W.pitch }, uRingsN: { value: W.ringsN }, uDistort: { value: W.distort }, uGrooveAmt: { value: W.grooveAmt },
  uNoiseU: { value: W.noiseU }, uNoiseV: { value: W.noiseV }, uNoiseLo: { value: W.noiseLo }, uNoiseHi: { value: W.noiseHi },
  uFlow: { value: W.flow }, uWarp: { value: W.warp }, uShell: { value: W.shell }, uDensity: { value: W.density }, uBillow: { value: W.billow },
  uCloudScale: { value: W.cloudScale }, uCloudAmt: { value: W.cloudAmt },
  uRadialPow: { value: W.radialPow }, uRadialFloor: { value: W.radialFloor }, uStrength: { value: W.strength },
  uTg: { value: W.tg }, uTgW: { value: W.tgW }, uNearFloor: { value: W.nearFloor }, uPatGamma: { value: W.patGamma },
};
const wallMat = new THREE.ShaderMaterial({
  uniforms: wallUniforms, side: THREE.DoubleSide, transparent: true, depthWrite: true,
  vertexShader: `
    ${NOISE_GLSL}
    uniform float uTime, uL, uRT, uRM, uPW, uVB, uBreath, uConvulse, uTear;
    varying vec3 vPos; varying vec2 vUv;
    ${DEFORM_GLSL}
    void main(){
      float v = position.z / uL; float ang = atan(position.y, position.x);
      float d = deform(ang, clamp(v, 0.0, 1.0));
      vec3 p = vec3(position.xy * d, position.z - uTear * 0.6 * smoothstep(0.38, 0.0, clamp(v,0.0,1.0)));
      vPos = p; vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  // volumetric dust shell: march back from the wall surface toward the camera through a thick cloud
  fragmentShader: `
    precision highp float;
    ${NOISE_GLSL}
    #define STEPS 12
    uniform float uTime, uL, uSpin, uPitch, uRingsN, uDistort, uGrooveAmt, uNoiseU, uNoiseV, uNoiseLo, uNoiseHi;
    uniform float uCloudScale, uCloudAmt, uRadialPow, uRadialFloor, uStrength, uTg, uTgW, uNearFloor, uColMidPos, uPatGamma, uFlow, uWarp;
    uniform float uRT, uRM, uPW, uVB, uShell, uDensity, uBillow, uBreath, uConvulse, uTear;
    uniform vec2 uCamAz;
    uniform vec3 uColThroat, uColMid, uColRim;
    varying vec3 vPos; varying vec2 vUv;
    ${RAMP_GLSL}
    ${DEFORM_GLSL}
    float fbm2(vec3 p){ return 0.5 + 0.5*(0.62*snoise(p) + 0.38*snoise(p*2.1 + 5.3)); }
    // dust density at a point in the funnel frame
    float density(vec3 p, float warp, out float vOut){
      float v = p.z / uL; vOut = v;
      float vc = clamp(v, 0.0, 1.0);
      float rho = length(p.xy);
      float ang = atan(p.y, p.x);
      float sh = uShell * (0.5 + 1.9*vc);                  // thin at the throat, thick billowing clouds at the mouth
      float dd = (Rf(v) * deform(ang, vc) - rho) / sh;     // 0 at the wall, 1 at the inner edge of the shell
      if (dd < 0.0 || dd > 1.0 || v > 1.25) return 0.0;
      float u = ang / 6.2831853 - uSpin;
      float cu = cos(u*6.2831853), su_ = sin(u*6.2831853);
      float flow = uFlow * (1.0 + 8.0*uTear);
      float fv = vc;                                       // grooves ride the rigid spin; no perpendicular drift (it read as counter-rotation)
      float churn = uDistort * 0.3 * snoise(vec3(cu*1.6, su_*1.6, fv*7.0 + uTime*0.09 + dd*0.8));
      float rings = uRingsN * (1.0 + 1.5*uTear);
      float phase = u*uPitch + fv*rings + warp + churn;
      float wave = pow(0.5 + 0.5*sin(6.2831853*phase), 1.6 + 2.0*uTear);
      float groove = mix(1.0 - mix(uGrooveAmt, 0.95, uTear), 1.0, wave);
      // cloud noise in real 3D space (isotropic everywhere), rotated with the spin, drifting down the axis with the feed
      float sa = uSpin*6.2831853; mat2 rot = mat2(cos(sa), -sin(sa), sin(sa), cos(sa));
      vec3 q = vec3(rot * p.xy, p.z + uTime*flow*uL*3.0);
      float brk = smoothstep(uNoiseLo, uNoiseHi, 0.5 + 0.5*snoise(q*uNoiseU + vec3(0.0, 0.0, dd*1.3)));
      float billow = fbm2(q*0.28 + vec3(0.0, 0.0, dd*1.6 + uTime*0.03));
      float shell = smoothstep(0.0, 0.16, dd) * (1.0 - smoothstep(0.28, 1.0, dd));
      float lumps = mix(0.35, 1.0, smoothstep(0.3, 0.75, billow));
      float clouds = uBillow * smoothstep(0.5, 0.95, billow) * smoothstep(0.0, 0.1, dd) * (1.0 - smoothstep(0.55, 1.0, dd)) * vc*vc;
      return pow(groove * brk, uPatGamma) * shell * lumps + clouds;
    }
    void main(){
      vec3 rd = normalize(vPos - cameraPosition);
      float vs = vPos.z / uL, vsc = clamp(vs, 0.0, 1.0);
      float rimFade = 1.0 - smoothstep(1.0, 1.32, vs);          // the wall dissolves above the mouth instead of ending
      float us = atan(vPos.y, vPos.x) / 6.2831853 - uSpin;
      float warp = uWarp * snoise(vec3(cos(us*6.2831853)*0.8, sin(us*6.2831853)*0.8, vsc*2.5 + uTime*0.06));
      float cloud = mix(1.0-uCloudAmt, 1.0, smoothstep(0.3, 0.7, fbm2(vPos*uCloudScale + vec3(0.0,0.0,uTime*0.015))));
      float tube = smoothstep(0.0, -uVB, vs);
      float dS = dot(normalize(vPos.xy), uCamAz);
      float nfS = mix(uNearFloor, 1.0, clamp((0.6 - dS)/1.1, 0.0, 1.0)); nfS += (1.0 - nfS) * 0.16 * smoothstep(0.55, 1.0, vsc);   // scattered light reaches the near lip
      vec3 acc = ramp(vsc) * uStrength * (0.12*nfS*(uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vsc, uRadialPow)) + uTg*exp(-vsc/uTgW)) + vec3(1.0,0.86,0.62)*uStrength*2.2*tube*tube;
      float aacc = 0.0;                                            // accumulated dust opacity → thin dust lets the void through
      float len = uShell * (0.5 + 1.9*vsc) * 2.4, dt = len / float(STEPS);
      float jit = fract(sin(dot(gl_FragCoord.xy + fract(uTime)*61.0, vec2(12.9898, 78.233))) * 43758.5453);
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jit) * dt;
        vec3 p = vPos - rd * t;
        float v; float dens = density(p, warp, v);
        if (dens < 0.002) continue;
        float vc = clamp(v, 0.0, 1.0);
        float rad = uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vc, uRadialPow) + 1.4*smoothstep(0.0, -uVB, v);
        float d = dot(normalize(p.xy), uCamAz);
        float nf = mix(uNearFloor, 1.0, clamp((0.6 - d)/1.1, 0.0, 1.0)); nf += (1.0 - nf) * 0.16 * smoothstep(0.55, 1.0, vc);
        float nearCam = smoothstep(0.35, 1.6, distance(p, cameraPosition));
        vec3 col = ramp(vc) * uStrength * rad * nf * cloud;
        float a = (1.0 - exp(-dens * uDensity * dt)) * nearCam;
        acc = acc * (1.0 - a) + col * a; aacc += a * (1.0 - aacc);
      }
      float farness = clamp((0.6 - dS)/1.1, 0.0, 1.0);               // only the far, lit wall thins to the void; the near wall stays solid (the tube is behind it)
      float alphaD = clamp(0.55 + 0.45*aacc + tube + uTg*exp(-vsc/uTgW)*0.5, 0.0, 1.0);
      float alpha = mix(1.0, alphaD, smoothstep(0.35, 1.0, farness)) * rimFade;
      gl_FragColor = vec4(acc * rimFade, alpha);
    }`,
});
const wall = new THREE.Mesh(funnelGeometry(), wallMat);
wall.renderOrder = 0; wall.frustumCulled = false;
scene.add(wall);

// ---------------- the throat: an open hole. nothing is placed in it; the tube walls carry the light ----------------

// ---------------- dust: velocity-stretched streak quads, two passes ----------------
// shared flow field for grains + puffs: spiral infall with per-band gusts, shear, and turbulence
const FLOW_GLSL = `
uniform float uThick, uOmega, uSpeed, uWind, uTurb, uGust, uGather;
vec3 flowPos(vec4 seed, float t, float thickScale, out float vOut){
  float band = floor(seed.z * 7.0);
  float spd = uSpeed * mix(0.55, 1.45, seed.w) * (1.0 + 4.0*uTear);
  float surge = uGust * 2.0 * max(0.0, sin(t*0.3 + band*2.1 + seed.w));          // bands plunge in bursts
  float ph = fract(seed.x + spd*(t + surge));
  float v = pow(1.0 - ph, 0.72) * (1.0 + uVB) - uVB;                              // 1 (mouth) -> -VB (swallowed)
  v = mix(v, 0.06 + clamp(v,0.0,1.0)*0.12, uGather);                              // breach charge: gather at the rim
  float vc = clamp(v, 0.0, 1.0);
  float om = uOmega * (1.0 + 0.4*sin(band*3.7));                                   // shear bands
  float ang = seed.y*6.2831853 + om*t + uWind*6.2831853*pow(1.0-v, 2.0);
  float r = Rf(v) * deform(ang, vc) - abs(seed.z-0.5)*2.0*uThick*thickScale*(0.3+0.7*vc)*(v < 0.0 ? 0.35 : 1.0);
  vec3 p = vec3(r*cos(ang), r*sin(ang), v*uL);
  // turbulence: eddies that strengthen toward the throat
  float k = uTurb * (0.25 + 2.2*pow(1.0-vc, 2.0)) * (1.0 + 3.0*uTear);
  vec3 q = p*0.9 + vec3(0.0, 0.0, t*0.6);
  p += k * vec3(snoise(q), snoise(q + 31.7), snoise(q + 77.3)*0.6);
  vOut = v; return p;
}`;
function makeDustGeometry(n) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, P.L / 2), P.L * 2);
  return g;
}
const dustGeo = makeDustGeometry(D.n);
function dustMaterial(side) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    uniforms: {
      ...shapeUniforms, ...colorUniforms,
      uThick: { value: D.thick }, uSide: { value: side }, uOmega: { value: D.omega }, uSpeed: { value: D.speed }, uWind: { value: D.wind },
      uTurb: { value: D.turb }, uGust: { value: D.gust }, uStreak: { value: D.streak }, uGather: { value: 0 },
      uSizeMin: { value: D.sizeMin }, uSizeMax: { value: D.sizeMax }, uFocal: { value: 600 }, uPixelRatio: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
      uCamAz: { value: new THREE.Vector2(0, -1) }, uStrength: { value: D.strength }, uNearFloor: { value: D.nearFloor },
      uRadialPow: { value: W.radialPow }, uRadialFloor: { value: W.radialFloor }, uTg: { value: W.tg }, uTgW: { value: W.tgW }, uScale: { value: 1 },
    },
    vertexShader: `
      ${NOISE_GLSL}
      attribute vec4 seed;
      uniform float uTime, uL, uRT, uRM, uPW, uVB, uBreath, uConvulse, uTear;
      uniform float uSide, uStreak, uSizeMin, uSizeMax, uFocal, uPixelRatio, uScale;
      uniform float uStrength, uNearFloor, uRadialPow, uRadialFloor, uTg, uTgW, uColMidPos;
      uniform vec2 uCamAz, uRes; uniform vec3 uColThroat, uColMid, uColRim;
      varying float vAlpha, vHard, vHalf, vW; varying vec3 vCol; varying vec2 vP;
      ${RAMP_GLSL}
      ${DEFORM_GLSL}
      ${FLOW_GLSL}
      void main(){
        float v, v0;
        vec3 p1 = flowPos(seed, uTime, 1.0, v);
        vec3 p0 = flowPos(seed, uTime - uStreak, 1.0, v0);
        vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p1, 1.0);
        vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p0, 1.0);
        if (c1.w < 0.05 || c0.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
        vec2 n1 = c1.xy / c1.w, n0 = c0.xy / c0.w;
        vec2 px1 = n1 * 0.5 * uRes, px0 = n0 * 0.5 * uRes;
        float dist = length((modelViewMatrix * vec4(p1, 1.0)).xyz);
        float w = 0.5 * mix(uSizeMin, uSizeMax, fract(seed.w*7.31 + seed.z*3.7)) * uScale * uPixelRatio * (uFocal / max(dist, 0.2)) * 0.01;
        w = max(w, 0.45);
        vec2 dxy = px1 - px0; float len = min(length(dxy), w * 18.0);
        vec2 ax = length(dxy) > 0.001 ? dxy / length(dxy) : vec2(1.0, 0.0);
        vec2 perp = vec2(-ax.y, ax.x);
        float half_ = len * 0.5 + w;
        vec2 center = (px1 + px0) * 0.5;
        vec2 pp = center + position.x * half_ * ax + position.y * w * perp;
        vP = vec2(position.x * half_, position.y * w); vHalf = half_; vW = w;
        gl_Position = vec4(pp / (0.5 * uRes), c1.z / c1.w, 1.0);
        float d = dot(normalize(p1.xy), uCamAz);
        float near = clamp((d + 0.5)/1.1, 0.0, 1.0);
        float vc = clamp(v, 0.0, 1.0);
        float a = smoothstep(-uVB, -uVB*0.55, v) * smoothstep(1.0, 0.93, v) * smoothstep(0.25*uScale, 1.6*uScale, dist);
        float rad = uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vc, uRadialPow) + 1.6*smoothstep(0.0, -uVB, v);
        float bright = uStrength * (rad*0.75 + uTg*exp(-vc/uTgW));
        vec3 base = ramp(vc);
        if (uSide < 0.5) { vCol = base * bright; vAlpha = a * (1.0-near) * 0.5; vHard = 0.0; }
        else { vCol = base * bright * uNearFloor; vAlpha = a * near * 0.5; vHard = 1.0; }
      }`,
    fragmentShader: `
      precision highp float;
      varying float vAlpha, vHard, vHalf, vW; varying vec3 vCol; varying vec2 vP;
      void main(){
        float segHalf = max(vHalf - vW, 0.0);
        float dd = length(vec2(max(abs(vP.x) - segHalf, 0.0), vP.y)) / vW;
        float a = mix(smoothstep(1.0, 0.45, dd), smoothstep(1.0, 0.78, dd), vHard);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol, a*vAlpha);
      }`,
  });
}
const dustFar = new THREE.Mesh(dustGeo, dustMaterial(0)); dustFar.renderOrder = 2; dustFar.frustumCulled = false; scene.add(dustFar);
const dustNear = new THREE.Mesh(dustGeo, dustMaterial(1)); dustNear.renderOrder = 4; dustNear.frustumCulled = false; scene.add(dustNear);

// ---------------- cloud puffs: big soft volumetric sprites in the outer funnel, flowing down into the maw ----------------
function puffGeometry(n) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, P.L / 2), P.L * 2);
  return g;
}
const puffGeo = puffGeometry(Q.n);
function puffMaterial(side) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    uniforms: {
      ...shapeUniforms, ...colorUniforms,
      uThick: { value: D.thick }, uSide: { value: side }, uOmega: { value: D.omega * 0.8 }, uSpeed: { value: Q.speed }, uWind: { value: D.wind },
      uTurb: { value: D.turb * 0.6 }, uGust: { value: D.gust }, uGather: { value: 0 },
      uSizeMin: { value: Q.sizeMin }, uSizeMax: { value: Q.sizeMax }, uFocal: { value: 600 }, uPixelRatio: { value: 1 },
      uCamAz: { value: new THREE.Vector2(0, -1) }, uStrength: { value: Q.strength }, uNearFloor: { value: Q.nearFloor }, uAlpha: { value: Q.alpha },
      uRadialPow: { value: W.radialPow }, uRadialFloor: { value: W.radialFloor }, uTg: { value: W.tg }, uTgW: { value: W.tgW }, uScale: { value: 1 },
    },
    vertexShader: `
      ${NOISE_GLSL}
      attribute vec4 seed;
      uniform float uTime, uL, uRT, uRM, uPW, uVB, uBreath, uConvulse, uTear;
      uniform float uSide, uSizeMin, uSizeMax, uFocal, uPixelRatio, uScale;
      uniform float uStrength, uNearFloor, uRadialPow, uRadialFloor, uTg, uTgW, uColMidPos, uAlpha;
      uniform vec2 uCamAz; uniform vec3 uColThroat, uColMid, uColRim;
      varying float vAlpha, vRot, vSeed; varying vec3 vCol;
      ${RAMP_GLSL}
      ${DEFORM_GLSL}
      ${FLOW_GLSL}
      void main(){
        float v;
        // puffs live deeper inside the funnel volume than the grains (thickScale pulls them off the wall)
        vec3 p = flowPos(seed, uTime, 1.5 + 2.0*seed.w, v);
        float vc = clamp(v, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = length(mv.xyz);
        float sz = mix(uSizeMin, uSizeMax, fract(seed.w*5.17)) * (0.35 + 0.65*vc);       // clouds are big at the mouth, shred small near the throat
        gl_PointSize = sz * uScale * uPixelRatio * (uFocal / max(dist, 0.2)) * 0.9;
        gl_Position = projectionMatrix * mv;
        if (mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        float d = dot(normalize(p.xy), uCamAz);
        float near = clamp((d + 0.5)/1.1, 0.0, 1.0);
        float a = smoothstep(0.02, 0.22, v) * smoothstep(1.0, 0.9, v) * smoothstep(1.6*uScale, 5.2*uScale, dist) * smoothstep(0.25, 0.5, vc);
        float rad = uRadialFloor + (1.0-uRadialFloor)*pow(1.0-vc, uRadialPow);
        float bright = uStrength * (rad*0.8 + uTg*exp(-vc/uTgW));
        vec3 base = ramp(vc);
        if (uSide < 0.5) { vCol = base * bright; vAlpha = a * (1.0-near) * uAlpha; }
        else { vCol = base * bright * uNearFloor; vAlpha = a * near * uAlpha * 1.4; }
        vRot = seed.x * 6.2831853; vSeed = seed.y * 40.0;
      }`,
    fragmentShader: `
      precision highp float;
      ${NOISE_GLSL}
      uniform float uTime;
      varying float vAlpha, vRot, vSeed; varying vec3 vCol;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float cs = cos(vRot), sn = sin(vRot); c = vec2(c.x*cs - c.y*sn, c.x*sn + c.y*cs);
        float q = length(c)*2.0;
        float n = 0.5 + 0.5*(0.6*snoise(vec3(c*4.5, vSeed)) + 0.4*snoise(vec3(c*9.0 + 3.1, vSeed + uTime*0.15)));
        float a = smoothstep(1.0, 0.2, q) * smoothstep(0.28, 0.75, n);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol, a * vAlpha);
      }`,
  });
}
const puffsFar = new THREE.Points(puffGeo, puffMaterial(0)); puffsFar.renderOrder = 1; puffsFar.frustumCulled = false; scene.add(puffsFar);
const puffsNear = new THREE.Points(puffGeo, puffMaterial(1)); puffsNear.renderOrder = 3; puffsNear.frustumCulled = false; scene.add(puffsNear);
const flowMats = [dustFar.material, dustNear.material, puffsFar.material, puffsNear.material];


// ---------------- dust text: every section is spelled out by motes pulled from the vortex, then given back to it ----------------
const MONO = 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace';
function sampleText(lines) {
  // lines: [{ text, size, weight, spacing, gapBefore, pointSize, hit }] stacked and centered → mote targets in px relative to the block center
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const measured = lines.map(l => { ctx.font = `${l.weight || 600} ${l.size}px ${MONO}`; ctx.letterSpacing = (l.spacing || 0.12) + 'em'; return { ...l, w: ctx.measureText(l.text).width + l.size * 0.2 }; });
  const W = Math.ceil(Math.max(...measured.map(m => m.w)) + 40);
  let H = 20; for (const m of measured) H += (m.gapBefore || 0) + m.size * 1.15; H += 20;
  cv.width = W; cv.height = Math.ceil(H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
  let y = 20; const boxes = [];
  for (const m of measured) {
    y += m.gapBefore || 0;
    ctx.font = `${m.weight || 600} ${m.size}px ${MONO}`; ctx.letterSpacing = (m.spacing || 0.12) + 'em';
    const x = (W - m.w) / 2; ctx.fillText(m.text, x, y);
    boxes.push({ x: x - W / 2, y: y - H / 2, w: m.w, h: m.size * 1.15, line: m });
    y += m.size * 1.15;
  }
  const img = ctx.getImageData(0, 0, W, cv.height).data, pts = [], sizes = [], lineIdx = [];
  for (let bi = 0; bi < boxes.length; bi++) {
    const bx = boxes[bi], st = bx.line.stride || 2;
    for (let yy = Math.floor(bx.y + H / 2); yy < bx.y + H / 2 + bx.h; yy += st) for (let xx = 0; xx < W; xx += st) {
      if (img[(yy * W + xx) * 4] > 110) { pts.push(xx - W / 2 + (Math.random() - 0.5) * st, yy - H / 2 + (Math.random() - 0.5) * st); sizes.push(bx.line.pointSize || 1.6); lineIdx.push(bi); }
    }
  }
  return { pts, sizes, lineIdx, boxes, W, H };
}
function whirlPoints(radius, n, pointSize) {
  const pts = [], sizes = [], turns = 5.0, r0 = 1.0;
  for (let i = 0; i <= n; i++) { const t = i / n, th = t * turns * TAU, rad = (r0 * Math.pow(radius / r0, t)); pts.push(rad * Math.cos(th), rad * Math.sin(th)); sizes.push(pointSize); }
  return { pts, sizes };
}
function makeTextMotes(pts, sizes, lineIdx) {
  const n = pts.length / 2;
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('tgt', new THREE.BufferAttribute(new Float32Array(pts), 2));
  g.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(sizes), 1));
  g.setAttribute('line', new THREE.BufferAttribute(new Float32Array(lineIdx), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: {
      ...shapeUniforms,
      uThick: { value: D.thick }, uOmega: { value: D.omega }, uSpeed: { value: D.speed }, uWind: { value: D.wind }, uTurb: { value: D.turb }, uGust: { value: D.gust }, uGather: { value: 0 },
      uOrigin: { value: new THREE.Vector2() }, uPx: { value: new THREE.Vector2(1, 1) }, uForm: { value: 0 }, uAspect: { value: 1 }, uPixelRatio: { value: 1 }, uHot: { value: -1 },
      uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
    },
    vertexShader: `
      ${NOISE_GLSL}
      attribute vec4 seed; attribute vec2 tgt; attribute float psize, line;
      uniform float uTime, uL, uRT, uRM, uPW, uVB, uBreath, uConvulse, uTear;
      uniform float uForm, uAspect, uPixelRatio, uHot; uniform vec2 uOrigin, uPx; uniform mat4 uProj, uView;
      varying float vA; varying vec3 vCol;
      ${DEFORM_GLSL}
      ${FLOW_GLSL}
      void main(){
        // source: the dust clouds in the walls (mid-height, inside the shell), turning with the vortex — never the throat
        float vv = 0.45 + 0.5*seed.x;
        float wang = seed.y*6.2831853 + uOmega*uTime*(1.0 + 0.4*sin(floor(seed.z*7.0)*3.7));
        float wr = Rf(vv)*deform(wang, vv) - (0.15 + 0.9*seed.z)*uThick*1.4;
        vec3 p = vec3(wr*cos(wang), wr*sin(wang), vv*uL);
        p += uTurb*0.6*vec3(snoise(p*0.9 + vec3(0.0, 0.0, uTime*0.6)), snoise(p*0.9 + 31.7), 0.0);
        vec4 c = uProj * uView * vec4(p, 1.0);
        vec2 flowN = c.w > 0.05 ? c.xy / c.w : vec2(3.0, 3.0);
        vec2 tN = uOrigin + vec2(tgt.x * uPx.x, -tgt.y * uPx.y);
        float f = smoothstep(0.0, 1.0, uForm);
        float fe = smoothstep(0.0, 1.0, clamp(f * mix(1.0, 1.5, seed.w), 0.0, 1.0));
        float ang = seed.y*6.2831853 + uTime*1.6*(1.0 - fe);
        vec2 swirl = vec2(cos(ang), sin(ang)*uAspect) * 0.12 * (1.0 - fe) * fe;
        vec2 jitter = vec2(snoise(vec3(seed.xy*40.0, uTime*0.7)), snoise(vec3(seed.zw*40.0, uTime*0.7 + 9.0))) * 0.0012 * fe;   // settled letters still breathe
        vec2 pos = mix(flowN, tN + swirl + jitter, fe);
        gl_Position = vec4(pos, 0.0, 1.0);
        float hot = (abs(line - uHot) < 0.5) ? 1.0 : 0.0;
        gl_PointSize = (psize * (1.0 + 0.35*hot) + 2.2*(1.0 - fe)*fe) * uPixelRatio;
        float onscreen = flowN.x < 2.5 ? 1.0 : fe;
        vA = 0.92 * smoothstep(0.0, 0.12, uForm) * onscreen;
        vCol = mix(vec3(1.0, 0.86, 0.60), vec3(1.0, 0.76, 0.42), seed.z) * mix(1.2, 2.4 + 1.2*hot, fe);
      }`,
    fragmentShader: `
      precision highp float; varying float vA; varying vec3 vCol;
      void main(){ vec2 c = gl_PointCoord - 0.5; float q = length(c)*2.0; float a = smoothstep(1.0, 0.25, q); if (a < 0.02) discard; gl_FragColor = vec4(vCol * a, a * vA); }`,
  });
  const pts3 = new THREE.Points(g, mat); pts3.frustumCulled = false; pts3.renderOrder = 10; scene.add(pts3);
  return pts3;
}

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

// ---------------- camera path (orbit + descent, ending at Egress) ----------------
const C = P.cam;
const easeS = s => s * s * (3 - 2 * s);
export function camState(s) {
  const e = easeS(s);
  const z = C.z0 + (C.z1 - C.z0) * e;
  const rho = Math.min(C.rho0, R(z / P.L) * 0.86);                   // inside the wall always; R continues above the mouth so there is no step at the top
  const phi = C.phi0 + s * TAU * C.turns;
  const dir = new THREE.Vector2(Math.cos(phi), Math.sin(phi));
  const fwd = dir.clone().multiplyScalar(-1), right = new THREE.Vector2(fwd.y, -fwd.x);
  const pos = new THREE.Vector3(dir.x * rho, dir.y * rho, z);
  const k = Math.max(0.16, rho / C.rho0);
  const zt = C.zt0 + (C.zt1 - C.zt0) * e;
  const tx = fwd.x * C.fwd0 * k + right.x * C.right0 * k, ty = fwd.y * C.fwd0 * k + right.y * C.right0 * k;
  const target = new THREE.Vector3(tx, ty, zt);
  const roll = THREE.MathUtils.degToRad(2.2 * Math.sin(s * Math.PI));
  return { pos, target, roll, dir, fwd, right, z, s, rho };
}
const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpAxis = new THREE.Vector3();
function applyCam(cam, pos, target, roll) {
  cam.position.copy(pos);
  tmpM.lookAt(pos, target, cam.up); tmpQ.setFromRotationMatrix(tmpM);
  cam.quaternion.copy(tmpQ);
  tmpAxis.set(0, 0, 1).applyQuaternion(cam.quaternion);
  cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(tmpAxis, roll));
  cam.updateMatrixWorld();
}

// ---------------- scroll ----------------
let sTarget = 0, s = 0;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);
function readScroll() { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); sTarget = Math.min(1, Math.max(0, scrollY / max)); }
addEventListener('scroll', readScroll, { passive: true }); readScroll();
let navAnim = 0;                                                    // slow, deliberate travel between layers (native smooth was a lurch)
function travelTo(top, dur) {
  cancelAnimationFrame(navAnim);
  const start = scrollY, dist = top - start, t0 = performance.now();
  function step(now) { const p = Math.min(1, (now - t0) / dur); const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; scrollTo(0, start + dist * e); if (p < 1) navAnim = requestAnimationFrame(step); }
  navAnim = requestAnimationFrame(step);
}
addEventListener('wheel', () => cancelAnimationFrame(navAnim), { passive: true });
document.querySelectorAll('.vnav a').forEach(a => a.addEventListener('click', () => {
  const max = document.documentElement.scrollHeight - innerHeight, top = parseFloat(a.dataset.s) * max;
  travelTo(top, 1800 + 2600 * Math.abs(top - scrollY) / max);
}));

// ---------------- plates anchored to 3D points ----------------
const G = 'https://garden.serrow.dev';
const SECTIONS = [
  { id: 'entity', s: 0.26, title: 'ENTITY', eyebrow: 'subject dossier · depth 1.6k m', items: [
    { name: 'SPEC-00 · SERROW', code: 'SPEC-00', status: 'EVOLVING', line: 'I create things, with a deep love of visual esoteria. Build · design · write. Curiosity first.', href: null, act: null }] },
  { id: 'forge', s: 0.52, title: 'FORGE', eyebrow: 'what gets built · depth 3.8k m', items: [
    { name: 'GLYPH', code: 'SPEC-01', status: 'IN PRODUCTION', line: 'An agent-native format — staves you can drop in and run. The piece that is actually shipping.', href: G + '/Projects/Glyph', act: 'observe' },
    { name: 'PBS INSIGHTS', code: 'SPEC-02', status: 'IN PRODUCTION', line: 'AI-powered deal analytics for auto dealerships — F&I spreadsheets into real-time dashboards.', href: G + '/Projects/PBS-Insights', act: 'observe' },
    { name: 'BLACKBIRD', code: 'SPEC-03', status: 'SEED', line: 'Lead enrichment, agent-first. The avian specimen — annotated, dissected, rendered as data.', href: G + '/Projects/Blackbird', act: 'observe' },
    { name: 'TWICE', code: 'SPEC-04', status: 'v0.8 BETA', line: 'A presence-first interface for the plural mind. v0.8 out; the most personal build.', href: G + '/Projects/Twice', act: 'observe' },
    { name: 'THE DESCENT', code: 'SPEC-05', status: 'v3 · LIVE', line: 'The piece you are inside — a portfolio shaped as the creator\'s mind.', href: G + '/Projects/The-Descent', act: 'observe' }] },
  { id: 'embers', s: 0.76, title: 'EMBERS', eyebrow: 'sparks off the forge · depth 6.4k m', items: [
    { name: 'THE LIMINAL GARDEN', code: 'GARDEN', status: 'TENDED', line: 'Where the embers land — notes, project pages, and the running log, tended in the open.', href: G, act: 'enter the garden' }] },
  { id: 'egress', s: 1.0, title: 'WHERE I EXIST', eyebrow: 'the event horizon · depth 9.0k m', whirl: true, items: [
    { name: 'GITHUB', code: 'EGRESS', status: 'OPEN', line: 'github.com/Serrowxd', href: 'https://github.com/Serrowxd', act: 'open' },
    { name: 'GARDEN', code: 'EGRESS', status: 'OPEN', line: 'garden.serrow.dev', href: G, act: 'open' },
    { name: 'INSTA', code: 'EGRESS', status: 'OPEN', line: 'instagram.com/serrowxd', href: 'https://www.instagram.com/serrowxd/', act: 'open' }] },
];
const hitsEl = document.getElementById('hits'), annot = document.getElementById('annot');
let hovered = null, annotTimer = 0;
const blocks = SECTIONS.map(sec => {
  const st = camState(sec.s);
  const cam = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 200); cam.up.set(0, 0, 1); applyCam(cam, st.pos, st.target, st.roll);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const anchor = st.pos.clone().addScaledVector(fwd, P.plates.dist).addScaledVector(right, P.plates.right).addScaledVector(up, P.plates.up);
  const lines = [{ text: sec.title, size: 66, weight: 600, spacing: 0.14, gapBefore: 0, pointSize: 3.0, stride: 2, hit: false }];
  sec.items.forEach((it, i) => lines.push({ text: it.name, size: 28, weight: 500, spacing: 0.18, gapBefore: i === 0 ? 34 : 14, pointSize: 2.4, stride: 2, hit: true, item: it }));
  const T = sampleText(lines);
  let pts = T.pts, sizes = T.sizes, lineIdx = T.lineIdx;
  if (sec.whirl) { const wh = whirlPoints(44, 900, 1.7); const oy = -T.H / 2 - 62; for (let i = 0; i < wh.pts.length; i += 2) { pts.push(wh.pts[i], wh.pts[i + 1] + oy); sizes.push(wh.sizes[i / 2]); lineIdx.push(-1); } }
  const motes = makeTextMotes(pts, sizes, lineIdx);
  const eyebrow = document.createElement('div'); eyebrow.className = 'dt-eyebrow'; eyebrow.textContent = '◢ ' + sec.title.toLowerCase() + ' // ' + sec.eyebrow; hitsEl.appendChild(eyebrow);
  const hits = T.boxes.map((bx, i) => {
    const isHit = !!bx.line.hit, href = isHit && bx.line.item.href;
    const h = document.createElement(href ? 'a' : 'div'); h.className = 'dt-text' + (isHit ? ' hit' : ' title'); if (href) { h.href = href; h.target = '_blank'; h.rel = 'noopener'; }
    h.textContent = bx.line.text;
    h.style.fontSize = bx.line.size + 'px'; h.style.letterSpacing = (bx.line.spacing || 0.12) + 'em'; h.style.fontWeight = bx.line.weight || 600;
    if (isHit) { h.addEventListener('pointerenter', () => showAnnot(sec, bx.line.item, h, i, motes)); h.addEventListener('pointerleave', () => hideAnnot(motes)); }
    hitsEl.appendChild(h); return { el: h, bx, line: i, isHit };
  });
  return { sec, anchor, motes, T, hits, eyebrow, form: 0 };
});
function showAnnot(sec, it, h, line, motes) {
  clearTimeout(annotTimer); hovered = it; motes.material.uniforms.uHot.value = line;
  annot.innerHTML = `<div class="ae">${it.code} · <b>${it.status}</b></div><div class="an">${it.name}</div><div class="al">${it.line}</div>` + (it.href ? `<a class="aa" href="${it.href}" target="_blank" rel="noopener">${it.act} →</a>` : '');
  const r = h.getBoundingClientRect(); const left = r.right + 22 + 320 < innerWidth;
  annot.style.left = (left ? r.right + 22 : r.left - 22 - 320) + 'px'; annot.style.top = (r.top + r.height / 2) + 'px';
  annot.classList.add('on');
}
function hideAnnot(motes) { annotTimer = setTimeout(() => { annot.classList.remove('on'); hovered = null; motes.material.uniforms.uHot.value = -1; }, 220); }
annot.addEventListener('pointerenter', () => clearTimeout(annotTimer));
annot.addEventListener('pointerleave', () => { annotTimer = setTimeout(() => { annot.classList.remove('on'); for (const b of blocks) b.motes.material.uniforms.uHot.value = -1; }, 200); });
const v3 = new THREE.Vector3();
function updatePlates() {
  const vw = innerWidth, vh = innerHeight;
  for (const b of blocks) {
    const ds = Math.abs(s - b.sec.s);
    const form = 1 - THREE.MathUtils.smoothstep(ds, P.plates.core, P.plates.win);
    v3.copy(b.anchor).project(camera);
    const behind = v3.z > 1;
    const x = (v3.x * 0.5 + 0.5) * vw, y = (-v3.y * 0.5 + 0.5) * vh;
    const dist = b.anchor.distanceTo(camera.position);
    const sc = THREE.MathUtils.clamp(P.plates.dist / dist, 0.55, 1.5) * Math.min(1, vw / 1400);
    b.form = behind ? 0 : form;
    const u = b.motes.material.uniforms;
    u.uOrigin.value.set(v3.x, v3.y); u.uPx.value.set(2 * sc / vw, 2 * sc / vh); u.uForm.value = b.form; u.uAspect.value = vw / vh; u.uPixelRatio.value = renderer.getPixelRatio();
    u.uProj.value.copy(camera.projectionMatrix); u.uView.value.copy(camera.matrixWorldInverse);
    b.motes.visible = b.form > 0.001;
    const live = b.form > 0.92;
    if (!live && b.motes.material.uniforms.uHot.value >= 0) { annot.classList.remove('on'); b.motes.material.uniforms.uHot.value = -1; }
    const solid = THREE.MathUtils.smoothstep(b.form, 0.8, 1.0);                        // the letters solidify once the material has settled
    for (const h of b.hits) {
      h.el.style.display = b.form > 0.75 ? 'block' : 'none';
      h.el.style.opacity = (solid * (h.isHit ? 0.38 : 0.3)).toFixed(3);
      h.el.style.pointerEvents = (live && h.isHit) ? 'auto' : 'none';
      h.el.style.left = (x + h.bx.x * sc) + 'px'; h.el.style.top = (y + h.bx.y * sc) + 'px';
      h.el.style.transform = `scale(${sc.toFixed(4)})`;
    }
    const tb = b.T.boxes[0];
    b.eyebrow.style.opacity = THREE.MathUtils.smoothstep(b.form, 0.7, 1).toFixed(3);
    b.eyebrow.style.left = (x + tb.x * sc) + 'px'; b.eyebrow.style.top = (y + (tb.y - 22) * sc) + 'px';
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
  const infall = (0.051 + s * 0.9 + charge * 2.4 + Math.max(0, tearT) * 6 + Math.random() * 0.004).toFixed(3);
  const state = tearT >= 0 ? 'TEARING' : charge > 0.85 ? 'BREACH' : charge > 0.3 ? 'COUPLING' : s < 0.15 ? 'CONSUMING' : s < 0.6 ? 'INFALLING' : s < 0.9 ? 'COUPLING' : 'HORIZON';
  eTL.innerHTML = `<span class="k">◢</span> SPEC-00-2 // MAW\nstate · ${state}\norbit · <span class="g">${orbit.toFixed(1).padStart(5, '0')}°</span>`;
  eTR.innerHTML = `depth <span class="g">${String(depth).padStart(4, '0')} M</span>\ninfall <span class="g">${infall} R/S</span>\n<span class="r">●</span> REC ${rec}`;
  eBR.innerHTML = `warmth <span class="g">${(0.88 + Math.random() * 0.03).toFixed(3)}</span>\nentropy <span class="g">${(0.03 + s * 0.6 + charge * 0.3 + Math.random() * 0.005).toFixed(5)}</span>\n// observing`;
  const fade = THREE.MathUtils.smoothstep(1 - THREE.MathUtils.smoothstep(s, 0.02, 0.16), 0.55, 1.0);
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
  if (w < 2 || h < 2) return;
  applyPixelRatio();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  baseFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(C.lensH / 2)) / aspect));
  camera.fov = baseFov; camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  const focal = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  for (const m of flowMats) { m.uniforms.uFocal.value = focal; m.uniforms.uPixelRatio.value = pr; if (m.uniforms.uRes) m.uniforms.uRes.value.set(w * pr, h * pr); }
  lens.uniforms.uRes.value.set(w, h);
}
addEventListener('resize', resize); resize();

// ---------------- markers · drone · breach · sanctum ----------------
let lastState = camState(0);
const markers = initMarkers({ camera, getState: () => lastState, R, L: P.L, omega: D.omega, wind: D.wind });
const audio = initAudio(document.getElementById('audio'), { getS: () => s });
const black = document.getElementById('black');
let tearT = -1, boost = 0, charge = 0, sBeforeBreach = 0;
const sanctum = initSanctum({ renderer, renderPass, bloom, lens, audio, black, onExit: () => {
  renderPass.scene = scene; renderPass.camera = camera; document.body.classList.remove('inside');
  sTarget = sBeforeBreach; s = sBeforeBreach; boost = 0; tearT = -1; breach.rearm(); markers.clear();
  setTimeout(() => { black.style.opacity = 0; }, 80);
} });
const breach = initBreach({ camera, prompt: document.getElementById('breach'), onCharge: c => { charge = c; },
  onBreak: () => { tearT = 0; sBeforeBreach = s; boost = 1; } });
function enterSanctum() { document.body.classList.add('inside'); sanctum.enter(); }
const tearPos = new THREE.Vector3(), tearTarget = new THREE.Vector3(), tearEnd = new THREE.Vector3(0.45, 0.25, 0.35), tearLook = new THREE.Vector3(0, 0, -2.5);

// ---------------- loop ----------------
const clock = new THREE.Clock();
let time = 0, fpsAcc = 0, fpsN = 0, spinAcc = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta()); time += dt;
  if (document.visibilityState === 'visible' && dt < 0.049) { fpsAcc += dt; fpsN++; } else { fpsAcc = 0; fpsN = 0; }
  if (fpsN >= 40) { const avg = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
    if (avg > 1 / 42 && quality > 0.55) { quality = Math.max(0.55, quality - 0.15); resize(); }
    else if (avg < 1 / 70 && quality < 1) { quality = Math.min(1, quality + 0.1); resize(); } }
  if (sanctum.active) { sanctum.update(dt); audio.update(); composer.render(); requestAnimationFrame(frame); return; }
  s += (sTarget - s) * (1 - Math.exp(-dt * 2.2));
  const st = camState(s); lastState = st;
  // the tear: the rim splits, the walls shred, you fall through the wound
  let tear = 0.25 * charge * charge;
  if (tearT >= 0) {
    tearT += dt / 3.4; tear = 0.25 + 0.75 * Math.min(1, tearT);
    const e = Math.min(1, tearT * tearT * tearT);
    tearPos.copy(st.pos).lerp(tearEnd, e); tearTarget.copy(st.target).lerp(tearLook, e);
    applyCam(camera, tearPos, tearTarget, st.roll + THREE.MathUtils.degToRad(14) * e);
    black.style.opacity = Math.min(1, Math.max(0, (tearT - 0.74) / 0.24));
    if (tearT >= 1) { tearT = -1; enterSanctum(); }
  } else {
    applyCam(camera, st.pos, st.target, st.roll);
  }
  boost = Math.max(0, boost - dt / 1.6);
  camera.fov = baseFov * (1 - 0.14 * charge * charge); camera.updateProjectionMatrix();
  spinAcc += dt * W.spin * (1 + 4 * charge * charge + 3 * boost + 6 * Math.max(0, tearT));
  const expo = 1.0 / (1.0 + 2.2 * s * s);
  renderer.toneMappingExposure = expo;
  shapeUniforms.uTime.value = time; shapeUniforms.uTear.value = tear;
  wallUniforms.uSpin.value = spinAcc; wallUniforms.uCamAz.value.copy(st.dir);
  wallUniforms.uStrength.value = W.strength * (1.0 - 0.3 * s);
  wallUniforms.uTg.value = W.tg * (1.0 - 0.5 * s);
  const kd = 0.3 + 0.7 * Math.min(1, st.rho / C.rho0);
  for (const m of flowMats) {
    m.uniforms.uCamAz.value.copy(st.dir); m.uniforms.uScale.value = kd;
    m.uniforms.uGather.value = charge * charge * (tearT >= 0 ? 0 : 1);
  }
  for (const m of [dustFar.material, dustNear.material]) { m.uniforms.uStrength.value = D.strength * (1.0 - 0.3 * s); m.uniforms.uSpeed.value = D.speed * (1 + 2.5 * boost); m.uniforms.uStreak.value = D.streak * (1 + 3 * Math.max(0, tearT)); }
  for (const m of [puffsFar.material, puffsNear.material]) { m.uniforms.uStrength.value = Q.strength * (1.0 - 0.3 * s); m.uniforms.uSpeed.value = Q.speed * (1 + 2.5 * boost); }
  lens.uniforms.uTime.value = time;
  lens.uniforms.uK.value = 0.015 + 0.07 * s * s + 0.12 * tear;
  lens.uniforms.uCA.value = 0.003 + 0.01 * s + 0.03 * tear;
  lens.uniforms.uGrain.value = 0.045 + 0.03 * s;
  lens.uniforms.uVig.value = 0.55 + 0.3 * s;
  bloom.strength = P.bloom.strength + 0.15 * s + 0.5 * charge * charge + 0.4 * boost;
  bloom.threshold = P.bloom.threshold / expo;
  updatePlates(); updateChrome(st, dt); markers.update(dt); breach.update(dt); audio.update();
  composer.render();
  requestAnimationFrame(frame);
}
frame();
window.__descent = { P, camState, sanctum, enterSanctum, breach, audio, markers, get s() { return s; }, set s(v) { sTarget = v; }, wallUniforms, shapeUniforms, dustFar, dustNear, puffsFar, puffsNear, bloom, lens, camera, renderer, tear() { tearT = 0; sBeforeBreach = s; boost = 1; } };

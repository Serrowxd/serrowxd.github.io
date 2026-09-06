// Self-drawing esoteric markers that ride the flow and get eaten by the throat.
// Same 14 glyph designs + label pool as the 2D descent; each marker is anchored to a point in the funnel
// (far side, in the dust shell), projected to the screen every frame, drifting inward with the spin.
import * as THREE from 'three';
const NS = 'http://www.w3.org/2000/svg', TAU = Math.PI * 2;
const GLYPHS = [
  [{ t: 'circle', cx: 0, cy: 0, r: 14 }, { t: 'polygon', points: [[0, -12], [10, 7], [-10, 7]] }],
  [{ t: 'polygon', points: [[0, -13], [11, 7], [-11, 7]] }, { t: 'polygon', points: [[0, 13], [11, -7], [-11, -7]] }],
  [{ t: 'line', x1: 0, y1: -15, x2: 0, y2: 15 }, { t: 'line', x1: -7, y1: -6, x2: 7, y2: -6 }, { t: 'line', x1: -9, y1: 2, x2: 9, y2: 2 }, { t: 'circle', cx: 0, cy: -15, r: 3 }],
  [{ t: 'polygon', points: [[0, -14], [14, 0], [0, 14], [-14, 0]] }, { t: 'circle', cx: 0, cy: 0, r: 7 }],
  [{ t: 'circle', cx: 0, cy: 0, r: 14 }, { t: 'line', x1: -14, y1: 0, x2: 14, y2: 0 }, { t: 'line', x1: 0, y1: -14, x2: 0, y2: 14 }, { t: 'circle', cx: 0, cy: 0, r: 5 }],
  [{ t: 'polygon', points: [[0, -14], [8.2, 11.3], [-13.3, -4.3], [13.3, -4.3], [-8.2, 11.3]] }],
  [{ t: 'circle', cx: 0, cy: 0, r: 5 }, { t: 'circle', cx: 0, cy: 0, r: 10 }, { t: 'circle', cx: 0, cy: 0, r: 15 }],
  [{ t: 'polygon', points: [[-11, -11], [11, -11], [11, 11], [-11, 11]] }, { t: 'line', x1: -11, y1: -11, x2: 11, y2: 11 }, { t: 'line', x1: 11, y1: -11, x2: -11, y2: 11 }],
  [{ t: 'circle', cx: 0, cy: 0, r: 14 }, { t: 'circle', cx: 6, cy: 0, r: 12 }],
  [{ t: 'circle', cx: 0, cy: 0, r: 7 }, { t: 'circle', cx: 0, cy: -7, r: 7 }, { t: 'circle', cx: 6, cy: 3.5, r: 7 }, { t: 'circle', cx: -6, cy: 3.5, r: 7 }],
  [{ t: 'polygon', points: [[0, -14], [12, -7], [12, 7], [0, 14], [-12, 7], [-12, -7]] }, { t: 'circle', cx: 0, cy: 0, r: 3 }],
  [{ t: 'circle', cx: 0, cy: 0, r: 13 }, { t: 'circle', cx: 0, cy: 0, r: 4 }, { t: 'line', x1: -13, y1: 0, x2: -19, y2: 0 }, { t: 'line', x1: 13, y1: 0, x2: 19, y2: 0 }],
  [{ t: 'line', x1: 0, y1: -15, x2: 0, y2: 15 }, { t: 'line', x1: 0, y1: -8, x2: 10, y2: -15 }, { t: 'line', x1: 0, y1: -1, x2: -10, y2: -7 }, { t: 'line', x1: 0, y1: 6, x2: 10, y2: -1 }],
  [{ t: 'polygon', points: [[0, -14], [13, 9], [-13, 9]] }, { t: 'circle', cx: 0, cy: 2, r: 6 }, { t: 'circle', cx: 0, cy: -14, r: 2.5 }],
];
const LABELS = [
  'AWE', 'LONGING', 'WONDER', 'VERTIGO', 'REVERIE', 'SERENITY', 'YEARNING', 'DREAD', 'MELANCHOLY', 'NOSTALGIA',
  'CATHARSIS', 'RAPTURE', 'EUPHORIA', 'SOLITUDE', 'GRIEF', 'CURIOSITY', 'HOPE', 'TENDERNESS', 'WISTFULNESS', 'BLISS',
  'UNEASE', 'ELATION', 'SORROW', 'ANTICIPATION', 'LONELINESS', 'ECSTASY', 'REVERENCE', 'SAUDADE', 'HIRAETH', 'SONDER',
  'SIGIL', 'AETHER', 'OUROBOROS', 'GNOSIS', 'NUMEN', 'EGREGORE', 'QUINTESSENCE', 'LIMINALITY',
  'ANDROMEDA', 'WHIRLPOOL', 'SOMBRERO', 'PINWHEEL', 'TRIANGULUM', 'CARTWHEEL',
  'SIRIUS', 'VEGA', 'BETELGEUSE', 'ANTARES', 'RIGEL', 'POLARIS'];
const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const shape = s => s.t === 'circle' ? el('circle', { cx: s.cx, cy: s.cy, r: s.r, pathLength: 1 })
  : s.t === 'line' ? el('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, pathLength: 1 })
  : el('polygon', { points: s.points.map(p => p[0] + ',' + p[1]).join(' '), pathLength: 1 });

export function initMarkers({ camera, getState, R, L, omega, wind }) {
  const svg = document.getElementById('markers');
  const live = [];
  const v3 = new THREE.Vector3();
  function project(v, ang, rk) {
    const r = R(Math.max(v, 0)) * rk;
    v3.set(r * Math.cos(ang), r * Math.sin(ang), v * L).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight, behind: v3.z > 1 || v3.z < -1 };
  }
  function spawn(st) {
    const camAng = Math.atan2(st.dir.y, st.dir.x);
    const v0 = 0.32 + Math.random() * 0.45;
    const ang0 = camAng + Math.PI + (Math.random() - 0.5) * 2.2;
    const warm = Math.random() < 0.3, left = Math.random() < 0.5;
    const g = el('g', { class: 'mk' });
    const lead = el('line', { class: 'lead draw', pathLength: 1 });
    const dot = el('circle', { r: 2, class: 'tdot', style: 'opacity:0;transition:opacity .4s ease' });
    const body = el('g', {});
    const gls = GLYPHS[(Math.random() * GLYPHS.length) | 0].map((s, i) => { const e = shape(s); e.setAttribute('class', 'gl draw' + (warm ? ' warm' : '')); e.style.transitionDelay = (0.1 + i * 0.08) + 's'; body.appendChild(e); return e; });
    const lab = el('text', { x: left ? -16 : 16, y: -16, class: warm ? 'warm' : '', style: 'opacity:0;transition:opacity .5s ease .2s' });
    if (left) lab.setAttribute('text-anchor', 'end');
    lab.textContent = LABELS[(Math.random() * LABELS.length) | 0];
    body.appendChild(lab); g.appendChild(lead); g.appendChild(body); g.appendChild(dot); svg.appendChild(g);
    g.getBoundingClientRect();
    lead.style.strokeDashoffset = '0'; gls.forEach(e => e.style.strokeDashoffset = '0'); lab.style.opacity = '0.85'; dot.style.opacity = '0.9';
    live.push({ g, lead, dot, body, gls, lab, v: v0, ang: ang0, age: 0, hold: 3.2 + Math.random() * 2.2, eaten: false, done: false });
  }
  let acc = 0;
  function update(dt) {
    const st = getState();
    acc += dt;
    if (acc > 2.0) { acc = 0; if (live.length < 2 && st.s < 0.72 && Math.random() < 0.72) spawn(st); }
    for (const m of live) {
      m.age += dt;
      // ride the flow: inward + around, faster as it nears the throat
      const k = 1 + 3 * Math.pow(1 - m.v, 2);
      m.v -= dt * 0.012 * k * (m.eaten ? 6 : 1);
      m.ang += dt * (omega + wind * 0.4 * k * 0.1);
      const a = project(m.v, m.ang, 0.9), t = project(m.v - 0.12, m.ang + 0.5, 0.9);
      const off = a.behind || a.x < -80 || a.x > innerWidth + 80 || a.y < -80 || a.y > innerHeight + 80;
      if (!m.eaten && (m.age > m.hold || m.v < 0.2 || off)) {
        m.eaten = true;
        m.lead.style.strokeDashoffset = '1'; m.gls.forEach(e => e.style.strokeDashoffset = '1'); m.lab.style.opacity = '0'; m.dot.style.opacity = '0';
        m.eatT = 0;
      }
      if (m.eaten) { m.eatT += dt; if (m.eatT > 0.9 || m.v < 0.02) { m.done = true; m.g.remove(); continue; } }
      const sc = m.eaten ? Math.max(0.05, 1 - m.eatT * 1.1) : 1;
      m.body.setAttribute('transform', `translate(${a.x.toFixed(1)},${a.y.toFixed(1)}) scale(${sc.toFixed(3)})`);
      m.dot.setAttribute('cx', t.x.toFixed(1)); m.dot.setAttribute('cy', t.y.toFixed(1));
      m.lead.setAttribute('x1', a.x.toFixed(1)); m.lead.setAttribute('y1', a.y.toFixed(1)); m.lead.setAttribute('x2', t.x.toFixed(1)); m.lead.setAttribute('y2', t.y.toFixed(1));
    }
    for (let i = live.length - 1; i >= 0; i--) if (live[i].done) live.splice(i, 1);
  }
  function clear() { for (const m of live) m.g.remove(); live.length = 0; }
  return { update, clear };
}

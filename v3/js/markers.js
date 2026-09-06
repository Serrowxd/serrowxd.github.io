// Self-drawing esoteric markers that ride the flow. Dark plate, gold ink (refinement round 1):
// each marker sits on a small backing plate with corner ticks, gold glyph + label, and a bright tether dot on the
// particle it names. They drift with the wall; when their hold ends they retract IN PLACE — only a marker that
// truly reaches the throat is eaten.
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
    const v0 = 0.42 + Math.random() * 0.42;
    const ang0 = camAng + Math.PI + (Math.random() - 0.5) * 2.0;
    const g = el('g', { class: 'mk' });
    const lead = el('line', { class: 'lead draw', pathLength: 1 });
    const dot = el('circle', { r: 2.8, class: 'tdot', style: 'opacity:0;transition:opacity .4s ease' });
    const body = el('g', { class: 'mkbody' });
    // plate: sized after the label is measured
    const plate = el('rect', { class: 'mkplate', rx: 1.5 });
    const ticks = [0, 1, 2, 3].map(() => el('path', { class: 'tick' }));
    body.appendChild(plate); ticks.forEach(t => body.appendChild(t));
    const gls = GLYPHS[(Math.random() * GLYPHS.length) | 0].map((s, i) => { const e = shape(s); e.setAttribute('class', 'gl draw'); e.style.transitionDelay = (0.1 + i * 0.08) + 's'; body.appendChild(e); return e; });
    const lab = el('text', { x: 26, y: 5, class: 'lab', style: 'opacity:0;transition:opacity .5s ease .2s' });
    lab.textContent = LABELS[(Math.random() * LABELS.length) | 0];
    body.appendChild(lab); g.appendChild(lead); g.appendChild(body); g.appendChild(dot); svg.appendChild(g);
    let tw = lab.textContent.length * 10.4; try { tw = Math.max(tw * 0.8, Math.min(tw, lab.getComputedTextLength())); } catch (e) {}
    const x0 = -24, y0 = -24, w = 26 + tw + 34, h = 48;
    plate.setAttribute('x', x0); plate.setAttribute('y', y0); plate.setAttribute('width', w); plate.setAttribute('height', h);
    const tk = 6, X1 = x0 + w, Y1 = y0 + h;
    ticks[0].setAttribute('d', `M${x0} ${y0 + tk} V${y0} H${x0 + tk}`); ticks[1].setAttribute('d', `M${X1 - tk} ${y0} H${X1} V${y0 + tk}`);
    ticks[2].setAttribute('d', `M${x0} ${Y1 - tk} V${Y1} H${x0 + tk}`); ticks[3].setAttribute('d', `M${X1 - tk} ${Y1} H${X1} V${Y1 - tk}`);
    g.getBoundingClientRect();
    body.classList.add('on');
    lead.style.strokeDashoffset = '0'; gls.forEach(e => e.style.strokeDashoffset = '0'); lab.style.opacity = '1'; dot.style.opacity = '1';
    live.push({ g, lead, dot, body, gls, lab, v: v0, ang: ang0, age: 0, hold: 4.0 + Math.random() * 2.5, closing: false, eaten: false, done: false, eatT: 0 });
  }
  let acc = 0;
  function update(dt) {
    const st = getState();
    acc += dt;
    if (acc > 5.5) { acc = 0; if (live.length < 2 && st.s < 0.9 && Math.random() < 0.7) spawn(st); }
    for (const m of live) {
      m.age += dt;
      // ride the flow with the wall: slow inward drift + the spin. The marker stays with what it names.
      const k = 1 + 2 * Math.pow(1 - m.v, 2);
      m.v -= dt * 0.006 * k * (m.eaten ? 8 : 1);
      m.ang += dt * (omega + wind * 0.04 * k);
      const a = project(m.v, m.ang, 0.9), t = project(m.v - 0.1, m.ang + 0.45, 0.9);
      const off = a.behind || a.x < -80 || a.x > innerWidth + 80 || a.y < -80 || a.y > innerHeight + 80;
      if (!m.closing && (m.age > m.hold || off)) {                       // hold over: retract in place
        m.closing = true; m.eatT = 0;
        m.lead.style.strokeDashoffset = '1'; m.gls.forEach(e => e.style.strokeDashoffset = '1'); m.lab.style.opacity = '0'; m.dot.style.opacity = '0';
        m.body.classList.remove('on');
      }
      if (!m.eaten && m.v < 0.14) {                                       // it actually reached the throat: eaten
        m.eaten = true; if (!m.closing) { m.closing = true; m.eatT = 0; m.lead.style.strokeDashoffset = '1'; m.gls.forEach(e => e.style.strokeDashoffset = '1'); m.lab.style.opacity = '0'; m.dot.style.opacity = '0'; m.body.classList.remove('on'); }
      }
      if (m.closing) { m.eatT += dt; if (m.eatT > 1.0) { m.done = true; m.g.remove(); continue; } }
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

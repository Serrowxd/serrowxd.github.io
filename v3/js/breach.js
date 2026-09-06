// THE BREACH — a found secret. Hold the pointer on the throat for 5s: the vortex winds up, the dust gathers into a
// ring at the rim, the core burns hotter; release before full charge and it relaxes. At full charge the dam breaks.
import * as THREE from 'three';
export function initBreach({ camera, prompt, onCharge, onBreak }) {
  const v3 = new THREE.Vector3();
  let charge = 0, charging = false, hover = false, armed = true, tx = 0, ty = 0, zone = 80;
  function inZone(x, y) { return Math.hypot(x - tx, y - ty) < zone; }
  addEventListener('pointermove', e => { hover = armed && inZone(e.clientX, e.clientY); prompt.style.opacity = hover && charge < 1 ? 1 : 0; prompt.textContent = charging ? 'BREACHING' : 'HOLD TO BREACH'; });
  addEventListener('pointerdown', e => { if (armed && e.button === 0 && inZone(e.clientX, e.clientY)) { charging = true; prompt.textContent = 'BREACHING'; } });
  const release = () => { charging = false; prompt.textContent = 'HOLD TO BREACH'; };
  addEventListener('pointerup', release); addEventListener('pointercancel', release); addEventListener('blur', release);
  function update(dt) {
    if (!armed) return;
    v3.set(0, 0, -1.6).project(camera);
    tx = (v3.x * 0.5 + 0.5) * innerWidth; ty = (-v3.y * 0.5 + 0.5) * innerHeight;
    zone = 0.1 * Math.min(innerWidth, innerHeight);
    if (charging) charge = Math.min(1, charge + dt / 5.0); else charge = Math.max(0, charge - dt / 1.2);
    onCharge(charge);
    if (charge >= 1) { armed = false; charging = false; prompt.style.opacity = 0; onBreak(); }
  }
  function rearm() { charge = 0; charging = false; armed = true; }
  return { update, rearm, get charge() { return charge; } };
}

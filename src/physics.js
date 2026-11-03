// Ball flight and bounce. Pure functions on plain objects so the solver, the
// AI's prediction and the tests all run the exact same integrator.
//
// Coordinates: x across the court, y up, z along it. Net at z = 0, the human
// plays the near half (z > 0). Spin ω is in rad/s; topspin for a ball moving in
// horizontal direction d is +s·(up × d).

import { COURT } from './config.js';

export const GRAVITY = 9.81;
export const DRAG = 0.0206;     // ½·ρ·Cd·A / m  for a 57 g ball
export const MAGNUS = 0.00092;  // lift per (rad/s · m/s), C_L ≈ 0.25 at rally speeds
export const SPIN_DECAY = 0.04; // fraction per second
export const DT = 1 / 240;

const R = COURT.ballRadius;

export function makeBall(p = { x: 0, y: 1, z: 0 }, v = { x: 0, y: 0, z: 0 }, w = { x: 0, y: 0, z: 0 }) {
  return { p: { ...p }, v: { ...v }, w: { ...w } };
}

export function cloneBall(b) {
  return { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
}

export function netHeightAt(x) {
  const t = Math.min(1, Math.abs(x) / COURT.netPostX);
  return COURT.netHeightCenter + (COURT.netHeightPost - COURT.netHeightCenter) * t * t;
}

/** Topspin axis for horizontal direction (dx, dz): up × d. */
export function topspinAxis(dx, dz) {
  const l = Math.hypot(dx, dz) || 1;
  return { x: dz / l, y: 0, z: -dx / l };
}

/** Advance the ball through the air (no collisions). */
export function integrate(b, dt, wind) {
  const wx = wind ? wind.x : 0;
  const wz = wind ? wind.z : 0;
  const rx = b.v.x - wx, ry = b.v.y, rz = b.v.z - wz;
  const sp = Math.hypot(rx, ry, rz);
  const w = b.w;
  const ax = -DRAG * sp * rx + MAGNUS * (w.y * rz - w.z * ry);
  const ay = -GRAVITY - DRAG * sp * ry + MAGNUS * (w.z * rx - w.x * rz);
  const az = -DRAG * sp * rz + MAGNUS * (w.x * ry - w.y * rx);
  b.v.x += ax * dt;
  b.v.y += ay * dt;
  b.v.z += az * dt;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt;
  b.p.z += b.v.z * dt;
  const k = 1 - SPIN_DECAY * dt;
  w.x *= k; w.y *= k; w.z *= k;
}

/**
 * Bounce off the ground with friction acting on the contact patch.
 * Thin-shell ball (I = ⅔mR²): an impulse J along the slip direction changes the
 * contact-point velocity by 2.5·J/m, so slip stops at J = |v_c|/2.5. Friction is
 * capped at μ·(1+e)·|v_y|. Topspin reduces slip (ball keeps pace and kicks),
 * backspin increases it (ball checks / skids low on fast courts).
 */
export function bounce(b, surface) {
  const vy = b.v.y;
  const e = surface.cor;
  const jn = (1 + e) * Math.max(0, -vy);
  const cx = b.v.x + R * b.w.z;
  const cz = b.v.z - R * b.w.x;
  const cs = Math.hypot(cx, cz);
  if (cs > 1e-6) {
    const jt = Math.min(surface.mu * jn, cs / 2.5);
    const fx = -jt * cx / cs;
    const fz = -jt * cz / cs;
    b.v.x += fx;
    b.v.z += fz;
    const k = 1 / ((2 / 3) * R * R);
    b.w.x += k * (-R * fz);
    b.w.z += k * (R * fx);
  }
  b.v.y = -vy * e;
  b.p.y = R;
}

/**
 * One fixed step including ground and net collisions.
 * Returns null or an event: { type: 'bounce'|'net'|'netcord', x, z, y }.
 * `rng` is only used for net-cord deflections; pass Math.random in play and a
 * deterministic function in tests/prediction.
 */
export function step(b, dt, surface, wind, rng = Math.random) {
  const z0 = b.p.z;
  const x0 = b.p.x;
  const y0 = b.p.y;
  integrate(b, dt, wind);
  let ev = null;

  // Net plane crossing
  if ((z0 > 0) !== (b.p.z > 0) && z0 !== b.p.z) {
    const t = z0 / (z0 - b.p.z);
    const x = x0 + (b.p.x - x0) * t;
    const y = y0 + (b.p.y - y0) * t;
    if (Math.abs(x) <= COURT.netPostX) {
      const h = netHeightAt(x);
      const fromSide = Math.sign(z0) || 1;
      if (y - R < h - 0.02) {
        // Into the net: the ball dies and drops on the hitter's side.
        b.p.z = fromSide * (R + 0.01);
        b.v.z = -b.v.z * 0.08;
        b.v.x *= 0.25;
        b.v.y = Math.min(b.v.y, 0) * 0.3;
        b.w.x *= 0.2; b.w.y *= 0.2; b.w.z *= 0.2;
        ev = { type: 'net', x, y, z: 0 };
      } else if (y - R < h + 0.01) {
        // Clipped the tape: lose most of the pace, pop up, maybe roll over.
        const over = rng() < 0.62;
        const keep = 0.18 + rng() * 0.22;
        b.v.z = (over ? 1 : -1) * Math.abs(b.v.z) * keep * -fromSide;
        b.v.y = Math.abs(b.v.y) * 0.25 + 0.8 + rng() * 1.6;
        b.v.x *= 0.5;
        b.w.x *= 0.3; b.w.y *= 0.3; b.w.z *= 0.3;
        b.p.z = (over ? -fromSide : fromSide) * (R + 0.01);
        b.p.y = h + R + 0.01;
        ev = { type: 'netcord', x, y, z: 0, over };
      }
    }
  }

  if (b.p.y <= R && b.v.y < 0) {
    const real = b.v.y < -0.3; // below this the ball is rolling, not bouncing
    if (real) {
      // Interpolate back to the touchdown point for an accurate line call.
      const over = (R - b.p.y) / -b.v.y;
      b.p.x -= b.v.x * over;
      b.p.z -= b.v.z * over;
    }
    const tx = b.p.x, tz = b.p.z;
    const speedIn = Math.hypot(b.v.x, b.v.y, b.v.z);
    bounce(b, surface);
    if (!ev && real) ev = { type: 'bounce', x: tx, z: tz, y: R, speed: speedIn };
  }

  // Rolling along the ground: settle tiny bounces.
  if (b.p.y <= R + 1e-4 && Math.abs(b.v.y) < 0.35) {
    b.v.y = 0;
    b.p.y = R;
    b.v.x *= 1 - 0.9 * dt;
    b.v.z *= 1 - 0.9 * dt;
  }
  return ev;
}

/**
 * Simulate ahead and return sampled positions plus bounce/net events.
 * Net cords are treated as clean passes (prediction cannot know the outcome).
 */
export function predict(ball, surface, wind, { duration = 3, sampleEvery = 4, stopAfterBounces = 2 } = {}) {
  const b = cloneBall(ball);
  const samples = [];
  const events = [];
  let bounces = 0;
  const steps = Math.ceil(duration / DT);
  const rng = () => 0.99;
  for (let i = 1; i <= steps; i++) {
    const ev = step(b, DT, surface, wind, rng);
    const t = i * DT;
    if (ev) {
      events.push({ ...ev, t });
      if (ev.type === 'bounce') bounces++;
      if (ev.type === 'net') break;
    }
    if (i % sampleEvery === 0 || ev) {
      samples.push({ t, x: b.p.x, y: b.p.y, z: b.p.z, vx: b.v.x, vy: b.v.y, vz: b.v.z, bounces });
    }
    if (bounces >= stopAfterBounces) break;
  }
  return { samples, events };
}

/**
 * Air-only flight until the ball first touches down (used by the shot solver).
 * Returns landing distance along the launch direction, the height when the
 * ball crosses z = 0 (null if it never does) and the flight time.
 */
export function flyToGround(b, wind, maxT = 4) {
  let netY = null;
  let netX = null;
  let t = 0;
  while (t < maxT) {
    const z0 = b.p.z, y0 = b.p.y, x0 = b.p.x;
    integrate(b, DT, wind);
    t += DT;
    if (netY === null && (z0 > 0) !== (b.p.z > 0) && z0 !== b.p.z) {
      const f = z0 / (z0 - b.p.z);
      netY = y0 + (b.p.y - y0) * f;
      netX = x0 + (b.p.x - x0) * f;
    }
    if (b.p.y <= R && b.v.y < 0) {
      const over = (R - b.p.y) / Math.max(1e-6, -b.v.y);
      b.p.x -= b.v.x * over;
      b.p.z -= b.v.z * over;
      b.p.y = R;
      return { x: b.p.x, z: b.p.z, netY, netX, t };
    }
  }
  return { x: b.p.x, z: b.p.z, netY, netX, t };
}

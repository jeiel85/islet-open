// Shot solver: find the launch velocity that clears the net at a chosen height
// and first lands on a chosen target, under drag, Magnus lift and wind.
// For a launch angle, the speed that reaches the target distance is unique;
// the net-crossing height then rises monotonically with the angle. Both are
// solved with bracketed false position (Illinois), which needs a handful of
// trial flights instead of the dozens plain bisection would. If the needed
// speed exceeds the player's limit, fall back to the flattest trajectory at
// that speed (the ball loops higher instead).

import { flyToGround, topspinAxis, makeBall } from './physics.js';

const DEG = Math.PI / 180;
const S_MIN = 1;
const S_MAX = 90;
const DIST_TOL = 0.003; // m along the shot
const NET_TOL = 0.004;  // m over the net

function launch(from, dx, dz, theta, speed, spinVec) {
  const c = Math.cos(theta);
  return makeBall(
    from,
    { x: dx * c * speed, y: Math.sin(theta) * speed, z: dz * c * speed },
    spinVec,
  );
}

function landingAlong(from, dx, dz, theta, speed, spinVec, wind) {
  const r = flyToGround(launch(from, dx, dz, theta, speed, spinVec), wind);
  return { dist: (r.x - from.x) * dx + (r.z - from.z) * dz, r };
}

/**
 * Root of an increasing function on [a, b] with f(a) < 0 ≤ f(b). Uses Illinois
 * false position while both end values are finite, bisection otherwise
 * (f may return ±Infinity where it is undefined).
 */
export function findRoot(f, a, b, fa, fb, tol, maxIter = 40) {
  let side = 0;
  let x = b, fx = fb;
  for (let i = 0; i < maxIter; i++) {
    const finite = Number.isFinite(fa) && Number.isFinite(fb) && fb !== fa;
    x = finite ? (a * fb - b * fa) / (fb - fa) : (a + b) / 2;
    if (!(x > a && x < b)) x = (a + b) / 2;
    fx = f(x);
    if (Math.abs(fx) <= tol || b - a < 1e-7) return { x, fx };
    if (fx < 0) {
      a = x; fa = fx;
      if (side === -1 && Number.isFinite(fb)) fb /= 2;
      side = -1;
    } else {
      b = x; fb = fx;
      if (side === 1 && Number.isFinite(fa)) fa /= 2;
      side = 1;
    }
  }
  return { x, fx };
}

function speedForDistance(from, dx, dz, theta, D, spinVec, wind) {
  const f = (sp) => landingAlong(from, dx, dz, theta, sp, spinVec, wind).dist - D;
  const fb = f(S_MAX);
  if (fb < 0) return null;
  return findRoot(f, S_MIN, S_MAX, f(S_MIN), fb, DIST_TOL).x;
}

function solveOnce(from, aim, D, spin, sidespin, netY, maxSpeed, wind) {
  let dx = aim.x - from.x, dz = aim.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  const ax = topspinAxis(dx, dz);
  const spinVec = { x: ax.x * spin, y: sidespin, z: ax.z * spin };

  // Angle so that the net-crossing height hits netY (−∞ where no speed reaches D).
  let best = null;
  const g = (theta) => {
    const s = speedForDistance(from, dx, dz, theta, D, spinVec, wind);
    if (s === null) return -Infinity;
    const r = flyToGround(launch(from, dx, dz, theta, s, spinVec), wind);
    const crossY = r.netY === null ? Infinity : r.netY;
    const cand = { theta, speed: s, r, err: Math.abs(crossY - netY) };
    if (!best || cand.err < best.err) best = cand;
    return crossY - netY;
  };
  const lo = -25 * DEG, hi = 72 * DEG;
  findRoot(g, lo, hi, g(lo), g(hi), NET_TOL);

  if (!best || best.speed > maxSpeed) {
    // Speed-limited: the flattest angle that still reaches D at maxSpeed.
    const f = (theta) => landingAlong(from, dx, dz, theta, maxSpeed, spinVec, wind).dist - D;
    const tlo = -25 * DEG, thi = 40 * DEG;
    const fa = f(tlo), fb = f(thi);
    let theta;
    if (fa >= 0) theta = tlo;
    else if (fb < 0) theta = thi;
    else theta = findRoot(f, tlo, thi, fa, fb, DIST_TOL).x;
    best = { theta, speed: maxSpeed, r: flyToGround(launch(from, dx, dz, theta, maxSpeed, spinVec), wind) };
  }

  const ball = launch(from, dx, dz, best.theta, best.speed, spinVec);
  return { v: ball.v, w: ball.w, speed: best.speed, theta: best.theta, landing: best.r, dx, dz };
}

/**
 * @param {object} o
 * @param {{x,y,z}} o.from      contact point
 * @param {{x,z}}   o.target    intended first bounce
 * @param {number}  o.spin      topspin (+) / backspin (−) in rad/s
 * @param {number}  o.sidespin  rad/s about the vertical axis
 * @param {number}  o.netY      absolute height of the ball centre over the net
 * @param {number}  o.maxSpeed  m/s
 */
export function solveShot({ from, target, spin = 0, sidespin = 0, netY = 1.6, maxSpeed = 40, wind = null }) {
  const aim = { x: target.x, z: target.z };
  let sol = null;
  for (let iter = 0; iter < 3; iter++) {
    const D = Math.hypot(target.x - from.x, target.z - from.z);
    sol = solveOnce(from, aim, D, spin, sidespin, netY, maxSpeed, wind);
    // Correct the aim for sideways drift (wind, sidespin).
    const ex = sol.landing.x - target.x;
    const ez = sol.landing.z - target.z;
    const px = -sol.dz, pz = sol.dx; // perpendicular
    const lat = ex * px + ez * pz;
    if (Math.abs(lat) < 0.03) break;
    aim.x -= lat * px;
    aim.z -= lat * pz;
  }
  return sol;
}

export function kmh(ms) {
  return Math.round(ms * 3.6);
}

const NET = 0.914;
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Spin, net clearance and speed cap for a groundstroke/volley type.
 * q is contact quality 0..1 (timing, reach, height).
 */
export function shotRecipe(type, profile, q, { defensive = false } = {}) {
  const pw = profile.power, sp = profile.spin;
  switch (type) {
    case 'flat':
      return { spin: 40 + 40 * sp, sidespin: 0, netY: NET + lerp(1.05, 0.32, q * (0.4 + 0.6 * pw)), maxSpeed: (31 + 14 * pw) * (0.72 + 0.28 * q) };
    case 'slice':
      return { spin: -(120 + 110 * sp), sidespin: 0, netY: NET + lerp(0.95, 0.42, q), maxSpeed: (22 + 9 * pw) * (0.8 + 0.2 * q) };
    case 'lob':
      return { spin: 90 + 90 * sp, sidespin: 0, netY: NET + 4.6 + 1.6 * (1 - q), maxSpeed: 32 };
    case 'drop':
      return { spin: -(170 + 80 * sp), sidespin: 0, netY: NET + 0.32 + 0.45 * (1 - q), maxSpeed: 17 };
    case 'smash':
      return { spin: 20, sidespin: 0, netY: NET + 0.6, maxSpeed: (40 + 14 * pw) * (0.75 + 0.25 * q) };
    case 'topspin':
    default: {
      const clear = defensive ? 2.6 : lerp(1.55, 0.72, q * (0.35 + 0.65 * pw));
      return { spin: 170 + 200 * sp, sidespin: 0, netY: NET + clear, maxSpeed: (27 + 12 * pw) * (0.74 + 0.26 * q) };
    }
  }
}

/** Serve recipes: flat (fast), slice (curves to the server's left), kick (high topspin). */
export function serveRecipe(type, profile, q, serveNo) {
  const sv = profile.serve;
  const safe = serveNo === 2 ? 1 : 0;
  switch (type) {
    case 'slice':
      return { spin: 90, sidespin: 200 + 90 * profile.spin, netY: NET + lerp(0.6, 0.3, q) + 0.15 * safe, maxSpeed: (40 + 11 * sv) * (0.85 + 0.15 * q) };
    case 'kick':
      return { spin: 300 + 90 * profile.spin, sidespin: -60, netY: NET + 0.75 + 0.15 * safe, maxSpeed: (35 + 9 * sv) * (0.85 + 0.15 * q) };
    case 'flat':
    default:
      return { spin: 40, sidespin: 0, netY: NET + lerp(0.5, 0.18, q) + 0.25 * safe, maxSpeed: (46 + 13 * sv) * (0.82 + 0.18 * q) * (safe ? 0.82 : 1) };
  }
}

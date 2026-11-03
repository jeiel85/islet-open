// Line calls. Court regions are measured to the outer edge of the lines, and a
// ball is IN when its footprint touches any part of a line. Line judges miss
// very close calls now and then — that is what challenges are for.

import { COURT } from './config.js';

// Half-length of the compressed contact footprint (≈ the "mark" the review shows).
export const MARK_RADIUS = 0.016;

/** Singles half of the court on side `side` (+1 near, −1 far). */
export function courtRegion(side) {
  const L = COURT.halfLength, W = COURT.singlesHalfWidth;
  return side > 0
    ? { xMin: -W, xMax: W, zMin: 0, zMax: L }
    : { xMin: -W, xMax: W, zMin: -L, zMax: 0 };
}

/**
 * Service box the server must hit. serverSide: +1 near / −1 far.
 * courtSide: 'deuce' | 'ad' from the server's point of view. The target box is
 * diagonally opposite: the receiver's right half for deuce, left half for ad.
 * The receiver faces the opposite way, so their right is −serverSide in x.
 */
export function serviceBox(serverSide, courtSide) {
  const W = COURT.singlesHalfWidth, S = COURT.serviceLine, c = COURT.centerLineHalf;
  const recv = -serverSide;
  const rightSign = recv; // near player's right is +x, far player's right is −x
  const sign = courtSide === 'deuce' ? rightSign : -rightSign;
  const xr = sign > 0 ? { xMin: -c, xMax: W } : { xMin: -W, xMax: c };
  const zr = recv > 0 ? { zMin: 0, zMax: S } : { zMin: -S, zMax: 0 };
  return { ...xr, ...zr };
}

/**
 * Signed distance (m) from the ball's footprint edge to the region boundary:
 * negative = inside by that much, positive = out by that much.
 */
export function outDistance(x, z, r) {
  const dx = Math.max(r.xMin - x, x - r.xMax);
  const dz = Math.max(r.zMin - z, z - r.zMax);
  let d;
  if (dx > 0 && dz > 0) d = Math.hypot(dx, dz);
  else d = Math.max(dx, dz);
  return d - MARK_RADIUS;
}

export function isIn(x, z, r) {
  return outDistance(x, z, r) <= 0;
}

/**
 * What the line judge calls. Only balls within 40 mm of the line can be
 * miscalled; the closer, the likelier. Returns true for an IN call.
 */
export function judgeCall(trueDistance, rng = Math.random, sharpness = 1) {
  const trueIn = trueDistance <= 0;
  const mm = Math.abs(trueDistance) * 1000;
  if (mm >= 40) return trueIn;
  const pWrong = 0.38 * (1 - mm / 40) / sharpness;
  return rng() < pWrong ? !trueIn : trueIn;
}

/** Human-readable review result, e.g. "OUT · 12 mm". */
export function reviewText(distance) {
  const mm = Math.max(1, Math.round(Math.abs(distance) * 1000));
  return distance <= 0 ? `IN · 선에 걸침 (${mm} mm 안쪽)` : `OUT · ${mm} mm 벗어남`;
}

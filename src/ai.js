// Movement planning and shot choice. Shared by the AI opponent and by the
// human player's auto-move assist (which simply uses perfect parameters).

import { COURT, IDEAL_CONTACT_AHEAD } from './config.js';

const L = COURT.halfLength;
const W = COURT.singlesHalfWidth;

export function gauss(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Pick where a player should stand to meet the ball.
 * @param pred      output of physics.predict() from the current ball state
 * @param player    { x, z, side }
 * @param opts      { speed, reaction, allowVolley, serveReturn }
 * @returns { x, z, t, y, bounced, hand, reachable } or null if the ball never comes
 */
export function findIntercept(pred, player, { speed, reaction = 0, allowVolley = false, serveReturn = false }) {
  const side = player.side;
  let best = null;
  let bestScore = -Infinity;
  let fallback = null;
  let fallbackShort = Infinity;

  for (const s of pred.samples) {
    if (s.bounces >= 2) break;
    if (side * s.z < 0.6) continue;              // not on our side yet
    if (Math.abs(s.z) > L + 5.5) continue;        // too deep to chase
    const volley = s.bounces === 0;
    if (volley && (serveReturn || !allowVolley)) continue;
    if (s.y < 0.3 || s.y > 2.3) continue;

    // Stand beside the ball (forehand or backhand) and slightly behind it.
    const right = side;                           // near player's right is +x
    const fx = s.x - right * 0.8;
    const bx = s.x + right * 0.8;
    const pz = s.z + side * IDEAL_CONTACT_AHEAD;
    const df = Math.hypot(fx - player.x, pz - player.z) - 0.35; // mild forehand preference
    const db = Math.hypot(bx - player.x, pz - player.z);
    const useFh = df <= db;
    const px = useFh ? fx : bx;
    const dist = Math.max(0, useFh ? df + 0.35 : db);
    const need = reaction + 0.12 + dist / speed;
    const slack = s.t - need;

    if (slack >= 0) {
      // Comfortable height around waist level, take it early rather than late,
      // and avoid drifting far behind the baseline.
      let score = -Math.abs(s.y - 1.0) * 1.2 - s.t * 0.35;
      score -= Math.max(0, Math.abs(s.z) - (L + 1.2)) * 0.9;
      if (volley) score += Math.abs(s.z) < 7 ? 0.6 : -1.5;
      if (s.vy > 0 && !volley) score -= 0.25;    // still rising after the bounce
      if (score > bestScore) {
        bestScore = score;
        best = { x: px, z: pz, t: s.t, y: s.y, bounced: !volley, hand: useFh ? 'fh' : 'bh', reachable: true };
      }
    } else if (-slack < fallbackShort) {
      fallbackShort = -slack;
      fallback = { x: px, z: pz, t: s.t, y: s.y, bounced: !volley, hand: useFh ? 'fh' : 'bh', reachable: false };
    }
  }
  return best || fallback;
}

/** First bounce of a prediction, if any. */
export function firstBounce(pred) {
  return pred.events.find((e) => e.type === 'bounce') || null;
}

/** Where to wait between shots. */
export function recoveryPosition(player, style, atNet, lastTargetX = 0) {
  const side = player.side;
  if (atNet) return { x: lastTargetX * 0.35, z: side * 3.2 };
  const depth = style === 'counter' ? 2.2 : style === 'baseliner' ? 1.4 : 0.9;
  return { x: lastTargetX * 0.25, z: side * (L + depth) };
}

/**
 * AI shot choice. Returns { type, target: { x, z } }.
 * ctx: { contact, side, opp, profile, diff, rng, rushed }
 */
export function chooseAiShot({ contact, side, opp, profile, diff, rng = Math.random, rushed = false }) {
  const oppSide = -side;
  const aggr = diff.aggression * (0.6 + 0.5 * profile.power);
  const margin = 1.05 - 0.6 * diff.aggression * (0.5 + 0.5 * profile.control);
  const openSign = Math.abs(opp.x) > 0.4 ? -Math.sign(opp.x) : (rng() < 0.5 ? -1 : 1);
  const awayX = openSign * (W - margin);
  const cz = Math.abs(contact.z);
  const oppAtNet = Math.abs(opp.z) < 7;
  const pushedBack = cz > L + 1.6;

  if (contact.y > 2.3 && cz < 10.5) {
    return { type: 'smash', target: { x: awayX * 0.9, z: oppSide * (L - margin - 1.2) } };
  }
  if (cz < 6.5) {
    const type = contact.y < 0.85 ? 'slice' : 'flat';
    const short = rng() < 0.35;
    return { type, target: { x: awayX, z: oppSide * (short ? 5.2 : L - margin - 0.6) } };
  }
  if (oppAtNet) {
    if (rng() < 0.22 + 0.2 * (1 - profile.power)) {
      return { type: 'lob', target: { x: -opp.x * 0.4, z: oppSide * (L - 1.7) } };
    }
    return { type: 'topspin', target: { x: awayX, z: oppSide * (L - 2.5 - rng() * 3) } };
  }
  if (pushedBack || rushed) {
    if (rng() < 0.35) return { type: 'lob', target: { x: (rng() - 0.5) * 2, z: oppSide * (L - 2) } };
    return { type: 'topspin', target: { x: (rng() - 0.5) * 2.4, z: oppSide * (L - 2.4) }, defensive: true };
  }
  if (Math.abs(opp.z) > L + 2.2 && rng() < 0.18 * aggr + 0.04) {
    return { type: 'drop', target: { x: (rng() - 0.5) * 4, z: oppSide * 2.6 } };
  }
  const attack = rng() < aggr * (contact.y > 1.1 ? 1.3 : 0.8) && cz < L + 0.5;
  let type = 'topspin';
  if (attack && contact.y > 0.8) type = 'flat';
  else if (profile.spin < 0.6 && rng() < 0.3) type = 'slice';
  else if (rng() < 0.12) type = 'slice';
  const toOpen = rng() < 0.35 + 0.45 * aggr;
  const cross = Math.abs(contact.x) > 0.6 ? -Math.sign(contact.x) : openSign;
  const tx = (toOpen ? openSign : cross) * (W - margin - (attack ? 0 : 0.5));
  const tz = oppSide * (L - margin - rng() * 1.6);
  return { type, target: { x: tx, z: tz } };
}

/** AI serve choice for serve number 1 or 2. */
export function chooseAiServe({ profile, serveNo, box, rng = Math.random }) {
  let type;
  const r = rng();
  if (serveNo === 2) type = r < 0.8 ? 'kick' : 'slice';
  else if (profile.serve > 0.8) type = r < 0.6 ? 'flat' : r < 0.85 ? 'slice' : 'kick';
  else type = r < 0.4 ? 'flat' : r < 0.75 ? 'slice' : 'kick';
  const spot = rng();
  return { type, spot: spot < 0.38 ? 'wide' : spot < 0.62 ? 'body' : 'T', box };
}

/** Translate wide/body/T into a target inside the service box. */
export function serveTarget(box, spot, margin = 0.45) {
  const posBox = box.xMax > 1; // box on the +x half
  const outer = posBox ? box.xMax - margin : box.xMin + margin;
  const inner = posBox ? box.xMin + margin * 0.7 : box.xMax - margin * 0.7;
  const x = spot === 'wide' ? outer : spot === 'T' ? inner : (outer + inner) / 2;
  const deep = box.zMax > 0 ? box.zMax - margin - 0.15 : box.zMin + margin + 0.15;
  return { x, z: deep };
}

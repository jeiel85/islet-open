// Match controller: serve, rally, line calls, challenges, scoring, stats.
// No rendering here — main.js reads the state every frame and listens to
// events for sound, commentary and HUD feedback.

import {
  COURT, SURFACES, WIND, FORMATS, DIFFICULTY, ROSTER, HIT_WINDOW, PERFECT_WINDOW,
  IDEAL_CONTACT_AHEAD, CHALLENGES_PER_SET, playerSpeed, playerReach,
} from './config.js';
import { makeBall, step, predict, DT, integrate } from './physics.js';
import { solveShot, shotRecipe, serveRecipe, kmh } from './shots.js';
import { createMatch, awardPoint, currentServer, serveSide } from './scoring.js';
import { courtRegion, serviceBox, outDistance, judgeCall, reviewText } from './linecall.js';
import {
  findIntercept, firstBounce, recoveryPosition, chooseAiShot, chooseAiServe, serveTarget, gauss,
} from './ai.js';

const L = COURT.halfLength;
const W = COURT.singlesHalfWidth;
const R = COURT.ballRadius;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const TOSS_VY = 5.3;
const TOSS_FROM_Y = 1.55;
const SERVE_CONTACT_Y = 2.75;
const SERVE_WINDOW = 0.2;
const DEAD_TIME = 2.1;
const REVIEW_REVEAL = 2.4; // verdict shown on the close-up
const REVIEW_TIME = 4.0;   // close-up ends
const RISK_MARGIN = { safe: 1.0, normal: 0.62, bold: 0.32 };

function newStats() {
  return {
    points: 0, aces: 0, doubleFaults: 0, firstIn: 0, firstTotal: 0, firstWon: 0,
    secondTotal: 0, secondWon: 0, winners: 0, unforced: 0, forced: 0,
    fastestServe: 0, challengesWon: 0, challengesLost: 0, perfects: 0,
  };
}

export class Game {
  constructor({ rng = Math.random } = {}) {
    this.rng = rng;
    this.listeners = new Set();
    this.surface = SURFACES.hard;
    this.windSetting = WIND.calm;
    this.windAngle = rng() * Math.PI * 2;
    this.wind = { x: 0, z: 0 };
    this.windAim = { x: 0, z: 0 };
    this.coach = { autoMove: true, serveSpot: 'body', rallyAim: 'cross', risk: 'normal', netRush: 'sometimes' };
    this.phase = 'idle';
    this.phaseT = 0;
    this.time = 0;
    this.paused = false;
    this.players = [];
    this.match = null;
    this.ball = { b: makeBall({ x: 0, y: -10, z: 0 }), live: false, visible: false, toss: false, bounces: 0, lastHitter: -1 };
    this.call = null;
    this.pending = null;
    this.review = null;
    this.incoming = null;
    this.rallyShots = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data, this); }

  // ── setup ────────────────────────────────────────────────────────────

  setSurface(id) { this.surface = SURFACES[id] || SURFACES.hard; }
  setWind(id) { this.windSetting = WIND[id] || WIND.calm; this.rollWind(); }

  makePlayer(idx, profile, side, human, diff) {
    return {
      idx, side, profile, human, diff,
      x: 0, z: side * (L + 1), vx: 0, vz: 0,
      speed: playerSpeed(profile) * (human ? 1 : diff.speedMul),
      reach: playerReach(profile),
      goal: null, plan: null, swing: null,
      prep: 0, prepHand: 'fh',
      atNet: false, rushing: false,
      stats: newStats(),
      challenges: CHALLENGES_PER_SET,
      mood: null, moodT: 0,
    };
  }

  startMatch({ humanId, aiId, formatId, difficultyId, demo = false }) {
    const diff = DIFFICULTY[difficultyId] || DIFFICULTY.pro;
    const hp = ROSTER.find((r) => r.id === humanId) || ROSTER[0];
    let ap = ROSTER.find((r) => r.id === aiId) || ROSTER[1];
    if (ap === hp) ap = ROSTER.find((r) => r !== hp);
    this.demo = demo;
    this.diff = diff;
    this.formatId = formatId;
    this.players = [
      this.makePlayer(0, hp, +1, !demo, demo ? DIFFICULTY.pro : diff),
      this.makePlayer(1, ap, -1, false, diff),
    ];
    const first = this.rng() < 0.5 ? 0 : 1;
    this.match = createMatch(FORMATS[formatId] || FORMATS.short, first);
    this.paused = false;
    this.emit('matchStart', { demo, first });
    this.setupPoint();
  }

  rollWind() {
    const s = this.windSetting.speed;
    this.windAngle += (this.rng() - 0.5) * 0.9;
    this.windBase = s;
    this.windAim = { x: Math.cos(this.windAngle) * s, z: Math.sin(this.windAngle) * s };
    this.wind = { ...this.windAim };
  }

  updateWind() {
    if (!this.windBase) { this.wind.x = 0; this.wind.z = 0; return; }
    const gusty = this.windSetting.id === 'gusty';
    const t = this.time;
    const g = 1 + (gusty ? 0.55 : 0.18) * Math.sin(t * 0.9) * Math.sin(t * 2.3 + 1.7);
    const a = this.windAngle + (gusty ? 0.35 : 0.1) * Math.sin(t * 0.37);
    this.wind.x = Math.cos(a) * this.windBase * g;
    this.wind.z = Math.sin(a) * this.windBase * g;
  }

  setupPoint() {
    this.server = currentServer(this.match);
    this.courtSide = serveSide(this.match);
    this.serveNo = 1;
    this.rollWind();
    this.setupServe();
  }

  servePositions() {
    const s = this.players[this.server];
    const r = this.players[1 - this.server];
    const d = this.courtSide === 'deuce' ? 1 : -1;
    return {
      server: { x: s.side * d * 0.85, z: s.side * (L + 0.35) },
      receiver: { x: r.side * d * 2.7, z: r.side * (L + (this.serveNo === 2 ? 0.5 : 1.3)) },
    };
  }

  setupServe() {
    const pos = this.servePositions();
    const s = this.players[this.server];
    const r = this.players[1 - this.server];
    for (const p of this.players) {
      p.vx = 0; p.vz = 0; p.plan = null; p.goal = null; p.swing = null; p.prep = 0;
      p.atNet = false; p.rushing = false; p.mood = null;
    }
    s.x = pos.server.x; s.z = pos.server.z;
    r.x = pos.receiver.x; r.z = pos.receiver.z;
    const b = this.ball;
    b.live = false; b.visible = true; b.toss = false; b.bounces = 0; b.lastHitter = -1;
    b.b = makeBall(this.handPos(s), { x: 0, y: 0, z: 0 });
    this.call = null;
    this.pending = null;
    this.review = null;
    this.incoming = null;
    this.rallyShots = 0;
    this.phase = 'preserve';
    this.phaseT = 0;
    this.aiServeDelay = 0.8 + this.rng() * 0.7;
    this.emit('serveReady', { server: this.server, serveNo: this.serveNo, courtSide: this.courtSide, human: s.human });
  }

  handPos(p) {
    return { x: p.x + p.side * 0.3, y: TOSS_FROM_Y - 0.5, z: p.z - p.side * 0.3 };
  }

  // ── input ───────────────────────────────────────────────────────────

  /**
   * input: { move: {x, y}, aim: {x, y}, shots: ['topspin'|...], challenge: bool, serveKey }
   * Screen space: x right, y up (towards the far court).
   */
  handleInput(input) {
    const human = this.players.find((p) => p.human);
    if (!human) return;
    this.input = input;
    if (input.challenge) this.tryChallenge(human.idx);
    for (const type of input.shots) {
      if (this.phase === 'preserve' && this.server === human.idx) {
        this.startToss();
      } else if (this.phase === 'toss' && this.server === human.idx) {
        const st = type === 'slice' ? 'slice' : type === 'lob' ? 'kick' : type === 'drop' ? 'slice' : 'flat';
        this.doServe(human, st, input.aim.x);
      } else if (this.phase === 'rally' || this.phase === 'dead') {
        this.humanSwing(human, type, input.aim);
      }
    }
  }

  // ── main loop ───────────────────────────────────────────────────────

  update(dt, input) {
    if (this.phase === 'idle' || this.paused) return;
    if (input) this.handleInput(input);
    const n = Math.min(16, Math.max(1, Math.round(dt / DT)));
    for (let i = 0; i < n; i++) this.tick(DT);
  }

  tick(h) {
    this.time += h;
    this.phaseT += h;
    this.updateWind();
    for (const p of this.players) this.updatePlayer(p, h);
    this.updateBall(h);

    switch (this.phase) {
      case 'preserve': {
        const s = this.players[this.server];
        this.ball.b.p = this.handPos(s);
        if (!s.human && this.phaseT > this.aiServeDelay) this.startToss();
        break;
      }
      case 'toss': {
        const s = this.players[this.server];
        if (!s.human && this.phaseT >= this.tossIdeal + s.serveDelta) {
          const c = chooseAiServe({ profile: s.profile, serveNo: this.serveNo, rng: this.rng });
          this.doServe(s, c.type, c.spot);
        } else if (this.ball.b.v.y < 0 && this.ball.b.p.y < 1.3) {
          this.emit('retoss', { server: this.server });
          this.setupServe();
        }
        break;
      }
      case 'rally':
        this.watchDeadBall(h);
        if (this.call && this.call.open && this.time - this.call.time > 2.2) this.call.open = false;
        break;
      case 'dead':
        if (this.phaseT > this.deadTime) this.resolvePending();
        else this.aiChallengeTick();
        break;
      case 'review':
        if (!this.review.revealed && this.phaseT > REVIEW_REVEAL) this.resolveReview();
        else if (this.review.revealed && this.phaseT > REVIEW_TIME) {
          this.review = null;
          this.phase = 'dead';
          this.phaseT = 0;
          this.deadTime = 0.6;
          this.aiChallengeDecided = true;
        }
        break;
      case 'between':
        if (this.phaseT > this.betweenTime) this.setupPoint();
        break;
      case 'over':
        if (this.demo && this.phaseT > 4) this.startMatch({ humanId: this.players[1].profile.id, aiId: this.players[0].profile.id, formatId: this.formatId, difficultyId: 'pro', demo: true });
        break;
    }
  }

  updateBall(h) {
    const b = this.ball;
    if (!b.visible || this.phase === 'preserve') return;
    if (b.toss) { integrate(b.b, h, null); return; }
    const ev = step(b.b, h, this.surface, this.wind, this.rng);
    // Back and side walls of the arena.
    const p = b.b.p, v = b.b.v;
    if (Math.abs(p.z) > COURT.runoffHalfLength - 0.1 && Math.sign(v.z) === Math.sign(p.z)) {
      v.z *= -0.35; v.x *= 0.6;
      if (this.phase === 'rally' && b.bounces === 0) this.offWall();
    }
    if (Math.abs(p.x) > COURT.runoffHalfWidth - 0.1 && Math.sign(v.x) === Math.sign(p.x)) {
      v.x *= -0.35; v.z *= 0.6;
      if (this.phase === 'rally' && b.bounces === 0) this.offWall();
    }
    if (!ev) return;
    if (this.phase === 'rally' && b.live) this.onBallEvent(ev);
    else if (ev.type === 'bounce') this.emit('bounce', { x: ev.x, z: ev.z, speed: ev.speed, live: false });
  }

  offWall() {
    const h = this.ball.lastHitter;
    this.endPoint(1 - h, 'out', { errorBy: h });
  }

  watchDeadBall(h) {
    const b = this.ball;
    const v = b.b.v;
    if (b.b.p.y < R + 0.02 && Math.hypot(v.x, v.y, v.z) < 0.7) {
      b.stillT = (b.stillT || 0) + h;
      if (b.stillT > 0.35) {
        const hitter = this.players[b.lastHitter];
        const onHitterSide = Math.sign(b.b.p.z) === hitter.side;
        if (onHitterSide) this.endPoint(1 - hitter.idx, 'net', { errorBy: hitter.idx });
        else this.endPoint(hitter.idx, 'winner');
      }
    } else b.stillT = 0;
  }

  // ── players ─────────────────────────────────────────────────────────

  updatePlayer(p, h) {
    if (p.swing) {
      p.swing.t += h;
      if (p.swing.t >= p.swing.dur) p.swing = null;
    }
    if (p.moodT > 0) { p.moodT -= h; if (p.moodT <= 0) p.mood = null; }
    this.updateBrain(p);

    let dvx = 0, dvz = 0;
    const manual = p.human && !this.coach.autoMove && this.input;
    const frozen = (this.phase === 'preserve' || this.phase === 'toss') && p.idx === this.server;
    if (frozen) {
      dvx = 0; dvz = 0;
    } else if (manual && this.phase !== 'between') {
      const m = this.input.move;
      const len = Math.hypot(m.x, m.y);
      const k = len > 1 ? 1 / len : 1;
      dvx = m.x * k * p.speed;
      dvz = -m.y * k * p.speed * p.side;
    } else if (p.goal) {
      const dx = p.goal.x - p.x, dz = p.goal.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const sp = Math.min(p.speed, d * 3.2 + 0.4);
        dvx = dx / d * sp;
        dvz = dz / d * sp;
      }
    }
    const swingSlow = p.swing && p.swing.kind !== 'toss' ? 0.45 : 1;
    dvx *= swingSlow; dvz *= swingSlow;
    const acc = 26 * h;
    p.vx += clamp(dvx - p.vx, -acc, acc);
    p.vz += clamp(dvz - p.vz, -acc, acc);
    if (frozen) { p.vx = 0; p.vz = 0; }
    p.x += p.vx * h;
    p.z += p.vz * h;
    p.x = clamp(p.x, -COURT.runoffHalfWidth + 0.6, COURT.runoffHalfWidth - 0.6);
    if (p.side > 0) p.z = clamp(p.z, 0.7, COURT.runoffHalfLength - 0.6);
    else p.z = clamp(p.z, -COURT.runoffHalfLength + 0.6, -0.7);
    p.atNet = Math.abs(p.z) < 7.2;

    // Racket preparation for the animation and the timing meter.
    const g = this.phase === 'rally' ? this.contactGeometry(p) : null;
    let prep = 0;
    if (g && g.legal && g.err > -0.8 && g.err < 0.25 && Math.abs(g.lateral) < p.reach + 1.2) {
      prep = clamp(1 + g.err / 0.55, 0, 1);
      p.prepHand = g.hand;
    }
    p.prep += (prep - p.prep) * Math.min(1, h * 14);
  }

  /** Goals and swing decisions for the AI and for the human's auto-move. */
  updateBrain(p) {
    if (this.phase === 'between') {
      if (!p.goal || !p.betweenGoal) {
        p.goal = this.nextPointSpot(p);
        p.betweenGoal = true;
      }
      return;
    }
    p.betweenGoal = false;
    if (this.phase !== 'rally') return;
    const b = this.ball;
    const auto = !p.human || this.coach.autoMove;
    const incoming = b.live && b.lastHitter !== p.idx && b.lastHitter >= 0;
    if (!incoming) {
      p.plan = null;
      if (auto && b.lastHitter === p.idx) p.goal = this.recoverySpot(p);
      return;
    }
    if (!p.plan) {
      const reaction = p.human ? 0.05 : p.diff.reaction;
      p.plan = {
        readyAt: b.hitT + reaction + (this.lastShot ? this.lastShot.deception : 0),
        intercept: null,
        delta: p.human ? 0 : clamp(gauss(this.rng) * p.diff.timingSigma, -0.13, 0.13),
        leave: false,
        bounceSeen: b.bounces,
      };
    }
    const plan = p.plan;
    if (this.time >= plan.readyAt && (!plan.intercept || plan.bounceSeen !== b.bounces)) {
      const refine = plan.intercept !== null;
      plan.bounceSeen = b.bounces;
      this.planIntercept(p, refine);
    }
    if (!p.human && !p.swing && plan.intercept) this.aiMaybeSwing(p);
  }

  planIntercept(p, refine) {
    const b = this.ball;
    const pred = predict(b.b, this.surface, this.wind, { duration: 3.4 });
    const ic = findIntercept(pred, p, {
      speed: p.speed,
      reaction: 0,
      allowVolley: p.atNet || p.rushing,
      serveReturn: b.isServe && b.bounces === 0,
    });
    if (p.idx === 0 || p.human) this.incoming = { pred, bounce: firstBounce(pred) };
    if (!ic) { p.plan.intercept = { none: true }; return; }
    let ex = 0, ez = 0;
    if (!p.human) {
      const k = refine ? 0.35 : 1;
      ex = gauss(this.rng) * p.diff.posErr * k;
      ez = gauss(this.rng) * p.diff.posErr * 0.5 * k;
      // Should the AI let a ball fly past because it is going out?
      const fb = firstBounce(pred);
      if (fb && b.bounces === 0) {
        const d = outDistance(fb.x, fb.z, b.isServe ? serviceBox(-p.side, this.courtSide) : courtRegion(p.side));
        p.plan.leave = d + gauss(this.rng) * p.diff.judge * 0.3 > 0.05;
      }
    }
    p.plan.intercept = ic;
    const auto = !p.human || this.coach.autoMove;
    if (auto) {
      p.goal = {
        x: clamp(ic.x + ex, -8.6, 8.6),
        z: p.side > 0 ? clamp(ic.z + ez, 0.9, L + 5.5) : clamp(ic.z + ez, -L - 5.5, -0.9),
      };
    }
  }

  recoverySpot(p) {
    const lastX = this.lastShot ? this.lastShot.target.x : 0;
    const rush = p.rushing;
    return recoveryPosition(p, p.profile.style, rush, lastX);
  }

  nextPointSpot(p) {
    // Walk towards where the next point starts (scoring already updated).
    const server = currentServer(this.match);
    const side = serveSide(this.match);
    const d = side === 'deuce' ? 1 : -1;
    if (p.idx === server) return { x: p.side * d * 0.85, z: p.side * (L + 0.35) };
    return { x: p.side * d * 2.7, z: p.side * (L + 1.3) };
  }

  // ── hitting ─────────────────────────────────────────────────────────

  /** Ball relative to a player: timing error (s), sideways distance, legality. */
  contactGeometry(p) {
    const b = this.ball;
    const bp = b.b.p, bv = b.b.v;
    let vh = Math.hypot(bv.x, bv.z);
    let ux, uz;
    if (vh < 1.5) { ux = 0; uz = p.side; vh = 1.5; } else { ux = bv.x / vh; uz = bv.z / vh; }
    const rx = bp.x - p.x, rz = bp.z - p.z;
    const along = rx * ux + rz * uz;
    const lateral = rx * uz - rz * ux;
    const err = (along + IDEAL_CONTACT_AHEAD) / vh;
    const hand = rx * p.side >= 0 ? 'fh' : 'bh';
    const legal = this.phase === 'rally' && b.live && b.lastHitter !== p.idx && b.lastHitter >= 0 &&
      p.side * bp.z > 0.05 && b.bounces < 2 && !(b.isServe && b.bounces === 0);
    const height = bp.y;
    const reachable = Math.abs(lateral) <= p.reach && height >= 0.1 && height <= 3.1;
    return { along, lateral, err, hand, legal, height, reachable, vh };
  }

  contactQuality(p, g) {
    const ae = Math.abs(g.err);
    let q = ae <= PERFECT_WINDOW ? 1 : 1 - (ae - PERFECT_WINDOW) / (HIT_WINDOW - PERFECT_WINDOW);
    q = clamp(q, 0, 1);
    const lat = Math.abs(g.lateral);
    const stretch = clamp((lat - (p.reach - 0.45)) / 0.45, 0, 1);
    const jam = clamp((0.3 - lat) / 0.3, 0, 1);
    q *= 1 - 0.45 * stretch;
    q *= 1 - 0.35 * jam;
    if (g.height < 0.35) q *= 0.75;
    else if (g.height > 1.9 && g.height < 2.35) q *= 0.85;
    const moving = Math.hypot(p.vx, p.vz) / p.speed;
    q *= 1 - 0.12 * clamp(moving - 0.5, 0, 1);
    return { q, stretched: stretch > 0.4 };
  }

  timingLabel(err) {
    const ae = Math.abs(err);
    if (ae <= PERFECT_WINDOW) return 'PERFECT';
    if (ae <= 0.075) return 'GOOD';
    return err < 0 ? 'EARLY' : 'LATE';
  }

  humanSwing(p, type, aim) {
    if (p.swing && p.swing.t < p.swing.dur * 0.75) return;
    const g = this.contactGeometry(p);
    if (g.legal && g.reachable && Math.abs(g.err) <= HIT_WINDOW) {
      this.performHit(p, type, aim, g);
      return;
    }
    p.swing = { kind: g.height > 2.35 ? 'smash' : g.hand, t: 0, dur: 0.4, whiff: true };
    if (g.legal && Math.abs(g.err) < 0.7) {
      this.emit('whiff', { player: p.idx, label: g.err < 0 ? 'EARLY' : 'LATE', reach: !g.reachable });
    }
  }

  aiMaybeSwing(p) {
    const g = this.contactGeometry(p);
    if (!g.legal) return;
    if (p.plan.leave && this.ball.bounces === 0) return;
    if (!g.reachable) return;
    if (g.err >= p.plan.delta && Math.abs(g.err) <= HIT_WINDOW) {
      const opp = this.players[1 - p.idx];
      const rushed = !p.plan.intercept.reachable || Math.hypot(p.goal ? p.goal.x - p.x : 0, p.goal ? p.goal.z - p.z : 0) > 1.2;
      const choice = chooseAiShot({
        contact: this.ball.b.p, side: p.side, opp, profile: p.profile, diff: p.diff, rng: this.rng, rushed,
      });
      this.performHit(p, choice.type, null, g, choice);
    }
  }

  humanTarget(p, type, aim) {
    const margin = RISK_MARGIN[this.coach.risk] || RISK_MARGIN.normal;
    const opp = this.players[1 - p.idx];
    const c = this.ball.b.p;
    let tx;
    const openSign = Math.abs(opp.x) > 0.3 ? -Math.sign(opp.x) : 1;
    if (Math.abs(aim.x) > 0.3) tx = Math.sign(aim.x) * (W - margin);
    else if (this.coach.rallyAim === 'center') tx = 0;
    else if (this.coach.rallyAim === 'open') tx = openSign * (W - margin - 0.3);
    else tx = (Math.abs(c.x) > 0.6 ? -Math.sign(c.x) : openSign) * (W - margin - 0.5);
    let depth = L - margin - 1.0;
    if (aim.y > 0.3) depth = L - margin - 0.25;
    else if (aim.y < -0.3) depth = 7.4;
    if (type === 'drop') depth = 2.6;
    if (type === 'lob') depth = L - 1.5 - margin * 0.4;
    // The human always plays the near end, so screen x is world x.
    return { x: tx, z: -p.side * depth };
  }

  performHit(p, type, aim, g, aiChoice = null) {
    const b = this.ball;
    const { q, stretched } = this.contactQuality(p, g);
    const volley = b.bounces === 0;
    let kind = g.hand;
    if (g.height > 2.35) {
      kind = 'smash';
      if (type !== 'lob') type = 'smash';
    }
    let target;
    let defensive = false;
    if (aiChoice) {
      target = { ...aiChoice.target };
      type = aiChoice.type;
      defensive = !!aiChoice.defensive;
      if (type === 'smash') kind = 'smash';
    } else {
      target = this.humanTarget(p, type, aim || { x: 0, y: 0 });
    }

    // Timing pulls or pushes the ball sideways: early forehands go to the
    // hitter's left, late ones to the right (mirrored on the backhand).
    const rightX = p.side;
    const tnorm = clamp(g.err / HIT_WINDOW, -1, 1);
    target.x += tnorm * 2.1 * (kind === 'bh' ? -1 : 1) * rightX;
    target.z += -p.side * tnorm * 0.4 * (kind === 'bh' ? -1 : 1);

    // Execution error grows with the incoming pace, a stretched or running
    // contact, and poor timing; control and the AI level shrink it.
    const ctrl = p.profile.control;
    const noiseMul = p.human ? 0.9 : p.diff.aimNoise;
    const pressure = 1 + clamp((g.vh - 16) / 22, 0, 0.7) + (stretched ? 0.35 : 0) +
      0.25 * clamp(Math.hypot(p.vx, p.vz) / p.speed - 0.4, 0, 1);
    const sigma = (0.25 + 0.6 * (1 - ctrl)) * (1.4 - 0.9 * q) * pressure * noiseMul * (volley ? 0.85 : 1);
    target.x += gauss(this.rng) * sigma;
    target.z += gauss(this.rng) * sigma * 1.2;

    const rec = shotRecipe(type, p.profile, q, { defensive });
    if (volley && type !== 'drop' && type !== 'lob') rec.maxSpeed *= 0.82;
    rec.netY += gauss(this.rng) * 0.16 * (1.5 - 0.8 * q) * (1.2 - 0.5 * ctrl) * pressure * noiseMul;

    // The AI's misses: a level-dependent chance that the shot simply goes
    // wrong. (The human's misses come from timing, reach and aim instead.)
    if (!p.human) {
      const risky = type === 'flat' || type === 'smash' ? 1.35 : type === 'drop' ? 1.6 : type === 'lob' ? 0.7 : 1;
      const chance = p.diff.errorRate * pressure * risky * (1.2 - 0.4 * ctrl);
      if (this.rng() < chance) this.spoilShot(p, target, rec);
    }
    const from = { x: b.b.p.x, y: Math.max(0.15, b.b.p.y), z: b.b.p.z };
    const sol = solveShot({ from, target, spin: rec.spin, sidespin: rec.sidespin, netY: rec.netY, maxSpeed: rec.maxSpeed, wind: this.windAim });

    b.b = makeBall(from, sol.v, sol.w);
    this.afterHit(p, { type, q, target, stretched, speed: sol.speed });
    const label = this.timingLabel(g.err);
    if (label === 'PERFECT') p.stats.perfects++;
    p.swing = { kind, t: 0, dur: 0.42, contactAt: 0.06 };
    this.emit('hit', { player: p.idx, human: p.human, type, kind, volley, q, label, speed: kmh(sol.speed), rally: this.rallyShots });
  }

  /** Extra reading time a well-struck, fast shot costs the opponent. */
  deception(shot) {
    const fast = clamp((shot.speed - 30) / 18, 0, 1);
    if (shot.type === 'serve') return (0.03 + 0.13 * fast) * (0.4 + 0.6 * shot.q);
    if (shot.type === 'flat' || shot.type === 'smash') return (0.05 + 0.16 * fast) * shot.q;
    if (shot.type === 'topspin') return 0.08 * fast * shot.q;
    if (shot.type === 'drop') return 0.12 * shot.q;
    return 0;
  }

  /** Turn a planned shot into a miss: into the net, long, or wide. */
  spoilShot(p, target, rec) {
    const r = this.rng();
    if (r < 0.38) {
      // Low over the net with a short target, so the speed cap cannot lift it clear.
      rec.netY = COURT.netHeightCenter - 0.08 - this.rng() * 0.3;
      target.z = -p.side * (1.5 + this.rng() * 3);
    } else if (r < 0.72) {
      const depth = Math.abs(target.z);
      target.z = -p.side * (Math.max(depth, L - 0.6) + 0.5 + this.rng() * 1.3);
    } else {
      const sx = Math.sign(target.x) || (this.rng() < 0.5 ? -1 : 1);
      target.x = sx * (W + 0.15 + this.rng() * 1.1);
    }
  }

  afterHit(p, shot) {
    const b = this.ball;
    b.live = true;
    b.isServe = shot.type === 'serve';
    b.bounces = 0;
    b.netTouched = false;
    b.lastHitter = p.idx;
    b.hitT = this.time;
    b.stillT = 0;
    this.rallyShots++;
    this.lastShot = { hitter: p.idx, deception: this.deception(shot), ...shot };
    if (this.call && this.call.receiver === p.idx) this.call.open = false;
    this.incoming = null;
    for (const pl of this.players) pl.plan = null;
    // Net rushing after a serve or an approach shot.
    const style = p.profile.style;
    const coachRush = { never: 0, sometimes: 0.3, often: 0.7 }[this.coach.netRush] ?? 0.3;
    let rushP = 0;
    if (shot.type === 'serve') rushP = style === 'serveVolley' && this.serveNo === 1 ? 0.85 : style === 'serveVolley' ? 0.35 : 0;
    else if (Math.abs(b.b.p.z) < L - 2.5 && shot.q > 0.55) rushP = style === 'serveVolley' ? 0.8 : style === 'allcourt' ? 0.45 : 0.15;
    if (p.human) rushP = shot.type === 'serve' ? coachRush * 0.5 : (Math.abs(b.b.p.z) < L - 2.5 ? coachRush : coachRush * 0.15);
    if (p.atNet) rushP = Math.max(rushP, 0.85);
    p.rushing = this.rng() < rushP;
    if (!p.human || this.coach.autoMove) p.goal = this.recoverySpot(p);
  }

  // ── serving ─────────────────────────────────────────────────────────

  startToss() {
    const s = this.players[this.server];
    const b = this.ball;
    const from = this.handPos(s);
    from.y = TOSS_FROM_Y;
    b.b = makeBall(from, { x: 0, y: TOSS_VY, z: -s.side * 0.3 });
    b.toss = true;
    b.live = false;
    b.visible = true;
    // Ideal contact: ball dropping back through SERVE_CONTACT_Y after the apex.
    const probe = makeBall(from, { x: 0, y: TOSS_VY, z: 0 });
    let t = 0;
    while (t < 2) {
      integrate(probe, DT, null);
      t += DT;
      if (probe.v.y < 0 && probe.p.y <= SERVE_CONTACT_Y) break;
    }
    this.tossIdeal = t;
    s.serveDelta = s.human ? 0 : clamp(gauss(this.rng) * s.diff.timingSigma * 1.3, -0.16, 0.16);
    s.swing = { kind: 'toss', t: 0, dur: 2 };
    this.phase = 'toss';
    this.phaseT = 0;
    this.emit('toss', { server: this.server, human: s.human });
  }

  spoilServe(s, box, target, rec) {
    const r = this.rng();
    if (r < 0.4) {
      rec.netY = COURT.netHeightCenter - 0.06 - this.rng() * 0.25;
      target.z *= 0.45;
    } else if (r < 0.75) target.z = box.zMax > 0 ? box.zMax + 0.08 + this.rng() * 0.8 : box.zMin - 0.08 - this.rng() * 0.8;
    else target.x = box.xMax > 1 ? box.xMax + 0.08 + this.rng() * 0.6 : box.xMin - 0.08 - this.rng() * 0.6;
  }

  /** aim: number (human: screen x −1..1) or 'wide'|'body'|'T' (AI). */
  doServe(s, type, aim) {
    const b = this.ball;
    const err = this.phaseT - this.tossIdeal;
    const ae = Math.abs(err);
    let q = ae <= 0.04 ? 1 : 1 - (ae - 0.04) / (SERVE_WINDOW - 0.04);
    const shank = ae > SERVE_WINDOW;
    q = clamp(q, 0, 1);
    const box = serviceBox(s.side, this.courtSide);
    let spot = aim;
    if (typeof aim === 'number') {
      if (Math.abs(aim) < 0.3) spot = this.coach.serveSpot;
      else {
        // Screen left/right → the lower/higher x end of the box.
        const posBox = box.xMax > 1;
        const towardHighX = aim > 0;
        spot = posBox === towardHighX ? 'wide' : 'T';
      }
    }
    const target = serveTarget(box, spot, this.serveNo === 2 ? 0.62 : 0.42);
    const ctrl = s.profile.control;
    const risky = type === 'flat' && this.serveNo === 1 ? 1.3 : 1;
    const sigma = (0.2 + 0.42 * (1 - ctrl)) * (1.6 - q) * risky * (this.serveNo === 2 ? 0.7 : 1) * (s.human ? 1 : s.diff.aimNoise) + (shank ? 1.2 : 0);
    target.x += gauss(this.rng) * sigma;
    target.z += gauss(this.rng) * sigma * 1.1;
    const rec = serveRecipe(type, s.profile, q, this.serveNo);
    rec.netY += gauss(this.rng) * 0.15 * (1.45 - q) * (1.1 - 0.5 * ctrl) - (shank ? 0.5 : 0);
    if (!s.human) {
      const base = this.serveNo === 1 ? s.diff.firstFault : s.diff.secondFault;
      if (this.rng() < base * (1.25 - 0.5 * s.profile.serve) * risky) this.spoilServe(s, box, target, rec);
    }
    const from = { ...b.b.p };
    const sol = solveShot({ from, target, spin: rec.spin, sidespin: rec.sidespin, netY: rec.netY, maxSpeed: rec.maxSpeed, wind: this.windAim });
    b.b = makeBall(from, sol.v, sol.w);
    b.toss = false;
    const speed = kmh(sol.speed);
    if (this.serveNo === 1) s.stats.firstTotal++; else s.stats.secondTotal++;
    s.stats.fastestServe = Math.max(s.stats.fastestServe, speed);
    this.serveSpeed = speed;
    this.phase = 'rally';
    this.phaseT = 0;
    this.afterHit(s, { type: 'serve', q, target, stretched: false, speed: sol.speed, serveType: type });
    this.ball.isServe = true;
    s.swing = { kind: 'serve', t: 0, dur: 0.5, contactAt: 0.08 };
    const label = shank ? (err < 0 ? 'EARLY' : 'LATE') : this.timingLabel(err * 0.8);
    this.emit('serve', { server: s.idx, human: s.human, speed, type, serveNo: this.serveNo, q, label });
  }

  // ── ball events, calls, outcomes ────────────────────────────────────

  onBallEvent(ev) {
    const b = this.ball;
    const h = b.lastHitter;
    const hitter = this.players[h];
    const recv = this.players[1 - h];
    if (ev.type === 'netcord') { b.netTouched = true; this.emit('netcord', ev); return; }
    if (ev.type === 'net') { b.netTouched = true; this.emit('net', ev); return; }

    this.emit('bounce', { x: ev.x, z: ev.z, speed: ev.speed, live: true });
    const bounceSide = Math.sign(ev.z) || hitter.side;
    if (b.bounces === 0) {
      b.bounces = 1;
      if (bounceSide === hitter.side) {
        if (b.isServe) return this.fault('net');
        return this.endPoint(recv.idx, 'net', { errorBy: h });
      }
      const region = b.isServe ? serviceBox(hitter.side, this.courtSide) : courtRegion(recv.side);
      const d = outDistance(ev.x, ev.z, region);
      const trueIn = d <= 0;
      const calledIn = judgeCall(d, this.rng);
      this.call = {
        d, trueIn, calledIn, x: ev.x, z: ev.z, region, vx: b.b.v.x, vz: b.b.v.z,
        hitter: h, receiver: recv.idx, isServe: b.isServe, serveNo: this.serveNo,
        against: calledIn ? recv.idx : h, open: true, time: this.time,
        recvDist: Math.hypot(recv.x - ev.x, recv.z - ev.z),
        close: Math.abs(d) < 0.25,
        surface: this.surface.id,
      };
      this.emit('call', { ...this.call });
      if (b.isServe && b.netTouched && calledIn) return this.let();
      if (!calledIn) {
        if (b.isServe) return this.fault('out');
        return this.endPoint(recv.idx, 'out', { errorBy: h });
      }
      if (b.isServe && this.serveNo === 1) hitter.stats.firstIn++;
      this.aiConsiderInCallChallenge();
      return;
    }
    if (b.bounces === 1) {
      b.bounces = 2;
      this.endPoint(h, b.isServe ? 'ace' : 'winner');
    }
  }

  let() {
    // A let voids the serve: it does not count as an attempt.
    const st = this.players[this.server].stats;
    if (this.serveNo === 1) st.firstTotal--; else st.secondTotal--;
    this.toDead({ kind: 'let' }, 1.2);
    this.emit('let', {});
  }

  fault(reason) {
    const kind = this.serveNo === 1 ? 'fault' : 'double';
    this.toDead({ kind, reason, winner: kind === 'double' ? 1 - this.server : undefined }, kind === 'fault' ? 1.5 : DEAD_TIME);
    this.emit('fault', { serveNo: this.serveNo, reason, double: kind === 'double' });
  }

  endPoint(winner, reason, extra = {}) {
    this.toDead({ kind: 'point', winner, reason, ...extra }, DEAD_TIME + Math.min(1, this.rallyShots * 0.05));
    this.emit('pointEnd', { winner, reason, ...extra, rally: this.rallyShots });
  }

  toDead(pending, time) {
    this.pending = pending;
    this.ball.live = false;
    this.phase = 'dead';
    this.phaseT = 0;
    this.deadTime = time;
    this.aiChallengeDecided = false;
    // Give the human time to think about a challenge.
    if (this.canChallenge(this.players.findIndex((p) => p.human))) this.deadTime = Math.max(this.deadTime, 2.6);
  }

  canChallenge(idx) {
    if (idx < 0) return false;
    const c = this.call;
    const p = this.players[idx];
    if (!c || !c.open || c.against !== idx || p.challenges <= 0) return false;
    if (this.phase === 'rally') return c.calledIn;          // stop play on an IN call
    if (this.phase === 'dead') return true;
    return false;
  }

  tryChallenge(idx) {
    if (!this.canChallenge(idx)) return false;
    this.startReview(idx, this.phase === 'rally');
    return true;
  }

  aiConsiderInCallChallenge() {
    const c = this.call;
    const p = this.players[c.receiver];
    if (p.human || p.challenges <= 0) return;
    const perceived = c.d + gauss(this.rng) * p.diff.challengeSense;
    if (perceived > 0.004 && this.rng() < 0.75) {
      // Stop play straight away, as players do.
      this.startReview(p.idx, true);
    }
  }

  aiChallengeTick() {
    if (this.aiChallengeDecided || this.phaseT < 0.7) return;
    this.aiChallengeDecided = true;
    const c = this.call;
    if (!c || !c.open) return;
    const p = this.players[c.against];
    if (p.human || p.challenges <= 0) return;
    const perceived = c.d + gauss(this.rng) * p.diff.challengeSense;
    const believesWrong = c.calledIn ? perceived > 0.004 : perceived < -0.004;
    if (believesWrong && this.rng() < 0.8) this.startReview(p.idx, false);
  }

  startReview(challenger, stoppedPlay) {
    const c = this.call;
    c.open = false;
    this.review = { challenger, stoppedPlay, call: c, revealed: false };
    this.ball.live = false;
    this.phase = 'review';
    this.phaseT = 0;
    this.emit('reviewStart', { challenger, call: { ...c }, stoppedPlay });
  }

  resolveReview() {
    const { challenger, stoppedPlay, call: c } = this.review;
    const ch = this.players[challenger];
    const overturned = c.calledIn !== c.trueIn;
    if (overturned) ch.stats.challengesWon++;
    else { ch.challenges--; ch.stats.challengesLost++; }

    if (c.calledIn && !c.trueIn) {
      if (c.isServe) {
        this.pending = c.serveNo === 1
          ? { kind: 'fault', reason: 'out' }
          : { kind: 'double', reason: 'out', winner: c.receiver };
        if (c.serveNo === 1) this.players[c.hitter].stats.firstIn = Math.max(0, this.players[c.hitter].stats.firstIn - 1);
      } else {
        this.pending = { kind: 'point', winner: c.receiver, reason: 'out', errorBy: c.hitter };
      }
    } else if (c.calledIn && c.trueIn) {
      if (stoppedPlay) this.pending = { kind: 'point', winner: c.hitter, reason: 'challengeStop' };
    } else if (!c.calledIn && c.trueIn) {
      if (c.isServe) {
        if (c.serveNo === 1) this.players[c.hitter].stats.firstIn++;
        this.pending = c.recvDist > 1.9 ? { kind: 'point', winner: c.hitter, reason: 'ace' } : { kind: 'replayServe' };
      } else {
        this.pending = c.recvDist > 3.0 ? { kind: 'point', winner: c.hitter, reason: 'winner' } : { kind: 'replay' };
      }
    }
    this.review.revealed = true;
    this.emit('reviewResult', { challenger, overturned, text: reviewText(c.d), call: { ...c }, pending: { ...this.pending } });
  }

  resolvePending() {
    const pd = this.pending;
    if (!pd) { this.setupPoint(); return; }
    switch (pd.kind) {
      case 'fault':
        this.serveNo = 2;
        this.setupServe();
        break;
      case 'let':
      case 'replayServe':
        this.setupServe();
        break;
      case 'replay':
        this.serveNo = 1;
        this.setupServe();
        break;
      case 'double':
        this.players[this.server].stats.doubleFaults++;
        this.awardTo(1 - this.server, 'double', pd);
        break;
      case 'point':
      default:
        this.awardTo(pd.winner, pd.reason, pd);
    }
  }

  awardTo(w, reason, pd) {
    const winner = this.players[w];
    const loser = this.players[1 - w];
    const server = this.players[this.server];
    winner.stats.points++;
    if (w === this.server) {
      if (this.serveNo === 1) server.stats.firstWon++; else server.stats.secondWon++;
    }
    if (reason === 'ace') { winner.stats.aces++; winner.stats.winners++; }
    else if (reason === 'winner') winner.stats.winners++;
    if (pd.errorBy !== undefined) {
      const ls = this.lastShot;
      const forced = !ls || ls.hitter !== pd.errorBy || ls.q < 0.55 || ls.stretched;
      if (forced) this.players[pd.errorBy].stats.forced++; else this.players[pd.errorBy].stats.unforced++;
    }
    const ev = awardPoint(this.match, w);
    if (ev.tiebreakStarted) for (const p of this.players) p.challenges++;
    if (ev.set !== null) for (const p of this.players) p.challenges = CHALLENGES_PER_SET;
    winner.mood = 'win'; winner.moodT = 1.6;
    loser.mood = 'lose'; loser.moodT = 1.6;
    this.emit('point', { winner: w, reason, ev, rally: this.rallyShots, serveNo: this.serveNo, server: this.server });
    if (ev.match !== null) {
      this.phase = 'over';
      this.phaseT = 0;
      winner.mood = 'champion'; winner.moodT = 99;
      this.emit('matchOver', { winner: w, demo: this.demo });
    } else {
      this.phase = 'between';
      this.phaseT = 0;
      this.betweenTime = ev.set !== null ? 3.4 : ev.game !== null ? 2.0 : 0.9;
      for (const p of this.players) { p.goal = null; p.betweenGoal = false; }
    }
  }

  // ── read-only helpers for the HUD ───────────────────────────────────

  humanTimingMeter() {
    const p = this.players.find((pl) => pl.human);
    if (!p) return null;
    if (this.phase === 'toss' && this.server === p.idx) {
      return { mode: 'serve', err: this.phaseT - this.tossIdeal, window: SERVE_WINDOW, perfect: 0.04 };
    }
    if (this.phase !== 'rally') return null;
    const g = this.contactGeometry(p);
    if (!g.legal || g.err < -0.9 || g.err > 0.3) return null;
    return { mode: 'rally', err: g.err, window: HIT_WINDOW, perfect: PERFECT_WINDOW, reachable: g.reachable, hand: g.hand };
  }

  /** Where the human would hit right now (for the aim reticle). */
  previewHumanTarget(aim) {
    const p = this.players.find((pl) => pl.human);
    if (!p || this.phase !== 'rally') return null;
    const b = this.ball;
    if (!b.live || b.lastHitter === p.idx) return null;
    return this.humanTarget(p, 'topspin', aim);
  }
}

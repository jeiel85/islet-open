// Voxel tennis players: a jointed box figure with a racket, posed from the
// game state (running, racket preparation, swings, serve, celebrations).
// Local forward is −z, the right hand is at +x.

import * as THREE from 'three';

const geoCache = new Map();
function box(w, h, d) {
  const k = `${w},${h},${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}

function part(parent, w, h, d, color, x, y, z, mats) {
  let m = mats.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set(color, m); }
  const mesh = new THREE.Mesh(box(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class PlayerModel {
  constructor(kit, { racket = true, scale = 1 } = {}) {
    const mats = new Map();
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.root.scale.setScalar(scale);

    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.body.add(this.hips);

    const leg = (sx) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.12, 0, 0);
      part(g, 0.17, 0.5, 0.2, kit.skin, 0, -0.25, 0, mats);           // thigh
      part(g, 0.16, 0.36, 0.18, kit.skin, 0, -0.68, 0, mats);         // shin
      part(g, 0.165, 0.12, 0.185, 0xffffff, 0, -0.8, 0, mats);         // sock
      part(g, 0.19, 0.1, 0.32, kit.shoes, 0, -0.88, -0.05, mats);      // shoe
      this.hips.add(g);
      return g;
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    part(this.torso, 0.44, 0.26, 0.26, kit.shorts, 0, 0.03, 0, mats);
    part(this.torso, 0.46, 0.55, 0.27, kit.shirt, 0, 0.43, 0, mats);
    part(this.torso, 0.47, 0.06, 0.28, kit.band, 0, 0.62, 0, mats);   // shirt trim

    this.head = new THREE.Group();
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    part(this.head, 0.12, 0.08, 0.12, kit.skin, 0, 0.04, 0, mats);
    part(this.head, 0.28, 0.3, 0.28, kit.skin, 0, 0.23, 0, mats);
    part(this.head, 0.3, 0.1, 0.3, kit.hair, 0, 0.38, 0.01, mats);
    part(this.head, 0.3, 0.16, 0.08, kit.hair, 0, 0.3, 0.12, mats);
    part(this.head, 0.295, 0.05, 0.295, kit.band, 0, 0.32, 0, mats);
    part(this.head, 0.05, 0.05, 0.02, 0x1a1a1a, -0.07, 0.25, -0.14, mats); // eyes
    part(this.head, 0.05, 0.05, 0.02, 0x1a1a1a, 0.07, 0.25, -0.14, mats);

    const arm = (sx) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.29, 0.64, 0);
      part(g, 0.12, 0.3, 0.13, kit.shirt, 0, -0.1, 0, mats);   // sleeve
      part(g, 0.11, 0.42, 0.12, kit.skin, 0, -0.42, 0, mats);  // forearm
      this.torso.add(g);
      return g;
    };
    this.armL = arm(-1);
    this.armR = arm(1);

    if (racket) {
      this.racket = new THREE.Group();
      this.racket.position.set(0, -0.62, 0);
      this.armR.add(this.racket);
      part(this.racket, 0.04, 0.26, 0.04, 0x222222, 0, -0.1, 0, mats);
      const frame = racketFrame(kit.racket || 0x1d1d1d, mats);
      frame.position.y = -0.42;
      this.racket.add(frame);
    }
    this.runPhase = Math.random() * 6;
    this.jump = 0;
  }

  /**
   * s: { speed, prep, prepHand, swing: {kind, t, dur}|null, mood, tossT, crouch }
   * Arms use Euler order YZX: X swings the arm forward/back from hanging,
   * Z lifts it out to the side, Y then sweeps a lifted arm around the body.
   */
  pose(s, dt) {
    const sp = Math.min(1, s.speed / 6);
    this.runPhase += dt * (5 + s.speed * 2.1);
    const run = Math.sin(this.runPhase);
    let legSwing = run * 0.75 * sp;
    let bodyY = Math.abs(Math.cos(this.runPhase)) * 0.06 * sp - 0.05 * (s.crouch ?? 1) * (1 - sp);
    let twist = 0, lean = 0.08 + 0.15 * sp;
    let rX = -run * 0.5 * sp + 0.25, rY = 0, rZ = 0.2;
    let lX = run * 0.5 * sp + 0.2, lY = 0, lZ = -0.2;
    let racketTilt = 0.9;
    let headX = 0;

    // Racket preparation: turn the shoulders, take the racket back.
    const prep = s.prep || 0;
    if (prep > 0.01 && !s.swing) {
      if (s.prepHand === 'fh') {
        twist = lerp(0, -0.8, prep);
        rX = lerp(rX, 0, prep); rZ = lerp(rZ, 1.2, prep); rY = lerp(0, -0.9, prep);
        lX = lerp(lX, 1.1, prep); lZ = lerp(lZ, 0.2, prep);
      } else {
        twist = lerp(0, 0.9, prep);
        rX = lerp(rX, 0, prep); rZ = lerp(rZ, 1.2, prep); rY = lerp(0, 2.7, prep);
        lX = lerp(lX, 1.0, prep); lZ = lerp(lZ, 0.6, prep);
      }
      racketTilt = lerp(racketTilt, 0.2, prep);
    }

    const sw = s.swing;
    if (sw) {
      const u = clamp01(sw.t / sw.dur);
      const f = easeOut(Math.min(1, u * 1.7));
      if (sw.kind === 'fh') {
        twist = lerp(-0.8, 1.0, f);
        rX = 0; rZ = lerp(1.2, 1.0, f); rY = lerp(-0.9, 1.7, f);
        lX = lerp(1.1, 0.4, f); lZ = 0.3;
        racketTilt = lerp(0.2, 0.5, f);
      } else if (sw.kind === 'bh') {
        twist = lerp(0.9, -0.9, f);
        rX = 0; rZ = lerp(1.2, 1.05, f); rY = lerp(2.7, 0.1, f);
        lX = lerp(1.0, 1.4, f); lZ = lerp(0.6, 0.9, f); lY = lerp(0.6, -0.8, f);
        racketTilt = lerp(0.2, 0.5, f);
      } else if (sw.kind === 'toss') {
        const tt = clamp01((s.tossT || 0) / 0.5);
        lX = lerp(0.2, 3.0, tt); lZ = -0.1;
        rX = lerp(0.25, 3.7, tt); rZ = lerp(0.2, -0.4, tt); // arm overhead: −Z leans it outwards
        twist = lerp(0, -0.6, tt);
        lean = lerp(0.08, -0.15, tt);
        bodyY = -0.08 * tt;
        racketTilt = lerp(0.9, 1.4, tt);
        headX = -0.35 * tt;
      } else if (sw.kind === 'serve' || sw.kind === 'smash') {
        rX = lerp(3.7, 0.8, f); rZ = lerp(-0.4, 0.3, f);
        lX = lerp(3.0, 0.5, f);
        twist = lerp(-0.6, 0.8, f);
        lean = lerp(-0.15, 0.45, f);
        bodyY = 0.08 * Math.sin(u * Math.PI);
        racketTilt = lerp(1.4, 0.3, f);
        headX = lerp(-0.35, 0.1, f);
      }
    }

    // Moods after a point.
    if (s.mood === 'win' || s.mood === 'champion') {
      this.jump += dt * (s.mood === 'champion' ? 7 : 9);
      bodyY += Math.max(0, Math.sin(this.jump)) * (s.mood === 'champion' ? 0.35 : 0.18);
      lX = 3.0; lZ = -0.3; lY = 0;
      if (s.mood === 'champion') { rX = 3.0; rZ = 0.3; rY = 0; }
      legSwing = 0;
    } else if (s.mood === 'lose') {
      lean = 0.35; headX = 0.4;
      rX = 0.1; rY = 0; rZ = 0.15; lX = 0.1; lY = 0;
    }

    this.body.position.y = bodyY;
    this.legL.rotation.x = legSwing;
    this.legR.rotation.x = -legSwing;
    this.legL.rotation.z = -0.06;
    this.legR.rotation.z = 0.06;
    this.torso.rotation.y = twist;
    this.torso.rotation.x = -lean;
    this.armR.rotation.set(rX, rY, rZ, 'YZX');
    this.armL.rotation.set(lX, lY, lZ, 'YZX');
    this.head.rotation.x = headX;
    if (this.racket) this.racket.rotation.x = racketTilt;
  }
}

function racketFrame(color, mats) {
  const g = new THREE.Group();
  let m = mats.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set(color, m); }
  const w = 0.27, h = 0.34, t = 0.035;
  const pieces = [
    [w, t, t, 0, h / 2, 0], [w, t, t, 0, -h / 2, 0],
    [t, h, t, -w / 2, 0, 0], [t, h, t, w / 2, 0, 0],
  ];
  for (const [a, b, c, x, y, z] of pieces) {
    const mesh = new THREE.Mesh(box(a, b, c), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  }
  const strings = new THREE.Mesh(
    new THREE.PlaneGeometry(w - t, h - t),
    new THREE.MeshBasicMaterial({ color: 0xf2f0e6, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  strings.rotation.y = Math.PI / 2;
  g.add(strings);
  g.rotation.y = Math.PI / 2;
  return g;
}

/** Officials and ball kids: plain figures without rackets. */
export function makeFigure(kit, pose = 'stand') {
  const m = new PlayerModel(kit, { racket: false });
  if (pose === 'sit') {
    m.legL.rotation.x = -1.5; m.legR.rotation.x = -1.5;
    m.hips.position.y = 0.55;
  } else if (pose === 'crouch') {
    m.hips.position.y = 0.62;
    m.legL.rotation.x = -0.9; m.legR.rotation.x = -0.9;
    m.torso.rotation.x = -0.45;
    m.armL.rotation.x = 0.6; m.armR.rotation.x = 0.6;
  } else {
    m.armL.rotation.z = -0.1; m.armR.rotation.z = 0.1;
  }
  return m;
}

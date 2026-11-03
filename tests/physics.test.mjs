import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBall, step, bounce, DT, topspinAxis, netHeightAt, predict } from '../src/physics.js';
import { SURFACES, COURT } from '../src/config.js';
import { solveShot } from '../src/shots.js';
import { serviceBox, courtRegion, outDistance, isIn, judgeCall, MARK_RADIUS } from '../src/linecall.js';

const noWind = { x: 0, z: 0 };

function flyUntil(ball, surface, pred, maxT = 5) {
  for (let t = 0; t < maxT; t += DT) {
    const ev = step(ball, DT, surface, noWind, () => 0.5);
    if (ev && pred(ev)) return ev;
  }
  return null;
}

test('net height sags to 0.914 m in the middle and 1.07 m at the posts', () => {
  assert.equal(netHeightAt(0), COURT.netHeightCenter);
  assert.ok(Math.abs(netHeightAt(COURT.netPostX) - COURT.netHeightPost) < 1e-9);
});

test('topspin dips the ball compared with no spin', () => {
  const from = { x: 0, y: 1, z: 11 };
  const v = { x: 0, y: 4, z: -25 };
  const ax = topspinAxis(0, -1);
  const flat = makeBall(from, v);
  const top = makeBall(from, v, { x: ax.x * 300, y: 0, z: ax.z * 300 });
  const e1 = flyUntil(flat, SURFACES.hard, (e) => e.type === 'bounce');
  const e2 = flyUntil(top, SURFACES.hard, (e) => e.type === 'bounce');
  assert.ok(e2.z > e1.z + 2, `topspin should land shorter: ${e2.z} vs ${e1.z}`);
});

test('surfaces: clay bounces higher and slower than grass', () => {
  const mk = () => makeBall({ x: 0, y: 0.5, z: 0 }, { x: 0, y: -6, z: -20 }, { x: 0, y: 0, z: 0 });
  const g = mk(); bounce(g, SURFACES.grass);
  const c = mk(); bounce(c, SURFACES.clay);
  assert.ok(c.v.y > g.v.y, 'clay rebounds higher');
  assert.ok(Math.abs(c.v.z) < Math.abs(g.v.z), 'clay grabs more pace');
});

test('backspin checks more than topspin on the bounce', () => {
  const ax = topspinAxis(0, -1);
  const mk = (s) => makeBall({ x: 0, y: 0.1, z: -5 }, { x: 0, y: -5, z: -18 }, { x: ax.x * s, y: 0, z: ax.z * s });
  const top = mk(300); bounce(top, SURFACES.hard);
  const back = mk(-300); bounce(back, SURFACES.hard);
  assert.ok(Math.abs(top.v.z) > Math.abs(back.v.z));
});

test('low ball into the net is stopped on the hitter side', () => {
  const b = makeBall({ x: 0, y: 0.5, z: 5 }, { x: 0, y: 0, z: -20 });
  const ev = flyUntil(b, SURFACES.hard, (e) => e.type === 'net');
  assert.ok(ev, 'net event');
  const land = flyUntil(b, SURFACES.hard, (e) => e.type === 'bounce');
  assert.ok(land.z > 0, 'drops on the near side');
});

test('solver hits rally targets over the net within a few centimetres', () => {
  const cases = [
    { from: { x: 1, y: 1, z: 12 }, target: { x: -2.5, z: -9.5 }, spin: 260, netY: 1.9, maxSpeed: 45 },
    { from: { x: -3, y: 0.8, z: 11 }, target: { x: 3, z: -10 }, spin: -150, netY: 1.4, maxSpeed: 35 },
    { from: { x: 0, y: 1.2, z: -12 }, target: { x: 0, z: 10.5 }, spin: 120, netY: 6.5, maxSpeed: 40 },
    { from: { x: 0, y: 2.8, z: 12.2 }, target: { x: -1.9, z: -5.4 }, spin: 30, netY: 1.25, maxSpeed: 60 },
  ];
  for (const c of cases) {
    const s = solveShot(c);
    const b = makeBall(c.from, s.v, s.w);
    const ev = flyUntil(b, SURFACES.hard, (e) => e.type === 'bounce' || e.type === 'net');
    assert.equal(ev.type, 'bounce', JSON.stringify(c));
    const err = Math.hypot(ev.x - c.target.x, ev.z - c.target.z);
    assert.ok(err < 0.1, `landed ${err.toFixed(3)} m from target for ${JSON.stringify(c.target)}`);
    if (s.speed < c.maxSpeed - 1e-6) {
      assert.ok(Math.abs(s.landing.netY - c.netY) < 0.05, `net clearance ${s.landing.netY} vs ${c.netY}`);
    }
  }
});

test('solver respects the speed limit by looping the ball higher', () => {
  const from = { x: 0, y: 1, z: 12 };
  const target = { x: 0, z: -10 };
  const fast = solveShot({ from, target, spin: 0, netY: 1.05, maxSpeed: 90 });
  const capped = solveShot({ from, target, spin: 0, netY: 1.05, maxSpeed: 25 });
  assert.ok(capped.speed <= 25 + 1e-9);
  assert.ok(capped.landing.netY > fast.landing.netY);
  assert.ok(Math.hypot(capped.landing.x - target.x, capped.landing.z - target.z) < 0.1);
});

test('solver compensates for a crosswind', () => {
  const wind = { x: 6, z: 0 };
  const c = { from: { x: 0, y: 1, z: 12 }, target: { x: 0, z: -9 }, spin: 200, netY: 2, maxSpeed: 40, wind };
  const s = solveShot(c);
  const b = makeBall(c.from, s.v, s.w);
  let ev = null;
  for (let t = 0; t < 5 && !ev; t += DT) {
    const e = step(b, DT, SURFACES.hard, wind, () => 0.5);
    if (e && e.type === 'bounce') ev = e;
  }
  assert.ok(Math.abs(ev.x) < 0.15, `crosswind drift left ${ev.x}`);
});

test('service boxes are diagonal', () => {
  // Near server, deuce court: stands right of centre (+x), serves into far box on −x.
  const b = serviceBox(+1, 'deuce');
  assert.ok(b.xMax <= 0.03 && b.xMin < -4 && b.zMax === 0 && b.zMin === -COURT.serviceLine);
  const a = serviceBox(+1, 'ad');
  assert.ok(a.xMin >= -0.03 && a.xMax > 4);
  // Far server, deuce: stands at −x, serves into near box on +x.
  const f = serviceBox(-1, 'deuce');
  assert.ok(f.xMin >= -0.03 && f.zMin === 0 && f.zMax === COURT.serviceLine);
});

test('ball touching the line is in, a few millimetres past is out', () => {
  const r = courtRegion(-1);
  const edge = -COURT.halfLength;
  assert.ok(isIn(0, edge - MARK_RADIUS + 0.001, r));
  assert.ok(!isIn(0, edge - MARK_RADIUS - 0.004, r));
  const d = outDistance(0, edge - 0.05, r);
  assert.ok(Math.abs(d - (0.05 - MARK_RADIUS)) < 1e-9);
  // Corner uses euclidean distance.
  const dc = outDistance(COURT.singlesHalfWidth + 0.03, edge - 0.04, r);
  assert.ok(Math.abs(dc - (0.05 - MARK_RADIUS)) < 1e-9);
});

test('line judges never miss clear calls', () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(judgeCall(0.05, Math.random), false);
    assert.equal(judgeCall(-0.05, Math.random), true);
  }
  // A 1 mm call with a forced wrong roll flips.
  assert.equal(judgeCall(0.001, () => 0), true);
});

test('prediction stops after the second bounce and reports both', () => {
  const b = makeBall({ x: 0, y: 1, z: 11 }, { x: 0, y: 3, z: -22 });
  const { events } = predict(b, SURFACES.hard, noWind, { duration: 4 });
  const bounces = events.filter((e) => e.type === 'bounce');
  assert.equal(bounces.length, 2);
  assert.ok(bounces[0].t < bounces[1].t);
});

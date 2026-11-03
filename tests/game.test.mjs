import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(o) {
  return Number.isFinite(o.x) && Number.isFinite(o.z);
}

for (const surface of ['hard', 'clay', 'grass']) {
  test(`AI vs AI plays a full match on ${surface} without breaking`, () => {
    const g = new Game({ rng: mulberry32(surface.length * 977) });
    g.setSurface(surface);
    g.setWind('breezy');
    const events = {};
    g.on((type) => { events[type] = (events[type] || 0) + 1; });
    g.startMatch({ humanId: 'ari', aiId: 'noa', formatId: 'short', difficultyId: 'pro', demo: true });
    let t = 0;
    while (g.phase !== 'over' && t < 3600) {
      g.update(1 / 60, null);
      t += 1 / 60;
      for (const p of g.players) assert.ok(finite(p), `player position finite at ${t}`);
      assert.ok(Number.isFinite(g.ball.b.p.y), 'ball finite');
    }
    assert.equal(g.phase, 'over', `match should finish (t=${t.toFixed(0)} s, events ${JSON.stringify(events)})`);
    const pts = g.players[0].stats.points + g.players[1].stats.points;
    assert.ok(pts >= 16, `points played ${pts}`);
    assert.ok(events.hit > pts * 0.8, `rallies happen: ${events.hit} hits for ${pts} points`);
    assert.ok((events.serve || 0) >= pts, 'every point has a serve');
  });
}

test('rallies have realistic length and outcome mix', () => {
  const g = new Game({ rng: mulberry32(4242) });
  g.setSurface('hard');
  const rallies = [];
  const reasons = {};
  g.on((type, d) => {
    if (type === 'point') { rallies.push(d.rally); reasons[d.reason] = (reasons[d.reason] || 0) + 1; }
  });
  g.startMatch({ humanId: 'rosa', aiId: 'jun', formatId: 'bo3', difficultyId: 'champion', demo: true });
  let t = 0;
  while (g.phase !== 'over' && t < 7200) { g.update(1 / 60, null); t += 1 / 60; }
  const avg = rallies.reduce((a, b) => a + b, 0) / rallies.length;
  console.log('points', rallies.length, 'avg rally', avg.toFixed(2), JSON.stringify(reasons));
  assert.ok(avg > 2.5, `average rally ${avg}`);
  assert.ok((reasons.winner || 0) > 0 && (reasons.out || 0) > 0);
});

test('a well-timed human can serve, rally and win points against a rookie', () => {
  const g = new Game({ rng: mulberry32(99) });
  g.setSurface('hard');
  const human = { hits: 0, perfect: 0, serves: 0, whiffs: 0 };
  g.on((type, d) => {
    if (type === 'hit' && d.human) { human.hits++; if (d.label === 'PERFECT') human.perfect++; }
    if (type === 'serve' && d.human) human.serves++;
    if (type === 'whiff') human.whiffs++;
  });
  g.startMatch({ humanId: 'rosa', aiId: 'noa', formatId: 'short', difficultyId: 'rookie' });
  let lastKey = null;
  let t = 0;
  while (g.phase !== 'over' && t < 3600) {
    const shots = [];
    if (g.phase === 'preserve' && g.server === 0 && g.phaseT > 0.5) shots.push('topspin');
    const m = g.humanTimingMeter();
    if (m && m.err >= -0.01) {
      const key = `${g.ball.hitT}:${m.mode}`;
      if (key !== lastKey) { lastKey = key; shots.push(m.mode === 'serve' ? 'topspin' : 'topspin'); }
    }
    g.update(1 / 60, { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shots, challenge: false });
    t += 1 / 60;
  }
  assert.equal(g.phase, 'over');
  assert.ok(human.serves > 5, `human served ${human.serves}`);
  assert.ok(human.hits > 20, `human returned ${human.hits} balls`);
  assert.ok(human.perfect / human.hits > 0.6, `mostly perfect timing ${human.perfect}/${human.hits}`);
  assert.ok(g.players[0].stats.points > g.players[1].stats.points, `human ${g.players[0].stats.points} vs rookie ${g.players[1].stats.points}`);
});

test('challenges: stopping play on an IN call costs the point and a challenge when the call stands', () => {
  let checked = 0;
  for (let seed = 1; seed < 60 && checked < 3; seed++) {
    const g = new Game({ rng: mulberry32(seed) });
    const ev = [];
    g.on((t, d) => { if (t === 'reviewResult' || t === 'point') ev.push({ t, d }); });
    g.startMatch({ humanId: 'ari', aiId: 'noa', formatId: 'set', difficultyId: 'pro' });
    let lastKey = null;
    let found = null;
    for (let f = 0; f < 60 * 900; f++) {
      const shots = [];
      if (g.phase === 'preserve' && g.server === 0 && g.phaseT > 0.5) shots.push('topspin');
      const m = g.humanTimingMeter();
      if (m && m.err >= 0.03) { const k = `${g.ball.hitT}:${m.mode}`; if (k !== lastKey) { lastKey = k; shots.push('topspin'); } }
      let challenge = false;
      if (!found && g.phase === 'rally' && g.canChallenge(0)) {
        found = { ...g.call, before: g.players[0].challenges };
        challenge = true;
        ev.length = 0;
      }
      g.update(1 / 60, { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shots, challenge });
      if (found && ev.some((e) => e.t === 'point' || (e.t === 'reviewResult' && e.d.pending.kind !== 'point'))) break;
    }
    if (!found) continue;
    checked++;
    const res = ev.find((e) => e.t === 'reviewResult');
    assert.ok(res, 'review resolved');
    assert.equal(res.d.overturned, found.calledIn !== found.trueIn);
    if (found.trueIn) {
      assert.equal(res.d.pending.winner, found.hitter, 'call stands: the challenger stopped play and loses the point');
      assert.equal(g.players[0].challenges, found.before - 1);
    } else {
      assert.equal(g.players[0].challenges, found.before, 'a successful challenge is kept');
      if (!found.isServe) assert.equal(res.d.pending.winner, 0);
    }
  }
  assert.ok(checked >= 1, 'found at least one challenge situation');
});

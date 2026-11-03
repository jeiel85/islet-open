import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget, nextCheaperSetting } from '../src/quality.js';

function run(budget, dt, seconds) {
  let fired = 0;
  for (let t = 0; t < seconds; t += dt) if (budget.sample(dt)) fired++;
  return fired;
}

test('steady 60 fps never asks for a downgrade', () => {
  assert.equal(run(new FrameBudget(), 1 / 60, 60), 0);
});

test('sustained 20 fps asks after warm-up + hold, then waits for the cooldown', () => {
  const b = new FrameBudget({ warmupSec: 4, holdSec: 3, cooldownSec: 6 });
  let firstAt = null;
  let fired = 0;
  for (let t = 0; t < 20; t += 0.05) {
    if (b.sample(0.05)) { fired++; if (firstAt === null) firstAt = t; }
  }
  assert.ok(firstAt >= 6.9 && firstAt <= 7.5, `first downgrade at ${firstAt}`);
  // 20 s: first at ~7 s, then every ~9 s (cooldown 6 + hold 3) → 2 in total.
  assert.equal(fired, 2);
});

test('background-tab gaps and single hitches are ignored', () => {
  const b = new FrameBudget();
  let fired = 0;
  for (let i = 0; i < 2000; i++) {
    if (b.sample(i % 50 === 0 ? 0.2 : 1 / 60)) fired++; // occasional 200 ms hitch
    if (b.sample(1.5)) fired++;                          // throttled background frame
  }
  assert.equal(fired, 0);
});

test('downgrade order: shadows, then pixel size up to 4×', () => {
  const s = { shadows: 'on', pixel: '2' };
  const seen = [];
  for (let step = nextCheaperSetting(s); step; step = nextCheaperSetting(s)) {
    s[step.key] = step.value;
    seen.push(`${step.key}=${step.value}`);
  }
  assert.deepEqual(seen, ['shadows=off', 'pixel=3', 'pixel=4']);
});

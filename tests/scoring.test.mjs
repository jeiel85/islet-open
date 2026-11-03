import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, awardPoint, currentServer, serveSide, pointLabel, pointCell,
  isBreakPoint, isSetPointFor, isMatchPointFor,
} from '../src/scoring.js';
import { FORMATS } from '../src/config.js';

function winGame(m, p) {
  const before = m.games[p] + m.setsWon[p] * 100;
  for (let i = 0; i < 4; i++) awardPoint(m, p);
  return before;
}

test('love game: 15, 30, 40, game and server alternates', () => {
  const m = createMatch(FORMATS.set, 0);
  assert.equal(pointLabel(m), '0-0');
  awardPoint(m, 0); assert.equal(pointLabel(m), '15-0');
  awardPoint(m, 0); assert.equal(pointLabel(m), '30-0');
  awardPoint(m, 1); assert.equal(pointLabel(m), '30-15');
  awardPoint(m, 0); assert.equal(pointLabel(m), '40-15');
  const ev = awardPoint(m, 0);
  assert.equal(ev.game, 0);
  assert.deepEqual(m.games, [1, 0]);
  assert.equal(currentServer(m), 1);
});

test('deuce and advantage from the server view', () => {
  const m = createMatch(FORMATS.set, 1);
  for (let i = 0; i < 3; i++) { awardPoint(m, 0); awardPoint(m, 1); }
  assert.equal(pointLabel(m), 'Deuce');
  assert.equal(pointCell(m, 0), '40');
  awardPoint(m, 1);
  assert.equal(pointLabel(m), 'Ad In');
  assert.equal(pointCell(m, 1), 'AD');
  assert.equal(pointCell(m, 0), '');
  awardPoint(m, 0);
  assert.equal(pointLabel(m), 'Deuce');
  awardPoint(m, 0);
  assert.equal(pointLabel(m), 'Ad Out');
  assert.ok(isBreakPoint(m));
  const ev = awardPoint(m, 0);
  assert.equal(ev.game, 0);
  assert.equal(ev.wasBreak, true);
});

test('serve side alternates deuce/ad each point', () => {
  const m = createMatch(FORMATS.set, 0);
  assert.equal(serveSide(m), 'deuce');
  awardPoint(m, 0);
  assert.equal(serveSide(m), 'ad');
  awardPoint(m, 1);
  assert.equal(serveSide(m), 'deuce');
});

test('set to 6 needs two games clear and goes to a tiebreak at 6-6', () => {
  const m = createMatch(FORMATS.set, 0);
  for (let i = 0; i < 5; i++) { winGame(m, 0); winGame(m, 1); }
  assert.deepEqual(m.games, [5, 5]);
  winGame(m, 0);
  assert.equal(m.sets.length, 0, '6-5 is not a set');
  winGame(m, 1);
  assert.deepEqual(m.games, [6, 6]);
  assert.equal(m.tiebreak, true);
  // Server after 12 games: started with 0, so game 13 is served by 0.
  assert.equal(m.tbFirstServer, 0);
  assert.equal(currentServer(m), 0);
  awardPoint(m, 1); // 0-1
  assert.equal(currentServer(m), 1);
  assert.equal(serveSide(m), 'ad');
  awardPoint(m, 1); // 0-2
  assert.equal(currentServer(m), 1);
  assert.equal(serveSide(m), 'deuce');
  awardPoint(m, 0); // 1-2
  assert.equal(currentServer(m), 0);
  awardPoint(m, 0); // 2-2
  assert.equal(currentServer(m), 0);
  awardPoint(m, 0); // 3-2
  assert.equal(currentServer(m), 1);
});

test('tiebreak must be won by two and decides the set and match', () => {
  const m = createMatch(FORMATS.set, 0);
  for (let i = 0; i < 6; i++) { winGame(m, 0); winGame(m, 1); }
  for (let i = 0; i < 6; i++) { awardPoint(m, 0); awardPoint(m, 1); }
  assert.deepEqual(m.points, [6, 6]);
  let ev = awardPoint(m, 1);
  assert.equal(ev.set, null);
  assert.ok(isMatchPointFor(m, 1));
  ev = awardPoint(m, 1);
  assert.equal(ev.set, 1);
  assert.equal(ev.match, 1);
  assert.equal(m.winner, 1);
  assert.deepEqual(m.sets[0].games, [6, 7]);
  assert.deepEqual(m.sets[0].tb, [6, 8]);
});

test('match tiebreak format is a single race to 7', () => {
  const m = createMatch(FORMATS.tiebreak, 1);
  assert.equal(m.tiebreak, true);
  assert.equal(currentServer(m), 1);
  for (let i = 0; i < 6; i++) awardPoint(m, 0);
  assert.ok(isSetPointFor(m, 0));
  const ev = awardPoint(m, 0);
  assert.equal(ev.match, 0);
  assert.deepEqual(m.sets[0].games, [7, 0]);
});

test('best of three: set winner serves alternation continues', () => {
  const m = createMatch(FORMATS.bo3, 0);
  for (let i = 0; i < 6; i++) winGame(m, 0); // 6-0, server alternated 6 times
  assert.equal(m.setsWon[0], 1);
  assert.equal(m.winner, null);
  // Game 6 was served by player 1, so player 0 opens set 2.
  assert.equal(currentServer(m), 0);
  for (let i = 0; i < 6; i++) winGame(m, 0);
  assert.equal(m.winner, 0);
});

test('short set: tiebreak at 4-4', () => {
  const m = createMatch(FORMATS.short, 0);
  for (let i = 0; i < 4; i++) { winGame(m, 0); winGame(m, 1); }
  assert.equal(m.tiebreak, true);
  for (let i = 0; i < 7; i++) awardPoint(m, 0);
  assert.equal(m.winner, 0);
  assert.deepEqual(m.sets[0].games, [5, 4]);
});

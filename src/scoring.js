// Tennis scoring as a small state machine. Players are indices 0 and 1.
// Advantage scoring; tiebreak at `tiebreakAt`-all (first to 7, win by 2);
// `games: 0` means the whole match is a single tiebreak.

const POINT_NAMES = ['0', '15', '30', '40'];

export function createMatch(format, firstServer = 0) {
  const tiebreakOnly = !format.games;
  return {
    format,
    sets: [],               // completed sets: [{ games: [a, b], tb: [a, b] | null }]
    setsWon: [0, 0],
    games: [0, 0],
    points: [0, 0],
    tiebreak: tiebreakOnly,
    tbFirstServer: tiebreakOnly ? firstServer : null,
    gameServer: firstServer,
    winner: null,
  };
}

export function totalTiebreakPoints(m) {
  return m.points[0] + m.points[1];
}

export function currentServer(m) {
  if (!m.tiebreak) return m.gameServer;
  const n = totalTiebreakPoints(m);
  const first = m.tbFirstServer;
  return Math.floor((n + 1) / 2) % 2 === 0 ? first : 1 - first;
}

/** 'deuce' (right court) or 'ad' (left court) from the server's point of view. */
export function serveSide(m) {
  const n = m.tiebreak ? totalTiebreakPoints(m) : m.points[0] + m.points[1];
  return n % 2 === 0 ? 'deuce' : 'ad';
}

function setTarget(m) {
  return m.format.games;
}

/**
 * Award a point. Returns what happened so the caller can announce it:
 * { game: winner|null, set: winner|null, match: winner|null, tiebreakStarted, breakPoint... }
 */
export function awardPoint(m, p) {
  if (m.winner !== null) return { game: null, set: null, match: m.winner };
  const o = 1 - p;
  const out = { game: null, set: null, match: null, tiebreakStarted: false, wasBreak: false };
  m.points[p]++;

  if (m.tiebreak) {
    const tbTarget = 7;
    if (m.points[p] >= tbTarget && m.points[p] - m.points[o] >= 2) {
      const tb = [...m.points];
      if (m.format.games) {
        m.games[p]++;
      }
      out.game = p;
      finishSet(m, p, tb, out);
    }
    return out;
  }

  const a = m.points[p], b = m.points[o];
  if (a >= 4 && a - b >= 2) {
    out.wasBreak = m.gameServer !== p;
    m.games[p]++;
    m.points = [0, 0];
    out.game = p;
    const N = setTarget(m);
    const g = m.games[p], h = m.games[o];
    if (g >= N && g - h >= 2) {
      finishSet(m, p, null, out);
    } else {
      m.gameServer = 1 - m.gameServer;
      if (g === m.format.tiebreakAt && h === m.format.tiebreakAt) {
        m.tiebreak = true;
        m.tbFirstServer = m.gameServer;
        out.tiebreakStarted = true;
      }
    }
  }
  return out;
}

function finishSet(m, p, tb, out) {
  m.sets.push({ games: m.format.games ? [...m.games] : [...m.points], tb });
  m.setsWon[p]++;
  out.set = p;
  // Next set: after a tiebreak the player who received first serves first.
  const nextServer = m.tiebreak ? 1 - m.tbFirstServer : 1 - m.gameServer;
  m.games = [0, 0];
  m.points = [0, 0];
  m.tiebreak = false;
  m.tbFirstServer = null;
  m.gameServer = nextServer;
  if (m.setsWon[p] >= m.format.setsToWin) {
    m.winner = p;
    out.match = p;
  }
}

/** Score of the current game from the server's perspective, e.g. "30-15", "Deuce", "Ad In". */
export function pointLabel(m) {
  if (m.winner !== null) return '';
  if (m.tiebreak) return `${m.points[0]}-${m.points[1]}`;
  const s = m.gameServer, r = 1 - s;
  const a = m.points[s], b = m.points[r];
  if (a >= 3 && b >= 3) {
    if (a === b) return 'Deuce';
    return a > b ? 'Ad In' : 'Ad Out';
  }
  return `${POINT_NAMES[a]}-${POINT_NAMES[b]}`;
}

/** Points shown in a scoreboard column for player p. */
export function pointCell(m, p) {
  if (m.winner !== null) return '';
  if (m.tiebreak) return String(m.points[p]);
  const a = m.points[p], b = m.points[1 - p];
  if (a >= 3 && b >= 3) {
    if (a === b) return '40';
    return a > b ? 'AD' : '';
  }
  return POINT_NAMES[a];
}

/** True if the next point would win a game for the receiver. */
export function isBreakPoint(m) {
  if (m.tiebreak || m.winner !== null) return false;
  const s = m.gameServer, r = 1 - s;
  return m.points[r] >= 3 && m.points[r] - m.points[s] >= 1;
}

/** True if the next point could end a set (and the match) for player p. */
export function isSetPointFor(m, p) {
  if (m.winner !== null) return false;
  const o = 1 - p;
  if (m.tiebreak) {
    return m.points[p] + 1 >= 7 && m.points[p] + 1 - m.points[o] >= 2;
  }
  const a = m.points[p], b = m.points[o];
  const winsGame = (a + 1 >= 4 && a + 1 - b >= 2);
  if (!winsGame) return false;
  const N = m.format.games;
  return m.games[p] + 1 >= N && m.games[p] + 1 - m.games[o] >= 2;
}

export function isMatchPointFor(m, p) {
  return isSetPointFor(m, p) && m.setsWon[p] + 1 >= m.format.setsToWin;
}

/** Number of games played in the current set (used for changeovers). */
export function gamesInSet(m) {
  return m.games[0] + m.games[1];
}

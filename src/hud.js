// DOM overlays: scorebug, serve speed, banners, timing meter, prompts,
// commentary ticker, review panel and the match-centre stats table.

import { pointCell, isBreakPoint, isSetPointFor, isMatchPointFor, currentServer } from './scoring.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor() {
    this.scorebug = $('scorebug');
    this.banner = $('banner');
    this.feedback = $('feedback');
    this.meter = $('meter');
    this.prompt = $('prompt');
    this.ticker = $('tickerText');
    this.review = $('review');
    this.challengeBtn = $('challengeBtn');
    this.speedVal = $('speedVal');
    this.windEl = $('wind');
    this.statsTable = $('statsTable');
    this.bannerT = 0;
    this.lastScoreKey = '';
  }

  names(game) {
    return game.players.map((p) => p.profile.short);
  }

  renderScore(game) {
    const m = game.match;
    if (!m) return;
    const server = m.winner === null ? currentServer(m) : -1;
    const names = this.names(game);
    const rows = [0, 1].map((i) => {
      const sets = m.sets.map((s) => `<td class="set">${s.games[i]}${s.tb ? `<sup>${Math.min(s.tb[0], s.tb[1]) === s.tb[i] ? s.tb[i] : ''}</sup>` : ''}</td>`).join('');
      const cur = m.winner === null && m.format.games ? `<td class="set cur">${m.games[i]}</td>` : '';
      const pts = m.winner === null ? `<td class="pt">${pointCell(m, i)}</td>` : `<td class="pt">${m.winner === i ? '✓' : ''}</td>`;
      return `<tr><td class="sv">${server === i ? '<i></i>' : ''}</td><td class="nm">${esc(names[i])}${game.players[i].human ? ' ★' : ''}</td>${sets}${cur}${pts}</tr>`;
    }).join('');
    let status = '';
    if (m.winner !== null) status = 'FINAL';
    else {
      const parts = [];
      for (const p of [0, 1]) {
        if (isMatchPointFor(m, p)) parts.push(`MATCH POINT ${names[p]}`);
        else if (isSetPointFor(m, p)) parts.push(`SET POINT ${names[p]}`);
      }
      if (!parts.length && isBreakPoint(m)) parts.push('BREAK POINT');
      if (m.tiebreak) parts.unshift('TIEBREAK');
      if (game.serveNo === 2 && (game.phase === 'preserve' || game.phase === 'toss')) parts.push('2ND SERVE');
      status = parts.join(' · ');
    }
    const ch = game.players.map((p) => `${p.profile.short.slice(0, 3)} ${'◆'.repeat(Math.max(0, p.challenges))}`).join('  ');
    this.scorebug.innerHTML = `<table>${rows}</table><div class="status">${esc(status)}</div><div id="chal">챌린지 ${esc(ch)}</div>`;
  }

  setSpeed(v) { this.speedVal.textContent = v ? `${v} km/h` : '—'; }

  setWind(w, setting) {
    const s = Math.hypot(w.x, w.z);
    if (!setting.speed) { this.windEl.textContent = 'WIND CALM'; return; }
    // Arrow relative to the screen: +x right, −z up (towards the far end).
    const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    const a = Math.atan2(w.z, w.x);
    const idx = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    this.windEl.textContent = `WIND ${arrows[idx]} ${s.toFixed(1)} m/s`;
  }

  showBanner(big, small = '', time = 1.6) {
    this.banner.querySelector('.big').textContent = big;
    const sm = this.banner.querySelector('.small');
    sm.textContent = small;
    sm.style.display = small ? 'inline-block' : 'none';
    this.banner.classList.add('show');
    this.bannerT = time;
  }

  pop(text, color = '#fff') {
    const f = this.feedback;
    f.textContent = text;
    f.style.color = color;
    f.classList.remove('pop');
    void f.offsetWidth;
    f.classList.add('pop');
  }

  say(line) { this.ticker.textContent = line; }

  setPrompt(text) {
    if (text) { this.prompt.textContent = text; this.prompt.classList.add('show'); }
    else this.prompt.classList.remove('show');
  }

  setMeter(m) {
    if (!m) { this.meter.classList.remove('show'); return; }
    const lo = m.mode === 'serve' ? -0.7 : -0.6;
    const hi = m.mode === 'serve' ? 0.45 : 0.32;
    const X = (v) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`;
    const good = this.meter.querySelector('.good');
    const perfect = this.meter.querySelector('.perfect');
    good.style.left = X(-m.window);
    good.style.width = `calc(${X(m.window)} - ${X(-m.window)})`;
    perfect.style.left = X(-m.perfect);
    perfect.style.width = `calc(${X(m.perfect)} - ${X(-m.perfect)})`;
    this.meter.querySelector('.cursor').style.left = X(m.err);
    this.meter.querySelector('.cursor').style.background = m.reachable === false ? '#ff6a5a' : '#fff';
    this.meter.classList.add('show');
  }

  setChallenge(available, left) {
    this.challengeBtn.classList.toggle('show', available);
    this.challengeBtn.querySelector('span').textContent = available ? `◆×${left}` : '';
  }

  showReview(stage, text = '', sub = '') {
    if (!stage) { this.review.classList.remove('show'); return; }
    this.review.classList.add('show');
    this.review.querySelector('.r').textContent = text;
    this.review.querySelector('.s').textContent = sub;
  }

  renderStats(game) {
    if (!game.players.length) return;
    const [a, b] = game.players.map((p) => p.stats);
    const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
    const rows = [
      ['득점', a.points, b.points],
      ['에이스', a.aces, b.aces],
      ['더블 폴트', a.doubleFaults, b.doubleFaults],
      ['첫 서브 성공', pct(a.firstIn, a.firstTotal), pct(b.firstIn, b.firstTotal)],
      ['첫 서브 득점', pct(a.firstWon, a.firstIn), pct(b.firstWon, b.firstIn)],
      ['위너', a.winners, b.winners],
      ['범실', a.unforced, b.unforced],
      ['강요된 실책', a.forced, b.forced],
      ['최고 서브', a.fastestServe ? `${a.fastestServe}` : '—', b.fastestServe ? `${b.fastestServe}` : '—'],
      ['퍼펙트 타이밍', a.perfects, b.perfects],
      ['챌린지 성공', `${a.challengesWon}/${a.challengesWon + a.challengesLost}`, `${b.challengesWon}/${b.challengesWon + b.challengesLost}`],
    ];
    const n = this.names(game);
    this.statsTable.innerHTML = `<thead><tr><th></th><td>${esc(n[0])}</td><td>${esc(n[1])}</td></tr></thead><tbody>${rows.map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody>`;
  }

  tick(dt) {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('show');
    }
  }
}

// Boot, settings panel, render loop, camera, and the glue between the match
// logic (game.js) and everything you see and hear.

import * as THREE from 'three';
import { Game } from './game.js';
import { ROSTER, FORMATS, DIFFICULTY, SURFACES, WIND } from './config.js';
import { buildWorld } from './world.js';
import { buildStadium } from './stadium.js';
import { PlayerModel } from './players.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { pointCell, currentServer } from './scoring.js';
import { FrameBudget, nextCheaperSetting } from './quality.js';

// ── settings ──────────────────────────────────────────────────────────
const STORE_KEY = 'islet-open.settings.v1';
const DEFAULTS = {
  human: 'ari', ai: 'noa', format: 'short', difficulty: 'pro',
  surface: 'hard', wind: 'calm', time: 'day', wear: 0.35,
  autoMove: 'on', serveSpot: 'body', rallyAim: 'cross', risk: 'normal', netRush: 'sometimes', aimHelper: 'on',
  camera: 'tv', pixel: '2', shadows: 'on', voice: 'on', sound: true,
};
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* private mode: settings stay in memory */ }
}

const SEGS = {
  format: Object.values(FORMATS).map((f) => [f.id, f.name]),
  difficulty: Object.values(DIFFICULTY).map((d) => [d.id, d.name]),
  surface: Object.values(SURFACES).map((s) => [s.id, s.name]),
  wind: Object.values(WIND).map((w) => [w.id, w.name]),
  time: [['day', '낮'], ['sunset', '석양'], ['night', '밤']],
  autoMove: [['on', '자동'], ['off', '수동']],
  serveSpot: [['wide', '와이드'], ['body', '바디'], ['T', 'T']],
  rallyAim: [['center', '중앙'], ['cross', '크로스'], ['open', '빈 곳']],
  risk: [['safe', '안전'], ['normal', '보통'], ['bold', '과감']],
  netRush: [['never', '안 함'], ['sometimes', '가끔'], ['often', '자주']],
  aimHelper: [['on', '켜기'], ['off', '끄기']],
  camera: [['tv', '중계'], ['behind', '후방'], ['aerial', '공중']],
  pixel: [['1', '1×'], ['2', '2×'], ['3', '3×'], ['4', '4×']],
  shadows: [['on', '켜기'], ['off', '끄기']],
  voice: [['on', '켜기'], ['off', '끄기']],
};

// ── renderer and scene ────────────────────────────────────────────────
const stage = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  window.__bootFail?.('webgl', err);
  throw err;
}
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', '테니스 경기 화면');
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 4000);
camera.position.set(120, 60, 120);

const world = buildWorld(scene);
const stadium = buildStadium(scene);
const game = new Game();
const input = new Input();
const sound = new Sound();
const hud = new Hud();
window.__islet = { game, settings, input, renderer, booted: false };

// Ball, shadow, trail, markers.
const ballMat = new THREE.MeshLambertMaterial({ color: 0xd9f23a, emissive: 0x4a5a00 });
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), ballMat);
ballMesh.castShadow = true;
scene.add(ballMesh);
const shadowMesh = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
scene.add(shadowMesh);
const trail = [];
for (let i = 0; i < 7; i++) {
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xeaff7a, transparent: true, opacity: 0.5 - i * 0.06, depthWrite: false }));
  scene.add(t);
  trail.push(t);
}
const trailPts = [];
// Sized for the low-resolution render: thin rings vanish at 2–4× pixels.
const landRing = new THREE.Mesh(new THREE.CircleGeometry(0.42, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.75, depthWrite: false }));
landRing.rotation.y = Math.PI / 4;
scene.add(landRing);
const aimMark = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.75, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
scene.add(aimMark);

let models = [null, null];
function buildModels() {
  for (const m of models) if (m) scene.remove(m.root);
  models = game.players.map((p) => {
    const m = new PlayerModel({ ...p.profile.kit, racket: p.profile.kit.shirt === 0xffffff ? 0x1d6b43 : 0x1d1d1d });
    scene.add(m.root);
    return m;
  });
}

// ── resize / pixel size ───────────────────────────────────────────────
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const px = Number(settings.pixel) || 2;
  renderer.setSize(Math.max(1, Math.floor(w / px)), Math.max(1, Math.floor(h / px)), false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ── environment settings ──────────────────────────────────────────────
function applySurface() {
  game.setSurface(settings.surface);
  stadium.setSurface(settings.surface, Number(settings.wear));
  const s = SURFACES[settings.surface];
  const bars = [['속도', s.pace], ['바운드', s.bounce], ['그립', s.grip]];
  document.getElementById('surfaceBars').innerHTML = bars.map(([n, v]) => {
    const on = Math.round(v * 10);
    return `<span>${n}</span><span class="bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span><span>${v >= 0.7 ? '높음' : v >= 0.45 ? '보통' : '낮음'}</span>`;
  }).join('');
  document.getElementById('surfaceBlurb').textContent = s.blurb;
  updateLabel();
}
// Changing the time of day only touches light colours and intensities. The
// set of shadow-casting lights never changes with it, so no shader recompiles.
function applyTime() {
  world.setTimeOfDay(settings.time);
  stadium.setFloodlights(world.flood);
  updateLabel();
}
function applyShadows() {
  const on = settings.shadows === 'on';
  renderer.shadowMap.enabled = on;
  world.sun.castShadow = on;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}
function applyCoach() {
  game.coach.autoMove = settings.autoMove === 'on';
  game.coach.serveSpot = settings.serveSpot;
  game.coach.rallyAim = settings.rallyAim;
  game.coach.risk = settings.risk;
  game.coach.netRush = settings.netRush;
}

// ── panel ─────────────────────────────────────────────────────────────
function buildPanel() {
  for (const el of document.querySelectorAll('.seg[data-key]')) {
    const key = el.dataset.key;
    el.innerHTML = SEGS[key].map(([v, label]) => `<button type="button" data-v="${v}">${label}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[key] = b.dataset.v;
      if (key === 'shadows' || key === 'pixel') autoQuality = false; // the player's choice wins
      saveSettings();
      syncPanel();
      onSettingChanged(key);
    });
  }
  const opts = ROSTER.map((r) => `<option value="${r.id}">${r.name} · ${r.styleName}</option>`).join('');
  const selH = document.getElementById('selHuman');
  const selA = document.getElementById('selAi');
  selH.innerHTML = opts;
  selA.innerHTML = opts;
  selH.addEventListener('change', () => { settings.human = selH.value; if (settings.ai === settings.human) settings.ai = ROSTER.find((r) => r.id !== settings.human).id; saveSettings(); syncPanel(); });
  selA.addEventListener('change', () => { settings.ai = selA.value; if (settings.ai === settings.human) settings.human = ROSTER.find((r) => r.id !== settings.ai).id; saveSettings(); syncPanel(); });
  document.getElementById('wear').addEventListener('input', (e) => { settings.wear = e.target.value; saveSettings(); stadium.setSurface(settings.surface, Number(settings.wear)); });
  document.getElementById('startBtn').addEventListener('click', () => startMatch(false));
  document.getElementById('watchBtn').addEventListener('click', () => startMatch(true));
  document.getElementById('titleStart').addEventListener('click', () => startMatch(false));
  document.getElementById('titleWatch').addEventListener('click', () => { hideTitle(); sound.unlock(); });
  document.getElementById('resumeBtn').addEventListener('click', () => setPaused(false));
  document.getElementById('quitBtn').addEventListener('click', () => { setPaused(false); startMatch(true); });
  document.getElementById('againBtn').addEventListener('click', () => startMatch(false));
  document.getElementById('menuBtn').addEventListener('click', () => startMatch(true));
  document.getElementById('pauseBtn').addEventListener('click', () => togglePause());
  document.getElementById('muteBtn').addEventListener('click', () => toggleMute());
  document.getElementById('panelBtn').addEventListener('click', () => document.body.classList.toggle('panel-open'));
  document.getElementById('challengeBtn').addEventListener('click', () => input.pressAction('challenge'));
}

function profileLine(id) {
  const r = ROSTER.find((p) => p.id === id);
  const stat = (n, v) => `${n} ${Math.round(v * 10)}`;
  return `<span class="chip" style="background:#${r.kit.shirt.toString(16).padStart(6, '0')}"></span>${[stat('스피드', r.speed), stat('파워', r.power), stat('컨트롤', r.control), stat('스핀', r.spin), stat('서브', r.serve)].join(' · ')}`;
}

function syncPanel() {
  for (const el of document.querySelectorAll('.seg[data-key]')) {
    const key = el.dataset.key;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(String(settings[key]) === b.dataset.v));
  }
  document.getElementById('selHuman').value = settings.human;
  document.getElementById('selAi').value = settings.ai;
  document.getElementById('profHuman').innerHTML = profileLine(settings.human);
  document.getElementById('profAi').innerHTML = profileLine(settings.ai);
  document.getElementById('wear').value = settings.wear;
  document.getElementById('muteBtn').textContent = settings.sound ? '🔊' : '🔇';
}

function onSettingChanged(key) {
  if (key === 'surface') applySurface();
  else if (key === 'wind') { game.setWind(settings.wind); updateLabel(); }
  else if (key === 'time') applyTime();
  else if (key === 'shadows') applyShadows();
  else if (key === 'pixel') resize();
  else if (key === 'voice') sound.voice = settings.voice === 'on';
  else if (['autoMove', 'serveSpot', 'rallyAim', 'risk', 'netRush'].includes(key)) applyCoach();
}

function updateLabel() {
  const el = document.getElementById('matchLabel');
  if (!game.players.length) return;
  const n = game.players.map((p) => p.profile.short);
  const tod = { day: '낮', sunset: '석양', night: '밤' }[settings.time];
  el.textContent = `${n[0]} v ${n[1]} · ${SURFACES[settings.surface].name} · ${FORMATS[game.formatId]?.name || ''} · ${tod}`;
  document.getElementById('matchState').textContent = game.demo ? '관전 중' : `${DIFFICULTY[settings.difficulty].name} 상대`;
}

// ── match flow ────────────────────────────────────────────────────────
let titleShown = true;
let tutorialHits = 0;
function hideTitle() {
  titleShown = false;
  document.getElementById('title').classList.remove('show');
}

function startMatch(demo) {
  sound.unlock();
  hideTitle();
  document.getElementById('overOv').classList.remove('show');
  document.body.classList.remove('panel-open');
  game.setWind(settings.wind);
  game.startMatch({ humanId: settings.human, aiId: settings.ai, formatId: settings.format, difficultyId: settings.difficulty, demo });
  buildModels();
  updateLabel();
  hud.renderScore(game);
  hud.renderStats(game);
  sound.setMurmur(1);
  const n = game.players.map((p) => p.profile.name);
  hud.say(demo ? `관전 모드 — ${n[0]} 대 ${n[1]}. 언제든 '경기 시작'으로 직접 뛸 수 있습니다.` : `${n[0]} 대 ${n[1]}, ${FORMATS[settings.format].name}. ${n[game.server]}의 서브로 시작합니다.`);
  // Drop focus from the clicked button/select so Space and the arrows reach the game.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

let paused = false;
let contextLost = false;
function setPaused(v) {
  if (game.demo && v) return;
  if (!v && contextLost) return; // nothing to see until the GPU comes back
  paused = v;
  game.paused = v;
  document.getElementById('pauseOv').classList.toggle('show', v);
}
function togglePause() { setPaused(!paused); }
function toggleMute() {
  settings.sound = !settings.sound;
  saveSettings();
  sound.setEnabled(settings.sound);
  syncPanel();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.demo && game.phase !== 'over') setPaused(true);
  if (!document.hidden) sound.unlock();
});

// ── GPU context loss ──────────────────────────────────────────────────
// three.js keeps the context restorable and re-uploads resources itself; we
// stop the match so no points are lost while the screen is gone.
renderer.domElement.addEventListener('webglcontextlost', () => {
  contextLost = true;
  if (!game.demo && game.phase !== 'over') setPaused(true);
  showNotice('그래픽 장치 연결이 끊겼습니다. 복구를 기다리는 중입니다…');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  resize();
  hideNotice();
  hud.say('그래픽이 복구됐습니다.' + (paused ? ' 일시 정지를 풀면 경기가 이어집니다.' : ''));
});
function showNotice(text) {
  document.getElementById('sysMsg').textContent = text;
  document.getElementById('sysOv').classList.add('show');
}
function hideNotice() {
  document.getElementById('sysOv').classList.remove('show');
}

// ── announcements ─────────────────────────────────────────────────────
const SPOKEN = ['love', 'fifteen', 'thirty', 'forty'];
function spokenScore(m) {
  if (m.tiebreak) {
    const s = m.points;
    if (s[0] === s[1]) return `${s[0]} all`;
    const lead = s[0] > s[1] ? 0 : 1;
    return `${Math.max(...s)} ${Math.min(...s)}, ${game.players[lead].profile.short.toLowerCase()}`;
  }
  const sv = m.gameServer, rv = 1 - sv;
  const a = m.points[sv], b = m.points[rv];
  if (a + b === 0) return '';
  if (a >= 3 && b >= 3) {
    if (a === b) return 'Deuce';
    return `Advantage ${game.players[a > b ? sv : rv].profile.short.toLowerCase()}`;
  }
  if (a === b) return `${SPOKEN[a]} all`;
  return `${SPOKEN[a]} ${SPOKEN[b]}`;
}

const REASON_KO = { ace: '에이스', winner: '위너', out: '아웃', net: '네트', double: '더블 폴트', challengeStop: '챌린지 실패' };

game.on((type, d) => {
  const P = game.players;
  const nm = (i) => P[i]?.profile.short || '';
  const full = (i) => P[i]?.profile.name || '';
  switch (type) {
    case 'serveReady':
      hud.renderScore(game);
      break;
    case 'toss':
      sound.whoosh();
      break;
    case 'serve':
      sound.hit(d.speed, d.q, d.label === 'PERFECT');
      hud.setSpeed(d.speed);
      if (d.human) hud.pop(d.label === 'PERFECT' ? 'PERFECT SERVE' : d.label, d.label === 'PERFECT' ? '#d9f23a' : '#fff');
      break;
    case 'hit':
      sound.hit(d.speed, d.q, d.label === 'PERFECT');
      if (d.human) {
        tutorialHits++;
        const col = d.label === 'PERFECT' ? '#d9f23a' : d.label === 'GOOD' ? '#fff' : '#ffb35a';
        hud.pop(d.label, col);
      }
      break;
    case 'whiff':
      sound.whoosh();
      hud.pop(d.reach ? 'TOO FAR' : `MISS · ${d.label}`, '#ff8070');
      break;
    case 'bounce':
      sound.bounce(game.surface.id, d.speed);
      stadium.addMark(d.x, d.z, game.ball.b.v.x, game.ball.b.v.z, game.surface.id);
      break;
    case 'net':
      sound.net();
      break;
    case 'netcord':
      sound.net();
      sound.ooh();
      hud.say('네트 코드! 공이 테이프를 맞고 튀어 오릅니다.');
      break;
    case 'call':
      if (!d.calledIn) {
        stadium.signalOut(d.z);
        if (!d.isServe) { hud.showBanner('OUT'); sound.say('Out!'); }
      } else if (d.close) {
        sound.ooh();
      }
      break;
    case 'fault':
      hud.showBanner(d.double ? 'DOUBLE FAULT' : 'FAULT', d.reason === 'net' ? '네트' : '');
      sound.say(d.double ? 'Double fault' : 'Fault');
      if (!d.double) hud.say(`${full(game.server)}, 첫 서브 폴트. 세컨드 서브입니다.`);
      break;
    case 'let':
      hud.showBanner('LET', '서브 다시');
      sound.say('Let. First service');
      break;
    case 'pointEnd': {
      const lvl = 0.35 + Math.min(1, (d.rally || 0) / 12);
      if (d.reason === 'ace') { hud.showBanner('ACE', `${game.serveSpeed} km/h`); sound.applause(0.8); stadium.cheer(0.8); }
      else if (d.reason === 'winner') { hud.showBanner('WINNER'); sound.applause(lvl); stadium.cheer(lvl); }
      else { sound.applause(lvl * 0.6); stadium.cheer(lvl * 0.4); }
      break;
    }
    case 'reviewStart':
      sound.chime();
      hud.showReview(true, '...', `${full(d.challenger)} 챌린지 요청`);
      hud.say(`${full(d.challenger)}가 판정에 챌린지를 신청합니다. 원래 판정은 ${d.call.calledIn ? 'IN' : 'OUT'}.`);
      break;
    case 'reviewResult': {
      const verdict = d.call.trueIn ? 'IN' : 'OUT';
      hud.showReview(true, verdict, `${d.text} · ${d.overturned ? '판정 번복!' : '원심 유지'}`);
      sound.ooh();
      if (d.overturned) { sound.applause(0.5); stadium.cheer(0.5); }
      hud.say(`리뷰 결과 ${d.text}. ${d.overturned ? '판정이 번복됩니다.' : `원래 판정 유지, ${full(d.challenger)}의 챌린지가 하나 줄어듭니다.`}`);
      setTimeout(() => hud.showReview(false), 2600);
      break;
    }
    case 'point': {
      hud.renderScore(game);
      hud.renderStats(game);
      const m = game.match;
      const ev = d.ev;
      const w = d.winner;
      const why = REASON_KO[d.reason] || '';
      let line = `${full(w)} 득점${why ? ` (${why})` : ''}`;
      if (d.rally >= 8) line = `${d.rally}구 랠리 끝에 ${line}`;
      if (ev.match !== null) {
        sound.say(`Game, set and match, ${nm(w).toLowerCase()}`);
        line = `경기 종료! ${full(w)} 승리.`;
        sound.applause(1.5);
        stadium.cheer(1.4);
      } else if (ev.set !== null) {
        sound.say(`Game and set, ${nm(w).toLowerCase()}`);
        hud.showBanner('SET', full(w), 2.4);
        line += ` — 세트를 가져갑니다!`;
        sound.applause(1.2);
        stadium.cheer(1.2);
      } else if (ev.game !== null) {
        sound.say(`Game, ${nm(w).toLowerCase()}`);
        hud.showBanner('GAME', `${full(w)}${ev.wasBreak ? ' · 브레이크!' : ''}`, 1.8);
        line += ev.wasBreak ? ' — 서브 게임을 브레이크했습니다!' : ' — 게임을 지켜냅니다.';
        if (ev.tiebreakStarted) line += ' 타이브레이크에 들어갑니다.';
      } else {
        const call = spokenScore(m);
        if (call) setTimeout(() => sound.say(call), 500);
      }
      hud.say(line);
      break;
    }
    case 'matchOver':
      hud.renderScore(game);
      hud.renderStats(game);
      if (!d.demo) showMatchOver(d.winner);
      break;
    case 'retoss':
      hud.setPrompt('토스가 떨어졌어요 — 다시 토스하세요');
      break;
  }
});

function showMatchOver(w) {
  const m = game.match;
  const human = game.players.findIndex((p) => p.human);
  document.getElementById('overTitle').textContent = w === human ? 'YOU WIN!' : 'MATCH LOST';
  document.getElementById('overScore').textContent = m.sets.map((s) => `${s.games[0]}-${s.games[1]}${s.tb ? `(${Math.min(...s.tb)})` : ''}`).join('  ');
  const st = game.players[human].stats;
  document.getElementById('overStats').textContent = `에이스 ${st.aces} · 위너 ${st.winners} · 범실 ${st.unforced} · 퍼펙트 타이밍 ${st.perfects} · 최고 서브 ${st.fastestServe || '—'} km/h`;
  setTimeout(() => document.getElementById('overOv').classList.add('show'), 1800);
}

// ── touch controls ────────────────────────────────────────────────────
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(() => {
  const joy = document.getElementById('joy');
  const knob = joy.querySelector('i');
  let id = null;
  const move = (e) => {
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    input.setTouchMove(Math.abs(x) < 0.2 ? 0 : x, Math.abs(y) < 0.2 ? 0 : y);
    knob.style.transform = `translate(${x * 36}px, ${-y * 36}px)`;
  };
  joy.addEventListener('pointerdown', (e) => { id = e.pointerId; joy.setPointerCapture(id); sound.unlock(); move(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; input.setTouchMove(0, 0); knob.style.transform = ''; };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
  for (const b of document.querySelectorAll('#shotPad button')) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); sound.unlock(); input.pressShot(b.dataset.shot); });
  }
})();
// Every gesture may resume audio: iOS leaves the context "interrupted"
// after calls or app switches until the next user gesture.
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', () => sound.unlock());

// ── camera ────────────────────────────────────────────────────────────
const camPos = new THREE.Vector3(130, 70, 130);
const camLook = new THREE.Vector3(0, 0, 0);
const tPos = new THREE.Vector3();
const tLook = new THREE.Vector3();
let camFov = 40;
let orbitA = 0.6;
const CAMERAS = ['tv', 'behind', 'aerial'];

function updateCamera(dt) {
  const b = game.ball.b.p;
  const ballOk = game.ball.visible && Number.isFinite(b.x);
  let fov = 36;
  let rate = 3.5;
  if (titleShown) {
    orbitA += dt * 0.06;
    tPos.set(Math.sin(orbitA) * 150, 46, Math.cos(orbitA) * 150);
    tLook.set(0, -13, 0);
    fov = 44;
    rate = 1.5;
  } else if (game.phase === 'review' && game.review) {
    // Low and from outside the court, looking down at the mark.
    const c = game.review.call;
    const sz = Math.sign(c.z) || 1;
    const sx = Math.sign(c.x) || 1;
    tPos.set(c.x + sx * 0.9, 1.6, c.z + sz * 1.1);
    tLook.set(c.x, 0, c.z);
    fov = 30;
    rate = 2.4;
  } else {
    const mode = settings.camera;
    const p = game.players[0];
    if (mode === 'behind' && p) {
      tPos.set(p.x * 0.75, 3.5, Math.min(p.z + 7.4, 27));
      tLook.set(p.x * 0.3 + (ballOk ? b.x * 0.2 : 0), 1.0, -7);
      fov = 55;
    } else if (mode === 'aerial') {
      orbitA += dt * 0.03;
      tPos.set(Math.sin(orbitA) * 46, 58, Math.cos(orbitA) * 46);
      tLook.set(0, 0, 0);
      fov = 40;
      rate = 1.5;
    } else {
      // Frame the whole court; narrow (portrait) stages need a wider lens.
      const fx = (ballOk ? b.x * 0.16 : 0) + (p ? p.x * 0.1 : 0);
      const narrow = Math.max(0, 1.25 - camera.aspect);
      tPos.set(fx, 12.5 + narrow * 10, 27.5 + narrow * 14);
      tLook.set(fx * 0.6, 0, 0.2);
      fov = 36 + narrow * 14;
    }
  }
  const k = 1 - Math.exp(-dt * rate);
  camPos.lerp(tPos, k);
  camLook.lerp(tLook, k);
  camFov += (fov - camFov) * k;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (Math.abs(camera.fov - camFov) > 0.01) { camera.fov = camFov; camera.updateProjectionMatrix(); }
}

// ── per-frame sync ────────────────────────────────────────────────────
function syncPlayers(dt) {
  const b = game.ball;
  const reviewing = game.phase === 'review';
  game.players.forEach((p, i) => {
    const m = models[i];
    if (!m) return;
    m.root.visible = !reviewing; // keep the review close-up clear
    m.root.position.set(p.x, 0, p.z);
    const base = p.side > 0 ? 0 : Math.PI;
    let yaw = base;
    if (b.visible && (game.phase === 'rally' || game.phase === 'dead')) {
      const dx = b.b.p.x - p.x, dz = b.b.p.z - p.z;
      let a = Math.atan2(-dx, -dz);
      let d = a - base;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw = base + Math.max(-0.55, Math.min(0.55, d * 0.6));
    } else if ((game.phase === 'preserve' || game.phase === 'toss') && i === game.server) {
      yaw = base + (game.courtSide === 'deuce' ? 0.18 : -0.18);
    }
    let cur = m.root.rotation.y;
    let diff = Math.atan2(Math.sin(yaw - cur), Math.cos(yaw - cur));
    m.root.rotation.y = cur + diff * Math.min(1, dt * 10);
    m.pose({
      speed: Math.hypot(p.vx, p.vz),
      prep: p.prep,
      prepHand: p.prepHand,
      swing: p.swing,
      tossT: game.phase === 'toss' && i === game.server ? game.phaseT : 0,
      mood: p.mood,
    }, dt);
  });
}

function syncBall() {
  const b = game.ball;
  const p = b.b.p;
  ballMesh.visible = b.visible;
  shadowMesh.visible = b.visible;
  if (!b.visible) { for (const t of trail) t.visible = false; return; }
  ballMesh.position.set(p.x, Math.max(0.085, p.y), p.z);
  shadowMesh.position.set(p.x, 0.012, p.z);
  shadowMesh.material.opacity = Math.max(0.08, 0.4 - p.y * 0.08);
  const sp = Math.hypot(b.b.v.x, b.b.v.y, b.b.v.z);
  trailPts.unshift({ x: p.x, y: Math.max(0.085, p.y), z: p.z });
  if (trailPts.length > 14) trailPts.length = 14;
  trail.forEach((t, i) => {
    const q = trailPts[(i + 1) * 2];
    t.visible = !!q && sp > 12 && game.phase !== 'preserve';
    if (q) t.position.set(q.x, q.y, q.z);
  });
}

function syncMarkers() {
  const inc = game.incoming;
  const human = game.players.find((pl) => pl.human);
  const showHelp = settings.aimHelper === 'on' && human && game.phase === 'rally' && game.ball.live && game.ball.lastHitter !== human.idx;
  if (showHelp && inc && inc.bounce && game.ball.bounces === 0) {
    landRing.visible = true;
    landRing.position.set(inc.bounce.x, 0.02, inc.bounce.z);
  } else landRing.visible = false;
  const snap = lastInput;
  const tgt = showHelp ? game.previewHumanTarget(snap ? snap.aim : { x: 0, y: 0 }) : null;
  if (tgt) {
    aimMark.visible = true;
    aimMark.position.set(tgt.x, 0.02, tgt.z);
  } else aimMark.visible = false;
}

function promptText() {
  const human = game.players.find((p) => p.human);
  if (!human || titleShown) return '';
  if (game.phase === 'preserve' && game.server === human.idx) {
    return game.serveNo === 2 ? '세컨드 서브 — 샷 키로 토스 (←/→ 코스)' : '샷 키(J·K·L)로 토스 → 내려올 때 다시 눌러 서브 · ←/→ 코스';
  }
  if (game.phase === 'toss' && game.server === human.idx) return '지금! J 플랫 · K 슬라이스 · L 킥';
  if (game.phase === 'rally' && tutorialHits < 4 && game.ball.lastHitter !== human.idx && game.ball.live) {
    return '공이 노란 칸에 올 때: J 탑스핀 · K 슬라이스 · L 로브 · I 플랫';
  }
  return '';
}

function updateScoreboard3D() {
  const m = game.match;
  if (!m) return;
  const server = m.winner === null ? currentServer(m) : -1;
  const key = JSON.stringify([m.sets, m.games, m.points, server, game.serveSpeed]);
  if (key === hud.lastScoreKey) return;
  hud.lastScoreKey = key;
  stadium.setScoreboard({
    lines: game.players.map((p, i) => ({
      name: p.profile.short,
      sets: [...m.sets.map((s) => s.games[i]), ...(m.winner === null && m.format.games ? [m.games[i]] : [])].join(' '),
      points: m.winner === null ? pointCell(m, i) : (m.winner === i ? 'WIN' : ''),
      serving: server === i,
    })),
    footer: m.tiebreak ? 'TIEBREAK' : game.serveSpeed ? `SERVE ${game.serveSpeed} KM/H` : 'ISLET OPEN',
  });
}

// ── loop ──────────────────────────────────────────────────────────────
let lastInput = null;
let last = performance.now();
let elapsed = 0;
let autoQuality = true;
const budget = new FrameBudget();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.max(0, (now - last) / 1000);
  last = now;
  step(Math.min(0.05, raw), true);
  if (autoQuality && !document.hidden && !contextLost && budget.sample(raw)) lowerQuality();
}

function lowerQuality() {
  const next = nextCheaperSetting(settings);
  if (!next) { autoQuality = false; return; }
  settings[next.key] = next.value;
  saveSettings();
  syncPanel();
  onSettingChanged(next.key);
  hud.say(`화면이 느려서 그래픽을 낮췄습니다 (${next.label}). 보기 설정에서 되돌릴 수 있습니다.`);
}

function step(dt, render) {
  elapsed += dt;
  const inp = input.snapshot();
  lastInput = inp;
  for (const a of inp.actions) {
    if (a === 'pause') togglePause();
    else if (a === 'camera') { settings.camera = CAMERAS[(CAMERAS.indexOf(settings.camera) + 1) % CAMERAS.length]; saveSettings(); syncPanel(); }
    else if (a === 'mute') toggleMute();
    else if (a === 'panel') document.body.classList.toggle('panel-open');
  }
  if (inp.shots.length || inp.challenge) sound.unlock();
  if (!paused && !contextLost && game.phase !== 'idle') {
    game.update(dt, titleShown ? null : inp);
  }
  syncPlayers(paused ? 0 : dt);
  syncBall();
  syncMarkers();
  updateCamera(dt);
  world.update(dt, elapsed, camera);
  stadium.update(dt, elapsed, game.wind);
  if (game.phase === 'review' && game.review) stadium.showReview(game.review.call, game.phaseT);
  else stadium.hideReview();

  const human = game.players.findIndex((p) => p.human);
  hud.setMeter(titleShown ? null : game.humanTimingMeter());
  hud.setPrompt(promptText());
  hud.setChallenge(human >= 0 && game.canChallenge(human), human >= 0 ? game.players[human].challenges : 0);
  hud.setWind(game.wind, game.windSetting);
  hud.tick(dt);
  updateScoreboard3D();
  if (Math.floor(elapsed * 4) !== Math.floor((elapsed - dt) * 4)) hud.renderScore(game);

  if (render && !contextLost) renderer.render(scene, camera);
}

// Debug/capture hook: run the game for `seconds` without waiting for
// animation frames (background tabs throttle them), then draw once.
window.__islet.advance = (seconds, { dt = 1 / 60, render = true } = {}) => {
  const n = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < n; i++) step(dt, render && i === n - 1);
  return game.phase;
};

// ── boot ──────────────────────────────────────────────────────────────
buildPanel();
syncPanel();
applyCoach();
sound.voice = settings.voice === 'on';
sound.enabled = settings.sound;
applySurface();
applyTime();
applyShadows();
resize();
game.setWind(settings.wind);
game.startMatch({ humanId: settings.human, aiId: settings.ai, formatId: 'tiebreak', difficultyId: 'pro', demo: true });
buildModels();
updateLabel();
hud.renderScore(game);
hud.renderStats(game);
requestAnimationFrame(frame);
window.__islet.booted = true;
window.__bootDone?.();

// Shared constants: court geometry (ITF dimensions, metres), surfaces, roster,
// match formats and AI levels. No three.js imports — tests load this in Node.

export const COURT = {
  halfLength: 11.885,        // net → baseline (outer edge of the line)
  singlesHalfWidth: 4.115,
  doublesHalfWidth: 5.485,
  serviceLine: 6.40,         // net → service line (outer edge)
  centerLineHalf: 0.025,     // centre service line is 5 cm wide
  netHeightCenter: 0.914,
  netHeightPost: 1.07,
  netPostX: 6.40,            // posts stand 0.914 m outside the doubles sideline
  runoffHalfLength: 18.3,    // back walls
  runoffHalfWidth: 9.15,     // side walls
  ballRadius: 0.0335,
};

export const SURFACES = {
  hard: {
    id: 'hard', name: '하드', nameEn: 'Hard',
    cor: 0.76, mu: 0.48,
    pace: 0.62, bounce: 0.6, grip: 0.55,
    blurb: '고른 속도와 바운드. 모든 스타일에 공평합니다.',
  },
  clay: {
    id: 'clay', name: '클레이', nameEn: 'Clay',
    cor: 0.81, mu: 0.72,
    pace: 0.32, bounce: 0.85, grip: 0.85,
    blurb: '느리고 높게 튑니다. 탑스핀이 크게 뛰고 공 자국이 남습니다.',
  },
  grass: {
    id: 'grass', name: '잔디', nameEn: 'Grass',
    cor: 0.69, mu: 0.30,
    pace: 0.9, bounce: 0.3, grip: 0.28,
    blurb: '빠르고 낮게 깔립니다. 슬라이스가 미끄러지고 서브가 강해집니다.',
  },
};

export const WIND = {
  calm: { id: 'calm', name: '무풍', speed: 0 },
  breezy: { id: 'breezy', name: '산들바람', speed: 3.2 },
  gusty: { id: 'gusty', name: '돌풍', speed: 6.5 },
};

// Attributes are 0..1. Kits are flat colours for the voxel models.
export const ROSTER = [
  {
    id: 'ari', name: 'Ari Calloway', short: 'CALLOWAY', style: 'allcourt', styleName: '올코트',
    speed: 0.72, power: 0.7, control: 0.72, spin: 0.65, serve: 0.7, reach: 0.6,
    kit: { shirt: 0x1fb5a8, shorts: 0xf4f1e8, skin: 0xe0ac7e, hair: 0x3b2a1e, band: 0xffffff, shoes: 0xf4f1e8 },
  },
  {
    id: 'noa', name: 'Noa Ferreira', short: 'FERREIRA', style: 'baseliner', styleName: '베이스라이너',
    speed: 0.66, power: 0.78, control: 0.66, spin: 0.92, serve: 0.6, reach: 0.62,
    kit: { shirt: 0xf26b3a, shorts: 0x23324a, skin: 0xc68c5c, hair: 0x1d1714, band: 0xf26b3a, shoes: 0xffffff },
  },
  {
    id: 'jun', name: 'Jun Takeda', short: 'TAKEDA', style: 'counter', styleName: '카운터펀처',
    speed: 0.95, power: 0.55, control: 0.82, spin: 0.62, serve: 0.5, reach: 0.55,
    kit: { shirt: 0x2f4fd8, shorts: 0x1a1a24, skin: 0xe8bf94, hair: 0x15110e, band: 0xff3f5e, shoes: 0x2f4fd8 },
  },
  {
    id: 'elsa', name: 'Elsa Brandt', short: 'BRANDT', style: 'bigserver', styleName: '빅서버',
    speed: 0.55, power: 0.9, control: 0.58, spin: 0.55, serve: 0.97, reach: 0.82,
    kit: { shirt: 0xf5d531, shorts: 0x2a2a2a, skin: 0xf0c9a5, hair: 0xd9b46a, band: 0x2a2a2a, shoes: 0xf5d531 },
  },
  {
    id: 'malik', name: 'Malik Osei', short: 'OSEI', style: 'serveVolley', styleName: '서브 앤 발리',
    speed: 0.8, power: 0.72, control: 0.68, spin: 0.5, serve: 0.86, reach: 0.9,
    kit: { shirt: 0xffffff, shorts: 0x1d6b43, skin: 0x7a4a2c, hair: 0x120d0b, band: 0x1d6b43, shoes: 0xffffff },
  },
  {
    id: 'rosa', name: 'Rosa Vint', short: 'VINT', style: 'shotmaker', styleName: '샷메이커',
    speed: 0.7, power: 0.68, control: 0.95, spin: 0.75, serve: 0.62, reach: 0.58,
    kit: { shirt: 0xb63ad8, shorts: 0xf4f1e8, skin: 0xd8a079, hair: 0x6e2a1c, band: 0xb63ad8, shoes: 0xf4f1e8 },
  },
];

export const FORMATS = {
  tiebreak: { id: 'tiebreak', name: '타이브레이크', desc: '7점 선승(2점 차) 한 판', setsToWin: 1, games: 0, tiebreakAt: 0 },
  short: { id: 'short', name: '숏 세트', desc: '4게임 선승, 4-4에서 타이브레이크', setsToWin: 1, games: 4, tiebreakAt: 4 },
  set: { id: 'set', name: '1세트', desc: '6게임 선승, 6-6에서 타이브레이크', setsToWin: 1, games: 6, tiebreakAt: 6 },
  bo3: { id: 'bo3', name: '3세트', desc: '3세트 중 2세트 선승', setsToWin: 2, games: 6, tiebreakAt: 6 },
};

// reaction: seconds before the AI starts moving to a new ball.
// posErr: metres of misjudged intercept. timingSigma: seconds of swing timing noise.
// judge: metres of noise when deciding whether to leave a ball that is going out.
// errorRate / firstFault / secondFault: chance that an AI shot or serve simply
// goes wrong (net, long or wide) before pressure is applied.
export const DIFFICULTY = {
  rookie: { id: 'rookie', name: '루키', errorRate: 0.19, firstFault: 0.42, secondFault: 0.14, reaction: 0.36, posErr: 0.85, timingSigma: 0.06, aimNoise: 1.0, aggression: 0.25, speedMul: 0.86, judge: 0.7, challengeSense: 0.06 },
  pro: { id: 'pro', name: '프로', errorRate: 0.12, firstFault: 0.36, secondFault: 0.08, reaction: 0.22, posErr: 0.42, timingSigma: 0.034, aimNoise: 0.72, aggression: 0.5, speedMul: 0.96, judge: 0.32, challengeSense: 0.03 },
  champion: { id: 'champion', name: '챔피언', errorRate: 0.085, firstFault: 0.3, secondFault: 0.045, reaction: 0.13, posErr: 0.18, timingSigma: 0.019, aimNoise: 0.5, aggression: 0.72, speedMul: 1.04, judge: 0.14, challengeSense: 0.015 },
};

export const CHALLENGES_PER_SET = 3;

// Hit window shared by the human and the AI: how far (in seconds) the ball may be
// from the ideal contact point when the swing happens.
export const HIT_WINDOW = 0.16;
export const PERFECT_WINDOW = 0.035;
export const IDEAL_CONTACT_AHEAD = 0.45; // metres in front of the body

export function playerSpeed(profile) {
  return 5.0 + 2.0 * profile.speed;
}

export function playerReach(profile) {
  return 1.45 + 0.45 * profile.reach;
}

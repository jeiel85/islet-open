// The arena: court surface textures, net, stands with an instanced crowd,
// sponsor boards, floodlight towers, scoreboard, umpire chair, officials,
// ball kids, clay ball marks and the challenge-review mark.

import * as THREE from 'three';
import { COURT } from './config.js';
import { netHeightAt } from './physics.js';
import { BoxBatch, hash2, seededRandom, canvasTexture } from './voxel.js';
import { makeFigure } from './players.js';

const IN_X = COURT.runoffHalfWidth;   // 9.15
const IN_Z = COURT.runoffHalfLength;  // 18.3
const TIERS = 14;
const TIER_D = 0.85;
const TIER_H = 0.5;
const BASE_H = 1.2;
export const STAND_OUT = { x: IN_X + TIERS * TIER_D, z: IN_Z + TIERS * TIER_D };

const SPONSORS = [
  { text: 'ISLET BANK', bg: '#0f3d2e', fg: '#f4e9c8' },
  { text: 'CLOUDFERRY', bg: '#f4f1e8', fg: '#1f4fa8' },
  { text: 'SKYBREW', bg: '#c8322c', fg: '#ffffff' },
  { text: 'NIMBUS', bg: '#1a1d2b', fg: '#7fe0ff' },
  { text: 'DRIFT AIR', bg: '#f2c230', fg: '#1a1a1a' },
  { text: 'AEROLAB', bg: '#ffffff', fg: '#c8322c' },
];

function drawCourt(ctx, W, H, surface, wear) {
  const ppm = W / (IN_X * 2);
  const X = (x) => (x + IN_X) * ppm;
  const Z = (z) => (z + IN_Z) * ppm;
  const rect = (x0, z0, x1, z1, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(X(x0), Z(z0), (x1 - x0) * ppm, (z1 - z0) * ppm);
  };
  const L = COURT.halfLength, D = COURT.doublesHalfWidth, S = COURT.singlesHalfWidth, SV = COURT.serviceLine;
  const rnd = seededRandom(77);

  if (surface === 'hard') {
    rect(-IN_X, -IN_Z, IN_X, IN_Z, '#3c8a5f');
    rect(-D, -L, D, L, '#2f63b8');
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
  } else if (surface === 'clay') {
    rect(-IN_X, -IN_Z, IN_X, IN_Z, '#c4633a');
    for (let i = 0; i < 26000; i++) {
      const v = rnd();
      ctx.fillStyle = v < 0.33 ? 'rgba(120,45,20,0.18)' : v < 0.66 ? 'rgba(255,190,140,0.14)' : 'rgba(170,70,35,0.2)';
      ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
    // swept arcs from the drag mat
    ctx.strokeStyle = 'rgba(255,200,160,0.07)';
    ctx.lineWidth = 6;
    for (let k = 0; k < 14; k++) {
      ctx.beginPath();
      ctx.arc(W / 2, Z(-IN_Z) - 200 + k * 160, W * 0.9, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  } else {
    const stripe = 1.6;
    for (let z = -IN_Z; z < IN_Z; z += stripe) {
      const k = Math.floor((z + IN_Z) / stripe) % 2;
      rect(-IN_X, z, IN_X, Math.min(IN_Z, z + stripe), k ? '#5aae3f' : '#4c9c34');
    }
    // worn baselines and the server's paths
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 2600 * wear + 400; i++) {
        const x = (rnd() - 0.5) * (5 + wear * 4);
        const z = sz * (L + (rnd() - 0.35) * (1.6 + wear * 2.4));
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(160,130,70,0.55)' : 'rgba(130,110,60,0.45)';
        ctx.fillRect(X(x), Z(z), 3 + rnd() * 3, 3 + rnd() * 3);
      }
    }
  }

  // Lines sit inside the measured court edges (outer edge = boundary).
  const lw = surface === 'clay' ? 0.07 : 0.065;
  const bw = 0.1;
  const col = surface === 'clay' ? '#f5efe2' : '#ffffff';
  rect(-D, -L, D, -L + bw, col);
  rect(-D, L - bw, D, L, col);
  rect(-D, -L, -D + lw, L, col);
  rect(D - lw, -L, D, L, col);
  rect(-S, -L, -S + lw, L, col);
  rect(S - lw, -L, S, L, col);
  rect(-S, -SV, S, -SV + lw, col);
  rect(-S, SV - lw, S, SV, col);
  rect(-COURT.centerLineHalf, -SV, COURT.centerLineHalf, SV, col);
  rect(-COURT.centerLineHalf, -L, COURT.centerLineHalf, -L + 0.2, col);
  rect(-COURT.centerLineHalf, L - 0.2, COURT.centerLineHalf, L, col);
}

function sponsorTexture() {
  const { tex } = canvasTexture(1536, 96, (ctx, w, h) => {
    const bw = w / SPONSORS.length;
    SPONSORS.forEach((s, i) => {
      ctx.fillStyle = s.bg;
      ctx.fillRect(i * bw, 0, bw, h);
      ctx.fillStyle = s.fg;
      ctx.font = 'bold 54px "Archivo", "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, i * bw + bw / 2, h / 2 + 3);
    });
  }, { pixel: false });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function buildStadium(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const rnd = seededRandom(31337);

  // ── court surface ──
  const courtCanvas = document.createElement('canvas');
  courtCanvas.width = 768;
  courtCanvas.height = 1536;
  const courtTex = new THREE.CanvasTexture(courtCanvas);
  courtTex.colorSpace = THREE.SRGBColorSpace;
  courtTex.anisotropy = 8;
  const court = new THREE.Mesh(new THREE.PlaneGeometry(IN_X * 2, IN_Z * 2), new THREE.MeshLambertMaterial({ map: courtTex }));
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  group.add(court);

  function setSurface(id, wear = 0.3) {
    drawCourt(courtCanvas.getContext('2d'), courtCanvas.width, courtCanvas.height, id, wear);
    courtTex.needsUpdate = true;
    clearMarks();
  }

  // ── net ──
  const netGroup = new THREE.Group();
  group.add(netGroup);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x1e4a32 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, COURT.netHeightPost + 0.05, 0.1), postMat);
    post.position.set(sx * COURT.netPostX, (COURT.netHeightPost + 0.05) / 2, 0);
    post.castShadow = true;
    netGroup.add(post);
  }
  const segs = 40;
  const netPos = [], netUv = [], netIdx = [];
  for (let i = 0; i <= segs; i++) {
    const x = -COURT.netPostX + (i / segs) * COURT.netPostX * 2;
    const h = netHeightAt(x) - 0.05;
    netPos.push(x, 0, 0, x, h, 0);
    netUv.push(i / segs * 60, 0, i / segs * 60, h / 0.05);
    if (i < segs) {
      const a = i * 2;
      netIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(netPos, 3));
  netGeo.setAttribute('uv', new THREE.Float32BufferAttribute(netUv, 2));
  netGeo.setIndex(netIdx);
  netGeo.computeVertexNormals();
  const meshTex = canvasTexture(8, 8, (ctx) => {
    ctx.clearRect(0, 0, 8, 8);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, 8, 1);
    ctx.fillRect(0, 0, 1, 8);
  });
  meshTex.tex.wrapS = meshTex.tex.wrapT = THREE.RepeatWrapping;
  const net = new THREE.Mesh(netGeo, new THREE.MeshLambertMaterial({ map: meshTex.tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
  net.castShadow = true;
  netGroup.add(net);
  const tapeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let i = 0; i < segs; i++) {
    const x0 = -COURT.netPostX + (i / segs) * COURT.netPostX * 2;
    const x1 = x0 + COURT.netPostX * 2 / segs;
    const xm = (x0 + x1) / 2;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.01, 0.06, 0.03), tapeMat);
    tape.position.set(xm, netHeightAt(xm) - 0.03, 0);
    netGroup.add(tape);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, COURT.netHeightCenter, 0.025), tapeMat);
  strap.position.set(0, COURT.netHeightCenter / 2, 0);
  netGroup.add(strap);

  // ── stands, façade, aisles ──
  const stands = new BoxBatch();
  const seatCols = [0xc23a35, 0xf1ece2];
  const sideRuns = [];
  for (let i = 0; i < TIERS; i++) {
    const top = BASE_H + i * TIER_H;
    const ox = IN_X + i * TIER_D, oz = IN_Z + i * TIER_D;
    // End stands (behind the baselines) own the corners.
    for (const sz of [-1, 1]) {
      sideRuns.push({ axis: 'x', fixed: sz * (oz + TIER_D / 2), from: -(ox + TIER_D), to: ox + TIER_D, top, face: -sz, tier: i });
    }
    for (const sx of [-1, 1]) {
      sideRuns.push({ axis: 'z', fixed: sx * (ox + TIER_D / 2), from: -oz, to: oz, top, face: -sx, tier: i });
    }
  }
  const SECTION = 5.2, AISLE = 0.9;
  const seatsForCrowd = [];
  for (const run of sideRuns) {
    let s = run.from;
    let k = 0;
    while (s < run.to - 0.01) {
      const isAisle = k % 2 === 1;
      const seg = Math.min(isAisle ? AISLE : SECTION, run.to - s);
      const mid = s + seg / 2;
      const col = isAisle ? 0xb5b0a6 : seatCols[(Math.floor(k / 2) + (run.tier % 2 === 0 ? 0 : 0)) % 2];
      const shade = isAisle ? col : (run.tier % 2 ? col : new THREE.Color(col).multiplyScalar(0.9).getHex());
      if (run.axis === 'x') stands.add(mid, 0, run.fixed, seg, run.top, TIER_D, shade);
      else stands.add(run.fixed, 0, mid, TIER_D, run.top, seg, shade);
      if (!isAisle) {
        for (let p = s + 0.3; p < s + seg - 0.2; p += 0.62) {
          const pos = run.axis === 'x' ? { x: p, z: run.fixed } : { x: run.fixed, z: p };
          seatsForCrowd.push({ ...pos, y: run.top, face: run.face, axis: run.axis });
        }
      }
      s += seg;
      k++;
    }
  }
  // Front walls under the first tier (sponsor boards are planes on top of them).
  const topH = BASE_H + (TIERS - 1) * TIER_H;
  // Façade with red/white stripes around the outside.
  const fx = STAND_OUT.x + 0.3, fz = STAND_OUT.z + 0.3;
  const facadeH = topH + 1.6;
  const stripe = 1.6;
  for (const sz of [-1, 1]) {
    for (let x = -fx; x < fx; x += stripe) {
      const k = Math.round((x + fx) / stripe);
      stands.add(x + stripe / 2, 0, sz * fz, stripe, facadeH, 0.6, k % 2 ? 0xffffff : 0xc8322c);
    }
  }
  for (const sx of [-1, 1]) {
    for (let z = -fz; z < fz; z += stripe) {
      const k = Math.round((z + fz) / stripe);
      stands.add(sx * fx, 0, z + stripe / 2, 0.6, facadeH, stripe, k % 2 ? 0xffffff : 0xc8322c);
    }
  }
  // Roof rim along the long sides and a band of dark-green trim.
  for (const sx of [-1, 1]) {
    stands.add(sx * (fx - 2.2), facadeH, 0, 5.0, 0.5, fz * 2 + 0.6, 0xf1ece2);
    stands.add(sx * (fx - 4.6), facadeH - 0.6, 0, 0.3, 0.6, fz * 2 + 0.6, 0x1d4d35);
  }
  for (const sz of [-1, 1]) stands.add(0, facadeH, sz * fz, fx * 2 + 0.6, 0.35, 0.8, 0x1d4d35);
  // Concrete apron between court and first tier is the court plane itself.
  group.add(stands.build());

  // ── sponsor boards ──
  const sponsorTex = sponsorTexture();
  const addBoard = (len, x, z, rotY) => {
    const t = sponsorTex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 18, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), new THREE.MeshLambertMaterial({ map: t }));
    m.position.set(x, 0.62, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    group.add(m);
  };
  addBoard(IN_X * 2, 0, -IN_Z + 0.02, 0);
  addBoard(IN_X * 2, 0, IN_Z - 0.02, Math.PI);
  addBoard(IN_Z * 2, -IN_X + 0.02, 0, Math.PI / 2);
  addBoard(IN_Z * 2, IN_X - 0.02, 0, -Math.PI / 2);

  // ── crowd ──
  const bodyGeo = new THREE.BoxGeometry(0.44, 0.52, 0.3);
  bodyGeo.translate(0, 0.26, 0);
  const headGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  headGeo.translate(0, 0.66, 0);
  const crowdMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const people = seatsForCrowd.filter((_, i) => hash2(i, 3, 99) < 0.86);
  const bodies = new THREE.InstancedMesh(bodyGeo, crowdMat, people.length);
  const heads = new THREE.InstancedMesh(headGeo, crowdMat, people.length);
  const shirtCols = [0xffffff, 0xf2c230, 0x2f63b8, 0xc8322c, 0x3c9a5f, 0xf28a3c, 0x1a1a24, 0xb63ad8, 0x7fd0e8, 0xe85a8a, 0xdedede];
  const skinCols = [0xf0c9a5, 0xe0ac7e, 0xc68c5c, 0x8d5a36, 0x6b4128, 0xf6d7b8];
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const crowdBase = [];
  people.forEach((p, i) => {
    const rotY = p.axis === 'x' ? (p.face > 0 ? Math.PI : 0) : (p.face > 0 ? -Math.PI / 2 : Math.PI / 2);
    tmp.position.set(p.x + (rnd() - 0.5) * 0.08, p.y, p.z);
    tmp.rotation.set(0, rotY + (rnd() - 0.5) * 0.3, 0);
    tmp.updateMatrix();
    bodies.setMatrixAt(i, tmp.matrix);
    heads.setMatrixAt(i, tmp.matrix);
    bodies.setColorAt(i, col.set(shirtCols[Math.floor(rnd() * shirtCols.length)]));
    heads.setColorAt(i, col.set(skinCols[Math.floor(rnd() * skinCols.length)]));
    crowdBase.push({ x: tmp.position.x, y: p.y, z: p.z, rotY: tmp.rotation.y, phase: rnd() * 6, eager: 0.4 + rnd() * 0.6 });
  });
  bodies.castShadow = false;
  bodies.receiveShadow = true;
  heads.receiveShadow = true;
  group.add(bodies, heads);
  let excitement = 0;
  let crowdDirty = false;

  // ── floodlights ──
  const towerBatch = new BoxBatch();
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x000000 });
  const spots = [];
  const towerPos = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (STAND_OUT.x + 2.2), z = sz * (STAND_OUT.z + 2.2);
    towerPos.push({ x, z, sx, sz });
    towerBatch.add(x, 0, z, 0.9, 32, 0.9, 0x8e9499);
    towerBatch.add(x, 31.2, z, 1.4, 0.4, 1.4, 0x5e6266);
  }
  group.add(towerBatch.build());
  for (const t of towerPos) {
    const panel = new THREE.Group();
    panel.position.set(t.x, 33.5, t.z);
    panel.lookAt(0, 0, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.4, 0.5), new THREE.MeshLambertMaterial({ color: 0x3a3e44 }));
    panel.add(back);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.2), lampMat);
      lamp.position.set(-2.6 + c * 1.04, -1.05 + r * 1.05, 0.3);
      panel.add(lamp);
    }
    group.add(panel);
    const spot = new THREE.SpotLight(0xfff3dc, 0, 0, 0.5, 0.65, 0);
    spot.position.set(t.x * 0.95, 33, t.z * 0.95);
    spot.target.position.set(-t.sx * 2, 0, -t.sz * 5);
    group.add(spot, spot.target);
    spots.push(spot);
  }
  // Light shafts (visible at night).
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1cc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beams = new THREE.Group();
  group.add(beams);
  for (const t of towerPos) {
    const len = Math.hypot(t.x, 33, t.z);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(9, len, 12, 1, true), beamMat);
    beam.position.set(t.x / 2, 33 / 2, t.z / 2);
    beam.lookAt(0, 0, 0);
    beam.rotateX(-Math.PI / 2);
    beams.add(beam);
  }

  // ── scoreboard ──
  const sbCanvas = document.createElement('canvas');
  sbCanvas.width = 320;
  sbCanvas.height = 128;
  const sbTex = new THREE.CanvasTexture(sbCanvas);
  sbTex.colorSpace = THREE.SRGBColorSpace;
  sbTex.magFilter = THREE.NearestFilter;
  const sbFrame = new THREE.Mesh(new THREE.BoxGeometry(13.6, 6.0, 0.8), new THREE.MeshLambertMaterial({ color: 0x1d2a24 }));
  const sbY = topH + 4.6;
  sbFrame.position.set(0, sbY, -(STAND_OUT.z - 0.6));
  group.add(sbFrame);
  const sbScreen = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 5.2), new THREE.MeshBasicMaterial({ map: sbTex, fog: false }));
  sbScreen.position.set(0, sbY, -(STAND_OUT.z - 1.01));
  group.add(sbScreen);
  const sbLegs = new BoxBatch();
  sbLegs.add(-5, topH, -(STAND_OUT.z - 0.6), 0.5, 2, 0.5, 0x3a3e44);
  sbLegs.add(5, topH, -(STAND_OUT.z - 0.6), 0.5, 2, 0.5, 0x3a3e44);
  group.add(sbLegs.build());
  // Wind flag on top of the scoreboard.
  const flagPole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  flagPole.position.set(6.2, sbY + 4.4, -(STAND_OUT.z - 0.6));
  group.add(flagPole);
  const flag = new THREE.Group();
  flag.position.set(6.2, sbY + 5.7, -(STAND_OUT.z - 0.6));
  const flagCloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.05), new THREE.MeshLambertMaterial({ color: 0x1fb5a8 }));
  flagCloth.position.x = 0.8;
  flag.add(flagCloth);
  group.add(flag);

  function setScoreboard(rows) {
    const ctx = sbCanvas.getContext('2d');
    ctx.fillStyle = '#0b1410';
    ctx.fillRect(0, 0, 320, 128);
    ctx.font = 'bold 22px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    rows.lines.forEach((ln, i) => {
      const y = 26 + i * 34;
      ctx.fillStyle = ln.serving ? '#ffd23f' : '#3a4a40';
      ctx.fillRect(10, y - 5, 8, 10);
      ctx.fillStyle = '#e9f7ea';
      ctx.textAlign = 'left';
      ctx.fillText(ln.name.slice(0, 10), 26, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#9fe0b0';
      ctx.fillText(ln.sets, 236, y);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(ln.points, 306, y);
    });
    ctx.fillStyle = '#7fd0e8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillText(rows.footer || '', 160, 108);
    sbTex.needsUpdate = true;
  }

  // ── umpire chair, benches, officials ──
  const furn = new BoxBatch();
  const chairX = -(COURT.doublesHalfWidth + 1.9);
  for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) furn.add(chairX + dx, 0, dz, 0.08, 1.9, 0.08, 0x2a4f3a);
  furn.add(chairX, 1.9, 0, 0.95, 0.12, 0.95, 0x2a4f3a);
  furn.add(chairX - 0.42, 1.9, 0, 0.1, 1.0, 0.95, 0x2a4f3a);
  furn.add(chairX, 3.1, 0, 1.1, 0.08, 1.2, 0x1d4d35);
  for (const sz of [-1, 1]) {
    furn.add(chairX - 0.3, 0, sz * 2.4, 0.6, 0.45, 1.4, 0x1d4d35);       // player bench
    furn.add(chairX - 0.3, 0.45, sz * 2.4, 0.15, 0.6, 1.4, 0x1d4d35);
    furn.add(chairX + 0.1, 0, sz * 3.6, 0.5, 0.5, 0.5, 0x1fb5a8);       // cooler
  }
  group.add(furn.build());
  const officialKit = { shirt: 0x24304a, shorts: 0x24304a, skin: 0xe0ac7e, hair: 0x2a2018, band: 0xd8c690, shoes: 0x111111 };
  const kidKit = { shirt: 0x1fb5a8, shorts: 0x1a1a24, skin: 0xd8a079, hair: 0x2a2018, band: 0x1fb5a8, shoes: 0xffffff };
  const umpire = makeFigure({ ...officialKit, skin: 0xc68c5c }, 'sit');
  umpire.root.position.set(chairX, 1.4, 0);
  umpire.root.rotation.y = -Math.PI / 2;
  group.add(umpire.root);
  const judges = [];
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const j = makeFigure(officialKit, 'stand');
    j.root.position.set(sx * 7.9, 0, sz * (IN_Z - 0.6));
    j.root.rotation.y = sz > 0 ? 0 : Math.PI;
    j.root.scale.setScalar(0.95);
    group.add(j.root);
    judges.push({ m: j, sx, sz });
  }
  const kids = [];
  for (const sx of [-1, 1]) {
    const k = makeFigure(kidKit, 'crouch');
    k.root.position.set(sx * (COURT.netPostX + 1.6), 0, 0.5 * sx);
    k.root.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    k.root.scale.setScalar(0.72);
    group.add(k.root);
    kids.push(k);
  }
  for (const sz of [-1, 1]) {
    const k = makeFigure(kidKit, 'stand');
    k.root.position.set(sz * 8.4, 0, sz * (IN_Z - 0.5));
    k.root.rotation.y = sz > 0 ? 0 : Math.PI;
    k.root.scale.setScalar(0.72);
    group.add(k.root);
  }
  let judgeSignal = null;

  // ── ball marks (clay) and the review mark ──
  const markGeo = new THREE.CircleGeometry(1, 14);
  markGeo.rotateX(-Math.PI / 2);
  const marks = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0x8a3f1c, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    group.add(m);
    marks.push(m);
  }
  let markIdx = 0;
  function addMark(x, z, vx, vz, surface) {
    if (surface !== 'clay') return;
    const m = marks[markIdx++ % marks.length];
    m.position.set(x, 0.006, z);
    m.scale.set(0.034, 1, 0.034 * 2.2);
    m.rotation.y = Math.atan2(vx, vz);
    m.material.opacity = 0.55;
    m.visible = true;
    m.userData.life = 18;
  }
  function clearMarks() {
    for (const m of marks) { m.visible = false; m.userData.life = 0; }
  }

  const review = new THREE.Group();
  review.visible = false;
  group.add(review);
  const reviewMark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
  review.add(reviewMark);
  const reviewRing = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false }));
  review.add(reviewRing);
  const reviewBall = new THREE.Mesh(new THREE.SphereGeometry(COURT.ballRadius, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd9f23a }));
  review.add(reviewBall);

  function showReview(call, t) {
    review.visible = true;
    beams.visible = false;
    const k = Math.min(1, t / 1.6);
    reviewBall.position.set(call.x - call.vx * (1 - k) * 0.25, COURT.ballRadius + (1 - k) * 0.25, call.z - call.vz * (1 - k) * 0.25);
    reviewMark.position.set(call.x, 0.008, call.z);
    reviewMark.scale.set(COURT.ballRadius, 1, COURT.ballRadius * 1.9);
    reviewMark.rotation.y = Math.atan2(call.vx, call.vz);
    reviewMark.material.opacity = k >= 1 ? 0.95 : 0;
    reviewMark.material.color.set(t > 2.4 ? (call.trueIn ? 0x3ce07a : 0xff4a4a) : 0xffffff);
    reviewRing.position.set(call.x, 0.01, call.z);
    reviewRing.material.opacity = 0.6 + 0.4 * Math.sin(t * 8);
  }
  function hideReview() { review.visible = false; beams.visible = true; }

  // ── updates ──
  function update(dt, t, wind) {
    for (const m of marks) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      m.material.opacity = Math.max(0, Math.min(0.55, m.userData.life / 6));
      if (m.userData.life <= 0) m.visible = false;
    }
    if (excitement > 0.01 || crowdDirty) {
      excitement = Math.max(0, excitement - dt * 0.35);
      crowdBase.forEach((c, i) => {
        const hop = excitement > 0 ? Math.max(0, Math.sin(t * 9 * c.eager + c.phase)) * 0.28 * excitement * c.eager : 0;
        tmp.position.set(c.x, c.y + hop, c.z);
        tmp.rotation.set(0, c.rotY, 0);
        tmp.updateMatrix();
        bodies.setMatrixAt(i, tmp.matrix);
        heads.setMatrixAt(i, tmp.matrix);
      });
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      crowdDirty = excitement > 0.01;
    }
    const ws = Math.hypot(wind.x, wind.z);
    flag.rotation.y = -Math.atan2(wind.z, wind.x);
    flag.rotation.z = -Math.max(0, 1.2 - ws * 0.25) + Math.sin(t * (2 + ws)) * 0.05 * (1 + ws * 0.3);
    // Line judges on the side of an OUT call stretch an arm out.
    for (const j of judges) {
      const target = judgeSignal && judgeSignal.sz === j.sz ? 1.55 : 0.1;
      j.m.armR.rotation.z += (target - j.m.armR.rotation.z) * Math.min(1, dt * 10);
    }
    if (judgeSignal) { judgeSignal.t -= dt; if (judgeSignal.t <= 0) judgeSignal = null; }
  }

  // Floodlights never cast shadows: toggling shadow casters would recompile
  // every material. Player shadows at night come from the moonlight.
  function setFloodlights(level) {
    for (const s of spots) s.intensity = level * 1.6;
    lampMat.emissive.set(level > 0 ? 0xfff3d0 : 0x000000);
    lampMat.emissiveIntensity = level;
    beamMat.opacity = level * 0.045;
  }

  return {
    group, setSurface, setScoreboard, update, setFloodlights,
    cheer(level = 1) { excitement = Math.min(1.4, excitement + level); crowdDirty = true; },
    signalOut(z) { judgeSignal = { sz: Math.sign(z) || 1, t: 1.6 }; },
    addMark, clearMarks, showReview, hideReview,
    crowdCount: people.length,
  };
}

// The floating island: voxel terrain with a stepped rocky underside, forest,
// pond and waterfall, promenade, clubhouse, small drifting islets, blocky
// clouds, gradient sky, sun/moon, stars and the time-of-day lighting.

import * as THREE from 'three';
import { BoxBatch, fbm, hash2, seededRandom, canvasTexture, shade } from './voxel.js';

export const STADIUM_HALF = { x: 23.2, z: 32.2 }; // outer footprint of the arena
const CELL = 2.5;
const ISLAND_R = 68;
const POND = { x: -37, z: 14, r: 7.5 };
const CLUBHOUSE = { x: 35, z: -9, w: 11, d: 9 };

function edgeRadius(a) {
  return ISLAND_R + 7 * (fbm(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5, 9) - 0.5) * 2;
}

function distToStadium(x, z) {
  const dx = Math.max(0, Math.abs(x) - STADIUM_HALF.x);
  const dz = Math.max(0, Math.abs(z) - STADIUM_HALF.z);
  return Math.hypot(dx, dz);
}

const TIMES = {
  day: {
    skyTop: 0x3f86de, skyHorizon: 0xb9e0ff, skyBottom: 0xe6f6ff,
    fog: 0xc6e3ff, fogNear: 220, fogFar: 900,
    sunPos: [70, 120, 55], sunColor: 0xfff1d8, sunIntensity: 2.7,
    hemiSky: 0xd3e8ff, hemiGround: 0x6b7a45, hemiIntensity: 1.25,
    flood: 0, stars: 0, disc: 0xfff6c8, discSize: 26,
  },
  sunset: {
    skyTop: 0x353a86, skyHorizon: 0xff9554, skyBottom: 0xffc985,
    fog: 0xe9956a, fogNear: 180, fogFar: 800,
    sunPos: [-150, 26, -95], sunColor: 0xffa860, sunIntensity: 2.3,
    hemiSky: 0xffb08a, hemiGround: 0x4d3a48, hemiIntensity: 0.95,
    flood: 0.55, stars: 0.15, disc: 0xffe0a0, discSize: 46,
  },
  night: {
    skyTop: 0x050819, skyHorizon: 0x1b2a58, skyBottom: 0x0b1532,
    fog: 0x0e1836, fogNear: 160, fogFar: 700,
    sunPos: [55, 95, -70], sunColor: 0x93a8ff, sunIntensity: 0.42,
    hemiSky: 0x34467f, hemiGround: 0x120f1c, hemiIntensity: 0.42,
    flood: 1, stars: 1, disc: 0xe8eeff, discSize: 18,
  },
};

export function buildWorld(scene) {
  const rnd = seededRandom(20261103);
  const group = new THREE.Group();
  scene.add(group);

  // ── sky ──
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.8)) : mix(horizon, bottom, min(1.0, -h * 2.5));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.92;
    const r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(a) * r * 1500, y * 1500, Math.sin(a) * r * 1500);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true }));
  scene.add(disc);

  // ── lights ──
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -78; sc.right = 78; sc.top = 78; sc.bottom = -78; sc.near = 10; sc.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  scene.fog = new THREE.Fog(0xffffff, 200, 800);

  // ── island terrain ──
  const top = new BoxBatch();
  const under = new BoxBatch();
  const deco = new BoxBatch();
  const heights = new Map();
  const waterCells = [];
  const grassCols = [0x5fae3b, 0x67b842, 0x58a536, 0x6cbf47, 0x52a034];
  const n = Math.ceil((ISLAND_R + 8) / CELL);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i * CELL, z = j * CELL;
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const er = edgeRadius(a);
      if (r > er) continue;
      const ds = distToStadium(x, z);
      const pd = Math.hypot(x - POND.x, z - POND.z);
      let h = 0;
      let col = grassCols[Math.floor(hash2(i, j, 3) * grassCols.length)];
      if (ds < 1.2) continue; // stadium floor is built separately
      if (ds < 5.5) {
        col = hash2(i, j, 5) < 0.5 ? 0xc9c0ad : 0xbcb39f; // promenade
      } else if (pd < POND.r) {
        h = -0.9;
        col = 0x8a7a55;
        waterCells.push({ x, z });
      } else {
        const hn = fbm(x * 0.045 + 20, z * 0.045 - 3, 4);
        h = Math.max(0, Math.round((hn - 0.42) * 7) * 0.5);
        h += Math.max(0, (r - (er - 9)) * 0.12); // little rim
        h = Math.round(h * 2) / 2;
        if (pd < POND.r + 3) h = Math.min(h, 0.2);
      }
      heights.set(`${i},${j}`, h);
      const edge = er - r < CELL * 1.2;
      top.add(x, -1.2, z, CELL, h + 1.2, CELL, edge && hash2(i, j, 8) < 0.4 ? shade(col, 0.85) : col);

      // Underside: dirt, rock, then dark rock tapering to a point.
      const depth = 6 + Math.pow(Math.max(0, 1 - r / er), 1.2) * 62 + fbm(x * 0.1, z * 0.1, 12) * 9;
      const dirt = Math.min(depth, 3 + hash2(i, j, 11) * 2);
      under.add(x, -1.2 - dirt, z, CELL, dirt, CELL, hash2(i, j, 13) < 0.5 ? 0x7a5634 : 0x6e4c2d);
      const mid = Math.max(0, Math.min(depth - dirt, depth * 0.55));
      if (mid > 0) under.add(x, -1.2 - dirt - mid, z, CELL, mid, CELL, hash2(i, j, 17) < 0.5 ? 0x7b7469 : 0x6d665c);
      const rest = depth - dirt - mid;
      if (rest > 0) under.add(x, -1.2 - depth, z, CELL, rest, CELL, hash2(i, j, 19) < 0.5 ? 0x4f4a46 : 0x5a534d);
      if (hash2(i, j, 23) < 0.05) {
        const s = 4 + hash2(i, j, 29) * 10;
        under.add(x, -1.2 - depth - s, z, CELL * 0.5, s, CELL * 0.5, 0x4a4541);
      }
    }
  }
  const topMesh = top.build();
  const underMesh = under.build({ castShadow: false, receiveShadow: false });
  group.add(topMesh, underMesh);

  // Pond water and the stream to the edge.
  const water = new THREE.MeshLambertMaterial({ color: 0x3aa3d6, emissive: 0x0b3a5a, transparent: true, opacity: 0.88 });
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.6, 20), water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, -0.25, POND.z);
  group.add(pond);

  // Waterfall: from the island edge beyond the pond.
  const fallAngle = Math.atan2(POND.z, POND.x);
  const fallR = edgeRadius(fallAngle) - 1.5;
  const fall = { x: Math.cos(fallAngle) * fallR, z: Math.sin(fallAngle) * fallR };
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(2.4, Math.hypot(fall.x - POND.x, fall.z - POND.z)), water);
  stream.rotation.x = -Math.PI / 2;
  stream.rotation.z = -Math.atan2(fall.z - POND.z, fall.x - POND.x) + Math.PI / 2;
  stream.position.set((fall.x + POND.x) / 2, 0.55, (fall.z + POND.z) / 2);
  group.add(stream);
  const sheetTex = canvasTexture(16, 64, (ctx, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = hash2(x, y, 4);
      ctx.fillStyle = v > 0.8 ? '#e9fbff' : v > 0.45 ? '#7fd3f2' : '#4cb4e3';
      ctx.fillRect(x, y, 1, 1);
    }
  });
  sheetTex.tex.wrapS = sheetTex.tex.wrapT = THREE.RepeatWrapping;
  sheetTex.tex.repeat.set(1, 4);
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 70),
    new THREE.MeshBasicMaterial({ map: sheetTex.tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  sheet.position.set(fall.x + Math.cos(fallAngle) * 2.2, -34, fall.z + Math.sin(fallAngle) * 2.2);
  sheet.rotation.y = -fallAngle + Math.PI / 2;
  group.add(sheet);

  // ── trees ──
  const trunks = new BoxBatch();
  const leaves = new BoxBatch();
  const leafCols = [0x2f8a3a, 0x3c9a3f, 0x27773a, 0x4aa844, 0x1f6b35, 0x5bb04a];
  const fallCols = [0xe0882a, 0xd2622a, 0xe8b23a, 0xc94a3a];
  let treeCount = 0;
  for (const [key, h] of heights) {
    const [i, j] = key.split(',').map(Number);
    const x = i * CELL, z = j * CELL;
    const ds = distToStadium(x, z);
    if (ds < 7.5) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2) continue;
    if (Math.abs(x - CLUBHOUSE.x) < CLUBHOUSE.w && Math.abs(z - CLUBHOUSE.z) < CLUBHOUSE.d) continue;
    if (Math.abs(x) < 9 && z > 34 && z < 66) continue; // practice court
    if (x > 24 && x < 40 && z > 8 && z < 24) continue;  // café terrace
    const dens = fbm(x * 0.06, z * 0.06, 31);
    if (hash2(i, j, 37) > dens * 1.25) continue;
    const ox = (hash2(i, j, 41) - 0.5) * 1.2, oz = (hash2(i, j, 43) - 0.5) * 1.2;
    const tx = x + ox, tz = z + oz;
    const kind = hash2(i, j, 47);
    const s = 0.8 + hash2(i, j, 53) * 0.7;
    const autumn = hash2(i, j, 59) < 0.12;
    const lc = autumn ? fallCols[Math.floor(hash2(i, j, 61) * fallCols.length)] : leafCols[Math.floor(hash2(i, j, 67) * leafCols.length)];
    const ry = hash2(i, j, 71) * Math.PI;
    trunks.add(tx, h, tz, 0.55 * s, 1.8 * s, 0.55 * s, 0x6b4a2b, ry);
    if (kind < 0.3) {
      // pine: stacked shrinking cubes
      for (let k = 0; k < 3; k++) {
        const w = (2.8 - k * 0.8) * s;
        leaves.add(tx, h + (1.2 + k * 1.15) * s, tz, w, 1.3 * s, w, shade(lc, 0.85 + k * 0.08), ry);
      }
    } else {
      leaves.add(tx, h + 1.4 * s, tz, 3.0 * s, 2.4 * s, 3.0 * s, lc, ry);
      leaves.add(tx + 0.3 * s, h + 3.3 * s, tz - 0.2 * s, 2.0 * s, 1.5 * s, 2.0 * s, shade(lc, 1.12), ry + 0.4);
    }
    treeCount++;
  }
  group.add(trunks.build(), leaves.build());

  // ── clubhouse, café parasols, practice court ──
  const bx = CLUBHOUSE.x, bz = CLUBHOUSE.z;
  deco.add(bx, 0, bz, CLUBHOUSE.w, 4.2, CLUBHOUSE.d, 0xf1e6d2);
  deco.add(bx, 4.2, bz, CLUBHOUSE.w + 0.8, 0.5, CLUBHOUSE.d + 0.8, 0x9d2f2a);
  for (let k = 0; k < 4; k++) deco.add(bx, 4.7 + k * 0.6, bz, CLUBHOUSE.w + 0.4 - k * 2.4, 0.6, CLUBHOUSE.d - 1 - k * 1.6, k % 2 ? 0xb8392f : 0xa83229);
  deco.add(bx, 7.2, bz - 2, 1.2, 2.2, 1.2, 0xe8dcc6); // chimney / clock tower
  for (let k = -1; k <= 1; k++) {
    deco.add(bx - CLUBHOUSE.w / 2 - 0.05, 1.4, bz + k * 2.6, 0.2, 1.4, 1.4, 0x5c86b8);
  }
  deco.add(bx - CLUBHOUSE.w / 2 - 0.05, 0, bz, 0.2, 2.4, 1.6, 0x6b4a2b);
  // terrace tables
  for (let k = 0; k < 5; k++) {
    const tx = 28 + (k % 3) * 4.5, tz = 11 + Math.floor(k / 3) * 6 + (k % 2) * 1.5;
    deco.add(tx, 0, tz, 1.2, 0.8, 1.2, 0xf4f1e8);
    deco.add(tx, 0, tz, 0.15, 2.6, 0.15, 0xdddddd);
  }
  // practice court
  deco.add(0, 0, 50, 13, 0.08, 26, 0x2f7d4f);
  deco.add(0, 0.08, 50, 9.2, 0.03, 21, 0x3b6fb6);
  deco.add(0, 0.11, 50, 9.2, 0.03, 0.12, 0xffffff);
  deco.add(0, 0.11, 39.6, 9.2, 0.03, 0.12, 0xffffff);
  deco.add(0, 0.11, 60.4, 9.2, 0.03, 0.12, 0xffffff);
  deco.add(-4.55, 0.11, 50, 0.12, 0.03, 21, 0xffffff);
  deco.add(4.55, 0.11, 50, 0.12, 0.03, 21, 0xffffff);
  deco.add(0, 0, 50, 10.5, 1.0, 0.06, 0xf4f4f4);
  group.add(deco.build());

  // Parasols (striped cones) on the terrace.
  const parasolGeo = new THREE.ConeGeometry(2.2, 1.1, 8, 1, true).toNonIndexed();
  const pc = [];
  const triCount = parasolGeo.attributes.position.count / 3;
  for (let t = 0; t < triCount; t++) {
    const c = new THREE.Color(Math.floor(t / 1) % 2 ? 0xffffff : 0xd8322c);
    for (let k = 0; k < 3; k++) pc.push(c.r, c.g, c.b);
  }
  parasolGeo.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
  const parasolMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (let k = 0; k < 5; k++) {
    const p = new THREE.Mesh(parasolGeo, parasolMat);
    p.position.set(28 + (k % 3) * 4.5, 3.0, 11 + Math.floor(k / 3) * 6 + (k % 2) * 1.5);
    p.castShadow = true;
    group.add(p);
  }

  // ── islets ──
  const islets = [];
  const isletCount = 8;
  for (let k = 0; k < isletCount; k++) {
    const a = (k / isletCount) * Math.PI * 2 + rnd() * 0.5;
    const dist = 105 + rnd() * 90;
    const g = new THREE.Group();
    const b = new BoxBatch();
    const rad = 3 + rnd() * 5;
    const cs = 1.5;
    const m = Math.ceil(rad / cs);
    for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) {
      const r = Math.hypot(i * cs, j * cs);
      if (r > rad) continue;
      b.add(i * cs, -0.6, j * cs, cs, 0.6, cs, hash2(i, j, k) < 0.5 ? 0x63b23f : 0x56a535);
      const d = 2 + Math.pow(1 - r / rad, 0.8) * rad * 2.2;
      b.add(i * cs, -0.6 - d, j * cs, cs, d, cs, hash2(i, j, k + 50) < 0.5 ? 0x6e4c2d : 0x5c534b);
    }
    const trees = 1 + Math.floor(rnd() * 3);
    for (let t = 0; t < trees; t++) {
      const tx = (rnd() - 0.5) * rad, tz = (rnd() - 0.5) * rad;
      b.add(tx, 0, tz, 0.4, 1.2, 0.4, 0x6b4a2b);
      b.add(tx, 1.0, tz, 2.0, 1.8, 2.0, leafCols[Math.floor(rnd() * leafCols.length)]);
    }
    g.add(b.build({ castShadow: false, receiveShadow: false }));
    const baseY = -18 + rnd() * 40;
    g.position.set(Math.cos(a) * dist, baseY, Math.sin(a) * dist);
    group.add(g);
    islets.push({ g, baseY, phase: rnd() * 6, speed: 0.2 + rnd() * 0.25 });
  }

  // ── clouds ──
  const clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x334455 });
  for (let k = 0; k < 16; k++) {
    const b = new BoxBatch();
    const parts = 4 + Math.floor(rnd() * 5);
    for (let p = 0; p < parts; p++) {
      const w = 8 + rnd() * 14;
      b.add((rnd() - 0.5) * 26, (rnd() - 0.3) * 3, (rnd() - 0.5) * 12, w, 3 + rnd() * 4, w * (0.5 + rnd() * 0.5), 0xffffff);
    }
    const mesh = b.build({ castShadow: false, receiveShadow: false, material: cloudMat });
    const a = rnd() * Math.PI * 2;
    const dist = 140 + rnd() * 320;
    mesh.position.set(Math.cos(a) * dist, 30 + rnd() * 70 * (rnd() < 0.3 ? -1 : 1), Math.sin(a) * dist);
    scene.add(mesh);
    clouds.push({ mesh, speed: 1.5 + rnd() * 2.5 });
  }

  // ── time of day ──
  const tmpCol = new THREE.Color();
  let current = 'day';
  let floodLevel = 0;

  function setTimeOfDay(mode) {
    const T = TIMES[mode] || TIMES.day;
    current = mode;
    skyMat.uniforms.top.value.set(T.skyTop);
    skyMat.uniforms.horizon.value.set(T.skyHorizon);
    skyMat.uniforms.bottom.value.set(T.skyBottom);
    scene.fog.color.set(T.fog);
    scene.fog.near = T.fogNear;
    scene.fog.far = T.fogFar;
    hemi.color.set(T.hemiSky);
    hemi.groundColor.set(T.hemiGround);
    hemi.intensity = T.hemiIntensity;
    sun.color.set(T.sunColor);
    sun.intensity = T.sunIntensity;
    sun.position.set(...T.sunPos);
    sun.target.position.set(0, 0, 0);
    starMat.opacity = T.stars;
    stars.visible = T.stars > 0;
    disc.material.color.set(T.disc);
    const dir = new THREE.Vector3(...T.sunPos).normalize();
    disc.position.copy(dir.multiplyScalar(1400));
    disc.scale.setScalar(T.discSize * 2.2);
    cloudMat.emissive.copy(tmpCol.set(T.fog).multiplyScalar(0.35));
    cloudMat.color.set(mode === 'night' ? 0x5a6688 : mode === 'sunset' ? 0xffd2b0 : 0xffffff);
    water.emissive.set(mode === 'night' ? 0x061830 : 0x0b3a5a);
    floodLevel = T.flood;
    return T;
  }

  function update(dt, t, camera) {
    for (const it of islets) it.g.position.y = it.baseY + Math.sin(t * it.speed + it.phase) * 1.4;
    for (const c of clouds) {
      c.mesh.position.x += c.speed * dt;
      if (c.mesh.position.x > 520) c.mesh.position.x = -520;
    }
    sheetTex.tex.offset.y = (t * 1.6) % 1;
    disc.lookAt(camera.position);
  }

  return {
    group, sun, hemi, update, setTimeOfDay,
    get time() { return current; },
    get flood() { return floodLevel; },
    treeCount,
  };
}

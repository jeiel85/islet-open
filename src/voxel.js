// Tiny helpers for building blocky (voxel-style) scenery with instancing.

import * as THREE from 'three';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.translate(0, 0.5, 0); // origin at the bottom face

/**
 * Collects boxes, then builds one InstancedMesh with per-instance colour.
 * add(x, y, z, sx, sy, sz, color) — y is the bottom of the box.
 */
export class BoxBatch {
  constructor() {
    this.items = [];
  }

  add(x, y, z, sx, sy, sz, color, rotY = 0) {
    this.items.push({ x, y, z, sx, sy, sz, color, rotY });
    return this.items.length - 1;
  }

  build({ castShadow = true, receiveShadow = true, material } = {}) {
    const mat = material || new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(UNIT_BOX, mat, Math.max(1, this.items.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    this.items.forEach((it, i) => {
      e.set(0, it.rotY, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(it.color));
    });
    mesh.count = this.items.length;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }
}

/** Deterministic value noise so the island looks the same on every visit. */
export function hash2(x, y, seed = 1) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, seed = 1, oct = 3) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Make a small canvas texture with crisp pixels. */
export function canvasTexture(w, h, draw, { pixel = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
  }
  tex.anisotropy = 4;
  return { tex, canvas: cv, ctx };
}

export function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}

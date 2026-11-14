import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const tick = () => new Promise(r => setTimeout(r, 0));
async function status(msg, p) { $('status').textContent = msg; $('bar').firstElementChild.style.width = (p * 100) + '%'; await tick(); }

// ---------------------------------------------------------------- noise
let seed = 20261110;
const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const PERM = new Uint16Array(512), GX = new Float32Array(256), GY = new Float32Array(256);
{ const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = rng() * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); } }
function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const aa = PERM[PERM[xi] + yi], ba = PERM[PERM[xi + 1] + yi], ab = PERM[PERM[xi] + yi + 1], bb = PERM[PERM[xi + 1] + yi + 1];
  const a = GX[aa] * xf + GY[aa] * yf, b = GX[ba] * (xf - 1) + GY[ba] * yf, c = GX[ab] * xf + GY[ab] * (yf - 1), d = GX[bb] * (xf - 1) + GY[bb] * (yf - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
}
function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise2(x * f + i * 17.13, y * f - i * 9.71); f *= 2.03; a *= 0.5; } return s; }
function ridged(x, y, o) { let s = 0, a = 0.5, f = 1, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(noise2(x * f + i * 3.7, y * f + i * 1.3)); n *= n * w; w = Math.min(1, Math.max(0, n * 2)); s += n * a; f *= 2.1; a *= 0.5; } return s; }
// tileable noise for textures (period p <= 256)
function tn(x, y, p) {
  const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
  const x0 = ((X % p) + p) % p, x1 = (x0 + 1) % p, y0 = ((Y % p) + p) % p, y1 = (y0 + 1) % p;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const g = (i, j, dx, dy) => { const h = PERM[PERM[i] + j]; return GX[h] * dx + GY[h] * dy; };
  const a = g(x0, y0, xf, yf), b = g(x1, y0, xf - 1, yf), c = g(x0, y1, xf, yf - 1), d = g(x1, y1, xf - 1, yf - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
}
function tfbm(u, v, base, o) { let s = 0, a = 0.5, p = base; for (let i = 0; i < o; i++) { s += a * tn(u * p + i * 31, v * p + i * 17, p); p *= 2; a *= 0.5; } return s; }
function hash2(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function tvor(u, v, k) { // tileable voronoi: returns [F1, F2, cellId]
  const x = u * k, y = v * k, X = Math.floor(x), Y = Math.floor(y); let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, wx = ((cx % k) + k) % k, wy = ((cy % k) + k) % k;
    const px = cx + 0.15 + 0.7 * hash2(wx, wy), py = cy + 0.15 + 0.7 * hash2(wx + 91, wy + 37);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(wx * 7 + 1, wy * 13 + 5); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- world shape
const WORLD = 1400, HALF = WORLD / 2, N = 1024, CELL = WORLD / N;
const TOWN = { x: 0, z: 0, r: 118 };
const POND = { x: 215, z: -48 };
function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 12 + fbm(x * 0.0032, z * 0.0032, 5) * 26 + fbm(x * 0.012, z * 0.012, 3) * 3;
  const mw = sstep(300, 520, r);
  if (mw > 0) h += mw * (ridged(x * 0.0035 + 5, z * 0.0035, 6) * 150 + 12) * (1 + 0.45 * sstep(-120, -420, x));
  const dt = Math.hypot(x - TOWN.x, z - TOWN.z);
  h = lerp(h, 14 + fbm(x * 0.015, z * 0.015, 2) * 0.9, 1 - sstep(130, 190, dt));
  // pond basin: flatten the surroundings, then carve a bowl with an irregular rim
  const dpx = x - POND.x, dpz = z - POND.z, dpr = Math.hypot(dpx, dpz);
  const rim = dpr * (1 + 0.22 * noise2(dpx * 0.06 + 3, dpz * 0.06));
  h = lerp(h, 2.4 + fbm(x * 0.05, z * 0.05, 2) * 0.5, 1 - sstep(45, 120, dpr));
  h -= 6.6 * (1 - sstep(7, 25, rim));
  return h;
}
const H = new Float32Array(N * N);
const gx = (i) => -HALF + (i + 0.5) * CELL;
function heightAt(x, z) {
  let fx = (x + HALF) / CELL - 0.5, fz = (z + HALF) / CELL - 0.5;
  fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * N + i;
  return lerp(lerp(H[k], H[k + 1], tx), lerp(H[k + N], H[k + N + 1], tx), tz);
}
function slopeAt(x, z) { const e = 1.5; const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e); return 1 - 1 / Math.sqrt(1 + (dx * dx + dz * dz) / (4 * e * e)); }

// paths
const paths = [
  { hw: 2.2, town: false, pts: [[-124, 0], [-160, 6], [-210, -10], [-262, 14], [-322, 30], [-390, 18], [-440, -10]] },
  { hw: 2.4, town: false, pts: [[124, 0], [165, -8], [192, -30], [POND.x - 30, POND.z + 4]] },
  { hw: 1.6, town: false, pts: [[POND.x - 30, POND.z + 4], [POND.x - 14, POND.z + 40], [POND.x + 20, POND.z + 60], [POND.x + 60, POND.z + 30]] },
  { hw: 3.6, town: true, pts: [[-124, 0], [-62, 0], [0, 0], [62, 0], [124, 0]] },
  { hw: 3.0, town: true, pts: [[0, 0], [0, -34], [0, -68]] },
  { hw: 2.6, town: true, pts: [[0, 0], [0, 50], [0, 100]] },
];
function segDist(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az; const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)); return Math.hypot(px - ax - vx * t, pz - az - vz * t); }
function pathMask(x, z) {
  let m = 0; const wob = noise2(x * 0.15, z * 0.15) * 0.6;
  for (const p of paths) for (let i = 0; i < p.pts.length - 1; i++) {
    const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
    const d = segDist(x, z, ax, az, bx, bz);
    if (d < p.hw + 2) m = Math.max(m, 1 - sstep(p.hw - 0.7, p.hw + 0.9, d + wob));
  }
  if (Math.hypot(x, z) < 26 + wob * 2) m = 1;
  return m;
}

// ---------------------------------------------------------------- textures
const maxAniso = () => renderer.capabilities.getMaxAnisotropy();
function dataTex(data, size, srgb, repeat = true) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = maxAniso(); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
// fn(u,v) -> [r,g,b,height] (sRGB 0..1)
function makeMaps(size, fn, nStrength = 2) {
  const col = new Uint8Array(size * size * 4), hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = fn(x / size, y / size), k = y * size + x;
    col[k * 4] = clamp(r[0]) * 255; col[k * 4 + 1] = clamp(r[1]) * 255; col[k * 4 + 2] = clamp(r[2]) * 255; col[k * 4 + 3] = 255; hgt[k] = r[3] ?? 0;
  }
  const nrm = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const L = hgt[y * size + (x - 1 + size) % size], R = hgt[y * size + (x + 1) % size], D = hgt[((y - 1 + size) % size) * size + x], U = hgt[((y + 1) % size) * size + x];
    let nx = (L - R) * nStrength, ny = (D - U) * nStrength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * size + x) * 4; nrm[k] = (nx * 0.5 + 0.5) * 255; nrm[k + 1] = (ny * 0.5 + 0.5) * 255; nrm[k + 2] = (nz * 0.5 + 0.5) * 255; nrm[k + 3] = 255;
  }
  return { map: dataTex(col, size, true), normal: dataTex(nrm, size, false) };
}
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

const TEX = {};
function buildTextures() {
  TEX.grass = makeMaps(512, (u, v) => {
    const n = tfbm(u, v, 8, 5), n2 = tfbm(u, v, 64, 2), sp = hash2(u * 512 | 0, v * 512 | 0);
    let c = mix3([0.19, 0.30, 0.07], [0.36, 0.43, 0.13], n * 0.6 + 0.5);
    c = mul3(c, 0.82 + 0.28 * n2 + (sp > 0.93 ? 0.18 : 0));
    return [...c, n * 0.5 + n2 * 0.3];
  });
  TEX.dirt = makeMaps(512, (u, v) => {
    const n = tfbm(u, v, 6, 5), [f1, f2, id] = tvor(u, v, 40), peb = sstep(0.06, 0.0, f2 - f1) ? 0 : 1;
    const stone = f1 < 0.22 && id > 0.82 ? 1 : 0;
    let c = mix3([0.40, 0.31, 0.21], [0.56, 0.45, 0.32], n * 0.6 + 0.5);
    if (stone) c = mix3(c, [0.48, 0.45, 0.40], 0.7 * peb);
    return [...c, n * 0.4 + stone * (0.3 - f1)];
  }, 3);
  TEX.rock = makeMaps(512, (u, v) => {
    const n = tfbm(u, v, 4, 6), r = 1 - Math.abs(tfbm(u + 0.3, v * 1.0, 6, 4)), cr = sstep(0.93, 0.99, r);
    const lich = sstep(0.15, 0.45, tfbm(u, v, 5, 3));
    let c = mix3([0.30, 0.29, 0.27], [0.55, 0.53, 0.49], n * 0.7 + 0.5);
    c = mix3(c, [0.36, 0.40, 0.22], lich * 0.45); c = mul3(c, 1 - cr * 0.55);
    return [...c, n * 1.2 - cr * 0.4];
  }, 4);
  TEX.sand = makeMaps(512, (u, v) => {
    const n = tfbm(u, v, 4, 4), g = hash2(u * 512 | 0, v * 512 | 0), rip = Math.sin((v + tfbm(u, v, 2, 2) * 0.15) * Math.PI * 2 * 18);
    const c = mul3(mix3([0.86, 0.70, 0.50], [0.97, 0.84, 0.64], n * 0.6 + 0.5), 0.9 + 0.2 * g);
    return [...c, rip * 0.04 + g * 0.06 + n * 0.2];
  }, 3);
  TEX.cobble = makeMaps(512, (u, v) => {
    const [f1, f2, id] = tvor(u, v, 12), e = f2 - f1, n = tfbm(u, v, 16, 3);
    const stone = sstep(0.03, 0.12, e);
    let c = mix3([0.33, 0.31, 0.29], [0.56, 0.52, 0.47], id); c = mul3(c, 0.85 + 0.2 * n);
    c = mix3([0.16, 0.14, 0.12], c, stone);
    return [...c, stone * (0.5 + 0.5 * Math.sqrt(clamp(e * 3))) + n * 0.05];
  }, 4);
  TEX.wall = makeMaps(512, (u, v) => { // 2m tile, 8 courses
    const rows = 8, ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const off = hash2(row, 3) * 0.5, cols = 4 + (hash2(row, 7) * 2 | 0), rx = (u * cols + off * cols) % cols, col = Math.floor(rx), fx = rx - col;
    const id = hash2(row * 31 + col, 11), n = tfbm(u, v, 8, 4);
    const mort = Math.min(sstep(0.0, 0.07, fy), sstep(1.0, 0.93, fy), sstep(0.0, 0.04 * cols / 5, fx), sstep(1.0, 1 - 0.04 * cols / 5, fx));
    let c = mul3(mix3([0.42, 0.39, 0.34], [0.62, 0.57, 0.49], id), 0.85 + 0.25 * n);
    c = mix3([0.30, 0.28, 0.25], c, mort);
    return [...c, mort * (0.6 + 0.2 * n)];
  }, 5);
  TEX.timber = makeMaps(512, (u, v) => { // tile = 3m x one floor
    const n = tfbm(u, v, 6, 5), grain = tfbm(u * 0.2, v * 3, 8, 3);
    let plaster = mul3([0.86, 0.82, 0.73], 0.9 + 0.12 * n - 0.1 * sstep(0.2, 0.5, tfbm(u, v, 3, 3)) * (1 - v));
    const bw = 0.035, beam = (d) => d < bw;
    const du = Math.min(u, Math.abs(u - 0.5), 1 - u), dv = Math.min(v, 1 - v);
    const dmid = Math.abs(v - 0.42);
    let b = beam(du * 0.66) || dv < 0.04 || dmid < 0.022;
    const lu = (u % 0.5) * 2, diag = Math.abs((lu - v) / 1.41), diag2 = Math.abs(((1 - lu) - v) / 1.41);
    if (v > 0.44 && (u < 0.5 ? diag : diag2) < 0.025) b = true;
    if (b) { const c = mul3([0.24, 0.16, 0.10], 0.8 + 0.4 * grain); return [...c, 0.6 + grain * 0.1]; }
    return [...plaster, n * 0.1];
  }, 6);
  TEX.roof = makeMaps(512, (u, v) => { // tile = 2m, 6 rows, 8 cols
    const rows = 6, ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const off = (row % 2) * 0.5, cols = 8, rx = u * cols + off, col = Math.floor(rx), fx = rx - col;
    const id = hash2(row * 17 + ((col % cols) + cols) % cols, 5), n = tfbm(u, v, 8, 3);
    const curve = Math.sin(fx * Math.PI), lap = sstep(0.0, 0.2, fy);
    let c = mul3(mix3([0.72, 0.70, 0.68], [0.95, 0.93, 0.9], id), (0.6 + 0.4 * curve) * (0.55 + 0.45 * lap) * (0.9 + 0.15 * n));
    const moss = sstep(0.25, 0.55, tfbm(u, v, 4, 3)) * 0.5; c = mix3(c, [0.45, 0.5, 0.3], moss * (1 - lap * 0.5));
    return [...c, curve * 0.4 + fy * 0.5];
  }, 4);
  TEX.wood = makeMaps(512, (u, v) => { // planks along u
    const boards = 6, by = v * boards, b = Math.floor(by), fy = by - b;
    const id = hash2(b, 9), g = tfbm(u * 0.5 + id, v * 6, 4, 4);
    const seam = Math.min(sstep(0, 0.06, fy), sstep(1, 0.94, fy));
    const c = mul3(mix3([0.30, 0.21, 0.13], [0.48, 0.36, 0.24], id), (0.75 + 0.35 * (g * 0.5 + 0.5)) * (0.5 + 0.5 * seam));
    return [...c, seam * 0.5 + g * 0.1];
  }, 4);
  TEX.bark = makeMaps(256, (u, v) => {
    const r = Math.abs(tfbm(u * 1, v * 0.25, 8, 4)), n = tfbm(u, v, 16, 3);
    const c = mul3(mix3([0.17, 0.13, 0.10], [0.36, 0.31, 0.26], sstep(0.0, 0.4, r)), 0.85 + 0.2 * n);
    return [...c, r * 1.2];
  }, 5);
  // window: leaded diamonds, wood frame. map + emissive
  { const S = 128, c = new Uint8Array(S * S * 4), e = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, k = (y * S + x) * 4;
      const frame = u < 0.09 || u > 0.91 || v < 0.07 || v > 0.93 || Math.abs(u - 0.5) < 0.03 || Math.abs(v - 0.55) < 0.03;
      const d1 = Math.abs(((u * 6 + v * 4) % 1) - 0.5), d2 = Math.abs(((u * 6 - v * 4 + 10) % 1) - 0.5), lead = d1 > 0.46 || d2 > 0.46;
      let r, g, b, er = 0, eg = 0, eb = 0;
      if (frame) { r = 0.22; g = 0.15; b = 0.09; }
      else if (lead) { r = g = b = 0.08; }
      else { const n = hash2(x >> 3, y >> 3); r = 0.12 + n * 0.05; g = 0.16 + n * 0.05; b = 0.2 + n * 0.06; er = 1; eg = 0.62 + n * 0.1; eb = 0.25; }
      c[k] = r * 255; c[k + 1] = g * 255; c[k + 2] = b * 255; c[k + 3] = 255; e[k] = er * 255; e[k + 1] = eg * 255; e[k + 2] = eb * 255; e[k + 3] = 255;
    }
    TEX.window = dataTex(c, S, true); TEX.windowE = dataTex(e, S, true); }
  // low-frequency patch noise (shared by terrain + grass so their colours agree)
  { const S = 256, d = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const n = tfbm(x / S, y / S, 4, 4) * 0.8 + 0.5, k = (y * S + x) * 4; d[k] = d[k + 1] = d[k + 2] = clamp(n) * 255; d[k + 3] = 255; }
    TEX.patch = dataTex(d, S, false); }
  // water normals
  { const S = 256, h = new Float32Array(S * S), d = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = tfbm(x / S, y / S, 8, 5);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const L = h[y * S + (x - 1 + S) % S], R = h[y * S + (x + 1) % S], D = h[((y - 1 + S) % S) * S + x], U = h[((y + 1) % S) * S + x];
      let nx = (L - R) * 6, ny = (D - U) * 6, nz = 1; const l = Math.hypot(nx, ny, nz); const k = (y * S + x) * 4;
      d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (nz / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    TEX.water = dataTex(d, S, false); }
  // leaf cards (canvas)
  TEX.leaf = canvasTex(512, (g, S) => {
    for (let i = 0; i < 46; i++) {
      const a = rng() * Math.PI * 2, r = S * (0.08 + 0.33 * Math.sqrt(rng()));
      const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
      g.strokeStyle = 'rgba(60,45,25,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(x, y); g.stroke();
      for (let k = 0; k < 4; k++) {
        const lx = x + (rng() - 0.5) * 40, ly = y + (rng() - 0.5) * 40, ang = rng() * Math.PI * 2, L = 22 + rng() * 16;
        const h = 85 + rng() * 30, s = 40 + rng() * 25, l = 20 + rng() * 22;
        g.save(); g.translate(lx, ly); g.rotate(ang);
        g.fillStyle = `hsl(${h},${s}%,${l}%)`; g.beginPath(); g.ellipse(0, 0, L, L * 0.42, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = `hsla(${h},${s}%,${l + 14}%,0.6)`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
        g.restore();
      }
    }
  });
  TEX.needle = canvasTex(512, (g, S) => {
    for (let b = 0; b < 3; b++) {
      const y0 = S * (0.25 + b * 0.25);
      g.strokeStyle = '#3b2a1a'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, S / 2); g.quadraticCurveTo(S * 0.5, y0, S, y0 + (rng() - 0.5) * 40); g.stroke();
      for (let i = 0; i < 260; i++) {
        const t = rng(), x = t * S, y = lerp(S / 2, y0, Math.sin(t * Math.PI / 2)) + (rng() - 0.5) * 8;
        const len = (1 - t * 0.6) * (34 + rng() * 28), ang = (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.7) + 0.35;
        g.strokeStyle = `hsl(${105 + rng() * 25},${35 + rng() * 20}%,${14 + rng() * 16}%)`; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
      }
    }
  });
  TEX.cloth = canvasTex(64, (g, S) => { g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < S; i += 8) g.fillRect(i, 0, 4, S); }, true);
  TEX.spark = canvasTex(64, (g, S) => { const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); });
}
function canvasTex(S, draw, opaque) {
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); draw(g, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso();
  if (opaque) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t;
}

// ---------------------------------------------------------------- renderer / scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 9000);
camera.layers.enable(1);
scene.fog = new THREE.FogExp2(0xb8c8d8, 0.0011);
const U = { time: { value: 0 } };

const QUALITY = {
  low:    { pr: 1.0,  shadow: 2048, grass: 90000,  R: 38, msaa: 0, refl: 256,  dist: 0.0009,  ao: false, aoSamples: 0,  rays: 0 },
  medium: { pr: 1.25, shadow: 2048, grass: 220000, R: 52, msaa: 4, refl: 512,  dist: 0.0007,  ao: false, aoSamples: 0,  rays: 20 },
  high:   { pr: 1.5,  shadow: 4096, grass: 400000, R: 64, msaa: 4, refl: 512,  dist: 0.00065, ao: true,  aoSamples: 12, rays: 32 },
  ultra:  { pr: 2.0,  shadow: 4096, grass: 700000, R: 82, msaa: 4, refl: 512,  dist: 0.0006,  ao: true,  aoSamples: 16, rays: 48 },
};
let Q = QUALITY.high;

// ---------------------------------------------------------------- shader helpers
const SHARP_ALPHA = `
#ifdef USE_ALPHATEST
  diffuseColor.a = (diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 0.0001) + 0.5;
  if (diffuseColor.a < 0.5) discard;
#endif`;
const NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
const GLSL_NOISE = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float caustic(vec2 p, float t){ float c=0.; for(int i=0;i<2;i++){ vec2 q=p*(1.0+float(i)*0.7)+vec2(t*0.3,-t*0.23)*(1.0+float(i));
  float n=abs(vnoise(q)-0.5)+abs(vnoise(q*1.7+3.1)-0.5); c+=pow(1.0-clamp(n*1.6,0.,1.),6.0);} return c; }`;

// ---------------------------------------------------------------- terrain
let heightTex, maskTex, mask;
function buildHeights() {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = rawHeight(gx(i), gx(j));
  const hf = new Uint16Array(N * N); for (let k = 0; k < N * N; k++) hf[k] = THREE.DataUtils.toHalfFloat(H[k]);
  heightTex = new THREE.DataTexture(hf, N, N, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter; heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping; heightTex.needsUpdate = true;
}
// mask: R grass density, G ambient occlusion, B path, A sand
function buildMaskBase() {
  mask = new Float32Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = gx(i), z = gx(j), h = H[j * N + i], k = (j * N + i) * 4;
    const sl = slopeAt(x, z), dt = Math.hypot(x, z);
    const pm = pathMask(x, z);
    let sand = sstep(1.7, 0.5, h) * (Math.hypot(x - POND.x, z - POND.z) < 60 ? 1 : 0);
    let g = (1 - sstep(0.22, 0.4, sl)) * (1 - sand) * (1 - pm) * sstep(0.8, 2.0, h) * (1 - sstep(70, 105, h));
    g *= clamp(0.75 + fbm(x * 0.02 + 9, z * 0.02, 3) * 0.9);
    if (dt < TOWN.r) g *= 0.6;
    mask[k] = g; mask[k + 1] = 1; mask[k + 2] = pm; mask[k + 3] = sand;
  }
}
function stamp(x, z, rad, fn) {
  const i0 = Math.max(0, Math.floor((x - rad + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((x + rad + HALF) / CELL));
  const j0 = Math.max(0, Math.floor((z - rad + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((z + rad + HALF) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(gx(i) - x, gx(j) - z); if (d < rad) fn((j * N + i) * 4, d / rad); }
}
function finalizeMask() {
  const d = new Uint8Array(N * N * 4); for (let k = 0; k < N * N * 4; k++) d[k] = clamp(mask[k]) * 255;
  maskTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); maskTex.magFilter = THREE.LinearFilter; maskTex.minFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
}
function buildTerrain() {
  const CH = 16, SEG = (N / CH); // 64 cells per chunk
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const tu = { tGrass: { value: TEX.grass.map }, tDirt: { value: TEX.dirt.map }, tRock: { value: TEX.rock.map }, tSand: { value: TEX.sand.map }, tCobble: { value: TEX.cobble.map },
    tRockN: { value: TEX.rock.normal }, tSandN: { value: TEX.sand.normal }, tCobN: { value: TEX.cobble.normal }, uMask: { value: maskTex }, uPatch: { value: TEX.patch }, uWorld: { value: WORLD }, uTime: U.time };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, tu);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix)*objectNormal);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP; varying vec3 vWN; uniform sampler2D tGrass,tDirt,tRock,tSand,tCobble,tRockN,tSandN,tCobN,uMask,uPatch; uniform float uWorld; uniform float uTime;
      ${GLSL_NOISE}
      vec3 tri(sampler2D t, vec3 p, vec3 n, float sc){ vec3 w=pow(abs(n),vec3(4.)); w/=(w.x+w.y+w.z);
        return texture2D(t,p.zy*sc).rgb*w.x + texture2D(t,p.xz*sc).rgb*w.y + texture2D(t,p.xy*sc).rgb*w.z; }
      float tRough; float gRw; float gInTown; vec4 gM;`)
      .replace('#include <map_fragment>', `
      vec3 wn0 = normalize(vWN); vec2 wuv = vWP.xz;
      vec4 m = texture2D(uMask, (vWP.xz + uWorld*0.5)/uWorld); gM = m;
      float pn = texture2D(uPatch, vWP.xz*0.01).r;
      float slope = 1.0 - wn0.y;
      vec3 cG = mix(texture2D(tGrass, wuv*0.31).rgb, texture2D(tGrass, wuv*0.067).rgb, 0.45);
      cG *= mix(vec3(1.0), vec3(1.28,1.1,0.62), smoothstep(0.55,0.85,pn));
      vec3 cD = mix(texture2D(tDirt, wuv*0.27).rgb, texture2D(tDirt, wuv*0.057).rgb, 0.4);
      vec3 cR = mix(tri(tRock, vWP, wn0, 0.09), tri(tRock, vWP, wn0, 0.021), 0.45);
      vec3 cS = mix(texture2D(tSand, wuv*0.21).rgb, texture2D(tSand, wuv*0.05).rgb, 0.35);
      vec3 cC = texture2D(tCobble, wuv*0.5).rgb*1.15;
      vec3 col = mix(cD, cG, smoothstep(0.02, 0.45, m.r + 0.25*(pn-0.5) + 0.2));
      col = mix(col, cD*vec3(0.95,0.8,0.6), (1.0 - m.g)*0.6);
      gInTown = 1.0 - smoothstep(116.0, 126.0, length(vWP.xz));
      col = mix(col, mix(cD*0.9, cC, gInTown), m.b);
      col = mix(col, cS, m.a);
      float wet = (1.0 - smoothstep(0.2, 0.9, vWP.y)) * m.a;
      col *= mix(1.0, 0.7, wet);
      gRw = smoothstep(0.32, 0.5, slope + (pn-0.5)*0.18) * (1.0 - m.b);
      col = mix(col, cR, gRw);
      float snow = smoothstep(118.0, 135.0, vWP.y + pn*25.0) * (1.0 - smoothstep(0.5,0.7,slope));
      col = mix(col, vec3(0.9,0.92,0.96), snow);
      if (vWP.y < 0.2) { float dd = max(-vWP.y, 0.0);
        col *= mix(vec3(1.0), vec3(0.55,0.8,0.82), smoothstep(0.0, 5.0, dd));
        col += vec3(0.9,1.0,0.95) * caustic(vWP.xz*0.35, uTime) * 0.18 * exp(-dd*0.18) * smoothstep(0.0,0.4,dd); }
      diffuseColor.rgb *= col * 1.35;
      tRough = mix(0.96, 0.35, wet); tRough = mix(tRough, 0.82, gRw); tRough = mix(tRough, 0.55, snow);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `
      vec3 nd = (texture2D(tRockN, vWP.xz*0.09).xyz*2.-1.)*gRw*1.2 + (texture2D(tCobN, vWP.xz*0.5).xyz*2.-1.)*gM.b*gInTown*1.4 + (texture2D(tSandN, vWP.xz*0.21).xyz*2.-1.)*gM.a*(1.0-gRw)*0.6;
      vec3 wnp = normalize(normalize(vWN) + vec3(nd.x, 0.0, nd.y));
      normal = normalize((viewMatrix*vec4(wnp,0.0)).xyz);`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= mix(0.6,1.0,gM.g);');
  };
  const group = new THREE.Group();
  for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CH; ci++) {
    const vx = SEG + 1, pos = new Float32Array(vx * vx * 3), nor = new Float32Array(vx * vx * 3), idx = [];
    for (let j = 0; j < vx; j++) for (let i = 0; i < vx; i++) {
      const I = Math.min(N - 1, ci * SEG + i), J = Math.min(N - 1, cj * SEG + j), k = (j * vx + i) * 3;
      pos[k] = gx(I); pos[k + 1] = H[J * N + I]; pos[k + 2] = gx(J);
      const L = H[J * N + Math.max(0, I - 1)], R = H[J * N + Math.min(N - 1, I + 1)], D = H[Math.max(0, J - 1) * N + I], Uu = H[Math.min(N - 1, J + 1) * N + I];
      let nx = L - R, ny = 2 * CELL, nz = D - Uu; const l = Math.hypot(nx, ny, nz); nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
    }
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) { const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = false; group.add(m);
  }
  scene.add(group);
}

// ---------------------------------------------------------------- grass
let grass;
function buildGrass() {
  const SEGS = 4, pos = [], idx = [];
  for (let i = 0; i <= SEGS; i++) { const y = i / SEGS; if (i < SEGS) { pos.push(-0.5, y, 0, 0.5, y, 0); } else pos.push(0, 1, 0); }
  for (let i = 0; i < SEGS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push((SEGS - 1) * 2, (SEGS - 1) * 2 + 1, SEGS * 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0, side: THREE.DoubleSide });
  const gu = { uHeight: { value: heightTex }, uMask: { value: maskTex }, uPatch: { value: TEX.patch }, uCam: { value: new THREE.Vector3() }, uR: { value: Q.R }, uWorld: { value: WORLD }, uPlayer: { value: new THREE.Vector3() }, uTime: U.time, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() } };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, gu);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aOff; uniform sampler2D uHeight, uMask, uPatch; uniform vec3 uCam, uPlayer; uniform float uR, uWorld, uTime; varying vec3 vGCol; varying float vGY; varying vec3 vGW;`)
      .replace('#include <beginnormal_vertex>', `
      vec2 wp = uCam.xz + mod(aOff.xy - uCam.xz + uR, 2.0*uR) - uR;
      vec2 tuv = (wp + uWorld*0.5)/uWorld;
      float th = texture2D(uHeight, tuv).r; vec4 msk = texture2D(uMask, tuv);
      float pn = texture2D(uPatch, wp*0.01).r;
      float dd = length(wp - uCam.xz);
      float keep = step(aOff.z, msk.r * 1.15) * (1.0 - smoothstep(uR*0.6, uR, dd));
      float hgt = (0.32 + 0.6*aOff.w) * (0.55 + 0.9*pn) * keep * mix(0.6, 1.0, msk.r);
      float ang = aOff.z*97.0 + aOff.w*13.0; float ca = cos(ang), sa = sin(ang);
      float y = position.y;
      vec2 side = vec2(ca, sa);
      float wind = sin(uTime*1.7 + wp.x*0.11 + wp.y*0.06)*0.55 + sin(uTime*3.1 + wp.x*0.37 - wp.y*0.29)*0.2 + (texture2D(uPatch, wp*0.004 + vec2(uTime*0.012, 0.0)).r - 0.5)*1.4;
      vec2 toP = wp - uPlayer.xz; float pd = max(length(toP), 0.001);
      float tr = 1.0 - smoothstep(0.25, 1.3, pd);
      vec2 lean = vec2(0.85, 0.35)*(0.18 + wind*0.42) + vec2(-sa, ca)*(aOff.w-0.5)*0.6 + (toP/pd)*tr*1.6;
      float bend = y*y;
      vec3 gPos = vec3(wp.x, th, wp.y);
      gPos.xz += side * position.x * 0.085 * (1.0 - y*0.8) * (hgt > 0.0 ? 1.0 : 0.0) + lean * bend * hgt;
      gPos.y += y * hgt * (1.0 - 0.25*length(lean)*y);
      vec3 bladeN = normalize(vec3(-sa, 0.0, ca) + vec3(ca,0.0,sa)*position.x*0.9);
      vec3 objectNormal = normalize(mix(bladeN, vec3(0.0,1.0,0.0), 0.55));
      vec3 base = mix(vec3(0.045,0.10,0.015), vec3(0.11,0.17,0.03), pn);
      vec3 tip = mix(vec3(0.19,0.27,0.06), vec3(0.40,0.36,0.12), smoothstep(0.55,0.85,pn) + aOff.w*0.15);
      vGCol = mix(base, tip, y) * mix(0.35, 1.0, msk.g) * (0.5 + 0.5*y);
      vGY = y; vGW = gPos;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGCol; varying float vGY; varying vec3 vGW; uniform vec3 uSun; uniform vec3 uSunCol;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vGCol * 2.3;')
      .replace('#include <normal_fragment_begin>', NO_FLIP)
      .replace('#include <emissivemap_fragment>', `
      vec3 vd = normalize(vGW - cameraPosition);
      totalEmissiveRadiance += vGCol * uSunCol * pow(max(dot(vd, uSun), 0.0), 3.0) * vGY * 0.9;`);
  };
  grass = new THREE.Mesh(geo, mat); grass.frustumCulled = false; grass.receiveShadow = true; grass.layers.set(1);
  grass.userData.u = gu; scene.add(grass); setGrassCount();
}
function setGrassCount() {
  const n = Q.grass, R = Q.R, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = (Math.random() * 2 - 1) * R; a[i * 4 + 1] = (Math.random() * 2 - 1) * R; a[i * 4 + 2] = Math.random(); a[i * 4 + 3] = Math.random(); }
  grass.geometry.setAttribute('aOff', new THREE.InstancedBufferAttribute(a, 4)); grass.geometry.instanceCount = n; grass.userData.u.uR.value = R;
}

// ---------------------------------------------------------------- foliage
const colliders = new Map(); // grid hash of circles
const CG = 10;
function addCollider(x, z, r) { const k = Math.floor(x / CG) + ',' + Math.floor(z / CG); if (!colliders.has(k)) colliders.set(k, []); colliders.get(k).push([x, z, r]); }

function cardsGeo(cards) { // cards: [{c:[x,y,z], a:[..], b:[..], n:[..], shade0, shade1}]
  const pos = [], nor = [], uv = [], col = [], idx = [];
  cards.forEach((q, i) => {
    const { c, a, b, n } = q, s0 = q.s0, s1 = q.s1;
    const P = q.quad ? q.quad.slice() : [[c[0] - a[0] - b[0], c[1] - a[1] - b[1], c[2] - a[2] - b[2]], [c[0] + a[0] - b[0], c[1] + a[1] - b[1], c[2] + a[2] - b[2]], [c[0] + a[0] + b[0], c[1] + a[1] + b[1], c[2] + a[2] + b[2]], [c[0] - a[0] + b[0], c[1] - a[1] + b[1], c[2] - a[2] + b[2]]];
    const UV = [[0, 0], [1, 0], [1, 1], [0, 1]], S = q.shade || [s0, s0, s1, s1];
    for (let k = 0; k < 4; k++) { pos.push(...P[k]); nor.push(...(q.ns ? q.ns[k] : n)); uv.push(...UV[k]); col.push(S[k], S[k], S[k]); }
    const o = i * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); return g;
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function randUnit() { const u = rng() * 2 - 1, t = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u); return v3(s * Math.cos(t), u, s * Math.sin(t)); }
function oakLeaves() {
  const cards = [], C = v3(0, 6.6, 0), R = v3(3.3, 2.7, 3.3);
  for (let i = 0; i < 150; i++) {
    const d = randUnit(), r = 0.55 + 0.45 * Math.sqrt(rng());
    const p = v3(d.x * R.x * r, d.y * R.y * r, d.z * R.z * r).add(C);
    const ax = randUnit(), bx = randUnit().cross(ax).normalize(), az = ax.clone().cross(bx).normalize();
    const s = 0.62 + rng() * 0.35; bx.multiplyScalar(s); az.multiplyScalar(s);
    const n = p.clone().sub(C).normalize().lerp(v3(0, 1, 0), 0.25).normalize();
    const sh = (0.45 + 0.55 * r) * (0.75 + 0.25 * clamp(d.y * 0.5 + 0.5));
    cards.push({ c: p.toArray(), a: bx.toArray(), b: az.toArray(), n: n.toArray(), s0: sh, s1: sh });
  }
  return cardsGeo(cards);
}
function pineLeaves() {
  const cards = [];
  for (let t = 0; t < 15; t++) {
    const y = 2.6 + t * 0.8, R = 3.3 * Math.pow(1 - (y - 2.6) / 12.6, 0.9) + 0.35, n = Math.round(5 + R * 1.6);
    for (let k = 0; k < n; k++) {
      const ang = k / n * Math.PI * 2 + t * 0.7 + rng() * 0.4, dir = v3(Math.cos(ang), 0, Math.sin(ang));
      const base = v3(0, y, 0), tip = v3(dir.x * R, y - R * 0.38, dir.z * R);
      const tilt = (rng() - 0.5) * 1.2, side = v3(-dir.z, 0, dir.x).multiplyScalar(Math.cos(tilt)).add(v3(0, Math.sin(tilt), 0));
      const w = 0.55 + R * 0.22;
      const p0 = base.clone().addScaledVector(side, -w * 0.35), p1 = tip.clone().addScaledVector(side, -w), p2 = tip.clone().addScaledVector(side, w), p3 = base.clone().addScaledVector(side, w * 0.35);
      const nrm = dir.clone().add(v3(0, 0.9, 0)).normalize().toArray();
      // uv: u along branch -> map card so twig runs along u
      cards.push({ quad: [p0.toArray(), p1.toArray(), p2.toArray(), p3.toArray()], n: nrm, shade: [0.4, 1.0, 1.0, 0.4] });
    }
  }
  for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI, d = v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.55);
    cards.push({ quad: [[-d.x, 13.4, -d.z], [-d.x, 15.6, -d.z], [d.x, 15.6, d.z], [d.x, 13.4, d.z]], n: [0, 1, 0], shade: [0.7, 1, 1, 0.7] }); }
  const g = cardsGeo(cards);
  // remap uv so u runs base->tip
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i += 4) { uv.setXY(i, 0, 0.2); uv.setXY(i + 1, 1, 0); uv.setXY(i + 2, 1, 1); uv.setXY(i + 3, 0, 0.8); }
  return g;
}
function bushGeo() {
  const cards = [], C = v3(0, 0.55, 0);
  for (let i = 0; i < 26; i++) { const d = randUnit(); d.y = Math.abs(d.y) * 0.8; const p = d.clone().multiplyScalar(0.75 * (0.5 + 0.5 * rng())).add(C);
    const ax = randUnit().multiplyScalar(0.55), bx = randUnit().cross(ax).normalize().multiplyScalar(0.55); const sh = 0.4 + 0.6 * clamp(d.y + 0.3);
    cards.push({ c: p.toArray(), a: ax.toArray(), b: bx.toArray(), n: p.clone().sub(v3(0, 0, 0)).normalize().toArray(), s0: sh, s1: sh }); }
  return cardsGeo(cards);
}
function fernGeo() {
  const cards = [];
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2 + rng() * 0.3, d = v3(Math.cos(a), 0, Math.sin(a)), s = v3(-d.z, 0, d.x).multiplyScalar(0.18), L = 0.9 + rng() * 0.5;
    const m = v3(d.x * L * 0.55, 0.55, d.z * L * 0.55), t = v3(d.x * L, 0.25, d.z * L);
    cards.push({ quad: [s.clone().negate().toArray(), m.clone().sub(s).toArray(), m.clone().add(s).toArray(), s.toArray()], n: [0, 1, 0], shade: [0.35, 0.9, 0.9, 0.35] });
    cards.push({ quad: [m.clone().sub(s).toArray(), t.clone().sub(s.clone().multiplyScalar(0.4)).toArray(), t.clone().add(s.clone().multiplyScalar(0.4)).toArray(), m.clone().add(s).toArray()], n: [0, 1, 0], shade: [0.9, 1, 1, 0.9] }); }
  const g = cardsGeo(cards); const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i += 8) { uv.setXY(i, 0, 0.5); uv.setXY(i + 1, 0.55, 0.42); uv.setXY(i + 2, 0.55, 0.58); uv.setXY(i + 3, 0, 0.5);
    uv.setXY(i + 4, 0.55, 0.42); uv.setXY(i + 5, 1, 0.45); uv.setXY(i + 6, 1, 0.55); uv.setXY(i + 7, 0.55, 0.58); }
  return g;
}
function foliageMat(map, tint) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75, color: tint });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float ph = ip.x*0.13 + ip.z*0.17;
        float sw = smoothstep(1.0, 12.0, position.y);
        transformed.x += (sin(uTime*1.3 + ph) * 0.12 + sin(uTime*3.7 + position.y*1.7 + ph) * 0.04) * sw;
        transformed.z += (cos(uTime*1.1 + ph*1.3) * 0.10) * sw;`);
    s.fragmentShader = s.fragmentShader.replace('#include <alphatest_fragment>', SHARP_ALPHA).replace('#include <normal_fragment_begin>', NO_FLIP);
  };
  return m;
}
function chunked(geo, mat, list, opts = {}) { // list of Matrix4 with .x .z
  const cells = new Map(), C = 140;
  for (const it of list) { const k = Math.floor(it.x / C) + ',' + Math.floor(it.z / C); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(it.m); }
  for (const arr of cells.values()) {
    const im = new THREE.InstancedMesh(geo, mat, arr.length); arr.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = opts.cast ?? true; im.receiveShadow = true; if (opts.leaf) im.layers.set(1); im.computeBoundingSphere(); scene.add(im);
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function mtx(x, y, z, ry, sc, tilt = 0) { _e.set((rng() - 0.5) * tilt, ry, (rng() - 0.5) * tilt); _q.setFromEuler(_e); _s.set(sc, sc, sc); _p.set(x, y, z); return new THREE.Matrix4().compose(_p, _q, _s); }

const SPAWN_CLEAR = [[135, 2], [-268, 16], [14, 9], [POND.x - 34, POND.z + 8], [POND.x - 10, POND.z + 4]];
function buildFoliage() {
  const oak = [], pine = [], bush = [], fern = [];
  const forest = (x, z) => fbm(x * 0.006 + 40, z * 0.006, 4) + 0.25 * sstep(-120, -360, x) + 0.28 * sstep(280, 460, Math.hypot(x, z)) - 0.12;
  for (let z = -HALF + 4; z < HALF - 4; z += 5.2) for (let x = -HALF + 4; x < HALF - 4; x += 5.2) {
    const px = x + (rng() - 0.5) * 4.6, pz = z + (rng() - 0.5) * 4.6;
    const h = heightAt(px, pz); if (h < 1.6 || h > 125) continue;
    if (Math.hypot(px - POND.x, pz - POND.z) < 30) { if (rng() < 0.9) continue; }
    if (SPAWN_CLEAR.some(([cx, cz]) => Math.hypot(px - cx, pz - cz) < 9)) continue;
    const dt = Math.hypot(px, pz); if (dt < 145) continue;
    if (pathMask(px, pz) > 0.05) continue;
    const sl = slopeAt(px, pz); if (sl > 0.32) continue;
    const f = forest(px, pz), r = rng();
    const dens = f > 0.05 ? 0.55 : (f > -0.12 ? 0.08 : 0.012);
    if (r > dens) { if (f > 0.0 && rng() < 0.35) fern.push({ x: px, z: pz, m: mtx(px, h, pz, rng() * 6.28, 0.8 + rng() * 0.7) });
      else if (rng() < 0.05) bush.push({ x: px, z: pz, m: mtx(px, h - 0.1, pz, rng() * 6.28, 0.8 + rng() * 1.0) }); continue; }
    const pineP = sstep(10, 60, h) * 0.85 + (f > 0.25 ? 0.25 : 0);
    const sc = 0.75 + rng() * 0.55;
    if (rng() < pineP) { pine.push({ x: px, z: pz, m: mtx(px, h - 0.3, pz, rng() * 6.28, sc * 1.05, 0.06) }); addCollider(px, pz, 0.35 * sc); }
    else { oak.push({ x: px, z: pz, m: mtx(px, h - 0.3, pz, rng() * 6.28, sc, 0.1) }); addCollider(px, pz, 0.4 * sc); }
    stamp(px, pz, 5.5 * sc, (k, t) => { mask[k + 1] = Math.min(mask[k + 1], 0.35 + 0.65 * t * t); mask[k] *= 0.55 + 0.45 * t; });
  }
  // town gardens: a few bushes inside walls
  for (let i = 0; i < 160; i++) { const a = rng() * 6.28, r = 30 + rng() * 80, x = Math.cos(a) * r, z = Math.sin(a) * r; if (pathMask(x, z) > 0.01 || insideBuilding(x, z, 2)) continue; bush.push({ x, z, m: mtx(x, heightAt(x, z) - 0.1, z, rng() * 6.28, 0.7 + rng() * 0.6) }); }
  // trunks
  const oakT = mergeGeometries([new THREE.CylinderGeometry(0.2, 0.42, 6, 9, 3).translate(0, 3, 0),
    new THREE.CylinderGeometry(0.08, 0.16, 3.4, 6).translate(0, 1.7, 0).rotateZ(0.8).translate(0.2, 4.2, 0),
    new THREE.CylinderGeometry(0.08, 0.15, 3.0, 6).translate(0, 1.5, 0).rotateX(0.75).translate(0, 4.6, 0.2),
    new THREE.CylinderGeometry(0.07, 0.14, 3.0, 6).translate(0, 1.5, 0).rotateX(-0.8).rotateY(1).translate(0, 4.0, -0.2)]);
  const pineT = new THREE.CylinderGeometry(0.1, 0.36, 15, 8, 3).translate(0, 7.5, 0);
  [oakT, pineT].forEach(g => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 4); });
  const barkMat = new THREE.MeshStandardMaterial({ map: TEX.bark.map, normalMap: TEX.bark.normal, roughness: 0.95 });
  chunked(oakT, barkMat, oak); chunked(pineT, barkMat, pine);
  chunked(oakLeaves(), foliageMat(TEX.leaf, 0xffffff), oak, { leaf: true });
  chunked(pineLeaves(), foliageMat(TEX.needle, 0xd8e6d0), pine, { leaf: true });
  chunked(bushGeo(), foliageMat(TEX.leaf, 0xc8d8b0), bush, { cast: false, leaf: true });
  chunked(fernGeo(), foliageMat(TEX.needle, 0xb8e070), fern, { cast: false, leaf: true });
  return { oak: oak.length, pine: pine.length };
}

// rocks (triplanar)
function triplanarMat(map, normal, color = 0xffffff, scale = 0.25) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.88, vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.tTri = { value: map }; s.uniforms.uSc = { value: scale };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 tpw = vec4(transformed,1.0); vec3 tpn = objectNormal;
        #ifdef USE_INSTANCING
          tpw = instanceMatrix*tpw; tpn = mat3(instanceMatrix)*tpn;
        #endif
        vTP = (modelMatrix*tpw).xyz; vTN = normalize(mat3(modelMatrix)*tpn);`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN; uniform sampler2D tTri; uniform float uSc;')
      .replace('#include <map_fragment>', `{ vec3 w = pow(abs(normalize(vTN)), vec3(4.)); w /= (w.x+w.y+w.z);
        vec3 c = texture2D(tTri, vTP.zy*uSc).rgb*w.x + texture2D(tTri, vTP.xz*uSc).rgb*w.y + texture2D(tTri, vTP.xy*uSc).rgb*w.z;
        diffuseColor.rgb *= c; }`);
  };
  return m;
}
function rockGeo(seedOff) {
  const g = new THREE.IcosahedronGeometry(1, 4), p = g.attributes.position, c = [];
  for (let i = 0; i < p.count; i++) {
    const v = v3(p.getX(i), p.getY(i), p.getZ(i)); const n = fbm(v.x * 1.3 + seedOff, v.y * 1.3 + v.z * 0.7, 4) * 0.45 + ridged(v.x * 2 + seedOff, v.z * 2 + v.y, 3) * 0.15;
    v.multiplyScalar(1 + n); v.y = v.y < -0.25 ? -0.25 + (v.y + 0.25) * 0.2 : v.y; v.y *= 0.7; p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); const nn = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const moss = sstep(0.55, 0.85, nn.getY(i)); c.push(lerp(1, 0.62, moss), lerp(1, 0.78, moss), lerp(1, 0.45, moss)); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g;
}
function buildRocks() {
  const geos = [rockGeo(1), rockGeo(7), rockGeo(13)], lists = [[], [], []];
  const mat = triplanarMat(TEX.rock.map, null, 0xffffff, 0.3);
  for (let i = 0; i < 2600; i++) {
    const x = (rng() * 2 - 1) * (HALF - 40), z = (rng() * 2 - 1) * (HALF - 40), h = heightAt(x, z);
    if (h < -1 || Math.hypot(x, z) < 135 || pathMask(x, z) > 0.1) continue;
    const sl = slopeAt(x, z), dpd = Math.hypot(x - POND.x, z - POND.z);
    let p = 0.04 + sl * 1.5 + (x < -300 ? 0.2 : 0) + (dpd > 18 && dpd < 34 ? 0.3 : 0);
    if (rng() > p) continue;
    const sc = (0.4 + Math.pow(rng(), 3) * 3.5) * (x < -300 ? 1.8 : 1);
    const k = i % 3; lists[k].push({ x, z, m: mtx(x, h - sc * 0.15, z, rng() * 6.28, sc, 0.4) });
    if (sc > 0.9) addCollider(x, z, sc * 0.9);
  }
  geos.forEach((g, k) => chunked(g, mat, lists[k]));
}

// ---------------------------------------------------------------- town
const G = { stone: [], plaster: [], roof: [], wood: [], window: [], cloth: [], dark: [], metal: [] };
const obbs = [];
const circles = [];
function prep(g, color, m) {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
function box(w, h, d, su = 2, sv = 2, v0 = 0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / su, uv.getY(i) * dims[f][1] / sv + v0); }
  return g;
}
function quadGeo(P, UV) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...UV[0], ...UV[1], ...UV[2], ...UV[0], ...UV[2], ...UV[3]], 2));
  g.computeVertexNormals(); return g;
}
function triGeo(P, UV) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV.flat(), 2)); g.computeVertexNormals(); return g; }
// gable roof, ridge along x. W length, D depth, Rh ridge height, ov overhang
function gableRoof(W, D, Rh, ov, m, roofCol, gableCol) {
  const x0 = -W / 2 - ov, x1 = W / 2 + ov, z0 = -D / 2 - ov, z1 = D / 2 + ov, yE = -ov * Rh / (D / 2), sl = Math.hypot(D / 2 + ov, Rh - yE);
  const t = 0.18;
  for (const sgn of [1, -1]) {
    const ze = sgn > 0 ? z1 : z0;
    const P = sgn > 0 ? [[x0, yE, ze], [x1, yE, ze], [x1, Rh, 0], [x0, Rh, 0]] : [[x1, yE, ze], [x0, yE, ze], [x0, Rh, 0], [x1, Rh, 0]];
    G.roof.push(prep(quadGeo(P, [[0, 0], [(x1 - x0) / 2, 0], [(x1 - x0) / 2, sl / 2], [0, sl / 2]]), roofCol, m));
    const Pu = P.map(p => [p[0], p[1] - t, p[2]]); G.dark.push(prep(quadGeo([Pu[1], Pu[0], Pu[3], Pu[2]], [[0, 0], [1, 0], [1, 1], [0, 1]]), [0.25, 0.2, 0.16], m));
  }
  for (const sx of [-1, 1]) { const x = sx * W / 2; const P = sx > 0 ? [[x, 0, D / 2], [x, 0, -D / 2], [x, Rh * (1 - 0.02), 0]] : [[x, 0, -D / 2], [x, 0, D / 2], [x, Rh * 0.98, 0]];
    G.plaster.push(prep(triGeo(P, [[0, 0], [D / 3, 0], [D / 6, Rh / 2.8]]), gableCol, m)); }
  // ridge beam
  G.wood.push(prep(box(x1 - x0 + 0.1, 0.22, 0.3).translate(0, Rh + 0.02, 0), [0.6, 0.5, 0.45], m));
}
function windowQuad(x, y, z, nx, nz, w, h, m, lit) {
  const sx = nz, sz = -nx, o = 0.04;
  const P = [[x - sx * w / 2 + nx * o, y - h / 2, z - sz * w / 2 + nz * o], [x + sx * w / 2 + nx * o, y - h / 2, z + sz * w / 2 + nz * o], [x + sx * w / 2 + nx * o, y + h / 2, z + sz * w / 2 + nz * o], [x - sx * w / 2 + nx * o, y + h / 2, z - sz * w / 2 + nz * o]];
  G.window.push(prep(quadGeo(P, [[0, 0], [1, 0], [1, 1], [0, 1]]), lit ? [1, 1, 1] : [0, 0, 0], m));
  // shutters / sill
  G.wood.push(prep(box(w + 0.3, 0.12, 0.25, 1, 1).translate(x + nx * 0.1, y - h / 2 - 0.06, z + nz * 0.1), [0.8, 0.7, 0.6], m));
}
const PLASTER = [[1, 0.97, 0.9], [0.98, 0.9, 0.75], [0.95, 0.86, 0.8], [0.9, 0.92, 0.88], [1, 0.93, 0.82]];
const ROOFC = [[0.62, 0.32, 0.22], [0.55, 0.27, 0.18], [0.42, 0.42, 0.45], [0.5, 0.36, 0.28], [0.68, 0.38, 0.25]];
function house(cx, cz, w, d, rot, floors) {
  const h0s = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => heightAt(cx + a * Math.cos(rot) + b * Math.sin(rot), cz - a * Math.sin(rot) + b * Math.cos(rot)));
  const y0 = Math.max(...h0s), yMin = Math.min(...h0s) - 0.8;
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(cx, y0, cz);
  const pc = PLASTER[rng() * PLASTER.length | 0], rc = ROOFC[rng() * ROOFC.length | 0], sc = mul3([1, 0.97, 0.92], 0.85 + rng() * 0.2);
  const gh = 3.0, fh = 2.8, jet = 0.35;
  G.stone.push(prep(box(w, gh + (y0 - yMin), d, 2, 2).translate(0, (gh - (y0 - yMin)) / 2, 0), sc, m));
  let ww = w, dd = d;
  for (let f = 0; f < floors - 1; f++) {
    ww += jet * 2; dd += jet * 2; const yb = gh + f * fh;
    G.plaster.push(prep(box(ww, fh, dd, 3, fh).translate(0, yb + fh / 2, 0), pc, m));
    G.wood.push(prep(box(ww + 0.1, 0.25, dd + 0.1, 1, 1).translate(0, yb + 0.12, 0), [0.45, 0.35, 0.3], m));
    const nW = Math.max(1, Math.floor(ww / 2.4)), nD = Math.max(1, Math.floor(dd / 2.6));
    for (let i = 0; i < nW; i++) { const x = -ww / 2 + (i + 0.5) * ww / nW; windowQuad(x, yb + 1.5, dd / 2, 0, 1, 0.8, 1.15, m, rng() < 0.55); windowQuad(x, yb + 1.5, -dd / 2, 0, -1, 0.8, 1.15, m, rng() < 0.4); }
    for (let i = 0; i < nD; i++) { const z = -dd / 2 + (i + 0.5) * dd / nD; windowQuad(ww / 2, yb + 1.5, z, 1, 0, 0.8, 1.15, m, rng() < 0.4); windowQuad(-ww / 2, yb + 1.5, z, -1, 0, 0.8, 1.15, m, rng() < 0.4); }
  }
  const topY = gh + (floors - 1) * fh;
  const along = ww >= dd, L = along ? ww : dd, D = along ? dd : ww, Rh = D * (0.55 + rng() * 0.3);
  const rm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, topY, 0)).multiply(new THREE.Matrix4().makeRotationY(along ? 0 : Math.PI / 2));
  gableRoof(L, D, Rh, 0.5, rm, rc, pc);
  // door + ground windows (front = +z)
  G.wood.push(prep(box(1.3, 2.2, 0.12, 1.3, 2.2).translate(-w * 0.2, 1.1, d / 2 + 0.02), [0.7, 0.55, 0.45], m));
  windowQuad(w * 0.22, 1.6, d / 2, 0, 1, 1.0, 1.0, m, rng() < 0.6);
  // chimney
  if (rng() < 0.75) G.stone.push(prep(box(0.8, Rh + 1.6, 0.8).translate(L * 0.25 * (along ? 1 : 0), topY + Rh * 0.5 + 0.6, along ? 0 : L * 0.25), sc, m));
  obbs.push({ x: cx, z: cz, hw: w / 2 + 0.1, hd: d / 2 + 0.1, c: Math.cos(rot), s: Math.sin(rot) });
  stamp(cx, cz, Math.hypot(w, d) / 2 + 3, (k, t) => { mask[k] *= sstep(0.55, 1.0, t); mask[k + 1] = Math.min(mask[k + 1], 0.45 + 0.55 * sstep(0.5, 1.0, t)); });
}
function insideBuilding(x, z, pad = 0) {
  for (const o of obbs) { const dx = x - o.x, dz = z - o.z, lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c; if (Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad) return true; }
  return false;
}
function buildTown() {
  // main street lots
  for (const side of [-1, 1]) {
    let x = -112;
    while (x < 112) {
      const w = 6 + rng() * 2.5, d = 7 + rng() * 2.5;
      const cx = x + w / 2; x += w + 0.8 + rng() * 1.5;
      if (Math.abs(cx) < 31 || Math.abs(cx) > 106) continue;
      if (side < 0 && Math.abs(cx) < 6) continue;
      const cz = side * (4.6 + d / 2);
      house(cx, cz, w, d, side > 0 ? 0 : Math.PI, 2 + (rng() < 0.55 ? 1 : 0) + (rng() < 0.12 ? 1 : 0));
    }
  }
  // north street
  for (const side of [-1, 1]) { let z = -30; while (z > -58) { const w = 6 + rng() * 2, d = 7 + rng() * 2; const cz = z - w / 2; z -= w + 1;
    if (cz < -60) break; house(side * (4 + d / 2), cz, w, d, side > 0 ? Math.PI / 2 : -Math.PI / 2, 2 + (rng() < 0.6 ? 1 : 0)); } }
  // south lane
  for (const side of [-1, 1]) { let z = 30; while (z < 98) { const w = 6 + rng() * 2, d = 7 + rng() * 2; const cz = z + w / 2; z += w + 1.5 + rng() * 3;
    if (cz > 96) break; house(side * (3.6 + d / 2), cz, w, d, side > 0 ? Math.PI / 2 : -Math.PI / 2, 2 + (rng() < 0.4 ? 1 : 0)); } }
  // infill
  for (let t = 0; t < 1400 && obbs.length < 150; t++) {
    const a = rng() * Math.PI * 2, r = 34 + rng() * 74, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const w = 5.5 + rng() * 3, d = 6.5 + rng() * 3, hd = Math.hypot(w, d) / 2 + 1.3;
    if (r + hd > 110) continue;
    if (Math.abs(cz) < 5 + hd || (Math.abs(cx) < 4 + hd && cz < 0) || (Math.abs(cx) < 3.6 + hd && cz > 0)) continue;
    if (Math.hypot(cx, cz + 82) < 24 || Math.hypot(cx, cz) < 30 + hd) continue;
    if (obbs.some(o => Math.hypot(o.x - cx, o.z - cz) < (Math.hypot(o.hw, o.hd) + hd) * 0.92)) continue;
    const rot = Math.round((a + Math.PI / 2) / (Math.PI / 8)) * (Math.PI / 8) + (rng() - 0.5) * 0.1;
    house(cx, cz, w, d, rot, 2 + (rng() < 0.4 ? 1 : 0));
  }
  // church
  { const cx = 0, cz = -84, y0 = heightAt(cx, cz) - 0.4, m = new THREE.Matrix4().makeTranslation(cx, y0, cz), sc = [0.92, 0.88, 0.82];
    G.stone.push(prep(box(13, 14, 28).translate(0, 7, 0), sc, m));
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { const z = -11 + i * 5.2; windowQuad(sx * 6.5, 8.5, z, sx, 0, 1.4, 4.2, m, true);
      G.stone.push(prep(box(1.2, 10, 1.6).translate(sx * 7.0, 5, z + 2.6), sc, m)); }
    gableRoof(28, 13, 9, 0.6, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 14, 0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), [0.38, 0.4, 0.44], sc);
    const tm = new THREE.Matrix4().makeTranslation(cx, y0, cz + 16.5);
    G.stone.push(prep(box(7.5, 30, 7.5).translate(0, 15, 0), sc, tm));
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, nx = Math.sin(a), nz = Math.cos(a); windowQuad(nx * 3.75, 24, nz * 3.75, nx, nz, 1.3, 3.0, tm, false); }
    windowQuad(0, 9, 3.75, 0, 1, 1.6, 3.4, tm, true);
    G.wood.push(prep(box(2.4, 3.8, 0.2, 2.4, 3.8).translate(0, 1.9, 3.8), [0.7, 0.55, 0.45], tm));
    const spire = new THREE.ConeGeometry(5.6, 17, 4, 1).rotateY(Math.PI / 4).translate(0, 30 + 8.5, 0);
    const uv = spire.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 8);
    G.roof.push(prep(spire, [0.38, 0.42, 0.46], tm));
    G.metal.push(prep(new THREE.CylinderGeometry(0.06, 0.06, 3).translate(0, 48.5, 0), [1, 1, 1], tm));
    G.metal.push(prep(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, 49, 0), [1, 1, 1], tm));
    obbs.push({ x: cx, z: cz, hw: 6.6, hd: 14.1, c: 1, s: 0 }); obbs.push({ x: cx, z: cz + 16.5, hw: 3.8, hd: 3.8, c: 1, s: 0 });
    stamp(cx, cz, 20, (k) => { mask[k] = 0; mask[k + 1] = Math.min(mask[k + 1], 0.7); });
  }
  // town wall + towers
  const WR = 118, segs = 64;
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2, am = (a0 + a1) / 2;
    const ad = Math.min(Math.abs(Math.atan2(Math.sin(am), Math.cos(am))), Math.abs(Math.atan2(Math.sin(am - Math.PI), Math.cos(am - Math.PI))));
    if (ad < 0.05) continue;
    const L = 2 * WR * Math.sin(Math.PI / segs) + 0.3, cx = Math.cos(am) * WR, cz = Math.sin(am) * WR, y0 = heightAt(cx, cz) - 1.5;
    const m = new THREE.Matrix4().makeRotationY(-am + Math.PI / 2).setPosition(cx, y0, cz);
    G.stone.push(prep(box(L, 9.5, 2.2).translate(0, 4.75, 0), [0.88, 0.85, 0.8], m));
    G.wood.push(prep(box(L, 0.2, 1.6, 2, 2).translate(0, 8.7, 0.2), [0.6, 0.5, 0.4], m));
    for (let k = 0; k < 5; k++) G.stone.push(prep(box(0.8, 1.2, 0.5).translate(-L / 2 + (k + 0.5) * L / 5, 10.1, -0.85), [0.86, 0.83, 0.78], m));
  }
  const towerAt = (a, r = 4.6, h = 15) => {
    const cx = Math.cos(a) * WR, cz = Math.sin(a) * WR, y0 = heightAt(cx, cz) - 1.5, m = new THREE.Matrix4().makeTranslation(cx, y0, cz);
    const cyl = new THREE.CylinderGeometry(r, r * 1.08, h, 20, 1, true).translate(0, h / 2, 0); const uv = cyl.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r / 2, uv.getY(i) * h / 2);
    G.stone.push(prep(cyl, [0.86, 0.83, 0.78], m));
    const cone = new THREE.ConeGeometry(r + 0.9, r * 1.6, 20, 1, true).translate(0, h + r * 0.8, 0); const cu = cone.attributes.uv;
    for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * 2 * Math.PI * r / 2, cu.getY(i) * 3);
    G.roof.push(prep(cone, [0.4, 0.42, 0.46], m));
    G.dark.push(prep(new THREE.CircleGeometry(r + 0.9, 20).rotateX(Math.PI / 2).translate(0, h, 0), [0.2, 0.18, 0.16], m));
    for (let k = 0; k < 4; k++) { const aa = k * Math.PI / 2 + 0.4; windowQuad(Math.cos(aa) * r, h - 3, Math.sin(aa) * r, Math.cos(aa), Math.sin(aa), 0.5, 1.2, m, rng() < 0.4); }
    circles.push([cx, cz, r + 0.3]);
    return { x: cx, z: cz, y: y0 + h };
  };
  const flagPoles = [];
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + Math.PI / 10; towerAt(a); }
  for (const g of [0, Math.PI]) for (const s of [-1, 1]) { const t = towerAt(g + s * 0.085, 4.2, 18); flagPoles.push(t); }
  // gate arches (lintel)
  for (const g of [0, Math.PI]) { const cx = Math.cos(g) * WR, cz = 0, y0 = heightAt(cx, cz); const m = new THREE.Matrix4().makeRotationY(g).setPosition(cx, y0, cz);
    G.stone.push(prep(box(2.6, 3.4, 12).translate(0, 7.6, 0), [0.84, 0.8, 0.76], m)); G.wood.push(prep(box(0.3, 0.3, 9).translate(0, 5.8, 0), [0.4, 0.3, 0.25], m)); }
  // plaza: fountain + stalls + lamps
  { const y0 = heightAt(0, 0), m = new THREE.Matrix4().makeTranslation(0, y0, 0);
    const basin = new THREE.CylinderGeometry(4.6, 4.8, 0.9, 32, 1, true).translate(0, 0.45, 0); const bu = basin.attributes.uv; for (let i = 0; i < bu.count; i++) bu.setXY(i, bu.getX(i) * 14, bu.getY(i) * 0.5);
    G.stone.push(prep(basin, [0.9, 0.88, 0.85], m)); G.stone.push(prep(new THREE.TorusGeometry(4.7, 0.25, 8, 40).rotateX(Math.PI / 2).translate(0, 0.9, 0), [0.92, 0.9, 0.86], m));
    G.stone.push(prep(new THREE.CylinderGeometry(0.5, 0.8, 3.2, 12).translate(0, 1.6, 0), [0.92, 0.9, 0.86], m));
    G.stone.push(prep(new THREE.CylinderGeometry(1.6, 0.4, 0.5, 20).translate(0, 3.0, 0), [0.92, 0.9, 0.86], m));
    circles.push([0, 0, 5.1]);
    const cloths = [[0.6, 0.12, 0.1], [0.12, 0.25, 0.5], [0.75, 0.6, 0.2], [0.2, 0.42, 0.2], [0.55, 0.3, 0.55], [0.85, 0.82, 0.75]];
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2; if (Math.abs(Math.sin(a)) < 0.25) continue; const r = 17, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const sm = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(cx, heightAt(cx, cz), cz);
      for (const [px, pz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) G.wood.push(prep(box(0.14, pz < 0 ? 2.6 : 2.2, 0.14).translate(px, pz < 0 ? 1.3 : 1.1, pz), [0.6, 0.5, 0.4], sm));
      G.wood.push(prep(box(3.0, 0.9, 1.2).translate(0, 0.45, 0.2), [0.7, 0.6, 0.5], sm));
      const cc = cloths[k % cloths.length]; G.cloth.push(prep(quadGeo([[-1.8, 2.15, 1.3], [1.8, 2.15, 1.3], [1.8, 2.7, -1.2], [-1.8, 2.7, -1.2]], [[0, 0], [4, 0], [4, 1], [0, 1]]), cc, sm));
      circles.push([cx, cz, 1.9]);
      for (let b = 0; b < 4; b++) G.wood.push(prep(new THREE.CylinderGeometry(0.32, 0.36, 0.8, 10).translate(-1.2 + b * 0.8, 1.3, 0.2), [0.65, 0.5, 0.35], sm));
    }
  }
  const lamps = [];
  for (let x = -100; x <= 100; x += 20) for (const sd of [-1, 1]) { if (Math.abs(x) < 25) continue; lamps.push([x + sd * 4, sd * 4.3]); }
  for (let z = -20; z > -66; z -= 18) lamps.push([3.4, z]);
  for (const [x, z] of lamps) { const y = heightAt(x, z), m = new THREE.Matrix4().makeTranslation(x, y, z);
    G.metal.push(prep(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 6).translate(0, 1.7, 0), [1, 1, 1], m));
    G.window.push(prep(box(0.36, 0.5, 0.36, 0.36, 0.5).translate(0, 3.55, 0), [1, 1, 1], m));
    G.metal.push(prep(new THREE.ConeGeometry(0.34, 0.3, 4).rotateY(Math.PI / 4).translate(0, 3.95, 0), [1, 1, 1], m)); circles.push([x, z, 0.25]); }
  // barrels and crates
  for (let i = 0; i < 90; i++) { const a = rng() * 6.28, r = 28 + rng() * 80, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pathMask(x, z) > 0.6 || insideBuilding(x, z, 0.6) || !insideBuilding(x, z, 2.2)) continue; const y = heightAt(x, z), m = new THREE.Matrix4().makeRotationY(rng() * 6).setPosition(x, y, z);
    if (rng() < 0.5) G.wood.push(prep(new THREE.CylinderGeometry(0.38, 0.33, 0.95, 12).translate(0, 0.47, 0), [0.75, 0.6, 0.45], m)); else G.wood.push(prep(box(0.9, 0.9, 0.9, 0.9, 0.9).translate(0, 0.45, 0), [0.85, 0.75, 0.6], m)); circles.push([x, z, 0.5]); }
  return flagPoles;
}
// pond: dock, rowboat, fisher's hut, reeds, lily pads
let pier;
const boats = [];
function buildPond() {
  const pz = POND.z + 4, x0 = POND.x - 28, x1 = POND.x - 8, deckY = 1.05;
  pier = { x0, x1, z0: pz - 1.4, z1: pz + 1.4, y: deckY };
  for (let x = x0; x < x1; x += 0.5) { const m = new THREE.Matrix4().makeTranslation(x, deckY - 0.08 + (hash2(x * 10 | 0, 3) - 0.5) * 0.03, pz);
    G.wood.push(prep(box(0.46, 0.12, 2.8, 2.8, 0.5), [0.75 + hash2(x * 10 | 0, 1) * 0.3, 0.7, 0.62], m)); }
  for (let x = x0 + 1; x < x1; x += 3.4) for (const sd of [-1, 1]) { const y = heightAt(x, pz + sd * 1.3), m = new THREE.Matrix4().makeTranslation(x, 0, pz + sd * 1.3);
    const top = deckY + 0.9, bot = Math.min(y, -1) - 0.5;
    G.wood.push(prep(new THREE.CylinderGeometry(0.14, 0.16, top - bot, 8).translate(0, (top + bot) / 2, 0), [0.6, 0.55, 0.5], m)); }
  G.wood.push(prep(box(x1 - x0, 0.09, 0.09).translate((x0 + x1) / 2, deckY + 0.85, pz - 1.35), [0.6, 0.55, 0.5]));
  G.wood.push(prep(box(x1 - x0, 0.09, 0.09).translate((x0 + x1) / 2, deckY + 0.85, pz + 1.35), [0.6, 0.55, 0.5]));
  // fisher's hut on the bank
  { const hx = POND.x - 38, hz = POND.z - 14, r = 0.5, y = heightAt(hx, hz) + 0.25, m = new THREE.Matrix4().makeRotationY(Math.PI / 2 + r).setPosition(hx, y, hz);
    G.wood.push(prep(box(5, 2.8, 4, 2, 2).translate(0, 1.4, 0), [0.85, 0.78, 0.7], m));
    gableRoof(5, 4, 2.2, 0.4, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.8, 0)), [0.5, 0.42, 0.35], [0.85, 0.78, 0.7]);
    windowQuad(1.2, 1.6, 2, 0, 1, 0.7, 0.7, m, true);
    obbs.push({ x: hx, z: hz, hw: 2.6, hd: 2.1, c: Math.cos(Math.PI / 2 + r), s: Math.sin(Math.PI / 2 + r) });
    stamp(hx, hz, 7, (k, t) => { mask[k] *= sstep(0.4, 1, t); }); }
  // rowboat floating beside the dock
  const hull = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.95, 0.55, 2.6); const hu = hull.attributes.uv; for (let i = 0; i < hu.count; i++) hu.setXY(i, hu.getX(i) * 3, hu.getY(i) * 1);
  const boatMat = new THREE.MeshStandardMaterial({ map: TEX.wood.map, normalMap: TEX.wood.normal, roughness: 0.8, side: THREE.DoubleSide, color: 0xb0a090 });
  const seat = new THREE.MeshStandardMaterial({ map: TEX.wood.map, roughness: 0.8, color: 0x8a7060 });
  { const g = new THREE.Group(); const hm = new THREE.Mesh(hull, boatMat); hm.castShadow = hm.receiveShadow = true; g.add(hm);
    for (const z of [-1, 0.6]) { const sm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.35), seat); sm.position.set(0, -0.12, z); sm.castShadow = true; g.add(sm); }
    g.position.set(x1 - 3, 0.15, pz + 4.2); g.rotation.y = 1.35; scene.add(g); boats.push(g); }
  // reeds around the bank
  const reeds = [];
  for (let i = 0; i < 120; i++) { const a = rng() * 6.28, d = 15 + rng() * 10, x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d, h = heightAt(x, z);
    if (h > 1.0 || h < -0.8) continue; if (x > pier.x0 - 2 && x < pier.x1 + 2 && Math.abs(z - pz) < 3) continue;
    reeds.push({ x, z, m: mtx(x, h - 0.05, z, rng() * 6.28, 0.9 + rng() * 0.8) }); }
  chunked(fernGeo(), foliageMat(TEX.leaf, 0xd8f0a0), reeds, { cast: false, leaf: true });
  // lily pads
  const pad = new THREE.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 26; i++) { const a = rng() * 6.28, d = 3 + rng() * 9, x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d;
    if (heightAt(x, z) > -0.6) continue; const m = new THREE.Mesh(new THREE.CircleGeometry(0.28 + rng() * 0.22, 14, 0, 5.6), pad); m.rotation.x = -Math.PI / 2; m.rotation.z = rng() * 6; m.position.set(x, 0.03, z); m.layers.set(1); scene.add(m); }
  // boulders on the bank handled by buildRocks
}
function buildTownMeshes() {
  const mk = (list, mat) => { if (!list.length) return; const g = mergeGeometries(list); g.computeBoundingSphere(); const ms = new THREE.Mesh(g, mat); ms.castShadow = ms.receiveShadow = true; scene.add(ms); return ms; };
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.9 }, o));
  mk(G.stone, std({ map: TEX.wall.map, normalMap: TEX.wall.normal, normalScale: new THREE.Vector2(1.2, 1.2) }));
  mk(G.plaster, std({ map: TEX.timber.map, normalMap: TEX.timber.normal, normalScale: new THREE.Vector2(0.8, 0.8) }));
  mk(G.roof, std({ map: TEX.roof.map, normalMap: TEX.roof.normal, side: THREE.DoubleSide, roughness: 0.8 }));
  mk(G.wood, std({ map: TEX.wood.map, normalMap: TEX.wood.normal, roughness: 0.85 }));
  mk(G.dark, std({ roughness: 1 }));
  mk(G.metal, std({ color: 0x2a2a2c, metalness: 0.8, roughness: 0.45 }));
  mk(G.cloth, std({ map: TEX.cloth, side: THREE.DoubleSide, roughness: 1 }));
  winMat = std({ map: TEX.window, emissiveMap: TEX.windowE, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.15, metalness: 0.1 });
  // lit windows use vertex colour as emissive mask
  winMat.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.r;').replace('#include <color_fragment>', ''); };
  const wm = mk(G.window, winMat); if (wm) wm.castShadow = false;
}
let winMat;
// banners
const banners = [];
function buildBanners(poles) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a1d1a, roughness: 0.9, side: THREE.DoubleSide, map: TEX.cloth });
  mat.onBeforeCompile = (s) => { s.uniforms.uTime = U.time; s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n float fx = uv.x; transformed.z += sin(uTime*4.0 - fx*6.0 + position.y*0.8) * 0.35 * fx; transformed.y -= fx*fx*0.3;'); };
  for (const p of poles) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.4 }));
    pole.position.set(p.x, p.y + 4.5 + 4, p.z); scene.add(pole);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8, 16, 4).translate(1.6, 0, 0), mat); f.position.set(p.x, p.y + 6.6 + 4, p.z); f.rotation.y = 0.5; f.castShadow = true; scene.add(f); }
}


// ---------------------------------------------------------------- people: flat 2D silhouettes, black head -> transparent feet
const SHAPE_DEFS = (() => {
  const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const mirror = (right) => { const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]); return [...right, ...left]; };
  const man = mirror([[0, 1.0], ...arc(0, 0.935, 0.065, 90, -68, 7).slice(1), [0.034, 0.862], [0.15, 0.838], [0.168, 0.80], [0.178, 0.60], [0.172, 0.52], [0.138, 0.515], [0.112, 0.585], [0.103, 0.50], [0.098, 0.46], [0.09, 0.04], [0.118, 0.0], [0.016, 0.0], [0.012, 0.455], [0, 0.45]]);
  const woman = mirror([[0, 1.0], ...arc(0, 0.94, 0.06, 90, -70, 7).slice(1), [0.026, 0.88], [0.115, 0.845], [0.128, 0.80], [0.135, 0.62], [0.098, 0.60], [0.082, 0.64], [0.07, 0.62], [0.19, 0.06], [0.2, 0.03], [0, 0.03]]);
  const child = mirror([[0, 1.0], ...arc(0, 0.885, 0.115, 90, -62, 8).slice(1), [0.05, 0.78], [0.15, 0.735], [0.165, 0.66], [0.17, 0.5], [0.14, 0.47], [0.11, 0.55], [0.105, 0.42], [0.1, 0.04], [0.14, 0.0], [0.02, 0.0], [0.015, 0.4], [0, 0.39]]);
  const sage = [[0, 1.0], [0.07, 0.96], [0.085, 0.89], [0.07, 0.855], [0.15, 0.80], [0.2, 0.70], [0.255, 0.69], [0.262, 0.0], [0.244, 0.0], [0.238, 0.62], [0.215, 0.60], [0.212, 0.04], [0, 0.03], [-0.2, 0.04], [-0.205, 0.5], [-0.17, 0.78], [-0.07, 0.855], [-0.082, 0.9], [-0.06, 0.965]];
  return [{ pts: man, h: 1.78 }, { pts: woman, h: 1.66 }, { pts: child, h: 1.08 }, { pts: sage, h: 1.74 }];
})();
const WG = { nodes: [], adj: [] };
function buildWalkGraph() {
  const idx = new Map(), key = (x, z) => Math.round(x / 5) + ',' + Math.round(z / 5);
  const add = (x, z) => { const k = key(x, z); if (!idx.has(k)) { idx.set(k, WG.nodes.length); WG.nodes.push([x, z]); WG.adj.push([]); } return idx.get(k); };
  const link = (a, b) => { if (a !== b && !WG.adj[a].includes(b)) { WG.adj[a].push(b); WG.adj[b].push(a); } };
  const lines = paths.map(p => p.pts);
  lines.push([[POND.x - 30, POND.z + 4], [POND.x - 11, POND.z + 4]], [[0, -68], [0, -80]], [[0, 100], [0, 112]], [[POND.x + 60, POND.z + 30], [POND.x + 30, POND.z + 4]]);
  for (const pts of lines) for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 16)); let prev = add(ax, az);
    for (let k = 1; k <= n; k++) { const cur = add(lerp(ax, bx, k / n), lerp(az, bz, k / n)); link(prev, cur); prev = cur; }
  }
}
let people = null;
function buildPeople() {
  buildWalkGraph();
  const COUNT = 64, per = [0, 0, 0, 0], agents = [];
  for (let i = 0; i < COUNT; i++) {
    // two thirds start inside the walls, the rest on the roads outside
    let n; do { n = rng() * WG.nodes.length | 0; } while ((Math.hypot(...WG.nodes[n]) < 122) !== (i % 3 !== 0) && rng() < 0.8);
    const shape = i % 4, a = { shape, slot: per[shape]++, from: n, to: WG.adj[n][rng() * WG.adj[n].length | 0], prev: -1, t: rng(), speed: 1.1 + rng() * 0.55, off: (rng() - 0.5) * 2.4, pause: rng() < 0.3 ? rng() * 6 : 0, ph: rng() * 6.28, flip: rng() < 0.5 ? 1 : -1, size: 0.95 + rng() * 0.1, x: 0, z: 0, dx: 1, dz: 0 };
    if (a.shape === 2) a.speed *= 0.9;
    agents.push(a);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uFog: { value: 0.001 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: `attribute vec4 aPS; attribute vec3 aM; uniform float uFog; varying float vA;
      void main(){
        vec3 wp = aPS.xyz; float sc = aPS.w; vec3 toC = cameraPosition - wp; toC.y = 0.0;
        vec3 right = normalize(vec3(toC.z, 0.0, -toC.x) + vec3(1e-4, 0.0, 0.0));
        float y = position.y, x = position.x * aM.y;
        float legs = smoothstep(0.5, 0.0, y);
        x += sin(aM.x) * legs * 0.07 * aM.z + sin(aM.x * 0.5) * y * 0.012 * aM.z;
        float bob = abs(sin(aM.x)) * 0.014 * aM.z;
        vec3 pos = wp + right * x * sc + vec3(0.0, (y + bob) * sc, 0.0);
        float d = distance(pos, cameraPosition);
        vA = smoothstep(0.0, 0.97, y) * exp(-uFog * uFog * d * d);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, vA); }',
  });
  const meshes = SHAPE_DEFS.map((d, i) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(d.pts.map(([x, y]) => new THREE.Vector2(x, y))));
    const n = per[i], ig = new THREE.InstancedBufferGeometry(); ig.index = g.index; ig.setAttribute('position', g.attributes.position); ig.instanceCount = n;
    const ps = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); ps.setUsage(THREE.DynamicDrawUsage);
    const mm = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); mm.setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('aPS', ps); ig.setAttribute('aM', mm);
    const m = new THREE.Mesh(ig, mat); m.frustumCulled = false; m.layers.set(1); m.renderOrder = 2; scene.add(m); return m;
  });
  people = { agents, meshes, mat };
}
const _cr = new THREE.Vector3();
function updatePeople(dt) {
  if (!people) return;
  const camX = camera.position.x, camZ = camera.position.z;
  for (const a of people.agents) {
    const [fx, fz] = WG.nodes[a.from], [tx, tz] = WG.nodes[a.to], L = Math.hypot(tx - fx, tz - fz) || 1;
    a.dx = (tx - fx) / L; a.dz = (tz - fz) / L;
    let moving = 0;
    if (a.pause > 0) a.pause -= dt;
    else { a.t += a.speed * dt / L; moving = 1; a.ph += dt * a.speed * 5.2;
      if (a.t >= 1) { const adj = WG.adj[a.to], opts = adj.filter(n => n !== a.from), nxt = opts.length ? opts[rng() * opts.length | 0] : a.from; a.prev = a.from; a.from = a.to; a.to = nxt; a.t = 0;
        if (adj.length === 1 || rng() < 0.22) a.pause = 3 + rng() * 9; a.off = clamp(a.off + (rng() - 0.5) * 0.8, -1.3, 1.3); } }
    const t = a.t; let px = lerp(fx, tx, t) - a.dz * a.off, pz = lerp(fz, tz, t) + a.dx * a.off;
    { const rr = Math.hypot(px, pz); if (rr < 6.4) { const k = 6.4 / Math.max(rr, 0.01); px *= k; pz *= k; } } // walk around the fountain
    a.x = px; a.z = pz;
    // face the walking direction relative to the viewer: +1 faces screen-right
    _cr.set(camZ - pz, 0, -(camX - px)).normalize();
    const want = (a.dx * _cr.x + a.dz * _cr.z) >= 0 ? 1 : -1; a.flip += (want - a.flip) * Math.min(1, dt * 5);
    const g = people.meshes[a.shape].geometry, ps = g.attributes.aPS, mm = g.attributes.aM, k = a.slot;
    ps.setXYZW(k, px, groundAt(px, pz), pz, SHAPE_DEFS[a.shape].h * a.size); mm.setXYZ(k, a.ph, a.flip, moving);
  }
  for (const m of people.meshes) { m.geometry.attributes.aPS.needsUpdate = true; m.geometry.attributes.aM.needsUpdate = true; }
  people.mat.uniforms.uFog.value = scene.fog.density;
}

// ---------------------------------------------------------------- sky, light, water, clouds
let stars, moon, hemi, sky, skyEnvScene, sun, water, clouds, pmrem, envRT, dust;
const sunDir = new THREE.Vector3();
function buildSky() {
  sky = new Sky(); sky.scale.setScalar(8000); sky.layers.set(1); sky.renderOrder = -3; scene.add(sky);
  const su = sky.material.uniforms; su.turbidity.value = 3.2; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.003; su.mieDirectionalG.value = 0.82;
  skyEnvScene = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(8000); s2.material = sky.material; skyEnvScene.add(s2);
  pmrem = new THREE.PMREMGenerator(renderer);
  sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
  const sc = sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 900;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  scene.add(sun); scene.add(sun.target);
  hemi = new THREE.HemisphereLight(0x6070a0, 0x101418, 0); scene.add(hemi);
  // water
  water = new Water(new THREE.PlaneGeometry(90, 90), { textureWidth: Math.min(Q.refl, 512), textureHeight: Math.min(Q.refl, 512), waterNormals: TEX.water, sunDirection: new THREE.Vector3(), sunColor: 0xffffff, waterColor: 0x0a4a5c, distortionScale: 2.6, fog: true });
  water.rotation.x = -Math.PI / 2; water.position.set(POND.x, 0.0, POND.z); water.layers.set(1);
  const wu = water.material.uniforms; wu.size.value = 2.6;
  wu.uHeight = { value: heightTex }; wu.uWorld = { value: WORLD }; wu.uShallow = { value: new THREE.Color(0x48b8b0) }; wu.uSkyCol = { value: new THREE.Color(0.5, 0.6, 0.7) };
  water.material.transparent = true;
  water.material.fragmentShader = WATER_FRAG;
  scene.add(water);
  // clouds
  clouds = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 24), new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uSun: { value: sunDir }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz - cameraPosition; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun, uSunCol, uAmb; varying vec3 vW;
      ${GLSL_NOISE}
      float fb(vec2 p){ float s=0., a=0.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
      void main(){ vec3 d = normalize(vW); if (d.y < 0.0) discard;
        vec2 p = d.xz/(d.y+0.12)*1.4 + vec2(uTime*0.004, uTime*0.0015);
        float n = fb(p);
        float cov = smoothstep(0.48, 0.78, n);
        float n2 = fb(p + uSun.xz*0.08);
        float lit = clamp(0.55 + (n - n2)*3.5, 0.0, 1.0);
        float sunAmt = pow(max(dot(d, uSun), 0.0), 8.0);
        vec3 col = mix(uAmb*0.9, uSunCol*1.1, lit) + uSunCol*sunAmt*(1.0-cov)*1.5;
        float a = cov * smoothstep(0.0, 0.18, d.y) * 0.92;
        gl_FragColor = vec4(col, a); }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false }));
  clouds.renderOrder = -1; clouds.layers.set(1); scene.add(clouds);
  // stars and moon
  { const n = 2400, pos = new Float32Array(n * 3), br = new Float32Array(n);
    for (let i = 0; i < n; i++) { const u = Math.random(), a = Math.random() * 6.2832, r = Math.sqrt(1 - u * u); pos.set([r * Math.cos(a) * 3600, u * 3600, r * Math.sin(a) * 3600], i * 3); br[i] = Math.pow(Math.random(), 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aB', new THREE.BufferAttribute(br, 1));
    stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uNight: { value: 0 }, uPx: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'attribute float aB; uniform float uPx; varying float vB; void main(){ vB = aB; gl_PointSize = (1.2 + aB * 2.6) * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uNight; varying float vB; void main(){ vec2 p = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(p)); gl_FragColor = vec4(vec3(0.8, 0.88, 1.0) * (0.35 + vB), a * uNight * (0.25 + vB)); }' }));
    stars.renderOrder = -2; stars.frustumCulled = false; stars.layers.set(1); scene.add(stars);
    moon = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShaderMaterial({ uniforms: { uNight: { value: 0 } }, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uNight; varying vec2 vUv; ${GLSL_NOISE}
        void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float disc = smoothstep(0.205, 0.195, r);
          float cr = vnoise(p * 9.0) * 0.5 + vnoise(p * 23.0) * 0.3; vec3 col = mix(vec3(0.72, 0.74, 0.8), vec3(0.97, 0.96, 0.92), cr + 0.15);
          col *= 0.85 + 0.25 * (p.x * -0.5 + 0.5);
          float glow = exp(-r * 7.0) * 0.45 + exp(-r * 2.5) * 0.08;
          gl_FragColor = vec4(col * disc + vec3(0.55, 0.65, 0.9) * glow * (1.0 - disc), clamp(disc + glow, 0.0, 1.0) * uNight); }` }));
    moon.renderOrder = -2; moon.frustumCulled = false; moon.layers.set(1); scene.add(moon); }
  // dust motes
  const n = 900, p = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) p[i] = (Math.random() - 0.5) * 40;
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.06, map: TEX.spark, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff2cc, opacity: 0.6 }));
  dust.layers.set(1); dust.frustumCulled = false; scene.add(dust);
}
const WATER_FRAG = `
uniform sampler2D mirrorSampler; uniform float alpha; uniform float time; uniform float size; uniform float distortionScale; uniform sampler2D normalSampler;
uniform vec3 sunColor; uniform vec3 sunDirection; uniform vec3 eye; uniform vec3 waterColor; uniform sampler2D uHeight; uniform float uWorld; uniform vec3 uShallow; uniform vec3 uSkyCol;
varying vec4 mirrorCoord; varying vec4 worldPosition;
vec4 getNoise( vec2 uv ) {
  vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
  vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
  vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
  vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
  vec4 noise = texture2D( normalSampler, uv0 ) + texture2D( normalSampler, uv1 ) + texture2D( normalSampler, uv2 ) + texture2D( normalSampler, uv3 );
  return noise * 0.5 - 1.0;
}
#include <common>
#include <packing>
#include <bsdfs>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${GLSL_NOISE}
void main() {
  #include <logdepthbuf_fragment>
  float th = texture2D(uHeight, (worldPosition.xz + uWorld*0.5)/uWorld).r;
  if (th >= worldPosition.y) discard;
  float depth = max(worldPosition.y - th, 0.0);
  vec4 noise = getNoise( worldPosition.xz * size );
  float calm = mix(0.35, 1.0, smoothstep(0.0, 3.0, depth));
  vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5*calm, 1.0, 1.5*calm ) );
  vec3 worldToEye = eye - worldPosition.xyz; vec3 eyeDirection = normalize( worldToEye );
  vec3 refl = normalize(reflect(-sunDirection, surfaceNormal));
  float spec = pow(max(0.0, dot(eyeDirection, refl)), 260.0) * 3.0 + pow(max(0.0, dot(eyeDirection, refl)), 40.0) * 0.15;
  float dist = length(worldToEye);
  vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / dist ) * distortionScale;
  vec3 reflectionSample = texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ).rgb;
  float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
  float reflectance = 0.02 + 0.98 * pow( 1.0 - theta, 5.0 );
  float ab = exp(-depth*0.3);
  vec3 body = mix(waterColor, uShallow, ab);
  float sunUp = clamp(sunDirection.y*2.5, 0.03, 1.0);
  float sss = pow(max(dot(-eyeDirection, sunDirection)*0.5+0.5, 0.0), 3.0) * 0.35;
  vec3 scatter = body * (sunColor*(0.25 + 0.35*max(dot(surfaceNormal, sunDirection), 0.0) + sss)*sunUp + uSkyCol*0.55);
  reflectance = min(reflectance, 0.72);
  vec3 col = mix(scatter, reflectionSample*vec3(0.78,0.88,0.98), reflectance) + sunColor*spec;
  float n1 = vnoise(worldPosition.xz*0.32 + vec2(time*0.11, time*0.07))*0.6 + vnoise(worldPosition.xz*1.4 - time*0.18)*0.4;
  float shore = 1.0 - smoothstep(0.0, 0.45, depth);
  float waves = sin(depth*4.2 - time*1.25 + n1*3.0)*0.5 + 0.5;
  float foam = shore * smoothstep(0.32, 0.75, n1 + shore*0.25);
  foam += smoothstep(0.88, 1.0, waves) * (1.0 - smoothstep(0.2, 1.4, depth)) * smoothstep(0.4, 0.75, n1);
  foam = clamp(foam, 0.0, 1.0);
  vec3 foamCol = vec3(0.92) * (sunColor*0.45*sunUp + uSkyCol*0.6);
  col = mix(col, foamCol, foam*0.9);
  float a = clamp(smoothstep(0.0, 2.2, depth)*0.82 + 0.18*smoothstep(0.0, 0.25, depth) + foam*0.6, 0.0, 1.0);
  a = max(a, reflectance*smoothstep(0.0,0.15,depth));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

let tod = 0.79, envDirty = true, lastEnvTod = -1;
function todHours(t) { return 5 + t * 15.5; }
function updateSun() {
  const h = todHours(tod), k = (h - 6) / 12;
  const elev = Math.sin(k * Math.PI) * 58 * Math.PI / 180, az = (90 + k * 180) * Math.PI / 180;
  sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, az);
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  sky.material.uniforms.rayleigh.value = lerp(2.6, 1.2, sstep(0, 0.5, sunDir.y));
  const sy = sunDir.y, warm = sstep(-0.02, 0.45, sy);
  const sc = new THREE.Color().setRGB(1.0, lerp(0.52, 0.95, warm), lerp(0.28, 0.88, warm));
  const day = sstep(-0.06, 0.12, sy);
  sun.color.copy(sc); sun.intensity = 3.4 * day + 0.0;
  if (day < 0.02) { sun.color.setRGB(0.5, 0.6, 0.9); sun.intensity = 0.5; }
  hemi.intensity = (1 - sstep(-0.12, 0.05, sunDir.y)) * 1.4;
  scene.environmentIntensity = lerp(0.12, 0.85, sstep(-0.1, 0.25, sy));
  const night = 1 - sstep(-0.08, 0.1, sy);
  const fogDay = new THREE.Color(0.50, 0.64, 0.82), fogSet = new THREE.Color(0.75, 0.55, 0.42), fogN = new THREE.Color(0.02, 0.03, 0.05);
  const fc = fogN.clone().lerp(fogSet, sstep(-0.1, 0.03, sy)).lerp(fogDay, sstep(0.03, 0.4, sy));
  scene.fog.color.copy(fc);
  const wu = water.material.uniforms; wu.sunDirection.value.copy(sunDir); wu.sunColor.value.copy(sc).multiplyScalar(day * 1.6 + 0.05); wu.uSkyCol.value.copy(fc).multiplyScalar(1.2);
  clouds.material.uniforms.uSunCol.value.copy(sc).multiplyScalar(lerp(0.05, 1.6, day)); clouds.material.uniforms.uAmb.value.copy(fc).multiplyScalar(1.1);
  grass.userData.u.uSun.value.copy(sunDir); grass.userData.u.uSunCol.value.copy(sc).multiplyScalar(day * 0.8);
  if (winMat) winMat.emissiveIntensity = night * 5.0 + (1 - day) * 1.5;
  stars.material.uniforms.uNight.value = night * 0.9; moon.material.uniforms.uNight.value = night;
  renderer.toneMappingExposure = lerp(0.9, 0.5, sstep(-0.05, 0.3, sy));
  if (Math.abs(tod - lastEnvTod) > 0.01) envDirty = true;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); $('todv').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
function updateEnv() {
  if (!envDirty) return; envDirty = false; lastEnvTod = tod;
  const old = envRT; envRT = pmrem.fromScene(skyEnvScene, 0, 1, 10000); scene.environment = envRT.texture; if (old) old.dispose();
}

// ---------------------------------------------------------------- post
let composer, bloom, gradePass, godPass, aoPass, renderScale = 1;
const GODRAY_FRAG = (n) => `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uInt; uniform float uAspect; varying vec2 vUv;
  void main(){
    vec4 base = texture2D(tDiffuse, vUv);
    if (uInt <= 0.0) { gl_FragColor = base; return; }
    vec2 d = uSun - vUv; float dist = length(d * vec2(uAspect, 1.0));
    vec2 stp = d / float(${n}) * 0.92; vec2 uv = vUv + stp * (0.35 * fract(sin(dot(vUv, vec2(12.9898,78.233))) * 43758.5453));
    float decay = 1.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < ${n}; i++) { uv += stp; vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); acc += c * smoothstep(3.0, 9.0, l) * decay; decay *= 0.955; }
    acc *= uInt * (3.0 / float(${n}));
    gl_FragColor = vec4(base.rgb + acc * (1.0 - 0.55 * smoothstep(0.1, 1.4, dist)), base.a); }`;
function resizeComposer() {
  const pr = Math.min(devicePixelRatio, Q.pr) * renderScale; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
}
function buildComposer() {
  const pr = Math.min(devicePixelRatio, Q.pr) * renderScale; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false);
  const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: Q.msaa });
  if (composer) composer.dispose();
  composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  aoPass = null;
  if (Q.ao) {
    // ground-truth AO on opaque geometry only: foliage cards, sky, water and grass live on layer 1 and are skipped in the normal pass
    aoPass = new GTAOPass(scene, camera, innerWidth * pr, innerHeight * pr); aoPass.output = GTAOPass.OUTPUT.Default; aoPass.blendIntensity = 0.95;
    aoPass.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.3, thickness: 1.2, scale: 1.0, samples: Q.aoSamples, distanceFallOff: 1.0, screenSpaceRadius: false });
    aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    const ro = aoPass.renderOverride.bind(aoPass);
    aoPass.renderOverride = (...a) => { const m = camera.layers.mask; camera.layers.mask = 1; ro(...a); camera.layers.mask = m; };
    composer.addPass(aoPass);
  }
  godPass = null;
  if (Q.rays) { godPass = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uInt: { value: 0 }, uAspect: { value: innerWidth / innerHeight } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }', fragmentShader: GODRAY_FRAG(Q.rays) }); composer.addPass(godPass); }
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.55, 0.92); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  if (!Q.msaa) composer.addPass(new SMAAPass(innerWidth * pr, innerHeight * pr));
  gradePass = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){ vec2 c = vUv - 0.5; float r2 = dot(c,c); float ca = 0.004*r2;
        vec3 col = vec3(texture2D(tDiffuse, vUv + c*ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c*ca).b);
        float l = dot(col, vec3(0.2126,0.7152,0.0722)); col = mix(vec3(l), col, 1.1);
        col = mix(col, col*col*(3.0-2.0*col), 0.22);
        col *= mix(vec3(1.0), vec3(1.02,1.0,0.96), smoothstep(0.3,0.9,l));
        col *= 1.0 - r2*0.6;
        col += (hh(vUv*vec2(1920.,1080.) + fract(uTime)*100.0) - 0.5) * 0.014;
        gl_FragColor = vec4(col, 1.0); }` });
  composer.addPass(gradePass);
}
const _sunNdc = new THREE.Vector3(), _camDir = new THREE.Vector3();
function updateGodRays() {
  if (!godPass) return;
  _sunNdc.copy(camera.position).addScaledVector(sunDir, 1000).project(camera); camera.getWorldDirection(_camDir);
  const front = _camDir.dot(sunDir) > 0.05, up = sstep(-0.02, 0.12, sunDir.y);
  godPass.uniforms.uSun.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
  godPass.uniforms.uAspect.value = innerWidth / innerHeight;
  godPass.uniforms.uInt.value = front ? 0.5 * up : 0;
}
function applyQuality(name) {
  Q = QUALITY[name]; scene.fog.density = Q.dist;
  if (grass) setGrassCount();
  if (sun) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (water) { /* reflection resolution fixed at build */ }
  buildComposer();
}

// ---------------------------------------------------------------- player
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, bob: 0, stepPhase: 0 };
const keys = {};
const PLACES = [
  { n: 'East gate', x: 135, z: 2, yaw: -Math.PI / 2 },
  { n: 'Thornwood', x: -268, z: 16, yaw: Math.PI / 2 },
  { n: 'Market square', x: 14, z: 9, yaw: Math.PI * 0.8 },
  { n: 'Mirror Pond', x: POND.x - 34, z: POND.z + 8, yaw: -Math.PI / 2 },
  { n: 'Dock end', x: POND.x - 10, z: POND.z + 4, yaw: -Math.PI / 2 },
];
function teleport(i) { const p = PLACES[i]; player.pos.set(p.x, groundAt(p.x, p.z) + 1.7, p.z); player.yaw = p.yaw; player.pitch = -0.02; player.vel.set(0, 0, 0); }
function groundAt(x, z) {
  let h = heightAt(x, z);
  if (pier && x > pier.x0 - 0.3 && x < pier.x1 && z > pier.z0 && z < pier.z1) h = Math.max(h, pier.y);
  return h;
}
function blocked(x, z) {
  const h = heightAt(x, z), onPier = pier && x > pier.x0 - 0.3 && x < pier.x1 && z > pier.z0 && z < pier.z1;
  if (!onPier && h < -1.2) return true;
  if (Math.hypot(x, z) > 640) return true;
  return false;
}
function collide(p) {
  const r = 0.38;
  for (const o of obbs) { const dx = p.x - o.x, dz = p.z - o.z; if (dx * dx + dz * dz > 400) continue;
    let lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c; const ex = o.hw + r, ez = o.hd + r;
    if (Math.abs(lx) < ex && Math.abs(lz) < ez) { if (ex - Math.abs(lx) < ez - Math.abs(lz)) lx = Math.sign(lx) * ex; else lz = Math.sign(lz) * ez;
      p.x = o.x + lx * o.c + lz * o.s; p.z = o.z - lx * o.s + lz * o.c; } }
  const test = (c) => { const dx = p.x - c[0], dz = p.z - c[1], d = Math.hypot(dx, dz), m = c[2] + r; if (d < m && d > 1e-4) { p.x = c[0] + dx / d * m; p.z = c[1] + dz / d * m; } };
  circles.forEach(test);
  const gx0 = Math.floor(p.x / CG), gz0 = Math.floor(p.z / CG);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = colliders.get((gx0 + a) + ',' + (gz0 + b)); if (l) l.forEach(test); }
  // town wall ring with two gates
  const d = Math.hypot(p.x, p.z), ang = Math.atan2(p.z, p.x);
  const gate = Math.abs(Math.sin(ang)) < 0.045 && Math.abs(Math.abs(p.x) - 118) < 3;
  if (!gate && Math.abs(d - 118) < 1.5 + r) { const t = d < 118 ? 118 - 1.5 - r : 118 + 1.5 + r; p.x *= t / d; p.z *= t / d; }
}

// input
let locked = false, dragging = false, lastX = 0, lastY = 0;
addEventListener('keydown', (e) => { keys[e.code] = true;
  if (/^Digit[1-5]$/.test(e.code)) teleport(+e.code.slice(5) - 1);
  if (e.code === 'KeyM') toggleAudio();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('click', () => { if (started && !locked && !isTouch) canvas.requestPointerLock?.()?.catch?.(() => {}); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => { if (!started) return; if (locked) look(e.movementX, e.movementY); else if (dragging) { look((e.clientX - lastX) * 1.5, (e.clientY - lastY) * 1.5); lastX = e.clientX; lastY = e.clientY; } });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => { dragging = false; });
function look(dx, dy) { player.yaw -= dx * 0.0022; player.pitch = clamp(player.pitch - dy * 0.0022, -1.45, 1.45); }
// gamepad (standard mapping): sticks move/look, A jump, B/LT/RT/L3 run, LB/RB travel, D-pad sun, Y sound, Start pause/resume
const pad = { on: false, mx: 0, my: 0, run: false, jump: false, prev: [] };
function padStick(x, y) { const l = Math.hypot(x, y); if (l < 0.18) return [0, 0]; const k = Math.min(1, (l - 0.18) / 0.82) / l; return [x * k, y * k]; }
function pollPad(dt) {
  const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((g) => g && g.connected);
  pad.on = !!gp; const info = $('padstate'); if (info) info.textContent = gp ? `Gamepad detected: ${String(gp.id || "controller").slice(0, 48)}${gp.mapping === 'standard' ? '' : ' (non-standard layout, buttons may differ)'}` : 'No gamepad detected. Connect one and press any button.';
  if (!gp) { pad.mx = pad.my = 0; pad.run = pad.jump = false; pad.prev = []; return; }
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), hit = (i) => b(i) && !pad.prev[i];
  [pad.mx, pad.my] = padStick(gp.axes[0] || 0, gp.axes[1] || 0);
  const [rx, ry] = padStick(gp.axes[2] || 0, gp.axes[3] || 0), sens = 1300 * dt; // px-equivalent per second, with a response curve for fine aim
  if (started) look(Math.sign(rx) * Math.pow(Math.abs(rx), 1.7) * sens, Math.sign(ry) * Math.pow(Math.abs(ry), 1.7) * sens);
  pad.jump = b(0); pad.run = b(1) || b(10) || (gp.buttons[6] ? gp.buttons[6].value > 0.4 : false) || (gp.buttons[7] ? gp.buttons[7].value > 0.4 : false);
  if (!started) { if ((hit(0) || hit(9)) && !$('go').disabled) $('go').click(); }
  else {
    if (hit(9)) { started = false; $('card').hidden = false; $('go').textContent = 'RESUME'; }
    if (hit(5)) teleport(placeIdx = (placeIdx + 1) % PLACES.length);
    if (hit(4)) teleport(placeIdx = (placeIdx + PLACES.length - 1) % PLACES.length);
    if (hit(3)) toggleAudio();
    if (b(15)) { tod = clamp(tod + dt * 0.05, 0, 0.97); $('tod').value = tod; updateSun(); }
    if (b(14)) { tod = clamp(tod - dt * 0.05, 0, 0.97); $('tod').value = tod; updateSun(); }
  }
  pad.prev = gp.buttons.map((x) => x.pressed);
}

// touch: floating stick on the left half, look on the right half, on-screen jump / run buttons
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const touch = { id: null, sx: 0, sy: 0, mx: 0, my: 0, lid: null, lx: 0, ly: 0, run: false };
const onUI = (el) => el && el.closest && el.closest('button,select,input,label,a,summary,details,#card,#clock');
const stick = $('stick'), knob = $('knob');
function showStick(x, y, on) { stick.style.left = x + 'px'; stick.style.top = y + 'px'; stick.classList.toggle('on', on); knob.style.transform = 'translate(-50%,-50%)'; }
addEventListener('touchstart', (e) => { if (!started) return; for (const t of e.changedTouches) {
  if (onUI(t.target)) continue;
  if (t.clientX < innerWidth * 0.45 && touch.id === null) { touch.id = t.identifier; touch.sx = t.clientX; touch.sy = t.clientY; touch.mx = touch.my = 0; showStick(t.clientX, t.clientY, true); }
  else if (touch.lid === null) { touch.lid = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; } } }, { passive: true });
addEventListener('touchmove', (e) => { if (started) e.preventDefault(); for (const t of e.changedTouches) {
  if (t.identifier === touch.id) { const dx = t.clientX - touch.sx, dy = t.clientY - touch.sy, l = Math.hypot(dx, dy), k = l > 46 ? 46 / l : 1;
    touch.mx = clamp(dx / 46, -1, 1); touch.my = clamp(dy / 46, -1, 1); knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`; }
  if (t.identifier === touch.lid) { look((t.clientX - touch.lx) * 2.4, (t.clientY - touch.ly) * 2.4); touch.lx = t.clientX; touch.ly = t.clientY; } } }, { passive: false });
const touchEnd = (e) => { for (const t of e.changedTouches) { if (t.identifier === touch.id) { touch.id = null; touch.mx = touch.my = 0; stick.classList.remove('on'); } if (t.identifier === touch.lid) touch.lid = null; } };
addEventListener('touchend', touchEnd); addEventListener('touchcancel', touchEnd);
$('bJump').addEventListener('pointerdown', (e) => { e.preventDefault(); keys.Space = true; }); $('bJump').addEventListener('pointerup', () => { keys.Space = false; }); $('bJump').addEventListener('pointercancel', () => { keys.Space = false; });
$('bRun').addEventListener('click', () => { touch.run = !touch.run; $('bRun').classList.toggle('on', touch.run); });
$('bFull').addEventListener('click', () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch {} });
$('bPlace').addEventListener('click', () => { teleport(placeIdx = (placeIdx + 1) % PLACES.length); });
let placeIdx = 2;

function surfaceAt(x, z) {
  if (pier && x > pier.x0 && x < pier.x1 && z > pier.z0 && z < pier.z1) return 'wood';
  const i = clamp(Math.floor((x + HALF) / CELL), 0, N - 1), j = clamp(Math.floor((z + HALF) / CELL), 0, N - 1), k = (j * N + i) * 4;
  if (heightAt(x, z) < 0.1) return 'water';
  if (mask[k + 3] > 0.5) return 'sand';
  if (mask[k + 2] > 0.5) return Math.hypot(x, z) < 124 ? 'stone' : 'dirt';
  return 'grass';
}
function updatePlayer(dt) {
  let fx = 0, fz = 0;
  if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1; if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1;
  fx += touch.mx + pad.mx; fz -= touch.my + pad.my;
  const run = keys.ShiftLeft || keys.ShiftRight || touch.run || pad.run, speed = (run ? 7.5 : 3.4) * (surfaceAt(player.pos.x, player.pos.z) === 'water' ? 0.55 : 1);
  const len = Math.hypot(fx, fz); if (len > 1) { fx /= len; fz /= len; }
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const wx = (-sy * fz + cy * fx) * speed, wz = (-cy * fz - sy * fx) * speed;
  const acc = player.onGround ? 12 : 2;
  player.vel.x += (wx - player.vel.x) * Math.min(1, acc * dt); player.vel.z += (wz - player.vel.z) * Math.min(1, acc * dt);
  if ((keys.Space || pad.jump) && player.onGround) { player.vel.y = 4.6; player.onGround = false; }
  player.vel.y -= 14 * dt;
  const nx = player.pos.x + player.vel.x * dt, nz = player.pos.z + player.vel.z * dt;
  const np = { x: nx, z: nz };
  if (blocked(nx, nz)) { np.x = player.pos.x; np.z = player.pos.z; player.vel.x = player.vel.z = 0; }
  collide(np);
  const gh = groundAt(np.x, np.z), cur = groundAt(player.pos.x, player.pos.z);
  if (gh - cur > 0.9 && gh > cur) { np.x = player.pos.x; np.z = player.pos.z; } // can't climb walls/steps
  player.pos.x = np.x; player.pos.z = np.z;
  const eye = Math.max(groundAt(player.pos.x, player.pos.z), -0.6) + 1.7;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= eye) { if (!player.onGround && player.vel.y < -3) footstep(true); player.pos.y = lerp(player.pos.y, eye, Math.min(1, dt * 18)); if (player.pos.y < eye - 0.3) player.pos.y = eye - 0.3; player.vel.y = 0; player.onGround = true; }
  else if (player.pos.y > eye + 0.05) player.onGround = false;
  const hs = Math.hypot(player.vel.x, player.vel.z);
  if (player.onGround && hs > 0.5) { const prev = player.stepPhase; player.stepPhase += dt * hs * 0.62; if (Math.floor(prev * 2) !== Math.floor(player.stepPhase * 2)) footstep(); }
  const bob = player.onGround ? Math.sin(player.stepPhase * Math.PI * 2) * 0.035 * Math.min(1, hs / 3) : 0;
  camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, Math.sin(player.stepPhase * Math.PI) * 0.003 * Math.min(1, hs / 3), 'YXZ');
}

// ---------------------------------------------------------------- audio (synthesised)
let AC = null, audioOn = false, master, surfGain, windGain, birdT = 0;
function noiseBuf(sec, brown) { const b = AC.createBuffer(1, AC.sampleRate * sec, AC.sampleRate), d = b.getChannelData(0); let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; } return b; }
function initAudio() {
  if (AC) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = AC.createGain(); master.gain.value = 0.7; master.connect(AC.destination);
  const loop = (buf, f, q, type) => { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = AC.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(master); s.start(); return g; };
  windGain = loop(noiseBuf(4, true), 500, 0.5, 'lowpass');
  surfGain = loop(noiseBuf(5, false), 900, 0.4, 'bandpass');
}
function toggleAudio() { initAudio(); if (!AC) return; audioOn = !audioOn; if (audioOn) AC.resume(); master.gain.setTargetAtTime(audioOn ? 0.7 : 0, AC.currentTime, 0.2); }
function footstep(heavy) {
  if (!audioOn || !AC) return; const s = surfaceAt(player.pos.x, player.pos.z);
  const src = AC.createBufferSource(); src.buffer = stepBuf || (stepBuf = noiseBuf(0.25, false));
  const f = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime;
  const cfg = { grass: ['lowpass', 1300, 0.10, 0.08], dirt: ['lowpass', 900, 0.16, 0.07], stone: ['bandpass', 2400, 0.12, 0.035], sand: ['lowpass', 700, 0.16, 0.12], wood: ['bandpass', 600, 0.35, 0.06], water: ['bandpass', 1500, 0.2, 0.15] }[s];
  f.type = cfg[0]; f.frequency.value = cfg[1] * (0.85 + Math.random() * 0.3); g.gain.setValueAtTime(cfg[2] * (heavy ? 2 : 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + cfg[3] * (heavy ? 1.6 : 1));
  src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + 0.3);
}
let stepBuf;
function bird() {
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(), base = 2400 + Math.random() * 1800;
  o.frequency.setValueAtTime(base, t); for (let i = 0; i < 4; i++) { o.frequency.linearRampToValueAtTime(base * (1.3 - (i % 2) * 0.4), t + 0.05 + i * 0.07); }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
}
function updateAudio(dt, t) {
  if (!audioOn || !AC) return;
  const shore = 1 - sstep(8, 70, Math.hypot(player.pos.x - POND.x, player.pos.z - POND.z));
  const swell = 0.55 + 0.45 * Math.sin(t * 0.8) * Math.sin(t * 0.37 + 1);
  surfGain.gain.setTargetAtTime(0.07 * shore * swell, AC.currentTime, 0.3);
  windGain.gain.setTargetAtTime(0.07 + 0.05 * Math.sin(t * 0.21) + sstep(20, 90, player.pos.y) * 0.1, AC.currentTime, 0.5);
  birdT -= dt; const forest = player.pos.x < -140 && sunDir.y > 0; if (birdT < 0) { birdT = 1.5 + Math.random() * 5; if (forest || Math.random() < 0.25) bird(); }
}

// ---------------------------------------------------------------- zones / HUD
let zoneName = '', zoneT = 0;
function zoneOf(p) {
  const d = Math.hypot(p.x, p.z);
  if (d < 120) return ['Haven', 'Walled market town'];
  if (Math.hypot(p.x - POND.x, p.z - POND.z) < 60) return ['Mirror Pond', 'Quiet pond and dock'];
  if (d > 470 || p.x < -430) return ['Greyspine Peaks', 'High ridges'];
  if (p.x < -150) return ['The Thornwood', 'Old forest of oak and pine'];
  return ['Hollow Meadows', 'Farmland between town and wood'];
}
function updateHUD(dt, fps) {
  const [n, sub] = zoneOf(player.pos);
  if (n !== zoneName) { zoneName = n; $('zname').textContent = n; $('zsub').textContent = sub; $('zone').style.opacity = 1; zoneT = 4.5; }
  if (zoneT > 0) { zoneT -= dt; if (zoneT <= 0) $('zone').style.opacity = 0.0; }
  $('stats').textContent = `${pad.on ? '\u{1F3AE} ' : ''}${fps.toFixed(0)} fps · ${$('quality').value}${renderScale < 0.99 ? ' · ' + Math.round(renderScale * 100) + '%' : ''}`;
}

// ---------------------------------------------------------------- loop
let started = false, last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, statT = 0;
const _snap = new THREE.Vector3();
let lowN = 0, highN = 0;
function adaptScale() { // dynamic resolution: trade pixels for frame rate, recover when there is headroom
  if (document.hidden) return;
  if (fps < 40) { lowN++; highN = 0; } else if (fps > 57) { highN++; lowN = 0; } else { lowN = highN = 0; }
  if (lowN >= 4 && renderScale > 0.55) { renderScale = Math.max(0.55, renderScale - 0.1); resizeComposer(); lowN = 0; }
  else if (highN >= 24 && renderScale < 1) { renderScale = Math.min(1, renderScale + 0.05); resizeComposer(); highN = 0; }
}
function frame(now) { requestAnimationFrame(frame); if (!window.__pause) step(now); }
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
  U.time.value = t;
  if (water) water.material.uniforms.time.value = t * 0.6;
  if (keys.KeyT) { tod = clamp(tod + dt * 0.05); $('tod').value = tod; updateSun(); }
  if (keys.KeyG) { tod = clamp(tod - dt * 0.05); $('tod').value = tod; updateSun(); }
  pollPad(dt);
  if (started) updatePlayer(dt); else { const a = t * 0.03; camera.position.set(150 + Math.cos(a) * 30, groundAt(150, 0) + 14, Math.sin(a) * 30); camera.lookAt(0, 22, -20); }
  updateEnv();
  // shadow camera follows the player, snapped to texels
  const ts = 190 / Q.shadow; _snap.set(Math.round(camera.position.x / ts) * ts, Math.round(camera.position.y / ts) * ts, Math.round(camera.position.z / ts) * ts);
  sun.target.position.copy(_snap); sun.position.copy(_snap).addScaledVector(sunDir.y > -0.05 ? sunDir : _p.copy(sunDir).negate(), 420); sun.target.updateMatrixWorld();
  grass.userData.u.uCam.value.copy(camera.position); grass.userData.u.uPlayer.value.set(player.pos.x, 0, player.pos.z);
  clouds.position.copy(camera.position);
  dust.position.set(Math.floor(camera.position.x / 40) * 40, camera.position.y, Math.floor(camera.position.z / 40) * 40);
  { const p = dust.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.getY(i) + dt * 0.08 * Math.sin(i + t * 0.3); if (y > 20) y = -20; p.setY(i, y); } p.needsUpdate = true; }
  updatePeople(dt); updateGodRays();
  stars.position.copy(camera.position); stars.material.uniforms.uPx.value = renderer.getPixelRatio();
  moon.position.copy(camera.position).addScaledVector(_p.copy(sunDir).negate(), 3400); moon.lookAt(camera.position);
  boats.forEach((b, i) => { b.position.y = 0.12 + Math.sin(t * 1.1 + i) * 0.07; b.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.05; b.rotation.x = Math.sin(t * 0.7 + i) * 0.03; });
  gradePass.uniforms.uTime.value = t;
  renderer.shadowMap.needsUpdate = true;
  composer.render();
  fpsAcc += dt; fpsN++; statT += dt; if (statT > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; statT = 0; if (started) { updateHUD(0, fps); adaptScale(); } }
  if (started) { updateHUD(dt, fps); updateAudio(dt, t); }
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (composer) resizeComposer(); });
$('tod').addEventListener('input', (e) => { tod = +e.target.value; updateSun(); });
$('quality').addEventListener('change', (e) => { try { localStorage.setItem('haven-q', e.target.value); } catch {} applyQuality(e.target.value); });
function defaultQuality() { const small = Math.min(screen.width, screen.height) < 900;
  if (isTouch && small) return (navigator.deviceMemory || 4) >= 6 && (navigator.hardwareConcurrency || 4) >= 8 ? 'medium' : 'low'; return 'high'; }
$('quality').value = defaultQuality();
try { const s = localStorage.getItem('haven-q'); if (s && QUALITY[s]) $('quality').value = s; } catch {}
const hotData = null;

$('go').addEventListener('click', () => {
  started = true; $('card').hidden = true; $('hud').hidden = false;
  if (isTouch) document.body.classList.add('touch'); else canvas.requestPointerLock?.()?.catch?.(() => {});
  initAudio(); if (AC && !audioOn) toggleAudio();
});
document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && started && !locked) { started = false; $('card').hidden = false; $('go').textContent = 'RESUME'; } });
document.addEventListener('visibilitychange', () => { if (AC) { if (document.hidden) AC.suspend(); else if (audioOn) AC.resume(); } });

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    Q = QUALITY[$('quality').value];
    await status('Shaping the land…', 0.05); buildHeights();
    await status('Painting materials…', 0.25); buildTextures();
    await status('Laying roads and shorelines…', 0.45); buildMaskBase();
    await status('Raising Haven…', 0.55); const poles = buildTown(); buildPond();
    await status('Planting the Thornwood…', 0.65); const trees = buildFoliage(); buildRocks();
    finalizeMask();
    await status('Building terrain and water…', 0.8); buildTerrain(); buildTownMeshes(); buildBanners(poles); buildGrass(); buildSky(); buildPeople();
    applyQuality($('quality').value); updateSun();
    if (hotData?.pos) { player.pos.fromArray(hotData.pos); player.yaw = hotData.yaw; tod = hotData.tod; $('tod').value = tod; updateSun(); } else teleport(0);
    await status('Compiling shaders…', 0.92);
    renderer.shadowMap.needsUpdate = true; composer.render();
    await status(`Ready · ${trees.oak + trees.pine} trees, ${obbs.length} buildings, ${(Q.grass / 1000) | 0}k grass blades`, 1);
    $('go').disabled = false; $('go').textContent = 'ENTER';
    window.__ready = true;
    if (hotData?.started) $('go').click();
    requestAnimationFrame(frame);
  } catch (err) { console.error(err); $('status').textContent = 'Could not start: ' + err.message + '. WebGL2 is required.'; window.__err = String(err.stack || err); }
})();
window.__dbg = { groundAt, step: (n) => { for (let i = 0; i < n; i++) step(performance.now()); }, teleport, player, camera, people: () => people, WG, pad, pollPad, setStarted: (v) => { started = v; }, setTod: (v) => { tod = v; $('tod').value = v; updateSun(); }, applyQuality };

// ---------------------------------------------------------------- PWA: install prompt + offline cache
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null; $('install').hidden = true; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !started) { reloaded = true; location.reload(); } });
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

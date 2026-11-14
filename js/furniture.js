// Parametric furniture + room-feature models. All sizes are in inches.
// Local coordinates for every builder: origin at the floor-centre of the footprint,
// x across the width, z across the depth (front faces +z), y up from 0 to h.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let invalidate = () => {};
export const setInvalidate = f => { invalidate = f; };

// ---------- procedural textures ----------
const texCache = {};
function ctex(key, size, draw, srgb) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[key] = t);
}
function speckle(ctx, s, lo, hi, cell) {
  for (let y = 0; y < s; y += cell) for (let x = 0; x < s; x += cell) {
    const v = (lo + Math.random() * (hi - lo)) | 0;
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, cell, cell);
  }
}
export const tex = {
  fabric: () => { const t = ctex('fabric', 256, (c, s) => {
    speckle(c, s, 214, 255, 1);
    c.globalAlpha = 0.10;
    for (let i = 0; i < s; i += 4) { c.fillStyle = i % 8 ? '#fff' : '#555'; c.fillRect(i, 0, 2, s); c.fillRect(0, i, s, 2); }
  }, true); t.repeat.set(5, 5); return t; },
  fabricBump: () => { const t = ctex('fabricB', 256, (c, s) => {
    speckle(c, s, 90, 170, 1);
    for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) { c.fillStyle = ((x + y) / 4) % 2 ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)'; c.fillRect(x, y, 4, 4); }
  }); t.repeat.set(5, 5); return t; },
  carpet: () => ctex('carpet', 256, (c, s) => speckle(c, s, 205, 255, 2), true),
  carpetBump: () => ctex('carpetB', 256, (c, s) => speckle(c, s, 0, 255, 2)),
  wood: () => ctex('wood', 256, (c, s) => {
    c.fillStyle = '#ededed'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 110; i++) {
      c.fillStyle = `rgba(70,45,20,${0.04 + Math.random() * 0.16})`;
      c.fillRect(0, Math.random() * s, s, 1 + Math.random() * 2.5);
    }
  }, true),
  planks: () => ctex('planks', 512, (c, s) => {
    c.fillStyle = '#ececec'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 240; i++) {
      c.fillStyle = `rgba(70,45,20,${0.04 + Math.random() * 0.14})`;
      c.fillRect(0, Math.random() * s, s, 1 + Math.random() * 2);
    }
    c.fillStyle = 'rgba(30,18,8,.55)';
    for (let r = 0; r < 8; r++) {
      c.fillRect(0, r * 64, s, 1.5);
      const off = (r * 173) % s; c.fillRect(off, r * 64, 1.5, 64); c.fillRect((off + 290) % s, r * 64, 1.5, 64);
    }
  }, true),
  brick: () => ctex('brick', 256, (c, s) => {
    speckle(c, s, 232, 250, 2);
    c.fillStyle = 'rgb(196,194,190)';
    for (let r = 0; r < 8; r++) {
      c.fillRect(0, r * 32, s, 3);
      for (let k = 0; k < 4; k++) c.fillRect(k * 64 + (r % 2 ? 32 : 0), r * 32, 3, 32);
    }
  }, true),
  blinds: () => ctex('blinds', 128, (c, s) => {
    for (let y = 0; y < s; y += 8) {
      const g = c.createLinearGradient(0, y, 0, y + 8);
      g.addColorStop(0, '#f4f7ff'); g.addColorStop(0.8, '#cfd9ee'); g.addColorStop(1, '#a9b6d2');
      c.fillStyle = g; c.fillRect(0, y, s, 8);
    }
  }, true),
  skyline: () => ctex('skyline', 256, (c, s) => {
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#3a3d44'); g.addColorStop(1, '#17181b');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s, w = 8 + Math.random() * 16, h = 40 + Math.random() * 90;
      c.fillStyle = '#1d1e22'; c.fillRect(x, 150 - h, w, h);
      c.fillStyle = 'rgba(255,255,240,.8)';
      for (let k = 0; k < 14; k++) c.fillRect(x + Math.random() * w, 150 - Math.random() * h, 1.5, 1.5);
    }
    c.fillStyle = '#c98443'; c.fillRect(60, 150, 136, 50);
    c.fillStyle = '#ffd9a0';
    for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(92 + k * 36, 185, 11, Math.PI, 0); c.fillRect(81 + k * 36, 185, 22, 12); c.fill(); }
    c.fillStyle = '#222'; c.fillRect(0, 200, s, 56);
  }, true),
};
function rep(t, x, y) { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; }

// ---------- materials ----------
function col(c, fallback = '#cccccc') {
  try { return new THREE.Color(/^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback); } catch { return new THREE.Color(fallback); }
}
export function M(color, kind = 'paint', extra = {}) {
  const p = { color: col(color), roughness: 0.82, metalness: 0, envMapIntensity: 0.45 };
  if (kind === 'fabric') Object.assign(p, { roughness: 0.96, map: tex.fabric(), bumpMap: tex.fabricBump(), bumpScale: 1.1, envMapIntensity: 0.2 });
  else if (kind === 'wood') Object.assign(p, { roughness: 0.5, map: tex.wood() });
  else if (kind === 'metal') Object.assign(p, { roughness: 0.35, metalness: 0.85, envMapIntensity: 1 });
  else if (kind === 'plastic') Object.assign(p, { roughness: 0.4 });
  else if (kind === 'gloss') Object.assign(p, { roughness: 0.12, envMapIntensity: 0.9 });
  return new THREE.MeshStandardMaterial(Object.assign(p, extra));
}
function brickM(color, w, h) {
  return M(color, 'paint', { map: rep(tex.brick(), Math.max(1, w / 32), Math.max(1, h / 21)), bumpMap: tex.brick(), bumpScale: 0.4, roughness: 0.9 });
}

function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

function kit(g) {
  const add = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); g.add(me); return me; };
  return {
    add,
    box: (w, h, d, m, x = 0, y = 0, z = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z),
    rbox: (w, h, d, m, x = 0, y = 0, z = 0, r = 1.5, seg = 4) =>
      add(new RoundedBoxGeometry(w, h, d, seg, Math.max(0.05, Math.min(r, w / 2 - 0.02, h / 2 - 0.02, d / 2 - 0.02))), m, x, y + h / 2, z),
    cyl: (rt, rb, h, m, x = 0, y = 0, z = 0, open = false) => add(new THREE.CylinderGeometry(rt, rb, h, 28, 1, open), m, x, y + h / 2, z),
  };
}

// ---------- builders ----------
function sofa(o, g, k) {
  const { w, d, h } = o, p = o.props || {};
  const F = M(o.color, 'fabric'), A = M(o.color2 || '#a65a43', 'fabric'), L = M('#2b211b', 'wood');
  const leg = p.skirt ? 0 : Math.min(2.5, h * 0.07);
  const aw = p.armW || Math.min(12, w * 0.15), ah = Math.min(27, h * 0.66);
  const seatTop = Math.min(19, h * 0.48), baseTop = seatTop - 6;
  const inner = w - 2 * aw, n = p.seats || Math.max(1, Math.round(inner / 30));
  const backT = Math.min(9, d * 0.22);
  k.rbox(w - 1, baseTop - leg, d - 1, F, 0, leg, 0, 1);
  k.rbox(inner, h - baseTop - 5, backT, F, 0, baseTop, -d / 2 + backT / 2 + 0.5, 2);
  for (const s of [-1, 1]) {
    k.rbox(aw, ah - leg - aw * 0.25, d, F, s * (w / 2 - aw / 2), leg, 0, 2);
    const c = k.cyl(aw * 0.55, aw * 0.55, d - 0.5, F, s * (w / 2 - aw / 2), 0, 0);
    c.rotation.x = Math.PI / 2; c.position.y = ah - aw * 0.45;
  }
  const cw = inner / n, sd = d - backT * 1.6 - 1;
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    k.rbox(cw - 0.5, 7, sd, F, x, baseTop - 0.3, d / 2 - sd / 2 - 0.2, 3.1, 6);
    const bc = k.rbox(cw - 0.8, h - seatTop + 0.5, backT + 1.5, F, x, seatTop - 0.5, -d / 2 + backT * 1.5, 4.2, 6);
    bc.rotation.x = -0.14;
  }
  if (leg) for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(1.5, 1, leg, L, sx * (w / 2 - 3.5), 0, sz * (d / 2 - 3.5));
  if (p.pillows) for (const s of [-1, 1]) {
    const pl = k.rbox(19, 19, 7, A, s * (inner / 2 - 9.5), seatTop + 1, -d / 2 + backT * 2.3 + 3, 3.4, 6);
    pl.rotation.set(-0.3, s * -0.25, 0);
  }
}

function ottoman(o, g, k) {
  const { w, d, h } = o, leg = Math.min(2.5, h * 0.15);
  k.rbox(w, h - leg, d, M(o.color, 'fabric'), 0, leg, 0, 2.5);
  const L = M('#2b211b', 'wood');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(2.5, leg, 2.5, L, sx * (w / 2 - 3), 0, sz * (d / 2 - 3));
}

function recliner(o, g, k) {
  const { w, d, h } = o;
  const F = M(o.color, 'fabric'), Wd = M(o.color2 || '#4a3024', 'wood');
  const aw = Math.min(9, w * 0.12), cw = w * 0.15, sw = (w - 2 * aw - cw) / 2, st = Math.min(19, h * 0.47);
  k.rbox(w - 2, 10, d * 0.8, F, 0, 1, -d * 0.05, 1.5);
  for (const s of [-1, 1]) {
    k.rbox(aw, h * 0.6, d * 0.86, F, s * (w / 2 - aw / 2), 1, 0, 3.5);
    const x = s * (cw / 2 + sw / 2);
    k.rbox(sw - 0.5, st - 3, d * 0.7, F, x, 3, d * 0.12, 4);
    const b = k.rbox(sw - 0.5, h - st + 3, 9, F, x, st - 4, -d / 2 + 8, 4); b.rotation.x = -0.2;
    const hd = k.rbox(sw - 2, h * 0.26, 5, F, x, h * 0.72, -d / 2 + 9.5, 2.5); hd.rotation.x = -0.2;
  }
  k.rbox(cw, st + 2, d * 0.66, F, 0, 1, d * 0.1, 2);
  k.rbox(cw - 1, 1.2, d * 0.4, Wd, 0, st + 3, d * 0.18, 0.5);
  const cb = k.rbox(cw, h * 0.78 - st, 8, F, 0, st, -d / 2 + 8, 3); cb.rotation.x = -0.2;
}

function reclinerChair(o, g, k) {
  const { w, d, h } = o, F = M(o.color, 'fabric');
  const aw = Math.min(8, w * 0.2), sw = w - 2 * aw, st = Math.min(19, h * 0.47);
  k.rbox(w - 2, 10, d * 0.8, F, 0, 1, -d * 0.05, 1.5);
  for (const s of [-1, 1]) k.rbox(aw, h * 0.6, d * 0.86, F, s * (w / 2 - aw / 2), 1, 0, 3.5);
  k.rbox(sw - 0.5, st - 3, d * 0.7, F, 0, 3, d * 0.12, 4);
  const b = k.rbox(sw - 0.5, h - st + 3, 9, F, 0, st - 4, -d / 2 + 8, 4); b.rotation.x = -0.2;
  const hd = k.rbox(sw - 2, h * 0.26, 5, F, 0, h * 0.72, -d / 2 + 9.5, 2.5); hd.rotation.x = -0.2;
}

function table(o, g, k) {
  const { w, d, h } = o, p = o.props || {};
  const kind = p.finish === 'plastic' ? 'plastic' : 'wood';
  const T = M(o.color, kind), L = M(o.color2 || o.color, kind);
  const t = Math.min(1.6, h * 0.1), lg = p.legW || Math.max(1, Math.min(2.4, w * 0.07));
  k.rbox(w, t, d, T, 0, h - t, 0, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(lg, h - t, lg, L, sx * (w / 2 - lg), 0, sz * (d / 2 - lg));
  if (p.shelf) k.box(w - lg * 2, 1, d - lg * 2, L, 0, h * 0.25, 0);
}

function lamp(o, g, k) {
  const { w, h } = o, B = M(o.color, 'gloss');
  const br = w * 0.28, bh = h * 0.42;
  const body = k.add(new THREE.SphereGeometry(br, 24, 16), B, 0, bh * 0.5, 0); body.scale.y = bh / (br * 2);
  k.cyl(br * 0.25, br * 0.5, h * 0.2, B, 0, bh * 0.85, 0);
  k.cyl(0.4, 0.4, h * 0.25, M('#888888', 'metal'), 0, h * 0.5, 0);
  const sh = h * 0.36;
  k.cyl(w * 0.46, w * 0.5, sh, M(o.color2 || '#f5f1e6', 'paint', { side: THREE.DoubleSide, emissive: col('#ffe9c4'), emissiveIntensity: 0.9 }), 0, h - sh, 0, true);
  const l = new THREE.PointLight(0xffdcae, 0.45, 150, 0); l.position.y = h - sh / 2; g.add(l);
}

function chest(o, g, k) {
  const { w, d, h } = o, W = M(o.color, 'wood');
  k.box(w, h - 4.5, d, W, 0, 3, 0);
  k.rbox(w + 1.5, 1.5, d + 1.5, W, 0, h - 1.5, 0, 0.4);
  k.box(w + 1, 3, d + 1, W, 0, 0, 0);
}

function bins(o, g, k) {
  const { w, d, h } = o, F = M(o.color2 || '#c9a36b', 'wood'), B = M(o.color, 'plastic');
  for (const s of [-1, 1]) k.box(0.8, h, d, F, s * (w / 2 - 0.4), 0, 0);
  const rows = 3, rh = h / rows;
  for (let r = 0; r < rows; r++) for (const s of [-1, 1]) {
    const b = k.rbox(w / 2 - 1.6, rh * 0.5, d * 0.9, B, s * (w / 4 - 0.3), r * rh + 2, 0, 0.8);
    b.rotation.x = 0.35;
  }
}

function plant(o, g, k) {
  const { w, h } = o, P = M(o.color2 || '#f1efe9', 'paint'), G = M(o.color, 'paint', { roughness: 0.6 });
  const ph = h * 0.3;
  k.cyl(w * 0.3, w * 0.24, ph, P, 0, 0, 0);
  const r = rng(o.id);
  for (let i = 0; i < 11; i++) {
    const len = h * (0.55 + r() * 0.3), leaf = new THREE.Mesh(new THREE.ConeGeometry(1.3, len, 5), G);
    leaf.scale.z = 0.3;
    const piv = new THREE.Group(); piv.position.y = ph - 1; piv.rotation.y = (i / 11) * Math.PI * 2 + r();
    leaf.position.y = len / 2; const tilt = new THREE.Group(); tilt.rotation.z = 0.15 + r() * 0.75;
    tilt.add(leaf); piv.add(tilt); g.add(piv);
  }
}

function basket(o, g, k) {
  const { w, h } = o, B = M(o.color, 'fabric', { side: THREE.DoubleSide });
  k.cyl(w / 2, w * 0.4, h, B, 0, 0, 0, true);
  k.cyl(w * 0.4, w * 0.4, 0.6, B, 0, 0, 0);
}

function rug(o, g, k) { k.box(o.w, Math.max(0.3, o.h), o.d, M(o.color, 'fabric', { map: rep(tex.carpet(), o.w / 24, o.d / 24) })); }

function tv(o, g, k) {
  const { w, d, h } = o;
  k.rbox(w, h, d, M(o.color || '#111111', 'plastic'), 0, 0, 0, 0.4);
  const s = k.add(new THREE.PlaneGeometry(w - 1, h - 1), M('#06070a', 'gloss'), 0, h / 2, d / 2 + 0.05);
  s.userData.noShadow = true;
}

function picture(o, g, k) {
  const { w, d, h } = o, p = o.props || {};
  k.box(w, h, d, M(o.color, 'metal', { metalness: 0.4, roughness: 0.5 }));
  let map = tex.skyline();
  if (p.img) { map = new THREE.TextureLoader().load(p.img, () => invalidate()); map.colorSpace = THREE.SRGBColorSpace; }
  k.add(new THREE.PlaneGeometry(w - 2.5, h - 2.5), new THREE.MeshStandardMaterial({ map, roughness: 0.6 }), 0, h / 2, d / 2 + 0.06);
}

function wallart(o, g, k) {
  const { w, d, h } = o, p = o.props || {};
  if (p.shape === 'shuttle') {
    const piv = new THREE.Group(); piv.position.set(-w * 0.3, h * 0.35, d / 2); piv.rotation.z = 0.35; g.add(piv);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(w * 0.85, 24, -0.42, 0.84), M(o.color, 'paint', { side: THREE.DoubleSide }));
    const cork = new THREE.Mesh(new THREE.CircleGeometry(h * 0.2, 24), M(o.color2 || '#d9692b', 'paint', { side: THREE.DoubleSide }));
    cork.position.z = 0.1; cork.scale.x = 1.2; piv.add(fan, cork);
    // invisible slab so it is easy to tap
    const hit = k.box(w, h, d, new THREE.MeshBasicMaterial({ visible: false })); hit.userData.noShadow = true;
  } else k.rbox(w, h, d, M(o.color, 'paint'), 0, 0, 0, 0.5);
}

function builtin(o, g, k) {
  const { w, d, h } = o, P = M(o.color, 'paint', { roughness: 0.6 }), H = M('#9a9a9a', 'metal');
  const lh = Math.min(32, h * 0.34), ud = Math.max(6, d - 5), uz = -d / 2 + ud / 2;
  k.box(w, lh, d, P);
  k.box(w, 1.5, d + 0.6, P, 0, lh, 0.3);
  const nd = Math.max(1, Math.round(w / 18)), dw = w / nd;
  for (let i = 0; i < nd; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    k.rbox(dw - 2.5, lh - 6, 0.7, P, x, 3.5, d / 2 + 0.3, 0.3);
    k.box(0.5, 4, 0.8, H, x + (i % 2 ? -1 : 1) * (dw / 2 - 3), lh - 9, d / 2 + 1);
  }
  const top = lh + 1.5, uh = h - top;
  k.box(w, uh, 0.8, P, 0, top, -d / 2 + 0.4);
  for (const s of [-1, 1]) k.box(2, uh, ud, P, s * (w / 2 - 1), top, uz);
  k.box(w, 7, ud, P, 0, h - 7, uz);
  const shelves = 3, gap = (uh - 7) / (shelves + 1), r = rng(o.id);
  const tones = ['#3b3b3b', '#8c7a63', '#c9c2b4', '#51606b', '#7a8b6d', '#b88b5a', '#e8e3d8'];
  for (let i = 0; i <= shelves; i++) {
    const y = top + gap * i;
    if (i) k.box(w - 4, 1.2, ud, P, 0, y, uz);
    const by = i ? y + 1.2 : top;
    for (let j = 0; j < 2; j++) {
      const x = (j ? 1 : -1) * (w / 4 - 2) + (r() - 0.5) * 6, c = M(tones[(r() * tones.length) | 0], 'paint');
      const kind = r();
      if (kind < 0.35) { const s = k.add(new THREE.SphereGeometry(2.4, 16, 12), c, x, by + 2.4, uz); s.scale.y = 1 + r() * 0.6; s.position.y = by + 2.4 * s.scale.y; }
      else if (kind < 0.7) k.box(6 + r() * 4, 7 + r() * 3, 1.2, c, x, by, uz - 1).rotation.x = -0.12;
      else for (let b = 0; b < 3; b++) k.box(1.4, 7 + r() * 2, 5.5, M(tones[(r() * tones.length) | 0], 'paint'), x + b * 1.6, by, uz);
    }
  }
}

function fireplace(o, g, k) {
  const { w, d, h } = o, bd = d / 2, bz = -d / 2 + bd / 2, face = -d / 2 + bd;
  k.box(w, h, bd, brickM(o.color, w, h), 0, 0, bz);
  k.box(w, 12, d, brickM(o.color, w, 12));
  const fw = w * 0.52;
  k.box(fw + 5, 31, 0.8, M('#17171a', 'metal', { metalness: 0.5, roughness: 0.6 }), 0, 12, face + 0.4);
  k.box(fw, 26, 0.5, M('#050505', 'paint'), 0, 12, face + 0.9);
  k.rbox(w * 0.86, 5.5, 8, M(o.color2 || '#b98a55', 'wood'), 0, 46, face + 4, 0.4);
}

function windowB(o, g, k) {
  const { w, d, h } = o, F = M(o.color, 'paint', { roughness: 0.5 });
  const b = k.add(new THREE.PlaneGeometry(w - 4, h - 4),
    new THREE.MeshStandardMaterial({ map: rep(tex.blinds(), 1, (h - 4) / 16), emissive: col('#dfe8ff'), emissiveMap: rep(tex.blinds(), 1, (h - 4) / 16), emissiveIntensity: 1.0, roughness: 0.8 }),
    0, h / 2, d / 2 - 0.6);
  const wl = new THREE.RectAreaLight(0xe6eeff, 2.2, w - 6, h - 6); wl.position.set(0, h / 2, d / 2 + 0.5); wl.rotation.y = Math.PI; g.add(wl);
  b.userData.noShadow = true;
  k.box(w, 3.5, d, F, 0, 0, 0); k.box(w, 3.5, d, F, 0, h - 3.5, 0);
  for (const s of [-1, 1]) { k.box(3.5, h, d, F, s * (w / 2 - 1.75), 0, 0); k.box(2, h, d, F, s * w * 0.22, 0, 0); }
}

function door(o, g, k) {
  const { w, d, h } = o, P = M(o.color, 'paint', { roughness: 0.55 });
  k.box(w, h, 1.6, P, 0, 0, 0);
  for (const s of [-1, 1]) k.box(3, h + 3, d, P, s * (w / 2 + 1.5), 0, 0);
  k.box(w + 6, 3, d, P, 0, h, 0);
  k.box(4.5, 0.8, 1.2, M('#9a9a9a', 'metal'), w / 2 - 5, 36, 1.6);
}

function platform(o, g, k) {
  const { w, d, h } = o, p = o.props || {};
  k.box(w, 1.5, d, M(o.color, 'wood', { map: rep(tex.planks(), w / 48, d / 40), roughness: 0.42 }), 0, h - 1.5, 0);
  k.box(w, h - 1.5, d, M(o.color2 || '#f1efea', 'paint'));
  if (p.ceilH) {
    const c = k.add(new THREE.PlaneGeometry(w, d), M('#f2f1ee', 'paint', { emissive: col('#f2f1ee'), emissiveIntensity: 0.5 }), 0, p.ceilH - (o.y || 0), 0);
    c.rotation.x = Math.PI / 2; c.userData.noShadow = true; c.userData.nopick = true;
  }
}

function steps(o, g, k) {
  const { w, d, h } = o, n = (o.props && o.props.n) || 2, rh = h / n, td = d / n;
  const Wd = M(o.color, 'wood', { roughness: 0.42 }), P = M(o.color2 || '#f1efea', 'paint');
  for (let i = 0; i < n; i++) {
    const z = d / 2 - td * (i + 0.5);
    k.box(w, rh * (i + 1) - 1.5, td, P, 0, 0, z);
    k.box(w, 1.5, td + 1, Wd, 0, rh * (i + 1) - 1.5, z + 0.5);
  }
}

function railing(o, g, k) {
  const { w, d, h } = o, Wd = M(o.color, 'wood'), Bk = M(o.color2 || '#1c1c1c', 'metal', { metalness: 0.6, roughness: 0.5 });
  const posts = w > 60 ? [-1, 0, 1] : [-1, 1];
  for (const s of posts) k.box(3.5, h, 3.5, Wd, s * (w / 2 - 1.75), 0, 0);
  k.box(w, 2, Math.max(4, d), Wd, 0, h, 0);
  for (let i = 1; i <= 6; i++) { const b = k.cyl(0.4, 0.4, w - 3, Bk, 0, 0, 0); b.rotation.z = Math.PI / 2; b.position.y = (h / 7) * i; }
}

function ceilingfan(o, g, k) {
  const { w, h } = o, Mt = M(o.color2 || '#b9b5ae', 'metal'), Wd = M(o.color, 'wood');
  k.cyl(3, 4, 2.5, Mt, 0, h - 2.5, 0);
  k.cyl(5.5, 4, 5, Mt, 0, h - 8, 0);
  for (let i = 0; i < 5; i++) {
    const piv = new THREE.Group(); piv.rotation.y = (i / 5) * Math.PI * 2; piv.position.y = h - 6; g.add(piv);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 6, 0.35, 5), Wd); bl.position.x = w / 4 + 2.5; bl.rotation.x = 0.12; piv.add(bl);
  }
  const G = M('#fff6e0', 'paint', { emissive: col('#ffe2b0'), emissiveIntensity: 1.6 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2, s = k.add(new THREE.SphereGeometry(2.3, 16, 12), G, Math.cos(a) * 3.8, 2.3, Math.sin(a) * 3.8);
    s.userData.noShadow = true;
  }
  const l = new THREE.PointLight(0xffe2b8, 0.55, 0, 0); l.position.y = 2; g.add(l);
}

function wall(o, g, k) { k.box(o.w, o.h, o.d, M(o.color, 'paint', { roughness: 0.9 })); }

function boxB(o, g, k) {
  const { w, d, h } = o, p = o.props || {};
  k.rbox(w, h, d, M(o.color, p.finish || 'paint'), 0, 0, 0, 0.6);
  if (p.img) {
    const map = new THREE.TextureLoader().load(p.img, t => {
      const ar = t.image.width / t.image.height, far = w / h;
      pl.scale.set(ar > far ? 1 : ar / far, ar > far ? far / ar : 1, 1); invalidate();
    });
    map.colorSpace = THREE.SRGBColorSpace;
    const pl = k.add(new THREE.PlaneGeometry(w - 1, h - 1), new THREE.MeshStandardMaterial({ map, roughness: 0.7 }), 0, h / 2, d / 2 + 0.08);
  }
}

function cabinet(o, g, k) {
  const { w, d, h } = o, Wd = M(o.color, 'wood');
  k.box(w, h - 3, d, Wd, 0, 3, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(2, 3, 2, Wd, sx * (w / 2 - 2), 0, sz * (d / 2 - 2));
  const nd = Math.max(1, Math.round(w / 20)), dw = w / nd;
  for (let i = 0; i < nd; i++) k.rbox(dw - 1.5, h - 6, 0.6, Wd, -w / 2 + dw * (i + 0.5), 4.5, d / 2 + 0.25, 0.3);
}

function pillow(o, g, k) { k.rbox(o.w, o.h, o.d, M(o.color, 'fabric'), 0, 0, 0, Math.min(o.w, o.h, o.d) / 2.2); }

// ---------- registry ----------
// group: 'furniture' shows under Basic furniture, 'feature' under Room features.
export const TYPES = {
  sofa:      { label: 'Sofa', build: sofa, group: 'furniture', accent: true, def: { w: 86, d: 38, h: 34, color: '#cfc8ba' } },
  loveseat:  { label: 'Loveseat', build: sofa, group: 'furniture', accent: true, def: { w: 64, d: 38, h: 34, color: '#cfc8ba' } },
  chair:     { label: 'Armchair', build: sofa, group: 'furniture', accent: true, def: { w: 38, d: 36, h: 34, color: '#cfc8ba', props: { seats: 1, armW: 7 } } },
  recliner:  { label: 'Reclining loveseat', build: recliner, group: 'furniture', accent: true, def: { w: 76, d: 38, h: 40, color: '#b9b8b2' } },
  reclinerchair: { label: 'Recliner chair', build: reclinerChair, group: 'furniture', def: { w: 36, d: 38, h: 40, color: '#b9b8b2' } },
  ottoman:   { label: 'Ottoman', build: ottoman, group: 'furniture', def: { w: 36, d: 24, h: 18, color: '#cfc8ba' } },
  table:     { label: 'Table', build: table, group: 'furniture', accent: true, def: { w: 44, d: 24, h: 18, color: '#6b4a33' } },
  cabinet:   { label: 'Cabinet / console', build: cabinet, group: 'furniture', def: { w: 60, d: 18, h: 30, color: '#6b4a33' } },
  chest:     { label: 'Chest', build: chest, group: 'furniture', def: { w: 44, d: 20, h: 22, color: '#5a3324' } },
  lamp:      { label: 'Table lamp', build: lamp, group: 'furniture', accent: true, def: { w: 16, d: 16, h: 28, color: '#5f6f73' } },
  rug:       { label: 'Rug', build: rug, group: 'furniture', def: { w: 96, d: 60, h: 0.5, color: '#8f8a80' } },
  pillow:    { label: 'Pillow', build: pillow, group: 'furniture', def: { w: 18, d: 6, h: 18, color: '#a65a43', y: 20 } },
  plant:     { label: 'Plant', build: plant, group: 'furniture', accent: true, def: { w: 16, d: 16, h: 26, color: '#4f7a45' } },
  basket:    { label: 'Basket', build: basket, group: 'furniture', def: { w: 18, d: 18, h: 15, color: '#9a8a70' } },
  bins:      { label: 'Toy organizer', build: bins, group: 'furniture', accent: true, def: { w: 34, d: 12, h: 30, color: '#f4f4f2' } },
  tv:        { label: 'TV', build: tv, group: 'furniture', def: { w: 57, d: 2, h: 33, color: '#111111', y: 40 } },
  picture:   { label: 'Framed picture', build: picture, group: 'furniture', def: { w: 36, d: 1.5, h: 24, color: '#b8b8b8', y: 50 } },
  wallart:   { label: 'Wall art', build: wallart, group: 'furniture', accent: true, def: { w: 30, d: 1, h: 30, color: '#e9e4d8', y: 50 } },
  box:       { label: 'Box (anything else)', build: boxB, group: 'furniture', def: { w: 24, d: 24, h: 24, color: '#b7b2a8' } },
  ceilingfan:{ label: 'Ceiling fan', build: ceilingfan, group: 'feature', accent: true, def: { w: 52, d: 52, h: 14, color: '#5a3d2b', hang: true } },
  window:    { label: 'Window', build: windowB, group: 'feature', def: { w: 60, d: 3, h: 48, color: '#f5f4f0', y: 30 } },
  door:      { label: 'Door', build: door, group: 'feature', def: { w: 32, d: 4, h: 80, color: '#f1f0ec' } },
  builtin:   { label: 'Built-in shelves', build: builtin, group: 'feature', def: { w: 42, d: 16, h: 96, color: '#f4f3ef' } },
  fireplace: { label: 'Fireplace', build: fireplace, group: 'feature', accent: true, def: { w: 72, d: 40, h: 96, color: '#f3f1ec', color2: '#b98a55' } },
  wall:      { label: 'Wall panel', build: wall, group: 'feature', def: { w: 96, d: 4, h: 96, color: '#d9d7d3' } },
  platform:  { label: 'Raised floor', build: platform, group: 'feature', accent: true, def: { w: 96, d: 96, h: 14, color: '#5b4030' } },
  steps:     { label: 'Steps', build: steps, group: 'feature', accent: true, def: { w: 40, d: 22, h: 14, color: '#5b4030' } },
  railing:   { label: 'Railing', build: railing, group: 'feature', accent: true, def: { w: 72, d: 4, h: 36, color: '#5e4634' } },
};

// ---------- real 3D models (GLB files made from a product photo) ----------
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/'));
const glbReady = new Map(), glbLoading = new Map(); // address -> loaded scene / load in progress
const WHITE = new THREE.Color('#ffffff');

// Put a loaded model into the object's group, stretched to the stated width x depth x height.
function fitModel(o, g, scene) {
  const p = o.props || {};
  const piv = new THREE.Group(); piv.rotation.y = THREE.MathUtils.degToRad(p.yaw || 0); piv.add(scene.clone(true));
  piv.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(piv), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  piv.position.set(-c.x, -box.min.y, -c.z); holder.add(piv);
  holder.scale.set(o.w / Math.max(size.x, 1e-6), o.h / Math.max(size.y, 1e-6), o.d / Math.max(size.z, 1e-6));
  const tint = col(o.color, '#ffffff');
  holder.traverse(m => {
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    if (!tint.equals(WHITE)) { m.material = m.material.clone(); m.material.color.multiply(tint); }
    m.material.envMapIntensity = 0.5;
  });
  g.add(holder);
}

function model3d(o, g, k) {
  const url = o.props && o.props.glb;
  if (url && glbReady.has(url)) return fitModel(o, g, glbReady.get(url));
  // see-through stand-in while the model downloads
  const ph = k.rbox(o.w, o.h, o.d, new THREE.MeshStandardMaterial({ color: 0xd9d4ca, transparent: true, opacity: 0.45, roughness: 0.9 }), 0, 0, 0, 1.5);
  ph.userData.noShadow = true;
  if (!url) return;
  if (!glbLoading.has(url)) glbLoading.set(url, gltfLoader.loadAsync(url).then(gl => { glbReady.set(url, gl.scene); return gl.scene; }));
  glbLoading.get(url)
    .then(scene => { if (!g.parent) return; g.remove(ph); ph.geometry.dispose(); fitModel(o, g, scene); invalidate(); })
    .catch(e => { console.warn('3D model failed to load', e); glbLoading.delete(url); ph.material.opacity = 0.85; invalidate(); });
}
TYPES.model = { label: '3D model', build: model3d, group: 'hidden', def: { w: 36, d: 36, h: 36, color: '#ffffff' } };

const SPARSE = new Set(['bins', 'plant', 'railing', 'lamp']);
export function buildObject(o) {
  const g = new THREE.Group();
  const T = TYPES[o.type] || TYPES.box;
  try { T.build(o, g, kit(g)); } catch (e) { console.error('build failed', o, e); }
  if (SPARSE.has(o.type)) { // see-through shapes get an invisible box so they are easy to tap
    const hit = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = o.h / 2; hit.userData.noShadow = true; g.add(hit);
  }
  const flat = o.type === 'window' || o.type === 'ceilingfan'; // windows let light through; a fan shadow across the room just looks wrong
  g.traverse(m => { if (m.isMesh) { m.castShadow = !flat && !m.userData.noShadow; m.receiveShadow = true; } });
  g.position.set(o.x, o.y || 0, o.z);
  g.rotation.y = THREE.MathUtils.degToRad(o.rot || 0);
  g.userData.id = o.id;
  return g;
}

export function disposeObject(g) {
  g.traverse(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  });
}

// 3D viewer: room shell, lighting, drone + top-down cameras, tap/drag interaction,
// grouping and collisions. World units are inches.
// x: west->east (0..w), z: north->south (0..l), y: up.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildObject, disposeObject, M, tex, setInvalidate } from './furniture.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const SIDES = { n: 'North wall', e: 'East wall', s: 'South wall', w: 'West wall' };
// Small things that sit ON other furniture: they never block anything, and they settle onto
// whatever is underneath them (a seat, a table top, the hearth) as they are dragged.
const RESTS = new Set(['pillow', 'lamp', 'plant', 'basket']);
const NOCOLLIDE = new Set(['rug', 'window', 'door', ...RESTS]);
const NOSURFACE = new Set(['wall', 'ceilingfan', 'rug', 'window', 'door', 'picture', 'wallart', 'tv', 'railing']);
function surfaceOf(o) {
  const y = o.y || 0;
  if (NOSURFACE.has(o.type) || RESTS.has(o.type)) return null;
  if (o.type === 'sofa' || o.type === 'loveseat' || o.type === 'chair') return y + Math.min(19, o.h * 0.48);
  if (o.type === 'recliner') return y + Math.min(19, o.h * 0.47);
  if (o.type === 'fireplace') return y + 12;
  if (o.type === 'builtin') return y + Math.min(32, o.h * 0.34) + 1.5;
  return y + o.h;
}

// Oriented footprint + vertical span of an object placed at (x, z).
function obb(o, x = o.x, z = o.z) {
  const r = ((o.rot || 0) * Math.PI) / 180;
  return { x, z, hw: Math.max(0.1, o.w / 2 - 0.5), hd: Math.max(0.1, o.d / 2 - 0.5), c: Math.cos(r), s: Math.sin(r), y0: o.y || 0, y1: (o.y || 0) + o.h };
}
function overlap(a, b) {
  if (a.y0 >= b.y1 - 0.5 || b.y0 >= a.y1 - 0.5) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  const rad = (r, ax, az) => r.hw * Math.abs(ax * r.c - az * r.s) + r.hd * Math.abs(ax * r.s + az * r.c);
  for (const r of [a, b]) for (const [ax, az] of [[r.c, -r.s], [r.s, r.c]])
    if (Math.abs(dx * ax + dz * az) > rad(a, ax, az) + rad(b, ax, az)) return false;
  return true;
}

export class Viewer {
  constructor(canvas, cb) {
    this.canvas = canvas; this.cb = cb;
    const touch = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    RectAreaLightUniformsLib.init();
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#cdd6e0');
    this.scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    this.persp = new THREE.PerspectiveCamera(70, 1, 1, 4000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    this.ortho.up.set(0, 0, -1);
    this.roomGroup = new THREE.Group(); this.objGroup = new THREE.Group();
    this.scene.add(this.roomGroup, this.objGroup);
    this.hemi = new THREE.HemisphereLight(0xfdfbf7, 0x9a9388, 0.7);
    this.sun = new THREE.DirectionalLight(0xfff1df, 1.5);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(touch ? 2048 : 4096, touch ? 2048 : 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.meshes = new Map(); this.sel = null; this.helpers = []; this.grouping = false;
    this.view = 'fly'; this.fly = { x: 0, y: 60, z: 0, yaw: 0, pitch: 0 }; this.top = { cx: 0, cz: 0, span: 300 };
    this.move = { f: 0, s: 0, u: 0 }; this.keys = new Set();
    this.ray = new THREE.Raycaster(); this.dirty = true; this.data = null;
    const saved = localStorage.getItem('lrw:ao'); this.ao = saved == null ? !touch : saved === '1';
    setInvalidate(() => (this.dirty = true));
    this._bind();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();
    let last = performance.now();
    const loop = t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; this._tick(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  get cam() { return this.view === 'fly' ? this.persp : this.ortho; }
  get ext() { return (this.data && this.data.room.ext) || 0; }
  get collide() { return this.data && this.data.collide !== false; }

  // ---------- loading ----------
  load(data, keepCam) {
    this.data = data; this.sel = null;
    for (const g of this.meshes.values()) { this.objGroup.remove(g); disposeObject(g); }
    this.meshes.clear();
    for (const o of data.objects) this._addMesh(o);
    this.rebuildRoom();
    if (!keepCam) this.resetCamera();
    this._helper(); this.dirty = true;
  }

  resetCamera() {
    const { w, l, h } = this.data.room, e = this.ext;
    this.fly = e ? { x: w * 0.7, y: Math.min(h - 14, 80), z: l + 14, yaw: 0.2, pitch: -0.3 }
                 : { x: w / 2, y: Math.min(h - 14, 64), z: l - 8, yaw: 0, pitch: -0.2 };
    const a = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.top = { cx: w / 2, cz: (l + e) / 2, span: Math.max(l + e + 50, (w + 50) / a) };
    this.dirty = true;
  }

  rebuildRoom() {
    const R = this.data.room, { w, l, h } = R, G = this.roomGroup;
    G.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
    G.clear();
    const wood = R.floorType === 'wood';
    const fm = wood
      ? M(R.floorColor, 'wood', { map: this._rep(tex.planks(), w / 48, l / 40), roughness: 0.38, envMapIntensity: 0.7 })
      : M(R.floorColor, 'paint', { map: this._rep(tex.carpet(), w / 14, l / 14), bumpMap: this._rep(tex.carpetBump(), w / 14, l / 14), bumpScale: 1.2, roughness: 1, envMapIntensity: 0.15 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, l), fm);
    floor.rotation.x = -Math.PI / 2; floor.position.set(w / 2, 0, l / 2); floor.receiveShadow = true; floor.userData.floor = true; G.add(floor);
    const cc = R.ceilingColor || '#f2f1ee';
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, l), M(cc, 'paint', { roughness: 0.95, emissive: new THREE.Color(cc), emissiveIntensity: 0.45 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(w / 2, h, l / 2); G.add(ceil);
    const trim = M('#f3f2ee', 'paint', { roughness: 0.55 });
    for (const side of ['n', 'e', 's', 'w']) {
      const cfg = (R.walls && R.walls[side]) || {}, len = side === 'n' || side === 's' ? w : l;
      const gaps = (cfg.gaps || []).slice().sort((a, b) => a[0] - b[0]);
      let at = 0; const segs = [];
      for (const [a, b] of gaps) { if (a > at) segs.push([at, a]); at = Math.max(at, b); }
      if (at < len) segs.push([at, len]);
      for (const [a, b] of segs) {
        const mat = M(cfg.color || R.wallColor, 'paint', { roughness: 0.93, envMapIntensity: 0.2, bumpMap: this._rep(tex.carpetBump(), (b - a) / 30, h / 30), bumpScale: 0.12 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, h), mat), c = (a + b) / 2;
        if (side === 'n') m.position.set(c, h / 2, 0);
        if (side === 's') { m.position.set(c, h / 2, l); m.rotation.y = Math.PI; }
        if (side === 'w') { m.position.set(0, h / 2, c); m.rotation.y = Math.PI / 2; }
        if (side === 'e') { m.position.set(w, h / 2, c); m.rotation.y = -Math.PI / 2; }
        m.receiveShadow = true; m.userData.side = side;
        const bb = new THREE.Mesh(new THREE.BoxGeometry(b - a, 4.5, 0.7), trim); bb.position.set(0, -h / 2 + 2.25, 0.35); bb.castShadow = true; m.add(bb);
        G.add(m);
      }
    }
    // Key light comes from the side of the room with the largest window (east by default).
    const win = this.data.objects.filter(o => o.type === 'window').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const fromWest = win && win.x < w / 2;
    const span = Math.max(w, l + this.ext) * 0.85, sc = this.sun.shadow.camera;
    this.sun.position.set(fromWest ? -w * 0.6 : w * 1.6, h * 2.1, win ? win.z - l * 0.1 : l * 0.3);
    this.sun.target.position.set(w * 0.5, 0, l * 0.5);
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 10; sc.far = h * 8; sc.updateProjectionMatrix();
    this.dirty = true;
  }
  _rep(t, x, y) { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; }

  _addMesh(o) { const g = buildObject(o); g.visible = !(this.view === 'top' && o.type === 'ceilingfan'); this.meshes.set(o.id, g); this.objGroup.add(g); return g; }
  addObject(o) { this._addMesh(o); this.dirty = true; }
  removeObject(id) {
    const g = this.meshes.get(id); if (g) { this.objGroup.remove(g); disposeObject(g); this.meshes.delete(id); }
    if (this.sel && this.sel.id === id) this.sel = null;
    this._helper(); this.dirty = true;
  }
  refreshObject(o) {
    const g = this.meshes.get(o.id); if (g) { this.objGroup.remove(g); disposeObject(g); }
    this._addMesh(o); this._helper(); this.dirty = true;
  }
  _obj(id) { return this.data.objects.find(o => o.id === id); }
  // An object plus everything grouped with it.
  members(o) { return o && o.group ? this.data.objects.filter(x => x.group === o.group) : o ? [o] : []; }

  select(sel) { this.sel = sel; this._helper(); this.dirty = true; }
  _helper() {
    for (const h of this.helpers) { this.scene.remove(h); h.geometry.dispose(); }
    this.helpers = [];
    const prim = this.sel && this.sel.kind === 'obj' && this._obj(this.sel.id);
    for (const o of this.members(prim)) {
      const g = this.meshes.get(o.id); if (!g) continue;
      const h = new THREE.BoxHelper(g, o.id === prim.id ? 0xff6a1f : 0xffb37a); this.helpers.push(h); this.scene.add(h);
    }
  }

  setView(v) {
    this.view = v;
    for (const [id, g] of this.meshes) { const o = this._obj(id); g.visible = !(v === 'top' && o && o.type === 'ceilingfan'); }
    this._resize(); this.dirty = true;
  }
  setAO(on) { this.ao = on; localStorage.setItem('lrw:ao', on ? '1' : '0'); this.dirty = true; }

  // A sensible spot to drop a new object: in front of the drone, or the middle of the top view.
  spawnPoint() {
    const { w, l } = this.data.room;
    if (this.view === 'top') return { x: clamp(this.top.cx, 20, w - 20), z: clamp(this.top.cz, 20, l - 20), rot: 0 };
    const f = this.fly, dist = 80;
    return {
      x: clamp(f.x - Math.sin(f.yaw) * dist, 20, w - 20), z: clamp(f.z - Math.cos(f.yaw) * dist, 20, l - 20),
      rot: ((Math.round(THREE.MathUtils.radToDeg(f.yaw) / 90) * 90) % 360 + 360) % 360,
    };
  }

  // Picture of the current view without selection outlines.
  snapshot() {
    for (const h of this.helpers) h.visible = false;
    this._render();
    const url = this.canvas.toDataURL('image/jpeg', 0.93);
    for (const h of this.helpers) h.visible = true;
    this.dirty = true; return url;
  }

  // ---------- camera + frame ----------
  _resize() {
    const p = this.canvas.parentElement, W = p.clientWidth, H = p.clientHeight; if (!W || !H) return;
    this.renderer.setSize(W, H, false);
    if (this.comp) this.comp.setSize(W, H);
    this.persp.aspect = W / H; this.persp.fov = W < H ? 78 : 66; this.persp.updateProjectionMatrix();
    this.dirty = true;
  }
  _composer() {
    if (this.comp !== undefined) return this.comp;
    try {
      const r = this.renderer, s = r.getSize(new THREE.Vector2());
      const c = new EffectComposer(r, new THREE.WebGLRenderTarget(s.x, s.y, { samples: 4, type: THREE.HalfFloatType }));
      c.setPixelRatio(r.getPixelRatio()); c.setSize(s.x, s.y);
      this.rp = new RenderPass(this.scene, this.persp); c.addPass(this.rp);
      this.gt = new GTAOPass(this.scene, this.persp, s.x, s.y);
      this.gt.updateGtaoMaterial({ radius: 16, distanceExponent: 1.4, thickness: 6, scale: 1.25, samples: 16 });
      c.addPass(this.gt); c.addPass(new OutputPass());
      this.comp = c;
    } catch (e) { console.warn('Soft shading unavailable', e); this.comp = null; }
    return this.comp;
  }
  _tick(dt) {
    if (!this.data) return;
    const k = this.keys, m = this.move;
    const f = m.f + (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const s = m.s + (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const u = m.u + (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    if (f || s || u) {
      const sp = 85 * dt;
      if (this.view === 'fly') {
        const F = this.fly, sy = Math.sin(F.yaw), cy = Math.cos(F.yaw);
        F.x += (-sy * f + cy * s) * sp; F.z += (-cy * f - sy * s) * sp; F.y += u * sp * 0.7;
      } else { this.top.cx += s * sp * 1.5; this.top.cz -= f * sp * 1.5; this.top.span = clamp(this.top.span * (1 - u * dt), 40, 1200); }
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false; this._render();
  }
  _render() {
    const { w, l, h } = this.data.room, e = this.ext;
    if (this.view === 'fly') {
      const F = this.fly;
      F.x = clamp(F.x, 3, w - 3); F.z = clamp(F.z, 3, l + e - 3); F.y = clamp(F.y, 5, h - 3); F.pitch = clamp(F.pitch, -1.5, 1.5);
      this.persp.position.set(F.x, F.y, F.z); this.persp.rotation.set(F.pitch, F.yaw, 0, 'YXZ');
    } else {
      const T = this.top, a = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), O = this.ortho;
      T.span = clamp(T.span, 40, 1200); T.cx = clamp(T.cx, -50, w + 50); T.cz = clamp(T.cz, -50, l + e + 50);
      O.left = (-T.span * a) / 2; O.right = (T.span * a) / 2; O.top = T.span / 2; O.bottom = -T.span / 2;
      O.position.set(T.cx, 1500, T.cz); O.lookAt(T.cx, 0, T.cz); O.updateProjectionMatrix();
    }
    for (const hp of this.helpers) hp.update();
    if (this.view === 'fly' && this.ao && this._composer()) this.comp.render();
    else this.renderer.render(this.scene, this.cam);
  }
  _dolly(amt) {
    if (this.view === 'fly') {
      const F = this.fly, cp = Math.cos(F.pitch);
      F.x += -Math.sin(F.yaw) * cp * amt; F.y += Math.sin(F.pitch) * amt; F.z += -Math.cos(F.yaw) * cp * amt;
    } else this.top.span *= Math.exp(-amt * 0.004);
    this.dirty = true;
  }
  _pan(dx, dy) {
    if (this.view === 'fly') {
      const F = this.fly, k = 0.25;
      F.x -= Math.cos(F.yaw) * dx * k; F.z += Math.sin(F.yaw) * dx * k; F.y += dy * k;
    } else { const k = this.top.span / this.canvas.clientHeight; this.top.cx -= dx * k; this.top.cz -= dy * k; }
    this.dirty = true;
  }

  // ---------- picking ----------
  _setRay(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    this.cam.updateMatrixWorld(); this.objGroup.updateMatrixWorld(); // picking must see items where they are now, even before the next frame is drawn
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.cam);
  }
  _pick(cx, cy) {
    this._setRay(cx, cy);
    let best = null;
    for (const hit of this.ray.intersectObjects(this.objGroup.children, true)) {
      if (hit.object.userData.nopick || !hit.object.isMesh) continue;
      let n = hit.object; while (n && !n.userData.id) n = n.parent;
      if (n && n.visible) { best = { kind: 'obj', id: n.userData.id, dist: hit.distance }; break; }
    }
    const wh = this.ray.intersectObjects(this.roomGroup.children, false).find(h => h.object.userData.side); // walls are single-sided
    if (wh && (!best || wh.distance < best.dist)) best = { kind: 'wall', side: wh.object.userData.side, dist: wh.distance };
    return best;
  }
  _floorPt(cx, cy, y) {
    this._setRay(cx, cy);
    const pt = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), pt) ? pt : null;
  }

  // ---------- collisions ----------
  // Height of the surface under (x, z) that a small item should sit on; 0 means the floor.
  _restY(o, x, z) {
    let best = 0;
    for (const t of this.data.objects) {
      const s = t.id === o.id ? null : surfaceOf(t); if (s == null) continue;
      const r = ((t.rot || 0) * Math.PI) / 180, dx = x - t.x, dz = z - t.z;
      const lx = dx * Math.cos(r) - dz * Math.sin(r), lz = dx * Math.sin(r) + dz * Math.cos(r);
      if (Math.abs(lx) <= t.w / 2 && Math.abs(lz) <= t.d / 2 && s > best && s + o.h <= this.data.room.h) best = s;
    }
    return Math.round(best * 10) / 10;
  }
  _inRoom(o, x, z) {
    const b = obb(o, x, z), ex = b.hw * Math.abs(b.c) + b.hd * Math.abs(b.s), ez = b.hw * Math.abs(b.s) + b.hd * Math.abs(b.c);
    const { w, l } = this.data.room;
    return x - ex >= -1 && x + ex <= w + 1 && z - ez >= -1 && z + ez <= l + this.ext + 1;
  }
  // What the moving items may bump into. Anything already overlapping at the start is ignored,
  // so items can always be pulled apart.
  _collideCtx(items) {
    const ids = new Set(items.map(i => i.o.id));
    const others = this.data.objects.filter(o => !ids.has(o.id) && !NOCOLLIDE.has(o.type)).map(o => ({ id: o.id, b: obb(o) }));
    const ignore = new Set(), free = new Set();
    for (const { o } of items) {
      if (!this._inRoom(o, o.x, o.z)) free.add(o.id);
      const a = obb(o); for (const t of others) if (overlap(a, t.b)) ignore.add(o.id + '|' + t.id);
    }
    return { others, ignore, free };
  }
  _blocked(g, dx, dz) {
    for (const it of g.items) {
      const o = it.o, x = it.x + dx, z = it.z + dz;
      if (!g.ctx.free.has(o.id) && !this._inRoom(o, x, z)) return true;
      if (NOCOLLIDE.has(o.type)) continue;
      const a = obb(o, x, z);
      for (const t of g.ctx.others) if (!g.ctx.ignore.has(o.id + '|' + t.id) && overlap(a, t.b)) return true;
    }
    return false;
  }

  // ---------- input ----------
  _pinch() {
    const [a, b] = [...this.ptrs.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  _bind() {
    const c = this.canvas, P = (this.ptrs = new Map());
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      try { c.setPointerCapture(e.pointerId); } catch {}
      P.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (P.size === 1) {
        const g = (this.g = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'look', sx: e.clientX, sy: e.clientY, tap: true });
        g.hit = this._pick(e.clientX, e.clientY);
        const s = this.sel;
        if (g.mode === 'look' && !this.grouping && g.hit && g.hit.kind === 'obj' && s && s.kind === 'obj') {
          const prim = this._obj(s.id), mem = this.members(prim), grabbed = mem.find(m => m.id === g.hit.id);
          const pt = grabbed && !mem.some(m => m.locked) && this._floorPt(e.clientX, e.clientY, grabbed.y || 0);
          if (pt) {
            g.mode = 'drag'; g.o = prim; g.planeY = grabbed.y || 0; g.start = pt; g.last = { dx: 0, dz: 0 };
            g.items = mem.map(o => ({ o, x: o.x, z: o.z })); g.ctx = this._collideCtx(g.items);
          }
        }
      } else if (P.size === 2) {
        if (this.g && this.g.moved) this.cb.onDragEnd && this.cb.onDragEnd(this.g.o); // finish a drag interrupted by a second finger
        this.g = Object.assign({ mode: 'pinch' }, this._pinch());
      }
    });
    c.addEventListener('pointermove', e => {
      const p = P.get(e.pointerId), g = this.g; if (!p || !g) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (g.mode === 'pinch') {
        if (P.size < 2) return;
        const s = this._pinch();
        this._dolly((s.dist - g.dist) * 0.6); this._pan(s.cx - g.cx, s.cy - g.cy);
        g.dist = s.dist; g.cx = s.cx; g.cy = s.cy; return;
      }
      if (g.tap && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6) g.tap = false;
      if (g.tap) return;
      if (g.mode === 'drag') {
        const pt = this._floorPt(e.clientX, e.clientY, g.planeY); if (!pt) return;
        const { w, l } = this.data.room, first = g.items.find(i => i.o.id === g.o.id) || g.items[0];
        // keep the grabbed item's centre inside the room either way
        let mx = clamp(Math.round(first.x + pt.x - g.start.x), 0, w) - first.x, mz = clamp(Math.round(first.z + pt.z - g.start.z), 0, l + this.ext) - first.z;
        let d = { dx: mx, dz: mz };
        if (this.collide) {
          // walk toward the pointer in small steps so nothing can hop over an obstacle; slide along x or z when one is free
          let cur = g.last; const sx = cur.dx, sz = cur.dz, n = Math.max(1, Math.ceil(Math.max(Math.abs(mx - sx), Math.abs(mz - sz)) / 3));
          for (let i = 1; i <= n; i++) {
            const tx = Math.round(sx + ((mx - sx) * i) / n), tz = Math.round(sz + ((mz - sz) * i) / n);
            if (!this._blocked(g, tx, tz)) cur = { dx: tx, dz: tz };
            else if (tx !== cur.dx && !this._blocked(g, tx, cur.dz)) cur = { dx: tx, dz: cur.dz };
            else if (tz !== cur.dz && !this._blocked(g, cur.dx, tz)) cur = { dx: cur.dx, dz: tz };
            else break;
          }
          d = cur;
        }
        g.last = d;
        for (const it of g.items) {
          it.o.x = it.x + d.dx; it.o.z = it.z + d.dz;
          if (g.items.length === 1 && RESTS.has(it.o.type)) it.o.y = this._restY(it.o, it.o.x, it.o.z);
          const m = this.meshes.get(it.o.id); if (m) m.position.set(it.o.x, it.o.y || 0, it.o.z);
        }
        g.moved = true; this.dirty = true; this.cb.onDrag && this.cb.onDrag(g.o);
      } else if (g.mode === 'look' && this.view === 'fly') {
        this.fly.yaw += dx * 0.0045; this.fly.pitch += dy * 0.0045; this.dirty = true;
      } else if (g.mode !== 'none') this._pan(dx, dy);
    });
    const up = e => {
      P.delete(e.pointerId);
      const g = this.g; if (!g) return;
      if (g.mode === 'pinch') { this.g = P.size ? { mode: 'none' } : null; return; }
      if (g.tap && e.type === 'pointerup' && g.mode !== 'none') {
        const h = g.hit;
        if (this.grouping) { if (h && h.kind === 'obj') this.cb.onGroupTap && this.cb.onGroupTap(h.id); }
        else {
          this.select(h ? (h.kind === 'obj' ? { kind: 'obj', id: h.id } : { kind: 'wall', side: h.side }) : null);
          this.cb.onSelect && this.cb.onSelect(this.sel);
        }
      }
      if (g.moved) this.cb.onDragEnd && this.cb.onDragEnd(g.o);
      if (!P.size) this.g = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this._dolly(-e.deltaY * 0.25); }, { passive: false });
    const typing = () => /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    window.addEventListener('keydown', e => { if (!typing() && !e.ctrlKey && !e.metaKey) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }
}

import { Viewer, SIDES } from './scene.js';
import { TYPES } from './furniture.js';
import { store } from './store.js';
import { sampleScene, seedCatalog, emptyRoom, PAINTS, FLOORS, uid } from './data.js';

// ---------- tiny DOM helpers ----------
const $ = id => document.getElementById(id);
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v; else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
const clone = o => JSON.parse(JSON.stringify(o));
const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const ftin = i => `${Math.floor(i / 12)}′ ${Math.round(i % 12)}″`;
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
const narrow = () => window.innerWidth < 820;

// ---------- state ----------
let scene = null, roomId = null, catalog = [], sel = null, tab = 'library', history = [], saveT = null;
const viewer = new Viewer($('c'), {
  onSelect(s) { sel = s; renderSel(); if ($('panel').classList.contains('open')) { if (s) tab = 'selected'; renderPanel(); } },
  onDragEnd() { commit(); },
  onGroupTap(id) { groupTap(id); },
});
window.viewer = viewer; // handy for debugging from the browser console
const cur = () => (sel && sel.kind === 'obj' ? scene.objects.find(o => o.id === sel.id) : null);

function commit() {
  history.push(JSON.stringify(scene)); if (history.length > 40) history.shift();
  scheduleSave();
}
function scheduleSave() {
  $('saveState').textContent = 'Saving…'; clearTimeout(saveT);
  saveT = setTimeout(flushSave, 600);
}
async function flushSave() {
  clearTimeout(saveT); saveT = null;
  if (!scene || !roomId) return;
  try { await store.saveRoom(roomId, scene); $('saveState').textContent = 'Saved'; }
  catch (e) { $('saveState').textContent = 'Not saved'; toast(store.mode === 'online' ? 'Could not save. ' + e.message : 'Could not save: storage is full.'); }
}
function undo() {
  if (history.length < 2) return toast('Nothing to undo');
  history.pop(); scene = JSON.parse(history[history.length - 1]);
  viewer.load(scene, true); sel = null; refreshAll(); scheduleSave();
}
function refreshAll() { grouping = viewer.grouping = false; $('roomName').textContent = scene.name; renderSel(); renderPanel(); renderTools(); }

async function openRoom(id) {
  if (saveT) await flushSave();
  const s = await store.loadRoom(id); if (!s) return toast('That room could not be opened.');
  scene = s; roomId = id; history = [JSON.stringify(scene)]; sel = null;
  viewer.load(scene); $('saveState').textContent = 'Saved'; refreshAll();
}
async function createRoom(s) { const id = uid(); await store.saveRoom(id, s); await openRoom(id); }

// ---------- object actions ----------
function select(s) { sel = s; viewer.select(s); renderSel(); }
function place(base) {
  const T = TYPES[base.type] || TYPES.box, d = T.def, sp = viewer.spawnPoint();
  const h = base.h || d.h;
  const o = {
    id: uid(), type: TYPES[base.type] ? base.type : 'box', name: base.name || T.label, x: Math.round(sp.x), z: Math.round(sp.z), rot: sp.rot,
    y: base.y != null ? base.y : d.hang ? scene.room.h - h : d.y || 0,
    w: base.w || d.w, d: base.d || d.d, h, color: base.color || d.color, color2: base.color2 || d.color2,
    props: clone(base.props || d.props || {}),
  };
  for (const k of ['colors', 'link', 'price']) if (base[k]) o[k] = clone(base[k]);
  if (base.img && (o.type === 'box' || o.type === 'picture')) o.props.img = base.img;
  scene.objects.push(o); viewer.addObject(o); select({ kind: 'obj', id: o.id }); commit();
  if (narrow()) closePanel(); else { tab = 'selected'; renderPanel(); }
  toast('Added. Drag the highlighted item into place.');
}
function group() { return viewer.members(cur()); }
function tidyGroups() {
  const n = {}; for (const o of scene.objects) if (o.group) n[o.group] = (n[o.group] || 0) + 1;
  for (const o of scene.objects) if (o.group && n[o.group] < 2) delete o.group;
}
function removeSel() {
  const mem = group(); if (!mem.length) return;
  const ids = new Set(mem.map(o => o.id));
  scene.objects = scene.objects.filter(x => !ids.has(x.id)); viewer.data = scene;
  for (const id of ids) viewer.removeObject(id);
  sel = null; viewer.select(null); commit(); renderSel(); renderPanel();
  if (mem.length > 1) toast(`Deleted ${mem.length} grouped items. Undo brings them back.`);
}
function dupSel() {
  const o = cur(), mem = group(); if (!o) return;
  const gid = mem.length > 1 ? uid() : null; let pick = null;
  for (const m of mem) {
    const c = clone(m); c.id = uid(); c.x = m.x + 14; c.z = m.z + 14; c.locked = false;
    if (gid) c.group = gid; else delete c.group;
    scene.objects.push(c); viewer.addObject(c); if (m.id === o.id) pick = c.id;
  }
  select({ kind: 'obj', id: pick }); commit(); renderPanel();
}
function rotateSel(deg) {
  const mem = group(); if (!mem.length) return;
  // a group turns as one piece around its middle
  const cx = mem.reduce((s, m) => s + m.x, 0) / mem.length, cz = mem.reduce((s, m) => s + m.z, 0) / mem.length;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (const m of mem) {
    const dx = m.x - cx, dz = m.z - cz;
    m.x = cx + dx * c + dz * s; m.z = cz - dx * s + dz * c; // not rounded, so a group keeps its shape over many turns
    m.rot = (((m.rot || 0) + deg) % 360 + 360) % 360; viewer.refreshObject(m);
  }
  commit();
  if (tab === 'selected' && $('panel').classList.contains('open')) renderPanel();
}
function toggleLock() { const o = cur(), v = !o.locked; for (const m of group()) m.locked = v; commit(); renderSel(); renderPanel(); }

// ---------- grouping ----------
let grouping = false;
function setGrouping(on) {
  if (on && !cur()) return;
  grouping = viewer.grouping = on;
  if (!on) { tidyGroups(); viewer.select(sel); commit(); }
  if (on && narrow()) closePanel();
  renderSel(); renderPanel();
}
function groupTap(id) {
  const o = cur(), other = scene.objects.find(x => x.id === id); if (!o || !other || other.id === o.id) return;
  if (o.group && other.group === o.group) delete other.group;
  else { if (!o.group) o.group = uid(); other.group = o.group; }
  viewer.select(sel); renderSel();
}
function ungroup() { for (const m of group()) delete m.group; viewer.select(sel); commit(); renderSel(); renderPanel(); }

// ---------- selection bar + hint ----------
function renderSel() {
  const bar = $('selbar'); bar.innerHTML = '';
  const o = cur();
  if (sel && sel.kind === 'wall') {
    bar.append(el('span', { class: 'nm', text: SIDES[sel.side] }), el('button', { text: 'Change color', onclick: () => openPanel('selected') }));
  } else if (o && grouping) {
    bar.append(el('span', { text: `Grouped: ${group().length}`, style: { padding: '0 8px', fontWeight: 600 } }), el('button', { text: 'Done', class: 'on', onclick: () => setGrouping(false) }));
  } else if (o) {
    const b = (text, fn, cls) => el('button', { text, class: cls, onclick: fn }), n = group().length;
    bar.append(el('span', { class: 'nm', text: n > 1 ? `${o.name} + ${n - 1}` : o.name }),
      b('\u27F2', () => rotateSel(15)), b('\u27F3', () => rotateSel(-15)),
      b('Copy', dupSel), b(o.locked ? 'Unlock' : 'Lock', toggleLock, o.locked ? 'on' : ''),
      b('Group', () => setGrouping(true), n > 1 ? 'on' : ''),
      b('Edit', () => openPanel('selected')), b('Delete', removeSel, 'danger'));
  }
  bar.classList.toggle('show', !!(sel && (o || sel.kind === 'wall')));
  const hint = $('hint'), top = viewer.view === 'top';
  if (o && grouping) hint.textContent = `Tap items to group them with ${o.name}. Tap a grouped item again to remove it. Then tap Done.`;
  else if (o) hint.textContent = o.locked ? `${o.name} is locked in place. Tap Unlock to move it.` : group().length > 1 ? `${group().length} grouped items: drag any of them to move them together.` : `${o.name}: drag it to move it.`;
  else if (sel) hint.textContent = 'Wall selected. Tap Change color.';
  else hint.innerHTML = top
    ? '<span class="touch">Drag to pan · pinch to zoom · tap an item to select it</span><span class="desk">Drag to pan · scroll to zoom · click an item to select it</span>'
    : '<span class="touch">Drag to look · joystick to fly · pinch to move forward · tap an item to select it</span><span class="desk">Drag to look · WASD / joystick to fly · scroll to move forward · click an item to select it</span>';
  hint.classList.remove('hide'); clearTimeout(hintT);
  if (!sel) hintT = setTimeout(() => hint.classList.add('hide'), 7000);
}
let hintT;

// ---------- colour editor (wheel + brightness + purchasable swatches) ----------
function hsv2hex(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function hex2hsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [0, 0, 0.8];
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx ? d / mx : 0, mx];
}
function colorRow(label, get, set, swatches, swatchNote) {
  const S = 190; let [h, s, v] = hex2hsv(get()), open = false;
  const chip = el('i', { class: 'chip' }), hexIn = el('input', { maxLength: 7, spellcheck: false });
  const cv = el('canvas', { width: S, height: S }), ctx = cv.getContext('2d');
  const range = el('input', { type: 'range', min: 5, max: 100, value: v * 100 });
  function draw() {
    const img = ctx.createImageData(S, S), R = S / 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5, r = Math.hypot(dx, dy) / R; if (r > 1) continue;
      const hx = hsv2hex((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1, r, v), n = parseInt(hx.slice(1), 16), i = (y * S + x) * 4;
      img.data[i] = n >> 16; img.data[i + 1] = (n >> 8) & 255; img.data[i + 2] = n & 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const a = h * 2 * Math.PI, px = R + Math.cos(a) * s * R, py = R + Math.sin(a) * s * R;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
  }
  function sync(redraw = true) { const hex = get(); chip.style.background = hex; hexIn.value = hex; range.value = v * 100; if (open && redraw) draw(); }
  function apply(live) { set(hsv2hex(h, s, v), !live); sync(); }
  function fromPtr(e) {
    const r = cv.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    h = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1; s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2)); apply(true);
  }
  let down = false;
  cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); fromPtr(e); });
  cv.addEventListener('pointermove', e => down && fromPtr(e));
  cv.addEventListener('pointerup', () => { down = false; apply(false); });
  range.addEventListener('input', () => { v = range.value / 100; apply(true); });
  range.addEventListener('change', () => apply(false));
  hexIn.addEventListener('change', () => {
    let t = hexIn.value.trim(); if (!t.startsWith('#')) t = '#' + t;
    if (/^#[0-9a-f]{6}$/i.test(t)) { [h, s, v] = hex2hsv(t); apply(false); } else sync();
  });
  const sw = swatches && swatches.length && el('div', {},
    el('label', { text: 'Available to buy' }),
    el('div', { class: 'swatches' }, swatches.map(c => el('button', { title: c.name, onclick: () => { [h, s, v] = hex2hsv(c.hex); set(c.hex.toLowerCase(), true); sync(); } }, el('i', { style: { background: c.hex } }), c.name))),
    swatchNote && el('div', { class: 'note', text: swatchNote }));
  const ed = el('div', { class: 'ced', style: { display: 'none' } }, cv,
    el('label', { text: 'Brightness' }), range, el('label', { text: 'Hex code' }), hexIn, sw);
  const row = el('div', { class: 'crow', onclick: () => { open = !open; ed.style.display = open ? '' : 'none'; if (open) draw(); } }, chip, el('span', { text: label }), el('span', { class: 'fit note', text: open ? '' : 'Change' }));
  sync(false);
  return el('div', {}, row, ed);
}

// ---------- side panel ----------
const TABS = [['selected', 'Selected'], ['library', 'Library'], ['add', 'Add item'], ['room', 'Room'], ['rooms', 'My rooms']];
function openPanel(t) { if (t) tab = t; $('panel').classList.add('open'); renderPanel(); }
function closePanel() { $('panel').classList.remove('open'); }
function renderPanel() {
  if (!scene) return;
  const tabs = $('tabs'); tabs.innerHTML = '';
  for (const [id, label] of TABS) tabs.append(el('button', { text: label, class: tab === id ? 'on' : '', onclick: () => { tab = id; renderPanel(); } }));
  const body = $('panelBody'); body.innerHTML = '';
  body.append(...{ selected: tabSelected, library: tabLibrary, add: tabAdd, room: tabRoom, rooms: tabRooms }[tab]().flat().filter(Boolean));
}
const field = (label, input) => el('div', {}, el('label', { text: label }), input);
function numIn(value, onchange, step = 1) { return el('input', { type: 'number', inputMode: 'decimal', step, value: Math.round(value * 100) / 100, onchange: e => onchange(num(e.target.value, value)) }); }

function tabSelected() {
  if (sel && sel.kind === 'wall') {
    const R = scene.room, side = sel.side;
    const get = () => (R.walls[side] && R.walls[side].color) || R.wallColor;
    return [el('h3', { text: SIDES[side] }),
      colorRow('Wall color', get, (hex, done) => { (R.walls[side] = R.walls[side] || {}).color = hex; viewer.rebuildRoom(); if (done) commit(); }, PAINTS, 'Real paint names; the on-screen color is an approximation.'),
      el('button', { text: 'Use this color on all walls', onclick: () => { R.wallColor = get(); for (const k in R.walls) delete R.walls[k].color; viewer.rebuildRoom(); commit(); toast('Applied to all walls'); } })];
  }
  const o = cur();
  if (!o) return [el('div', { class: 'note', text: 'Nothing selected. Tap a piece of furniture or a wall in the room to edit it here.' })];
  const T = TYPES[o.type] || TYPES.box, upd = () => { viewer.refreshObject(o); };
  const setDim = k => v => { o[k] = Math.max(k === 'y' || k === 'rot' ? -360 : 0.3, v); upd(); commit(); };
  const seat = ['sofa', 'loveseat', 'chair'].includes(o.type);
  return [
    el('h3', { text: T.label }),
    field('Name', el('input', { value: o.name, onchange: e => { o.name = e.target.value || T.label; commit(); renderSel(); } })),
    el('h3', { text: 'Color' }),
    colorRow('Main color', () => o.color, (hex, done) => { o.color = hex; upd(); if (done) commit(); }, o.colors, o.colors && 'Fabric names come from the store listing; on-screen colors are approximate.'),
    T.accent && colorRow(seat ? 'Accent pillows' : 'Second color', () => o.color2 || '#a65a43', (hex, done) => { o.color2 = hex; if (seat) (o.props = o.props || {}).pillows = true; upd(); if (done) commit(); }, o.colors),
    seat && el('button', { text: o.props && o.props.pillows ? 'Remove accent pillows' : 'Add accent pillows', onclick: () => { (o.props = o.props || {}).pillows = !o.props.pillows; upd(); commit(); renderPanel(); } }),
    el('h3', { text: 'Size (inches)' }),
    el('div', { class: 'grid3' }, field('Width', numIn(o.w, setDim('w'))), field('Depth', numIn(o.d, setDim('d'))), field('Height', numIn(o.h, setDim('h')))),
    el('div', { class: 'grid2' }, field('Height off floor', numIn(o.y || 0, setDim('y'))), field('Rotation (°)', numIn(o.rot || 0, setDim('rot'), 5))),
    (o.link || o.price) && el('h3', { text: 'Product' }),
    o.price && el('div', { text: '$' + o.price }),
    o.link && el('a', { class: 'link', href: o.link, target: '_blank', rel: 'noopener', text: 'View product page ↗' }),
    el('h3', { text: 'Group' }),
    group().length > 1
      ? [el('div', { class: 'note', text: 'Moves, turns, copies and deletes together with: ' + group().filter(m => m.id !== o.id).map(m => m.name).join(', ') }),
         el('div', { class: 'row' }, el('button', { text: 'Add or remove items', onclick: () => setGrouping(true) }), el('button', { text: 'Ungroup', onclick: ungroup }))]
      : [el('div', { class: 'note', text: 'Group things that belong together, like a lamp with its table or pillows with a sofa, so they move as one.' }),
         el('button', { text: 'Group with other items', onclick: () => setGrouping(true) })],
    el('h3', { text: 'Actions' }),
    el('div', { class: 'row' },
      el('button', { text: o.locked ? 'Unlock' : 'Lock in place', onclick: toggleLock }),
      el('button', { text: 'Duplicate', onclick: dupSel }), el('button', { text: 'Delete', class: 'danger', onclick: removeSel })),
  ];
}

function tabLibrary() {
  const typeBtn = ([type, T]) => el('button', { onclick: () => place({ type }) }, el('b', { text: T.label }), el('div', { class: 'note', text: `${T.def.w} × ${T.def.d} × ${T.def.h} in` }));
  const by = g => Object.entries(TYPES).filter(([, T]) => T.group === g).map(typeBtn);
  return [
    el('h3', { text: 'Your products' }),
    catalog.length ? catalog.map(it => el('div', { class: 'item' },
      el('div', { class: 'thumb', style: it.img ? { backgroundImage: `url(${it.img})` } : { background: it.color } }),
      el('div', { class: 'meta' }, el('b', { text: it.name }),
        el('span', { text: `${it.w} × ${it.d} × ${it.h} in${it.price ? ' · $' + it.price : ''} ` }),
        it.link && el('a', { class: 'link', href: it.link, target: '_blank', rel: 'noopener', text: 'view', style: { fontSize: '12px' } })),
      el('button', { class: 'primary', text: 'Add', onclick: () => place(it) }),
      el('button', { text: 'Edit', onclick: () => {
        form = Object.assign(blankForm(), { editId: it.id, link: it.link || '', name: it.name, type: TYPES[it.type] ? it.type : 'box', w: it.w, d: it.d, h: it.h, price: it.price || '', img: it.img || null, color: it.color || '#cfc8ba', colors: clone(it.colors || []) });
        tab = 'add'; renderPanel();
      } })))
      : el('div', { class: 'note', text: 'No products yet. Use the Add item tab to add one from a link or a photo.' }),
    el('button', { text: '+ Add a product from a link or photo', onclick: () => { tab = 'add'; renderPanel(); } }),
    el('h3', { text: 'Basic furniture' }), el('div', { class: 'grid2' }, by('furniture')),
    el('h3', { text: 'Room features' }), el('div', { class: 'grid2' }, by('feature')),
  ];
}

// --- add-a-product form ---
let form = null;
const blankForm = () => ({ editId: null, imgBig: null, busy: false, aiNote: '', link: '', name: '', type: 'sofa', w: '', d: '', h: '', price: '', img: null, color: '#cfc8ba', colors: [], cn: '', ch: '#888888' });
const KEYWORDS = [['loveseat', 'loveseat'], ['sofa', 'sofa'], ['couch', 'sofa'], ['sectional', 'sofa'], ['recliner', 'reclinerchair'], ['glider', 'reclinerchair'], ['rocker', 'reclinerchair'], ['ottoman', 'ottoman'], ['armchair', 'chair'], ['chair', 'chair'],
  ['table', 'table'], ['lamp', 'lamp'], ['rug', 'rug'], ['pillow', 'pillow'], ['cabinet', 'cabinet'], ['console', 'cabinet'], ['dresser', 'cabinet'], ['chest', 'chest'], ['basket', 'basket'], ['plant', 'plant'], ['tv', 'tv'], ['art', 'picture'], ['print', 'picture']];
function guessFromLink(url) {
  let slug = '';
  try { const u = new URL(url); slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); } catch { return; }
  const words = slug.replace(/\.(html?|php|aspx)$/i, '').replace(/^pdp-/, '').split(/[-_+]/).filter(w => w && !/^\d{5,}$/.test(w));
  const lower = words.join(' ').toLowerCase();
  if (!form.name && words.length) form.name = words.map(w => (/^(iv|ii|iii|vi|tv)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
  const k = KEYWORDS.find(([w]) => new RegExp(`\\b${w}\\b`).test(lower)); if (k) form.type = k[1];
  const m = /(\d{2,3})[ -]?(inch|in\b|")/.exec(lower); if (m && !form.w) form.w = m[1];
}
function fileToDataURL(file, max = 360, q = 0.8) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const d = x.getImageData(c.width * 0.35, c.height * 0.35, Math.max(1, c.width * 0.3), Math.max(1, c.height * 0.3)).data;
      let r = 0, g = 0, b = 0, n = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const avg = '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
      res({ url: c.toDataURL('image/jpeg', q), avg });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not an image this browser can read.')); };
    img.src = url;
  });
}
function tabAdd() {
  form = form || blankForm(); const f = form;
  const bind = (k, extra = {}) => el('input', Object.assign({ value: f[k], oninput: e => (f[k] = e.target.value) }, extra));
  const T = TYPES[f.type] || TYPES.box;
  return [
    el('h3', { text: f.editId ? 'Edit product' : 'Add a product to your library' }),
    el('div', { class: 'note', text: 'Paste a product link, add a photo, or both. Then confirm the type and measurements.' }),
    field('Product link (optional)', el('input', { value: f.link, placeholder: 'https://…', inputMode: 'url', onchange: e => { f.link = e.target.value.trim(); guessFromLink(f.link); renderPanel(); } })),
    el('div', { class: 'note', text: 'Most stores block apps from reading their pages, so the name is guessed from the link and you enter the size shown on the product page.' }),
    field('Photo (optional)', el('input', { type: 'file', accept: 'image/*', onchange: async e => { const file = e.target.files[0]; if (!file) return; try { const r = await fileToDataURL(file); f.img = r.url; f.color = r.avg; f.imgBig = (await fileToDataURL(file, 1400, 0.85)).url; renderPanel(); } catch (err) { toast(err.message); } } })),
    f.img && el('div', { class: 'photos' }, el('img', { src: f.img, alt: '' })),
    store.mode === 'online' ? [
      el('button', { class: 'primary', style: { width: '100%', marginTop: '12px' }, disabled: !!f.busy, text: f.busy ? 'Reading the product\u2026 (can take a minute)' : '\u2728 Fill in with AI', onclick: async () => {
        if (!f.link && !f.imgBig) return toast('Add a product link or a photo first.');
        f.busy = true; f.aiNote = ''; renderPanel();
        try {
          const r = await store.aiProduct({ link: f.link, name: f.name, images: f.imgBig ? [f.imgBig] : [] });
          if (r.name) f.name = r.name;
          if (TYPES[r.type]) f.type = r.type;
          for (const [k, v] of [['w', r.width_in], ['d', r.depth_in], ['h', r.height_in], ['price', r.price_usd]]) if (v > 0) f[k] = String(v);
          const hex = c => /^#[0-9a-f]{6}$/i.test(c || '');
          if (hex(r.default_color_hex)) f.color = r.default_color_hex.toLowerCase();
          const cols = (r.colors || []).filter(c => c && c.name && hex(c.hex)).map(c => ({ name: String(c.name).slice(0, 40), hex: c.hex.toLowerCase() }));
          if (cols.length) f.colors = cols;
          f.aiNote = [r.notes, r.sources && r.sources.length ? 'Sources: ' + r.sources.join(', ') : ''].filter(Boolean).join(' ');
          toast('Filled in. Please check the numbers before saving.');
        } catch (e) { toast(e.message); }
        f.busy = false; renderPanel();
      } }),
      el('div', { class: 'note', text: f.aiNote || 'AI looks up the product from the link and reads your photo, then fills in the type, size, price and colors. A photo or screenshot that shows the measurements helps most.' }),
    ] : null,
    field('Name', bind('name', { placeholder: 'e.g. Blue velvet armchair' })),
    field('What is it?', el('select', { onchange: e => { f.type = e.target.value; renderPanel(); } }, Object.entries(TYPES).filter(([, t]) => t.group === 'furniture').map(([k, t]) => el('option', { value: k, text: t.label, selected: k === f.type })))),
    el('div', { class: 'grid3' },
      field('Width (in)', bind('w', { type: 'number', inputMode: 'decimal', placeholder: T.def.w })),
      field('Depth (in)', bind('d', { type: 'number', inputMode: 'decimal', placeholder: T.def.d })),
      field('Height (in)', bind('h', { type: 'number', inputMode: 'decimal', placeholder: T.def.h }))),
    field('Price (optional)', bind('price', { type: 'number', inputMode: 'decimal', placeholder: '$' })),
    el('h3', { text: 'Colors' }),
    colorRow('Default color', () => f.color, hex => (f.color = hex)),
    el('label', { text: 'Colors available to buy (optional)' }),
    f.colors.length ? el('div', { class: 'swatches' }, f.colors.map(c => el('button', { title: 'Remove', onclick: () => { f.colors = f.colors.filter(x => x !== c); renderPanel(); } }, el('i', { style: { background: c.hex } }), c.name + ' ✕'))) : null,
    el('div', { class: 'row', style: { marginTop: '8px' } }, bind('cn', { placeholder: 'Color name' }),
      el('input', { type: 'color', class: 'fit', value: f.ch, style: { width: '52px', padding: '2px' }, oninput: e => (f.ch = e.target.value) }),
      el('button', { class: 'fit', text: 'Add', onclick: () => { if (!f.cn.trim()) return toast('Give the color a name first.'); f.colors.push({ name: f.cn.trim(), hex: f.ch }); f.cn = ''; renderPanel(); } })),
    el('div', { style: { height: '14px' } }),
    el('button', { class: 'primary', text: 'Save to library', style: { width: '100%' }, onclick: async () => {
      if (!f.name.trim()) return toast('Please give it a name.');
      const old = f.editId && catalog.find(x => x.id === f.editId), before = clone(catalog);
      const it = { id: old ? old.id : uid(), name: f.name.trim(), type: f.type, w: num(f.w, T.def.w), d: num(f.d, T.def.d), h: num(f.h, T.def.h), color: f.color };
      if (f.link) it.link = f.link; if (f.price) it.price = num(f.price); if (f.img) it.img = f.img; if (f.colors.length) it.colors = f.colors;
      if (old && old.type === f.type) { if (old.props) it.props = old.props; if (old.color2) it.color2 = old.color2; }
      else if (T.def.props) it.props = clone(T.def.props);
      if (old) catalog[catalog.indexOf(old)] = it; else catalog.unshift(it);
      try { await store.saveCatalog(catalog); } catch (e) { catalog = before; return toast('Could not save. ' + (e.message || '')); }
      form = null; tab = 'library'; renderPanel(); toast('Saved. Tap Add to place it in the room.');
    } }),
    f.editId ? el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { text: 'Cancel', onclick: () => { form = null; tab = 'library'; renderPanel(); } }),
      el('button', { class: 'danger', text: 'Remove from library', onclick: async () => {
        if (!confirm(`Remove "${f.name}" from your library?`)) return;
        catalog = catalog.filter(x => x.id !== f.editId);
        try { await store.saveCatalog(catalog); } catch (e) { toast('Could not save. ' + (e.message || '')); }
        form = null; tab = 'library'; renderPanel();
      } })) : null,
  ];
}

function tabRoom() {
  const R = scene.room;
  const setR = k => v => { R[k] = Math.max(24, v); viewer.rebuildRoom(); commit(); renderPanel(); };
  return [
    el('h3', { text: 'Room' }),
    field('Name', el('input', { value: scene.name, onchange: e => { scene.name = e.target.value || 'My room'; $('roomName').textContent = scene.name; commit(); } })),
    el('h3', { text: 'Dimensions (inches)' }),
    el('div', { class: 'grid3' }, field(`Width · ${ftin(R.w)}`, numIn(R.w, setR('w'))), field(`Length · ${ftin(R.l)}`, numIn(R.l, setR('l'))), field(`Ceiling · ${ftin(R.h)}`, numIn(R.h, setR('h')))),
    el('div', { class: 'note', text: 'Measure the real room and correct these if they are off. Furniture keeps its true size.' }),
    el('h3', { text: 'Colors' }),
    colorRow('All walls', () => R.wallColor, (hex, done) => { R.wallColor = hex; for (const k in R.walls) delete R.walls[k].color; viewer.rebuildRoom(); if (done) commit(); }, PAINTS, 'Real paint names; the on-screen color is an approximation. Tap a single wall in the room to color it separately.'),
    colorRow(R.floorType === 'wood' ? 'Wood floor' : 'Carpet', () => R.floorColor, (hex, done) => { R.floorColor = hex; viewer.rebuildRoom(); if (done) commit(); }, FLOORS, 'Generic flooring tones, not tied to a specific product.'),
    field('Floor type', el('select', { onchange: e => { R.floorType = e.target.value; viewer.rebuildRoom(); commit(); renderPanel(); } }, ['carpet', 'wood'].map(t => el('option', { value: t, text: t[0].toUpperCase() + t.slice(1), selected: R.floorType === t })))),
    colorRow('Ceiling', () => R.ceilingColor || '#f2f1ee', (hex, done) => { R.ceilingColor = hex; viewer.rebuildRoom(); if (done) commit(); }),
    el('h3', { text: 'View' }),
    el('button', { text: viewer.ao ? 'Soft shading: on' : 'Soft shading: off', class: viewer.ao ? 'on' : '', onclick: () => { viewer.setAO(!viewer.ao); renderPanel(); } }),
    el('div', { class: 'note', text: 'Soft shading adds realistic contact shadows in the 3D view. Turn it off if the view feels slow on your device.' }),
    el('button', { text: 'Reset camera', onclick: () => { viewer.resetCamera(); if (narrow()) closePanel(); } }),
    scene.refPhotos && scene.refPhotos.length ? [el('h3', { text: 'Reference photos' }), el('div', { class: 'photos' }, scene.refPhotos.map(p => el('img', { src: p, alt: '' })))] : null,
    scene.reference ? el('div', { class: 'note', text: `Reference measurement: ${scene.reference}` }) : null,
  ];
}

let newRoom = null;
function tabRooms() {
  newRoom = newRoom || { name: '', w: '', l: '', h: '96', ref: '', refW: '', photos: [] };
  const n = newRoom, bind = (k, extra = {}) => el('input', Object.assign({ value: n[k], oninput: e => (n[k] = e.target.value) }, extra));
  const out = [
    el('h3', { text: 'Account' }),
    el('div', { class: 'row' }, el('span', { text: 'Signed in as ' + store.user }), el('button', { class: 'fit', text: 'Sign out', onclick: async () => { await flushSave(); await store.signOut(); location.reload(); } })),
    el('h3', { text: 'Saved rooms and arrangements' }), el('div', { id: 'roomList' }, el('div', { class: 'note', text: 'Loading…' })),
    store.browserRooms().length ? [
      el('h3', { text: 'Rooms saved in this browser' }),
      el('div', { class: 'note', text: `This browser still holds ${store.browserRooms().length} room(s) from before accounts moved online. Import them to keep them in your account.` }),
      el('button', { text: 'Import them into my account', onclick: async () => {
        let n = 0, last = null;
        try { for (const s of store.browserRooms()) { last = uid(); await store.saveRoom(last, s); n++; } }
        catch (e) { toast('Import stopped: ' + e.message); }
        if (last) { await openRoom(last); toast(`Imported ${n} room(s).`); }
      } }),
    ] : null,
    el('h3', { text: 'New room' }),
    field('Room name', bind('name', { placeholder: 'e.g. Bedroom' })),
    field('Photos of the room (optional)', el('input', { type: 'file', accept: 'image/*', multiple: true, onchange: async e => {
      for (const file of [...e.target.files].slice(0, 6 - n.photos.length)) { try { n.photos.push((await fileToDataURL(file, 520, 0.7)).url); } catch (err) { toast(err.message); } }
      renderPanel();
    } })),
    n.photos.length ? el('div', { class: 'photos' }, n.photos.map(p => el('img', { src: p, alt: '' }))) : null,
    n.photos.length ? el('div', { class: 'note', text: 'For scale, measure one easy object in the photos (a TV, a table, a doorway) and enter it here.' }) : null,
    n.photos.length ? el('div', { class: 'row' }, field('Reference object', bind('ref', { placeholder: 'e.g. TV' })), field('Its width (in)', bind('refW', { type: 'number', inputMode: 'decimal' }))) : null,
    el('div', { class: 'grid3' }, field('Width (in)', bind('w', { type: 'number', inputMode: 'decimal', placeholder: '168' })), field('Length (in)', bind('l', { type: 'number', inputMode: 'decimal', placeholder: '228' })), field('Ceiling (in)', bind('h', { type: 'number', inputMode: 'decimal' }))),
    el('div', { class: 'note', text: 'Turning photos into a 3D room automatically is not available in this version. Photos are saved with the room as a reference while you add the furniture from the Library.' }),
    el('div', { class: 'row' },
      el('button', { class: 'primary', text: 'Create room', onclick: async () => {
        const s = emptyRoom(n.name.trim() || 'New room', num(n.w, 168), num(n.l, 228), num(n.h, 96));
        s.refPhotos = n.photos; if (n.ref && n.refW) s.reference = `${n.ref} = ${n.refW} in wide`;
        newRoom = null;
        try { await createRoom(s); toast('Room created'); } catch { toast('Could not save: storage is full. Try fewer photos.'); }
      } }),
      el('button', { text: 'Sample living room', onclick: async () => { await createRoom(sampleScene()); toast('Sample room created'); } })),
  ];
  store.listRooms().then(list => {
    const box = $('roomList'); if (!box) return; box.innerHTML = '';
    for (const r of list) box.append(el('div', { class: 'item', style: r.id === roomId ? { borderColor: 'var(--accent)' } : {} },
      el('div', { class: 'meta' }, el('b', { text: r.name }), el('span', { text: (r.id === roomId ? 'Open now · ' : '') + new Date(r.updated).toLocaleString() })),
      r.id !== roomId && el('button', { text: 'Open', onclick: async () => { await openRoom(r.id); if (narrow()) closePanel(); } }),
      el('button', { text: 'Copy', title: 'Save a copy to try another arrangement', onclick: async () => {
        if (r.id === roomId) await flushSave();
        const s = await store.loadRoom(r.id); s.name = r.name + ' (copy)'; await createRoom(s); toast('Copy created and opened');
      } }),
      el('button', { class: 'ghost danger', text: '✕', title: 'Delete', onclick: async () => {
        if (list.length < 2) return toast('This is your only room.');
        if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
        await store.deleteRoom(r.id);
        if (r.id === roomId) { clearTimeout(saveT); saveT = null; roomId = null; await openRoom(list.find(x => x.id !== r.id).id); } else renderPanel();
      } })));
  });
  return out;
}

// ---------- sign in / create account ----------
function renderAuth(mode = 'in') {
  const card = $('authCard'); card.innerHTML = '';
  const u = el('input', { autocomplete: 'username', autocapitalize: 'none', spellcheck: false });
  const p = el('input', { type: 'password', autocomplete: mode === 'in' ? 'current-password' : 'new-password' });
  const k = el('input', { maxLength: 8, autocapitalize: 'characters', spellcheck: false, placeholder: '8 characters' });
  const err = el('div', { class: 'err' });
  const go = async () => {
    err.textContent = '';
    try { if (mode === 'in') await store.signIn(u.value, p.value); else await store.signUp(u.value, p.value, k.value); $('auth').classList.remove('show'); await enter(); }
    catch (e) { err.textContent = e.message; }
  };
  const onKey = e => { if (e.key === 'Enter') go(); };
  [u, p, k].forEach(i => i.addEventListener('keydown', onKey));
  card.append(
    el('h1', { text: 'Room Walkthrough' }),
    el('div', { class: 'note', text: mode === 'in' ? 'Sign in to open your saved rooms.' : 'Create an account with the invite key you were given.' }),
    field('Username', u), field('Password', p), mode === 'up' ? field('Invite key', k) : '', err,
    el('button', { class: 'primary', style: { width: '100%', marginTop: '6px' }, text: mode === 'in' ? 'Sign in' : 'Create account', onclick: go }),
    el('div', { class: 'switch' }, mode === 'in' ? 'Have an invite key? ' : 'Already have an account? ', el('a', { text: mode === 'in' ? 'Create an account' : 'Sign in', onclick: () => renderAuth(mode === 'in' ? 'up' : 'in') })));
  $('auth').classList.add('show');
}

async function enter() {
  catalog = await store.getCatalog();
  if (!catalog) { catalog = seedCatalog(); await store.saveCatalog(catalog); }
  const rooms = await store.listRooms();
  if (rooms.length) await openRoom(rooms[0].id); else await createRoom(sampleScene());
}

// ---------- chrome wiring ----------
$('menuBtn').onclick = () => ($('panel').classList.contains('open') ? closePanel() : openPanel(sel ? 'selected' : tab === 'selected' ? 'library' : tab));
$('closePanel').onclick = closePanel;
$('undoBtn').onclick = undo;
function setView(v) { viewer.setView(v); $('v3d').classList.toggle('on', v === 'fly'); $('vtop').classList.toggle('on', v === 'top'); renderSel(); }
$('v3d').onclick = () => setView('fly'); $('vtop').onclick = () => setView('top');

function renderTools() {
  const on = scene && scene.collide !== false, b = $('collideBtn');
  b.textContent = on ? 'Collisions: on' : 'Collisions: off'; b.classList.toggle('on', on);
}
$('collideBtn').onclick = () => { if (!scene) return; scene.collide = scene.collide === false; commit(); renderTools(); toast(scene.collide ? 'Collisions on: furniture stops at walls and other furniture.' : 'Collisions off: furniture can overlap and pass through things.'); };
$('photoBtn').onclick = () => {
  if (!scene) return;
  const a = el('a', { href: viewer.snapshot(), download: (scene.name || 'room').replace(/[^\w-]+/g, '-') + '-view.jpg' });
  document.body.append(a); a.click(); a.remove(); toast('Picture of this view saved to your downloads.');
};

const stick = $('stick'), knob = stick.firstElementChild;
function stickMove(e) {
  const r = stick.getBoundingClientRect(); let dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
  const m = Math.hypot(dx, dy), max = 34; if (m > max) { dx *= max / m; dy *= max / m; }
  knob.style.transform = `translate(${dx}px,${dy}px)`; viewer.move.s = dx / max; viewer.move.f = -dy / max;
}
stick.addEventListener('pointerdown', e => { stick.setPointerCapture(e.pointerId); stick.dataset.on = 1; stickMove(e); });
stick.addEventListener('pointermove', e => stick.dataset.on && stickMove(e));
const stickEnd = () => { delete stick.dataset.on; knob.style.transform = ''; viewer.move.s = viewer.move.f = 0; };
stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
for (const [id, dir] of [['upBtn', 1], ['downBtn', -1]]) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { b.setPointerCapture(e.pointerId); viewer.move.u = dir; });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => (viewer.move.u = 0));
  b.addEventListener('contextmenu', e => e.preventDefault());
}

window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !scene) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') removeSel();
  else if (e.key.toLowerCase() === 'r') rotateSel(e.shiftKey ? -15 : 15);
  else if (e.key === 'Escape') { if (grouping) setGrouping(false); else if ($('panel').classList.contains('open')) closePanel(); else { select(null); } }
});
window.addEventListener('beforeunload', () => { if (saveT && scene && roomId) store.saveOnExit(roomId, scene); });

(async () => {
  try { if (await store.session()) await enter(); else renderAuth('in'); }
  catch (e) { toast(e.message); renderAuth('in'); }
})();

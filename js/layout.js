// Turns the AI's reading of room photos (walls + items tied to walls) into the app's own room:
// real coordinates in inches, everything kept inside the room.
import { TYPES } from './furniture.js';
import { uid } from './data.js';

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, d, lo, hi) => { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const r1 = v => Math.round(v * 10) / 10;
const FACING = { s: 0, e: 90, n: 180, w: 270 };   // which way the front points -> rotation
const INTO = { n: 0, w: 90, s: 180, e: 270 };     // against a wall, the front points into the room
const FIXED = new Set(['window', 'door', 'builtin', 'fireplace', 'ceilingfan']);
const ALLOWED = new Set(['sofa', 'loveseat', 'chair', 'recliner', 'reclinerchair', 'ottoman', 'table', 'cabinet', 'chest', 'lamp', 'rug',
  'plant', 'basket', 'bins', 'tv', 'picture', 'wallart', 'box', 'ceilingfan', 'window', 'door', 'builtin', 'fireplace']);

// Changes `scene` in place: room size and colors, and a fresh list of objects. Returns how many items were placed.
export function applyLayout(scene, ai) {
  const R = (ai && ai.room) || {}, room = scene.room;
  room.w = Math.round(num(R.width_in, room.w, 60, 1200));
  room.l = Math.round(num(R.length_in, room.l, 60, 1200));
  room.h = Math.round(num(R.ceiling_in, room.h || 96, 72, 240));
  room.ext = 0; room.walls = {};
  if (HEX.test(R.wall_color_hex)) room.wallColor = R.wall_color_hex;
  for (const a of Array.isArray(R.accent_walls) ? R.accent_walls : []) if (a && INTO[a.wall] != null && HEX.test(a.color_hex)) room.walls[a.wall] = { color: a.color_hex };
  if (R.floor_type === 'wood' || R.floor_type === 'carpet') room.floorType = R.floor_type;
  if (HEX.test(R.floor_color_hex)) room.floorColor = R.floor_color_hex;

  const out = [];
  for (const it of (Array.isArray(ai && ai.items) ? ai.items : []).slice(0, 60)) {
    if (!it || typeof it !== 'object') continue;
    const type = ALLOWED.has(it.type) && TYPES[it.type] ? it.type : 'box', def = TYPES[type].def;
    const w = r1(num(it.width_in, def.w, 1, Math.max(room.w, room.l)));
    const d = r1(num(it.depth_in, def.d, 0.5, Math.max(room.w, room.l)));
    const h = r1(num(it.height_in, def.h, 0.5, room.h));
    const wall = type !== 'ceilingfan' && INTO[it.wall] != null ? it.wall : null;
    let x, z, rot;
    if (wall) {
      const len = wall === 'n' || wall === 's' ? room.w : room.l;
      const along = num(it.along_in, len / 2, 0, len), gap = num(it.gap_in, 0, 0, 72);
      rot = INTO[wall];
      if (wall === 'n') { x = along; z = gap + d / 2; }
      else if (wall === 's') { x = along; z = room.l - gap - d / 2; }
      else if (wall === 'w') { x = gap + d / 2; z = along; }
      else { x = room.w - gap - d / 2; z = along; }
    } else {
      x = num(it.x_in, room.w / 2, 0, room.w); z = num(it.z_in, room.l / 2, 0, room.l);
      rot = FACING[it.facing] != null ? FACING[it.facing] : 0;
    }
    // Keep the whole footprint inside the room.
    const side = rot % 180 !== 0, hx = (side ? d : w) / 2, hz = (side ? w : d) / 2;
    x = hx * 2 >= room.w ? room.w / 2 : Math.min(room.w - hx, Math.max(hx, x));
    z = hz * 2 >= room.l ? room.l / 2 : Math.min(room.l - hz, Math.max(hz, z));
    const o = {
      id: uid(), type, name: String(it.name || TYPES[type].label).slice(0, 60), x: Math.round(x), z: Math.round(z), rot,
      y: type === 'ceilingfan' ? room.h - h : r1(num(it.bottom_in, def.y || 0, 0, Math.max(0, room.h - h))),
      w, d, h, color: HEX.test(it.color_hex) ? it.color_hex : def.color, props: JSON.parse(JSON.stringify(def.props || {})),
    };
    if (def.color2) o.color2 = def.color2;
    if (type === 'sofa' && w >= 84) o.props.seats = 3;
    if (FIXED.has(type)) o.locked = true;
    out.push(o);
  }
  scene.objects = out;
  return out.length;
}

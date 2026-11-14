// Accounts + saved rooms. The rest of the app only talks to `store`, which is either the
// online implementation (Supabase) or the local one (this browser), chosen in config.js.
import { BACKEND, SUPABASE_URL, SUPABASE_KEY, LOCAL_INVITE_KEYS } from './config.js';

const K = 'lrw:';
const get = (k, d) => { try { const v = localStorage.getItem(K + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => localStorage.setItem(K + k, JSON.stringify(v));
const del = k => localStorage.removeItem(K + k);
const norm = u => String(u || '').trim().toLowerCase();

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Rooms saved in this browser by the local mode, whoever made them. Used to offer an import
// after moving online.
function browserRooms() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(K + 'room:')) { try { const s = JSON.parse(localStorage.getItem(k)); if (s && s.room && s.objects) out.push(s); } catch {} }
  }
  return out;
}

// ---------- local: this browser only ----------
const local = {
  mode: 'local', user: null,
  async session() { this.user = get('session', null); return this.user; },
  async signUp(username, password, key) {
    const u = norm(username); key = String(key || '').trim().toUpperCase();
    if (!/^[a-z0-9_]{3,20}$/.test(u)) throw new Error('Username: 3-20 letters, numbers or underscores.');
    if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
    if (key.length !== 8) throw new Error('The invite key is 8 characters.');
    const users = get('users', {}), used = get('usedKeys', {});
    if (users[u]) throw new Error('That username is taken.');
    if (!LOCAL_INVITE_KEYS.includes(key)) throw new Error('That invite key is not valid.');
    if (used[key]) throw new Error('That invite key has already been used.');
    const salt = crypto.randomUUID();
    users[u] = { salt, hash: await sha(salt + password) };
    used[key] = u; set('users', users); set('usedKeys', used); set('session', u);
    return (this.user = u);
  },
  async signIn(username, password) {
    const u = norm(username), rec = get('users', {})[u];
    if (!rec || rec.hash !== (await sha(rec.salt + password))) throw new Error('Wrong username or password.');
    set('session', u); return (this.user = u);
  },
  async signOut() { del('session'); this.user = null; },
  async listRooms() { return get('rooms:' + this.user, []).sort((a, b) => b.updated - a.updated); },
  async loadRoom(id) { return get('room:' + this.user + ':' + id, null); },
  async saveRoom(id, scene) {
    set('room:' + this.user + ':' + id, scene);
    const idx = get('rooms:' + this.user, []).filter(r => r.id !== id);
    idx.push({ id, name: scene.name, updated: Date.now() }); set('rooms:' + this.user, idx);
  },
  saveOnExit(id, scene) { try { set('room:' + this.user + ':' + id, scene); } catch {} },
  async deleteRoom(id) {
    del('room:' + this.user + ':' + id);
    set('rooms:' + this.user, get('rooms:' + this.user, []).filter(r => r.id !== id));
  },
  async getCatalog() { return get('catalog:' + this.user, null); },
  async saveCatalog(list) { set('catalog:' + this.user, list); },
  browserRooms: () => [],
};

// ---------- online: Supabase ----------
const rpcUrl = fn => `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
async function rpc(fn, args) {
  let r;
  try { r = await fetch(rpcUrl(fn), { method: 'POST', headers, body: JSON.stringify(args) }); }
  catch { throw new Error('No connection. Check your internet and try again.'); }
  if (!r.ok) {
    let msg = 'Something went wrong. Please try again.';
    try {
      const j = await r.json();
      if (j.code === 'P0001' && j.message) msg = j.message;        // a message written for people, from setup.sql
      else if (j.code === 'PGRST202') msg = 'The online service is not set up yet.';
    } catch {}
    if (msg === 'Please sign in again.') { del('online'); location.reload(); }
    throw new Error(msg);
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const online = {
  mode: 'online', user: null, token: null,
  _start(res) { if (res.error) throw new Error(res.error); this.token = res.token; this.user = res.username; set('online', { token: res.token, user: res.username }); return this.user; },
  async session() { const s = get('online', null); if (s) { this.token = s.token; this.user = s.user; } return this.user; },
  async signUp(username, password, key) { return this._start(await rpc('app_sign_up', { p_username: username, p_password: password, p_key: key })); },
  async signIn(username, password) { return this._start(await rpc('app_sign_in', { p_username: username, p_password: password })); },
  async signOut() { const t = this.token; del('online'); this.user = this.token = null; try { await rpc('app_sign_out', { p_token: t }); } catch {} },
  async listRooms() { return (await rpc('app_list_rooms', { p_token: this.token })) || []; },
  async loadRoom(id) { return rpc('app_load_room', { p_token: this.token, p_id: id }); },
  async saveRoom(id, scene) { await rpc('app_save_room', { p_token: this.token, p_id: id, p_scene: scene }); },
  // Last-moment save while the page is closing. Browsers only allow small requests here, so a
  // room with many photos may miss its final half-second of changes.
  saveOnExit(id, scene) { try { fetch(rpcUrl('app_save_room'), { method: 'POST', headers, keepalive: true, body: JSON.stringify({ p_token: this.token, p_id: id, p_scene: scene }) }); } catch {} },
  async deleteRoom(id) { await rpc('app_delete_room', { p_token: this.token, p_id: id }); },
  async getCatalog() { return rpc('app_get_catalog', { p_token: this.token }); },
  async saveCatalog(list) { await rpc('app_save_catalog', { p_token: this.token, p_items: list }); },
  browserRooms,
};

export const store = BACKEND === 'online' ? online : local;

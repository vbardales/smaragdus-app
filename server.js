// Smaragdus: exploration points webapp. Zero dependencies (Node >= 18).
// Env: PORT (3000), ADMIN_PASSWORD (required), DATA_FILE (data.json)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(DIR, 'data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('ADMIN_PASSWORD is missing: set the environment variable.'); process.exit(1); }

// ---------- state ----------
const tier = (id, threshold, label, reward, mode = 'crosser') => ({ id, threshold, label, reward, mode, winnerId: null, winnerName: null });
const seed = () => ({
  factions: [
    { id: 'alpha', name: 'Alpha Légion', gauge: 'choice' },
    { id: 'loyalist', name: 'Loyaliste', gauge: 'loyalist' },
    { id: 'renegade', name: 'Renégat', gauge: 'renegade' },
    { id: 'neutral', name: 'Sans faction', gauge: null },
  ],
  targets: [
    { id: 'grus', kind: 'planet', name: 'Grus', specialty: 'À définir', multiplier: 1, x: 32.7, y: 24.9 },
    { id: 'phoenix', kind: 'planet', name: 'Phoenix', specialty: 'À définir', multiplier: 1, x: 59.7, y: 27.8 },
    { id: 'scorpius', kind: 'planet', name: 'Scorpius IV', specialty: 'À définir', multiplier: 1, x: 76.5, y: 38.6 },
    { id: 'cancer', kind: 'planet', name: 'Cancer', specialty: 'À définir', multiplier: 1, x: 73.2, y: 65 },
    { id: 'unicornis', kind: 'planet', name: 'Unicornis', specialty: 'À définir', multiplier: 1, x: 44.9, y: 67.9 },
    { id: 'draco', kind: 'planet', name: 'Draco', specialty: 'À définir', multiplier: 1, x: 15, y: 59.6 },
    { id: 'leo', kind: 'planet', name: 'Leo I', specialty: 'À définir', multiplier: 1, x: 36.8, y: 38.6 },
    { id: 'loyalist', kind: 'gauge', name: 'Jauge Loyaliste', specialty: '', multiplier: 1 },
    { id: 'renegade', kind: 'gauge', name: 'Jauge Renégat', specialty: '', multiplier: 1 },
  ].map((t) => ({ ...t, tiers: t.kind === 'planet'
    ? [tier(`${t.id}-1`, 10, 'Palier 1', 'Lot à définir'), tier(`${t.id}-2`, 25, 'Palier 2', 'Lot à définir', 'draw'), tier(`${t.id}-3`, 50, 'Palier 3 — la supercherie', 'Révélation à définir')]
    : [tier(`${t.id}-1`, 20, 'Palier 1', 'Lot à définir'), tier(`${t.id}-2`, 50, 'Palier 2', 'Lot à définir')] })),
  players: {}, // id -> {id,name,factionId,code,points,bonus,alloc:{targetId:n}}
  log: [],
});

let S;
try { S = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { S = seed(); }
if (!Array.isArray(S.targets) || !S.targets.every((t) => Array.isArray(t.tiers))) S = seed(); // data saved by an older schema: start fresh
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(S));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  }, 100);
}
const logEvt = (text) => { S.log.unshift({ t: Date.now(), text }); S.log.length = Math.min(S.log.length, 200); };

// ---------- logic ----------
const poolOf = (t) => (t.kind === 'gauge' ? 'bonus' : 'points');
const spent = (p, pool) => S.targets.filter((t) => poolOf(t) === pool).reduce((n, t) => n + (p.alloc[t.id] || 0), 0);
const rawTotal = (t) => Object.values(S.players).reduce((n, p) => n + (p.alloc[t.id] || 0), 0);
const effTotal = (t) => rawTotal(t) * (t.multiplier || 1);
const faction = (p) => S.factions.find((f) => f.id === p.factionId);
const allowedGauges = (p) => {
  const g = faction(p)?.gauge;
  return g === 'choice' ? ['loyalist', 'renegade'] : g ? [g] : [];
};

function allocate(p, target, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  const pool = poolOf(target);
  const avail = (pool === 'bonus' ? p.bonus : p.points) - spent(p, pool);
  if (amount > avail) throw new Error(`Points insuffisants (${avail} dispo)`);
  if (pool === 'bonus' && !allowedGauges(p).includes(target.id)) throw new Error('Jauge non autorisée pour cette faction');
  const before = effTotal(target);
  p.alloc[target.id] = (p.alloc[target.id] || 0) + amount;
  const after = effTotal(target);
  logEvt(`${p.name} → ${target.name} : +${amount}`);
  for (const pa of target.tiers) {
    if (pa.winnerId || pa.threshold <= before || pa.threshold > after) continue;
    let winner = p;
    if (pa.mode === 'draw') { // weighted draw by invested points
      const entries = Object.values(S.players).filter((q) => q.alloc[target.id] > 0);
      let r = crypto.randomInt(entries.reduce((n, q) => n + q.alloc[target.id], 0));
      winner = entries.find((q) => (r -= q.alloc[target.id]) < 0);
    }
    pa.winnerId = winner.id; pa.winnerName = winner.name;
    logEvt(`PALIER ${target.name} « ${pa.label} » (${pa.threshold}) → ${winner.name} (${pa.mode === 'draw' ? 'tirage' : 'franchissement'})`);
  }
}

// ---------- views ----------
function view(role, me) {
  const isAdmin = role === 'admin';
  const targets = S.targets.map((t) => ({
    id: t.id, kind: t.kind, name: t.name, specialty: t.specialty, multiplier: t.multiplier, x: t.x, y: t.y,
    total: effTotal(t), mine: me ? me.alloc[t.id] || 0 : 0,
    tiers: t.tiers.map((pa) => ({
      id: pa.id, threshold: pa.threshold, label: pa.label, mode: pa.mode, winnerId: pa.winnerId, winnerName: pa.winnerName,
      reward: isAdmin || (me && pa.winnerId === me.id) ? pa.reward : null,
    })),
  }));
  const out = { role, targets, log: S.log.slice(0, 40), factions: S.factions.map(({ id, name, gauge }) => ({ id, name, gauge })) };
  if (me) out.me = { id: me.id, name: me.name, factionId: me.factionId, points: me.points - spent(me, 'points'), bonus: me.bonus - spent(me, 'bonus'), gauges: allowedGauges(me) };
  if (isAdmin) {
    out.players = Object.values(S.players).map((p) => ({ ...p, left: p.points - spent(p, 'points'), bonusLeft: p.bonus - spent(p, 'bonus') }));
    out.config = { factions: S.factions, targets: S.targets.map(({ id, kind, name, specialty, multiplier, x, y, tiers }) => ({ id, kind, name, specialty, multiplier, x, y, tiers: tiers.map(({ id, threshold, label, reward, mode }) => ({ id, threshold, label, reward, mode })) })) };
  }
  return out;
}

function auth(req) {
  const tok = String(req.headers['x-token'] || '');
  const a = Buffer.from(tok), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { role: 'admin' };
  const p = Object.values(S.players).find((q) => q.code === tok);
  return p ? { role: 'player', me: p } : null;
}

// ---------- HTTP ----------
const clients = new Set();
const broadcast = () => { for (const c of clients) c.write('data: tick\n\n'); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css' };
const newCode = () => crypto.randomBytes(4).toString('hex');
const int = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error('Entier attendu'); return n; };

function validateConfig(c) {
  if (!Array.isArray(c.factions) || !Array.isArray(c.targets)) throw new Error('factions[] et targets[] requis');
  const ids = new Set();
  for (const t of c.targets) {
    if (!t.id || ids.has(t.id)) throw new Error(`id cible manquant ou dupliqué: ${t.id}`);
    ids.add(t.id);
    if (!['planet', 'gauge'].includes(t.kind)) throw new Error(`kind invalide: ${t.id}`);
    if (!Array.isArray(t.tiers)) throw new Error(`tiers[] requis: ${t.id}`);
    for (const pa of t.tiers) {
      if (!pa.id || !(pa.threshold > 0)) throw new Error(`palier invalide dans ${t.id}`);
      if (!['crosser', 'draw'].includes(pa.mode)) throw new Error(`mode invalide (crosser|draw): ${pa.id}`);
    }
  }
  for (const f of c.factions) if (!f.id || ![null, 'loyalist', 'renegade', 'choice'].includes(f.gauge)) throw new Error(`faction invalide: ${f.id}`);
}

async function body(req) {
  let s = '';
  for await (const ch of req) { s += ch; if (s.length > 1e6) throw new Error('Corps trop gros'); }
  return s ? JSON.parse(s) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const a = auth(req);
      if (!a) return send(res, 401, { error: 'Code invalide' });
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/state') return send(res, 200, view(a.role, a.me));
      const b = await body(req);
      if (route === 'POST /api/allocate') {
        let p = a.me;
        if (a.role === 'admin') p = S.players[b.playerId];
        if (!p) throw new Error('Joueur inconnu');
        const t = S.targets.find((x) => x.id === b.targetId);
        if (!t) throw new Error('Cible inconnue');
        allocate(p, t, int(b.amount));
      } else if (a.role !== 'admin') {
        return send(res, 403, { error: 'Admin requis' });
      } else if (route === 'POST /api/admin/player') {
        const name = String(b.name || '').trim().slice(0, 40);
        if (!name) throw new Error('Nom requis');
        const id = crypto.randomUUID();
        S.players[id] = { id, name, factionId: b.factionId || 'neutral', code: newCode(), points: 0, bonus: 0, alloc: {} };
        logEvt(`Joueur créé : ${name}`);
      } else if (route === 'POST /api/admin/grant') {
        const p = S.players[b.playerId];
        if (!p) throw new Error('Joueur inconnu');
        const n = int(b.amount), pool = b.pool === 'bonus' ? 'bonus' : 'points';
        if (p[pool] + n < spent(p, pool)) throw new Error('Retrait supérieur aux points disponibles');
        p[pool] += n;
        logEvt(`${n >= 0 ? '+' : ''}${n} ${pool === 'bonus' ? 'points bonus' : 'points'} pour ${p.name}`);
      } else if (route === 'POST /api/admin/faction') {
        const p = S.players[b.playerId];
        if (!p || !S.factions.some((f) => f.id === b.factionId)) throw new Error('Joueur ou faction inconnu');
        p.factionId = b.factionId;
      } else if (route === 'POST /api/admin/reset') {
        // Reset game: investments, winners, log. Config is kept.
        for (const t of S.targets) for (const pa of t.tiers) pa.winnerId = pa.winnerName = null;
        if (b.deletePlayers) S.players = {};
        else for (const p of Object.values(S.players)) p.alloc = {};
        S.log = [];
        logEvt(b.deletePlayers ? 'RESET complet (joueurs supprimés)' : 'RESET : investissements et gagnants effacés');
      } else if (route === 'POST /api/admin/delete-player') {
        delete S.players[b.playerId];
      } else if (route === 'PUT /api/admin/config') {
        validateConfig(b);
        const old = new Map(S.targets.flatMap((t) => t.tiers.map((pa) => [pa.id, pa])));
        S.factions = b.factions;
        S.targets = b.targets.map((t) => ({ ...t, tiers: t.tiers.map((pa) => ({ ...pa, winnerId: old.get(pa.id)?.winnerId ?? null, winnerName: old.get(pa.id)?.winnerName ?? null })) }));
        logEvt('Configuration mise à jour');
      } else return send(res, 404, { error: 'Route inconnue' });
      save(); broadcast();
      return send(res, 200, { ok: true });
    }
    // static files
    const file = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, '');
    const full = path.join(DIR, 'public', file);
    if (!full.startsWith(path.join(DIR, 'public')) || !fs.existsSync(full)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, () => console.log(`Smaragdus listening on http://localhost:${PORT}`));

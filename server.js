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
// On each planet the loyalist and renegade camps race to the same tier thresholds: the first camp to reach a threshold
// wins that tier (winnerSide). Its contributors receive the report (title, fluff, images, rules); if `prize` is set,
// a lottery weighted by invested points picks one winner among them (winnerId).
// A "shared" tier is a first contact: no race, every contributor of either camp gets the report once the planet's total reaches the threshold.
// `nature` (optional) replaces the planet's displayed nature once the tier is won.
const tier = (t) => ({ title: 'À définir', fluff: '', images: [], rules: '', prize: '', nature: '', shared: false, ...t, unlocked: false, winnerSide: null, winnerId: null, winnerName: null });
// Planets, their tiers and report texts live in seed-planets.json (edit the texts there or in the admin panel).
const PLANETS = JSON.parse(fs.readFileSync(path.join(DIR, 'seed-planets.json'), 'utf8'));
// Legion table: [army, planet with a +25% bonus | null, wipe target | null]. Army names match the players' `army` field.
// wipe: once per player, destroys the other players' points on one camp's gauge of a planet ('opponent' = the camp opposed to the player's own).
const ARMIES = [
  ['Dark Angels', 'leo'], ['Emperor\'s Children', 'grus'], ['Iron Warriors', 'scorpius'], ['White Scars', 'unicornis'],
  ['Space Wolves', null, 'renegade'], ['Imperial Fists', 'scorpius'], ['Night Lords', 'grus'], ['Blood Angels', 'grus'],
  ['World Eaters', null, 'loyalist'], ['Ultramarines', 'phoenix'], ['Death Guard', 'phoenix'], ['Thousand Sons', 'draco'],
  ['Sons of Horus', 'leo'], ['Word Bearers', 'cancer'], ['Raven Guard', 'draco'], ['Alpha Legion'],
  ['Taghmata Omnissiah', 'unicornis'], ['Chevaliers Questoris', 'unicornis'], ['Militia Imperialis'], ['Solar Auxilia', 'cancer'],
  ['Collegia Titanica', null, 'opponent'],
];
const armyRow = ([name, planetId = null, wipe = null]) => ({ name, bonus: planetId ? { planetId, pct: 25 } : null, wipe });
const planetOf = (p) => ({ ...p, kind: 'planet', multiplier: 1, tiers: p.tiers.map(tier) });
// every planet owns one loyalist and one renegade gauge: the camp's total on the planet (no tiers of their own)
const gaugesOf = (p) => ['loyalist', 'renegade'].map((side) => ({
  id: `${p.id}-${side}`, kind: 'gauge', planetId: p.id, side, name: `${p.name} · ${side === 'loyalist' ? 'Loyaliste' : 'Renégat'}`, specialty: '', multiplier: 1,
  tiers: [],
}));
// Default roster (registered players), kept next to the code so a fresh state starts with them.
let seedPlayers = [];
try { seedPlayers = JSON.parse(fs.readFileSync(path.join(DIR, 'seed-players.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error(`Could not read seed-players.json: ${e.message}`); }
const seed = () => ({
  factions: [
    { id: 'alpha', name: 'Alpha Légion', gauge: 'choice' },
    { id: 'loyalist', name: 'Loyaliste', gauge: 'loyalist' },
    { id: 'renegade', name: 'Renégat', gauge: 'renegade' },
    { id: 'worldeaters', name: 'World Eaters', gauge: 'renegade' },
    { id: 'neutral', name: 'Sans faction', gauge: null },
  ],
  armies: ARMIES.map(armyRow),
  targets: PLANETS.map(planetOf).flatMap((p) => [p, ...gaugesOf(p)]),
  players: Object.fromEntries(seedPlayers.map((p) => [p.id, structuredClone(p)])), // id -> {id,name,factionId,code,points,alloc:{gaugeId:n}}
  log: [],
});

let S;
let loadedFromFile = false, loadFailed = false;
try { S = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); loadedFromFile = true; } catch (e) {
  console.log(`Could not load ${DATA_FILE}: ${e.code || e.message}`); // ENOENT = no file yet
  loadFailed = e.code !== 'ENOENT'; // unreadable or corrupt file: it may still hold the real state
  S = seed();
}
// data saved by an older schema (no tiers, or global gauges without planetId): start fresh
if (!Array.isArray(S.targets) || !S.targets.every((t) => Array.isArray(t.tiers) && (t.kind !== 'gauge' || t.planetId))) { S = seed(); loadedFromFile = false; }
// Planet positions are tied to the map image, so the code owns them: refresh saved data from the seed on every start.
const seedPos = Object.fromEntries(seed().targets.filter((t) => t.kind === 'planet').map((t) => [t.id, { x: t.x, y: t.y }]));
for (const t of S.targets) if (seedPos[t.id]) Object.assign(t, seedPos[t.id]);
// older saves: tiers had a reward and a mode, gauges had tiers of their own, players had no inbox
const migrateTier = ({ reward, mode, ...pa }) => ({ title: 'À définir', fluff: '', images: [], rules: '', prize: reward && reward !== 'Lot à définir' ? reward : '', nature: '', shared: false, unlocked: !!pa.winnerId, winnerSide: null, ...pa });
for (const t of S.targets) t.tiers = t.kind === 'gauge' ? [] : t.tiers.map(migrateTier);
for (const p of Object.values(S.players)) p.inbox ??= [];
// The roster file owns identity data: refresh saved players that come from it (their points and investments are kept).
for (const sp of seedPlayers) {
  const p = S.players[sp.id];
  if (!p) { // a roster player missing from the saved state (added to the roster later), unless the admin deleted them
    if (!S.deleted?.includes(sp.id)) { S.players[sp.id] = structuredClone(sp); console.log(`Roster player added: ${sp.name}`); }
    continue;
  }
  Object.assign(p, { name: sp.name, fluffName: sp.fluffName, email: sp.email, army: sp.army });
  if (Object.values(S.players).some((q) => q !== p && q.code.toLowerCase() === sp.code.toLowerCase())) console.error(`Roster code of ${sp.name} is already used by another player: kept ${p.code}`);
  else p.code = sp.code;
}
S.armies ??= seed().armies;
for (const f of S.factions) delete f.ability; // special powers now belong to the legion (S.armies)
console.log(`State: ${loadedFromFile ? 'loaded from' : 'fresh seed, nothing usable in'} ${DATA_FILE} (${Object.keys(S.players).length} players)`);
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(S));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
      console.log(`State saved to ${DATA_FILE} (${Object.keys(S.players).length} players)`);
    } catch (e) {
      // a failed write must never take the game down; the in-memory state stays authoritative
      console.error(`Could not save state to ${DATA_FILE}: ${e.message}`);
    }
  }, 100);
}
// scope: 'public' = every player, a player id = that player (and admin), undefined = admin only
const logEvt = (text, scope) => { S.log.unshift({ t: Date.now(), text, scope }); S.log.length = Math.min(S.log.length, 200); };

// ---------- logic ----------
// Players invest on a planet's loyalist or renegade gauge (their camp). Neutral players and the Alpha Legion pick the camp
// at each investment; the other factions are tied to theirs.
const SIDE_NAME = { loyalist: 'Loyalistes', renegade: 'Renégats' };
const spent = (p) => S.targets.reduce((n, t) => n + (p.alloc[t.id] || 0), 0);
const planetOfGauge = (g) => S.targets.find((x) => x.id === g.planetId);
const gaugeOf = (planet, side) => S.targets.find((g) => g.kind === 'gauge' && g.planetId === planet.id && g.side === side);
const faction = (p) => S.factions.find((f) => f.id === p.factionId);
const army = (p) => S.armies.find((a) => a.name === p.army);
const planetBonus = (p, planet) => (army(p)?.bonus?.planetId === planet.id ? army(p).bonus.pct : 0); // % on the player's points on that planet
// A camp's score on a planet: the points of its players, each boosted by their legion bonus, times the planet multiplier.
const sideTotal = (planet, side) => {
  const g = gaugeOf(planet, side);
  if (!g) return 0;
  const sum = Object.values(S.players).reduce((n, p) => n + (p.alloc[g.id] || 0) * (1 + planetBonus(p, planet) / 100), 0);
  return Math.round(sum * (planet.multiplier || 1) * 1e4) / 1e4;
};
const fixedSide = (p) => { const g = faction(p)?.gauge; return g === 'loyalist' || g === 'renegade' ? g : null; }; // null: picks the camp at each investment
const allowedGauges = (p) => (fixedSide(p) ? [fixedSide(p)] : ['loyalist', 'renegade']);
const wipeSide = (p) => { // the camp whose points the player's legion can destroy
  const w = army(p)?.wipe;
  if (w !== 'opponent') return w || null;
  const mine = fixedSide(p);
  return mine && (mine === 'loyalist' ? 'renegade' : 'loyalist');
};

function allocate(p, target, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  if (target.kind !== 'gauge') throw new Error('Choisis un camp (loyaliste ou renégat)');
  const avail = p.points - spent(p);
  if (amount > avail) throw new Error(`Points insuffisants (${avail} dispo)`);
  if (!allowedGauges(p).includes(target.side)) throw new Error('Camp non autorisé pour cette faction');
  p.alloc[target.id] = (p.alloc[target.id] || 0) + amount;
  logEvt(`${p.name} → ${target.name} : +${amount}`, p.id);
  settle(planetOfGauge(target));
}

// Award every tier whose threshold a camp has reached (the first camp to reach it wins it for good), draw the prize of
// won tiers that have one, and deliver the report of every won tier to the contributors of the winning camp (a late
// contributor of that camp also gets the earlier ones). Idempotent, so it also runs after a config edit: changing a
// threshold or adding a prize on the day takes effect at once.
function settle(planet) {
  const camps = ['loyalist', 'renegade'].map((side) => ({ side, total: sideTotal(planet, side) }));
  for (const pa of planet.tiers) {
    if (pa.shared) { // first contact: unlocked by the planet's total, delivered to the contributors of both camps
      const mine = Object.values(S.players).filter((q) => ['loyalist', 'renegade'].some((side) => q.alloc[gaugeOf(planet, side)?.id] > 0));
      if (!pa.unlocked && camps[0].total + camps[1].total >= pa.threshold) { pa.unlocked = true; logEvt(`Premier contact établi sur ${planet.name}`, 'public'); }
      if (pa.unlocked) deliver(planet, pa, mine);
      continue;
    }
    if (!pa.unlocked) {
      const reached = camps.filter((c) => c.total >= pa.threshold);
      if (!reached.length) continue;
      const best = Math.max(...reached.map((c) => c.total)), top = reached.filter((c) => c.total === best); // a tie only happens after a config edit
      pa.winnerSide = top[crypto.randomInt(top.length)].side;
      pa.unlocked = true;
      logEvt(`PALIER ${planet.name} « ${pa.label} » (${pa.threshold}) remporté par les ${SIDE_NAME[pa.winnerSide]}`, 'public');
    }
    const g = pa.winnerSide && gaugeOf(planet, pa.winnerSide);
    if (!g) continue; // tier won before camps existed (old save): nothing to deliver
    const entries = Object.values(S.players).filter((q) => q.alloc[g.id] > 0);
    if (pa.prize && !pa.winnerId && entries.length) { // weighted draw by invested points
      let r = crypto.randomInt(entries.reduce((n, q) => n + q.alloc[g.id], 0));
      const winner = entries.find((q) => (r -= q.alloc[g.id]) < 0);
      pa.winnerId = winner.id; pa.winnerName = winner.name;
      logEvt(`LOT ${planet.name} « ${pa.label} » → ${winner.name} (tirage pondéré)`, 'public');
    }
    deliver(planet, pa, entries);
  }
}
function deliver(planet, pa, players) {
  for (const q of players) {
    if (q.inbox.some((m) => m.tierId === pa.id)) continue;
    q.inbox.push({ tierId: pa.id, targetId: planet.id, t: Date.now() });
    logEvt(`Nouveau rapport : ${planet.name} « ${pa.label} »`, q.id);
  }
}
// what the planet is taken to be: the nature of the highest unlocked tier that sets one, else its starting nature
const natureOf = (planet) => planet.tiers.filter((pa) => pa.unlocked && pa.nature).sort((a, b) => b.threshold - a.threshold)[0]?.nature || planet.nature || '';

// Legion power "wipe", once per player: destroys every other player's points invested on one camp's gauge of a planet.
// The points are lost for good: the victims' quota shrinks by the wiped amount. Tiers already won stay won.
function wipe(p, planet) {
  const side = wipeSide(p);
  if (!side) throw new Error('Ta légion n\'a pas ce pouvoir');
  if (p.abilityUsed) throw new Error('Pouvoir déjà utilisé');
  const g = gaugeOf(planet, side);
  if (!g) throw new Error('Jauge introuvable');
  let total = 0;
  for (const q of Object.values(S.players)) {
    const n = q.alloc[g.id] || 0;
    if (q === p || n === 0) continue;
    q.points -= n; // alloc is cleared too, so the points still available to q are unchanged
    delete q.alloc[g.id];
    total += n;
    logEvt(`Tes ${n} points sur ${planet.name} ont été détruits par ${p.name}`, q.id);
  }
  p.abilityUsed = true;
  logEvt(`${p.name} (${p.army}) détruit les points des ${SIDE_NAME[side]} sur ${planet.name} : ${total} points détruits`, 'public');
}

// ---------- views ----------
function view(role, me) {
  const isAdmin = role === 'admin';
  const targets = S.targets.map((t) => ({
    id: t.id, kind: t.kind, name: t.name, specialty: t.specialty, nature: t.kind === 'planet' ? natureOf(t) : '', multiplier: t.multiplier, x: t.x, y: t.y, planetId: t.planetId, side: t.side,
    total: t.kind === 'planet' ? sideTotal(t, 'loyalist') + sideTotal(t, 'renegade') : sideTotal(planetOfGauge(t), t.side),
    mine: me ? (t.kind === 'planet' ? ['loyalist', 'renegade'].reduce((n, side) => n + (me.alloc[gaugeOf(t, side)?.id] || 0), 0) : me.alloc[t.id] || 0) : 0,
    // players never learn the tiers nobody has unlocked yet, not even how many there are; unlocked ones show only threshold, public label and prize winner
    // (the report itself, rules and prize text go to the inbox of the contributors)
    tiers: t.tiers.filter((pa) => isAdmin || pa.unlocked).map((pa) => (isAdmin ? { id: pa.id, threshold: pa.threshold, label: pa.label, title: pa.title, prize: pa.prize, unlocked: pa.unlocked, winnerSide: pa.winnerSide, winnerId: pa.winnerId, winnerName: pa.winnerName }
      : pa.unlocked ? { id: pa.id, threshold: pa.threshold, label: pa.label, unlocked: true, winnerSide: pa.winnerSide, hasPrize: !!pa.prize, winnerName: pa.winnerName }
      : null)),
  }));
  const log = S.log.filter((l) => isAdmin || l.scope === 'public' || (me && l.scope === me.id)).slice(0, 40).map(({ t, text }) => ({ t, text }));
  const out = { role, targets, log, factions: S.factions.map(({ id, name, gauge }) => ({ id, name, gauge })) };
  if (me) {
    out.me = { id: me.id, name: me.name, fluffName: me.fluffName || null, factionId: me.factionId, points: me.points - spent(me), gauges: allowedGauges(me), army: me.army || null, planetBonus: army(me)?.bonus ? { planetId: army(me).bonus.planetId, planetName: S.targets.find((t) => t.id === army(me).bonus.planetId)?.name, pct: army(me).bonus.pct } : null, wipe: !me.abilityUsed ? wipeSide(me) : null };
    // inbox: reports are read live from the config, so an edit on the day also fixes reports already delivered
    out.inbox = me.inbox.map((m) => {
      const t = S.targets.find((x) => x.id === m.targetId), pa = t?.tiers.find((x) => x.id === m.tierId);
      if (!pa) return null;
      const won = pa.winnerId === me.id;
      return { t: m.t, targetId: t.id, tierId: pa.id, targetName: t.name, side: pa.winnerSide, label: pa.label, title: pa.title, fluff: pa.fluff, images: pa.images, rules: pa.rules, hasPrize: !!pa.prize, prize: won ? pa.prize : null, won, winnerName: pa.winnerName };
    }).filter(Boolean).reverse();
  }
  if (isAdmin) {
    out.players = Object.values(S.players).map((p) => ({ ...p, inbox: p.inbox.length, left: p.points - spent(p) }));
    out.config = { factions: S.factions, armies: S.armies, targets: S.targets.map(({ id, kind, name, specialty, nature, multiplier, x, y, planetId, side, tiers }) => ({ id, kind, name, specialty, nature, multiplier, x, y, planetId, side, tiers: tiers.map(({ id, threshold, label, title, fluff, images, rules, prize, nature, shared }) => ({ id, threshold, label, title, fluff, images, rules, prize, nature, shared })) })) };
  }
  return out;
}

function auth(req) {
  const tok = String(req.headers['x-token'] || '');
  const a = Buffer.from(tok), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { role: 'admin' };
  const p = Object.values(S.players).find((q) => q.code.toLowerCase() === tok.toLowerCase()); // codes are case-insensitive
  return p ? { role: 'player', me: p } : null;
}

// ---------- HTTP ----------
const clients = new Set();
const broadcast = () => { for (const c of clients) c.write('data: tick\n\n'); };
// SSE comment every 25 s: proxies (Azure) cut idle connections after about 4 minutes
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const newCode = () => crypto.randomBytes(4).toString('hex');
const int = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error('Entier attendu'); return n; };

function validateConfig(c) {
  if (!Array.isArray(c.factions) || !Array.isArray(c.targets)) throw new Error('factions[] et targets[] requis');
  const ids = new Set(), tierIds = new Set();
  for (const t of c.targets) {
    if (!t.id || ids.has(t.id)) throw new Error(`id cible manquant ou dupliqué: ${t.id}`);
    ids.add(t.id);
    if (!['planet', 'gauge'].includes(t.kind)) throw new Error(`kind invalide: ${t.id}`);
    if (t.kind === 'gauge' && (!['loyalist', 'renegade'].includes(t.side) || !c.targets.some((x) => x.id === t.planetId && x.kind === 'planet'))) throw new Error(`jauge invalide (side, planetId): ${t.id}`);
    if (!Array.isArray(t.tiers)) throw new Error(`tiers[] requis: ${t.id}`);
    for (const pa of t.tiers) {
      if (!pa.id || tierIds.has(pa.id) || !(Number(pa.threshold) > 0)) throw new Error(`palier invalide ou id dupliqué dans ${t.id}: ${pa.id}`);
      tierIds.add(pa.id);
      if (pa.images != null && !Array.isArray(pa.images)) throw new Error(`images[] attendu: ${pa.id}`);
    }
  }
  if (c.armies != null && !Array.isArray(c.armies)) throw new Error('armies[] attendu');
  for (const a of c.armies || []) {
    if (!a?.name || (a.bonus?.planetId && (!c.targets.some((x) => x.id === a.bonus.planetId && x.kind === 'planet') || !Number.isFinite(Number(a.bonus.pct))))) throw new Error(`légion invalide (nom, bonus): ${a.name}`);
  }
  for (const f of c.factions) {
    if (!f.id || ![null, 'loyalist', 'renegade', 'choice'].includes(f.gauge)) throw new Error(`faction invalide: ${f.id}`);
  }
}

async function body(req) {
  let s = '';
  for await (const ch of req) { s += ch; if (s.length > 1e6) throw new Error('Corps trop gros'); }
  return s ? JSON.parse(s) : {};
}

for (const t of S.targets) if (t.kind === 'planet') settle(t); // delivers reports missing after a migration
if (loadFailed) console.error(`Not writing ${DATA_FILE} at startup: it could not be read, fix or remove it first.`); else save(); // persist the seed or the migration
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
      } else if (route === 'POST /api/ability') {
        const p = a.role === 'admin' ? S.players[b.playerId] : a.me;
        if (!p) throw new Error('Joueur inconnu');
        const t = S.targets.find((x) => x.id === b.targetId);
        if (!t || t.kind !== 'planet') throw new Error('Planète inconnue');
        wipe(p, t);
      } else if (a.role !== 'admin') {
        return send(res, 403, { error: 'Admin requis' });
      } else if (route === 'POST /api/admin/player') {
        const name = String(b.name || '').trim().slice(0, 40);
        if (!name) throw new Error('Nom requis');
        const code = String(b.code || '').trim().toLowerCase() || newCode(); // admin may choose the code; always stored lowercase
        if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) throw new Error('Code invalide (4 à 32 caractères : lettres, chiffres, - ou _)');
        // unique whatever the case, since login ignores case; also never equal to the admin password
        if (code.toLowerCase() === ADMIN_PASSWORD.toLowerCase() || Object.values(S.players).some((q) => q.code.toLowerCase() === code.toLowerCase())) throw new Error('Code déjà utilisé');
        const id = crypto.randomUUID();
        S.players[id] = { id, name, factionId: b.factionId || 'neutral', army: String(b.army || ''), fluffName: String(b.fluffName || '').trim().slice(0, 200), code, points: 0, alloc: {}, abilityUsed: false, inbox: [] };
        logEvt(`Joueur créé : ${name}`);
      } else if (route === 'POST /api/admin/grant') {
        const p = S.players[b.playerId];
        if (!p) throw new Error('Joueur inconnu');
        const n = int(b.amount);
        if (p.points + n < spent(p)) throw new Error('Retrait supérieur aux points disponibles');
        p.points += n;
        logEvt(`${n >= 0 ? '+' : ''}${n} points pour ${p.name}`, p.id);
      } else if (route === 'POST /api/admin/faction') {
        const p = S.players[b.playerId];
        if (!p || !S.factions.some((f) => f.id === b.factionId)) throw new Error('Joueur ou faction inconnu');
        p.factionId = b.factionId;
      } else if (route === 'POST /api/admin/reset') {
        // Reset game: investments, winners, log. Config is kept.
        for (const t of S.targets) for (const pa of t.tiers) { pa.winnerId = pa.winnerName = pa.winnerSide = null; pa.unlocked = false; }
        if (b.deletePlayers) { S.deleted = [...(S.deleted || []), ...Object.keys(S.players)]; S.players = {}; }
        else for (const p of Object.values(S.players)) { p.alloc = {}; p.abilityUsed = false; p.inbox = []; }
        S.log = [];
        logEvt(b.deletePlayers ? 'RESET complet (joueurs supprimés)' : 'RESET : investissements et gagnants effacés', 'public');
      } else if (route === 'POST /api/admin/delete-player') {
        (S.deleted ??= []).push(b.playerId); // keeps the roster refresh from bringing them back
        delete S.players[b.playerId];
      } else if (route === 'PUT /api/admin/config') {
        validateConfig(b);
        const old = new Map(S.targets.flatMap((t) => t.tiers.map((pa) => [pa.id, pa])));
        S.factions = b.factions;
        if (b.armies) S.armies = b.armies.map((a) => ({ name: String(a.name), bonus: a.bonus?.planetId ? { planetId: a.bonus.planetId, pct: Number(a.bonus.pct) } : null, wipe: ['loyalist', 'renegade', 'opponent'].includes(a.wipe) ? a.wipe : null }));
        const str = (v) => String(v ?? '');
        S.targets = b.targets.map((t) => ({ ...t, tiers: t.kind === 'gauge' ? [] : t.tiers.map((pa) => { // unlock state and prize winner are kept by tier id
          const o = old.get(pa.id);
          return { id: pa.id, threshold: Number(pa.threshold), label: str(pa.label), title: str(pa.title), fluff: str(pa.fluff), images: (pa.images || []).map(str).filter(Boolean), rules: str(pa.rules), prize: str(pa.prize), nature: str(pa.nature), shared: !!pa.shared, unlocked: o?.unlocked ?? false, winnerSide: o?.winnerSide ?? null, winnerId: o?.winnerId ?? null, winnerName: o?.winnerName ?? null };
        }) }));
        for (const t of S.targets) if (t.kind === 'planet') settle(t); // new thresholds or prizes can unlock tiers right away
        logEvt('Configuration mise à jour');
      } else return send(res, 404, { error: 'Route inconnue' });
      save(); broadcast();
      return send(res, 200, { ok: true });
    }
    // static files
    const file = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, '');
    const full = path.join(DIR, 'public', file);
    const isFile = full.startsWith(path.join(DIR, 'public') + path.sep) && fs.statSync(full, { throwIfNoEntry: false })?.isFile(); // a directory would crash the stream
    if (!isFile) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, () => console.log(`Smaragdus listening on http://localhost:${PORT}`));

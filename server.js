// Smaragdus: exploration points webapp. Zero dependencies (Node >= 18).
// Env: PORT (3000), ADMIN_PASSWORD (required), DATA_FILE (data.json)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { comment, provider } from './commentary.js';

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
// `nature` (optional) replaces the planet's displayed nature once the tier is won; the players of the served camps see it (`camps`: the winner
// of a race tier, the camps that invested for a shared one), not only the contributors.
// `teaser` (optional, first line = title) is a short notice sent to the members of the same camp who did not contribute on that planet;
// when they invest later, it is replaced by the full report.
const tier = (t) => ({ title: 'À définir', fluff: '', images: [], rules: '', prize: '', nature: '', teaser: '', camps: [], shared: false, ...t, unlocked: false, winnerSide: null, winnerId: null, winnerName: null });
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
// With RESET_ON_DEPLOY=1, a new deployment (any change to the code or to the seed files) starts from a clean state. Set KEEP_STATE=1 to freeze the state, for instance once the game has started. The previous state file is kept as <file>.prev.
const BUILD = crypto.createHash('sha1');
for (const f of ['server.js', 'public/index.html', 'seed-players.json', 'seed-planets.json']) { try { BUILD.update(fs.readFileSync(path.join(DIR, f))); } catch {} }
const BUILD_ID = BUILD.digest('hex').slice(0, 12);
const RESET_ON_DEPLOY = process.env.RESET_ON_DEPLOY === '1' && process.env.KEEP_STATE !== '1';
if (loadedFromFile && RESET_ON_DEPLOY && S.build !== BUILD_ID) {
  console.log(`New deployment (${S.build || 'unknown'} -> ${BUILD_ID}): resetting the state, the old file is kept as ${DATA_FILE}.prev`);
  try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.prev'); } catch (e) { console.error(`Could not keep a copy of the old state: ${e.message}`); }
  S = seed(); loadedFromFile = false;
}
// data saved by an older schema (no tiers, or global gauges without planetId): start fresh
if (!Array.isArray(S.targets) || !S.targets.every((t) => Array.isArray(t.tiers) && (t.kind !== 'gauge' || t.planetId))) { S = seed(); loadedFromFile = false; }
S.build = BUILD_ID;
// older saves: tiers had a reward and a mode, gauges had tiers of their own, players had no inbox
const migrateTier = ({ reward, mode, ...pa }) => ({ title: 'À définir', fluff: '', images: [], rules: '', prize: reward && reward !== 'Lot à définir' ? reward : '', nature: '', teaser: '', camps: [], shared: false, unlocked: !!pa.winnerId, winnerSide: null, ...pa });
for (const t of S.targets) t.tiers = t.kind === 'gauge' ? [] : t.tiers.map(migrateTier);
for (const p of Object.values(S.players)) p.inbox ??= [];
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
// scope: 'public' = every player, 'camp:<side>' = that camp's players (and the players without a fixed camp), a player id = that player (and admin), undefined = admin only
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
  return Math.max(0, Math.round((sum * (planet.multiplier || 1) + (g.adjust || 0)) * 1e4) / 1e4); // g.adjust: correction typed by the admin
};
const rawSide = (planet, side) => { const g = gaugeOf(planet, side), a = g?.adjust; if (g) g.adjust = 0; const n = sideTotal(planet, side); if (g) g.adjust = a; return n; };
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
  if (target.kind !== 'gauge') throw new Error('Choisissez un camp (loyaliste ou renégat)');
  const avail = p.points - spent(p);
  if (amount > avail) throw new Error(`Réserve insuffisante (${avail} point${avail > 1 ? 's' : ''} disponible${avail > 1 ? 's' : ''})`);
  if (!allowedGauges(p).includes(target.side)) throw new Error('Allégeance incompatible : ce camp vous est fermé');
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
      if (!pa.unlocked && camps[0].total + camps[1].total >= pa.threshold) {
        const first = !planet.tiers.some((x) => x.shared && x.unlocked); // one log line per planet, even with several first-contact archives
        pa.unlocked = true;
        if (first) logEvt(`Premier contact établi sur ${planet.name}`, campScope(camps.filter((c) => c.total > 0).map((c) => c.side))); }
      if (pa.unlocked) {
        for (const c of camps) if (c.total > 0 && !pa.camps.includes(c.side)) pa.camps.push(c.side);
        deliver(planet, pa, mine); deliverTeasers(planet, pa, mine);
      }
      continue;
    }
    if (!pa.unlocked) {
      const reached = camps.filter((c) => c.total >= pa.threshold);
      if (!reached.length) continue;
      const best = Math.max(...reached.map((c) => c.total)), top = reached.filter((c) => c.total === best); // a tie only happens after a config edit
      pa.winnerSide = top[crypto.randomInt(top.length)].side;
      pa.unlocked = true;
      logEvt(`PALIER ${planet.name} « ${pa.label} » (${pa.threshold}) franchi par les ${SIDE_NAME[pa.winnerSide]}`, campScope([pa.winnerSide]));
    }
    const g = pa.winnerSide && gaugeOf(planet, pa.winnerSide);
    if (!g) continue; // tier won before camps existed (old save): nothing to deliver
    const entries = Object.values(S.players).filter((q) => q.alloc[g.id] > 0);
    if (pa.prize && !pa.winnerId && entries.length) { // weighted draw by invested points
      let r = crypto.randomInt(entries.reduce((n, q) => n + q.alloc[g.id], 0));
      const winner = entries.find((q) => (r -= q.alloc[g.id]) < 0);
      pa.winnerId = winner.id; pa.winnerName = winner.name;
      logEvt(`LOT ${planet.name} « ${pa.label} » → ${winner.name} (tirage pondéré)`, campScope([pa.winnerSide]));
    }
    deliver(planet, pa, entries);
    deliverTeasers(planet, pa, entries);
  }
}
// full report; it replaces a teaser the player already got
function deliver(planet, pa, players) {
  for (const q of players) {
    const had = q.inbox.find((m) => m.tierId === pa.id);
    if (had && !had.teaser) continue;
    if (had) { delete had.teaser; had.t = Date.now(); } else q.inbox.push({ tierId: pa.id, targetId: planet.id, t: Date.now() });
    logEvt(`Transmission reçue : ${planet.name} « ${pa.label} »`, q.id);
  }
}
// short notice for the players tied to a served camp (the winner of a race tier, the camps of the contributors of a shared tier) who have not contributed.
// Players who pick their camp at each investment (no fixed camp) get the notice of every tier.
function deliverTeasers(planet, pa, contributors) {
  if (!pa.teaser.trim()) return;
  const served = new Set(pa.winnerSide ? [pa.winnerSide] : contributors.map(fixedSide).filter(Boolean));
  for (const q of Object.values(S.players)) {
    if (contributors.includes(q) || (fixedSide(q) && !served.has(fixedSide(q))) || q.inbox.some((m) => m.tierId === pa.id)) continue;
    q.inbox.push({ tierId: pa.id, targetId: planet.id, t: Date.now(), teaser: true });
    logEvt(`Extrait intercepté : ${planet.name} « ${pa.label} »`, q.id);
  }
}
// what the planet is taken to be: the nature of the highest unlocked tier that sets one, else its starting nature
// Who is told about a tier: the players tied to a camp it served (the winner of a race tier, the camps that invested for a shared one), and
// the players who pick their camp at each investment (Alpha Legion, neutrals), since both camps are open to them. The other camp learns nothing:
// not the tier, not its nature, not who won. The admin (viewer null) sees everything.
const servedBy = (viewer, pa) => {
  const side = fixedSide(viewer);
  return !side || (pa.winnerSide ? [pa.winnerSide] : pa.camps).includes(side);
};
// log line scope for the camps involved: one camp = only its players (and free-choice players), several = everyone
const campScope = (sides) => (sides.length === 1 ? `camp:${sides[0]}` : 'public');
const revealedNature = (planet, viewer) => planet.tiers.filter((pa) => pa.unlocked && pa.nature && (!viewer || servedBy(viewer, pa))).sort((a, b) => b.threshold - a.threshold)[0]?.nature || '';
const natureOf = (planet, viewer) => revealedNature(planet, viewer) || planet.nature || '';

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
    id: t.id, kind: t.kind, name: t.name, specialty: isAdmin ? t.specialty : undefined, nature: t.kind === 'planet' ? (isAdmin ? natureOf(t, null) : revealedNature(t, me)) : '' /* players never get the starting nature: only what a tier revealed */, natureKnown: t.kind === 'planet' && !!revealedNature(t, isAdmin ? null : me), multiplier: t.multiplier, x: t.x, y: t.y, lbl: t.lbl, planetId: t.planetId, side: t.side,
    total: t.kind === 'planet' ? sideTotal(t, 'loyalist') + sideTotal(t, 'renegade') : sideTotal(planetOfGauge(t), t.side),
    mine: me ? (t.kind === 'planet' ? ['loyalist', 'renegade'].reduce((n, side) => n + (me.alloc[gaugeOf(t, side)?.id] || 0), 0) : me.alloc[t.id] || 0) : 0,
    // players never learn the tiers nobody has unlocked yet, not even how many there are; unlocked ones show only threshold, public label and prize winner
    // (the report itself, rules and prize text go to the inbox of the contributors)
    tiers: t.tiers.filter((pa) => isAdmin || (pa.unlocked && servedBy(me, pa))).map((pa) => (isAdmin ? { id: pa.id, threshold: pa.threshold, label: pa.label, title: pa.title, prize: pa.prize, unlocked: pa.unlocked, winnerSide: pa.winnerSide, winnerId: pa.winnerId, winnerName: pa.winnerName }
      : pa.unlocked ? { id: pa.id, threshold: pa.threshold, label: pa.label, unlocked: true, winnerSide: pa.winnerSide, hasPrize: !!pa.prize, winnerName: pa.winnerName }
      : null)),
  }));
  const campLog = (l) => me && l.scope?.startsWith('camp:') && (!fixedSide(me) || fixedSide(me) === l.scope.slice(5)); // a camp's own news
  const log = S.log.filter((l) => isAdmin || l.scope === 'public' || (me && l.scope === me.id) || campLog(l)).slice(0, isAdmin ? 200 : 40).map(({ t, text, scope }) => (isAdmin ? { t, text, scope } : { t, text })); // the admin also gets the kind of each line, to filter the log
  const out = { role, targets, log, factions: S.factions.map(({ id, name, gauge }) => ({ id, name, gauge })) };
  if (me) {
    out.me = { id: me.id, name: me.name, fluffName: me.fluffName || null, factionId: me.factionId, points: me.points - spent(me), gauges: allowedGauges(me), army: me.army || null, wipe: !me.abilityUsed ? wipeSide(me) : null };
    // inbox: reports are read live from the config, so an edit on the day also fixes reports already delivered
    out.inbox = me.inbox.map((m) => {
      const t = S.targets.find((x) => x.id === m.targetId), pa = t?.tiers.find((x) => x.id === m.tierId);
      if (!pa) return null;
      if (m.teaser) { // only the short notice, never the report, the rules or the prize
        const [head, ...rest] = pa.teaser.split('\n');
        return { teaser: true, fx: t.fx || '', t: m.t, targetId: t.id, tierId: pa.id, targetName: t.name, label: pa.label, title: head.trim(), fluff: rest.join('\n').trim(), docs: [], hasPrize: false, won: false };
      }
      const won = pa.winnerId === me.id;
      return { t: m.t, fx: t.fx || '', targetId: t.id, tierId: pa.id, targetName: t.name, side: pa.winnerSide, label: pa.label, title: pa.title, fluff: pa.fluff, docs: docsOf(pa), hasPrize: !!pa.prize, won, winnerName: pa.winnerName };
    }).filter(Boolean).reverse();
  }
  { const { planets, share, idle, fx } = frontOf(); out.front = { planets: planets.map(({ id, x, y, share, ships, flags }) => ({ id, x, y, share, ships, flags })), share, idle, fx }; }
  if (isAdmin) {
    out.mailEnabled = mailEnabled;
    out.mailInfo = mailEnabled ? { user: MAIL.user, from: MAIL.from, host: MAIL.host, port: MAIL.port, passLength: MAIL.pass.length } : null; // to spot a wrong paste, never the password itself
    out.commentary = { provider: provider(), last: lastStatus };
    out.players = Object.values(S.players).map((p) => ({ ...p, inbox: p.inbox.length, left: p.points - spent(p) }));
    out.config = { factions: S.factions, armies: S.armies, targets: S.targets.map(({ id, kind, name, specialty, nature, fx, multiplier, x, y, lbl, planetId, side, tiers }) => ({ id, kind, name, specialty, nature, fx, multiplier, x, y, lbl, planetId, side, tiers: tiers.map((pa) => ({ id: pa.id, threshold: pa.threshold, label: pa.label, title: pa.title, docs: docsOf(pa), teaser: pa.teaser, shared: pa.shared })) })) };
  }
  return out;
}

// What a spectator may see, without any code: the planets and each camp's score and number of tiers won. Nothing about players, reports, rules or prizes.
// The visitor gets no figure at all: the share of each camp on a planet (for the balance bar) and a chronicle written by two scribes,
// one on each side, from what is already public (who leads where, who has won more tiers). Never the content of a tier.
const names = (l) => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`);
const SCRIBES = { loyalist: 'Frère Hesper, archiviste de l’Ordo Astronomica', renegade: 'Le Scribe de la Fosse' };
function chronicle(planets, tot) {
  const sum = tot.loyalist + tot.renegade, share = sum ? tot.loyalist / sum : 0.5;
  const held = (side) => names(planets.filter((p) => p.lead === side).map((p) => p.name));
  if (planets.every((p) => p.lead === 'none')) {
    return [{ camp: 'loyalist', author: SCRIBES.loyalist, text: 'Les vaisseaux d’éclairage ont quitté l’orbite, mais aucune bannière n’a encore été plantée dans le Système Smaragdus. L’Empereur attend, et l’Imperium avec lui.' },
      { camp: 'renegade', author: SCRIBES.renegade, text: 'Le silence règne sur la frontière. Les loups affûtent leurs lames : celui qui frappera le premier écrira l’histoire de ce système.' }];
  }
  const lw = held('loyalist'), rw = held('renegade');
  const tiers = Math.sign(tot.tiersLoyalist - tot.tiersRenegade);
  const mood = share > 0.62 ? 1 : share < 0.38 ? -1 : 0;
  const hesper = [
    mood > 0 ? 'Je consigne avec une fierté mesurée que les armées de l’Imperium tiennent l’initiative sur la frontière de Smaragdus.'
      : mood < 0 ? 'Je consigne, la plume lourde, que les Renégats gagnent du terrain sur la frontière de Smaragdus.'
      : 'Je consigne que la balance vacille sur la frontière de Smaragdus : nul ne peut encore dire qui l’emportera.',
    lw && `Nos bannières flottent plus haut sur ${lw}.`, rw && `L’ennemi s’accroche à ${rw}.`,
    tiers > 0 ? 'Nos équipes de reconnaissance arrachent les secrets de ces mondes avant l’adversaire.' : tiers < 0 ? 'Les secrets de ces mondes tombent plus souvent entre des mains renégates : il faut redoubler d’efforts.' : 'Les secrets de ces mondes se dévoilent à égalité entre les deux camps.',
  ].filter(Boolean).join(' ');
  const fosse = [
    mood < 0 ? 'La Fosse se réjouit : les loyalistes reculent, et leurs étendards pourrissent sur les mondes de Smaragdus.'
      : mood > 0 ? 'Les chiens de l’Empereur avancent, mais ils avancent dans une toile que nous tissons.'
      : 'Rien n’est joué, et c’est tant mieux : une guerre indécise nourrit les dieux.',
    rw && `Nous tenons ${rw}.`, lw && `Ils se vantent de ${lw}, pour combien de temps ?`,
    tiers < 0 ? 'Les vieux secrets nous reviennent, comme il se doit.' : tiers > 0 ? 'Ils déterrent des archives avant nous. Qu’ils les lisent : certaines vérités brûlent les yeux.' : '',
  ].filter(Boolean).join(' ');
  return [{ camp: 'loyalist', author: SCRIBES.loyalist, text: hesper }, { camp: 'renegade', author: SCRIBES.renegade, text: fosse }];
}
// What the map shows to everyone, without any score: the share of each camp, a fleet level (0..6) per camp and planet that grows with the points
// against the highest tier of the planet, the tiers won (flags), and how many players still hold points to invest (ships on the move).
function frontOf() {
  const lvl = (n, top) => (n > 0 ? Math.min(6, Math.max(1, Math.ceil((6 * n) / top))) : 0);
  const planets = S.targets.filter((t) => t.kind === 'planet').map((t) => {
    const won = (side) => t.tiers.filter((pa) => pa.unlocked && pa.winnerSide === side).length;
    const l = sideTotal(t, 'loyalist'), r = sideTotal(t, 'renegade'), sum = l + r, share = sum ? l / sum : null, top = Math.max(1, ...t.tiers.map((pa) => pa.threshold));
    return { id: t.id, name: t.name, x: t.x, y: t.y, lbl: t.lbl, share, lead: share === null ? 'none' : share > 0.6 ? 'loyalist' : share < 0.4 ? 'renegade' : 'even',
      ships: { loyalist: lvl(l, top), renegade: lvl(r, top) }, flags: { loyalist: won('loyalist'), renegade: won('renegade') }, nature: revealedNature({ tiers: t.tiers.filter((pa) => pa.shared) }, null), excerpts: excerptsOf(t), _l: l, _r: r, _tl: won('loyalist'), _tr: won('renegade') };
  });
  const sum = (k) => planets.reduce((n, p) => n + p[k], 0);
  const tot = { loyalist: sum('_l'), renegade: sum('_r'), tiersLoyalist: sum('_tl'), tiersRenegade: sum('_tr') };
  return { planets: planets.map(({ _l, _r, _tl, _tr, ...p }) => p), share: tot.loyalist + tot.renegade ? tot.loyalist / (tot.loyalist + tot.renegade) : null,
    idle: Object.values(S.players).filter((p) => p.points - spent(p) > 0).length, chronicle: chronicle(planets, tot),
    fx: recentFx(), bubbles: recentBubbles() };
}
const publicView = frontOf;

// A part of the story for the visitor: the first lines of the document of each shared tier (first contact) a camp has unlocked. Those are known to both camps;
// the tiers won in a race stay secret from the other camp, so they never reach the public view. Never prizes or rules either.
function excerptsOf(t) {
  return t.tiers.filter((pa) => pa.unlocked && pa.shared).sort((a, b) => a.threshold - b.threshold).map((pa) => {
    const raw = docsOf(pa).find((d) => d.type === 'fluff')?.text || '';
    const clean = raw.split('\n').filter((l) => l.trim() && !/^CLASSIFICATION|^\[\d\d:\d\d:\d\d\]|^\+\+/.test(l.trim())).join(' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const cut = clean.length > 240 ? clean.slice(0, 240).replace(/\s+\S*$/, '') + '…' : clean;
    return { label: pa.label, text: cut };
  }).filter(Boolean);
}

// ---------- effects and commentators ----------
// fx: short-lived visual events (a bomb where a legion power hit). comments: what the two scribes said, shown as bubbles on the visitor's map.
const FX_KEEP = 60_000, BUBBLE_KEEP = 30_000, COMMENT_GAP = 30_000;
const recentFx = () => (S.fx || []).filter((f) => Date.now() - f.t < FX_KEEP).map((f) => ({ id: f.t, type: f.type, planetId: f.planetId, age: Math.floor((Date.now() - f.t) / 1000) }));
const recentBubbles = () => (S.comments || []).filter((c) => Date.now() - c.t < BUBBLE_KEEP).slice(-2).map((c) => ({ id: c.t, camp: c.camp, author: c.author, text: c.text, planetId: c.planetId, age: Math.floor((Date.now() - c.t) / 1000) }));
// What the scribes may know of the log: the last events turned into anonymous sentences (no player, no amount, no tier name),
// from the lines of every scope. Reinforcements only say where and for which camp.
function recentEvents() {
  const out = [], seen = new Set();
  for (const l of S.log) { // newest first
    if (Date.now() - l.t > 20 * 60_000 || out.length >= 8) break;
    let m, e = null;
    if ((m = /^PALIER (.+?) « .* » \(\d+\) franchi par les (Loyalistes|Renégats)/.exec(l.text))) e = `un palier a été franchi sur ${m[1]} par les ${m[2].toLowerCase()}`;
    else if ((m = /^Premier contact établi sur (.+)$/.exec(l.text))) e = `premier contact établi sur ${m[1]}`;
    else if ((m = /→ (.+?) · (Loyaliste|Renégat|Traître) : \+/.exec(l.text))) e = `des renforts ${m[2] === 'Traître' ? 'renégat' : m[2].toLowerCase()}s arrivent sur ${m[1]}`;
    else if ((m = /détruit les points des (Loyalistes|Renégats) sur (.+?) :/.exec(l.text))) e = `les points des ${m[1].toLowerCase()} ont été détruits sur ${m[2]}`;
    if (e && !seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}
let lastComment = 0, commenting = false, lastStatus = null; // lastStatus: what the last comment came from, for the admin
// A stimulus (points invested, points given, power used, or a timer) may make a scribe speak: at most one comment every 30 seconds,
// and only some stimuli trigger one (a power always does). The text only carries public facts.
function stimulate(kind, { planet = null, side = null, force = false } = {}) {
  const now = Date.now();
  if (commenting || now - lastComment < COMMENT_GAP || (!force && Math.random() > 0.45)) return;
  commenting = true; lastComment = now;
  const f = frontOf(), lead = (side) => names(f.planets.filter((p) => p.lead === side).map((p) => p.name));
  const situation = f.planets.every((p) => p.lead === 'none') ? 'aucun camp ne tient encore de monde'
    : `les loyalistes dominent ${lead('loyalist') || 'aucun monde'} ; les renégats dominent ${lead('renegade') || 'aucun monde'}`;
  const camp = side || (Math.random() < 0.5 ? 'loyalist' : 'renegade');
  comment({ kind, camp, planet: planet && { id: planet.id, name: planet.name }, situation, events: recentEvents() })
    .then(({ source, error, ...c }) => { lastStatus = { at: Date.now(), source, error }; (S.comments ??= []).push({ ...c, t: Date.now() }); S.comments.splice(0, Math.max(0, S.comments.length - 30)); save(); broadcast(); })
    .catch((e) => console.error('Commentary failed:', e.message))
    .finally(() => { commenting = false; });
}
setInterval(() => { if (Object.values(S.players).some((p) => spent(p) > 0)) stimulate('idle'); }, 4 * 60_000).unref();


function auth(req) {
  const tok = String(req.headers['x-token'] || '');
  const a = Buffer.from(tok), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { role: 'admin' };
  const p = Object.values(S.players).find((q) => q.code.toLowerCase() === tok.toLowerCase()); // codes are case-insensitive
  return p ? { role: 'player', me: p } : null;
}

// ---------- mail ----------
// Sends the players' links by SMTP (Infomaniak by default). Credentials only come from the environment, never from the repository.
// nodemailer is loaded on the first send, so the game runs without it when mail is not configured.
const MAIL = { host: process.env.SMTP_HOST || 'mail.infomaniak.com', port: Number(process.env.SMTP_PORT || 587), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
MAIL.from = process.env.MAIL_FROM || MAIL.user;
const mailEnabled = !!(MAIL.user && MAIL.pass);
let transport = null;
async function sendMail(to, subject, text) {
  if (!mailEnabled) throw new Error('Envoi de mail non configuré (variables SMTP_USER et SMTP_PASS)');
  transport ??= (await import('nodemailer')).default.createTransport({ host: MAIL.host, port: MAIL.port, secure: MAIL.port === 465, requireTLS: MAIL.port === 587, auth: { user: MAIL.user, pass: MAIL.pass } });
  await transport.sendMail({ from: MAIL.from, to, subject, text });
}

// ---------- login throttling ----------
// Failed identifications are counted per address; past the limit the address gets 429 for a minute. The limit is high on purpose:
// the players of an event can share one public address.
const FAILS = new Map(), FAIL_LIMIT = 40, FAIL_WINDOW = 60_000;
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
const blocked = (ip) => { const f = FAILS.get(ip); if (f && Date.now() > f.until) FAILS.delete(ip); return (FAILS.get(ip)?.n ?? 0) >= FAIL_LIMIT; };
const noteFail = (ip) => { const f = FAILS.get(ip) ?? { n: 0, until: Date.now() + FAIL_WINDOW }; f.n++; FAILS.set(ip, f); };
setInterval(() => { for (const [ip, f] of FAILS) if (Date.now() > f.until) FAILS.delete(ip); }, FAIL_WINDOW).unref();

// ---------- HTTP ----------
const clients = new Set();
const broadcast = () => { for (const c of clients) c.write('data: tick\n\n'); };
// SSE comment every 25 s: proxies (Azure) cut idle connections after about 4 minutes
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
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
      if (pa.docs != null && !Array.isArray(pa.docs)) throw new Error(`docs[] attendu: ${pa.id}`);
    }
  }
  if (c.armies != null && !Array.isArray(c.armies)) throw new Error('armies[] attendu');
  for (const a of c.armies || []) {
    if (!a?.name || (a.bonus?.planetId && (!c.targets.some((x) => x.id === a.bonus.planetId && x.kind === 'planet') || !Number.isFinite(Number(a.bonus.pct))))) throw new Error(`légion invalide (nom, bonus): ${a.name}`);
  }
  for (const t of c.targets) if (t.multiplier != null && !(Number(t.multiplier) >= 0)) throw new Error(`multiplicateur invalide: ${t.id}`);
  for (const f of c.factions) {
    if (!f.id || ![null, 'loyalist', 'renegade', 'choice'].includes(f.gauge)) throw new Error(`faction invalide: ${f.id}`);
  }
}

// Documents unlocked by a tier (0..N): fluff text, image, prize, reclassification of the planet, special rule. The flat fields
// (fluff, images, rules, prize, nature) are derived from them, so the rest of the server keeps working on them. A tier saved or imported
// without `docs` (old files, seed-planets.json) gets its documents from those flat fields.
const DOC_TYPES = ['fluff', 'image', 'prize', 'reclass', 'rule'];
const str = (v) => String(v ?? '');
const worldClass = (v) => str(v).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
function docsOf(pa) {
  const blank = { id: '', type: '', title: '', text: '', url: '', caption: '', template: 'standard', cssClass: '', rule: '' };
  if (Array.isArray(pa.docs)) {
    return pa.docs.filter((d) => DOC_TYPES.includes(d?.type)).map((d, i) => ({ ...blank, id: str(d.id) || `${pa.id}-d${i}`, type: d.type, title: str(d.title).slice(0, 200), text: str(d.text), url: /^(\/|https?:\/\/)/.test(str(d.url).trim()) ? str(d.url).trim().slice(0, 500) : '', caption: str(d.caption).slice(0, 300), template: d.template === 'vox' ? 'vox' : 'standard', cssClass: worldClass(d.cssClass), rule: str(d.rule).slice(0, 200) }));
  }
  const out = [];
  if (str(pa.fluff).trim()) out.push({ ...blank, type: 'fluff', text: str(pa.fluff) });
  for (const u of pa.images || []) if (str(u).trim()) out.push({ ...blank, type: 'image', url: str(u) });
  if (str(pa.rules).trim()) out.push({ ...blank, type: 'rule', title: 'Doctrine acquise', text: str(pa.rules) });
  if (str(pa.prize).trim()) out.push({ ...blank, type: 'prize', text: str(pa.prize) });
  if (str(pa.nature).trim()) out.push({ ...blank, type: 'reclass', text: str(pa.nature) });
  return out.map((d, i) => ({ ...d, id: `${pa.id}-d${i}` }));
}
const firstDoc = (docs, type) => docs.find((d) => d.type === type);

// Applies a full configuration (planets, gauges, tiers, legions, factions). What the game recorded (unlocked tiers, winners, camps) is kept by tier id.
function applyConfig(b) {
  validateConfig(b);
  // a faction in use cannot disappear: its players would silently become free-choice players who can invest in either camp
  const lost = Object.values(S.players).find((p) => !b.factions.some((f) => f.id === p.factionId));
  if (lost) throw new Error(`faction « ${lost.factionId} » encore utilisée par ${lost.name}`);
  const old = new Map(S.targets.flatMap((t) => t.tiers.map((pa) => [pa.id, pa])));
  S.factions = b.factions;
  if (b.armies) S.armies = b.armies.map((a) => ({ name: String(a.name), bonus: a.bonus?.planetId ? { planetId: a.bonus.planetId, pct: Number(a.bonus.pct) } : null, wipe: ['loyalist', 'renegade', 'opponent'].includes(a.wipe) ? a.wipe : null }));
  const oldT = new Map(S.targets.map((x) => [x.id, x]));
  S.targets = b.targets.map((t) => ({ ...t, ...(t.kind === 'gauge' ? { adjust: oldT.get(t.id)?.adjust ?? 0 } : {}), tiers: t.kind === 'gauge' ? [] : t.tiers.map((pa) => { // unlock state and prize winner are kept by tier id
    const o = old.get(pa.id), docs = docsOf(pa);
    return { id: pa.id, threshold: Number(pa.threshold), label: str(pa.label), title: str(pa.title), docs, fluff: firstDoc(docs, 'fluff')?.text ?? '', images: docs.filter((d) => d.type === 'image').map((d) => d.url).filter(Boolean), rules: firstDoc(docs, 'rule')?.text ?? '', prize: firstDoc(docs, 'prize')?.text ?? '', nature: firstDoc(docs, 'reclass')?.text ?? '', teaser: str(pa.teaser), shared: !!pa.shared, unlocked: o?.unlocked ?? false, camps: o?.camps ?? [], winnerSide: o?.winnerSide ?? null, winnerId: o?.winnerId ?? null, winnerName: o?.winnerName ?? null };
  }) }));
  for (const t of S.targets) if (t.kind === 'planet') settle(t); // new thresholds or prizes can unlock tiers right away
  logEvt('Configuration mise à jour');
}

// Import of planets, in the format of seed-planets.json. Planets with a known id are updated, new ones are created with their two gauges,
// planets missing from the file are kept. Points, investments and tiers already won are kept.
const PLANET_FIELDS = ['name', 'specialty', 'nature', 'fx', 'lbl', 'x', 'y', 'multiplier'];
function importPlanets(list) {
  if (!Array.isArray(list) || !list.length || !list.every((p) => p && p.id && p.name && Array.isArray(p.tiers))) throw new Error('Format attendu : une liste de planètes avec id, name et tiers[]');
  for (const p of list) {
    if (S.targets.some((t) => t.id === p.id && t.kind !== 'planet')) throw new Error(`${p.id} : cet identifiant est celui d'une jauge`);
    for (const k of ['x', 'y']) if (k in p && !(Number(p[k]) >= 0 && Number(p[k]) <= 100)) throw new Error(`${p.id} : ${k} doit être un pourcentage entre 0 et 100`);
  }
  const targets = S.targets.map((t) => {
    const p = t.kind === 'planet' && list.find((x) => x.id === t.id);
    return p ? { ...t, ...Object.fromEntries(PLANET_FIELDS.filter((k) => k in p).map((k) => [k, p[k]])), tiers: p.tiers } : t;
  });
  const added = list.filter((p) => !S.targets.some((t) => t.id === p.id));
  for (const p of added) targets.push(planetOf(p), ...gaugesOf(p));
  applyConfig({ factions: S.factions, armies: S.armies, targets });
  return { updated: list.length - added.length, added: added.length };
}

// Import of players, in the format of seed-players.json (matched by id, then by code). Points and investments are kept; players missing from the file are kept.
const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;
function importPlayers(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Format attendu : une liste de joueurs');
  const prepared = list.map((x, i) => {
    const name = String(x?.name || '').trim().slice(0, 40), code = String(x?.code || '').trim().toLowerCase(), factionId = x?.factionId;
    if (!name) throw new Error(`Joueur n°${i + 1} : nom requis`);
    if (!CODE_RE.test(code)) throw new Error(`${name} : code invalide (4 à 32 caractères : lettres, chiffres, - ou _)`);
    if (code === ADMIN_PASSWORD.toLowerCase()) throw new Error(`${name} : ce code est réservé`);
    if (factionId && !S.factions.some((f) => f.id === factionId)) throw new Error(`${name} : faction inconnue (${factionId})`);
    const existing = S.players[x.id] || Object.values(S.players).find((p) => p.code.toLowerCase() === code);
    // only the fields present in the file are written: a file with just names and codes keeps the other data of existing players
    const fields = { name, code };
    if (factionId) fields.factionId = factionId;
    if (x.fluffName !== undefined) fields.fluffName = String(x.fluffName).trim().slice(0, 200);
    if (x.email !== undefined) fields.email = String(x.email).trim();
    if (x.army !== undefined) fields.army = String(x.army);
    return { x, code, existing, fields };
  });
  const finalCodes = new Map(Object.values(S.players).map((p) => [p.id, p.code.toLowerCase()])); // every code must stay unique once the import is applied
  prepared.forEach((p, i) => finalCodes.set(p.existing?.id ?? `new-${i}`, p.code));
  const seen = new Set();
  for (const code of finalCodes.values()) { if (seen.has(code)) throw new Error(`Le code « ${code} » serait utilisé par deux joueurs`); seen.add(code); }
  let added = 0, updated = 0;
  for (const { x, existing, fields } of prepared) {
    if (existing) { Object.assign(existing, fields); updated++; continue; }
    const id = x.id && !S.players[x.id] ? String(x.id) : crypto.randomUUID();
    S.players[id] = { id, factionId: 'neutral', fluffName: '', email: '', army: '', ...fields, points: 0, alloc: {}, abilityUsed: false, inbox: [] };
    added++;
  }
  logEvt(`Import de joueurs : ${added} ajouté${added > 1 ? 's' : ''}, ${updated} mis à jour`);
  return { added, updated };
}

// ---------- lost code ----------
// A player who lost their code types their address on the login page. The answer is the same whether the address is known or not, and
// it comes at once (the mail is sent afterwards), so nobody can probe which addresses exist. Limits: 5 requests per address (IP) per
// 10 minutes, and one mail per player address per 10 minutes. The admin log only says whether the address was known, never the address.
const SITE_URL = process.env.PUBLIC_URL || 'https://smaragdus.antredudragon.fr';
const LOST_IP = new Map(), LOST_MAIL = new Map(), LOST_WINDOW = 10 * 60_000;
setInterval(() => { const now = Date.now(); for (const m of [LOST_IP, LOST_MAIL]) for (const [k, f] of m) if (now > f.until) m.delete(k); }, LOST_WINDOW).unref();
const hit = (map, key, max) => { const now = Date.now(), f = map.get(key); if (!f || now > f.until) { map.set(key, { n: 1, until: now + LOST_WINDOW }); return true; } return ++f.n <= max; };
const AMBIGUOUS = { 0: '0 est le chiffre zéro', o: 'o est la lettre O minuscule', 1: '1 est le chiffre un', l: 'l est la lettre L minuscule', i: 'i est la lettre I minuscule' };
function lostCodeMail(players) {
  const lines = players.map((p) => {
    const amb = [...new Set([...p.code].filter((c) => AMBIGUOUS[c]))].map((c) => AMBIGUOUS[c]);
    return `- ${p.fluffName || p.name} : ${p.code}${amb.length ? `\n  (attention : ${amb.join(' ; ')})` : ''}\n  ${SITE_URL}/?code=${p.code}`;
  });
  return `Salutations,\n\nLe cogitateur a reçu une demande de rappel de sigil pour cette adresse. ${players.length > 1 ? 'Voici les sigils associés' : 'Voici votre sigil'} :\n\n${lines.join('\n\n')}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nGloire à l'Empereur... ou à qui vous savez.`;
}
function lostCode(email, ip) {
  const known = Object.values(S.players).filter((p) => (p.email || '').trim().toLowerCase() === email);
  logEvt(`Code perdu demandé : adresse ${known.length ? 'connue' : 'inconnue'}`);
  if (!known.length || !mailEnabled || !hit(LOST_MAIL, email, 1)) return;
  sendMail(email, 'Système Smaragdus : votre sigil d\'accès', lostCodeMail(known)).catch((e) => console.error('Lost-code mail failed:', e.message));
}

async function body(req) {
  let s = '';
  for await (const ch of req) { s += ch; if (s.length > 1e6) throw new Error('Corps trop gros'); }
  return s ? JSON.parse(s) : {};
}

S.comments ??= []; S.fx ??= [];
for (const t of S.targets) if (t.kind === 'gauge') t.name = t.name.replace(/Traître$/, 'Renégat'); // names saved before the rename
for (const f of S.factions) if (f.name === 'Traître') f.name = 'Renégat';
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
    if (url.pathname === '/api/public') return send(res, 200, publicView());
    if (req.method === 'POST' && url.pathname === '/api/lost-code') {
      const email = String((await body(req)).email || '').trim().toLowerCase();
      if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'Adresse mail invalide' });
      if (!hit(LOST_IP, clientIp(req), 5)) return send(res, 429, { error: 'Trop de demandes : réessayez dans quelques minutes.' });
      lostCode(email);
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      const ip = clientIp(req);
      if (blocked(ip)) return send(res, 429, { error: 'Trop de tentatives : réessayez dans une minute.' });
      const a = auth(req);
      if (!a) { noteFail(ip); return send(res, 401, { error: 'Sigil refusé' }); }
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/state') return send(res, 200, view(a.role, a.me));
      const b = await body(req);
      const reply = { ok: true };
      if (route === 'POST /api/allocate') {
        let p = a.me;
        if (a.role === 'admin') p = S.players[b.playerId];
        if (!p) throw new Error('Joueur inconnu');
        const t = S.targets.find((x) => x.id === b.targetId);
        if (!t) throw new Error('Cible inconnue');
        allocate(p, t, int(b.amount));
        stimulate('invest', { planet: S.targets.find((x) => x.id === t.planetId) || t, side: t.side });
      } else if (route === 'POST /api/ability') {
        const p = a.role === 'admin' ? S.players[b.playerId] : a.me;
        if (!p) throw new Error('Joueur inconnu');
        const t = S.targets.find((x) => x.id === b.targetId);
        if (!t || t.kind !== 'planet') throw new Error('Planète inconnue');
        wipe(p, t);
        (S.fx ??= []).push({ t: Date.now(), type: 'bomb', planetId: t.id }); S.fx.splice(0, Math.max(0, S.fx.length - 20));
        stimulate('power', { planet: t, side: fixedSide(p), force: true });
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
        if (n > 0) stimulate('grant');
      } else if (route === 'POST /api/admin/set-points') {
        // correction of a mistake: the total of a player is set to a value (never below what they already invested)
        const p = S.players[b.playerId];
        if (!p) throw new Error('Joueur inconnu');
        const n = int(b.points);
        if (n < 0) throw new Error('Valeur négative impossible');
        if (n < spent(p)) throw new Error(`Impossible : ${p.name} a déjà investi ${spent(p)} points`);
        logEvt(`Correction : points de ${p.name} fixés à ${n} (avant : ${p.points})`);
        p.points = n;
      } else if (route === 'POST /api/admin/set-gauge') {
        // correction of a camp's score on a planet: the gap to the points really invested is kept as an adjustment
        const g = S.targets.find((x) => x.id === b.targetId && x.kind === 'gauge');
        if (!g) throw new Error('Jauge inconnue');
        const value = Number(b.value);
        if (!Number.isFinite(value) || value < 0) throw new Error('Valeur invalide');
        const planet = planetOfGauge(g);
        g.adjust = Math.round((value - rawSide(planet, g.side)) * 1e4) / 1e4;
        logEvt(`Correction : score ${SIDE_NAME[g.side]} sur ${planet.name} fixé à ${value}`);
        settle(planet); // a higher score can win tiers; a lower one never takes a won tier back
      } else if (route === 'POST /api/admin/faction') {
        const p = S.players[b.playerId];
        if (!p || !S.factions.some((f) => f.id === b.factionId)) throw new Error('Joueur ou faction inconnu');
        p.factionId = b.factionId;
      } else if (route === 'POST /api/admin/mail') {
        // the recipient is always the address saved for the player, never one taken from the request
        const p = S.players[b.playerId];
        if (!p) throw new Error('Joueur inconnu');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || '')) throw new Error(`Pas d'adresse mail valide pour ${p.name}`);
        const subject = String(b.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200), text = String(b.body || '').slice(0, 20000);
        if (!subject || !text.trim()) throw new Error('Objet et texte requis');
        try { await sendMail(p.email, subject, text); } catch (e) { console.error(`Mail to ${p.email}:`, e.message); throw new Error(`Échec de l’envoi du mail : ${e.message}`); }
        p.mailedAt = Date.now();
        logEvt(`Mail envoyé à ${p.name} (${p.email})`);
      } else if (route === 'POST /api/admin/mail-test') {
        const to = String(b.to || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Adresse invalide');
        try { await sendMail(to, 'Système Smaragdus : test d\'envoi', 'Si vous lisez ce message, l\'envoi de mail du Système Smaragdus fonctionne.'); } catch (e) { console.error('Mail test:', e.message); throw new Error(`Échec de l’envoi du mail : ${e.message}`); }
        reply.sent = true;
      } else if (route === 'POST /api/admin/commentary-test') {
        // one comment on demand, not shown on the map: tells whether the API answers or the phrase banks are used
        const f = frontOf();
        const c = await comment({ kind: 'idle', camp: Math.random() < 0.5 ? 'loyalist' : 'renegade', planet: null, situation: f.planets.every((p) => p.lead === 'none') ? 'aucun camp ne tient encore de monde' : 'la bataille fait rage', events: recentEvents() });
        lastStatus = { at: Date.now(), source: c.source, error: c.error };
        Object.assign(reply, { text: c.text, author: c.author, source: c.source, error: c.error });
      } else if (route === 'POST /api/admin/reset') {
        // Reset game: investments, winners, log. Config is kept.
        for (const t of S.targets) for (const pa of t.tiers) { pa.winnerId = pa.winnerName = pa.winnerSide = null; pa.unlocked = false; pa.camps = []; }
        if (b.deletePlayers) S.players = {};
        else for (const p of Object.values(S.players)) { p.alloc = {}; p.abilityUsed = false; p.inbox = []; }
        S.log = []; S.fx = []; S.comments = [];
        for (const t of S.targets) if (t.kind === 'gauge') t.adjust = 0; // score corrections of the admin go too
        logEvt(b.deletePlayers ? 'RESET complet (joueurs supprimés)' : 'RESET : investissements et gagnants effacés', 'public');
      } else if (route === 'POST /api/admin/delete-player') {
        delete S.players[b.playerId];
      } else if (route === 'POST /api/admin/import-planets') {
        Object.assign(reply, importPlanets(b.planets));
      } else if (route === 'POST /api/admin/import-players') {
        Object.assign(reply, importPlayers(b.players));
      } else if (route === 'PUT /api/admin/config') {
        // the raw JSON may also carry the players (as in seed-players.json): they are imported after the configuration, all or nothing
        const snap = structuredClone(S);
        try { applyConfig(b); if (Array.isArray(b.players) && b.players.length) importPlayers(b.players); } catch (e) { S = snap; throw e; }
      } else return send(res, 404, { error: 'Route inconnue' });
      save(); broadcast();
      return send(res, 200, reply);
    }
    // static files
    const file = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, '');
    const full = path.join(DIR, 'public', file);
    const isFile = full.startsWith(path.join(DIR, 'public') + path.sep) && fs.statSync(full, { throwIfNoEntry: false })?.isFile(); // a directory would crash the stream
    if (!isFile) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    if (e instanceof SyntaxError) return send(res, 400, { error: 'Requête mal formée' }); // JSON that does not parse
    if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError) { // a bug, not a mistake of the player: log it, do not show internals
      console.error(`${req.method} ${req.url}:`, e.stack);
      return send(res, 500, { error: 'Anomalie interne du serveur : l’incident a été consigné.' });
    }
    send(res, 400, { error: e.message });
  }
}).listen(PORT, () => console.log(`Smaragdus listening on http://localhost:${PORT}`));

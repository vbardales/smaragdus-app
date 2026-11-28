// API tests (Node's built-in runner, no dependency): `npm test`.
// Each run starts the server on a random port with a throw-away state file, so nothing touches the real game state.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ADMIN = 'test-admin-pw';
const roster = JSON.parse(fs.readFileSync(path.join(root, 'seed-players.json'), 'utf8'));
let proc, base;

before(async () => {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smaragdus-')), 'data.json');
  base = `http://localhost:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: ADMIN, DATA_FILE: dataFile, SMTP_USER: '', SMTP_PASS: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' } });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
    proc.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
    setTimeout(() => reject(new Error('server did not start')), 8000);
  });
});
after(() => proc?.kill());

async function api(token, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'x-token': token ?? '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const admin = (method, url, body) => api(ADMIN, method, url, body);
const byFaction = (id) => roster.filter((p) => p.factionId === id);
const give = (p, n) => admin('POST', '/api/admin/grant', { playerId: p.id, amount: n });
const invest = (p, target, amount) => api(p.code, 'POST', '/api/allocate', { targetId: target, amount });

// ---------- landing page / identification ----------
test('no code or a wrong code is refused (red message on the page)', async () => {
  assert.equal((await api('', 'GET', '/api/state')).status, 401);
  assert.equal((await api('mauvais', 'GET', '/api/state')).status, 401);
});

test('the admin password gives the admin role', async () => {
  const r = await admin('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.json.role, 'admin');
  assert.ok(Array.isArray(r.json.players) && r.json.config);
});

test('a player code gives the player role, whatever its case', async () => {
  const p = roster[0];
  for (const code of [p.code, p.code.toUpperCase()]) {
    const r = await api(code, 'GET', '/api/state');
    assert.equal(r.status, 200);
    assert.equal(r.json.role, 'player');
    assert.equal(r.json.me.id, p.id);
    assert.equal(r.json.players, undefined, 'a player never gets the player list');
    assert.equal(r.json.config, undefined, 'a player never gets the configuration');
  }
});

test('the player routes are closed to players', async () => {
  const p = roster[0];
  assert.equal((await api(p.code, 'POST', '/api/admin/grant', { playerId: p.id, amount: 5 })).status, 403);
  assert.equal((await api(p.code, 'PUT', '/api/admin/config', {})).status, 403);
});

// ---------- spectator ----------
test('spectator view: reachable without any code, read-only', async () => {
  const pub = await api('', 'GET', '/api/public');
  assert.equal(pub.status, 200);
  assert.equal(pub.json.planets.length, 7);
  assert.equal(pub.json.chronicle.length, 2, 'two chroniclers');
  assert.ok(!/\d/.test(pub.json.chronicle.map((c) => c.text).join(' ')), 'the chronicle has no figure');
  assert.equal((await api('', 'POST', '/api/allocate', { targetId: 'grus-loyalist', amount: 1 })).status, 401, 'a spectator cannot invest');
});

test('spectator view: only short excerpts of unlocked tiers, comments without figures', async () => {
  const pub = (await api('', 'GET', '/api/public')).json;
  for (const p of pub.planets) {
    assert.ok(Array.isArray(p.excerpts));
    for (const x of p.excerpts) assert.ok(x.text.length <= 241, 'an excerpt is short');
  }
  for (const b of pub.bubbles) assert.ok(!/d/.test(b.text), 'a bubble has no figure');
});

test('spectator view: no player data, no report text', async () => {
  const txt = JSON.stringify((await api('', 'GET', '/api/public')).json);
  for (const p of roster) {
    assert.ok(!txt.includes(p.code), 'a code leaks');
    assert.ok(!txt.includes(p.email), 'an email leaks');
  }
  for (const word of ['fluff', 'prize', 'inbox', 'alloc', 'rules']) assert.ok(!txt.includes(word), `${word} leaks`);
});

// ---------- investments ----------
test('investments are bounded by the available points', async () => {
  const p = byFaction('loyalist')[0];
  await give(p, 5);
  const bad = async (amount) => (await invest(p, 'grus-loyalist', amount)).json.error;
  assert.match(await bad(6), /Réserve insuffisante/);
  assert.match(await bad(0), /Montant invalide/);
  assert.match(await bad(2.5), /Entier attendu|Montant invalide/);
  assert.match(await bad(-3), /Montant invalide/);
  const ok = await invest(p, 'grus-loyalist', 5);
  assert.equal(ok.json.ok, true);
  assert.equal((await api(p.code, 'GET', '/api/state')).json.me.points, 0);
  assert.match((await invest(p, 'grus-loyalist', 1)).json.error, /Réserve insuffisante/);
});

test('a player tied to a camp cannot invest in the other camp, nor on a planet directly', async () => {
  const p = byFaction('loyalist')[1];
  await give(p, 5);
  assert.match((await invest(p, 'grus-renegade', 1)).json.error, /Allégeance incompatible/);
  assert.match((await invest(p, 'grus', 1)).json.error, /Choisissez un camp/);
});

// ---------- tiers: who learns what ----------
test('the camp that reaches a threshold first wins the tier, the other camp learns nothing', async () => {
  const [lo] = byFaction('loyalist').slice(2), re = byFaction('renegade')[0];
  await give(lo, 25); await give(re, 25);
  await invest(re, 'leo-renegade', 3);
  await invest(lo, 'leo-loyalist', 22); // first contact (1) and the tier at 20
  const loy = (await api(lo.code, 'GET', '/api/state')).json, ren = (await api(re.code, 'GET', '/api/state')).json;
  const tiers = (s) => s.targets.find((t) => t.id === 'leo').tiers;
  assert.ok(tiers(loy).some((t) => t.winnerSide === 'loyalist'), 'the winners see the tier');
  assert.ok(loy.inbox.length > 0, 'the winners get their reports');
  assert.ok(!tiers(ren).some((t) => t.winnerSide === 'loyalist'), 'the other camp does not see the tier');
  assert.ok(!ren.log.some((l) => /PALIER/.test(l.text)), 'the other camp does not see the log line');
  const pub = (await api('', 'GET', '/api/public')).json;
  assert.ok(pub.planets.find((p) => p.id === 'leo').share > 0.6, 'the spectator sees the loyalist lead on Leo');
  assert.ok(!JSON.stringify(pub).includes('totals'), 'no totals');
});

test('players without a fixed camp get the notice of a won tier, not the full report', async () => {
  const free = byFaction('neutral')[0], lo = byFaction('loyalist')[4];
  await give(lo, 25);
  await invest(lo, 'phoenix-loyalist', 22); // a tier is won here, whatever the other tests did
  const s = (await api(free.code, 'GET', '/api/state')).json;
  assert.ok(s.inbox.some((m) => m.teaser), 'a teaser is delivered');
  assert.ok(s.inbox.every((m) => m.teaser), 'and only teasers (the player has not invested)');
});

test('unlocked tiers stay hidden from players: not even their number is sent', async () => {
  const p = byFaction('loyalist')[3];
  const s = (await api(p.code, 'GET', '/api/state')).json;
  assert.ok(s.targets.every((t) => !t.tiers.some((x) => x.hidden)));
});

// ---------- import (admin) ----------
test('importing planets keeps points and won tiers', async () => {
  const before = (await admin('GET', '/api/state')).json;
  const planets = before.config.targets.filter((t) => t.kind === 'planet').map(({ id, name, specialty, nature, fx, lbl, x, y, tiers }) => ({ id, name, specialty, nature, fx, lbl, x, y, tiers }));
  planets.find((p) => p.id === 'cancer').x = 12.5;
  const r = await admin('POST', '/api/admin/import-planets', { planets });
  assert.equal(r.json.updated, 7);
  const after = (await admin('GET', '/api/state')).json;
  assert.equal(after.config.targets.find((t) => t.id === 'cancer').x, 12.5);
  assert.equal(after.targets.find((t) => t.id === 'leo').tiers.filter((t) => t.unlocked).length, before.targets.find((t) => t.id === 'leo').tiers.filter((t) => t.unlocked).length);
  assert.match((await admin('POST', '/api/admin/import-planets', { planets: [{ id: 'grus-loyalist', name: 'x', tiers: [] }] })).json.error, /jauge/);
});

test('importing players keeps the fields the file does not mention', async () => {
  const p = roster[5];
  const r = await admin('POST', '/api/admin/import-players', { players: [{ id: p.id, name: p.name, code: p.code }] });
  assert.deepEqual(r.json, { ok: true, added: 0, updated: 1 });
  const after = (await admin('GET', '/api/state')).json.players.find((x) => x.id === p.id);
  assert.equal(after.email, p.email);
  assert.equal(after.army, p.army);
  assert.equal(after.fluffName, p.fluffName);
  assert.equal(after.factionId, p.factionId);
});

test('typed documents are kept, sanitized, and old flat fields are migrated into documents', async () => {
  const cfg = (await admin('GET', '/api/state')).json.config;
  const planet = cfg.targets.find((x) => x.kind === 'planet');
  const tier = planet.tiers[1];
  assert.ok(Array.isArray(tier.docs), 'the config exposes documents');
  tier.docs = [{ type: 'image', url: '/img/x.webp', caption: 'Légende', cssClass: 'Grus Sombre!' }, { type: 'bogus', text: 'x' }, { type: 'prize', text: 'Un lot' }];
  assert.equal((await admin('PUT', '/api/admin/config', cfg)).status, 200);
  const back = (await admin('GET', '/api/state')).json.config.targets.find((x) => x.id === planet.id).tiers.find((x) => x.id === tier.id);
  assert.deepEqual(back.docs.map((d) => d.type), ['image', 'prize'], 'unknown types are dropped');
  assert.equal(back.docs[0].cssClass, 'grussombre', 'the world class is sanitized');
  const old = structuredClone(cfg); const o = old.targets.find((x) => x.id === planet.id).tiers.find((x) => x.id === tier.id);
  delete o.docs; o.fluff = 'Texte'; o.images = ['/img/y.webp']; o.nature = 'Monde mort';
  assert.equal((await admin('PUT', '/api/admin/config', old)).status, 200);
  const mig = (await admin('GET', '/api/state')).json.config.targets.find((x) => x.id === planet.id).tiers.find((x) => x.id === tier.id);
  assert.deepEqual(mig.docs.map((d) => d.type), ['fluff', 'image', 'reclass']);
});

test('a configuration cannot drop a faction that players still use', async () => {
  const cfg = (await admin('GET', '/api/state')).json.config;
  cfg.factions = cfg.factions.filter((f) => f.id !== 'loyalist');
  const r = await admin('PUT', '/api/admin/config', cfg);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /encore utilisée/);
});

test('importing players refuses duplicate codes before changing anything', async () => {
  const r = await admin('POST', '/api/admin/import-players', { players: [{ name: 'A', code: 'dupcode1' }, { name: 'B', code: 'dupcode1' }] });
  assert.match(r.json.error, /deux joueurs/);
  assert.equal((await api('dupcode1', 'GET', '/api/state')).status, 401);
});

// ---------- unknown errors ----------
test('a malformed request answers 400 in French, a server bug answers 500 without internals', async () => {
  const bad = await fetch(base + '/api/admin/config', { method: 'PUT', headers: { 'x-token': ADMIN, 'Content-Type': 'application/json' }, body: '{pas du json' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Requête mal formée');
  const bug = await admin('PUT', '/api/admin/config', { factions: [], targets: [null] }); // makes the server code throw a TypeError
  assert.equal(bug.status, 500);
  assert.match(bug.json.error, /Anomalie interne/);
  assert.ok(!/undefined|null|TypeError/.test(bug.json.error), 'no internals');
  assert.equal((await api('', 'GET', '/api/public')).status, 200, 'the server is still alive');
});

// ---------- static files ----------
test('static files: a folder or a data file is never served', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/map.webp')).status, 200);
  assert.equal((await fetch(base + '/img')).status, 404, 'a directory must not crash the server');
  assert.equal((await fetch(base + '/seed-players.json')).status, 404);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
  assert.equal((await fetch(base + '/')).status, 200, 'the server is still alive');
});

// ---------- services ----------
test('admin services: mail test refuses without SMTP, commentary test answers with its source', async () => {
  assert.equal((await api('x', 'POST', '/api/admin/commentary-test', {})).status, 401);
  const mail = await admin('POST', '/api/admin/mail-test', { to: 'quelquun@example.org' });
  assert.equal(mail.status, 400, 'no SMTP in the tests');
  assert.match(mail.json.error, /Échec|non configuré/i);
  assert.equal((await admin('POST', '/api/admin/mail-test', { to: 'pas-une-adresse' })).status, 400);
  const c = await admin('POST', '/api/admin/commentary-test', {});
  assert.equal(c.status, 200);
  assert.equal(c.json.source, 'banks', 'no API key in the tests');
  assert.ok(c.json.text.length > 10 && !/[0-9]/.test(c.json.text));
  const st = (await admin('GET', '/api/state')).json;
  assert.equal(st.commentary.provider, null);
  assert.equal(st.commentary.last.source, 'banks');
  assert.equal((await api(roster[0].code, 'GET', '/api/state')).json.commentary, undefined, 'a player does not see the services');
});

// ---------- corrections ----------
test('admin corrections: player total and planet score can be set, never below what was invested', async () => {
  assert.equal((await admin('POST', '/api/admin/player', { name: 'Correction', code: 'correction-test', factionId: 'loyalist' })).status, 200);
  const p = { id: (await admin('GET', '/api/state')).json.players.find((x) => x.code === 'correction-test').id, code: 'correction-test' };
  await give(p, 10);
  await invest(p, 'scorpius-loyalist', 4);
  const st = async () => (await admin('GET', '/api/state')).json;
  assert.equal((await admin('POST', '/api/admin/set-points', { playerId: p.id, points: 2 })).status, 400, 'below the invested points');
  assert.equal((await admin('POST', '/api/admin/set-points', { playerId: p.id, points: 7 })).status, 200);
  assert.equal((await st()).players.find((x) => x.id === p.id).points, 7);
  assert.equal((await api(p.code, 'POST', '/api/admin/set-points', { playerId: p.id, points: 99 })).status, 403, 'a player cannot');
  assert.equal((await admin('POST', '/api/admin/set-gauge', { targetId: 'scorpius-loyalist', value: 12 })).status, 200);
  const g = (await st()).targets.find((x) => x.id === 'scorpius-loyalist');
  assert.equal(g.total, 12, 'the score is the one typed');
  assert.equal((await admin('POST', '/api/admin/set-gauge', { targetId: 'scorpius-loyalist', value: -1 })).status, 400);
  assert.equal((await admin('POST', '/api/admin/set-gauge', { targetId: 'scorpius', value: 3 })).status, 400, 'a planet is not a gauge');
  await admin('POST', '/api/admin/set-gauge', { targetId: 'scorpius-loyalist', value: 12 });
  assert.equal((await admin('POST', '/api/admin/reset', {})).status, 200);
  const after = (await st()).targets.find((x) => x.id === 'scorpius-loyalist');
  assert.equal(after.total, 0, 'a reset also drops the score corrections');
});

test('the visitor view carries the scribes\' opinion of each planet, without figures', async () => {
  const pub = (await api('', 'GET', '/api/public')).json;
  for (const p of pub.planets) {
    assert.ok(Array.isArray(p.opinions));
    for (const o of p.opinions) assert.ok(!/[0-9]/.test(o.text), 'an opinion has no figure');
  }
});

test('the visitor view only shows the excerpts of shared tiers, and image links are limited to http(s) or site paths', async () => {
  const pub = (await api('', 'GET', '/api/public')).json;
  assert.ok(pub.planets.every((p) => Array.isArray(p.excerpts)));
  const cfg = (await admin('GET', '/api/state')).json.config;
  const tier = cfg.targets.find((x) => x.kind === 'planet').tiers[1];
  tier.docs = [{ type: 'image', url: 'javascript:alert(1)' }];
  assert.equal((await admin('PUT', '/api/admin/config', cfg)).status, 200);
  const back = (await admin('GET', '/api/state')).json.config.targets.find((x) => x.kind === 'planet').tiers[1];
  assert.equal(back.docs[0].url, '', 'a javascript: link is dropped');
});

test('the configuration JSON may carry players: imported with the configuration, all or nothing', async () => {
  const cfg = (await admin('GET', '/api/state')).json.config;
  const bad = await admin('PUT', '/api/admin/config', { ...cfg, players: [{ name: 'Sans code', code: 'x' }] });
  assert.equal(bad.status, 400, 'an invalid player refuses the whole file');
  const ok = await admin('PUT', '/api/admin/config', { ...cfg, players: [{ name: 'Joueur JSON', code: 'json-player-1', factionId: 'neutral' }] });
  assert.equal(ok.status, 200);
  assert.ok((await admin('GET', '/api/state')).json.players.some((p) => p.code === 'json-player-1'));
});

// ---------- themed mail ----------
test('the mail preview is a themed HTML page with a button for the link and the emblem of the camp', async () => {
  const p = byFaction('renegade')[0];
  const r = await admin('POST', '/api/admin/mail-preview', { playerId: p.id, subject: 'Sujet <test>', body: 'Salutations,\n\nVoici un point :\n- un\n- deux\n\nhttps://smaragdus.example/?code=abcd1234\n\nGloire.' });
  assert.equal(r.status, 200);
  assert.match(r.json.html, /<a href="https:\/\/smaragdus.example\/\?code=abcd1234"/, 'the link is a button');
  assert.match(r.json.html, /mail-renegade\.png/, 'the emblem of the camp');
  assert.match(r.json.html, /<li/, 'the list');
  assert.ok(!r.json.html.includes('<test>'), 'the subject is escaped');
  assert.equal((await api(roster[0].code, 'POST', '/api/admin/mail-preview', {})).status, 403);
});

// ---------- lost code ----------
test('lost code: the same answer for a known and an unknown address, a bad format is refused, requests are limited', async () => {
  const post = (email) => fetch(base + '/api/lost-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const known = await post(roster.find((p) => p.email).email), unknown = await post('personne@inconnu.example');
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal((await post('pas-une-adresse')).status, 400);
  let last;
  for (let i = 0; i < 6 && last !== 429; i++) last = (await post('x' + i + '@inconnu.example')).status;
  assert.equal(last, 429, 'the requests of one address are limited');
});

// ---------- login throttling (last: it locks the address of the tests for a minute) ----------
test('too many failed identifications are answered with 429', async () => {
  let last;
  for (let i = 0; i < 60 && last !== 429; i++) last = (await api('devine' + i, 'GET', '/api/state')).status;
  assert.equal(last, 429);
  assert.equal((await api(ADMIN, 'GET', '/api/state')).status, 429, 'the address stays blocked, even with a good code');
  assert.equal((await api('', 'GET', '/api/public')).status, 200, 'the spectator view is not throttled');
});

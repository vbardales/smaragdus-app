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
  proc = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: ADMIN, DATA_FILE: dataFile, SMTP_USER: '', SMTP_PASS: '' } });
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
  assert.deepEqual(Object.keys(pub.json.totals).sort(), ['loyalist', 'renegade', 'tiersLoyalist', 'tiersRenegade']);
  assert.equal((await api('', 'POST', '/api/allocate', { targetId: 'grus-loyalist', amount: 1 })).status, 401, 'a spectator cannot invest');
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
  assert.ok(pub.totals.tiersLoyalist >= 1, 'the spectator counts the tier');
});

test('players without a fixed camp get the notice of a won tier, not the full report', async () => {
  const free = byFaction('neutral')[0];
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

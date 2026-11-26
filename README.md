# Smaragdus

Real-time exploration points webapp (Node >= 18, zero dependencies). State is stored in `data.json`.

## Run

    ADMIN_PASSWORD=... PORT=3000 node server.js

Dev mode (auto-restart on `server.js` changes; static files in `public/` are read per request, so a browser refresh is enough):

    ADMIN_PASSWORD=... npm run dev

`ADMIN_PASSWORD` is required: the server refuses to start without it.
Admin: enter that password on the login page. Players: the admin creates them and sends the `?code=...` link.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | none (required) | admin login |
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `./data.json` | persisted state (keep it on a persistent disk) |
| `RESET_ON_DEPLOY` | on Azure (`WEBSITE_SITE_NAME`), else off | `1` forces the reset below |
| `KEEP_STATE` | unset | `1` freezes the state: no reset on deployment |

A new deployment (any change to `server.js`, `public/index.html` or the `seed-*.json` files) starts from a clean state
when running on Azure: the saved state is replaced by the seed, and the old file is kept once as `<DATA_FILE>.prev`.
A plain restart with the same code keeps the state. **Once the game has started, set `KEEP_STATE=1`** in the app settings,
or the next deployment erases the points.

Single instance only: state lives in memory and is written to `DATA_FILE`.

## Rules implemented

- The admin grants points to each player; players spend them on a planet's loyalist or renegade gauge (final). Loyalist factions invest for the loyalists, renegade ones (and World Eaters) for the renegades; neutral players and the Alpha Legion pick the camp at each investment.
- On each planet the two camps race to the same tier thresholds: the first camp to reach a threshold wins that tier. Tiers stay hidden from players until won.
- A won tier sends a report (title, fluff, images, rules) to the inbox (`Messagerie`) of the winning camp's contributors. If the tier has a `prize`, a draw weighted by points invested in the winning camp picks one winner (name public, prize text private).
- Thresholds and report content are edited live in the admin panel (or in the JSON). Lowering a threshold under a camp's score, or adding a prize to a won tier, takes effect when saved. Images go in `public/img/` and are referenced as `/img/name.webp`.
- Planets, tiers and report texts come from `seed-planets.json` (used when no state file exists). A tier with `shared` is a first contact: no race, both camps get the report at the first points. A tier `nature` changes the planet's displayed nature once won.
- Planet: free-text `specialty` plus a `multiplier` applied to points counted toward tiers. Default roster: `seed-players.json` (used when no state file exists).
- Legions (`armies` in the config): a +25% bonus on one planet, and for some a `wipe` power, once per player: destroys the other players' points on one camp's gauge of a planet.
- The admin can invest on behalf of a player. Existing winners are kept by tier id when the config is saved.

## Deployment

Any Node host with HTTPS in front works. Current setup: Azure App Service (Linux, Node 22, B1) with `DATA_FILE=/home/data.json`
and a CNAME + `asuid` TXT record for the custom domain.

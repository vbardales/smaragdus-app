# Smaragdus

Real-time exploration points webapp (Node >= 18, zero dependencies). State is stored in `data.json`.

## Run

    ADMIN_PASSWORD=... PORT=3000 node server.js

`ADMIN_PASSWORD` is required: the server refuses to start without it.
Admin: enter that password on the login page. Players: the admin creates them and sends the `?code=...` link.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | none (required) | admin login |
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `./data.json` | persisted state (keep it on a persistent disk) |

Single instance only: state lives in memory and is written to `DATA_FILE`.

## Rules implemented

- The admin grants points to each player; players spend them on planets (final).
- Each planet/gauge has tiers with a `mode`: `crosser` (the player who crosses the threshold wins) or `draw` (weighted random draw among all contributors, by points invested).
- A tier reward is visible only to the admin and the winner; label and winner are public.
- Planet: free-text `specialty` plus a `multiplier` applied to points counted toward tiers.
- Factions: bonus points are separate and can only be spent on gauges. `gauge` is `loyalist`, `renegade`, `choice` (player picks at each investment) or `null`.
- The admin can invest on behalf of a player and edit the whole config (JSON) live. Existing winners are kept by tier id.

## Deployment

Any Node host with HTTPS in front works. Current setup: Azure App Service (Linux, Node 22, B1) with `DATA_FILE=/home/data.json`
and a CNAME + `asuid` TXT record for the custom domain.

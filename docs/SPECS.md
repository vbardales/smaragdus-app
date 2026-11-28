# Smaragdus: technical and functional specs

Status tags: **[done]** implemented and covered by `npm test` (`[test]`), **[manual]** implemented, checked by hand only, **[todo]** not done yet.
UI strings are in French (the product language); everything else is in English.

Hosted at `https://smaragdus.antredudragon.fr` (Azure App Service `smaragdus-antre`, deployed by GitHub Actions on push to `main`).

## 1. The three parts

| Part | Who | How they get in | What they can do |
|---|---|---|---|
| **Visitor** (spectator) | anyone | "Accès observateur" button, or `/?view=spectateur` | watch both camps, read-only |
| **User** (player) | registered player | personal code | invest points, read reports, see their camp's news |
| **Admin** | game master | admin password | everything: players, points, content, mails, imports |

A single page (`public/index.html`) serves the three parts; the part is chosen at runtime.

## 2. Landing page

Reached at `/` with no stored session.

| # | Requirement | Status |
|---|---|---|
| 2.1 | Title "Système Smaragdus" with a logo, Warhammer 30K look | [manual] |
| 2.2 | An identification box with a code field, the code is masked | [manual] |
| 2.3 | An eye icon at the end of the field shows the code, then hides it again | [manual] |
| 2.4 | "Accéder" validates the code (also the Enter key) | [manual] |
| 2.5 | Blanks around the code are ignored (`trim`) | [manual] |
| 2.6 | An invalid code shows an alert under the box ("Accès refusé : le cogitateur ne reconnaît pas ce sigil."); an empty field says "Sigil manquant", an unreachable server "Liaison interrompue"; a request with no answer after 20 s is cut ("Le cogitateur tarde à répondre"); the button shows "Vérification…" while the code is checked; an unexpected error says "Erreur inconnue" and is kept in the console; while a code is being checked the button stays blocked (one request, whatever the number of clicks or Enter presses); the alert goes away as soon as the player types again | [manual] server side `[test]` (401) |
| 2.7 | A valid code leads to the player view or the admin view, according to the role | `[test]` role returned by `GET /api/state` |
| 2.8 | Under the box, an "Accès observateur" button leads to the spectator view, whether a code was typed or not | [manual] |
| 2.9 | Decoration: logo, framed panels, diamond headings, motto, footer | [manual] first pass done, more can be added |
| 2.10 | Easter egg | [todo] |
| 2.11 | A "Code perdu" link under the identification box opens an email field. The address is checked for a valid format. Whether the address exists or not, the page answers the same: "si votre email est connu du système, vous recevrez un mail avec votre code en clair". If a player has this address, the code is mailed to them in clear. | [test] |

Codes are case-insensitive and stored in lower case. A code never equals the admin password.

## 2b. Common frame of the three parts

Once in, whichever part was joined, the page has the same top:

- Left: the logo and the title "Système Smaragdus". Right: the role ("Joueur", "Maître de Campagne" or "Observateur") and the "Quitter la console" button, which goes back to the identification (code or password field). On a narrow screen they sit under the title.
- On a narrow screen (up to 900 px) the page is one column, and the first card of the right column comes right under the header, before the map: the player card for a player, the configuration for the admin, the "Situation du front" summary for the visitor (who has no right column). [manual]

## 3. Spectator view

(Layout, common to players and visitors: card or chronicle first, then the map as wide as the screen allows, then a slider with the share of each camp, then the rest. The map carries tiny ships orbiting each planet (more of them as a camp's points grow against the highest tier), flags for the tiers won, ships crossing the map for the players who still hold points, and an invisible easter egg on the sun.)

- Entry: 2.8, or `/?view=spectateur` (the choice is kept in the browser until "Quitter").
- Data: `GET /api/public`, without any code. It returns no figure: per planet the name, the position and the share of the loyalist camp (for the balance bar), plus a chronicle of two scribes (one per camp) generated from who leads where and who has won more tiers.
  It never returns player data (names, codes, emails), report texts, rules, prizes, natures, logs or scores. `[test]`
- Screen: the chronicle first ("Chroniques du front"), then the map with names and balance bars only. No side column, no players, no log, no inbox, no investment.
- Click on a planet: the map zooms on it and a card shows its revealed nature and the first lines of the document of each tier unlocked (never the later ones, nor prizes or rules). Also zoom with the wheel or the + / − buttons, drag to pan. [manual]
- Commentators: two scribes (one per camp) speak in bubbles on the map for 30 seconds, triggered by investments, new points, a legion power (always), or from time to time. The text comes from the Anthropic or OpenAI API when a key is set, otherwise from phrase banks; the prompt only carries public facts and a text with a digit is refused. At most one comment every 30 seconds. [manual]
- Effects: a bomb and a fading scorch where a legion power hit, smoke clouds that grow with the tiers won, and a light that follows the sun through the day (browser time). [manual]
- Live: updated through the SSE stream (`/api/events`), no reload. [manual]
- Cannot act: every write route answers 401 without a code. `[test]`

## 4. Player view

- Map with planet names, each camp's score, and the player's own points. Labels can be hidden by a button; a nature subtitle appears only once discovered.
- A click on a planet opens a pop-in: nature, specialty, scores, tiers visible to the player, investment, legion power.
- Side column: the player card (fluff name, points, faction, legion) then the inbox.
- Investment: on the gauge of the player's camp. The amount is bounded by the available points; a message explains why the button is blocked. The server enforces it too. `[test]`
- Camps: loyalist factions invest for the loyalists, renegade ones for the renegades. Neutrals and the Alpha Legion choose at each investment. `[test]`
- The legion bonus (+25 % on one planet) counts in the camp score and is never shown to the player. `[manual]`
- The warm ambiance (palette, scanlines, glitch) starts once the player has opened a first message. [manual]

## 5. Game rules

- Each planet has tiers with thresholds (20, 30, 40, 50 points, plus a shared "first contact" at 1 point). The first camp whose score reaches a threshold wins the tier. `[test]`
- A won tier sends its report to the contributors of the winning camp, and a short notice ("encart") to the camp's players who did not contribute.
- What is told to whom: the other camp learns nothing about a won tier (the tier, its nature, the log lines). Players without a fixed camp get the notice of every tier. `[test]`
- Unlocked tiers are the only ones sent to players: their number stays secret. `[test]`
- Prizes: a draw weighted by invested points among the winning camp's contributors. **[todo]** rework: the lottery must happen once at the very end, a camp winning all the bonuses of the tiers it unlocks.
- Legion powers: "wipe" once per player. [manual]

## 6. Admin view

- Map and planet pop-in (invest for a player), filterable player table, journal.
- Configuration (folded by default): tier thresholds, tier content, legions, import / export of planets, players and the full config. `[test]` for the imports
- Mails: single or "to everyone" through SMTP (Infomaniak), see README for the variables. [manual]
- Reset buttons, with confirmation.

## 7. Server

- Node, one dependency (`nodemailer`, loaded on the first mail). State in memory, saved to `DATA_FILE`. Single instance.
- Live refresh: SSE stream `/api/events` (a tick after every change, a ping every 25 s).
- Errors: a mistake of the player answers 400 with a French message; malformed JSON answers 400 "Requête mal formée"; a server bug answers 500 "Anomalie interne du serveur" without internals and is logged. `[test]`
- Static files: only files under `public/`; a folder or any file outside is a 404. `[test]`
- A new deployment keeps the state unless `RESET_ON_DEPLOY=1`. `KEEP_STATE=1` freezes it.

## 8. Backlog

1. Easter egg (2.10); more decoration if wanted.
1. (Done) "Code perdu" (2.11): same answer for any address, 5 requests per IP per 10 minutes, one mail per address per 10 minutes.
2. Lottery at the end (section 5).
3. One ship added on the map for each tier unlocked.
4. Wire the `public/*_ambiance.wav` files (one ambiance per planet).
5. Map effects, done: bombs, smoke, sunlight, zoom, bubbles. To refine: real logos, bombs for other kinds of point removal, light by the real sun of the event.

## 9. Tests

`npm test` starts the server on a random port with a throw-away state file and checks the API (`test/api.test.js`): identification and roles, spectator data, investment bounds, who learns what, imports, static files.

Not covered: everything that runs in the browser (eye toggle, red message, pop-ins, ambiance). Next step: a browser test tool such as Playwright, if it is worth the extra dependency.

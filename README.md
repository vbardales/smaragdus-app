# Smaragdus

Webapp temps réel (Node ≥ 18, zéro dépendance). Données dans `data.json`.

## Lancer

    ADMIN_PASSWORD=... PORT=3000 node server.js

`ADMIN_PASSWORD` est obligatoire : le serveur refuse de démarrer sans.
Admin : saisir ce mot de passe sur la page. Joueurs : l'admin les crée et leur envoie le lien `?code=...`.

## Déploiement (smaragdus.antredudragon.fr)

1. DNS : enregistrement A/AAAA de `smaragdus` vers le serveur.
2. Lancer `node server.js` en service (systemd/pm2) avec `ADMIN_PASSWORD` défini.
3. Reverse proxy HTTPS vers le port (Caddy : `smaragdus.antredudragon.fr { reverse_proxy localhost:3000 }`).
   Désactiver le buffering pour `/api/events` (SSE) si nginx : `proxy_buffering off;`.
4. Sauvegarder `data.json` (DATA_FILE pour changer le chemin).

## Règles implémentées

- Points : l'admin en donne à chaque joueur ; le joueur les place sur les planètes (définitif).
- Paliers par planète/jauge : mode `crosser` (le joueur qui franchit gagne) ou `draw` (tirage pondéré par points investis parmi tous les contributeurs).
- Lot d'un palier visible seulement de l'admin et du gagnant ; label et gagnant visibles de tous.
- Planète : `specialty` (texte) + `multiplier` (points comptés ×N pour les paliers).
- Factions : points bonus séparés, utilisables seulement sur les jauges. `gauge` = `loyaliste`, `renegat`, `choix` (Alpha Légion : choisit à chaque investissement) ou `null`.
- Admin peut investir à la place d'un joueur et éditer toute la config (JSON) en direct.

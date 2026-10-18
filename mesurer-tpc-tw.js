// ============================================================
// MESURE BORNÉE de TPC Asie tw (lot TAIWAN, « Traditional Chinese Products ») — par le CLIENT EXISTANT de collecte-cartes/tpc.js
// ============================================================
//   node mesurer-tpc-tw.js --cache=<dossier> --chemins=<chemin1>,<chemin2>,…   (chemins relatifs à https://asia.pokemon-card.com, ex. /tw/card-search/)
// Plafond DUR : 20 requêtes en tout (robots.txt compris, réessais compris), cumulées dans <cache>/compteur.json entre les lancements ; cadence >= 10 s (le Crawl-delay
// de robots.txt si plus grand, par le client) ; AUCUNE image ; arrêt DÉFINITIF (écrit dans <cache>/arret.json, refusé aux lancements suivants) sur 401, 403, 410, 429, défi
// ou page de connexion. Chaque page reçue est gardée dans <cache> (relue ensuite hors ligne). Aucune base, aucun R2 : le verrou global est ici EN MÉMOIRE (rien ne tourne : file à l'arrêt).
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/tpc');

const PLAFOND = 20;
const ARRETS = [401, 403, 410, 429];
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const cache = arg('cache'), chemins = (arg('chemins') || '').split(',').filter(Boolean);
if (!cache || !chemins.length) { console.error('❌ --cache=<dossier> et --chemins=<…> obligatoires'); process.exit(2); }
if (chemins.some(c => !c.startsWith('/tw/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(c))) { console.error('❌ seulement des pages /tw/…, jamais une image'); process.exit(2); }
fs.mkdirSync(cache, { recursive: true });
const F = n => path.join(cache, n);
const lireJson = (n, defaut) => fs.existsSync(F(n)) ? JSON.parse(fs.readFileSync(F(n), 'utf8')) : defaut;
const etat = lireJson('compteur.json', { requetes: 0, journal: [] });
const sauver = () => fs.writeFileSync(F('compteur.json'), JSON.stringify(etat, null, 1));
if (fs.existsSync(F('arret.json'))) { console.error(`⛔ arrêt définitif déjà écrit : ${fs.readFileSync(F('arret.json'), 'utf8')} — aucune requête`); process.exit(3); }
const arreter = motif => { fs.writeFileSync(F('arret.json'), JSON.stringify({ motif, le: new Date().toISOString() })); };

const transport = {
    async get(url, o) {
        if (etat.requetes >= PLAFOND) throw new Error(`plafond de ${PLAFOND} requêtes atteint — aucune requête de plus`);
        etat.requetes++;
        const r = await T.transportFetch.get(url, o);
        etat.journal.push({ url, status: r.status, le: new Date().toISOString() });
        sauver();
        const login = r.location && /login|signin|connexion|member/i.test(r.location);
        if (ARRETS.includes(r.status) || login) { arreter(`HTTP ${r.status}${login ? ` (connexion : ${r.location})` : ''} sur ${url}`); throw Object.assign(new Error(`arrêt définitif : HTTP ${r.status} sur ${url}`), { bloque: true }); }
        return r;
    }
};
const verrou = { tenu: true, perdu: false };
(async () => {
    const client = T.fabriquerClientTpc({ site: 'tpc-asie', transport, verrou });
    try {
        for (const c of chemins) {
            const h = await client.page(c);
            const nom = c.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.html';
            if (h == null) { console.log(`404/410 ${c}`); continue; }
            fs.writeFileSync(F(nom), h);
            console.log(`ok ${c} → ${nom} (${h.length} octets)`);
        }
    } catch (e) { if (e.bloque && !fs.existsSync(F('arret.json'))) arreter(e.message); console.error(`⛔ ${e.message}`); process.exitCode = 1; }
    console.log(`requêtes faites : ${etat.requetes}/${PLAFOND} · statuts ${JSON.stringify(client.statuts())} · cadence ${client.cadence()} ms`);
})();

// plan-cardtrader.js — énumérer (sitemaps) puis apparier (plan), SANS image et SANS écriture en base. Voir collecte-cartes/cardtrader.js.
//   node plan-cardtrader.js --sonder=<url> --cache=<dossier> --plafond=<n>       (une adresse, pour lire la forme d'un fichier)
//   node plan-cardtrader.js --enumerer --cache=<dossier> --plafond=<n>
//   node plan-cardtrader.js --plan --cache=<dossier>                             (0 requête)
// Le plafond est un TOTAL pour le dossier de cache : les réponses déjà en cache le consomment (une réponse en cache n'est jamais redemandée).
'use strict';
const fs = require('fs');
const path = require('path');
const CT = require('./collecte-cartes/cardtrader');

const AUTORISES = [/^--sonder=https:\/\/www\.cardtrader\.com\/\S*$/, /^--enumerer$/, /^--plan$/, /^--cache=.+$/, /^--plafond=\d{1,3}$/, /^--sortie=.+$/];
const args = process.argv.slice(2);
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const nbCache = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json') && /^[0-9a-f]{16}-/.test(f)).length : 0);

/** Filtre des entrées de sitemap : adresse de page ou d'image qui mentionne une expansion utile. */
const UTILE = /prize-pack|world-championship|battle-academy/i;

async function enumerer({ dossier, plafondTotal, sonder = null }) {
    const deja = nbCache(dossier);
    const cli = CT.fabriquerClient({ dossierCache: dossier, plafond: Math.max(plafondTotal - deja, 1) });
    // un plafond déjà consommé par le cache : on ne part pas (le client exige >= 1, la 1re requête réelle serait refusée plus bas)
    const reste = plafondTotal - deja;
    const journal = { requetesCeRun: 0, dejaEnCache: deja, plafondTotal, arret: null };
    try {
        if (sonder) {
            await cli.initialiserRobots();
            const r = await cli.lire(sonder);
            journal.requetesCeRun = cli.requetes();
            return { journal, r };
        }
        await cli.initialiserRobots();
        const declares = CT.sitemapsDesRobots(cli.texteRobots());
        return { journal: { ...journal, requetesCeRun: cli.requetes(), declares, reste }, cli, declares };
    } catch (e) { journal.arret = e.message; journal.requetesCeRun = cli.requetes(); return { journal }; }
}

module.exports = { enumerer, UTILE, nbCache };

if (require.main === module) (async () => {
    if (inconnus.length) { console.error(`arguments refusés : ${inconnus.join(' ')} — aucune requête`); process.exitCode = 2; return; }
    const dossier = val('cache');
    if (!dossier) { console.error('--cache=<dossier> obligatoire'); process.exitCode = 2; return; }
    if (args.includes('--sonder=') || val('sonder')) {
        const p = Number(val('plafond'));
        if (!p) { console.error('--plafond=<n> obligatoire'); process.exitCode = 2; return; }
        const robots = args.includes('--avec-robots');
        const { journal, r } = await enumerer({ dossier, plafondTotal: p, sonder: val('sonder') });
        console.log(JSON.stringify(journal));
        if (r) console.log(`HTTP ${r.status} ${r.type} cache=${r.cache} ${r.texte.length} caractères\n${r.texte.slice(0, 3000)}`);
        return;
    }
}) ();

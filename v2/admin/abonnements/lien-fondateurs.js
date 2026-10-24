'use strict';
// FABRIQUE LE LIEN RÉSERVÉ DES FONDATEURS depuis le code du .env d'api-v2 et l'écrit dans un fichier local. Le lien n'est JAMAIS affiché ni journalisé : la sortie ne dit que le chemin du fichier.
//   node v2/admin/abonnements/lien-fondateurs.js            simulation : dit si le code est présent et où le lien serait écrit (rien n'est écrit)
//   node v2/admin/abonnements/lien-fondateurs.js --ecrire   écrit C:\Users\Yung\rat-market-travail\api\stripe\lien-fondateurs.txt
// Lit V2_FONDATEURS_CODE par garde-secrets (qui masque toute valeur du .env à la sortie). Si le .env ne porte que V2_FONDATEURS_CODE_EMPREINTE, l'outil s'arrête : une empreinte ne fait pas un lien.
const path = require('path');
const RACINE_TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
const DOSSIER = path.join(RACINE_TRAVAIL, 'stripe');
const SITE = 'https://rat-market.fr';
const AUTORISES = /^--ecrire$/;

if (require.main === module) {
    const refus = process.argv.slice(2).filter(a => !AUTORISES.test(a));
    if (refus.length) { console.error(`ARRÊT : argument(s) non admis (${refus.length}). Admis : --ecrire`); process.exit(1); }
    const ecrire = process.argv.includes('--ecrire');
    try {
        const { ENV } = require(path.join(RACINE_TRAVAIL, 'atlas', 'garde-secrets'));
        const code = ENV.V2_FONDATEURS_CODE;
        if (!code) { console.error('ARRÊT : V2_FONDATEURS_CODE absent du .env d\'api-v2 (seule son empreinte, ou rien, y figure) — le lien ne peut pas être fabriqué'); process.exit(1); }
        const { ecrireLien, NOM_FICHIER } = require('./lien-fondateurs-lib');
        if (!ecrire) { console.log(`SIMULATION : le code est présent ; le lien serait écrit dans ${path.join(DOSSIER, NOM_FICHIER)} (jamais affiché). Pour écrire : --ecrire`); process.exit(0); }
        const r = ecrireLien({ code, site: SITE, dossier: DOSSIER });
        console.log(`Lien écrit dans ${r.chemin} (${r.octets} octets). Il n'est pas affiché.`);
    } catch (e) { console.error(`ARRÊT : ${String(e && e.message || e).slice(0, 200)}`); process.exit(1); }
}
module.exports = { DOSSIER, SITE };

'use strict';
// BANC-200 (tour 1) — VERIFIER un seau en lecture seule, hors de l'API : la chaîne d'empreintes, les vérités et errata d'un juge scellé, la comparaison à l'ANCRE versionnée, et — avec --relire-r2 — chaque objet du bucket relu et re-haché.
//   node v2/mesures/verifier-seau.js --base=<base de LECTURE> --seau=<id> [--relire-r2]       (variables : MONGODB_ESSAI_LECTURE_URI ; V2_BANC_BUCKET avec --relire-r2 ; jamais la base `test`)
// Sortie : « ok » seulement si rien ne cloche ; « non ancré » est DIT quand aucun fichier d'ancre n'existe. Code de sortie 0 (ok) ou 1.
const B = require('./exporter-banc-admin');
const { verifierChaineSeau } = require('../banc/seau');
const { lireAncre } = require('../banc/ancre');

async function lancerCLI(argv, { env = process.env, connecter = B.connecterLecture, stockage = null, journal = l => console.log(l), dossierAncres } = {}) {
    const v = { base: null, seau: null }; let r2 = false;
    for (const a of argv) {
        if (a === '--relire-r2') { if (r2) { console.error('❌ ARRÊT : --relire-r2 donné deux fois'); return 1; } r2 = true; continue; }
        const m = /^--(base|seau)=(.+)$/s.exec(String(a));
        if (!m || v[m[1]] !== null) { console.error('❌ ARRÊT : argument non reconnu ou répété. usage : node v2/mesures/verifier-seau.js --base=<base de lecture> --seau=<id> [--relire-r2]'); return 1; }
        v[m[1]] = m[2].trim();
    }
    if (!v.base || v.base.toLowerCase() === 'test' || !v.seau) { console.error('❌ ARRÊT : --base (jamais `test`) et --seau sont requis'); return 1; }
    if (typeof env.MONGODB_ESSAI_LECTURE_URI !== 'string' || !env.MONGODB_ESSAI_LECTURE_URI) { console.error('❌ ARRÊT : MONGODB_ESSAI_LECTURE_URI absente'); return 1; }
    if (r2 && !stockage && (typeof env.V2_BANC_BUCKET !== 'string' || !env.V2_BANC_BUCKET)) { console.error('❌ ARRÊT : V2_BANC_BUCKET absente'); return 1; }
    let c = null;
    try {
        c = await connecter(env, v.base);
        let st = stockage;
        if (r2 && !st) { const reel = require('../banc/stockage').creerStockageSeauReel(env); st = { lire: k => reel.lire(k) }; }
        const res = await verifierChaineSeau(c.colFn, v.seau, { ancre: id => lireAncre(id, dossierAncres), relireR2: r2, stockage: st });
        journal(`${res.ok ? 'ok' : 'NON OK'} · ${res.lignes} ligne(s) · ${res.errata} erratum(s) · ancre : ${res.ancre === 'non-ancre' ? 'non ancré' : res.ancre} · objets relus : ${res.objets}${res.problemes.length ? ' · problèmes : ' + JSON.stringify(res.problemes) : ''}`);
        return res.ok ? 0 : 1;
    } catch (e) { console.error(`❌ ARRÊT : ${(e && e.code) || (e && e.name) || 'erreur'}`); return 1; }
    finally { try { if (c && c.fermer) await c.fermer(); } catch { /* rien */ } }
}
module.exports = { lancerCLI };
if (require.main === module) { require('dotenv').config(); lancerCLI(process.argv.slice(2)).then(code => process.exit(code)); }

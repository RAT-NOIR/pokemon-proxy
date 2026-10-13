// ============================================================
// UNE FICHE NE DOIT OUVRIR QU'UNE CARTE — les fiches de réimpressions à plusieurs tirages d'origine (lot MULTI, 2026-10-13)
// ============================================================
//   node completer-fiches-multi.js [--sets=Promos,WCD-2011]                        (simulation, par défaut : les 12 sets de la forme)
//   node lot-additif.js --quoi="…" --collections=sets,cartes,cartes_produits -- node completer-fiches-multi.js --attendu=<N> --ecrire
//
// La logique, ses gardes et la raison de `bulba.expansion` vivent dans collecte-cartes/fiches-multi.js. Ici : les arguments, la connexion,
// et la règle du site IMPORTÉE (exporter-donnees-logos-site.js : regleDuSite / fichesDesProduits — jamais recopiée, §21 bis).
// RACINE_SITE=<dossier> : le dossier dont le voisin `rat-market-site` porte la règle du site (défaut : ce dépôt).
// AJOUTS SEULEMENT : $push d'impressions, $set de numeroFiche là où il est nul ou absent, $set de bulba.expansion là où elle est nulle.
// Une écriture exige `--attendu=N` (le nombre de fiches de la simulation) ; il ne colle plus → rien ne s'écrit.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { ouvrirSimulation } = require('./collecte-cartes/ouvrir-lecture');
const FM = require('./collecte-cartes/fiches-multi');
const X = require('./exporter-donnees-logos-site');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const INCONNUS = process.argv.slice(2).filter(a => !/^--(sets|attendu)=.+$/.test(a) && a !== '--ecrire' && a !== '--lecture-via-ecriture');

(async () => {
    if (INCONNUS.length) { console.error(`❌ argument inconnu : ${INCONNUS.join(' ')} — usage : [--sets=a,b] [--attendu=N] [--ecrire]`); process.exit(2); }
    const ecrire = process.argv.includes('--ecrire');
    const attendu = arg('attendu') === '' ? null : Number(arg('attendu'));
    if (attendu != null && !Number.isInteger(attendu)) { console.error('❌ --attendu doit être un entier'); process.exit(2); }
    const sets = arg('sets') ? arg('sets').split(',') : FM.SETS_AUTORISES;
    const hors = sets.filter(s => !FM.SETS_AUTORISES.includes(s));
    if (hors.length) { console.error(`❌ set(s) hors de la liste fermée : ${hors.join(', ')} — autorisés : ${FM.SETS_AUTORISES.join(', ')}`); process.exit(2); }
    const regle = await X.regleDuSite(process.env.RACINE_SITE || __dirname);
    // la SIMULATION lit par la connexion de LECTURE SEULE (ouvrir-lecture.js : refus sans URI de lecture, aucune connexion ouverte) ; seule l'écriture ouvre l'autre
    const { cartes: cx, fermer } = ecrire ? await ouvrirConnexions({ production: false, buckets: [] }) : await ouvrirSimulation({ viaEcriture: process.argv.includes('--lecture-via-ecriture'), ouvrirConnexions });
    try {
        const { code } = await FM.executer({ db: cx.db, deps: { regle, fichesDesProduits: X.fichesDesProduits }, sets, attendu, ecrire });
        process.exitCode = code;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });

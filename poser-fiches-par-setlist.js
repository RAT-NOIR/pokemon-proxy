// node poser-fiches-par-setlist.js --codes=S-P/ID,… --export=<export>.json                                  (simulation : rien n'est écrit)
// node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-fiches-par-setlist.js … --attendu=S-P/ID:77,… --ecrire
//
// LES FICHES DES PRODUITS SANS NUMÉRO CARDMARKET, par « métacarte ∧ Setlist du set » (collecte-cartes/cle-setlist-metacarte.js, lot SEA-2).
// §61 : l'impression asiatique n'existait que dans la mémoire de joindre() ; §67 : une clé qui contient le nom se calibre vérité retirée.
// Ce qui s'écrit (ADDITIF) : la ligne de jointure (`preuve: 'metacarte+setlist'`, `numeroFiche` = le numéro de l'ENTRÉE de Setlist), les liens et
// le set sur la carte (la même liste fermée que poser-par-metacarte.js : regle-r-fiches.js, garderEcritureSite), et l'IMPRESSION de la carte dans
// ce set (`source: 'setlist'`, le tirage et l'expansion du set). AUCUNE image.
// GARDES (toutes AVANT la première écriture) :
//  (1) arguments : `--codes` sans doublon, chaque code dans la table, chaque `--attendu` pour un code demandé, `--export` obligatoire ;
//  (2) l'outil REJOUE LA CALIBRATION lui-même (même export, même base, même version de la clé : collecte-cartes/calibration-setlist-metacarte.js),
//      imprime ses chiffres, et refuse si une épreuve compte un faux ou si les cas atteints sont sous les minimums — aucun rapport externe n'est lu ;
//  (3) `--attendu=CODE:N` = le nombre de lignes du plan de ce set, sinon rien.
// ➕ REPRISE : les lignes déjà posées par cet outil (`preuve: 'metacarte+setlist'`) ne comptent ni comme « jointes » ni comme frères de métacarte
// (pas de preuve circulaire) ; le plan est donc le même après un arrêt, les écritures sont idempotentes, et la relance achève cartes et impressions.
require('dotenv').config();
const { indexerMetacartes } = require('./collecte-cartes/cle-nom-attaques');
const { lireSetlistDuSet, planDuSet } = require('./collecte-cartes/cle-setlist-metacarte');
const { calibrer, verdict, imprimer, chargerExport, MINIMUMS } = require('./collecte-cartes/calibration-setlist-metacarte');
const R = require('./collecte-cartes/regle-r-fiches');

const PREUVE = 'metacarte+setlist';
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--export=.+\.json$/, /^--attendu=[\w.:,/-]+$/, /^--ecrire$/];

/**
 * @param {object} o
 * @param {string[]} o.argv  les arguments (sans node ni le script)
 * @param {object[]} o.table  les lignes de la table (code, slugSet, exp, bulba)
 * @param {()=>Promise<{db: object, fermer: ()=>Promise}>} o.ouvrir  ouvre la base `cartes`
 * @param {(L:object)=>Promise<{entrees:Array}>} o.lireSetlist
 * @param {(L:object)=>Promise<object[]>} o.produitsDe  les produits décomposés de l'expansion d'une ligne
 * @returns {Promise<number>} le code de sortie
 */
async function executer({ argv, table, ouvrir, lireSetlist, produitsDe, minimums = MINIMUMS, log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const CODES = (arg('codes') || '').split(',').filter(Boolean), EXPORT = arg('export');
    const ecrire = argv.includes('--ecrire');
    if (!CODES.length || !EXPORT) { err('❌ --codes=<CODE>[,…] et --export=<fichier>.json obligatoires'); return 2; }
    const doublons = CODES.filter((c, i) => CODES.indexOf(c) !== i);
    if (doublons.length) { err(`❌ --codes en doublon : ${[...new Set(doublons)].join(', ')} — rien n'est écrit`); return 2; }
    const ligne = code => table.find(l => l.code === code && l.slugSet && l.bulba) || null;
    const absents = CODES.filter(c => !ligne(c));
    if (absents.length) { err(`❌ code(s) absent(s) de la table : ${absents.join(', ')} — rien n'est écrit`); return 1; }
    const ATTENDUS = Object.fromEntries((arg('attendu') || '').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
    const horsCodes = Object.keys(ATTENDUS).filter(c => !CODES.includes(c));
    if (horsCodes.length) { err(`❌ --attendu pour un code non demandé : ${horsCodes.join(', ')} — rien n'est écrit`); return 2; }
    if (ecrire) {
        const manquants = CODES.filter(c => !Number.isInteger(ATTENDUS[c]));
        if (manquants.length) { err(`❌ --ecrire exige --attendu=CODE:N pour chaque code (manque : ${manquants.join(', ')}) — rien n'est écrit`); return 2; }
    }
    const lignesEcrites = CODES.map(ligne);
    const parSlug = new Map(); for (const l of table) if (l.code && l.slugSet && l.bulba && !parSlug.has(l.slugSet)) parSlug.set(l.slugSet, l);

    const { db, fermer } = await ouvrir();
    try {
        // ── (2) la calibration, REJOUÉE ICI ──
        log(`\n════ CALIBRATION rejouée (export ${EXPORT}) ════`);
        const cal = await calibrer({ db, exportPath: EXPORT, lignesEcrites, lignesDanger: [...parSlug.values()], lireSetlist, log });
        imprimer(cal, log);
        const v = verdict(cal, minimums);
        if (!v.ok) {
            log(`   🔴 CALIBRATION INSUFFISANTE : ${v.refus.join(' · ')}`);
            if (ecrire) { err('❌ ARRÊT : la garde de calibration refuse — rien n\'est écrit'); return 1; }
        } else log('   ✅ la calibration passe (0 faux sur A et sur D-A, cas atteints >= minimums ; D-C non concluante, hors de la décision)');

        // ── le plan ──
        const exp = chargerExport(EXPORT);
        const metaDe = id => exp.get(id)?.idMetacard ?? null;
        const toutes = await db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1, preuve: 1 } }).toArray();
        const lignes = toutes.filter(l => l.preuve !== PREUVE);                    // pas de preuve circulaire, et la reprise rejoue le même plan
        const base = { parMeta: indexerMetacartes(lignes, metaDe), metacarteDe: metaDe };
        const jointsIds = new Set(lignes.map(l => l.idProduct));
        const aEcrire = [], impressions = [];
        for (const L of lignesEcrites) {
            const S = await lireSetlist(L);
            const produits = await produitsDe(L);
            const expansion = [].concat(L.bulba.expansion)[0];
            const P = planDuSet({ base, entrees: S.entrees, produits, lignesDuSet: lignes.filter(l => l.slugSet === L.slugSet), jointsIds, tirage: L.bulba.tirage, expansion });
            log(`\n■ ${L.code} (${L.slugSet}) · ${P.retenus.length} lignes · ${new Set(P.retenus.map(x => x.d.carte._id)).size} cartes · ${P.impressions.size} impressions · ${P.ecartes.length} écartés · ${P.refus.length} refusés`);
            if (ecrire && ATTENDUS[L.code] !== P.retenus.length) { err(`❌ ARRÊT : ${L.code} rend ${P.retenus.length}, attendu ${ATTENDUS[L.code] ?? 'non donné'} — rien n'est écrit`); return 1; }
            for (const x of P.retenus) aEcrire.push({ ...x, CODE: L.code, L });
            for (const x of P.impressions.values()) impressions.push({ carteId: x.d.carte._id, imp: { tirage: L.bulba.tirage, expansion, numero: x.d.numero, total: null, deck: null, rarete: null, source: 'setlist' } });
        }
        log(`\n   ${aEcrire.length} fiches, ${impressions.length} impressions${ecrire ? '' : ' — (simulation)'}`);
        if (!ecrire || !aEcrire.length) return 0;

        // ── l'écriture, ADDITIVE et idempotente ──
        const le = new Date();
        const parCarte = new Map();
        for (const x of aEcrire) { const v2 = parCarte.get(x.d.carte._id) || parCarte.set(x.d.carte._id, { ids: [], metas: new Set(), sets: new Set() }).get(x.d.carte._id); v2.ids.push(x.p.idProduct); if (metaDe(x.p.idProduct) != null) v2.metas.add(metaDe(x.p.idProduct)); v2.sets.add(x.L.slugSet); }
        const ops = R.operationsCartes(parCarte); R.garderEcritureSite(ops);
        await db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: `${x.d.carte._id}|${x.p.idProduct}` }, update: { $setOnInsert: {
            carteId: x.d.carte._id, idProduct: x.p.idProduct, idExpansion: x.L.exp, tirage: x.L.bulba.tirage, preuve: PREUVE, slug: x.p.slug ?? null, slugSet: x.p.slugSet ?? x.L.slugSet, numeroFiche: x.d.numero,
            detail: `${x.CODE} « ${x.p.name} » → « ${x.d.carte.nomEn} » (${x.d.carte._id}) : métacarte Cardmarket ${metaDe(x.p.idProduct)} (une seule carte à page) = Setlist du set (nom + attaques, entrée n°${x.d.numero}) · numéro de la Setlist`,
            verifieLe: le, route: x.CODE } }, upsert: true } })), { ordered: false });
        await db.collection('cartes').bulkWrite(ops, { ordered: false });
        for (const { carteId, imp } of impressions) await db.collection('cartes').updateOne({ _id: carteId, impressions: { $not: { $elemMatch: { tirage: imp.tirage, expansion: imp.expansion, numero: imp.numero } } } }, { $push: { impressions: imp } });

        // ── la RELECTURE après écriture : ce qui est en base, pas ce que le bulkWrite a rendu ──
        const ids = aEcrire.map(x => `${x.d.carte._id}|${x.p.idProduct}`);
        const relues = await db.collection('cartes_produits').find({ _id: { $in: ids } }, { projection: { preuve: 1, numeroFiche: 1 } }).toArray();
        const lignesOk = relues.filter(l => l.preuve === PREUVE).length;
        const cartes = await db.collection('cartes').find({ _id: { $in: [...parCarte.keys()] } }, { projection: { impressions: 1, sets: 1, liens: 1 } }).toArray();
        const parId = new Map(cartes.map(c => [c._id, c]));
        const liensOk = aEcrire.filter(x => (parId.get(x.d.carte._id)?.liens?.idProduct || []).includes(x.p.idProduct) && (parId.get(x.d.carte._id)?.sets || []).includes(x.L.slugSet)).length;
        const impAttendues = new Map(aEcrire.map(x => [`${x.d.carte._id}|${x.L.slugSet}|${x.d.numero}`, x]));
        const impOk = [...impAttendues.values()].filter(x => (parId.get(x.d.carte._id)?.impressions || []).some(i => i.tirage === x.L.bulba.tirage && i.expansion === [].concat(x.L.bulba.expansion)[0] && String(i.numero) === String(x.d.numero) && i.source === 'setlist')).length;
        log(`\n   RELECTURE : lignes ${lignesOk}/${aEcrire.length} · cartes avec leurs liens et leur set ${liensOk}/${aEcrire.length} · impressions « setlist » ${impOk}/${impAttendues.size}`);
        if (lignesOk !== aEcrire.length || liensOk !== aEcrire.length || impOk !== impAttendues.size) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { executer, PREUVE };

if (require.main === module) {
    (async () => {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const r2 = require('./collecte-cartes/r2');
        const J = require('./collecte-cartes/jointure');
        const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
        const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
        await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
        const code = await executer({
            argv: process.argv.slice(2), table: [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE],
            ouvrir: async () => ({ db: cx.db, fermer: async () => { } }),
            lireSetlist: L => lireSetlistDuSet({ db: cx.db, r2, bucket: process.env.R2_BUCKET_BRUT, L }),
            produitsDe: L => J.produitsDeLExpansion(prod, L.exp)
        });
        await fermer();
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}

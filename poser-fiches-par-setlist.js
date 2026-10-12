// node poser-fiches-par-setlist.js --codes=S-P/ID,… --export=<export>.json --calibration=<rapport>.json            (simulation : rien n'est écrit)
// node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-fiches-par-setlist.js … --attendu=S-P/ID:77,… --ecrire
//
// LES FICHES DES PRODUITS SANS NUMÉRO CARDMARKET, par « métacarte ∧ Setlist du set » (collecte-cartes/cle-setlist-metacarte.js, lot SEA-2).
// §61 : l'impression asiatique n'existait que dans la mémoire de joindre() ; §67 : une clé qui contient le nom se calibre vérité retirée.
// Ce qui s'écrit (ADDITIF) : la ligne de jointure (`preuve: 'metacarte+setlist'`, `numeroFiche` = le numéro de la ENTRÉE de Setlist), les liens et
// le set sur la carte (la même liste fermée que poser-par-metacarte.js : regle-r-fiches.js, garderEcritureSite), et l'IMPRESSION de la carte dans
// ce set (`source: 'setlist'`, le tirage et l'expansion du set — la marque qui la fait survivre à une relecture de la page, impressions-posees.js).
// AUCUNE image. GARDES : (1) liste fermée par set (`--codes`), chaque set avec son `--attendu=CODE:N` ; (2) la calibration doit avoir été rejouée
// (`--calibration=<rapport>` écrit par calibrer-cle-setlist-metacarte.js) : 0 faux de carte, 0 faux de numéro, 0 désignation « vraie carte retirée »
// POUR CHAQUE CODE, sinon rien n'est écrit ; (3) un set sans produit désigné n'écrit rien.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const J = require('./collecte-cartes/jointure');
const { indexerMetacartes } = require('./collecte-cartes/cle-nom-attaques');
const { lireSetlistDuSet, planDuSet } = require('./collecte-cartes/cle-setlist-metacarte');
const R = require('./collecte-cartes/regle-r-fiches');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');

if (require.main !== module) return;
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--export=.+\.json$/, /^--calibration=.+\.json$/, /^--attendu=[\w.:,/-]+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CODES = (arg('codes') || '').split(',').filter(Boolean), EXPORT = arg('export'), CALIB = arg('calibration');
const ATTENDUS = Object.fromEntries((arg('attendu') || '').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
const ecrire = process.argv.includes('--ecrire');
if (!CODES.length || !EXPORT || !CALIB) { console.error('❌ --codes, --export et --calibration obligatoires'); process.exit(2); }
const ligne = code => [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].find(l => l.code === code && l.slugSet && l.bulba) || null;

(async () => {
    const cal = JSON.parse(fs.readFileSync(CALIB, 'utf8'));
    for (const CODE of CODES) {
        const s = cal.sets?.[CODE]?.calibration;
        if (!s || s.cas <= 0 || s.fauxCarte || s.fauxNumero || s.B.faux || s.C.faux) { console.error(`❌ ARRÊT : ${CODE} n'a pas de calibration à 0 faux dans ${CALIB} (${JSON.stringify(s ?? null)}) — rien n'est écrit`); process.exit(1); }
    }
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const metaDe = new Map(JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products.map(p => [p.idProduct, p.idMetacard ?? null]));
    const lignes = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
    const base = { parMeta: indexerMetacartes(lignes, id => metaDe.get(id)), metacarteDe: id => metaDe.get(id) ?? null };
    const jointsIds = new Set(lignes.map(l => l.idProduct));
    const aEcrire = [], impressions = [];
    for (const CODE of CODES) {
        const L = ligne(CODE);
        if (!L) { console.log(`\n■ ${CODE} : ligne absente — refusé`); continue; }
        const S = await lireSetlistDuSet({ db: cx.db, r2, bucket: process.env.R2_BUCKET_BRUT, L });
        const produits = await J.produitsDeLExpansion(prod, L.exp);
        const expansion = [].concat(L.bulba.expansion)[0];
        const P = planDuSet({ base, entrees: S.entrees, produits, lignesDuSet: lignes.filter(l => l.slugSet === L.slugSet), jointsIds, tirage: L.bulba.tirage, expansion });
        console.log(`\n■ ${CODE} (${L.slugSet}) · ${P.retenus.length} lignes · ${new Set(P.retenus.map(x => x.d.carte._id)).size} cartes · ${P.impressions.size} impressions · ${P.ecartes.length} écartés (fiche mélangée) · ${P.refus.length} refusés`);
        if (ecrire && ATTENDUS[CODE] !== P.retenus.length) { console.error(`❌ ARRÊT : ${CODE} rend ${P.retenus.length}, attendu ${ATTENDUS[CODE] ?? 'non donné'}`); await fermer(); process.exit(1); }
        for (const x of P.retenus) aEcrire.push({ ...x, CODE, L });
        for (const x of P.impressions.values()) impressions.push({ carteId: x.d.carte._id, imp: { tirage: L.bulba.tirage, expansion, numero: x.d.numero, total: null, deck: null, rarete: null, source: 'setlist' } });
    }
    console.log(`\n   ${aEcrire.length} fiches, ${impressions.length} impressions${ecrire ? '' : ' — (simulation)'}`);
    if (!ecrire || !aEcrire.length) { await fermer(); return; }

    const le = new Date();
    const parCarte = new Map();
    for (const x of aEcrire) { const v = parCarte.get(x.d.carte._id) || parCarte.set(x.d.carte._id, { ids: [], metas: new Set(), sets: new Set() }).get(x.d.carte._id); v.ids.push(x.p.idProduct); if (metaDe.get(x.p.idProduct) != null) v.metas.add(metaDe.get(x.p.idProduct)); v.sets.add(x.L.slugSet); }
    const ops = R.operationsCartes(parCarte); R.garderEcritureSite(ops);
    const r = await cx.db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: `${x.d.carte._id}|${x.p.idProduct}` }, update: { $setOnInsert: {
        carteId: x.d.carte._id, idProduct: x.p.idProduct, idExpansion: x.L.exp, tirage: x.L.bulba.tirage, preuve: 'metacarte+setlist', slug: x.p.slug ?? null, slugSet: x.p.slugSet ?? x.L.slugSet, numeroFiche: x.d.numero,
        detail: `${x.CODE} « ${x.p.name} » → « ${x.d.carte.nomEn} » (${x.d.carte._id}) : métacarte Cardmarket ${metaDe.get(x.p.idProduct)} (une seule carte à page) = Setlist du set (nom + attaques, entrée n°${x.d.numero}) · numéro de la Setlist`,
        verifieLe: le, route: x.CODE } }, upsert: true } })), { ordered: false });
    const rc = await cx.db.collection('cartes').bulkWrite(ops, { ordered: false });
    let posees = 0;
    for (const { carteId, imp } of impressions) posees += (await cx.db.collection('cartes').updateOne({ _id: carteId, impressions: { $not: { $elemMatch: { tirage: imp.tirage, expansion: imp.expansion, numero: imp.numero } } } }, { $push: { impressions: imp } })).modifiedCount;
    console.log(`\n   ✅ lignes insérées ${r.upsertedCount}/${aEcrire.length} · cartes modifiées (liens, sets) ${rc.modifiedCount} · impressions posées ${posees}/${impressions.length}`);
    await fermer();
    if (r.upsertedCount !== aEcrire.length || posees !== impressions.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });

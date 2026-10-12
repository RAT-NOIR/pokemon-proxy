// node calibrer-cle-setlist-metacarte.js --codes=S-P/ID,… --export=<export>.json [--rapport=<fichier>.json]      LECTURE SEULE (rien n'est écrit)
// CALIBRATION de la clé « métacarte ∧ Setlist du set » (collecte-cartes/cle-setlist-metacarte.js) sur une population dont on CONNAÎT la vérité :
// les produits du set DÉJÀ joints par le numéro (cartes_produits.numeroFiche, carte à page). Le numéro est CACHÉ à la clé ; elle doit rendre la
// MÊME carte ET le même numéro (celui de la Setlist). Trois épreuves : (A) vérité présente ; (B) vraie carte RETIRÉE de la métacarte et de la
// Setlist ; (C) vraie carte retirée de la Setlist seulement (la métacarte la désigne encore). Un « faux » = une AUTRE carte ou un autre numéro.
// Puis la SIMULATION sur les produits non joints du set : lignes, cartes, impressions, écartés (fiche mélangée), et le rapport JSON local.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const J = require('./collecte-cartes/jointure');
const { indexerMetacartes } = require('./collecte-cartes/cle-nom-attaques');
const { designerParSetlist, lireSetlistDuSet, planDuSet } = require('./collecte-cartes/cle-setlist-metacarte');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');

if (require.main !== module) return;
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--export=.+\.json$/, /^--rapport=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CODES = (arg('codes') || '').split(',').filter(Boolean), EXPORT = arg('export');
if (!CODES.length || !EXPORT) { console.error('❌ --codes=<CODE>[,…] et --export=<fichier>.json obligatoires'); process.exit(2); }
const ligne = code => [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].find(l => l.code === code && l.slugSet && l.bulba) || null;
const k = J.cleNumero;

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const metaDe = new Map(JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products.map(p => [p.idProduct, p.idMetacard ?? null]));
    const lignes = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1, idExpansion: 1 } }).toArray();
    const parMeta = indexerMetacartes(lignes, id => metaDe.get(id));
    const base = { parMeta, metacarteDe: id => metaDe.get(id) ?? null };
    const tot = { cas: 0, justes: 0, fauxCarte: 0, fauxNumero: 0, silences: 0, B: { cas: 0, faux: 0 }, C: { cas: 0, faux: 0 } };
    const rapport = { le: new Date().toISOString(), export: EXPORT, sets: {}, designations: [] };
    for (const CODE of CODES) {
        const L = ligne(CODE);
        if (!L) { console.log(`\n■ ${CODE} : ligne absente — refusé`); continue; }
        let S;
        try { S = await lireSetlistDuSet({ db: cx.db, r2, bucket: process.env.R2_BUCKET_BRUT, L }); } catch (e) { console.log(`\n■ ${CODE} : ${e.message}`); continue; }
        const produits = await J.produitsDeLExpansion(prod, L.exp);
        const lignesDuSet = lignes.filter(l => l.slugSet === L.slugSet);
        const jointsIds = new Set(lignes.map(l => l.idProduct));
        console.log(`\n■ ${CODE} (${L.slugSet}, tirage ${L.bulba.tirage}) · Setlist : ${S.lues} entrées lues, ${S.entrees.length} résolues en cartes, ${S.sansPage} sans page, ${S.sansNumero} sans numéro`);
        // ── calibration ──
        const c = { cas: 0, justes: 0, fauxCarte: 0, fauxNumero: 0, silences: 0, B: { cas: 0, faux: 0 }, C: { cas: 0, faux: 0 }, motifs: {}, faux: [] };
        const parId = new Map(produits.map(p => [p.idProduct, p]));
        for (const l of lignesDuSet) {
            const p = parId.get(l.idProduct);
            if (!p || l.numeroFiche == null || !(l.carteId > 0) || !(p.attaques || []).length) continue;
            c.cas++;
            const ctx = { ...base, setlist: S.entrees };
            const d = designerParSetlist(ctx, p);
            if (!d.carte) { c.silences++; c.motifs[d.raison.replace(/\(.*\)/, '(…)').replace(/\d+/g, '#')] = (c.motifs[d.raison.replace(/\(.*\)/, '(…)').replace(/\d+/g, '#')] || 0) + 1; }
            else if (d.carte._id !== l.carteId) { c.fauxCarte++; c.faux.push(`${p.name} : ${d.carte._id} au lieu de ${l.carteId}`); }
            else if (k(d.numero) !== k(l.numeroFiche)) { c.fauxNumero++; c.faux.push(`${p.name} : n°${d.numero} au lieu de n°${l.numeroFiche}`); }
            else c.justes++;
            c.B.cas++; if (designerParSetlist(ctx, p, { sauf: l.carteId }).carte) { c.B.faux++; c.faux.push(`B ${p.name}`); }
            c.C.cas++; if (designerParSetlist({ ...ctx, setlist: S.entrees.filter(e => e.carte._id !== l.carteId) }, p).carte) { c.C.faux++; c.faux.push(`C ${p.name}`); }
        }
        console.log(`   CALIBRATION : ${c.cas} produits joints par le numéro (avec attaques, carte à page) · JUSTES ${c.justes} · FAUX carte ${c.fauxCarte} · FAUX numéro ${c.fauxNumero} · silences ${c.silences}`);
        console.log(`   vraie carte retirée (métacarte ET Setlist) : ${c.B.cas} cas, ${c.B.faux} désignation(s) d'une autre carte · retirée de la Setlist seule : ${c.C.cas} cas, ${c.C.faux} désignation(s)`);
        for (const [m, n] of Object.entries(c.motifs).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)} silences · ${m}`);
        for (const f of c.faux.slice(0, 10)) console.log(`      ⚠️ ${f}`);
        for (const key of ['cas', 'justes', 'fauxCarte', 'fauxNumero', 'silences']) tot[key] += c[key];
        for (const e of ['B', 'C']) { tot[e].cas += c[e].cas; tot[e].faux += c[e].faux; }
        // ── simulation sur les non joints ──
        const expansion = [].concat(L.bulba.expansion)[0];
        const { retenus, ecartes, refus, impressions } = planDuSet({ base, entrees: S.entrees, produits, lignesDuSet, jointsIds, tirage: L.bulba.tirage, expansion });
        const nonJoints = produits.filter(p => !jointsIds.has(p.idProduct)), raisons = {};
        for (const r of refus) { const m = r.raison.replace(/\(.*\)/, '(…)').replace(/\d+/g, '#'); raisons[m] = (raisons[m] || 0) + 1; }
        if (ecartes.length) raisons['écarté : fiche mélangée (la carte montrerait deux numéros)'] = ecartes.length;
        console.log(`   SIMULATION : ${nonJoints.length} produits non joints · lignes ${retenus.length} · cartes distinctes ${new Set(retenus.map(x => x.d.carte._id)).size} · impressions à poser ${impressions.size} · contredits 0 (aucune ligne n'est posée sans accord métacarte/Setlist/nom)`);
        for (const [r, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)} · ${r}`);
        rapport.sets[CODE] = { slugSet: L.slugSet, tirage: L.bulba.tirage, expansion, calibration: { cas: c.cas, justes: c.justes, fauxCarte: c.fauxCarte, fauxNumero: c.fauxNumero, silences: c.silences, B: c.B, C: c.C }, nonJoints: nonJoints.length, lignes: retenus.length, cartes: new Set(retenus.map(x => x.d.carte._id)).size, impressions: impressions.size, raisons };
        for (const x of retenus) rapport.designations.push({ code: CODE, slugSet: L.slugSet, idProduct: x.p.idProduct, nom: x.p.name, carteId: x.d.carte._id, numero: x.d.numero });
    }
    console.log(`\nTOTAL CALIBRATION : ${tot.cas} cas · JUSTES ${tot.justes} · FAUX ${tot.fauxCarte + tot.fauxNumero} (carte ${tot.fauxCarte}, numéro ${tot.fauxNumero}) · silences ${tot.silences} · retirée B ${tot.B.cas}/${tot.B.faux} faux · retirée C ${tot.C.cas}/${tot.C.faux} faux`);
    rapport.calibration = tot;
    if (arg('rapport')) { fs.writeFileSync(arg('rapport'), JSON.stringify(rapport, null, 1)); console.log(`rapport local écrit : ${arg('rapport')}`); }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

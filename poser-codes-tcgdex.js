// ============================================================
// LE CODE D'UNE EXPANSION QUE CARDMARKET NE NOUS A JAMAIS MONTRÉE — TCGdex, sous le témoin de Cardmarket lui-même
// ============================================================
//   node poser-codes-tcgdex.js --clone=<clone tcgdex/cards-database>                                   (mesure, n'écrit rien)
//   node poser-codes-tcgdex.js --clone=<…> --base=test --attendu=<N> --ecrire                          (après backup-collections.js --base=test --collections=codes_set)
//
// 🔑 POURQUOI (2026-09-26, « crée Holon Phantoms en priorité ») : l'expansion 1551 — 112 produits, 7 185 € au guide — n'a ni code
// ni slug : aucun de ses produits n'a été appris par Cardmarket, et la table maîtresse la disait « nom inconnu ». Le fichier de SET
// de TCGdex la nomme (`thirdParty.cardmarket: 1551` = ex13 « Holon Phantoms ») et donne son abréviation officielle (« HP »).
// Une source seule ne pose rien : le code doit être CELUI QUE CARDMARKET ÉCRIT, et Cardmarket l'écrit lui-même dans les slugs de ses
// réimpressions WCD (« Holons-Castform-WCD08HP-044 »). Le témoin ne partage rien avec la clé : chaque slug WCD à ce code doit
// désigner, au numéro qu'il porte, une carte du set TCGdex au MÊME nom que le produit.
// Ce qui passe (tout le reste refuse, et le dit) :
//   1. l'expansion n'a AUCUNE ligne codes_set ;
//   2. UN seul fichier de set TCGdex la porte, dans `data/` (le monde occidental : la région est celle du fichier, pas une devinette
//      sur le nom — `data-asia/` mêle japonais, chinois, indonésien et thaï, il ne dit pas une région de codes_set) ;
//   3. il a une abréviation officielle, qu'aucune autre expansion ne porte déjà ;
//   4. les slugs WCD de Cardmarket à ce code : 3 au moins, et TOUS désignent au même numéro une carte TCGdex au même nom.
// Écriture ADDITIVE : une ligne codes_set par expansion, `$setOnInsert` seul, avec sa preuve.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero, clesNom, decomposerNomCardmarket, estCarteCode } = require('./collecte-cartes/jointure');

// la ligne de commande s'écrit par ce qu'elle AUTORISE (§54, relecture du 2026-09-28) : un argument inconnu refuse avant toute connexion
const AUTORISES = [/^--clone=.+$/, /^--export=.+\.json$/, /^--base=test$/, /^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --clone=, --export=, --base=test, --attendu=, --ecrire`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CLONE = arg('clone'), EXPORT = arg('export') || 'products_singles_24092026.json';
const ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;
if (!CLONE || !fs.existsSync(path.join(CLONE, 'data'))) { console.error('❌ --clone=<chemin du clone tcgdex/cards-database> requis'); process.exit(2); }
const chaineDe = (bloc, cle) => { const m = new RegExp(`\\b${cle}:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(bloc); return m ? m[2].replace(/\\(.)/g, '$1') : null; };
const cles = nom => clesNom(String(nom || '').replace(/δ\s+Delta Species\b/g, 'δ'));   // apprendre-par-tcgdex.js : « δ Delta Species » s'écrit « δ » chez TCGdex
const MINIMUM_TEMOINS = 3;

/** Les fichiers de SET du clone qui écrivent une expansion Cardmarket : idExpansion → [{ monde, id, nom, abbr, cartes: Map(n° → nom) }]. */
function setsTcgdex(racine) {
    const parExp = new Map();
    for (const monde of ['data', 'data-asia']) for (const serie of fs.readdirSync(path.join(racine, monde))) {
        const dS = path.join(racine, monde, serie); if (!fs.statSync(dS).isDirectory()) continue;
        for (const f of fs.readdirSync(dS)) {
            if (!f.endsWith('.ts')) continue;
            const src = fs.readFileSync(path.join(dS, f), 'utf8');
            const cm = Number(/thirdParty:\s*\{[^}]*cardmarket:\s*(\d+)/.exec(src)?.[1]) || null; if (!cm) continue;
            const dSet = path.join(dS, f.slice(0, -3)), cartes = new Map();
            if (fs.existsSync(dSet)) for (const c of fs.readdirSync(dSet)) {
                if (!c.endsWith('.ts')) continue;
                const bloc = /\bname:\s*\{([^}]*)\}/.exec(fs.readFileSync(path.join(dSet, c), 'utf8'))?.[1] || '';
                cartes.set(cleNumero(c.slice(0, -3)), chaineDe(bloc, 'en'));
            }
            const e = { monde, serie, fichier: f, id: /\bid:\s*["']([^"']+)["']/.exec(src)?.[1] ?? null, nom: chaineDe(/\bname:\s*\{([^}]*)\}/.exec(src)?.[1] || '', 'en'), abbr: /abbreviations:\s*\{[^}]*official:\s*["']([^"']+)["']/.exec(src)?.[1] ?? null, cartes };
            (parExp.get(cm) || parExp.set(cm, []).get(cm)).push(e);
        }
    }
    return parExp;
}

(async () => {
    const tc = setsTcgdex(CLONE);
    const { prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const ex = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products.filter(p => !estCarteCode(p.name));
    const nomDe = new Map(ex.map(p => [p.idProduct, p.name]));
    const exps = new Map(); for (const p of ex) exps.set(p.idExpansion, (exps.get(p.idExpansion) || 0) + 1);
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set', projection: { idExpansion: 1, codeSet: 1 } });
    const codeDe = new Map(codes.map(c => [c.idExpansion, c.codeSet])), expDuCode = new Map(codes.map(c => [c.codeSet, c.idExpansion]));
    const slugsWcd = await lireMongo(prod.db.collection('numeros_cartes'), { slug: /WCD\d\d/ }, { nom: 'numeros_cartes (slugs WCD)', projection: { idProduct: 1, slug: 1 } });
    const sansCode = [...exps.keys()].filter(e => !codeDe.has(e));
    console.log(`DÉNOMINATEURS : ${exps.size} expansions dans l'export (hors cartes-code) · ${sansCode.length} sans ligne codes_set · ${tc.size} expansions nommées par un fichier de set TCGdex · ${slugsWcd.length} slugs WCD appris`);
    const retenus = [], refus = [];
    for (const e of sansCode) {
        const ts = tc.get(e) || [];
        const dire = raison => refus.push({ e, produits: exps.get(e), raison });
        if (!ts.length) { dire('aucun fichier de set TCGdex ne porte cette expansion'); continue; }
        if (ts.length !== 1) { dire(`${ts.length} fichiers de set TCGdex la portent (${ts.map(t => t.id).join(', ')})`); continue; }
        const t = ts[0];
        if (t.monde !== 'data') { dire(`set TCGdex ${t.id} dans ${t.monde}/ : le monde asiatique ne dit pas une région de codes_set`); continue; }
        if (!t.abbr) { dire(`set TCGdex ${t.id} « ${t.nom} » sans abréviation officielle`); continue; }
        if (expDuCode.has(t.abbr)) { dire(`le code « ${t.abbr} » (TCGdex ${t.id}) est déjà celui de l'expansion ${expDuCode.get(t.abbr)}`); continue; }
        const re = new RegExp(`-WCD\\d{2}${t.abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
        const temoins = slugsWcd.map(n => ({ n, m: re.exec(n.slug || '') })).filter(x => x.m).map(({ n, m }) => {
            const nomCm = decomposerNomCardmarket(nomDe.get(n.idProduct) || '').nom, nomTc = t.cartes.get(cleNumero(m[1]));
            return { slug: n.slug, nomCm, nomTc, ok: !!nomTc && cles(nomTc).some(k => cles(nomCm).includes(k)) };
        });
        const ko = temoins.filter(x => !x.ok);
        if (temoins.length < MINIMUM_TEMOINS) { dire(`code « ${t.abbr} » (TCGdex ${t.id} « ${t.nom} ») : ${temoins.length} slug(s) WCD de Cardmarket à ce code, ${MINIMUM_TEMOINS} exigés`); continue; }
        if (ko.length) { dire(`code « ${t.abbr} » : ${ko.length}/${temoins.length} slugs WCD contredits (${ko.slice(0, 3).map(x => `${x.slug} « ${x.nomCm} » ≠ TCGdex « ${x.nomTc ?? '—'} »`).join(' ; ')})`); continue; }
        retenus.push({ e, produits: exps.get(e), t, temoins });
    }
    console.log(`\n✅ CODES PROUVÉS : ${retenus.length}`);
    for (const r of retenus) console.log(`   ${r.e} (${r.produits} produits) → « ${r.t.abbr} » · TCGdex ${r.t.id} « ${r.t.nom} » (${r.t.monde}/${r.t.serie}) · témoins Cardmarket ${r.temoins.length}/${r.temoins.length} : ${r.temoins.slice(0, 5).map(x => `${x.slug} = « ${x.nomTc} »`).join(' ; ')}`);
    const parRaison = {}; for (const r of refus) { const k = r.raison.replace(/«[^»]*»/g, '«…»').replace(/\([^)]*\)/g, '(…)').replace(/\d+/g, '#'); parRaison[k] = (parRaison[k] || 0) + 1; }
    console.log('🔴 NON POSÉS, par raison :'); for (const [k, v] of Object.entries(parRaison).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)} · ${k}`);
    for (const r of refus.filter(x => !/aucun fichier/.test(x.raison))) console.log(`      ${r.e} (${r.produits} p) : ${r.raison}`);
    await fermer();

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --base=test --attendu=${retenus.length} --ecrire, après backup-collections.js --base=test --collections=codes_set)`); return; }
    if (ATTENDU !== retenus.length) { console.error(`❌ ARRÊT : ${retenus.length} codes à poser contre ${ATTENDU} attendus`); process.exit(1); }
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'poser-codes-tcgdex.js', ecrit: true });
    if (base !== 'test') { console.error(`❌ ARRÊT : codes_set vit dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(1); }
    const C = mongoose.connection.db.collection('codes_set'), le = new Date();
    let n = 0;
    for (const r of retenus) {
        const res = await C.updateOne({ idExpansion: r.e }, { $setOnInsert: {
            idExpansion: r.e, codeSet: r.t.abbr, region: 'occidental', apprisLe: le, regionSource: `tcgdex ${r.t.monde}/${r.t.serie}`, regionDeriveeLe: le,
            source: 'tcgdex+slugs-wcd', setTcgdex: r.t.id,
            preuve: `TCGdex ${r.t.id} « ${r.t.nom} » : thirdParty.cardmarket ${r.e}, abbreviations.official « ${r.t.abbr} » · témoin Cardmarket : ${r.temoins.length}/${r.temoins.length} slugs WCD à ce code désignent au même numéro une carte du set au même nom (${r.temoins.slice(0, 3).map(x => x.slug).join(', ')}) · poser-codes-tcgdex.js`
        } }, { upsert: true });
        n += res.upsertedCount;
    }
    const relus = await C.countDocuments({ source: 'tcgdex+slugs-wcd' });
    console.log(`\n   ✅ ${n} codes posés (attendu ${retenus.length}) · relu : ${relus} lignes codes_set source tcgdex+slugs-wcd`);
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });

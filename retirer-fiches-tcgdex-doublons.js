// ============================================================
// RETIRER LES FICHES TCGdex EN DOUBLE — feu vert du testeur (2026-10-07, soir : « 6 fiches TCGdex en double : feu vert pour les
// retirer, sauvegarde avant, sous la garde, et revalide les sets touchés »)
// ============================================================
//   node retirer-fiches-tcgdex-doublons.js                                   (plan : doublons, lignes repointées, annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits --annonce=<annonce> -- node retirer-fiches-tcgdex-doublons.js --attendu=6 --ecrire
//
// LE DÉFAUT (relecture par sous-agent, 2026-10-07) : poser-cartes-tcgdex.js lisait le numéro de NOS impressions tel quel — « SWSH139 (Top
// Left) » (V-UNION), « 102<!-- … » (reste de wikitext) — et ne retrouvait pas la carte qui tient déjà ce numéro : il a créé une fiche TCGdex
// à côté. Corrigé dans l'outil (`numeroNu`, banc 21/21) ; ici, la moitié qui manque : les lignes déjà écrites.
// UN DOUBLON, ET RIEN D'AUTRE (une garde s'écrit par ce qu'elle autorise) : une fiche `ficheSimple.source: 'tcgdex'` dont l'unique
// impression (tirage, expansion, numéro lu nu) est tenue par UNE SEULE vraie carte (sans `ficheSimple`) du MÊME nom, et dont le set est un
// set de cette carte. La lecture du numéro est `numeroNu` de poser-cartes-tcgdex.js, importée (§21 bis).
// CE QUI EST ÉCRIT : chaque ligne de la fiche renaît sous la vraie carte (`<carte>|<idProduct>`, mêmes champs, preuve `tcgdex+impression`,
// le détail dit d'où elle vient) — sauf si cette ligne existe déjà ; la vraie carte reçoit le set et les produits ; la fiche et ses lignes
// sont retirées. Avant d'écrire, la règle du site est rejouée : chaque produit repointé trouve une fiche de la vraie carte par son numéro.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { cleNumero, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
const { numeroNu } = require('./poser-cartes-tcgdex');
const { numeroComparable } = require('./mesurer-fiches-melangees');

const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --attendu=<n>, --ecrire`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire'), ATTENDU = Number(process.argv.find(a => a.startsWith('--attendu='))?.slice(10) ?? NaN);
if (ECRIRE && !Number.isFinite(ATTENDU)) { console.error('❌ --ecrire exige --attendu=<n>'); process.exit(2); }
const ROUTE = 'tcgdex-doublon:2026-10-07';
const k = n => cleNumero(numeroNu(n));

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), CP = cx.db.collection('cartes_produits');
    const fiches = await C.find({ 'ficheSimple.source': 'tcgdex' }).toArray();
    if (!fiches.length) throw new Error('0 fiche TCGdex en base : clé fausse ?');
    const plan = [], refus = {};
    const noter = (m, x) => { (refus[m] = refus[m] || []).push(x); };
    for (const f of fiches) {
        const imps = (f.impressions || []).filter(Boolean);
        if (imps.length !== 1 || (f.sets || []).length !== 1) { noter('fiche à plusieurs impressions ou plusieurs sets', f._id); continue; }
        const [i] = imps, S = f.sets[0];
        if (!i.numero) { noter('fiche sans numéro', f._id); continue; }
        const vraies = await C.find({ ficheSimple: { $exists: false }, impressions: { $elemMatch: { tirage: i.tirage, expansion: i.expansion } } }, { projection: { nomEn: 1, sets: 1, impressions: 1, liens: 1, bulba: 1, images: 1 } }).toArray();
        const auNumero = vraies.filter(c => (c.impressions || []).some(j => j && j.tirage === i.tirage && j.expansion === i.expansion && j.numero != null && k(j.numero) === k(i.numero)));
        if (!auNumero.length) { noter('aucune vraie carte ne tient ce numéro : la fiche n\'est pas un doublon', f._id); continue; }
        const memeNom = auNumero.filter(c => clesNom(nomJointDe(c)).some(x => clesNom(f.nomEn).includes(x)));
        if (memeNom.length !== 1) { noter(`${auNumero.length} carte(s) au numéro, ${memeNom.length} du même nom : rien n'est déduit`, `${f._id} « ${f.nomEn} » n°${i.numero}`); continue; }
        const v = memeNom[0];
        // (relecture) l'en-tête le dit, le code le vérifie : le set de la fiche doit déjà être un set de la vraie carte
        if (!(v.sets || []).includes(S)) { noter('le set de la fiche n\'est pas un set de la vraie carte', `${f._id} → ${v._id} (${S})`); continue; }
        const brut = v.impressions.find(j => j && j.tirage === i.tirage && j.expansion === i.expansion && j.numero != null && k(j.numero) === k(i.numero)).numero;
        const lignes = await CP.find({ carteId: f._id }).toArray();
        if (!lignes.length) { noter('fiche sans ligne de jointure', f._id); continue; }
        if (lignes.some(l => l.slugSet !== S)) { noter('une ligne de la fiche dans un autre set', f._id); continue; }
        // la règle du site, pour la vraie carte dans S : chaque produit repointé se place par son numeroFiche sur une impression de S
        const fichesV = new Set(v.impressions.filter(j => j && j.tirage === i.tirage && j.expansion === i.expansion && j.numero != null).map(j => numeroComparable(j.numero)));
        const horsFiche = lignes.filter(l => !fichesV.has(numeroComparable(l.numeroFiche ?? i.numero)));
        if (horsFiche.length) { noter('un produit repointé ne trouverait aucune fiche de la vraie carte', `${f._id} → ${v._id} : ${horsFiche.map(l => `${l.idProduct}:${l.numeroFiche}`).join(', ')}`); continue; }
        const existantes = new Set((await CP.find({ _id: { $in: lignes.map(l => `${v._id}|${l.idProduct}`) } }, { projection: { _id: 1 } }).toArray()).map(x => x._id));
        // LE VISUEL (2026-10-07) : le worker a collecté le scan TCGdex de cinq de ces fiches. Retirer la fiche l'effacerait : il passe sur
        // la vraie carte, au numéro EXACT de son impression (le site apparie l'image à la fiche par ce numéro, normalisé sans couper la
        // parenthèse — « SWSH155 » ne retrouverait pas « SWSH155 (Top Left) »), sauf si la vraie carte en a déjà un à ce numéro.
        const aNum = n => String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
        const dejaVisuel = (v.images || []).some(m => m && m.set === S && aNum(m.numero) === aNum(brut));
        const visuels = (f.images || []).filter(m => m && m.set === S);
        plan.push({ f, v, S, i, brut, lignes, existantes, transferer: dejaVisuel ? [] : visuels, laisses: dejaVisuel ? visuels : [] });
    }
    console.log(`\n════ DÉNOMINATEUR : ${fiches.length} fiches TCGdex en base · doublons ${plan.length} · non touchées ${fiches.length - plan.length} ════`);
    for (const p of plan) console.log(`   ✂ ${p.f._id} « ${p.f.nomEn} » n°${p.i.numero} (${p.S}, ${p.i.tirage}) = ${p.v._id} « ${p.v.nomEn} » n°« ${String(p.brut).slice(0, 40)} » · ${p.lignes.length} ligne(s) repointée(s)${p.existantes.size ? ` (dont ${p.existantes.size} déjà sous la vraie carte : retirée seulement)` : ''} · visuel ${p.transferer.length ? `TRANSFÉRÉ (${p.transferer.map(m => m.source).join(', ')})` : p.laisses.length ? `de la fiche laissé : la vraie carte en a déjà un à ce numéro (${p.laisses.map(m => m.source).join(', ')})` : 'aucun sur la fiche'}`);
    for (const [m, xs] of Object.entries(refus)) console.log(`   · ${xs.length} non touchée(s) — ${m}${xs.length <= 6 ? ` : ${xs.join(' ; ')}` : ''}`);
    // l'annonce, par la fonction de la garde : les fiches retirées, les vraies cartes complétées
    // (2026-10-07) une vraie carte peut recevoir DEUX fiches (Morpeko V-UNION : SWSH215 et SWSH287) : elle se compte UNE fois de chaque côté
    const vAvant = new Map(plan.map(p => [p.v._id, p.v]));
    const avant = compterEtat({ cartes: [...plan.map(p => p.f), ...vAvant.values()], cartesProduits: plan.flatMap(p => p.lignes) });
    const vApres = new Map(); for (const p of plan) { const c = vApres.get(p.v._id) || { ...p.v, sets: [...(p.v.sets || [])], images: [...(p.v.images || [])] }; if (!c.sets.includes(p.S)) c.sets.push(p.S); c.images.push(...p.transferer.map(m => ({ ...m, numero: p.brut }))); vApres.set(p.v._id, c); }
    const apres = compterEtat({ cartes: [...vApres.values()], cartesProduits: plan.flatMap(p => p.lignes.map(l => ({ ...l, carteId: p.v._id }))) });
    const { baisses, hausses } = comparer(avant, apres);
    const annonce = Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-retirer-fiches-tcgdex-doublons-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(annonce, null, 1));
    console.log(`   annonce (${baisses.length} groupes) → ${fichier}\n   ${baisses.map(b => `${b.cle} −${b.baisse}`).join('\n   ')}\n   hausses : ${JSON.stringify(hausses)}`);
    if (!ECRIRE) { console.log('\n   (plan seul — lot-additif.js --annonce=<ce fichier> … -- node retirer-fiches-tcgdex-doublons.js --attendu=<n> --ecrire)'); await fermer(); return; }
    if (plan.length !== ATTENDU) { console.error(`❌ ARRÊT : ${plan.length} doublons, attendu ${ATTENDU}`); await fermer(); process.exit(1); }

    const le = new Date();
    let nL = 0, nR = 0, nF = 0, nV = 0, nI = 0;
    for (const p of plan) {
        const ids = p.lignes.map(l => l.idProduct), metas = [...new Set((p.f.liens?.idMetacards) || [])];
        // la vraie carte d'abord (le set et les produits), la ligne ensuite, la fiche en dernier
        nV += (await C.updateOne({ _id: p.v._id }, { $addToSet: { sets: p.S, 'liens.idProduct': { $each: ids }, 'liens.idMetacards': { $each: metas } } })).modifiedCount;
        if (p.transferer.length) {
            await C.updateOne({ _id: p.v._id }, { $push: { images: { $each: p.transferer.map(m => ({ ...m, numero: p.brut, repointeeDepuis: p.f._id, repointeeLe: le })) } } });
            // le document `images` suit (sa clé garde l'ancien identifiant : elle n'est qu'une clé ; la carte, elle, change)
            nI += (await cx.db.collection('images').updateMany({ carteId: p.f._id, set: p.S }, { $set: { carteId: p.v._id, repointeDepuis: p.f._id, repointeLe: le } })).modifiedCount;
        }
        for (const l of p.lignes) {
            if (!p.existantes.has(`${p.v._id}|${l.idProduct}`)) {
                const { _id, ...reste } = l;
                await CP.insertOne({ ...reste, _id: `${p.v._id}|${l.idProduct}`, carteId: p.v._id, preuve: 'tcgdex+impression', route: ROUTE, verifieLe: le,
                    detail: `${l.detail ?? ''} — repointée le 2026-10-07 depuis la fiche TCGdex ${p.f._id} : la carte ${p.v._id} « ${p.v.nomEn} » tient déjà ce numéro (écrit « ${String(p.brut).slice(0, 40)} »)` });
                nL++;
            }
            nR += (await CP.deleteOne({ _id: l._id, carteId: p.f._id })).deletedCount;
        }
        nF += (await C.deleteOne({ _id: p.f._id, 'ficheSimple.source': 'tcgdex' })).deletedCount;
    }
    // relu : plus aucune fiche retirée, plus aucune ligne sous elles, chaque produit sous sa vraie carte
    let reste = 0;
    for (const p of plan) reste += await C.countDocuments({ _id: p.f._id }) + await CP.countDocuments({ carteId: p.f._id }) + p.lignes.length - await CP.countDocuments({ _id: { $in: p.lignes.map(l => `${p.v._id}|${l.idProduct}`) } });
    // relu : chaque visuel transféré est sur la vraie carte, au numéro de son impression
    for (const p of plan) for (const m of p.transferer) reste += (await C.countDocuments({ _id: p.v._id, images: { $elemMatch: { set: p.S, cleR2: m.cleR2, numero: p.brut } } })) ? 0 : 1;
    console.log(`\n   ${reste ? '🔴' : '✅'} fiches retirées ${nF}/${plan.length} · lignes repointées ${nL} · lignes de fiche retirées ${nR} · vraies cartes complétées ${nV} · visuels transférés ${plan.reduce((n, p) => n + p.transferer.length, 0)} (documents images repointés ${nI}) · relu : ${reste} écart(s)`);
    console.log(`SETS : ${[...new Set(plan.map(p => p.S))].join(',')}`);
    if (reste || nF !== plan.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

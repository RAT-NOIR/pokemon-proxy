// ============================================================
// LES RÉIMPRESSIONS À CODE D'ORIGINE — la route des WCD et des Prize Packs, pour les autres familles (§49)
// ============================================================
//   node poser-reimpressions.js --codes=SEA,PPP,BOO23                       (mesure + 20 tirés au sort par famille)
//   node poser-reimpressions.js --codes=SEA,PPP --attendu=SEA:78,PPP:44 --ecrire   (par lot-additif.js)
//
// 🔑 LA FORME (mesurée le 2026-09-25 sur tout le catalogue) : 38 expansions écrivent, dans le slug de leurs produits, le code du set
// SUIVI du code du tirage d'ORIGINE et de son numéro — `Gengar-BOO23LOR-066` = Trick or Trade 2023, Lost Origin n°066 ;
// `Basic-Water-Energy-PPPSVE-011` = Professor Program, SVE n°011. C'est la clé des WCD (calibrée 1 540 / 0 faux) et des Prize Packs
// (1 132, 20/20 regardés) : (code d'origine, numéro) → produit(s) d'origine → la carte qu'ils désignent déjà dans cartes_produits,
// jugée par le témoin du nom (le nom n'entre pas dans la clé).
// ⚠️ UNE FAMILLE NE S'ÉCRIT QU'AVEC SON ATTENDU (`--attendu=CODE:N`) : le nombre mesuré en simulation, après avoir REGARDÉ ses 20 tirés
// au sort. Sans lui, ou s'il ne colle plus, rien ne s'écrit pour cette famille — la règle du testeur pour les Prize Packs, étendue.
// ⚠️ Comme les WCD : aucune image, aucune impression inventée ; le set se crée ensuite par creer-sets-reimpressions.js (fiche sans
// numéro, la règle du site importée).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero, normaliserNom, decomposerNomCardmarket } = require('./collecte-cartes/jointure');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const CODES = arg('codes').split(',').map(s => s.trim()).filter(Boolean);
const ATTENDUS = Object.fromEntries(arg('attendu').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
const echapper = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    if (!CODES.length || CODES.some(c => /^(WCD|PPS)/.test(c))) { console.error('❌ --codes=<codes de set> requis ; WCD et PPS ont leur outil (poser-wcd.js, poser-pps.js)'); process.exit(2); }
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const cat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } })).map(p => [p.idProduct, p]));
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set' });
    const expsDuCode = new Map(); for (const c of codes) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
    const tous = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1, codeSet: 1 } });
    const parExpNum = new Map();
    for (const p of tous) { const n = cleNumero(p.numero); const e = cat.get(p.idProduct)?.idExpansion; if (!n || e == null) continue; const k = `${e}|${n}`; (parExpNum.get(k) || parExpNum.set(k, []).get(k)).push(p.idProduct); }
    const cartesDe = new Map();
    for (const l of await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } })) (cartesDe.get(l.idProduct) || cartesDe.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);
    const nu = s => normaliserNom(String(s || '').replace(/δ/g, 'delta').replace(/[éè]/g, 'e'));
    const aEcrire = [];
    for (const CODE of CODES) {
        const famille = tous.filter(n => n.codeSet === CODE && n.slug);
        const MOTIF = new RegExp(`-${echapper(CODE)}([A-Z][A-Za-z0-9]*?)-([0-9]+[A-Za-z]?)$`);
        const causes = { resolu: [], nonDecode: [], codeInconnu: [], numeroAbsent: [], origineSansCarte: [], ambigu: [], deja: [], nomDiscordant: [] };
        for (const p of famille) {
            if (cartesDe.has(p.idProduct)) { causes.deja.push(p); continue; }
            const m = MOTIF.exec(String(p.slug).replace(/-V\d+(?=-|$)/, ''));
            if (!m) { causes.nonDecode.push(p); continue; }
            const [, code, num] = m;
            const exps = expsDuCode.get(code);
            if (!exps) { causes.codeInconnu.push({ ...p, code }); continue; }
            const cands = [...exps].flatMap(e => parExpNum.get(`${e}|${cleNumero(num)}`) || []);
            if (!cands.length) { causes.numeroAbsent.push({ ...p, code, num }); continue; }
            const cs = new Set(cands.flatMap(id => [...(cartesDe.get(id) || [])]));
            if (!cs.size) { causes.origineSansCarte.push({ ...p, code, num }); continue; }
            if (cs.size > 1) { causes.ambigu.push({ ...p, code, num }); continue; }
            causes.resolu.push({ ...p, code, num, cands, carteId: [...cs][0], idExpansion: cat.get(p.idProduct)?.idExpansion, idMetacard: cat.get(p.idProduct)?.idMetacard });
        }
        const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: causes.resolu.map(x => x.carteId) } }, { projection: { nomEn: 1, attaques: 1, impressions: 1 } }).toArray()).map(c => [c._id, c]));
        causes.resolu = causes.resolu.filter(x => {
            const a = nu(x.slug.replace(new RegExp(`-${echapper(CODE)}.*$`), '').replace(/-V\d+$/, '')), b = nu(cartes.get(x.carteId)?.nomEn);
            if (b && (a === b || a.includes(b) || b.includes(a))) return true;
            causes.nomDiscordant.push({ ...x, nomCarte: cartes.get(x.carteId)?.nomEn }); return false;
        });
        console.log(`\n■ ${CODE} : ${famille.length} produits appris · ${Object.entries(causes).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`);
        for (const x of causes.nomDiscordant.slice(0, 6)) console.log(`   TÉMOIN ✗ ${x.slug} → « ${x.nomCarte} »`);
        let g = 20260925; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (const x of [...causes.resolu].sort(() => hasard() - 0.5).slice(0, 20)) {
            const c = cartes.get(x.carteId), d = decomposerNomCardmarket(cat.get(x.idProduct)?.name || '');
            console.log(`   ${x.slug} « ${cat.get(x.idProduct)?.name} » → « ${c.nomEn} » [${(c.attaques || []).map(a => a.nom).join(' | ')}] / Cardmarket [${d.attaques.join(' | ')}] · ${(c.impressions || []).filter(i => i.tirage === 'intl').slice(0, 3).map(i => `${i.expansion} ${i.numero}`).join(' ; ')}`);
        }
        const attendu = ATTENDUS[CODE];
        if (attendu == null) console.log(`   (attendu non fourni : rien ne s'écrira pour ${CODE} — relire les tirés au sort, puis --attendu=${CODE}:${causes.resolu.length})`);
        else if (attendu !== causes.resolu.length) console.log(`   🔴 ${causes.resolu.length} résolus contre ${attendu} attendus : RIEN ne s'écrit pour ${CODE}`);
        else aEcrire.push(...causes.resolu.map(x => ({ ...x, route: CODE })));
    }
    if (!ecrire || !aEcrire.length) { console.log(`\n   ${aEcrire.length} fiches à poser${ecrire ? '' : ' — (mesure seule)'}`); await fermer(); return; }
    const PREUVE = 'reimpression+origine+numero';
    const r = await cx.db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: `${x.carteId}|${x.idProduct}` }, update: { $set: {
        carteId: x.carteId, idProduct: x.idProduct, idExpansion: x.idExpansion, tirage: 'intl', preuve: PREUVE, slug: x.slug, slugSet: x.slugSet, origine: { code: x.code, numero: x.num },
        detail: `slug ${x.slug} → tirage d'origine ${x.code} n°${x.num} → produit(s) ${x.cands.join('/')} → une seule carte`, verifieLe: new Date(), route: x.route } }, upsert: true } })), { ordered: false });
    const parCarte = new Map(); for (const x of aEcrire) { const v = parCarte.get(x.carteId) || parCarte.set(x.carteId, { ids: [], metas: new Set() }).get(x.carteId); v.ids.push(x.idProduct); if (x.idMetacard != null) v.metas.add(x.idMetacard); }
    await cx.db.collection('cartes').bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] } } } } })), { ordered: false });
    const relu = await cx.db.collection('cartes_produits').countDocuments({ preuve: PREUVE, route: { $in: CODES } });
    console.log(`\n   ✅ ${r.upsertedCount} insérées · ${r.modifiedCount} modifiées · RELU « ${PREUVE} » pour ${CODES.join(',')} : ${relu} (attendu ${aEcrire.length})`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

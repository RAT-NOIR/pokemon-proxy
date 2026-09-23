// ============================================================
// LES WCD SANS CODE D'ORIGINE — (NOM, NUMÉRO D'ORIGINE), CALIBRÉ SUR LES WCD QUI EN ONT UN (§49)
// ============================================================
//   node poser-wcd-nom-numero.js            (calibration + mesure, c'est le défaut)
//   node poser-wcd-nom-numero.js --ecrire   (écrit sur `cartes` : cartes_produits + cartes.liens)
//
// 🔑 LA FORME DU SLUG : `Teal-Mask-Ogerpon-ex-WCD25025`, `Iono-V3-WCD25185`. Le numéro est celui du tirage d'ORIGINE
// (Twilight Masquerade 025, Paldea Evolved 185), mais le CODE du set n'y est pas — la route 1 (`poser-wcd.js`) ne peut
// rien en dire. Ce qui reste : le NOM du produit et ce numéro. Une carte dont une impression intl porte ce numéro ET qui
// porte ce nom est candidate ; UNE seule candidate au niveau de la CARTE, et la fiche est possible.
//
// 🔴 LE NOM EST DANS LA CLÉ : IL NE PEUT PLUS ÊTRE LE TÉMOIN. La route 1 confrontait le nom à une clé qui ne l'utilisait
// pas (§16) ; ici, il n'y a plus de donnée indépendante pour les cartes sans attaque. Deux parades, et la première décide :
//   1. LA CALIBRATION SUR CE QUI MARCHE (§22, §48) : les 1 679 WCD posés par la route 1 ont leur vérité. On CACHE leur code
//      d'origine et on demande à cette clé ce qu'elle aurait rendu. Un seul faux, et rien n'est écrit — zéro faux affirmé.
//   2. LES ATTAQUES, quand le produit en porte (« Mew ex [Restart | Genome Hacking] ») : témoin indépendant de la clé. Une
//      carte dont aucune attaque ne concorde est refusée.
// Pas d'image, pas de `cartes.sets` : mêmes raisons que la route 1 (voir poser-wcd.js).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { champSur, lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero, normaliserNom, decomposerNomCardmarket } = require('./collecte-cartes/jointure');

const MOTIF_SANS_CODE = /WCD(\d{2})(\d{3})$/;              // WCD25025 : l'année, puis le numéro d'origine
const MOTIF_ROUTE_1 = /WCD(\d{2})([A-Za-z0-9]*)-([0-9A-Za-z]+)$/;
const PREUVE = 'wcd+nom+numero';
const cleNom = s => normaliserNom(String(s || '').replace(/^Basic\s+/i, ''));
const cleAttaque = a => String(a || '').split(/\s+/).map(normaliserNom).filter(Boolean).sort().join(' ');
const pad = (v, n) => String(v).padStart(n);

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const wcd = await lireMongo(prod.db.collection('numeros_cartes'), { slugSet: /^WCD/ }, { nom: 'numeros_cartes (WCD)', projection: { idProduct: 1, idExpansion: 1, idMetacard: 1, slugSet: 1, slug: 1 } });
    champSur(wcd, 'slug', { collection: 'numeros_cartes (WCD)' });
    const nomDe = new Map((await lireMongo(prod.db.collection('catalogue_produits'), { idProduct: { $in: wcd.map(p => p.idProduct) } }, { nom: 'catalogue_produits (WCD)', projection: { idProduct: 1, name: 1 } })).map(p => [p.idProduct, decomposerNomCardmarket(p.name)]));
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, impressions: 1, attaques: 1 } });
    champSur(cartes, 'impressions', { collection: 'cartes' });
    // (nom, numéro d'une impression INTL) -> cartes. Multiplicités gardées : c'est la carte qu'on compte, pas l'impression.
    const index = new Map();
    for (const c of cartes) for (const i of c.impressions || []) {
        if (i.tirage !== 'intl' || !i.numero) continue;
        const k = `${cleNom(c.nomEn)}|${cleNumero(i.numero)}`;
        (index.get(k) || index.set(k, new Map()).get(k)).set(c._id, c);
    }
    const liens = await lireMongo(cx.db.collection('cartes_produits'), { idProduct: { $in: wcd.map(p => p.idProduct) } }, { nom: 'cartes_produits (WCD)', videAutorise: 'aucun WCD posé : la calibration ne pourra pas conclure et le dira', projection: { idProduct: 1, carteId: 1, preuve: 1 } });
    const verite = new Map(); for (const l of liens) (verite.get(l.idProduct) || verite.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);

    // LA CLÉ — une seule définition, appliquée à la calibration ET à la cible
    const resoudre = (p, num) => {
        const d = nomDe.get(p.idProduct);
        if (!d) return { etat: 'sans-nom' };
        const cands = [...(index.get(`${cleNom(d.nom)}|${cleNumero(num)}`) || new Map()).values()];
        if (!cands.length) return { etat: 'aucune' };
        if (cands.length > 1) return { etat: 'ambigu', cands: cands.map(c => c._id) };
        const c = cands[0];
        if (d.attaques.length) {
            const s = new Set((c.attaques || []).map(a => cleAttaque(a.nom)));
            if (!d.attaques.some(a => s.has(cleAttaque(a)))) return { etat: 'attaques-discordantes', carteId: c._id };
        }
        return { etat: 'une', carteId: c._id, nom: c.nomEn, attaques: d.attaques.length };
    };

    // ── 1. LA CALIBRATION : les WCD de la route 1, code d'origine CACHÉ
    const C = { juste: 0, faux: [], ambigu: 0, aucune: 0, autre: 0, population: 0 };
    for (const p of wcd) {
        const m = MOTIF_ROUTE_1.exec(p.slug || '');
        const v = verite.get(p.idProduct);
        if (!m || !v || v.size !== 1) continue;
        C.population++;
        const r = resoudre(p, m[3]);
        if (r.etat === 'une') { if (v.has(r.carteId)) C.juste++; else C.faux.push(`${p.slug} → ${r.carteId} « ${r.nom} », la vérité est ${[...v][0]}`); }
        else if (r.etat === 'ambigu') C.ambigu++; else if (r.etat === 'aucune') C.aucune++; else C.autre++;
    }
    console.log(`\n════ CALIBRATION sur ${C.population} WCD dont la route 1 connaît la carte (code d'origine caché) ════`);
    console.log(`   ✅ ${C.juste} une carte, la bonne · 🔴 ${C.faux.length} une carte, la MAUVAISE · ⚠️ ${C.ambigu} ambigus (refusés) · ⚪ ${C.aucune} aucune · ${C.autre} autres refus`);
    for (const f of C.faux.slice(0, 15)) console.log(`      ${f}`);
    if (!C.population) throw new Error('calibration impossible : aucune vérité de la route 1 — on ne pose rien sans elle');
    const precision = C.juste / (C.juste + C.faux.length || 1);
    console.log(`   PRÉCISION quand la clé parle : ${(100 * precision).toFixed(2)} %`);

    // ── 2. LA CIBLE : les slugs sans code d'origine, pas encore rattachés
    const cible = wcd.filter(p => MOTIF_SANS_CODE.test(p.slug || '') && !verite.has(p.idProduct));
    const R = { une: [], ambigu: [], aucune: [], discordant: [], sansNom: [] };
    for (const p of cible) {
        const num = MOTIF_SANS_CODE.exec(p.slug)[2];
        const r = resoudre(p, num);
        ({ une: R.une, ambigu: R.ambigu, aucune: R.aucune, 'attaques-discordantes': R.discordant, 'sans-nom': R.sansNom })[r.etat].push({ ...p, num, ...r });
    }
    console.log(`\n════ CIBLE : ${cible.length} WCD sans code d'origine (${[...new Set(cible.map(p => p.slugSet))].join(', ')}) ════`);
    console.log(`   ✅ ${pad(R.une.length, 4)} une carte · ⚠️ ${pad(R.ambigu.length, 4)} ambigus · ⚪ ${pad(R.aucune.length, 4)} aucune · 🔴 ${pad(R.discordant.length, 4)} attaques discordantes · ${R.sansNom.length} sans nom`);
    for (const x of R.une.slice(0, 6)) console.log(`      ${x.slug} → ${x.carteId} « ${x.nom} »${x.attaques ? ' (attaques concordantes)' : ''}`);
    for (const x of [...R.ambigu, ...R.aucune, ...R.discordant].slice(0, 12)) console.log(`      ✗ ${x.slug} « ${nomDe.get(x.idProduct)?.nom} » : ${x.etat}${x.cands ? ' ' + x.cands.join(', ') : ''}`);

    if (!ecrire) { console.log(`\n   (mesure seule — --ecrire ne pose rien si la calibration a rendu un seul faux)`); await fermer(); return; }
    if (C.faux.length) throw new Error(`ARRÊT : la calibration a rendu ${C.faux.length} faux — zéro faux affirmé, rien n'est écrit`);

    const maintenant = new Date();
    const r = await cx.db.collection('cartes_produits').bulkWrite(R.une.map(x => ({ updateOne: { filter: { _id: `${x.carteId}|${x.idProduct}` }, update: { $set: {
        carteId: x.carteId, idProduct: x.idProduct, idExpansion: x.idExpansion, tirage: 'intl', preuve: PREUVE, slug: x.slug, slugSet: x.slugSet,
        detail: `slug ${x.slug} → nom « ${nomDe.get(x.idProduct).nom} » + numéro d'origine ${x.num} → une seule carte intl${x.attaques ? ', attaques concordantes' : ''} (calibré : ${C.juste}/${C.juste + C.faux.length} sur la route 1)`,
        verifieLe: maintenant, route: 'wcd' } }, upsert: true } })), { ordered: false });
    const parCarte = new Map();
    for (const x of R.une) { const e = parCarte.get(x.carteId) || parCarte.set(x.carteId, { ids: [], metas: new Set() }).get(x.carteId); e.ids.push(x.idProduct); if (x.idMetacard != null) e.metas.add(x.idMetacard); }
    await cx.db.collection('cartes').bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] } } } } })), { ordered: false });
    const apres = await cx.db.collection('cartes_produits').countDocuments({ preuve: PREUVE });
    const multi = await cx.db.collection('cartes_produits').aggregate([{ $match: { preuve: PREUVE } }, { $group: { _id: '$idProduct', c: { $addToSet: '$carteId' } } }, { $match: { 'c.1': { $exists: true } } }, { $count: 'n' }]).toArray();
    console.log(`\n   ✅ ${r.upsertedCount} insérées · lignes « ${PREUVE} » en base : ${apres} (attendu ${R.une.length}) · produits à plusieurs cartes : ${multi[0]?.n || 0}`);
    if (apres !== R.une.length) console.log(`   🔴 LE COMPTE RÉEL NE COLLE PAS — à ouvrir avant toute autre écriture.`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

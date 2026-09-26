// ============================================================
// LES SETS DE DECKS RÉIMPRIMÉS (Battle Academy) — chaque produit joint à sa carte d'origine par la liste de deck de la page
// ============================================================
//   node poser-listes-de-deck.js --pages=<json> --codes=BA20,BA22,BA24                          (mesure + 20 tirés au sort par set)
//   node poser-listes-de-deck.js --pages=<json> --codes=… --attendu=BA20:N,BA22:N --ecrire        (par lot-additif.js)
//
// `--pages` : les pages des produits lues par la sonde ({ code, page, pageid, revid, content }) — la page n'est pas archivée, sa
// révision voyage avec chaque ligne. La règle et ses témoins : collecte-cartes/listes-de-deck.js (banc test-listes-de-deck.js).
// ⚠️ UN SET NE S'ÉCRIT QU'AVEC SON ATTENDU (`--attendu=CODE:N`), le nombre mesuré en simulation APRÈS avoir regardé ses tirés au sort.
// ⚠️ Comme les WCD et les Prize Packs : aucune image (le visuel d'une réimpression Battle Academy porte le marqueur du deck, ce n'est
// pas celui du tirage d'origine, §19), aucune impression inventée ; le set se crée ensuite par creer-sets-reimpressions.js.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { produitsDeLExpansion, cleNumero } = require('./collecte-cartes/jointure');
const { decksDeLaPage, mesurerPrefixes, joindreParDeck } = require('./collecte-cartes/listes-de-deck');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const CODES = arg('codes').split(',').map(s => s.trim()).filter(Boolean);
const ATTENDUS = Object.fromEntries(arg('attendu').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
// Deux preuves, selon la clé : la POSITION de l'ordre imprimé (le nom est témoin), ou le NOM dans le deck (les attaques sont témoins).
const PREUVES = { position: 'deck+section+position', nom: 'deck+section+nom' };

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const inconnus = process.argv.slice(2).filter(a => !/^--(pages|codes|attendu)=/.test(a) && a !== '--ecrire');
    if (!CODES.length || !arg('pages') || inconnus.length) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --pages=<json> --codes=A,B [--attendu=A:N] [--ecrire]`); process.exit(2); }
    const PAGES = JSON.parse(fs.readFileSync(arg('pages'), 'utf8'));
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const dejaJoints = new Set((await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1 } })).map(l => l.idProduct));
    const aEcrire = [];
    for (const CODE of CODES) {
        const pg = PAGES.find(p => p.code === CODE);
        if (!pg?.content) { console.log(`\n■ ${CODE} : aucune page fournie — rien`); continue; }
        const cs = await prod.db.collection('codes_set').find({ codeSet: CODE }).toArray();
        if (cs.length !== 1) { console.log(`\n■ ${CODE} : ${cs.length} expansions portent ce code — on ne devine pas`); continue; }
        const idExp = cs[0].idExpansion;
        const produits = (await produitsDeLExpansion(prod, idExp)).filter(p => !dejaJoints.has(p.idProduct));
        const decks = decksDeLaPage(pg.content);
        // Les cartes citées : par le TITRE de page, sinon par l'impression déclarée (tirage intl, set et numéro d'origine), unique.
        const entrees = decks.flatMap(d => d.entrees);
        const parTitre = new Map((await cx.db.collection('cartes').find({ 'bulba.titre': { $in: [...new Set(entrees.map(e => e.titre))] } }, { projection: { nomEn: 1, attaques: 1, niveau: 1, 'bulba.titre': 1 } }).toArray()).map(c => [c.bulba.titre, c]));
        const sansTitre = entrees.filter(e => !parTitre.has(e.titre) && e.a && e.b);
        const parImp = new Map();
        for (const c of await cx.db.collection('cartes').find({ impressions: { $elemMatch: { tirage: 'intl', expansion: { $in: [...new Set(sansTitre.map(e => e.a))] } } } }, { projection: { nomEn: 1, attaques: 1, niveau: 1, impressions: 1, 'bulba.titre': 1 } }).toArray())
            for (const i of c.impressions || []) if (i.tirage === 'intl' && i.numero != null) { const k = `${i.expansion}|${cleNumero(i.numero)}`; (parImp.get(k) || parImp.set(k, new Map()).get(k)).set(c._id, c); }
        const carteDe = e => parTitre.get(e.titre) || (() => { const m = parImp.get(`${e.a}|${cleNumero(e.b)}`); return m && m.size === 1 ? [...m.values()][0] : null; })();
        const nonResolues = [...new Set(entrees.filter(e => !carteDe(e)).map(e => e.titre))];
        const { prefixes, matrice } = mesurerPrefixes(decks, produits, carteDe);
        const { resolus, causes } = joindreParDeck({ decks, produits, carteDe, prefixes, codeDuSet: CODE });
        console.log(`\n■ ${CODE} (exp ${idExp}) « ${pg.page} » rév. ${pg.revid} : ${decks.length} decks (${decks.map(d => `${d.titre} ${d.entrees.length}`).join(', ')}) · ${entrees.length} entrées, ${nonResolues.length} cartes non trouvées en base${nonResolues.length ? ` (${nonResolues.slice(0, 5).join(' ; ')}${nonResolues.length > 5 ? ' …' : ''})` : ''}`);
        console.log(`   DÉNOMINATEUR : ${produits.length} produits sans fiche (hors cartes-code) · résolus ${resolus.length} (par la position ${resolus.filter(r => r.cle === 'position').length}, par le nom ${resolus.filter(r => r.cle === 'nom').length}) · ${Object.entries(causes).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`);
        console.log(`   ordre imprimé : ${decks.map(d => `${d.titre} ${d.ordre ? `${d.ordre.size} positions` : 'aucun'}`).join(' · ')}`);
        for (const x of [...causes.nomDiscordant, ...causes.positionAbsente].slice(0, 6)) console.log(`   ✗ position : ${(x.p || x).numero} « ${(x.p || x).name} »${x.entree ? ` → ${x.entree}` : ' (position absente de l\'ordre)'}`);
        for (const [L, m] of Object.entries(matrice)) console.log(`   préfixe ${L.padEnd(4)} ${m.total} Pokémon · ${Object.entries(m.parDeck).map(([d, n]) => `${d} ${n}`).join(' · ')} → ${m.retenu ?? `NON APPARIÉ (${m.raison})`}`);
        for (const x of causes.ambigu.slice(0, 5)) console.log(`   ambigu : ${x.p.numero} « ${x.p.name} » → ${x.candidats.join(' | ')}`);
        for (const x of [...causes.attaquesDiscordantes, ...causes.origineDiscordante].slice(0, 6)) console.log(`   ✗ ${x.p.numero} « ${x.p.name} » → ${x.entree}${x.origine ? ` (slug : ${x.origine.code}${x.origine.numero})` : ''}`);
        const sc = {}; for (const p of causes.sansCandidat) sc[p.nom] = (sc[p.nom] || 0) + 1;
        console.log(`   sans candidat : ${Object.entries(sc).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ×${k}`).join(', ') || '—'}`);
        let g = 20260926; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (const r of [...resolus].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${String(r.p.numero).padEnd(6)} « ${r.p.name} » → « ${r.entree.titre} » [${(r.carte.attaques || []).map(a => a.nom).join(' | ')}] · ${r.temoins.join(' · ')}`);
        const attendu = ATTENDUS[CODE];
        if (attendu == null) console.log(`   (attendu non fourni : rien ne s'écrira pour ${CODE} — relire les tirés au sort, puis --attendu=${CODE}:${resolus.length})`);
        else if (attendu !== resolus.length) console.log(`   🔴 ${resolus.length} résolus contre ${attendu} attendus : RIEN ne s'écrit pour ${CODE}`);
        else aEcrire.push(...resolus.map(r => ({ ...r, CODE, idExp, pg })));
    }
    if (!ecrire || !aEcrire.length) { console.log(`\n   ${aEcrire.length} fiches à poser${ecrire ? '' : ' — (mesure seule)'}`); await fermer(); return; }
    const r = await cx.db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: `${x.carte._id}|${x.p.idProduct}` }, update: { $set: {
        carteId: x.carte._id, idProduct: x.p.idProduct, idExpansion: x.idExp, tirage: 'intl', preuve: PREUVES[x.cle], slug: x.p.slug ?? null, slugSet: x.p.slugSet ?? null, numeroFiche: null,
        origine: { titre: x.entree.titre, set: x.entree.a ?? null, numero: x.entree.b ?? null },
        detail: `${x.CODE} n°${x.p.numero} → deck « ${x.deck} »${x.cle === 'position' ? `, position ${x.entree.rang} de l'ordre imprimé` : ', par le nom'} de la page « ${x.pg.page} » (rév. ${x.pg.revid}) → « ${x.entree.titre} » · témoins : ${x.temoins.join(', ')}`,
        verifieLe: new Date(), route: x.CODE } }, upsert: true } })), { ordered: false });
    const parCarte = new Map(); for (const x of aEcrire) { const v = parCarte.get(x.carte._id) || parCarte.set(x.carte._id, { ids: [], metas: new Set() }).get(x.carte._id); v.ids.push(x.p.idProduct); if (x.p.idMetacard != null) v.metas.add(x.p.idMetacard); }
    await cx.db.collection('cartes').bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] } } } } })), { ordered: false });
    const relu = await cx.db.collection('cartes_produits').countDocuments({ preuve: { $in: Object.values(PREUVES) }, route: { $in: CODES } });
    console.log(`\n   ✅ ${r.upsertedCount} insérées · ${r.modifiedCount} modifiées · RELU « ${Object.values(PREUVES).join(' » / « ')} » pour ${CODES.join(',')} : ${relu} (attendu ${aEcrire.length})`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

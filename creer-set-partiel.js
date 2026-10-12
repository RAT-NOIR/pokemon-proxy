// ============================================================
// LE SET PARTIEL — Promos (2107) : les produits qui se PROUVENT par leur code d'origine, et la raison de chacun des autres
// ============================================================
//   node creer-set-partiel.js                       (mesure seule : classement, témoin du nom, 20 tirés au sort, nom proposé)
//   node creer-set-partiel.js --attendu=53 --ecrire  (par lot-additif.js ; additif : $setOnInsert / $addToSet seulement)
//
// 🔑 DÉCISION DU TESTEUR (2026-10-12) : « Promos (2107) : CRÉE le set partiel (règle : on publie, on complète ensuite). » L'expansion n'a
// pas de tirage prouvé EN ENTIER (T4a) ; 53 produits écrivent le code et le numéro de leur tirage d'ORIGINE dans leur slug. C'est la
// route des réimpressions (poser-reimpressions.js, creer-sets-reimpressions.js) — la résolution vit dans collecte-cartes/set-partiel.js,
// partagée avec poser-reimpressions.js. Ce que cet outil ajoute : `sets.partiel` (prouvé / total, lisible par le site), le tirage intl
// prouvé par les seuls prouvés, et un document `restes` par produit non prouvé avec sa raison. Aucun visuel : ni image, ni substitut.
// ⚠️ UNE ÉCRITURE NE S'AUTORISE QU'AVEC SON ATTENDU (`--attendu=N` = le nombre de prouvés de la simulation, après avoir REGARDÉ les 20 tirés
// au sort) ; il ne colle plus → rien ne s'écrit. Une liste fermée de sets : une expansion absente de PARTIELS est refusée.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero } = require('./collecte-cartes/jointure');
const { nommerLesNouveaux, insererSetNeuf } = require('./collecte-cartes/set-nomme');
const SP = require('./collecte-cartes/set-partiel');

const TP = require('./collecte-cartes/table-pwc');

// La liste FERMÉE des sets partiels : l'expansion, le slugSet Cardmarket, le code de famille (codeSet) et la route.
//   2107 Promos : le set EXISTE (53/93 posés le 2026-10-12) ; `formeCollee` (S6) y ajoute Rainbow-Energy-TR17 — un COMPLÉMENT d'un set existant
//        est une MODIFICATION (compteurs `partiel`, reste à retirer) : la simulation le dit, l'écriture le REFUSE tant qu'un feu vert nommé n'a pas
//        ajouté un chemin de mise à jour.
//   4392 Pikachu World Collection (S6) : origines lues dans la TABLE FERMÉE (collecte-cartes/table-pwc.js), attaques de Cardmarket vérifiées.
const PARTIELS = {
    2107: { slug: 'Promos', CODE: 'PR', route: 'pr', formeCollee: true },
    4392: { slug: 'Pikachu-World-Collection', CODE: 'PWC', route: 'pwc', origines: TP.originesPwc, verifierAttaques: true, lecture: `par la table fermée (${TP.PAGE})`, chemin: 'ligne de la page de l\'expansion → numéro Wizards Black Star Promos → produit d\'origine → une seule carte au même titre → attaques de Cardmarket = celles de la carte → impression intl à ce numéro ; langue occidentale lue sur la page' },
};

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const INCONNUS = process.argv.slice(2).filter(a => !/^--(set|attendu|sortie)=.+$/.test(a) && a !== '--ecrire');

(async () => {
    if (INCONNUS.length) { console.error(`❌ argument inconnu : ${INCONNUS.join(' ')} — usage : [--set=2107] [--attendu=N] [--ecrire]`); process.exit(2); }
    const ecrire = process.argv.includes('--ecrire');
    const EXP = Number(arg('set') || 2107), conf = PARTIELS[EXP];
    if (!conf) { console.error(`❌ expansion ${EXP} absente de la liste fermée PARTIELS (${Object.keys(PARTIELS).join(', ')})`); process.exit(2); }
    const attendu = arg('attendu') === '' ? null : Number(arg('attendu'));
    if (ecrire && (attendu == null || !Number.isInteger(attendu))) { console.error('❌ --ecrire exige --attendu=N (le nombre de prouvés de la simulation)'); process.exit(2); }
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const cat = await lireMongo(prod.db.collection('catalogue_produits'), { idExpansion: EXP }, { nom: `catalogue_produits (${EXP})`, projection: { idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } });
    const tousCat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { idProduct: 1, idExpansion: 1 } })).map(p => [p.idProduct, p.idExpansion]));
    const numeros = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1, codeSet: 1 } });
    const numDe = new Map(numeros.map(n => [n.idProduct, n]));
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set' });
    const expsDuCode = new Map(); for (const c of codes) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
    const parExpNum = new Map();
    for (const p of numeros) { const n = cleNumero(p.numero), e = tousCat.get(p.idProduct); if (!n || e == null) continue; const k = `${e}|${n}`; (parExpNum.get(k) || parExpNum.set(k, []).get(k)).push(p.idProduct); }
    const cartesDe = new Map();
    for (const l of await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } })) (cartesDe.get(l.idProduct) || cartesDe.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);

    const produits = cat.map(p => { const n = numDe.get(p.idProduct); return { idProduct: p.idProduct, idExpansion: p.idExpansion, idMetacard: p.idMetacard, name: p.name, appris: !!n, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null }; });
    const ctx = { expsDuCode, parExpNum, cartesDe, ...(conf.origines ? { origines: conf.origines() } : {}), ...(conf.formeCollee ? { formeCollee: true } : {}), ...(conf.verifierAttaques ? { verifierAttaques: true } : {}) };
    // 1re passe : les cartes désignées et le pool (cartes des sets d'ORIGINE) — lus en une fois
    const resolus = produits.filter(p => p.appris && !cartesDe.has(p.idProduct)).map(p => SP.resoudreProduit(p, conf.CODE, ctx)).filter(x => x.cause === 'resolu');
    const PROJ = { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, sets: 1, 'bulba.titre': 1 };
    const cartesParId = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(resolus.map(x => x.carteId))] } }, { projection: PROJ }).toArray()).map(c => [c._id, c]));
    const slugsOrigine = [...new Set(resolus.flatMap(x => x.cands.map(id => numDe.get(id)?.slugSet)).filter(Boolean))];
    const poolBrut = await cx.db.collection('cartes').find({ sets: { $in: slugsOrigine } }, { projection: PROJ }).toArray();
    if (resolus.length && !poolBrut.length) throw new Error(`pool des cartes d'origine VIDE pour ${slugsOrigine.length} sets d'origine : le témoin du nom se tairait sur tout — arrêt`);
    const poolDe = x => { const sl = new Set(x.cands.map(id => numDe.get(id)?.slugSet).filter(Boolean)); return poolBrut.filter(c => (c.sets || []).some(s => sl.has(s))); };
    const C = SP.classerProduits({ produits, CODE: conf.CODE, ctx, cartesParId, poolDe });
    const P = SP.partielDe(C, conf.chemin ? { chemin: conf.chemin } : undefined);

    console.log(`\n════ DÉNOMINATEUR : ${cat.length} produits au catalogue (exp ${EXP}) · ${numeros.length} lignes numeros_cartes lues · ${cartesDe.size} produits déjà joints (toute la base) ════`);
    console.log(`   prouvés ${C.prouves.length} · contredits par le nom ${C.contredits.length} · restes ${C.restes.length} · déjà joints ${C.deja.length} · cartes-code hors dénominateur ${C.horsDenominateur.length} · total ${P.total}  (somme ${C.prouves.length + C.contredits.length + C.restes.length + C.deja.length + C.horsDenominateur.length} = ${cat.length})`);
    const parCause = {}; for (const r of C.restes) parCause[r.cause] = (parCause[r.cause] || 0) + 1;
    console.log(`   restes par raison : ${Object.entries(parCause).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
    for (const x of C.contredits) console.log(`   TÉMOIN ✗ ${x.idProduct} « ${x.name} » (${x.slug}) → carte ${x.carteId} « ${cartesParId.get(x.carteId)?.nomEn} » ; le nom désigne ${x.autres.map(c => `« ${c.nomEn} »`).join(', ')}`);
    for (const x of C.deja) console.log(`   déjà jointe : ${x.idProduct} « ${x.name} » → carte(s) ${[...cartesDe.get(x.idProduct)].join(',')}`);
    for (const x of C.restes) console.log(`   reste [${x.cause}] ${x.idProduct} « ${x.name} »${x.slug ? ` (${x.slug})` : ''}`);
    let g = 20261012; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log(`\n   20 prouvés tirés au sort (graine 20261012) :`);
    for (const x of [...C.prouves].sort(() => hasard() - 0.5).slice(0, 20)) {
        const c = cartesParId.get(x.carteId);
        console.log(`   ${x.slug} « ${x.name} » → ${x.code} n°${x.num} → carte ${x.carteId} « ${c.nomEn} » [${(c.attaques || []).map(a => a.nom).join(' | ')}] · intl ${(c.impressions || []).filter(i => i.tirage === 'intl').slice(0, 2).map(i => `${i.expansion} ${i.numero}`).join(' ; ')}`);
    }
    const nbTirage = C.prouves.filter(x => (cartesParId.get(x.carteId)?.impressions || []).some(i => i.tirage === 'intl' && cleNumero(String(i.numero ?? '').split('/')[0]) === cleNumero(x.num))).length;
    console.log(`\n   TIRAGE intl : prouvé par ${nbTirage}/${C.prouves.length} prouvés (impression intl de la carte au numéro d'origine) — par eux et seulement eux`);
    if (nbTirage !== C.prouves.length) throw new Error('le tirage intl ne se prouve pas pour tous les prouvés — arrêt');

    const le = new Date();
    const existant = await cx.db.collection('sets').findOne({ _id: conf.slug }, { projection: { _id: 1, idExpansion: 1, partiel: 1 } });
    const doc = SP.docSetPartiel({ slug: conf.slug, code: conf.CODE, exps: [EXP], route: conf.route, partiel: P, le, ...(conf.lecture ? { lecture: conf.lecture } : {}) });
    const nommes = await nommerLesNouveaux(cx.db, prod.db, [doc]);   // lève « SET SANS NOM REFUSÉ » avant toute écriture
    console.log(`   set « ${conf.slug} » : ${existant ? `EXISTE déjà (idExpansion ${JSON.stringify(existant.idExpansion)}) — rien ne sera modifié` : 'à créer'} · nom affiché : « ${nommes.champsDe.get(conf.slug)?.nomAffichage ?? '(set existant)'} » (${nommes.champsDe.get(conf.slug)?.nomAffichageSource ?? '—'})`);
    console.log(`   ${P.mention}`);
    const lignes = SP.lignesDe({ slugSet: conf.slug, CODE: conf.CODE, classement: C, idExpansion: EXP, le });
    const restes = SP.restesDe(conf.slug, C, le);
    const cartesTouchees = [...new Set(lignes.map(l => l.carteId))];
    console.log(`   à écrire : 1 set · ${lignes.length} lignes cartes_produits · ${restes.length} restes · ${cartesTouchees.length} cartes (cartes.sets + liens, $addToSet seulement)`);
    // La simulation, pour que la règle du site IMPORTÉE la rejoue (sans écrire en base) : un fichier JSON, jamais la base.
    if (arg('sortie')) { require('fs').writeFileSync(arg('sortie'), JSON.stringify({ doc: { ...doc, ...(nommes.champsDe.get(conf.slug) ?? {}) }, lignes, restes, cartes: cartesTouchees }, null, 1), 'utf8'); console.log(`   simulation écrite : ${arg('sortie')}`); }
    if (!ecrire) { console.log('\n   (mesure seule — relancer avec --attendu=' + C.prouves.length + ' --ecrire)'); await fermer(); return; }
    if (attendu !== C.prouves.length) { console.log(`\n   🔴 ${C.prouves.length} prouvés contre ${attendu} attendus : RIEN ne s'écrit`); await fermer(); process.exitCode = 1; return; }
    // (S6) un set qui EXISTE déjà ne se complète pas ici : ses compteurs `partiel` et ses `restes` seraient périmés — c'est une MODIFICATION
    if (existant && existant.partiel && existant.partiel.prouves !== C.prouves.length) { console.log(`\n   🔴 le set « ${conf.slug} » existe avec ${existant.partiel.prouves} prouvés, la simulation en trouve ${C.prouves.length} : COMPLÉMENT = MODIFICATION (compteurs partiel, restes à retirer), il attend un feu vert nommé — RIEN ne s'écrit`); await fermer(); process.exitCode = 1; return; }

    const crees = await insererSetNeuf(cx.db.collection('sets'), doc, nommes);
    const r = await cx.db.collection('cartes_produits').bulkWrite(lignes.map(({ _id, ...corps }) => ({ updateOne: { filter: { _id }, update: { $setOnInsert: corps }, upsert: true } })), { ordered: false });
    const metaDe = new Map(produits.map(p => [p.idProduct, p.idMetacard]));
    const parCarte = new Map();
    for (const l of lignes) (parCarte.get(l.carteId) || parCarte.set(l.carteId, { ids: [], metas: new Set() }).get(l.carteId)).ids.push(l.idProduct);
    for (const l of lignes) if (metaDe.get(l.idProduct) != null) parCarte.get(l.carteId).metas.add(metaDe.get(l.idProduct));
    const rc = await cx.db.collection('cartes').bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { sets: conf.slug, 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] } } } } })), { ordered: false });
    let nr = 0;
    for (const x of restes) nr += (await cx.db.collection('restes').updateOne({ set: x.set, type: x.type, idProduct: x.idProduct }, { $setOnInsert: x }, { upsert: true })).upsertedCount;
    const relu = { set: await cx.db.collection('sets').countDocuments({ _id: conf.slug, 'partiel.prouves': C.prouves.length }), lignes: await cx.db.collection('cartes_produits').countDocuments({ preuve: SP.PREUVE, route: conf.CODE, slugSet: conf.slug }), restes: await cx.db.collection('restes').countDocuments({ set: conf.slug, type: /^partiel-/ }), cartes: await cx.db.collection('cartes').countDocuments({ _id: { $in: cartesTouchees }, sets: conf.slug }) };
    console.log(`\n   ✅ set créé ${crees} · lignes insérées ${r.upsertedCount} · cartes modifiées ${rc.modifiedCount} · restes insérés ${nr}`);
    console.log(`   RELU : set avec partiel.prouves=${C.prouves.length} : ${relu.set} (attendu ${existant ? 'déjà là' : 1}) · lignes ${relu.lignes} (attendu ${lignes.length}) · restes ${relu.restes} (attendu ${restes.length}) · cartes portant le slug ${relu.cartes} (attendu ${cartesTouchees.length})`);
    await fermer();
    if (relu.lignes !== lignes.length || relu.restes !== restes.length || relu.cartes !== cartesTouchees.length || (!existant && relu.set !== 1)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });

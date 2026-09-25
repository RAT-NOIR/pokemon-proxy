// ============================================================
// LES PRIZE PACKS — LA FICHE PAR LE TIRAGE D'ORIGINE QUE PORTE LE SLUG (la route des WCD, §49)
// ============================================================
//   node poser-pps.js            (mesure seule, c'est le défaut)
//   node poser-pps.js --ecrire   (écrit sur `cartes` : cartes_produits + cartes.liens — par lot-additif.js)
//
// 🔑 LA ROUTE : un Prize Pack (Play! Pokémon Prize Pack Series One…Nine) RÉIMPRIME des cartes d'autres sets avec un tampon,
// et Cardmarket écrit le tirage d'ORIGINE dans le slug : `Houndoom-PPS1BST-096` = Brilliant Stars n°096. C'est la forme des WCD
// (`WCD09SW-115`), et la clé est celle de poser-wcd.js, calibrée sur 1 540 WCD sans un faux : (code d'origine, numéro) →
// produit(s) d'origine dans `numeros_cartes` → la carte que CE produit désigne déjà dans `cartes_produits`. Zéro requête.
// 🔑 MESURÉ LE 2026-09-25 AVANT D'ÉCRIRE (règle du testeur : « 20 tirés au sort regardés, écris seulement si c'est 20 sur 20 ») :
// 1 293 produits appris, 1 132 désignent UNE carte après le témoin du nom, 0 ambigu ; 20 tirés au sort (graine 20260925), nom,
// attaques et numéro d'origine lus un par un : 20 justes. Le témoin a refusé 12 produits, et il avait raison — Cardmarket écrit
// « PLF » pour Phantasmal Flames (`Dawn-PPS9PLF-087` → Rattata, le PLF de Plasma Freeze) et « SHF » pour Shrouded Fable
// (`Colresss-Tenacity-PPS7SHF-057` → Ball Guy). « 0 ambigu » ne veut pas dire « 0 faux » : seul le nom le voit.
// ⚠️ CE QUI N'EST PAS ÉCRIT, comme pour les WCD : aucune image (le visuel porte le tampon Prize Pack, ce n'est pas celui du tirage
// d'origine, §19) ; aucune impression inventée sur la carte. Le site ne sert pas encore ces lignes : son numéro se lit après le
// code du SET, et un Prize Pack porte le code d'ORIGINE — la demande est écrite (DEMANDE-REIMPRESSIONS.md, dossier du site).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { cleNumero, normaliserNom } = require('./collecte-cartes/jointure');

const MOTIF = /PPS(\d)([A-Za-z0-9]*?)-([0-9A-Za-z]+)$/;
const PREUVE = 'pps+origine+numero';
const EXPANSIONS = [5204, 5313, 5431, 5620, 5849, 6041, 6214, 6425, 6616];   // Play! Pokémon Prize Pack Series One … Nine
// La mesure : 1 132 à 00 h 30 ; 1 228 à 03 h 40 — l'outil s'est ARRÊTÉ sur l'écart, et il s'explique exactement : les 96
// « origine sans carte » étaient des Énergies de base d'origine SVE (64) et MEE (32), dont les sets ont été collectés entre les deux
// mesures (lot prioritaire). 20 tirés au sort PARMI ces 96, regardés : Metal = MEE 008 / SVE 016, Water = SVE 011, justes.
const ATTENDU = 1228;   // si l'outil ne la retrouve pas, la base ou la clé a bougé — on ARRÊTE
const pad = (v, n) => String(v).padStart(n);

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    // L'expansion d'un produit est celle du CATALOGUE (numeros_cartes.idExpansion peut manquer, jointure.js).
    const cat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { idProduct: 1, idExpansion: 1, idMetacard: 1 } })).map(p => [p.idProduct, p]));
    const pps = await lireMongo(prod.db.collection('numeros_cartes'), { slugSet: /^Play-Pokemon-Prize-Pack/ }, { nom: 'numeros_cartes (Prize Packs)', projection: { idProduct: 1, slug: 1, slugSet: 1 } });
    champSur(pps, 'slug', { collection: 'numeros_cartes (Prize Packs)' });
    console.log(`\n════ DÉNOMINATEUR : ${pps.length} produits Prize Pack appris · catalogue ${[...cat.values()].filter(p => EXPANSIONS.includes(p.idExpansion)).length} ════`);
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set' });
    const expsDuCode = new Map(); for (const c of codes) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
    const tous = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1 } });
    const parExpNum = new Map();
    for (const p of tous) { const n = cleNumero(p.numero); const e = cat.get(p.idProduct)?.idExpansion; if (!n || e == null) continue; const k = `${e}|${n}`; (parExpNum.get(k) || parExpNum.set(k, []).get(k)).push(p.idProduct); }
    const cartesDe = new Map();
    for (const l of await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } })) (cartesDe.get(l.idProduct) || cartesDe.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);
    const causes = { resolu: [], nonDecode: [], codeInconnu: [], numeroAbsent: [], origineSansCarte: [], ambigu: [], deja: [] };
    for (const p of pps) {
        if (cartesDe.has(p.idProduct)) { causes.deja.push(p); continue; }
        const m = MOTIF.exec(String(p.slug || ''));
        if (!m) { causes.nonDecode.push(p); continue; }
        const [, , code, num] = m;
        const exps = expsDuCode.get(code);
        if (!exps) { causes.codeInconnu.push({ ...p, code }); continue; }
        const n = cleNumero(num);
        const cands = [...exps].flatMap(e => parExpNum.get(`${e}|${n}`) || []);
        if (!cands.length) { causes.numeroAbsent.push({ ...p, code, num }); continue; }
        const cartes = new Set(cands.flatMap(id => [...(cartesDe.get(id) || [])]));
        if (!cartes.size) { causes.origineSansCarte.push({ ...p, code, num }); continue; }
        if (cartes.size > 1) { causes.ambigu.push({ ...p, code, num, cartes: [...cartes] }); continue; }
        causes.resolu.push({ ...p, code, num, cands, carteId: [...cartes][0], idExpansion: cat.get(p.idProduct)?.idExpansion, idMetacard: cat.get(p.idProduct)?.idMetacard });
    }
    const noms = new Map((await lireMongo(cx.db.collection('cartes'), { _id: { $in: causes.resolu.map(x => x.carteId) } }, { nom: 'cartes (désignées)', projection: { nomEn: 1 } })).map(c => [c._id, c.nomEn]));
    const nu = s => normaliserNom(String(s || '').replace(/δ/g, 'delta').replace(/[éè]/g, 'e'));
    causes.nomDiscordant = [];
    causes.resolu = causes.resolu.filter(x => {
        const a = nu(x.slug.replace(/-PPS\d.*$/, '').replace(/-V\d+$/, '')), b = nu(noms.get(x.carteId));
        if (b && (a === b || a.includes(b) || b.includes(a))) return true;
        causes.nomDiscordant.push({ ...x, nomCarte: noms.get(x.carteId) }); return false;
    });
    for (const [k, v] of Object.entries(causes)) console.log(`   ${pad(v.length, 5)} · ${k}`);
    const somme = Object.values(causes).reduce((s, a) => s + a.length, 0);
    if (somme !== pps.length) throw new Error(`concordance fausse : ${somme} classés pour ${pps.length} produits`);
    if (causes.resolu.length !== ATTENDU) throw new Error(`ARRÊT : ${causes.resolu.length} résolus contre ${ATTENDU} mesurés le 2026-09-25 — la base ou la clé a bougé ; on ne pose rien sans comprendre.`);
    const vus = new Map(); for (const x of causes.resolu) vus.set(x.idProduct, (vus.get(x.idProduct) || 0) + 1);
    if ([...vus.values()].some(k => k > 1)) throw new Error('ARRÊT : un produit présent plusieurs fois dans la liste à écrire');
    if (!ecrire) { console.log(`\n   ✅ ${causes.resolu.length} fiches à poser — (mesure seule, relancer avec --ecrire)`); await fermer(); return; }

    const avant = await cx.db.collection('cartes_produits').countDocuments({ preuve: PREUVE });
    const maintenant = new Date();
    const r = await cx.db.collection('cartes_produits').bulkWrite(causes.resolu.map(x => ({
        updateOne: {
            filter: { _id: `${x.carteId}|${x.idProduct}` },
            update: { $set: { carteId: x.carteId, idProduct: x.idProduct, idExpansion: x.idExpansion, tirage: 'intl', preuve: PREUVE, slug: x.slug, slugSet: x.slugSet,
                origine: { code: x.code, numero: x.num },
                detail: `slug ${x.slug} → tirage d'origine ${x.code} n°${x.num} → produit(s) ${x.cands.join('/')} → une seule carte`, verifieLe: maintenant, route: 'pps' } },
            upsert: true
        }
    })), { ordered: false });
    const parCarte = new Map();
    for (const x of causes.resolu) { const v = parCarte.get(x.carteId) || parCarte.set(x.carteId, { ids: [], metas: new Set() }).get(x.carteId); v.ids.push(x.idProduct); if (x.idMetacard != null) v.metas.add(x.idMetacard); }
    const rc = await cx.db.collection('cartes').bulkWrite([...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] } } } } })), { ordered: false });
    const apres = await cx.db.collection('cartes_produits').countDocuments({ preuve: PREUVE });
    const multi = await cx.db.collection('cartes_produits').aggregate([{ $match: { preuve: PREUVE } }, { $group: { _id: '$idProduct', c: { $addToSet: '$carteId' } } }, { $match: { 'c.1': { $exists: true } } }, { $count: 'n' }]).toArray();
    console.log(`\n   ✅ cartes_produits : ${r.upsertedCount} insérées · ${r.modifiedCount} modifiées · lignes « ${PREUVE} » ${avant} → ${apres} (attendu ${causes.resolu.length})`);
    console.log(`   ✅ cartes : ${rc.matchedCount} touchées (liens.idProduct) · produits Prize Pack à plusieurs cartes : ${multi[0]?.n || 0}`);
    if (apres !== causes.resolu.length) console.log(`   🔴 LE COMPTE RÉEL (${apres}) NE COLLE PAS AUX ${causes.resolu.length} POSÉES — à ouvrir avant toute autre écriture.`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

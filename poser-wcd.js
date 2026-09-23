// ============================================================
// LES WCD — POSER LA FICHE PAR LE TIRAGE D'ORIGINE QUE PORTE LE SLUG (CLAUDE.md §40, §49)
// ============================================================
//   node poser-wcd.js            (mesure seule, c'est le défaut)
//   node poser-wcd.js --ecrire   (écrit sur `cartes` : cartes_produits + cartes.liens)
//
// 🔑 LA ROUTE : un deck de championnat (WCD) réimprime des cartes d'autres sets, et Cardmarket écrit
// le tirage d'ORIGINE dans le slug du produit — `Trapinch-Lv9-WCD09SW-115` = Stormfront n°115. On
// décode (code d'origine, numéro), on retrouve le produit d'origine dans `numeros_cartes`, et la
// carte que CE produit désigne déjà dans `cartes_produits`. Zéro requête : tout est en base (§49).
//
// ⚠️ LA SONDE D'HIER AVAIT DEUX RACCOURCIS, ET CET OUTIL LES RETIRE AVANT D'ÉCRIRE :
//   1. un code d'origine → UNE expansion (`Map.set` écrasait la précédente). Ici un code qui désigne
//      plusieurs expansions les garde TOUTES, et la clé doit rester unique sur leur union ;
//   2. un produit → sa PREMIÈRE carte (`if (!carteDe.has(...))`). Ici un produit rattaché à plusieurs
//      cartes (le contrôle transversal du §32 en compte encore) propage TOUTES ses cartes, et
//      l'unicité se juge sur ce tout.
// Et le numéro passe par `cleNumero`, la clé de la PRODUCTION (§21 bis n°4), pas par un `replace` à
// la main : « 1N » et « 1S » sont deux numéros (§34).
//
// ⚠️ CE QUI N'EST PAS ÉCRIT, ET POURQUOI :
//   · `cartes.sets` — ce champ dit « les sets de la TABLE qui ont amené cette page », et le site
//     construit une page de set depuis lui. Un WCD n'a ni ligne de table ni document `sets` : l'y
//     mettre créerait des appartenances sans page, et ferait croire à `remettre-en-file.js` qu'un
//     set sans source d'images attend des visuels.
//   · aucune image : le visuel d'un WCD n'est PAS celui du tirage d'origine (bordure, signature au
//     dos) — une image appartient à un TIRAGE (§19). Une fiche sans visuel est vraie ; un visuel
//     emprunté serait faux.
//   · le site lit `cartes_produits` filtré par `idExpansion` du set affiché : une ligne WCD porte
//     l'expansion WCD, elle n'apparaît donc sur AUCUNE page existante (vérifié, lib/cartes.ts:990).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { champSur, lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero, normaliserNom } = require('./collecte-cartes/jointure');

const MOTIF = /WCD(\d{2})([A-Za-z0-9]*)-([0-9A-Za-z]+)$/;
const PREUVE = 'wcd+origine+numero';
// Le compte mesuré le 2026-09-21 par la sonde (§49). Si l'outil ne le retrouve pas, c'est lui ou la
// base qui a bougé : on ARRÊTE et on l'écrit, on ne contourne pas.
const ATTENDU_SONDE = 1684;
const pad = (v, n) => String(v).padStart(n);

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });

    const wcd = await lireMongo(prod.db.collection('numeros_cartes'), { slugSet: /^WCD/ },
        { nom: 'numeros_cartes (WCD)', projection: { idProduct: 1, idExpansion: 1, idMetacard: 1, slugSet: 1, slug: 1 } });
    champSur(wcd, 'slug', { collection: 'numeros_cartes (WCD)' });
    console.log(`\n════ DÉNOMINATEUR : ${wcd.length} produits WCD · ${new Set(wcd.map(p => p.slugSet)).size} expansions ════`);

    // code d'origine -> TOUTES ses expansions (raccourci 1 retiré)
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set' });
    champSur(codes, 'codeSet', { collection: 'codes_set' });
    const expsDuCode = new Map();
    for (const c of codes) {
        const k = String(c.codeSet);
        if (!expsDuCode.has(k)) expsDuCode.set(k, new Set());
        expsDuCode.get(k).add(c.idExpansion);
    }
    const codesMulti = [...expsDuCode].filter(([, s]) => s.size > 1);
    console.log(`   codes_set : ${expsDuCode.size} codes · ${codesMulti.length} désignent PLUSIEURS expansions (gardées toutes)`);

    // (expansion, cleNumero) -> produits
    const tous = await lireMongo(prod.db.collection('numeros_cartes'), {},
        { nom: 'numeros_cartes', projection: { idProduct: 1, idExpansion: 1, numero: 1 } });
    const parExpNum = new Map();
    for (const p of tous) {
        const n = cleNumero(p.numero);
        if (!n) continue;
        const k = `${p.idExpansion}|${n}`;
        if (!parExpNum.has(k)) parExpNum.set(k, []);
        parExpNum.get(k).push(p.idProduct);
    }

    // produit -> TOUTES ses cartes (raccourci 2 retiré)
    const liens = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } });
    const cartesDe = new Map();
    for (const l of liens) {
        if (!cartesDe.has(l.idProduct)) cartesDe.set(l.idProduct, new Set());
        cartesDe.get(l.idProduct).add(l.carteId);
    }
    const dejaJoints = wcd.filter(p => cartesDe.has(p.idProduct));
    console.log(`   produits WCD DÉJÀ rattachés à une carte : ${dejaJoints.length}${dejaJoints.length ? ' — ils ne sont pas retouchés' : ''}`);

    const causes = { resolu: [], nonDecode: [], codeInconnu: [], numeroAbsent: [], origineSansCarte: [], ambigu: [], deja: [] };
    for (const p of wcd) {
        if (cartesDe.has(p.idProduct)) { causes.deja.push(p); continue; }
        const m = MOTIF.exec(String(p.slug || ''));
        if (!m) { causes.nonDecode.push(p); continue; }
        const [, annee, code, num] = m;
        const exps = expsDuCode.get(code);
        if (!exps) { causes.codeInconnu.push({ ...p, code }); continue; }
        const n = cleNumero(num);
        const cands = [...exps].flatMap(e => parExpNum.get(`${e}|${n}`) || []);
        if (!cands.length) { causes.numeroAbsent.push({ ...p, code, num }); continue; }
        const cartes = new Set(cands.flatMap(id => [...(cartesDe.get(id) || [])]));
        if (!cartes.size) { causes.origineSansCarte.push({ ...p, code, num, cands }); continue; }
        if (cartes.size > 1) { causes.ambigu.push({ ...p, code, num, cands, cartes: [...cartes] }); continue; }
        causes.resolu.push({ ...p, annee, code, num, cands, carteId: [...cartes][0] });
    }

    console.log(`\n════ CE QUE LA CLÉ (code d'origine, numéro) REND ════`);
    console.log(`   ✅ ${pad(causes.resolu.length, 5)} désignent UNE carte`);
    console.log(`   ⚠️ ${pad(causes.ambigu.length, 5)} désignent PLUSIEURS cartes — non écrits`);
    for (const x of causes.ambigu.slice(0, 8)) console.log(`        ${x.slug} → ${x.cands.length} produits → cartes ${x.cartes.join(', ')}`);
    console.log(`   🕳️ ${pad(causes.origineSansCarte.length, 5)} produit d'origine trouvé, mais sans carte (trou de texte amont)`);
    console.log(`   🕳️ ${pad(causes.numeroAbsent.length, 5)} numéro absent du set d'origine`);
    console.log(`   🔴 ${pad(causes.codeInconnu.length, 5)} code d'origine absent de codes_set : ${[...new Set(causes.codeInconnu.map(x => x.code))].join(', ')}`);
    console.log(`   ⚪ ${pad(causes.nonDecode.length, 5)} slugs que le motif ne décode pas (WCD25###, énergies sans numéro, noms de joueur)`);
    console.log(`   ⚪ ${pad(causes.deja.length, 5)} déjà rattachés`);
    const somme = Object.values(causes).reduce((s, a) => s + a.length, 0);
    if (somme !== wcd.length) throw new Error(`concordance fausse : ${somme} classés pour ${wcd.length} produits`);

    // 🔴 LE CHIFFRE DOIT COLLER À LA MESURE D'HIER, OU ON S'ARRÊTE (règle du testeur).
    // La sonde avait deux raccourcis ; les retirer ne peut que DÉPLACER des produits de « résolu »
    // vers « ambigu ». Un écart dans l'autre sens voudrait dire que la base a changé.
    const ecart = causes.resolu.length - ATTENDU_SONDE;
    console.log(`\n   comparaison à la sonde du 2026-09-21 : ${causes.resolu.length} contre ${ATTENDU_SONDE} (écart ${ecart >= 0 ? '+' : ''}${ecart})`);
    if (ecart > 0) throw new Error(`ARRÊT : ${ecart} résolu(s) de PLUS que la sonde — la base a changé ou la clé est plus large qu'hier. On ne pose rien sans comprendre.`);
    if (ecart < 0 && causes.ambigu.length !== -ecart) throw new Error(`ARRÊT : ${-ecart} résolu(s) de moins que la sonde, mais ${causes.ambigu.length} ambigu(s) seulement — l'écart n'est pas expliqué par les raccourcis retirés.`);

    // ── 🔴 LA SECONDE GARDE, ET ELLE A ÉTÉ AJOUTÉE PARCE QUE LA PREMIÈRE N'ÉTAIT PAS INFAILLIBLE ──
    // Le 2026-09-23, avant d'écrire, le NOM en tête du slug a été confronté au `nomEn` de la carte
    // désignée. Le nom n'entre pas dans la clé : c'est ce qui en fait un TÉMOIN (§16). Sur 1 684,
    // 5 désaccords, et 4 étaient de VRAIES erreurs — le slug Cardmarket porte parfois un mauvais
    // numéro : `Choice-Belt-V2-WCD22BRS-125` → Cinccino, `Palkia-LVX-WCD09DPPR-28` → Mewtwo LV.X,
    // `Quick-Ball-V2-WCD22FST-236` → Power Tablet, `Ancient-Technical-Machine-WCD06HL-095` → Metagross ex.
    // 🔑 « 0 ambigu » ne voulait pas dire « 0 faux » : une clé qui désigne UNE carte peut désigner la
    // MAUVAISE, et seule une donnée qu'elle n'a pas utilisée peut le dire. Règle du testeur : zéro faux
    // affirmé — donc un désaccord de nom REFUSE, même quand c'est la forme qui diffère (`Blend-Energy-
    // WLFM` contre « Blend Energy WaterLightningFightingMetal », juste, sacrifiée et listée).
    // ⚠️ L'inclusion n'est ici qu'un CONTRÔLE, jamais la clé (§31) : elle accepte les suffixes de forme
    // — « Boss's Orders (Ghetsis) », « Mew ☆ δ », « ATM [Rock] » — les 35 cas ont été lus un par un.
    const cartesNom = new Map((await lireMongo(cx.db.collection('cartes'), { _id: { $in: causes.resolu.map(x => x.carteId) } },
        { nom: 'cartes (désignées)', projection: { nomEn: 1 } })).map(c => [c._id, c.nomEn]));
    const nu = s => normaliserNom(String(s || '').replace(/δ/g, 'delta').replace(/[éè]/g, 'e')).replace(/lv\d+$/, '');
    causes.nomDiscordant = [];
    causes.resolu = causes.resolu.filter(x => {
        const a = nu(x.slug.replace(/-WCD.*$/, '').replace(/-V\d+$/, '')), b = nu(cartesNom.get(x.carteId));
        if (b && (a === b || a.includes(b) || b.includes(a))) return true;
        causes.nomDiscordant.push({ ...x, nomCarte: cartesNom.get(x.carteId) });
        return false;
    });
    console.log(`\n   🔴 ${pad(causes.nomDiscordant.length, 5)} REFUSÉS par le témoin du nom (le slug ne nomme pas la carte que son numéro désigne) :`);
    for (const x of causes.nomDiscordant) console.log(`        ${x.slug} → carte ${x.carteId} « ${x.nomCarte} »`);
    console.log(`   ✅ ${pad(causes.resolu.length, 5)} fiches à poser`);

    // une carte, UNE ligne par produit WCD : la clé _id le garantit ; on contrôle quand même qu'aucun
    // produit n'apparaît deux fois dans ce qu'on va écrire (§34 : on compte, on ne met pas en Set).
    const vus = new Map();
    for (const x of causes.resolu) vus.set(x.idProduct, (vus.get(x.idProduct) || 0) + 1);
    const doubles = [...vus].filter(([, k]) => k > 1);
    if (doubles.length) throw new Error(`ARRÊT : ${doubles.length} produit(s) WCD présents plusieurs fois dans la liste à écrire`);

    const parExp = new Map();
    for (const x of causes.resolu) parExp.set(x.slugSet, (parExp.get(x.slugSet) || 0) + 1);
    console.log(`   par expansion : ${[...parExp].sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    for (const x of causes.resolu.slice(0, 5)) console.log(`   ex. ${x.slug} → ${x.code} n°${x.num} → produit(s) ${x.cands.join('/')} → carte ${x.carteId}`);

    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --ecrire)`); await fermer(); return; }

    const avant = await cx.db.collection('cartes_produits').countDocuments({ preuve: PREUVE });
    const maintenant = new Date();
    const ops = causes.resolu.map(x => ({
        updateOne: {
            filter: { _id: `${x.carteId}|${x.idProduct}` },
            update: { $set: {
                carteId: x.carteId, idProduct: x.idProduct, idExpansion: x.idExpansion, tirage: 'intl',
                preuve: PREUVE, slug: x.slug, slugSet: x.slugSet,
                detail: `slug ${x.slug} → tirage d'origine ${x.code} n°${x.num} → produit(s) ${x.cands.join('/')} → une seule carte`,
                verifieLe: maintenant, route: 'wcd'
            } },
            upsert: true
        }
    }));
    const r = await cx.db.collection('cartes_produits').bulkWrite(ops, { ordered: false });
    // liens dénormalisés : même geste que ecrire-jointure.js. `$addToSet` AJOUTE en fin de tableau,
    // donc `liens.idProduct[0]` (qui entre dans le slug d'une carte sans numéro, côté site) ne bouge pas.
    const parCarte = new Map();
    for (const x of causes.resolu) {
        if (!parCarte.has(x.carteId)) parCarte.set(x.carteId, { ids: [], metas: new Set() });
        parCarte.get(x.carteId).ids.push(x.idProduct);
        if (x.idMetacard != null) parCarte.get(x.carteId).metas.add(x.idMetacard);
    }
    const opsCartes = [...parCarte].map(([id, v]) => ({
        updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] } } } }
    }));
    const rc = await cx.db.collection('cartes').bulkWrite(opsCartes, { ordered: false });

    // ── VÉRIFICATION : le compte RÉEL, relu en base, pas l'attendu
    const apres = await cx.db.collection('cartes_produits').countDocuments({ preuve: PREUVE });
    const multi = await cx.db.collection('cartes_produits').aggregate([
        { $match: { preuve: PREUVE } },
        { $group: { _id: '$idProduct', cartes: { $addToSet: '$carteId' } } },
        { $match: { 'cartes.1': { $exists: true } } }, { $count: 'n' }
    ]).toArray();
    console.log(`\n   ✅ cartes_produits : ${r.upsertedCount} insérées · ${r.modifiedCount} modifiées · lignes « ${PREUVE} » ${avant} → ${apres} (attendu ${avant} → ${causes.resolu.length})`);
    console.log(`   ✅ cartes : ${rc.matchedCount} cartes touchées, ${rc.modifiedCount} modifiées (liens.idProduct)`);
    console.log(`   ⚖️ produits WCD rattachés à plusieurs cartes : ${multi[0]?.n || 0}`);
    if (apres !== causes.resolu.length) console.log(`   🔴 LE COMPTE RÉEL (${apres}) NE COLLE PAS AUX ${causes.resolu.length} POSÉES — à ouvrir avant toute autre écriture.`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

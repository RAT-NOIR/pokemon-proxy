// ============================================================
// LA LANGUE DES VISUELS DÉJÀ COLLECTÉS — `langue` + `languePreuve` sur `images` et sur `cartes.images[]` (2026-09-23)
// ============================================================
//   node poser-langue-images.js            (mesure, c'est le défaut)
//   node poser-langue-images.js --ecrire   (écrit sur `cartes` : images + cartes.images, SAUVEGARDE RÉELLE AVANT)
//
// La règle vit dans `collecte-cartes/langue-visuel.js`, la MÊME que les deux collecteurs appellent au téléchargement et
// à la jointure — jamais une copie (§21 bis). Ce script ne fait que la rejouer sur ce qui existait avant elle.
// IDEMPOTENT : à relancer tant que le worker tourne sur un commit antérieur (ses entrées neuves n'ont pas le champ).
// ⚠️ L'écriture se fait ENTRÉE PAR ENTRÉE (`arrayFilters` sur `cleR2`), jamais en réécrivant `cartes.images` en bloc :
// le worker pousse des entrées pendant ce temps, et un `$set` du tableau entier effacerait les siennes.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { langueDuVisuel, FORMATS_JAPONAIS } = require('./collecte-cartes/langue-visuel');

// LUS À L'ŒIL le 2026-09-23 sur nos copies R2 — scans JAPONAIS dans des formats que la règle ne tranche pas. Tirés au
// hasard (graine fixe) dans les 34 sets qui portent des formats japonais : 9 sur 36 ; plus Marnie et Collapsed Stadium,
// trouvés en validant les formats. Un verdict lu ne se généralise pas : il vaut pour CE fichier, et tombe si le fichier
// est remplacé (le collecteur le recalcule alors au téléchargement).
const LUS_JAPONAIS = [
    ['SWSH-Black-Star-Promos', 'MarnieSWSHPromo120.jpg'], ['Lost-Origin', 'CollapsedStadiumLostOrigin215.jpg'],
    ['Guardians-Rising', 'SalazzleGuardiansRising16.jpg'], ['Ultra-Prism', 'GarchompUltraPrism99.jpg'],
    ['Fusion-Strike', 'DancerFusionStrike274.jpg'], ['Forbidden-Light', 'XerneasGXForbiddenLight139.jpg'],
    ['SWSH-Black-Star-Promos', 'MorpekoV-UNIONSWSHPromo287.jpg'], ['SM-Black-Star-Promos', 'XurkitreeGXSMPromo68.jpg'],
    ['Forbidden-Light', 'VolcanionForbiddenLight31.jpg'], ['SM-Black-Star-Promos', 'UmbreonGXSMPromo36.jpg'],
    ['Crimson-Invasion', 'SeaofNothingnessCrimsonInvasion99.jpg']
];
const PREUVE_OEIL = 'lu japonais à l\'œil le 2026-09-23 sur la copie R2 (le format ne tranchait pas)';
// ➕ 2026-10-04 : les 46 visuels que l'agent du site a regardés le 2026-09-28 (planches) — japonais sous un nom de fichier anglais —,
// marqués `ja` sur feu vert du testeur. Par CLÉ R2 (c'est ainsi que la liste les désigne) ; même règle de durée : un verdict lu vaut
// pour CE fichier, et tombe si le fichier est remplacé.
const LUS_SITE = require('./collecte-cartes/visuels-japonais-lus.json');
const lusSite = new Map(LUS_SITE.images.map(i => [i.cleR2, LUS_SITE.preuve]));

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    // 🔴 2026-10-04 : la projection ne portait ni `langueSource` ni `languePreuve`. Sans `langueSource`, la règle (langue-visuel.js)
    // rendait « en » pour les 108 visuels indonésiens de TCGdex (et en rendrait autant pour le thaï) : relancé, l'outil les aurait
    // RÉÉCRITS en anglais. La règle lit le document : la projection doit porter tout ce qu'elle lit.
    const docs = await lireMongo(cx.db.collection('images'), { etat: 'ok' }, { nom: 'images (ok)', projection: { source: 1, set: 1, fichier: 1, cleR2: 1, wOriginal: 1, hOriginal: 1, langue: 1, languePreuve: 1, langueSource: 1, urlOriginal: 1 } });
    champSur(docs, 'cleR2', { collection: 'images (ok)' });
    const oeil = new Map(LUS_JAPONAIS.map(([s, f]) => [`${s}|${f}`, true]));
    const verdict = new Map();    // cleR2 -> { langue, preuve }
    const C = { parSource: {}, oeil: 0, site: 0 };
    const docsAEcrire = [];
    // 🔴 et `langueSource` n'est pas STOCKÉ sur le document : le collecteur TCGdex le passe à la règle au téléchargement, puis ne
    // l'écrit pas. Il vit dans `urlOriginal` (assets.tcgdex.net/<langue>/…), là où la règle dit que la source le déclare. Relu ici
    // depuis le chemin — sans toucher la règle, que la garde du commit du worker surveille.
    const langueDuChemin = d => d.source === 'tcgdex' && d.langueSource == null ? (/^https:\/\/assets\.tcgdex\.net\/([a-z-]+)\//.exec(d.urlOriginal ?? '')?.[1] ?? null) : d.langueSource;
    for (const d of docs) {
        let v = langueDuVisuel({ ...d, langueSource: langueDuChemin(d) });
        if (d.source === 'bulbapedia' && oeil.has(`${d.set}|${d.fichier}`)) { v = { langue: 'ja', preuve: PREUVE_OEIL }; C.oeil++; }
        else if (lusSite.has(d.cleR2)) { v = { langue: 'ja', preuve: lusSite.get(d.cleR2) }; C.site++; }
        verdict.set(d.cleR2, v);
        if (d.langue !== v.langue || d.languePreuve !== v.preuve) docsAEcrire.push(d);
        const k = `${d.source} → ${v.langue ?? 'null'}`; C.parSource[k] = (C.parSource[k] || 0) + 1;
    }
    console.log(`\n════ DOCUMENTS images (etat ok) : ${docs.length} ════`);
    for (const [k, n] of Object.entries(C.parSource).sort()) console.log(`   ${k.padEnd(22)} ${n}`);
    console.log(`   dont lus à l'œil : ${C.oeil} / ${LUS_JAPONAIS.length} ${C.oeil === LUS_JAPONAIS.length ? '✅' : '🔴 un fichier lu n\'est plus en base — à ouvrir'}`);
    console.log(`   dont lus par le site (2026-09-28) : ${C.site} / ${lusSite.size} ${C.site === lusSite.size ? '✅' : '🔴 un fichier lu n\'est plus en base (etat ok) — à ouvrir'}`);
    const changes = {}; for (const d of docsAEcrire) { const k = `${d.langue === undefined ? '(absent)' : d.langue ?? 'null'} → ${verdict.get(d.cleR2).langue ?? 'null'}`; changes[k] = (changes[k] || 0) + 1; }
    console.log(`   documents dont le verdict change : ${docsAEcrire.length} ${JSON.stringify(changes)}`);
    console.log(`   formats du scanner japonais : ${[...FORMATS_JAPONAIS.keys()].join(', ')}`);

    // Les entrées de cartes.images, et la région du set qui les affiche
    const regionDe = new Map((await lireMongo(cx.db.collection('sets'), {}, { nom: 'sets', projection: { region: 1 } })).map(s => [s._id, s.region]));
    const cartes = await lireMongo(cx.db.collection('cartes'), { 'images.0': { $exists: true } }, { nom: 'cartes avec images', projection: { images: 1 } });
    const E = { entrees: 0, sansDocument: [], jaSurIntl: 0, jaSurJp: 0, nullSurIntl: 0, autre: 0, dejaJustes: 0 };
    const ops = [];
    for (const c of cartes) for (const e of c.images || []) {
        E.entrees++;
        const v = verdict.get(e.cleR2);
        if (!v) { E.sansDocument.push(`${c._id} ${e.cleR2}`); continue; }
        const r = regionDe.get(e.set);
        if (v.langue === 'ja' && r !== 'jp') E.jaSurIntl++; else if (v.langue === 'ja') E.jaSurJp++; else if (r !== 'jp') E.nullSurIntl++; else E.autre++;
        if (e.langue === v.langue && e.languePreuve === v.preuve) { E.dejaJustes++; continue; }
        ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { 'images.$[e].langue': v.langue, 'images.$[e].languePreuve': v.preuve } }, arrayFilters: [{ 'e.cleR2': e.cleR2 }] } });
    }
    console.log(`\n════ ENTRÉES cartes.images : ${E.entrees} sur ${cartes.length} cartes ════`);
    console.log(`   ja sous un set NON jp (le scan du jumeau) : ${E.jaSurIntl}`);
    console.log(`   ja sous un set jp                         : ${E.jaSurJp}`);
    console.log(`   null sous un set non jp (ne tranche pas)  : ${E.nullSurIntl}`);
    console.log(`   null sous un set jp                       : ${E.autre} ${E.autre ? '🔴 un visuel de set jp dont la langue ne se tranche pas — à ouvrir' : '✅'}`);
    console.log(`   sans document images (clé R2 orpheline)   : ${E.sansDocument.length} ${E.sansDocument.length ? `🔴 ${E.sansDocument.slice(0, 3).join(' · ')}` : '✅'}`);
    console.log(`   déjà justes : ${E.dejaJustes} · à écrire : ${ops.length}`);

    if (!ecrire) { console.log('\n   (mesure seule — --ecrire après la sauvegarde réelle de cartes et images)'); await fermer(); return; }
    // seuls les documents dont le verdict CHANGE (2026-10-04 : on ne réécrit plus 40 000 documents pour en changer 46)
    const d1 = docsAEcrire.length ? await cx.db.collection('images').bulkWrite(docsAEcrire.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: { langue: verdict.get(d.cleR2).langue, languePreuve: verdict.get(d.cleR2).preuve } } } })), { ordered: false }) : { modifiedCount: 0 };
    const d2 = ops.length ? await cx.db.collection('cartes').bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
    // Relu en base, pas déduit de ce qu'on a envoyé
    const relu = await cx.db.collection('cartes').aggregate([{ $unwind: '$images' }, { $group: { _id: { $cond: [{ $eq: [{ $type: '$images.langue' }, 'missing'] }, '(absent)', { $ifNull: ['$images.langue', 'null'] }] }, n: { $sum: 1 } } }]).toArray();
    console.log(`\n   ✅ images : ${d1.modifiedCount} modifiés sur ${docsAEcrire.length} à écrire (${docs.length} documents) · cartes.images : ${d2.modifiedCount} cartes modifiées pour ${ops.length} entrées`);
    console.log(`   RELU en base, entrées de cartes.images par langue : ${relu.map(x => `${x._id} ${x.n}`).join(' · ')}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

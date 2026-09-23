// ============================================================
// LE TÉMOIN DU NOM SUR LES JOINTURES PAR LE NUMÉRO — « une fiche fausse est un mauvais prix »
// ============================================================
//   node temoin-nom.js            (mesure seule, c'est le défaut)
//   node temoin-nom.js --detacher (retire les lignes CONTREDITES ; sauvegarde de cartes_produits d'abord)
//
// 🔑 LE MÊME TÉMOIN QUE POUR LES WCD (§49) : le nom n'entre pas dans la clé par le numéro, c'est ce qui en fait un
// témoin. Rejoué le 2026-09-23 comme calibration du nom seul, il a retourné la question : sur 54 790 jointures
// par le numéro, 325 (0,59 %) ne portent pas le nom de leur carte — et SV-P chinois simplifié y est à 41 sur 41.
//
// DEUX NIVEAUX, ET SEUL LE PREMIER AGIT :
//   · CONTREDITE — le nom du produit (décomposé comme la production le fait) n'est pas celui de la carte, ET il
//     désigne UNE AUTRE carte du même set, UNE SEULE, qui porte exactement ce nom. Deux données indépendantes
//     désignent deux cartes différentes : la fiche ne peut pas être juste telle quelle.
//   · ÉCART DE FORME — le nom diffère sans désigner une autre carte (« Pokémon Reverse » / « Pokémon Reversal »,
//     « Mystery Plate Alpha » / « α », « Blaziken LV.X » / « Blaziken FB LV.X »). LISTÉ, jamais touché : une
//     traduction différente n'est pas une fiche fausse, et agir dessus détacherait du juste (§21 bis n°4).
// ⚠️ Détacher ne répare pas la CAUSE : une recollecte du set refera la même jointure. La ligne de table en cause
// doit être revue avec — c'est dit par set dans la sortie.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { decomposerNomCardmarket, normaliserNom } = require('./collecte-cartes/jointure');

(async () => {
    const detacher = process.argv.includes('--detacher');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const liens = await lireMongo(cx.db.collection('cartes_produits'), { preuve: { $in: ['set+numero', 'setlist+numero'] } },
        { nom: 'cartes_produits (par le numéro)', projection: { idProduct: 1, carteId: 1, slugSet: 1, preuve: 1 } });
    const cp = await lireMongo(prod.db.collection('catalogue_produits'), { idProduct: { $in: liens.map(l => l.idProduct) } }, { nom: 'catalogue_produits', projection: { idProduct: 1, name: 1 } });
    champSur(cp, 'name', { collection: 'catalogue_produits' });
    const nomP = new Map(cp.map(p => [p.idProduct, decomposerNomCardmarket(p.name).nom]));
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, sets: 1 } });
    const nomC = new Map(cartes.map(c => [c._id, c.nomEn]));
    const nu = s => normaliserNom(String(s || '').replace(/^Basic\s+/i, ''));
    // cartes du set par nom, multiplicités COMPTÉES (§34)
    const parSetNom = new Map();
    for (const c of cartes) for (const s of c.sets || []) { const k = `${s}|${nu(c.nomEn)}`; (parSetNom.get(k) || parSetNom.set(k, []).get(k)).push(c._id); }

    const contredites = [], forme = new Map();
    for (const l of liens) {
        const a = nu(nomP.get(l.idProduct)), b = nu(nomC.get(l.carteId));
        if (!a || !b || a === b || a.includes(b) || b.includes(a)) continue;
        const autres = (parSetNom.get(`${l.slugSet}|${a}`) || []).filter(id => id !== l.carteId);
        if (autres.length === 1) contredites.push({ ...l, produit: nomP.get(l.idProduct), carte: nomC.get(l.carteId), designee: autres[0] });
        else (forme.get(l.slugSet) || forme.set(l.slugSet, []).get(l.slugSet)).push(`${nomP.get(l.idProduct)} → ${nomC.get(l.carteId)}`);
    }
    const parSet = new Map();
    for (const x of contredites) (parSet.get(x.slugSet) || parSet.set(x.slugSet, []).get(x.slugSet)).push(x);
    const nSet = new Map(); for (const l of liens) nSet.set(l.slugSet, (nSet.get(l.slugSet) || 0) + 1);
    console.log(`\n════ DÉNOMINATEUR : ${liens.length} jointures par le numéro ════`);
    console.log(`   🔴 CONTREDITES (le nom désigne UNE autre carte du set) : ${contredites.length} dans ${parSet.size} sets`);
    for (const [s, xs] of [...parSet].sort((a, b) => b[1].length - a[1].length))
        console.log(`      ${String(xs.length).padStart(3)} / ${String(nSet.get(s)).padStart(4)} · ${s.padEnd(42)} ${xs.slice(0, 3).map(x => `« ${x.produit} » → ${x.carte} (le nom dit ${x.designee})`).join(' · ')}`);
    const nForme = [...forme.values()].reduce((n, a) => n + a.length, 0);
    console.log(`   ⚪ écarts de FORME (listés, non touchés) : ${nForme} dans ${forme.size} sets — ex. ${[...forme].slice(0, 4).map(([s, a]) => `${s}: ${a[0]}`).join(' · ')}`);

    if (!detacher) { console.log(`\n   (mesure seule — --detacher retire les ${contredites.length} lignes contredites, après sauvegarde)`); await fermer(); return; }
    // retrait : la ligne, et l'idProduct dans les liens dénormalisés de la carte (même geste que detacher-jointures-fausses.js)
    const r = await cx.db.collection('cartes_produits').deleteMany({ _id: { $in: contredites.map(x => `${x.carteId}|${x.idProduct}`) } });
    const parCarte = new Map();
    for (const x of contredites) (parCarte.get(x.carteId) || parCarte.set(x.carteId, []).get(x.carteId)).push(x.idProduct);
    for (const [id, ps] of parCarte) await cx.db.collection('cartes').updateOne({ _id: id }, { $pull: { 'liens.idProduct': { $in: ps } } });
    for (const x of contredites) await cx.db.collection('restes').updateOne({ set: x.slugSet, type: 'fiche-contredite-par-le-nom', idProduct: x.idProduct },
        { $set: { carteId: x.carteId, detail: `« ${x.produit} » était joint par le numéro à « ${x.carte} » ; le nom désigne la carte ${x.designee} — détaché le 2026-09-23 (temoin-nom.js)`, le: new Date() } }, { upsert: true });
    const reste = await cx.db.collection('cartes_produits').countDocuments({ _id: { $in: contredites.map(x => `${x.carteId}|${x.idProduct}`) } });
    console.log(`\n   ✅ détachées : ${r.deletedCount} (attendu ${contredites.length}) · encore présentes : ${reste} · ${parCarte.size} cartes · restes écrits avec leur motif`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

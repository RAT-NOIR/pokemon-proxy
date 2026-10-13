// ============================================================
// LES COÛTS D'ATTAQUE NUMÉRIQUES — `cost=2` n'est pas « aucun coût » : `cout` retiré, `coutNombre` posé, attaque par attaque
// ============================================================
//   node corriger-couts-attaques.js --attendu=<n>                    (simulation, le défaut)
//   node lot-additif.js --quoi="…" --collections=cartes -- node corriger-couts-attaques.js --attendu=<n> --ecrire
//
// POURQUOI (DEMANDE-SERVEUR-DATES.md point 3b, enquête DATES-enquete.md §3) : l'ancien parseur écrivait `cout: []` pour `cost=2` (16 attaques de
// Pikachu VMAX Raid Battle) comme pour une attaque sans coût ; le site lit [] « aucun coût ». Le parseur corrigé (collecte-cartes/wikitext.js,
// `coutDeAttaque`) rend `coutNombre` et pas de `cout`. Cet outil le rejoue sur les documents concernés SEULEMENT — ceux dont une attaque porte
// `cout: []` (254 documents) — depuis le wikitext archivé (R2 brut, lecture), avec la MÊME fonction (importée), et n'écrit que ce que le parseur
// change : `attaques.<i>.cout` retiré, `attaques.<i>.coutNombre` posé. CE QUI N'EST JAMAIS TOUCHÉ : un coût non vide, une attaque dont le nom ne
// concorde pas à la même position, un document dont le nombre d'attaques diverge, tout autre champ.
// ⚠️ La garde de lot (collecte-cartes/garde-lot.js) ne compte AUCUNE donnée d'attaque : le lot passera sans baisse à annoncer, et c'est la
// relecture de CET outil (compte avant/après sur les mêmes attaques) qui tient lieu de contrôle. `--annonce` n'a donc pas lieu d'être.
const OPS_REFUS = (id, raison, index) => ({ _id: id, index: index ?? null, raison });

/**
 * Le plan, PUR. `entrees` : [{ carte: { _id, attaques }, neuves: attaques du parseur }].
 * @returns {{ operations: {_id, index, nom, coutNombre}[], refus: {_id, index, raison}[], inchangees: number }}
 */
function planifierCouts(entrees) {
    const operations = [], refus = []; let inchangees = 0;
    for (const { carte, neuves } of entrees) {
        const anciennes = carte.attaques || [];
        if (anciennes.length !== neuves.length) { refus.push(OPS_REFUS(carte._id, `nombre d'attaques différent (base ${anciennes.length}, parseur ${neuves.length}) : document écarté`)); continue; }
        anciennes.forEach((o, i) => {
            const n = neuves[i];
            if (o.nom !== n.nom) { refus.push(OPS_REFUS(carte._id, `nom différent à la position ${i} (« ${o.nom} » / « ${n.nom} ») : attaque écartée`, i)); return; }
            if (n.coutNombre === undefined) { inchangees++; return; }   // rien à changer (même coût, ou sans coût)
            if (!Array.isArray(o.cout) || o.cout.length) { refus.push(OPS_REFUS(carte._id, `coût non vide ou absent en base (« ${JSON.stringify(o.cout ?? null)} ») : jamais touché`, i)); return; }
            operations.push({ _id: carte._id, index: i, nom: o.nom, coutNombre: n.coutNombre });
        });
    }
    return { operations, refus, inchangees };
}

/** L'opération Mongo : positionnelle par INDEX, gardée par le nom et par `cout` vide — rejouée, elle ne trouve plus rien. */
function operationVersMongo(op) {
    const p = `attaques.${op.index}`;
    return { filtre: { _id: op._id, [`${p}.nom`]: op.nom, [`${p}.cout`]: { $size: 0 } }, maj: { $set: { [`${p}.coutNombre`]: op.coutNombre }, $unset: { [`${p}.cout`]: '' } } };
}

async function principal() {
    require('dotenv').config();
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const r2 = require('./collecte-cartes/r2');
    const { faitsDeCarte } = require('./collecte-cartes/wikitext');
    const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    const attendu = Number((process.argv.find(a => a.startsWith('--attendu=')) || '').slice(10));
    if (inconnus.length || !attendu) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --attendu=<n> [--ecrire]`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    try {
        await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
        const C = cx.db.collection('cartes');
        const cibles = await C.find({ 'bulba.cleR2': { $exists: true }, attaques: { $elemMatch: { cout: { $size: 0 } } } }, { projection: { bulba: 1, attaques: 1 } }).toArray();
        const entrees = [];
        for (const carte of cibles) entrees.push({ carte, neuves: faitsDeCarte(await r2.lireTexte(process.env.R2_BUCKET_BRUT, carte.bulba.cleR2), carte.bulba.titre).attaques });
        const { operations, refus, inchangees } = planifierCouts(entrees);
        const videsAvant = cibles.reduce((s, c) => s + c.attaques.filter(a => Array.isArray(a.cout) && a.cout.length === 0).length, 0);
        console.log(`DÉNOMINATEUR : ${cibles.length} documents à une attaque \`cout: []\` · ${videsAvant} attaques vides · opérations ${operations.length} · attaques inchangées ${inchangees} · refus ${refus.length}`);
        for (const o of operations) console.log(`   ${o._id} attaques[${o.index}] « ${o.nom} » : cout [] → coutNombre ${o.coutNombre}`);
        for (const r of refus) console.log(`   REFUS ${r._id}${r.index == null ? '' : `[${r.index}]`} : ${r.raison}`);
        if (refus.length || operations.length !== attendu) { console.error(`🔴 ARRÊT : ${refus.length} refus, ${operations.length} opération(s) pour --attendu=${attendu}`); process.exitCode = 1; return; }
        if (!ECRIRE) { console.log('(simulation — --ecrire sous lot-additif.js ; la garde de lot ne compte pas les attaques : aucune --annonce)'); return; }
        let n = 0;
        for (const o of operations) { const { filtre, maj } = operationVersMongo(o); n += (await C.updateOne(filtre, maj)).modifiedCount; }
        const relus = await C.find({ _id: { $in: cibles.map(c => c._id) } }, { projection: { attaques: 1 } }).toArray();
        const videsApres = relus.reduce((s, c) => s + c.attaques.filter(a => Array.isArray(a.cout) && a.cout.length === 0).length, 0);
        console.log(`✅ ${n} écrite(s) (attendu ${attendu}) · relu : ${videsApres} attaques vides (avant ${videsAvant}, attendu ${videsAvant - attendu})`);
        if (n !== attendu || videsApres !== videsAvant - attendu) process.exitCode = 1;
    } finally { await fermer(); }
}

module.exports = { planifierCouts, operationVersMongo };
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exitCode = 1; });

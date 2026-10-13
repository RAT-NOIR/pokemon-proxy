// ============================================================
// LE `deck` DES SIX ÉNERGIES DE BASE DES DECKS « POKÉMON CARD GAME CLASSIC » — une impression chacune, le deck de leur set
// ============================================================
//   node poser-deck-energies-classic.js --attendu=6                       (simulation, le défaut)
//   node lot-additif.js --quoi="…" --collections=cartes -- node poser-deck-energies-classic.js --attendu=6 --ecrire
//
// POURQUOI (DEMANDE-SERVEUR-DATES.md point 4, enquête DATES-enquete.md §4) : ces six fiches simples (ids négatifs) portent UNE impression
// { expansion: 'Pokémon Card Game Classic', tirage: 'jp', numero: PSY|WAT|GRA|FIG|LIG|FIR } SANS `deck`, alors que les trois decks du même
// nom d'expansion se distinguent par ce champ. Le deck est celui du SET de la fiche (`sets.deck`), RELU en base — jamais recopié d'ici.
// CE QUI EST ÉCRIT, ET SEULEMENT ÇA : `impressions.$.deck`, par mise à jour positionnelle filtrée sur l'_id, le numéro, l'expansion, le tirage
// et un `deck` ABSENT (jamais une valeur remplacée). Refus : une fiche absente, dans zéro ou plusieurs sets, un set sans `deck`, zéro ou plus
// d'une impression correspondante. `--attendu=<n>` est exigé : l'outil refuse d'écrire si le nombre d'opérations ne l'égale pas.
const ENERGIES = { '-744658': 'PSY', '-744659': 'WAT', '-743198': 'GRA', '-743197': 'FIG', '-744624': 'LIG', '-744625': 'FIR' };
const EXPANSION = 'Pokémon Card Game Classic', TIRAGE = 'jp';
const vide = v => v == null || v === '';

/** Le plan, PUR : { operations: [{_id, numero, deck, set}], refus: [{_id, raison}], deja: [_id] }. */
function planifier({ cartes, setsParId, energies = ENERGIES }) {
    const parId = new Map(cartes.map(c => [String(c._id), c]));
    const operations = [], refus = [], deja = [];
    for (const [id, numero] of Object.entries(energies)) {
        const c = parId.get(String(id));
        const non = raison => refus.push({ _id: Number(id), raison });
        if (!c) { non('carte introuvable'); continue; }
        const sets = c.sets || [];
        if (sets.length !== 1) { non(`la fiche est dans ${sets.length} set(s), il en faut UN pour que le deck ne soit pas deviné`); continue; }
        const s = setsParId[sets[0]];
        if (!s) { non(`set « ${sets[0]} » introuvable`); continue; }
        if (vide(s.deck) || typeof s.deck !== 'string') { non(`sets.deck absent sur « ${sets[0]} »`); continue; }
        const memes = (c.impressions || []).filter(i => i && i.expansion === EXPANSION && i.tirage === TIRAGE && String(i.numero) === numero);
        if (memes.length !== 1) { non(`${memes.length} impression(s) correspondante(s) (expansion, tirage, numéro ${numero}) — ${memes.length ? "plus d'une : laquelle porterait le deck ?" : 'aucune'}`); continue; }
        if (!vide(memes[0].deck)) { deja.push(Number(id)); continue; }
        operations.push({ _id: Number(id), numero, deck: s.deck, set: sets[0] });
    }
    return { operations, refus, deja };
}

/** L'opération Mongo : positionnelle, le filtre porte l'impression visée (numéro, expansion, tirage, deck absent). */
function operationVersMongo(op) {
    return {
        filtre: { _id: op._id, impressions: { $elemMatch: { numero: op.numero, expansion: EXPANSION, tirage: TIRAGE, deck: { $in: [null, ''] } } } },
        maj: { $set: { 'impressions.$.deck': op.deck } }
    };
}

async function principal() {
    require('dotenv').config();
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    const attendu = Number((process.argv.find(a => a.startsWith('--attendu=')) || '').slice(10));
    if (inconnus.length || !attendu) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --attendu=<n> [--ecrire]`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    try {
        const C = cx.db.collection('cartes');
        const ids = Object.keys(ENERGIES).map(Number);
        const cartes = await C.find({ _id: { $in: ids } }, { projection: { sets: 1, impressions: 1 } }).toArray();
        const setIds = [...new Set(cartes.flatMap(c => c.sets || []))];
        const setsParId = Object.fromEntries((await cx.db.collection('sets').find({ _id: { $in: setIds } }, { projection: { deck: 1 } }).toArray()).map(s => [s._id, s]));
        const { operations, refus, deja } = planifier({ cartes, setsParId });
        console.log(`DÉNOMINATEUR : ${ids.length} fiches nommées · ${cartes.length} trouvées · ${setIds.length} set(s) · opérations ${operations.length} · déjà posés ${deja.length} · refus ${refus.length}`);
        for (const o of operations) console.log(`   ${o._id} (${o.numero}) → deck « ${o.deck} » [set ${o.set}]`);
        for (const r of refus) console.log(`   REFUS ${r._id} : ${r.raison}`);
        if (refus.length || operations.length !== attendu) { console.error(`🔴 ARRÊT : ${refus.length} refus, ${operations.length} opération(s) pour --attendu=${attendu}`); process.exitCode = 1; return; }
        if (!ECRIRE) { console.log('(simulation — --ecrire sous lot-additif.js)'); return; }
        let n = 0;
        for (const o of operations) { const { filtre, maj } = operationVersMongo(o); n += (await C.updateOne(filtre, maj)).modifiedCount; }
        const relus = await C.find({ _id: { $in: ids } }, { projection: { impressions: 1 } }).toArray();
        const sansDeck = relus.filter(c => (c.impressions || []).some(i => i && i.expansion === EXPANSION && vide(i.deck))).length;
        console.log(`✅ ${n} écrit(s) (attendu ${attendu}) · relu : ${sansDeck} fiche(s) encore sans deck`);
        if (n !== attendu || sansDeck) process.exitCode = 1;
    } finally { await fermer(); }
}

module.exports = { planifier, operationVersMongo, ENERGIES, EXPANSION };
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exitCode = 1; });

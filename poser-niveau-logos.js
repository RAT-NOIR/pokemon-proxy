// ============================================================
// POSER LE NIVEAU DE CHAQUE LOGO DÉJÀ EN BASE (testeur, 2026-10-13 : « chaque logo porte son niveau et sa source »)
// ============================================================
//   node poser-niveau-logos.js            SIMULATION (lecture seule) : comptes par champ, par valeur et par tirage, 10 exemples par valeur
//   node lot-additif.js --quoi="niveau des logos 2026-10" --collections=sets -- node poser-niveau-logos.js --ecrire     (le coordinateur, depuis main)
// La table de classement est collecte-cartes/niveau-logos.js (fonction pure, table fermée, `inconnu` jamais deviné). L'écriture est ADDITIVE : le champ NEUF `<logo>.niveau`
// (et `<logo>.source` seulement s'il manque et se lit sans deviner), sur un champ qui n'a pas encore de niveau. AUCUNE valeur existante n'est modifiée, aucun logo retiré.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { simuler, CHAMPS } = require('./collecte-cartes/niveau-logos');

/** Les fichiers que les tables lues DISENT officiels (`officiel: true`). Aujourd'hui : aucun (les tables disent ce que le fichier représente, pas d'où il vient). */
function officielsDesTables(dossier = path.join(__dirname, 'collecte-cartes')) {
    const out = new Set(); let lignes = 0;
    for (const f of ['logos-apport-manuel-lus.json', 'logos-manuels-lus.json']) {
        const t = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
        for (const l of (Array.isArray(t) ? t : t.lignes)) { lignes++; if (l.officiel === true) { out.add(l.fichier); out.add(`${l.dossier}/${l.fichier}`); } }
    }
    return { officielsManuels: out, lignes };
}
module.exports = { officielsDesTables };

if (require.main === module) (async () => {
    const inconnus = process.argv.slice(2).filter(a => a !== '--ecrire');
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const cx = (!ECRIRE && await require('./collecte-cartes/ouvrir-lecture').ouvrirLecture()) || await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.cartes.db.collection('sets');
    const proj = Object.fromEntries(['logo', 'logoFr', 'logoCompose', 'logoOfficiel', 'logoSemiOfficiel', 'logoGenerique', 'tirage', 'region'].map(k => [k, 1]));
    const sets = await S.find({}, { projection: proj }).toArray();
    if (!sets.length) throw new Error('collection sets vide : base fausse');
    const { officielsManuels, lignes } = officielsDesTables();
    const sim = simuler(sets, { officielsManuels });
    console.log(`DÉNOMINATEUR : ${sim.sets} sets lus · ${sim.champsVus} champs de logo · ${sim.aEcrire.length} sans niveau (à poser) · tables manuelles lues : ${lignes} lignes, ${officielsManuels.size / 2} disant « officiel »`);
    for (const champ of CHAMPS) if (sim.comptes[champ]) console.log(`   ${champ.padEnd(22)} ${JSON.stringify(sim.comptes[champ])}`);
    console.log(`PAR TIRAGE : ${JSON.stringify(sim.parTirage)}`);
    for (const [champ, vals] of Object.entries(sim.exemples)) for (const [v, ex] of Object.entries(vals)) console.log(`   exemples ${champ} = ${v} : ${ex.map(x => `${x._id}[${x.source ?? '∅'}]`).join(' ')}`);
    if (!ECRIRE) { console.log('(simulation seule — --ecrire sous lot-additif.js ; rien n\'est écrit)'); await cx.fermer(); return; }
    let ecrits = 0, deja = 0;
    for (const x of sim.aEcrire) {
        const filtre = { _id: x._id, [x.chemin]: { $exists: true }, [`${x.chemin}.niveau`]: { $exists: false }, ...(x.pose.source ? { [`${x.chemin}.source`]: { $exists: false } } : {}) };
        const u = await S.updateOne(filtre, { $set: Object.fromEntries(Object.entries(x.pose).map(([k, v]) => [`${x.chemin}.${k}`, v])) });
        if (u.modifiedCount === 1) ecrits++; else deja++;
    }
    const relu = simuler(await S.find({}, { projection: proj }).toArray(), { officielsManuels });
    console.log(`ÉCRIT : ${ecrits} champs (${deja} déjà posés entre-temps) · RELU : ${relu.aEcrire.length} champs sans niveau, comptes ${JSON.stringify(relu.comptes)}`);
    await cx.fermer();
    if (relu.aEcrire.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });

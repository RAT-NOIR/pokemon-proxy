// ============================================================
// REMPLIR LA FILE D'IMAGES — tout set collecté (texte concordant) qui a une source artofpkm
// ============================================================
//   node collecte-cartes/remplir-file-images.js            écrit
//   node collecte-cartes/remplir-file-images.js --a-blanc  n'écrit rien, imprime
//
// Décision du testeur, 2026-09-15 : un set concordant part en file SANS validation ; le worker mesure lui-même ses
// 3 originaux avant tout téléchargement et liste ses refus. Ce script :
//   1. LISTES TRONQUÉES (§21 n°7, résolu le 2026-09-15 : le serveur ignore `?page=`, la suite vient d'un cadre Turbo) :
//      une liste d'ANCIENNE forme (relevé absent ou par `page`) dont la longueur est un multiple de 100 est retirée de
//      l'état (mesures gardées) et son set REMIS en file, avec `remisEnFileLe` et `remisEnFileMotif` (§23). Une liste
//      de NOUVELLE forme (relevé par `lot`, dernier lot sans suite) est complète : gardée.
//   2. ENFILE tout set dont le texte est `verifie` et concordant, et qui a une source (sourceDe). Sans source : LISTÉ.
// Un `refuse` d'une autre cause n'est jamais remis en attente ici (§23 : on relit la liste, on ne la vide pas).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ouvrirConnexions } = require('./garde');
const { TABLE, TABLE_AUTO } = require('./table-sets');
const { sourceDe } = require('./sources-sets');
const { sourcesDeployees } = require('./sources-deployees');

const aBlanc = process.argv.includes('--a-blanc');
(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const E = cx.db.collection('collecte_images_etat'), F = cx.db.collection('file_images');
    const lignes = [...TABLE, ...TABLE_AUTO];
    const codeDeSlug = new Map(lignes.map(l => [l.slugSet, l.code]));
    let ordre = Date.now();

    // 1. listes tronquées
    const etats = await E.find({ _id: /^artofpkm\/(?!__)/ }).toArray();
    const remis = [];
    for (const d of etats) {
        for (const [id, liste] of Object.entries(d.entrees || {})) {
            const releve = d.pagesListe?.[id];
            const nouvelleForme = Array.isArray(releve) && releve.length && releve.every(p => 'lot' in p) && releve.at(-1).suite === null;
            if (nouvelleForme || !liste.length || liste.length % 100 !== 0) continue;
            const code = codeDeSlug.get(d._id.slice('artofpkm/'.length));
            if (d.verrou?.depuis) { console.log(`   ⚠️ ${d._id} liste ${id} (${liste.length}) tronquée mais VERROU présent : non touchée`); continue; }
            console.log(`   TRONQUÉE ${String(code).padEnd(7)} ${d._id} liste ${id} : ${liste.length} entrées · relevé ${JSON.stringify(releve ?? null)}`);
            if (!aBlanc) await E.updateOne({ _id: d._id }, { $unset: { [`entrees.${id}`]: 1, [`pagesListe.${id}`]: 1 } });
            if (code) remis.push(code);
        }
    }
    for (const code of [...new Set(remis)]) {
        const f = await F.findOne({ _id: code });
        if (f?.etat === 'fait' || !f) {
            if (!aBlanc) await F.updateOne({ _id: code }, { $set: { etat: 'attente', ordre: ordre++, remisEnFileLe: new Date(), remisEnFileMotif: 'liste-tronquee-100 (pagination Turbo, 2026-09-15)' }, $unset: { pris: 1, fini: 1 } }, { upsert: true });
            console.log(`   REMIS    ${code} (était ${f?.etat ?? 'absent'})`);
        } else console.log(`   ${code} : état ${f.etat} conservé (résultat ${f.resultat ?? '—'})`);
    }

    // 2. enfiler les sets collectés et concordants
    const sets = await cx.db.collection('sets').find({ 'complet.concordance': true }, { projection: { _id: 1 } }).toArray();
    const verifies = new Set((await cx.db.collection('collecte_etat').find({ phase: 'verifie' }, { projection: { _id: 1 } }).toArray()).map(e => e._id));
    const enfiles = [], sansSource = [], nonPoussee = [], deja = {};
    // Même garde que collecte-massive.js (§21 bis) : la source doit exister dans la version POUSSÉE, que le worker connaît.
    const deployees = sourcesDeployees();
    if (deployees.erreur) console.log(`⚠️ ${deployees.erreur} : aucun set ne sera enfilé`);
    else console.log(`sources de la version poussée : ${deployees.ref} ${deployees.commit}`);
    for (const s of sets) {
        const code = codeDeSlug.get(s._id);
        if (!code || !verifies.has(s._id)) continue;
        if (!sourceDe(code)) { sansSource.push(code); continue; }
        if (deployees.erreur || !deployees.sourceDe(code)) { nonPoussee.push(code); continue; }
        const f = await F.findOne({ _id: code });
        if (f) { deja[f.etat] = (deja[f.etat] || 0) + 1; continue; }
        if (!aBlanc) await F.insertOne({ _id: code, ordre: ordre++, etat: 'attente', ajouteLe: new Date() });
        enfiles.push(code);
    }
    const file = await F.find({}).toArray();
    console.log(`\nDÉNOMINATEUR : ${sets.length} sets concordants en base · ${etats.length} états d'images`);
    console.log(`remis en file (listes tronquées) : ${[...new Set(remis)].length} ${JSON.stringify([...new Set(remis)])}`);
    console.log(`enfilés : ${enfiles.length} ${JSON.stringify(enfiles)}`);
    console.log(`déjà en file (état conservé) : ${JSON.stringify(deja)}`);
    console.log(`SANS SOURCE d'images artofpkm (listés, non enfilés) : ${sansSource.length} ${JSON.stringify(sansSource)}`);
    console.log(`source locale NON POUSSÉE (listés, non enfilés — relancer après push et redéploiement) : ${nonPoussee.length} ${JSON.stringify(nonPoussee)}`);
    console.log(`file_images : ${file.length} entrées · ${JSON.stringify(file.reduce((m, x) => (m[x.etat] = (m[x.etat] || 0) + 1, m), {}))}${aBlanc ? ' (À BLANC : rien écrit)' : ''}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

// ============================================================
// L'ILLUSTRATEUR PAR IMPRESSION — `cartes.impressions[].illustrateur` depuis CORRECTION-ILLUSTRATEURS.json (2026-09-23)
// ============================================================
//   node poser-illustrateurs.js [--fichier=<chemin>]            (mesure, c'est le défaut)
//   node poser-illustrateurs.js [--fichier=<chemin>] --ecrire   (écrit sur `cartes`, SAUVEGARDE RÉELLE AVANT)
//
// 🔴 POURQUOI : une page Bulbapedia est UN texte de jeu avec TOUS ses tirages, y compris ceux réillustrés — Professor's
// Research porte 132 impressions et 10 illustrateurs dans nos seuls scans artofpkm. `cartes.illustrateur` (un champ par
// page) donnait l'illustrateur du premier tirage à toutes les réimpressions : 81 % des fiches affichaient un faux, dit le site.
// Le fichier vient de l'agent site ; il n'est PAS cru sur parole : il est confronté, avant toute écriture, à un témoin
// qu'il n'a pas utilisé — l'illustrateur que portent les pages artofpkm, tirage japonais par tirage japonais.
// `null` s'écrit tel quel (« la source ne tranche pas pour ce tirage ») ; une impression absente du fichier reste sans champ.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { cleNumero } = require('./collecte-cartes/jointure');

const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const FICHIER = arg('fichier') || 'C:/Users/Yung/Desktop/rat-market-site/CORRECTION-ILLUSTRATEURS.json';
const cleIll = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s.·・]+/g, '');
const cleImp = (tirage, expansion, numero) => `${tirage}|${expansion}|${numero ?? ''}`;
const FAUX_TOLERES = 0;   // un seul désaccord avec le témoin et rien n'est écrit : zéro faux affirmé

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const F = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    const corr = F.corrections;
    if (!Array.isArray(corr) || !corr.length) throw new Error(`${FICHIER} : aucune correction lue`);
    console.log(`fichier : ${FICHIER}\n   généré le ${F.genereLe} · source « ${F.source} » · règle « ${F.regle} » · ${corr.length} corrections`);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const cartes = new Map((await lireMongo(cx.db.collection('cartes'), { _id: { $in: [...new Set(corr.map(c => c.carte))] } }, { nom: 'cartes du fichier', projection: { impressions: 1, nomEn: 1 } })).map(c => [c._id, c]));

    // 1. Chaque correction désigne-t-elle UNE impression de la carte ? Doublons contradictoires ?
    const M = { carteAbsente: 0, impressionAbsente: [], ambigue: 0, doublonsContradictoires: [], nonNul: 0, nul: 0 };
    const parCle = new Map();
    for (const c of corr) {
        const k = `${c.carte}|${cleImp(c.tirage, c.expansion, c.numero)}`;
        if (parCle.has(k) && parCle.get(k).illustrateur !== c.illustrateur) M.doublonsContradictoires.push(`${k} : « ${parCle.get(k).illustrateur} » / « ${c.illustrateur} »`);
        parCle.set(k, c);
    }
    const aEcrire = [];
    for (const [k, c] of parCle) {
        const carte = cartes.get(c.carte);
        if (!carte) { M.carteAbsente++; continue; }
        const idx = (carte.impressions || []).map((i, n) => [i, n]).filter(([i]) => cleImp(i.tirage, i.expansion, i.numero) === cleImp(c.tirage, c.expansion, c.numero)).map(([, n]) => n);
        if (!idx.length) { M.impressionAbsente.push(k); continue; }
        if (idx.length > 1) M.ambigue++;
        c.illustrateur == null ? M.nul++ : M.nonNul++;
        aEcrire.push({ c, idx });
    }
    console.log(`\n════ APPARIEMENT : ${parCle.size} clés distinctes (${corr.length - parCle.size} doublons) ════`);
    console.log(`   impressions trouvées : ${aEcrire.length} (illustrateur ${M.nonNul} · null ${M.nul}) · carte absente ${M.carteAbsente} · impression absente ${M.impressionAbsente.length} · clé portée par plusieurs impressions ${M.ambigue}`);
    console.log(`   doublons contradictoires : ${M.doublonsContradictoires.length} ${M.doublonsContradictoires.length ? '🔴 ' + M.doublonsContradictoires.slice(0, 3).join(' · ') : '✅'}`);
    for (const k of M.impressionAbsente.slice(0, 5)) console.log(`      impression absente : ${k}`);

    // 2. LE TÉMOIN : l'illustrateur des pages artofpkm, par (carte, set, numéro) — jamais utilisé par le fichier
    const ims = await lireMongo(cx.db.collection('images'), { source: 'artofpkm', etat: 'ok', carteId: { $ne: null }, illustrateur: { $nin: [null, ''] } }, { nom: 'images artofpkm avec illustrateur', projection: { carteId: 1, set: 1, numero: 1, illustrateur: 1 } });
    champSur(ims, 'illustrateur', { collection: 'images artofpkm' });
    const temoin = new Map();
    for (const i of ims) { const k = `${i.carteId}|${i.set}|${cleNumero(i.numero)}`; (temoin.get(k) || temoin.set(k, new Set()).get(k)).add(cleIll(i.illustrateur)); }
    const T = { confrontees: 0, accord: 0, desaccords: [], nulAvecTemoin: 0 };
    for (const { c } of aEcrire) {
        if (c.tirage !== 'jp') continue;
        const vus = new Set((c.sets || []).flatMap(s => [...(temoin.get(`${c.carte}|${s}|${cleNumero(c.numero)}`) || [])]));
        if (!vus.size) continue;
        if (c.illustrateur == null) { T.nulAvecTemoin++; continue; }
        T.confrontees++;
        if (vus.has(cleIll(c.illustrateur))) T.accord++; else T.desaccords.push(`${c.carte} « ${c.nomEn} » ${c.expansion} ${c.numero} : fichier « ${c.illustrateur} » · artofpkm « ${[...vus].join(' / ')} »`);
    }
    console.log(`\n════ TÉMOIN artofpkm (tirages jp) : ${T.confrontees} illustrateurs confrontés ════`);
    console.log(`   ✅ accord ${T.accord} · 🔴 désaccord ${T.desaccords.length} · null du fichier là où artofpkm a un nom : ${T.nulAvecTemoin}`);
    for (const d of T.desaccords.slice(0, 15)) console.log(`      ${d}`);
    if (!T.confrontees) console.log('   🔴 AUCUNE confrontation : le témoin ne peut pas conclure');

    if (!ecrire) { console.log(`\n   (mesure seule — --ecrire refuse au-delà de ${FAUX_TOLERES} désaccord)`); await fermer(); return; }
    if (!T.confrontees || T.desaccords.length > FAUX_TOLERES || M.doublonsContradictoires.length) throw new Error(`ARRÊT : ${T.desaccords.length} désaccord(s) avec le témoin, ${M.doublonsContradictoires.length} doublon(s) contradictoire(s), ${T.confrontees} confrontation(s) — rien n'est écrit`);
    const preuve = c => `${c.preuve} (${F.source}, fichier du ${F.genereLe.slice(0, 10)})`;
    const ops = aEcrire.flatMap(({ c, idx }) => idx.map(n => ({ updateOne: { filter: { _id: c.carte }, update: { $set: { [`impressions.${n}.illustrateur`]: c.illustrateur ?? null, [`impressions.${n}.illustrateurPreuve`]: preuve(c) } } } })));
    const r = await cx.db.collection('cartes').bulkWrite(ops, { ordered: false });
    const relu = await cx.db.collection('cartes').aggregate([{ $unwind: '$impressions' }, { $group: { _id: { $cond: [{ $eq: [{ $type: '$impressions.illustrateur' }, 'missing'] }, 'absent', { $cond: [{ $eq: ['$impressions.illustrateur', null] }, 'null', 'nom'] }] }, n: { $sum: 1 } } }]).toArray();
    console.log(`\n   ✅ ${r.modifiedCount} cartes modifiées pour ${ops.length} impressions · RELU : ${relu.map(x => `${x._id} ${x.n}`).join(' · ')}`);
    await fermer();
})().catch(e => { console.error(e.message); process.exit(1); });

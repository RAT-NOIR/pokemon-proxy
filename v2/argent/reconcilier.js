'use strict';
// RÉCONCILIATION : somme(delta des mouvements) + dotation initiale  ==  solde réel, poche par poche. IMPRIME l'écart, ne CORRIGE JAMAIS en silence
// (un solde « réparé » par l'outil qui le contrôle ne contrôlerait plus rien).
// Poches comparées : compte = accueil, achete ; installation = essai, achete. L'hebdo et l'abonnement sont des compteurs remis à zéro par période, pas des soldes.
// ⚠️ Un porteur dont la dotation initiale est INCONNUE (installation sans `essaisInitiaux`) n'a pas de zéro par défaut : la poche est listée « non vérifiable ».
// ⚠️ Les mouvements expirent (TTL 24 mois) : au-delà, la somme est incomplète — un écart sur un porteur de plus de 24 mois n'est pas forcément une fuite.
const db = require('../db');
const MS = require('./marque-scan');
const col = nom => db.col(nom);
// O5 : un scan dont la marque de livraison reste `en-suspens` (ou en-reprise, ou en echec) au-delà du seuil est un débit dont la réponse n'est peut-être jamais partie : le solde et le journal
// concordent, le client n'a rien reçu. Il est LISTÉ ici (MS.enSuspens) et le verdict n'est pas « propre » tant qu'il en reste une.

async function sommeParPoche(porteur) {
    const filtre = porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id };
    const lignes = await col('mouvements').aggregate([{ $match: filtre }, { $group: { _id: '$poche', s: { $sum: '$delta' } } }]).toArray();
    return Object.fromEntries(lignes.map(l => [l._id, l.s]));
}
// BANC-12 (tour 1, I-2) : un débit qui GARDE son scanId au-delà du lien (cohorte échue) parce qu'il est encore utile — sous une marque non close, sous une question ouverte, ou non résolu (« rendu-* ») :
// listé avec son âge. Il garde un débit à son SCAN, jamais une contribution du banc (la ligne du banc est réidentifiée au hasard). Sa présence n'est pas « propre ».
async function debitsGardes(porteur, { cfg, maintenant }) {
    const filtre = porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id };
    const limite = require('../banc/commun').limiteLien(cfg, maintenant);
    const l = await col('mouvements').find({ ...filtre, scanId: { $exists: true, $ne: null }, le: { $lt: limite } }).toArray();
    return l.map(m => ({ id: m._id, scanId: m.scanId, etat: m.etat, type: m.type, ageJours: Math.floor((new Date(maintenant).getTime() - m.le.getTime()) / 86400e3) }));
}
async function reconcilier(porteur, { cfg = require('../config').lireConfig(process.env), maintenant = new Date() } = {}) {
    const somme = await sommeParPoche(porteur), ecarts = [], nonVerifiables = [];
    let comparees = 0;
    const comparer = (poche, attendu, reel) => {
        if (attendu === null) { nonVerifiables.push(poche); return; }
        comparees++;
        if (reel !== attendu) ecarts.push({ poche, attendu, reel, ecart: reel - attendu });
    };
    if (porteur.type === 'compte') {
        const c = await col('comptes').findOne({ _id: porteur.id });
        if (!c) return { porteur: `compte:${porteur.id}`, ecarts: [{ poche: '*', attendu: null, reel: null, ecart: null, note: 'compte introuvable' }], nonVerifiables, comparees };
        comparer('accueil', somme.accueil ?? 0, c.solde?.accueil ?? 0);
        comparer('achete', somme.achete ?? 0, c.solde?.achete ?? 0);
    } else if (porteur.type === 'installation') {
        const i = await col('installations').findOne({ _id: porteur.id });
        if (!i) return { porteur: `installation:${porteur.id}`, ecarts: [{ poche: '*', attendu: null, reel: null, ecart: null, note: 'installation introuvable' }], nonVerifiables, comparees };
        comparer('essai', Number.isInteger(i.essaisInitiaux) ? i.essaisInitiaux + (somme.essai ?? 0) : null, i.essais ?? 0);
        comparer('achete', somme.achete ?? 0, i.achete ?? 0);
    } else throw new Error(`reconcilier : type de porteur inconnu "${porteur.type}"`);
    const rendusEchoues = await lignesNonRendues(porteur);
    const marquesEnSuspens = await MS.enSuspens({ porteur });
    const gardes = await debitsGardes(porteur, { cfg, maintenant });
    const lots = await lotsARendre(porteur);
    // tour 3 : les lots RÉGLÉS mais NON JUGÉS (arrêt entre « repondue » et le jugement) : le balayage les jugera ; listés tant qu'ils existent
    const nonJuges = await require('./questions').lotsNonJuges({ 'porteur.type': porteur.type, 'porteur.id': porteur.id }, maintenant);
    return { porteur: `${porteur.type}:${porteur.id}`, ecarts, nonVerifiables, comparees, rendusEchoues, marquesEnSuspens, debitsGardes: gardes, lotsARendre: lots, lotsNonJuges: nonJuges,
        propre: ecarts.length === 0 && rendusEchoues.length === 0 && marquesEnSuspens.length === 0 && gardes.length === 0 && lots.length === 0 && nonJuges.length === 0 };
}
// UN-CANDIDAT, tour 2 : un lot dont toutes les confirmations sont refusées et dont le remboursement a ÉCHOUÉ (ou n'a pas pu être jugé) porte `lotARendre` sur ses lignes `questions_v2`. Le solde et le journal
// concordent (le client est débité, rien ne dit qu'il aurait dû être rendu) : il est LISTÉ ici, le balayage le reprend, et le verdict n'est pas « propre » tant qu'il en reste un.
async function lotsARendre(porteur) {
    const l = await col('questions_v2').find({ lot: true, lotARendre: { $exists: true }, 'porteur.type': porteur.type, 'porteur.id': porteur.id }).toArray();
    const vus = new Map();
    for (const q of l) if (!vus.has(String(q.scanId))) vus.set(String(q.scanId), { scanId: q.scanId, porteur: `${porteur.type}:${porteur.id}`, cause: q.lotARendre.cause ?? null, depuis: q.lotARendre.depuis ?? null });
    return [...vus.values()];
}
// Une ligne de débit dont le rendu a échoué (« rendu-echoue ») ou n'a pas été confirmé (« rendu-en-cours ») NE se voit PAS dans la somme des deltas (le solde et le journal restent d'accord) :
// le client est débité sans livraison. Elle est LISTÉE ici et le verdict n'est pas « propre » tant qu'il en reste une.
async function lignesNonRendues(porteur) {
    const filtre = porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id };
    const l = await col('mouvements').find({ ...filtre, type: 'debit', etat: { $in: ['rendu-echoue', 'rendu-en-cours'] } }).toArray();
    return l.map(m => ({ id: m._id, scanId: m.scanId, porteur: `${porteur.type}:${porteur.id}`, poche: m.poche, etat: m.etat, raison: m.raisonRendu ?? null }));
}
// Tous les porteurs de la base (curseur : pas de liste en mémoire)
async function reconcilierTous({ cfg = require('../config').lireConfig(process.env), maintenant = new Date() } = {}) {
    const bilan = { porteurs: 0, comparees: 0, avecEcart: 0, nonVerifiables: 0, lignes: [], rendusEchoues: [], marquesEnSuspens: [], debitsGardes: [], lotsARendre: [], lotsNonJuges: [], banc: null, propre: true };
    for (const [type, nom] of [['compte', 'comptes'], ['installation', 'installations']]) {
        for await (const d of col(nom).find({}, { projection: { _id: 1 } })) {
            const r = await reconcilier({ type, id: d._id }, { cfg, maintenant });
            bilan.porteurs++; bilan.comparees += r.comparees; bilan.nonVerifiables += r.nonVerifiables.length;
            if (r.ecarts.length) { bilan.avecEcart++; bilan.lignes.push(r); }
            bilan.rendusEchoues.push(...(r.rendusEchoues ?? []));
            bilan.debitsGardes.push(...(r.debitsGardes ?? []));
            bilan.lotsARendre.push(...(r.lotsARendre ?? []));
            bilan.lotsNonJuges.push(...(r.lotsNonJuges ?? []));
        }
    }
    bilan.marquesEnSuspens = await MS.enSuspens();            // toutes, y compris celles d'un porteur disparu (un compte supprimé n'efface pas un débit sans livraison)
    // BANC-12 (tour 1, I-1) : l'état de la dernière passe d'anonymisation du banc réel — des nombres seuls : lignes échues non traitées, âge (jours depuis la bascule), objets en attente de suppression
    const etat = await require('../banc/anonymisation').lireEtat(col);
    // (tour 2) objetsRefuses : des clés que le stockage refuse pour toujours, comptées À PART (elles ne tiennent pas l'alerte des lignes) ; perime : l'état n'a pas été mis à jour depuis plus de 3 jours
    // (la passe ne tourne plus : un « 0 » ancien ne rassure pas). Aucune passe enregistrée (null) : dit, sans bloquer (v2 éteinte, ou pas encore de passe).
    bilan.banc = etat ? { lignesEnEchec: etat.lignesEnEchec, ageMaxJours: etat.ageMaxJours, objetsEnAttente: etat.objetsEnAttente, objetsRefuses: etat.objetsRefuses ?? 0,
        perime: new Date(maintenant).getTime() - new Date(etat.majLe).getTime() > 3 * 86400e3 } : null;
    bilan.propre = bilan.avecEcart === 0 && bilan.rendusEchoues.length === 0 && bilan.marquesEnSuspens.length === 0 && bilan.debitsGardes.length === 0 && bilan.lotsARendre.length === 0 && bilan.lotsNonJuges.length === 0
        && !(bilan.banc && (bilan.banc.lignesEnEchec > 0 || bilan.banc.objetsEnAttente > 0 || bilan.banc.perime));
    return bilan;
}
module.exports = { reconcilier, reconcilierTous };

if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    const { baseDemandee, BASE_PRODUCTION, connecterMongo } = require('../../mongo-connexion');
    (async () => {
        // le refus se décide AVANT toute connexion : lecture seule, mais la règle du dépôt tient (la production se nomme ET se confirme)
        if (baseDemandee() === BASE_PRODUCTION && !process.argv.includes('--confirmer-production')) {
            console.error(`❌ ARRÊT : la base "${BASE_PRODUCTION}" est la PRODUCTION. Relance avec --confirmer-production (lecture seule).`);
            process.exit(1);
        }
        const base = await connecterMongo({ script: 'v2/argent/reconcilier.js', ecrit: false });
        const p = process.argv.find(a => a.startsWith('--prefixe='));
        if (p) { if (base !== 'test_scratch') { console.error('❌ --prefixe n\'est permis que sur test_scratch'); process.exit(1); } db.definirPrefixe(p.slice('--prefixe='.length)); }
        db.brancher(mongoose.connection.db);
        const b = await reconcilierTous();
        console.log(`${b.porteurs} porteurs comparés (${b.comparees} poches), ${b.avecEcart} avec écart, ${b.nonVerifiables} poche(s) non vérifiable(s) (dotation initiale inconnue)`);
        if (b.lignes.length) {
            console.log('porteur'.padEnd(46) + 'poche'.padEnd(10) + 'attendu'.padStart(9) + 'réel'.padStart(8) + 'écart'.padStart(8));
            for (const l of b.lignes) for (const e of l.ecarts) console.log(l.porteur.padEnd(46) + String(e.poche).padEnd(10) + String(e.attendu).padStart(9) + String(e.reel).padStart(8) + String(e.ecart).padStart(8));
        }
        console.log(`${b.rendusEchoues.length} ligne(s) de débit au rendu non confirmé (rendu-echoue / rendu-en-cours) — débit sans livraison tant qu'elles restent`);
        console.log(`${b.debitsGardes.length} débit(s) qui gardent leur scanId au-delà du lien du banc (marque non close, question ouverte ou rendu non confirmé) — débit à son scan, jamais une contribution`);
        for (const d of b.debitsGardes) console.log(`  débit ${d.id}  scan ${d.scanId}  ${d.etat}  âge ${d.ageJours} j`);
        console.log(b.banc ? `banc réel — dernière passe d'anonymisation : ${b.banc.lignesEnEchec} ligne(s) échue(s) non traitée(s) (âge max ${b.banc.ageMaxJours} j depuis la bascule), ${b.banc.objetsEnAttente} objet(s) en attente de suppression, ${b.banc.objetsRefuses} objet(s) refusé(s) par le stockage${b.banc.perime ? ' — ÉTAT PÉRIMÉ (plus de 3 jours sans passe)' : ''}` : 'banc réel — aucune passe d\'anonymisation enregistrée');
        console.log(`${b.marquesEnSuspens.length} scan(s) dont la marque de livraison reste en suspens (réponse peut-être jamais partie) — débit sans livraison tant qu'elles restent`);
        for (const l of b.marquesEnSuspens) console.log(`  scan ${l.scanId}  ${l.porteur}  ${l.etat}  ouverte le ${l.ouverteLe.toISOString()}${l.issue ? ` (${l.issue})` : ''}`);
        if (b.rendusEchoues.length) {
            console.log('porteur'.padEnd(46) + 'scanId'.padEnd(24) + 'poche'.padEnd(10) + 'état');
            for (const l of b.rendusEchoues) console.log(l.porteur.padEnd(46) + String(l.scanId).padEnd(24) + String(l.poche).padEnd(10) + l.etat + (l.raison ? ` (${l.raison})` : '') + `  _id=${l.id}`);
        }
        await mongoose.disconnect();
        process.exit(b.propre ? 0 : 1);
    })().catch(e => { console.error('❌', e); process.exit(1); });
}

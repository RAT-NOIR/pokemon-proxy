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
async function reconcilier(porteur) {
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
    return { porteur: `${porteur.type}:${porteur.id}`, ecarts, nonVerifiables, comparees, rendusEchoues, marquesEnSuspens, propre: ecarts.length === 0 && rendusEchoues.length === 0 && marquesEnSuspens.length === 0 };
}
// Une ligne de débit dont le rendu a échoué (« rendu-echoue ») ou n'a pas été confirmé (« rendu-en-cours ») NE se voit PAS dans la somme des deltas (le solde et le journal restent d'accord) :
// le client est débité sans livraison. Elle est LISTÉE ici et le verdict n'est pas « propre » tant qu'il en reste une.
async function lignesNonRendues(porteur) {
    const filtre = porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id };
    const l = await col('mouvements').find({ ...filtre, type: 'debit', etat: { $in: ['rendu-echoue', 'rendu-en-cours'] } }).toArray();
    return l.map(m => ({ id: m._id, scanId: m.scanId, porteur: `${porteur.type}:${porteur.id}`, poche: m.poche, etat: m.etat, raison: m.raisonRendu ?? null }));
}
// Tous les porteurs de la base (curseur : pas de liste en mémoire)
async function reconcilierTous() {
    const bilan = { porteurs: 0, comparees: 0, avecEcart: 0, nonVerifiables: 0, lignes: [], rendusEchoues: [], marquesEnSuspens: [], propre: true };
    for (const [type, nom] of [['compte', 'comptes'], ['installation', 'installations']]) {
        for await (const d of col(nom).find({}, { projection: { _id: 1 } })) {
            const r = await reconcilier({ type, id: d._id });
            bilan.porteurs++; bilan.comparees += r.comparees; bilan.nonVerifiables += r.nonVerifiables.length;
            if (r.ecarts.length) { bilan.avecEcart++; bilan.lignes.push(r); }
            bilan.rendusEchoues.push(...(r.rendusEchoues ?? []));
        }
    }
    bilan.marquesEnSuspens = await MS.enSuspens();            // toutes, y compris celles d'un porteur disparu (un compte supprimé n'efface pas un débit sans livraison)
    bilan.propre = bilan.avecEcart === 0 && bilan.rendusEchoues.length === 0 && bilan.marquesEnSuspens.length === 0;
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

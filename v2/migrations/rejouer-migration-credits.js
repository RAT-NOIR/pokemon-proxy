'use strict';
// USAGE : node v2/migrations/rejouer-migration-credits.js --base=test_scratch --depuis=<backup-…/credits.json>
//   --depuis : la sauvegarde de la collection `credits` produite par backup-collections.js (JSON étendu, un tableau), faite PAR LE TESTEUR.
// Ce script REJOUE les trois gestes de la migration (héritage 1.0.x, rattachement des achats par l'adresse, fusion à la liaison) sur une COPIE de la sauvegarde,
// dans des collections de test PRÉFIXÉES de test_scratch (supprimées en sortant), et imprime somme(achetés) avant / après. Code 1 si elle ne se conserve pas.
// ⚠️ IL REFUSE TOUTE BASE AUTRE QUE test_scratch, --confirmer-production compris : la migration de production est ÉCRITE, JAMAIS LANCÉE ici.
const db = require('../db'); const He = require('../argent/heritage'); const F = require('../argent/fusion'); const M = require('../modeles');
const col = nom => db.col(nom);

// avant = somme des soldeScans de la sauvegarde ; après = ce qui reste sur les portefeuilles + ce qui est arrivé sur les comptes/installations fabriqués POUR CE REJEU.
// Un total qui BAISSE perd des crédits payés ; un total qui MONTE en fabrique : les deux sont une faute.
const codeDeSortie = ({ avant, apres }) => (apres === avant ? 0 : 1);

async function rejouer(docs, cfg, { rattacher = He.rattacherAchats, emailCle } = {}) {
    // La vraie emailCle est celle de B2. Absente (avant l'intégration), le REJEU — où les deux côtés de la comparaison sont fabriqués par lui — se rabat sur minuscules + espaces, et le DIT.
    let cle = emailCle || He.emailCleB2OuNull();
    if (!cle) { console.warn('⚠️ v2/comptes/email-cle.js (B2) absent : rejeu avec un repli (minuscules, espaces) — il ne prouve PAS la règle Gmail'); cle = b => (typeof b === 'string' && b.includes('@') ? b.trim().toLowerCase() : null); }
    const ids = docs.map(d => d.userId);
    await col('credits').insertMany(docs.map(d => ({ ...d, _id: undefined })).map(d => { delete d._id; return d; }));
    const installations = [], comptes = new Map(); let gratuitRepris = 0, gratuitAttendu = 0;
    for (const d of docs) {
        const inst = M.nouvelleInstallation({ jetonEmpreinte: `rejeu-${d.userId}`, essais: 0, libelle: 'rejeu' }); inst.essaisInitiaux = 0;
        await col('installations').insertOne(inst); installations.push(inst._id);
        const h = await He.reprendreHeritage({ userId: d.userId, installation: inst }, cfg);
        gratuitAttendu += Math.min(Math.max(0, d.soldeGratuit ?? 0), cfg.quotas.accueil); if (h.ok) gratuitRepris += h.essais;
        const k = d.email ? cle(d.email) : null;
        if (k && !comptes.has(k)) { const c = M.nouveauCompte({ email: d.email, emailCle: k, motDePasse: {} }); c.verifie = true; await col('comptes').insertOne(c); comptes.set(k, c._id); }
    }
    for (const compteId of comptes.values()) await rattacher({ compteId }, cfg, { emailCle: cle });
    for (const instId of installations) { const cid = [...comptes.values()][0]; if (cid) await F.fusionnerALaLiaison({ compteId: cid, installationId: instId }, cfg); }   // 3e geste : la fusion d'une installation sans achat ne doit rien déplacer
    const avant = docs.reduce((s, d) => s + Math.max(0, d.soldeScans ?? 0), 0);
    const reste = (await col('credits').find({ userId: { $in: ids } }).toArray()).reduce((s, d) => s + (d.soldeScans ?? 0), 0);
    const surComptes = (await col('comptes').find({ _id: { $in: [...comptes.values()] } }).toArray()).reduce((s, c) => s + (c.solde?.achete ?? 0), 0);
    const surInstallations = (await col('installations').find({ _id: { $in: installations } }).toArray()).reduce((s, i) => s + (i.achete ?? 0), 0);
    const apres = reste + surComptes + surInstallations;
    return { avant, apres, ok: apres === avant, portefeuilles: docs.length, comptes: comptes.size, rattachesSurComptes: surComptes, resteSurAnciens: reste, gratuitAttendu, gratuitRepris };
}
module.exports = { rejouer, codeDeSortie };

if (require.main === module) {
    require('dotenv').config();
    const fs = require('fs'); const mongoose = require('mongoose'); const { EJSON } = require('mongodb').BSON;
    const { baseDemandee, connecterMongo } = require('../../mongo-connexion'); const { lireConfig } = require('../config');
    (async () => {
        const arg = process.argv.find(a => a.startsWith('--depuis='));
        if (!arg) { console.error('❌ ARRÊT : --depuis=<sauvegarde credits.json> est obligatoire.'); process.exit(1); }
        if (baseDemandee() !== 'test_scratch') { console.error(`❌ ARRÊT : ce script ne tourne que sur test_scratch (base demandée : "${baseDemandee()}"). --confirmer-production n'y change rien.`); process.exit(1); }
        const docs = EJSON.parse(fs.readFileSync(arg.slice('--depuis='.length), 'utf8'), { relaxed: true });
        if (!Array.isArray(docs) || !docs.length) { console.error('❌ ARRÊT : la sauvegarde n\'est pas un tableau non vide (un rejeu de zéro portefeuille ne prouve rien).'); process.exit(1); }
        await connecterMongo({ script: 'v2/migrations/rejouer-migration-credits.js', ecrit: true });
        const prefixe = `rm_t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_`;
        db.definirPrefixe(prefixe); db.brancher(mongoose.connection.db);
        let code = 1;
        try {
            await M.creerIndex();
            const r = await rejouer(docs, lireConfig({ MONGODB_BASE: 'test_scratch' }));
            console.log(`${r.portefeuilles} portefeuilles rejoués, ${r.comptes} compte(s) fabriqué(s)`);
            console.log(`somme(achetés) avant : ${r.avant}`);
            console.log(`somme(achetés) après : ${r.apres}  (sur les comptes ${r.rattachesSurComptes}, restant sur les anciens portefeuilles ${r.resteSurAnciens})`);
            console.log(`essais repris : ${r.gratuitRepris} sur ${r.gratuitAttendu} attendus (plafond de la dotation)`);
            code = codeDeSortie(r);
            console.log(code ? '🔴 la somme des achetés NE SE CONSERVE PAS' : '✅ la somme des achetés se conserve');
        } finally { await db.viderPrefixe(); await mongoose.disconnect(); }
        process.exit(code);
    })().catch(e => { console.error('❌', e); process.exit(1); });
}

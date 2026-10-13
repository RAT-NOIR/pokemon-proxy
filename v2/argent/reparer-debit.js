'use strict';
// RÉPARER UN DÉBIT « rembourse » / « rendu-en-cours » SANS TRACE — l'outil de l'opérateur (MOYENS-B2a, tour 1, I-4). À côté de `reconcilier.js` : même garde de connexion (base NOMMÉE, refus d'une base inconnue,
// la production ne s'ouvre qu'avec --confirmer-production). Il appelle `reparerDebitRembourseSansMouvement` (argent/ledger.js), qui refait la preuve par le grand livre ; jamais d'écriture directe dans `mouvements`.
//
//   SIMULATION (défaut) : node v2/argent/reparer-debit.js --base=<nom> --porteur=compte:<id24>|installation:<id32> --scan=<id24> [--debit=<id24>]
//   EXÉCUTION           : … --executer --sauvegarde=<dossier>      (sauvegarde LOCALE du débit et des mouvements du scan AVANT toute écriture ; une ligne de journal par réparation)
//
// Codes de sortie : 0 simulation faite / réparation faite ; 1 garde de connexion (base inconnue, production sans confirmation) ; 2 arguments invalides (scan, porteur, --sauvegarde) ; 3 refus de la fonction (rien n'est écrit).
const fs = require('fs'); const path = require('path');
const db = require('../db');
const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const drapeau = nom => process.argv.includes(`--${nom}`);
const refus = (code, texte) => { console.error(`❌ ${texte}`); process.exit(code); };

// Les arguments se valident AVANT toute connexion. Un scan est un ObjectId (24 hexadécimaux) ; un compte aussi ; une installation est un identifiant de 32 hexadécimaux.
function lireArguments(ObjectId) {
    const scan = arg('scan'), porteur = arg('porteur'), debit = arg('debit');
    if (!scan || !/^[0-9a-f]{24}$/i.test(scan)) refus(2, `REFUS : --scan doit être un identifiant de 24 caractères hexadécimaux (reçu « ${scan === null ? 'rien' : String(scan).slice(0, 40)} »).`);
    const m = porteur && /^(compte|installation):([0-9a-f]+)$/i.exec(porteur);
    if (!m) refus(2, 'REFUS : --porteur=compte:<id de 24 hexadécimaux> ou --porteur=installation:<id de 32 hexadécimaux> est requis.');
    const type = m[1].toLowerCase();
    if (type === 'compte' && !/^[0-9a-f]{24}$/i.test(m[2])) refus(2, 'REFUS : porteur « compte » : l\'identifiant doit avoir 24 caractères hexadécimaux.');
    if (type === 'installation' && !/^[0-9a-f]{32}$/i.test(m[2])) refus(2, 'REFUS : porteur « installation » : l\'identifiant doit avoir 32 caractères hexadécimaux.');
    if (debit !== null && !/^[0-9a-f]{24}$/i.test(debit)) refus(2, 'REFUS : --debit doit être un identifiant de 24 caractères hexadécimaux.');
    return { scanId: new ObjectId(scan), debitId: debit ? new ObjectId(debit) : null, porteur: { type, id: type === 'compte' ? new ObjectId(m[2]) : m[2], surface: null } };
}
// N-3 : deux refus arrivent APRÈS la prise de la marque et peuvent avoir écrit le crédit — le texte ne dit jamais « rien d'écrit » pour eux
const APRES_PRISE = ['trace-non-ecrite', 'erreur-apres-prise'];
function texteDeRefus(r, delaiMin, journal) {
    if (!APRES_PRISE.includes(r.raison)) return `REFUS : ${r.raison} — rien n'a été écrit par la réparation.`;
    return `REFUS : ${r.raison} — le crédit ${r.creditRendu ? 'A ÉTÉ écrit' : 'a PEUT-ÊTRE été écrit'} ; la trace manque. NE PAS relancer avant ${delaiMin} min : la reprise refait la preuve sur le marqueur de la poche et n'écrit que la trace. (journal : ${journal})`;
}
const resume = r => `propre : ${r.propre ? 'oui' : 'non'} — écarts ${r.ecarts.length}, lignes au rendu non confirmé ${r.rendusEchoues.length}, débits « rembourse » sans mouvement ${r.debitsRembourseSansMouvement.length}, claims orphelines ${r.claimsOrphelines.length}, marques en suspens ${r.marquesEnSuspens.length}`;

if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    const { baseDemandee, BASE_PRODUCTION, connecterMongo } = require('../../mongo-connexion');
    (async () => {
        const { scanId, debitId, porteur } = lireArguments(mongoose.Types.ObjectId);
        const executer = drapeau('executer'), dossier = arg('sauvegarde');
        if (executer && !dossier) refus(2, 'REFUS : --executer exige --sauvegarde=<dossier> (la sauvegarde locale du débit et des mouvements du scan est écrite AVANT toute écriture).');
        // le refus se décide AVANT toute connexion : la production se nomme ET se confirme
        if (baseDemandee() === BASE_PRODUCTION && !drapeau('confirmer-production')) refus(1, `ARRÊT : la base "${BASE_PRODUCTION}" est la PRODUCTION. Relance avec --confirmer-production si c'est voulu.`);
        const nomBase = await connecterMongo({ script: 'v2/argent/reparer-debit.js', ecrit: executer });
        const p = arg('prefixe');
        if (p) { if (nomBase !== 'test_scratch') refus(1, '--prefixe n\'est permis que sur test_scratch'); db.definirPrefixe(p); }
        db.brancher(mongoose.connection.db);
        const { lireConfig } = require('../config'); const cfg = lireConfig(process.env);
        const Lg = require('./ledger'); const R = require('./reconcilier');
        const maintenant = new Date();
        const col = n => db.col(n);
        const filtrePorteur = porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id };
        // ── la preuve, imprimée
        const debits = await col('mouvements').find({ ...filtrePorteur, type: 'debit', scanId }).toArray();
        const mouvements = await col('mouvements').find({ scanId }).toArray();
        console.log(`porteur ${porteur.type}:${porteur.id}  scan ${scanId}`);
        console.log(`débits du scan (${debits.length}) :`); for (const d of debits) console.log(`  débit ${d._id}  état ${d.etat}  poche ${d.credit ? d.credit.poche : '-'}  clé ${d.cleIdempotence ? 'oui' : 'non'}  le ${new Date(d.le).toISOString()}${d.reparation ? '  marque reparation' : ''}`);
        console.log(`mouvements du scan (${mouvements.length}) :`); for (const m of mouvements) console.log(`  ${m.type}  delta ${m.delta}  état ${m.etat}  clé ${String(m.cleIdempotence || '-').slice(0, 40)}  le ${new Date(m.le).toISOString()}`);
        console.log(`délai d'attente effectif : ${Math.round(cfg.lot.reparationAgeMs / 60e3)} min (V2_REPARATION_AGE_MIN, entier de 5 à 1440, défaut 15) — un débit pris, un mouvement de la poche ou un remboursement du scan plus récents refusent`);
        const avant = await R.reconcilier(porteur, { cfg, maintenant });
        console.log(`réconciliation AVANT : ${avant.porteur && avant.debitsRembourseSansMouvement ? resume(avant) : 'porteur introuvable'}`);
        const sim = await Lg.reparerDebitRembourseSansMouvement(porteur, { scanId, debitId, maintenant, simuler: true }, cfg);
        if (!sim.simulation) { console.log(`REFUS : ${sim.raison}${sim.ecart !== undefined ? ` (écart de poche ${sim.ecart})` : ''} — rien n'est écrit.`); await mongoose.disconnect(); process.exit(3); }
        // la preuve LIT LE DÉBIT (marqueur de poche, trace) ; l'écart de poche n'est qu'un témoin, sauf pour un débit d'avant le tour 2 sans preuve propre
        console.log(`preuve : crédit de CE débit ${sim.preuve.credit ? 'présent sur la poche' : 'ABSENT de la poche'}, trace ${sim.preuve.trace ? 'présente' : 'absente'} — mode ${sim.preuve.mode}${sim.ecart === null || sim.ecart === undefined ? '' : ` — écart de poche (témoin) : ${sim.ecart}`}`);
        console.log(`verdict : ${sim.verdict}${sim.verdict === 'a-clore' ? ' — les traces existent : la ligne sera close en « rembourse »' : (sim.creditRendu ? ' — le crédit n\'a pas été rendu : il sera rendu ET tracé' : ' — le crédit est sur la poche sans sa trace : la trace seule sera écrite')}`);
        if (!executer) { console.log('SIMULATION : rien n\'est écrit. Relance avec --executer --sauvegarde=<dossier> pour réparer.'); await mongoose.disconnect(); process.exit(0); }
        // ── la sauvegarde LOCALE avant toute écriture
        fs.mkdirSync(dossier, { recursive: true });
        const { EJSON } = mongoose.mongo.BSON;
        const nomSauv = `sauvegarde-${String(scanId)}-${maintenant.toISOString().replace(/[:.]/g, '-')}.json`;
        // N-4 : le porteur (solde de ses poches, marqueurs `creditsRendus`) et la marque de livraison sont sauvegardés AVEC les débits et les mouvements — de quoi restaurer sans calcul
        const champs = { essais: 1, essaisInitiaux: 1, achete: 1, solde: 1, abonnement: 1, compteId: 1, creditsRendus: 1 };
        const porteurDoc = await col(porteur.type === 'compte' ? 'comptes' : 'installations').findOne({ _id: porteur.id }, { projection: champs });
        const marque = await col('scans_en_cours').findOne({ _id: scanId });
        fs.writeFileSync(path.join(dossier, nomSauv), JSON.stringify({ le: maintenant.toISOString(), base: nomBase, porteur: `${porteur.type}:${porteur.id}`, scanId: String(scanId), debits: EJSON.serialize(debits), mouvements: EJSON.serialize(mouvements), porteurDoc: EJSON.serialize(porteurDoc), marque: EJSON.serialize(marque) }, null, 1));
        console.log(`sauvegarde locale : ${path.join(dossier, nomSauv)}`);
        const r = await Lg.reparerDebitRembourseSansMouvement(porteur, { scanId, debitId, maintenant }, cfg);
        const apres = await R.reconcilier(porteur, { cfg, maintenant: new Date() });
        console.log(`réconciliation APRÈS : ${apres.debitsRembourseSansMouvement ? resume(apres) : 'porteur introuvable'}`);
        const journaliser = extra => fs.appendFileSync(path.join(dossier, 'journal-reparations.jsonl'), JSON.stringify({ le: maintenant.toISOString(), base: nomBase, porteur: `${porteur.type}:${porteur.id}`, scanId: String(scanId), debit: sim.debits.map(String), verdict: sim.verdict, ecart: sim.ecart, creditRendu: r.creditRendu, sauvegarde: nomSauv, ...extra }) + '\n');
        if (!r.repare) {
            // N-3 : un refus APRÈS la prise peut avoir écrit le crédit (`trace-non-ecrite`, `erreur-apres-prise`) : il se dit et se journalise, il n'est PAS « rien d'écrit »
            if (APRES_PRISE.includes(r.raison)) journaliser({ refus: r.raison, creditPeutEtreEcrit: true });
            console.log(texteDeRefus(r, Math.round(cfg.lot.reparationAgeMs / 60e3), path.join(dossier, 'journal-reparations.jsonl')));
            await mongoose.disconnect(); process.exit(3);
        }
        journaliser({});
        console.log(`RÉPARÉ : ${r.creditRendu ? 'crédit rendu et tracé' : (sim.verdict === 'a-clore' ? 'ligne close' : 'trace écrite')} (journal : ${path.join(dossier, 'journal-reparations.jsonl')})`);
        await mongoose.disconnect(); process.exit(0);
    })().catch(e => { console.error('❌', e); process.exit(1); });
}
module.exports = { lireArguments, texteDeRefus };

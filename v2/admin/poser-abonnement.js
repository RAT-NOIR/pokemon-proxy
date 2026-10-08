'use strict';
// USAGE : node v2/admin/poser-abonnement.js --base=test_scratch --email=<adresse> --quota=<N par mois> --jusqu-au=AAAA-MM-JJ
//         (production : --base=test --confirmer-production — à ne lancer que sur décision du testeur)
// Pose un abonnement mensuel à la main (le paiement n'est pas branché). Refuse une adresse inconnue ; n'imprime que l'adresse MASQUÉE.
require('dotenv').config();
const mongoose = require('mongoose'); const db = require('../db');
const { baseDemandee, BASE_PRODUCTION, connecterMongo } = require('../../mongo-connexion');
const { activerAbonnement } = require('../argent/abonnement'); const { masquer } = require('../argent/solde'); const He = require('../argent/heritage');
const opt = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const stop = m => { console.error(`❌ ARRÊT : ${m}`); process.exit(1); };
(async () => {
    // tout ce qui se vérifie SANS base se vérifie avant d'en ouvrir une
    if (baseDemandee() === BASE_PRODUCTION && !process.argv.includes('--confirmer-production')) stop(`la base "${BASE_PRODUCTION}" est la PRODUCTION : relance avec --confirmer-production.`);
    const email = opt('email'), quota = Number(opt('quota')), jusqu = opt('jusqu-au');
    if (!email) stop('--email obligatoire.');
    if (!Number.isInteger(quota) || quota < 1) stop('--quota doit être un entier ≥ 1.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jusqu || '') || Number.isNaN(new Date(`${jusqu}T00:00:00Z`).getTime())) stop('--jusqu-au doit être une date AAAA-MM-JJ.');
    const jusquAu = new Date(`${jusqu}T00:00:00Z`);
    await connecterMongo({ script: 'v2/admin/poser-abonnement.js', ecrit: true, confirmationProduction: true });
    const p = opt('prefixe'); if (p) db.definirPrefixe(p);
    db.brancher(mongoose.connection.db);
    let code = 1;
    try {
        let cle = He.emailCleB2OuNull();
        if (!cle) { console.warn('⚠️ v2/comptes/email-cle.js (B2) absent : recherche par minuscules + espaces seulement'); cle = b => b.trim().toLowerCase(); }
        const compte = await db.col('comptes').findOne({ emailCle: cle(email) });
        if (!compte) console.error(`❌ aucun compte pour l'adresse ${masquer(email)} : rien n'a été écrit.`);
        else {
            const r = await activerAbonnement(compte._id, { quotaMensuel: quota, jusquAu });
            console.log(r.ok ? `✅ abonnement de ${quota}/mois posé sur le compte ${masquer(compte.email)} jusqu'au ${jusqu}` : `❌ écriture sans effet pour ${masquer(compte.email)}`);
            code = r.ok ? 0 : 1;
        }
    } finally { await mongoose.disconnect(); }
    process.exit(code);
})().catch(e => { console.error('❌', e); process.exit(1); });

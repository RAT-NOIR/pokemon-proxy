'use strict';
// Pose ou retire le rôle administrateur d'un compte. SCRIPT SEUL : aucune route ne l'importe, aucune route ne pose `role`.
//   node v2/admin/poser-role.js --base=test_scratch --email=<adresse> --role=administrateur|aucun
//   node v2/admin/poser-role.js --base=test --confirmer-production --email=<adresse> --role=administrateur
// Imprime l'adresse MASQUÉE, jamais entière. Ce plan ne lance jamais ce script sur la production.
const { col } = require('../db');

const ROLES = Object.freeze(['administrateur', 'aucun']);

/** @param {string} emailCle  clé normalisée (minuscules, Gmail sans points ni +étiquette) @param {'administrateur'|'aucun'} role */
async function poserRole(emailCle, role) {
    if (!ROLES.includes(role)) throw new Error(`rôle refusé : doit être l'un de ${ROLES.join(' | ')}`);
    if (typeof emailCle !== 'string' || !emailCle) throw new Error('emailCle : chaîne non vide requise');   // jamais un objet : ce serait un filtre Mongo
    const maj = role === 'administrateur' ? { $set: { role } } : { $unset: { role: '' } };
    const r = await col('comptes').updateOne({ emailCle }, maj);
    if (r.matchedCount !== 1) return { modifie: false, raison: 'compte-inconnu' };
    return { modifie: true, inchange: r.modifiedCount === 0 };
}

function masquer(adresse) {
    const [local = '', domaine = ''] = String(adresse).split('@');
    const [hote = '', ...suite] = domaine.split('.');
    return `${local.slice(0, 1)}***@${hote.slice(0, 1)}***${suite.length ? '.' + suite.join('.') : ''}`;
}
function normaliser(email) {
    try { const f = require('../comptes/email-cle'); const g = f.emailCle || f.normaliser || f; if (typeof g === 'function') return g(email); console.warn('⚠️ comptes/email-cle sans fonction exploitable : normalisation MINIMALE (minuscules) — un Gmail à points ne sera pas trouvé.'); }
    catch (e) { console.warn(`⚠️ comptes/email-cle indisponible (${e.code || e.name}) : normalisation MINIMALE (minuscules) — un Gmail à points ne sera pas trouvé.`); }
    return String(email).trim().toLowerCase();
}
const valeur = (argv, nom) => { const a = argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3).trim() : null; };

async function main(argv, deps = {}) {
    const ecrire = deps.ecrire || (s => console.log(s));
    const base = valeur(argv, 'base'), email = valeur(argv, 'email'), role = valeur(argv, 'role');
    if (!base) { ecrire('❌ --base=<nom> requis (je ne devine pas la base).'); return 1; }
    if (!email || !ROLES.includes(role)) { ecrire(`❌ usage : --base=<nom> --email=<adresse> --role=${ROLES.join('|')}`); return 1; }
    if (base === 'test' && !argv.includes('--confirmer-production')) { ecrire('❌ base "test" = PRODUCTION : exige --confirmer-production. Rien n\'a été fait.'); return 1; }
    const connecter = deps.connecter || (() => require('../../mongo-connexion').connecterMongo({ script: 'v2/admin/poser-role.js', ecrit: true, confirmationProduction: true }));
    const reelle = await connecter({ script: 'v2/admin/poser-role.js', ecrit: true, confirmationProduction: true });
    if (reelle !== base) { ecrire(`❌ base connectée "${reelle}" ≠ "${base}" demandée.`); return 1; }
    const r = await poserRole(normaliser(email), role);
    if (!r.modifie) { ecrire(`❌ ${masquer(email)} : ${r.raison}`); return 1; }
    ecrire(`✅ ${masquer(email)} : rôle ${role === 'aucun' ? 'retiré' : role}${r.inchange ? ' (déjà ainsi)' : ''} — base ${reelle}`);
    return 0;
}

if (require.main === module) {
    require('dotenv').config();
    main(process.argv.slice(2))
        .then(code => { require('mongoose').disconnect().finally(() => process.exit(code)); })
        .catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
module.exports = { poserRole, main, masquer, ROLES };

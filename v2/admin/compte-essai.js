'use strict';
// COMPTE-ESSAI — outil LOCAL, lancé par le testeur lui-même, qui crée SON compte administrateur sur la base du service de TEST et lui donne un code de liaison pour l'extension.
//   node v2/admin/compte-essai.js --base=rm_essai                (création : adresse, mot de passe masqué deux fois ; compte confirmé + administrateur + code)
//   node v2/admin/compte-essai.js --base=rm_essai --reprendre    (compte déjà confirmé de cette adresse : rôle et code seulement, le mot de passe ne change pas)
//   node v2/admin/compte-essai.js --base=rm_essai --code         (un code neuf pour un compte existant, après vérification du mot de passe)
// Écrit par ce qu'il AUTORISE : les seuls arguments admis sont ci-dessus ; la seule base admise est rm_essai ; il n'existe AUCUNE option pour la production.
// Rien d'écrit à la main qui diverge du service : le document vient de nouveauCompte (modeles), le hachage et la politique de mots-de-passe, la clé d'adresse de email-cle,
// le rôle de poser-role, le code de liaison.creerCode (la fonction de POST /api/compte/code). Aucune URI, aucun hôte, aucun message de pilote, jamais le mot de passe, à l'écran.
const M = require('../modeles'); const P = require('../comptes/mots-de-passe'); const { emailCle } = require('../comptes/email-cle');
const liaison = require('../installations/liaison'); const roleAdmin = require('./poser-role');
const { ACTIONS_DE_LECTURE } = require('../chargeur/lecture-seule');
const { lireConfig } = require('../config'); const { col } = require('../db');

const BASE_ESSAI = 'rm_essai';
// Ce qu'un rôle readWrite ajoute à la lecture. Toute autre action (administration, utilisateurs, grappe, arrêt…) refuse.
const ACTIONS_ECRITURE_ESSAI = Object.freeze(new Set([...ACTIONS_DE_LECTURE, 'convertToCapped', 'createCollection', 'createIndex', 'dropCollection', 'dropIndex', 'insert', 'remove', 'renameCollectionSameDB', 'update', 'compact', 'collMod']));
const MSG_IDENTIFIANTS = 'Adresse inconnue, compte non confirmé ou mot de passe incorrect. Rien n\'a été fait.';

/** Arguments : seuls --base=rm_essai, --reprendre, --code (jamais les deux). Ne répète jamais un argument refusé. → { ok, reprendre, code } | { ok:false, raison } */
function lireArgs(argv) {
    if (!Array.isArray(argv)) return { ok: false, raison: 'arguments illisibles' };
    let base = null, reprendre = false, code = false, bases = 0;
    for (const a of argv) {
        if (typeof a === 'string' && a.startsWith('--base=')) { bases++; base = a.slice(7); }
        else if (a === '--reprendre') reprendre = true;
        else if (a === '--code') code = true;
        else return { ok: false, raison: 'argument non reconnu (seuls --base=rm_essai, --reprendre et --code existent)' };
    }
    if (bases !== 1) return { ok: false, raison: `une et une seule base : --base=${BASE_ESSAI}` };
    if (base !== BASE_ESSAI) return { ok: false, raison: `seule la base ${BASE_ESSAI} est admise : cet outil n'a aucune option pour une autre base` };
    if (reprendre && code) return { ok: false, raison: '--reprendre et --code ne se combinent pas' };
    return { ok: true, reprendre, code };
}

/** La preuve CÔTÉ SERVEUR (connectionStatus, privilèges inclus) : écrite par ce qu'elle autorise. Tout doute refuse. Pure. → { ok } | { ok:false, raison } */
function jugerPrivileges(statut, base = BASE_ESSAI) {
    const info = statut && typeof statut === 'object' ? statut.authInfo : null;
    if (!info || typeof info !== 'object') return { ok: false, raison: 'connectionStatus sans authInfo : je ne sais pas ce que cet utilisateur peut faire' };
    if (!Array.isArray(info.authenticatedUsers) || info.authenticatedUsers.length === 0) return { ok: false, raison: 'aucun utilisateur authentifié : je ne sais pas qui écrit' };
    const roles = info.authenticatedUserRoles;
    if (!Array.isArray(roles) || roles.length === 0) return { ok: false, raison: 'aucun rôle lisible : je ne sais pas ce que cet utilisateur peut faire' };
    for (const r of roles) {
        const ok = r && typeof r === 'object' && typeof r.role === 'string' && typeof r.db === 'string' && ((r.role === 'readWrite' && r.db === base) || r.role === 'read');
        if (!ok) return { ok: false, raison: `rôle « ${r && typeof r.role === 'string' ? r.role.slice(0, 30) : '?'} » hors de la liste admise (readWrite sur ${base}, ou read)` };
    }
    const privileges = info.authenticatedUserPrivileges;
    if (!Array.isArray(privileges) || privileges.length === 0) return { ok: false, raison: 'aucun privilège lisible : je ne sais pas ce que cet utilisateur peut faire' };
    const vues = new Set();
    for (const p of privileges) {
        if (!p || typeof p !== 'object' || !Array.isArray(p.actions) || p.actions.length === 0) return { ok: false, raison: 'un privilège sans liste d\'actions lisible : refus' };
        const res = p.resource && typeof p.resource === 'object' ? p.resource : null;
        for (const a of p.actions) if (typeof a !== 'string') return { ok: false, raison: 'une action illisible dans un privilège : refus' };
        if (p.actions.every(a => ACTIONS_DE_LECTURE.includes(a))) continue;   // lecture seule, où que ce soit : sans danger
        if (!res || res.cluster || res.anyResource || res.db !== base || typeof res.collection !== 'string') return { ok: false, raison: `une action d'écriture ou d'administration ailleurs que sur ${base} : refus` };
        for (const a of p.actions) {
            if (!ACTIONS_ECRITURE_ESSAI.has(a)) return { ok: false, raison: `action « ${a.slice(0, 40)} » hors de la liste d'un simple readWrite : cet utilisateur peut faire plus` };
            vues.add(a);
        }
    }
    if (!vues.has('insert') || !vues.has('update')) return { ok: false, raison: `cet utilisateur n'a pas le droit d'écrire sur ${base}` };
    return { ok: true };
}

/** Saisie réelle : l'adresse en clair, le mot de passe MASQUÉ (aucun écho). Sans terminal interactif, le mot de passe est refusé : il ne se lit jamais en clair. */
function saisieTerminal({ entree = process.stdin, sortie = process.stdout } = {}) {
    const readline = require('readline'); const { Writable } = require('stream');
    let rl = null, muet = false, attente = null;
    const ouvrir = () => {
        if (rl) return rl;
        const out = new Writable({ write(c, e, cb) { if (!muet) sortie.write(c, e); cb(); } });
        rl = readline.createInterface({ input: entree, output: out, terminal: Boolean(entree.isTTY) });
        rl.on('close', () => { if (attente) { const a = attente; attente = null; a(new Error('saisie interrompue')); } });
        return rl;
    };
    const lire = (question, masque) => new Promise((resolve, reject) => {
        const r = ouvrir(); attente = reject;
        const fin = reponse => { attente = null; muet = false; if (masque) sortie.write('\n'); resolve(reponse); };
        if (masque) { sortie.write(question); muet = true; r.question('', fin); } else r.question(question, fin);
    });
    return {
        ligne: q => lire(q, false),
        secret: async q => { if (!entree.isTTY) throw new Error('terminal interactif requis : le mot de passe ne se saisit que masqué, jamais lu en clair'); return lire(q, true); },
        fermer: () => { if (rl) rl.close(); }
    };
}

async function connecterReel() {
    const mongoose = require('mongoose');
    const nom = await require('../../mongo-connexion').connecterMongo({ script: 'v2/admin/compte-essai.js', ecrit: true });   // base non vide exigée (§50) ; rm_essai -> MONGODB_ESSAI_URI
    const db = mongoose.connection.db;
    if (nom !== BASE_ESSAI || !db || db.databaseName !== BASE_ESSAI) throw Object.assign(new Error('base connectée différente de la base demandée'), { name: 'BaseInattendue' });
    return { base: nom, db, fermer: () => mongoose.disconnect() };
}

const heureLocale = d => d.toLocaleTimeString('fr-FR', { hour12: false });

async function main(argv, deps = {}) {
    const ecrire = deps.ecrire || (s => console.log(s)), ecrireErreur = deps.ecrireErreur || (s => console.error(s));
    const refuser = m => { ecrireErreur(`REFUS : ${m}`); return 1; };
    const a = lireArgs(argv);
    if (!a.ok) return refuser(a.raison);                                       // AVANT toute connexion
    const saisie = deps.saisie || saisieTerminal();
    let cx = null;
    try {
        cx = await (deps.connecter || connecterReel)();
        if (!cx || cx.base !== BASE_ESSAI || !cx.db) return refuser(`la connexion n'est pas sur ${BASE_ESSAI} : rien n'a été fait`);
        let collections;
        try { collections = await cx.db.listCollections().toArray(); } catch (e) { return refuser('impossible de lister les collections de la base : rien n\'a été fait'); }
        if (!Array.isArray(collections) || collections.length === 0) return refuser(`la base ${BASE_ESSAI} est VIDE (elle doit contenir le catalogue copié) : on n'est pas sur la bonne base. Rien n'a été fait.`);
        let st = null;
        try { st = await (deps.statut ? deps.statut() : cx.db.admin().command({ connectionStatus: 1, showPrivileges: true })); }
        catch (e) { return refuser('connectionStatus a échoué : je ne peux pas prouver que cet utilisateur n\'écrit que sur la base de test. Rien n\'a été fait.'); }
        const p = jugerPrivileges(st, BASE_ESSAI);
        if (!p.ok) return refuser(`privilèges non prouvés — ${p.raison}. Rien n'a été fait.`);
        ecrire(`Base ${BASE_ESSAI} : non vide, utilisateur limité à l'écriture sur ${BASE_ESSAI} (prouvé côté serveur).`);

        const brut = String(await saisie.ligne('Adresse du compte : ')).normalize('NFKC').trim();
        const cle = brut.length <= 254 ? emailCle(brut) : null;
        if (!cle) return refuser('adresse illisible. Rien n\'a été fait.');
        const masque = roleAdmin.masquer(brut);
        const cfg = deps.cfg || lireConfig({});
        const maintenant = deps.maintenant ? deps.maintenant() : new Date();
        let compte;

        if (a.reprendre || a.code) {                                           // compte existant : le mot de passe est VÉRIFIÉ, jamais changé
            const mdp = await saisie.secret('Mot de passe du compte (masqué) : ');
            const trouve = await col('comptes').findOne({ emailCle: cle });
            const bon = trouve ? await P.verifier(mdp, trouve.motDePasse) : await P.verifierFactice(mdp);
            if (!trouve || !bon || trouve.verifie !== true) return refuser(MSG_IDENTIFIANTS);
            compte = trouve;
            if (a.reprendre) {
                const r = await roleAdmin.poserRole(cle, 'administrateur');
                if (!r.modifie) return refuser('le rôle n\'a pas pu être posé');
                ecrire(`Compte ${masque} repris : rôle administrateur posé, mot de passe inchangé.`);
            }
        } else {                                                               // création
            if (await col('comptes').findOne({ emailCle: cle })) return refuser(`cette adresse a déjà un compte. Pour reprendre un compte confirmé : --base=${BASE_ESSAI} --reprendre. Rien n'a été fait.`);
            const mdp = await saisie.secret('Mot de passe (masqué) : ');
            const faute = P.politique(mdp, cle);                               // la fonction de la route d'inscription
            if (faute) return refuser(`mot de passe refusé par la politique (${faute}). Rien n'a été fait.`);
            const mdp2 = await saisie.secret('Mot de passe, une seconde fois (masqué) : ');
            if (mdp2 !== mdp) return refuser('les deux saisies du mot de passe diffèrent. Rien n\'a été fait.');
            const doc = M.nouveauCompte({ email: brut, emailCle: cle, motDePasse: await P.hacher(mdp), now: maintenant });
            doc.verifie = true; doc.verifieLe = maintenant;                    // déjà confirmé : le testeur ne peut pas suivre le parcours normal pendant l'allumage de TEST
            try { await col('comptes').insertOne(doc); }
            catch (e) { return refuser(e && e.code === 11000 ? 'cette adresse a déjà un compte. Rien n\'a été fait.' : `écriture du compte impossible (${(e && e.name) || 'erreur'}). Rien n'a été fait.`); }
            compte = doc;
            const r = await roleAdmin.poserRole(cle, 'administrateur');
            if (!r.modifie) return refuser(`le compte ${masque} est créé mais le rôle n'a pas pu être posé : relancer avec --reprendre`);
            ecrire(`Compte ${masque} créé : confirmé, administrateur (ses scans sont gratuits).`);
        }

        const c = await liaison.creerCode(compte._id, cfg, undefined, Number.isInteger(compte.generation) ? compte.generation : null);   // la fonction de POST /api/compte/code
        if (c.refus) return refuser(`trop de codes en cours pour ce compte : réessayer dans ${c.reessayerDans} s (le compte est prêt, aucun code n'a été délivré)`);
        ecrire(`Code de liaison : ${c.code}`);
        ecrire(`Il expire à ${heureLocale(new Date(c.expire))} (heure locale) — ${c.expire} — et ne sert qu'une fois. Tapez-le dans l'extension. Il ne sera pas réaffiché.`);
        return 0;
    } catch (e) {
        return refuser(`arrêt sur erreur (${(e && (e.codeName || e.code || e.name)) || 'erreur'}) : je n'affiche jamais le message du pilote. Relire l'état avant de relancer.`);
    } finally {
        try { if (saisie.fermer) saisie.fermer(); } catch { /* terminal déjà fermé */ }
        try { if (cx && cx.fermer) await cx.fermer(); } catch { /* connexion déjà fermée */ }
    }
}

if (require.main === module) {
    require('dotenv').config();
    main(process.argv.slice(2)).then(code => process.exit(code)).catch(e => { console.error(`❌ ${(e && e.name) || 'erreur'}`); process.exit(1); });
}
module.exports = { main, jugerPrivileges, saisieTerminal, lireArgs, BASE_ESSAI };

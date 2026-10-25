'use strict';
// COMPTE-ESSAI — outil LOCAL, lancé par le testeur lui-même, qui crée SON compte administrateur sur la base du service de TEST et lui donne un code de liaison pour l'extension.
//   node v2/admin/compte-essai.js --base=rm_essai                (création : adresse, mot de passe masqué deux fois ; compte confirmé + administrateur + code)
//   node v2/admin/compte-essai.js --base=rm_essai --reprendre    (compte déjà confirmé de cette adresse : rôle et code seulement, le mot de passe ne change pas)
//   node v2/admin/compte-essai.js --base=rm_essai --code         (un code neuf pour un compte existant, après vérification du mot de passe)
//   node v2/admin/compte-essai.js --base=rm_essai --banc         (NON interactif : le compte « banc-mesure@rat-market.invalid », confirmé, administrateur, marqué `banc: true`, mot de passe GÉNÉRÉ ; les deux identifiants
//                                                                  V2_ESSAI_BANC_IDENTIFIANT et V2_ESSAI_BANC_MOT_DE_PASSE sont écrits dans le .env de l'agent API — ces deux lignes seulement — et jamais affichés)
//   node v2/admin/compte-essai.js --base=rm_essai --banc --reprendre   (le compte existe déjà : mot de passe régénéré, sessions d'avant révoquées)
// Écrit par ce qu'il AUTORISE : les seuls arguments admis sont ci-dessus ; la seule base admise est rm_essai ; il n'existe AUCUNE option pour la production.
// Rien d'écrit à la main qui diverge du service : le document vient de nouveauCompte (modeles), le hachage et la politique de mots-de-passe, la clé d'adresse de email-cle,
// le rôle de poser-role, le code de liaison.creerCode (la fonction de POST /api/compte/code). Aucune URI, aucun hôte, aucun message de pilote, jamais le mot de passe, à l'écran.
// LA CIBLE SE PROUVE par v2/migrations/preuve-cible.js, le MÊME module qu'amorcer-essai.js (une seule règle de sécurité, la plus stricte des deux) : hôtes, connectionStatus, setName.
const M = require('../modeles'); const P = require('../comptes/mots-de-passe'); const { emailCle } = require('../comptes/email-cle');
const liaison = require('../installations/liaison'); const roleAdmin = require('./poser-role');
const PC = require('../migrations/preuve-cible');
const { lireConfig } = require('../config'); const { col } = require('../db');

const BASE_ESSAI = 'rm_essai';
const MSG_IDENTIFIANTS = 'Adresse inconnue, compte non confirmé ou mot de passe incorrect. Rien n\'a été fait.';

/** Une erreur dont le message est FIXE et sûr (jamais celui d'un pilote) : c'est le seul message d'erreur que l'outil affiche tel quel. */
class ErreurSaisie extends Error { constructor(message) { super(message); this.name = 'ErreurSaisie'; this.sure = true; } }

/** Arguments : seuls --base=rm_essai, --reprendre, --code (jamais les deux) et --banc (non interactif, avec ou sans --reprendre). Ne répète jamais un argument refusé. → { ok, reprendre, code, banc } | { ok:false, raison } */
function lireArgs(argv) {
    if (!Array.isArray(argv)) return { ok: false, raison: 'arguments illisibles' };
    let base = null, reprendre = false, code = false, banc = false, bases = 0;
    for (const a of argv) {
        if (typeof a === 'string' && a.startsWith('--base=')) { bases++; base = a.slice(7); }
        else if (a === '--reprendre') reprendre = true;
        else if (a === '--code') code = true;
        else if (a === '--banc') banc = true;
        else return { ok: false, raison: 'argument non reconnu (seuls --base=rm_essai, --reprendre, --code et --banc existent)' };
    }
    if (bases !== 1) return { ok: false, raison: `une et une seule base : --base=${BASE_ESSAI}` };
    if (base !== BASE_ESSAI) return { ok: false, raison: `seule la base ${BASE_ESSAI} est admise : cet outil n'a aucune option pour une autre base` };
    if (reprendre && code) return { ok: false, raison: '--reprendre et --code ne se combinent pas' };
    if (banc && code) return { ok: false, raison: '--banc et --code ne se combinent pas (le compte de mesure ne se lie à aucune extension)' };
    return { ok: true, reprendre, code, banc };
}

// ── LE COMPTE DE MESURE (25/10) : non interactif, sur l'essai seulement. Il porte `banc: true` (ses scans sont marqués « banc » au journal et exclus des statistiques d'usage) et ses deux identifiants vont DANS le .env, jamais à l'écran.
const ADRESSE_BANC = 'banc-mesure@rat-market.invalid';                       // domaine réservé (RFC 2606) : aucun courriel ne peut en partir ni y arriver
const NOM_IDENTIFIANT = 'V2_ESSAI_BANC_IDENTIFIANT', NOM_MOT_DE_PASSE = 'V2_ESSAI_BANC_MOT_DE_PASSE';
const ENV_REEL = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\.env';      // l'environnement de l'agent API ; un banc injecte `deps.fichierEnv` (un fichier FACTICE), jamais celui-ci

/** Un mot de passe tiré au hasard (crypto), 32 caractères URL-sûrs (A-Za-z0-9_-) : conforme à la politique (10 à 200, différent de l'adresse). */
function genererMotDePasse(octets = require('crypto').randomBytes(24)) { return Buffer.from(octets).toString('base64url'); }

/**
 * Réécrit le .env en ne touchant QUE les deux lignes nommées : remplacées en place si elles existent (les doublons des deux noms sont retirés), ajoutées en fin sinon. Toute autre ligne reste octet pour octet
 * (fins de ligne comprises). Écriture atomique (fichier voisin puis renommage). Un .env absent est REFUSÉ (on ne crée pas l'environnement d'un autre). Ne renvoie jamais une valeur.
 * @returns {{ remplacees: number, ajoutees: number }}
 */
function ecrireEnv(fichier, paires, { fs = require('fs'), path = require('path') } = {}) {
    if (!fs.existsSync(fichier)) throw new ErreurSaisie('le fichier d\'environnement n\'existe pas : rien n\'est écrit');
    const noms = Object.keys(paires);
    const texte = fs.readFileSync(fichier, 'utf8');
    const fin = texte.includes('\r\n') ? '\r\n' : '\n';
    const lignes = texte.split(/\r?\n/);
    const vues = new Set(); let remplacees = 0; const sortie = [];
    for (const l of lignes) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
        if (m && noms.includes(m[1])) { if (vues.has(m[1])) continue; vues.add(m[1]); sortie.push(`${m[1]}=${paires[m[1]]}`); remplacees++; }
        else sortie.push(l);
    }
    let ajoutees = 0;
    const dernierVide = sortie.length > 0 && sortie[sortie.length - 1] === '';
    if (dernierVide) sortie.pop();
    for (const n of noms) if (!vues.has(n)) { sortie.push(`${n}=${paires[n]}`); ajoutees++; }
    if (dernierVide || texte === '' || ajoutees > 0) sortie.push('');
    const tmp = path.join(path.dirname(fichier), `.env.ecriture-${process.pid}.tmp`);
    fs.writeFileSync(tmp, sortie.join(fin), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, fichier);
    return { remplacees, ajoutees };
}

/**
 * Saisie réelle, SANS readline : l'adresse s'affiche (ce n'est pas un secret), le mot de passe n'est JAMAIS écrit, sous aucune forme.
 *  · le terminal passe en mode brut (donc muet : le système n'écho plus) AVANT que la moindre invite soit écrite ;
 *  · ce qui est tapé alors qu'aucune question n'est posée est MIS EN FILE, jamais affiché ; la question secrète suivante le consomme (un collage « mot de passe, Entrée, mot de passe, Entrée »
 *    sert donc à la confirmation) ; la question d'adresse l'écarte ;
 *  · Ctrl+C, Ctrl+D et la fin de l'entrée refusent par « saisie interrompue » ; sans terminal interactif, le mot de passe est REFUSÉ (jamais lu en clair).
 */
function saisieTerminal({ entree = process.stdin, sortie = process.stdout } = {}) {
    const interactif = entree.isTTY === true && typeof entree.setRawMode === 'function';
    let ouvert = false, fini = false, courant = null, ignorerLF = false, echap = 0;
    const file = [];
    const interrompue = () => new ErreurSaisie('saisie interrompue');
    const finir = (erreur) => { fini = true; const c = courant; courant = null; if (c && erreur) c.reject(erreur); };
    const traiter = ch => {
        const c = courant;
        if (echap) {                                              // séquence d'échappement (flèches, Suppr…) : ignorée jusqu'à son octet final
            if (echap === 1) { echap = (ch === '[' || ch === 'O') ? 2 : 0; return; }
            if (/[A-Za-z~]/.test(ch)) echap = 0; return;
        }
        if (ch === '\x03' || ch === '\x04') { sortie.write('\n'); finir(interrompue()); return; }
        if (ch === '\x1b') { echap = 1; return; }
        if (ch === '\n' && ignorerLF) { ignorerLF = false; return; }
        ignorerLF = ch === '\r';
        if (ch === '\r' || ch === '\n') { const valeur = c.tampon.join(''); courant = null; sortie.write('\n'); c.resolve(valeur); return; }
        if (ch === '\x7f' || ch === '\b') { if (c.tampon.length) { c.tampon.pop(); if (c.echo) sortie.write('\b \b'); } return; }
        if (ch < ' ') return;                                     // autres caractères de commande : ignorés
        c.tampon.push(ch); if (c.echo) sortie.write(ch);          // l'écho n'existe que pour la question d'adresse
    };
    const pomper = () => { while (courant && file.length && !fini) traiter(file.shift()); };
    const surDonnees = chunk => { for (const ch of String(chunk)) { if (fini) return; if (courant) traiter(ch); else file.push(ch); } };
    const surFin = () => { if (!fini) finir(interrompue()); };
    const ouvrir = () => {
        if (ouvert) return; ouvert = true;
        if (interactif) entree.setRawMode(true);                  // muet AVANT toute invite
        if (typeof entree.setEncoding === 'function') entree.setEncoding('utf8');
        entree.on('data', surDonnees); entree.on('end', surFin); entree.on('close', surFin);
        if (typeof entree.resume === 'function') entree.resume();
    };
    const lire = (question, echo) => new Promise((resolve, reject) => {
        if (fini) return reject(interrompue());
        ouvrir();
        if (echo) file.length = 0;                                // ce qui a été tapé avant l'invite d'adresse n'est pas rejoué à l'écran
        courant = { tampon: [], echo, resolve, reject };
        sortie.write(question);
        pomper();
    });
    return {
        ligne: q => lire(q, true),
        secret: async q => { if (!interactif) throw new ErreurSaisie('pas de terminal interactif : le mot de passe ne se saisit que masqué, jamais lu en clair'); return lire(q, false); },
        fermer: () => {
            if (ouvert) { entree.removeListener('data', surDonnees); entree.removeListener('end', surFin); entree.removeListener('close', surFin); if (interactif) entree.setRawMode(false); if (typeof entree.pause === 'function') entree.pause(); ouvert = false; }
            finir(null);
        }
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
    const env = deps.env || process.env;
    const a = lireArgs(argv);
    if (!a.ok) return refuser(a.raison);                                       // AVANT toute connexion
    const hotes = PC.jugerHotes(env);                                          // les hôtes se comparent sans connexion (la même règle qu'AMORÇAGE)
    if (!hotes.ok) return refuser(`${hotes.raison} Rien n'a été fait.`);
    const saisie = deps.saisie || saisieTerminal();
    let cx = null, so = null;
    try {
        cx = await (deps.connecter || connecterReel)();
        if (!cx || cx.base !== BASE_ESSAI || !cx.db) return refuser(`la connexion n'est pas sur ${BASE_ESSAI} : rien n'a été fait`);
        let collections;
        try { collections = await cx.db.listCollections().toArray(); } catch (e) { return refuser('impossible de lister les collections de la base : rien n\'a été fait'); }
        if (!Array.isArray(collections) || collections.length === 0) return refuser(`la base ${BASE_ESSAI} est VIDE (elle doit contenir le catalogue copié) : on n'est pas sur la bonne base. Rien n'a été fait.`);
        // LA PREUVE DE LA CIBLE : celle d'AMORÇAGE (module partagé), avant toute saisie et toute écriture
        so = await (deps.ouvrirSource || PC.ouvrirIdentiteProduction)(env);
        if (!so || so.ok !== true) return refuser(`cible non prouvée — ${(so && typeof so.raison === 'string' && so.raison) || 'identité de la production inconnue'}. Rien n'a été fait.`);
        let pr = null;
        try { pr = await (deps.prouverCible || PC.prouverCible)(cx.db, { source: so.source, ouvrirCartes: deps.ouvrirCartes || PC.ouvrirCartesParDefaut, env }); } catch { pr = null; }
        if (!pr || pr.ok !== true) return refuser(`la cible n'est pas prouvée — ${(pr && typeof pr.raison === 'string' && pr.raison) || 'je ne sais pas'}. Rien n'a été fait.`);
        ecrire(`Base ${BASE_ESSAI} : non vide, grappe distincte de la production et de cartes, utilisateur limité à l'écriture sur ${BASE_ESSAI} (prouvé côté serveur).`);

        if (a.banc) {                                                          // le compte de MESURE : ni adresse ni mot de passe saisis, aucun code de liaison, rien de secret à l'écran
            if (!deps.fichierEnv && process.env.BANC_ISOLE === '1') return refuser('un banc ne réécrit jamais le .env réel : fichier d\'environnement factice exigé. Rien n\'a été fait.');
            const cleBanc = emailCle(ADRESSE_BANC), maintenantB = deps.maintenant ? deps.maintenant() : new Date();
            const existant = await col('comptes').findOne({ emailCle: cleBanc });
            if (existant && !a.reprendre) return refuser('le compte de mesure existe déjà. Pour régénérer son mot de passe : --banc --reprendre. Rien n\'a été fait.');
            if (!existant && a.reprendre) return refuser('le compte de mesure n\'existe pas : lancer --banc sans --reprendre. Rien n\'a été fait.');
            if (existant && existant.banc !== true) return refuser('ce compte existe mais n\'est pas un compte de mesure (pas de marque banc) : refus, rien n\'a été fait.');
            const mdp = (deps.genererMotDePasse || genererMotDePasse)();
            const faute = P.politique(mdp, cleBanc) || (typeof mdp === 'string' && !mdp.trim() ? 'espaces-seulement' : null);
            if (faute) return refuser(`mot de passe généré refusé par la politique (${faute}). Rien n'a été fait.`);
            const hache = await P.hacher(mdp);
            if (!existant) {
                const doc = M.nouveauCompte({ email: ADRESSE_BANC, emailCle: cleBanc, motDePasse: hache, now: maintenantB });
                doc.verifie = true; doc.verifieLe = maintenantB; doc.banc = true;
                try { await col('comptes').insertOne(doc); }
                catch (e) { return refuser(e && e.code === 11000 ? 'le compte de mesure existe déjà. Rien n\'a été fait.' : `écriture du compte impossible (${(e && e.name) || 'erreur'}). Rien n'a été fait.`); }
            } else {
                await col('comptes').updateOne({ _id: existant._id }, { $set: { motDePasse: hache, verifie: true, banc: true }, $inc: { generation: 1 } });   // comme une réinitialisation : les sessions d'avant tombent
            }
            const r = await roleAdmin.poserRole(cleBanc, 'administrateur');
            if (!r.modifie) return refuser('le compte de mesure est écrit mais le rôle n\'a pas pu être posé : relancer avec --banc --reprendre');
            try { ecrireEnv(deps.fichierEnv || ENV_REEL, { [NOM_IDENTIFIANT]: ADRESSE_BANC, [NOM_MOT_DE_PASSE]: mdp }); }
            catch (e) { return refuser(`le compte est écrit mais les identifiants n'ont PAS pu être enregistrés dans le fichier d'environnement (${e && e.sure ? e.message : (e && (e.code || e.name)) || 'erreur'}) : relancer avec --banc --reprendre`); }
            ecrire(`Compte de mesure ${roleAdmin.masquer(ADRESSE_BANC)} ${existant ? 'repris : mot de passe régénéré' : 'créé : confirmé, administrateur, marqué banc'}. Les deux identifiants (${NOM_IDENTIFIANT}, ${NOM_MOT_DE_PASSE}) sont écrits dans le fichier d'environnement ; rien n'est affiché.`);
            return 0;
        }
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
            // la fonction de la route d'inscription, puis la règle de la vérification d'adresse (O3-RESIDU : `!motDePasse.trim()` -> espaces-seulement, service.js verifierAdresse)
            const faute = P.politique(mdp, cle) || (typeof mdp === 'string' && !mdp.trim() ? 'espaces-seulement' : null);
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
        if (e && e.sure === true && typeof e.message === 'string') return refuser(e.message);   // un refus de saisie dit sa cause (message fixe, jamais celui d'un pilote)
        return refuser(`arrêt sur erreur (${(e && (e.codeName || e.code || e.name)) || 'erreur'}) : je n'affiche jamais le message du pilote. Relire l'état avant de relancer.`);
    } finally {
        try { if (saisie.fermer) saisie.fermer(); } catch { /* terminal déjà fermé */ }
        try { if (so && so.fermer) await so.fermer(); } catch { /* connexion déjà fermée */ }
        try { if (cx && cx.fermer) await cx.fermer(); } catch { /* connexion déjà fermée */ }
    }
}

if (require.main === module) {
    require('dotenv').config();
    main(process.argv.slice(2)).then(code => process.exit(code)).catch(e => { console.error(`❌ ${(e && e.name) || 'erreur'}`); process.exit(1); });
}
module.exports = { main, saisieTerminal, ErreurSaisie, lireArgs, BASE_ESSAI, ecrireEnv, genererMotDePasse, ADRESSE_BANC, NOM_IDENTIFIANT, NOM_MOT_DE_PASSE, prouverCible: PC.prouverCible, jugerHotes: PC.jugerHotes, jugerStatut: PC.jugerStatut };

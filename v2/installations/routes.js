'use strict';
const { col } = require('../db'); const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('./service'); const liaison = require('./liaison');
const { resoudrePorteur, exigerInstallation } = require('../porteur'); const { idempotente, FORME_FORTE } = require('../transport/idempotence'); const { ipKeyGenerator } = require('express-rate-limit');

// `heritage` (réponse 201 de /api/installation) : une valeur par issue RÉELLE de reprendreHeritage, aucune silencieuse.
//   "repris"         le portefeuille 1.0.x est déplacé vers cette installation
//   "deja-migre"     ce portefeuille a déjà été déplacé (vers cette installation-ci ou une autre)
//   "inconnu"        aucun portefeuille ne répond à ce userId (ou le userId envoyé est inutilisable : non-texte, vide, > 80 caractères)
//   "plafond-global" valeur ADDITIVE : le plafond global des essais du jour est atteint, la reprise est refusée SANS toucher au portefeuille
//   "absent"         aucun userIdHerite n'a été envoyé
// Toute autre issue (exception, forme inconnue, installation introuvable…) n'est PAS une valeur : voir issueApresEchecHeritage.
const RAISONS = { 'deja-migre': 'deja-migre', inconnu: 'inconnu', 'plafond-global': 'plafond-global' };
const valeurHeritage = r => (r && r.ok === true ? 'repris' : (r && r.ok === false && Object.hasOwn(RAISONS, r.raison) ? RAISONS[r.raison] : null));

/** L'héritage a LEVÉ (ou rendu une issue inconnue) alors que l'installation est créée : elle ne reste jamais orpheline (le client ne reverrait jamais son jeton).
 *  Si l'héritage a pourtant VALIDÉ (réponse perdue après la validation : l'installation porte `heriteEmpreinte`, les crédits ont été déplacés vers elle), elle est GARDÉE et la réponse est
 *  "repris". Sinon elle est défaite (jamais une installation héritière : le filtre l'exige) et la route répond 503 — un nouvel essai crée UNE installation, héritage compris. */
async function issueApresEchecHeritage(installation) {
    const apres = await col('installations').findOne({ _id: installation._id });
    if (apres && typeof apres.heriteEmpreinte === 'string') return 'repris';
    await col('installations').deleteOne({ _id: installation._id, heriteEmpreinte: null });
    return null;
}

function montrerInstallation(router, cfg, deps) {
    const entree = (req, res, next) => {
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b) || (b.versionExtension !== undefined && (typeof b.versionExtension !== 'string' || b.versionExtension.length > 20)))
            return repondreErreur(res, 'ENTREE', 'Requête invalide');
        next();
    };
    // IPv6 regroupée par /56 (ipKeyGenerator d'express-rate-limit, la MÊME fonction que v2/limiteur-heritage.js) : un /64 ne multiplie pas les seaux ; une IPv4 reste telle quelle
    const cleIp = q => L.empreinteIp(ipKeyGenerator(String(q.ip || '?')));
    const limite = L.limiteur({ nom: 'inst-ip', max: cfg.limites.installationParIpJour, fenetreMs: 86400e3, cle: cleIp });
    // Idempotency-Key FACULTATIVE (l'extension en envoie une ; sans clé : comportement d'avant). AVANT le limiteur : un rejeu servi par la clé ne consomme pas le plafond 2/IP/jour.
    // Personne n'a encore de jeton : le claim vit sous un porteur unique « anonyme » (la clé, aléatoire côté client, est le secret). La réponse porte le jeton : elle est conservée SCELLÉE.
    // La clé tient lieu de SECRET (aucun porteur) : 32 caractères au moins sur CETTE route (400 ENTREE, detail `cle-trop-courte` | `cle-trop-longue` | `cle-caractere-interdit`), et un limiteur par IP AVANT la recherche de la clé compte TOUTES les
    // requêtes, rejeux compris (V2_INSTALLATION_REQUETES_HEURE, 30 par heure) : les devinettes sont bornées. Le rejeu n'est pas lié à l'IP (une IP mobile change) : risque dit au contrat.
    const toutes = L.limiteur({ nom: 'inst-req-ip', max: cfg.limites.installationRequetesIpHeure, fenetreMs: 3600e3, cle: cleIp });
    const idem = idempotente('installation', { obligatoire: false, porteur: () => 'anonyme', sceller: true, forme: FORME_FORTE }, cfg);
    router.post('/api/installation', entree, toutes, idem, limite, async (req, res) => {
        let installation = null;
        try {
            const argent = registre.obtenir('argent');     // avant toute écriture : jamais d'installation sans de quoi dire son solde
            const cree = await S.creerInstallation({ libelle: req.body.libelle, cfg });
            installation = cree.installation;
            const h = req.body.userIdHerite;
            let heritage = 'absent';
            if (h !== undefined && h !== null) {
                if (typeof h !== 'string' || h.length === 0 || h.length > 80) heritage = 'inconnu';
                else {
                    let issue = null;
                    try { issue = valeurHeritage(await argent.reprendreHeritage({ userId: h, installation })); }
                    catch (e) { console.error(`❌ [v2 installation] héritage en échec (${(e && (e.code || e.name)) || 'erreur'})`); }   // jamais e.message : il peut contenir le userId
                    if (issue === null) issue = await issueApresEchecHeritage(installation);
                    if (issue === null) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // l'installation vient d'être défaite
                    heritage = issue;
                }
            }
            const rechargee = await col('installations').findOne({ _id: installation._id });
            const solde = await argent.solde({ type: 'installation', id: rechargee._id, compte: null, installation: rechargee, surface: 'extension', administrateur: false });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(201).json({ success: true, installationId: installation._id, jetonInstallation: cree.jeton, solde, heritage });
        } catch (e) {
            console.error(`❌ [v2 installation] ${(e && e.name) || 'Error'}`);   // jamais e.message : il peut venir de B3 (héritage) et contenir le userId
            // une installation créée dont la réponse ne peut plus partir (lecture du solde en panne…) n'est pas laissée orpheline non plus (sauf héritière : elle porte des crédits déplacés)
            if (installation) {
                try { if (await issueApresEchecHeritage(installation) === 'repris') console.error('🔴 [v2 installation] installation héritière gardée, jeton non rendu (réponse impossible)'); }
                catch (e2) { console.error(`🔴 [v2 installation] installation ${installation._id} laissée orpheline (${(e2 && (e2.code || e2.name)) || 'erreur'})`); }
            }
            return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
        }
    });
}
/** Routes de l'extension (Bearer) : lier / délier. */
function routesLiaison(router, cfg, deps) {
    // /api/compte/lier : après la rotation, l'ANCIEN jeton est révoqué ; un rejeu de la même Idempotency-Key le présente quand même (la réponse s'est perdue) et ne peut qu'être REJOUÉ (voir liaison.porteurDeRejeu).
    const resoudre = resoudrePorteur(cfg);
    const resoudreLier = (req, res, next) => resoudre(req, res, async () => {
        try { if (!req.v2.porteur && req.v2.echec === 'jeton-inconnu') await liaison.porteurDeRejeu(req); }
        catch (e) { console.error(`❌ [v2 lier] rejeu ${(e && (e.code || e.name)) || 'erreur'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
        next();
    });
    // un porteur retrouvé PAR LE REJEU n'exécute jamais la liaison : si l'idempotence ne rejoue rien (réponse expirée, jamais conservée), c'est un jeton révoqué — 401, rien d'exécuté
    const jamaisExecuterUnRejeu = (req, res, next) => (req.v2.rejeuLiaison ? repondreErreur(res, 'JETON', 'Jeton d\'installation absent ou invalide') : next());
    const base = [resoudreLier, exigerInstallation];
    const idemLier = idempotente('lier', { obligatoire: false, sceller: true }, cfg);
    // chaque TENTATIVE compte, bonne ou fausse : la 6e d'une installation (la 21e d'une IP) dans l'heure est refusée même avec le bon code. Un rejeu servi par la clé ne devine aucun code.
    const parInstallation = L.limiteur({ nom: 'lier-inst', max: cfg.limites.codeEssaisInstallationHeure, fenetreMs: 3600e3, cle: q => q.v2.porteur.installation._id });
    const parIp = L.limiteur({ nom: 'lier-ip', max: cfg.limites.codeEssaisIpHeure, fenetreMs: 3600e3, cle: q => L.empreinteIp(q.ip) });
    const argentDe = res => { try { return registre.obtenir('argent'); } catch { repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); return null; } };
    const nom = { CODE_INVALIDE: 'Code invalide', CODE_EXPIRE: 'Code expiré', DEJA_LIE: 'Cette installation est déjà liée à un compte', INDISPONIBLE: 'Service momentanément indisponible' };

    router.post('/api/compte/lier', ...base, idemLier, jamaisExecuterUnRejeu, parInstallation, parIp, async (req, res) => {
        try {
            const argent = argentDe(res); if (!argent) return;
            const inst = req.v2.porteur.installation;
            const cleBrute = req.headers['idempotency-key'];
            const rejeu = typeof cleBrute === 'string' ? { cle: cleBrute, expireLe: new Date(Date.now() + cfg.retention.idempotenceHeures * 3600000) } : null;
            const r = await liaison.lier({ installation: inst, code: req.body && req.body.code, argent, rejeu });
            if (!r.ok) return repondreErreur(res, r.code, nom[r.code]);
            // La rotation du jeton est ÉCRITE (et la fusion des crédits faite) : à partir d'ici le nouveau jeton n'est JAMAIS perdu. Si une lecture qui suit lève (solde, offre…), la réponse ne peut pas partir :
            // on REMET l'ANCIEN jeton en vigueur (la liaison au compte et la fusion restent : elles ne se défont pas sans risque pour l'argent). Le client garde un jeton qui marche ; un nouvel essai rend 409 DEJA_LIE.
            try {
                const apres = await col('installations').findOne({ _id: inst._id });
                const porteurLie = { type: 'compte', id: r.compte._id, compte: r.compte, installation: apres, surface: 'extension', administrateur: r.compte.role === 'administrateur' };
                const solde = await argent.solde(porteurLie), offre = await argent.offre(porteurLie);      // OFFRE-QUOTA : l'offre du COMPTE lié (gratuit, ou pro), relue en base
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).json({ success: true, compte: { emailMasque: r.emailMasque, verifie: r.compte.verifie, administrateur: Boolean(solde && solde.compte && solde.compte.administrateur === true) }, jetonInstallation: r.jeton, solde, offre });
            } catch (e) {
                console.error(`❌ [v2 lier] lecture après la rotation : ${(e && (e.code || e.name)) || 'Error'} — ancien jeton remis en vigueur`);
                try { await liaison.remettreAncienJeton(inst, r.jeton); } catch (e2) { console.error(`🔴 [v2 lier] ancien jeton NON remis (${(e2 && (e2.code || e2.name)) || 'erreur'}) — installation ${inst._id}, jeton perdu`); }
                return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
            }
        } catch (e) { console.error(`❌ [v2 lier] ${(e && e.name) || 'Error'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
    });
    router.post('/api/compte/delier', resoudrePorteur(cfg), exigerInstallation, async (req, res) => {
        try {
            const argent = argentDe(res); if (!argent) return;
            const inst = req.v2.porteur.installation;
            await liaison.delier(inst);
            const apres = await col('installations').findOne({ _id: inst._id });
            const porteurSeul = { type: 'installation', id: apres._id, compte: null, installation: apres, surface: 'extension', administrateur: false };
            const solde = await argent.solde(porteurSeul), offre = await argent.offre(porteurSeul);      // OFFRE-QUOTA : déliée, l'installation redevient « sans-compte »
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, solde, offre });
        } catch (e) { console.error(`❌ [v2 delier] ${(e && e.name) || 'Error'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
    });
}
module.exports = { montrerInstallation, routesLiaison };

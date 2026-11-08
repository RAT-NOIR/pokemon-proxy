'use strict';
// LIEN-ORDINATEUR — la décision d'envoyer, ou non, le lien de l'extension à une adresse. Sans HTTP : la route (routes.js) appelle `demander(adresse)` et traduit l'issue.
// L'ORDRE (chaque étape ne se joue que si la précédente a laissé passer) :
//   1. l'adresse est lue : une forme qu'on ne sait pas normaliser, un domaine jetable, une adresse que Brevo refuserait => « ignoree » (la route répond 202 comme pour une adresse servie ; RIEN n'est écrit) ;
//   2. LA MARQUE (une par boîte et par 24 h) est écrite AVANT l'envoi, par une insertion à clé unique (transport/limites.js::reserver) : deux demandes simultanées pour la même boîte, une seule gagne => « deja » ;
//   3. le plafond global du jour de Paris (un compteur à lui, pas celui des courriels de comptes) ; plein => la marque est RENDUE (rien n'est parti) et « plafond » ;
//   4. l'envoi. Un échec DÉFINI (Brevo a répondu non : rien n'est parti) rend la marque ; un échec AMBIGU (réseau, délai, erreur inconnue : le message a pu partir) la GARDE — jamais un doublon.
// DONNÉES : l'adresse n'est écrite NULLE PART (ni base, ni journal, ni message d'erreur : seul le NOM d'une erreur est journalisé). La marque est { cle: 'lien-ordinateur:<HMAC-SHA256 hex>|reservation', n, expireLe = +24 h } dans `limites`
// (index unique sur `cle` et TTL sur `expireLe` existants). L'HMAC porte sur la BOÎTE (cleBoite : minuscules, points de Gmail et +étiquette retirés) avec le secret serveur V2_SECRET_EMPREINTE et le domaine « lien-ordinateur ».
const crypto = require('crypto');
const L = require('../transport/limites');
const { col } = require('../db');
const { emailCle, cleBoite, estJetable } = require('../comptes/email-cle');
const { adresseValide } = require('../comptes/courrier-brevo');
const { creerPlafondJour } = require('../comptes/plafond-courriels');

const JOUR_MS = 24 * 3600e3;
const nomErreur = e => (e && e.name) || 'Error';   // jamais e.message : un pilote peut y mettre une adresse
const PREFIXE = 'lien-ordinateur:';

/** L'empreinte de la boîte : HMAC-SHA256 avec le secret serveur, domaine « lien-ordinateur » (la même adresse donne une autre valeur pour les autres usages du secret). */
function empreinteBoite(secret, boite) {
    if (typeof secret !== 'string' || secret.length < 16) throw new Error('secret-empreinte-absent');   // fail-closed : jamais d'empreinte sans secret
    return crypto.createHmac('sha256', secret).update(`lien-ordinateur|${boite}`).digest('hex');
}
const FORMAT_PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Secondes jusqu'à minuit à Paris (le compteur du jour change alors), entre 1 et 86 400. */
function secondesAvantMinuitParis(d = new Date()) {
    const p = Object.fromEntries(FORMAT_PARIS.formatToParts(d).map(x => [x.type, Number(x.value)]));
    return Math.min(86400, Math.max(1, 86400 - (p.hour * 3600 + p.minute * 60 + p.second)));
}

/** @param {{cfg: object, courrier: object, maintenant?: () => Date, plafond?: object}} o  `plafond` : injection de banc. */
function creerService({ cfg, courrier, maintenant = () => new Date(), plafond = null }) {
    const secret = cfg.empreinte && cfg.empreinte.secret;
    const plafondJour = plafond || creerPlafondJour({ max: cfg.lienOrdinateur.jour, reserveSecurite: 0, maintenant, colonne: () => col('courriels_lien_jour') });
    return {
        /** @returns {Promise<{issue: 'envoye'|'deja'|'ignoree'|'plafond'}>} ; lève (nom d'erreur seul) quand le service est indisponible. */
        async demander(brut) {
            const cle = typeof brut === 'string' ? emailCle(brut) : null;
            if (!cle) return { issue: 'ignoree' };
            const destinataire = brut.normalize('NFKC').trim();
            if (estJetable(cle.split('@')[1]) || !adresseValide(destinataire)) return { issue: 'ignoree' };
            const cleMarque = `${PREFIXE}${empreinteBoite(secret, cleBoite(cle))}`;
            const r = await L.reserver(cleMarque, { delaiMs: JOUR_MS, maintenant: maintenant() });
            if (!r.permis) return { issue: 'deja' };
            const rendre = async () => { try { await L.liberer(cleMarque); } catch (e) { console.error(`❌ [v2 lien-ordinateur] marque non rendue (${nomErreur(e)})`); } };
            let place;
            try { place = await plafondJour.reserver('securite'); } catch (e) { await rendre(); throw e; }
            if (!place) { await rendre(); return { issue: 'plafond' }; }
            try { await courrier.envoyerLienOrdinateur(destinataire); }
            catch (e) {
                const nom = nomErreur(e);
                if (nom === 'BrevoPlafond') { await rendre(); return { issue: 'plafond' }; }                              // le plafond propre du pilote : rien n'est parti
                if (nom === 'BrevoAdresse' || nom === 'BrevoStatut400') { await rendre(); return { issue: 'ignoree' }; }   // Brevo refuse cette adresse : comme une adresse invalide
                if (/^BrevoStatut\d{3}$/.test(nom)) { await rendre(); throw e; }                                            // Brevo a répondu non (clé, droits, panne) : rien n'est parti
                throw e;                                                                                                    // réseau, délai, inconnue : le message a pu partir, la marque reste
            }
            return { issue: 'envoye' };
        }
    };
}
module.exports = { creerService, empreinteBoite, secondesAvantMinuitParis, PREFIXE, JOUR_MS };

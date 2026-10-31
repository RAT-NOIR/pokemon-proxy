'use strict';
// BREVO — le pilote d'envoi des courriels, en API HTTP transactionnelle (POST /v3/smtp/email, en-tête `api-key`). Même interface que le pilote mémoire (courrier.js) :
//   envoyerVerification(email, lien, { purgeHeures }) · envoyerReinitialisation(email, lien, { validiteHeures }) · envoyerAvertissement(email, { derniereConnexionLe, suppressionLe })
// Règles (BREVO, 27/10) :
//  · la clé est lue UNE fois, à la construction (BREVO_API_KEY), jamais relue, jamais écrite nulle part ; absente : la construction LÈVE (BrevoCleAbsente) ;
//  · un délai borné par requête ; UN réessai au plus, sur 5xx, réseau ou délai — JAMAIS sur 4xx (429 compris : insister auprès d'un serveur qui dit « trop » aggrave) ; une redirection est une erreur (la clé ne suit personne) ;
//  · aucune adresse, aucun lien, aucune clé, aucun corps de réponse dans une erreur ni dans un journal : le NOM de l'erreur seul (BrevoStatut503, BrevoReseau, BrevoDelai, BrevoPlafond, BrevoAdresse) ;
//  · une adresse qui n'est pas une adresse valide est refusée AVANT toute requête, et `.invalid` (domaine réservé, celui des comptes de banc) aussi : un rebond coûte la réputation du domaine ;
//  · un banc (BANC_ISOLE=1) ne peut pas construire un pilote qui vise l'adresse de Brevo : les bancs le jouent contre un faux serveur local, sur une URL injectée ;
//  · un plafond du jour (plafond-courriels.js, offre gratuite de Brevo : 300 par jour) est consulté AVANT l'envoi ; les courriels de sécurité (vérification, mot de passe) ont la priorité sur les avertissements.
const G = require('./gabarits-courriel');

const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';
const EXPEDITEUR = Object.freeze({ name: 'Rat-Market', email: 'no-reply@rat-market.fr' });   // défaut ; la configuration (V2_COURRIEL_DE) le remplace via l'option `de`
const DELAI_MS = 8000, REESSAI_MS = 1000;

const erreur = (nom) => { const e = new Error(nom); e.name = nom; return e; };
// Une adresse : un seul @, ni espace ni saut de ligne ni < > " , ; \, un domaine pointé dont la dernière partie est alphanumérique, 254 caractères au plus (64 avant le @). `.invalid` : refusée.
const FORME = /^[^\s@<>"',;\\()[\]]{1,64}@[^\s@<>"',;\\()[\]]+\.[A-Za-z0-9-]{2,}$/;
function adresseValide(a) {
    if (typeof a !== 'string' || a.length > 254 || !FORME.test(a) || /[\u0000-\u001f\u007f]/.test(a)) return false;
    const domaine = a.slice(a.lastIndexOf('@') + 1).toLowerCase();
    return !domaine.split('.').some(p => !p || p.startsWith('-') || p.endsWith('-')) && !domaine.endsWith('.invalid');
}

function creerCourrierBrevo({ cle, env = process.env, url = URL_BREVO, delaiMs = DELAI_MS, reessaiMs = REESSAI_MS, fetchImpl = globalThis.fetch, plafond = null, de = null, repondreA = null, journal = console } = {}) {
    if (de !== null && !adresseValide(de)) throw erreur('BrevoExpediteur');
    if (repondreA !== null && !adresseValide(repondreA)) throw erreur('BrevoExpediteur');
    const expediteur = de ? Object.freeze({ name: EXPEDITEUR.name, email: de }) : EXPEDITEUR;
    const laCle = typeof (cle === undefined ? env.BREVO_API_KEY : cle) === 'string' ? String(cle === undefined ? env.BREVO_API_KEY : cle).trim() : '';
    if (!laCle) throw erreur('BrevoCleAbsente');
    if (env.BANC_ISOLE === '1' && url === URL_BREVO || process.env.BANC_ISOLE === '1' && url === URL_BREVO) throw erreur('BrevoBancInterdit');
    if (typeof fetchImpl !== 'function') throw erreur('BrevoFetchAbsent');
    const dits = new Set();
    const dire = (classe) => {      // un plafond atteint est DIT, une fois par classe et par jour (jamais une ligne par courriel)
        const k = `${classe}|${new Date().toISOString().slice(0, 10)}`;
        if (dits.has(k)) return; dits.add(k);
        journal.warn(`⚠️ [v2 courrier] plafond quotidien de courriels atteint (classe ${classe}) — les courriels de cette classe ne partent plus aujourd'hui`);
    };

    async function tenter(corps) {
        const ctl = new AbortController(); const minuteur = setTimeout(() => ctl.abort(), delaiMs);
        let res;
        try { res = await fetchImpl(url, { method: 'POST', headers: { 'api-key': laCle, 'content-type': 'application/json', accept: 'application/json' }, body: corps, signal: ctl.signal, redirect: 'manual' }); }
        catch (e) { clearTimeout(minuteur); throw erreur(ctl.signal.aborted ? 'BrevoDelai' : 'BrevoReseau'); }
        // Le délai couvre AUSSI la lecture du corps (R3) : un corps qui ne finit jamais est coupé par le même signal. Le corps n'est jamais gardé.
        const ok = res.status >= 200 && res.status < 300;
        try { await res.arrayBuffer(); }
        catch {
            if (ok) { const e = erreur(ctl.signal.aborted ? 'BrevoDelai' : 'BrevoReseau'); e.apresReponse = true; throw e; }   // l'envoi a pu être accepté : pas de réessai (pas de doublon)
        } finally { clearTimeout(minuteur); }
        if (ok) return;
        throw erreur(`BrevoStatut${res.status}`);
    }
    const retentable = e => !e.apresReponse && (e.name === 'BrevoReseau' || e.name === 'BrevoDelai' || /^BrevoStatut5\d\d$/.test(e.name));
    async function poster(classe, adresse, contenu) {
        if (!adresseValide(adresse)) throw erreur('BrevoAdresse');
        if (plafond && !(await plafond.reserver(classe))) { dire(classe); throw erreur('BrevoPlafond'); }
        const corps = JSON.stringify({ sender: expediteur, to: [{ email: adresse }], replyTo: { email: repondreA || await G.contactSite() }, subject: contenu.objet, htmlContent: contenu.html, textContent: contenu.texte });
        try { await tenter(corps); }
        catch (e) {
            if (!retentable(e)) throw e;
            if (reessaiMs > 0) await new Promise(r => setTimeout(r, reessaiMs));
            await tenter(corps);                       // le SEUL réessai ; son échec remonte tel quel
        }
    }
    return {
        reel: true,       // ce pilote envoie pour de vrai : seule garantie sur laquelle la passe d'avertissement (inactifs.js) accepte de marquer un compte
        async envoyerVerification(email, lien) { if (!adresseValide(email)) throw erreur('BrevoAdresse'); await poster('securite', email, await G.verification(email, lien)); },
        async envoyerReinitialisation(email, lien, options) { if (!adresseValide(email)) throw erreur('BrevoAdresse'); await poster('securite', email, await G.reinitialisation(email, lien, options || {})); },
        async envoyerAvertissement(email, donnees) { if (!adresseValide(email)) throw erreur('BrevoAdresse'); await poster('avertissement', email, await G.avertissementSuppression(email, donnees || {})); }
    };
}
module.exports = { creerCourrierBrevo, adresseValide, URL_BREVO, EXPEDITEUR };

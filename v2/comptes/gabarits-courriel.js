'use strict';
// BREVO — les gabarits des courriels de l'API : objet, texte brut, HTML.
// Les textes sont ceux du SITE (lib/courriels.ts), EMBARQUÉS tels quels dans v2/comptes/courriels-site/ (copie vérifiée par test-courriels-site.js) : l'API n'en écrit aucun de son propre chef,
// sauf l'avertissement de suppression, que le site n'a pas encore rédigé (DEMANDE-SERVEUR-SITE.md, entrée du 2026-10-26 nuit : « Rédigez-le dans lib/courriels.ts sous le nom avertissementSuppression »).
// Celui-ci est donc PROVISOIRE : il utilise le gabarit du site (rendreHtml / rendreTexte) avec un texte minimal, et sera REMPLACÉ par COURRIELS.avertissementSuppression dès que la copie le portera.
const path = require('path'); const { pathToFileURL } = require('url');
const DOSSIER = path.join(__dirname, 'courriels-site');
let chargement = null;
/** Charge (une fois) les modules .mjs embarqués : le serveur est en CommonJS, d'où l'import dynamique. */
function charger() {
    if (!chargement) chargement = Promise.all(['courriels.mjs', 'courrielsGabarit.mjs', 'site.mjs'].map(f => import(pathToFileURL(path.join(DOSSIER, f)).href)))
        .then(([c, g, s]) => ({ COURRIELS: c.COURRIELS, lienAutorise: c.lienAutorise, typo: g.typo, rendreHtml: g.rendreHtml, rendreTexte: g.rendreTexte, SITE: s.SITE }))
        .catch(e => { chargement = null; throw e; });
    return chargement;
}

const LIEN_CONNEXION = 'https://rat-market.fr/fr/connexion';
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' });
function dateValide(nom, v) { const d = v instanceof Date ? v : null; if (!d || Number.isNaN(d.getTime())) throw new RangeError(`date illisible : ${nom}`); return d; }

async function verification(adresse, lien) { const { COURRIELS } = await charger(); return COURRIELS.creationCompte({ adresse, lienConfirmation: lien }); }
async function reinitialisation(adresse, lien, { validiteHeures = null } = {}) { const { COURRIELS } = await charger(); return COURRIELS.reinitialisationMotDePasse({ adresse, lienReinitialisation: lien, validiteHeures }); }

/** PROVISOIRE (voir l'en-tête). `derniereConnexionLe` : la dernière connexion (ou, faute d'elle, la confirmation de l'adresse) ; `suppressionLe` : la date prévue. */
async function avertissementSuppression(adresse, { derniereConnexionLe, suppressionLe, lienConnexion = LIEN_CONNEXION } = {}) {
    const G = await charger();
    if (typeof G.COURRIELS.avertissementSuppression === 'function') return G.COURRIELS.avertissementSuppression({ adresse, derniereConnexionLe, suppressionLe, lienConnexion });   // le jour où le site l'écrit
    const supprime = dateValide('suppressionLe', suppressionLe), derniere = dateValide('derniereConnexionLe', derniereConnexionLe);
    if (!G.lienAutorise(lienConnexion, 'site')) { const e = new Error('Lien « lienConnexion » refusé'); e.name = 'LienCourrielInvalide'; throw e; }
    const jour = d => { const t = FORMAT_DATE.format(d); return G.typo(/^1 /.test(t) ? `1er${t.slice(1)}` : t); };
    const adr = typeof adresse === 'string' ? adresse.trim() : '';
    if (!adr) throw new RangeError('adresse illisible');
    const contenu = {
        adresse: adr,
        objet: `Votre compte Rat-Market sera supprimé le ${jour(supprime)} sans reconnexion`,
        resume: `Connectez-vous avant le ${jour(supprime)} pour le conserver.`,
        titre: 'Votre compte va être supprimé',
        blocs: [
            { t: 'p', texte: `Vous ne vous êtes pas connecté au compte Rat-Market associé à l’adresse ${adr} depuis trois ans. Un compte resté inactif est supprimé après 3 ans sans connexion, avec un avertissement un mois avant.` },
            { t: 'details', lignes: [['Dernière connexion', jour(derniere)], ['Suppression prévue', jour(supprime)]] },
            { t: 'p', texte: 'Pour conserver votre compte, il suffit de vous connecter avant cette date : la suppression est alors annulée.' },
            { t: 'bouton', libelle: 'Me connecter', lien: new URL(lienConnexion).href },
            { t: 'note', texte: `Sans connexion de votre part, votre compte, votre collection et l’historique de vos analyses seront supprimés le ${jour(supprime)}.` },
            { t: 'note', texte: 'Ce message vous est envoyé une seule fois.' }
        ]
    };
    return { objet: G.typo(contenu.objet), texte: G.rendreTexte(contenu), html: G.rendreHtml(contenu) };
}
async function contactSite() { const { SITE } = await charger(); return SITE.contactEmail; }
module.exports = { charger, verification, reinitialisation, avertissementSuppression, contactSite, LIEN_CONNEXION };

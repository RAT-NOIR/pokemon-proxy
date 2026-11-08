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
    if (!chargement) chargement = Promise.all(['courriels.mjs', 'courrielsGabarit.mjs', 'site.mjs', 'extension.mjs'].map(f => import(pathToFileURL(path.join(DOSSIER, f)).href)))
        .then(([c, g, s, e]) => ({ COURRIELS: c.COURRIELS, lienAutorise: c.lienAutorise, typo: g.typo, rendreHtml: g.rendreHtml, rendreTexte: g.rendreTexte, echapper: g.echapper, COULEURS: g.COULEURS, POLICE: g.POLICE, SITE: s.SITE, CHROME_STORE_URL: s.CHROME_STORE_URL, lienStoreValide: e.lienStoreValide }))
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

/**
 * LIEN-ORDINATEUR (D1 du site) — le courriel « le lien de l'extension pour votre ordinateur » : un message CONSTANT. Cette fonction n'a AUCUN paramètre (elle ne lit ni l'adresse du destinataire, ni un champ de la requête) :
 * l'objet, le texte et le HTML sont les mêmes pour tout le monde, et le SEUL lien est la fiche du Chrome Web Store, `CHROME_STORE_URL` du site (une seule adresse du Store dans tout le code du site, copiée ici avec les autres textes).
 * Elle ne passe pas par `rendreHtml` / `rendreTexte` du site : leur pied de page écrit l'adresse du destinataire (« un compte est associé à l'adresse … »), faux ici (aucun compte) et contraire à « aucun texte venant de l'utilisateur ».
 * L'instance est gardée : le même objet à chaque appel (un test le vérifie).
 */
let messageLien = null;
async function lienOrdinateur() {
    if (messageLien) return messageLien;
    const { typo, echapper, COULEURS: k, POLICE, SITE, CHROME_STORE_URL, lienStoreValide } = await charger();
    if (!lienStoreValide(CHROME_STORE_URL)) { const e = new Error('Lien du Chrome Web Store refusé'); e.name = 'LienStoreInvalide'; throw e; }   // fail-closed : un identifiant de remplissage n'est jamais envoyé
    const lien = new URL(CHROME_STORE_URL).href;
    const objet = typo('Le lien de l’extension Rat-Market pour votre ordinateur');
    const titre = typo('Installez Rat-Market sur votre ordinateur');
    const intro = typo('Voici le lien de l’extension Rat-Market. Ouvrez-le avec Chrome sur votre ordinateur, puis cliquez sur « Ajouter à Chrome ».');
    const origine = typo('Ce message vous est envoyé parce que cette adresse a été saisie sur rat-market.fr pour recevoir ce lien. Si ce n’est pas vous, ignorez-le : aucun compte n’a été créé.');
    const adresse = typo('Votre adresse n’est pas conservée : seule une empreinte illisible en est gardée 24 heures, pour limiter les envois répétés.');
    const question = typo(`Une question ? Écrivez à ${SITE.contactEmail}.`);
    const texte = [titre, intro, lien, origine, adresse, question, '--\nRat-Market · rat-market.fr'].join('\n\n') + '\n';
    const style = (px, ligne, couleur, plus = '') => `font-family:${POLICE};font-size:${px}px;line-height:${ligne}px;color:${couleur}${plus}`;
    const href = echapper(lien);
    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${echapper(objet)}</title>
</head>
<body style="margin:0;padding:0;background-color:${k.fondClair}" bgcolor="${k.fondClair}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${k.fondClair}" style="background-color:${k.fondClair}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" bgcolor="${k.carteClair}" style="width:100%;max-width:600px;background-color:${k.carteClair};border-radius:12px">
<tr><td style="padding:28px 32px 12px;${style(22, 28, k.texteClair, ';font-weight:700')}">${echapper(titre)}</td></tr>
<tr><td style="padding:0 32px 16px;${style(16, 24, k.texteClair)}">${echapper(intro)}</td></tr>
<tr><td style="padding:4px 32px 20px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${k.or}" style="background-color:${k.or};border-radius:999px"><a href="${href}" style="display:inline-block;padding:14px 28px;${style(16, 20, k.noir, ';font-weight:700;text-decoration:none;border-radius:999px')}">${echapper(typo('Ouvrir la fiche sur le Chrome Web Store'))}</a></td></tr></table></td></tr>
<tr><td style="padding:0 32px 16px;${style(13, 19, k.doucClair)}">${echapper(typo('Le bouton ne s’affiche pas ? Copiez ce lien dans votre navigateur :'))}<br><a href="${href}" style="color:${k.orSurBlanc};word-break:break-all">${href}</a></td></tr>
<tr><td style="padding:0 32px 16px;${style(14, 21, k.doucClair)}">${echapper(origine)}</td></tr>
<tr><td style="padding:0 32px 16px;${style(14, 21, k.doucClair)}">${echapper(adresse)}</td></tr>
<tr><td style="padding:8px 32px 28px;${style(13, 19, k.doucClair)}">${echapper(question)}<br>Rat-Market · rat-market.fr</td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
    messageLien = Object.freeze({ objet, texte, html });
    return messageLien;
}
module.exports = { charger, verification, reinitialisation, avertissementSuppression, contactSite, lienOrdinateur, LIEN_CONNEXION };

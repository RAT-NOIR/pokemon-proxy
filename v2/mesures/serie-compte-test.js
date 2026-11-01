'use strict';
// SERIE-COMPTE-TEST (01/11) — les pièces PURES de la série du compte de test ORDINAIRE (serie-essai.js `--compte=ordinaire` les appelle ; elles n'ouvrent aucune connexion) :
//   · TABLEAU : les 9 lignes de la série, dans l'ORDRE (§7 de serie-P-verifications.md). Le chemin est celui d'un client réel de l'extension 2.0.1 : première réponse de /api/identifier, puis — si le serveur propose un complément —
//     le second envoi /api/identifier/mesures, puis la déclaration. L'issue d'une ligne dépend donc du modèle : chaque ligne porte la liste FERMÉE de ses issues admises (niveau de la première réponse → niveau final), et pour
//     chacune le débit attendu (facturation de la première réponse, du second envoi, de la réponse à la déclaration), la déclaration envoyée et le quota restant. Toute autre issue est un écart ; jamais un « n'importe quoi » ;
//   · VALEURS DÉDUITES : toutes les valeurs attendues sont déduites du code du service (facturation.js, questions.js, ledger.js, calcul-client-route.js), PAS observées sur l'essai (`source` de chaque issue) ;
//   · comparerAvantDeclaration / comparerLigne : confrontent ce que l'essai a servi à la ligne attendue et rendent LE PREMIER écart (champ, attendu, observé), ou null ; le client s'arrête là, sans adapter la suite ;
//   · codeSortie : 14 = écart au tableau, 15 = dépôt de photo refusé au compte ordinaire (aucun scan lancé), 16 = ligne NON JUGÉE (erreur hors Arret : la série s'arrête, le bilan exige 9 lignes jugées sur 9), 1 = autre arrêt, 0 = rien. (10, 11, 12 sont pris par serie-probable.js.)
// LE SECOND ENVOI N'AJOUTE AUCUN APPEL AU MODÈLE PAYANT : POST /api/identifier/mesures (calcul-client-route.js::traiterMesures) ne lit que la ligne `analyses` du scan, le catalogue, la règle G rejouée sur les mesures du client et le grand livre ;
// il n'appelle ni la chaîne d'identification ni OpenRouter (un banc relit le source pour le prouver). Le coût reste celui de 9 scans : le carnet n'inscrit une dépense qu'à /api/identifier.
// Écrit par ce qu'il AUTORISE : une ligne n'est « conforme » que si CHAQUE champ listé est exactement celui du tableau ; un champ illisible, absent ou d'un autre type est un écart.
const CODE_ECART = 14, CODE_PHOTO_REFUSEE = 15, CODE_LIGNE_NON_JUGEE = 16;
const QUOTA_GRATUIT = 10;                                 // analyses RENDUES par jour de Paris pour un compte gratuit vérifié sans abonnement (config.quotas.gratuit)
const PLAFOND_PROBABLE_AUCUNE = 3;                        // remboursements « aucune » sur un probable, par jour (plafondDesProbables)
const VERSION_CLIENT = '2.0.1';                           // le niveau « probable » n'est servi qu'à partir de cette version (identifier/probable.js::VERSION_MIN_PROBABLE)
const DEDUIT = 'déduite du code du service (facturation.js, questions.js, ledger.js, calcul-client-route.js), pas observée sur l\'essai';

const F = (debite, reserve, rembourse, motif, raisonNonRembourse = null) => Object.freeze({ debite, reserve, rembourse, motif, raisonNonRembourse });
const AFFIRMEE = F(1, 0, false, 'affirmee'), RESERVEE = F(0, 1, false, 'question'), DEBITEE = F(1, 0, false, 'question'), RENDUE = F(0, 0, true, 'question');
const decl = (rendue, raison) => Object.freeze({ rendue, raison, plafondJour: PLAFOND_PROBABLE_AUCUNE });

/** Une issue admise : le niveau de la première réponse, le niveau FINAL (après l'éventuel second envoi), la déclaration envoyée et les facturations attendues. */
const issue = (nom, premier, final, declaration, premiere, second, reponse, declarationReponse, lettre) =>
    Object.freeze({ nom, premier, final, declaration, premiere, second, reponse, declarationReponse, ...(lettre ? { lettre } : {}), source: DEDUIT });
// les issues d'un probable : servi d'emblée par la première réponse, ou devenu probable par le second envoi (la tête du groupe, G-GROUPE → PROBABLE : débité à l'affichage)
const probable = (declaration, reponse, declarationReponse) => [
    issue('probable servi par la première réponse', 'probable', 'probable', declaration, DEBITEE, null, reponse, declarationReponse),
    issue('question devenue probable par le second envoi', 'question', 'probable', declaration, RESERVEE, DEBITEE, reponse, declarationReponse)
];

// cle : la clé de photo du banc (ou son préfixe UNIQUE) ; verite : l'idProduct de la vérité du banc (la ligne du banc doit la porter, sinon la série ne part pas)
// declaration : 'verite' (la lettre du candidat qui est la vérité), 'probable' (la lettre du probable : confirmation), 'aucune' (à dessein, sur un probable JUSTE : on mesure le remboursement), null (rien à déclarer)
const TABLEAU = Object.freeze([
    { rang: 1, cle: '6adbfe9c', verite: 286408, issues: [issue('sûr', 'sur', 'sur', null, AFFIRMEE, null, null, null)], restantApres: 9 },
    { rang: 2, cle: '6ad141f2', verite: 741918, issues: [issue('sûr', 'sur', 'sur', null, AFFIRMEE, null, null, null)], restantApres: 8 },
    { rang: 3, cle: '6ad00ce9', verite: 658690, restantApres: 7, issues: [
        issue('question, tranchée par la lettre de la vérité', 'question', 'question', 'verite', RESERVEE, null, DEBITEE, null, 'a'),
        issue('question promue sûre par le second envoi (un seul débit)', 'question', 'sur', null, RESERVEE, DEBITEE, null, null),
        issue('question devenue probable par le second envoi, confirmée', 'question', 'probable', 'probable', RESERVEE, DEBITEE, DEBITEE, null)] },
    { rang: 4, cle: '6ad149b7', verite: 525395, restantApres: 6, issues: probable('probable', DEBITEE, null) },
    { rang: 5, cle: '6ad08f2e', verite: 908409, restantApres: 6, issues: probable('aucune', RENDUE, decl(true, null)) },
    { rang: 6, cle: '6ad3e9db', verite: 289788, restantApres: 6, issues: probable('aucune', RENDUE, decl(true, null)) },
    { rang: 7, cle: '6ad3ea23', verite: 299573, restantApres: 6, issues: probable('aucune', RENDUE, decl(true, null)) },
    { rang: 8, cle: '6ad126bc', verite: 574302, restantApres: 5, issues: probable('aucune', F(1, 0, false, 'plafond-jour', 'plafond-jour'), decl(false, 'plafond-probable')) },
    { rang: 9, cle: '6ada72c6', verite: 295460, issues: [issue('introuvable remboursé', 'introuvable', 'introuvable', null, F(0, 0, true, 'introuvable'), null, null, null)], restantApres: 5 }
]);

const CHAMPS_FACTURATION = Object.freeze(['debite', 'reserve', 'rembourse', 'motif', 'raisonNonRembourse']);
const brut = v => (v === undefined ? 'absent' : JSON.stringify(v));
const ecart = (champ, attendu, observe) => ({ champ, attendu, observe });

/** Compare une facturation servie à celle du tableau, champ par champ (la `poche` est inscrite au carnet, jamais jugée). → le premier écart, ou null. */
function comparerFacturation(prefixe, attendue, servie) {
    if (!servie || typeof servie !== 'object') return ecart(`${prefixe}`, 'une facturation', brut(servie));
    for (const k of CHAMPS_FACTURATION) if (servie[k] !== attendue[k]) return ecart(`${prefixe}.${k}`, brut(attendue[k]), brut(servie[k]));
    return null;
}

/** L'issue admise de la ligne qui correspond à ce qui a été servi (niveau de la première réponse → niveau final), ou null. */
const trouverIssue = (att, obs) => (att && Array.isArray(att.issues) && obs ? att.issues.find(i => i.premier === obs.niveauPremier && i.final === obs.niveau) || null : null);

/**
 * Tout ce qui précède la déclaration : l'issue (la liste fermée de la ligne), le produit d'un sûr ou d'un probable (un FAUX est un écart aussi), la facturation de la première réponse, celle du second envoi quand il a changé le
 * résultat. → le premier écart, ou null. Le client ne déclare RIEN tant que cette étape n'est pas conforme.
 */
function comparerAvantDeclaration(att, obs) {
    if (!att || !obs) return ecart('ligne', 'une ligne et ses observations', 'absentes');
    const i = trouverIssue(att, obs);
    if (!i) return ecart('issue', att.issues.map(x => `${x.premier}->${x.final}`).join(' | '), `${brut(obs.niveauPremier)}->${brut(obs.niveau)}`);
    if ((i.final === 'sur' || i.final === 'probable') && obs.produit !== att.verite) return ecart('produit', att.verite, brut(obs.produit));
    const f1 = comparerFacturation('facturation', i.premiere, obs.facturation); if (f1) return f1;
    if (i.second) { const f2 = comparerFacturation('second.facturation', i.second, obs.facturation2); if (f2) return f2; }
    return null;
}

/**
 * Le PREMIER écart d'une ligne au tableau, dans l'ordre où les faits arrivent : l'issue, le produit, les facturations, la déclaration ENVOYÉE (choix), le statut et la facturation de la réponse du serveur à cette déclaration,
 * la déclaration que le serveur redit (plafond), le quota restant du jour après la ligne.
 * `obs` : { niveauPremier, niveau, produit, facturation, facturation2, choixEnvoye (null si rien envoyé), statutReponse, reponse: { facturation, declaration }, restantApres }.
 */
function comparerLigne(att, obs) {
    const p = comparerAvantDeclaration(att, obs); if (p) return p;
    const i = trouverIssue(att, obs);
    if (i.declaration === null) { if (obs.choixEnvoye !== null && obs.choixEnvoye !== undefined) return ecart('declaration envoyee', 'aucune', brut(obs.choixEnvoye)); }
    else {
        if (i.declaration === 'verite' && i.lettre && obs.choixEnvoye !== i.lettre) return ecart('declaration envoyee', i.lettre, brut(obs.choixEnvoye));
        if (i.declaration === 'aucune' && obs.choixEnvoye !== 'aucune') return ecart('declaration envoyee', 'aucune', brut(obs.choixEnvoye));
        if ((i.declaration === 'verite' || i.declaration === 'probable') && !(typeof obs.choixEnvoye === 'string' && /^[a-c]$/.test(obs.choixEnvoye))) return ecart('declaration envoyee', 'une lettre a-c', brut(obs.choixEnvoye));
        if (obs.statutReponse !== 200) return ecart('reponse.statut', 200, brut(obs.statutReponse));
        const f2 = comparerFacturation('reponse.facturation', i.reponse, obs.reponse && obs.reponse.facturation); if (f2) return f2;
        const d = obs.reponse && obs.reponse.declaration;
        if (i.declarationReponse === null) { if (d !== undefined && d !== null) return ecart('reponse.declaration', 'absente', brut(d)); }
        else {
            if (!d || typeof d !== 'object') return ecart('reponse.declaration', brut(i.declarationReponse), brut(d));
            for (const k of ['rendue', 'raison', 'plafondJour']) if (d[k] !== i.declarationReponse[k]) return ecart(`reponse.declaration.${k}`, brut(i.declarationReponse[k]), brut(d[k]));
        }
    }
    if (obs.restantApres !== att.restantApres) return ecart('quota restant apres', att.restantApres, brut(obs.restantApres));
    return null;
}

/** Les conditions de départ, jugées sur le premier /api/solde AVANT tout scan : un compte gratuit, ordinaire, au quota du jour intact. → un texte (la cause) ou null. */
function departInvalide(soldeEtOffre) {
    const o = soldeEtOffre && soldeEtOffre.offre, s = soldeEtOffre && soldeEtOffre.solde;
    if (!o || typeof o !== 'object' || !s || typeof s !== 'object') return 'solde illisible avant la série';
    if (s.compte && s.compte.administrateur === true) return 'le compte est administrateur : aucun débit ne se mesurerait';
    if (o.nom !== 'gratuit') return `l'offre du compte est « ${o.nom} », pas « gratuit » : le tableau ne vaut pas`;
    if (o.restant !== QUOTA_GRATUIT) return `quota du jour déjà entamé (restant ${brut(o.restant)} au lieu de ${QUOTA_GRATUIT}) : le tableau ne vaut que sur un compte au quota intact`;
    return null;
}

/**
 * Le code de sortie, écrit par ce qu'il AUTORISE : 0 n'est rendu que si la série est allée au bout SANS arrêt, SANS écart, SANS erreur et avec TOUTES les lignes du tableau jugées (9 sur 9). Une ligne non jugée (erreur hors Arret :
 * délai dépassé, fichier illisible…) est un échec dédié (16), jamais un « conforme » à 8 lignes sur 9. Un résultat absent ou illisible n'est pas 0 non plus.
 */
const codeSortie = r => {
    if (!r || typeof r !== 'object') return 1;
    if (r.ecart) return CODE_ECART;
    if (typeof r.arret === 'string' && r.arret.startsWith('PHOTO REFUSÉE')) return CODE_PHOTO_REFUSEE;
    if (r.ligneNonJugee || (Array.isArray(r.erreurs) && r.erreurs.length > 0)) return CODE_LIGNE_NON_JUGEE;
    if (r.arret) return 1;
    if (r.compteTest && !(Array.isArray(r.resultats) && r.resultats.length === TABLEAU.length)) return CODE_LIGNE_NON_JUGEE;
    return 0;
};

module.exports = { TABLEAU, trouverIssue, comparerLigne, comparerAvantDeclaration, comparerFacturation, departInvalide, codeSortie, CODE_ECART, CODE_PHOTO_REFUSEE, CODE_LIGNE_NON_JUGEE, QUOTA_GRATUIT, PLAFOND_PROBABLE_AUCUNE, VERSION_CLIENT, CHAMPS_FACTURATION, DEDUIT };

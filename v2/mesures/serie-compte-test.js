'use strict';
// SERIE-COMPTE-TEST (01/11) — les pièces PURES de la série du compte de test ORDINAIRE (serie-essai.js `--compte=ordinaire` les appelle ; elles n'ouvrent aucune connexion) :
//   · TABLEAU : les 9 lignes de la série, dans l'ORDRE, avec ce que l'essai doit répondre à chacune (§7 de serie-P-verifications.md : le niveau, la facturation servie, la déclaration envoyée, la réponse du serveur à cette
//     déclaration, le quota restant du jour de Paris) — les valeurs sont celles du cahier des charges, lues dans le code du service (facturation.js, questions.js, ledger.js), jamais devinées ;
//   · comparerLigne : confronte ce que l'essai a servi à la ligne attendue et rend LE PREMIER écart (champ, attendu, observé), ou null ; le client s'arrête là, sans adapter la suite ;
//   · codeSortie : 14 = écart au tableau, 15 = dépôt de photo refusé au compte ordinaire (aucun scan lancé), 16 = ligne NON JUGÉE (erreur hors Arret : la série s'arrête, le bilan exige 9 lignes jugées sur 9), 1 = autre arrêt, 0 = rien. (10, 11, 12 sont pris par serie-probable.js.)
// Écrit par ce qu'il AUTORISE : une ligne n'est « conforme » que si CHAQUE champ listé est exactement celui du tableau ; un champ illisible, absent ou d'un autre type est un écart.
const CODE_ECART = 14, CODE_PHOTO_REFUSEE = 15, CODE_LIGNE_NON_JUGEE = 16;
const QUOTA_GRATUIT = 10;                                 // analyses RENDUES par jour de Paris pour un compte gratuit vérifié sans abonnement (config.quotas.gratuit)
const PLAFOND_PROBABLE_AUCUNE = 3;                        // remboursements « aucune » sur un probable, par jour (plafondDesProbables)
const VERSION_CLIENT = '2.0.1';                           // le niveau « probable » n'est servi qu'à partir de cette version (identifier/probable.js::VERSION_MIN_PROBABLE)

const F = (debite, reserve, rembourse, motif, raisonNonRembourse = null) => Object.freeze({ debite, reserve, rembourse, motif, raisonNonRembourse });
const AFFIRMEE = F(1, 0, false, 'affirmee'), RESERVEE = F(0, 1, false, 'question'), DEBITEE = F(1, 0, false, 'question'), RENDUE = F(0, 0, true, 'question');
const decl = (rendue, raison) => Object.freeze({ rendue, raison, plafondJour: PLAFOND_PROBABLE_AUCUNE });

// cle : la clé de photo du banc (ou son préfixe UNIQUE) ; verite : l'idProduct de la vérité du banc (la ligne du banc doit la porter, sinon la série ne part pas)
// declaration : 'verite' (la lettre du candidat qui est la vérité), 'probable' (la lettre du probable : confirmation), 'aucune' (à dessein, sur un probable JUSTE : on mesure le remboursement)
const TABLEAU = Object.freeze([
    { rang: 1, cle: '6adbfe9c', verite: 286408, niveau: 'sur', declaration: null, premiere: AFFIRMEE, reponse: null, declarationReponse: null, restantApres: 9 },
    { rang: 2, cle: '6ad141f2', verite: 741918, niveau: 'sur', declaration: null, premiere: AFFIRMEE, reponse: null, declarationReponse: null, restantApres: 8 },
    { rang: 3, cle: '6ad00ce9', verite: 658690, niveau: 'question', declaration: 'verite', lettre: 'a', premiere: RESERVEE, reponse: DEBITEE, declarationReponse: null, restantApres: 7 },
    { rang: 4, cle: '6ad149b7', verite: 525395, niveau: 'probable', declaration: 'probable', premiere: DEBITEE, reponse: DEBITEE, declarationReponse: null, restantApres: 6 },
    { rang: 5, cle: '6ad08f2e', verite: 908409, niveau: 'probable', declaration: 'aucune', premiere: DEBITEE, reponse: RENDUE, declarationReponse: decl(true, null), restantApres: 6 },
    { rang: 6, cle: '6ad3e9db', verite: 289788, niveau: 'probable', declaration: 'aucune', premiere: DEBITEE, reponse: RENDUE, declarationReponse: decl(true, null), restantApres: 6 },
    { rang: 7, cle: '6ad3ea23', verite: 299573, niveau: 'probable', declaration: 'aucune', premiere: DEBITEE, reponse: RENDUE, declarationReponse: decl(true, null), restantApres: 6 },
    { rang: 8, cle: '6ad126bc', verite: 574302, niveau: 'probable', declaration: 'aucune', premiere: DEBITEE, reponse: F(1, 0, false, 'plafond-jour', 'plafond-jour'), declarationReponse: decl(false, 'plafond-probable'), restantApres: 5 },
    { rang: 9, cle: '6ada72c6', verite: 295460, niveau: 'introuvable', declaration: null, premiere: F(0, 0, true, 'introuvable'), reponse: null, declarationReponse: null, restantApres: 5 }
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

/** La première réponse seule (avant toute déclaration) : le niveau servi, le produit d'un sûr ou d'un probable (un FAUX est un écart aussi), la facturation. → le premier écart, ou null. Le client ne déclare RIEN tant que cette étape n'est pas conforme. */
function comparerPremiere(att, obs) {
    if (!att || !obs) return ecart('ligne', 'une ligne et ses observations', 'absentes');
    if (obs.niveau !== att.niveau) return ecart('niveau', att.niveau, brut(obs.niveau));
    if ((att.niveau === 'sur' || att.niveau === 'probable') && obs.produit !== att.verite) return ecart('produit', att.verite, brut(obs.produit));
    return comparerFacturation('facturation', att.premiere, obs.facturation);
}

/**
 * Le PREMIER écart d'une ligne au tableau, dans l'ordre où les faits arrivent : le niveau et le produit servis, la facturation de la première réponse, la déclaration ENVOYÉE (choix), le statut et la facturation de la réponse du
 * serveur à cette déclaration, la déclaration que le serveur redit (plafond), le quota restant du jour après la ligne et son solde avant.
 * `obs` : { niveau, produit, facturation, choixEnvoye (null si rien envoyé), statutReponse, reponse: { facturation, declaration }, restantAvant, restantApres, lettreVerite }.
 */
function comparerLigne(att, obs) {
    const p = comparerPremiere(att, obs); if (p) return p;
    if (att.declaration === null) { if (obs.choixEnvoye !== null && obs.choixEnvoye !== undefined) return ecart('declaration envoyee', 'aucune', brut(obs.choixEnvoye)); }
    else {
        if (att.declaration === 'verite' && att.lettre && obs.choixEnvoye !== att.lettre) return ecart('declaration envoyee', att.lettre, brut(obs.choixEnvoye));
        if (att.declaration === 'aucune' && obs.choixEnvoye !== 'aucune') return ecart('declaration envoyee', 'aucune', brut(obs.choixEnvoye));
        if ((att.declaration === 'verite' || att.declaration === 'probable') && !(typeof obs.choixEnvoye === 'string' && /^[a-c]$/.test(obs.choixEnvoye))) return ecart('declaration envoyee', 'une lettre a-c', brut(obs.choixEnvoye));
        if (obs.statutReponse !== 200) return ecart('reponse.statut', 200, brut(obs.statutReponse));
        const f2 = comparerFacturation('reponse.facturation', att.reponse, obs.reponse && obs.reponse.facturation); if (f2) return f2;
        const d = obs.reponse && obs.reponse.declaration;
        if (att.declarationReponse === null) { if (d !== undefined && d !== null) return ecart('reponse.declaration', 'absente', brut(d)); }
        else {
            if (!d || typeof d !== 'object') return ecart('reponse.declaration', brut(att.declarationReponse), brut(d));
            for (const k of ['rendue', 'raison', 'plafondJour']) if (d[k] !== att.declarationReponse[k]) return ecart(`reponse.declaration.${k}`, brut(att.declarationReponse[k]), brut(d[k]));
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

module.exports = { TABLEAU, comparerLigne, comparerPremiere, comparerFacturation, departInvalide, codeSortie, CODE_ECART, CODE_PHOTO_REFUSEE, CODE_LIGNE_NON_JUGEE, QUOTA_GRATUIT, PLAFOND_PROBABLE_AUCUNE, VERSION_CLIENT, CHAMPS_FACTURATION };

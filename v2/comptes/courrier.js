'use strict';
// Pilote de courrier. Seul le pilote MÉMOIRE existe : un envoi réel ne part donc jamais par accident (§5 Q15).
// B8.1 : tant que BREVO_API_KEY manque, c'est CE pilote que la production monte (comptes/monter.js). Son tableau est donc BORNÉ : sans borne, chaque inscription ou demande de
// réinitialisation y gardait pour toujours l'adresse et le lien (jeton compris) — une fuite de mémoire atteignable de l'extérieur. Les plus anciens partent d'abord.
const ENVOYES_MAX = 1000;
// O3 : le texte du courriel de confirmation. Une adresse peut être inscrite par un TIERS ; la phrase d'ignorance et le délai de suppression sont dits ici, une fois, pour tout pilote.
// Le pilote reçoit `{ purgeHeures }` en troisième argument (la valeur de la configuration, jamais écrite en dur dans le texte).
function texteVerification(lien, { purgeHeures = 48 } = {}) {
    return `Pour confirmer votre adresse et activer votre compte Rat-Market, ouvrez ce lien : ${lien}\n\n`
        + `Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : le compte sera supprimé sous ${purgeHeures} heures.`;
}
function creerCourrierMemoire() {
    const envoyes = [];
    const garder = e => { envoyes.push(e); while (envoyes.length > ENVOYES_MAX) envoyes.shift(); };
    return {
        reel: false,      // ne part nulle part : la passe d'avertissement des inactifs le refuse (elle marquerait des comptes sans rien envoyer)
        envoyes,
        async envoyerVerification(email, lien, options) { garder({ type: 'verification', email, lien, texte: texteVerification(lien, options) }); },
        async envoyerReinitialisation(email, lien) { garder({ type: 'reinit', email, lien }); },
        async envoyerAvertissement(email, donnees) { garder({ type: 'avertissement', email, ...donnees }); }
    };
}
// Le pilote Brevo vit dans courrier-brevo.js (chargé à la demande : un banc du pilote mémoire n'en a pas besoin).
function creerCourrierBrevo(options) { return require('./courrier-brevo').creerCourrierBrevo(options); }
module.exports = { creerCourrierMemoire, creerCourrierBrevo, texteVerification, ENVOYES_MAX };

'use strict';
// Pilote de courrier. Seul le pilote MÉMOIRE existe : un envoi réel ne part donc jamais par accident (§5 Q15).
// B8.1 : tant que BREVO_API_KEY manque, c'est CE pilote que la production monte (comptes/monter.js). Son tableau est donc BORNÉ : sans borne, chaque inscription ou demande de
// réinitialisation y gardait pour toujours l'adresse et le lien (jeton compris) — une fuite de mémoire atteignable de l'extérieur. Les plus anciens partent d'abord.
const ENVOYES_MAX = 1000;
function creerCourrierMemoire() {
    const envoyes = [];
    const garder = e => { envoyes.push(e); while (envoyes.length > ENVOYES_MAX) envoyes.shift(); };
    return {
        envoyes,
        async envoyerVerification(email, lien) { garder({ type: 'verification', email, lien }); },
        async envoyerReinitialisation(email, lien) { garder({ type: 'reinit', email, lien }); }
    };
}
function creerCourrierBrevo() { throw new Error('non-implemente'); }   // lot ultérieur
module.exports = { creerCourrierMemoire, creerCourrierBrevo, ENVOYES_MAX };

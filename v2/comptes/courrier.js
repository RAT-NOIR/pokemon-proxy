'use strict';
// Pilote de courrier. Seul le pilote MÉMOIRE existe : un envoi réel ne part donc jamais par accident (§5 Q15).
function creerCourrierMemoire() {
    const envoyes = [];
    return {
        envoyes,
        async envoyerVerification(email, lien) { envoyes.push({ type: 'verification', email, lien }); },
        async envoyerReinitialisation(email, lien) { envoyes.push({ type: 'reinit', email, lien }); }
    };
}
function creerCourrierBrevo() { throw new Error('non-implemente'); }   // lot ultérieur
module.exports = { creerCourrierMemoire, creerCourrierBrevo };

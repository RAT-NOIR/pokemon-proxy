'use strict';
// GALERIE — ce que `GET /api/compte` ajoute quand la Communauté est branchée : le `pseudo` (ou null) et le `role` (administrateur | moderateur | null). Un AJOUT : lot éteint ou base non branchée, la réponse reste celle d'avant, octet pour octet.
// Une panne de la base dédiée ne casse jamais la lecture du compte : on ajoute {} et on le journalise.
const G = require('./base');
const ROLES = Object.freeze(['administrateur', 'moderateur']);

async function champsCompte(compte) {
    if (!G.branche()) return {};
    try {
        const p = await G.col('profils').findOne({ _id: String(compte._id) }, { projection: { pseudo: 1 } });
        return { pseudo: p ? p.pseudo : null, role: ROLES.includes(compte.role) ? compte.role : null };
    } catch (e) {
        console.error(`❌ [v2 galerie] profil du compte : ${(e && e.name) || 'Error'}`);
        return {};
    }
}
module.exports = { champsCompte, ROLES };

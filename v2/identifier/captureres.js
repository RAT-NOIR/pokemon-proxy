'use strict';
// B1b.2 — le double de `res` que la chaîne héritée (gererIdentifier) reçoit. Il capture la réponse au lieu de l'envoyer.
// `headersSent` est HONNÊTE : faux tant que rien n'est parti, vrai dès la première livraison (json() ou end()).
// rembourserSiRienLivre (index.js) le lit : un `headersSent` vrai à tort priverait l'utilisateur de son remboursement,
// un faux à tort le rembourserait d'un résultat livré. La chaîne ne doit jamais répondre deux fois : le second envoi est
// ignoré et COMPTÉ (`doubles`), jamais écrasé.
function fauxRes() {
    const res = {
        statusCode: 200, statut: null, corps: null, headersSent: false, doubles: 0, entetes: {},
        status(c) { if (!this.headersSent) this.statusCode = c; return this; },
        setHeader(k, val) { this.entetes[String(k).toLowerCase()] = val; return this; },
        json(o) { return livrer(this, o === undefined ? null : o); },
        // sans corps : la réponse est partie vide (corps null) ; l'adaptateur la traite comme une panne
        end() { return livrer(this, null); }
    };
    function livrer(r, corps) {
        if (r.headersSent) { r.doubles++; return r; }
        r.headersSent = true;
        r.corps = corps;
        r.statut = r.statusCode;
        return r;
    }
    return res;
}

module.exports = { fauxRes };

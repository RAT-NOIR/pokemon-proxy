'use strict';
// Un refus du mécanisme de sauvegarde : un CODE (jamais une donnée, jamais un identifiant) — c'est tout ce qui est journalisé.
class RefusSauvegarde extends Error {
    constructor(code, detail) { super(code); this.name = 'RefusSauvegarde'; this.code = code; if (detail !== undefined) this.detail = detail; }
}
const refuser = (code, detail) => { throw new RefusSauvegarde(code, detail); };
module.exports = { RefusSauvegarde, refuser };

'use strict';
// GALERIE — un refus de démarrer, avec sa CAUSE NOMMÉE (jamais une valeur de variable, jamais une adresse). Les causes : `variable-absente`, `grappe-differente`, `marqueur-absent`, `marqueur-incorrect`,
// `collection-inconnue` (le détail liste les noms de collections), `marqueur-r2-absent`, `marqueur-r2-incorrect`. Une garde qui ne peut pas conclure BLOQUE et dit pourquoi.
class RefusGalerie extends Error {
    constructor(cause, detail) { super(cause); this.name = 'RefusGalerie'; this.cause = cause; this.detail = detail; }
}
module.exports = { RefusGalerie };

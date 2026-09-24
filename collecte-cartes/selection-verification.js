// ============================================================
// QUELLES LIGNES verifier-table.js --auto JUGE-T-IL, ET QUAND PEUT-IL RETIRER UNE ADMISSION ? (2026-09-24)
// ============================================================
// 🔴 L'OCCURRENCE : TK1 (EX Trainer Kit), admise à la main et collectée, n'avait pas de fiche `verif` — elle avait été
// admise autrement que par ce juge. Le bloc par défaut prenait `!l.verif` pour « jamais jugée » : il l'a rejugée deux fois
// en jugeant des lignes neuves, et `delete l.verifie` l'a déclassée. **Une vérification qui modifie un verdict existant est
// une écriture qui modifie** (§60) : elle ne porte que sur ce qu'on lui NOMME.
// 🔑 La sélection s'écrit par ce qu'elle AUTORISE : par défaut, une ligne qui n'a NI verdict NI admission ; `--rejuger`
// ajoute les refusées ; seul `--codes=` touche une ligne admise. Banc : test-selection-verification.js.
const jamaisJugee = l => !l.verif && !l.verifie;

function lignesAJuger(table, { codes = null, rejuger = false, region = null, taille = 20 } = {}) {
    return table
        .filter(l => (codes ? codes.includes(l.code) : (rejuger ? !l.verifie : jamaisJugee(l))) && (!region || l.region === region))
        .slice(0, taille);
}

/** Une admission ne se retire que sur une ligne NOMMÉE par `--codes=` — jamais sur une ligne prise par un bloc. */
function peutRetirerAdmission(l, { codes = null } = {}) {
    return !!(codes && codes.includes(l.code));
}

module.exports = { lignesAJuger, peutRetirerAdmission, jamaisJugee };

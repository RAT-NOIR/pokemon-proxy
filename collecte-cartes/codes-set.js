// ============================================================
// LE CODE D'UNE EXPANSION APPRIS AU FIL DE L'EAU (`codes_set`) — une définition pour la route et pour les outils (§21 bis)
// ============================================================
// Sorti d'index.js le 2026-09-27 (soir) : l'intégration de la file en attente de l'userscript (integrer-file-attente.js) appelle
// `apprendreLot` hors du serveur, et `memoriserCodeSet` n'existait que dans index.js, liée à mongoose. La RÈGLE vit ici ; l'accès à la
// base est injecté — la route garde son modèle mongoose (mêmes conversions, même upsert), un outil passe le pilote natif.
//  · un code arrive parfois encodé (« SVP%2FCS » au lieu de « SVP/CS ») : `decoderCodeSet` le décode, une séquence malformée reste telle
//    quelle plutôt que de faire échouer l'apprentissage ;
//  · ⚠️ UNE LIGNE APPRISE NE S'ÉCRASE PAS (2026-09-06) : `codes_set` est l'une des deux tables non régénérables ; un code DIFFÉRENT
//    pour une expansion déjà apprise est refusé et tracé, le même code est réécrit (apprisLe se rafraîchit) ;
//  · ⚠️ MONGO PAS PRÊT : ON LÈVE (2026-09-07) — attrapé et journalisé, comme avant : un `return` muet faisait croire à l'appelant que
//    le code était mémorisé. `idExpansion`/`codeSet` absents restent un `return` muet : une carte sans code est le cas ordinaire.

function decoderCodeSet(codeSet) {
    if (!codeSet) return codeSet;
    const s = String(codeSet);
    if (!s.includes('%')) return s;
    try { return decodeURIComponent(s); } catch (_) { return s; }
}

/**
 * @param {{ lire: (idExpansion) => Promise<{codeSet?: string}|null>, ecrire: (idExpansion, codeSet) => Promise<any>,
 *           pret?: () => boolean, journal?: Console }} acces
 * @returns {(idExpansion, codeSetBrut) => Promise<void>}
 */
function fabriquerMemoriserCodeSet({ lire, ecrire, pret = () => true, journal = console }) {
    if (typeof lire !== 'function' || typeof ecrire !== 'function') throw new TypeError('fabriquerMemoriserCodeSet : lire et ecrire sont obligatoires');
    return async function memoriserCodeSet(idExpansion, codeSetBrut) {
        const codeSet = decoderCodeSet(codeSetBrut);
        try {
            if (!pret()) throw new Error('memoriserCodeSet appelée sans connexion Mongo — l\'appelant doit refuser en amont (503)');
            if (!idExpansion || !codeSet) return;
            const existant = await lire(idExpansion);
            if (existant && existant.codeSet && existant.codeSet !== codeSet) {
                journal.warn(`🚫 [codes_set] idExpansion ${idExpansion} porte déjà « ${existant.codeSet} » : « ${codeSet} » n'écrase pas une ligne apprise.`);
                return;
            }
            await ecrire(idExpansion, codeSet);
            journal.log(`🧠 Code set appris et mémorisé : idExpansion ${idExpansion} -> ${codeSet}`);
        } catch (e) {
            journal.error('Erreur mémorisation codeSet:', e.message);
        }
    };
}

/** L'accès par le PILOTE natif (outils) : mêmes conversions que le schéma de la route (idExpansion nombre, apprisLe date). */
function accesNatif(collection) {
    return {
        lire: id => collection.findOne({ idExpansion: Number(id) }, { projection: { codeSet: 1 } }),
        ecrire: (id, cs) => collection.updateOne({ idExpansion: Number(id) }, { $set: { idExpansion: Number(id), codeSet: String(cs), apprisLe: new Date() } }, { upsert: true })
    };
}

module.exports = { decoderCodeSet, fabriquerMemoriserCodeSet, accesNatif };

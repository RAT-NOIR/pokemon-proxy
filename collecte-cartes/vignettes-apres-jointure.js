// ============================================================
// LES VIGNETTES APRÈS UNE JOINTURE — une seule définition, pour le worker ET pour le rejeu (§21 bis)
// ============================================================
// 🔴 INCIDENT DU 2026-10-08 (01:10 UTC) : `lot-additif.js … collecteur-images.js --rejouer-jointure=mC,svEM,sN,mF,SV-P` a rattaché 47 images
// (voulu) et EFFACÉ le champ `vignette` de 1 089 entrées de cartes.images : une jointure RÉÉCRIT les entrées (vignette.js, en-tête), et
// seul le chemin du worker appelait `assurerVignettes` ensuite. Le chemin du rejeu ne l'appelait pas : deux exemplaires d'une règle
// (« après une jointure, les vignettes se recopient du document `images` »), l'un appliqué, l'autre non.
// Les deux chemins passent désormais ICI, avec les mêmes options ; `assurer` s'injecte pour le banc (test-vignettes-apres-jointure.js).
// ➕ 2026-10-31 : le scan « MOYEN » (400 px, collecte-cartes/moyen.js) se fabrique DANS CETTE MÊME ÉTAPE (demande du site : « avec la vignette,
// dans la même étape, pour toute image ajoutée ou remplacée »). Tous les collecteurs qui appellent cette fonction l'ont donc sans changer d'une ligne.
// Les deux sont indépendants : la panne de l'un ne prive pas l'autre de sa passe.
const { assurerVignettes } = require('./vignette');
const { assurerMoyens } = require('./moyen');

/**
 * @returns {Promise<{vg: object, sets: string[]}>} `vg` : le bilan tel que le worker l'écrit sur l'unité (`vg.moyens` : celui des moyens) ; `sets` : les sets dont
 * une entrée a reçu une vignette OU un moyen (à revalider avec `slug`). Ne lève pas : un échec est rendu dans `vg.erreur` / `vg.moyens.erreur`.
 */
async function vignetterApresJointure(db, slug, { bucket, arreter = () => false, assurer = assurerVignettes, assurerMoy = assurerMoyens, journal = console } = {}) {
    let vg, sets = [];
    try {
        const V = await assurer(db, { bucket, slug, parallele: 4, arreter });
        vg = { entrees: V.entrees, images: V.cles, traitees: V.traitees, fabriquees: V.fabriquees, deja: V.deja, depuisDocument: V.depuisDocument, echecs: V.echecs.length, interrompu: V.interrompu };
        sets = V.sets || [];
    } catch (e) {
        journal.error(`🔴 vignettes de ${slug} : ${e.message}`);
        vg = { erreur: e.message };
    }
    try {
        // `reverifier` : l'original d'une entrée a pu être remplacé sous la même clé R2 -> son moyen est refait (moyen.js)
        const M = await assurerMoy(db, { bucket, slug, parallele: 4, arreter, reverifier: true, journal });
        vg.moyens = { entrees: M.entrees, images: M.cles, traitees: M.traitees, fabriquees: M.fabriquees, refaites: M.refaites, retirees: M.retirees, deja: M.deja, depuisDocument: M.depuisDocument, echecs: M.echecs.length, interrompu: M.interrompu };
        sets = [...new Set([...sets, ...(M.sets || [])])];
    } catch (e) {
        journal.error(`🔴 moyens de ${slug} : ${e.message}`);
        vg.moyens = { erreur: e.message };
    }
    return { vg, sets };
}

module.exports = { vignetterApresJointure };

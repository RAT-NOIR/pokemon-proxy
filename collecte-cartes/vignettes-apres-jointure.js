// ============================================================
// LES VIGNETTES APRÈS UNE JOINTURE — une seule définition, pour le worker ET pour le rejeu (§21 bis)
// ============================================================
// 🔴 INCIDENT DU 2026-10-08 (01:10 UTC) : `lot-additif.js … collecteur-images.js --rejouer-jointure=mC,svEM,sN,mF,SV-P` a rattaché 47 images
// (voulu) et EFFACÉ le champ `vignette` de 1 089 entrées de cartes.images : une jointure RÉÉCRIT les entrées (vignette.js, en-tête), et
// seul le chemin du worker appelait `assurerVignettes` ensuite. Le chemin du rejeu ne l'appelait pas : deux exemplaires d'une règle
// (« après une jointure, les vignettes se recopient du document `images` »), l'un appliqué, l'autre non.
// Les deux chemins passent désormais ICI, avec les mêmes options ; `assurer` s'injecte pour le banc (test-vignettes-apres-jointure.js).
const { assurerVignettes } = require('./vignette');

/**
 * @returns {Promise<{vg: object, sets: string[]}>} `vg` : le bilan tel que le worker l'écrit sur l'unité ; `sets` : les sets dont une entrée
 * a reçu une vignette (à revalider avec `slug`). Ne lève pas : un échec est rendu dans `vg.erreur`.
 */
async function vignetterApresJointure(db, slug, { bucket, arreter = () => false, assurer = assurerVignettes, journal = console } = {}) {
    try {
        const V = await assurer(db, { bucket, slug, parallele: 4, arreter });
        return {
            vg: { entrees: V.entrees, images: V.cles, traitees: V.traitees, fabriquees: V.fabriquees, deja: V.deja, depuisDocument: V.depuisDocument, echecs: V.echecs.length, interrompu: V.interrompu },
            sets: V.sets || []
        };
    } catch (e) {
        journal.error(`🔴 vignettes de ${slug} : ${e.message}`);
        return { vg: { erreur: e.message }, sets: [] };
    }
}

module.exports = { vignetterApresJointure };

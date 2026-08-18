// ============================================================
// UNE SOURCE RAPPORTE, L'APPELANT DÉCIDE
// ============================================================
// POURQUOI CE MODULE EXISTE. Six fonctions d'index.js interrogeaient une source — Mongo,
// TCGdex — et rendaient `[]` aussi bien quand elles n'avaient RIEN TROUVÉ que quand elles
// n'avaient PAS PU CHERCHER :
//
//     } catch (e) { console.error(...); return []; }
//
// Une liste vide ne dit alors plus rien. Pire : elle dit quelque chose de FAUX, parce que
// l'aval la lit comme un fait sur le catalogue. Un refus `carte-introuvable` construit
// sur ce vide affirme « cette carte n'existe pas » alors que personne n'a regardé — et il
// sort en 'refus-delibere', c'est-à-dire en doré, dans la couleur qui dit que la chaîne a
// fonctionné.
//
//   ⚠️ C'EST LA TROISIÈME FOIS QUE ABSENCE ET PANNE SE CONFONDENT DANS CE PROJET.
//   D'abord `carte-introuvable` sur une panne TCGdex (2026-08-15, fermé par 91ac511) ;
//   puis `totalInvalidable` calculé sur une liste de sets vide parce qu'injoignable
//   (2026-08-18) ; ici, les six requêtes catalogue. À chaque fois la même forme : une
//   ABSENCE DE DONNÉE lue comme une VALEUR CONTRAIRE, et à chaque fois c'est le premier
//   principe qui est violé — « je ne sais pas » n'est pas « je sais que non ».
//
// LA FORME, ET ELLE EST DÉLIBÉRÉE : le helper enveloppe AU POINT D'APPEL, jamais dans la
// fonction interrogée. Une fonction qui décide seule qu'une panne vaut `[]` EST le défaut
// qu'on corrige. La source rapporte — elle laisse remonter son exception — et l'appelant
// décide quoi en faire.
//
// ⚠️ ET LE PATRON N'EST PAS NEUF : `identifierParTotalEtNumero` le suit déjà dans
// index.js, où chaque set injoignable incrémente `setsInjoignables` et rend le résultat
// incertain. Ce module généralise ce qui marchait déjà trente lignes plus haut.

const { AsyncLocalStorage } = require('async_hooks');

// ⚠️ POURQUOI UN AsyncLocalStorage ET PAS UNE VARIABLE DE MODULE. Node est
// mono-thread, mais deux scans concurrents s'entrelacent à chaque `await` : un compteur
// de module ferait porter à l'un les pannes de l'autre. Ce serait une nouvelle source de
// verdicts faux, introduite par le correctif d'une source de verdicts faux.
// ⚠️ ET PAS NON PLUS UN PARAMÈTRE DE PLUS SUR CHAQUE SIGNATURE : un appelant qui oublie
// de le passer ne casse rien et ne signale rien — c'est exactement le mode de
// défaillance silencieux qu'on ferme.
const pannesDuScan = new AsyncLocalStorage();

/** Ouvre un contexte de scan. Tout ce qui tombe pendant `suite` est retenu ici. */
const dansUnScan = suite => pannesDuScan.run(new Set(), suite);

/**
 * Les sources tombées pendant CE scan, par nom.
 * ⚠️ Le NOM et pas seulement le compte : sans lui on saura qu'il y a eu une panne sans
 * savoir laquelle, et on refera l'enquête du 2026-08-15 à chaque fois. Le compte est la
 * longueur du tableau — on ne stocke pas un dérivé de plus.
 * Hors contexte de scan (banc, sondes, tests), rend [] : rien à mesurer, rien à fausser.
 */
const sourcesTombees = () => [...(pannesDuScan.getStore() ?? [])];

/**
 * Interroge une source et rend DEUX ÉTATS, jamais un.
 *
 *   { liste: [...], panne: false }  la source a répondu — voilà ce qu'elle a
 *   { liste: [],    panne: true  }  on n'a PAS PU regarder. CE N'EST PAS UNE ABSENCE.
 *
 * @param {string} quoi      le nom de la source, tel qu'il ira au journal
 * @param {() => Promise<any[]>} requete
 */
async function interrogerSource(quoi, requete) {
    try {
        const liste = await requete();
        return { liste: Array.isArray(liste) ? liste : [], panne: false };
    } catch (e) {
        // Le log reste (il porte la cause exacte), mais il ne suffit plus : les logs de
        // Render sont éphémères, et c'est précisément pour ça que les deux pannes du
        // 2026-08-15 ont demandé une enquête au lieu d'une requête.
        console.error(`❌ [source-injoignable] ${quoi} : ${e?.message ?? e}`);
        pannesDuScan.getStore()?.add(quoi);
        return { liste: [], panne: true };
    }
}

module.exports = { interrogerSource, dansUnScan, sourcesTombees };

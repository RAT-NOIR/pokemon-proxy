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

// ⚠️ COMPTEUR DES PANNES TOMBÉES HORS DE TOUT SCAN — voir `interrogerSource`.
// Volontairement un compteur de PROCESSUS et non de scan : par définition, ces
// pannes-là n'appartiennent à aucun scan. Il n'existe que pour être lu par un contrôle
// et par le verrou ; aucune décision ne s'en sert.
let _horsContexte = 0;
const pannesHorsContexte = () => _horsContexte;

/**
 * Interroge une source et rend DEUX ÉTATS, jamais un.
 *
 *   { liste: [...], valeur: …,  panne: false }  la source a répondu — voilà ce qu'elle a
 *   { liste: [],    valeur: null, panne: true }  on n'a PAS PU regarder. PAS UNE ABSENCE.
 *
 * ⚠️ DEUX SORTIES POUR UNE SEULE VÉRITÉ, ET C'EST VOULU. La plupart des sources rendent
 * un TABLEAU de candidats : `liste` est ce tableau, garanti tableau même si la source a
 * rendu autre chose, pour qu'aucun appelant ne lise `.length` sur `undefined`. Mais
 * `identifierEnLocal` rend un OBJET ou `null` — le coercer en `[]` le détruirait. `valeur`
 * porte donc le résultat BRUT. Deux fonctions auraient divergé ; deux champs, non.
 *
 * Le champ `horsContexte` n'est vrai que dans le cas anormal décrit ci-dessous.
 *
 * @param {string} quoi      le nom de la source, tel qu'il ira au journal
 * @param {() => Promise<any>} requete
 */
async function interrogerSource(quoi, requete) {
    try {
        const valeur = await requete();
        return { liste: Array.isArray(valeur) ? valeur : [], valeur, panne: false, horsContexte: false };
    } catch (e) {
        // Le log reste (il porte la cause exacte), mais il ne suffit plus : les logs de
        // Render sont éphémères, et c'est précisément pour ça que les deux pannes du
        // 2026-08-15 ont demandé une enquête au lieu d'une requête.
        console.error(`❌ [source-injoignable] ${quoi} : ${e?.message ?? e}`);

        // ════════════════════════════════════════════════════════════════════
        // 🔴 UNE PANNE HORS CONTEXTE EST BRUYANTE, JAMAIS SILENCIEUSE
        // ════════════════════════════════════════════════════════════════════
        // `pannesDuScan.getStore()?.add(...)` — l'optional chaining — ne coûtait rien à
        // écrire et RÉINTRODUISAIT le défaut qu'on venait de supprimer : sans contexte, la
        // panne disparaissait, et la ligne sortait comme une absence CONSTATÉE. Le même
        // motif que les six `catch -> return []`, reproduit par la mécanique censée les
        // corriger, et indétectable — c'est le pire des deux mondes.
        //
        // QUAND ÇA ARRIVE, ET C'EST LA LISTE À TENIR À JOUR :
        //   · un appel avant le middleware `dansUnScan` (il est posé après express.json(),
        //     donc APRÈS la route /api/webhook-stripe, déclarée plus haut) ;
        //   · une tâche différée qui n'hérite pas du contexte de la requête ;
        //   · un script en ligne de commande (banc, sondes) — cas LÉGITIME, et c'est
        //     pourquoi on ne lève pas : on le signale, on ne casse pas l'outillage.
        //
        // ⚠️ L'APPELANT, LUI, N'EST PAS TROMPÉ : il reçoit `panne: true` dans les deux cas.
        // Ce qui se perd hors contexte, c'est la trace AMBIANTE — celle que lisent
        // `champsDeRefus` et le journal. C'est exactement ce qu'il faut rendre visible.
        const store = pannesDuScan.getStore();
        if (store) store.add(quoi);
        else {
            _horsContexte++;
            console.error(`🔴 [panne-hors-contexte] ${quoi} est tombée HORS de tout scan :` +
                ` ni le journal ni le motif de refus ne la verront. Si ça vient d'une route,` +
                ` c'est un bug — le contexte doit envelopper TOUT le corps de la requête.`);
        }
        return { liste: [], valeur: null, panne: true, horsContexte: !store };
    }
}

module.exports = { interrogerSource, dansUnScan, sourcesTombees, pannesHorsContexte };

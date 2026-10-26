'use strict';
// SUR-PAR-IMAGE — une QUESTION dont les candidats ne sont PAS le même dessin devient un SÛR quand la photo est nettement plus proche d'un seul d'entre eux. Module PUR : ni base, ni réseau, ni modèle, ne lève jamais.
// 🔴 « 0 faux affirmé est non négociable » : la règle ne fait QUE changer une question en sûr. Elle ne touche jamais un sûr, un refus ni un « je ne sais pas » (c'est l'appelant qui ne la consulte que sur une question), et elle
// se TAIT — la question reste celle d'avant — sur toute donnée manquante ou douteuse. Écrite par ce qu'elle AUTORISE : un seul chemin mène à `sur: true`, les sept conditions suivantes tenues ensemble.
//   0. le vecteur de la photo vient d'une carte REDRESSÉE (le vecteur de la photo entière ne se mesure pas à l'index : cosinus plafonné, cadre de la photo) ;
//   1. tous les candidats de la question ont une entrée d'archive (clé de leur grande image), une empreinte à l'index, et la photo un vecteur : un cosinus par candidat ;
//   2. aucun rival du MÊME DESSIN que le meilleur — la définition de la production : le groupe de dessin du contexte G (ctx.groupe, ratmarket/decision-g.js), ou le même visuel. Importée, jamais recopiée : aucun seuil de cosinus
//      entre candidats n'existe dans le code (le 0,9 de l'audit n'en est pas un) ;
//   3. le meilleur candidat est le voisin n°1 de la photo dans l'index ENTIER (sa clé est la première) ;
//   4. sa carte (et celle des frères de son groupe de dessin, comme decision-g.js) n'a aucun produit SANS visuel : l'image ne peut pas exclure ce qu'elle n'a jamais vu ;
//   5. l'écart de cosinus au SECOND candidat est au moins M = SEUILS_G.marge_carte (0,2) — la marge de la règle G, lue dans le code, jamais dans la liste des cas qu'elle fait passer ;
//   +  le visuel du meilleur ne porte que CE produit (ni autre produit au même visuel, ni partage de l'archive) ;
//   6. aucun champ LU sur la photo (numéro, total, code, langue — garde-contradiction.statuts, la définition de la production — et les marques) ne contredit le désigné : deux sources en conflit ne donnent jamais un sûr (§73) ;
//   7. aucun candidat n'a un visuel suspect (basse définition, fichier partagé avec une autre carte, emprunté, signalé faux) — voir plus bas ;
//   +  les jumeaux du désigné sont tous candidats de la question (aucun rival caché hors de la question).
const G = require('../../ratmarket/decision-g');
const { statuts, CHAMPS } = require('./garde-contradiction');
const MT = require('./marques-tampon');
const { statutsPourImage } = require('./comparateur-image');

const MARGE = G.SEUILS_G.marge_carte;                      // M : la marge de la règle G (decision-g.js:25)
const MOTIFS = Object.freeze(['photo-non-redressee', 'candidats', 'donnee-manquante', 'meme-dessin', 'pas-voisin-n1', 'produit-sans-visuel', 'ecart', 'emprunt-inconnu', 'visuel-suspect', 'visuel-partage', 'contredit', 'marques', 'jumeaux']);
const se_tait = motif => ({ sur: false, motif });
const fini = x => typeof x === 'number' && Number.isFinite(x);
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);

/**
 * @param {object} e
 *   ids        les idProduct de la question (au moins 2, distincts)
 *   cles       Map idProduct -> clé de la GRANDE image à l'archive (version.entree(id).grande.cle)
 *   cosinus    (cle) -> cosinus entre le vecteur de la photo et l'empreinte de `cle` à l'index, ou null si la clé n'y est pas
 *   top1       la clé du voisin n°1 de la photo dans l'index entier
 *   contexte   le contexte G de l'index (G.contexte(...))
 *   signaux    (idProduct) -> { basse, partageAutreDessin } (chacun false|true|null) : la basse définition de l'archive et le partage de fichier avec une autre métacarte ; tout ce qui n'est pas `false` se tait
 *   emprunte   (idProduct) -> false|true|null : le visuel est-il celui d'un AUTRE tirage ? FONCTION INJECTÉE (absente : la règle se tait sur toute la question) ; seul `false` laisse passer
 *   partages   (idProduct) -> les produits que l'image ne sépare pas (colonne de l'archive), ou null si la colonne est indisponible
 *   jumeaux    (idProduct) -> { conclu, ids } (jumeaux.js), ou absent
 *   produits   Map idProduct -> ligne de catalogue de l'API
 *   lu         la lecture de la photo (garde-contradiction.lectureDe) ou null si rien n'a été lu
 *   marquesLues les marques lues deux fois sur la carte (liste fermée) ou null
 *   redressee  vrai si le vecteur est celui d'une carte redressée
 *   comparateur true EXACTEMENT : la condition (6) passe par le comparateur juste (comparateur-image.js, V2_SPI_COMPARATEUR) ; absent ou autre chose : la définition brute de la production
 *   marge      M (défaut : celui du code) — pour les bancs de mesure seulement
 * @returns {{sur:true, produit:number, ecart:number, cosinus:number, raison:string} | {sur:false, motif:string}}
 */
function decider(e) {
    try {
        if (!e || typeof e !== 'object') return se_tait('donnee-manquante');
        const marge = e.marge === undefined ? MARGE : e.marge;
        if (!fini(marge) || marge <= 0) return se_tait('donnee-manquante');
        if (e.redressee !== true) return se_tait('photo-non-redressee');
        const ids = e.ids;
        if (!Array.isArray(ids) || ids.length < 2 || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) return se_tait('candidats');
        const ctx = e.contexte;
        if (!ctx || !(ctx.groupe instanceof Map) || !(ctx.membres instanceof Map) || !(ctx.carte instanceof Map) || !(ctx.invisibles instanceof Map) || !(ctx.produits instanceof Map)) return se_tait('donnee-manquante');
        if (typeof e.top1 !== 'string' || !e.top1 || typeof e.cosinus !== 'function' || !(e.cles instanceof Map)) return se_tait('donnee-manquante');
        // (1) un cosinus par candidat
        const cs = [];
        for (const id of ids) {
            const cle = e.cles.get(id);
            if (typeof cle !== 'string' || !cle) return se_tait('donnee-manquante');
            const cos = e.cosinus(cle);
            if (!fini(cos)) return se_tait('donnee-manquante');
            cs.push({ id, cle, cos });
        }
        // (7) AUCUN candidat (le meilleur comme les rivaux) n'a un visuel suspect : en basse définition, ou partagé avec un produit d'une AUTRE carte (autre métacarte : un autre dessin — cas Masaki). Le signal manque
        //     (null, fournisseur absent) : défaut fermé. Un visuel emprunté ou signalé faux (liste d'exclusion) n'a pas d'entrée d'archive : la condition (1) se tait déjà (decision.js:54-58, calcul.js:6-14).
        //     L'EMPRUNT se lit par une fonction INJECTÉE (`e.emprunte`, point de branchement du chargeur) : sans elle — archive sans marque —, la règle se tait sur TOUTE la question (motif « emprunt-inconnu »).
        if (typeof e.emprunte !== 'function') return se_tait('emprunt-inconnu');
        for (const c of cs) {
            const s = typeof e.signaux === 'function' ? e.signaux(c.id) : null;
            if (!s || s.basse !== false || s.partageAutreDessin !== false || e.emprunte(c.id) !== false) return se_tait('visuel-suspect');
        }
        cs.sort((a, b) => b.cos - a.cos || a.id - b.id);
        const meilleur = cs[0], second = cs[1], rivaux = cs.slice(1);
        // (2) aucun rival du même dessin : le même visuel, ou le même groupe du contexte G
        const g0 = ctx.groupe.has(meilleur.cle) ? ctx.groupe.get(meilleur.cle) : undefined;
        for (const r of rivaux) {
            if (r.cle === meilleur.cle) return se_tait('meme-dessin');
            if (g0 !== undefined && ctx.groupe.get(r.cle) === g0) return se_tait('meme-dessin');
        }
        // (3) le voisin n°1 de l'index entier
        if (e.top1 !== meilleur.cle) return se_tait('pas-voisin-n1');
        // (4) aucun produit sans visuel, sur la carte et sur celle des frères du groupe (decision-g.js:91-93)
        if (!ctx.carte.has(meilleur.cle)) return se_tait('donnee-manquante');
        const freres = g0 !== undefined ? (ctx.membres.get(g0) || []).filter(k => k !== meilleur.cle) : [];
        const cartes = [...ctx.carte.get(meilleur.cle), ...freres.flatMap(k => [...(ctx.carte.get(k) || [])])];
        if (cartes.some(c => (ctx.invisibles.get(c) || []).length > 0)) return se_tait('produit-sans-visuel');
        // (5) l'écart au second candidat
        const ecart = meilleur.cos - second.cos;
        if (!(ecart >= marge)) return se_tait('ecart');
        // le visuel du meilleur ne porte que ce produit, et l'archive ne le partage avec personne
        const prods = ctx.produits.get(meilleur.cle);
        if (!Array.isArray(prods) || prods.length !== 1 || !Array.isArray(prods[0]) || prods[0][0] !== meilleur.id) return se_tait('visuel-partage');
        const partages = typeof e.partages === 'function' ? e.partages(meilleur.id) : null;
        if (!Array.isArray(partages) || partages.some(i => i !== meilleur.id)) return se_tait('visuel-partage');
        // (6) aucun champ lu ne contredit le désigné
        if (!(e.produits instanceof Map) || !e.produits.has(meilleur.id)) return se_tait('donnee-manquante');
        const ligne = e.produits.get(meilleur.id);
        if (e.lu) {
            // SPI-CONTRADICTIONS (V2_SPI_COMPARATEUR, `e.comparateur === true` exactement) : le comparateur juste (comparateur-image.js) à la place de la définition brute de la production ; les autres candidats servent à reconnaître un jumeau ou un rival à l'attaque concordante ; une ligne absente reste undefined (détection indécidable : le veto reste)
            const st = e.comparateur === true ? statutsPourImage(e.lu, ligne, ids.filter(i => i !== meilleur.id).map(i => e.produits.get(i))) : statuts(e.lu, ligne);
            if (CHAMPS.some(k => st[k] === 'ko')) return se_tait('contredit');
        }
        if (Array.isArray(e.marquesLues) && e.marquesLues.length) {
            const lu = MT.jetonDeMarques(e.marquesLues), porte = Array.isArray(ligne.marques) && ligne.marques.length ? MT.jetonDeMarques(ligne.marques) : null;
            if (lu === null || lu !== porte) return se_tait('marques');
        }
        // les jumeaux du désigné sont tous candidats de la question
        const j = typeof e.jumeaux === 'function' ? e.jumeaux(meilleur.id) : null;
        if (!j || j.conclu !== true || !Array.isArray(j.ids) || !j.ids.every(Number.isInteger) || j.ids.some(i => !ids.includes(i))) return se_tait('jumeaux');
        return {
            sur: true, produit: meilleur.id, ecart, cosinus: meilleur.cos,
            raison: `seul candidat de la question à porter le visuel le plus proche de la photo (cosinus ${f2(meilleur.cos)}, écart ${f2(ecart)} au suivant, M ${marge}), voisin n°1 de l'index entier, sans rival du même dessin, sans produit sans visuel, aucun champ lu ne le contredit`
        };
    } catch { return se_tait('donnee-manquante'); }
}

module.exports = { decider, MARGE, MOTIFS };

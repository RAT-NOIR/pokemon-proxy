'use strict';
// ============================================================
// LE REJEU DE joindre() POUR UNE LIGNE DE TABLE — une seule copie (PHASE 3a-SUITE, paquet 2)
// ============================================================
// Ce que `collecteur-texte.js` fait pour une ligne de table vérifiée, sans rien écrire : les cartes du set (ou, pour une ligne « sans page », les cartes qui DÉCLARENT l'impression), la Setlist relue sur
// l'archive R2 (zéro requête Bulbapedia), les impressions VIRTUELLES des tirages chinois (`numerosDepuisSetlist`), puis `joindre()` (ou `planSansPage`). Elle vivait dans la fermeture de
// `mesurer-sans-ligne.js` ; `poser-lignes-rejeu.js` en a besoin pour écrire ce que le rejeu désigne : deux copies divergent toujours (§21 bis), donc UNE, ici.
// Pures sauf la lecture de l'archive (injectée : `lireTexte(cleR2)`). Aucune base, aucune écriture.
const J = require('./jointure');
const W = require('./wikitext');
const { planSansPage } = require('./plan-sans-page');

/**
 * @param {object} o
 * @param {object[]} o.cartes      toutes les cartes lues (nomEn, impressions, sets, …)
 * @param {Map<string,object>} o.setParId   les documents `sets` par _id (bulba.cleR2, bulba.revid)
 * @param {Map<string,object>} o.etatPages  `collecte_etat` par _id (pages : titre, etat, pageid)
 * @param {(cleR2:string)=>Promise<string>} o.lireTexte   la lecture d'un objet de l'archive R2
 */
function creerRejeu({ cartes, setParId, etatPages, lireTexte }) {
    const parSlug = new Map();
    for (const c of cartes) for (const s of c.sets || []) (parSlug.get(s) || parSlug.set(s, []).get(s)).push(c);

    /** La Setlist d'une ligne, relue sur l'archive R2 : entrées, numéros, pages lues ou manquantes. `null` pour une ligne sans page. */
    async function setlistDe(l, slug) {
        const s = setParId.get(slug); const cle = s?.bulba?.cleR2;
        if (!cle || l.bulba?.sansPage) return null;
        const contenu = await lireTexte(cle);
        const lec = W.entreesDeLaSetlist(contenu, l.bulba);
        const pages = etatPages.get(slug)?.pages || [];
        const etatDe = new Map(pages.map(p => [p.titre, p]));
        const noms = [].concat(l.bulba.expansion);
        const jetons = J.jetonsDeSetlist(lec.entrees, noms);
        const parNumero = new Map();
        let sansNumero = 0;
        for (const e of lec.entrees) {
            const n = J.numeroDeSetlist(e, jetons, l.bulba.prefixesParJeton || null, l.bulba.prefixesParSection || null);
            if (n == null) { sansNumero++; continue; }
            const pg = etatDe.get(e.titre);
            (parNumero.get(J.cleNumero(n)) || parNumero.set(J.cleNumero(n), []).get(J.cleNumero(n))).push({ titre: e.titre, section: e.section, page: pg ? (pg.etat === 'manquant' ? 'manquant' : (pg.pageid ?? 'lue')) : 'non-visitee' });
        }
        const ignorees = {}; for (const sct of lec.sections) for (const brut of sct.ignorees) { const k = W.natureIgnoree(brut); ignorees[k] = (ignorees[k] || 0) + 1; }
        const numerique = [...parNumero.keys()].map(k => parseInt(String(k).replace(/\D/g, ''), 10)).filter(Number.isFinite);
        return { maxNumero: numerique.length ? Math.max(...numerique) : null, nNumeros: parNumero.size, revid: setParId.get(slug)?.bulba?.revid ?? null, chemin: lec.chemin, lues: lec.lues, retenues: lec.entrees.length, sansNumero, nManquants: pages.filter(p => p.etat === 'manquant').length, nPages: pages.length, ignorees, parNumero, entrees: lec.entrees, pages };
    }

    /**
     * `joindre()` pour UNE ligne de table vérifiée, comme la collecte : { Jr (le retour de joindre), sx (la Setlist relue ou null), TIRAGE, slug }.
     * @param {object} o.l  la ligne de table  @param {object[]} o.produits  les produits décomposés de l'expansion  @param {Set<string>} [o.lignesInterdites]  « carte|produit » détachées (la production les passe à joindre)
     */
    async function joindreLigne({ l, exp, produits, lignesInterdites }) {
        const TIRAGE = l.bulba?.tirage || 'jp';
        const slug = l.slugSet || l.code;
        const idExpansion = exp ?? l.exp;
        let Jr, sx = null;
        if (l.bulba?.sansPage) {
            const noms = [].concat(l.bulba.expansion);
            const cartesDuSet = cartes.filter(c => (c.impressions || []).some(i => i.tirage === TIRAGE && noms.includes(i.expansion)));
            Jr = planSansPage({ cartesDuSet, produitsLus: produits, L: l, slugCardmarket: l.slugSet || null }).J;
            // (relecture 2, D3) planSansPage ne connaît pas les lignes détachées : le rejeu les retire ici, comme joindre() le fait pour l'autre branche (un produit retiré redevient un produit sans ligne de ce rejeu)
            if (lignesInterdites && lignesInterdites.size) Jr = { ...Jr, lignes: Jr.lignes.filter(x => !lignesInterdites.has(`${x.carteId}|${x.idProduct}`)) };
        } else {
            let cartesDuSet = parSlug.get(slug) || [];
            sx = await setlistDe(l, slug);
            if (l.bulba?.numerosDepuisSetlist && sx) {
                // exactement collecteur-texte.js : les impressions VIRTUELLES de la Setlist, sans doublon de celles que la carte porte
                const V = J.impressionsDepuisSetlist(sx.entrees, sx.pages, { tirage: TIRAGE, expansionBulba: l.bulba.expansion, prefixesParJeton: l.bulba.prefixesParJeton || null, prefixesParSection: l.bulba.prefixesParSection || null });
                const cleImp = i => `${i.tirage}|${i.expansion}|${J.cleNumero(String(i.numero ?? ''))}`;
                cartesDuSet = cartesDuSet.map(c => { const v = V.parCarte.get(c._id); if (!v) return c; const deja = new Set((c.impressions || []).map(cleImp)); return { ...c, impressions: [...(c.impressions || []), ...v.filter(i => !deja.has(cleImp(i)))] }; });
            }
            Jr = J.joindre(cartesDuSet, produits, { idExpansion, expansionBulba: l.bulba.expansion, deck: l.bulba.deck || null, suffixesParDeck: l.bulba.suffixesParDeck || null, prefixesParDeck: l.bulba.prefixesParDeck || null, prefixesParJeton: l.bulba.prefixesParJeton || null, prefixesParSection: l.bulba.prefixesParSection || null, tirage: TIRAGE, slugSet: l.slugSet || null, ...(lignesInterdites ? { lignesInterdites } : {}) });
        }
        return { Jr, sx, TIRAGE, slug };
    }
    return { parSlug, setlistDe, joindreLigne };
}

module.exports = { creerRejeu };

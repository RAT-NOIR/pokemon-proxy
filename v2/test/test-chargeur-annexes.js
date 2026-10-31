'use strict';
// GUICHET 31/10 — ANNEXES (Yellow A) branchées dans la décision (v2/chargeur/decision.js, règle du site EMBARQUÉE : annexes.mjs + annexes.json, liste fermée de 61 entrées).
// Pas de base, pas de réseau : decider reçoit des tableaux fabriqués. L'entrée réelle de la liste utilisée : carte 87404 « 182a », parent « Unbroken Bonds », expansion annexe « Yellow A Alternate cards », tirage intl.
//   (1) annexes branchées + numeroFiche « 182a » sur la ligne : le produit a sa fiche ET son entrée d'archive (visuel du scan « 182a » du set) ;
//   (2) la MÊME décision sans impressionsEtAnnexes (règle injectée d'avant) : aucune fiche, aucune entrée (l'état de production d'avant) ;
//   (3) le produit d'un AUTRE set dont le parent n'est pas l'expansion de la carte annexe : jamais de fiche annexe (pas de fuite entre sets) ;
//   (4) les produits NON annexes ne bougent pas d'un octet entre (1) et (2) ;
//   (5) numeroFiche absent sur la ligne annexe : le scan « 182 » du numéro sans lettre n'est JAMAIS servi à l'annexe.
const H = require('./_harnais');
const { decider } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');

(async () => {
    const regle = await regleEmbarquee();
    H.v('la règle embarquée porte impressionsEtAnnexes et l\'expansion annexe « Yellow A Alternate cards »', [typeof regle.impressionsEtAnnexes, regle.expansionsAnnexes], ['function', ['Yellow A Alternate cards']]);
    const sansAnnexes = Object.freeze({ ...regle, impressionsEtAnnexes: undefined });
    const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
    const im = (setId, numero, n) => ({ set: setId, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'prv' });
    const imp = (expansion, numero) => ({ tirage: 'intl', expansion, numero, total: '214', rarete: 'Rare' });
    const sets = [{ _id: 'Unbroken-Bonds', idExpansion: 2437, code: 'UNB', nomAffichage: 'Unbroken Bonds', tirage: 'intl', region: 'intl', bulba: { expansion: 'Unbroken Bonds' } },
        { _id: 'Team-Up', idExpansion: 2500, code: 'TEU', nomAffichage: 'Team Up', tirage: 'intl', region: 'intl', bulba: { expansion: 'Team Up' } }];
    const docs = [
        { _id: 87404, nomEn: 'Pokégear 3.0', categorie: 'pokemon', sets: ['Unbroken-Bonds'], impressions: [imp('Unbroken Bonds', '182'), imp('Yellow A Alternate cards', '182a')],
            images: [im('Unbroken-Bonds', '182', 'ub182'), im('Unbroken-Bonds', '182a', 'ub182a')] },
        { _id: 5, nomEn: 'Carte simple', categorie: 'pokemon', sets: ['Team-Up'], impressions: [imp('Team Up', '010')], images: [im('Team-Up', '010', 'tu10')] },
        // la même carte annexe 87404 dans un set qui n'est PAS son parent : aucune fiche annexe
        { _id: 87405, nomEn: 'Pokémon Communication', categorie: 'pokemon', sets: ['Unbroken-Bonds'], impressions: [imp('Unbroken Bonds', '152'), imp('Yellow A Alternate cards', '152a')], images: [im('Unbroken-Bonds', '152', 'ub152')] }];
    const L = (idProduct, carteId, idExpansion, slugSet, numeroFiche) => ({ idProduct, carteId, idExpansion, numeroFiche, slug: `P${idProduct}`, slugSet });
    const lignes = [L(1, 87404, 2437, 'Unbroken-Bonds', '182a'), L(2, 87404, 2437, 'Unbroken-Bonds', '182'), L(3, 5, 2500, 'Team-Up', '010'), L(4, 87404, 2437, 'Unbroken-Bonds', null), L(5, 87405, 2437, 'Unbroken-Bonds', '152a')];
    const metacarte = new Map(lignes.map(l => [l.idProduct, 9000 + l.idProduct]));
    const lancer = r => decider({ sets, docs, lignes, metacarte, regle: r, cederLaMain: false });
    const on = await lancer(regle), off = await lancer(sansAnnexes);
    const e = (r, id) => r.entrees.find(x => x.idProduct === id);
    const fiche = (r, id) => { for (const [set, m] of r.liens) for (const [cle, ids] of m) if (ids.includes(id)) return `${set}:${cle}`; return null; };
    H.v('(1) annexes branchées : le produit « 182a » a sa fiche (clé carte|182a) ET une entrée d\'archive au scan « 182a »', [fiche(on, 1), e(on, 1) && e(on, 1).numero, e(on, 1) && e(on, 1).vignette.cle], ['Unbroken-Bonds:87404|182a', '182a', 'vignettes/ub182a.webp']);
    H.v('(2) sans impressionsEtAnnexes (état d\'avant) : aucune fiche, aucune entrée pour ce produit', [fiche(off, 1), e(off, 1)], [null, undefined]);
    H.v('(3) un annexe de 87405 (« 152a », parent Team Up) dans Unbroken Bonds : jamais de fiche annexe hors de son parent', [fiche(on, 5), e(on, 5)], [null, undefined]);
    const memeSansAnnexe = id => JSON.stringify([fiche(on, id), e(on, id)]) === JSON.stringify([fiche(off, id), e(off, id)]);
    H.v('(4) les produits non annexes (182, 010) sont identiques annexes branchées ou non', [memeSansAnnexe(2), memeSansAnnexe(3)], [true, true]);
    H.v('(5) le produit annexe SANS numeroFiche ne reçoit jamais le scan du numéro sans lettre (182)', e(on, 4) && e(on, 4).vignette.cle !== 'vignettes/ub182.webp' ? 'pas le scan sans lettre' : (e(on, 4) ? 'LE SCAN 182' : 'aucune entrée'), e(on, 4) ? 'pas le scan sans lettre' : 'aucune entrée');
    H.bilan();
})().catch(e => { console.log('❌', e && e.stack || e); process.exit(1); });

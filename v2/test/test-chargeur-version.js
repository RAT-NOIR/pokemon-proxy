'use strict';
// COTES-VISUELS, tour 1 — la forme gardée est COLONNAIRE (tableaux typés + une réserve de chaînes en octets) : elle rend EXACTEMENT les entrées que lireEntree valide, et se lit sans les matérialiser toutes.
// Pas de base, pas de réseau.
const H = require('./_harnais');
const { lireEntree } = require('../identifier/visuels');
const { creerConstructeur } = require('../chargeur/version');

const img = (cle, w, h) => ({ cle, w, h });
const CM = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
const brut = (id, o = {}) => ({ idProduct: id, vignette: img(`vignettes/${id}.webp`, 200, 279), grande: img(`cartes/${id}.webp`, 600, 838), visuel: 'du-set', mention: null,
    idMetacard: null, numero: null, rarete: null, total: null, variante: null, setNom: null, lien: null, ...o });
const entrees = [
    brut(1009, { idMetacard: 77, numero: '058', rarete: 'Rare Holo', total: '102', setNom: 'Pokémon — Éclat', lien: `${CM}/Base-Set/Pikachu-V1-BS58`, variante: 'premiere-edition' }),
    brut(1003, { grande: null, idMetacard: 77, numero: '5', rarete: null, setNom: 'Base Set', lien: null }),
    brut(1001, { visuel: 'substitut', mention: 'Visuel de la carte d\'origine — pas celui de ce produit', idMetacard: 78, numero: '12', rarete: 'Commune', lien: 'https://cardmarket.com/en/Autre/Chemin' }),
    brut(1005, { vignette: img('https://exemple.org/x.webp', 1, 1) }),                        // refusée : clé avec ://
    brut(1007, { visuel: 'substitut', mention: null }),                                      // refusée : substitut sans mention
    brut(1002, { idMetacard: 77, numero: '058', rarete: 'Rare', total: '102', setNom: 'Base Set', lien: `${CM}/Base-Set/Pikachu-V2-BS58` }),   // même clé de vignette que 1009 ? non : propre
    brut(1004, { vignette: img('vignettes/1009.webp', 200, 279) })                            // partage la clé de vignette de 1009 (la réserve de chaînes déduplique)
];

(async () => {
    const c = creerConstructeur();
    for (const e of entrees) c.entree(e);
    c.lien('Set-A', '1|001', [1001]); c.lien('Set-A', '2|-', [1002, 1004]); c.lien('Set-B', '3|058', [1009]); c.lien('Set-A', '9|TG05', [1003]);
    const v = c.finir();

    H.v('comptes : 7 lues, 5 admises, 2 refusées (motifs nommés)', [v.comptes.lues, v.comptes.visuels, v.comptes.refusees, v.comptes.motifs], [7, 5, 2, { 'vignette : clé avec "://"': 1, 'visuel de substitution sans mention': 1 }]);
    H.v('comptes des liens : 2 sets, 4 fiches, 5 produits', [v.comptes.setsAvecLiens, v.comptes.fichesLiees, v.comptes.produitsLies], [2, 4, 5]);
    H.vrai('la version est gelée', Object.isFrozen(v));

    // exactitude : chaque entrée admise ressort IDENTIQUE à ce que lireEntree a validé
    const attendu = id => lireEntree(entrees.find(e => e.idProduct === id)).doc;
    for (const id of [1001, 1002, 1003, 1004, 1009]) H.v(`entree(${id}) : identique au document validé par lireEntree`, v.entree(id), attendu(id));
    H.v('entree : un produit refusé, absent, non entier, null → null', [v.entree(1005), v.entree(1007), v.entree(424242), v.entree('1001'), v.entree(null)], [null, null, null, null, null]);
    H.v('   les accents survivent (UTF-8)', v.entree(1009).setNom, 'Pokémon — Éclat');
    H.v('   un lien d\'un autre préfixe (cardmarket.com sans www) ressort entier', v.entree(1001).lien, 'https://cardmarket.com/en/Autre/Chemin');
    H.v('   un lien absent reste null, une rareté absente reste null', [v.entree(1003).lien, v.entree(1003).rarete, v.entree(1003).grande], [null, null, null]);

    // métacartes : triées par produit, jamais de balayage
    H.v('produitsDeMetacarte(77) : les produits admis de la métacarte, par idProduct', v.produitsDeMetacarte(77), [1002, 1003, 1009]);
    H.v('   (78) un seul ; inconnue, non entière → []', [v.produitsDeMetacarte(78), v.produitsDeMetacarte(999), v.produitsDeMetacarte('77'), v.produitsDeMetacarte(null)], [[1001], [], [], []]);

    // liens : la clé de fiche est reconstruite EXACTEMENT (« - » compris)
    H.v('fichesDuSet(Set-A) : clés exactes et produits', v.fichesDuSet('Set-A').map(f => [f.cle, f.produits]).sort(), [['1|001', [1001]], ['2|-', [1002, 1004]], ['9|TG05', [1003]]]);
    H.v('   un set sans lien, non chaîne → []', [v.fichesDuSet('Set-Z'), v.fichesDuSet(null), v.fichesDuSet('__proto__')], [[], [], []]);
    H.v('   produitsDeLaFiche(Set-A, 2|-) ; clé inconnue → []', [v.produitsDeLaFiche('Set-A', '2|-'), v.produitsDeLaFiche('Set-A', '2|1')], [[1002, 1004], []]);

    // la réserve de chaînes déduplique et se mesure
    H.vrai(`taille mesurée : ${v.octets.total} octets (colonnes ${v.octets.colonnes}, chaînes ${v.octets.chaines}) ; la clé partagée de 1009 n'est stockée qu'une fois`, v.octets.total > 0 && v.octets.chaines < JSON.stringify(entrees.map(e => [e.vignette.cle, e.grande && e.grande.cle, e.lien, e.setNom])).length);

    // un constructeur vide est refusé à la fin (jamais une version vide)
    let leve = null; try { creerConstructeur().finir(); } catch (e) { leve = e.name; }
    H.vrai('constructeur sans aucune entrée : finir() LÈVE (jamais une version vide)', leve !== null);

    // beaucoup d'entrées : tri et recherche dichotomique justes (dénominateur 2000, ids à l'envers)
    const g = creerConstructeur();
    for (let i = 2000; i >= 1; i--) g.entree(brut(5000 + i, { idMetacard: 9000 + (i % 7) }));
    g.lien('Set-X', '1|1', [5001]);
    const gv = g.finir();
    H.v('2000 entrées insérées à l\'envers : toutes retrouvées par leur idProduct (dénominateur 2000)', Array.from({ length: 2000 }, (_, k) => gv.entree(5001 + k)?.idProduct === 5001 + k).filter(Boolean).length, 2000);
    H.v('   voisins absents (5000, 7001) → null', [gv.entree(5000), gv.entree(7001)], [null, null]);
    H.v('   la métacarte 9003 : ses ~286 produits, triés', [gv.produitsDeMetacarte(9003).length, gv.produitsDeMetacarte(9003).every((x, k, a) => k === 0 || a[k - 1] < x)], [286, true]);
    // I2 : UN produit, UNE entrée — « le dernier gagne » (la règle de l'ancien import), comptée ; le consommateur n'a jamais deux fois le même identifiant
    const dd = creerConstructeur();
    dd.entree(brut(10, { setNom: 'Premier', idMetacard: 1 })); dd.entree(brut(20, { setNom: 'Seul', idMetacard: 1 })); dd.entree(brut(10, { setNom: 'Dernier', idMetacard: 2, numero: '9' }));
    dd.lien('Set-D', '1|1', [10, 20]);
    const dv = dd.finir();
    H.v('doublon d\'idProduct : une seule entrée, la DERNIÈRE ; comptes : 3 lues, 2 admises, 1 doublon', [dv.entree(10).setNom, dv.entree(10).numero, dv.entree(10).idMetacard, dv.comptes.lues, dv.comptes.visuels, dv.comptes.doublons], ['Dernier', '9', 2, 3, 2, 1]);
    H.v('   les métacartes suivent la dernière valeur (le produit 10 n\'est plus dans la métacarte 1)', [dv.produitsDeMetacarte(1), dv.produitsDeMetacarte(2)], [[20], [10]]);
    H.v('   les identifiants sont strictement croissants (le format les exige)', Array.from(dv.identifiants()), [10, 20]);

    // TOUR 3 (ruling 1) : deux entrées d'un même produit aux visuels DIFFÉRENTS ⇒ AUCUN visuel pour ce produit (un visuel absent est honnête, celui d'un autre tirage ne l'est pas) ; identiques ⇒ une seule
    const dc = creerConstructeur();
    dc.entree(brut(10, { vignette: img('vignettes/A.webp', 200, 279), idMetacard: 1 })); dc.entree(brut(20, { idMetacard: 1 })); dc.entree(brut(10, { vignette: img('vignettes/B.webp', 200, 279), idMetacard: 1 }));
    dc.entree(brut(30, { grande: img('cartes/g1.webp', 600, 838) })); dc.entree(brut(30, { grande: img('cartes/g2.webp', 600, 838) }));      // seule la GRANDE image diffère
    dc.entree(brut(40, { vignette: img('vignettes/A.webp', 200, 279) })); dc.entree(brut(40, { vignette: img('vignettes/B.webp', 200, 279) })); dc.entree(brut(40, { vignette: img('vignettes/A.webp', 200, 279) }));   // A, B, A : toujours contradictoire
    dc.entree(brut(50, { setNom: 'Premier' })); dc.entree(brut(50, { setNom: 'Dernier' }));                                                    // visuels identiques, le reste diffère : une seule, la dernière
    dc.lien('Set-C', '1|1', [10, 20]);
    const dcv = dc.finir();
    H.v('doublon CONTRADICTOIRE (deux vignettes, ou deux grandes images, ou A-B-A) : aucune entrée pour ce produit', [dcv.entree(10), dcv.entree(30), dcv.entree(40)], [null, null, null]);
    H.v('   les visuels identiques d\'un doublon : une seule entrée, la dernière ; les autres produits intacts', [dcv.entree(50).setNom, dcv.entree(20).idProduct, Array.from(dcv.identifiants())], ['Dernier', 20, [20, 50]]);
    H.v('   dénominateur : 10 lues, 2 admises, 3 produits contradictoires, 1 doublon identique', [dcv.comptes.lues, dcv.comptes.visuels, dcv.comptes.doublonsContradictoires, dcv.comptes.doublons], [10, 2, 3, 1]);
    H.v('   un produit sans visuel ne reste pas dans sa métacarte', dcv.produitsDeMetacarte(1), [20]);
    const tout = creerConstructeur(); tout.entree(brut(1, { vignette: img('vignettes/A.webp', 1, 1) })); tout.entree(brut(1, { vignette: img('vignettes/B.webp', 1, 1) })); tout.lien('S', '1|1', [1]);
    H.v('   si TOUT est contradictoire, le constructeur annonce 0 admise (jamais une version à entrées fantômes)', [tout.etat().admises, (() => { try { tout.finir(); return 'a fini'; } catch { return 'a levé'; } })()], [0, 'a levé']);

    // TOUR 3 (ruling 3) : le rejugement rend la main à la boucle PAR PAQUETS, avec la MÊME validation (lireEntree) et le même verdict que la version synchrone
    const { rejugerEntrees, rejugerEntreesParPaquets, PAQUET_REJUGEMENT } = require('../chargeur/version');
    const faux = n => ({ identifiants: () => Int32Array.from({ length: n }, (_, i) => i + 1), entree: id => (id % 4000 === 17 ? brut(id, { vignette: img('https://exemple.org/x.webp', 1, 1) }) : brut(id, { vignette: img(`vignettes/${id}.webp`, 1, 1) })) });
    const fv = faux(10000);
    let rendus = 0;
    const par = await rejugerEntreesParPaquets(fv, { rendre: async () => { rendus++; } });
    const sync = rejugerEntrees(fv);
    H.v('paquet de rejugement : 4 000 entrées', PAQUET_REJUGEMENT, 4000);
    H.v('rejugement par paquets : même verdict que le synchrone (3 rejetées sur 10 000, mêmes motifs)', [par.ok, par.refusees, JSON.stringify(par.motifs) === JSON.stringify(sync.motifs), sync.refusees], [false, 3, true, 3]);
    H.v('   la main est rendue à la boucle entre les paquets : 10 000 entrées ⇒ 2 reprises (4 000 + 4 000 + 2 000) ; 3 999 entrées ⇒ aucune', [rendus, await (async () => { let k = 0; await rejugerEntreesParPaquets(faux(3999), { rendre: async () => { k++; } }); return k; })()], [2, 0]);
    H.v('   par défaut la reprise est une VRAIE cession de la boucle (un setImmediate se déclenche pendant le rejugement)', await (async () => { let tic = 0, fin = false; setImmediate(function boucle() { tic++; if (!fin) setImmediate(boucle); }); await rejugerEntreesParPaquets(faux(12000)); fin = true; return tic > 0; })(), true);

    // la voie « fil » juge la STRUCTURE comme la voie « fichier » (une seule définition : version.verifierStructure)
    const { depuisPaquet, StructureInvalide } = require('../chargeur/version');
    const p = v.paquet().donnees;
    const casse = (patch) => { const c = JSON.parse(JSON.stringify({ n: 0 })); void c; const d = { ...p, cols: { ...p.cols } }; patch(d); try { depuisPaquet(d); return null; } catch (e) { return e instanceof StructureInvalide ? e.motif : `AUTRE:${e.name}`; } };
    H.v('paquet intact : accepté', casse(() => { }), null);
    H.vrai('paquet aux identifiants non triés : refusé', /non strictement croissants/.test(casse(d => { const a = Int32Array.from(d.cols.id); [a[0], a[1]] = [a[1], a[0]]; d.cols.id = a; }) || ''));
    H.vrai('paquet aux identifiants dupliqués : refusé', /non strictement croissants/.test(casse(d => { const a = Int32Array.from(d.cols.id); a[1] = a[0]; d.cols.id = a; }) || ''));
    H.vrai('paquet aux comptes menteurs : refusé', /comptes de l'en-tête/.test(casse(d => { d.comptes = { ...d.comptes, visuels: d.comptes.visuels + 1 }; }) || ''));
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

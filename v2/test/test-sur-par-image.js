'use strict';
// SUR-PAR-IMAGE — la règle PURE (v2/identifier/sur-par-image.js). Une question dont les candidats ne sont pas le même dessin devient un sûr quand la photo est NETTEMENT plus proche d'un seul.
// Module sans base ni réseau. Chaque condition (1) à (6) a son cas ROUGE (la règle se tait) ; le cas VERT de départ est la seule issue « sûr ». Les données sont FABRIQUÉES (clés, produits, cosinus inventés).
const H = require('./_harnais');
const G = require('../../ratmarket/decision-g');
const SPI = require('../identifier/sur-par-image');

const M = G.SEUILS_G.marge_carte;
// Trois candidats : 101 (clé k1, la bonne), 102 (clé k2), 103 (clé k3). Cosinus photo : k1 0.60, k2 0.30, k3 0.25 (écart 0.30 >= M).
const base = (sur = {}) => {
    const ctx = G.contexte({
        groupe: {}, carte: { k1: [1], k2: [2], k3: [3] }, invisibles: {},
        produits: { k1: [[101, 1.0]], k2: [[102, 1.0]], k3: [[103, 1.0]] },
        ...(sur.contexte || {})
    });
    const cos = { k1: 0.60, k2: 0.30, k3: 0.25, ...(sur.cos || {}) };
    const lignes = new Map([[101, { idProduct: 101, numero: '001', total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: [] }],
        [102, { idProduct: 102, numero: '002', total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: [] }],
        [103, { idProduct: 103, numero: '003', total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: [] }]]);
    return {
        ids: [101, 102, 103], cles: new Map([[101, 'k1'], [102, 'k2'], [103, 'k3']]), cosinus: c => (c in cos ? cos[c] : null), top1: 'k1', contexte: ctx,
        signaux: () => ({ basse: false, partageAutreDessin: false }), emprunte: () => false, partages: () => [], jumeaux: id => ({ conclu: true, ids: [] }), produits: lignes, lu: null, marquesLues: null, redressee: true,
        ...(sur.entree || {})
    };
};
const d = (sur) => SPI.decider(base(sur));

// ── 0. le cas VERT : un seul chemin mène à « sûr »
{
    const r = d();
    H.v('0a. cas vert : sûr, produit 101', [r.sur, r.produit], [true, 101]);
    H.vrai('0b. la raison NOMME son périmètre (« seul candidat de la question »), le cosinus, l\'écart et la marge', /seul candidat de la question/.test(r.raison) && /0\.60/.test(r.raison) && /0\.30/.test(r.raison) && new RegExp(String(M)).test(r.raison));
    H.v('0c. M vient du code : SPI.MARGE === SEUILS_G.marge_carte', SPI.MARGE, G.SEUILS_G.marge_carte);
    H.v('0d. le résultat ne porte rien d\'autre qu\'un produit, un écart, un cosinus et une raison', Object.keys(r).sort(), ['cosinus', 'ecart', 'produit', 'raison', 'sur']);
}
// ── (1) entrée d'archive, empreinte, vecteur
H.v('1a. un candidat sans entrée d\'archive (clé absente) : se tait', d({ entree: { cles: new Map([[101, 'k1'], [102, 'k2']]) } }).motif, 'donnee-manquante');
H.v('1a2. un candidat sans entrée d\'archive, même si le fournisseur de cosinus répond pour tout (clé undefined) : se tait', d({ entree: { cles: new Map([[101, 'k1'], [102, 'k2']]), cosinus: c => (c === 'k1' ? 0.6 : 0.2) } }).motif, 'donnee-manquante');
H.v('1b. un candidat sans empreinte (cosinus null) : se tait', d({ cos: { k3: null } }).motif, 'donnee-manquante');
H.v('1c. cosinus non fini : se tait', d({ cos: { k2: NaN } }).motif, 'donnee-manquante');
H.v('1d. photo non redressée (vecteur de la photo entière) : se tait', d({ entree: { redressee: false } }).motif, 'photo-non-redressee');
H.v('1e. moins de 2 candidats : se tait', d({ entree: { ids: [101], cles: new Map([[101, 'k1']]) } }).motif, 'candidats');
H.v('1f. un identifiant en double : se tait', d({ entree: { ids: [101, 101, 102] } }).motif, 'candidats');
H.v('1g. top1 absent : se tait', d({ entree: { top1: null } }).motif, 'donnee-manquante');
H.v('1h. contexte absent : se tait', d({ entree: { contexte: null } }).motif, 'donnee-manquante');
// ── (2) aucun rival de même dessin
H.v('2a. un rival du même groupe G que le meilleur : se tait', d({ contexte: { groupe: { k1: 7, k3: 7 } } }).motif, 'meme-dessin');
H.v('2b. le groupe est celui de la production : un rival d\'un AUTRE groupe ne gêne pas', d({ contexte: { groupe: { k1: 7, k2: 8 } } }).sur, true);
H.v('2c. deux candidats au même visuel (même clé) : se tait', d({ entree: { cles: new Map([[101, 'k1'], [102, 'k1'], [103, 'k3']]) } }).motif, 'meme-dessin');
H.v('2d. le meilleur est le seul à n\'avoir aucun groupe : ne gêne pas (groupes inconnus ne sont pas des jumeaux)', d({ contexte: { groupe: { k2: 8, k3: 8 } } }).sur, true);
// ── (3) voisin n°1 de l'index entier
H.v('3a. le voisin n°1 de l\'index est une autre clé : se tait', d({ entree: { top1: 'kZ' } }).motif, 'pas-voisin-n1');
H.v('3b. le voisin n°1 est la clé d\'un rival : se tait', d({ entree: { top1: 'k2' } }).motif, 'pas-voisin-n1');
// ── (4) aucun produit sans visuel
H.v('4a. la carte du meilleur a un produit sans visuel : se tait', d({ contexte: { invisibles: { 1: [555] } } }).motif, 'produit-sans-visuel');
H.v('4b. un FRÈRE du groupe du meilleur a un produit sans visuel (comme decision-g.js) : se tait — le groupe n\'a pas de rival ici, le frère n\'est pas candidat',
    d({ contexte: { groupe: { k1: 7, kF: 7 }, carte: { k1: [1], k2: [2], k3: [3], kF: [9] }, invisibles: { 9: [556] } } }).motif, 'produit-sans-visuel');
H.v('4c. un produit sans visuel chez un RIVAL ne gêne pas', d({ contexte: { invisibles: { 2: [557] } } }).sur, true);
H.v('4d. la clé du meilleur est inconnue du contexte (carte absente) : on ne peut pas vérifier, se tait', d({ contexte: { carte: { k2: [2], k3: [3] } } }).motif, 'donnee-manquante');
// ── (5) l'écart à M, M venu du code
H.v('5a. écart 0.19 < M : se tait', d({ cos: { k2: 0.41 } }).motif, 'ecart');
H.v('5b. écart exactement égal à M (0.75 - 0.50 = 0.25 exact en binaire, M = 0.25) : sûr', SPI.decider({ ...base({ cos: { k1: 0.75, k2: 0.50, k3: 0.10 } }), marge: 0.25 }).sur, true);
H.v('5c. écart juste sous M : se tait', SPI.decider({ ...base({ cos: { k1: 0.75, k2: 0.5001, k3: 0.10 } }), marge: 0.25 }).motif, 'ecart');
H.v('5c2. écart de 0.30 avec le M du code : sûr ; 0.19 : se tait (le défaut est bien SEUILS_G.marge_carte)', [d({ cos: { k2: 0.30 } }).sur, d({ cos: { k2: 0.41 } }).sur], [true, false]);
H.v('5d. l\'écart se mesure au SECOND candidat, pas au dernier : 3e loin, 2e proche — se tait', d({ cos: { k2: 0.55, k3: 0.01 } }).motif, 'ecart');
H.v('5e. le meilleur n\'est pas forcément le premier de la liste', d({ entree: { ids: [102, 101, 103] }, cos: {} }).produit, 101);
H.v('5f. un seuil différent peut être passé (bancs de mesure), le défaut est celui du code', [SPI.decider({ ...base({ cos: { k2: 0.50 } }), marge: 0.05 }).sur, d({ cos: { k2: 0.50 } }).sur], [true, false]);
// ── (7) aucun candidat n'a un visuel suspect : basse définition, partagé avec une autre carte ; signal manquant = défaut fermé
const sig = (id, s) => ({ signaux: x => (x === id ? s : { basse: false, partageAutreDessin: false }) });
const emp = (id, v) => ({ emprunte: x => (x === id ? v : false) });
H.v('7-0. emprunté (marque de l\'archive) sur le MEILLEUR : se tait', d({ entree: emp(101, true) }).motif, 'visuel-suspect');
H.v('7-0b. emprunté sur un RIVAL : se tait', d({ entree: emp(102, true) }).motif, 'visuel-suspect');
H.v('7-0c. emprunté inconnu (null) sur un rival : défaut fermé', d({ entree: emp(103, null) }).motif, 'visuel-suspect');
H.v('7-0d. 🔴 AUCUNE fonction d\'emprunt (archive sans marque) : la règle se tait sur TOUTE la question', [d({ entree: { emprunte: null } }).motif, d({ entree: { emprunte: undefined } }).motif], ['emprunt-inconnu', 'emprunt-inconnu']);
H.v('7-0e. l\'emprunt n\'est pas un booléen vrai (chaîne, 0) : se tait', [d({ entree: emp(101, 'non') }).motif, d({ entree: emp(101, 0) }).motif], ['visuel-suspect', 'visuel-suspect']);
H.v('7-0f. une fonction d\'emprunt qui lève : se tait, ne lève pas', d({ entree: { emprunte: () => { throw new Error('x'); } } }).sur, false);
H.v('7-1a. le MEILLEUR en basse définition : se tait', d({ entree: sig(101, { basse: true, partageAutreDessin: false }) }).motif, 'visuel-suspect');
H.v('7-1b. un RIVAL en basse définition : se tait (l\'UN des candidats)', d({ entree: sig(103, { basse: true, partageAutreDessin: false }) }).motif, 'visuel-suspect');
H.v('7-1c. basse définition inconnue (null : archive sans la colonne) : défaut fermé', d({ entree: sig(102, { basse: null, partageAutreDessin: false }) }).motif, 'visuel-suspect');
H.v('7-2a. le meilleur partage son fichier avec un produit d\'une autre carte (cas Masaki) : se tait', d({ entree: sig(101, { basse: false, partageAutreDessin: true }) }).motif, 'visuel-suspect');
H.v('7-2b. un rival partage son fichier avec une autre carte : se tait', d({ entree: sig(102, { basse: false, partageAutreDessin: true }) }).motif, 'visuel-suspect');
H.v('7-2c. partage inconnu (null) : défaut fermé', d({ entree: sig(103, { basse: false, partageAutreDessin: null }) }).motif, 'visuel-suspect');
H.v('7-3a. aucun fournisseur de signaux : défaut fermé', d({ entree: { signaux: null } }).motif, 'visuel-suspect');
H.v('7-3b. un fournisseur qui ne connaît pas le produit (null) : défaut fermé', d({ entree: { signaux: () => null } }).motif, 'visuel-suspect');
// ── produit du visuel
H.v('6a. le visuel du meilleur porte DEUX produits : l\'image ne les sépare pas, se tait', d({ contexte: { produits: { k1: [[101, 1.0], [199, 1.0]], k2: [[102, 1.0]], k3: [[103, 1.0]] } } }).motif, 'visuel-partage');
H.v('6b. le visuel du meilleur porte un AUTRE produit que le candidat : se tait', d({ contexte: { produits: { k1: [[199, 1.0]], k2: [[102, 1.0]], k3: [[103, 1.0]] } } }).motif, 'visuel-partage');
H.v('6c. produits partagés selon la colonne de l\'archive : se tait', d({ entree: { partages: () => [150] } }).motif, 'visuel-partage');
H.v('6d. colonne des partages indisponible (null) : se tait', d({ entree: { partages: () => null } }).motif, 'visuel-partage');
// ── (6) aucun champ LU ne contredit le désigné
const lu = (o = {}) => ({ numero: null, setCode: null, total: null, symboleSet: null, attaque: null, attaqueConfiance: null, langue: null, tcgdexId: null, totalHorsTailleDeSet: false, vivierIds: [], ...o });
H.v('7a. rien de lu : le sûr tient', d({ entree: { lu: null } }).sur, true);
H.v('7b. numéro lu concordant : le sûr tient', d({ entree: { lu: lu({ numero: '001' }) } }).sur, true);
H.v('7c. numéro lu qui contredit le désigné (lu 002, désigné 001) : se tait', d({ entree: { lu: lu({ numero: '002' }) } }).motif, 'contredit');
H.v('7d. total lu qui contredit : se tait', d({ entree: { lu: lu({ total: '165' }) } }).motif, 'contredit');
H.v('7e. langue lue (JP) qui contredit le tirage du désigné (intl) : se tait', d({ entree: { lu: lu({ langue: 'JP' }) } }).motif, 'contredit');
H.v('7f. le produit désigné n\'est pas au catalogue de l\'API (pas de ligne) : on ne peut pas juger, se tait', d({ entree: { produits: new Map() } }).motif, 'donnee-manquante');
H.v('7g. marques lues (staff) alors que le désigné n\'en porte aucune : se tait', d({ entree: { marquesLues: ['staff'] } }).motif, 'marques');
H.v('7h. marques lues différentes de celles du désigné : se tait',
    d({ entree: { marquesLues: ['staff'], produits: new Map([[101, { idProduct: 101, numero: '001', total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: ['league'] }]]) } }).motif, 'marques');
H.v('7i. marques lues identiques à celles du désigné : le sûr tient',
    d({ entree: { marquesLues: ['staff'], produits: new Map([[101, { idProduct: 101, numero: '001', total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: ['staff'] }]]) } }).sur, true);
// ── jumeaux : ceux du désigné doivent TOUS être candidats de la question
H.v('8a. un jumeau du désigné hors de la question : se tait', d({ entree: { jumeaux: () => ({ conclu: true, ids: [101, 777] }) } }).motif, 'jumeaux');
H.v('8b. jumeaux non conclus : se tait', d({ entree: { jumeaux: () => ({ conclu: false, ids: [] }) } }).motif, 'jumeaux');
H.v('8c. pas de fournisseur de jumeaux : se tait', d({ entree: { jumeaux: null } }).motif, 'jumeaux');
H.v('8d. les jumeaux sont des candidats de la question : le sûr tient', d({ entree: { jumeaux: () => ({ conclu: true, ids: [101, 102] }) } }).sur, true);
// ── ne lève jamais
H.v('9a. une entrée absurde ne lève pas : se tait', SPI.decider(null).sur, false);
H.v('9b. un fournisseur qui lève : se tait', d({ entree: { cosinus: () => { throw new Error('x'); } } }).sur, false);
H.v('9c. un cosinus qui est une chaîne : se tait', d({ cos: { k1: '0.9' } }).sur, false);

H.bilan();

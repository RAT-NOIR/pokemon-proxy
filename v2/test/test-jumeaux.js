'use strict';
// JUMEAU-V2 — aucune affirmation d'un produit qui a un JUMEAU : même métacarte, même langue de tirage, AUTRE créneau (expansion, numéro). Un champ inconnu compte comme « même » (on échoue fermé).
// Cas fondateur : IMG_3237, une Roaring Moon ex qui imprime PRE 162/131, lue « PAR 251/182 » (le même nom et la même métacarte 426438 chez Paradox Rift) : la chaîne héritée n'a qu'UN candidat
// et l'affirmait (prix rendu faux de 106 €). Désormais : une QUESTION qui contient la vérité.
// Pas de base, pas de réseau. Chaque cas est écrit pour échouer si la garde est retirée (voir le rapport : rouge vu avant le code).
const H = require('./_harnais');
const { creerConstructeur } = require('../chargeur/version');
const F = require('../chargeur/format');
const { adapter } = require('../identifier/adaptateur');
const { lireConfig } = require('../config');

const cfg = lireConfig({});
const img = (cle, w, h) => ({ cle, w, h });
const brut = (id, meta) => ({ idProduct: id, vignette: img(`vignettes/${id}.webp`, 200, 279), grande: null, visuel: 'du-set', mention: null, idMetacard: meta, numero: '1', rarete: 'Rare', total: '100', variante: null, setNom: 'S', lien: null });
const J = (idProduct, idMetacard, idExpansion, numero, tirage) => ({ idProduct, idMetacard, idExpansion, numero, tirage });

(async () => {
    // ── 1. la colonne dans la version : écrite par le producteur (decision.js -> sink.jumeau), lue par la route
    const c = creerConstructeur();
    c.entree(brut(740794, 426438));
    c.jumeau(J(740794, 426438, 6000, '251', 'intl'));     // IMG_3237 : la réponse de la chaîne (PAR 251)
    c.jumeau(J(805556, 426438, 6100, '162', 'intl'));     // la vérité (PRE 162) : autre créneau, même langue, SANS entrée de visuel
    c.jumeau(J(900001, 426438, 6000, '251', 'intl'));     // même créneau que 740794 (une variante V2) : PAS un jumeau
    c.jumeau(J(900002, 426438, 6200, '300', 'jp'));       // autre langue de tirage : PAS un jumeau
    c.jumeau(J(900003, 426438, null, null, 'intl'));      // créneau INCONNU : jumeau (on échoue fermé)
    c.jumeau(J(900004, 426438, 6300, '9', null));         // langue INCONNUE : jumeau
    c.jumeau(J(1, 111, 1, '1', 'intl'));                  // une métacarte à un seul produit
    c.jumeau(J(2, 222, 1, '1', 'intl')); c.jumeau(J(3, 222, 2, '1', 'jp'));
    c.jumeau(J(4, 333, 1, '1', 'intl')); c.jumeau(J(4, 333, 2, '1', 'intl'));   // deux lignes qui se contredisent : le créneau devient inconnu
    c.jumeau(J(5, 333, 7, '5', 'intl'));
    c.jumeau(J(60, 600, null, null, 'intl')); c.jumeau(J(61, 600, null, null, 'intl'));   // DEUX créneaux inconnus : jamais « le même créneau » (M7 de la relecture 1)
    c.jumeau(J(70, null, 1, '1', 'intl')); c.jumeau(J(71, null, 2, '1', 'intl'));         // métacarte inconnue : on ne peut pas conclure (M14b de la relecture 1)
    const v = c.finir(new Date('2026-10-12T10:00:00.000Z'));
    H.v('DEUX créneaux inconnus dans la même métacarte : jumeaux l\'un de l\'autre (jamais comptés « même créneau »)', [v.jumeauxDe(60), v.jumeauxDe(61)], [[61], [60]]);
    H.v('un produit dont la métacarte est inconnue : null (on ne peut pas conclure), jamais [] « aucun jumeau »', [v.jumeauxDe(70), v.jumeauxDe(71)], [null, null]);
    H.v('l\'empreinte de la colonne : le nombre de produits du catalogue qu\'elle décrit et le plus grand idProduct', v.empreinteJumeaux(), { n: 15, max: 900004 });
    H.v('la version porte la colonne', v.colonneJumeaux, true);
    H.v('IMG_3237 : les jumeaux de 740794 = la vérité 805556 + les deux inconnus ; ni la variante du même créneau, ni l\'autre langue', v.jumeauxDe(740794), [805556, 900003, 900004]);
    H.v('   réciproque : 805556 a pour jumeaux 740794, la variante 900001 (son créneau diffère), et les deux inconnus', v.jumeauxDe(805556), [740794, 900001, 900003, 900004]);
    H.v('un produit seul dans sa métacarte : aucun jumeau', v.jumeauxDe(1), []);
    H.v('une autre langue de tirage ne fait pas un jumeau', [v.jumeauxDe(2), v.jumeauxDe(3)], [[], []]);
    H.v('deux lignes qui se contredisent : créneau inconnu, donc jumeau de son voisin (jamais « la dernière gagne »)', [v.jumeauxDe(4), v.jumeauxDe(5)], [[5], [4]]);
    H.v('un produit absent de la colonne : on ne peut pas conclure (null), jamais « aucun jumeau »', [v.jumeauxDe(424242), v.jumeauxDe('740794'), v.jumeauxDe(null)], [null, null, null]);
    const sansColonne = (() => { const b = creerConstructeur(); b.entree(brut(1, 5)); return b.finir(); })();
    H.v('une version SANS colonne : colonneJumeaux faux, jumeauxDe null pour tout produit (la route n\'affirme rien)', [sansColonne.colonneJumeaux, sansColonne.jumeauxDe(1)], [false, null]);

    // ── 2. la colonne traverse le fichier ; un fichier plus ancien (sans la colonne) reste lisible, sans la colonne
    const brutF = F.serialiser(v);
    const relue = F.deserialiser(brutF);
    H.v('aller-retour du fichier : mêmes jumeaux', [relue.colonneJumeaux, relue.jumeauxDe(740794), relue.jumeauxDe(805556), relue.jumeauxDe(424242)], [true, [805556, 900003, 900004], [740794, 900001, 900003, 900004], null]);
    const ancien = F.deserialiser(F.serialiser(sansColonne));
    H.v('fichier d\'avant la colonne : lu, colonneJumeaux faux, jumeauxDe null', [ancien.colonneJumeaux, ancien.jumeauxDe(1)], [false, null]);
    const paq = v.paquet().donnees;
    const { depuisPaquet, StructureInvalide } = require('../chargeur/version');
    const casse = patch => { const d = { ...paq, jum: { ...paq.jum } }; patch(d); try { depuisPaquet(d); return null; } catch (e) { return e instanceof StructureInvalide ? e.motif : `AUTRE:${e.name}`; } };
    H.vrai('structure : colonnes de longueur différente → refusé (jamais une colonne menteuse)', /jumeaux/.test(casse(d => { d.jum.exp = d.jum.exp.subarray(1); }) || ''));
    H.vrai('structure : permutation non triée par produit → refusé', /jumeaux/.test(casse(d => { d.jum.ordre = Int32Array.from(d.jum.ordre).reverse(); }) || ''));

    // ── 3. la garde de l'adaptateur : P n'est affirmé que s'il n'a AUCUN jumeau
    const ligne = (id, o = {}) => ({ idProduct: id, nomCardmarket: 'Roaring Moon ex', set: { slug: 's' + id, nom: 'Set ' + id }, numero: String(id), total: '100', langue: 'FR', variante: null, rarete: 'Rare',
        prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/${id}.webp`, w: 255, h: 356 }, ...o });
    const produits = new Map([740794, 805556, 700, 701, 702, 703, 704].map(i => [i, ligne(i)]));
    const succes = id => ({ success: true, scanId: 's1', question: null, carte: { idProduct: id, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null },
        etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, candidats: [{ idProduct: id, score: 9 }], classement: [{ idProduct: id, score: 9 }], reverse: { attendue: false, strategie: null }, codeLangue: 2 });
    const table = m => id => (m.has(id) ? { conclu: true, ids: m.get(id) } : { conclu: false, ids: [] });
    const ctx = (jumeaux, o = {}) => ({ produits, langueInterface: 'fr', cfg, jumeaux, ...o });
    const A = (id, jumeaux, o) => adapter({ statutHttp: 200, corps: succes(id) }, ctx(jumeaux, o));
    const ids = r => r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b);

    const IMG3237 = A(740794, table(new Map([[740794, [805556]]])));
    H.v('IMG_3237 reconstruit (PAR 251 lu, PRE 162 vrai) : une QUESTION, pas une affirmation', [IMG3237.issue, IMG3237.analyse.cartes[0].statut], ['question', 'a-trancher']);
    H.v('   la question contient la vérité ET la lecture', ids(IMG3237), [740794, 805556]);
    H.v('   la question est bien formée (2 choix a/b)', IMG3237.question.choix.map(x => x.id), ['a', 'b']);

    const SANS = A(700, table(new Map([[700, []]])));
    H.v('un produit sans jumeau : affirmé comme avant', [SANS.issue, SANS.analyse.cartes[0].statut, SANS.analyse.cartes[0].carte.idProduct], ['affirmee', 'identifiee', 700]);

    const TROIS = A(700, table(new Map([[700, [701, 702]]])));
    H.v('P + 2 jumeaux = 3 produits : une question à 3', [TROIS.issue, ids(TROIS)], ['question', [700, 701, 702]]);

    const QUATRE = A(700, table(new Map([[700, [701, 702, 703]]])));
    H.v('P + 3 jumeaux = 4 produits : introuvable, jamais un choix de 3 parmi N ; la raison SERVIE dit la vérité (impression-indeterminee, pas photo-illisible)', [QUATRE.issue, QUATRE.analyse.cartes[0].statut, QUATRE.analyse.cartes[0].raison], ['introuvable', 'introuvable', 'impression-indeterminee']);
    H.vrai('   « impression-indeterminee » est dans la liste fermée de l\'adaptateur (RAISONS), additive', require('../identifier/adaptateur').RAISONS.includes('impression-indeterminee') && require('../identifier/adaptateur').RAISONS.includes('photo-illisible'));
    H.v('   le motif distinct est dit (jumeaux-trop-nombreux)', QUATRE.motif, 'jumeaux-trop-nombreux');
    const GROS = A(700, table(new Map([[700, [701, 702, 703, 704]]])));
    H.v('   5 produits : de même', [GROS.issue, GROS.motif], ['introuvable', 'jumeaux-trop-nombreux']);

    const SANSFOURNISSEUR = adapter({ statutHttp: 200, corps: succes(700) }, { produits, langueInterface: 'fr', cfg });
    // I1 de la relecture 1 : une colonne qui manque est une panne de NOTRE côté (INDISPONIBLE, remboursée sans plafond), jamais un « introuvable » (la photo n'y est pour rien)
    const estPanne = (r, motif) => [r.issue, r.erreur && r.erreur.code, r.analyse, r.motif].join('|') === ['panne', 'INDISPONIBLE', null, motif].join('|');
    H.vrai('AUCUN fournisseur de jumeaux dans le contexte : aucune affirmation, PANNE INDISPONIBLE, motif jumeaux-indisponibles', estPanne(SANSFOURNISSEUR, 'jumeaux-indisponibles'));
    const NONCONCLU = A(700, table(new Map()));
    H.vrai('colonne absente (le fournisseur ne conclut pas pour ce produit) : PANNE INDISPONIBLE, motif jumeaux-indisponibles', estPanne(NONCONCLU, 'jumeaux-indisponibles'));
    const PLANTE = A(700, () => { throw new Error('boom'); });
    H.vrai('un fournisseur qui LÈVE : PANNE INDISPONIBLE (jamais le défaut passant)', estPanne(PLANTE, 'jumeaux-indisponibles'));
    const MAL = A(700, () => ({ conclu: true, ids: 'x' }));
    H.vrai('un fournisseur qui rend une forme inconnue : PANNE INDISPONIBLE', estPanne(MAL, 'jumeaux-indisponibles'));
    const ABSENT = A(740794, table(new Map([[740794, [999999]]])));
    H.vrai('un jumeau qui n\'a pas de ligne au catalogue de l\'API (pas de question possible) : PANNE INDISPONIBLE, motif jumeaux-incomplets', estPanne(ABSENT, 'jumeaux-incomplets'));
    const PERIME = A(700, () => ({ conclu: false, ids: [], motif: 'jumeaux-perimes' }));
    H.vrai('une colonne PÉRIMÉE (le fournisseur le dit) : PANNE INDISPONIBLE, motif jumeaux-perimes, jamais une affirmation', estPanne(PERIME, 'jumeaux-perimes'));
    H.vrai('   un motif inconnu rendu par un fournisseur retombe sur jumeaux-indisponibles (liste fermée)', estPanne(A(700, () => ({ conclu: false, ids: [], motif: 'autre-chose' })), 'jumeaux-indisponibles'));
    H.v('un jumeau égal à P lui-même est ignoré (dédoublonné)', A(700, table(new Map([[700, [700, 701]]]))).issue, 'question');

    // les autres issues ne passent PAS par la garde : une ambiguë reste une question, un refus reste un refus
    const amb = { ...succes(700), carte: { idProduct: 700, ambigu: true, niveauReserve: 'forte', raisonReserve: 'x', concurrent: null, nbExAequo: 2 }, candidats: [{ idProduct: 701 }, { idProduct: 700 }] };
    H.v('une ambiguë à 2 candidats : toujours une question à 2 (la garde ne s\'applique qu\'aux affirmations)', adapter({ statutHttp: 200, corps: amb }, ctx(null)).issue, 'question');

    // le compteur : chaque refus de la garde est COMPTÉ, par motif
    const C = require('../identifier/jumeaux');
    const avant = C.compteurs();
    A(700, table(new Map([[700, [701, 702, 703]]])));
    A(700, table(new Map([[700, [701]]])));
    const apres = C.compteurs();
    H.v('compteurs : +1 jumeaux-trop-nombreux, +1 question-de-jumeaux', [apres['jumeaux-trop-nombreux'] - avant['jumeaux-trop-nombreux'], apres['question-de-jumeaux'] - avant['question-de-jumeaux']], [1, 1]);

    // ── 4. le fournisseur de la route : lit la version EN PLACE, une version à la fois
    const four = C.fournisseurDe(v);
    H.v('fournisseurDe(version) : conclu + ids ; un produit hors colonne : ne conclut pas', [four(740794), four(424242)], [{ conclu: true, ids: [805556, 900003, 900004] }, { conclu: false, ids: [], motif: 'jumeaux-indisponibles' }]);
    H.v('fournisseurDe(null) : ne conclut jamais', C.fournisseurDe(null)(740794), { conclu: false, ids: [], motif: 'jumeaux-indisponibles' });
    H.v('fournisseurDe(version sans colonne) : ne conclut jamais', C.fournisseurDe(sansColonne)(1), { conclu: false, ids: [], motif: 'jumeaux-indisponibles' });
    // I2 de la relecture 1 : la colonne décrit UN catalogue ; si le catalogue de la route a bougé (produit ajouté), elle ne conclut plus
    const live = { n: 15, max: 900004 };
    H.v('fournisseurDe(version, empreinte du catalogue identique) : conclut', C.fournisseurDe(v, live)(740794).conclu, true);
    H.v('   un produit AJOUTÉ au catalogue depuis l\'archive (n différent) : ne conclut plus, motif jumeaux-perimes', C.fournisseurDe(v, { n: 16, max: 900004 })(740794), { conclu: false, ids: [], motif: 'jumeaux-perimes' });
    H.v('   un autre plus grand idProduct (même n) : périmée aussi', C.fournisseurDe(v, { n: 15, max: 900005 })(740794).motif, 'jumeaux-perimes');
    H.v('   l\'empreinte du catalogue illisible (null) : ne conclut pas, motif jumeaux-indisponibles', C.fournisseurDe(v, null)(740794), { conclu: false, ids: [], motif: 'jumeaux-indisponibles' });
    H.v('   une empreinte de forme inconnue : ne conclut pas', C.fournisseurDe(v, { n: 'x' })(740794).conclu, false);
    H.v('   la colonne absente reste « ne conclut pas », empreinte ou non', [C.fournisseurDe(sansColonne, live)(1).conclu, C.fournisseurDe(null, live)(1).conclu], [false, false]);
    // le fournisseur de PRODUCTION lit l'empreinte du catalogue lui-même ; tout ce qui n'est pas une empreinte valide empêche de conclure
    const pd = async cat => (await C.fournisseurParDefaut(cat, v))(740794);
    H.v('fournisseurParDefaut : empreinte identique → conclut ; différente → périmée ; qui lève, absente ou illisible → indisponible',
        [(await pd({ empreinte: async () => live })).conclu, (await pd({ empreinte: async () => ({ n: 99, max: 900004 }) })).motif, (await pd({ empreinte: async () => { throw new Error('mongo muet'); } })).motif, (await pd({})).motif, (await pd({ empreinte: async () => ({ n: 0, max: 0 }) })).motif],
        [true, 'jumeaux-perimes', 'jumeaux-indisponibles', 'jumeaux-indisponibles', 'jumeaux-indisponibles']);
    H.v('idsACharger : les jumeaux de l\'affirmation, seulement s\'ils tiennent dans une question (au plus 2)', [
        C.idsACharger({ success: true, carte: { idProduct: 740794, ambigu: false }, candidats: [{ idProduct: 740794 }] }, C.fournisseurDe(relue)),
        C.idsACharger({ success: true, carte: { idProduct: 1, ambigu: false }, candidats: [] }, four),
        C.idsACharger({ success: true, carte: { idProduct: 2, ambigu: true }, candidats: [{ idProduct: 2 }] }, four)], [[], [], []]);
    const v2 = (() => { const b = creerConstructeur(); b.entree(brut(10, 9)); b.jumeau(J(10, 9, 1, '1', 'intl')); b.jumeau(J(11, 9, 2, '1', 'intl')); b.jumeau(J(12, 9, 3, '1', 'intl')); return b.finir(); })();
    H.v('idsACharger : 2 jumeaux → chargés ; la route peut alors poser la question', C.idsACharger({ success: true, carte: { idProduct: 10, ambigu: false }, candidats: [{ idProduct: 10 }] }, C.fournisseurDe(v2)), [11, 12]);

    // ── 5. le producteur : decision.js émet le créneau et la langue de CHAQUE produit du catalogue (aussi ceux sans ligne, sans visuel, sans métacarte)
    const { decider } = require('../chargeur/decision');
    const { regleEmbarquee } = require('../chargeur/regle-site');
    const regle = await regleEmbarquee();
    const sets = [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } },
        { _id: 'Set-JP', idExpansion: 300, code: 'SJ', nomAffichage: 'Set JP', tirage: 'jp', region: 'jp', bulba: { expansion: 'Set JP' } }];
    const docs = [{ _id: 1, nomEn: 'Carte 1', sets: ['Set-A', 'Set-JP'], impressions: [], images: [] }];
    const lignes = [{ idProduct: 1001, carteId: 1, idExpansion: 100, numeroFiche: '001', slug: 'P1001', slugSet: 'Set-A' }, { idProduct: 1012, carteId: 1, idExpansion: 300, numeroFiche: '7', slug: 'P1012', slugSet: 'Set-JP' }];
    const metacarte = new Map([[1001, 5], [1012, 5], [9999, 5], [8888, null]]);
    const dec = await decider({ sets, docs, lignes, metacarte, regle });
    const jd = id => dec.jumeaux.find(x => x.idProduct === id);
    H.v('decider : un produit à ligne porte sa métacarte, son expansion, son numéro de fiche normalisé et sa langue de tirage', [jd(1001).idMetacard, jd(1001).idExpansion, jd(1001).numero, jd(1001).tirage], [5, 100, regle.normaliserNumero('001'), 'intl']);
    H.v('   le set japonais : tirage jp', [jd(1012).idExpansion, jd(1012).tirage], [300, 'jp']);
    H.v('   un produit du catalogue SANS ligne : créneau et langue inconnus (null), jamais devinés ; sans métacarte : null', [jd(9999), jd(8888)],
        [{ idProduct: 9999, idMetacard: 5, idExpansion: null, numero: null, tirage: null }, { idProduct: 8888, idMetacard: null, idExpansion: null, numero: null, tirage: null }]);
    H.v('   tout le catalogue est émis : 4 produits, 4 lignes (aucun perdu)', dec.jumeaux.length, 4);
    const { calculer } = require('../chargeur/calcul');
    const vc = (await calculer({ sets, docs, lignes, metacarte, regle, decider: async ({ sink }) => { sink.entree(brut(1001, 5)); sink.lien('Set-A', '1|001', [1001]); sink.jumeau(J(1001, 5, 100, '1', 'intl')); sink.jumeau(J(1012, 5, 300, '7', 'intl')); return { denominateurs: { setsAvecLiens: 1, produitsLies: 1 }, liens: new Map() }; } })).version;
    H.v('calculer : le sink range les jumeaux dans la version (colonne présente, jumeaux relus)', [vc.colonneJumeaux, vc.jumeauxDe(1001), vc.jumeauxDe(1012)], [true, [1012], [1001]]);
    const sansSink = await calculer({ sets, docs, lignes, metacarte, regle, decider: async ({ sink }) => { sink.entree(brut(1001, 5)); sink.lien('Set-A', '1|001', [1001]); return { denominateurs: { setsAvecLiens: 1, produitsLies: 1 }, liens: new Map() }; } });
    H.v('calculer avec un producteur qui n\'émet aucun jumeau : version SANS colonne (la route n\'affirmera rien)', sansSink.version.colonneJumeaux, false);

    H.bilan();
})().catch(e => { console.error('❌ EXCEPTION', e); process.exitCode = 1; });

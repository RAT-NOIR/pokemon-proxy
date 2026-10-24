'use strict';
// Banc ETAT-FOURCHETTE (pur : aucune base, aucun réseau) — décision de l'éditeur (2026-10-24) : un scan dont l'état n'est pas estimable AFFICHE une FOURCHETTE de prix avec la mention
// « état non estimable sur les photos », jamais un prix sûr ; le prix n'est jamais refusé à cause de l'état. UNE définition (v2/identifier/fourchette-etat.js), appelée par la réponse
// d'identification (prix-repli.js::avecRepliAnalyse) ET par le retour en direct (prix-repli.js::repliRetourLive). Les chiffres sont ceux du guide RÉEL de Tauros et d'Arcanin
// (fixtures/prix-repli-reels.json) : aucune valeur inventée ; les grilles lues en direct de ce banc sont des entrées de test, jamais un prix de production.
const fs = require('fs'), path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { construireProduit } = require('../identifier/produit');
const F = require('../identifier/fiabilite-prix');
const FE = require('../identifier/fourchette-etat');
const R = require('../identifier/prix-repli');
const { valider } = require('../openapi/valider');
const doc = require('../openapi/openapi.v2.json');

const REEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prix-repli-reels.json'), 'utf8')).cas;
const cfg = lireConfig({});
const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
const ligne = (nom, o = {}) => {
    const c = REEL[nom];
    return { idProduct: c.idProduct, nomCardmarket: c.produit.nomCardmarket, set: { slug: c.produit.set.slug, nom: c.produit.set.nom, code: c.produit.set.code }, numero: c.produit.numero, total: c.produit.total, langue: 'EN', variante: null,
        rarete: c.produit.rarete, prixGuide: { ...c.guide, guideDu: new Date(c.guide.guideDu) }, visuel: { url: `${HOTE}${c.idProduct}.webp`, w: 255, h: 356 }, ...o };
};
const produit = (nom, o) => construireProduit(ligne(nom, o), { langueInterface: 'fr', cfg });
const guideDe = nom => produit(nom).prixGuide;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const valide = (x, schema) => valider(JSON.parse(JSON.stringify(x)), ref(schema), doc).ok;
const MENTION = 'etat-non-estimable';
const g = guideDe('tauros'), arc = guideDe('arcanin');

// ── 1. la mention est une valeur de la liste fermée des réserves, la dernière ; aucune réserve ne rend un prix fiable
v('la liste fermée des réserves porte la nouvelle mention, en dernier', [...F.RESERVES].slice(-2), ['version-tamponnee-prix-sous-estime', MENTION]);
v('F.ETAT_NON_ESTIMABLE est cette valeur (une seule définition du mot)', F.ETAT_NON_ESTIMABLE, MENTION);
v('fiable : la mention seule ne rend jamais un prix fiable', [F.fiable([MENTION]), F.fiable(['ecart-tendance', MENTION]), F.fiable([])], [false, false, true]);
v('reservesDe ne produit JAMAIS la mention (elle dépend de l\'état de la photo, pas du produit)', F.reservesDe({ tendance: 10, moyenne7: 10, moyenne30: 10 }), []);

// ── 2. LA règle : l'état est non estimable sauf si au moins un état est donné et que TOUS sont de la liste
{
    const ne = FE.etatNonEstimable;
    v('un état valide (chacun des sept) : estimable', ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'].map(e => ne(e)), [false, false, false, false, false, false, false]);
    v('minuscules et espaces (comme le journal les range) : normalisés', [ne('ex'), ne(' gd ')], [false, false]);
    v('null, undefined, vide : non estimable', [ne(null), ne(undefined), ne(''), ne()], [true, true, true, true]);
    v('hors liste (MINT, EX+, LP/PL, un nombre, un objet) : non estimable', [ne('MINT'), ne('EX+'), ne('LP/PL'), ne(3), ne({})], [true, true, true, true, true]);
    v('plusieurs sources : une seule nulle ou hors liste suffit (la prudence)', [ne('EX', null), ne('EX', 'MINT'), ne('EX', 'NM'), ne(null, 'EX')], [true, true, false, true]);
    v('ETATS est l\'ordre du meilleur au pire, et prix-repli.js n\'en a pas une seconde copie', [FE.ETATS, R.ETATS === FE.ETATS], [['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'], true]);
}

// ── 3. les bornes : d'où elles viennent, et ce que dit la réponse quand une borne n'a aucune donnée
{
    const f = FE.fourchetteDe({ guide: g });
    v('guide seul (Tauros 0,02 / 1,49) : basse = le « De » du guide, haute ABSENTE (le guide n\'a aucun prix par état)', f, { basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] });
    v('  ni la tendance ni les moyennes ne deviennent la borne haute (ce sont des prix tous états)', f.haute, null);
    const gr = FE.fourchetteDe({ guide: g, grille: { NM: 1.4, EX: 1.1, GD: 0.5 } });
    // TOUR 4 CORRECTION 1 (I1) : l'état est NON estimable, donc tous les états jusqu'au plus abîmé sont plausibles ; une grille qui ne contient pas le bas ne fixe pas la borne basse seule.
    // La borne basse est le MINIMUM de tout ce qui est connu (la grille, même partielle, ET le « De » du guide), avec la source de ce minimum.
    v('grille (3 états) et « De » du guide à 0,02 : basse = le minimum des deux (le « De »), haute = le plus cher de la grille', gr, { basse: { prix: 0.02, source: 'guide-de' }, haute: { prix: 1.4, source: 'grille-directe' }, absentes: [] });
    const garde = de => ({ ...g, de });
    v('I1. grille { NM 5, EX 4 } et « De » à 2 : basse = 2 (guide-de) — la grille ne contient pas le bas, elle ne fixe pas la basse', FE.fourchetteDe({ guide: garde(2), grille: { NM: 5, EX: 4 } }), { basse: { prix: 2, source: 'guide-de' }, haute: { prix: 5, source: 'grille-directe' }, absentes: [] });
    v('I1. grille { NM 5, EX 4 } et « De » à 4,5 : la grille descend plus bas, basse = 4 (grille-directe), la source le dit', FE.fourchetteDe({ guide: garde(4.5), grille: { NM: 5, EX: 4 } }).basse, { prix: 4, source: 'grille-directe' });
    v('I1. égalité grille / « De » : la source nommée est la grille (elle a lu ce prix en direct)', FE.fourchetteDe({ guide: garde(4), grille: { NM: 5, EX: 4 } }).basse, { prix: 4, source: 'grille-directe' });
    v('I1. la borne basse n\'est jamais au-dessus d\'un prix connu', [{ NM: 5, EX: 4 }, { PO: 0.5, NM: 9 }, { EX: 3 }].every(gl => { const f = FE.fourchetteDe({ guide: garde(2), grille: gl }); return Object.values(gl).every(p => f.basse.prix <= p); }), true);
    v('grille sans guide : les deux bornes viennent de la grille', FE.fourchetteDe({ guide: null, grille: { NM: 3, PL: 1 } }), { basse: { prix: 1, source: 'grille-directe' }, haute: { prix: 3, source: 'grille-directe' }, absentes: [] });
    v('grille à UN seul état : elle ne borne pas le HAUT (on ne sait pas si un meilleur état coûte plus) ; son prix compte pour le BAS, le minimum des connus', [FE.fourchetteDe({ guide: g, grille: { EX: 1.1 } }), FE.fourchetteDe({ guide: garde(3), grille: { EX: 2 } })], [{ basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] }, { basse: { prix: 2, source: 'grille-directe' }, haute: null, absentes: ['haute'] }]);
    v('grille à un seul état et pas de guide : la basse est ce prix lu, la haute est absente et dite absente', FE.fourchetteDe({ guide: null, grille: { EX: 1.1 } }), { basse: { prix: 1.1, source: 'grille-directe' }, haute: null, absentes: ['haute'] });
    v('clés en minuscules : normalisées', FE.fourchetteDe({ guide: null, grille: { nm: 2, ex: 1 } }).basse, { prix: 1, source: 'grille-directe' });
    v('états hors liste, prix nuls/négatifs/texte/NaN : écartés (deux états valides restent)', FE.fourchetteDe({ guide: null, grille: { NM: 2, EX: 1, MINT: 0.1, GD: 0, LP: -1, PL: '0,5', PO: NaN } }), { basse: { prix: 1, source: 'grille-directe' }, haute: { prix: 2, source: 'grille-directe' }, absentes: [] });
    v('deux clés pour le même état (NM et nm, valeurs différentes) : l\'état est ambigu, il est écarté ; il ne reste qu\'EX', FE.fourchetteDe({ guide: null, grille: { NM: 5, nm: 2, EX: 1 } }), { basse: { prix: 1, source: 'grille-directe' }, haute: null, absentes: ['haute'] });
    // TOUR 4 CORRECTION 1 (M2) : le serveur ne sert jamais une borne hors de son propre schéma (BornePrix.prix >= 0,01)
    v('M2. un prix sous 0,01 (0,004, 0,003) est une valeur invalide de la grille : écarté, comme un zéro', FE.fourchetteDe({ guide: null, grille: { NM: 0.004, EX: 0.003 } }), { basse: null, haute: null, absentes: ['basse', 'haute'] });
    v('M2. une grille dont un seul prix est sous 0,01 : il est écarté, les autres restent', FE.fourchetteDe({ guide: null, grille: { NM: 3, EX: 2, GD: 0.009 } }), { basse: { prix: 2, source: 'grille-directe' }, haute: { prix: 3, source: 'grille-directe' }, absentes: [] });
    v('M2. 0,01 exactement est un prix (le plus petit de Cardmarket) ; un « De » sous 0,01 est écarté', [FE.fourchetteDe({ guide: null, grille: { NM: 0.01, EX: 0.02 } }).basse, FE.fourchetteDe({ guide: garde(0.005) }).basse], [{ prix: 0.01, source: 'grille-directe' }, null]);
    v('M2. toute borne servie tient dans le schéma BornePrix (minimum 0,01)', [{ NM: 0.004 }, { NM: 0.01, PO: 0.02 }, { NM: 7, EX: 0.0099 }].every(gl => { const f = FE.fourchetteDe({ guide: garde(0.003), grille: gl }); return [f.basse, f.haute].every(b => b === null || valider(JSON.parse(JSON.stringify(b)), ref('BornePrix'), doc).ok); }), true);
    v('une grille qui n\'est pas un objet (tableau, texte, null) : ignorée', [[1, 2], 'NM', null, undefined, 3].map(x => FE.fourchetteDe({ guide: g, grille: x }).basse.source), ['guide-de', 'guide-de', 'guide-de', 'guide-de', 'guide-de']);
    v('guide sans « De » (null) et sans grille : rien ne donne de borne, les deux sont dites absentes', FE.fourchetteDe({ guide: { ...g, de: null } }), { basse: null, haute: null, absentes: ['basse', 'haute'] });
    v('un « De » à zéro n\'est pas un prix', FE.fourchetteDe({ guide: { ...g, de: 0 } }).basse, null);
    v('l\'objet rendu est gelé (aucune mutation par un appelant)', [Object.isFrozen(f), Object.isFrozen(f.basse), Object.isFrozen(f.absentes)], [true, true, true]);
    v('pas d\'argument : rien ne donne de borne, jamais une exception', FE.fourchetteDe(), { basse: null, haute: null, absentes: ['basse', 'haute'] });
    // la grille d'entrée n'est jamais modifiée
    const entree = { NM: 2, ex: 1 }; FE.fourchetteDe({ grille: entree });
    v('la grille passée n\'est pas modifiée', entree, { NM: 2, ex: 1 });
}

// ── 4. le guide « sous fourchette » : jamais fiable, la mention à côté des réserves existantes, l'original intact
{
    const s = FE.guideSousFourchette(arc);
    v('Arcanin (déjà ecart-tendance) : la mention s\'ajoute APRÈS les réserves existantes, fiable false', [s.fiable, s.reserves], [false, ['ecart-tendance', MENTION]]);
    const t = FE.guideSousFourchette(g);
    v('Tauros (guide fiable, aucune réserve) : fiable passe à false, la mention seule', [g.fiable, g.reserves, t.fiable, t.reserves], [true, [], false, [MENTION]]);
    v('  l\'original est intact (le guide de la fiche n\'est pas touché)', [g.fiable, g.reserves.length], [true, 0]);
    v('  les chiffres du guide sont ceux de la fiche', [t.tendance, t.de, t.moyenne7, t.moyenne30, t.date, t.deBase], [g.tendance, g.de, g.moyenne7, g.moyenne30, g.date, g.deBase]);
    v('  idempotent : appliquer deux fois ne double pas la mention', FE.guideSousFourchette(t).reserves, [MENTION]);
    v('  l\'ordre des clés du guide est celui d\'avant', JSON.stringify(Object.keys(t)), JSON.stringify(Object.keys(g)));
    v('  gelé', Object.isFrozen(t) && Object.isFrozen(t.reserves), true);
}

// ── 5. L'ANALYSE (identification) : etat.retenu null => la fourchette, quel que soit le chemin (langue lue ou non) ; état retenu => rien ne change
{
    const carteNulle = (o = {}) => ({ index: 0, statut: 'identifiee', carte: produit('tauros'), candidats: [], question: null, raison: null,
        etat: { estime: 'EX', confiance: 'basse', defauts: [], declare: null, retenu: null }, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: null }, zone: null, ...o });
    const c = carteNulle();
    const e = R.avecRepliAnalyse(c);
    v('retenu null, langue lue : repli tendance / etat-non-retenu / fiable false', [e.prixRepli.repli, e.prixRepli.cause, e.prixRepli.fiable], ['tendance', 'etat-non-retenu', false]);
    v('  la fourchette : basse = 0,02 (le « De »), haute absente, et la réponse DIT laquelle', e.prixRepli.fourchette, { basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] });
    v('  le guide du repli porte la mention et n\'est pas fiable (même quand le guide de la fiche l\'est)', [e.prixRepli.guide.fiable, e.prixRepli.guide.reserves, c.carte.prixGuide.fiable], [false, [MENTION], true]);
    // TOUR 4 CORRECTION 1 (M1) : « jamais un prix sûr » vaut pour TOUT prix servi d'un scan à état nul : le prixGuide de la carte (et des impressions, et des candidats) porte la même mention, sur la même règle
    v('M1. la carte garde son verdict d\'identification et sa fiche, mais son prixGuide n\'est plus fiable et porte la mention (comme celui du repli)', [e.statut, e.carte.idProduct, e.carte.prixGuide.fiable, e.carte.prixGuide.reserves, e.carte.prixGuide], [ 'identifiee', c.carte.idProduct, false, [MENTION], e.prixRepli.guide ]);
    v('M1. la carte d\'origine n\'est pas mutée (le prixGuide de la fiche source reste fiable)', [c.carte.prixGuide.fiable, c.carte.prixGuide.reserves, c.carte === e.carte], [true, [], false]);
    v('M1. le reste de la carte est intact (même nom, même set, mêmes liens)', [e.carte.nom, e.carte.set, e.carte.liens, e.carte.numero], [c.carte.nom, c.carte.set, c.carte.liens, c.carte.numero]);
    {
        const gI = { ...REEL.tauros.guide, guideDu: new Date(REEL.tauros.guide.guideDu) };
        const avecImp = produit('tauros', { impressions: [{ idProduct: 273844, numero: '47', langue: 'en', set: { nom: 'Jungle' }, prixGuide: gI }, { idProduct: 273845, numero: '47', langue: 'fr', set: { nom: 'Jungle' } }] });
        const ci = R.avecRepliAnalyse(carteNulle({ carte: avecImp }));
        v('M1. les impressions servies portent la même mention ; une impression sans prix reste sans prix', [ci.carte.impressions.map(i => i.prixGuide && i.prixGuide.fiable), ci.carte.impressions[0].prixGuide.reserves, ci.carte.impressions[1].prixGuide], [[false, null].map(x => x === null ? null : x), [MENTION], null]);
        const cand = R.avecRepliAnalyse({ index: 0, statut: 'a-trancher', carte: null, candidats: [produit('tauros'), produit('arcanin')], question: { code: 'x' }, raison: null, etat: { estime: 'EX', confiance: 'basse', defauts: [], declare: null, retenu: null }, prixLive: null, zone: null });
        v('M1. une question à trancher dont l\'état est nul : le prixGuide de chaque candidat est sous la mention (jamais fiable), sans repli', [cand.candidats.map(x => x.prixGuide.fiable), cand.candidats.map(x => x.prixGuide.reserves), 'prixRepli' in cand], [[false, false], [[MENTION], ['ecart-tendance', MENTION]], false]);
        const candOk = { index: 0, statut: 'a-trancher', carte: null, candidats: [produit('tauros')], question: { code: 'x' }, raison: null, etat: { estime: 'EX', confiance: 'haute', defauts: [], declare: null, retenu: 'EX' }, prixLive: null, zone: null };
        v('M1. témoin : une question dont l\'état est retenu est rendue telle quelle (la même référence)', R.avecRepliAnalyse(candOk) === candOk, true);
        const intro = { index: 0, statut: 'introuvable', carte: null, candidats: [], question: null, raison: 'photo-illisible', etat: null, prixLive: null, zone: null };
        v('M1. une carte introuvable (aucun prix servi) est rendue telle quelle', R.avecRepliAnalyse(intro) === intro, true);
        v('M1. idempotent : une carte déjà sous la mention n\'est pas modifiée par un second passage', JSON.stringify(R.avecRepliAnalyse({ ...e, prixRepli: undefined }).carte.prixGuide.reserves), JSON.stringify([MENTION]));
        const sansPrix = R.avecRepliAnalyse(carteNulle({ carte: produit('tauros', { prixGuide: { trend: 0, low: 0, avg7: null, avg30: undefined, guideDu: new Date('2026-10-12') } }) }));
        v('M1. une fiche sans aucun prix (prixGuide null) reste rendue telle quelle : rien à marquer, A15 inchangé', [sansPrix.carte.prixGuide, 'prixRepli' in sansPrix], [null, false]);
    }
    v('  aucun verdict, aucune offre, aucun champ de prix inventé', [e.prixRepli.offre, 'verdict' in e.prixRepli, Object.keys(e.prixRepli)], [null, false, ['repli', 'cause', 'fiable', 'guide', 'offre', 'fourchette']]);
    vrai('  le quota : un scan à fourchette AFFICHE un prix (la même règle afficheUnPrix, REPLI-QUOTA inchangée)', R.afficheUnPrix({ repli: e.prixRepli }));
    const l = R.avecRepliAnalyse(carteNulle({ prixLive: null }));
    v('retenu null ET langue non lue : la cause reste langue-non-lue, la fourchette est servie aussi', [l.prixRepli.cause, l.prixRepli.fourchette.basse, l.prixRepli.guide.reserves], ['langue-non-lue', { prix: 0.02, source: 'guide-de' }, [MENTION]]);
    const sansEtat = R.avecRepliAnalyse(carteNulle({ etat: null, prixLive: null }));
    v('aucune donnée d\'état du tout (etat absent) et langue non lue : non estimable (« je ne peux pas conclure » n\'est jamais « tout va bien »)', [sansEtat.prixRepli.fourchette !== undefined, sansEtat.prixRepli.guide.reserves], [true, [MENTION]]);
    // l'état est retenu : rien ne change, octet pour octet
    const retenue = carteNulle({ etat: { estime: 'EX', confiance: 'haute', defauts: [], declare: null, retenu: 'EX' }, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: 'EX' } });
    v('état retenu EX et prix à lire : la MÊME carte, aucun repli', R.avecRepliAnalyse(retenue) === retenue, true);
    const langueNonLue = R.avecRepliAnalyse({ ...retenue, prixLive: null }).prixRepli;
    v('état retenu EX mais langue non lue : le repli d\'avant, SANS fourchette ni mention (l\'état est estimé)', [langueNonLue.cause, 'fourchette' in langueNonLue, langueNonLue.guide.reserves, langueNonLue.guide.fiable], ['langue-non-lue', false, [], true]);
    // prudence : deux sources d'état qui se contredisent
    const contradictoire = R.avecRepliAnalyse(carteNulle({ prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: 'EX' } }));
    v('etat.retenu null mais etatVise EX (incohérent) : la prudence l\'emporte, fourchette, cause etat-non-retenu', [contradictoire.prixRepli && contradictoire.prixRepli.cause, contradictoire.prixRepli && Object.keys(contradictoire.prixRepli.fourchette)], ['etat-non-retenu', ['basse', 'haute', 'absentes']]);
    const inverse = R.avecRepliAnalyse(carteNulle({ etat: { estime: 'EX', confiance: 'haute', defauts: [], declare: null, retenu: 'EX' } }));
    v('etat.retenu EX mais etatVise null (incohérent) : la prudence l\'emporte aussi', inverse.prixRepli && inverse.prixRepli.fourchette !== undefined, true);
    // l'état hors liste n'est pas un état
    const horsListe = R.avecRepliAnalyse(carteNulle({ etat: { estime: 'EX', confiance: 'haute', defauts: [], declare: null, retenu: 'MINT' }, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: 'MINT' } }));
    v('un état retenu hors liste (MINT) n\'est pas un état : fourchette', horsListe.prixRepli && horsListe.prixRepli.fourchette !== undefined, true);
    // sans aucune donnée de prix : le prix n'est pas refusé À CAUSE DE L'ÉTAT, mais il n'y a rien à servir -> aucun repli (« illisible » seulement alors)
    const sg = carteNulle({ carte: produit('tauros', { prixGuide: { trend: 0, low: 0, avg7: null, avg30: undefined, guideDu: new Date('2026-10-12') } }) });
    v('fiche sans aucune donnée de prix : aucun repli (la même carte)', R.avecRepliAnalyse(sg) === sg, true);
    // une carte à trancher n'a jamais de repli
    const q = carteNulle({ statut: 'a-trancher', carte: null });
    v('une carte à trancher : jamais de repli', R.avecRepliAnalyse(q) === q, true);
    // le guide de la fiche n'est PAS muté par le repli (la carte sert toujours son prixGuide d'origine)
    v('la fiche SOURCE garde son guide d\'origine après le repli (la réponse sert une copie sous la mention)', [c.carte.prixGuide.fiable, c.carte.prixGuide.reserves, Object.isFrozen(c.carte.prixGuide)], [true, [], true]);
    // l'analyse entière
    const ana = R.analyseAvecRepli({ statut: 'identifiee', cartes: [c], lot: null, raison: null, regleVerdict: null });
    v('analyse entière : la carte à état nul porte la fourchette', [ana.cartes[0].prixRepli.fourchette.basse.prix, ana.statut], [0.02, 'identifiee']);
}

// ── 6. LE RETOUR EN DIRECT : retenu null => la même règle (même fonction), jamais un prix d'un seul état présenté comme sûr
{
    const base = { prixGuide: g, retenu: null, originePrix: null, prixLive: null, prixLiveEtat: null, lectureRatee: null };
    for (const definitive of [true, false]) {
        const x = R.repliRetourLive({ ...base, lectureRatee: { cause: 'sans-prix', definitive } });
        v(`lecture ratée (définitive ${definitive}), retenu null : tendance / lecture-ratee + fourchette + mention`, [x.repli, x.cause, x.fiable, x.fourchette.basse, x.fourchette.haute, x.guide.reserves], ['tendance', 'lecture-ratee', false, { prix: 0.02, source: 'guide-de' }, null, [MENTION]]);
    }
    const t = R.repliRetourLive({ ...base, originePrix: 'tendance', prixLive: 7.67 });
    v('tendance seule, retenu null : tendance-seule + fourchette', [t.cause, t.fourchette.absentes, t.guide.fiable], ['tendance-seule', ['haute'], false]);
    // une OFFRE lue en direct alors que l'état est nul : jamais « un prix dans l'état »
    const o = R.repliRetourLive({ ...base, originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', grilleLive: { NM: 1.4, EX: 1.1, GD: 0.9 } });
    v('offre de la grille lue alors que l\'état est nul : repli tendance / etat-non-retenu, haute = le plus cher de la grille (1,4), basse = le minimum de la grille (0,9) et du « De » du guide (0,02)', [o.repli, o.cause, o.fiable, o.fourchette], ['tendance', 'etat-non-retenu', false, { basse: { prix: 0.02, source: 'guide-de' }, haute: { prix: 1.4, source: 'grille-directe' }, absentes: [] }]);
    const dessous = R.repliRetourLive({ ...base, prixGuide: guideDe('arcanin'), originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', grilleLive: { NM: 6, GD: 0.9 } });
    v('I1. au retour en direct aussi : grille { NM 6, GD 0,9 } sous le « De » d\'Arcanin (1) : basse = 0,9 (grille-directe), haute 6', dessous.fourchette, { basse: { prix: 0.9, source: 'grille-directe' }, haute: { prix: 6, source: 'grille-directe' }, absentes: [] });
    // TOUR 4 CORRECTION 1 (M3) : état nul, un prix lu SANS originePrix (extensions anciennes) : jamais le prix d'un seul état sans la mention ni fiable:false. Forme la plus simple qui tienne la règle :
    // la MÊME règle que pour une grille, ouverte à toute origine — dès qu'un prix valide est lu et que l'état est nul, le repli à fourchette est servi (cause etat-non-retenu, sans grille : seuls guide-de et le prix lu bornent).
    for (const origine of [null, undefined, '', 'inconnue']) {
        const m = R.repliRetourLive({ ...base, originePrix: origine, prixLive: 0.9, prixLiveEtat: 'GD' });
        v(`M3. état nul, prix lu 0,9 en GD, originePrix ${JSON.stringify(origine)} : repli à fourchette, mention, fiable false`, [m && m.repli, m && m.cause, m && m.fiable, m && m.guide.fiable, m && m.guide.reserves, m && m.offre], ['tendance', 'etat-non-retenu', false, false, [MENTION], null]);
    }
    v('M3. sans originePrix, un prix non valide (0, NaN, absent) et pas de lecture ratée : rien à servir', [0, NaN, null, undefined, '0,9'].map(p => R.repliRetourLive({ ...base, originePrix: null, prixLive: p })), [null, null, null, null, null]);
    v('M3. sans originePrix mais avec un état retenu : comme avant (aucun repli)', R.repliRetourLive({ prixGuide: g, retenu: 'EX', originePrix: null, prixLive: 0.9, prixLiveEtat: 'GD' }), null);
    v('M3. sans originePrix, état nul, fiche sans guide : rien à servir', R.repliRetourLive({ ...base, prixGuide: null, originePrix: null, prixLive: 0.9 }), null);
    v('  l\'offre d\'UN état n\'est pas servie comme un prix sûr : le repli n\'a pas d\'offre, il porte la fourchette', [o.offre, 'verdict' in o], [null, false]);
    const seule = R.repliRetourLive({ ...base, originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD' });
    v('offre sans grille envoyée, retenu null : repli sur le guide (basse = « De », haute absente)', [seule.cause, seule.fourchette], ['etat-non-retenu', { basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] }]);
    const unEtat = R.repliRetourLive({ ...base, originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', grilleLive: { GD: 0.9 } });
    v('grille à un seul état, retenu null : elle ne borne rien, le guide parle', unEtat.fourchette.basse, { prix: 0.02, source: 'guide-de' });
    const plancher = R.repliRetourLive({ ...base, originePrix: 'plancher-toutes-langues', prixLive: 1.0, grilleLive: { NM: 3, EX: 2 } });
    v('plancher toutes langues, retenu null : repli, mais la grille (d\'une autre langue) n\'est pas lue', [plancher.cause, plancher.fourchette.basse.source], ['etat-non-retenu', 'guide-de']);
    v('offre lue, retenu null, fiche SANS guide : rien à servir (l\'offre du client reste la sienne), aucun repli', R.repliRetourLive({ ...base, prixGuide: null, originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', grilleLive: { NM: 1.4, GD: 0.9 } }), null);
    v('retenu absent (undefined) : non estimable aussi', R.repliRetourLive({ prixGuide: g, originePrix: 'tendance', prixLive: 7.67 }).fourchette !== undefined, true);
    // état retenu : TOUT est comme avant (octet pour octet)
    const avant = R.repliRetourLive({ prixGuide: g, retenu: 'EX', originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', grilleLive: { NM: 1.4, GD: 0.9 } });
    v('retenu EX, offre en GD : etat-proche comme avant, sans fourchette ni mention', [avant.repli, avant.cause, 'fourchette' in avant, avant.guide === g, avant.guide.reserves], ['etat-proche', 'offre-autre-etat', false, true, []]);
    v('retenu EX, offre en EX ou mieux : aucun repli, comme avant', [R.repliRetourLive({ prixGuide: g, retenu: 'EX', originePrix: 'grille', prixLive: 1.2, prixLiveEtat: 'EX' }), R.repliRetourLive({ prixGuide: g, retenu: 'EX', originePrix: 'grille', prixLive: 1.2, prixLiveEtat: 'NM' })], [null, null]);
    const sansFourchette = R.repliRetourLive({ prixGuide: g, retenu: 'NM', originePrix: 'tendance', prixLive: 7.67 });
    v('retenu NM, tendance seule : le repli d\'avant, clés d\'avant', [JSON.stringify(Object.keys(sansFourchette)), sansFourchette.guide === g], [JSON.stringify(['repli', 'cause', 'fiable', 'guide', 'offre']), true]);
    vrai('le quota : un repli à fourchette du retour en direct AFFICHE un prix', R.afficheUnPrix({ repli: R.repliRetourLive({ ...base, lectureRatee: { cause: 'sans-prix', definitive: true } }) }));
}

// ── 7. UNE seule définition : les deux chemins appellent la MÊME fonction (§21 bis)
{
    const src = f => fs.readFileSync(path.join(__dirname, '..', 'identifier', f), 'utf8');
    const pr = src('prix-repli.js');
    vrai('prix-repli.js importe la règle de fourchette-etat.js', /require\('\.\/fourchette-etat'\)/.test(pr));
    vrai('avecRepliAnalyse décide par FE.etatNonEstimable', /avecRepliAnalyse[\s\S]*?FE\.etatNonEstimable\(/.test(pr));
    vrai('repliRetourLive décide par FE.etatNonEstimable', /function repliRetourLive[\s\S]*?FE\.etatNonEstimable\(/.test(pr));
    v('aucun autre fichier de v2/identifier ne redéfinit « état non estimable » (la règle n\'a qu\'une définition)', fs.readdirSync(path.join(__dirname, '..', 'identifier')).filter(f => f.endsWith('.js') && !['fourchette-etat.js', 'prix-repli.js', 'fiabilite-prix.js'].includes(f) && /etatNonEstimable|etat-non-estimable/.test(src(f))), []);
    const rl = src('retour-live.js');
    vrai('retour-live.js passe la grille lue au repli (repliRetourLive), sans recopier la règle', /grilleLive: b\.grilleLive/.test(rl) && !/etatNonEstimable/.test(rl));
}

// ── 8. le schéma : la forme de la fourchette est fermée ; une clé de plus, une source hors liste, un prix nul sont refusés
{
    const S = doc.components.schemas;
    vrai('PrixGuide.reserves accepte la mention (même liste fermée que RESERVES)', S.PrixGuide.properties.reserves.items.enum.includes(MENTION));
    const nul = R.avecRepliAnalyse({ index: 0, statut: 'identifiee', carte: produit('tauros'), candidats: [], question: null, raison: null, etat: { estime: 'EX', confiance: 'basse', defauts: [], declare: null, retenu: null }, prixLive: { idProduct: 273844, langues: [1], reverseHolo: false, etatVise: null }, zone: null }).prixRepli;
    const grille = R.repliRetourLive({ prixGuide: g, retenu: null, originePrix: 'grille', prixLive: 0.9, prixLiveEtat: 'GD', grilleLive: { NM: 1.4, GD: 0.9 } });
    const sansBorne = R.repliRetourLive({ prixGuide: { ...g, de: null }, retenu: null, lectureRatee: { cause: 'defi', definitive: false } });
    v('trois fourchettes valides contre PrixRepli : « De » seul, grille deux bornes, aucune borne', [valide(nul, 'PrixRepli'), valide(grille, 'PrixRepli'), valide(sansBorne, 'PrixRepli')], [true, true, true]);
    v('  la forme sans borne dit ses deux absences', sansBorne.fourchette, { basse: null, haute: null, absentes: ['basse', 'haute'] });
    vrai('PrixRepliTendance déclare fourchette (facultative, jamais requise)', Boolean(S.PrixRepliTendance.properties.fourchette) && !S.PrixRepliTendance.required.includes('fourchette'));
    const refuse = (nom, abimer, base = nul) => { const c = JSON.parse(JSON.stringify(base)); abimer(c); v(`schéma : refusé — ${nom}`, valider(c, ref('PrixRepli'), doc).ok, false); };
    refuse('un repli fourchette qui se dit fiable', c => { c.fiable = true; });
    refuse('une clé de plus dans la fourchette (verdict)', c => { c.fourchette.verdict = 'correct'; });
    refuse('une borne avec une source hors liste', c => { c.fourchette.basse.source = 'tendance'; });
    refuse('une borne à prix nul', c => { c.fourchette.basse.prix = 0; });
    refuse('une borne à prix négatif', c => { c.fourchette.basse.prix = -1; });
    refuse('une borne avec une clé de plus', c => { c.fourchette.basse.etat = 'EX'; });
    refuse('une borne sans source', c => { delete c.fourchette.basse.source; });
    refuse('absentes hors liste', c => { c.fourchette.absentes = ['milieu']; });
    refuse('fourchette sans absentes (clé requise)', c => { delete c.fourchette.absentes; });
    refuse('fourchette sans haute (clé requise : null ou une borne)', c => { delete c.fourchette.haute; });
    refuse('fourchette nulle', c => { c.fourchette = null; });
    refuse('une réserve hors liste dans le guide du repli', c => { c.guide.reserves = ['au-pif']; });
    refuse('la forme etat-proche ne porte pas de fourchette', c => { c.repli = 'etat-proche'; c.cause = 'offre-autre-etat'; c.offre = { etat: 'GD', prix: 0.9 }; });
    // la forme sans fourchette (état estimé) reste valide : AJOUT FACULTATIF
    v('un repli sans fourchette (état estimé) reste valide', valide(R.depuisGuide(g, 'langue-non-lue'), 'PrixRepli'), true);
    // la cohérence que le schéma ne sait pas dire, le module la tient : absentes dit exactement les bornes nulles
    const incoh = [nul, grille, sansBorne].every(r => JSON.stringify(r.fourchette.absentes) === JSON.stringify(['basse', 'haute'].filter(b => r.fourchette[b] === null)));
    v('absentes dit EXACTEMENT les bornes nulles, dans l\'ordre basse puis haute', incoh, true);
    v('basse <= haute quand les deux existent', [grille, ...[{ NM: 5, EX: 5 }, { PO: 1, MT: 9 }].map(gl => R.repliRetourLive({ prixGuide: g, retenu: null, originePrix: 'grille', prixLive: 1, prixLiveEtat: 'NM', grilleLive: gl }))].every(r => r.fourchette.basse.prix <= r.fourchette.haute.prix), true);
}
bilan();

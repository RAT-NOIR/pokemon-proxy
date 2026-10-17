// node test-basse-definition.js — la marque `basseDefinition` et le remplacement automatique (décision du testeur, 2026-10-12). Pur : faux modèles en
// mémoire, aucune base, aucun réseau. Ce que le banc garde :
//   · la marque se pose sur la largeur de l'ORIGINAL, par UNE fonction (seuils-images.js) — jamais un nombre recopié ;
//   · une image NON marquée, de la MÊME langue, au même (carte, set, numéro), remplace l'entrée marquée ; jamais l'inverse ;
//   · le document `images` de l'entrée remplacée RESTE (marqué remplacé), l'entrée sort de `cartes.images` ;
//   · une langue différente, inconnue (null) ou absente, un autre set, un autre numéro : rien ne bouge (une garde s'écrit par ce qu'elle autorise).
const fs = require('fs');
const path = require('path');
const B = require('./collecte-cartes/basse-definition');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── la marque, d'après la largeur de l'original ────────────────────────────────────────────────────────────────────
verifier('marqueDe : 300 px d\'original → { basseDefinition: true }', B.marqueDe({ wOriginal: 300, w: 300 }), { basseDefinition: true });
verifier('marqueDe : 349 → marquée ; 350 → rien ; 734 → rien', [B.marqueDe({ wOriginal: 349 }), B.marqueDe({ wOriginal: 350 }), B.marqueDe({ wOriginal: 734 })], [{ basseDefinition: true }, {}, {}]);
verifier('marqueDe : c\'est l\'ORIGINAL qui compte, pas le fichier servi (original 1000, servi 700 → pas basse définition)', B.marqueDe({ wOriginal: 1000, w: 700 }), {});
verifier('marqueDe : sans wOriginal, `w` sous le plafond servi (300) est l\'original', B.marqueDe({ w: 300 }), { basseDefinition: true });
verifier('marqueDe : la marque déjà posée sur le document est reprise telle quelle (I1 : le rejeu d\'une jointure ne l\'efface pas)', [B.marqueDe({ basseDefinition: true }), B.marqueDe({ basseDefinition: true, w: 700 })], [{ basseDefinition: true }, { basseDefinition: true }]);
verifier('marqueDe : largeur inconnue → pas de marque (inconnu n\'est pas bas)', [B.marqueDe({}), B.marqueDe(null)], [{}, {}]);

// ── la règle de remplacement (pure) ────────────────────────────────────────────────────────────────────────────────
const basse = (o = {}) => ({ set: 'S', source: 'tpc-asie', numero: '001', cleR2: 'tpc-asie/S/001-1-id.webp', w: 300, langue: 'id', basseDefinition: true, ...o });
const bonne = (o = {}) => ({ set: 'S', source: 'tcgdex', numero: '001', cleR2: 'tcgdex/S/001-1.webp', w: 600, langue: 'id', ...o });
const rem = (images, cand, o) => B.entreesARemplacer(images, cand, o).map(e => e.cleR2);
verifier('une entrée marquée + une candidate non marquée, même set, même numéro, même langue → l\'entrée marquée est à remplacer', rem([basse()], bonne()), ['tpc-asie/S/001-1-id.webp']);
verifier('le numéro se compare par la clé de la jointure (« 001 » = « 1 »)', rem([basse({ numero: '001' })], bonne({ numero: '1' })), ['tpc-asie/S/001-1-id.webp']);
verifier('un autre numéro → rien', rem([basse()], bonne({ numero: '002' })), []);
verifier('un autre set → rien', rem([basse()], bonne({ set: 'Autre' })), []);
verifier('une autre langue → rien (« de la langue servie » : un visuel d\'une autre langue ne remplace pas)', rem([basse()], bonne({ langue: 'th' })), []);
verifier('langue de la candidate inconnue (null) → rien : on ne remplace pas ce qu\'on ne sait pas être de la même langue', rem([basse()], bonne({ langue: null })), []);
verifier('langue de la candidate ABSENTE → rien', rem([basse()], (({ langue, ...r }) => r)(bonne())), []);
verifier('langue de l\'entrée marquée inconnue (null) → rien', rem([basse({ langue: null })], bonne({ langue: null })), []);
verifier('JAMAIS L\'INVERSE : une candidate marquée ne remplace rien', rem([basse({ cleR2: 'autre.webp', source: 'pikaqian' })], basse({ source: 'tpc-asie' })), []);
verifier('une candidate marquée ne remplace pas non plus une entrée NON marquée', rem([bonne()], basse()), []);
verifier('une candidate dont la largeur est basse sans marque (entrée ancienne) ne remplace rien', rem([basse()], bonne({ w: 300 })), []);
verifier('une entrée NON marquée n\'est jamais remplacée', rem([bonne({ cleR2: 'x.webp' })], bonne({ source: 'artofpkm', cleR2: 'y.webp' })), []);
verifier('la candidate n\'est pas son propre remplacement (même source, même cleR2)', rem([basse({ basseDefinition: true })], { ...basse(), basseDefinition: undefined, w: 600 }), []);
verifier('plusieurs entrées marquées au même (set, numéro, langue) : toutes sortent', rem([basse(), basse({ source: 'pikaqian', cleR2: 'p.webp' })], bonne()), ['tpc-asie/S/001-1-id.webp', 'p.webp']);
verifier('images absentes / non tableau → rien, sans exception', [rem(undefined, bonne()), rem(null, bonne()), rem('x', bonne())], [[], [], []]);
verifier('candidate absente → rien, sans exception', [rem([basse()], null), rem([basse()], undefined)], [[], []]);

// ── ➕ 2026-10-17 (BASSE-DEF) : le PLAN d'un collecteur « combleur » et l'ARBITRAGE de sa jointure — la même règle (entreesARemplacer), jamais une copie ─────────────
const carteAvec = images => ({ _id: 7, nomEn: 'X', images });
const sr = (carte, o = {}) => (B.sansRemplacables(carte, { set: 'S', numero: '1', langue: 'id', source: 'tcgdex', ...o }) ?? {}).images?.map(e => e.cleR2);
// ── ➕ 2026-10-17 (doctrine de collecte, article 4) : « un remplacement est permis si l'image actuelle est fausse, en basse définition ou empruntée, ou si la nouvelle est la même impression et
// nettement plus grande. Une image correcte au-dessus du seuil n'est jamais remplacée par une image équivalente. » — par la MÊME fonction (entreesARemplacer) ──────────────────────────────
verifier('RATIO_NETTEMENT_PLUS_GRANDE = 1,5 (constante nommée, exportée)', B.RATIO_NETTEMENT_PLUS_GRANDE, 1.5);
const sain = (o = {}) => ({ set: 'S', source: 'artofpkm', numero: '001', cleR2: 'artofpkm/S/001.webp', w: 400, wOriginal: 400, langue: 'id', ...o });
const cand = (w, o = {}) => bonne({ w, wOriginal: w, ...o });
// ➕ correction 4 : une entrée EMPRUNTÉE n'est remplacée que par le VRAI scan tamponné — la candidate doit porter un marqueur POSITIF de tampon égal au `tamponNonRepresente` de l'entrée. AUCUN collecteur n'écrit
// aujourd'hui un tel champ sur ses entrées (le tampon d'un scan Pokumon vit sur le DOCUMENT, `marque`, en texte libre ; `tamponNonRepresente` dit ce que l'image NE montre PAS) : CHAMPS_TAMPON_POSITIFS est
// donc VIDE, et AUCUN remplacement d'une entrée empruntée ne sort tant qu'un collecteur n'écrit pas ce champ (et ne l'ajoute pas à la liste).
const EMPR = (o = {}) => sain({ w: 600, wOriginal: 600, imageEmprunteeTirage: true, tamponNonRepresente: 'Staff', ...o });
verifier('CHAMPS_TAMPON_POSITIFS : liste fermée et VIDE (aucun champ positif de tampon n\'existe sur les candidates)', [Array.isArray(B.CHAMPS_TAMPON_POSITIFS), (B.CHAMPS_TAMPON_POSITIFS || ['x']).length, Object.isFrozen(B.CHAMPS_TAMPON_POSITIFS)], [true, 0, true]);
verifier('EMPRUNTÉE : une image SIMPLE non tamponnée ne remplace JAMAIS une empruntée (elle serait aussi fausse, et effacerait le marquage)', [rem([EMPR()], cand(600)), rem([EMPR()], cand(900))], [[], []]);
verifier('EMPRUNTÉE : même une candidate qui porte une `noteVariante` ou un `tamponNonRepresente` ne prouve pas le tampon (rien de positif) → rien', [rem([EMPR()], cand(600, { noteVariante: 'Staff' })), rem([EMPR()], cand(600, { tamponNonRepresente: 'Staff' }))], [[], []]);
verifier('EMPRUNTÉE : avec un champ POSITIF déclaré (injecté au banc) égal au tampon de l\'entrée → remplacée ; tampon différent, absent, ou entrée sans tampon connu → rien', [
    rem([EMPR()], cand(600, { tamponRepresente: 'Staff' }), { champsTampon: ['tamponRepresente'] }),
    rem([EMPR()], cand(600, { tamponRepresente: 'Play! Pokémon' }), { champsTampon: ['tamponRepresente'] }),
    rem([EMPR()], cand(600), { champsTampon: ['tamponRepresente'] }),
    rem([EMPR({ tamponNonRepresente: undefined })], cand(600, { tamponRepresente: 'Staff' }), { champsTampon: ['tamponRepresente'] })], [['artofpkm/S/001.webp'], [], [], []]);
verifier('EMPRUNTÉE : les AUTRES marqueurs de variante doivent être identiques des deux côtés (hors imageEmprunteeTirage et tamponNonRepresente)', [
    rem([EMPR({ noteVariante: 'a' })], cand(600, { tamponRepresente: 'Staff' }), { champsTampon: ['tamponRepresente'] }),
    rem([EMPR({ noteVariante: 'a' })], cand(600, { tamponRepresente: 'Staff', noteVariante: 'a' }), { champsTampon: ['tamponRepresente'] })], [[], ['artofpkm/S/001.webp']]);
verifier('EMPRUNTÉE : sans tampon connu sur l\'entrée ET sans champ positif sur la candidate (undefined === undefined) → rien', rem([EMPR({ tamponNonRepresente: undefined })], cand(600), { champsTampon: ['tamponRepresente'] }), []);
// ➕ correction 4 : les branches « basse définition » et « fausse » exigent aussi les mêmes marqueurs de variante (une variante tamponnée de basse définition n'est pas évincée par l'image d'une autre impression)
verifier('BASSE DÉFINITION : une entrée marquée porteuse d\'une variante (noteVariante / partageeHoloNonHolo) n\'est PAS remplacée par une candidate qui n\'en porte pas', [rem([basse({ noteVariante: 'Staff' })], bonne()), rem([basse({ partageeHoloNonHolo: true })], bonne())], [[], []]);
verifier('   ... mais l\'est par une candidate qui porte les MÊMES marqueurs ; et l\'inverse (candidate tamponnée, entrée simple) → rien', [rem([basse({ noteVariante: 'Staff' })], bonne({ noteVariante: 'Staff' })), rem([basse()], bonne({ noteVariante: 'Staff' }))], [['tpc-asie/S/001-1-id.webp'], []]);
verifier('FAUSSE : même exigence — une entrée fausse porteuse d\'une variante n\'est pas remplacée par une candidate sans elle', [rem([sain({ w: 600, noteVariante: 'x' })], cand(600), { fausses: new Set(['artofpkm|artofpkm/S/001.webp']) }), rem([sain({ w: 600, noteVariante: 'x' })], cand(600, { noteVariante: 'x' }), { fausses: new Set(['artofpkm|artofpkm/S/001.webp']) })], [[], ['artofpkm/S/001.webp']]);
verifier('   une entrée empruntée d\'une AUTRE langue / d\'un autre numéro ne l\'est pas', [rem([sain({ w: 600, imageEmprunteeTirage: true, langue: 'th' })], cand(600)), rem([sain({ w: 600, imageEmprunteeTirage: true, numero: '002' })], cand(600))], [[], []]);
verifier('   et une candidate MARQUÉE ne remplace jamais une empruntée', rem([sain({ w: 600, imageEmprunteeTirage: true })], cand(300, { basseDefinition: true })), []);
verifier('FAUSSE : une entrée listée dans la table fermée (source|cleR2) est remplacée, même au-dessus du seuil et sans être plus grande', rem([sain({ w: 600, wOriginal: 600 })], cand(600), { fausses: new Set(['artofpkm|artofpkm/S/001.webp']) }), ['artofpkm/S/001.webp']);
verifier('   la table livrée est FERMÉE et vide (rien n\'est inventé : une entrée n\'est « fausse » que sur décision écrite)', [Array.isArray(require('./collecte-cartes/corrections-images').IMAGES_DECLAREES_FAUSSES), require('./collecte-cartes/corrections-images').IMAGES_DECLAREES_FAUSSES.length, Object.isFrozen(require('./collecte-cartes/corrections-images').IMAGES_DECLAREES_FAUSSES)], [true, 0, true]);
verifier('NETTEMENT PLUS GRANDE : 1,49 × refusé (400 → 596), 1,5 × admis (400 → 600), au-delà admis (400 → 700)', [rem([sain()], cand(596)), rem([sain()], cand(599)), rem([sain()], cand(600)), rem([sain()], cand(700))], [[], [], ['artofpkm/S/001.webp'], ['artofpkm/S/001.webp']]);
verifier('   à la limite basse : 1,49 × (240 → 358) refusé, 1,5 × (240 → 360) admis', [rem([sain({ w: 240, wOriginal: 240 })], cand(358)), rem([sain({ w: 240, wOriginal: 240 })], cand(360))], [[], ['artofpkm/S/001.webp']]);
verifier('JAMAIS une image correcte au-dessus du seuil par une équivalente : 600 → 600, 500 → 700 (1,4 ×), 400 → 450', [rem([sain({ w: 600, wOriginal: 600 })], cand(600)), rem([sain({ w: 500, wOriginal: 500 })], cand(700)), rem([sain()], cand(450))], [[], [], []]);
verifier('   largeur de l\'entrée INCONNUE ou plafonnée au servi (700) : on ne sait pas qu\'elle est plus petite → rien', [rem([sain({ w: undefined, wOriginal: undefined })], cand(700)), rem([sain({ w: 700, wOriginal: undefined })], cand(700))], [[], []]);
verifier('   la largeur de la candidate est celle de l\'ORIGINAL (`wOriginal`), pas du fichier servi (700 plafonné)', [rem([sain()], bonne({ w: 700, wOriginal: 1000 })), rem([sain()], bonne({ w: 700, wOriginal: 500 }))], [['artofpkm/S/001.webp'], []]);
verifier('   « plus grande » exige AUSSI la même impression : autre langue, autre numéro, autre set → rien', [rem([sain({ langue: 'th' })], cand(700)), rem([sain({ numero: '002' })], cand(700)), rem([sain({ set: 'A' })], cand(700))], [[], [], []]);
verifier('   une candidate de langue inconnue ne remplace rien, même 3 × plus grande', rem([sain({ w: 200, wOriginal: 200 })], cand(700, { langue: null })), []);
verifier('   sansRemplacables : une entrée nettement plus petite que l\'image annoncée (largeur connue du plan) n\'est pas « servie »', [sr(carteAvec([sain()]), { langue: 'id', wOriginal: 700 }), sr(carteAvec([sain()]), { langue: 'id', wOriginal: 500 })], [[], ['artofpkm/S/001.webp']]);

// ➕ correction 3 : « même impression » = set + numéro + langue ET les mêmes marqueurs de variante / de tampon des deux côtés (absents des deux côtés compris). Une réimpression tamponnée ne reçoit
// jamais l'image d'une autre impression ; dans le doute, pas de remplacement (écrit par ce qu'il autorise).
verifier('MARQUEURS_DE_VARIANTE : la liste fermée des marqueurs connus des entrées', [...(B.MARQUEURS_DE_VARIANTE || [])].sort(), ['imageEmprunteeTirage', 'noteVariante', 'partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages', 'tamponNonRepresente']);
for (const k of ['noteVariante', 'tamponNonRepresente', 'partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages']) {
    const v = k === 'noteVariante' ? 'V1/V2 non séparables' : k === 'produitsPartages' ? [1, 2] : true;
    verifier(`${k} : la candidate le porte, l'entrée saine (1,5 ×) non → RIEN (une variante n'évince pas l'impression simple)`, rem([sain()], cand(600, { [k]: v })), []);
    verifier(`${k} : l'entrée le porte, la candidate non → RIEN (l'impression simple n'évince pas la variante)`, rem([sain({ [k]: v })], cand(600)), []);
    verifier(`${k} : les DEUX côtés le portent à l'identique → remplacée (même impression)`, rem([sain({ [k]: v })], cand(600, { [k]: v })), ['artofpkm/S/001.webp']);
}
verifier('noteVariante : deux valeurs DIFFÉRENTES → rien ; marqueurs absents des deux côtés → remplacée', [rem([sain({ noteVariante: 'a' })], cand(600, { noteVariante: 'b' })), rem([sain()], cand(600))], [[], ['artofpkm/S/001.webp']]);
verifier('un marqueur de FAUX type (null / false / chaîne vide) vaut absent : même identité qu\'un côté sans marqueur', rem([sain({ noteVariante: null, partageeHoloNonHolo: false, tamponNonRepresente: '' })], cand(600)), ['artofpkm/S/001.webp']);
verifier('(supprimé en correction 4) : les branches basse définition et fausse exigent désormais les mêmes marqueurs — cf. plus haut', true, true);
verifier('candidate sans `wOriginal` : repli PRUDENT sur `w` servi (≤ 700), qui sous-estime — jamais un remplacement de trop', rem([sain()], bonne({ w: 599, wOriginal: undefined })), []);

verifier('sansRemplacables : une entrée marquée d\'une AUTRE source, même set/numéro/langue, ne compte pas comme « servie »', sr(carteAvec([basse()])), []);
verifier('   les autres entrées restent (non marquée, autre numéro, autre set, autre langue)', sr(carteAvec([basse(), bonne({ cleR2: 'n.webp', source: 'artofpkm' }), basse({ numero: '2', cleR2: 'b2' }), basse({ set: 'A', cleR2: 'b3' }), basse({ langue: 'th', cleR2: 'b4' })])), ['n.webp', 'b2', 'b3', 'b4']);
verifier('   sa PROPRE entrée marquée reste : la même source redonnerait le même fichier (aucun téléchargement pour rien)', sr(carteAvec([basse({ source: 'tcgdex', cleR2: 'mienne' })])), ['mienne']);
verifier('   langue du candidat inconnue (null / absente) : rien n\'est remplaçable, la carte est inchangée', [sr(carteAvec([basse()]), { langue: null }), sr(carteAvec([basse()]), { langue: undefined })], [['tpc-asie/S/001-1-id.webp'], ['tpc-asie/S/001-1-id.webp']]);
verifier('   la carte d\'origine n\'est pas modifiée (copie)', (() => { const c = carteAvec([basse()]); B.sansRemplacables(c, { set: 'S', numero: '1', langue: 'id', source: 'tcgdex' }); return c.images.length; })(), 1);
verifier('   carte absente / sans images → rendue sans exception', [B.sansRemplacables(null, { set: 'S', numero: '1', langue: 'id', source: 'x' }), B.sansRemplacables({ _id: 1 }, { set: 'S', numero: '1', langue: 'id', source: 'x' })], [{ images: [] }, { _id: 1, images: [] }]);
const arb = (autres, cand, servi = r => r.length > 0) => { const r = B.arbitrer(autres, cand, servi); return { sortantes: r.sortantes.map(e => e.cleR2), servie: r.servie }; };
verifier('arbitrer : candidate non marquée + une entrée marquée → elle sort, la fiche n\'est plus servie : la candidate prend la place', arb([basse()], bonne()), { sortantes: ['tpc-asie/S/001-1-id.webp'], servie: false });
verifier('arbitrer : candidate MARQUÉE → rien ne sort, la fiche reste servie (elle cède) — jamais l\'inverse', arb([basse()], basse({ source: 'pikaqian', cleR2: 'p.webp' })), { sortantes: [], servie: true });
verifier('arbitrer : une AUTRE entrée non marquée sert déjà → la marquée sort quand même de la liste, mais la fiche reste servie : la candidate cède', arb([basse(), bonne({ source: 'artofpkm', cleR2: 'a.webp' })], bonne()), { sortantes: ['tpc-asie/S/001-1-id.webp'], servie: true });
verifier('arbitrer : langue inconnue de la candidate → aucune sortie, servie', arb([basse()], bonne({ langue: null })), { sortantes: [], servie: true });
verifier('arbitrer : aucune entrée → rien à sortir, non servie', arb([], bonne()), { sortantes: [], servie: false });
verifier('empreinteEntree : la clé de compterEntrees des collecteurs (carte|source|set|numéro|cleR2)', [B.empreinteEntree(7, basse()), B.empreinteEntree(7, { source: 's', set: 'x' })], ['7|tpc-asie|S|001|tpc-asie/S/001-1-id.webp', '7|s|x||']);

// ── ce que la GARDE DE LOT voit d'un remplacement (les fonctions de la garde, garde-lot.js) ───────────────────────────────────────────
{ const G = require('./collecte-cartes/garde-lot');
  const entreeV = (o, v = true) => ({ ...o, ...(v ? { vignette: { cleR2: `vignettes/${o.cleR2}`, w: 200, h: 279 } } : {}) });
  const avant = { cartes: [{ _id: 7, images: [entreeV(basse())] }] };
  const apresOk = { cartes: [{ _id: 7, images: [entreeV(bonne())] }] };
  const apresSansVignette = { cartes: [{ _id: 7, images: [entreeV(bonne(), false)] }] };
  const cmp = (a, b) => G.comparer(G.compterEtat(a), G.compterEtat(b));
  verifier('garde de lot : un remplacement À NOMBRE CONSTANT (vignette refaite) n\'est PAS une baisse — aucune annonce nécessaire', cmp(avant, apresOk).nonAutorisees.length, 0);
  verifier('   le compteur « images » du set ne baisse pas (1 → 1)', cmp(avant, apresOk).baisses.filter(b => b.compteur === 'images').length, 0);
  verifier('   si la vignette de la remplaçante manque encore, la garde CRIE (vignettes-set) : le collecteur vignette AVANT de rendre la main', cmp(avant, apresSansVignette).nonAutorisees.map(b => b.compteur), ['vignettes-set']); }

// ── l'effet sur les modèles : l'entrée sort de `cartes.images`, le document `images` reste, marqué remplacé ──────────
function fauxModeles(carte, docs) {
    const journal = [];
    const accepte = (d, f) => Object.entries(f).every(([k, v]) => d[k] === v);
    const M = {
        Carte: {
            findById: id => ({ select: () => ({ lean: async () => structuredClone(id === carte._id ? carte : null) }) }),
            updateOne: async (f, u) => { journal.push(['carte', f, u]); for (const [k, v] of Object.entries(u.$pull || {})) carte[k] = carte[k].filter(e => !accepte(e, v)); return { modifiedCount: 1 }; }
        },
        Image: {
            updateOne: async (f, u) => { journal.push(['image', f, u]); const d = docs.find(x => accepte(x, f)); if (d) Object.assign(d, u.$set || {}); return { modifiedCount: d ? 1 : 0 }; }
        }
    };
    return { M, journal };
}
(async () => {
    const carte = { _id: 1, images: [basse(), { set: 'S', source: 'tcgdex', numero: '002', cleR2: 'z.webp', w: 600, langue: 'id' }, { set: 'Autre', source: 'tpc-asie', numero: '001', cleR2: 'a.webp', w: 300, langue: 'id', basseDefinition: true }] };
    const docs = [{ _id: 'tpc-asie/S/1/001/id', source: 'tpc-asie', set: 'S', cleR2: 'tpc-asie/S/001-1-id.webp', etat: 'ok', wOriginal: 300 }, { _id: 'autre', source: 'tpc-asie', set: 'Autre', cleR2: 'a.webp', etat: 'ok' }];
    const { M, journal } = fauxModeles(carte, docs);
    const maintenant = new Date('2026-10-12T10:00:00Z');
    const n = await B.remplacerBasseDefinition(M, 1, bonne(), { maintenant });
    verifier('remplacerBasseDefinition rend le nombre d\'entrées remplacées', n, 1);
    verifier('l\'entrée marquée sort de cartes.images ; les autres (autre numéro, autre set) restent', carte.images.map(e => `${e.set}:${e.source}:${e.numero}`), ['S:tcgdex:002', 'Autre:tpc-asie:001']);
    verifier('le document `images` RESTE, marqué remplacé, avec par quoi', [docs[0].etat, docs[0].remplacePar, docs[0].remplaceLe?.toISOString?.()], ['remplace', { source: 'tcgdex', cleR2: 'tcgdex/S/001-1.webp' }, '2026-10-12T10:00:00.000Z']);
    verifier('le document d\'un autre set n\'est pas touché', docs[1].etat, 'ok');
    verifier('le $pull est précis : il porte set, source, cleR2 ET la marque (jamais une entrée non marquée)', journal.find(j => j[0] === 'carte')[2].$pull.images, { set: 'S', source: 'tpc-asie', cleR2: 'tpc-asie/S/001-1-id.webp' });
    const n2 = await B.remplacerBasseDefinition(M, 1, bonne(), { maintenant });
    verifier('rejouée : rien à remplacer, aucune écriture de plus', [n2, journal.length], [0, 2]);
    const avant = JSON.stringify(carte);
    const n3 = await B.remplacerBasseDefinition(M, 1, basse({ source: 'pikaqian', cleR2: 'pk.webp', numero: '002' }), { maintenant });
    verifier('une candidate marquée n\'écrit rien', [n3, JSON.stringify(carte) === avant], [0, true]);
    verifier('une carte inconnue → 0, sans exception', await B.remplacerBasseDefinition(M, 999, bonne(), { maintenant }), 0);

    // ── les appelants : chaque collecteur qui joint une image NON marquée appelle LE module (une règle, pas une copie par collecteur) ───────────────
    const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
    const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['collecteur-images.js', 'collecteur-images-bulba.js', 'collecteur-images-tcgdex.js']) {
        verifier(`${f} appelle remplacerBasseDefinition (le module)`, /remplacerBasseDefinition\(/.test(sansCommentaires(lire(f))), true);
    }
    for (const f of ['collecteur-images-tpc.js', 'collecteur-images-pikaqian.js']) {
        verifier(`${f} pose la marque par marqueDe (jamais un nombre recopié)`, /marqueDe\(/.test(sansCommentaires(lire(f))), true);
    }
    // ➕ 2026-10-17 (BASSE-DEF) : TOUS les collecteurs traitent une entrée marquée comme remplaçable — la décision par `arbitrer`, le geste par `remplacerBasseDefinition` (la même fonction, §21 bis)
    for (const f of ['collecteur-images-ptcgio.js', 'collecteur-images-tpc.js', 'collecteur-images-pikaqian.js', 'collecteur-images-pokumon.js', 'collecteur-images-pokemoncom.js']) {
        const t = sansCommentaires(lire(f));
        verifier(`${f} arbitre par le module (arbitrer) ET remplace par remplacerBasseDefinition`, [/\barbitrer\(/.test(t), /remplacerBasseDefinition\(/.test(t)], [true, true]);
    }
    for (const f of ['collecteur-images-pokumon.js', 'collecteur-images-pokemoncom.js']) verifier(`${f} pose la marque par marqueDe (document ET entrée)`, (sansCommentaires(lire(f)).match(/marqueDe\(/g) || []).length >= 2, true);
    for (const f of ['collecteur-images-ptcgio.js', 'collecteur-images-tpc.js']) verifier(`${f} ne planifie pas comme « servi » une carte dont l'entrée marquée est remplaçable : sansRemplacables`, /sansRemplacables\(/.test(sansCommentaires(lire(f))), true);
    verifier('collecte-cartes/pokumon.js (le plan) : sansRemplacables, la largeur de l\'index étant connue', /sansRemplacables\(/.test(sansCommentaires(lire('collecte-cartes/pokumon.js'))), true);
    const regles = lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '';
    verifier('REGLES surveille collecte-cartes/basse-definition.js (les collecteurs l\'appellent : la remise en file en dépend)', regles.includes("'collecte-cartes/basse-definition.js'"), true);

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();

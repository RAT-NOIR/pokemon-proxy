'use strict';
// PARTAGES-VARIANTE (2026-10-18) — l'API lit la paire Staff/Jumbo « séparée par la variante, sans liste » (61 paires du catalogue : produitsPartages retiré, variante staff|jumbo/normale avec preuve).
// Ce que le banc tient, par ce que la forme AUTORISE : false + aucune liste + variante prouvée (staff|jumbo|normale) est servi ; tout le reste garde la règle fermée d'avant (true sans liste, holo sans liste,
// liste sans le produit, false sans liste sur un produit SANS variante prouvée : écarté). Une seule définition (identifier/partage-variante.js) pour la décision, la validation d'entrée, la structure de
// l'archive, la colonne des partages (jumeaux), et F1 (lecture du tampon). Pas de base, pas de réseau, aucun appel payant : données fabriquées.
const H = require('./_harnais');
const sharp = require('sharp');
const { decider, partageIncoherent } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');
const { calculer } = require('../chargeur/calcul');
const { creerConstructeur, depuisPaquet, rejugerEntrees } = require('../chargeur/version');
const F = require('../chargeur/format');
const { lireEntree } = require('../identifier/visuels');
const PV = require('../identifier/partage-variante');
const LT = require('../identifier/lecture-tampon');
const { consulterLectureTampon } = require('../identifier/lecture-tampon-route');
const { adapter } = require('../identifier/adaptateur');
const { fournisseurDe } = require('../identifier/jumeaux');
const { lireConfig } = require('../config');

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const motif = o => { const r = lireEntree(brut(11, o)); return r.ok ? 'ADMIS' : r.motif; };
const FORME = { partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };

(async () => {
    // ── 1. LA VALIDATION D'ENTRÉE : la forme admise, et pas plus
    for (const v of ['staff', 'jumbo', 'normale']) {
        const r = lireEntree(brut(11, { ...FORME, variante: v }));
        H.v(`1a. ${v} : false, aucune liste, variante prouvée → admis, false gardé, aucune liste`, [r.ok, r.ok && r.doc.partageeTamponNonSepare, r.ok && r.doc.produitsPartages, r.ok && r.doc.variante, r.ok && r.doc.tamponNonRepresente], [true, false, null, v, 'Staff']);
    }
    H.v('1b. false sans liste sur un produit SANS variante : refusé (les produits thaïs, indonésiens, Transfiguration Mask)', motif({ ...FORME, variante: null }), 'marquage de partage sans "produitsPartages"');
    H.v('1c. false sans liste, variante inconnue ("zzz", "V2") : refusé', [motif({ ...FORME, variante: 'zzz' }), motif({ ...FORME, variante: 'V2' })], ['marquage de partage sans "produitsPartages"', 'marquage de partage sans "produitsPartages"']);
    H.v('1d. true sans liste (même avec une variante) : refusé', [motif({ partageeTamponNonSepare: true, variante: 'staff' }), motif({ partageeTamponNonSepare: true, variante: 'normale' })], ['marquage de partage sans "produitsPartages"', 'marquage de partage sans "produitsPartages"']);
    H.v('1e. holo/non-holo true sans liste (même avec false + variante) : refusé', [motif({ partageeHoloNonHolo: true, variante: 'staff' }), motif({ partageeHoloNonHolo: true, partageeTamponNonSepare: false, variante: 'staff' })], ['marquage de partage sans "produitsPartages"', 'marquage de partage sans "produitsPartages"']);
    H.v('1f. false + liste VIDE ou d\'un produit : refusé (une liste est une liste, la règle d\'avant s\'applique)', [motif({ ...FORME, variante: 'staff', produitsPartages: [] }), motif({ ...FORME, variante: 'staff', produitsPartages: [11] })], [
        'champ "produitsPartages" : entre 2 et 6 idProduct entiers distincts attendus', 'champ "produitsPartages" : entre 2 et 6 idProduct entiers distincts attendus']);
    H.v('1g. la forme d\'AVANT reste admise : false + liste [11, 12] + variante ; et la liste sans le produit reste refusée', [motif({ ...FORME, variante: 'staff', produitsPartages: [11, 12] }), motif({ ...FORME, variante: 'staff', produitsPartages: [12, 13] })], ['ADMIS', 'champ "produitsPartages" ne contient pas le produit de l\'entrée']);
    H.v('1h. une variante sans aucun marquage de partage : admise (rien à vérifier)', motif({ variante: 'staff' }), 'ADMIS');
    H.v('1i. la liste sans marquage de partage reste refusée', /sans marquage de partage/.test(motif({ produitsPartages: [11, 12] })), true);

    // ── 2. LA DÉCISION (le producteur de l'archive)
    H.v('2a. partageIncoherent : la forme admise (false, pas de liste, variante prouvée) est cohérente', [partageIncoherent({ partageeTamponNonSepare: false }, 1, 'staff'), partageIncoherent({ partageeTamponNonSepare: false }, 1, 'jumbo'), partageIncoherent({ partageeTamponNonSepare: false }, 1, 'normale')], [false, false, false]);
    H.v('2b. partageIncoherent : sans variante prouvée, true sans liste, holo sans liste, liste sans le produit, liste vide → incohérent',
        [partageIncoherent({ partageeTamponNonSepare: false }, 1), partageIncoherent({ partageeTamponNonSepare: false }, 1, null), partageIncoherent({ partageeTamponNonSepare: false }, 1, 'zzz'), partageIncoherent({ partageeTamponNonSepare: true }, 1, 'staff'),
            partageIncoherent({ partageeHoloNonHolo: true }, 1, 'staff'), partageIncoherent({ partageeHoloNonHolo: true, partageeTamponNonSepare: false }, 1, 'staff'), partageIncoherent({ partageeTamponNonSepare: false, produitsPartages: [2, 3] }, 1, 'staff'),
            partageIncoherent({ partageeTamponNonSepare: false, produitsPartages: [] }, 1, 'staff')], [true, true, true, true, true, true, true, true]);
    H.v('2c. partageIncoherent : la forme d\'avant (liste qui contient le produit) reste cohérente, avec ou sans variante', [partageIncoherent({ partageeTamponNonSepare: false, produitsPartages: [1, 2] }, 1), partageIncoherent({ partageeTamponNonSepare: false, produitsPartages: [1, 2] }, 1, 'staff')], [false, false]);

    const regle = await regleEmbarquee();
    const set = (id, exp) => ({ _id: id, idExpansion: exp, code: id.slice(0, 4), nomAffichage: id.replace(/-/g, ' '), tirage: 'intl', region: 'intl', bulba: { expansion: id.replace(/-/g, ' ') } });
    const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
    const im = (numero, n, o = {}) => ({ set: 'Set-A', numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
    const carte = (id, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images });
    const ligne = (id, carteId, numero, o = {}) => ({ idProduct: id, carteId, idExpansion: 100, numeroFiche: numero, slug: `P${id}-X${numero}`, slugSet: 'Set-A', ...o });
    const P = 'étiquette Cardmarket';
    const sets = [set('Set-A', 100)];
    const docs = [
        carte(40, '020', [im('020', 'c40', { partageeTamponNonSepare: false, tamponNonRepresente: 'Staff' })]),                      // paire Staff séparée par la variante : AUCUNE liste
        carte(41, '021', [im('021', 'c41', { partageeTamponNonSepare: true, tamponNonRepresente: 'Staff' })]),                       // true sans liste : écarté
        carte(42, '022', [im('022', 'c42', { partageeHoloNonHolo: true })]),                                                          // holo sans liste : écarté
        carte(43, '023', [im('023', 'c43', { partageeTamponNonSepare: false, produitsPartages: [4301, 4302], tamponNonRepresente: 'Staff' })]),   // forme d'avant (liste) : le troisième produit (4303) n'y est pas
        carte(44, '024', [im('024', 'c44', { partageeTamponNonSepare: false, tamponNonRepresente: 'Jumbo' })]),                      // paire Jumbo séparée par la variante
        carte(45, '025', [im('025', 'c45', { partageeTamponNonSepare: false, partageeHoloNonHolo: true, tamponNonRepresente: 'Staff' })])  // holo true + false, aucune liste : écarté
    ];
    const lignes = [
        ligne(4001, 40, '020', { variante: 'normale', variantePreuve: P }), ligne(4002, 40, '020', { variante: 'staff', variantePreuve: P }),
        ligne(4003, 40, '020'),                                                                                                       // pas de variante (thaï, indonésien, Transfiguration Mask) : écarté
        ligne(4004, 40, '020', { variante: 'staff' }),                                                                                // variante SANS preuve : écarté, et NON compté en varianteSansPreuve
        ligne(4101, 41, '021', { variante: 'normale', variantePreuve: P }), ligne(4102, 41, '021', { variante: 'staff', variantePreuve: P }),
        ligne(4201, 42, '022', { variante: 'staff', variantePreuve: P }),
        ligne(4301, 43, '023', { variante: 'normale', variantePreuve: P }), ligne(4302, 43, '023', { variante: 'staff', variantePreuve: P }), ligne(4303, 43, '023', { variante: 'staff', variantePreuve: P }),
        ligne(4401, 44, '024', { variante: 'normale', variantePreuve: P }), ligne(4402, 44, '024', { variante: 'jumbo', variantePreuve: P }),
        ligne(4501, 45, '025', { variante: 'staff', variantePreuve: P })
    ];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets, docs, lignes, metacarte, regle });
    const e = id => r.entrees.find(x => x.idProduct === id), d = r.denominateurs;
    H.v('2d. servis : la paire Staff (4001, 4002), la paire Jumbo (4401, 4402), la forme d\'avant (4301, 4302)', r.entrees.map(x => x.idProduct), [4001, 4002, 4301, 4302, 4401, 4402]);
    H.v('2e. écartés (partageIncoherent 7) : sans variante, variante sans preuve, true sans liste, holo sans liste, hors liste, holo + false', [d.partageIncoherent, [4003, 4004, 4101, 4102, 4201, 4303, 4501].every(id => e(id) === undefined)], [7, true]);
    H.v('2f. la variante sans preuve n\'est pas comptée deux fois (elle est écartée avant l\'étape qui la compte)', d.varianteSansPreuve, 0);
    H.v('2g. 4002 (staff) : les marquages servis à la paire séparée — false, tamponNonRepresente, aucune liste, variante prouvée', [e(4002).partageeTamponNonSepare, e(4002).tamponNonRepresente, e(4002).produitsPartages, e(4002).partageeHoloNonHolo, e(4002).variante], [false, 'Staff', null, null, 'staff']);
    H.v('2h. 4001 (normale) : les mêmes marquages — false et « Staff » sont servis aussi au produit normal de la paire', [e(4001).partageeTamponNonSepare, e(4001).tamponNonRepresente, e(4001).produitsPartages, e(4001).variante], [false, 'Staff', null, 'normale']);
    H.v('2i. la paire Jumbo : « Jumbo » servi aux deux', [e(4401).tamponNonRepresente, e(4402).tamponNonRepresente, e(4402).variante], ['Jumbo', 'Jumbo', 'jumbo']);
    H.v('2j. la forme d\'avant est INCHANGÉE : liste + false + « Staff » servis aux produits de la liste', [e(4301).produitsPartages, e(4302).produitsPartages, e(4301).partageeTamponNonSepare], [[4301, 4302], [4301, 4302], false]);
    const lues = r.entrees.map(x => lireEntree(JSON.parse(JSON.stringify(x)))), refus = lues.filter(x => !x.ok).map(x => x.motif);
    H.v('2k. toutes les entrées émises passent la validation d\'entrée (une seule règle : la décision ne produit rien que la validation refuse)', refus, []);
    const cal = await calculer({ sets, docs, lignes, metacarte, regle });
    H.v('2l. calculer : la version porte la colonne des marquages, ses 6 entrées passent le rejugement, et les paires sans liste se connaissent', [cal.version.colonneMarquages, rejugerEntrees(cal.version).ok, cal.version.partagesDe(4001), cal.version.partagesDe(4002), cal.version.partagesDe(4401), cal.version.partagesDe(4301)], [true, true, [4002], [4001], [4402], [4302]]);

    // ── 3. LA VERSION : structure, fichier, colonne des partages
    const SAME = id => ({ vignette: { cle: 'vignettes/staff-5001.webp', w: 200, h: 279 }, grande: { cle: 'cartes/staff-5001.webp', w: 600, h: 838 } });
    const separee = (id, variante, o = {}) => brut(id, { ...SAME(id), partageeTamponNonSepare: false, tamponNonRepresente: variante === 'jumbo' ? 'Jumbo' : 'Staff', variante, idMetacard: 700 + Math.floor(id / 10), ...o });
    const b = creerConstructeur({ marquages: true });
    b.entree(separee(5001, 'normale')); b.entree(separee(5002, 'staff'));                                   // la paire Staff : même visuel, même fiche
    b.entree(separee(5011, 'normale', { vignette: { cle: 'vignettes/jumbo-5011.webp', w: 200, h: 279 }, grande: { cle: 'cartes/jumbo-5011.webp', w: 600, h: 838 } }));
    b.entree(separee(5012, 'jumbo', { vignette: { cle: 'vignettes/jumbo-5011.webp', w: 200, h: 279 }, grande: { cle: 'cartes/jumbo-5011.webp', w: 600, h: 838 } }));      // la paire Jumbo
    b.entree(separee(5021, 'normale', { vignette: { cle: 'vignettes/autre-5021.webp', w: 200, h: 279 }, grande: null })); b.entree(separee(5022, 'staff', { vignette: { cle: 'vignettes/autre-5021.webp', w: 200, h: 279 }, grande: null }));   // même visuel, FICHES différentes
    b.entree(separee(5031, 'normale')); b.entree(separee(5032, 'staff', { vignette: { cle: 'vignettes/diff-5032.webp', w: 200, h: 279 }, grande: { cle: 'cartes/diff-5032.webp', w: 600, h: 838 } }));   // même fiche, VISUELS différents
    b.entree(separee(5041, 'staff')); b.entree(separee(5042, 'staff'));                                      // deux staff, même visuel, même fiche
    b.entree(brut(5100));                                                                                    // ordinaire, variante null
    b.lien('Set-A', '1|001', [5001, 5002]); b.lien('Set-A', '1|002', [5011, 5012]); b.lien('Set-A', '1|003', [5021]); b.lien('Set-A', '1|004', [5022]); b.lien('Set-A', '1|005', [5031, 5032]); b.lien('Set-A', '1|006', [5041, 5042]);
    for (const [id, mc, exp, num] of [[5001, 700, 1, '1'], [5002, 700, 1, '1'], [5011, 701, 2, '1'], [5012, 701, 2, '1'], [5021, 702, 3, '1'], [5022, 702, 3, '1'], [5031, 703, 4, '1'], [5032, 703, 4, '1'], [5041, 704, 5, '1'], [5042, 704, 5, '1']]) b.jumeau({ idProduct: id, idMetacard: mc, idExpansion: exp, numero: num, tirage: 'intl' });
    const v = b.finir(new Date('2026-10-18T10:00:00.000Z'));
    H.v('3a. le constructeur accepte la forme (aucune entrée refusée), la version porte la colonne des marquages', [v.comptes.refusees, v.colonneMarquages, rejugerEntrees(v).ok], [0, true, true]);
    H.v('3b. partagesDe : la paire Staff et la paire Jumbo (même visuel ET même fiche) se connaissent, dans les deux sens', [v.partagesDe(5001), v.partagesDe(5002), v.partagesDe(5011), v.partagesDe(5012)], [[5002], [5001], [5012], [5011]]);
    H.v('3c. … mais ni deux produits de fiches différentes, ni de visuels différents, ni deux staff, ni un produit ordinaire', [v.partagesDe(5021), v.partagesDe(5022), v.partagesDe(5031), v.partagesDe(5032), v.partagesDe(5041), v.partagesDe(5100)], [[], [], [], [], [], []]);
    H.v('3d. memeFiche : vrai pour 5001/5002, faux pour 5021/5022 (fiches séparées), faux pour un produit inconnu ou ordinaire', [v.memeFiche(5001, 5002), v.memeFiche(5021, 5022), v.memeFiche(5001, 5021), v.memeFiche(5100, 5001), v.memeFiche(1, 2)], [true, false, false, false, false]);
    const brutF = F.serialiser(v), w = F.deserialiser(brutF);
    H.v('3e. aller-retour du fichier : entrées, partagesDe et memeFiche identiques', [[5001, 5002, 5011, 5012, 5100].every(id => JSON.stringify(w.entree(id)) === JSON.stringify(v.entree(id))), w.partagesDe(5002), w.partagesDe(5012), w.memeFiche(5001, 5002), w.memeFiche(5021, 5022)], [true, [5001], [5011], true, false]);
    const corps = brutF.subarray(0, brutF.length - 32);
    const S = F.sections(brutF); const sec = nom => S.find(x => x.nom === nom);
    const rang = id => Array.from(v.identifiants()).indexOf(id);
    const refuse = fn => { try { fn(); return null; } catch (x) { return x.name === 'FormatInvalide' ? x.motif : `AUTRE:${x.name}:${x.message}`; } };
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    const iFlags = sec('mar.flags');
    H.v('3f. STRUCTURE : false sans liste sur une ligne SANS variante (drapeau réécrit, RESCELLÉ) : refusé', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(8, iFlags.debut + 4 * rang(5100)); }))), 'marquages : un drapeau de partage sans liste de 2 à 6 produits');
    H.v('3g. STRUCTURE : true sans liste sur une ligne AVEC variante (RESCELLÉ) : refusé', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(4, iFlags.debut + 4 * rang(5002)); }))), 'marquages : un drapeau de partage sans liste de 2 à 6 produits');
    H.v('3h. STRUCTURE : holo true en plus sur une paire sans liste (RESCELLÉ) : refusé', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(b2.readInt32LE(iFlags.debut + 4 * rang(5002)) | 1, iFlags.debut + 4 * rang(5002)); }))), 'marquages : un drapeau de partage sans liste de 2 à 6 produits');
    const paq = v.paquet().donnees;
    H.v('3i. le paquet intact (voie « fil ») est accepté, et sa colonne des partages est la même', [depuisPaquet(paq).partagesDe(5001), depuisPaquet(paq).memeFiche(5001, 5002)], [[5002], true]);

    // ── 4. F1 : la paire est « prouvée séparée » dans deux cas, et nulle part ailleurs
    const memeFiche = (a, c) => v.memeFiche(a, c);
    const pb = (ids, entree = id => v.entree(id), mf = memeFiche) => { const x = LT.paireSeparee({ ids, entree, memeFiche: mf }); return x.ok ? [x.type, x.special, x.normale] : x.motif; };
    H.v('4a. (b) la paire Staff sans liste, même visuel, même fiche : staff = 5002, normale = 5001, quel que soit l\'ordre', [pb([5001, 5002]), pb([5002, 5001])], [['staff', 5002, 5001], ['staff', 5002, 5001]]);
    H.v('4b. (b) la paire Jumbo : rien (un jumbo reste une question)', pb([5011, 5012]), 'les variantes ne sont pas une paire marque/normale');
    H.v('4c. (b) même visuel mais fiches différentes : rien', pb([5021, 5022]), 'les deux produits ne sont pas de la même fiche');
    H.v('4d. (b) même fiche mais visuels différents : rien', pb([5031, 5032]), 'les deux produits ne partagent pas le même visuel');
    H.v('4e. (b) deux staff : rien', pb([5041, 5042]), 'les variantes ne sont pas une paire marque/normale');
    H.v('4f. (b) sans fournisseur de fiche (memeFiche absent, ou qui lève) : rien — jamais devinée', [pb([5001, 5002], id => v.entree(id), null), pb([5001, 5002], id => v.entree(id), () => { throw new Error('boum'); })], ['la fiche commune n\'est pas connue', 'les deux produits ne sont pas de la même fiche']);
    const gardes = { entree: id => v.entree(id), ids: [5001, 5002], memeFiche };
    const entreesAvec = (f) => id => { const x = v.entree(id); return x && f(id, x); };
    const forme = (f, ids = [5001, 5002]) => { const x = LT.paireSeparee({ ids, entree: entreesAvec(f), memeFiche }); return x.ok ? 'OK' : x.motif; };
    H.v('4g. (b) une liste d\'un seul côté (forme mêlée) : rien', forme((id, x) => (id === 5001 ? { ...x, produitsPartages: [5001, 5002] } : x)), 'la liste de partage ne nomme pas exactement la paire');
    H.v('4h. (b) un côté `true`, ou `null` : rien', [forme((id, x) => (id === 5001 ? { ...x, partageeTamponNonSepare: true } : x)), forme((id, x) => (id === 5002 ? { ...x, partageeTamponNonSepare: null } : x))], ['la paire n\'est pas marquée séparée', 'la paire n\'est pas marquée séparée']);
    H.v('4i. (b) un partage holo/non-holo en plus, ou aucun « Staff » dans tamponNonRepresente : rien', [forme((id, x) => ({ ...x, partageeHoloNonHolo: true })), forme((id, x) => ({ ...x, tamponNonRepresente: null }))], ['un partage holo / non-holo se mêle à la paire', 'l\'archive ne dit pas quel tampon n\'est pas représenté']);
    H.v('4j. (b) la question n\'est pas exactement la paire (3 candidats, 1, doublon) : rien', [pb([5001, 5002, 5100]), pb([5001]), pb([5001, 5001])], ['la question n\'est pas exactement la paire', 'la question n\'est pas exactement la paire', 'la question n\'est pas exactement la paire']);
    H.v('4k. (a) la forme d\'AVANT (listes = la paire) se déclenche toujours, sans fournisseur de fiche', LT.paireSeparee({ ids: [11, 12], entree: id => ({ 11: { partageeHoloNonHolo: null, partageeTamponNonSepare: false, produitsPartages: [11, 12], tamponNonRepresente: 'Staff', variante: 'normale' },
        12: { partageeHoloNonHolo: null, partageeTamponNonSepare: false, produitsPartages: [11, 12], tamponNonRepresente: 'Staff', variante: 'staff' } })[id] || null }).ok, true);

    // tour de correction 1 : staff + jumbo, deux jumbo, et les absences de visuel (entrées fabriquées, memeFiche toujours vrai : seul le reste est jugé)
    const ent = (id, variante, o = {}) => ({ idProduct: id, partageeTamponNonSepare: false, partageeHoloNonHolo: null, produitsPartages: null, tamponNonRepresente: 'Staff', variante, vignette: { cle: 'v/x.webp', w: 200, h: 279 }, grande: { cle: 'g/x.webp', w: 600, h: 838 }, ...o });
    const tous = () => true;
    const pp = (ea, eb) => { const r = PV.pairePar(ea, eb, tous); return r.ok ? [r.special, r.normale, r.variante] : r.motif; };
    const f1 = (ea, eb) => { const x = LT.paireSeparee({ ids: [1, 2], entree: id => (id === 1 ? ea : eb), memeFiche: tous }); return x.ok ? [x.special, x.normale] : x.motif; };
    const MV = 'les variantes ne sont pas une paire staff|jumbo/normale', MF1 = 'les variantes ne sont pas une paire marque/normale';
    H.v('4n. pairePar : staff/normale et jumbo/normale sont des paires (le special est nomme)', [pp(ent(1, 'staff'), ent(2, 'normale')), pp(ent(1, 'normale'), ent(2, 'jumbo'))], [[1, 2, 'staff'], [2, 1, 'jumbo']]);
    H.v('4o. pairePar : staff + jumbo, jumbo + staff, deux jumbo, deux staff, deux normales : jamais une paire', [pp(ent(1, 'staff'), ent(2, 'jumbo')), pp(ent(1, 'jumbo'), ent(2, 'staff')), pp(ent(1, 'jumbo'), ent(2, 'jumbo')), pp(ent(1, 'staff'), ent(2, 'staff')), pp(ent(1, 'normale'), ent(2, 'normale'))], [MV, MV, MV, MV, MV]);
    H.v('4p. F1 (paireSeparee) : staff + jumbo, jumbo + staff et deux jumbo ne declenchent rien', [f1(ent(1, 'staff'), ent(2, 'jumbo')), f1(ent(1, 'jumbo'), ent(2, 'staff')), f1(ent(1, 'jumbo'), ent(2, 'jumbo'))], [MF1, MF1, MF1]);
    H.v('4q. F1 : staff + normale declenche (controle de 4p), jumbo + normale non', [f1(ent(1, 'staff'), ent(2, 'normale')), f1(ent(1, 'jumbo'), ent(2, 'normale'))], [[1, 2], MF1]);
    const MVIS = 'les deux produits ne partagent pas le même visuel';
    H.v('4r. deux vignettes ABSENTES ne sont pas « le meme visuel » (jamais admis pour la vignette), ni vignette absente d\'un seul cote', [pp(ent(1, 'staff', { vignette: null }), ent(2, 'normale', { vignette: null })), pp(ent(1, 'staff', { vignette: undefined }), ent(2, 'normale', { vignette: undefined })), pp(ent(1, 'staff', { vignette: null }), ent(2, 'normale'))], [MVIS, MVIS, MVIS]);
    H.v('4s. deux grandes ABSENTES : le meme visuel (la vignette dit le fichier) ; une seule absente : refuse ; F1 pareil', [pp(ent(1, 'staff', { grande: null }), ent(2, 'normale', { grande: null })), pp(ent(1, 'staff', { grande: null }), ent(2, 'normale')), f1(ent(1, 'staff', { grande: null }), ent(2, 'normale', { grande: null })), f1(ent(1, 'staff', { vignette: null }), ent(2, 'normale', { vignette: null }))],
        [[1, 2, 'staff'], MVIS, [1, 2], MVIS]);

    // F1 de bout en bout (route) sur la forme (b) : la lecture « oui » deux fois affirme le Staff, et le déclenchement exige la fiche commune
    const CARTE = (await sharp({ create: { width: 420, height: 587, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg({ quality: 92 }).toBuffer()).toString('base64');
    const cfg = lireConfig({ V2_LECTURE_TAMPON: '1', V2_EMPREINTE_EXTENSION: '1' });
    const lignesProd = new Map([5001, 5002, 5011, 5012, 5021, 5022].map(id => [id, { idProduct: id }]));
    const consulter = async (ids, version) => {
        LT.reinitialiser(); let appels = 0;
        const res = await consulterLectureTampon({ deps: { lectureTampon: async () => { appels++; return { lecture: 'marques', marques: ['staff'], essais: [{ marques: ['staff'] }, { marques: ['staff'] }], echec: false, sansImage: false }; } }, cfg, entree: { empreintes: { entrees: [{ carte: CARTE }] } }, scanId: `s${ids.join('')}`,
            resultat: { issue: 'question', analyse: { cartes: [{ candidats: ids.map(idProduct => ({ idProduct })) }] } }, corpsChaine: {}, produits: lignesProd, version, affirmer: id => ({ issue: 'affirmee', id }), avecBorne: fn => fn(), journal: () => { } });
        return [res && res.resultat ? res.resultat.id : (res ? res.trace : null), appels];
    };
    H.v('4l. route : la paire Staff sans liste → STAFF lu deux fois → le produit Staff (5002) est affirmé, 2 lectures lancées une seule fois', await consulter([5001, 5002], v), [5002, 1]);
    H.v('4m. route : la paire Jumbo, ou des fiches différentes → aucun appel, aucune affirmation (la réponse d\'avant)', [await consulter([5011, 5012], v), await consulter([5021, 5022], v)], [[null, 0], [null, 0]]);

    // ── 5. LA GARDE DES JUMEAUX traite (b) comme (a)
    const ancienne = creerConstructeur({ marquages: true });                                                  // la MÊME paire, forme d'AVANT (listes)
    const avant = (id, variante, liste) => brut(id, { ...SAME(id), partageeTamponNonSepare: false, produitsPartages: liste, tamponNonRepresente: 'Staff', variante, idMetacard: 800 });
    ancienne.entree(avant(6001, 'normale', [6001, 6002])); ancienne.entree(avant(6002, 'staff', [6001, 6002]));
    for (const id of [6001, 6002]) ancienne.jumeau({ idProduct: id, idMetacard: 800, idExpansion: 9, numero: '1', tirage: 'intl' });
    ancienne.lien('Set-A', '1|001', [6001, 6002]);
    const va = ancienne.finir(new Date('2026-10-18T10:00:00.000Z'));
    const fa = fournisseurDe(va), fb = fournisseurDe(v);
    H.v('5a. le fournisseur : (a) liste et (b) variante rendent la même chose pour la paire (le partenaire, nommé à part)', [fa(6001), fa(6002), fb(5001), fb(5002)].map(x => [x.conclu, x.ids.length, (x.partages || []).length]), [[true, 1, 1], [true, 1, 1], [true, 1, 1], [true, 1, 1]]);
    H.v('5b. (b) : 5001 ↔ 5002 dans le fournisseur (ids et partages) ; la paire Jumbo de même ; deux fiches différentes : aucun partage', [fb(5001).ids, fb(5001).partages, fb(5002).ids, fb(5012).ids, fb(5021).ids, fb(5100) ? 'x' : 'y'], [[5002], [5002], [5001], [5011], [], 'x']);
    const cfgA = lireConfig({});
    const ligneProd = (idProduct, o = {}) => ({ idProduct, nomCardmarket: 'Carte [Un | Deux]', nomFr: null, set: { slug: 'set-x', nom: 'Set X', code: 'AAA' }, numero: '1', total: '100', setTcgdex: null, langue: 'EN', variante: null, rarete: 'Rare',
        prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://exemple.invalide/${idProduct}.webp`, w: 255, h: 356 }, tirageSource: 'intl', ...o });
    const LU = { numero: '1', total: '100', setCode: 'AAA', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false };
    const corpsDe = gagnant => ({ success: true, scanId: 's', question: null, carte: { idProduct: gagnant, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom: 'Carte', nomBrut: 'Carte', nomConfiance: 'haute', numero: '1', total: '100', setCode: 'AAA', tcgdexId: null, langue: null },
        etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' }, candidats: [{ idProduct: gagnant }], classement: [{ idProduct: gagnant, score: 80 }], reverse: { attendue: false, strategie: null }, codeLangue: 1, lectureGarde: { ...LU, vivierIds: [gagnant] } });
    const produits = new Map([5001, 5002, 5011, 5012, 5021, 5022, 6001, 6002].map(i => [i, ligneProd(i)]));
    const jouer = (version, gagnant) => muet(() => adapter({ statutHttp: 200, corps: corpsDe(gagnant) }, { produits, langueInterface: 'fr', cfg: cfgA, jumeaux: fournisseurDe(version) }));
    const montres = x => (x.issue === 'question' ? x.analyse.cartes[0].candidats.map(c => c.idProduct).sort((p, q) => p - q) : x.issue);
    H.v('5c. la chaîne affirme un produit de la paire : (a) et (b) donnent la MÊME issue, une QUESTION entre les deux (l\'image ne prouve jamais le Staff)', [montres(jouer(va, 6001)), montres(jouer(va, 6002)), montres(jouer(v, 5001)), montres(jouer(v, 5002)), montres(jouer(v, 5012))], [[6001, 6002], [6001, 6002], [5001, 5002], [5001, 5002], [5011, 5012]]);
    H.v('5d. contrôle : deux produits de fiches différentes (pas une paire) : la chaîne affirme 5021 comme avant', jouer(v, 5021).issue === 'affirmee' || jouer(v, 5021).issue, true);
    H.bilan();
})().catch(x => { console.error('❌', x); process.exitCode = 1; });

'use strict';
// LOT TAMPONS (B, tour 1) — la COLONNE PROPRE des prix mélangés de l'ARCHIVE : la liste triée des idProduct que cartes_produits marque `prixMelangeTampon`, émise pour CHAQUE ligne marquée AVANT tout écartement
// (elle ne dépend d'AUCUN visuel : un produit sans entrée d'archive la porte aussi), rangée dans une section facultative du format 2 (une archive d'avant reste lisible : « inconnu »), validée à la structure,
// lue par F4 (catalogue.lire -> construireProduit). Le chargeur imprime le dénominateur et la construction LÈVE si la colonne n'a pas exactement les produits marqués. Base EN MÉMOIRE, aucun réseau.
// Le banc de cartes du relevé du testeur (10 cartes « fiche propre = non », 30 « oui ») est FABRIQUÉ ici : seuls les idProduct du relevé en viennent.
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const { lireEntree } = require('../identifier/visuels');
const { creerConstructeur, rejugerEntrees } = require('../chargeur/version');
const F = require('../chargeur/format'); const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');
const { PROJECTIONS, compacterLigne, interneur } = require('../chargeur/source');
const { decider } = require('../chargeur/decision'); const { regleEmbarquee } = require('../chargeur/regle-site');
const { calculer } = require('../chargeur/calcul');
const { creerCatalogue } = require('../identifier/catalogue'); const { construireProduit } = require('../identifier/produit');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const refuse = fn => { try { fn(); return null; } catch (x) { return x.name === 'FormatInvalide' ? x.motif : `AUTRE:${x.name}:${x.message}`; } };

const PAS_PROPRES = [297621, 437164, 449623, 364326, 289709, 360556, 316015, 276443, 388377, 276384];
const PROPRES = [275574, 882904, 449213, 769412, 851050, 851046, 761122, 761138, 859015, 851048, 873102, 864356, 882908, 882889, 877546, 884752, 275575, 882210, 449653, 865662, 469839, 782253, 371590, 708073, 825219, 738952, 771356, 359285, 902796, 450593];

(async () => {
    // ── 1. LA VALIDATION D'ENTRÉE : le prix mélangé n'est PLUS un champ d'entrée ; la variante hors liste fermée est null à la lecture (M3)
    const lu = o => { const r = lireEntree(brut(11, o)); return r.ok ? r.doc : null; };
    H.v('1a. une entrée ne porte plus `prixMelangeTampon` (colonne propre) ; un champ qui traîne est ignoré, pas gardé', 'prixMelangeTampon' in lu({ prixMelangeTampon: true }), false);
    H.v('1b. M3 : la variante est lue dans la liste fermée — une marque, un ensemble canonique, jumbo, normale gardés ; hors liste, autre ordre, forme ancienne, casse : null', ['staff', 'league+place-2', 'jumbo', 'normale', 'inconnu', 'prerelease+staff', 'staff-prerelease', 'Staff', 'V1'].map(v => lu({ variante: v }).variante),
        ['staff', 'league+place-2', 'jumbo', 'normale', null, null, null, null, null]);

    // ── 2. LA VERSION : colonne, fichier, structure, rétrocompatibilité
    const b = creerConstructeur({ marquages: true });
    b.entree(brut(5001)); b.entree(brut(5003)); b.melange(5001); b.melange(5002); b.melange(5001);          // 5002 : AUCUNE entrée d'archive ; 5001 posé deux fois
    const v = b.finir(new Date('2026-10-18T10:00:00.000Z'));
    H.v('2a. prixMelange(id) : vrai pour 5001 (avec entrée) ET 5002 (SANS entrée), faux pour 5003 (entrée, non marqué) et un produit inconnu ; une colonne présente', [5001, 5002, 5003, 9999].map(id => v.prixMelange(id)).concat(v.colonneMelange), [true, true, false, false, true]);
    H.v('2b. le compte de l\'en-tête = la colonne (2 produits distincts) ; le rejugement des entrées passe', [v.comptes.melange, rejugerEntrees(v).ok], [2, true]);
    const w = F.deserialiser(F.serialiser(v));
    H.v('2c. aller-retour du fichier : mêmes réponses, même compte, la colonne est présente', [[5001, 5002, 5003, 9999].map(id => w.prixMelange(id)), w.comptes.melange, w.colonneMelange], [[true, true, false, false], 2, true]);
    H.v('2d. sans la colonne des marquages, `melange` LÈVE (jamais perdu en silence) ; entrée ordinaire acceptée', [(() => { try { creerConstructeur().melange(5101); return 'accepté'; } catch { return 'lève'; } })(), creerConstructeur().entree(brut(5102))], ['lève', true]);
    H.v('2e. un idProduct non entier ou non positif LÈVE', [0, -4, 1.5, '12', null].map(x => { try { creerConstructeur({ marquages: true }).melange(x); return 'accepté'; } catch { return 'lève'; } }), Array(5).fill('lève'));
    // rétrocompatibilité : l'archive d'AVANT n'a pas la section ; elle se lit, `prixMelange` rend null (inconnu), jamais faux
    const sans = F.serialiser(VB.construire([VB.doc(6001, { idMetacard: 1 })]));
    const va = F.deserialiser(sans);
    H.v('2f. une archive SANS la colonne (format 1 d\'avant) : lisible, `prixMelange` = null (inconnu), `colonneMelange` faux', [va.prixMelange(6001), va.colonneMelange, va.comptes.melange], [null, false, undefined]);
    const brutF = F.serialiser(v), corps = brutF.subarray(0, brutF.length - 32), S = F.sections(brutF), sec = S.find(x => x.nom === 'mel.produits');
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    H.v('2g. STRUCTURE : les identifiants de la colonne doivent croître strictement (5002 -> 5001, rescellé) ; non positifs refusés', [
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(5002, sec.debut); b2.writeInt32LE(5001, sec.debut + 4); }))),
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(0, sec.debut); })))], ['prix mélangés : identifiants non strictement croissants ou non positifs', 'prix mélangés : identifiants non strictement croissants ou non positifs']);
    const ent = F.lireEntete(brutF), entSans = F.lireEntete(sans);
    H.v('2h. STRUCTURE : le compte de l\'en-tête doit être celui de la colonne ; un compte SANS colonne est refusé', [
        refuse(() => F.deserialiser(F.reecrireEntete(brutF, { ...ent, comptes: { ...ent.comptes, melange: 7 } }))),
        refuse(() => F.deserialiser(F.reecrireEntete(sans, { ...entSans, comptes: { ...entSans.comptes, melange: 1 } })))], ['prix mélangés : compte de l\'en-tête différent de celui de la colonne', 'prix mélangés : un compte sans colonne']);
    const d2 = creerConstructeur({ marquages: true }); d2.entree(brut(7001));
    H.v('2i. une version sans produit marqué écrit quand même la colonne (vide : « aucun » est une réponse) : prixMelange faux, pas null', [d2.finir(new Date('2026-10-18T10:00:00.000Z')).prixMelange(7001)], [false]);

    // ── 3. LE CHARGEUR : la lecture de cartes_produits, l'émission avant tout écartement, le dénominateur qui fait LEVER
    H.v('3a. la projection de cartes_produits lit prixMelangeTampon', PROJECTIONS.cartes_produits.prixMelangeTampon, 1);
    const I = interneur(), cl = x => compacterLigne({ carteId: 1, idProduct: 1, idExpansion: 1, ...x }, I).prixMelangeTampon;
    H.v('3b. compacterLigne : true, false gardés ; « true » (texte), 1, null, absent -> null (=== booléen seulement)', [cl({ prixMelangeTampon: true }), cl({ prixMelangeTampon: false }), cl({ prixMelangeTampon: 'true' }), cl({ prixMelangeTampon: 1 }), cl({ prixMelangeTampon: null }), cl({})], [true, false, null, null, null, null]);
    H.v('3c. la preuve INTERNE du catalogue (prixMelangeTamponPreuve, tamponsConnus) n\'est PAS lue', [PROJECTIONS.cartes_produits.prixMelangeTamponPreuve, PROJECTIONS.cartes_produits.tamponsConnus], [undefined, undefined]);
    const regle = await regleEmbarquee();
    const set = { _id: 'Set-A', idExpansion: 100, code: 'SETA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } };
    const im = (numero, n) => ({ set: 'Set-A', numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const carte = (id, numero) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images: [im(numero, `c${id}`)] });
    // 4001 : image ; 4002 : AUCUNE carte (« carte absente ») ; 4003 : carte sans image (« aucun visuel ») ; 4101 : faux ; 4201 : absent ; 4301 : marqué sur deux lignes
    const docs = [carte(40, '020'), carte(41, '021'), carte(42, '022'), { ...carte(43, '023'), images: [] }];
    const lignes = [{ idProduct: 4001, carteId: 40, idExpansion: 100, numeroFiche: '020', slug: 'P4001-X020', slugSet: 'Set-A', prixMelangeTampon: true },
        { idProduct: 4002, carteId: 999, idExpansion: 100, numeroFiche: '020', slug: 'P4002-X020', slugSet: 'Set-A', prixMelangeTampon: true },
        { idProduct: 4003, carteId: 43, idExpansion: 100, numeroFiche: '023', slug: 'P4003-X023', slugSet: 'Set-A', prixMelangeTampon: true },
        { idProduct: 4101, carteId: 41, idExpansion: 100, numeroFiche: '021', slug: 'P4101-X021', slugSet: 'Set-A', prixMelangeTampon: false },
        { idProduct: 4201, carteId: 42, idExpansion: 100, numeroFiche: '022', slug: 'P4201-X022', slugSet: 'Set-A' },
        { idProduct: 4301, carteId: 40, idExpansion: 100, numeroFiche: '020', slug: 'P4301-X020', slugSet: 'Set-A', prixMelangeTampon: true }, { idProduct: 4301, carteId: 40, idExpansion: 100, numeroFiche: '020', slug: 'P4301-X020', slugSet: 'Set-A', prixMelangeTampon: true }];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets: [set], docs, lignes, metacarte, regle });
    H.v('3d. la décision (sans sink) rend la liste des produits marqués : 4001 (image), 4002 (sans carte), 4003 (sans visuel), 4301 — pas 4101 (faux), pas 4201 (absent) ; chaque produit une fois', r.melanges, [4001, 4002, 4003, 4301]);
    H.v('3e. le dénominateur : 4 produits marqués distincts ; et les entrées émises ne portent AUCUN champ prixMelangeTampon', [r.denominateurs.melangeProduits, r.entrees.some(x => 'prixMelangeTampon' in x), r.entrees.every(x => lireEntree(JSON.parse(JSON.stringify(x))).ok)], [4, false, true]);
    H.v('3f. 4002 et 4003 n\'ont AUCUNE entrée d\'archive (la marque ne dépend pas d\'un visuel : c\'est le défaut de la relecture)', [r.entrees.some(x => x.idProduct === 4002), r.entrees.some(x => x.idProduct === 4003), r.entrees.some(x => x.idProduct === 4001)], [false, false, true]);
    const cal = await calculer({ sets: [set], docs, lignes, metacarte, regle });
    H.v('3g. calculer : la colonne de la version porte les 4 produits (dont les deux sans entrée), le dénominateur est imprimé (comptes.melangeProduits = melangeColonne = 4)', [cal.version.prixMelange(4002), cal.version.prixMelange(4003), cal.version.prixMelange(4101), cal.version.comptes.melange, cal.comptes.melangeProduits, cal.comptes.melangeColonne], [true, true, false, 4, 4, 4]);
    // la construction LÈVE si la colonne ne dit pas la même chose que cartes_produits (un décideur qui compte un produit de plus)
    const trompeur = async a => { const x = await require('../chargeur/decision').decider(a); return { ...x, denominateurs: { ...x.denominateurs, melangeProduits: x.denominateurs.melangeProduits + 1 } }; };
    const leve = await calculer({ sets: [set], docs, lignes, metacarte, regle, decider: trompeur }).then(() => 'passe', e => (/prix mélangés : produits marqués dans cartes_produits 5 ≠ dans la colonne 4/.test(e.message) ? 'lève' : `AUTRE ${e.message}`));
    H.v('3h. si le nombre de produits marqués de cartes_produits diffère de celui de la colonne : la construction LÈVE, avec les deux comptes', leve, 'lève');

    // ── 4. F4 : le catalogue lit la colonne par idProduct, et le prix sort avec la mention (le banc des 10 cartes du relevé + la sonde de la relecture)
    await H.ouvrirBac('test-prix-melange-archive.js');
    const TOUS = [...PAS_PROPRES, ...PROPRES, 4001, 4002];
    await db.col('catalogue_produits').insertMany(TOUS.map((id, i) => ({ idProduct: id, name: `Carte relevé ${id} [Attaque]`, idExpansion: 1000 + i, idMetacard: 800000 + i })));
    // numeros_cartes : le champ est ABSENT partout (le catalogue n'a pas encore écrit) ; sauf un produit, vrai dans l'ancienne collection (le chemin d'avant doit continuer de marcher)
    const VIEUX = PROPRES[0];
    await db.col('numeros_cartes').insertMany(TOUS.map((id, i) => ({ idProduct: id, idExpansion: 1000 + i, numero: '1', numeroUrl: '1', codeSet: 'REL', nomFr: `Carte ${id}`, slug: `Carte-${id}-REL1`, slugSet: 'Releve', source: 'cardmarket', variante: null, ...(id === VIEUX ? { prixMelangeTampon: true } : {}) })));
    const g = new Date('2026-10-12T00:47:30.000Z');
    await db.col('guide_prix').insertMany(TOUS.map(id => ({ idProduct: id, trend: 3, low: 1, avg7: 3, avg30: 3, guideDu: g })));
    // l'archive : une entrée pour chaque produit SAUF 4002 (aucun visuel) ; la colonne propre marque les 10 « pas propres » et 4001, 4002
    const archive = creerConstructeur({ marquages: true });
    for (const id of TOUS.filter(x => x !== 4002)) archive.entree(VB.doc(id, { idMetacard: 800000 + TOUS.indexOf(id), numero: '1', total: '100', variante: id === PROPRES[2] ? 'league' : id === PROPRES[3] ? 'normale' : null, setNom: 'Releve', lien: null }));
    for (const id of [...PAS_PROPRES, 4001, 4002]) archive.melange(id);
    E.installer(archive.finir(new Date('2026-10-18T10:00:00.000Z')));
    const cat = creerCatalogue({ cfg }), table = await cat.lire(TOUS);
    const reserves = id => construireProduit(table.get(id), { langueInterface: 'fr', cfg }).prixGuide;
    const MELANGE = ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'];
    H.v('4a. les 10 cartes « fiche propre = non » du relevé : la mention des prix mélangés, jamais « fiable »', PAS_PROPRES.filter(id => !(JSON.stringify(reserves(id).reserves) === JSON.stringify(MELANGE) && reserves(id).fiable === false)), []);
    H.v('4b. la SONDE DE LA RELECTURE : 4001 (avec image) ET 4002 (SANS entrée d\'archive) sortent `fiable: false` avec la réserve', [4001, 4002].map(id => [reserves(id).fiable, reserves(id).reserves]), [[false, MELANGE], [false, MELANGE]]);
    H.v('4c. les 29 cartes « propre = oui » sans marque : AUCUNE mention des prix mélangés (leur prix reste fiable)', PROPRES.filter(id => id !== VIEUX).filter(id => reserves(id).reserves.some(x => MELANGE.includes(x)) || reserves(id).fiable !== true), []);
    H.v('4d. le chemin d\'AVANT (numeros_cartes.prixMelangeTampon) marche encore : la mention vient d\'une OU de l\'autre source', reserves(VIEUX).reserves, MELANGE);
    H.v('4e. les impressions d\'un produit marqué (avec entrée) le portent aussi (lecture par la métacarte)', table.get(PAS_PROPRES[1]).impressions.map(i => [i.idProduct, i.prixMelangeTampon]), [[PAS_PROPRES[1], true]]);
    H.v('4f. le champ additif `marques` du contrat, de bout en bout (archive -> catalogue -> Produit) : league prouvé, normale prouvée (aucune marque), les autres : on ne sait pas',
        [PROPRES[2], PROPRES[3], PROPRES[4]].map(id => [table.get(id).marques, construireProduit(table.get(id), { langueInterface: 'fr', cfg }).marques]), [[['league'], ['league']], [[], []], [null, null]]);
    // une archive d'AVANT (sans la colonne) : rien ne change, la mention ne vient que de numeros_cartes
    E.installer(VB.construire(TOUS.filter(x => x !== 4002).map(id => VB.doc(id, { idMetacard: 800000 + TOUS.indexOf(id), numero: '1', total: '100', variante: null, setNom: 'Releve', lien: null }))));
    const t2 = await creerCatalogue({ cfg }).lire(TOUS);
    H.v('4g. une archive sans la colonne : seul le produit vrai dans numeros_cartes porte la mention (aucune mention inventée)', TOUS.filter(id => t2.get(id).prixMelangeTampon === true), [VIEUX]);
    E.vider();
    await H.fermerBac(); H.bilan();
})().catch(async x => { console.error('❌', x); try { await H.fermerBac(); } catch { } process.exit(1); });

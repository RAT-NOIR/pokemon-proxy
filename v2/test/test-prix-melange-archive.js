'use strict';
// LOT TAMPONS (B) — la colonne `prixMelangeTampon` de l'ARCHIVE : lue depuis cartes_produits par le chargeur (source, décision), rangée dans la colonne des marquages (un champ de 2 bits de plus,
// rétrocompatible : une archive d'avant lit « inconnu »), validée à l'entrée et à la structure, puis lue par F4 (catalogue.lire -> construireProduit). Base EN MÉMOIRE, aucun réseau.
// Le banc de cartes du relevé du testeur (10 cartes « fiche propre = non », 30 « oui ») est FABRIQUÉ ici : les idProduct sont ceux du relevé, aucune autre donnée n'en vient.
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const { lireEntree } = require('../identifier/visuels');
const { creerConstructeur, rejugerEntrees, StructureInvalide } = require('../chargeur/version');
const F = require('../chargeur/format'); const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');
const { PROJECTIONS, compacterLigne, interneur } = require('../chargeur/source');
const { decider } = require('../chargeur/decision'); const { regleEmbarquee } = require('../chargeur/regle-site');
const { creerCatalogue } = require('../identifier/catalogue'); const { construireProduit } = require('../identifier/produit');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const motif = o => { const r = lireEntree(brut(11, o)); return r.ok ? 'ADMIS' : r.motif; };
const refuse = fn => { try { fn(); return null; } catch (x) { return x.name === 'FormatInvalide' ? x.motif : `AUTRE:${x.name}:${x.message}`; } };

// le relevé du testeur (18/10) : les 10 cartes dont la fiche Cardmarket n'est PAS propre, les 30 dont elle l'est (idProduct seuls)
const PAS_PROPRES = [297621, 437164, 449623, 364326, 289709, 360556, 316015, 276443, 388377, 276384];
const PROPRES = [275574, 882904, 449213, 769412, 851050, 851046, 761122, 761138, 859015, 851048, 873102, 864356, 882908, 882889, 877546, 884752, 275575, 882210, 449653, 865662, 469839, 782253, 371590, 708073, 825219, 738952, 771356, 359285, 902796, 450593];

(async () => {
    // ── 1. LA VALIDATION D'ENTRÉE
    const lu = x => { const r = lireEntree(brut(11, x)); return r.ok ? r.doc.prixMelangeTampon : 'REFUSÉ'; };
    H.v('1a. true, false, null, absent : admis, gardés tels quels (absent = null = « inconnu »)', [lu({ prixMelangeTampon: true }), lu({ prixMelangeTampon: false }), lu({ prixMelangeTampon: null }), lu({})], [true, false, null, null]);
    H.v('1b. « true » (texte), 1, 0, « oui », un objet : REFUSÉ (=== true seulement, jamais coercé)', ['true', 1, 0, 'oui', {}, []].map(x => motif({ prixMelangeTampon: x })), Array(6).fill('champ "prixMelangeTampon" ni booleen ni null'));

    // ── 2. LA VERSION : colonne, fichier, structure, rétrocompatibilité
    const b = creerConstructeur({ marquages: true });
    b.entree(brut(5001, { prixMelangeTampon: true })); b.entree(brut(5002, { prixMelangeTampon: false })); b.entree(brut(5003)); b.entree(brut(5004, { prixMelangeTampon: true, partageeTamponNonSepare: false, variante: 'staff', tamponNonRepresente: 'Staff' }));
    const v = b.finir(new Date('2026-10-18T10:00:00.000Z'));
    H.v('2a. la colonne : 5001 vrai, 5002 faux, 5003 inconnu (null), 5004 vrai ; produit absent : null', [5001, 5002, 5003, 5004, 9999].map(id => { const e = v.entree(id); return e ? e.prixMelangeTampon : 'absent'; }), [true, false, null, true, 'absent']);
    H.v('2b. les comptes : 2 produits marqués vrai ; le rejugement des entrées passe', [v.comptes.marquees.melange, rejugerEntrees(v).ok], [2, true]);
    const w = F.deserialiser(F.serialiser(v));
    H.v('2c. aller-retour du fichier : mêmes entrées et mêmes comptes', [[5001, 5002, 5003, 5004].every(id => JSON.stringify(w.entree(id)) === JSON.stringify(v.entree(id))), w.comptes.marquees.melange], [true, 2]);
    const nb = creerConstructeur();
    H.v('2d. un constructeur SANS colonne de marquages refuse une entrée qui porte le champ (jamais perdu en silence), accepte une entrée sans', [(() => { try { nb.entree(brut(5101, { prixMelangeTampon: true })); return 'accepté'; } catch { return 'lève'; } })(), nb.entree(brut(5102))], ['lève', true]);
    // rétrocompatibilité : une archive qui ne porte AUCUN champ a des drapeaux d'AVANT (aucun bit au-delà des 6 premiers) et se lit « inconnu »
    const ancien = creerConstructeur({ marquages: true }); ancien.entree(brut(6001, { partageeHoloNonHolo: true, produitsPartages: [6001, 6002] })); ancien.entree(brut(6002, { partageeHoloNonHolo: true, produitsPartages: [6001, 6002], basseDefinition: true })); ancien.entree(brut(6003));
    const va = ancien.finir(new Date('2026-10-18T10:00:00.000Z'));
    H.v('2e. rétrocompatibilité : sans le champ, les drapeaux restent dans les 6 bits d\'avant (octet pour octet) et chaque entrée lit prixMelangeTampon = null', [Array.from(va.paquet().donnees.mar.flags).every(f => f >= 0 && f < 64), [6001, 6002, 6003].map(id => va.entree(id).prixMelangeTampon)], [true, [null, null, null]]);
    // un en-tête d'archive d'avant : comptes.marquees sans « melange » reste lisible
    const ent = F.lireEntete(F.serialiser(va)); const sansCompte = { ...ent, comptes: { ...ent.comptes, marquees: { holo: ent.comptes.marquees.holo, tampon: ent.comptes.marquees.tampon, partages: ent.comptes.marquees.partages, basse: ent.comptes.marquees.basse } } };
    H.v('2f. une archive dont l\'en-tête n\'a pas le compte « melange » (d\'avant) reste lisible ; un compte FAUX est refusé', [refuse(() => F.deserialiser(F.reecrireEntete(F.serialiser(va), sansCompte))),
        refuse(() => F.deserialiser(F.reecrireEntete(F.serialiser(v), { ...F.lireEntete(F.serialiser(v)), comptes: { ...F.lireEntete(F.serialiser(v)).comptes, marquees: { ...F.lireEntete(F.serialiser(v)).comptes.marquees, melange: 7 } } })))], [null, 'marquages : comptes de l\'en-tête différents de ceux des colonnes']);
    const brutF = F.serialiser(v), corps = brutF.subarray(0, brutF.length - 32), S = F.sections(brutF), flags = S.find(x => x.nom === 'mar.flags');
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    const rangDe = id => Array.from(v.identifiants()).indexOf(id);
    H.v('2g. STRUCTURE : l\'état « 3 » du champ (bits 6-7) est refusé ; un bit au-delà (8) est refusé (rescellé)', [
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(b2.readInt32LE(flags.debut + 4 * rangDe(5003)) | (3 << 6), flags.debut + 4 * rangDe(5003)); }))),
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(b2.readInt32LE(flags.debut + 4 * rangDe(5003)) | 256, flags.debut + 4 * rangDe(5003)); })))], ['marquages : état de drapeau inconnu', 'marquages : bit de drapeau inconnu']);
    H.v('2h. STRUCTURE : un champ « vrai » écrit à la main change le compte → l\'en-tête contredit les colonnes (refusé, rescellé)', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(b2.readInt32LE(flags.debut + 4 * rangDe(5003)) | (1 << 6), flags.debut + 4 * rangDe(5003)); }))), 'marquages : comptes de l\'en-tête différents de ceux des colonnes');
    // deux entrées au même visuel : le vrai l'emporte (un marquage dit par l'une vaut)
    const d2 = creerConstructeur({ marquages: true }); d2.entree(brut(7001, { prixMelangeTampon: true })); d2.entree(brut(7001, { prixMelangeTampon: false })); d2.entree(brut(7002)); d2.entree(brut(7002, { prixMelangeTampon: false }));
    const v2 = d2.finir(new Date('2026-10-18T10:00:00.000Z'));
    H.v('2i. deux entrées d\'un même produit au même visuel : vrai + faux = vrai ; inconnu + faux = faux (union, jamais « le dernier gagne »)', [v2.entree(7001).prixMelangeTampon, v2.entree(7002).prixMelangeTampon], [true, false]);

    // ── 3. LE CHARGEUR : la lecture de cartes_produits et la décision
    H.v('3a. la projection de cartes_produits lit prixMelangeTampon', PROJECTIONS.cartes_produits.prixMelangeTampon, 1);
    const I = interneur(), cl = x => compacterLigne({ carteId: 1, idProduct: 1, idExpansion: 1, ...x }, I).prixMelangeTampon;
    H.v('3b. compacterLigne : true, false gardés ; « true » (texte), 1, null, absent -> null (=== booléen seulement)', [cl({ prixMelangeTampon: true }), cl({ prixMelangeTampon: false }), cl({ prixMelangeTampon: 'true' }), cl({ prixMelangeTampon: 1 }), cl({ prixMelangeTampon: null }), cl({})], [true, false, null, null, null, null]);
    H.v('3c. la preuve INTERNE du catalogue (prixMelangeTamponPreuve, tamponsConnus) n\'est PAS lue', [PROJECTIONS.cartes_produits.prixMelangeTamponPreuve, PROJECTIONS.cartes_produits.tamponsConnus], [undefined, undefined]);
    const regle = await regleEmbarquee();
    const set = { _id: 'Set-A', idExpansion: 100, code: 'SETA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } };
    const im = (numero, n) => ({ set: 'Set-A', numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const carte = (id, numero) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images: [im(numero, `c${id}`)] });
    const lignes = [{ idProduct: 4001, carteId: 40, idExpansion: 100, numeroFiche: '020', slug: 'P4001-X020', slugSet: 'Set-A', prixMelangeTampon: true },
        { idProduct: 4101, carteId: 41, idExpansion: 100, numeroFiche: '021', slug: 'P4101-X021', slugSet: 'Set-A', prixMelangeTampon: false },
        { idProduct: 4201, carteId: 42, idExpansion: 100, numeroFiche: '022', slug: 'P4201-X022', slugSet: 'Set-A' }];
    const r = await decider({ sets: [set], docs: [carte(40, '020'), carte(41, '021'), carte(42, '022')], lignes, metacarte: new Map(lignes.map((l, i) => [l.idProduct, 9000 + i])), regle });
    const e = id => r.entrees.find(x => x.idProduct === id);
    H.v('3d. la décision : l\'entrée porte vrai, faux ou null selon la ligne ; et passe la validation d\'entrée', [e(4001).prixMelangeTampon, e(4101).prixMelangeTampon, e(4201).prixMelangeTampon, r.entrees.every(x => lireEntree(JSON.parse(JSON.stringify(x))).ok)], [true, false, null, true]);
    H.v('3e. le dénominateur : 1 produit marqué vrai parmi les entrées émises', r.denominateurs.marquees.melange, 1);

    // ── 4. F4 : le catalogue lit la colonne, et le prix sort avec la mention (le banc des 10 cartes du relevé)
    await H.ouvrirBac('test-prix-melange-archive.js');
    const TOUS = [...PAS_PROPRES, ...PROPRES];
    await db.col('catalogue_produits').insertMany(TOUS.map((id, i) => ({ idProduct: id, name: `Carte relevé ${id} [Attaque]`, idExpansion: 1000 + i, idMetacard: 800000 + i })));
    // numeros_cartes : le champ est ABSENT partout (le catalogue n'a pas encore écrit) ; sauf un produit, vrai dans l'ancienne collection (le chemin d'avant doit continuer de marcher)
    const VIEUX = PROPRES[0];
    await db.col('numeros_cartes').insertMany(TOUS.map((id, i) => ({ idProduct: id, idExpansion: 1000 + i, numero: '1', numeroUrl: '1', codeSet: 'REL', nomFr: `Carte ${id}`, slug: `Carte-${id}-REL1`, slugSet: 'Releve', source: 'cardmarket', variante: null, ...(id === VIEUX ? { prixMelangeTampon: true } : {}) })));
    const g = new Date('2026-10-12T00:47:30.000Z');
    await db.col('guide_prix').insertMany(TOUS.map(id => ({ idProduct: id, trend: 3, low: 1, avg7: 3, avg30: 3, guideDu: g })));
    const archive = creerConstructeur({ marquages: true });
    for (const id of TOUS) archive.entree(VB.doc(id, { idMetacard: 800000 + TOUS.indexOf(id), numero: '1', total: '100', variante: id === PROPRES[2] ? 'league' : id === PROPRES[3] ? 'normale' : null, setNom: 'Releve', lien: null, ...(PAS_PROPRES.includes(id) ? { prixMelangeTampon: true } : id === PROPRES[1] ? { prixMelangeTampon: false } : {}) }));
    E.installer(archive.finir(new Date('2026-10-18T10:00:00.000Z')));
    const cat = creerCatalogue({ cfg }), table = await cat.lire(TOUS);
    const reserves = id => construireProduit(table.get(id), { langueInterface: 'fr', cfg }).prixGuide;
    const MELANGE = ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'];
    H.v('4a. les 10 cartes « fiche propre = non » du relevé : la mention des prix mélangés, jamais « fiable »', PAS_PROPRES.filter(id => !(JSON.stringify(reserves(id).reserves) === JSON.stringify(MELANGE) && reserves(id).fiable === false)), []);
    H.v('4b. les 29 cartes « propre = oui » sans marque : AUCUNE mention des prix mélangés (leur prix reste fiable, tendance = moyennes)', PROPRES.filter(id => id !== VIEUX).filter(id => reserves(id).reserves.some(x => MELANGE.includes(x)) || reserves(id).fiable !== true), []);
    H.v('4c. le chemin d\'AVANT (numeros_cartes.prixMelangeTampon) marche encore : la mention vient d\'une OU de l\'autre source', reserves(VIEUX).reserves, MELANGE);
    H.v('4d. un produit marqué FAUX par l\'archive ne porte pas la mention ; la ligne de catalogue le dit (=== true)', [table.get(PROPRES[1]).prixMelangeTampon, table.get(PAS_PROPRES[0]).prixMelangeTampon, table.get(VIEUX).prixMelangeTampon], [false, true, true]);
    H.v('4e. les impressions d\'un produit marqué le portent aussi (lecture par la métacarte)', table.get(PAS_PROPRES[1]).impressions.map(i => [i.idProduct, i.prixMelangeTampon]), [[PAS_PROPRES[1], true]]);
    H.v('4e bis. le champ additif `marques` du contrat, de bout en bout (archive -> catalogue -> Produit) : league prouvé, normale prouvée (aucune marque), les autres : on ne sait pas',
        [PROPRES[2], PROPRES[3], PROPRES[4]].map(id => [table.get(id).marques, construireProduit(table.get(id), { langueInterface: 'fr', cfg }).marques]), [[['league'], ['league']], [[], []], [null, null]]);
    // une archive d'AVANT (sans la colonne) : rien ne change, la mention ne vient que de numeros_cartes
    E.installer(VB.construire(TOUS.map(id => VB.doc(id, { idMetacard: 800000 + TOUS.indexOf(id), numero: '1', total: '100', variante: null, setNom: 'Releve', lien: null }))));
    const t2 = await creerCatalogue({ cfg }).lire(TOUS);
    H.v('4f. une archive sans la colonne : seul le produit vrai dans numeros_cartes porte la mention (aucune mention inventée)', TOUS.filter(id => t2.get(id).prixMelangeTampon === true), [VIEUX]);
    E.vider();
    await H.fermerBac(); H.bilan();
})().catch(async x => { console.error('❌', x); try { await H.fermerBac(); } catch { } process.exit(1); });

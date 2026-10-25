'use strict';
// MARQUE-EMPRUNT — l'archive dit quel visuel est EMPRUNTÉ à un autre tirage (la décision `choisirVisuel` : 'autre-tirage', ou un substitut d'un AUTRE set), la version en mémoire le sait
// (`estEmprunte`), et la règle G le traite comme « sans visuel propre » (elle se tait). Une archive d'avant, sans la colonne, est lisible : `estEmprunte` rend null (inconnu), jamais « non emprunté »,
// et les règles d'image lisent null comme emprunté (défaut fermé). Pas de base, pas de réseau.
const H = require('./_harnais');
const F = require('../chargeur/format'); const E = require('../chargeur/etat');
const { creerConstructeur, rejugerEntrees } = require('../chargeur/version');
const { creerVisuels } = require('../identifier/visuels');
const { decider, estEmprunt } = require('../chargeur/decision'); const { regleEmbarquee } = require('../chargeur/regle-site'); const { calculer } = require('../chargeur/calcul');
const G = require('../../ratmarket/decision-g'); const { decisionRegleG } = require('../identifier/regle-g');
const EMP = require('../identifier/emprunt');

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const refuse = fn => { try { fn(); return null; } catch (x) { return x.name === 'FormatInvalide' ? x.motif : `AUTRE:${x.name}:${x.message}`; } };
const leve = fn => { try { fn(); return false; } catch { return true; } };
const D = new Date('2026-10-25T10:00:00.000Z');

(async () => {
    // ── 1. la colonne dans la version
    const b = creerConstructeur({ emprunts: true });
    b.entree(brut(5001, { visuel: 'autre-tirage', mention: 'Visuel de la même carte dans un autre tirage (X n°1) — pas celui de ce set' })); b.entree(brut(5002)); b.entree(brut(5003, { visuel: 'substitut', mention: 'm' }));
    b.emprunt(5001); b.emprunt(5003); b.emprunt(5001); b.emprunt(5999);                               // 5001 deux fois ; 5999 n'a AUCUNE entrée
    const v = b.finir(D);
    H.v('1a. estEmprunte : vrai 5001 et 5003, faux 5002 (entrée non marquée), null pour 5999 et 9 (aucune entrée : inconnu) ; la colonne est là', [5001, 5002, 5003, 5999, 9].map(id => v.empruntDe(id)).concat(v.colonneEmprunts), [true, false, true, null, null, true]);
    H.v('1b. le compte de l\'en-tête = les produits ayant une entrée ET marqués (5999 ne compte pas) ; le rejugement des entrées passe', [v.comptes.emprunts, rejugerEntrees(v).ok], [2, true]);
    H.v('1c. une entrée ne change pas de forme (le document validé n\'a pas de champ de nature)', Object.keys(v.entree(5001)).includes('visuel') || Object.keys(v.entree(5001)).includes('emprunte'), false);
    H.v('1d. sans l\'option `emprunts`, `emprunt` LÈVE (jamais perdu en silence) ; un idProduct non entier ou non positif LÈVE', [leve(() => creerConstructeur().emprunt(1)), ...[0, -4, 1.5, '12', null].map(x => leve(() => creerConstructeur({ emprunts: true }).emprunt(x)))], Array(6).fill(true));
    const c = creerConstructeur({ emprunts: true });
    c.entree(brut(7001, { vignette: { cle: 'vignettes/a.webp', w: 200, h: 279 } })); c.entree(brut(7001, { vignette: { cle: 'vignettes/b.webp', w: 200, h: 279 } }));      // deux visuels DIFFÉRENTS : aucun visuel pour ce produit
    c.entree(brut(7002)); c.emprunt(7001); c.emprunt(7002);
    const vc = c.finir(D);
    H.v('1e. un produit sans visuel (doublon contradictoire) n\'est pas compté comme emprunt', [vc.empruntDe(7001), vc.empruntDe(7002), vc.comptes.emprunts], [null, true, 1]);
    const vide = creerConstructeur({ emprunts: true }); vide.entree(brut(8001));
    H.v('1f. aucun emprunt : la colonne est écrite quand même (vide : « aucun » est une réponse), estEmprunte faux et non null', [vide.finir(D).empruntDe(8001), vide.finir(D).comptes.emprunts], [false, 0]);

    // ── 2. le fichier : format 3, aller-retour, archives d'avant
    const brutF = F.serialiser(v);
    H.v('2a. l\'en-tête annonce le format 3', F.lireEntete(brutF).format, 3);
    const w = F.deserialiser(brutF);
    H.v('2b. aller-retour : mêmes réponses, même compte, colonne présente, entrées identiques', [[5001, 5002, 5003, 5999].map(id => w.empruntDe(id)), w.comptes.emprunts, w.colonneEmprunts, [5001, 5002, 5003].every(id => JSON.stringify(w.entree(id)) === JSON.stringify(v.entree(id)))], [[true, false, true, null], 2, true, true]);
    H.vrai('2c. déterministe : deux sérialisations, les mêmes octets', F.serialiser(v).equals(brutF));
    const tout = creerConstructeur({ marquages: true, emprunts: true }); tout.entree(brut(1)); tout.entree(brut(2)); tout.melange(2); tout.emprunt(2); tout.jumeau({ idProduct: 1, idMetacard: 5, idExpansion: 1, numero: '1', tirage: 'intl' });
    const wt = F.deserialiser(F.serialiser(tout.finir(D)));
    H.v('2d. avec marquages, prix mélangés et jumeaux : tout se relit, les colonnes ne se mêlent pas', [wt.colonneMarquages, wt.colonneMelange, wt.colonneJumeaux, wt.colonneEmprunts, wt.prixMelange(2), wt.empruntDe(2), wt.empruntDe(1)], [true, true, true, true, true, true, false]);
    // une archive d'AVANT : format 1 et format 2 (marquages + prix mélangés) restent lisibles ; estEmprunte = null (inconnu), jamais faux
    const a1 = creerConstructeur(); a1.entree(brut(1, { idMetacard: 5 })); a1.lien('Set-A', '1|001', [1]);
    const a2 = creerConstructeur({ marquages: true }); a2.entree(brut(1, { idMetacard: 5 })); a2.lien('Set-A', '1|001', [1]); a2.melange(1);
    const [va1, va2] = [a1, a2].map(x => F.deserialiser(F.serialiser(x.finir(D))));
    H.v('2e. archives d\'avant (format 1, format 2) : lisibles, estEmprunte null (on ne sait pas), colonneEmprunts faux, aucun compte inventé', [va1.empruntDe(1), va2.empruntDe(1), va1.colonneEmprunts, va2.colonneEmprunts, va1.comptes.emprunts, va2.comptes.emprunts], [null, null, false, false, undefined, undefined]);
    H.v('2f. et estEmprunte d\'un id non entier : null', [v.empruntDe('5001'), v.empruntDe(null)], [null, null]);
    // structure : un fichier MENTEUR (hachage juste)
    const corps = brutF.subarray(0, brutF.length - 32), S = F.sections(brutF), sec = S.find(x => x.nom === 'emp.produits');
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    const ent = F.lireEntete(brutF);
    H.v('2g. STRUCTURE : ordre non croissant, ou non positif, ou produit SANS entrée (RESCELLÉ) : refusés', [
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(5003, sec.debut); b2.writeInt32LE(5001, sec.debut + 4); }))),
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(0, sec.debut); }))),
        refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(5004, sec.debut + 4); })))],
    ['emprunts : identifiants non strictement croissants ou non positifs', 'emprunts : identifiants non strictement croissants ou non positifs', 'emprunts : un produit marqué n\'a pas d\'entrée dans l\'archive']);
    H.v('2h. STRUCTURE : le compte de l\'en-tête doit être celui de la colonne ; un compte SANS colonne est refusé', [
        refuse(() => F.deserialiser(F.reecrireEntete(brutF, { ...ent, comptes: { ...ent.comptes, emprunts: 7 } }))),
        refuse(() => { const e1 = F.lireEntete(F.serialiser(a1.finir(D))); F.deserialiser(F.reecrireEntete(F.serialiser(a1.finir(D)), { ...e1, comptes: { ...e1.comptes, emprunts: 1 } })); })],
    ['emprunts : compte de l\'en-tête différent de celui de la colonne', 'emprunts : un compte sans colonne']);
    H.v('2i. le format est jugé par son NUMÉRO : un format 3 sans la section (en-tête réécrit), un format 2 AVEC la section, un format inconnu (99) : refusés', [
        refuse(() => F.deserialiser(F.reecrireEntete(brutF, { ...ent, sections: ent.sections.filter(x => x.nom !== 'emp.produits') }))) !== null,
        refuse(() => F.deserialiser(F.reecrireEntete(brutF, { ...ent, format: 2 }))) !== null,
        /format/i.test(refuse(() => F.deserialiser(F.reecrireEntete(brutF, { ...ent, format: 99 })) || ''))], [true, true, true]);

    // ── 3. la SOURCE : la décision choisirVisuel (jamais le texte de la mention)
    H.v('3a. estEmprunt : autre-tirage oui ; substitut d\'un AUTRE set oui, d\'un set sans nom oui (doute), du MÊME set non ; du-set non', [
        estEmprunt({ visuel: 'autre-tirage', im: { set: 'B' }, set: { _id: 'A' } }), estEmprunt({ visuel: 'substitut', im: { set: 'B' }, set: { _id: 'A' } }), estEmprunt({ visuel: 'substitut', im: {}, set: { _id: 'A' } }),
        estEmprunt({ visuel: 'substitut', im: { set: 'A' }, set: { _id: 'A' } }), estEmprunt({ visuel: 'du-set', im: { set: 'A' }, set: { _id: 'A' } })], [true, true, true, false, false]);
    const regle = await regleEmbarquee();
    const set = { _id: 'Set-A', idExpansion: 100, code: 'SETA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } };
    const setB = { _id: 'Set-B', idExpansion: 200, code: 'SETB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } };
    const im = (setId, numero, n) => ({ set: setId, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const carte = (id, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images });
    // 4001 : visuel du set · 4002 : AUCUN visuel du set, celui de Set-B (autre-tirage) · 4003 : substitut du produit (scan de Set-B) · 4004 : substitut du MÊME set
    const docs = [carte(40, '020', [im('Set-A', '020', 'c40')]), carte(41, '021', [im('Set-B', '021', 'c41')]), carte(42, '022', []), carte(43, '023', [])];
    const lignes = [{ idProduct: 4001, carteId: 40, idExpansion: 100, numeroFiche: '020', slug: 'P4001-X020', slugSet: 'Set-A' },
        { idProduct: 4002, carteId: 41, idExpansion: 100, numeroFiche: '021', slug: 'P4002-X021', slugSet: 'Set-A' },
        { idProduct: 4003, carteId: 42, idExpansion: 100, numeroFiche: '022', slug: 'P4003-X022', slugSet: 'Set-A', visuelSubstitut: { ...im('Set-B', '022', 's42'), mention: 'Visuel de la carte d\'origine (Set B) — pas celui de ce produit' } },
        { idProduct: 4004, carteId: 43, idExpansion: 100, numeroFiche: '023', slug: 'P4004-X023', slugSet: 'Set-A', visuelSubstitut: { ...im('Set-A', '023', 's43'), mention: 'Visuel de la carte d\'origine (Set A) — pas celui de ce produit' } }];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets: [set, setB], docs, lignes, metacarte, regle });
    H.v('3b. la décision (sans sink) : natures des entrées, et la liste des emprunts (4002 autre-tirage, 4003 substitut d\'un autre set) — pas 4001 (du set), pas 4004 (substitut du même set)',
        [r.entrees.map(e => [e.idProduct, e.visuel]), r.emprunts], [[[4001, 'du-set'], [4002, 'autre-tirage'], [4003, 'substitut'], [4004, 'substitut']], [4002, 4003]]);
    H.v('3c. le dénominateur du décideur : 2 emprunts (1 autre-tirage, 1 substitut)', [r.denominateurs.emprunts, r.denominateurs.empruntsParNature], [2, { 'autre-tirage': 1, substitut: 1 }]);
    const cal = await calculer({ sets: [set, setB], docs, lignes, metacarte, regle });
    H.v('3d. calculer : la version marque exactement 4002 et 4003 ; le compte de l\'en-tête et le dénominateur concordent', [[4001, 4002, 4003, 4004].map(id => cal.version.empruntDe(id)), cal.version.comptes.emprunts, cal.comptes.empruntsProduits, cal.comptes.empruntsColonne], [[false, true, true, false], 2, 2, 2]);
    const trompeur = async a => { const x = await decider(a); return { ...x, denominateurs: { ...x.denominateurs, emprunts: x.denominateurs.emprunts + 1 } }; };
    const leveC = await calculer({ sets: [set, setB], docs, lignes, metacarte, regle, decider: trompeur }).then(() => 'passe', e => (/emprunts : produits empruntés par la décision 3 ≠ dans la colonne 2/.test(e.message) ? 'lève' : `AUTRE ${e.message}`));
    H.v('3e. si le décideur compte un emprunt de plus que la colonne : la construction LÈVE, avec les deux comptes', leveC, 'lève');
    // l'exclusion d'un produit emprunté : la colonne ne le porte plus (il n'a plus d'entrée), les autres ne bougent pas
    const calX = await calculer({ sets: [set, setB], docs, lignes, metacarte, regle, exclusions: new Map([[4002, 'visuel-faux']]) });
    H.v('3f. un emprunt EXCLU n\'a plus d\'entrée ni de marque ; 4003 reste marqué', [calX.version.empruntDe(4002), calX.version.empruntDe(4003), calX.version.comptes.emprunts, calX.version.entree(4002)], [null, true, 1, null]);

    // ── 4. le lecteur de la route : visuels.empruntDe, et le défaut FERMÉ des règles d'image
    const vis = creerVisuels({ cfg: { images: { hotesPublics: ['img.exemple'] } }, version: () => v });
    H.v('4a. visuels.empruntDe lit la version en place : true / false / null', [vis.empruntDe(5001), vis.empruntDe(5002), creerVisuels({ cfg: { images: { hotesPublics: ['x'] } }, version: () => va1 }).empruntDe(1), creerVisuels({ cfg: { images: { hotesPublics: ['x'] } }, version: () => null }).empruntDe(1)], [true, false, null, null]);
    H.v('4b. empruntOuInconnu : vrai si emprunté OU inconnu (null, version absente) ; faux SEULEMENT si la colonne dit faux', [EMP.empruntOuInconnu(v, 5001), EMP.empruntOuInconnu(v, 5002), EMP.empruntOuInconnu(va1, 1), EMP.empruntOuInconnu(null, 1), EMP.empruntOuInconnu({}, 1)], [true, false, true, true, true]);

    // ── 5. la règle G : un produit emprunté est un « reste » (sans visuel propre) — elle se tait
    const mes = { comparerPaire: () => [0, 1], scoresZones: () => ({ haut: 1, bas: 1, inliers: 100 }) };
    const top = [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]];
    const ctxG = (produits, extra = {}) => G.contexte({ groupe: {}, carte: { v1: [1], v2: [2], v3: [3] }, invisibles: {}, produits, ...extra });
    // la photo est REDRESSÉE (essai 1 sur 2) : la zone clé peut regarder, donc la règle 4 (les restes) est atteinte au lieu de « aucune carte redressée »
    const dec = (produits, emprunte, extra) => decisionRegleG({ ligne: { top, essai: 1 }, nEssais: 2, mesures: mes, contexteG: ctxG(produits, extra), ...(emprunte === undefined ? {} : { emprunte }) });
    H.v('5a. témoin : un produit non emprunté est affirmé comme avant', dec({ v1: [[500, 9.0]] }, () => false), { issue: 'affirmee', produit: 500, detail: 'un visuel, un produit' });
    H.v('5b. LE PRODUIT EMPRUNTÉ n\'est plus affirmé : la carte a un produit sans visuel propre, la règle se tait (null : la chaîne héritée décide)', dec({ v1: [[500, 9.0]] }, id => id === 500), null);
    const deux = dec({ v1: [[500, 9.0], [501, 9.0]] }, id => id === 501);
    H.v('5c. deux produits au même visuel dont un emprunté : jamais une réponse commune ; le reste bloque l\'affirmation de 500', [deux && deux.issue, deux && deux.produit], ['question', undefined]);
    H.v('5d. DÉFAUT FERMÉ : un emprunt inconnu (null) vaut emprunté', dec({ v1: [[500, 9.0]] }, () => null), null);
    const d5 = dec({ v1: [[500, 9.0]] }, () => false, { invisibles: { 1: [777] } });
    H.v('5e. un reste déjà connu du contexte est gardé (l\'amendement ajoute, ne remplace pas) : question, jamais affirmée', [d5 && d5.issue, d5 && d5.produit], ['question', undefined]);
    const brutCtx = ctxG({ v1: [[500, 9.0], [501, 9.0]] }), copie = JSON.stringify([...brutCtx.produits]) + JSON.stringify([...brutCtx.invisibles]);
    const amende = EMP.contexteSansEmprunts(brutCtx, id => id === 501);
    H.v('5f. le contexte d\'origine n\'est jamais modifié (produits et restes identiques) ; l\'amendé retire 501 des produits du visuel et le range parmi les restes de SES cartes', [JSON.stringify([...brutCtx.produits]) + JSON.stringify([...brutCtx.invisibles]) === copie, amende.produits.get('v1'), amende.invisibles.get(1)], [true, [[500, 9]], [501]]);
    H.v('5g. rien d\'emprunté : le MÊME objet de contexte est rendu (aucune copie inutile)', EMP.contexteSansEmprunts(brutCtx, () => false) === brutCtx, true);
    // la version en place par défaut
    E.vider();
    H.v('5h. sans version en place ni fonction fournie : aucun amendement (aucun visuel n\'est servi, rien n\'est emprunté), le comportement d\'avant', dec({ v1: [[500, 9.0]] }).issue, 'affirmee');
    E.installer(a1.finir(D));
    H.v('5i. avec une archive SANS la colonne : tout produit est « inconnu » donc emprunté — la règle se tait', dec({ v1: [[1, 9.0]] }), null);
    const bon = creerConstructeur({ emprunts: true }); bon.entree(brut(1)); bon.entree(brut(2)); bon.emprunt(2); bon.lien('Set-A', '1|001', [1]);
    E.installer(bon.finir(D));
    H.v('5j. avec une archive qui porte la colonne : le produit non emprunté est affirmé, l\'emprunté non', [dec({ v1: [[1, 9.0]] }).issue, dec({ v1: [[2, 9.0]] })], ['affirmee', null]);
    E.vider();

    // ── 6. basseDefinition à TROIS valeurs : true sous le seuil (largeur de l'original CONNUE), false au-dessus (connue), null seulement si la largeur est inconnue ; la règle d'image exigera === false
    const imL = (numero, n, w, extra = {}) => ({ ...im('Set-A', numero, n), w, ...extra });
    const docsB = [carte(60, '060', [imL('060', 'c60', 300)]), carte(61, '061', [imL('061', 'c61', 350)]), carte(62, '062', [imL('062', 'c62', 600)]), carte(63, '063', [{ ...imL('063', 'c63', 600), w: undefined }]),
        carte(64, '064', [imL('064', 'c64', 600, { basseDefinition: true })]), carte(65, '065', [imL('065', 'c65', 300, { basseDefinition: false })])];
    const lignesB = docsB.map((d, i) => ({ idProduct: 6000 + i, carteId: d._id, idExpansion: 100, numeroFiche: d.impressions[0].numero, slug: `P${6000 + i}-X`, slugSet: 'Set-A' }));
    const metaB = new Map(lignesB.map((l, i) => [l.idProduct, 9500 + i]));
    const rB = await decider({ sets: [set], docs: docsB, lignes: lignesB, metacarte: metaB, regle });
    H.v('6a. largeur connue sous le seuil : true ; = 350 : false ; 600 : false ; largeur inconnue : null (jamais false) ; un drapeau explicite du catalogue prime (true, false)', rB.entrees.map(e => [e.idProduct, e.basseDefinition]), [[6000, true], [6001, false], [6002, false], [6003, null], [6004, true], [6005, false]]);
    const calB = await calculer({ sets: [set], docs: docsB, lignes: lignesB, metacarte: metaB, regle });
    H.v('6b. la version chargée expose les trois valeurs telles quelles (entree(id).basseDefinition)', lignesB.map(l => calB.version.entree(l.idProduct)).map(e => e && e.basseDefinition), [true, false, false, null, true, false]);
    const wB = F.deserialiser(F.serialiser(calB.version));
    H.v('6c. aller-retour du fichier : mêmes trois valeurs', lignesB.map(l => wB.entree(l.idProduct).basseDefinition), [true, false, false, null, true, false]);

    H.bilan();
})().catch(x => { console.error('❌', x); process.exit(1); });

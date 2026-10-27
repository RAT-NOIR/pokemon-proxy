'use strict';
// ARCHIVE-4 — les marqueurs ÉCRITS par le catalogue (cartes_produits.marqueurs + marqueursPreuve) jusqu'au service : la décision les valide, l'archive (FORMAT 4) les porte, le lecteur les lit, le catalogue et les
// impressions les servent, la fusion (dérivé l'emporte) donne le champ de réponse. Une archive d'avant (formats 1 à 3) reste lisible : marqueurs écrits = null. Pas de base, pas de réseau.
const H = require('./_harnais');
const F = require('../chargeur/format');
const MQ = require('../identifier/marqueurs');
const { lireEntree } = require('../identifier/visuels');
const { creerConstructeur, rejugerEntrees } = require('../chargeur/version');
const { decider } = require('../chargeur/decision'); const { regleEmbarquee } = require('../chargeur/regle-site'); const { calculer } = require('../chargeur/calcul');

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const JN = [{ type: 'JUMBO', params: {} }, { type: 'NON_LEGAL', params: {} }];
const PREUVE = 'Cardmarket : pastille « Jumbo » ; TCGdex : variante jumbo';
const refuse = fn => { try { fn(); return null; } catch (x) { return x.name === 'FormatInvalide' ? x.motif : `AUTRE:${x.name}:${x.message}`; } };
const leve = fn => { try { fn(); return false; } catch { return true; } };
const D = new Date('2026-10-29T10:00:00.000Z');

(async () => {
    // ── 1. la lecture d'une LIGNE du catalogue (une seule fonction, partagée par la décision et les bancs)
    const e1 = MQ.ecritsDeLaLigne({ marqueurs: JN, marqueursPreuve: PREUVE });
    H.v('1a. deux marqueurs valides avec leur preuve : portés, sans libellé, sans écart', [e1.elements, e1.preuve, e1.invalides, e1.doublons, e1.trop, e1.sansPreuve], [JN, PREUVE, 0, 0, 0, 0]);
    H.v('1b. dans l\'ORDRE de la table (NON_LEGAL, JUMBO en entrée -> JUMBO, NON_LEGAL)', MQ.ecritsDeLaLigne({ marqueurs: [JN[1], JN[0]], marqueursPreuve: PREUVE }).elements, JN);
    const sp = MQ.ecritsDeLaLigne({ marqueurs: JN, marqueursPreuve: '  ' });
    H.v('1c. SANS preuve (vide, ou absente) : rien n\'est porté, les 2 éléments sont comptés « sans preuve »', [sp.elements, sp.sansPreuve, MQ.ecritsDeLaLigne({ marqueurs: JN }).elements], [null, 2, null]);
    const inv = MQ.ecritsDeLaLigne({ marqueurs: [{ type: 'FUTUR', params: {} }, JN[0], { type: 'WCD', params: { annee: 1800 } }, 7, null], marqueursPreuve: PREUVE });
    H.v('1d. éléments invalides (type hors liste, paramètre hors forme, non-objet) : écartés ET comptés (4), le valide reste', [inv.elements, inv.invalides], [[JN[0]], 4]);
    const dbl = MQ.ecritsDeLaLigne({ marqueurs: [JN[0], JN[0], JN[1]], marqueursPreuve: PREUVE });
    H.v('1e. un type en double : le second est compté, jamais réparé', [dbl.elements, dbl.doublons], [JN, 1]);
    const trop = MQ.ecritsDeLaLigne({ marqueurs: ['STAFF', 'LEAGUE', 'KFC', 'COSMO', 'SNOWFLAKE'].map(t => ({ type: t, params: {} })), marqueursPreuve: PREUVE });
    H.v('1f. plus de 4 éléments : rien n\'est porté, compté « trop »', [trop.elements, trop.trop], [null, 1]);
    H.v('1g. liste vide, absente, ou pas un tableau : rien de porté, rien de compté', [{}, { marqueurs: [] }, { marqueurs: 'JUMBO', marqueursPreuve: PREUVE }, { marqueurs: null }].map(l => { const r = MQ.ecritsDeLaLigne(l); return [r.elements, r.invalides, r.sansPreuve]; }), Array(4).fill([null, 0, 0]));
    H.v('1h. la preuve est RÉDUITE à ' + MQ.PREUVE_MAX + ' caractères', MQ.ecritsDeLaLigne({ marqueurs: JN, marqueursPreuve: 'x'.repeat(500) }).preuve.length, MQ.PREUVE_MAX);
    const coupee = MQ.ecritsDeLaLigne({ marqueurs: JN, marqueursPreuve: `${'a'.repeat(MQ.PREUVE_MAX - 1)} suite de la phrase` });
    H.v('1h2. la coupe tombe sur une espace : la preuve réduite est rognée, et l\'archive l\'ADMET (une entrée refusée à cause de sa preuve coupée ferait disparaître le produit)', [coupee.preuve.length, coupee.preuve === coupee.preuve.trim(), lireEntree(brut(8, { marqueurs: coupee.elements, marqueursPreuve: coupee.preuve })).ok], [MQ.PREUVE_MAX - 1, true, true]);
    // la fusion unique : un JUMBO écrit sans dérivé est servi ; un écrit contredisant le dérivé est compté
    H.v('1i. la fusion (dérivé + écrit) : un JUMBO écrit sans variante prouvée est servi avec ses libellés', MQ.fusionner(MQ.deriver({ variante: null, marques: null, slugSet: 'Set-A' }), JN).marqueurs.map(m => [m.type, m.libelle.fr]), [['JUMBO', 'Carte Jumbo'], ['NON_LEGAL', 'Non autorisée en tournoi']]);
    const ctr = MQ.marqueursDeLEntree({ variante: null, lien: 'https://www.cardmarket.com/en/Pokemon/Products/Singles/WCD-2018/Carte-WCD18X-001', marqueurs: [{ type: 'WCD', params: { annee: 2019 } }], marqueursPreuve: PREUVE });
    H.v('1j. marqueursDeLEntree (le MÊME calcul que le produit servi) : le dérivé WCD 2018 l\'emporte sur l\'écrit 2019, la contradiction est comptée', [ctr.marqueurs.map(m => [m.type, m.params.annee || null]), ctr.contradictions], [[['WCD', 2018], ['NON_LEGAL', null]], 1]);

    // ── 2. la validation d'entrée
    const ok = e => lireEntree(brut(7, e));
    const a = ok({ marqueurs: JN, marqueursPreuve: PREUVE });
    H.v('2a. une entrée avec ses marqueurs et sa preuve : admise, les deux champs sont portés', [a.ok, a.doc.marqueurs, a.doc.marqueursPreuve], [true, JN, PREUVE]);
    const b0 = ok({});
    H.v('2b. sans marqueurs : admise, les deux champs valent null (jamais [])', [b0.ok, b0.doc.marqueurs, b0.doc.marqueursPreuve], [true, null, null]);
    H.v('2c. REFUSÉES : type hors liste · paramètre hors forme · élément avec un champ en plus · liste vide · pas un tableau', [
        { marqueurs: [{ type: 'FUTUR', params: {} }], marqueursPreuve: PREUVE }, { marqueurs: [{ type: 'WCD', params: { annee: 1800 } }], marqueursPreuve: PREUVE },
        { marqueurs: [{ type: 'JUMBO', params: {}, extra: 1 }], marqueursPreuve: PREUVE }, { marqueurs: [], marqueursPreuve: PREUVE }, { marqueurs: 'JUMBO', marqueursPreuve: PREUVE }].map(x => ok(x).ok), Array(5).fill(false));
    H.v('2d. REFUSÉES : un type deux fois · hors de l\'ordre de la table · plus de 4 · sans preuve · preuve sans marqueurs · preuve trop longue', [
        { marqueurs: [JN[0], JN[0]], marqueursPreuve: PREUVE }, { marqueurs: [JN[1], JN[0]], marqueursPreuve: PREUVE },
        { marqueurs: ['STAFF', 'LEAGUE', 'KFC', 'COSMO', 'SNOWFLAKE'].map(t => ({ type: t, params: {} })), marqueursPreuve: PREUVE },
        { marqueurs: JN }, { marqueursPreuve: PREUVE }, { marqueurs: JN, marqueursPreuve: 'x'.repeat(MQ.PREUVE_MAX + 1) }].map(x => ok(x).ok), Array(6).fill(false));
    H.v('2e. un libellé reçu n\'est jamais repris (le champ reste {type, params})', ok({ marqueurs: MQ.fusionner(null, JN).marqueurs, marqueursPreuve: PREUVE }).doc.marqueurs, JN);

    // ── 3. le constructeur : la colonne
    const c = creerConstructeur({ emprunts: true, ecrits: true });
    c.entree(brut(5001, { marqueurs: JN, marqueursPreuve: PREUVE }));
    c.entree(brut(5002));
    c.entree(brut(5003, { marqueurs: [{ type: 'WCD', params: { annee: 2018, joueur: 'Magnus Pedersen' } }, JN[1]], marqueursPreuve: 'Bulbapedia : deck WCD 2018' }));
    const v = c.finir(D);
    H.v('3a. la version porte la colonne ; entree(id) rend les marqueurs écrits ou null', [v.colonneEcrits, v.entree(5001).marqueurs, v.entree(5001).marqueursPreuve, v.entree(5002).marqueurs, v.entree(5002).marqueursPreuve, v.entree(99999)],
        [true, JN, PREUVE, null, null, null]);
    H.v('3b. les params (annee, joueur) reviennent tels quels', v.entree(5003).marqueurs, [{ type: 'WCD', params: { annee: 2018, joueur: 'Magnus Pedersen' } }, JN[1]]);
    H.v('3c. les comptes de l\'en-tête : 2 entrées, 4 éléments, par type dans l\'ordre de la table', v.comptes.ecrits, { entrees: 2, elements: 4, parType: { JUMBO: 1, WCD: 1, NON_LEGAL: 2 } });
    H.v('3d. le rejugement des entrées passe', rejugerEntrees(v).ok, true);
    H.v('3e. sans l\'option `ecrits`, une entrée qui porte des marqueurs LÈVE (jamais perdue en silence)', leve(() => { const x = creerConstructeur({ emprunts: true }); x.entree(brut(1, { marqueurs: JN, marqueursPreuve: PREUVE })); }), true);
    const sans = creerConstructeur({ emprunts: true, ecrits: true }); sans.entree(brut(1));
    const vs = sans.finir(D);
    H.v('3f. aucun marqueur écrit : la colonne est écrite quand même (vide : « aucun » est une réponse), comptes à zéro', [vs.colonneEcrits, vs.comptes.ecrits], [true, { entrees: 0, elements: 0, parType: {} }]);
    const dup = creerConstructeur({ ecrits: true });
    dup.entree(brut(7001, { marqueurs: JN, marqueursPreuve: PREUVE })); dup.entree(brut(7001, { marqueurs: JN, marqueursPreuve: 'une autre phrase' }));      // même produit, même visuel, mêmes marqueurs
    dup.entree(brut(7002, { marqueurs: [JN[0]], marqueursPreuve: PREUVE })); dup.entree(brut(7002, { marqueurs: JN, marqueursPreuve: PREUVE }));              // même produit, même visuel, marqueurs DIFFÉRENTS
    const vd = dup.finir(D);
    H.v('3g. deux entrées du même produit : mêmes marqueurs -> gardés ; marqueurs différents -> AUCUN marqueur écrit (jamais « le dernier gagne »), compté', [vd.entree(7001).marqueurs, vd.entree(7002).marqueurs, dup.etat().ecritsContradictoires], [JN, null, 1]);

    // ── 4. le fichier : format 4
    const f4 = F.serialiser(v);
    H.v('4a. l\'en-tête annonce le FORMAT 4 (un lecteur de format 3 le refuse au lieu d\'ignorer des marqueurs qu\'il ne connaît pas)', [F.lireEntete(f4).format, F.FORMAT_ECRITS, [1, 2, 3].includes(F.lireEntete(f4).format)], [4, 4, false]);
    const w = F.deserialiser(f4);
    H.v('4b. aller-retour : mêmes entrées, mêmes comptes, colonne présente', [[5001, 5002, 5003].every(id => JSON.stringify(w.entree(id)) === JSON.stringify(v.entree(id))), w.comptes.ecrits, w.colonneEcrits], [true, v.comptes.ecrits, true]);
    H.vrai('4c. déterministe : deux sérialisations, les mêmes octets', F.serialiser(v).equals(f4));
    const f3 = F.serialiser((() => { const x = creerConstructeur({ emprunts: true }); x.entree(brut(5001)); return x.finir(D); })());
    const w3 = F.deserialiser(f3);
    H.v('4d. un fichier du format 3 (celui de la 28d) reste lisible : marqueurs écrits null, colonne absente, aucun compte inventé', [F.lireEntete(f3).format, w3.colonneEcrits, w3.entree(5001).marqueurs, w3.entree(5001).marqueursPreuve, w3.comptes.ecrits], [3, false, null, null, undefined]);
    const tout = creerConstructeur({ marquages: true, emprunts: true, ecrits: true }); tout.entree(brut(1, { marqueurs: JN, marqueursPreuve: PREUVE })); tout.entree(brut(2)); tout.melange(2); tout.emprunt(2); tout.jumeau({ idProduct: 1, idMetacard: 5, idExpansion: 1, numero: '1', tirage: 'intl' });
    const wt = F.deserialiser(F.serialiser(tout.finir(D)));
    H.v('4e. avec marquages, prix mélangés, emprunts et jumeaux : tout se relit, les colonnes ne se mêlent pas', [wt.colonneMarquages, wt.colonneMelange, wt.colonneJumeaux, wt.colonneEmprunts, wt.colonneEcrits, wt.prixMelange(2), wt.empruntDe(2), wt.entree(1).marqueurs], [true, true, true, true, true, true, true, JN]);
    // STRUCTURE : un fichier MENTEUR au hachage juste
    const corps = f4.subarray(0, f4.length - 32), ent = F.lireEntete(f4), S = F.sections(f4);
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    const sec = n => S.find(x => x.nom === n);
    H.v('4f. STRUCTURE : les bornes d\'un élément hors de la liste, un indice de preuve hors de la réserve : refusés (RESCELLÉ)', [
        refuse(() => F.deserialiser(retouche(b2 => b2.writeInt32LE(99, sec('ecr.fin').debut)))) !== null,
        refuse(() => F.deserialiser(retouche(b2 => b2.writeInt32LE(100000, sec('ecr.preuve').debut)))) !== null,
        refuse(() => F.deserialiser(retouche(b2 => b2.writeInt32LE(100000, sec('ecr.type').debut)))) !== null], [true, true, true]);
    const texteDe = (buf, idx) => { const o = F.sections(buf), off = o.find(x => x.nom === 'texte.off'), oc = o.find(x => x.nom === 'texte.octets'); const a = buf.readUInt32LE(off.debut + 4 * idx), z = buf.readUInt32LE(off.debut + 4 * (idx + 1)); return buf.subarray(oc.debut + a, oc.debut + z).toString('utf8'); };
    const typeDe = buf => texteDe(buf, buf.readInt32LE(sec('ecr.type').debut));
    H.v('4g. le type porté est bien un texte de la table (JUMBO en premier)', typeDe(f4), 'JUMBO');
    H.v('4h. STRUCTURE : un élément qui échoue à `valider` (type remplacé par un autre texte de la réserve, params incompatibles) : refusé', refuse(() => F.deserialiser(retouche(b2 => {
        // le premier élément (JUMBO) reçoit l'indice de texte de ses PARAMS (« {} » lu comme un type) : le type n'existe pas
        b2.writeInt32LE(b2.readInt32LE(sec('ecr.params').debut), sec('ecr.type').debut);
    }))), 'marqueurs écrits : un élément que la table refuse');
    H.v('4i. STRUCTURE : le compte de l\'en-tête doit être celui de la colonne ; un compte SANS colonne est refusé', [
        refuse(() => F.deserialiser(F.reecrireEntete(f4, { ...ent, comptes: { ...ent.comptes, ecrits: { ...ent.comptes.ecrits, elements: 9 } } }))),
        refuse(() => F.deserialiser(F.reecrireEntete(f3, { ...F.lireEntete(f3), comptes: { ...F.lireEntete(f3).comptes, ecrits: { entrees: 1, elements: 1, parType: { JUMBO: 1 } } } })))],
    ['marqueurs écrits : compte de l\'en-tête différent de celui de la colonne', 'marqueurs écrits : un compte sans colonne']);
    H.v('4j. le format est jugé par son NUMÉRO : un format 4 sans la section, un format 3 AVEC la section : refusés', [
        refuse(() => F.deserialiser(F.reecrireEntete(f4, { ...ent, sections: ent.sections.filter(x => !x.nom.startsWith('ecr.')) }))) !== null,
        refuse(() => F.deserialiser(F.reecrireEntete(f4, { ...ent, format: 3 }))) !== null], [true, true]);

    // ── 5. la décision : les marqueurs écrits validés, comptés, portés par l'entrée
    const regle = await regleEmbarquee();
    const set = { _id: 'Set-A', idExpansion: 100, code: 'SETA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } };
    const im = (numero, n) => ({ set: 'Set-A', numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const carte = (id, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images });
    const docs = [carte(40, '020', [im('020', 'c40')]), carte(41, '021', [im('021', 'c41')]), carte(42, '022', [im('022', 'c42')]), carte(43, '023', [im('023', 'c43')]), carte(44, '024', [])];
    const ligne = (idProduct, carteId, numero, extra = {}) => ({ idProduct, carteId, idExpansion: 100, numeroFiche: numero, slug: `P${idProduct}-X${numero}`, slugSet: 'Set-A', ...extra });
    const lignes = [
        ligne(4001, 40, '020', { marqueurs: JN, marqueursPreuve: PREUVE }),                                                                           // portés
        ligne(4002, 41, '021'),                                                                                                                       // rien
        ligne(4003, 42, '022', { marqueurs: [{ type: 'FUTUR', params: {} }, JN[0]], marqueursPreuve: PREUVE }),                                       // 1 invalide écarté, 1 porté
        ligne(4004, 43, '023', { marqueurs: JN }),                                                                                                    // sans preuve : rien de porté
        ligne(4005, 44, '024', { marqueurs: JN, marqueursPreuve: PREUVE })];                                                                         // pas d'image : pas d'entrée
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets: [set], docs, lignes, metacarte, regle });
    const parId = new Map(r.entrees.map(e => [e.idProduct, e]));
    H.v('5a. les entrées portent les marqueurs écrits validés (4001 deux, 4003 un seul), pas les autres', [4001, 4002, 4003, 4004].map(id => parId.get(id) && [parId.get(id).marqueurs ?? null, parId.get(id).marqueursPreuve ?? null]),
        [[JN, PREUVE], [null, null], [[JN[0]], PREUVE], [null, null]]);
    const dm = r.denominateurs.marqueursEcrits;
    H.v('5b. le dénominateur : 4 lignes à marqueurs, 2 produits qui en portent (4001, 4003), 3 éléments, 1 invalide, 2 éléments sans preuve (4004), 1 ligne sans entrée (4005)', [dm.lignes, dm.entrees, dm.elements, dm.invalides, dm.sansPreuve, dm.sansEntree], [4, 2, 3, 1, 2, 1]);
    H.v('5c. par type', dm.parType, { JUMBO: 2, NON_LEGAL: 1 });
    const calc = await calculer({ sets: [set], docs, lignes, metacarte, regle });
    H.v('5d. calculer : la version porte les marqueurs, l\'en-tête et le dénominateur concordent', [calc.version.entree(4001).marqueurs, calc.version.comptes.ecrits, calc.comptes.marqueursEcrits.entrees], [JN, { entrees: 2, elements: 3, parType: { JUMBO: 2, NON_LEGAL: 1 } }, 2]);
    const trompeur = async x => { const y = await decider(x); return { ...y, denominateurs: { ...y.denominateurs, marqueursEcrits: { ...y.denominateurs.marqueursEcrits, entrees: y.denominateurs.marqueursEcrits.entrees + 1 } } }; };
    const leveC = await calculer({ sets: [set], docs, lignes, metacarte, regle, decider: trompeur }).then(() => 'passe', e => (/marqueurs écrits : produits décidés 3 ≠ dans la colonne 2/.test(e.message) ? 'lève' : `AUTRE ${e.message}`));
    H.v('5e. si le décideur compte une entrée de plus que la colonne : la construction LÈVE, avec les deux comptes', leveC, 'lève');
    const calX = await calculer({ sets: [set], docs, lignes, metacarte, regle, exclusions: new Map([[4001, 'visuel-faux']]) });
    H.v('5f. un produit EXCLU n\'a plus d\'entrée donc plus de marqueurs ; 4003 garde les siens', [calX.version.entree(4001), calX.version.entree(4003).marqueurs, calX.version.comptes.ecrits.entrees], [null, [JN[0]], 1]);
    const derive = await decider({ sets: [set], docs, lignes: [ligne(4010, 40, '020', { marqueurs: [{ type: 'WCD', params: { annee: 2019 } }], marqueursPreuve: PREUVE, slugSet: 'Set-A' })], metacarte: new Map([[4010, 1]]), regle });
    H.v('5g. une contradiction avec le dérivé est comptée à la construction (0 ici : Set-A ne dérive aucun WCD)', derive.denominateurs.marqueursEcrits.contradictions, 0);

    // ── 6. le service : la ligne du catalogue et les impressions portent les marqueurs de l'archive, la fusion donne le champ de réponse
    const db = require('../db'), { creerCatalogue } = require('../identifier/catalogue'), { creerVisuels } = require('../identifier/visuels'), { construireProduit } = require('../identifier/produit');
    const { lireConfig } = require('../config');
    const cfg = lireConfig({});
    const docsB = { catalogue_produits: [{ idProduct: 5001, name: 'Pikachu [Jumbo]', idMetacard: 77 }, { idProduct: 5002, name: 'Pikachu', idMetacard: 77 }], numeros_cartes: [{ idProduct: 5001, slugSet: 'Set-A', codeSet: 'SETA', numero: '1' }, { idProduct: 5002, slugSet: 'Set-A', codeSet: 'SETA', numero: '1' }], guide_prix: [] };
    const colReelle = db.col;
    db.col = nom => ({ find: () => ({ toArray: async () => docsB[nom] || [] }) });
    let table;
    try {
        const vis = creerVisuels({ cfg, version: () => w });
        table = await creerCatalogue({ cfg, visuels: vis }).lire([5001, 5002]);
    } finally { db.col = colReelle; }
    H.v('6a. catalogue.lire : la ligne porte les marqueurs et la preuve de l\'archive (null sans)', [table.get(5001).marqueurs, table.get(5001).marqueursPreuve, table.get(5002).marqueurs, table.get(5002).marqueursPreuve], [JN, PREUVE, null, null]);
    const p1 = construireProduit(table.get(5001), { langueInterface: 'fr', cfg }), p2 = construireProduit(table.get(5002), { langueInterface: 'fr', cfg });
    H.v('6b. le Produit servi : le champ marqueurs est la FUSION (JUMBO et NON_LEGAL, libellés) ; variante et marques ne bougent pas ; null sans marqueur ni dérivé', [p1.marqueurs.map(m => [m.type, m.libelle.fr, m.libelle.en]), p1.variante, p1.marques, p2.marqueurs],
        [[['JUMBO', 'Carte Jumbo', 'Jumbo card'], ['NON_LEGAL', 'Non autorisée en tournoi', 'Not tournament legal']], null, null, null]);
    const cm = creerConstructeur({ ecrits: true }); cm.entree(brut(6001, { idMetacard: 88, numero: '1', marqueurs: JN, marqueursPreuve: PREUVE })); cm.entree(brut(6002, { idMetacard: 88, numero: '2' }));
    const vm = cm.finir(D);
    db.col = nom => ({ find: () => ({ toArray: async () => [] }) });
    let ims; try { ims = await creerVisuels({ cfg, version: () => vm }).impressions(88); } finally { db.col = colReelle; }
    H.v('6d. les impressions d\'une métacarte portent leurs marqueurs écrits et leur preuve', ims.map(i => [i.idProduct, i.marqueurs ?? null, i.marqueursPreuve ?? null]), [[6001, JN, PREUVE], [6002, null, null]]);
    const pi = construireProduit({ idProduct: 6001, nomCardmarket: 'X', set: { slug: 'Set-A', nom: 'Set A' }, impressions: ims }, { langueInterface: 'fr', cfg });
    H.v('6e. l\'impression SERVIE porte la fusion (JUMBO, NON_LEGAL) ; celle sans marqueur : null', pi.impressions.map(i => i.marqueurs && i.marqueurs.map(m => m.type)), [['JUMBO', 'NON_LEGAL'], null]);

    // ── 7. le chargeur : une version sans la colonne des marqueurs écrits ne remplace jamais une version qui l'a ; le journal imprime ce que l'archive porte
    const E = require('../chargeur/etat'); const { creerChargeur } = require('../chargeur/chargeur'); const { depuisPaquet, StructureInvalide } = require('../chargeur/version');
    const avecLien = (opts, date, entrees) => { const x = creerConstructeur(opts); for (const e of entrees) x.entree(e); x.lien('Set-A', '1|001', [entrees[0].idProduct]); return x.finir(new Date(date)); };
    const v3 = avecLien({ emprunts: true }, '2026-10-29T08:00:00.000Z', [brut(1)]);
    const v4 = avecLien({ emprunts: true, ecrits: true }, '2026-10-29T09:00:00.000Z', [brut(1, { marqueurs: JN, marqueursPreuve: PREUVE })]);
    const v3Neuve = avecLien({ emprunts: true }, '2026-10-29T10:00:00.000Z', [brut(1)]);
    const comptesDe = x => ({ sets: 1, cartes: 1, produits: 1, catalogue: 1, visuels: x.comptes.visuels, refusees: 0, motifs: {}, doublons: 0, doublonsContradictoires: 0, fichesLiees: x.comptes.fichesLiees, setsAvecLiens: x.comptes.setsAvecLiens, produitsLies: x.comptes.produitsLies });
    let aCharger = null; const journal = [];
    const ch = creerChargeur({ catalogue: async () => new Map([[1, 1]]), executer: async () => ({ ok: true, version: aCharger, comptes: comptesDe(aCharger) }), journal: m => journal.push(m) });
    E.vider();
    try {
        aCharger = v3; const r1 = await ch.charger();
        H.v('7a. sans version en place, une archive d\'avant (format 3) s\'installe, et le journal DIT que les marqueurs écrits ne sont pas servis', [r1.ok, E.version() === v3, journal.some(m => /PAS la colonne des marqueurs écrits/.test(m))], [true, true, true]);
        journal.length = 0; aCharger = v4; const r2 = await ch.charger();
        H.v('7b. une archive du format 4 la remplace, et le journal imprime les marqueurs portés, par type', [r2.ok, E.version() === v4, journal.some(m => /marqueurs écrits 1 produit\(s\), 2 élément\(s\) \(JUMBO 1, NON_LEGAL 1\)/.test(m))], [true, true, true]);
        journal.length = 0; aCharger = v3Neuve; const r3 = await ch.charger();
        H.v('7c. une version plus récente MAIS sans la colonne des marqueurs écrits ne remplace pas celle qui l\'a (la version en place est gardée)', [r3.ok, E.version() === v4, journal.some(m => /colonne des marqueurs écrits alors que celle en place l'a/.test(m))], [false, true, true]);
    } finally { E.vider(); }
    // la structure par le paquet (voie « fil »)
    const paq = v.paquet().donnees, casse = patch => { const d = { ...paq, ecr: { ...paq.ecr } }; patch(d); try { depuisPaquet(d); return null; } catch (x) { return x instanceof StructureInvalide ? x.motif : `AUTRE:${x.name}`; } };
    H.v('7d. paquet : le paquet intact est accepté ; des colonnes de marqueurs de longueur différente, une borne hors liste : refusés', [casse(() => { }), /marqueurs écrits/.test(casse(d => { d.ecr.deb = d.ecr.deb.subarray(1); }) || ''), /marqueurs écrits/.test(casse(d => { d.ecr.type = d.ecr.type.subarray(1); }) || '')], [null, true, true]);

    H.bilan();
})().catch(x => { console.error('❌', x); process.exit(1); });

'use strict';
// JUMBO-VISUEL (27/10) — plus aucun visuel d'un AUTRE tirage affiché sans le dire.
//   · la liste du catalogue (JUMBO lus contre le scan de leur fiche) entre par UN fichier de l'API, jugé par une garde écrite par ce qu'elle AUTORISE (v2/chargeur/jumbos-visuel.js) ;
//   · un JUMBO identique à sa carte est un EMPRUNT (colonne des emprunts) servi avec le bandeau JUMBO, SANS mention ; un JUMBO différent ou illisible reste CANDIDAT (marqueurs, partages, groupe)
//     mais AUCUN visuel ne lui est servi (colonne des masqués, format 5) ; jamais d'exclusion de l'archive ;
//   · les 69 fiches Pokémon de Base Set (scans « Édition 1 ») portent la mention « Visuel d'un autre tirage », sauf un produit PROUVÉ 1re édition ; l'identification ne change pas.
// Pas de base, pas de réseau : sources factices, listes FABRIQUÉES dans le dossier temporaire.
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const J = require('../chargeur/jumbos-visuel');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'jumbo-visuel-'));
let n = 0;
const ecrire = c => { const p = path.join(dossier, `liste-${++n}.json`); fs.writeFileSync(p, typeof c === 'string' ? c : JSON.stringify(c)); return p; };
const SHA = 'a'.repeat(64);
const PRODUITS = [{ idProduct: 101, verdict: 'identique' }, { idProduct: 102, verdict: 'identique' }, { idProduct: 201, verdict: 'different' }, { idProduct: 202, verdict: 'illisible' }, { idProduct: 203, verdict: 'fiche-fausse' }];
const liste = (extra = {}, produits = PRODUITS) => ({ decision: 'décision de banc (liste fabriquée)', le: '2026-10-27', source: 'chemin de documentation', listeLe: '2026-10-27T07:24:27.126Z', sha256Source: SHA, produits, ...extra });
const refus = f => { const r = J.lireFichierJumbos(typeof f === 'string' ? f : ecrire(f)); return r.ok ? null : r.raison; };

(async () => {
    // ── 1. la GARDE du fichier : écrite par ce qu'elle AUTORISE
    const bon = J.lireFichierJumbos(ecrire(liste()));
    H.v('1a. une liste conforme est lue : 5 produits, deux classes (2 emprunts, 3 sans visuel), la décision, la date, la date et l\'empreinte de la liste source',
        [bon.ok, bon.produits.length, bon.comptes, bon.decision, bon.le, bon.listeLe, bon.sha256Source], [true, 5, { emprunt: 2, sansVisuel: 3, parVerdict: { identique: 2, different: 1, illisible: 1, 'fiche-fausse': 1 } }, 'décision de banc (liste fabriquée)', '2026-10-27', '2026-10-27T07:24:27.126Z', SHA]);
    H.v('1b. la classe vient du verdict, et d\'eux seuls : identique -> emprunt ; différent, illisible, fiche-fausse -> sans-visuel (un doute n\'est jamais un emprunt)',
        [...bon.classes].sort((a, b) => a[0] - b[0]), [[101, 'emprunt'], [102, 'emprunt'], [201, 'sans-visuel'], [202, 'sans-visuel'], [203, 'sans-visuel']]);
    H.v('1c. l\'empreinte du fichier lu est celle de ses octets', bon.sha256, crypto.createHash('sha256').update(fs.readFileSync(ecrire(liste()))).digest('hex'));
    H.v('1d. les verdicts fermés sont exactement quatre', J.VERDICTS, ['identique', 'different', 'illisible', 'fiche-fausse']);
    const REFUS = [
        ['aucun fichier nommé', null], ['fichier introuvable', path.join(dossier, 'absent.json')], ['fichier vide', ecrire('')], ['JSON illisible', ecrire('{')],
        ['pas un objet', ecrire('[]')], ['clé inconnue à la racine', liste({ extra: 1 })], ['decision absente', (() => { const l = liste(); delete l.decision; return l; })()], ['decision vide', liste({ decision: '  ' })],
        ['date `le` invalide', liste({ le: '2026-13-40' })], ['date `le` mal formée', liste({ le: '27/10/2026' })], ['listeLe absente', (() => { const l = liste(); delete l.listeLe; return l; })()],
        ['listeLe pas une date', liste({ listeLe: 'hier' })], ['listeLe sans heure', liste({ listeLe: '2026-10-27' })], ['sha256Source absent', (() => { const l = liste(); delete l.sha256Source; return l; })()],
        ['sha256Source trop court', liste({ sha256Source: 'abc' })], ['sha256Source en majuscules', liste({ sha256Source: 'A'.repeat(64) })], ['source pas un texte', liste({ source: 4 })],
        ['produits absent', (() => { const l = liste(); delete l.produits; return l; })()], ['produits vide', liste({}, [])], ['produits pas un tableau', liste({ produits: {} })],
        ['produit pas un objet', liste({}, [7])], ['produit : clé inconnue', liste({}, [{ idProduct: 1, verdict: 'identique', x: 1 }])], ['idProduct non entier', liste({}, [{ idProduct: 1.5, verdict: 'identique' }])],
        ['idProduct nul', liste({}, [{ idProduct: 0, verdict: 'identique' }])], ['idProduct en texte', liste({}, [{ idProduct: '5', verdict: 'identique' }])],
        ['verdict hors liste', liste({}, [{ idProduct: 1, verdict: 'sans-doute' }])], ['verdict absent', liste({}, [{ idProduct: 1 }])], ['verdict null', liste({}, [{ idProduct: 1, verdict: null }])],
        ['idProduct en double (même verdict)', liste({}, [{ idProduct: 1, verdict: 'identique' }, { idProduct: 1, verdict: 'identique' }])],
        ['idProduct en double (deux verdicts)', liste({}, [{ idProduct: 1, verdict: 'identique' }, { idProduct: 1, verdict: 'different' }])],
        ['plus de 5000 produits', liste({}, Array.from({ length: 5001 }, (_, i) => ({ idProduct: i + 1, verdict: 'identique' })))]];
    const lesRefus = REFUS.map(([nom, f]) => [nom, typeof f === 'string' || f === null ? refus(f) : refus(f)]);
    H.v('1e. REFUSÉS, avec leur raison (aucun ne passe) : ' + REFUS.length + ' formes', lesRefus.filter(([, r]) => r === null).map(([nom]) => nom), []);
    H.vrai('1f. chaque refus porte une raison lisible', lesRefus.every(([, r]) => typeof r === 'string' && r.length > 8));
    // la garde de la Map reçue (celle qui entre dans la décision) : écrite par ce qu'elle autorise aussi
    H.v('1g. une Map valide est admise ; vide, mal typée, classe inconnue, id non entier : refusées',
        [J.jugerClasses(bon.classes), J.jugerClasses(new Map()), J.jugerClasses([[1, 'emprunt']]), J.jugerClasses(new Map([[1, 'autre']])), J.jugerClasses(new Map([[1.5, 'emprunt']])), J.jugerClasses(new Map([[0, 'emprunt']])), J.jugerClasses(null)].map(r => r === null),
        [true, false, false, false, false, false, false]);
    // la garde sœur des exclusions (même forme, copiée) lève sur une date impossible alors qu'elle promet de ne jamais lever : trouvé en écrivant 1e
    const X = require('../chargeur/exclusions');
    let leveX = false, rX = null; try { rX = X.lireFichierExclusions(ecrire({ decision: 'd', le: '2026-13-40', produits: [{ idProduct: 5, motif: 'visuel-faux' }] })); } catch { leveX = true; }
    H.v('1h. la garde des exclusions REFUSE une date impossible (2026-13-40) au lieu de lever', [leveX, rX && rX.ok], [false, false]);

    // ── 2. la validation d'entrée : un JUMBO emprunté s'affiche SANS mention (le bandeau JUMBO la remplace) ; tout autre emprunt sans mention reste refusé
    const { lireEntree } = require('../identifier/visuels');
    const MQ = require('../identifier/marqueurs');
    const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
        idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
    const JN = [{ type: 'JUMBO', params: {} }, { type: 'NON_LEGAL', params: {} }];
    const PREUVE = 'Cardmarket : pastille « Jumbo » ; TCGdex : variante jumbo';
    const emprunteJumbo = (id, o = {}) => brut(id, { visuel: 'autre-tirage', marqueurs: JN, marqueursPreuve: PREUVE, ...o });
    H.v('2a. un JUMBO (marqueur écrit) au visuel `autre-tirage` SANS mention : admis (CONTRAT §6 : le bandeau dit ce qu\'il est)', [lireEntree(emprunteJumbo(7)).ok, lireEntree(emprunteJumbo(7)).doc.mention], [true, null]);
    H.v('2b. un JUMBO dérivé de la variante prouvée (`jumbo`) : admis de même', lireEntree(brut(7, { visuel: 'autre-tirage', variante: 'jumbo' })).ok, true);
    H.v('2c. REFUSÉS sans mention : `autre-tirage` sans JUMBO · `substitut` d\'un JUMBO · un autre marqueur écrit (STAFF) · la preuve manquante (le marqueur écrit n\'est pas fusionné)', [
        brut(7, { visuel: 'autre-tirage' }), emprunteJumbo(7, { visuel: 'substitut' }), brut(7, { visuel: 'autre-tirage', marqueurs: [{ type: 'STAFF', params: {} }], marqueursPreuve: PREUVE }),
        emprunteJumbo(7, { marqueursPreuve: null })].map(e => lireEntree(e).ok), [false, false, false, false]);
    H.v('2d. un JUMBO avec une mention : toujours admis (la mention est gardée)', [lireEntree(emprunteJumbo(7, { mention: 'Visuel de la même carte' })).ok, lireEntree(emprunteJumbo(7, { mention: 'Visuel de la même carte' })).doc.mention], [true, 'Visuel de la même carte']);
    H.v('2e. le WCD empruntée sans mention reste admis (l\'exception du §6 n\'a pas bougé)', lireEntree(brut(7, { visuel: 'autre-tirage', lien: 'https://www.cardmarket.com/en/Pokemon/Products/Singles/WCD-2018/Carte-WCD18X-001' })).ok, true);

    // ── 3. le constructeur et la COLONNE DES MASQUÉS (format 5) : les produits dont aucun visuel n'est servi ; ils restent des entrées (marqueurs, partages, groupe), jamais exclus
    const F = require('../chargeur/format'), V = require('../chargeur/version');
    const D = new Date('2026-10-29T10:00:00.000Z');
    const fabrique = (opts = { marquages: true, emprunts: true, ecrits: true, masques: true }) => {
        const c = V.creerConstructeur(opts);
        c.entree(brut(5001, { idMetacard: 77 }));                                                  // la carte normale
        c.entree(emprunteJumbo(5002, { idMetacard: 77 })); c.emprunt(5002);                        // un JUMBO identique : emprunté, servi avec bandeau
        c.entree(emprunteJumbo(5003, { idMetacard: 77 })); c.emprunt(5003); if (opts.masques) c.masque(5003);     // un JUMBO différent : emprunté ET masqué
        c.entree(brut(5004));                                                                      // un autre produit
        return c;
    };
    const v5 = fabrique().finir(D);
    H.v('3a. la version porte la colonne : masqueDe vrai pour le masqué, faux pour les autres entrées, null pour un produit sans entrée', [v5.colonneMasques, v5.masqueDe(5003), v5.masqueDe(5002), v5.masqueDe(5001), v5.masqueDe(99999), v5.masqueDe('x')], [true, true, false, false, null, null]);
    H.v('3b. le masqué reste une ENTRÉE complète (marqueurs, visuel de la fiche) et il est emprunté ; les comptes de l\'en-tête le disent', [v5.entree(5003).marqueurs, v5.entree(5003).vignette.cle, v5.empruntDe(5003), v5.comptes.masques, v5.comptes.emprunts, v5.comptes.visuels], [JN, 'vignettes/5003.webp', true, 1, 2, 4]);
    const sansOption = fabrique({ marquages: true, emprunts: true, ecrits: true });
    H.v('3c. sans l\'option `masques`, la colonne n\'existe pas : masqueDe vaut null (on ne sait pas, jamais « non masqué »)', [sansOption.finir(D).colonneMasques, sansOption.finir(D).masqueDe(5003)], [false, null]);
    const leve = f => { try { f(); return null; } catch (e) { return e.message; } };
    H.v('3d. `masque()` sans l\'option LÈVE ; un masqué NON emprunté LÈVE à la fin (un masqué est toujours emprunté) ; un id non entier LÈVE', [
        /sans colonne des masqués/.test(leve(() => V.creerConstructeur({ emprunts: true }).masque(5))),
        /masqué.*emprunt/.test(leve(() => { const c = V.creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true }); c.entree(brut(1)); c.masque(1); c.finir(D); })),
        /idProduct entier positif/.test(leve(() => V.creerConstructeur({ masques: true, emprunts: true }).masque(0)))], [true, true, true]);
    H.v('3e. l\'option `masques` exige les emprunts (le masqué est un emprunté) : refusée sans eux', /emprunts/.test(leve(() => V.creerConstructeur({ masques: true })) || ''), true);
    const sansEntree = V.creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true });
    sansEntree.entree(brut(1)); sansEntree.emprunt(1); sansEntree.masque(1); sansEntree.masque(777); sansEntree.emprunt(777);
    const vSansEntree = sansEntree.finir(D);
    H.v('3f. un masqué sans entrée gardée (refusée, exclue) n\'entre pas dans la colonne : la marque suit l\'ENTRÉE', [vSansEntree.comptes.masques, vSansEntree.masqueDe(1), vSansEntree.masqueDe(777)], [1, true, null]);

    // ── 4. le fichier : format 5
    const refuse = fn => { try { fn(); return null; } catch (x) { return x.name === 'FormatInvalide' ? x.motif : `AUTRE:${x.name}:${x.message}`; } };
    const f5 = F.serialiser(v5);
    H.v('4a. l\'en-tête annonce le FORMAT 5 (un lecteur de format 4 le refuse au lieu de servir à un JUMBO différent le scan de la carte normale)', [F.lireEntete(f5).format, F.FORMAT_MASQUES, [1, 2, 3, 4].includes(F.lireEntete(f5).format)], [5, 5, false]);
    const w5 = F.deserialiser(f5);
    H.v('4b. aller-retour : mêmes entrées, mêmes comptes, la colonne est relue (masqués, emprunts, marqueurs écrits)', [[5001, 5002, 5003, 5004].every(id => JSON.stringify(w5.entree(id)) === JSON.stringify(v5.entree(id))), w5.comptes.masques, w5.colonneMasques, [5001, 5002, 5003, 5004].map(id => w5.masqueDe(id)), [5001, 5002, 5003, 5004].map(id => w5.empruntDe(id))],
        [true, 1, true, [false, false, true, false], [false, true, true, false]]);
    H.vrai('4c. déterministe : deux sérialisations, les mêmes octets', F.serialiser(v5).equals(f5));
    const v4 = fabrique({ marquages: true, emprunts: true, ecrits: true }).finir(D);
    const f4 = F.serialiser(v4), w4 = F.deserialiser(f4);
    H.v('4d. un fichier du format 4 (la candidate du 29/10) reste lisible : colonne absente, masqueDe null partout (jamais « non masqué »), aucun compte inventé', [F.lireEntete(f4).format, w4.colonneMasques, w4.masqueDe(5003), w4.masqueDe(5001), w4.comptes.masques], [4, false, null, null, undefined]);
    const corps = f5.subarray(0, f5.length - 32), ent = F.lireEntete(f5), S = F.sections(f5);
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    const sec = nom => S.find(x => x.nom === nom);
    H.v('4e. STRUCTURE (RESCELLÉ, hachage juste) : un masqué sans entrée · un masqué non emprunté · des identifiants non croissants : refusés', [
        refuse(() => F.deserialiser(retouche(b2 => b2.writeInt32LE(99999, sec('msq.produits').debut)))),
        refuse(() => F.deserialiser(retouche(b2 => b2.writeInt32LE(5001, sec('msq.produits').debut))))],
        ['masqués : un produit marqué n\'a pas d\'entrée dans l\'archive', 'masqués : un produit masqué n\'est pas dans la colonne des emprunts']);
    const deux = (() => { const c = V.creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true }); for (const id of [5001, 5002]) { c.entree(emprunteJumbo(id)); c.emprunt(id); c.masque(id); } return c.finir(D); })();
    const f5b = F.serialiser(deux), S2 = F.sections(f5b), corps2 = f5b.subarray(0, f5b.length - 32);
    const b2x = Buffer.from(corps2); const o = S2.find(x => x.nom === 'msq.produits').debut; const a1 = b2x.readInt32LE(o), a2 = b2x.readInt32LE(o + 4); b2x.writeInt32LE(a2, o); b2x.writeInt32LE(a1, o + 4);
    H.v('4f. STRUCTURE : deux masqués dans le désordre : refusé', refuse(() => F.deserialiser(F.sceller(b2x))), 'masqués : identifiants non strictement croissants ou non positifs');
    H.v('4g. STRUCTURE : le compte de l\'en-tête doit être celui de la colonne ; un compte SANS colonne est refusé', [
        refuse(() => F.deserialiser(F.reecrireEntete(f5, { ...ent, comptes: { ...ent.comptes, masques: 9 } }))),
        refuse(() => F.deserialiser(F.reecrireEntete(f4, { ...F.lireEntete(f4), comptes: { ...F.lireEntete(f4).comptes, masques: 1 } })))],
        ['masqués : compte de l\'en-tête différent de celui de la colonne', 'masqués : un compte sans colonne']);
    H.v('4h. le format est jugé par son NUMÉRO : un format 5 sans la section, un format 4 AVEC la section, un format 5 sans la colonne des emprunts : refusés', [
        refuse(() => F.deserialiser(F.reecrireEntete(f5, { ...ent, sections: ent.sections.filter(x => !x.nom.startsWith('msq.')) }))) !== null,
        refuse(() => F.deserialiser(F.reecrireEntete(f5, { ...ent, format: 4 }))) !== null,
        refuse(() => F.deserialiser(F.reecrireEntete(f5, { ...ent, sections: ent.sections.filter(x => !x.nom.startsWith('emp.')) }))) !== null], [true, true, true]);
    H.v('4i. avec tous les autres facultatifs (jumeaux, prix mélangés) : tout se relit, les colonnes ne se mêlent pas', (() => {
        const c = V.creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true }); c.entree(emprunteJumbo(1)); c.emprunt(1); c.masque(1); c.entree(brut(2)); c.melange(2); c.jumeau({ idProduct: 1, idMetacard: 5, idExpansion: 1, numero: '1', tirage: 'intl' });
        const w = F.deserialiser(F.serialiser(c.finir(D))); return [w.colonneMarquages, w.colonneMelange, w.colonneJumeaux, w.colonneEmprunts, w.colonneEcrits, w.colonneMasques, w.masqueDe(1), w.prixMelange(2)];
    })(), [true, true, true, true, true, true, true, true]);
    const paq = v5.paquet().donnees;
    H.v('4j. la voie « fil » : le paquet porte la colonne, et sa structure est jugée (un masqué sans entrée : refusé)', [!!paq.msq, (() => { try { V.depuisPaquet({ ...paq, msq: { produits: Int32Array.from([99999]) }, comptes: { ...paq.comptes, masques: 1 } }); return null; } catch (x) { return x.motif; } })(), V.depuisPaquet(paq).masqueDe(5003)],
        [true, 'masqués : un produit marqué n\'a pas d\'entrée dans l\'archive', true]);

    // ── 5. le SERVICE : aucun visuel n'est servi à un masqué ; l'entrée, elle, reste lue (marqueurs, partages, groupe)
    const db = require('../db'), { creerCatalogue } = require('../identifier/catalogue'), { creerVisuels } = require('../identifier/visuels'), { construireProduit } = require('../identifier/produit');
    const { lireConfig } = require('../config'); const cfg = lireConfig({});
    const docsB = { catalogue_produits: [5001, 5002, 5003].map(id => ({ idProduct: id, name: `Pikachu ${id}`, idMetacard: 77 })), numeros_cartes: [5001, 5002, 5003].map(id => ({ idProduct: id, slugSet: 'Set-A', codeSet: 'SETA', numero: '1' })), guide_prix: [] };
    const colReelle = db.col; db.col = nom => ({ find: () => ({ toArray: async () => docsB[nom] || [] }) });
    let r5, table, ims;
    try {
        const vis = creerVisuels({ cfg, version: () => w5 });
        r5 = [await vis.resoudre(5001), await vis.resoudre(5002), await vis.resoudre(5003)];
        table = await creerCatalogue({ cfg, visuels: vis }).lire([5001, 5002, 5003]);
        ims = await vis.impressions(77);
    } finally { db.col = colReelle; }
    H.v('5a. resoudre : la carte normale et le JUMBO identique ont leur visuel (le JUMBO SANS mention) ; le masqué n\'en a AUCUN (null, jamais le scan de la normale)', [r5[0] && r5[0].url, r5[1] && r5[1].url, r5[1] && r5[1].mention, r5[2]],
        ['https://' + cfg.images.hotesPublics[0] + '/vignettes/5001.webp', 'https://' + cfg.images.hotesPublics[0] + '/vignettes/5002.webp', null, null]);
    H.v('5b. catalogue.lire : le masqué a une ligne COMPLÈTE (marqueurs JUMBO + NON_LEGAL) mais visuel et mention null ; le JUMBO identique a visuel + marqueurs, sans mention', [
        [5001, 5002, 5003].map(id => table.get(id).visuel !== null), table.get(5003).visuelMention, table.get(5002).visuelMention, table.get(5003).marqueurs, table.get(5001).marqueurs], [[true, true, false], null, null, JN, null]);
    const pM = construireProduit(table.get(5003), { langueInterface: 'fr', cfg }), pJ = construireProduit(table.get(5002), { langueInterface: 'fr', cfg });
    H.v('5c. le Produit servi : le masqué n\'a ni visuel ni mention mais le bandeau JUMBO ; le JUMBO identique a un visuel, le bandeau et aucune mention', [pM.visuel, pM.visuelMention, pM.marqueurs.map(m => m.type), !!pJ.visuel, pJ.visuelMention, pJ.marqueurs.map(m => m.type)],
        [null, null, ['JUMBO', 'NON_LEGAL'], true, null, ['JUMBO', 'NON_LEGAL']]);
    H.v('5d. les impressions de la métacarte gardent le masqué (le groupe { JUMBO, normale } reste visible : numéro, marqueurs)', ims.map(i => [i.idProduct, i.marqueurs && i.marqueurs.map(m => m.type)]), [[5001, null], [5002, ['JUMBO', 'NON_LEGAL']], [5003, ['JUMBO', 'NON_LEGAL']]]);
    H.v('5e. sans la colonne (archive du format 4) rien n\'est masqué : le service d\'avant (resoudre rend le visuel)', await (async () => { db.col = nom => ({ find: () => ({ toArray: async () => [] }) }); try { const x = await creerVisuels({ cfg, version: () => w4 }).resoudre(5003); return x && x.url; } finally { db.col = colReelle; } })(),
        'https://' + cfg.images.hotesPublics[0] + '/vignettes/5003.webp');

    // ── 6. la DÉCISION : la liste fait des emprunts (JUMBO identiques) et des masqués (JUMBO différents) ; Base Set porte sa mention ; rien d'autre ne bouge
    const { decider, estEmprunt } = require('../chargeur/decision'); const { regleEmbarquee } = require('../chargeur/regle-site'); const { calculer } = require('../chargeur/calcul');
    const { MENTION_EDITION_1 } = require('../identifier/emprunt');
    const regle = await regleEmbarquee();
    const SET_A = { _id: 'Set-A', idExpansion: 100, code: 'SETA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } };
    const SET_BS = { _id: 'Base-Set', idExpansion: 1523, code: 'BS', nomAffichage: 'Base Set', tirage: 'intl', region: 'intl', bulba: { expansion: 'Base Set' } };
    const img = (set, numero, n, source = 'tcgdex') => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${n}.webp`, w: 200, h: 279 }, langue: 'en', source });
    const carte = (id, set, expansion, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: [set], impressions: [{ tirage: 'intl', expansion, numero, total: '100', rarete: 'Rare' }], images });
    const docs = [carte(40, 'Set-A', 'Set A', '020', [img('Set-A', '020', 'c40')]), carte(41, 'Set-A', 'Set A', '021', [img('Set-A', '021', 'c41')]), carte(42, 'Set-A', 'Set A', '022', [img('Set-A', '022', 'c42')]),
        carte(43, 'Set-A', 'Set A', '023', [img('Set-A', '023', 'c43')]), carte(44, 'Set-A', 'Set A', '024', []),
        carte(60, 'Base-Set', 'Base Set', '004', [img('Base-Set', '004', 'bs4')]), carte(61, 'Base-Set', 'Base Set', '070', [img('Base-Set', '070', 'bs70')]), carte(62, 'Base-Set', 'Base Set', '005', [img('Base-Set', '005', 'bs5')]),
        carte(63, 'Base-Set', 'Base Set', '006', [img('Base-Set', '006', 'bs6', 'artofpkm')]), carte(64, 'Base-Set', 'Base Set', '069', [img('Base-Set', '069', 'bs69')]), carte(65, 'Base-Set', 'Base Set', '001', [img('Base-Set', '001', 'bs1')]),
        carte(66, 'Base-Set', 'Base Set', '070', [img('Base-Set', '070', 'bs70b')])];
    const ligne = (idProduct, carteId, numero, extra = {}, set = 'Set-A', exp = 100) => ({ idProduct, carteId, idExpansion: exp, numeroFiche: numero, slug: `P${idProduct}-X${numero}`, slugSet: set, ...extra });
    const lignes = [
        ligne(4001, 40, '020'),                                                                                  // la carte NORMALE
        ligne(4002, 40, '020', { marqueurs: JN, marqueursPreuve: PREUVE }),                                      // JUMBO identique (même fiche, même scan) : classe emprunt
        ligne(4003, 41, '021', { marqueurs: JN, marqueursPreuve: PREUVE }),                                      // JUMBO différent : classe sans-visuel
        ligne(4004, 42, '022', { marqueurs: JN, marqueursPreuve: PREUVE }),                                      // JUMBO que la liste ne nomme pas : inchangé, compté
        ligne(4005, 43, '023'),                                                                                  // nommé par la liste, SANS marqueur JUMBO : incohérence, comptée
        ligne(4006, 44, '024', { marqueurs: JN, marqueursPreuve: PREUVE }),                                      // nommé par la liste, aucune image : pas d'entrée
        ligne(4101, 60, '004', {}, 'Base-Set', 1523), ligne(4102, 60, '004', { marqueurs: [{ type: 'EDITION_1', params: {} }], marqueursPreuve: 'Scan Édition 1 : tampon visible' }, 'Base-Set', 1523),
        ligne(4103, 61, '070', {}, 'Base-Set', 1523), ligne(4104, 62, '005', {}, 'Base-Set', 1523), ligne(4105, 63, '006', {}, 'Base-Set', 1523), ligne(4106, 64, '069', {}, 'Base-Set', 1523),
        ligne(4107, 65, '001', { marqueurs: JN, marqueursPreuve: PREUVE }, 'Base-Set', 1523), ligne(4108, 66, '070', {}, 'Base-Set', 1523)];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const classes = new Map([[4002, 'emprunt'], [4003, 'sans-visuel'], [4005, 'sans-visuel'], [4006, 'emprunt'], [4107, 'emprunt'], [9999, 'sans-visuel']]);
    const sans = await decider({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle });
    const avec = await decider({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle, jumbosVisuel: classes });
    const E = (r, id) => r.entrees.find(e => e.idProduct === id);
    const champs = e => e && [e.visuel, e.mention];
    H.v('6a. SANS liste : le JUMBO partage le scan de sa fiche, du-set, sans mention — l\'état d\'avant (c\'est le faux visible que ce lot ferme)', [4001, 4002, 4003].map(id => champs(E(sans, id))), Array(3).fill(['du-set', null]));
    H.v('6b. AVEC la liste : le JUMBO identique (4002) devient un EMPRUNT sans mention, le même scan, ses marqueurs gardés ; le masqué (4003) aussi (et il est nommé masqué)', [champs(E(avec, 4002)), E(avec, 4002).vignette.cleR2 === E(sans, 4002).vignette.cleR2, E(avec, 4002).marqueurs,
        champs(E(avec, 4003)), E(avec, 4003).marqueurs, avec.masques], [['autre-tirage', null], true, JN, ['autre-tirage', null], JN, [4003]]);
    H.v('6c. la carte normale ne bouge pas (du-set, sans mention, sans marqueur) et reste NON empruntée ; les emprunts sont 4002, 4003 et rien d\'autre ici', [champs(E(avec, 4001)), E(avec, 4001).marqueurs ?? null, avec.emprunts.filter(id => id < 4100)], [['du-set', null], null, [4002, 4003]]);
    H.v('6d. un JUMBO que la liste ne nomme pas (4004) reste comme avant ET est COMPTÉ « sans verdict » avec les autres JUMBO (Base Set compris) ; un produit nommé sans entrée (4006, sans image) est LISTÉ avec sa classe', [champs(E(avec, 4004)), avec.denominateurs.jumbosVisuel.sansVerdict, avec.denominateurs.jumbosVisuel.sansEntree],
        [['du-set', null], [4004], [{ idProduct: 4006, classe: 'emprunt' }, { idProduct: 9999, classe: 'sans-visuel' }]]);
    H.v('6e. un produit nommé SANS marqueur JUMBO (4005) n\'est pas touché et est NOMMÉ (la construction s\'arrêtera) ; il n\'est ni emprunté ni masqué', [champs(E(avec, 4005)), avec.denominateurs.jumbosVisuel.sansMarqueur, avec.emprunts.includes(4005), avec.masques.includes(4005)], [['du-set', null], [4005], false, false]);
    H.v('6f. les comptes de la décision : 1 emprunt (4002) + 2 masqués-emprunts (4003, et 4107 = emprunt de Base Set), répartis par classe', [avec.denominateurs.jumbosVisuel.emprunt, avec.denominateurs.jumbosVisuel.sansVisuel, avec.denominateurs.jumbosVisuel.liste], [2, 1, 6]);
    // Base Set
    H.v('6g. BASE SET : la fiche n° 1 à 69 au scan TCGdex porte la mention « ' + MENTION_EDITION_1 + ' » (4101 n°4, 4104 n°5, 4106 n°69), le visuel reste `du-set` (jamais une exclusion, l\'identification ne change pas)',
        [4101, 4104, 4106].map(id => champs(E(avec, id))), Array(3).fill(['du-set', MENTION_EDITION_1]));
    H.v('6h. BASE SET : PAS de mention pour un produit PROUVÉ 1re édition (marqueur EDITION_1 écrit avec sa preuve : 4102), ni au-delà du n° 69 (4103, 4108 n°70), ni pour un scan d\'une autre source (4105 artofpkm)', [4102, 4103, 4108, 4105].map(id => champs(E(avec, id))), Array(4).fill(['du-set', null]));
    H.v('6i. BASE SET : le même résultat avec ou sans liste (la mention ne dépend pas de la liste) ; aucun Base Set n\'est emprunté ni masqué', [[4101, 4102, 4103, 4104, 4105, 4106, 4108].map(id => JSON.stringify(champs(E(sans, id))) === JSON.stringify(champs(E(avec, id)))).every(Boolean), avec.emprunts.filter(id => id !== 4107 && id > 4100)], [true, []]);
    H.v('6j. BASE SET × liste : un JUMBO de Base Set nommé par la liste suit sa CLASSE (4107 : emprunt SANS mention) ; sans la liste (JUMBO inconnu) il reçoit la mention de la fiche', [champs(E(avec, 4107)), champs(E(sans, 4107))], [['autre-tirage', null], ['du-set', MENTION_EDITION_1]]);
    H.v('6k. estEmprunt (la marque de la colonne des emprunts) : vrai pour les JUMBO classés, FAUX pour Base Set (mention seule)', [estEmprunt({ im: {}, set: SET_A, visuel: E(avec, 4002).visuel }), estEmprunt({ im: {}, set: SET_BS, visuel: E(avec, 4101).visuel })], [true, false]);
    // la garde de la Map qui entre dans la décision
    const refusDecision = async classesMauvaises => { try { await decider({ sets: [SET_A], docs, lignes, metacarte, regle, jumbosVisuel: classesMauvaises }); return null; } catch (e) { return e.message; } };
    // ── 7. la CONSTRUCTION : calculer, l'archive précalculée, la ligne de commande
    const ssMarqueur = new Map([...classes].filter(([id]) => id !== 4005));
    const msg = async fn => { try { await fn(); return 'passe'; } catch (e) { return e.motif || e.message; } };
    H.v('7a. un nommé SANS marqueur JUMBO (4005) : la construction REFUSE, avec l\'idProduct (une liste incohérente avec le catalogue n\'est pas servie en silence)',
        /jumbos : 1 produit\(s\) nommé\(s\) par la liste sans marqueur JUMBO dans le catalogue.*4005.*aucune construction/.test(await msg(() => calculer({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle, jumbosVisuel: classes }))), true);
    const cal = await calculer({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle, jumbosVisuel: ssMarqueur });
    const VC = cal.version;
    H.v('7b. calculer : 1 masqué (4003), 3 emprunts (4002, 4003, 4107), aucune entrée refusée ; la colonne = la décision', [VC.comptes.masques, VC.comptes.emprunts, cal.comptes.refusees, VC.colonneMasques, [4001, 4002, 4003, 4107].map(id => [VC.masqueDe(id), VC.empruntDe(id)])],
        [1, 3, 0, true, [[false, false], [false, true], [true, true], [false, true]]]);
    H.v('7c. les comptes rendus au journal : masques / emprunts décidés = colonne, le détail de la liste', [cal.comptes.masquesProduits, cal.comptes.masquesColonne, cal.comptes.jumbosVisuel.liste, cal.comptes.jumbosVisuel.emprunt, cal.comptes.jumbosVisuel.sansVisuel, cal.comptes.jumbosVisuel.sansVerdict, cal.comptes.baseSet],
        [1, 1, 5, 2, 1, [4004], { avecMention: 3, prouvesSansMention: 1 }]);
    const calX = await calculer({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle, jumbosVisuel: ssMarqueur, exclusions: new Map([[4003, 'visuel-faux']]) });
    H.v('7d. un masqué EXCLU par la liste d\'exclusions n\'a plus d\'entrée : ni masqué ni emprunté ; les partages de ses voisins sont prouvés intacts (partagesPerdus 0)', [calX.version.entree(4003), calX.version.comptes.masques, calX.version.comptes.emprunts, calX.comptes.partagesPerdus], [null, 0, 2, 0]);
    const calV = await calculer({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle, jumbosVisuel: ssMarqueur, verdictsEmprunts: new Map([[4002, 'juste'], [4003, 'juste']]) });
    H.v('7e. un verdict « juste » rend l\'emprunt 4002 VÉRIFIÉ (hors de la colonne) mais NE LIBÈRE PAS un masqué (4003 : son scan n\'est pas le sien, le verdict d\'un autre audit n\'y change rien)', [calV.version.empruntDe(4002), calV.version.empruntDe(4003), calV.version.masqueDe(4003)], [false, true, true]);
    const calS = await calculer({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle });
    H.v('7f. SANS liste : la colonne des masqués est écrite VIDE (« aucun » est une réponse), aucun JUMBO ne change ; les mentions Base Set, elles, sont posées', [calS.version.colonneMasques, calS.version.comptes.masques, calS.version.empruntDe(4002), calS.version.entree(4101).mention], [true, 0, false, MENTION_EDITION_1]);
    const trompeur = async x => { const y = await decider(x); return { ...y, denominateurs: { ...y.denominateurs, jumbosVisuel: { ...y.denominateurs.jumbosVisuel, sansVisuel: y.denominateurs.jumbosVisuel.sansVisuel + 1 } } }; };
    H.v('7g. si la décision compte un masqué de plus que la colonne : la construction LÈVE avec les deux comptes', /masqués : produits masqués par la décision 2 ≠ dans la colonne 1 — aucune version construite/.test(await msg(() => calculer({ sets: [SET_A, SET_BS], docs, lignes, metacarte, regle, jumbosVisuel: ssMarqueur, decider: trompeur }))), true);

    // ── 8. l'archive précalculée et la ligne de commande
    const { fabriquerFichier } = require('../chargeur/precalcul'); const SC = require('../chargeur/scellement');
    const { principal } = require('../migrations/construire-fichier-visuels'); const ETAT = require('../chargeur/etat'); const { creerChargeur } = require('../chargeur/chargeur');
    const SECRET = ['secret', 'hmac', 'de', 'banc', '0123456789', 'abcdefghij'].join('-');
    const jeuSource = (compteur = null) => async () => { if (compteur) compteur.n++; return { ok: true, sets: [SET_A, SET_BS], docs, lignes: lignes.filter(l => l.idProduct !== 4005), fermer: async () => { } }; };
    const fab = await fabriquerFichier({ source: jeuSource(), catalogue: metacarte, secret: SECRET, jumbosVisuel: ssMarqueur });
    const relu = F.deserialiser(await F.decompresser(SC.ouvrir(fab.scelle, SECRET)));
    H.v('8a. fabriquerFichier : le fichier est du FORMAT 5, relu par le consommateur (aller-retour) ; masqués, emprunts, marqueurs écrits concordent', [F.lireEntete(fab.brut).format, relu.colonneMasques, relu.comptes.masques, relu.masqueDe(4003), relu.empruntDe(4002), relu.entree(4003).marqueurs.map(m => m.type)], [5, true, 1, true, true, ['JUMBO', 'NON_LEGAL']]);
    const lancer = async (argv, env, deps) => {
        const sortie = []; const lo = console.log, le = console.error; console.log = m => sortie.push(String(m)); console.error = m => sortie.push(String(m));
        try { const code = await principal(['node', 'script', ...argv], env, deps); return { code, texte: sortie.join('\n') }; } finally { console.log = lo; console.error = le; }
    };
    const bonne = ecrire(liste({}, [{ idProduct: 4002, verdict: 'identique' }, { idProduct: 4003, verdict: 'different' }, { idProduct: 4006, verdict: 'illisible' }, { idProduct: 9999, verdict: 'fiche-fausse' }, { idProduct: 4107, verdict: 'identique' }]));
    const cible = path.join(dossier, 'archive-jumbo.rmv'), compteur = { n: 0 };
    const rOk = await lancer([`--vers=${cible}`, `--jumbos-visuel=${bonne}`], { V2_VISUELS_HMAC: SECRET }, { source: jeuSource(compteur), catalogue: metacarte });
    const archive = F.deserialiser(await F.decompresser(SC.ouvrir(fs.readFileSync(cible), SECRET)));
    H.v('8b. la ligne de commande : --jumbos-visuel=<fichier> -> code 0, l\'archive porte 1 masqué (4003) et les emprunts 4002, 4003, 4107 ; le journal dit la décision, les deux dates, l\'empreinte et les comptes', [rOk.code, archive.comptes.masques, [4002, 4003, 4107].map(id => archive.empruntDe(id)),
        /jumbos \(décision de banc \(liste fabriquée\)/.test(rOk.texte), /liste source du 2026-10-27T07:24:27\.126Z/.test(rOk.texte), new RegExp('empreinte de la liste source ' + SHA).test(rOk.texte), /1 produit\(s\) masqué\(s\)/.test(rOk.texte), /2 emprunt\(s\)/.test(rOk.texte)], [0, 1, [true, true, true], true, true, true, true, true]);
    H.v('8c. le journal nomme ce que la liste cite SANS entrée (4006 sans image, 9999 absent) et les JUMBO que la liste ne nomme pas (4004)', [/4006 \[sans-visuel\]/.test(rOk.texte), /9999 \[sans-visuel\]/.test(rOk.texte), /sans verdict.*4004/.test(rOk.texte)], [true, true, true]);
    const avantRefus = compteur.n, cibleRefus = path.join(dossier, 'refus.rmv');
    const refusCli = [];
    for (const [nom, argv] of [['fichier introuvable', [`--jumbos-visuel=${path.join(dossier, 'absent.json')}`]], ['forme sans =', ['--jumbos-visuel']], ['valeur vide', ['--jumbos-visuel=']],
        ['liste invalide', [`--jumbos-visuel=${ecrire(liste({ le: 'hier' }))}`]], ['verdict inconnu', [`--jumbos-visuel=${ecrire(liste({}, [{ idProduct: 4002, verdict: 'peut-etre' }]))}`]]]) {
        const r = await lancer([`--vers=${cibleRefus}`, ...argv], { V2_VISUELS_HMAC: SECRET }, { source: jeuSource(compteur), catalogue: metacarte });
        refusCli.push([nom, r.code, /--jumbos-visuel/.test(r.texte)]);
    }
    H.v('8d. une liste invalide, absente ou mal formée REFUSE la construction (code 1) AVANT toute lecture de la source, et rien n\'est écrit', [refusCli, compteur.n === avantRefus, fs.existsSync(cibleRefus)], [refusCli.map(([nom]) => [nom, 1, true]), true, false]);
    const rIncoh = await lancer([`--vers=${cibleRefus}`, `--jumbos-visuel=${ecrire(liste({}, [{ idProduct: 4001, verdict: 'identique' }]))}`], { V2_VISUELS_HMAC: SECRET }, { source: jeuSource(), catalogue: metacarte });
    H.v('8e. une liste qui nomme un produit SANS marqueur JUMBO (4001, la carte normale) : la construction s\'arrête (code 1), rien n\'est écrit', [rIncoh.code, /sans marqueur JUMBO/.test(rIncoh.texte), fs.existsSync(cibleRefus)], [1, true, false]);
    const rSans = await lancer([`--vers=${path.join(dossier, 'sans.rmv')}`], { V2_VISUELS_HMAC: SECRET }, { source: jeuSource(), catalogue: metacarte });
    const arcSans = F.deserialiser(await F.decompresser(SC.ouvrir(fs.readFileSync(path.join(dossier, 'sans.rmv')), SECRET)));
    H.v('8f. sans l\'option : l\'archive est celle d\'avant pour les JUMBO (aucun masqué, aucun emprunt JUMBO) ; le journal dit « aucune liste »', [rSans.code, arcSans.comptes.masques, arcSans.empruntDe(4002), /jumbos : aucune liste/.test(rSans.texte)], [0, 0, false, true]);
    // le chargeur : une archive SANS la colonne des masqués ne remplace jamais une qui l'a (le JUMBO différent retrouverait le scan de la carte normale)
    const avecLien = (opts, date, entrees, masque = []) => { const x = V.creerConstructeur(opts); for (const e of entrees) { x.entree(e); if (opts.emprunts) x.emprunt(e.idProduct); } for (const id of masque) x.masque(id); x.lien('Set-A', '1|001', [entrees[0].idProduct]); return x.finir(new Date(date)); };
    const v4Neuve = avecLien({ emprunts: true, ecrits: true }, '2026-10-29T12:00:00.000Z', [emprunteJumbo(1)]);
    const v5En = avecLien({ emprunts: true, ecrits: true, masques: true }, '2026-10-29T09:00:00.000Z', [emprunteJumbo(1)], [1]);
    const comptesDe = x => ({ sets: 1, cartes: 1, produits: 1, catalogue: 1, visuels: x.comptes.visuels, refusees: 0, motifs: {}, doublons: 0, doublonsContradictoires: 0, fichesLiees: x.comptes.fichesLiees, setsAvecLiens: x.comptes.setsAvecLiens, produitsLies: x.comptes.produitsLies });
    let aCharger = null; const journal = [];
    const ch = creerChargeur({ catalogue: async () => new Map([[1, 1]]), executer: async () => ({ ok: true, version: aCharger, comptes: comptesDe(aCharger) }), journal: m => journal.push(m) });
    ETAT.vider();
    try {
        aCharger = v4Neuve; const r1 = await ch.charger();
        H.v('8g. sans version en place, une archive du format 4 s\'installe, et le journal DIT qu\'aucun visuel n\'est masqué (les JUMBO différents garderaient le scan de la carte normale)', [r1.ok, ETAT.version() === v4Neuve, journal.some(m => /PAS la colonne des masqués/.test(m))], [true, true, true]);
        ETAT.vider(); journal.length = 0; aCharger = v5En; const r2 = await ch.charger();
        H.v('8h. une archive du format 5 s\'installe, et le journal imprime les masqués', [r2.ok, ETAT.version() === v5En, journal.some(m => /visuels masqués 1/.test(m))], [true, true, true]);
        journal.length = 0; const v4Plus = avecLien({ emprunts: true, ecrits: true }, '2026-10-29T13:00:00.000Z', [emprunteJumbo(1)]);
        aCharger = v4Plus; const r3 = await ch.charger();
        H.v('8i. une version plus récente MAIS sans la colonne des masqués ne remplace pas celle qui l\'a : la version en place est gardée', [r3.ok, ETAT.version() === v5En, journal.some(m => /colonne des masqués alors que celle en place l'a/.test(m))], [false, true, true]);
    } finally { ETAT.vider(); }

    // ── 9. l'identification ne change pas : la CEINTURE de SUR-PAR-IMAGE ne lit pas la mention de Base Set comme un emprunt oublié ; le GROUPE { JUMBO, normale } tient pour la normale, l'emprunt et le masqué
    const { emprunteDe } = require('../identifier/sur-par-image-route'); const GM = require('../identifier/garde-marqueurs');
    const cBase = V.creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true });
    cBase.entree(brut(8001, { mention: MENTION_EDITION_1 })); cBase.entree(brut(8002, { mention: 'Visuel de la même carte dans un autre tirage (Set B n°1) — pas celui de ce set' })); cBase.entree(brut(8003)); cBase.entree(brut(8004, { mention: 'Une mention quelconque' }));
    const vBase = cBase.finir(D), ceinture = emprunteDe(vBase);
    H.v('9a. la ceinture : une mention d\'affichage (Base Set) sur une entrée NON empruntée ne la rend pas suspecte (false : l\'image peut encore servir) ; toute AUTRE mention sur une entrée dite propre la rend suspecte (true, comme avant) ; sans mention : false',
        [ceinture(8001), ceinture(8002), ceinture(8004), ceinture(8003)], [false, true, true, false]);
    const grp = V.creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true });
    const tout = { vignette: { cle: 'vignettes/n.webp', w: 200, h: 279 }, grande: { cle: 'cartes/n.webp', w: 600, h: 838 }, idMetacard: 321, numero: '20', setNom: 'Set A' };
    grp.entree(brut(9001, tout));                                                                                                                      // la normale
    for (const id of [9002, 9003]) { grp.entree(emprunteJumbo(id, tout)); grp.emprunt(id); }                                                           // un JUMBO identique, un JUMBO différent : même fiche, même scan
    grp.masque(9003);
    grp.lien('Set-A', '40|020', [9001, 9002, 9003]);
    const vG = grp.finir(D);
    const memeFicheParLaFiche = (a, b) => vG.fichesDuSet('Set-A').some(f => f.produits.includes(a) && f.produits.includes(b));
    const marq = id => { const m = MQ.marqueursDeLEntree(vG.entree(id)).marqueurs; return m === null ? null : [...m]; };
    const vGroupe = { ...vG, entree: id => vG.entree(id), memeFiche: (a, b) => memeFicheParLaFiche(a, b), empruntDe: id => vG.empruntDe(id) };
    H.v('9b. le GROUPE tient : la normale, le JUMBO emprunté et le JUMBO masqué restent « le même dessin » deux à deux (même scan, même fiche), et leurs marqueurs diffèrent', [[9001, 9002], [9001, 9003], [9002, 9003]].map(([a, b]) => GM.memeDessin(vGroupe, a, b, { avecEmprunt: true })), [true, true, true]);
    H.v('9c. les marqueurs servis : la normale null (on ne sait pas), le JUMBO emprunté et le masqué JUMBO + NON_LEGAL', [marq(9001), marq(9002).map(m => m.type), marq(9003).map(m => m.type)], [null, ['JUMBO', 'NON_LEGAL'], ['JUMBO', 'NON_LEGAL']]);
    const aff = (p, critere) => ({ issue: 'affirmee', critere, analyse: { cartes: [{ carte: { idProduct: p } }] } });
    const question = ids => ({ issue: 'question', analyse: { cartes: [{ candidats: ids.map(idProduct => ({ idProduct })) }] } });
    const jouer = (p, critere, drapeaux = { jumboTitre: true, gardeMarqueurs: true }) => {
        const g = GM.consulterMarqueurs({ cfg: drapeaux, titre: null, resultat: aff(p, critere), derniereQuestion: null, produits: new Map([9001, 9002, 9003].map(id => [id, {}])), version: vGroupe, affirmer: () => null, marqueursDe: marq, questionDeGroupe: question });
        return g && g.resultat && g.resultat.issue === 'question' ? 'question' : 'sûr';
    };
    H.v('9d. la GARDE (allumée) : un sûr d\'IMAGE sur la normale, sur le JUMBO emprunté ou sur le masqué redevient une question — la normale ne sort JAMAIS sûre sans signal réel, même dans ce groupe d\'emprunts et de masqués', [9001, 9002, 9003].map(p => jouer(p, 'image (inliers)')), ['question', 'question', 'question']);
    H.v('9e. le signal réel du Jumbo (le titre) confirme le JUMBO (emprunté ou masqué) face à la normale ; sur la NORMALE il ne couvre rien (question)', [jouer(9002, GM.critereJumbo('jumbo')), jouer(9003, GM.critereJumbo('jumbo')), jouer(9001, GM.critereJumbo('jumbo'))], ['sûr', 'sûr', 'question']);
    H.v('9f. garde ÉTEINTE : rien ne change (le comportement d\'avant)', [9001, 9002, 9003].map(p => jouer(p, 'image (inliers)', { jumboTitre: false, gardeMarqueurs: false })), ['sûr', 'sûr', 'sûr']);

    H.v('6l. une Map invalide (vide, classe inconnue) REFUSE la décision, avec la raison de la garde', [await refusDecision(new Map()), await refusDecision(new Map([[1, 'autre']])), await refusDecision([[1, 'emprunt']])].map(m => /^jumbos : /.test(m || '')), [true, true, true]);

    H.bilan();
})().catch(x => { console.error('❌', x); process.exit(1); });

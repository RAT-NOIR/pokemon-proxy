'use strict';
// B1b.4 puis COTES-VISUELS — visuels servis depuis NOS fichiers, impressions sans lien anonyme : tout vient de la version EN MÉMOIRE du chargeur (v2/chargeur), construite avec le MÊME
// constructeur que la production (donc la même validation lireEntree). Base EN MÉMOIRE seulement pour le guide de prix (H.ouvrirBac), aucun réseau.
// 🔑 La collection `visuels` n'existe plus et ce module ne lit AUCUNE collection de `cartes` : ce banc n'en crée aucune.
const fs = require('fs'); const path = require('path');
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const V = require('../identifier/visuels'); const { construireProduit } = require('../identifier/produit'); const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const HOTE = cfg.images.hotesPublics[0];
const img = (cle, w = 245, h = 342) => ({ cle, w, h });
const CM = 'https://www.cardmarket.com/en/Pokemon/Products/Singles';
const brut = (id, o = {}) => ({ idProduct: id, vignette: img(`vignettes/${id}.webp`, 200, 279), grande: img(`cartes/${id}.webp`, 600, 838), visuel: 'du-set', mention: null,
    idMetacard: null, numero: null, rarete: null, total: null, variante: null, setNom: null, lien: null, ...o });

(async () => {
    await H.ouvrirBac('test-identifier-visuels.js');

    // 2 + 3 + 4. le chargement : refus, dénominateurs
    const sansMeta = brut(1015); delete sansMeta.idMetacard;
    const lot = [
        brut(1001), brut(1002, { grande: null }),
        brut(1003, { vignette: img('https://exemple.org/x.webp') }),                       // ://
        brut(1004, { vignette: img('vignettes/../secret.webp') }),                          // ..
        brut(1005, { grande: img('cartes/Cardmarket/1005.webp') }),                         // cardmarket (casse ignorée)
        brut(1006, { visuel: 'substitut', mention: null }),                                 // substitut sans mention
        brut(1007, { visuel: 'substitut', mention: '   ' }),                                // mention vide
        brut(1008, { visuel: 'substitut', mention: 'Visuel de la carte d\'origine — pas celui de ce produit' }),
        { idProduct: 1009, grande: null },                                                  // vignette absente
        brut('1010'),                                                                       // idProduct non entier
        brut(1013, { vignette: img('vignettes//1013.webp') }),                              // a//b
        brut(1014, { vignette: img('vignettes/./1014.webp') }),                             // a/./b
        sansMeta,                                                                           // idMetacard absent (null serait admis, undefined non)
        brut(1016, { lien: 'https://evil.example/x' })                                      // lien hors Cardmarket
    ];
    const v1 = VB.construire(lot);
    H.v('chargement : 14 lus, 3 admis, 11 refusés (un motif chacun)', [v1.comptes.lues, v1.comptes.visuels, v1.comptes.refusees, Object.values(v1.comptes.motifs).reduce((a, b) => a + b, 0)], [14, 3, 11, 11]);
    H.v('   1003/1004/1005/1013/1014 (://, .., cardmarket, //, /./) absents', [1003, 1004, 1005, 1013, 1014].map(id => v1.entree(id)), [null, null, null, null, null]);
    H.v('   1006/1007 (substitut sans mention) absents, 1008 présent', [v1.entree(1006), v1.entree(1007), v1.entree(1008) !== null], [null, null, true]);
    H.v('   1015 (idMetacard absent) et 1016 (lien hors Cardmarket) absents', [v1.entree(1015), v1.entree(1016)], [null, null]);
    H.v('   forme du document (visuel + impression)', (({ vignette, grande, mention, idMetacard, numero, rarete, total }) => ({ vignette, grande, mention, idMetacard, numero, rarete, total }))(v1.entree(1001)),
        { vignette: img('vignettes/1001.webp', 200, 279), grande: img('cartes/1001.webp', 600, 838), mention: null, idMetacard: null, numero: null, rarete: null, total: null });

    // 1. resoudre
    E.installer(VB.construire([brut(1001, { vignette: img('vignettes/1001-bis.webp', 210, 293) }), brut(1002, { grande: null }), brut(1008, { visuel: 'substitut', mention: 'Visuel de la carte d\'origine — pas celui de ce produit' })]));
    const S = V.creerVisuels({ cfg });
    const r = await S.resoudre(1001);
    H.v('resoudre : url = https://<hôte public [0]>/<cle>', r.url, `https://${HOTE}/vignettes/1001-bis.webp`);
    H.v('   w/h de la vignette', [r.w, r.h], [210, 293]);
    H.v('   grande : Image sur le même hôte', r.grande, { url: `https://${HOTE}/cartes/1001.webp`, w: 600, h: 838 });
    H.v('   sans mention : mention null', r.mention, null);
    H.v('   sans grande : grande null', (await S.resoudre(1002)).grande, null);
    H.v('   absent : null', await S.resoudre(999999), null);
    H.v('   idProduct non entier : null', [await S.resoudre('1001'), await S.resoudre(null)], [null, null]);
    H.v('   substitut : servi avec sa mention', (await S.resoudre(1008)).mention, 'Visuel de la carte d\'origine — pas celui de ce produit');
    const autreHote = V.creerVisuels({ cfg: { ...cfg, images: { ...cfg.images, hotesPublics: ['rat-market.fr', 'autre.exemple'] } } });
    H.v('   l\'hôte vient de la config ([0] seulement)', (await autreHote.resoudre(1001)).url, 'https://rat-market.fr/vignettes/1001-bis.webp');
    // défense en profondeur : même si une version portait une clé interdite, elle ne serait jamais servie
    const hostile = { entree: id => ({ 2001: { vignette: img('https://evil.example/x.webp'), grande: null, mention: null }, 2002: { vignette: img('vignettes/ok.webp'), grande: img('../x.webp'), mention: null },
        2003: { vignette: img('vignettes/cardmarket-x.webp'), grande: null }, 2004: { vignette: img('vignettes//x.webp'), grande: null } })[id] || null, produitsDeMetacarte: () => [] };
    const Sh = V.creerVisuels({ cfg, version: () => hostile });
    H.v('   une version qui porterait des clés interdites : jamais servies (grande fausse => grande null)', [await Sh.resoudre(2001), (await Sh.resoudre(2002)).grande, await Sh.resoudre(2003), await Sh.resoudre(2004)], [null, null, null, null]);
    // V2 : un lien d'un autre hôte que Cardmarket n'est JAMAIS servi comme lien (numéro et rareté connus), le lien Cardmarket l'est
    const versionEtrange = { produitsDeMetacarte: () => [9001, 9002], entree: id => ({
        9001: { idProduct: 9001, numero: '5', rarete: 'Rare', total: '10', variante: null, setNom: 'S', lien: 'https://exemple.test/evil', vignette: img('v/1.webp') },
        9002: { idProduct: 9002, numero: '6', rarete: 'Rare', total: '10', variante: null, setNom: 'S', lien: `${CM}/Base-Set/Ok-6`, vignette: img('v/2.webp') } })[id] || null };
    const imE = await V.creerVisuels({ cfg, version: () => versionEtrange }).impressions(1);
    H.v('   un lien d\'un autre hôte que Cardmarket n\'est JAMAIS servi (null), le lien Cardmarket l\'est', imE.map(i => [i.idProduct, i.lien]), [[9001, null], [9002, `${CM}/Base-Set/Ok-6`]]);
    // LANGUE-DECISIVE (contrat 7a) : la langue d'une impression vient de la langue de TIRAGE de la colonne des jumeaux ; intl, id, th, idth, inconnu : null
    const tirages = { 9101: 'jp', 9102: 'zh-hans', 9103: 'intl', 9104: 'idth', 9105: null, 9106: 'ko' };
    const versionLangues = { produitsDeMetacarte: () => Object.keys(tirages).map(Number), tirageJumeaux: id => tirages[id] ?? null, entree: id => (id in tirages ? { idProduct: id, numero: String(id - 9100), rarete: 'Rare', total: '10', variante: null, setNom: 'S', lien: null, vignette: img('v/' + id + '.webp') } : null) };
    const imL = await V.creerVisuels({ cfg, version: () => versionLangues }).impressions(1);
    H.v('   langue d\'une impression : jp -> ja, zh-hans, ko ; intl, idth, null -> null', imL.map(i => [i.idProduct, i.langue]), [[9101, 'ja'], [9102, 'zh-hans'], [9103, null], [9104, null], [9105, null], [9106, 'ko']]);
    // M6 : un jeu de lecteurs LIÉ à la version en place à cet instant : la bascule d'une autre version ne s'y mêle pas
    E.installer(VB.construire([brut(4001, { setNom: 'Version A' })]));
    const fige = V.creerVisuels({ cfg }).instantane();
    E.installer(VB.construire([brut(4001, { setNom: 'Version B' })]));
    H.v('   instantane() : lié à la version A même après la bascule vers B ; le lecteur ordinaire, lui, voit B', [fige.entree(4001).setNom, V.creerVisuels({ cfg }).entree(4001).setNom], ['Version A', 'Version B']);
    E.vider();
    H.v('   AUCUNE version chargée : « sans visuel » (null), impressions [], aucune exception', [await S.resoudre(1001), await S.impressions(77), S.entree(1001)], [null, [], null]);

    // 5. impressions : TOUT vient de la version en mémoire (+ le guide de prix de la base de production). Aucune lecture de `cartes`.
    await db.col('guide_prix').insertOne({ idProduct: 3004, trend: 4.5, low: 2, avg7: 4.2, avg30: 3.1, guideDu: '2026-10-01' });
    const I = (id, o) => brut(id, { idMetacard: 77, setNom: 'Base Set', ...o });
    const v5 = VB.construire([
        I(3001, { numero: '58', total: '102', rarete: 'Rare Holo', variante: 'premiere-edition', lien: `${CM}/Base-Set/Pikachu-V1-BS58` }),
        I(3002, { numero: '58', rarete: null, lien: `${CM}/Base-Set/Pikachu-V2-BS58` }),                // rareté non lue : jamais devinée
        I(3003, { numero: null, rarete: 'Commune', lien: `${CM}/Jungle/Pikachu-X` }),                  // numéro inconnu
        I(3004, { numero: '12', rarete: 'Rare', setNom: 'Jungle', variante: 'V1', lien: `${CM}/Jungle/Pikachu-JU12` }),
        I(3005, { numero: '5', rarete: 'Commune', lien: null }),                                         // lien non donné
        I(3999, { idMetacard: 78, numero: '1', rarete: 'Rare', lien: `${CM}/Base-Set/Autre-1` })]);
    E.installer(v5);
    H.v('impressions : 6 admis', v5.comptes.visuels, 6);
    const imps = await S.impressions(77);
    const par = Object.fromEntries(imps.map(i => [i.idProduct, i]));
    H.v('impressions : les 5 produits de la métacarte 77, pas le 3999 (dénominateur 5)', imps.map(i => i.idProduct).sort(), [3001, 3002, 3003, 3004, 3005]);
    H.v('   ordre : numéro croissant, sans numéro en dernier', imps.map(i => i.idProduct), [3005, 3004, 3001, 3002, 3003]);
    H.v('   numéro ET rareté connus + lien donné : lien Cardmarket', par[3001].lien, `${CM}/Base-Set/Pikachu-V1-BS58`);
    H.v('   numéro, total, rareté, set repris du chargement', [par[3001].numero, par[3001].total, par[3001].rarete, par[3001].set], ['58', '102', 'Rare Holo', { nom: 'Base Set' }]);
    H.v('   rareté NON lue : null (jamais devinée), le numéro est connu : le lien donné est servi', [par[3002].rarete, par[3002].lien], [null, `${CM}/Base-Set/Pikachu-V2-BS58`]);
    H.v('   numéro inconnu : lien null (jamais anonyme)', [par[3003].numero, par[3003].lien], [null, null]);
    H.v('   lien non donné : null même avec numéro et rareté', [par[3005].rarete, par[3005].lien], ['Commune', null]);
    H.v('   variante de la liste conservée, hors liste (V1) : null', [par[3001].variante, par[3004].variante], ['premiere-edition', null]);
    H.v('   prix guide daté, forme de LIGNE de catalogue (jamais sans date)', [par[3004].prixGuide, par[3001].prixGuide], [{ trend: 4.5, low: 2, avg7: 4.2, avg30: 3.1, guideDu: '2026-10-01' }, null]);
    H.v('   clés d\'une impression : `lien` seul (contrat 2) — la version vient de numeros_cartes (catalogue.js) ; LOT TAMPONS : `marques` (prouvées, d\'après la variante de l\'archive) et `prixMelangeTampon` (colonne de l\'archive, === true seulement) viennent de l\'archive, réunis au catalogue par catalogue.js', Object.keys(par[3001]), ['idProduct', 'numero', 'total', 'rarete', 'variante', 'marques', 'prixMelangeTampon', 'langue', 'set', 'lien', 'prixGuide']);
    H.v('   … une variante hors de la liste fermée des marques (premiere-edition, V1) : marques = null, prixMelangeTampon = false (jamais « aucune marque » inventé)', [par[3001].marques, par[3004].marques, par[3001].prixMelangeTampon], [null, null, false]);
    H.v('   langue d\'une impression : null sans colonne de tirage (jamais devinée)', par[3001].langue, null);
    H.v('   métacarte inconnue ou non entière : []', [await S.impressions(424242), await S.impressions('77'), await S.impressions(null)], [[], [], []]);
    // le sortie de impressions() traverse construireProduit (produit.js lit `lien`) : le contrat 2 sort intact
    const prod = construireProduit({ idProduct: 3001, nomCardmarket: 'Pikachu', set: { slug: 'base-set', nom: 'Base Set' }, impressions: imps }, { cfg });
    const pp = Object.fromEntries(prod.impressions.map(i => [i.idProduct, i]));
    H.v('   via construireProduit : lien conservé, prixGuide au contrat, lien sans numéro reste null',
        [pp[3001].lien, pp[3004].prixGuide, pp[3003].lien], [`${CM}/Base-Set/Pikachu-V1-BS58`, { tendance: 4.5, de: 2, deBase: 'tous-etats', moyenne7: 4.2, moyenne30: 3.1, date: '2026-10-01', fiable: false, reserves: ['ecart-tendance'] }, null]);       // 4,5 contre la moyenne 30 j 3,1 : +45 % (> 30 %), la moyenne 7 j (4,2) ne suffit pas à l'excuser
    // la base de l'API ne contient aucune collection de l'autre grappe, ni `visuels`
    const noms = (await require('mongoose').connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name.replace(db.prefixeCourant(), ''));
    H.v('aucune collection cartes / cartes_produits / catalogue_produits / numeros_cartes / visuels dans la base de l\'API (dénominateur ' + noms.length + ')',
        noms.filter(n => ['cartes', 'cartes_produits', 'catalogue_produits', 'numeros_cartes', 'visuels'].includes(n)), []);

    // garde de collections : liste fermée
    H.v('liste fermée des collections lues', V.COLLECTIONS_LUES, ['guide_prix']);
    for (const n of ['cartes', 'cartes_produits', 'visuels']) { let leve = null; try { V.colLue(n); } catch (e) { leve = e.message; } H.vrai(`   colLue("${n}") refusé`, leve && leve.includes(n)); }
    H.vrai('   colLue("guide_prix") admis', V.colLue('guide_prix'));
    const src = fs.readFileSync(path.join(__dirname, '..', 'identifier', 'visuels.js'), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '');
    const nommees = [...code.matchAll(/\b(?:colLue|col)\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    H.vrai(`   visuels.js ne nomme que des collections de la liste (${nommees.length} appels : ${[...new Set(nommees)].join(', ')})`, nommees.length > 0 && nommees.every(n => V.COLLECTIONS_LUES.includes(n)));
    H.vrai('   visuels.js ne nomme jamais cartes_produits ni numeros_cartes ni catalogue_produits ni la collection visuels', !/cartes_produits|numeros_cartes|catalogue_produits|col\(\s*['"]visuels['"]/.test(code));
    // un nom CALCULÉ passerait la lecture des littéraux : le seul accès à la base est donc EXACTEMENT le `db.col(` de colLue, rien d'autre
    const occ = [...code.matchAll(/\bdb\.col\(/g)].length;
    const corpsColLue = (code.match(/function colLue\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    H.v('   exactement UNE occurrence de `db.col(` dans visuels.js, et dans colLue', [occ, /db\.col\(/.test(corpsColLue)], [1, true]);
    H.v('   aucun autre accès à `db.` (hors db.col dans colLue) ni à mongoose', [[...code.matchAll(/\bdb\.(?!col\()/g)].length, /mongoose/i.test(code)], [0, false]);
    E.vider();
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });

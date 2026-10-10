'use strict';
// B1b.4b — l'EXPORT des visuels (v2/migrations/exporter-visuels.js). Base EN MÉMOIRE (H.ouvrirBancV2), documents FABRIQUÉS, aucun réseau.
// La règle du site est la VRAIE (rat-market-site/lib/*.ts, importée) : les cas fabriqués la traversent, ils ne la remplacent pas.
// Les deux bases lues (cartes, production) sont lues par la FAÇADE DE LECTURE du banc : une écriture de l'exporteur lèverait.
const H = require('./_harnais');
const mongoose = require('mongoose');

(async () => {
    const banc = await H.ouvrirBancV2();                       // AVANT tout require qui lit l'environnement
    const { facadeLecture } = require('../../collecte-cartes/base-banc');
    const X = require('../migrations/exporter-visuels');
    const Imp = require('../migrations/importer-visuels');
    const cx = await mongoose.createConnection(banc.uri, { dbName: 'banc_cartes' }).asPromise();
    const cp = await mongoose.createConnection(banc.uri, { dbName: 'banc_prod' }).asPromise();
    try {
        const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
        const im = (set, numero, n, o = {}) => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
        const imp = (numero, o = {}) => ({ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare', ...o });
        const carte = (id, impressions, images, categorie = 'pokemon') => ({ _id: id, nomEn: `Carte ${id}`, categorie, sets: ['Set-A'], impressions, images });
        const ligne = (id, carteId, numeroFiche, o = {}) => ({ idProduct: id, carteId, idExpansion: 100, numeroFiche, slug: `P${id}-SA${numeroFiche}`, slugSet: 'Set-A', ...o });
        const MENTION = 'Visuel de la carte d\'origine (Set B) — pas celui de ce produit';
        // réaliste (mesuré sur la base réelle : 3 219 substituts, 0 portent une vignette) : le substitut nomme son fichier ; la vignette est celle
        // de l'entrée cartes.images qui porte CE fichier (carte 10, Set-B)
        const subst = o => ({ cleR2: 'cartes/orig.webp', w: 600, h: 838, set: 'Set-B', ...o });

        await cx.db.collection('sets').insertMany([
            { _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } },
            { _id: 'Set-B', idExpansion: 200, code: 'SB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } }]);
        await cx.db.collection('cartes').insertMany([
            carte(1, [imp('001')], [im('Set-A', '001', 'c1')]),                                             // du set, tout lu
            carte(2, [imp('002')], []),                                                                     // substitut AVEC mention
            carte(3, [imp('003')], []),                                                                     // substitut SANS mention
            carte(4, [imp('004')], [im('Set-B', '004', 'c4b')]),                                            // autre tirage
            carte(5, [imp('005')], []),                                                                     // aucun visuel
            carte(6, [imp('006', { rarete: undefined })], [im('Set-A', '006', 'c6')]),                      // rareté non lue
            carte(7, [imp('007'), imp('007')], [im('Set-A', '007', 'c7')]),                                 // deux impressions au même numéro (d'accord)
            carte(8, [imp('008'), imp('008', { rarete: 'Holo Rare' })], [im('Set-A', '008', 'c8')]),        // au même numéro, en désaccord sur la rareté
            carte(9, [imp('009')], [im('Set-A', '009', 'c9', { vignette: undefined })]),                    // visuel sans vignette
            { ...carte(10, [], [im('Set-B', '010', 'orig')]), sets: ['Set-B'] }]);                          // porte le fichier du substitut (cartes/orig.webp)
        await cx.db.collection('cartes_produits').insertMany([
            ligne(1001, 1, '001'), ligne(1002, 2, '002', { visuelSubstitut: subst({ mention: MENTION }) }),
            ligne(1003, 3, '003', { visuelSubstitut: subst({}) }), ligne(1004, 4, '004'), ligne(1005, 5, '005'),
            ligne(1006, 6, '006'), ligne(1007, 7, '007'), ligne(1008, 8, '008'), ligne(1009, 9, '009')]);
        const metas = [[1001, 5001], [1002, 5002], [1003, 5003], [1004, 5004], [1005, 5005], [1007, 5007], [1008, 5008], [1009, 5009], [9999, 5999]];   // 1006 absent du catalogue ; 9999 sans ligne
        await cp.db.collection('catalogue_produits').insertMany(metas.map(([idProduct, idMetacard]) => ({ idProduct, idMetacard, name: `P${idProduct}` })));

        const regle = await X.chargerRegle();
        const lire = () => X.exporter({ cartes: facadeLecture(cx.db), prod: facadeLecture(cp.db), regle });
        const { entrees, denominateurs: d } = await lire();
        const e = id => entrees.find(x => x.idProduct === id);

        H.v('dénominateurs : catalogue 9, produits à ligne 9, catalogue sans ligne 1', [d.catalogue, d.avecLigne, d.sansLigne], [9, 9, 1]);
        H.v('dénominateurs : du set 5, substitut 2, autre tirage 1, aucun 1 (somme = 9)', [d.duSet, d.substitut, d.autreTirage, d.aucun], [5, 2, 1, 1]);
        H.v('entrées écrites : 8 (le produit sans visuel n\'est pas écrit)', [entrees.length, d.ecrites], [8, 8]);
        H.v('1005 (aucun visuel) absent du fichier', e(1005), undefined);

        H.v('1001 du set : vignette lue sur la vignette, grande = l\'original', [e(1001).visuel, e(1001).mention, e(1001).vignette, e(1001).grande],
            ['du-set', null, { cle: 'vignettes/c1.webp', w: 200, h: 279 }, { cle: 'cartes/c1.webp', w: 600, h: 838 }]);
        H.v('1001 : numero = numeroFiche, rarete/total lus, métacarte du catalogue, nom du set', [e(1001).numero, e(1001).rarete, e(1001).total, e(1001).idMetacard, e(1001).setNom],
            ['001', 'Rare', '100', 5001, 'Set A']);
        H.v('1001 : lien construit par la règle du site (numéro ET rareté connus)', e(1001).lien, 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Set-A/P1001-SA001');
        H.v('1002 substitut AVEC mention : la mention du produit, vignette du substitut', [e(1002).visuel, e(1002).mention, e(1002).vignette.cle], ['substitut', MENTION, 'vignettes/orig.webp']);
        H.v('1003 substitut SANS mention : écrit tel quel (mention null), pas inventée', [e(1003).visuel, e(1003).mention], ['substitut', null]);
        H.v('1004 autre tirage : annoncé comme tel, avec le set d\'origine', [e(1004).visuel, /Set B/.test(e(1004).mention || ''), e(1004).vignette.cle], ['autre-tirage', true, 'vignettes/c4b.webp']);
        H.v('1006 rareté non lue : null, donc pas de lien (jamais devinée)', [e(1006).rarete, e(1006).lien, e(1006).numero, e(1006).idMetacard], [null, null, '006', null]);
        H.v('1007 deux impressions au même numéro, d\'accord : rareté lue', [e(1007).rarete, e(1007).total], ['Rare', '100']);
        H.v('1008 deux impressions au même numéro, en DÉSACCORD : null (jamais l\'une des deux)', [e(1008).rarete, e(1008).lien, d.rareteContredite], [null, null, 1]);
        H.v('1009 visuel sans vignette : champ vignette absent (l\'importeur le refusera)', 'vignette' in e(1009), false);
        H.v('tous les champs PRÉSENTS exigés par l\'importeur sont là (null admis) sur chaque entrée', entrees.every(x => ['idMetacard', 'numero', 'rarete', 'total'].every(c => x[c] !== undefined)), true);

        // le fichier passe preparer() de l'importeur : refus attendus, et seulement eux
        const p = Imp.preparer(Imp.entreesDuFichier(JSON.parse(JSON.stringify(entrees))));
        H.v('preparer() : 8 lus, 6 importés, 2 refusés', [p.lus, p.importes, p.refuses], [8, 6, 2]);
        H.v('preparer() : motifs = substitut sans mention + vignette absente, rien d\'autre', p.motifs, { 'visuel de substitution sans mention': 1, 'vignette absente': 1 });
        H.v('le résumé de l\'exporteur reprend celui de l\'importeur', X.resumer({ entrees, denominateurs: d }, Imp).includes(Imp.resume(p)), true);

        // une règle du site introuvable LÈVE (jamais un repli)
        let lev = null; try { await X.exporter({ cartes: facadeLecture(cx.db), prod: facadeLecture(cp.db), regle: { ...regle, setParImpression: undefined } }); } catch (x) { lev = x.message; }
        H.v('règle sans setParImpression : l\'exporteur lève en la nommant', /setParImpression/.test(lev || ''), true);
        lev = null; try { await X.exporter({ cartes: facadeLecture(cx.db), prod: facadeLecture(cp.db), regle: { ...regle, cardmarketUrl: undefined } }); } catch (x) { lev = x.message; }
        H.v('règle sans cardmarketUrl : l\'exporteur lève en la nommant', /cardmarketUrl/.test(lev || ''), true);
        lev = null; try { await X.chargerRegle({ importer: async () => { throw new Error('introuvable'); } }); } catch (x) { lev = x.message; }
        H.v('cardmarket.ts introuvable : chargerRegle lève (pas de règle vide)', lev, 'introuvable');
        lev = null; try { await X.chargerRegle({ importer: async () => ({}) }); } catch (x) { lev = x.message; }
        H.v('cardmarket.ts sans cardmarketUrl : chargerRegle lève en la nommant', /cardmarketUrl/.test(lev || ''), true);
        // une base de cartes vide n'est pas « zéro visuel » : c'est une base fausse
        lev = null; try { await X.exporter({ cartes: facadeLecture(cp.db), prod: facadeLecture(cp.db), regle }); } catch (x) { lev = x.message; }
        H.v('base sans sets : l\'exporteur lève (un vide parfait est une base fausse)', typeof lev === 'string' && /sets/.test(lev), true);
    } finally { await cx.close(); await cp.close(); await H.arreterBanc(); }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

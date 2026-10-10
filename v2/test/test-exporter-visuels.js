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
            { _id: 'Set-B', idExpansion: 200, code: 'SB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } },
            { _id: 'Set-JP', idExpansion: 300, code: 'SJ', nomAffichage: 'Set JP', tirage: 'jp', region: 'jp', bulba: { expansion: 'Set JP' } }]);
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
            { ...carte(10, [], [im('Set-B', '010', 'orig')]), sets: ['Set-B'] },                            // porte le fichier du substitut (cartes/orig.webp)
            carte(20, [imp('020')], [im('Set-A', '020', 'c20')]),                                           // produit SANS fiche du site (numéro 999 contredit)
            carte(21, [imp('021')], []),                                                                    // substitut dont le fichier n'est porté par AUCUNE entrée images
            { ...carte(22, [{ tirage: 'jp', expansion: 'Set JP', numero: '001', total: '10', rarete: null }], [im('Set-JP', '001', 'jp22', { langue: 'ja', source: 'artofpkm' })]), sets: ['Set-JP'] },   // tirage jp
            carte(23, [imp('013')], [im('Set-A', '013', 'c23', { langue: 'ja' })])]);                       // scan japonais sur un set intl : refusé par la règle du site
        await cx.db.collection('cartes_produits').insertMany([
            ligne(1001, 1, '001'), ligne(1002, 2, '002', { visuelSubstitut: subst({ mention: MENTION }) }),
            ligne(1003, 3, '003', { visuelSubstitut: subst({}) }), ligne(1004, 4, '004'), ligne(1005, 5, '005'),
            ligne(1006, 6, '006'), ligne(1007, 7, '007'), ligne(1008, 8, '008'), ligne(1009, 9, '009'),
            ligne(1010, 20, '999'), ligne(1014, 21, '021', { visuelSubstitut: subst({ cleR2: 'cartes/seul.webp', mention: MENTION }) }),
            ligne(1012, 22, '001', { idExpansion: 300, slugSet: 'Set-JP' }), ligne(1013, 23, '013')]);
        const metas = [[1001, 5001], [1002, 5002], [1003, 5003], [1004, 5004], [1005, 5005], [1007, 5007], [1008, 5008], [1009, 5009], [1010, 5010], [1012, 5012], [1013, 5013], [1014, 5014], [9999, 5999]];   // 1006 absent du catalogue ; 9999 sans ligne
        await cp.db.collection('catalogue_produits').insertMany(metas.map(([idProduct, idMetacard]) => ({ idProduct, idMetacard, name: `P${idProduct}` })));

        const regle = await X.chargerRegle();
        const lire = () => X.exporter({ cartes: facadeLecture(cx.db), prod: facadeLecture(cp.db), regle });
        const { entrees, denominateurs: d } = await lire();
        const e = id => entrees.find(x => x.idProduct === id);

        H.v('dénominateurs : catalogue 13, produits à ligne 13, catalogue sans ligne 1', [d.catalogue, d.avecLigne, d.sansLigne], [13, 13, 1]);
        H.v('dénominateurs : du set 6, substitut 3, autre tirage 1, aucun 2, sans fiche du site 1 (somme = 13)', [d.duSet, d.substitut, d.autreTirage, d.aucun, d.sansFicheDuSite], [6, 3, 1, 2, 1]);
        H.v('entrées écrites : 10 (ni le produit sans visuel, ni le produit sans fiche)', [entrees.length, d.ecrites], [10, 10]);
        H.v('1005 (aucun visuel) absent du fichier', e(1005), undefined);
        H.v('1010 (sans fiche du site) absent du fichier : la politique des logos, pas un repli sur numeroFiche', e(1010), undefined);
        H.v('1012 tirage jp : visuel japonais admis par la règle du site pour un set jp', [e(1012).visuel, e(1012).vignette.cle, e(1012).setNom], ['du-set', 'vignettes/jp22.webp', 'Set JP']);
        H.v('1013 scan japonais sur un set intl : refusé par la règle du site, donc aucun visuel', e(1013), undefined);
        H.v('1014 substitut dont le fichier n\'est porté par aucune entrée images : vignette absente, jamais devinée', [e(1014).visuel, 'vignette' in e(1014), e(1014).grande], ['substitut', false, { cle: 'cartes/seul.webp', w: 600, h: 838 }]);

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
        H.v('preparer() : 10 lus, 7 importés, 3 refusés', [p.lus, p.importes, p.refuses], [10, 7, 3]);
        H.v('preparer() : motifs = substitut sans mention + 2 vignettes absentes (1009, 1014), rien d\'autre', p.motifs, { 'visuel de substitution sans mention': 1, 'vignette absente': 2 });

        // UN SEUL exemplaire de la décision de visuel : la fonction des logos, paramétrée (jamais copiée) sur la politique du substitut sans mention
        const L = require('../../exporter-donnees-logos-site');
        const base = { ligne: { carteId: 3, visuelSubstitut: { cleR2: 'x.webp', set: 'Set-B' } }, carte: { images: [] }, set: { _id: 'Set-A', tirage: 'intl' },
            fiche: { carteId: 3, numero: '003' }, regle, setsBase: new Map([['Set-B', { nomAffichage: 'Set B' }]]) };
        H.v('choisirVisuel, politique repli (logos) : mention de repli', L.choisirVisuel({ ...base, substitutSansMention: 'repli' }).mention, 'Visuel de la carte d\'origine (Set B) — pas celui de ce produit');
        H.v('choisirVisuel, politique refus (v2) : mention null, rien d\'inventé', L.choisirVisuel({ ...base, substitutSansMention: 'refus' }).mention, null);
        let pol = null; try { L.choisirVisuel({ ...base }); } catch (x) { pol = x.message; }
        H.v('choisirVisuel sans politique : lève (le choix est nommé, jamais un défaut)', /substitutSansMention/.test(pol || ''), true);
        H.v('l\'exporteur v2 n\'a plus de copie de la décision (il appelle choisirVisuel)', /choisirVisuel\(/.test(require('fs').readFileSync(require.resolve('../migrations/exporter-visuels'), 'utf8')) && !/visuelAutreTirage\(/.test(require('fs').readFileSync(require.resolve('../migrations/exporter-visuels'), 'utf8')), true);
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

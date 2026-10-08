'use strict';
// B1b.4 — visuels servis depuis NOS fichiers, impressions sans lien anonyme. Base EN MÉMOIRE (H.ouvrirBac), aucun réseau.
// L'extrait importé est FABRIQUÉ (le vrai table-maitresse-produits.json ne porte pas de visuel : voir le commit) ; jamais le vrai fichier.
const fs = require('fs'); const os = require('os'); const path = require('path');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const V = require('../identifier/visuels'); const Imp = require('../migrations/importer-visuels');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const HOTE = cfg.images.hotesPublics[0];
const img = (cle, w = 245, h = 342) => ({ cle, w, h });
const brut = (id, o = {}) => ({ idProduct: id, vignette: img(`vignettes/${id}.webp`, 200, 279), grande: img(`cartes/${id}.webp`, 600, 838), visuel: 'du-set', mention: null, ...o });

(async () => {
    await H.ouvrirBac('test-identifier-visuels.js'); await M.creerIndex();
    const nV = () => db.col('visuels').countDocuments({});

    // 2 + 3 + 4. l'import : refus, dénominateurs, additif
    const lot = [
        brut(1001), brut(1002, { grande: null }),
        brut(1003, { vignette: img('https://exemple.org/x.webp') }),                       // ://
        brut(1004, { vignette: img('vignettes/../secret.webp') }),                          // ..
        brut(1005, { grande: img('cartes/Cardmarket/1005.webp') }),                         // cardmarket (casse ignorée)
        brut(1006, { visuel: 'substitut', mention: null }),                                 // substitut sans mention
        brut(1007, { visuel: 'substitut', mention: '   ' }),                                // mention vide
        brut(1008, { visuel: 'substitut', mention: 'Visuel de la carte d\'origine — pas celui de ce produit' }),
        { idProduct: 1009, grande: null },                                                  // vignette absente
        brut('1010')                                                                        // idProduct non entier
    ];
    const r1 = await Imp.importerVisuels(lot);
    H.v('import : 10 lus, 3 importés, 7 refusés', [r1.lus, r1.importes, r1.refuses], [10, 3, 7]);
    H.v('   en base : 3 documents', await nV(), 3);
    H.v('   motifs comptés (7 refus, un motif chacun)', Object.values(r1.motifs).reduce((a, b) => a + b, 0), 7);
    H.vrai('   la phrase imprimée porte les trois nombres', /10 lus, 3 importés, 7 refusés \(/.test(Imp.resume(r1)));
    H.v('   1003/1004/1005 (://, .., cardmarket) absents', await db.col('visuels').countDocuments({ idProduct: { $in: [1003, 1004, 1005] } }), 0);
    H.v('   1006/1007 (substitut sans mention) absents, 1008 présent', [await db.col('visuels').countDocuments({ idProduct: { $in: [1006, 1007] } }), await db.col('visuels').countDocuments({ idProduct: 1008 })], [0, 1]);
    const d1001 = await db.col('visuels').findOne({ idProduct: 1001 });
    H.v('   forme du document', { vignette: d1001.vignette, grande: d1001.grande, mention: d1001.mention }, { vignette: img('vignettes/1001.webp', 200, 279), grande: img('cartes/1001.webp', 600, 838), mention: null });
    // additif : rejouer met à jour par idProduct, n'efface rien
    const r2 = await Imp.importerVisuels([brut(1001, { vignette: img('vignettes/1001-bis.webp', 210, 293) }), brut(1011)]);
    H.v('import additif : 2 lus, 2 importés, 0 refusé', [r2.lus, r2.importes, r2.refuses], [2, 2, 0]);
    H.v('   4 documents (aucun effacé), 1001 mis à jour', [await nV(), (await db.col('visuels').findOne({ idProduct: 1001 })).vignette.cle], [4, 'vignettes/1001-bis.webp']);
    // le même idProduct deux fois dans un lot : un seul document, compté
    const r3 = await Imp.importerVisuels([brut(1012), brut(1012, { vignette: img('vignettes/1012-b.webp') })]);
    H.v('doublon dans le lot : 1 document, le dernier gagne', [await db.col('visuels').countDocuments({ idProduct: 1012 }), (await db.col('visuels').findOne({ idProduct: 1012 })).vignette.cle, r3.lus], [1, 'vignettes/1012-b.webp', 2]);

    // 1. resoudre
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
    // un document malveillant déjà en base n'est jamais servi (défense à la lecture)
    await db.col('visuels').insertMany([
        { idProduct: 2001, vignette: img('https://evil.example/x.webp'), grande: null, mention: null },
        { idProduct: 2002, vignette: img('vignettes/ok.webp'), grande: img('../x.webp'), mention: null },
        { idProduct: 2003, vignette: img('vignettes/cardmarket-x.webp'), grande: null, mention: null }]);
    H.v('   documents posés hors import avec clé interdite : jamais servis (grande fausse => grande null, vignette fausse => null)',
        [await S.resoudre(2001), (await S.resoudre(2002)).grande, await S.resoudre(2003)], [null, null, null]);

    // 5. impressions
    const P = db.col;
    await P('catalogue_produits').insertMany([3001, 3002, 3003, 3004, 3005].map(id => ({ idProduct: id, name: 'Pikachu', idExpansion: 9, idMetacard: 77 })).concat([{ idProduct: 3999, name: 'Autre', idExpansion: 9, idMetacard: 78 }]));
    await P('numeros_cartes').insertMany([
        { idProduct: 3001, numero: '58', slug: 'Pikachu-V1-BS58', slugSet: 'Base-Set', variante: 'V1' },
        { idProduct: 3002, numero: '58', slug: 'Pikachu-V2-BS58', slugSet: 'Base-Set 2', variante: 'V2' },
        { idProduct: 3003, numero: null, slug: 'Pikachu-X', slugSet: 'Jungle' },
        { idProduct: 3004, numero: '12', slug: 'Pikachu-JU12', slugSet: 'Jungle' },
        { idProduct: 3005, numero: '5', slug: null, slugSet: null },
        { idProduct: 3999, numero: '1', slug: 'Autre-1', slugSet: 'Base-Set' }]);
    await P('guide_prix').insertOne({ idProduct: 3004, trend: 4.5, low: 2, avg30: 3.1, guideDu: '2026-10-01' });
    // rareté LUE : 3001 et 3004 ont une rareté sur cartes.impressions[] au numéro de la fiche ; 3002 non ; 3005 oui mais sans slug
    await P('cartes').insertMany([
        { _id: 'c1', impressions: [{ numero: '58', rarete: 'Rare Holo' }, { numero: '60', rarete: 'Commune' }] },
        { _id: 'c4', impressions: [{ numero: '12', rarete: 'Rare' }] },
        { _id: 'c5', impressions: [{ numero: '5', rarete: 'Commune' }] }]);
    await P('cartes_produits').insertMany([{ idProduct: 3001, carteId: 'c1', numeroFiche: '58' }, { idProduct: 3004, carteId: 'c4', numeroFiche: '12' }, { idProduct: 3005, carteId: 'c5', numeroFiche: '5' },
        { idProduct: 3002, carteId: 'c1', numeroFiche: '999' }]);
    const imps = await S.impressions(77);
    const par = Object.fromEntries(imps.map(i => [i.idProduct, i]));
    H.v('impressions : les 5 produits de la métacarte 77, pas le 3999 (dénominateur 5)', imps.map(i => i.idProduct).sort(), [3001, 3002, 3003, 3004, 3005]);
    H.v('   numéro ET rareté connus + slug : lien Cardmarket', par[3001].lien, 'https://www.cardmarket.com/en/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58');
    H.v('   rareté lue au numéro de la fiche', [par[3001].rarete, par[3004].rarete], ['Rare Holo', 'Rare']);
    H.v('   rareté NON lue (numéro de fiche sans impression) : null et lien null', [par[3002].rarete, par[3002].lien], [null, null]);
    H.v('   numéro inconnu : lien null (jamais anonyme)', [par[3003].numero, par[3003].lien], [null, null]);
    H.v('   sans slug : lien null même avec numéro et rareté', [par[3005].rarete, par[3005].lien], ['Commune', null]);
    H.v('   variante V1 non sémantique : null (jamais devinée)', [par[3001].variante, par[3002].variante], [null, null]);
    H.v('   prix guide daté (jamais sans date)', [par[3004].prixGuide, par[3001].prixGuide], [{ tendance: 4.5, de: 2, moyenne30: 3.1, date: '2026-10-01' }, null]);
    H.v('   clés d\'une impression', Object.keys(par[3001]), ['idProduct', 'numero', 'total', 'rarete', 'variante', 'set', 'lien', 'lienCardmarket', 'prixGuide']);
    H.v('   métacarte inconnue ou non entière : []', [await S.impressions(424242), await S.impressions('77'), await S.impressions(null)], [[], [], []]);
    const sansLecture = V.creerVisuels({ cfg, rareteDe: async () => null });
    H.v('   rareteDe injecté qui ne lit rien : aucun lien', (await sansLecture.impressions(77)).every(i => i.lien === null && i.rarete === null), true);

    // 6. le CLI : --base=test refusé sans --confirmer-production (aucune connexion), import réel sur --base=test_scratch
    const f = path.join(os.tmpdir(), `visuels-banc-${process.pid}.json`); fs.writeFileSync(f, JSON.stringify([brut(4001), brut(4002, { vignette: img('x://y') })]));
    const script = path.join(__dirname, '..', 'migrations', 'importer-visuels.js');
    const refus = await H.lancerNode([script, `--depuis=${f}`, '--base=test']);
    H.v('CLI --base=test sans --confirmer-production : refusé (code 1, message)', [refus.status, /confirmer-production/.test(refus.stderr), /importés/.test(refus.stdout)], [1, true, false]);
    const sansDepuis = await H.lancerNode([script, '--base=test_scratch']);
    H.v('CLI sans --depuis : refusé', sansDepuis.status, 1);
    const manque = path.join(os.tmpdir(), `visuels-banc-manque-${process.pid}.json`); fs.writeFileSync(manque, JSON.stringify([{ idProduct: 1, image: 'ancien format' }]));
    const arret = await H.lancerNode([script, `--depuis=${manque}`, '--base=test_scratch']);
    H.v('CLI : un fichier qui ne porte pas les champs attendus arrête le script (rien importé)', [arret.status, /champ/.test(arret.stderr + arret.stdout)], [1, true]);
    const ok = await H.lancerNode([script, `--depuis=${f}`, '--base=test_scratch']);
    H.v('CLI --base=test_scratch : code 0, "2 lus, 1 importés, 1 refusés"', [ok.status, /2 lus, 1 importés, 1 refusés/.test(ok.stdout)], [0, true]);
    const brutCol = require('mongoose').connection.db.collection('visuels');
    H.v('   écrit dans la base de banc (collection nue de l\'enfant)', await brutCol.countDocuments({ idProduct: 4001 }), 1);
    await brutCol.drop().catch(() => { });
    fs.unlinkSync(f); fs.unlinkSync(manque);

    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });

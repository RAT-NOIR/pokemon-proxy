'use strict';
// B1b.4 — visuels servis depuis NOS fichiers, impressions sans lien anonyme. Base EN MÉMOIRE (H.ouvrirBac), aucun réseau.
// L'extrait importé est FABRIQUÉ (le vrai table-maitresse-produits.json ne porte pas de visuel) ; jamais le vrai fichier.
// 🔑 L'API ne lit JAMAIS la base `cartes` (autre grappe) : ce banc n'y crée ni `cartes`, ni `cartes_produits`, ni `catalogue_produits`, ni
// `numeros_cartes` — les impressions et les liens doivent rester justes sans elles (un banc à base unique ne pouvait pas le voir).
const fs = require('fs'); const os = require('os'); const path = require('path');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const V = require('../identifier/visuels'); const Imp = require('../migrations/importer-visuels'); const { construireProduit } = require('../identifier/produit');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const HOTE = cfg.images.hotesPublics[0];
const img = (cle, w = 245, h = 342) => ({ cle, w, h });
const CM = 'https://www.cardmarket.com/en/Pokemon/Products/Singles';
const brut = (id, o = {}) => ({ idProduct: id, vignette: img(`vignettes/${id}.webp`, 200, 279), grande: img(`cartes/${id}.webp`, 600, 838), visuel: 'du-set', mention: null,
    idMetacard: null, numero: null, rarete: null, total: null, variante: null, setNom: null, lien: null, ...o });

(async () => {
    await H.ouvrirBac('test-identifier-visuels.js'); await M.creerIndex();
    const nV = () => db.col('visuels').countDocuments({});

    // 2 + 3 + 4. l'import : refus, dénominateurs, additif
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
    const r1 = await Imp.importerVisuels(lot);
    H.v('import : 14 lus, 3 importés, 11 refusés', [r1.lus, r1.importes, r1.refuses], [14, 3, 11]);
    H.v('   en base : 3 documents', await nV(), 3);
    H.v('   motifs comptés (11 refus, un motif chacun)', Object.values(r1.motifs).reduce((a, b) => a + b, 0), 11);
    H.vrai('   la phrase imprimée porte les trois nombres', /14 lus, 3 importés, 11 refusés \(/.test(Imp.resume(r1)));
    H.v('   1003/1004/1005/1013/1014 (://, .., cardmarket, //, /./) absents', await db.col('visuels').countDocuments({ idProduct: { $in: [1003, 1004, 1005, 1013, 1014] } }), 0);
    H.v('   1006/1007 (substitut sans mention) absents, 1008 présent', [await db.col('visuels').countDocuments({ idProduct: { $in: [1006, 1007] } }), await db.col('visuels').countDocuments({ idProduct: 1008 })], [0, 1]);
    H.v('   1015 (idMetacard absent) et 1016 (lien hors Cardmarket) absents', await db.col('visuels').countDocuments({ idProduct: { $in: [1015, 1016] } }), 0);
    const d1001 = await db.col('visuels').findOne({ idProduct: 1001 });
    H.v('   forme du document (visuel + impression)', { vignette: d1001.vignette, grande: d1001.grande, mention: d1001.mention, idMetacard: d1001.idMetacard, numero: d1001.numero, rarete: d1001.rarete, total: d1001.total },
        { vignette: img('vignettes/1001.webp', 200, 279), grande: img('cartes/1001.webp', 600, 838), mention: null, idMetacard: null, numero: null, rarete: null, total: null });
    // additif : rejouer met à jour par idProduct, n'efface rien
    const r2 = await Imp.importerVisuels([brut(1001, { vignette: img('vignettes/1001-bis.webp', 210, 293) }), brut(1011)]);
    H.v('import additif : 2 lus, 2 importés, 0 refusé, 0 doublon', [r2.lus, r2.importes, r2.refuses, r2.doublons], [2, 2, 0, 0]);
    H.v('   4 documents (aucun effacé), 1001 mis à jour', [await nV(), (await db.col('visuels').findOne({ idProduct: 1001 })).vignette.cle], [4, 'vignettes/1001-bis.webp']);
    // le même idProduct deux fois dans un lot : un seul document, COMPTÉ et imprimé
    const r3 = await Imp.importerVisuels([brut(1012), brut(1012, { vignette: img('vignettes/1012-b.webp') })]);
    H.v('doublon dans le lot : 1 document, le dernier gagne, 1 doublon compté', [await db.col('visuels').countDocuments({ idProduct: 1012 }), (await db.col('visuels').findOne({ idProduct: 1012 })).vignette.cle, r3.lus, r3.doublons], [1, 'vignettes/1012-b.webp', 2, 1]);
    H.vrai('   la phrase imprimée nomme le doublon', /1 doublon/.test(Imp.resume(r3)));

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
    await db.col('visuels').insertMany([
        { idProduct: 2001, vignette: img('https://evil.example/x.webp'), grande: null, mention: null },
        { idProduct: 2002, vignette: img('vignettes/ok.webp'), grande: img('../x.webp'), mention: null },
        { idProduct: 2003, vignette: img('vignettes/cardmarket-x.webp'), grande: null, mention: null },
        { idProduct: 2004, vignette: img('vignettes//x.webp'), grande: null, mention: null }]);
    H.v('   documents posés hors import avec clé interdite : jamais servis (grande fausse => grande null)',
        [await S.resoudre(2001), (await S.resoudre(2002)).grande, await S.resoudre(2003), await S.resoudre(2004)], [null, null, null, null]);

    // 5. impressions : TOUT vient de `visuels` (+ le guide de prix de la base de production). Aucune lecture de `cartes`.
    await db.col('guide_prix').insertOne({ idProduct: 3004, trend: 4.5, low: 2, avg30: 3.1, guideDu: '2026-10-01' });
    const I = (id, o) => brut(id, { idMetacard: 77, setNom: 'Base Set', ...o });
    const r5 = await Imp.importerVisuels([
        I(3001, { numero: '58', total: '102', rarete: 'Rare Holo', variante: 'premiere-edition', lien: `${CM}/Base-Set/Pikachu-V1-BS58` }),
        I(3002, { numero: '58', rarete: null, lien: `${CM}/Base-Set/Pikachu-V2-BS58` }),                // rareté non lue : jamais devinée
        I(3003, { numero: null, rarete: 'Commune', lien: `${CM}/Jungle/Pikachu-X` }),                  // numéro inconnu
        I(3004, { numero: '12', rarete: 'Rare', setNom: 'Jungle', variante: 'V1', lien: `${CM}/Jungle/Pikachu-JU12` }),
        I(3005, { numero: '5', rarete: 'Commune', lien: null }),                                         // lien non donné
        I(3999, { idMetacard: 78, numero: '1', rarete: 'Rare', lien: `${CM}/Base-Set/Autre-1` })]);
    H.v('impressions : 6 importés', r5.importes, 6);
    const imps = await S.impressions(77);
    const par = Object.fromEntries(imps.map(i => [i.idProduct, i]));
    H.v('impressions : les 5 produits de la métacarte 77, pas le 3999 (dénominateur 5)', imps.map(i => i.idProduct).sort(), [3001, 3002, 3003, 3004, 3005]);
    H.v('   ordre : numéro croissant, sans numéro en dernier', imps.map(i => i.idProduct), [3005, 3004, 3001, 3002, 3003]);
    H.v('   numéro ET rareté connus + lien donné : lien Cardmarket', par[3001].lien, `${CM}/Base-Set/Pikachu-V1-BS58`);
    H.v('   numéro, total, rareté, set repris de l\'import', [par[3001].numero, par[3001].total, par[3001].rarete, par[3001].set], ['58', '102', 'Rare Holo', { nom: 'Base Set' }]);
    H.v('   rareté NON lue : null et lien null (le lien donné est tu)', [par[3002].rarete, par[3002].lien], [null, null]);
    H.v('   numéro inconnu : lien null (jamais anonyme)', [par[3003].numero, par[3003].lien], [null, null]);
    H.v('   lien non donné : null même avec numéro et rareté', [par[3005].rarete, par[3005].lien], ['Commune', null]);
    H.v('   variante de la liste conservée, hors liste (V1) : null', [par[3001].variante, par[3004].variante], ['premiere-edition', null]);
    H.v('   prix guide daté, forme de LIGNE de catalogue (jamais sans date)', [par[3004].prixGuide, par[3001].prixGuide], [{ trend: 4.5, low: 2, avg30: 3.1, guideDu: '2026-10-01' }, null]);
    H.v('   clés d\'une impression : `lien` seul (contrat 2)', Object.keys(par[3001]), ['idProduct', 'numero', 'total', 'rarete', 'variante', 'set', 'lien', 'prixGuide']);
    H.v('   métacarte inconnue ou non entière : []', [await S.impressions(424242), await S.impressions('77'), await S.impressions(null)], [[], [], []]);
    // le sortie de impressions() traverse construireProduit (produit.js lit `lien`) : le contrat 2 sort intact
    const prod = construireProduit({ idProduct: 3001, nomCardmarket: 'Pikachu', set: { slug: 'base-set', nom: 'Base Set' }, impressions: imps }, { cfg });
    const pp = Object.fromEntries(prod.impressions.map(i => [i.idProduct, i]));
    H.v('   via construireProduit : lien conservé, prixGuide au contrat, lien null reste null',
        [pp[3001].lien, pp[3004].prixGuide, pp[3002].lien], [`${CM}/Base-Set/Pikachu-V1-BS58`, { tendance: 4.5, de: 2, moyenne30: 3.1, date: '2026-10-01' }, null]);
    // la base de l'API ne contient aucune collection de l'autre grappe
    const noms = (await require('mongoose').connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name.replace(db.prefixeCourant(), ''));
    H.v('aucune collection cartes / cartes_produits / catalogue_produits / numeros_cartes dans la base de l\'API (dénominateur ' + noms.length + ')',
        noms.filter(n => ['cartes', 'cartes_produits', 'catalogue_produits', 'numeros_cartes'].includes(n)), []);
    // index : visuels.idMetacard, créé par creerIndex, utilisé par la requête
    H.v('index visuels_metacarte présent et conforme', (await M.verifierIndex()).manquants, []);
    H.vrai('   la lecture par idMetacard passe par l\'index (IXSCAN)', JSON.stringify(await db.col('visuels').find({ idMetacard: 77 }).explain()).includes('IXSCAN'));

    // garde de collections : liste fermée
    H.v('liste fermée des collections lues', V.COLLECTIONS_LUES, ['visuels', 'guide_prix']);
    let leve = null; try { V.colLue('cartes'); } catch (e) { leve = e.message; }
    H.vrai('   colLue("cartes") refusé', leve && /cartes/.test(leve));
    leve = null; try { V.colLue('cartes_produits'); } catch (e) { leve = e.message; }
    H.vrai('   colLue("cartes_produits") refusé', leve);
    H.vrai('   colLue("visuels") admis', V.colLue('visuels'));
    const src = fs.readFileSync(path.join(__dirname, '..', 'identifier', 'visuels.js'), 'utf8');
    const nommees = [...src.matchAll(/\b(?:colLue|col)\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    H.vrai(`   visuels.js ne nomme que des collections de la liste (${nommees.length} appels : ${[...new Set(nommees)].join(', ')})`, nommees.length > 0 && nommees.every(n => V.COLLECTIONS_LUES.includes(n)));
    H.vrai('   visuels.js ne nomme jamais cartes_produits ni numeros_cartes ni catalogue_produits',
        !/cartes_produits|numeros_cartes|catalogue_produits/.test(src.replace(/\/\/.*$/gm, '')));

    // taille : estimation et garde (par ce qu'elle AUTORISE)
    const docs = [brut(5001), brut(5002), brut(5003)];
    const e3 = Imp.estimerAjout(docs), e6 = Imp.estimerAjout([...docs, ...docs]);
    H.vrai('estimation : positive, ×2 pour ×2 documents', e3.total > 0 && Math.abs(e6.total / e3.total - 2) < 0.01);
    H.vrai('   détaille documents et index', e3.octetsDocs > 0 && e3.octetsIndex > 0 && e3.n === 3);
    H.v('garde : 465 Mo + 3 Mo admis', Imp.garderTaille({ actuel: 465e6, ajout: 3e6 }).ok, true);
    H.v('   465 Mo + 6 Mo refusé (> 470 Mo)', Imp.garderTaille({ actuel: 465e6, ajout: 6e6 }).ok, false);
    H.v('   taille illisible (NaN, undefined, null, texte) : refusé', [NaN, undefined, null, '400'].map(a => Imp.garderTaille({ actuel: a, ajout: 1 }).ok), [false, false, false, false]);
    H.v('   ajout illisible : refusé', [NaN, undefined, -1].map(a => Imp.garderTaille({ actuel: 1e6, ajout: a }).ok), [false, false, false]);
    H.v('   un plafond plus haut que 470 Mo n\'est pas obéi', Imp.garderTaille({ actuel: 475e6, ajout: 1, plafond: 1e12 }).ok, false);
    H.v('   un plafond plus bas est obéi', Imp.garderTaille({ actuel: 1e6, ajout: 1e6, plafond: 1.5e6 }).ok, false);

    // 6. le CLI
    const f = path.join(os.tmpdir(), `visuels-banc-${process.pid}.json`); fs.writeFileSync(f, JSON.stringify([brut(4001), brut(4002, { vignette: img('x://y') })]));
    const script = path.join(__dirname, '..', 'migrations', 'importer-visuels.js');
    const brutCol = () => require('mongoose').connection.db.collection('visuels');
    const sim = await H.lancerNode([script, `--depuis=${f}`]);
    H.v('CLI simulation (sans --ecrire, sans --base) : code 0, estimation imprimée, rien écrit', [sim.status, /estimation/i.test(sim.stdout), /2 lus, 1 importés, 1 refusés/.test(sim.stdout), await brutCol().countDocuments({ idProduct: 4001 })], [0, true, true, 0]);
    const refus = await H.lancerNode([script, `--depuis=${f}`, '--base=test', '--ecrire']);
    H.v('CLI --ecrire --base=test sans --confirmer-production : refusé (code 1, message)', [refus.status, /confirmer-production/.test(refus.stderr), /importés/.test(refus.stdout)], [1, true, false]);
    const cartes = await H.lancerNode([script, `--depuis=${f}`, '--base=cartes', '--ecrire']);
    H.v('CLI --base=cartes refusé (test et test_scratch seulement)', [cartes.status, /test_scratch/.test(cartes.stderr)], [1, true]);
    const sansBase = await H.lancerNode([script, `--depuis=${f}`, '--ecrire']);
    H.v('CLI --ecrire sans --base : refusé', sansBase.status, 1);
    const sansDepuis = await H.lancerNode([script, '--base=test_scratch', '--ecrire']);
    H.v('CLI sans --depuis : refusé', sansDepuis.status, 1);
    const manque = path.join(os.tmpdir(), `visuels-banc-manque-${process.pid}.json`); fs.writeFileSync(manque, JSON.stringify([{ idProduct: 1, image: 'ancien format' }]));
    const arret = await H.lancerNode([script, `--depuis=${manque}`, '--base=test_scratch', '--ecrire']);
    H.v('CLI : un fichier qui ne porte pas les champs attendus arrête le script (rien importé)', [arret.status, /champ/.test(arret.stderr + arret.stdout)], [1, true]);
    const sansMetaF = path.join(os.tmpdir(), `visuels-banc-sansmeta-${process.pid}.json`); fs.writeFileSync(sansMetaF, JSON.stringify([{ idProduct: 1, vignette: img('v/1.webp') }]));
    const arret2 = await H.lancerNode([script, `--depuis=${sansMetaF}`, '--base=test_scratch', '--ecrire']);
    H.v('CLI : un fichier sans idMetacard/numero/rarete/total arrête le script', [arret2.status, /idMetacard/.test(arret2.stderr)], [1, true]);
    const plafond = await H.lancerNode([script, `--depuis=${f}`, '--base=test_scratch', '--ecrire', '--plafond-mo=0.0001']);
    H.v('CLI --ecrire : la grappe passerait au-dessus du plafond => refusé, rien écrit', [plafond.status, /plafond/i.test(plafond.stderr), await brutCol().countDocuments({ idProduct: 4001 })], [1, true, 0]);
    const ok = await H.lancerNode([script, `--depuis=${f}`, '--base=test_scratch', '--ecrire']);
    H.v('CLI --ecrire --base=test_scratch : code 0, "2 lus, 1 importés, 1 refusés"', [ok.status, /2 lus, 1 importés, 1 refusés/.test(ok.stdout)], [0, true]);
    H.v('   écrit dans la base de banc (collection nue de l\'enfant)', await brutCol().countDocuments({ idProduct: 4001 }), 1);
    H.vrai('   l\'enfant a créé l\'index idMetacard (creerIndex)', (await brutCol().indexes()).some(i => i.name === 'visuels_metacarte'));
    await brutCol().drop().catch(() => { });
    for (const x of [f, manque, sansMetaF]) fs.unlinkSync(x);

    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });

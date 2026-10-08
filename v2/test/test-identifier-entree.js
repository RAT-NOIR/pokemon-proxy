'use strict';
// B1b.1 : l'entrée du contrat 2 est validée AVANT tout débit. Base EN MÉMOIRE (H.ouvrirBac -> ouvrirBancV2), jamais la production.
const express = require('express');
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const { validerEntree, verifierEntree, comparerVersions } = require('../identifier/routes');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const bon = (sur = {}) => ({ contrat: 2, imageUrls: ['https://images1.vinted.net/t/a.jpg'], title: 'Pikachu', description: 'bon état', prixVinted: 12.5, devise: 'EUR',
    marche: 'vinted.fr', langueInterface: 'fr', versionExtension: '2.0.0', vintedUrl: 'https://www.vinted.fr/items/1', ...sur });
(async () => {
    await H.ouvrirBac('test-identifier-entree.js');
    let atteints = 0, recu = null;
    const app = express(); app.use(express.json({ strict: false }));
    app.post('/api/identifier', validerEntree(cfg), (req, res) => { atteints++; recu = req.entree; res.json({ success: true }); });
    const srv = await H.serveur(app);
    const mouvements = () => db.col('mouvements').countDocuments({});
    const avant = await mouvements();
    const post = async (corps) => { const a = atteints; const r = await H.appel(srv.url, '/api/identifier', { methode: 'POST', corps }); return { ...r, passe: atteints > a }; };
    const forme = r => [r.statut, r.json?.erreur?.code, r.json?.erreur?.detail ?? null, r.passe];

    H.v('entrée valide : passe au handler', forme(await post(bon())), [200, undefined, null, true]);
    H.v('   req.entree normalisée (marche, versionExtension)', [recu.marche, recu.versionExtension, recu.imageUrls.length], ['vinted.fr', '2.0.0', 1]);
    // images
    H.v('21 URLs : 400 ENTREE', forme(await post(bon({ imageUrls: Array.from({ length: 21 }, (_, i) => `https://images1.vinted.net/${i}.jpg`) }))).slice(0, 2).concat(), [400, 'ENTREE']);
    H.v('20 URLs : accepté', (await post(bon({ imageUrls: Array.from({ length: 20 }, (_, i) => `https://images1.vinted.net/${i}.jpg`) }))).passe, true);
    H.v('URL http:// : 400 ENTREE', forme(await post(bon({ imageUrls: ['http://images1.vinted.net/a.jpg'] }))).slice(0, 2), [400, 'ENTREE']);
    H.v('hôte étranger : 400 image-hote', forme(await post(bon({ imageUrls: ['https://evil.example/x.jpg'] }))), [400, 'ENTREE', 'image-hote', false]);
    H.v('vinted.net.evil.example : 400 image-hote', forme(await post(bon({ imageUrls: ['https://vinted.net.evil.example/x.jpg'] }))), [400, 'ENTREE', 'image-hote', false]);
    H.v('evil.example/?vinted.net : 400 image-hote', forme(await post(bon({ imageUrls: ['https://evil.example/vinted.net'] }))), [400, 'ENTREE', 'image-hote', false]);
    H.v('identifiants dans l\'URL (vinted.net@evil) : 400', forme(await post(bon({ imageUrls: ['https://images1.vinted.net@evil.example/x.jpg'] }))).slice(0, 3), [400, 'ENTREE', 'image-hote']);
    H.v('élément non chaîne : 400', forme(await post(bon({ imageUrls: [42] }))).slice(0, 2), [400, 'ENTREE']);
    H.v('imageUrls non tableau : 400', forme(await post(bon({ imageUrls: 'https://images1.vinted.net/a.jpg' }))).slice(0, 2), [400, 'ENTREE']);
    H.v('aucune image ([]) : 200 IMAGE', forme(await post(bon({ imageUrls: [] }))), [200, 'IMAGE', 'aucune-image', false]);
    const sans = bon(); delete sans.imageUrls;
    H.v('imageUrls absent : 200 IMAGE', forme(await post(sans)).slice(0, 2), [200, 'IMAGE']);
    // textes tronqués
    await post(bon({ title: 'x'.repeat(301), description: 'y'.repeat(4001) }));
    H.v('title > 300 et description > 4000 : tronqués, pas refusés', [recu.title.length, recu.description.length], [300, 4000]);
    // prix, devise
    H.v('prixVinted null accepté', (await post(bon({ prixVinted: null, devise: null }))).passe, true);
    H.v('prixVinted 0 : 400', forme(await post(bon({ prixVinted: 0 }))).slice(0, 2), [400, 'ENTREE']);
    H.v('prixVinted négatif : 400', forme(await post(bon({ prixVinted: -1 }))).slice(0, 2), [400, 'ENTREE']);
    H.v('prixVinted chaîne : 400', forme(await post(bon({ prixVinted: '12' }))).slice(0, 2), [400, 'ENTREE']);
    H.v('devise hors liste : 400', forme(await post(bon({ devise: 'JPY' }))).slice(0, 2), [400, 'ENTREE']);
    // marché
    H.v('marché inconnu : 422 MARCHE', forme(await post(bon({ marche: 'vinted.jp' }))), [422, 'MARCHE', null, false]);
    H.v('marché absent : 422 MARCHE', forme(await post(bon({ marche: undefined }))).slice(0, 2), [422, 'MARCHE']);
    // langue
    await post(bon({ langueInterface: 'de' })); H.v('langueInterface "de" -> fr', recu.langueInterface, 'fr');
    await post(bon({ langueInterface: 'en' })); H.v('langueInterface "en" -> en', recu.langueInterface, 'en');
    await post(bon({ langueInterface: 12 })); H.v('langueInterface non chaîne -> fr, jamais refusée', recu.langueInterface, 'fr');
    // version
    H.v('versionExtension 2.0.0 accepté', (await post(bon({ versionExtension: '2.0.0' }))).passe, true);
    H.v('versionExtension 1.0.5 : 426 VERSION', forme(await post(bon({ versionExtension: '1.0.5' }))), [426, 'VERSION', null, false]);
    H.v('versionExtension 2.0.10 accepté', (await post(bon({ versionExtension: '2.0.10' }))).passe, true);
    H.v('comparerVersions 2.0.10 > 2.0.9 (numérique)', [comparerVersions('2.0.10', '2.0.9') > 0, comparerVersions('2.0.9', '2.0.10') < 0, comparerVersions('2.0.0', '2.0.0')], [true, true, 0]);
    const haute = lireConfig({ MONGODB_BASE: 'test_scratch', V2_VERSION_MIN_EXTENSION: '2.1.0' });
    H.v('cfg.versionMinExtension lue (2.1.0 : 2.0.9 refusée)', verifierEntree(bon({ versionExtension: '2.0.9' }), haute).erreur.code, 'VERSION');
    H.v('versionExtension illisible : 400', forme(await post(bon({ versionExtension: 'abc' }))).slice(0, 2), [400, 'ENTREE']);
    // vintedUrl
    H.v('vintedUrl null accepté', (await post(bon({ vintedUrl: null }))).passe, true);
    H.v('vintedUrl http : 400', forme(await post(bon({ vintedUrl: 'http://www.vinted.fr/items/1' }))).slice(0, 2), [400, 'ENTREE']);
    H.v('vintedUrl hôte inconnu : 400', forme(await post(bon({ vintedUrl: 'https://evil.example/items/1' }))).slice(0, 2), [400, 'ENTREE']);
    H.v('vintedUrl vinted.fr.evil.example : 400', forme(await post(bon({ vintedUrl: 'https://vinted.fr.evil.example/items/1' }))).slice(0, 2), [400, 'ENTREE']);
    // correction n°1 : vintedEtat recopié dans req.entree
    await post(bon({ vintedEtat: 'Bon état' })); H.v('vintedEtat recopié tel quel', recu.vintedEtat, 'Bon état');
    await post(bon({ vintedEtat: null })); H.v('vintedEtat null -> null', recu.vintedEtat, null);
    await post(bon({ vintedEtat: undefined })); H.v('vintedEtat absent -> null', recu.vintedEtat, null);
    await post(bon({ vintedEtat: 5 })); H.v('vintedEtat non chaîne -> null, jamais refusé', recu.vintedEtat, null);
    // correction n°2 : cas manquants
    const sansV = bon(); delete sansV.versionExtension;
    H.v('versionExtension absente : 400 version', forme(await post(sansV)), [400, 'ENTREE', 'version', false]);
    H.v('2.0.0-beta : 400 version', forme(await post(bon({ versionExtension: '2.0.0-beta' }))), [400, 'ENTREE', 'version', false]);
    H.v('v2.0.0 : 400 version (illisible = refus)', forme(await post(bon({ versionExtension: 'v2.0.0' }))), [400, 'ENTREE', 'version', false]);
    H.v('prix sans devise : 400 devise', forme(await post(bon({ prixVinted: 5, devise: null }))), [400, 'ENTREE', 'devise', false]);
    H.v('title non chaîne : 400 title', forme(await post(bon({ title: 42 }))), [400, 'ENTREE', 'title', false]);
    H.v('description non chaîne : 400 description', forme(await post(bon({ description: { a: 1 } }))), [400, 'ENTREE', 'description', false]);
    H.v('vintedUrl valide sur un autre marché connu (vinted.de)', (await post(bon({ vintedUrl: 'https://www.vinted.de/items/2' }))).passe, true);
    // corps
    for (const [nom, c] of [['tableau', []], ['chaîne', 'abc'], ['null', null], ['nombre', 7]])
        H.v(`corps non-objet (${nom}) : 400`, forme(await post(c)).slice(0, 2).concat(forme(await post(c))[3]), [400, 'ENTREE', false]);
    // aucun débit
    H.v('mouvements : 0 écriture sur la base en mémoire pendant tous ces refus et passes', (await mouvements()) - avant, 0);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

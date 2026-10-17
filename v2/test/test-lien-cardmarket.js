'use strict';
// LIEN-CARDMARKET — un lien dès que le numéro est connu (rareté NON exigée), vers la page EXACTE du produit, jamais une recherche (décision du testeur, 2026-10-17).
// UN SEUL jeu de cas, joué contre les TROIS exemplaires de la règle : le producteur de l'archive (chargeur/decision.js), la relecture (identifier/visuels.js) et le Produit (identifier/produit.js).
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const V = require('../identifier/visuels'); const { construireProduit } = require('../identifier/produit'); const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');
const { decider } = require('../chargeur/decision'); const { regleEmbarquee } = require('../chargeur/regle-site');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const CM = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
const OK = `${CM}/Set-A/Carte-SA001`;

// 1. les URL : ce que la garde AUTORISE (la forme exacte) ; tout le reste rend null
const URLS = [
    ['page produit exacte (www)', OK, OK],
    ['page produit exacte (sans www)', 'https://cardmarket.com/en/Pokemon/Products/Singles/Set-A/Carte-SA001', 'https://cardmarket.com/en/Pokemon/Products/Singles/Set-A/Carte-SA001'],
    ['recherche /Products/Search', 'https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=Pikachu', null],
    ['recherche par ?searchString= sur une page produit', `${OK}?searchString=Pikachu`, null],
    ['fragment #', `${OK}#x`, null],
    ['liste d\'expansion (1 segment)', `${CM}/Set-A`, null],
    ['chemin à 3 segments', `${CM}/Set-A/Carte-SA001/Extra`, null],
    ['segment vide (a//b)', `${CM}/Set-A//Carte-SA001`, null],
    ['remontée ..', `${CM}/Set-A/../Carte-SA001`, null],
    ['autre jeu', 'https://www.cardmarket.com/fr/YuGiOh/Products/Singles/Set-A/Carte-SA001', null],
    ['lien par idProduct', 'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=900002', null],
    ['autre hôte', 'https://evil.example/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['sous-domaine voisin', 'https://www.cardmarket.com.evil.example/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['http:', 'http://www.cardmarket.com/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['userinfo', 'https://www.cardmarket.com@evil.example/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['langue absente', 'https://www.cardmarket.com/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['langue allemande (liste fermée)', 'https://www.cardmarket.com/de/Pokemon/Products/Singles/Set-A/Carte-SA001', 'https://www.cardmarket.com/de/Pokemon/Products/Singles/Set-A/Carte-SA001'],
    ['langue es', 'https://www.cardmarket.com/es/Pokemon/Products/Singles/Set-A/Carte-SA001', 'https://www.cardmarket.com/es/Pokemon/Products/Singles/Set-A/Carte-SA001'],
    ['langue it', 'https://www.cardmarket.com/it/Pokemon/Products/Singles/Set-A/Carte-SA001', 'https://www.cardmarket.com/it/Pokemon/Products/Singles/Set-A/Carte-SA001'],
    ['langue inconnue /xx/', 'https://www.cardmarket.com/xx/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['langue /fr-FR/', 'https://www.cardmarket.com/fr-FR/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['% dans un segment (%2F)', `${CM}/Set%2FA/Carte-SA001`, null],
    ['% dans un segment (%41)', `${CM}/Set-A/Carte%41`, null],
    ['segment d\'expansion « Search »', `${CM}/Search/Carte-SA001`, null],
    ['espace dans un segment', `${CM}/Set-A/Carte 1`, null],
    ['espace en tête', ` ${OK}`, null],
    ['espace en fin', `${OK} `, null],
    ['retour ligne dans le chemin', `${CM}/Set-A/Car\nte`, null],
    ['retour ligne en fin', `${OK}\n`, null],
    ['hôte en majuscules', 'https://WWW.CARDMARKET.COM/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['schéma en majuscules', 'HTTPS://www.cardmarket.com/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['port :443', 'https://www.cardmarket.com:443/fr/Pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['casse de « Pokemon »', 'https://www.cardmarket.com/fr/pokemon/Products/Singles/Set-A/Carte-SA001', null],
    ['pas une URL', 'pas une url', null],
    ['null', null, null]];

// 2. les CAS de données : numéro / idProduct / slug / slugSet / rareté -> lien attendu (la rareté n'y change plus rien)
const CAS = [
    ['numéro connu, rareté connue', { numero: '001', rarete: 'Rare' }, OK],
    ['numéro connu, rareté NULL : un lien (le rouge)', { numero: '001', rarete: null }, OK],
    ['numéro null, rareté connue', { numero: null, rarete: 'Rare' }, null],
    ['numéro null, rareté null', { numero: null, rarete: null }, null],
    ['slug absent', { numero: '001', rarete: null, slug: null }, null],
    ['slugSet absent', { numero: '001', rarete: null, slugSet: null }, null],
    ['slug qui porte un ? (recherche déguisée)', { numero: '001', rarete: null, slug: 'X?searchString=a' }, null],
    ['slug qui porte un /', { numero: '001', rarete: null, slug: 'X/Y' }, null]];
const ligneDe = (i, c) => ({ idProduct: 100 + i, carteId: i, idExpansion: 100, numeroFiche: c.numero, slug: 'slug' in c ? c.slug : 'Carte-SA001', slugSet: 'slugSet' in c ? c.slugSet : 'Set-A' });

(async () => {
    await H.ouvrirBac('test-lien-cardmarket.js');
    const P = H.v;

    // A. la garde elle-même (module partagé)
    const G = require('../identifier/lien-cardmarket');
    for (const [nom, u, att] of URLS) P(`garde : ${nom}`, G.lienExact(u), att);

    // B. le Produit : liens.cardmarket ET impressions[].lien passent la MÊME garde
    const base = (o = {}) => ({ idProduct: 1, nomCardmarket: 'X', set: { slug: 's', nom: 'S' }, numero: '001', rarete: null, lienCardmarket: OK, ...o });
    for (const [nom, u, att] of URLS) {
        P(`Produit liens.cardmarket : ${nom}`, construireProduit(base({ lienCardmarket: u }), { cfg }).liens.cardmarket, att);
        P(`Produit impressions[].lien : ${nom}`, construireProduit(base({ impressions: [{ idProduct: 2, numero: '4', rarete: null, lien: u }] }), { cfg }).impressions[0].lien, att);
    }
    P('Produit : numéro connu, rareté null -> lien', construireProduit(base({ rarete: null }), { cfg }).liens.cardmarket, OK);
    P('Produit : numéro null -> null', construireProduit(base({ numero: null }), { cfg }).liens.cardmarket, null);
    P('Produit : impression sans numéro -> null', construireProduit(base({ impressions: [{ idProduct: 2, numero: null, rarete: 'Rare', lien: OK }] }), { cfg }).impressions[0].lien, null);

    // C. le PRODUCTEUR (decision.js) et D. la RELECTURE (visuels.js) sur les mêmes cas
    const regle = await regleEmbarquee();
    const sets = [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }];
    const docs = CAS.map(([, c], i) => ({ _id: i, nomEn: `Carte ${i}`, categorie: 'pokemon', sets: ['Set-A'],
        impressions: [{ tirage: 'intl', expansion: 'Set A', numero: c.numero ?? '001', total: '100', rarete: c.rarete ?? undefined }],
        images: [{ set: 'Set-A', numero: c.numero ?? '001', cleR2: `cartes/${i}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${i}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' }] }));
    const lignes = CAS.map(([, c], i) => ligneDe(i, c));
    const r = await decider({ sets, docs, lignes, metacarte: new Map(lignes.map((l, i) => [l.idProduct, 9000 + i])), regle, cederLaMain: false });
    const produit = new Map(r.entrees.map(e => [e.idProduct, e]));
    CAS.forEach(([nom, c], i) => {
        const e = produit.get(100 + i);
        P(`producteur : ${nom}`, e ? e.lien : '(entrée absente)', c.numero == null && !e ? '(entrée absente)' : CAS[i][2]);
    });

    const dbrut = (id, o) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: null, visuel: 'du-set', mention: null, idMetacard: 77, numero: null, rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
    const entrees = CAS.map(([, c], i) => dbrut(100 + i, { numero: c.numero, rarete: c.rarete, lien: regle.cardmarketUrl({ slug: 'slug' in c ? c.slug : 'Carte-SA001', slugSet: 'slugSet' in c ? c.slugSet : 'Set-A' }) }));
    E.installer(VB.construire(entrees));
    const lu = Object.fromEntries((await V.creerVisuels({ cfg }).impressions(77)).map(i => [i.idProduct, i.lien]));
    CAS.forEach(([nom, , att], i) => P(`relecture : ${nom}`, lu[100 + i], att));
    // les URL de la table 1, relues telles quelles par impressions() (numéro connu, rareté null)
    const urlsOk = URLS.filter(([, u]) => typeof u === 'string' && /^https?:\/\/www\.cardmarket\.com/.test(u) && !u.includes('evil'));
    E.installer(VB.construire(urlsOk.map(([, u], i) => dbrut(500 + i, { numero: '1', rarete: null, lien: u }))));
    const lu2 = Object.fromEntries((await V.creerVisuels({ cfg }).impressions(77)).map(i => [i.idProduct, i.lien]));
    urlsOk.forEach(([nom, , att], i) => P(`relecture d'URL : ${nom}`, lu2[500 + i] ?? null, att));
    E.vider();
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });

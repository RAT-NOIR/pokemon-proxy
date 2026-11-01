// node test-expansion-par-la-page.js — banc : une expansion NEUVE (aucune ligne apprise) est prouvée par l'ADRESSE de la page du journal
// (`idExpansion=<n>` dans `url`, l'adresse que l'userscript écrit : location.pathname + location.search). Sans base, sans réseau.
// Cas du testeur, 2026-11-01 : l'expansion 6704 (DLR, 141 produits, aucune image chez Cardmarket) → 0 appris, « porté par 0 expansions ».
const fs = require('fs'), path = require('path');
const { vignettesDuJournal, deduireLot } = require('./collecte-cartes/deduire-produit');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const URL_6704 = '/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6704';
const lien = (slugSet, slug) => `/en/Pokemon/Products/Singles/${slugSet}/${slug}`;
const entree = (slugSet, slug, titre) => ({ href: lien(slugSet, slug), titre });
const CAT = { 6704: [{ idProduct: 11, name: 'Pidgey' }, { idProduct: 12, name: 'Rattata' }, { idProduct: 13, name: 'Spearow [Peck | Fury]' }, { idProduct: 14, name: 'Doduo' }, { idProduct: 15, name: 'Doduo' }] };
// lecteurs « base vide pour ce slugSet » (aucune ligne apprise), catalogue = CAT ; `appris` peut être surchargé
const deps = (o = {}) => ({
    expansionsDuSlugSet: async () => [],
    produitsDe: async e => CAT[e] || [],
    apprisDe: async () => new Map(),
    slugsPortes: async () => new Set(),
    idsApprisDeLExpansion: async () => [],
    idsAuCatalogue: async ids => new Set(ids),
    ...o
});
const lotDe = journal => vignettesDuJournal(journal).vignettes.map(e => ({ idProduct: null, slug: e.slug, slugSet: e.slugSet, codeSet: e.code, numero: e.numero, nomFr: e.nomFr, href: e.href, sansImage: true, expansionsDePage: e.expansionsDePage }));
const SS = 'Dragon-Light-Rising';

(async () => {
    // 1. la forme exacte de la clé de page lue dans le journal
    const j1 = { journal: [{ v: '1.12', url: URL_6704, exp: 6704, slugSet: SS, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('1. vignettesDuJournal porte les expansions des adresses de page où la vignette est vue', vignettesDuJournal(j1).vignettes.map(v => v.expansionsDePage), [[6704]]);

    // 2. le cas du testeur : déduit
    const j2 = { journal: [{ url: URL_6704, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)'), entree(SS, 'Rattata-DLR2', 'Rattata (DLR 2)'), entree(SS, 'Spearow-DLR3', 'Piafabec (DLR 3)')] }] };
    const r2 = await deduireLot(lotDe(j2), deps());
    verifier('2. page idExpansion=6704, noms désignant chacun UN produit → déduits, expansion 6704', r2.deduites.map(d => [d.idProduct, d.idExpansion, d.expansionLueDansLaPage]), [[11, 6704, true], [12, 6704, true], [13, 6704, true]]);

    // 3. la même vignette vue sur deux pages (même expansion) reste prouvée ; l'ordre de page est indifférent
    const j3 = { journal: [{ url: URL_6704 + '&site=2', detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }, { url: URL_6704, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)'), entree(SS, 'Rattata-DLR2', 'Rattata (DLR 2)')] }] };
    verifier('3. deux pages de la même expansion (site=2 puis site=1) → déduites', (await deduireLot(lotDe(j3), deps())).deduites.map(d => d.idProduct), [11, 12]);

    // 4. deux idExpansion différents pour un slugSet → refusé
    const j4 = { journal: [{ url: URL_6704, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }, { url: '/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6705', detailSansImage: [entree(SS, 'Rattata-DLR2', 'Rattata (DLR 2)')] }] };
    const r4 = await deduireLot(lotDe(j4), deps());
    verifier('4. un slugSet vu sous deux idExpansion → rien de déduit, règle actuelle', [r4.deduites.length, r4.refus.every(x => /porté par 0 expansions/.test(x.raison))], [0, true]);
    // 4b. même vignette vue sous deux idExpansion
    const j4b = { journal: [{ url: URL_6704, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }, { url: '/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6705', detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('4b. une vignette vue sous deux idExpansion → refusée', (await deduireLot(lotDe(j4b), deps())).deduites.length, 0);
    // 4c. une adresse avec deux idExpansion
    const j4c = { journal: [{ url: '/en/Pokemon/Products/Singles?idExpansion=6704&idExpansion=6705', detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('4c. une adresse à deux idExpansion → refusée', (await deduireLot(lotDe(j4c), deps())).deduites.length, 0);

    // 5. slugSet déjà appris ailleurs → la règle actuelle (l'expansion apprise fait foi, la page ne la remplace pas)
    const r5 = await deduireLot(lotDe(j2), deps({ expansionsDuSlugSet: async () => [9999] }));
    verifier('5. slugSet déjà appris sous 9999 → on cherche dans 9999, jamais dans la page', [r5.deduites.length, r5.deduites.some(d => d.expansionLueDansLaPage)], [0, false]);
    const r5b = await deduireLot(lotDe(j2), deps({ expansionsDuSlugSet: async () => [9999], produitsDe: async e => (e === 9999 ? CAT[6704] : []) }));
    verifier('5b. …et déduit dans l\'expansion apprise, sans la marque « lue dans la page »', r5b.deduites.map(d => [d.idProduct, d.idExpansion, !!d.expansionLueDansLaPage]), [[11, 9999, false], [12, 9999, false], [13, 9999, false]]);
    const r5c = await deduireLot(lotDe(j2), deps({ expansionsDuSlugSet: async () => [9999, 8888] }));
    verifier('5c. slugSet porté par deux expansions apprises → refusé (la page ne départage pas)', [r5c.deduites.length, /porté par 2 expansions/.test(r5c.refus[0]?.raison)], [0, true]);

    // 6. adresse sans idExpansion → refusé
    const j6 = { journal: [{ url: '/en/Pokemon/Products/Singles/' + SS, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    const r6 = await deduireLot(lotDe(j6), deps());
    verifier('6. adresse sans idExpansion → refusé, règle actuelle', [r6.deduites.length, /porté par 0 expansions/.test(r6.refus[0]?.raison)], [0, true]);
    const j6b = { journal: [{ detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('6b. page de journal sans `url` → refusé', (await deduireLot(lotDe(j6b), deps())).deduites.length, 0);
    const j6c = { journal: [{ url: URL_6704, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }, { url: '/en/Pokemon/Products/Singles/' + SS, detailSansImage: [entree(SS, 'Rattata-DLR2', 'Rattata (DLR 2)')] }] };
    verifier('6c. UNE seule vignette du slugSet vient d\'une page sans idExpansion → tout le slugSet refusé (TOUTES doivent le porter)', (await deduireLot(lotDe(j6c), deps())).deduites.length, 0);
    const j6d = { journal: [{ url: '/en/Pokemon/Products/Singles?idExpansion=abc', detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('6d. idExpansion non numérique → refusé', (await deduireLot(lotDe(j6d), deps())).deduites.length, 0);

    // 7. un nom ambigu → refusé, les autres gardes tiennent
    const j7 = { journal: [{ url: URL_6704, detailSansImage: [entree(SS, 'Doduo-DLR4', 'Doduo (DLR 4)'), entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    const r7 = await deduireLot(lotDe(j7), deps());
    verifier('7. nom ambigu (2 Doduo non appris) → refusé ; l\'autre déduit', [r7.deduites.map(d => d.idProduct), r7.refus.map(x => /2 produits/.test(x.raison))], [[11], [true]]);
    // 7b. vol de slug : déjà porté
    const r7b = await deduireLot(lotDe(j2), deps({ slugsPortes: async () => new Set([`${SS}|Pidgey-DLR1`]) }));
    verifier('7b. slug déjà porté par un produit appris → refusé même avec la page', r7b.deduites.map(d => d.idProduct), [12, 13]);
    // 7c. deux vignettes pour un produit
    const j7c = { journal: [{ url: URL_6704, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)'), entree(SS, 'Pidgey-DLR9', 'Roucool (DLR 9)')] }] };
    verifier('7c. deux vignettes désignent le même produit → aucune', (await deduireLot(lotDe(j7c), deps())).deduites.length, 0);
    // 7d. catalogue en retard
    const r7d = await deduireLot(lotDe(j2), deps({ idsApprisDeLExpansion: async () => [555], idsAuCatalogue: async () => new Set() }));
    verifier('7d. catalogue en retard → refusé même avec la page', r7d.deduites.length, 0);

    // 8. la raison de l'écriture le dit
    const { appliquerDeductions } = require('./collecte-cartes/deduire-produit');
    const docs = [];
    const coll = { findOne: async () => null, updateOne: async (f, u) => { docs.push(u.$setOnInsert); return { upsertedCount: 1 }; } };
    await appliquerDeductions(r2.deduites, coll);
    verifier('8. la preuve écrite dit « expansion lue dans l\'adresse de la page »', docs.every(d => /expansion lue dans l'adresse de la page/.test(d.preuveDeduction)) && docs.length === 3, true);
    const docs2 = []; const coll2 = { findOne: async () => null, updateOne: async (f, u) => { docs2.push(u.$setOnInsert); return { upsertedCount: 1 }; } };
    await appliquerDeductions(r5b.deduites, coll2);
    verifier('8b. sans preuve par la page, la preuve écrite ne le dit pas', docs2.some(d => /adresse de la page/.test(d.preuveDeduction)), false);

    // 9. TOUR 1, constat 1 : l'idExpansion lu dans l'adresse est déjà appris sous un AUTRE slugSet → la page ne prouve rien, refusé.
    //    La garde s'écrit par ce qu'elle autorise : idExpansion SANS aucune ligne apprise ET slugSet sans expansion apprise.
    const r9 = await deduireLot(lotDe(j2), deps({ idsApprisDeLExpansion: async e => (e === 6704 ? [555, 556] : []), idsAuCatalogue: async ids => new Set(ids) }));
    verifier('9. idExpansion de la page déjà appris (catalogue à jour) → rien de déduit', r9.deduites.length, 0);
    verifier('9b. …et la raison le dit (déjà des lignes apprises pour l\'idExpansion de la page)', r9.refus.length === 3 && r9.refus.every(x => /idExpansion=6704.*ligne\(s\) apprise\(s\).*la page ne prouve rien/.test(x.raison)), true);
    const r9c = await deduireLot(lotDe(j2), deps({ idsApprisDeLExpansion: async (e, s) => (s === SS ? [777] : []), idsAuCatalogue: async ids => new Set(ids) }));
    verifier('9c. le slugSet a des lignes apprises sans idExpansion (idsApprisDeLExpansion non vide par le slugSet) → refusé', r9c.deduites.length, 0);
    const r9d = await deduireLot(lotDe(j2), deps({ idsApprisDeLExpansion: async () => [], idsAuCatalogue: async ids => new Set(ids) }));
    verifier('9d. ni l\'expansion ni le slugSet n\'ont de ligne apprise → déduit (le cas du testeur tient)', r9d.deduites.length, 3);

    // 10. TOUR 1, constat 2 : l'adresse est bornée — « /<langue>/Pokemon/Products/Singles », chemin relatif, idCategory=51 s'il est présent
    const { expansionDeLAdresse } = require('./collecte-cartes/deduire-produit');
    const adr = [
        ['/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6704&site=2', 6704],
        ['/fr/Pokemon/Products/Singles?idExpansion=6704', 6704],
        ['/en/Magic/Products/Singles?idExpansion=6704', null],
        ['/en/Pokemon/Products/Search?idExpansion=6704', null],
        ['/en/Pokemon/Products/Sealed?idExpansion=6704', null],
        ['/en/Pokemon/Products/Sealed?idCategory=99&idExpansion=6704', null],
        ['https://evil.example/en/Pokemon/Products/Singles?idExpansion=6704', null],
        ['//evil.example/en/Pokemon/Products/Singles?idExpansion=6704', null],
        ['https://www.cardmarket.com/en/Pokemon/Products/Singles?idExpansion=6704', null],
        ['/en/Pokemon/Products/Singles?idCategory=52&idExpansion=6704', null],
        ['/en/Pokemon/Products/Singles?idCategory=51&idCategory=51&idExpansion=6704', null],
        ['/en/Pokemon/Products/Singles?idCategory=&idExpansion=6704', null],
        ['/en/Pokemon/Products/Singles/Dragon-Light-Rising?idExpansion=6704', null],   // TOUR 2 : le slugSet du chemin doit être confirmé par l'appelant (2e argument) ; sans lui, null
        ['/english/Pokemon/Products/Singles?idExpansion=6704', null],
        ['/en/pokemon/products/singles?idExpansion=6704', null]
    ];
    for (const [u, att] of adr) verifier(`10. adresse ${u} → ${att}`, expansionDeLAdresse(u), att);
    const j10 = { journal: [{ url: '/en/Magic/Products/Singles?idCategory=51&idExpansion=6704', detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('10b. une page Magic portant idExpansion=6704 → rien de déduit', (await deduireLot(lotDe(j10), deps())).deduites.length, 0);

    // 11. TOUR 1, constat 4 : entier sûr seulement
    verifier('11. idExpansion=99999999999999999999 → null', expansionDeLAdresse('/en/Pokemon/Products/Singles?idExpansion=99999999999999999999'), null);
    verifier('11b. idExpansion=9007199254740993 (> MAX_SAFE_INTEGER) → null', expansionDeLAdresse('/en/Pokemon/Products/Singles?idExpansion=9007199254740993'), null);
    verifier('11c. idExpansion=9007199254740991 (MAX_SAFE_INTEGER) → accepté', expansionDeLAdresse('/en/Pokemon/Products/Singles?idExpansion=9007199254740991'), 9007199254740991);
    const { expansionParLaPage } = require('./collecte-cartes/deduire-produit');
    verifier('11d. expansionParLaPage refuse un entier non sûr', expansionParLaPage([{ expansionsDePage: [1e21] }]), null);

    // 12. TOUR 2 : les VRAIES adresses du journal (rat-market-journal-2026-11-01-16-36.json, 1 500 pages) — 34 formes distinctes, extraites
    //     par fixtures-adresses-journal.json (jetons de défi et msockid anonymisés). `attendu` a été écrit à la main depuis la règle
    //     (liste à 0 ou 1 segment, idExpansion présent, aucun défi), jamais en appelant la fonction.
    const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-adresses-journal.json'), 'utf8'));
    verifier('12. le fichier de fixtures porte au moins 15 formes réelles', FIX.length >= 15, true);
    verifier('12a. …dont des listes À slugSet qui doivent donner un idExpansion (la forme majoritaire du vrai journal)', FIX.filter(f => f.slugSet && f.attendu).length >= 8, true);
    for (const f of FIX) verifier(`12. réel ${f.forme || '(sans paramètre)'} ${f.url.split('?')[0].split('/').slice(-2).join('/')} → ${f.attendu}`, expansionDeLAdresse(f.url, f.slugSet), f.attendu);
    // la garde de slugSet : le chemin porte un slugSet DIFFÉRENT de celui de la vignette → null
    const U = '/fr/Pokemon/Products/Singles/Primal-Clash?searchMode=v2&idCategory=51&idExpansion=1585&idRarity=0&sortBy=idRarity_asc&perSite=30';
    verifier('12b. chemin Primal-Clash, vignette Primal-Clash → 1585', expansionDeLAdresse(U, 'Primal-Clash'), 1585);
    verifier('12c. chemin Primal-Clash, vignette d\'un AUTRE slugSet → null', expansionDeLAdresse(U, 'Plasma-Storm'), null);
    verifier('12d. chemin à slugSet, aucun slugSet fourni → null (fermé par défaut)', expansionDeLAdresse(U), null);
    verifier('12e. chemin sans slugSet, slugSet de vignette fourni → accepté (liste filtrée par idExpansion)', expansionDeLAdresse('/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6703', 'Quelconque'), 6703);
    verifier('12f. casse différente du slugSet → null', expansionDeLAdresse(U, 'primal-clash'), null);
    verifier('12g. page de PRODUIT (deux segments) portant idExpansion → null', expansionDeLAdresse('/fr/Pokemon/Products/Singles/Primal-Clash/Foo-PCL1?idExpansion=1585', 'Primal-Clash'), null);
    verifier('12h. défi Cloudflare __cf_chl_ → null', expansionDeLAdresse(U + '&__cf_chl_rt_tk=abc', 'Primal-Clash'), null);
    verifier('12i. paramètre __cf_chl_f_tk (autre nom) → null', expansionDeLAdresse(U + '&__cf_chl_f_tk=abc', 'Primal-Clash'), null);
    verifier('12j. idExpansion=0 → null', expansionDeLAdresse('/en/Pokemon/Products/Singles?idExpansion=0'), null);
    verifier('12k. trois segments → null', expansionDeLAdresse('/en/Pokemon/Products/Singles/A/B/C?idExpansion=5', 'A'), null);
    verifier('12l. slash final après le slugSet → null', expansionDeLAdresse('/en/Pokemon/Products/Singles/A/?idExpansion=5', 'A'), null);
    verifier('12m. slugSet encodé / caractères hors liste → null', expansionDeLAdresse('/en/Pokemon/Products/Singles/A%20B?idExpansion=5', 'A%20B'), null);
    // de bout en bout : une page À slugSet (forme réelle) + un Lot → déduit, l'expansion lue dans la page
    const U6 = '/en/Pokemon/Products/Singles/' + SS + '?searchMode=v2&idCategory=51&idExpansion=6704&idRarity=0&sortBy=name_asc&site=2';
    const j12 = { journal: [{ url: U6, slugSet: SS, detailSansImage: [entree(SS, 'Pidgey-DLR1', 'Roucool (DLR 1)'), entree(SS, 'Rattata-DLR2', 'Rattata (DLR 2)')] }] };
    verifier('12n. page réelle à slugSet → vignettes prouvées 6704 et déduites', (await deduireLot(lotDe(j12), deps())).deduites.map(d => [d.idProduct, d.idExpansion]), [[11, 6704], [12, 6704]]);
    const j12b = { journal: [{ url: U6, slugSet: SS, detailSansImage: [entree('Autre-Set', 'Pidgey-DLR1', 'Roucool (DLR 1)')] }] };
    verifier('12o. page de SS qui montre une vignette d\'un autre slugSet → pas de preuve', (await deduireLot(lotDe(j12b), deps())).deduites.length, 0);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

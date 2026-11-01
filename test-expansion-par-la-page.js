// node test-expansion-par-la-page.js — banc : une expansion NEUVE (aucune ligne apprise) est prouvée par l'ADRESSE de la page du journal
// (`idExpansion=<n>` dans `url`, l'adresse que l'userscript écrit : location.pathname + location.search). Sans base, sans réseau.
// Cas du testeur, 2026-11-01 : l'expansion 6704 (DLR, 141 produits, aucune image chez Cardmarket) → 0 appris, « porté par 0 expansions ».
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

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

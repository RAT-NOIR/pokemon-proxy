// node test-deduction-ecritures-scratch.js — les ÉCRITURES de la déduction et de la vraie lecture (collecte-cartes/deduire-produit.js),
// sur une VRAIE base : test_scratch, deux collections à lui (refusées si elles existent déjà), retirées en sortant. Aucune écriture ailleurs.
// Ce que le banc exige (relecture du 2026-09-26 soir) : une déduction n'est jamais « exacte » ; elle ne remplit que les champs VIDES,
// jamais le numéro d'une ligne ; une ligne à slug n'est pas touchée ; une vraie lecture réécrit une ligne déduite — même `cardmarket` —
// et retire la preuve de déduction.
// 🔴 SECONDE RELECTURE (2026-09-26, nuit) : le banc écrivait par le PILOTE ce que la route écrivait par MONGOOSE — dont le schéma strict
// avalait les `$unset` de `deduitLe` et `preuveJournal` (reproduit) — et la branche « lot sans aucune carte lue » n'était exercée par
// personne. Les cas 8 à 17 appellent `apprendreLot` et `apprendreUneLecture`, c'est-à-dire EXACTEMENT ce que /api/apprendre-lot et
// /api/apprendre appellent, avec les lecteurs de la route (`lecteursMongo`) sur un catalogue de test ; `decoderCodeSet` est celle que la
// route importe (collecte-cartes/codes-set.js) ; seul `memoriserCodeSet` (codes_set) est remplacé par un témoin.
// MODULE_DEDUCTION=<chemin> rejoue le banc sur une autre copie du module (celle d'avant la relecture : c'est ainsi qu'on l'a vu échouer).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const M = require(process.env.MODULE_DEDUCTION ? path.resolve(process.env.MODULE_DEDUCTION) : './collecte-cartes/deduire-produit');
const { appliquerDeductions, aReecrireParLecture, majLectureExacte } = M;
const COLL = 'banc_deduction_numeros', CAT = 'banc_deduction_catalogue';
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
// Un cas qui lève (fonction absente de la copie d'avant, par exemple) est un ÉCHEC, pas un arrêt du banc.
const cas = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   a levé : ${e.message}`); } };
// La VRAIE fonction de la route (2026-09-27, soir : elle vit dans collecte-cartes/codes-set.js, que la route importe ; le banc ne peut
// pas charger index.js, il démarre le serveur).
const { decoderCodeSet } = require('./collecte-cartes/codes-set');

(async () => {
    // BASE DE BANC (2026-10-08) : plus jamais la production — base mémoire, ou MONGODB_TEST_URI hors production, sinon REFUS (base-banc.js).
    (await ouvrirBanc()).appliquer();
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') { await cx.close(); throw new Error(`base « ${cx.db.databaseName} » : je n'écris que dans test_scratch`); }
    for (const nom of [COLL, CAT]) if ((await cx.db.listCollections({ name: nom }).toArray()).length) { await cx.close(); throw new Error(`test_scratch porte déjà ${nom} : je ne l'écrase pas`); }
    const C = cx.db.collection(COLL), K = cx.db.collection(CAT);
    try {
        await C.insertMany([
            { idProduct: 1, idExpansion: 1745, numero: '17', slug: null, source: 'cardmarket', certitude: 'exacte' },   // ligne exacte SANS slug (une cible « V »)
            { idProduct: 3, idExpansion: 1745, numero: '3', slug: 'Aaa-SUM3', slugSet: 'Sun-Moon', source: 'cardmarket', certitude: 'exacte' }   // ligne à slug
        ]);
        const carte = (slug, numero, variante) => ({ idProduct: null, slug, slugSet: 'Sun-Moon', codeSet: 'SUM', numero, nomFr: 'Lampignon', variante, sansImage: true });
        const r = await appliquerDeductions([
            { carte: carte('Shiinotic-V2-SUM17', '17', 'V2'), idProduct: 2, idExpansion: 1745, exhaustion: false, numeroUrl: '17' },
            { carte: carte('Shiinotic-V1-SUM17', '17', 'V1'), idProduct: 1, idExpansion: 1745, exhaustion: false, numeroUrl: '17' },
            { carte: carte('Bbb-SUM3', '3', null), idProduct: 3, idExpansion: 1745, exhaustion: false, numeroUrl: '3' }
        ], C, { le: new Date('2026-09-26T18:00:00Z') });
        verifier('1. une ligne insérée, une complétée, la ligne à slug intouchée', { inserees: r.inserees, completees: r.completees }, { inserees: 1, completees: 1 });
        const l2 = await C.findOne({ idProduct: 2 }, { projection: { _id: 0 } });
        verifier('2. ligne neuve : cardmarket-deduit, certitude « deduite », slug et numéro du lien et du titre, preuve écrite',
            [l2.source, l2.certitude, l2.slug, l2.numero, l2.numeroUrl, /DÉDUIT/.test(l2.preuveDeduction)], ['cardmarket-deduit', 'deduite', 'Shiinotic-V2-SUM17', '17', '17', true]);
        const l1 = await C.findOne({ idProduct: 1 }, { projection: { _id: 0 } });
        verifier('3. ligne cardmarket sans slug : slug rempli, MARQUÉE « deduite », source et numéro inchangés', [l1.slug, l1.certitude, l1.source, l1.numero, /DÉDUIT/.test(l1.preuveDeduction)], ['Shiinotic-V1-SUM17', 'deduite', 'cardmarket', '17', true]);
        const l3 = await C.findOne({ idProduct: 3 }, { projection: { _id: 0 } });
        verifier('4. ligne à slug : rien écrit', [l3.slug, l3.certitude, 'preuveDeduction' in l3], ['Aaa-SUM3', 'exacte', false]);
        verifier('5. une vraie lecture réécrit : une ligne déduite (même cardmarket), une ligne non cardmarket ; PAS une ligne cardmarket exacte',
            [aReecrireParLecture(l1), aReecrireParLecture(l2), aReecrireParLecture(l3), aReecrireParLecture(null)], [true, true, false, true]);
        // la vraie lecture, telle que la route l'applique
        const lue = { idProduct: 1, numero: '17', numeroUrl: '17', slug: 'Shiinotic-SUM17', slugSet: 'Sun-Moon', nomFr: 'Lampignon', variante: null };
        await C.updateOne({ idProduct: 1 }, majLectureExacte(lue, { idExpansion: 1745, codeSet: 'SUM' }), { upsert: true });
        const l1b = await C.findOne({ idProduct: 1 }, { projection: { _id: 0 } });
        verifier('6. après la vraie lecture : slug lu, cardmarket / exacte, preuve de déduction RETIRÉE', [l1b.slug, l1b.source, l1b.certitude, 'preuveDeduction' in l1b, 'deduitLe' in l1b], ['Shiinotic-SUM17', 'cardmarket', 'exacte', false, false]);
        const r2 = await appliquerDeductions([{ carte: carte('Ccc-SUM17', '17', null), idProduct: 1, idExpansion: 1745, exhaustion: false, numeroUrl: '17' }], C);
        verifier('7. une déduction ne touche plus une ligne qu\'une vraie lecture a écrite (et le dit)', [r2.inserees, r2.completees, r2.sansEffet?.length, (await C.findOne({ idProduct: 1 })).slug], [0, 0, 1, 'Shiinotic-SUM17']);

        // ── SECONDE RELECTURE : la ROUTE elle-même (apprendreLot / apprendreUneLecture), sur un catalogue de test
        await K.insertMany([
            ...[[1, 'Shiinotic [Calming Light | Spiral Rush]'], [2, 'Shiinotic [Calming Light | Spiral Rush]'], [3, 'Aaa'], [10, 'Rowlet [Tackle]'], [11, 'Litten [Scratch]'],
                [12, 'Bulbasaur [Vine Whip]'], [13, 'Squirtle [Bubble]'], [20, 'Mewtwo V-UNION'], [41, 'Pikachu [Thunder Shock]'], [42, 'Pikachu [Thunder Shock]'],
                [50, 'Xxx'], [60, 'Zzz'], [61, 'Zzz'], [70, 'Www']].map(([idProduct, name]) => ({ idProduct, idExpansion: 1745, name })),
            { idProduct: 777, idExpansion: 5000, name: 'Litten [Scratch]' },
            { idProduct: 25, idExpansion: 2000, name: 'Pikachu [Gnaw]' }, { idProduct: 26, idExpansion: 2000, name: 'Charmander [Ember]' },
            // relecture par sous-agent : une ligne exacte au nomFr LU (80), une famille à deux (43, 44), et l'expansion 3000 dont une
            // ligne apprise, hors catalogue, n'est reconnaissable que par son idExpansion (le doublon de Rowlet, 45, entre au cas 19)
            ...[[80, 'Vvv'], [43, 'Gloom [Poison Powder]'], [44, 'Gloom [Poison Powder]']].map(([idProduct, name]) => ({ idProduct, idExpansion: 1745, name })),
            { idProduct: 301, idExpansion: 3000, name: 'Oddish [Absorb]' }, { idProduct: 302, idExpansion: 3000, name: 'Gloom [Poison Powder]' }
        ]);
        const le = new Date('2026-09-26T22:00:00Z');
        await C.insertMany([
            // une ligne DÉDUITE (userscript 1.9) que l'image va relire
            { idProduct: 50, idExpansion: 1745, numero: '50', slug: 'Xxx-V2-SUM50', slugSet: 'Sun-Moon', variante: 'V2', source: 'cardmarket-deduit', certitude: 'deduite', preuveDeduction: 'p', deduitLe: le, preuveJournal: 'j' },
            // une ligne cardmarket COMPLÉTÉE par une déduction (tous ses champs du lien étaient vides) que l'extension va relire par /api/apprendre
            { idProduct: 60, idExpansion: 1745, numero: '60', codeSet: 'SUM', slug: 'Zzz-V1-SUM60', slugSet: 'Sun-Moon', variante: 'V1', numeroUrl: '60', nomFr: 'Zzz', source: 'cardmarket', certitude: 'deduite',
                preuveDeduction: 'p', deduitLe: le, champsDeduits: ['slug', 'slugSet', 'numeroUrl', 'nomFr', 'variante'], certitudeAvantDeduction: 'exacte' },
            // la même, complétée AVANT que la déduction écrive `champsDeduits` : seuls le slug et ce qui en dérive partent
            { idProduct: 61, idExpansion: 1745, numero: '61', codeSet: 'SUM', slug: 'Zzz-V1-SUM61', slugSet: 'Sun-Moon', variante: 'V1', numeroUrl: '61', nomFr: 'Zzz', source: 'cardmarket', certitude: 'deduite', preuveDeduction: 'p', deduitLe: le },
            // une ligne tcgdex (non déduite) : /api/apprendre ne lit ni slugSet ni nomFr, elle les garde
            { idProduct: 70, idExpansion: 1745, numero: '70', slugSet: 'Sun-Moon', nomFr: 'Www', source: 'tcgdex', certitude: 'exacte' },
            // la ligne apprise d'un produit (777, expansion 5000 au catalogue) écrite SANS idExpansion, sous le slugSet de Sun-Moon :
            // seule la garde GLOBALE de slug la voit (elle n'est ni dans la famille de 1745, ni hors catalogue)
            { idProduct: 777, idExpansion: null, numero: '11', slug: 'Litten-SUM11', slugSet: 'Sun-Moon', source: 'cardmarket', certitude: 'exacte' },
            { idProduct: 26, idExpansion: 2000, numero: '4', slug: 'Charmander-SVI4', slugSet: 'Scarlet-Violet', source: 'cardmarket', certitude: 'exacte' },
            { idProduct: 80, idExpansion: 1745, numero: '80', codeSet: 'SUM', nomFr: 'Vrai', slug: null, source: 'cardmarket', certitude: 'exacte' },
            { idProduct: 43, idExpansion: 1745, numero: '43', slug: 'Gloom-V1-SUM43', slugSet: 'Sun-Moon', source: 'cardmarket', certitude: 'exacte' },
            { idProduct: 302, idExpansion: 3000, numero: '2', slug: 'Gloom-EVO2', slugSet: 'Evolutions', source: 'cardmarket', certitude: 'exacte' },
            { idProduct: 399999, idExpansion: 3000, numero: '99', slug: 'Vileplume-XYZ99', slugSet: 'Autre-Set', source: 'cardmarket', certitude: 'exacte' }
        ]);
        const codes = [], lignes = [];
        const journal = { log: s => lignes.push(s), warn: s => lignes.push(s), error: s => lignes.push(s) };
        const deps = (numeros = C) => ({ numeros, catalogue: K, decoderCodeSet, memoriserCodeSet: async (e, c) => { codes.push([e, c]); }, journal, userId: 'banc', le });
        const lot = cartes => M.apprendreLot(cartes, deps());
        const sans = (slug, numero, slugSet = 'Sun-Moon', codeSet = 'SUM') => ({ idProduct: null, slug, slugSet, codeSet, numero, nomFr: slug.split('-')[0], sansImage: true });

        await cas('8. (point 2) une ligne DÉDUITE relue avec son image : cardmarket/exacte, et preuveDeduction, deduitLe, preuveJournal TOUS retirés', async () => {
            const rep = await lot([{ idProduct: 50, slug: 'Yyy-SUM50', slugSet: 'Sun-Moon', numero: '50', codeSet: 'SUM', nomFr: 'Yyy' }]);
            const d = await C.findOne({ idProduct: 50 });
            verifier('8. (point 2) une ligne DÉDUITE relue avec son image : cardmarket/exacte, et preuveDeduction, deduitLe, preuveJournal TOUS retirés',
                [rep.ameliorees, d.source, d.certitude, d.slug, d.variante, 'preuveDeduction' in d, 'deduitLe' in d, 'preuveJournal' in d], [1, 'cardmarket', 'exacte', 'Yyy-SUM50', null, false, false, false]);
            // troisième relecture : la lecture dit « Yyy-SUM50 » là où la déduction avait mis « Xxx-V2-SUM50 » — la contradiction est
            // RENDUE (réponse) et ÉCRITE sur la ligne, au lieu d'une « amélioration » silencieuse
            verifier('8b. la contradiction déduction / lecture du MÊME produit est rendue (deductionsRelues) et écrite (deductionRelue) par le pilote',
                [rep.deductionsRelues?.confirmees, rep.deductionsRelues?.contredites?.map(x => [x.idProduct, x.deduit.slug, x.lu.slug]), d.deductionRelue?.concorde, d.deductionRelue?.slugDeduit, d.deductionRelue?.juge],
                [0, [[50, 'Xxx-V2-SUM50', 'Yyy-SUM50']], false, 'Xxx-V2-SUM50', ['slug', 'numero']]);
        });
        await cas('9. (point 1) la variante se RECALCULE du slug', async () => {
            const rep = await lot([{ idProduct: 41, slug: 'Pikachu-V2-SUM41', slugSet: 'Sun-Moon', numero: '41', codeSet: 'SUM', variante: 'V9' }, sans('Mewtwo-V-UNION-V3', null)]);
            const d = await C.findOne({ idProduct: 41 });
            verifier('9. (point 1) la variante envoyée (V9) est ignorée : V2 relue du slug ; « Mewtwo-V-UNION-V3 » (V3 en FIN de slug) pour un seul produit → refusée',
                [d.variante, rep.deduites, Object.keys(rep.raisonsNonDeduites).some(k => /au-delà de la famille/.test(k)), await C.countDocuments({ idProduct: 20 })], ['V2', 0, true, 0]);
        });
        await cas('10. (points 6 et 7) lot fait SEULEMENT de sans-image', async () => {
            const rep = await lot([sans('Rowlet-SUM10', '10')]);
            const d = await C.findOne({ idProduct: 10 });
            verifier('10. (point 6) lot fait seulement de sans-image, déduite : `idsDeduits` rend l\'idProduct ÉCRIT ; la ligne est « deduite » et dit TOUT ce que la déduction a écrit, nuls compris',
                [rep.deduites, rep.idsDeduits, d?.source, d?.certitude, d?.champsDeduits], [1, [{ idProduct: 10, slug: 'Rowlet-SUM10', slugSet: 'Sun-Moon' }], 'cardmarket-deduit', 'deduite',
                    ['numero', 'codeSet', 'slug', 'slugSet', 'numeroUrl', 'nomFr', 'variante']]);
            verifier('   (point 7) et l\'expansion et la couverture sont rendues', [rep.idExpansion, rep.couverture?.produits], [1745, 17]);
        });
        await cas('11. (point 7) page de sans-image TOUTES refusées : l\'expansion vient du slugSet', async () => {
            const rep = await lot([sans('Aaa-SUM3', '3'), sans('Rowlet-SUM10', '10')]);
            verifier('11. (point 7) page de sans-image TOUTES refusées (slugs déjà appris) : idExpansion 1745 lu du SLUGSET, couverture rendue, 0 déduite',
                [rep.deduites, rep.nonDeduites, rep.idExpansion, rep.idExpansions, rep.couverture?.produits, rep.erreurDeduction], [0, 2, 1745, [1745], 17, null]);
        });
        await cas('12. (point 4) garde GLOBALE de slug dans la route', async () => {
            const rep = await lot([sans('Litten-SUM11', '11')]);
            verifier('12. (point 4) le slug « Litten-SUM11 » est porté par une ligne HORS de la famille (777, idExpansion null) → refusé par la route',
                [rep.deduites, Object.keys(rep.raisonsNonDeduites).some(k => /déjà porté par un produit appris/.test(k)), await C.countDocuments({ idProduct: 11 })], [0, true, 0]);
        });
        await cas('13. (point 5 a) catalogue en retard', async () => {
            const rep = await lot([{ idProduct: 999002, slug: 'Sprigatito-SVI201', slugSet: 'Scarlet-Violet', numero: '201', codeSet: 'SVI', nomFr: 'Poussacha' }, sans('Pikachu-SVI200', '200', 'Scarlet-Violet', 'SVI')]);
            const d = await C.findOne({ idProduct: 999002 });
            verifier('13. (point 5 a) la page lit un produit ABSENT du catalogue (999002, écrit idExpansion null) : le catalogue est prouvé en retard, « Pikachu-SVI200 » n\'est PAS attribué au n°25',
                [d?.idExpansion, rep.deduites, Object.keys(rep.raisonsNonDeduites).some(k => /catalogue en retard/.test(k)), await C.countDocuments({ idProduct: 25 }), rep.idExpansion], [null, 0, true, 0, 2000]);
        });
        await cas('14. (point 10) exception au milieu de l\'écriture', async () => {
            // le pilote tombe sur la 2e écriture : ce qui a été écrit est dit, exactement
            const panne = new Proxy(C, { get(t, k) { if (k === 'updateOne') return async (f, u, o) => { if (f.idProduct === 13) throw new Error('panne simulée'); return t.updateOne(f, u, o); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
            const rep = await M.apprendreLot([sans('Bulbasaur-SUM12', '12'), sans('Squirtle-SUM13', '13')], deps(panne));
            verifier('14. (point 10) une panne à la 2e écriture : `deduites` 1 et `idsDeduits` [12] — ce qui est ÉCRIT —, l\'erreur dite, la 13 absente',
                [rep.deduites, rep.idsDeduits.map(x => x.idProduct), /interrompue/.test(rep.erreurDeduction || ''), await C.countDocuments({ idProduct: 12 }), await C.countDocuments({ idProduct: 13 })], [1, [12], true, 1, 0]);
        });
        await cas('15-17. (point 3) /api/apprendre', async () => {
            const a = await M.apprendreUneLecture({ idProduct: 60, idExpansion: 1745, numero: '60', codeSet: 'SUM' }, { numeros: C, le });
            const d60 = await C.findOne({ idProduct: 60 });
            verifier('15. (point 3) /api/apprendre sur une ligne cardmarket DÉDUITE : réécrite (pas « déjà exacte »), exacte, slug/slugSet/variante/numeroUrl/nomFr déduits RETIRÉS, preuve retirée',
                [!!a.ecrit, !!a.dejaExacte, d60.certitude, ['slug', 'slugSet', 'variante', 'numeroUrl', 'nomFr', 'preuveDeduction', 'deduitLe', 'champsDeduits', 'certitudeAvantDeduction'].filter(k => k in d60), d60.numero, d60.codeSet], [true, false, 'exacte', [], '60', 'SUM']);
            await M.apprendreUneLecture({ idProduct: 61, idExpansion: 1745, numero: '61', codeSet: 'SUM' }, { numeros: C, le });
            const d61 = await C.findOne({ idProduct: 61 });
            verifier('15b. ligne complétée d\'AVANT `champsDeduits` : slug, variante, numeroUrl retirés ; slugSet et nomFr (peut-être LUS avant) gardés',
                [d61.certitude, ['slug', 'variante', 'numeroUrl'].filter(k => k in d61), d61.slugSet, d61.nomFr], ['exacte', [], 'Sun-Moon', 'Zzz']);
            const b = await M.apprendreUneLecture({ idProduct: 70, idExpansion: undefined, numero: '70', codeSet: 'SUM' }, { numeros: C, le });
            const d70 = await C.findOne({ idProduct: 70 });
            verifier('16. (point 3) sur une ligne tcgdex NON déduite : réécrite, slugSet et nomFr GARDÉS, idExpansion absent de l\'appel non écrasé',
                [!!b.ecrit, d70.source, d70.slugSet, d70.nomFr, d70.idExpansion], [true, 'cardmarket', 'Sun-Moon', 'Www', 1745]);
            const c1 = await M.apprendreUneLecture({ idProduct: 70, idExpansion: 1745, numero: '70', codeSet: 'SUM' }, { numeros: C, le });
            const c2 = await M.apprendreUneLecture({ idProduct: 70, idExpansion: 1745, numero: '71', codeSet: 'SUM' }, { numeros: C, le });
            verifier('17. (point 3) sur une ligne cardmarket EXACTE : confirmée si identique, refusée sinon', [!!c1.dejaExacte, c2.refuse], [true, 'ligne-exacte-existante']);
        });
        verifier('   memoriserCodeSet appelé par expansion des cartes écrites (Sun-Moon : SUM)', codes.some(([e, c]) => e === 1745 && c === 'SUM'), true);

        // ── RELECTURE PAR SOUS-AGENT (2026-09-26, nuit), sur ce que les cas 8 à 17 ne prouvaient pas
        await cas('18. défaut 1 : un champ LU avant la déduction survit à la vraie lecture', async () => {
            const rep = await lot([sans('Vvv-SUM80', '80')]);
            const d1 = await C.findOne({ idProduct: 80 });
            await M.apprendreUneLecture({ idProduct: 80, idExpansion: 1745, numero: '80', codeSet: 'SUM' }, { numeros: C, le });
            const d2 = await C.findOne({ idProduct: 80 });
            verifier('18. défaut 1 : ligne cardmarket au nomFr LU, complétée par une déduction (champsDeduits écrits), puis relue par /api/apprendre : le slug déduit part, le nomFr LU reste',
                [rep.deduites, d1.certitude, d1.champsDeduits, d2.certitude, d2.nomFr, 'slug' in d2, 'champsDeduits' in d2, 'certitudeAvantDeduction' in d2], [1, 'deduite', ['slug', 'slugSet', 'numeroUrl'], 'exacte', 'Vrai', false, false, false]);
        });
        await cas('19. défaut 2 : une vraie lecture qui contredit la déduction d\'un AUTRE produit', async () => {
            await K.insertOne({ idProduct: 45, idExpansion: 1745, name: 'Rowlet [Tackle]' });   // le vrai « Rowlet-SUM10 », arrivé au catalogue
            const rep = await lot([{ idProduct: 45, slug: 'Rowlet-SUM10', slugSet: 'Sun-Moon', numero: '10', codeSet: 'SUM' }]);
            const d10 = await C.findOne({ idProduct: 10 });
            verifier('19. défaut 2 : le produit 45 lu avec son image porte « Rowlet-SUM10 », que la DÉDUCTION du produit 10 porte aussi : la contradiction est RENDUE (deductionsContredites) — et la ligne 10 n\'est pas touchée (détacher attend le feu vert)',
                [rep.deductionsContredites, d10.slug, d10.certitude], [[{ idProduct: 10, par: 45, slug: 'Sun-Moon/Rowlet-SUM10' }], 'Rowlet-SUM10', 'deduite']);
        });
        await cas('20. défaut 3 : catalogue en retard par la branche idExpansion', async () => {
            const rep = await lot([sans('Oddish-EVO1', '1', 'Evolutions', 'EVO')]);
            verifier('20. défaut 3 : une ligne apprise de l\'expansion 3000 (399999, sous un AUTRE slugSet) absente du catalogue → « catalogue en retard » par son idExpansion',
                [rep.deduites, Object.keys(rep.raisonsNonDeduites).some(k => /catalogue en retard/.test(k)), await C.countDocuments({ idProduct: 301 })], [0, true, 0]);
        });
        await cas('21. défaut 3 : un produit du lot, lu sans slug, n\'est jamais candidat', async () => {
            const rep = await lot([{ idProduct: 44, numero: '43', codeSet: 'SUM', slug: null, slugSet: null }, sans('Gloom-V2-SUM43', '43')]);
            const d44 = await C.findOne({ idProduct: 44 });
            verifier('21. défaut 3 : 44 lu avec son image mais SANS slug, et une sans-image « Gloom-V2-SUM43 » : 44 est EXCLU (sans l\'exclusion, il était le seul candidat)',
                [rep.nouvelles, rep.deduites, d44.slug ?? null, d44.certitude], [1, 0, null, 'exacte']);
        });
        await cas('22. défaut 4 : /api/apprendre caste comme mongoose', async () => {
            await M.apprendreUneLecture({ idProduct: 81, idExpansion: '', numero: '81', codeSet: 0 }, { numeros: C, le });
            const d81 = await C.findOne({ idProduct: 81 });
            let leve = null; try { await M.apprendreUneLecture({ idProduct: 82, numero: { $gt: '' }, codeSet: 'SUM' }, { numeros: C, le }); } catch (e) { leve = e.message; }
            verifier('22. défaut 4 : idExpansion « » → null (pas 0), codeSet 0 → « 0 » (une chaîne), un numéro-objet lève',
                [d81.idExpansion, d81.codeSet, !!leve, await C.countDocuments({ idProduct: 82 })], [null, '0', true, 0]);
        });
    } finally {
        for (const X of [C, K]) await X.drop().catch(() => {});
        const reste = (await cx.db.listCollections().toArray()).map(c => c.name).filter(n => n === COLL || n === CAT);
        console.log(`   nettoyé : ${reste.length ? `ENCORE PRÉSENTE(S) ${reste.join(', ')}` : `${COLL} et ${CAT} retirées`} de test_scratch`);
        await cx.close();
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

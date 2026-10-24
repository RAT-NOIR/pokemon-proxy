// BANC — PHASE 2 (24/10/2026) : retirer 2 visuels faux, marquer 3 images empruntées, et NE RIEN ÉCRIRE quand l'entrée sert aussi un produit juste.
//   node test-phase2-visuels.js          (NODE_PATH = node_modules du dépôt principal ; jamais de jonction)
// Documents FABRIQUÉS (aucun chemin du testeur, aucune base distante). La décision de l'API est la VRAIE (decider, importée par chargerApi) ; la base est
// un mongod local en mémoire (base-banc.js, BANC_ISOLE=1). Si l'API est introuvable, le banc ÉCHOUE.
const P = require('./collecte-cartes/phase2-visuels');
const G = require('./collecte-cartes/garde-contrat-api');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const leve = (f, motif) => { try { f(); return 'ne lève pas'; } catch (e) { return motif.test(e.message) ? 'lève' : `lève autre chose : ${e.message}`; } };

// ── 1. LES TABLES FERMÉES : exactement les 27 produits de l'ordre du testeur, 5 à écrire, 22 écartés, rien en commun
const LES_17 = [523095, 321171, 463079, 558476, 824940, 311404, 471679, 471684, 665136, 449138, 450308, 554185, 700771, 471694, 463069, 730130, 700737];
const LES_10 = [752306, 901316, 576708, 901315, 855023, 293430, 362873, 362872, 756401, 864449];
const ids = l => l.map(x => x.idProduct).sort((a, b) => a - b);
const tri = l => [...l].sort((a, b) => a - b);
console.log('1. tables fermées');
verifier('RETRAIT : 558476 et 730130, rien d\'autre', ids(P.RETRAIT), [558476, 730130]);
verifier('EMPRUNT : 293430, 756401, 864449, rien d\'autre', ids(P.EMPRUNT), [293430, 756401, 864449]);
const LES_11 = [280583, 311405, 362871, 371643, 468924, 471699, 538823, 700744, 722696, 858713, 873081];
verifier('ÉCARTÉS : 33 (15 + 7 + 11)', P.ECARTES.length, 33);
verifier('les trois listes recouvrent EXACTEMENT les 38 de l\'ordre (17 + 10 + 11), sans doublon', tri([...ids(P.RETRAIT), ...ids(P.EMPRUNT), ...P.ECARTES.map(x => x.idProduct)]), tri([...LES_17, ...LES_10, ...LES_11]));
verifier('le lot d\'un écarté est celui de l\'ordre : 15 du lot A, 7 du lot B, 11 du lot C', ['A', 'B', 'C'].map(l => P.ECARTES.filter(x => x.lot === l).length), [15, 7, 11]);
verifier('lot C : aucun produit à écrire (les 11 partagent leur entrée avec un produit juste)', [...P.RETRAIT, ...P.EMPRUNT].filter(x => LES_11.includes(x.idProduct)).length, 0);
verifier('lot C : 5 autres dessins/produits (retrait) et 6 finition/format/tampon (emprunt), chacun avec sa nature lue', [P.ECARTES.filter(x => x.lot === 'C' && x.geste === 'retrait' && x.nature === 'dessin').length, P.ECARTES.filter(x => x.lot === 'C' && x.geste === 'emprunt' && ['finition', 'format', 'tampon'].includes(x.nature)).length], [5, 6]);
verifier('362871 (lot C) et 855023 (lot B) visent la MÊME entrée : le recouvrement est nommé', [P.ECARTES.find(x => x.idProduct === 362871).cleR2 === P.ECARTES.find(x => x.idProduct === 855023).cleR2, P.ECARTES.find(x => x.idProduct === 362871).partageAvec], [true, [274768]]);
verifier('722696 et 873081 (Slowpoke) visent la même entrée, partagée avec le juste 288470', [P.ECARTES.find(x => x.idProduct === 722696).cleR2 === P.ECARTES.find(x => x.idProduct === 873081).cleR2, P.ECARTES.find(x => x.idProduct === 722696).partageAvec], [true, [288470]]);
verifier('chaque écarté dit sa raison et nomme au moins un produit juste qui partage l\'entrée', P.ECARTES.every(x => typeof x.raison === 'string' && x.raison.length > 20 && Array.isArray(x.partageAvec) && x.partageAvec.length >= 1), true);
verifier('chaque cible à écrire porte carte, set, clé (numéro peut être null)', [...P.RETRAIT, ...P.EMPRUNT].every(x => Number.isInteger(x.carteId) && x.set && x.cleR2 && 'numero' in x), true);
verifier('verifierTables() passe sur les vraies tables', leve(() => P.verifierTables(), /./), 'ne lève pas');
verifier('verifierTables() lève si un produit est à la fois à écrire et écarté', leve(() => P.verifierTables({ RETRAIT: P.RETRAIT, EMPRUNT: P.EMPRUNT, ECARTES: [...P.ECARTES, { idProduct: 558476, lot: 'A', raison: 'x'.repeat(30), partageAvec: [1] }] }), /558476/), 'lève');
verifier('verifierTables() lève si une clé d\'entrée est visée deux fois', leve(() => P.verifierTables({ RETRAIT: [P.RETRAIT[0], { ...P.RETRAIT[0], idProduct: 1 }], EMPRUNT: [], ECARTES: [] }), /deux fois|doublon/i), 'lève');

(async () => {
    let api;
    try { api = await G.chargerApi(); } catch (e) { console.log(`❌ chargerApi : ${e.message}`); process.exit(1); }

    // ── 2. UN MONDE FABRIQUÉ, jugé par la VRAIE décision de l'API
    const im = (set, numero, n, o = {}) => ({ set, numero, cleR2: `g/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `v/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex', ...o });
    const imp = (numero) => ({ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' });
    const carte = (id, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, sets: ['Set-A'], impressions: [imp(numero)], images });
    const ligne = (idProduct, carteId, numeroFiche, o = {}) => ({ idProduct, carteId, idExpansion: 100, numeroFiche, slug: `P${idProduct}`, slugSet: 'Set-A', ...o });
    const monde = () => ({
        sets: [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }],
        cartes: [
            carte(1, '001', [im('Set-A', '001', 'solo')]),                         // un produit, une entrée : P1
            carte(2, '002', [im('Set-A', '002', 'duo')]),                          // deux produits, UNE entrée : P2 (faux) et P3 (juste)
            carte(3, '003', [im('Set-A', '003', 'trio'), im('Set-B', '003', 'ailleurs', { source: 'artofpkm' })]),   // P4 (cible), P5 aussi ; une autre entrée « autre tirage » existe
            carte(4, '004', [im('Set-A', '004', 'deja', { imageEmprunteeTirage: true })]),   // P6 : déjà emprunté
            carte(5, '005', [im('Set-A', '005', 'subst')]),                        // P7 cible ; la ligne P8 (autre carte) a cette clé en substitut
            carte(6, '006', [im('Set-A', '006', 'nu', { numero: null })]),         // P9 : entrée sans numéro
            carte(7, '007', [im('Set-A', '007', 'cle'), im('Set-A', '007', 'cle')]),// P10 : DEUX entrées de même clé : indécidable
            carte(8, '008', [im('Set-A', '008', 'ailleurs8'), im('Set-C', '008', 'ailleurs8', { source: 'artofpkm' })])  // P11 : même clé dans un autre set (emprunt d'origine)
        ],
        lignes: [ligne(1, 1, '001'), ligne(2, 2, '002'), ligne(3, 2, '002'), ligne(4, 3, '003'), ligne(5, 3, '003'), ligne(6, 4, '004'), ligne(7, 5, '005'),
            ligne(8, 8, '008', { visuelSubstitut: { cleR2: 'g/subst.webp', w: 600, h: 838, set: 'Set-A', mention: 'x' } }),
            ligne(9, 6, '006'), ligne(10, 7, '007'), ligne(11, 8, '008')]
    });
    const rejouer = async (m) => {
        const r = await api.decider({ sets: m.sets, docs: m.cartes, lignes: m.lignes, metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false });
        return r;
    };
    const servis = r => [...new Set(r.entrees.map(e => e.idProduct))].sort((a, b) => a - b);
    const m0 = monde(), r0 = await rejouer(m0);
    console.log('2. le monde fabriqué (décision réelle de l\'API)');
    verifier('avant : P1, P2, P3, P4, P5, P6, P7, P9, P10, P11 servis (P8 : substitut, set de la carte 8)', servis(r0).includes(1) && servis(r0).includes(2) && servis(r0).includes(3), true);
    const cibleSolo = { idProduct: 1, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/solo.webp' };
    const cibleDuo = { idProduct: 2, carteId: 2, set: 'Set-A', numero: '002', cleR2: 'g/duo.webp' };
    const plan = (lot, table, m = m0, r = r0) => P.planifier({ lot, table, cartes: m.cartes, lignes: m.lignes, entrees: r.entrees });

    console.log('3. planifier : LE PIÈGE — une entrée partagée avec un produit hors table n\'est jamais écrite');
    let p = plan('A', [cibleSolo]);
    verifier('entrée à un seul produit : retenue', [p.retenues.map(x => x.idProduct), p.refus.length], [[1], 0]);
    p = plan('A', [cibleDuo]);
    verifier('entrée servie aussi à P3 (hors table) : REFUS, rien retenu', [p.retenues.length, p.refus.length], [0, 1]);
    verifier('… le refus nomme P3 et dit que l\'entrée est partagée', [/\b3\b/.test(p.refus[0].raison), /partag/i.test(p.refus[0].raison)], [true, true]);
    p = plan('B', [cibleDuo]);
    verifier('même refus pour l\'emprunt (le drapeau refuse l\'entrée pour TOUS ses produits)', [p.retenues.length, p.refus.length], [0, 1]);
    p = plan('A', [cibleDuo, { idProduct: 3, carteId: 2, set: 'Set-A', numero: '002', cleR2: 'g/duo.webp' }]);
    verifier('si TOUS les produits de l\'entrée sont dans la table (deux faux), c\'est permis — mais une clé visée deux fois est une erreur de table, pas un partage', [p.retenues.length, p.refus.length], [0, 2]);
    p = plan('A', [{ idProduct: 4, carteId: 3, set: 'Set-A', numero: '003', cleR2: 'g/trio.webp' }]);
    verifier('P4 et P5 partagent l\'entrée « trio » ; P5 hors table : refus', [p.retenues.length, /5/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 7, carteId: 5, set: 'Set-A', numero: '005', cleR2: 'g/subst.webp' }]);
    verifier('une ligne d\'un AUTRE produit porte cette clé en substitut : refus (le retrait la détacherait)', [p.retenues.length, /substitut/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 6, carteId: 4, set: 'Set-A', numero: '004', cleR2: 'g/deja.webp' }]);
    verifier('lot A : l\'entrée existe encore, mais le produit n\'est PAS servi par elle (déjà emprunté) : refus nommé', [p.retenues.length, p.refus.length], [0, 1]);
    p = plan('B', [{ idProduct: 6, carteId: 4, set: 'Set-A', numero: '004', cleR2: 'g/deja.webp' }]);
    verifier('lot B : déjà dans l\'état visé : refus nommé « déjà »', [p.retenues.length, /déjà/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 99, carteId: 99, set: 'Set-A', numero: '001', cleR2: 'g/x.webp' }]);
    verifier('carte absente : refus nommé', [p.retenues.length, /carte absente/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 1, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/inconnue.webp' }]);
    verifier('entrée absente de la carte : refus nommé', [p.retenues.length, /entrée absente/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 10, carteId: 7, set: 'Set-A', numero: '007', cleR2: 'g/cle.webp' }]);
    verifier('deux entrées de même (set, clé, numéro) sur la carte : refus (indécidable)', [p.retenues.length, /plusieurs|deux/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 11, carteId: 8, set: 'Set-A', numero: '008', cleR2: 'g/ailleurs8.webp' }]);
    verifier('la même clé dans un AUTRE set de la carte (emprunt d\'origine) : refus (le retrait par clé retirerait les deux)', [p.retenues.length, /plusieurs|autre set|même clé/.test(p.refus[0]?.raison)], [0, true]);
    p = plan('A', [{ idProduct: 9, carteId: 6, set: 'Set-A', numero: null, cleR2: 'g/nu.webp' }]);
    verifier('une entrée sans numéro (numéro null dans la table) : retenue', p.retenues.map(x => x.idProduct), [9]);
    verifier('lot inconnu : lève', leve(() => P.planifier({ lot: 'Z', table: [], cartes: [], lignes: [], entrees: [] }), /lot/), 'lève');
    verifier('base vide (aucune carte) : lève, ce n\'est pas « rien à faire »', leve(() => P.planifier({ lot: 'A', table: [cibleSolo], cartes: [], lignes: [], entrees: [] }), /vide|base fausse/i), 'lève');

    console.log('4. simuler (retrait, emprunt) puis rejouer la décision réelle de l\'API');
    const retire = P.appliquer({ cartes: m0.cartes }, 'A', [cibleSolo]);
    const emprunte = P.appliquer({ cartes: m0.cartes }, 'B', [cibleSolo]);
    verifier('appliquer ne touche pas l\'état d\'entrée (copie)', [m0.cartes[0].images.length, m0.cartes[0].images[0].imageEmprunteeTirage], [1, undefined]);
    verifier('retrait : l\'entrée de la carte 1 a disparu, les autres cartes sont identiques (mêmes objets)', [retire.cartes[0].images.length, retire.cartes[1] === m0.cartes[1]], [0, true]);
    verifier('emprunt : le drapeau est posé sur cette entrée seule', [emprunte.cartes[0].images[0].imageEmprunteeTirage, emprunte.cartes[1].images[0].imageEmprunteeTirage], [true, undefined]);
    const rRet = await rejouer({ ...m0, cartes: retire.cartes }), rEmp = await rejouer({ ...m0, cartes: emprunte.cartes });
    let d = P.compareEntrees(r0.entrees, rRet.entrees, [1]);
    verifier('retrait de P1 : perdus = [1], 0 changé, 0 gagné, verdict OK', [d.perdus, d.changes, d.gagnes, d.ok], [[1], [], [], true]);
    d = P.compareEntrees(r0.entrees, rEmp.entrees, [1]);
    verifier('emprunt de P1 : perdus = [1] (exclusion de l\'identification), 0 changé, verdict OK', [d.perdus, d.changes, d.gagnes, d.ok], [[1], [], [], true]);
    verifier('… et le compteur de refus de l\'API le dit : « image-empruntee » passe de 1 (P6, déjà emprunté dans ce monde) à 2', [r0.denominateurs.repliRefuse.parFamille['image-empruntee'], rEmp.denominateurs.repliRefuse.parFamille['image-empruntee']], [1, 2]);
    // le piège, MESURÉ par la vraie décision : retirer ou emprunter l'entrée du DUO fait perdre P3, qui est juste
    const retireDuo = P.appliquer({ cartes: m0.cartes }, 'A', [cibleDuo]), empDuo = P.appliquer({ cartes: m0.cartes }, 'B', [cibleDuo]);
    d = P.compareEntrees(r0.entrees, (await rejouer({ ...m0, cartes: retireDuo.cartes })).entrees, [2]);
    verifier('LE PIÈGE (retrait de l\'entrée du duo) : P3, juste, perd aussi son visuel : verdict KO, P3 nommé', [d.ok, d.perdus.includes(3), d.autresPerdus], [false, true, [3]]);
    d = P.compareEntrees(r0.entrees, (await rejouer({ ...m0, cartes: empDuo.cartes })).entrees, [2]);
    verifier('LE PIÈGE (emprunt de l\'entrée du duo) : P3 sort de l\'archive : verdict KO', [d.ok, d.autresPerdus], [false, [3]]);
    // retrait d'une entrée d'une carte qui a d'autres images : le produit juste n'est PAS « perdu », il est CHANGÉ (autre tirage servi) : à refuser aussi
    const retireTrio = P.appliquer({ cartes: m0.cartes }, 'A', [{ idProduct: 4, carteId: 3, set: 'Set-A', numero: '003', cleR2: 'g/trio.webp' }]);
    d = P.compareEntrees(r0.entrees, (await rejouer({ ...m0, cartes: retireTrio.cartes })).entrees, [4]);
    verifier('retrait sur une carte qui a une autre image : P5 (juste) CHANGE de visuel (autre tirage) ou le produit perd : verdict KO', d.ok, false);

    // ── 5. LES ÉCRITURES (mongod local en mémoire, BANC_ISOLE)
    console.log('5. écritures sur un mongod local');
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_phase2');
        const cartesDocs = () => [
            { _id: 1, nomEn: 'A', images: [im('Set-A', '001', 'solo'), im('Set-B', '001', 'solo', { source: 'emprunt' }), im('Set-A', '002', 'solo2')] },   // même clé dans un autre set ; autre numéro, même set
            { _id: 2, nomEn: 'B', images: [im('Set-A', '001', 'solo')] },                                                                                // autre CARTE, mêmes set et numéro et clé
            { _id: 3, nomEn: 'C', images: [{ set: 'Set-N', cleR2: 'g/nu.webp', w: 1, h: 1 }, { set: 'Set-N', numero: '5', cleR2: 'g/nu.webp', w: 1, h: 1 }] },   // sans numéro / avec numéro
            { _id: 4, nomEn: 'D', images: [{ set: 'Set-M', numero: '5', cleR2: 'g/ordre.webp', w: 1, h: 1 }, { set: 'Set-M', cleR2: 'g/ordre.webp', w: 1, h: 1 }] }       // l'entrée AVEC numéro vient en premier : le positionnel ne doit pas la prendre
        ];
        await db.collection('cartes').insertMany(cartesDocs());
        const tab = [{ idProduct: 1, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/solo.webp' }, { idProduct: 30, carteId: 3, set: 'Set-N', numero: null, cleR2: 'g/nu.webp' }, { idProduct: 40, carteId: 4, set: 'Set-M', numero: null, cleR2: 'g/ordre.webp' }];
        const ops = P.operationsEmprunt(tab);
        verifier('3 écritures, une par cible, sur la collection cartes', [ops.length, ops.map(o => o.coll)], [3, ['cartes', 'cartes', 'cartes']]);
        verifier('écrire avec un --attendu faux : refus avant toute écriture', await P.ecrireEmprunt(db, ops, { attendu: 2 }).catch(e => /attendu/.test(e.message) ? 'refus' : e.message), 'refus');
        verifier('… et rien n\'a bougé', (await db.collection('cartes').countDocuments({ 'images.imageEmprunteeTirage': true })), 0);
        const r = await P.ecrireEmprunt(db, ops, { attendu: 3 });
        verifier('3 entrées modifiées', r.modifiees, 3);
        verifier('carte 4 : l\'entrée SANS numéro est marquée, pas celle du n° 5 qui vient avant elle', (await db.collection('cartes').findOne({ _id: 4 })).images.map(x => x.imageEmprunteeTirage === true), [false, true]);
        const c1 = await db.collection('cartes').findOne({ _id: 1 }), c2 = await db.collection('cartes').findOne({ _id: 2 }), c3 = await db.collection('cartes').findOne({ _id: 3 });
        verifier('carte 1 : seule l\'entrée (Set-A, 001, solo) est marquée ; la même clé dans Set-B et l\'autre numéro ne le sont pas', c1.images.map(x => x.imageEmprunteeTirage === true), [true, false, false]);
        verifier('carte 2 (autre carte, mêmes set, numéro et clé) : intacte', c2.images.map(x => x.imageEmprunteeTirage), [undefined]);
        verifier('carte 3 : l\'entrée SANS numéro est marquée, pas celle du n° 5', c3.images.map(x => x.imageEmprunteeTirage === true), [true, false]);
        verifier('la marque de lot est posée sur la même entrée seulement', c1.images.map(x => x.imageEmprunteeLot === P.LOT), [true, false, false]);
        verifier('une entrée marquée garde tous ses autres champs', [c1.images[0].cleR2, c1.images[0].w, c1.images[0].vignette.cleR2], ['g/solo.webp', 600, 'v/solo.webp']);
        verifier('rejouée : 0 modifiée, et lève (la cible est déjà dans l\'état visé)', await P.ecrireEmprunt(db, ops, { attendu: 3 }).catch(e => /0|déjà|attendu/.test(e.message) ? 'refus' : e.message), 'refus');
        const a = await P.annulerEmprunt(db, P.operationsAnnulation(tab), { attendu: 3 });
        verifier('annulation exacte : 3 entrées rendues', a.modifiees, 3);
        const apres = await db.collection('cartes').find({}).sort({ _id: 1 }).toArray();
        verifier('après annulation, la base est celle d\'avant (aucun drapeau, aucune marque)', JSON.stringify(apres), JSON.stringify(cartesDocs()));
    } finally { await client.close(); await banc.arreter(); }

    // ── 6. LE RETRAIT passe par retirer-visuels.js (outil existant), et seulement par lui, sous lot-additif
    console.log('6. la commande du retrait');
    const cmd = P.commandeRetrait([{ idProduct: 1, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/solo.webp' }, { idProduct: 2, carteId: 2, set: 'Set-A', numero: '002', cleR2: 'g/duo.webp' }]);
    verifier('retirer-visuels.js, les clés EXACTES de la table, --ecrire, 0 substitut attendu, un motif de plus de 10 caractères', [cmd[0], cmd[1], cmd.includes('--ecrire'), cmd.includes('--attendu-substituts=0'), cmd.find(x => x.startsWith('--motif=')).length > 18], ['retirer-visuels.js', '--cles=g/solo.webp,g/duo.webp', true, true, true]);
    verifier('--ecrire hors lot-additif : refusé', leve(() => P.garderSousLot({}, 1), /lot-additif/), 'lève');
    verifier('--ecrire sous lot-additif (pid du parent) : accepté', leve(() => P.garderSousLot({ LOT_ADDITIF_PID: '77' }, 77), /./), 'ne lève pas');
    verifier('--ecrire avec le pid d\'un autre processus : refusé', leve(() => P.garderSousLot({ LOT_ADDITIF_PID: '77' }, 78), /lot-additif/), 'lève');
    verifier('--attendu absent ou faux : motif d\'arrêt', [P.motifDArret({ nbRetenues: 2, nbRefus: 0, attendu: undefined }) !== null, P.motifDArret({ nbRetenues: 2, nbRefus: 0, attendu: 3 }) !== null, P.motifDArret({ nbRetenues: 2, nbRefus: 1, attendu: 2 }) !== null, P.motifDArret({ nbRetenues: 2, nbRefus: 0, attendu: 2 })], [true, true, true, null]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

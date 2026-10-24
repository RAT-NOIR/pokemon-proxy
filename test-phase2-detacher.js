// BANC — PHASE 2 v2 : DÉTACHER la ligne `cartes_produits` fausse des 20 produits « autre dessin » (décision du testeur, 24/10/2026), par l'outil EXISTANT
// detacher-lignes-prouvees.js (décision '2026-10-24', preuve « vu »). Documents FABRIQUÉS, aucun chemin du testeur ; décision réelle de l'API ; mongod local en mémoire.
//   node test-phase2-detacher.js          (NODE_PATH = node_modules du dépôt principal)
const DL = require('./detacher-lignes-prouvees');
const P = require('./collecte-cartes/phase2-visuels');
const G = require('./collecte-cartes/garde-contrat-api');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const LES_20 = [523095, 321171, 463079, 463069, 824940, 311404, 471679, 471684, 665136, 449138, 450308, 554185, 700771, 471694, 700737, 311405, 371643, 468924, 471699, 700744];
const ids = l => l.map(x => Number(String(x.id).split('|')[1])).sort((a, b) => a - b);
const tri = l => [...l].sort((a, b) => a - b);

(async () => {
    console.log('1. la décision 2026-10-24 : une liste FERMÉE de 20 lignes, chacune avec sa preuve');
    const D = DL.DECISIONS['2026-10-24'];
    verifier('la décision existe', Array.isArray(D), true);
    verifier('exactement les 20 produits désignés par le testeur', D ? ids(D) : null, tri(LES_20));
    verifier('= les 20 écartés « retrait » (15 du lot A + 5 du lot C) de la table du lot : une seule liste, deux outils', tri(P.ECARTES.filter(x => x.geste === 'retrait').map(x => x.idProduct)), tri(LES_20));
    verifier('chaque id est « carte|produit », un produit une seule fois', D && D.every(x => /^\d+\|\d+$/.test(x.id)) && new Set(D.map(x => x.id)).size === 20, true);
    verifier('chaque ligne dit sa preuve « vu », le nom Cardmarket et la carte jointe regardés, et ce qui a été vu', D && D.every(x => x.preuve === 'vu' && x.nomCm && x.carteNom && typeof x.vu === 'string' && x.vu.length > 25), true);
    verifier('chaque ligne nomme les produits JUSTES qui partagent la même carte, et ils ne sont jamais dans la décision', D && D.every(x => Array.isArray(x.justes) && x.justes.length >= 1 && !x.justes.some(j => ids(D).includes(j))), true);
    verifier('les produits justes de la décision sont ceux de la table du lot (une seule vérité : P.ECARTES.partageAvec)', D && D.every(x => JSON.stringify([...x.justes].sort()) === JSON.stringify([...P.ECARTES.find(e => e.idProduct === Number(x.id.split('|')[1])).partageAvec].sort())), true);
    verifier('le type de reste écrit est celui de la décision (fiche-contredite-par-la-vue)', D && D.every(x => x.type === 'fiche-contredite-par-la-vue'), true);
    verifier('les décisions antérieures sont intactes (26 et 2 lignes)', [DL.DECISIONS['2026-09-25'].length, DL.DECISIONS['2026-10-08'].length], [26, 2]);
    verifier('aucune des 20 n\'est une ligne interdite', D && D.some(x => DL.estInterdite(x.id)), false);

    console.log('2. le rejeu de la preuve à l\'écriture (pur) : rien ne s\'écrit si ce qui a été regardé n\'est plus ce qui est en base');
    const x = D && D.find(l => l.id === '246144|463079');
    const carte = { nomEn: 'Victory Proof', attaques: [] };
    verifier('le produit et la carte sont ceux qui ont été regardés : la ligne est jugée fausse (verdict écrit)', !!DL.jugerLigne(x, 'Victory Proof', carte, null, { autres: 0 }).verdict, true);
    verifier('le nombre d\'autres lignes n\'est pas fourni (« inconnu ») : REFUS — jamais « tout va bien » (D2, fail-closed)', DL.jugerLigne(x, 'Victory Proof', carte, null).verdict, null);
    verifier('le nom Cardmarket du produit a changé depuis : REFUS', DL.jugerLigne(x, 'Victory Proof 2', carte, null, { autres: 0 }).verdict, null);
    verifier('la carte jointe n\'est plus celle regardée : REFUS', DL.jugerLigne(x, 'Victory Proof', { nomEn: 'Autre', attaques: [] }, null, { autres: 0 }).verdict, null);
    verifier('carte absente : REFUS', DL.jugerLigne(x, 'Victory Proof', null, null, { autres: 0 }).verdict, null);
    verifier('une preuve « vu » ne se rejoue jamais sur une ligne d\'une autre décision (preuve inconnue : REFUS)', DL.jugerLigne({ ...x, preuve: 'zzz' }, 'Victory Proof', carte, null).verdict, null);

    console.log('2 bis. D2 : le produit garde une AUTRE ligne, ou n\'a aucun juste nommé : la preuve « vu » REFUSE');
    verifier('autres lignes = 0 : la ligne est jugée (verdict écrit)', !!DL.jugerLigne(x, 'Victory Proof', carte, null, { autres: 0 }).verdict, true);
    verifier('le produit a une AUTRE ligne (autres = 1) : REFUS (il ne serait pas « sans ligne »)', DL.jugerLigne(x, 'Victory Proof', carte, null, { autres: 1 }).verdict, null);
    verifier('aucun produit juste nommé (justes = []) : REFUS', DL.jugerLigne({ ...x, justes: [] }, 'Victory Proof', carte, null, { autres: 0 }).verdict, null);
    verifier('justes absent : REFUS', DL.jugerLigne({ ...x, justes: undefined }, 'Victory Proof', carte, null, { autres: 0 }).verdict, null);
    verifier('les 20 lignes de la décision nomment toutes au moins un juste', D.every(l => l.justes.length >= 1), true);

    console.log('2 ter. D3 : « --ecrire » ne tourne que SOUS lot-additif.js (LOT_ADDITIF_PID), comme corriger-visuels-phase2.js — vérifié sur le vrai processus, avant toute connexion');
    const { spawnSync } = require('child_process');
    const sansUri = e => { const c = { ...e }; for (const k of Object.keys(c)) if (/^MONGODB_|^R2_|^LOT_ADDITIF_PID$/.test(k)) delete c[k]; return c; };
    const lancer = (args, env) => spawnSync(process.execPath, ['detacher-lignes-prouvees.js', ...args], { cwd: __dirname, env, encoding: 'utf8', timeout: 60000 });
    let r = lancer(['--decision=2026-10-24', '--ecrire'], sansUri(process.env));
    verifier('--ecrire sans LOT_ADDITIF_PID : code 2, message « lot-additif », rien lu ni écrit', [r.status, /lot-additif/.test(r.stderr), /VARIABLE|variable/.test(r.stderr)], [2, true, false]);
    r = lancer(['--decision=2026-10-24', '--ecrire'], { ...sansUri(process.env), LOT_ADDITIF_PID: '1' });
    verifier('--ecrire avec le pid d\'un AUTRE processus : refusé de même', [r.status, /lot-additif/.test(r.stderr)], [2, true]);
    r = lancer(['--decision=2026-10-24', '--annonce=ne-sera-pas-ecrite.json'], sansUri(process.env));
    verifier('la SIMULATION (--annonce) ne demande pas le lot : elle va jusqu\'à la connexion (et échoue ici sur les variables absentes, pas sur lot-additif)', [/lot-additif/.test(r.stderr), r.status !== 0], [false, true]);
    r = lancer(['--decision=2026-10-24', '--ecrire', '--annonce=x.json'], sansUri(process.env));
    verifier('l\'usage inchangé : --ecrire avec --annonce reste refusé (code 2)', r.status, 2);

    console.log('3. le détachement en mémoire, jugé par la VRAIE décision de l\'API');
    const api = await G.chargerApi();
    const im = (set, numero, n) => ({ set, numero, cleR2: `g/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `v/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const monde = () => ({
        sets: [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }],
        cartes: [
            { _id: 1, nomEn: 'Duo', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '001', total: '100', rarete: 'Rare' }], images: [im('Set-A', '001', 'duo')], liens: { idProduct: [10, 11], idMetacards: [5] } },
            { _id: 2, nomEn: 'Autre', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '002', total: '100', rarete: 'Rare' }], images: [im('Set-A', '002', 'autre')], liens: { idProduct: [12], idMetacards: [6] } }],
        cartesProduits: [
            { _id: '1|10', carteId: 1, idProduct: 10, idExpansion: 100, numeroFiche: '001', slug: 'P10', slugSet: 'Set-A' },       // juste
            { _id: '1|11', carteId: 1, idProduct: 11, idExpansion: 100, numeroFiche: '001', slug: 'P11', slugSet: 'Set-A' },       // faux : autre impression, joint à la même carte
            { _id: '2|12', carteId: 2, idProduct: 12, idExpansion: 100, numeroFiche: '002', slug: 'P12', slugSet: 'Set-A' }]
    });
    const decide = async m => api.decider({ sets: m.sets, docs: m.cartes, lignes: m.cartesProduits, metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false });
    const m0 = monde(), r0 = await decide(m0);
    verifier('avant : les trois produits sont servis, P10 et P11 par la MÊME entrée', [...new Set(r0.entrees.map(e => e.idProduct))].sort(), [10, 11, 12]);
    verifier('detacherEnMemoire : la ligne de P11 disparaît, celle de P10 reste, le lien P11 est retiré de la carte, P10 et P12 gardent le leur',
        (() => { const a = P.detacherEnMemoire(m0, ['1|11']); return [a.cartesProduits.map(l => l._id), a.cartes.find(c => c._id === 1).liens.idProduct, a.cartes.find(c => c._id === 2).liens.idProduct]; })(), [['1|10', '2|12'], [10], [12]]);
    verifier('l\'état d\'entrée n\'est pas modifié', [m0.cartesProduits.length, m0.cartes[0].liens.idProduct], [3, [10, 11]]);
    const a1 = P.detacherEnMemoire(m0, ['1|11']);
    const r1 = await decide({ ...m0, ...a1 });
    let d = P.compareEntrees(r0.entrees, r1.entrees, [11]);
    verifier('API après : P11 perd son entrée (« sans ligne »), P10 (juste, même entrée) garde la sienne, rien ne change ni ne naît : verdict OK', [d.perdus, d.autresPerdus, d.changes, d.gagnes, d.ok], [[11], [], [], [], true]);
    verifier('P10 sert toujours exactement la même entrée (visuel, clé)', JSON.stringify(r1.entrees.filter(e => e.idProduct === 10)) === JSON.stringify(r0.entrees.filter(e => e.idProduct === 10)), true);
    // le geste fautif que cette décision remplace : retirer l'ENTRÉE fait perdre P10
    d = P.compareEntrees(r0.entrees, (await decide({ ...m0, cartes: P.appliquer({ cartes: m0.cartes }, 'A', [{ idProduct: 11, carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/duo.webp' }]).cartes })).entrees, [11]);
    verifier('à titre de contraste : retirer l\'entrée au lieu de la ligne ferait perdre P10, le juste', [d.ok, d.autresPerdus], [false, [10]]);
    verifier('detacherEnMemoire lève sur une ligne absente (jamais « rien à faire » en silence)', (() => { try { P.detacherEnMemoire(m0, ['1|99']); return 'ne lève pas'; } catch (e) { return /1\|99/.test(e.message) ? 'lève' : e.message; } })(), 'lève');

    console.log('4. l\'ÉCRITURE (mongod local) : la ligne fausse, le lien de CE produit, le reste nommé — et rien chez le produit juste');
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_phase2_detacher');
        const base = monde();
        await db.collection('cartes').insertMany(base.cartes);
        await db.collection('cartes_produits').insertMany(base.cartesProduits.map(l => ({ ...l, preuve: 'set+nom' })));
        const plan = [{ x: { id: '1|11', type: 'fiche-contredite-par-la-vue', pourquoi: 'autre impression vue' }, l: { _id: '1|11', carteId: 1, idProduct: 11, slugSet: 'Set-A', preuve: 'set+nom' }, nom: 'Duo [A | B]', verdict: 'vu à l\'œil : autre impression', autres: 0 }];
        const r = await DL.appliquerPlan({ L: db.collection('cartes_produits'), C: db.collection('cartes'), R: db.collection('restes') }, plan, '2026-10-24');
        verifier('1 ligne détachée, 1 reste écrit (le produit reste sans ligne)', [r.supprimees, r.restes], [1, 1]);
        verifier('reste : la ligne de P10 (juste, même carte) est INTACTE, et P12 aussi', (await db.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray()).map(l => l._id), ['1|10', '2|12']);
        verifier('le lien 11 est retiré de la carte 1 seulement ; 10 reste ; la carte 2 est intacte', [(await db.collection('cartes').findOne({ _id: 1 })).liens.idProduct, (await db.collection('cartes').findOne({ _id: 2 })).liens.idProduct], [[10], [12]]);
        const reste = await db.collection('restes').findOne({ idProduct: 11 });
        verifier('le reste nomme le produit, la carte, le type et la décision (le trou est NOMMÉ)', [reste.type, reste.set, reste.carteId, /2026-10-24/.test(reste.detail)], ['fiche-contredite-par-la-vue', 'Set-A', 1, true]);
        verifier('rejoué : rien à supprimer, et l\'outil le DIT (code d\'échec, pas un faux succès)', await DL.appliquerPlan({ L: db.collection('cartes_produits'), C: db.collection('cartes'), R: db.collection('restes') }, plan, '2026-10-24').then(x => x.supprimees === 0 && x.complet === false, () => 'lève'), true);
    } finally { await client.close(); await banc.arreter(); }

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

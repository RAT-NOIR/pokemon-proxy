// BANC — poser-fiches-svp-energies.js : planification pure + écriture sur une FAUSSE base en mémoire (jamais la production).
//   node test-poser-fiches-svp-energies.js
const T = require('./poser-fiches-svp-energies');
const E = require('./collecte-cartes/regle-e-svp');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};

const SLUG = 'Scarlet-Violet-Promos';
const SET = { _id: SLUG, code: 'SV-P', tirage: 'jp', region: 'jp', idExpansion: [5212], bulba: { expansion: E.EXPANSION } };
const imp = numero => ({ tirage: 'jp', expansion: E.EXPANSION, deck: null, numero, total: 'SV-P', rarete: null, illustrateur: null });
const carte = (id, nomEn, numeros = ['037', '079'], sets = [SLUG, 'Autre']) => ({ _id: id, nomEn, sets: [...sets], impressions: numeros.map(imp), liens: { idProduct: [1, 2], idMetacards: [10] } });
const GRASS = { idProduct: 731904, name: 'Basic Grass Energy' }, FIRE = { idProduct: 731905, name: 'Basic Fire Energy' };
const JA = { 100: '基本草エネルギー', 101: '基本炎エネルギー' };
const clone = { parProduit: new Map([[731904, [{ setId: 'SV-P', localId: '100' }]], [731905, [{ setId: 'SV-P', localId: '101' }]]]) };
const fiches = new Map([[731904, { slug: 'Basic-Grass-Energy-V9', idMetacard: 10 }], [731905, { slug: 'Basic-Fire-Energy-V9', idMetacard: 11 }]]);
const monde = (o = {}) => T.planifier({
    produits: o.produits ?? [GRASS, FIRE, { idProduct: 9, name: 'Nemona' }],
    lignes: o.lignes ?? [],
    nums: o.nums ?? new Map([[731904, '100'], [731905, '101']]),
    fiches: o.fiches ?? fiches,
    cartes: o.cartes ?? [carte(60754, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy')],
    setDoc: o.setDoc ?? SET, clone: o.clone ?? clone, nomJa: n => JA[n] ?? null
});

// ── le cas sain
const bon = monde();
verifier('deux lignes retenues (Grass n°100, Fire n°101), Nemona refusé', [bon.retenus.map(r => [r.p.idProduct, r.carteId, r.numero]), bon.refus.map(r => r.idProduct)], [[[731904, 60754, '100'], [731905, 13682, '101']], [9]]);
verifier('la preuve est explicite et nomme les trois pièces', [T.PREUVE, bon.retenus[0].ligne.preuve], ['tcgdex-idproduct+numero+type', 'tcgdex-idproduct+numero+type']);
verifier('la ligne : numeroFiche = numéro Cardmarket, slugSet = le set, slug du produit, tirage jp, exp 5212, _id carte|produit',
    (({ _id, numeroFiche, slugSet, slug, tirage, idExpansion }) => ({ _id, numeroFiche, slugSet, slug, tirage, idExpansion }))(bon.retenus[0].ligne),
    { _id: '60754|731904', numeroFiche: '100', slugSet: SLUG, slug: 'Basic-Grass-Energy-V9', tirage: 'jp', idExpansion: 5212 });
verifier('l\'impression SV-P au n°100 est posée (source conservée, total SV-P, tirage jp)', (({ tirage, expansion, numero, total, deck, source }) => ({ tirage, expansion, numero, total, deck, source }))(bon.retenus[0].impression),
    { tirage: 'jp', expansion: E.EXPANSION, numero: '100', total: 'SV-P', deck: null, source: 'numero-cardmarket' });
verifier('la carte a déjà le set : pas d\'appartenance à ajouter', bon.retenus.map(r => r.ajouteSet), [false, false]);

// ── ce qui ne se pose pas
verifier('un produit qui a DÉJÀ une ligne : refusé, jamais reposé', (() => { const m = monde({ lignes: [{ idProduct: 731904, carteId: 60754 }] }); return [m.retenus.map(r => r.p.idProduct), m.refus.filter(r => /déjà une ligne/.test(r.raison)).map(r => r.idProduct)]; })(), [[731905], [731904]]);
verifier('un produit qui a déjà une ligne sur une AUTRE carte : refusé aussi', monde({ lignes: [{ idProduct: 731904, carteId: 777 }] }).retenus.length, 1);
verifier('deux cartes candidates (unicité) : refus, aucune fiche', (() => { const m = monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(99999, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy')] }); return [m.retenus.map(r => r.p.idProduct), m.refus.find(r => r.idProduct === 731904).condition]; })(), [[731905], 4]);
verifier('type contradictoire : refus', monde({ clone: { parProduit: new Map([[731904, [{ setId: 'SV-P', localId: '101' }]]]) }, nums: new Map([[731904, '101']]) }).retenus.length, 0);
verifier('numéro différent : refus', monde({ nums: new Map([[731904, '175'], [731905, '101']]) }).retenus.map(r => r.p.idProduct), [731905]);
verifier('idProduct absent de TCGdex : refus', monde({ clone: { parProduit: new Map() } }).retenus.length, 0);

// ── impression et appartenance
verifier('la carte a déjà l\'impression au n°100 : pas de seconde impression, la ligne est quand même posée', (() => { const m = monde({ cartes: [carte(60754, 'Basic Grass Energy', ['037', '079', '100']), carte(13682, 'Basic Fire Energy')] }); return [m.retenus.length, m.retenus[0].impression]; })(), [2, null]);
verifier('l\'impression « 0100 » existante vaut 100 (comparaison des numéros, pas des chaînes)', monde({ cartes: [carte(60754, 'Basic Grass Energy', ['0100']), carte(13682, 'Basic Fire Energy')] }).retenus[0].impression, null);
verifier('la carte n\'a pas le set : appartenance à ajouter', monde({ cartes: [carte(60754, 'Basic Grass Energy', ['037'], ['Autre']), carte(13682, 'Basic Fire Energy')] }).retenus.map(r => r.ajouteSet), [true, false]);
verifier('deux produits de la même carte au même numéro : UNE impression', (() => {
    const cl = { parProduit: new Map([[731904, [{ setId: 'SV-P', localId: '100' }]], [731999, [{ setId: 'SV-P', localId: '100' }]]]) };
    const m = monde({ produits: [GRASS, { idProduct: 731999, name: 'Basic Grass Energy' }], nums: new Map([[731904, '100'], [731999, '100']]), clone: cl, fiches: new Map() });
    return [m.retenus.length, m.retenus.filter(r => r.impression).length];
})(), [2, 1]);
verifier('le set n\'est pas SV-P (autre nom d\'expansion) : le plan LÈVE', (() => { try { monde({ setDoc: { ...SET, bulba: { expansion: 'Autre' } } }); return 'pas de levée'; } catch (e) { return 'levée'; } })(), 'levée');
verifier('le set n\'est pas japonais : le plan LÈVE', (() => { try { monde({ setDoc: { ...SET, tirage: 'intl', region: 'intl' } }); return 'pas de levée'; } catch (e) { return 'levée'; } })(), 'levée');
verifier('le set n\'a pas l\'expansion 5212 : le plan LÈVE', (() => { try { monde({ setDoc: { ...SET, idExpansion: [1] } }); return 'pas de levée'; } catch (e) { return 'levée'; } })(), 'levée');

// ── les gardes d'écriture
verifier('--attendu exact : passe', T.verifierAttendu(bon, 2), { ok: true });
verifier('--attendu différent : refuse', T.verifierAttendu(bon, 31).ok, false);
verifier('--attendu absent : refuse', T.verifierAttendu(bon, undefined).ok, false);
verifier('calibration : 0 faux et assez de jugées = ok', T.garderCalibration({ jugees: 15, justes: 15, faux: 0 }).ok, true);
verifier('calibration : un faux = refus', T.garderCalibration({ jugees: 15, justes: 14, faux: 1 }).ok, false);
verifier('calibration : trop peu de cas jugés = refus (un 0 faux sur 3 cas ne prouve rien)', T.garderCalibration({ jugees: 3, justes: 3, faux: 0 }).ok, false);

// ── l'écriture, sur une fausse base (le contrat Mongo minimal des opérations de l'outil)
function fauxDb(init) {
    const col = {}; for (const [k, v] of Object.entries(init)) col[k] = v.map(d => JSON.parse(JSON.stringify(d)));
    const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
    const journal = [];
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => {
        if (k === 'impressions' && v.$not) { const m = v.$not.$elemMatch; return !(d.impressions || []).some(i => Object.entries(m).every(([a, b]) => i[a] === b)); }
        if (v && typeof v === 'object' && v.$in) return v.$in.includes(d[k]);
        return d[k] === v;
    });
    return { journal, col, collection: nom => ({
        find: f => ({ toArray: async () => (col[nom] ||= []).filter(d => correspond(d, f)).map(d => JSON.parse(JSON.stringify(d))) }),
        bulkWrite: async ops => {
            let upsertedCount = 0, modifiedCount = 0;
            for (const { updateOne: { filter, update, upsert } } of ops) {
                journal.push(nom);
                let d = (col[nom] ||= []).find(x => correspond(x, filter));
                if (!d && upsert && update.$setOnInsert) { d = { _id: filter._id }; col[nom].push(d); Object.assign(d, JSON.parse(JSON.stringify(update.$setOnInsert))); upsertedCount++; continue; }
                if (!d) continue;
                const avant = JSON.stringify(d);
                for (const [p, v] of Object.entries(update.$addToSet || {})) { const l = get(d, p) || []; for (const x of v.$each) if (!l.includes(x)) l.push(x); set(d, p, l); }
                for (const [p, v] of Object.entries(update.$push || {})) { const l = get(d, p) || []; l.push(v); set(d, p, l); }
                if (JSON.stringify(d) !== avant) modifiedCount++;
            }
            return { upsertedCount, modifiedCount };
        }
    }) };
}
const monDoc = () => fauxDb({ cartes: [carte(60754, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy', ['037'], ['Autre'])], cartes_produits: [] });
(async () => {
    const db = monDoc();
    const r1 = await T.ecrire(db, bon);
    verifier('écriture : 2 lignes, 2 impressions, 2 cartes touchées', r1, { lignes: 2, impressions: 2, cartes: 2 });
    verifier('LES LIGNES S\'ÉCRIVENT EN DERNIER (une reprise après arrêt rejoue le même plan)', db.journal.join(',').replace(/cartes,/g, 'c,').replace(/cartes_produits/g, 'L'), 'c,c,c,c,L,L');
    verifier('la carte garde ses impressions et reçoit le n°100 ; liens.idProduct ajouté EN FIN (le repère reste le premier)', (c => [c.impressions.map(i => i.numero), c.liens.idProduct, c.liens.idMetacards])(db.col.cartes.find(c => c._id === 60754)), [['037', '079', '100'], [1, 2, 731904], [10]]);
    verifier('la carte sans le set le reçoit (addToSet), et sa métacarte', (c => [c.sets, c.liens.idMetacards])(db.col.cartes.find(c => c._id === 13682)), [['Autre', SLUG], [10, 11]]);
    verifier('la ligne écrite porte la preuve et le numéro', (l => [l._id, l.preuve, l.numeroFiche])(db.col.cartes_produits.find(l => l.idProduct === 731904)), ['60754|731904', 'tcgdex-idproduct+numero+type', '100']);
    const rel = await T.relire(db, bon);
    verifier('relecture : tout ce que le plan attend est en base', rel, { lignesOk: 2, impressionsOk: 2, cartesOk: 2, attendu: 2 });
    const r2 = await T.ecrire(db, bon).then(() => 'écrit', e => 'refusé');
    verifier('relancée avec le MÊME plan alors que les lignes existent : REFUSÉE (jamais reposée), rien ne bouge', [r2, db.col.cartes_produits.length, db.col.cartes.find(c => c._id === 60754).impressions.length], ['refusé', 2, 3]);

    // une ligne apparue entre la simulation et l'écriture : rien n'est écrit (ni carte ni impression)
    const db2 = monDoc(); db2.col.cartes_produits.push({ _id: '777|731904', carteId: 777, idProduct: 731904 });
    const r3 = await T.ecrire(db2, bon).then(() => 'écrit', e => 'refusé');
    verifier('une ligne apparue entre-temps : refus AVANT toute écriture', [r3, db2.journal.length, db2.col.cartes.find(c => c._id === 60754).impressions.length], ['refusé', 0, 2]);

    // reprise : cartes et impressions écrites, lignes non — le même plan s'achève
    const db3 = monDoc();
    await db3.collection('cartes').bulkWrite(T.operationsEcriture(bon).cartes, { ordered: false });
    const r4 = await T.ecrire(db3, bon);
    verifier('REPRISE après un arrêt avant les lignes : le plan s\'achève, aucune impression en double', [r4.lignes, db3.col.cartes.find(c => c._id === 60754).impressions.length], [2, 3]);

    // la garde des opérations sur `cartes` : liste fermée
    verifier('les opérations sur cartes sont exactement des $addToSet $each sur liens.idProduct, liens.idMetacards, sets', T.operationsEcriture(bon).cartes.every(o => Object.keys(o.updateOne.update).join() === '$addToSet'), true);
    verifier('une impression s\'écrit par un $push gardé par un filtre (jamais deux fois)', Object.keys(T.operationsEcriture(bon).impressions[0].updateOne.filter).sort(), ['_id', 'impressions']);
    verifier('une ligne s\'écrit en $setOnInsert avec upsert (n\'écrase rien)', (o => [Object.keys(o.updateOne.update).join(), o.updateOne.upsert])(T.operationsEcriture(bon).lignes[0]), ['$setOnInsert', true]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

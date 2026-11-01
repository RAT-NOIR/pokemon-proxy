// BANC — poser-fiches-energies-m6a.js : planification pure + écriture sur une FAUSSE base en mémoire (jamais la production, aucune connexion).
//   node test-poser-fiches-energies-m6a.js
const T = require('./poser-fiches-energies-m6a');
const R = require('./collecte-cartes/regle-e-code');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};

const SLUG = '30th-Celebration-JP', EXPANSION = '30th Celebration';
const SET = { _id: SLUG, code: 'm6a', tirage: 'jp', region: 'jp', idExpansion: [6602], bulba: { expansion: EXPANSION } };
const imp = () => ({ tirage: 'jp', expansion: EXPANSION, deck: null, numero: null, total: null, rarete: null, illustrateur: null });
const carte = (id, nomEn, sets = ['Autre'], impressions = [imp()]) => ({ _id: id, nomEn, sets: [...sets], impressions, liens: { idProduct: [1, 2], idMetacards: [10] } });
const GRASS = { idProduct: 907931, name: 'Basic Grass Energy' }, FIRE = { idProduct: 907932, name: 'Basic Fire Energy' };
const JA = { GRA: '基本草エネルギー', FIR: '基本炎エネルギー', WAT: '基本水エネルギー', B: 'ミュウ' };
const fiches = new Map([[907931, { slug: 'Basic-Grass-Energy-m6aGRA', idMetacard: 10 }], [907932, { slug: 'Basic-Fire-Energy-m6aFIR', idMetacard: 11 }]]);
const monde = (o = {}) => T.planifier({
    produits: o.produits ?? [GRASS, FIRE, { idProduct: 9, name: 'Delcatty [Energy Draw | Max Energy Source]' }],
    lignes: o.lignes ?? [],
    nums: o.nums ?? new Map([[907931, 'GRA'], [907932, 'FIR']]),
    fiches: o.fiches ?? fiches,
    cartes: o.cartes ?? [carte(60754, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy')],
    setDoc: o.setDoc ?? SET, clone: o.clone ?? { parProduit: new Map() }, nomJa: o.nomJa ?? (c => JA[c] ?? null)
});

// ── le cas sain : DEUX sources concordent (nom+code Cardmarket, carte M6a/<code> de TCGdex), carte unique
const bon = monde();
verifier('deux lignes retenues (Grass GRA, Fire FIR), le Pokémon refusé', [bon.retenus.map(r => [r.p.idProduct, r.carteId, r.numero]), bon.refus.map(r => r.idProduct)], [[[907931, 60754, 'GRA'], [907932, 13682, 'FIR']], [9]]);
verifier('la ligne : numeroFiche = le code, slugSet, slug, tirage jp, exp 6602, preuve du type+code, _id carte|produit',
    (({ _id, numeroFiche, slugSet, slug, tirage, idExpansion, preuve }) => ({ _id, numeroFiche, slugSet, slug, tirage, idExpansion, preuve }))(bon.retenus[0].ligne),
    { _id: '60754|907931', numeroFiche: 'GRA', slugSet: SLUG, slug: 'Basic-Grass-Energy-m6aGRA', tirage: 'jp', idExpansion: 6602, preuve: T.PREUVE });
verifier('l\'impression au code est posée (source conservée, expansion 30th Celebration, total null)', (({ tirage, expansion, numero, total, deck, source }) => ({ tirage, expansion, numero, total, deck, source }))(bon.retenus[0].impression),
    { tirage: 'jp', expansion: EXPANSION, numero: 'GRA', total: null, deck: null, source: 'numero-cardmarket' });
verifier('la carte n\'a pas le set : appartenance à ajouter', bon.retenus.map(r => r.ajouteSet), [true, true]);

// ── la SECONDE source : sans elle, rien ne s'écrit (ces cas tuent le mutant « seconde source ignorée »)
verifier('TCGdex dit Eau pour le code FIR alors que le produit est Feu : refus (condition 3)', (m => [m.retenus.map(r => r.p.idProduct), m.refus.find(r => r.idProduct === 907932).condition])(monde({ nomJa: c => (c === 'FIR' ? JA.WAT : JA[c] ?? null) })), [[907931], 3]);
verifier('TCGdex n\'a aucune carte M6a/FIR : refus (condition 2), jamais « Cardmarket seul »', (m => [m.retenus.map(r => r.p.idProduct), m.refus.find(r => r.idProduct === 907932).condition])(monde({ nomJa: c => (c === 'FIR' ? null : JA[c] ?? null) })), [[907931], 2]);
verifier('TCGdex muet partout : aucune ligne', monde({ nomJa: () => null }).retenus.length, 0);
verifier('le code appris désigne une carte TCGdex qui n\'est pas une énergie de base (B = Mew) : refus', monde({ produits: [{ idProduct: 907940, name: 'Basic Grass Energy' }], nums: new Map([[907940, 'B']]), fiches: new Map() }).retenus.length, 0);
verifier('un code hors de la table fermée (XXX), même si TCGdex a un nom d\'énergie : refus', monde({ produits: [GRASS], nums: new Map([[907931, 'XXX']]), nomJa: () => JA.GRA }).retenus.length, 0);
verifier('le type du produit (Feu) contredit le type de la table pour le code (GRA = Plante) : refus', monde({ produits: [FIRE], nums: new Map([[907932, 'GRA']]) }).retenus.length, 0);
verifier('pas de numéro appris : refus', monde({ nums: new Map([[907932, 'FIR']]) }).retenus.map(r => r.p.idProduct), [907932]);

// ── TCGdex nomme le produit AILLEURS (c'est le cas réel : thirdParty.cardmarket de M6a pointe les produits CHINOIS 9083xx)
verifier('TCGdex nomme ce produit à un AUTRE code : refus (contradiction)', monde({ clone: { parProduit: new Map([[907931, [{ setId: 'M6a', localId: 'WAT' }]]]) } }).retenus.map(r => r.p.idProduct), [907932]);
verifier('TCGdex nomme ce produit dans un AUTRE set : refus', monde({ clone: { parProduit: new Map([[907931, [{ setId: 'SV-P', localId: 'GRA' }]]]) } }).retenus.map(r => r.p.idProduct), [907932]);
verifier('TCGdex nomme ce produit au MÊME code de M6a : accepté', monde({ clone: { parProduit: new Map([[907931, [{ setId: 'M6a', localId: 'GRA' }]]]) } }).retenus.length, 2);

// ── unicité de la carte
verifier('deux cartes candidates : refus, aucune fiche (condition 5)', (m => [m.retenus.map(r => r.p.idProduct), m.refus.find(r => r.idProduct === 907931).condition])(monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(99999, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy')] })), [[907932], 5]);
verifier('aucune carte portant l\'impression du set : refus', monde({ cartes: [carte(13682, 'Basic Fire Energy')] }).retenus.map(r => r.p.idProduct), [907932]);
verifier('une fiche simple d\'un AUTRE tirage du même nom (expansion différente) n\'est pas candidate', monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(-910351, 'Basic Grass Energy', ['X'], [{ tirage: 'zh-hans', expansion: '30th Celebration Simplified Chinese Premium Deck Set', numero: 'GRA' }]), carte(13682, 'Basic Fire Energy')] }).retenus.length, 2);
verifier('un produit qui a DÉJÀ une ligne (n\'importe quelle carte) : refusé, jamais reposé', (m => [m.retenus.map(r => r.p.idProduct), m.refus.filter(r => /déjà une ligne/.test(r.raison)).map(r => r.idProduct)])(monde({ lignes: [{ idProduct: 907931, carteId: 777 }] })), [[907932], [907931]]);

// ── bidirectionnel, multiplicités comptées
verifier('deux produits au MÊME code : aucun des deux n\'est posé', monde({ produits: [GRASS, { idProduct: 907999, name: 'Basic Grass Energy' }], nums: new Map([[907931, 'GRA'], [907999, 'GRA']]), fiches: new Map() }).retenus.length, 0);

// ── impression et set
verifier('la carte a déjà l\'impression au code : pas de seconde, la ligne est posée quand même', (m => [m.retenus.length, m.retenus[0].impression])(monde({ cartes: [carte(60754, 'Basic Grass Energy', ['Autre'], [imp(), { ...imp(), numero: 'GRA' }]), carte(13682, 'Basic Fire Energy')] })), [2, null]);
verifier('la carte a déjà le set : pas d\'appartenance à ajouter', monde({ cartes: [carte(60754, 'Basic Grass Energy', [SLUG]), carte(13682, 'Basic Fire Energy')] }).retenus.map(r => r.ajouteSet), [false, true]);

// ── le set
for (const [quoi, setDoc] of [['pas japonais', { ...SET, tirage: 'intl', region: 'intl' }], ['autre nom d\'expansion', { ...SET, bulba: { expansion: 'Autre' } }], ['autre idExpansion', { ...SET, idExpansion: [1] }], ['autre code', { ...SET, code: 'm6b' }]])
    verifier(`le set n'est pas m6a (${quoi}) : le plan LÈVE`, (() => { try { monde({ setDoc }); return 'pas de levée'; } catch (e) { return 'levée'; } })(), 'levée');

// ── les gardes d'écriture et les arguments
verifier('--attendu exact : passe', T.verifierAttendu(bon, 2), { ok: true });
verifier('--attendu différent : refuse', T.verifierAttendu(bon, 8).ok, false);
verifier('--attendu absent : refuse', T.verifierAttendu(bon, undefined).ok, false);
const sans = async argv => { const sortie = []; const code = await T.executer({ argv, ouvrir: async () => { throw new Error('connexion interdite au banc'); }, lireClone: () => { throw new Error('clone interdit au banc'); }, chargerSite: async () => { throw new Error('site interdit'); }, log: () => {}, err: m => sortie.push(m) }); return [code, sortie.length > 0]; };

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
const monDoc = () => fauxDb({ cartes: [carte(60754, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy', [SLUG])], cartes_produits: [] });

(async () => {
    verifier('argument inconnu : refus (code 2) avant toute connexion', await sans(['--tcgdex=x', '--bidon']), [2, true]);
    verifier('--tcgdex absent : refus', await sans([]), [2, true]);
    verifier('--ecrire sans --attendu : refus', await sans(['--tcgdex=x', '--ecrire']), [2, true]);
    verifier('--attendu non entier : refus', await sans(['--tcgdex=x', '--attendu=abc']), [2, true]);

    const ops = T.operationsEcriture(bon);
    const texte = JSON.stringify(ops);
    verifier('ADDITIF : aucune opération $unset / $pull / $set / delete', ['$unset', '$pull', '$set"', 'deleteOne', 'deleteMany', 'replaceOne'].filter(m => texte.includes(m)), []);
    verifier('les opérations sur cartes sont exactement des $addToSet', ops.cartes.every(o => Object.keys(o.updateOne.update).join() === '$addToSet'), true);
    verifier('une ligne s\'écrit en $setOnInsert avec upsert', (o => [Object.keys(o.updateOne.update).join(), o.updateOne.upsert])(ops.lignes[0]), ['$setOnInsert', true]);

    const db = monDoc();
    const r1 = await T.ecrire(db, bon);
    verifier('écriture : 2 lignes, 2 impressions, 2 cartes touchées', r1, { lignes: 2, impressions: 2, cartes: 2 });
    verifier('LES LIGNES S\'ÉCRIVENT EN DERNIER', db.journal.join(',').replace(/cartes,/g, 'c,').replace(/cartes_produits/g, 'L'), 'c,c,c,c,L,L');
    verifier('la carte garde son impression sans numéro et reçoit « GRA » ; liens.idProduct ajouté EN FIN', (c => [c.impressions.map(i => i.numero), c.liens.idProduct, c.sets])(db.col.cartes.find(c => c._id === 60754)), [[null, 'GRA'], [1, 2, 907931], ['Autre', SLUG]]);
    verifier('relecture : tout ce que le plan attend est en base', await T.relire(db, bon), { lignesOk: 2, impressionsOk: 2, cartesOk: 2, attendu: 2 });
    const r2 = await T.ecrire(db, bon).then(() => 'écrit', () => 'refusé');
    verifier('relancée alors que les lignes existent : REFUSÉE, rien ne bouge', [r2, db.col.cartes_produits.length, db.col.cartes.find(c => c._id === 60754).impressions.length], ['refusé', 2, 2]);
    const db2 = monDoc(); db2.col.cartes_produits.push({ _id: '777|907931', carteId: 777, idProduct: 907931 });
    const r3 = await T.ecrire(db2, bon).then(() => 'écrit', () => 'refusé');
    verifier('une ligne apparue entre-temps : refus AVANT toute écriture', [r3, db2.journal.length], ['refusé', 0]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

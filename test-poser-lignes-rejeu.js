// node test-poser-lignes-rejeu.js — L'OUTIL qui pose, LIGNE PAR LIGNE et en ajout pur, ce que joindre() désigne déjà (témoin du nom compris) pour des produits confirmés par deux sources.
// FAUSSE BASE en mémoire : aucun réseau, aucune vraie base. TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de l'outil (le rouge se voit en cassant le code).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { executer, trierLignes } = require(path.join(DIR, 'poser-lignes-rejeu.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

function fakeDb(init) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const stats = { perdreLigne: false };
    const valeurs = (o, p) => p.split('.').reduce((xs, k) => xs.flatMap(x => (Array.isArray(x) ? x.map(y => y?.[k]) : [x?.[k]])), [o]).flat();
    const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => { const xs = valeurs(d, k); if (v && typeof v === 'object' && v.$in) return xs.some(y => v.$in.includes(y)); return xs.some(y => y === v); });
    const appliquer = (d, u, cree) => {
        if (u.$setOnInsert && cree) for (const [k, v] of Object.entries(u.$setOnInsert)) set(d, k, structuredClone(v));
        for (const [k, v] of Object.entries(u.$addToSet || {})) { const t = get(d, k) || []; for (const x of (v.$each || [v])) if (!t.some(y => JSON.stringify(y) === JSON.stringify(x))) t.push(x); set(d, k, t); }
    };
    const col = nom => { const m = cols.get(nom) || cols.set(nom, new Map()).get(nom); return {
        find: f => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f || {})).map(d => structuredClone(d)) }),
        countDocuments: async () => m.size,
        async bulkWrite(ops) {
            if (nom === 'cartes_produits' && stats.perdreLigne) ops = ops.slice(0, -1);
            for (const { updateOne: { filter, update, upsert } } of ops) { let d = m.get(filter._id), cree = false; if (!d) { if (!upsert) continue; d = { _id: filter._id }; m.set(d._id, d); cree = true; } appliquer(d, update, cree); }
            return { upsertedCount: 0 };
        } }; };
    return { collection: col, stats, brut: nom => [...(cols.get(nom) || new Map()).values()].map(d => structuredClone(d)) };
}

const SET = { _id: 'SetA', idExpansion: [10], tirage: 'jp', region: 'jp', bulba: { expansion: 'Exp A' } };
const imp = numero => ({ tirage: 'jp', expansion: 'Exp A', numero });
const CARTES = [
    { _id: 1, nomEn: 'Pika', sets: ['SetA'], impressions: [imp('5')], attaques: [], liens: { idProduct: [900], idMetacards: [] } },
    { _id: 2, nomEn: 'Raichu', sets: ['SetA'], impressions: [imp('6')], attaques: [], liens: { idProduct: [], idMetacards: [] } },
    { _id: 3, nomEn: 'Meowth', sets: ['SetA'], impressions: [imp('8')], attaques: [], liens: { idProduct: [104], idMetacards: [] } },
    { _id: 4, nomEn: 'Mew', sets: ['SetA'], impressions: [imp('9')], attaques: [], liens: { idProduct: [], idMetacards: [] } },
    { _id: 5, nomEn: 'Mew', sets: ['SetA'], impressions: [imp('9')], attaques: [], liens: { idProduct: [], idMetacards: [] } }];
const prod = (idProduct, nom, numero) => ({ idProduct, idExpansion: 10, idMetacard: 500 + idProduct, name: nom, nom, attaques: [], numero, slug: null, slugSet: 'SetA', variante: null });
const PRODUITS = [prod(101, 'Pika', '005'), prod(102, 'Raichu', '006'), prod(103, 'Inconnu', '007'), prod(104, 'Meowth', '008'), prod(105, 'Mew', '009')];
const TABLE = [{ code: 'A', exp: 10, slugSet: 'SetA', verifie: true, bulba: { tirage: 'jp', expansion: 'Exp A' } }];
const monde = ({ lignes = [{ _id: '3|104', carteId: 3, idProduct: 104, preuve: 'set+numero' }], restes = [] } = {}) => ({ db: fakeDb({ sets: [SET], cartes: CARTES, cartes_produits: lignes, collecte_etat: [], restes }) });
let fichiers = {};
async function lancer(w, argv, { seulement } = {}) {
    const sorties = [], erreurs = []; let ouvertures = 0;
    const lireFichier = f => { if (!(f in fichiers)) throw new Error('ENOENT ' + f); return fichiers[f]; };
    if (seulement !== undefined) fichiers['s.json'] = JSON.stringify(seulement);
    const code = await executer({ argv, table: TABLE, lireFichier, ouvrir: async () => { ouvertures++; return { db: w.db, fermer: async () => { } }; }, produitsDe: async () => PRODUITS, lireTexte: async () => { throw new Error('pas d\'archive'); }, log: s => sorties.push(s), err: s => erreurs.push(s) })
        .catch(e => { erreurs.push(`EXCEPTION ${process.env.PILE ? e.stack : e.message}`); return 99; });
    if (code === 99) console.log(`   EXCEPTION de l'outil : ${erreurs.join(' | ')}`);
    return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n'), ouvertures };
}
const instantane = w => JSON.stringify([w.db.brut('cartes'), w.db.brut('cartes_produits')]);
const posees = w => w.db.brut('cartes_produits').filter(l => l.preuve === 'set+numero' && l._id !== '3|104');
const BASE = ['--codes=A'];

(async () => {
    // ── la partie pure : ce que l'outil retient parmi les lignes de joindre()
    const L = (carteId, idProduct, o = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, preuve: 'set+numero', numeroFiche: '5', ...o });
    const T = trierLignes({ lignes: [L(1, 101), L(1, 101), L(2, 102), L(3, 104), L(4, 105), L(5, 105), L(6, 106, { preuve: 'setlist+numero' }), L(7, 107, { preuve: 'set+nom' }), L(8, 108, { numeroFiche: null }), L(9, 109)], dejaJoints: new Set([104]), concorde: l => l.idProduct !== 109 });
    verifier('trierLignes : une ligne vue deux fois (deux lignes de table de la même expansion) n\'est retenue qu\'UNE fois', T.retenues.filter(l => l._id === '1|101').length, 1);
    verifier('trierLignes : retient les lignes « set+numero » à numéro de fiche, de produits SANS ligne, joints à UNE carte', T.retenues.map(l => l._id), ['1|101', '2|102']);
    verifier('trierLignes : chaque refus est nommé (déjà une ligne, plusieurs cartes, preuve, sans numéro de fiche)', T.refus.map(r => [r.idProduct, r.motif.split(' ')[0]]).sort((a, b) => a[0] - b[0]),
        [[104, 'a'], [105, 'produit'], [106, 'preuve'], [107, 'preuve'], [108, 'sans'], [109, 'nom']]);

    // ── mesure seule : le plan, rien d'écrit
    let w = monde(); let avant = instantane(w);
    let r = await lancer(w, BASE);
    verifier('mesure seule : exit 0, le plan dit 2 lignes sûres (Pika, Raichu) ; Mew (deux cartes) et Inconnu ne sont pas des lignes ; rien d\'écrit', [r.code, /2 lignes/.test(r.sorties), instantane(w) === avant], [0, true, true]);

    // ── refus avant toute écriture
    r = await lancer(w, [...BASE, '--ecrire', '--attendu=A:1']);
    verifier('--ecrire sans --seulement → exit 2 (on n\'écrit que ce qu\'une liste confirmée autorise), la base n\'est pas ouverte', [r.code, r.ouvertures, instantane(w) === avant], [2, 0, true]);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json'], { seulement: [101] });
    verifier('--ecrire sans --attendu → exit 2', [r.code, instantane(w) === avant], [2, true]);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:2'], { seulement: [101] });
    verifier('--attendu faux (2 pour 1 retenue) → exit 1, rien d\'écrit', [r.code, /attendu 2/.test(r.erreurs), instantane(w) === avant], [1, true, true]);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [101, 999] });
    verifier('--seulement avec un idProduct que aucun plan ne propose (999) → exit 1, rien d\'écrit', [r.code, /999/.test(r.erreurs), instantane(w) === avant], [1, true, true]);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [] });
    verifier('--seulement=[] → exit 2', [r.code, instantane(w) === avant], [2, true]);
    r = await lancer(w, [...BASE, '--force']);
    verifier('argument inconnu → exit 2', [r.code, /argument inconnu/.test(r.erreurs)], [2, true]);
    r = await lancer(w, ['--codes=ZZZ']);
    verifier('un code absent de la table → exit 1', [r.code, /ZZZ/.test(r.erreurs)], [1, true]);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [105] });
    verifier('un produit confirmé mais joint à DEUX cartes (Mew) ne s\'écrit pas : hors plan → exit 1, rien d\'écrit', [r.code, instantane(w) === avant], [1, true]);

    // ── l'écriture : une ligne, additive
    w = monde(); const ancien = JSON.stringify(w.db.brut('cartes_produits'));
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [101] });
    const l = posees(w)[0], carte = w.db.brut('cartes').find(c => c._id === 1);
    verifier('écriture : exit 0, relue ; UNE ligne (1|101, set+numero, numeroFiche 5, set SetA) ; Raichu (non confirmé) n\'est PAS écrit', [r.code, /écrit et relu/.test(r.sorties), posees(w).length, l?._id, l?.numeroFiche, l?.slugSet, w.db.brut('cartes_produits').some(x => x.idProduct === 102)], [0, true, 1, '1|101', '5', 'SetA', false]);
    verifier('   la carte reçoit le produit EN FIN de liens.idProduct (le repère d\'adresse 900 ne bouge pas) et garde son set', [carte?.liens?.idProduct, carte?.sets, carte?.nomEn], [[900, 101], ['SetA'], 'Pika']);
    verifier('   la carte reçoit la MÉTACARTE du produit dans liens.idMetacards (comme ecrire-jointure.js:42 et poser-par-metacarte.js:70 ; relecture D1)', carte?.liens?.idMetacards, [601]);
    verifier('   additive : les lignes d\'avant sont inchangées', JSON.stringify(w.db.brut('cartes_produits').filter(x => x._id === '3|104')) === ancien, true);
    const apres = instantane(w);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [101] });
    verifier('relance sur un lot déjà écrit : le produit a une ligne → plan vide, --attendu=1 faux → exit 1, RIEN ne bouge (idempotent)', [r.code, instantane(w) === apres], [1, true]);

    // ── une ligne détachée par décision ne se repose pas
    w = monde({ restes: [{ _id: 'r1', type: 'fiche-contredite-par-la-vue', carteId: 1, idProduct: 101 }] }); avant = instantane(w);
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [101] });
    verifier('une ligne DÉTACHÉE (reste « fiche-contredite-par-la-vue ») n\'est pas reposée : 101 n\'est plus au plan → exit 1, rien d\'écrit', [r.code, instantane(w) === avant], [1, true]);

    // ── matière spéciale
    // (la table fermée est testée par ses propres bancs ; ici, l'outil l'appelle avant d'écrire : voir garderMatiereSpeciale dans l'outil)

    // ── relecture : une écriture qui perd une ligne sans erreur
    w = monde(); w.db.stats.perdreLigne = true;
    r = await lancer(w, [...BASE, '--ecrire', '--seulement=s.json', '--attendu=A:1'], { seulement: [101] });
    verifier('une ligne perdue SANS erreur → exit 1 et le dit (la relecture compte ce qui est en base)', [r.code, /relecture ne retrouve pas/.test(r.erreurs)], [1, true]);

    // ── --plan
    w = monde(); const fs = require('fs'), os = require('os');
    const f = path.join(os.tmpdir(), `plan-rejeu-${process.pid}.json`);
    r = await lancer(w, [...BASE, `--plan=${f}`]);
    const P = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f);
    verifier('--plan : les lignes (preuve, numeroFiche, code) et les sets de cartes que ce lancement poserait ; rien d\'écrit', [P.outil, P.lignes.map(x => [x._id, x.preuve, x.numeroFiche, x.code]), P.cartesSets, posees(w).length], ['poser-lignes-rejeu', [['1|101', 'set+numero', '5', 'A'], ['2|102', 'set+numero', '6', 'A']], [{ carteId: 1, set: 'SetA' }, { carteId: 2, set: 'SetA' }], 0]);

    verifier('--plan : la métacarte que chaque carte recevrait (liens.idMetacards) y est aussi, pour que l\'essai à blanc la montre', P.metacartes, [{ carteId: 1, idProduct: 101, idMetacard: 601 }, { carteId: 2, idProduct: 102, idMetacard: 602 }]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });

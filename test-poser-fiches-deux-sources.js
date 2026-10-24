// node test-poser-fiches-deux-sources.js — L'OUTIL D'ÉCRITURE des fiches simples confirmées par deux sources, sur une FAUSSE BASE en mémoire. Aucun réseau, aucune vraie base.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de l'outil (le rouge se voit en cassant le code).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { executer } = require(path.join(DIR, 'poser-fiches-deux-sources.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la fausse base : find (égalité, $in, appartenance à un tableau, $exists), updateOne (upsert, $setOnInsert, $addToSet), bulkWrite ──
function fakeDb(init) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const stats = { upserts: 0, perdreLigne: false };
    const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => {
        const x = get(d, k);
        if (v && typeof v === 'object' && v.$in) return v.$in.includes(x) || (Array.isArray(x) && x.some(y => v.$in.includes(y)));
        if (v && typeof v === 'object' && '$exists' in v) return (x !== undefined) === v.$exists;
        return Array.isArray(x) ? x.includes(v) : x === v;
    });
    const appliquer = (d, u, cree) => {
        if (u.$setOnInsert && cree) for (const [k, v] of Object.entries(u.$setOnInsert)) set(d, k, structuredClone(v));
        for (const [k, v] of Object.entries(u.$addToSet || {})) { const t = get(d, k) || []; for (const x of (v.$each || [v])) if (!t.some(y => JSON.stringify(y) === JSON.stringify(x))) t.push(x); set(d, k, t); }
    };
    const col = nom => { const m = cols.get(nom) || cols.set(nom, new Map()).get(nom); return {
        find: f => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f || {})).map(d => structuredClone(d)) }),
        async updateOne(f, u, o = {}) { let d = [...m.values()].find(x => correspond(x, f)), cree = false; if (!d) { if (!o.upsert) return { matchedCount: 0, upsertedCount: 0 }; d = { _id: f._id }; m.set(d._id, d); cree = true; stats.upserts++; } appliquer(d, u, cree); return { matchedCount: 1, upsertedCount: cree ? 1 : 0 }; },
        async bulkWrite(ops) {
            if (nom === 'cartes_produits' && stats.perdreLigne) ops = ops.slice(0, -1);
            for (const { updateOne: { filter, update, upsert } } of ops) { let d = m.get(filter._id), cree = false; if (!d) { if (!upsert) continue; d = { _id: filter._id }; m.set(d._id, d); cree = true; stats.upserts++; } appliquer(d, update, cree); }
            return { upsertedCount: 0 };
        } }; };
    return { collection: col, stats, brut: nom => [...(cols.get(nom) || new Map()).values()].map(d => structuredClone(d)) };
}

// ── le monde : le set SetX (expansion 7, zh-hans), une vraie carte « Mon1 », des produits ──
const SET = { _id: 'SetX', idExpansion: [7], tirage: 'zh-hans', region: 'intl', bulba: { expansion: 'X Promo' } };
const CARTES = [{ _id: 1001, nomEn: 'Mon1', sets: ['SetX'], impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '5' }] }];
const CATALOGUE = new Map([[901, { name: 'Alpha [Coup A | Coup B]', idMetacard: 71 }], [902, { name: 'Beta', idMetacard: 72 }], [903, { name: 'Mon1 [X]', idMetacard: 73 }], [904, { name: 'Gamma', idMetacard: 74 }],
    [905, { name: 'Delta', idMetacard: 75 }], [906, { name: 'Alpha [Coup A | Coup B]', idMetacard: 71 }]]);
const p = (idProduct, nom, numero, extra = {}) => ({ [idProduct]: { exp: 7, set: 'SetX', numero, nom, neuf: true, ok: true, concordantes: [{ source: 'pikaqian', ref: `pikaqian/csv/${idProduct}`, set: 'SetX', numero, nom, par: 'nom' }], refusees: [], sources: ['cardmarket', 'pikaqian'], raison: null, ...extra } });
const LISTE = () => Object.assign({}, p(901, 'Alpha', '010'), p(902, 'Beta', '011', { ok: false, concordantes: [], sources: ['cardmarket'], raison: 'aucune seconde source ne porte ce produit' }), p(903, 'Mon1', '012'), p(904, 'Gamma', '013'), p(905, 'Delta', '014', { exp: 8 }));
function monde({ lignesExistantes = [{ _id: '1001|904', carteId: 1001, idProduct: 904, preuve: 'set+numero' }], sets = [SET] } = {}) {
    return { db: fakeDb({ sets, cartes: CARTES, cartes_produits: lignesExistantes }), liste: LISTE() };
}
async function lancer(w, argv, { liste = w.liste, catalogue = async ids => new Map(ids.filter(i => CATALOGUE.has(i)).map(i => [i, CATALOGUE.get(i)])) } = {}) {
    const sorties = [], erreurs = []; let ouvertures = 0;
    const code = await executer({ argv, lireListe: () => liste, ouvrir: async () => { ouvertures++; return { db: w.db, fermer: async () => { } }; }, catalogue, log: s => sorties.push(s), err: s => erreurs.push(s) }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
    return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n'), ouvertures };
}
const instantane = w => JSON.stringify([w.db.brut('cartes'), w.db.brut('cartes_produits'), w.db.brut('sets')]);
const posees = w => w.db.brut('cartes_produits').filter(l => l.preuve === 'fiche-simple');
const BASE = ['--liste=l.json', '--exp=7'];

(async () => {
    // ── simulation ──
    let w = monde(); let avant = instantane(w);
    let r = await lancer(w, BASE);
    verifier('simulation : exit 0, 1 ligne planifiée (Alpha) ; Beta (non confirmé), Mon1 (vraie carte du même nom), Gamma (déjà une ligne) REFUSÉS et nommés ; Delta (autre expansion) ignoré ; rien d\'écrit',
        [r.code, /1 lignes sur 1 fiches simples · refusés 3/.test(r.sorties), /non confirmé par deux sources/.test(r.sorties), /une vraie carte de ce nom est déjà dans le set/.test(r.sorties), /a déjà une ligne/.test(r.sorties), instantane(w) === avant], [0, true, true, true, true, true]);
    verifier('   le dénominateur est imprimé (produits de la liste, de l\'expansion, confirmés)', /DÉNOMINATEUR : 5 produits dans la liste · 4 dans les expansions 7 · confirmés par deux sources 3/.test(r.sorties), true);
    verifier('   la fiche annonce ses DEUX sources', /sources : cardmarket \+ pikaqian/.test(r.sorties), true);

    // ── écriture ──
    w = monde(); const ancien = JSON.stringify(w.db.brut('cartes_produits'));
    r = await lancer(w, [...BASE, '--attendu=1', '--ecrire']);
    const carte = w.db.brut('cartes').find(c => c._id === -901);
    verifier('écriture : exit 0, relue ; la carte −901 porte son nom, son set, son impression (n° Cardmarket, source cardmarket), ses liens, et la marque de source avec les DEUX sources',
        [r.code, /écrit et relu/.test(r.sorties), carte?.nomEn, carte?.sets, carte?.impressions?.[0]?.numero, carte?.impressions?.[0]?.expansion, carte?.liens?.idProduct, /Cardmarket.*pikaqian pikaqian\/csv\/901/.test(carte?.ficheSimple?.source || ''), /Bulbapedia/.test(carte?.ficheSimple?.source || '')],
        [0, true, 'Alpha', ['SetX'], '010', 'X Promo', [901], true, true]);
    const l = posees(w)[0];
    verifier('   la ligne : preuve « fiche-simple », numeroFiche = n° Cardmarket, set et expansion, route ; additive (les lignes d\'avant sont inchangées, une seule de plus)',
        [posees(w).length, l?._id, l?.numeroFiche, l?.slugSet, l?.idExpansion, l?.route, JSON.stringify(w.db.brut('cartes_produits').filter(x => x.preuve !== 'fiche-simple')) === ancien], [1, '-901|901', '010', 'SetX', 7, 'deux-sources:7', true]);
    verifier('   AUCUNE vraie carte touchée, aucune image, aucun produit refusé écrit', [JSON.stringify(w.db.brut('cartes').find(c => c._id === 1001)) === JSON.stringify(CARTES[0]), carte?.images, posees(w).some(x => [902, 903, 904, 905].includes(x.idProduct))], [true, undefined, false]);
    const apres = instantane(w);
    r = await lancer(w, [...BASE, '--attendu=1', '--ecrire']);
    verifier('relance sur un lot déjà écrit : idempotente (rien ne bouge) — la reprise retrouve la fiche', [r.code, instantane(w) === apres], [0, true]);

    // ── refus avant toute écriture ──
    w = monde(); avant = instantane(w);
    r = await lancer(w, [...BASE, '--attendu=2', '--ecrire']);
    verifier('refus : --attendu faux → exit 1, rien d\'écrit', [r.code, /rend 1 lignes, attendu 2/.test(r.erreurs), instantane(w) === avant], [1, true, true]);
    r = await lancer(w, [...BASE, '--ecrire']);
    verifier('refus : --ecrire sans --attendu → exit 2', [r.code, instantane(w) === avant], [2, true]);
    r = await lancer(w, ['--liste=l.json', '--ecrire', '--attendu=1']);
    verifier('refus : sans --exp → exit 2, la base n\'est pas ouverte', [r.code, r.ouvertures], [2, 0]);
    r = await lancer(w, [...BASE, '--force']);
    verifier('refus : un argument inconnu → exit 2', [r.code, /argument inconnu/.test(r.erreurs)], [2, true]);
    r = await lancer(w, BASE, { liste: { 901: { ok: true } } });
    verifier('refus : une liste qui n\'a pas la forme du scanner → exit 2', [r.code, /n'a pas la forme/.test(r.erreurs), r.ouvertures], [2, true, 0]);
    r = await lancer(monde({ sets: [] }), BASE);
    verifier('un set absent de la base : le produit est REFUSÉ et nommé (jamais une fiche dans un set inventé)', [r.code, /n'existe pas dans la base/.test(r.sorties), /0 lignes sur 0 fiches simples/.test(r.sorties)], [0, true, true]);
    r = await lancer(monde({ sets: [{ ...SET, idExpansion: [9] }] }), BASE);
    verifier('un set qui ne porte pas l\'expansion du produit : REFUSÉ', [/ne porte pas l'expansion 7/.test(r.sorties)], [true]);
    r = await lancer(monde({ sets: [{ ...SET, bulba: {} }] }), BASE);
    verifier('un set sans nom d\'expansion (la fiche n\'aurait pas d\'impression lisible) : REFUSÉ', [/pas de bulba\.expansion/.test(r.sorties)], [true]);

    // ── --neufs : seulement les produits neufs de la liste ──
    w = monde(); avant = instantane(w);
    const avecAncien = Object.assign(LISTE(), p(907, 'Eps', '015', { neuf: false }));
    CATALOGUE.set(907, { name: 'Eps', idMetacard: 77 });
    r = await lancer(w, BASE, { liste: avecAncien });
    verifier('sans --neufs : un produit ancien confirmé (907) est dans le plan (2 lignes)', [/2 lignes sur 2 fiches simples/.test(r.sorties)], [true]);
    r = await lancer(w, [...BASE, '--neufs'], { liste: avecAncien });
    verifier('avec --neufs : le produit ancien n\'est PAS dans le plan (1 ligne), le dénominateur le compte (5 dans l\'expansion → 4 neufs)', [/1 lignes sur 1 fiches simples/.test(r.sorties), /4 dans les expansions 7/.test(r.sorties), instantane(w) === avant], [true, true, true]);

    // ── 🔴 matière spéciale : la table fermée arrête le lot entier ──
    w = monde(); avant = instantane(w);
    r = await lancer(w, BASE, { liste: Object.assign(LISTE(), p(720951, 'Mew ex', '205')) });
    verifier('matière spéciale (Mew ex 720951, table fermée) : exit 1, rien d\'écrit, le motif est dit', [r.code, /720951/.test(r.erreurs), instantane(w) === avant], [1, true, true]);

    // ── regroupement : deux produits du même (nom, numéro) font UNE fiche, au plus petit idProduct ──
    w = monde();
    r = await lancer(w, [...BASE, '--attendu=2', '--ecrire'], { liste: Object.assign(LISTE(), p(906, 'Alpha', '010')) });
    verifier('deux produits au même (nom, n°) : UNE fiche simple (−901), deux lignes, une carte', [r.code, w.db.brut('cartes').filter(c => c._id < 0).map(c => c._id), posees(w).map(x => x.idProduct).sort(), w.db.brut('cartes').find(c => c._id === -901)?.liens?.idProduct], [0, [-901], [901, 906], [901, 906]]);

    // ── relecture : une écriture qui perd une ligne sans erreur ──
    w = monde(); w.db.stats.perdreLigne = true;
    r = await lancer(w, [...BASE, '--attendu=1', '--ecrire']);
    verifier('relecture : une ligne perdue SANS erreur → exit 1 et le dit', [r.code, /relecture ne retrouve pas/.test(r.erreurs), /lignes 0\/1/.test(r.sorties)], [1, true, true]);

    // ── --plan : le fichier que lit la simulation de l'API ──
    w = monde(); const fs = require('fs'), os = require('os');
    const f = path.join(os.tmpdir(), `plan-deux-sources-${process.pid}.json`);
    r = await lancer(w, [...BASE, `--plan=${f}`]);
    const P = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f);
    verifier('--plan : la carte à créer, la ligne (preuve fiche-simple, numeroFiche) et les refus nommés ; rien d\'écrit', [P.cartes.map(c => c._id), P.lignes.map(x => [x._id, x.preuve, x.numeroFiche]), P.refus.length, posees(w).length], [[-901], [['-901|901', 'fiche-simple', '010']], 3, 0]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });

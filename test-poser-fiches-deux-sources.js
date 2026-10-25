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
    // un chemin pointé qui traverse un tableau de sous-documents (« impressions.expansion ») donne toutes les valeurs, comme Mongo
    const valeurs = (o, p) => p.split('.').reduce((xs, k) => xs.flatMap(x => (Array.isArray(x) ? x.map(y => y?.[k]) : [x?.[k]])), [o]).flat();
    const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => {
        const xs = valeurs(d, k);
        if (v && typeof v === 'object' && v.$in) return xs.some(y => v.$in.includes(y));
        if (v && typeof v === 'object' && '$exists' in v) return xs.some(y => y !== undefined) === v.$exists;
        return xs.some(y => y === v);
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
const CATALOGUE = new Map([[901, { name: 'Alpha [Coup A | Coup B]', idMetacard: 71 }], [902, { name: 'Beta', idMetacard: 72 }], [903, { name: 'Mon1 [Coup Z]', idMetacard: 73 }], [904, { name: 'Gamma', idMetacard: 74 }],
    [905, { name: 'Delta', idMetacard: 75 }], [906, { name: 'Alpha [Coup A | Coup B]', idMetacard: 71 }]]);
const p = (idProduct, nom, numero, extra = {}) => ({ [idProduct]: { exp: 7, set: 'SetX', numero, nom, neuf: true, ok: true, concordantes: [{ source: 'pikaqian', ref: `pikaqian/csv/${idProduct}`, set: 'SetX', numero, nom, par: 'nom' }], refusees: [], sources: ['cardmarket', 'pikaqian'], raison: null, ...extra } });
const LISTE = () => Object.assign({}, p(901, 'Alpha', '010'), p(902, 'Beta', '011', { ok: false, concordantes: [], sources: ['cardmarket'], raison: 'aucune seconde source ne porte ce produit' }), p(903, 'Mon1', '012'), p(904, 'Gamma', '013'), p(905, 'Delta', '014', { exp: 8 }));
function monde({ lignesExistantes = [{ _id: '1001|904', carteId: 1001, idProduct: 904, preuve: 'set+numero' }], sets = [SET], cartes = CARTES } = {}) {
    return { db: fakeDb({ sets, cartes, cartes_produits: lignesExistantes }), liste: LISTE() };
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

    // ── D3 (2026-10-24) : l'outil REJOUE la confirmation, il ne se fie pas au `ok` du fichier ──
    const lancerD3 = async (modif, motif, titre) => {
        const w3 = monde(), av = instantane(w3);
        const liste = LISTE(); modif(liste[901]);
        const r3 = await lancer(w3, [...BASE, '--neufs'], { liste });
        verifier(`D3 : ${titre} → 901 REFUSÉ (« ${motif} »), rien de posé, rien d'écrit`, [r3.code, new RegExp(motif).test(r3.sorties), /0 lignes sur 0 fiches simples/.test(r3.sorties), instantane(w3) === av], [0, true, true, true]);
    };
    await lancerD3(e => { e.concordantes = []; }, 'confirmation non rejouée : aucune concordante', 'ok:true mais AUCUNE concordante');
    await lancerD3(e => { e.concordantes[0].source = 'bulbapedia'; }, 'exclue \\(Bulbapedia\\)', 'une concordante « bulbapedia »');
    await lancerD3(e => { e.concordantes[0].source = 'setlist'; }, 'exclue \\(Bulbapedia\\)', 'une concordante « setlist »');
    await lancerD3(e => { e.concordantes[0].source = 'source-inventee'; }, 'hors de la liste admise', 'une source inconnue');
    await lancerD3(e => { e.concordantes[0].set = 'Autre-Set'; }, 'set différent', 'un set discordant');
    await lancerD3(e => { e.concordantes[0].numero = '99'; }, 'numéro différent', 'un numéro discordant');
    await lancerD3(e => { e.concordantes[0].nom = 'Tout Autre'; }, 'nom discordant', 'un nom discordant');
    await lancerD3(e => { e.nom = 'Zzz'; }, 'n\'est pas celui du catalogue', 'un nom de liste qui n\'est pas celui du catalogue');
    {
        const w3 = monde(); const liste = LISTE(); liste[901].concordantes.push({ ...liste[901].concordantes[0], source: 'bulbapedia' });
        const r3 = await lancer(w3, [...BASE, '--attendu=0'], { liste });
        verifier('D3 : une seule concordante fautive à côté d\'une saine refuse le produit', [/exclue \(Bulbapedia\)/.test(r3.sorties), posees(w3).length], [true, 0]);
    }

    // ── 🔴 matière spéciale : la table fermée arrête le lot entier ──
    w = monde(); avant = instantane(w);
    r = await lancer(w, BASE, { liste: Object.assign(LISTE(), p(720951, 'Mew ex', '205')) });
    verifier('matière spéciale (Mew ex 720951, table fermée) : exit 1, rien d\'écrit, le motif est dit', [r.code, /720951/.test(r.erreurs), instantane(w) === avant], [1, true, true]);

    // ── 🔴 (PHASE 3a-SUITE, simulation des lots F) le MÊME nom sous deux écritures : « Zeta Energy » chez Cardmarket est « Basic Zeta Energy » chez Bulbapedia — c'est la vraie carte du set.
    // L'égalité de la forme normalisée ne le voyait pas : 12 énergies de BW-Promos auraient reçu une fiche simple en DOUBLON de la vraie carte. La clé est celle de la jointure (jointure.js::clesNom).
    {
        const cartesE = [...CARTES, { _id: 1002, nomEn: 'Basic Zeta Energy', sets: ['SetX'], impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '1' }] }];
        CATALOGUE.set(908, { name: 'Zeta Energy', idMetacard: 78 });
        const wE = monde({ cartes: cartesE }); const avE = instantane(wE);
        const rE = await lancer(wE, BASE, { liste: Object.assign(LISTE(), p(908, 'Zeta Energy', '016')) });
        verifier('énergie : « Zeta Energy » est la vraie carte « Basic Zeta Energy » du set → REFUSÉE (doublon), le plan garde Alpha seul, rien d\'écrit', [rE.code, /1 lignes sur 1 fiches simples · refusés 4/.test(rE.sorties), instantane(wE) === avE], [0, true, true]);
        const rE2 = await lancer(monde(), BASE, { liste: Object.assign(LISTE(), p(908, 'Zeta Energy', '016')) });
        verifier('   sans la vraie carte dans le set, « Zeta Energy » reçoit sa fiche simple (le refus vient bien de la vraie carte)', [/2 lignes sur 2 fiches simples/.test(rE2.sorties)], [true]);
    }

    // ── 🔴 (PHASE 3a-SUITE, simulation des lots F) une vraie carte qui DÉCLARE l'impression du set sans être (encore) dans `cartes.sets` : les sets « sans page » (smG : 23 produits, plus 6 autres
    // dans le lot F1) ne rattachent leurs cartes au set qu'APRÈS la jointure. « cartes.sets ∋ slug » ne les voyait pas : 29 fiches simples auraient doublé leur vraie carte.
    {
        const declarante = { _id: 1003, nomEn: 'Eta', sets: [], impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '9' }] };
        CATALOGUE.set(909, { name: 'Eta', idMetacard: 79 });
        const wD = monde({ cartes: [...CARTES, declarante] }); const avD = instantane(wD);
        const rD = await lancer(wD, BASE, { liste: Object.assign(LISTE(), p(909, 'Eta', '009')) });
        verifier('déclarante : « Eta » est déclarée par une vraie carte (tirage + expansion du set) bien qu\'elle ne soit pas dans cartes.sets → REFUSÉE (doublon), nommée, rien d\'écrit',
            [rD.code, /1 lignes sur 1 fiches simples · refusés 4/.test(rD.sorties), /déclare déjà l'impression de ce set/.test(rD.sorties), instantane(wD) === avD], [0, true, true, true]);
        // le NUMÉRO départage : un set de promos réimprime le même nom à plusieurs numéros (Pikachu n°1, n°77…) ; la fiche simple d'une AUTRE impression n'est pas un doublon. « 009/009 » est le numéro 9.
        const autreNumero = { ...declarante, impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '77' }] };
        const rN = await lancer(monde({ cartes: [...CARTES, autreNumero] }), BASE, { liste: Object.assign(LISTE(), p(909, 'Eta', '009')) });
        verifier('   déclarée sous un AUTRE numéro (77 contre 009) : une autre impression du même nom, pas un doublon → la fiche simple est posée au plan', [/2 lignes sur 2 fiches simples/.test(rN.sorties)], [true]);
        const formeSlash = { ...declarante, impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '009/009' }] };
        const rS = await lancer(monde({ cartes: [...CARTES, formeSlash] }), BASE, { liste: Object.assign(LISTE(), p(909, 'Eta', '009')) });
        verifier('   « 009/009 » est le numéro 009 → doublon, REFUSÉE', [/1 lignes sur 1 fiches simples · refusés 4/.test(rS.sorties)], [true]);
        const sansNumero = { ...declarante, impressions: [{ tirage: 'zh-hans', expansion: 'X Promo' }] };
        const rZ = await lancer(monde({ cartes: [...CARTES, sansNumero] }), BASE, { liste: Object.assign(LISTE(), p(909, 'Eta', '009')) });
        verifier('   déclarée SANS numéro : on ne peut pas dire que c\'est une autre impression → REFUSÉE', [/1 lignes sur 1 fiches simples · refusés 4/.test(rZ.sorties)], [true]);
        const autre = { ...declarante, impressions: [{ tirage: 'jp', expansion: 'X Promo', numero: '9' }] };
        const rD2 = await lancer(monde({ cartes: [...CARTES, autre] }), BASE, { liste: Object.assign(LISTE(), p(909, 'Eta', '009')) });
        verifier('   la même carte déclarée dans un AUTRE tirage (jp) ne bloque pas : elle n\'est pas la carte de ce set', [/2 lignes sur 2 fiches simples/.test(rD2.sorties)], [true]);
        const autreExp = { ...declarante, impressions: [{ tirage: 'zh-hans', expansion: 'Autre Expansion', numero: '9' }] };
        const rD3 = await lancer(monde({ cartes: [...CARTES, autreExp] }), BASE, { liste: Object.assign(LISTE(), p(909, 'Eta', '009')) });
        verifier('   déclarée dans une AUTRE expansion : ne bloque pas non plus', [/2 lignes sur 2 fiches simples/.test(rD3.sorties)], [true]);
        // 🔴 (relecture du paquet 1, D1) le MÊME NUMÉRO suffit, QUEL QUE SOIT LE NOM : Cardmarket suffixe le nom du produit du sous-titre de la carte (« Battle Compressor Team Flare Gear » n°019 contre la
        // carte 196300 « Battle Compressor », qui déclare jp / Ultra Sun & Ultra Moon Deck Build Boxes / 019/041). L'égalité des noms échoue ; l'impression déclarée au même numéro, non.
        CATALOGUE.set(910, { name: 'Eta Team Gear', idMetacard: 80 });
        const rM = await lancer(monde({ cartes: [...CARTES, { ...declarante, impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '009/041' }] }] }), BASE, { liste: Object.assign(LISTE(), p(910, 'Eta Team Gear', '009')) });
        verifier('   un AUTRE NOM au MÊME numéro (« Eta Team Gear » 009 contre la vraie « Eta » 009/041) : doublon, REFUSÉE et nommée', [/1 lignes sur 1 fiches simples · refusés 4/.test(rM.sorties), /déclare déjà l'impression de ce set au numéro 009/.test(rM.sorties)], [true, true]);
        const rM2 = await lancer(monde({ cartes: [...CARTES, { ...declarante, impressions: [{ tirage: 'zh-hans', expansion: 'X Promo', numero: '77' }] }] }), BASE, { liste: Object.assign(LISTE(), p(910, 'Eta Team Gear', '009')) });
        verifier('   le même autre nom à un AUTRE numéro (77) ne bloque pas', [/2 lignes sur 2 fiches simples/.test(rM2.sorties)], [true]);
    }

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

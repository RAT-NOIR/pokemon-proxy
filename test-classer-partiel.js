// node test-classer-partiel.js — le classement de creer-set-partiel.js SANS --completer n'a pas bougé quand COURTS2 l'a extrait dans collecte-cartes/classer-partiel.js.
// Preuve : `classerAncien` ci-dessous est la copie MOT POUR MOT du bloc de 27ff6a1b (creer-set-partiel.js l. 43-66, avant l'extraction) ; elle et la fonction
// extraite tournent sur la MÊME fausse base en mémoire (aucun réseau, aucune vraie base), et leurs sorties (C, P, produits, cartesDe, cartesParId, cat, numeros)
// doivent être IDENTIQUES — sur des cas qui couvrent chaque branche de la classification (prouvé, contredit, 12 causes de reste, déjà joint, cartes-code), pour
// la configuration « Promos » (formeCollee) ET pour la configuration « table fermée » (origines, attaques vérifiées), puis sans formeCollee.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de collecte-cartes/ (le rouge se voit en cassant une branche de classer-partiel.js).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { classerExpansion } = require(path.join(DIR, 'collecte-cartes', 'classer-partiel.js'));
const { lireMongo } = require(path.join(__dirname, 'collecte-cartes', 'lecture-sure.js'));
const { cleNumero } = require(path.join(__dirname, 'collecte-cartes', 'jointure.js'));
const SP = require(path.join(__dirname, 'collecte-cartes', 'set-partiel.js'));
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${String(a).slice(0, 300)}\n   attendu ${String(b).slice(0, 300)}`); } };

// ── L'ANCIENNE FONCTION : le bloc de 27ff6a1b, tel quel (seules l'enveloppe `async function` et la valeur rendue sont ajoutées) ──
async function classerAncien({ cx, prod, EXP, conf }) {
    const cat = await lireMongo(prod.db.collection('catalogue_produits'), { idExpansion: EXP }, { nom: `catalogue_produits (${EXP})`, projection: { idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } });
    const tousCat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { idProduct: 1, idExpansion: 1 } })).map(p => [p.idProduct, p.idExpansion]));
    const numeros = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1, codeSet: 1 } });
    const numDe = new Map(numeros.map(n => [n.idProduct, n]));
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set' });
    const expsDuCode = new Map(); for (const c of codes) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
    const parExpNum = new Map();
    for (const p of numeros) { const n = cleNumero(p.numero), e = tousCat.get(p.idProduct); if (!n || e == null) continue; const k = `${e}|${n}`; (parExpNum.get(k) || parExpNum.set(k, []).get(k)).push(p.idProduct); }
    const cartesDe = new Map();
    for (const l of await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } })) (cartesDe.get(l.idProduct) || cartesDe.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);

    const produits = cat.map(p => { const n = numDe.get(p.idProduct); return { idProduct: p.idProduct, idExpansion: p.idExpansion, idMetacard: p.idMetacard, name: p.name, appris: !!n, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null }; });
    const ctx = { expsDuCode, parExpNum, cartesDe, ...(conf.origines ? { origines: conf.origines() } : {}), ...(conf.formeCollee ? { formeCollee: true } : {}), ...(conf.verifierAttaques ? { verifierAttaques: true } : {}) };
    // 1re passe : les cartes désignées et le pool (cartes des sets d'ORIGINE) — lus en une fois
    const resolus = produits.filter(p => p.appris && !cartesDe.has(p.idProduct)).map(p => SP.resoudreProduit(p, conf.CODE, ctx)).filter(x => x.cause === 'resolu');
    const PROJ = { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, sets: 1, 'bulba.titre': 1 };
    const cartesParId = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(resolus.map(x => x.carteId))] } }, { projection: PROJ }).toArray()).map(c => [c._id, c]));
    const slugsOrigine = [...new Set(resolus.flatMap(x => x.cands.map(id => numDe.get(id)?.slugSet)).filter(Boolean))];
    const poolBrut = await cx.db.collection('cartes').find({ sets: { $in: slugsOrigine } }, { projection: PROJ }).toArray();
    if (resolus.length && !poolBrut.length) throw new Error(`pool des cartes d'origine VIDE pour ${slugsOrigine.length} sets d'origine : le témoin du nom se tairait sur tout — arrêt`);
    const poolDe = x => { const sl = new Set(x.cands.map(id => numDe.get(id)?.slugSet).filter(Boolean)); return poolBrut.filter(c => (c.sets || []).some(s => sl.has(s))); };
    const C = SP.classerProduits({ produits, CODE: conf.CODE, ctx, cartesParId, poolDe });
    const P = SP.partielDe(C, conf.chemin ? { chemin: conf.chemin } : undefined);
    return { cat, numeros, produits, cartesDe, cartesParId, C, P };
}

// ── la fausse base : find / findOne / countDocuments, filtres d'égalité et $in (sur un scalaire ou sur un tableau) ──
function fausseBase(init) {
    const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const correspond = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        if (v && typeof v === 'object' && Array.isArray(v.$in)) return Array.isArray(d[k]) ? d[k].some(x => v.$in.includes(x)) : v.$in.includes(d[k]);
        return egal(d[k], v);
    });
    const col = nom => { const docs = init[nom]; return {
        collectionName: nom,
        find: (f) => ({ toArray: async () => docs.filter(d => correspond(d, f)).map(d => structuredClone(d)) }),
        findOne: async (f) => structuredClone(docs.find(d => correspond(d, f || {})) ?? null),
        countDocuments: async (f) => docs.filter(d => correspond(d, f || {})).length
    }; };
    return { db: { collection: col } };
}
const imp = (numero, tirage = 'intl') => ({ tirage, expansion: 'Brilliant Stars', numero });
const PROMOS = 2107, PWC = 4392;
function monde() {
    const cartes = [
        { _id: 1, nomEn: 'Ultra Ball', sets: ['Brilliant-Stars'], impressions: [imp('150/172')], attaques: [{ nom: 'Scratch' }], bulba: { titre: 'T1' } },
        { _id: 2, nomEn: 'Serena', sets: ['Brilliant-Stars'], impressions: [imp('164/172')] },
        { _id: 4, nomEn: 'Rainbow Energy', sets: ['Team-Rocket'], impressions: [{ tirage: 'intl', expansion: 'Team Rocket', numero: '17/82' }] },
        { _id: 5, nomEn: null, sets: ['Brilliant-Stars'], impressions: [imp('10')] },
        { _id: 6, nomEn: 'Zubat', sets: ['Brilliant-Stars'], impressions: [{ tirage: 'jp', expansion: 'X', numero: '11' }] },
        { _id: 7, nomEn: 'Dark Charizard', sets: ['Brilliant-Stars'], impressions: [imp('12')] },
        { _id: 8, nomEn: 'Alpha', sets: ['Ambigu'], impressions: [] }, { _id: 9, nomEn: 'Beta', sets: ['Ambigu'], impressions: [] }, { _id: 10, nomEn: 'Geeta', sets: [], impressions: [] }
    ];
    const orig = [[900, 10, '150', 'Brilliant-Stars', 1], [901, 10, '164', 'Brilliant-Stars', 2], [902, 10, '10', 'Brilliant-Stars', 5], [903, 10, '11', 'Brilliant-Stars', 6], [904, 10, '12', 'Brilliant-Stars', 7],
        [950, 20, '17', 'Team-Rocket', 4], [960, 30, '5', 'Ambigu', 8], [961, 30, '5', 'Ambigu', 9], [970, 40, '9', 'Zero-Carte', null]];
    const promo = (id, exp, slug, name, appris = true) => ({ id, exp, slug, name, appris });
    const P = [promo(5001, PROMOS, 'Ultra-Ball-V1-PRBRS-150', 'Ultra Ball'), promo(5002, PROMOS, 'Serena-PRBRS-150', 'Serena'), promo(5003, PROMOS, 'Fire-Energy-PR14', 'Fire Energy'),
        promo(5004, PROMOS, null, 'Pikachu (Top Deck)', false), promo(5005, PROMOS, 'Live-Code-Card-PR', 'Live Code Card (Worlds)'), promo(5006, PROMOS, 'X-PRZZZ-150', 'X'), promo(5007, PROMOS, 'X-PRBRS-999', 'X'),
        promo(5008, PROMOS, 'X-PRNOC-9', 'X'), promo(5009, PROMOS, 'X-PRAMB-5', 'X'), promo(5010, PROMOS, 'Rainbow-Energy-TR17', 'Rainbow Energy'), promo(5011, PROMOS, 'X-PRBRS-10', 'Rien'),
        promo(5012, PROMOS, 'Z-PRBRS-12', 'Zzz Truc'), promo(5013, PROMOS, 'Zubat-PRBRS-11', 'Zubat'), promo(5014, PROMOS, 'Geeta-V4-PROBF-188', 'Geeta'),
        promo(5101, PWC, 'Ultra-Ball-V13', 'Ultra Ball [Scratch]'), promo(5102, PWC, 'Ultra-Ball-V14', 'Ultra Ball [Scratch]'), promo(5103, PWC, 'Ultra-Ball-V15', 'Ultra Ball [Gnaw]'), promo(5104, PWC, 'Ultra-Ball-V16', 'Ultra Ball [Scratch]')];
    return {
        prod: fausseBase({
            catalogue_produits: [...orig.map(([id, exp]) => ({ idProduct: id, idExpansion: exp, idMetacard: id, name: `origine ${id}` })), ...P.map(p => ({ idProduct: p.id, idExpansion: p.exp, idMetacard: 7000 + p.id, name: p.name }))],
            numeros_cartes: [...orig.map(([id, , num, slugSet]) => ({ idProduct: id, numero: num, slug: `O-${id}`, slugSet, codeSet: 'X' })), ...P.filter(p => p.appris).map(p => ({ idProduct: p.id, numero: null, slug: p.slug, slugSet: p.exp === PWC ? 'Pikachu-World-Collection' : 'Promos', codeSet: 'PR' }))],
            codes_set: [{ codeSet: 'BRS', idExpansion: 10 }, { codeSet: 'TR', idExpansion: 20 }, { codeSet: 'AMB', idExpansion: 30 }, { codeSet: 'NOC', idExpansion: 40 }, { codeSet: 'AMB', idExpansion: 31 }]
        }),
        cx: fausseBase({
            cartes_produits: [...orig.filter(o => o[4] != null).map(([id, , , , c]) => ({ _id: `${c}|${id}`, idProduct: id, carteId: c })), { _id: '10|5014', idProduct: 5014, carteId: 10 }],
            cartes
        })
    };
}
const resume = R => JSON.stringify({ cat: R.cat, numeros: R.numeros, produits: R.produits, cartesDe: [...R.cartesDe].map(([k, v]) => [k, [...v]]), cartesParId: [...R.cartesParId], C: R.C, P: R.P });
const ORIGINES = () => new Map([[5101, { code: 'BRS', num: '150', langue: 'Spanish', ligne: 'Wizards 26', titre: 'T1', page: 'p' }], [5102, { code: 'BRS', num: '150', langue: 'Chinese', ligne: 'Wizards 27', titre: 'T1', page: 'p' }],
    [5103, { code: 'BRS', num: '150', langue: 'French', ligne: 'Wizards 28', titre: 'T1', page: 'p' }], [5104, { code: 'BRS', num: '150', langue: 'Spanish', ligne: 'Wizards 4', titre: 'T2', page: 'p' }]]);

module.exports = { classerAncien, resume };
if (require.main === module) (async () => {
    const CONFS = [
        ['Promos (formeCollee)', PROMOS, { slug: 'Promos', CODE: 'PR', route: 'pr', formeCollee: true }],
        ['Promos sans formeCollee', PROMOS, { slug: 'Promos', CODE: 'PR', route: 'pr' }],
        ['table fermee (origines, attaques verifiees, chemin)', PWC, { slug: 'Pikachu-World-Collection', CODE: 'PWC', route: 'pwc', origines: ORIGINES, verifierAttaques: true, lecture: 'par la table', chemin: 'le chemin de la table' }]
    ];
    const causes = new Set();
    for (const [nom, EXP, conf] of CONFS) {
        const m = monde(), m2 = monde();
        const ancien = await classerAncien({ cx: m.cx, prod: m.prod, EXP, conf }), nouveau = await classerExpansion({ cx: m2.cx, prod: m2.prod, EXP, conf });
        verifier(`${nom} : l'ancienne fonction et l'extraite rendent EXACTEMENT les memes sorties (C, P, produits, cartesDe, cartesParId, cat, numeros)`, resume(nouveau) === resume(ancien), true);
        for (const x of [...nouveau.C.restes, ...nouveau.C.contredits]) causes.add(x.cause);
        if (nouveau.C.prouves.length) causes.add('prouve'); if (nouveau.C.deja.length) causes.add('deja'); if (nouveau.C.horsDenominateur.length) causes.add('carte-code');
        verifier(`${nom} : le classement n'est pas vide (somme des ensembles = produits)`, nouveau.C.prouves.length + nouveau.C.contredits.length + nouveau.C.restes.length + nouveau.C.deja.length + nouveau.C.horsDenominateur.length, nouveau.cat.length);
    }
    const attendues = ['prouve', 'deja', 'carte-code', 'fiche-contredite-par-le-nom', 'produit-non-appris', 'sans-code-origine', 'code-inconnu', 'numero-absent', 'origine-sans-carte', 'origine-ambigue', 'carte-sans-nom', 'nom-non-concordant', 'origine-sans-impression-intl', 'langue-hors-tirage', 'attaques-non-concordantes', 'titre-non-concordant'];
    verifier('couverture : chaque branche de la classification est exercee par au moins un cas', attendues.filter(c => !causes.has(c)), []);
    // les sorties attendues, lues une fois (le banc ne compare pas seulement l'ancien au nouveau : il fixe les cas-cles)
    const R = await classerExpansion({ ...monde(), EXP: PROMOS, conf: CONFS[0][2] });
    verifier('Promos : 2 prouves (5001 par le slug, 5010 par la forme collee), 1 contredit (5002), total 13 (14 produits, 1 carte-code hors denominateur)', [R.C.prouves.map(x => x.idProduct).sort(), R.C.prouves.map(x => x.source).sort(), R.C.contredits.map(x => x.idProduct), R.P.total], [[5001, 5010], ['slug', 'slug-collee'], [5002], 13]);
    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });

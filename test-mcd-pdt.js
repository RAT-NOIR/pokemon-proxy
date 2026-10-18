// node test-mcd-pdt.js — MCD-PDT : les McDonald's de la source pdt (320 px) sont admis en BASSE DÉFINITION (plancher 200 px), pour quatre sets nommés et RIEN d'autre
// (collecte-cartes/seuils-images.js `SETS_PDT_A_PLANCHER` + collecteur-images-pokedata.js). Aucune requête (fetch piégé), aucune base réelle (en mémoire), aucun R2 (faux dépôt), cache TEMPORAIRE.
// Ce que le banc garde : la liste est FERMÉE et la comparaison EXACTE ; un McDonald's à 320 px est écrit `basseDefinition: true`, retirable, avec son adresse d'origine et le lot neutre existant ;
// sous 200 px on refuse toujours ; tout autre set pdt garde 350 ; une image déjà servie pour la fiche n'est jamais remplacée ; un document `trop-petit` jugé à 350 est rejugé ; l'essai à blanc n'écrit rien.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
process.env.ARRETS_HOTES_DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-arrets-hotes-'));
const sharp = require('sharp');
const S = require(path.join(DIR, 'collecte-cartes', 'seuils-images.js'));
const P = require(path.join(DIR, 'collecte-cartes', 'pokedata.js'));
const C = require(path.join(DIR, 'collecteur-images-pokedata.js'));
const { vignetterApresJointure } = require(path.join(DIR, 'collecte-cartes', 'vignettes-apres-jointure.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { if (process.env.BANC_BAVARD) return () => { }; const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) && !/^\d+$/.test(p) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : false)
        : (x => Array.isArray(x) ? x.includes(v) : x === v)(lire(d, k)));
    const appliquer = (d, u) => {
        for (const [k, v] of Object.entries(u.$set || {})) ecrireChamp(d, k, v);
        for (const k of Object.keys(u.$unset || {})) delete d[k];
        for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
        for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
    };
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const ecritures = [];
    const collection = n => ({
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            ecritures.push(n);
            let d = tous(n, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; col(n).set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    const db = { collection, async command(c) { if (c.dbStats) return { dataSize: 1000, indexSize: 100 }; throw new Error(`commande inattendue ${JSON.stringify(c)}`); } };
    const modele = n => ({
        db: { db },
        findById: id => ({ select: () => ({ lean: async () => structuredClone(col(n).get(id) ?? null) }) }),
        find: f => ({ lean: async () => structuredClone(tous(n, f)) }),
        updateOne: (f, u, o) => collection(n).updateOne(f, u, o)
    });
    return { cols, col, db, ecritures, M: { Carte: modele('cartes'), Image: modele('images'), Set: modele('sets'), EtatImages: modele('collecte_images_etat') } };
}

const MCD = ['McDonalds-Collection-2014', 'McDonalds-Collection-2015', 'McDonalds-Collection-2017', 'McDonald-s-Collection-2018-2'];
const TOT = 'Trick-or-Trade-2024';
const IMG = (dossier, n) => `https://pokemoncardimages.pokedata.io/images/${dossier}/${n}.webp`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-banc-'));

(async () => {
    // ── 1. LA RÈGLE : une liste fermée, une comparaison exacte ──
    for (const s of MCD) verifier(`seuil : pdt + « ${s} » → plancher 200`, S.largeurAdmiseDe('pdt', s), 200);
    verifier('seuil : un autre set pdt garde 350 (Trick or Trade, Black Star, sans set)', [S.largeurAdmiseDe('pdt', TOT), S.largeurAdmiseDe('pdt', 'SV-Black-Star-Promos'), S.largeurAdmiseDe('pdt'), S.largeurAdmiseDe('pdt', null)], [350, 350, 350, 350]);
    verifier('seuil : comparaison EXACTE — autre casse, autre année, préfixe ou suffixe : 350', ['mcdonalds-collection-2014', 'McDonalds-Collection-2016', 'McDonalds-Collection-2014-', ' McDonalds-Collection-2014', 'McDonalds-Collection-201', 'McDonalds'].map(s => S.largeurAdmiseDe('pdt', s)), [350, 350, 350, 350, 350, 350]);
    verifier('seuil : le plancher du set McDonald\'s ne vaut QUE pour la source pdt (tcgdex, bulbapedia, artofpkm, pokumon avec ce slug : leur règle)', ['tcgdex', 'bulbapedia', 'artofpkm', 'pokumon', 'PDT', 'pdt '].map(src => S.largeurAdmiseDe(src, MCD[0])), [350, 350, 350, 350, 350, 350]);
    verifier('seuil : la liste est fermée et ne contient que les quatre slugs lus sur les 31 documents', [S.SETS_PDT_A_PLANCHER.length, [...S.SETS_PDT_A_PLANCHER].sort()], [4, [...MCD].sort()]);
    verifier('seuil : une liste ne se modifie pas (gelée)', Object.isFrozen(S.SETS_PDT_A_PLANCHER), true);
    verifier('seuil : le nom de la source dans seuils-images est celui que le collecteur ÉCRIT', S.SOURCE_PDT, P.SOURCE);
    verifier('seuil : les décisions du 17/10 sont inchangées (pokemon.com 200, Pokumon mcd-2014 200, autre ligne Pokumon 350)', [S.largeurAdmiseDe('pokemon.com'), S.largeurAdmiseDe('pokumon', 'mcd-2014'), S.largeurAdmiseDe('pokumon', 'pp-s5')], [200, 200, 350]);
    const doc = (w, extra = {}) => ({ etat: 'trop-petit', seuilApplique: 350, wOriginal: w, ...extra });
    verifier('aRejuger : un trop-petit McDonald\'s jugé à 350, original 320 : OUI', S.aRejuger(doc(320), 'pdt', MCD[0]), true);
    verifier('aRejuger : original 190 (sous le plancher) : non, toujours trop petit', S.aRejuger(doc(190), 'pdt', MCD[0]), false);
    verifier('aRejuger : un autre set pdt : non', S.aRejuger(doc(320), 'pdt', TOT), false);
    verifier('aRejuger : déjà jugé au plancher (seuilApplique 200) : non', S.aRejuger(doc(320, { seuilApplique: 200 }), 'pdt', MCD[0]), false);
    verifier('aRejuger : largeur inconnue : oui (rien ne prouve qu\'elle est trop petite)', S.aRejuger({ etat: 'trop-petit', seuilApplique: 350 }, 'pdt', MCD[0]), true);

    // ── 2. LE COLLECTEUR, depuis un cache temporaire ──
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async (u) => { vusFetch.push(String(u)); throw new Error('réseau interdit dans le banc'); };
    const webp = (w) => sharp({ create: { width: w, height: Math.round(w * 1000 / 728), channels: 3, background: { r: 30, g: 120, b: 200 } } }).webp().toBuffer();
    const crypto = require('crypto');
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    const dc = tmp();
    const index = { version: 1, images: {} };
    const unite = (carteId, slug, dossier, numero, w, extra = {}) => ({ carteId, nomEn: `Carte ${carteId}`, slugSet: slug, numero, produits: [9000 + carteId], ligne: dossier, numeroReleve: numero, url: IMG(dossier, numero), voie: 'banc', preuve: numero, genre: 'ajout', releve: 'r.json', _w: w, ...extra });
    const U = [
        unite(11, MCD[0], 'McDonald%27s+Promos+2014', '2', 320),            // 320 px : admis en basse définition
        unite(12, MCD[1], 'McDonald%27s+Promos+2015', '3', 190),            // sous le plancher : refusé
        unite(13, TOT, 'Trick+or+Trade+2024', '4', 320),                    // autre set pdt à 320 : reste trop petit
        unite(14, MCD[2], 'McDonald%27s+Promos+2017', '5', 400),            // au-dessus de 350 : ordinaire, pas de marque
        unite(15, MCD[0], 'McDonald%27s+Promos+2014', '6', 320),            // 320 px mais la fiche est DÉJÀ servie par une autre source : la nôtre cède
        unite(16, MCD[3], 'McDonald%27s+Promos+2018', '7', 200)           // pile au plancher : admis
    ];
    for (const u of U) {
        const b = await webp(u._w); const f = `f${u.carteId}.webp`;
        fs.writeFileSync(path.join(dc, f), b);
        index.images[u.url] = { statut: 'ok', fichier: f, sha256: sha(b), octets: b.length, w: u._w, h: Math.round(u._w * 1000 / 728), le: new Date().toISOString() };
    }
    fs.writeFileSync(path.join(dc, 'index.json'), JSON.stringify(index));
    const plan = U.map(({ _w, ...u }) => u);
    const semer = B => {
        for (const s of [...MCD, TOT]) B.col('sets').set(s, { _id: s, tirage: 'intl', region: 'intl' });
        for (const u of U) {
            B.col('cartes').set(u.carteId, { _id: u.carteId, nomEn: u.nomEn, images: u.carteId === 15 ? [{ set: u.slugSet, source: 'bulbapedia', numero: u.numero, cleR2: 'bulbapedia/deja.webp', langue: 'en', w: 700 }] : [] });
            B.col('cartes_produits').set(`${u.carteId}|${u.produits[0]}`, { _id: `${u.carteId}|${u.produits[0]}`, carteId: u.carteId, idProduct: u.produits[0], numeroFiche: u.numero, slugSet: u.slugSet });
        }
        // l'état d'avant : les documents du lot du 18/10, `trop-petit` jugés à 350
        for (const u of U.filter(x => x._w >= 190 && x.carteId !== 14)) B.col('images').set(P.idImage(u.slugSet, u.carteId, u.numero), { _id: P.idImage(u.slugSet, u.carteId, u.numero), source: 'pdt', set: u.slugSet, carteId: u.carteId, numero: u.numero, wOriginal: u._w, hOriginal: Math.round(u._w * 1000 / 728), etat: 'trop-petit', seuilApplique: 350, lot: P.LOT, retirable: true, urlOriginal: u.url });
    };
    const depotsDe = () => { const l = []; return { l, f: async (...a) => l.push(a) }; };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const vignetterBanc = () => (db, slug, o) => vignetterApresJointure(db, slug, { ...o, journal: { error() { } }, assurer: async (db2, { slug: s }) => { let k = 0; for (const c of await db2.collection('cartes').find({}).toArray()) { let t = false; const images = (c.images || []).map(e => { if (e.set !== s || !e.cleR2 || e.vignette) return e; t = true; k++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2}`, w: 200, h: 279 } }; }); if (t) await db2.collection('cartes').updateOne({ _id: c._id }, { $set: { images } }); } return { entrees: k, cles: k, traitees: k, fabriquees: k, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: k ? [s] : [] }; } });
    const ecrire = async (B, o = {}) => { const dp = depotsDe(); const q = silencieux(); try { const b = await C.ecrire(o.plan || plan, B.M, { dossierCache: dc, attendu: o.attendu, simuler: o.simuler, deposer: dp.f, vignetter: vignetterBanc(), fabriquerVerrouSet: verrouSet }); return { b, dp }; } finally { q(); } };

    let B = fausseBase(); semer(B);
    // 4 à écrire : 320 McD (n°2), 400 (n°5), 320 McD cédée (n°6), 200 pile (n°7) ; 190 et le Trick or Trade à 320 ne le sont pas
    let r = await ecrire(B, { attendu: 5 });
    verifier('--attendu=5 alors que 4 sont à écrire : REFUSÉ avant toute écriture (aucun dépôt, aucune écriture)', [r.b.code, r.b.etat, r.dp.l.length, B.ecritures.length], [2, 'refuse-attendu', 0, 0]);
    const avantSimulation = JSON.stringify([...B.cols].map(([n, m]) => [n, [...m.values()]]));
    r = await ecrire(B, { simuler: true, attendu: 4 });
    verifier('ESSAI À BLANC : n\'écrit rien (aucun dépôt, aucune écriture, base identique), rend les 6 unités jugées', [r.dp.l.length, B.ecritures.length, JSON.stringify([...B.cols].map(([n, m]) => [n, [...m.values()]])) === avantSimulation, r.b.etat, r.b.unites?.length], [0, 0, true, 'simulation', 6]);
    const dec = id => r.b.unites?.find(x => x.carteId === id);
    verifier('essai à blanc : décision par unité (écrite / sous-le-seuil), seuil appliqué et largeur', U.map(u => [dec(u.carteId)?.decision, dec(u.carteId)?.seuil, dec(u.carteId)?.largeur]), [['ecrire', 200, 320], ['sous-le-seuil', 200, 190], ['sous-le-seuil', 350, 320], ['ecrire', 200, 400], ['ecrire', 200, 320], ['ecrire', 200, 200]]);
    verifier('essai à blanc : la fiche déjà servie par une autre source est signalée (la nôtre cédera)', [dec(15)?.dejaServie, dec(11)?.dejaServie], [true, false]);
    verifier('essai à blanc : les documents trop-petit rejugeables sont comptés (11, 15, 16 : jugés à 350, largeur ≥ 200 ; 13 n\'en est pas)', r.b.rejugeables, 3);

    r = await ecrire(B, { attendu: 4 });
    verifier('écriture : code 0, 4 images déposées dans R2, AUCUNE requête réseau', [r.b.code, r.dp.l.length, vusFetch.length], [0, 4, 0]);
    const d = n => B.col('images').get(P.idImage(U.find(u => u.carteId === n).slugSet, n, U.find(u => u.carteId === n).numero));
    verifier('McDonald\'s 320 px : document « ok », basseDefinition true, retirable, lot neutre existant, adresse d\'origine, plus de seuilApplique', [d(11).etat, d(11).basseDefinition, d(11).retirable, d(11).lot, d(11).urlOriginal, d(11).seuilApplique, d(11).source], ['ok', true, true, P.LOT, U[0].url, undefined, 'pdt']);
    const e11 = B.col('cartes').get(11).images.find(e => e.source === 'pdt');
    verifier('McDonald\'s 320 px : l\'entrée de la carte porte basseDefinition true, la mention, la langue et l\'adresse d\'origine', [e11?.basseDefinition, e11?.mention, e11?.langue, e11?.urlOriginal, e11?.set], [true, P.MENTION, 'en', U[0].url, MCD[0]]);
    verifier('200 px pile : écrit en basse définition', [d(16).etat, d(16).basseDefinition], ['ok', true]);
    verifier('400 px : écrit SANS la marque (au-dessus de 350)', [d(14).etat, d(14).basseDefinition], ['ok', undefined]);
    verifier('190 px (sous le plancher) : reste « trop-petit », seuil 200 écrit, rien de joint', [d(12).etat, d(12).seuilApplique, B.col('cartes').get(12).images.length], ['trop-petit', 200, 0]);
    verifier('Trick or Trade à 320 px : reste « trop-petit » à 350 (aucun autre set pdt n\'est touché), rien de joint', [d(13).etat, d(13).seuilApplique, B.col('cartes').get(13).images.length], ['trop-petit', 350, 0]);
    verifier('une fiche déjà servie par une autre source : la nôtre CÈDE, l\'image servie est intacte, jamais remplacée', [B.col('cartes').get(15).images.map(e => `${e.source}:${e.cleR2}`)], [['bulbapedia:bulbapedia/deja.webp']]);
    verifier('aucune entrée d\'une AUTRE carte n\'est touchée ; chaque carte écrite a UNE entrée pdt', [11, 14, 16].map(c => B.col('cartes').get(c).images.filter(e => e.source === 'pdt').length), [1, 1, 1]);
    const nw = B.ecritures.length;
    r = await ecrire(B, { attendu: 4 });
    verifier('rejeu : idempotent (rien de redéposé, une entrée par fiche)', [r.dp.l.length, B.col('cartes').get(11).images.filter(e => e.source === 'pdt').length], [0, 1]);
    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });

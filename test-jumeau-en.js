// node test-jumeau-en.js — R5 : remplacer par l'ANGLAIS prouvé les scans JAPONAIS du jumeau servis sous un set occidental (2026-10-12).
// Base en mémoire, réseau simulé, faux R2 : aucune requête, aucune base réelle. Ce que le banc garde :
//   · la définition du scan jumeau (langue « ja » sous un set au tirage « intl », fichier présent) et le seul chemin qui autorise un remplacement ;
//   · un remplacement exige DEUX éléments indépendants : l'adresse numéro + set (table pokemontcg.io) ET le nom (témoin TCGdex) ;
//   · un numéro déjà servi par un scan non japonais n'est jamais touché ; un doute reste tel quel et dit pourquoi ;
//   · le geste : l'entrée japonaise sort de cartes.images, l'anglaise la remplace au MÊME numéro ; le document japonais reste, marqué remplacé ;
//   · la préséance (le rejeu de Bulbapedia ne rejoint pas un numéro remplacé) ; la garde de lot voit un compte inchangé.
const sharp = require('sharp');
const fs = require('fs');
const P = require('./collecte-cartes/ptcgio');
const J = require('./collecte-cartes/jumeau-en');
const { collecterSlug } = require('./collecteur-images-ptcgio');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

function fausseBase({ dataSize = 1000, indexSize = 100 } = {}) {
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
    const collection = n => ({
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            let d = tous(n, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; col(n).set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    const db = { collection, async command(c) { if (c.dbStats) return { dataSize, indexSize }; throw new Error(`commande inattendue ${JSON.stringify(c)}`); } };
    const modele = n => ({
        db: { db },
        findById: id => ({ select: () => ({ lean: async () => structuredClone(col(n).get(id) ?? null) }) }),
        find: f => ({ lean: async () => structuredClone(tous(n, f)) }),
        updateOne: (f, u, o) => collection(n).updateOne(f, u, o)
    });
    return { cols, col, db, M: { Carte: modele('cartes'), Image: modele('images'), Set: modele('sets'), EtatImages: modele('collecte_images_etat') } };
}

(async () => {
    // ── 1. la définition du scan jumeau ─────────────────────────────────────────────────────────────────────────────
    const ja = (numero, extra = {}) => ({ set: 'S', source: 'bulbapedia', langue: 'ja', numero, cleR2: `bulbapedia/S/${numero}.webp`, ...extra });
    verifier('scan jumeau : « ja » sous un set « intl », fichier présent', J.scanJumeau(ja('5'), 'intl'), true);
    verifier('scan jumeau : jamais sous un set japonais, ni sans fichier, ni une autre langue, ni une langue inconnue (null)', [J.scanJumeau(ja('5'), 'jp'), J.scanJumeau(ja('5', { cleR2: undefined }), 'intl'), J.scanJumeau(ja('5', { langue: 'en' }), 'intl'), J.scanJumeau(ja('5', { langue: null }), 'intl'), J.scanJumeau(ja('5'), undefined)], [false, false, false, false, false]);
    verifier('scan jumeau : un set chinois/thaï/indonésien n\'est pas le périmètre (seul « intl »)', ['zh-hans', 'th', 'id', 'idth'].map(t => J.scanJumeau(ja('5'), t)), [false, false, false, false]);

    // ── 2. la préséance (le rejeu de Bulbapedia) ────────────────────────────────────────────────────────────────────
    const entrees = [
        { set: 'S', source: 'tcgdex', numero: '1' },
        { set: 'S', source: 'pokemontcg.io', lot: J.LOT_JUMEAU, numero: '2' },
        { set: 'S', source: 'pokemontcg.io', lot: P.LOT, numero: '3' },      // le lot ADDITIF ne prime pas : il ne remplace rien
        { set: 'S', source: 'bulbapedia', numero: '4' },
        { set: 'AUTRE', source: 'pokemontcg.io', lot: J.LOT_JUMEAU, numero: '5' }
    ];
    verifier('préséance : TCGdex et le lot de remplacement ; ni le lot additif, ni Bulbapedia, ni un autre set', [...J.numerosServisParRemplacement(entrees, 'S')].sort(), ['1', '2']);
    const bulba = fs.readFileSync(__dirname + '/collecteur-images-bulba.js', 'utf8');
    verifier('préséance : le collecteur Bulbapedia lit CETTE fonction (une seule définition, §21 bis)', [/numerosServisParRemplacement/.test(bulba), /require\('\.\/collecte-cartes\/jumeau-en'\)/.test(bulba)], [true, true]);

    // ── 3. les trous de remplacement ────────────────────────────────────────────────────────────────────────────────
    const carte = (id, nom, images = []) => ({ _id: id, nomEn: nom, images });
    const ligne = (carteId, idProduct, numeroFiche, numeroCm = numeroFiche) => ({ carteId, idProduct, numeroFiche, numeroCm });
    const cartes = new Map([
        [1, carte(1, 'Charmander', [ja('1')])],
        [2, carte(2, 'Charmeleon', [ja('2'), { set: 'AUTRE', source: 'tcgdex', langue: 'en', numero: '2', cleR2: 'x' }])],
        [3, carte(3, 'Phione', [ja('30'), { set: 'S', source: 'bulbapedia', langue: 'en', numero: '30', cleR2: 'y' }])],     // un anglais servi au MÊME numéro
        [4, carte(4, 'Altaria-GX', [ja('41', { langue: null })])],                                                         // langue inconnue : pas un jumeau prouvé
        [5, carte(5, 'Zinnia', [ja('7')])],                                                                                  // le jumeau est au n°7, la ligne dit 70
        [6, carte(6, 'Dratini', [ja('35')])]
    ]);
    const lignes = [ligne(1, 11, '1'), ligne(2, 12, '2'), ligne(3, 13, '30'), ligne(4, 14, '41'), ligne(5, 15, '70'), ligne(6, 16, '35', '35'), ligne(6, 17, '35', null), ligne(99, 18, '9')];
    const T = J.trousDeRemplacement({ tirage: 'intl', slug: 'S', lignes, cartes });
    verifier('trous : 1, 2 (autre set servi en anglais ne gêne pas) et Dratini 35 ; pas l\'anglais déjà servi (3), ni la langue inconnue (4), ni le numéro sans jumeau (5), ni la carte absente (99)',
        T.trous.map(x => [x.carte._id, x.numero, x.numeroCm, x.idProduct]), [[1, '1', '1', 11], [2, '2', '2', 12], [6, '35', '35', 16], [6, '35', '35', 17]]);
    verifier('trous : la carte du trou n\'a plus son jumeau (c\'est ce qui laisse planifierPtcgio voir un TROU) et garde le reste', [T.trous[0].carte.images.length, T.trous[1].carte.images.map(e => e.set)], [0, ['AUTRE']]);
    verifier('trous : la carte d\'origine n\'est pas modifiée (clone)', cartes.get(1).images.length, 1);
    verifier('trous : le jumeau remplacé est celui du numéro (entrée complète gardée pour le retour arrière)', [T.jumeaux.get('1|1')?.cleR2, T.jumeaux.get('6|35')?.numero], ['bulbapedia/S/1.webp', '35']);
    verifier('trous : le produit sans numéro Cardmarket prend celui de son frère (même carte, même fiche) — jamais d\'un autre', T.trous.find(x => x.idProduct === 17)?.numeroCm, '35');
    verifier('trous : les écartés disent pourquoi', T.ecartes.map(e => [e.carteId, e.motif]).sort((a, b) => a[0] - b[0]), [[3, 'deja-servi-hors-jumeau']]);
    const T2 = J.trousDeRemplacement({ tirage: 'jp', slug: 'S', lignes, cartes });
    verifier('trous : sous un set japonais, aucun', [T2.trous.length, T2.jumeaux.size], [0, 0]);
    verifier('trous : le produit sans numéro Cardmarket ET sans frère reste « sans-numero » (planifierPtcgio le dit)', (() => { const c = new Map([[7, carte(7, 'Zorua', [ja('52')])]]); const r = J.trousDeRemplacement({ tirage: 'intl', slug: 'S', lignes: [ligne(7, 20, '52', null)], cartes: c }); return r.trous.map(x => x.numeroCm); })(), [null]);

    // ── 4. le nom : deuxième élément indépendant ────────────────────────────────────────────────────────────────────
    const plan = [{ carteId: 1, numero: '1' }, { carteId: 2, numero: '2' }, { carteId: 6, numero: '35' }];
    const F = J.exigerLeNom(plan, new Set(['1|1', '6|35']));
    verifier('nom : seul ce que le témoin a prouvé reste dans le plan ; le reste est un reste « nom-non-prouve »', [F.plan.map(p => p.carteId), F.restes.map(r => [r.carteId, r.motif])], [[1, 6], [[2, 'nom-non-prouve']]]);
    verifier('nom : sans témoin du tout, rien ne passe', J.exigerLeNom(plan, null).plan.length, 0);
    verifier('nom : la clé est la même que celle de TCGdex (« 015 » = « 15 », zéros retirés)', J.cleNom(7, '015'), J.cleNom(7, '15'));

    // ── 5. de bout en bout : Dragon Majesty (sm75) ──────────────────────────────────────────────────────────────────
    const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
    const SLUG = 'Dragon-Majesty';
    const jaDM = (n, id) => ({ set: SLUG, source: 'bulbapedia', langue: 'ja', numero: n, cleR2: `bulbapedia/${SLUG}/${n}-${id}.webp`, sha256: `sha-${n}`, w: 600, h: 840, fmt: 'webp', urlOriginal: `https://archives.bulbagarden.net/${n}.jpg`, preuve: 'page de la carte', attribution: 'Bulbapedia' });
    const semer = B => {
        B.col('sets').set(SLUG, { _id: SLUG, tirage: 'intl', region: 'intl' });
        B.col('cartes').set(1, { _id: 1, nomEn: 'Charmander', images: [jaDM('1', 1)] });
        B.col('cartes').set(2, { _id: 2, nomEn: 'Charmeleon', images: [jaDM('2', 2)] });                                             // nom non prouvé : reste japonais
        B.col('cartes').set(3, { _id: 3, nomEn: 'Phione', images: [jaDM('30', 3), { set: SLUG, source: 'tcgdex', langue: 'en', numero: '30', cleR2: 'tcgdex/p.webp' }] });   // déjà servi en anglais
        B.col('cartes').set(4, { _id: 4, nomEn: 'Reshiram-GX', images: [jaDM('65', 4)] });
        B.col('cartes').set(5, { _id: 5, nomEn: 'Zinnia', images: [{ set: SLUG, source: 'bulbapedia', langue: 'en', numero: '70', cleR2: 'bulbapedia/z.webp' }] });     // anglais servi : jamais touché
        B.col('cartes').set(6, { _id: 6, nomEn: 'Charizard-GX', images: [] });                                                      // un vrai trou : le mode REMPLACEMENT ne s'en occupe pas
        for (const [c, p, n] of [[1, 101, '1'], [2, 102, '2'], [3, 103, '30'], [4, 104, '65'], [5, 105, '70'], [6, 106, '8']]) B.col('cartes_produits').set(`${c}|${p}`, { _id: `${c}|${p}`, carteId: c, idProduct: p, numeroFiche: n, slugSet: SLUG });
        for (const [c, n] of [[1, '1'], [2, '2'], [3, '30'], [4, '65']]) B.col('images').set(`bulbapedia/${SLUG}/${c}`, { _id: `bulbapedia/${SLUG}/${c}`, source: 'bulbapedia', set: SLUG, carteId: c, numero: n, etat: 'ok', langue: 'ja', cleR2: `bulbapedia/${SLUG}/${n}-${c}.webp` });
    };
    const NUMEROS_CM = { 101: '1', 102: '2', 103: '30', 104: '65', 105: '70', 106: '8' };
    const lireNumeros = async () => new Map(Object.entries(NUMEROS_CM).map(([k, v]) => [Number(k), v]));
    const nomsProuves = async () => new Set(['1|1', '3|30', '4|65']);
    const verrou = { tenu: true, perdu: false };
    const pause = async () => { };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const assurerBanc = async (db, { slug }) => {
        let n = 0;
        for (const c of await db.collection('cartes').find({}).toArray()) {
            let touche = false;
            const images = (c.images || []).map(e => { if (e.set !== slug || !e.cleR2 || e.vignette) return e; touche = true; n++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2.replace(/\.[^./]+$/, '')}.webp`, w: 200, h: 279 } }; });
            if (touche) await db.collection('cartes').updateOne({ _id: c._id }, { $set: { images } });
        }
        return { entrees: n, cles: n, traitees: n, fabriquees: n, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: n ? [slug] : [] };
    };
    const vignetter = (db, slug, o) => vignetterApresJointure(db, slug, { ...o, assurer: assurerBanc, journal: { error() { } } });
    const reseau = () => { const appels = []; return { appels, async get(url) { appels.push(url); return url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 200, type: 'image/png', octets: png }; } }; };
    const lancer = async (B, tr, o = {}) => {
        const depots = [];
        const cl = P.fabriquerClientPtcgio({ transport: tr, verrou, pause });
        const r = silencieux();
        try { return { b: await collecterSlug(SLUG, B.M, { verrou, client: cl, vignetter, lireNumeros, remplacerJumeau: true, nomsProuves: 'nomsProuves' in o ? o.nomsProuves : nomsProuves, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: verrouSet }), depots }; }
        finally { r(); }
    };
    const B = fausseBase(); semer(B);
    const sansVignette = i => { const c = structuredClone(B.col('cartes').get(i)); for (const e of c.images) delete e.vignette; return c; };   // la vignette est un champ NEUF que assurerVignettes pose partout
    const avantAutres = JSON.stringify([2, 3, 5, 6].map(sansVignette));
    let tr = reseau();
    let { b, depots } = await lancer(B, tr);
    verifier('remplacement : « verifie »', b.etat, 'verifie');
    verifier('requêtes : robots.txt puis les deux numéros PROUVÉS par le nom (1 et 65) — ni le nom non prouvé (2), ni le numéro déjà servi en anglais (30, 70), ni le trou (8)', tr.appels.map(u => u.replace('https://images.pokemontcg.io', '')), ['/robots.txt', '/sm75/1_hires.png', '/sm75/65_hires.png']);
    const e1 = B.col('cartes').get(1).images;
    verifier('la carte 1 : l\'entrée japonaise est SORTIE, l\'anglaise prend sa place au même numéro, lot de remplacement, langue « en » prouvée par la source', [e1.length, e1[0].source, e1[0].numero, e1[0].langue, !!e1[0].languePreuve, e1[0].lot, e1[0].mention], [1, 'pokemontcg.io', '1', 'en', true, J.LOT_JUMEAU, P.MENTION]);
    verifier('   la preuve écrite dit les DEUX éléments : adresse + set (table) ET nom (TCGdex), et ce qui est remplacé', [/sm75/.test(e1[0].preuve), /1/.test(e1[0].preuve), /TCGdex/.test(e1[0].preuve), /remplace/i.test(e1[0].preuve)], [true, true, true, true]);
    verifier('les cartes 2, 3, 5, 6 : INTACTES (le nom non prouvé reste japonais, l\'anglais servi est intact, le trou n\'est pas rempli)', JSON.stringify([2, 3, 5, 6].map(sansVignette)), avantAutres);
    const imgNeuve = B.col('images').get(P.idImagePtcgio(SLUG, 1, '1'));
    verifier('le document `images` neuf : source, lot, état, langue, et l\'entrée japonaise retirée gardée pour le retour arrière', [imgNeuve?.source, imgNeuve?.lot, imgNeuve?.etat, imgNeuve?.langue, imgNeuve?.jumeauRemplace?.cleR2, imgNeuve?.jumeauRemplace?.langue], ['pokemontcg.io', J.LOT_JUMEAU, 'ok', 'en', `bulbapedia/${SLUG}/1-1.webp`, 'ja']);
    const imgJa = B.col('images').get(`bulbapedia/${SLUG}/1`);
    verifier('le document japonais RESTE, marqué remplacé (état inchangé : le rejeu de Bulbapedia et les mesures le comptent encore)', [imgJa?.etat, imgJa?.remplaceePar, !!imgJa?.remplaceeLe], ['ok', P.idImagePtcgio(SLUG, 1, '1'), true]);
    verifier('les documents japonais des cartes non remplacées (2 : nom non prouvé, 3 : anglais déjà servi) ne sont pas marqués ; celui de la carte 4 (65, prouvée) l\'est', [2, 3, 4].map(c => B.col('images').get(`bulbapedia/${SLUG}/${c}`)?.remplaceePar ?? null), [null, null, P.idImagePtcgio(SLUG, 4, '65')]);
    verifier('R2 AVANT la ligne : 2 dépôts WebP', [depots.length, depots[0]?.[3]], [2, 'image/webp']);
    const bilan = B.col('sets').get(SLUG);
    verifier('bilan : écrit sous `visuelsPtcgioJumeau` (le bilan additif n\'est pas écrasé), jumeaux 3 (carte 3 déjà servie ne compte pas : 1, 2, 4), prouvés 2, garde verte',
        [!!bilan.visuelsPtcgioJumeau, bilan.visuelsPtcgio, bilan.visuelsPtcgioJumeau?.jumeaux, bilan.visuelsPtcgioJumeau?.prouves, bilan.visuelsPtcgioJumeau?.garde?.ok, bilan.visuelsPtcgioJumeau?.joints], [true, undefined, 3, 2, true, 2]);
    verifier('bilan : le reste « nom-non-prouve » est NOMMÉ', bilan.visuelsPtcgioJumeau?.restes, { 'nom-non-prouve': 1 });
    verifier('garde de lot : le nombre d\'images du set est le même avant et après (remplacement 1 pour 1)', [bilan.visuelsPtcgioJumeau?.garde?.nJaRetirees, bilan.visuelsPtcgioJumeau?.garde?.nEnPosees], [2, 2]);

    // un second passage : rien à refaire
    tr = reseau();
    ({ b, depots } = await lancer(B, tr));
    verifier('second passage : « verifie », 0 téléchargement, 0 dépôt, toujours une seule entrée par carte', [b.etat, tr.appels.filter(u => /hires/.test(u)).length, depots.length, B.col('cartes').get(1).images.length], ['verifie', 0, 0, 1]);

    // sans le témoin du nom : refus avant toute requête
    const B2 = fausseBase(); semer(B2);
    tr = reseau();
    ({ b } = await lancer(B2, tr, { nomsProuves: undefined }));
    verifier('sans témoin du nom : refus avant toute requête, rien écrit', [b.etat, tr.appels.length, JSON.stringify(B2.col('cartes').get(1).images) === JSON.stringify([jaDM('1', 1)])], ['refuse-nom', 0, true]);
    // le témoin du nom qui lève : l'unité s'arrête, rien n'est remplacé
    const B3 = fausseBase(); semer(B3);
    tr = reseau();
    let leve = null; try { ({ b } = await lancer(B3, tr, { nomsProuves: async () => { throw new Error('cache TCGdex absent'); } })); } catch (e) { leve = e.message; }
    verifier('témoin du nom en échec : rien n\'est remplacé, aucune requête', [leve === null ? b.etat : 'leve', tr.appels.length, JSON.stringify(B3.col('cartes').get(1).images) === JSON.stringify([jaDM('1', 1)])], ['refuse-nom', 0, true]);

    // une AUTRE source sert le numéro entre deux passages : elle cède la place, le jumeau n'est pas retiré à tort
    const B4 = fausseBase(); semer(B4);
    tr = reseau();
    const tr4 = { appels: tr.appels, async get(url) { if (/\/1_hires/.test(url)) B4.col('cartes').get(1).images.push({ set: SLUG, source: 'tcgdex', langue: 'en', numero: '1', cleR2: 'tcgdex/c.webp' }); return tr.get(url); } };
    ({ b } = await lancer(B4, tr4));
    verifier('numéro servi par un autre anglais entre-temps : le remplaçant cède (rien de nous n\'est posé) et l\'entrée japonaise n\'est pas retirée par ce lot', B4.col('cartes').get(1).images.map(e => `${e.source}:${e.langue}`), ['bulbapedia:ja', 'tcgdex:en']);

    // le mode additif n'est pas modifié : sans `remplacerJumeau`, un numéro porteur d'un jumeau n'est pas un trou
    const B5 = fausseBase(); semer(B5);
    const trAdd = reseau();
    const clA = P.fabriquerClientPtcgio({ transport: trAdd, verrou, pause });
    const r5 = silencieux(); let bAdd; try { bAdd = await collecterSlug(SLUG, B5.M, { verrou, client: clA, vignetter, lireNumeros, deposer: async () => { }, fabriquerVerrouSet: verrouSet }); } finally { r5(); }
    verifier('mode additif inchangé : seul le vrai trou (n°8) est demandé, aucun jumeau touché', [trAdd.appels.filter(u => /hires/.test(u)).map(u => u.slice(-12)), B5.col('cartes').get(1).images[0].source], [['/8_hires.png'], 'bulbapedia']);

    // ── 6. tour de correction 1 ─────────────────────────────────────────────────────────────────────────────────────────────
    // (A-I) noteVariante : le décompte voit AUSSI le produit sans ligne `numeros_cartes` (SL Zorua 52 : 302190 et 368730 partagent UNE image)
    {
        const cs = new Map([[9, carte(9, 'Zorua', [ja('52', { set: 'Shining-Legends' })])]]);
        const ls = [{ carteId: 9, idProduct: 302190, numeroFiche: '52' }, { carteId: 9, idProduct: 368730, numeroFiche: '52' }];
        const Pz = J.planifierRemplacement({ slug: 'Shining-Legends', tirage: 'intl', lignes: ls, cartes: cs, numerosCm: new Map([[302190, '52']]), nomsProuves: new Set([J.cleNom(9, '52')]) });
        verifier('noteVariante : 2 produits au n°52 dont un sans numeros_cartes → UN fichier, AVEC la note (le décompte lit aussi le numéro de fiche)', [Pz.plan.length, Pz.plan[0]?.noteVariante], [1, P.NOTE_VARIANTE]);
        const Ps = J.planifierRemplacement({ slug: 'Shining-Legends', tirage: 'intl', lignes: [ls[0]], cartes: cs, numerosCm: new Map([[302190, '52']]), nomsProuves: new Set([J.cleNom(9, '52')]) });
        verifier('noteVariante : un seul produit au numéro → aucune note', Ps.plan[0]?.noteVariante ?? null, null);
        verifier('numerosDuSet : le numéro Cardmarket d\'abord, sinon celui de la ligne, sinon rien', P.numerosDuSet([{ idProduct: 1, numeroFiche: 'x' }, { idProduct: 2, numeroFiche: '52' }, { idProduct: 3, numeroFiche: null }], new Map([[1, '7']])), ['7', '52']);
        // T2 (mode additif) : même défaut, même correction
        const lignesT2 = [{ carteId: 1, idProduct: 10, numeroFiche: '005' }, { carteId: 2, idProduct: 11, numeroFiche: '005' }];
        verifier('T2 additif : un produit sans numeros_cartes au même numéro compte aussi', P.planifierPtcgio({ slug: 'Celebrations', trous: [{ carte: carte(1, 'Pikachu'), numeroCm: '005', numeroFiche: '005', idProduct: 10 }], tousNumerosCm: P.numerosDuSet(lignesT2, new Map([[10, '005']])) }).plan.map(p => p.noteVariante ?? null), [P.NOTE_VARIANTE]);
    }
    // (B-I1/B-I2) LE CÂBLAGE : le rejeu de la jointure Bulbapedia (`joindreImagesBulba`, EXÉCUTÉE comme le worker l'exécute) ne remet PAS le scan japonais
    {
        const { joindreImagesBulba } = require(process.argv.find(a => a.startsWith('--bulba='))?.slice(8) || './collecteur-images-bulba');
        const SL = 'Set-Banc';
        const docBulba = (n, extra = {}) => ({ _id: `bulba:${n}`, source: 'bulbapedia', set: SL, carteId: 1, numero: n, cleR2: `bulbapedia/${SL}/${n}.webp`, sha256: 'h', w: 600, h: 840, fmt: 'webp', wOriginal: 600, hOriginal: 840, urlOriginal: 'u', preuve: 'p', page: 'P', etat: 'ok', langue: 'ja', languePreuve: 'banc', ...extra });
        const enLot = { set: SL, source: 'pokemontcg.io', lot: J.LOT_JUMEAU, numero: '1', cleR2: 'pokemontcg.io/x-en.webp', langue: 'en' };
        const rejouer = async (entrees, docs) => {
            const Bj = fausseBase();
            Bj.col('cartes').set(1, { _id: 1, nomEn: 'Spidops', images: structuredClone(entrees) });
            for (const d of docs) Bj.col('images').set(d._id, structuredClone(d));
            await joindreImagesBulba(Bj.M, SL, structuredClone(docs));
            return Bj.col('cartes').get(1).images.map(e => `${e.source}:${e.numero}:${e.langue}`);
        };
        verifier('REJEU Bulbapedia : l\'entrée anglaise du lot jumeau est en place → le scan japonais du même numéro n\'est PAS remis (celui du numéro 2 l\'est)', await rejouer([enLot], [docBulba('1'), docBulba('2')]), ['pokemontcg.io:1:en', 'bulbapedia:2:ja']);
        verifier('REJEU Bulbapedia : le lot ADDITIF ne prime pas (rien n\'y remplace un jumeau) — le scan est joint comme avant', (await rejouer([{ ...enLot, lot: P.LOT }], [docBulba('1')])).sort(), ['bulbapedia:1:ja', 'pokemontcg.io:1:en']);
        // l'ordre avec le remplacement « basse définition » de R1 : le numéro préservé est filtré AVANT, l'autre numéro reste remplaçable — pas de contradiction
        const tpc = (n, extra = {}) => ({ set: SL, source: 'tpc-asie', numero: n, cleR2: `tpc-asie/${SL}/${n}.webp`, w: 300, langue: 'ja', basseDefinition: true, ...extra });
        const docTpc = n => ({ _id: `doc:tpc${n}`, source: 'tpc-asie', set: SL, cleR2: `tpc-asie/${SL}/${n}.webp`, etat: 'ok', wOriginal: 300, w: 300, basseDefinition: true, langue: 'ja' });
        const Bk = fausseBase();
        Bk.col('cartes').set(1, { _id: 1, nomEn: 'Spidops', images: [enLot, tpc('1'), tpc('2')] });
        for (const d of [docBulba('1'), docBulba('2'), docTpc('1'), docTpc('2')]) Bk.col('images').set(d._id, structuredClone(d));
        await joindreImagesBulba(Bk.M, SL, [docBulba('1'), docBulba('2')]);
        verifier('ORDRE avec la basse définition de R1 : au n°1 (anglais du lot en place) la jointure ne joint rien et ne touche pas l\'entrée basse ; au n°2 la candidate remplace l\'entrée basse',
            [Bk.col('cartes').get(1).images.map(e => `${e.source}:${e.numero}${e.basseDefinition ? ':basse' : ''}`).sort(), Bk.col('images').get('doc:tpc1').etat, Bk.col('images').get('doc:tpc2').etat], [['bulbapedia:2', 'pokemontcg.io:1', 'tpc-asie:1:basse'].sort(), 'ok', 'remplace']);
    }

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

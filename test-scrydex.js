// node test-scrydex.js — images.scrydex.com pour la CLASSIC COLLECTION de 30th Celebration (me55c), de bout en bout, SANS réseau ni base réelle ni R2.
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : images.scrydex.com ouvert aux mêmes conditions que pokemontcg.io — serveur d'images seulement, jamais d'API, source interne enregistrée,
// mention « © Pokémon / The Pokémon Company » et jamais « Scrydex » dans un champ public, appariement prouvé par DEUX éléments (ici : le NUMÉRO imprimé d'origine ET le NOM).
// Ce que le banc garde :
//   · la VÉRITÉ des 29 produits prouvés — écrite ici à part de la table, lue à l'œil sur les 30 images du 2026-10-17 (numéro imprimé, nom, bordure dorée + logo « 30 ») ;
//   · le trou : Genesect-EX (produit « 97 ») — l'image du serveur imprime 11/101, jamais 97 : pas d'image (un doute est un trou) ;
//   · le plan : l'adresse, le nom qui contredit, le numéro de fiche qui contredit, le produit hors table, le produit déjà pourvu ;
//   · la langue (« en ») écrite par ce qu'elle autorise (hôte d'images, jamais l'API), et aucun champ public ne dit « scrydex ».
const sharp = require('sharp');
const P = require('./collecte-cartes/ptcgio');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { collecterSlug } = require('./collecteur-images-ptcgio');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };
const SLUG = '30th-Celebration';
const HOTE = ['https://images.', 'scry', 'dex.com'].join('');
const adresse = id => `${HOTE}/pokemon/${id}/large`;

// ── LA VÉRITÉ, lue à l'œil le 2026-10-17 : [idProduct, nomEn, numéro d'origine, numéro imprimé, id du serveur] ──────────────────────────────────────────────
const VERITE = [
    [907940, 'Charizard', '4', '4/102', 'me55c-4'], [907939, 'Pikachu', '58', '58/102', 'me55c-58'], [907941, 'Misty', '18', '18/132', 'me55c-18'], [907942, 'Erika\'s Jigglypuff', '69', '69/132', 'me55c-69'],
    [907947, 'Dark Tyranitar', '19', '19/109', 'me55c-19'], [907944, 'Shining Celebi', '106', '106/105', 'me55c-106'], [907946, 'Delcatty', '5', '5/109', 'me55c-5'], [907950, 'Palkia LV.X', '106', '106/106', 'me55c-106p'],
    [907945, 'Lugia', '149', '149/147', 'me55c-149'], [907951, 'Uxie', '43', '43/146', 'me55c-43'], [907952, 'Crobat G', '47', '47/127', 'me55c-47'], [907953, 'Gengar', '94', '94/102', 'me55c-94'],
    [907955, 'Darkrai & Cresselia LEGEND', '100', '100/102', 'me55c-100'], [907954, 'Darkrai & Cresselia LEGEND', '99', '99/102', 'me55c-99'], [907959, 'M Gardevoir-EX', '106', '106/160', 'me55c-106m'],
    [907961, 'Solgaleo-GX', '89', '89/149', 'me55c-89'], [907964, 'Zacian V', '138', '138/202', 'me55c-138'], [907962, 'Buzzwole-GX', '57', '57/111', 'me55c-57'], [907965, 'Raikou', '50', '50/185', 'me55c-50'],
    [907968, 'Magikarp', '203', '203/193', 'me55c-203'], [907943, 'Sneasel', '25', '25/111', 'me55c-25'], [907956, 'N', '101', '101/101', 'me55c-101'], [907949, 'Metagross', '11', '11/113', 'me55c-11'],
    [907948, 'Scizor ex', '108', '108/115', 'me55c-108'], [907957, 'Rayquaza-EX', '85', '85/124', 'me55c-85'], [907963, 'Pikachu & Zekrom-GX', '33', '33/181', 'me55c-33'], [907966, 'Mew VMAX', '114', '114/264', 'me55c-114'],
    [907960, 'Greninja BREAK', '41', '41/122', 'me55c-41'], [907967, 'Arceus VSTAR', '123', '123/172', 'me55c-123']
];
const GENESECT = { idProduct: 907958, nom: 'Genesect-EX' };       // produit « Genesect-EX-30CPLB-97 » ; l'image du serveur (me55c-11g) imprime 11/101
// 🔴 LES DEUX MOITIÉS DE DARKRAI & CRESSELIA LEGEND (99/102 et 100/102) sont UNE carte (un seul document `cartes`) et DEUX produits : la fiche du site n'a pas de numéro (null) et sert la première image du
// set aux deux produits — la simulation (règle du site importée) a servi l'image 100 au produit 99. Une image qui pourrait être servie à l'autre moitié est une erreur : ni l'une ni l'autre n'est écrite.
const MOTIF_LEGEND = 'deux-produits-une-fiche';
const EST_LEGEND = v => v[1].startsWith('Darkrai');
const SERVIS = VERITE.filter(v => !EST_LEGEND(v));                    // les 27 produits écrits
const L = P.TABLE_PTCGIO.find(l => l.slug === SLUG);

(async () => {
    // ── 1. la ligne de table ─────────────────────────────────────────────────────────────────────────────────────────────
    verifier('la table porte UNE ligne pour 30th-Celebration, sur l\'hôte d\'images du serveur scrydex, set me55c', [P.TABLE_PTCGIO.filter(l => l.slug === SLUG).length, L?.hote, L?.idServeur], [1, P.HOTE_SCRYDEX_NOM, 'me55c']);
    verifier('le set est « prouvé » (verdictDuSet)', P.verdictDuSet(SLUG).verdict, 'prouve');
    verifier('les 27 produits écrits, un par un : idProduct → nom, numéro, numéro imprimé, id du serveur (29 lus à l\'œil, moins les deux moitiés de la carte LEGEND)', (L?.parProduit || []).map(e => [e.idProduct, e.nom, e.numero, e.imprime, e.id]).sort((a, b) => a[0] - b[0]), SERVIS.map(v => [...v]).sort((a, b) => a[0] - b[0]));
    verifier('les refusés sont nommés avec leur motif : Genesect-EX (l\'image contredit) et les deux moitiés LEGEND (une fiche pour deux produits)', (L?.refuses || []).map(r => [r.idProduct, r.motif]).sort((a, b) => a[0] - b[0]), [[907954, MOTIF_LEGEND], [907955, MOTIF_LEGEND], [907958, 'numero-contredit-par-l-image']]);
    verifier('Genesect-EX (« 97 ») n\'est PAS dans la table : l\'image du serveur imprime 11/101', (L?.parProduit || []).some(e => e.idProduct === GENESECT.idProduct || /11g|11\/101/.test(`${e.id} ${e.imprime}`) && e.nom === GENESECT.nom), false);
    verifier('au moins 3 témoins REGARDÉS, avec leur numéro imprimé et leur nom', [(L?.temoins || []).length >= 3, (L?.temoins || []).every(w => w.nom && w.imprime && VERITE.some(v => v[1] === w.nom && v[3] === w.imprime))], [true, true]);
    verifier('la marque dit la bordure dorée, le logo « 30 » et la réimpression (pas la carte d\'origine)', [/bordure dorée/.test(L?.marque || ''), /30/.test(L?.marque || ''), /Classic Collection/.test(L?.marque || '')], [true, true, true]);
    verifier('une adresse : /pokemon/<set>-<n>/large, jamais autre chose ; un set non énuméré LÈVE', [P.urlScrydex?.('me55c-4'), P.urlScrydex?.('me55c-106p')], [adresse('me55c-4'), adresse('me55c-106p')]);
    let leve = null; try { P.urlScrydex('inconnu-4'); } catch (e) { leve = e.message; }
    verifier('urlScrydex : un identifiant hors des sets énumérés lève', /hors de ce que le client autorise/.test(leve || ''), true);
    verifier('mention : exactement « © Pokémon / The Pokémon Company », jamais le nom de l\'hôte', [P.MENTION, /scrydex/i.test(P.MENTION)], ['© Pokémon / The Pokémon Company', false]);

    // ── 2. le plan, pur ──────────────────────────────────────────────────────────────────────────────────────────────────
    const carte = (id, nom, images = []) => ({ _id: id, nomEn: nom, images });
    const trou = (c, idProduct, numeroFiche = null, numeroCm = null) => ({ carte: c, numeroFiche, numeroCm, idProduct });
    const toutes = VERITE.map(v => trou(carte(EST_LEGEND(v) ? 98384 : v[0] + 1000, v[1]), v[0]));
    const planTout = P.planifierPtcgio({ slug: SLUG, trous: toutes });
    verifier('plan : les 27 produits reçoivent leur adresse, par idProduct (le numéro d\'origine ne suffit pas : trois « 106 », deux « 11 »)', planTout.plan.map(p => [p.idProduct, p.url]).sort((a, b) => a[0] - b[0]), SERVIS.map(v => [v[0], adresse(v[4])]).sort((a, b) => a[0] - b[0]));
    verifier('plan : le numéro porté par l\'entrée est le numéro d\'ORIGINE, en texte', planTout.plan.every(p => p.numero === VERITE.find(v => v[0] === p.idProduct)[2]), true);
    verifier('plan : voie, ligne et preuve — l\'hôte, le numéro imprimé et le nom sont dans la preuve', [planTout.plan[0].voie, planTout.plan[0].ligneId, /images\.scry/.test(planTout.plan[0].preuve), /4\/102/.test(planTout.plan.find(p => p.idProduct === 907940).preuve), /Charizard/.test(planTout.plan.find(p => p.idProduct === 907940).preuve)], ['set-prouve+produit', 'me55c', true, true, true]);
    verifier('plan : aucune note de variante (une image par produit, pas de V1/V2)', planTout.plan.some(p => p.noteVariante), false);
    const dcl = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(98384, 'Darkrai & Cresselia LEGEND'), 907954), trou(carte(98384, 'Darkrai & Cresselia LEGEND'), 907955)] });
    verifier('plan : les deux moitiés de Darkrai & Cresselia LEGEND (même carte, deux produits, une fiche sans numéro) restent des TROUS nommés — aucune image n\'est écrite pour l\'une ou l\'autre', [dcl.plan.length, dcl.restes.map(r => [r.idProduct, r.motif])], [0, [[907954, MOTIF_LEGEND], [907955, MOTIF_LEGEND]]]);
    const gen = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(173735, 'Genesect-EX'), GENESECT.idProduct)] });
    verifier('plan : Genesect-EX reste un TROU, nommé (le numéro imprimé par le serveur contredit le produit)', [gen.plan.length, gen.restes.map(r => r.motif)], [0, ['numero-contredit-par-l-image']]);
    const nom = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(60348, 'Mew'), 907940)] });
    verifier('plan : le NOM de la carte contredit la table (idProduct de Charizard sur une carte « Mew ») : aucune image, motif nommé', [nom.plan.length, nom.restes.map(r => r.motif)], [0, ['numero-nom-contredit']]);
    const fiche = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(60348, 'Charizard'), 907940, '5')] });
    verifier('plan : un numéro de FICHE qui contredit le numéro d\'origine (5 pour le n° 4) : aucune image', [fiche.plan.length, fiche.restes.map(r => r.motif)], [0, ['numero-contradictoire']]);
    const fichePose = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(60348, 'Charizard'), 907940, '004', '4')] });
    verifier('plan : un numéro de fiche qui concorde (004) ne gêne pas', fichePose.plan.map(p => p.url), [adresse('me55c-4')]);
    const horsTable = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(15381, 'Switch'), 907734, '127', '127'), trou(carte(1, 'Charizard'), 999999)] });
    verifier('plan : un produit du set qui n\'est pas dans la table (Switch 30C127, id inconnu) : aucune image, « produit-hors-table »', [horsTable.plan.length, horsTable.restes.map(r => r.motif)], [0, ['produit-hors-table', 'produit-hors-table']]);
    const servi = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(60348, 'Charizard', [{ set: SLUG, source: 'tcgdex', numero: '4', cleR2: 'x' }]), 907940)] });
    verifier('plan : un produit déjà pourvu à son numéro n\'est jamais dans le plan (additif)', [servi.plan.length, servi.restes.length], [0, 0]);
    const autreSet = P.planifierPtcgio({ slug: SLUG, trous: [trou(carte(60348, 'Charizard', [{ set: 'Base-Set', source: 'tcgdex', numero: '4', cleR2: 'x' }]), 907940)] });
    verifier('plan : une image du MÊME dessin dans un AUTRE set (Base Set) ne compte pas comme servi ici', autreSet.plan.length, 1);
    const autreSlug = P.planifierPtcgio({ slug: 'Celebrations', trous: [trou(carte(60348, 'Charizard'), 907940, null, null)] });
    verifier('la ligne n\'est lue que sous SON slug (Celebrations ne reçoit rien d\'elle)', autreSlug.plan.length, 0);

    // ── 3. la langue, écrite par ce qu'elle autorise ──────────────────────────────────────────────────────────────────
    const lg = langueDuVisuel({ source: P.SOURCE, langueSource: 'en', urlOriginal: adresse('me55c-4') });
    verifier('langue : « en » pour une image de pokemontcg.io dont l\'adresse est celle du serveur scrydex', lg.langue, 'en');
    verifier('   la preuve de langue (publique) ne nomme pas l\'hôte', /scrydex/i.test(lg.preuve), false);
    verifier('langue : toujours « en » pour l\'hôte historique ; « en » aussi sans adresse (appel historique du collecteur)', [langueDuVisuel({ source: P.SOURCE, langueSource: 'en', urlOriginal: 'https://images.pokemontcg.io/cel25/5_hires.png' }).langue, langueDuVisuel({ source: P.SOURCE, langueSource: 'en' }).langue], ['en', 'en']);
    const api = ['https://', 'api', '.pokemontcg', '.io/v2/cards'].join(''), api2 = ['https://', 'api', '.scry', 'dex.com/x'].join('');
    verifier('langue : une adresse qui n\'est pas un des deux hôtes d\'images n\'a pas de règle (null), jamais « en »', [api, api2, 'https://autre.example/x.png'].map(u => langueDuVisuel({ source: P.SOURCE, langueSource: 'en', urlOriginal: u }).langue), [null, null, null]);

    // ── 4. le collecteur de bout en bout (base en mémoire, réseau simulé) ──────────────────────────────────────────────
    const png = await sharp({ create: { width: 654, height: 914, channels: 3, background: { r: 200, g: 170, b: 40 } } }).png().toBuffer();
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
        const db = { collection, async command(c) { if (c.dbStats) return { dataSize: 1000, indexSize: 100 }; throw new Error(`commande inattendue ${JSON.stringify(c)}`); } };
        const modele = n => ({
            db: { db },
            findById: id => ({ select: () => ({ lean: async () => structuredClone(col(n).get(id) ?? null) }) }),
            find: f => ({ lean: async () => structuredClone(tous(n, f)) }),
            updateOne: (f, u, o) => collection(n).updateOne(f, u, o)
        });
        return { cols, col, db, M: { Carte: modele('cartes'), Image: modele('images'), Set: modele('sets'), EtatImages: modele('collecte_images_etat') } };
    }
    const B = fausseBase();
    B.col('sets').set(SLUG, { _id: SLUG, tirage: 'intl', region: 'intl' });
    const choisis = [VERITE[0], VERITE[5], VERITE[7], VERITE[14]];                             // Charizard, Shining Celebi, Palkia LV.X, M Gardevoir-EX (les trois « 106 » en font partie)
    const legend = VERITE.filter(EST_LEGEND);                                                  // les deux moitiés LEGEND : dans la base, jamais demandées
    const cartesParNom = new Map();
    const poser = (idCarte, nom, images = []) => { if (!B.col('cartes').has(idCarte)) B.col('cartes').set(idCarte, { _id: idCarte, nomEn: nom, images }); return idCarte; };
    for (const v of [...choisis, ...legend]) { const idCarte = poser(v[1].startsWith('Darkrai') ? 98384 : v[0] + 1000, v[1]); B.col('cartes_produits').set(`${idCarte}|${v[0]}`, { _id: `${idCarte}|${v[0]}`, carteId: idCarte, idProduct: v[0], numeroFiche: null, slugSet: SLUG }); cartesParNom.set(v[0], idCarte); }
    poser(173735, 'Genesect-EX'); B.col('cartes_produits').set('173735|907958', { _id: '173735|907958', carteId: 173735, idProduct: 907958, numeroFiche: null, slugSet: SLUG });
    poser(15381, 'Switch', [{ set: SLUG, source: 'tcgdex', numero: '127', cleR2: 'tcgdex/s.webp', langue: 'en' }]); B.col('cartes_produits').set('15381|907734', { _id: '15381|907734', carteId: 15381, idProduct: 907734, numeroFiche: '127', slugSet: SLUG });
    const lireNumeros = async () => new Map([[907734, '127']]);
    const appels = [];
    const transport = { async get(url) { appels.push(url); return /\/robots\.txt$/.test(url) ? { status: 200, texte: '# aucun Disallow\n' } : /\/pokemon\/me55c-\d+[a-z]?\/large$/.test(url) ? { status: 200, type: 'image/png', octets: png } : { status: 404, type: 'image/png' }; } };
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const assurer = async (db, { slug }) => { let n = 0; for (const c of await db.collection('cartes').find({}).toArray()) { let t = false; const images = (c.images || []).map(e => { if (e.set !== slug || !e.cleR2 || e.vignette) return e; t = true; n++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2.replace(/\.[^./]+$/, '')}.webp`, w: 200, h: 279 } }; }); if (t) await db.collection('cartes').updateOne({ _id: c._id }, { $set: { images } }); } return { entrees: n, cles: n, traitees: n, fabriquees: n, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: n ? [slug] : [] }; };
    const depots = [];
    const verrou = { tenu: true, perdu: false };
    const cl = P.fabriquerClientPtcgio({ transport, verrou, pause: async () => { } });
    const restore = silencieux();
    let b;
    try { b = await collecterSlug(SLUG, B.M, { verrou, client: cl, vignetter: (db, slug, o) => vignetterApresJointure(db, slug, { ...o, assurer, journal: { error() { } } }), lireNumeros, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: () => ({ prendre: async () => null, rendre: async () => { } }) }); }
    finally { restore(); }
    verifier('collecte : « verifie »', b?.etat, 'verifie');
    verifier('requêtes : le robots.txt de l\'hôte, puis les 4 images prouvées — rien pour Genesect-EX, les moitiés LEGEND ni le produit déjà pourvu', appels.map(u => u.replace(HOTE, '')), ['/robots.txt', ...choisis.map(v => `/pokemon/${v[4]}/large`)]);
    verifier('requêtes comptées par hôte : tout chez le serveur d\'images scrydex, rien chez l\'autre', cl.requetesParHote(), { [P.HOTE_SCRYDEX_NOM]: 5 });
    const im = B.col('images').get(`pokemontcg.io/${SLUG}/${cartesParNom.get(907940)}/4/en`);
    verifier('le document `images` : source, langue, mention, lot, état, adresse (l\'hôte s\'y lit)', [im?.source, im?.langue, im?.mention, im?.lot, im?.etat, im?.urlOriginal], ['pokemontcg.io', 'en', '© Pokémon / The Pokémon Company', 'ptcgio-2026-10', 'ok', adresse('me55c-4')]);
    verifier('   la preuve interne dit l\'hôte et le numéro imprimé', [/images\.scry/.test(im?.preuve || ''), /4\/102/.test(im?.preuve || '')], [true, true]);
    verifier('R2 AVANT la ligne : 4 dépôts WebP, clés distinctes (les trois « 106 » ne se confondent pas)', [depots.length, new Set(depots.map(d => d[1])).size, depots[0]?.[3]], [4, 4, 'image/webp']);
    const entrees = [...B.col('cartes').values()].flatMap(c => (c.images || []).filter(e => e.source === 'pokemontcg.io').map(e => ({ c: c._id, n: e.numero, k: e.cleR2 })));
    verifier('les entrées de cartes.images : numéro d\'origine, une par produit prouvé', entrees.map(e => `${e.c}:${e.n}`).sort(), choisis.map(v => `${cartesParNom.get(v[0])}:${v[2]}`).sort());
    verifier('Genesect-EX, la carte LEGEND (deux produits) et le Switch restent comme avant (rien d\'ajouté)', [B.col('cartes').get(173735).images, B.col('cartes').get(98384).images, B.col('cartes').get(15381).images.length], [[], [], 1]);
    const PUBLICS = ['set', 'cleR2', 'w', 'h', 'vignette', 'numero', 'langue', 'languePreuve', 'source', 'mention', 'noteVariante', 'basseDefinition'];      // les champs que le site lit (lib/pipelines.ts, lireDonnee.ts)
    const fuites = [...B.col('cartes').values()].flatMap(c => (c.images || []).flatMap(e => PUBLICS.filter(k => e[k] !== undefined && /scrydex/i.test(JSON.stringify(e[k]))).map(k => `${c._id}.${k}`)));
    verifier('AUCUN champ public d\'une entrée ne nomme « Scrydex » (source, mention, langue, preuve de langue, clé R2…)', fuites, []);
    verifier('retrait en un lot : le plan du lot existant retire ces entrées (même source, même lot)', P.planRetraitPtcgio([...B.col('cartes').values()]).entrees, 4);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });

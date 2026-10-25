// node test-collecter-tpc-seulement.js — API-52 L5b : l'option --seulement=<idProduct,…> du lanceur dédié TPC (collecter-tpc-set.js). Elle restreint le plan — donc les images téléchargées, la planche ET l'écriture — à ces produits ;
// les listes et fiches en cache ne se redemandent pas ; l'écriture refuse si sa sélection n'est pas celle de la planche ; sans l'option, rien ne change. Base en mémoire, transport simulé, global.fetch piégé, dossiers temporaires.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = __dirname;
process.chdir(DIR);
require(path.join(DIR, 'bancs-dossier-arrets'));
const sharp = require('sharp');
const T = require('./collecte-cartes/tpc');
const { ligneTpc, TABLE_TPC } = require('./collecte-cartes/tpc-sets');
const GL = require('./collecte-cartes/garde-lot');
const L = require('./collecter-tpc-set.js');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };
const essayer = async f => { try { return { r: await f() }; } catch (e) { return { e: String(e.message) }; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tpcbeg-'));

function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : '$gt' in v ? lire(d, k) > v.$gt : false) : lire(d, k) === v);
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

const BEG = 'Beginning-Set', TCP = 'Traditional-Chinese-Products', ANCIENNE = 'artofpkm/223/104.webp';
const VIGNETTE = { cleR2: 'vignettes/artofpkm/223/104.webp', w: 162, h: 226 };
function semerBeg(B) {
    B.col('cartes').set(2, { _id: 2, nomEn: 'Potion', nomJa: 'キズぐすり', categorie: 'dresseur', images: [{ set: BEG, source: 'artofpkm', numero: '033', cleR2: 'artofpkm/223/62.webp', w: 162, h: 226, langue: 'ja', basseDefinition: true, vignette: { cleR2: 'vignettes/p.webp', w: 162, h: 226 } }] });
    B.col('images').set('artofpkm/223/62', { _id: 'artofpkm/223/62', source: 'artofpkm', set: BEG, carteId: 2, numero: '033', cleR2: 'artofpkm/223/62.webp', etat: 'ok', w: 162, wOriginal: 162, basseDefinition: true });
    B.col('cartes_produits').set('2|900', { _id: '2|900', carteId: 2, idProduct: 900, numeroFiche: '033', slugSet: BEG, slug: null });
    B.col('sets').set(BEG, { _id: BEG, tirage: 'jp', region: 'jp' });
    B.col('cartes').set(116340, { _id: 116340, nomEn: 'Oshawott', nomJa: 'ミジュマル', pv: 60, ndex: 501, categorie: 'pokemon', images: [
        { set: 'Black-White', source: 'tcgdex', numero: '27', cleR2: 'tcgdex/Black-White/27-116340.webp', w: 600, h: 825, langue: 'en', vignette: { cleR2: 'vignettes/tcgdex/27.webp', w: 200, h: 275 } },
        { set: BEG, source: 'artofpkm', numero: '011', cleR2: ANCIENNE, w: 162, h: 226, langue: 'ja', basseDefinition: true, vignette: VIGNETTE }] });
    B.col('images').set('artofpkm/223/104', { _id: 'artofpkm/223/104', source: 'artofpkm', set: BEG, carteId: 116340, numero: '011', cleR2: ANCIENNE, etat: 'ok', w: 162, wOriginal: 162, basseDefinition: true });
    for (const id of [569867, 569868]) B.col('cartes_produits').set(`116340|${id}`, { _id: `116340|${id}`, carteId: 116340, idProduct: id, numeroFiche: '011', slugSet: BEG, slug: null });
}
const HOTE = 'https://www.pokemon-card.com';
const fichePotion = `<h1 class="Heading1 mt20">キズぐすり</h1><div class="subtext Text-fjalla"><img src="/assets/images/card/regulation_logo_1/HSm.gif" class="img-regulation" alt="HSm" />&nbsp;033&nbsp;/&nbsp;037&nbsp;</div><img class="fit" src="/assets/images/card_images/large/HSm/027051_P_KIZU.jpg" /><div class="author"><h4>x</h4><a href="/x">Autre</a></div>`;
const ficheHtml = (idFiche, ext) => `<h1 class="Heading1 mt20">ミジュマル</h1><div class="subtext Text-fjalla"><img src="/assets/images/card/regulation_logo_1/HSm.gif" class="img-regulation" alt="HSm" />&nbsp;011&nbsp;/&nbsp;037&nbsp;</div><span class="hp-num">60</span><img class="fit" src="/assets/images/card_images/large/HSm/0${idFiche}_P_MIJUMARU.${ext}" /><div class="author"><h4>イラストレーター</h4><a href="/x">Masakazu Fukuda</a></div>`;
const LISTE = JSON.stringify({ result: 1, thisPage: 1, maxPage: 1, hitCnt: 3, cardList: [{ cardID: '27049', cardThumbFile: 'x', cardNameAltText: 'ミジュマル' }, { cardID: '27050', cardThumbFile: 'y', cardNameAltText: 'ミジュマル' }, { cardID: '27051', cardThumbFile: 'z', cardNameAltText: 'キズぐすり' }] });
const ligneBanc = (site, slug) => { const x = ligneTpc(site, slug); return x && slug === BEG ? { ...x, cartes: 3 } : x; };
const instantane = B => JSON.stringify([...B.cols].filter(([, m]) => m.size).map(([n, m]) => [n, [...m.values()]]));

(async () => {
    const png = await sharp({ create: { width: 600, height: 840, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
    const reseau = () => { const appels = []; return { appels, async get(url) {
        appels.push(url.replace(HOTE, ''));
        if (url.endsWith('/robots.txt')) return { status: 200, texte: '' };
        if (url.includes('/card-search/resultAPI.php')) return { status: 200, type: 'application/json', texte: LISTE };
        if (url.endsWith('/details.php/card/27049/regu/all')) return { status: 200, texte: ficheHtml('27049', 'jpg') };
        if (url.endsWith('/details.php/card/27050/regu/all')) return { status: 200, texte: ficheHtml('27050', 'gif') };
        if (url.endsWith('/details.php/card/27051/regu/all')) return { status: 200, texte: fichePotion };
        if (/card_images\/large\/HSm\/02705[01]_P_[A-Z]+\.jpg$/.test(url) || /027049_P_MIJUMARU\.jpg$/.test(url)) return { status: 200, type: 'image/png', octets: png };
        return { status: 404, texte: 'non' };
    } }; };
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async u => { vusFetch.push(String(u)); throw new Error('réseau interdit dans le banc'); };
    const verrou = () => ({ tenu: true, perdu: false, async prendre() { return null; }, async rendre() { } });
    const dl = async (B, racine, plafond, tr, seulement) => { const q = silencieux(); try { return await L.telecharger({ reelle: B.db, slug: BEG, cacheDir: racine, racineAutorisee: racine, plafond, verrou: verrou(), transport: tr, cadenceMs: 0, pourBanc: true, dossierPauses: tmp(), ligneDe: ligneBanc, seulement }); } finally { q(); } };
    const planche = async (B, racine, seulement) => { const q = silencieux(); try { return await L.planche({ reelle: B.db, slug: BEG, cacheDir: racine, racineAutorisee: racine, ligneDe: ligneBanc, seulement }); } finally { q(); } };
    const depots = [];
    const ecrire = async (B, racine, att, seulement, o = {}) => { const q = silencieux(); try { return await L.ecrire({ M: B.M, reelle: B.db, slug: BEG, cacheDir: racine, racineAutorisee: racine, attendu: att, seulement, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: () => ({ prendre: async () => null, rendre: async () => { } }), ligneDe: ligneBanc, vignetter: async (db, slug) => { for (const c of [...B.col('cartes').values()]) for (const e of c.images || []) if (e.set === slug && !e.vignette) e.vignette = { cleR2: 'v/' + e.cleR2, w: 200, h: 279 }; return { vg: {}, sets: [slug] }; }, ...o }); } finally { q(); } };
    const hors = a => a.some(u => /027051/.test(u));

    // ── 1. l'option est une liste fermée d'entiers
    verifier('parseSeulement : 569867,569868 → [569867, 569868] ; absent → null', [L.parseSeulement('569867,569868'), L.parseSeulement(undefined)], [[569867, 569868], null]);
    for (const mauvais of ['', 'abc', '1,,2', '1,1', '-5', '1.5', '0', '1;2', '1,a']) verifier('parseSeulement : « ' + mauvais + ' » refusé', /--seulement/.test((await essayer(() => L.parseSeulement(mauvais))).e || ''), true);
    verifier('une sélection avec un produit qui n\'est pas une ligne du set : refusée, nommée, ZÉRO requête', await (async () => { const B0 = fausseBase(); semerBeg(B0); const tr = reseau(); const x = await essayer(() => dl(B0, tmp(), 24, tr, [569867, 123456])); return [/123456/.test(x.e || ''), tr.appels.length]; })(), [true, 0]);

    // ── 2. SANS l'option : tout le plan (2 unités : Potion d'abord, Oshawott ensuite), comportement inchangé
    const B = fausseBase(); semerBeg(B); const racineTout = tmp(); const trTout = reseau();
    let b = await dl(B, racineTout, 7, trTout);
    verifier('sans --seulement : robots, liste, 3 fiches, 2 images (Potion puis Oshawott) = 7 requêtes, 2 prouvés', [b.etat, b.requetes, b.prouves, b.images.telechargees], ['termine', 7, 2, 2]);

    // ── 3. la situation RÉELLE : un premier passage (plafond 6) n'a pris que la Potion ; --seulement ne prend que l'Oshawott sans redemander la liste ni les fiches
    const racine = tmp(); const tr1 = reseau();
    b = await dl(B, racine, 6, tr1);
    verifier('premier passage au plafond 6 : robots, liste, 3 fiches, 1 image (la Potion, premier du plan), « plafond-atteint »', [b.etat, b.requetes, tr1.appels.filter(u => /card_images/.test(u)).map(u => u.replace(/.*\//, ''))], ['plafond-atteint', 6, ['027051_P_KIZU.jpg']]);
    const tr2 = reseau(); const avantBase = instantane(B);
    b = await dl(B, racine, 8, tr2, [569867, 569868]);
    verifier('--seulement=569867,569868 (plafond 8 = 6 + robots + 1 image) : robots relu puis L\'IMAGE D\'OSHAWOTT seule ; ni la liste ni les fiches ne se redemandent, la Potion non plus', [b.etat, b.requetes, tr2.appels.map(u => u.replace(/\?.*/, '')), hors(tr2.appels)], ['termine', 8, ['/robots.txt', '/assets/images/card_images/large/HSm/027049_P_MIJUMARU.jpg'], false]);
    verifier('   le plan écrit est restreint (1 prouvé) et porte la sélection ; rien en base', [JSON.parse(fs.readFileSync(path.join(racine, 'plan.json'), 'utf8')).plan.map(p => p.nomEn), JSON.parse(fs.readFileSync(path.join(racine, 'plan.json'), 'utf8')).seulement, instantane(B) === avantBase], [['Oshawott'], [569867, 569868], true]);

    // ── 4. planche : restreinte, mémorise la sélection
    const pl = await planche(B, racine, [569867, 569868]);
    verifier('planche --seulement : 1 image (Oshawott), la sélection est mémorisée dans planche.json', [pl.images, pl.etiquettes.map(e => e.nomNotre), JSON.parse(fs.readFileSync(path.join(racine, 'planche.json'), 'utf8')).seulement], [1, ['Oshawott'], [569867, 569868]]);
    const plTout = await planche(B, racine, null);
    verifier('planche SANS option : toutes les images en cache (2), la sélection mémorisée repasse à null', [plTout.images, JSON.parse(fs.readFileSync(path.join(racine, 'planche.json'), 'utf8')).seulement], [2, null]);
    await planche(B, racine, [569867, 569868]);

    // ── 5. écriture : la sélection doit être celle de la planche
    let r = await ecrire(B, racine, 1, undefined);
    verifier('--ecrire SANS sélection alors que la planche en portait une : REFUSÉ (code 2), aucune écriture', [r.code, r.etat, depots.length], [2, 'refuse-selection', 0]);
    r = await ecrire(B, racine, 1, [569867]);
    verifier('--ecrire avec UNE AUTRE sélection que celle de la planche : REFUSÉ (code 2)', [r.code, r.etat, depots.length], [2, 'refuse-selection', 0]);
    r = await ecrire(B, racine, 2, [569867, 569868]);
    verifier('--attendu=2 pour 1 image de la sélection : refusé avant toute écriture', [r.code, r.etat, depots.length], [2, 'refuse-attendu', 0]);
    r = await ecrire(B, racine, 1, [569867, 569868]);
    const imgs = B.col('cartes').get(116340).images, imgsPotion = B.col('cartes').get(2).images;
    verifier('--ecrire --seulement=569867,569868 --attendu=1 : « verifie », 1 joint, 1 remplacement de basse définition, 1 dépôt R2, garde ✅', [r.code, r.etat, r.joints, r.basseDefRemplacees, r.garde?.ok, depots.length], [0, 'verifie', 1, 1, true, 1]);
    verifier('   Oshawott : l\'entrée basseDefinition sort, la nôtre entre ; la Potion n\'est PAS touchée (son entrée artofpkm basseDefinition reste)', [imgs.some(e => e.cleR2 === ANCIENNE), imgs.some(e => e.source === 'pokemon-card-com'), imgsPotion.length, imgsPotion[0].cleR2], [false, true, 1, 'artofpkm/223/62.webp']);

    // ── 6. SANS l'option, l'écriture exige tout le cache (comportement inchangé) ; sans planche.json la sélection n'est pas vérifiable
    const B6 = fausseBase(); semerBeg(B6); const r6 = tmp();
    await dl(B6, r6, 7, reseau());
    r = await ecrire(B6, r6, 2, undefined);
    verifier('sans option, cache complet : --attendu=2 écrit les 2 remplacements (inchangé)', [r.code, r.etat, r.joints], [0, 'verifie', 2]);
    const B7 = fausseBase(); semerBeg(B7); const r7 = tmp();
    await dl(B7, r7, 6, reseau());
    r = await ecrire(B7, r7, 1, undefined);
    verifier('sans option, cache sans l\'image d\'Oshawott : « refuse-cache-incomplet » (inchangé)', [r.code, r.etat], [2, 'refuse-cache-incomplet']);
    r = await ecrire(B7, r7, 1, [569867, 569868]);
    verifier('avec option mais SANS planche.json : refusé (la sélection n\'a pas été vue sur une planche)', [r.code, r.etat], [2, 'refuse-selection']);

    // ── 7. la ligne de commande
    {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'collecter-tpc-set.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        const codes = [['--set=Beginning-Set', '--telecharger', '--plafond=24', '--seulement=abc'], ['--set=Beginning-Set', '--telecharger', '--plafond=24', '--seulement=1,1'], ['--set=Beginning-Set', '--planche', '--seulement='], ['--set=Beginning-Set', '--ecrire', '--attendu=1', '--seulement=x']].map(a => lancer(...a).status);
        verifier('ligne de commande : --seulement mal formé → code 2 AVANT toute connexion', codes, [2, 2, 2, 2]);
        const s = fs.readFileSync(path.join(DIR, 'collecter-tpc-set.js'), 'utf8');
        verifier('le CLI passe la sélection aux trois modes', (s.match(/seulement/g) || []).length >= 12, true);
    }
    global.fetch = fetchOrigine;
    console.log('\n' + ok + ' passés, ' + ko + ' en échec');
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });

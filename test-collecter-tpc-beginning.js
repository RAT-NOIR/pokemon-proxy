// node test-collecter-tpc-beginning.js — API-52 L5 (25/10) : le lanceur dédié TPC (collecter-tpc-set.js) pour Beginning-Set (pokemon-card.com) ; Traditional-Chinese-Products ne change PAS.
// Base EN MÉMOIRE, transport SIMULÉ, global.fetch PIÉGÉ, dossiers TEMPORAIRES, faux dépôt R2 : aucune requête, aucune base réelle, aucun dossier du testeur.
// Ce que le banc garde : le SITE se lit de la ligne de table (jamais figé) ; la liste fermée ; les deux fiches jumelles de l'Oshawott 011/037 (27049 jpg, 27050 gif) ne désignent qu'UNE impression ;
// --ecrire REMPLACE l'entrée artofpkm basseDefinition (échange 1 pour 1) ; la garde de lot voit une baisse de vignette SANS annonce et AUCUNE avec l'annonce que --planche écrit.
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
    B.col('sets').set(BEG, { _id: BEG, tirage: 'jp', region: 'jp' });
    B.col('cartes').set(116340, { _id: 116340, nomEn: 'Oshawott', nomJa: 'ミジュマル', pv: 60, ndex: 501, categorie: 'pokemon', images: [
        { set: 'Black-White', source: 'tcgdex', numero: '27', cleR2: 'tcgdex/Black-White/27-116340.webp', w: 600, h: 825, langue: 'en', vignette: { cleR2: 'vignettes/tcgdex/27.webp', w: 200, h: 275 } },
        { set: BEG, source: 'artofpkm', numero: '011', cleR2: ANCIENNE, w: 162, h: 226, langue: 'ja', basseDefinition: true, vignette: VIGNETTE }] });
    B.col('images').set('artofpkm/223/104', { _id: 'artofpkm/223/104', source: 'artofpkm', set: BEG, carteId: 116340, numero: '011', cleR2: ANCIENNE, etat: 'ok', w: 162, wOriginal: 162, basseDefinition: true });
    for (const id of [569867, 569868]) B.col('cartes_produits').set(`116340|${id}`, { _id: `116340|${id}`, carteId: 116340, idProduct: id, numeroFiche: '011', slugSet: BEG, slug: null });
}
const HOTE = 'https://www.pokemon-card.com';
const ficheHtml = (idFiche, ext) => `<h1 class="Heading1 mt20">ミジュマル</h1><div class="subtext Text-fjalla"><img src="/assets/images/card/regulation_logo_1/HSm.gif" class="img-regulation" alt="HSm" />&nbsp;011&nbsp;/&nbsp;037&nbsp;</div><span class="hp-num">60</span><img class="fit" src="/assets/images/card_images/large/HSm/0${idFiche}_P_MIJUMARU.${ext}" /><div class="author"><h4>イラストレーター</h4><a href="/x">Masakazu Fukuda</a></div>`;
const LISTE = JSON.stringify({ result: 1, thisPage: 1, maxPage: 1, hitCnt: 2, cardList: [{ cardID: '27049', cardThumbFile: 'x', cardNameAltText: 'ミジュマル' }, { cardID: '27050', cardThumbFile: 'y', cardNameAltText: 'ミジュマル' }] });
const ligneBanc = (site, slug) => { const x = ligneTpc(site, slug); return x && slug === BEG ? { ...x, cartes: 2 } : x; };
const instantane = B => JSON.stringify([...B.cols].filter(([, m]) => m.size).map(([n, m]) => [n, [...m.values()]]));

(async () => {
    const png = await sharp({ create: { width: 600, height: 840, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
    const reseau = () => { const appels = []; return { appels, async get(url) {
        appels.push(url.replace(HOTE, ''));
        if (url.endsWith('/robots.txt')) return { status: 200, texte: '' };
        if (url.includes('/card-search/resultAPI.php')) return { status: 200, type: 'application/json', texte: LISTE };
        if (url.endsWith('/details.php/card/27049/regu/all')) return { status: 200, texte: ficheHtml('27049', 'jpg') };
        if (url.endsWith('/details.php/card/27050/regu/all')) return { status: 200, texte: ficheHtml('27050', 'gif') };
        if (/card_images\/large\/HSm\/027049_P_MIJUMARU\.jpg$/.test(url)) return { status: 200, type: 'image/png', octets: png };
        return { status: 404, texte: 'non' };
    } }; };
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async u => { vusFetch.push(String(u)); throw new Error('réseau interdit dans le banc'); };
    const verrou = () => { const v = { tenu: true, perdu: false, prises: 0, rendus: 0, async prendre() { v.prises++; return null; }, async rendre() { v.rendus++; } }; return v; };
    const dl = async (B, racine, plafond, tr, slug = BEG) => { const q = silencieux(); try { return await L.telecharger({ reelle: B.db, slug, cacheDir: racine, racineAutorisee: racine, plafond, verrou: verrou(), transport: tr, cadenceMs: 0, pourBanc: true, dossierPauses: tmp(), ligneDe: ligneBanc }); } finally { q(); } };

    // ── 1. la liste fermée et le site lu de la ligne
    verifier('liste fermée : Traditional-Chinese-Products et Beginning-Set, gelée', [L.SETS_AUTORISES, Object.isFrozen(L.SETS_AUTORISES)], [[TCP, BEG], true]);
    verifier('le SITE se lit de la ligne de table : Beginning-Set = pokemon-card-com, Traditional-Chinese-Products = tpc-asie (jamais figé)', [L.siteDuSet(BEG), L.siteDuSet(TCP)], ['pokemon-card-com', 'tpc-asie']);
    verifier('le verrou global est celui du site de la ligne', [L.idVerrouDe(BEG), L.idVerrouDe(TCP)], [T.SITES['pokemon-card-com'].verrou, T.SITES['tpc-asie'].verrou]);
    verifier('un set hors liste : refusé par siteDuSet et idVerrouDe, avant toute connexion', [/hors de la liste fermée/.test((await essayer(() => L.siteDuSet('M-P-Promos'))).e || ''), /hors de la liste fermée/.test((await essayer(() => L.idVerrouDe('M-P-Promos'))).e || '')], [true, true]);
    verifier('un slug connu de la table mais hors liste (XY-Beginning-Set) : refusé', /hors de la liste fermée/.test((await essayer(() => L.siteDuSet('XY-Beginning-Set'))).e || ''), true);

    // ── 2. les deux fiches jumelles : une impression (planifierTpc), opt-in de la ligne
    const F = (id, o = {}) => ({ idFiche: id, nom: 'ミジュマル', numero: '011', denominateur: '037', pv: 60, marque: 'HSm', image: `/assets/x/${id}.jpg`, illustrateur: 'Masakazu Fukuda', categorie: 'pokemon', ...o });
    const carte = { _id: 116340, nomEn: 'Oshawott', nomJa: 'ミジュマル', pv: 60, ndex: 501, categorie: 'pokemon', images: [] };
    const trous = [{ carte, numeroFiche: '011', idProduct: 569867 }];
    let p = T.planifierTpc({ trous, fiches: [F(27049), F(27050)], code: 'HSm', site: 'pokemon-card-com' });
    verifier('sans l\'opt-in : deux fiches au même numéro → « numero-ambigu-a-la-source » (la règle de tous les autres sets ne change pas)', [p.plan.length, p.restes.map(r => r.motif)], [0, ['numero-ambigu-a-la-source']]);
    p = T.planifierTpc({ trous, fiches: [F(27049), F(27050)], code: 'HSm', site: 'pokemon-card-com', jumelles: true });
    verifier('avec l\'opt-in (fichesJumelles) : deux fiches IDENTIQUES (nom, numéro, PV, marque, illustrateur) = une impression ; la plus petite fiche (27049) ; la jumelle est nommée', [p.plan.length, p.plan[0]?.fiche.idFiche, /27050/.test(p.plan[0]?.preuve || '')], [1, 27049, true]);
    for (const [nom, autre] of [['un autre PV', { pv: 70 }], ['un autre nom', { nom: 'フシギダネ' }], ['une autre marque', { marque: 'HSn' }], ['un autre illustrateur', { illustrateur: 'Autre' }], ['un autre dénominateur', { denominateur: '050' }]]) {
        const q = T.planifierTpc({ trous, fiches: [F(27049), F(27050, autre)], code: 'HSm', site: 'pokemon-card-com', jumelles: true });
        verifier(`jumelles : ${nom} → PAS jumelles, le numéro reste ambigu`, [q.plan.length, q.restes.map(r => r.motif)], [0, ['numero-ambigu-a-la-source']]);
    }
    verifier('jumelles : trois fiches dont une seule diffère → ambigu ; l\'opt-in n\'est lu que sur la ligne (Beginning-Set seul dans la table)', [T.planifierTpc({ trous, fiches: [F(27049), F(27050), F(27051, { pv: 70 })], code: 'HSm', site: 'pokemon-card-com', jumelles: true }).plan.length, TABLE_TPC.filter(l => l.fichesJumelles === true).map(l => l.slug)], [0, [BEG]]);

    // ── 3. TÉLÉCHARGER Beginning-Set : pokemon-card.com, plafond cumulé, RIEN en base
    const B = fausseBase(); semerBeg(B); const racine = tmp(); const tr = reseau();
    const avant = instantane(B);
    let b = await dl(B, racine, 5, tr);
    verifier('Beginning-Set : robots, la liste (resultAPI pg=HSm), 2 fiches, 1 image (les jumelles ne font qu\'UNE image) = 5 requêtes sur www.pokemon-card.com, « termine »', [b.etat, tr.appels.map(u => u.replace(/\?.*/, '')), b.requetes, b.images], ['termine', ['/robots.txt', '/card-search/resultAPI.php', '/card-search/details.php/card/27049/regu/all', '/card-search/details.php/card/27050/regu/all', '/assets/images/card_images/large/HSm/027049_P_MIJUMARU.jpg'], 5, { telechargees: 1, enCache: 0, absentes: 0 }]);
    verifier('   la liste demandée porte pg=HSm ; AUCUNE écriture en base, base identique', [/pg=HSm/.test(tr.appels[1]), B.ecritures.length, instantane(B) === avant], [true, 0, true]);
    const tr2 = reseau(); const B2 = fausseBase(); semerBeg(B2);
    b = await dl(B2, tmp(), 4, tr2);
    verifier('plafond 4 : la 5e requête (l\'image) n\'est JAMAIS envoyée → « plafond-atteint »', [b.etat, tr2.appels.length], ['plafond-atteint', 4]);

    // ── 4. PLANCHE : zéro requête, et l'ANNONCE de la baisse de vignette (remplacement 1 pour 1)
    const nAppels = tr.appels.length;
    const sortie = path.join(racine, 'planche.png');
    let pl; { const q = silencieux(); try { pl = await L.planche({ reelle: B.db, slug: BEG, cacheDir: racine, racineAutorisee: racine, sortie, ligneDe: ligneBanc }); } finally { q(); } }
    verifier('planche : 1 image prouvée et en cache, PNG écrit, ZÉRO requête', [pl.images, fs.existsSync(pl.sortie), tr.appels.length === nAppels, vusFetch.length, B.ecritures.length], [1, true, true, 0, 0]);
    const fAnnonce = path.join(racine, 'annonce.json');
    const annonce = fs.existsSync(fAnnonce) ? JSON.parse(fs.readFileSync(fAnnonce, 'utf8')) : null;
    verifier('planche : l\'annonce du remplacement est VIDE (l\'échange est 1 pour 1 et les vignettes sont refaites dans le même passage : la garde ne verra aucune baisse) — aucun annonce.json', [annonce, Object.keys(pl.annonce)], [null, []]);

    // ── 5. ÉCRIRE : remplacement 1 pour 1, la garde de lot
    const depots = [];
    const etatGarde = BB => ({ cartes: [...BB.col('cartes').values()], cartesProduits: [...BB.col('cartes_produits').values()] });
    const gAvant = GL.compterEtat(etatGarde(B));
    const vignetter = async (db, slug) => { for (const c of [...B.col('cartes').values()]) for (const e of c.images) if (e.set === slug && !e.vignette) e.vignette = { cleR2: `vignettes/${e.cleR2}`, w: 200, h: 279 }; return { vg: {}, sets: [slug] }; };
    const sansVignette = { n: 0 }; void sansVignette;
    const ec = async (att, o = {}) => { const q = silencieux(); try { return await L.ecrire({ M: B.M, reelle: B.db, slug: BEG, cacheDir: racine, racineAutorisee: racine, attendu: att, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: () => ({ prendre: async () => null, rendre: async () => { } }), ligneDe: ligneBanc, ...o }); } finally { q(); } };
    let r = await ec(2);
    verifier('--attendu=2 pour 1 image à joindre : REFUSÉ avant toute écriture', [r.code, r.etat, depots.length], [2, 'refuse-attendu', 0]);
    r = await ec(1, { vignetter });
    verifier('--attendu=1 : écrit, « verifie », joints 1, basseDefRemplacees 1, garde ✅, 1 dépôt R2, ZÉRO requête', [r.code, r.etat, r.joints, r.basseDefRemplacees, r.garde?.ok, depots.length, vusFetch.length], [0, 'verifie', 1, 1, true, 1, 0]);
    const imgs = B.col('cartes').get(116340).images;
    verifier('l\'entrée artofpkm basseDefinition est SORTIE, la nôtre entre au même (set, numéro) ; l\'autre source (tcgdex) intacte ; l\'ancien document est « remplace »', [imgs.some(e => e.cleR2 === ANCIENNE), imgs.filter(e => e.source === 'pokemon-card-com' && e.set === BEG && e.numero === '011').length, imgs.some(e => e.source === 'tcgdex'), imgs.length, B.col('images').get('artofpkm/223/104').etat], [false, 1, true, 2, 'remplace']);
    verifier('les vignettes sont refaites APRÈS le remplacement (le vignetteur est appelé), l\'entrée neuve en porte une', [imgs.filter(e => e.set === BEG).every(e => !!e.vignette)], [true]);
    const gApres = GL.compterEtat(etatGarde(B));
    const cmp = GL.comparer(gAvant, gApres);
    verifier('garde de lot, vignettes refaites : 0 baisse (l\'entrée sortie et la nôtre, même set, même numéro, 1 pour 1), hausses = la vignette neuve', [cmp.baisses.length, cmp.nonAutorisees.length, cmp.baisses.some(x => x.compteur === 'images')], [0, 0, false]);
    // sans le vignetteur (l\'état juste après collecterSet) : la garde verrait « vignettes-set » baisser — c\'est pourquoi ecrire() appelle le vignetteur dès qu\'un remplacement a eu lieu
    {
        const B3 = fausseBase(); semerBeg(B3); const g3 = GL.compterEtat(etatGarde(B3));
        await (async () => { const q = silencieux(); try { return await L.ecrire({ M: B3.M, reelle: B3.db, slug: BEG, cacheDir: racine, racineAutorisee: racine, attendu: 1, deposer: async () => { }, fabriquerVerrouSet: () => ({ prendre: async () => null, rendre: async () => { } }), ligneDe: ligneBanc }); } finally { q(); } })();
        const c3 = GL.comparer(g3, GL.compterEtat(etatGarde(B3)));
        verifier('SANS vignetteur : une baisse de vignettes-set non autorisée (preuve que l\'appel est nécessaire)', c3.nonAutorisees.map(x => x.compteur), ['vignettes-set']);
    }
    verifier('annonce : annonceRemplacement rend { clé: baisse } quand les vignettes NE sont PAS refaites par un rejeu (une entrée remplacée qui garde son compte d\'images) — pur, rien d\'écrit', typeof L.annonceRemplacement, 'function');

    r = await ec(0, { vignetter });
    verifier('rejeu après écriture : aucune entrée en double (2 entrées, une seule du set)', [B.col('cartes').get(116340).images.length, B.col('cartes').get(116340).images.filter(e => e.set === BEG).length], [2, 1]);

    // ── 6. Traditional-Chinese-Products ne change PAS : tpc-asie, aucun vignetteur appelé hors remplacement
    {
        const Bt = fausseBase(); const SL = TCP;
        Bt.col('sets').set(SL, { _id: SL, tirage: 'zh-hant', region: 'intl' });
        const tx = await essayer(() => L.telecharger({ reelle: Bt.db, slug: SL, cacheDir: tmp(), racineAutorisee: tmp(), plafond: 5, verrou: verrou(), transport: reseau(), cadenceMs: 0, pourBanc: true, ligneDe: ligneBanc }));
        verifier('Traditional-Chinese-Products : toujours lu comme tpc-asie (cadre refuse un cache hors racine ; aucun produit joint → refus propre, ZÉRO requête)', [/hors de|aucun produit/.test(tx.e || '')], [true]);
        verifier('SITE par défaut du module : ligneDe(\'tpc-asie\', slug) reste celle de Traditional-Chinese-Products', [ligneBanc('tpc-asie', TCP)?.code, ligneBanc('tpc-asie', TCP)?.site], ['PKMTCH', 'tpc-asie']);
    }
    // ── 7. la ligne de commande
    {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'collecter-tpc-set.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        const codes = [['--set=M-P-Promos', '--telecharger', '--plafond=10'], ['--set=Beginning-Set', '--telecharger'], ['--set=Beginning-Set', '--planche', '--plafond=10'], ['--set=Beginning-Set', '--ecrire']].map(a => lancer(...a).status);
        verifier('ligne de commande : set hors liste, --plafond manquant ou mal placé, --attendu manquant → code 2 AVANT toute connexion', codes, [2, 2, 2, 2]);
        const src = fs.readFileSync(path.join(DIR, 'collecter-tpc-set.js'), 'utf8');
        verifier('le CLI lit le verrou global de la ligne (idVerrouDe), pas un site figé', [/id: L\.idVerrouDe\(slug\)|id: idVerrouDe\(slug\)/.test(src), /const SITE = 'tpc-asie'/.test(src)], [true, false]);
    }
    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });

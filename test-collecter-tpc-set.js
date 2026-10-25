// node test-collecter-tpc-set.js — le LANCEUR DÉDIÉ TPC (collecter-tpc-set.js) : trois modes séparés, un set de la liste fermée, un plafond CODÉ et cumulé.
// Base EN MÉMOIRE, transport SIMULÉ, global.fetch PIÉGÉ, dossiers TEMPORAIRES, aucun R2 (faux dépôt) : aucune requête, aucune base réelle, aucun dossier du testeur.
// Ce que le banc garde : la liste fermée ; --telecharger n'écrit RIEN en base (espion sur chaque écriture) et son plafond MORD (la requête n° plafond+1 n'est jamais envoyée, le cumul survit à la
// relance) ; --planche et --ecrire font ZÉRO requête ; --ecrire compare --attendu AVANT d'écrire, refuse un cache incomplet, et passe par `collecterSet` (sansRemplacement, lot, retirable, urlOriginal).
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
process.chdir(DIR);
require(path.join(DIR, 'bancs-dossier-arrets'));
const sharp = require('sharp');
const T = require(path.join(DIR, 'collecte-cartes', 'tpc'));
const { ligneTpc } = require(path.join(DIR, 'collecte-cartes', 'tpc-sets'));
const L = require(path.join(DIR, 'collecter-tpc-set.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const F = f => fs.readFileSync(path.join(DIR, 'collecte-cartes', 'tpc-fixtures', f), 'utf8');
const silencieux = () => { if (process.env.BANC_BAVARD) return () => { }; const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };
const essayer = async f => { try { return { r: await f() }; } catch (e) { return { e: String(e.message) }; } };

function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : false) : lire(d, k) === v);
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

const SLUG = 'Traditional-Chinese-Products';
function semer(B) {
    B.col('sets').set(SLUG, { _id: SLUG, tirage: 'zh-hant', region: 'intl' });
    B.col('cartes').set(1, { _id: 1, nomEn: 'Spidops', categorie: 'pokemon', ndex: 918, pv: 120, images: [{ set: 'Autre-Set', source: 'tcgdex', numero: '5', cleR2: 'tcgdex/x.webp' }] });
    B.col('cartes').set(3, { _id: 3, nomEn: 'Spidops', categorie: 'pokemon', ndex: 918, pv: 120, images: [] });
    B.col('cartes').set(2, { _id: 2, nomEn: 'Pikachu', categorie: 'pokemon', images: [] });
    B.col('cartes').set(4, { _id: 4, nomEn: 'Mew', categorie: 'pokemon', images: [] });
    const l = (c, id, nf, slug) => B.col('cartes_produits').set(`${c}|${id}`, { _id: `${c}|${id}`, carteId: c, idProduct: id, numeroFiche: nf, slugSet: SLUG, slug });
    l(1, 10, 'SV-P001', 'Spidops-SV-P001'); l(3, 12, 'S-P162', 'Spidops-PKMTCHS-P-162'); l(2, 11, 'SV-P002', 'Pikachu-SV-P002'); l(4, 13, null, 'Mew-PKMTCH231');
}
const LISTE_SVP = F('asie-id-liste-SV-P-page1.html').replace(/class="resultNumber">251</, 'class="resultNumber">1<').replace(/Total 13 halaman/, 'Total 1 halaman')
    .replace(/<li class="card">\s*<a href="\/id\/card-search\/detail\/71(2[6-9]|3\d|4[0-4])\/">[\s\S]*?<\/li>/g, '');
const LISTE_SP = LISTE_SVP.replace(/7125/g, '7126');
const FICHE_SVP = F('asie-id-fiche-7125.html');
const FICHE_SP = FICHE_SVP.replace(/id00007125/g, 'id00007126').replace('001/SV-P', '162/S-P');
const instantane = B => JSON.stringify([...B.cols].filter(([, m]) => m.size).map(([n, m]) => [n, [...m.values()]]));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tpcset-'));
const ligneBanc = (site, slug) => { const x = ligneTpc(site, slug); return x && { ...x, cartes: 2, listes: [{ prefixe: 'SV-P', code: 'SV-P', cartes: 1 }, { prefixe: 'S-P', code: 'S-P', cartes: 1 }] }; };

(async () => {
    const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
    const reseau = () => { const appels = []; return { appels, async get(url) {
        appels.push(url.replace('https://asia.pokemon-card.com', ''));
        if (url.endsWith('/robots.txt')) return { status: 200, texte: '' };
        if (url.includes('/card-search/list/')) return { status: 200, texte: url.includes('expansionCodes=S-P') ? LISTE_SP : LISTE_SVP };
        if (url.endsWith('/card-search/detail/7125/')) return { status: 200, texte: FICHE_SVP };
        if (url.endsWith('/card-search/detail/7126/')) return { status: 200, texte: FICHE_SP };
        if (/card-img\/id0000712[56]\.png$/.test(url)) return { status: 200, type: 'image/png', octets: png };
        return { status: 404, texte: 'non' };
    } }; };
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async u => { vusFetch.push(String(u)); throw new Error('réseau interdit dans le banc'); };
    const verrou = () => { const v = { tenu: true, perdu: false, prises: 0, rendus: 0, async prendre() { v.prises++; return null; }, async rendre() { v.rendus++; } }; return v; };
    const dossierPauses = () => tmp();
    const dl = async (B, racine, plafond, tr, o = {}) => { const q = silencieux(); try { return await L.telecharger({ reelle: B.db, slug: SLUG, cacheDir: racine, racineAutorisee: racine, plafond, verrou: o.verrou || verrou(), transport: tr, cadenceMs: 0, pourBanc: true, dossierPauses: dossierPauses(), ligneDe: ligneBanc }); } finally { q(); } };

    // ── 1. la liste fermée et les chemins ──
    verifier('liste fermée : Traditional-Chinese-Products et Beginning-Set (API-52 L5), gelée', [L.SETS_AUTORISES, Object.isFrozen(L.SETS_AUTORISES)], [[SLUG, 'Beginning-Set'], true]);
    const B0 = fausseBase(); semer(B0); const tr0 = reseau(); const racine0 = tmp();
    let x = await essayer(() => L.telecharger({ reelle: B0.db, slug: 'M-P-Traditional-Chinese-Promos', cacheDir: racine0, racineAutorisee: racine0, plafond: 10, verrou: verrou(), transport: tr0, cadenceMs: 0, pourBanc: true, ligneDe: ligneBanc }));
    verifier('un set hors liste : refusé, ZÉRO requête, rien d\'écrit', [/hors de la liste fermée/.test(x.e || ''), tr0.appels.length, B0.ecritures.length], [true, 0, 0]);
    x = await essayer(() => L.telecharger({ reelle: B0.db, slug: SLUG, cacheDir: path.join(os.tmpdir(), 'ailleurs'), racineAutorisee: racine0, plafond: 10, verrou: verrou(), transport: tr0, cadenceMs: 0, pourBanc: true, ligneDe: ligneBanc }));
    verifier('un cache hors de la racine autorisée : refusé avant toute requête', [/hors de/.test(x.e || ''), tr0.appels.length], [true, 0]);
    verifier('un dossier d\'apports manuels : refusé, même sous une racine', [/apports manuels/.test((await essayer(() => L.verifierChemin('C:/x/Logo FR/a', 'C:/x'))).e || ''), /apports manuels/.test((await essayer(() => L.verifierChemin('C:/x/apport-manuel', 'C:/x'))).e || '')], [true, true]);
    for (const p of [0, -1, 461, 1.5, NaN, undefined]) {
        x = await essayer(() => L.telecharger({ reelle: B0.db, slug: SLUG, cacheDir: racine0, racineAutorisee: racine0, plafond: p, verrou: verrou(), transport: tr0, cadenceMs: 0, pourBanc: true, ligneDe: ligneBanc }));
        verifier(`--plafond=${p} : refusé (entier de 1 à ${L.PLAFOND_MAX}), zéro requête`, [/plafond/.test(x.e || ''), tr0.appels.length], [true, 0]);
    }
    x = await essayer(() => L.telecharger({ reelle: B0.db, slug: SLUG, cacheDir: racine0, racineAutorisee: racine0, plafond: 10, verrou: verrou(), transport: tr0, cadenceMs: 9999, ligneDe: ligneBanc }));
    verifier('une cadence sous 10 s : refusée hors banc', [/jamais en dessous/.test(x.e || ''), tr0.appels.length], [true, 0]);
    const BX = fausseBase(); semer(BX); for (const l of BX.col('cartes_produits').values()) l.numeroFiche = null;
    x = await essayer(() => L.telecharger({ reelle: BX.db, slug: SLUG, cacheDir: racine0, racineAutorisee: racine0, plafond: 10, verrou: verrou(), transport: tr0, cadenceMs: 0, pourBanc: true, ligneDe: ligneBanc }));
    verifier('aucune ligne numérotée : refusé avant toute requête (écrire les numeroFiche d\'abord)', [/numeroFiche/.test(x.e || ''), tr0.appels.length], [true, 0]);

    // ── 2. le client : la requête n° plafond+1 n'est JAMAIS envoyée ──
    {
        const t = reseau();
        const cl = T.fabriquerClientTpc({ site: 'tpc-asie', transport: t, cadenceMs: 0, reessaiMs: 0, verrou: { tenu: true, perdu: false }, plafond: 3, dossierPauses: dossierPauses() });
        await cl.page('/tw/card-search/detail/7125/'); await cl.page('/tw/card-search/detail/7125/');          // robots + 2 pages = 3 requêtes
        const e = await essayer(() => cl.page('/tw/card-search/detail/7126/'));
        verifier('client : plafond 3 → robots + 2 pages passent, la 4e est refusée AVANT d\'être envoyée (transport : 3 appels)', [t.appels.length, cl.compteRequetes(), /plafond de 3/.test(e.e || '')], [3, 3, true]);
        const t2 = reseau();
        const cl2 = T.fabriquerClientTpc({ site: 'tpc-asie', transport: t2, cadenceMs: 0, reessaiMs: 0, verrou: { tenu: true, perdu: false }, plafond: 10, compteInitial: 10, dossierPauses: dossierPauses() });
        const e2 = await essayer(() => cl2.page('/tw/card-search/detail/7125/'));
        verifier('client : un cumul déjà au plafond (compteInitial = plafond) → aucune requête, pas même robots.txt', [t2.appels.length, /plafond de 10/.test(e2.e || '')], [0, true]);
        verifier('client : sans plafond, rien ne change', (() => { try { T.fabriquerClientTpc({ site: 'tpc-asie', verrou: { tenu: true }, plafond: 0 }); return 'accepté'; } catch (er) { return /plafond/.test(er.message) ? 'refusé' : er.message; } })(), 'refusé');
    }

    // ── 3. TÉLÉCHARGER : cache disque, plafond cumulé, RIEN en base ──
    const B = fausseBase(); semer(B); const racine = tmp(); const tr = reseau(); const v1 = verrou();
    const avant = instantane(B);
    let b = await dl(B, racine, 5, tr, { verrou: v1 });
    verifier('plafond 5 : robots, 2 listes, 2 fiches = 5 requêtes, la 6e (la 1re image) est REFUSÉE → « plafond-atteint », transport : 5 appels', [b.etat, tr.appels, b.requetes], ['plafond-atteint', ['/robots.txt', '/tw/card-search/list/?expansionCodes=SV-P', '/tw/card-search/list/?expansionCodes=S-P', '/tw/card-search/detail/7125/', '/tw/card-search/detail/7126/'], 5]);
    verifier('   le cumul est écrit sur le cache disque', JSON.parse(fs.readFileSync(path.join(racine, 'compteur.json'), 'utf8')).requetes, 5);
    verifier('   AUCUNE écriture en base (espion), base identique, verrou global pris puis rendu', [B.ecritures.length, instantane(B) === avant, v1.prises, v1.rendus], [0, true, 1, 1]);
    verifier('   les listes et les fiches sont dans le cache disque, pas dans tpc_fiches', [fs.existsSync(path.join(racine, 'etat-local.json')), B.col('tpc_fiches').size, Object.keys(JSON.parse(fs.readFileSync(path.join(racine, 'etat-local.json'), 'utf8')).tpc_fiches || {}).length], [true, 0, 2]);
    const tr2 = reseau();
    b = await dl(B, racine, 5, tr2);
    verifier('relance au même plafond : le cumul survit, ZÉRO requête envoyée (pas même robots.txt), « plafond-atteint »', [b.etat, tr2.appels.length, b.requetes, b.compteInitial], ['plafond-atteint', 0, 5, 5]);
    const tr3 = reseau();
    b = await dl(B, racine, 8, tr3);
    verifier('relance à 8 : robots relu (6), puis 2 images (7 et 8) → « termine », cumul 8, 2 images en cache', [b.etat, tr3.appels, b.requetes, b.images], ['termine', ['/robots.txt', '/id/card-img/id00007125.png', '/id/card-img/id00007126.png'], 8, { telechargees: 2, enCache: 0, absentes: 0 }]);
    verifier('   toujours AUCUNE écriture en base', [B.ecritures.length, instantane(B) === avant], [0, true]);
    const plan = JSON.parse(fs.readFileSync(path.join(racine, 'plan.json'), 'utf8'));
    verifier('   le plan écrit : 2 prouvés (SV-P001 et S-P162, chacun dans SA liste), 1 absent de la source, 1 sans numéro', [plan.plan.map(p => p.numero).sort(), plan.restes.map(r => `${r.numero}:${r.motif}`)], [['S-P162', 'SV-P001'], ['SV-P002:absente-de-la-source', 'null:sans-numero']]);
    const tr4 = reseau();
    b = await dl(B, racine, 8, tr4);
    verifier('relance complète au plafond : plus rien à demander, 2 images déjà en cache, 0 requête de plus ne part que si on la doit', [b.images.enCache, b.images.telechargees], [2, 0]);

    // un plantage au milieu : le cumul est DÉJÀ sur le disque (écrit à chaque requête, pas seulement à la fin)
    {
        const Bc = fausseBase(); semer(Bc); const rc = tmp(); let n = 0;
        const planteur = { appels: [], async get(url) { n++; if (n === 3) throw new Error('boom'); return reseau().get(url); } };
        const e = await essayer(() => dl(Bc, rc, 50, planteur));
        verifier('un plantage au milieu : le cumul de 3 requêtes (robots, liste, la requête qui a planté) est déjà sur le disque', [/boom|ERR/.test(e.e || ''), JSON.parse(fs.readFileSync(path.join(rc, 'compteur.json'), 'utf8')).requetes], [true, 3]);
    }

    // ── 3 bis. correction 1 de la relecture L3b : le compteur se lit de façon SÛRE ──
    {
        const Bk = fausseBase(); semer(Bk);
        for (const [nom, contenu] of [['JSON tronqué', '{"requetes":'], ['requetes en texte', '{"requetes":"12"}'], ['requetes négatif', '{"requetes":-1}'], ['requetes décimal', '{"requetes":1.5}'], ['un tableau', '[]'], ['objet vide', '{}'], ['vide', '']]) {
            const rk = tmp(); fs.writeFileSync(path.join(rk, 'compteur.json'), contenu);
            const trk = reseau(); const vk = verrou();
            const e = await essayer(() => dl(Bk, rk, 460, trk, { verrou: vk }));
            verifier(`compteur illisible (${nom}) : REFUS de partir, le message nomme le fichier, ZÉRO requête, verrou rendu, compteur laissé tel quel`, [/compteur\.json/.test(e.e || ''), trk.appels.length, vk.rendus, fs.readFileSync(path.join(rk, 'compteur.json'), 'utf8') === contenu], [true, 0, vk.prises, true]);
        }
        {   // une erreur de lecture AUTRE qu'une absence (ici : compteur.json est un dossier) n'est pas un « 0 »
            const rd = tmp(); fs.mkdirSync(path.join(rd, 'compteur.json')); const trd = reseau();
            const e = await essayer(() => dl(Bk, rd, 460, trd));
            verifier('compteur illisible pour une AUTRE raison que l\'absence (EISDIR) : REFUS à la LECTURE (« illisible », il nomme le fichier), ZÉRO requête', [/compteur\.json illisible/.test(e.e || ''), trd.appels.length], [true, 0]);
        }
        const ra = tmp(); const tra = reseau();
        const ba = await dl(Bk, ra, 460, tra);
        verifier('compteur ABSENT (premier passage) : on part de 0', [ba.compteInitial, ba.etat], [0, 'termine']);
        verifier('   aucun fichier temporaire ne reste à côté du compteur', fs.readdirSync(ra).filter(n => /compteur/.test(n)), ['compteur.json']);
        // écriture ATOMIQUE : chaque mise à jour du compteur passe par un fichier temporaire puis un renommage
        const renommages = [], renOrigine = fs.renameSync, ecrOrigine = fs.writeFileSync, ecrits = [];
        fs.renameSync = (a, c) => { renommages.push([path.basename(a), path.basename(c)]); return renOrigine(a, c); };
        fs.writeFileSync = (f, ...r) => { ecrits.push(path.basename(String(f))); return ecrOrigine(f, ...r); };
        const rb = tmp(); let bb;
        try { bb = await dl(Bk, rb, 460, reseau()); } finally { fs.renameSync = renOrigine; fs.writeFileSync = ecrOrigine; }
        verifier('compteur.json n\'est JAMAIS écrit en place : seulement par renommage d\'un fichier temporaire', [ecrits.includes('compteur.json'), renommages.filter(r => r[1] === 'compteur.json').length >= bb.requetes, renommages.filter(r => r[1] === 'compteur.json').every(r => r[0] !== 'compteur.json' && /compteur/.test(r[0]))], [false, true, true]);
    }
    // 3 ter. lire le cumul APRÈS la prise du verrou (un lancement qui attendait ne part pas d'un cumul périmé)
    {
        const Bv = fausseBase(); semer(Bv); const rv = tmp(); const trv = reseau();
        const vv = verrou(); vv.prendre = async () => { fs.writeFileSync(path.join(rv, 'compteur.json'), JSON.stringify({ requetes: 7 })); return null; };   // « A » finit pendant l'attente et laisse 7
        const bv = await dl(Bv, rv, 8, trv, { verrou: vv });
        verifier('cumul lu APRÈS la prise du verrou : 7 repris, robots = 8e, la liste (9e) est refusée', [bv.compteInitial, bv.etat, trv.appels], [7, 'plafond-atteint', ['/robots.txt']]);
    }
    // ── 3 quater. correction 2 : un blocage de PAGE tient d'une relance à l'autre (la règle commune reponse-hote : ARRET-HOTE, lu par garderHote) ──
    {
        const RH = require(path.join(DIR, 'collecte-cartes', 'reponse-hote'));
        for (const [nom, statut, corps] of [['403', 403, 'Forbidden'], ['429', 429, 'Too many'], ['401', 401, 'no'], ['410', 410, 'gone'], ['défi', 200, '<title>Just a moment...</title>']]) {
            const Bz = fausseBase(); semer(Bz); const rz = tmp(); const dpz = tmp();
            const bloquant = { appels: [], async get(url) { this.appels.push(url); if (url.endsWith('/robots.txt')) return { status: 200, texte: '' }; return { status: statut, type: 'text/html', texte: corps }; } };
            const q2 = silencieux(); let b1; try { b1 = await L.telecharger({ reelle: Bz.db, slug: SLUG, cacheDir: rz, racineAutorisee: rz, plafond: 50, verrou: verrou(), transport: bloquant, cadenceMs: 0, pourBanc: true, dossierPauses: dpz, ligneDe: ligneBanc }); } finally { q2(); }
            const fichierArret = RH.fichierArret(dpz, 'asia.pokemon-card.com');
            verifier(`page en ${nom} : « bloque », l'arrêt DURABLE est écrit dans le dossier des arrêts (injecté, jamais le vrai), après 2 requêtes (robots, liste)`, [b1.etat, fs.existsSync(fichierArret), bloquant.appels.length], ['bloque', true, 2]);
            fs.writeFileSync(fichierArret, JSON.stringify({ ...JSON.parse(fs.readFileSync(fichierArret, 'utf8')), marqueur: 'intact' }));   // si la relance le réécrit, le marqueur disparaît
            const t2 = reseau(); const q3 = silencieux(); let b2; try { b2 = await L.telecharger({ reelle: Bz.db, slug: SLUG, cacheDir: rz, racineAutorisee: rz, plafond: 50, verrou: verrou(), transport: t2, cadenceMs: 0, pourBanc: true, dossierPauses: dpz, ligneDe: ligneBanc }); } finally { q3(); }
            verifier(`   relance après ${nom} : ZÉRO requête (pas même robots.txt), « bloque », l'arrêt n'est pas réécrit`, [b2.etat, t2.appels.length, JSON.parse(fs.readFileSync(fichierArret, 'utf8')).marqueur], ['bloque', 0, 'intact']);
        }
        // le vrai dossier des arrêts n'est jamais touché par le banc
        verifier('le banc écrit ses arrêts dans un dossier temporaire (ARRETS_HOTES_DOSSIER), jamais dans le vrai', [RH.DOSSIER_PAUSES.startsWith(os.tmpdir()), /arrets-hotes$/.test(RH.DOSSIER_PAUSES) && !RH.DOSSIER_PAUSES.startsWith(os.tmpdir())], [true, false]);
    }

    // ── 4. PLANCHE : zéro requête ──
    const nAppels = tr.appels.length + tr2.appels.length + tr3.appels.length + tr4.appels.length;
    const q = silencieux(); let pl; try { pl = await L.planche({ reelle: B.db, slug: SLUG, cacheDir: racine, racineAutorisee: racine, ligneDe: ligneBanc }); } finally { q(); }
    verifier('planche : 2 images, étiquetées (slug Cardmarket, numeroFiche, notre fiche, fiche TPC, liste), PNG écrit', [pl.images, pl.etiquettes.map(e => [e.slugCardmarket, e.numeroFiche, e.nomNotre, e.nomTpc, e.liste]).sort(), fs.existsSync(pl.sortie)], [2, [['Spidops-PKMTCHS-P-162', 'S-P162', 'Spidops', 'Spidops', 'S-P'], ['Spidops-SV-P001', 'SV-P001', 'Spidops', 'Spidops', 'SV-P']], true]);
    verifier('planche : ZÉRO requête (transport, global.fetch) et aucune écriture en base', [tr.appels.length + tr2.appels.length + tr3.appels.length + tr4.appels.length === nAppels, vusFetch.length, B.ecritures.length], [true, 0, 0]);
    x = await essayer(() => L.planche({ reelle: B.db, slug: SLUG, cacheDir: racine, racineAutorisee: racine, sortie: path.join(os.tmpdir(), 'hors', 'p.png'), ligneDe: ligneBanc }));
    verifier('planche : une sortie hors de la racine est refusée', /hors de/.test(x.e || ''), true);

    // ── 5. ÉCRIRE : depuis le cache, zéro requête ──
    const depots = [];
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const ec = async (BB, rc, att, o = {}) => { const qq = silencieux(); try { return await L.ecrire({ M: BB.M, reelle: BB.db, slug: SLUG, cacheDir: rc, racineAutorisee: rc, attendu: att, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: verrouSet, ligneDe: ligneBanc, ...o }); } finally { qq(); } };
    const ecritAvant = B.ecritures.length;
    let r = await ec(B, racine, 3);
    verifier('--attendu=3 pour 2 images à joindre : REFUSÉ avant toute écriture (aucun dépôt, aucune écriture)', [r.code, r.etat, r.reel, depots.length, B.ecritures.length - ecritAvant], [2, 'refuse-attendu', 2, 0, 0]);
    x = await essayer(() => L.ecrire({ M: B.M, reelle: B.db, slug: SLUG, cacheDir: racine, racineAutorisee: racine, deposer: async () => { }, ligneDe: ligneBanc }));
    verifier('--ecrire sans --attendu : refuse', /attendu/.test(x.e || ''), true);
    const vide = tmp(); fs.copyFileSync(path.join(racine, 'etat-local.json'), path.join(vide, 'etat-local.json'));
    r = await ec(B, vide, 2);
    verifier('un cache SANS les images : refusé (« télécharger d\'abord »), rien d\'écrit', [r.code, r.etat, depots.length, B.ecritures.length - ecritAvant], [2, 'refuse-cache-incomplet', 0, 0]);
    r = await ec(B, racine, 2);
    verifier('--attendu=2 : écrit, « verifie », code 0, 2 dépôts R2, ZÉRO requête', [r.code, r.etat, r.joints, depots.length, vusFetch.length], [0, 'verifie', 2, 2, 0]);
    const e1 = B.col('cartes').get(1).images.find(e => e.source === 'tpc-asie'), e3 = B.col('cartes').get(3).images.find(e => e.source === 'tpc-asie');
    verifier('les entrées : set, numéro de NOTRE ligne, lot neutre, mention, retirable, urlOriginal ; l\'autre source INTACTE', [e1?.set, e1?.numero, e1?.lot, e1?.retirable, /card-img\/id00007125\.png$/.test(e1?.urlOriginal || ''), e3?.numero, B.col('cartes').get(1).images.some(e => e.source === 'tcgdex')], [SLUG, 'SV-P001', 'tpc-2026-10', true, true, 'S-P162', true]);
    verifier('tpc_fiches N\'EST PAS écrit en base (les fiches se relisent du cache) ; le bilan du set est écrit', [B.col('tpc_fiches').size, B.col('sets').get(SLUG).visuelsTpc?.['tpc-asie']?.prouves], [0, 2]);
    verifier('le client « disque » refuse toute page : aucune requête n\'a été tentée', vusFetch.length, 0);
    const cd = L.clientDisque(racine, {});
    verifier('client disque : une page ou une image hors cache lève (aucun réseau)', [(await essayer(() => cd.page('/x'))).e?.includes('hors cache'), (await essayer(() => cd.image('https://x/y.png'))).e?.includes('hors cache')], [true, true]);

    // ── 5 bis. une image prouvée SOUS LE SEUIL n'est jamais écartée en silence : une ligne de journal par image, unité + taille + seuil ──
    {
        const petit = await sharp({ create: { width: 162, height: 226, channels: 3, background: { r: 10, g: 90, b: 200 } } }).png().toBuffer();
        const rp = tmp();
        fs.cpSync(racine, rp, { recursive: true });
        const imgs = path.join(rp, fs.readdirSync(rp).find(n => fs.existsSync(path.join(rp, n, 'images'))) || '.', 'images');
        const cible = fs.existsSync(imgs) ? imgs : path.join(rp, 'images');
        for (const n of fs.readdirSync(cible).filter(n => !/\.json$/i.test(n))) fs.writeFileSync(path.join(cible, n), petit);
        const lignes = [];
        const depAvant = depots.length;
        const Bp = fausseBase(); semer(Bp);   // base neuve : celle du cas précédent a déjà reçu les 2 jointures
        const rr = await ec(Bp, rp, 2,{ log: m => lignes.push(String(m)) });
        const ecartees =lignes.filter(l => /sous le seuil/.test(l) && /162×226/.test(l));
        verifier('image prouvée sous le seuil : refus --attendu, ZÉRO dépôt, annonce « sous le seuil 2 »', [rr.code, rr.etat, rr.reel, rr.sousLeSeuil?.length, depots.length - depAvant, lignes.some(l => /prouvées 2, sous le seuil 2/.test(l))], [2, 'refuse-attendu', 0, 2, 0, true]);
        verifier('image sous le seuil : UNE ligne de journal par image (numéro, taille 162×226, seuil)', [ecartees.length, ecartees.some(l => /SV-P001/.test(l)), ecartees.some(l => /S-P162/.test(l)), ecartees.every(l => /seuil \d+/.test(l))], [2, true, true, true]);
    }

    // ── 6. la ligne de commande : écrite par ce qu'elle autorise ──
    {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'collecter-tpc-set.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        const codes = [[], ['--bidon'], ['--set=Traditional-Chinese-Products'], ['--set=M-P-Traditional-Chinese-Promos', '--telecharger', '--plafond=10'], ['--set=Traditional-Chinese-Products', '--telecharger'],
            ['--set=Traditional-Chinese-Products', '--telecharger', '--planche', '--plafond=10'], ['--set=Traditional-Chinese-Products', '--ecrire'], ['--set=Traditional-Chinese-Products', '--planche', '--plafond=10'], ['--set=Traditional-Chinese-Products', '--telecharger', '--plafond=10', '--attendu=3']].map(a => lancer(...a).status);
        verifier('ligne de commande : sans mode, argument inconnu, set hors liste, mode double, --plafond/--attendu mal placés : code 2 avant toute connexion', codes, [2, 2, 2, 2, 2, 2, 2, 2, 2]);
    }
    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });

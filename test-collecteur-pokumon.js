// node test-collecteur-pokumon.js — le collecteur de pokumon.com (collecteur-images-pokumon.js + retirer-visuels-pokumon.js) de BOUT EN BOUT sur une base EN MÉMOIRE, un réseau SIMULÉ et un faux
// client R2 : aucune requête, aucune base réelle, rien sur R2. Ce que le banc garde :
//   · l'index vient du client (quatre listes), la clé prouve, un doute reste un trou et le DIT ; une entrée commune à deux séries ne se télécharge qu'UNE fois ;
//   · un original sous le seuil est écarté, COMPTÉ, écrit « trop-petit » ; R2 AVANT la ligne `images` ; la mention, le lot, la source, la langue sur la ligne ET sur l'entrée ;
//   · additif : une fiche déjà pourvue n'est jamais touchée ; reprise sans requête ni doublon ; un visuel retiré ne revient pas ;
//   · 🔑 `cartes_produits.visuelSubstitut` n'est JAMAIS touché, et la règle du site IMPORTÉE sert l'image propre là où elle est posée, le substitut ailleurs ;
//   · défi : arrêt, alerte écrite, plus rien ; alerte posée : aucune requête ; tirage non occidental : refusé ;
//   · le retrait en un lot retire EXACTEMENT le lot et rend les fiches à leur substitut.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt (collecte-cartes/ + les deux scripts).
require('./bancs-dossier-arrets');      // les arrêts et pauses durables d'hôtes : un dossier TEMPORAIRE, jamais le vrai (correction 2, M1)
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const DIR = process.env.TOOL_DIR || __dirname;
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));
const C = require(path.join(DIR, 'collecteur-images-pokumon.js'));
const { lancerEcriture } = C;
const { retirerLot } = require(path.join(DIR, 'retirer-visuels-pokumon.js'));
const { vignetterApresJointure } = require(path.join(DIR, 'collecte-cartes', 'vignettes-apres-jointure'));
const { RAW, CDN } = require('./test-pokumon-donnees');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ── une base en mémoire : les seules formes de requête que le collecteur emploie (même forme que test-ptcgio.js) ──
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

// ── le monde : les produits RÉELS de la mesure (idProduct, nom Cardmarket, slug) sur quatre sets Prize Pack ────────────────────────────────────────────
const SLUG = { 1: 'Play-Pokemon-Prize-Pack-Series-One', 2: 'Play-Pokemon-Prize-Pack-Series-Two', 3: 'Play-Pokemon-Prize-Pack-Series-Three', 4: 'Play-Pokemon-Prize-Pack-Series-Four' };
const PRODUITS = [
    { idProduct: 697064, carteId: 100, serie: 1, nomCm: 'Kricketune V [Exciting Stage | X-Scissor]', slugProduit: 'Kricketune-V-PPS1BST-006' },
    { idProduct: 705125, carteId: 101, serie: 2, nomCm: 'Kricketune V [Exciting Stage | X-Scissor]', slugProduit: 'Kricketune-V-PPS2BST-006' },
    { idProduct: 697065, carteId: 102, serie: 1, nomCm: 'Cherrim [Spring Bloom | Seed Bomb]', slugProduit: 'Cherrim-PPS1BST-008' },
    { idProduct: 697089, carteId: 103, serie: 1, nomCm: 'Drizzile [Shady Dealings | Water Drip]', slugProduit: 'Drizzile-V1-PPS1SSH-056' },
    { idProduct: 835825, carteId: 103, serie: 1, nomCm: 'Drizzile [Shady Dealings | Water Drip]', slugProduit: 'Drizzile-V2-PPS1SSH-056' },
    { idProduct: 728167, carteId: 104, serie: 3, nomCm: 'Cheren\'s Care', slugProduit: 'Cherens-Care-PPS3BRS-134' },
    { idProduct: 728159, carteId: 105, serie: 3, nomCm: 'Grotle [Sun-Drenched Shell | Razor Leaf]', slugProduit: 'Grotle-PPS3BRS-007' },
    { idProduct: 730140, carteId: 106, serie: 3, nomCm: 'Regieleki VMAX [Transistor | Max Thunder and Lightning]', slugProduit: 'Regieleki-VMAX-PPS3SIT-058' },
    { idProduct: 756372, carteId: 107, serie: 4, nomCm: 'Regieleki VMAX [Transistor | Max Thunder and Lightning]', slugProduit: 'Regieleki-VMAX-PPS4SIT-058' }
];
const TCGDEX_GROTLE = { set: SLUG[3], source: 'tcgdex', numero: '007', cleR2: 'tcgdex/autre.webp', langue: 'en' };
const substitut = id => ({ cleR2: `tcgdex/Origine/${id}.webp`, source: 'tcgdex', set: 'Origine', numero: '006', w: 600, h: 825, mention: 'Visuel de la carte d\'origine, sans le tampon Prize Pack', preuve: 'x', le: '2026-09-26T10:22:34.641Z' });
function semer(B, { tirage1 = 'intl' } = {}) {
    for (const s of [1, 2, 3, 4]) B.col('sets').set(SLUG[s], { _id: SLUG[s], tirage: s === 1 ? tirage1 : 'intl', region: 'intl' });
    for (const p of PRODUITS) {
        if (!B.col('cartes').has(p.carteId)) B.col('cartes').set(p.carteId, { _id: p.carteId, nomEn: p.nomCm.replace(/\s*\[.*$/, ''), images: p.carteId === 105 ? [structuredClone(TCGDEX_GROTLE)] : [] });
        B.col('cartes_produits').set(`${p.carteId}|${p.idProduct}`, { _id: `${p.carteId}|${p.idProduct}`, carteId: p.carteId, idProduct: p.idProduct, slugSet: SLUG[p.serie], visuelSubstitut: substitut(p.idProduct) });
    }
}
const lireProduits = async () => PRODUITS.map(p => ({ idProduct: p.idProduct, slugSet: SLUG[p.serie], slugProduit: p.slugProduit, nomCm: p.nomCm }));

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
const LISTES = { 1: [RAW.kricketune, RAW.cherrim, RAW.drizzileHolo, RAW.drizzile], 2: [RAW.kricketune, RAW.cherrim, RAW.cheren, RAW.grotle], 3: [RAW.cheren, RAW.grotle, RAW.regieleki], 4: [RAW.regieleki] };
const EVT = { 7720: 1, 7721: 2, 7838: 3, 8187: 4 };

(async () => {
    const fichiers = { [RAW.kricketune._embedded['wp:featuredmedia'][0].source_url]: await png(947, 1325), [RAW.cherrim._embedded['wp:featuredmedia'][0].source_url]: await png(200, 280), [RAW.cheren._embedded['wp:featuredmedia'][0].source_url]: await png(500, 698), [RAW.regieleki._embedded['wp:featuredmedia'][0].source_url]: await png(738, 1033) };
    let totalAnnonce = null;                                       // le total que la source annonce par série (x-wp-total), pour fausser la liste
    const reseau = (surImage = null) => {
        const appels = [];
        return { appels, async get(url) {
            appels.push(url);
            if (/robots\.txt$/.test(url)) return { status: 200, texte: 'User-agent: *\nDisallow: /wp-admin/\n' };
            if (/wp-json/.test(url)) { const s = EVT[/release_event=(\d+)/.exec(url)[1]]; return { status: 200, type: 'application/json', texte: JSON.stringify(LISTES[s]), pages: 1, total: totalAnnonce?.[s] ?? LISTES[s].length }; }
            if (surImage) { const r = surImage(url); if (r) return r; }
            return fichiers[url] ? { status: 200, type: 'image/png', octets: fichiers[url] } : { status: 404, type: 'text/html' };
        } };
    };
    const verrou = { tenu: true, perdu: false };
    let maintenant = 1e12;
    const pause = async ms => { maintenant += ms; };
    const stock = new Map();
    const cache = { lire: k => stock.get(k) ?? null, ecrire: (k, v) => stock.set(k, v) };
    const client = (tr, ch = cache) => P.fabriquerClientPokumon({ transport: tr, verrou, pause, horloge: () => maintenant, cache: ch });
    const depots = [], supprimes = [];
    const R2 = { verifierBucket: async b => { if (!b) throw new Error('bucket'); }, deposerBinaire: async (b, c, d, t) => depots.push([b, c, d.length, t]) };
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    // les VIGNETTES : le banc injecte ce que fait assurerVignettes sur la base en mémoire (pas de R2)
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
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const depotsDe = B => [...B.col('cartes').values()].flatMap(c => c.images).filter(e => e.source === 'pokumon').length;
    const lancer = async (B, tr, o = {}) => { const r = silencieux(); try { const c = client(tr, o.cache); return { c, ...(await lancerEcriture(o.series || [1, 2, 3, 4], B.M, { verrou, client: c, lireProduits, R2, vignetter, fabriquerVerrouSet: verrouSet, stopOctets: o.stopOctets })) }; } finally { r(); } };

    // ── 1. la collecte, de bout en bout ───────────────────────────────────────────────────────────────────────────────────────────────────────────
    const B = fausseBase(); semer(B);
    const substitutsAvant = JSON.stringify([...B.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut]));
    let tr = reseau();
    let R = await lancer(B, tr);
    const R1 = R;
    verifier('la collecte des quatre séries est « verifiee » partout', R.resultats.map(r => r.etat), ['verifie', 'verifie', 'verifie', 'verifie']);
    verifier('les requêtes : robots.txt de pokumon.com, les 4 listes, robots.txt de l\'hôte d\'images, puis UNE image par fichier distinct (Kricketune S1 et S2 partagent la même : un seul téléchargement)',
        tr.appels.map(u => u.replace('https://pokumon.com', '').replace('https://cdn6966.templcdn.com', 'CDN').slice(0, 40)),
        ['/robots.txt', '/wp-json/wp/v2/card?release_event=7720&p', '/wp-json/wp/v2/card?release_event=7721&p', '/wp-json/wp/v2/card?release_event=7838&p', '/wp-json/wp/v2/card?release_event=8187&p', 'CDN/robots.txt',
            'CDN/wp-content/uploads/2024/11/EN_S1080H', 'CDN/wp-content/uploads/2024/11/EN_S1081P', 'CDN/wp-content/uploads/2024/11/EN_S1275P', 'CDN/wp-content/uploads/2024/11/EN_S1394H']);
    verifier('le plan : 6 prouvés (Kricketune S1 et S2, Cherrim, Cheren, Regieleki S3 et S4) ; Drizzile V1/V2 (holo et non-holo : seul de son code d\'origine SSH, le groupe ne peut pas être son propre témoin du dénominateur — la section 11 le prouve avec un second témoin) et Grotle (déjà servi par TCGdex) restent des trous NOMMÉS',
        [R.plan.plan.map(p => [p.carteId, p.serie]), R.plan.restes.map(r => [r.idProduct, r.motif]).sort()],
        [[[100, 1], [101, 2], [102, 1], [104, 3], [106, 3], [107, 4]], [[697089, 'code-sans-second-temoin'], [728159, 'deja-servi'], [835825, 'code-sans-second-temoin']].sort()]);
    verifier('R2 AVANT la ligne : un dépôt WebP par fiche posée (5 : Kricketune S1 et S2, Cheren, Regieleki S3 et S4 ; Cherrim est sous le seuil), à la clé du set', depots.map(d => [d[1], d[3]]).sort(),
        [[`pokumon/${SLUG[1]}/006-100-en.webp`, 'image/webp'], [`pokumon/${SLUG[2]}/006-101-en.webp`, 'image/webp'], [`pokumon/${SLUG[3]}/134-104-en.webp`, 'image/webp'], [`pokumon/${SLUG[3]}/058-106-en.webp`, 'image/webp'], [`pokumon/${SLUG[4]}/058-107-en.webp`, 'image/webp']].sort());
    const im = B.col('images').get(`pokumon/${SLUG[1]}/100/006/en`);
    verifier('le document `images` : source, langue, mention, lot, état, adresse d\'origine, entrée Pokumon, preuve', [im?.source, im?.langue, im?.mention, im?.lot, im?.etat, im?.urlOriginal, im?.pokumonId, /006/.test(im?.preuve || '') && /Kricketune V/.test(im?.preuve || '') && /Play! Pokémon/.test(im?.preuve || '')],
        ['pokumon', 'en', '© Pokémon / The Pokémon Company', 'pokumon-2026-10', 'ok', RAW.kricketune._embedded['wp:featuredmedia'][0].source_url, 75661, true]);
    verifier('l\'entrée de la carte : mention, lot, langue, attribution, source, numéro, vignette', ((e) => [e.mention, e.lot, e.langue, e.attribution, e.source, e.numero, /^vignettes\/pokumon\//.test(e.vignette?.cleR2 || '')])(B.col('cartes').get(100).images[0]),
        ['© Pokémon / The Pokémon Company', 'pokumon-2026-10', 'en', '© Pokémon / The Pokémon Company', 'pokumon', '006', true]);
    verifier('TRAÇABILITÉ (doctrine 2026-10-17) : le document ET l\'entrée portent retirable, urlOriginal, collecteLe', [im.retirable, im.collecteLe instanceof Date, B.col('cartes').get(100).images[0].retirable, B.col('cartes').get(100).images[0].urlOriginal === im.urlOriginal && im.urlOriginal.length > 0, B.col('cartes').get(100).images[0].collecteLe instanceof Date], [true, true, true, true, true]);
    verifier('TAMPON (correction 5) : l\'entrée d\'un Prize Pack porte `tampon` = sa `marque` normalisée (celle du document)', [B.col('cartes').get(100).images[0].tampon, im.marque === 'Prize Pack Series 1 : tampon « Play! Pokémon »'], ['prize pack series 1 : tampon « play! pokémon »', true]);
    verifier('SEUIL : un original de 200 px est écarté, COMPTÉ, écrit « trop-petit » avec la largeur et le seuil ; la carte ne reçoit rien',
        [B.col('images').get(`pokumon/${SLUG[1]}/102/008/en`)?.etat, B.col('images').get(`pokumon/${SLUG[1]}/102/008/en`)?.wOriginal, B.col('images').get(`pokumon/${SLUG[1]}/102/008/en`)?.seuilApplique, B.col('cartes').get(102).images.length, R.resultats[0].tropPetits],
        ['trop-petit', 200, 350, 0, 1]);
    verifier('ADDITIF : la fiche déjà pourvue (Grotle, TCGdex) n\'est pas touchée', B.col('cartes').get(105).images.map(({ vignette, ...e }) => e), [TCGDEX_GROTLE]);
    verifier('🔑 les SUBSTITUTS ne bougent pas d\'un octet (aucun détachement) et la garde de chaque série les a comptés avant et après', [JSON.stringify([...B.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut])) === substitutsAvant, R.resultats.map(r => r.garde.substitutsAvant === r.garde.substitutsApres)], [true, [true, true, true, true]]);
    verifier('le bilan du set : prouvés, joints, garde verte, requêtes', [B.col('sets').get(SLUG[1]).visuelsPokumon?.prouves, B.col('sets').get(SLUG[1]).visuelsPokumon?.joints, B.col('sets').get(SLUG[1]).visuelsPokumon?.garde?.ok], [2, 1, true]);

    // ── 2. LA RÈGLE DU SITE, IMPORTÉE, sur le résultat : le propre là où il est posé, le substitut ailleurs ────────────────────────────────────────────
    const SITE = await P.chargerRegleDuSite(process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy');
    const servi = (carteId, serie) => P.visuelServi(SITE, { set: SLUG[serie], images: B.col('cartes').get(carteId).images, numeroFiche: null, region: 'intl', produits: [...B.col('cartes_produits').values()].filter(l => l.carteId === carteId), baseUrlImages: 'https://img.example' }).genre;
    verifier('règle du site : Kricketune (S1, S2) et Cheren (S3) sont servis par l\'image PROPRE ; Cherrim (trop petit) reste sur son SUBSTITUT ; Drizzile (deux produits) aussi', [servi(100, 1), servi(101, 2), servi(104, 3), servi(102, 1), servi(103, 1)], ['propre', 'propre', 'propre', 'substitut', 'substitut']);

    // ── 3. la REPRISE : aucune requête, aucun doublon, aucun dépôt ─────────────────────────────────────────────────────────────────────────────────
    const nDepots = depots.length;
    tr = reseau();
    R = await lancer(B, tr);
    verifier('reprise : AUCUNE requête (la liste vient du cache, les fichiers déjà posés et le « trop-petit » ne se redemandent pas), aucun nouveau dépôt', [tr.appels.length, depots.length - nDepots], [0, 0]);
    verifier('reprise : une entrée par fiche (pas de doublon), les mêmes entrées', [B.col('cartes').get(100).images.length, B.col('cartes').get(101).images.length, B.col('cartes').get(104).images.length, R.resultats.map(r => r.etat)], [1, 1, 1, ['verifie', 'verifie', 'verifie', 'verifie']]);

    // ── 4. un visuel retiré ne revient pas ────────────────────────────────────────────────────────────────────────────────────────────────────────
    B.col('images').get(`pokumon/${SLUG[2]}/101/006/en`).etat = 'retire';
    B.col('cartes').get(101).images = [];
    tr = reseau();
    R = await lancer(B, tr);
    verifier('un visuel « retire » ne revient ni au rejeu ni à la collecte (aucune requête, aucune entrée)', [tr.appels.length, B.col('cartes').get(101).images.length, R.resultats[1].retires], [0, 0, 1]);

    // ── 5. le RETRAIT EN UN LOT ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // la carte d'origine garde son propre scan (autre set, autre source) : le retrait ne la touche pas
    B.col('cartes').get(100).images.push({ set: 'Battle-Styles', source: 'tcgdex', numero: '006', cleR2: 'tcgdex/Battle-Styles/006.webp', langue: 'en' });
    const simul = await retirerLot(B.db);
    verifier('retrait (simulation) : les cartes et les entrées du lot, rien d\'autre (Grotle et son TCGdex n\'y sont pas ; Kricketune S2 est déjà retiré)', [simul.cartes.sort(), simul.entrees, simul.parSet], [[100, 104, 106, 107], 4, { [SLUG[1]]: 1, [SLUG[3]]: 2, [SLUG[4]]: 1 }]);
    const r2cles = [];
    const rr = await retirerLot(B.db, { ecrire: true, effacerR2: true, supprimer: async (b, c) => r2cles.push(...c), verifierBucket: async () => { }, bucket: 'bucket-banc' });
    verifier('retrait : les entrées du lot sortent, TCGdex reste, les documents passent « retire », les vignettes sont effacées avec les images, l\'alerte est posée, le bilan du set nettoyé',
        [B.col('cartes').get(100).images.map(e => `${e.source}:${e.set}`).join(), B.col('cartes').get(104).images.length, B.col('cartes').get(105).images.map(e => e.source), B.col('images').get(`pokumon/${SLUG[1]}/100/006/en`).etat, r2cles.filter(c => /^vignettes\//.test(c)).length, B.col('collecte_images_etat').get(P.ID_ALERTE)?.active, B.col('sets').get(SLUG[1]).visuelsPokumon === undefined, rr.reste],
        ['tcgdex:Battle-Styles', 0, ['tcgdex'], 'retire', 4, true, true, 0]);
    verifier('🔑 le retrait rend les fiches à leur SUBSTITUT (jamais détaché) : règle du site rejouée', [servi(100, 1), servi(104, 3), JSON.stringify([...B.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut])) === substitutsAvant], ['substitut', 'substitut', true]);
    tr = reseau();
    let err = null; try { await lancer(B, tr); } catch (e) { err = e.message; }
    verifier('après le retrait, la source est fermée : aucune requête ne part', [/a bloqué/.test(err || ''), tr.appels.length], [true, 0]);

    // ── 6. un DÉFI : arrêt, alerte écrite, plus rien ──────────────────────────────────────────────────────────────────────────────────────────────
    const B2 = fausseBase(); semer(B2);
    tr = reseau(url => /EN_S1080/.test(url) ? { status: 403, type: 'text/html', texte: 'non' } : null);
    R = await lancer(B2, tr);
    verifier('403 sur la première image : « incomplet », l\'alerte est ÉCRITE, aucune entrée posée, aucune autre image demandée, les séries suivantes ne partent pas', [R.resultats.map(r => r.etat), B2.col('collecte_images_etat').get(P.ID_ALERTE)?.active, [...B2.col('cartes').values()].flatMap(c => c.images).filter(e => e.source === 'pokumon').length, tr.appels.filter(u => /EN_S/.test(u)).length], [['incomplet'], true, 0, 1]);

    // ── 6 bis. ADDITIF À LA JOINTURE : une autre source qui sert la fiche ENTRE le plan et la jointure garde sa place, la nôtre lui cède ──────────────
    const B5 = fausseBase(); semer(B5);
    const course = { set: SLUG[3], source: 'tcgdex', numero: '134', cleR2: 'tcgdex/course.webp', langue: 'en' };
    tr = reseau(url => { if (/EN_S1275/.test(url)) B5.col('cartes').get(104).images.push(structuredClone(course)); return null; });
    R = await lancer(B5, tr);
    verifier('une autre source pose la fiche pendant la collecte : son entrée est intacte, la nôtre cède (comptée), aucun doublon', [B5.col('cartes').get(104).images.map(({ vignette, ...e }) => e), R.resultats[2].dejaParAutre, R.resultats[2].etat], [[course], 1, 'verifie']);

    // ── 6 quater. REPONSE-HOTE (2026-10-18) : la règle commune de réponse, VUE PAR LE COLLECTEUR (faux transport) ──────────────────────────────────
    {
        const RH = require('./collecte-cartes/reponse-hote');
        const dp = () => require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'pk-col-pauses-'));
        const clientRH = (tr, o = {}) => P.fabriquerClientPokumon({ transport: tr, verrou, pause, horloge: () => maintenant, cache: { lire: () => null, ecrire() { } }, dossierPauses: dp(), ...o });
        const lancerRH = async (B, tr, c) => { const r = silencieux(); try { return await lancerEcriture([1, 2, 3, 4], B.M, { verrou, client: c, lireProduits, R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { r(); } };
        const posees = B => [...B.col('cartes').values()].flatMap(c => c.images).filter(e => e.source === 'pokumon').length;
        // (a) 200 text/html sur une adresse : fausse page introuvable → on passe à la suivante, SANS arrêt (aucune alerte), les autres images sont posées
        const BH1 = fausseBase(); semer(BH1);
        let trH = reseau(url => /EN_S1080/.test(url) ? { status: 200, type: 'text/html', texte: '<html>Page introuvable</html>' } : null);
        const cH1 = clientRH(trH);
        const RH1 = (await lancerRH(BH1, trH, cH1)).resultats;
        verifier('REPONSE-HOTE : un 200 text/html sur une image → absente, on passe à la suivante : AUCUNE alerte, les autres images partent (Regieleki, Cheren), le client n\'est ni bloqué ni en pause',
            [BH1.col('collecte_images_etat').get(P.ID_ALERTE) === undefined, trH.appels.filter(u => /EN_S/.test(u)).length, posees(BH1) > 0, cH1.bloque(), cH1.pause()], [true, 4, true, null, null]);
        verifier('REPONSE-HOTE : …et le rapport de l\'unité nomme les fausses absences et l\'empreinte distincte', [RH1[0].reponsesHotes.map(h => [h.hote, h.fausses, h.empreintes.length]), RH1[0].pauseHote], [[['cdn6966.templcdn.com', 1, 1]], null]);
        // (b) un défi : arrêt définitif par le mécanisme existant (l'alerte), comme avant
        const BH2 = fausseBase(); semer(BH2);
        trH = reseau(url => /EN_S1080/.test(url) ? { status: 200, type: 'text/html', texte: '<title>Just a moment...</title>' } : null);
        const RH2 = await lancerRH(BH2, trH, clientRH(trH));
        verifier('REPONSE-HOTE : un défi (« Just a moment ») → arrêt DÉFINITIF par l\'alerte existante, les séries suivantes ne partent pas', [BH2.col('collecte_images_etat').get(P.ID_ALERTE)?.active, RH2.resultats.map(r => r.etat), trH.appels.filter(u => /EN_S/.test(u)).length], [true, ['incomplet'], 1]);
        // (c) trop de fausses absences d'affilée : PAUSE, sans alerte ni arrêt définitif (le seuil du banc est abaissé à 2 : le plan n'a que 5 fichiers ; le 21 est prouvé au niveau du module et du client)
        const BH3 = fausseBase(); semer(BH3);
        trH = reseau(url => /EN_S/.test(url) ? { status: 200, type: 'text/html', texte: '<html>Page introuvable</html>' } : null);
        const cH3 = clientRH(trH, { suivi: RH.suiviHote({ seuil: 1 }) });
        const RH3 = await lancerRH(BH3, trH, cH3);
        verifier('REPONSE-HOTE : au-delà du seuil de fausses absences d\'affilée → PAUSE de l\'hôte : « incomplet » avec la pause nommée, AUCUNE alerte (pas un arrêt définitif), plus de requête d\'image',
            [RH3.resultats[0].etat, RH3.resultats[0].pauseHote?.hote, BH3.col('collecte_images_etat').get(P.ID_ALERTE) === undefined, trH.appels.filter(u => /EN_S/.test(u)).length, RH3.resultats.length, cH3.pause()?.issue], ['incomplet', 'cdn6966.templcdn.com', true, 2, 1, 'fausse-absente']);
        verifier('REPONSE-HOTE : …et le bilan écrit en base dit la pause, les fausses absences et leurs empreintes', [BH3.col('sets').get(SLUG[1]).visuelsPokumon.pauseHote?.hote, BH3.col('sets').get(SLUG[1]).visuelsPokumon.reponsesHotes[0].fausses, BH3.col('sets').get(SLUG[1]).visuelsPokumon.concordance], ['cdn6966.templcdn.com', 2, false]);
    }

    // ── 6 ter. une liste INCOMPLÈTE (le total annoncé dépasse les entrées lues) arrête tout, avant la moindre écriture ──────────────────────────────
    const B6 = fausseBase(); semer(B6);
    totalAnnonce = { 1: 5, 2: 4, 3: 3, 4: 1 };
    tr = reseau();
    err = null; try { await lancer(B6, tr, { cache: { lire: () => null, ecrire() { } } }); } catch (e) { err = e.message; }
    totalAnnonce = null;
    verifier('liste incomplète : 4 entrées lues pour 5 annoncées → arrêt, rien d\'écrit, aucune image demandée', [/incomplète/.test(err || ''), tr.appels.filter(u => /EN_S/.test(u)).length, depotsDe(B6), [...B6.col('images').values()].length], [true, 0, 0, 0]);

    // ── 7. un tirage non occidental est refusé, la base trop pleine aussi ──────────────────────────────────────────────────────────────────────────
    const B3 = fausseBase(); semer(B3, { tirage1: 'jp' });
    tr = reseau();
    R = await lancer(B3, tr, { series: [1] });
    verifier('un set au tirage « jp » est refusé : la source ne sert que des cartes anglaises', [R.resultats[0].etat, [...B3.col('cartes').values()].flatMap(c => c.images).filter(e => e.source === 'pokumon').length], ['refuse-set', 0]);
    const B4 = fausseBase({ dataSize: 450 * 1048576 }); semer(B4);
    tr = reseau();
    R = await lancer(B4, tr, { series: [1] });
    verifier('base « cartes » au-dessus de 400 Mo : STOP, alerte de taille, aucune image demandée', [R.resultats[0].etat, B4.col('collecte_images_etat').get('alerte/taille-base')?.active, tr.appels.filter(u => /EN_S/.test(u)).length], ['refuse-taille-base', true, 0]);

    // ── 8. le plafond suit le plan ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const c = client(reseau());
    let e2 = null; try { c.fixerPlafond(P.PLAFOND_MAX + 1); } catch (e) { e2 = e.message; }
    verifier('le plafond d\'une collecte ne dépasse jamais PLAFOND_MAX', [/refusé/.test(e2 || ''), P.PLAFOND_MAX], [true, 400]);
    verifier('le plafond fixé par la collecte suit le plan : 5 requêtes déjà parties (robots + 4 listes) + 1 robots d\'images + 4 fichiers distincts + 10 % (1) + 3 de marge', [R1.c.plafond(), R1.c.compteRequetes()], [14, 10]);

    // ── 9. la ligne de commande s'écrit par ce qu'elle AUTORISE ───────────────────────────────────────────────────────────────────────────────────
    for (const args of [['--ecrire', '--tout'], ['--plan', '--ecrire'], [], ['--series=5', '--plan'], ['--ecrire', '--series=1,2;x'], ['--plan', '--lignes=prof'], ['--plan', '--familles', '--series=1'], ['--plan', '--familles', '--lignes=a;b']]) {
        const r = spawnSync(process.execPath, [path.join(DIR, 'collecteur-images-pokumon.js'), ...args], { encoding: 'utf8', timeout: 30000 });
        verifier(`ligne de commande « ${args.join(' ') || '(rien)'} » : refusée avant toute connexion (code 2)`, r.status, 2);
    }

    // ── 9 bis. les AUTRES familles de BOUT EN BOUT : une carte Black Star MEP033, l'image posée au numéro de la FICHE, la marque de sa ligne, le substitut intact ──
    {
        const { wp } = require('./test-pokumon-donnees');
        const SL = 'MEP-Black-Star-Promos';
        const LUC = P.lireEntree(wp(113100, 'Mega Lucario ex (MEP033 English Promo)', `${CDN}/2026/08/EN_033MEP.jpg`, 717, 1000, [9606]));
        const BF = fausseBase();
        BF.col('sets').set(SL, { _id: SL, tirage: 'intl', region: 'intl' });
        BF.col('cartes').set(7, { _id: 7, nomEn: 'Mega Lucario ex', images: [{ set: SL, source: 'bulbapedia', numero: '012', cleR2: 'b.webp', langue: 'en' }], impressions: [{ tirage: 'intl', expansion: 'MEP Black Star Promos', numero: '033', total: null }] });
        BF.col('cartes_produits').set('7|873710', { _id: '7|873710', carteId: 7, idProduct: 873710, slugSet: SL, visuelSubstitut: substitut(873710) });
        const prodMep = async () => [{ idProduct: 873710, slugSet: SL, slugProduit: 'Mega-Lucario-ex-MEP033', numero: '033', nomCm: 'Mega Lucario ex [Aura Jab | Mega Brave]' }];
        const fich = { [`${CDN}/2026/08/EN_033MEP.jpg`]: await png(717, 1000) };
        const tr = { appels: [], async get(url) { this.appels.push(url); return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : fich[url] ? { status: 200, type: 'image/png', octets: fich[url] } : { status: 404, type: 'text/html' }; } };
        const rest = silencieux(); let RF; const cF = client(tr);
        try { RF = await C.lancerEcritureFamilles(['bsp-mep'], BF.M, { verrou, client: cF, lireProduits: prodMep, index: [LUC], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest(); }
        const cartePosee = BF.col('cartes').get(7), pk = cartePosee.images.filter(e => e.source === 'pokumon');
        verifier('autres familles : l\'unité MEP est vérifiée, UNE image posée, au numéro de la FICHE (033), avec la marque de sa ligne, le lot et la mention', [RF.resultats.map(r => r.etat), pk.length, pk[0]?.numero, /^bsp-mep : /.test(BF.col('images').get(`pokumon/${SL}/7/033/en`)?.marque || ''), pk[0]?.lot, pk[0]?.mention === P.MENTION], [['verifie'], 1, '033', true, P.LOT, true]);
        verifier('autres familles : l\'image d\'un AUTRE numéro de la carte (012, bulbapedia) et le substitut ne bougent pas', [cartePosee.images.filter(e => e.source === 'bulbapedia').length, BF.col('cartes_produits').get('7|873710').visuelSubstitut.cleR2], [1, 'tcgdex/Origine/873710.webp']);
        verifier('autres familles : une requête d\'image seulement (robots de deux hôtes + 1 fichier), plafond fixé par le plan', [tr.appels.filter(u => /\.jpg$/.test(u)).length, cF.compteRequetes() <= cF.plafond()], [1, true]);
        const BG = fausseBase();
        BG.col('sets').set(SL, { _id: SL, tirage: 'intl', region: 'intl' });
        BG.col('cartes').set(7, structuredClone({ ...BF.col('cartes').get(7), images: [{ set: SL, source: 'bulbapedia', numero: '012', cleR2: 'b.webp', langue: 'en' }] }));
        BG.col('cartes_produits').set('7|873710', structuredClone(BF.col('cartes_produits').get('7|873710')));
        BF.M = BG.M; BF.col = BG.col;
        const jamais = { appels: [], async get(url) { this.appels.push(url); return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : { status: 404, type: 'text/html' }; } };
        const rest2 = silencieux(); try { await C.lancerEcritureFamilles(['bsp-mep'], BF.M, { verrou, client: client(jamais), lireProduits: prodMep, index: [{ ...LUC, w: 322, h: 449 }], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest2(); }
        verifier('autres familles : une image sous le seuil (322 px) ne part JAMAIS en requête (comptée au plan), rien n\'est posé', [jamais.appels.filter(u => /\.jpg$/.test(u)).length, BF.col('cartes').get(7).images.filter(e => e.source === 'pokumon').length], [0, 0]);
    }

    // ── 9 ter. ➕ BASSE-DEF : le PLANCHER de 200 px des lignes McDonald's nommées, la marque, et le REMPLACEMENT d'une entrée marquée (de bout en bout) ────────────────────
    {
        const { wp } = require('./test-pokumon-donnees');
        const SLM = 'McDonalds-Collection-2014';
        const URLM = `${CDN}/2025/07/EN_S041McDonalds-Collection.png`;
        const entreeM = w => P.lireEntree(wp(107429, 'Pikachu (5/12 McDonald\'s McDonalds Collection)', URLM, w, Math.round(w * 1.4), [9231]));
        const prodM = async () => [{ idProduct: 281657, slugSet: SLM, slugProduit: 'Pikachu-MCD145', numero: '5', nomCm: 'Pikachu [Nuzzle | Quick Attack]' }];
        const MARQ = { set: SLM, source: 'tpc-asie', numero: '5', cleR2: 'tpc-asie/McD/005-9-en.webp', langue: 'en', w: 300, basseDefinition: true };
        const monde = (images = [], tirageM = 'intl') => {
            const Bm = fausseBase();
            Bm.col('sets').set(SLM, { _id: SLM, tirage: tirageM, region: 'intl' });
            Bm.col('cartes').set(9, { _id: 9, nomEn: 'Pikachu', images: structuredClone(images), impressions: [{ tirage: 'intl', expansion: "McDonald's Collection 2014", numero: '5', total: '12' }] });
            Bm.col('cartes_produits').set('9|281657', { _id: '9|281657', carteId: 9, idProduct: 281657, slugSet: SLM, visuelSubstitut: substitut(281657) });
            if (images.length) Bm.col('images').set('mq', { _id: 'mq', source: MARQ.source, set: SLM, carteId: 9, cleR2: MARQ.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png', wOriginal: 300 });
            return Bm;
        };
        const lancerM = async (Bm, wIndex, wFichier = wIndex) => {
            const fich = { [URLM]: await png(wFichier, Math.round(wFichier * 1.4)) };
            const trM = { appels: [], async get(url) { this.appels.push(url); return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : fich[url] ? { status: 200, type: 'image/png', octets: fich[url] } : { status: 404, type: 'text/html' }; } };
            const rest = silencieux(); let RM; const cM = client(trM);
            try { RM = await C.lancerEcritureFamilles(['mcd-2014'], Bm.M, { verrou, client: cM, lireProduits: prodM, index: [entreeM(wIndex)], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest(); }
            return { RM, trM };
        };
        const posees = Bm => Bm.col('cartes').get(9).images.filter(e => e.source === 'pokumon');
        { const Bm = monde(); await lancerM(Bm, 320); verifier('TAMPON (correction 5) : une entrée McDonald\'s ne porte PAS de `tampon` (une année, pas une réimpression tamponnée) mais garde sa `marque` sur le document', [posees(Bm)[0]?.tampon ?? null, /^mcd-2014 : /.test(Bm.col('images').get(`pokumon/${SLM}/9/5/en`)?.marque || '')], [null, true]); }
        for (const [w, admis, marque] of [[199, false, null], [200, true, true], [320, true, true], [349, true, true], [350, true, false], [496, true, false]]) {
            const Bm = monde(); const { RM, trM } = await lancerM(Bm, w);
            const doc = Bm.col('images').get(`pokumon/${SLM}/9/5/en`), ent = posees(Bm)[0];
            verifier(`McDonald's 2014, ${w} px : ${admis ? `posée ${marque ? 'MARQUÉE basseDefinition (document ET entrée)' : 'sans marque'}, unité vérifiée` : 'jamais téléchargée (plan : sous le plancher de 200 px), rien posé'}`,
                [RM.resultats.map(r => r.etat), trM.appels.filter(u => /\.png$/.test(u)).length, doc?.basseDefinition === true, ent ? ent.basseDefinition === true : null], [['verifie'], admis ? 1 : 0, !!marque, admis ? !!marque : null]);
        }
        { const Bm = monde(); const { RM } = await lancerM(Bm, 322, 150);
          verifier('l\'index dit 322 px, le fichier en fait 150 : « trop-petit », seuil appliqué 200 (plancher), rien de joint', [Bm.col('images').get(`pokumon/${SLM}/9/5/en`)?.etat, Bm.col('images').get(`pokumon/${SLM}/9/5/en`)?.seuilApplique, posees(Bm).length, RM.resultats[0].tropPetits], ['trop-petit', 200, 0, 1]); }
        { const Bm = monde(); Bm.col('images').set(`pokumon/${SLM}/9/5/en`, { _id: `pokumon/${SLM}/9/5/en`, source: 'pokumon', set: SLM, carteId: 9, numero: '5', urlOriginal: URLM, wOriginal: 322, hOriginal: 450, etat: 'trop-petit', seuilApplique: 350, lot: P.LOT });
          const { RM, trM } = await lancerM(Bm, 322);
          verifier('un « trop-petit » jugé à 350 (avant le plancher), 322 px, est REJUGÉ au plancher de 200 : retéléchargé et posé marqué', [trM.appels.filter(u => /\.png$/.test(u)).length, Bm.col('images').get(`pokumon/${SLM}/9/5/en`)?.etat, posees(Bm)[0]?.basseDefinition === true, RM.resultats[0].tropPetits], [1, 'ok', true, 0]); }
        { const Bm = monde(); Bm.col('images').set(`pokumon/${SLM}/9/5/en`, { _id: `pokumon/${SLM}/9/5/en`, source: 'pokumon', set: SLM, carteId: 9, numero: '5', urlOriginal: URLM, wOriginal: 150, hOriginal: 210, etat: 'trop-petit', seuilApplique: 200, lot: P.LOT });
          const { RM, trM } = await lancerM(Bm, 322, 150);
          verifier('un « trop-petit » à 150 px jugé à 200 n\'est PAS redemandé (reste refusé sous le plancher)', [trM.appels.filter(u => /\.png$/.test(u)).length, RM.resultats[0].tropPetits], [0, 1]); }
        { const Bm = monde(); const tr3 = { appels: [], async get(url) { this.appels.push(url); return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : { status: 404, type: 'text/html' }; } };
          const rest = silencieux(); try { await C.lancerEcritureFamilles(['mcd-2014'], Bm.M, { verrou, client: client(tr3), lireProduits: prodM, index: [entreeM(322)], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest(); }
          verifier('(témoin du banc) l\'image demandée à la source est bien celle de l\'index', tr3.appels.filter(u => /\.png$/.test(u)), [URLM]); }
        // les lignes qui ne sont PAS McDonald's (ici Black Star MEP) à 322 px : toujours refusées — le plancher ne les touche pas (déjà prouvé en 9 bis) ; et un set McDonald's HORS de la liste fermée
        verifier('Pokumon non-McDonald\'s à 320 px toujours refusé : la largeur admise d\'une ligne Black Star, Trick or Trade, Professor Program est 350', ['bsp-mep', 'tot-2022', 'prof'].map(id => require('./collecte-cartes/seuils-images').largeurAdmiseDe('pokumon', id)), [350, 350, 350]);
        // ── le REMPLACEMENT ──
        { const Bm = monde([MARQ]); const { RM } = await lancerM(Bm, 496);
          verifier('REMPLACEMENT : 496 px (non marquée) face à une entrée MARQUÉE d\'une autre source (même set, numéro, langue) → l\'entrée marquée sort, Pokumon entre sans marque', [RM.resultats.map(r => r.etat), Bm.col('cartes').get(9).images.map(e => `${e.source}:${e.basseDefinition === true}`)], [['verifie'], ['pokumon:false']]);
          verifier('   traçabilité : le document `images` de l\'ancienne RESTE (« remplace », remplacePar, remplaceLe) avec son adresse d\'origine et sa clé R2', [Bm.col('images').get('mq')?.etat, Bm.col('images').get('mq')?.remplacePar, !!Bm.col('images').get('mq')?.remplaceLe, Bm.col('images').get('mq')?.urlOriginal, Bm.col('images').get('mq')?.cleR2], ['remplace', { source: 'pokumon', cleR2: `pokumon/${SLM}/5-9-en.webp` }, true, 'https://hote.example/ancienne.png', MARQ.cleR2]);
          verifier('   la garde du set est verte (l\'entrée sortie est attendue absente), les substituts intacts', [RM.resultats[0].garde.ok, RM.resultats[0].garde.substitutsAvant === RM.resultats[0].garde.substitutsApres], [true, true]); }
        { const Bm = monde([MARQ]); const { RM, trM } = await lancerM(Bm, 322);
          verifier('JAMAIS L\'INVERSE : 322 px (marquée) face à une entrée marquée → rien n\'est téléchargé (plan : deja-servi), l\'entrée marquée reste', [trM.appels.filter(u => /\.png$/.test(u)).length, Bm.col('cartes').get(9).images.map(e => e.source), Bm.col('images').get('mq')?.etat], [0, ['tpc-asie'], 'ok']); }
        { const Bm = monde([{ ...MARQ, basseDefinition: undefined, w: 600 }]); await lancerM(Bm, 496);
          verifier('une entrée NON marquée n\'est jamais remplacée (additif)', [Bm.col('cartes').get(9).images.map(e => e.source), Bm.col('images').get('mq')?.etat], [['tpc-asie'], 'ok']); }
        { // course : l'entrée marquée est posée PENDANT le téléchargement ; la jointure arbitre alors (le plan ne la voyait pas)
          const Bm = monde(); const fich = { [URLM]: await png(496, 694) };
          const trM = { appels: [], async get(url) { this.appels.push(url); if (/\.png$/.test(url)) { Bm.col('cartes').get(9).images.push(structuredClone(MARQ)); Bm.col('images').set('mq', { _id: 'mq', source: MARQ.source, set: SLM, carteId: 9, cleR2: MARQ.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png' }); } return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : fich[url] ? { status: 200, type: 'image/png', octets: fich[url] } : { status: 404, type: 'text/html' }; } };
          const rest = silencieux(); let RM; try { RM = await C.lancerEcritureFamilles(['mcd-2014'], Bm.M, { verrou, client: client(trM), lireProduits: prodM, index: [entreeM(496)], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest(); }
          verifier('JOINTURE : une entrée marquée posée entre le plan et la jointure est remplacée à la jointure (le même arbitrage), garde verte', [Bm.col('cartes').get(9).images.map(e => e.source), Bm.col('images').get('mq')?.etat, RM.resultats[0].garde.ok], [['pokumon'], 'remplace', true]); }
    }

    // ── 10. les AUTRES familles : l'index par jeu de promos compare le total annoncé, et la table ne cite que des jeux énumérés ─────────────────────────
    const jeuxTable = [...new Set(P.LIGNES_AUTRES.map(l => l.jeu))];
    verifier('chaque ligne cite un jeu de promos énuméré (adresses admises par la liste fermée du client)', jeuxTable.every(j => P.urlIndexAutorisee(P.urlIndexPromoSet(j, 1))), true);
    const faux = (total, n) => ({ indexPromoSet: async () => ({ entrees: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: { rendered: `Pikachu (${i + 1}/12 McDonald's McDonalds Collection)` }, _embedded: {} })), pages: 1, total, depuisCache: false }) });
    let e3 = null; try { await C.chargerIndexFamilles(faux(5, 3), [P.LIGNES_AUTRES[0]]); } catch (e) { e3 = e.message; }
    verifier('index des autres familles : 3 entrées lues pour 5 annoncées — la liste est incomplète, on s\'arrête', /3 entrées lues pour 5 annoncées/.test(e3 || ''), true);
    let e4 = null; try { await C.chargerIndexFamilles(faux(0, 0), [P.LIGNES_AUTRES[0]]); } catch (e) { e4 = e.message; }
    verifier('index des autres familles : une liste VIDE est une clé fausse, pas une absence (§41)', /aucune entrée lue/.test(e4 || ''), true);
    const ok3 = await C.chargerIndexFamilles(faux(3, 3), [P.LIGNES_AUTRES[0]]);
    verifier('index des autres familles : total concordant → les entrées sont lues', [ok3.entrees.length, ok3.requetes], [3, 1]);
    let e5 = null; try { await C.lancerEcritureFamilles(['nexistepas'], null, { lireProduits: async () => [], bucket: 'b' }); } catch (e) { e5 = e.message; }
    verifier('une ligne inconnue refuse avant toute requête, et nomme les lignes de la table', [/ligne\(s\) inconnue\(s\) : nexistepas/.test(e5 || ''), /mcd-2015/.test(e5 || '')], [true, true]);

    // ── 11. PP-HOLO de BOUT EN BOUT : le scan non-holo sert les DEUX produits, marqué « partagée holo/non-holo » ; le retrait ne vise que ces images ─────────────────────────────
    {
        const SL = SLUG[1];
        const monde = [
            { idProduct: 697089, carteId: 244998, nomCm: 'Drizzile [Shady Dealings | Water Drip]', slugProduit: 'Drizzile-V1-PPS1SSH-056' },
            { idProduct: 835825, carteId: 244998, nomCm: 'Drizzile [Shady Dealings | Water Drip]', slugProduit: 'Drizzile-V2-PPS1SSH-056' },
            { idProduct: 697187, carteId: 30360, nomCm: 'Great Ball', slugProduit: 'Great-Ball-PPS1SSH-164' }
        ];
        const BH = fausseBase();
        BH.col('sets').set(SL, { _id: SL, tirage: 'intl', region: 'intl' });
        for (const p of monde) {
            if (!BH.col('cartes').has(p.carteId)) BH.col('cartes').set(p.carteId, { _id: p.carteId, nomEn: p.nomCm.replace(/\s*\[.*$/, ''), images: [] });
            BH.col('cartes_produits').set(`${p.carteId}|${p.idProduct}`, { _id: `${p.carteId}|${p.idProduct}`, carteId: p.carteId, idProduct: p.idProduct, slugSet: SL, visuelSubstitut: substitut(p.idProduct) });
        }
        const prodH = async () => monde.map(p => ({ idProduct: p.idProduct, slugSet: SL, slugProduit: p.slugProduit, nomCm: p.nomCm }));
        const indexH = [RAW.drizzileHolo, RAW.drizzile, RAW.greatBall].map(r => P.lireEntree(r));
        const urlDe = r => r._embedded['wp:featuredmedia'][0].source_url;
        const fich = { [urlDe(RAW.drizzile)]: await png(785, 1099), [urlDe(RAW.greatBall)]: await png(576, 804), [urlDe(RAW.drizzileHolo)]: await png(770, 1078) };
        const trH = { appels: [], async get(url) { this.appels.push(url); return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : fich[url] ? { status: 200, type: 'image/png', octets: fich[url] } : { status: 404, type: 'text/html' }; } };
        const sH = JSON.stringify([...BH.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut]));
        const lancerH = async tr => { const re = silencieux(); try { return await C.lancerEcriture([1], BH.M, { verrou, client: client(tr), lireProduits: prodH, index: indexH, R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { re(); } };
        const RH = await lancerH(trH);
        verifier('PP-HOLO bout en bout : la série est « verifie » ; seuls les fichiers NON-holo sont demandés (Drizzile 1007, Great Ball 1024) — le scan holo (1006) n\'est JAMAIS téléchargé',
            [RH.resultats.map(r => r.etat), trH.appels.filter(u => /EN_S/.test(u)).map(u => /EN_S(\d+)/.exec(u)[1]).sort()], [['verifie'], ['1007', '1024']]);
        const dD = BH.col('images').get(`pokumon/${SL}/244998/056/en`), dG = BH.col('images').get(`pokumon/${SL}/30360/164/en`);
        verifier('PP-HOLO : le document `images` du groupe porte le champ explicite et la liste exacte des deux produits ; celui de Great Ball n\'a ni l\'un ni l\'autre',
            [dD?.partageeHoloNonHolo, dD?.produitsPartages, dD?.pokumonId, 'partageeHoloNonHolo' in dG, 'produitsPartages' in dG], [true, [697089, 835825], 75588, false, false]);
        const eD = BH.col('cartes').get(244998).images, eG = BH.col('cartes').get(30360).images;
        verifier('PP-HOLO : l\'entrée `cartes.images` du groupe porte les deux champs (UNE entrée pour la fiche) ; l\'entrée de Great Ball n\'en a aucun',
            [eD.length, eD[0].partageeHoloNonHolo, eD[0].produitsPartages, eG.length, 'partageeHoloNonHolo' in eG[0], 'produitsPartages' in eG[0]], [1, true, [697089, 835825], 1, false, false]);
        const serviH = id => P.visuelServi(SITE, { set: SL, images: BH.col('cartes').get(id).images, numeroFiche: null, region: 'intl', produits: [...BH.col('cartes_produits').values()].filter(l => l.carteId === id), baseUrlImages: 'https://img.example' }).genre;
        verifier('PP-HOLO : la règle du site IMPORTÉE sert l\'image propre pour les deux produits de la fiche ; les substituts n\'ont pas bougé d\'un octet', [serviH(244998), serviH(30360), JSON.stringify([...BH.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut])) === sH], ['propre', 'propre', true]);
        const trH2 = { appels: [], get: trH.get };
        const RH2 = await lancerH(trH2);
        verifier('PP-HOLO : la reprise ne demande aucun fichier et garde le champ (une entrée par fiche)', [trH2.appels.filter(u => /EN_S/.test(u)).length, BH.col('cartes').get(244998).images.length, BH.col('cartes').get(244998).images[0].partageeHoloNonHolo, RH2.resultats.map(r => r.etat)], [0, 1, true, ['verifie']]);
        // une image posée AVANT cette règle (sans le champ) le reçoit au rejeu — sur le document ET sur l'entrée — sans nouveau téléchargement
        const docAnc = BH.col('images').get(`pokumon/${SL}/244998/056/en`);
        delete docAnc.partageeHoloNonHolo; delete docAnc.produitsPartages;
        BH.col('cartes').get(244998).images = [];                 // l'entrée de la fiche manque : le plan la reprend, le document est « sauté » (déjà téléchargé) mais doit recevoir le champ
        const trH4 = { appels: [], get: trH.get };
        await lancerH(trH4);
        verifier('PP-HOLO : un document déjà téléchargé mais sans le champ (entrée de la fiche manquante) le reçoit au rejeu — document ET entrée rebâtie — sans nouveau téléchargement',
            [trH4.appels.filter(u => /EN_S/.test(u)).length, BH.col('images').get(`pokumon/${SL}/244998/056/en`).partageeHoloNonHolo, BH.col('images').get(`pokumon/${SL}/244998/056/en`).produitsPartages, BH.col('cartes').get(244998).images.length, BH.col('cartes').get(244998).images[0].partageeHoloNonHolo, BH.col('cartes').get(244998).images[0].produitsPartages], [0, true, [697089, 835825], 1, true, [697089, 835825]]);
        // la MÊME carte porte aussi une image ORDINAIRE du lot dans un autre set (une carte réimprimée en S2) : le retrait partiel n'y touche pas
        const ordinaire = { set: SLUG[2], source: 'pokumon', cleR2: `pokumon/${SLUG[2]}/056-244998-en.webp`, numero: '056', lot: P.LOT, langue: 'en', vignette: { cleR2: `vignettes/pokumon/${SLUG[2]}/056-244998-en.webp`, w: 200, h: 279 } };
        BH.col('cartes').get(244998).images.push(structuredClone(ordinaire));
        BH.col('images').set(`pokumon/${SLUG[2]}/244998/056/en`, { _id: `pokumon/${SLUG[2]}/244998/056/en`, source: 'pokumon', set: SLUG[2], carteId: 244998, numero: '056', lot: P.LOT, etat: 'ok', cleR2: ordinaire.cleR2 });
        // le retrait des seules images partagées
        const simH = await retirerLot(BH.db, { seulementPartagees: true });
        verifier('PP-HOLO retrait (simulation) : les seules images « partagée holo/non-holo » — la carte du groupe, une entrée, ses clés R2 (image et vignette) ; Great Ball n\'y est pas', [simH.cartes, simH.entrees, simH.docs, simH.cles.length, simH.cles.every(c => /Series-One/.test(c))], [[244998], 1, 1, 2, true]);
        const clesH = [];
        const rrH = await retirerLot(BH.db, { ecrire: true, effacerR2: true, seulementPartagees: true, supprimer: async (b, c) => clesH.push(...c), verifierBucket: async () => { }, bucket: 'bucket-banc' });
        verifier('PP-HOLO retrait : la fiche Drizzile perd son entrée, Great Ball garde la sienne ; le document du groupe passe « retire », celui de Great Ball reste « ok » ; seules les clés du groupe sont effacées',
            [BH.col('cartes').get(244998).images.map(e => e.set), BH.col('cartes').get(30360).images.length, BH.col('images').get(`pokumon/${SL}/244998/056/en`).etat, BH.col('images').get(`pokumon/${SL}/30360/164/en`).etat, BH.col('images').get(`pokumon/${SLUG[2]}/244998/056/en`).etat, clesH.length, clesH.every(c => /Series-One/.test(c)), rrH.reste], [[SLUG[2]], 1, 'retire', 'ok', 'ok', 2, true, 0]);
        verifier('PP-HOLO retrait partiel : la source N\'est PAS fermée (pas d\'alerte), le bilan du set reste, la fiche retrouve son substitut', [BH.col('collecte_images_etat').get(P.ID_ALERTE)?.active ?? null, BH.col('sets').get(SL).visuelsPokumon !== undefined, serviH(244998), serviH(30360)], [null, true, 'substitut', 'propre']);
        const trH3 = { appels: [], get: trH.get };
        const RH3 = await lancerH(trH3);
        verifier('PP-HOLO : un visuel retiré ne revient pas au rejeu (aucun fichier demandé, aucune entrée)', [trH3.appels.filter(u => /EN_S/.test(u)).length, BH.col('cartes').get(244998).images.filter(e => e.set === SL).length, RH3.resultats[0].retires], [0, 0, 1]);
        for (const [args, motifAttendu] of [[['--partagees-holo', '--effacer-r2'], /--effacer-r2 sans --ecrire/], [['--partagees'], /argument inconnu/]]) {
            const r = spawnSync(process.execPath, [path.join(DIR, 'retirer-visuels-pokumon.js'), ...args], { encoding: 'utf8', timeout: 30000 });
            verifier(`ligne de commande du retrait « ${args.join(' ')} » : refusée avant toute connexion (code 2), pour la bonne raison`, [r.status, motifAttendu.test(r.stderr || '')], [2, true]);
        }
        // le retrait COMPLET du lot retire aussi les images partagées (même lot) : rien n'est oublié
        const rrAll = await retirerLot(BH.db, { ecrire: true });
        verifier('PP-HOLO retrait complet : retire le reste du lot (Great Ball, et l\'image ordinaire de la même carte en S2) et ferme la source', [BH.col('cartes').get(30360).images.length, BH.col('cartes').get(244998).images.length, BH.col('collecte_images_etat').get(P.ID_ALERTE)?.active, rrAll.reste], [0, 0, true, 0]);
    }

    // ── 12. BS-HOLO de BOUT EN BOUT : le scan non-holo d'une promo Black Star sert les DEUX produits ; la garde de lot voit la hausse ; le retrait peut viser les SEULES promos Black Star ─────────
    // (le couple pur est CONSTRUIT : sur les 64 groupes réels, aucun n'en est un — voir test-pokumon-autres.js, section 5 ; le chemin d'écriture n'en est pas moins prouvé ici)
    {
        const { wp } = require('./test-pokumon-donnees');
        const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
        const SB = 'SV-Black-Star-Promos', SP = SLUG[1];
        const URL_PLAIN = `${CDN}/2024/03/EN_S0570Mimikyu.png`, URL_HOLO = `${CDN}/2024/03/EN_S9571Mimikyu.png`;
        const plain = P.lireEntree(wp(80570, 'Mimikyu ex (SVP004 English Promo)', URL_PLAIN, 785, 1099, [7836]));
        const holoPur = P.lireEntree(wp(99571, 'Holofoil Mimikyu ex (SVP004 English Promo)', URL_HOLO, 754, 1052, [7836]));
        const BS = fausseBase();
        BS.col('sets').set(SB, { _id: SB, tirage: 'intl', region: 'intl' });
        BS.col('cartes').set(278879, { _id: 278879, nomEn: 'Mimikyu ex', images: [], impressions: [{ tirage: 'intl', expansion: 'SVP Black Star Promos', numero: '004', total: null }] });
        for (const id of [701130, 701131]) BS.col('cartes_produits').set(`278879|${id}`, { _id: `278879|${id}`, carteId: 278879, idProduct: id, slugSet: SB, visuelSubstitut: substitut(id) });
        // une image Prize Pack « partagée holo/non-holo » déjà posée sur une AUTRE carte : le retrait des seules promos Black Star n'y touche pas
        const pp = { set: SP, source: 'pokumon', cleR2: `pokumon/${SP}/056-244998-en.webp`, numero: '056', lot: P.LOT, langue: 'en', partageeHoloNonHolo: true, produitsPartages: [697089, 835825], vignette: { cleR2: `vignettes/pokumon/${SP}/056-244998-en.webp`, w: 200, h: 279 } };
        BS.col('cartes').set(244998, { _id: 244998, nomEn: 'Drizzile', images: [structuredClone(pp)] });
        BS.col('images').set(`pokumon/${SP}/244998/056/en`, { _id: `pokumon/${SP}/244998/056/en`, source: 'pokumon', set: SP, carteId: 244998, numero: '056', lot: P.LOT, etat: 'ok', cleR2: pp.cleR2, partageeHoloNonHolo: true, produitsPartages: [697089, 835825] });
        const prodSv = async () => [701130, 701131].map(id => ({ idProduct: id, slugSet: SB, slugProduit: `Mimikyu-ex-V${id - 701129}-SVPen004`, numero: 'SVP004', nomCm: 'Mimikyu ex [Void Return | Energy Burst]' }));
        const trS = { appels: [], async get(url) { this.appels.push(url); return /robots\.txt$/.test(url) ? { status: 200, texte: '' } : url === URL_PLAIN ? { status: 200, type: 'image/png', octets: await png(785, 1099) } : { status: 404, type: 'text/html' }; } };
        const etatAvant = compterEtat({ cartes: [...BS.col('cartes').values()] });
        const sSub = JSON.stringify([...BS.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut]));
        const rest = silencieux(); let RS;
        try { RS = await C.lancerEcritureFamilles(['bsp-svp'], BS.M, { verrou, client: client(trS), lireProduits: prodSv, index: [plain, holoPur], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest(); }
        verifier('BS-HOLO bout en bout : l\'unité Black Star est « verifie » ; SEUL le fichier non-holo est demandé, le scan holo ne l\'est JAMAIS', [RS.resultats.map(r => r.etat), trS.appels.filter(u => /\.png$/.test(u)).map(u => /EN_S(\d+)/.exec(u)[1])], [['verifie'], ['0570']]);
        const dS = BS.col('images').get(`pokumon/${SB}/278879/004/en`), eS = BS.col('cartes').get(278879).images.filter(e => e.source === 'pokumon');
        verifier('BS-HOLO : le document `images` ET l\'entrée `cartes.images` portent le champ explicite et la liste exacte des deux produits (UNE entrée pour la fiche, au numéro de la fiche)',
            [dS?.partageeHoloNonHolo, dS?.produitsPartages, dS?.pokumonId, eS.length, eS[0]?.partageeHoloNonHolo, eS[0]?.produitsPartages, eS[0]?.numero, /^bsp-svp : /.test(dS?.marque || '')], [true, [701130, 701131], 80570, 1, true, [701130, 701131], '004', true]);
        verifier('BS-HOLO : les substituts ne bougent pas d\'un octet', JSON.stringify([...BS.col('cartes_produits').values()].map(l => [l._id, l.visuelSubstitut])) === sSub, true);
        const etatApres = compterEtat({ cartes: [...BS.col('cartes').values()] });
        const cmp = comparer(etatAvant, etatApres);
        verifier('BS-HOLO garde de lot : la POSE est une hausse visible du compteur « images-partagees-holo » (par set), aucune baisse', [etatApres.get(`images-partagees-holo set:${SB}`), cmp.nonAutorisees.length, cmp.hausses['images-partagees-holo']], [1, 0, 1]);
        // la reprise : aucun fichier, le champ reste
        const trS2 = { appels: [], get: trS.get };
        const rest2 = silencieux(); try { await C.lancerEcritureFamilles(['bsp-svp'], BS.M, { verrou, client: client(trS2), lireProduits: prodSv, index: [plain, holoPur], R2, vignetter, fabriquerVerrouSet: verrouSet }); } finally { rest2(); }
        verifier('BS-HOLO : la reprise ne demande aucun fichier et garde le champ (une entrée par fiche)', [trS2.appels.filter(u => /\.png$/.test(u)).length, BS.col('cartes').get(278879).images.filter(e => e.source === 'pokumon').length, BS.col('cartes').get(278879).images.find(e => e.source === 'pokumon').partageeHoloNonHolo], [0, 1, true]);
        // le retrait : les SEULES promos Black Star, puis tout
        // la MÊME carte Mimikyu porte aussi une image Prize Pack « partagée » dans un autre set (réimpression) : le retrait restreint aux promos Black Star ne doit pas y toucher
        const ppMim = { ...structuredClone(pp), cleR2: `pokumon/${SP}/004-278879-en.webp`, numero: '004', vignette: { cleR2: `vignettes/pokumon/${SP}/004-278879-en.webp`, w: 200, h: 279 } };
        BS.col('cartes').get(278879).images.push(structuredClone(ppMim));
        BS.col('images').set(`pokumon/${SP}/278879/004/en`, { _id: `pokumon/${SP}/278879/004/en`, source: 'pokumon', set: SP, carteId: 278879, numero: '004', lot: P.LOT, etat: 'ok', cleR2: ppMim.cleR2, partageeHoloNonHolo: true, produitsPartages: [1, 2] });
        const simAll = await retirerLot(BS.db, { seulementPartagees: true });
        const simSv = await retirerLot(BS.db, { seulementPartagees: true, lignes: ['bsp-svp'] });
        verifier('BS-HOLO retrait (simulation) : « --partagees-holo » seul retire les partagées des Prize Packs ET des Black Star ; restreint à la ligne Black Star, il ne retire QUE l\'entrée Black Star de la fiche Mimikyu (pas son image Prize Pack)', [simAll.cartes.sort(), simAll.entrees, simSv.cartes, simSv.entrees, simSv.docs, simSv.parSet], [[244998, 278879], 3, [278879], 1, 1, { [SB]: 1 }]);
        const clesS = [];
        const rrS = await retirerLot(BS.db, { ecrire: true, effacerR2: true, seulementPartagees: true, lignes: ['bsp-svp'], supprimer: async (b, c) => clesS.push(...c), verifierBucket: async () => { }, bucket: 'bucket-banc' });
        verifier('BS-HOLO retrait restreint : la fiche Mimikyu perd son entrée et son document passe « retire » ; le Prize Pack (entrée, document) est INTACT ; seules les clés Black Star sont effacées ; la source reste ouverte',
            [BS.col('cartes').get(278879).images.map(e => e.set), BS.col('images').get(`pokumon/${SB}/278879/004/en`).etat, BS.col('cartes').get(244998).images.length, BS.col('images').get(`pokumon/${SP}/244998/056/en`).etat, BS.col('images').get(`pokumon/${SP}/278879/004/en`).etat, clesS.length > 0 && clesS.every(c => /Black-Star/.test(c)), BS.col('collecte_images_etat').get(P.ID_ALERTE)?.active ?? null, rrS.reste],
            [[SP], 'retire', 1, 'ok', 'ok', true, null, 0]);
        for (const [args, motifAttendu] of [[['--lignes=bsp-svp'], /--lignes n'a de sens qu'avec --partagees-holo/], [['--partagees-holo', '--lignes=nexistepas'], /ligne\(s\) inconnue\(s\) : nexistepas/], [['--partagees-holo', '--lignes=bsp-svp;x'], /argument inconnu/]]) {
            const r = spawnSync(process.execPath, [path.join(DIR, 'retirer-visuels-pokumon.js'), ...args], { encoding: 'utf8', timeout: 30000 });
            verifier(`ligne de commande du retrait « ${args.join(' ')} » : refusée avant toute connexion (code 2), pour la bonne raison`, [r.status, motifAttendu.test(r.stderr || '')], [2, true]);
        }
    }

    console.log(`\n${ko ? '❌' : '✅'} ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.stack); process.exit(1); });

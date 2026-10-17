// node test-collecteur-tpc.js — le collecteur TPC de BOUT EN BOUT (collecteur-images-tpc.js `collecterSet`), sur une base EN MÉMOIRE et un
// réseau SIMULÉ : aucune requête, aucune base réelle (la grappe de production est à 439 Mo, rien n'y est écrit). Le client et la preuve
// sont ceux de la production (collecte-cartes/tpc.js) ; la fiche servie est la fixture RÉELLE asie-id-fiche-7125.html (Spidops 001/SV-P) ;
// la liste est la même page réduite à cette fiche (une liste d'une carte : « resultNumber » 1, une page).
// Ce que le banc garde : la collecte additive (les entrées des autres sources ne bougent pas), la MENTION et le LOT sur chaque visuel, la
// REPRISE sans requête, un visuel RETIRÉ jamais repris, l'ARRÊT au premier blocage (et plus rien ensuite), la garde de TAILLE.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const T = require('./collecte-cartes/tpc');
const { ligneTpc, uniteDeLaLigne } = require('./collecte-cartes/tpc-sets');
const { collecterSet } = require('./collecteur-images-tpc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const F = f => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'tpc-fixtures', f), 'utf8');
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ── une base en mémoire : les seules formes de requête que le collecteur emploie ──────────────────────────────────────
function fausseBase({ dataSize = 1000, indexSize = 100 } = {}) {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : false)
        : lire(d, k) === v);
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

const SLUG = 'Scarlet-Violet-Indonesian-Promos';
function semer(B) {
    B.col('sets').set(SLUG, { _id: SLUG, tirage: 'id', region: 'intl' });
    B.col('cartes').set(1, { _id: 1, nomEn: 'Spidops', categorie: 'pokemon', ndex: 918, pv: 120, images: [{ set: 'Autre-Set', source: 'tcgdex', numero: '5', cleR2: 'tcgdex/x.webp' }] });
    B.col('cartes').set(2, { _id: 2, nomEn: 'Pikachu', categorie: 'pokemon', images: [{ set: SLUG, source: 'tcgdex', numero: '002', cleR2: 'tcgdex/y.webp' }] });
    B.col('cartes_produits').set('1|10', { _id: '1|10', carteId: 1, idProduct: 10, numeroFiche: '001', slugSet: SLUG });
    B.col('cartes_produits').set('2|11', { _id: '2|11', carteId: 2, idProduct: 11, numeroFiche: '002', slugSet: SLUG });
}
const LISTE = F('asie-id-liste-SV-P-page1.html').replace(/class="resultNumber">251</, 'class="resultNumber">1<').replace(/Total 13 halaman/, 'Total 1 halaman')
    .replace(/<li class="card">\s*<a href="\/id\/card-search\/detail\/71(2[6-9]|3\d|4[0-4])\/">[\s\S]*?<\/li>/g, '');

(async () => {
    const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
    const reseau = (repondre) => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    const normal = url => url.endsWith('/robots.txt') ? { status: 200, texte: '' }
        : url.includes('/card-search/list/') ? { status: 200, texte: LISTE }
            : url.endsWith('/card-search/detail/7125/') ? { status: 200, texte: F('asie-id-fiche-7125.html') }
                : url.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: png }
                    : { status: 404, texte: 'non' };
    const verrou = { tenu: true, perdu: false };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    // la ligne de table réelle, au nombre de cartes de la liste de banc (1) : la garde du total de liste compare à `cartes`
    const ligneBanc = (site, slug) => { const L = ligneTpc(site, slug); return L && { ...L, cartes: 1 }; };
    const lancer = async (B, tr, o = {}) => {
        const depots = [];
        const client = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
        const r = silencieux();
        try { return { b: await collecterSet(o.unite || uniteDeLaLigne(ligneTpc('tpc-asie', SLUG)), B.M, { verrou, client, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: verrouSet, stopOctets: o.stopOctets, ligneDe: o.ligneDe || ligneBanc }), depots }; }
        finally { r(); }
    };
    verifier('la liste de banc ne porte que la fiche 7125', T.lireListeAsie(LISTE), { total: 1, pages: 1, ids: [7125] });

    // ── 1. la collecte ────────────────────────────────────────────────────────────────────────────────────────────
    const B = fausseBase(); semer(B);
    let tr = reseau(normal);
    let { b, depots } = await lancer(B, tr);
    verifier('une unité complète → « verifie »', b.etat, 'verifie');
    verifier('requêtes : robots.txt, la liste, la fiche, l\'image — rien d\'autre', tr.appels.map(u => u.replace('https://asia.pokemon-card.com', '')),
        ['/robots.txt', '/id/card-search/list/?expansionCodes=SV-P', '/id/card-search/detail/7125/', '/id/card-img/id00007125.png']);
    const im = B.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id');
    verifier('le document `images` : source, langue, MENTION, LOT, état, preuve', [im?.source, im?.langue, im?.mention, im?.lot, im?.etat, /001\/SV-P/.test(im?.preuve || '') && /Spidops/.test(im?.preuve || '')],
        ['tpc-asie', 'id', '© Pokémon / The Pokémon Company', 'tpc-2026-10', 'ok', true]);
    verifier('R2 AVANT la ligne : un dépôt WebP, à la clé du set', [depots.length, depots[0]?.[1], depots[0]?.[3]], [1, 'tpc-asie/Scarlet-Violet-Indonesian-Promos/001-1-id.webp', 'image/webp']);
    const c1 = B.col('cartes').get(1), c2 = B.col('cartes').get(2);
    verifier('la carte reçoit SON visuel, et garde celui de l\'autre set', c1.images.map(e => `${e.source}:${e.set}:${e.numero}`), ['tcgdex:Autre-Set:5', `tpc-asie:${SLUG}:001`]);
    verifier('   l\'entrée porte la mention, le lot, la langue', [c1.images[1].mention, c1.images[1].lot, c1.images[1].langue, c1.images[1].attribution], ['© Pokémon / The Pokémon Company', 'tpc-2026-10', 'id', '© Pokémon / The Pokémon Company']);
    verifier('une carte déjà servie à ce numéro par une autre source : intacte (additif)', c2.images.map(e => `${e.source}:${e.numero}`), ['tcgdex:002']);
    verifier('le bilan du set : 1 prouvé, garde verte', [B.col('sets').get(SLUG).visuelsTpc?.['tpc-asie']?.prouves, B.col('sets').get(SLUG).visuelsTpc?.['tpc-asie']?.garde?.ok], [1, true]);
    verifier('la fiche lue est gardée (`tpc_fiches`)', [...B.col('tpc_fiches').keys()], ['tpc-asie/id/7125']);

    // ── 2. la reprise : aucune requête ───────────────────────────────────────────────────────────────────────────────
    tr = reseau(normal);
    ({ b, depots } = await lancer(B, tr));
    verifier('un second passage : « verifie », 0 requête, 0 dépôt, pas de doublon', [b.etat, tr.appels.length, depots.length, B.col('cartes').get(1).images.length], ['verifie', 0, 0, 2]);

    // ── 3. une autre source sert ce numéro entre deux passages : la nôtre lui CÈDE la place ────────────────────────────
    B.col('cartes').get(1).images.push({ set: SLUG, source: 'tcgdex', numero: '001', cleR2: 'tcgdex/z.webp' });
    tr = reseau(normal);
    ({ b } = await lancer(B, tr));
    verifier('une autre source au même numéro : son entrée reste, la nôtre sort, garde verte', [b.etat, B.col('cartes').get(1).images.map(e => `${e.source}:${e.set}:${e.numero}`), b.garde?.ok],
        ['verifie', ['tcgdex:Autre-Set:5', `tcgdex:${SLUG}:001`], true]);

    // ── 3 bis. une carte DÉJÀ servie à ce numéro avant le passage : ni téléchargement, ni entrée (additif) ─────────────────
    const B1 = fausseBase(); semer(B1);
    B1.col('cartes').get(1).images.push({ set: SLUG, source: 'tcgdex', numero: '001', cleR2: 'tcgdex/w.webp' });
    tr = reseau(normal);
    ({ b, depots } = await lancer(B1, tr));
    verifier('déjà servie avant : 0 dépôt, aucune entrée TPC, l\'entrée existante intacte', [depots.length, B1.col('cartes').get(1).images.map(e => `${e.source}:${e.numero}`), b.trous], [0, ['tcgdex:5', 'tcgdex:001'], 0]);

    // ── 3 ter. ➕ BASSE-DEF : une entrée MARQUÉE d'une autre source (même set, numéro, langue) est REMPLACÉE par une image TPC non marquée ───────────────────────────────
    {
        const MARQ = { set: SLUG, source: 'pikaqian', numero: '001', cleR2: 'pikaqian/basse.webp', langue: 'id', w: 300, basseDefinition: true };
        const monde = (images = [MARQ]) => { const Bx = fausseBase(); semer(Bx); Bx.col('cartes').get(1).images.push(...structuredClone(images));
            Bx.col('images').set('mq', { _id: 'mq', source: 'pikaqian', set: SLUG, carteId: 1, cleR2: MARQ.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png', wOriginal: 300 }); return Bx; };
        const avecImage = octets => url => url.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets } : normal(url);
        const etroite = await sharp({ create: { width: 300, height: 418, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
        const des = Bx => Bx.col('cartes').get(1).images.filter(e => e.set === SLUG).map(e => `${e.source}:${e.basseDefinition === true}`);
        { const Bx = monde(); const trX = reseau(avecImage(png)); const r = await lancer(Bx, trX);
          verifier('REMPLACEMENT : 734 px (non marquée) + une entrée MARQUÉE d\'une autre source au même (set, numéro, langue) → TPC remplace, sans marque ; garde verte', [r.b.etat, des(Bx), r.b.garde?.ok, trX.appels.filter(u => /\.png$/.test(u)).length], ['verifie', ['tpc-asie:false'], true, 1]);
          verifier('   traçabilité : le document `images` de l\'ancienne RESTE (« remplace », remplacePar, remplaceLe), avec son adresse d\'origine et sa clé R2', [Bx.col('images').get('mq').etat, Bx.col('images').get('mq').remplacePar, !!Bx.col('images').get('mq').remplaceLe, Bx.col('images').get('mq').urlOriginal, Bx.col('images').get('mq').cleR2], ['remplace', { source: 'tpc-asie', cleR2: 'tpc-asie/Scarlet-Violet-Indonesian-Promos/001-1-id.webp' }, true, 'https://hote.example/ancienne.png', 'pikaqian/basse.webp']); }
        { const Bx = monde(); const r = await lancer(Bx, reseau(avecImage(etroite)));
          verifier('JAMAIS L\'INVERSE : 300 px (marquée) face à une entrée marquée → TPC CÈDE : l\'entrée marquée reste, son document n\'est pas touché', [r.b.etat, des(Bx), Bx.col('images').get('mq').etat], ['verifie', ['pikaqian:true'], 'ok']); }
        { const Bx = monde([{ ...MARQ, basseDefinition: undefined, w: 600 }]); const trX = reseau(avecImage(png)); const r = await lancer(Bx, trX);
          verifier('une entrée NON marquée n\'est jamais remplacée : rien n\'est téléchargé (la fiche est servie), l\'entrée reste', [des(Bx), Bx.col('images').get('mq').etat, trX.appels.filter(u => /\.png$/.test(u)).length], [['pikaqian:false'], 'ok', 0]); }
        { const Bx = monde([{ ...MARQ, langue: 'th' }]); const trX = reseau(avecImage(png)); await lancer(Bx, trX);
          verifier('une entrée marquée d\'une AUTRE langue n\'est pas remplaçable : rien n\'est téléchargé', [des(Bx), trX.appels.filter(u => /\.png$/.test(u)).length], [['pikaqian:true'], 0]); }
        { const Bx = monde([{ ...MARQ, source: 'tpc-asie' }]); const trX = reseau(avecImage(png)); await lancer(Bx, trX);
          verifier('une entrée marquée de TPC lui-même n\'est pas retéléchargée (le même fichier reviendrait)', [trX.appels.filter(u => /\.png$/.test(u)).length], [0]); }
        { // course : l'entrée marquée est posée PENDANT la collecte (après le plan) ; la jointure arbitre
          const Bx = fausseBase(); semer(Bx);
          const trX = reseau(url => { if (url.endsWith('/card-img/id00007125.png')) { Bx.col('cartes').get(1).images.push(structuredClone(MARQ)); Bx.col('images').set('mq', { _id: 'mq', source: 'pikaqian', set: SLUG, carteId: 1, cleR2: MARQ.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png' }); } return normal(url); });
          const r = await lancer(Bx, trX);
          verifier('JOINTURE : une entrée marquée posée entre le plan et la jointure est remplacée à la jointure (même arbitrage), garde verte', [des(Bx), Bx.col('images').get('mq')?.etat, r.b.garde?.ok], [['tpc-asie:false'], 'remplace', true]); }
    }

    // ── 4. un visuel RETIRÉ n'est jamais repris ───────────────────────────────────────────────────────────────────────
    const B2 = fausseBase(); semer(B2);
    await lancer(B2, reseau(normal));
    B2.col('cartes').get(1).images = B2.col('cartes').get(1).images.filter(e => e.source !== 'tpc-asie');
    B2.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id').etat = 'retire';
    B2.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id').urlOriginal = 'https://asia.pokemon-card.com/id/card-img/ancienne.png';
    tr = reseau(normal);
    ({ b, depots } = await lancer(B2, tr));
    verifier('retiré : ni téléchargé (même si l\'URL a changé), ni rejoint', [tr.appels.length, depots.length, B2.col('cartes').get(1).images.some(e => e.source === 'tpc-asie'), b.retires], [0, 0, false, 1]);

    // ── 5. la source BLOQUE : on s'arrête, et plus rien ensuite ───────────────────────────────────────────────────────
    const B3 = fausseBase(); semer(B3);
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 403, texte: 'Forbidden' });
    ({ b } = await lancer(B3, tr));
    const alerte = B3.col('collecte_images_etat').get('alerte/source-bloquee/tpc-asie');
    verifier('403 sur la liste → « refuse-source-bloquee », alerte active, aucune écriture de visuel', [b.etat, alerte?.active, alerte?.status, B3.col('images').size], ['refuse-source-bloquee', true, 403, 0]);
    tr = reseau(normal);
    ({ b } = await lancer(B3, tr));
    verifier('une unité suivante sur le site bloqué : refusée, ZÉRO requête', [b.etat, tr.appels.length], ['refuse-source-bloquee', 0]);

    // ── 6. la TAILLE de la base : au-delà du seuil, STOP avant toute requête ──────────────────────────────────────────
    const B4 = fausseBase({ dataSize: 300, indexSize: 300 }); semer(B4);
    tr = reseau(normal);
    ({ b } = await lancer(B4, tr, { stopOctets: 500 }));
    verifier('base au-dessus du seuil → « refuse-taille-base », alerte écrite, 0 requête', [b.etat, B4.col('collecte_images_etat').get('alerte/taille-base')?.active, tr.appels.length], ['refuse-taille-base', true, 0]);
    verifier('le seuil de production est 400 Mo', require('./collecteur-images-tpc').STOP_OCTETS, 400 * 1024 * 1024);

    // ── 7. la garde de l'unité, par ce qu'elle autorise ─────────────────────────────────────────────────────────────
    const B5 = fausseBase(); semer(B5);
    tr = reseau(normal);
    ({ b } = await lancer(B5, tr, { unite: { ...uniteDeLaLigne(ligneTpc('tpc-asie', SLUG)), code: 'M-P' } }));
    verifier('une unité qui ne porte pas sa ligne mot pour mot → refusée, 0 requête', [b.etat, tr.appels.length], ['refuse-table', 0]);
    B5.col('sets').get(SLUG).tirage = 'th';
    ({ b } = await lancer(B5, tr));
    verifier('un set au mauvais tirage en base → refusé, 0 requête', [b.etat, tr.appels.length], ['refuse-set', 0]);

    // ── 8. relecture du 2026-10-07 : les cas qu'un « verifie » ne doit pas couvrir ──────────────────────────────────────
    // une liste dont le total s'écarte de la mesure (la source ignorerait son filtre) : refusée AVANT toute fiche
    const B6 = fausseBase(); semer(B6);
    tr = reseau(u => u.includes('/card-search/list/') ? { status: 200, texte: F('asie-id-liste-SV-P-page1.html') } : normal(u));
    ({ b } = await lancer(B6, tr));
    verifier('liste à 251 cartes pour une mesure de 1 → « refuse-liste », aucune fiche lue', [b.etat, tr.appels.filter(u => u.includes('/detail/')).length], ['refuse-liste', 0]);
    // un set sans produit joint : rien à combler, rien à demander — pas un « verifie »
    const B7 = fausseBase(); semer(B7); B7.col('cartes_produits').clear();
    tr = reseau(normal);
    ({ b } = await lancer(B7, tr));
    verifier('aucun produit joint au set → « refuse-set », 0 requête', [b.etat, tr.appels.length], ['refuse-set', 0]);
    // une fiche listée qui répond 404 : la liste et la source se contredisent — l'unité n'est pas « verifie »
    const LISTE2 = LISTE.replace(/class="resultNumber">1</, 'class="resultNumber">2<').replace('</ul>', '<li class="card"><a href="/id/card-search/detail/7126/"></a></li></ul>');
    const B8 = fausseBase(); semer(B8);
    tr = reseau(u => u.includes('/card-search/list/') ? { status: 200, texte: LISTE2 } : normal(u));
    ({ b } = await lancer(B8, tr, { ligneDe: (s, sl) => ({ ...ligneTpc(s, sl), cartes: 2 }) }));
    verifier('une fiche listée en 404 → « incomplet », et la fiche prouvée est quand même jointe', [b.etat, b.compteurs?.['fiche-404'], B8.col('cartes').get(1).images.some(e => e.source === 'tpc-asie')], ['incomplet', 1, true]);
    // une image sous le seuil de largeur : écrite « trop-petit », jamais redemandée au passage suivant
    const petit = await sharp({ create: { width: 200, height: 279, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const B9 = fausseBase(); semer(B9);
    const avecPetite = u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: petit } : normal(u);
    ({ b } = await lancer(B9, reseau(avecPetite)));
    verifier('image de 200 px → « trop-petit », comptée, rien de joint', [b.etat, b.tropPetits, B9.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id')?.etat, B9.col('cartes').get(1).images.length], ['verifie', 1, 'trop-petit', 1]);
    tr = reseau(avecPetite);
    ({ b } = await lancer(B9, tr));
    verifier('   au passage suivant : 0 requête (la même URL, déjà jugée trop petite)', tr.appels.length, 0);
    // décision du testeur (2026-10-12) : 257 px pour une source OFFICIELLE — 320 px passe (350 le refusait), 250 px reste trop petit
    const moyen = await sharp({ create: { width: 320, height: 447, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const B9b = fausseBase(); semer(B9b);
    ({ b } = await lancer(B9b, reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: moyen } : normal(u))));
    verifier('image de 320 px (source officielle, seuil 257) → « ok », servie, rien de trop petit', [b.tropPetits, B9b.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id')?.etat], [0, 'ok']);
    // ➕ BASSE DÉFINITION : 320 px est sous 350 → la marque sur le document `images` ET sur l'entrée `cartes.images` ; l'original est la mesure
    verifier('   320 px → `basseDefinition: true` sur le document images et sur l\'entrée de la carte',
        [B9b.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id')?.basseDefinition, B9b.col('cartes').get(1).images.find(e => e.source === 'tpc-asie')?.basseDefinition, B9b.col('cartes').get(1).images.find(e => e.source === 'tpc-asie')?.w], [true, true, 320]);
    verifier('   734 px (le cas normal) → AUCUNE marque, ni sur le document ni sur l\'entrée',
        [im?.basseDefinition, 'basseDefinition' in (c1.images[1] || {})], [undefined, false]);
    const limite = await sharp({ create: { width: 349, height: 487, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const B9d = fausseBase(); semer(B9d);
    await lancer(B9d, reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: limite } : normal(u)));
    verifier('   349 px → marquée (350 est la limite)', B9d.col('cartes').get(1).images.find(e => e.source === 'tpc-asie')?.basseDefinition, true);
    const pile = await sharp({ create: { width: 350, height: 488, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const B9e = fausseBase(); semer(B9e);
    await lancer(B9e, reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: pile } : normal(u)));
    verifier('   350 px → pas marquée', B9e.col('cartes').get(1).images.find(e => e.source === 'tpc-asie')?.basseDefinition, undefined);
    const presque = await sharp({ create: { width: 250, height: 349, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const B9c = fausseBase(); semer(B9c);
    ({ b } = await lancer(B9c, reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: presque } : normal(u))));
    verifier('image de 250 px → « trop-petit » (sous 257)', [b.tropPetits, B9c.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id')?.etat], [1, 'trop-petit']);
    // tour de correction 1 : une décision de seuil se RELIT (§23). Le document écrit « trop-petit » porte le seuil appliqué...
    verifier('un trop-petit écrit porte `seuilApplique` (257 pour tpc-asie)', B9c.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id')?.seuilApplique, 257);
    // ...et un trop-petit ANTÉRIEUR (sans `seuilApplique` = jugé à 350) de 320 px est REJUGÉ au passage suivant, même URL
    const URL_7125 = 'https://asia.pokemon-card.com/id/card-img/id00007125.png';
    const ID_7125 = 'tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id';
    const ancien = (Bx, w) => Bx.col('images').set(ID_7125, { _id: ID_7125, source: 'tpc-asie', set: SLUG, urlOriginal: URL_7125, wOriginal: w, etat: 'trop-petit' });
    const B13 = fausseBase(); semer(B13); ancien(B13, 320);
    tr = reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: moyen } : normal(u));
    ({ b } = await lancer(B13, tr));
    verifier('trop-petit ancien à 320 px, sans seuilApplique → rejugé (téléchargé), devient « ok »', [B13.col('images').get(ID_7125)?.etat, tr.appels.some(u => u.endsWith('id00007125.png'))], ['ok', true]);
    // un trop-petit ancien à 250 px reste trop petit, SANS requête : la largeur stockée suffit à conclure
    const B14 = fausseBase(); semer(B14); ancien(B14, 250);
    tr = reseau(normal);
    ({ b } = await lancer(B14, tr));
    verifier('trop-petit ancien à 250 px → reste trop-petit, 0 téléchargement de l\'image', [B14.col('images').get(ID_7125)?.etat, tr.appels.some(u => u.endsWith('id00007125.png'))], ['trop-petit', false]);
    // un trop-petit déjà jugé À 257 (seuilApplique 257) de 250 px : rien à relire
    const B15 = fausseBase(); semer(B15); ancien(B15, 250); B15.col('images').get(ID_7125).seuilApplique = 257;
    tr = reseau(normal);
    ({ b } = await lancer(B15, tr));
    verifier('trop-petit jugé à 257, 250 px → reste, 0 téléchargement', [B15.col('images').get(ID_7125)?.etat, tr.appels.some(u => u.endsWith('id00007125.png'))], ['trop-petit', false]);
    // ➕ LES 255 : un trop-petit jugé À 300 (seuilApplique 300), 280 px d'original → REJUGÉ à 257, téléchargé, « ok », marqué basse définition, joint
    const moyen280 = await sharp({ create: { width: 280, height: 391, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const B16 = fausseBase(); semer(B16); ancien(B16, 280); B16.col('images').get(ID_7125).seuilApplique = 300;
    tr = reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: moyen280 } : normal(u));
    ({ b } = await lancer(B16, tr));
    const d16 = B16.col('images').get(ID_7125), e16 = B16.col('cartes').get(1).images.find(e => e.source === 'tpc-asie');
    verifier('trop-petit jugé à 300, 280 px → rejugé : téléchargé, « ok », `basseDefinition` sur le document et l\'entrée',
        [d16?.etat, tr.appels.some(u => u.endsWith('id00007125.png')), d16?.basseDefinition, e16?.basseDefinition, e16?.w], ['ok', true, true, true, 280]);
    // et une image qui redevient assez large (≥ 350) à un passage ultérieur efface la marque du document (une marque ne survit pas à ce qu'elle décrivait)
    const gros = await sharp({ create: { width: 500, height: 698, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    B16.col('images').get(ID_7125).urlOriginal = 'https://asia.pokemon-card.com/id/card-img/ancienne.png';
    B16.col('cartes').get(1).images = B16.col('cartes').get(1).images.filter(e => e.source !== 'tpc-asie');
    tr = reseau(u => u.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: gros } : normal(u));
    ({ b } = await lancer(B16, tr));
    verifier('   la même image, refournie à 500 px → plus de marque sur le document ni sur l\'entrée',
        [B16.col('images').get(ID_7125)?.basseDefinition, B16.col('cartes').get(1).images.find(e => e.source === 'tpc-asie')?.basseDefinition], [undefined, undefined]);
    // une exception PENDANT la jointure : l'unité rend « incomplet » (la page se revalide), elle ne lève pas
    const B10 = fausseBase(); semer(B10);
    const ecrire = B10.M.Carte.updateOne;
    B10.M.Carte.updateOne = async (f, u, o) => { if (u.$push) throw new Error('écriture refusée (banc)'); return ecrire(f, u, o); };
    ({ b } = await lancer(B10, reseau(normal)));
    verifier('exception pendant la jointure → « incomplet », l\'erreur écrite, pas de « sansJointure »', [b.etat, /refusée \(banc\)/.test(b.erreur || ''), b.sansJointure ?? false], ['incomplet', true, false]);

    // ── 9. seconde relecture ────────────────────────────────────────────────────────────────────────────────────────
    // une ligne sans compte mesuré : la garde du total ne peut pas conclure → elle refuse (une garde ne passe pas par défaut)
    const B11 = fausseBase(); semer(B11);
    tr = reseau(normal);
    ({ b } = await lancer(B11, tr, { ligneDe: (s, sl) => { const { cartes, ...L } = ligneTpc(s, sl); return L; } }));
    verifier('ligne sans `cartes` → « refuse-liste », aucune fiche', [b.etat, tr.appels.filter(u => u.includes('/detail/')).length], ['refuse-liste', 0]);
    // un visuel déjà joint dont la source change d'adresse (et ne répond plus) : la carte est SERVIE à ce numéro, ce n'est plus un trou —
    // rien n'est redemandé, le document reste « ok », la garde reste verte (la seconde relecture craignait une entrée périmée à vie)
    const B12 = fausseBase(); semer(B12);
    await lancer(B12, reseau(normal));
    B12.col('tpc_fiches').get('tpc-asie/id/7125').fiche.image = 'https://asia.pokemon-card.com/id/card-img/nouvelle.png';
    tr = reseau(u => u.endsWith('/nouvelle.png') ? { status: 503, texte: '' } : normal(u));
    ({ b } = await lancer(B12, tr));
    verifier('nouvelle adresse : 0 requête, document « ok », visuel servi, garde verte, « verifie »',
        [tr.appels.length, B12.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id').etat, B12.col('cartes').get(1).images.some(e => e.source === 'tpc-asie'), b.garde?.ok, b.etat], [0, 'ok', true, true, 'verifie']);

    // ── 10. LIGNE À DEMI-LISTES (lot TPC-AS) : AS1 = AS1a + AS1b, le préfixe de notre numéro EST la liste ────────────────────
    const SLUG_AS = 'First-Impact';
    const ficheAsie = (n, nom, { dex, pv, den = '150', img }) => `<h1 class="pageHeader cardDetail">${nom}</h1><span class="collectorNumber">${n} / ${den}</span><span class="hitPoint">HP</span> <span class="number">${pv}</span><div class="extraInformation"><h3>No. ${dex}</h3></div><div class="cardImage"><img src="/id/card-img/${img}.png"></div>`;
    const listeAsie = (total, ...ids) => `${total == null ? '' : `<span class="resultNumber">${total}</span>`}<span class="resultTotalPages">Total 1 halaman</span>${ids.map(i => `<li class="card"><a href="/id/card-search/detail/${i}/"></a></li>`).join('')}`;
    const semerAS = (B, numA = 'a019', numB = 'b016') => {
        B.col('sets').set(SLUG_AS, { _id: SLUG_AS, tirage: 'idth', region: 'intl' });
        B.col('cartes').set(1, { _id: 1, nomEn: 'Shining Celebi', categorie: 'pokemon', ndex: 251, pv: 70, images: [] });
        B.col('cartes').set(2, { _id: 2, nomEn: 'Espeon GX', categorie: 'pokemon', ndex: 196, pv: 200, images: [] });
        B.col('cartes_produits').set('1|10', { _id: '1|10', carteId: 1, idProduct: 10, numeroFiche: numA, slugSet: SLUG_AS });
        B.col('cartes_produits').set('2|11', { _id: '2|11', carteId: 2, idProduct: 11, numeroFiche: numB, slugSet: SLUG_AS });
    };
    const ligneAS = (s, sl) => { const L = ligneTpc(s, sl); return L && { ...L, cartes: 2, listes: L.listes.map(l => ({ ...l, cartes: 1 })) }; };
    const uniteAS = uniteDeLaLigne(ligneTpc('tpc-asie', SLUG_AS));
    const asie = (totalB = 1, totalA = 1) => u => u.endsWith('/robots.txt') ? { status: 200, texte: '' }
        : u.includes('expansionCodes=AS1a') ? { status: 200, texte: listeAsie(totalA, 9019) }
            : u.includes('expansionCodes=AS1b') ? { status: 200, texte: listeAsie(totalB, 9116) }
                : u.endsWith('/detail/9019/') ? { status: 200, texte: ficheAsie('019', 'Celebi Bersinar', { dex: 251, pv: 70, img: 'a019' }) }
                    : u.endsWith('/detail/9116/') ? { status: 200, texte: ficheAsie('016', 'EspeonGX', { dex: 196, pv: 200, img: 'b016' }) }
                        : /\/card-img\/[ab]0\d\d\.png$/.test(u) ? { status: 200, type: 'image/png', octets: png }
                            : { status: 404, texte: 'non' };
    const BA = fausseBase(); semerAS(BA);
    tr = reseau(asie());
    ({ b, depots } = await lancer(BA, tr, { unite: uniteAS, ligneDe: ligneAS }));
    verifier('AS1 : « verifie », 2 prouvés (a019 et b016), chacun dans SA liste',
        [b.etat, b.prouves, tr.appels.map(u => u.replace('https://asia.pokemon-card.com', '')).filter(u => !u.startsWith('/id/card-img'))],
        ['verifie', 2, ['/robots.txt', '/id/card-search/list/?expansionCodes=AS1a', '/id/card-search/list/?expansionCodes=AS1b', '/id/card-search/detail/9019/', '/id/card-search/detail/9116/']]);
    verifier('   les cartes reçoivent leur visuel au numéro AVEC préfixe', [BA.col('cartes').get(1).images.map(e => `${e.source}:${e.set}:${e.numero}`), BA.col('cartes').get(2).images.map(e => e.numero)], [[`tpc-asie:${SLUG_AS}:a019`], ['b016']]);
    verifier('   documents `images` distincts par préfixe, clé R2 au numéro préfixé', [BA.col('images').has('tpc-asie/First-Impact/1/a019/id'), BA.col('images').has('tpc-asie/First-Impact/2/b016/id'), depots.map(d => d[1]).sort()],
        [true, true, ['tpc-asie/First-Impact/a019-1-id.webp', 'tpc-asie/First-Impact/b016-2-id.webp']]);
    verifier('   l\'état garde chaque liste sous son préfixe', [BA.col('collecte_images_etat').get(`tpc-asie/${SLUG_AS}`)?.listes?.a?.total, BA.col('collecte_images_etat').get(`tpc-asie/${SLUG_AS}`)?.listes?.b?.code], [1, 'AS1b']);
    // la reprise : listes et fiches gardées, 0 requête
    tr = reseau(asie());
    ({ b } = await lancer(BA, tr, { unite: uniteAS, ligneDe: ligneAS }));
    verifier('   un second passage : « verifie », 0 requête', [b.etat, tr.appels.length], ['verifie', 0]);
    // une liste dont le total s'écarte de la mesure DE SA LISTE → la ligne est refusée avant toute fiche
    const BB = fausseBase(); semerAS(BB);
    tr = reseau(asie(99));
    ({ b } = await lancer(BB, tr, { unite: uniteAS, ligneDe: ligneAS }));
    verifier('une liste (b) au total hors mesure → « refuse-liste », aucune fiche lue, rien joint', [b.etat, tr.appels.filter(u => u.includes('/detail/')).length, BB.col('images').size], ['refuse-liste', 0, 0]);
    // le total se compare à CELUI DE SA LISTE (jamais à la somme des listes : 23 + 1 passerait contre 2×2+20), borne haute ET basse, et `null` refuse
    for (const [nom, tb, ta] of [['borne haute de b (23 > 2×1+20, la somme 24 serait passée)', 23, 1], ['borne haute de a', 1, 23], ['borne basse (0 < ½)', 0, 1], ['total illisible (null)', null, 1]]) {
        const BT = fausseBase(); semerAS(BT);
        tr = reseau(asie(tb, ta));
        ({ b } = await lancer(BT, tr, { unite: uniteAS, ligneDe: ligneAS }));
        verifier(`liste hors mesure — ${nom} → « refuse-liste », aucune fiche`, [b.etat, tr.appels.filter(u => u.includes('/detail/')).length], ['refuse-liste', 0]);
    }
    // un produit sans préfixe sur la ligne : un trou, rien de téléchargé pour lui
    const BC = fausseBase(); semerAS(BC, '019', 'b016');
    tr = reseau(asie());
    ({ b, depots } = await lancer(BC, tr, { unite: uniteAS, ligneDe: ligneAS }));
    verifier('un produit sans préfixe (019) → trou « prefixe-absent », seul b016 est téléchargé', [b.etat, b.prouves, b.restes, depots.map(d => d[1])], ['verifie', 1, { 'prefixe-absent': 1 }, ['tpc-asie/First-Impact/b016-2-id.webp']]);

    // ── 11. `--plan-reel` : lit à la source, apparie, ne télécharge rien et n'écrit rien dans la base ─────────────────────────
    const os = require('os');
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reel-'));
    const fichierCache = path.join(dossier, 'plan-reel.json');
    const fauxVerrou = (tenuPar = null) => { const v = { appels: [], tenu: !tenuPar, perdu: false, async prendre() { v.appels.push('prendre'); return tenuPar; }, async rendre() { v.appels.push('rendre'); } }; return v; };
    const BP = fausseBase(); semerAS(BP);
    const empreinte = () => JSON.stringify([...BP.cols].filter(([, m]) => m.size).map(([n, m]) => [n, [...m]]));   // une collection LUE mais vide n'est pas une écriture
    const avant = empreinte();
    let vp = fauxVerrou(); tr = reseau(asie());
    let r = silencieux(), R;
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BP.db }, M: BP.M, sets: [SLUG_AS], fichierCache, verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneAS }); } finally { r(); }
    verifier('plan réel : 2 prouvés, 5 requêtes (robots, 2 listes, 2 fiches), AUCUNE image demandée', [R.bilan[0]?.prouves, R.requetes, tr.appels.some(u => u.includes('/card-img/'))], [2, 5, false]);
    verifier('   le verrou global est pris puis rendu', vp.appels, ['prendre', 'rendre']);
    verifier('   la base n\'a pas bougé d\'un octet (ni `images`, ni `tpc_fiches`, ni l\'état, ni les cartes)', empreinte(), avant);
    verifier('   les listes et les fiches sont gardées dans le cache LOCAL', fs.existsSync(fichierCache) && Object.keys(JSON.parse(fs.readFileSync(fichierCache, 'utf8')).tpc_fiches).length, 2);
    vp = fauxVerrou(); tr = reseau(asie());
    r = silencieux();
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BP.db }, M: BP.M, sets: [SLUG_AS], fichierCache, verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneAS }); } finally { r(); }
    verifier('   un second passage : 0 requête (cache local), même plan', [R.bilan[0]?.prouves, tr.appels.length], [2, 0]);
    // --fiches-des-trous : seules les fiches des numéros voulus ; un numéro qu'on n'a pas pu lire n'est jamais dit « absent de la source »
    const BQ = fausseBase(); semerAS(BQ, 'a019', 'b050');
    vp = fauxVerrou(); tr = reseau(asie());
    r = silencieux();
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BQ.db }, M: BQ.M, sets: [SLUG_AS], fichierCache: path.join(dossier, 'q.json'), verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneAS, seulementTrous: true }); } finally { r(); }
    verifier('plan des trous : a019 prouvé par la fiche lue ; b050 introuvable par position → « fiche-non-lue », pas « absente-de-la-source »',
        [R.bilan[0]?.prouves, R.bilan[0]?.trousParCause, tr.appels.some(u => u.includes('/card-img/'))], [1, { 'fiche-non-lue': 1 }, false]);
    // la position se vérifie par la CLÉ DE PRODUCTION (préfixe compris) : une fiche « 001 » ne valide jamais « p001 »
    const BR = fausseBase(); semer(BR); BR.col('cartes_produits').get('1|10').numeroFiche = 'p001';
    vp = fauxVerrou(); tr = reseau(normal);
    r = silencieux();
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BR.db }, M: BR.M, sets: [SLUG], fichierCache: path.join(dossier, 'r.json'), verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneBanc, seulementTrous: true }); } finally { r(); }
    verifier('fiche « 001 » face à un numéro « p001 » : jamais validée → « fiche-non-lue » (la position ne prouve rien)', [R.bilan[0]?.prouves, R.bilan[0]?.trousParCause?.['fiche-non-lue'] ?? 0], [0, 1]);
    // mode plan : AUCUNE écriture hors du verrou, même quand la source bloque — l'arrêt se rapporte dans la sortie ; les statuts HTTP se comptent par hôte
    const BS = fausseBase(); semerAS(BS);
    vp = fauxVerrou(); tr = reseau(u => u.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 403, texte: 'Forbidden' });
    r = silencieux();
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BS.db }, M: BS.M, sets: [SLUG_AS], fichierCache: path.join(dossier, 's.json'), verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneAS }); } finally { r(); }
    verifier('plan réel bloqué (403) : arrêt rapporté, AUCUNE alerte écrite en base, verrou rendu', [R.arret, [...BS.col('collecte_images_etat').keys()], vp.appels], ['bloque', [], ['prendre', 'rendre']]);
    verifier('   les statuts HTTP sont comptés par hôte (200 robots.txt, 403 de la liste)', R.statutsHttp, { 'https://asia.pokemon-card.com': { 200: 1, 403: 1 } });
    vp = fauxVerrou(); tr = reseau(asie());
    r = silencieux();
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BP.db }, M: BP.M, sets: [SLUG_AS], fichierCache: path.join(dossier, 'p2.json'), verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneAS }); } finally { r(); }
    verifier('plan réel normal : 5 statuts 200 comptés, aucun 3xx/403/429/5xx', R.statutsHttp, { 'https://asia.pokemon-card.com': { 200: 5 } });
    vp = fauxVerrou({ pid: 7, hote: 'ailleurs', ageS: 5 }); tr = reseau(asie());
    r = silencieux();
    try { R = await require('./collecteur-images-tpc').planReel({ cx: { db: BP.db }, M: BP.M, sets: [SLUG_AS], fichierCache, verrouAttendu: vp, transport: tr, cadenceMs: 0, ligneDe: ligneAS }); } finally { r(); }
    verifier('verrou global tenu par un autre → on s\'arrête, 0 requête, le verrou d\'un autre n\'est pas rendu', [R.arret, tr.appels.length, vp.appels], ['verrou-tenu', 0, ['prendre']]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });

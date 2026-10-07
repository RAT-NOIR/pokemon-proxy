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

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });

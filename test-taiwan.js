// node test-taiwan.js — LOT TAIWAN (zh-hant, TPC Asie tw) : AUCUN REMPLACEMENT d'une entrée existante, quelle qu'elle soit, et la traçabilité d'une image neuve.
// Décision du testeur (2026-10-17) : « Taïwan reste ouvert, mais uniquement pour ce qui nous manque […] source: "tpc-asie" et retirable: true ».
// Banc PUR : base EN MÉMOIRE, réseau SIMULÉ (la fixture asie-id est un tirage d'essai : seule la mécanique du remplacement est jugée, pas le contenu
// taïwanais), aucune requête, aucune écriture réelle, aucun chemin du testeur.
// Ce que le banc garde, entrée existante par entrée existante (même set, même numéro, même langue qu'une image TPC qui serait prouvée) :
//   basse définition · empruntée à un autre tirage · déclarée fausse · correcte · correcte mais nettement plus petite · de TPC lui-même · posée PENDANT la collecte
// → en mode `sansRemplacement` : 0 trou, 0 téléchargement, l'entrée et son document intacts ; en mode normal (témoin) : le remplacement a lieu là où la règle commune le permet,
//   preuve que le banc MORD.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// « déclarée fausse » : la table fermée de la production est vide ; le banc en injecte une clé AVANT que la règle commune ne la lise.
const CLE_FAUSSE = 'pikaqian|pikaqian/fausse.webp';
{
    const chemin = require.resolve('./collecte-cartes/corrections-images');
    const reel = require('./collecte-cartes/corrections-images');
    require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, IMAGES_DECLAREES_FAUSSES: Object.freeze([CLE_FAUSSE]) } };
}
const T = require('./collecte-cartes/tpc');
const { ligneTpc, uniteDeLaLigne } = require('./collecte-cartes/tpc-sets');
const { collecterSet, planifier } = require('./collecteur-images-tpc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const F = f => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'tpc-fixtures', f), 'utf8');
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

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
    B.col('cartes').set(1, { _id: 1, nomEn: 'Spidops', categorie: 'pokemon', ndex: 918, pv: 120, images: [] });
    B.col('cartes_produits').set('1|10', { _id: '1|10', carteId: 1, idProduct: 10, numeroFiche: '001', slugSet: SLUG });
}
const LISTE = F('asie-id-liste-SV-P-page1.html').replace(/class="resultNumber">251</, 'class="resultNumber">1<').replace(/Total 13 halaman/, 'Total 1 halaman')
    .replace(/<li class="card">\s*<a href="\/id\/card-search\/detail\/71(2[6-9]|3\d|4[0-4])\/">[\s\S]*?<\/li>/g, '');

(async () => {
    const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
    const reseau = repondre => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    const normal = url => url.endsWith('/robots.txt') ? { status: 200, texte: '' }
        : url.includes('/card-search/list/') ? { status: 200, texte: LISTE }
            : url.endsWith('/card-search/detail/7125/') ? { status: 200, texte: F('asie-id-fiche-7125.html') }
                : url.endsWith('/card-img/id00007125.png') ? { status: 200, type: 'image/png', octets: png }
                    : { status: 404, texte: 'non' };
    const verrou = { tenu: true, perdu: false };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const SANS = (site, slug) => { const L = ligneTpc(site, slug); return L && { ...L, cartes: 1, sansRemplacement: true }; };
    const AVEC = (site, slug) => { const L = ligneTpc(site, slug); return L && { ...L, cartes: 1 }; };
    const lancer = async (B, tr, ligneDe) => {
        const depots = [];
        const client = T.fabriquerClientTpc({ site: 'tpc-asie', transport: tr, cadenceMs: 0, reessaiMs: 0, verrou });
        const r = silencieux();
        try { return { b: await collecterSet(uniteDeLaLigne(ligneTpc('tpc-asie', SLUG)), B.M, { verrou, client, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: verrouSet, ligneDe }), depots }; }
        finally { r(); }
    };
    const pngs = tr => tr.appels.filter(u => /\.png$/.test(u)).length;

    // ── les entrées existantes, UNE de chaque sorte : même set, même numéro (001), même langue (id) que l'image TPC qui serait prouvée ────────────
    const BASE = { set: SLUG, numero: '001', langue: 'id' };
    const SORTES = {
        'basse définition': { source: 'pikaqian', cleR2: 'pikaqian/basse.webp', w: 300, wOriginal: 300, basseDefinition: true },
        'empruntée à un autre tirage': { source: 'pokumon', cleR2: 'pokumon/empruntee.webp', w: 600, wOriginal: 600, imageEmprunteeTirage: true, tamponNonRepresente: 'Staff' },
        'déclarée fausse': { source: 'pikaqian', cleR2: 'pikaqian/fausse.webp', w: 600, wOriginal: 600 },
        'correcte au-dessus du seuil': { source: 'pikaqian', cleR2: 'pikaqian/correcte.webp', w: 600, wOriginal: 600 },
        'correcte mais nettement plus petite que la nôtre': { source: 'pikaqian', cleR2: 'pikaqian/petite.webp', w: 400, wOriginal: 400 }
    };
    const monde = entree => {
        const B = fausseBase(); semer(B);
        const e = { ...BASE, ...entree };
        B.col('cartes').get(1).images.push(structuredClone(e));
        B.col('images').set('doc', { _id: 'doc', source: e.source, set: SLUG, carteId: 1, cleR2: e.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png', wOriginal: e.wOriginal, ...(e.tamponNonRepresente ? { tamponNonRepresente: e.tamponNonRepresente, imageEmprunteeTirage: true } : {}) });
        return B;
    };
    const vue = B => B.col('cartes').get(1).images.map(e => `${e.source}:${e.cleR2}`);

    for (const [nom, entree] of Object.entries(SORTES)) {
        // témoin : en mode normal la règle commune remplace (sauf l'empruntée, que seul un VRAI scan tamponné remplace) — le banc mord
        // (la « nettement plus petite » n'est pas un trou au PLAN — largeur nominale 350 — elle ne se joue qu'à la jointure : voir la course plus bas)
        if (nom === 'basse définition' || nom === 'déclarée fausse') {
            const Bn = monde(entree); const trn = reseau(normal); const rn = await lancer(Bn, trn, AVEC);
            verifier(`TÉMOIN (mode normal) — ${nom} : la règle commune la REMPLACE`, [vue(Bn).some(k => k.startsWith('tpc-asie:')), Bn.col('images').get('doc').etat, rn.b.basseDefRemplacees], [true, 'remplace', 1]);
        }
        const B = monde(entree); const tr = reseau(normal);
        const avant = vue(B), docAvant = JSON.stringify(B.col('images').get('doc'));
        const r = await lancer(B, tr, SANS);
        verifier(`SANS REMPLACEMENT — ${nom} : 0 trou, 0 téléchargement, 0 dépôt`, [r.b.trous, pngs(tr), r.depots.length], [0, 0, 0]);
        verifier(`   l'entrée existante reste la seule du set, octet pour octet ; son document est intact (état « ok », rien de « remplace »)`, [vue(B), JSON.stringify(B.col('images').get('doc')) === docAvant, B.col('images').get('doc').remplacePar ?? null], [avant, true, null]);
        verifier(`   unité « verifie », garde verte, aucun remplacement compté`, [r.b.etat, r.b.garde?.ok, r.b.basseDefRemplacees], ['verifie', true, 0]);
    }

    // ── une entrée de TPC lui-même (même set, même numéro) : jamais touchée non plus ────────────────────────────────────────────────────────────
    {
        const B = monde({ source: 'tpc-asie', cleR2: 'tpc-asie/ancienne.webp', w: 300, wOriginal: 300, basseDefinition: true }); const tr = reseau(normal);
        const r = await lancer(B, tr, SANS);
        verifier('SANS REMPLACEMENT — une entrée de TPC lui-même (même basse définition) : ni téléchargement ni modification', [r.b.trous, pngs(tr), vue(B), B.col('images').get('doc').etat], [0, 0, ['tpc-asie:tpc-asie/ancienne.webp'], 'ok']);
    }

    // ── COURSE : l'entrée est posée PENDANT la collecte (après le plan, avant la jointure) — la nôtre CÈDE, l'autre ne sort pas ───────────────
    for (const [nom, entree] of Object.entries({ 'basse définition': SORTES['basse définition'], 'correcte mais nettement plus petite': SORTES['correcte mais nettement plus petite que la nôtre'] })) {
        const B = fausseBase(); semer(B);
        const e = { ...BASE, ...entree };
        const tr = reseau(url => { if (url.endsWith('/card-img/id00007125.png')) { B.col('cartes').get(1).images.push(structuredClone(e)); B.col('images').set('doc', { _id: 'doc', source: e.source, set: SLUG, carteId: 1, cleR2: e.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png', wOriginal: e.wOriginal }); } return normal(url); });
        { // TÉMOIN : la même course en mode normal — l'arbitrage de la jointure remplace (le banc mord)
            const Bt = fausseBase(); semer(Bt);
            const trt = reseau(url => { if (url.endsWith('/card-img/id00007125.png')) { Bt.col('cartes').get(1).images.push(structuredClone(e)); Bt.col('images').set('doc', { _id: 'doc', source: e.source, set: SLUG, carteId: 1, cleR2: e.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png', wOriginal: e.wOriginal }); } return normal(url); });
            const rt = await lancer(Bt, trt, AVEC);
            verifier(`TÉMOIN (mode normal) — course, ${nom} : la jointure la REMPLACE`, [vue(Bt).some(k => k.startsWith('tpc-asie:')), Bt.col('images').get('doc').etat, rt.b.basseDefRemplacees], [true, 'remplace', 1]);
        }
        const r = await lancer(B, tr, SANS);
        verifier(`SANS REMPLACEMENT — course, ${nom} posée pendant la collecte : elle reste, la nôtre cède, rien n'est remplacé`, [vue(B), B.col('images').get('doc').etat, r.b.basseDefRemplacees, r.b.dejaParAutre, r.b.garde?.ok], [[`${e.source}:${e.cleR2}`], 'ok', 0, 1, true]);
    }

    // ── L'IMAGE NEUVE : une carte SANS aucune entrée dans le set reçoit son visuel, TRAÇABLE, retirable d'un coup ───────────────────────────────
    {
        const B = fausseBase(); semer(B);
        B.col('cartes').get(1).images.push({ set: 'Autre-Set', source: 'tcgdex', numero: '5', cleR2: 'tcgdex/x.webp', langue: 'en' });   // un visuel d'un AUTRE set ne sert pas ce numéro
        const tr = reseau(normal);
        const t0 = new Date();
        const r = await lancer(B, tr, SANS);
        const t1 = new Date();
        const doc = B.col('images').get('tpc-asie/Scarlet-Violet-Indonesian-Promos/1/001/id');
        const entree = B.col('cartes').get(1).images.find(e => e.source === 'tpc-asie');
        verifier('IMAGE NEUVE — un trou prouvé est comblé : 1 téléchargement, unité « verifie », garde verte', [r.b.etat, pngs(tr), r.b.joints, r.b.garde?.ok], ['verifie', 1, 1, true]);
        verifier('   document ET entrée : source « tpc-asie », retirable true', [doc.source, doc.retirable, entree.source, entree.retirable], ['tpc-asie', true, 'tpc-asie', true]);
        verifier('   document ET entrée : urlOriginal (l\'adresse du fichier chez TPC)', [doc.urlOriginal, entree.urlOriginal], ['https://asia.pokemon-card.com/id/card-img/id00007125.png', 'https://asia.pokemon-card.com/id/card-img/id00007125.png']);
        verifier('   collecteLe = la date RÉELLE du téléchargement (entre le début et la fin du passage), la même sur l\'entrée', [doc.collecteLe instanceof Date && doc.collecteLe >= t0 && doc.collecteLe <= t1, entree.collecteLe instanceof Date && +entree.collecteLe === +doc.collecteLe], [true, true]);
        verifier('   le visuel d\'un autre set reste là, intact', B.col('cartes').get(1).images.filter(e => e.source === 'tcgdex').map(e => e.cleR2), ['tcgdex/x.webp']);
        // le RETRAIT D'UN COUP, à blanc (retirer-visuels-tpc.js lit planRetrait) : exactement l'entrée neuve et sa clé R2, rien d'une autre source
        const R = T.planRetrait([...B.col('cartes').values()]);
        verifier('RETRAIT À BLANC (planRetrait, l\'outil retirer-visuels-tpc.js) : une carte, UNE entrée, la clé R2 de l\'image neuve — pas le visuel d\'une autre source', [R.cartes, R.entrees, R.cles], [[1], 1, [entree.cleR2]]);
    }

    // ── LE PLAN (planifier) : le même verdict, sans passer par le collecteur ────────────────────────────────────────────────────────────────────
    {
        const L = { ...ligneTpc('tpc-asie', SLUG), cartes: 1 };
        const fiches = [{ ...T.lireFicheAsie(F('asie-id-fiche-7125.html')), idFiche: 7125, urlFiche: 'x' }];
        const B = monde(SORTES['basse définition']);
        const normalP = await planifier(B.db, SLUG, L, fiches), sansP = await planifier(B.db, SLUG, { ...L, sansRemplacement: true }, fiches);
        verifier('PLAN — une entrée de basse définition : trou (et prouvé) en mode normal, JAMAIS un trou en mode sans remplacement', [normalP.trous, normalP.plan.length, sansP.trous, sansP.plan.length], [1, 1, 0, 0]);
    }

    // ── LA LIGNE DE TABLE : tout ce que TPC Asie tw sert est sans remplacement (le flag vit sur la ligne que lit le worker comme le collecteur local) ──
    {
        const tw = require('./collecte-cartes/tpc-sets').TABLE_TPC.filter(l => l.site === 'tpc-asie' && l.langue === 'tw');
        verifier('la table : chaque ligne tw porte `sansRemplacement: true` (au moins une ligne tw)', [tw.length > 0, tw.every(l => l.sansRemplacement === true)], [true, true]);
        verifier('la table : AUCUNE ligne non-tw ne porte le flag (le lot ne change pas les autres langues)', require('./collecte-cartes/tpc-sets').TABLE_TPC.filter(l => !(l.site === 'tpc-asie' && l.langue === 'tw') && l.sansRemplacement).length, 0);
    }

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });

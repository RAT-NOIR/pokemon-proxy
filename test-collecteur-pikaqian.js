// node test-collecteur-pikaqian.js — le collecteur PIKAQIAN de BOUT EN BOUT (collecteur-images-pikaqian.js `collecterSet`), sur une base EN MÉMOIRE
// et un réseau SIMULÉ : aucune requête, aucune base réelle, aucun dépôt R2. Le client et la preuve sont ceux de la production
// (collecte-cartes/pikaqian.js). Ce que le banc garde : la collecte additive (les entrées des autres sources ne bougent pas), la MENTION, le LOT,
// la PROVENANCE et la LANGUE sur chaque visuel, le seuil de 300 px, la REPRISE sans requête d'image, un visuel RETIRÉ jamais repris, l'ARRÊT au
// premier défi (alerte) et à l'erreur répétée (pas de refus définitif), les vignettes avant « verifie », la garde de TAILLE, et le RETRAIT en un lot.
// PK_COLLECTEUR / PK_RETRAIT (banc des mutants, rouge-pikaqian.js) : des fichiers à tester à la place des vrais.
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pikaqian');
const { lignePikaqian, uniteDeLaLigne } = require('./collecte-cartes/pikaqian-sets');
const { collecterSet } = require(process.env.PK_COLLECTEUR ? path.resolve(process.env.PK_COLLECTEUR) : './collecteur-images-pikaqian');
const { retirerLot } = require(process.env.PK_RETRAIT ? path.resolve(process.env.PK_RETRAIT) : './retirer-visuels-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ── une base en mémoire : les seules formes de requête que le collecteur emploie ──────────────────────────────────────
function fausseBase({ dataSize = 1000, indexSize = 100 } = {}) {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.map(y => y?.[p]) : x?.[p], o);   // 'images.source' : les sources de toutes les entrées
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : false)
        : (Array.isArray(lire(d, k)) && !Array.isArray(v) ? lire(d, k).includes(v) : lire(d, k) === v));
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

const SLUG = 'Dynamax-Clash-Flame';
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tuile = (n, code, num, nom) => `<a class="w-full group" data-discover="true" href="/cards/${UUID(n)}"><div><img alt="${nom}" src="https://images.pikaqian.com/${code}/${UUID(n)}.webp"/></div><h2>${nom}</h2><p class="font-mono">${code}<!-- --> · ${num}</p></a>`;
const PAGE = `<html><body>${[tuile(1, 'cs1bc', '001', 'Pikachu'), tuile(2, 'cs1bc', '001', 'Pikachu Reverse Holo'), tuile(3, 'cs1bc', '002', 'Raichu'), tuile(4, 'cs1bc', '003', 'Eevee Plus')].join('')}</body></html>`;
function semer(B) {
    B.col('sets').set(SLUG, { _id: SLUG, tirage: 'zh-hans', region: 'intl' });
    B.col('cartes').set(1, { _id: 1, nomEn: 'Pikachu', images: [{ set: 'Autre-Set', source: 'tcgdex', numero: '5', cleR2: 'tcgdex/x.webp' }] });
    B.col('cartes').set(2, { _id: 2, nomEn: 'Raichu', images: [{ set: SLUG, source: 'tcgdex', numero: '002', cleR2: 'tcgdex/y.webp' }] });
    B.col('cartes').set(3, { _id: 3, nomEn: 'Eevee', images: [] });
    B.col('cartes_produits').set('1|10', { _id: '1|10', carteId: 1, idProduct: 10, numeroFiche: '001', slugSet: SLUG });
    B.col('cartes_produits').set('1|11', { _id: '1|11', carteId: 1, idProduct: 11, numeroFiche: '001', slugSet: SLUG });
    B.col('cartes_produits').set('2|12', { _id: '2|12', carteId: 2, idProduct: 12, numeroFiche: '002', slugSet: SLUG });
    B.col('cartes_produits').set('3|13', { _id: '3|13', carteId: 3, idProduct: 13, numeroFiche: '003', slugSet: SLUG });
}
const imageDe = async larg => sharp({ create: { width: larg, height: Math.round(larg * 1.397), channels: 3, background: { r: 200, g: 60, b: 60 } } }).webp().toBuffer();

(async () => {
    const webp300 = await imageDe(300), webp299 = await imageDe(299), webp320 = await imageDe(320);
    const reseau = repondre => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    const ROBOTS = 'User-agent: *\nDisallow: /api/\n';
    const normal = (img = webp300) => url => url.endsWith('/robots.txt') ? (url.startsWith('https://pikaqian.com') ? { status: 200, texte: ROBOTS } : { status: 404, texte: '' })
        : url === 'https://pikaqian.com/sets/cs1bc' ? { status: 200, type: 'text/html', texte: PAGE }
            : url === `https://images.pikaqian.com/cs1bc/${UUID(1)}.webp` ? { status: 200, type: 'image/webp', octets: img }
                : { status: 404, texte: 'non' };
    const verrou = { tenu: true, perdu: false };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const vignetteOk = () => { const f = async () => { f.n++; return { vg: { entrees: 1, fabriquees: 1, echecs: 0 }, sets: [] }; }; f.n = 0; return f; };
    const lancer = async (B, tr, o = {}) => {
        const depots = [];
        const client = P.fabriquerClientPikaqian({ transport: tr, cadenceMs: 0, verrou, pause: async () => { }, horloge: () => 0 });
        const vignetter = o.vignetter || vignetteOk();
        const r = silencieux();
        try { return { b: await collecterSet(o.unite || uniteDeLaLigne(lignePikaqian(SLUG)), B.M, { verrou, client, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: verrouSet, stopOctets: o.stopOctets, vignetter, ligneDe: o.ligneDe }), depots, vignetter, client }; }
        finally { r(); }
    };
    verifier('la ligne de table du set test existe (CS1bC → cs1bc)', [lignePikaqian(SLUG)?.code, lignePikaqian(SLUG)?.codePk, lignePikaqian(SLUG)?.tirage], ['CS1bC', 'cs1bc', 'zh-hans']);

    // ── 1. la collecte ────────────────────────────────────────────────────────────────────────────────────────────
    const B = fausseBase(); semer(B);
    let tr = reseau(normal());
    let { b, depots, vignetter } = await lancer(B, tr);
    verifier('une unité complète → « verifie »', b.etat, 'verifie');
    verifier('requêtes : robots.txt du site, la page, robots.txt des images, l\'image — rien d\'autre (une seule image : une carte, un numéro)', tr.appels.map(u => u.replace('https://', '')),
        ['pikaqian.com/robots.txt', 'pikaqian.com/sets/cs1bc', 'images.pikaqian.com/robots.txt', `images.pikaqian.com/cs1bc/${UUID(1)}.webp`]);
    const im = B.col('images').get(P.idImagePikaqian(SLUG, 1, '001'));
    verifier('le document `images` : source, langue + preuve, MENTION, LOT, état', [im?.source, im?.langue, !!im?.languePreuve, im?.langueSource, im?.mention, im?.attribution, im?.lot, im?.etat, im?.set, im?.numero],
        ['pikaqian', 'zh-hans', true, 'zh-hans', '© Pokémon / The Pokémon Company', '© Pokémon / The Pokémon Company', 'pikaqian-2026-10', 'ok', SLUG, '001']);
    verifier('   l\'adresse pikaqian, la preuve, la tuile, la PROVENANCE (l\'origine officielle chinoise)', [im?.urlOriginal, /cs1bc/.test(im?.preuve || '') && /Pikachu/.test(im?.preuve || ''), im?.idTuile, /officiel chinois/.test(im?.provenance || ''), im?.urlOfficielle ?? null],
        [`https://images.pikaqian.com/cs1bc/${UUID(1)}.webp`, true, UUID(1), true, null]);
    verifier('   dimensions de l\'original et sha', [im?.wOriginal, im?.hOriginal, im?.fmt, typeof im?.sha256], [300, 419, 'webp', 'string']);
    verifier('R2 AVANT la ligne : un dépôt WebP, à la clé du set', [depots.length, depots[0]?.[1], depots[0]?.[3]], [1, `pikaqian/${SLUG}/001-1-zh-hans.webp`, 'image/webp']);
    const c1 = B.col('cartes').get(1), c2 = B.col('cartes').get(2), c3 = B.col('cartes').get(3);
    verifier('la carte reçoit SON visuel, et garde celui de l\'autre set', c1.images.map(e => `${e.source}:${e.set}:${e.numero}`), ['tcgdex:Autre-Set:5', `pikaqian:${SLUG}:001`]);
    verifier('   l\'entrée porte mention, lot, langue + preuve, provenance, adresse d\'origine', [c1.images[1].mention, c1.images[1].lot, c1.images[1].langue, !!c1.images[1].languePreuve, /officiel chinois/.test(c1.images[1].provenance), c1.images[1].urlOriginal, c1.images[1].attribution],
        ['© Pokémon / The Pokémon Company', 'pikaqian-2026-10', 'zh-hans', true, true, `https://images.pikaqian.com/cs1bc/${UUID(1)}.webp`, '© Pokémon / The Pokémon Company']);
    verifier('une carte déjà servie à ce numéro par une autre source : intacte (additif)', c2.images.map(e => `${e.source}:${e.numero}`), ['tcgdex:002']);
    verifier('un nom anglais divergent : aucun visuel, le trou est nommé dans le bilan', [c3.images.length, b.restes], [0, { 'tuile-a-suffixe': 1 }]);   // « Eevee Plus » prolonge notre « Eevee » : pas la tuile de base
    const bilan = B.col('sets').get(SLUG).visuelsPikaqian;
    verifier('le bilan du set : 1 prouvé, garde verte, concordance, lot, mention, vignettes', [bilan?.prouves, bilan?.garde?.ok, bilan?.concordance, bilan?.lot, bilan?.mention, bilan?.vignettes?.echecs],
        [1, true, true, 'pikaqian-2026-10', '© Pokémon / The Pokémon Company', 0]);
    verifier('le bilan est aussi sur l\'unité (collecte_images_etat), les restes avec leur motif', [B.col('collecte_images_etat').get(`pikaqian/${SLUG}`)?.phase, B.col('collecte_images_etat').get(`pikaqian/${SLUG}`)?.restes?.[0]?.motif], ['verifie', 'tuile-a-suffixe']);
    verifier('les vignettes sont fabriquées APRÈS la jointure (un appel)', vignetter.n, 1);

    // la page qui DÉCLARE l'origine de la carte (flux embarqué) : la provenance la nomme, sur le document ET sur l'entrée
    const B1f = fausseBase(); semer(B1f);
    const PAGE_FLUX = PAGE.replace('</body>', `<script>"[\\"id\\",\\"${UUID(1)}\\",\\"native_image_url\\",\\"https://pokipair.com/x.png\\",\\"we_chat_image_url\\",\\"https://cdn.pokemon-tcg.cn/cards/AAA.png\\"]"</script></body>`);
    await lancer(B1f, reseau(url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 200, texte: PAGE_FLUX } : normal()(url)));
    const imf = B1f.col('images').get(P.idImagePikaqian(SLUG, 1, '001')), enf = B1f.col('cartes').get(1).images[1];
    verifier('origine déclarée par la page : adresse officielle (cdn.pokemon-tcg.cn) et native_image_url gardées, provenance qui les nomme', [imf.urlOfficielle, imf.urlOrigineDeclaree, /cdn\.pokemon-tcg\.cn\/cards\/AAA\.png/.test(imf.provenance), enf.urlOfficielle, /pokipair\.com/.test(enf.provenance)],
        ['https://cdn.pokemon-tcg.cn/cards/AAA.png', 'https://pokipair.com/x.png', true, 'https://cdn.pokemon-tcg.cn/cards/AAA.png', true]);

    // ── 2. la reprise : aucune image redemandée ─────────────────────────────────────────────────────────────────────
    tr = reseau(normal());
    ({ b, depots } = await lancer(B, tr));
    verifier('un second passage : « verifie », la page seulement (robots + page), 0 image, 0 dépôt, pas de doublon', [b.etat, tr.appels.length, tr.appels.some(u => u.endsWith('.webp')), depots.length, B.col('cartes').get(1).images.length], ['verifie', 2, false, 0, 2]);

    // une jointure interrompue après le téléchargement : le document `images` est « ok » mais la carte n'a pas son entrée — le passage suivant la pose SANS redemander l'image
    const B2a = fausseBase(); semer(B2a);
    await lancer(B2a, reseau(normal()));
    B2a.col('cartes').get(1).images = B2a.col('cartes').get(1).images.filter(e => e.source !== 'pikaqian');
    tr = reseau(normal());
    ({ b, depots } = await lancer(B2a, tr));
    verifier('document « ok » sans entrée de carte : l\'image n\'est pas redemandée (reprise), l\'entrée est reposée', [tr.appels.some(u => u.endsWith('.webp')), depots.length, b.sautes, B2a.col('cartes').get(1).images.filter(e => e.source === 'pikaqian').length], [false, 0, 1, 1]);
    // la GARDE de la jointure : une écriture qui toucherait l'entrée d'une AUTRE source fait passer l'unité à « non-concordant »
    const B2b = fausseBase(); semer(B2b);
    const ecrireOrig = B2b.M.Carte.updateOne;
    B2b.M.Carte.updateOne = (f, u, o) => { const r = ecrireOrig(f, u, o); if (u.$push) B2b.col('cartes').get(f._id).images = B2b.col('cartes').get(f._id).images.filter(e => e.source !== 'tcgdex'); return r; };
    ({ b } = await lancer(B2b, reseau(normal())));
    verifier('une entrée d\'une autre source disparue pendant la jointure → « non-concordant », garde rouge', [b.etat, b.garde?.ok, b.garde?.autresIdentiques], ['non-concordant', false, false]);

    // ── 3. une AUTRE source sert ce numéro entre deux passages : la nôtre lui cède la place, la sienne est intacte ────────
    B.col('cartes').get(1).images.push({ set: SLUG, source: 'tcgdex', numero: '001', cleR2: 'tcgdex/z.webp' });
    ({ b } = await lancer(B, reseau(normal())));
    verifier('une autre source au même numéro : son entrée reste, la nôtre sort, garde verte', [b.etat, B.col('cartes').get(1).images.map(e => `${e.source}:${e.set}:${e.numero}`), b.garde?.ok],
        ['verifie', ['tcgdex:Autre-Set:5', `tcgdex:${SLUG}:001`], true]);

    // ── 3 bis. DÉJÀ servie avant le passage : ni téléchargement ni entrée (une image ne remplace JAMAIS un visuel existant) ───────────
    const B1 = fausseBase(); semer(B1);
    B1.col('cartes').get(1).images.push({ set: SLUG, source: 'artofpkm', numero: '001', cleR2: 'artofpkm/w.webp' });
    tr = reseau(normal());
    ({ b, depots } = await lancer(B1, tr));
    verifier('déjà servie avant : 0 image demandée, 0 dépôt, aucune entrée pikaqian, l\'entrée existante intacte', [tr.appels.some(u => u.endsWith('.webp')), depots.length, B1.col('cartes').get(1).images.map(e => `${e.source}:${e.numero}`)], [false, 0, ['tcgdex:5', 'artofpkm:001']]);
    // une entrée du MÊME set sans numéro vaut « déjà servi » pour tous ses numéros (la règle de dejaServi)
    const B1b = fausseBase(); semer(B1b);
    B1b.col('cartes').get(1).images.push({ set: SLUG, source: 'artofpkm', cleR2: 'artofpkm/sans-numero.webp' });
    tr = reseau(normal());
    await lancer(B1b, tr);
    verifier('   idem pour une entrée sans numéro dans ce set', tr.appels.some(u => u.endsWith('.webp')), false);

    // ── 4. un visuel RETIRÉ n'est jamais repris ───────────────────────────────────────────────────────────────────────
    const B2 = fausseBase(); semer(B2);
    await lancer(B2, reseau(normal()));
    B2.col('cartes').get(1).images = B2.col('cartes').get(1).images.filter(e => e.source !== 'pikaqian');
    B2.col('images').get(P.idImagePikaqian(SLUG, 1, '001')).etat = 'retire';
    B2.col('images').get(P.idImagePikaqian(SLUG, 1, '001')).urlOriginal = 'https://images.pikaqian.com/cs1bc/ancienne.webp';
    tr = reseau(normal());
    ({ b, depots } = await lancer(B2, tr));
    verifier('retiré : ni téléchargé (même si l\'URL a changé), ni rejoint', [tr.appels.some(u => u.endsWith('.webp')), depots.length, B2.col('cartes').get(1).images.some(e => e.source === 'pikaqian'), b.retires], [false, 0, false, 1]);

    // ── 5. le DÉFI : arrêt, alerte, et plus rien ensuite ──────────────────────────────────────────────────────────────
    const B3 = fausseBase(); semer(B3);
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 403, texte: 'Forbidden' });
    ({ b } = await lancer(B3, tr));
    const alerte = B3.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian');
    verifier('403 sur la page → « refuse-source-bloquee », alerte active, aucun visuel écrit', [b.etat, alerte?.active, alerte?.status, B3.col('images').size], ['refuse-source-bloquee', true, 403, 0]);
    tr = reseau(normal());
    ({ b } = await lancer(B3, tr));
    verifier('une unité suivante, source bloquée : refusée, ZÉRO requête', [b.etat, tr.appels.length], ['refuse-source-bloquee', 0]);
    // un défi en plein téléchargement : ce qui est prouvé AVANT est joint, l'alerte s'écrit, l'unité est incomplète
    const B3b = fausseBase(); semer(B3b);
    tr = reseau(url => url.endsWith('.webp') ? { status: 200, cfMitigated: 'challenge', texte: 'Just a moment' } : normal()(url));
    ({ b } = await lancer(B3b, tr));
    verifier('défi sur une image : alerte écrite, unité « incomplet » (pas un verdict sur le set), aucune image écrite « ok »', [b.etat, B3b.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian')?.active, [...B3b.col('images').values()].filter(d => d.etat === 'ok').length], ['incomplet', true, 0]);

    // ── 5 bis. l'ERREUR RÉPÉTÉE : un arrêt qui n'est PAS un refus définitif (§58) ─────────────────────────────────────────
    const B3c = fausseBase(); semer(B3c);
    B3c.col('cartes_produits').set('9|99', { _id: '9|99', carteId: 9, idProduct: 99, numeroFiche: '002', slugSet: SLUG });
    B3c.col('cartes').set(9, { _id: 9, nomEn: 'Raichu', images: [] });
    B3c.col('cartes').get(2).images = [];
    tr = reseau(url => url.endsWith('.webp') ? { status: 503, texte: 'indisponible' } : normal()(url));
    const pageDeuxCartes = url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 200, texte: PAGE } : null;
    ({ b } = await lancer(B3c, tr));
    verifier('un 503 sur l\'image n°1 puis sur l\'image n°2 : ARRÊT (erreur répétée), unité « incomplet-transitoire » (revient en file), et l\'ALERTE est posée', [b.etat, b.bloque ?? null, B3c.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian')?.active ?? null],
        ['incomplet-transitoire', null, true]);
    verifier('   le compteur persisté repart à zéro (l\'alerte a pris le relais)', B3c.col('collecte_images_etat').get('etat/echecs-de-suite/pikaqian')?.suite, 0);
    verifier('   les images en échec sont notées « echec » avec leur erreur (reprise possible)', [...B3c.col('images').values()].map(d => d.etat), ['echec', 'echec']);
    verifier('   le nombre d\'images demandées s\'arrête au deuxième échec', tr.appels.filter(u => u.endsWith('.webp')).length, 2);

    // ── 5 ter. LE COMPTEUR D'ÉCHECS SURVIT À L'UNITÉ : deux unités successives en 5xx ⇒ la 2e conclut l'arrêt et pose l'alerte ; aucune 3e requête ne part ──────────
    const BP = fausseBase(); semer(BP);
    BP.col('sets').set('Autre-Flame', { _id: 'Autre-Flame', tirage: 'zh-hans' });
    const page500 = url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 500, texte: 'oups' } : normal()(url);
    tr = reseau(page500);
    ({ b } = await lancer(BP, tr));
    verifier('1re unité, page en 500 : « incomplet-transitoire », compteur persisté à 1, pas d\'alerte', [b.etat, BP.col('collecte_images_etat').get('etat/echecs-de-suite/pikaqian')?.suite, BP.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian') ?? null], ['incomplet-transitoire', 1, null]);
    tr = reseau(page500);
    ({ b } = await lancer(BP, tr));
    const alertePk = BP.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian');
    verifier('2e unité (client NEUF), page en 500 : l\'échec est le DEUXIÈME de suite → arrêt, alerte posée, compteur remis à zéro', [b.etat, alertePk?.active, /échecs de suite/.test(alertePk?.motif ?? ''), BP.col('collecte_images_etat').get('etat/echecs-de-suite/pikaqian')?.suite], ['refuse-source-bloquee', true, true, 0]);
    tr = reseau(normal());
    ({ b } = await lancer(BP, tr));
    verifier('3e unité : refusée, AUCUNE requête', [b.etat, tr.appels.length], ['refuse-source-bloquee', 0]);
    // un succès entre deux échecs remet le compteur à zéro entre les unités
    const BQ = fausseBase(); semer(BQ);
    await lancer(BQ, reseau(page500));
    ({ b } = await lancer(BQ, reseau(normal())));
    verifier('échec, puis une unité réussie : compteur à zéro, pas d\'alerte', [b.etat, BQ.col('collecte_images_etat').get('etat/echecs-de-suite/pikaqian')?.suite, BQ.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian') ?? null], ['verifie', 0, null]);
    // une image illisible (sharp) compte : deux de suite → arrêt + alerte
    const BI = fausseBase(); semer(BI);
    BI.col('cartes_produits').set('9|99', { _id: '9|99', carteId: 9, idProduct: 99, numeroFiche: '002', slugSet: SLUG });
    BI.col('cartes').set(9, { _id: 9, nomEn: 'Raichu', images: [] }); BI.col('cartes').get(2).images = [];
    ({ b } = await lancer(BI, reseau(url => url.endsWith('.webp') ? { status: 200, type: 'image/webp', octets: Buffer.from('pas une image') } : normal()(url))));
    verifier('deux fichiers illisibles de suite → arrêt, alerte posée', [BI.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian')?.active, [...BI.col('images').values()].filter(d => d.etat === 'echec').length], [true, 2]);
    // le plafond de requêtes de l'unité : une page qui ne mène qu'à 1 image ne peut pas déclencher d'avalanche
    const BL = fausseBase(); semer(BL);
    const clientPlafond = P.fabriquerClientPikaqian({ transport: reseau(normal()), cadenceMs: 0, verrou, pause: async () => { }, horloge: () => 0 });
    clientPlafond.plafonner(1);
    const rr0 = silencieux();
    try { var pl = await collecterSet(uniteDeLaLigne(lignePikaqian(SLUG)), BL.M, { verrou, client: clientPlafond, deposer: async () => { }, fabriquerVerrouSet: verrouSet, vignetter: vignetteOk() }); } finally { rr0(); }
    verifier('plafond posé avant l\'unité (1 requête) : la 2e requête est refusée, aucune image prise', [pl.etat !== 'verifie', [...BL.col('images').values()].length], [true, 0]);

    // le plafond que le COLLECTEUR pose lui-même (taille du plan + marge) : une redirection d'image en boucle est coupée avant les 3 sauts du client
    const BM = fausseBase(); semer(BM);
    tr = reseau(url => url === `https://images.pikaqian.com/cs1bc/${UUID(1)}.webp` ? { status: 302, location: `/cs1bc/${UUID(1)}.webp` } : normal()(url));
    ({ b } = await lancer(BM, tr));
    verifier('image en redirection sans fin : coupée par le plafond de l\'unité (3 essais, pas 4)', [tr.appels.filter(u => u.endsWith('.webp')).length, b.etat !== 'verifie'], [3, true]);
    // la provenance par défaut n'AFFIRME pas une copie officielle : elle dit ce que la page ne déclare pas
    verifier('provenance par défaut : « origine non déclarée par la page », sans affirmer « copie du visuel officiel »', [/origine non déclarée par la page/.test(im?.provenance ?? ''), /copie du visuel officiel/.test(im?.provenance ?? '')], [true, false]);

    // ── 6. la TAILLE de la base : au-delà du seuil, STOP avant toute requête ──────────────────────────────────────────
    const B4 = fausseBase({ dataSize: 300, indexSize: 300 }); semer(B4);
    tr = reseau(normal());
    ({ b } = await lancer(B4, tr, { stopOctets: 500 }));
    verifier('base au-dessus du seuil → « refuse-taille-base », alerte écrite, 0 requête', [b.etat, B4.col('collecte_images_etat').get('alerte/taille-base')?.active, tr.appels.length], ['refuse-taille-base', true, 0]);
    verifier('le seuil de production est 400 Mo', require('./collecteur-images-pikaqian').STOP_OCTETS, 400 * 1024 * 1024);

    // ── 7. la garde de l'unité, par ce qu'elle autorise ───────────────────────────────────────────────────────────────
    const B5 = fausseBase(); semer(B5);
    tr = reseau(normal());
    ({ b } = await lancer(B5, tr, { unite: { ...uniteDeLaLigne(lignePikaqian(SLUG)), codePk: 'cs1ac' } }));
    verifier('une unité qui ne porte pas sa ligne mot pour mot → refusée, 0 requête', [b.etat, tr.appels.length], ['refuse-table', 0]);
    ({ b } = await lancer(B5, tr, { unite: { ...uniteDeLaLigne(lignePikaqian(SLUG)), source: 'tpc-asie' } }));
    verifier('une unité d\'une autre source → refusée, 0 requête', [b.etat, tr.appels.length], ['refuse-source', 0]);
    ({ b } = await lancer(B5, tr, { unite: { ...uniteDeLaLigne(lignePikaqian(SLUG)), slugSet: 'Set-Inconnu' } }));
    verifier('un set absent de la table → refusé, 0 requête', [b.etat, tr.appels.length], ['refuse-table', 0]);
    B5.col('sets').get(SLUG).tirage = 'jp';
    ({ b } = await lancer(B5, tr));
    verifier('un set au mauvais tirage en base → refusé, 0 requête', [b.etat, tr.appels.length], ['refuse-set', 0]);
    const B7 = fausseBase(); semer(B7); B7.col('cartes_produits').clear();
    tr = reseau(normal());
    ({ b } = await lancer(B7, tr));
    verifier('aucun produit joint au set → « refuse-set », 0 requête (pas un « verifie » sur une population vide)', [b.etat, tr.appels.length], ['refuse-set', 0]);

    // ── 8. la page ────────────────────────────────────────────────────────────────────────────────────────────────────
    const B8 = fausseBase(); semer(B8);
    tr = reseau(url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 404, texte: 'non' } : normal()(url));
    ({ b } = await lancer(B8, tr));
    verifier('page absente (404) → « refuse-liste » nommé, aucune image demandée', [b.etat, tr.appels.some(u => u.endsWith('.webp'))], ['refuse-liste', false]);
    tr = reseau(url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 200, texte: PAGE.replace(/cs1bc/g, 'csv10c').replace('https://images.pikaqian.com/csv10c/', 'https://images.pikaqian.com/csv10c/') } : normal()(url));
    ({ b } = await lancer(B8, tr));
    verifier('une page dont les tuiles ne portent pas le code du set → « refuse-liste », aucune image demandée', [b.etat, tr.appels.some(u => u.endsWith('.webp'))], ['refuse-liste', false]);
    tr = reseau(url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 200, texte: '<html>autre mise en page</html>' } : normal()(url));
    ({ b } = await lancer(B8, tr));
    verifier('une page sans tuile lisible → « refuse-liste »', b.etat, 'refuse-liste');
    tr = reseau(url => url === 'https://pikaqian.com/sets/cs1bc' ? { status: 500, texte: 'oups' } : normal()(url));
    ({ b } = await lancer(B8, tr));
    verifier('un 500 sur la page → « incomplet-transitoire » (revient en file), pas un refus', b.etat, 'incomplet-transitoire');

    // ── 9. le SEUIL : 300 px passe, 299 reste trop petit, et c'est écrit ────────────────────────────────────────────────────
    const B9 = fausseBase(); semer(B9);
    ({ b } = await lancer(B9, reseau(normal(webp299))));
    const petit = B9.col('images').get(P.idImagePikaqian(SLUG, 1, '001'));
    verifier('image de 299 px → « trop-petit », comptée, seuil appliqué écrit, rien de joint', [b.tropPetits, petit?.etat, petit?.seuilApplique, petit?.wOriginal, B9.col('cartes').get(1).images.length], [1, 'trop-petit', 300, 299, 1]);
    const tr9 = reseau(normal(webp299));
    await lancer(B9, tr9);
    verifier('   au passage suivant : l\'image n\'est pas redemandée (même URL, déjà jugée)', tr9.appels.some(u => u.endsWith('.webp')), false);
    const B9b = fausseBase(); semer(B9b);
    ({ b } = await lancer(B9b, reseau(normal(webp300))));
    verifier('image de 300 px (le seuil) → « ok » et jointe', [b.tropPetits, B9b.col('images').get(P.idImagePikaqian(SLUG, 1, '001'))?.etat, B9b.col('cartes').get(1).images.length], [0, 'ok', 2]);
    // ➕ 2026-10-12 — BASSE DÉFINITION : 300 px est sous 350 → la marque sur le document ET sur l'entrée ; PikaQian GARDE son seuil de 300 (257 est pour les officielles)
    verifier('   300 px → `basseDefinition: true` sur le document images ET sur l\'entrée de la carte',
        [B9b.col('images').get(P.idImagePikaqian(SLUG, 1, '001'))?.basseDefinition, B9b.col('cartes').get(1).images.find(e => e.source === 'pikaqian')?.basseDefinition], [true, true]);
    verifier('   PikaQian garde 300 : 299 px reste « trop-petit » avec seuilApplique 300 (pas 257)', [petit?.etat, petit?.seuilApplique], ['trop-petit', 300]);
    const B9c = fausseBase(); semer(B9c);
    ({ b } = await lancer(B9c, reseau(normal(webp320))));
    verifier('image de 320 px → « ok »', B9c.col('images').get(P.idImagePikaqian(SLUG, 1, '001'))?.etat, 'ok');

    // ── 10. les VIGNETTES conditionnent « verifie » ─────────────────────────────────────────────────────────────────────────
    const B10 = fausseBase(); semer(B10);
    const mauvaises = async () => ({ vg: { entrees: 1, fabriquees: 0, echecs: 1 }, sets: [] });
    ({ b } = await lancer(B10, reseau(normal()), { vignetter: mauvaises }));
    verifier('une vignette en échec → l\'unité n\'est PAS « verifie » (« incomplet »), la jointure reste', [b.etat, B10.col('cartes').get(1).images.some(e => e.source === 'pikaqian')], ['incomplet', true]);
    const B10b = fausseBase(); semer(B10b);
    ({ b } = await lancer(B10b, reseau(normal()), { vignetter: async () => ({ vg: { erreur: 'R2 injoignable' }, sets: [] }) }));
    verifier('une erreur des vignettes → « incomplet » aussi', b.etat, 'incomplet');

    // ── 11. LE RETRAIT EN UN LOT ────────────────────────────────────────────────────────────────────────────────────────────
    const BR = fausseBase(); semer(BR);
    await lancer(BR, reseau(normal()));
    BR.col('cartes').get(1).images[1].vignette = { cleR2: `vignettes/pikaqian/${SLUG}/001-1-zh-hans.webp` };
    BR.col('images').get(P.idImagePikaqian(SLUG, 1, '001')).vignette = { cleR2: `vignettes/pikaqian/${SLUG}/001-1-zh-hans.webp` };
    BR.col('images').set('tpc-asie/x/1/001/id', { _id: 'tpc-asie/x/1/001/id', source: 'tpc-asie', lot: 'tpc-2026-10', etat: 'ok' });
    BR.col('cartes').get(3).images = [{ set: 'Z', source: 'tpc-asie', lot: 'tpc-2026-10', cleR2: 'tpc-asie/z.webp' }, { set: 'Z', source: 'tcgdex', lot: 'pikaqian-2026-10', cleR2: 'tcgdex/meme-lot.webp' }];
    BR.col('cartes').get(1).images.push({ set: 'Y2', source: 'tcgdex', lot: 'pikaqian-2026-10', cleR2: 'tcgdex/meme-lot-carte1.webp' });   // le lot seul ne suffit pas : la source aussi
    const simul = await retirerLot(BR.db, { ecrire: false });
    verifier('simulation : liste les clés avant de retirer (image ET vignette), n\'écrit rien, ne compte que la source ET le lot', [simul.cartes, simul.entrees, simul.parSet, simul.cles.sort(), BR.col('cartes').get(1).images.some(e => e.source === 'pikaqian'), BR.col('images').get(P.idImagePikaqian(SLUG, 1, '001')).etat],
        [[1], 1, { [SLUG]: 1 }, [`pikaqian/${SLUG}/001-1-zh-hans.webp`, `vignettes/pikaqian/${SLUG}/001-1-zh-hans.webp`], true, 'ok']);
    BR.col('file_images').set(`pikaqian/Autre`, { _id: 'pikaqian/Autre', source: 'pikaqian', etat: 'attente' });
    BR.col('file_images').set(`tpc-asie/Autre`, { _id: 'tpc-asie/Autre', source: 'tpc-asie', etat: 'attente' });
    const supprimes = [];
    const rr = await retirerLot(BR.db, { ecrire: true, effacerR2: true, bucket: 'b', verifierBucket: async () => { }, supprimer: async (bk, cles) => supprimes.push(...cles) });
    verifier('retrait : l\'entrée pikaqian part (les autres sources intactes), le document passe à « retire », le bilan du set est nettoyé', [BR.col('cartes').get(1).images.map(e => e.source), BR.col('images').get(P.idImagePikaqian(SLUG, 1, '001')).etat, BR.col('sets').get(SLUG).visuelsPikaqian ?? null, BR.col('cartes').get(3).images.length, BR.col('images').get('tpc-asie/x/1/001/id').etat],
        [['tcgdex', 'tcgdex'], 'retire', null, 2, 'ok']);
    verifier('   la source est fermée (alerte), les objets R2 effacés sont ceux du lot, relu : plus aucune entrée', [BR.col('collecte_images_etat').get('alerte/source-bloquee/pikaqian')?.active, supprimes.sort(), rr.reste], [true, [`pikaqian/${SLUG}/001-1-zh-hans.webp`, `vignettes/pikaqian/${SLUG}/001-1-zh-hans.webp`], 0]);
    verifier('   les bilans d\'unité sont nettoyés, les unités pikaqian en attente sont fermées (pas celles des autres sources)', [BR.col('collecte_images_etat').get(`pikaqian/${SLUG}`)?.bilan ?? null, BR.col('file_images').get('pikaqian/Autre').etat, BR.col('file_images').get('tpc-asie/Autre').etat], [null, 'refuse', 'attente']);
    tr = reseau(normal());
    ({ b } = await lancer(BR, tr));
    verifier('   une recollecte après le retrait : refusée (source fermée), 0 requête', [b.etat, tr.appels.length], ['refuse-source-bloquee', 0]);

    // ── ➕ 2026-10-17 (BASSE-DEF) : la JOINTURE de PikaQian arbitre une entrée MARQUÉE d'une autre source (la même fonction que les autres collecteurs) ────────────────────
    // (les images de PikaQian font 300 px, donc MARQUÉES : elles ne remplacent rien — mais si une image sort un jour au-dessus de 350 px, elle remplace ; le plan n'est pas élargi : télécharger un
    // 300 px pour le voir céder serait une requête pour rien.)
    {
        const { joindreAdditif } = require(process.env.PK_COLLECTEUR ? path.resolve(process.env.PK_COLLECTEUR) : './collecteur-images-pikaqian');
        const MARQ = { set: SLUG, source: 'tcgdex', numero: '003', cleR2: 'tcgdex/Dynamax/003-basse.webp', langue: P.LANGUE, w: 300, basseDefinition: true };
        const monde = (w, images = [MARQ]) => {
            const Bm = fausseBase(); semer(Bm); Bm.col('cartes').get(3).images = structuredClone(images);
            Bm.col('images').set('mq', { _id: 'mq', source: 'tcgdex', set: SLUG, carteId: 3, cleR2: MARQ.cleR2, etat: 'ok', urlOriginal: 'https://hote.example/ancienne.png', wOriginal: 300 });
            const id = P.idImagePikaqian(SLUG, 3, '003');
            Bm.col('images').set(id, { _id: id, source: P.SOURCE, set: SLUG, carteId: 3, numero: '003', cleR2: `pikaqian/${SLUG}/003-3-${P.LANGUE}.webp`, sha256: 'x', w: Math.min(w, 700), h: 600, fmt: 'webp', wOriginal: w, urlOriginal: 'https://images.pikaqian.com/x.webp', preuve: 'p', langue: P.LANGUE, languePreuve: 'l', etat: 'ok', lot: P.LOT, provenance: 'p' });
            return { Bm, id };
        };
        const des = Bm => Bm.col('cartes').get(3).images.map(e => `${e.source}:${e.basseDefinition === true}`);
        { const { Bm } = monde(400); const r = silencieux(); let J; try { J = await joindreAdditif(Bm.db, Bm.M, SLUG); } finally { r(); }
          verifier('REMPLACEMENT : une image PikaQian de 400 px (non marquée) remplace une entrée MARQUÉE d\'une autre source (même set, numéro, langue) ; garde verte, 1 jointe', [des(Bm), J.garde, J.joints, Bm.col('images').get('mq').etat, Bm.col('images').get('mq').remplacePar?.source, Bm.col('images').get('mq').urlOriginal], [['pikaqian:false'], true, 1, 'remplace', 'pikaqian', 'https://hote.example/ancienne.png']); }
        { const { Bm } = monde(300); const r = silencieux(); let J; try { J = await joindreAdditif(Bm.db, Bm.M, SLUG); } finally { r(); }
          verifier('JAMAIS L\'INVERSE : une image PikaQian de 300 px (marquée) face à une entrée marquée → elle CÈDE, l\'entrée marquée reste, son document n\'est pas touché', [des(Bm), J.garde, J.joints, J.dejaParAutre, Bm.col('images').get('mq').etat], [['tcgdex:true'], true, 0, 1, 'ok']); }
        // ➕ doctrine 2026-10-17 : traçabilité (document ET entrée), adresse d'origine obligatoire, « nettement plus grande » 1,49 × refusé / 1,5 × admis
        { const { Bm } = monde(400); const r = silencieux(); try { await joindreAdditif(Bm.db, Bm.M, SLUG); } finally { r(); }
          const e = Bm.col('cartes').get(3).images.find(x => x.source === P.SOURCE);
          verifier('TRAÇABILITÉ : l\'entrée posée porte retirable, urlOriginal, collecteLe', [e.retirable, e.urlOriginal, e.collecteLe instanceof Date], [true, 'https://images.pikaqian.com/x.webp', true]); }
        { const { Bm, id } = monde(400); delete Bm.col('images').get(id).urlOriginal; const r = silencieux(); let J; try { J = await joindreAdditif(Bm.db, Bm.M, SLUG); } finally { r(); }
          verifier('une image SANS adresse d\'origine ne s\'écrit pas : la jointure s\'interrompt (erreurJointure « traçabilité »), aucune entrée posée', [/traçabilité/.test(J.erreurJointure || ''), Bm.col('cartes').get(3).images.some(x => x.source === P.SOURCE)], [true, false]); }
        { const { Bm: B149 } = monde(596, [{ ...MARQ, basseDefinition: undefined, w: 400, wOriginal: 400 }]); const { Bm: B15 } = monde(600, [{ ...MARQ, basseDefinition: undefined, w: 400, wOriginal: 400 }]);
          const r = silencieux(); try { await joindreAdditif(B149.db, B149.M, SLUG); await joindreAdditif(B15.db, B15.M, SLUG); } finally { r(); }
          verifier('NETTEMENT PLUS GRANDE : 400 → 596 (1,49 ×) refusé, 400 → 600 (1,5 ×) admis (même impression)', [des(B149), des(B15)], [['tcgdex:false'], ['pikaqian:false']]); }
        { const { Bm } = monde(400, [{ ...MARQ, basseDefinition: undefined, w: 600 }]); const r = silencieux(); let J; try { J = await joindreAdditif(Bm.db, Bm.M, SLUG); } finally { r(); }
          verifier('une entrée NON marquée n\'est jamais remplacée : PikaQian cède', [des(Bm), J.dejaParAutre, Bm.col('images').get('mq').etat], [['tcgdex:false'], 1, 'ok']); }
        { const { Bm } = monde(400, [{ ...MARQ, langue: 'ja' }]); const r = silencieux(); let J; try { J = await joindreAdditif(Bm.db, Bm.M, SLUG); } finally { r(); }
          verifier('une entrée marquée d\'une AUTRE langue n\'est pas remplaçable : PikaQian cède', [des(Bm), J.dejaParAutre], [['tcgdex:true'], 1]); }
    }

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

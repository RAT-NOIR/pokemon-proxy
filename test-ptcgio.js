// node test-ptcgio.js — le collecteur images.pokemontcg.io de BOUT EN BOUT (collecte-cartes/ptcgio.js + collecteur-images-ptcgio.js), sur une base
// EN MÉMOIRE, un réseau SIMULÉ et un faux client R2 : aucune requête, aucune base réelle, rien sur R2. Ce que le banc garde :
//   · la table n'écrit que ce qu'elle AUTORISE (adresseDe : numéro dans la plage prouvée, suffixe/préfixe du kit) ;
//   · un substitut (Prize Packs, Battle Academy, WCD) est REFUSÉ, un set non prouvé aussi ;
//   · le client : hôte unique, chemins énumérés, cadence ≥ 2 s, défi ⇒ arrêt (et plus rien ensuite), redirection non suivie ;
//   · le collecteur : additif (un produit déjà pourvu n'est jamais touché), mention + lot + source + langue, reprise sans requête,
//     un visuel retiré ne revient pas, dimensions hétérogènes refusées, R2 avant la ligne ;
//   · le retrait en un lot retire EXACTEMENT le lot.
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

// ── une base en mémoire : les seules formes de requête que le collecteur emploie (même forme que test-collecteur-tpc.js) ──
function fausseBase({ dataSize = 1000, indexSize = 100 } = {}) {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) && !/^\d+$/.test(p) ? x.flatMap(e => e?.[p]) : x?.[p], o);   // « images.source » traverse le tableau, comme Mongo
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
    // ── 1. la table : adresseDe ─────────────────────────────────────────────────────────────────────────────────────
    const L = (slug, id) => P.TABLE_PTCGIO.find(l => l.slug === slug && l.id === id);
    verifier('EX Trainer Kit : « 3A » → tk1a n°3, « 6O » → tk1b n°6', [P.adresseDe(L('EX-Trainer-Kit', 'tk1a'), '3A'), P.adresseDe(L('EX-Trainer-Kit', 'tk1b'), '6O')], [3, 6]);
    verifier('EX Trainer Kit : le suffixe de l\'AUTRE moitié ne passe pas', [P.adresseDe(L('EX-Trainer-Kit', 'tk1a'), '3O'), P.adresseDe(L('EX-Trainer-Kit', 'tk1b'), '3A')], [null, null]);
    verifier('EX Trainer Kit : « 11A » est hors de la plage prouvée (10)', P.adresseDe(L('EX-Trainer-Kit', 'tk1a'), '11A'), null);
    verifier('EX Trainer Kit 2 : « P6 » → tk2a, « M12 » → tk2b, « P13 » hors plage', [P.adresseDe(L('EX-Trainer-Kit-2', 'tk2a'), 'P6'), P.adresseDe(L('EX-Trainer-Kit-2', 'tk2b'), 'M12'), P.adresseDe(L('EX-Trainer-Kit-2', 'tk2a'), 'P13')], [6, 12, null]);
    verifier('Celebrations : « 011 » → 11 ; « 026 », « BS 15 », null, « 77a » → rien', [P.adresseDe(L('Celebrations', 'cel25'), '011'), P.adresseDe(L('Celebrations', 'cel25'), '026'), P.adresseDe(L('Celebrations', 'cel25'), 'BS 15'), P.adresseDe(L('Celebrations', 'cel25'), null), P.adresseDe(L('Shining-Legends', 'sm35'), '77a')], [11, null, null, null, null]);
    verifier('Shining Legends : 72, 73 (principal) et 75 (secrète) sont couverts par un témoin ; 76 ne l\'est pas', [72, 73, 75, 76].map(n => P.adresseDe(L('Shining-Legends', 'sm35'), String(n))), [72, 73, 75, null]);
    verifier('Dragon Majesty : 70 (principal) et 78 (secrète) couverts ; 79 non', [70, 71, 78, 79].map(n => P.adresseDe(L('Dragon-Majesty', 'sm75'), String(n))), [70, 71, 78, null]);
    // 🔴 ruling du coordinateur (2026-10-10) : les témoins COUVRENT la plage écrite — un témoin dans chaque segment, et un au moins au plus grand numéro écrit
    const couvre = l => l.segments.every(([de, a]) => l.temoins.some(w => w.n >= de && w.n <= a) && l.temoins.some(w => w.n === a));
    verifier('chaque ligne : un témoin dans chaque segment de numérotation ET un témoin au plus grand numéro du segment', P.TABLE_PTCGIO.filter(l => !couvre(l)).map(l => l.id), []);
    verifier('la marque des McDonald\'s est celle que le relecteur a vue (symbole d\'extension propre au tirage), jamais « faible »', [P.TABLE_PTCGIO.filter(l => /faible/i.test(l.marque)).map(l => l.id), /hexagone/.test(L('McDonalds-Collection-2011', 'mcd11').marque), /« m »/.test(L('McDonalds-Collection-2016', 'mcd16').marque), /rond/.test(L('McDonalds-Collection-2019', 'mcd19').marque), (m => /symbole propre au tirage, en bas à gauche, à côté de la marque de règlement « E »/.test(m) && !/couronne|étoile| ou /.test(m))(L('McDonalds-Collection-2022', 'mcd22').marque)], [[], true, true, true, true]);   // mcd22 : ce qui est certain, sans nommer la forme (ruling)
    verifier('segments : Shining Legends et Dragon Majesty ont un segment principal ET un segment de secrètes', [L('Shining-Legends', 'sm35').segments.length, L('Dragon-Majesty', 'sm75').segments.length], [2, 2]);
    verifier('témoins ouverts le 2026-10-10 sur les numéros que la règle de mesure ne comptait pas : le nom imprimé est celui du produit', [[L('Shining-Legends', 'sm35'), 72, 'Mewtwo-GX'], [L('Dragon-Majesty', 'sm75'), 65, 'Reshiram-GX'], [L('Dragon-Majesty', 'sm75'), 41, 'Altaria-GX'], [L('Dragon-Majesty', 'sm75'), 70, 'Zinnia'], [L('Dragon-Majesty', 'sm75'), 69, 'Blaine\'s Last Stand']].map(([l, n, nom]) => l.temoins.find(w => w.n === n)?.nom === nom), [true, true, true, true, true]);
    verifier('l\'adresse d\'une image : la haute définition, jamais la vignette', P.urlHires('mcd12', 6), 'https://images.pokemontcg.io/mcd12/6_hires.png');
    verifier('chaque ligne de la table porte ses témoins lus à l\'œil (3 au moins, numéros distincts)', P.TABLE_PTCGIO.every(l => new Set((l.temoins || []).map(t => t.n)).size >= 3), true);

    // ── 2. le substitut est refusé ──────────────────────────────────────────────────────────────────────────────────
    verifier('Prize Pack, Battle Academy, WCD : substitut interdit', ['Play-Pokemon-Prize-Pack-Series-One', 'Battle-Academy-2024', 'WCD-2009'].map(s => P.verdictDuSet(s).verdict), ['substitut-interdit', 'substitut-interdit', 'substitut-interdit']);
    verifier('un set absent de la table : non apparié ; un set de la table : prouvé', [P.verdictDuSet('Unbroken-Bonds').verdict, P.verdictDuSet('Celebrations').verdict], ['non-apparie', 'prouve']);

    // ── 3. le plan, pur ────────────────────────────────────────────────────────────────────────────────────────────
    const carte = (id, nom, images = []) => ({ _id: id, nomEn: nom, images });
    // `numeroCm` : le numéro du produit Cardmarket (il FAIT l'adresse) ; `fiche` : le numéro de fiche (il ne fait que contredire)
    const t = (c, numeroCm, idProduct, fiche = numeroCm) => ({ carte: c, numeroCm, numeroFiche: fiche, idProduct });
    const plan1 = P.planifierPtcgio({ slug: 'Celebrations', trous: [t(carte(1, 'Pikachu'), '005', 10), t(carte(2, 'Mew'), '011', 11), t(carte(2, 'Mew'), '011', 12), t(carte(3, 'Zekrom'), null, 13),
        t(carte(4, 'Venusaur'), 'BS 15', 14, '15'), t(carte(5, 'Ho-Oh', [{ set: 'Celebrations', source: 'tcgdex', numero: '001' }]), '001', 15), t(carte(6, 'Lunala'), '011', 16, '12')] });
    verifier('plan : « 15 Venusaur » (classic collection, fiche n° 15 de Base Set, Cardmarket « BS 15 ») ne reçoit PAS la carte n° 15 de cel25', plan1.plan.some(p => p.carteId === 4), false);
    verifier('plan : 2 prouvés (le doublon carte+numéro compte une fois), l\'adresse est la haute définition', plan1.plan.map(p => [p.carteId, p.numero, p.url]), [[1, '005', 'https://images.pokemontcg.io/cel25/5_hires.png'], [2, '011', 'https://images.pokemontcg.io/cel25/11_hires.png']]);
    verifier('plan : un produit déjà pourvu au même numéro n\'est jamais dans le plan (additif)', plan1.plan.some(p => p.carteId === 5), false);
    verifier('plan : les restes disent pourquoi', plan1.restes.map(r => [r.carteId, r.motif]).sort(), [[3, 'sans-numero'], [4, 'numero-hors-set'], [6, 'numero-contradictoire']]);
    const plan2 = P.planifierPtcgio({ slug: 'Shining-Legends', trous: [t(carte(21, 'Raichu-GX'), '75', 31), t(carte(22, 'Hoopa'), '76', 32), t(carte(23, 'Pikachu'), '77a', 33)] });
    verifier('plan : un numéro hors de ce que les témoins couvrent est RETIRÉ et nommé « non couvert par un témoin » (76), un numéro d\'une autre forme (77a) reste hors set', [plan2.plan.map(p => p.carteId), plan2.restes.map(r => [r.carteId, r.motif])], [[21], [[22, 'non-couvert-par-un-temoin'], [23, 'numero-hors-set']]]);
    verifier('plan : le numéro de fiche absent (null) n\'empêche pas l\'adresse (McDonald\'s 2011 : Snivy)', P.planifierPtcgio({ slug: 'McDonalds-Collection-2011', trous: [t(carte(8, 'Snivy'), '1', 98, null)] }).plan.map(p => [p.url, p.numero]), [['https://images.pokemontcg.io/mcd11/1_hires.png', '1']]);
    verifier('plan : un substitut ne produit aucun plan', P.planifierPtcgio({ slug: 'WCD-2009', trous: [t(carte(9, 'Rare Candy'), '12', 99)] }), { plan: [], restes: [{ carteId: 9, nomEn: 'Rare Candy', numero: '12', idProduct: 99, motif: 'substitut-interdit' }] });

    // ── 4. dimensions : un fichier qui n'a pas celles des autres du set est refusé ───────────────────────────────
    const d1 = P.dimensionsAdmises([{ cle: 'a', w: 734, h: 1024 }, { cle: 'b', w: 734, h: 1024 }, { cle: 'c', w: 734, h: 1024 }, { cle: 'd', w: 245, h: 342 }]);
    verifier('dimensions : la majorité fait la règle, l\'écart est refusé et nommé', [d1.admis, d1.refuses.map(r => r.cle)], [['a', 'b', 'c'], ['d']]);
    verifier('dimensions : sans majorité nette, rien n\'est admis', P.dimensionsAdmises([{ cle: 'a', w: 734, h: 1024 }, { cle: 'b', w: 600, h: 825 }]).admis, []);

    // ── 5. le client ──────────────────────────────────────────────────────────────────────────────────────────────
    const png = await sharp({ create: { width: 734, height: 1024, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
    const reseau = repondre => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    const normal = url => url.endsWith('/robots.txt') ? { status: 200, texte: '# content signals, aucun Disallow\n' }
        : /\/(cel25|mcd12)\/([1-9]|[12]\d|30)_hires\.png$/.test(url) ? { status: 200, type: 'image/png', octets: png } : { status: 404, type: 'image/png' };
    const verrou = { tenu: true, perdu: false };
    const attentes = [];
    const pause = async ms => { attentes.push(ms); };
    const client = (tr, v = verrou, o = {}) => P.fabriquerClientPtcgio({ transport: tr, verrou: v, pause, ...o });

    let tr = reseau(normal);
    let c = client(tr, null);
    let err = null; try { await c.image(P.urlHires('cel25', 5)); } catch (e) { err = e.message; }
    verifier('garde fermée : sans verrou global lié, aucune requête', [/verrou/.test(err || ''), tr.appels.length], [true, 0]);
    tr = reseau(normal); c = client(tr);
    for (const u of ['https://autre.example/cel25/5_hires.png', 'http://images.pokemontcg.io.evil.example/cel25/5_hires.png', 'https://images.pokemontcg.io/../etc/passwd', 'https://images.pokemontcg.io/cel25/5.png?x=1', 'https://api.pokemontcg.io/v2/cards']) {
        err = null; try { await c.image(u); } catch (e) { err = e.message; }
        verifier(`hôte et chemin énumérés : refusé sans requête (${u.slice(8, 40)})`, [!!err, tr.appels.length], [true, 0]);
    }
    const b1 = await c.image(P.urlHires('cel25', 5));
    verifier('une image servie rend ses octets ; robots.txt lu avant la première', [Buffer.isBuffer(b1), tr.appels.map(u => u.replace('https://images.pokemontcg.io', ''))], [true, ['/robots.txt', '/cel25/5_hires.png']]);
    verifier('un 404 (le serveur répond la carte « introuvable » en image) rend null, pas une image', await c.image(P.urlHires('cel25', 99)), null);
    attentes.length = 0; await c.image(P.urlHires('cel25', 6)); await c.image(P.urlHires('cel25', 7));
    verifier('cadence : jamais moins de 2 s entre deux requêtes (consigne), 3 s par défaut', [attentes.length > 0 && attentes.every(ms => ms >= 2000), P.CADENCE_MS], [true, 3000]);
    verifier('cadence : un réglage plus rapide est relevé à 2 s', client(reseau(normal), verrou, { cadenceMs: 0 }).cadence(), 2000);

    for (const [nom, rep] of [['403', () => ({ status: 403, texte: 'non' })], ['429', () => ({ status: 429, texte: 'non' })], ['cf-mitigated', () => ({ status: 200, type: 'text/html', texte: 'x', cfMitigated: 'challenge' })], ['page de défi', () => ({ status: 200, type: 'text/html', texte: '<title>Just a moment...</title>' })]]) {
        tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : rep()); c = client(tr);
        err = null; try { await c.image(P.urlHires('cel25', 5)); } catch (e) { err = e; }
        const avant = tr.appels.length;
        let err2 = null; try { await c.image(P.urlHires('cel25', 6)); } catch (e) { err2 = e; }
        verifier(`défi (${nom}) : le client est BLOQUÉ, et plus aucune requête ne part`, [!!err?.bloque, !!err2?.bloque, tr.appels.length === avant], [true, true, true]);
    }
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 302, location: 'https://autre.example/x.png' }); c = client(tr);
    err = null; try { await c.image(P.urlHires('cel25', 5)); } catch (e) { err = e.message; }
    verifier('une redirection n\'est JAMAIS suivie (une seule requête d\'image)', [/redirection/.test(err || ''), tr.appels.filter(u => !u.endsWith('/robots.txt')).length], [true, 1]);
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: 'User-agent: *\nDisallow: /cel25/\n' } : normal(url)); c = client(tr);
    err = null; try { await c.image(P.urlHires('cel25', 5)); } catch (e) { err = e.message; }
    verifier('robots.txt respecté : un chemin interdit ne part pas', [/robots/.test(err || ''), tr.appels.length], [true, 1]);

    // ── 6. le collecteur de bout en bout ────────────────────────────────────────────────────────────────────────────
    const SLUG = 'Celebrations';
    const semer = B => {
        B.col('sets').set(SLUG, { _id: SLUG, tirage: 'intl', region: 'intl' });
        B.col('cartes').set(1, { _id: 1, nomEn: 'Pikachu', images: [{ set: 'Autre-Set', source: 'tcgdex', numero: '5', cleR2: 'tcgdex/x.webp' }] });
        B.col('cartes').set(2, { _id: 2, nomEn: 'Mew', images: [] });
        B.col('cartes').set(3, { _id: 3, nomEn: 'Ho-Oh', images: [{ set: SLUG, source: 'bulbapedia', numero: '001', cleR2: 'bulbapedia/h.webp', langue: 'en' }] });
        B.col('cartes').set(4, { _id: 4, nomEn: 'Venusaur', images: [] });
        B.col('cartes_produits').set('1|10', { _id: '1|10', carteId: 1, idProduct: 10, numeroFiche: '005', slugSet: SLUG });
        B.col('cartes_produits').set('2|11', { _id: '2|11', carteId: 2, idProduct: 11, numeroFiche: '011', slugSet: SLUG });
        B.col('cartes_produits').set('3|12', { _id: '3|12', carteId: 3, idProduct: 12, numeroFiche: '001', slugSet: SLUG });
        B.col('cartes_produits').set('4|13', { _id: '4|13', carteId: 4, idProduct: 13, numeroFiche: '15', slugSet: SLUG });   // classic collection : fiche n° 15 (Base Set), Cardmarket « BS 15 »
    };
    const NUMEROS_CM = { 10: '005', 11: '011', 12: '001', 13: 'BS 15', 14: '025', 15: '024' };
    const lireNumeros = async () => new Map(Object.entries(NUMEROS_CM).map(([k, v]) => [Number(k), v]));
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    // les VIGNETTES (règle du dépôt depuis le 2026-10-06) : le collecteur passe par `vignetterApresJointure`, comme collecteur-images.js ; le banc lui injecte un
    // `assurer` qui fait ce que fait assurerVignettes sur la base en mémoire (pas de R2) et note le bucket et le set qu'il a reçus
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const appelsVignettes = [];
    const assurerBanc = erreur => async (db, { bucket, slug }) => {
        appelsVignettes.push([bucket, slug]);
        if (typeof erreur === 'string') throw new Error(erreur);
        let n = 0;
        for (const c of await db.collection('cartes').find({}).toArray()) {
            let touche = false;
            const images = (c.images || []).map(e => { if (e.set !== slug || !e.cleR2 || e.vignette) return e; touche = true; n++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2.replace(/\.[^./]+$/, '')}.webp`, w: 200, h: 279 } }; });
            if (touche) await db.collection('cartes').updateOne({ _id: c._id }, { $set: { images } });
        }
        return { entrees: n, cles: n, traitees: n, fabriquees: n, deja: 0, depuisDocument: 0, echecs: erreur?.echecs ? [{ cleR2: 'x', erreur: 'lecture R2' }] : [], interrompu: !!erreur?.interrompu, sets: n ? [slug] : [] };
    };
    const vignetterBanc = (erreur = null) => (db, slug, o) => vignetterApresJointure(db, slug, { ...o, assurer: assurerBanc(erreur), journal: { error() { } } });
    const lancer = async (B, transport, o = {}) => {
        const depots = [];
        const cl = P.fabriquerClientPtcgio({ transport, verrou, pause });
        const r = silencieux();
        try { return { b: await collecterSlug(o.slug || SLUG, B.M, { verrou, client: cl, vignetter: vignetterBanc(o.erreurVignettes), lireNumeros: o.sansNumeros ? undefined : lireNumeros, deposer: async (...a) => depots.push(a), fabriquerVerrouSet: verrouSet, stopOctets: o.stopOctets }), depots, cl }; }
        finally { r(); }
    };
    const B = fausseBase(); semer(B);
    tr = reseau(normal);
    let { b, depots } = await lancer(B, tr);
    verifier('collecte : « verifie »', b.etat, 'verifie');
    verifier('requêtes : robots.txt puis les 2 trous prouvés — pas le produit déjà pourvu, pas « BS 15 »', tr.appels.map(u => u.replace('https://images.pokemontcg.io', '')), ['/robots.txt', '/cel25/5_hires.png', '/cel25/11_hires.png']);
    const im = B.col('images').get('pokemontcg.io/Celebrations/1/005/en');
    verifier('le document `images` : source, langue, mention, lot, état, adresse, preuve', [im?.source, im?.langue, im?.mention, im?.lot, im?.etat, im?.urlOriginal, /005/.test(im?.preuve || '') && /cel25/.test(im?.preuve || '')],
        ['pokemontcg.io', 'en', '© Pokémon / The Pokémon Company', 'ptcgio-2026-10', 'ok', 'https://images.pokemontcg.io/cel25/5_hires.png', true]);
    verifier('R2 AVANT la ligne : 2 dépôts WebP à la clé du set', [depots.length, depots[0]?.[1], depots[0]?.[3]], [2, 'pokemontcg.io/Celebrations/005-1-en.webp', 'image/webp']);
    verifier('la carte reçoit SON visuel et garde celui de l\'autre set', B.col('cartes').get(1).images.map(e => `${e.source}:${e.set}:${e.numero}`), ['tcgdex:Autre-Set:5', `pokemontcg.io:${SLUG}:005`]);
    verifier('   l\'entrée porte mention, lot, langue, attribution, source', ((e) => [e.mention, e.lot, e.langue, e.attribution, e.source])(B.col('cartes').get(2).images[0]), ['© Pokémon / The Pokémon Company', 'ptcgio-2026-10', 'en', '© Pokémon / The Pokémon Company', 'pokemontcg.io']);
    verifier('un produit DÉJÀ pourvu par une autre source : intact (additif ; la vignette est un champ NEUF que assurerVignettes pose partout, vignette.js)', B.col('cartes').get(3).images.map(({ vignette, ...e }) => e), [{ set: SLUG, source: 'bulbapedia', numero: '001', cleR2: 'bulbapedia/h.webp', langue: 'en' }]);
    verifier('un numéro hors plage (« BS 15 ») reste un trou : aucune entrée', B.col('cartes').get(4).images, []);
    verifier('VIGNETTES : après la jointure, le collecteur appelle vignetterApresJointure avec le bucket des images et le set', appelsVignettes[0], ['bucket-banc', SLUG]);
    const duLot = B.col('cartes').get(1).images.concat(B.col('cartes').get(2).images).filter(e => e.source === 'pokemontcg.io' && e.lot === 'ptcgio-2026-10');
    verifier('VIGNETTES : toute entrée du lot a sa vignette (2 entrées, clé sous vignettes/pokemontcg.io/)', [duLot.length, duLot.every(e => /^vignettes\/pokemontcg\.io\/Celebrations\/.+\.webp$/.test(e.vignette?.cleR2 || ''))], [2, true]);
    verifier('le bilan du set : 2 prouvés, garde verte', [B.col('sets').get(SLUG).visuelsPtcgio?.prouves, B.col('sets').get(SLUG).visuelsPtcgio?.garde?.ok], [2, true]);

    tr = reseau(normal);
    ({ b, depots } = await lancer(B, tr));
    verifier('un second passage : « verifie », 0 téléchargement, 0 dépôt, pas de doublon', [b.etat, tr.appels.filter(u => /hires/.test(u)).length, depots.length, B.col('cartes').get(1).images.length], ['verifie', 0, 0, 2]);

    // un visuel RETIRÉ ne revient jamais
    B.col('images').get('pokemontcg.io/Celebrations/2/011/en').etat = 'retire';
    B.col('cartes').get(2).images = [];
    tr = reseau(normal);
    ({ b } = await lancer(B, tr));
    verifier('un visuel retiré (état « retire ») n\'est ni redemandé ni rejoint', [tr.appels.filter(u => /hires/.test(u)).length, B.col('cartes').get(2).images.length], [0, 0]);

    // défi en cours de route : arrêt, ce qui est prouvé avant est joint, l'alerte est écrite
    const B2 = fausseBase(); semer(B2);
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : /\/5_hires/.test(url) ? { status: 200, type: 'image/png', octets: png } : { status: 403, texte: 'Just a moment' });
    ({ b } = await lancer(B2, tr));
    verifier('défi au second fichier : unité « incomplet », une alerte active, la carte 1 jointe, la 2 non', [b.etat, B2.col('collecte_images_etat').get('alerte/source-bloquee/pokemontcg-io')?.active, B2.col('cartes').get(1).images.length, B2.col('cartes').get(2).images.length], ['incomplet', true, 2, 0]);
    tr = reseau(normal);
    ({ b } = await lancer(B2, tr));
    verifier('source bloquée : aucune requête ensuite', [b.etat, tr.appels.length], ['refuse-source-bloquee', 0]);

    // dimensions hétérogènes : l'écart est refusé, rien n'est écrit pour lui
    const petit = await sharp({ create: { width: 600, height: 825, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();   // 600×825 : au-dessus du seuil, mais pas les dimensions des autres
    const B3 = fausseBase(); semer(B3);
    B3.col('cartes').set(5, { _id: 5, nomEn: 'Mew', images: [] }); B3.col('cartes_produits').set('5|14', { _id: '5|14', carteId: 5, idProduct: 14, numeroFiche: '025', slugSet: SLUG });
    B3.col('cartes').set(6, { _id: 6, nomEn: 'Mew', images: [] }); B3.col('cartes_produits').set('6|15', { _id: '6|15', carteId: 6, idProduct: 15, numeroFiche: '024', slugSet: SLUG });
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : /\/24_hires/.test(url) ? { status: 200, type: 'image/png', octets: petit } : { status: 200, type: 'image/png', octets: png });
    ({ b, depots } = await lancer(B3, tr));
    verifier('dimensions : le fichier 600×825 d\'un set en 734×1024 est refusé, les 3 autres jointes', [B3.col('cartes').get(6).images.length, [1, 2, 5].map(i => B3.col('cartes').get(i).images.filter(e => e.source === 'pokemontcg.io').length), depots.length], [0, [1, 1, 1], 3]);

    // les vignettes qui échouent : l'unité n'est PAS « verifie » (une entrée sans vignette est servie sans), et l'erreur se dit
    const B8 = fausseBase(); semer(B8);
    ({ b } = await lancer(B8, reseau(normal), { erreurVignettes: 'R2 injoignable' }));
    verifier('vignettes en échec : l\'unité est « incomplet », le bilan porte l\'erreur', [b.etat, b.vignettes?.erreur], ['incomplet', 'R2 injoignable']);
    const B9 = fausseBase(); semer(B9);
    ({ b } = await lancer(B9, reseau(normal), { erreurVignettes: { echecs: true } }));
    verifier('vignettes : `echecs > 0` (une image non vignettée) : l\'unité est « incomplet »', [b.etat, b.vignettes?.echecs], ['incomplet', 1]);
    const B10 = fausseBase(); semer(B10);
    ({ b } = await lancer(B10, reseau(normal), { erreurVignettes: { interrompu: true } }));
    verifier('vignettes : `interrompu` : l\'unité est « incomplet »', [b.etat, b.vignettes?.interrompu], ['incomplet', true]);

    // un set non prouvé / un substitut : aucune requête
    const B4 = fausseBase(); B4.col('sets').set('WCD-2009', { _id: 'WCD-2009', tirage: 'intl', region: 'intl' });
    tr = reseau(normal);
    ({ b } = await lancer(B4, tr, { slug: 'WCD-2009' }));
    verifier('un substitut (WCD) : refusé, 0 requête', [b.etat, tr.appels.length], ['refuse-substitut', 0]);
    ({ b } = await lancer(fausseBase(), tr, { slug: 'Unbroken-Bonds' }));
    verifier('un set non prouvé : refusé, 0 requête', [b.etat, tr.appels.length], ['refuse-set-non-apparie', 0]);
    const B5 = fausseBase(); semer(B5); B5.col('sets').get(SLUG).tirage = 'jp';
    ({ b } = await lancer(B5, tr));
    verifier('un set dont le tirage n\'est pas « intl » en base : refusé', [b.etat, tr.appels.length], ['refuse-set', 0]);
    const B6 = fausseBase({ dataSize: 450 * 1024 * 1024 }); semer(B6);
    ({ b } = await lancer(B6, tr));
    verifier('la garde de taille (400 Mo) : refus avant toute requête', [b.etat, tr.appels.length], ['refuse-taille-base', 0]);
    const B7 = fausseBase(); semer(B7);
    ({ b } = await lancer(B7, tr, { sansNumeros: true }));
    verifier('sans la lecture des numéros Cardmarket : refus avant toute requête (l\'adresse ne se devine pas depuis la fiche)', [b.etat, tr.appels.length], ['refuse-numeros', 0]);

    // ── 7. le retrait en un lot retire EXACTEMENT le lot ──────────────────────────────────────────────────────────────
    const cartes = [
        { _id: 1, images: [{ set: 'S', source: 'pokemontcg.io', lot: 'ptcgio-2026-10', cleR2: 'a', vignette: { cleR2: 'va' } }, { set: 'S', source: 'tcgdex', cleR2: 'b' }] },
        { _id: 2, images: [{ set: 'S', source: 'pokemontcg.io', lot: 'autre-lot', cleR2: 'c' }, { set: 'S', source: 'tpc-asie', lot: 'ptcgio-2026-10', cleR2: 'd' }] },
        { _id: 3, images: [{ set: 'S', source: 'bulbapedia', cleR2: 'e' }] }
    ];
    const R = P.planRetraitPtcgio(cartes);
    verifier('retrait : seules les entrées source ET lot du collecteur, avec leur vignette', [R.cartes, R.entrees, R.cles], [[1], 1, ['a', 'va']]);

    // le chemin `--ecrire` du retrait, de bout en bout : base en mémoire, faux R2
    const { retirerLot } = require('./retirer-visuels-ptcgio');
    const semerRetrait = () => {
        const Bx = fausseBase();
        Bx.col('cartes').set(1, { _id: 1, images: [{ set: 'S', source: 'pokemontcg.io', lot: 'ptcgio-2026-10', numero: '5', cleR2: 'a', vignette: { cleR2: 'va' } }, { set: 'S', source: 'tcgdex', cleR2: 'b', vignette: { cleR2: 'vb' } }] });
        Bx.col('cartes').set(2, { _id: 2, images: [{ set: 'S', source: 'pokemontcg.io', lot: 'autre-lot', cleR2: 'c', vignette: { cleR2: 'vc' } }, { set: 'S', source: 'tpc-asie', lot: 'ptcgio-2026-10', cleR2: 'd' }] });
        Bx.col('cartes').set(3, { _id: 3, images: [{ set: 'S', source: 'bulbapedia', cleR2: 'e' }] });
        Bx.col('images').set('i1', { _id: 'i1', source: 'pokemontcg.io', lot: 'ptcgio-2026-10', etat: 'ok', cleR2: 'a', vignette: { cleR2: 'va' } });
        Bx.col('images').set('i2', { _id: 'i2', source: 'pokemontcg.io', lot: 'autre-lot', etat: 'ok', cleR2: 'c' });
        Bx.col('images').set('i3', { _id: 'i3', source: 'tcgdex', etat: 'ok', cleR2: 'b' });
        Bx.col('sets').set('S', { _id: 'S', visuelsPtcgio: { prouves: 1 }, visuelsTpc: { 'tpc-asie': { prouves: 1 } } });
        Bx.col('sets').set('T', { _id: 'T', visuelsPtcgio: { prouves: 0 } });
        Bx.col('sets').set('U', { _id: 'U' });
        return Bx;
    };
    const effaces = [];
    const optionsRetrait = o => ({ supprimer: async (bucket, cles) => { effaces.push([bucket, ...cles]); }, bucket: 'bucket-banc', verifierBucket: async () => { }, ...o });
    let Bx = semerRetrait();
    const avantSim = JSON.stringify([...Bx.cols].map(([k, m]) => [k, [...m]]));
    const rest = silencieux();
    let simu; try { simu = await retirerLot(Bx.db, optionsRetrait({ ecrire: false })); } finally { rest(); }
    verifier('retrait, simulation : rien n\'est écrit, et le plan dit 1 carte, 1 entrée, 1 document, les clés d\'image ET de vignette', [JSON.stringify([...Bx.cols].map(([k, m]) => [k, [...m]])) === avantSim, simu.cartes, simu.entrees, simu.docs, simu.cles], [true, [1], 1, 1, ['a', 'va']]);
    const rest2 = silencieux();
    let ecr; try { ecr = await retirerLot(Bx.db, optionsRetrait({ ecrire: true, effacerR2: true })); } finally { rest2(); }
    verifier('retrait --ecrire : seule l\'entrée du lot sort (la vignette avec), les autres sources et l\'autre lot restent', [Bx.col('cartes').get(1).images.map(e => e.source), Bx.col('cartes').get(2).images.map(e => `${e.source}:${e.lot ?? ''}`), Bx.col('cartes').get(3).images.length], [['tcgdex'], ['pokemontcg.io:autre-lot', 'tpc-asie:ptcgio-2026-10'], 1]);
    verifier('retrait --ecrire : le document du lot passe à « retire » (avec date et motif), les autres ne bougent pas', [Bx.col('images').get('i1').etat, !!Bx.col('images').get('i1').retireLe, !!Bx.col('images').get('i1').retireMotif, Bx.col('images').get('i2').etat, Bx.col('images').get('i3').etat], ['retire', true, true, 'ok', 'ok']);
    verifier('retrait --ecrire : `sets.visuelsPtcgio` est nettoyé PARTOUT, rien d\'autre du set n\'est touché', [Bx.col('sets').get('S').visuelsPtcgio, Bx.col('sets').get('T').visuelsPtcgio, Bx.col('sets').get('S').visuelsTpc?.['tpc-asie']?.prouves, 'visuelsPtcgio' in Bx.col('sets').get('U')], [undefined, undefined, 1, false]);
    verifier('retrait --ecrire : la source est fermée (alerte active, retrait) ; R2 : les clés du lot, vignette comprise, et elles seules', [Bx.col('collecte_images_etat').get('alerte/source-bloquee/pokemontcg-io')?.active, Bx.col('collecte_images_etat').get('alerte/source-bloquee/pokemontcg-io')?.retrait, effaces], [true, true, [['bucket-banc', 'a', 'va']]]);
    verifier('retrait --ecrire : relu, plus aucune entrée du lot (reste 0)', ecr.reste, 0);
    effaces.length = 0;
    const rest3 = silencieux();
    let sans; try { sans = await retirerLot(semerRetrait().db, optionsRetrait({ ecrire: true })); } finally { rest3(); }
    verifier('retrait sans --effacer-r2 : R2 n\'est pas touché', effaces.length, 0);

    // 🔴 LE BUCKET D'ABORD (relecture du 2026-10-10) : le bucket est en juridiction UE, le point d'accès générique répond AccessDenied ; tous les outils qui écrivent
    // sur R2 appellent `verifierBucket` avant le premier dépôt. La fonction de lancement le fait avant la première requête vers pokemontcg.io.
    const { lancerEcriture } = require('./collecteur-images-ptcgio');
    const ordre = [];
    const fauxR2 = (echec = null) => ({
        async verifierBucket(b) { ordre.push(`verifierBucket:${b}`); if (echec) throw new Error(echec); },
        async deposerBinaire() { ordre.push('deposer'); return { ecrit: true }; }
    });
    const reseauOrdre = () => ({ async get(url) { ordre.push(url.endsWith('/robots.txt') ? 'requete:robots' : 'requete:image'); return normal(url); } });
    const baseSemee = () => { const Bz = fausseBase(); semer(Bz); return Bz; };
    const lanceur = async (Bz, R2, o = {}) => {
        const cl = P.fabriquerClientPtcgio({ transport: reseauOrdre(), verrou, pause });
        const r = silencieux();
        try { return await lancerEcriture([SLUG], Bz.M, { verrou, client: cl, lireNumeros, R2, bucket: 'bucket-banc', vignetter: vignetterBanc(), fabriquerVerrouSet: verrouSet, ...o }); } finally { r(); }
    };
    ordre.length = 0;
    const ro = await lanceur(baseSemee(), fauxR2());
    verifier('lancement : verifierBucket est le PREMIER appel, avant le premier dépôt R2 et avant la première requête vers pokemontcg.io', [ordre[0], ordre.indexOf('deposer') > 0, ordre.findIndex(x => x.startsWith('requete')) > 0, ordre.filter(x => x.startsWith('verifierBucket')).length, ro.code], ['verifierBucket:bucket-banc', true, true, 1, 0]);
    ordre.length = 0;
    const Bn = baseSemee();
    const avantBn = JSON.stringify([...Bn.cols].map(([k, m]) => [k, [...m]]));
    let echecBucket = null; try { await lanceur(Bn, fauxR2('AccessDenied')); } catch (e) { echecBucket = e.message; }
    verifier('lancement : un échec de verifierBucket = 0 requête, 0 dépôt, 0 écriture en base', [echecBucket, ordre, JSON.stringify([...Bn.cols].map(([k, m]) => [k, [...m]])) === avantBn], ['AccessDenied', ['verifierBucket:bucket-banc'], true]);
    ordre.length = 0;
    let sansBucket = null; try { await lanceur(baseSemee(), fauxR2(), { bucket: '' }); } catch (e) { sansBucket = e.message; }
    verifier('lancement : sans nom de bucket, refus avant tout appel', [/bucket/.test(sansBucket || ''), ordre.length], [true, 0]);
    // le retrait : verifierBucket seulement avec --effacer-r2, et avant toute écriture
    const ordreR = [];
    const Br = semerRetrait();
    const avantBr = JSON.stringify([...Br.cols].map(([k, m]) => [k, [...m]]));
    let echecR = null; const rt = silencieux();
    try { await retirerLot(Br.db, { ecrire: true, effacerR2: true, supprimer: async () => { ordreR.push('supprimer'); }, bucket: 'bucket-banc', verifierBucket: async b => { ordreR.push(`verifierBucket:${b}`); throw new Error('AccessDenied'); } }); } catch (e) { echecR = e.message; } finally { rt(); }
    verifier('retrait --effacer-r2 : un échec de verifierBucket = rien d\'écrit ni de supprimé', [echecR, ordreR, JSON.stringify([...Br.cols].map(([k, m]) => [k, [...m]])) === avantBr], ['AccessDenied', ['verifierBucket:bucket-banc'], true]);
    const ordreR2 = [];
    const rt2 = silencieux();
    try { await retirerLot(semerRetrait().db, { ecrire: true, effacerR2: false, supprimer: async () => ordreR2.push('supprimer'), verifierBucket: async () => ordreR2.push('verifierBucket') }); } finally { rt2(); }
    verifier('retrait sans --effacer-r2 : R2 n\'est pas consulté (ni vérifié ni supprimé)', ordreR2, []);

    // ── 8. la langue ──────────────────────────────────────────────────────────────────────────────────────────────────
    verifier('langue : la preuve écrite en base porte le VRAI compte (82 témoins, 90 images ouvertes) et plus « 42 »', [/82 témoins/.test(langueDuVisuel({ source: 'pokemontcg.io' }).preuve), /90 images/.test(langueDuVisuel({ source: 'pokemontcg.io' }).preuve), /42/.test(langueDuVisuel({ source: 'pokemontcg.io' }).preuve), P.TABLE_PTCGIO.reduce((n, l) => n + l.temoins.length, 0)], [true, true, false, 82]);
    verifier('langue : pokemontcg.io → « en » avec sa preuve ; une autre source inconnue → null', [langueDuVisuel({ source: 'pokemontcg.io' }).langue, !!langueDuVisuel({ source: 'pokemontcg.io' }).preuve, langueDuVisuel({ source: 'inconnue' }).langue], ['en', true, null]);

    // ── 9. T2 (2026-10-12) : la source numérote parfois « SM246 », « TG05 » — le jeton d'URL s'écrit par ce qu'il AUTORISE ───────────────────────────
    const JT = { prefixe: 'TG', largeur: 2 };
    verifier('jeton d\'URL : un préfixe et une largeur donnent « TG05 », « SM246 », « SWSH301 » ; sans jeton, l\'entier nu', [P.urlHires('swsh9tg', 5, JT), P.urlHires('smp', 246, { prefixe: 'SM', largeur: 2 }), P.urlHires('swshp', 301, { prefixe: 'SWSH', largeur: 3 }), P.urlHires('mcd12', 6)],
        ['https://images.pokemontcg.io/swsh9tg/TG05_hires.png', 'https://images.pokemontcg.io/smp/SM246_hires.png', 'https://images.pokemontcg.io/swshp/SWSH301_hires.png', 'https://images.pokemontcg.io/mcd12/6_hires.png']);
    verifier('jeton d\'URL : un préfixe hors de la liste énumérée LÈVE (rien ne se construit sur un préfixe inconnu)', (() => { try { P.urlHires('x1', 5, { prefixe: 'FOO', largeur: 2 }); return 'passe'; } catch (e) { return 'leve'; } })(), 'leve');
    verifier('jeton d\'URL : les préfixes autorisés sont énumérés', P.JETONS_URL, ['SM', 'SWSH', 'XY', 'HGSS', 'BW', 'DP', 'TG', 'GG', 'H']);
    tr = reseau(normal); c = client(tr);
    for (const u of ['https://images.pokemontcg.io/smp/FOO01_hires.png', 'https://images.pokemontcg.io/smp/sm01_hires.png', 'https://images.pokemontcg.io/smp/SM1234_hires.png', 'https://images.pokemontcg.io/smp/SMSM01_hires.png', 'https://images.pokemontcg.io/smp/SM01.png']) {
        err = null; try { await c.image(u); } catch (e) { err = e.message; }
        verifier(`client : un nom de fichier hors des formes énumérées est refusé sans requête (${u.slice(30)})`, [!!err, tr.appels.length], [true, 0]);
    }
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 200, type: 'image/png', octets: png }); c = client(tr);
    await c.image(P.urlHires('smp', 246, { prefixe: 'SM', largeur: 2 })); await c.image(P.urlHires('swsh9tg', 5, JT));
    verifier('client : « SM246 » et « TG05 » sont acceptés (hôte et chemin énumérés)', tr.appels.map(u => u.replace('https://images.pokemontcg.io', '')), ['/robots.txt', '/smp/SM246_hires.png', '/swsh9tg/TG05_hires.png']);

    // les cinq sets prouvés le 2026-10-12 (T2) : numéros d'URL, jetons, segments — chacun a son « NON »
    const SMP = L('SM-Black-Star-Promos', 'smp'), BRS = L('Brilliant-Stars', 'swsh9tg'), LOR = L('Lost-Origin', 'swsh11tg'), HSP = L('HGSS-Black-Star-Promos', 'hsp'), M21 = L('McDonalds-Collection-25th-Anniversary', 'mcd21');
    verifier('T2 : les cinq lignes existent', [SMP, BRS, LOR, HSP, M21].map(l => !!l), [true, true, true, true, true]);
    verifier('SM promos : « 246 » et « 89 » → URL SM246 / SM89 ; 88 (sous le segment prouvé), 249, « SM240 » (autre forme), null → rien', [P.adresseDe(SMP, '246'), P.adresseDe(SMP, '89'), P.adresseDe(SMP, '88'), P.adresseDe(SMP, '249'), P.adresseDe(SMP, 'SM240'), P.adresseDe(SMP, null)], [246, 89, null, null, null, null]);
    verifier('Trainer Gallery : « TG10 » → 10 ; « TG31 » hors segment, « 10 » (le set principal) et « TG-10 » ne passent pas', [P.adresseDe(BRS, 'TG10'), P.adresseDe(BRS, 'TG31'), P.adresseDe(BRS, '10'), P.adresseDe(BRS, 'TG-10'), P.adresseDe(BRS, 'tg10')], [10, null, null, null, null]);
    verifier('Lost Origin : le segment commence là où le premier témoin a parlé (TG03) : TG03 passe, TG02 non', [P.adresseDe(LOR, 'TG03'), P.adresseDe(LOR, 'TG02'), P.adresseDe(LOR, 'TG30'), P.adresseDe(LOR, 'TG31')], [3, null, 30, null]);
    verifier('HGSS promos : 17 à 25 seulement ; McDonald\'s 25th : 1 à 25 seulement', [[16, 17, 25, 26].map(n => P.adresseDe(HSP, String(n))), [0, 1, 25, 26].map(n => P.adresseDe(M21, String(n)))], [[null, 17, 25, null], [null, 1, 25, null]]);
    verifier('jetons : SM→2 chiffres, SWSH hors table, TG→2 chiffres, HGSS→2 chiffres, McDonald\'s→entier nu', [SMP, BRS, LOR, HSP, M21].map(l => l.jeton ? `${l.jeton.prefixe}${l.jeton.largeur}` : null), ['SM2', 'TG2', 'TG2', 'HGSS2', null]);
    verifier('jetons : toute ligne de la table n\'emploie qu\'un préfixe énuméré', P.TABLE_PTCGIO.filter(l => l.jeton && !P.JETONS_URL.includes(l.jeton.prefixe)).map(l => l.id), []);
    verifier('verdict : les cinq sets prouvés', ['SM-Black-Star-Promos', 'Brilliant-Stars', 'Lost-Origin', 'HGSS-Black-Star-Promos', 'McDonalds-Collection-25th-Anniversary'].map(s => P.verdictDuSet(s).verdict), ['prouve', 'prouve', 'prouve', 'prouve', 'prouve']);
    verifier('verdict : les sets sondés et NON prouvés restent des trous (SWSH promos 2 témoins sur 3, Best of Game variantes, SV promos, kits : 404, McDonald\'s 2014/2017/2024)',
        ['SWSH-Black-Star-Promos', 'Best-of-Game-Cards-Promos', 'SV-Black-Star-Promos', 'XY-Trainer-Kit', 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', 'HS-Trainer-Kit', 'BW-Trainer-Kit', 'DP-Trainer-Kit', 'McDonalds-Collection-2014', 'McDonalds-Collection-2017', 'McDonalds-Collection-2024', 'XY-Black-Star-Promos', 'HeartGold-SoulSilver'].map(s => P.verdictDuSet(s).verdict),
        Array(13).fill('non-apparie'));
    const planT = (slug, trous) => P.planifierPtcgio({ slug, trous });
    const pTG = planT('Brilliant-Stars', [t(carte(31, 'Houndoom'), 'TG10', 501), t(carte(32, 'Zekrom'), 'TG05', 502, '5'), t(carte(33, 'Pikachu'), '10', 503, '10'), t(carte(34, 'Eevee'), 'TG31', 504)]);
    verifier('plan Trainer Gallery : TG10 → …/swsh9tg/TG10_hires.png ; le numéro du set principal (10) est « hors set » ; TG31 « non couvert » ; fiche et adresse doivent concorder',
        [pTG.plan.map(p => [p.carteId, p.url]), pTG.restes.map(r => [r.carteId, r.motif])], [[[31, 'https://images.pokemontcg.io/swsh9tg/TG10_hires.png'], [32, 'https://images.pokemontcg.io/swsh9tg/TG05_hires.png']], [[33, 'numero-hors-set'], [34, 'non-couvert-par-un-temoin']]]);
    const pSM = planT('SM-Black-Star-Promos', [t(carte(41, 'Sabrina & Brycen'), '246', 601), t(carte(42, 'Pikachu'), '246', 602, '99')]);
    verifier('plan SM promos : « 246 » → …/smp/SM246_hires.png ; une fiche qui contredit le numéro refuse', [pSM.plan.map(p => p.url), pSM.restes.map(r => r.motif)], [['https://images.pokemontcg.io/smp/SM246_hires.png'], ['numero-contradictoire']]);
    verifier('plan HGSS promos : « 24 » → …/hsp/HGSS24_hires.png', planT('HGSS-Black-Star-Promos', [t(carte(51, 'Hitmonchan'), '24', 701)]).plan.map(p => p.url), ['https://images.pokemontcg.io/hsp/HGSS24_hires.png']);

    // ── 10. T2, tour de correction 1 : un numéro qui porte 2 produits Cardmarket ou plus (V1/V2/V3) — la source n'a qu'un fichier par numéro, la note le DIT ──
    const NOTE = 'variante Cardmarket : la source ne distingue pas les variantes de ce numéro — une image par numéro';
    const pV = P.planifierPtcgio({ slug: 'SM-Black-Star-Promos', tousNumerosCm: ['90', '90', '246', '089', 'SM240', '156', '156', '156'], trous: [t(carte(61, 'Raichu-GX'), '90', 801), t(carte(62, 'Sabrina & Brycen'), '246', 802), t(carte(63, 'Zoroark'), '89', 803), t(carte(64, 'Dragonite-GX'), '156', 804)] });
    verifier('note de variante : OUI sur un numéro doublé (90 ×2, 156 ×3), NON sur un numéro seul (246, « 089 » = 89), comptés par le numéro du produit', pV.plan.map(p => [p.carteId, p.noteVariante ?? null]), [[61, NOTE], [62, null], [63, null], [64, NOTE]]);
    verifier('note de variante : sans la liste des numéros du set, aucune note n\'est inventée', P.planifierPtcgio({ slug: 'SM-Black-Star-Promos', trous: [t(carte(65, 'Raichu-GX'), '90', 805)] }).plan.map(p => p.noteVariante ?? null), [null]);
    verifier('note de variante : « SM240 » (autre forme) ne compte pas pour le numéro 240', P.planifierPtcgio({ slug: 'SM-Black-Star-Promos', tousNumerosCm: ['240', 'SM240'], trous: [t(carte(66, 'Espeon & Deoxys-GX'), '240', 806)] }).plan.map(p => p.noteVariante ?? null), [null]);
    verifier('note de variante : deux produits au même NOM mais à deux numéros ne la portent pas (jamais comptée par le nom)', P.planifierPtcgio({ slug: 'McDonalds-Collection-25th-Anniversary', tousNumerosCm: ['13', '17'], trous: [t(carte(67, 'Squirtle'), '17', 807), t(carte(68, 'Squirtle'), '13', 808)] }).plan.map(p => p.noteVariante ?? null), [null, null]);
    {   // de bout en bout : le collecteur écrit la note sur l'entrée cartes.images (et le document images) — numéro doublé seulement
        const Bv = fausseBase(); semer(Bv);
        const lireDouble = async () => new Map([...Object.entries(NUMEROS_CM), [99, '011']].map(([k, v]) => [Number(k), v]));
        await lanceur(Bv, fauxR2(), { lireNumeros: lireDouble });
        const e = id => (Bv.col('cartes').get(id).images || []).filter(x => x.source === 'pokemontcg.io').map(x => x.noteVariante ?? null);
        verifier('collecteur : l\'entrée du numéro doublé (Mew 011) porte la note, celle du numéro seul (Pikachu 005) ne la porte pas', [e(2), e(1)], [[NOTE], [null]]);
        verifier('collecteur : le document images porte la même note (Mew) et les entrées des autres sources ne bougent pas', [Bv.col('images').get(P.idImagePtcgio(SLUG, 2, '011')).noteVariante, Bv.col('cartes').get(1).images.filter(x => x.source !== 'pokemontcg.io').map(x => Object.keys(x).sort().join())], [NOTE, ['cleR2,numero,set,source']]);
    }

    // ── 11. T7b (2026-10-12) : les holos « H » de Skyridge (ecard3) et d'Aquapolis (ecard2) — la source numérote « H1 »…« H32 » ───────────────────────
    verifier('T7b jeton « H » : urlHires donne …/ecard3/H1_hires.png et …/ecard2/H32_hires.png', [P.urlHires('ecard3', 1, { prefixe: 'H', largeur: 1 }), P.urlHires('ecard2', 32, { prefixe: 'H', largeur: 1 })], ['https://images.pokemontcg.io/ecard3/H1_hires.png', 'https://images.pokemontcg.io/ecard2/H32_hires.png']);
    tr = reseau(url => url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 200, type: 'image/png', octets: png }); c = client(tr);
    await c.image(P.urlHires('ecard3', 1, { prefixe: 'H', largeur: 1 }));
    verifier('T7b client : « H1 » est accepté (hôte et chemin énumérés)', tr.appels.map(u => u.replace('https://images.pokemontcg.io', '')), ['/robots.txt', '/ecard3/H1_hires.png']);
    tr = reseau(normal); c = client(tr);
    for (const u of ['https://images.pokemontcg.io/ecard3/HH1_hires.png', 'https://images.pokemontcg.io/ecard3/h1_hires.png', 'https://images.pokemontcg.io/ecard3/H1234_hires.png', 'https://images.pokemontcg.io/ecard3/SMH1_hires.png', 'https://images.pokemontcg.io/ecard3/H_hires.png']) {
        err = null; try { await c.image(u); } catch (e) { err = e.message; }
        verifier(`T7b client : une adresse hors de la forme « H<n> » est refusée sans requête (${u.slice(30)})`, [!!err, tr.appels.length], [true, 0]);
    }
    const SKY = L('Skyridge', 'ecard3'), AQU = L('Aquapolis', 'ecard2');
    verifier('T7b : les deux lignes existent, avec jeton H sur un seul chiffre', [!!SKY, !!AQU, SKY?.jeton, AQU?.jeton], [true, true, { prefixe: 'H', largeur: 1 }, { prefixe: 'H', largeur: 1 }]);
    verifier('T7b Skyridge : « H1 » → 1, « H32 » → 32 ; « H0 », « H33 », « 2 » (l\'impression ORDINAIRE), « SK2 », « h1 » → rien', ['H1', 'H32', 'H0', 'H33', '2', 'SK2', 'h1', null].map(n => P.adresseDe(SKY, n)), [1, 32, null, null, null, null, null, null]);
    verifier('T7b Aquapolis : « H7 » → 7, « H32 » → 32 ; « H6 » (sous le segment prouvé), « H33 », « 8 », « 50b » → rien', ['H7', 'H32', 'H6', 'H33', '8', '50b'].map(n => P.adresseDe(AQU, n)), [7, 32, null, null, null, null]);
    // correction 1 : les jumeaux de même nom (Magcargo H16/H17, Magneton H18/H19) ne se séparent que par le numéro de l'adresse : leurs 4 images ont été ouvertes et comparées aux attaques/PV/illustrateur de la fiche
    verifier('T7b jumeaux : H16, H17, H18, H19 de Skyridge ont chacun leur témoin', [16, 17, 18, 19].map(n => SKY.temoins.some(w => w.n === n && w.imprime === `H${n}/H32`)), [true, true, true, true]);
    {   // aucun nom ne se répète dans un segment sans que CHAQUE numéro du couple porte un témoin (noms = mesure du 2026-10-12, couverture\T7b\mesure.txt)
        const NOMS = { ecard3: { 1: 'Alakazam', 2: 'Arcanine', 3: 'Articuno', 4: 'Beedrill', 5: 'Crobat', 6: 'Dewgong', 7: 'Flareon', 8: 'Forretress', 9: 'Gengar', 10: 'Gyarados', 11: 'Houndoom', 12: 'Jolteon', 13: 'Kabutops', 14: 'Ledian', 15: 'Machamp', 16: 'Magcargo', 17: 'Magcargo', 18: 'Magneton', 19: 'Magneton', 20: 'Moltres', 21: 'Nidoqueen', 22: 'Piloswine', 23: 'Politoed', 24: 'Poliwrath', 25: 'Raichu', 26: 'Raikou', 27: 'Rhydon', 28: 'Starmie', 29: 'Steelix', 30: 'Umbreon', 31: 'Vaporeon', 32: 'Xatu' },
            ecard2: { 7: 'Electrode', 8: 'Entei', 9: 'Espeon', 10: 'Exeggutor', 11: 'Houndoom', 12: 'Hypno', 13: 'Jumpluff', 14: 'Kingdra', 15: 'Lanturn', 16: 'Magneton', 17: 'Muk', 18: 'Nidoking', 19: 'Ninetales', 20: 'Octillery', 21: 'Scizor', 22: 'Slowking', 23: 'Steelix', 24: 'Sudowoodo', 25: 'Suicune', 26: 'Tentacruel', 27: 'Togetic', 28: 'Tyranitar', 29: 'Umbreon', 30: 'Victreebel', 31: 'Vileplume', 32: 'Zapdos' } };
        const sansTemoin = [];
        for (const l of [SKY, AQU]) {
            const parNom = {};
            for (const [n, nom] of Object.entries(NOMS[l.id])) if (l.segments.some(([a, b]) => Number(n) >= a && Number(n) <= b)) (parNom[nom] ||= []).push(Number(n));
            for (const [nom, ns] of Object.entries(parNom)) if (ns.length > 1) for (const n of ns) if (!l.temoins.some(w => w.n === n)) sansTemoin.push(`${l.id} ${nom} H${n}`);
        }
        verifier('T7b jumeaux : aucun nom répété dans un segment (Skyridge H1-H32, Aquapolis H7-H32) n\'a un numéro sans témoin', sansTemoin, []);
    }
    verifier('T7b verdict : Skyridge et Aquapolis sont prouvés', [P.verdictDuSet('Skyridge').verdict, P.verdictDuSet('Aquapolis').verdict], ['prouve', 'prouve']);
    const pH = P.planifierPtcgio({ slug: 'Skyridge', trous: [t(carte(71, 'Alakazam'), 'H1', 901, 'H1'), t(carte(72, 'Alakazam'), 'H1', 902, '2'), t(carte(73, 'Xatu'), '35', 903, '35'), t(carte(74, 'Xatu'), 'H33', 904, 'H33')] });
    verifier('T7b plan : H1 → …/ecard3/H1_hires.png ; une fiche « 2 » face à H1 est contradictoire ; le numéro ordinaire 35 est hors set ; H33 non couvert',
        [pH.plan.map(p => [p.carteId, p.url, p.numero]), pH.restes.map(r => [r.carteId, r.motif])], [[[71, 'https://images.pokemontcg.io/ecard3/H1_hires.png', 'H1']], [[72, 'numero-contradictoire'], [73, 'numero-hors-set'], [74, 'non-couvert-par-un-temoin']]]);
    const pA = P.planifierPtcgio({ slug: 'Aquapolis', tousNumerosCm: ['H25', 'H25', 'H7'], trous: [t(carte(75, 'Suicune'), 'H25', 905, 'H25'), t(carte(76, 'Electrode'), 'H7', 906, 'H7')] });
    verifier('T7b Aquapolis : H25 porte deux produits (V1, V3) → noteVariante ; H7 seul → aucune note', pA.plan.map(p => [p.carteId, p.url, p.noteVariante ?? null]),
        [[75, 'https://images.pokemontcg.io/ecard2/H25_hires.png', NOTE], [76, 'https://images.pokemontcg.io/ecard2/H7_hires.png', null]]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

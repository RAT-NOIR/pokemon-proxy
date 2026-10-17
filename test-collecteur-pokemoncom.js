// node test-collecteur-pokemoncom.js — le collecteur pokemon.com (collecteur-images-pokemoncom.js) en TROIS PHASES, le retrait et les gardes.
// Aucune requête (transport simulé ; global.fetch REMPLACÉ par un piège qui lève), aucune base réelle (base en mémoire), aucun R2 (faux dépôt), dossiers de travail
// TEMPORAIRES (jamais un vrai chemin du testeur). Ce que le banc garde :
//   · TÉLÉCHARGER : seules les adresses du plan présentes mot pour mot dans un relevé ; robots.txt lu d'abord et respecté ; cadence ≥ 5 s ; plafond = adresses + 1 ;
//     403 / 429 / HTML / cf-mitigated / Imperva / 3xx / octets qui ne sont pas un PNG => ARRÊT DÉFINITIF (fichier d'arrêt), et le lancement suivant REFUSE de partir ;
//     404 => absent, on continue ; 5xx / coupure => interrompu SANS fichier d'arrêt ; reprise sans requête pour ce qui est en cache ; en-têtes : l'agent honnête seul ;
//   · ÉCRIRE : depuis le cache seulement (0 requête), additif, seuil de largeur, --attendu, aucun champ public ne nomme l'hôte, vignettes, garde de lot ;
//   · RETIRER : exactement le lot.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const PK = require('./collecte-cartes/pokemoncom');
const C = require('./collecteur-images-pokemoncom');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

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

const BASE = 'https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web';
const URL = (d, f) => `${BASE}/${d}/${f}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pkmcom-banc-'));
const carteRel = (nom, numero, set, fichier) => ({ nom, numero, numeroDoute: false, set, img: URL(set.toUpperCase(), fichier), alt: nom, releveComplet: true });

(async () => {
    const png = w => sharp({ create: { width: w, height: Math.round(w * 1.4), channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
    const grand = await png(734), petit = await png(200), moyen = await png(300);
    // ── le réseau est INTERDIT à tout ce qui n'est pas le transport simulé ───────────────────────────────────────────────
    const fetchOrigine = global.fetch, vusFetch = [];
    global.fetch = async (u, init) => { vusFetch.push([String(u), init]); throw new Error('réseau interdit dans le banc'); };

    const cartes = [carteRel('Unown A', 'A', 'ex10', 'EX10_EN_Unown_A.png'), carteRel('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png'), carteRel('Unown C', 'C', 'ex10', 'EX10_EN_Unown_C.png'), carteRel('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png')];
    const planDe = (...cs) => cs.map((c, i) => ({ carteId: 100 + i, nomEn: c.nom, slugSet: PK.slugDeLaCase(c.set), numero: c.numero.length === 1 && c.set === 'ex10' ? c.numero : null, produits: [900 + i], ligne: c.set, numeroReleve: c.numero, url: c.img, voie: 'set+numero+nom', preuve: `case ${c.set} n°${c.numero}`, aRegarder: false }));
    const plan = planDe(...cartes);

    const { largeurMinDe } = require('./collecte-cartes/seuils-images');
    const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
    verifier('seuil : la source ÉCRITE (« pokemon.com ») est une source OFFICIELLE → 257 px ; l\'ancien nom « pokemon-com » n\'existe plus et retombe à 350', [largeurMinDe(PK.SOURCE), largeurMinDe('pokemon-com')], [257, 350]);
    verifier('langue : « en » déclarée par le nom du fichier (_EN_), sans nommer l\'hôte ; sans adresse valable, null', [langueDuVisuel({ source: PK.SOURCE, urlOriginal: URL('SM2', 'SM2_EN_1.png') }).langue, /assets\./.test(langueDuVisuel({ source: PK.SOURCE, urlOriginal: URL('SM2', 'SM2_EN_1.png') }).preuve), langueDuVisuel({ source: PK.SOURCE, urlOriginal: 'https://autre.example/x_EN_1.png' }).langue, langueDuVisuel({ source: PK.SOURCE, urlOriginal: URL('SM2', 'SM2_JA_1.png') }).langue], ['en', false, null, null]);

    // ── 1. les adresses autorisées ───────────────────────────────────────────────────────────────────────────────────────
    const aut = C.urlsAutorisees([...plan, { ...plan[0], url: URL('EX10', 'EX10_EN_Unown_Z.png') }, { ...plan[0], url: 'https://autre.example/x.png' }], cartes);
    verifier('adresses : celles du plan présentes mot pour mot dans un relevé passent ; une adresse hors relevé, un autre hôte, sont refusées et nommées', [aut.ok.length, aut.refusees.map(r => r.motif)], [4, ['hors-releve', 'adresse-hors-regle']]);

    // ── 2. TÉLÉCHARGER ───────────────────────────────────────────────────────────────────────────────────────────────────
    const reseau = rep => { const appels = []; return { appels, async get(url, o) { appels.push(url); return rep(url, o); } }; };
    const robotsLibre = { status: 404, type: 'application/xml', texte: '' };       // le robots.txt de l'hôte d'images, vu le 17/10 : 404 (AmazonS3), aucune règle
    const normal = (url, o) => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: grand };
    const horloge = () => { let t = 1e6; const attentes = []; return { now: () => t, pause: async ms => { attentes.push(ms); t += ms; }, avance: ms => { t += ms; }, attentes }; };
    const lancer = (urls, tr, d, h = horloge(), o = {}) => C.telecharger({ urls, dossierCache: d, transport: tr, pause: h.pause, now: h.now, ...o });

    let d = tmp(), h = horloge(), tr = reseau(normal);
    let r = await lancer(plan.map(p => p.url), tr, d, h);
    verifier('télécharger : robots.txt D\'ABORD, puis les 4 images — 5 requêtes, plafond = 4 + 1', [tr.appels[0].endsWith('/robots.txt'), tr.appels.length, r.plafond, r.etat], [true, 5, 5, 'termine']);
    verifier('cadence : entre deux requêtes, jamais moins de 5 s (la première part sans attente)', [h.attentes.length >= 4 && h.attentes.every(ms => ms >= 5000)], [true]);
    // le plancher de 5 s s'IMPOSE même à un réglage plus rapide (horloge simulée : cadenceMs: 0 ne ralentit pas moins)
    { const h0 = horloge(), tr0b = reseau(normal); await lancer(plan.map(p => p.url), tr0b, tmp(), h0, { cadenceMs: 0 });
      verifier('cadence : un réglage à 0 est RELEVÉ à 5 s (plancher imposé, 4 attentes ≥ 5000 pour 5 requêtes)', [tr0b.appels.length, h0.attentes.length, h0.attentes.every(ms => ms >= 5000)], [5, 4, true]); }
    // le plafond (adresses + 1) est un garde-fou réel : un plafond plus bas que le besoin arrête AVANT la requête de trop
    { const trp = reseau(normal), rp = await lancer(plan.map(p => p.url), trp, tmp(), horloge(), { plafond: 3 });
      verifier('plafond : à 3 requêtes (robots + 2 images) le téléchargement s\'arrête, sans fichier d\'arrêt', [rp.etat, trp.appels.length, /plafond/.test(rp.motif || '')], ['interrompu', 3, true]); }
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8'));
    verifier('cache : une entrée par adresse (fichier, sha256, largeur) ; le fichier existe', [Object.keys(idx.images).length, Object.values(idx.images).every(e => e.statut === 'ok' && e.w === 734 && /^[0-9a-f]{64}$/.test(e.sha256) && fs.existsSync(path.join(d, e.fichier)))], [4, true]);
    tr = reseau(normal);
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('reprise : tout est en cache => zéro requête (pas même robots.txt)', [r.etat, tr.appels.length], ['rien-a-faire', 0]);
    // robots.txt respecté
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /static-assets/\n' } : normal(url));
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('robots.txt qui interdit : aucune image demandée, état « robots-interdit », pas de fichier d\'arrêt', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['robots-interdit', 1, false]);
    // ce qui est HORS du plan / du relevé ne part pas : le module ne reçoit que des adresses déjà filtrées, mais refuse aussi un hôte ou un chemin autres
    d = tmp(); tr = reseau(normal);
    r = await lancer(['https://autre.example/x.png', `${BASE}/EX10/../../secret.png`, URL('EX10', 'EX10_EN_Unown_A.png') + '?x=1'], tr, d);
    verifier('télécharger : une adresse hors hôte / chemin / paramètres est refusée AVANT toute requête (aucune requête, même pas robots.txt)', [r.etat, tr.appels.length, r.refusees.length], ['rien-a-faire', 0, 3]);

    // arrêt définitif
    const png8 = Buffer.from('89504e470d0a1a0a', 'hex');
    const defis = [['403', () => ({ status: 403, type: 'text/html', texte: 'non' })], ['429', () => ({ status: 429, type: 'text/html', texte: 'non' })], ['HTML au lieu d\'une image', () => ({ status: 200, type: 'text/html', texte: '<html>Just a moment</html>' })],
        ['cf-mitigated', () => ({ status: 200, type: 'image/png', octets: grand, cfMitigated: 'challenge' })], ['Imperva', () => ({ status: 200, type: 'image/png', octets: grand, imperva: true })], ['redirection 302', () => ({ status: 302, location: 'https://autre.example/x' })],
        ['octets qui ne sont pas un PNG', () => ({ status: 200, type: 'image/png', octets: Buffer.from('<html>defi</html>') })],
        ['403 à corps VIDE (ni HTML ni image)', () => ({ status: 403, type: '', texte: '' })], ['403 dont le corps est une IMAGE', () => ({ status: 403, type: 'image/png', octets: grand })],
        ['429 à corps vide', () => ({ status: 429 })], ['429 dont le corps est une image', () => ({ status: 429, type: 'image/png', octets: grand })]];
    for (const [nom, rep] of defis) {
        d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : rep());
        r = await lancer(plan.map(p => p.url), tr, d);
        const nb = tr.appels.length;
        verifier(`défi (${nom}) : ARRÊT DÉFINITIF dès la première image, fichier d'arrêt écrit (robots + 1 image seulement)`, [r.etat, nb, fs.existsSync(C.fichierArret(d))], ['arret-definitif', 2, true]);
        tr = reseau(normal);
        const r2 = await lancer(plan.map(p => p.url), tr, d);
        verifier(`   le lancement suivant REFUSE de partir tant que le fichier existe (zéro requête)`, [r2.etat, tr.appels.length], ['refuse-arret', 0]);
    }
    // 404 : absent, on continue ; 5xx : interrompu sans arrêt
    d = tmp(); tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /Unown_B/.test(url) ? { status: 404, type: 'image/png' } : { status: 200, type: 'image/png', octets: grand });
    r = await lancer(plan.map(p => p.url), tr, d);
    const idx2 = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).images;
    verifier('404 : l\'adresse est notée « absent », les autres continuent, pas d\'arrêt', [r.etat, idx2[URL('EX10', 'EX10_EN_Unown_B.png')]?.statut, Object.values(idx2).filter(e => e.statut === 'ok').length, fs.existsSync(C.fichierArret(d)), r.plafond >= tr.appels.length], ['termine', 'absent', 3, false, true]);
    d = tmp(); let n = 0; tr = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : (++n === 2 ? { status: 503, type: 'text/html', texte: 'x' } : { status: 200, type: 'image/png', octets: grand }));
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('5xx : « interrompu » (une image obtenue), PAS de fichier d\'arrêt, pas de réessai (robots + 2 requêtes)', [r.etat, tr.appels.length, fs.existsSync(C.fichierArret(d))], ['interrompu', 3, false]);
    tr = reseau(normal); r = await lancer(plan.map(p => p.url), tr, d);
    verifier('   la reprise ne redemande que le reste (robots.txt + 3 images)', [r.etat, tr.appels.length], ['termine', 4]);
    d = tmp(); tr = reseau(url => { if (/robots\.txt$/.test(url)) return robotsLibre; throw Object.assign(new Error('ECONNRESET'), { reseau: true }); });
    r = await lancer(plan.map(p => p.url), tr, d);
    verifier('coupure réseau : « interrompu », pas d\'arrêt définitif', [r.etat, fs.existsSync(C.fichierArret(d))], ['interrompu', false]);

    // le transport RÉEL : agent honnête seul, redirection jamais suivie, garde de l'hôte avant fetch
    vusFetch.length = 0;
    let err = null; try { await C.transportFetch.get(URL('EX10', 'EX10_EN_Unown_A.png'), { binaire: true }); } catch (e) { err = e; }
    verifier('transport réel : les en-têtes se réduisent à l\'agent du dépôt (aucun en-tête de navigateur), redirect « manual »', [vusFetch.length, Object.keys(vusFetch[0]?.[1]?.headers || {}), vusFetch[0]?.[1]?.redirect, vusFetch[0]?.[1]?.headers?.['User-Agent'] === PK.UA && !/Mozilla/i.test(PK.UA)], [1, ['User-Agent'], 'manual', true]);
    vusFetch.length = 0; err = null;
    try { await C.transportFetch.get('https://autre.example/x.png', {}); } catch (e) { err = e; }
    verifier('transport réel : un autre hôte est refusé AVANT fetch', [!!err, vusFetch.length], [true, 0]);

    // ── 3. ÉCRIRE : depuis le cache seulement ───────────────────────────────────────────────────────────────────────────────
    process.env.R2_BUCKET_IMAGES = 'bucket-banc';
    const dc = tmp(); const tr0 = reseau(url => /robots\.txt$/.test(url) ? robotsLibre : /Unown_C/.test(url) ? { status: 200, type: 'image/png', octets: petit } : { status: 200, type: 'image/png', octets: grand });
    await lancer(plan.map(p => p.url), tr0, dc);
    const semer = B => {
        B.col('sets').set('EX-Unseen-Forces', { _id: 'EX-Unseen-Forces', tirage: 'intl', region: 'intl' });
        B.col('sets').set('HeartGold-SoulSilver', { _id: 'HeartGold-SoulSilver', tirage: 'intl', region: 'intl' });
        const defs = [[100, 'Unown', 'EX-Unseen-Forces', 'A', 900], [101, 'Unown', 'EX-Unseen-Forces', 'B', 901], [102, 'Unown', 'EX-Unseen-Forces', 'C', 902], [103, 'Basic Darkness Energy', 'HeartGold-SoulSilver', null, 903]];
        for (const [id, nom, slug, num, prod] of defs) {
            B.col('cartes').set(id, { _id: id, nomEn: nom, images: [{ set: 'Autre', source: 'tcgdex', numero: '1', cleR2: 'tcgdex/x.webp', langue: 'en' }] });
            B.col('cartes_produits').set(`${id}|${prod}`, { _id: `${id}|${prod}`, carteId: id, idProduct: prod, numeroFiche: num, slugSet: slug });
        }
    };
    const depotsDe = () => { const l = []; return { l, f: async (...a) => l.push(a) }; };
    const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
    const vignetterBanc = () => (db, slug, o) => vignetterApresJointure(db, slug, { ...o, journal: { error() { } }, assurer: async (db2, { slug: s }) => { let k = 0; for (const c of await db2.collection('cartes').find({}).toArray()) { let t = false; const images = (c.images || []).map(e => { if (e.set !== s || !e.cleR2 || e.vignette) return e; t = true; k++; return { ...e, vignette: { cleR2: `vignettes/${e.cleR2}`, w: 200, h: 279 } }; }); if (t) await db2.collection('cartes').updateOne({ _id: c._id }, { $set: { images } }); } return { entrees: k, cles: k, traitees: k, fabriquees: k, deja: 0, depuisDocument: 0, echecs: [], interrompu: false, sets: k ? [s] : [] }; } });
    const ecrire = async (B, o = {}) => { const dp = depotsDe(); const q = silencieux(); try { const b = await C.ecrire(o.plan || plan, B.M, { dossierCache: o.dossierCache || dc, attendu: o.attendu, remplacements: o.remplacements, remplacer: o.remplacer, deposer: dp.f, vignetter: vignetterBanc(), fabriquerVerrouSet: verrouSet }); return { b, dp }; } finally { q(); } };
    let B = fausseBase(); semer(B);
    verifier('--attendu qui diffère du compte réel (3 à écrire : l\'une est sous le seuil) : REFUSÉ avant toute écriture', await (async () => { const { b, dp } = await ecrire(B, { attendu: 4 }); return [b.code, b.etat, dp.l.length, B.col('images').size]; })(), [2, 'refuse-attendu', 0, 0]);
    let { b, dp } = await ecrire(B, { attendu: 3 });
    verifier('écrire : 3 images écrites (A, B, énergie), la 4e (C, 200 px) est sous le seuil de 257 px ; code 0 ; AUCUNE requête (fetch jamais appelé)', [b.code, dp.l.length, vusFetch.length], [0, 3, 0]);
    const doc = B.col('images').get('pokemon.com/EX-Unseen-Forces/100/A/en');
    verifier('le document `images` : source, lot, mention, langue, état, adresse d\'origine, produits, largeur', [doc.source, doc.lot, doc.mention, doc.langue, doc.etat, doc.urlOriginal, doc.produits, doc.wOriginal], ['pokemon.com', 'pokemoncom-2026-10', '© Pokémon / The Pokémon Company', 'en', 'ok', URL('EX10', 'EX10_EN_Unown_A.png'), [900], 734]);
    verifier('   R2 AVANT la ligne : clé du set, WebP', [dp.l[0][1], dp.l[0][3]], ['pokemon.com/EX-Unseen-Forces/A-100-en.webp', 'image/webp']);
    verifier('le document de l\'image sous le seuil : « trop-petit », seuil 257, rien de joint', [B.col('images').get('pokemon.com/EX-Unseen-Forces/102/C/en')?.etat, B.col('images').get('pokemon.com/EX-Unseen-Forces/102/C/en')?.seuilApplique, B.col('cartes').get(102).images.length], ['trop-petit', 257, 1]);
    // 300 px : au-dessus du seuil officiel (257), sous 350 : écrite AVEC la marque basseDefinition (document ET entrée)
    { const dcb = tmp(); await lancer([plan[0].url], reseau(url => /robots\.txt$/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: moyen }), dcb);
      const Bb = fausseBase(); semer(Bb); const { b: bb } = await ecrire(Bb, { plan: [plan[0]], dossierCache: dcb, attendu: 1 });
      verifier('300 px : écrite (≥ 257) avec la marque basseDefinition sur le document ET sur l\'entrée', [bb.code, Bb.col('images').get('pokemon.com/EX-Unseen-Forces/100/A/en')?.basseDefinition, Bb.col('cartes').get(100).images.find(e => e.source === 'pokemon.com')?.basseDefinition], [0, true, true]); }
    const e1 = B.col('cartes').get(100).images.find(e => e.source === 'pokemon.com');
    verifier('l\'entrée de la carte : set, source, lot, mention, langue, numéro, vignette ; l\'autre source INTACTE', [e1.set, e1.source, e1.lot, e1.mention, e1.langue, e1.numero, !!e1.vignette?.cleR2, B.col('cartes').get(100).images.find(e => e.source === 'tcgdex').cleR2], ['EX-Unseen-Forces', 'pokemon.com', 'pokemoncom-2026-10', '© Pokémon / The Pokémon Company', 'en', 'A', true, 'tcgdex/x.webp']);
    verifier('une fiche SANS numéro garde numero null (l\'énergie)', B.col('cartes').get(103).images.find(e => e.source === 'pokemon.com')?.numero, null);
    verifier('AUCUN champ public ne nomme l\'hôte : ni l\'entrée de carte, ni la preuve de langue', [JSON.stringify(B.col('cartes').get(100).images).includes('assets.'), /assets\./.test(e1.languePreuve || '')], [false, false]);
    verifier('le bilan du set : garde verte, 2 joints', [B.col('sets').get('EX-Unseen-Forces').visuelsPokemoncom?.garde?.ok, B.col('sets').get('EX-Unseen-Forces').visuelsPokemoncom?.joints], [true, 2]);
    const avant0 = compterEtat({ cartes: [{ _id: 1, sets: ['EX-Unseen-Forces'], images: [] }] }), apres0 = compterEtat({ cartes: [{ _id: 1, sets: ['EX-Unseen-Forces'], images: [e1] }] });
    verifier('la garde de lot VOIT la hausse des images (par set), et ne signale aucune baisse', [apres0.get('images set:EX-Unseen-Forces') - (avant0.get('images set:EX-Unseen-Forces') || 0), comparer(avant0, apres0).baisses.length], [1, 0]);
    // rejeu : sans requête et sans doublon
    ({ b, dp } = await ecrire(B, { attendu: 3 }));
    verifier('rejeu : rien de redéposé, une entrée par fiche (idempotent)', [dp.l.length, B.col('cartes').get(100).images.filter(e => e.source === 'pokemon.com').length], [0, 1]);
    // une autre source pose le numéro entre deux passages : elle garde sa place, la nôtre cède
    B = fausseBase(); semer(B);
    B.col('cartes').get(101).images.push({ set: 'EX-Unseen-Forces', source: 'bulbapedia', numero: 'B', cleR2: 'bulbapedia/b.webp', langue: 'en' });
    ({ b, dp } = await ecrire(B, { attendu: 3 }));
    verifier('additif : une autre source a servi ce numéro entre-temps => la nôtre CÈDE, l\'entrée de l\'autre est intacte', [b.resultats.find(x => x.code === 'EX-Unseen-Forces').dejaParAutre, B.col('cartes').get(101).images.filter(e => e.source === 'pokemon.com').length, B.col('cartes').get(101).images.find(e => e.source === 'bulbapedia').cleR2], [1, 0, 'bulbapedia/b.webp']);
    // le cache absent ou altéré
    B = fausseBase(); semer(B);
    const dc2 = tmp(); const tr2 = reseau(normal); await lancer(plan.slice(0, 2).map(p => p.url), tr2, dc2);
    ({ b, dp } = await ecrire(B, { dossierCache: dc2, attendu: 2 }));
    verifier('une adresse du plan absente du cache n\'est pas écrite (« hors-cache »), les autres le sont', [b.horsCache, dp.l.length], [2, 2]);
    const i3 = JSON.parse(fs.readFileSync(path.join(dc2, 'index.json'), 'utf8')); const f0 = Object.values(i3.images)[0].fichier; fs.writeFileSync(path.join(dc2, f0), Buffer.from('altéré'));
    B = fausseBase(); semer(B);
    ({ b, dp } = await ecrire(B, { dossierCache: dc2, attendu: 1 }));
    verifier('un fichier du cache dont le sha256 ne correspond plus est refusé (« cache-altere »)', [b.altere, dp.l.length], [1, 1]);

    // ── 3 bis. LE REMPLACEMENT d'une entrée refusée par la règle du site : préparé, jamais actif sans --remplacer ────────────────────
    const JAE = { set: 'EX-Unseen-Forces', source: 'bulbapedia', numero: 'A', cleR2: 'bulbapedia/EX/ja-A.webp', langue: 'ja', w: 868, h: 1212 };
    const semerJa = Bx => { semer(Bx); Bx.col('cartes').get(100).images.push({ ...JAE }); Bx.col('images').set('bj', { _id: 'bj', source: 'bulbapedia', set: 'EX-Unseen-Forces', carteId: 100, cleR2: JAE.cleR2, etat: 'ok', langue: 'ja' }); };
    const remp = [{ ...plan[0], refusees: [{ cleR2: JAE.cleR2, source: 'bulbapedia', numero: 'A', langue: 'ja', motif: 'langue:ja' }], motif: 'entree-refusee-au-numero' }];
    B = fausseBase(); semerJa(B);
    ({ b, dp } = await ecrire(B, { plan: [], remplacements: remp, attendu: 0 }));
    verifier('SANS --remplacer : rien ne bouge (ni l\'entrée japonaise, ni le document, ni un dépôt R2)', [dp.l.length, B.col('cartes').get(100).images.map(e => e.source), B.col('images').get('bj').etat], [0, ['tcgdex', 'bulbapedia'], 'ok']);
    B = fausseBase(); semerJa(B);
    ({ b, dp } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [999], attendu: 0 }));
    verifier('--remplacer avec un idProduct qui n\'est pas dans ce motif du plan : REFUSÉ avant toute écriture (liste fermée)', [b.code, b.etat, dp.l.length, B.col('cartes').get(100).images.length], [2, 'refuse-remplacer', 0, 2]);
    B = fausseBase(); semerJa(B);
    ({ b, dp } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [900], attendu: 1 }));
    verifier('--remplacer=900 : l\'entrée refusée sort, l\'entrée pokemon.com entre au même (set, numéro) ; l\'autre source reste', [b.code, B.col('cartes').get(100).images.map(e => `${e.source}:${e.numero}`).sort()], [0, ['pokemon.com:A', 'tcgdex:1']]);
    verifier('   le document `images` japonais n\'est PAS supprimé : état « remplace », motif et remplaçante écrits', [B.col('images').get('bj')?.etat, !!B.col('images').get('bj')?.remplaceMotif, B.col('images').get('bj')?.remplaceePar], ['remplace', true, 'pokemon.com/EX-Unseen-Forces/100/A/en']);
    verifier('   la garde du set est verte (la sortie voulue n\'est pas une perte), un dépôt R2', [B.col('sets').get('EX-Unseen-Forces').visuelsPokemoncom?.garde?.ok, dp.l.length], [true, 1]);
    B = fausseBase(); semerJa(B);
    B.col('cartes').get(100).images.push({ set: 'EX-Unseen-Forces', source: 'tcgdex', numero: 'A', cleR2: 'tcgdex/A.webp', langue: 'en' });
    ({ b } = await ecrire(B, { plan: [], remplacements: remp, remplacer: [900], attendu: 1 }));
    verifier('   si une entrée ADMISE sert ce numéro à l\'écriture, la nôtre cède et rien n\'est retiré', [B.col('cartes').get(100).images.some(e => e.source === 'pokemon.com'), B.col('cartes').get(100).images.some(e => e.cleR2 === JAE.cleR2)], [false, true]);
    const ann = C.annonceRemplacement([{ _id: 100, sets: ['EX-Unseen-Forces'], images: [{ ...JAE, vignette: { cleR2: 'v/ja' } }] }], remp);
    verifier('annonce pour lot-additif : la garde verrait la baisse des vignettes (l\'entrée refusée portait la sienne) ; sans remplacement, aucune annonce', [Object.keys(ann).length > 0, Object.keys(C.annonceRemplacement([{ _id: 100, sets: ['EX-Unseen-Forces'], images: [{ ...JAE }] }], [])).length], [true, 0]);

    // ── 4. RETIRER : exactement le lot ────────────────────────────────────────────────────────────────────────────────────
    const { retirerLot } = require('./retirer-visuels-pokemoncom');
    B = fausseBase(); semer(B);
    await ecrire(B, { attendu: 3 });
    B.col('cartes').get(103).images.push({ set: 'HeartGold-SoulSilver', source: 'pokemon.com', lot: 'autre-lot', numero: null, cleR2: 'pokemon.com/autre.webp' });
    const sup = []; const sansEcrire = await retirerLot(B.db, { ecrire: false });
    verifier('retrait en simulation : comptes, rien n\'est modifié', [sansEcrire.entrees, sansEcrire.cartes.length, B.col('cartes').get(100).images.some(e => e.source === 'pokemon.com')], [3, 3, true]);
    const rr = await retirerLot(B.db, { ecrire: true, effacerR2: true, supprimer: async (bk, cles) => sup.push(...cles), verifierBucket: async () => { }, bucket: 'bucket-banc' });
    verifier('retrait : les entrées du lot sortent, l\'autre lot de la même source, l\'autre source et les documents hors lot restent ; documents du lot « retire »', [B.col('cartes').get(100).images.some(e => e.source === 'pokemon.com'), B.col('cartes').get(103).images.filter(e => e.source === 'pokemon.com').map(e => e.lot), B.col('cartes').get(100).images.some(e => e.source === 'tcgdex'), B.col('images').get('pokemon.com/EX-Unseen-Forces/100/A/en').etat, rr.reste], [false, ['autre-lot'], true, 'retire', 0]);
    verifier('   et les clés R2 (images + vignettes) sont celles du lot seul', [sup.length > 0 && sup.every(c => c.startsWith('pokemon.com/') || c.startsWith('vignettes/pokemon.com/'))], [true]);

    global.fetch = fetchOrigine;
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });

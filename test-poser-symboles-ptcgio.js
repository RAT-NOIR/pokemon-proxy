// node test-poser-symboles-ptcgio.js — LE LOT DES SYMBOLES pokemontcg.io (poser-symboles-ptcgio.js)
// Fonctions pures + faux clients : AUCUNE requête réseau, AUCUNE écriture en base ni dans R2 (la base, R2 et le transport sont des faux).
// Le banc se rejoue ensuite sur des MUTANTS du module (une garde supprimée) : chacun doit le faire échouer — sinon la garde n'est pas gardée.
require('./bancs-dossier-arrets');          // les arrêts d'hôtes vont dans un dossier TEMPORAIRE, jamais le vrai
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const sharp = require('sharp');
const RH = require('./collecte-cartes/reponse-hote');

const CHEMIN_MODULE = path.join(__dirname, 'poser-symboles-ptcgio.js');
const tmp = pre => fs.mkdtempSync(path.join(os.tmpdir(), pre));
const png = (w, h, c) => sharp({ create: { width: w, height: h, channels: 4, background: c } }).png().toBuffer();
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const HOTE = 'https://images.pokemontcg.io';

async function banc(M) {
    let ok = 0, ko = 0;
    const verifier = (nom, obtenu, attendu) => {
        const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
        if (a === b) { ok++; if (!process.env.BANC_SILENCE) console.log(`✅ ${nom}`); } else { ko++; if (!process.env.BANC_SILENCE) console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); else ko += 0; }
    };
    const leve = async f => { try { await f(); return null; } catch (e) { return e.message || String(e); } };
    const bon = await png(64, 64, { r: 200, g: 30, b: 30, alpha: 1 });
    const autre = await png(48, 48, { r: 20, g: 120, b: 220, alpha: 1 });
    const minuscule = await png(16, 16, { r: 0, g: 0, b: 0, alpha: 1 });

    // ── 1. LES ARGUMENTS : écrits par ce qu'ils AUTORISENT ──────────────────────────────────────────────────────────
    const arg = a => M.parserArguments(a);
    verifier('arguments : --plan seul', arg(['--plan']), { mode: 'plan', cache: null, plafond: null, attendu: null });
    verifier('arguments : --telecharger avec cache et plafond', arg(['--telecharger', '--cache=C:\\x', '--plafond=40']), { mode: 'telecharger', cache: 'C:\\x', plafond: 40, attendu: null });
    verifier('arguments : --ecrire avec cache et attendu', arg(['--ecrire', '--cache=C:\\x', '--attendu=12']).attendu, 12);
    for (const [nom, a] of [['argument inconnu', ['--plan', '--force']], ['argument inconnu seul', ['--tout']], ['aucun mode', []], ['deux modes', ['--plan', '--ecrire']],
        ['--telecharger sans plafond', ['--telecharger', '--cache=C:\\x']], ['--telecharger sans cache', ['--telecharger', '--plafond=5']], ['--ecrire sans attendu', ['--ecrire', '--cache=C:\\x']],
        ['--planche sans cache', ['--planche']], ['--plan avec cache', ['--plan', '--cache=C:\\x']], ['plafond 0', ['--telecharger', '--cache=C:\\x', '--plafond=0']], ['attendu non numérique', ['--ecrire', '--cache=C:\\x', '--attendu=abc']]])
        verifier(`arguments : ${nom} → refus`, (await leve(() => arg(a))) !== null, true);

    // ── 2. LE PLAN : identité unique / multiple / absente, set pourvu, Additionals, population vide ─────────────────
    const set = (slug, o = {}) => ({ _id: slug, nomAffichage: `Nom ${slug}`, tirage: 'intl', ...o });
    const sets = [
        set('A-Set', { visuelsPtcgio: { lignes: ['sm35'] } }),                                     // identité unique → planifié
        set('B-Set', { visuelsPtcgio: { lignes: ['tk1a', 'tk1b'] } }),                              // identité multiple → sauté
        set('C-Set'),                                                                                // identité absente
        set('D-Set', { symbole: { cleR2: 'symboles/D-Set-abc.png' }, visuelsPtcgio: { lignes: ['xy1'] } }),   // déjà pourvu → hors population
        set('A-Set-Additionals', { visuelsPtcgio: { lignes: ['sm35'] } }),                         // Additionals → hors population
        { _id: 'E-Set', visuelsPtcgio: { lignes: ['xy2'] } },                                       // pas de nomAffichage → hors population
        set('F-Set', { tirage: 'jp', remplacementTcgdex: { tcgdexSet: 'sm1', langue: 'en' } }),     // identité TCGdex seulement : notée, jamais prise
        set('G-Set', { remplacementTcgdex: { tcgdexSet: 'sm2', langue: 'fr' } }),                   // TCGdex en français : ni prise ni notée
        set('H-Set', { visuelsPtcgio: { lignes: ['me55c'] } }),                                     // hôte scrydex : pas de chemin de symbole autorisé
        set('I-Set', { visuelsPtcgio: { lignes: ['Mauvais/../id'] } }),                             // identifiant illisible → sauté
        set('J-Set', { symbole: {}, visuelsPtcgio: { lignes: ['xy9'] } })                            // symbole vide (sans cleR2) → dans la population
    ];
    const P = M.planifier(sets);
    verifier('plan : population = sets nommés, hors -Additionals, sans symbole.cleR2', P.population, 8);
    verifier('plan : lignes planifiées (identité unique)', P.lignes.map(l => [l.slug, l.id, l.url]).sort(), [['A-Set', 'sm35', `${HOTE}/sm35/symbol.png`], ['J-Set', 'xy9', `${HOTE}/xy9/symbol.png`]]);
    verifier('plan : sautés par raison', Object.fromEntries(P.sautes.map(s => [s.slug, s.raison])), { 'B-Set': 'identite-multiple', 'C-Set': 'identite-absente', 'F-Set': 'identite-absente', 'G-Set': 'identite-absente', 'H-Set': 'hote-scrydex', 'I-Set': 'identifiant-illisible' });
    verifier('plan : identité TCGdex seule (en) notée, sans être prise', P.tcgdexSeul, [{ slug: 'F-Set', tcgdexSet: 'sm1' }]);
    verifier('plan : par tirage', P.parTirage, { intl: 2 });
    verifier('plan : le set pourvu et l\'Additionals ne sont ni planifiés ni sautés', [...P.lignes.map(l => l.slug), ...P.sautes.map(s => s.slug)].filter(s => ['D-Set', 'A-Set-Additionals', 'E-Set'].includes(s)), []);
    verifier('plan : population vide → LÈVE (champ faux = vide fabriqué)', (await leve(() => M.planifier([set('D', { symbole: { cleR2: 'x' } })]))) !== null, true);
    verifier('plan : aucune base lue → LÈVE', (await leve(() => M.planifier([]))) !== null, true);
    verifier('plan : url du symbole', M.urlSymbole('sm35'), `${HOTE}/sm35/symbol.png`);
    verifier('plan : chemin permis — le symbole seul, l\'API et les autres chemins refusés', [`${HOTE}/sm35/symbol.png`, `${HOTE}/sm35/1_hires.png`, 'https://api.pokemontcg.io/v2/sets', `${HOTE}/sm35/symbol.png?x=1`, 'http://images.pokemontcg.io/sm35/symbol.png'].map(M.cheminPermis), [true, false, false, false, false]);

    // ── 3. LES REFUS ─────────────────────────────────────────────────────────────────────────────────────────────────
    const m = (statut, b, o = {}) => ({ statut, octets: b?.length ?? 0, sha1: b ? sha1(b) : null, w: o.w ?? 64, h: o.h ?? 64, format: o.format ?? 'png', decodable: o.decodable ?? true });
    const e = (slug, meta) => ({ slug, id: 'x', url: M.urlSymbole('x'), meta });
    const D = M.decider([e('Bon', m(200, bon)), e('Statut', m(404, null)), e('Petit', m(200, minuscule, { w: 16, h: 16 })), e('Large-Plat', m(200, autre, { w: 200, h: 23 })), e('Illisible', m(200, Buffer.from('pas une image'), { decodable: false, w: null, h: null, format: null })),
        e('Webp', m(200, Buffer.from('w'), { format: 'webp' })), e('Gen-1', m(200, autre, { w: 48, h: 48 })), e('Gen-2', m(200, autre, { w: 48, h: 48 }))]);
    verifier('refus : un seul gardé (le fichier unique, 200, décodable, ≥ 24 px)', D.gardes.map(g => g.slug), ['Bon']);
    verifier('refus : raisons écrites', Object.fromEntries(D.refuses.map(r => [r.slug, r.raison])),
        { Statut: 'statut-404', Petit: 'trop-petit', 'Large-Plat': 'trop-petit', Illisible: 'image-non-decodable', Webp: 'format-non-png', 'Gen-1': 'sha1-partage', 'Gen-2': 'sha1-partage' });
    verifier('refus : un sha1 partagé refuse LES DEUX sets (fichier générique)', D.refuses.filter(r => r.raison === 'sha1-partage').length, 2);

    // ── 4. LA CLÉ R2 NEUTRE ──────────────────────────────────────────────────────────────────────────────────────────
    const cle = M.cleSymbole('Base-Set', sha1(bon));
    verifier('clé R2 : symboles/<slug>-<sha1 sur 10>.png, sans nom de source', [cle, /^symboles\/[A-Za-z0-9._-]+-[0-9a-f]{10}\.png$/.test(cle), /pokemontcg|scrydex|ptcg/i.test(cle)], [`symboles/Base-Set-${sha1(bon).slice(0, 10)}.png`, true, false]);
    verifier('clé R2 : slug illisible → LÈVE', (await leve(() => M.cleSymbole('../evil', sha1(bon)))) !== null, true);

    // ── 5. LE TÉLÉCHARGEMENT PASSE PAR reponse-hote (faux transport : aucune requête réelle) ─────────────────────────
    const lignes = ['s1', 's2', 's3'].map((s, i) => ({ slug: `Set-${s}`, nom: `Nom ${s}`, tirage: 'intl', id: `id${i + 1}`, url: M.urlSymbole(`id${i + 1}`) }));
    const robotsLibre = { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' };
    const fauxTransport = reponses => { const appels = []; return { appels, async get(url) { appels.push(url); const r = reponses[url.replace(HOTE, '')]; if (!r) return { status: 404, type: 'image/png' }; return r; } }; };
    const horloge = () => { let t = 1000; const waits = []; return { waits, now: () => t, pause: async ms => { waits.push(ms); t += ms; } }; };
    const lancer = async (reponses, o = {}) => {
        const cache = o.cache || tmp('symb-cache-'), dossierPauses = tmp('symb-pauses-'), tr = fauxTransport({ '/robots.txt': robotsLibre, ...reponses }), h = horloge();
        const bilan = await M.telecharger({ lignes: o.lignes || lignes, cache, plafond: o.plafond ?? 10, transport: tr, pause: h.pause, now: h.now, suivi: RH.suiviHote(), dossierPauses, journal: () => { } });
        return { bilan, tr, h, cache, dossierPauses };
    };
    const htmlFausse = { status: 200, type: 'text/html; charset=utf-8', texte: '<html><body>Page introuvable</body></html>' };
    const r1 = await lancer({ '/id1/symbol.png': { status: 200, type: 'image/png', octets: bon }, '/id2/symbol.png': { status: 404, type: 'image/png' }, '/id3/symbol.png': htmlFausse });
    verifier('téléchargement : robots.txt d\'abord, puis les trois adresses', r1.tr.appels, [`${HOTE}/robots.txt`, ...lignes.map(l => l.url)]);
    verifier('téléchargement : ≥ 5 s avant CHAQUE requête après la première (3 attentes)', [r1.h.waits.length, r1.h.waits.every(w => w >= 5000)], [3, true]);
    const meta = s => JSON.parse(fs.readFileSync(path.join(r1.cache, `${s}.json`), 'utf8'));
    verifier('téléchargement : image gardée avec statut, octets, sha1, w, h, format', (({ statut, octets, sha1: s, w, h, format }) => ({ statut, octets, s, w, h, format }))(meta('Set-s1')), { statut: 200, octets: bon.length, s: sha1(bon), w: 64, h: 64, format: 'png' });
    verifier('téléchargement : le fichier du cache est celui reçu', sha1(fs.readFileSync(path.join(r1.cache, 'Set-s1.png'))), sha1(bon));
    verifier('téléchargement : 404 et fausse page introuvable = absents (règle commune), consignés sans fichier', [meta('Set-s2').statut, meta('Set-s3').statut, fs.existsSync(path.join(r1.cache, 'Set-s2.png')), fs.existsSync(path.join(r1.cache, 'Set-s3.png'))], [404, 404, false, false]);
    verifier('téléchargement : bilan', [r1.bilan.telecharges, r1.bilan.absents, r1.bilan.repris, r1.bilan.arret], [1, 2, 0, null]);
    // reprise : rien n'est redemandé
    const rRep = await lancer({}, { cache: r1.cache });
    verifier('reprise : un fichier déjà en cache n\'est pas redemandé (0 requête, robots.txt compris)', [rRep.tr.appels.length, rRep.bilan.repris], [0, 3]);
    // plafond
    const r3 = await leve(() => lancer({}, { plafond: 2 }));
    verifier('plafond : plus d\'adresses à demander que le plafond → refus avant toute requête', r3 !== null && /plafond/i.test(r3), true);
    // défi : arrêt définitif, la suite n'est pas demandée
    const rd = await lancer({ '/id1/symbol.png': { status: 200, type: 'image/png', octets: bon }, '/id2/symbol.png': { status: 403, type: 'text/html', texte: '<title>Just a moment...</title>', cfMitigated: 'challenge' } });
    verifier('défi (403 Cloudflare) : la règle commune arrête l\'hôte, la 3e adresse n\'est jamais demandée', [rd.tr.appels.filter(u => u.endsWith('/symbol.png')).length, !!rd.bilan.arret, !!RH.hoteArrete('images.pokemontcg.io', rd.dossierPauses)], [2, true, true]);
    // robots interdit
    const rr = await leve(() => lancer({ '/robots.txt': { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /\n' } }));
    verifier('robots.txt qui interdit : aucune image demandée', rr !== null, true);
    // adresse hors du chemin de symbole
    const rh = await leve(() => lancer({}, { lignes: [{ ...lignes[0], url: 'https://api.pokemontcg.io/v2/sets' }] }));
    verifier('adresse hors de /<id>/symbol.png : refus avant toute requête', rh !== null, true);
    // deux 5xx de suite
    const r5 = await lancer({ '/id1/symbol.png': { status: 503, type: 'text/plain', texte: 'x' }, '/id2/symbol.png': { status: 503, type: 'text/plain', texte: 'x' } });
    verifier('5xx sans défi : un réessai, puis l\'unité reste à refaire (pas de méta), le bilan le dit', [fs.existsSync(path.join(r5.cache, 'Set-s1.json')), r5.bilan.transitoires >= 1], [false, true]);

    // ── 6. LA PLANCHE ────────────────────────────────────────────────────────────────────────────────────────────────
    const pl = await M.fabriquerPlanche([{ slug: 'Set-s1', nom: 'Nom s1', buffer: bon }, { slug: 'Set-s2', nom: 'Nom s2', buffer: autre }, { slug: 'Set-s3', nom: 'Nom s3', buffer: bon }], { colonnes: 2 });
    const mp = await sharp(pl.buffer).metadata();
    verifier('planche : un PNG unique aux dimensions annoncées, 2 colonnes × 2 lignes', [mp.format, mp.width, mp.height], ['png', pl.w, pl.h]);
    const brut = await sharp(pl.buffer).removeAlpha().raw().toBuffer();
    const px = (x, y) => brut[(y * pl.w + x) * 3];
    verifier('planche : fond clair ET fond sombre pour chaque symbole (coin de la demi-cellule gauche clair, de la droite sombre), 2 colonnes × 2 lignes',
        [pl.w === 2 * pl.celluleW, pl.h === 2 * pl.celluleH, px(2, 2) > 200, px(pl.demiW + 2, 2) < 80, px(pl.celluleW + 2, 2) > 200, px(pl.celluleW + pl.demiW + 2, 2) < 80, px(2, pl.celluleH + 2) > 200, px(pl.demiW + 2, pl.celluleH + 2) < 80], [true, true, true, true, true, true, true, true]);

    // ── 7. L'ÉCRITURE : jamais d'écrasement, --attendu, R2, valeur posée ─────────────────────────────────────────────
    const fauxDb = docs => {
        const mem = new Map(docs.map(d => [d._id, JSON.parse(JSON.stringify(d))])), journal = [];
        const api = { mem, journal, avantUpdate: null, collection: () => ({
            async findOne(f) { const d = mem.get(f._id); return d ? JSON.parse(JSON.stringify(d)) : null; },
            async updateOne(f, maj) {
                journal.push(['updateOne', f, maj]);
                if (api.avantUpdate) api.avantUpdate(mem);
                const d = mem.get(f._id); if (!d) return { matchedCount: 0, modifiedCount: 0 };
                if (f['symbole.cleR2']?.$exists === false && d.symbole?.cleR2 != null) return { matchedCount: 0, modifiedCount: 0 };
                Object.assign(d, maj.$set); return { matchedCount: 1, modifiedCount: 1 };
            } }) };
        return api;
    };
    const fauxR2 = () => { const depots = []; return { depots, async verifierBucket(b) { depots.push(['bucket', b]); }, async deposerBinaire(b, c, buf, t) { depots.push([c, buf.length, t]); return { ecrit: true, cle: c }; } }; };
    const cacheE = tmp('symb-ecrire-');
    const ecrireCache = async (slug, id, buf, meta) => { if (buf) fs.writeFileSync(path.join(cacheE, `${slug}.png`), buf); fs.writeFileSync(path.join(cacheE, `${slug}.json`), JSON.stringify({ slug, id, url: M.urlSymbole(id), nom: `Nom ${slug}`, ...meta })); };
    const le = { ...await (async () => { const x = await sharp(bon).metadata(); return { w: x.width, h: x.height }; })() };
    await ecrireCache('W-Bon', 'w1', bon, m(200, bon, { w: le.w, h: le.h }));
    await ecrireCache('W-Autre', 'w2', autre, m(200, autre, { w: 48, h: 48 }));
    await ecrireCache('W-Pourvu', 'w3', bon, m(200, bon, { w: le.w, h: le.h }));      // même sha1 que W-Bon → les deux refusés ?
    const lw = [['W-Bon', 'w1'], ['W-Autre', 'w2']].map(([slug, id]) => ({ slug, nom: `Nom ${slug}`, tirage: 'intl', id, url: M.urlSymbole(id) }));
    const docsE = () => [{ _id: 'W-Bon', nomAffichage: 'x' }, { _id: 'W-Autre', nomAffichage: 'y' }];
    // 7.a sha1 partagé : W-Bon et W-Pourvu portent le même fichier
    const lw3 = [...lw, { slug: 'W-Pourvu', nom: 'Nom W-Pourvu', tirage: 'intl', id: 'w3', url: M.urlSymbole('w3') }];
    let db = fauxDb([...docsE(), { _id: 'W-Pourvu', nomAffichage: 'z' }]), r2 = fauxR2();
    let e0 = await leve(() => M.ecrire({ lignes: lw3, cache: cacheE, attendu: 3, db, r2, bucket: 'B', maintenant: () => new Date('2026-10-18') }));
    verifier('écriture : un sha1 partagé retire les deux sets → 1 à écrire ≠ attendu 3 → refus, RIEN écrit', [e0 !== null, db.journal.length, r2.depots.length], [true, 0, 0]);
    // 7.b attendu faux
    e0 = await leve(() => M.ecrire({ lignes: lw, cache: cacheE, attendu: 5, db: fauxDb(docsE()), r2, bucket: 'B', maintenant: () => new Date() }));
    verifier('--attendu faux → refus avant toute écriture', [e0 !== null && /attendu/i.test(e0), r2.depots.length], [true, 0]);
    // 7.c écriture réelle (faux clients)
    db = fauxDb(docsE()); r2 = fauxR2();
    const R = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date('2026-10-18T10:00:00Z') });
    verifier('écriture : 2 écrits, 0 refusé, 0 non écrit', [R.ecrits, R.refuses, R.nonEcrits], [['W-Bon', 'W-Autre'], [], []]);
    verifier('écriture R2 : bucket vérifié d\'abord, original à clé neutre en image/png, vignette webp', [r2.depots[0][0], r2.depots[1][0], r2.depots[1][2], r2.depots[2][0], r2.depots[2][2]], ['bucket', `symboles/W-Bon-${sha1(bon).slice(0, 10)}.png`, 'image/png', `vignettes/symboles/W-Bon-${sha1(bon).slice(0, 10)}.webp`, 'image/webp']);
    const v = db.mem.get('W-Bon').symbole;
    verifier('valeur posée : champs du brief', { cleR2: v.cleR2, w: v.w, h: v.h, octets: v.octets, sha1: v.sha1, fichier: v.fichier, source: v.source, urlOriginal: v.urlOriginal, mention: v.mention, lot: v.lot, retirable: v.retirable, vignette: !!v.vignette?.cleR2 && v.vignette.h <= 64, le: !!v.le },
        { cleR2: `symboles/W-Bon-${sha1(bon).slice(0, 10)}.png`, w: 64, h: 64, octets: bon.length, sha1: sha1(bon), fichier: 'symbol.png', source: 'pokemontcg.io', urlOriginal: `${HOTE}/w1/symbol.png`, mention: '© Pokémon / The Pokémon Company', lot: 'symboles-2026-10', retirable: true, vignette: true, le: true });
    verifier('valeur posée : la preuve nomme l\'identité et dit que le set n\'avait pas de symbole', /visuelsPtcgio\.lignes/.test(v.preuve) && /ptcgio-2026-10/.test(v.preuve) && /n'avait pas de symbole/.test(v.preuve), true);
    verifier('filtre de l\'écriture : _id ET symbole.cleR2 absent (jamais d\'écrasement)', db.journal.every(([, f]) => f['symbole.cleR2']?.$exists === false), true);
    // 7.d symbole apparu depuis le plan : jamais écrasé, compté « non écrit »
    db = fauxDb([{ _id: 'W-Bon', nomAffichage: 'x', symbole: { cleR2: 'symboles/ailleurs.png' } }, { _id: 'W-Autre', nomAffichage: 'y' }]); r2 = fauxR2();
    const R2 = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date() });
    verifier('symbole apparu depuis le plan : non écrit, l\'autre écrit, le symbole existant intact', [R2.ecrits, R2.nonEcrits.map(n => n.slug), db.mem.get('W-Bon').symbole.cleR2], [['W-Autre'], ['W-Bon'], 'symboles/ailleurs.png']);
    // 7.e symbole apparu ENTRE la lecture et l'écriture (course) : la condition de la requête protège
    db = fauxDb(docsE()); r2 = fauxR2();
    db.avantUpdate = mem => { if (!mem.get('W-Bon').symbole) mem.get('W-Bon').symbole = { cleR2: 'symboles/course.png' }; };
    const R3 = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date() });
    verifier('course (symbole posé entre le contrôle et l\'écriture) : jamais écrasé', [db.mem.get('W-Bon').symbole.cleR2, R3.nonEcrits.map(n => n.slug)], ['symboles/course.png', ['W-Bon']]);
    // 7.f cache altéré
    const cacheA = tmp('symb-alt-'); fs.writeFileSync(path.join(cacheA, 'W-Bon.png'), autre); fs.writeFileSync(path.join(cacheA, 'W-Bon.json'), JSON.stringify({ slug: 'W-Bon', id: 'w1', url: M.urlSymbole('w1'), ...m(200, bon, { w: 64, h: 64 }) }));
    const eA = await leve(() => M.ecrire({ lignes: [lw[0]], cache: cacheA, attendu: 1, db: fauxDb(docsE()), r2: fauxR2(), bucket: 'B', maintenant: () => new Date() }));
    verifier('cache altéré (le fichier n\'a plus le sha1 de sa méta) : refus avant toute écriture', eA !== null, true);

    // ── 8. LE RETRAIT : exactement le lot ────────────────────────────────────────────────────────────────────────────
    const { retirerLot } = require('./retirer-symboles-ptcgio');
    const memR = new Map([['R-Lot', { _id: 'R-Lot', symbole: { lot: 'symboles-2026-10', cleR2: 'symboles/R-Lot-aaaaaaaaaa.png', vignette: { cleR2: 'vignettes/symboles/R-Lot-aaaaaaaaaa.webp' } }, nomAffichage: 'x' }],
        ['R-Autre', { _id: 'R-Autre', symbole: { lot: 'autre', cleR2: 'symboles/autre.png' } }], ['R-Sans', { _id: 'R-Sans' }]]);
    const dbR = { collection: () => ({
        find: f => ({ async toArray() { return [...memR.values()].filter(d => d.symbole?.lot === f['symbole.lot']); } }),
        async countDocuments(f) { return [...memR.values()].filter(d => d.symbole?.lot === f['symbole.lot']).length; },
        async updateOne(f, maj) { const d = memR.get(f._id); if (!d || d.symbole?.lot !== f['symbole.lot']) return { modifiedCount: 0 }; if (maj.$unset?.symbole) delete d.symbole; return { modifiedCount: 1 }; } }) };
    const planR = await retirerLot(dbR);
    verifier('retrait à blanc : liste les sets du lot et leurs clés R2 (image + vignette), rien n\'est touché', [planR.sets, planR.cles, memR.get('R-Lot').symbole !== undefined], [['R-Lot'], ['symboles/R-Lot-aaaaaaaaaa.png', 'vignettes/symboles/R-Lot-aaaaaaaaaa.webp'], true]);
    const sup = []; const rR = await retirerLot(dbR, { ecrire: true, effacerR2: true, bucket: 'B', verifierBucket: async () => { }, supprimer: async (b, c) => { sup.push(...c); } });
    verifier('retrait --ecrire : le symbole du lot part seul, l\'autre symbole et le set nu restent, R2 effacé sur demande', [rR.retires, rR.reste, memR.get('R-Lot').symbole, memR.get('R-Autre').symbole.cleR2, sup.length, memR.get('R-Lot').nomAffichage], [1, 0, undefined, 'symboles/autre.png', 2, 'x']);
    verifier('retrait --effacer-r2 sans client R2 → refus', (await leve(() => retirerLot(dbR, { ecrire: true, effacerR2: true }))) !== null, true);

    return { ok, ko };
}

// ── LES MUTANTS : chaque garde supprimée doit faire échouer le banc ───────────────────────────────────────────────────
const MUTATIONS = [
    ['supprimer la condition $exists:false de l\'écriture', "'symbole.cleR2': { $exists: false } }, { $set", "}, { $set"],
    ['accepter un sha1 partagé', 'partage.get(m.sha1) > 1', 'false'],
    ['accepter un argument inconnu', 'if (inconnus.length)', 'if (false)'],
    ['ignorer --attendu', 'gardes.length !== attendu', 'false'],
    ['accepter un symbole de moins de 24 px', 'm.w < TAILLE_MIN || m.h < TAILLE_MIN', 'false'],
    ['ne plus contrôler le plafond', 'aDemander.length > plafond', 'false']
];

(async () => {
    process.env.BANC_SILENCE = '';
    const reel = await banc(require(CHEMIN_MODULE));
    console.log(`\n${reel.ko ? '🔴' : '✅'} module réel : ${reel.ok} passés, ${reel.ko} en échec`);
    if (process.argv.includes('--sans-mutants')) { process.exitCode = reel.ko ? 1 : 0; return; }
    const source = fs.readFileSync(CHEMIN_MODULE, 'utf8');
    let muts = 0, tues = 0;
    for (const [nom, de, vers] of MUTATIONS) {
        muts++;
        if (!source.includes(de)) { console.log(`❌ mutant « ${nom} » : le texte à muter est introuvable dans le module (mutation non appliquée)`); continue; }
        const f = path.join(__dirname, `poser-symboles-ptcgio.mutant${muts}.js`);
        fs.writeFileSync(f, source.replace(de, vers));
        process.env.BANC_SILENCE = '1';
        let ko = 0;
        const mute = await banc(require(f)).catch(e => ({ ko: 1, erreur: e.message }));
        ko = mute.ko;
        delete require.cache[require.resolve(f)]; fs.unlinkSync(f);
        process.env.BANC_SILENCE = '';
        if (ko > 0) { tues++; console.log(`✅ mutant tué : ${nom} (${ko} échec(s) du banc)`); } else console.log(`❌ mutant SURVIVANT : ${nom} — le banc ne garde pas cette garde`);
    }
    console.log(`\n${tues === muts && !reel.ko ? '✅' : '🔴'} mutants : ${tues}/${muts} tués · banc réel : ${reel.ok} passés, ${reel.ko} en échec`);
    process.exitCode = tues === muts && !reel.ko ? 0 : 1;
})().catch(e => { console.error(e); process.exit(1); });

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
const TCG = 'https://assets.tcgdex.net';
// l'adresse d'API (forme hostile) se fabrique par morceaux, comme dans test-garde-jamais-api.js : la garde du dépôt refuse toute adresse d'API écrite en clair
const API_SETS = ['https', '://api', '.pokemontcg', '.io', '/v2/sets'].join('');

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
        // CORRECTION 1 : la seconde identité (TCGdex) et sa source ; la série se lit dans une adresse TCGdex déjà en base sur le set, jamais devinée
        set('O-Set', { tirage: 'jp', remplacementTcgdex: { tcgdexSet: 'sm9' }, logoFr: { urlSource: 'https://assets.tcgdex.net/fr/sm/sm9/logo.png' } }),   // CORRECTION 2 : TCGdex seulement pour un tirage intl (le jumeau occidental n'est pas ce set)
        set('F-Set', { remplacementTcgdex: { tcgdexSet: 'sm1', langue: 'en' }, logoFr: { urlSource: 'https://assets.tcgdex.net/fr/sm/sm1/logo.png' } }),   // TCGdex seul, série lue dans logoFr
        set('G-Set', { remplacementTcgdex: { tcgdexSet: 'sm2' } }),                                 // identité TCGdex sans aucune adresse : série introuvable
        set('H-Set', { visuelsPtcgio: { lignes: ['me55c'] } }),                                     // hôte scrydex : pas de chemin de symbole autorisé
        set('I-Set', { visuelsPtcgio: { lignes: ['Mauvais/../id'] } }),                             // identifiant illisible → sauté
        set('J-Set', { symbole: {}, visuelsPtcgio: { lignes: ['xy9'] } }),                           // symbole vide (sans cleR2) → dans la population
        set('K-Set', { remplacementTcgdex: { tcgdexSet: 'ex1', langue: 'fr' }, logoOfficiel: { en: { urlOriginal: 'https://assets.tcgdex.net/en/ex/ex1/logo.png' } } }),   // série lue dans logoOfficiel.en, langue quelconque
        set('L-Set', { remplacementTcgdex: { tcgdexSet: 'ex2' }, logoFr: { urlSource: 'https://assets.tcgdex.net/fr/ex/ex3/logo.png' } }),   // l'id du chemin (ex3) ≠ tcgdexSet (ex2) → sauté
        set('M-Set', { visuelsPtcgio: { lignes: ['xy3'] }, remplacementTcgdex: { tcgdexSet: 'xy3' }, logoFr: { urlSource: 'https://assets.tcgdex.net/fr/xy/xy3/logo.png' } }),   // les deux : pokemontcg.io gagne, TCGdex noté
        set('N-Set', { visuelsPtcgio: { lignes: ['a1', 'b2'] }, remplacementTcgdex: { tcgdexSet: 'sv01' }, logoFr: { urlSource: 'https://assets.tcgdex.net/fr/sv/sv01/logo.png' } })   // ptcgio ambigu, TCGdex unique : TCGdex
    ];
    const P = M.planifier(sets);
    verifier('plan : population = sets nommés, hors -Additionals, sans symbole.cleR2', P.population, 13);
    verifier('plan : lignes planifiées (source, adresse)', P.lignes.map(l => [l.slug, l.source, l.url]).sort(), [
        ['A-Set', 'pokemontcg.io', `${HOTE}/sm35/symbol.png`], ['F-Set', 'tcgdex', `${TCG}/univ/sm/sm1/symbol.png`], ['J-Set', 'pokemontcg.io', `${HOTE}/xy9/symbol.png`], ['K-Set', 'tcgdex', `${TCG}/univ/ex/ex1/symbol.png`],
        ['M-Set', 'pokemontcg.io', `${HOTE}/xy3/symbol.png`], ['N-Set', 'tcgdex', `${TCG}/univ/sv/sv01/symbol.png`]]);
    verifier('plan : sautés par raison', Object.fromEntries(P.sautes.map(s => [s.slug, s.raison])), { 'B-Set': 'identite-multiple', 'C-Set': 'identite-absente', 'O-Set': 'tirage-non-occidental', 'G-Set': 'serie-introuvable', 'H-Set': 'hote-scrydex', 'I-Set': 'identifiant-illisible', 'L-Set': 'id-du-chemin-different' });
    verifier('plan : la série dit où elle a été lue', Object.fromEntries(P.lignes.filter(l => l.source === 'tcgdex').map(l => [l.slug, [l.serie, l.serieOu, l.tcgdexSet]])), { 'F-Set': ['sm', 'logoFr', 'sm1'], 'K-Set': ['ex', 'logoOfficiel.en', 'ex1'], 'N-Set': ['sv', 'logoFr', 'sv01'] });
    verifier('plan : si les deux identités existent, pokemontcg.io gagne et TCGdex est seulement noté', P.tcgdexNotee, [{ slug: 'M-Set', tcgdexSet: 'xy3' }]);
    verifier('plan : par tirage et par source', [P.parTirage, P.parSource], [{ intl: 6 }, { 'pokemontcg.io': 3, tcgdex: 3 }]);
    verifier('plan : le set pourvu et l\'Additionals ne sont ni planifiés ni sautés', [...P.lignes.map(l => l.slug), ...P.sautes.map(s => s.slug)].filter(s => ['D-Set', 'A-Set-Additionals', 'E-Set'].includes(s)), []);
    verifier('plan : population vide → LÈVE (champ faux = vide fabriqué)', (await leve(() => M.planifier([set('D', { symbole: { cleR2: 'x' } })]))) !== null, true);
    verifier('plan : aucune base lue → LÈVE', (await leve(() => M.planifier([]))) !== null, true);
    verifier('plan : url du symbole', M.urlSymbole('sm35'), `${HOTE}/sm35/symbol.png`);
    verifier('plan : chemin permis — le symbole seul, l\'API et les autres chemins refusés', [`${HOTE}/sm35/symbol.png`, `${HOTE}/sm35/1_hires.png`, API_SETS,`${HOTE}/sm35/symbol.png?x=1`, 'http://images.pokemontcg.io/sm35/symbol.png', `${TCG}/univ/sm/sm1/symbol.png`, `${TCG}/univ/sm/sm1/logo.png`, `${TCG}/en/sm/sm1/symbol.png`, `${TCG}/v2/en/sets/sm1`].map(M.cheminPermis), [true, false, false, false, false, true, false, false, false]);

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
    const fauxTransport = (reponses, now = () => 0) => { const appels = [], temps = []; return { appels, temps, async get(url) { appels.push(url); temps.push([new URL(url).hostname, now()]); const r = reponses[url] || reponses[url.replace(HOTE, '')] || (/robots\.txt$/.test(url) ? robotsLibre : null); if (!r) return { status: 404, type: 'image/png' }; return r; } }; };
    const horloge = () => { let t = 1000; const waits = []; return { waits, now: () => t, avancer: ms => { t += ms; }, pause: async ms => { waits.push(ms); t += ms; } }; };
    const lancer = async (reponses, o = {}) => {
        const h = horloge();
        const cache = o.cache || tmp('symb-cache-'), dossierPauses = tmp('symb-pauses-'), tr = fauxTransport({ '/robots.txt': robotsLibre, ...reponses }, h.now);
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
    verifier('téléchargement : le 404 est consigné absent (sans fichier) ; la fausse page introuvable (200 HTML) n\'est PAS un 404 : refus « pas une image », rien de définitif au cache', [meta('Set-s2').statut, fs.existsSync(path.join(r1.cache, 'Set-s2.png')), fs.existsSync(path.join(r1.cache, 'Set-s3.json')), r1.bilan.pasImage], [404, false, false, ['Set-s3']]);
    verifier('téléchargement : bilan', [r1.bilan.telecharges, r1.bilan.absents, r1.bilan.repris, r1.bilan.arret], [1, 1, 0, null]);
    // reprise : rien n'est redemandé
    const rRep = await lancer({}, { cache: r1.cache });
    verifier('reprise : un fichier en cache n\'est pas redemandé ; la fausse page (non définitive) est redemandée', [rRep.tr.appels.filter(u => /symbol\.png$/.test(u)), rRep.bilan.repris], [[lignes[2].url], 2]);
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
    const rh = await leve(() => lancer({}, { lignes: [{ ...lignes[0], url: API_SETS }] }));
    verifier('adresse hors de /<id>/symbol.png : refus avant toute requête', rh !== null, true);
    // deux 5xx de suite
    const r5 = await lancer({ '/id1/symbol.png': { status: 503, type: 'text/plain', texte: 'x' }, '/id2/symbol.png': { status: 503, type: 'text/plain', texte: 'x' } });
    verifier('5xx sans défi : un réessai, puis l\'unité reste à refaire (pas de méta), le bilan le dit', [fs.existsSync(path.join(r5.cache, 'Set-s1.json')), r5.bilan.transitoires >= 1], [false, true]);

    // 5.b DEUX HÔTES (correction 1) : la même règle, robots.txt par hôte, ≥ 5 s PAR hôte, un 404 est un absent compté (pas un arrêt), le plafond compte les deux hôtes
    const URL_T = `${TCG}/univ/sm/sm1/symbol.png`, URL_T2 = `${TCG}/univ/sm/sm2/symbol.png`;
    const mixtes = [{ ...lignes[0], source: 'pokemontcg.io' }, { slug: 'Set-t1', nom: 'T1', tirage: 'intl', id: 'sm1', url: URL_T, source: 'tcgdex' }, { slug: 'Set-t2', nom: 'T2', tirage: 'intl', id: 'sm2', url: URL_T2, source: 'tcgdex' }, { ...lignes[1], source: 'pokemontcg.io' }];
    const rm = await lancer({ [lignes[0].url]: { status: 200, type: 'image/png', octets: bon }, [URL_T]: { status: 404, type: 'image/png' }, [URL_T2]: { status: 200, type: 'image/png', octets: autre }, [lignes[1].url]: { status: 200, type: 'image/png', octets: autre } }, { lignes: mixtes });
    verifier('deux hôtes : robots.txt relu POUR CHAQUE hôte, une fois, avant sa première image', rm.tr.appels.filter(u => /robots\.txt$/.test(u)), [`${HOTE}/robots.txt`, `${TCG}/robots.txt`]);
    const ecarts = {}; for (let i = 1; i < rm.tr.temps.length; i++) { /* écart au précédent du MÊME hôte */ for (let j = i - 1; j >= 0; j--) if (rm.tr.temps[j][0] === rm.tr.temps[i][0]) { (ecarts[rm.tr.temps[i][0]] ||= []).push(rm.tr.temps[i][1] - rm.tr.temps[j][1]); break; } }
    verifier('deux hôtes : au moins 5 s entre deux requêtes d\'un MÊME hôte', Object.values(ecarts).flat().every(x => x >= 5000) && Object.values(ecarts).flat().length >= 3, true);
    verifier('deux hôtes : 404 chez TCGdex = absent compté, sans arrêt, la suite part (3 gardées, 1 absent)', [rm.bilan.absents, rm.bilan.telecharges, rm.bilan.arret], [1, 3, null]);
    const rmp = await leve(() => lancer({}, { lignes: mixtes, plafond: 3 }));
    verifier('plafond : compte les adresses des DEUX hôtes (4 > 3) → refus avant toute requête', rmp !== null && /plafond/i.test(rmp), true);
    const rdm = await lancer({ [lignes[0].url]: { status: 403, type: 'text/html', texte: '<title>Just a moment...</title>', cfMitigated: 'challenge' }, [URL_T2]: { status: 200, type: 'image/png', octets: autre } }, { lignes: [{ ...lignes[0], source: 'pokemontcg.io' }, mixtes[2]] });
    verifier('défi chez un hôte : il est arrêté, l\'autre hôte continue', [!!rdm.bilan.arret, rdm.bilan.telecharges, !!RH.hoteArrete('images.pokemontcg.io', rdm.dossierPauses), RH.hoteArrete('assets.tcgdex.net', rdm.dossierPauses)], [true, 1, true, null]);

    // 5.c CORRECTION 2 : la cadence se mesure depuis la FIN de la réponse précédente (une réponse de 8 s ne laisse pas partir la suivante tout de suite)
    {
        const h = horloge(); const journalT = [];
        const trLent = { async get(url) { journalT.push([url, 'debut', h.now()]); if (/id1\/symbol/.test(url)) h.avancer(8000); journalT.push([url, 'fin', h.now()]); return /robots/.test(url) ? robotsLibre : { status: 200, type: 'image/png', octets: bon }; } };
        await M.telecharger({ lignes: lignes.slice(0, 2), cache: tmp('symb-lent-'), plafond: 5, transport: trLent, pause: h.pause, now: h.now, suivi: RH.suiviHote(), dossierPauses: tmp('symb-pauses-'), journal: () => { } });
        const fin1 = journalT.find(x => /id1\/symbol/.test(x[0]) && x[1] === 'fin')[2], debut2 = journalT.find(x => /id2\/symbol/.test(x[0]) && x[1] === 'debut')[2];
        verifier('cadence : ≥ 5 s entre la FIN d\'une réponse (8 s) et le début de la requête suivante sur le même hôte', debut2 - fin1 >= 5000, true);
    }
    // 5.d CORRECTION 2 : robots.txt est évalué avec le MÊME User-Agent que celui des requêtes
    verifier('User-Agent : celui des requêtes est celui qui sert à lire robots.txt', M.UA, require('./collecte-cartes/ptcgio').UA);
    const rUA = await leve(() => lancer({ '/robots.txt': { status: 200, type: 'text/plain', texte: `User-agent: ${M.UA.split('/')[0]}\nDisallow: /\n` } }));
    verifier('User-Agent : une règle visant CET agent est appliquée (aucune image)', rUA !== null && /interdit/.test(rUA), true);

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
                if (api.avantUpdate) api.avantUpdate(mem, f);
                const d = mem.get(f._id); if (!d) return { matchedCount: 0, modifiedCount: 0 };
                if (f['symbole.cleR2']?.$exists === false && d.symbole?.cleR2 != null) return { matchedCount: 0, modifiedCount: 0 };
                Object.assign(d, maj.$set); return { matchedCount: 1, modifiedCount: 1 };
            } }) };
        return api;
    };
    const fauxR2 = (o = {}) => { const depots = [], supprimes = []; return { depots, supprimes, async verifierBucket(b) { depots.push(['bucket', b]); }, async deposerBinaire(b, c, buf, t) { depots.push([c, buf.length, t]); return { ecrit: true, cle: c }; },
        async supprimer(b, cles) { if (o.echecSupprimer) throw new Error('R2 injoignable'); supprimes.push(...cles); return cles.length; } }; };
    const journalCapture = () => { const lignes = []; const f = (...a) => lignes.push(a.join(' ')); f.lignes = lignes; return f; };
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
    // 7.c bis ligne TCGdex : source 'tcgdex', preuve de l'identité et de l'endroit où la série a été lue, clé R2 toujours neutre
    const cacheT = tmp('symb-tcgdex-');
    fs.writeFileSync(path.join(cacheT, 'T-Set.png'), autre); fs.writeFileSync(path.join(cacheT, 'T-Set.json'), JSON.stringify({ slug: 'T-Set', id: 'ex1', url: `${TCG}/univ/ex/ex1/symbol.png`, ...m(200, autre, { w: 48, h: 48 }) }));
    const dbT = fauxDb([{ _id: 'T-Set', nomAffichage: 't' }]), r2T = fauxR2();
    const RT = await M.ecrire({ lignes: [{ slug: 'T-Set', nom: 't', tirage: 'intl', id: 'ex1', url: `${TCG}/univ/ex/ex1/symbol.png`, source: 'tcgdex', tcgdexSet: 'ex1', serie: 'ex', serieOu: 'logoFr' }], cache: cacheT, attendu: 1, db: dbT, r2: r2T, bucket: 'B', maintenant: () => new Date('2026-10-18') });
    const vt = dbT.mem.get('T-Set').symbole;
    verifier('écriture TCGdex : source tcgdex, preuve (identité + série lue où), clé R2 neutre', [RT.ecrits, vt.source, /remplacementTcgdex\.tcgdexSet/.test(vt.preuve) && /série lue dans logoFr/.test(vt.preuve) && /n'avait pas de symbole/.test(vt.preuve), /tcgdex|pokemontcg/i.test(vt.cleR2), vt.urlOriginal, vt.lot],
        [['T-Set'], 'tcgdex', true, false, `${TCG}/univ/ex/ex1/symbol.png`, 'symboles-2026-10']);
    // 7.d symbole apparu depuis le plan : jamais écrasé, compté « non écrit »
    db = fauxDb([{ _id: 'W-Bon', nomAffichage: 'x', symbole: { cleR2: 'symboles/ailleurs.png' } }, { _id: 'W-Autre', nomAffichage: 'y' }]); r2 = fauxR2();
    const R2 = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date() });
    verifier('symbole apparu depuis le plan : non écrit, l\'autre écrit, le symbole existant intact', [R2.ecrits, R2.nonEcrits.map(n => n.slug), db.mem.get('W-Bon').symbole.cleR2], [['W-Autre'], ['W-Bon'], 'symboles/ailleurs.png']);
    // 7.e symbole apparu ENTRE la lecture et l'écriture (course) : la condition de la requête protège
    db = fauxDb(docsE()); r2 = fauxR2();
    db.avantUpdate = mem => { if (!mem.get('W-Bon').symbole) mem.get('W-Bon').symbole = { cleR2: 'symboles/course.png' }; };
    const R3 = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date() });
    verifier('course (symbole posé entre le contrôle et l\'écriture) : jamais écrasé', [db.mem.get('W-Bon').symbole.cleR2, R3.nonEcrits.map(n => n.slug)], ['symboles/course.png', ['W-Bon']]);
    // 7.e bis CORRECTION 2 : R2 réussit puis l'updateOne ne modifie rien → les objets déposés par CE passage sont supprimés ; le bilan s'imprime
    const cleW = s => `symboles/${s}-${sha1(s === 'W-Bon' ? bon : autre).slice(0, 10)}.png`, vigW = s => `vignettes/symboles/${s}-${sha1(s === 'W-Bon' ? bon : autre).slice(0, 10)}.webp`;
    const cacheO = tmp('symb-orph-');
    for (const f of fs.readdirSync(cacheE)) fs.copyFileSync(path.join(cacheE, f), path.join(cacheO, f));
    db = fauxDb(docsE()); r2 = fauxR2(); let jr = journalCapture();
    db.avantUpdate = mem => { if (!mem.get('W-Bon').symbole) mem.get('W-Bon').symbole = { cleR2: 'symboles/course.png' }; };
    const Rn = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date(), journal: jr });
    verifier('R2 OK puis updateOne sans effet : les deux objets déposés (original + vignette) sont supprimés', [r2.supprimes.sort(), Rn.nonEcrits.map(n => n.slug)], [[cleW('W-Bon'), vigW('W-Bon')].sort(), ['W-Bon']]);
    verifier('bilan imprimé (écrits, refusés, non écrits, en erreur)', [/écrits 1/.test(jr.lignes.join('\n')), /refusés 0/.test(jr.lignes.join('\n')), /non écrits 1/.test(jr.lignes.join('\n')), /en erreur 0/.test(jr.lignes.join('\n'))], [true, true, true, true]);
    // 7.e ter R2 OK puis updateOne qui LÈVE : le set est en erreur, l'autre est écrit, les objets du set fautif sont supprimés, le bilan s'imprime
    db = fauxDb(docsE()); r2 = fauxR2(); jr = journalCapture();
    db.avantUpdate = (mem, f) => { if (f._id === 'W-Bon') throw new Error('Atlas coupé'); };
    const Rl = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date(), journal: jr });
    verifier('updateOne qui lève : le lot continue (W-Autre écrit), W-Bon en erreur, ses objets supprimés', [Rl.ecrits, Rl.erreurs.map(x => x.slug), r2.supprimes.sort()], [['W-Autre'], ['W-Bon'], [cleW('W-Bon'), vigW('W-Bon')].sort()]);
    verifier('bilan imprimé même avec une erreur', [/écrits 1/.test(jr.lignes.join('\n')), /en erreur 1/.test(jr.lignes.join('\n'))], [true, true]);
    // 7.e quater la vignette lève : AUCUN dépôt R2 pour ce set (la vignette est fabriquée avant tout dépôt)
    const VG = require('./collecte-cartes/vignette'), vraie = VG.fabriquerVignetteSymbole; let appels = 0;
    VG.fabriquerVignetteSymbole = async b => { appels++; if (appels === 1) throw new Error('sharp a échoué'); return vraie(b); };
    db = fauxDb(docsE()); r2 = fauxR2(); jr = journalCapture();
    let Rv; try { Rv = await M.ecrire({ lignes: lw, cache: cacheE, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date(), journal: jr }); } finally { VG.fabriquerVignetteSymbole = vraie; }
    verifier('vignette qui lève : aucun dépôt pour ce set, aucune suppression, l\'autre set écrit', [Rv.erreurs.map(x => x.slug), Rv.ecrits, r2.depots.filter(d => d[0] === cleW('W-Bon') || d[0] === vigW('W-Bon')).length, r2.supprimes.length], [['W-Bon'], ['W-Autre'], 0, 0]);
    verifier('bilan imprimé quand la vignette lève', [/écrits 1/.test(jr.lignes.join('\n')), /en erreur 1/.test(jr.lignes.join('\n'))], [true, true]);
    // 7.e quinquies la suppression échoue : la clé est écrite dans orphelins-symboles-2026-10.json (dossier du cache), que le retrait lit
    db = fauxDb(docsE()); r2 = fauxR2({ echecSupprimer: true }); jr = journalCapture();
    db.avantUpdate = mem => { if (!mem.get('W-Bon').symbole) mem.get('W-Bon').symbole = { cleR2: 'symboles/course.png' }; };
    const Ro = await M.ecrire({ lignes: lw, cache: cacheO, attendu: 2, db, r2, bucket: 'B', maintenant: () => new Date(), journal: jr });
    const orph = JSON.parse(fs.readFileSync(path.join(cacheO, 'orphelins-symboles-2026-10.json'), 'utf8'));
    verifier('suppression R2 en échec : les clés orphelines sont consignées dans le dossier du cache', [orph.map(o => o.cle).sort(), Ro.orphelins.length], [[cleW('W-Bon'), vigW('W-Bon')].sort(), 2]);
    verifier('le retrait lit et liste ces orphelins', require('./retirer-symboles-ptcgio').lireOrphelins(cacheO).map(o => o.cle).sort(), [cleW('W-Bon'), vigW('W-Bon')].sort());
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
    // CORRECTION 2 : --effacer-r2 n'efface les clés d'un set que si son updateOne a RÉELLEMENT retiré le champ (modifiedCount 1) ; les orphelins consignés s'effacent aussi
    const memB = new Map([['B-Ok', { _id: 'B-Ok', symbole: { lot: 'symboles-2026-10', cleR2: 'symboles/B-Ok-1.png', vignette: { cleR2: 'vignettes/symboles/B-Ok-1.webp' } } }],
        ['B-Bouge', { _id: 'B-Bouge', symbole: { lot: 'symboles-2026-10', cleR2: 'symboles/B-Bouge-2.png', vignette: { cleR2: 'vignettes/symboles/B-Bouge-2.webp' } } }]]);
    const dbB = { collection: () => ({ find: f => ({ async toArray() { return [...memB.values()].filter(d => d.symbole?.lot === f['symbole.lot']); } }), async countDocuments() { return memB.size; },
        async updateOne(f) { if (f._id === 'B-Bouge') return { modifiedCount: 0 }; delete memB.get(f._id).symbole; return { modifiedCount: 1 }; } }) };
    const supB = []; const rB = await retirerLot(dbB, { ecrire: true, effacerR2: true, bucket: 'B', verifierBucket: async () => { }, supprimer: async (b, c) => { supB.push(...c); }, orphelins: [{ slug: 'X', cle: 'symboles/orph-1.png' }] });
    verifier('retrait avec modifiedCount 0 : les clés du set non retiré restent ; celles du set retiré et les orphelins sont effacées', [supB.sort(), rB.retires, rB.nonRetires], [['symboles/B-Ok-1.png', 'symboles/orph-1.png', 'vignettes/symboles/B-Ok-1.webp'].sort(), 1, ['B-Bouge']]);
    const planO = await retirerLot(dbB, { orphelins: [{ slug: 'X', cle: 'symboles/orph-1.png' }] });
    verifier('retrait à blanc : les orphelins sont listés', planO.orphelins, ['symboles/orph-1.png']);

    return { ok, ko };
}

// ── LES MUTANTS : chaque garde supprimée doit faire échouer le banc ───────────────────────────────────────────────────
const MUTATIONS = [
    ['supprimer la condition $exists:false de l\'écriture', "'symbole.cleR2': { $exists: false } }, { $set", "}, { $set"],
    ['accepter un sha1 partagé', 'partage.get(m.sha1) > 1', 'false'],
    ['accepter un argument inconnu', 'if (inconnus.length)', 'if (false)'],
    ['ignorer --attendu', 'gardes.length !== attendu', 'false'],
    ['accepter un symbole de moins de 24 px', 'm.w < TAILLE_MIN || m.h < TAILLE_MIN', 'false'],
    ['ne plus contrôler le plafond', 'aDemander.length > plafond', 'false'],
    ['accepter un id de chemin différent de tcgdexSet', 'm[3] !== tcgdexSet', 'false'],
    ['ne pas nettoyer R2 après un updateOne sans effet', 'await nettoyer(depose, g.slug, \'symbole-apparu\');', ''],
    ['prendre l\'identité TCGdex d\'un tirage non occidental', 'tirage !== \'intl\'', 'false']
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

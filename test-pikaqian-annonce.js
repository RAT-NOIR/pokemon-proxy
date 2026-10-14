// node test-pikaqian-annonce.js — LOT PQ-ANNONCE (2026-10-14) : la complétude d'une page PikaQian se prouve aussi par le TOTAL ANNONCÉ (« N of N cards »).
// 🔑 DÉCISION DU TESTEUR (2026-10-13), mot pour mot : « Une page n'est complète que si cartes numérotées + cartes sans numéro = total annoncé par la page (« N of N cards »). Total illisible ou absent =
// page refusée, avec ce motif dans le diagnostic. »
// 🔑 PRÉCISION DU TESTEUR (2026-10-14), mot pour mot, qui PRIME : « le total « A of B cards » est OBLIGATOIRE seulement si la page porte au moins une carte sans numéro. Sans carte sans numéro : règle
// d'avant (numérotées = ancres), et si un total est affiché, il doit concorder (sinon refus) ; s'il est absent, pas de refus. »
// Le jeu d'essai (bancs/pikaqian/promo-sv-p-sans-numero--diagnostic.json) est une copie ANONYMISÉE ; aucun banc ne lit un chemin réel du testeur ; les seuls fichiers écrits le sont sous le dossier temporaire du système.
// PK_MODULE / PK_RECEPTEUR (rouge-recepteur-pikaqian.js) : un pikaqian.js ou un récepteur MUTANT à tester à la place du vrai.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const P = require(process.env.PK_MODULE ? path.resolve(process.env.PK_MODULE) : './collecte-cartes/pikaqian');
const R = require(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : './recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const SV = JSON.parse(fs.readFileSync(path.join(__dirname, 'bancs', 'pikaqian', 'promo-sv-p-sans-numero--diagnostic.json'), 'utf8'));
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOMS = SV.diagnostic.ancresSansTuile.exemples.map(e => e.h2);
const tuile = n => ({ id: UUID(n), nom: `Carte ${n}`, code: 'sv-p', numero: String(n).padStart(3, '0'), img: `https://images.pikaqian.com/promo-sv-p/${UUID(n)}.webp` });
const tuileHtml = t => `<a class="w-full group" data-discover="true" href="/cards/${t.id}"><div class="x"><img alt="${t.nom}" src="${t.img}" loading="lazy"/></div><h2 class="t">${t.nom}</h2><p class="font-mono text-xs">${t.code}<!-- --> · ${t.numero}</p></a>`;
/** Une ancre SANS NUMÉRO de la forme exacte du diagnostic réel ; `o` en dégrade un trait. */
const sansNum = (k, o = {}) => {
    const id = UUID(200000 + k), nom = NOMS[k % NOMS.length];
    return `<a class="w-full group" data-discover="true" href="/cards/${id}"><div class="x"><img alt="${nom}" src="https://images.pikaqian.com/promo-sv-p/${id}.webp" loading="lazy"/>${o.deuxImg ? `<img alt="b" src="https://images.pikaqian.com/promo-sv-p/${id}.webp"/>` : ''}</div><h2 class="t">${nom}</h2><p class="font-mono text-xs">sv-p</p>${o.deuxP ? '<p>sv-p</p>' : ''}</a>`;
};
const ancresValides = n => Array.from({ length: n }, (_, i) => sansNum(i));
/** Une page : nTuiles tuiles, les ancres en plus, et l'annonce (texte visible) donnée telle quelle (null = aucune annonce de la forme « A of B cards »). */
const page = (nTuiles, extras, annonce) => `<!DOCTYPE html><html><head><title>${SV.diagnostic.title}</title></head><body><h1>${SV.diagnostic.h1}</h1><p>sv-p ${nTuiles + extras.length} cards Released 2025/01/16</p>${annonce == null ? '' : `<p>${annonce}</p>`}${Array.from({ length: nTuiles }, (_, i) => tuileHtml(tuile(i + 1))).join('')}${extras.join('')}</body></html>`;
const juger = html => R.jugerPage(JSON.stringify({ url: `https://pikaqian.com/sets/${SV.code}`, html }), { attendu: () => null });
const appel = (nom, ...args) => (typeof P[nom] === 'function' ? P[nom](...args) : undefined);
const ta = html => appel('totalAnnonce', html) ?? { fonction: 'absente' };

// ── 1. totalAnnonce : trois issues, par ce que la forme AUTORISE ──────────────────────────────────────────────────────────────────────
verifier('totalAnnonce : forme réelle « High to Low 758 of 758 cards Mew ex sv-p · 003 R » → ok, total 758', ta('<p>High to Low 758 of 758 cards Mew ex sv-p · 003 R</p>'), { ok: true, total: 758 });
verifier('totalAnnonce : « 74 of 74 cards » et « 31 of 31 cards » → ok', [ta('<div>74 of 74 cards</div>'), ta('<div>31 of 31 cards</div>')], [{ ok: true, total: 74 }, { ok: true, total: 31 }]);
verifier('totalAnnonce : « card » singulier pour 1, espaces multiples, balises entre les mots → ok', [ta('<p>1 of 1 card</p>'), ta('<p>758   of   758  cards</p>'), ta('<p><b>758</b> of <i>758</i> cards</p>')], [{ ok: true, total: 1 }, { ok: true, total: 758 }, { ok: true, total: 758 }]);
verifier('totalAnnonce : deux occurrences IDENTIQUES (en-tête et liste) → ok', ta('<p>758 of 758 cards</p><p>High to Low 758 of 758 cards</p>'), { ok: true, total: 758 });
verifier('totalAnnonce : aucune occurrence de la forme (« sv-p 758 cards Released ») → absent', [ta('<p>sv-p 758 cards Released 2025/01/16</p>'), ta('<p>rien</p>'), ta(''), ta(null), ta(undefined)], Array(5).fill({ absent: true }));
verifier('totalAnnonce : une occurrence hors du texte visible (script, style) → absent', [ta('<script>var s="758 of 758 cards"</script>'), ta('<style>/* 758 of 758 cards */</style>')], Array(2).fill({ absent: true }));
const motifs = [
    ['deux totaux différents', '<p>758 of 758 cards</p><p>701 of 701 cards</p>', /totaux annoncés contradictoires : 758, 701/],
    ['vue filtrée (A ≠ B)', '<p>701 of 758 cards</p>', /vue filtrée : 701 of 758 cards/],
    ['zéro', '<p>0 of 0 cards</p>', /illisible ou nul|nul|zéro/i],
    ['nombre illisible (séparateur de milliers)', '<p>1,234 of 1,234 cards</p>', /illisible/i]
];
for (const [nom, html, re] of motifs) {
    const r = ta(html);
    verifier(`totalAnnonce NON — ${nom} → { ok: false, motif } lisible`, [r.ok, r.total, typeof r.motif === 'string' && re.test(r.motif)], [false, undefined, true]);
}
verifier('totalAnnonce : une occurrence valable PLUS une filtrée → ok:false (jamais « la première »)', ta('<p>758 of 758 cards</p><p>701 of 758 cards</p>').ok, false);

// ── 2. jugerCompletude : la règle de la décision (précision du testeur) ───────────────────────────────────────────────────────────────
const lien = k => ({ nom: `N${k}`, lien: `/cards/${UUID(200000 + k)}` });
const ts = n => Array.from({ length: n }, (_, i) => tuile(i + 1));
const sn = n => Array.from({ length: n }, (_, k) => lien(k));
const OKT = t => ({ ok: true, total: t }), ABS = { absent: true };
const jc = (ancres, nT, nS, total) => appel('jugerCompletude', { ancres, tuiles: ts(nT), sansNumero: nS === undefined ? undefined : sn(nS), total }) ?? { complete: null };
verifier('avec sans-numéro : 701 + 57 = 758 sous « 758 of 758 » → complète', jc(758, 701, 57, OKT(758)).complete, true);
verifier('avec sans-numéro : la même page sous « 800 of 800 » → refusée, motif aux trois nombres', [jc(758, 701, 57, OKT(800)).complete, /800/.test(jc(758, 701, 57, OKT(800)).motif ?? '') && /701/.test(jc(758, 701, 57, OKT(800)).motif ?? '') && /57/.test(jc(758, 701, 57, OKT(800)).motif ?? '')], [false, true]);
verifier('avec sans-numéro : 5 + 753 sous « 758 of 758 » → complète (la décision compare au total, elle ne borne pas la proportion)', jc(758, 5, 753, OKT(758)).complete, true);
verifier('avec sans-numéro : total ABSENT → refusée, « total annoncé absent : obligatoire quand la page porte des cartes sans numéro »', [jc(758, 701, 57, ABS).complete, jc(758, 701, 57, ABS).motif], [false, 'total annoncé absent : obligatoire quand la page porte des cartes sans numéro']);
verifier('avec sans-numéro : total non transmis (undefined) → refusé comme absent (jamais « inconnu = accepté »)', jc(758, 701, 57, undefined).complete, false);
verifier('avec sans-numéro : total inexploitable → refusée avec SON motif', [jc(758, 701, 57, { ok: false, motif: 'vue filtrée : 701 of 758 cards' }).complete, jc(758, 701, 57, { ok: false, motif: 'vue filtrée : 701 of 758 cards' }).motif], [false, 'vue filtrée : 701 of 758 cards']);
verifier('avec sans-numéro : la condition « tuiles = ancres − sansNumero » ne bouge pas (700 tuiles sous un total 757 qui concorde → refusée)', jc(758, 700, 57, OKT(757)).complete, false);
verifier('page ORDINAIRE (aucune sans-numéro) : total absent → complète, PAS de refus', [jc(701, 701, undefined, ABS).complete, jc(701, 701, 0, ABS).complete, jc(701, 701, undefined, undefined).complete], [true, true, true]);
verifier('page ordinaire : total qui concorde → complète', jc(701, 701, undefined, OKT(701)).complete, true);
verifier('page ordinaire : « 300 of 300 » pour 290 tuiles → refusée', [jc(290, 290, undefined, OKT(300)).complete, /300/.test(jc(290, 290, undefined, OKT(300)).motif ?? '') && /290/.test(jc(290, 290, undefined, OKT(300)).motif ?? '')], [false, true]);
verifier('page ordinaire : total inexploitable → refusée avec son motif', [jc(701, 701, undefined, { ok: false, motif: 'totaux annoncés contradictoires : 701, 758' }).complete, jc(701, 701, undefined, { ok: false, motif: 'totaux annoncés contradictoires : 701, 758' }).motif], [false, 'totaux annoncés contradictoires : 701, 758']);
verifier('un fichier SANS compte d\'ancres lisible n\'est pas jugé ici : comme avant', [jc(undefined, 701, undefined, ABS).complete, jc(null, 701, 3, ABS).complete], [true, true]);
verifier('totalDeFichier : null/undefined → absent ; entier > 0 → ok ; autre chose → inexploitable', [appel('totalDeFichier', null), appel('totalDeFichier', undefined), appel('totalDeFichier', 758), appel('totalDeFichier', '758')?.ok, appel('totalDeFichier', 0)?.ok, appel('totalDeFichier', 7.5)?.ok], [ABS, ABS, OKT(758), false, false, false]);

// ── 3. jugerPage (récepteur) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const ann = (a, b = a) => `High to Low ${a} of ${b} cards`;
const j = juger(page(701, ancresValides(57), ann(758)));
verifier('jugerPage forme réelle sv-p (701 + 57, « 758 of 758 cards ») → 200 ; la réponse et la fiche portent totalAnnonce 758', [j.statut, j.corps.ok, j.corps.sansNumero, j.corps.totalAnnonce, j.fiche?.totalAnnonce], [200, true, 57, 758, 758]);
const j800 = juger(page(701, ancresValides(57), ann(800)));
verifier('… la même page sous « 800 of 800 cards » → 422, motif cite 800', [j800.statut, /800/.test(j800.corps.motif ?? '')], [422, true]);
verifier('… 5 tuiles + 753 sans numéro sous « 758 of 758 » → 200 (voulu)', (r => [r.statut, r.corps.sansNumero, r.corps.totalAnnonce])(juger(page(5, ancresValides(753), ann(758)))), [200, 753, 758]);
const jSans = juger(page(701, ancresValides(57), null));
verifier('… avec cartes sans numéro et SANS total → 422, motif « total annoncé absent : obligatoire … », dit dans le diagnostic aussi', [jSans.statut, jSans.corps.motif, (jSans.corps.diagnostic?.lignes ?? []).filter(l => /total annoncé/.test(l) && /absent/.test(l)).length, jSans.corps.diagnostic?.totalAnnonce], [422, 'total annoncé absent : obligatoire quand la page porte des cartes sans numéro', 1, { absent: true }]);
const jFiltre = juger(page(701, ancresValides(57), ann(701, 758)));
verifier('… « 701 of 758 cards » → 422, motif « vue filtrée », dans la réponse ET le diagnostic', [jFiltre.statut, /vue filtrée : 701 of 758 cards/.test(jFiltre.corps.motif ?? ''), (jFiltre.corps.diagnostic?.lignes ?? []).some(l => /vue filtrée : 701 of 758 cards/.test(l))], [422, true, true]);
const jDeux = juger(page(701, ancresValides(57), `${ann(758)}</p><p>${ann(701)}`));
verifier('… deux totaux différents → 422, motif « contradictoires »', [jDeux.statut, /contradictoires : 758, 701/.test(jDeux.corps.motif ?? '')], [422, true]);
const jOrd = juger(page(701, [], null));
verifier('page ORDINAIRE sans total → 200, totalAnnonce null (réponse et fiche)', [jOrd.statut, jOrd.corps.totalAnnonce, jOrd.fiche?.totalAnnonce, jOrd.fiche?.sansNumero], [200, null, null, []]);
verifier('page ordinaire avec un total qui concorde → 200, totalAnnonce 701', (r => [r.statut, r.fiche?.totalAnnonce])(juger(page(701, [], ann(701)))), [200, 701]);
const jOrd300 = juger(page(290, [], ann(300)));
verifier('page ordinaire « 300 of 300 » pour 290 tuiles → 422, motif cite 300 et 290', [jOrd300.statut, /300/.test(jOrd300.corps.motif ?? '') && /290/.test(jOrd300.corps.motif ?? '')], [422, true]);
verifier('page ordinaire avec une annonce de forme différente (« 701 cards ») → lue absente, 200', juger(page(701, [], '701 cards')).statut, 200);
// les deux cas qui manquaient au banc PQ-SANSNUM : une ancre « sans numéro » à DEUX <p>, et à DEUX <img>
verifier('ancresSansNumero : une ancre à DEUX <p> n\'en est pas une ; à DEUX <img> non plus', [(appel('ancresSansNumero', page(701, [sansNum(1, { deuxP: true })], ann(702)), 'promo-sv-p') ?? ['?']).length, (appel('ancresSansNumero', page(701, [sansNum(1, { deuxImg: true })], ann(702)), 'promo-sv-p') ?? ['?']).length], [0, 0]);
for (const [nom, o] of [['DEUX <p>', { deuxP: true }], ['DEUX <img>', { deuxImg: true }]]) {
    const r = juger(page(701, [...ancresValides(56), sansNum(56, o)], ann(758)));
    verifier(`jugerPage NON — 56 ancres valides + une ancre à ${nom} → 422, 56 sans numéro, 701 tuiles, 758 ancres`, [r.statut, r.corps.sansNumero, r.corps.motif], [422, 56, 'page partielle ou forme changée : 758 ancres, 701 tuiles, 56 sans numéro']);
}

// ── 4. LE DISQUE : la fiche et le fichier de page portent totalAnnonce ─────────────────────────────────────────────────────────────────
function envoyer(port, chemin, corps) {
    return new Promise(resolve => {
        const donnees = JSON.stringify(corps);
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: chemin, headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(donnees) } }, res => {
            const m = []; res.on('data', c => m.push(c));
            res.on('end', () => { let jj = null; try { jj = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: jj }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        req.write(donnees); req.end();
    });
}
(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-annonce-'));
    const dossier = path.join(base, 'apprises'), dossierImages = path.join(base, 'passif'), dossierRefusees = path.join(base, 'refusees');
    const srv = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier, dossierImages, dossierRefusees, journal: () => { } });
    try {
        const r = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/promo-sv-p', html: page(701, ancresValides(57), ann(758)) });
        const fiche = r.json?.fichier ? JSON.parse(fs.readFileSync(path.join(dossier, r.json.fichier), 'utf8')) : {};
        const nomPage = fs.existsSync(path.join(dossierImages, 'promo-sv-p')) ? fs.readdirSync(path.join(dossierImages, 'promo-sv-p')).find(n => /^page--/.test(n)) : null;
        const pageFic = nomPage ? JSON.parse(fs.readFileSync(path.join(dossierImages, 'promo-sv-p', nomPage), 'utf8')) : {};
        verifier('POST de la page (« 758 of 758 cards ») : 200 ; la fiche et le fichier de page portent totalAnnonce 758 à côté de sansNumero', [r.status, r.json?.totalAnnonce, fiche.totalAnnonce, pageFic.totalAnnonce, fiche.sansNumero?.length, pageFic.sansNumero?.length], [200, 758, 758, 758, 57, 57]);
        const r0 = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/promo-sv-p', html: page(701, [], null) });
        const f0 = JSON.parse(fs.readFileSync(path.join(dossier, r0.json.fichier), 'utf8'));
        const nomsPages = fs.readdirSync(path.join(dossierImages, 'promo-sv-p')).filter(n => /^page--/.test(n)).sort();
        const p0 = JSON.parse(fs.readFileSync(path.join(dossierImages, 'promo-sv-p', nomsPages.find(n => n.includes(r0.json.fichier.replace(/\.json$/, '').split('--')[1])) ?? nomsPages.at(-1)), 'utf8'));
        verifier('POST d\'une page ordinaire sans total : 200 ; la fiche et le fichier de page portent totalAnnonce null (écrit, pas absent)', [r0.status, 'totalAnnonce' in f0, f0.totalAnnonce, 'totalAnnonce' in p0, p0.totalAnnonce], [200, true, null, true, null]);
        const rf = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/promo-sv-p', html: page(701, ancresValides(57), null) });
        verifier('POST avec cartes sans numéro et sans total : 422, le motif est dans la réponse', [rf.status, rf.json?.motif], [422, 'total annoncé absent : obligatoire quand la page porte des cartes sans numéro']);
    } finally { await srv.fermer(); fs.rmSync(base, { recursive: true, force: true }); }

    // ── 5. LES FICHES ARCHIVÉES (plan, importeur) : la même règle, lue sur la fiche ───────────────────────────────────────────────────
    const I = require('./importer-pikaqian-passif');
    const L = require('./plan-pikaqian-appris');
    const b2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lecteurs-annonce-'));
    try {
        const fiche = (nT, ancres, sansNumero, totalAnnonce) => ({ schema: 1, code: 'promo-sv-p', url: 'https://pikaqian.com/sets/promo-sv-p', le: '2026-01-01T00:00:00.000Z', titre: SV.diagnostic.h1, ancres, tuilesLues: nT, tuiles: ts(nT), origines: [], officielles: 0, ...(sansNumero === undefined ? {} : { sansNumero }), ...(totalAnnonce === undefined ? {} : { totalAnnonce }) });
        const cas = [
            ['ancienne fiche (ni sansNumero ni total), 701 ancres = 701 tuiles', 701, 701, undefined, undefined, true],
            ['ancienne fiche sans total qui déclare 57 sans-numéro (758 ancres)', 701, 758, sn(57), undefined, false],
            ['fiche avec 57 sans-numéro et totalAnnonce 758', 701, 758, sn(57), 758, true],
            ['fiche avec 57 sans-numéro et totalAnnonce 800', 701, 758, sn(57), 800, false],
            ['fiche avec 57 sans-numéro et totalAnnonce null', 701, 758, sn(57), null, false],
            ['fiche ordinaire avec totalAnnonce 701', 701, 701, [], 701, true],
            ['fiche ordinaire avec totalAnnonce null', 701, 701, [], null, true],
            ['fiche ordinaire avec totalAnnonce 800 (ne concorde pas)', 701, 701, [], 800, false]
        ];
        let n = 0;
        for (const [nom, nT, ancres, snum, tot, attendu] of cas) {
            const k = ++n;
            const d1 = path.join(b2, `apprises-${k}`); fs.mkdirSync(d1, { recursive: true });
            fs.writeFileSync(path.join(d1, 'promo-sv-p--20260101T000000Z.json'), JSON.stringify(fiche(nT, ancres, snum, tot)));
            const lp = L.lireApprises(d1, () => null, []);
            const dp = path.join(b2, `passif-${k}`); fs.mkdirSync(path.join(dp, 'promo-sv-p'), { recursive: true });
            fs.writeFileSync(path.join(dp, 'promo-sv-p', 'page--20260101T000000Z.json'), JSON.stringify({ schema: 2, code: 'promo-sv-p', url: 'https://pikaqian.com/sets/promo-sv-p', le: '2026-01-01T00:00:00.000Z', fiche: 'x.json', sha256Html: 'x', titre: SV.diagnostic.h1, tuiles: ts(nT), origines: [], ancres, flux: 'present', sansImageDansLeNavigateur: 0, lots: 0, recues: {}, refusees: {}, ...(snum === undefined ? {} : { sansNumero: snum }), ...(tot === undefined ? {} : { totalAnnonce: tot }) }));
            const ji = await I.jugerCode({ code: 'promo-sv-p', dossierPassif: dp, db: null, M: null, table: [], attendu: () => null, racine: os.tmpdir() });
            verifier(`fiche archivée — ${nom} : plan ${attendu ? 'lit' : 'refuse'}, importeur ${attendu ? 'passe la complétude' : 'page-partielle'}`, [lp.fiches.length === 1, ji.refus?.etat !== 'page-partielle'], [attendu, attendu]);
            if (!attendu) verifier('   … mêmes motifs au plan et à l\'importeur', lp.illisibles[0]?.motif === ji.refus?.motif && typeof ji.refus?.motif === 'string', true);
        }
    } finally { fs.rmSync(b2, { recursive: true, force: true }); }
    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();

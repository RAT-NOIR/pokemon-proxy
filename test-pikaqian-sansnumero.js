// node test-pikaqian-sansnumero.js — LOT PQ-SANSNUM (2026-10-13) : la garde des ancres compte à part les cartes SANS NUMÉRO.
// 🔑 DÉCISION DU TESTEUR (2026-10-13 ~19:10 UTC), mot pour mot : « Oui pour la garde des ancres, à cette condition stricte : la page reste complète si tuiles = ancres AVEC numéro, à l'unité
// près. Les ancres sans numéro sont listées une par une dans le diagnostic (nom, lien), comptées dans le panneau, et jamais importées : un doute est un trou. Aucun autre assouplissement.
// Test rouge puis vert sur une copie anonymisée de sv-p. »
// Le jeu d'essai (bancs/pikaqian/promo-sv-p-sans-numero--diagnostic.json) est une copie ANONYMISÉE du vrai diagnostic (mêmes comptes, codes, dossiers, titres, annonces, ancresSansTuile ;
// ni sha256, ni horodatage réel, ni chemin du testeur). Aucun banc ne lit un chemin réel du testeur ; les seuls fichiers écrits le sont sous le dossier temporaire du système.
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
/** Une ancre SANS NUMÉRO de la forme exacte du diagnostic réel : image dans le dossier de la page, un h2, un p qui ne porte que le code des tuiles. `o` en dégrade un trait. */
const sansNum = (k, o = {}) => {
    const id = UUID(200000 + k), nom = o.nom ?? NOMS[k % NOMS.length];
    const src = o.src ?? `https://images.pikaqian.com/${o.dossier ?? 'promo-sv-p'}/${o.idImage ?? id}.webp`;
    return `<a class="w-full group" data-discover="true" href="/cards/${id}"><div class="x">${o.sansImg ? '' : o.imgSansSrc ? `<img alt="${nom}" loading="lazy"/>` : `<img alt="${nom}" src="${src}" loading="lazy"/>`}</div>${o.sansH2 ? '' : `<h2 class="t">${nom}</h2>`}${o.h2Double ? `<h2>autre</h2>` : ''}<p class="font-mono text-xs">${o.p ?? 'sv-p'}</p></a>`;
};
const ancresValides = n => Array.from({ length: n }, (_, i) => sansNum(i));
const page = (nTuiles, ancresEnPlus) => `<!DOCTYPE html><html><head><title>${SV.diagnostic.title}</title></head><body><h1>${SV.diagnostic.h1}</h1><p>High to Low ${nTuiles + ancresEnPlus.length} of ${nTuiles + ancresEnPlus.length} cards</p>${Array.from({ length: nTuiles }, (_, i) => tuileHtml(tuile(i + 1))).join('')}${ancresEnPlus.join('')}</body></html>`;
const juger = html => R.jugerPage(JSON.stringify({ url: `https://pikaqian.com/sets/${SV.code}`, html }));
const appel = (nom, ...args) => (typeof P[nom] === 'function' ? P[nom](...args) : undefined);

// ── 0. LE JEU D'ESSAI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
verifier('jeu promo-sv-p : 758 ancres, 701 tuiles, 57 ancres sans tuile dont 57 sans « code · numéro », dossier promo-sv-p', [SV.code, SV.ancres, SV.tuilesLues, SV.diagnostic.ancresSansTuile.n, SV.diagnostic.ancresSansTuile.sansRef, SV.diagnostic.ancresSansTuile.sansImg, SV.diagnostic.ancresSansTuile.sansH2, SV.diagnostic.dossiers], ['promo-sv-p', 758, 701, 57, 57, 0, 0, [{ dossier: 'promo-sv-p', n: 701 }]]);
verifier('jeu anonymisé : ni sha256, ni horodatage réel, ni chemin du testeur', [SV.sha256 === undefined, SV.le, /Users|rat-market|catalogue/i.test(JSON.stringify(SV))], [true, '2026-01-01T00:00:00.000Z', false]);

// ── 1. LA FONCTION UNIQUE : ancresSansNumero (la définition fermée) ─────────────────────────────────────────────────────────────────
const tout = page(701, ancresValides(57));
const liste = appel('ancresSansNumero', tout, 'promo-sv-p') ?? [];
verifier('ancresSansNumero : la page fabriquée depuis le jeu (701 tuiles + 57 ancres) → 57 entrées { nom, lien }, dans l\'ordre de la page', [liste.length, Object.keys(liste[0] ?? {}).sort(), liste[0], liste[56]?.lien], [57, ['lien', 'nom'], { nom: NOMS[0], lien: `/cards/${UUID(200000)}` }, `/cards/${UUID(200056)}`]);
verifier('… une page SANS ancre en trop, html vide, null → liste vide', [(appel('ancresSansNumero', page(701, []), 'promo-sv-p') ?? ['?']).length, (appel('ancresSansNumero', '', 'promo-sv-p') ?? ['?']).length, (appel('ancresSansNumero', null, 'promo-sv-p') ?? ['?']).length], [0, 0, 0]);
const NON = {
    'ancre vide (aucun contenu)': `<a href="/cards/${UUID(300001)}"></a>`,
    // PQ-SANSNUM2 (2026-10-17) : l'image (absente, sans src, autre dossier, autre hôte, autre identifiant) et le nombre de <h2> ne font plus partie de la définition (ruling du coordinateur :
    // la carte sans numéro se définit par son code et l'absence de numéro) ; ces cas sont comptés, et leur équivalence avec la sonde est prouvée dans test-pikaqian-sansnumero2.js.
    'ancre au mauvais code (s-p sur la page promo-sv-p)': sansNum(1, { p: 's-p' }),
    'ancre au code complet de l\'adresse (promo-sv-p) : ce n\'est pas le code des tuiles': sansNum(1, { p: 'promo-sv-p' }),
    'ancre sans <h2>': sansNum(1, { sansH2: true }),
    'ancre au <h2> vide': sansNum(1, { nom: '   ' }),
    'ancre dont le <p> porte « code · » sans numéro': sansNum(1, { p: 'sv-p<!-- --> · ' }),
    'ancre dont le <p> porte un numéro (c\'est une tuile ou une tuile cassée, pas une ancre sans numéro)': sansNum(1, { p: 'sv-p<!-- --> · 12' }),
    'ancre dont le <p> porte autre chose que le code (« sv-p rare »)': sansNum(1, { p: 'sv-p rare' })
};
for (const [nom, html] of Object.entries(NON)) {
    verifier(`ancresSansNumero NON — ${nom}`, (appel('ancresSansNumero', page(701, [html]), 'promo-sv-p') ?? ['?']).length, 0);
}
verifier('ancresSansNumero : le nom est tronqué à 60 caractères, sans balise ni caractère de contrôle', (appel('ancresSansNumero', page(701, [sansNum(1, { nom: `Nom très long ${'x'.repeat(200)}` })]), 'promo-sv-p') ?? [{ nom: '' }])[0].nom.length <= 60, true);
verifier('ancresSansNumero : une page qui n\'est pas promo (code cs1bc) → l\'ancre doit porter le code de la page lui-même', [
    (appel('ancresSansNumero', page(2, [sansNum(1, { dossier: 'cs1bc', p: 'cs1bc' })]), 'cs1bc') ?? ['?']).length,
    (appel('ancresSansNumero', page(2, [sansNum(1, { dossier: 'cs1bc', p: 'sv-p' })]), 'cs1bc') ?? ['?']).length], [1, 0]);

// ── 2. LA FONCTION UNIQUE : jugerCompletude (tuiles = ancres AVEC numéro, à l'unité près) ─────────────────────────────────────────────
const lien = k => ({ nom: `N${k}`, lien: `/cards/${UUID(200000 + k)}` });
const ts = n => Array.from({ length: n }, (_, i) => tuile(i + 1));
const jc = (ancres, nT, sansNumero) => appel('jugerCompletude', { ancres, tuiles: ts(nT), sansNumero, total: { ok: true, total: ancres } }) ?? { complete: null };   // lot PQ-ANNONCE : le total annoncé (ici « ancres of ancres ») est obligatoire dès qu'une ancre est sans numéro ; ses cas propres sont dans test-pikaqian-annonce.js
verifier('jugerCompletude : 758 ancres, 701 tuiles, 57 sans numéro (total annoncé 758) → complète', [jc(758, 701, Array.from({ length: 57 }, (_, k) => lien(k))).complete, jc(758, 701, Array.from({ length: 57 }, (_, k) => lien(k))).sansNumero], [true, 57]);
verifier('NON — 758 ancres, 700 tuiles, 57 sans numéro (une tuile en moins, à l\'unité près) → refusée, motif aux trois nombres', [jc(758, 700, Array.from({ length: 57 }, (_, k) => lien(k))).complete, jc(758, 700, Array.from({ length: 57 }, (_, k) => lien(k))).motif], [false, 'page partielle ou forme changée : 758 ancres, 700 tuiles, 57 sans numéro']);
verifier('NON — 758 ancres, 701 tuiles, 56 sans numéro (une ancre sans numéro de moins listée) → refusée', jc(758, 701, Array.from({ length: 56 }, (_, k) => lien(k))).complete, false);
verifier('NON — tuiles > ancres avec numéro (un fichier édité) → refusée : l\'égalité, pas une inégalité', jc(758, 702, Array.from({ length: 57 }, (_, k) => lien(k))).complete, false);
verifier('une fiche ANCIENNE (sans sansNumero) : ancres = tuiles → complète ; ancres > tuiles → refusée (sansNumero absent = 0, jamais « inconnu = accepté »)', [jc(701, 701, undefined).complete, jc(758, 701, undefined).complete, jc(758, 701, undefined).motif], [true, false, 'page partielle ou forme changée : 758 ancres, 701 tuiles, 0 sans numéro']);
verifier('un sansNumero mal formé ne compte pas : non-tableau, entrées sans lien, liens hors forme, doublons, lien d\'une TUILE', [
    jc(758, 701, 57).complete, jc(758, 701, 'x').complete, jc(758, 701, Array.from({ length: 57 }, () => ({ nom: 'a' }))).complete, jc(758, 701, Array.from({ length: 57 }, () => ({ nom: 'a', lien: '/cards/pas-un-uuid' }))).complete,
    jc(758, 701, Array.from({ length: 57 }, () => lien(1))).complete, jc(758, 701, Array.from({ length: 57 }, (_, k) => ({ nom: 'a', lien: `/cards/${UUID(k + 1)}` }))).complete], [false, false, false, false, false, false]);
verifier('un fichier SANS compte d\'ancres lisible (ancien, édité) n\'est pas jugé ici : comme avant', [jc(undefined, 701, undefined).complete, jc(null, 701, []).complete, jc('758', 701, []).complete], [true, true, true]);

// ── 3. jugerPage (récepteur) : refusée sur main, acceptée après — et ce qu'elle écrit ─────────────────────────────────────────────────
const j = juger(tout);
verifier('jugerPage de la page fabriquée depuis le jeu (758 ancres, 701 tuiles, 57 ancres sans numéro) → 200', [j.statut, j.corps.ok, j.corps.ancres, j.corps.tuilesLues, j.corps.tuilesAuCode], [200, true, 758, 701, 701]);
verifier('… la réponse DIT 57 ; la fiche porte 57 { nom, lien }', [j.corps.sansNumero, j.fiche?.sansNumero?.length, Object.keys(j.fiche?.sansNumero?.[0] ?? {}).sort(), j.fiche?.sansNumero?.[56]], [57, 57, ['lien', 'nom'], { nom: NOMS[56 % NOMS.length], lien: `/cards/${UUID(200056)}` }]);
verifier('… aucune ancre sans numéro n\'est une tuile de la fiche (jamais importée) : 701 tuiles, aucun lien commun', [j.fiche?.tuiles?.length, (j.fiche?.sansNumero ?? []).filter(s => j.fiche.tuiles.some(t => `/cards/${t.id}` === s.lien)).length], [701, 0]);
const j58 = juger(page(701, ancresValides(58)));
verifier('une ancre sans numéro de PLUS (58) : la page reste complète, la réponse dit 58', [j58.statut, j58.corps.sansNumero, j58.corps.ancres], [200, 58, 759]);
verifier('une page sans aucune ancre sans numéro : 200, la réponse dit 0, la fiche porte []', (r => [r.statut, r.corps.sansNumero, r.fiche?.sansNumero])(juger(page(701, []))), [200, 0, []]);
for (const [nom, html] of Object.entries(NON)) {
    if (/porte un numéro/.test(nom)) continue;   // une ancre à numéro EST une tuile : la page est alors complète autrement (ancresSansNumero la refuse, c'est tout ce qu'on prouve)
    const r = juger(page(701, [...ancresValides(56), html]));
    verifier(`jugerPage NON — 56 ancres valides + ${nom} → 422, 758 ancres, 701 tuiles, 56 sans numéro`, [r.statut, r.corps.motif, r.corps.sansNumero], [422, 'page partielle ou forme changée : 758 ancres, 701 tuiles, 56 sans numéro', 56]);
}
const tuileCassee = juger(page(700, [`<a href="/cards/${UUID(701)}"><div><img alt="x" src="${tuile(701).img}"/></div><h2>Carte 701</h2><p>sv-p<!-- --> · 701</p></a>`.replace('<img alt="x" src="' + tuile(701).img + '"/>', ''), ...ancresValides(57)]));
verifier('jugerPage NON — une TUILE en moins (700 tuiles lues, une tuile sans image, 57 ancres sans numéro) → 422, à l\'unité près', [tuileCassee.statut, tuileCassee.corps.motif], [422, 'page partielle ou forme changée : 758 ancres, 700 tuiles, 57 sans numéro']);
const refusDiag = juger(page(701, [...ancresValides(56), NON['ancre sans <h2>']])).corps.diagnostic;
verifier('le refus liste les 56 ancres sans numéro, une par une (nom, lien), dans son diagnostic, et le dit dans ses lignes', [refusDiag?.sansNumero?.length, Object.keys(refusDiag?.sansNumero?.[0] ?? {}).sort(), (refusDiag?.lignes ?? []).filter(l => /^ancres sans numéro .*: 56\b/.test(l)).length, refusDiag?.ancresSansTuile?.n], [56, ['lien', 'nom'], 1, 57]);
verifier('diagnostiquerPage sans code (appel ancien) : sansNumero vide, aucune ligne', [(P.diagnostiquerPage({ html: tout, tuiles: [] }).sansNumero ?? ['?']).length, P.diagnostiquerPage({ html: tout, tuiles: [] }).lignes.filter(l => /sans numéro/.test(l)).length], [0, 0]);

// ── 4. LE DISQUE : fiche, fichier de page, diagnostic de refus, et l'image d'une ancre sans numéro (refusée) ────────────────────────────
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
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-sansnum-'));
    const dossier = path.join(base, 'apprises'), dossierImages = path.join(base, 'passif'), dossierRefusees = path.join(base, 'refusees');
    const journal = [];
    const srv = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier, dossierImages, dossierRefusees, journal: m => journal.push(m) });
    try {
        const r = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/promo-sv-p', html: tout });
        verifier('POST de la page (758 ancres, 701 tuiles, 57 sans numéro) : 200, la réponse porte sansNumero 57', [r.status, r.json?.ok, r.json?.sansNumero], [200, true, 57]);
        const fiche = JSON.parse(fs.readFileSync(path.join(dossier, r.json.fichier), 'utf8'));
        verifier('… la fiche apprise écrite porte 57 sansNumero { nom, lien } et 701 tuiles', [fiche.sansNumero?.length, fiche.tuiles.length, fiche.ancres], [57, 701, 758]);
        const pageFic = JSON.parse(fs.readFileSync(path.join(dossierImages, 'promo-sv-p', fs.readdirSync(path.join(dossierImages, 'promo-sv-p')).find(n => /^page--/.test(n))), 'utf8'));
        verifier('… le fichier de page porte les mêmes 57 sansNumero', [pageFic.sansNumero?.length, JSON.stringify(pageFic.sansNumero) === JSON.stringify(fiche.sansNumero)], [57, true]);
        verifier('… le journal du récepteur dit les 57 cartes sans numéro', journal.some(l => /57 cartes? sans numéro/.test(l)), true);
        // UNE IMAGE ENVOYÉE POUR L'UUID D'UNE ANCRE SANS NUMÉRO EST REFUSÉE (elle n'est pas une tuile de la fiche)
        const sn0 = fiche.sansNumero[0], idSn = sn0.lien.slice('/cards/'.length);
        const lot = await envoyer(srv.port, '/images', { fichier: r.json.fichier, sansImage: 0, images: [{ id: idSn, src: `https://images.pikaqian.com/promo-sv-p/${idSn}.webp`, nom: sn0.nom, numero: '', voie: 'canvas', b64: 'AAAA' }] });
        verifier('POST /images pour l\'uuid d\'une ancre sans numéro : 200, 0 reçue, refusée « tuile inconnue de la page apprise », aucun fichier d\'image écrit', [lot.status, lot.json?.recues, lot.json?.refusees?.map(x => x.motif), fs.readdirSync(path.join(dossierImages, 'promo-sv-p')).filter(n => !/^page--/.test(n)).length], [200, 0, ['tuile inconnue de la page apprise'], 0]);
        // un refus écrit sa liste
        const rf = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/promo-sv-p', html: page(701, [...ancresValides(56), NON['ancre sans <h2>']]) });
        const fichiersRefus = fs.existsSync(dossierRefusees) ? fs.readdirSync(dossierRefusees) : [];
        const f = fichiersRefus.length ? JSON.parse(fs.readFileSync(path.join(dossierRefusees, fichiersRefus[0]), 'utf8')) : null;
        verifier('un refus (56 valides + 1 ancre sans h2) : 422 et refusees\\ liste les 56 ancres sans numéro (nom, lien)', [rf.status, f?.diagnostic?.sansNumero?.length, f?.diagnostic?.sansNumero?.[0]?.lien], [422, 56, `/cards/${UUID(200000)}`]);
    } finally { await srv.fermer(); fs.rmSync(base, { recursive: true, force: true }); }

    // ── 5. LES TROIS LECTEURS, UN VERDICT ──────────────────────────────────────────────────────────────────────────────────────────────
    const I = require('./importer-pikaqian-passif');
    const L = require('./plan-pikaqian-appris');
    const b2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lecteurs-sansnum-'));
    try {
        const fiche = (sansNumero, ancres) => ({ schema: 1, code: 'promo-sv-p', url: 'https://pikaqian.com/sets/promo-sv-p', le: '2026-01-01T00:00:00.000Z', titre: SV.diagnostic.h1, ancres, tuilesLues: 701, tuiles: ts(701).map(t => ({ ...t })), origines: [], officielles: 0, ...(sansNumero === undefined ? {} : { sansNumero }), ...(sansNumero === undefined || !sansNumero.length ? {} : { totalAnnonce: ancres }) });
        const sn57 = Array.from({ length: 57 }, (_, k) => lien(k));
        const cas = [['nouvelle fiche, 758 ancres, 57 sans numéro', sn57, 758, true], ['fiche ancienne (sans sansNumero), 758 ancres, 701 tuiles', undefined, 758, false], ['fiche ancienne, 701 ancres', undefined, 701, true], ['nouvelle fiche à 56 sans numéro seulement', sn57.slice(1), 758, false], ['nouvelle fiche, sansNumero = [] et 758 ancres', [], 758, false]];
        for (const [nom, sn, ancres, attendu] of cas) {
            const d1 = path.join(b2, `apprises-${Math.abs(nom.length * 31 + ancres)}-${nom.length}`);
            fs.mkdirSync(d1, { recursive: true });
            fs.writeFileSync(path.join(d1, 'promo-sv-p--20260101T000000Z.json'), JSON.stringify(fiche(sn, ancres)));
            const lp = L.lireApprises(d1, () => null, []);
            const dp = path.join(b2, `passif-${Math.abs(nom.length * 31 + ancres)}-${nom.length}`);
            fs.mkdirSync(path.join(dp, 'promo-sv-p'), { recursive: true });
            fs.writeFileSync(path.join(dp, 'promo-sv-p', 'page--20260101T000000Z.json'), JSON.stringify({ schema: 2, code: 'promo-sv-p', url: 'https://pikaqian.com/sets/promo-sv-p', le: '2026-01-01T00:00:00.000Z', fiche: 'x.json', sha256Html: 'x', titre: SV.diagnostic.h1, tuiles: ts(701), origines: [], ancres, flux: 'present', sansImageDansLeNavigateur: 0, lots: 0, recues: {}, refusees: {}, ...(sn === undefined ? {} : { sansNumero: sn }), ...(sn === undefined || !sn.length ? {} : { totalAnnonce: ancres }) }));
            const ji = await I.jugerCode({ code: 'promo-sv-p', dossierPassif: dp, db: null, M: null, table: [], attendu: () => null, racine: os.tmpdir() });
            const jr = R.jugerPage(JSON.stringify({ url: 'https://pikaqian.com/sets/promo-sv-p', html: page(701, Array.from({ length: ancres - 701 }, (_, i) => (sn === undefined || i >= sn.length ? `<a href="/cards/${UUID(400000 + i)}"></a>` : sansNum(i)))) }));
            verifier(`trois lecteurs — ${nom} : plan ${attendu ? 'lit' : 'refuse'}, importeur ${attendu ? 'passe la complétude' : 'page-partielle'}`, [lp.fiches.length === 1, ji.refus?.etat !== 'page-partielle'], [attendu, attendu]);
            if (!attendu) verifier(`   … mêmes motifs : le plan et l'importeur disent « ${ancres} ancres, 701 tuiles, ${sn === undefined ? 0 : sn.length} sans numéro »`, [lp.illisibles[0]?.motif, ji.refus?.motif], Array(2).fill(`page partielle ou forme changée : ${ancres} ancres, 701 tuiles, ${sn === undefined ? 0 : sn.length} sans numéro`));
        }
    } finally { fs.rmSync(b2, { recursive: true, force: true }); }

    // ── 6. UNE SEULE FONCTION (§21 bis) : aucune copie de « ancres > tuiles » dans les lecteurs ────────────────────────────────────────
    const racine = __dirname;
    const fichiersPk = [...fs.readdirSync(racine), ...fs.readdirSync(path.join(racine, 'collecte-cartes')).map(n => path.join('collecte-cartes', n))].filter(n => /pikaqian/i.test(path.basename(n)) && /\.js$/.test(n) && !/^(test-|rouge-)/.test(path.basename(n)));
    const sansCommentaires = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const COMPARE = /\bancres\b\s*(?:>=|<=|===|!==|(?<![=-])>|<)|(?:>=|<=|===|!==|(?<![=-])>|<)\s*[\w.]*\bancres\b/;
    const copieDeLaRegle = src => COMPARE.test(sansCommentaires(src));
    const copies = fichiersPk.filter(n => n !== path.join('collecte-cartes', 'pikaqian.js') && copieDeLaRegle(fs.readFileSync(path.join(racine, n), 'utf8')));
    verifier('aucun fichier PikaQian de production, hors collecte-cartes/pikaqian.js, ne compare le nombre d\'ancres', copies, []);
    verifier('… le détecteur de copies DIT OUI sur les anciennes formes et NON sur un code propre', [
        'if (ancres > tuiles.length) return 1;', 'if (Number.isInteger(derniere.ancres) && derniere.ancres > tuiles.length) {}', 'if (fiche.ancres > fiche.tuiles.length) {}', 'const ok = tuiles.length === ancres;', 'if (tuiles.length < ancres) {}',
        'const c = P.jugerCompletude({ ancres, tuiles, sansNumero });', 'const o = { ancres: j.corps.ancres };', 'journal(`${a} ancres`); const f = x => ancres => 1;'
    ].map(copieDeLaRegle), [true, true, true, true, true, false, false, false]);
    verifier('les trois lecteurs lisent la fonction unique : jugerCompletude apparaît dans le récepteur, l\'importeur et le plan', ['recepteur-pikaqian.js', 'importer-pikaqian-passif.js', 'plan-pikaqian-appris.js'].map(n => /jugerCompletude/.test(sansCommentaires(fs.readFileSync(path.join(racine, n), 'utf8')))), [true, true, true]);
    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();

// node test-pikaqian-promo2.js — LOT PQ-PROMO2 (2026-10-13) : la garde des pages promo, telle que le testeur l'a décidée, et le diagnostic des ancres sans tuile.
// 🔑 DÉCISION DU TESTEUR : « le code des tuiles est le code du set SANS le préfixe « promo- », et le dossier des images porte le code complet. Corrige la garde pour qu'elle accepte ce
// cas précis : code des tuiles = code de la page sans « promo- » ET dossier des images = code de la page, sur 100 % des tuiles. Aucun autre élargissement. »
// Les jeux d'essai (bancs/pikaqian/promo-*--diagnostic.json) sont des copies ANONYMISÉES de deux vrais diagnostics du récepteur (mêmes comptes, codes, dossiers, titres, annonces ;
// ni sha256, ni horodatage réel). Aucun banc ne lit le vrai chemin du testeur ; le seul fichier écrit l'est sous le dossier temporaire du système.
// PK_MODULE / PK_RECEPTEUR (rouge-recepteur-pikaqian.js) : un pikaqian.js ou un récepteur MUTANT à tester à la place du vrai.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const P = require(process.env.PK_MODULE ? path.resolve(process.env.PK_MODULE) : './collecte-cartes/pikaqian');
const S = require('./collecte-cartes/pikaqian-sets');
const R = require(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : './recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const jeu = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'bancs', 'pikaqian', `${n}--diagnostic.json`), 'utf8'));
const SP = jeu('promo-s-p'), SV = jeu('promo-sv-p');
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = (n, code, dossier, nom = `Carte ${n}`) => ({ id: UUID(n), nom, code, numero: String(n).padStart(3, '0'), img: `https://images.pikaqian.com/${dossier}/${UUID(n)}.webp` });
/** Les tuiles que le jeu d'essai décrit : n tuiles au code lu, dans le dossier lu. */
const tuilesDuJeu = (j, o = {}) => Array.from({ length: j.tuilesLues }, (_, i) => T(i + 1, o.code ?? j.diagnostic.codes[0].code, o.dossier ?? j.diagnostic.dossiers[0].dossier));
const titreDe = j => j.diagnostic.h1;

// ── 0. LES JEUX D'ESSAI : des copies anonymisées, et ce qu'elles portent ─────────────────────────────────────────────────────────────
verifier('jeu promo-s-p : 242 tuiles s-p, dossier promo-s-p, h1, 322 annoncées, 322 ancres', [SP.code, SP.tuilesLues, SP.diagnostic.codes, SP.diagnostic.dossiers, SP.diagnostic.h1, SP.ancres, /322 cards/.test(SP.diagnostic.annonces[0])], ['promo-s-p', 242, [{ code: 's-p', n: 242 }], [{ dossier: 'promo-s-p', n: 242 }], 'Sword & Shield Promos', 322, true]);
verifier('jeu promo-sv-p : 701 tuiles sv-p, dossier promo-sv-p, h1, 758 annoncées, 758 ancres', [SV.code, SV.tuilesLues, SV.diagnostic.codes, SV.diagnostic.dossiers, SV.diagnostic.h1, SV.ancres, /758 cards/.test(SV.diagnostic.annonces[0])], ['promo-sv-p', 701, [{ code: 'sv-p', n: 701 }], [{ dossier: 'promo-sv-p', n: 701 }], 'Scarlet & Violet Promos', 758, true]);
verifier('jeux d\'essai anonymisés : ni sha256, ni horodatage réel, ni chemin du testeur', [SP, SV].map(j => [j.sha256 === undefined, j.le, /Users|rat-market|catalogue/i.test(JSON.stringify(j))]), [[true, '2026-01-01T00:00:00.000Z', false], [true, '2026-01-01T00:00:00.000Z', false]]);

// ── 1. LA FONCTION UNIQUE : le code des tuiles d'une page promo ──────────────────────────────────────────────────────────────────────
verifier('codeDesTuilesPromo : promo-s-p → s-p ; promo-sv-p → sv-p ; promo-30th-p → 30th-p', ['promo-s-p', 'promo-sv-p', 'promo-30th-p'].map(S.codeDesTuilesPromo), ['s-p', 'sv-p', '30th-p']);
verifier('codeDesTuilesPromo : NON — s-p, cs1bc, « promo- » seul, « promo-S-P » (majuscules), « promo-../x », vide, absent', ['s-p', 'cs1bc', 'promo-', 'promo-S-P', 'promo-../x', '', undefined, null, 'xpromo-s-p', 'Promo-s-p'].map(S.codeDesTuilesPromo), [null, null, null, null, null, null, null, null, null, null]);

// ── 2. verdictDePage : ce que la garde AUTORISE — 100 % des tuiles, code sans préfixe, dossier = code de la page ─────────────────────────
for (const [nom, j] of [['promo-s-p', SP], ['promo-sv-p', SV]]) {
    const v = P.verdictDePage({ tuiles: tuilesDuJeu(j), code: j.code, titre: titreDe(j) });
    verifier(`${nom} : ${j.tuilesLues} tuiles au code ${j.diagnostic.codes[0].code}, toutes dans le dossier ${nom} → OK (le diagnostic réel, qui était refusé)`, [v.ok, v.tuiles, v.bonnes], [true, j.tuilesLues, j.tuilesLues]);
}
const v242 = (tuiles, code = 'promo-s-p', titre = 'Sword & Shield Promos') => P.verdictDePage({ tuiles, code, titre });
const sp = tuilesDuJeu(SP);
const sauf = (tuiles, i, remplace) => tuiles.map((t, k) => (k === i ? remplace : t));
verifier('NON — 241 tuiles s-p + 1 tuile promo-s-p : pas 100 % au code sans préfixe', v242(sauf(sp, 0, T(1, 'promo-s-p', 'promo-s-p'))).ok, false);
verifier('NON — 242 tuiles s-p dont UNE tuile a son image dans s-p/', v242(sauf(sp, 7, T(8, 's-p', 's-p'))).ok, false);
verifier('NON — 242 tuiles s-p dont UNE tuile a son image dans promo-sv-p/', v242(sauf(sp, 7, T(8, 's-p', 'promo-sv-p'))).ok, false);
verifier('NON — page promo-s-p dont les tuiles portent sv-p (le code d\'une autre promo), images dans promo-s-p', v242(tuilesDuJeu(SP, { code: 'sv-p' })).ok, false);
verifier('NON — page promo-s-p dont les tuiles portent sv-p ET dont les images sont dans promo-sv-p', v242(tuilesDuJeu(SP, { code: 'sv-p', dossier: 'promo-sv-p' })).ok, false);
verifier('NON — l\'image d\'une tuile porte un AUTRE identifiant que la tuile', v242(sauf(sp, 3, { ...sp[3], img: `https://images.pikaqian.com/promo-s-p/${UUID(999)}.webp` })).ok, false);
verifier('NON — l\'image d\'une tuile est hors de images.pikaqian.com', v242(sauf(sp, 3, { ...sp[3], img: `https://exemple.test/promo-s-p/${sp[3].id}.webp` })).ok, false);
verifier('NON — une seule tuile hors du code sur 242 (241 sur 242 : une majorité ne suffit pas pour la forme promo… et le comportement d\'avant la refuse : 0 au code de l\'adresse)', v242(sauf(sp, 0, T(1, 'autre', 'promo-s-p'))).ok, false);
verifier('NON — aucune tuile', v242([]).ok, false);
verifier('NON — le titre déclaré par la ligne reste exigé (aucune garde n\'est levée) : titre autre sur une ligne qui déclare', P.verdictDePage({ tuiles: sp, code: 'promo-s-p', titre: 'Autre titre', table: [{ slug: 'A', code: 'A', codePk: 'promo-s-p', site: 'pikaqian', mesure: 'banc', tuiles: 242, codesTuiles: ['s-p'], dossiersImages: ['promo-s-p'], titrePk: 'Sword & Shield Promos' }] }).ok, false);
verifier('NON — déclaration incomplète : la garde existante refuse avant la forme promo', P.verdictDePage({ tuiles: sp, code: 'promo-s-p', titre: 'x', table: [{ slug: 'A', code: 'A', codePk: 'promo-s-p', site: 'pikaqian', titrePk: 'x' }] }).ok, false);
// page sans préfixe : rien ne change
const sSansPrefixe = P.verdictDePage({ tuiles: tuilesDuJeu(SP, { dossier: 'promo-s-p' }), code: 's-p', titre: 'x' });
verifier('page s-p (sans préfixe) aux tuiles s-p, images promo-s-p : le verdict est celui d\'avant (majorité au code de l\'adresse)', [sSansPrefixe.ok, P.imageAcceptee('s-p', tuilesDuJeu(SP, { dossier: 'promo-s-p' })[0])], [true, false]);
verifier('page « promo- » seul : jamais la forme promo (aucun code de tuile n\'en sort), tuiles s-p refusées', [P.verdictDePage({ tuiles: tuilesDuJeu(SP, { dossier: 'promo-' }), code: 'promo-', titre: 'x' }).ok, P.verdictDePage({ tuiles: [T(1, '', 'promo-')], code: 'promo-', titre: 'x' }).ok], [false, false]);
verifier('une page qui n\'est pas promo-… (cs1bc) : les tuiles de la forme promo ne passent pas non plus', P.verdictDePage({ tuiles: tuilesDuJeu(SP), code: 'cs1bc', titre: 'x' }).ok, false);

// ── 3. imageAcceptee et le plan : la même règle ──────────────────────────────────────────────────────────────────────────────────────
verifier('imageAcceptee : tuile s-p dont l\'image est exactement promo-s-p/<id>.webp, page promo-s-p → oui', P.imageAcceptee('promo-s-p', sp[0]), true);
verifier('NON — la même tuile, image dans s-p/', P.imageAcceptee('promo-s-p', T(1, 's-p', 's-p')), false);
verifier('NON — la même tuile, image dans promo-sv-p/', P.imageAcceptee('promo-s-p', T(1, 's-p', 'promo-sv-p')), false);
verifier('NON — tuile sv-p sur une page promo-s-p', P.imageAcceptee('promo-s-p', T(1, 'sv-p', 'promo-s-p')), false);
verifier('NON — identifiant de l\'image ≠ identifiant de la tuile', P.imageAcceptee('promo-s-p', { ...sp[0], img: `https://images.pikaqian.com/promo-s-p/${UUID(999)}.webp` }), false);
verifier('NON — page promo-s-p, tuile s-p dont l\'image est hors de l\'hôte', P.imageAcceptee('promo-s-p', { ...sp[0], img: `https://exemple.test/promo-s-p/${sp[0].id}.webp` }), false);
const trou = { carte: { _id: 1, nomEn: 'Carte 1' }, numeroFiche: '001', idProduct: 11 };
const pl = P.planifierPikaqian({ trous: [trou], tuiles: sp, code: 'promo-s-p', slug: 'S-P/CS' });
verifier('planifierPikaqian : sur promo-s-p, le code s-p compte comme code du set → tuile prouvée, image dans promo-s-p', [pl.plan.length, pl.plan[0]?.url], [1, `https://images.pikaqian.com/promo-s-p/${UUID(1)}.webp`]);
const pl2 = P.planifierPikaqian({ trous: [trou], tuiles: [T(1, 's-p', 's-p')], code: 'promo-s-p', slug: 'S-P/CS' });
verifier('… mais une tuile s-p dont l\'image est dans s-p/ est un trou « image-incoherente »', [pl2.plan.length, pl2.restes.map(r => r.motif)], [0, ['image-incoherente']]);
const pl3 = P.planifierPikaqian({ trous: [trou], tuiles: [T(1, 's-p', 'promo-s-p')], code: 's-p', slug: 'S-P/CS' });
verifier('… et sur la page s-p (sans préfixe), rien ne change : le dossier promo-s-p n\'est pas celui de la page → « image-incoherente »', [pl3.plan.length, pl3.restes.map(r => r.motif)], [0, ['image-incoherente']]);
const pl4 = P.planifierPikaqian({ trous: [trou], tuiles: sp, code: 'cs1bc', slug: 'X' });
verifier('… une page cs1bc ne prend pas les tuiles s-p', [pl4.plan.length, pl4.restes.map(r => r.motif)], [0, ['absente-de-la-source']]);

// ── 4. jugerPage (récepteur, fonction pure) : le verdict passe, puis GARDE:ancres refuse toujours — c'est la cause 2, non tranchée ──────────
const tuileHtml = (t) => `<a class="w-full group" data-discover="true" href="/cards/${t.id}"><div class="x"><img alt="${t.nom}" src="${t.img}" loading="lazy"/></div><h2 class="t">${t.nom}</h2><p class="font-mono text-xs">${t.code}<!-- --> · ${t.numero}</p></a>`;
const code1 = (k, extra = '') => `<a href="/cards/${UUID(100000 + k)}">${extra}</a>`;
const EXTRAS = [
    ...Array.from({ length: 20 }, (_, i) => `<a href="/cards/${UUID(100000 + i)}"><h2>Sans image ${i}</h2><p>s-p<!-- --> · ${i}</p></a>`),
    ...Array.from({ length: 20 }, (_, i) => `<a href="/cards/${UUID(100100 + i)}"><img alt="x" src="https://images.pikaqian.com/promo-s-p/${UUID(100100 + i)}.webp"/><p>s-p<!-- --> · ${i}</p></a>`),
    ...Array.from({ length: 20 }, (_, i) => `<a href="/cards/${UUID(100200 + i)}"><img alt="x" src="https://images.pikaqian.com/promo-s-p/${UUID(100200 + i)}.webp"/><h2>Sans numéro ${i}</h2></a>`),
    ...Array.from({ length: 10 }, (_, i) => `<a href="/cards/${UUID(100300 + i)}"><img alt="x"/><h2>Img sans src ${i}</h2><p>s-p<!-- --> · ${i}</p></a>`),
    ...Array.from({ length: 10 }, (_, i) => `<a href="/cards/${UUID(100400 + i)}"><img alt="x" src="https://exemple.test/x/${i}.webp"/><p>s-p<!-- --> · ${i}</p></a>`)
];
const pageDuJeu = (j, ancresEnPlus = []) => `<!DOCTYPE html><html><head><title>${j.diagnostic.title}</title></head><body><h1>${j.diagnostic.h1}</h1><p>${j.ancres} cards</p>${tuilesDuJeu(j).map(tuileHtml).join('')}${ancresEnPlus.join('')}</body></html>`;
const juger = (j, ancresEnPlus) => R.jugerPage(JSON.stringify({ url: `https://pikaqian.com/sets/${j.code}`, html: pageDuJeu(j, ancresEnPlus) }));
const sansTuile = juger(SP, EXTRAS);
verifier('jugerPage promo-s-p (322 ancres, 242 tuiles) : le verdict passe, GARDE:ancres refuse (322 > 242) — cause 2, non tranchée', [sansTuile.statut, sansTuile.corps.motif, sansTuile.corps.tuilesLues, sansTuile.corps.tuilesAuCode, sansTuile.corps.ancres], [422, 'page partielle ou forme changée : 322 ancres, 242 tuiles', 242, 242, 322]);
const a = sansTuile.corps.diagnostic?.ancresSansTuile;
verifier('… et le refus rend le diagnostic des 80 ancres sans tuile : sans <img> 20, sans <h2> 30, sans « code · numéro » 20, <img> sans src 10, src hors images.pikaqian.com 10', [a?.n, a?.sansImg, a?.sansH2, a?.sansRef, a?.imgSansSrc, a?.srcHorsHote], [80, 20, 30, 20, 10, 10]);
verifier('… 5 exemples au plus, chacun réduit à h2, p, img (oui/non) et dossier ; le premier est une ancre sans image', [a?.exemples?.length, Object.keys(a?.exemples?.[0] ?? {}).sort(), a?.exemples?.[0]], [5, ['dossier', 'h2', 'img', 'p'], { h2: 'Sans image 0', p: 's-p · 0', img: false, dossier: null }]);
verifier('… le diagnostic garde les faits du refus du verdict (codes, dossiers, titre) et ses lignes gagnent « ancres sans tuile : … »', [sansTuile.corps.diagnostic?.codes, sansTuile.corps.diagnostic?.dossiers, sansTuile.corps.diagnostic?.h1, (sansTuile.corps.diagnostic?.lignes ?? []).filter(l => /^ancres sans tuile : 80\b/.test(l)).length], [[{ code: 's-p', n: 242 }], [{ dossier: 'promo-s-p', n: 242 }], 'Sword & Shield Promos', 1]);
verifier('… et sha256 / octetsHtml sont rendus (la mesure du refus, comme pour le verdict)', [typeof sansTuile.corps.sha256, typeof sansTuile.corps.octetsHtml], ['string', 'number']);
const complete = juger(SP, []);
verifier('la même page SANS ancre en trop (242 ancres, 242 tuiles) : 200, la fiche porte les 242 tuiles', [complete.statut, complete.fiche?.tuilesLues, complete.fiche?.tuilesAuCode], [200, 242, 242]);
const svSans = juger(SV, Array.from({ length: 57 }, (_, i) => code1(i)));
verifier('jugerPage promo-sv-p (758 ancres, 701 tuiles) : verdict OK puis GARDE:ancres refuse (758 > 701)', [svSans.statut, svSans.corps.motif, svSans.corps.tuilesAuCode], [422, 'page partielle ou forme changée : 758 ancres, 701 tuiles', 701]);
verifier('… les 57 ancres vides sont comptées sans <img>, sans <h2>, sans « code · numéro »', [svSans.corps.diagnostic?.ancresSansTuile?.n, svSans.corps.diagnostic?.ancresSansTuile?.sansImg, svSans.corps.diagnostic?.ancresSansTuile?.sansH2, svSans.corps.diagnostic?.ancresSansTuile?.sansRef], [57, 57, 57, 57]);
verifier('jugerPage : une page promo-s-p dont UNE tuile est dans s-p/ est refusée par le VERDICT (pas par les ancres)', R.jugerPage(JSON.stringify({ url: 'https://pikaqian.com/sets/promo-s-p', html: pageDuJeu(SP).replace(`promo-s-p/${UUID(5)}.webp`, `s-p/${UUID(5)}.webp`) })).corps.motif.replace(/\d+/g, 'N'), 'N tuiles sur N portent le code promo-s-p : la page ne désigne pas ce set');

// ── 5. LE DIAGNOSTIC DES ANCRES : un module, borné, qui lit la même chose que lireTuiles ───────────────────────────────────────────────
const d0 = P.decrireAncresSansTuile(pageDuJeu(SP, []));
verifier('decrireAncresSansTuile : une page dont toutes les ancres sont des tuiles → n = 0, aucun exemple', [d0.n, d0.exemples], [0, []]);
verifier('… n = ancres − tuiles (la sonde lit la même chose que la production)', [P.decrireAncresSansTuile(pageDuJeu(SP, EXTRAS)).n, P.compterAncresCartes(pageDuJeu(SP, EXTRAS)) - P.lireTuiles(pageDuJeu(SP, EXTRAS)).length], [80, 80]);
verifier('… html vide / null → zéros, pas d\'exception', [P.decrireAncresSansTuile('').n, P.decrireAncresSansTuile(null).n], [0, 0]);
const hostile = `<html><body>${Array.from({ length: 10000 }, (_, i) => `<a href="/cards/${UUID(i)}">${i === 1 ? `<img src="https://images.pikaqian.com/promo-s-p/${UUID(i)}.webp"/>` : ''}<h2>${i < 5 ? `&lt;script&gt;${'mot\u0000\u0007 é\u001b'.repeat(i === 1 ? 30 : 300)}<b>gras</b>` : `Nom ${i}`}</h2><p>${i < 5 ? 'p\u0000 &lt;b&gt;'.repeat(i === 1 ? 30 : 300) : '?'}</p></a>`).join('')}</body></html>`;
const dh = P.decrireAncresSansTuile(hostile);
verifier('page hostile de 10 000 ancres : n = 10000, 5 exemples, chaque texte ≤ 60 caractères', [dh.n, dh.exemples.length, dh.exemples.every(e => (e.h2 ?? '').length <= 60 && (e.p ?? '').length <= 60)], [10000, 5, true]);
verifier('… aucun caractère de contrôle, aucune balise dans ce qui est rendu ; le dossier de l\'<img> présente est lu', [/[\u0000-\u001f\u007f-\u009f<>]/.test(JSON.stringify(dh)), dh.exemples[1].img, dh.exemples[1].dossier, dh.exemples[0].img], [false, true, 'promo-s-p', false]);
verifier('… et la mesure ne grossit pas : moins de 3 Ko pour 10 000 ancres', Buffer.byteLength(JSON.stringify(dh)) < 3000, true);
const dx = P.diagnostiquerPage({ html: hostile, tuiles: [] });
verifier('diagnostiquerPage porte ancresSansTuile et sa ligne ; un fichier de diagnostic reste de quelques Ko', [dx.ancresSansTuile.n, dx.lignes.filter(l => /^ancres sans tuile : 10000\b/.test(l)).length, Buffer.byteLength(JSON.stringify(dx)) < 6000], [10000, 1, true]);
verifier('diagnostiquerPage d\'une page sans ancre en trop : aucune ligne « ancres sans tuile »', P.diagnostiquerPage({ html: pageDuJeu(SP, []), tuiles: tuilesDuJeu(SP) }).lignes.filter(l => /ancres sans tuile/.test(l)).length, 0);

// ── 6. LE REFUS DES ANCRES ÉCRIT SON FICHIER refusees\<code>--<date>.json (même fonction, même racine, jamais écrasé) ───────────────────
function envoyer(port, chemin, corps) {
    return new Promise(resolve => {
        const donnees = JSON.stringify(corps);
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: chemin, headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(donnees) } }, res => {
            const m = []; res.on('data', c => m.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        req.write(donnees); req.end();
    });
}
(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-promo2-'));
    const dossier = path.join(base, 'apprises'), dossierImages = path.join(base, 'passif'), dossierRefusees = path.join(base, 'refusees');
    const journal = [];
    const srv = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier, dossierImages, dossierRefusees, journal: m => journal.push(m) });
    try {
        const corps = { url: 'https://pikaqian.com/sets/promo-s-p', html: pageDuJeu(SP, EXTRAS) };
        const r = await envoyer(srv.port, '/apprendre', corps);
        const fichiers = () => (fs.existsSync(dossierRefusees) ? fs.readdirSync(dossierRefusees).sort() : []);
        verifier('POST de la page promo-s-p (322 ancres, 242 tuiles) : 422 « page partielle », rien dans les fiches apprises', [r.status, r.json?.motif, fs.existsSync(dossier) ? fs.readdirSync(dossier).length : 0], [422, 'page partielle ou forme changée : 322 ancres, 242 tuiles', 0]);
        verifier('… et un fichier refusees/promo-s-p--<date>.json est écrit', [fichiers().length, /^promo-s-p--\d{8}T\d{6}Z(-\d+)?\.json$/.test(fichiers()[0] ?? '')], [1, true]);
        const f = JSON.parse(fs.readFileSync(path.join(dossierRefusees, fichiers()[0]), 'utf8'));
        verifier('… il porte le motif, les comptes et le diagnostic des ancres sans tuile (et aucun HTML)', [f.code, f.ancres, f.tuilesLues, f.tuilesAuCode, f.diagnostic?.ancresSansTuile?.n, JSON.stringify(f).includes('<a ')], ['promo-s-p', 322, 242, 242, 80, false]);
        await envoyer(srv.port, '/apprendre', corps);
        verifier('un second refus = un second fichier : jamais écrasé', fichiers().length, 2);
        verifier('… le journal du récepteur affiche la ligne « ancres sans tuile »', journal.some(l => /ancres sans tuile : 80/.test(l)), true);
    } finally { await srv.fermer(); fs.rmSync(base, { recursive: true, force: true }); }

    // ── 7. UNE SEULE FONCTION, TOUS LES LECTEURS (§21 bis) : aucune copie de la règle du préfixe « promo- » ailleurs ───────────────────
    const racine = __dirname;
    const fichiersPk = [...fs.readdirSync(racine), ...fs.readdirSync(path.join(racine, 'collecte-cartes')).map(n => path.join('collecte-cartes', n))].filter(n => /pikaqian/i.test(path.basename(n)) && /\.js$/.test(n) && !/^(test-|rouge-)/.test(path.basename(n)));
    const sansCommentaires = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /** Vrai si le code manipule le préfixe « promo- » lui-même (copie de la règle) — une adresse COMPLÈTE comme 'promo-sv-p' (mesure) n'est pas une copie. */
    const copieDeLaRegle = src => /\bpromo-['"`]|\^promo-|\/promo-\^|\.slice\(\s*6\s*\)|\.substring\(\s*6\s*\)|replace\(\s*\/?\^?\s*promo|startsWith\(\s*['"`]promo-|\.test\([^)]*promo-/.test(sansCommentaires(src));
    const copies = fichiersPk.filter(n => n !== path.join('collecte-cartes', 'pikaqian-sets.js') && copieDeLaRegle(fs.readFileSync(path.join(racine, n), 'utf8')));
    verifier('aucun fichier PikaQian de production, hors collecte-cartes/pikaqian-sets.js, ne manipule le préfixe « promo- »', copies, []);
    verifier('… le détecteur de copies DIT NON sur des copies de la règle (replace, slice(6), startsWith, concaténation) et OUI-pas-de-copie sur un code propre', [
        "const x = code.replace(/^promo-/, '');", 'const x = code.slice(6);', "if (code.startsWith('promo-')) {}", "const d = 'promo-' + x;", 'const x = codeDesTuilesPromo(code);', "const L = 'promo-sv-p';"
    ].map(copieDeLaRegle), [true, true, true, true, false, false]);
    verifier('le récepteur, le plan et la garde d\'image lisent la fonction unique : codeDesTuilesPromo apparaît dans pikaqian.js', /codeDesTuilesPromo/.test(sansCommentaires(fs.readFileSync(path.join(racine, 'collecte-cartes', 'pikaqian.js'), 'utf8'))), true);
    verifier('pikaqian-sets.json : toujours aucune valeur déclarée (codesTuiles / dossiersImages / titrePk)', /codesTuiles|dossiersImages|titrePk/.test(fs.readFileSync(path.join(racine, 'collecte-cartes', 'pikaqian-sets.json'), 'utf8')), false);
    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})();

// node test-pikaqian-promo.js — LOT PQ-PROMO (2026-10-13) : les pages promo de PikaQian, refusées par le récepteur passif parce que leurs tuiles ne portent pas le code de leur adresse.
// Ce banc est PUR (aucun réseau, aucun serveur) : il fabrique ses tables et ses pages. Toutes les valeurs ci-dessous (codes de tuiles, dossiers, titres) sont INVENTÉES par le banc ;
// pikaqian-sets.json n'en contient aucune (la dernière section le prouve) : elles viendront du diagnostic du prochain clic du testeur.
// PK_MODULE (rouge-recepteur-pikaqian.js) : un pikaqian.js MUTANT à tester à la place du vrai — chaque garde « GARDE:pk-* » retirée, seule, doit faire échouer ce banc ou celui du récepteur.
const fs = require('fs');
const path = require('path');
const P = require(process.env.PK_MODULE ? path.resolve(process.env.PK_MODULE) : './collecte-cartes/pikaqian');
const S = require('./collecte-cartes/pikaqian-sets');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = (n, code, dossier, nom = `Carte ${n}`) => ({ id: UUID(n), nom, code, numero: String(n).padStart(3, '0'), img: `https://images.pikaqian.com/${dossier}/${UUID(n)}.webp` });
const SV = 'promo-sv-p', SP = 'promo-s-p';
const DECL = { mesure: 'valeurs fabriquées par le banc', tuiles: 3, codesTuiles: ['code-banc'], dossiersImages: ['dossier-banc'], titrePk: 'Titre du banc' };
const ligne = (slug, codePk, extra = {}) => ({ slug, code: slug.toUpperCase(), codePk, langue: 'zh-hans', tirage: 'zh-hans', trous: 10, tuiles: null, mesure: 'ni ouverte ni appariée', ...extra });
const TABLE = [ligne('A', SV, DECL), ligne('B', SP, { ...DECL, codesTuiles: ['code-autre'], dossiersImages: ['dossier-autre'], titrePk: 'Autre titre' }), ligne('C', 'promo-m-p'), ligne('D', 'cs1bc', { tuiles: 315, mesure: 'mesurée' })];
const bonnes3 = [T(1, 'code-banc', 'dossier-banc'), T(2, 'code-banc', 'dossier-banc'), T(3, 'code-banc', 'dossier-banc')];
const verdict = (o = {}) => P.verdictDePage({ tuiles: bonnes3, code: SV, titre: 'Titre du banc', table: TABLE, ...o });

// ── 1. LA FONCTION UNIQUE : ce qu'une ligne déclare, ou ne déclare pas ───────────────────────────────────────────────
const d = S.declarationsDeCode(SV, TABLE);
verifier('declarationsDeCode : une ligne qui déclare tout, avec sa mesure → déclarée et valide ; codes = ceux déclarés ET celui du set', [d.declare, d.valide, d.codes, d.dossiers, d.titre, d.tuiles], [true, true, [SV, 'code-banc'], [SV, 'dossier-banc'], 'Titre du banc', 3]);
const dv = S.declarationsDeCode('promo-m-p', TABLE);
verifier('declarationsDeCode : une ligne qui ne déclare rien → non déclarée ; codes et dossiers = le code du set seul ; titre null', [dv.declare, dv.valide, dv.codes, dv.dossiers, dv.titre], [false, true, ['promo-m-p'], ['promo-m-p'], null]);
verifier('declarationsDeCode : une ligne mesurée (tuiles seul) n\'est pas une déclaration, et rend son nombre de tuiles', [S.declarationsDeCode('cs1bc', TABLE).declare, S.declarationsDeCode('cs1bc', TABLE).tuiles], [false, 315]);
verifier('declarationsDeCode : un code sans ligne → non déclaré, tuiles null', [S.declarationsDeCode('inconnu', TABLE).declare, S.declarationsDeCode('inconnu', TABLE).tuiles], [false, null]);
for (const [nom, retire] of [['titrePk sans tuiles', { tuiles: null }], ['tuiles non entier', { tuiles: '3' }], ['codesTuiles absent', { codesTuiles: undefined }], ['dossiersImages absent', { dossiersImages: undefined }], ['titrePk absent', { titrePk: undefined }], ['mesure absente', { mesure: undefined }], ['mesure vide', { mesure: '  ' }], ['codesTuiles vide', { codesTuiles: [] }], ['un code hors du motif (majuscules)', { codesTuiles: ['Code-Banc'] }], ['un dossier hors du motif (traversée)', { dossiersImages: ['../x'] }], ['titrePk vide', { titrePk: '' }]]) {
    const x = S.declarationsDeCode(SV, [ligne('A', SV, { ...DECL, ...retire })]);
    verifier(`déclaration incomplète ou illisible (${nom}) → déclarée mais NON valide, avec son motif`, [x.declare, x.valide, typeof x.motif], [true, false, 'string']);
}
const deux = S.declarationsDeCode(SV, [ligne('A', SV, DECL), ligne('A2', SV, DECL)]);
verifier('deux lignes pour le même codePk, dont une déclare → non valide (une déclaration ne se partage pas)', [deux.declare, deux.valide], [true, false]);

// ── 2. LA GARDE : verdictDePage, écrite par ce qu'elle AUTORISE ──────────────────────────────────────────────────────
let v = verdict();
verifier('page promo déclarée : titre égal, majorité aux codes déclarés → OK', [v.ok, v.bonnes, v.tuiles], [true, 3, 3]);
verifier('… le code du set lui-même compte aussi (tuiles au code promo-sv-p)', verdict({ tuiles: [T(1, SV, 'dossier-banc'), T(2, SV, 'dossier-banc'), T(3, 'code-banc', 'dossier-banc')] }).ok, true);
verifier('NON — rien de déclaré : les tuiles portent un autre code que l\'adresse, comme aujourd\'hui (« la page ne désigne pas ce set »)', [P.verdictDePage({ tuiles: bonnes3, code: 'promo-m-p', titre: 'Titre du banc', table: TABLE }).ok, /ne désigne pas ce set/.test(P.verdictDePage({ tuiles: bonnes3, code: 'promo-m-p', titre: 'Titre du banc', table: TABLE }).motif)], [false, true]);
verifier('NON — titre différent', [verdict({ titre: 'Un autre titre' }).ok, /titre/i.test(verdict({ titre: 'Un autre titre' }).motif)], [false, true]);
verifier('NON — titre non lu (null)', verdict({ titre: null }).ok, false);
verifier('NON — titre non fourni par l\'appelant (undefined) : un appelant qui oublie le titre ne passe pas une ligne déclarée', verdict({ titre: undefined }).ok, false);
verifier('NON — titre égal à une casse près (« exact »)', verdict({ titre: 'titre du banc' }).ok, false);
verifier('NON — majorité sur un code non déclaré', verdict({ tuiles: [T(1, 'code-inconnu', 'dossier-banc'), T(2, 'code-inconnu', 'dossier-banc'), T(3, 'code-banc', 'dossier-banc')] }).ok, false);
verifier('NON — égalité stricte (1 sur 2) : la majorité est STRICTE', verdict({ tuiles: [T(1, 'code-inconnu', 'dossier-banc'), T(2, 'code-banc', 'dossier-banc')] }).ok, false);
verifier('NON — aucune tuile', verdict({ tuiles: [] }).ok, false);
verifier('NON — code déclaré pour un AUTRE set : la page promo-s-p dont les tuiles portent le code que promo-sv-p déclare', P.verdictDePage({ tuiles: bonnes3, code: SP, titre: 'Autre titre', table: TABLE }).ok, false);
verifier('… et la même page, aux codes que promo-s-p déclare, passe (le témoin du cas précédent)', P.verdictDePage({ tuiles: [T(1, 'code-autre', 'dossier-autre'), T(2, 'code-autre', 'dossier-autre'), T(3, 'code-autre', 'dossier-autre')], code: SP, titre: 'Autre titre', table: TABLE }).ok, true);
verifier('NON — titrePk déclaré sans tuiles : une déclaration incomplète refuse', [P.verdictDePage({ tuiles: bonnes3, code: SV, titre: 'Titre du banc', table: [ligne('A', SV, { ...DECL, tuiles: null })] }).ok, /incompl|illisible|déclar/i.test(P.verdictDePage({ tuiles: bonnes3, code: SV, titre: 'Titre du banc', table: [ligne('A', SV, { ...DECL, tuiles: null })] }).motif)], [false, true]);
verifier('NON — code sans aucune ligne : comportement d\'aujourd\'hui (le code de l\'adresse seul)', [P.verdictDePage({ tuiles: [T(1, 'zz', 'zz')], code: 'zz', table: TABLE }).ok, P.verdictDePage({ tuiles: [T(1, 'autre', 'zz')], code: 'zz', table: TABLE }).ok], [true, false]);
verifier('sans table fournie, le défaut est la table de production (cs1bc : toutes les tuiles au code → ok, comme avant)', P.verdictDePage({ tuiles: [T(1, 'cs1bc', 'cs1bc')], code: 'cs1bc' }).ok, true);

// ── 3. LES IMAGES : le dossier et l'adresse ─────────────────────────────────────────────────────────────────────────
verifier('imageAcceptee : dossier déclaré, adresse = urlImage(dossier, id), code de la tuile déclaré → oui', P.imageAcceptee(SV, bonnes3[0], TABLE), true);
verifier('NON — image dans un dossier non déclaré', P.imageAcceptee(SV, T(1, 'code-banc', 'dossier-inconnu'), TABLE), false);
verifier('NON — dossier déclaré mais l\'adresse ne porte pas l\'identifiant de la tuile', P.imageAcceptee(SV, { ...bonnes3[0], img: `https://images.pikaqian.com/dossier-banc/${UUID(9)}.webp` }, TABLE), false);
verifier('NON — adresse hors de l\'hôte des images', P.imageAcceptee(SV, { ...bonnes3[0], img: `https://exemple.test/dossier-banc/${UUID(1)}.webp` }, TABLE), false);
verifier('NON — code de la tuile non déclaré', P.imageAcceptee(SV, T(1, 'code-inconnu', 'dossier-banc'), TABLE), false);
verifier('NON — dossier déclaré pour un AUTRE set', P.imageAcceptee(SP, T(1, 'code-autre', 'dossier-banc'), TABLE), false);
verifier('le dossier du set lui-même reste accepté (images.pikaqian.com/promo-sv-p/<id>.webp)', P.imageAcceptee(SV, T(1, SV, SV), TABLE), true);
verifier('ligne sans déclaration : exactement aujourd\'hui (dossier = code du set, code de la tuile = code du set)', [P.imageAcceptee('promo-m-p', T(1, 'promo-m-p', 'promo-m-p'), TABLE), P.imageAcceptee('promo-m-p', T(1, 'code-banc', 'promo-m-p'), TABLE), P.imageAcceptee('promo-m-p', T(1, 'promo-m-p', 'dossier-banc'), TABLE)], [true, false, false]);
verifier('déclaration incomplète : aucune image acceptée', P.imageAcceptee(SV, bonnes3[0], [ligne('A', SV, { ...DECL, tuiles: null })]), false);

// ── 4. LE PLAN lit la même fonction ─────────────────────────────────────────────────────────────────────────────────
const carte = { _id: 1, nomEn: 'Carte 1' };
const trou = { carte, numeroFiche: '001', idProduct: 11 };
const pl = P.planifierPikaqian({ trous: [trou], tuiles: bonnes3, code: SV, slug: 'A', table: TABLE });
verifier('planifierPikaqian : sur une ligne déclarée, la tuile au code déclaré et au dossier déclaré est prouvée', [pl.plan.length, pl.plan[0]?.url], [1, `https://images.pikaqian.com/dossier-banc/${UUID(1)}.webp`]);
const pl2 = P.planifierPikaqian({ trous: [trou], tuiles: [T(1, 'code-banc', 'dossier-inconnu')], code: SV, slug: 'A', table: TABLE });
verifier('… la même tuile dans un dossier non déclaré est un trou « image-incoherente »', [pl2.plan.length, pl2.restes.map(r => r.motif)], [0, ['image-incoherente']]);
const pl3 = P.planifierPikaqian({ trous: [trou], tuiles: [T(1, 'code-inconnu', 'dossier-banc')], code: SV, slug: 'A', table: TABLE });
verifier('… et une tuile à un code non déclaré n\'est même pas candidate', [pl3.plan.length, pl3.restes.map(r => r.motif)], [0, ['absente-de-la-source']]);

// ── 5. LE TITRE ET LE DIAGNOSTIC ─────────────────────────────────────────────────────────────────────────────────────
const pageHtml = (h1, titre, corps = '') => `<!DOCTYPE html><html><head><title>${titre}</title></head><body><h1 class="x">${h1}</h1>${corps}</body></html>`;
verifier('lireTitre : le texte du <h1> et celui du <title>', P.lireTitre(pageHtml('Promo SV &amp; P', 'Promo SV | PikaQian')), { h1: 'Promo SV & P', title: 'Promo SV | PikaQian' });
verifier('lireTitre : page sans titre → null, null', P.lireTitre('<html><body>rien</body></html>'), { h1: null, title: null });
verifier('titreLu : le <h1> prime ; à défaut le <title>', [P.titreLu('<h1>H</h1><title>T</title>'), P.titreLu('<title>T</title>'), P.titreLu('rien')], ['H', 'T', null]);
verifier('lireTitre : un <h1> contenant des balises ne donne que son texte, espaces normalisés', P.lireTitre('<h1> <span>Un</span>\n  <b>titre</b> </h1>').h1, 'Un titre');
const tuilesDiag = [...Array.from({ length: 12 }, (_, i) => T(100 + i, `autre-${i}`, `dos-${i}`)), T(1, 'sv-p', 'cdn-a'), T(2, 'sv-p', 'cdn-a'), T(3, 'sv-p', 'cdn-b')];
const diag = P.diagnostiquerPage({ html: pageHtml('Promo SV-P', 'Promo SV-P | PikaQian', '<p>701 cartes</p><script>var x = "9999 cards";</script>'), tuiles: tuilesDiag });
verifier('diagnostic : les codes lus, du plus fréquent au moins fréquent, 10 au plus, avec le reste compté', [diag.codes[0], diag.codes.length, diag.autresCodes], [{ code: 'sv-p', n: 3 }, 10, 3]);
verifier('diagnostic : les dossiers des adresses d\'images, 10 au plus', [diag.dossiers[0], diag.dossiers.length, diag.autresDossiers], [{ dossier: 'cdn-a', n: 2 }, 10, 4]);
verifier('diagnostic : le titre du set tel que la page le porte (h1 et title)', [diag.h1, diag.title], ['Promo SV-P', 'Promo SV-P | PikaQian']);
verifier('diagnostic : une annonce lisible du nombre de cartes (hors <script>)', [diag.annonces.some(a => /701/.test(a)), diag.annonces.some(a => /9999/.test(a))], [true, false]);
verifier('diagnostic : des lignes de texte pour l\'affichage, une par fait', [Array.isArray(diag.lignes), diag.lignes.some(l => /sv-p/.test(l)), diag.lignes.some(l => /cdn-a/.test(l)), diag.lignes.some(l => /Promo SV-P/.test(l)), diag.lignes.some(l => /701/.test(l))], [true, true, true, true, true]);
const long = P.diagnostiquerPage({ html: pageHtml('x'.repeat(500), 'y'.repeat(500)), tuiles: [T(1, 'a'.repeat(80), 'd')] });
verifier('diagnostic : titres tronqués à 120 caractères, jamais de HTML ni de tuile complète', [long.h1.length <= 121, long.title.length <= 121, JSON.stringify(long).includes('<'), JSON.stringify(long).includes(UUID(1))], [true, true, false, false]);
verifier('diagnostic : une tuile dont l\'adresse n\'a pas la forme images.pikaqian.com/<dossier>/… est comptée « (hors forme) »', P.diagnostiquerPage({ html: '', tuiles: [{ ...T(1, 'a', 'd'), img: 'https://exemple.test/x.png' }] }).dossiers, [{ dossier: '(hors forme)', n: 1 }]);
verifier('diagnostic : page vide → zéros, pas d\'exception', (() => { const x = P.diagnostiquerPage({ html: '', tuiles: [] }); return [x.codes, x.dossiers, x.h1, x.title, x.annonces]; })(), [[], [], null, null, []]);

// ── 6. UNE SEULE FONCTION, TOUS LES LECTEURS (§21 bis) et AUCUNE VALEUR INVENTÉE ─────────────────────────────────────────
const racine = __dirname;
const fichiers = [...fs.readdirSync(racine), ...fs.readdirSync(path.join(racine, 'collecte-cartes')).map(n => path.join('collecte-cartes', n))].filter(n => /\.js$/.test(n) && !/^(test-|rouge-)/.test(path.basename(n)));
const lit = n => fs.readFileSync(path.join(racine, n), 'utf8').replace(/\/\/.*$/gm, '');
const lisentLesChamps = fichiers.filter(n => /\.(codesTuiles|dossiersImages|titrePk)\b|\{[^}]*\b(codesTuiles|dossiersImages|titrePk)\b[^}]*\}\s*=/.test(lit(n)));
verifier('seul collecte-cartes/pikaqian-sets.js lit codesTuiles / dossiersImages / titrePk : aucune copie de la règle ailleurs', lisentLesChamps, [path.join('collecte-cartes', 'pikaqian-sets.js')]);
const appelsVerdict = [];
for (const n of fichiers) for (const m of lit(n).matchAll(/verdictDePage\(\{[^}]*\}\)/g)) appelsVerdict.push([n, /\btitre\b/.test(m[0])]);
verifier('chaque appel de verdictDePage passe le titre lu (récepteur, plan, import, collecteur, mesure)', [appelsVerdict.length >= 4, appelsVerdict.filter(([, a]) => !a)], [true, []]);
const brut = fs.readFileSync(path.join(racine, 'collecte-cartes', 'pikaqian-sets.json'), 'utf8');
verifier('pikaqian-sets.json : AUCUNE valeur codesTuiles / dossiersImages / titrePk (elles viendront du diagnostic du prochain clic)', /codesTuiles|dossiersImages|titrePk/.test(brut), false);
const reel = JSON.parse(brut);
verifier('… les 5 lignes promo dont le code pikaqian diffère du code en minuscules existent toujours, intactes (tuiles null)', ['promo-sv-p', 'promo-s-p', 'promo-sm-p', 'promo-30th-p', 'promo-m-p'].map(c => reel.find(l => l.codePk === c)?.tuiles), [null, null, null, null, null]);

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);

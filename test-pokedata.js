// node test-pokedata.js — le module PUR collecte-cartes/pokedata.js (aucune requête, aucune base). Fixtures RÉELLES de la sonde du 2026-10-17 (fixtures/pokedata-*.html) :
// la liste des sets (694 sets, __NEXT_DATA__) et la page de set « Trick or Trade 2024 » (une coquille rendue côté client : AUCUNE carte dans le HTML).
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pokedata');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const fixture = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const IMG = (set, f) => `https://pokemoncardimages.pokedata.io/images/${set}/${f}`;

// ── 1. la liste des sets, fixture réelle ───────────────────────────────────────────────────────────────────────────────
const liste = P.lireListeDesSets(fixture('pokedata-liste-des-sets.html'));
verifier('liste : 694 sets lus dans __NEXT_DATA__ (dénominateur imprimé par la sonde)', liste.length, 694);
verifier('liste : Trick or Trade 2024 — ENGLISH, code TTBB24', liste.filter(s => s.name === 'Trick or Trade 2024').map(s => [s.language, s.code]), [['ENGLISH', 'TTBB24']]);
verifier('liste : une page sans __NEXT_DATA__ LÈVE (jamais un repli sur le vide)', /NEXT_DATA/.test(leve(() => P.lireListeDesSets('<html><body>rien</body></html>')) || ''), true);
verifier('liste : un setInfoArr vide LÈVE', /vide|setInfoArr/.test(leve(() => P.lireListeDesSets('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"setInfoArr":[]}}}</script>')) || ''), true);
const anglais = new Set(liste.filter(s => s.language === 'ENGLISH').map(s => s.name));
verifier('table des sets utiles : chaque nom est un set ANGLAIS de la liste réelle (aucun nom deviné)', Object.keys(P.SETS_UTILES).filter(n => !anglais.has(n)), []);
verifier('table des sets utiles : aucune clé ne désigne un set de la liste en japonais ou en chinois', Object.keys(P.SETS_UTILES).filter(n => liste.some(s => s.name === n && s.language !== 'ENGLISH') && !anglais.has(n)), []);
verifier('la liste réelle ne porte ni Prize Pack, ni Kit, ni WCD, ni Battle Academy, ni My First Battle (relevé 17/10)', liste.filter(s => s.language === 'ENGLISH' && /prize pack|trainer kit|world championship|battle academy|first battle/i.test(s.name)).length, 0);
verifier('plus de lecteur de page de set (aucune page ne s\'ouvre ni ne se lit) : lireCartesDeLaPage n\'existe plus', 'lireCartesDeLaPage' in P, false);

// ── 2. les adresses ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ok1 = IMG('Trick+or+Trade+2024', '037a.webp');
verifier('adresse d\'image : l\'exemple relevé par le testeur est valable', P.urlImageValide(ok1), true);
verifier('adresse d\'image : les McDonald\'s (apostrophe encodée) d\'un set de la table passent', P.urlImageValide(IMG('McDonald%27s+Promos+2014', '5.webp')), true);
const refusees = {
    '_240w': IMG('Trick+or+Trade+2024', '037a_240w.webp'), 'http': ok1.replace('https', 'http'), 'autre hôte': ok1.replace('pokemoncardimages.pokedata.io', 'images.example.com'),
    'hôte des pages': ok1.replace('pokemoncardimages.pokedata.io', 'www.pokedata.io'), 'paramètre': ok1 + '?w=240', 'ancre': ok1 + '#a', 'remontée': IMG('Trick+or+Trade+2024', '../../x.webp'),
    'png': IMG('Trick+or+Trade+2024', '037a.png'), 'set hors liste': IMG('Nope+Set', '001.webp'), 'port': ok1.replace('.io/', '.io:8443/'), 'identifiants': ok1.replace('https://', 'https://u:p@'),
    'chemin d\'API': 'https://pokemoncardimages.pokedata.io/api/cards/037a.webp', 'prix': 'https://pokemoncardimages.pokedata.io/images/prices/037a.webp', 'double barre': IMG('Trick+or+Trade+2024', '/037a.webp'),
    'encodage inattendu': IMG('Trick+or+Trade+2024', '%2e%2e.webp'), 'vide': '', 'non-chaîne': null
};
for (const [nom, u] of Object.entries(refusees)) verifier(`adresse d'image refusée : ${nom}`, P.urlImageValide(u), false);
verifier('adresse de page : la liste (/sets/) et une page de set de la table passent', [P.urlPageValide('https://www.pokedata.io/sets/'), P.urlPageValide('https://www.pokedata.io/set/Trick+or+Trade+2024'), P.urlPageValide('https://www.pokedata.io/robots.txt')], [true, true, true]);
const pagesRefusees = { 'API': 'https://www.pokedata.io/api/set/Trick+or+Trade+2024', 'set hors table': 'https://www.pokedata.io/set/Pitch+Black', 'paramètre': 'https://www.pokedata.io/set/Trick+or+Trade+2024?x=1', 'fragment de code': 'https://www.pokedata.io/_next/static/chunks/pages/set/%5Bset_name%5D-cbb234bcbbd2895e.js',
    'prix': 'https://www.pokedata.io/prices', 'marché': 'https://www.pokedata.io/marketplace', 'autre hôte': 'https://api.pokedata.io/sets', 'hôte d\'images': 'https://pokemoncardimages.pokedata.io/set/Trick+or+Trade+2024', 'http': 'http://www.pokedata.io/sets/' };
for (const [nom, u] of Object.entries(pagesRefusees)) verifier(`adresse de page refusée : ${nom}`, P.urlPageValide(u), false);

// ── 3. l'appariement ────────────────────────────────────────────────────────────────────────────────────────────────────
const refusNeutre = () => null;
const carte = (_id, nomEn, images = []) => ({ _id, nomEn, images });
const trou = (idProduct, c, slugSet, numeroFiche, slugProduit) => ({ idProduct, carteId: c._id, slugSet, numeroFiche, slugProduit, carte: c });
const rel = (set, numero, nom, f = `${numero}.webp`) => ({ set, numero, nom, img: IMG(set.replace(/ /g, '+'), f), releveComplet: true });
const TOT = 'Trick or Trade 2024', SLUG = 'Trick-or-Trade-2024';
const mimi = carte(1, 'Mimikyu'), gengar = carte(2, 'Gengar'), pika = carte(3, 'Pikachu');
const cartes = [rel(TOT, '037a', 'Mimikyu'), rel(TOT, '057', 'Gengar'), rel(TOT, '018', 'Pikachu')];
const trous = [trou(785611, mimi, SLUG, null, 'Mimikyu-BOO24PAF-037'), trou(785620, gengar, SLUG, null, 'Gengar-BOO24PAF-057'), trou(785608, pika, SLUG, null, 'Pikachu-BOO24PAF-018')];
const noms = new Map([[SLUG, new Map([['mimikyu', new Set([1])], ['gengar', new Set([2])], ['pikachu', new Set([3])]])]]);
let r = P.apparier({ trous, cartes, noms, refus: refusNeutre });
verifier('appariement : une lettre de la source (« 037a ») exige un nom UNIQUE chez nous ; sans la Map des fiches => SAUT « nom-non-unique »', P.apparier({ trous: [trous[0]], cartes, refus: refusNeutre }).restes.map(x => x.motif), ['nom-non-unique']);
verifier('appariement : numéro du slug + nom — « 037a » (lettre de la source) lu comme 037 par preuve (base du numéro ET nom), les deux autres au numéro exact', r.plan.map(u => [u.nomEn, u.voie, u.genre]).sort(), [['Gengar', 'set+numero-du-slug+nom', 'ajout'], ['Mimikyu', 'set+numero-du-slug+lettre+nom', 'ajout'], ['Pikachu', 'set+numero-du-slug+nom', 'ajout']]);
verifier('appariement : la correspondance « 037a » -> 37 est ÉCRITE dans le plan avec sa preuve (pas devinée)', r.plan.find(u => u.nomEn === 'Mimikyu').correspondance, { relevee: '037a', fiche: '37', preuve: 'base du numéro 37 = celui du slug ; nom « Mimikyu » concordant ; une seule carte relevée à cette base avec ce nom' });
r = P.apparier({ trous: [trou(785611, mimi, SLUG, null, 'Mimikyu-BOO24PAF-037')], cartes: [rel(TOT, '037a', 'Mimikyu Halloween')], refus: refusNeutre });
verifier('appariement : le nom contredit => SAUT, motif nommé', [r.plan.length, r.restes.map(x => x.motif)], [0, ['nom-contredit']]);
r = P.apparier({ trous: [trou(785611, mimi, SLUG, null, 'Mimikyu-BOO24PAF-037')], cartes: [rel(TOT, '037', 'Mimikyu'), rel(TOT, '037a', 'Mimikyu', '037a.webp')], refus: refusNeutre });
verifier('appariement : « 037 » et « 037a » portent le même nom => ambigu, SAUT (une lettre ne départage pas sans preuve)', [r.plan.length, r.restes.map(x => x.motif)], [0, ['numero-ambigu']]);
r = P.apparier({ trous: [trou(785611, mimi, SLUG, null, 'Mimikyu-BOO24PAF-037')], cartes: [rel(TOT, '041', 'Mimikyu')], refus: refusNeutre });
verifier('appariement : numéro absent du relevé => SAUT', r.restes.map(x => x.motif), ['numero-absent-du-releve']);
r = P.apparier({ trous: [trou(785611, mimi, SLUG, null, 'Mimikyu-BOO24PAF-037')], cartes: [], refus: refusNeutre });
verifier('appariement : set non relevé => SAUT « set-non-releve »', r.restes.map(x => x.motif), ['set-non-releve']);
r = P.apparier({ trous: [trou(785611, mimi, SLUG, null, 'Mimikyu-BOO24PAF-037')], cartes: [{ ...rel(TOT, '037', 'Mimikyu'), img: 'https://autre.example/x.webp' }], refus: refusNeutre });
verifier('appariement : une adresse du relevé hors règle est refusée', r.restes.map(x => x.motif), ['adresse-hors-regle']);
// McDonald's : numéro de fiche connu (« 5 »), exact; le slug « MCD145 » ne sert JAMAIS de numéro (MCD14 + 5)
const pk = carte(10, 'Pikachu');
r = P.apparier({ trous: [trou(281657, pk, 'McDonalds-Collection-2014', '5', 'Pikachu-MCD145')], cartes: [rel("McDonald's Promos 2014", '5', 'Pikachu')], refus: refusNeutre });
verifier('appariement McDonald\'s : numéro de fiche exact + nom', r.plan.map(u => [u.voie, u.numero]), [['set+numero+nom', '5']]);
verifier('appariement McDonald\'s : l\'adresse du plan est celle du relevé, mot pour mot (apostrophe brute acceptée)', [r.plan[0].url, P.urlImageValide(r.plan[0].url)], [IMG("McDonald's+Promos+2014", '5.webp'), true]);
verifier('le slug « …-MCD145 » n\'est JAMAIS lu comme un numéro (MCD14 + 5) : sans numéro de fiche => SAUT « sans-numero » ; « …-BOO24PAF-037 » donne 037', [P.numeroDuSlug('Pikachu-MCD145'), P.numeroDuSlug('Mimikyu-BOO24PAF-037'), P.apparier({ trous: [trou(281657, pk, 'McDonalds-Collection-2014', null, 'Pikachu-MCD145')], cartes: [rel("McDonald's Promos 2014", '145', 'Pikachu')], refus: refusNeutre }).restes.map(x => x.motif)], [null, '037', ['sans-numero']]);
// deux fiches, une image ; une fiche, deux images
{ const a = carte(20, 'Pikachu'), b = carte(21, 'Pikachu');
  r = P.apparier({ trous: [trou(1, a, SLUG, '5', null), trou(2, b, SLUG, '5', null)], cartes: [rel(TOT, '5', 'Pikachu')], refus: refusNeutre });
  verifier('une image pour deux fiches => SAUT des deux', [r.plan.length, r.restes.map(x => x.motif)], [0, ['carte-pour-deux-fiches', 'carte-pour-deux-fiches']]); }
// ── la doctrine : ajout / remplacement / jamais une image correcte
const entree = (o = {}) => ({ set: SLUG, source: 'pokumon', numero: '037', cleR2: 'x/1.webp', w: 700, wOriginal: 700, ...o });
const unique = (images, refus = refusNeutre) => P.apparier({ trous: [trou(785611, carte(1, 'Mimikyu', images), SLUG, null, 'Mimikyu-BOO24PAF-037')], cartes: [rel(TOT, '037', 'Mimikyu')], refus });
verifier('doctrine : une image CORRECTE au-dessus du seuil n\'est jamais remplacée par une équivalente (deja-servi)', unique([entree()]).restes.map(x => x.motif), ['deja-servi']);
for (const [nom, e, motif] of [['basse définition', entree({ basseDefinition: true, wOriginal: 320 }), 'basse-definition'], ['empruntée au tirage normal', entree({ imageEmprunteeTirage: true }), 'empruntee'], ['nettement plus petite (320 px contre 728)', entree({ wOriginal: 320 }), 'plus-grande']]) {
    const x = unique([e]);
    verifier(`doctrine : ${nom} => REMPLACEMENT préparé (motif ${motif}), pas écrit sans feu vert`, [x.plan.length, x.remplacements.map(u => [u.genre, u.motifRemplacement])], [0, [['remplacement', motif]]]);
}
{ const x = unique([entree()], e => 'langue:ja');
  verifier('doctrine : une entrée REFUSÉE par la règle du site => remplacement (entree-refusee)', x.remplacements.map(u => u.motifRemplacement), ['entree-refusee']); }
verifier('doctrine : sans image => AJOUT', unique([]).plan.map(u => u.genre), ['ajout']);

// ── 4. clé R2, traçabilité, langue, retrait ─────────────────────────────────────────────────────────────────────────────
verifier('clé R2 neutre : pdt/<slugSet>/<n°>-<carteId>-en.webp', P.cleR2('Trick-or-Trade-2024', '037', 785), 'pdt/Trick-or-Trade-2024/037-785-en.webp');
verifier('clé R2 : un numéro à lettre garde sa lettre ; sans numéro => sans-numero', [P.cleR2('S', '37A', 1), P.cleR2('S', null, 1)], ['pdt/S/37A-1-en.webp', 'pdt/S/sans-numero-1-en.webp']);
const tr = P.tracer({ url: ok1, le: new Date('2026-10-17T20:00:00Z') });
verifier('traçabilité : source, adresse d\'origine, date, retirable: true, lot (UNE fonction, tracer())', tr, { source: 'pokedata', urlOriginal: ok1, collecteLe: new Date('2026-10-17T20:00:00Z'), retirable: true, lot: 'pokedata-2026-10' });
verifier('traçabilité : une adresse hors règle LÈVE (rien ne se trace sans adresse valable)', /adresse/.test(leve(() => P.tracer({ url: 'https://autre.example/x.webp' })) || ''), true);
const publics = JSON.stringify({ cleR2: P.cleR2('Trick-or-Trade-2024', '037', 785), mention: P.MENTION, attribution: P.MENTION, langue: P.langueDe(ok1, 'en') });
verifier('aucun champ lu par le site ou l\'API (clé R2, mention, attribution, langue, preuve de langue) ne contient « pokedata »', /pokedata/i.test(publics), false);
verifier('langue : « en » pour une adresse valable déclarée en anglais ; sinon null', [P.langueDe(ok1, 'en').langue, P.langueDe(ok1, null).langue, P.langueDe('https://autre.example/x.webp', 'en').langue], ['en', null, null]);
const lot = { source: 'pokedata', lot: P.LOT };
const cs = [{ _id: 1, images: [{ ...lot, cleR2: 'pdt/a/1-1-en.webp', vignette: { cleR2: 'v/pdt/a/1.webp' } }, { source: 'pokumon', lot: 'x', cleR2: 'k' }] }, { _id: 2, images: [{ source: 'pokedata', lot: 'autre-lot', cleR2: 'z' }] }, { _id: 3, images: [] }];
verifier('retrait : exactement le lot (source ET lot), vignettes comprises', P.planRetrait(cs), { cartes: [1], entrees: 1, cles: ['pdt/a/1-1-en.webp', 'v/pdt/a/1.webp'] });

// ── 4 bis. CORRECTION 1 : la construction directe des adresses, depuis NOS données (0 requête) ─────────────────────────────
verifier('sets anglais : la liste fermée = exactement les sets ENGLISH de la liste réelle (183) ; aucun set japonais ou chinois', [P.SETS_ANGLAIS.length, [...P.SETS_ANGLAIS].sort().join('|') === [...anglais].sort().join('|'), P.SETS_ANGLAIS.includes('Storm Emeralda')], [183, true, false]);
verifier('sets anglais : la table des sets utiles en est un sous-ensemble', Object.keys(P.SETS_UTILES).filter(n => !P.SETS_ANGLAIS.includes(n)), []);
verifier('adresse d\'image : un set anglais de la liste (Pitch Black) passe désormais ; un nom inventé non', [P.urlImageValide(IMG('Pitch+Black', '001.webp')), P.urlImageValide(IMG('Nope+Set', '001.webp'))], [true, false]);
verifier('segment de set : espaces -> « + » comme l\'exemple relevé', P.segmentDeSet('Trick or Trade 2024'), 'Trick+or+Trade+2024');
// 🔴 CORRECTION 2 : la CONSTRUCTION d'adresses est ABANDONNÉE — aucun chemin d'exécution ne fabrique une adresse (elles viennent toutes d'un relevé)
verifier('aucune fonction de construction n\'est exportée', ['construire', 'construireAdresse', 'choisirEchantillon', 'sonderEchantillon', 'SUFFIXE_PAR_SET'].filter(k => k in P), []);
{ const src = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'pokedata.js'), 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
  verifier('le module ne contient aucun gabarit qui assemble une adresse d\'image (ni « ${PREFIXE_CHEMIN} », ni « /images/${ »)', [/\$\{PREFIXE_CHEMIN\}/.test(src), /\/images\/\$\{/.test(src), /https:\/\/\$\{HOTE_IMAGES\}/.test(src)], [false, false, false]); }
verifier('la seule adresse « fabriquée » est celle d\'une PAGE de set de la table (urlPageDuSet), jamais une image', [P.urlPageDuSet('Pitch Black'), P.urlPageDuSet('Trick or Trade 2024')], [null, 'https://www.pokedata.io/set/Trick+or+Trade+2024']);
verifier('un relevé douteux (numéro qui contredit le fichier) est écarté par lireReleves, compté', (() => { const d = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'pdt-lr-')); require('fs').writeFileSync(path.join(d, 'releve--x.json'), JSON.stringify({ schema: 1, set: 'Trick or Trade 2024', complet: false, cartes: [{ numero: '037b', nom: 'A', img: ok1, numeroDoute: true }, { numero: '057a', nom: 'B', img: IMG('Trick+or+Trade+2024', '057a.webp') }] })); const r = P.lireReleves(d); return [r.cartes.length, r.douteuses]; })(), [1, 1]);
verifier('les 10 pages à ouvrir sont celles de sets où nous avons des manques (table des sets utiles : chacune désigne au moins un set à nous)', P.PAGES_A_OUVRIR.map(u => P.nomDeSegment(new URL(u).pathname.replace(/^\/set\//, ''), Object.keys(P.SETS_UTILES))).filter(n => !n || !P.SETS_UTILES[n].length), []);

// ── 4 bis. POKEDATA-SUITE : le témoin du nom lit le texte alternatif « Nom [Variante] Numéro » (la sonde ne doit pas fabriquer le refus) ─────────
{
    const UF = 'Unseen Forces', USLUG = 'EX-Unseen-Forces';
    const potion = carte(10, 'Potion'), gen = carte(11, 'Gengar'), rai = carte(12, 'Raikou');
    const un = (c, n) => trou(c._id * 100, c, USLUG, n, null);
    verifier('nomDepouille : le dernier mot égal au numéro est retiré (zéros de tête et suffixe r tolérés)', [P.nomDepouille('Potion 95', '95'), P.nomDepouille('Potion Reverse Holo 95', '95r'), P.nomDepouille('Gengar Cosmos Holo 057', '057'), P.nomDepouille('Gengar 57', '057'), P.nomDepouille('Gengar 057', '57')], ['Potion', 'Potion', 'Gengar', 'Gengar', 'Gengar']);
    verifier('nomDepouille : un numéro dans le nom DIFFÉRENT du numéro relevé n\'est pas retiré', [P.nomDepouille('Potion 96', '95'), P.nomDepouille('Potion Reverse Holo 96', '95r')], ['Potion 96', 'Potion Reverse Holo 96']);
    verifier('nomDepouille : liste fermée de mentions finales (Reverse Holo, Cosmos Holo, Holo) ; « Gold Star », « δ », « ex », « LV.X » restent', [P.nomDepouille('Raikou Gold Star 114', '114'), P.nomDepouille('Pikachu δ 12', '12'), P.nomDepouille('Mew ex Holo 7', '7'), P.nomDepouille('Palkia LV.X 9', '9'), P.nomDepouille('Holo Charizard 4', '4'), P.nomDepouille('Holo 4', '4')], ['Raikou Gold Star', 'Pikachu δ', 'Mew ex', 'Palkia LV.X', 'Holo Charizard', 'Holo']);
    verifier('nomDepouille : sans numéro à retirer, la mention finale part quand même ; une valeur non chaîne ne plante pas', [P.nomDepouille('Gengar Cosmos Holo', '057'), P.nomDepouille(null, '1'), P.nomDepouille('Potion', undefined)], ['Gengar', null, 'Potion']);
    let q = P.apparier({ trous: [un(potion, '95')], cartes: [rel(UF, '95', 'Potion 95'), rel(UF, '95r', 'Potion Reverse Holo 95', '95r.webp')], refus: refusNeutre });
    verifier('Potion 95 + Potion Reverse Holo 95 : l\'image NORMALE 95.webp est retenue, jamais …r.webp', [q.plan.map(u => u.url), q.restes.map(x => x.motif)], [[IMG('Unseen+Forces', '95.webp')], []]);
    q = P.apparier({ trous: [un(potion, '95')], cartes: [rel(UF, '95r', 'Potion Reverse Holo 95', '95r.webp'), rel(UF, '95', 'Potion 95')], refus: refusNeutre });
    verifier('   (même résultat si la reverse est relevée avant la normale)', q.plan.map(u => u.url), [IMG('Unseen+Forces', '95.webp')]);
    q = P.apparier({ trous: [un(potion, '95')], cartes: [rel(UF, '95r', 'Potion Reverse Holo 95', '95r.webp')], refus: refusNeutre });
    verifier('seule la reverse existe : rien n\'est retenu, reste « seulement-reverse »', [q.plan.length, q.restes.map(x => x.motif)], [0, ['seulement-reverse']]);
    q = P.apparier({ trous: [un(gen, '57')], cartes: [rel(UF, '057', 'Gengar Cosmos Holo 057')], refus: refusNeutre });
    verifier('Gengar Cosmos Holo 057 : comparé « Gengar » => retenu', [q.plan.map(u => u.nomEn), q.restes.length], [['Gengar'], 0]);
    q = P.apparier({ trous: [un(rai, '114')], cartes: [rel(UF, '114', 'Raikou Gold Star 114')], refus: refusNeutre });
    verifier('Raikou Gold Star 114 contre la fiche « Raikou » : reste « nom-contredit » (le sens sûr)', [q.plan.length, q.restes.map(x => x.motif)], [0, ['nom-contredit']]);
    q = P.apparier({ trous: [un(potion, '95')], cartes: [rel(UF, '95', 'Gengar 95')], refus: refusNeutre });
    verifier('un nom différent reste contredit', q.restes.map(x => x.motif), ['nom-contredit']);
    q = P.apparier({ trous: [un(potion, '95')], cartes: [rel(UF, '95', 'Potion 96')], refus: refusNeutre });
    verifier('un numéro dans le nom différent du numéro relevé n\'est pas retiré : « Potion 96 » contredit la fiche', q.restes.map(x => x.motif), ['nom-contredit']);
    q = P.apparier({ trous: [un(potion, '95')], cartes: [rel(UF, '95r', 'Gengar Reverse Holo 95', '95r.webp')], refus: refusNeutre });
    verifier('seule une reverse d\'un AUTRE nom : « nom-contredit », pas « seulement-reverse »', q.restes.map(x => x.motif), ['nom-contredit']);
}

// ── 5. constantes de politesse ─────────────────────────────────────────────────────────────────────────────────────────
verifier('cadence ≥ 5 s ; hôtes : deux, nommés ; pas de source 0 requête dans le module (aucun require réseau)', [P.CADENCE_MS >= 5000, P.HOTE_PAGES, P.HOTE_IMAGES, /require\('(axios|http|https|node-fetch)'\)/.test(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'pokedata.js'), 'utf8'))], [true, 'www.pokedata.io', 'pokemoncardimages.pokedata.io', false]);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;

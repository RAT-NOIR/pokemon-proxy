// node test-userscript-pokemoncom.js — le userscript PASSIF de pokemon.com (userscript-pokemoncom.js). Test STATIQUE (aucune adresse hors 127.0.0.1, aucune navigation, aucun défilement,
// aucun accès aux cookies, aucun téléchargement d'image) et test de COMPORTEMENT dans un bac `vm` sur un DOM FABRIQUÉ : aucune requête réelle.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('./recepteur-pokemoncom');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const SRC = fs.readFileSync(process.env.PM_USERSCRIPT ? path.resolve(process.env.PM_USERSCRIPT) : path.join(__dirname, 'userscript-pokemoncom.js'), 'utf8');
const m = /^\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/.exec(SRC);
verifier('l\'en-tête ==UserScript== existe', !!m, true);
const entete = m ? m[1] : '';
const valeurs = cle => [...entete.matchAll(new RegExp(`^//\\s*@${cle}\\s+(.+?)\\s*$`, 'gm'))].map(x => x[1]);
const code = SRC.slice(m ? m[0].length : 0);
const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

// ── STATIQUE
verifier('@version : 1.1', valeurs('version'), ['1.1']);
verifier('@match : la base de cartes de pokemon.com, rien d\'autre', valeurs('match'), ['https://www.pokemon.com/us/pokemon-tcg/pokemon-cards*']);
verifier('@grant : GM_xmlhttpRequest seulement', valeurs('grant'), ['GM_xmlhttpRequest']);
verifier('@connect : 127.0.0.1 seulement (le récepteur local)', valeurs('connect'), ['127.0.0.1']);
const adresses = [...sansCommentaires.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*/gi)].map(x => x[0]);
verifier('dans le code : toute adresse écrite est http://127.0.0.1:<port>', adresses.length >= 1 && adresses.every(a => /^http:\/\/127\.0\.0\.1:$/.test(a)), true);
const PORT_US = /^\s*var PORT = (\d{4,5});/m.exec(code);
verifier('PORT : constante unique, égale au port par défaut du récepteur', [!!PORT_US, Number(PORT_US?.[1]) === R.PORT_DEFAUT], [true, true]);
const ENTETE_US = /'X-Rat-Market':\s*'([^']+)'/.exec(code);
verifier('l\'en-tête fixe du script est celui que le récepteur exige', [R.ENTETE_MARQUE, ENTETE_US?.[1]], ['x-rat-market', R.VALEUR_MARQUE]);
verifier('le script ne pose PAS d\'en-tête Origin', /['"]Origin['"]/i.test(sansCommentaires), false);
const hotes = [...sansCommentaires.matchAll(/['"]([a-z0-9-]+(?:\.[a-z0-9-]+)+)['"]/gi)].map(x => x[1]).filter(h => /\.(com|cn|net|org|fr)$/i.test(h));
verifier('aucun nom d\'hôte écrit dans le code exécutable', hotes, []);
const num = nom => { const r = new RegExp(`var ${nom} = ([^;]+);`).exec(code); return r ? Function(`return (${r[1]})`)() : null; };
verifier('HTML_MAX du script ≤ celui du récepteur', num('HTML_MAX') <= R.HTML_MAX && num('HTML_MAX') > 0, true);
const interdits = [
    ['location.href =', /location\s*\.\s*href\s*=[^=]/], ['location.assign/replace', /location\s*\.\s*(assign|replace)\s*\(/], ['location = ', /\blocation\s*=[^=]/],
    ['.click()', /\.\s*click\s*\(/], ['window.open', /window\s*\.\s*open\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['fetch', /\bfetch\s*\(/], ['sendBeacon', /sendBeacon/],
    ['cookie (document.cookie, GM_cookie, en-tête)', /cookie/i], ['localStorage/sessionStorage/indexedDB', /localStorage|sessionStorage|indexedDB/], ['GM_getValue/GM_setValue/GM_openInTab/GM_download', /GM_(getValue|setValue|cookie|openInTab|download)/],
    ['new Image / WebSocket / EventSource', /new\s+(Image|WebSocket|EventSource)\b/], ['dispatchEvent', /dispatchEvent/], ['canvas / toDataURL (aucune image lue)', /canvas|toDataURL|drawImage/i],
    ['insertAdjacentHTML / document.write / outerHTML =', /insertAdjacentHTML|document\s*\.\s*write\s*\(|outerHTML\s*=[^=]/],
    ['setTimeout / setInterval (aucune action différée ni répétée)', /\bset(Timeout|Interval)\s*\(/], ['MutationObserver / IntersectionObserver', /(Mutation|Intersection)Observer/], ['eval / Function', /\beval\s*\(|new\s+Function\b/],
    ['AUCUN DÉFILEMENT', /\bscroll(To|By|IntoView|Top)?\s*[(=]|requestAnimationFrame|\.focus\s*\(/],
    ['forcer le chargement paresseux', /\.\s*loading\s*=|setAttribute\s*\(\s*['"]loading/], ['changer le src d\'une image de la page', /\.\s*src\s*=[^=]|setAttribute\s*\(\s*['"]src/]
];
for (const [nom, re] of interdits) verifier(`interdit absent : ${nom}`, re.test(sansCommentaires), false);
verifier('GM_xmlhttpRequest est appelé UNE seule fois (poster, vers le récepteur)', (sansCommentaires.match(/GM_xmlhttpRequest\s*\(/g) || []).length, 1);
verifier('redirections refusées sur le POST local', /redirect: 'error'/.test(sansCommentaires), true);
verifier('deux addEventListener : le clic et rien d\'autre qu\'un rafraîchissement local', (sansCommentaires.match(/addEventListener\s*\(/g) || []).length <= 2, true);
verifier('innerHTML : une seule affectation, sur panneau', [(sansCommentaires.match(/innerHTML/g) || []).length, /(?<![\w$.])panneau\s*\.\s*innerHTML\s*=(?!=)/.test(sansCommentaires)], [1, true]);

// ── COMPORTEMENT, dans un bac vm, sur un DOM fabriqué
const el = (o = {}) => ({
    textContent: '', alt: '', src: '', currentSrc: '', style: {}, children: [], ecouteurs: {}, sel: {}, selAll: {}, outerHTML: '', innerHTML: '',
    addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; }, setAttribute() { },
    querySelector(s) { if (/^#rm-[a-z]+$/.test(s)) { this._ids = this._ids || {}; return this._ids[s] || (this._ids[s] = el()); } return this.sel[s] || null; },
    querySelectorAll(s) { return this.selAll[s] || []; }, closest(s) { return this._conteneur && /a|li|article/.test(s) ? this._conteneur : null; },
    ...o
});
const SEL = { nom: 'h1, h2, h3, h4, h5, h6, [class*="name"]' };
const SEL_PAGINATION = '#cards-load-more, [class*="pagination"], nav[aria-label*="agination"]';
const SEL_CASES = 'input[type="checkbox"][name]';
const CHEMIN_SERIE = '/us/pokemon-tcg/pokemon-cards/series';
// une carte du DOM fabriqué : le conteneur (le lien <a>) porte son href, l'image son nom de fichier ; `lien: null` = pas de lien
const cartePage = (n, { nom = `Carte ${n}`, code = 'sm2', numero = String(n), lien = `${CHEMIN_SERIE}/${code}/${numero}/`, src = `https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/${code.toUpperCase()}/${code.toUpperCase()}_EN_${numero}.png`, alt = nom } = {}) => {
    const conteneur = el({ textContent: nom, href: lien || '', sel: { [SEL.nom]: nom ? el({ textContent: ` ${nom}\n` }) : null } });
    return el({ alt, src, currentSrc: src, _conteneur: conteneur });
};
const caseForm = (name, libelle, { id = '', checked = false, dansLabel = false } = {}) => el({ name, id, checked, _libelle: libelle, closest(s) { return dansLabel && s === 'label' ? el({ textContent: ` ${libelle}\n` }) : null; } });
function fabriquerMonde({ sansZone = false, bodyHtml = '<body>CORPS-ENTIER</body>', cartes = [cartePage(1), cartePage(2), cartePage(3)], reponse = { status: 200, responseText: JSON.stringify({ ok: true, fichier: 'page--x.json', diagnostic: { cartes: 3, annonce: 3, complet: true, sansNumero: 0, sansImage: 0 } }) }, erreur = null, zoneHtml = '<div class="results">3 cartes</div>', compteur = '3 cards', pathname = '/us/pokemon-tcg/pokemon-cards/', paginationTexte = ' Page 1 of 1 \n Next ', cases = [], libelles = {}, selectsPage = null, dansZone = [] } = {}) {
    const appels = [], acces = { cookie: 0 };
    const zone = el({ outerHTML: zoneHtml, selAll: { img: cartes }, contains(e) { return dansZone.includes(e); } });
    const docRacine = el({ title: 'Pokémon Cards | Pokemon.com', body: el({ textContent: `Search ${compteur} found`, outerHTML: bodyHtml }) });
    docRacine.documentElement = { outerHTML: '<html>NE-DOIT-JAMAIS-PARTIR</html>' };
    Object.defineProperty(docRacine, 'cookie', { get() { acces.cookie++; return 'secret=1'; } });
    const selecteurs = {};
    const zoneSel = ['[class*="card-results"]', '[class*="results"]', 'main'];
    docRacine.querySelector = s => {
        if (!sansZone && s === zoneSel[0]) return zone;
        if (s === SEL_PAGINATION) return paginationTexte === null ? null : el({ textContent: paginationTexte });
        const lab = /^label\[for="([A-Za-z0-9_-]+)"\]$/.exec(s);
        if (lab && libelles[lab[1]] !== undefined) return el({ textContent: libelles[lab[1]] });
        return null;
    };
    docRacine.querySelectorAll = s => {
        if (s === SEL_CASES) return cases;
        if (s === 'select') return selectsPage || [{ name: 'sort', options: [{ textContent: 'All' }, { textContent: ' Guardians Rising ' }], selectedIndex: 1 }];
        if (s === '[class*="count"], [class*="total"], [class*="result"]') return [el({ textContent: compteur })];
        if (s === '[aria-pressed="true"], [aria-selected="true"], [class*="selected"]') return [el({ textContent: 'Unlimited' })];
        return [];
    };
    const location = { href: 'https://www.pokemon.com' + pathname + '?expansion=guardians-rising', origin: 'https://www.pokemon.com', pathname, search: '?expansion=guardians-rising', hash: '' };
    const GM_xmlhttpRequest = o => { appels.push(o); setTimeout(() => { if (erreur) return o.onerror?.({ error: erreur }); return o.onload?.(typeof reponse === 'function' ? reponse(o.data) : reponse); }, 0); };
    const elements = [];
    const creer = tag => { const e = el({ tag }); elements.push(e); return e; };
    docRacine.createElement = creer;
    docRacine.body.appendChild = c => c;
    const bac = { document: docRacine, location, GM_xmlhttpRequest, window: { location, document: docRacine }, console, JSON, Date, String, Number, Math, Array, Object, URL, RegExp };
    bac.window.window = bac.window;
    return { bac, appels, acces, elements, docRacine };
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
const lancer = w => vm.runInNewContext(SRC, w.bac, { filename: 'userscript-pokemoncom.js' });
const texte = w => w.elements.map(e => e.textContent).join(' | ') + ' | ' + w.elements.flatMap(e => Object.values(e._ids || {})).map(e => e.textContent).join(' | ');
const bouton = w => { const tous = [w.docRacine, ...w.elements]; for (const e of tous) for (const c of Object.values(e._ids || {})) if (c.ecouteurs.click) return c; return null; };
const cliquer = w => bouton(w).ecouteurs.click({});

(async () => {
    let w = fabriquerMonde();
    lancer(w);
    verifier('au chargement : un bouton, et AUCUNE requête', [!!bouton(w), w.appels.length], [true, 0]);
    await attendre(30);
    verifier('… toujours aucune requête après attente', w.appels.length, 0);
    cliquer(w);
    await attendre(40);
    verifier('au clic : UNE requête, POST vers http://127.0.0.1:<port>/releve', [w.appels.length, w.appels[0]?.method, /^http:\/\/127\.0\.0\.1:\d{4,5}\/releve$/.test(w.appels[0]?.url || '')], [1, 'POST', true]);
    const a = w.appels[0] || {};
    const corps = JSON.parse(a.data || '{}');
    verifier('corps : exactement les clés du schéma 2 du récepteur', Object.keys(corps).sort(), ['cartes', 'compteur', 'extensions', 'filtre', 'html', 'htmlTronque', 'pagination', 'schema', 'selects', 'titre', 'url', 'zoneRepli']);
    verifier('corps : schema 2', corps.schema, 2);
    verifier('zone trouvée : zoneRepli = false', corps.zoneRepli, false);
    verifier('url : adresse de la page (origine + chemin + requête, sans ancre) ; titre ; compteur ; pagination normalisée', [corps.url, corps.titre, corps.compteur, corps.pagination], ['https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/?expansion=guardians-rising', 'Pokémon Cards | Pokemon.com', '3 cards', 'Page 1 of 1 Next']);
    verifier('filtre : l\'extension affichée dans le sélecteur', corps.filtre.includes('Guardians Rising'), true);
    verifier('cartes : nom (espaces normalisés), numéro et set tirés du lien (témoin : l\'image), adresse de l\'image, alt', corps.cartes, [1, 2, 3].map(n => ({ nom: `Carte ${n}`, numero: String(n), numeroDoute: false, set: 'sm2', img: `https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_${n}.png`, alt: `Carte ${n}` })));
    verifier('html : l\'outerHTML de la zone des résultats (jamais le document entier), non tronqué', [corps.html, corps.htmlTronque], ['<div class="results">3 cartes</div>', false]);
    verifier('le document entier ne part jamais', a.data.includes('NE-DOIT-JAMAIS-PARTIR'), false);
    verifier('le corps passe la validation de schéma du récepteur', R.validerReleve(corps).ok, true);
    verifier('en-têtes : Content-Type JSON et l\'en-tête fixe, rien d\'autre', [Object.keys(a.headers || {}).sort(), a.headers?.['X-Rat-Market']], [['Content-Type', 'X-Rat-Market'], R.VALEUR_MARQUE]);
    verifier('aucun accès aux cookies : document.cookie n\'a jamais été lu, requête anonyme sans identifiants', [w.acces.cookie, a.anonymous === true, a.withCredentials === undefined || a.withCredentials === false], [0, true, true]);
    verifier('le panneau dit ce qui a été relevé : 3 cartes, compteur « 3 cards », pas d\'avertissement', [/3 cartes/.test(texte(w)), /3 cards/.test(texte(w)), /incomplète/i.test(texte(w))], [true, true, false]);

    // page incomplète : le récepteur le dit → avertissement
    w = fabriquerMonde({ compteur: '197 cards', reponse: { status: 200, responseText: JSON.stringify({ ok: true, fichier: 'x', diagnostic: { cartes: 3, annonce: 197, complet: false, etat: 'incomplet', pagine: false, sansNumero: 0, sansImage: 0 } }) } });
    lancer(w); cliquer(w); await attendre(40);
    verifier('compteur > cartes vues SANS pagination (etat incomplet) : « page incomplète » est affiché avec les deux nombres', [/page incomplète/i.test(texte(w)), /197/.test(texte(w)), /3 cartes/.test(texte(w))], [true, true, true]);
    w = fabriquerMonde({ compteur: '197 cards', reponse: { status: 200, responseText: JSON.stringify({ ok: true, fichier: 'x', diagnostic: { cartes: 3, annonce: 197, complet: null, etat: 'pagine', pagine: true, sansNumero: 0, sansImage: 0 } }) } });
    lancer(w); cliquer(w); await attendre(40);
    verifier('page PAGINÉE (etat pagine) : jamais « incomplète » ; « compteur = total (197) ; cette page montre 3 cartes — normal si paginé : relève chaque page »', [/incomplète/i.test(texte(w)), /compteur = total \(197\) ; cette page montre 3 cartes — normal si paginé : relève chaque page/.test(texte(w))], [false, true]);
    w = fabriquerMonde({ reponse: { status: 200, responseText: JSON.stringify({ ok: true, fichier: 'x', diagnostic: { cartes: 3, annonce: null, complet: null, etat: 'compteur-non-lu', pagine: true, sansNumero: 0, sansImage: 0 } }) } });
    lancer(w); cliquer(w); await attendre(40);
    verifier('compteur illisible : le panneau dit « compteur non lu » (pas « complet »)', [/compteur non lu/i.test(texte(w)), /✅ page complète/i.test(texte(w))], [true, false]);

    // html borné
    w = fabriquerMonde({ zoneHtml: '<div>' + 'x'.repeat(R.HTML_MAX + 5000) + '</div>' });
    lancer(w); cliquer(w); await attendre(40);
    const gros = JSON.parse(w.appels[0].data);
    verifier('html au-delà de la borne : tronqué à HTML_MAX, htmlTronque = true', [gros.html.length <= R.HTML_MAX, gros.htmlTronque], [true, true]);
    w = fabriquerMonde({ zoneHtml: '<div>a<script>var secret="t";</script>b</div>' });
    lancer(w); cliquer(w); await attendre(40);
    verifier('les <script> de la zone sont retirés avant l\'envoi', JSON.parse(w.appels[0].data).html, '<div>ab</div>');
    for (const [nom, entree, sortie] of [
        ['</script > avec espace', '<div>a<script>x</script >b</div>', '<div>ab</div>'],
        ['majuscules', '<div>a<SCRIPT type="x">x</SCRIPT>b</div>', '<div>ab</div>'],
        ['casse mêlée et espace avant >', '<div>a<ScRiPt>x</sCrIpT\n>b</div>', '<div>ab</div>'],
        ['balise jamais refermée (tout le reste est retiré)', '<div>a<script>var s=1;</div>', '<div>a'],
        ['deux scripts', '<p>1</p><script>a</script><p>2</p><script src="x"></script ><p>3</p>', '<p>1</p><p>2</p><p>3</p>']
    ]) {
        w = fabriquerMonde({ zoneHtml: entree });
        lancer(w); cliquer(w); await attendre(40);
        verifier(`<script> retiré : ${nom}`, JSON.parse(w.appels[0].data).html, sortie);
    }

    // zone absente : repli sur document.body, MARQUÉ, et borné comme la zone
    w = fabriquerMonde({ sansZone: true });
    lancer(w); cliquer(w); await attendre(40);
    const repli = JSON.parse(w.appels[0].data);
    verifier('aucune zone trouvée : repli sur document.body, zoneRepli = true', [repli.html, repli.zoneRepli], ['<body>CORPS-ENTIER</body>', true]);
    w = fabriquerMonde({ sansZone: true, bodyHtml: '<body>' + 'y'.repeat(R.HTML_MAX + 5000) + '<script>s</script ></body>' });
    lancer(w); cliquer(w); await attendre(40);
    const repliGros = JSON.parse(w.appels[0].data);
    verifier('le repli body est borné à HTML_MAX, signalé tronqué, marqué repli', [repliGros.html.length <= R.HTML_MAX, repliGros.htmlTronque, repliGros.zoneRepli], [true, true, true]);

    // carte sans lien / sans image : relevée telle quelle (vides) + doute, jamais inventée
    w = fabriquerMonde({ cartes: [cartePage(1, { lien: null }), cartePage(2, { src: '' })] });
    lancer(w); cliquer(w); await attendre(40);
    const c2 = JSON.parse(w.appels[0].data).cartes;
    verifier('champ absent du DOM : chaîne vide + numeroDoute, rien d\'inventé', [c2[0].numero, c2[0].set, c2[0].numeroDoute, c2[1].img, c2[1].numero, c2[1].numeroDoute], ['', '', true, '', '', true]);

    // numéro et set : le lien ET le nom de fichier de l'image doivent concorder
    const lire = async cartes => { const x = fabriquerMonde({ cartes }); lancer(x); cliquer(x); await attendre(40); const co = JSON.parse(x.appels[0].data); return { cartes: co.cartes, ok: R.validerReleve(co).ok }; };
    let cx = await lire([cartePage(1, { code: 'sm2', numero: '124a' }), cartePage(2, { code: 'sv1', numero: 'SV001' }), cartePage(3, { code: 'swsh9', numero: 'TG01' })]);
    verifier('numéros « 124a », « SV001 », « TG01 » gardés tels quels (lettres et préfixes), set en minuscules du lien', [cx.cartes.map(c => c.numero), cx.cartes.map(c => c.set), cx.cartes.map(c => c.numeroDoute), cx.ok], [['124a', 'SV001', 'TG01'], ['sm2', 'sv1', 'swsh9'], [false, false, false], true]);
    cx = await lire([cartePage(1, { lien: `${CHEMIN_SERIE}/sm2/5/`, src: 'https://assets.pokemon.com/x/SM2/SM2_EN_6.png' })]);
    verifier('lien « 5 » et image « 6 » en désaccord : numero et set vides, numeroDoute', [cx.cartes[0].numero, cx.cartes[0].set, cx.cartes[0].numeroDoute, cx.ok], ['', '', true, true]);
    cx = await lire([cartePage(1, { lien: `${CHEMIN_SERIE}/sm2/5/`, src: 'https://assets.pokemon.com/x/SM3/SM3_EN_5.png' })]);
    verifier('lien « sm2 » et image « SM3 » (code différent) : doute', [cx.cartes[0].numero, cx.cartes[0].numeroDoute], ['', true]);
    cx = await lire([cartePage(1, { lien: `${CHEMIN_SERIE}/sm2/5/`, src: 'https://assets.pokemon.com/x/SM2/SM2_EN_5.PNG?v=3' })]);
    verifier('code en MAJUSCULES dans l\'image, minuscules dans le lien : concordent (casse ignorée) ; requête ignorée', [cx.cartes[0].numero, cx.cartes[0].set, cx.cartes[0].numeroDoute], ['5', 'sm2', false]);
    cx = await lire([cartePage(1, { lien: `${CHEMIN_SERIE}/sm2/5/`, src: 'https://assets.pokemon.com/x/pas-une-carte.png' })]);
    verifier('image au nom hors motif (le témoin manque) : doute', [cx.cartes[0].numero, cx.cartes[0].numeroDoute], ['', true]);
    const imgSm2 = n => `https://assets.pokemon.com/x/SM2/SM2_EN_${n}.png`;   // l'image concorde avec le numéro du lien : seul le CHEMIN du lien est en cause
    cx = await lire([cartePage(1, { lien: '/us/pokemon-tcg/pokemon-cards/series/sm2/5/extra/', src: imgSm2(5) }), cartePage(2, { lien: '/ailleurs/series/sm2/2/', src: imgSm2(2) }), cartePage(3, { lien: 'https://exemple.test/us/pokemon-tcg/pokemon-cards/series/sm2/3/', src: imgSm2(3) }), cartePage(4, { lien: `${CHEMIN_SERIE}/sm2/4/?x=1#y`, src: imgSm2(4) })]);
    verifier('motif strict ancré : segment en trop, autre chemin, autre origine -> doute ; requête et ancre ignorées -> concordent', cx.cartes.map(c => [c.numero, c.numeroDoute]), [['', true], ['', true], ['', true], ['4', false]]);

    // la pagination réelle, le formulaire : sur le VRAI relevé (fixture)
    const FIX = require('./fixture-pokemoncom-reel');
    const cartesFixture = [...FIX.html.matchAll(/<a href="([^"]+)">[\s\S]*?<img src="([^"]+)" alt="([^"]*)">/g)].map(x => el({ alt: x[3], src: x[2], currentSrc: x[2], _conteneur: el({ textContent: x[3], href: x[1], sel: { [SEL.nom]: null } }) }));
    verifier('fixture : 12 cartes lues dans le HTML réel', cartesFixture.length, 12);
    const texteLoadMore = ' Previous Results 1 of 15 Next Results ';
    verifier('fixture : le HTML réel porte « 1 of 15 »', FIX.html.includes('<span>1 of 15</span>'), true);
    w = fabriquerMonde({
        cartes: cartesFixture, zoneHtml: FIX.html, compteur: '', paginationTexte: texteLoadMore,
        cases: [caseForm('sm1', 'Sun & Moon', { id: 'sm1', checked: false }), caseForm('sm2', 'ignoré', { id: 'sm2', checked: true }), caseForm('sm3', 'Burning Shadows', { dansLabel: true }), caseForm('sm9', 'dans les résultats', { id: 'sm9' })],
        libelles: { sm1: ' Sun & Moon\n', sm2: 'Guardians Rising' }, dansZone: [],
        selectsPage: [{ name: 'sort', options: [{ textContent: 'Card Number' }, { textContent: 'Card Name' }], selectedIndex: 0 }, { id: 'autre', options: [{ textContent: 'A' }] }],
        reponse: data => { const j = R.jugerReleve(data); return { status: j.statut, responseText: JSON.stringify(j.statut === 200 ? { ok: true, fichier: 'x', diagnostic: j.diagnostic } : j.corps) }; }
    });
    lancer(w); cliquer(w); await attendre(60);
    const cr = JSON.parse(w.appels[0].data);
    verifier('relevé réel : pagination envoyée telle qu\'affichée (normalisée), aucun compteur', [cr.pagination, cr.compteur], ['Previous Results 1 of 15 Next Results', '']);
    verifier('relevé réel : 12 cartes, numéros 1…12 sans doute, set sm2', [cr.cartes.map(c => c.numero), [...new Set(cr.cartes.map(c => c.set))], cr.cartes.filter(c => c.numeroDoute).length], [['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], ['sm2'], 0]);
    verifier('relevé réel : le corps passe la validation du récepteur', R.validerReleve(cr).ok, true);
    const dr = R.validerReleve(cr).ok ? R.diagnostiquer(cr) : {};
    verifier('relevé réel : diagnostic page 1 sur 15, complète', [dr.pageCourante, dr.pagesTotal, dr.etat, dr.complet], [1, 15, 'complet', true]);
    verifier('le panneau dit « page 1 sur 15 », « page complète » et « ouvre la page suivante toi-même », jamais « compteur non lu »', [/page 1 sur 15/.test(texte(w)), /page complète/.test(texte(w)), /ouvre la page suivante toi-même/i.test(texte(w)), /compteur non lu/i.test(texte(w))], [true, true, true, false]);
    verifier('extensions : cases nommées hors zone, libellé par label[for] ou label englobant, cochee', cr.extensions, [{ case: 'sm1', libelle: 'Sun & Moon', cochee: false }, { case: 'sm2', libelle: 'Guardians Rising', cochee: true }, { case: 'sm3', libelle: 'Burning Shadows', cochee: false }, { case: 'sm9', libelle: '', cochee: false }]);
    verifier('selects : nom (name ou id) et textes des options', cr.selects, [{ nom: 'sort', options: ['Card Number', 'Card Name'] }, { nom: 'autre', options: ['A'] }]);

    // une case DANS la zone des résultats n'est pas une extension du formulaire
    const caseDedans = caseForm('dedans', 'x');
    w = fabriquerMonde({ cases: [caseDedans, caseForm('hors', 'y')], dansZone: [caseDedans] });
    lancer(w); cliquer(w); await attendre(40);
    verifier('case contenue dans la zone des résultats : exclue ; case hors zone : gardée', JSON.parse(w.appels[0].data).extensions.map(e => e.case), ['hors']);

    // bornes : 500 cases, 200 caractères par libellé ; 30 select, 100 options
    w = fabriquerMonde({ cases: Array.from({ length: 520 }, (_, i) => caseForm(`c${i}`, 'x'.repeat(250), { dansLabel: true })), selectsPage: Array.from({ length: 35 }, () => ({ name: 's', options: Array.from({ length: 130 }, () => ({ textContent: 'o'.repeat(250) })), selectedIndex: 0 })) });
    lancer(w); cliquer(w); await attendre(60);
    const gr = JSON.parse(w.appels[0].data);
    verifier('bornes : 500 extensions, libellés à 200 ; 30 select, 100 options à 200', [gr.extensions.length, gr.extensions[0].libelle.length, gr.selects.length, gr.selects[0].options.length, gr.selects[0].options[0].length], [500, 200, 30, 100, 200]);
    verifier('… et le corps borné passe la validation du récepteur', R.validerReleve(gr).ok, true);

    // pagination : l'ancien sélecteur reste en repli (le mock ne répond qu'à la liste complète des sélecteurs) ; absente -> chaîne vide
    w = fabriquerMonde({ paginationTexte: null });
    lancer(w); cliquer(w); await attendre(40);
    verifier('aucune pagination dans la page : chaîne vide envoyée', JSON.parse(w.appels[0].data).pagination, '');
    // panneau, page incomplète et dernière page
    const rep = diagnostic => ({ status: 200, responseText: JSON.stringify({ ok: true, fichier: 'x', diagnostic }) });
    w = fabriquerMonde({ reponse: rep({ cartes: 7, annonce: null, complet: false, etat: 'incomplet', pageCourante: 3, pagesTotal: 15, sansNumero: 0, sansImage: 0 }) });
    lancer(w); cliquer(w); await attendre(40);
    verifier('page 3 sur 15 incomplète : « page 3 sur 15 », « page incomplète », « ouvre la page suivante »', [/page 3 sur 15/.test(texte(w)), /page incomplète/i.test(texte(w)), /ouvre la page suivante toi-même/i.test(texte(w)), /page complète/.test(texte(w))], [true, true, true, false]);
    w = fabriquerMonde({ reponse: rep({ cartes: 1, annonce: null, complet: true, etat: 'complet', pageCourante: 15, pagesTotal: 15, sansNumero: 0, sansImage: 0 }) });
    lancer(w); cliquer(w); await attendre(40);
    verifier('dernière page 15 sur 15 complète : pas d\'invitation à ouvrir la suivante', [/page 15 sur 15/.test(texte(w)), /page complète/.test(texte(w)), /ouvre la page suivante/i.test(texte(w))], [true, true, false]);
    w = fabriquerMonde({ reponse: rep({ cartes: 12, annonce: null, complet: true, etat: 'complet', pageCourante: 1, pagesTotal: 15, numerosDoutes: 2, extensions: 40, sansNumero: 2, sansImage: 0 }) });
    lancer(w); cliquer(w); await attendre(40);
    verifier('numéros douteux et extensions relevées sont dits dans le panneau', [/2 numéro\(s\) douteux/.test(texte(w)), /40 extensions/.test(texte(w))], [true, true]);

    // refus et récepteur éteint
    w = fabriquerMonde({ reponse: { status: 422, responseText: JSON.stringify({ ok: false, motif: 'adresse refusée (test)' }) } });
    lancer(w); cliquer(w); await attendre(40);
    verifier('relevé refusé : le motif est affiché, une seule requête', [/adresse refusée \(test\)/.test(texte(w)), w.appels.length], [true, 1]);
    w = fabriquerMonde({ erreur: 'connexion refusée' });
    lancer(w); cliquer(w); await attendre(40);
    verifier('récepteur injoignable : un message qui dit de le lancer', [/récepteur/i.test(texte(w)), w.appels.length], [true, 1]);
    w = fabriquerMonde({ pathname: '/us/pokemon-tcg/' });
    lancer(w); cliquer(w); await attendre(40);
    verifier('hors de la base de cartes : rien n\'est envoyé', w.appels.length, 0);

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

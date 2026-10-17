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
verifier('@version : 1.0', valeurs('version'), ['1.0']);
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
const SEL = { nom: 'h1, h2, h3, h4, h5, h6, [class*="name"]', numero: '[class*="number"]', set: '[class*="set"], [class*="expansion"]' };
const cartePage = (n, { nom = `Carte ${n}`, numero = `${n}/145`, set = 'Guardians Rising', src = `https://assets.pokemon.com/cards/${n}.png`, alt = nom } = {}) => {
    const conteneur = el({ textContent: `${nom} ${numero} ${set}`, sel: { [SEL.nom]: nom ? el({ textContent: ` ${nom}\n` }) : null, [SEL.numero]: numero ? el({ textContent: numero }) : null, [SEL.set]: set ? el({ textContent: set }) : null } });
    const img = el({ alt, src, currentSrc: src, _conteneur: conteneur });
    return img;
};
function fabriquerMonde({ sansZone = false, bodyHtml = '<body>CORPS-ENTIER</body>', cartes = [cartePage(1), cartePage(2), cartePage(3)], reponse = { status: 200, responseText: JSON.stringify({ ok: true, fichier: 'page--x.json', diagnostic: { cartes: 3, annonce: 3, complet: true, sansNumero: 0, sansImage: 0 } }) }, erreur = null, zoneHtml = '<div class="results">3 cartes</div>', compteur = '3 cards', pathname = '/us/pokemon-tcg/pokemon-cards/' } = {}) {
    const appels = [], acces = { cookie: 0 };
    const zone = el({ outerHTML: zoneHtml, selAll: { img: cartes } });
    const docRacine = el({ title: 'Pokémon Cards | Pokemon.com', body: el({ textContent: `Search ${compteur} found`, outerHTML: bodyHtml }) });
    docRacine.documentElement = { outerHTML: '<html>NE-DOIT-JAMAIS-PARTIR</html>' };
    Object.defineProperty(docRacine, 'cookie', { get() { acces.cookie++; return 'secret=1'; } });
    const selecteurs = {};
    const zoneSel = ['[class*="card-results"]', '[class*="results"]', 'main'];
    docRacine.querySelector = s => (!sansZone && s === zoneSel[0] ? zone : s === '[class*="pagination"], nav[aria-label*="agination"]' ? el({ textContent: ' Page 1 of 1 \n Next ' }) : null);
    docRacine.querySelectorAll = s => {
        if (s === 'select') return [{ options: [{ textContent: 'All' }, { textContent: ' Guardians Rising ' }], selectedIndex: 1 }];
        if (s === '[class*="count"], [class*="total"], [class*="result"]') return [el({ textContent: compteur })];
        if (s === '[aria-pressed="true"], [aria-selected="true"], [class*="selected"]') return [el({ textContent: 'Unlimited' })];
        return [];
    };
    const location = { href: 'https://www.pokemon.com' + pathname + '?expansion=guardians-rising', origin: 'https://www.pokemon.com', pathname, search: '?expansion=guardians-rising', hash: '' };
    const GM_xmlhttpRequest = o => { appels.push(o); setTimeout(() => { if (erreur) return o.onerror?.({ error: erreur }); return o.onload?.(reponse); }, 0); };
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
    verifier('corps : exactement les clés du schéma du récepteur', Object.keys(corps).sort(), ['cartes', 'compteur', 'filtre', 'html', 'htmlTronque', 'pagination', 'schema', 'titre', 'url', 'zoneRepli']);
    verifier('zone trouvée : zoneRepli = false', corps.zoneRepli, false);
    verifier('url : adresse de la page (origine + chemin + requête, sans ancre) ; titre ; compteur ; pagination normalisée', [corps.url, corps.titre, corps.compteur, corps.pagination], ['https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/?expansion=guardians-rising', 'Pokémon Cards | Pokemon.com', '3 cards', 'Page 1 of 1 Next']);
    verifier('filtre : l\'extension affichée dans le sélecteur', corps.filtre.includes('Guardians Rising'), true);
    verifier('cartes : nom (espaces normalisés), numéro, set, adresse de l\'image, alt', corps.cartes, [1, 2, 3].map(n => ({ nom: `Carte ${n}`, numero: `${n}/145`, set: 'Guardians Rising', img: `https://assets.pokemon.com/cards/${n}.png`, alt: `Carte ${n}` })));
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

    // carte sans numéro / image : relevée telle quelle (vides), jamais inventée
    w = fabriquerMonde({ cartes: [cartePage(1, { numero: '' , set: '' }), cartePage(2, { src: '' })] });
    lancer(w); cliquer(w); await attendre(40);
    const c2 = JSON.parse(w.appels[0].data).cartes;
    verifier('champ absent du DOM : chaîne vide, rien d\'inventé', [c2[0].numero, c2[0].set, c2[1].img], ['', '', '']);

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

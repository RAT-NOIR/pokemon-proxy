// node test-userscript-pikaqian.js — le userscript PASSIF de PikaQian (userscript-pikaqian.js, v2.0) : test STATIQUE (aucune adresse hors 127.0.0.1, un seul hôte d'images,
// aucune navigation ni défilement ni minuterie, un seul fetch) et test de COMPORTEMENT dans un bac `vm` (faux document, faux GM_xmlhttpRequest, faux fetch : aucune requête réelle).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('./collecte-cartes/pikaqian');
const R = require('./recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// PK_USERSCRIPT (rouge-userscript-pikaqian.js) : un script MUTANT à tester à la place du vrai
const SRC = fs.readFileSync(process.env.PK_USERSCRIPT ? path.resolve(process.env.PK_USERSCRIPT) : path.join(__dirname, 'userscript-pikaqian.js'), 'utf8');
const m = /^\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/.exec(SRC);
verifier('l\'en-tête ==UserScript== existe', !!m, true);
const entete = m ? m[1] : '';
const valeurs = cle => [...entete.matchAll(new RegExp(`^//\\s*@${cle}\\s+(.+?)\\s*$`, 'gm'))].map(x => x[1]);
const code = SRC.slice(m ? m[0].length : 0);
// le code SANS ses commentaires : une adresse dans un commentaire n'est pas une requête, mais le test doit regarder ce qui s'exécute
const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

// ── STATIQUE
verifier('@match : les pages de set de pikaqian.com, rien d\'autre', valeurs('match'), ['https://pikaqian.com/sets/*']);
verifier('@grant : GM_xmlhttpRequest seulement (ni cookie, ni stockage, ni GM_openInTab)', valeurs('grant'), ['GM_xmlhttpRequest']);
verifier('@connect : 127.0.0.1 ET l\'hôte des images, rien d\'autre', valeurs('connect'), ['127.0.0.1', P.HOTE_IMAGES]);
const adresses = [...sansCommentaires.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*/gi)].map(x => x[0]);
verifier('dans le code : toute adresse écrite est http://127.0.0.1:<port> (le port vient de la constante PORT)', adresses.every(a => /^http:\/\/127\.0\.0\.1:$/.test(a)) && adresses.length >= 2, true);
const PORT_US = /^\s*var PORT = (\d{4,5});/m.exec(code);
verifier('PORT : une constante unique en tête du script, égale au port par défaut du récepteur', [!!PORT_US, Number(PORT_US?.[1]) === R.PORT_DEFAUT, (code.match(/\bPORT\b/g) || []).length >= 3, sansCommentaires.indexOf('var PORT') < sansCommentaires.indexOf('GM_xmlhttpRequest')], [true, true, true, true]);
const CODE_US = /var CODE_DE_SET = '([^']+)';/.exec(code);
verifier('le motif de code de set du script est celui de CODE_PK (pikaqian.js)', `^${CODE_US?.[1]}$`, P.CODE_PK.source);
const ENTETE_US = /'X-Rat-Market':\s*'([^']+)'/.exec(code);
verifier('l\'en-tête fixe du script est celui que le récepteur exige', [R.ENTETE_MARQUE, ENTETE_US?.[1]], ['x-rat-market', R.VALEUR_MARQUE]);
verifier('le script ne pose PAS d\'en-tête Origin (la garde n\'en dépend pas)', /['"]Origin['"]/i.test(sansCommentaires), false);
// le SEUL nom d'hôte du code exécutable est celui des images, une fois ; le CDN officiel, localhost et le site lui-même n'y figurent pas
const hotes = [...sansCommentaires.matchAll(/['"]([a-z0-9-]+(?:\.[a-z0-9-]+)+)['"]/gi)].map(x => x[1]).filter(h => /\.(com|cn|net|org|fr)$/i.test(h));
verifier('hôtes écrits dans le code : exactement HOTE_IMAGES (celui de pikaqian.js), une fois', hotes, [P.HOTE_IMAGES]);
verifier('HOTE_IMAGES du script = celui de pikaqian.js ; aucun pokemon-tcg / pokemon.cn / localhost dans le code', [/var HOTE_IMAGES = '([^']+)'/.exec(code)?.[1], /pokemon-tcg|pokemon\.cn|localhost/i.test(sansCommentaires)], [P.HOTE_IMAGES, false]);
const num = (nom) => { const r = new RegExp(`var ${nom} = ([^;]+);`).exec(code); return r ? Function(`return (${r[1]})`)() : null; };
verifier('plafonds : IMAGE_MAX_OCTETS = celui de pikaqian.js, lot d\'images et de base64 sous ceux du récepteur', [num('IMAGE_MAX_OCTETS') === P.IMAGE_MAX_OCTETS, num('LOT_IMAGES_MAX') <= R.IMAGES_PAR_LOT_MAX, num('LOT_B64_MAX') * 3 / 4 <= R.LOT_OCTETS_MAX], [true, true, true]);
const interdits = [
    ['location.href =', /location\s*\.\s*href\s*=[^=]/], ['location.assign/replace', /location\s*\.\s*(assign|replace)\s*\(/], ['location = ', /\blocation\s*=[^=]/],
    ['.click()', /\.\s*click\s*\(/], ['window.open', /window\s*\.\s*open\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['sendBeacon', /sendBeacon/],
    ['document.cookie', /document\s*\.\s*cookie/], ['localStorage/sessionStorage/indexedDB', /localStorage|sessionStorage|indexedDB/], ['GM_getValue/GM_setValue/GM_cookie', /GM_(getValue|setValue|cookie|openInTab|download)/],
    ['new Image / new WebSocket / EventSource', /new\s+(Image|WebSocket|EventSource)\b/], ['dispatchEvent dans la page', /dispatchEvent/], ['innerHTML (injection)', /\.\s*innerHTML\s*=/],
    ['setInterval (aucune action répétée ; setTimeout n\'existe que dans pause(), vérifié plus bas)', /\bsetInterval\s*\(/], ['MutationObserver / IntersectionObserver', /(Mutation|Intersection)Observer/], ['eval / Function', /\beval\s*\(|new\s+Function\b/],
    ['AUCUN DÉFILEMENT : scroll / scrollTo / scrollBy / scrollIntoView / requestAnimationFrame', /\bscroll(To|By|IntoView|Top)?\s*[(=]|requestAnimationFrame|\.focus\s*\(/],
    ['forcer le chargement paresseux (loading = eager, lazy)', /\.\s*loading\s*=|setAttribute\s*\(\s*['"]loading/], ['changer le src d\'une image de la page', /\.\s*src\s*=[^=]|setAttribute\s*\(\s*['"]src/]
];
for (const [nom, re] of interdits) verifier(`interdit absent : ${nom}`, re.test(sansCommentaires), false);
verifier('GM_xmlhttpRequest est appelé DEUX fois dans le code : le récepteur local (poster) et l\'image de la tuile (depuisLeNavigateur)', (sansCommentaires.match(/GM_xmlhttpRequest\s*\(/g) || []).length, 2);
verifier('fetch est appelé UNE seule fois, en lecture du cache de la page : GET, force-cache, sans identifiants, sans redirection', [(sansCommentaires.match(/\bfetch\s*\(/g) || []).length, /fetch\(src, \{ method: 'GET', mode: 'cors', cache: 'force-cache', credentials: 'omit', redirect: 'error' \}\)/.test(sansCommentaires)], [1, true]);
verifier('setTimeout : UNE seule fois, dans pause() (la cadence, attendue dans le flux du clic) ; la cadence est de 500 ms au moins', [(sansCommentaires.match(/\bsetTimeout\s*\(/g) || []).length, /function pause\(ms\) \{ return new Promise\(function \(resoudre\) \{ setTimeout\(resoudre, ms\); \}\); \}/.test(sansCommentaires), num('PAUSE_MS') >= 500], [1, true, true]);
verifier('redirections refusées : redirect \'error\' sur le POST local, sur la lecture GM de l\'image et sur le fetch', (sansCommentaires.match(/redirect: 'error'/g) || []).length, 3);
verifier('deux addEventListener : le clic et le survol du panneau (qui ne fait que rafraîchir l\'annonce, sans requête) ; apprendre() n\'est appelée que depuis le clic', [(sansCommentaires.match(/addEventListener\s*\(/g) || []).length, (sansCommentaires.match(/(?<!function\s)\bapprendre\s*\(\s*\)/g) || []).length, (() => {
    const i = sansCommentaires.search(/addEventListener\(\s*'click'/);
    let debut = sansCommentaires.indexOf('{', i), prof = 0, fin = -1;
    for (let k = debut; k < sansCommentaires.length; k++) { if (sansCommentaires[k] === '{') prof++; else if (sansCommentaires[k] === '}' && --prof === 0) { fin = k; break; } }
    const appel = sansCommentaires.indexOf('apprendre()', debut);
    return appel > debut && appel < fin;
})()], [2, 1, true]);
verifier('la page part telle quelle : poster(RECEPTEUR, { url: url, html: html }) — rien d\'autre (ni cookie ni en-tête du site)', /poster\(RECEPTEUR,\s*\{\s*url:\s*url,\s*html:\s*html\s*\}\)/.test(sansCommentaires), true);
verifier('un lot d\'images ne porte que fichier, images et sansImage ; chaque image id, src, nom, numero, voie, b64', [/\{\s*fichier:\s*j\.fichier,\s*images:\s*lot,\s*sansImage:\s*sansImage\s*\}/.test(sansCommentaires), /lot\.push\(\{\s*id:\s*t\.id,\s*src:\s*t\.src,\s*nom:\s*t\.nom,\s*numero:\s*t\.numero,\s*voie:\s*lue\.voie,\s*b64:\s*lue\.b64\s*\}\)/.test(sansCommentaires)], [true, true]);

// ── COMPORTEMENT, dans un bac vm
/**
 * Un monde fabriqué. `tuiles` : [{ id, nom, numero, src, chargee, canvas: 'ok'|'taché', fetch: 'ok'|'refus', gm: 'ok'|'echec' }] ; rien de réel : GM_xmlhttpRequest, fetch et canvas sont des faux qui enregistrent.
 */
function fabriquerMonde({ reponse = { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', tuilesLues: 315, tuilesAuCode: 315, officielles: 1, natives: 1, fichier: 'cs1bc--x.json' }) }, erreur = null, tuiles = [], reponseImages = null } = {}) {
    const elements = [], appels = [], fetches = [], defilements = [], snaps = [], imgs = new Map();
    const el = tag => { const e = { tag, style: {}, children: [], ecouteurs: {}, textContent: '', addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; }, setAttribute() { } }; elements.push(e); return e; };
    const parSrc = new Map(tuiles.map(t => [t.src, t]));
    const ancres = tuiles.map(t => {
        const img = { complete: t.chargee !== false, naturalWidth: t.chargee === false ? 0 : 300, naturalHeight: 416, currentSrc: t.src, src: t.src, _t: t };
        imgs.set(t.id, img);
        return {
            getAttribute: n => (n === 'href' ? `/cards/${t.id}` : null),
            querySelector: s => (s === 'img' ? img : s === 'h2' ? { textContent: `  ${t.nom}\n` } : s === 'p' ? { textContent: `cs1bc · ${t.numero} ` } : null)
        };
    });
    const canvasFaux = () => { const c = { width: 0, height: 0, _img: null, getContext: () => ({ drawImage: i => { c._img = i; } }), toDataURL: () => { if (c._img?._t?.canvas !== 'ok') throw new Error('SecurityError: canvas taché'); return 'data:image/png;base64,Q0FOVkFT'; } }; return c; };
    const document = { body: el('body'), documentElement: { outerHTML: '<html><body>PAGE-DU-NAVIGATEUR</body></html>' }, createElement: tag => (tag === 'canvas' ? canvasFaux() : el(tag)), querySelector: () => null, querySelectorAll: s => (s === 'a[href^="/cards/"]' ? ancres : []) };
    const location = { href: 'https://pikaqian.com/sets/cs1bc?x=1#h', origin: 'https://pikaqian.com', pathname: '/sets/cs1bc', search: '?x=1', hash: '#h' };
    const GM_xmlhttpRequest = o => {
        appels.push(o);
        snaps.push(elements.map(e => e.textContent).join(' | '));      // ce que le panneau DISAIT au moment de la requête
        setTimeout(() => {
            if (erreur && /^http:\/\/127\.0\.0\.1/.test(o.url)) return o.onerror?.({ error: erreur });
            if (/\/apprendre$/.test(o.url)) return o.onload?.(reponse);
            if (/\/images$/.test(o.url)) {
                const corps = JSON.parse(o.data);
                return o.onload?.(reponseImages ? reponseImages(corps) : { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', recues: corps.images.length, nouvelles: corps.images.length, deja: 0, refusees: [] }) });
            }
            const t = parSrc.get(o.url);
            const finalUrl = t && 'gmFinal' in t ? t.gmFinal : o.url;      // l'URL finale rendue par le gestionnaire (`undefined` = illisible)
            if (t?.gmStatut) return o.onload?.({ status: t.gmStatut, response: new ArrayBuffer(0), finalUrl });       // 403, 429, 503, 404… : une réponse HTTP sans image
            if (t && t.gm !== 'echec') return o.onload?.({ status: 200, response: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, finalUrl });
            return o.onerror?.({});
        }, 0);
    };
    const fetchFaux = (url, opts) => {
        fetches.push({ url, opts }); const t = parSrc.get(url);
        const urlRep = t && 'fetchFinal' in t ? t.fetchFinal : url;
        if (t?.fetchStatut) return Promise.resolve({ ok: false, status: t.fetchStatut, url: urlRep });
        return t && t.fetch === 'ok' ? Promise.resolve({ ok: true, status: 200, url: urlRep, arrayBuffer: () => Promise.resolve(new Uint8Array([9, 9, 9, 9]).buffer) }) : Promise.reject(new TypeError('Failed to fetch (CORS)'));
    };
    // la cadence : le faux setTimeout du script ENREGISTRE chaque attente et rend la main aussitôt (le banc ne dort pas)
    const pauses = [];
    const setTimeoutScript = (f, ms) => { pauses.push(ms); Promise.resolve().then(f); };
    const bac = { document, location, GM_xmlhttpRequest, fetch: fetchFaux, btoa, URL, Uint8Array, ArrayBuffer, window: { location, document }, console, JSON, setTimeout: setTimeoutScript, Date, String, Number, Math };
    bac.window.window = bac.window;
    return { bac, elements, appels, fetches, defilements, pauses, snaps, imgs };
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
const texte = w => w.elements.map(e => e.textContent).join(' | ');
const hotesDes = appels => appels.map(a => new URL(a.url).host);

(async () => {
    let w = fabriquerMonde();
    vm.runInNewContext(SRC, w.bac, { filename: 'userscript-pikaqian.js' });
    const bouton = w.elements.find(e => e.ecouteurs.click);
    verifier('au chargement : un bouton, et AUCUNE requête (ni GM_xmlhttpRequest ni fetch)', [!!bouton, w.appels.length, w.fetches.length], [true, 0, 0]);
    verifier('le bouton s\'appelle « Apprendre cette page »', /Apprendre cette page/.test(bouton?.textContent || ''), true);
    await attendre(30);
    verifier('… toujours aucune requête après attente (rien ne part seul)', [w.appels.length, w.fetches.length], [0, 0]);
    bouton.ecouteurs.click({});
    await attendre(30);
    verifier('au clic, page sans tuile : UNE requête (la page)', w.appels.length, 1);
    const a = w.appels[0] || {};
    verifier('POST vers http://127.0.0.1:<port>/apprendre', [a.method, /^http:\/\/127\.0\.0\.1:\d{4,5}\/apprendre$/.test(a.url || '')], ['POST', true]);
    const corps = JSON.parse(a.data || '{}');
    verifier('corps : exactement url (sans requête ni ancre) et html (outerHTML tel que le navigateur l\'a)', [Object.keys(corps).sort(), corps.url, corps.html], [['html', 'url'], 'https://pikaqian.com/sets/cs1bc', '<html><body>PAGE-DU-NAVIGATEUR</body></html>']);
    verifier('en-têtes : Content-Type JSON et l\'en-tête fixe, rien d\'autre', [Object.keys(a.headers || {}).sort(), a.headers?.['Content-Type'], a.headers?.['X-Rat-Market']], [['Content-Type', 'X-Rat-Market'], 'application/json', R.VALEUR_MARQUE]);
    verifier('aucun cookie demandé (anonymous / pas de withCredentials)', [a.anonymous === true || a.anonymous === undefined, a.withCredentials === undefined || a.withCredentials === false], [true, true]);
    verifier('la réponse du récepteur s\'affiche : tuiles lues, au code du set, adresses officielles', /315/.test(texte(w)) && /officiel/i.test(texte(w)) && /1/.test(texte(w)), true);
    // l'anomalie « flux absent » est montrée au testeur
    w = fabriquerMonde({ reponse: { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', ancres: 315, tuilesLues: 315, tuilesAuCode: 315, flux: 'absent', officielles: 0, fichier: 'x.json', anomalie: 'FLUX DE DONNÉES ABSENT : test' }) } });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(30);
    verifier('flux absent : l\'anomalie est affichée', /FLUX DE DONNÉES ABSENT/.test(texte(w)), true);
    // un refus du récepteur : son motif est affiché, AUCUNE image n'est lue ni envoyée
    w = fabriquerMonde({ reponse: { status: 422, responseText: JSON.stringify({ ok: false, motif: '3 tuiles sur 9 portent le code cs1bc : la page ne désigne pas ce set' }) }, tuiles: [{ id: '00000000-0000-4000-8000-000000000001', nom: 'A', numero: '001', src: `https://${P.HOTE_IMAGES}/cs1bc/00000000-0000-4000-8000-000000000001.webp`, canvas: 'ok' }] });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(30);
    verifier('page refusée (422) : la raison est affichée, une seule requête (la page), aucune image lue', [/ne désigne pas ce set/.test(texte(w)), w.appels.length, w.fetches.length], [true, 1, 0]);
    // récepteur éteint
    w = fabriquerMonde({ erreur: 'connexion refusée' });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(30);
    verifier('récepteur injoignable : un message qui dit de le lancer, aucune autre requête', [/récepteur/i.test(texte(w)), w.appels.length], [true, 1]);
    // une page qui n'est pas /sets/<code> : le script ne l'envoie pas
    w = fabriquerMonde();
    w.bac.location.pathname = '/cards/abc'; w.bac.window.location.pathname = '/cards/abc';
    vm.runInNewContext(SRC, w.bac);
    const b2 = w.elements.find(e => e.ecouteurs.click);
    if (b2) { b2.ecouteurs.click({}); await attendre(30); }
    verifier('hors d\'une page /sets/<code> : rien n\'est envoyé', w.appels.length, 0);

    // ── LES IMAGES : les trois voies, dans l'ordre, et ce que chacune fait sur le réseau
    const H = `https://${P.HOTE_IMAGES}/cs1bc/`;
    const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    w = fabriquerMonde({ tuiles: [
        { id: ID(1), nom: 'Pikachu', numero: '001', src: `${H}${ID(1)}.webp`, canvas: 'ok' },
        { id: ID(2), nom: 'Raichu', numero: '002', src: `${H}${ID(2)}.webp`, canvas: 'taché', fetch: 'ok' },
        { id: ID(3), nom: 'Pichu', numero: '003', src: `${H}${ID(3)}.webp`, canvas: 'taché', fetch: 'refus', gm: 'ok' },
        { id: ID(4), nom: 'Pas encore', numero: '004', src: `${H}${ID(4)}.webp`, chargee: false },
        { id: ID(5), nom: 'Ailleurs', numero: '005', src: `https://exemple.test/cs1bc/${ID(5)}.webp`, canvas: 'taché', fetch: 'ok', gm: 'ok' },
        { id: ID(6), nom: 'Illisible', numero: '006', src: `${H}${ID(6)}.webp`, canvas: 'taché', fetch: 'refus', gm: 'echec' }
    ] });
    vm.runInNewContext(SRC, w.bac);
    verifier('page à 6 tuiles, avant le clic : toujours rien (ni requête ni fetch)', [w.appels.length, w.fetches.length], [0, 0]);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(120);
    const adressesRecepteur = w.appels.filter(x => /127\.0\.0\.1/.test(x.url));
    const lotsImages = adressesRecepteur.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data));
    verifier('requêtes de GM_xmlhttpRequest : la page, UN lot d\'images, et UNE seule image (celle de la tuile 3, voie navigateur + celle de la 6 qui échoue = 2) — jamais l\'hôte étranger', [hotesDes(w.appels).filter(h => !/^127\.0\.0\.1/.test(h)).sort(), w.appels.filter(x => /exemple\.test/.test(x.url)).length], [[P.HOTE_IMAGES, P.HOTE_IMAGES], 0]);
    verifier('les requêtes vers l\'hôte des images sont des GET anonymes en arraybuffer, vers l\'adresse EXACTE de la tuile', w.appels.filter(x => x.url.startsWith(H)).map(x => [x.method, x.anonymous, x.responseType, x.url.startsWith(H) && x.url.endsWith('.webp')]), [['GET', true, 'arraybuffer', true], ['GET', true, 'arraybuffer', true]]);
    verifier('fetch : appelé pour les tuiles 2, 3 et 6 (canvas échoué), jamais pour la 1 (canvas réussi), la 4 (non chargée) ni la 5 (hôte étranger) ; toujours force-cache, sans identifiants', [w.fetches.map(f => f.url.slice(-41, -5)), w.fetches.every(f => f.opts.cache === 'force-cache' && f.opts.credentials === 'omit' && f.opts.method === 'GET' && f.opts.redirect === 'error')], [[ID(2), ID(3), ID(6)], true]);
    verifier('UN lot envoyé à /images : fichier, images, sansImage = 1 (la tuile 4 non chargée) ; clés exactes', [lotsImages.length, Object.keys(lotsImages[0] || {}).sort(), lotsImages[0]?.fichier, lotsImages[0]?.sansImage, lotsImages[0]?.images.map(i => Object.keys(i).sort().join(','))], [1, ['fichier', 'images', 'sansImage'], 'cs1bc--x.json', 1, ['b64,id,nom,numero,src,voie', 'b64,id,nom,numero,src,voie', 'b64,id,nom,numero,src,voie']]);
    verifier('les trois images lues : voies canvas, cache, navigateur ; nom et numéro tels que le DOM les affiche (espaces normalisés)', lotsImages[0]?.images.map(i => [i.id.slice(-1), i.nom, i.numero, i.voie]), [['1', 'Pikachu', '001', 'canvas'], ['2', 'Raichu', '002', 'cache'], ['3', 'Pichu', '003', 'navigateur']]);
    verifier('les octets partent en base64 : le PNG du canvas, l\'arraybuffer du cache, celui du navigateur', lotsImages[0]?.images.map(i => i.b64), ['Q0FOVkFT', Buffer.from([9, 9, 9, 9]).toString('base64'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64')]);
    verifier('le panneau DIT les tuiles sans image chargée, les voies et les illisibles', [/1 SANS image chargée/.test(texte(w)), /fais défiler/.test(texte(w)), /canvas 1, cache 1, navigateur 1/.test(texte(w)), /illisibles 2/.test(texte(w))], [true, true, true, true]);
    verifier('… et le résultat du récepteur', /3 reçues par le récepteur, 0 refusée/.test(texte(w)), true);

    // ── des lots BORNÉS : 23 tuiles à canvas → 10 + 10 + 3
    w = fabriquerMonde({ tuiles: Array.from({ length: 23 }, (_, i) => ({ id: ID(i + 1), nom: `N${i}`, numero: String(i + 1).padStart(3, '0'), src: `${H}${ID(i + 1)}.webp`, canvas: 'ok' })) });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(250);
    verifier('23 images → trois lots de 10, 10 et 3, jamais plus de LOT_IMAGES_MAX ; aucun fetch (le canvas a lu)', [w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data).images.length), w.fetches.length], [[10, 10, 3], 0]);
    // des images lourdes : le lot part avant LOT_IMAGES_MAX quand LOT_B64_MAX est atteint
    const lourdes = Array.from({ length: 4 }, (_, i) => ({ id: ID(i + 1), nom: `N${i}`, numero: String(i + 1).padStart(3, '0'), src: `${H}${ID(i + 1)}.webp`, canvas: 'taché', fetch: 'ok' }));
    w = fabriquerMonde({ tuiles: lourdes });
    const grosB = new Uint8Array(900000).buffer;                       // 1,2 million de caractères base64 par image : deux images dépassent LOT_B64_MAX
    w.bac.fetch = (url, opts) => { w.fetches.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, url, arrayBuffer: () => Promise.resolve(grosB) }); };
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(400);
    verifier('images lourdes : le lot part dès LOT_B64_MAX (2 images par lot), jamais plus', w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data).images.length), [2, 2]);
    // un lot refusé par le récepteur : arrêt, aucun lot de plus, le motif est dit
    w = fabriquerMonde({ tuiles: Array.from({ length: 25 }, (_, i) => ({ id: ID(i + 1), nom: `N${i}`, numero: String(i + 1).padStart(3, '0'), src: `${H}${ID(i + 1)}.webp`, canvas: 'ok' })), reponseImages: () => ({ status: 413, responseText: JSON.stringify({ ok: false, motif: 'lot trop gros (test)' }) }) });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(200);
    verifier('un lot refusé par le récepteur : arrêt net (page + un seul lot), le motif est affiché', [w.appels.filter(x => /\/images$/.test(x.url)).length, /lot trop gros \(test\)/.test(texte(w)), /arrêt/.test(texte(w))], [1, true, true]);
    // des images refusées une à une : comptées et le premier motif est montré
    w = fabriquerMonde({ tuiles: [{ id: ID(1), nom: 'A', numero: '001', src: `${H}${ID(1)}.webp`, canvas: 'ok' }], reponseImages: () => ({ status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', recues: 0, nouvelles: 0, deja: 0, refusees: [{ id: ID(1), motif: 'octets qui ne se décodent pas en image' }] }) }) });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(100);
    verifier('une image refusée par le récepteur : le panneau le compte et cite le motif', [/0 reçues par le récepteur, 1 refusée/.test(texte(w)), /ne se décodent pas/.test(texte(w))], [true, true]);
    // aucun défilement : le monde fabriqué n'offre aucun scroll ; le script n'en cherche pas — le test statique l'interdit déjà
    verifier('le monde fabriqué n\'offre aucun scroll, et le test a tourné : aucune erreur', w.defilements.length, 0);

    // ── TOUR 1 (passe B) : l'annonce AVANT le clic, la cadence, l'arrêt au premier 403/429/5xx
    const T = (n, extra = {}) => ({ id: ID(n), nom: `N${n}`, numero: String(n).padStart(3, '0'), src: `${H}${ID(n)}.webp`, canvas: 'taché', fetch: 'refus', ...extra });
    // tout lisible au canvas : l'annonce dit 0 requête, rien n'est parti
    w = fabriquerMonde({ tuiles: [T(1, { canvas: 'ok' }), T(2, { canvas: 'ok' })] });
    vm.runInNewContext(SRC, w.bac);
    verifier('AVANT le clic, canvas lisible partout : le panneau dit « canvas », 0 requête, et rien n\'est parti', [/Voie prévue : canvas — 0 requête/.test(texte(w)), /Rien n'est envoyé avant ton clic/.test(texte(w)), w.appels.length, w.fetches.length], [true, true, 0, 0]);
    // canvas refusé : l'annonce nomme la voie et le MAXIMUM (par image et au total), la cadence et l'arrêt
    w = fabriquerMonde({ tuiles: [T(1), T(2), T(3), T(4, { chargee: false })] });
    vm.runInNewContext(SRC, w.bac);
    const annonce = texte(w);
    verifier('AVANT le clic, canvas refusé : voie « cache puis navigateur », au plus 2 requêtes par image, au plus 6 pour 3 images, 500 ms, arrêt 403/429/5xx, sans réessai', [/Voie prévue : cache puis navigateur pour 3 image/.test(annonce), /Au plus 2 requêtes par image/.test(annonce), /au plus 6 pour 3 image/.test(annonce), /au moins 500 ms/.test(annonce), /arrêt au premier 403, 429 ou 5xx, sans réessai/.test(annonce), /les 1 autres ne seront pas lues/.test(annonce)], Array(6).fill(true));
    verifier('… toujours aucune requête avant le clic', [w.appels.length, w.fetches.length, w.pauses.length], [0, 0, 0]);
    // la cadence : 3 images, cache refusé (CORS), navigateur lisible → 500 ms avant CHAQUE requête sauf la première ; la voie cache est abandonnée après 2 échecs
    w = fabriquerMonde({ tuiles: [T(1, { gm: 'ok' }), T(2, { gm: 'ok' }), T(3, { gm: 'ok' })] });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(150);
    const requetesImages = w.appels.filter(x => x.url.startsWith(H)).length + w.fetches.length;
    verifier('cadence : 5 requêtes vers l\'hôte des images (2 caches, 3 navigateurs), 4 pauses de 500 ms exactement — jamais deux requêtes sans pause', [w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length, requetesImages, w.pauses.length, w.pauses.every(p => p === 500)], [2, 3, 5, 4, true]);
    verifier('la voie cache est abandonnée après 2 échecs de suite (la 3e image ne la tente plus) ; les GM refusent les redirections', [w.fetches.map(f => f.url.slice(-41, -5)), w.appels.filter(x => x.url.startsWith(H)).every(x => x.redirect === 'error')], [[ID(1), ID(2)], true]);
    verifier('le panneau affiche le compte RÉEL après l\'envoi', [/Requêtes vers images\.pikaqian\.com : navigateur 3 · cache 2 lecture/.test(texte(w)), /voie cache abandonnée/.test(texte(w))], [true, true]);
    // canvas lisible : aucune pause, aucune requête
    w = fabriquerMonde({ tuiles: Array.from({ length: 5 }, (_, i) => T(i + 1, { canvas: 'ok' })) });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(100);
    verifier('canvas lisible : 0 pause, 0 fetch, 0 requête vers l\'hôte des images', [w.pauses.length, w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length], [0, 0, 0]);
    // L'ARRÊT : premier 403 / 429 / 5xx, sur CHAQUE voie, sans réessai ; les images déjà lues partent au récepteur ; une 404 n'arrête pas
    for (const [nom, tuiles, voie, statut] of [
        ['403 sur le navigateur', [T(1, { gm: 'ok' }), T(2, { gmStatut: 403 }), T(3, { gm: 'ok' }), T(4, { gm: 'ok' })], 'navigateur', 403],
        ['429 sur le navigateur', [T(1, { gm: 'ok' }), T(2, { gmStatut: 429 }), T(3, { gm: 'ok' })], 'navigateur', 429],
        ['503 sur le navigateur', [T(1, { gm: 'ok' }), T(2, { gmStatut: 503 }), T(3, { gm: 'ok' })], 'navigateur', 503],
        ['429 sur le cache', [T(1, { gm: 'ok' }), T(2, { fetchStatut: 429 }), T(3, { gm: 'ok' })], 'cache', 429]
    ]) {
        w = fabriquerMonde({ tuiles });
        vm.runInNewContext(SRC, w.bac);
        w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
        await attendre(150);
        const tuileFautive = tuiles[1].src;
        const lots = w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data));
        const apresFaute = w.appels.filter(x => x.url.startsWith(H)).map(x => x.url).concat(w.fetches.map(f => f.url));
        verifier(`ARRÊT — ${nom} : le panneau l'affiche, aucune requête vers la tuile suivante, aucun réessai de la fautive, l'image déjà lue est envoyée`, [new RegExp(`ARRÊT : HTTP ${statut} \\(voie ${voie}\\)`).test(texte(w)), apresFaute.some(u => u.includes(ID(3))) && tuiles.length >= 3 && !apresFaute.some(u => u.includes(ID(3)) && false), apresFaute.filter(u => u === tuileFautive).length <= 2, lots.length, lots[0]?.images.map(i => i.id.slice(-1))],
            [true, false, true, 1, ['1']]);
    }
    w = fabriquerMonde({ tuiles: [T(1, { gm: 'ok' }), T(2, { gmStatut: 404 }), T(3, { gm: 'ok' })] });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(150);
    verifier('une 404 n\'est PAS un arrêt : la lecture continue (2 images envoyées, 1 illisible)', [/ARRÊT/.test(texte(w)), w.appels.filter(x => /\/images$/.test(x.url)).flatMap(x => JSON.parse(x.data).images).length, /illisibles 1/.test(texte(w))], [false, 2, true]);

    // ── TOUR 2 : le maximum se recalcule AU CLIC et s'affiche AVANT l'envoi
    w = fabriquerMonde({ tuiles: [T(1, { gm: 'ok' }), T(2, { gm: 'ok' }), T(3, { gm: 'ok' }), T(4, { chargee: false, gm: 'ok' })] });
    vm.runInNewContext(SRC, w.bac);
    verifier('au CHARGEMENT : 3 images annoncées (au plus 6)', /au plus 6 pour 3 image/.test(texte(w)), true);
    const img4 = w.imgs.get(ID(4)); img4.complete = true; img4.naturalWidth = 300;      // la 4e image se charge ENTRE le chargement et le clic (sans survol)
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(250);
    verifier('AU CLIC le maximum est RECALCULÉ (4 images, au plus 8) et le panneau le DIT avant la première requête (celle de la page)', [/au plus 8 pour 4 image/.test(w.snaps[0] || ''), /\/apprendre$/.test(w.appels[0]?.url || ''), /Envoi de la page/.test(w.snaps[0] || '')], [true, true, true]);
    verifier('… et la lecture ne dépasse jamais l\'annoncé : 4 images lues, au plus 8 requêtes vers l\'hôte des images', [w.appels.filter(x => x.url.startsWith(H)).length + w.fetches.length <= 8, w.appels.filter(x => x.url.startsWith(H)).length], [true, 4]);

    // ── TOUR 2 : l'URL FINALE de la réponse (on ne compte pas sur redirect:'error' seul)
    const AUTRE_CHEMIN = `${H}autre-chemin.webp`;
    for (const [nom, tuiles, voie] of [
        ['GM : URL finale sur un AUTRE HÔTE', [T(1, { gm: 'ok' }), T(2, { gm: 'ok', gmFinal: `https://exemple.test/cs1bc/${ID(2)}.webp` }), T(3, { gm: 'ok' })], 'navigateur'],
        ['GM : URL finale sur le bon hôte mais un AUTRE CHEMIN', [T(1, { gm: 'ok' }), T(2, { gm: 'ok', gmFinal: AUTRE_CHEMIN }), T(3, { gm: 'ok' })], 'navigateur'],
        ['GM : URL finale ILLISIBLE (le gestionnaire ne la rend pas)', [T(1, { gm: 'ok' }), T(2, { gm: 'ok', gmFinal: undefined }), T(3, { gm: 'ok' })], 'navigateur'],
        ['fetch : response.url sur un AUTRE CHEMIN', [T(1, { fetch: 'ok' }), T(2, { fetch: 'ok', fetchFinal: AUTRE_CHEMIN }), T(3, { fetch: 'ok' })], 'cache']
    ]) {
        w = fabriquerMonde({ tuiles });
        vm.runInNewContext(SRC, w.bac);
        w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
        await attendre(200);
        const tousLesUrls = w.appels.filter(x => x.url.startsWith(H)).map(x => x.url).concat(w.fetches.map(f => f.url));
        const lots2 = w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data));
        verifier(`URL FINALE — ${nom} : ARRÊT « redirection » (voie ${voie}), la tuile suivante n'est pas demandée, l'image déjà lue part`, [new RegExp(`ARRÊT : redirection.*\\(voie ${voie}\\)`).test(texte(w)), tousLesUrls.some(u => u.includes(ID(3))), lots2.flatMap(l => l.images).map(i => i.id.slice(-1))], [true, false, ['1']]);
    }

    // ── TOUR 2 : trois 404 de suite arrêtent la lecture ; une 404 isolée reste un trou
    for (const [nom, tuiles, voie] of [
        ['navigateur : 3 réponses 404 de suite', [T(1, { gmStatut: 404 }), T(2, { gmStatut: 404 }), T(3, { gmStatut: 404 }), T(4, { gm: 'ok' })], 'navigateur'],
        ['cache puis navigateur : 404, 404, 404 (cache d\'abord)', [T(1, { fetchStatut: 404, gmStatut: 404 }), T(2, { fetchStatut: 404, gmStatut: 404 }), T(3, { gm: 'ok' })], 'cache']
    ]) {
        w = fabriquerMonde({ tuiles });
        vm.runInNewContext(SRC, w.bac);
        w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
        await attendre(200);
        const dernier = tuiles.at(-1);
        const urls404 = w.appels.filter(x => x.url.startsWith(H)).map(x => x.url).concat(w.fetches.map(f => f.url));
        verifier(`404 — ${nom} : ARRÊT « trois réponses 404 de suite » (voie ${voie}), le panneau le dit, la tuile d'après n'est pas demandée`, [new RegExp(`ARRÊT : trois réponses 404 de suite.*\\(voie ${voie}\\)`).test(texte(w)), urls404.some(u => u.includes(dernier.id.slice(-12)))], [true, false]);
    }
    w = fabriquerMonde({ tuiles: [T(1, { gmStatut: 404 }), T(2, { gm: 'ok' }), T(3, { gmStatut: 404 }), T(4, { gmStatut: 404 }), T(5, { gm: 'ok' }), T(6, { gmStatut: 404 }), T(7, { gmStatut: 404 })] });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await attendre(250);
    verifier('404 ISOLÉES ou par deux (interrompues par une image lue) : pas d\'arrêt, des trous nommés « illisibles » (5), 2 images envoyées', [/ARRÊT/.test(texte(w)), /illisibles 5/.test(texte(w)), w.appels.filter(x => /\/images$/.test(x.url)).flatMap(x => JSON.parse(x.data).images).length], [false, true, 2]);

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

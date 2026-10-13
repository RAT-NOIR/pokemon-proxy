// node test-userscript-pikaqian.js — le userscript PASSIF de PikaQian (userscript-pikaqian.js, v2.3) : test STATIQUE (aucune adresse hors 127.0.0.1, un seul hôte d'images,
// aucune navigation ni défilement ni minuterie hors pause(), un seul fetch, un seul innerHTML fait de littéraux) et test de COMPORTEMENT dans un bac `vm` (faux document, faux
// GM_xmlhttpRequest, faux fetch : aucune requête réelle). Le monde fabriqué compte les requêtes en vol vers l'hôte des images et sait RETENIR une réponse (portes) : c'est ce qui
// permet de prouver le parallélisme (CONCURRENCE), l'arrêt partagé (lecture.arret : aucune requête nouvelle après la réponse fautive) et la cadence (PAUSE_MS entre paquets).
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
verifier('@version : 2.3', valeurs('version'), ['2.3']);
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
const CONCURRENCE = 8, PAUSE_MS = 150;     // les valeurs du testeur (US23) ; le script doit les porter, le comportement est mesuré plus bas
verifier('la cadence du testeur : CONCURRENCE === 8 et PAUSE_MS === 150', [num('CONCURRENCE'), num('PAUSE_MS')], [CONCURRENCE, PAUSE_MS]);
const interdits = [
    ['location.href =', /location\s*\.\s*href\s*=[^=]/], ['location.assign/replace', /location\s*\.\s*(assign|replace)\s*\(/], ['location = ', /\blocation\s*=[^=]/],
    ['.click()', /\.\s*click\s*\(/], ['window.open', /window\s*\.\s*open\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['sendBeacon', /sendBeacon/],
    ['document.cookie', /document\s*\.\s*cookie/], ['localStorage/sessionStorage/indexedDB', /localStorage|sessionStorage|indexedDB/], ['GM_getValue/GM_setValue/GM_cookie', /GM_(getValue|setValue|cookie|openInTab|download)/],
    ['new Image / new WebSocket / EventSource', /new\s+(Image|WebSocket|EventSource)\b/], ['dispatchEvent dans la page', /dispatchEvent/],
    ['insertAdjacentHTML / document.write / outerHTML =', /insertAdjacentHTML|document\s*\.\s*write\s*\(|outerHTML\s*=[^=]/],
    ['setInterval (aucune action répétée ; setTimeout n\'existe que dans pause(), vérifié plus bas)', /\bsetInterval\s*\(/], ['MutationObserver / IntersectionObserver', /(Mutation|Intersection)Observer/], ['eval / Function', /\beval\s*\(|new\s+Function\b/],
    ['AUCUN DÉFILEMENT : scroll / scrollTo / scrollBy / scrollIntoView / requestAnimationFrame', /\bscroll(To|By|IntoView|Top)?\s*[(=]|requestAnimationFrame|\.focus\s*\(/],
    ['forcer le chargement paresseux (loading = eager, lazy)', /\.\s*loading\s*=|setAttribute\s*\(\s*['"]loading/], ['changer le src d\'une image de la page', /\.\s*src\s*=[^=]|setAttribute\s*\(\s*['"]src/]
];
for (const [nom, re] of interdits) verifier(`interdit absent : ${nom}`, re.test(sansCommentaires), false);

// ── innerHTML : écrit par ce qu'il AUTORISE. Une SEULE affectation dans tout le fichier, sur `panneau`, dont le membre droit n'est fait QUE de littéraux de chaîne concaténés par « + »
// (aucun identifiant, aucun appel, aucun gabarit) ; tout texte variable passe par textContent. Rend le texte du squelette si la forme est permise, sinon null.
function squeletteDuPanneau(src) {
    if ((src.match(/innerHTML/g) || []).length !== 1) return null;
    const i = src.search(/(?<![\w$.])panneau\s*\.\s*innerHTML\s*=(?!=)/);
    if (i < 0) return null;
    let p = src.indexOf('=', i) + 1, sortie = '';
    const n = src.length;
    const blancs = () => { while (p < n && /\s/.test(src[p])) p++; };
    for (; ;) {
        blancs();
        if (src[p] !== '\'' && src[p] !== '"') return null;
        const debut = p, q = src[p++];
        while (p < n && src[p] !== q) { if (src[p] === '\n') return null; if (src[p] === '\\') p++; p++; }
        if (p >= n) return null;
        p++;
        sortie += Function(`return (${src.slice(debut, p)})`)();
        blancs();
        if (src[p] === ';') return sortie;
        if (src[p] !== '+') return null;
        p++;
    }
}
const squelette = squeletteDuPanneau(sansCommentaires);
verifier('innerHTML : UNE seule affectation, sur panneau, faite uniquement de littéraux de chaîne concaténés', typeof squelette === 'string' && squelette.length > 0, true);
const mutantInnerHTML = (de, vers) => sansCommentaires.replace(de, vers);
verifier('… la garde dit NON sur une copie où une variable est concaténée dans ce innerHTML', squeletteDuPanneau(mutantInnerHTML('Apprendre cette page</div>\' +', 'Apprendre cette page</div>\' + CODE +')), null);
verifier('… NON sur une copie où un appel est concaténé', squeletteDuPanneau(mutantInnerHTML('Apprendre cette page</div>\' +', 'Apprendre cette page</div>\' + String(CODE) +')), null);
verifier('… NON sur une copie où un gabarit est concaténé', squeletteDuPanneau(mutantInnerHTML('Apprendre cette page</div>\' +', 'Apprendre cette page</div>\' + `${CODE}` +')), null);
verifier('… NON sur une copie qui ajoute un SECOND innerHTML', squeletteDuPanneau(sansCommentaires + '\nsous.innerHTML = \'x\';'), null);
verifier('… NON sur une copie où le innerHTML est posé sur un autre élément que panneau', squeletteDuPanneau(mutantInnerHTML('panneau.innerHTML =', 'sous.innerHTML =')), null);
const idsLus = [...sansCommentaires.matchAll(/panneau\.querySelector\('#(rm-[a-z]+)'\)/g)].map(x => x[1]);
const idsDeclares = [...(squelette || '').matchAll(/\bid="(rm-[a-z]+)"/g)].map(x => x[1]);
verifier('les éléments que le script retrouve (querySelector #rm-…) sont ceux que le squelette déclare', [idsLus.length >= 5, idsLus.every(id => idsDeclares.includes(id))], [true, true]);

verifier('GM_xmlhttpRequest est appelé DEUX fois dans le code : le récepteur local (poster) et l\'image de la tuile (depuisLeNavigateur)', (sansCommentaires.match(/GM_xmlhttpRequest\s*\(/g) || []).length, 2);
verifier('fetch est appelé UNE seule fois, en lecture du cache de la page : GET, force-cache, sans identifiants, sans redirection', [(sansCommentaires.match(/\bfetch\s*\(/g) || []).length, /fetch\(src, \{ method: 'GET', mode: 'cors', cache: 'force-cache', credentials: 'omit', redirect: 'error' \}\)/.test(sansCommentaires)], [1, true]);
verifier('setTimeout : UNE seule fois, dans pause() (la cadence entre deux paquets, attendue dans le flux du clic)', [(sansCommentaires.match(/\bsetTimeout\s*\(/g) || []).length, /function pause\(ms\) \{ return new Promise\(function \(resoudre\) \{ setTimeout\(resoudre, ms\); \}\); \}/.test(sansCommentaires)], [1, true]);
verifier('redirections refusées : redirect \'error\' sur le POST local, sur la lecture GM de l\'image et sur le fetch', (sansCommentaires.match(/redirect: 'error'/g) || []).length, 3);
verifier('deux addEventListener : le clic et le survol du panneau (qui ne fait que rafraîchir le sous-titre, sans requête) ; apprendre() n\'est appelée que depuis le clic', [(sansCommentaires.match(/addEventListener\s*\(/g) || []).length, (sansCommentaires.match(/(?<!function\s)\bapprendre\s*\(\s*\)/g) || []).length, (() => {
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
 * Un monde fabriqué. `tuiles` : [{ id, nom, numero, src, chargee, canvas: 'ok'|'taché', fetch: 'ok'|'refus', gm: 'ok'|'echec', … }] ; rien de réel : GM_xmlhttpRequest, fetch et canvas sont
 * des faux qui enregistrent. Options de tuile propres à US23 : fetchPorte / gmPorte (la réponse est RETENUE jusqu'à w.ouvrir('fetch:<id>') / w.ouvrir('gm:<id>') ou w.ouvrirTout()),
 * faute (le moment où la réponse de cette tuile est livrée est noté : requêtes en vol à cet instant, et rang de la livraison).
 * Le monde note chaque requête vers l'hôte des images (demarrages : rang, voie, adresse), combien sont en vol (enVol, maxEnVol) et chaque attente de pause (pauses).
 */
function fabriquerMonde({ reponse = { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', tuilesLues: 315, tuilesAuCode: 315, officielles: 1, natives: 1, fichier: 'cs1bc--x.json' }) }, erreur = null, tuiles = [], reponseImages = null } = {}) {
    const elements = [], appels = [], fetches = [], defilements = [], imgs = new Map();
    const el = tag => {
        const enfants = new Map();
        const e = {
            tag, style: {}, children: [], ecouteurs: {}, textContent: '', innerHTML: '', addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; }, setAttribute() { },
            querySelector(s) { if (!/^#rm-[a-z]+$/.test(s)) return null; if (!enfants.has(s)) enfants.set(s, el('div')); return enfants.get(s); }
        };
        elements.push(e); return e;
    };
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
    // le compte des requêtes vers l'hôte des images : en vol, pic, rang de départ ; la FAUTE (la réponse fautive, au moment où elle est livrée)
    let seq = 0, enVol = 0, maxEnVol = 0, faute = null;
    const demarrages = [];
    const demarrer = (voie, url) => { demarrages.push({ seq: ++seq, voie, url }); enVol++; if (enVol > maxEnVol) maxEnVol = enVol; };
    const fin = () => { enVol--; };
    const signaler = t => { if (t?.faute && !faute) faute = { seq: ++seq, autres: enVol - 1 }; };      // enVol compte encore la réponse fautive : « autres » = les AUTRES requêtes en vol
    const portes = new Map(); let toutOuvert = false;
    const porte = cle => { let p = portes.get(cle); if (!p) { p = {}; p.promesse = new Promise(r => { p.ouvrir = r; }); portes.set(cle, p); if (toutOuvert) p.ouvrir(); } return p; };
    const GM_xmlhttpRequest = o => {
        appels.push(o);
        const local = /^http:\/\/127\.0\.0\.1/.test(o.url);
        if (!local) demarrer('navigateur', o.url);
        setTimeout(async () => {
            if (local) {
                if (erreur) return o.onerror?.({ error: erreur });
                if (/\/apprendre$/.test(o.url)) return o.onload?.(reponse);
                if (/\/images$/.test(o.url)) {
                    const corps = JSON.parse(o.data);
                    return o.onload?.(reponseImages ? reponseImages(corps) : { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', recues: corps.images.length, nouvelles: corps.images.length, deja: 0, refusees: [] }) });
                }
                return undefined;
            }
            const t = parSrc.get(o.url);
            if (t?.gmPorte) await porte(`gm:${t.id}`).promesse;
            signaler(t); fin();
            const finalUrl = t && 'gmFinal' in t ? t.gmFinal : o.url;      // l'URL finale rendue par le gestionnaire (`undefined` = illisible)
            if (t?.gmStatut) return o.onload?.({ status: t.gmStatut, response: new ArrayBuffer(0), finalUrl });       // 403, 429, 503, 404… : une réponse HTTP sans image
            if (t && t.gm !== 'echec') return o.onload?.({ status: 200, response: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, finalUrl });
            return o.onerror?.({});
        }, 0);
    };
    const fetchFaux = (url, opts) => {
        fetches.push({ url, opts }); const t = parSrc.get(url);
        demarrer('cache', url);
        const attente = t?.fetchPorte ? porte(`fetch:${t.id}`).promesse : Promise.resolve();
        return attente.then(() => {
            signaler(t);
            const urlRep = t && 'fetchFinal' in t ? t.fetchFinal : url;
            if (t?.fetchStatut) return { ok: false, status: t.fetchStatut, url: urlRep };
            if (t && t.fetch === 'ok') return { ok: true, status: 200, url: urlRep, arrayBuffer: () => Promise.resolve(new Uint8Array([9, 9, 9, 9]).buffer) };
            throw new TypeError('Failed to fetch (CORS)');
        }).then(r => { fin(); return r; }, e => { fin(); throw e; });
    };
    // la cadence : le faux setTimeout du script ENREGISTRE chaque attente et rend la main aussitôt (le banc ne dort pas)
    const pauses = [];
    const setTimeoutScript = (f, ms) => { pauses.push(ms); Promise.resolve().then(f); };
    const bac = { document, location, GM_xmlhttpRequest, fetch: fetchFaux, btoa, URL, Uint8Array, ArrayBuffer, window: { location, document }, console, JSON, setTimeout: setTimeoutScript, Date, String, Number, Math };
    bac.window.window = bac.window;
    return {
        bac, elements, appels, fetches, defilements, pauses, imgs, demarrages,
        get enVol() { return enVol; }, get maxEnVol() { return maxEnVol; }, get faute() { return faute; },
        ouvrir: cle => porte(cle).ouvrir(),
        ouvrirTout: () => { toutOuvert = true; for (const p of portes.values()) p.ouvrir(); }
    };
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
const texte = w => w.elements.map(e => e.textContent).join(' | ');
const hotesDes = appels => appels.map(a => new URL(a.url).host);
const cliquer = w => w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
const lancer = w => { vm.runInNewContext(SRC, w.bac, { filename: 'userscript-pikaqian.js' }); };
const lotsDe = w => w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data));
const idsEnvoyes = w => lotsDe(w).flatMap(l => l.images).map(i => parseInt(i.id.slice(-12), 10)).sort((a, b) => a - b);

(async () => {
    let w = fabriquerMonde();
    lancer(w);
    const bouton = w.elements.find(e => e.ecouteurs.click);
    verifier('au chargement : un bouton, et AUCUNE requête (ni GM_xmlhttpRequest ni fetch)', [!!bouton, w.appels.length, w.fetches.length], [true, 0, 0]);
    verifier('le panneau s\'appelle « Apprendre cette page » (squelette du panneau)', w.elements.some(e => /Apprendre cette page/.test(e.innerHTML)), true);
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
    verifier('la réponse du récepteur s\'affiche : tuiles lues, et « aucune image chargée » quand la page n\'en porte pas', /315 tuiles/.test(texte(w)) && /aucune image chargée/.test(texte(w)), true);
    // l'anomalie « flux absent » est montrée au testeur
    w = fabriquerMonde({ reponse: { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', ancres: 315, tuilesLues: 315, tuilesAuCode: 315, flux: 'absent', officielles: 0, fichier: 'x.json', anomalie: 'FLUX DE DONNÉES ABSENT : test' }) } });
    lancer(w);
    cliquer(w);
    await attendre(30);
    verifier('flux absent : l\'anomalie est affichée', /FLUX DE DONNÉES ABSENT/.test(texte(w)), true);
    // un refus du récepteur : son motif est affiché, AUCUNE image n'est lue ni envoyée
    w = fabriquerMonde({ reponse: { status: 422, responseText: JSON.stringify({ ok: false, motif: '3 tuiles sur 9 portent le code cs1bc : la page ne désigne pas ce set' }) }, tuiles: [{ id: '00000000-0000-4000-8000-000000000001', nom: 'A', numero: '001', src: `https://${P.HOTE_IMAGES}/cs1bc/00000000-0000-4000-8000-000000000001.webp`, canvas: 'ok' }] });
    lancer(w);
    cliquer(w);
    await attendre(30);
    verifier('page refusée (422) : la raison est affichée, une seule requête (la page), aucune image lue', [/ne désigne pas ce set/.test(texte(w)), w.appels.length, w.fetches.length], [true, 1, 0]);
    // LOT PQ-PROMO : le refus d'une page porte son diagnostic, affiché tel quel (les lignes du récepteur), sans rien envoyer de plus
    const lignesDiag = ['codes lus sur les tuiles : code-inconnu×3', 'dossiers des images : dossier-ailleurs×3', 'titre de la page : h1 « Promo SV-P », title « Promo SV-P | PikaQian »', 'nombre de cartes annoncé : « 701 cartes »'];
    w = fabriquerMonde({ reponse: { status: 422, responseText: JSON.stringify({ ok: false, motif: '0 tuiles sur 3 portent le code promo-sv-p : la page ne désigne pas ce set', diagnostic: { lignes: lignesDiag } }) }, tuiles: [{ id: '00000000-0000-4000-8000-000000000001', nom: 'A', numero: '001', src: `https://${P.HOTE_IMAGES}/cs1bc/00000000-0000-4000-8000-000000000001.webp`, canvas: 'ok' }] });
    lancer(w);
    cliquer(w);
    await attendre(30);
    verifier('page refusée avec diagnostic : le motif ET les quatre lignes (codes, dossiers, titre, annonce) sont affichés, toujours une seule requête', [/ne désigne pas ce set/.test(texte(w)), lignesDiag.every(l => texte(w).includes(l)), w.appels.length, w.fetches.length], [true, true, 1, 0]);
    // un diagnostic mal formé (pas des chaînes, trop de lignes) n'est jamais interprété : seules des chaînes, 8 lignes au plus, 300 caractères chacune
    w = fabriquerMonde({ reponse: { status: 422, responseText: JSON.stringify({ ok: false, motif: 'refus', diagnostic: { lignes: [{ x: 1 }, 'z'.repeat(1000), 'ok-1', ...Array.from({ length: 20 }, (_, i) => `l${i}`)] } }) } });
    lancer(w);
    cliquer(w);
    await attendre(30);
    verifier('diagnostic mal formé : les objets sont ignorés, 8 lignes au plus, aucune ligne de plus de 300 caractères', [texte(w).includes('[object'), texte(w).includes('l15'), /z{301}/.test(texte(w))], [false, false, false]);
    verifier('… et les chaînes valides sont affichées malgré l\'objet qui les précède', [texte(w).includes('ok-1'), texte(w).includes('l0')], [true, true]);
    // récepteur éteint
    w = fabriquerMonde({ erreur: 'connexion refusée' });
    lancer(w);
    cliquer(w);
    await attendre(30);
    verifier('récepteur injoignable : un message qui dit de le lancer, aucune autre requête', [/récepteur/i.test(texte(w)), w.appels.length], [true, 1]);
    // une page qui n'est pas /sets/<code> : le script ne l'envoie pas
    w = fabriquerMonde();
    w.bac.location.pathname = '/cards/abc'; w.bac.window.location.pathname = '/cards/abc';
    lancer(w);
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
    lancer(w);
    verifier('page à 6 tuiles, avant le clic : toujours rien (ni requête ni fetch)', [w.appels.length, w.fetches.length], [0, 0]);
    cliquer(w);
    await attendre(120);
    const adressesRecepteur = w.appels.filter(x => /127\.0\.0\.1/.test(x.url));
    const lotsImages = adressesRecepteur.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data));
    verifier('requêtes de GM_xmlhttpRequest : la page, UN lot d\'images, et deux images (tuiles 3 et 6, voie navigateur) — jamais l\'hôte étranger', [hotesDes(w.appels).filter(h => !/^127\.0\.0\.1/.test(h)).sort(), w.appels.filter(x => /exemple\.test/.test(x.url)).length], [[P.HOTE_IMAGES, P.HOTE_IMAGES], 0]);
    verifier('les requêtes vers l\'hôte des images sont des GET anonymes en arraybuffer, vers l\'adresse EXACTE de la tuile', w.appels.filter(x => x.url.startsWith(H)).map(x => [x.method, x.anonymous, x.responseType, x.url.startsWith(H) && x.url.endsWith('.webp')]), [['GET', true, 'arraybuffer', true], ['GET', true, 'arraybuffer', true]]);
    verifier('fetch : appelé pour les tuiles 2, 3 et 6 (canvas échoué), jamais pour la 1 (canvas réussi), la 4 (non chargée) ni la 5 (hôte étranger) ; toujours force-cache, sans identifiants', [w.fetches.map(f => f.url.slice(-41, -5)), w.fetches.every(f => f.opts.cache === 'force-cache' && f.opts.credentials === 'omit' && f.opts.method === 'GET' && f.opts.redirect === 'error')], [[ID(2), ID(3), ID(6)], true]);
    verifier('UN lot envoyé à /images : fichier, images, sansImage = 1 (la tuile 4 non chargée) ; clés exactes', [lotsImages.length, Object.keys(lotsImages[0] || {}).sort(), lotsImages[0]?.fichier, lotsImages[0]?.sansImage, lotsImages[0]?.images.map(i => Object.keys(i).sort().join(','))], [1, ['fichier', 'images', 'sansImage'], 'cs1bc--x.json', 1, ['b64,id,nom,numero,src,voie', 'b64,id,nom,numero,src,voie', 'b64,id,nom,numero,src,voie']]);
    verifier('les trois images lues : voies canvas, cache, navigateur ; nom et numéro tels que le DOM les affiche (espaces normalisés)', lotsImages[0]?.images.map(i => [i.id.slice(-1), i.nom, i.numero, i.voie]), [['1', 'Pikachu', '001', 'canvas'], ['2', 'Raichu', '002', 'cache'], ['3', 'Pichu', '003', 'navigateur']]);
    verifier('les octets partent en base64 : le PNG du canvas, l\'arraybuffer du cache, celui du navigateur', lotsImages[0]?.images.map(i => i.b64), ['Q0FOVkFT', Buffer.from([9, 9, 9, 9]).toString('base64'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64')]);
    verifier('le panneau DIT le résultat : 3 reçues, 2 illisibles (la tuile étrangère et celle qui échoue), 1 tuile sans image chargée et quoi faire', [/3 image\(s\) reçue\(s\)/.test(texte(w)), /2 illisible\(s\)/.test(texte(w)), /1 tuile\(s\) sans image chargée/.test(texte(w)), /fais défiler/.test(texte(w))], [true, true, true, true]);

    // ── des lots BORNÉS : 23 tuiles à canvas → 10 + 10 + 3
    w = fabriquerMonde({ tuiles: Array.from({ length: 23 }, (_, i) => ({ id: ID(i + 1), nom: `N${i}`, numero: String(i + 1).padStart(3, '0'), src: `${H}${ID(i + 1)}.webp`, canvas: 'ok' })) });
    lancer(w);
    cliquer(w);
    await attendre(250);
    verifier('23 images → trois lots de 10, 10 et 3, jamais plus de LOT_IMAGES_MAX ; aucun fetch (le canvas a lu)', [w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data).images.length), w.fetches.length], [[10, 10, 3], 0]);
    // des images lourdes : le lot part avant LOT_IMAGES_MAX quand LOT_B64_MAX est atteint
    const lourdes = Array.from({ length: 4 }, (_, i) => ({ id: ID(i + 1), nom: `N${i}`, numero: String(i + 1).padStart(3, '0'), src: `${H}${ID(i + 1)}.webp`, canvas: 'taché', fetch: 'ok' }));
    w = fabriquerMonde({ tuiles: lourdes });
    const grosB = new Uint8Array(900000).buffer;                       // 1,2 million de caractères base64 par image : deux images dépassent LOT_B64_MAX
    w.bac.fetch = (url, opts) => { w.fetches.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, url, arrayBuffer: () => Promise.resolve(grosB) }); };
    lancer(w);
    cliquer(w);
    await attendre(400);
    verifier('images lourdes : le lot part dès LOT_B64_MAX (2 images par lot), jamais plus', w.appels.filter(x => /\/images$/.test(x.url)).map(x => JSON.parse(x.data).images.length), [2, 2]);
    // un lot refusé par le récepteur : arrêt, aucun lot de plus, le motif est dit
    w = fabriquerMonde({ tuiles: Array.from({ length: 25 }, (_, i) => ({ id: ID(i + 1), nom: `N${i}`, numero: String(i + 1).padStart(3, '0'), src: `${H}${ID(i + 1)}.webp`, canvas: 'ok' })), reponseImages: () => ({ status: 413, responseText: JSON.stringify({ ok: false, motif: 'lot trop gros (test)' }) }) });
    lancer(w);
    cliquer(w);
    await attendre(200);
    verifier('un lot refusé par le récepteur : arrêt net (page + un seul lot), le motif est affiché', [w.appels.filter(x => /\/images$/.test(x.url)).length, /lot trop gros \(test\)/.test(texte(w)), /arrêt/.test(texte(w))], [1, true, true]);
    // des images refusées une à une : comptées et le premier motif est montré
    w = fabriquerMonde({ tuiles: [{ id: ID(1), nom: 'A', numero: '001', src: `${H}${ID(1)}.webp`, canvas: 'ok' }], reponseImages: () => ({ status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', recues: 0, nouvelles: 0, deja: 0, refusees: [{ id: ID(1), motif: 'octets qui ne se décodent pas en image' }] }) }) });
    lancer(w);
    cliquer(w);
    await attendre(100);
    verifier('une image refusée par le récepteur : le panneau le compte et cite le motif', [/0 image\(s\) reçue\(s\) · 1 refusée\(s\)/.test(texte(w)), /ne se décodent pas/.test(texte(w))], [true, true]);
    // aucun défilement : le monde fabriqué n'offre aucun scroll ; le script n'en cherche pas — le test statique l'interdit déjà
    verifier('le monde fabriqué n\'offre aucun scroll, et le test a tourné : aucune erreur', w.defilements.length, 0);

    // ── le sous-titre du panneau : où en est la page (sans requête), rafraîchi au survol ; le relevé des tuiles est REFAIT au clic
    const T = (n, extra = {}) => ({ id: ID(n), nom: `N${n}`, numero: String(n).padStart(3, '0'), src: `${H}${ID(n)}.webp`, canvas: 'taché', fetch: 'refus', ...extra });
    w = fabriquerMonde({ tuiles: [T(1, { canvas: 'ok' }), T(2, { canvas: 'ok' })] });
    lancer(w);
    verifier('AVANT le clic, tout chargé : le sous-titre compte 2/2, donne une durée, et le panneau dit que rien n\'est envoyé ; rien n\'est parti', [/cs1bc · 2\/2 images chargées · ≈ 5 s de lecture/.test(texte(w)), /Rien n'est envoyé avant ton clic/.test(texte(w)), w.appels.length, w.fetches.length], [true, true, 0, 0]);
    w = fabriquerMonde({ tuiles: [T(1, { gm: 'ok' }), T(2, { gm: 'ok' }), T(3, { gm: 'ok' }), T(4, { chargee: false, gm: 'ok' })] });
    lancer(w);
    verifier('AVANT le clic, une tuile non chargée : « 3/4 images chargées — fais défiler jusqu\'en bas » ; rien n\'est parti', [/cs1bc · 3\/4 images chargées — fais défiler jusqu'en bas/.test(texte(w)), w.appels.length, w.fetches.length, w.pauses.length], [true, 0, 0, 0]);
    const img4 = w.imgs.get(ID(4)); img4.complete = true; img4.naturalWidth = 300;      // la 4e image se charge ENTRE le chargement et le clic
    w.elements.find(e => e.ecouteurs.mouseover).ecouteurs.mouseover({});
    verifier('au survol du panneau, le sous-titre se rafraîchit (4/4) sans aucune requête', [/cs1bc · 4\/4 images chargées · ≈ 5 s de lecture/.test(texte(w)), w.appels.length, w.fetches.length], [true, 0, 0]);
    w = fabriquerMonde({ tuiles: [T(1, { gm: 'ok' }), T(2, { gm: 'ok' }), T(3, { gm: 'ok' }), T(4, { chargee: false, gm: 'ok' })] });
    lancer(w);
    const img4b = w.imgs.get(ID(4)); img4b.complete = true; img4b.naturalWidth = 300;      // chargée entre le chargement et le clic, SANS survol
    cliquer(w);
    await attendre(250);
    verifier('AU CLIC le relevé des tuiles est refait : l\'image chargée entre-temps est lue (4 requêtes d\'images, 4 envoyées), plus aucune « sans image »', [w.appels.filter(x => x.url.startsWith(H)).length, idsEnvoyes(w), lotsDe(w)[0]?.sansImage], [4, [1, 2, 3, 4], 0]);

    // ── US23 (1) : à AUCUN instant plus de CONCURRENCE requêtes vers l'hôte des images en vol, et le parallélisme est RÉEL
    w = fabriquerMonde({ tuiles: Array.from({ length: 16 }, (_, i) => T(i + 1, { fetch: 'ok', fetchPorte: true })) });
    lancer(w);
    cliquer(w);
    await attendre(40);
    const pic1 = [w.enVol, w.maxEnVol, w.fetches.length];
    w.ouvrirTout();
    await attendre(150);
    verifier(`CONCURRENCE (voie cache, réponses retenues) : le premier paquet met EXACTEMENT ${CONCURRENCE} requêtes en vol (ni 1, ni plus), pas une de plus avant qu'il soit fini`, pic1, [CONCURRENCE, CONCURRENCE, CONCURRENCE]);
    verifier(`… une fois tout livré, le pic n'a jamais dépassé ${CONCURRENCE} et les 16 images sont parties au récepteur`, [w.maxEnVol, w.fetches.length, idsEnvoyes(w).length], [CONCURRENCE, 16, 16]);
    w = fabriquerMonde({ tuiles: Array.from({ length: 20 }, (_, i) => T(i + 1, { gm: 'ok', gmPorte: true })) });
    lancer(w);
    cliquer(w);
    await attendre(40);
    const pic2 = [w.enVol, w.maxEnVol, w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length];
    w.ouvrirTout();
    await attendre(300);
    verifier(`CONCURRENCE (voie navigateur, réponses retenues) : ${CONCURRENCE} en vol, jamais ${CONCURRENCE + 1}`, [pic2.slice(0, 2), w.maxEnVol], [[CONCURRENCE, CONCURRENCE], CONCURRENCE]);
    verifier('MESURE (fait à dire au testeur) : quand le cache échoue (CORS), le PREMIER paquet émet 2 × CONCURRENCE requêtes — 8 caches puis 8 navigateurs — avant que la voie cache soit abandonnée ; ensuite 0 cache', [pic2[2], pic2[3], w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length, idsEnvoyes(w).length], [CONCURRENCE, CONCURRENCE, CONCURRENCE, 20, 20]);

    // ── US23 (2) : AUCUNE requête après lecture.arret. La réponse fautive tombe dans le PREMIER paquet pendant que les autres images du paquet sont encore en vol (réponses retenues)
    const AUTRE_CHEMIN = `${H}autre-chemin.webp`;
    const CAS = [
        ['403 (voie cache)', { 2: { fetchStatut: 403, faute: true } }, [2], /ARRÊT : HTTP 403 \(voie cache\)/, [1, 3, 4, 5]],
        ['429 (voie cache)', { 2: { fetchStatut: 429, faute: true } }, [2], /ARRÊT : HTTP 429 \(voie cache\)/, [1, 3, 4, 5]],
        ['503 (voie cache)', { 2: { fetchStatut: 503, faute: true } }, [2], /ARRÊT : HTTP 503 \(voie cache\)/, [1, 3, 4, 5]],
        ['trois 404 de suite (voie cache)', { 1: { fetchStatut: 404, gm: 'echec' }, 2: { fetchStatut: 404, gm: 'echec' }, 3: { fetchStatut: 404, faute: true } }, [1, 2, 3], /ARRÊT : trois réponses 404 de suite.*\(voie cache\)/, [4, 5]],
        ['URL finale redirigée (voie cache)', { 2: { fetch: 'ok', fetchFinal: AUTRE_CHEMIN, faute: true } }, [2], /ARRÊT : redirection.*\(voie cache\)/, [1, 3, 4, 5]]
    ];
    const tuilesDuCas = surcharge => Array.from({ length: 16 }, (_, i) => { const n = i + 1; return T(n, { fetchPorte: true, ...((n === 1 || (n >= 3 && n <= 5) || n >= 9) ? { fetch: 'ok' } : {}), ...(surcharge[n] || {}) }); });
    for (const [nom, surcharge, ordre, motif, lues] of CAS) {
        const tuiles = tuilesDuCas(surcharge);
        w = fabriquerMonde({ tuiles });
        lancer(w);
        cliquer(w);
        await attendre(40);
        const avant = w.enVol;
        for (const n of ordre) { w.ouvrir(`fetch:${ID(n)}`); await attendre(15); }
        await attendre(15);
        const f = w.faute;
        const apres = f ? w.demarrages.filter(d => d.seq > f.seq) : null;
        w.ouvrirTout();
        await attendre(200);
        verifier(`ARRÊT PARTAGÉ — ${nom} : ${CONCURRENCE} requêtes en vol avant la faute ; à la réponse fautive, 0 requête nouvelle ensuite (ni navigateur des images du même paquet, ni paquet suivant), au plus ${CONCURRENCE - 1} autres en vol`,
            [avant, !!f, f ? apres.length : -1, f ? f.autres >= 5 && f.autres <= CONCURRENCE - 1 : false], [CONCURRENCE, true, 0, true]);
        verifier(`… ${nom} : plus AUCUNE requête jusqu'au bout (rien vers les tuiles 9 à 16, aucun navigateur pour les tuiles 6 à 8) ; le panneau affiche l'arrêt`,
            [w.demarrages.filter(d => d.voie === 'navigateur' && !/\/00000000-0000-4000-8000-00000000000[12]\.webp$/.test(d.url)).length, w.demarrages.some(d => parseInt(d.url.slice(-17, -5), 10) >= 9), motif.test(texte(w))], [0, false, true]);
        verifier(`… ${nom} : les images du paquet lues avec succès partent au récepteur, celles de la faute et des paquets suivants non`, idsEnvoyes(w), lues);
    }

    // ── l'arrêt sur les autres voies et motifs : un paquet de 8, une tuile fautive ; les tuiles 9 et 10 (paquet suivant) ne sont JAMAIS demandées ; les images lues du paquet partent
    const SUITE = [T(9, { gm: 'ok' }), T(10, { gm: 'ok' })];
    const nonDemandees = w2 => w2.demarrages.some(d => /\.webp$/.test(d.url) && /000000000(009|010)\.webp$/.test(d.url));
    for (const [nom, fautive, voie, motif, lues] of [
        ['navigateur : 403', { gmStatut: 403 }, 'navigateur', /ARRÊT : HTTP 403 \(voie navigateur\)/, [1, 3, 4, 5, 6, 7, 8]],
        ['navigateur : 429', { gmStatut: 429 }, 'navigateur', /ARRÊT : HTTP 429 \(voie navigateur\)/, [1, 3, 4, 5, 6, 7, 8]],
        ['navigateur : 503', { gmStatut: 503 }, 'navigateur', /ARRÊT : HTTP 503 \(voie navigateur\)/, [1, 3, 4, 5, 6, 7, 8]],
        ['navigateur : URL finale sur un AUTRE HÔTE', { gm: 'ok', gmFinal: `https://exemple.test/cs1bc/${ID(2)}.webp` }, 'navigateur', /ARRÊT : redirection.*\(voie navigateur\)/, [1, 3, 4, 5, 6, 7, 8]],
        ['navigateur : URL finale sur le bon hôte mais un AUTRE CHEMIN', { gm: 'ok', gmFinal: AUTRE_CHEMIN }, 'navigateur', /ARRÊT : redirection.*\(voie navigateur\)/, [1, 3, 4, 5, 6, 7, 8]],
        ['navigateur : URL finale ILLISIBLE (le gestionnaire ne la rend pas)', { gm: 'ok', gmFinal: undefined }, 'navigateur', /ARRÊT : redirection.*\(voie navigateur\)/, [1, 3, 4, 5, 6, 7, 8]],
        ['cache : response.url sur un AUTRE CHEMIN', { fetch: 'ok', fetchFinal: AUTRE_CHEMIN }, 'cache', /ARRÊT : redirection.*\(voie cache\)/, [1, 3, 4, 5, 6, 7, 8]]
    ]) {
        const parCache = voie === 'cache';
        const tuiles = [...Array.from({ length: 8 }, (_, i) => T(i + 1, parCache ? { fetch: 'ok', ...(i === 1 ? fautive : {}) } : { gm: 'ok', ...(i === 1 ? fautive : {}) })), ...SUITE.map(t => (parCache ? { ...t, fetch: 'ok' } : t))];
        w = fabriquerMonde({ tuiles });
        lancer(w);
        cliquer(w);
        await attendre(250);
        verifier(`ARRÊT — ${nom} : le panneau l'affiche, les tuiles du paquet suivant ne sont pas demandées, les images lues du paquet partent`, [motif.test(texte(w)), nonDemandees(w), idsEnvoyes(w)], [true, false, lues]);
    }
    // trois 404 de suite côté navigateur : les trois premières réponses du paquet sont des 404
    w = fabriquerMonde({ tuiles: [...Array.from({ length: 8 }, (_, i) => T(i + 1, i < 3 ? { gmStatut: 404 } : { gm: 'ok' })), ...SUITE] });
    lancer(w);
    cliquer(w);
    await attendre(250);
    verifier('404 — navigateur : trois réponses 404 de suite → ARRÊT « trois réponses 404 de suite » (voie navigateur), le paquet suivant n\'est pas demandé, les cinq images lues partent', [/ARRÊT : trois réponses 404 de suite.*\(voie navigateur\)/.test(texte(w)), nonDemandees(w), idsEnvoyes(w)], [true, false, [4, 5, 6, 7, 8]]);
    w = fabriquerMonde({ tuiles: [...Array.from({ length: 8 }, (_, i) => T(i + 1, i < 2 ? { fetchStatut: 404, gmStatut: 404 } : { gm: 'ok' })), ...SUITE] });
    lancer(w);
    cliquer(w);
    await attendre(250);
    verifier('404 — cache puis navigateur : 404 (cache), 404 (cache), 404 (navigateur) → ARRÊT, le paquet suivant n\'est pas demandé, les six images lues partent', [/ARRÊT : trois réponses 404 de suite/.test(texte(w)), nonDemandees(w), idsEnvoyes(w)], [true, false, [3, 4, 5, 6, 7, 8]]);
    // une 404 isolée, ou par deux (interrompues par une image lue), n'arrête pas
    w = fabriquerMonde({ tuiles: [T(1, { gm: 'ok' }), T(2, { gmStatut: 404 }), T(3, { gm: 'ok' })] });
    lancer(w);
    cliquer(w);
    await attendre(150);
    verifier('une 404 n\'est PAS un arrêt : la lecture continue (2 images envoyées, 1 illisible)', [/ARRÊT/.test(texte(w)), idsEnvoyes(w).length, /1 illisible\(s\)/.test(texte(w))], [false, 2, true]);
    w = fabriquerMonde({ tuiles: [T(1, { gmStatut: 404 }), T(2, { gm: 'ok' }), T(3, { gmStatut: 404 }), T(4, { gmStatut: 404 }), T(5, { gm: 'ok' }), T(6, { gmStatut: 404 }), T(7, { gmStatut: 404 })] });
    lancer(w);
    cliquer(w);
    await attendre(250);
    verifier('404 ISOLÉES ou par deux (interrompues par une image lue) : pas d\'arrêt, des trous nommés « illisibles » (5), 2 images envoyées', [/ARRÊT/.test(texte(w)), /5 illisible\(s\)/.test(texte(w)), idsEnvoyes(w).length], [false, true, 2]);

    // ── US23 (3) : la CADENCE. Une pause de PAUSE_MS entre deux paquets qui ont émis au moins une requête ; aucune après le dernier ; aucune quand tout se lit au canvas
    const reseau = (n, depuis = 1) => Array.from({ length: n }, (_, i) => T(depuis + i, { gm: 'ok' }));
    const canvasOk = (n, depuis = 1) => Array.from({ length: n }, (_, i) => T(depuis + i, { canvas: 'ok' }));
    w = fabriquerMonde({ tuiles: reseau(3) });
    lancer(w);
    cliquer(w);
    await attendre(150);
    verifier('cadence : 3 images (un seul paquet), cache refusé : 3 caches puis 3 navigateurs, AUCUNE pause (rien à attendre après le dernier paquet)', [w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length, w.pauses.length, idsEnvoyes(w).length], [3, 3, 0, 3]);
    w = fabriquerMonde({ tuiles: reseau(20) });
    lancer(w);
    cliquer(w);
    await attendre(300);
    verifier(`cadence : 20 images en paquets de ${CONCURRENCE}, 8 + 8 + 4 : deux pauses de ${PAUSE_MS} ms exactement (entre les paquets, pas après le dernier)`, [w.pauses, idsEnvoyes(w).length], [[PAUSE_MS, PAUSE_MS], 20]);
    verifier('… la voie cache n\'est tentée que par le premier paquet (abandonnée après 2 échecs de suite) ; tous les navigateurs refusent les redirections', [w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length, w.appels.filter(x => x.url.startsWith(H)).every(x => x.redirect === 'error')], [CONCURRENCE, 20, true]);
    w = fabriquerMonde({ tuiles: [...reseau(8, 1), ...canvasOk(8, 9), ...reseau(8, 17)] });
    lancer(w);
    cliquer(w);
    await attendre(400);
    verifier('cadence : paquets réseau / canvas / réseau → UNE seule pause (après le premier, qui a émis et n\'est pas le dernier) ; le paquet au canvas n\'en provoque pas', [w.pauses, idsEnvoyes(w).length], [[PAUSE_MS], 24]);
    w = fabriquerMonde({ tuiles: [...canvasOk(8, 1), ...reseau(8, 9)] });
    lancer(w);
    cliquer(w);
    await attendre(300);
    verifier('cadence : un paquet au canvas puis un paquet réseau (le dernier) → 0 pause', [w.pauses.length, idsEnvoyes(w).length], [0, 16]);
    w = fabriquerMonde({ tuiles: canvasOk(16) });
    lancer(w);
    cliquer(w);
    await attendre(200);
    verifier('canvas lisible partout (16 images, deux paquets) : 0 pause, 0 fetch, 0 requête vers l\'hôte des images', [w.pauses.length, w.fetches.length, w.appels.filter(x => x.url.startsWith(H)).length, idsEnvoyes(w).length], [0, 0, 0, 16]);

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

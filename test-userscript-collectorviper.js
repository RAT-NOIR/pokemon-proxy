// node test-userscript-collectorviper.js — le userscript PASSIF de Collectorviper (userscript-collectorviper.js). Test STATIQUE (aucun @connect autre que 127.0.0.1, aucun fetch,
// aucun XMLHttpRequest, aucune création d'image, aucun rechargement, aucune navigation, aucun défilement, aucun cookie) et test de COMPORTEMENT dans un bac `vm` sur un DOM
// FABRIQUÉ : aucune requête réelle.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('./recepteur-collectorviper');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const SRC = fs.readFileSync(process.env.CV_USERSCRIPT ? path.resolve(process.env.CV_USERSCRIPT) : path.join(__dirname, 'userscript-collectorviper.js'), 'utf8');
const m = /^\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/.exec(SRC);
verifier('l\'en-tête ==UserScript== existe', !!m, true);
const entete = m ? m[1] : '';
const valeurs = cle => [...entete.matchAll(new RegExp(`^//\\s*@${cle}\\s+(.+?)\\s*$`, 'gm'))].map(x => x[1]);
const code = SRC.slice(m ? m[0].length : 0);
const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

// ── STATIQUE : ce que le script AUTORISE
verifier('@version : 1.0', valeurs('version'), ['1.0']);
verifier('@match : la page supposée de Collectorviper, rien d\'autre', valeurs('match'), ['https://collectorviper.livejournal.com/*']);
verifier('l\'en-tête dit que le @match est une SUPPOSITION (aucune requête ne l\'a vérifié)', /SUPPOSITION/.test(entete + code.slice(0, 3000)), true);
verifier('@grant : GM_xmlhttpRequest seulement', valeurs('grant'), ['GM_xmlhttpRequest']);
verifier('@connect : 127.0.0.1 seulement — aucun autre hôte, jamais « * »', valeurs('connect'), ['127.0.0.1']);
const adresses = [...sansCommentaires.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*/gi)].map(x => x[0]);
verifier('dans le code : toute adresse écrite est http://127.0.0.1:<port> (aucun hôte d\'images, aucun LiveJournal)', adresses.length >= 1 && adresses.every(a => /^http:\/\/127\.0\.0\.1:$/.test(a)), true);
const PORT_US = /^\s*var PORT = (\d{4,5});/m.exec(code);
verifier('PORT : constante unique, égale au port par défaut du récepteur', [!!PORT_US, Number(PORT_US?.[1]) === R.PORT_DEFAUT], [true, true]);
const ENTETE_US = /'X-Rat-Market':\s*'([^']+)'/.exec(code);
verifier('l\'en-tête fixe du script est celui que le récepteur exige', [R.ENTETE_MARQUE, ENTETE_US?.[1]], ['x-rat-market', R.VALEUR_MARQUE]);
verifier('le script ne pose PAS d\'en-tête Origin', /['"]Origin['"]/i.test(sansCommentaires), false);
const hotes = [...sansCommentaires.matchAll(/['"]([a-z0-9-]+(?:\.[a-z0-9-]+)+)['"]/gi)].map(x => x[1]).filter(h => /\.(com|cn|net|org|fr|jp)$/i.test(h));
verifier('seul nom d\'hôte écrit dans le code exécutable : celui de la page attendue (garde de lieu)', hotes, ['collectorviper.livejournal.com']);
const num = nom => { const r = new RegExp(`var ${nom} = ([^;]+);`).exec(code); return r ? Function(`return (${r[1]})`)() : null; };
verifier('SEUIL_LARGEUR : le seuil du dépôt (collecte-cartes/seuils-images.js), pas un autre nombre', num('SEUIL_LARGEUR'), LARGEUR_MIN);
verifier('IMAGES_MAX du script ≤ celui du récepteur', num('IMAGES_MAX') > 0 && num('IMAGES_MAX') <= R.IMAGES_MAX, true);
verifier('IMAGE_OCTETS_MAX du script ≤ celui du récepteur', num('IMAGE_OCTETS_MAX') > 0 && num('IMAGE_OCTETS_MAX') <= R.IMAGE_OCTETS_MAX, true);
const interdits = [
    ['fetch (même « avec garde de cache » : la voie cache n\'est pas gardée)', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['sendBeacon', /sendBeacon/], ['new Request', /new\s+Request\b/], ['importScripts / import()', /importScripts|\bimport\s*\(/],
    ['location.href =', /location\s*\.\s*href\s*=[^=]/], ['location.assign/replace', /location\s*\.\s*(assign|replace)\s*\(/], ['location = ', /\blocation\s*=[^=]/],
    ['.click()', /\.\s*click\s*\(/], ['window.open', /window\s*\.\s*open\s*\(/],
    ['cookie (document.cookie, GM_cookie, en-tête)', /cookie/i], ['localStorage/sessionStorage/indexedDB', /localStorage|sessionStorage|indexedDB/], ['GM_getValue/GM_setValue/GM_openInTab/GM_download', /GM_(getValue|setValue|cookie|openInTab|download)/],
    ['new Image / WebSocket / EventSource', /new\s+(Image|WebSocket|EventSource)\b/], ['dispatchEvent', /dispatchEvent/],
    ['createElement(img/link/script/iframe) : aucune ressource ne se crée', /createElement\s*\(\s*['"](img|image|link|script|iframe|video|audio|source|object|embed)['"]/i],
    ['crossOrigin (le poser fait RECHARGER l\'image : une requête)', /crossOrigin|referrerPolicy/i],
    ['changer le src / srcset d\'une image de la page', /\.\s*src(set)?\s*=[^=]|setAttribute\s*\(\s*['"]src/],
    ['forcer le chargement paresseux', /\.\s*loading\s*=|setAttribute\s*\(\s*['"]loading|\.decode\s*\(/],
    ['insertAdjacentHTML / document.write / outerHTML =', /insertAdjacentHTML|document\s*\.\s*write\s*\(|outerHTML\s*=[^=]/],
    ['setTimeout / setInterval (aucune action différée ni répétée)', /\bset(Timeout|Interval)\s*\(/], ['MutationObserver / IntersectionObserver', /(Mutation|Intersection)Observer/], ['eval / Function', /\beval\s*\(|new\s+Function\b/],
    ['AUCUN DÉFILEMENT', /\bscroll(To|By|IntoView|Top)?\s*[(=]|requestAnimationFrame|\.focus\s*\(/],
    ['toBlob / createObjectURL / FileReader (autres voies de lecture)', /toBlob|createObjectURL|FileReader|ImageBitmap|createImageBitmap/]
];
for (const [nom, re] of interdits) verifier(`interdit absent : ${nom}`, re.test(sansCommentaires), false);
verifier('GM_xmlhttpRequest est appelé UNE seule fois (poster, vers le récepteur)', (sansCommentaires.match(/GM_xmlhttpRequest\s*\(/g) || []).length, 1);
verifier('redirections refusées sur le POST local', /redirect: 'error'/.test(sansCommentaires), true);
verifier('la seule lecture d\'octets : le canvas des pixels AFFICHÉS (drawImage + toDataURL, chacun une fois)', [(sansCommentaires.match(/\.drawImage\s*\(/g) || []).length, (sansCommentaires.match(/\.toDataURL\s*\(/g) || []).length], [1, 1]);
verifier('innerHTML : une seule affectation, sur panneau', [(sansCommentaires.match(/innerHTML/g) || []).length, /(?<![\w$.])panneau\s*\.\s*innerHTML\s*=(?!=)/.test(sansCommentaires)], [1, true]);
verifier('un seul addEventListener (le clic)', (sansCommentaires.match(/addEventListener\s*\(/g) || []).length, 1);

// ── COMPORTEMENT, dans un bac vm, sur un DOM fabriqué
const SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const b64 = (n = 1) => Buffer.concat([SIG, Buffer.alloc(30, n)]).toString('base64');
const el = (o = {}) => ({
    textContent: '', style: {}, children: [], ecouteurs: {}, tagName: 'DIV', parentElement: null, previousElementSibling: null,
    addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; }, setAttribute() { },
    querySelector(s) { if (/^#rm-[a-z]+$/.test(s)) { this._ids = this._ids || {}; return this._ids[s] || (this._ids[s] = el()); } return null; },
    ...o
});
// une image de la page : lisible, protégée (canvas contaminé), petite, ou pas chargée
const image = (n, { w = 500, h = 700, complete = true, tainted = false, src = `https://cdn-exemple.test/scans/${n}.jpg`, alt = `Carte ${n}`, title = '', parent = null, prev = null } = {}) =>
    ({ _n: n, tagName: 'IMG', naturalWidth: complete ? w : 0, naturalHeight: complete ? h : 0, complete, currentSrc: src, src, alt, title, tainted, parentElement: parent, previousElementSibling: prev, closest(s) { return this._closest && this._closest[s] || null; }, textContent: '' });

function fabriquerMonde({ images = [image(1)], reponses = null, erreur = null, hostname = 'collectorviper.livejournal.com', titre = 'Master Collection Scans Catalogue' } = {}) {
    const appels = [], acces = { cookie: 0, canvasCrees: 0, dessinees: [] };
    const doc = el({ title: titre, body: el() });
    Object.defineProperty(doc, 'cookie', { get() { acces.cookie++; return 'secret=1'; } });
    doc.querySelectorAll = s => (s === 'img' ? images : []);
    doc.querySelector = () => null;
    const elements = [];
    doc.createElement = tag => {
        if (tag === 'canvas') {
            acces.canvasCrees++;
            const c = el({ tag, width: 0, height: 0 });
            c.getContext = () => ({ drawImage(img) { c._img = img; acces.dessinees.push(img._n); } });
            c.toDataURL = () => { if (c._img.tainted) { const e = new Error('The canvas has been tainted by cross-origin data.'); e.name = 'SecurityError'; throw e; } return 'data:image/png;base64,' + b64(c._img._n); };
            return c;
        }
        const e = el({ tag }); elements.push(e); return e;
    };
    doc.body.appendChild = c => c;
    const location = { href: `https://${hostname}/339.html`, origin: `https://${hostname}`, hostname, pathname: '/339.html', search: '', hash: '' };
    const GM_xmlhttpRequest = o => {
        appels.push(o);
        const corps = JSON.parse(o.data);
        setTimeout(() => {
            if (erreur) return o.onerror?.({ error: erreur });
            const r = reponses ? reponses(corps, appels.length) : null;
            if (r) return o.onload?.(r);
            if (corps.type === 'image') return o.onload?.({ status: 200, responseText: JSON.stringify({ ok: true, fichier: 'img-0001.png' }) });
            const c = { vues: corps.images.length, lues: corps.images.filter(e => e.etat === 'lue').length, illisibles: corps.images.filter(e => e.etat === 'illisible').length, sousSeuil: corps.images.filter(e => e.etat === 'sous-seuil').length, manquantes: 0 };
            return o.onload?.({ status: 200, responseText: JSON.stringify({ ok: true, dossier: 'x', comptes: c, etat: 'complet' }) });
        }, 0);
    };
    const bac = { document: doc, location, GM_xmlhttpRequest, window: { location, document: doc }, console, JSON, Date, String, Number, Math, Array, Object, URL, RegExp, Promise, Error };
    bac.window.window = bac.window;
    return { bac, appels, acces, elements, doc };
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
const lancer = w => vm.runInNewContext(SRC, w.bac, { filename: 'userscript-collectorviper.js' });
const texte = w => w.elements.map(e => e.textContent).join(' | ') + ' | ' + w.elements.flatMap(e => Object.values(e._ids || {})).map(e => e.textContent).join(' | ');
const bouton = w => { for (const e of w.elements) for (const c of Object.values(e._ids || {})) if (c.ecouteurs.click) return c; return null; };
const cliquer = async w => { bouton(w).ecouteurs.click({}); await attendre(80); };
const corps = w => w.appels.map(a => JSON.parse(a.data));

(async () => {
    // chargement : rien ne part, rien ne se lit
    let w = fabriquerMonde();
    lancer(w);
    verifier('au chargement : un bouton, AUCUNE requête, AUCUN canvas créé, aucune image dessinée', [!!bouton(w), w.appels.length, w.acces.canvasCrees, w.acces.dessinees.length], [true, 0, 0, 0]);
    await attendre(40);
    verifier('… toujours rien après attente', [w.appels.length, w.acces.canvasCrees], [0, 0]);

    // un clic sur une page de quatre images : lisible, protégée, petite, non chargée
    const entetePage = el({ tagName: 'H2', textContent: ' Neo Genesis \n' });
    const figure = el({ tagName: 'FIGURE', parentElement: el({ tagName: 'DIV', previousElementSibling: entetePage }) });
    const legende = el({ tagName: 'FIGCAPTION', textContent: '  Carte 1 — Pichu \n 1/111 ' });
    const A = image(1, { parent: figure }); A._closest = { figure: Object.assign(figure, { querySelector: s => (s === 'figcaption' ? legende : null) }) };
    const Bi = image(2, { w: 600, h: 800, tainted: true, title: 'carte 2' });
    const C = image(3, { w: LARGEUR_MIN - 1, h: 300 });
    const D = image(4, { complete: false });
    w = fabriquerMonde({ images: [A, Bi, C, D] });
    lancer(w); await cliquer(w);
    const msgs = corps(w);
    verifier('au clic : UNE image lue + UNE clôture de page, rien d\'autre (2 requêtes, toutes POST vers http://127.0.0.1:<port>/releve)', [w.appels.length, w.appels.map(a => a.method), w.appels.every(a => /^http:\/\/127\.0\.0\.1:\d{4,5}\/releve$/.test(a.url)), msgs.map(x => x.type)], [2, ['POST', 'POST'], true, ['image', 'page']]);
    verifier('seules les images à lire sont DESSINÉES (la lisible et la protégée) ; la petite et la non chargée ne le sont jamais', w.acces.dessinees, [1, 2]);
    verifier('l\'image lue part avec ses octets PNG, son indice, le paquet et l\'adresse de la page', [msgs[0].indice, msgs[0].mime, msgs[0].donnees === b64(1), msgs[0].url, /^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(msgs[0].paquet)], [1, 'image/png', true, 'https://collectorviper.livejournal.com/339.html', true]);
    verifier('image et page portent le MÊME paquet', msgs[0].paquet === msgs[1].paquet, true);
    verifier('l\'image protégée est relevée « illisible sans requête » : adresse, dimensions, alt/title gardés, AUCUN octet', [msgs[1].images[1].etat, msgs[1].images[1].raison, msgs[1].images[1].src, msgs[1].images[1].w, msgs[1].images[1].h, msgs[1].images[1].title], ['illisible', 'illisible sans requête', 'https://cdn-exemple.test/scans/2.jpg', 600, 800, 'carte 2']);
    verifier('l\'image sous le seuil est relevée « sous-seuil », sans octets', [msgs[1].images[2].etat, msgs[1].images[2].raison, msgs[1].images[2].w], ['sous-seuil', 'sous le seuil', LARGEUR_MIN - 1]);
    verifier('l\'image non chargée est relevée illisible (rien n\'est forcé), w = 0', [msgs[1].images[3].etat, /non chargée/.test(msgs[1].images[3].raison), msgs[1].images[3].w], ['illisible', true, 0]);
    verifier('la légende (figcaption, espaces normalisés) et l\'intertitre (titre précédent) sont relevés', [msgs[1].images[0].legende, msgs[1].images[0].intertitre, msgs[1].images[0].alt], ['Carte 1 — Pichu 1/111', 'Neo Genesis', 'Carte 1']);
    verifier('page : titre de la page, indices 1..4 dans l\'ordre du document', [msgs[1].titre, msgs[1].images.map(e => e.indice)], ['Master Collection Scans Catalogue', [1, 2, 3, 4]]);
    verifier('les messages passent la validation du récepteur (image et page)', [R.jugerMessage(JSON.stringify(msgs[0])).statut, R.jugerMessage(JSON.stringify(msgs[1])).statut], [200, 200]);
    verifier('en-têtes : Content-Type JSON et l\'en-tête fixe, rien d\'autre ; requête anonyme', [Object.keys(w.appels[0].headers || {}).sort(), w.appels[0].headers['X-Rat-Market'], w.appels[0].anonymous === true], [['Content-Type', 'X-Rat-Market'], R.VALEUR_MARQUE, true]);
    verifier('aucun accès aux cookies', w.acces.cookie, 0);
    verifier('le panneau dit les quatre comptes : 4 images, 1 lue, 2 illisibles, 1 sous le seuil', [/4 images/.test(texte(w)), /1 lue/.test(texte(w)), /2 illisibles/.test(texte(w)), /1 sous le seuil/.test(texte(w))], [true, true, true, true]);
    verifier('le panneau dit pourquoi les illisibles le sont (aucune requête n\'a été faite pour les lire)', /sans requête/.test(texte(w)), true);

    // un seul clic = un seul paquet ; un second clic = un nouveau paquet
    const p1 = msgs[0].paquet;
    await new Promise(r => setTimeout(r, 1100));
    await cliquer(w);
    const apres = corps(w);
    verifier('un second clic ouvre un NOUVEAU paquet (aucune image n\'est réécrite dans l\'ancien)', apres.length === 4 && apres[2].paquet !== p1 && apres[2].paquet === apres[3].paquet, true);

    // récepteur qui refuse l'image : relevée illisible avec le motif, jamais comptée lue
    w = fabriquerMonde({ images: [image(1)], reponses: (c) => (c.type === 'image' ? { status: 415, responseText: JSON.stringify({ ok: false, motif: 'signature PNG absente (test)' }) } : null) });
    lancer(w); await cliquer(w);
    const refus = corps(w);
    verifier('image refusée par le récepteur : l\'entrée devient « illisible », motif gardé, la page est quand même clôturée', [refus.length, refus[1]?.images[0].etat, /signature PNG absente \(test\)/.test(refus[1]?.images[0].raison || '')], [2, 'illisible', true]);

    // récepteur éteint : arrêt net, un message qui dit de le lancer, UNE seule tentative
    w = fabriquerMonde({ erreur: 'connexion refusée' });
    lancer(w); await cliquer(w);
    verifier('récepteur injoignable : une seule tentative, un message qui dit de lancer le récepteur', [w.appels.length, /récepteur/i.test(texte(w)), /node recepteur-collectorviper\.js/.test(texte(w))], [1, true, true]);

    // mauvaise page : rien n'est envoyé ni lu
    w = fabriquerMonde({ hostname: 'exemple.livejournal.com' });
    lancer(w); await cliquer(w);
    verifier('hors de la page attendue : rien n\'est envoyé, aucun canvas', [w.appels.length, w.acces.canvasCrees], [0, 0]);

    // trop d'images : le surplus est dit, jamais relevé en silence
    const beaucoup = Array.from({ length: 305 }, (_, i) => image(i + 1, { w: 50, h: 50 }));
    w = fabriquerMonde({ images: beaucoup });
    lancer(w); await cliquer(w);
    const gros = corps(w);
    verifier('305 images : 300 relevées, le surplus (5) est DIT à l\'écran', [gros.length, gros[0]?.images.length, /5 image\(s\) au-delà/.test(texte(w))], [1, 300, true]);
    // aucune image
    w = fabriquerMonde({ images: [] });
    lancer(w); await cliquer(w);
    verifier('aucune image sur la page : rien n\'est envoyé, le panneau le dit', [w.appels.length, /aucune image/i.test(texte(w))], [0, true]);

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

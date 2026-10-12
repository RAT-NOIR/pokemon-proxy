// node test-userscript-pikaqian.js — le userscript PASSIF de PikaQian (userscript-pikaqian.js) : test STATIQUE (aucune adresse hors 127.0.0.1, aucune navigation,
// l'envoi dans le seul gestionnaire du bouton) et test de COMPORTEMENT dans un bac `vm` (faux document, faux GM_xmlhttpRequest : aucune requête réelle).
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

const SRC = fs.readFileSync(path.join(__dirname, 'userscript-pikaqian.js'), 'utf8');
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
verifier('@connect : 127.0.0.1 SEULEMENT', valeurs('connect'), ['127.0.0.1']);
const adresses = [...sansCommentaires.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*/gi)].map(x => x[0]);
verifier('dans le code : toute adresse est http://127.0.0.1:<port> (le port vient de la constante PORT)', adresses.every(a => /^http:\/\/127\.0\.0\.1:$/.test(a)) && adresses.length >= 1, true);
const PORT_US = /^\s*var PORT = (\d{4,5});/m.exec(code);
verifier('PORT : une constante unique en tête du script, égale au port par défaut du récepteur', [!!PORT_US, Number(PORT_US?.[1]) === R.PORT_DEFAUT, (code.match(/\bPORT\b/g) || []).length >= 2, code.indexOf('var PORT') < code.indexOf('GM_xmlhttpRequest')], [true, true, true, true]);
const CODE_US = /var CODE_DE_SET = '([^']+)';/.exec(code);
verifier('le motif de code de set du script est celui de CODE_PK (pikaqian.js)', `^${CODE_US?.[1]}$`, P.CODE_PK.source);
const ENTETE_US = /'X-Rat-Market':\s*'([^']+)'/.exec(code);
verifier('l\'en-tête fixe du script est celui que le récepteur exige', [R.ENTETE_MARQUE, ENTETE_US?.[1]], ['x-rat-market', R.VALEUR_MARQUE]);
verifier('le script ne pose PAS d\'en-tête Origin (la garde n\'en dépend pas)', /['"]Origin['"]/i.test(sansCommentaires), false);
verifier('aucun nom d\'hôte de pikaqian, de son CDN ou du CDN officiel dans le code exécutable', /pikaqian|pokemon-tcg|pokemon\.cn|localhost/i.test(sansCommentaires), false);
const interdits = [
    ['location.href =', /location\s*\.\s*href\s*=[^=]/], ['location.assign/replace', /location\s*\.\s*(assign|replace)\s*\(/], ['location = ', /\blocation\s*=[^=]/],
    ['.click()', /\.\s*click\s*\(/], ['window.open', /window\s*\.\s*open\s*\(/], ['fetch(', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['sendBeacon', /sendBeacon/],
    ['document.cookie', /document\s*\.\s*cookie/], ['localStorage/sessionStorage/indexedDB', /localStorage|sessionStorage|indexedDB/], ['GM_getValue/GM_setValue/GM_cookie', /GM_(getValue|setValue|cookie|openInTab|download)/],
    ['new Image / new WebSocket / EventSource', /new\s+(Image|WebSocket|EventSource)\b/], ['dispatchEvent dans la page', /dispatchEvent/], ['innerHTML (injection)', /\.\s*innerHTML\s*=/],
    ['setInterval / setTimeout (aucune action différée)', /\bset(Interval|Timeout)\s*\(/], ['MutationObserver', /MutationObserver/], ['eval / Function', /\beval\s*\(|new\s+Function\b/]
];
for (const [nom, re] of interdits) verifier(`interdit absent : ${nom}`, re.test(sansCommentaires), false);
verifier('GM_xmlhttpRequest est appelé UNE seule fois dans le code', (sansCommentaires.match(/GM_xmlhttpRequest\s*\(/g) || []).length, 1);
// l'envoi n'a lieu que dans le gestionnaire du bouton : l'appel est DANS le corps de la fonction passée à addEventListener('click', …)
{
    const i = sansCommentaires.search(/addEventListener\(\s*'click'/);
    let debut = sansCommentaires.indexOf('{', i), prof = 0, fin = -1;
    for (let k = debut; k < sansCommentaires.length; k++) { if (sansCommentaires[k] === '{') prof++; else if (sansCommentaires[k] === '}' && --prof === 0) { fin = k; break; } }
    const appel = sansCommentaires.search(/GM_xmlhttpRequest\s*\(/);
    verifier('l\'appel à GM_xmlhttpRequest est dans le gestionnaire du clic', i >= 0 && appel > debut && appel < fin, true);
    verifier('un seul addEventListener dans tout le code', (sansCommentaires.match(/addEventListener\s*\(/g) || []).length, 1);
}
verifier('le script n\'envoie ni cookie ni en-tête du site (corps = url + html seulement)', /JSON\.stringify\(\s*\{\s*url\s*,\s*html\s*\}\s*\)|JSON\.stringify\(\s*\{\s*url:[^}]*html:[^}]*\}\s*\)/.test(sansCommentaires), true);

// ── COMPORTEMENT, dans un bac vm
function fabriquerMonde({ reponse = { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', tuilesLues: 315, tuilesAuCode: 315, officielles: 1, natives: 1, fichier: 'cs1bc--x.json' }) }, erreur = null } = {}) {
    const elements = [], appels = [];
    const el = tag => { const e = { tag, style: {}, children: [], ecouteurs: {}, textContent: '', addEventListener(t, f) { this.ecouteurs[t] = f; }, appendChild(c) { this.children.push(c); return c; }, setAttribute() { } }; elements.push(e); return e; };
    const document = { body: el('body'), documentElement: { outerHTML: '<html><body>PAGE-DU-NAVIGATEUR</body></html>' }, createElement: el, querySelector: () => null };
    const location = { href: 'https://pikaqian.com/sets/cs1bc?x=1#h', origin: 'https://pikaqian.com', pathname: '/sets/cs1bc', search: '?x=1', hash: '#h' };
    const GM_xmlhttpRequest = o => { appels.push(o); setTimeout(() => (erreur ? o.onerror?.({ error: erreur }) : o.onload?.(reponse)), 0); };
    const bac = { document, location, GM_xmlhttpRequest, window: { location, document }, console, JSON, setTimeout, Date, String, Number, Math };
    bac.window.window = bac.window;
    return { bac, elements, appels };
}
(async () => {
    let w = fabriquerMonde();
    vm.runInNewContext(SRC, w.bac, { filename: 'userscript-pikaqian.js' });
    const bouton = w.elements.find(e => e.ecouteurs.click);
    verifier('au chargement : un bouton, et AUCUNE requête', [!!bouton, w.appels.length], [true, 0]);
    verifier('le bouton s\'appelle « Apprendre cette page »', /Apprendre cette page/.test(bouton?.textContent || ''), true);
    await new Promise(r => setTimeout(r, 30));
    verifier('… toujours aucune requête après attente (rien ne part seul)', w.appels.length, 0);
    bouton.ecouteurs.click({});
    await new Promise(r => setTimeout(r, 30));
    verifier('au clic : UNE requête', w.appels.length, 1);
    const a = w.appels[0] || {};
    verifier('POST vers http://127.0.0.1:<port>/apprendre', [a.method, /^http:\/\/127\.0\.0\.1:\d{4,5}\/apprendre$/.test(a.url || '')], ['POST', true]);
    const corps = JSON.parse(a.data || '{}');
    verifier('corps : exactement url (sans requête ni ancre) et html (outerHTML tel que le navigateur l\'a)', [Object.keys(corps).sort(), corps.url, corps.html], [['html', 'url'], 'https://pikaqian.com/sets/cs1bc', '<html><body>PAGE-DU-NAVIGATEUR</body></html>']);
    verifier('en-têtes : Content-Type JSON et l\'en-tête fixe, rien d\'autre', [Object.keys(a.headers || {}).sort(), a.headers?.['Content-Type'], a.headers?.['X-Rat-Market']], [['Content-Type', 'X-Rat-Market'], 'application/json', R.VALEUR_MARQUE]);
    verifier('aucun cookie demandé (anonymous / pas de withCredentials)', [a.anonymous === true || a.anonymous === undefined, a.withCredentials === undefined || a.withCredentials === false], [true, true]);
    const affiche = w.elements.map(e => e.textContent).join(' | ');
    verifier('la réponse du récepteur s\'affiche : tuiles lues, au code du set, adresses officielles', /315/.test(affiche) && /officiel/i.test(affiche) && /1/.test(affiche), true);
    // l'anomalie « flux absent » est montrée au testeur
    w = fabriquerMonde({ reponse: { status: 200, responseText: JSON.stringify({ ok: true, code: 'cs1bc', ancres: 315, tuilesLues: 315, tuilesAuCode: 315, flux: 'absent', officielles: 0, fichier: 'x.json', anomalie: 'FLUX DE DONNÉES ABSENT : test' }) } });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await new Promise(r => setTimeout(r, 30));
    verifier('flux absent : l\'anomalie est affichée', /FLUX DE DONNÉES ABSENT/.test(w.elements.map(e => e.textContent).join(' | ')), true);

    // un refus du récepteur : son motif est affiché
    w = fabriquerMonde({ reponse: { status: 422, responseText: JSON.stringify({ ok: false, motif: '3 tuiles sur 9 portent le code cs1bc : la page ne désigne pas ce set' }) } });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await new Promise(r => setTimeout(r, 30));
    verifier('refus du récepteur (422) : la raison est affichée', /ne désigne pas ce set/.test(w.elements.map(e => e.textContent).join(' | ')), true);
    // récepteur éteint
    w = fabriquerMonde({ erreur: 'connexion refusée' });
    vm.runInNewContext(SRC, w.bac);
    w.elements.find(e => e.ecouteurs.click).ecouteurs.click({});
    await new Promise(r => setTimeout(r, 30));
    verifier('récepteur injoignable : un message qui dit de le lancer, aucune autre requête', [/récepteur/i.test(w.elements.map(e => e.textContent).join(' | ')), w.appels.length], [true, 1]);
    // une page qui n'est pas /sets/<code> : le script ne l'envoie pas
    w = fabriquerMonde();
    w.bac.location.pathname = '/cards/abc'; w.bac.window.location.pathname = '/cards/abc';
    vm.runInNewContext(SRC, w.bac);
    const b2 = w.elements.find(e => e.ecouteurs.click);
    if (b2) { b2.ecouteurs.click({}); await new Promise(r => setTimeout(r, 30)); }
    verifier('hors d\'une page /sets/<code> : rien n\'est envoyé', w.appels.length, 0);

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

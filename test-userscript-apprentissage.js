// node test-userscript-apprentissage.js — banc du userscript (1.9) dans un VRAI Chrome (Puppeteer), SANS UNE REQUÊTE vers Cardmarket : l'interception répond à la
// ⚠️ 2026-09-26 (1.9) : cas 10, 11, 13 réécrits — une vignette sans image n'est plus écartée, elle part par son lien et son titre ;
// cas 15 : une vignette SANS lien reste écartée, et deux sans-image ne se fondent pas en une à l'envoi.
// ⚠️ 2026-09-25 : trois assertions supposaient la liste de la 1.6 (« n° 1/42 », « suivante : 6604 ») et échouaient depuis la 1.7
// sans que personne ne relance le banc — elles lisent désormais la liste DANS le script. Cas 10 à 13 : le journal de la 1.8.
// navigation avec une galerie fabriquée (la structure que le script lit : a.galleryBox, img data-echo, h2 « (CODE n°) »),
// et bloque toute autre requête. GM_* et le serveur sont simulés : 503 → /ping → 429 (reset 2 s) → 200.
const R = __dirname;
const fs = require('fs');
const puppeteer = require(`${R}/node_modules/puppeteer`);
const SCRIPT = fs.readFileSync(`${R}/userscript-apprentissage.js`, 'utf8');
// La liste et les comptes de l'export, lus DANS le script : le banc ne suppose plus une liste figée.
const LISTE = eval(/const LISTE = (\[[\s\S]*?\]\]);/.exec(SCRIPT)[1]);
const PRODUITS_EXPORT = JSON.parse(/const PRODUITS_EXPORT = (\{.*?\});/.exec(SCRIPT)[1]);
const URL1 = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/30th-Celebration';
const carte = (id, slug, nom, n) => `<a class="galleryBox" href="/fr/Pokemon/Products/Singles/30th-Celebration/${slug}"><img data-echo="https://product-images.s3.cardmarket.com/51/30C/${id}/${id}.jpg" alt="${nom}"><h2>${nom} (30C ${n})</h2></a>`;
const HTML = `<!doctype html><html><head><title>30th Celebration</title></head><body>
${carte(907765, 'Exeggcute-30C001', 'Noeunoeuf', '001')}${carte(907766, 'Alolan-Exeggutor-V1-30C002', "Noadkoko d'Alola", '002')}${carte(907767, 'Volbeat-30C003?language=2', 'Muciole', '003')}
<ul class="pagination"><li><a href="${URL1}?site=2">2</a></li><li><span>10</span></li></ul></body></html>`;
// La DERNIÈRE page (site=10) : la pagination n'offre aucun « 11 », donc aucune page suivante.
const URL_DERNIERE = `${URL1}?site=10`;
const HTML_DERNIERE = HTML.replace(`<li><a href="${URL1}?site=2">2</a></li><li><span>10</span></li>`, `<li><a href="${URL1}?site=9">9</a></li><li><span>10</span></li>`);

// Les shims : stockage GM en mémoire de la page, et un serveur scripté. Chaque appel est journalisé dans window.__appels.
const SHIMS = (etatInitial, reponses) => `
window.__store = ${JSON.stringify(etatInitial)};
window.GM_getValue = (k, d) => (k in window.__store ? JSON.parse(JSON.stringify(window.__store[k])) : d);
window.GM_setValue = (k, v) => { window.__store[k] = JSON.parse(JSON.stringify(v)); };
window.__appels = []; window.__reponses = ${JSON.stringify(reponses)};
window.GM_xmlhttpRequest = o => {
  const chemin = o.url.replace(/^https?:\\/\\/[^/]+/, '');
  window.__appels.push({ chemin, corps: o.data ? JSON.parse(o.data) : null, t: Date.now() });
  const r = chemin === '/ping' ? { status: 200, corps: { ok: true, mongo: true } } : (window.__reponses.shift() || { status: 500, corps: { success: false } });
  setTimeout(() => o.onload({ status: r.status, responseText: JSON.stringify(r.corps), responseHeaders: r.entetes || '' }), 50);
};`;
const OK = (n, couverture = { produits: 191, avecNumero: 103, appris: 103, pourcent: 54 }) => ({ status: 200, entetes: 'ratelimit-remaining: 117\r\nratelimit-reset: 3500', corps: { success: true, recus: n, nouvelles: n, ameliorees: 0, dejaExactes: 0, completees: 0, sansNumero: 0, idExpansion: 6601, idExpansions: [6601], couverture } });

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

async function charger(navigateur, etat, reponses, attenteMs, { url = URL1, html = HTML } = {}) {
    const page = await navigateur.newPage();
    const sorties = [];
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.isNavigationRequest() && req.url().startsWith('https://www.cardmarket.com/')) { sorties.push(req.url()); return req.respond({ status: 200, contentType: 'text/html', body: html }); }
        sorties.push('BLOQUÉE ' + req.url()); req.abort();
    });
    await page.evaluateOnNewDocument(SHIMS(etat, reponses));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: SCRIPT });
    await new Promise(r => setTimeout(r, attenteMs));
    const res = await page.evaluate(() => ({ appels: window.__appels, store: window.__store, panneau: document.body.lastElementChild.innerText }));
    await page.close();
    return { ...res, sorties };
}

(async () => {
    const navigateur = await puppeteer.launch({ headless: true });
    try {
        // 1. Auto au chargement : 503 → attente /ping → renvoi → 429 (reprise dans 2 s + 3 s) → 200.
        const A = await charger(navigateur, {}, [{ status: 503, corps: { success: false, error: 'Le serveur se réveille' } }, { status: 429, entetes: 'ratelimit-reset: 2\r\nratelimit-remaining: 0', corps: { success: false } }, OK(3)], 9000);
        const lots = A.appels.filter(x => x.chemin === '/api/apprendre-lot');
        // Toute requête autre que la navigation simulée est BLOQUÉE (jamais émise) ; la seule tentée est le favicon que
        // Chrome demande de lui-même. Le script, lui, n'en tente aucune vers Cardmarket.
        verifier('1. rien ne sort : seule requête tentée hors navigation = le favicon du navigateur, bloqué', A.sorties.filter(s => s.startsWith('BLOQUÉE')), ['BLOQUÉE https://www.cardmarket.com/favicon.ico']);
        verifier('   séquence : lot 503 → /ping → lot 429 → lot 200', A.appels.map(x => x.chemin === '/ping' ? 'ping' : 'lot'), ['lot', 'ping', 'lot', 'lot']);
        verifier('   chaque lot porte le userId', lots.every(l => /^rm-/.test(l.corps.userId)), true);
        verifier('   un seul envoi pour la page entière (3 cartes), pas de lots de 25', lots.map(l => l.corps.cartes.length), [3, 3, 3]);
        // Seconde relecture (2026-09-26, nuit) : la variante n'est plus envoyée — le serveur la relit du slug (une seule règle, la sienne ;
        // la copie du script exigeait un tiret après « Vk » et ratait « Mewtwo-V-UNION-V3 »).
        verifier('   slug nettoyé de sa query string, numéro du titre, code décodé, AUCUNE variante envoyée', lots[0].corps.cartes[2], { idProduct: 907767, numero: '003', codeSet: '30C', nomFr: 'Muciole', slug: 'Volbeat-30C003', slugSet: '30th-Celebration' });
        verifier('   (point 1) aucune carte du lot ne porte de variante calculée par le client', lots[0].corps.cartes.some(c => 'variante' in c), false);
        // Point 8 : le panneau dit sa version (l'export et le journal la disaient, le panneau non).
        verifier('   (point 8) le panneau affiche la version du script', new RegExp(`Apprentissage ${/@version\s+(\S+)/.exec(SCRIPT)[1].replace('.', '\\.')}`).test(A.panneau), true);
        verifier('   la file est vide au succès', A.store.rm_file, []);
        verifier('   la page est marquée apprise', Object.keys(A.store.rm_pagesFaites || {}), ['/fr/Pokemon/Products/Singles/30th-Celebration']);
        verifier('   l\'expansion apprise pour ce slug : 6601', A.store.rm_slugExp, { '30th-Celebration': 6601 });
        verifier('   le panneau : place dans la liste (6601 hors liste), appris, budget', [/expansion hors liste/.test(A.panneau), /103\/191 produits appris/.test(A.panneau), /reste 117 envoi/.test(A.panneau), /3 nouvelles/.test(A.panneau)], [true, true, true, true]);
        verifier(`   la suivante est la tête de la liste, ${LISTE[0][0]} (filtre d'expansion du site, sans perSite)`, new RegExp(`suivante : ${LISTE[0][0]}`).test(A.panneau), true);
        // 1.6 : l'état d'envoi ne survit pas au succès, et la page qu'on VIENT d'envoyer n'est pas « déjà apprise ».
        verifier('   après le succès : plus de « Envoi : », « page envoyée », pas de « déjà apprise »', [/Envoi :/.test(A.panneau), /page envoyée/.test(A.panneau), /déjà apprise/.test(A.panneau)], [false, true, false]);

        // 2. Page déjà apprise, rechargée : RIEN n'est envoyé (le budget de 120/h est gardé).
        const B = await charger(navigateur, A.store, [OK(3)], 1500);
        verifier('2. page déjà apprise : 0 envoi', B.appels.length, 0);
        verifier('   et le panneau le dit', /déjà apprise/.test(B.panneau), true);

        // 3. Une file laissée par des pages précédentes (même galerie) part GROUPÉE avec la page ouverte : UN envoi.
        const reste = { rm_file: [{ cle: '/fr/Pokemon/Products/Singles/30th-Celebration?site=2', slugSet: '30th-Celebration', cartes: [{ idProduct: 1, numero: '020', slugSet: '30th-Celebration' }, { idProduct: 2, numero: '021', slugSet: '30th-Celebration' }], le: 1 }] };
        const C = await charger(navigateur, reste, [OK(5)], 1500);
        verifier('3. file + page ouverte : un seul envoi de 5 cartes', C.appels.filter(x => x.chemin === '/api/apprendre-lot').map(l => l.corps.cartes.length), [5]);
        verifier('   file vide ensuite, deux pages marquées', [C.store.rm_file.length, Object.keys(C.store.rm_pagesFaites).length], [0, 2]);

        // 4. Un 400 ARRÊTE (défaut à corriger, pas à marteler) et GARDE la page dans la file.
        const D = await charger(navigateur, {}, [{ status: 400, corps: { success: false, error: 'Identifiant utilisateur manquant' } }, OK(3)], 1500);
        verifier('4. 400 : un seul essai, la page reste en file, le message le dit', [D.appels.length, D.store.rm_file.length, /version du script/.test(D.panneau)], [1, 1, true]);

        // 5. LE CAS RÉEL DU 2026-09-24 : dernière page de 30th Celebration, 191/191 appris, 161 numérotés (84 %).
        //    La 1.5 disait « terminée ✅ » pour une mauvaise raison ; la 1.6 dit « complète » pour la bonne, et explique les 30.
        const E = await charger(navigateur, {}, [OK(3, { produits: 191, avecNumero: 161, appris: 191, pourcent: 84 })], 1500, { url: URL_DERNIERE, html: HTML_DERNIERE });
        verifier('5. 191/191 appris : « complète », les 30 sans numéro de titre expliqués, le compte de la liste affiché', [/191\/191 produits appris/.test(E.panneau), /30 sans numéro dans leur titre/.test(E.panneau), /expansion complète/.test(E.panneau), /\d+ faite\(s\)/.test(E.panneau)], [true, true, true, true]);
        verifier('   dernière page : pas de page suivante, marquée « parcourue »', [/Dernière page/.test(E.panneau), E.store.rm_couv['6601'].parcourue], [true, true]);

        // 6. Dernière page, mais 6 produits jamais vus : « parcourue », JAMAIS « complète ».
        const F = await charger(navigateur, {}, [OK(3, { produits: 191, avecNumero: 161, appris: 185, pourcent: 84 })], 1500, { url: URL_DERNIERE, html: HTML_DERNIERE });
        verifier('6. 185/191 : « galerie parcourue : 6 produit(s) … jamais vu(s) », pas « complète »', [/6 produit\(s\) du catalogue jamais vu/.test(F.panneau), /expansion complète/.test(F.panneau)], [true, false]);

        // 7. Serveur pas encore redéployé (pas de champ `appris`) : repli sur le seuil des numéros, et c'est DIT.
        const G = await charger(navigateur, {}, [OK(3, { produits: 191, avecNumero: 161, pourcent: 84 })], 1500);
        verifier('7. sans `appris` : le panneau dit que le serveur n\'est pas redéployé', /pas encore redéployé/.test(G.panneau), true);

        // 8. LE CAS RÉEL DU 2026-09-24 : Unnumbered Promos (4170). Aucune carte n'a de numéro, ni dans le titre ni dans le
        //    slug : la route d'avant jetait tout le lot, et la 1.6 marquait pourtant la page « apprise ». La 1.7 la RENVOIE.
        const URL_UNP = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Unnumbered-Promos';
        const unp = (id, slug, nom) => `<a class="galleryBox" href="/fr/Pokemon/Products/Singles/Unnumbered-Promos/${slug}"><img data-echo="https://product-images.s3.cardmarket.com/51/UNP/${id}/${id}.jpg" alt="${nom}"><h2>${nom}</h2></a>`;
        const HTML_UNP = `<!doctype html><html><body>${unp(806285, 'Boss-s-Orders-Lysandre-UNP', 'Boss\'s Orders - Lysandre')}${unp(903176, 'Arceus-Lv100-Judgment-UNP', 'Arceus Lv.100')}</body></html>`;
        const OK_UNP = { status: 200, entetes: 'ratelimit-remaining: 110', corps: { success: true, recus: 2, nouvelles: 2, ameliorees: 0, dejaExactes: 0, completees: 0, sansNumero: 2, ignorees: 0, idExpansion: 4170, idExpansions: [4170], couverture: { produits: 208, avecNumero: 0, appris: 207, pourcent: 0 } } };
        const H = await charger(navigateur, { rm_pagesFaites: { '/fr/Pokemon/Products/Singles/Unnumbered-Promos': { le: 1, n: 2 } } }, [OK_UNP], 1500, { url: URL_UNP, html: HTML_UNP });
        verifier('8. page sans numéro marquée par la 1.6 : RENVOYÉE (1 envoi, 2 cartes, slug compris)', H.appels.filter(x => x.chemin === '/api/apprendre-lot').map(l => [l.corps.cartes.length, l.corps.cartes[0].slug]), [[2, 'Boss-s-Orders-Lysandre-UNP']]);
        verifier('   le bilan dit « appris par leur slug », jamais « ignorées »', [/2 sans numéro : appris par leur slug/.test(H.panneau), /ignorées/.test(H.panneau)], [true, false]);
        verifier('   et la page est marquée par la 1.7', H.store.rm_pagesFaites['/fr/Pokemon/Products/Singles/Unnumbered-Promos'].v, 17);

        // 9. Une page NUMÉROTÉE marquée par la 1.6 reste apprise : la route d'avant l'avait bien écrite.
        const I = await charger(navigateur, { rm_pagesFaites: { '/fr/Pokemon/Products/Singles/30th-Celebration': { le: 1, n: 3 } } }, [OK(3)], 1500);
        verifier('9. page numérotée marquée par la 1.6 : 0 envoi', I.appels.length, 0);

        // 10-13. LE JOURNAL DE LA 1.8, sur une page de DRI par le filtre d'expansion : une vignette ordinaire, une image chargée
        //        par `data-src` en webp (lue, et dite), une image de remplacement sans idProduct (ÉCARTÉE, comptée, gardée) ;
        //        Cardmarket annonce 240 résultats avec une case « onlyAvailable » cochée — moins que l'export.
        const URL_DRI = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles?idCategory=51&idExpansion=6096';
        const dri = (id, slug, nom, n, attr = 'data-echo', ext = 'jpg') => `<a class="galleryBox" href="/fr/Pokemon/Products/Singles/Destined-Rivals/${slug}"><img ${attr}="https://product-images.s3.cardmarket.com/51/DRI/${id}/${id}.${ext}" alt="${nom}"><h2>${nom} (DRI ${n})</h2></a>`;
        // `<meta charset>` : sans lui Chrome décode la page fabriquée en windows-1252 et « résultats » devient illisible.
        // La forme RÉELLE du visuel de remplacement, lue dans le journal 1.8 du 2026-09-26 : `src=//static.cardmarket.com/img/<hash>/cardImageNotAvailable.png`.
        const INDISPONIBLE = '//static.cardmarket.com/img/3660af732e89ee7bfadc4b521fe525c1/cardImageNotAvailable.png';
        const HTML_DRI = `<!doctype html><html><head><meta charset="utf-8"></head><body><div><span>240 résultats</span></div><form><input type="checkbox" name="onlyAvailable" value="Y" checked><input type="checkbox" name="isFoil" value="Y"></form>
${dri(826050, 'Aaa-DRI001', 'Aaa', '001')}${dri(826051, 'Bbb-DRI002', 'Bbb', '002', 'data-src', 'webp')}<a class="galleryBox" href="/fr/Pokemon/Products/Singles/Destined-Rivals/Ccc-DRI003"><img src="${INDISPONIBLE}" alt="Ccc"><h2>Ccc (DRI 003)</h2></a></body></html>`;
        const OK_DRI = { status: 200, entetes: 'ratelimit-remaining: 100', corps: { success: true, recus: 3, nouvelles: 1, ameliorees: 0, dejaExactes: 1, completees: 0, sansNumero: 0, ignorees: 0, deduites: 1, nonDeduites: 0, idExpansion: 6096, idExpansions: [6096], couverture: { produits: 244, avecNumero: 240, appris: 243, pourcent: 98 } } };
        const J = await charger(navigateur, {}, [OK_DRI], 1500, { url: URL_DRI, html: HTML_DRI });
        const lotJ = J.appels.filter(x => x.chemin === '/api/apprendre-lot');
        // 1.9 (testeur, 2026-09-26) : un produit n'est plus JAMAIS écarté à cause de son image — il part par son lien et son titre,
        // sans idProduct, et c'est le serveur qui le déduit (collecte-cartes/deduire-produit.js).
        verifier('10. 3 vignettes, 3 lues (le webp en data-src, et la sans-image par son lien) : l\'envoi porte les 3', lotJ.map(l => l.corps.cartes.map(c => c.idProduct)), [[826050, 826051, null]]);
        verifier('   la sans-image part avec son slug, son numéro et son code de TITRE, marquée', lotJ[0]?.corps.cartes[2], { idProduct: null, numero: '003', codeSet: 'DRI', nomFr: 'Ccc', slug: 'Ccc-DRI003', slugSet: 'Destined-Rivals', sansImage: true });
        const e = (J.store.rm_journal || [])[0] || {};
        verifier('11. le journal : vignettes, lues, 0 écartée, 1 sans image (avec son lien), lecture non standard dite', [e.v, e.vignettes, e.lues, e.ecartees, e.sansImage, e.detailSansImage?.[0]?.href, e.lecturesAutres], ['1.9', 3, 3, 0, 1, '/fr/Pokemon/Products/Singles/Destined-Rivals/Ccc-DRI003', ['826051:data-src:webp']]);
        verifier('12. le journal : total annoncé, export, filtres COCHÉS seulement, paramètres, réponse du serveur', [e.totalAnnonce?.n, e.produitsExport, e.filtres, e.params, e.envoi?.status, e.envoi?.nouvelles, e.envoi?.deduites],
            [240, PRODUITS_EXPORT['6096'], ['onlyAvailable=Y'], ['idCategory=51', 'idExpansion=6096'], 200, 1, 1]);
        verifier('13. le panneau : la sans-image dite (envoyée par son lien), la déduction du serveur, total contre export, filtre nommé, bouton du journal',
            [/1 sans image : envoyée\(s\) par son lien/.test(J.panneau), /1 déduite\(s\) par le serveur/.test(J.panneau), /écartée/.test(J.panneau), new RegExp(`Cardmarket annonce 240 · l'export en compte ${PRODUITS_EXPORT['6096']}`).test(J.panneau), /onlyAvailable=Y/.test(J.panneau), /📥 1/.test(J.panneau)], [true, true, false, true, true, true]);
        // 15. Une vignette SANS lien ni image ne peut rien apprendre : elle reste écartée, et deux sans-image ne se fondent pas en une.
        const sansImage = (slug, nom, n, src = INDISPONIBLE) => `<a class="galleryBox"${slug ? ` href="/fr/Pokemon/Products/Singles/Destined-Rivals/${slug}"` : ''}><img src="${src}" alt="${nom}"><h2>${nom} (DRI ${n})</h2></a>`;
        const HTML_DRI2 = `<!doctype html><html><head><meta charset="utf-8"></head><body>${dri(826050, 'Aaa-DRI001', 'Aaa', '001')}${sansImage('Ccc-DRI003', 'Ccc', '003')}${sansImage('Ddd-DRI004', 'Ddd', '004')}${sansImage(null, 'Zzz', '099')}${sansImage('Eee-DRI005', 'Eee', '005', 'https://static.cardmarket.com/img/noimage.png')}</body></html>`;
        const L2 = await charger(navigateur, {}, [OK_DRI], 1500, { url: URL_DRI, html: HTML_DRI2 });
        const e2 = (L2.store.rm_journal || [])[0] || {};
        verifier('15. sans lien : écartée ; deux « cardImageNotAvailable » : deux cartes envoyées, pas fondues en une', [L2.appels.filter(x => x.chemin === '/api/apprendre-lot').map(l => l.corps.cartes.filter(c => c.sansImage).map(c => c.slug))[0]], [['Ccc-DRI003', 'Ddd-DRI004']]);
        verifier('16. une AUTRE image illisible (noimage.png) ne part pas en déduction : écartée, au journal avec ses attributs', [e2.ecartees, e2.detailEcartees?.map(x => x.href), /noimage\.png/.test(JSON.stringify(e2.detailEcartees?.[1]?.image))], [2, ['', '/fr/Pokemon/Products/Singles/Destined-Rivals/Eee-DRI005'], true]);
        // 17. Une page MARQUÉE par la 1.8 (sans `v: 19`) qui porte une sans-image repart d'elle-même : la 1.8 l'avait écartée.
        const M = await charger(navigateur, { rm_pagesFaites: { [`/fr/Pokemon/Products/Singles?idCategory=51&idExpansion=6096`]: { le: 1, n: 2, v: 17 } } }, [OK_DRI], 1500, { url: URL_DRI, html: HTML_DRI });
        verifier('17. page marquée par la 1.8 avec une sans-image : RENVOYÉE sans « Réapprendre », puis marquée v:19', [M.appels.filter(x => x.chemin === '/api/apprendre-lot').length, M.store.rm_pagesFaites['/fr/Pokemon/Products/Singles?idCategory=51&idExpansion=6096']?.v], [1, 19]);
        const M2 = await charger(navigateur, M.store, [OK_DRI], 1500, { url: URL_DRI, html: HTML_DRI });
        verifier('   et marquée v:19, elle ne repart plus', M2.appels.filter(x => x.chemin === '/api/apprendre-lot').length, 0);
        // 18. L'export du journal et le panneau portent la version et la date RÉELLE de la liste.
        verifier('18. le panneau dit la date de la liste générée, pas « 25/09 »', [/Liste du 25\/09/.test(J.panneau), new RegExp(`Liste du ${new Date(Date.parse(/MESURE_LISTE = Date\.parse\('([^']+)'\)/.exec(SCRIPT)[1])).toISOString().slice(8, 10)}/`).test(J.panneau)], [false, true]);
        // Une seule écriture de la version (la constante VERSION, égale à l'en-tête) : l'export, le journal et le panneau la lisent.
        verifier('   l\'export du journal se déclare 1.9 (constante VERSION = en-tête @version, lue par l\'export)', [/const VERSION = '([^']+)'/.exec(SCRIPT)?.[1], /@version\s+(\S+)/.exec(SCRIPT)[1], /script: VERSION/.test(SCRIPT)], ['1.9', '1.9', true]);
        // 19-21. POINT 6 (seconde relecture) : un ÉCHEC de la déduction ne marque pas la page ; l'erreur et les raisons sont dites et
        //        journalisées ; une cible sans image DÉDUITE est marquée faite (le serveur rend les idProduct déduits).
        const ERR = { status: 200, entetes: 'ratelimit-remaining: 99', corps: { success: true, recus: 3, nouvelles: 1, ameliorees: 0, dejaExactes: 1, completees: 0, sansNumero: 0, ignorees: 0,
            deduites: 0, nonDeduites: 1, raisonsNonDeduites: { 'erreur du serveur pendant la déduction (rien d\'écrit)': 1 }, erreurDeduction: 'déduction impossible (voir la console du serveur) — rien n\'a été écrit', idsDeduits: [],
            idExpansion: 6096, idExpansions: [6096], couverture: { produits: 244, avecNumero: 240, appris: 243, pourcent: 98 } } };
        const N1 = await charger(navigateur, {}, [ERR], 1500, { url: URL_DRI, html: HTML_DRI });
        const eN = (N1.store.rm_journal || [])[0] || {};
        verifier('19. (point 6) erreurDeduction : la page n\'est PAS marquée (ses sans-image repartiront), la file est vidée (les cartes lues sont écrites)',
            [Object.keys(N1.store.rm_pagesFaites || {}).includes('/fr/Pokemon/Products/Singles?idCategory=51&idExpansion=6096'), (N1.store.rm_file || []).length], [false, 0]);
        verifier('   l\'erreur et les raisons sont dans le panneau ET au journal',
            [/déduction impossible/.test(N1.panneau), /erreur du serveur pendant la déduction/.test(N1.panneau), eN.envoi?.erreurDeduction, eN.envoi?.raisonsNonDeduites],
            [true, true, ERR.corps.erreurDeduction, ERR.corps.raisonsNonDeduites]);
        const N2 = await charger(navigateur, N1.store, [OK_DRI], 1500, { url: URL_DRI, html: HTML_DRI });
        verifier('20. (point 6) la page non marquée repart au chargement suivant, puis est marquée v:19', [N2.appels.filter(x => x.chemin === '/api/apprendre-lot').length, N2.store.rm_pagesFaites['/fr/Pokemon/Products/Singles?idCategory=51&idExpansion=6096']?.v], [1, 19]);
        const CIBLES = JSON.parse(/const CIBLES = (\{.*?\});/.exec(SCRIPT)[1]);
        const [expCible, [[idCible, , nomCible]]] = Object.entries(CIBLES)[0];
        const DED = { status: 200, entetes: 'ratelimit-remaining: 98', corps: { ...OK_DRI.corps, deduites: 1, nonDeduites: 1, raisonsNonDeduites: { 'lien sans variante, # produits au nom «…»': 1 }, erreurDeduction: null,
            idsDeduits: [{ idProduct: idCible, slug: 'Ccc-DRI003', slugSet: 'Destined-Rivals' }], deductionsContredites: [{ idProduct: 111, par: 826050, slug: 'Destined-Rivals/Aaa-DRI001' }] } };
        const N3 = await charger(navigateur, {}, [DED], 1500, { url: URL_DRI, html: HTML_DRI });
        verifier(`21. (point 6) la cible ${idCible} (« ${nomCible} », exp ${expCible}) DÉDUITE par le serveur est marquée faite ; les raisons des non déduites sont dites`,
            [!!(N3.store.rm_ciblesFaites || {})[idCible], /lien sans variante/.test(N3.panneau), (N3.store.rm_journal || [])[0]?.envoi?.idsDeduits], [true, true, [idCible]]);
        verifier('22. (relecture par sous-agent) une déduction CONTREDITE par une carte lue est gardée au journal et dite au panneau',
            [(N3.store.rm_journal || [])[0]?.envoi?.deductionsContredites, /1 déduction\(s\) contredite\(s\)/.test(N3.panneau)], [DED.corps.deductionsContredites, true]);
        // 23. TROISIÈME RELECTURE : une sans-image REFUSÉE pour une raison d'ordre (« 2 produits non appris » : le V1 de sa famille est sur
        //     une page suivante) marquait la page v:19 pour toujours. Elle garde son refus dans sa marque, et repart UNE fois quand
        //     l'expansion a appris quelque chose depuis — pas avant, pas deux fois.
        const CLE_DRI = '/fr/Pokemon/Products/Singles?idCategory=51&idExpansion=6096';
        const REFUS = { status: 200, entetes: 'ratelimit-remaining: 97', corps: { ...OK_DRI.corps, deduites: 0, nonDeduites: 1, raisonsNonDeduites: { '# produits non appris au nom «…»': 1 }, erreurDeduction: null, idsDeduits: [] } };
        const P1 = await charger(navigateur, {}, [REFUS], 1500, { url: URL_DRI, html: HTML_DRI });
        const m1 = P1.store.rm_pagesFaites?.[CLE_DRI] || {};
        const P2 = await charger(navigateur, P1.store, [REFUS], 1500, { url: URL_DRI, html: HTML_DRI });
        const apprisDepuis = s => ({ ...s, rm_couv: { ...s.rm_couv, 6096: { ...s.rm_couv[6096], le: (s.rm_pagesFaites[CLE_DRI].leCouv ?? s.rm_pagesFaites[CLE_DRI].le) + 60000 } } });
        const P3 = await charger(navigateur, apprisDepuis(P2.store), [REFUS], 1500, { url: URL_DRI, html: HTML_DRI });
        const P4 = await charger(navigateur, apprisDepuis(P3.store), [REFUS], 1500, { url: URL_DRI, html: HTML_DRI });
        verifier('23. sans-image refusée : marquée avec son refus ; ne repart pas sans apprentissage neuf ; repart UNE fois quand l\'expansion a appris depuis ; puis plus',
            [m1.v, m1.sansImageRefusees, ...[P2, P3, P4].map(P => P.appels.filter(x => x.chemin === '/api/apprendre-lot').length), P3.store.rm_pagesFaites[CLE_DRI]?.reprises], [19, 1, 0, 1, 0, 1]);
        // 14. Un refus du serveur s'écrit au journal avec son statut, et la page reste en file.
        const K = await charger(navigateur, {}, [{ status: 400, corps: { success: false, error: 'Identifiant utilisateur manquant' } }], 1500, { url: URL_DRI, html: HTML_DRI });
        verifier('14. refus 400 : au journal (statut, message), page gardée en file', [K.store.rm_journal?.[0]?.envoi?.status, K.store.rm_journal?.[0]?.envoi?.erreur, K.store.rm_file.length], [400, 'Identifiant utilisateur manquant', 1]);
    } finally { await navigateur.close(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(2); });

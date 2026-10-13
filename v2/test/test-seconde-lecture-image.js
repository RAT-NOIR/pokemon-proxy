'use strict';
// SECONDE-LECTURE — les pièces qui touchent l'image et le modèle, SANS réseau ni appel payant : le recadrage du bas de la carte (sharp + opencv, sur une image FABRIQUÉE), le lecteur du modèle
// (le client HTTP est INJECTÉ : une fonction de ce fichier), et le recadreur (il reçoit les OCTETS de l'image : plus aucun téléchargement, tour 1 ; un détecteur §5 échoue si un client réseau y entre).
const H = require('./_harnais');
const sharp = require('sharp');
const path = require('path');
const I = require('../identifier/seconde-lecture-image');

(async () => {
    // ── 1. les trois BANDES : recadrages DISTINCTS (le 3e est contrasté), 1600 px de large
    const W = 1000, HT = 1395;
    const carte = await sharp({ create: { width: W, height: HT, channels: 3, background: { r: 120, g: 120, b: 120 } } })
        .composite([{ input: await sharp({ create: { width: W, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(), top: HT - 100, left: 0 }]).png().toBuffer();
    const bandes = await I.bandes(carte);
    const metas = await Promise.all(bandes.map(b => sharp(b).metadata()));
    H.v('1a. trois bandes JPEG, 1600 px de large, hauteurs du bas à 20 %, 32 %, 26 % de la carte', [bandes.length, metas.map(m => m.format), metas.map(m => m.width), metas.map(m => m.height)], [3, ['jpeg', 'jpeg', 'jpeg'], [1600, 1600, 1600], [446, 714, 581]]);
    H.v('1b. les bandes sont DISTINCTES (aucun octet commun entre deux recadrages : jamais deux essais au même crop)', new Set(bandes.map(b => b.toString('base64'))).size, 3);
    H.v('1c. une image illisible : lève (le fournisseur le rend en échec, jamais en lecture)', await I.bandes(Buffer.from('pas une image')).then(() => 'rien', () => 'lève'), 'lève');

    // ── 2. le REDRESSEMENT depuis la photo ORIGINALE (le quadrilatère est celui de la détection)
    const photo = await sharp({ create: { width: 2000, height: 2800, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
    const geo = { W: 2000, quad: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2800 }, { x: 0, y: 2800 }] };
    const rouge = await I.redresser(photo, geo, { largeur: 400 });
    const m = await sharp(rouge).metadata();
    const px = await sharp(rouge).raw().toBuffer({ resolveWithObject: true });
    H.v('2a. redressement : 400 × 559 (rapport 63/88 d\'une carte), image rouge conservée', [m.width, m.height, px.data[0] > 150 && px.data[1] < 90], [400, 559, true]);
    H.v('2b. sans géométrie, ou une géométrie incomplète : aucune carte (null), jamais une bande devinée sur la photo brute', [await I.redresser(photo, null).then(x => x, () => 'lève'), await I.redresser(photo, { W: 2000, quad: [{ x: 0, y: 0 }] }).then(x => x, () => 'lève')], [null, null]);

    // ── 3. le LECTEUR du modèle : le client HTTP est injecté, aucune clé n'apparaît dans une erreur
    const requetes = [];
    const postDe = contenu => async (url, corps, config) => { requetes.push({ url, corps, config }); return { data: { choices: [{ message: { content: contenu } }] } }; };
    const bande = Buffer.from([1, 2, 3]);
    {
        const lecteur = I.creerLecteur({ post: postDe('{"setCode":"PRE","number":"162","total":"131"}'), modele: 'modele-factice', cle: 'CLE-SECRETE-FACTICE' });
        const r = await lecteur(bande);
        const q = requetes[0];
        H.v('3a. une réponse JSON : { setCode, number, total } rendus', r, { setCode: 'PRE', number: '162', total: '131' });
        H.v('   la requête : modèle fourni, température 0, deux contenus (consigne + image JPEG en base64), clé en en-tête Authorization', [q.corps.model, q.corps.temperature, q.corps.messages[0].content.map(c => c.type), q.corps.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'), q.config.headers.Authorization], ['modele-factice', 0, ['text', 'image_url'], true, 'Bearer CLE-SECRETE-FACTICE']);
        H.v('   la consigne ne demande QUE le code et le numéro (ni nom ni titre : la lecture reste indépendante de la première)', [/SET CODE/.test(q.corps.messages[0].content[0].text), /NAME|TITLE/i.test(q.corps.messages[0].content[0].text.replace(/set code|card number/gi, ''))], [true, false]);
        H.v('   délai borné sur l\'appel (timeout posé)', Number.isInteger(q.config.timeout) && q.config.timeout > 0 && q.config.timeout <= 60000, true);
    }
    H.v('3b. une réponse entourée de ```json : lue', await I.creerLecteur({ post: postDe('```json\n{"setCode":null,"number":"045","total":null}\n```'), modele: 'm', cle: 'k' })(bande), { setCode: null, number: '045', total: null });
    H.v('3c. une réponse qui n\'est pas du JSON : { illisible: true } (jamais un champ)', (await I.creerLecteur({ post: postDe('désolé, je ne peux pas'), modele: 'm', cle: 'k' })(bande)).illisible, true);
    {
        const e = await I.creerLecteur({ post: async () => { throw Object.assign(new Error('401 Bearer CLE-SECRETE-FACTICE'), { code: 'ERR_BAD_REQUEST' }); }, modele: 'm', cle: 'CLE-SECRETE-FACTICE' })(bande).then(() => null, x => x);
        H.v('3d. le client tombe : l\'erreur est levée SANS la clé (ni son message d\'origine) — seulement un code', [Boolean(e), e && String(e.message).includes('CLE-SECRETE-FACTICE'), e && e.code], [true, false, 'ERR_BAD_REQUEST']);
    }
    H.v('3e. sans clé ou sans modèle : refuse de se construire (aucun appel possible)', [() => I.creerLecteur({ post: postDe('{}'), modele: 'm' }), () => I.creerLecteur({ post: postDe('{}'), cle: 'k' }), () => I.creerLecteur({ modele: 'm', cle: 'k' })].map(f => { try { f(); return 'ok'; } catch { return 'refuse'; } }), ['refuse', 'refuse', 'refuse']);

    // TOUR 1 (coût exact) : le signal d'abandon arrive jusqu'à la requête du modèle
    {
        const ctl = new AbortController(); requetes.length = 0;
        await I.creerLecteur({ post: postDe('{"setCode":null,"number":null,"total":null}'), modele: 'm', cle: 'k' })(bande, { signal: ctl.signal });
        H.v('3f. le lecteur transmet le signal d\'abandon au client HTTP (config.signal)', requetes[0].config.signal === ctl.signal, true);
        requetes.length = 0;
        await I.creerLecteur({ post: postDe('{"setCode":null,"number":null,"total":null}'), modele: 'm', cle: 'k' })(bande);
        H.v('   sans signal : aucune clé `signal` inventée', 'signal' in requetes[0].config, false);
    }

    // ── 4. le RECADREUR : il reçoit les OCTETS de l'image (TOUR 1, I-2 : plus aucun téléchargement), la géométrie est EXIGÉE
    {
        const recadreur = I.creerRecadreur({ largeur: 400 });
        const sans = await recadreur({ image: photo, corps: {} });
        H.v('4a. sans géométrie dans le corps de la chaîne : aucune bande', sans, []);
        const avec = await recadreur({ image: photo, corps: { geometrie: geo } });
        H.v('4b. avec les octets ET la géométrie : trois bandes', avec.length, 3);
        H.v('4c. sans octets (absents, une URL, un Buffer vide, null) : aucune bande, jamais un téléchargement', await Promise.all([undefined, 'https://images1.vinted.net/p.png', Buffer.alloc(0), null].map(image => recadreur({ image, corps: { geometrie: geo } }))), [[], [], [], []]);
        H.v('4d. des octets qui ne sont pas une image : aucune bande (le fournisseur rend un échec, jamais une lecture)', await recadreur({ image: Buffer.from('pas une image'), corps: { geometrie: geo } }).then(x => x, () => 'lève'), 'lève');
        H.v('4e. l\'ancien chemin réseau est parti : creerRecadreur n\'accepte ni `telecharger` ni liste d\'hôtes', [typeof I.creerRecadreur({ telecharger: async () => { throw new Error('réseau'); } }), Object.keys(I).filter(k => /telecharg|hote|blanche/i.test(k))], ['function', []]);
        let appels = 0; const fetchOrigine = globalThis.fetch; globalThis.fetch = () => { appels++; throw new Error('fetch interdit'); };
        try { await recadreur({ image: photo, corps: { geometrie: geo } }); await I.creerLecteur({ post: postDe('{}'), modele: 'm', cle: 'k' })(bande); } finally { globalThis.fetch = fetchOrigine; }
        H.v('4f. recadrage + lecture : AUCUN appel à fetch (le seul client est le `post` injecté du lecteur)', appels, 0);
    }

    // ── 5. TOUR 1 (décision 4 du testeur) : aucun module de la seconde lecture n'importe ni n'appelle de client réseau, sauf le `post` INJECTÉ du lecteur
    {
        const fs = require('fs'); const dir = path.join(__dirname, '..', 'identifier');
        const MODULES = ['seconde-lecture.js', 'seconde-lecture-image.js'];
        const requis = f => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
        const AUTORISES = new Set(['sharp', '@techstark/opencv-js', '../../scoring']);
        H.v('5a. les modules n\'importent que sharp, opencv-js et scoring (ni http, https, net, dns, tls, axios, undici, node-fetch, ni departage-image qui télécharge)', MODULES.map(f => requis(f).filter(r => !AUTORISES.has(r))), [[], []]);
        const code = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n');
        H.v('5b. aucun appel `fetch(`, `XMLHttpRequest`, `http.request`, `https.get`, `axios` dans le code des modules (hors commentaires)', MODULES.map(f => (code(f).match(/\bfetch\s*\(|XMLHttpRequest|https?\.(get|request)|axios|new WebSocket|import\s*\(/g) || [])), [[], []]);
        const routes = fs.readFileSync(path.join(dir, 'routes.js'), 'utf8');
        const bloc = routes.slice(routes.indexOf('async function consulterSecondeLecture'), routes.indexOf('const INTROUVABLE_REGLE_G'));
        H.v('5c. la décision de la route ne télécharge rien non plus (aucun fetch / axios dans consulterSecondeLecture)', [bloc.length > 500, /\bfetch\s*\(|axios|https?\.(get|request)/.test(bloc)], [true, false]);
        const exemple = "const https = require('https'); const r = await fetch(u); axios.get(u);";
        H.v('5d. contrôle de l\'instrument : les mêmes motifs voient un module qui importe https, appelle fetch et axios', [[...exemple.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]).filter(r => !AUTORISES.has(r)), (exemple.match(/\bfetch\s*\(|XMLHttpRequest|https?\.(get|request)|axios|new WebSocket|import\s*\(/g) || []).length], [['https'], 2]);
    }
    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });

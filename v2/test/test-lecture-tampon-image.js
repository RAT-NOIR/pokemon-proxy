'use strict';
// F1-TAMPON — les pièces qui touchent l'image et le modèle, SANS réseau ni appel payant : le lecteur du tampon (le client HTTP est INJECTÉ), la préparation de l'image (sharp, sur une image FABRIQUÉE),
// et le détecteur « aucun client réseau » qui vaut pour tous les modules de la lecture (comme test-seconde-lecture-image.js §5).
const H = require('./_harnais');
const sharp = require('sharp');
const path = require('path'), fs = require('fs');
const I = require('../identifier/seconde-lecture-image');

(async () => {
    const requetes = [];
    const postDe = (contenu, extra = {}) => async (url, corps, config) => { requetes.push({ url, corps, config }); return { data: { choices: [{ message: { content: contenu } }], ...extra } }; };
    const bande = Buffer.from([1, 2, 3]);

    // ── 1. le LECTEUR du tampon : UNE question, sur la carte
    {
        requetes.length = 0;
        const lecteur = I.creerLecteurTampon({ post: postDe('{"staff":"yes"}'), modele: 'modele-factice', cle: 'CLE-SECRETE-FACTICE' });
        const r = await lecteur(bande);
        const q = requetes[0], texte = q.corps.messages[0].content[0].text;
        H.v('1a. une réponse JSON : { staff } rendu', r, { staff: 'yes' });
        H.v('   la requête : température 0, consigne + image JPEG base64, clé en en-tête, délai borné, PAS de `usage` demandé par défaut', [q.corps.model, q.corps.temperature, q.corps.messages[0].content.map(c => c.type), q.corps.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'), q.config.headers.Authorization, 'usage' in q.corps, q.config.timeout > 0 && q.config.timeout <= 60000],
            ['modele-factice', 0, ['text', 'image_url'], true, 'Bearer CLE-SECRETE-FACTICE', false, true]);
        H.v('   la consigne ne pose QUE la question du mot STAFF (pas de nom, de numéro ni de code), et exige la certitude', [/STAFF/.test(texte), /yes.*no.*uncertain/s.test(texte), /SET CODE|CARD NUMBER|NAME/i.test(texte)], [true, true, false]);
    }
    H.v('1b. une réponse entourée de ```json, une valeur inconnue, du texte libre : lue, ou { illisible: true } — jamais un « yes » inventé',
        [await I.creerLecteurTampon({ post: postDe('```json\n{"staff":"no"}\n```'), modele: 'm', cle: 'k' })(bande), (await I.creerLecteurTampon({ post: postDe('{"staff":"maybe"}'), modele: 'm', cle: 'k' })(bande)).illisible, (await I.creerLecteurTampon({ post: postDe('Yes, it says STAFF'), modele: 'm', cle: 'k' })(bande)).illisible, (await I.creerLecteurTampon({ post: postDe('{"staff":true}'), modele: 'm', cle: 'k' })(bande)).illisible],
        [{ staff: 'no' }, true, true, true]);
    {
        const e = await I.creerLecteurTampon({ post: async () => { throw Object.assign(new Error('401 Bearer CLE-SECRETE-FACTICE'), { code: 'ERR_BAD_REQUEST' }); }, modele: 'm', cle: 'CLE-SECRETE-FACTICE' })(bande).then(() => null, x => x);
        H.v('1c. le client tombe : l\'erreur est levée SANS la clé (un code seulement)', [Boolean(e), e && String(e.message).includes('CLE-SECRETE-FACTICE'), e && e.code], [true, false, 'ERR_BAD_REQUEST']);
    }
    H.v('1d. sans clé, sans modèle ou sans client : refuse de se construire', [() => I.creerLecteurTampon({ post: postDe('{}'), modele: 'm' }), () => I.creerLecteurTampon({ post: postDe('{}'), cle: 'k' }), () => I.creerLecteurTampon({ modele: 'm', cle: 'k' })].map(f => { try { f(); return 'ok'; } catch { return 'refuse'; } }), ['refuse', 'refuse', 'refuse']);
    {
        const ctl = new AbortController(); requetes.length = 0;
        await I.creerLecteurTampon({ post: postDe('{"staff":"no"}'), modele: 'm', cle: 'k' })(bande, { signal: ctl.signal });
        H.v('1e. le signal d\'abandon arrive au client HTTP', requetes[0].config.signal === ctl.signal, true);
        const vus = []; requetes.length = 0;
        await I.creerLecteurTampon({ post: postDe('{"staff":"no"}', { usage: { cost: 0.0009 } }), modele: 'm', cle: 'k', surUsage: u => vus.push(u) })(bande);
        H.v('1f. avec `surUsage` (la mesure) : le coût réel est demandé (usage.include) et rendu à l\'appelant ; sans, la requête est inchangée', [requetes[0].corps.usage, vus], [{ include: true }, [{ cost: 0.0009 }]]);
        const e = await I.creerLecteurTampon({ post: postDe('{"staff":"no"}', { usage: { cost: 0.001 } }), modele: 'm', cle: 'k', surUsage: () => { throw new Error('boum'); } })(bande).then(() => 'ok', () => 'lève');
        H.v('   un `surUsage` qui lève n\'empêche pas la lecture', e, 'ok');
    }
    {
        // le lecteur de la seconde lecture est INCHANGÉ par le partage du client : mêmes champs, même requête
        requetes.length = 0;
        const r = await I.creerLecteur({ post: postDe('{"setCode":"PRE","number":"162","total":"131"}'), modele: 'm', cle: 'k' })(bande);
        H.v('1g. creerLecteur (seconde lecture) : même lecture, sa propre consigne, pas de `usage`', [r, /SET CODE/.test(requetes[0].corps.messages[0].content[0].text), 'usage' in requetes[0].corps], [{ setCode: 'PRE', number: '162', total: '131' }, true, false]);
    }

    // ── 2. la PRÉPARATION de l'image : deux images distinctes de la carte entière
    {
        const carte = await sharp({ create: { width: 420, height: 587, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg({ quality: 92 }).toBuffer();     // la carte redressée de MODELE-VISUEL-API : JPEG 420 x 587
        const prep = I.creerPreparateurTampon();
        const deux = await prep({ image: carte, corps: {} });
        const metas = await Promise.all(deux.map(b => sharp(b).metadata()));
        H.v('2a. une carte déjà redressée (sans géométrie) : DEUX images JPEG de la carte entière, de largeurs distinctes (1000 et 1400), jamais deux fois la même', [deux.length, metas.map(m => m.format), metas.map(m => m.width), new Set(deux.map(b => b.toString('base64'))).size], [2, ['jpeg', 'jpeg'], [1000, 1400], 2]);
        const photo = await sharp({ create: { width: 2000, height: 2800, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
        const geo = { W: 2000, quad: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2800 }, { x: 0, y: 2800 }] };
        const plein = await prep({ image: photo, corps: { geometrie: geo } }).then(() => 'rien', e => e.code);
        const autre = await prep({ image: await sharp({ create: { width: 640, height: 894, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer(), corps: {} }).then(() => 'rien', e => e.code);
        H.v('2b. une photo pleine (même avec une géométrie), ou une carte d\'une autre taille que 420 × 587 : REFUSÉE (CARTE_HORS_FORMAT), jamais envoyée au modèle ; plus aucun redressement ici', [plein, autre], ['CARTE_HORS_FORMAT', 'CARTE_HORS_FORMAT']);
        H.v('2c. sans octets (absents, une URL, vide, null) : aucune image — jamais un téléchargement', await Promise.all([undefined, 'https://images1.vinted.net/p.png', Buffer.alloc(0), null].map(image => prep({ image, corps: {} }))), [[], [], [], []]);
        H.v('2d. des octets qui ne sont pas une image : lève (le fournisseur le rend en échec, jamais en lecture)', await prep({ image: Buffer.from('pas une image'), corps: {} }).then(() => 'rien', () => 'lève'), 'lève');
        let appels = 0; const fetchOrigine = globalThis.fetch; globalThis.fetch = () => { appels++; throw new Error('fetch interdit'); };
        try { await prep({ image: carte, corps: {} }); await I.creerLecteurTampon({ post: postDe('{}'), modele: 'm', cle: 'k' })(bande); } finally { globalThis.fetch = fetchOrigine; }
        H.v('2e. préparation + lecture : AUCUN appel à fetch', appels, 0);
    }

    // ── 3. aucun module de la lecture du tampon n'importe ni n'appelle de client réseau (sauf le `post` INJECTÉ du lecteur)
    {
        const dir = path.join(__dirname, '..', 'identifier');
        const MODULES = ['lecture-tampon.js', 'lecture-tampon-route.js', 'seconde-lecture-image.js', 'fournisseur-tampon.js'];
        const requis = f => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
        const AUTORISES = new Set(['sharp', '@techstark/opencv-js', '../../scoring', './lecture-tampon', './garde-contradiction', './carte-redressee', './seconde-lecture-image']);
        H.v('3a. les modules n\'importent que sharp, opencv-js, scoring et leurs voisins de la lecture (ni http, https, net, axios, undici, ni departage-image qui télécharge)', MODULES.map(f => requis(f).filter(r => !AUTORISES.has(r))), [[], [], [], []]);
        const code = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n');
        H.v('3b. aucun appel `fetch(`, `XMLHttpRequest`, `http.request`, `https.get`, `axios`, `import(` dans le code (hors commentaires)', MODULES.map(f => (code(f).match(/\bfetch\s*\(|XMLHttpRequest|https?\.(get|request)|axios|new WebSocket|import\s*\(/g) || [])), [[], [], [], []]);
    }
    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });

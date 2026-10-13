'use strict';
// SECONDE-LECTURE — les pièces qui touchent l'image et le modèle, SANS réseau ni appel payant : le recadrage du bas de la carte (sharp + opencv, sur une image FABRIQUÉE), le lecteur du modèle
// (le client HTTP est INJECTÉ : une fonction de ce fichier), et le recadreur de production (le téléchargement est injecté ; la liste blanche d'hôtes est celle de la production).
const H = require('./_harnais');
const sharp = require('sharp');
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

    // ── 4. le RECADREUR de production : liste blanche d'hôtes AVANT tout téléchargement, géométrie exigée
    {
        const telechargements = [];
        const recadreur = I.creerRecadreur({ telecharger: async url => { telechargements.push(url); return photo; }, largeur: 400 });
        const HOTE_OK = 'https://images1.vinted.net/t/00_banc/f800/p.png';        // un hôte de la liste blanche de la production (départage par l'image) ; le téléchargement est injecté
        const sans = await recadreur({ photos: [HOTE_OK], corps: {} });
        H.v('4a. sans géométrie dans le corps de la chaîne : aucune bande, AUCUN téléchargement', [sans, telechargements.length], [[], 0]);
        const avec = await recadreur({ photos: [HOTE_OK], corps: { geometrie: geo } });
        H.v('4b. avec géométrie : trois bandes, une photo téléchargée (la première)', [avec.length, telechargements], [3, [HOTE_OK]]);
        telechargements.length = 0;
        const hors = await recadreur({ photos: ['https://exemple.invalide/p.png'], corps: { geometrie: geo } });
        H.v('4c. un hôte hors liste blanche : aucune bande, JAMAIS téléchargé', [hors, telechargements.length], [[], 0]);
        const aucune = await recadreur({ photos: [], corps: { geometrie: geo } });
        H.v('4d. aucune photo : aucune bande', aucune, []);
    }
    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });

'use strict';
// Le DEPOT du test de detection (stockage.js, mesure.detection) : liste fermee, aucune valeur libre. Node pur, aucune base ouverte (valider() ne touche pas la base).
const S = require(process.env.RM_STOCKAGE || '../banc-telephone/stockage');   // RM_STOCKAGE : rejouer contre l'ANCIEN stockage (rouge vu)
let ok = 0, ko = 0;
const vrai = (nom, cond, detail) => { if (cond) ok++; else { ko++; console.log(`❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const detection = (o = {}) => ({ version: 'rm-detection-1', nImages: 12, nIdentiques: 12, nRgb640: 12, nQuads: 12, nCartes: 12, voieCanvas: 9, voiePillow: 3, ecarts: '', empreinteLot: 'a'.repeat(64), msOpencv: 410, msMediane: 85, msTotal: 1100, jsHeapMo: 12.3, jsHeapApresMo: 40.1, wasmHeapMo: 33, erreur: null, ...o });
const doc = (det, mesure = {}) => ({ v: 1, runId: '0123456789abcdef', modeleSha: '0'.repeat(64), ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', isole: true, coeurs: 6, memoireAppareilGo: null, gpuDispo: false, mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', detection: det, ...mesure } });

vrai('1. un depot de detection complet est accepte', S.valider(doc(detection())).ok === true, JSON.stringify(S.valider(doc(detection()))));
vrai('1. des mesures absentes (null) sont permises (iPhone : pas de performance.memory)', S.valider(doc(detection({ jsHeapMo: null, jsHeapApresMo: null, wasmHeapMo: null, empreinteLot: null }))).ok === true);
vrai('1. une erreur nommee (texte court) est permise', S.valider(doc(detection({ erreur: 'opencv non initialise' }), { verdict: 'ERREUR' })).ok === true);
for (const [nom, d] of [
    ['un champ inconnu', detection({ photo: 'x' })], ['un compte hors bornes', detection({ nIdentiques: 101 })], ['un compte non entier', detection({ nQuads: 1.5 })], ['une empreinte non hexadecimale', detection({ empreinteLot: 'Z'.repeat(64) })],
    ['des ecarts trop longs', detection({ ecarts: 'x'.repeat(201) })], ['un texte non ASCII', detection({ erreur: 'é' })], ['une duree negative', detection({ msTotal: -1 })], ['une version trop longue', detection({ version: 'v'.repeat(31) })]]) {
    const v = S.valider(doc(d));
    vrai(`2. refuse : ${nom}`, v.ok === false && /^champ/.test(v.detail), JSON.stringify(v));
}
vrai('3. un objet detection imbrique inconnu est refuse', S.valider(doc({ ...detection(), imbrique: { a: 1 } })).ok === false);
vrai('3. la mesure du modele (sans detection) reste acceptee', S.valider({ ...doc(null), mesure: { moteur: 'wasm', verdict: 'IDENTIQUE' } }).ok === true);
vrai('3. le document reste sous la borne de taille', Buffer.byteLength(JSON.stringify(doc(detection({ ecarts: 'x'.repeat(200) }))), 'utf8') < S.OCTETS_MAX);
// ── les grandes photos : mesure.grandesPhotos, liste fermee a trois niveaux (depot, photo, moteur), six photos au plus, aucune image ──
const mot = (o = {}) => ({ ok: true, code: null, redressee: true, nCartes: 2, rgb640: 'c'.repeat(64), quads: 'd'.repeat(64), carte: 'e'.repeat(64), dim640: '640x480', ms: 210, ...o });
const ph = (o = {}) => ({ sha256Fichier: 'f'.repeat(64), format: 'jpeg', octets: 5400000, largeur: 4032, hauteur: 3024, orientation: 1, prereduit: true, voie: 'canvas-high', rm: mot(), nav: mot(), ecartQuadPct: 0.4, memeQuad: true, ...o });
const gp = (photos, extra = {}) => doc(null, { grandesPhotos: { version: 'rm-detection-2', photos, ...extra } });
vrai('4. un depot de grandes photos complet est accepte', S.valider(gp([ph(), ph()])).ok === true, JSON.stringify(S.valider(gp([ph()]))));
vrai('4. un moteur en erreur (code du decodeur, aucune empreinte) est accepte', S.valider(gp([ph({ rm: mot({ ok: false, code: 'NON_SUPPORTE', redressee: false, nCartes: 0, rgb640: null, quads: null, carte: null, dim640: null }), ecartQuadPct: null, memeQuad: null, voie: null, prereduit: null, largeur: null, hauteur: null, orientation: null })])).ok === true);
for (const [nom, d] of [['une cle inconnue dans la photo', gp([ph({ idProduct: 5 })])], ['une cle inconnue dans rm', gp([ph({ rm: mot({ pixels: 'x' }) })])], ['une cle inconnue dans nav', gp([ph({ nav: mot({ image: 'x' }) })])], ['une cle inconnue dans grandesPhotos', gp([ph()], { note: 'x' })],
    ['zero photo', gp([])], ['sept photos', gp([1, 2, 3, 4, 5, 6, 7].map(() => ph()))], ['un format inconnu', gp([ph({ format: 'tiff' })])], ['un sha256 mal forme', gp([ph({ sha256Fichier: 'x' })])], ['un ecart negatif', gp([ph({ ecartQuadPct: -1 })])], ['une voie inconnue', gp([ph({ voie: 'gpu' })])], ['un nom de fichier', gp([ph({ nom: 'IMG_0001.jpg' })])],
    ['un code de moteur de 31 caracteres', gp([ph({ rm: mot({ code: 'x'.repeat(31) }) })])], ['un dim640 de 13 caracteres', gp([ph({ nav: mot({ dim640: 'x'.repeat(13) }) })])], ['l\'ancien champ memeCarte', gp([ph({ memeCarte: true })])]]) {
    const v = S.valider(d);
    vrai(`4. refuse : ${nom}`, v.ok === false && /^(champ|forme)/.test(v.detail), JSON.stringify(v));
}
vrai('4. six photos tiennent sous la borne de taille', Buffer.byteLength(JSON.stringify(gp([1, 2, 3, 4, 5, 6].map(() => ph()))), 'utf8') < S.OCTETS_MAX);

// ── le document que la PAGE fabrique (grandes-page.mjs : mesurerPhoto + documentDepot) est accepte par la validation REELLE ; sous node il n'y a pas de createImageBitmap : le moteur « navigateur » rend un code, pas une exception ──
(async () => {
    const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
    const PUB = process.env.RM_DETECTION_PUB || path.join(__dirname, '..', 'banc-telephone', 'public');     // RM_DETECTION_PUB : rejouer contre une copie MUTEE de la page (outils/detection/mutations-page.mjs)
    const G = await import(pathToFileURL(path.join(PUB, 'grandes-page.mjs')).href);
    globalThis.Module = { wasmBinary: fs.readFileSync(path.join(PUB, 'opencv', 'opencv_js.wasm')) };
    const cv = await require(path.join(PUB, 'opencv', 'opencv.js'));
    const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot-detection.json'), 'utf8'));
    const photos = [];
    for (const im of lot.images.slice(0, 3)) photos.push(await G.mesurerPhoto(cv, new Uint8Array(Buffer.from(im.b64, 'base64'))));
    photos.push(await G.mesurerPhoto(cv, Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])));   // HEIC : refus du decodeur, FORMAT
    const d = G.documentDepot(photos);
    const v = S.valider(d);
    vrai('5. le document fabrique par la page (4 photos dont un HEIC refuse) est accepte par la validation reelle', v.ok === true, JSON.stringify(v));
    vrai('5. rm : la 1re photo est mesuree (redressee, empreintes de 64 hexadecimaux) ; HEIC : FORMAT sans empreinte', photos[0].rm.ok === true && /^[0-9a-f]{64}$/.test(photos[0].rm.rgb640) && photos[3].rm.ok === false && photos[3].rm.code === 'FORMAT' && photos[3].rm.rgb640 === null && photos[3].format === 'heic');
    vrai('5. nav sous node : code (pas d\'exception), pas d\'ecart de quadrilatere', photos[0].nav.ok === false && typeof photos[0].nav.code === 'string' && photos[0].ecartQuadPct === null && photos[0].memeQuad === null);
    vrai('5. le verdict du depot fabrique par la page est CALCULE : rm lu et navigateur en erreur => ECART (jamais IDENTIQUE en dur)', d.mesure.verdict === 'ECART', d.mesure.verdict);
    // verdictDepot : un cas par divergence ; un test qui echoue si rm et nav different et que le verdict reste constant
    const moteur = (o = {}) => ({ ok: true, code: null, redressee: true, nCartes: 1, rgb640: 'a'.repeat(64), quads: 'b'.repeat(64), carte: 'c'.repeat(64), dim640: '640x480', ms: 1, ...o });
    const rec = (o = {}) => ({ sha256Fichier: 'f'.repeat(64), format: 'jpeg', octets: 1, largeur: 4032, hauteur: 3024, orientation: 1, prereduit: true, voie: 'canvas-high', rm: moteur(), nav: moteur(), ecartQuadPct: 0.5, memeQuad: true, ...o });
    const erreur = (c) => moteur({ ok: false, code: c, redressee: false, nCartes: 0, rgb640: null, quads: null, carte: null, dim640: null });
    const cas = [['deux moteurs d\'accord, meme quadrilatere de rang 1', [rec()], 'IDENTIQUE'], ['quadrilateres de rang 1 a 3 % ou plus', [rec({ ecartQuadPct: 7, memeQuad: false })], 'ECART'], ['redressee par rm seulement', [rec({ nav: moteur({ redressee: false, nCartes: 0 }), ecartQuadPct: null, memeQuad: null })], 'ECART'],
        ['lue par rm, refusee par le navigateur', [rec({ nav: erreur('TROP_GRAND'), ecartQuadPct: null, memeQuad: null })], 'ECART'], ['lue par le navigateur, refusee par rm', [rec({ rm: erreur('FORMAT'), ecartQuadPct: null, memeQuad: null })], 'ECART'],
        ['une photo refusee par les deux + une identique', [rec({ rm: erreur('TROP_GRAND'), nav: erreur('TROP_GRAND'), ecartQuadPct: null, memeQuad: null }), rec()], 'IDENTIQUE'], ['toutes refusees par les deux', [rec({ rm: erreur('FORMAT'), nav: erreur('FORMAT'), ecartQuadPct: null, memeQuad: null })], 'ERREUR'],
        ['aucune photo', [], 'ERREUR'], ['une identique puis une qui diverge', [rec(), rec({ ecartQuadPct: 3, memeQuad: false })], 'ECART']];
    for (const [nom, ph_, att] of cas) vrai(`5. verdict : ${nom} => ${att}`, G.verdictDepot(ph_) === att, G.verdictDepot(ph_));
    const identique = G.documentDepot([rec(), rec()]);
    vrai('5. un depot de deux moteurs d\'accord : verdict IDENTIQUE et accepte par la validation reelle', identique.mesure.verdict === 'IDENTIQUE' && S.valider(identique).ok === true);
    vrai('5. un depot ECART et un depot ERREUR sont acceptes aussi (le verdict est une valeur permise, pas une garantie)', S.valider(G.documentDepot([rec({ ecartQuadPct: 9, memeQuad: false })])).ok === true && S.valider(G.documentDepot([rec({ rm: erreur('FORMAT'), nav: erreur('FORMAT'), ecartQuadPct: null, memeQuad: null })])).ok === true);
    // les bornes : la chaine du NAVIGATEUR ne tourne pas hors des bornes de photo (createImageBitmap alloue le bitmap entier)
    const entete = (w, h) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    vrai('5. bornesDeLaPhoto : 4032x3024 ok ; 8160x6120 TROP_GRAND ; 4609x100 TROP_GRAND ; HEIC FORMAT ; octets quelconques FORMAT', JSON.stringify([G.bornesDeLaPhoto(entete(4032, 3024)).ok, G.bornesDeLaPhoto(entete(8160, 6120)).code, G.bornesDeLaPhoto(entete(4609, 100)).code, G.bornesDeLaPhoto(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])).code, G.bornesDeLaPhoto(Uint8Array.from([1, 2, 3])).code]) === JSON.stringify([true, 'TROP_GRAND', 'TROP_GRAND', 'FORMAT', 'FORMAT']));
    const gros = await G.mesurerPhoto(cv, entete(8160, 6120)), dansBornes = await G.mesurerPhoto(cv, entete(4032, 3024));
    vrai('5. une photo hors bornes : rm ET navigateur refuses TROP_GRAND (le navigateur n\'est pas lance) ; en bornes : le navigateur est tente (sous node : une exception capturee, pas TROP_GRAND)', gros.rm.code === 'TROP_GRAND' && gros.nav.code === 'TROP_GRAND' && dansBornes.nav.code !== 'TROP_GRAND' && dansBornes.nav.ok === false, JSON.stringify([gros.rm.code, gros.nav.code, dansBornes.nav.code]));
    vrai('5. un fichier trop gros : enregistrement refuse (deux moteurs TROP_GRAND, aucune empreinte, accepte par la validation) ; limite 64 Mio', G.enregistrementRefuse('TROP_GRAND', 70e6).rm.code === 'TROP_GRAND' && G.TAILLE_MAX_FICHIER === 64 * 1048576 && S.valider(G.documentDepot([G.enregistrementRefuse('TROP_GRAND', 70e6)])).ok === true && G.documentDepot([G.enregistrementRefuse('TROP_GRAND')]).mesure.verdict === 'ERREUR');
    // le seuil « meme quadrilatere de rang 1 » (3 %) : une chaine du navigateur INJECTEE rend le quadrilatere de rm decale de 2 % puis de 4 % de la diagonale
    {
        const octetsLot = new Uint8Array(Buffer.from(lot.images[0].b64, 'base64')), r0 = (await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href)).detecter(cv, octetsLot), diag = Math.sqrt(r0.dim640[0] ** 2 + r0.dim640[1] ** 2);
        const navDecale = (pct) => async () => ({ ok: true, code: null, redressee: true, nCartes: 1, rgb640: 'a'.repeat(64), quads: 'b'.repeat(64), carte: 'c'.repeat(64), dim640: `${r0.dim640[0]}x${r0.dim640[1]}`, ms: 1, quad: r0.quad.map(([x, y]) => [x + pct * diag / 100, y]) });
        const p2 = await G.mesurerPhoto(cv, octetsLot, { chaine: navDecale(2) }), p4 = await G.mesurerPhoto(cv, octetsLot, { chaine: navDecale(4) });
        vrai('5. quadrilatere de rang 1 du navigateur decale de 2 % : ecart 2, memeQuad vrai, verdict IDENTIQUE ; de 4 % : ecart 4, memeQuad faux, verdict ECART', p2.ecartQuadPct === 2 && p2.memeQuad === true && G.verdictDepot([p2]) === 'IDENTIQUE' && p4.ecartQuadPct === 4 && p4.memeQuad === false && G.verdictDepot([p4]) === 'ECART', JSON.stringify([p2.ecartQuadPct, p2.memeQuad, p4.ecartQuadPct, p4.memeQuad]));
    }
    // un lot refuse n'est pas perdu : deposerEnGardant garde les documents refuses (limite par heure, reseau) pour les renvoyer
    const envoyes = []; const refusSecond = async (doc) => { envoyes.push(doc.n); if (doc.n === 2) return { ok: false, statut: 'refusé (HTTP 429)' }; if (doc.n === 3) throw new Error('reseau'); return { ok: true, statut: 'déposé' }; };
    const g1 = await G.deposerEnGardant([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], refusSecond);
    vrai('5. deposerEnGardant : 4 documents envoyes, les refuses (429, reseau) sont GARDES, pas perdus', g1.statuts.join('|') === 'déposé|refusé (HTTP 429)|dépôt impossible|déposé' && JSON.stringify(g1.refuses) === JSON.stringify([{ n: 2 }, { n: 3 }]) && envoyes.length === 4);
    const g2 = await G.deposerEnGardant(g1.refuses, async () => ({ ok: true, statut: 'déposé' }));
    vrai('5. le renvoi des documents gardes les depose, plus aucun refuse', g2.refuses.length === 0 && g2.statuts.join() === 'déposé,déposé');
    vrai('5. le depot ne porte aucun octet d\'image (aucun champ de plus de 200 caracteres)', JSON.stringify(d, (k, x) => (typeof x === 'string' && x.length > 200 ? 'LONG' : x)).indexOf('LONG') < 0);
    vrai('5. formatDe par les octets : jpeg, png, webp, heic, autre', [G.formatDe(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), G.formatDe(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), G.formatDe(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0])), G.formatDe(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0])), G.formatDe(Uint8Array.from([1, 2, 3]))].join() === 'jpeg,png,webp,heic,autre');
    vrai('5. ecartQuadPct : coins decales de 10 px sur une image 640x480 (diagonale 800) = 1,3 % ; identiques = 0 ; 3 % de seuil de « meme carte »', G.ecartQuadPct([[0, 0], [100, 0], [100, 100], [0, 100]], [[10, 0], [100, 0], [100, 100], [0, 100]], [640, 480]) === 1.3 && G.ecartQuadPct([[1, 2], [3, 4], [5, 6], [7, 8]], [[1, 2], [3, 4], [5, 6], [7, 8]], [640, 480]) === 0 && G.ecartQuadPct([[0, 0], [100, 0], [100, 100], [0, 100]], [[24, 0], [100, 0], [100, 100], [0, 100]], [640, 480]) === 3);
    console.log(`${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})();

'use strict';
// Banc MODELE-VISUEL-API (4) — le FOURNISSEUR de voisins branché sur le vecteur de l'extension : lecture de l'enveloppe `empreintes` / `modeleEmpreinte`, version du modèle, index en place, vérification (un seul vecteur, le plus petit
// index de photo), recherche, ligne pour la règle G, et la garde des zones sur les PIXELS (fournis par un crochet `pixels`, jamais téléchargés ici).
// Module sans base ni réseau : l'index est FABRIQUÉ (vecteurs pseudo-aléatoires, graine fixe), les zones sont une FAUSSE (scénarisée) — le banc dit ce qu'il appelle.
const H = require('./_harnais');
const crypto = require('crypto');
const E = require('../identifier/empreinte-vecteur');
const X = require('../identifier/index-empreintes');
const etat = require('../identifier/etat-empreintes');
const V = require('../identifier/voisins-empreinte');
const G = require('../../ratmarket/decision-g');

function graine(s) { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
function unitaire(r) { const v = new Float32Array(256); let s = 0; for (let i = 0; i < 256; i++) { v[i] = r() - 0.5; s += v[i] * v[i]; } s = Math.sqrt(s); for (let i = 0; i < 256; i++) v[i] /= s; return v; }
const SECRET = 'secret-de-banc-0123456789-abcdefghijklmnop';
const MODELE = { id: 'p8000-poids8-banc', sha256: crypto.createHash('sha256').update('poids-du-banc').digest('hex') };
const N = 300, rng = graine(99);
const cles = Array.from({ length: N }, (_, i) => `banc/jeu-${i}.webp`);
const matrice = new Float32Array(N * 256); for (let i = 0; i < N; i++) matrice.set(unitaire(rng), i * 256);
{ const r6 = graine(6), b = matrice.subarray(5 * 256, 6 * 256); let s = 0; const o = new Float32Array(256); for (let j = 0; j < 256; j++) { o[j] = b[j] * 0.98 + (r6() - 0.5) * 0.02; s += o[j] * o[j]; } s = Math.sqrt(s); for (let j = 0; j < 256; j++) matrice[6 * 256 + j] = o[j] / s; }   // jeu-6 : le jumeau de jeu-5 (même dessin, vecteur voisin)
const ligneDe = i => Float32Array.from(matrice.subarray(i * 256, (i + 1) * 256));
// le contexte G : jeu-3 est SEUL (affirmable sans pixels), jeu-5 et jeu-6 sont de même dessin (la garde des zones est demandée)
const contexte = { groupe: { 'banc/jeu-5.webp': 0, 'banc/jeu-6.webp': 0 }, carte: { 'banc/jeu-3.webp': [33], 'banc/jeu-5.webp': [55], 'banc/jeu-6.webp': [55] }, invisibles: {},
    produits: { 'banc/jeu-3.webp': [[703, 2.0]], 'banc/jeu-5.webp': [[705, 1.0]], 'banc/jeu-6.webp': [[706, 1.0]] } };
const cfgDe = (over = {}) => ({ empreinteExtension: true, modeleEmpreinte: { id: MODELE.id, sha256: MODELE.sha256, url: null, ...over } });
const installerIndex = () => { const o = X.ouvrir(X.sceller({ cles, matrice, contexte, modele: MODELE, chargeLe: '2026-10-17T14:14:00.000Z' }, SECRET), SECRET, { modeleAttendu: MODELE }); etat.installer(Object.freeze({ index: o.index, meta: o.meta })); return o.index; };
const entreeDe = (vecteurs, { modele = { id: MODELE.id, sha256: MODELE.sha256 } } = {}) => ({ empreintes: { rejet: null, modele, entrees: vecteurs }, imageUrls: ['https://images1.vinted.net/a.jpg', 'https://images1.vinted.net/b.jpg'] });
const ent = (photo, v, redressee = false) => ({ photo, vecteur: E.encoderVecteur(v), redressee });

(async () => {
    // ── lireEnveloppe : la forme de la requête, jugée avant tout calcul
    const L = (c, n = 2) => V.lireEnveloppe(c, n);
    const bonne = E.encoderVecteur(ligneDe(1));
    H.v('1a. ni empreintes ni modèle dans la requête : null (rien à dire, la réponse reste celle d\'avant)', [L({}), L({ empreintes: null, modeleEmpreinte: null })], [null, null]);
    const ok = L({ empreintes: [{ photo: 1, vecteur: bonne, redressee: true }, { photo: 0, vecteur: bonne }], modeleEmpreinte: { id: MODELE.id, sha256: MODELE.sha256 } });
    H.vrai('1b. une enveloppe valide : les entrées triées par index de photo, `redressee` faux par défaut, le modèle lu', ok && ok.rejet === null && ok.entrees.map(e => [e.photo, e.redressee]).join('|') === '0,false|1,true' && ok.modele.id === MODELE.id);
    const rejet = (nom, c) => H.v(nom, (L(c) || {}).rejet, 'enveloppe');
    rejet('2a. empreintes qui n\'est pas un tableau', { empreintes: 'oui' });
    rejet('2b. neuf entrées (8 au plus)', { empreintes: Array.from({ length: 9 }, () => ({ photo: 0, vecteur: bonne })) }, 9);
    rejet('2c. deux entrées pour la même photo (au plus UNE par photo)', { empreintes: [{ photo: 0, vecteur: bonne }, { photo: 0, vecteur: bonne }] });
    rejet('2d. un index de photo hors des imageUrls', { empreintes: [{ photo: 2, vecteur: bonne }] });
    rejet('2e. un index négatif ou non entier', { empreintes: [{ photo: -1, vecteur: bonne }] });
    rejet('2f. un index non entier (1,5)', { empreintes: [{ photo: 1.5, vecteur: bonne }] });
    rejet('2g. une entrée qui n\'est pas un objet', { empreintes: [bonne] });
    rejet('2h. un champ en trop dans l\'entrée', { empreintes: [{ photo: 0, vecteur: bonne, score: 1 }] });
    rejet('2i. `redressee` qui n\'est pas un booléen', { empreintes: [{ photo: 0, vecteur: bonne, redressee: 'oui' }] });
    rejet('2j. un vecteur qui n\'est pas une chaîne', { empreintes: [{ photo: 0, vecteur: [1, 2, 3] }] });
    rejet('2k. un vecteur démesuré (plus de 2 000 caractères : jamais retenu en mémoire)', { empreintes: [{ photo: 0, vecteur: 'A'.repeat(5000) }] });
    H.v('2l. un tableau VIDE d\'empreintes : enveloppe valide, aucune entrée (le serveur n\'en déduit rien)', (L({ empreintes: [] }) || {}).entrees, []);
    H.v('2m. un modèle mal formé : lu comme absent (modele null), jamais deviné', [(L({ empreintes: [], modeleEmpreinte: 'p8000' }) || {}).modele, (L({ empreintes: [], modeleEmpreinte: { id: 5, sha256: 7 } }) || {}).modele], [null, null]);

    // ── le fournisseur
    const aucun = { appels: 0 };
    const index = installerIndex();
    const espionVoisins = index.voisins.bind(index); index.voisins = (...a) => { aucun.appels++; return espionVoisins(...a); };
    const sans = V.creerFournisseurEmpreinte({ cfg: cfgDe() });
    const appel = (f, e) => f({ entree: e, scanId: 's1' });

    let r = await appel(sans, entreeDe([ent(0, ligneDe(3))], { modele: { id: 'autre', sha256: MODELE.sha256 } }));
    H.v('3a. une AUTRE version du modèle (identifiant) : les empreintes sont ignorées, code « modele-inconnu », l\'index n\'est même pas interrogé', [r.ok, r.code, aucun.appels], [false, 'modele-inconnu', 0]);
    r = await appel(sans, entreeDe([ent(0, ligneDe(3))], { modele: { id: MODELE.id, sha256: 'b'.repeat(64) } }));
    H.v('3b. … le sha256 des poids différent : « modele-inconnu »', [r.ok, r.code, aucun.appels], [false, 'modele-inconnu', 0]);
    r = await appel(sans, entreeDe([ent(0, ligneDe(3))], { modele: null }));
    H.v('3c. … aucun modèle annoncé : « modele-inconnu »', [r.ok, r.code], [false, 'modele-inconnu']);
    r = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe({ id: null, sha256: null }) }), entreeDe([ent(0, ligneDe(3))]));
    H.v('3d. le serveur ne connaît AUCUNE version (configuration vide) : « modele-inconnu », jamais « tout est bon »', [r.ok, r.code], [false, 'modele-inconnu']);
    r = await appel(sans, { ...entreeDe([ent(0, ligneDe(3))]), empreintes: { rejet: 'enveloppe', modele: { id: MODELE.id, sha256: MODELE.sha256 }, entrees: [] } });
    H.v('3e. enveloppe rejetée à la lecture de la requête : « invalide »', [r.ok, r.code, aucun.appels], [false, 'invalide', 0]);
    r = await appel(sans, entreeDe([]));
    H.v('3f. aucune entrée : « invalide » (rien à chercher)', [r.ok, r.code], [false, 'invalide']);

    // un vecteur au rang 1 d'une ligne de l'index, sans pixels nécessaires : jeu-3 est seul
    aucun.appels = 0;
    r = await appel(sans, entreeDe([ent(0, ligneDe(3), false)]));
    H.vrai('4a. un vecteur valide : ok, la ligne pour G = le top 10 de l\'index, jeu-3 au rang 1 (similarité ~1)', r.ok === true && r.ligne.top.length === 10 && r.ligne.top[0][0] === 'banc/jeu-3.webp' && r.ligne.top[0][1] >= 0.999);
    H.v('4b. nEssais vaut TOUJOURS 1 (un essai par photo) et `essai` 0 pour la photo entière, 1 pour une carte redressée', [r.nEssais, r.ligne.essai], [1, 0]);
    const rr = await appel(sans, entreeDe([ent(0, ligneDe(3), true)]));
    H.v('4c. `redressee: true` : essai 1', [rr.ligne.essai, rr.nEssais], [1, 1]);
    H.vrai('4d. le contexte G de l\'index et les seuils de la mesure sont rendus (SEUILS_G, inchangés)', r.contexteG === index.contexteG && JSON.stringify(r.seuils) === JSON.stringify(G.SEUILS_G));
    H.v('4e. UNE seule recherche par requête', aucun.appels, 2);                         // r puis rr
    // la décision de G sur cette ligne, par la fonction de la route : jeu-3 -> 703, sans mesure de pixels
    const RG = require('../identifier/regle-g');
    const d = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG }, r.seuils);
    H.v('4f. la règle G affirme 703 (un visuel, un produit) sans qu\'aucune mesure de pixels soit demandée', [d && d.issue, d && d.produit], ['affirmee', 703]);

    // le plus petit index de photo, et UN seul vecteur est jugé
    aucun.appels = 0;
    r = await appel(sans, entreeDe([ent(1, ligneDe(3)), ent(0, ligneDe(3))]));
    H.v('5a. deux entrées : une seule recherche, celle de la photo d\'index 0', [r.ok, r.photo, aucun.appels], [true, 0, 1]);
    aucun.appels = 0;
    const bruit = unitaire(graine(5));
    r = await appel(sans, entreeDe([ent(0, bruit), ent(1, ligneDe(3))]));
    H.v('5b. la photo 0 porte un vecteur au hasard (cosinus < 0,30) : « invalide » — on ne cherche PAS une seconde chance sur la photo 1', [r.ok, r.code], [false, 'invalide']);
    const gros = Float32Array.from(ligneDe(3)).map(x => x * 1.5);
    aucun.appels = 0;
    r = await appel(sans, entreeDe([ent(0, gros)]));
    H.v('5c. norme 1,5 : « invalide » et l\'index n\'est PAS interrogé', [r.ok, r.code, aucun.appels], [false, 'invalide', 0]);
    r = await appel(sans, { ...entreeDe([{ photo: 0, vecteur: 'pas-un-vecteur', redressee: false }]) });
    H.v('5d. une chaîne qui n\'est pas un vecteur : « invalide »', [r.ok, r.code], [false, 'invalide']);

    // pas d'index en place, ou un index d'un autre modèle
    etat.vider();
    r = await appel(sans, entreeDe([ent(0, ligneDe(3))]));
    H.v('6a. pas d\'index chargé : « indisponible » (G se tait, l\'identification continue)', [r.ok, r.code], [false, 'indisponible']);
    const autre = X.ouvrir(X.sceller({ cles, matrice, contexte, modele: { id: 'autre-modele', sha256: 'c'.repeat(64) }, chargeLe: '2026-10-17T14:14:00.000Z' }, SECRET), SECRET, { modeleAttendu: { id: 'autre-modele', sha256: 'c'.repeat(64) } });
    etat.installer(Object.freeze({ index: autre.index, meta: autre.meta }));
    r = await appel(sans, entreeDe([ent(0, ligneDe(3))]));
    H.v('6b. l\'index en place vient d\'un AUTRE modèle que la configuration : « indisponible » (jamais de voisins d\'un autre espace)', [r.ok, r.code], [false, 'indisponible']);
    installerIndex();

    // la garde des zones : les pixels sont fournis par un crochet
    const scripts = { paires: {}, zones: {}, appels: [] };
    const fauxZones = {
        photoGrise: async (data, w, h) => { scripts.appels.push(['photo', w, h]); return { delete() { scripts.appels.push(['photo-liberee']); } }; },
        comparerPaire: async (photo, a, b) => { scripts.appels.push(['paire', a.cle, b.cle]); const k = `${a.cle}|${b.cle}`; if (!scripts.paires[k]) throw new Error('paire non scénarisée'); return scripts.paires[k]; },
        scoresZones: async (photo, s) => { scripts.appels.push(['zones', s.cle]); return scripts.zones[s.cle]; }
    };
    scripts.paires['banc/jeu-5.webp|banc/jeu-6.webp'] = [0.30, 0.20];            // jeu-5 bat jeu-6 de 0,30 sur les pixels où ils diffèrent
    scripts.zones['banc/jeu-5.webp'] = { haut: 0.9, bas: 0.9, inliers: 120, illustration: 0.9, bandeau: 0.9, texte: 0.9 };
    let pixelsAppeles = { photo: 0, scan: [] };
    const pixels = { photo: async () => { pixelsAppeles.photo++; return { data: Buffer.alloc(420 * 586 * 3), width: 420, height: 586 }; }, scan: async cle => { pixelsAppeles.scan.push(cle); return Buffer.from('octets-' + cle); } };
    const avecPixels = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, pixels });
    r = await appel(avecPixels, entreeDe([ent(0, ligneDe(5), true)]));
    H.vrai('7a. jeu-5 a un jumeau (jeu-6) : la règle demande la comparaison de la paire PUIS les zones du gagnant ; les mesures reviennent au fournisseur', r.ok === true && scripts.appels.filter(a => a[0] === 'paire').length >= 1 && scripts.appels.some(a => a[0] === 'zones' && a[1] === 'banc/jeu-5.webp'));
    H.v('7b. la photo redressée a été demandée UNE fois, aux dimensions fournies, puis LIBÉRÉE', [pixelsAppeles.photo, scripts.appels.filter(a => a[0] === 'photo-liberee').length], [1, 1]);
    const d2 = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG }, r.seuils);
    H.v('7c. la décision de la route, rejouée sur les mesures rendues par le fournisseur (sans nouveau calcul de pixels), affirme 705', [d2 && d2.issue, d2 && d2.produit], ['affirmee', 705]);
    scripts.appels.length = 0;
    const d3 = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG }, r.seuils);
    H.vrai('7d. … et ce rejeu n\'appelle AUCUNE fonction de zones (les mesures sont en cache)', d3 && scripts.appels.length === 0);
    // pas de pixels branchés : G se tait quand elle a besoin des zones
    r = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones }), entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8a. les zones sont demandées et AUCUN crochet de pixels n\'est branché : « muette » (G ne devine pas)', [r.ok, r.code], [false, 'muette']);
    pixelsAppeles = { photo: 0, scan: [] };
    r = await appel(avecPixels, entreeDe([ent(0, ligneDe(5), false)]));
    H.v('8b. la photo entière (essai 0) et des jumeaux : G dit déjà qu\'elle ne peut pas juger — « muette » ou une question, jamais d\'appel de pixels pour une photo non redressée', [pixelsAppeles.photo, r.ok === false ? r.code : 'ok'].join(','), r.ok === false ? '0,muette' : '0,ok');
    pixelsAppeles = { photo: 0, scan: [] };
    r = await appel(avecPixels, entreeDe([ent(0, ligneDe(3), true)]));
    H.v('8c. aucun besoin de zones (jeu-3 seul) : le crochet de pixels n\'est JAMAIS appelé', [r.ok, pixelsAppeles.photo, pixelsAppeles.scan.length], [true, 0, 0]);
    const casse = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, pixels: { photo: async () => { throw new Error('réseau'); }, scan: async () => null } });
    r = await appel(casse, entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8d. le crochet de pixels LÈVE : « muette », jamais une exception', [r.ok, r.code], [false, 'muette']);
    const sansScan = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, pixels: { photo: pixels.photo, scan: async () => null } });
    r = await appel(sansScan, entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8e. un scan d\'archive introuvable pour le crochet : « muette »', [r.ok, r.code], [false, 'muette']);
    const photoNulle = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, pixels: { photo: async () => null, scan: pixels.scan } });
    r = await appel(photoNulle, entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8f. la photo redressée n\'a pas pu être produite : « muette »', [r.ok, r.code], [false, 'muette']);

    // l'index qui lève
    installerIndex().voisins = () => { throw new Error('index cassé'); };
    r = await appel(sans, entreeDe([ent(0, ligneDe(3))]));
    H.v('9. une recherche qui lève : « invalide » (la plausibilité ne conclut pas), jamais une exception', [r.ok, r.code], [false, 'invalide']);
    etat.vider();
    H.v('10. les codes publics sont une liste fermée', V.CODES, ['modele-inconnu', 'invalide', 'indisponible', 'muette']);
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });

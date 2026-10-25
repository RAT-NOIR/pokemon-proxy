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
const SECRET = 'secret-de-banc-' + '0123456789-abcdefghijklmnop';   // secret FABRIQUÉ de banc, en deux morceaux (contrôle d'avant push)
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
const sharp = require('sharp');
const bruit = (w, h) => { let x = 99; const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = (x >>> 24) & 0xff; } return b; };
const carteDe = async (w, h, q = 40) => (await sharp(bruit(w, h), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer()).toString('base64');
let CARTE = null;
const ent = (photo, v, redressee = false, carte = undefined) => ({ photo, vecteur: E.encoderVecteur(v), redressee, ...(carte === false ? {} : { carte: carte === undefined ? CARTE : carte }) });
const A_MODELE = () => ({ id: MODELE.id, sha256: MODELE.sha256 });

(async () => {
    CARTE = await carteDe(420, 587, 40);
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
    H.v('2d2. 🔑 M4 `photo` vaut 0 à 7 : 7 accepté (avec 20 images), 8 rejeté', [(L({ empreintes: [{ photo: 7, vecteur: bonne }] }, 20) || {}).rejet, (L({ empreintes: [{ photo: 8, vecteur: bonne }] }, 20) || {}).rejet], [null, 'enveloppe']);
    rejet('2e. un index négatif ou non entier', { empreintes: [{ photo: -1, vecteur: bonne }] });
    rejet('2f. un index non entier (1,5)', { empreintes: [{ photo: 1.5, vecteur: bonne }] });
    rejet('2g. une entrée qui n\'est pas un objet', { empreintes: [bonne] });
    { const e2h = L({ empreintes: [{ photo: 0, vecteur: bonne, score: 1 }, { photo: 1, vecteur: bonne }] }); H.v('2h. 🔑 M4 une clé inconnue dans une entrée rejette CETTE ENTRÉE seulement (marquée), jamais l\'enveloppe : l\'autre entrée reste lue', [e2h.rejet, e2h.entrees.map(e => !!e.invalide)], [null, [true, false]]); }
    rejet('2i. `redressee` qui n\'est pas un booléen', { empreintes: [{ photo: 0, vecteur: bonne, redressee: 'oui' }] });
    rejet('2j. un vecteur qui n\'est pas une chaîne', { empreintes: [{ photo: 0, vecteur: [1, 2, 3] }] });
    rejet('2k. un vecteur démesuré (plus de 2 000 caractères : jamais retenu en mémoire)', { empreintes: [{ photo: 0, vecteur: 'A'.repeat(5000) }] });
    H.v('2l. un tableau VIDE d\'empreintes : enveloppe valide, aucune entrée (le serveur n\'en déduit rien)', (L({ empreintes: [] }) || {}).entrees, []);
    H.v('2m. un modèle mal formé : lu comme absent (modele null), jamais deviné', [(L({ empreintes: [], modeleEmpreinte: 'p8000' }) || {}).modele, (L({ empreintes: [], modeleEmpreinte: { id: 5, sha256: 7 } }) || {}).modele], [null, null]);

    // ── le fournisseur
    const aucun = { appels: 0 };
    const index = installerIndex();
    // MARQUE-EMPRUNT : sans archive en place tout est « inconnu » donc emprunté et G se tait ; le banc installe donc une archive qui déclare ses trois produits propres (colonne des emprunts vide)
    const versionDuBanc = () => { const { creerConstructeur } = require('../chargeur/version'); const b = creerConstructeur({ emprunts: true }); for (const id of [703, 705, 706]) b.entree({ idProduct: id, vignette: { cle: `v/${id}.webp`, w: 200, h: 279 }, grande: null, visuel: 'du-set', mention: null, idMetacard: 1, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null }); return b.finir(new Date('2026-10-25T10:00:00.000Z')); };
    require('../chargeur/etat').installer(versionDuBanc());
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
    r = await appel(sans, entreeDe([{ ...ent(0, ligneDe(3)), invalide: true }]));
    H.v('3f. 🔑 M4 l\'entrée jugée porte une clé inconnue (marquée) : « invalide », aucune recherche, la règle G se tait', [r.ok, r.code, aucun.appels], [false, 'invalide', 0]);
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
    const d = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG, emprunte: () => false }, r.seuils);
    H.v('4f. la règle G affirme 703 (un visuel, un produit) sans qu\'aucune mesure de pixels soit demandée', [d && d.issue, d && d.produit], ['affirmee', 703]);
    // MARQUE-EMPRUNT : le contexte rendu à la route (donc lu par les mesures ET par la décision) est celui de la version en place où 703 est EMPRUNTÉ : un reste de sa carte, plus un produit du visuel
    { const etatVersion = require('../chargeur/etat'), { creerConstructeur } = require('../chargeur/version');
        const b = creerConstructeur({ emprunts: true }); for (const id of [703, 705, 706]) b.entree({ idProduct: id, vignette: { cle: `v/${id}.webp`, w: 200, h: 279 }, grande: null, visuel: 'du-set', mention: null, idMetacard: 1, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null }); b.emprunt(703);
        etatVersion.installer(b.finir(new Date('2026-10-25T10:00:00.000Z')));
        try {
            const re = await appel(sans, entreeDe([ent(0, ligneDe(3), false)]));
            H.v('4g. MARQUE-EMPRUNT : le contexte rendu n\'est plus celui de l\'index (703 emprunté) : produits du visuel vidés, 703 parmi les restes de sa carte, l\'index intact', [re.ok, re.contexteG === index.contexteG, re.contexteG.produits.get('banc/jeu-3.webp'), re.contexteG.invisibles.get(33), index.contexteG.produits.get('banc/jeu-3.webp')], [true, false, [], [703], [[703, 2]]]);
            const de = RG.decisionRegleG({ ligne: re.ligne, nEssais: re.nEssais, mesures: re.mesures, contexteG: re.contexteG }, re.seuils);
            H.v('4h. … et la décision ne l\'affirme plus (null : la chaîne héritée décide)', de, null);
        } finally { etatVersion.installer(versionDuBanc()); } }

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

    // la garde des zones : les PIXELS sont la carte redressée jointe par l'extension (jamais téléchargée) ; seuls les scans de l'archive viennent d'un crochet `scan`
    const scripts = { paires: {}, zones: {}, appels: [] };
    const fauxZones = {
        photoGrise: async (data, w, h) => { scripts.appels.push(['photo', w, h, data.length]); return { delete() { scripts.appels.push(['photo-liberee']); } }; },
        comparerPaire: async (photo, a, b) => { scripts.appels.push(['paire', a.cle, b.cle]); const k = `${a.cle}|${b.cle}`; if (!scripts.paires[k]) throw new Error('paire non scénarisée'); return scripts.paires[k]; },
        scoresZones: async (photo, s) => { scripts.appels.push(['zones', s.cle]); return scripts.zones[s.cle]; }
    };
    scripts.paires['banc/jeu-5.webp|banc/jeu-6.webp'] = [0.30, 0.20];            // jeu-5 bat jeu-6 de 0,30 sur les pixels où ils diffèrent
    scripts.zones['banc/jeu-5.webp'] = { haut: 0.9, bas: 0.9, inliers: 120, illustration: 0.9, bandeau: 0.9, texte: 0.9 };
    let scansDemandes = [];
    const scan = async cle => { scansDemandes.push(cle); return Buffer.from('octets-' + cle); };
    const avecPixels = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, scan });
    r = await appel(avecPixels, entreeDe([ent(0, ligneDe(5), true)]));
    H.vrai('7a. jeu-5 a un jumeau (jeu-6) : la règle demande la comparaison de la paire PUIS les zones du gagnant ; les mesures reviennent au fournisseur', r.ok === true && scripts.appels.filter(a => a[0] === 'paire').length >= 1 && scripts.appels.some(a => a[0] === 'zones' && a[1] === 'banc/jeu-5.webp'));
    H.v('7b. la photo redressée est la CARTE jointe : 420 × 587 × 3 octets, demandée UNE fois, puis LIBÉRÉE', [scripts.appels.filter(a => a[0] === 'photo').map(a => a.slice(1)), scripts.appels.filter(a => a[0] === 'photo-liberee').length], [[[420, 587, 420 * 587 * 3]], 1]);
    const d2 = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG, emprunte: () => false }, r.seuils);
    H.v('7c. la décision de la route, rejouée sur les mesures rendues par le fournisseur (sans nouveau calcul de pixels), affirme 705', [d2 && d2.issue, d2 && d2.produit], ['affirmee', 705]);
    scripts.appels.length = 0;
    const d3 = RG.decisionRegleG({ ligne: r.ligne, nEssais: r.nEssais, mesures: r.mesures, contexteG: r.contexteG, emprunte: () => false }, r.seuils);
    H.vrai('7d. … et ce rejeu n\'appelle AUCUNE fonction de zones (les mesures sont en cache)', d3 && scripts.appels.length === 0);
    // sans crochet de scans : G se tait quand elle a besoin des zones
    r = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones }), entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8a. les zones sont demandées et AUCUN crochet de scans n\'est branché : « muette » (G ne devine pas)', [r.ok, r.code], [false, 'muette']);
    scansDemandes = []; scripts.appels.length = 0;
    r = await appel(avecPixels, entreeDe([ent(0, ligneDe(3), true)]));
    H.v('8c. aucun besoin de zones (jeu-3 seul) : ni scan ni mesure demandés', [r.ok, scansDemandes.length, scripts.appels.filter(a => a[0] !== 'photo' && a[0] !== 'photo-liberee').length], [true, 0, 0]);
    const casse = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, scan: async () => { throw new Error('réseau'); } });
    r = await appel(casse, entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8d. le crochet de scans LÈVE : « muette », jamais une exception', [r.ok, r.code], [false, 'muette']);
    const sansScan = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, scan: async () => null });
    r = await appel(sansScan, entreeDe([ent(0, ligneDe(5), true)]));
    H.v('8e. un scan d\'archive introuvable pour le crochet : « muette »', [r.ok, r.code], [false, 'muette']);

    // ── la CARTE : ce que le serveur AUTORISE, et rien d'autre ; sinon G se tait, même quand aucune mesure n'est demandée (jeu-3 : un visuel, un produit)
    const sains = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: fauxZones, scan });
    const sansCarte = async (nom, e, raison) => { scansDemandes = []; const x = await appel(sains, entreeDe([e])); H.v(nom, [x.ok, x.code, x.raison, scansDemandes.length], [false, 'muette', raison, 0]); };
    await sansCarte('9a. entrée SANS carte : G se tait, même pour un vecteur parfait qui n\'a besoin d\'aucune mesure', ent(0, ligneDe(3), true, false), 'absente');
    await sansCarte('9b. carte qui n\'est pas une chaîne', { ...ent(0, ligneDe(3), true), carte: 42 }, 'forme');
    await sansCarte('9c. carte qui n\'est pas un JPEG (du texte)', { ...ent(0, ligneDe(3), true), carte: Buffer.from('pas une image').toString('base64') }, 'format');
    await sansCarte('9d. carte d\'une autre taille (419 × 587)', ent(0, ligneDe(3), true, await carteDe(419, 587)), 'dimensions');
    await sansCarte('9e. carte trop lourde (JPEG q100, plus de 200 Ko)', ent(0, ligneDe(3), true, await carteDe(420, 587, 100)), 'taille');
    await sansCarte('9f. carte tronquée (sans EOI)', ent(0, ligneDe(3), true, Buffer.from(CARTE, 'base64').subarray(0, 5000).toString('base64').replace(/=+$/, '').padEnd(Math.ceil(5000 / 3) * 4, '=')), 'format');
    // une carte d'une AUTRE entrée : seule l'entrée de la photo jugée compte
    scansDemandes = [];
    r = await appel(sains, entreeDe([ent(0, ligneDe(3), true, false), ent(1, ligneDe(3), true)]));
    H.v('9g. la carte de la photo 1 ne sert pas au vecteur de la photo 0 (la photo 0 n\'en porte pas) : « muette », raison « absente »', [r.ok, r.code, r.raison], [false, 'muette', 'absente']);
    r = await appel(sains, entreeDe([ent(0, ligneDe(3), true), ent(1, ligneDe(5), true, false)]));
    H.v('9h. contrôle : la photo 0 avec SA carte est jugée normalement, quelle que soit la carte de la photo 1', [r.ok, r.photo], [true, 0]);
    // la carte ne change JAMAIS le vecteur ni les voisins : même ligne avec deux cartes différentes
    const cA = await appel(sains, entreeDe([ent(0, ligneDe(3), true, await carteDe(420, 587, 30))])), cB = await appel(sains, entreeDe([ent(0, ligneDe(3), true, await carteDe(420, 587, 50))]));
    H.v('9i. les voisins ne dépendent pas de la carte (deux cartes, mêmes voisins)', JSON.stringify(cA.ligne), JSON.stringify(cB.ligne));

    // lireEnveloppe et `carte`
    const bonneCarte = CARTE;
    const eC = V.lireEnveloppe({ empreintes: [{ photo: 1, vecteur: bonne, carte: bonneCarte }, { photo: 0, vecteur: bonne, carte: bonneCarte }], modeleEmpreinte: A_MODELE() }, 2);
    H.v('10a. la carte n\'est retenue QUE pour la photo jugée (la plus petite) — le reste n\'occupe pas la mémoire', eC.entrees.map(e => [e.photo, typeof e.carte]), [[0, 'string'], [1, 'object']]);
    const eD = V.lireEnveloppe({ empreintes: [{ photo: 0, vecteur: bonne, carte: 'A'.repeat(300000) }], modeleEmpreinte: A_MODELE() }, 1);
    H.v('10b. une carte démesurée (> 273 068 caractères) : l\'enveloppe reste valide, la carte est écartée (null) — la photo ne conclura pas', [eD.rejet, eD.entrees[0].carte], [null, null]);
    H.v('10c. une carte qui n\'est pas une chaîne : écartée, enveloppe valide', [V.lireEnveloppe({ empreintes: [{ photo: 0, vecteur: bonne, carte: 5 }] }, 1).rejet, V.lireEnveloppe({ empreintes: [{ photo: 0, vecteur: bonne, carte: 5 }] }, 1).entrees[0].carte], [null, null]);

    // ── TOUR 2 (I2) : la garde des zones est BORNÉE — budget de mesures par requête, longueur de la file, arrêt au délai. Chaque borne a sa variante qui échoue (la borne retirée change l'issue).
    {
        const compteur = { paires: 0, zones: 0 };
        const lente = (ms, porte = null) => ({
            photoGrise: async () => ({ delete() { } }),
            comparerPaire: async () => { compteur.paires++; if (porte) await porte; else await new Promise(r => setTimeout(r, ms)); return [0.30, 0.20]; },
            scoresZones: async () => { compteur.zones++; if (porte) await porte; else await new Promise(r => setTimeout(r, ms)); return { haut: 0.9, bas: 0.9, inliers: 120 }; }
        });
        const req5 = () => entreeDe([ent(0, ligneDe(5), true)]);          // jeu-5 et son jumeau jeu-6 : DEUX mesures (la paire, puis les zones)
        // budget
        let x = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: lente(0), scan, budget: 1 }), req5());
        H.v('11a. budget de mesures par requête = 1 (la règle en demande 2) : « indisponible », G se tait', [x.ok, x.code], [false, 'indisponible']);
        x = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: lente(0), scan, budget: 2 }), req5());
        H.v('11b. 🔑 variante : le même budget relevé à 2 ⇒ la requête aboutit (la borne est ce qui refusait)', x.ok, true);
        H.v('11c. le budget par défaut est une constante nommée et suffit au rejeu mesuré', [typeof V.BUDGET_MESURES, V.BUDGET_MESURES >= 2], ['number', true]);
        // file
        let ouvrir; const porte = new Promise(r => { ouvrir = r; });
        compteur.paires = 0; compteur.zones = 0;
        const fournisseurFile = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: lente(0, porte), scan, fileMax: 2 });
        const lot = [0, 1, 2, 3].map(() => appel(fournisseurFile, req5()));
        await new Promise(r => setTimeout(r, 300));
        const rapides = await Promise.race([Promise.all(lot.map(p => Promise.race([p, new Promise(r => setTimeout(() => r('attente'), 50))])))]);
        H.v('12a. file de la garde des zones limitée à 2 : sur 4 requêtes simultanées, 2 sont refusées TOUT DE SUITE (« indisponible »), sans avoir mesuré', [rapides.filter(r => r && r.code === 'indisponible').length, rapides.filter(r => r === 'attente').length], [2, 2]);
        ouvrir();
        const finales = await Promise.all(lot);
        H.v('12b. … les deux autres aboutissent une fois la porte ouverte', finales.filter(r => r.ok).length, 2);
        H.v('12c. le compteur de la file retombe à 0 (aucune fuite après succès, refus ou erreur)', V.enFile(), 0);
        ouvrir = null;
        let ouvrir2; const porte2 = new Promise(r => { ouvrir2 = r; });
        const sansFile = V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: lente(0, porte2), scan, fileMax: 99 });
        const lot2 = [0, 1, 2, 3].map(() => appel(sansFile, req5()));
        await new Promise(r => setTimeout(r, 200));
        const att = await Promise.all(lot2.map(p => Promise.race([p, new Promise(r => setTimeout(() => r('attente'), 30))])));
        H.v('12d. 🔑 variante : file de 99 ⇒ AUCUNE requête refusée (les 4 attendent la porte) — la borne de 2 est ce qui refusait', att.filter(r => r && r.code === 'indisponible').length, 0);
        ouvrir2(); await Promise.all(lot2);
        // arrêt au délai
        compteur.paires = 0; compteur.zones = 0;
        x = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: lente(120), scan, delaiMs: 80 }), req5());
        const apresReponse = compteur.paires + compteur.zones;
        await new Promise(r => setTimeout(r, 400));
        H.v('13a. délai de 80 ms, mesures de 120 ms : « indisponible », et le travail CESSE (aucune mesure de plus après le délai)', [x.ok, x.code, compteur.paires + compteur.zones - apresReponse], [false, 'indisponible', 0]);
        compteur.paires = 0; compteur.zones = 0;
        x = await appel(V.creerFournisseurEmpreinte({ cfg: cfgDe(), zones: lente(120), scan, delaiMs: 5000 }), req5());
        H.v('13b. 🔑 variante : délai de 5 s ⇒ les deux mesures ont lieu et la requête aboutit', [x.ok, compteur.paires, compteur.zones], [true, 1, 1]);
    }
    // M5 : scanArchivePublic lit en flux borné
    {
        const png = n => Buffer.alloc(n, 7);
        const flux = (taille, entetes = {}) => { let lus = 0; const morceau = 64 * 1024; return { stat: () => lus, fetch: async () => { const body = new ReadableStream({ pull(c) { if (lus >= taille) return c.close(); const n = Math.min(morceau, taille - lus); lus += n; c.enqueue(new Uint8Array(png(n))); } }); return new Response(body, { status: 200, headers: { 'content-type': 'image/webp', ...entetes } }); } }; };
        const lire = async (f, max) => V.scanArchivePublic({ hote: 'h.invalide', fetchFn: f.fetch, octetsMax: max })('banc-reel/v2/x.webp');
        const f1 = flux(500 * 1024);
        H.v('14a. une image de 500 Ko sous la borne de 2 Mo : lue en entier', (await lire(f1, 2 * 1048576) || Buffer.alloc(0)).length, 500 * 1024);
        const f2 = flux(50 * 1048576);
        H.v('14b. 🔑 un corps de 50 Mo SANS Content-Length : refusé, et la lecture S\'ARRÊTE près de la borne (moins de 3 Mo tirés)', [await lire(f2, 2 * 1048576), f2.stat() < 3 * 1048576], [null, true]);
        const f3 = flux(50 * 1048576, { 'content-length': String(50 * 1048576) });
        H.v('14c. Content-Length de 50 Mo annoncé : refusé sans rien lire de plus d\'un morceau', [await lire(f3, 2 * 1048576), f3.stat() <= 64 * 1024], [null, true]);
        const f4 = flux(500 * 1024);
        H.v('14d. variante : la même image avec une borne de 100 Ko ⇒ refusée (la borne est ce qui refuse)', await lire(f4, 100 * 1024), null);
    }
    // l'index qui lève
    installerIndex().voisins = () => { throw new Error('index cassé'); };
    r = await appel(sans, entreeDe([ent(0, ligneDe(3))]));
    H.v('9. une recherche qui lève : « invalide » (la plausibilité ne conclut pas), jamais une exception', [r.ok, r.code], [false, 'invalide']);
    etat.vider();
    H.v('10. les codes publics sont une liste fermée', V.CODES, ['modele-inconnu', 'invalide', 'indisponible', 'muette']);
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
// MEMOIRE-G — LA MÉMOIRE DE LA RÈGLE G SUR DES DONNÉES RÉELLES : l'index scellé des empreintes, les cartes redressées et les vecteurs des bancs, les scans de l'archive ; N appels de suite (500 au moins),
// par le MÊME chemin que la route (fournisseur de voisins + garde des zones + règle G), puis la chaîne héritée du départage par l'image (decrire + inliers) sur la même carte.
//   node v2/mesures/mesurer-memoire-g.js [--appels=1000] [--sortie=fichier.json] [--sans-chaine-heritee]
// ⚠️ NON JOUABLE sans ses entrées, qui se donnent par VARIABLES D'ENVIRONNEMENT (jamais un chemin du poste dans ce fichier) :
//   RM_MEMOIRE_G_DONNEES  dossier contenant  index.rmei  (l'index scellé), nav-bancs.json  ({ photos: { <id>: { emb: [256 nombres], redressee: bool } } })  et  cartes/<id>.jpg  (la carte redressée 420 × 587 de la photo)
//   RM_MEMOIRE_G_SCANS    les dossiers des scans de l'archive (<sha1 de la clé>.webp), séparés par le séparateur de chemins du système
//   V2_VISUELS_HMAC       le secret qui scelle l'index (jamais imprimé)
// Ce qui est MESURÉ, et ce qui est JUGÉ (le code de sortie est 1 si une borne tombe) :
//   · les objets C++ d'OpenCV (Mat, vecteurs…) restés vivants : EXACTEMENT 3 par scan en cache (image, descripteurs, gradient) — une fuite par appel le fait grimper sans limite ;
//   · la taille de la mémoire WASM : constante après la chauffe (100 appels) ;
//   · le RSS après ramasse-miettes : la chauffe (OpenCV, caches bornés, cache de sharp) le monte une fois, en une cinquantaine d'appels ; entre le 200e appel et le dernier il ne doit pas grandir de plus de BORNE_RSS_MO.
//     BORNE_RSS_MO = 40 : sur le code corrigé, 1 000 appels, les relevés du 200e au 1 000e vont de 544 à 566 Mo (amplitude 22 Mo : le RSS fluctue de ±12 Mo d'un relevé à l'autre, pages rendues ou non à
//     l'OS), donc 40 Mo = l'amplitude vue + une marge de moitié. Elle attrape une fuite de plus de 50 Ko par appel ; elle n'attrape PAS celle d'inliers() (≈ 12 Ko par appel, 10 Mo en 800 appels, noyée dans
//     le bruit) : le garde EXACT est le compte des objets C++ ci-dessus, qui monte de 150 par appel sur l'ancien code.
const path = require('path'), fs = require('fs'), crypto = require('crypto'), { spawnSync } = require('child_process');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DONNEES = process.env.RM_MEMOIRE_G_DONNEES, SCANS = process.env.RM_MEMOIRE_G_SCANS, HMAC = process.env.V2_VISUELS_HMAC;
if (!DONNEES || !SCANS || !HMAC) {
    console.log('NON JOUABLE : RM_MEMOIRE_G_DONNEES, RM_MEMOIRE_G_SCANS et V2_VISUELS_HMAC sont obligatoires (index scellé, cartes et vecteurs des bancs, scans de l\'archive, secret du scellement). Rien n\'est mesuré.');
    process.exit(0);
}
if (!global.gc) { const r = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status); }

const V = require('../test/_embind-vivants').armer();       // AVANT tout require d'opencv
const racine = path.join(__dirname, '..', '..');
const X = require(path.join(racine, 'v2/identifier/index-empreintes.js')), etat = require(path.join(racine, 'v2/identifier/etat-empreintes.js'));
const VO = require(path.join(racine, 'v2/identifier/voisins-empreinte.js')), EV = require(path.join(racine, 'v2/identifier/empreinte-vecteur.js'));
const RG = require(path.join(racine, 'v2/identifier/regle-g.js')), Z = require(path.join(racine, 'ratmarket/zones.js')), D = require(path.join(racine, 'departage-image.js'));
const N = Number(arg('appels', 1000)), SORTIE = arg('sortie', null), HERITEE = !process.argv.includes('--sans-chaine-heritee');
const BORNE_RSS_MO = 40, CHAUFFE = 100, REFERENCE_RSS = 200;
if (!(N >= 500)) { console.log(`🔴 --appels=${N} : au moins 500 appels (une fuite lente ne se voit qu'à ce prix)`); process.exit(1); }
const mo = x => Math.round(x / 1048576);
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const dossiersScans = SCANS.split(path.delimiter).filter(Boolean);
const lireScan = async cle => { for (const d of dossiersScans) { const p = path.join(d, sha1(cle) + '.webp'); if (fs.existsSync(p)) return fs.readFileSync(p); } return null; };

(async () => {
    const scelle = fs.readFileSync(path.join(DONNEES, 'index.rmei'));
    // le modèle attendu est celui que l'index déclare : cette mesure juge la MÉMOIRE, pas le choix du modèle
    const entete = JSON.parse(scelle.subarray(8, 8 + scelle.readUInt32LE(4)).toString('utf8'));
    const MODELE = { id: entete.modele.id, sha256: entete.modele.sha256 };
    const nav = JSON.parse(fs.readFileSync(path.join(DONNEES, 'nav-bancs.json'), 'utf8'));
    const ids = Object.keys(nav.photos).filter(i => nav.photos[i].redressee && fs.existsSync(path.join(DONNEES, 'cartes', i + '.jpg')));
    if (!ids.length) { console.log('🔴 aucune carte redressée dans les données'); process.exit(1); }
    const rss0 = (() => { global.gc(); return mo(process.memoryUsage().rss); })();
    const o = X.ouvrir(scelle, HMAC, { modeleAttendu: MODELE });
    etat.installer(Object.freeze({ index: o.index, meta: Object.freeze(o.meta) }));
    global.gc();
    const repos = { rss: mo(process.memoryUsage().rss), tas: mo(process.memoryUsage().heapUsed), avantIndex: rss0 };
    console.log(`index ouvert : ${o.meta.n} visuels · RSS ${rss0} → ${repos.rss} Mo (tas JS ${repos.tas} Mo) · ${ids.length} cartes distinctes jouées en boucle`);
    const fournisseur = VO.creerFournisseurEmpreinte({ cfg: { modeleEmpreinte: MODELE }, scan: lireScan, delaiMs: 600000 });
    const msG = [], msH = [], releves = [];
    const nbrBase = {};
    for (let k = 0; k < N; k++) {
        const id = ids[k % ids.length], p = nav.photos[id];
        const carte = fs.readFileSync(path.join(DONNEES, 'cartes', id + '.jpg'));
        const corps = { empreintes: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: carte.toString('base64') }], modeleEmpreinte: MODELE };
        const entree = { imageUrls: ['x'], empreintes: VO.lireEnveloppe(corps, 1) };
        const t = process.hrtime.bigint();
        const v = await fournisseur({ entree, scanId: id });
        if (v.ok) RG.decisionRegleG({ ligne: v.ligne, nEssais: v.nEssais, mesures: v.mesures, contexteG: v.contexteG }, v.seuils);
        msG.push(Number(process.hrtime.bigint() - t) / 1e6);
        nbrBase[v.ok ? 'ok' : v.code] = (nbrBase[v.ok ? 'ok' : v.code] || 0) + 1;
        if (HERITEE && v.ok) {              // la chaîne héritée du départage : la carte contre le scan du premier voisin (decrire + inliers), comme departager() le fait pour chaque candidat
            const t2 = process.hrtime.bigint();
            try { const sc = await lireScan(v.ligne.top[0][0]); if (sc) { const a = await D.decrire(carte), b = await D.decrire(sc); const { cv } = await D.outils(); D.inliers(cv, a, b); } } catch { /* un scan illisible n'est pas une fuite */ }
            msH.push(Number(process.hrtime.bigint() - t2) / 1e6);
        }
        if ((k + 1) % 100 === 0 || k === 0) {
            global.gc();
            const m = process.memoryUsage(), viv = V.vivants();
            releves.push({ appels: k + 1, rss: mo(m.rss), tas: mo(m.heapUsed), externe: mo(m.external), wasm: mo(V.octetsWasm() || 0), vivants: viv.n, scansEnCache: Z._scans.size, paires: Z._paires.size });
            console.log(JSON.stringify(releves[releves.length - 1]));
        }
    }
    const pris = a => releves.find(r => r.appels === a);
    const dernier = releves[releves.length - 1], ref = pris(REFERENCE_RSS), chauffe = pris(CHAUFFE);
    const croissanceRss = dernier.rss - ref.rss;
    const verdicts = [
        [`objets C++ vivants = 3 par scan en cache, à chaque relevé (aucune fuite)`, releves.every(r => r.vivants === 3 * r.scansEnCache), releves.map(r => `${r.vivants}/${3 * r.scansEnCache}`).join(' ')],
        [`mémoire WASM constante après la chauffe (${chauffe.wasm} Mo)`, releves.filter(r => r.appels >= CHAUFFE).every(r => r.wasm === chauffe.wasm), releves.map(r => r.wasm).join(' ')],
        [`RSS : ${dernier.rss} Mo au ${dernier.appels}e appel, ${ref.rss} Mo au ${REFERENCE_RSS}e : croissance ${croissanceRss} Mo (borne ${BORNE_RSS_MO} Mo)`, croissanceRss <= BORNE_RSS_MO, '']
    ];
    const rapport = { appels: N, cartesDistinctes: ids.length, repos, releves, chauffe: { rssApres100: chauffe.rss }, issues: nbrBase,
        tempsG: { medianeMs: Math.round(quant(msG, 0.5)), p95Ms: Math.round(quant(msG, 0.95)) }, tempsHeritee: msH.length ? { medianeMs: Math.round(quant(msH, 0.5)), p95Ms: Math.round(quant(msH, 0.95)) } : null,
        rssA500: (pris(500) || {}).rss ?? null, rssA1000: (pris(1000) || {}).rss ?? null };
    console.log(`\nRSS au repos avec l'index : ${repos.rss} Mo · après 500 appels : ${rapport.rssA500} Mo · après 1 000 : ${rapport.rssA1000} Mo`);
    console.log(`temps de G par appel : médiane ${rapport.tempsG.medianeMs} ms, p95 ${rapport.tempsG.p95Ms} ms${rapport.tempsHeritee ? ` · chaîne héritée (decrire x2 + inliers) : médiane ${rapport.tempsHeritee.medianeMs} ms, p95 ${rapport.tempsHeritee.p95Ms} ms` : ''}`);
    console.log(`issues du fournisseur : ${JSON.stringify(nbrBase)}`);
    let echecs = 0;
    for (const [nom, bon, detail] of verdicts) { console.log(`${bon ? '✅' : '🔴'} ${nom}${bon ? '' : ` — ${detail}`}`); if (!bon) echecs++; }
    if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify(rapport, null, 1));
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.stack); process.exit(1); });

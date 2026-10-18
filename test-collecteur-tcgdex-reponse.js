// node test-collecteur-tcgdex-reponse.js — M5 (correction 1) : la règle commune de réponse VUE PAR LE COLLECTEUR TCGdex (collecterSet, chemin indonésien : un set lu depuis le cache).
// Faux transport axios (aucune requête), base en mémoire minimale, dossier de pauses TEMPORAIRE. Trois cas :
//   · 200 text/html à la place d'une image → fichier absent, on passe à la SUIVANTE, aucun arrêt ;
//   · défi (403 / 503 « Just a moment ») → arrêt DURABLE de la source (fichier), état « arret-hote », l'unité suivante ne fait AUCUNE requête ;
//   · trop de fausses absences d'affilée → PAUSE de l'hôte (état « incomplet », pauseHote), l'unité suivante ne fait AUCUNE requête ; ni arrêt durable.
// (Le collecteur fabrique SON client : le seuil du compteur est celui du registre du processus, abaissé ici à 2 par un suivi injecté dans le registre.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
process.env.ARRETS_HOTES_DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'tcgdex-col-pauses-'));      // AVANT l'import du module : le collecteur écrit dans ce dossier temporaire, jamais dans celui du dépôt
const RH = require('./collecte-cartes/reponse-hote');
const T = require('./collecteur-images-tcgdex');
const { issueDeLUnite } = require('./collecte-cartes/issue-unite');
const { TABLE } = require('./collecte-cartes/table-sets');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const silencieux = async f => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };

const L = TABLE.find(l => l.bulba?.tirage === 'idth' && l.slugSet && typeof l.bulba?.expansion === 'string');
if (!L) throw new Error('table sans ligne idth à slugSet : le banc ne peut pas conclure');
const CODE = L.code, SLUG = L.slugSet, TIRAGE = L.bulba.tirage, EXPANSION = L.bulba.expansion;
const NOMS = ['Pikachu', 'Raichu', 'Eevee', 'Snorlax', 'Mew'];
const carteTcg = (i, n) => ({ id: `${CODE}-${String(i).padStart(3, '0')}`, localId: String(i).padStart(3, '0'), name: NOMS[(i - 1) % NOMS.length] + (i > NOMS.length ? ` ${i}` : ''), image: `https://assets.tcgdex.net/id/x/${CODE}/${String(i).padStart(3, '0')}` });
const NB = 5;

function monde({ sansCache = false } = {}) {
    const col = new Map();
    const lire = (o, k) => k.split('.').reduce((v, p) => v?.[p], o);
    const ecrire = (o, k, v) => { const ps = k.split('.'); let y = o; for (const p of ps.slice(0, -1)) y = y[p] ??= {}; y[ps.at(-1)] = v; };
    const appliquer = (d, u) => { for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v); for (const k of Object.keys(u.$unset || {})) delete d[k]; };
    const req = d => ({ lean: async () => structuredClone(d), select() { return this; } });
    const echecs = [];
    const tcgdexSets = new Map([
        [`id/__liste__`, { _id: 'id/__liste__', sets: [{ id: CODE, name: 'Nom Traduit' }] }],
        [`id/${CODE}`, { _id: `id/${CODE}`, cartes: Array.from({ length: NB }, (_, i) => carteTcg(i + 1)) }]
    ]);
    if (sansCache) tcgdexSets.delete(`id/${CODE}`);
    const db = { collection: n => (n === 'tcgdex_sets' ? { async findOne(f) { return tcgdexSets.get(f._id) ?? null; }, async updateOne() { return {}; } } : { find: () => ({ toArray: async () => [] }), findOne: async () => null, countDocuments: async () => 0, updateOne: async () => ({}) }) };
    const EtatImages = {
        findById: id => req(col.get(id) ?? null),
        async updateOne(f, u) { const d = col.get(f._id); if (!d) return { matchedCount: 0 }; appliquer(d, u); return { matchedCount: 1 }; },
        findOneAndUpdate(f, u) { let d = col.get(f._id); if (!d) { d = { _id: f._id, ...(u.$setOnInsert || {}) }; col.set(d._id, d); } appliquer(d, u); return { lean: async () => structuredClone(d) }; }
    };
    const cartes = Array.from({ length: NB }, (_, i) => ({ _id: 100 + i, nomEn: carteTcg(i + 1).name, impressions: [{ tirage: TIRAGE, expansion: EXPANSION, numero: String(i + 1).padStart(3, '0') }], sets: [SLUG] }));
    const Carte = { db: { db }, find: () => req(cartes), findById: () => req({ images: [] }), async updateOne() { return {}; } };
    const Image = { find: () => req([]), findById: () => req(null), async updateOne(f, u) { if (u.$set?.etat === 'echec') echecs.push(f._id); return {}; } };
    return { M: { Carte, Image, EtatImages, Set: { updateOne: async () => ({}) } }, echecs };
}

(async () => {
    const png = await sharp({ create: { width: 700, height: 980, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
    const dp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcgdex-col-'));
    const axiosOrigine = axios.get;
    const verrou = { tenu: true, perdu: false };
    const unite = { code: CODE, langue: 'id', tcgdexSet: CODE };
    const lancer = async (reponse, dossier, B = monde()) => {
        const apps = [];
        axios.get = async (url, opt) => { apps.push(url); const r = reponse(url, opt); if (opt?.validateStatus && !opt.validateStatus(r.status)) throw Object.assign(new Error('Request failed with status code ' + r.status), { response: r }); return r; };
        try { const r = await silencieux(() => T.collecterSet(unite, B.M, { verrou })).catch(e => ({ etat: 'plante-apres-telechargement', erreur: e.message })); return { r, apps, B }; }
        finally { axios.get = axiosOrigine; }
    };
    const rep = (status, type, data, h = {}) => ({ status, headers: { 'content-type': type, ...h }, data });
    const FAUSSE = Buffer.from('<html><body>Page introuvable</body></html>');
    const DOSSIER_DEFAUT = RH.DOSSIER_PAUSES;      // (ARRETS_HOTES_DOSSIER est lu à l'import du module : le collecteur écrit donc dans le dossier par défaut ; on le vide entre les cas)
    const vider = () => { for (const f of fs.existsSync(DOSSIER_DEFAUT) ? fs.readdirSync(DOSSIER_DEFAUT) : []) if (/^(ARRET|PAUSE)-HOTE-/.test(f)) fs.rmSync(path.join(DOSSIER_DEFAUT, f)); RH.reinitialiserSuiviProcessus(); };

    // (a) un 200 text/html sur la 2e image seulement : fichier absent, on passe aux suivantes
    vider();
    let { r, apps, B } = await lancer(url => (/\/002\/high\.png$/.test(url) ? rep(200, 'text/html', FAUSSE) : rep(200, 'image/png', png)), dp());
    verifier('M5 TCGDEX collecteur : un 200 text/html à la place d\'une image → on passe à la SUIVANTE (5 requêtes d\'image), échec noté pour cette carte, AUCUN arrêt ni pause',
        [apps.filter(u => /high\.png$/.test(u)).length, B.echecs.some(id => /\/002/.test(id)), r.etat === 'arret-hote', fs.existsSync(RH.fichierArret(DOSSIER_DEFAUT, 'tcgdex.net')), RH.suiviDuProcessus().rapport('tcgdex.net').fausses], [NB, true, false, false, 1]);

    // (b) un défi : arrêt DURABLE, état « arret-hote », l'unité suivante ne fait AUCUNE requête
    for (const [nom, reponse] of [['403', () => rep(403, 'text/html', Buffer.from('non'))], ['503 « Just a moment »', () => rep(503, 'text/html', Buffer.from('<title>Just a moment...</title>'))]]) {
        vider();
        ({ r, apps } = await lancer(reponse, dp()));
        const fichierArret = RH.hoteArrete('tcgdex.net', DOSSIER_DEFAUT);
        const suite = await lancer(() => rep(200, 'image/png', png), dp());
        verifier(`M5 TCGDEX collecteur : défi (${nom}) → « arret-hote » (attente + arrêt du worker), UNE seule requête d'image, arrêt DURABLE écrit ; l'unité suivante ne fait AUCUNE requête`,
            [r.etat, apps.filter(u => /high\.png$/.test(u)).length, !!fichierArret, suite.apps.length, issueDeLUnite(suite.r, {})], ['arret-hote', 1, true, 0, { etat: 'attente', arreter: true }]);
    }

    // (c) trop de fausses absences d'affilée → PAUSE de l'hôte ; l'unité suivante ne fait AUCUNE requête ; aucun arrêt durable
    vider();
    const S = RH.suiviDuProcessus();
    // le registre du processus a le seuil par défaut (20) ; le plan du banc n'a que 5 images : on amène le compteur à 19 avant l'unité (19 fausses absences notées par ailleurs), la 2e image de l'unité franchit donc le seuil
    for (let i = 0; i < 19; i++) S.noter('tcgdex.net', { issue: 'fausse-absente', empreinte: 'a'.repeat(64) });
    ({ r, apps } = await lancer(() => rep(200, 'text/html', FAUSSE), dp()));
    const suiteP = await lancer(() => rep(200, 'image/png', png), dp());
    verifier('M5 TCGDEX collecteur : la 21e fausse absence d\'affilée → PAUSE (« pause-hote », pauseHote nommé), 2 requêtes d\'image seulement, AUCUN arrêt durable ; l\'unité suivante ne fait AUCUNE requête',
        [r.etat, r.pauseHote?.hote, apps.filter(u => /high\.png$/.test(u)).length, RH.hoteArrete('tcgdex.net', DOSSIER_DEFAUT), suiteP.apps.length, suiteP.r.etat], ['pause-hote', 'tcgdex.net', 2, null, 0, 'pause-hote']);
    vider();

    // (d) CORRECTION 2 (I1) : une PAUSE du processus rencontrée AVANT tout téléchargement (le set n'est pas en cache : le client doit le lire) fait LEVER collecterSet ;
    // le worker en fait un bilan « pause-hote » → unité en ATTENTE, boucle arrêtée (et non « erreur » → « refuse » définitif). Zéro requête.
    vider();
    RH.suiviDuProcessus().bloquer('tcgdex.net', 'plus de 20 fausses pages introuvables d\'affilée');
    {
        const { bilanDeLException } = require('./collecte-cartes/issue-unite');
        const apps2 = []; axios.get = async url => { apps2.push(url); throw new Error('aucune requête attendue'); };
        let levee = null; try { await silencieux(() => T.collecterSet(unite, monde({ sansCache: true }).M, { verrou })); } catch (e) { levee = e; } finally { axios.get = axiosOrigine; }
        const bilan = levee ? bilanDeLException(CODE, levee) : null;
        verifier('I1 TCGDEX : une pause du processus avant le téléchargement → collecterSet LÈVE une pauseHote, ZÉRO requête ; le worker la range en « pause-hote » : attente + arrêt, jamais « refuse »',
            [!!levee?.pauseHote, apps2.length, bilan?.etat, bilan ? issueDeLUnite(bilan, {}) : null], [true, 0, 'pause-hote', { etat: 'attente', arreter: true }]);
        RH.reinitialiserSuiviProcessus();
        RH.arretHote('tcgdex.net', 'HTTP 403 (banc)', { dossier: DOSSIER_DEFAUT });
        levee = null; try { await silencieux(() => T.collecterSet(unite, monde({ sansCache: true }).M, { verrou })); } catch (e) { levee = e; }
        verifier('I1 TCGDEX : un arrêt durable avant le téléchargement → collecterSet LÈVE un `bloque`, le worker le range en « arret-hote » : attente + arrêt',
            [!!levee?.bloque, bilanDeLException(CODE, levee).etat, issueDeLUnite(bilanDeLException(CODE, levee), {})], [true, 'arret-hote', { etat: 'attente', arreter: true }]);
    }
    vider();

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.stack); process.exit(1); });

'use strict';
// Aide commune des bancs GALERIE. Une seule base de banc EN MÉMOIRE (mongodb-memory-server, jamais une grappe réelle), deux bases sur ce même mongod :
//   · `test_scratch` (préfixée, comme tous les bancs v2) pour l'identité (comptes, sessions) ;
//   · `rm_galerie_essai` pour la Communauté — le nom exact de la base dédiée, pour que le banc voie ce que la production verrait.
// Un faux R2 en mémoire (mêmes gardes de clé que le vrai : tout sous `galerie/`, DEUX buckets : privé pour depot/ et attente/, public pour pub/), un faux client S3 pour jouer le VRAI stockage, un faux Turnstile qui imite siteverify
// (hostname, action) sans aucune requête réseau, un serveur Express. Aucun appel réseau, aucun dossier du testeur, aucune ressource externe.
const H = require('./_harnais');
const path = require('path'), fs = require('fs'), Module = require('module');

const ENV_VALIDE = Object.freeze({
    MONGODB_URI: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/', MONGODB_CARTES_URI: 'mongodb+srv://u:p@cluster0.cartes1.mongodb.net/', MONGODB_ESSAI_URI: 'mongodb+srv://u:p@cluster0.essai11.mongodb.net/',
    V2_GALERIE: '1', MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/', V2_GALERIE_GRAPPE: 'dedie11.mongodb.net',
    V2_GALERIE_R2_COMPTE: 'abcdef0123456789abcdef0123456789', V2_GALERIE_R2_CLE_ID: 'cle-id-essai', V2_GALERIE_R2_SECRET: 'secret-essai-r2',
    V2_GALERIE_R2_BUCKET_PRIVE: 'rm-galerie-essai-prive', V2_GALERIE_R2_BUCKET_PUBLIC: 'rm-galerie-essai-public',
    V2_GALERIE_R2_URL_PUBLIQUE: 'https://pub.galerie-essai.test', V2_GALERIE_TURNSTILE_SECRET: 'secret-turnstile-essai', R2_BUCKET_IMAGES: 'rat-market-images'
});
const MARQUEURS = Object.freeze({ prive: 'galerie/marqueur-prive.json', public: 'galerie/pub/marqueur.json' });

function fauxStockage({ urlPublique = 'https://pub.galerie-essai.test', bucketPrive = 'rm-galerie-essai-prive', bucketPublic = 'rm-galerie-essai-public' } = {}) {
    const R2 = require('../galerie/r2');
    const objets = new Map(), dates = new Map(), journal = [];
    const pose = (cle, b) => { objets.set(cle, Buffer.from(b)); dates.set(cle, new Date()); };
    const s = {
        bucketPrive, bucketPublic, urlPublique, origineEcriture: 'https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com', objets, dates, journal, panneCopie: false, panneSuppression: false, marqueursPoses: true,
        presignerDepot({ cle, type, octets, expire }) { R2.exigerCle(cle); journal.push(['presigner-depot', cle, type, octets, expire]); return `${s.origineEcriture}/${bucketPrive}/${cle}?X-Amz-Expires=${expire}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&X-Amz-Signature=faux`; },
        presignerLecture({ cle, expire }) { R2.exigerCle(cle); return `${s.origineEcriture}/${bucketPrive}/${cle}?X-Amz-Expires=${expire}&X-Amz-Signature=faux`; },
        async tete(cle) { R2.exigerCle(cle); const o = objets.get(cle); return o ? { octets: o.length } : null; },
        async lire(cle, max) { R2.exigerCle(cle); const o = objets.get(cle); if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }); if (o.length > max) throw Object.assign(new Error('trop-lourd'), { code: 'TROP_LOURD' }); return Buffer.from(o); },
        async ecrire(cle, buffer, type) { R2.exigerCle(cle); journal.push(['ecrire', cle, type]); pose(cle, buffer); },
        async copier(de, vers) { R2.exigerCle(de); R2.exigerCle(vers); if (s.panneCopie) throw new Error('panne R2'); journal.push(['copier', de, vers]); pose(vers, objets.get(de)); },
        async supprimer(cle) { R2.exigerCle(cle); if (s.panneSuppression) throw new Error('panne R2'); journal.push(['supprimer', cle]); objets.delete(cle); dates.delete(cle); },
        async lister(prefixe, { apres = null, max = 1000 } = {}) {
            const cles = [...objets.keys()].filter(k => k.startsWith(prefixe) && (apres === null || k > apres)).sort();
            const page = cles.slice(0, max);
            return { objets: page.map(cle => ({ cle, modifie: dates.get(cle), octets: objets.get(cle).length })), suivant: cles.length > max ? page[page.length - 1] : null };
        },
        async verifierMarqueurs() { if (!s.marqueursPoses) throw new (require('../galerie/refus').RefusGalerie)('marqueur-r2-absent'); },
        /** Le client qui fait son PUT sur l'URL présignée : l'objet apparaît sous la clé de l'URL. */
        deposer(urlDepot, buffer) { const u = new URL(urlDepot); const cle = decodeURIComponent(u.pathname).replace(`/${bucketPrive}/`, ''); pose(cle, buffer); return cle; },
        /** Un objet posé directement (un orphelin, un art fabriqué), avec un âge. */
        poser(cle, buffer, ageMs = 0) { pose(cle, buffer); dates.set(cle, new Date(Date.now() - ageMs)); }
    };
    return s;
}
/** Un faux client S3 (commande par commande) pour jouer le VRAI stockage : deux buckets distincts, les objets sont rangés sous `<bucket>/<clé>`. */
function fauxClientS3() {
    const objets = new Map(), envoyees = [];
    const nonTrouve = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const c = {
        objets, envoyees, panne: null,
        async send(cmd) {
            const n = cmd.constructor.name, i = cmd.input, k = `${i.Bucket}/${i.Key}`;
            envoyees.push([n, i.Bucket, i.Key === undefined ? i.Prefix : i.Key]);
            if (c.panne && c.panne.test(n)) throw Object.assign(new Error('panne'), { name: 'InternalError' });
            if (n === 'PutObjectCommand') { objets.set(k, { corps: Buffer.from(i.Body), modifie: new Date() }); return {}; }
            if (n === 'HeadObjectCommand') { const o = objets.get(k); if (!o) throw nonTrouve(); return { ContentLength: o.corps.length }; }
            if (n === 'GetObjectCommand') { const o = objets.get(k); if (!o) throw nonTrouve(); return { Body: (async function* () { yield o.corps; })() }; }
            if (n === 'DeleteObjectCommand') { objets.delete(k); return {}; }
            if (n === 'CopyObjectCommand') { const o = objets.get(i.CopySource); if (!o) throw nonTrouve(); objets.set(k, { corps: o.corps, modifie: new Date() }); return {}; }
            if (n === 'ListObjectsV2Command') {
                const racine = `${i.Bucket}/`, tous = [...objets.keys()].filter(x => x.startsWith(racine + (i.Prefix || ''))).map(x => x.slice(racine.length)).filter(x => !i.StartAfter || x > i.StartAfter).sort();
                const page = tous.slice(0, i.MaxKeys || 1000);
                return { Contents: page.map(Key => ({ Key, LastModified: objets.get(racine + Key).modifie, Size: objets.get(racine + Key).corps.length })), IsTruncated: tous.length > page.length };
            }
            throw new Error(`commande non prévue : ${n}`);
        }
    };
    return c;
}
/** Un faux `fetch` qui répond comme siteverify : le jeton « jeton-valide » passe (hostname et action configurables), tout autre est refusé ; un secret différent de celui attendu est refusé. Aucun réseau. */
function fauxTurnstile({ secretAttendu = 'secret-turnstile-essai', panne = false, hostname = 'rat-market.fr', action = 'signalement' } = {}) {
    const f = async (url, init) => {
        f.appels.push({ url: String(url), methode: init && init.method, corps: String(init && init.body), redirect: init && init.redirect });
        if (panne) throw new Error('réseau coupé');
        const p = new URLSearchParams(String(init.body));
        const ok = p.get('response') === 'jeton-valide' || /^jeton-valide-/.test(p.get('response') || '');
        const dit = (surcharge, defaut) => { const v = surcharge === undefined ? defaut : surcharge; return v === null ? undefined : v; };      // null = champ ABSENT de la réponse
        return { ok: true, json: async () => ({ success: ok && p.get('secret') === secretAttendu, hostname: dit(f.hostname, hostname), action: dit(f.action, action) }) };
    };
    f.appels = [];
    return f;
}
/** Charge une COPIE MUTÉE d'un module de v2/galerie : le texte, un fragment remplacé, compilé en mémoire à la place du vrai (jamais le fichier). Le fragment doit exister (sinon le mutant ne mordrait sur rien). */
function charger(rel, remplacements) {
    const f = path.join(__dirname, '..', 'galerie', rel); let src = fs.readFileSync(f, 'utf8');
    for (const [a, b] of remplacements) { if (!src.includes(a)) throw new Error(`mutant : fragment absent de ${rel} : ${a}`); src = src.split(a).join(b); }
    const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(src, f); return m.exports;
}
/**
 * Un BANC COMPLET de la Communauté : base en mémoire (identité préfixée + base dédiée), configuration prête, serveur Express réel (CORS, assembleur), comptes fabriqués, appels HTTP.
 * `opts` : { stockage, turnstile, env, deps (ajoutés aux deps des routes : maintenant, memoTtlMs…), limites (surcharge de cfg.galerie.limites), envCfg (variables de plus pour lireGalerie) }.
 */
async function outillerBanc(nomScript, opts = {}) {
    const mongoose = require('mongoose'), express = require('express'), sharp = require('sharp');
    const db = require('../db'); const M = require('../modeles');
    const { lireConfig } = require('../config'); const { lireGalerie } = require('../galerie/config');
    await H.ouvrirBac(nomScript);
    await M.creerIndex(); H.fixerHorlogeMilieu();
    const G = require('../galerie/base'), F = require('../galerie/forme'), svc = require('../galerie/service'), routes = require('../galerie/routes');
    const pret = require('../pret'); const { assembler } = require('../index'); const transport = require('../transport/monter'); const sessions = require('../comptes/sessions');
    const dbG = mongoose.connection.client.db('rm_galerie_essai'); G.brancher(dbG); await G.creerIndex();
    const envCfg = { ...ENV_VALIDE, ...(opts.envCfg || {}) };
    const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), galerie: lireGalerie(envCfg) };
    const SITE = cfg.origines.site;
    const variante = (envExtra, limites) => { const g = lireGalerie({ ...envCfg, ...envExtra }); return { ...cfg, galerie: limites ? { ...g, limites: { ...g.limites, ...limites } } : g }; };
    const stockage = opts.stockage || fauxStockage(), turnstile = opts.turnstile || fauxTurnstile();
    const serveurs = [];
    async function serveur(cfgX = cfg, { routes: r = routes, st = stockage, ts = turnstile, env = envCfg, deps = {} } = {}) {
        const lot = { enTete() { }, routes(rt, c, d) { r.routesGalerie(rt, c, { ...d, stockage: st, fetchTurnstile: ts, env, memoTtlMs: 0, ...(opts.deps || {}), ...deps }); } };
        const app = express(); app.set('trust proxy', true);
        transport.enTete(app, cfgX); app.use(express.json()); pret.armer(M.verifierIndex);
        app.use(assembler([lot], cfgX, {}));
        const s = await H.serveur(app); serveurs.push(s); return s;
    }
    const sv = await serveur();
    let nC = 0, nIp = 0;
    const IP = () => { nIp++; return `10.66.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
    async function compte(o = {}, pseudo = null) {
        const adresse = `banc${++nC}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, o);
        await db.col('comptes').insertOne(c);
        const s = await sessions.creerSession(c._id);
        const r = { c, id: String(c._id), cookie: `rm_session=${s.token}`, pseudo };
        if (pseudo) await svc.poserPseudo(r.id, pseudo);
        return r;
    }
    const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': IP(), ...plus });
    const appel = (s, methode, chemin, { c, corps, plus, sansSite } = {}) => H.appel(s.url, chemin, { methode, corps, entetes: sansSite ? { ...(c ? { cookie: c.cookie } : {}), 'x-forwarded-for': IP(), ...plus } : siteH(c && c.cookie, plus) });
    const lire = (s, chemin, c) => H.appel(s.url, chemin, { entetes: { 'x-forwarded-for': IP(), origin: SITE, ...(c ? { cookie: c.cookie } : {}) } });
    const code = r => r.json && r.json.erreur && r.json.erreur.code, detail = r => r.json && r.json.erreur && r.json.erreur.detail;
    const brut = n => dbG.collection(n);
    const png = async (w, h, bg) => sharp({ create: { width: w, height: h, channels: 3, background: bg || { r: 20, g: 120, b: 220 } } }).png().toBuffer();
    /** Un art PUBLIC fabriqué directement (document + objets publics) : ce qu'une modération aurait accepté. */
    async function artPublic(auteur, o = {}) {
        const id = F.nouvelId();
        const doc = { _id: id, auteurId: auteur.id, pseudo: auteur.pseudo, nom: 'Art fabriqué', fmt: '1', largeur: 300, hauteur: 419, couleur: '#1478dc', poids: 1000, cle: `galerie/attente/${id}`, clePublique: `galerie/pub/${id}`,
            etat: 'public', recuLe: new Date(), publieLe: new Date(), nbJaime: 0, nbEnregistre: 0, motif: null, certification: { droits: true, nonOfficielle: true, le: new Date() }, depotId: null, ...o };
        doc.mots = svc.motsDe(doc.nom, doc.pseudo);
        await brut('arts').insertOne(doc);
        return id;
    }
    async function publier(auteur, o = {}) {
        const art = await artPublic(auteur);
        return svc.publierPourExploitation({ auteurId: auteur.id, titre: 'Page Michi', categories: ['methode-michi', 'couleur'], n: 3, pages: 2, arts: [{ art, col: 0, row: 0, fmt: '1' }],
            cartes: [{ cle: '1234|001', nom: 'Pikachu' }, null, { cle: '-5|12', nom: 'Dresseur' }], pagesSuite: [{ n: 2, arts: [], cartes: [{ cle: '1234|002', nom: 'Raichu' }] }],
            attributs: { couleur: ['jaune'], type: ['electrique'], illustrateur: ['Mitsuhiro Arita'], set: ['Base-Set'] }, certification: { cgu: '2026-10' }, etat: 'public', ...o });
    }
    async function deposer(s, c, { type = 'image/png', format = '1', w = 300, h = 419, nom = 'Mon art', buffer = null, st = stockage } = {}) {
        const b = buffer || await png(w, h);
        const o = await appel(s, 'POST', '/api/illustrations/depot', { c, corps: { type, octets: b.length } });
        if (o.statut !== 201) return { ouvert: o };
        st.deposer(o.json.urlDepot, b);
        const f = await appel(s, 'POST', `/api/illustrations/depot/${o.json.depotId}/finaliser`, { c, corps: { nom, format, certifieDroits: true, certifieNonOfficielle: true } });
        return { ouvert: o, fin: f, depotId: o.json.depotId, id: f.json && f.json.id };
    }
    return { H, mongoose, express, sharp, db, M, G, F, svc, routes, cfg, SITE, variante, stockage, turnstile, serveur, sv, serveurs, compte, siteH, appel, lire, code, detail, brut, dbG, png, artPublic, publier, deposer, IP, envCfg,
        async fermer() { for (const s of serveurs) await s.fermer(); await dbG.dropDatabase(); await H.fermerBac(); } };
}
module.exports = { ENV_VALIDE, MARQUEURS, fauxStockage, fauxClientS3, fauxTurnstile, charger, outillerBanc, H };

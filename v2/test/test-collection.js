'use strict';
// « Ma collection » — GET /api/collection, GET /api/collection/sets/:slug, PUT /api/collection/sets/:slug/fiches/:cle (lot COLLECTION).
// Base EN MÉMOIRE (INT2), aucun réseau. Chaque GARDE (session, Origin + X-Rat-Market, compte vérifié, forme, bornes, limiteur, isolement entre comptes) est éprouvée DEUX fois :
// sur le code réel (elle dit OUI au cas légitime et NON au cas hostile) et sur une COPIE MUTÉE en mémoire (le fragment de la garde est retiré du TEXTE du module, jamais du fichier) :
// la même scène doit alors donner un autre résultat — une garde qui ne sait pas dire non n'a pas été vérifiée, elle a été supposée.
const H = require('./_harnais');
const fs = require('fs'), path = require('path'), Module = require('module');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site, EXT = cfg.origines.extension;
const raw = n => mongoose.connection.db.collection(n);
const NOM = 'collection_fiches';
const R = path.join(__dirname, '..', '..');
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.66.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
const MDP = 'un-mot-de-passe-solide';
const attendre = ms => new Promise(r => setTimeout(r, ms));

// ── la COPIE MUTÉE : le texte du module, un fragment remplacé (toutes ses occurrences), compilé en mémoire à la place du vrai. Le fragment doit exister (sinon le banc échoue : le mutant ne mordrait sur rien).
function charger(rel, remplacements) {
    const f = path.join(__dirname, '..', 'collection', rel); let src = fs.readFileSync(f, 'utf8');
    for (const [a, b] of remplacements) { if (!src.includes(a)) throw new Error(`mutant : fragment absent de ${rel} : ${a}`); src = src.split(a).join(b); }
    const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(src, f); return m.exports;
}
const variante = o => ({ ...cfg, limites: { ...cfg.limites, ...(o.limites || {}) }, collection: { ...cfg.collection, ...(o.collection || {}) } });

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler, LOTS } = v2; const transport = require('../transport/monter');
    const svcReel = require('../collection/service'); const routesReel = require('../collection/routes');

    // ── comptes et en-têtes
    async function compte(o = {}) {
        const adresse = `coll${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, o);
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, adresse, token: s.token, cookie: `rm_session=${s.token}` };
    }
    const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': IP(), ...plus });
    const chemin = (slug, cle) => `/api/collection/sets/${encodeURIComponent(slug)}/fiches/${encodeURIComponent(cle)}`;
    const put = (sv, c, slug, cle, possedee, { entetes, corps } = {}) => H.appel(sv.url, chemin(slug, cle), { methode: 'PUT', corps: corps !== undefined ? corps : { possedee }, entetes: entetes || siteH(c && c.cookie) });
    const lireSet = (sv, c, slug) => H.appel(sv.url, `/api/collection/sets/${encodeURIComponent(slug)}`, { entetes: siteH(c && c.cookie) });
    const lireSets = (sv, c) => H.appel(sv.url, '/api/collection', { entetes: siteH(c && c.cookie) });
    const nDocs = () => raw(NOM).countDocuments({});
    // INJECTION : la base enveloppée (`collection(nom)` renvoie une surcharge du nom visé), ou rétablie avec null. Sert aux pannes simulées et aux journaux d'ordre, sans toucher au code de production.
    const dbReelle = mongoose.connection.db;
    const dbInjecte = surcharges => {
        if (!surcharges) return db.brancher(dbReelle);
        const faux = Object.create(dbReelle); faux.collection = (n, o) => { const c = dbReelle.collection(n, o); return surcharges[n] ? surcharges[n](c) : c; };
        return db.brancher(faux);
    };
    // les PLACES réellement occupées : les clés + (documents × forfait), comptées par deux requêtes indépendantes de la formule du service
    const placesReelles = async c => { const r = await raw(NOM).aggregate([{ $group: { _id: null, n: { $sum: { $size: '$cles' } } } }]).toArray(); return (r.length ? r[0].n : 0) + (await nDocs()) * c.collection.forfaitDocument; };
    const docs = c => raw(NOM).find({ compteId: c.c._id }).toArray();
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const detail = r => r.json && r.json.erreur && r.json.erreur.detail;

    // ── un serveur : le transport (CORS), le lot (réel ou muté), le gestionnaire d'erreurs final (copie du banc d'abus)
    const gestionnaireFinal = (err, req, res, next) => {
        if (res.headersSent) return next(err);
        const statut = Number.isInteger(err?.status) ? err.status : (Number.isInteger(err?.statusCode) ? err.statusCode : 500);
        if (statut >= 400 && statut < 500) return res.status(statut).json({ success: false, error: 'Requête illisible' });
        return res.status(500).json({ success: false, error: 'Erreur serveur interne' });
    };
    const serveurs = [];
    async function serveur(cfgX = cfg, routes = routesReel) {
        const lot = { enTete() { }, routes(r, c, d) { routes.routesCollection(r, c, d); } };
        const app = express(); app.set('trust proxy', true);
        transport.enTete(app, cfgX); app.use(express.json());
        pret.armer(M.verifierIndex);
        app.use(assembler([lot], cfgX, {})); app.use(gestionnaireFinal);
        const s = await H.serveur(app); serveurs.push(s); return s;
    }
    const sv = await serveur();

    // ═══════════════ 1. LE CHEMIN NOMINAL ═══════════════
    {
        const A = await compte();
        const vide = await lireSets(sv, A);
        H.v('1. GET /api/collection d\'un compte sans rien de coché : 200, sets []', [vide.statut, vide.json], [200, { success: true, sets: [] }]);
        H.v('   Cache-Control: no-store (données privées)', vide.entetes['cache-control'], 'no-store');
        const set0 = await lireSet(sv, A, 'Set-Essai');
        H.v('   GET d\'un set jamais touché : 200, possedees [], cotes {}, majLe null', [set0.statut, set0.json], [200, { success: true, set: 'Set-Essai', possedees: [], cotes: {}, majLe: null }]);
        const p1 = await put(sv, A, 'Set-Essai', '895789|001', true);
        H.v('   PUT true : 200, possedees 1', [p1.statut, p1.json], [200, { success: true, possedees: 1 }]);
        const d1 = (await docs(A))[0]; await attendre(15);
        const p1b = await put(sv, A, 'Set-Essai', '895789|001', true);
        const d1b = (await docs(A))[0];
        H.v('   PUT true une seconde fois : idempotent (1), majLe INCHANGÉ (rien n\'a changé)', [p1b.json.possedees, d1b.majLe.getTime() === d1.majLe.getTime()], [1, true]);
        await attendre(15);
        const p2 = await put(sv, A, 'Set-Essai', '895790|-', true);
        const d2 = (await docs(A))[0];
        H.v('   une seconde fiche : 2, majLe avancé', [p2.json.possedees, d2.majLe.getTime() > d1.majLe.getTime()], [2, true]);
        const g = await lireSet(sv, A, 'Set-Essai');
        H.v('   GET du set : les deux clés (triées), cotes {}, majLe ISO', [g.json.possedees, g.json.cotes, g.json.majLe === d2.majLe.toISOString()], [['895789|001', '895790|-'], {}, true]);
        // COTES-VISUELS : avec une version chargée (lien fiche → produits EN MÉMOIRE) et le guide de l'API, la route rend la cote de chaque fiche du set — la règle du contrat §1.8
        {
            const VB = require('./_visuels-banc');
            await raw('guide_prix').insertMany([{ idProduct: 1, trend: 4.5, guideDu: '2026-10-01' }, { idProduct: 2, trend: 2, guideDu: '2026-10-01' }, { idProduct: 3, trend: 3, guideDu: '2026-10-01' }]);
            VB.installer([VB.doc(1), VB.doc(2), VB.doc(3)], [['Set-Essai', '895789|001', [1]], ['Set-Essai', '895790|-', [2, 3]], ['Autre-Set', '7|001', [1]]]);
            const gc = await lireSet(sv, A, 'Set-Essai');
            H.v('   avec un lien chargé : cotes = la cote de la fiche à UN produit, null pour la fiche dont les deux produits ne s\'accordent pas (jamais une moyenne)', gc.json.cotes, { '895789|001': { tendance: 4.5, date: '2026-10-01' }, '895790|-': null });
            H.v('   un set sans lien : cotes {} ; la réponse garde sa forme', [(await lireSet(sv, A, 'Set-Sans-Lien')).json.cotes, Object.keys(gc.json)], [{}, ['success', 'set', 'possedees', 'cotes', 'majLe']]);
            // la requête du guide passe par l'INDEX unique idProduct (celui du schéma d'import-price-guide.js) : le plan le montre sur le même $in et la même projection que la route
            await raw('guide_prix').createIndex({ idProduct: 1 }, { unique: true });
            const plan = JSON.stringify(await raw('guide_prix').find({ idProduct: { $in: [1, 2, 3] } }, { projection: { _id: 0, idProduct: 1, trend: 1, guideDu: 1 }, maxTimeMS: 2000 }).explain());
            H.vrai('   la requête du guide utilise l\'index idProduct (IXSCAN, pas COLLSCAN)', plan.includes('IXSCAN') && !plan.includes('COLLSCAN'));
            // R2 : une panne du guide (ici : le lien lève) dégrade `cotes` en {} sans faire tomber la lecture du set — possedees et majLe sont servis
            const casse = Object.freeze({ comptes: Object.freeze({}), fichesDuSet() { throw new Error('guide en panne'); }, produitsDeMetacarte: () => [], entree: () => null });
            require('../chargeur/etat').installer(casse);
            const gp = await lireSet(sv, A, 'Set-Essai');
            H.v('   le guide / le lien en panne : 200, cotes {}, possedees et majLe INTACTS (la route ne meurt pas)', [gp.statut, gp.json.cotes, gp.json.possedees.length, typeof gp.json.majLe], [200, {}, 2, 'string']);
            VB.vider();
            H.v('   aucune version chargée : cotes {} (l\'état « sans visuel »)', (await lireSet(sv, A, 'Set-Essai')).json.cotes, {});
            await raw('guide_prix').deleteMany({});
        }
        await put(sv, A, 'Autre-Set', '12|SWSH155 (Top Left)', true);
        const l = await lireSets(sv, A);
        H.v('   GET /api/collection : seulement les sets cochés, triés par slug, { slug, possedees, majLe }', l.json.sets.map(s => [s.slug, s.possedees, typeof s.majLe === 'string' && !Number.isNaN(Date.parse(s.majLe))]), [['Autre-Set', 1, true], ['Set-Essai', 2, true]]);
        const dd = (await docs(A)).find(d => d.set === 'Set-Essai'); await attendre(15);
        const f1 = await put(sv, A, 'Set-Essai', '895789|001', false);
        const dd1 = (await docs(A)).find(d => d.set === 'Set-Essai');
        H.v('   PUT false : 1, majLe avancé', [f1.json.possedees, dd1.majLe.getTime() > dd.majLe.getTime()], [1, true]);
        await attendre(15);
        const f1b = await put(sv, A, 'Set-Essai', '895789|001', false);
        const dd1b = (await docs(A)).find(d => d.set === 'Set-Essai');
        H.v('   PUT false une seconde fois : idempotent (1), majLe INCHANGÉ', [f1b.json.possedees, dd1b.majLe.getTime() === dd1.majLe.getTime()], [1, true]);
        const f0 = await put(sv, A, 'Set-Essai', '895790|-', false);
        H.v('   PUT false de la dernière clé : 0, et le document est SUPPRIMÉ', [f0.json.possedees, (await docs(A)).filter(d => d.set === 'Set-Essai').length], [0, 0]);
        const f00 = await put(sv, A, 'Set-Jamais', '5|1', false);
        H.v('   PUT false sur un set jamais touché : 200, 0, aucun document créé', [f00.statut, f00.json.possedees, (await docs(A)).filter(d => d.set === 'Set-Jamais').length], [200, 0, 0]);
        const l2 = await lireSets(sv, A);
        H.v('   le set vidé n\'est plus listé', l2.json.sets.map(s => s.slug), ['Autre-Set']);
        const tout = JSON.stringify(await raw(NOM).find({}).toArray());
        H.v('   le document stocké ne porte que _id, compteId, set, cles, majLe', Object.keys((await docs(A))[0]).sort(), ['_id', 'cles', 'compteId', 'majLe', 'set']);
        H.vrai('   la collection ne contient ni l\'adresse, ni l\'IP, ni le jeton de session d\'un compte', !tout.includes(A.adresse) && !tout.includes('10.66.') && !tout.includes(A.token));
        // isolement par HTTP : un autre compte ne voit rien et sa écriture ne touche pas la collection du premier
        const B = await compte(); const avant = JSON.stringify(await docs(A));
        const gb = await lireSet(sv, B, 'Autre-Set'), pb = await put(sv, B, 'Autre-Set', '12|SWSH155 (Top Left)', false);
        H.v('   un AUTRE compte : ne voit pas la clé (possedees []), la « décoche » sans rien changer chez le premier', [gb.json.possedees, pb.json.possedees, JSON.stringify(await docs(A)) === avant], [[], 0, true]);
    }

    // ═══════════════ 2. LE SLUG AVEC « / » (codes S-P/ID) ═══════════════
    {
        const A = await compte();
        const r = await H.appel(sv.url, '/api/collection/sets/S-P%2FID/fiches/77%7C001', { methode: 'PUT', corps: { possedee: true }, entetes: siteH(A.cookie) });
        const d = await docs(A);
        H.v('2. PUT sur /sets/S-P%2FID/fiches/77%7C001 : 200, le paramètre arrive ENTIER (« S-P/ID », « 77|001 »)', [r.statut, d.map(x => [x.set, x.cles])], [200, [['S-P/ID', ['77|001']]]]);
        const g = await H.appel(sv.url, '/api/collection/sets/S-P%2FID', { entetes: siteH(A.cookie) });
        H.v('   GET /sets/S-P%2FID : le set « S-P/ID » et sa clé', [g.json.set, g.json.possedees], ['S-P/ID', ['77|001']]);
        const nu = await H.appel(sv.url, '/api/collection/sets/S-P/ID', { entetes: siteH(A.cookie) });
        H.v('   le « / » NON encodé n\'est pas un slug : 404 (aucune route), rien de lu', nu.statut, 404);
        const dbl = await H.appel(sv.url, '/api/collection/sets/S-P%252FID', { entetes: siteH(A.cookie) });
        H.v('   un « %2F » encodé deux fois reste littéral (« % » refusé) : 400 ENTREE slug', [dbl.statut, code(dbl), detail(dbl)], [400, 'ENTREE', 'slug']);
        const mal = await H.appel(sv.url, '/api/collection/sets/%E0%A4%A', { entetes: siteH(A.cookie) });
        H.vrai('   un pourcentage illisible : 400, jamais 5xx', mal.statut === 400);
    }

    // ═══════════════ 3. LES GARDES, UNE PAR UNE ═══════════════
    const MUT_SESSION = [['routes.js', [['const ECRITURE = [resoudrePorteur(cfg), exigerSession, ', 'const ECRITURE = [resoudrePorteur(cfg), '], ['const LECTURE = [resoudrePorteur(cfg), exigerSession]', 'const LECTURE = [resoudrePorteur(cfg)]']]]];
    const GARDES = [
        { nom: 'session : sans cookie, 401 SESSION et rien d\'écrit (lecture comprise)', mut: MUT_SESSION, attendu: [401, 'SESSION', 401, 'SESSION', 401, 'SESSION', 0],
            async scene({ sv }) {
                const n0 = await nDocs();
                const w = await put(sv, null, 'Set-A', '1|001', true, { entetes: siteH(null) });
                const r1 = await lireSets(sv, null), r2 = await lireSet(sv, null, 'Set-A');
                return [w.statut, code(w), r1.statut, code(r1), r2.statut, code(r2), (await nDocs()) - n0];
            } },
        { nom: 'session : un jeton d\'installation (Bearer) n\'ouvre pas la collection', mut: MUT_SESSION, attendu: [401, 'SESSION', 401, 'SESSION', 0],
            async scene({ sv }) {
                const A = await compte(); const jeton = J.genererJeton();
                await raw('installations').insertOne(Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'ext' }), { compteId: A.c._id, lieeLe: new Date() }));
                const h = { origin: SITE, 'x-rat-market': '1', authorization: `Bearer ${jeton}`, 'x-forwarded-for': IP() };
                const n0 = await nDocs();
                const w = await put(sv, null, 'Set-A', '1|001', true, { entetes: h }); const r = await H.appel(sv.url, '/api/collection', { entetes: h });
                return [w.statut, code(w), r.statut, code(r), (await nDocs()) - n0];
            } },
        { nom: 'Origin + X-Rat-Market : sans l\'un ou l\'autre, ou d\'une autre origine, 403 ORIGINE et rien d\'écrit', mut: [['routes.js', [['S.exigerOrigineSite(cfg), exigerVerifie', 'exigerVerifie']]]],
            attendu: [[403, 'ORIGINE', 403, 'ORIGINE', 403, 'ORIGINE', 403, 'ORIGINE', 403, 'ORIGINE', 403, 'ORIGINE'], 0],
            async scene({ sv }) {
                const A = await compte(); const n0 = await nDocs(); const vus = [];
                for (const h of [{ cookie: A.cookie }, { cookie: A.cookie, origin: SITE }, { cookie: A.cookie, 'x-rat-market': '1' }, { cookie: A.cookie, origin: EXT, 'x-rat-market': '1' },
                    { cookie: A.cookie, origin: 'https://evil.example', 'x-rat-market': '1' }, { cookie: A.cookie, origin: SITE, 'x-rat-market': '0' }]) {
                    const r = await put(sv, A, 'Set-A', '1|001', true, { entetes: { ...h, 'x-forwarded-for': IP() } }); vus.push(r.statut, code(r));
                }
                return [vus, (await nDocs()) - n0];
            } },
        // O3 : un compte non confirmé n'est plus un porteur (porteur.js) — sa session ne passe même plus la garde de session : 401 SESSION en écriture ET en lecture. La garde `exigerVerifie` de routes.js
        // reste en profondeur derrière ; elle n'est plus atteignable par une requête, donc sa copie mutée ne changerait rien (`mut` vide, dit ici). La preuve du refus est test-comptes-o3.js (3a, 4a).
        { nom: 'compte vérifié (O3) : un compte non vérifié n\'est plus un porteur — 401 SESSION en écriture ET en lecture, rien d\'écrit', mut: [],
            attendu: [401, 'SESSION', null, 401, 0],
            async scene({ sv }) {
                const A = await compte({ verifie: false }); const n0 = await nDocs();
                const w = await put(sv, A, 'Set-A', '1|001', true); const r = await lireSets(sv, A);
                return [w.statut, code(w), w.json && w.json.facturation, r.statut, (await nDocs()) - n0];
            } },
        { nom: 'forme de la clé : 400 ENTREE (« cle ») pour tout ce que la forme n\'autorise pas, rien d\'écrit', mut: [['routes.js', [['!F.cleValide(req.params.cle)', 'false']]]],
            attendu: [['400 ENTREE cle'], 0],
            async scene({ sv }) {
                const A = await compte(); const n0 = await nDocs(); const vus = [];
                for (const cle of ['abc', '0|1', '01|1', '1|', '1|a|b', '1|<script>', '1|é', '-3|1', `1|${'x'.repeat(40)}`]) { const r = await put(sv, A, 'Set-A', cle, true); vus.push([r.statut, code(r), detail(r)].join(' ')); }
                return [[...new Set(vus)], (await nDocs()) - n0];
            } },
        { nom: 'forme du slug : 400 ENTREE (« slug »), à l\'écriture comme à la lecture, rien d\'écrit', mut: [['routes.js', [['!F.slugValide(req.params.slug)', 'false']]]],
            attendu: [['400 ENTREE slug 400 ENTREE slug'], 0],
            async scene({ sv }) {
                const A = await compte(); const n0 = await nDocs(); const vus = [];
                for (const slug of ['a b', 'a.b', '<x>', 'é', 'a'.repeat(81), '-a', 'a//b', 'a%25b']) {
                    const w = await put(sv, A, slug, '1|001', true); const r = await lireSet(sv, A, slug);
                    vus.push([w.statut, code(w), detail(w), r.statut, code(r), detail(r)].join(' '));
                }
                return [[...new Set(vus)], (await nDocs()) - n0];
            } },
        { nom: 'forme du corps : seul { possedee: booléen } passe, 400 ENTREE (« possedee »), rien d\'écrit', mut: [['routes.js', [['!corpsValide(req.body)', 'false']]]],
            attendu: [['400 ENTREE possedee'], 0],
            async scene({ sv }) {
                const A = await compte(); const n0 = await nDocs(); const vus = [];
                for (const corps of [{}, { possedee: 'true' }, { possedee: 1 }, { possedee: null }, { possedee: true, autre: 1 }, [true]]) { const r = await put(sv, A, 'Set-A', '1|001', true, { corps }); vus.push([r.statut, code(r), detail(r)].join(' ')); }
                return [[...new Set(vus)], (await nDocs()) - n0];
            } },
        { nom: 'limiteur : au-delà de 3 écritures par heure (réglé à 3), 429 DEBIT avec Retry-After, par compte ; la lecture n\'est pas limitée', cfg: variante({ limites: { collectionEcrituresParCompteHeure: 3 } }),
            mut: [['routes.js', [['exigerVerifie, parCompte]', 'exigerVerifie]']]]], attendu: [[200, 200, 200, 429], 'DEBIT', true, 200, 200, 3],
            async scene({ sv }) {
                const A = await compte(), B = await compte(); const vus = [];
                for (let i = 1; i <= 4; i++) vus.push((await put(sv, A, 'Set-A', `${i}|001`, true)).statut);
                const r5 = await put(sv, A, 'Set-A', '9|001', true);
                const b = await put(sv, B, 'Set-A', '1|001', true); const lec = await lireSets(sv, A);
                return [vus, code(r5), r5.entetes['retry-after'] !== undefined && Number(r5.entetes['retry-after']) >= 1 && r5.json.erreur.reessayerDans === Number(r5.entetes['retry-after']), b.statut, lec.statut, (await docs(A))[0].cles.length];
            } },
        { nom: 'isolement : la clé d\'un AUTRE compte est invisible et ne se modifie pas (lecture du set, liste, décochage, cochage)', mut: [['service.js', [['compteId, set: slug', 'set: slug']]]],
            attendu: [[], 0, 0, 1, true, ['12|003']],
            async scene({ svc, cfg }) {
                const A = await compte(), B = await compte();
                await svc.cocher({ compteId: A.c._id, slug: 'Set-Iso', cle: '10|001', possedee: true, cfg }); await svc.cocher({ compteId: A.c._id, slug: 'Set-Iso', cle: '11|002', possedee: true, cfg });
                const avant = JSON.stringify((await docs(A))[0]);
                const lb = await svc.lireSet(B.c._id, 'Set-Iso'), lsb = await svc.lireSets(B.c._id);
                const fb = await svc.cocher({ compteId: B.c._id, slug: 'Set-Iso', cle: '10|001', possedee: false, cfg });   // B « décoche » la clé de A
                const tb = await svc.cocher({ compteId: B.c._id, slug: 'Set-Iso', cle: '12|003', possedee: true, cfg });    // B coche la sienne
                return [lb.cles, lsb.length, fb.possedees, tb.possedees, JSON.stringify((await docs(A))[0]) === avant, (await docs(B))[0].cles];
            } },
        { nom: 'borne par set ATOMIQUE : 12 écritures simultanées vers un set limité à 3 clés en gardent exactement 3, les 9 autres sont refusées « borne-set »', cfg: variante({ collection: { clesParSet: 3 } }),
            mut: [['service.js', [['...SOUS_LA_BORNE(cfg), ', '']]]], attendu: [3, 9, ['borne-set']],
            async scene({ svc, cfg }) {
                const A = await compte();
                const r = await Promise.all(Array.from({ length: 12 }, (_, i) => svc.cocher({ compteId: A.c._id, slug: 'Set-Plein', cle: `${i + 1}|001`, possedee: true, cfg })));
                const d = await docs(A);
                return [d.reduce((n, x) => n + x.cles.length, 0), r.filter(x => x.refus).length, [...new Set(r.filter(x => x.refus).map(x => x.refus))]];
            } },
        { nom: 'borne par compte : à 5 clés au total (3 + 2), une clé de plus dans un 3e set est refusée « borne-compte » ; une clé déjà posée reste idempotente, un décochage libère', cfg: variante({ collection: { clesParSet: 3, clesParCompte: 5, setsParCompte: 10 } }),
            mut: [['service.js', [['if (total >= cfg.collection.clesParCompte)', 'if (false)']]]], attendu: [['borne-compte', 5], 5, 4, 5],
            async scene({ svc, cfg }) {
                const A = await compte(); const id = A.c._id; const c = (slug, cle, possedee = true) => svc.cocher({ compteId: id, slug, cle, possedee, cfg });
                for (const k of ['1|1', '2|1', '3|1']) await c('S1', k); for (const k of ['4|1', '5|1']) await c('S2', k);
                const r = await c('S3', '6|1');
                const total = async () => (await docs(A)).reduce((n, x) => n + x.cles.length, 0);
                const t1 = await total();
                const idem = await c('S2', '5|1');     // déjà posée : aucun refus, même au plafond
                await c('S2', '5|1', false);
                const apres = await total();
                const re = await c('S3', '6|1');
                return [[r.refus, r.borne], t1, apres, re.refus ? -1 : await total()];
            } },
        { nom: 'borne de sets par compte : au plus 2 sets (réglé à 2), un 3e est refusé « borne-sets » ; un set existant reste ouvert, en vider un en libère la place', cfg: variante({ collection: { setsParCompte: 2 } }),
            mut: [['service.js', [['if (nSets >= cfg.collection.setsParCompte)', 'if (false)']]]], attendu: [['borne-sets', 2], 2, 2, true],
            async scene({ svc, cfg }) {
                const A = await compte(); const id = A.c._id; const c = (slug, cle, possedee = true) => svc.cocher({ compteId: id, slug, cle, possedee, cfg });
                await c('S1', '1|1'); await c('S2', '2|1');
                const r = await c('S3', '3|1');
                const dans = await c('S1', '4|1');
                const nSets = (await docs(A)).length;
                await c('S2', '2|1', false);
                const libre = await c('S3', '3|1');
                return [[r.refus, r.borne], nSets, dans.possedees, !libre.refus];
            } },
        // ── I-2 : la garde de course du `deleteOne` d'un document vide. PUT false de la dernière clé EN MÊME TEMPS qu'un PUT true d'une autre clé du même set : aucune clé perdue.
        { nom: 'course : retirer la dernière clé d\'un set pendant qu\'une autre y est posée (60 itérations) ne perd aucune clé', mut: [['service.js', [[', cles: { $size: 0 } }', ' }']]]], attendu: [0],
            async scene({ svc, cfg }) {
                const A = await compte(), id = A.c._id; let perdues = 0;
                for (let i = 0; i < 60; i++) {
                    const slug = `S-Course-${i}`; const a = (cle, possedee) => svc.cocher({ compteId: id, slug, cle, possedee, cfg });
                    await a('1|1', true);
                    const ops = [() => a('1|1', false), () => a('2|1', true)]; if (i % 2) ops.reverse();
                    await Promise.all(ops.map(f => f()));
                    const d = await raw(NOM).findOne({ compteId: id, set: slug });
                    if (!d || !d.cles.includes('2|1')) perdues++;
                }
                return [perdues];
            } },
        // ── M-1 : deux PUT true simultanés de la MÊME clé ne comptent qu'une fois (set neuf : l'upsert ; set existant : la mise à jour). Le compteur global le montre.
        { nom: 'même clé posée deux fois en même temps (set neuf puis set existant, 30 itérations) : le compteur global ne bouge que de 1 à chaque fois', attendu: [0, 0],
            mut: [['service.js', [['{ compteId, set: slug, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }', '{ compteId, set: slug, ...SOUS_LA_BORNE(cfg) }']]], ['service.js', [['if (!r.ajoute) await rendre(cout);', '']]]],
            async scene({ svc, cfg }) {
                const A = await compte(), id = A.c._id; const n = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n;
                await svc.recompter(cfg); let mauvaisNeuf = 0, mauvaisExistant = 0; const F = cfg.collection.forfaitDocument;
                for (let i = 0; i < 30; i++) {
                    const slug = `S-Meme-${i}`;
                    const a = (cle, k) => svc.cocher({ compteId: id, slug, cle, possedee: true, cfg, maintenant: new Date(Date.now() + k) });
                    let n0 = await n(); await Promise.all([a('1|1', 1), a('1|1', 2)]);
                    if ((await n()) - n0 !== 1 + F) mauvaisNeuf++;      // une clé + le forfait du document neuf, UNE fois
                    n0 = await n(); await Promise.all([a('2|1', 3), a('2|1', 4)]);
                    if ((await n()) - n0 !== 1) mauvaisExistant++;
                }
                return [mauvaisNeuf, mauvaisExistant];
            } },
        // ── I-1 : le plafond GLOBAL (clés de tous les comptes), un compteur unique `$inc` conditionnel avant l'écriture
        { nom: 'plafond global ATOMIQUE : 20 écritures simultanées dans des sets existants avec 5 places libres au service en gardent exactement 5, les 15 autres sont refusées « borne-service », compteur = places réelles',
            mut: [['service.js', [['n: { $lte: cfg.collection.clesService - cout }', 'n: { $gte: 0 }']]]], attendu: [5, 15, ['borne-service'], 5],
            async scene({ svc, cfg }) {
                const A = await compte(), B = await compte();
                for (const [c, s] of [[A, 'S-Svc-1'], [B, 'S-Svc-0']]) await svc.cocher({ compteId: c.c._id, slug: s, cle: '999|1', possedee: true, cfg });
                const base = await svc.recompter(cfg); const cfgX = variante({ collection: { clesService: base + 5 } });
                const r = await Promise.all(Array.from({ length: 20 }, (_, i) => svc.cocher({ compteId: (i % 2 ? A : B).c._id, slug: `S-Svc-${i % 2}`, cle: `${i + 1}|1`, possedee: true, cfg: cfgX })));
                const refus = r.filter(x => x.refus);
                return [await placesReelles(cfg) - base, refus.length, [...new Set(refus.map(x => x.refus))], (await raw('compteurs').findOne({ cle: 'collection-cles' })).n - base];
            } },
        // ── plafond en PLACES : un set neuf coûte 1 clé + le forfait du document, réservés d'un seul `$inc` conditionnel ; rendu à la suppression du document vide
        { nom: 'places : un set neuf consomme 1 + le forfait, une clé de plus 1 ; le dernier retrait supprime le document et RENDRE son forfait',
            mut: [['service.js', [['await rendre(cfg.collection.forfaitDocument); // forfait rendu', '']]]], attendu: [5, 6, 5, 0, 0],
            async scene({ svc, cfg }) {
                const base = await svc.recompter(cfg); const F = cfg.collection.forfaitDocument;
                const A = await compte(), id = A.c._id; const c = (cle, possedee) => svc.cocher({ compteId: id, slug: 'S-Forfait', cle, possedee, cfg });
                const cpt = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n - base;
                await c('1|1', true); const n1 = await cpt(); await c('2|1', true); const n2 = await cpt();
                await c('2|1', false); const n3 = await cpt(); await c('1|1', false); const n4 = await cpt();
                return [n1 === 1 + F ? 5 : n1, n2 === 2 + F ? 6 : n2, n3 === 1 + F ? 5 : n3, n4, (await docs(A)).length];
            } },
        { nom: 'places : 12 écritures simultanées dans 12 sets NEUFS avec la place de 3 documents en gardent exactement 3 ; le compteur ne dépasse jamais le plafond',
            mut: [['service.js', [['const cout = 1 + (doc ? 0 : cfg.collection.forfaitDocument);', 'const cout = 1;']]]], attendu: [3, 9, 3 * 5, true],
            async scene({ svc, cfg }) {
                const base = await svc.recompter(cfg); const F = cfg.collection.forfaitDocument; const plafond = base + 3 * (1 + F); const cfgX = variante({ collection: { clesService: plafond } });
                const A = await compte();
                const r = await Promise.all(Array.from({ length: 12 }, (_, i) => svc.cocher({ compteId: A.c._id, slug: `S-Neuf-${i}`, cle: '1|1', possedee: true, cfg: cfgX })));
                const n = (await raw('compteurs').findOne({ cle: 'collection-cles' })).n;
                return [r.filter(x => !x.refus).length, r.filter(x => x.refus === 'borne-service').length, n - base === 3 * (1 + F) ? 15 : n - base, n <= plafond];
            } },
        { nom: 'places : deux clés DIFFÉRENTES posées en même temps dans un set neuf ne paient le forfait qu\'UNE fois (le perdant de la création le rend), 30 itérations',
            mut: [['service.js', [['else if (cout > 1 && !r.cree) await rendre(cout - 1);', '']]]], attendu: [0],
            async scene({ svc, cfg }) {
                const A = await compte(), id = A.c._id; const F = cfg.collection.forfaitDocument; await svc.recompter(cfg); let mauvais = 0;
                const n = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n;
                for (let i = 0; i < 30; i++) {
                    const n0 = await n(); await Promise.all(['1|1', '2|1'].map(cle => svc.cocher({ compteId: id, slug: `S-Deux-${i}`, cle, possedee: true, cfg })));
                    if ((await n()) - n0 !== 2 + F) mauvais++;
                }
                return [mauvais];
            } },
        { nom: 'plafond global : au plafond, une clé déjà posée ne consomme rien, une nouvelle est refusée sans rien écrire ; un retrait libère UNE place, une seule fois',
            mut: [['service.js', [['await rendre(1); // retrait', '']]]], attendu: [[3, 3], 'borne-service', [3, 3, 3], [2, 2], 1, 'borne-service'],
            async scene({ svc, cfg }) {
                const A = await compte(), id = A.c._id; await svc.recompter(cfg);
                await svc.cocher({ compteId: id, slug: 'S-Plein', cle: '1|1', possedee: true, cfg });            // le document existe désormais : seules les clés suivantes se paient
                const base = (await svc.recompter(cfg)) - 1; const cfgX = variante({ collection: { clesService: base + 3 } });   // base = tout sauf la clé 1|1 (forfait du document compris)
                const c = (cle, possedee = true) => svc.cocher({ compteId: id, slug: 'S-Plein', cle, possedee, cfg: cfgX });
                const cpt = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n - base;
                const cles = async () => (await docs(A))[0].cles.length;
                for (const k of ['2|1', '3|1']) await c(k);
                const plein = [await cpt(), await cles()];
                const refus = (await c('4|1')).refus;
                const idem = await c('1|1');
                const apresRefus = [await cpt(), await cles(), idem.possedees];
                await c('1|1', false); await c('1|1', false);          // deux retraits de la même clé : une seule place libérée
                const libre = [await cpt(), await cles()];
                const neuve = await c('4|1'); const encore = await c('5|1');
                return [plein, refus, apresRefus, libre, neuve.possedees === 3 ? 1 : 0, encore.refus];
            } },
        { nom: 'places : supprimer un compte rend ses clés ET les forfaits de tous ses documents (3 clés dans 2 sets : 3 + 2 × 7 = 17 places)', mut: [['service.js', [['rendu += d.cles.length + cfg.collection.forfaitDocument;', 'rendu += d.cles.length;']]]], attendu: [17, 0, 0],
            async scene({ svc, cfg }) {
                const base = await svc.recompter(cfg); const A = await compte(), id = A.c._id;
                for (const [s, k] of [['S1', '1|1'], ['S1', '2|1'], ['S2', '3|1']]) await svc.cocher({ compteId: id, slug: s, cle: k, possedee: true, cfg });
                const cpt = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n - base;
                const avant = await cpt(); await svc.supprimerDuCompte(id, cfg);
                return [avant, await cpt(), (await docs(A)).length];
            } },
        // ── M-A : la suppression d'un compte rend ce que CHAQUE document supprimé contenait RÉELLEMENT au moment de sa suppression (jamais une lecture d'avant) : le compteur ne passe jamais sous le réel
        { nom: 'suppression de compte : rend les clés réellement présentes (une clé retirée avant ne compte pas deux fois), et des retraits concurrents ne font jamais passer le compteur sous le réel (40 itérations)',
            mut: [['service.js', [['rendu += d.cles.length + cfg.collection.forfaitDocument;', 'rendu += 3 + cfg.collection.forfaitDocument;']]]], attendu: [0, true],
            async scene({ svc, cfg }) {
                await svc.recompter(cfg); const n = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n;
                const garni = async (slug) => { const A = await compte(); for (const k of ['1|1', '2|1', '3|1']) await svc.cocher({ compteId: A.c._id, slug, cle: k, possedee: true, cfg }); return A.c._id; };
                const id1 = await garni('S-Sup'); await svc.cocher({ compteId: id1, slug: 'S-Sup', cle: '1|1', possedee: false, cfg });      // une clé retirée AVANT la suppression
                await svc.supprimerDuCompte(id1, cfg); const derive = (await n()) - (await placesReelles(cfg));
                let minimum = 0;
                for (let i = 0; i < 40; i++) {
                    const id = await garni(`S-Sup-${i}`);
                    await Promise.all([...['1|1', '2|1', '3|1'].map(k => svc.cocher({ compteId: id, slug: `S-Sup-${i}`, cle: k, possedee: false, cfg })), svc.supprimerDuCompte(id, cfg)]);
                    minimum = Math.min(minimum, (await n()) - (await placesReelles(cfg)));
                }
                return [derive, minimum >= 0];
            } },
        // ── I-B 1 : le forfait n'est rendu QUE si le document a réellement été supprimé (la dérive vers le bas). Course PUT false de la dernière clé / PUT true d'une autre, compteur exact à chaque tour.
        { nom: 'forfait rendu seulement si le document est réellement supprimé : course retrait de la dernière clé / pose d\'une autre (80 itérations), le compteur reste EXACT',
            mut: [['service.js', [['.deletedCount === 1) {', '.deletedCount >= 0) {']]]], attendu: [0],
            async scene({ svc, cfg }) {
                const A = await compte(), id = A.c._id; await svc.recompter(cfg); let ecarts = 0;
                for (let i = 0; i < 80; i++) {
                    const slug = `S-Compta-${i}`; const a = (cle, possedee) => svc.cocher({ compteId: id, slug, cle, possedee, cfg });
                    await a('1|1', true);
                    const ops = [() => a('1|1', false), () => a('2|1', true)]; if (i % 2) ops.reverse();
                    await Promise.all(ops.map(f => f()));
                    if ((await raw('compteurs').findOne({ cle: 'collection-cles' })).n !== await placesReelles(cfg)) ecarts++;
                }
                return [ecarts];
            } },
        // ── I-B 4 : le plancher à 0 de `rendre`
        { nom: 'le compteur ne passe jamais sous 0 (plancher de rendre)', mut: [['service.js', [['{ $max: [0, { $subtract: [\'$n\', k] }] }', '{ $subtract: [\'$n\', k] }']]]], attendu: [0],
            async scene({ svc, cfg }) {
                const A = await compte(); await svc.cocher({ compteId: A.c._id, slug: 'S-Plancher', cle: '1|1', possedee: true, cfg });
                await raw('compteurs').updateOne({ cle: 'collection-cles' }, { $set: { n: 0 } });                      // compteur trop bas (dérive) : le retrait ne doit pas le rendre négatif
                await svc.cocher({ compteId: A.c._id, slug: 'S-Plancher', cle: '1|1', possedee: false, cfg });
                const n = (await raw('compteurs').findOne({ cle: 'collection-cles' })).n; await svc.recompter(cfg);
                return [n];
            } },
        // ── I-B 2 et 3 : le recompte au montage ferme les écritures s'il échoue, et les écritures l'ATTENDENT. Une copie neuve du service (aucun recompte fait), la base enveloppée par injection.
        { nom: 'un recompte en échec FERME les écritures (rien d\'écrit, l\'erreur remonte : 503), il n\'est pas avalé ; la panne passée, l\'écriture suivante rejoue le recompte',
            mut: [['service.js', [['.catch(e => { initialisation = null; throw e; })', '.catch(() => 0)']]]], attendu: [true, 0, 1],
            async scene({ svc, cfg }) {
                const s = svc === svcReel ? charger('service.js', []) : svc; const A = await compte(); const avant = await nDocs();
                dbInjecte({ [NOM]: c => { const w = Object.create(c); w.aggregate = p => (p[0].$group ? { toArray: async () => { throw new Error('panne simulée'); } } : c.aggregate(p)); return w; } });
                let leve = false; try { await s.cocher({ compteId: A.c._id, slug: 'S-Panne', cle: '1|1', possedee: true, cfg }); } catch (e) { leve = true; } finally { dbInjecte(null); }
                const ecrits = (await nDocs()) - avant;
                const apres = await s.cocher({ compteId: A.c._id, slug: 'S-Panne', cle: '1|1', possedee: true, cfg }).catch(() => ({}));
                return [leve, ecrits, apres.possedees];
            } },
        { nom: 'les écritures ATTENDENT la fin du recompte (le recompte se termine avant la première écriture)',
            mut: [['service.js', [['await assurer(cfg);', '']]]], attendu: ['recompte-fin', true],
            async scene({ svc, cfg }) {
                const s = svc === svcReel ? charger('service.js', []) : svc; const A = await compte(); const journal = [];
                dbInjecte({ [NOM]: c => {
                    const w = Object.create(c);
                    w.aggregate = p => { const cur = c.aggregate(p); return p[0].$group ? { toArray: async () => { await attendre(300); const r = await cur.toArray(); journal.push('recompte-fin'); return r; } } : cur; };
                    w.findOneAndUpdate = (...a) => { journal.push('ecriture'); return c.findOneAndUpdate(...a); };
                    return w;
                } });
                try { await s.cocher({ compteId: A.c._id, slug: 'S-Attente', cle: '1|1', possedee: true, cfg }); } finally { dbInjecte(null); }
                return [journal[0], journal.includes('ecriture')];
            } },
        // ── M-B : un compteur ABSENT ferme les écritures (503) jusqu'au prochain recompte ; l'incrément conditionnel ne crée jamais le compteur
        { nom: 'compteur absent : les écritures ferment (rien d\'écrit, le compteur n\'est PAS recréé par l\'incrément) jusqu\'au recompte, qui le recrée',
            mut: [['service.js', [['{ $inc: { n: cout } })) !== null) return true;', '{ $inc: { n: cout } }, { upsert: true })) !== null) return true;']]]], attendu: [true, 0, 0, 1],
            async scene({ svc, cfg }) {
                const A = await compte(); await svc.recompter(cfg); await raw('compteurs').deleteMany({}); const avant = await nDocs();
                let leve = false; try { await svc.cocher({ compteId: A.c._id, slug: 'S-Absent', cle: '1|1', possedee: true, cfg }); } catch (e) { leve = true; }
                const etat = [leve, (await nDocs()) - avant, await raw('compteurs').countDocuments({})];
                await svc.recompter(cfg); const ok = await svc.cocher({ compteId: A.c._id, slug: 'S-Absent', cle: '1|1', possedee: true, cfg });
                return [...etat, ok.possedees];
            } },
        { nom: 'places : le recompte compte les clés ET les documents × forfait, et corrige un compteur FAUX vers le haut, vers le bas, ou absent', mut: [['service.js', [['{ $add: [{ $size: \'$cles\' }, cfg.collection.forfaitDocument] }', '{ $size: \'$cles\' }']]], ['service.js', [['{ $set: { n } }', '{ $set: { n: 0 } }']]]], attendu: [true, true, true, true],
            async scene({ svc, cfg }) {
                const A = await compte(); await svc.cocher({ compteId: A.c._id, slug: 'S-Rec', cle: '1|1', possedee: true, cfg });
                const lire = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n;
                const reel = () => placesReelles(cfg);
                const cles = (await raw(NOM).aggregate([{ $group: { _id: null, n: { $sum: { $size: '$cles' } } } }]).toArray())[0].n, nDocs = await raw(NOM).countDocuments({});
                await raw('compteurs').updateOne({ cle: 'collection-cles' }, { $set: { n: 999999 } }); const r1 = await svc.recompter(cfg); const ok1 = (await lire()) === (await reel()) && r1 === (await reel());
                await raw('compteurs').updateOne({ cle: 'collection-cles' }, { $set: { n: 0 } }); await svc.recompter(cfg); const ok2 = (await lire()) === (await reel());
                await raw('compteurs').deleteMany({}); await svc.recompter(cfg); const ok3 = (await lire()) === (await reel());
                return [ok1, ok2, ok3, (await reel()) === cles + nDocs * cfg.collection.forfaitDocument];
            } }
    ];
    for (const g of GARDES) {
        const cfgG = g.cfg || cfg;
        const ctx = { sv: await serveur(cfgG), svc: svcReel, cfg: cfgG };
        H.v(`3. ${g.nom} — code réel`, await g.scene(ctx), g.attendu);
        for (const [rel, rempl] of g.mut) {
            const mod = charger(rel, rempl);
            const ctxM = rel === 'routes.js' ? { sv: await serveur(cfgG, mod), svc: svcReel, cfg: cfgG } : { sv: null, svc: mod, cfg: cfgG };
            let vu; try { vu = await g.scene(ctxM); } catch (e) { vu = `exception ${(e && e.name) || 'erreur'}`; }
            H.vrai(`   ↳ copie mutée de ${rel} : la même scène donne un AUTRE résultat — la garde sait dire NON`, JSON.stringify(vu) !== JSON.stringify(g.attendu));
        }
    }
    H.v('   la limite d\'écritures par défaut est de 1 000 par heure et par compte ; les bornes de 2 000 clés par set, 20 000 par compte, 1 000 sets par compte', [cfg.limites.collectionEcrituresParCompteHeure, cfg.collection.clesParSet, cfg.collection.clesParCompte, cfg.collection.setsParCompte], [1000, 2000, 20000, 1000]);

    // ═══════════════ 4. LES BORNES PAR HTTP : le code de la liste fermée, le message qui nomme la borne ═══════════════
    {
        const s4 = await serveur(variante({ collection: { clesParSet: 2, clesParCompte: 3, setsParCompte: 2 } }));
        const A = await compte();
        await put(s4, A, 'S1', '1|1', true); await put(s4, A, 'S1', '2|1', true);
        const bs = await put(s4, A, 'S1', '3|1', true);
        H.v('4. une 3e clé dans un set limité à 2 : 409 CONFLIT « borne-set », le message nomme 2, rien n\'est perdu', [bs.statut, code(bs), detail(bs), /\b2\b/.test(bs.json.erreur.message), (await docs(A))[0].cles.length], [409, 'CONFLIT', 'borne-set', true, 2]);
        await put(s4, A, 'S2', '4|1', true);
        const bc = await put(s4, A, 'S2', '5|1', true);
        H.v('   une 4e clé au total (limite 3) : 409 CONFLIT « borne-compte », le message nomme 3', [bc.statut, code(bc), detail(bc), /\b3\b/.test(bc.json.erreur.message)], [409, 'CONFLIT', 'borne-compte', true]);
        const s5 = await serveur(variante({ collection: { setsParCompte: 1 } })); const B = await compte();
        await put(s5, B, 'S1', '1|1', true);
        const bss = await put(s5, B, 'S2', '1|1', true);
        H.v('   un 2e set avec une limite à 1 : 409 CONFLIT « borne-sets », le message nomme 1', [bss.statut, code(bss), detail(bss), /\b1\b/.test(bss.json.erreur.message)], [409, 'CONFLIT', 'borne-sets', true]);
    }

    // ═══════════════ 4 bis. LE PLAFOND GLOBAL par HTTP, et le recompte AU MONTAGE ═══════════════
    {
        const base = await svcReel.recompter(cfg);
        const s6 = await serveur(variante({ collection: { clesService: base + 1 + cfg.collection.forfaitDocument } })); const A = await compte();
        const ok = await put(s6, A, 'S-Global', '1|1', true), non = await put(s6, A, 'S-Global', '2|1', true);
        H.v('4 bis. plafond global atteint : 409 CONFLIT « borne-service », le message dit que la limite est celle du SERVICE, rien n\'est écrit', [ok.statut, non.statut, code(non), detail(non), /service/i.test(non.json.erreur.message) && /compte/i.test(non.json.erreur.message), (await docs(A))[0].cles], [200, 409, 'CONFLIT', 'borne-service', true, ['1|1']]);
        // le recompte au montage : un compteur faux est corrigé quand le lot est monté (le montage est le démarrage du processus)
        const lire = async () => (await raw('compteurs').findOne({ cle: 'collection-cles' })).n;
        const reel = () => placesReelles(cfg);
        const monte =async mod => { await raw('compteurs').updateOne({ cle: 'collection-cles' }, { $set: { n: 987654 } }); const r = express.Router(); mod.routes(r, cfg, {}); for (let i = 0; i < 40 && (await lire()) === 987654; i++) await attendre(50); return (await lire()) === (await reel()); };
        H.vrai('   montage du lot : un compteur faux (987 654) est recompté depuis les données réelles', await monte(require('../collection/monter')));
        const mutMonter = charger('monter.js', [['service.initialiser(cfg)', 'Promise.resolve()']]);
        H.vrai('   ↳ copie mutée de monter.js (sans recompte au montage) : le compteur reste faux — la garde sait dire NON', !(await monte(mutMonter)));
        await svcReel.recompter(cfg);
    }

    // ═══════════════ 4 ter. LE FORFAIT, CALCULÉ ; le pire cas en octets sous le plafond, pour les deux formes extrêmes ═══════════════
    {
        const { calculateObjectSize, ObjectId } = require('bson');
        const cle = '999999999999|' + 'x'.repeat(32);                                   // la clé la plus longue admise (12 chiffres + « | » + 32 caractères)
        const doc = n => ({ _id: new ObjectId(), compteId: new ObjectId(), set: 'a'.repeat(80), cles: Array.from({ length: n }, () => cle), majLe: new Date() });   // le slug le plus long
        void doc;
        // MESURE (pas une estimation) : des documents des formes extrêmes, créés dans la base en mémoire sous un nom de banc, `fsync`, puis `collStats` (taille des données et `totalIndexSize`, index unique compris).
        // Sans fsync + pause, `indexSizes` est faux (4 096 o pour 20 000 documents).
        const crypto = require('crypto'); const bdd = mongoose.connection.db;
        async function mesurer(nom, nComptes, nDocsParCompte, nCles) {
            const c = bdd.collection(nom); await c.createIndex({ compteId: 1, set: 1 }, { unique: true });
            let lot = [];
            for (let i = 0; i < nComptes; i++) {
                const compteId = new ObjectId();
                for (let j = 0; j < nDocsParCompte; j++) {
                    lot.push({ compteId, set: crypto.randomBytes(40).toString('hex'), cles: Array.from({ length: nCles }, () => `${String(Math.floor(Math.random() * 9e11) + 1e11)}|${crypto.randomBytes(16).toString('hex')}`), majLe: new Date() });
                    if (lot.length >= 1000) { await c.insertMany(lot); lot = []; }
                }
            }
            if (lot.length) await c.insertMany(lot);
            await bdd.admin().command({ fsync: 1 }); await attendre(1500);
            const st = await bdd.command({ collStats: nom }); await c.drop();
            return { n: nComptes * nDocsParCompte, octets: (st.size + st.totalIndexSize) / (nComptes * nDocsParCompte), donnees: st.size / (nComptes * nDocsParCompte), index: st.totalIndexSize / (nComptes * nDocsParCompte) };
        }
        const formeA = await mesurer('zz_mesure_forfait_a', 20, 1000, 1);        // 1 clé par document, 20 comptes
        const formeB = await mesurer('zz_mesure_forfait_b', 1, 1000, 1);         // 1 clé par document, 1 compte (l'index y est le plus gros par document)
        const formeC = await mesurer('zz_mesure_forfait_c', 5, 10, 2000);        // 2 000 clés par document
        const coutCle = formeC.octets / 2000;                                    // le coût d'une clé maximale, mesuré (données + index)
        const requis = f => Math.ceil(f.octets / coutCle) - 1;                   // places d'un document d'une clé = ceil(octets / coût d'une clé) ; moins la clé elle-même
        const forfaitRequis = Math.max(requis(formeA), requis(formeB));
        console.log(`   mesure collStats (après fsync) : 1 clé/doc (20 comptes) ${formeA.donnees.toFixed(0)} o de données + ${formeA.index.toFixed(0)} o d'index ; (1 compte) ${formeB.donnees.toFixed(0)} + ${formeB.index.toFixed(0)} ; 2 000 clés/doc ${formeC.octets.toFixed(0)} o, soit ${coutCle.toFixed(2)} o par clé`);
        console.log(`   forfait requis = max(⌈${formeA.octets.toFixed(0)} / ${coutCle.toFixed(2)}⌉, ⌈${formeB.octets.toFixed(0)} / ${coutCle.toFixed(2)}⌉) − 1 = ${forfaitRequis} places ; configuré : ${cfg.collection.forfaitDocument}`);
        H.vrai('4 ter. le forfait configuré couvre le forfait MESURÉ (le coût réel d\'un document en places ne le dépasse pas)', cfg.collection.forfaitDocument >= forfaitRequis);
        H.vrai('   ↳ un forfait de 4 (l\'ancienne estimation) ne couvrirait PAS la mesure — le banc sait dire NON', !(4 >= forfaitRequis));
        // pire cas en octets avec P places, MESURÉ : 1 clé par document (P / (1 + F) documents) ; 2 000 clés par document (P / (2 000 + F) documents)
        const pire = (C, forme) => { const F = C.collection.forfaitDocument, P = C.collection.clesService; return forme === 'un' ? Math.floor(P / (1 + F)) * Math.max(formeA.octets, formeB.octets) : Math.floor(P / (2000 + F)) * formeC.octets; };
        const MARGE = 23 * 1048576, Mo = x => (x / 1048576).toFixed(1);
        console.log(`   pire cas MESURÉ sous ${cfg.collection.clesService} places : 1 clé par document ${Mo(pire(cfg, 'un'))} Mo ; 2 000 clés par document ${Mo(pire(cfg, 'deux-mille'))} Mo ; marge de la grappe 23 Mo ; plafond qui épuiserait la marge ≈ ${Math.round(cfg.collection.clesService * MARGE / Math.max(pire(cfg, 'un'), pire(cfg, 'deux-mille')) / 1000) * 1000} places`);
        H.vrai('   sous le plafond par défaut, les deux formes extrêmes tiennent dans la marge de 23 Mo', pire(cfg, 'un') < MARGE && pire(cfg, 'deux-mille') < MARGE);
        const sansForfait = variante({ collection: { forfaitDocument: 0 } });
        H.vrai('   ↳ sans forfait (0), la forme « 1 clé par document » pèse plus du double — le calcul sait dire NON', pire(sansForfait, 'un') > 2 * pire(cfg, 'un'));
    }

    // ═══════════════ 5. LA CONCURRENCE : la borne par compte se contrôle AVANT l'écriture ; son dépassement est BORNÉ ═══════════════
    {
        const cfgC = variante({ collection: { clesParSet: 100, clesParCompte: 5, setsParCompte: 10 } });
        const A = await compte(); const id = A.c._id;
        for (let i = 1; i <= 4; i++) await svcReel.cocher({ compteId: id, slug: 'S1', cle: `${i}|1`, possedee: true, cfg: cfgC });
        const N = 8;
        const r = await Promise.all(Array.from({ length: N }, (_, i) => svcReel.cocher({ compteId: id, slug: 'S1', cle: `${100 + i}|1`, possedee: true, cfg: cfgC })));
        const total = (await docs(A)).reduce((n, x) => n + x.cles.length, 0);
        console.log(`   concurrence : ${N} écritures simultanées avec 4 clés sur 5 permises → ${r.filter(x => !x.refus).length} acceptées, total ${total}`);
        H.vrai(`5. dépassement de la borne par compte, borné par le nombre d'écritures en vol (${N}) : 5 ≤ total ≤ ${4 + N}`, total >= 5 && total <= 4 + N);
        const apres = await svcReel.cocher({ compteId: id, slug: 'S1', cle: '999|1', possedee: true, cfg: cfgC });
        H.v('   l\'écriture suivante voit le vrai total et est refusée', apres.refus, 'borne-compte');
        // la création simultanée du MÊME document (clé unique) : aucune écriture perdue, aucune erreur
        const B = await compte();
        const cr = await Promise.all(Array.from({ length: 10 }, (_, i) => svcReel.cocher({ compteId: B.c._id, slug: 'S-Neuf', cle: `${i + 1}|1`, possedee: true, cfg })));
        const dB = await docs(B);
        H.v('   10 premières écritures simultanées dans un set neuf : un seul document, 10 clés, aucun refus', [dB.length, dB[0].cles.length, cr.filter(x => x.refus).length], [1, 10, 0]);
    }

    // ═══════════════ 6. CORS DU SITE : le préflight de PUT ═══════════════
    {
        const pf = (origine, ch, methode = 'PUT') => H.appel(sv.url, ch, { methode: 'OPTIONS', entetes: { origin: origine, 'access-control-request-method': methode } });
        const a = await pf(SITE, chemin('Set-Essai', '12|001')), b = await pf(SITE, '/api/collection', 'GET'), c = await pf(SITE, '/api/compte/connexion', 'POST'), e = await pf(EXT, chemin('Set-Essai', '12|001'));
        H.v('6. préflight du site sur la fiche : 204, credentials, Allow-Methods contient PUT', [a.statut, a.entetes['access-control-allow-origin'], a.entetes['access-control-allow-credentials'], /\bPUT\b/.test(a.entetes['access-control-allow-methods'])], [204, SITE, 'true', true]);
        H.v('   préflight de la liste : 204 et GET autorisé', [b.statut, /\bGET\b/.test(b.entetes['access-control-allow-methods'])], [204, true]);
        H.v('   le profil du site ailleurs est INCHANGÉ (/api/compte/connexion : GET, POST, DELETE, sans PUT)', c.entetes['access-control-allow-methods'], 'GET, POST, DELETE');
        H.v('   l\'extension n\'a aucun CORS sur la collection', e.entetes['access-control-allow-origin'], undefined);
        const w = await put(sv, await compte(), 'Set-Essai', '12|001', true);
        H.v('   la réponse du PUT porte les en-têtes CORS du site (origine exacte, credentials)', [w.entetes['access-control-allow-origin'], w.entetes['access-control-allow-credentials']], [SITE, 'true']);
    }

    // ═══════════════ 7. LA GARDE D'INDEX : sans l'index de la collection, les routes sont fermées (503) ═══════════════
    {
        H.vrai('7. l\'index unique (compteId, set) est déclaré dans modeles.js', M.INDEX.some(i => i.c === NOM && i.nom === 'collection_cle' && i.opts.unique === true && JSON.stringify(i.cle) === JSON.stringify({ compteId: 1, set: 1 })));
        const A = await compte();
        await raw(NOM).dropIndex('collection_cle'); pret.armer(M.verifierIndex);
        const r = await lireSets(sv, A), w = await put(sv, A, 'Set-A', '1|1', true);
        H.v('   index retiré : GET et PUT rendent 503 INDISPONIBLE (la garde d\'index de pret les ferme)', [r.statut, code(r), w.statut, code(w)], [503, 'INDISPONIBLE', 503, 'INDISPONIBLE']);
        await M.creerIndex(); pret.armer(M.verifierIndex);
        H.v('   index rétabli : la lecture repasse', (await lireSets(sv, A)).statut, 200);
    }

    // ═══════════════ 8. LA SUPPRESSION DU COMPTE emporte sa collection (et tous les chemins qui suppriment un compte) ═══════════════
    {
        const P = require('../comptes/mots-de-passe'); const svcCompte = require('../comptes/service');
        const A = await compte({ motDePasse: await P.hacher(MDP) }), B = await compte();
        await svcReel.cocher({ compteId: A.c._id, slug: 'S1', cle: '1|1', possedee: true, cfg }); await svcReel.cocher({ compteId: A.c._id, slug: 'S2', cle: '2|1', possedee: true, cfg });
        await svcReel.cocher({ compteId: B.c._id, slug: 'S1', cle: '1|1', possedee: true, cfg });
        const avant = (await docs(A)).length;
        const r = await svcCompte.supprimerCompte({ compte: A.c, motDePasse: MDP, renonciation: false, cfg });
        H.v('8. supprimerCompte : 200, et 0 document de collection pour ce compte (il en avait 2)', [r.statut, avant, (await docs(A)).length], [200, 2, 0]);
        H.v('   la collection d\'un autre compte est intacte', (await docs(B)).length, 1);
        // §21 bis : tout fichier de production qui supprime un compte supprime aussi sa collection
        const fichiers = []; (function parcourir(d, profondeur) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (profondeur === 0 && !['v2', 'collecte-cartes', 'verrou'].includes(e.name)) continue; if (e.name === 'test' || e.name === 'node_modules' || e.name.startsWith('.')) continue; parcourir(p, profondeur + 1); } else if (e.name.endsWith('.js')) fichiers.push(p); } })(R, 0);
        const SUPPRIME = /(?:col\(\s*'comptes'\s*\)|collection\(\s*'comptes'\s*\))\s*\.\s*(deleteOne|deleteMany|findOneAndDelete|drop|bulkWrite)\b/;
        const qui = fichiers.filter(f => SUPPRIME.test(fs.readFileSync(f, 'utf8')));
        console.log(`   ${fichiers.length} fichiers de production parcourus ; suppriment des comptes : ${qui.map(f => path.relative(R, f)).join(', ') || 'aucun'}`);
        H.vrai('   le parcours trouve au moins le chemin connu (comptes/service.js) : un parcours vide ne prouve rien', qui.some(f => f.endsWith(path.join('comptes', 'service.js'))));
        H.v('   chaque fichier qui supprime un compte appelle supprimerDuCompte (la collection)', qui.filter(f => !fs.readFileSync(f, 'utf8').includes('supprimerDuCompte(')).map(f => path.relative(R, f)), []);
    }

    // ═══════════════ 9. LES CHEMINS FERMÉS EN 503 sous configuration invalide : DEUX listes, une seule vérité (§21 bis) ═══════════════
    {
        const routeur = assembler(LOTS, cfg, {});
        const segments = new Set(); for (const c of routeur.stack) if (c.route) { const m = /^\/api\/[^/]+/.exec(c.route.path); if (m) segments.add(m[0]); }
        const { CHEMINS_HERITES } = require('../heritage');
        const attendus = [...segments].filter(s => !CHEMINS_HERITES.includes(s)).sort();
        console.log(`   segments /api/<x> des ${routeur.stack.filter(c => c.route).length} routes montées : ${[...segments].sort().join(' ')} ; propres à la v2 (hors chemins hérités) : ${attendus.join(' ')}`);
        H.v('9. la liste des chemins fermés en 503 (index.js) = les segments propres à la v2 des routes MONTÉES, ni plus ni moins', [...v2.CHEMINS_FERMES_503].sort(), attendus);
        H.vrai('   « /api/collection » en fait partie', v2.CHEMINS_FERMES_503.includes('/api/collection'));
    }

    // ═══════════════ 10. L'INTERRUPTEUR : éteint, la route n'existe pas (production inchangée) ; allumé, elle répond ; configuration invalide, 503 ═══════════════
    {
        const { demarrer, appeler, RACINE } = require('../../verrou/serveur');
        const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js'), CHARGES = path.join(RACINE, 'verrou', 'charges.json');
        const avec = async (envSup, fn) => {
            const srv = await demarrer(FAUX, { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-collection', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', ...envSup });
            try { if (!await srv.attendreMongo()) throw new Error('Mongo non connecté'); return await fn(srv); } finally { srv.enfant.kill(); }
        };
        const ch = ['/api/collection', '/api/collection/sets/Set-Essai', '/api/collection/sets/Set-Essai/fiches/1%7C001'];
        await avec({ RM_API_V2: '' }, async srv => {
            const vus = [];
            for (const [m, c] of [['GET', ch[0]], ['GET', ch[1]], ['PUT', ch[2]]]) {
                const cRef = c.replace('/api/collection', '/api/zzz-inexistant');
                const x = await appeler(srv.port, m, c, m === 'PUT' ? { possedee: true } : undefined), ref = await appeler(srv.port, m, cRef, m === 'PUT' ? { possedee: true } : undefined);
                // le 404 par défaut d'Express cite le chemin (« Cannot GET /… ») : on compare corps et statut une fois le chemin retiré
                vus.push([x.status, x.status === ref.status && x.brut.split(c).join('<chemin>') === ref.brut.split(cRef).join('<chemin>')]);
            }
            H.v('10. interrupteur ÉTEINT : les trois routes répondent comme un chemin inexistant (404, même corps) — la production est inchangée', vus, [[404, true], [404, true], [404, true]]);
        });
        await avec({ RM_API_V2: '1' }, async srv => {
            const x = await appeler(srv.port, 'GET', ch[0]);
            H.v('   interrupteur ALLUMÉ (index.js réel) : GET /api/collection sans session → 401 SESSION', [x.status, x.json && x.json.erreur && x.json.erreur.code], [401, 'SESSION']);
            const y = await appeler(srv.port, 'PUT', ch[2], { possedee: true });
            H.v('   ... et le PUT sans session → 401 SESSION', [y.status, y.json && y.json.erreur && y.json.erreur.code], [401, 'SESSION']);
        });
        await avec({ RM_API_V2: '1', V2_ACCUEIL: 'beaucoup' }, async srv => {
            const vus = [];
            for (const [m, c] of [['GET', ch[0]], ['GET', ch[1]], ['PUT', ch[2]]]) { const x = await appeler(srv.port, m, c, m === 'PUT' ? { possedee: true } : undefined); vus.push([x.status, x.json && x.json.erreur && x.json.erreur.code]); }
            H.v('   configuration INVALIDE : les trois routes → 503 INDISPONIBLE (chemin fermé)', vus, [[503, 'INDISPONIBLE'], [503, 'INDISPONIBLE'], [503, 'INDISPONIBLE']]);
        });
    }
    for (const s of serveurs) await s.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

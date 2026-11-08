'use strict';
// BANC-TELEPHONE — la page de mesure sur téléphone et son dépôt de résultats. Base : la base EN MÉMOIRE du banc. Aucun réseau (le modèle n'est jamais téléchargé ici : la page n'est pas exécutée par ce banc ;
// le pilote Chrome local est outils/banc-telephone/pilote-local.js). Les routes n'existent QUE sur l'essai (V2_CIBLE, RENDER_SERVICE_ID) derrière V2_BANC_TELEPHONE=1.
const H = require('./_harnais');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const routes = require('../banc-telephone/routes');
const G = require('../banc-telephone/garde');
const S = require('../banc-telephone/stockage');

const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');
const SHA = 'a'.repeat(64);
const ENV_BON = { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', V2_VISUELS_R2_COMPTE: 'moncompte123' };
const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), modeleEmpreinte: { id: 'p8000-poids8s-1', sha256: SHA, octets: 118202501 } };
const aleaHex = i => String(i).padStart(16, '0');
const sha12 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12);

const doc = (o = {}) => ({ v: 1, runId: '0123456789abcdef', modeleSha: SHA, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', isole: true, coeurs: 6, memoireAppareilGo: null, gpuDispo: true, gpu: { vendor: 'apple', architecture: 'common-3' },
    decodeurOptions: true, modeleOctets: 118202501, telechargementMs: 12000, verifShaMs: 900, shaVerifie: true,
    mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', fils: 3, filsDemandes: 3, creationSessionMs: 1200.5, premiereMs: 900, medianeMs: 700, p95Ms: 800, pretraitementMedianeMs: 40, nEmpreintes: 30, nVecteursRefuses: 0, cosMin: 0.9999987, cosMoy: 0.9999995, cosMinModeleSeul: 1, nModeleSeul: 12,
        cosMinContreWasm: null, jsHeapApresCreationMo: null, jsHeapFinMo: null, uaApresCreationMo: null, uaFinMo: null, erreur: null }, ...o });

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente`); await new Promise(r => setTimeout(r, reste + 2000)); } }
    await H.ouvrirBac('test-banc-telephone.js'); await M.creerIndex();
    const defaire = H.fixerHorlogeMilieu();

    // ═══ 1. la garde : trois conditions positives, toutes requises ═══
    H.v('1. toutes les conditions ⇒ actif', G.lire(ENV_BON), { actif: true, raison: 'essai' });
    for (const [nom, env] of [['drapeau absent', { ...ENV_BON, V2_BANC_TELEPHONE: undefined }], ['drapeau « 0 »', { ...ENV_BON, V2_BANC_TELEPHONE: '0' }], ['drapeau « true »', { ...ENV_BON, V2_BANC_TELEPHONE: 'true' }], ['drapeau « 1 » avec espace', { ...ENV_BON, V2_BANC_TELEPHONE: ' 1' }],
        ['cible absente', { ...ENV_BON, V2_CIBLE: undefined }], ['cible « prod »', { ...ENV_BON, V2_CIBLE: 'prod' }], ['cible « Essai »', { ...ENV_BON, V2_CIBLE: 'Essai' }],
        ['service absent', { ...ENV_BON, RENDER_SERVICE_ID: undefined }], ['autre service Render', { ...ENV_BON, RENDER_SERVICE_ID: 'srv-autre' }], ['service de l\'essai en majuscules', { ...ENV_BON, RENDER_SERVICE_ID: 'SRV-DB7TICGM7KPS73CRJIBG' }], ['environnement vide', {}], ['environnement nul', null]])
        H.v(`1. ${nom} ⇒ inactif`, G.lire(env).actif, false);
    H.v('1. l\'hôte R2 : exact, dérivé du compte, sans joker', [G.hoteR2({ V2_VISUELS_R2_COMPTE: 'moncompte123' }), G.hoteR2({ V2_VISUELS_R2_ENDPOINT: 'https://x.exemple.org' }), G.hoteR2({ V2_VISUELS_R2_ENDPOINT: 'http://x.exemple.org' }), G.hoteR2({ V2_VISUELS_R2_COMPTE: 'a b' }), G.hoteR2({})], ['moncompte123.r2.cloudflarestorage.com', 'x.exemple.org', null, null, null]);

    // ═══ 2. le montage ═══
    const monter = async (env, extra = {}) => { const app = express(); app.use(express.json()); const router = express.Router(); monterBanc.routes(router, cfg, { banc: {}, purge: { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) }, envBancTelephone: env, ...extra }); app.use(router); app.use((err, req, res, next) => res.status(err.status || 500).json({ success: false })); return H.serveur(app); };
    const srv = await monter(ENV_BON, { ipHeureBancTelephone: 1000 }), srvOff = await monter({ ...ENV_BON, V2_BANC_TELEPHONE: undefined }), srvAutre = await monter({ ...ENV_BON, RENDER_SERVICE_ID: 'srv-autre' }), srvProd = await monter({ ...ENV_BON, V2_CIBLE: 'prod' });
    const brut = async (s, methode, chemin, corps) => { const x = await fetch(s.url + chemin, { method: methode, headers: corps !== undefined ? { 'content-type': 'application/json' } : {}, body: corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps) }); const texte = await x.text(); const h = Object.fromEntries(x.headers); delete h.date; delete h['content-length']; delete h.etag; return { statut: x.status, texte, h, tete: x.headers }; };
    const norm = (r, chemin) => ({ ...r, texte: r.texte.split(chemin).join('<CHEMIN>'), tete: undefined });

    // ═══ 3. éteint : 404 natif, octet pour octet comme une route inexistante ═══
    {
        const vraies = { GET: norm(await brut(srvOff, 'GET', '/api/banc/route-inexistante'), '/api/banc/route-inexistante'), POST: norm(await brut(srvOff, 'POST', '/api/banc/route-inexistante', doc()), '/api/banc/route-inexistante') };
        H.vrai('3.    instrument : la route inexistante rend un 404 non JSON qui cite le chemin', vraies.GET.statut === 404 && vraies.GET.texte.includes('<CHEMIN>') && vraies.POST.statut === 404);
        for (const [nom, s] of [['drapeau éteint', srvOff], ['autre service Render', srvAutre], ['cible « prod »', srvProd]]) {
            for (const [m, chemin, corps] of [['GET', '/api/banc/telephone'], ['GET', '/api/banc/telephone?iso=0'], ['GET', '/api/banc/telephone/app.js'], ['GET', '/api/banc/telephone/lot.json'], ['GET', '/api/banc/telephone/ort/ort-wasm-simd-threaded.wasm'], ['POST', '/api/banc/telephone/resultat', doc()]]) {
                const r = norm(await brut(s, m, chemin.split('?')[0], corps), chemin.split('?')[0]);
                H.v(`3. ${nom} : ${m} ${chemin} = 404 natif (mêmes statut, corps, en-têtes qu'une route inexistante)`, r, vraies[m]);
            }
        }
        H.v('3. éteint : rien n\'est écrit', await db.col('banc_telephone').countDocuments({}), 0);
        H.v('3. le drapeau éteint ne retire pas les autres routes du banc (l\'étiquette reste montée : sans jeton ⇒ 401)', (await H.appel(srvOff.url, '/api/banc/etiquette', { methode: 'POST', corps: {} })).statut, 401);
    }

    // ═══ 4. la page ═══
    {
        const r = await brut(srv, 'GET', '/api/banc/telephone');
        const csp = r.h['content-security-policy'] || '';
        H.v('4. la page : 200, HTML', [r.statut, /^text\/html/.test(r.h['content-type'])], [200, true]);
        H.v('4. isolement : COOP same-origin, COEP require-corp, CORP same-origin', [r.h['cross-origin-opener-policy'], r.h['cross-origin-embedder-policy'], r.h['cross-origin-resource-policy']], ['same-origin', 'require-corp', 'same-origin']);
        H.v('4. CSP : tout est \'self\', wasm permis, aucun eval ni en ligne, aucun joker, aucun schéma nu', [/default-src 'none'/.test(csp), /script-src 'self' 'wasm-unsafe-eval'(;|$)/.test(csp), /'unsafe-eval'|'unsafe-inline'/.test(csp), /\*/.test(csp), /(^|[ ;])(https?|data|blob):(\s|;|$)/.test(csp.replace(/worker-src[^;]*/, ''))], [true, true, false, false, false]);
        H.v('4. CSP : connect-src = self + l\'hôte R2 EXACT (seule exception)', (/connect-src ([^;]+)/.exec(csp) || [, ''])[1], '\'self\' https://moncompte123.r2.cloudflarestorage.com');
        H.v('4. CSP : frame-ancestors none, base-uri none, form-action none', [/frame-ancestors 'none'/.test(csp), /base-uri 'none'/.test(csp), /form-action 'none'/.test(csp)], [true, true, true]);
        H.v('4. le gabarit est rempli : sha256 et octets du modèle de la configuration, plus aucun marqueur', [r.texte.includes(`content="${SHA}"`), r.texte.includes('content="118202501"'), /__[A-Z_]+__/.test(r.texte)], [true, true, false]);
        H.v('4. aucun script en ligne, aucun style en ligne', [/<script(?![^>]*\bsrc=)[^>]*>/i.test(r.texte), /<style|\sstyle=/i.test(r.texte)], [false, false]);
        const r0 = await brut(srv, 'GET', '/api/banc/telephone?iso=0');
        H.v('4. ?iso=0 : la page SANS isolement (ni COOP ni COEP), CSP inchangée, la page le dit', [r0.h['cross-origin-opener-policy'], r0.h['cross-origin-embedder-policy'], r0.h['content-security-policy'] === csp, r0.texte.includes('content="non"'), r.texte.includes('content="oui"')], [undefined, undefined, true, true, true]);
        const sansHote = await monter({ ...ENV_BON, V2_VISUELS_R2_COMPTE: undefined });
        H.v('4. sans configuration R2 : connect-src = \'self\' seul (jamais un hôte inventé)', (/connect-src ([^;]+)/.exec((await brut(sansHote, 'GET', '/api/banc/telephone')).h['content-security-policy']) || [, ''])[1], '\'self\'');
        const echappe = express(); echappe.use(express.json());
        const rr = express.Router(); routes.monter(rr, { modeleEmpreinte: { sha256: '"><script>x</script>', octets: 1 } }, { envBancTelephone: ENV_BON }); echappe.use(rr);
        const sEch = await H.serveur(echappe); const pe = await brut(sEch, 'GET', '/api/banc/telephone');
        H.v('4. une valeur de configuration est ÉCHAPPÉE dans le gabarit', [pe.texte.includes('<script>x</script>'), pe.texte.includes('&lt;script&gt;')], [false, true]);
        await sEch.fermer(); await sansHote.fermer();
    }

    // ═══ 5. ses fichiers : une liste fermée ═══
    {
        for (const [chemin, { f, t }] of Object.entries(routes.FICHIERS)) {
            const r = await brut(srv, 'GET', chemin), taille = fs.statSync(path.join(PUB, f)).size;
            H.v(`5. ${chemin} : 200, bon type, bonne longueur, isolement`, [r.statut, r.h['content-type'], Number(r.tete.get('content-length')), r.h['cross-origin-embedder-policy']], [200, t, taille, 'require-corp']);
        }
        for (const chemin of ['/api/banc/telephone/page.html', '/api/banc/telephone/ort/inconnu.wasm', '/api/banc/telephone/ort', '/api/banc/telephone/../../package.json', '/api/banc/telephone/%2e%2e/%2e%2e/package.json', '/api/banc/telephone/ort/..%2f..%2fpage.html', '/api/banc/telephone/lot.json/x', '/api/banc/telephone/APP.JS.map'])
            H.v(`5. hors liste : ${chemin} ⇒ 404`, (await brut(srv, 'GET', chemin)).statut, 404);
        H.v('5. pas de chemin lu dans la requête : aucune route à paramètre', Object.keys(routes.FICHIERS).some(c => c.includes(':')), false);
    }

    // ═══ 6. le dépôt d'une mesure ═══
    {
        const post = (corps, s = srv) => brut(s, 'POST', '/api/banc/telephone/resultat', corps);
        const avant = await db.col('banc_telephone').countDocuments({});
        let r = await post(doc());
        const j = JSON.parse(r.texte);
        H.v('6. un dépôt valide ⇒ 201 et un identifiant', [r.statut, j.success, typeof j.id], [201, true, 'string']);
        const lu = await db.col('banc_telephone').findOne({});
        H.v('6. le document est stocké tel que reçu, avec sa date de réception — et rien de personnel (ni IP, ni en-tête)', [lu.runId, lu.mesure.cosMin, lu.recuLe instanceof Date, Object.keys(lu).filter(k => !Object.keys(doc()).includes(k) && k !== '_id' && k !== 'recuLe')], ['0123456789abcdef', 0.9999987, true, []]);
        const refus = async (nom, corps, statut, detail) => { const x = await post(corps), jj = (() => { try { return JSON.parse(x.texte); } catch { return {}; } })(); H.v(`6. ${nom} ⇒ ${statut}${detail ? ' ' + detail : ''}`, [x.statut, jj.erreur && jj.erreur.detail], [statut, detail]); };
        await refus('champ inconnu à la racine', { ...doc(), prix: 12 }, 400, 'champ-inconnu:prix');
        await refus('champ inconnu dans la mesure', doc({ mesure: { ...doc().mesure, secret: 'x' } }), 400, 'champ-inconnu:mesure.secret');
        await refus('champ inconnu dans le gpu', doc({ gpu: { vendor: 'x', architecture: 'y', serie: 'z' } }), 400, 'champ-inconnu:gpu.serie');
        await refus('un prix, même nommé autrement, n\'a aucune place (liste fermée)', doc({ prixGuide: 1 }), 400, 'champ-inconnu:prixGuide');
        await refus('version inconnue', doc({ v: 2 }), 400, 'champ:v');
        await refus('runId mal formé', doc({ runId: 'zz' }), 400, 'champ:runId');
        await refus('sha256 mal formé', doc({ modeleSha: 'abc' }), 400, 'champ:modeleSha');
        await refus('agent utilisateur non ASCII', doc({ ua: 'Mozilla é' }), 400, 'champ:ua');
        await refus('agent utilisateur de 301 caractères', doc({ ua: 'a'.repeat(301) }), 400, 'champ:ua');
        await refus('moteur inconnu', doc({ mesure: { ...doc().mesure, moteur: 'cuda' } }), 400, 'champ:mesure.moteur');
        await refus('verdict inconnu', doc({ mesure: { ...doc().mesure, verdict: 'PARFAIT' } }), 400, 'champ:mesure.verdict');
        await refus('un nombre en chaîne', doc({ mesure: { ...doc().mesure, medianeMs: '700' } }), 400, 'champ:mesure.medianeMs');
        await refus('un cosinus impossible', doc({ mesure: { ...doc().mesure, cosMin: 7 } }), 400, 'champ:mesure.cosMin');
        await refus('un temps négatif', doc({ mesure: { ...doc().mesure, premiereMs: -1 } }), 400, 'champ:mesure.premiereMs');
        await refus('la mesure manque', (() => { const d = doc(); delete d.mesure; return d; })(), 400, 'manque:mesure');
        await refus('la mesure n\'a ni moteur ni verdict', doc({ mesure: { cosMin: 1 } }), 400, 'manque:mesure.moteur');
        await refus('la mesure est un tableau', doc({ mesure: [] }), 400, 'champ:mesure');
        await refus('le corps est un tableau', [doc()], 400, 'forme');
        H.v('6. le corps est une chaîne JSON ⇒ 400 (refusé par l\'analyseur JSON strict, avant la route)', (await post('"texte"')).statut, 400);
        await refus('un erreur de 201 caractères', doc({ mesure: { ...doc().mesure, erreur: 'e'.repeat(201) } }), 400, 'champ:mesure.erreur');
        // la forme d'une erreur de mesure (peu de champs) est PERMISE
        r = await post(doc({ mesure: { moteur: 'webgpu', verdict: 'ERREUR', erreur: 'webgpu-indisponible:sans-gpu' }, gpu: null }));
        H.v('6. une mesure en erreur (champs partiels) est reçue', r.statut, 201);
        // la taille : 8 Ko au plus
        const gros = doc({ ua: 'u'.repeat(300), mesure: { ...doc().mesure, erreur: 'e'.repeat(200) } });
        H.vrai('6.    instrument : le plus gros document légitime tient largement sous 8 Ko', Buffer.byteLength(JSON.stringify(gros)) < 2000);
        const enorme = '{"v":1,"x":"' + 'x'.repeat(9000) + '"}';
        let x = await post(enorme);
        H.v('6. un corps de 9 Ko ⇒ 413 trop-gros', [x.statut, JSON.parse(x.texte).erreur.detail], [413, 'trop-gros']);
        H.v('6. la validation seule refuse aussi un objet > 8 Ko (sans en-tête de longueur)', S.valider({ ...doc(), ua: 'u'.repeat(9000) }).ok, false);
        H.v('6. rien d\'invalide n\'a été stocké : les seuls ajouts sont les deux dépôts valides', await db.col('banc_telephone').countDocuments({}), avant + 2);
        // les clés dangereuses : refusées par la liste fermée, jamais copiées
        x = await post('{"__proto__":{"admin":true},"v":1}');
        H.v('6. __proto__ à la racine ⇒ 400 (liste fermée)', x.statut, 400);
        H.vrai('6.    instrument : Object.prototype n\'a pas été pollué', ({}).admin === undefined);
        const vide = await post('{}');
        H.v('6. un objet vide ⇒ 400', vide.statut, 400);
    }

    // ═══ 7. la limite par IP ═══
    {
        await db.col('limites').deleteMany({});            // les compteurs sont communs aux serveurs de ce banc (même IP, même nom de limite)
        const s = await monter(ENV_BON, { ipHeureBancTelephone: 3 });
        const codes = []; for (let i = 0; i < 5; i++) codes.push((await brut(s, 'POST', '/api/banc/telephone/resultat', doc({ runId: aleaHex(i) }))).statut);
        H.v('7. au plus 3 dépôts par heure et par IP, puis 429 (avec Retry-After)', codes, [201, 201, 201, 429, 429]);
        const x = await brut(s, 'POST', '/api/banc/telephone/resultat', doc());
        H.v('7. le refus porte Retry-After et le code DEBIT', [Number(x.h['retry-after']) >= 1, JSON.parse(x.texte).erreur.code], [true, 'DEBIT']);
        H.v('7. le plafond par défaut est de 30 par heure', routes.IP_HEURE, 30);
        // un dépôt refusé par la limite n'est pas stocké ; un dépôt INVALIDE compte quand même (le limiteur passe avant la validation : on ne lit pas un corps qu'on n'a pas le droit de traiter)
        await s.fermer(); await db.col('limites').deleteMany({});
    }

    // ═══ 8. le stockage borné : 200 documents au plus, le plus ancien remplacé ═══
    {
        H.v('8. la borne est 200', S.DOCUMENTS_MAX, 200);
        const C = db.col('banc_telephone'); await C.deleteMany({});
        for (let i = 0; i < 205; i++) await S.stocker({ n: i }, { max: S.DOCUMENTS_MAX });
        const restants = (await C.find({}).sort({ _id: 1 }).toArray()).map(d => d.n);
        H.v('8. 205 dépôts ⇒ 200 documents, les 5 plus anciens sont partis', [restants.length, restants[0], restants[199], restants.includes(4), restants.includes(5)], [200, 5, 204, false, true]);
        await C.deleteMany({});
        const s = await monter(ENV_BON, { ipHeureBancTelephone: 100, documentsMaxBancTelephone: 3 });
        for (let i = 0; i < 6; i++) await brut(s, 'POST', '/api/banc/telephone/resultat', doc({ runId: aleaHex(i) }));
        H.v('8. par la route : borne 3, six dépôts ⇒ les trois plus récents', (await C.find({}).sort({ _id: 1 }).toArray()).map(d => d.runId), [aleaHex(3), aleaHex(4), aleaHex(5)]);
        await s.fermer(); await C.deleteMany({});
    }

    // ═══ 9. les fichiers servis : ce qui doit rester identique ═══
    {
        const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
        H.v('9. le lot : 30 cartes de catalogue, 12 avec pixels, références float32 de 256 composantes, aucun nom de lot scellé', [lot.cartes.length, lot.cartes.filter(c => c.px).length, lot.cartes.every(c => Buffer.from(c.ref, 'base64').length === 1024), lot.cartes.every(c => /^catalogue:[0-9a-f]{40}\.webp$/.test(c.origine))], [30, 12, true, true]);
        H.v('9. le lot est pour le modèle servi (857105e3eb00…)', lot.modeleSha256.slice(0, 12), '857105e3eb00');
        H.v('9. ORT 1.30.0 : les quatre fichiers du bundle sont ceux de l\'extension v2 (sha256 tronqués)', [sha12(path.join(PUB, 'ort', 'ort.wasm.bundle.min.mjs')), sha12(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.wasm')), sha12(path.join(PUB, 'ort', 'ort.webgpu.bundle.min.mjs')), sha12(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.asyncify.wasm'))], ['11e64bd8ffe1', '3398c10d07d2', '0730816731ce', '39f9f0894d47']);
        H.v('9. empreinte.js et moteur-ort.js sont les fichiers de l\'extension v2, copiés sans changement (sha256 tronqués)', [sha12(path.join(PUB, 'empreinte.js')), sha12(path.join(PUB, 'moteur-ort.js'))], ['54e47625823c', '56c6df07b212']);
        const src = ['app.js', 'page.html', 'empreinte.js', 'moteur-ort.js'].map(f => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')).join('\n');
        H.v('9. la page n\'utilise ni innerHTML, ni outerHTML, ni document.write, ni eval, ni new Function', /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src), false);
        H.v('9. la page ne contacte que l\'API elle-même : aucune adresse absolue (hors commentaires de licence)', (fs.readFileSync(path.join(PUB, 'app.js'), 'utf8').replace(/\/\/.*$/gm, '').match(/https?:\/\//g) || []).length, 0);
        H.v('9. aucun prix, aucun montant dans le code de la page ni dans le dépôt de résultats', /prix|price|\\beuros?\\b|€/i.test(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8').replace(/\/\/.*$/gm, '')) || /prix|price|euro/i.test(Object.keys(S.RACINE).concat(Object.keys(S.MESURE)).join(' ').replace(/decodeur/g, '')), false);
    }

    // ═══ 10. le montage dans l'assembleur de la v2 : la liste blanche des chemins l'accepte, aucun use() ═══
    {
        const { assembler } = require('../index');
        let erreur = null;
        try { assembler([monterBanc], cfg, { banc: {}, purge: { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) }, envBancTelephone: ENV_BON }); } catch (e) { erreur = e.message; }
        H.v('10. assembler() accepte les routes du lot (liste blanche des chemins, routes seulement)', erreur, null);
        const r = express.Router(); routes.monter(r, cfg, { envBancTelephone: ENV_BON });
        const chemins = r.stack.map(c => `${Object.keys(c.route.methods).join()} ${c.route.path}`);
        H.v('10. 11 routes : la page, 9 fichiers, le dépôt — toutes littérales', [chemins.length, chemins.filter(c => /[*?(]|:[a-z]/i.test(c.split(' ')[1])).length], [11, 0]);
        const rOff = express.Router(); H.v('10. éteint : monter() ne monte rien et le dit', [routes.monter(rOff, cfg, { envBancTelephone: {} }), rOff.stack.length], [false, 0]);
    }

    defaire();
    for (const s of [srv, srvOff, srvAutre, srvProd]) await s.fermer();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error('❌', e); process.exit(1); });

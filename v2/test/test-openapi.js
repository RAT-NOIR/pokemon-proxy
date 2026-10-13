'use strict';
// COHÉRENCE schéma ↔ code (CLAUDE.md §21 bis) : le contrat publié ne dérive pas du code sans que ça se voie.
// Une liste fermée vit à deux endroits (le code, le schéma) : ce banc exige l'égalité ENSEMBLE POUR ENSEMBLE.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { verifierUnSchema, verifierSchema } = require('../openapi/valider');
const { CODES } = require('../erreurs');
const { lireConfig } = require('../config');

const FICHIER = path.join(__dirname, '..', 'openapi', 'openapi.v2.json');
const doc = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
const S = doc.components.schemas;
const cfg = lireConfig({});

// ── listes de référence du plan (§2), utilisées quand le module du code n'est pas encore fusionné ──
const PLAN = {
    motifs: ['affirmee', 'question', 'lot', 'introuvable', 'sans-prix', 'panne', 'plafond-jour', 'administrateur'],
    questions: ['reverse', 'symbole', 'numero', 'langue', 'premiere-edition', 'visuel'],
    variantes: ['normale', 'reverse', 'holo', 'premiere-edition', 'tampon', 'jumbo'],
    raisons: ['photo-illisible', 'pas-une-carte', 'hors-catalogue', 'plusieurs-cartes-non-separees', 'panne-lecture', 'impression-indeterminee'],
    statutsCarte: ['identifiee', 'a-trancher', 'introuvable'],
    etats: ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'],
    confiance: ['haute', 'moyenne', 'basse']
};
const ens = a => JSON.stringify([...new Set(a)].sort());
const memesEnsembles = (a, b) => Array.isArray(a) && Array.isArray(b) && ens(a) === ens(b);
const diff = (a, b) => ({ enTrop: (a || []).filter(x => !(b || []).includes(x)), manquants: (b || []).filter(x => !(a || []).includes(x)) });
const aller = (o, chemin) => chemin.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

// la comparaison elle-même sait dire NON (un état fabriqué : une liste qui a dérivé)
H.v('memesEnsembles : égalité sans ordre', memesEnsembles(['a', 'b'], ['b', 'a']), true);
H.v('memesEnsembles : un code retiré du schéma est vu', memesEnsembles(['a'], ['a', 'b']), false);
H.v('memesEnsembles : un code de plus dans le schéma est vu', memesEnsembles(['a', 'b', 'c'], ['a', 'b']), false);

// ── 1. l'enveloppe ──
H.vrai('OpenAPI 3.1', /^3\.1\.\d+$/.test(doc.openapi));
H.v('serveurs : principal puis secours', (doc.servers || []).map(s => s.url), ['https://api.rat-market.fr', 'https://pokemon-proxy-ratnoir666.onrender.com']);
H.v('schéma de sécurité « installation »', aller(doc, 'components.securitySchemes.installation') && { t: doc.components.securitySchemes.installation.type, s: doc.components.securitySchemes.installation.scheme },
    { t: 'http', s: 'bearer' });
H.v('schéma de sécurité « session »', aller(doc, 'components.securitySchemes.session') && { t: doc.components.securitySchemes.session.type, i: doc.components.securitySchemes.session.in, n: doc.components.securitySchemes.session.name },
    { t: 'apiKey', i: 'cookie', n: 'rm_session' });
const ATTENDUS = ['Image', 'Visuel', 'Produit', 'Impression', 'Zone', 'ZoneQuestion', 'Question', 'Choix', 'EtatCarte', 'PrixLive', 'PrixGuide', 'CarteAnalysee', 'Lot', 'RegleVerdict',
    'Facturation', 'Solde', 'Abonnement', 'ReponseAnalyse', 'ReponseQuestion', 'ReponseErreur', 'CompteSession', 'Installation', 'LigneHistorique', 'ReponseCompte',
    'RequeteIdentifier', 'RequeteReponse', 'RequeteRetourLive', 'RequeteInstallation', 'RequeteInscription'];
H.v('schémas attendus tous présents', ATTENDUS.filter(n => !S[n]), []);

// ── 2. le schéma est lisible en entier par NOTRE validateur (mot-clé inconnu, $ref cassé, required sans propriété) ──
let lev = null; try { verifierSchema(doc); } catch (e) { lev = e.message; }
H.v('components.schemas : aucun mot-clé inconnu', lev, null);
const schemasDesChemins = [];
const refsTrouvees = [];
function collecter(x, ou) {
    if (Array.isArray(x)) return x.forEach((y, i) => collecter(y, `${ou}[${i}]`));
    if (x && typeof x === 'object') {
        if (typeof x.$ref === 'string') refsTrouvees.push({ ref: x.$ref, ou });
        for (const [k, v] of Object.entries(x)) collecter(v, `${ou}.${k}`);
    }
}
collecter(doc, '$');
const resoudre = ref => (ref.startsWith('#/') ? ref.slice(2).split('/').reduce((x, k) => (x == null ? undefined : x[k]), doc) : undefined);
H.v('chaque $ref du document résout', refsTrouvees.filter(r => resoudre(r.ref) === undefined).map(r => `${r.ou} → ${r.ref}`), []);
H.vrai(`dénominateur : ${refsTrouvees.length} $ref examinés`, refsTrouvees.length > 30);
const OPERATIONS = [];
for (const [chemin, ops] of Object.entries(doc.paths || {}))
    for (const [methode, op] of Object.entries(ops)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(methode)) continue;
        OPERATIONS.push({ chemin, methode: methode.toUpperCase(), op });
        for (const p of op.parameters || []) schemasDesChemins.push(resoudre(p.$ref || '') ? resoudre(p.$ref).schema : p.schema);
        for (const c of Object.values(aller(op, 'requestBody.content') || {})) schemasDesChemins.push(c.schema);
        for (const r of Object.values(op.responses || {})) {
            for (const c of Object.values(r.content || {})) schemasDesChemins.push(c.schema);
            for (const h of Object.values(r.headers || {})) schemasDesChemins.push(h.schema);
        }
    }
lev = null; try { schemasDesChemins.forEach(s => { if (!s) throw new Error('schéma de chemin absent'); verifierUnSchema(s, doc); }); } catch (e) { lev = e.message; }
H.v(`paths : ${schemasDesChemins.length} schémas de chemins lisibles`, lev, null);
H.vrai(`dénominateur : ${OPERATIONS.length} opérations`, OPERATIONS.length >= 20);
H.v('chaque opération déclare sa sécurité (ouverte = [] écrit, jamais omise)', OPERATIONS.filter(o => !Array.isArray(o.op.security)).map(o => `${o.methode} ${o.chemin}`), []);
H.v('chaque opération a un operationId distinct', new Set(OPERATIONS.map(o => o.op.operationId)).size, OPERATIONS.length);

// ── 3. les listes fermées : schéma ↔ code ──
// (1) codes d'erreur : ensemble pour ensemble avec v2/erreurs.js
const codesSchema = aller(S, 'ReponseErreur.properties.erreur.properties.code.enum');
H.vrai('ReponseErreur.erreur.code.enum existe', Array.isArray(codesSchema));
H.v('codes d\'erreur : schéma = Object.keys(CODES)', diff(codesSchema, Object.keys(CODES)), { enTrop: [], manquants: [] });
H.vrai('codes d\'erreur : égalité d\'ensembles', memesEnsembles(codesSchema, Object.keys(CODES)));

// (2)(3) et autres : le module du code quand il est fusionné, la liste du plan avant. On trouve la liste par son CONTENU (une
// liste qui contient le mot-sentinelle), pas par un nom d'export deviné ; un module présent sans liste reconnaissable ÉCHOUE.
function listeDuCode(module, sentinelle) {
    const chemin = path.join(__dirname, '..', module);
    let m;                                                     // (déclaré ici, affecté plus bas)
    if (!fs.existsSync(chemin)) return { absent: true };      // le module n'est pas fusionné : seul ce cas-là autorise le repli sur la liste du plan
    m = require(chemin);                                       // présent mais cassé : l'exception remonte, le banc échoue
    const trouvees = Object.entries(m).filter(([, v]) => (Array.isArray(v) || v instanceof Set) && [...v].includes(sentinelle)).map(([nom, v]) => ({ nom, liste: [...v] }));
    return { trouvees };
}
function comparerAuCode(nom, listeSchema, module, sentinelle, listePlan) {
    const r = listeDuCode(module, sentinelle);
    if (r.absent) {
        console.log(`   ⚠ ${module} n'est pas encore fusionné : ${nom} comparée à la liste du PLAN seulement`);
        H.v(`${nom} : schéma = liste du plan`, diff(listeSchema, listePlan), { enTrop: [], manquants: [] });
        return;
    }
    H.vrai(`${nom} : ${module} exporte UNE liste reconnaissable (contenant « ${sentinelle} »)`, r.trouvees.length === 1);
    if (r.trouvees.length === 1) H.v(`${nom} : schéma = ${module}.${r.trouvees[0].nom}`, diff(listeSchema, r.trouvees[0].liste), { enTrop: [], manquants: [] });
}
const motifs = aller(S, 'Facturation.properties.motif.enum');
comparerAuCode('Facturation.motif', motifs, 'argent/facturation.js', 'plafond-jour', PLAN.motifs);
H.v('Facturation.motif = liste du plan (§2)', diff(motifs, PLAN.motifs), { enTrop: [], manquants: [] });
H.vrai('Facturation.motif ne contient pas code-maitre', !(motifs || []).includes('code-maitre'));
H.vrai('Facturation.motif contient administrateur', (motifs || []).includes('administrateur'));
const codesQ = aller(S, 'Question.properties.code.enum');
comparerAuCode('Question.code', codesQ, 'identifier/questions.js', 'premiere-edition', PLAN.questions);
H.v('Question.code = liste du plan (§2)', diff(codesQ, PLAN.questions), { enTrop: [], manquants: [] });
// variantes, raisons : le module de B1a quand il existe
// un champ « nullable » s'écrit `type: [..., "null"]` + `enum: [..., null]` (OpenAPI 3.1) : on compare la liste SANS le null, et on exige le null
const liste = chemin => (aller(S, `${chemin}.enum`) || []).filter(x => x !== null);
const nullable = chemin => { const e = aller(S, `${chemin}.enum`) || [], t = aller(S, `${chemin}.type`); return e.includes(null) && Array.isArray(t) && t.includes('null'); };
const variantesEnum = liste('Produit.properties.variante');
comparerAuCode('Produit.variante', variantesEnum, 'identifier/produit.js', 'tampon', PLAN.variantes);
H.vrai('Produit.variante est nullable (on ne devine pas l\'édition, §7 / Q31)', nullable('Produit.properties.variante'));
H.v('Impression.variante = Produit.variante', liste('Impression.properties.variante'), variantesEnum);
H.vrai('Impression.variante est nullable', nullable('Impression.properties.variante'));
// B7b.1 tour 1 (M6) : la liste des causes de non-remboursement a UNE source (sources.js), le schéma la reprend ensemble pour ensemble
const { RAISONS_NON_REMBOURSE } = require('../../sources');
H.v('Facturation.raisonNonRembourse : schéma = RAISONS_NON_REMBOURSE (sources.js)', diff(liste('Facturation.properties.raisonNonRembourse'), [...RAISONS_NON_REMBOURSE]), { enTrop: [], manquants: [] });
H.vrai('Facturation.raisonNonRembourse est nullable', nullable('Facturation.properties.raisonNonRembourse'));
const raisonsCarte = liste('CarteIntrouvable.properties.raison');
comparerAuCode('raison (introuvable)', raisonsCarte, 'identifier/adaptateur.js', 'plusieurs-cartes-non-separees', PLAN.raisons);
H.v('ReponseAnalyse.analyse.raison = mêmes raisons', liste('ReponseAnalyse.properties.analyse.properties.raison'), raisonsCarte);
H.vrai('ReponseAnalyse.analyse.raison est nullable', nullable('ReponseAnalyse.properties.analyse.properties.raison'));
H.v('statut d\'une carte (3 issues)', diff(aller(S, 'CarteAnalysee.oneOf') && S.CarteAnalysee.oneOf.map(r => aller(resoudre(r.$ref), 'properties.statut.const')), PLAN.statutsCarte), { enTrop: [], manquants: [] });
H.v('statut d\'analyse (3 issues + lot)', diff(liste('ReponseAnalyse.properties.analyse.properties.statut'), [...PLAN.statutsCarte, 'lot']), { enTrop: [], manquants: [] });
H.v('états Cardmarket MT NM EX GD LP PL PO', diff(liste('EtatCarte.properties.estime'), PLAN.etats), { enTrop: [], manquants: [] });
H.v('EtatCarte.retenu : mêmes états', liste('EtatCarte.properties.retenu'), liste('EtatCarte.properties.estime'));
H.v('PrixLive.etatVise : mêmes états', liste('PrixLive.properties.etatVise'), liste('EtatCarte.properties.estime'));
H.v('RequeteRetourLive.prixLiveEtat : mêmes états', liste('RequeteRetourLive.properties.prixLiveEtat'), liste('EtatCarte.properties.estime'));
H.v('confiance de l\'état (une chaîne de liste fermée, jamais un score)', diff(liste('EtatCarte.properties.confiance'), PLAN.confiance), { enTrop: [], manquants: [] });
// valeurs de config : la liste du code
H.v('devises : schéma = cfg.devises', diff(aller(S, 'RequeteIdentifier.properties.devise.enum'), cfg.devises), { enTrop: [], manquants: [] });
H.v('imageUrls : au plus cfg.images.imageUrlsMax', aller(S, 'RequeteIdentifier.properties.imageUrls.maxItems'), cfg.images.imageUrlsMax);
H.v('libellé d\'installation : au plus cfg.comptes.libelleMax', aller(S, 'RequeteInstallation.properties.libelle.maxLength'), cfg.comptes.libelleMax);
H.v('mot de passe : cfg.comptes.motDePasseMin caractères au moins', aller(S, 'RequeteInscription.properties.motDePasse.minLength'), cfg.comptes.motDePasseMin);
H.v('code de liaison : cfg.comptes.codeLongueur caractères [A-Z0-9]', aller(S, 'ReponseCodeLiaison.properties.code.pattern'), `^[A-Z0-9]{${cfg.comptes.codeLongueur}}$`);
H.v('lot : lectureLiveMax est un entier', aller(S, 'Lot.properties.lectureLiveMax.type'), 'integer');
// images servies : l'hôte exact du bucket public ou rat-market.fr, jamais autre chose (CONTRAT-2 règle 6)
const motifImage = new RegExp(aller(S, 'Image.properties.url.pattern') || '^$');
for (const h of cfg.images.hotesPublics) H.vrai(`Image.url accepte l'hôte ${h}`, motifImage.test(`https://${h}/vignettes/x.webp`));
for (const mauvais of ['https://www.cardmarket.com/img/x.jpg', 'http://rat-market.fr/x.webp', 'https://evil.example/x.png', 'https://rat-market.fr.evil.example/x.webp', 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev.evil.example/x'])
    H.vrai(`Image.url refuse ${mauvais}`, !motifImage.test(mauvais));
// Idempotency-Key : le motif de CONTRAT-2 §4.1, sur les trois routes qui débitent et sur elles seules
const IDEM = '^[A-Za-z0-9_-]{8,64}$';
H.v('Idempotency-Key : le motif exact', aller(doc, 'components.parameters.IdempotencyKey.schema.pattern'), IDEM);
H.v('Idempotency-Key : en-tête, obligatoire', [aller(doc, 'components.parameters.IdempotencyKey.in'), aller(doc, 'components.parameters.IdempotencyKey.name'), aller(doc, 'components.parameters.IdempotencyKey.required')], ['header', 'Idempotency-Key', true]);
const avecCle = OPERATIONS.filter(o => (o.op.parameters || []).some(p => p.$ref === '#/components/parameters/IdempotencyKey')).map(o => `${o.methode} ${o.chemin}`).sort();
H.v('Idempotency-Key OBLIGATOIRE : /api/identifier seulement (le débit en exige une)', avecCle, ['POST /api/identifier']);
// B1b.5 : /reponse et /retour-live honorent la clé quand elle est donnée mais ne l'exigent pas (leur état — question, garde « un second retour est refusé » — rend un rejeu sûr)
const FAC = 'components.parameters.IdempotencyKeyFacultative';
H.v('Idempotency-Key FACULTATIVE : même nom, même en-tête, même motif, required:false', [aller(doc, `${FAC}.in`), aller(doc, `${FAC}.name`), aller(doc, `${FAC}.required`), aller(doc, `${FAC}.schema.pattern`)], ['header', 'Idempotency-Key', false, IDEM]);
H.vrai('   la description dit POURQUOI elle est facultative', /facultative|non exigée|pas exigée/i.test(String(aller(doc, `${FAC}.description`))) && /rejeu/i.test(String(aller(doc, `${FAC}.description`))));
const avecCleFac = OPERATIONS.filter(o => (o.op.parameters || []).some(p => p.$ref === '#/components/parameters/IdempotencyKeyFacultative')).map(o => `${o.methode} ${o.chemin}`).sort();
H.v('Idempotency-Key facultative sur /reponse et /retour-live, et sur elles seules', avecCleFac, ['POST /api/identifier/reponse', 'POST /api/retour-live']);
// B1b.5 : les deux codes de détail que le serveur émet doivent être DITS au contrat, avec le sens à donner au client (définitif / à réessayer)
const op = (chemin) => OPERATIONS.find(o => o.methode === 'POST' && o.chemin === chemin).op;
const d409 = String(op('/api/retour-live').responses['409'].description), d503 = String(op('/api/identifier/reponse').responses['503'].description);
H.vrai('retour-live 409 : dit `carte-non-identifiee`, refus DÉFINITIF, et le distingue du 409 « déjà complété »', /carte-non-identifiee/.test(d409) && /D[ÉE]FINITIF/i.test(d409) && /d[ée]j[àa] [ée]t[ée] renvoy|d[ée]j[àa] compl[ée]t[ée]/i.test(d409));
H.vrai('reponse 503 : dit `analyse-absente`, question intacte, à RÉESSAYER', /analyse-absente/.test(d503) && /intacte/i.test(d503) && /R[ÉE]ESSAYER/i.test(d503));
// le serveur n'émet que ces détails : ceux du code doivent figurer au contrat (lecture des sources, pas une liste recopiée)
const lire = f => require('fs').readFileSync(require('path').join(__dirname, '..', 'identifier', f), 'utf8');
H.vrai('chaque detail émis par retour-live.js / routes.js (carte-non-identifiee, analyse-absente) figure dans le contrat', /detail: 'carte-non-identifiee'/.test(lire('retour-live.js')) && /detail: 'analyse-absente'/.test(lire('routes.js')) && JSON.stringify(doc).includes('carte-non-identifiee') && JSON.stringify(doc).includes('analyse-absente'));
// le contrat dit ce que le serveur fait : /identifier sans clé => 400 (obligatoire) ; les deux autres routes la déclarent facultative
H.v('aucune des trois routes n\'a de paramètre Idempotency-Key en ligne (tout passe par les deux composants)', OPERATIONS.filter(o => (o.op.parameters || []).some(p => !p.$ref && p.name === 'Idempotency-Key')).length, 0);
// aucun score nulle part (règle 4) : aucune propriété nommée score / confiance numérique dans les schémas
const nomsProps = [];
(function parcourir(x) { if (Array.isArray(x)) x.forEach(parcourir); else if (x && typeof x === 'object') { if (x.properties) nomsProps.push(...Object.keys(x.properties)); Object.values(x).forEach(parcourir); } })(S);
H.v('aucune propriété « score » dans le contrat (règle 4)', nomsProps.filter(n => /score/i.test(n)), []);
H.v('EtatCarte.confiance n\'est pas un nombre', JSON.stringify(S.EtatCarte.properties.confiance).includes('"number"'), false);
// les réponses du contrat sont FERMÉES : additionalProperties:false sur chaque schéma de réponse
const FERMES = ['Image', 'Visuel', 'Produit', 'Impression', 'Zone', 'ZoneQuestion', 'Question', 'Choix', 'EtatCarte', 'PrixLive', 'PrixGuide', 'CarteIdentifiee', 'CarteATrancher', 'CarteIntrouvable', 'Lot', 'RegleVerdict',
    'Facturation', 'Solde', 'Abonnement', 'ReponseAnalyse', 'ReponseQuestion', 'ReponseErreur', 'CompteSession', 'Installation', 'ReponseCompte'];
H.v('les schémas de réponse refusent les clés en trop', FERMES.filter(n => !S[n] || S[n].additionalProperties !== false), []);

// ── 4. (5) chaque route de `paths` existe dans le code (le routeur v2 monté) — un contrat qui promet une route inexistante n'est pas publiable ──
// Avant la fusion des lots B1b/B2 le routeur est vide : ce banc LISTE les routes manquantes et sort en code 1, par construction.
const express = require('express');
const v2 = require('../index');
function routesMontees(app) {
    const out = new Set();
    (function lire(pile) {
        for (const l of pile || []) {
            if (l.route) for (const m of Object.keys(l.route.methods)) out.add(`${m.toUpperCase()} ${l.route.path.replace(/:([A-Za-z]+)/g, '{$1}')}`);
            else if (l.name === 'router' && l.handle && l.handle.stack) lire(l.handle.stack);
        }
    })(app._router && app._router.stack);
    return out;
}
// le lecteur de routes sait lire un routeur imbriqué (sinon « 0 route montée » serait un vide fabriqué par la sonde)
{
    const fausse = express(), r = express.Router();
    r.post('/api/x/:id', (q, s) => s.end()); r.get('/api/y', (q, s) => s.end());
    fausse.use(r); fausse.get('/ping', (q, s) => s.end());
    H.v('routesMontees : lit un routeur imbriqué et les paramètres', [...routesMontees(fausse)].sort(), ['GET /api/y', 'GET /ping', 'POST /api/x/{id}']);
}
const app = express();
v2.monter(app, {}, { RM_API_V2: '1', MONGODB_BASE: 'test_scratch' });   // sans base de bac, la config v2 exige V2_SECRET_EMPREINTE (B2) et aucune route ne monte
v2.arreter();
const montees = routesMontees(app);
const promesses = OPERATIONS.filter(o => !o.op['x-heritee']);
console.log(`   routes montées par le routeur v2 : ${montees.size} ; promises par le contrat : ${promesses.length} (dont ${promesses.filter(o => o.op['x-conditionnel']).length} conditionnelles)`);
// Intégration PARTIELLE (INT1) : les lots B1b (identifier, reponse, retour-live) et B3 (solde) ne sont pas encore montés. Tant que cette
// liste est non vide, les routes absentes doivent en être EXACTEMENT l'ensemble (ni une de plus, ni une de moins) et tout le reste doit passer.
// Liste VIDE (à vider quand B1b et B3 sont fusionnés) ou `--complet` : mode strict, toute route promise doit être montée.
// (Remplace RM_OPENAPI_AVANT_FUSION, une variable d'environnement qui n'existait que pour passer avant la fusion des lots.)
const ATTENDUES_ABSENTES = [];   // B1b.3 a monté POST /api/identifier ; B1b.5 monte /api/identifier/reponse, /api/retour-live et /api/solde : plus aucune route attendue absente
const AVANT_FUSION = ATTENDUES_ABSENTES.length > 0 && !process.argv.includes('--complet');
const absentes = promesses.filter(o => !o.op['x-conditionnel'] && !montees.has(`${o.methode} ${o.chemin}`)).map(o => `${o.methode} ${o.chemin}`).sort();
for (const o of promesses.filter(o => o.op['x-conditionnel'] && !montees.has(`${o.methode} ${o.chemin}`))) console.log(`   ⚠ route conditionnelle non montée (${o.op['x-conditionnel']}) : ${o.methode} ${o.chemin}`);
if (AVANT_FUSION) {
    console.log(`   MODE INTÉGRATION PARTIELLE — routes absentes attendues (${ATTENDUES_ABSENTES.length}) :\n     ${ATTENDUES_ABSENTES.join('\n     ')}`);
    for (const o of promesses.filter(o => !o.op['x-conditionnel'] && !ATTENDUES_ABSENTES.includes(`${o.methode} ${o.chemin}`))) H.vrai(`route montée : ${o.methode} ${o.chemin}`, montees.has(`${o.methode} ${o.chemin}`));
    H.v(`avant fusion : les routes absentes sont EXACTEMENT les ${ATTENDUES_ABSENTES.length} écrites`, { absenteNonListee: absentes.filter(r => !ATTENDUES_ABSENTES.includes(r)), listeeMaisPresente: ATTENDUES_ABSENTES.filter(r => !absentes.includes(r)) }, { absenteNonListee: [], listeeMaisPresente: [] });
} else {
    for (const o of promesses.filter(o => !o.op['x-conditionnel'])) H.vrai(`route montée : ${o.methode} ${o.chemin}`, montees.has(`${o.methode} ${o.chemin}`));
}
// toute route qui accepte Idempotency-Key documente 422 (clé réutilisée avec un autre corps) et 429 (même clé en cours)
for (const o of OPERATIONS.filter(o => (o.op.parameters || []).some(p => /^#\/components\/parameters\/IdempotencyKey(Facultative)?$/.test(p.$ref || ''))))
    H.v(`${o.methode} ${o.chemin} documente 422 et 429`, ['422', '429'].filter(s => !(o.op.responses || {})[s]), []);
H.bilan();

'use strict';
// GALERIE — CONFORMITÉ des formes de réponse : chaque route de la liste fermée du site est appelée pour de vrai (base en mémoire, faux R2, faux Turnstile), et sa réponse est validée
//   (1) contre le schéma de l'OpenAPI (`openapi.v2.json`, celui qui fait foi) retrouvé par chemin + méthode + statut, avec le validateur du dépôt (il dit NON : une clé en trop, un type faux) ;
//   (2) contre la forme LITTÉRALE de l'entrée du site (DEMANDE-SERVEUR-SITE.md, RELANCE du 2026-11-01) : clés exactes, `facturation: null`, `429 LIMITE_DEBIT` + `reessayerDans`, `404 INTROUVABLE` uniforme, `jaime: null` et `petitCompteur: true` sous 5.
// Un banc qui valide contre un schéma qu'il a écrit lui-même ne prouve rien : le schéma est lu du fichier publié, et il est confronté aux observations.
const A = require('./_aide-galerie');
const H = A.H;
const mongoose = require('mongoose'), express = require('express'), sharp = require('sharp');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const { lireGalerie } = require('../galerie/config');
const OPENAPI = require('../openapi/openapi.v2.json'); const { valider } = require('../openapi/valider');

(async () => {
    await H.ouvrirBac('test-galerie-conformite.js');
    await M.creerIndex(); H.fixerHorlogeMilieu();
    const G = require('../galerie/base'), svc = require('../galerie/service'), F = require('../galerie/forme'), routes = require('../galerie/routes');
    const pret = require('../pret'); const { assembler } = require('../index'); const transport = require('../transport/monter'); const sessions = require('../comptes/sessions');
    const dbG = mongoose.connection.client.db('rm_galerie_essai'); G.brancher(dbG); await G.creerIndex();
    const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), galerie: lireGalerie(A.ENV_VALIDE) };
    const SITE = cfg.origines.site;
    const stockage = A.fauxStockage(), turnstile = A.fauxTurnstile();
    const app = express(); app.set('trust proxy', true); transport.enTete(app, cfg); app.use(express.json()); pret.armer(M.verifierIndex);
    app.use(assembler([{ enTete() { }, routes(r, c, d) { routes.routesGalerie(r, c, { ...d, stockage, fetchTurnstile: turnstile, env: A.ENV_VALIDE }); } }], cfg, {}));
    const sv = await H.serveur(app);
    let n = 0, nIp = 0; const IP = () => `10.88.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}`;
    async function compte(pseudo, o = {}) { const ad = `conf${++n}.${Date.now().toString(36)}@exemple.fr`; const c = Object.assign(M.nouveauCompte({ email: ad, emailCle: ad, motDePasse: {} }), { verifie: true }, o); await db.col('comptes').insertOne(c); const s = await sessions.creerSession(c._id); if (pseudo) await svc.poserPseudo(String(c._id), pseudo); return { id: String(c._id), cookie: `rm_session=${s.token}` }; }
    const appel = (methode, chemin, { c, corps, sansSite } = {}) => H.appel(sv.url, chemin, { methode, corps, entetes: { 'x-forwarded-for': IP(), ...(sansSite ? {} : { origin: SITE, 'x-rat-market': '1' }), ...(c ? { cookie: c.cookie } : {}) } });

    // ── ce que le contrat publié dit d'une route : le schéma de la réponse (chemin + méthode + statut)
    const schemaDe = (modele, methode, statut) => { const op = OPENAPI.paths[modele] && OPENAPI.paths[modele][methode.toLowerCase()]; const r = op && op.responses[String(statut)]; return r && r.content && r.content['application/json'].schema; };
    const verifier = (nom, modele, methode, r) => {
        const s = schemaDe(modele, methode, r.statut);
        if (!s) { H.v(`${nom} : le statut ${r.statut} est DOCUMENTÉ par le contrat pour ${methode} ${modele}`, false, true); return; }
        const v = valider(r.json, s, OPENAPI);
        H.v(`${nom} : ${r.statut}, conforme au schéma publié de ${methode} ${modele}`, v.ok ? [] : v.erreurs.slice(0, 3), []);
    };

    const luma = await compte('luma'), noa = await compte('noa'), modo = await compte('modo-conf', { role: 'moderateur' }), sansPseudo = await compte(null);
    const idPub = await svc.publierPourExploitation({ auteurId: luma.id, titre: 'Page Michi', categories: ['methode-michi'], n: 3, pages: 2, arts: [{ art: F.nouvelId(), col: 0, row: 0, fmt: '2h' }], cartes: [{ cle: '1234|001', nom: 'Pikachu' }, null],
        pagesSuite: [{ n: 2, arts: [], cartes: [{ cle: '1234|002', nom: 'Raichu' }] }], attributs: { couleur: ['jaune'], type: ['electrique'], illustrateur: ['Arita'], set: ['Base-Set'] }, certification: { cgu: '2026-10' }, etat: 'public' });
    const attenteId = await svc.publierPourExploitation({ auteurId: luma.id, titre: 'Attente', categories: ['couleur'], n: 3, pages: 1, arts: [], cartes: [], etat: 'en-attente' });

    // ═══ A. lecture ═══
    verifier('A1 GET /api/galerie', '/api/galerie', 'GET', await H.appel(sv.url, '/api/galerie', { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A1 GET /api/galerie (filtres de requête)', '/api/galerie', 'GET', await H.appel(sv.url, '/api/galerie?categorie=methode-michi&tri=tendances&set=Base-Set&carte=1234', { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A2 GET /api/galerie/filtres', '/api/galerie/filtres', 'GET', await H.appel(sv.url, '/api/galerie/filtres', { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A3 GET /api/galerie/{id}/pages/{n}', '/api/galerie/{id}/pages/{n}', 'GET', await H.appel(sv.url, `/api/galerie/${idPub}/pages/2`, { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A3 la page absente (en attente)', '/api/galerie/{id}/pages/{n}', 'GET', await H.appel(sv.url, `/api/galerie/${attenteId}/pages/1`, { entetes: { 'x-forwarded-for': IP() } }));
    // un art accepté
    const png = await sharp({ create: { width: 300, height: 419, channels: 3, background: { r: 9, g: 99, b: 199 } } }).png().toBuffer();
    const o = await appel('POST', '/api/illustrations/depot', { c: noa, corps: { type: 'image/png', octets: png.length } });
    verifier('C1 POST /api/illustrations/depot', '/api/illustrations/depot', 'POST', o);
    stockage.deposer(o.json.urlDepot, png);
    const fin = await appel('POST', `/api/illustrations/depot/${o.json.depotId}/finaliser`, { c: noa, corps: { nom: 'Mon art', format: '1', certifieDroits: true, certifieNonOfficielle: true } });
    verifier('C3 POST …/finaliser', '/api/illustrations/depot/{depot}/finaliser', 'POST', fin);
    H.v('   C : les clés du site au caractère près', [Object.keys(o.json), Object.keys(fin.json), fin.json.statut], [['success', 'depotId', 'urlDepot', 'expireDans'], ['success', 'id', 'statut'], 'en-attente']);
    verifier('C3 un refus de fichier (SVG)', '/api/illustrations/depot/{depot}/finaliser', 'POST', await (async () => { const o2 = await appel('POST', '/api/illustrations/depot', { c: noa, corps: { type: 'image/png', octets: 60 } }); stockage.deposer(o2.json.urlDepot, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'.padEnd(60, ' '))); return appel('POST', `/api/illustrations/depot/${o2.json.depotId}/finaliser`, { c: noa, corps: { nom: 'x', format: '1', certifieDroits: true, certifieNonOfficielle: true } }); })());
    verifier('C1 un refus de type', '/api/illustrations/depot', 'POST', await appel('POST', '/api/illustrations/depot', { c: noa, corps: { type: 'image/svg+xml', octets: 60 } }));
    const dec = await appel('POST', `/api/admin/moderation/art.${fin.json.id}/decision`, { c: modo, corps: { decision: 'accepter' } });
    verifier('E2 POST …/decision', '/api/admin/moderation/{id}/decision', 'POST', dec);
    verifier('A4 GET /api/banque', '/api/banque', 'GET', await H.appel(sv.url, '/api/banque?format=1&q=art&tri=top', { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A5 GET /api/banque/formats', '/api/banque/formats', 'GET', await H.appel(sv.url, '/api/banque/formats', { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A6 GET /api/illustrations/bornes', '/api/illustrations/bornes', 'GET', await H.appel(sv.url, '/api/illustrations/bornes', { entetes: { 'x-forwarded-for': IP() } }));
    const art = (await H.appel(sv.url, '/api/banque', { entetes: { 'x-forwarded-for': IP() } })).json.arts[0];
    H.v('   A : un Art a exactement les clés du site, une url R2 publique, aime null sous 5 avec petitCompteur true', [Object.keys(art), art.url.startsWith(stockage.urlPublique + '/galerie/pub/'), art.aime, art.petitCompteur], [['id', 'nom', 'fmt', 'auteur', 'aime', 'petitCompteur', 'url', 'largeur', 'hauteur'], true, null, true]);

    // ═══ B. votes, enregistrements, remix, pseudo ═══
    verifier('B1 PUT …/jaime (page)', '/api/classeurs/{id}/jaime', 'PUT', await appel('PUT', `/api/classeurs/${idPub}/jaime`, { c: noa }));
    verifier('B1 DELETE …/jaime (page)', '/api/classeurs/{id}/jaime', 'DELETE', await appel('DELETE', `/api/classeurs/${idPub}/jaime`, { c: noa }));
    verifier('B2 PUT …/enregistre (page)', '/api/classeurs/{id}/enregistre', 'PUT', await appel('PUT', `/api/classeurs/${idPub}/enregistre`, { c: noa }));
    verifier('B2 DELETE …/enregistre (page)', '/api/classeurs/{id}/enregistre', 'DELETE', await appel('DELETE', `/api/classeurs/${idPub}/enregistre`, { c: noa }));
    verifier('B3 PUT …/jaime (art)', '/api/illustrations/{id}/jaime', 'PUT', await appel('PUT', `/api/illustrations/${art.id}/jaime`, { c: luma }));
    verifier('B3 DELETE …/jaime (art)', '/api/illustrations/{id}/jaime', 'DELETE', await appel('DELETE', `/api/illustrations/${art.id}/jaime`, { c: luma }));
    verifier('B3 PUT …/enregistre (art)', '/api/illustrations/{id}/enregistre', 'PUT', await appel('PUT', `/api/illustrations/${art.id}/enregistre`, { c: luma }));
    verifier('B3 DELETE …/enregistre (art)', '/api/illustrations/{id}/enregistre', 'DELETE', await appel('DELETE', `/api/illustrations/${art.id}/enregistre`, { c: luma }));
    verifier('B4 GET /api/enregistres', '/api/enregistres', 'GET', await appel('GET', '/api/enregistres', { c: noa, sansSite: true }));
    verifier('B5 POST …/remix', '/api/galerie/{id}/remix', 'POST', await appel('POST', `/api/galerie/${idPub}/remix`, { c: noa }));
    verifier('B6 PUT /api/compte/pseudo', '/api/compte/pseudo', 'PUT', await appel('PUT', '/api/compte/pseudo', { c: sansPseudo, corps: { pseudo: 'nouveau-pseudo' } }));
    verifier('B6 pseudo pris', '/api/compte/pseudo', 'PUT', await appel('PUT', '/api/compte/pseudo', { c: luma, corps: { pseudo: 'noa' } }));
    const propre = await appel('PUT', `/api/classeurs/${idPub}/jaime`, { c: luma });
    verifier('B  sur sa propre création (403 INTERDIT pas-l-auteur)', '/api/classeurs/{id}/jaime', 'PUT', propre);
    H.v('   B : { erreur: { code: INTERDIT, detail: pas-l-auteur }, facturation: null }', [propre.json.erreur.code, propre.json.erreur.detail, propre.json.facturation], ['INTERDIT', 'pas-l-auteur', null]);

    // ═══ D. signalement ═══
    const sig = (corps, c) => H.appel(sv.url, '/api/signalements', { methode: 'POST', corps, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP(), ...(c ? { cookie: c.cookie } : {}) } });
    const s1 = await sig({ cible: `galerie:${idPub}`, motif: 'droits', turnstile: 'jeton-valide' });
    verifier('D1 POST /api/signalements', '/api/signalements', 'POST', s1);
    H.v('   D : 201 { success: true } exactement', [s1.statut, s1.json], [201, { success: true }]);
    verifier('D1 sans jeton', '/api/signalements', 'POST', await sig({ cible: `galerie:${idPub}`, motif: 'droits' }));

    // ═══ E. modération ═══
    verifier('E1 GET /api/admin/moderation?file=publications', '/api/admin/moderation', 'GET', await appel('GET', '/api/admin/moderation?file=publications', { c: modo, sansSite: true }));
    const fileSig = await appel('GET', '/api/admin/moderation?file=signalements', { c: modo, sansSite: true });
    verifier('E1 GET /api/admin/moderation?file=signalements', '/api/admin/moderation', 'GET', fileSig);
    H.v('   E : un élément de la file des signalements porte les clés du site', Object.keys(fileSig.json.elements[0]), ['id', 'file', 'genre', 'cible', 'auteur', 'certification', 'signalements', 'recuLe', 'echeance']);
    verifier('E1 refus sans le rôle', '/api/admin/moderation', 'GET', await appel('GET', '/api/admin/moderation?file=publications', { c: noa, sansSite: true }));
    verifier('E2 décision sur un élément absent', '/api/admin/moderation/{id}/decision', 'POST', await appel('POST', `/api/admin/moderation/pub.${F.nouvelId()}/decision`, { c: modo, corps: { decision: 'accepter' } }));

    // ═══ les refus transverses ═══
    const sans = await H.appel(sv.url, `/api/classeurs/${idPub}/jaime`, { methode: 'PUT', entetes: { 'x-forwarded-for': IP() } });
    verifier('401 SESSION', '/api/classeurs/{id}/jaime', 'PUT', sans);
    verifier('403 ORIGINE', '/api/classeurs/{id}/jaime', 'PUT', await appel('PUT', `/api/classeurs/${idPub}/jaime`, { c: noa, sansSite: true }));
    verifier('403 pseudo-requis', '/api/classeurs/{id}/jaime', 'PUT', await appel('PUT', `/api/classeurs/${idPub}/jaime`, { c: await compte(null) }));
    const cfgLim = { ...cfg, galerie: { ...cfg.galerie, limites: { ...cfg.galerie.limites, lectureIpHeure: 1 } } };
    const app2 = express(); app2.set('trust proxy', true); transport.enTete(app2, cfgLim); app2.use(express.json());
    app2.use(assembler([{ enTete() { }, routes(r, c, d) { routes.routesGalerie(r, c, { ...d, stockage, fetchTurnstile: turnstile, env: A.ENV_VALIDE }); } }], cfgLim, {}));
    const sv2 = await H.serveur(app2); const ipL = '10.99.9.9';
    await H.appel(sv2.url, '/api/banque/formats', { entetes: { 'x-forwarded-for': ipL } });
    const lim = await H.appel(sv2.url, '/api/banque/formats', { entetes: { 'x-forwarded-for': ipL } });
    verifier('429 LIMITE_DEBIT', '/api/banque/formats', 'GET', lim);
    H.v('   429 : code LIMITE_DEBIT, reessayerDans entier ≥ 1, Retry-After, facturation null', [lim.statut, lim.json.erreur.code, Number.isInteger(lim.json.erreur.reessayerDans) && lim.json.erreur.reessayerDans >= 1, lim.entetes['retry-after'] === String(lim.json.erreur.reessayerDans), lim.json.facturation], [429, 'LIMITE_DEBIT', true, true, null]);
    const abs = await H.appel(sv.url, `/api/galerie/${F.nouvelId()}/pages/1`, { entetes: { 'x-forwarded-for': IP() } });
    const attenteR = await H.appel(sv.url, `/api/galerie/${attenteId}/pages/1`, { entetes: { 'x-forwarded-for': IP() } });
    H.v('   404 INTROUVABLE uniforme : l\'absent et l\'en-attente ont le même corps, code INTROUVABLE, facturation null', [abs.texte === attenteR.texte, abs.json.erreur.code, abs.json.facturation], [true, 'INTROUVABLE', null]);

    // ═══ le contrat publié lui-même ═══
    const galerie = Object.entries(OPENAPI.paths).flatMap(([chemin, ops]) => Object.entries(ops).filter(([, op]) => op && op.tags && op.tags.includes('galerie')).map(([m, op]) => ({ chemin, m, op })));
    H.v('le contrat publie 22 opérations de la Communauté, chacune conditionnelle à V2_GALERIE=1, avec sa sécurité déclarée', [galerie.length, galerie.every(o => /V2_GALERIE=1/.test(o.op['x-conditionnel'])), galerie.every(o => Array.isArray(o.op.security))], [22, true, true]);
    H.v('   les écritures déclarent X-Rat-Market ; les lectures publiques ne déclarent aucune sécurité', [galerie.filter(o => ['put', 'post', 'delete'].includes(o.m)).every(o => (o.op.parameters || []).some(p => p.$ref === '#/components/parameters/XRatMarket')), galerie.filter(o => o.m === 'get' && !/enregistres|moderation/.test(o.chemin)).every(o => o.op.security.length === 0)], [true, true]);
    H.v('   les quatre codes nouveaux sont dans la liste fermée des codes d\'erreur', ['INTERDIT', 'INTROUVABLE', 'FICHIER', 'LIMITE_DEBIT'].filter(c => !OPENAPI.components.schemas.ReponseErreur.properties.erreur.properties.code.enum.includes(c)), []);
    H.vrai('   les exemples du contrat valident (Publication)', valider({ id: 'k3J9x0Qw2m8LzTfA1bC4dE', pseudo: 'luma', publieLe: '2026-11-01T10:00:00.000Z', titre: 'Page Michi', categories: ['methode-michi', 'couleur'], n: 3, pages: 2, jaime: null, petitCompteur: true, arts: [{ art: 'Zy9x8W7v6U5t4S3r2Q1pOn', col: 0, row: 0, fmt: '2h' }], cartes: [{ cle: '1234|001', nom: 'Pikachu' }, null] }, OPENAPI.components.schemas.Publication, OPENAPI).ok);
    // le validateur sait dire NON sur ces schémas (une clé en trop, un type faux, un nombre à la place du null arrondi)
    H.v('   le validateur dit NON : clé en trop, type faux, champ manquant', [
        valider({ ...s1.json, extra: 1 }, OPENAPI.components.schemas.ReponseSignalement, OPENAPI).ok,
        valider({ success: true, jaime: 'oui', compteur: null, petitCompteur: true }, OPENAPI.components.schemas.ReponseJaime, OPENAPI).ok,
        valider({ success: true, octetsMax: 5 }, OPENAPI.components.schemas.ReponseBornesIllustrations, OPENAPI).ok], [false, false, false]);
    await sv.fermer(); await sv2.fermer(); await dbG.dropDatabase();
    await H.fermerBac();
    H.bilan();
})();

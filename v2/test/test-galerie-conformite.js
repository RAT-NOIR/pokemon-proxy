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
    const JOUEES = new Set();
    const verifier = (nom, modele, methode, r) => {
        JOUEES.add(`${methode.toUpperCase()} ${modele} ${r.statut}`);
        const s = schemaDe(modele, methode, r.statut);
        if (!s) { H.v(`${nom} : le statut ${r.statut} est DOCUMENTÉ par le contrat pour ${methode} ${modele}`, false, true); return; }
        const v = valider(r.json, s, OPENAPI);
        H.v(`${nom} : ${r.statut}, conforme au schéma publié de ${methode} ${modele}`, v.ok ? [] : v.erreurs.slice(0, 3), []);
    };

    const luma = await compte('luma'), noa = await compte('noa'), modo = await compte('modo-conf', { role: 'moderateur' }), sansPseudo = await compte(null);
    const artPose = F.nouvelId();      // un art public RÉEL : la pose d'une page exige qu'il existe
    await dbG.collection('arts').insertOne({ _id: artPose, etat: 'public', auteurId: luma.id, pseudo: 'luma', nom: 'Art posé', mots: ['art', 'pose', 'luma'], fmt: '2h', clePublique: `galerie/pub/${artPose}`, largeur: 400, hauteur: 279, nbJaime: 0, nbEnregistre: 0, publieLe: new Date() });
    const idPub = await svc.publierPourExploitation({ auteurId: luma.id, titre: 'Page Michi', categories: ['methode-michi'], nb: 9, pages: 2, arts: [{ art: artPose, col: 0, row: 0, fmt: '2h' }], cartes: [{ cle: '1234|001', nom: 'Pikachu' }, null],
        pagesSuite: [{ n: 2, arts: [], cartes: [{ cle: '1234|002', nom: 'Raichu' }] }], attributs: { couleur: ['jaune'], type: ['electrique'], illustrateur: ['Arita'], set: ['Base-Set'] }, certification: { cgu: '2026-10' }, etat: 'public' });
    const attenteId = await svc.publierPourExploitation({ auteurId: luma.id, titre: 'Attente', categories: ['couleur'], nb: 9, pages: 1, arts: [], cartes: [], etat: 'en-attente' });

    // ═══ A. lecture ═══
    verifier('A1 GET /api/galerie', '/api/galerie', 'GET', await H.appel(sv.url, '/api/galerie', { entetes: { 'x-forwarded-for': IP() } }));
    verifier('A1 GET /api/galerie (filtres de requête)', '/api/galerie', 'GET', await H.appel(sv.url, '/api/galerie?categorie=methode-michi&tri=tendances&set=Base-Set&carte=1234', { entetes: { 'x-forwarded-for': IP() } }));
    {   // C-I1 : les arts POSÉS portent url, largeur, hauteur (correction 3 du site), sur le fil ET sur la page
        const fil = (await H.appel(sv.url, '/api/galerie', { entetes: { 'x-forwarded-for': IP() } })).json.publications[0].arts[0];
        const pg = (await H.appel(sv.url, `/api/galerie/${idPub}/pages/1`, { entetes: { 'x-forwarded-for': IP() } })).json.page.arts[0];
        H.v('   A : un art posé a EXACTEMENT { art, col, row, fmt, url, largeur, hauteur } (fil et page)', [Object.keys(fil), Object.keys(pg), fil.url.startsWith(stockage.urlPublique + '/galerie/pub/'), fil.largeur, fil.hauteur], [['art', 'col', 'row', 'fmt', 'url', 'largeur', 'hauteur'], ['art', 'col', 'row', 'fmt', 'url', 'largeur', 'hauteur'], true, 400, 279]);
    }
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

    // ═══ L9. les classeurs privés de l'Atelier : chaque réponse validée contre le schéma publié ═══
    const page9 = (cle = '1234|001') => ({ nb: 9, blocs: [{ c: 0, r: 0, l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle, setSlug: 'Base-Set' } }, { c: 0, r: 1, l: 2, h: 1, genre: 'art', contenu: { type: 'art', artId: artPose } }] });
    const cc = await appel('POST', '/api/classeurs', { c: luma, corps: { titre: 'Conformité', etiquettes: ['michi'], couleur: 'jaune', pages: [page9(), { nb: 4, blocs: [] }] } });
    verifier('L9 POST /api/classeurs', '/api/classeurs', 'POST', cc);
    const idJeu = cc.json.classeur.id;
    verifier('L9 GET /api/classeurs', '/api/classeurs', 'GET', await appel('GET', '/api/classeurs', { c: luma, sansSite: true }));
    verifier('L9 GET /api/classeurs/{id} (l\'auteur)', '/api/classeurs/{id}', 'GET', await appel('GET', `/api/classeurs/${idJeu}`, { c: luma, sansSite: true }));
    H.v('   L9 : les clés du Classeur au caractère près', Object.keys(cc.json.classeur), ['id', 'titre', 'etiquettes', 'couleur', 'couverture', 'pages', 'visibilite', 'motif', 'repriseDe', 'version', 'creeLe', 'majLe']);
    const maj9 = await appel('PUT', `/api/classeurs/${idJeu}`, { c: luma, corps: { version: 1, titre: 'Conformité 2', pages: [page9('1234|002')] } });
    verifier('L9 PUT /api/classeurs/{id}', '/api/classeurs/{id}', 'PUT', maj9);
    const perime = await appel('PUT', `/api/classeurs/${idJeu}`, { c: luma, corps: { version: 1, titre: 'Périmé', pages: [page9()] } });
    verifier('L9 PUT version périmée (409)', '/api/classeurs/{id}', 'PUT', perime);
    H.v('   L9 : 409 CONFLIT version avec versionActuelle', [perime.json.erreur.code, perime.json.erreur.detail, perime.json.erreur.versionActuelle], ['CONFLIT', 'version', 2]);
    {
        const gros = { version: 2, titre: 'Gros', pages: Array.from({ length: 45 }, (_, k) => ({ nb: 16, blocs: Array.from({ length: 16 }, (_, i) => ({ c: i % 4, r: Math.floor(i / 4), l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle: `1234|${100 + k}`, setSlug: 'Base-Set' } })) })) };
        verifier('L9 PUT corps de plus de 64 Ko (413)', '/api/classeurs/{id}', 'PUT', await appel('PUT', `/api/classeurs/${idJeu}`, { c: luma, corps: gros }));
        verifier('L9 POST corps de plus de 64 Ko (413)', '/api/classeurs', 'POST', await appel('POST', '/api/classeurs', { c: luma, corps: gros }));
    }
    const pub9 = await appel('POST', `/api/classeurs/${idJeu}/publication`, { c: luma, corps: { certifieAuteur: true, cgu: '2026-10', categories: ['couleur'] } });
    verifier('L9 POST …/publication', '/api/classeurs/{id}/publication', 'POST', pub9);
    H.v('   L9 : la publication rend le classeur « en-attente » ; un autre lecteur n\'y lit rien (404)', [pub9.json.classeur.visibilite, (await H.appel(sv.url, `/api/classeurs/${idJeu}`, { entetes: { 'x-forwarded-for': IP(), origin: SITE } })).statut], ['en-attente', 404]);
    await appel('POST', `/api/admin/moderation/pub.${idJeu}/decision`, { c: modo, corps: { decision: 'accepter' } });
    const lecturePublique = await H.appel(sv.url, `/api/classeurs/${idJeu}`, { entetes: { 'x-forwarded-for': IP(), origin: SITE } });
    verifier('L9 GET /api/classeurs/{id} (le public, après acceptation)', '/api/classeurs/{id}', 'GET', lecturePublique);
    H.v('   L9 : la lecture publique porte l\'auteur (pseudo) et se met en cache', [lecturePublique.json.classeur.auteur, lecturePublique.entetes['cache-control']], [{ pseudo: 'luma' }, 'public, max-age=60']);
    verifier('L9 POST …/publication sans certification (400)', '/api/classeurs/{id}/publication', 'POST', await appel('POST', `/api/classeurs/${idJeu}/publication`, { c: luma, corps: { cgu: '2026-10' } }));
    verifier('L9 DELETE …/publication', '/api/classeurs/{id}/publication', 'DELETE', await appel('DELETE', `/api/classeurs/${idJeu}/publication`, { c: luma }));
    verifier('L9 DELETE /api/classeurs/{id}', '/api/classeurs/{id}', 'DELETE', await appel('DELETE', `/api/classeurs/${idJeu}`, { c: luma }));
    const idCl = (await appel('POST', '/api/classeurs', { c: luma, corps: { titre: 'Pour les refus', pages: [page9()] } })).json.classeur.id;     // jamais modifié par luma : les refus des autres comptes le visent

    // ═══ L10. la bibliothèque d'illustrations privées : chaque réponse validée contre le schéma publié ═══
    const artFabrique = async (auteur, pseudo, etat = 'prive') => {
        const id = F.nouvelId();
        await dbG.collection('arts').insertOne({ _id: id, auteurId: auteur.id, pseudo, nom: `Art ${etat}`, mots: ['art', etat], fmt: '1', largeur: 300, hauteur: 419, couleur: '#1478dc', poids: 1000, cle: `galerie/attente/${id}`, clePublique: `galerie/pub/${id}`,
            etat, recuLe: new Date(), creeLe: new Date(), publieLe: null, nbJaime: 0, nbEnregistre: 0, motif: null, certification: null, depotId: null });
        if (etat === 'prive') for (const k of [`galerie/attente/${id}.webp`, `galerie/attente/${id}-480.webp`]) stockage.poser(k, Buffer.from('image-fabriquee'));
        return id;
    };
    const idPriv = await artFabrique(noa, 'noa'), idPub2 = await artFabrique(luma, 'luma'), idRef = await artFabrique(luma, 'luma', 'refuse');
    const lib = await appel('GET', '/api/illustrations', { c: noa, sansSite: true });
    verifier('L10 GET /api/illustrations', '/api/illustrations', 'GET', lib);
    H.v('   L10 : les clés de l\'Illustration au caractère près', Object.keys(lib.json.illustrations[0]), ['id', 'titre', 'format', 'largeur', 'hauteur', 'couleur', 'image', 'vignette', 'artisteDeclare', 'ambiances', 'formats', 'visibilite', 'motif', 'creeLe']);
    verifier('L10 PUT /api/illustrations/{id}', '/api/illustrations/{id}', 'PUT', await appel('PUT', `/api/illustrations/${idPriv}`, { c: noa, corps: { titre: 'Privée 2', ambiances: ['douce'], formats: ['3x3'] } }));
    verifier('L10 PUT d\'un art public : titre figé (409)', '/api/illustrations/{id}', 'PUT', await appel('PUT', `/api/illustrations/${art.id}`, { c: noa, corps: { titre: 'Autre titre' } }));
    const pubI = await appel('POST', `/api/illustrations/${idPub2}/publication`, { c: luma, corps: { certifieAuteur: true, cgu: '2026-10', ambiances: ['mer'] } });
    verifier('L10 POST …/publication (illustration)', '/api/illustrations/{id}/publication', 'POST', pubI);
    H.v('   L10 : la publication rend l\'illustration « en-attente »', pubI.json.illustration.visibilite, 'en-attente');
    verifier('L10 POST …/publication d\'une illustration refusée (409)', '/api/illustrations/{id}/publication', 'POST', await appel('POST', `/api/illustrations/${idRef}/publication`, { c: luma, corps: { certifieAuteur: true, cgu: '2026-10' } }));
    verifier('L10 DELETE …/publication (illustration)', '/api/illustrations/{id}/publication', 'DELETE', await appel('DELETE', `/api/illustrations/${idPub2}/publication`, { c: luma }));
    verifier('L10 DELETE /api/illustrations/{id}', '/api/illustrations/{id}', 'DELETE', await appel('DELETE', `/api/illustrations/${idPub2}`, { c: luma }));

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
    H.v('le contrat publie 34 opérations de la Communauté, chacune conditionnelle à V2_GALERIE=1, avec sa sécurité déclarée', [galerie.length, galerie.every(o => /V2_GALERIE=1/.test(o.op['x-conditionnel'])), galerie.every(o => Array.isArray(o.op.security))], [34, true, true]);
    H.v('   les écritures déclarent X-Rat-Market ; les lectures publiques ne déclarent aucune sécurité (hors celles du compte)', [galerie.filter(o => ['put', 'post', 'delete'].includes(o.m)).every(o => (o.op.parameters || []).some(p => p.$ref === '#/components/parameters/XRatMarket')), galerie.filter(o => o.m === 'get' && !/enregistres|moderation|^\/api\/classeurs|^\/api\/illustrations$/.test(o.chemin)).every(o => o.op.security.length === 0)], [true, true]);
    H.v('   les classeurs : la liste exige la session ; la lecture d\'un classeur l\'admet sans la demander (auteur ou public)', [OPENAPI.paths['/api/classeurs'].get.security, OPENAPI.paths['/api/classeurs/{id}'].get.security], [[{ session: [] }], [{ session: [] }, {}]]);
    H.v('   les quatre codes nouveaux sont dans la liste fermée des codes d\'erreur', ['INTERDIT', 'INTROUVABLE', 'FICHIER', 'LIMITE_DEBIT'].filter(c => !OPENAPI.components.schemas.ReponseErreur.properties.erreur.properties.code.enum.includes(c)), []);
    H.vrai('   les exemples du contrat valident (Publication)', valider({ id: 'k3J9x0Qw2m8LzTfA1bC4dE', pseudo: 'luma', publieLe: '2026-11-01T10:00:00.000Z', titre: 'Page Michi', categories: ['methode-michi', 'couleur'], nb: 9, pages: 2, jaime: null, petitCompteur: true, arts: [{ art: 'Zy9x8W7v6U5t4S3r2Q1pOn', col: 0, row: 0, fmt: '2h', url: 'https://pub.exemple.test/galerie/pub/Zy9x8W7v6U5t4S3r2Q1pOn.webp', largeur: 400, hauteur: 279 }], cartes: [{ cle: '1234|001', setSlug: 'Base-Set' }, null] }, OPENAPI.components.schemas.Publication, OPENAPI).ok);
    // le validateur sait dire NON sur ces schémas (une clé en trop, un type faux, un nombre à la place du null arrondi)
    H.v('   le validateur dit NON : clé en trop, type faux, champ manquant', [
        valider({ ...s1.json, extra: 1 }, OPENAPI.components.schemas.ReponseSignalement, OPENAPI).ok,
        valider({ success: true, jaime: 'oui', compteur: null, petitCompteur: true }, OPENAPI.components.schemas.ReponseJaime, OPENAPI).ok,
        valider({ success: true, octetsMax: 5 }, OPENAPI.components.schemas.ReponseBornesIllustrations, OPENAPI).ok], [false, false, false]);
    // ═══ C-I4 : le pilote des statuts documentés — chaque opération reçoit ses refus (401, 403, 404, 400, 429), validés contre le schéma publié ═══
    const idArt = art.id, inconnu = () => F.nouvelId();
    const OPS = [
        { m: 'GET', modele: '/api/galerie', url: '/api/galerie', mauvais: '/api/galerie?zzz=1' },
        { m: 'GET', modele: '/api/galerie/filtres', url: '/api/galerie/filtres', mauvais: '/api/galerie/filtres?zzz=1' },
        { m: 'GET', modele: '/api/galerie/{id}/pages/{n}', url: `/api/galerie/${idPub}/pages/1`, mauvais: `/api/galerie/${idPub}/pages/zzz`, absent: `/api/galerie/${inconnu()}/pages/1` },
        { m: 'GET', modele: '/api/banque', url: '/api/banque', mauvais: '/api/banque?tri=zzz' },
        { m: 'GET', modele: '/api/banque/formats', url: '/api/banque/formats', mauvais: '/api/banque/formats?zzz=1' },
        { m: 'GET', modele: '/api/illustrations/bornes', url: '/api/illustrations/bornes', mauvais: '/api/illustrations/bornes?zzz=1' },
        ...['jaime', 'enregistre'].flatMap(v => ['PUT', 'DELETE'].flatMap(m => [
            { m, modele: `/api/classeurs/{id}/${v}`, url: `/api/classeurs/${idPub}/${v}`, session: true, ecriture: true, absent: `/api/classeurs/${inconnu()}/${v}`, mauvais: `/api/classeurs/!!/${v}` },
            { m, modele: `/api/illustrations/{id}/${v}`, url: `/api/illustrations/${idArt}/${v}`, session: true, ecriture: true, absent: `/api/illustrations/${inconnu()}/${v}`, mauvais: `/api/illustrations/!!/${v}` }])),
        { m: 'GET', modele: '/api/enregistres', url: '/api/enregistres', session: true, mauvais: '/api/enregistres?zzz=1' },
        { m: 'POST', modele: '/api/galerie/{id}/remix', url: `/api/galerie/${idPub}/remix`, session: true, ecriture: true, absent: `/api/galerie/${inconnu()}/remix`, mauvais: '/api/galerie/!!/remix' },
        { m: 'GET', modele: '/api/classeurs', url: '/api/classeurs', session: true, mauvais: '/api/classeurs?zzz=1' },
        { m: 'POST', modele: '/api/classeurs', url: '/api/classeurs', session: true, ecriture: true, corps: { titre: 'Pilote', pages: [page9()] }, mauvaisCorps: { titre: '' } },
        { m: 'GET', modele: '/api/classeurs/{id}', url: `/api/classeurs/${idCl}`, session: false, absent: `/api/classeurs/${inconnu()}`, mauvais: `/api/classeurs/${idCl}?zzz=1` },
        { m: 'PUT', modele: '/api/classeurs/{id}', url: `/api/classeurs/${idCl}`, session: true, ecriture: true, corps: { version: 1, titre: 'Pilote', pages: [page9()] }, mauvaisCorps: { titre: 'Pilote' }, absent: `/api/classeurs/${inconnu()}` },
        { m: 'DELETE', modele: '/api/classeurs/{id}', url: `/api/classeurs/${idCl}`, session: true, ecriture: true, absent: `/api/classeurs/${inconnu()}` },
        { m: 'POST', modele: '/api/classeurs/{id}/publication', url: `/api/classeurs/${idCl}/publication`, session: true, ecriture: true, corps: { certifieAuteur: true, cgu: 'c' }, mauvaisCorps: { cgu: 'c', zzz: 1 }, absent: `/api/classeurs/${inconnu()}/publication`,
            pour429: async c => `/api/classeurs/${(await require('../galerie/classeurs').creer({ compteId: c.id, champs: { titre: 'Q', etiquettes: [], couleur: null, couverture: null, pages: [page9()] }, max: 50 })).classeur.id}/publication` },
        { m: 'DELETE', modele: '/api/classeurs/{id}/publication', url: `/api/classeurs/${idCl}/publication`, session: true, ecriture: true, absent: `/api/classeurs/${inconnu()}/publication` },
        { m: 'GET', modele: '/api/illustrations', url: '/api/illustrations', session: true, mauvais: '/api/illustrations?zzz=1' },
        { m: 'PUT', modele: '/api/illustrations/{id}', url: `/api/illustrations/${idPriv}`, session: true, ecriture: true, corps: { ambiances: ['douce'] }, mauvaisCorps: {}, absent: `/api/illustrations/${inconnu()}` },
        { m: 'DELETE', modele: '/api/illustrations/{id}', url: `/api/illustrations/${idPriv}`, session: true, ecriture: true, absent: `/api/illustrations/${inconnu()}` },
        { m: 'POST', modele: '/api/illustrations/{id}/publication', url: `/api/illustrations/${idPriv}/publication`, session: true, ecriture: true, corps: { certifieAuteur: true, cgu: 'c' }, mauvaisCorps: { cgu: 'c', zzz: 1 }, absent: `/api/illustrations/${inconnu()}/publication`,
            pour429: async c => `/api/illustrations/${await artFabrique(c, 'lim')}/publication` },
        { m: 'DELETE', modele: '/api/illustrations/{id}/publication', url: `/api/illustrations/${idPriv}/publication`, session: true, ecriture: true, absent: `/api/illustrations/${inconnu()}/publication` },
        { m: 'PUT', modele: '/api/compte/pseudo', url: '/api/compte/pseudo', session: true, ecriture: true, corps: { pseudo: 'pilote-pseudo' }, mauvaisCorps: { pseudo: 'a' } },
        { m: 'POST', modele: '/api/illustrations/depot', url: '/api/illustrations/depot', session: true, ecriture: true, corps: { type: 'image/png', octets: 1000 }, mauvaisCorps: { type: 'image/png' } },
        { m: 'POST', modele: '/api/illustrations/depot/{depot}/finaliser', url: `/api/illustrations/depot/${inconnu()}/finaliser`, session: true, ecriture: true, corps: { nom: 'x', format: '1', certifieDroits: true, certifieNonOfficielle: true }, mauvaisCorps: { nom: 1 }, absent: `/api/illustrations/depot/${inconnu()}/finaliser` },
        { m: 'POST', modele: '/api/signalements', url: '/api/signalements', ecriture: true, session: false, corps: { cible: `galerie:${idPub}`, motif: 'autre' }, mauvaisCorps: { motif: 'zzz' } },
        { m: 'GET', modele: '/api/admin/moderation', url: '/api/admin/moderation?file=publications', session: true, moderation: true, mauvais: '/api/admin/moderation?file=zzz' },
        { m: 'POST', modele: '/api/admin/moderation/{id}/decision', url: `/api/admin/moderation/pub.${inconnu()}/decision`, session: true, ecriture: true, moderation: true, corps: { decision: 'accepter' }, mauvaisCorps: { decision: 'zzz' }, absent: `/api/admin/moderation/pub.${inconnu()}/decision` }
    ];
    const corpsDe = o => (o.m === 'GET' ? undefined : (o.corps || {}));
    for (const o of OPS) {
        const lib = `${o.m} ${o.modele.replace('/api/', '')}`.slice(0, 44);
        if (o.session) verifier(`401 — ${lib}`, o.modele, o.m, await H.appel(sv.url, o.url, { methode: o.m, corps: corpsDe(o), entetes: { 'x-forwarded-for': IP(), origin: SITE, 'x-rat-market': '1' } }));
        if (o.ecriture && o.session) verifier(`403 ORIGINE — ${lib}`, o.modele, o.m, await appel(o.m, o.url, { c: o.moderation ? modo : noa, corps: corpsDe(o), sansSite: true }));
        if (o.ecriture && !o.session) verifier(`403 ORIGINE — ${lib}`, o.modele, o.m, await appel(o.m, o.url, { corps: corpsDe(o), sansSite: true }));
        if (o.absent) verifier(`404 — ${lib}`, o.modele, o.m, await appel(o.m, o.absent, { c: o.moderation ? modo : noa, corps: corpsDe(o) }));
        if (o.mauvais) verifier(`400 — ${lib}`, o.modele, o.m, await appel(o.m, o.mauvais, { c: o.moderation ? modo : noa, corps: corpsDe(o), sansSite: o.m === 'GET' }));
        if (o.mauvaisCorps) verifier(`400 — ${lib}`, o.modele, o.m, await appel(o.m, o.url, { c: o.moderation ? modo : noa, corps: o.mauvaisCorps }));
    }
    {   // les refus de FICHIER (413, 415, 422) et les CONFLITS (409), joués pour de vrai, validés contre le schéma publié
        const octetsDe = async (buffer, type, c = noa) => { const o2 = await appel('POST', '/api/illustrations/depot', { c, corps: { type, octets: buffer.length } }); stockage.deposer(o2.json.urlDepot, buffer); return appel('POST', `/api/illustrations/depot/${o2.json.depotId}/finaliser`, { c, corps: { nom: 'x', format: '1', certifieDroits: true, certifieNonOfficielle: true } }); };
        const fin415 = await octetsDe(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'), 'image/png');
        verifier('415 — finaliser (un SVG)', '/api/illustrations/depot/{depot}/finaliser', 'POST', fin415);
        const fin422 = await octetsDe(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), require('crypto').randomBytes(200)]), 'image/jpeg');
        verifier('422 — finaliser (un fichier illisible)', '/api/illustrations/depot/{depot}/finaliser', 'POST', fin422);
        H.v('   (415 format et 422 illisible : les codes du site)', [fin415.statut, fin415.json.erreur.detail, fin422.statut, fin422.json.erreur.detail], [415, 'format', 422, 'illisible']);
        const gros = await appel('POST', '/api/illustrations/depot', { c: noa, corps: { type: 'image/png', octets: 9 * 1024 * 1024 } });
        verifier('413 — depot (au-dessus de 8 Mio)', '/api/illustrations/depot', 'POST', gros);
        const svB = async (gal) => { const c1 = { ...cfg, galerie: { ...cfg.galerie, ...gal(cfg.galerie) } }; const ap = express(); ap.set('trust proxy', true); transport.enTete(ap, c1); ap.use(express.json());
            ap.use(assembler([{ enTete() { }, routes(r, c, d) { routes.routesGalerie(r, c, { ...d, stockage, fetchTurnstile: turnstile, env: A.ENV_VALIDE }); } }], c1, {})); return H.serveur(ap); };
        const svBornes = await svB(g => ({ bornes: { ...g.bornes, illustrationsMax: 1 }, limites: { ...g.limites, jaimeMax: 1, classeursMax: 1 } }));
        const appelB = (methode, chemin, c, corps) => H.appel(svBornes.url, chemin, { methode, corps, entetes: { 'x-forwarded-for': IP(), origin: SITE, 'x-rat-market': '1', cookie: c.cookie } });
        const d1 = await compte('born-' + (++n)); await appelB('POST', '/api/illustrations/depot', d1, { type: 'image/png', octets: 1000 });
        verifier('409 — depot (borne-illustrations)', '/api/illustrations/depot', 'POST', await appelB('POST', '/api/illustrations/depot', d1, { type: 'image/png', octets: 1000 }));
        for (const [genre, op] of [['jaime', 'PUT'], ['enregistre', 'PUT']]) {
            for (const [modele, url, autre] of [['/api/classeurs/{id}/' + genre, `/api/classeurs/${idPub}/${genre}`, `/api/illustrations/${idArt}/${genre}`], ['/api/illustrations/{id}/' + genre, `/api/illustrations/${idArt}/${genre}`, `/api/classeurs/${idPub}/${genre}`]]) {
                const cb = await compte('v-' + (++n)); await appelB('PUT', autre, cb);
                const r409 = await appelB(op, url, cb); verifier(`409 — ${op} ${modele.replace('/api/', '')} (borne)`.slice(0, 52), modele, op, r409);
            }
        }
        const cr = await compte('rx-' + (++n)); await appelB('POST', `/api/galerie/${idPub}/remix`, cr, {});
        verifier('409 — remix (borne-classeurs)', '/api/galerie/{id}/remix', 'POST', await appelB('POST', `/api/galerie/${idPub}/remix`, cr, {}));
        const cb = await compte('cb-' + (++n)); await appelB('POST', '/api/classeurs', cb, { titre: 'un', pages: [page9()] });
        verifier('409 — POST /api/classeurs (borne-classeurs)', '/api/classeurs', 'POST', await appelB('POST', '/api/classeurs', cb, { titre: 'deux', pages: [page9()] }));
        verifier('409 — decision (déjà décidé : etat)', '/api/admin/moderation/{id}/decision', 'POST', await appel('POST', `/api/admin/moderation/art.${fin.json.id}/decision`, { c: modo, corps: { decision: 'accepter' } }));
        await svBornes.fermer();
    }
    {   // 429 : une limite à 1 par fenêtre ; chaque opération reçoit un compte et une adresse NEUFS, deux appels ; le 429 est validé contre le schéma publié
        const limites = Object.fromEntries(Object.entries(cfg.galerie.limites).map(([k, v]) => [k, /(Heure|Jour)$/.test(k) ? 1 : v]));
        const cfg1 = { ...cfg, galerie: { ...cfg.galerie, limites } };
        const app3 = express(); app3.set('trust proxy', true); transport.enTete(app3, cfg1); app3.use(express.json());
        app3.use(assembler([{ enTete() { }, routes(r, c, d) { routes.routesGalerie(r, c, { ...d, stockage, fetchTurnstile: turnstile, env: A.ENV_VALIDE }); } }], cfg1, {}));
        const sv3 = await H.serveur(app3); const obtenus = [];
        for (const o of OPS) {
            const c = o.moderation ? await compte('modo-' + (++n), { role: 'moderateur' }) : await compte('lim-' + (++n)), ip = IP();
            // TOUR 1 (m1) : le quota de publications ne compte que les publications FAITES (ni 404, ni rejeu) : ces opérations reçoivent, à chaque appel, un objet NEUF du compte à publier
            const deux = []; for (let i = 0; i < 3 && !deux.some(x => x.statut === 429); i++) deux.push(await H.appel(sv3.url, o.pour429 ? await o.pour429(c) : o.url, { methode: o.m, corps: corpsDe(o), entetes: { 'x-forwarded-for': ip, origin: SITE, 'x-rat-market': '1', cookie: c.cookie } }));
            const r429 = deux.find(x => x.statut === 429); obtenus.push([o.m + ' ' + o.modele, Boolean(r429)]);
            if (r429) verifier(`429 — ${o.m} ${o.modele.replace('/api/', '')}`.slice(0, 50), o.modele, o.m, r429);
        }
        H.v('   429 : chacune des opérations de la Communauté rend LIMITE_DEBIT quand sa limite est atteinte', obtenus.filter(x => !x[1]).map(x => x[0]), []);
        await sv3.fermer();
    }

    // ═══ base dédiée pas branchée : chaque route répond 503 INDISPONIBLE (jamais un repli sur la base de l'API), conforme au schéma publié ═══
    await G.debrancher();
    const sansBase = OPS.map(o => [o.m, o.url]);
    const modeles = Object.fromEntries(OPS.map(o => [o.url, o.modele]));
    const r503 = [];
    for (const [m, ch] of sansBase) { const r = await appel(m, ch, { c: modo, corps: m === 'GET' ? undefined : { pseudo: 'x-y-z', type: 'image/png', octets: 5, cible: `galerie:${idPub}`, motif: 'autre', turnstile: 'jeton-valide' } }); r503.push([m, r.statut, r.json && r.json.erreur && r.json.erreur.code]); verifier(`503 sans base — ${m} ${ch.split('?')[0].slice(0, 28)}`, modeles[ch] || ch, m, r); }
    H.v('   sans base dédiée branchée : 503 INDISPONIBLE pour chacune des opérations (un seul code, aucune route ne se rabat sur la base de l\'API)', [...new Set(r503.map(x => `${x[1]} ${x[2]}`))], ['503 INDISPONIBLE']);
    // ═══ C-I4 : chaque statut DOCUMENTÉ d'une opération de la Communauté est JOUÉ ici, ou déclaré « non joué » avec sa raison (comme pour les abonnements) ═══
    const GENERIQUE = 'statut du bloc d\'erreurs commun des lectures publiques ; aucune branche de cette route ne le produit (pas d\'identifiant ni de paramètre à refuser) — à resserrer dans le contrat';
    const NON_JOUES = {
        'GET /api/galerie 404': GENERIQUE, 'GET /api/galerie/filtres 404': GENERIQUE, 'GET /api/galerie/filtres 400': GENERIQUE, 'GET /api/banque 404': GENERIQUE,
        'GET /api/banque/formats 400': GENERIQUE, 'GET /api/banque/formats 404': GENERIQUE, 'GET /api/illustrations/bornes 400': GENERIQUE, 'GET /api/illustrations/bornes 404': GENERIQUE,
        ...Object.fromEntries(['classeurs', 'illustrations'].flatMap(t => ['jaime', 'enregistre'].map(v => [`DELETE /api/${t}/{id}/${v} 409`, 'retirer un vote ne dépasse aucune borne : le code ne produit pas de 409 pour un DELETE (statut du bloc commun des écritures) — à resserrer dans le contrat']))),
    };

    const documentes = galerie.flatMap(o => Object.keys(o.op.responses).filter(s => /^\d+$/.test(s)).map(s => `${o.m.toUpperCase()} ${o.chemin} ${s}`));
    const manquants = documentes.filter(k => !JOUEES.has(k) && !NON_JOUES[k]);
    H.v('   statuts documentés ni joués ni déclarés (chacun est joué ci-dessus, ou déclaré avec sa raison)', manquants, []);
    H.v('   chaque statut déclaré « non joué » est bien documenté (pas de déclaration périmée) et n\'est pas joué (pas de déclaration inutile)', [Object.keys(NON_JOUES).filter(k => !documentes.includes(k)), Object.keys(NON_JOUES).filter(k => JOUEES.has(k))], [[], []]);
    await sv.fermer(); await sv2.fermer(); await dbG.dropDatabase();
    await H.fermerBac();
    H.bilan();
})();

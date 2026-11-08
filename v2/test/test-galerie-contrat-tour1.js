'use strict';
// GALERIE, TOUR 1 — LE CONTRAT DU SITE (relecture 3) : (C-I1) les arts POSÉS portent url, largeur, hauteur ; (C-I2) un OUTIL d'exploitation (pas une route) pose des pages d'essai, sous garde, dans la base dédiée seule ;
// (C-I3) `exigerVerifie` refuse une session fabriquée d'un compte non confirmé ; et `GET /api/compte` rend `pseudo` et `role` quand la Communauté est montée. Écrit avant le code ; chaque garde neuve a son mutant sur le code RÉEL.
const A = require('./_aide-galerie');
const H = A.H;
const fs = require('fs'), os = require('os'), path = require('path');

(async () => {
    const B = await A.outillerBanc('test-galerie-contrat-tour1.js');
    const { G, F, svc, sv, stockage, brut, lire, appel, compte, code, detail, artPublic, serveur } = B;
    const outil = require('../galerie/outils/poser-pages-essai'); const init = require('../galerie/outils/initialiser-base');
    const luma = await compte({}, 'luma'), noa = await compte({}, 'noa');

    // ═══ 1. (C-I1) un art POSÉ porte de quoi s'afficher ═══
    const art = await artPublic(luma, { largeur: 400, hauteur: 279, fmt: '2h' }), art2 = await artPublic(luma, { largeur: 300, hauteur: 419 });
    const pose = (id, fmt = '2h') => ({ art: id, col: 0, row: 1, fmt });
    const idPub = await svc.publierPourExploitation({ auteurId: luma.id, titre: 'Page avec arts', categories: ['couleur'], nb: 9, pages: 2, arts: [pose(art), pose(art2, '1')], cartes: [{ cle: '1234|001', nom: 'Pikachu' }],
        pagesSuite: [{ n: 2, arts: [pose(art)], cartes: [] }], etat: 'public' });
    const attendu = { art, col: 0, row: 1, fmt: '2h', url: `${stockage.urlPublique}/galerie/pub/${art}.webp`, largeur: 400, hauteur: 279 };
    const fil = (await lire(sv, '/api/galerie')).json.publications.find(p => p.id === idPub);
    H.v('1. Publication.arts[] : { art, col, row, fmt, url, largeur, hauteur }, l\'url est celle de la copie publique de la banque', [Object.keys(fil.arts[0]), fil.arts[0], fil.arts.length], [['art', 'col', 'row', 'fmt', 'url', 'largeur', 'hauteur'], attendu, 2]);
    const pg = (await lire(sv, `/api/galerie/${idPub}/pages/2`)).json.page;
    H.v('   page.arts[] de GET /api/galerie/{id}/pages/{n} : les mêmes sept champs', [Object.keys(pg.arts[0]), pg.arts[0]], [['art', 'col', 'row', 'fmt', 'url', 'largeur', 'hauteur'], attendu]);
    H.v('   la page 1 demandée par /pages/1 aussi', (await lire(sv, `/api/galerie/${idPub}/pages/1`)).json.page.arts.map(a => a.largeur), [400, 300]);
    await brut('arts').updateOne({ _id: art2 }, { $set: { etat: 'retire' } });
    H.v('   un art retiré plus tard est OMIS de la page (jamais une URL qui ne sert plus)', (await lire(sv, '/api/galerie')).json.publications.find(p => p.id === idPub).arts.map(a => a.art), [art]);
    H.v('   poser une page dont un art n\'existe pas, ou n\'est pas public, est refusé', await Promise.all([F.nouvelId(), art2].map(id => svc.publierPourExploitation({ auteurId: luma.id, titre: 'x', categories: ['couleur'], nb: 9, pages: 1, arts: [pose(id)], cartes: [], etat: 'public' }).then(() => 'posée', () => 'refusée'))), ['refusée', 'refusée']);
    const mArts = A.charger('service.js', [["versPublication(d, poser(pages[i].arts))", "versPublication(d, pages[i].arts)"]]);
    const brutsMut = await mArts.listerPublications({ urlPublique: stockage.urlPublique });
    H.v('   MUTANT « les arts posés ne sont plus enrichis » : la liste rend les quatre champs d\'avant', [Object.keys(brutsMut.publications.find(p => p.id === idPub).arts[0])], [['art', 'col', 'row', 'fmt']]);

    // ═══ 2. (C-I2) l'outil d'exploitation : sous garde, dans la base dédiée seule ═══
    {
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'galerie-essai-'));
        const fichier = path.join(dossier, 'essai.json');
        const donnees = { pages: [
            { titre: 'Essai Pikachu', categories: ['couleur', 'vintage'], nb: 9, cartes: [{ cle: '1234|001', nom: 'Pikachu' }, { cle: '1234|002', nom: 'Raichu' }], attributs: { set: ['Base-Set'], couleur: ['jaune'] } },
            { titre: 'Essai à deux pages', categories: ['methode-michi'], nb: 16, pages: 2, cartes: [{ cle: '77|9', nom: 'Dresseur' }], pagesSuite: [{ n: 2, arts: [], cartes: [{ cle: '77|10', nom: 'Énergie' }] }] }] };
        fs.writeFileSync(fichier, JSON.stringify(donnees));
        const ENV = { NODE_ENV: 'test' };
        await B.dbG.collection('galerie_meta').deleteMany({});
        const sansMarqueur = await outil.poserPages({ donnees, pseudo: 'luma', env: ENV });
        H.v('2. dans une base SANS marqueur : refusé, cause « marqueur-absent », rien posé', [sansMarqueur.ok, sansMarqueur.cause, await brut('publications').countDocuments({ titre: /^Essai/ })], [false, 'marqueur-absent', 0]);
        await init.initialiserBase(B.dbG);
        const prod = await outil.poserPages({ donnees, pseudo: 'luma', env: { NODE_ENV: 'production' } }), prod2 = await outil.poserPages({ donnees, pseudo: 'luma', env: { V2_CIBLE: 'prod' } });
        H.v('   cible PRODUCTION (NODE_ENV=production ou V2_CIBLE=prod) : refusé, cause « cible-production »', [prod.ok, prod.cause, prod2.cause], [false, 'cible-production', 'cible-production']);
        H.v('   V2_CIBLE=essai lève l\'interdit sous NODE_ENV=production', (await outil.poserPages({ donnees: { pages: [] }, pseudo: 'luma', env: { NODE_ENV: 'production', V2_CIBLE: 'essai' } })).ok, true);
        H.v('   auteur sans pseudo posé : refusé, cause « auteur-inconnu »', (await outil.poserPages({ donnees, pseudo: 'personne', env: ENV })).cause, 'auteur-inconnu');
        H.v('   données mal formées (catégorie inconnue) : refusé AVANT toute écriture (aucune page, même les valides)', [(await outil.poserPages({ donnees: { pages: [donnees.pages[0], { ...donnees.pages[1], categories: ['inconnue'] }] }, pseudo: 'luma', env: ENV })).cause, await brut('publications').countDocuments({ titre: /^Essai/ })], ['donnees-invalides', 0]);
        H.v('   plus de 50 pages : refusé', (await outil.poserPages({ donnees: { pages: Array(51).fill(donnees.pages[0]) }, pseudo: 'luma', env: ENV })).cause, 'donnees-invalides');
        const ok = await outil.poserPages({ donnees, pseudo: 'luma', env: ENV });
        H.v('   sous garde, avec des données d\'essai : les pages sont posées (publiques, certification « essai ») et le fil n\'est plus vide', [ok.ok, ok.ids.length, (await lire(sv, '/api/galerie')).json.publications.filter(p => /^Essai/.test(p.titre)).length], [true, 2, 2]);
        H.v('   le fil les sert avec leur forme complète (jaime null, cartes, pages)', (p => [p.pseudo, p.petitCompteur, p.cartes.length, p.pages])((await lire(sv, '/api/galerie')).json.publications.find(p => p.titre === 'Essai à deux pages')), ['luma', true, 16, 2]);
        const lues = outil.lireDonnees(fichier);
        H.v('   lireDonnees lit un fichier JSON borné (le fichier de l\'opérateur) et refuse un fichier trop gros ou illisible', [lues.pages.length, (() => { fs.writeFileSync(path.join(dossier, 'mauvais.json'), '{pas du json'); try { outil.lireDonnees(path.join(dossier, 'mauvais.json')); return 'lu'; } catch { return 'refus'; } })()], [2, 'refus']);
        H.v('   le CLI exige --confirmer-essai, --donnees et --auteur, et rien d\'autre', await Promise.all([[], ['--confirmer-essai'], ['--confirmer-essai', `--donnees=${fichier}`, '--auteur=luma', '--force']].map(a => outil.main(a, {}))), [1, 1, 1]);
        // MUTANTS
        const mMarq = A.charger('outils/poser-pages-essai.js', [["const contenu = await verifierContenu(G.base()).then(() => null, e => e);", "const contenu = null;"]]);
        await B.dbG.collection('galerie_meta').deleteMany({});
        H.v('   MUTANT « le marqueur de la base n\'est plus vérifié » : sans marqueur, le réel refuse, le mutant POSE', [(await outil.poserPages({ donnees: { pages: [] }, pseudo: 'luma', env: ENV })).ok, (await mMarq.poserPages({ donnees: { pages: [] }, pseudo: 'luma', env: ENV })).ok], [false, true]);
        await init.initialiserBase(B.dbG);
        const mProd = A.charger('outils/poser-pages-essai.js', [["if (cibleProduction(env))", "if (false)"]]);
        H.v('   MUTANT « la cible production n\'est plus refusée »', [(await outil.poserPages({ donnees: { pages: [] }, pseudo: 'luma', env: { NODE_ENV: 'production' } })).ok, (await mProd.poserPages({ donnees: { pages: [] }, pseudo: 'luma', env: { NODE_ENV: 'production' } })).ok], [false, true]);
        H.vrai('   (l\'outil n\'est PAS une route : aucune route montée ne le nomme, la liste fermée reste fermée)', !/poser-pages-essai/.test(fs.readFileSync(path.join(__dirname, '..', 'galerie', 'routes.js'), 'utf8')) && !/poser-pages-essai/.test(fs.readFileSync(path.join(__dirname, '..', 'galerie', 'monter.js'), 'utf8')));
        fs.rmSync(dossier, { recursive: true, force: true });
    }

    // ═══ 3. (C-I3) exigerVerifie refuse une session fabriquée d'un compte NON confirmé ═══
    {
        // Un compte non confirmé n'est jamais un porteur (porteur.js, O3) : pour jouer exigerVerifie, l'identité est FABRIQUÉE — le seul fragment remplacé est la source du porteur, la chaîne de gardes est celle du code réel.
        const faux = (verifie) => `const { resoudrePorteur, exigerSession } = { resoudrePorteur: () => (req, res, next) => { req.v2 = { porteur: { type: 'compte', surface: 'scanner', id: 'compte-fabrique', compte: { verifie: ${verifie} }, administrateur: false } }; next(); }, exigerSession: (req, res, next) => next() };`;
        const origine = "const { resoudrePorteur, exigerSession } = require('../porteur');";
        const attaque = async (rempl) => { const s = await serveur(B.cfg, { routes: A.charger('routes.js', [[origine, faux(false)], ...rempl]) }); return appel(s, 'PUT', `/api/classeurs/${F.nouvelId()}/jaime`, { c: luma }); };
        const reel = await attaque([]);
        H.v('3. session fabriquée d\'un compte NON confirmé : 403 VERIFICATION (la garde réelle, ordre SESSION → ORIGINE → VERIFICATION)', [reel.statut, code(reel)], [403, 'VERIFICATION']);
        const sansOrigine = await (async () => { const s = await serveur(B.cfg, { routes: A.charger('routes.js', [[origine, faux(false)]]) }); return appel(s, 'PUT', `/api/classeurs/${F.nouvelId()}/jaime`, { c: luma, sansSite: true }); })();
        H.v('   sans l\'Origin du site, c\'est ORIGINE qui parle d\'abord', code(sansOrigine), 'ORIGINE');
        const mut = await attaque([["const ECRITURE = [...SESSION, S.exigerOrigineSite(cfg), exigerVerifie];", "const ECRITURE = [...SESSION, S.exigerOrigineSite(cfg)];"]]);
        H.v('   MUTANT « exigerVerifie est retiré de la chaîne » : le compte non confirmé n\'est plus arrêté par la VERIFICATION (le réel : 403 VERIFICATION)', [code(reel), code(mut)], ['VERIFICATION', 'INTERDIT']);
        const vrai = await (async () => { const s = await serveur(B.cfg, { routes: A.charger('routes.js', [[origine, faux(true)]]) }); return appel(s, 'PUT', `/api/classeurs/${F.nouvelId()}/jaime`, { c: luma }); })();
        H.v('   (le même montage avec un compte CONFIRMÉ passe la garde : le refus venait bien de la vérification)', code(vrai), 'INTERDIT');
    }

    // ═══ 4. GET /api/compte rend pseudo et role, en ajout, seulement quand la Communauté est montée ═══
    {
        const profil = require('../galerie/profil'); const monter = require('../galerie/monter'); const express = require('express');
        await monter.arreter();
        H.v('4. lot non monté : aucun champ de plus (la réponse d\'avant, octet pour octet)', await profil.champsCompte({ _id: luma.c._id, role: 'administrateur' }), {});
        G.brancher(B.dbG);
        monter.routes(express.Router(), B.cfg, { env: B.envCfg, stockage: A.fauxStockage(), balayage: false, ouvrirBase: async () => ({ db: B.dbG, fermer: async () => { } }) });
        await monter.pret();
        H.v('   lot monté : pseudo (ou null) et role (administrateur | moderateur | null)', [await profil.champsCompte({ _id: luma.c._id, role: 'administrateur' }), await profil.champsCompte({ _id: noa.c._id, role: 'moderateur' }), await profil.champsCompte({ _id: new (require('mongoose').Types.ObjectId)(), role: 'inconnu' })], [{ pseudo: 'luma', role: 'administrateur' }, { pseudo: 'noa', role: 'moderateur' }, { pseudo: null, role: null }]);
        const src = fs.readFileSync(path.join(__dirname, '..', 'comptes', 'routes.js'), 'utf8');
        H.vrai('   GET /api/compte les prend de galerie/profil (l\'ajout est dans la réponse)', /champsCompte\(compte\)/.test(src) && /\.\.\.extra/.test(src));
        const mRole = A.charger('profil.js', [["role: ROLES.includes(compte.role) ? compte.role : null", "role: compte.role || null"]]);
        H.v('   MUTANT « le rôle est rendu tel quel » : une valeur hors liste fuirait (le réel : null)', [(await profil.champsCompte({ _id: luma.c._id, role: 'inconnu' })).role, (await mRole.champsCompte({ _id: luma.c._id, role: 'inconnu' })).role], [null, 'inconnu']);
        await monter.arreter(); G.brancher(B.dbG);
    }
    await B.fermer();
    H.bilan();
})();

'use strict';
// GALERIE L9 — les CLASSEURS privés de l'Atelier (`/api/classeurs`), leur publication et la reprise (remix), sur la base dédiée en mémoire (aucune grappe réelle, aucun R2 réel, aucun Turnstile réel).
// Forme retenue (arbitrage du coordinateur, O15 à O19) : UN stockage ; `Page = { nb: 4|9|12|16, blocs: [{ c, r, l, h, genre: "carte"|"art", contenu: {type:"carte",cle,setSlug} | {type:"art",artId} | null }] }`.
// Chaque garde est éprouvée sur le code réel (OUI au cas légitime, NON au cas hostile), et les refus se jouent dans l'ordre du contrat : SESSION, ORIGINE, VERIFICATION, LIMITE_DEBIT, puis le pseudo, puis la forme.
const A = require('./_aide-galerie');
const H = A.H;

(async () => {
    const B = await A.outillerBanc('test-galerie-classeurs.js');
    const { F, svc, compte, appel, lire, code, detail, brut, sv, serveur, variante, artPublic, SITE } = B;
    const carte = (c, r, cle = '1234|001', setSlug = 'Base-Set') => ({ c, r, l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle, setSlug } });
    const bart = (c, r, l, h, artId) => ({ c, r, l, h, genre: 'art', contenu: { type: 'art', artId } });
    const pg = (nb, blocs = []) => ({ nb, blocs });
    const cles = o => Object.keys(o);
    const luma = await compte({}, 'luma'), noa = await compte({}, 'noa'), modo = await compte({ role: 'moderateur' }, 'modo-classeurs'), sansPseudo = await compte({}, null);
    const creer = (c, corps = {}, s = sv) => appel(s, 'POST', '/api/classeurs', { c, corps: { titre: 'Mon classeur', pages: [pg(9, [carte(0, 0), carte(1, 0, '1234|002')])], ...corps } });
    const decider = (id, decision, extra = {}) => appel(sv, 'POST', `/api/admin/moderation/pub.${id}/decision`, { c: modo, corps: { decision, ...extra } });

    // ═══ 1. L'ORDRE DES REFUS : SESSION, ORIGINE, (VERIFICATION), LIMITE_DEBIT, puis le pseudo, puis la forme ═══
    {
        const s1 = await appel(sv, 'POST', '/api/classeurs', { corps: { titre: 'x', pages: [pg(9)] }, plus: {} });
        H.v('sans cookie : 401 SESSION (avant tout)', [s1.statut, code(s1), s1.json.facturation], [401, 'SESSION', null]);
        const s2 = await appel(sv, 'POST', '/api/classeurs', { c: luma, corps: { titre: 'x', pages: [pg(9)] }, sansSite: true });
        H.v('sans Origin du site : 403 ORIGINE', [s2.statut, code(s2)], [403, 'ORIGINE']);
        const svL = await serveur(variante({}, { ecrituresCompteHeure: 1 }));
        const l1 = await appel(svL, 'POST', '/api/classeurs', { c: luma, corps: { titre: 'x', pages: [pg(9)] } }), l2 = await appel(svL, 'POST', '/api/classeurs', { c: luma, corps: { titre: 'y', pages: [pg(9)] } });
        H.v('la limite d\'écriture : 429 LIMITE_DEBIT avec reessayerDans (jamais DEBIT)', [l1.statut, l2.statut, code(l2), Number.isInteger(l2.json.erreur.reessayerDans)], [201, 429, 'LIMITE_DEBIT', true]);
        const l3 = await appel(svL, 'POST', '/api/classeurs', { c: luma, corps: { titre: '', pages: 'x' } });
        H.v('la limite passe AVANT la forme : un corps invalide dans la fenêtre épuisée est un 429, pas un 400', [l3.statut, code(l3)], [429, 'LIMITE_DEBIT']);
    }

    // ═══ 2. CRÉER, LIRE, LISTER ═══
    const c1 = await creer(luma, { etiquettes: ['michi', 'jaune'], couleur: 'jaune' });
    H.v('POST /api/classeurs : 201 { success, classeur } privé, version 1, id opaque d\'au moins 22 caractères', [c1.statut, cles(c1.json), c1.json.classeur.visibilite, c1.json.classeur.version, c1.json.classeur.id.length >= 22], [201, ['success', 'classeur'], 'prive', 1, true]);
    H.v('   les clés du Classeur (O15 : pas de michi ni de fonds ; les pages portent nb et blocs)', cles(c1.json.classeur), ['id', 'titre', 'etiquettes', 'couleur', 'couverture', 'pages', 'visibilite', 'motif', 'repriseDe', 'version', 'creeLe', 'majLe']);
    H.v('   la page est rendue telle qu\'elle a été écrite', c1.json.classeur.pages, [pg(9, [carte(0, 0), carte(1, 0, '1234|002')])]);
    const id1 = c1.json.classeur.id;
    const g1 = await appel(sv, 'GET', `/api/classeurs/${id1}`, { c: luma, sansSite: true });
    H.v('GET /api/classeurs/{id} par l\'auteur : tout, no-store', [g1.statut, g1.json.classeur.id, g1.json.classeur.titre, g1.entetes['cache-control']], [200, id1, 'Mon classeur', 'no-store']);
    const ls = await appel(sv, 'GET', '/api/classeurs', { c: luma, sansSite: true });
    H.v('GET /api/classeurs : { success, classeurs: ResumeClasseur[], suite }', [ls.statut, cles(ls.json), cles(ls.json.classeurs[0])], [200, ['success', 'classeurs', 'suite'], ['id', 'titre', 'etiquettes', 'couleur', 'doublesPages', 'couverture', 'apercu', 'visibilite', 'motif', 'majLe', 'compteurs']]);
    H.v('   aperçu : les clés des cartes, doubles pages comptées, compteurs null tant que privé', [ls.json.classeurs[0].apercu, ls.json.classeurs[0].doublesPages, ls.json.classeurs[0].compteurs], [['1234|001', '1234|002'], 1, null]);
    const lsN = await appel(sv, 'GET', '/api/classeurs', { c: noa, sansSite: true });
    H.v('la liste d\'un autre compte ne contient rien du premier', lsN.json.classeurs.length, 0);
    H.v('GET /api/classeurs sans session : 401 SESSION', code(await lire(sv, '/api/classeurs')), 'SESSION');

    // ═══ 3. LA FORME : tout ce qui n'est pas permis est refusé ═══
    const refus = async (nom, corps, attendu, statut = 400) => { const r = await creer(luma, corps); H.v(`   refusé — ${nom}`, [r.statut, code(r), detail(r)], [statut, statut === 409 ? 'CONFLIT' : 'ENTREE', attendu]); };
    await refus('nb hors liste (5)', { pages: [pg(5)] }, 'page-nb');
    await refus('bloc hors de la grille (c = 3 sur 3 colonnes)', { pages: [pg(9, [carte(3, 0)])] }, 'bloc-hors-grille');
    await refus('bloc qui déborde (art 2×2 en c = 2)', { pages: [pg(9, [bart(2, 0, 2, 2, F.nouvelId())])] }, 'bloc-hors-grille');
    await refus('art d\'une taille hors des quatre formats (3×1)', { pages: [pg(9, [bart(0, 0, 3, 1, F.nouvelId())])] }, 'bloc-genre');
    await refus('une carte ne peut pas être 2×1', { pages: [pg(9, [{ ...carte(0, 0), l: 2 }])] }, 'bloc-genre');
    await refus('clé de carte mal formée', { pages: [pg(9, [carte(0, 0, 'pas-une-cle')])] }, 'cle');
    await refus('genre art avec un contenu carte', { pages: [pg(9, [{ ...carte(0, 0), genre: 'art' }])] }, 'bloc-genre');
    await refus('type de contenu inconnu', { pages: [pg(9, [{ ...carte(0, 0), contenu: { type: 'zzz' } }])] }, 'contenu');
    await refus('champ en trop dans un bloc', { pages: [pg(9, [{ ...carte(0, 0), michi: [] }])] }, 'bloc');
    await refus('plus de 16 blocs', { pages: [pg(16, Array.from({ length: 17 }, (_, i) => carte(i % 4, Math.floor(i / 4) % 4)))] }, 'bloc');
    await refus('illustration inconnue', { pages: [pg(9, [bart(0, 0, 1, 1, F.nouvelId())])] }, 'illustration-inconnue');
    await refus('texte binaire dans le titre', { titre: 'data:image/png;base64,AAAA' }, 'donnee-binaire');
    await refus('titre vide', { titre: '' }, 'titre');
    await refus('étiquette en majuscules', { etiquettes: ['Michi'] }, 'etiquettes');
    await refus('couleur hors liste', { couleur: 'fuchsia' }, 'couleur');
    await refus('zéro page', { pages: [] }, 'pages');
    await refus('champ inconnu (michi)', { michi: [] }, 'corps');
    await refus('champ visibilite refusé : l\'état ne s\'écrit jamais par ce corps', { visibilite: 'public' }, 'corps');
    {
        const r = await creer(luma, { pages: Array.from({ length: 101 }, () => pg(4)) });
        H.v('   101 pages : 409 CONFLIT borne-doubles-pages', [r.statut, code(r), detail(r)], [409, 'CONFLIT', 'borne-doubles-pages']);
        const ok = await creer(luma, { pages: Array.from({ length: 100 }, () => pg(4)) });
        H.v('   100 pages (50 doubles pages) : admis', ok.statut, 201);
        await appel(sv, 'DELETE', `/api/classeurs/${ok.json.classeur.id}`, { c: luma });
    }
    {
        const art = await artPublic(noa), priv = await artPublic(noa, { etat: 'prive', publieLe: null });
        const r = await creer(luma, { pages: [pg(9, [bart(0, 0, 1, 1, art)])] });
        H.v('   une illustration PUBLIQUE d\'autrui est citable', r.statut, 201);
        const r2 = await creer(luma, { pages: [pg(9, [bart(0, 0, 1, 1, priv)])] });
        H.v('   l\'illustration PRIVÉE d\'autrui ne l\'est pas : 400 illustration-inconnue', [r2.statut, detail(r2)], [400, 'illustration-inconnue']);
        const r3 = await creer(noa, { pages: [pg(9, [bart(0, 0, 1, 1, priv)])] });
        H.v('   la sienne, privée, l\'est', r3.statut, 201);
    }
    H.v('la forme précède l\'écriture : rien n\'a été écrit par les refus (3 classeurs de luma, pas un de plus)', await brut('classeurs').countDocuments({ auteurId: luma.id }), 3);

    // ═══ 4. LA BORNE DE CLASSEURS ═══
    {
        const svB = await serveur(variante({ V2_CLASSEURS_MAX: '2' }));
        const p = await compte({}, 'borne-cl');
        const a = await creer(p, {}, svB), b = await creer(p, {}, svB), x = await creer(p, {}, svB);
        H.v('borne-classeurs : le troisième est refusé 409 CONFLIT', [a.statut, b.statut, x.statut, code(x), detail(x)], [201, 201, 409, 'CONFLIT', 'borne-classeurs']);
    }

    // ═══ 5. PUT : la VERSION, atomique ═══
    const p1 = await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: { version: 1, titre: 'Renommé', pages: [pg(12, [carte(3, 2, '1234|009')])] } });
    H.v('PUT avec la bonne version : 200 { success, classeur }, version 2, contenu remplacé', [p1.statut, cles(p1.json), p1.json.classeur.version, p1.json.classeur.titre, p1.json.classeur.pages], [200, ['success', 'classeur'], 2, 'Renommé', [pg(12, [carte(3, 2, '1234|009')])]]);
    const p2 = await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: { version: 1, titre: 'Périmé', pages: [pg(9)] } });
    H.v('PUT avec une version périmée : 409 CONFLIT version avec versionActuelle', [p2.statut, code(p2), detail(p2), p2.json.erreur.versionActuelle], [409, 'CONFLIT', 'version', 2]);
    H.v('   et rien n\'a été écrit par le refus', (await brut('classeurs').findOne({ _id: id1 })).titre, 'Renommé');
    {   // deux PUT simultanés sur la même version : un seul gagne
        const deux = await Promise.all(['A', 'B'].map(t => appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: { version: 2, titre: t, pages: [pg(9)] } })));
        H.v('deux PUT simultanés à la version 2 : exactement un 200 et un 409 (comparer-et-écrire atomique)', deux.map(r => r.statut).sort(), [200, 409]);
    }
    H.v('PUT sans version : 400 ENTREE version-invalide', [(await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: { titre: 'x', pages: [pg(9)] } })).statut, detail(await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: { titre: 'x', pages: [pg(9)] } }))], [400, 'version-invalide']);

    // ═══ 6. LE CLASSEUR D'AUTRUI : 404 INTROUVABLE uniforme, jamais 403 ═══
    {
        const absent = await appel(sv, 'GET', `/api/classeurs/${F.nouvelId()}`, { c: noa, sansSite: true });
        const autrui = await appel(sv, 'GET', `/api/classeurs/${id1}`, { c: noa, sansSite: true });
        H.v('GET du classeur d\'autrui (privé) : le MÊME corps que l\'absent, 404 INTROUVABLE', [autrui.statut, autrui.texte === absent.texte, code(autrui)], [404, true, 'INTROUVABLE']);
        const anon = await lire(sv, `/api/classeurs/${id1}`);
        H.v('GET sans session d\'un classeur privé : 404 INTROUVABLE', [anon.statut, code(anon)], [404, 'INTROUVABLE']);
        const pu = await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: noa, corps: { version: 3, titre: 'Vol', pages: [pg(9)] } });
        const de = await appel(sv, 'DELETE', `/api/classeurs/${id1}`, { c: noa });
        const po = await appel(sv, 'POST', `/api/classeurs/${id1}/publication`, { c: noa, corps: { certifieAuteur: true, cgu: '2026-10' } });
        const dp = await appel(sv, 'DELETE', `/api/classeurs/${id1}/publication`, { c: noa });
        H.v('PUT, DELETE, publication, dépublication d\'un classeur d\'autrui : 404 INTROUVABLE partout, jamais 403', [pu, de, po, dp].map(r => [r.statut, code(r)]), [[404, 'INTROUVABLE'], [404, 'INTROUVABLE'], [404, 'INTROUVABLE'], [404, 'INTROUVABLE']]);
        H.v('   le classeur est intact', (await brut('classeurs').findOne({ _id: id1 })).auteurId, luma.id);
        H.v('   un identifiant mal formé : 404 INTROUVABLE aussi', code(await appel(sv, 'GET', '/api/classeurs/!!', { c: luma, sansSite: true })), 'INTROUVABLE');
    }

    // ═══ 7. LES 64 Ko ═══
    {
        const gros = { version: 3, titre: 'Gros', pages: Array.from({ length: 45 }, (_, k) => pg(16, Array.from({ length: 16 }, (_, i) => carte(i % 4, Math.floor(i / 4), `1234|${100 + k}`)))) };
        const lourd = Buffer.byteLength(JSON.stringify(gros));
        const r = await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: gros });
        H.v(`un corps de ${lourd} octets (> 64 Ko) : 413 ENTREE corps-trop-gros`, [lourd > 65536, r.statut, code(r), detail(r)], [true, 413, 'ENTREE', 'corps-trop-gros']);
        const mince = await appel(sv, 'PUT', `/api/classeurs/${id1}`, { c: luma, corps: { ...gros, pages: gros.pages.slice(0, 10) } });
        H.v('   le même corps réduit sous 64 Ko est admis (le refus tient à la taille, pas à la forme)', mince.statut, 200);
    }

    // ═══ 8. PUBLICATION : pseudo, certification, classeur vide, quota ═══
    // les refus de forme consomment la limite du jour (la limite passe avant la forme) : ce banc la relève, la section « 5 par jour » joue la limite réelle sur le serveur de base
    const svP = await serveur(variante({}, { publicationsCompteJour: 100 }));
    const pub = (c, id, corps, s = svP) => appel(s, 'POST', `/api/classeurs/${id}/publication`, { c, corps });
    {
        const cs = await creer(sansPseudo);
        const r = await pub(sansPseudo, cs.json.classeur.id, { certifieAuteur: true, cgu: '2026-10' });
        H.v('publier sans pseudo : 403 INTERDIT pseudo-requis', [r.statut, code(r), detail(r)], [403, 'INTERDIT', 'pseudo-requis']);
        const sc = await pub(luma, id1, { cgu: '2026-10' });
        H.v('publier sans certification d\'auteur : 400 ENTREE auteur-non-certifie', [sc.statut, code(sc), detail(sc)], [400, 'ENTREE', 'auteur-non-certifie']);
        const sc2 = await pub(luma, id1, { certifieAuteur: false, cgu: '2026-10' });
        H.v('   certifieAuteur: false : le même refus', [sc2.statut, detail(sc2)], [400, 'auteur-non-certifie']);
        H.v('   corps avec un champ inconnu : 400 corps ; catégorie hors liste : 400 categories', [detail(await pub(luma, id1, { certifieAuteur: true, cgu: '2026-10', zzz: 1 })), detail(await pub(luma, id1, { certifieAuteur: true, cgu: '2026-10', categories: ['zzz'] }))], ['corps', 'categories']);
        const vide = await creer(luma, { pages: [pg(9)] });
        const rv = await pub(luma, vide.json.classeur.id, { certifieAuteur: true, cgu: '2026-10' });
        H.v('publier un classeur sans rien dedans : 400 ENTREE classeur-vide', [rv.statut, detail(rv)], [400, 'classeur-vide']);
        H.v('   aucune publication n\'a été écrite par ces refus', await brut('publications').countDocuments({ auteurId: luma.id }), 0);
    }
    const pv = await creer(luma, { titre: 'Pour la galerie', etiquettes: ['jaune'], couleur: 'jaune', pages: [pg(9, [carte(0, 0), carte(1, 0, '1234|002')]), pg(4, [carte(0, 0, '1234|050')])] });
    const idP = pv.json.classeur.id;
    const art = await artPublic(luma);
    await appel(sv, 'PUT', `/api/classeurs/${idP}`, { c: luma, corps: { version: 1, titre: 'Pour la galerie', etiquettes: ['jaune'], couleur: 'jaune', pages: [pg(9, [carte(0, 0), carte(1, 0, '1234|002'), bart(0, 1, 2, 1, art)]), pg(4, [carte(0, 0, '1234|050')])] } });
    const ro = await pub(luma, idP, { certifieAuteur: true, cgu: '2026-10', categories: ['methode-michi', 'couleur'] });
    H.v('POST …/publication : 200 { success, classeur } en attente', [ro.statut, cles(ro.json), ro.json.classeur && ro.json.classeur.visibilite], [200, ['success', 'classeur'], 'en-attente']);
    const dpub = await brut('publications').findOne({ _id: idP });
    H.v('   la publication est un document à part (le même identifiant), en attente, certifiée avec la version des CGU, jamais lue par le public', [dpub.etat, dpub.certification.cgu, dpub.nb, dpub.pages, dpub.categories, (await lire(sv, `/api/galerie/${idP}/pages/1`)).statut], ['en-attente', '2026-10', 9, 2, ['methode-michi', 'couleur'], 404]);
    H.v('   en attente : le public ne lit ni le classeur ni la page', [(await lire(sv, `/api/classeurs/${idP}`)).statut, (await lire(sv, '/api/galerie')).json.publications.some(p => p.id === idP)], [404, false]);
    H.v('   l\'auteur lit « en-attente » dans sa liste et dans le classeur', [(await appel(sv, 'GET', `/api/classeurs/${idP}`, { c: luma, sansSite: true })).json.classeur.visibilite, (await appel(sv, 'GET', '/api/classeurs', { c: luma, sansSite: true })).json.classeurs.find(x => x.id === idP).visibilite], ['en-attente', 'en-attente']);
    {
        const file = await appel(sv, 'GET', '/api/admin/moderation?file=publications', { c: modo, sansSite: true });
        const el = file.json.elements.find(e => e.id === `pub.${idP}`);
        H.v('   la modération voit la publication, avec la certification et l\'aperçu des cartes', [Boolean(el), el && el.certification.cgu, el && el.cible.apercu], [true, '2026-10', ['1234|001', '1234|002', '1234|050']]);
    }
    const ac = await decider(idP, 'accepter');
    H.v('accepter : 200', ac.statut, 200);
    const pubG = (await lire(sv, '/api/galerie')).json.publications.find(p => p.id === idP);
    H.v('   la galerie montre la publication : nb (et plus n), pages, catégories, arts posés et pochettes de cartes', [pubG && pubG.nb, pubG && pubG.pages, pubG && pubG.categories, pubG && pubG.arts.map(a => [a.art === art, a.col, a.row, a.fmt]), pubG && pubG.cartes.slice(0, 3), pubG && cles(pubG)],
        [9, 2, ['methode-michi', 'couleur'], [[true, 0, 1, '2h']], [{ cle: '1234|001', setSlug: 'Base-Set' }, { cle: '1234|002', setSlug: 'Base-Set' }, null], ['id', 'pseudo', 'publieLe', 'titre', 'categories', 'nb', 'pages', 'jaime', 'petitCompteur', 'arts', 'cartes']]);
    const pg2 = await lire(sv, `/api/galerie/${idP}/pages/2`);
    H.v('   la page 2 : { n, nb, arts, cartes } avec SON nb', [pg2.statut, cles(pg2.json.page), pg2.json.page.nb, pg2.json.page.cartes[0]], [200, ['n', 'nb', 'arts', 'cartes'], 4, { cle: '1234|050', setSlug: 'Base-Set' }]);
    const vue = await lire(sv, `/api/classeurs/${idP}`);
    H.v('GET public du classeur accepté : 200, forme du Classeur + l\'auteur (son pseudo, rien d\'autre), public max-age 60, Vary Cookie', [vue.statut, vue.json.classeur.visibilite, vue.json.classeur.auteur, cles(vue.json.classeur).slice(-1), vue.entetes['cache-control'], /cookie/i.test(vue.entetes.vary || '')], [200, 'public', { pseudo: 'luma' }, ['auteur'], 'public, max-age=60', true]);
    H.v('   la vue publique ne porte aucune donnée de compte (pas d\'identifiant, d\'adresse)', /auteurId|email|@exemple/.test(vue.texte), false);

    // ═══ 9. UN CLASSEUR PUBLIC MODIFIÉ REPASSE EN ATTENTE ; L'ANCIENNE VERSION RESTE SERVIE ═══
    {
        const lu = (await appel(sv, 'GET', `/api/classeurs/${idP}`, { c: luma, sansSite: true })).json.classeur;
        H.v('l\'auteur d\'un classeur accepté lit « public »', lu.visibilite, 'public');
        const m = await appel(sv, 'PUT', `/api/classeurs/${idP}`, { c: luma, corps: { version: lu.version, titre: 'Nouveau titre', etiquettes: ['jaune'], couleur: 'jaune', pages: lu.pages } });
        H.v('PUT d\'un classeur public : 200 et il se lit « en-attente » chez l\'auteur', [m.statut, m.json.classeur.visibilite], [200, 'en-attente']);
        H.v('   mais le public lit TOUJOURS l\'ancienne version acceptée (titre inchangé, page servie)', [(await lire(sv, '/api/galerie')).json.publications.find(p => p.id === idP).titre, (await lire(sv, `/api/classeurs/${idP}`)).json.classeur.titre, (await lire(sv, `/api/galerie/${idP}/pages/2`)).statut], ['Pour la galerie', 'Pour la galerie', 200]);
        const file = await appel(sv, 'GET', '/api/admin/moderation?file=publications', { c: modo, sansSite: true });
        const attente = file.json.elements.find(e => e.cible.titre === 'Nouveau titre');
        H.v('   la mise à jour attend en modération sous un autre élément (le nouveau titre)', Boolean(attente), true);
        const ref = await decider(attente.cible.id, 'refuser', { motif: 'hors-sujet' });
        H.v('   refusée : l\'auteur lit « refuse » avec le motif, le public lit encore l\'ancienne version', [ref.statut, (await appel(sv, 'GET', `/api/classeurs/${idP}`, { c: luma, sansSite: true })).json.classeur.visibilite, (await appel(sv, 'GET', `/api/classeurs/${idP}`, { c: luma, sansSite: true })).json.classeur.motif, (await lire(sv, `/api/classeurs/${idP}`)).json.classeur.titre], [200, 'refuse', { code: 'hors-sujet', texte: '' }, 'Pour la galerie']);
        const cour = (await appel(sv, 'GET', `/api/classeurs/${idP}`, { c: luma, sansSite: true })).json.classeur;
        const m2 = await appel(sv, 'PUT', `/api/classeurs/${idP}`, { c: luma, corps: { version: cour.version, titre: 'Titre accepté', etiquettes: [], couleur: null, pages: cour.pages } });
        const file2 = await appel(sv, 'GET', '/api/admin/moderation?file=publications', { c: modo, sansSite: true });
        const att2 = file2.json.elements.filter(e => e.cible.titre === 'Titre accepté');
        H.v('   une nouvelle modification : UNE seule mise à jour en attente (la précédente est remplacée, pas empilée)', [m2.statut, att2.length], [200, 1]);
        await decider(att2[0].cible.id, 'accepter');
        H.v('   acceptée : la galerie et le classeur public portent le nouveau titre, l\'identifiant ne change pas', [(await lire(sv, '/api/galerie')).json.publications.find(p => p.id === idP).titre, (await lire(sv, `/api/classeurs/${idP}`)).json.classeur.titre, (await appel(sv, 'GET', `/api/classeurs/${idP}`, { c: luma, sansSite: true })).json.classeur.visibilite], ['Titre accepté', 'Titre accepté', 'public']);
        H.v('   plus aucune mise à jour en attente', await brut('publications').countDocuments({ remplace: idP }), 0);
    }

    // ═══ 10. LES VOTES SUIVENT LE MÊME IDENTIFIANT ; LA DÉPUBLICATION LES EFFACE ═══
    {
        const j = await appel(sv, 'PUT', `/api/classeurs/${idP}/jaime`, { c: noa });
        H.v('un autre compte aime le classeur public (même identifiant que le classeur)', [j.statut, j.json.jaime], [200, true]);
        const dp = await appel(sv, 'DELETE', `/api/classeurs/${idP}/publication`, { c: luma });
        H.v('DELETE …/publication : 200, privé de nouveau, plus lu par le public, votes effacés', [dp.statut, dp.json.classeur.visibilite, (await lire(sv, `/api/classeurs/${idP}`)).statut, (await lire(sv, `/api/galerie/${idP}/pages/1`)).statut, await brut('votes').countDocuments({ cible: idP }), await brut('publications').countDocuments({ $or: [{ _id: idP }, { remplace: idP }] })], [200, 'prive', 404, 404, 0, 0]);
        H.v('   dépublier un classeur déjà privé : 200 sans effet (idempotent)', (await appel(sv, 'DELETE', `/api/classeurs/${idP}/publication`, { c: luma })).statut, 200);
        H.v('   le classeur de travail est intact', (await brut('classeurs').findOne({ _id: idP })).titre, 'Titre accepté');
    }

    // ═══ 11. 5 PUBLICATIONS PAR JOUR ═══
    {
        const p = await compte({}, 'cinq-par-jour');
        const ids = []; for (let i = 0; i < 6; i++) ids.push((await creer(p, { titre: `n°${i}` })).json.classeur.id);
        const rs = []; for (const id of ids) rs.push(await pub(p, id, { certifieAuteur: true, cgu: '2026-10' }, sv));
        H.v('la 6e publication du jour : 429 LIMITE_DEBIT avec reessayerDans ; les cinq premières passent', [rs.map(r => r.statut), code(rs[5]), Number.isInteger(rs[5].json.erreur.reessayerDans)], [[200, 200, 200, 200, 200, 429], 'LIMITE_DEBIT', true]);
    }

    // ═══ 12. PAGES PUBLIÉES (O17) ═══
    {
        const p = await compte({}, 'partage');
        const cr = await creer(p, { pages: [pg(9, [carte(0, 0, '10|1')]), pg(9, [carte(0, 0, '10|2')]), pg(9, [carte(0, 0, '10|3')])] });
        const id = cr.json.classeur.id;
        H.v('pagesPubliees hors du classeur (page 7) : 400 pages-publiees', detail(await pub(p, id, { certifieAuteur: true, cgu: 'c', pagesPubliees: [7] })), 'pages-publiees');
        H.v('pagesPubliees mal formé (doublon) : 400 pages-publiees', detail(await pub(p, id, { certifieAuteur: true, cgu: 'c', pagesPubliees: [1, 1] })), 'pages-publiees');
        const ok = await pub(p, id, { certifieAuteur: true, cgu: 'c', pagesPubliees: [3, 1] });
        const d = await brut('publications').findOne({ _id: id });
        H.v('seules les pages demandées sont publiées, dans l\'ordre du classeur, renumérotées 1 et 2', [ok.statut, d.pages, d.pagesBlocs.map(x => x.blocs[0].contenu.cle)], [200, 2, ['10|1', '10|3']]);
        const sansPage = await pub(p, id, { certifieAuteur: true, cgu: 'c', pagesPubliees: null });
        H.v('pagesPubliees null : toutes les pages', [sansPage.statut, (await brut('publications').findOne({ _id: id })).pages], [200, 3]);
    }

    // ═══ 13. LES ILLUSTRATIONS PRIVÉES CITÉES PASSENT EN MODÉRATION AVEC LE CLASSEUR ═══
    {
        const p = await compte({}, 'avec-art');
        const priv = await artPublic(p, { etat: 'prive', publieLe: null }), refuse = await artPublic(p, { etat: 'refuse', publieLe: null });
        const cr = await creer(p, { pages: [pg(9, [bart(0, 0, 1, 1, priv), carte(1, 0)])] });
        const r = await pub(p, cr.json.classeur.id, { certifieAuteur: true, cgu: '2026-10' });
        const a = await brut('arts').findOne({ _id: priv });
        H.v('publier un classeur qui cite une illustration PRIVÉE de l\'auteur : elle passe « en-attente » avec la certification', [r.statut, a.etat, a.certification.droits, a.certification.nonOfficielle], [200, 'en-attente', true, true]);
        const cr2 = await creer(p, { pages: [pg(9, [bart(0, 0, 1, 1, refuse), carte(1, 0)])] });
        const r2 = await pub(p, cr2.json.classeur.id, { certifieAuteur: true, cgu: '2026-10' });
        H.v('un classeur qui cite une illustration REFUSÉE ne se publie pas : 400 illustration-refusee', [r2.statut, detail(r2)], [400, 'illustration-refusee']);
        H.v('   et l\'illustration refusée n\'a pas bougé', (await brut('arts').findOne({ _id: refuse })).etat, 'refuse');
    }

    // ═══ 14. LA REPRISE (remix) : le nouveau classeur est de la même forme ═══
    {
        const nouveau = await compte({}, 'reprend');
        await appel(sv, 'PUT', `/api/classeurs/${idP}`, { c: luma, corps: { version: (await brut('classeurs').findOne({ _id: idP })).version, titre: 'À reprendre', etiquettes: [], couleur: null, pages: [pg(9, [carte(0, 0), bart(0, 1, 2, 1, art)]), pg(4, [carte(1, 1, '1234|077')])] } });
        const rep = await pub(luma, idP, { certifieAuteur: true, cgu: '2026-10' });
        await decider(idP, 'accepter');
        const rx = await appel(sv, 'POST', `/api/galerie/${idP}/remix`, { c: nouveau });
        const copie = rx.statut === 201 ? await brut('classeurs').findOne({ _id: rx.json.classeurId }) : null;
        H.v('POST /api/galerie/{id}/remix : 201 { success, classeurId }', [rep.statut, rx.statut, cles(rx.json)], [200, 201, ['success', 'classeurId']]);
        H.v('   la copie : mêmes pages (nb), arts gardés, cartes VIDES (contenu null), repriseDe, version 1, privée', [copie.pages.map(x => x.nb), copie.pages[0].blocs.filter(b => b.genre === 'art').map(b => [b.contenu.artId === art, b.l, b.h]), copie.pages.flatMap(x => x.blocs).filter(b => b.genre === 'carte').every(b => b.contenu === null), copie.repriseDe, copie.version, copie.auteurId === nouveau.id],
            [[9, 4], [[true, 2, 1]], true, { id: idP, pseudo: 'luma' }, 1, true]);
        const lue = await appel(sv, 'GET', `/api/classeurs/${rx.json.classeurId}`, { c: nouveau, sansSite: true });
        H.v('   le nouveau propriétaire la lit comme un classeur privé (forme du Classeur, repriseDe)', [lue.statut, lue.json.classeur.visibilite, lue.json.classeur.repriseDe, lue.json.classeur.titre], [200, 'prive', { id: idP, pseudo: 'luma' }, 'Remix de À reprendre']);
        H.v('   reprendre un classeur NON public (privé, ou celui d\'un autre) : 404 INTROUVABLE', [(await appel(sv, 'POST', `/api/galerie/${(await creer(luma)).json.classeur.id}/remix`, { c: nouveau })).statut, code(await appel(sv, 'POST', `/api/galerie/${F.nouvelId()}/remix`, { c: nouveau }))], [404, 'INTROUVABLE']);
        H.v('   aucune route /reprise n\'existe (O18 : le remix seul)', (await appel(sv, 'POST', `/api/classeurs/${idP}/reprise`, { c: nouveau, corps: {} })).statut, 404);
    }

    // ═══ 15. SUPPRIMER UN CLASSEUR ═══
    {
        const p = await compte({}, 'supprime');
        const cr = await creer(p), id = cr.json.classeur.id;
        await pub(p, id, { certifieAuteur: true, cgu: 'c' }); await decider(id, 'accepter');
        const d = await appel(sv, 'DELETE', `/api/classeurs/${id}`, { c: p });
        H.v('DELETE /api/classeurs/{id} : 200 { success: true } ; le classeur, sa publication et ses votes disparaissent', [d.statut, d.json, await brut('classeurs').countDocuments({ _id: id }), await brut('publications').countDocuments({ _id: id }), (await lire(sv, `/api/galerie/${id}/pages/1`)).statut], [200, { success: true }, 0, 0, 404]);
        H.v('   le supprimer deux fois : 404 INTROUVABLE', code(await appel(sv, 'DELETE', `/api/classeurs/${id}`, { c: p })), 'INTROUVABLE');
    }

    // ═══ 16. UNE ILLUSTRATION SUPPRIMÉE SE LIT null DANS LES CLASSEURS ═══
    {
        const p = await compte({}, 'art-parti');
        const a = await artPublic(p);
        const cr = await creer(p, { pages: [pg(9, [bart(0, 0, 1, 1, a), carte(1, 0)])], couverture: { illustration: a } });
        await brut('arts').deleteOne({ _id: a });
        const lu = await appel(sv, 'GET', `/api/classeurs/${cr.json.classeur.id}`, { c: p, sansSite: true });
        H.v('un art disparu : la lecture ne tombe pas, la zone se lit null (contenu et couverture)', [lu.statut, lu.json.classeur.pages[0].blocs[0].contenu, lu.json.classeur.pages[0].blocs[1].contenu.cle, lu.json.classeur.couverture], [200, null, '1234|001', null]);
    }

    // ═══ 17. ISOLEMENT ET DONNÉES PERSONNELLES ═══
    {
        const fil = await lire(sv, '/api/galerie');
        const tout = JSON.stringify(fil.json) + (await lire(sv, `/api/galerie/${idP}/pages/1`)).texte;
        H.v('aucune lecture publique ne porte l\'identifiant du compte ni l\'adresse', [tout.includes(luma.id), /@exemple\.fr/.test(tout)], [false, false]);
        H.v('une écriture sans X-Rat-Market est refusée (403 ORIGINE) sur chaque écriture de classeur', (await Promise.all([['POST', '/api/classeurs'], ['PUT', `/api/classeurs/${idP}`], ['DELETE', `/api/classeurs/${idP}`], ['POST', `/api/classeurs/${idP}/publication`], ['DELETE', `/api/classeurs/${idP}/publication`]].map(([m, ch]) => appel(sv, m, ch, { c: luma, corps: m === 'DELETE' ? undefined : {}, sansSite: true })))).map(r => code(r)), Array(5).fill('ORIGINE'));
    }
    {   // suppression du compte : classeurs et publications partent avec lui
        const p = await compte({}, 'quitte');
        const cr = await creer(p), id = cr.json.classeur.id;
        await pub(p, id, { certifieAuteur: true, cgu: 'c' });
        const n = await svc.supprimerDuCompte(p.id, B.stockage, 'secret');
        H.v('la suppression du compte emporte classeurs et publications', [n.classeurs, await brut('classeurs').countDocuments({ auteurId: p.id }), await brut('publications').countDocuments({ auteurId: p.id })], [1, 0, 0]);
    }

    // ═══ 18. LES GARDES SAVENT DIRE NON : la même scène sur une COPIE MUTÉE (le fragment retiré du TEXTE du module, jamais du fichier) change de résultat ═══
    {
        const p = await compte({}, 'mutants'), autre = await compte({}, 'mutants-autre');
        const cr = await creer(p), id = cr.json.classeur.id;
        await appel(sv, 'PUT', `/api/classeurs/${id}`, { c: p, corps: { version: 1, titre: 'v2', pages: [pg(9)] } });                      // le classeur est à la version 2
        const champs = { titre: 'écrit', etiquettes: [], couleur: null, couverture: null, pages: [pg(9)] };
        const reel = require('../galerie/classeurs');
        const sansVersion = A.charger('classeurs.js', [['{ _id: id, auteurId: mien, version }, { $set', '{ _id: id, auteurId: mien }, { $set']]);
        const sansAuteur = A.charger('classeurs.js', [['{ _id: id, auteurId: mien, version }, { $set', '{ _id: id, version }, { $set']]);
        const r1 = await reel.ecrire({ compteId: p.id, id, champs, version: 1 }), m1 = await sansVersion.ecrire({ compteId: p.id, id, champs, version: 1 });
        H.v('garde de version : le réel refuse une version périmée, le mutant (sans version dans le filtre) l\'écrit', [Boolean(r1.conflit), Boolean(m1.classeur)], [true, true]);
        const cur = (await brut('classeurs').findOne({ _id: id })).version;
        const r2 = await reel.ecrire({ compteId: autre.id, id, champs, version: cur }), m2 = await sansAuteur.ecrire({ compteId: autre.id, id, champs, version: cur });
        H.v('garde d\'auteur : le réel répond introuvable à un autre compte, le mutant (sans auteur dans le filtre) écrit le classeur d\'autrui', [Boolean(r2.introuvable), Boolean(m2.classeur)], [true, true]);
    }

    await B.fermer();
    H.bilan();
})();

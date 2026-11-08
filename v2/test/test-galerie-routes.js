'use strict';
// GALERIE — les routes de la Communauté (liste fermée du site, 2026-11-01), de bout en bout : base EN MÉMOIRE (deux bases sur le même mongod : `test_scratch` préfixée pour l'identité, `rm_galerie_essai` pour la Communauté),
// faux R2, faux Turnstile (aucune requête réseau), serveur Express réel avec le CORS et l'assembleur de la v2.
// Chaque GARDE est éprouvée deux fois : sur le code réel (OUI au cas légitime, NON au cas hostile) et sur une COPIE MUTÉE (le fragment de la garde est retiré du TEXTE du module, jamais du fichier) : la même scène doit changer de résultat.
const A = require('./_aide-galerie');
const H = A.H;
const mongoose = require('mongoose'), express = require('express'), sharp = require('sharp');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const { lireGalerie } = require('../galerie/config');

(async () => {
    await H.ouvrirBac('test-galerie-routes.js');
    await M.creerIndex();
    H.fixerHorlogeMilieu();
    const G = require('../galerie/base'), F = require('../galerie/forme'), svc = require('../galerie/service'), routesReel = require('../galerie/routes'), monterGalerie = require('../galerie/monter');
    const pret = require('../pret'); const { assembler } = require('../index'); const transport = require('../transport/monter'); const sessions = require('../comptes/sessions');
    const dbG = mongoose.connection.client.db('rm_galerie_essai');
    G.brancher(dbG); await G.creerIndex();
    const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), galerie: lireGalerie(A.ENV_VALIDE) };
    const SITE = cfg.origines.site;
    const variante = (envExtra, limites) => { const g = lireGalerie({ ...A.ENV_VALIDE, ...envExtra }); return { ...cfg, galerie: limites ? { ...g, limites: { ...g.limites, ...limites } } : g }; };
    H.vrai('instrument : la configuration de banc est PRÊTE (garde de la base dédiée et du stockage admises)', cfg.galerie.pret === true && cfg.galerie.actif === true);

    const stockage = A.fauxStockage(), turnstile = A.fauxTurnstile();
    const gestionnaireFinal = (err, req, res, next) => { if (res.headersSent) return next(err); const s = Number.isInteger(err?.status) ? err.status : 500; return res.status(s).json({ success: false, error: 'x' }); };
    const serveurs = [];
    async function serveur(cfgX = cfg, { routes = routesReel, st = stockage, ts = turnstile, env = A.ENV_VALIDE } = {}) {
        const lot = { enTete() { }, routes(r, c, d) { routes.routesGalerie(r, c, { ...d, stockage: st, fetchTurnstile: ts, env }); } };
        const app = express(); app.set('trust proxy', true);
        transport.enTete(app, cfgX); app.use(express.json()); pret.armer(M.verifierIndex);
        app.use(assembler([lot], cfgX, {})); app.use(gestionnaireFinal);
        const s = await H.serveur(app); serveurs.push(s); return s;
    }
    const sv = await serveur();
    let nC = 0, nIp = 0;
    const IP = () => { nIp++; return `10.77.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
    async function compte(o = {}, pseudo = null) {
        const adresse = `gal${++nC}.${Date.now().toString(36)}@exemple.fr`;
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
    const nouvelleId = () => F.nouvelId();
    let tjn = 0; const tj = (prefixe = 'jeton-valide') => `${prefixe}-${++tjn}`;       // un jeton Turnstile n'est accepté qu'UNE fois (replay refusé) : chaque appel en apporte un neuf

    // un art public RÉEL (la pose d'une page exige qu'il existe et soit public) : posé une fois, à part de la banque lue par les scènes
    let artDePage = null;
    async function artPourPages() {
        if (!artDePage) { artDePage = nouvelleId(); await brut('arts').insertOne({ _id: artDePage, etat: 'public', auteurId: 'exploitation', pseudo: 'exploitation', nom: 'Art de page', mots: ['art', 'page'], fmt: '2h', clePublique: `galerie/pub/${artDePage}`, largeur: 400, hauteur: 279, nbJaime: 0, nbEnregistre: 0, publieLe: new Date() }); }
        return artDePage;
    }
    async function publier(auteur, o = {}) {
        return svc.publierPourExploitation({ auteurId: auteur.id, titre: 'Page Michi', categories: ['methode-michi', 'couleur'], nb: 9, pages: 2, arts: [{ art: await artPourPages(), col: 0, row: 0, fmt: '2h' }],
            cartes: [{ cle: '1234|001', nom: 'Pikachu' }, null, { cle: '-5|12', nom: 'Dresseur' }], pagesSuite: [{ n: 2, arts: [], cartes: [{ cle: '1234|002', nom: 'Raichu' }] }],
            attributs: { couleur: ['jaune'], type: ['electrique'], illustrateur: ['Mitsuhiro Arita'], set: ['Base-Set'] }, certification: { cgu: '2026-10' }, etat: 'public', ...o });
    }
    const png = async (w, h, bg) => sharp({ create: { width: w, height: h, channels: 3, background: bg || { r: 20, g: 120, b: 220 } } }).png().toBuffer();
    // un art déposé et finalisé par `c` (pseudo requis) — rend l'id
    async function deposer(s, c, { type = 'image/png', format = '1', w = 300, h = 419, nom = 'Mon art', octets = null, buffer = null, st = stockage, certifs = { certifieDroits: true, certifieNonOfficielle: true } } = {}) {
        const b = buffer || await png(w, h);
        const o = await appel(s, 'POST', '/api/illustrations/depot', { c, corps: { type, octets: octets === null ? b.length : octets } });
        if (o.statut !== 201) return { ouvert: o };
        st.deposer(o.json.urlDepot, b);
        const f = await appel(s, 'POST', `/api/illustrations/depot/${o.json.depotId}/finaliser`, { c, corps: { nom, format, ...certifs } });
        return { ouvert: o, fin: f, depotId: o.json.depotId };
    }

    // ═══════════════ 0. ÉTEINT / PAS PRÊT : les routes N'EXISTENT PAS ═══════════════
    {
        const eteint = { ...cfg, galerie: lireGalerie({}) };
        const s0 = await (async () => { const app = express(); app.set('trust proxy', true); transport.enTete(app, eteint); app.use(express.json()); pret.armer(M.verifierIndex); app.use(assembler([monterGalerie], eteint, {})); const s = await H.serveur(app); serveurs.push(s); return s; })();   // le VRAI lot, éteint
        const r = await H.appel(s0.url, '/api/galerie'), r2 = await H.appel(s0.url, '/api/banque/formats'), r3 = await H.appel(s0.url, '/api/illustrations/bornes');
        H.v('0. V2_GALERIE éteint : aucune route (404 natif, corps HTML d\'Express, pas la forme d\'erreur v2)', [r.statut, r2.statut, r3.statut, r.json], [404, 404, 404, null]);
        const montees = new Set(); const routeur = express.Router();
        require('../galerie/monter').routes(routeur, eteint, {});
        H.v('   monter.routes avec le lot éteint : zéro route, état « eteint »', [routeur.stack.length, require('../galerie/monter').etat()], [0, 'eteint']);
        const pasPret = { ...cfg, galerie: lireGalerie({ ...A.ENV_VALIDE, MONGO_URI_GALERIE: A.ENV_VALIDE.MONGODB_URI, V2_GALERIE_GRAPPE: undefined }) };
        const r4 = express.Router(); monterGalerie.routes(r4, pasPret, {});
        H.v('   allumé mais la garde de la base dédiée dit NON (grappe = production) : le lot ne se monte PAS, état « refuse »', [pasPret.galerie.actif, pasPret.galerie.pret, r4.stack.length, monterGalerie.etat()], [true, false, 0, 'refuse']);
        const fermes = require('../transport/cors');
        const profilOff = fermes.profils(eteint).find(x => x.nom === 'site'), profilOn = fermes.profils(cfg).find(x => x.nom === 'site');
        H.v('   CORS : éteint, le profil du site ne couvre PAS les chemins de la Communauté ; allumé, il les couvre', [profilOff.chemins.some(re => re.test('/api/galerie')), profilOn.chemins.some(re => re.test('/api/galerie')), profilOn.chemins.some(re => re.test('/api/admin/moderation')), profilOff.chemins.length < profilOn.chemins.length], [false, true, true, true]);
        const sOn = await H.appel(sv.url, '/api/compte/pseudo', { methode: 'OPTIONS', entetes: { origin: SITE, 'access-control-request-method': 'PUT' } });
        H.v('   préflight du site sur PUT /api/compte/pseudo : 204, origine exacte, credentials, PUT autorisé', [sOn.statut, sOn.entetes['access-control-allow-origin'], sOn.entetes['access-control-allow-credentials'], /PUT/.test(sOn.entetes['access-control-allow-methods'])], [204, SITE, 'true', true]);
        const sEvil = await H.appel(sv.url, '/api/galerie', { entetes: { origin: 'https://evil.example' } });
        H.v('   une origine inconnue ne reçoit aucun en-tête CORS (jamais « * »)', [sEvil.entetes['access-control-allow-origin'], sEvil.statut], [undefined, 200]);
        // mutant de configuration : sans la garde de la base dédiée, la grappe de production serait « prête »
        const mut = A.charger('config.js', [['if (!g.ok) return gele(', 'if (false) return gele(']]);
        H.v('   MUTANT « la garde de la base dédiée est retirée de la configuration » : grappe = production, le réel dit pas prêt, le mutant dit PRÊT', [pasPret.galerie.pret, mut.lireGalerie({ ...A.ENV_VALIDE, MONGO_URI_GALERIE: A.ENV_VALIDE.MONGODB_URI, V2_GALERIE_GRAPPE: undefined }).pret], [false, true]);
        // le montage prêt (ouverture injectée) branche la base
        const routeur2 = express.Router(); let ouverte = 0;
        monterGalerie.routes(routeur2, cfg, { env: A.ENV_VALIDE, stockage, ouvrirBase: async () => { ouverte++; return { db: dbG, fermer: async () => { } }; } });
        await monterGalerie.pret();
        H.v('   allumé et prêt : les routes sont montées (34 : la liste du 01/11, les classeurs et les illustrations privées de l\'Atelier) et la base dédiée s\'ouvre une fois', [routeur2.stack.length, ouverte, monterGalerie.etat()], [34, 1, 'monte']);
        const chemins = routeur2.stack.map(l => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`).sort();
        H.v('   la liste des routes est EXACTEMENT la liste fermée (A à E, plus les classeurs privés)', chemins, [
            'DELETE /api/illustrations/:id', 'DELETE /api/illustrations/:id/publication', 'GET /api/illustrations', 'POST /api/illustrations/:id/publication', 'PUT /api/illustrations/:id',
            'DELETE /api/classeurs/:id', 'DELETE /api/classeurs/:id/publication', 'GET /api/classeurs', 'GET /api/classeurs/:id', 'POST /api/classeurs', 'POST /api/classeurs/:id/publication', 'PUT /api/classeurs/:id',
            'DELETE /api/classeurs/:id/enregistre', 'DELETE /api/classeurs/:id/jaime', 'DELETE /api/illustrations/:id/enregistre', 'DELETE /api/illustrations/:id/jaime',
            'GET /api/admin/moderation', 'GET /api/banque', 'GET /api/banque/formats', 'GET /api/enregistres', 'GET /api/galerie', 'GET /api/galerie/:id/pages/:n', 'GET /api/galerie/filtres', 'GET /api/illustrations/bornes',
            'POST /api/admin/moderation/:id/decision', 'POST /api/galerie/:id/remix', 'POST /api/illustrations/depot', 'POST /api/illustrations/depot/:depot/finaliser', 'POST /api/signalements',
            'PUT /api/classeurs/:id/enregistre', 'PUT /api/classeurs/:id/jaime', 'PUT /api/compte/pseudo', 'PUT /api/illustrations/:id/enregistre', 'PUT /api/illustrations/:id/jaime'].sort());
    }
    // ═══════════════ 1. PSEUDO ═══════════════
    const luma = await compte({}, 'luma'), noa = await compte({}, 'noa'), sansPseudo = await compte();
    {
        const A1 = await compte();
        const r = await appel(sv, 'PUT', '/api/compte/pseudo', { c: A1, corps: { pseudo: 'Nova_9' } });
        H.v('1. PUT /api/compte/pseudo : 200 { success, pseudo } en minuscules', [r.statut, r.json], [200, { success: true, pseudo: 'nova_9' }]);
        H.v('   le pseudo vit dans la base DÉDIÉE (jamais dans la base de l\'API)', [!!(await brut('profils').findOne({ pseudoCle: 'nova_9' })), !!(await db.col('comptes').findOne({ pseudo: { $exists: true } }))], [true, false]);
        H.v('   le même pseudo, même compte : idempotent', (await appel(sv, 'PUT', '/api/compte/pseudo', { c: A1, corps: { pseudo: 'nova_9' } })).statut, 200);
        const pris = await appel(sv, 'PUT', '/api/compte/pseudo', { c: sansPseudo, corps: { pseudo: 'NOVA_9' } });
        H.v('   pseudo pris par un AUTRE compte (casse ignorée) : 409 CONFLIT pseudo-pris', [pris.statut, code(pris), detail(pris)], [409, 'CONFLIT', 'pseudo-pris']);
        const svP = await serveur(variante({}, { pseudoCompteJour: 1000, pseudoIpJour: 1000 }));
        for (const [p, d] of [['ab', 'pseudo-invalide'], ['a@b.fr', 'pseudo-invalide'], ['x'.repeat(21), 'pseudo-invalide'], ['avec espace', 'pseudo-invalide'], ['é-accent', 'pseudo-invalide'], [12, 'pseudo-invalide'], ['admin', 'pseudo-reserve'], ['Rat-Market', 'pseudo-reserve'], ['moderation', 'pseudo-reserve'], ['ratmarket', 'pseudo-reserve']]) {
            const x = await appel(svP, 'PUT', '/api/compte/pseudo', { c: sansPseudo, corps: { pseudo: p } });
            H.v(`   pseudo ${JSON.stringify(p)} : 400 ENTREE ${d}`, [x.statut, code(x), detail(x)], [400, 'ENTREE', d]);
        }
        H.v('   un champ en trop dans le corps : 400', (await appel(svP, 'PUT', '/api/compte/pseudo', { c: sansPseudo, corps: { pseudo: 'ok-pseudo', role: 'admin' } })).statut, 400);
        const sansSession = await appel(sv, 'PUT', '/api/compte/pseudo', { corps: { pseudo: 'zzz-zzz' } });
        const sansOrigine = await appel(sv, 'PUT', '/api/compte/pseudo', { c: sansPseudo, corps: { pseudo: 'zzz-zzz' }, sansSite: true });
        H.v('   ORDRE des refus : sans session SESSION 401 ; avec session sans Origin ORIGINE 403', [code(sansSession), sansSession.statut, code(sansOrigine), sansOrigine.statut], ['SESSION', 401, 'ORIGINE', 403]);
        H.v('   toute réponse porte facturation: null', [sansSession.json.facturation, pris.json.facturation], [null, null]);
        const lim = await serveur(variante({}, { pseudoCompteJour: 2 })); const L2 = await compte();
        const rs = []; for (const p of ['lim-un', 'lim-deux', 'lim-trois']) rs.push(await appel(lim, 'PUT', '/api/compte/pseudo', { c: L2, corps: { pseudo: p } }));
        H.v('   limite de débit (2 par jour ici) : la 3e est 429 LIMITE_DEBIT avec reessayerDans et Retry-After (jamais DEBIT)', [rs.map(x => x.statut), code(rs[2]), rs[2].json.erreur.reessayerDans > 0, Number(rs[2].entetes['retry-after']) > 0], [[200, 200, 429], 'LIMITE_DEBIT', true, true]);
    }

    // ═══════════════ 2. LECTURE PUBLIQUE ═══════════════
    const idsPub = [];
    for (let i = 0; i < 26; i++) idsPub.push(await publier(luma, { titre: `Page ${i}`, categories: i % 2 ? ['couleur'] : ['vintage', 'japonais'] }));
    const attente = await publier(luma, { titre: 'En attente', etat: 'en-attente' });
    const pubPrivee = await publier(luma, { titre: 'Refusée', etat: 'en-attente' }); await brut('publications').updateOne({ _id: pubPrivee }, { $set: { etat: 'refuse' } });
    const pubRetiree = await publier(luma, { titre: 'Retirée' }); await brut('publications').updateOne({ _id: pubRetiree }, { $set: { etat: 'retire' } });
    {
        const r = await lire(sv, '/api/galerie');
        const p = r.json.publications[0];
        H.v('2. GET /api/galerie : 200, Cache-Control public max-age=60, { success, publications, suite }', [r.statut, r.entetes['cache-control'], Object.keys(r.json)], [200, 'public, max-age=60', ['success', 'publications', 'suite']]);
        H.v('   Publication : exactement les clés du site, dans l\'ordre', Object.keys(p), ['id', 'pseudo', 'publieLe', 'titre', 'categories', 'nb', 'pages', 'jaime', 'petitCompteur', 'arts', 'cartes']);
        H.v('   sous 5 j\'aime : jaime null et petitCompteur true ; un art posé { art, col, row, fmt, url, largeur, hauteur } ; une pochette vide est null ; nb (la grille) remplace n', [p.jaime, p.petitCompteur, Object.keys(p.arts[0]), p.cartes[1], p.nb, p.cartes.length, p.pages], [null, true, ['art', 'col', 'row', 'fmt', 'url', 'largeur', 'hauteur'], null, 9, 9, 2]);
        H.vrai('   aucune donnée du lecteur ni de l\'auteur : ni identifiant de compte, ni adresse, ni cookie posé', !JSON.stringify(r.json).includes(luma.id) && !/@/.test(JSON.stringify(r.json)) && r.entetes['set-cookie'] === undefined);
        const avecCookie = await lire(sv, '/api/galerie', noa);
        H.vrai('   la réponse est la MÊME pour un lecteur connecté (aucune personnalisation)', JSON.stringify(avecCookie.json) === JSON.stringify(r.json));
        H.v('   ni en attente, ni refusée, ni retirée dans le fil : 26 publiques', await (async () => { const ids = []; let suite = null; do { const x = await lire(sv, `/api/galerie?tri=nouveautes${suite ? `&suite=${suite}` : ''}`); ids.push(...x.json.publications.map(q => q.id)); suite = x.json.suite; } while (suite); return [ids.length, new Set(ids).size, ids.includes(attente), ids.includes(pubPrivee), ids.includes(pubRetiree)]; })(), [26, 26, false, false, false]);
        const filtre = await lire(sv, '/api/galerie?categorie=vintage');
        H.v('   categorie=vintage : seulement celles qui la portent', [filtre.json.publications.length, filtre.json.publications.every(q => q.categories.includes('vintage'))], [13, true]);
        H.v('   filtres par attribut : set, illustrateur, type, couleur, carte (clé) et carte (idInterne)', await Promise.all(['set=Base-Set', 'illustrateur=Mitsuhiro%20Arita', 'type=electrique', 'couleur=jaune', 'carte=1234%7C001', 'carte=1234', 'set=Inconnu'].map(async q => (await lire(sv, `/api/galerie?${q}`)).json.publications.length > 0)), [true, true, true, true, true, true, false]);
        for (const q of ['tri=nimporte', 'categorie=inconnue', 'suite=%25%25', 'x=1', 'carte=data:text', `set=${'a'.repeat(101)}`]) { const x = await lire(sv, `/api/galerie?${q}`); H.v(`   ${q.slice(0, 30)} : 400 ENTREE`, [x.statut, code(x)], [400, 'ENTREE']); }
        // tri top / tendances
        const a1 = await compte({}, 'aimeur1');
        await appel(sv, 'PUT', `/api/classeurs/${idsPub[3]}/jaime`, { c: a1 });
        H.v('   tri=top : la publication aimée passe en tête ; tri=tendances (7 jours) aussi', [(await lire(sv, '/api/galerie?tri=top')).json.publications[0].id, (await lire(sv, '/api/galerie?tri=tendances')).json.publications[0].id], [idsPub[3], idsPub[3]]);
        const fl = await lire(sv, '/api/galerie/filtres');
        H.v('   GET /api/galerie/filtres : { success, carte, couleur, type, illustrateur, set } de { valeur, n }, comptés sur le public', [Object.keys(fl.json), fl.json.set[0], fl.json.carte.find(x => x.valeur === '1234|001').n, fl.entetes['cache-control']], [['success', 'carte', 'couleur', 'type', 'illustrateur', 'set'], { valeur: 'Base-Set', n: 26 + 0 }, 26, 'public, max-age=60']);
        const pg = await lire(sv, `/api/galerie/${idsPub[0]}/pages/2`);
        H.v('   GET /api/galerie/{id}/pages/{n} : { success, page: { n, nb, arts, cartes } } (la pochette porte la clé et le set ; le nom se lit au catalogue)', [pg.statut, pg.json.page.n, pg.json.page.nb, pg.json.page.cartes[0], Object.keys(pg.json.page)], [200, 2, 9, { cle: '1234|002', setSlug: null }, ['n', 'nb', 'arts', 'cartes']]);
        const absentR = await lire(sv, `/api/galerie/${nouvelleId()}/pages/2`);
        const autres = await Promise.all([attente, pubPrivee, pubRetiree].map(i => lire(sv, `/api/galerie/${i}/pages/2`)));
        H.v('   404 UNIFORME : une page absente, en attente, refusée ou retirée répond le MÊME corps INTROUVABLE', [absentR.statut, code(absentR), autres.every(x => x.texte === absentR.texte && x.statut === 404)], [404, 'INTROUVABLE', true]);
        H.v('   hors bornes (page 3 sur 2) : 404 ; n mal formé : 400', [(await lire(sv, `/api/galerie/${idsPub[0]}/pages/3`)).statut, (await lire(sv, `/api/galerie/${idsPub[0]}/pages/x`)).statut], [404, 400]);
    }
    // la banque
    const artA = await deposer(sv, luma, { nom: 'Fond doux', format: '1' });
    const artB = await deposer(sv, noa, { nom: 'Bande large', format: '2h', w: 400, h: 279 });
    const artC = await deposer(sv, luma, { nom: 'Colonne', format: '2v', w: 300, h: 838 });
    const idArt = r => r.fin.json.id;
    const admin = await compte({ role: 'administrateur' }, 'rat-modo');
    for (const a of [artA, artB]) await appel(sv, 'POST', `/api/admin/moderation/art.${idArt(a)}/decision`, { c: admin, corps: { decision: 'accepter' } });
    {
        const r = await lire(sv, '/api/banque');
        H.v('3. GET /api/banque : { success, arts, suite } ; seuls les arts publics (acceptés)', [r.statut, Object.keys(r.json), r.json.arts.length], [200, ['success', 'arts', 'suite'], 3]);   // 2 déposés et acceptés + l'art public des pages d'essai
        const a = r.json.arts.find(x => x.nom === 'Bande large');
        H.v('   Art : exactement les clés du site ; url publique R2 de la copie acceptée ; pseudo en crédit', [Object.keys(a), a.url === `${stockage.urlPublique}/galerie/pub/${idArt(artB)}.webp`, a.auteur, a.fmt, a.largeur, a.hauteur, a.aime, a.petitCompteur], [['id', 'nom', 'fmt', 'auteur', 'aime', 'petitCompteur', 'url', 'largeur', 'hauteur'], true, 'noa', '2h', 400, 279, null, true]);
        H.v('   format=2h ; q=doux (nom) ; q=NOA (auteur, casse ignorée) ; q=%.* (regex échappée) ; tri=top', [(await lire(sv, '/api/banque?format=2h')).json.arts.length, (await lire(sv, '/api/banque?q=doux')).json.arts.length, (await lire(sv, '/api/banque?q=NOA')).json.arts.length, (await lire(sv, '/api/banque?q=.*')).json.arts.length, (await lire(sv, '/api/banque?tri=top')).statut], [2, 1, 1, 0, 200]);
        for (const q of ['format=3', 'tri=zzz', 'q=', 'q=' + 'a'.repeat(41), 'y=1']) { const x = await lire(sv, `/api/banque?${q}`); if (q === 'q=') H.v('   q vide : traité comme absent', x.statut, 200); else H.v(`   ${q.slice(0, 20)} : 400`, [x.statut, code(x)], [400, 'ENTREE']); }
        const f = await lire(sv, '/api/banque/formats');
        H.v('   GET /api/banque/formats : les quatre formats, comptés sur le public', [f.json, f.entetes['cache-control']], [{ success: true, formats: { '1': 1, '2h': 2, '2v': 0, '4': 0 } }, 'public, max-age=60']);
        const bo = await lire(sv, '/api/illustrations/bornes');
        H.v('   GET /api/illustrations/bornes : { success, octetsMax, pixelsMax } (8 Mio, 12 Mpx)', [bo.json, bo.entetes['cache-control']], [{ success: true, octetsMax: 8388608, pixelsMax: 12000000 }, 'public, max-age=60']);
        const attenteArt = await lire(sv, `/api/illustrations/${idArt(artC)}/jaime`);
        H.vrai('   l\'art en attente n\'est dans aucune lecture publique', !JSON.stringify((await lire(sv, '/api/banque?q=Colonne')).json).includes('Colonne'));
        const lim = await serveur(variante({}, { lectureIpHeure: 2 }));
        const mm = []; for (let i = 0; i < 3; i++) mm.push(await H.appel(lim.url, '/api/banque/formats', { entetes: { 'x-forwarded-for': '10.99.0.1' } }));
        H.v('   limite de lecture par IP (2 ici) : la 3e est 429 LIMITE_DEBIT', [mm.map(x => x.statut), code(mm[2])], [[200, 200, 429], 'LIMITE_DEBIT']);
        H.vrai('   l\'IP n\'est écrite NULLE PART en clair (compteurs de la base dédiée)', !JSON.stringify(await brut('limites').find({}).toArray()).includes('10.99.0.1'));
    }

    // ═══════════════ 4. VOTES, ENREGISTRÉS, REMIX ═══════════════
    const cible = idsPub[5], cibleArt = idArt(artA);
    {
        const v1 = await compte({}, 'votant1');
        const a = await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: v1 });
        H.v('4. PUT …/jaime : 200 { success, jaime, compteur, petitCompteur } (sous 5 : compteur null)', [a.statut, a.json], [200, { success: true, jaime: true, compteur: null, petitCompteur: true }]);
        const b = await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: v1 });
        H.v('   rejeu : 200, AUCUN effet de plus (un seul vote, compteur exact 1)', [b.statut, (await brut('publications').findOne({ _id: cible })).nbJaime, await brut('votes').countDocuments({ compte: v1.id, cible })], [200, 1, 1]);
        const d = await appel(sv, 'DELETE', `/api/classeurs/${cible}/jaime`, { c: v1 });
        const d2 = await appel(sv, 'DELETE', `/api/classeurs/${cible}/jaime`, { c: v1 });
        H.v('   DELETE : jaime false ; DELETE d\'un vote absent : 200 sans effet, le compteur ne descend pas sous 0', [d.json.jaime, d2.statut, (await brut('publications').findOne({ _id: cible })).nbJaime], [false, 200, 0]);
        const rafale = await Promise.all(Array.from({ length: 12 }, () => appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: v1 })));
        H.v('   12 PUT simultanés du même compte : tous 200, UNE ligne, compteur 1', [rafale.every(x => x.statut === 200), await brut('votes').countDocuments({ compte: v1.id, cible }), (await brut('publications').findOne({ _id: cible })).nbJaime], [true, 1, 1]);
        H.v('   l\'unicité est celle de l\'INDEX : un doublon écrit à la main est refusé par la base', await brut('votes').insertOne({ compte: v1.id, genre: 'jaime', type: 'galerie', cible, le: new Date() }).then(() => 'inséré', e => e.code), 11000);
        const propre = await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: luma });
        H.v('   sur SA propre création : 403 INTERDIT pas-l-auteur', [propre.statut, code(propre), detail(propre)], [403, 'INTERDIT', 'pas-l-auteur']);
        const prop2 = await appel(sv, 'DELETE', `/api/classeurs/${cible}/enregistre`, { c: luma });
        H.v('   (le DELETE aussi)', detail(prop2), 'pas-l-auteur');
        const np = await appel(sv, 'PUT', `/api/classeurs/${attente}/jaime`, { c: v1 }), absent = await appel(sv, 'PUT', `/api/classeurs/${nouvelleId()}/jaime`, { c: v1 });
        H.v('   sur une cible non publique ou absente : le MÊME 404 INTROUVABLE', [np.statut, np.texte === absent.texte], [404, true]);
        const sp = await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: sansPseudo });
        H.v('   sans pseudo : 403 INTERDIT pseudo-requis', [sp.statut, detail(sp)], [403, 'pseudo-requis']);
        const e1 = await appel(sv, 'PUT', `/api/classeurs/${cible}/enregistre`, { c: v1 });
        H.v('   PUT …/enregistre : 200 { success, enregistre: true }', [e1.statut, e1.json], [200, { success: true, enregistre: true }]);
        const ia = await appel(sv, 'PUT', `/api/illustrations/${cibleArt}/jaime`, { c: v1 }), ie = await appel(sv, 'PUT', `/api/illustrations/${cibleArt}/enregistre`, { c: v1 });
        H.v('   mêmes formes pour une illustration publique ; sur une illustration en attente : 404', [ia.json, ie.json, (await appel(sv, 'PUT', `/api/illustrations/${idArt(artC)}/jaime`, { c: v1 })).statut], [{ success: true, jaime: true, compteur: null, petitCompteur: true }, { success: true, enregistre: true }, 404]);
        const mes = await appel(sv, 'GET', '/api/enregistres', { c: v1 });
        H.v('   GET /api/enregistres : { success, classeurs, illustrations, jaime: { classeurs, illustrations } }', [mes.statut, mes.json], [200, { success: true, classeurs: [cible], illustrations: [cibleArt], jaime: { classeurs: [cible], illustrations: [cibleArt] } }]);
        H.v('   sans session : 401 SESSION', code(await H.appel(sv.url, '/api/enregistres')), 'SESSION');
        // 5 votes : le compteur devient public
        const plus = []; for (let i = 0; i < 3; i++) plus.push(await compte({}, `votant-x${i}`));
        for (const x of plus) await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: x });
        const r5 = await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: noa });
        H.v('   au 5e vote le compteur devient public : { jaime: true, compteur: 5, petitCompteur: false }', r5.json, { success: true, jaime: true, compteur: 5, petitCompteur: false });
        H.v('   et le fil le dit : jaime 5, petitCompteur false', (x => [x.jaime, x.petitCompteur])((await lire(sv, '/api/galerie?tri=top')).json.publications.find(q => q.id === cible)), [5, false]);
        // ORDRE et limites
        const so = await appel(sv, 'PUT', `/api/classeurs/${cible}/jaime`, { c: v1, sansSite: true }), ss = await H.appel(sv.url, `/api/classeurs/${cible}/jaime`, { methode: 'PUT' });
        H.v('   ORDRE : sans session SESSION 401 (avant ORIGINE) ; avec session sans Origin ORIGINE 403', [code(ss), code(so)], ['SESSION', 'ORIGINE']);
        const nv = await compte({ verifie: false }); const sessNv = await sessions.creerSession(nv.c._id);
        H.v('   un compte non confirmé n\'a pas de session utilisable : SESSION 401', code(await H.appel(sv.url, `/api/classeurs/${cible}/jaime`, { methode: 'PUT', entetes: siteH(`rm_session=${sessNv.token}`) })), 'SESSION');
        const lim = await serveur(variante({}, { votesCompteHeure: 2 })); const L3 = await compte({}, 'limiteur3');
        const rr = []; for (const i of [0, 1, 2]) rr.push(await appel(lim, 'PUT', `/api/classeurs/${idsPub[10 + i]}/jaime`, { c: L3 }));
        H.v('   limite de débit par compte (2 ici) : la 3e est 429 LIMITE_DEBIT + reessayerDans', [rr.map(x => x.statut), code(rr[2]), rr[2].json.erreur.reessayerDans > 0], [[200, 200, 429], 'LIMITE_DEBIT', true]);
        const bj = await serveur(variante({ V2_JAIME_MAX: '2' })); const L4 = await compte({}, 'bornejaime');
        const bb = []; for (const i of [0, 1, 2]) bb.push(await appel(bj, 'PUT', `/api/classeurs/${idsPub[14 + i]}/jaime`, { c: L4 }));
        const rejeu = await appel(bj, 'PUT', `/api/classeurs/${idsPub[14]}/jaime`, { c: L4 });
        H.v('   borne de j\'aime par compte (2 ici) : le 3e est 409 CONFLIT borne-jaime ; rejouer un vote existant reste 200', [bb.map(x => x.statut), detail(bb[2]), rejeu.statut], [[200, 200, 409], 'borne-jaime', 200]);
        // remix
        const rx = await appel(sv, 'POST', `/api/galerie/${idsPub[0]}/remix`, { c: v1 });
        const copie = await brut('classeurs').findOne({ _id: rx.json.classeurId });
        H.v('   POST /api/galerie/{id}/remix : 201 { success, classeurId } ; copie PRIVÉE, structure et arts gardés, pochettes de cartes vides', [rx.statut, Object.keys(rx.json), (await appel(sv, 'GET', `/api/classeurs/${rx.json.classeurId}`, { c: v1, sansSite: true })).json.classeur.visibilite, copie.auteurId === v1.id, copie.pages.length, copie.pages[0].blocs.filter(b => b.genre === 'art').length, copie.pages.flatMap(p => p.blocs).filter(b => b.genre === 'carte').every(b => b.contenu === null), copie.pages[0].nb, copie.repriseDe.id], [201, ['success', 'classeurId'], 'prive', true, 2, 1, true, 9, idsPub[0]]);
        H.v('   remix d\'une cible non publique : 404 ; sans pseudo : 403 pseudo-requis', [(await appel(sv, 'POST', `/api/galerie/${attente}/remix`, { c: v1 })).statut, detail(await appel(sv, 'POST', `/api/galerie/${idsPub[0]}/remix`, { c: sansPseudo }))], [404, 'pseudo-requis']);
        const bc = await serveur(variante({ V2_CLASSEURS_MAX: '1' })); const L5 = await compte({}, 'remixeur');
        const r1 = await appel(bc, 'POST', `/api/galerie/${idsPub[0]}/remix`, { c: L5 }), r2 = await appel(bc, 'POST', `/api/galerie/${idsPub[0]}/remix`, { c: L5 });
        H.v('   borne de classeurs (1 ici) : le 2e est 409 CONFLIT borne-classeurs', [r1.statut, r2.statut, detail(r2)], [201, 409, 'borne-classeurs']);
    }

    // ═══════════════ 5. LE DÉPÔT D'UN ART ═══════════════
    {
        const dep = await compte({}, 'artiste1');
        const svD = await serveur(variante({ V2_ILLUSTRATIONS_MAX: '500' }, { depotsCompteHeure: 500, depotsIpHeure: 500 }));
        const o = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/webp', octets: 5000 } });
        H.v('5. POST /api/illustrations/depot : 201 { success, depotId, urlDepot, expireDans: 300 }', [o.statut, Object.keys(o.json), o.json.expireDans], [201, ['success', 'depotId', 'urlDepot', 'expireDans'], 300]);
        const u = new URL(o.json.urlDepot);
        H.v('   l\'URL est sur l\'origine R2 d\'écriture, sous le préfixe galerie/depot/<ref>/<depotId> du bucket PRIVÉ de l\'ESSAI, avec taille et type signés', [u.origin === stockage.origineEcriture, new RegExp(`^/${stockage.bucketPrive}/galerie/depot/[0-9a-f]{16}/${o.json.depotId}$`).test(u.pathname), /content-length/.test(u.searchParams.get('X-Amz-SignedHeaders')), stockage.journal.at(-1).slice(2)], [true, true, true, ['image/webp', 5000, 300]]);
        H.vrai('   la <ref> du compte n\'est PAS l\'identifiant du compte', !o.json.urlDepot.includes(dep.id));
        const avant = stockage.journal.length;
        const t = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/svg+xml', octets: 100 } }), g = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/gif', octets: 100 } });
        const gros = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: 8 * 1024 * 1024 + 1 } });
        H.v('   svg et gif : 415 FICHIER format ; au-dessus de 8 Mio : 413 FICHIER trop-lourde ; aucune URL signée pour ces refus', [t.statut, code(t), detail(t), g.statut, gros.statut, code(gros), detail(gros), stockage.journal.length], [415, 'FICHIER', 'format', 415, 413, 'FICHIER', 'trop-lourde', avant]);
        H.v('   corps mal formé : 400 ENTREE', await Promise.all([{ type: 'image/png' }, { octets: 5 }, { type: 'image/png', octets: '5' }, { type: 'image/png', octets: 0 }, { type: 'image/png', octets: 1.5 }, { type: 'image/png', octets: 5, plus: 1 }].map(async b => (await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: b })).statut)), Array(6).fill(400));
        H.v('   ORDRE : sans session 401, sans Origin 403, sans pseudo 403 pseudo-requis', [(await H.appel(sv.url, '/api/illustrations/depot', { methode: 'POST', corps: { type: 'image/png', octets: 5 } })).statut, (await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: 5 }, sansSite: true })).statut, detail(await appel(svD, 'POST', '/api/illustrations/depot', { c: sansPseudo, corps: { type: 'image/png', octets: 5 } }))], [401, 403, 'pseudo-requis']);

        // le parcours nominal
        const buf = await png(300, 419);
        const o2 = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: buf.length } });
        const cleBrute = stockage.deposer(o2.json.urlDepot, buf);
        const f = await appel(svD, 'POST', `/api/illustrations/depot/${o2.json.depotId}/finaliser`, { c: dep, corps: { nom: 'Mon art', format: '1', certifieDroits: true, certifieNonOfficielle: true } });
        H.v('   finaliser : 201 { success, id, statut: "en-attente" }', [f.statut, Object.keys(f.json), f.json.statut], [201, ['success', 'id', 'statut'], 'en-attente']);
        const doc = await brut('arts').findOne({ _id: f.json.id });
        H.v('   l\'objet brut est SUPPRIMÉ ; l\'image recompressée et sa vignette sont sous galerie/attente/ ; rien n\'est public', [stockage.objets.has(cleBrute), stockage.objets.has(`galerie/attente/${f.json.id}.webp`), stockage.objets.has(`galerie/attente/${f.json.id}-480.webp`), stockage.objets.has(`galerie/pub/${f.json.id}.webp`), doc.etat], [false, true, true, false, 'en-attente']);
        H.vrai('   TOUTE clé écrite ou lue par le lot est sous galerie/', stockage.journal.every(j => /^galerie\//.test(String(j[1]))));
        H.vrai('   AUCUN fichier dans MongoDB : le document ne garde que clé, dimensions, couleur, poids (moins de 1 Ko, aucun binaire)', (() => { const b = require('mongoose').mongo.BSON.calculateObjectSize(doc); return b < 1024 && Object.values(doc).every(v => !Buffer.isBuffer(v) && !(v && v._bsontype === 'Binary')); })());
        const rej = await appel(svD, 'POST', `/api/illustrations/depot/${o2.json.depotId}/finaliser`, { c: dep, corps: { nom: 'Mon art', format: '1', certifieDroits: true, certifieNonOfficielle: true } });
        H.v('   finaliser rejoué : 201 et la MÊME illustration (idempotent par depotId)', [rej.statut, rej.json.id === f.json.id, await brut('arts').countDocuments({ depotId: o2.json.depotId })], [201, true, 1]);
        const autre = await appel(svD, 'POST', `/api/illustrations/depot/${o2.json.depotId}/finaliser`, { c: noa, corps: { nom: 'Vol', format: '1', certifieDroits: true, certifieNonOfficielle: true } });
        const inconnu = await appel(svD, 'POST', `/api/illustrations/depot/${nouvelleId()}/finaliser`, { c: noa, corps: { nom: 'Vol', format: '1', certifieDroits: true, certifieNonOfficielle: true } });
        H.v('   le dépôt d\'un autre compte répond comme un dépôt absent : 404 INTROUVABLE identiques', [autre.statut, autre.texte === inconnu.texte], [404, true]);

        // les refus de fichier : chacun efface l'objet brut
        const refus = async (nom, buffer, attendu, opts = {}, cfgX = null) => {
            const s = cfgX ? await serveur(cfgX) : svD;
            const x = await deposer(s, dep, { buffer, ...opts }); x.fin = x.fin || x.ouvert;
            const reste = [...stockage.objets.keys()].some(k => k.startsWith('galerie/depot/') && stockage.objets.get(k) === buffer);
            H.v(`   ${nom} : ${attendu[0]} FICHIER ${attendu[1]}, objet brut effacé`, [x.fin && x.fin.statut, x.fin && code(x.fin), x.fin && detail(x.fin), !!x.fin && x.fin.statut >= 400 && ![...stockage.objets.keys()].some(k => k.startsWith(`galerie/depot/`) && k.endsWith(x.depotId))], [attendu[0], 'FICHIER', attendu[1], true]);
        };
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
        await refus('un SVG déclaré image/png', svg, [415, 'format']);
        await refus('un GIF', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]), [415, 'format']);
        await refus('du texte', Buffer.from('ceci n\'est pas une image du tout'), [415, 'format']);
        const apng = await (async () => { const zlib = require('zlib'); const ch = (t, d) => { const T = Buffer.from(t, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(zlib.crc32(Buffer.concat([T, d])) >>> 0); return Buffer.concat([l, T, d, c]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(8, 0); ih.writeUInt32BE(8, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', ih), ch('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])), ch('IDAT', zlib.deflateSync(Buffer.alloc(8 * 25))), ch('IEND', Buffer.alloc(0))]); })();
        await refus('un PNG animé', apng, [422, 'animee']);
        await refus('un fichier illisible (en-tête JPEG puis du bruit)', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), require('crypto').randomBytes(200)]), [422, 'illisible'], { type: 'image/jpeg' });
        await refus('trop de pixels (borne de 100 000 px ici)', await png(400, 400), [422, 'trop-de-pixels'], {}, variante({ V2_ILLUSTRATION_PIXELS_MAX: '100000' }));
        await refus('trop lourd (borne d\'octets de 2 Ko ici, fichier plus gros mais déclaré honnêtement)', await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer(), [413, 'trop-lourde'], {}, variante({ V2_ILLUSTRATION_OCTETS_MAX: '2048' }));
        // taille réelle ≠ taille déclarée
        { const b = await png(300, 419); const x = await deposer(svD, dep, { buffer: b, octets: b.length - 1 }); H.v('   taille réelle différente de la taille déclarée (et signée) : 413 trop-lourde', [x.fin.statut, detail(x.fin)], [413, 'trop-lourde']); }
        // jamais envoyé
        { const o3 = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: 100 } }); const x = await appel(svD, 'POST', `/api/illustrations/depot/${o3.json.depotId}/finaliser`, { c: dep, corps: { nom: 'x', format: '1', certifieDroits: true, certifieNonOfficielle: true } }); H.v('   fichier jamais envoyé à R2 : 422 illisible, le dépôt reste ouvert', [x.statut, detail(x), (await brut('depots').findOne({ _id: o3.json.depotId })).etat], [422, 'illisible', 'ouvert']); }
        // certifications et champs
        for (const [nom, corps] of [['sans certifieNonOfficielle', { nom: 'x', format: '1', certifieDroits: true }], ['certifieDroits false', { nom: 'x', format: '1', certifieDroits: false, certifieNonOfficielle: true }], ['format inconnu', { nom: 'x', format: '3', certifieDroits: true, certifieNonOfficielle: true }], ['nom data:', { nom: 'data:image/png;base64,AAAA', format: '1', certifieDroits: true, certifieNonOfficielle: true }], ['nom vide', { nom: '', format: '1', certifieDroits: true, certifieNonOfficielle: true }], ['champ en trop', { nom: 'x', format: '1', certifieDroits: true, certifieNonOfficielle: true, url: 'https://x' }]]) {
            const o4 = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: 100 } });
            const x = await appel(svD, 'POST', `/api/illustrations/depot/${o4.json.depotId}/finaliser`, { c: dep, corps });
            H.v(`   ${nom} : 400 ENTREE`, [x.statut, code(x)], [400, 'ENTREE']);
        }
        { const b = await png(300, 300); const x = await deposer(svD, dep, { buffer: b, format: '1' }); H.v('   le rapport doit être celui du format (carré pour le format 1) : 400 ENTREE rapport-format', [x.fin.statut, detail(x.fin)], [400, 'rapport-format']); }
        // borne d'arts
        { const bi = await serveur(variante({ V2_ILLUSTRATIONS_MAX: '1' })); const L6 = await compte({}, 'borneart');
          const a1 = await appel(bi, 'POST', '/api/illustrations/depot', { c: L6, corps: { type: 'image/png', octets: 100 } }), a2 = await appel(bi, 'POST', '/api/illustrations/depot', { c: L6, corps: { type: 'image/png', octets: 100 } });
          H.v('   borne d\'illustrations (1 ici, dépôts en cours compris) : le 2e est 409 CONFLIT borne-illustrations', [a1.statut, a2.statut, detail(a2)], [201, 409, 'borne-illustrations']);
          const ld = await serveur(variante({}, { depotsCompteHeure: 1 })); const L7 = await compte({}, 'limitedepot');
          const d1 = await appel(ld, 'POST', '/api/illustrations/depot', { c: L7, corps: { type: 'image/png', octets: 100 } }), d2 = await appel(ld, 'POST', '/api/illustrations/depot', { c: L7, corps: { type: 'image/png', octets: 100 } });
          H.v('   limite de débit des dépôts (1 ici) : 429 LIMITE_DEBIT', [d1.statut, d2.statut, code(d2)], [201, 429, 'LIMITE_DEBIT']); }
        // une seule recompression à la fois : deux finalisations en parallèle, la seconde reçoit INDISPONIBLE + reessayerDans
        {
            const b1 = await png(300, 419), b2 = await png(300, 419, { r: 200, g: 40, b: 40 });
            const o5 = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: b1.length } }), o6 = await appel(svD, 'POST', '/api/illustrations/depot', { c: dep, corps: { type: 'image/png', octets: b2.length } });
            stockage.deposer(o5.json.urlDepot, b1); stockage.deposer(o6.json.urlDepot, b2);
            const corps = { nom: 'p', format: '1', certifieDroits: true, certifieNonOfficielle: true };
            const [x, y] = await Promise.all([appel(svD, 'POST', `/api/illustrations/depot/${o5.json.depotId}/finaliser`, { c: dep, corps }), appel(svD, 'POST', `/api/illustrations/depot/${o6.json.depotId}/finaliser`, { c: dep, corps })]);
            const occupee = [x, y].find(r => r.statut === 503);
            H.vrai('   deux finalisations simultanées : UNE passe (201), l\'autre reçoit 503 INDISPONIBLE + reessayerDans, et son dépôt reste ouvert pour un nouvel essai', [x.statut, y.statut].includes(201) && (!occupee || (code(occupee) === 'INDISPONIBLE' && occupee.json.erreur.reessayerDans > 0)));
        }
    }

    // ═══════════════ 6. LES SIGNALEMENTS ═══════════════
    {
        const cibleS = `galerie:${idsPub[7]}`, base = { cible: cibleS, motif: 'droits', precision: 'Cette page copie mon travail.' };
        const IPFIXE = '10.55.5.5';
        const sig = (corps, c, ip) => H.appel(sv.url, '/api/signalements', { methode: 'POST', corps, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': ip || IP(), ...(c ? { cookie: c.cookie } : {}) } });
        const sans = await sig(base);
        H.v('6. sans session et sans jeton Turnstile : 422 ENTREE defi-anti-robot, rien d\'enregistré', [sans.statut, code(sans), detail(sans), await brut('signalements').countDocuments({})], [422, 'ENTREE', 'defi-anti-robot', 0]);
        const mauvais = await sig({ ...base, turnstile: tj('jeton-pourri') });
        H.v('   jeton refusé par le fournisseur : 422 defi-anti-robot', [mauvais.statut, detail(mauvais)], [422, 'defi-anti-robot']);
        const jetonBon = tj(); const bon = await sig({ ...base, turnstile: jetonBon });
        H.v('   jeton valide : 201 { success: true }', [bon.statut, bon.json], [201, { success: true }]);
        const appelT = turnstile.appels.at(-1), pT = new URLSearchParams(appelT.corps);
        H.v('   la vérification est faite CÔTÉ SERVEUR auprès de siteverify, sans suivre de redirection, avec le secret de l\'environnement', [appelT.url, appelT.methode, appelT.redirect, pT.get('secret'), pT.get('response')], ['https://challenges.cloudflare.com/turnstile/v0/siteverify', 'POST', 'error', 'secret-turnstile-essai', jetonBon]);
        const stocke = await brut('signalements').find({}).toArray();
        H.v('   le signalement porte cible, motif, précision, date, échéance à 24 h, conservation 12 mois ; ni IP, ni jeton, ni compte', [stocke.length, stocke[0].cibleType, stocke[0].cibleId === idsPub[7], stocke[0].compteId, stocke[0].echeance - stocke[0].le, stocke[0].conserveJusqua > stocke[0].le, /jeton-valide|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(JSON.stringify(stocke))], [1, 'galerie', true, null, 86400e3, true, false]);
        const pan = await serveur(cfg, { ts: A.fauxTurnstile({ panne: true }) }), noSecret = await serveur(cfg, { env: { ...A.ENV_VALIDE, V2_GALERIE_TURNSTILE_SECRET: undefined } });
        const headers = () => ({ origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() });
        const x1 = await H.appel(pan.url, '/api/signalements', { methode: 'POST', corps: { ...base, turnstile: tj() }, entetes: headers() }), x2 = await H.appel(noSecret.url, '/api/signalements', { methode: 'POST', corps: { ...base, turnstile: tj() }, entetes: headers() });
        H.v('   fournisseur injoignable ou secret absent : 503 INDISPONIBLE — jamais d\'ouverture par défaut', [x1.statut, code(x1), x2.statut, code(x2)], [503, 'INDISPONIBLE', 503, 'INDISPONIBLE']);
        const avecSession = await sig(base, noa);
        H.v('   avec session : pas de Turnstile ; le compte est gardé (pour l\'anonymiser à sa suppression) ; un second signalement du même compte sur la même cible ne compte pas', [avecSession.statut, (await sig(base, noa)).statut, await brut('signalements').countDocuments({ compteId: noa.id })], [201, 201, 1]);
        const existant = await sig({ ...base, turnstile: tj() }), inexistant = await sig({ cible: `galerie:${nouvelleId()}`, motif: 'droits', turnstile: tj() }), nonPublic = await sig({ cible: `galerie:${attente}`, motif: 'droits', turnstile: tj() });
        H.v('   la réponse est la MÊME que la cible existe, soit absente ou non publique (et rien n\'est enregistré pour elles)', [existant.texte === inexistant.texte, existant.texte === nonPublic.texte, await brut('signalements').countDocuments({ cibleId: { $in: [attente] } })], [true, true, 0]);
        for (const [nom, corps] of [['cible mal formée', { ...base, cible: 'classeur:abc' }], ['motif inconnu', { ...base, motif: 'zzz' }], ['précision trop longue', { ...base, precision: 'a'.repeat(501) }], ['précision data:', { ...base, precision: 'data:text/html;base64,AAAA' }], ['champ en trop', { ...base, contact: 'a@b.fr' }], ['précision non texte', { ...base, precision: 5 }]]) {
            const x = await sig({ ...corps, turnstile: tj() }); H.v(`   ${nom} : 400 ENTREE`, [x.statut, code(x)], [400, 'ENTREE']);
        }
        const rg = []; for (let i = 0; i < 12; i++) rg.push((await sig({ ...base, turnstile: tj() }, null, IPFIXE)).statut);
        H.v('   10 par heure et par adresse IP : le 11e est 429 LIMITE_DEBIT (V2_SIGNALEMENTS_IP_HEURE)', [rg.slice(0, 10).every(s => s === 201), rg[10], rg[11]], [true, 429, 429]);
        const sansOrigine = await H.appel(sv.url, '/api/signalements', { methode: 'POST', corps: { ...base, turnstile: tj() }, entetes: { 'x-forwarded-for': IP() } });
        H.v('   sans Origin du site : 403 ORIGINE (même sans session)', [sansOrigine.statut, code(sansOrigine)], [403, 'ORIGINE']);
    }

    // ═══════════════ 7. LA MODÉRATION ═══════════════
    {
        const modo = await compte({ role: 'moderateur' }, 'modo-un'), simple = await compte({}, 'simple-un');
        const g = (c, q = 'file=publications') => appel(sv, 'GET', `/api/admin/moderation?${q}`, { c });
        const refuse = await g(simple);
        H.v('7. un compte sans rôle : 403 INTERDIT admin ; sans session 401 ; administrateur et modérateur passent', [refuse.statut, code(refuse), detail(refuse), (await H.appel(sv.url, '/api/admin/moderation?file=publications')).statut, (await g(admin)).statut, (await g(modo)).statut], [403, 'INTERDIT', 'admin', 401, 200, 200]);
        // le rôle est RELU en base à chaque appel : le retirer coupe l'accès avec le MÊME cookie
        const eph = await compte({ role: 'moderateur' }, 'modo-eph');
        const avant = (await g(eph)).statut; await db.col('comptes').updateOne({ _id: eph.c._id }, { $unset: { role: '' } }); const apres = (await g(eph)).statut;
        H.v('   le rôle est relu en base à CHAQUE appel : retiré en base, le même cookie perd l\'accès', [avant, apres], [200, 403]);
        // un art en attente, une publication en attente
        const art = await deposer(sv, luma, { nom: 'À modérer', format: '1' }); const pubA = await publier(noa, { titre: 'À modérer aussi', etat: 'en-attente' });
        const file = await g(modo);
        const eltArt = file.json.elements.find(e => e.id === `art.${idArt(art)}`), eltPub = file.json.elements.find(e => e.id === `pub.${pubA}`);
        H.v('   GET file=publications : { success, elements, suite }, les plus anciens d\'abord ; élément de publication et d\'illustration avec les clés du site', [Object.keys(file.json), Object.keys(eltPub), Object.keys(eltArt.cible), file.json.elements.map(e => e.recuLe).join() === [...file.json.elements.map(e => e.recuLe)].sort().join()], [['success', 'elements', 'suite'], ['id', 'file', 'genre', 'cible', 'auteur', 'certification', 'signalements', 'recuLe', 'echeance'], ['id', 'titre', 'apercu', 'image', 'vignette'], true]);
        H.v('   l\'aperçu d\'un art en attente est une URL SIGNÉE (jamais publique) ; auteur.ref est opaque (≠ identifiant de compte) ; la certification est portée', [/X-Amz-Expires=3600/.test(eltArt.cible.image), eltArt.auteur.ref !== luma.id && /^[0-9a-f]{16}$/.test(eltArt.auteur.ref), eltArt.certification !== null, eltPub.certification.cgu], [true, true, true, '2026-10']);
        H.v('   file inconnue : 400 ; paramètre inconnu : 400', [(await g(modo, 'file=zzz')).statut, (await g(modo, 'file=publications&x=1')).statut], [400, 400]);
        const dec = (c, id, corps, plus) => appel(sv, 'POST', `/api/admin/moderation/${id}/decision`, { c, corps, ...(plus || {}) });
        // accepter : copie AVANT le passage à public ; panne de copie => reste en attente
        stockage.panneCopie = true; const pc = await dec(modo, `art.${idArt(art)}`, { decision: 'accepter' }); stockage.panneCopie = false;
        H.v('   accepter avec la copie publique en panne : 503 INDISPONIBLE, l\'art reste « en-attente » et n\'est JAMAIS public sans fichier', [pc.statut, (await brut('arts').findOne({ _id: idArt(art) })).etat, [...stockage.objets.keys()].some(k => k.startsWith(`galerie/pub/${idArt(art)}`))], [503, 'en-attente', false]);
        const ok = await dec(modo, `art.${idArt(art)}`, { decision: 'accepter' });
        H.v('   accepter : 200 ; copie publique faite (image et vignette), état public, visible dans la banque', [ok.statut, ok.json, (await brut('arts').findOne({ _id: idArt(art) })).etat, stockage.objets.has(`galerie/pub/${idArt(art)}.webp`), stockage.objets.has(`galerie/pub/${idArt(art)}-480.webp`), (await lire(sv, '/api/banque?q=mod%C3%A9rer')).json.arts.length], [200, { success: true }, 'public', true, true, 1]);
        H.v('   déjà décidé : 409 CONFLIT etat', [(await dec(modo, `art.${idArt(art)}`, { decision: 'accepter' })).statut, detail(await dec(modo, `art.${idArt(art)}`, { decision: 'accepter' }))], [409, 'etat']);
        const ret = await dec(modo, `art.${idArt(art)}`, { decision: 'retirer', motif: 'droits', precision: 'Signalé par le titulaire.' });
        const retire = await brut('arts').findOne({ _id: idArt(art) });
        H.v('   retirer (motif exigé) : état retire, motif écrit sur la cible, copies publiques EFFACÉES, plus dans la banque', [ret.statut, retire.etat, retire.motif, stockage.objets.has(`galerie/pub/${idArt(art)}.webp`), (await lire(sv, '/api/banque?q=mod%C3%A9rer')).json.arts.length], [200, 'retire', { code: 'droits', texte: 'Signalé par le titulaire.' }, false, 0]);
        const refP = await dec(modo, `pub.${pubA}`, { decision: 'refuser', motif: 'hors-sujet' });
        H.v('   refuser une publication : 200, état refuse, 404 uniforme côté public ; sans motif : 400', [refP.statut, (await brut('publications').findOne({ _id: pubA })).etat, (await dec(modo, `pub.${await publier(noa, { etat: 'en-attente' })}`, { decision: 'refuser' })).statut], [200, 'refuse', 400]);
        H.v('   motif hors liste, décision inconnue, champ en trop : 400', [(await dec(modo, `pub.${nouvelleId()}`, { decision: 'refuser', motif: 'zzz' })).statut, (await dec(modo, `pub.${nouvelleId()}`, { decision: 'zzz' })).statut, (await dec(modo, `pub.${nouvelleId()}`, { decision: 'accepter', admin: true })).statut], [400, 400, 400]);
        H.v('   id inconnu ou mal formé : 404', [(await dec(modo, `pub.${nouvelleId()}`, { decision: 'accepter' })).statut, (await dec(modo, 'zzz', { decision: 'accepter' })).statut], [404, 404]);
        const propre = await publier(modo, { etat: 'en-attente' });
        H.v('   un modérateur ne décide pas sur sa PROPRE création : 403 INTERDIT pas-l-auteur', [(await dec(modo, `pub.${propre}`, { decision: 'accepter' })).statut, detail(await dec(modo, `pub.${propre}`, { decision: 'accepter' }))], [403, 'pas-l-auteur']);
        H.v('   ORDRE : sans Origin 403 ORIGINE ; compte sans rôle 403 admin', [(await dec(modo, `pub.${propre}`, { decision: 'accepter' }, { sansSite: true })).statut, detail(await dec(simple, `pub.${propre}`, { decision: 'accepter' }))], [403, 'admin']);
        // signalements : la file, retirer la cible, classer
        const fs = await g(modo, 'file=signalements');
        const s1 = fs.json.elements[0];
        H.v('   file=signalements : un élément par signalement ouvert, avec motif, précision, échéance à 24 h', [fs.statut, s1.file, s1.signalements.length, Object.keys(s1.signalements[0]), Date.parse(s1.echeance) - Date.parse(s1.recuLe)], [200, 'signalements', 1, ['motif', 'precision', 'le'], 86400e3]);
        const cls = await dec(modo, s1.id, { decision: 'classer', motif: 'hors-sujet' });
        H.v('   classer : le signalement sort de la file', [cls.statut, (await brut('signalements').countDocuments({ etat: 'classe' })), (await g(modo, 'file=signalements')).json.elements.length < fs.json.elements.length], [200, 1, true]);
        const s2 = (await g(modo, 'file=signalements')).json.elements[0];
        const ids = s2.cible.id; const rs = await dec(modo, s2.id, { decision: 'retirer', motif: 'droits' });
        H.v('   retirer depuis un signalement : la CIBLE est retirée (si publique) et tous ses signalements ouverts fermés', [rs.statut, ['retire', 'public'].includes((await brut('publications').findOne({ _id: ids }) || await brut('arts').findOne({ _id: ids })).etat), await brut('signalements').countDocuments({ cibleId: ids, etat: 'ouvert' })], [200, true, 0]);
        // le journal
        const journal = await brut('journal_moderation').find({}).toArray();
        H.v('   le journal : chaque décision y est AVANT son effet (qui, quand, quoi, motif), avec un résultat ; « qui » est la ref opaque, jamais le compte ; conservation 12 mois', [journal.length > 0, journal.some(j => j.decision === 'accepter' && j.qui && j.qui !== modo.id), journal.some(j => j.resultat === 'applique'), journal.some(j => j.resultat === 'echec-copie'), journal.every(j => j.conserveJusqua > j.quand), JSON.stringify(journal).includes(modo.id)], [true, true, true, true, true, false]);
        H.v('   TTL de 12 mois posés sur signalements et journal (index)', await Promise.all(['signalements', 'journal_moderation'].map(async n => (await brut(n).indexes()).some(i => i.name === 'ttl_12_mois' && i.expireAfterSeconds === 0))), [true, true]);
        H.vrai('   aucune route de ce lot ne donne ni ne retire un rôle (le corps d\'une décision n\'accepte que decision, motif, precision)', (await dec(modo, `pub.${nouvelleId()}`, { decision: 'accepter', role: 'administrateur' })).statut === 400 && !require('fs').readFileSync(require('path').join(__dirname, '..', 'galerie', 'routes.js'), 'utf8').match(/role\s*:/));
    }

    // ═══════════════ 8. SUPPRESSION DE COMPTE ═══════════════
    {
        const partant = await compte({}, 'partant'); const art = await deposer(sv, partant, { nom: 'Partant', format: '1' });
        await appel(sv, 'PUT', `/api/classeurs/${idsPub[20]}/jaime`, { c: partant });
        const rapport = await svc.supprimerDuCompte(partant.id, stockage);
        H.v('8. la suppression du compte emporte pseudo, votes, arts (et leurs objets R2) ; le pseudo redevient libre', [rapport.profil, rapport.votes, rapport.arts, [...stockage.objets.keys()].some(k => k.includes(idArt(art))), (await appel(await serveur(variante({}, { pseudoCompteJour: 1000, pseudoIpJour: 1000 })), 'PUT', '/api/compte/pseudo', { c: await compte(), corps: { pseudo: 'partant' } })).statut], [1, 1, 1, false, 200]);
        const sg = await compte({}, 'signalant'); await H.appel(sv.url, '/api/signalements', { methode: 'POST', corps: { cible: `galerie:${idsPub[2]}`, motif: 'autre' }, entetes: { origin: SITE, 'x-rat-market': '1', cookie: sg.cookie, 'x-forwarded-for': IP() } });
        await svc.supprimerDuCompte(sg.id, stockage);
        H.v('   ses signalements sont ANONYMISÉS, pas effacés (la file doit pouvoir les traiter)', [await brut('signalements').countDocuments({ compteId: sg.id }), await brut('signalements').countDocuments({ cibleId: idsPub[2] })], [0, 1]);
        const susp = require('../galerie/suppression');
        H.v('   le crochet de comptes/service.js : sans lot monté il ne fait rien ; monté sans base branchée il LÈVE (la suppression se rejoue)', [await (async () => { monterGalerie.routes(express.Router(), { ...cfg, galerie: lireGalerie({}) }, {}); return susp.supprimerDuCompte('x'); })(), await (async () => { const r = express.Router(); monterGalerie.routes(r, cfg, { env: A.ENV_VALIDE, stockage, ouvrirBase: async () => ({ db: dbG, fermer: async () => { } }) }); await monterGalerie.pret(); const sauve = G.base; await G.debrancher(); try { await susp.supprimerDuCompte('x'); return 'ne lève pas'; } catch { return 'lève'; } finally { G.brancher(dbG); } })()], [null, 'lève']);
    }

    // ═══════════════ 9. LA BASE DE L'API N'A RIEN VU DE LA COMMUNAUTÉ ═══════════════
    {
        const noms = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name.replace(/^rm_t[0-9a-z]+_/, ''));
        const galerie = ['profils', 'publications', 'arts', 'depots', 'votes', 'signalements', 'journal_moderation', 'classeurs'];
        H.v('9. aucune collection de la Communauté dans la base de l\'API ; toutes dans la base dédiée', [galerie.filter(n => noms.includes(n)), (await dbG.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => galerie.includes(n)).sort()], [[], [...galerie].sort()]);
        H.vrai('   les compteurs de limite de la Communauté sont dans la base dédiée (pas de clé « g- » dans `limites` de l\'API)', !(await db.col('limites').find({ cle: /^g-/ }).toArray()).length && (await brut('limites').countDocuments({ cle: /^g-/ })) > 0);
        const fs = require('fs'), path = require('path'); const dossier = path.join(__dirname, '..', 'galerie');
        const fichiers = fs.readdirSync(dossier).filter(f => f.endsWith('.js'));
        H.v('   aucun fichier de v2/galerie n\'ouvre la base de l\'API (`../db`)', fichiers.filter(f => /require\(['"]\.\.\/db['"]\)/.test(fs.readFileSync(path.join(dossier, f), 'utf8'))), []);
        H.vrai(`   dénominateur : ${fichiers.length} fichiers examinés`, fichiers.length >= 9);
    }

    // ═══════════════ 10. MUTATIONS DES GARDES DE LA ROUTE ═══════════════
    {
        const mutant = async (rempl, f = 'routes.js') => serveur(cfg, { routes: A.charger(f, rempl) });
        // origine
        const m1 = await mutant([['const ECRITURE = [...SESSION, S.exigerOrigineSite(cfg), exigerVerifie];', 'const ECRITURE = [...SESSION, exigerVerifie];']]);
        const v = await compte({}, 'mutant-v');
        const scene = (s) => appel(s, 'PUT', `/api/classeurs/${idsPub[21]}/enregistre`, { c: v, sansSite: true });
        H.v('10. MUTANT « l\'Origin et X-Rat-Market ne sont plus exigés » : sans eux, le réel refuse (403), le mutant ÉCRIT (200)', [(await scene(sv)).statut, (await scene(m1)).statut], [403, 200]);
        // Turnstile
        const m2 = await mutant([['if (!session) {', 'if (false) {']]);
        const s2 = s => H.appel(s.url, '/api/signalements', { methode: 'POST', corps: { cible: `galerie:${idsPub[8]}`, motif: 'autre' }, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() } });
        H.v('   MUTANT « Turnstile n\'est plus exigé sans session » : sans jeton, le réel refuse (422), le mutant accepte (201)', [(await s2(sv)).statut, (await s2(m2)).statut], [422, 201]);
        const m3 = await mutant([['if (ok !== true) return repondreErreur(res, \'ENTREE\', \'Vérification anti-robot échouée\', { detail: \'defi-anti-robot\' }, 422);', '']]);
        const s3 = s => H.appel(s.url, '/api/signalements', { methode: 'POST', corps: { cible: `galerie:${idsPub[8]}`, motif: 'autre', turnstile: tj('jeton-pourri') }, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() } });
        H.v('   MUTANT « le verdict du fournisseur n\'est plus lu » : un jeton refusé passe', [(await s3(sv)).statut, (await s3(m3)).statut], [422, 201]);
        const m3b = await mutant([['catch (e) { console.error(`❌ [v2 galerie] Turnstile en échec (${nomErreur(e)})`); return indispo(res); }', 'catch (e) { ok = true; }']]);
        const pan = await serveur(cfg, { ts: A.fauxTurnstile({ panne: true }) }), panMut = await serveur(cfg, { ts: A.fauxTurnstile({ panne: true }), routes: A.charger('routes.js', [['catch (e) { console.error(`❌ [v2 galerie] Turnstile en échec (${nomErreur(e)})`); return indispo(res); }', 'catch (e) { ok = true; }']]) });
        H.v('   MUTANT « une erreur de vérification ouvre » : fournisseur en panne, le réel refuse (503), le mutant laisse passer (201)', [(await s2b(pan)).statut, (await s2b(panMut)).statut], [503, 201]);
        function s2b(s) { return H.appel(s.url, '/api/signalements', { methode: 'POST', corps: { cible: `galerie:${idsPub[8]}`, motif: 'autre', turnstile: tj() }, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() } }); }
        // rôle
        const m4 = await mutant([['return c && ROLES_MODERATION.includes(c.role) ? next() : interdit(res, \'admin\');', 'return next();']]);
        const simple2 = await compte({}, 'simple-mut');
        H.v('   MUTANT « le rôle de modération n\'est plus vérifié » : un compte sans rôle lit la file (le réel : 403)', [(await appel(sv, 'GET', '/api/admin/moderation?file=publications', { c: simple2 })).statut, (await appel(m4, 'GET', '/api/admin/moderation?file=publications', { c: simple2 })).statut], [403, 200]);
        const m4b = await mutant([['ROLES_MODERATION = Object.freeze([\'administrateur\', \'moderateur\'])', 'ROLES_MODERATION = Object.freeze([\'administrateur\', \'moderateur\', undefined])']]);
        H.v('   MUTANT « un compte sans champ role passe pour modérateur » : le réel refuse', [(await appel(sv, 'GET', '/api/admin/moderation?file=publications', { c: simple2 })).statut, (await appel(m4b, 'GET', '/api/admin/moderation?file=publications', { c: simple2 })).statut], [403, 200]);
        // pas-l-auteur et vote unique (service)
        const sMut = A.charger('service.js', [['if (cible.auteurId === String(compteId)) return { auteur: true };', '']]);
        H.v('   MUTANT « le vote sur sa propre création n\'est plus refusé » : l\'auteur vote (réel : auteur)', [!!(await svc.voter({ compteId: luma.id, type: 'galerie', genre: 'jaime', id: idsPub[6], poser: true, max: 5000 })).auteur, !!(await sMut.voter({ compteId: luma.id, type: 'galerie', genre: 'jaime', id: idsPub[6], poser: true, max: 5000 })).auteur], [true, false]);
        await brut('votes').deleteMany({ compte: luma.id }); await brut('publications').updateOne({ _id: idsPub[6] }, { $set: { nbJaime: 0 } });
        const sansPre = A.charger('service.js', [['if (!(await G.col(\'votes\').findOne(filtre, { projection: { _id: 1 } }))) {', 'if (true) {']]);
        const w = await compte({}, 'mutant-w');
        const deuxFois = async (s, id) => { await s.voter({ compteId: w.id, type: 'galerie', genre: 'jaime', id, poser: true, max: 5000 }); await s.voter({ compteId: w.id, type: 'galerie', genre: 'jaime', id, poser: true, max: 5000 }); return [(await brut('votes').countDocuments({ compte: w.id, cible: id })), (await brut('publications').findOne({ _id: id })).nbJaime]; };
        H.v('   l\'INDEX unique tient seul : le test préalable retiré, deux PUT donnent encore UNE ligne et le compteur 1', await deuxFois(sansPre, idsPub[22]), [1, 1]);
        await dbG.collection('votes').dropIndex('vote_unique');
        const sansIndex = await deuxFois(sansPre, idsPub[23]);
        await brut('votes').deleteMany({ cible: idsPub[23], compte: w.id }); await brut('publications').updateOne({ _id: idsPub[23] }, { $set: { nbJaime: 0 } });
        await G.creerIndex();
        H.v('   MUTANT « ni test préalable ni index unique » : deux PUT donnent DEUX lignes et le compteur 2 (le réel : 1 et 1)', [sansIndex, await deuxFois(svc, idsPub[24])], [[2, 2], [1, 1]]);
        H.vrai('   l\'index unique a été recréé après la scène', (await brut('votes').indexes()).some(i => i.name === 'vote_unique' && i.unique === true));
        // 404 uniforme : un vote sur une cible non publique répond comme l'absent (mutant : la cible privée est trouvée)
        const sMut2 = A.charger('service.js', [["{ _id: id, etat: 'public' }, { projection: { auteurId: 1, nbJaime: 1, nbEnregistre: 1 } }", "{ _id: id }, { projection: { auteurId: 1, nbJaime: 1, nbEnregistre: 1 } }"]]);
        H.v('   MUTANT « une cible en attente est votable » : le réel répond introuvable, le mutant vote', [!!(await svc.voter({ compteId: w.id, type: 'galerie', genre: 'jaime', id: attente, poser: true, max: 5000 })).introuvable, !!(await sMut2.voter({ compteId: w.id, type: 'galerie', genre: 'jaime', id: attente, poser: true, max: 5000 })).introuvable], [true, false]);
        await brut('votes').deleteMany({ cible: attente }); await brut('publications').updateOne({ _id: attente }, { $set: { nbJaime: 0 } });
        // accepter sans la copie avant le passage public
        const sMut3 = A.charger('service.js', [["catch (e) { console.error(`❌ [galerie] copie publique en échec (${(e && (e.name || e.code)) || 'erreur'}) : la publication reste en attente`); await resultat('echec-copie'); return { indispo: true }; }", 'catch (e) { }']]);
        const art2 = await deposer(sv, luma, { nom: 'Copie', format: '1' });
        stockage.panneCopie = true;
        const mod2 = await compte({ role: 'moderateur' }, 'modo-mut');
        const reelC = await svc.decider({ id: `art.${idArt(art2)}`, decision: 'accepter', moderateur: { compteId: mod2.id, droit: 'moderateur' }, stockage, secret: 'x' });
        const muteC = await sMut3.decider({ id: `art.${idArt(art2)}`, decision: 'accepter', moderateur: { compteId: mod2.id, droit: 'moderateur' }, stockage, secret: 'x' });
        stockage.panneCopie = false;
        H.v('   MUTANT « une copie en échec est ignorée » : le réel garde l\'art en attente (indispo), le mutant le passe public SANS fichier', [!!reelC.indispo, !!muteC.ok, (await brut('arts').findOne({ _id: idArt(art2) })).etat], [true, true, 'public']);
    }
    for (const s of serveurs) await s.fermer();
    await dbG.dropDatabase();
    await H.fermerBac();
    H.bilan();
})();

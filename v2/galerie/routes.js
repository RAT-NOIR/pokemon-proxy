'use strict';
// GALERIE — les routes de la Communauté (liste fermée du site, 2026-11-01), sur la base DÉDIÉE. Montées seulement si V2_GALERIE=1 ET la garde de la base dédiée a dit oui (monter.js).
//   A  lecture publique : /api/galerie, /filtres, /{id}/pages/{n}, /api/banque, /formats, /api/illustrations/bornes   (sans cookie, `Cache-Control: public, max-age=60`, aucune donnée du lecteur)
//   B  votes, enregistrements, remix, pseudo                                                                         (session + Origin + X-Rat-Market, compte vérifié, pseudo)
//   C  dépôt d'un art en deux temps                                                                                   (URL R2 présignée, puis finalisation côté serveur)
//   D  signalement (session facultative ; sans session, Turnstile vérifié côté serveur)
//   E  modération (rôle administrateur ou modérateur, relu en base à chaque appel)
// L'ORDRE des refus d'une écriture est celui du contrat : SESSION, ORIGINE, VERIFICATION, LIMITE_DEBIT ; puis le pseudo (INTERDIT), puis la forme, puis l'écriture. Toutes les réponses portent `facturation: null` (aucune route ne facture).
// Les gardes sont CELLES de la v2 (resoudrePorteur, exigerSession, exigerOrigineSite, exigerVerifieAvec, limiteur, verifierTurnstile), pas des copies ; le limiteur compte dans la base dédiée (option `colonne`).
const crypto = require('crypto');
const { repondreErreur } = require('../erreurs');
const L = require('../transport/limites');
const S = require('../comptes/sessions');
const { resoudrePorteur, exigerSession } = require('../porteur');
const { exigerVerifieAvec } = require('../collection/routes');
const { verifierTurnstile } = require('../comptes/turnstile');
const G = require('./base');
const F = require('./forme');
const svc = require('./service');
const depot = require('./depot');

const HEURE = 3600e3, JOUR = 24 * HEURE;
const nomErreur = e => (e && e.name) || 'Error';           // jamais e.message : un pilote peut y mettre une adresse
const indispo = (res, extra) => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible', extra);
const entree = (res, detail) => repondreErreur(res, 'ENTREE', 'Requête invalide', { detail });
const introuvable = res => repondreErreur(res, 'INTROUVABLE', 'Introuvable');
const interdit = (res, detail) => repondreErreur(res, 'INTERDIT', 'Action non permise', { detail });
const ROLES_MODERATION = Object.freeze(['administrateur', 'moderateur']);
const publique = res => res.setHeader('Cache-Control', 'public, max-age=60');
const privee = res => res.setHeader('Cache-Control', 'no-store');
const absent = v => v === undefined || v === '';

function routesGalerie(router, cfg, deps = {}) {
    const g = cfg.galerie, env = deps.env || process.env;
    const secret = cfg.empreinte.secret;
    const maintenant = () => (typeof deps.maintenant === 'function' ? deps.maintenant() : new Date());
    const stockage = () => { if (!deps.stockage) throw new Error('stockage-absent'); return deps.stockage; };
    // L'IP n'est JAMAIS écrite en clair : une empreinte salée par le jour UTC (le sel tourne), gardée le temps de la fenêtre. Sans adresse lisible : on ne laisse pas passer ce qu'on ne sait pas identifier.
    const ipSalee = q => (q.ip ? crypto.createHmac('sha256', secret).update(`${maintenant().toISOString().slice(0, 10)}|${q.ip}`).digest('hex').slice(0, 24) : null);
    const compteDe = q => (q.v2 && q.v2.porteur ? `compte:${q.v2.porteur.id}` : null);
    const lim = (nom, max, fenetreMs, cle) => L.limiteur({ nom: `g-${nom}`, max, fenetreMs, cle, colonne: () => G.col('limites'), code: 'LIMITE_DEBIT' });
    const li = g.limites;

    const dispo = (req, res, next) => (G.branche() ? next() : indispo(res));                // aucune base dédiée branchée : 503, jamais un repli
    const exigerVerifie = exigerVerifieAvec('Confirmez votre adresse e-mail pour utiliser la Communauté');
    const SESSION = [dispo, resoudrePorteur(cfg), exigerSession];
    const ECRITURE = [...SESSION, S.exigerOrigineSite(cfg), exigerVerifie];
    async function exigerPseudo(req, res, next) {
        try { const p = await svc.pseudoDe(req.v2.porteur.id); if (!p) return interdit(res, 'pseudo-requis'); req.galerie = { pseudo: p }; return next(); }
        catch (e) { console.error(`❌ [v2 galerie] lecture du pseudo : ${nomErreur(e)}`); return indispo(res); }
    }
    const LECTURE = [dispo, lim('lecture-ip', li.lectureIpHeure, HEURE, ipSalee)];
    const VOTE = [...ECRITURE, lim('vote-compte', li.votesCompteHeure, HEURE, compteDe), lim('vote-ip', li.votesIpHeure, HEURE, ipSalee), exigerPseudo];
    const protege = (nomRoute, f) => async (req, res) => { try { return await f(req, res); } catch (e) { console.error(`❌ [v2 galerie] ${nomRoute} : ${nomErreur(e)}`); return indispo(res); } };

    // ═══ A. lecture publique ═══
    const PARAMS_GALERIE = ['categorie', 'tri', 'carte', 'couleur', 'type', 'illustrateur', 'set', 'suite'];
    function lireTexteParam(q, nom) {
        const v = q[nom];
        if (absent(v)) return { v: undefined };
        if (typeof v !== 'string' || F.problemeTexte(v, { min: 1, max: 100 })) return { detail: nom };
        return { v: v.normalize('NFKC') };
    }
    router.get('/api/galerie', ...LECTURE, protege('fil', async (req, res) => {
        if (Object.keys(req.query).some(k => !PARAMS_GALERIE.includes(k))) return entree(res, 'parametre');
        const p = {};
        for (const nom of ['carte', 'couleur', 'type', 'illustrateur', 'set']) { const r = lireTexteParam(req.query, nom); if (r.detail) return entree(res, r.detail); p[nom] = r.v; }
        const categorie = req.query.categorie, tri = req.query.tri, suite = F.lireSuite(req.query.suite);
        if (!absent(categorie) && !F.CATEGORIES.includes(categorie)) return entree(res, 'categorie');
        if (!absent(tri) && !F.TRIS_PUBLICATIONS.includes(tri)) return entree(res, 'tri');
        if (suite.detail) return entree(res, suite.detail);
        const r = await svc.listerPublications({ categorie: absent(categorie) ? undefined : categorie, tri: absent(tri) ? 'nouveautes' : tri, ...p, o: suite.o, maintenant: maintenant() });
        publique(res);
        return res.status(200).json({ success: true, publications: r.publications, suite: r.suite });
    }));
    router.get('/api/galerie/filtres', ...LECTURE, protege('filtres', async (req, res) => {
        const f = await svc.filtresDeLaGalerie();
        publique(res);
        return res.status(200).json({ success: true, ...f });
    }));
    router.get('/api/galerie/:id/pages/:n', ...LECTURE, protege('page', async (req, res) => {
        if (!/^[1-9][0-9]{0,2}$/.test(req.params.n)) return entree(res, 'page');
        const p = F.idValide(req.params.id) ? await svc.pageDePublication(req.params.id, Number(req.params.n)) : null;
        if (!p) return introuvable(res);
        publique(res);
        return res.status(200).json({ success: true, page: p });
    }));
    router.get('/api/banque', ...LECTURE, protege('banque', async (req, res) => {
        if (Object.keys(req.query).some(k => !['format', 'q', 'tri', 'suite'].includes(k))) return entree(res, 'parametre');
        const { format, q, tri } = req.query, suite = F.lireSuite(req.query.suite);
        if (!absent(format) && !F.FORMATS_ART.includes(format)) return entree(res, 'format');
        if (!absent(tri) && !F.TRIS_PUBLICATIONS.includes(tri)) return entree(res, 'tri');
        if (!absent(q) && (typeof q !== 'string' || F.problemeTexte(q, { min: 1, max: 40 }))) return entree(res, 'q');
        if (suite.detail) return entree(res, suite.detail);
        const r = await svc.listerArts({ format: absent(format) ? undefined : format, q: absent(q) ? undefined : q, tri: absent(tri) ? 'nouveautes' : tri, o: suite.o, urlPublique: stockage().urlPublique, maintenant: maintenant() });
        publique(res);
        return res.status(200).json({ success: true, arts: r.arts, suite: r.suite });
    }));
    router.get('/api/banque/formats', ...LECTURE, protege('formats', async (req, res) => {
        const formats = await svc.formatsDeLaBanque();
        publique(res);
        return res.status(200).json({ success: true, formats });
    }));
    router.get('/api/illustrations/bornes', ...LECTURE, protege('bornes', async (req, res) => {
        publique(res);
        return res.status(200).json({ success: true, octetsMax: g.bornes.octetsMax, pixelsMax: g.bornes.pixelsMax });
    }));

    // ═══ B. votes, enregistrements, remix, pseudo ═══
    function routeVote(chemin, type, genre) {
        const handler = poser => protege(`${genre}-${type}`, async (req, res) => {
            const r = await svc.voter({ compteId: req.v2.porteur.id, type, genre, id: req.params.id, poser, max: li.jaimeMax, maintenant: maintenant() });
            if (r.introuvable) return introuvable(res);
            if (r.auteur) return interdit(res, 'pas-l-auteur');
            if (r.borne) return repondreErreur(res, 'CONFLIT', `Au plus ${r.borne} ${genre === 'jaime' ? "j'aime" : 'enregistrés'} par compte`, { detail: genre === 'jaime' ? 'borne-jaime' : 'borne-enregistres' });
            privee(res);
            if (genre === 'enregistre') return res.status(200).json({ success: true, enregistre: r.actif });
            const c = svc.compteur(r.nb);
            return res.status(200).json({ success: true, jaime: r.actif, compteur: c.valeur, petitCompteur: c.petit });
        });
        router.put(`${chemin}/${genre}`, ...VOTE, handler(true));
        router.delete(`${chemin}/${genre}`, ...VOTE, handler(false));
    }
    for (const genre of ['jaime', 'enregistre']) { routeVote('/api/classeurs/:id', 'galerie', genre); routeVote('/api/illustrations/:id', 'banque', genre); }

    router.get('/api/enregistres', ...SESSION, lim('lecture-compte', li.lectureIpHeure, HEURE, compteDe), protege('enregistres', async (req, res) => {
        const m = await svc.mesVotes(req.v2.porteur.id);
        privee(res);
        return res.status(200).json({ success: true, ...m });
    }));
    router.post('/api/galerie/:id/remix', ...ECRITURE, lim('ecriture-compte', li.ecrituresCompteHeure, HEURE, compteDe), lim('ecriture-ip', li.ecrituresIpHeure, HEURE, ipSalee), exigerPseudo, protege('remix', async (req, res) => {
        const r = await svc.remixer({ compteId: req.v2.porteur.id, id: req.params.id, max: li.classeursMax, maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.borne) return repondreErreur(res, 'CONFLIT', `Au plus ${r.borne} classeurs par compte`, { detail: 'borne-classeurs' });
        privee(res);
        return res.status(201).json({ success: true, classeurId: r.classeurId });
    }));
    router.put('/api/compte/pseudo', ...ECRITURE, lim('pseudo-compte', li.pseudoCompteJour, JOUR, compteDe), lim('pseudo-ip', li.pseudoIpJour, JOUR, ipSalee), protege('pseudo', async (req, res) => {
        const b = req.body;
        if (!F.objet(b) || !F.cles(b, ['pseudo'])) return entree(res, 'pseudo-invalide');
        const p = F.lirePseudo(b.pseudo);
        if (p.detail) return entree(res, p.detail);
        const r = await svc.poserPseudo(req.v2.porteur.id, p.pseudo, maintenant());
        if (r.conflit) return repondreErreur(res, 'CONFLIT', 'Ce pseudo est déjà pris', { detail: 'pseudo-pris' });
        privee(res);
        return res.status(200).json({ success: true, pseudo: r.pseudo });
    }));

    // ═══ C. le dépôt d'un art, en deux temps ═══
    const reponseRefus = (res, r) => repondreErreur(res, r.refus.code, r.refus.code === 'FICHIER' ? 'Fichier refusé' : r.refus.code === 'INDISPONIBLE' ? 'Service momentanément indisponible' : 'Requête invalide',
        { detail: r.refus.detail, ...(r.refus.reessayerDans !== undefined ? { reessayerDans: r.refus.reessayerDans } : {}) }, r.refus.statut);
    router.post('/api/illustrations/depot', ...ECRITURE, lim('depot-compte', li.depotsCompteHeure, HEURE, compteDe), lim('depot-ip', li.depotsIpHeure, HEURE, ipSalee), exigerPseudo, protege('depot', async (req, res) => {
        const b = req.body;
        if (!F.objet(b) || !F.cles(b, ['type', 'octets']) || typeof b.type !== 'string' || typeof b.octets !== 'number') return entree(res, 'corps');
        const r = await depot.ouvrirDepot({ compteId: req.v2.porteur.id, ref: svc.refCompte(req.v2.porteur.id, secret), type: b.type, octets: b.octets, bornes: g.bornes, stockage: stockage(), maintenant: maintenant() });
        if (r.refus) return reponseRefus(res, r);
        privee(res);
        return res.status(201).json({ success: true, depotId: r.ok.depotId, urlDepot: r.ok.urlDepot, expireDans: r.ok.expireDans });
    }));
    router.post('/api/illustrations/depot/:depot/finaliser', ...ECRITURE, lim('finaliser-compte', li.depotsCompteHeure * 2, HEURE, compteDe), lim('finaliser-ip', li.depotsIpHeure * 2, HEURE, ipSalee), exigerPseudo, protege('finaliser', async (req, res) => {
        const r = await depot.finaliser({ compteId: req.v2.porteur.id, pseudo: req.galerie.pseudo, depotId: req.params.depot, corps: req.body, bornes: g.bornes, stockage: stockage(), maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.refus) return reponseRefus(res, r);
        privee(res);
        return res.status(201).json({ success: true, id: r.ok.id, statut: r.ok.statut });
    }));

    // ═══ D. le signalement : ouvert à toute personne ═══
    const estSession = q => Boolean(q.v2 && q.v2.porteur && q.v2.porteur.type === 'compte' && q.v2.porteur.surface === 'scanner');
    const siSession = mw => (req, res, next) => (estSession(req) ? mw(req, res, next) : next());
    const fetchTurnstile = () => deps.fetchTurnstile || globalThis.fetch;
    router.post('/api/signalements', dispo, resoudrePorteur(cfg), S.exigerOrigineSite(cfg), lim('signalement-ip', li.signalementsIpHeure, HEURE, ipSalee), siSession(lim('signalement-compte', li.signalementsCompteJour, JOUR, compteDe)), protege('signalement', async (req, res) => {
        const b = req.body, session = estSession(req);
        if (!F.objet(b) || !F.cles(b, ['cible', 'motif', 'precision', 'turnstile'])) return entree(res, 'corps');
        const c = typeof b.cible === 'string' ? F.RE_CIBLE.exec(b.cible) : null;
        if (!c) return entree(res, 'cible');
        if (typeof b.motif !== 'string' || !F.MOTIFS.includes(b.motif)) return entree(res, 'motif');
        if (b.precision !== undefined && (typeof b.precision !== 'string' || F.problemeTexte(b.precision, { max: 500, lignes: true }))) return entree(res, b.precision && typeof b.precision === 'string' && /^\s*data:/i.test(b.precision) ? 'donnee-binaire' : 'precision');
        if (b.turnstile !== undefined && (typeof b.turnstile !== 'string' || b.turnstile.length > 2048)) return entree(res, 'turnstile');
        if (!session) {
            // sans session : Turnstile OBLIGATOIRE, vérifié côté serveur (jeton à usage unique, jamais stocké). Une erreur de vérification REFUSE : jamais d'ouverture par défaut.
            if (typeof b.turnstile !== 'string' || !b.turnstile) return repondreErreur(res, 'ENTREE', 'Vérification anti-robot échouée', { detail: 'defi-anti-robot' }, 422);
            let ok;
            try { ok = await verifierTurnstile(b.turnstile, req.ip, { fetch: fetchTurnstile(), secret: env.V2_GALERIE_TURNSTILE_SECRET }); }
            catch (e) { console.error(`❌ [v2 galerie] Turnstile en échec (${nomErreur(e)})`); return indispo(res); }
            if (ok !== true) return repondreErreur(res, 'ENTREE', 'Vérification anti-robot échouée', { detail: 'defi-anti-robot' }, 422);
        }
        // la réponse est la MÊME que la cible existe ou non (rien ne dit si un objet privé existe)
        await svc.signaler({ compteId: session ? req.v2.porteur.id : null, cibleType: c[1], cibleId: c[2], motif: b.motif, precision: b.precision === undefined || b.precision === '' ? null : b.precision.normalize('NFKC'), maintenant: maintenant() });
        privee(res);
        return res.status(201).json({ success: true });
    }));

    // ═══ E. la modération : rôle administrateur OU modérateur, relu en base à chaque appel ═══
    // `req.v2.porteur.compte` est le document du compte lu PAR CETTE REQUÊTE (porteur.js) : le rôle n'est ni dans le cookie ni en cache.
    const exigerModerateur = (req, res, next) => {
        const c = req.v2 && req.v2.porteur && req.v2.porteur.compte;
        return c && ROLES_MODERATION.includes(c.role) ? next() : interdit(res, 'admin');
    };
    const modCompte = lim('moderation-compte', li.moderationCompteHeure, HEURE, compteDe);
    router.get('/api/admin/moderation', ...SESSION, exigerModerateur, modCompte, protege('file', async (req, res) => {
        if (Object.keys(req.query).some(k => !['file', 'suite'].includes(k))) return entree(res, 'parametre');
        const file = req.query.file, suite = F.lireSuite(req.query.suite);
        if (!['publications', 'signalements'].includes(file)) return entree(res, 'file');
        if (suite.detail) return entree(res, suite.detail);
        let st = null; try { st = stockage(); } catch { st = null; }
        const r = await svc.fileModeration({ file, o: suite.o, secret, stockage: st });
        privee(res);
        return res.status(200).json({ success: true, elements: r.elements, suite: r.suite });
    }));
    router.post('/api/admin/moderation/:id/decision', ...SESSION, S.exigerOrigineSite(cfg), exigerModerateur, modCompte, protege('decision', async (req, res) => {
        const b = req.body;
        if (!F.objet(b) || !F.cles(b, ['decision', 'motif', 'precision'])) return entree(res, 'corps');
        if (!F.RE_ID_MODERATION.test(req.params.id)) return introuvable(res);
        if (typeof b.decision !== 'string' || !F.DECISIONS.includes(b.decision)) return entree(res, 'decision');
        if (b.motif !== undefined && b.motif !== null && (typeof b.motif !== 'string' || !F.MOTIFS.includes(b.motif))) return entree(res, 'motif');
        if (['refuser', 'retirer'].includes(b.decision) && (typeof b.motif !== 'string')) return entree(res, 'motif');
        if (b.precision !== undefined && b.precision !== null && (typeof b.precision !== 'string' || F.problemeTexte(b.precision, { max: 500, lignes: true }))) return entree(res, 'precision');
        let st = null; try { st = stockage(); } catch { st = null; }
        const r = await svc.decider({ id: req.params.id, decision: b.decision, motif: b.motif || null, precision: b.precision || null,
            moderateur: { compteId: req.v2.porteur.id, droit: req.v2.porteur.compte.role }, stockage: st, secret, maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.auteur) return interdit(res, 'pas-l-auteur');
        if (r.conflit) return repondreErreur(res, 'CONFLIT', 'La cible n\'est plus dans l\'état attendu', { detail: 'etat' });
        if (r.invalide) return entree(res, 'decision');
        if (r.indispo) return indispo(res, { reessayerDans: 30 });
        privee(res);
        return res.status(200).json({ success: true });
    }));
}
module.exports = { routesGalerie, ROLES_MODERATION };

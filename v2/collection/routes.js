'use strict';
// Ma collection — GET /api/collection, GET /api/collection/sets/:slug, PUT /api/collection/sets/:slug/fiches/:cle, sur la SESSION du compte (comme le scanner : mêmes gardes, réutilisées).
//   · LIRE demande une session (cookie) ; ÉCRIRE demande en plus l'Origin exacte du site + X-Rat-Market, un compte VÉRIFIÉ (données stockées sur la grappe de production) et passe par un limiteur par compte ;
//   · l'ORDRE : identité, session, origine, vérification, limite, puis la forme (chemin, corps), puis l'écriture — un refus de forme est un refus compté, jamais une écriture ;
//   · la clé d'une fiche est `idInterne|numero` (forme.js) : le serveur ne peut pas vérifier qu'elle désigne une fiche réelle, il en juge la forme.
const { repondreErreur } = require('../erreurs');
const L = require('../transport/limites');
const S = require('../comptes/sessions');
const { resoudrePorteur, exigerSession } = require('../porteur');
const F = require('./forme');
const svc = require('./service');

const nomErreur = e => (e && e.name) || 'Error';           // jamais e.message : un pilote peut y mettre une adresse
const indispo = res => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
const corpsValide = b => b !== null && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 1 && typeof b.possedee === 'boolean';
const MESSAGES_BORNE = Object.freeze({
    'borne-set': n => `Au plus ${n} fiches cochées par set`,
    'borne-compte': n => `Au plus ${n} fiches cochées au total sur un compte`,
    'borne-sets': n => `Au plus ${n} sets avec des fiches cochées par compte`
});
// un compte dont l'adresse n'est pas confirmée n'écrit pas : même refus que le scanner pour ses crédits (403 VERIFICATION), sans solde (aucun crédit n'est en jeu)
function exigerVerifie(req, res, next) {
    return req.v2.porteur.compte && req.v2.porteur.compte.verifie === true ? next() : repondreErreur(res, 'VERIFICATION', 'Confirmez votre adresse e-mail pour enregistrer votre collection');
}

function routesCollection(router, cfg) {
    const parCompte = L.limiteur({ nom: 'collection', max: cfg.limites.collectionEcrituresParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    const LECTURE = [resoudrePorteur(cfg), exigerSession];
    const ECRITURE = [resoudrePorteur(cfg), exigerSession, S.exigerOrigineSite(cfg), exigerVerifie, parCompte];
    const entree = (res, detail) => repondreErreur(res, 'ENTREE', 'Requête invalide', { detail });
    const compteId = req => req.v2.porteur.id;

    router.get('/api/collection', ...LECTURE, async (req, res) => {
        try {
            const sets = await svc.lireSets(compteId(req));
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, sets: sets.map(s => ({ slug: s.slug, possedees: s.possedees, majLe: s.majLe.toISOString() })) });
        } catch (e) { console.error(`❌ [v2 collection] lecture des sets : ${nomErreur(e)}`); return indispo(res); }
    });

    router.get('/api/collection/sets/:slug', ...LECTURE, async (req, res) => {
        try {
            if (!F.slugValide(req.params.slug)) return entree(res, 'slug');
            const s = await svc.lireSet(compteId(req), req.params.slug);
            res.setHeader('Cache-Control', 'no-store');
            // `cotes` : toujours {} dans cette version — la cote d'une fiche demande une table fiche → produits qui vit dans la base `cartes`, que l'API ne lit pas (CONTRAT-API-V2.md §1.8). Le site lit {} comme « null pour toute fiche ».
            return res.status(200).json({ success: true, set: req.params.slug, possedees: s.cles, cotes: {}, majLe: s.majLe ? s.majLe.toISOString() : null });
        } catch (e) { console.error(`❌ [v2 collection] lecture d'un set : ${nomErreur(e)}`); return indispo(res); }
    });

    router.put('/api/collection/sets/:slug/fiches/:cle', ...ECRITURE, async (req, res) => {
        try {
            if (!F.slugValide(req.params.slug)) return entree(res, 'slug');
            if (!F.cleValide(req.params.cle)) return entree(res, 'cle');
            if (!corpsValide(req.body)) return entree(res, 'possedee');
            const r = await svc.cocher({ compteId: compteId(req), slug: req.params.slug, cle: req.params.cle, possedee: req.body.possedee, cfg });
            if (r.refus) return repondreErreur(res, 'CONFLIT', MESSAGES_BORNE[r.refus](r.borne), { detail: r.refus });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, possedees: r.possedees });
        } catch (e) { console.error(`❌ [v2 collection] écriture : ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesCollection, corpsValide };

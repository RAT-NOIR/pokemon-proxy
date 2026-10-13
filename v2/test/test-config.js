'use strict';
const H = require('./_harnais');                      // pour v()/bilan() seulement : ce banc n'ouvre pas la base
const { lireConfig } = require('../config');
const { CODES, corpsErreur, repondreErreur } = require('../erreurs');
const { choixPour } = require('../choix');

const c = lireConfig({});
H.v('interrupteur éteint par défaut', c.actif, false);
H.v('essais', c.quotas.essai, 3);
H.v('accueil', c.quotas.accueil, 25);
H.v('hebdo', c.quotas.hebdo, 2);
H.v('ordre des poches par défaut (OFFRE-QUOTA : la seule poche débitable est le quota du jour)', c.ordrePoches, ['jour']);
H.v('quotas quotidiens par défaut : sans compte 3, gratuit 10, plafond technique Pro 200', [c.quotas.sansCompte, c.quotas.gratuit, c.quotas.proPlafond], [3, 10, 200]);
H.v('plafonds de remboursement', c.plafonds, { panne: 5, question: 30, sansPrix: 5, lotTropGrand: 10, jumeaux: 20 });
H.v('délai d\'une question (24 h)', c.questionDelaiMs, 86400000);
H.v('idempotence : battement 30 s', c.retention.idempotenceBattementMs, 30000);
H.v('idempotence : au plus 10 min', c.retention.idempotenceBattementMaxMinutes, 10);
H.v('origine extension exacte', c.origines.extension, 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb');
H.v('origine site exacte', c.origines.site, 'https://rat-market.fr');
H.v('hôte du bucket public', c.images.hotesPublics[0], 'pub-7d992e666c3d4a2b870b680a920045b6.r2.dev');
H.v('annonce conservée 90 jours', c.retention.annonceJours, 90);
H.v('seuils du verdict', c.verdict, { bonneAffaireSous: -30, cherAuDela: 15 });
H.v('mot de passe : 10 caractères', c.comptes.motDePasseMin, 10);
H.v('lot : paliers de 10', c.lot.tranche, 10);
H.v('devises', c.devises, ['EUR', 'GBP', 'USD', 'PLN', 'CZK', 'HUF', 'RON', 'SEK', 'DKK']);
// un nombre fait d'espaces ne vaut PAS 0 : refus
let l0 = null; try { lireConfig({ V2_ACCUEIL: '   ' }); } catch (e) { l0 = e.message; }
H.vrai('V2_ACCUEIL="   " lève (jamais 0 silencieux)', /configuration invalide/.test(l0 || ''));
// variables booléennes : seulement '0' et '1' ; toute autre valeur (false, off, non, oui, vrai…) rend la configuration invalide
H.v('V2_DESCRIPTION_CONSERVEE défaut : allumée', c.annonce.conservee, true);
H.v('V2_DESCRIPTION_CONSERVEE=0 : éteinte', lireConfig({ V2_DESCRIPTION_CONSERVEE: '0' }).annonce.conservee, false);
H.v('V2_DESCRIPTION_CONSERVEE=1 : allumée', lireConfig({ V2_DESCRIPTION_CONSERVEE: '1' }).annonce.conservee, true);
for (const nom of ['V2_DESCRIPTION_CONSERVEE', 'V2_DESCRIPTION_AU_MODELE', 'V2_REGLE_G', 'V2_COOKIE_SECURE']) {
    for (const mauvaise of ['false', 'off', 'non', 'oui', 'true', ' 0']) {
        let e = null; try { lireConfig({ [nom]: mauvaise }); } catch (x) { e = x.message; }
        H.vrai(`${nom}="${mauvaise}" rend la configuration invalide`, /configuration invalide/.test(e || ''));
    }
}
let lt = null; try { lireConfig({ V2_TURNSTILE: 'non' }); } catch (x) { lt = x.message; }
H.vrai('V2_TURNSTILE hors on/off rend la configuration invalide', /configuration invalide/.test(lt || ''));
H.v('V2_TURNSTILE=off', lireConfig({ V2_TURNSTILE: 'off' }).turnstile, 'off');
H.v('V2_COOKIE_SECURE=0', lireConfig({ V2_COOKIE_SECURE: '0' }).cookieSecure, false);
// une valeur d'environnement s'applique
H.v('V2_ACCUEIL=10 s\'applique', lireConfig({ V2_ACCUEIL: '10' }).quotas.accueil, 10);
// une valeur INVALIDE LÈVE (on n'allume pas la v2 sur une configuration qu'on ne comprend pas)
let l1 = null; try { lireConfig({ V2_ACCUEIL: 'beaucoup' }); } catch (e) { l1 = e.message; }
H.vrai('V2_ACCUEIL invalide lève', /configuration invalide/.test(l1 || ''));
// OFFRE-QUOTA (2026-10-13, décision du testeur) : la seule poche débitable est `jour`. Les anciennes ne sont plus nommables dans l'ordre (leurs soldes restent lisibles) ; l'ordre doit contenir `jour`.
let l2 = null; try { lireConfig({ V2_ORDRE_POCHES: 'jour,gratuit' }); } catch (e) { l2 = e.message; }
H.vrai('poche inconnue dans l\'ordre lève', /poche inconnue/.test(l2 || ''));
let l3 = null; try { lireConfig({ V2_ORDRE_POCHES: 'jour,jour' }); } catch (e) { l3 = e.message; }
H.vrai('doublon dans l\'ordre lève', /doublon/.test(l3 || ''));
// O2 réécrite : au lieu d'exiger les poches payées, la garde exige `jour` (sinon plus aucun porteur ne serait débitable) et refuse toute ancienne poche
const refusOrdre = o => { try { lireConfig({ V2_ORDRE_POCHES: o }); return null; } catch (e) { return e.message; } };
H.vrai('O2 : une ancienne poche (essai, accueil, hebdo, abonnement, achete) est refusée et dit qu\'elle n\'est plus débitée', ['essai', 'accueil', 'hebdo', 'abonnement', 'achete', 'jour,achete'].every(o => /n'est plus débitée/.test(refusOrdre(o) || '')));
H.vrai('O2 : un ordre sans `jour` est refusé (configuration invalide)', /configuration invalide/.test(refusOrdre(',') || ''));
H.v('O2 : `jour` est accepté, c\'est aussi le défaut', [refusOrdre('jour'), lireConfig({ V2_ORDRE_POCHES: 'jour' }).ordrePoches], [null, ['jour']]);
// l'origine "extension de développement" n'est lue QUE sur test_scratch
H.v('extension dev ignorée en production', lireConfig({ V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://abc', MONGODB_BASE: 'test' }).origines.extensionDev, null);
H.v('extension dev lue sur test_scratch', lireConfig({ V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://abc', MONGODB_BASE: 'test_scratch' }).origines.extensionDev, 'chrome-extension://abc');
// la configuration est gelée
H.vrai('configuration gelée', Object.isFrozen(c) && Object.isFrozen(c.quotas));

// erreurs
H.v('JETON 401', CODES.JETON, 401);
H.v('QUOTA 429', CODES.QUOTA, 429);
H.v('IMAGE garde 200 (comme exigerImage)', CODES.IMAGE, 200);
H.v('corps d\'erreur', corpsErreur('QUOTA', 'm', { solde: { total: 0 } }),
    { success: false, erreur: { code: 'QUOTA', message: 'm' }, facturation: null, solde: { total: 0 } });
let l4 = null; try { corpsErreur('INCONNU', 'x'); } catch (e) { l4 = e.message; }
H.vrai('un code hors liste lève', /code d'erreur inconnu/.test(l4 || ''));
for (const faux of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    let e = null; try { corpsErreur(faux, 'x'); } catch (x) { e = x.message; }
    H.vrai(`un nom hérité du prototype (${faux}) n'est pas un code`, /code d'erreur inconnu/.test(e || ''));
}
const res = { s: null, j: null, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; } };
repondreErreur(res, 'DEBIT', 'trop vite', { reessayerDans: 2 });
H.v('repondreErreur : statut 429 et reessayerDans', [res.s, res.j.erreur.reessayerDans], [429, 2]);

// choix (partagé B1 et B3) : trié par idProduct, identifiants a/b/c
H.v('choixPour trie par idProduct', choixPour([30, 10, 20]),
    [{ id: 'a', idProduct: 10 }, { id: 'b', idProduct: 20 }, { id: 'c', idProduct: 30 }]);
H.v('choixPour à 2 candidats', choixPour([7, 3]), [{ id: 'a', idProduct: 3 }, { id: 'b', idProduct: 7 }]);
H.v('choixPour à UN candidat (UN-CANDIDAT, D1 : la question de confirmation)', choixPour([5]), [{ id: 'a', idProduct: 5 }]);
for (const [nom, arg] of [['aucun candidat', []], ['quatre candidats', [1, 2, 3, 4]], ['un doublon', [2, 2]]]) {
    let e = null; try { choixPour(arg); } catch (x) { e = x.message; }
    H.vrai(`choixPour : ${nom} lève`, e);
}
H.bilan();

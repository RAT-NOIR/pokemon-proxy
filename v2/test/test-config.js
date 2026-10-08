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
H.v('ordre des poches par défaut', c.ordrePoches, ['essai', 'accueil', 'hebdo', 'abonnement', 'achete']);
H.v('plafonds de remboursement', c.plafonds, { panne: 5, question: 30 });
H.v('délai d\'une question (24 h)', c.questionDelaiMs, 86400000);
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
// une valeur d'environnement s'applique
H.v('V2_ACCUEIL=10 s\'applique', lireConfig({ V2_ACCUEIL: '10' }).quotas.accueil, 10);
// une valeur INVALIDE LÈVE (on n'allume pas la v2 sur une configuration qu'on ne comprend pas)
let l1 = null; try { lireConfig({ V2_ACCUEIL: 'beaucoup' }); } catch (e) { l1 = e.message; }
H.vrai('V2_ACCUEIL invalide lève', /configuration invalide/.test(l1 || ''));
let l2 = null; try { lireConfig({ V2_ORDRE_POCHES: 'essai,gratuit' }); } catch (e) { l2 = e.message; }
H.vrai('poche inconnue dans l\'ordre lève', /poche inconnue/.test(l2 || ''));
let l3 = null; try { lireConfig({ V2_ORDRE_POCHES: 'essai,accueil,accueil' }); } catch (e) { l3 = e.message; }
H.vrai('doublon dans l\'ordre lève', /doublon/.test(l3 || ''));
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
for (const [nom, arg] of [['un seul candidat', [5]], ['quatre candidats', [1, 2, 3, 4]], ['un doublon', [2, 2]]]) {
    let e = null; try { choixPour(arg); } catch (x) { e = x.message; }
    H.vrai(`choixPour : ${nom} lève`, e);
}
H.bilan();

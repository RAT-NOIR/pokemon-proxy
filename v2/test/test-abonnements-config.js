'use strict';
// STRIPE-V2 — la configuration (éteinte par défaut, jamais de levée, jamais de valeur dans une sortie), les offres, et la CONCORDANCE entre le code, le contrat écrit et l'OpenAPI.
// Aucune base, aucun réseau.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { lireConfig } = require('../config');
const C = require('../abonnements/config'); const O = require('../abonnements/offres');
const A = require('./_aide-abonnements');
const { TYPES } = require('../abonnements/webhook'); const { EVENEMENTS } = require('../admin/abonnements/provisionner-lib');
const racine = path.join(__dirname, '..', '..');
const doc = fs.readFileSync(path.join(racine, 'CONTRAT-STRIPE-V2.md'), 'utf8');
const openapi = require('../openapi/openapi.v2.json');
const base = { ...A.ENV };
const lire = (o = {}) => C.lireAbonnements({ ...base, ...o });

// ── éteint par défaut, allumé par « 1 » EXACTEMENT ──
H.v('absent : éteint, rien de manquant (aucune configuration n\'est exigée)', [lire({ V2_ABONNEMENTS: undefined }).actif, lire({ V2_ABONNEMENTS: undefined }).pret, lire({ V2_ABONNEMENTS: undefined }).manquantes], [false, false, []]);
for (const v of ['true', 'on', 'yes', '2', '01', ' 1', '1 ', 'TRUE']) H.v(`V2_ABONNEMENTS="${v}" : éteint`, lire({ V2_ABONNEMENTS: v }).actif, false);
H.v('V2_ABONNEMENTS="1" avec une configuration complète : allumé et prêt', [lire().actif, lire().pret, lire().mode], [true, true, 'test']);
H.v('   lireConfig (la v2) porte la section, éteinte quand rien n\'est posé', [lireConfig({ MONGODB_BASE: 'test_scratch' }).abonnements.actif, lireConfig({ MONGODB_BASE: 'test_scratch' }).abonnements.pret], [false, false]);

// ── elle ne lève JAMAIS, même sur n'importe quoi ──
const poubelles = ['', ' ', 'x', '1', 'price_', 'sk_test_', '\u0000', 'é'.repeat(5000), '0', '-1', 'null', '[]', '{}'];
let leve = 0, essais = 0;
for (const nom of ['V2_STRIPE_MODE', 'V2_STRIPE_CLE', 'V2_STRIPE_WEBHOOK_SECRET', 'V2_STRIPE_PORTAIL_CONFIG_PRO', 'V2_STRIPE_PORTAIL_CONFIG_FONDATEURS', 'V2_STRIPE_PRIX_PRO_MOIS', 'V2_STRIPE_PRIX_PRO_AN', 'V2_STRIPE_PRIX_FONDATEURS_MOIS', 'V2_STRIPE_PRIX_FONDATEURS_AN', 'V2_FONDATEURS_PLACES', 'V2_FONDATEURS_CODE', 'V2_FONDATEURS_CODE_EMPREINTE'])
    for (const p of poubelles) { essais++; try { const c = lire({ [nom]: p }); lireConfig({ ...base, [nom]: p, V2_ABONNEMENTS: '1' }); if (typeof c.pret !== 'boolean') leve++; } catch { leve++; } }
H.v(`${essais} valeurs absurdes, une variable à la fois : aucune levée (un réglage faux ne coûte jamais un 503 à toute la v2)`, leve, 0);

// ── chaque variable manquante ou fausse est NOMMÉE, jamais sa valeur ──
H.v('variables Pro obligatoires : chacune, retirée, est nommée et rend pret=false', ['V2_STRIPE_MODE', 'V2_STRIPE_CLE', 'V2_STRIPE_WEBHOOK_SECRET', 'V2_STRIPE_PORTAIL_CONFIG_PRO', 'V2_STRIPE_PRIX_PRO_MOIS', 'V2_STRIPE_PRIX_PRO_AN'].map(n => { const c = lire({ [n]: '' }); return [c.pret, c.manquantes.includes(n)]; }), Array(6).fill([false, true]));
H.v('   le portail Fondateurs est facultatif (offre fermée) ; les deux portails sont deux configurations DISTINCTES', [lire({ V2_STRIPE_PORTAIL_CONFIG_FONDATEURS: '' }).pret, lire({ V2_STRIPE_PORTAIL_CONFIG_FONDATEURS: '' }).portail, lire().portail, lire({ V2_STRIPE_PORTAIL_CONFIG_FONDATEURS: A.ENV.V2_STRIPE_PORTAIL_CONFIG_PRO }).invalides.sort()], [true, { pro: 'bpc_BANCpro', fondateurs: null }, { pro: 'bpc_BANCpro', fondateurs: 'bpc_BANCfond' }, ['V2_STRIPE_PORTAIL_CONFIG_FONDATEURS', 'V2_STRIPE_PORTAIL_CONFIG_PRO']]);
H.v('   Fondateurs est facultatif : sans ses prix ni son code, Pro reste prêt et Fondateurs fermé', [lire({ V2_STRIPE_PRIX_FONDATEURS_MOIS: '', V2_STRIPE_PRIX_FONDATEURS_AN: '', V2_FONDATEURS_CODE: '' }).pret, lire({ V2_STRIPE_PRIX_FONDATEURS_MOIS: '', V2_STRIPE_PRIX_FONDATEURS_AN: '', V2_FONDATEURS_CODE: '' }).fondateurs.ouvert], [true, false]);
H.v('   un code sans les deux prix Fondateurs : fermé aussi', lire({ V2_STRIPE_PRIX_FONDATEURS_AN: '' }).fondateurs.ouvert, false);
H.v('   une clé Live avec un mode test : rien ne s\'allume (et inversement)', [lire({ V2_STRIPE_CLE: 'sk_live_abc123' }).pret, lire({ V2_STRIPE_MODE: 'live' }).pret, lire({ V2_STRIPE_MODE: 'live', V2_STRIPE_CLE: 'sk_live_abc123' }).pret, lire({ V2_STRIPE_MODE: 'live', V2_STRIPE_CLE: 'rk_live_abc123' }).pret], [false, false, true, true]);
H.v('   le mode doit être « test » ou « live »', [lire({ V2_STRIPE_MODE: 'prod' }).invalides], [['V2_STRIPE_MODE']]);
H.v('   les formes : price_, whsec_, bpc_', [lire({ V2_STRIPE_PRIX_PRO_MOIS: 'prix1' }).invalides, lire({ V2_STRIPE_WEBHOOK_SECRET: 'secret' }).invalides, lire({ V2_STRIPE_PORTAIL_CONFIG_PRO: 'portail' }).invalides], [['V2_STRIPE_PRIX_PRO_MOIS'], ['V2_STRIPE_WEBHOOK_SECRET'], ['V2_STRIPE_PORTAIL_CONFIG_PRO']]);
H.v('   deux offres sur le MÊME price_ (indiscernables au webhook) : les deux variables sont fausses, rien n\'est prêt', [lire({ V2_STRIPE_PRIX_FONDATEURS_MOIS: A.PRIX.proMois }).pret, lire({ V2_STRIPE_PRIX_FONDATEURS_MOIS: A.PRIX.proMois }).invalides.sort()], [false, ['V2_STRIPE_PRIX_FONDATEURS_MOIS', 'V2_STRIPE_PRIX_PRO_MOIS']]);
H.v('   places : 100 par défaut, de 1 à 1000, entier', [lire({ V2_FONDATEURS_PLACES: '' }).fondateurs.places, lire({ V2_FONDATEURS_PLACES: '1000' }).fondateurs.places, lire({ V2_FONDATEURS_PLACES: '0' }).invalides, lire({ V2_FONDATEURS_PLACES: '1001' }).invalides, lire({ V2_FONDATEURS_PLACES: '2.5' }).invalides, lire({ V2_FONDATEURS_PLACES: '1e2' }).invalides], [100, 1000, ['V2_FONDATEURS_PLACES'], ['V2_FONDATEURS_PLACES'], ['V2_FONDATEURS_PLACES'], ['V2_FONDATEURS_PLACES']]);

// ── le code Fondateurs : valeur OU empreinte ──
const crypto = require('crypto');
const empreinte = crypto.createHash('sha256').update(C.normaliserCode(A.CODE_FONDATEURS), 'utf8').digest('hex');
const cV = lire(), cE = lire({ V2_FONDATEURS_CODE: '', V2_FONDATEURS_CODE_EMPREINTE: empreinte });
H.v('la valeur et l\'empreinte donnent la même vérification', [cV.fondateurs.empreinteCode === cE.fondateurs.empreinteCode, C.codeFondateursValide(A.CODE_FONDATEURS, cV.fondateurs.empreinteCode), C.codeFondateursValide(A.CODE_FONDATEURS, cE.fondateurs.empreinteCode)], [true, true, true]);
H.v('   la casse et les espaces sont ignorés ; un autre code, une chaîne vide, un code trop long : faux', [C.codeFondateursValide(' fondateurs-banc-2026 ', cV.fondateurs.empreinteCode), C.codeFondateursValide('FONDATEURS-BANC-2027', cV.fondateurs.empreinteCode), C.codeFondateursValide('', cV.fondateurs.empreinteCode), C.codeFondateursValide('x'.repeat(201), cV.fondateurs.empreinteCode)], [true, false, false, false]);
H.v('   la valeur ET l\'empreinte à la fois : les deux invalides (une source qui ment) ; une empreinte mal formée ; un code de moins de 6 caractères', [lire({ V2_FONDATEURS_CODE_EMPREINTE: empreinte }).invalides.sort(), lire({ V2_FONDATEURS_CODE: '', V2_FONDATEURS_CODE_EMPREINTE: 'abc' }).invalides, lire({ V2_FONDATEURS_CODE: 'abc' }).invalides], [['V2_FONDATEURS_CODE', 'V2_FONDATEURS_CODE_EMPREINTE'], ['V2_FONDATEURS_CODE_EMPREINTE'], ['V2_FONDATEURS_CODE']]);
H.v('   codeFondateursValide refuse une empreinte absente ou mal formée', [C.codeFondateursValide('abc', null), C.codeFondateursValide('abc', 'zz'), C.codeFondateursValide(12, empreinte)], [false, false, false]);

// ── aucune valeur ne s'imprime ──
const c = lire();
const sortie = JSON.stringify(c) + JSON.stringify(Object.entries(c)) + require('util').inspect(c, { depth: 5 }) + JSON.stringify(lireConfig({ ...base, V2_ABONNEMENTS: '1' }).abonnements);
H.v('la clé et le secret ne s\'énumèrent pas : ni JSON.stringify, ni inspect, ni la configuration entière de la v2 ne les montrent', [sortie.includes('sk_test_'), sortie.includes('whsec_'), sortie.includes(A.CODE_FONDATEURS), sortie.includes(empreinte)], [false, false, false, false]);
H.v('   mais le code les lit', [c.cle, c.webhookSecret], ['sk_test_' + 'BANCfauxBANCfaux', A.SECRET]);
H.v('   la configuration est gelée', [Object.isFrozen(lireConfig({ ...base, V2_ABONNEMENTS: '1' }).abonnements), Object.isFrozen(lireConfig({ ...base, V2_ABONNEMENTS: '1' }).abonnements.fondateurs)], [true, true]);
H.v('   les avertissements nomment des variables, jamais des valeurs', lire({ V2_STRIPE_CLE: 'sk_live_' + 'valeurSECRETE999' }).avertissements.join(' ').includes('SECRETE'), false);

// ── les offres : les valeurs exactes de la décision ──
H.v('prix en centimes : Pro 499 / 3 900, Fondateurs 299 / 2 900, EUR', [O.CATALOGUE.pro.prix, O.CATALOGUE.fondateurs.prix, O.DEVISE], [{ mois: 499, an: 3900 }, { mois: 299, an: 2900 }, 'eur']);
H.v('essai 14 jours, 30 pour un filleul, grâce d\'impayé 3 jours, session 60 minutes', [O.ESSAI_JOURS, O.ESSAI_PARRAINAGE_JOURS, O.GRACE_IMPAYE_JOURS, O.SESSION_MINUTES], [14, 30, 3, 60]);
H.v('quatre clés de recherche distinctes', [Object.keys(O.DEPUIS_LOOKUP).sort()], [['rm_v2_fondateurs_an', 'rm_v2_fondateurs_mois', 'rm_v2_pro_an', 'rm_v2_pro_mois']]);

// ── CONCORDANCE : le code, le contrat écrit, l'OpenAPI ──
H.v('les six événements du webhook = ceux du provisionnement = ceux du contrat', [[...TYPES], [...EVENEMENTS], EVENEMENTS.filter(e => !doc.includes('`' + e + '`'))], [[...EVENEMENTS], [...TYPES], []]);
H.v('chaque variable du contrat est lue par le code, et réciproquement', [Object.values(C.NOMS).flatMap(v => (typeof v === 'string' ? [v] : Object.values(v).flatMap(w => (typeof w === 'string' ? [w] : Object.values(w))))).filter(n => !doc.includes('`' + n + '`')), ['V2_ABONNEMENTS'].filter(n => !doc.includes('`' + n + '`'))], [[], []]);
const src = fs.readFileSync(path.join(__dirname, '..', 'abonnements', 'routes.js'), 'utf8');
const details = [...new Set([...src.matchAll(/(?:entree|conflit|indispo)\(res, '([a-z-]+)'/g)].map(m => m[1]).concat([...src.matchAll(/detail: '([a-z-]+)'/g)].map(m => m[1])))];
H.vrai(`instrument : ${details.length} codes « detail » lus dans le code des routes`, details.length >= 12);
H.v('chaque « detail » émis par les routes figure dans le contrat écrit', details.filter(d => !doc.includes('`' + d + '`')), []);
const bodyAlt = JSON.stringify(openapi.paths['/api/abonnement/checkout'].post.responses);
H.v('l\'OpenAPI documente les statuts du checkout (200, 400, 401, 403, 409, 422, 429, 503) et du portail', [Object.keys(openapi.paths['/api/abonnement/checkout'].post.responses).sort(), Object.keys(openapi.paths['/api/abonnement/portail'].post.responses).sort(), Object.keys(openapi.paths['/api/abonnement'].get.responses).sort()], [['200', '400', '401', '403', '409', '422', '429', '503'], ['200', '401', '403', '409', '429', '503'], ['200', '401', '429', '503']]);
H.v('   les montants de l\'OpenAPI sont ceux du code', [openapi.components.schemas.ReponseAbonnement.properties.offres.properties.source.enum, openapi.components.schemas.ReponseAbonnement.properties.offres.properties.essaiJours.const, openapi.components.schemas.ReponseAbonnement.properties.parrainage.properties.essaiFilleulJours.const], [['stripe', 'constantes'], O.ESSAI_JOURS, O.ESSAI_PARRAINAGE_JOURS]);
H.v('   la marge de renouvellement est une constante nommée de 48 heures', O.MARGE_RENOUVELLEMENT_HEURES, 48);
H.vrai('   le contrat cite l\'URL de confidentialité du portail (confirmée : la page existe sur le site)', doc.includes('https://rat-market.fr/politique-confidentialite'));
H.v('   le schéma du checkout porte les champs que la route accepte, et eux seuls', [Object.keys(openapi.components.schemas.RequeteCheckout.properties).sort(), openapi.components.schemas.RequeteCheckout.additionalProperties], [['code', 'offre', 'periode', 'retour'], false]);
H.v('   la forme de `retour` de l\'OpenAPI est celle de la route', new RegExp(openapi.components.schemas.RequeteCheckout.properties.retour.pattern).source, require('../abonnements/routes').FORME_RETOUR.source);
H.v('le contrat dit : CGV toujours exigées, essai 14 jours une fois, parrainage 30 jours, trois jours de grâce, mode brut du webhook', ['terms_of_service', '14 jours', '30 jours', '3 jours', 'brut'].filter(m => !doc.includes(m)), []);
// I3 : le jeu de mutations des gardes d'argent est dans le dépôt, rejouable, hors de lancer-tout ; ses ancres existent encore
const Mu = require('../mesures/mutations-abonnements');
H.v('mutations : chaque ancre existe EXACTEMENT une fois dans le code (le jeu n\'a pas pourri) ; plus de 40 mutants', [Mu.ancresCassees(), Mu.MUTANTS.length > 40], [[], true]);
H.v('   le jeu vit dans v2/mesures, pas dans v2/test : lancer-tout (qui ne lit que v2/test) ne le lance jamais', [fs.existsSync(path.join(racine, 'v2', 'mesures', 'mutations-abonnements.js')), fs.readdirSync(path.join(racine, 'v2', 'test')).some(f => /mutations-abonnements/.test(f))], [true, false]);
H.bilan();

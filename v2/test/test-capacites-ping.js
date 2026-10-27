'use strict';
// CAPACITES-PING (2026-10-24) — `GET /ping` annonce `capacites`, une liste FERMÉE de jetons, chacun vrai seulement si le serveur SERT la partie du contrat qu'il nomme.
// Le banc juge quatre choses : (1) la liste fermée et la garde (un jeton entre s'il est dans la liste ET si sa condition est vraie, rien d'autre) ; (2) que chaque jeton constant est
// MÉRITÉ — le code qui le rend vrai est appelé ici, sur des entrées fictives, et son effet est constaté (un jeton annoncé dont le code disparaîtrait fait échouer ce banc) ;
// (3) `ping()` : même condition que `versionMinExtension` (v2 configurée), jamais d'exception, jamais de lecture en base ; (4) la v2 non configurée ou invalide ne dit rien.
// TOUR 1 : `langue-impression` et `marques` suivent l'archive des visuels EN MÉMOIRE (lecteur injecté) : absente, sans la colonne, complète ; et toutes les variables V2_* de config.js sont balayées.
// Aucune base, aucun réseau. Une fonction pure de la configuration et de la version en mémoire : le temps de réponse de /ping ne change pas.
const fs = require('fs'), path = require('path');
const express = require('express');
const H = require('./_harnais');
const v2 = require('../index');
const { lireConfig } = require('../config');
const E = require('../chargeur/etat');
const { creerConstructeur } = require('../chargeur/version');
const VB = require('./_visuels-banc');

// TOUR 1 : deux jetons dépendent d'une DONNÉE, l'archive des visuels EN MÉMOIRE (chargeur/etat.js). Des archives construites avec le MÊME constructeur que le chargeur (donc la même validation) :
// COMPLÈTE = des entrées ET la colonne des jumeaux (un tirage japonais) ; SANS COLONNE = des entrées seules (une archive d'avant la colonne des jumeaux).
const archive = avecColonne => { const b = creerConstructeur(); b.entree(VB.doc(9100001)); if (avecColonne) b.jumeau({ idProduct: 9100001, idMetacard: 990101, idExpansion: 1, numero: '001', tirage: 'jp' }); return b.finir(); };
const COMPLETE = archive(true), SANS_COLONNE = archive(false);
const DE_L_ARCHIVE = ['langue-impression', 'marques'];
const SANS_EMPREINTE = j => j !== 'empreinte' && j !== 'mesures-client';           // CALCUL-CLIENT : `mesures-client` exige le jeton `empreinte` (et deux drapeaux) : sans index chargé, il tombe avec lui

const ENV = { RM_API_V2: '1', MONGODB_BASE: 'test_scratch' };
// Le contrat de l'EXTENSION (DEMANDE-SERVEUR-EXTENSION.md, « EXTENSION — 24/10 (soir) ») : cinq jetons, dans cet ordre. Le dire ici une fois, à la main, est voulu : changer la liste est une décision
// qui se prend des deux côtés, pas un effet de bord. Tous les AUTRES contrôles lisent la liste exportée par v2/capacites.js.
const CONTRAT_EXTENSION = ['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour'];
// 25/10 : le sixième jeton, `empreinte` (DEMANDE-SERVEUR-EXTENSION.md, contrat de l'empreinte, point 8), en fin de liste, annoncé seulement si l'index d'empreintes est CHARGÉ.
// 26/10 (nuit) : le septième, `mesures-client` (contrat « calcul client », point 5), en fin de liste, annoncé seulement si V2_MESURES_CLIENT=1, V2_ORB_SERVEUR=0 ET le jeton `empreinte`.
const CONTRAT_LISTE = [...CONTRAT_EXTENSION, 'empreinte', 'mesures-client'];

let C = null;
try { C = require('../capacites'); } catch (e) { console.log(`   (v2/capacites.js absent ou illisible : ${e.code || e.message})`); }
H.vrai('v2/capacites.js existe et exporte CAPACITES et capacitesServies', C !== null && Array.isArray(C.CAPACITES) && typeof C.capacitesServies === 'function');
const LISTE = C && Array.isArray(C.CAPACITES) ? C.CAPACITES : [];

// ── 1. la liste fermée : un seul endroit, figée, sans doublon, celle de l'extension ──
H.v('la liste fermée est celle du contrat de l\'extension (cinq jetons) puis `empreinte` en fin de liste', [...LISTE], CONTRAT_LISTE);
H.vrai('   elle est gelée (un bout de code ne la rallonge pas)', C !== null && Object.isFrozen(C.CAPACITES));
H.v('   sans doublon', new Set(LISTE).size, LISTE.length);
H.vrai('   que des jetons minuscules à tirets', LISTE.every(j => /^[a-z]+(-[a-z]+)*$/.test(j)));

// ── 2. la garde : un jeton entre s'il est dans la liste ET si sa condition est EXACTEMENT vraie ──
if (C) {
    const cfg = lireConfig(ENV);
    const tout = () => Object.fromEntries(LISTE.map(j => [j, () => true]));
    H.v('toutes les conditions vraies : toute la liste, dans l\'ordre de la liste', C.capacitesServies(cfg, tout()), [...LISTE]);
    for (const j of LISTE) {
        H.v(`condition de « ${j} » fausse : le jeton tombe, les autres restent, l'ordre est gardé`, C.capacitesServies(cfg, { ...tout(), [j]: () => false }), LISTE.filter(x => x !== j));
        const sans = tout(); delete sans[j];
        H.v(`« ${j} » sans condition écrite : jamais annoncé`, C.capacitesServies(cfg, sans), LISTE.filter(x => x !== j));
        for (const [nom, val] of [['1', 1], ['"oui"', 'oui'], ['undefined', undefined], ['null', null], ['un objet', {}]])
            H.v(`condition de « ${j} » qui rend ${nom} (pas le booléen vrai) : le jeton tombe`, C.capacitesServies(cfg, { ...tout(), [j]: () => val }), LISTE.filter(x => x !== j));
        H.v(`condition de « ${j} » qui LÈVE : le jeton tombe, aucune exception ne sort`, (() => { try { return C.capacitesServies(cfg, { ...tout(), [j]: () => { throw new Error('boum'); } }); } catch (e) { return `exception ${e.message}`; } })(), LISTE.filter(x => x !== j));
        H.v(`condition de « ${j} » qui n'est pas une fonction : le jeton tombe`, C.capacitesServies(cfg, { ...tout(), [j]: true }), LISTE.filter(x => x !== j));
    }
    // un jeton hors liste n'entre jamais, même avec une condition vraie ; les noms hérités d'Object.prototype non plus
    const piege = { ...tout(), 'inconnu': () => true, 'jeton-de-demain': () => true, constructor: () => true, toString: () => true, hasOwnProperty: () => true, __proto__: { 'heritee': () => true } };
    H.v('un jeton hors liste (même à condition vraie, même hérité) ne sort jamais', C.capacitesServies(cfg, piege), [...LISTE]);
    H.v('aucune condition du tout : aucun jeton', C.capacitesServies(cfg, {}), []);
    const HORS_ARCHIVE = LISTE.filter(j => !DE_L_ARCHIVE.includes(j) && SANS_EMPREINTE(j));
    H.v('aucun lecteur d\'archive injecté : seuls les jetons du CODE seul sortent (jamais ceux qui dépendent d\'une donnée)', C.capacitesServies(cfg), HORS_ARCHIVE);
    H.v('   avec une archive complète en mémoire (sans index d\'empreintes) : toute la liste SAUF `empreinte`, dans l\'ordre', C.capacitesServies(cfg, undefined, () => COMPLETE), LISTE.filter(SANS_EMPREINTE));
    H.vrai('la sortie est un tableau NEUF à chaque appel (la modifier ne change pas le suivant)', (() => { const a = C.capacitesServies(cfg); a.push('x'); a.length = 0; return C.capacitesServies(cfg).length === HORS_ARCHIVE.length; })());
    H.vrai('   un tableau ordinaire, sérialisable', Array.isArray(C.capacitesServies(cfg)) && JSON.stringify(C.capacitesServies(cfg)) === JSON.stringify(HORS_ARCHIVE));
    H.v('une configuration absente : aucune exception, aucun jeton (même avec une archive complète)', (() => { try { return [C.capacitesServies(null, undefined, () => COMPLETE), C.capacitesServies(undefined)]; } catch (e) { return `exception ${e.message}`; } })(), [[], []]);

    // ── 2 bis. TOUR 1 (I-1, I-2, I-3) : `langue-impression` et `marques` suivent la donnée RÉELLEMENT en mémoire, jamais la base ──
    // Pour chaque jeton : archive absente ⇒ absent ; archive sans la colonne qui le fournit ⇒ absent ; archive complète ⇒ présent. Rouge sur 8d0de7eb, où les deux étaient annoncés en dur.
    const sert = lecteur => C.capacitesServies(cfg, undefined, lecteur);
    const dit = lecteur => ({ langue: sert(lecteur).includes('langue-impression'), marques: sert(lecteur).includes('marques') });
    H.v('archive ABSENTE (réveil à froid, clés de lecture fermées) : ni langue-impression ni marques', dit(() => null), { langue: false, marques: false });
    H.v('archive COMPLÈTE (entrées + colonne des jumeaux) : langue-impression ET marques', dit(() => COMPLETE), { langue: true, marques: true });
    H.v('langue-impression : archive SANS la colonne des jumeaux (d\'avant) ⇒ le jeton tombe, marques reste (la variante est dans l\'archive)', dit(() => SANS_COLONNE), { langue: false, marques: true });
    H.v('   le jeton n\'est pas un mensonge : la colonne absente rend tirageJumeaux null, la colonne présente rend le tirage', [SANS_COLONNE.colonneJumeaux, SANS_COLONNE.tirageJumeaux(9100001), COMPLETE.colonneJumeaux, COMPLETE.tirageJumeaux(9100001)], [false, null, true, 'jp']);
    const faux = o => Object.freeze({ colonneJumeaux: true, identifiants: () => [9100001], entree: id => ({ idProduct: id, variante: 'normale' }), ...o });
    H.v('marques : archive chargée mais VIDE (aucun produit) ⇒ le jeton tombe (rien ne porte la variante)', dit(() => faux({ identifiants: () => [], entree: () => null })), { langue: false, marques: false });
    H.v('marques : des entrées SANS la variante ⇒ le jeton tombe, langue-impression ne dépend pas de la variante', dit(() => faux({ entree: id => ({ idProduct: id }) })), { langue: true, marques: false });
    H.v('langue-impression : colonneJumeaux truthy mais pas `true` ⇒ le jeton tombe', dit(() => faux({ colonneJumeaux: 'oui' })).langue, false);
    for (const [nom, lecteur] of [['rend undefined', () => undefined], ['rend une chaîne', () => 'archive'], ['rend un nombre', () => 1], ['rend un tableau', () => []], ['LÈVE', () => { throw new Error('boum'); }]])
        H.v(`lecteur qui ${nom} : aucun des deux jetons, aucune exception ne sort, les autres restent`, (() => { try { return sert(lecteur); } catch (e) { return `exception ${e.message}`; } })(), HORS_ARCHIVE);
    H.v('lecteur qui n\'est pas une fonction : aucun des deux jetons', C.capacitesServies(cfg, undefined, COMPLETE), HORS_ARCHIVE);
    H.v('une méthode de la version qui LÈVE (identifiants) : aucun des deux jetons, aucune exception', (() => { try { return sert(() => faux({ identifiants: () => { throw new Error('boum'); } })); } catch (e) { return `exception ${e.message}`; } })(), HORS_ARCHIVE);
    H.vrai('le lecteur est interrogé À CHAQUE APPEL (jamais gardé : la bascule du chargeur se voit tout de suite)', (() => { let v = null; const l = () => v; const a = dit(l); v = COMPLETE; const b = dit(l); v = null; const c = dit(l); return !a.langue && b.langue && b.marques && !c.langue; })());
    H.vrai('une condition reçoit (cfg, lecteur) : la condition lit la version par le lecteur injecté, pas par un module', (() => { let vu = null; C.capacitesServies(cfg, { marques: (c, l) => { vu = [c === cfg, typeof l]; return true; } }, () => COMPLETE); return vu && vu[0] === true && vu[1] === 'function'; })());
    H.vrai('   les CONDITIONS du code sont gelées', Object.isFrozen(C.CONDITIONS));

    // ── 2 ter. aucun drapeau de v2/config.js ne conditionne un jeton : on balaie TOUTES les variables V2_* que la configuration lit ──
    // La liste est explicite (nom → une valeur d'essai valide) et CONFRONTÉE à la source : une variable nouvelle dans config.js (ou dans abonnements/config.js, que config.js appelle) fait échouer ce banc,
    // une variable retirée aussi. Une valeur d'essai que la configuration refuserait rend le ping VIDE (aucun jeton) : le cas est compté à part, il n'annonce rien.
    const BOOL = '1', ENT = '7';
    const ESSAIS = {
        V2_ORDRE_POCHES: 'jour', V2_PLAFOND_PANNES: ENT, V2_PLAFOND_QUESTIONS: ENT, V2_SANS_PRIX_JOUR: ENT, V2_JUMEAUX_REMBOURSES_JOUR: ENT,
        V2_DECLARES_SANS_COMPTE: ENT, V2_DECLARES_GRATUIT: ENT, V2_DECLARES_PRO: ENT, V2_CONSTATES_SANS_COMPTE: ENT, V2_CONSTATES_GRATUIT: ENT, V2_CONSTATES_PRO: ENT, V2_LOT_TROP_GRAND_JOUR: ENT,
        V2_SECRET_EMPREINTE: 'valeur-de-banc-seize', V2_TURNSTILE: 'off', V2_COOKIE_SECURE: '0', V2_BANC_LIEN_MOIS: '6', V2_BANC_GRACE_JOURS: '3',
        V2_EMPREINTE_EXTENSION: BOOL, V2_MODELE_EMPREINTE_ID: 'p-banc-1', V2_MODELE_EMPREINTE_SHA256: 'ab'.repeat(32), V2_EMPREINTES_R2_OBJET: 'objets/fictif', V2_MODELE_EMPREINTE_OCTETS: '1000',
        V2_MODELE_EMPREINTE_OBJET: 'objets/fictif-modele', V2_MODELE_EMPREINTE_URL: 'https://exemple.org/modele', V2_EMPREINTES_BANC_FICHIER: 'fichier-fictif.bin',
        V2_ESSAIS: ENT, V2_ACCUEIL: ENT, V2_HEBDO: ENT, V2_ABO_MENSUEL: ENT, V2_QUOTA_SANS_COMPTE: ENT, V2_QUOTA_GRATUIT: ENT, V2_QUOTA_PRO_PLAFOND: ENT,
        V2_DEPENSE_MODELE_JOUR_USD: '9.5', V2_COUT_APPEL_ESTIME_USD: '0.01', V2_LECTURE_LIVE_MAX: '3', V2_LOT_CARTES_MAX: '10', V2_LOT_REPRISES_PASSAGE: ENT, V2_LOT_REGLEMENT_REPRISE_MIN: '20',
        V2_CLAIM_ORPHELINE_MIN: '120', V2_REPARATION_AGE_MIN: '30', V2_INSTALLATION_REQUETES_HEURE: ENT, V2_ESSAIS_GLOBAUX_JOUR: ENT, V2_INSCRIPTION_IP_HEURE: ENT, V2_OUBLI_IP_HEURE: ENT,
        V2_REINIT_IP_HEURE: ENT, V2_VERIFICATION_IP_HEURE: ENT, V2_CONNEXION_IP_HEURE: ENT, V2_SUPPRESSION_COMPTE_HEURE: ENT, V2_RENVOI_COMPTE_HEURE: ENT, V2_MODELE_EMPREINTE_IP_HEURE: ENT,
        V2_COMPTE_HEURE: ENT, V2_SOLDE_HEURE: ENT, V2_REPONSE_HEURE: ENT, V2_RETOUR_LIVE_HEURE: ENT, V2_ETIQUETTE_HEURE: ENT, V2_VERSION_MODELE: 'banc-1',
        V2_URL_VERIFICATION: 'https://exemple.org/verification', V2_URL_REINIT: 'https://exemple.org/reinit', V2_EMPREINTE_JOURS: ENT, V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://abcdefghijklmnop',
        V2_VISUELS_HMAC: 'valeur-de-banc', V2_VISUELS_SOURCE: 'calcul', V2_VISUELS_BANC_FICHIER: 'fichier-fictif.rmv', V2_PHOTO_ADMIN_DELAI_S: '5', V2_PHOTO_ADMIN_INTERVALLE_S: '5', V2_PHOTO_ADMIN_MAX_JOUR: '5',
        V2_DESCRIPTION_CONSERVEE: BOOL, V2_DESCRIPTION_AU_MODELE: BOOL, V2_MARCHES: 'vinted.fr', V2_VERSION_MIN_EXTENSION: '2.5.0', V2_REGLE_G: BOOL, V2_SECONDE_LECTURE: BOOL, V2_LECTURE_TAMPON: BOOL, V2_SUR_PAR_IMAGE: BOOL, V2_VIVIER_IMAGE: BOOL, V2_SPI_COMPARATEUR: BOOL, V2_GARDE_MARQUEURS: BOOL, V2_JUMBO_TITRE: BOOL,
        V2_TE_VOISINS_UNE_FOIS: BOOL, V2_TE_EMPREINTE_TOT: BOOL, V2_TE_FIN_PARALLELE: BOOL, V2_TE_ORB_UTILE: BOOL, V2_MESURES_CLIENT: BOOL, V2_ORB_SERVEUR: BOOL,
        V2_CONFIRMATION_NOMBREUX: BOOL, V2_TAUX_BCE: BOOL, V2_RESOLUTION_CARDMARKET: BOOL, V2_PHOTOS_MULTIPLES: BOOL, V2_PHOTOS_MULTIPLES_TOUS: BOOL, V2_ABONNEMENTS: BOOL,
        // abonnements/config.js (lu par config.js) : des valeurs fictives, jamais une forme de clé
        V2_STRIPE_MODE: 'test', V2_STRIPE_CLE: 'valeur-fictive', V2_STRIPE_WEBHOOK_SECRET: 'valeur-fictive', V2_STRIPE_PRIX_PRO_MOIS: 'prix-fictif-1', V2_STRIPE_PRIX_PRO_AN: 'prix-fictif-2',
        V2_STRIPE_PRIX_FONDATEURS_MOIS: 'prix-fictif-3', V2_STRIPE_PRIX_FONDATEURS_AN: 'prix-fictif-4', V2_STRIPE_PORTAIL_CONFIG_PRO: 'portail-fictif-1', V2_STRIPE_PORTAIL_CONFIG_FONDATEURS: 'portail-fictif-2',
        V2_FONDATEURS_PLACES: '5', V2_FONDATEURS_CODE: 'code-fictif', V2_FONDATEURS_CODE_EMPREINTE: 'empreinte-fictive'
    };
    // (le motif exclut un préfixe cité en commentaire, « V2_VISUELS_R2_* » : ce n'est pas un nom de variable)
    const SOURCES = ['config.js', path.join('abonnements', 'config.js')];
    const luesDansLaSource = new Set(SOURCES.flatMap(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').match(/\bV2_[A-Z0-9]+(?:_[A-Z0-9]+)*(?![A-Z0-9_*])/g) || []));
    H.vrai(`le balayage lit la source (${luesDansLaSource.size} variables V2_* dans ${SOURCES.join(' et ')}) : un dénominateur non vide`, luesDansLaSource.size >= 80);
    H.v('la liste des essais couvre TOUTES les variables V2_* lues par la configuration (une variable nouvelle fait échouer ce banc : elle appelle un cas)', [...luesDansLaSource].filter(n => !(n in ESSAIS)).sort(), []);
    H.v('   et ne garde aucune variable que la configuration ne lit plus (la liste ne vieillit pas)', Object.keys(ESSAIS).filter(n => !luesDansLaSource.has(n)).sort(), []);
    const resultats = Object.entries(ESSAIS).map(([nom, val]) => { try { return [nom, C.capacitesServies(lireConfig({ ...ENV, [nom]: val }), undefined, () => COMPLETE, () => null).join(',')]; } catch (x) { return [nom, `invalide : ${x.message}`]; } });
    const invalides = resultats.filter(([, s]) => s.startsWith('invalide'));
    H.v(`aucune des ${resultats.length} variables V2_* ne change la liste servie (archive complète en mémoire, AUCUN index d'empreintes chargé : un drapeau seul n'annonce jamais \`empreinte\`)`, resultats.filter(([, s]) => !s.startsWith('invalide') && s !== LISTE.filter(SANS_EMPREINTE).join(',')).map(([n]) => n), []);
    console.log(`   (${resultats.length - invalides.length} essais valides ; ${invalides.length} valeurs d'essai refusées par la configuration — le ping y est vide, donc aucun jeton : ${invalides.map(([n]) => n).join(', ') || 'aucune'})`);
    H.vrai('   la plupart des essais sont des configurations VALIDES (le balayage ne se vide pas en essais refusés)', resultats.length - invalides.length >= resultats.length * 0.8);
}

// ── 2 quater. 25/10 : le jeton `empreinte` — présent SEULEMENT si le drapeau est allumé ET la configuration du modèle valide ET l'index d'empreintes CHARGÉ en mémoire (jamais le seul drapeau) ──
if (C) {
    const etatEmp = require('../identifier/etat-empreintes');
    const SHA = 'cd'.repeat(32);
    const BON = { V2_EMPREINTE_EXTENSION: '1', V2_MODELE_EMPREINTE_ID: 'p-banc-1', V2_MODELE_EMPREINTE_SHA256: SHA, V2_MODELE_EMPREINTE_OBJET: 'objets/fictif-modele' };
    const cfgDe = sur => lireConfig({ ...ENV, ...BON, ...sur });
    const CHARGE = Object.freeze({ index: Object.freeze({}), meta: Object.freeze({ n: 1 }) });
    const sert = (cfg, lecteur) => { try { return C.capacitesServies(cfg, undefined, () => COMPLETE, lecteur).includes('empreinte'); } catch (e) { return `exception ${e.message}`; } };
    const silence = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
    H.vrai('empreinte : la condition du code existe, et le jeton est l\'AVANT-DERNIER de la liste fermée (le dernier, `mesures-client`, en dépend)', typeof C.CONDITIONS.empreinte === 'function' && LISTE[LISTE.length - 2] === 'empreinte');
    H.v('empreinte : drapeau allumé + modèle valide + index CHARGÉ : le jeton est annoncé, en fin de liste, et seul', [sert(cfgDe({}), () => CHARGE), C.capacitesServies(cfgDe({}), undefined, () => COMPLETE, () => CHARGE).slice(-1)[0]], [true, 'empreinte']);
    H.v('   les cinq autres jetons ne changent pas (index chargé ou non)', C.capacitesServies(cfgDe({}), undefined, () => COMPLETE, () => CHARGE).slice(0, -1), C.capacitesServies(cfgDe({}), undefined, () => COMPLETE, () => null));
    // une condition après l'autre : chacune seule fait tomber le jeton
    H.v('empreinte : INDEX non chargé (lecteur rend null) : absent', sert(cfgDe({}), () => null), false);
    H.v('   index chargé mais drapeau ÉTEINT (0) : absent', sert(cfgDe({ V2_EMPREINTE_EXTENSION: '0' }), () => CHARGE), false);
    H.v('   drapeau non posé : absent', sert(lireConfig({ ...ENV, V2_MODELE_EMPREINTE_ID: 'p-banc-1', V2_MODELE_EMPREINTE_SHA256: SHA, V2_MODELE_EMPREINTE_OBJET: 'objets/fictif-modele' }), () => CHARGE), false);
    H.v('   identifiant du modèle absent : absent', sert(cfgDe({ V2_MODELE_EMPREINTE_ID: '' }), () => CHARGE), false);
    H.v('   sha256 du modèle absent : absent', sert(cfgDe({ V2_MODELE_EMPREINTE_SHA256: '' }), () => CHARGE), false);
    H.v('   objet du modèle absent : absent', sert(cfgDe({ V2_MODELE_EMPREINTE_OBJET: '' }), () => CHARGE), false);
    H.v('   sha256 mal formé (la configuration désactive les empreintes) : absent', silence(() => sert(cfgDe({ V2_MODELE_EMPREINTE_SHA256: 'xyz' }), () => CHARGE)), false);
    H.v('   identifiant mal formé (la configuration désactive les empreintes) : absent', silence(() => sert(cfgDe({ V2_MODELE_EMPREINTE_ID: 'a b' }), () => CHARGE)), false);
    // le lecteur d'index : tout ce qui n'est pas un index installé tombe
    for (const [nom, lecteur] of [['rend undefined', () => undefined], ['rend une chaîne', () => 'index'], ['rend true', () => true], ['rend un objet vide', () => ({})], ['rend un index sans meta', () => ({ index: {} })], ['rend une meta sans index', () => ({ meta: {} })], ['LÈVE', () => { throw new Error('boum'); }], ['n\'est pas une fonction', 'index'], ['est absent', undefined]])
        H.v(`   lecteur d'index qui ${nom} : absent, aucune exception`, sert(cfgDe({}), lecteur), false);
    H.vrai('   le lecteur est interrogé À CHAQUE APPEL (le chargement et son échec se voient tout de suite)', (() => { let v = null; const l = () => v; const a = sert(cfgDe({}), l); v = CHARGE; const b = sert(cfgDe({}), l); v = null; const c = sert(cfgDe({}), l); return a === false && b === true && c === false; })());
    H.vrai('   une condition reçoit (cfg, lecteur d\'archive, lecteur d\'index)', (() => { let vu = null; C.capacitesServies(cfgDe({}), { empreinte: (c, l, e) => { vu = [typeof l, typeof e]; return true; } }, () => COMPLETE, () => CHARGE); return vu && vu[0] === 'function' && vu[1] === 'function'; })());
    // de bout en bout : le VRAI pointeur de l'index (identifier/etat-empreintes.js), le vrai /ping
    v2.arreter(); etatEmp.vider(); E.installer(COMPLETE);
    silence(() => v2.monterEnTete(express(), { ...ENV, ...BON }));
    const jetons = () => v2.ping().capacites;
    H.v('/ping, drapeau allumé, modèle valide, index PAS chargé (démarrage, ou chargement en échec) : pas de jeton `empreinte`', jetons(), CONTRAT_EXTENSION);
    etatEmp.installer(CHARGE);
    H.v('   index chargé : `empreinte` en fin de liste, les cinq autres inchangés (et pas `mesures-client` : ses drapeaux ne sont pas posés)', jetons(), [...CONTRAT_EXTENSION, 'empreinte']);
    // CALCUL-CLIENT : `mesures-client` — le jeton `empreinte` ET V2_MESURES_CLIENT=1 ET V2_ORB_SERVEUR=0 ; chacune seule le fait tomber
    {
        const cc = sur => C.capacitesServies(lireConfig({ ...ENV, ...BON, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0', ...sur }), undefined, () => COMPLETE, () => CHARGE);
        H.v('mesures-client : les quatre conditions : la liste complète, `mesures-client` en DERNIER', cc({}), CONTRAT_LISTE);
        H.v('   chacune seule le fait tomber (V2_MESURES_CLIENT=0, V2_ORB_SERVEUR=1, drapeau d\'empreinte éteint), et `empreinte` suit ses propres conditions', [cc({ V2_MESURES_CLIENT: '0' }).includes('mesures-client'), cc({ V2_ORB_SERVEUR: '1' }).includes('mesures-client'), cc({ V2_EMPREINTE_EXTENSION: '0' }).includes('mesures-client'), cc({ V2_ORB_SERVEUR: '1' }).includes('empreinte')], [false, false, false, true]);
        H.v('   index NON chargé : ni `empreinte` ni `mesures-client`', C.capacitesServies(lireConfig({ ...ENV, ...BON, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0' }), undefined, () => COMPLETE, () => null).filter(j => j === 'empreinte' || j === 'mesures-client'), []);
    }
    H.v('   rien d\'autre ne change dans /ping : les deux mêmes clés, la même version minimale', [Object.keys(v2.ping()), v2.ping().versionMinExtension], [['versionMinExtension', 'capacites'], lireConfig({ ...ENV, ...BON }).versionMinExtension]);
    etatEmp.vider();
    H.v('   index vidé (rechargement refusé puis bascule perdue) : le jeton tombe à l\'appel suivant', jetons(), CONTRAT_EXTENSION);
    v2.arreter(); E.vider();
    silence(() => v2.monterEnTete(express(), ENV));
    etatEmp.installer(CHARGE);
    H.v('   drapeau ÉTEINT (défaut) et un index en mémoire : pas de jeton `empreinte`', v2.ping().capacites, CONTRAT_EXTENSION.filter(j => !DE_L_ARCHIVE.includes(j)));
    etatEmp.vider(); v2.arreter(); E.vider();
}

// ── 3. chaque jeton est MÉRITÉ : le code qui le rend vrai est appelé, son effet constaté ──
{
    const cfg = lireConfig(ENV);
    const { construireProduit } = require('../identifier/produit');
    const guide = { trend: 5, low: 4, avg7: 5.5, avg30: 5.2, guideDu: '2026-10-20' };
    const source = { idProduct: 9000001, nomCardmarket: 'Fictif', set: { slug: 'fictif', nom: 'Fictif', code: 'FI' }, numero: '1', total: '10', variante: 'tampon', marques: ['staff'], version: 'V2', prixGuide: guide,
        impressions: [{ idProduct: 9000001, numero: '1', langue: 'ja', variante: 'tampon', marques: ['staff'], version: 'V1', set: { nom: 'Fictif' }, prixGuide: guide }, { idProduct: 9000002, numero: '1', langue: 'xx', marques: [], set: { nom: 'Fictif' } }] };
    const p = construireProduit(source, { cfg, langueInterface: 'fr' });
    // langue-impression : `impressions[].langue` est servi (CONTRAT 7a), code fermé, null si inconnu — sans condition
    H.v('langue-impression : impressions[].langue est servi (ja) et jamais deviné (null pour un code hors liste)', p.impressions.map(i => i.langue), ['ja', null]);
    const { langueDeTirage } = require('../identifier/langue-decisive');
    H.v('langue-impression : la langue d\'un tirage vient de langueDeTirage (jp → ja, zh-hans, zh-hant, ko ; intl, id, th, idth → null)', ['jp', 'zh-hans', 'zh-hant', 'ko', 'intl', 'id', 'th', 'idth', null].map(langueDeTirage), ['ja', 'zh-hans', 'zh-hant', 'ko', null, null, null, null, null]);
    // marques : Produit.marques et Impression.marques
    H.v('marques : Produit.marques et Impression.marques sont servis (un ensemble canonique) ; [] prouvé sans tampon ; hors liste : null', [p.marques, p.impressions[0].marques, p.impressions[1].marques, construireProduit({ ...source, marques: ['inconnue'] }, { cfg }).marques], [['staff'], ['staff'], [], null]);
    // prix-incertains : prixGuide.{fiable, reserves, moyenne7, moyenne30, deBase}, version, set.badge, regleVerdict.ecartTendanceMax
    H.v('prix-incertains : prixGuide.{fiable, reserves, moyenne7, moyenne30, deBase} sont servis', ['fiable', 'reserves', 'moyenne7', 'moyenne30', 'deBase'].map(k => k in p.prixGuide), [true, true, true, true, true]);
    H.v('   les valeurs : moyennes lues, deBase = tous-etats, fiable booléen, réserves tableau', [p.prixGuide.moyenne7, p.prixGuide.moyenne30, p.prixGuide.deBase, typeof p.prixGuide.fiable, Array.isArray(p.prixGuide.reserves)], [5.5, 5.2, 'tous-etats', 'boolean', true]);
    H.v('prix-incertains : `version` est servie sur le Produit et sur l\'Impression', [p.version, p.impressions[0].version], ['V2', 'V1']);
    H.v('prix-incertains : `set.badge` est servi (le code d\'un set qui ne se confond avec aucune série)', [p.set.badge, p.set.badgeSource], ['FI', 'code']);
    const { REGLE } = require('../identifier/taux');
    H.v('prix-incertains : regleVerdict.ecartTendanceMax est servi (la constante de fiabilite-prix.js)', [REGLE.ecartTendanceMax, REGLE.ecartTendanceMax === require('../identifier/fiabilite-prix').ECART_TENDANCE_MAX], [0.3, true]);
    // prix-repli : carte.prixRepli est servi ET REPLI-QUOTA est en place
    const PR = require('../identifier/prix-repli');
    const carte = { statut: 'identifiee', prixLive: null, carte: { prixGuide: { tendance: 5, de: 4, moyenne30: 5.2, date: '2026-10-20' } } };
    const rendue = PR.analyseAvecRepli({ cartes: [carte] }).cartes[0];
    H.v('prix-repli : carte.prixRepli est servi (carte identifiée dont la langue n\'a pas été lue, fiche avec un prix)', [rendue.prixRepli && rendue.prixRepli.repli, rendue.prixRepli && rendue.prixRepli.cause], ['tendance', 'langue-non-lue']);
    const repli = PR.repliRetourLive({ lectureRatee: { cause: 'x', definitive: true }, prixGuide: carte.carte.prixGuide });
    H.v('prix-repli : REPLI-QUOTA est en place — un scan qui AFFICHE un repli compte (afficheUnPrix), un scan sans prix ne compte pas', [PR.afficheUnPrix({ repli }), PR.afficheUnPrix({ repli: null }), PR.afficheUnPrix({ prixRendu: true }), PR.afficheUnPrix({ repli: 1 })], [true, false, true, false]);
    const { RAISONS_NON_REMBOURSE } = require('../../sources');
    H.vrai('   la raison « prix-repli » est dans la liste fermée de non-remboursement (sources.js)', RAISONS_NON_REMBOURSE.includes('prix-repli'));
    const texteRetour = fs.readFileSync(path.join(__dirname, '..', 'identifier', 'retour-live.js'), 'utf8');
    H.vrai('   la route /api/retour-live applique la règle : afficheUnPrix → raisonNonRembourse « prix-repli »', /afficheUnPrix\(\{ repli: repliDecide \}\)[^\n]*raisonNonRembourse: 'prix-repli'/.test(texteRetour));
    // achete-avant-jour : facturation.poche est servi, l'achat est débité AVANT le quota du jour
    const P = require('../argent/poches'), PS = require('../argent/poche-servie');
    H.v('achete-avant-jour : l\'ordre de débit d\'un compte et d\'une installation est achete PUIS jour (fixé dans le code)', [P.ordreDe({ type: 'compte' }, cfg), P.ordreDe({ type: 'installation' }, cfg)], [['achete', 'jour'], ['achete', 'jour']]);
    H.v('   facturation.poche est servi : posé sur la facturation d\'un débit, jamais pour un administrateur', [PS.avecPoche({ debite: 1, motif: 'analyse' }, 'achete').poche, PS.avecPoche({ debite: 1, motif: 'analyse' }, 'jour').poche, PS.avecPoche({ motif: 'administrateur' }, 'jour').poche], ['achete', 'jour', undefined]);
    // ce que /ping ne doit pas annoncer : `facturation.poche` n'est pas un drapeau de configuration, il n'y a donc aucune variable à lire
    H.vrai('   V2_ORDRE_POCHES ne peut pas retirer « achete » : la configuration qui le tenterait est invalide', (() => { try { lireConfig({ ...ENV, V2_ORDRE_POCHES: 'achete,jour' }); return false; } catch (e) { return /achete/.test(e.message); } })());
}

// ── 4. /ping : même condition que versionMinExtension, une fonction pure de la configuration ──
{
    v2.arreter(); E.vider();
    H.v('v2 non configurée (jamais montée) : /ping n\'ajoute RIEN — ni versionMinExtension ni capacites', v2.ping(), {});
    E.installer(COMPLETE);
    H.v('v2 non configurée, même avec une archive en mémoire : toujours rien', v2.ping(), {});
    v2.monterEnTete(express(), ENV);
    // TOUR 1 : de bout en bout par la VRAIE version en mémoire (chargeur/etat.js, ce que lit identifier/visuels.js) — pas par un lecteur de banc
    E.vider();
    H.v('v2 configurée, AUCUNE archive en mémoire (réveil à froid) : seuls les jetons du code seul — ni langue-impression ni marques', v2.ping().capacites, LISTE.filter(j => !DE_L_ARCHIVE.includes(j) && SANS_EMPREINTE(j)));
    E.installer(SANS_COLONNE);
    H.v('   archive SANS la colonne des jumeaux : marques oui, langue-impression non', v2.ping().capacites, LISTE.filter(j => j !== 'langue-impression' && SANS_EMPREINTE(j)));
    E.installer(COMPLETE);
    const r = v2.ping();
    H.v('v2 configurée : les deux clés, et elles seules', Object.keys(r), ['versionMinExtension', 'capacites']);
    H.vrai('   versionMinExtension est celle de la configuration', r.versionMinExtension === lireConfig(ENV).versionMinExtension);
    const caps = Array.isArray(r.capacites) ? r.capacites : [];
    H.v('   capacites : un tableau, de la liste fermée, sans doublon, dans l\'ordre de la liste', [Array.isArray(r.capacites), caps.length > 0 && caps.every(j => LISTE.includes(j)), new Set(caps).size === caps.length, JSON.stringify(caps) === JSON.stringify(LISTE.filter(j => caps.includes(j)))], [true, true, true, true]);
    H.v('   archive COMPLÈTE en mémoire, drapeau des empreintes éteint : les cinq jetons — dont prix-repli, parce que ce code contient REPLI-QUOTA — et pas `empreinte`', r.capacites, CONTRAT_EXTENSION);
    E.vider();
    H.v('   la bascule se voit à l\'appel suivant (archive retirée : les deux jetons tombent)', v2.ping().capacites, LISTE.filter(j => !DE_L_ARCHIVE.includes(j) && SANS_EMPREINTE(j)));
    E.installer(COMPLETE);
    H.vrai('   un appel donne un objet neuf (modifier la réponse ne touche pas la suivante)', (() => { const a = v2.ping(); if (Array.isArray(a.capacites)) a.capacites.length = 0; a.versionMinExtension = 'x'; const b = v2.ping(); return Array.isArray(b.capacites) && b.capacites.length === CONTRAT_EXTENSION.length && b.versionMinExtension === r.versionMinExtension; })());
    H.vrai('   /ping reste SYNCHRONE (pas de promesse : aucune lecture en base, aucune attente)', !(v2.ping() instanceof Promise) && typeof v2.ping().then === 'undefined');
    H.vrai('   la réponse est du JSON simple (aucune fonction, aucune date, aucun cycle)', JSON.stringify(v2.ping()) === JSON.stringify(JSON.parse(JSON.stringify(v2.ping()))));
    // la v2 configurée avec une version minimale posée : capacites ne dépend pas d'elle
    v2.arreter();
    H.v('après arreter() : de nouveau rien', v2.ping(), {});
    v2.monterEnTete(express(), { ...ENV, V2_ACCUEIL: 'beaucoup' });
    H.v('configuration INVALIDE : /ping n\'ajoute rien non plus (même condition que versionMinExtension)', v2.ping(), {});
    v2.arreter(); E.vider();
    // pas de base : le module des capacités ne lit rien
    if (C) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'capacites.js'), 'utf8').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
        H.vrai('capacites.js ne charge aucun module (aucune base, aucun fichier, aucun réseau : une fonction pure)', !/\brequire\s*\(/.test(src) && !/\bimport\b/.test(src));
    }
}

// ── 5. TOUR 1 : sans archive, le serveur ne sert PAS ce que les deux jetons annoncent (le jeton dit vrai en tombant) ──
(async () => {
    const cfg = lireConfig(ENV);
    const V = require('../identifier/visuels');
    E.vider();
    H.v('sans archive en mémoire : les impressions servies sont VIDES (donc aucune `langue` à annoncer)', await V.creerVisuels({ cfg }).impressions(990101), []);
    H.v('   Produit.marques vaut null sans entrée d\'archive (marquesProuvees(undefined))', require('../identifier/marques-tampon').marquesProuvees(undefined), null);
    H.v('   avec l\'archive complète : l\'entrée porte la variante et le tirage porte la langue (ja)', [COMPLETE.entree(9100001).variante, require('../identifier/langue-decisive').langueDeTirage(COMPLETE.tirageJumeaux(9100001))], ['normale', 'ja']);
    E.vider();
    H.bilan();
})().catch(e => { console.error('❌', e); E.vider(); process.exit(1); });

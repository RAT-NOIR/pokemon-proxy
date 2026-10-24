'use strict';
// CAPACITES-PING (2026-10-24) — `GET /ping` annonce `capacites`, une liste FERMÉE de jetons, chacun vrai seulement si le serveur SERT la partie du contrat qu'il nomme.
// Le banc juge quatre choses : (1) la liste fermée et la garde (un jeton entre s'il est dans la liste ET si sa condition est vraie, rien d'autre) ; (2) que chaque jeton constant est
// MÉRITÉ — le code qui le rend vrai est appelé ici, sur des entrées fictives, et son effet est constaté (un jeton annoncé dont le code disparaîtrait fait échouer ce banc) ;
// (3) `ping()` : même condition que `versionMinExtension` (v2 configurée), jamais d'exception, jamais de lecture en base ; (4) la v2 non configurée ou invalide ne dit rien.
// Aucune base, aucun réseau. Une fonction pure de la configuration : le temps de réponse de /ping ne change pas.
const fs = require('fs'), path = require('path');
const express = require('express');
const H = require('./_harnais');
const v2 = require('../index');
const { lireConfig } = require('../config');

const ENV = { RM_API_V2: '1', MONGODB_BASE: 'test_scratch' };
// Le contrat de l'EXTENSION (DEMANDE-SERVEUR-EXTENSION.md, « EXTENSION — 24/10 (soir) ») : cinq jetons, dans cet ordre. Le dire ici une fois, à la main, est voulu : changer la liste est une décision
// qui se prend des deux côtés, pas un effet de bord. Tous les AUTRES contrôles lisent la liste exportée par v2/capacites.js.
const CONTRAT_EXTENSION = ['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour'];

let C = null;
try { C = require('../capacites'); } catch (e) { console.log(`   (v2/capacites.js absent ou illisible : ${e.code || e.message})`); }
H.vrai('v2/capacites.js existe et exporte CAPACITES et capacitesServies', C !== null && Array.isArray(C.CAPACITES) && typeof C.capacitesServies === 'function');
const LISTE = C && Array.isArray(C.CAPACITES) ? C.CAPACITES : [];

// ── 1. la liste fermée : un seul endroit, figée, sans doublon, celle de l'extension ──
H.v('la liste fermée est celle du contrat de l\'extension, dans cet ordre', [...LISTE], CONTRAT_EXTENSION);
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
    H.v('les conditions absentes (undefined) : celles du code, donc la liste servie par ce code', C.capacitesServies(cfg), [...LISTE]);
    H.vrai('la sortie est un tableau NEUF à chaque appel (la modifier ne change pas le suivant)', (() => { const a = C.capacitesServies(cfg); a.push('x'); a.length = 0; return C.capacitesServies(cfg).length === LISTE.length; })());
    H.vrai('   un tableau ordinaire, sérialisable', Array.isArray(C.capacitesServies(cfg)) && JSON.stringify(C.capacitesServies(cfg)) === JSON.stringify(LISTE));
    H.v('une configuration absente : aucune exception, aucun jeton', (() => { try { return [C.capacitesServies(null), C.capacitesServies(undefined)]; } catch (e) { return `exception ${e.message}`; } })(), [[], []]);
    // le code de ce serveur : AUCUN des cinq jetons ne dépend d'un drapeau de v2/config.js. Les cas « le drapeau tombe, le jeton tombe » n'ont donc pas d'objet ici — et le disent :
    // la configuration est changée de toutes les façons que le code connaît, la liste servie ne bouge pas. Si un jour un drapeau conditionne un jeton, ce contrôle échoue et appelle un cas par drapeau.
    const variantes = [{}, { V2_REGLE_G: '1' }, { V2_EMPREINTE_EXTENSION: '1' }, { V2_SECONDE_LECTURE: '1' }, { V2_LECTURE_TAMPON: '1' }, { V2_TAUX_BCE: '1' }, { V2_RESOLUTION_CARDMARKET: '1' }, { V2_PHOTOS_MULTIPLES: '1' },
        { V2_ABONNEMENTS: '1' }, { V2_VISUELS_SOURCE: 'calcul' }, { V2_ORDRE_POCHES: 'jour' }, { V2_QUOTA_SANS_COMPTE: '7' }, { V2_VERSION_MIN_EXTENSION: '2.5.0' }, { V2_DESCRIPTION_CONSERVEE: '1', V2_DESCRIPTION_AU_MODELE: '1' }];
    H.v(`aucun drapeau de configuration ne conditionne un jeton (${variantes.length} réglages essayés, la liste servie ne bouge pas)`,
        variantes.map(e => { try { return C.capacitesServies(lireConfig({ ...ENV, ...e })).join(','); } catch (x) { return `invalide : ${x.message}`; } }).filter(s => s !== LISTE.join(',')), []);
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
    v2.arreter();
    H.v('v2 non configurée (jamais montée) : /ping n\'ajoute RIEN — ni versionMinExtension ni capacites', v2.ping(), {});
    v2.monterEnTete(express(), ENV);
    const r = v2.ping();
    H.v('v2 configurée : les deux clés, et elles seules', Object.keys(r), ['versionMinExtension', 'capacites']);
    H.vrai('   versionMinExtension est celle de la configuration', r.versionMinExtension === lireConfig(ENV).versionMinExtension);
    const caps = Array.isArray(r.capacites) ? r.capacites : [];
    H.v('   capacites : un tableau, de la liste fermée, sans doublon, dans l\'ordre de la liste', [Array.isArray(r.capacites), caps.length > 0 && caps.every(j => LISTE.includes(j)), new Set(caps).size === caps.length, JSON.stringify(caps) === JSON.stringify(LISTE.filter(j => caps.includes(j)))], [true, true, true, true]);
    H.v('   sur ce code : les cinq jetons — dont prix-repli, parce que ce code contient REPLI-QUOTA', r.capacites, CONTRAT_EXTENSION);
    H.vrai('   un appel donne un objet neuf (modifier la réponse ne touche pas la suivante)', (() => { const a = v2.ping(); if (Array.isArray(a.capacites)) a.capacites.length = 0; a.versionMinExtension = 'x'; const b = v2.ping(); return Array.isArray(b.capacites) && b.capacites.length === CONTRAT_EXTENSION.length && b.versionMinExtension === r.versionMinExtension; })());
    H.vrai('   /ping reste SYNCHRONE (pas de promesse : aucune lecture en base, aucune attente)', !(v2.ping() instanceof Promise) && typeof v2.ping().then === 'undefined');
    H.vrai('   la réponse est du JSON simple (aucune fonction, aucune date, aucun cycle)', JSON.stringify(v2.ping()) === JSON.stringify(JSON.parse(JSON.stringify(v2.ping()))));
    // la v2 configurée avec une version minimale posée : capacites ne dépend pas d'elle
    v2.arreter();
    H.v('après arreter() : de nouveau rien', v2.ping(), {});
    v2.monterEnTete(express(), { ...ENV, V2_ACCUEIL: 'beaucoup' });
    H.v('configuration INVALIDE : /ping n\'ajoute rien non plus (même condition que versionMinExtension)', v2.ping(), {});
    v2.arreter();
    // pas de base : le module des capacités ne lit rien
    if (C) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'capacites.js'), 'utf8').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
        H.vrai('capacites.js ne charge aucun module (aucune base, aucun fichier, aucun réseau : une fonction pure)', !/\brequire\s*\(/.test(src) && !/\bimport\b/.test(src));
    }
}
H.bilan();

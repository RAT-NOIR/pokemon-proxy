'use strict';
const H = require('./_harnais'); const { lireConfig } = require('../config'); const P = require('../argent/poches');
const cfg = lireConfig({});
H.v('installation non liée : essai puis les crédits hérités', P.ordreDe({ type: 'installation' }, cfg), ['essai', 'achete']);
H.v('compte : l\'ordre de la configuration SANS l\'essai', P.ordreDe({ type: 'compte' }, cfg), ['accueil', 'hebdo', 'abonnement', 'achete']);
// MOYENS-B1 (O2) : l'ancienne assertion figeait `achete,accueil` (sous-ensemble sans `abonnement`), désormais une configuration invalide (test-config.js). L'ordre configurable se prouve avec un ordre complet.
H.v('ordre configurable', P.ordreDe({ type: 'compte' }, lireConfig({ V2_ORDRE_POCHES: 'achete,abonnement,accueil' })), ['achete', 'abonnement', 'accueil']);
H.v('moisCle UTC (31 déc. 23 h 30 UTC)', P.moisCle(new Date('2026-12-31T23:30:00Z')), '2026-12');
H.v('moisCle au 1er à 00 h 00 UTC', P.moisCle(new Date('2027-01-01T00:00:00Z')), '2027-01');
H.v('prochain lundi depuis un jeudi', P.prochainLundi(new Date('2026-10-08T10:00:00Z')), '2026-10-12');
H.v('prochain lundi depuis un lundi = le lundi SUIVANT', P.prochainLundi(new Date('2026-10-12T10:00:00Z')), '2026-10-19');
H.v('prochain lundi depuis un dimanche', P.prochainLundi(new Date('2026-10-11T23:59:00Z')), '2026-10-12');
// garde : un type de porteur inconnu n'hérite d'AUCUNE poche (écrit par ce qu'il autorise)
H.v('porteur de type inconnu : aucune poche', P.ordreDe({ type: 'autre' }, cfg), []);
H.bilan();

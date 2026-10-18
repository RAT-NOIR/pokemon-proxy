'use strict';
const H = require('./_harnais'); const { lireConfig } = require('../config'); const P = require('../argent/poches');
const cfg = lireConfig({});
// OFFRE-QUOTA (2026-10-13) : la poche configurable est `jour`, pour un compte comme pour une installation ; l'offre du porteur (relue en base) fixe la limite, pas le type de porteur.
// ACHETE-AVANT-JOUR (2026-10-17) : `achete` précède `jour`, ordre FIXÉ dans le code (la configuration ne peut pas la nommer).
H.v('installation non liée : achete puis jour (les autres anciennes ne sont plus débitées)', P.ordreDe({ type: 'installation' }, cfg), ['achete', 'jour']);
H.v('compte : achete puis jour', P.ordreDe({ type: 'compte' }, cfg), ['achete', 'jour']);
H.v('ordre configurable : seul « jour » est nommable (test-config.js refuse le reste) ; achete précède toujours', P.ordreDe({ type: 'compte' }, lireConfig({ V2_ORDRE_POCHES: 'jour' })), ['achete', 'jour']);
H.v('moisCle UTC (31 déc. 23 h 30 UTC)', P.moisCle(new Date('2026-12-31T23:30:00Z')), '2026-12');
H.v('moisCle au 1er à 00 h 00 UTC', P.moisCle(new Date('2027-01-01T00:00:00Z')), '2027-01');
H.v('prochain lundi depuis un jeudi', P.prochainLundi(new Date('2026-10-08T10:00:00Z')), '2026-10-12');
H.v('prochain lundi depuis un lundi = le lundi SUIVANT', P.prochainLundi(new Date('2026-10-12T10:00:00Z')), '2026-10-19');
H.v('prochain lundi depuis un dimanche', P.prochainLundi(new Date('2026-10-11T23:59:00Z')), '2026-10-12');
// garde : un type de porteur inconnu n'hérite d'AUCUNE poche (écrit par ce qu'il autorise)
H.v('porteur de type inconnu : aucune poche', P.ordreDe({ type: 'autre' }, cfg), []);
H.bilan();

'use strict';
const H = require('./_harnais'); const { lireConfig } = require('../config'); const P = require('../argent/poches');
const cfg = lireConfig({});
// OFFRE-QUOTA (2026-10-13) : une seule poche débitable, `jour`, pour un compte comme pour une installation ; l'offre du porteur (relue en base) fixe la limite, pas le type de porteur.
H.v('installation non liée : la poche « jour » seule (les anciennes essai/achete ne sont plus débitées)', P.ordreDe({ type: 'installation' }, cfg), ['jour']);
H.v('compte : la poche « jour » seule', P.ordreDe({ type: 'compte' }, cfg), ['jour']);
H.v('ordre configurable : seul « jour » est nommable (test-config.js refuse le reste)', P.ordreDe({ type: 'compte' }, lireConfig({ V2_ORDRE_POCHES: 'jour' })), ['jour']);
H.v('moisCle UTC (31 déc. 23 h 30 UTC)', P.moisCle(new Date('2026-12-31T23:30:00Z')), '2026-12');
H.v('moisCle au 1er à 00 h 00 UTC', P.moisCle(new Date('2027-01-01T00:00:00Z')), '2027-01');
H.v('prochain lundi depuis un jeudi', P.prochainLundi(new Date('2026-10-08T10:00:00Z')), '2026-10-12');
H.v('prochain lundi depuis un lundi = le lundi SUIVANT', P.prochainLundi(new Date('2026-10-12T10:00:00Z')), '2026-10-19');
H.v('prochain lundi depuis un dimanche', P.prochainLundi(new Date('2026-10-11T23:59:00Z')), '2026-10-12');
// garde : un type de porteur inconnu n'hérite d'AUCUNE poche (écrit par ce qu'il autorise)
H.v('porteur de type inconnu : aucune poche', P.ordreDe({ type: 'autre' }, cfg), []);
H.bilan();

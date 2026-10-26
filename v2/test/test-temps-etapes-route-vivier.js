'use strict';
// LOT TEMPS-ETAPES, fusionné avec VIVIER-IMAGE : la batterie de test-temps-etapes-route.js (14 scénarios × éteint / chaque drapeau / tous) rejouée avec V2_VIVIER_IMAGE=1, c'est-à-dire avec le vivier élargi de SUR-PAR-IMAGE
// (qui lit le top 10 des voisins : la mémoire des voisins doit le servir à l'identique). Même fichier, seule la configuration change.
process.env.TE_VIVIER = '1';
require('./test-temps-etapes-route');

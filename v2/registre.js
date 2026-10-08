'use strict';
const impl = new Map();
// argent: { solde(porteur), historique(porteur, suite), fusionnerALaLiaison(o), reprendreHeritage(o), debiter, rembourser, reserverQuestion, repondreQuestion }
// courrier: { envoyerVerification(email, lien), envoyerReinitialisation(email, lien) }   turnstile: { verifier(jeton, ip) → boolean }
// annonce: { preparerAnnonce(o), conserverAnnonce(scanId, annonce) }   banc: { apresVerdict(o) }   visuels: { resoudre(idProduct, langue) }   taux: { versEUR(devise) }
const NOMS = ['argent', 'courrier', 'turnstile', 'annonce', 'banc', 'visuels', 'taux'];
function fournir(nom, o) { if (!NOMS.includes(nom)) throw new Error(`registre : nom inconnu "${nom}"`); impl.set(nom, o); }
function obtenir(nom) { const o = impl.get(nom); if (!o) throw new Error(`registre : "${nom}" non fourni`); return o; }
function vider() { impl.clear(); }
module.exports = { fournir, obtenir, vider, NOMS };

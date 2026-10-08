'use strict';
// Clés de configuration du lot B2 (tour de correction 1) : rien de ce qui règle un compte ne vit hors de config.js.
const H = require('./_harnais'); const { lireConfig } = require('../config'); const M = require('../modeles');
const erreur = env => { try { lireConfig(env); return null; } catch (e) { return e.message; } };
const SECRET = 'un-secret-serveur-de-test-assez-long';
const c = lireConfig({ MONGODB_BASE: 'test_scratch' });
H.v('limites par défaut', [c.limites.inscriptionIpHeure, c.limites.oubliIpHeure, c.limites.reinitIpHeure, c.limites.verificationIpHeure, c.limites.connexionIpHeure, c.limites.suppressionParCompteHeure, c.limites.renvoiParCompteHeure], [10, 10, 10, 30, 30, 10, 3]);
H.v('durées par défaut', [c.comptes.glissementHeures, c.retention.octroiJours, c.empreinte.jours], [24, 730, 365]);   // empreinte des adresses supprimées : 12 mois (décision 5 du testeur, 2026-10-08) ; octroiJours (rétention des octrois) reste 730
H.v('URL par défaut', [c.urls.verification, c.urls.reinit], ['https://rat-market.fr/fr/verification', 'https://rat-market.fr/fr/reinitialisation']);
const o = lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSCRIPTION_IP_HEURE: '3', V2_CONNEXION_IP_HEURE: '7', V2_EMPREINTE_JOURS: '30', V2_URL_VERIFICATION: 'https://exemple.fr/v' });
H.v('surcharges d\'environnement', [o.limites.inscriptionIpHeure, o.limites.connexionIpHeure, o.empreinte.jours, o.urls.verification], [3, 7, 30, 'https://exemple.fr/v']);
H.vrai('entier invalide : configuration invalide', /configuration invalide/.test(erreur({ V2_OUBLI_IP_HEURE: 'abc' }) || ''));
H.vrai('URL non https : configuration invalide', /configuration invalide/.test(erreur({ V2_URL_REINIT: 'http://exemple.fr' }) || ''));
// secret d'empreinte
H.vrai('allumée, base de production, sans V2_SECRET_EMPREINTE : invalide (fail-closed)', /V2_SECRET_EMPREINTE/.test(erreur({ RM_API_V2: '1', MONGODB_BASE: 'test' }) || ''));
H.vrai('allumée, base non nommée, sans secret : invalide', /V2_SECRET_EMPREINTE/.test(erreur({ RM_API_V2: '1' }) || ''));
H.vrai('allumée, secret trop court : invalide', /V2_SECRET_EMPREINTE/.test(erreur({ RM_API_V2: '1', MONGODB_BASE: 'test', V2_SECRET_EMPREINTE: 'court' }) || ''));
H.v('allumée avec un secret : valide', erreur({ RM_API_V2: '1', MONGODB_BASE: 'test', V2_SECRET_EMPREINTE: SECRET }), null);
H.v('allumée sur test_scratch sans secret : valide (secret de bac, jamais en production)', erreur({ RM_API_V2: '1', MONGODB_BASE: 'test_scratch' }), null);
H.vrai('éteinte sans secret : valide (production inchangée)', erreur({}) === null);
// Turnstile off
H.vrai('allumée + V2_TURNSTILE=off hors test_scratch : invalide', /V2_TURNSTILE/.test(erreur({ RM_API_V2: '1', MONGODB_BASE: 'test', V2_SECRET_EMPREINTE: SECRET, V2_TURNSTILE: 'off' }) || ''));
H.v('allumée + off sur test_scratch : valide', erreur({ RM_API_V2: '1', MONGODB_BASE: 'test_scratch', V2_TURNSTILE: 'off' }), null);
// index
const idx = M.INDEX.filter(i => i.c === 'adresses_octroyees');
H.v('adresses_octroyees : index unique sur l\'empreinte + TTL', idx.map(i => [i.nom, i.opts.unique === true, i.opts.expireAfterSeconds === 0]).sort(), [['adresses_octroyees_ttl', false, true], ['adresses_empreinte', true, false]].sort());
H.bilan();

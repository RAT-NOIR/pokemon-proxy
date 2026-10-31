'use strict';
// BREVO — le MONTAGE du courrier (comptes/monter.js) : sans clé, la mémoire ; avec la clé, le pilote Brevo sous plafond ; une construction impossible laisse le courrier NON fourni (503), jamais un repli
// sur la mémoire ; la passe d'avertissement des inactifs n'est armée que par V2_AVERTISSEMENTS_INACTIFS=1 (différé 10 min, puis toutes les 24 h, minuteurs non retenus). Aucune base, aucune requête.
const express = require('express');
const H = require('./_harnais'); const registre = require('../registre'); const { lireConfig } = require('../config');
const monter = require('../comptes/monter'); const purge = require('../comptes/purge'); const inactifs = require('../comptes/inactifs');
const CLE = 'xkeysib-CLE-DE-MONTAGE-987654321';
const fabrique = () => { const poses = []; return { poses, setTimeout: (f, ms) => { poses.push(['differe', ms]); return { unref() { } }; }, setInterval: (f, ms) => { poses.push(['intervalle', ms]); return { unref() { } }; }, clearTimeout() { }, clearInterval() { } }; };
const monte = (cfg, mn) => { registre.vider(); registre.fournir('turnstile', { verifier: async () => true }); monter.routes(express.Router(), cfg, { minuteurs: mn }); };
const arret = () => { purge.arreterPurge(); inactifs.arreterAvertissements(); };
(async () => {
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const cfgAllume = lireConfig({ MONGODB_BASE: 'test_scratch', V2_AVERTISSEMENTS_INACTIFS: '1' });
    const traces = []; const orig = { warn: console.warn, error: console.error };
    const bancAvant = process.env.BANC_ISOLE, cleAvant = process.env.BREVO_API_KEY;
    try {
        delete process.env.BREVO_API_KEY;
        let mn = fabrique(); monte(cfg, mn);
        H.v('sans clé : le pilote MÉMOIRE (reel: false)', [registre.obtenir('courrier').reel, typeof registre.obtenir('courrier').envoyes], [false, 'object']);
        H.v('   la passe d\'avertissement n\'est PAS armée (seule la purge pose ses deux minuteurs)', mn.poses, [['differe', 60000], ['intervalle', 3600000]]); arret();

        process.env.BREVO_API_KEY = CLE;
        console.warn = console.error = (...a) => traces.push(a.join(' '));
        mn = fabrique(); monte(cfg, mn); arret();
        let manque = null; try { registre.obtenir('courrier'); } catch (e) { manque = e.message; }
        H.v('avec la clé sur un banc isolé : le pilote Brevo est REFUSÉ, le courrier reste non fourni (503), jamais la mémoire', [/non fourni/.test(manque || ''), traces.some(t => t.includes('BrevoBancInterdit')), traces.join('\n').includes(CLE)], [true, true, false]);

        delete process.env.BANC_ISOLE;                       // hors banc : la construction n'ouvre aucune connexion, on peut donc la regarder
        mn = fabrique(); monte(cfg, mn); arret();
        const p = registre.obtenir('courrier');
        H.v('avec la clé, hors banc : le pilote Brevo (reel: true) avec les trois envois', [p.reel, typeof p.envoyerVerification, typeof p.envoyerReinitialisation, typeof p.envoyerAvertissement], [true, 'function', 'function', 'function']);
        mn = fabrique(); monte(cfgAllume, mn); arret();
        H.v('V2_AVERTISSEMENTS_INACTIFS=1 : la passe est armée (différé 10 min, puis toutes les 24 h) après la purge', mn.poses, [['differe', 60000], ['intervalle', 3600000], ['differe', 600000], ['intervalle', 86400000]]);
        // l'expéditeur est de la configuration (décision de l'éditeur du 31/10)
        H.v('config : expéditeur no-reply@rat-market.fr, Reply-To de contact par défaut', [cfg.courriels.de, cfg.courriels.repondreA], ['no-reply@rat-market.fr', 'ratmarket.contact@gmail.com']);
        const cfgDe = lireConfig({ MONGODB_BASE: 'test_scratch', V2_COURRIEL_DE: 'x@rat-market.fr', V2_COURRIEL_REPONSE: 'y@rat-market.fr' });
        H.v('config : V2_COURRIEL_DE et V2_COURRIEL_REPONSE se règlent', [cfgDe.courriels.de, cfgDe.courriels.repondreA], ['x@rat-market.fr', 'y@rat-market.fr']);
        let ce = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_COURRIEL_DE: 'pas une adresse' }); } catch (x) { ce = x.message; }
        H.vrai('config : une adresse d\'expéditeur illisible est refusée au démarrage', /V2_COURRIEL_DE/.test(ce || ''));
        // un courrier déjà fourni (un banc) n'est jamais remplacé
        registre.vider(); registre.fournir('turnstile', { verifier: async () => true }); const mien = { reel: false, mien: true }; registre.fournir('courrier', mien);
        monter.routes(express.Router(), cfg, { minuteurs: fabrique() }); arret();
        H.v('un courrier déjà fourni n\'est pas remplacé', registre.obtenir('courrier') === mien, true);
    } finally {
        Object.assign(console, orig); arret(); registre.vider();
        if (bancAvant === undefined) delete process.env.BANC_ISOLE; else process.env.BANC_ISOLE = bancAvant;
        if (cleAvant === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = cleAvant;
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

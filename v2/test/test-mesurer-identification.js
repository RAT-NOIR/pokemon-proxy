'use strict';
// Banc de l'outil de mesure MESURE-2A (v2/mesures/mesurer-identification.js). Il ne juge que deux gardes, les seules qui protègent quelque chose :
//   1. la garde RÉSEAU refuse tout hôte autre qu'openrouter.ai (http, https, fetch, et la connexion TCP elle-même) ;
//   2. le harnais REFUSE de démarrer si MONGODB_URI est présent (ou toute URI mongodb hors boucle locale).
// Pas de banc pour le reste : c'est un outil de mesure, pas un lot de production. Aucune requête réseau n'est faite ici (les hôtes refusés le sont AVANT la connexion).
const https = require('https');
const http = require('http');
const net = require('net');
const G = require('../mesures/garde-reseau');
const M = require('../mesures/mesurer-identification');

let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => { const bon = JSON.stringify(obtenu) === JSON.stringify(attendu); console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); bon ? ok++ : ko++; };
const leve = async (f) => { try { await f(); return null; } catch (e) { return String(e && e.code || e && e.message || e); } };

(async () => {
    // ── 1. la garde réseau : écrite par ce qu'elle AUTORISE
    v('1a. hoteAutorise : openrouter.ai seul', ['openrouter.ai', 'OpenRouter.AI', 'api.openrouter.ai', 'openrouter.ai.evil.example', 'evilopenrouter.ai', 'api.tcgdex.net', 'www.cardmarket.com', 'images1.vinted.net', ''].map(h => G.hoteAutorise(h)),
        [true, true, false, false, false, false, false, false, false]);
    const garde = G.installerGardeReseau();
    try {
        const refus = [];
        refus.push(await leve(() => https.request('https://api.tcgdex.net/v2/en/cards?name=x')));
        refus.push(await leve(() => https.get('https://www.cardmarket.com/')));
        refus.push(await leve(() => http.request('http://images1.vinted.net/x.jpg')));
        refus.push(await leve(() => fetch('https://api.tcgdex.net/v2/en/sets')));
        refus.push(await leve(() => fetch('https://images1.vinted.net/t/00/f800/x.webp')));
        refus.push(await leve(() => new Promise((res, rej) => { const s = net.connect({ host: 'example.invalid', port: 443 }); s.on('error', rej); s.on('connect', res); })));
        v('1b. tout autre hôte LÈVE avant la connexion (https.request, https.get, http.request, fetch ×2, net.connect)', refus.map(r => r && /GARDE-RESEAU/.test(r)), [true, true, true, true, true, true]);
        v('1c. les tentatives refusées sont COMPTÉES et nommées', garde.refus().map(r => r.hote), ['api.tcgdex.net', 'www.cardmarket.com', 'images1.vinted.net', 'api.tcgdex.net', 'images1.vinted.net', 'example.invalid']);
        // openrouter.ai passe la garde (la requête est ouverte puis détruite aussitôt : aucun octet n'est envoyé)
        let passe = null;
        try { const rq = https.request('https://openrouter.ai/api/v1/models', { method: 'GET', agent: false, lookup: (h, o, cb) => cb(new Error('pas de réseau dans ce banc')) }); rq.on('error', () => { }); rq.destroy(); passe = true; } catch (e) { passe = String(e.message); }
        v('1d. openrouter.ai n\'est PAS refusé par la garde', passe, true);
    } finally { garde.retirer(); }
    v('1e. la garde se retire : après retrait, https.request n\'est plus gardé', await (async () => { try { const rq = https.request('https://openrouter.ai/', { agent: false, lookup: (h, o, cb) => cb(new Error('x')) }); rq.on('error', () => { }); rq.destroy(); return true; } catch (e) { return String(e.message); } })(), true);

    // ── 1f. l'ÉLARGISSEMENT n'existe que par une liste fermée : api.tcgdex.net (lecture seule, source de la chaîne) peut être ajouté sur décision écrite ; jamais Cardmarket ni Vinted
    v('1f. hotesSupplementaires : seul api.tcgdex.net est admissible ; Cardmarket, Vinted, un hôte quelconque LÈVENT à l\'installation', ['www.cardmarket.com', 'images1.vinted.net', 'example.org', 'api.tcgdex.net'].map(h => { try { G.installerGardeReseau({ hotesSupplementaires: [h] }).retirer(); return 'admis'; } catch (e) { return 'refusé'; } }), ['refusé', 'refusé', 'refusé', 'admis']);
    {
        const g2 = G.installerGardeReseau({ hotesSupplementaires: ['api.tcgdex.net'] });
        try {
            // api.tcgdex.net passe la garde (la connexion est coupée avant tout octet), Cardmarket reste refusé
            let tcg = null; try { const rq = https.request('https://api.tcgdex.net/v2/en/sets', { agent: false, lookup: (h, o, cb) => cb(new Error('pas de réseau dans ce banc')) }); rq.on('error', () => { }); rq.destroy(); tcg = true; } catch (e) { tcg = String(e.message); }
            const cm = await leve(() => https.request('https://www.cardmarket.com/'));
            v('1g. avec la décision écrite : tcgdex passe la garde, Cardmarket reste refusé', [tcg, /GARDE-RESEAU/.test(cm || '')], [true, true]);
        } finally { g2.retirer(); }
    }

    // ── 2. le harnais refuse de démarrer si MONGODB_URI est présent
    const motif = env => { try { M.verifierEnvironnement(env); return null; } catch (e) { return String(e.message); } };
    v('2a. MONGODB_URI présent (même vide de sens) : REFUS', /MONGODB_URI/.test(motif({ MONGODB_URI: 'mongodb://127.0.0.1:1/x' }) || ''), true);
    v('2b. une URI mongodb de production sous un autre nom (MONGODB_LECTURE_URI, ou un nom quelconque) : REFUS', [motif({ MONGODB_LECTURE_URI: 'mongodb+srv://u:p@cluster.mongodb.net/test' }), motif({ AUTRE_NOM: 'mongodb://h.example.net/x' })].map(x => Boolean(x)), [true, true]);
    v('2c. un environnement propre passe', motif({ OPENROUTER_API_KEY: 'x', PATH: 'y' }), null);
    v('2d. le message ne contient jamais la valeur de la variable', /secret-xyz/.test(motif({ MONGODB_URI: 'mongodb://u:secret-xyz@h/x' }) || ''), false);

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌', e); process.exit(1); });

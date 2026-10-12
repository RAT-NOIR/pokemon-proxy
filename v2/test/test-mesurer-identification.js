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

    // ── 3. TOUR 1 — I1 : les faux affirmés se comptent et se listent sur TOUTES les photos traitées, vérité sans fiche comprise
    const bloc = async (nom, f) => { try { await f(); } catch (e) { v(`${nom} — exception`, String(e.message), 'aucune'); } };
    await bloc('3a/3b', async () => {
        const base = { banc: 'labo', fiche: true, appelsGemini: 1, coutUsd: 0.002, coutConnu: true, msTotal: 1000, tcgdexOuAutreRefus: [], candidats: [], chaine: null, interrompuBudget: false };
        const lignes = new Map([[1, [{ carteId: 10, slugSet: 'A', numeroFiche: '1' }]]]);
        const res = [
            { ...base, nom: 'P1', idProduct: 1, issue: 'affirmee', reponse: 1, niveau: 'exact' },
            { ...base, nom: 'SANS-FICHE', idProduct: 999, fiche: false, issue: 'affirmee', reponse: 1, niveau: 'faux' },
            { ...base, nom: 'P3', idProduct: 1, issue: 'introuvable', raison: 'hors-catalogue' }
        ];
        const t = M.calculerTotaux({ resultats: res, brut: 3, lignes });
        v('3a. I1 : une affirmée dont la vérité n\'a pas de fiche est COMPTÉE faux (sur 3 traitées) et LISTÉE avec sa marque', [t.fauxAffirmesProduit.n, t.fauxAffirmesProduit.liste.map(x => [x.photo, x.veriteSansFiche]), t.nTraitees, t.nRetenu], [1, [['SANS-FICHE', true]], 3, 2]);
        v('3b. I1 : le compte est imprimé aussi hors périmètre (affirmées hors périmètre = 1)', t.affirmeesHorsPerimetre, 1);
    });
    // ── Mi2 : « photo-illisible » à moins de 2 candidats ET ambigu = la branche adaptateur.js:92 ; toute autre sortie introuvable a sa propre classe
    await bloc('3c', async () => {
        const c = r => M.classeIntrouvable(r);
        v('3c. Mi2 : classes d\'un introuvable', [
            c({ raison: 'photo-illisible', chaine: { ambigu: true, nCandidats: 1 } }), c({ raison: 'photo-illisible', chaine: { ambigu: true, nCandidats: 0 } }),
            c({ raison: 'hors-catalogue', chaine: { ambigu: true, nCandidats: 1 } }), c({ raison: 'photo-illisible', chaine: { ambigu: false, nCandidats: 1 } }), c({ raison: 'photo-illisible', chaine: null })
        ], ['adaptateur-l92-1-candidat', 'adaptateur-l92-0-candidat', 'autre:hors-catalogue', 'autre:photo-illisible-sans-ambigu', 'autre:photo-illisible-sans-reponse-chaine']);
    });
    // ── Mi6 : un appel au coût inconnu ou en échec compte `coutMax` dans le plafond, jamais 0
    await bloc('3d/3e', async () => {
        let req = null, ok1 = null, ko1 = null;
        const faux = { interceptors: { request: { use: f => { req = f; } }, response: { use: (a, b) => { ok1 = a; ko1 = b; } } } };
        const carnet = M.creerCarnet({ axios: faux, cle: 'x', plafondUsd: 1.00, plafondAppels: 250, attendre: async () => { } });
        const cfg = () => ({ url: 'https://openrouter.ai/api/v1/chat/completions' });
        await ok1({ data: { id: 'g1', model: 'm', usage: { cost: 0.4 } }, status: 200, config: cfg() });             // un appel réussi à 0,40 $ : coutMax = 0,40
        await ko1(Object.assign(new Error('timeout'), { config: cfg() })).catch(() => { });                              // un appel en ÉCHEC (peut avoir été facturé) : compte coutMax, pas 0
        v('3d. Mi6 : le total compte l\'appel en échec à coutMax (0,40 + 0,40), pas 0', Number(carnet.total().toFixed(2)), 0.80);
        let leve = null; try { req(cfg()); } catch (e) { leve = e.code; }
        v('3e. Mi6 : le plafond de 1,00 $ (0,80 + marge 0,40) arrête le 3e appel', leve, 'ARRET-BUDGET');
    });
    // ── I2 : parité du juge avec la règle de banc-identification.js (l. 59-60) sur 5 couples RÉELS du run D (fixture : lignes cartes_produits de l'instantané du 2026-10-12)
    {
        const F = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures-mesure', 'couples-juge.json'), 'utf8'));
        const lignes = new Map(); for (const l of F.lignes) (lignes.get(l.idProduct) || lignes.set(l.idProduct, []).get(l.idProduct)).push(l);
        v(`4. I2 : juger() = règle porteImpression/porteCarte de banc-identification.js sur ${F.couples.length} couples réels du run D`, F.couples.map(c => M.juger(c.reponse, c.verite, lignes)), F.couples.map(c => c.attendu));
    }

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌', e); process.exit(1); });

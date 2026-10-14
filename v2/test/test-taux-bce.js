'use strict';
// Lot TAUX-BCE (B4) — le déclencheur quotidien des taux de la BCE. Faux fetch, horloge fixée, base EN MÉMOIRE (H.ouvrirBac). Aucune requête réseau réelle.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { v, vrai } = H;
const db = require('../db');
const M = require('../modeles');
const T = require('../identifier/taux');
const { lireConfig } = require('../config');

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'eurofxref-daily.xml'), 'utf8');
const le = iso => new Date(iso);
const J8_10H = le('2026-10-08T08:00:00Z');     // 10 h Paris (avant l'heure de lecture)
const J8_17H = le('2026-10-08T15:00:00Z');     // 17 h Paris
const H1 = 3600 * 1000;
const faux = (corps = XML, ok = true) => { const o = { n: 0, fetch: async () => { o.n++; return { ok, status: ok ? 200 : 503, text: async () => corps }; } }; return o; };
const casse = () => { const o = { n: 0, fetch: async () => { o.n++; throw new Error('BCE en panne'); } }; return o; };

(async () => {
    let reseauReel = 0;
    const fetchOrigine = globalThis.fetch;
    await H.ouvrirBac('test-taux-bce.js');
    await M.creerIndex();
    globalThis.fetch = async () => { reseauReel++; throw new Error('requête réseau réelle interdite dans ce banc'); };
    const vider = () => db.col('taux').deleteMany({});
    const journal = [];
    let D = null;
    const lancer = (f, instant, extra = {}) => { const h = { t: instant }; const d = D.demarrerTauxBCE({ fetch: f.fetch, maintenant: () => h.t, journal: m => journal.push(m), intervalleMs: 3600e3, ...extra }); return { d, h }; };

    // ── configuration : éteinte par défaut, 0/1 seulement
    v('V2_TAUX_BCE absent => éteint', lireConfig({}).tauxBce, false);
    v('V2_TAUX_BCE=1 => allumé', lireConfig({ V2_TAUX_BCE: '1' }).tauxBce, true);
    for (const mauvaise of ['true', 'oui', 'on', ' 1']) { let e = null; try { lireConfig({ V2_TAUX_BCE: mauvaise }); } catch (x) { e = x.message; } vrai(`V2_TAUX_BCE="${mauvaise}" rend la configuration invalide`, /configuration invalide/.test(e || '')); }

    D = require('../identifier/taux-declencheur');
    // ── éteint : aucune minuterie, aucune lecture
    {
        await vider();
        const f = faux();
        const si = global.setInterval; let minuteries = 0; global.setInterval = (...a) => { minuteries++; return si(...a); };
        const r = D.demarrerPourConfig({ tauxBce: false }, { fetch: f.fetch, maintenant: () => J8_17H });
        global.setInterval = si;
        v('V2_TAUX_BCE absent => rien de démarré', r, null);
        v('V2_TAUX_BCE absent => aucune minuterie', minuteries, 0);
        v('V2_TAUX_BCE absent => aucune lecture', f.n, 0);
    }

    // ── démarrage sans taux => une lecture, même avant 16 h (la « graine » du service de test)
    {
        await vider();
        const f = faux(); const { d } = lancer(f, J8_10H);
        await d.amorce;
        v('démarrage sans taux, 10 h Paris => UNE lecture', f.n, 1);
        v('les taux sont en base', await db.col('taux').countDocuments({ devise: { $ne: '__lu' } }), 4);
        vrai('le journal dit la date et le nombre de devises', journal.some(m => m.includes('2026-10-08') && m.includes('4')));
        vrai('le journal ne porte aucune URL', !journal.some(m => /https?:/.test(m)));
        await d.passe();
        v('la passe de 10 h ne relit pas (avant 16 h)', f.n, 1);
        d.arreter();
    }
    // ── annonce en GBP après la lecture
    {
        const x = await T.versEUR('GBP', { maintenant: J8_10H });
        v('après la lecture, GBP a un versEUR non nul', [x.versEUR, x.tauxDate], [1.176471, '2026-10-08']);
    }
    // ── démarrage avec le taux du jour => 0 lecture ; 2e démarrage du même jour => 0
    {
        await vider();
        const f = faux(); const a = lancer(f, J8_17H);
        await a.d.amorce; await a.d.passe();
        v('démarrage à 17 h sans taux => une seule lecture (la graine suffit au jour)', f.n, 1);
        a.d.arreter();
        const b = lancer(f, le('2026-10-08T17:00:00Z'));
        await b.d.amorce; await b.d.passe();
        v('2e démarrage du même jour => 0 lecture de plus', f.n, 1);
        b.d.arreter();
        const g = faux(); await vider();
        await db.col('taux').insertOne({ devise: 'GBP', date: '2026-10-08', rate: 0.85 });
        const c = lancer(g, J8_17H); await c.d.amorce; await c.d.passe();
        v('taux du jour déjà en base (semé) => 0 lecture', g.n, 0);
        c.d.arreter();
    }
    // ── taux vieux de plus de AGE_MAX_JOURS => lecture au démarrage ; récent => aucune
    {
        await vider();
        await db.col('taux').insertOne({ devise: 'GBP', date: '2026-10-02', rate: 0.85 });
        const f = faux(); const a = lancer(f, le('2026-10-08T08:00:00Z')); await a.d.amorce;
        v('plus récent taux de 6 jours => aucune lecture au démarrage', f.n, 0); a.d.arreter();
        const g = faux(); const b = lancer(g, le(`2026-10-${String(2 + T.AGE_MAX_JOURS + 1).padStart(2, '0')}T08:00:00Z`)); await b.d.amorce;
        v(`plus récent taux de ${T.AGE_MAX_JOURS + 1} jours => une lecture au démarrage`, g.n, 1); b.d.arreter();
    }
    // ── le lendemain après l'heure => une lecture
    {
        await vider();
        const f = faux(); const { d, h } = lancer(f, J8_17H); await d.amorce;
        h.t = le('2026-10-09T08:00:00Z'); await d.passe();
        v('le lendemain avant 16 h => pas de lecture', f.n, 1);
        h.t = le('2026-10-09T14:00:00Z'); await d.passe();
        v('le lendemain à 16 h Paris => une lecture', f.n, 2);
        h.t = le('2026-10-09T20:00:00Z'); await d.passe();
        v('même jour, plus tard => toujours 2', f.n, 2);
        d.arreter();
    }
    // ── un échec => un seul réessai, puis arrêt jusqu'au jour suivant
    {
        await vider();
        const f = casse(); const { d, h } = lancer(f, J8_17H); await d.amorce;
        v('échec au démarrage => 1 tentative', f.n, 1);
        h.t = new Date(J8_17H.getTime() + 10 * 60000); await d.passe();
        v('10 min plus tard => pas de nouvel essai (réessai espacé)', f.n, 1);
        h.t = new Date(J8_17H.getTime() + H1 + 1000); await d.passe();
        v('1 h plus tard => UN réessai', f.n, 2);
        for (const k of [2, 3, 4, 5]) { h.t = new Date(J8_17H.getTime() + k * H1 + 5000); await d.passe(); }
        v('ensuite => arrêt jusqu\'au jour suivant (toujours 2)', f.n, 2);
        vrai('l\'échec est au journal', journal.some(m => /échoué|impossible/.test(m)));
        h.t = le('2026-10-09T15:00:00Z'); await d.passe();
        v('le jour suivant => nouvelle tentative', f.n, 3);
        d.arreter();
    }
    // ── la minuterie ne retient pas le processus et s'arrête
    {
        const f = faux();
        const { d } = lancer(f, J8_17H); await d.amorce;
        vrai('la minuterie est unref', typeof d.minuteur.hasRef === 'function' && d.minuteur.hasRef() === false);
        d.arreter();
        v('après arreter() la minuterie est nulle', d.minuteur, null);
    }
    // ── câblage : monter.js démarre le déclencheur seulement si cfg.tauxBce
    {
        await vider();
        const monter = require('../identifier/monter');
        const routeur = new Proxy({}, { get: () => () => { } });
        const cfgBase = lireConfig({});
        const f = faux();
        monter.routes(routeur, { ...cfgBase, tauxBce: false }, { tauxBce: { fetch: f.fetch, maintenant: () => J8_17H } });
        v('monter.routes avec tauxBce faux => aucune lecture', f.n, 0);
        monter.routes(routeur, { ...cfgBase, tauxBce: true }, { tauxBce: { fetch: f.fetch, maintenant: () => J8_17H } });
        await new Promise(r => setTimeout(r, 300));
        v('monter.routes avec tauxBce vrai => une lecture', f.n, 1);
        monter.arreterTaux();
        v('arreterTaux est exporté et ne lève pas', typeof monter.arreterTaux, 'function');
    }

    globalThis.fetch = fetchOrigine;
    v('aucune requête réseau réelle', reseauReel, 0);
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

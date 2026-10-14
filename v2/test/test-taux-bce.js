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
const faux = (corps = XML, ok = true) => { const o = { n: 0, corps, fetch: async () => { o.n++; return { ok, status: ok ? 200 : 503, text: async () => o.corps }; } }; return o; };
const XML_VEILLE = XML.replace(/2026-10-08/g, '2026-10-07');
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
        f.corps = XML.replace(/2026-10-08/g, '2026-10-09');
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
    // ── C1 : le déclencheur est monté AVANT la connexion de la base (index.js) — rien ne part, rien ne se compte ; à la connexion, la graine part tout de suite
    {
        await vider(); journal.length = 0;
        const f = faux(); let prete = false, cb = null;
        const { d, h } = lancer(f, J8_17H, { pret: () => prete, quandPret: c => { cb = c; } });
        await d.amorce;
        v('base pas connectée à 17 h => 0 requête', f.n, 0);
        vrai('un abonnement à la connexion est posé', typeof cb === 'function');
        h.t = new Date(J8_17H.getTime() + 10 * 60000); await d.passe();
        v('un coup d\'œil de la minuterie base non prête => toujours 0 requête', f.n, 0);
        prete = true; cb(); await d.amorce;
        v('à la connexion (10 min plus tard, sans attendre 1 h) => la graine part : UNE requête', f.n, 1);
        v('le taux est en base', await db.col('taux').countDocuments({ devise: 'GBP', date: '2026-10-08' }), 1);
        d.arreter();
        // même scène à 10 h : la graine part à la connexion, sans attendre 16 h
        await vider();
        const g = faux(); let p2 = false, cb2 = null;
        const b = lancer(g, J8_10H, { pret: () => p2, quandPret: c => { cb2 = c; } });
        await b.d.amorce; p2 = true; cb2(); await b.d.amorce;
        v('démarrage à 10 h base pas prête puis connectée => une graine', g.n, 1);
        b.d.arreter();
    }
    // ── I1 : un fichier de la veille lu à 16 h 05 ne clôt pas le jour ; UN réessai à +1 h lit celui du jour
    {
        await vider(); journal.length = 0;
        const f = faux(XML_VEILLE); const t0 = le('2026-10-08T14:05:00Z');          // 16 h 05 Paris
        const { d, h } = lancer(f, t0); await d.amorce;
        v('16 h 05, la BCE sert encore le fichier de la veille => 1 lecture, jour non clos', f.n, 1);
        f.corps = XML;
        h.t = new Date(t0.getTime() + 20 * 60000); await d.passe();
        v('20 min plus tard => pas de relecture (pause)', f.n, 1);
        h.t = new Date(t0.getTime() + H1 + 1000); await d.passe();
        v('+1 h => UN réessai, il lit le fichier du jour', f.n, 2);
        v('le taux du jour (2026-10-08) est en base', await db.col('taux').countDocuments({ devise: 'GBP', date: '2026-10-08' }), 1);
        h.t = new Date(t0.getTime() + 3 * H1); await d.passe();
        v('ensuite plus aucune lecture ce jour-là', f.n, 2);
        d.arreter();
    }
    // ── M1 : un jour sans publication (fichier de la veille toute la journée) : 2 lectures au plus, journal véridique
    {
        await vider(); journal.length = 0;
        const f = faux(XML_VEILLE); const t0 = le('2026-10-08T15:00:00Z');
        const { d, h } = lancer(f, t0); await d.amorce;
        for (const k of [1, 2, 3, 4]) { h.t = new Date(t0.getTime() + k * H1 + 5000); await d.passe(); }
        v('fichier de la veille toute la journée => 2 lectures, pas plus', f.n, 2);
        vrai('le journal dit « fichier du 2026-10-07, pas encore celui du jour »', journal.some(m => m.includes('fichier du 2026-10-07') && m.includes('pas encore celui du jour')));
        vrai('le journal ne parle pas de requêtes échouées', !journal.some(m => /échou|ratée/.test(m)));
        d.arreter();
        // essai refusé par la marque en base (aucune requête) : message « aucune requête », pas d'alarme d'arrêt
        await vider(); journal.length = 0;
        await db.col('taux').insertOne({ devise: 'GBP', date: '2026-10-07', rate: 0.85 });
        await db.col('taux').insertOne({ devise: T.MARQUE, date: '2026-10-08', essais: 1, dernierEssaiLe: new Date('2026-10-08T14:00:00Z'), ok: true });
        const g = faux(); const b = lancer(g, J8_17H); await b.d.amorce;
        for (const k of [1, 2, 3]) { b.h.t = new Date(J8_17H.getTime() + k * H1 + 5000); await b.d.passe(); }
        v('marque ok en base => 0 requête', g.n, 0);
        vrai('le journal dit « aucune requête »', journal.some(m => m.includes('aucune requête')));
        vrai('et ne crie pas à l\'arrêt', !journal.some(m => m.includes('arrêt jusqu')));
        b.d.arreter();
    }
    // ── M3 : un fichier non plausible n'est jamais écrit
    {
        const compte = () => db.col('taux').countDocuments({ devise: { $ne: T.MARQUE } });
        await vider();
        const futur = faux(XML.replace(/2026-10-08/g, '2026-10-20')); const a = lancer(futur, J8_17H); await a.d.amorce;
        v('date future => rien d\'écrit', await compte(), 0); a.d.arreter();
        await vider();
        const nul = faux(XML.replace(/rate='[^']*'/g, "rate='0'")); const b = lancer(nul, J8_17H); await b.d.amorce;
        v('aucun taux valable (tous à 0) => rien d\'écrit', await compte(), 0); b.d.arreter();
        await vider();
        const nan = faux(XML.replace(/rate='[^']*'/g, "rate='abc'")); const c = lancer(nan, J8_17H); await c.d.amorce;
        v('taux non numériques => rien d\'écrit', await compte(), 0); c.d.arreter();
        await vider();
        await db.col('taux').insertOne({ devise: 'GBP', date: '2099-01-01', rate: 0.85 });
        const g = faux(); const e = lancer(g, J8_10H); await e.d.amorce;
        v('une date future en base ne masque pas la graine', g.n, 1); e.d.arreter();
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

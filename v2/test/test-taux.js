'use strict';
// Banc B1b.6 — taux du jour (BCE, fichier FABRIQUÉ) et regleVerdict. Aucune requête réseau réelle : fetch injecté, globalThis.fetch remplacé par un espion qui lève.
// Le stockage (collection `taux`) se teste sur la base EN MÉMOIRE (H.ouvrirBac -> ouvrirBancV2), jamais sur la production.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { v, vrai } = H;
const db = require('../db');
const M = require('../modeles');
const T = require('../identifier/taux');

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'eurofxref-daily.xml'), 'utf8');
const leve = async f => { try { await f(); return false; } catch { return true; } };
// Paris en octobre = UTC+2 (CEST) ; en décembre = UTC+1 (CET)
const le = iso => new Date(iso);
const J8_17H = le('2026-10-08T15:00:00Z');          // 17 h 00 Paris, jeudi 8 octobre
const J8_15H30 = le('2026-10-08T13:30:00Z');        // 15 h 30 Paris

function faussesReponses(corps = XML, ok = true) { let n = 0; return { appels: () => n, fetch: async () => { n++; return { ok, status: ok ? 200 : 503, text: async () => corps }; } }; }

(async () => {
    // espion : toute requête réseau RÉELLE lève (fetch injecté seulement)
    let reseauReel = 0;
    const fetchOrigine = globalThis.fetch;
    await H.ouvrirBac('test-taux.js');                 // avant l'espion : le banc peut avoir besoin de son propre fetch
    await M.creerIndex();
    globalThis.fetch = async () => { reseauReel++; throw new Error('requête réseau réelle interdite dans ce banc'); };
    const vider = () => db.col('taux').deleteMany({});

    // ── (6) lireTauxBCE pure : le fichier fabriqué, puis tous les préfixes tronqués
    {
        const r = T.lireTauxBCE(XML);
        v('lireTauxBCE : date du fichier', r.date, '2026-10-08');
        v('lireTauxBCE : 4 devises', Object.keys(r.taux).sort(), ['CHF', 'GBP', 'JPY', 'USD']);
        v('lireTauxBCE : USD = 1 EUR en dollars', r.taux.USD, 1.1);
        let leves = 0, fausses = 0;
        for (let i = 0; i <= XML.length; i++) {
            try { const x = T.lireTauxBCE(XML.slice(0, i)); if (x.date === null && Object.keys(x.taux).length) fausses++; } catch { leves++; }
        }
        v(`parseur : ${XML.length + 1} préfixes tronqués, aucune exception`, leves, 0);
        v('parseur : jamais de taux sans date', fausses, 0);
        v('XML tronqué au milieu d\'un Cube => aucun taux de la devise coupée', Object.keys(T.lireTauxBCE(XML.slice(0, XML.indexOf("<Cube currency='GBP'") + 20)).taux).sort(), ['JPY', 'USD']);
        for (const x of [undefined, null, 42, '', '<<<', {}]) v(`entrée ${JSON.stringify(x)} => rien, sans lever`, T.lireTauxBCE(x), { date: null, taux: {} });
    }

    // ── (5) taux <= 0 ou non fini : devise ignorée et journalisée
    {
        const mauvais = XML.replace("currency='USD' rate='1.1000'", "currency='USD' rate='0'").replace("currency='JPY' rate='160.00'", "currency='JPY' rate='-3'")
            .replace("currency='CHF' rate='0.9400'", "currency='CHF' rate='abc'")
            .replace("<Cube currency='GBP'", "<Cube currency='NOK' rate='Infinity'/><Cube currency='SEK' rate='1e999'/><Cube currency='GBP'");
        vrai('le XML mauvais a bien été fabriqué (garde du banc)', mauvais.includes("rate='Infinity'") && mauvais.includes("rate='abc'"));
        const j = [];
        const r = T.lireTauxBCE(mauvais, { journal: m => j.push(m) });
        v('taux ≤ 0 / illisible / infini : seule GBP reste', Object.keys(r.taux), ['GBP']);
        vrai('chaque devise ignorée est journalisée (USD, JPY, CHF, NOK, SEK)', ['USD', 'JPY', 'CHF', 'NOK', 'SEK'].every(d => j.some(m => m.includes(d))));
    }

    // ── (1) EUR : sans lire la base
    {
        const colPiege = { find() { throw new Error('la base ne doit pas être lue pour EUR'); }, findOne() { throw new Error('la base ne doit pas être lue pour EUR'); } };
        v('EUR => versEUR 1, tauxDate null, base non lue', await T.versEUR('EUR', { maintenant: J8_17H, col: colPiege }), { versEUR: 1, tauxDate: null });
        v('eur minuscule => idem', await T.versEUR('eur', { maintenant: J8_17H, col: colPiege }), { versEUR: 1, tauxDate: null });
    }

    // ── (7) rafraîchir : un seul fetch par jour, rien avant 16 h 00 Paris — puis (2) USD du jour
    {
        await vider();
        const f = faussesReponses();
        const av = await T.rafraichirTaux({ fetch: f.fetch, maintenant: J8_15H30 });
        v('avant 16 h 00 Paris => zéro fetch', [f.appels(), av.lu], [0, false]);
        v('15 h 59 min 59 s Paris => zéro fetch', (await T.rafraichirTaux({ fetch: f.fetch, maintenant: le('2026-10-08T13:59:59Z') }), f.appels()), 0);
        const r1 = await T.rafraichirTaux({ fetch: f.fetch, maintenant: J8_17H });
        v('16 h 00 Paris pile OU après => un fetch', [f.appels(), r1.lu], [1, true]);
        const r2 = await T.rafraichirTaux({ fetch: f.fetch, maintenant: le('2026-10-08T15:30:00Z') });
        v('deuxième appel le même jour => toujours UN fetch', [f.appels(), r2.lu], [1, false]);
        const r3 = await T.rafraichirTaux({ fetch: f.fetch, maintenant: le('2026-10-08T21:59:00Z') });
        v('encore le même jour (23 h 59 Paris) => toujours UN fetch', f.appels(), 1);
        const lendemain = await T.rafraichirTaux({ fetch: f.fetch, maintenant: le('2026-10-09T15:00:00Z') });
        v('le lendemain après 16 h => un second fetch', [f.appels(), lendemain.lu], [2, true]);
        // hiver : 16 h 00 Paris = 15 h 00 UTC
        const g = faussesReponses();
        await T.rafraichirTaux({ fetch: g.fetch, maintenant: le('2026-12-10T14:59:00Z') });
        v('hiver 15 h 59 Paris (14 h 59 UTC) => zéro fetch', g.appels(), 0);
        await T.rafraichirTaux({ fetch: g.fetch, maintenant: le('2026-12-10T15:00:00Z') });
        v('hiver 16 h 00 Paris (15 h 00 UTC) => un fetch', g.appels(), 1);

        // (2) USD du jour
        await vider();
        await T.rafraichirTaux({ fetch: faussesReponses().fetch, maintenant: J8_17H });
        v('USD avec un taux du jour => 1/1.1 arrondi à 6 décimales + date du fichier', await T.versEUR('USD', { maintenant: J8_17H }), { versEUR: 0.909091, tauxDate: '2026-10-08' });
        v('GBP : 1/0.85 à 6 décimales', (await T.versEUR('GBP', { maintenant: J8_17H })).versEUR, 1.176471);
        v('devise en minuscules acceptée', (await T.versEUR('usd', { maintenant: J8_17H })).versEUR, 0.909091);
    }

    // ── échecs réseau : jamais d'exception, le jour n'est pas consommé
    {
        await vider();
        let n = 0;
        const casse = async () => { n++; throw new Error('réseau coupé'); };
        const a = await T.rafraichirTaux({ fetch: casse, maintenant: J8_17H });
        v('fetch qui lève => pas d\'exception, lu:false', [a.lu, n], [false, 1]);
        const h = faussesReponses(XML, false);
        const b = await T.rafraichirTaux({ fetch: h.fetch, maintenant: J8_17H });
        v('réponse HTTP non ok => lu:false', b.lu, false);
        const c = faussesReponses('<html>pas du xml de taux</html>');
        const d = await T.rafraichirTaux({ fetch: c.fetch, maintenant: J8_17H });
        v('corps sans aucun taux => lu:false, rien de stocké', [d.lu, await db.col('taux').countDocuments({ devise: { $ne: '__lu' } })], [false, 0]);
        const f = faussesReponses();
        const e = await T.rafraichirTaux({ fetch: f.fetch, maintenant: J8_17H });
        v('après des échecs, le même jour peut encore lire (un échec n\'est pas une lecture)', [e.lu, f.appels()], [true, 1]);
    }

    // ── (3) week-end : le dernier taux publié, SA date ; (4) absent / inconnu / périmé
    {
        await vider();
        await db.col('taux').insertOne({ devise: 'USD', date: '2026-10-02', rate: 1.25 });     // vendredi 2 octobre
        v('dimanche 4 octobre => taux du vendredi, date du vendredi', await T.versEUR('USD', { maintenant: le('2026-10-04T10:00:00Z') }), { versEUR: 0.8, tauxDate: '2026-10-02' });
        await db.col('taux').insertOne({ devise: 'USD', date: '2026-10-01', rate: 2 });
        v('plusieurs dates : la plus récente gagne', (await T.versEUR('USD', { maintenant: le('2026-10-04T10:00:00Z') })).tauxDate, '2026-10-02');
        v('exactement 7 jours (2026-10-09 vs 2026-10-02) => encore servi', (await T.versEUR('USD', { maintenant: le('2026-10-09T10:00:00Z') })).versEUR, 0.8);
        v('8 jours => versEUR null (et tauxDate null)', await T.versEUR('USD', { maintenant: le('2026-10-10T10:00:00Z') }), { versEUR: null, tauxDate: null });
        v('devise inconnue => null', await T.versEUR('XXX', { maintenant: le('2026-10-04T10:00:00Z') }), { versEUR: null, tauxDate: null });
        await vider();
        v('taux absent (base vide) => null', await T.versEUR('USD', { maintenant: le('2026-10-04T10:00:00Z') }), { versEUR: null, tauxDate: null });
        for (const x of [undefined, null, '', 42, 'US$']) v(`devise ${JSON.stringify(x)} => null, sans lever`, await T.versEUR(x, { maintenant: J8_17H }), { versEUR: null, tauxDate: null });
        const casse = { findOne() { throw new Error('base en panne'); }, find() { throw new Error('base en panne'); } };
        v('base en panne => null (jamais une exception dans la réponse d\'analyse)', await T.versEUR('USD', { maintenant: J8_17H, col: casse, journal: () => { } }), { versEUR: null, tauxDate: null });
    }

    // ── (8) regleVerdict
    {
        await vider();
        await T.rafraichirTaux({ fetch: faussesReponses().fetch, maintenant: J8_17H });
        v('regleVerdict GBP', await T.regleVerdict('GBP', { maintenant: J8_17H }), { bonneAffaireSous: -30, cherAuDela: 15, versEUR: 1.176471, tauxDate: '2026-10-08' });
        v('regleVerdict EUR', await T.regleVerdict('EUR', { maintenant: J8_17H }), { bonneAffaireSous: -30, cherAuDela: 15, versEUR: 1, tauxDate: null });
        v('regleVerdict sans taux => versEUR null (l\'extension n\'affiche aucun verdict)', await T.regleVerdict('XXX', { maintenant: J8_17H }), { bonneAffaireSous: -30, cherAuDela: 15, versEUR: null, tauxDate: null });
    }

    globalThis.fetch = fetchOrigine;
    v('aucune requête réseau réelle partie pendant tout le banc (espion globalThis.fetch)', reseauReel, 0);
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

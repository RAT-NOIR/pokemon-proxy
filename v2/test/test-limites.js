'use strict';
const H = require('./_harnais'); const M = require('../modeles'); const L = require('../transport/limites');
(async () => {
    await H.ouvrirBac('test-limites.js'); await M.creerIndex();
    // Horloge RELATIVE : début de la prochaine heure pleine. Une date fixe passée ferait naître des documents déjà expirés
    // (expireLe = t0 + 2 h) que le moniteur TTL de Mongo peut supprimer en cours de test.
    const HEURE = 3600e3, debutFenetre = Math.floor(Date.now() / HEURE) * HEURE + HEURE;
    const t0 = new Date(debutFenetre);
    let r; for (let i = 1; i <= 3; i++) r = await L.consommer('a', { max: 2, fenetreMs: 3600e3, maintenant: t0 });
    H.v('3e appel sur max 2 : refusé', [r.permis, r.n, r.max], [false, 3, 2]);
    H.v('   reessayerDans = secondes restantes de la fenêtre', r.reessayerDans, 3600);
    const autre = await L.consommer('b', { max: 2, fenetreMs: 3600e3, maintenant: t0 });
    H.v('une autre clé a son propre compteur', autre.permis, true);
    const suiv = await L.consommer('a', { max: 2, fenetreMs: 3600e3, maintenant: new Date(debutFenetre + HEURE + 1000) });
    H.v('fenêtre suivante : repart à 1', [suiv.permis, suiv.n], [true, 1]);
    // concurrence : 50 appels simultanés sur max 20 => exactement 20 permis
    const rs = await Promise.all(Array.from({ length: 50 }, () => L.consommer('conc', { max: 20, fenetreMs: 3600e3, maintenant: t0 })));
    H.v('50 appels simultanés, max 20 : permis', rs.filter(x => x.permis).length, 20);
    // middleware
    const req = { ip: '203.0.113.9' }, res = { s: null, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; } };
    // B2b point 6 : l'horloge du limiteur est FACULTATIVE (option `horloge`) ; ce banc la fixe au MILIEU d'une minute proche de l'heure réelle (TTL : expireLe reste dans le futur),
    // de sorte qu'une frontière de minute ne puisse tomber entre les deux appels (avant : « passe » valait 2 une fois sur ~3 000 lancements).
    const MIN = 60e3, milieuMinute = Math.floor(Date.now() / MIN) * MIN + MIN / 2;
    const mw = L.limiteur({ nom: 'x', max: 1, fenetreMs: 60e3, cle: q => `x:${L.empreinteIp(q.ip)}`, horloge: () => new Date(milieuMinute) });
    let passe = 0; await mw(req, res, () => passe++); await mw(req, res, () => passe++);
    H.v('middleware : un passage, puis 429 DEBIT', [passe, res.s, res.j && res.j.erreur.code], [1, 429, 'DEBIT']);
    H.vrai('   Retry-After posé', Number(res.h['Retry-After']) > 0);
    H.vrai('   l\'IP n\'est jamais stockée en clair', !JSON.stringify(await require('../db').col('limites').find().toArray()).includes('203.0.113.9'));
    // l'horloge injectée est CELLE QUE LE LIMITEUR LIT : elle franchit une frontière de minute, le compteur repart ; elle ne bouge pas, il tient
    {
        let t = milieuMinute + 5e3; const resH = () => ({ s: null, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; } });
        const mwH = L.limiteur({ nom: 'horloge', max: 1, fenetreMs: MIN, cle: () => 'h', horloge: () => new Date(t) });
        const jouer = async () => { const r = resH(); let ok = 0; await mwH({ ip: '203.0.113.7' }, r, () => ok++); return { ok, s: r.s, ra: r.h['Retry-After'] }; };
        const a = await jouer(), b = await jouer();
        t += MIN;                                                    // la frontière de minute est franchie
        const c = await jouer(), d = await jouer();
        H.v('horloge injectée : 1 passage, refus, puis la minute suivante repart (1 passage, refus)', [a.ok, b.ok, b.s, c.ok, d.ok, d.s], [1, 0, 429, 1, 0, 429]);
        H.v('   Retry-After est calculé sur l\'horloge injectée (fin de la minute courante, 25 s plus loin)', Number(b.ra), 25);
        const mwF = L.limiteur({ nom: 'horloge-faux', max: 1, fenetreMs: MIN, cle: () => 'f', horloge: () => 'pas une date' });
        const rf = resH(); let okf = 0; await mwF({ ip: '203.0.113.7' }, rf, () => okf++);
        H.v('   une horloge qui ne rend pas une date : refus fermé (503), jamais un passage', [okf, rf.s], [0, 503]);
    }
    // l'horloge COMMUNE (fixerHorloge) : posée par un banc, rendue par la fonction qu'elle retourne ; réservée aux bancs isolés
    {
        const resH = () => ({ s: null, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; } });
        const sans = L.limiteur({ nom: 'commune', max: 1, fenetreMs: MIN, cle: () => 'c' });     // créé AVANT la pose : l'horloge se lit à chaque requête
        const restaurer = L.fixerHorloge(() => new Date(milieuMinute + 10e3));
        const r1 = resH(); await sans({ ip: '203.0.113.8' }, r1, () => { });
        const r2 = resH(); await sans({ ip: '203.0.113.8' }, r2, () => { });
        H.v('horloge commune : un limiteur sans option la lit (20 s restantes dans la minute fixée, loin des 60 s ou des quelques secondes de l\'horloge réelle)', [r2.s, Number(r2.h['Retry-After'])], [429, 20]);
        restaurer();
        const r3 = resH(); await L.limiteur({ nom: 'commune2', max: 5, fenetreMs: MIN, cle: () => 'c2' })({ ip: '203.0.113.8' }, r3, () => { });
        H.vrai('   rendue : le limiteur revient à l\'horloge réelle (ni refus ni erreur)', r3.s === null);
        // Tour 1 : fixerHorloge est écrite par ce qu'elle AUTORISE : BANC_ISOLE === '1' ET NODE_ENV !== 'production' ET BANC_HOTES non vide. Chaque refus a son test.
        const refus = (nom, poser) => { const sauve = { ...process.env }; let leve = false; try { poser(process.env); L.fixerHorloge(() => new Date()); } catch { leve = true; } finally { for (const k of ['BANC_ISOLE', 'NODE_ENV', 'BANC_HOTES']) { if (sauve[k] === undefined) delete process.env[k]; else process.env[k] = sauve[k]; } } H.v(`   fixerHorloge refuse : ${nom}`, leve, true); };
        H.vrai('   (témoin) dans l\'environnement du banc, BANC_ISOLE=1 et BANC_HOTES non vide, NODE_ENV différent de production : elle accepte', process.env.BANC_ISOLE === '1' && Boolean(process.env.BANC_HOTES) && process.env.NODE_ENV !== 'production');
        refus('BANC_ISOLE absent', e => { delete e.BANC_ISOLE; });
        refus('BANC_ISOLE autre que « 1 » (« 1 », « true », « 01 »)', e => { e.BANC_ISOLE = 'true'; });
        refus('NODE_ENV=production', e => { e.NODE_ENV = 'production'; });
        refus('BANC_HOTES absent', e => { delete e.BANC_HOTES; });
        refus('BANC_HOTES vide', e => { e.BANC_HOTES = ''; });
        refus('BANC_HOTES fait de blancs', e => { e.BANC_HOTES = '  ,  '; });
        let leve2 = false; try { L.fixerHorloge('maintenant'); } catch { leve2 = true; }
        H.v('   fixerHorloge refuse autre chose qu\'une fonction', leve2, true);
        // M-6 : défaire dans le désordre ne laisse aucune horloge fantôme
        const f1 = L.fixerHorloge(() => new Date(milieuMinute - 10 * 3600e3)), f2 = L.fixerHorloge(() => new Date(milieuMinute + 1e3));
        f1(); f2();
        const rg = resH(); await L.limiteur({ nom: 'fantome', max: 5, fenetreMs: MIN, cle: () => 'g' })({ ip: '203.0.113.9' }, rg, () => { });
        const dg = (await require('../db').col('limites').findOne({ cle: new RegExp(`^fantome:g\\|`) }));
        H.vrai('   deux horloges défaites dans le désordre : aucune horloge fantôme (le limiteur lit l\'heure réelle, pas la première fixée)', dg && Math.abs(Number(dg.cle.split('|')[1]) - Math.floor(Date.now() / MIN) * MIN) <= MIN);
    }
    // Tour 1 (M-3) : l'horloge par DÉFAUT est l'instant courant, à la milliseconde près (sans option ni fixerHorloge). Fenêtre d'1 ms : la clé du compteur porte l'instant lu.
    {
        const mwD = L.limiteur({ nom: 'defaut', max: 100, fenetreMs: 1, cle: () => 'd' }), resH = () => ({ s: null, setHeader() { }, status(x) { this.s = x; return this; }, json() { return this; } });
        const avant = Date.now(); await mwD({ ip: '203.0.113.10' }, resH(), () => { }); await new Promise(r => setTimeout(r, 40)); await mwD({ ip: '203.0.113.10' }, resH(), () => { }); const apres = Date.now();
        const ds = (await require('../db').col('limites').find({ cle: /^defaut:d\|/ }).toArray()).map(d => Number(d.cle.split('|')[1])).sort((a, b) => a - b);
        H.v('horloge par défaut : deux appels espacés de 40 ms lisent deux instants distincts, compris entre avant et après, à la milliseconde (ni arrondi à la minute, ni décalé)', [ds.length, ds.every(x => x >= avant && x <= apres), ds.length === 2 && ds[1] - ds[0] >= 35 && ds[1] - ds[0] <= 400], [2, true, true]);
        await require('../db').col('limites').deleteMany({ cle: /^defaut:d\|/ });     // nés « déjà expirés » (fenêtre d'1 ms) : retirés avant le contrôle du moniteur TTL
    }
    // les frontières UTC de la garde d'attente des bancs (harnais) : heure, jour, semaine (lundi 00:00, comme semaineISO), mois
    {
        const T = Date.UTC, f = (t, q) => new Date(H.prochaineFrontiere(t, q)).toISOString();
        const jeudi = T(2026, 9, 8, 10, 0, 0);          // jeudi 2026-10-08 10:00 UTC
        H.v('frontières depuis un jeudi 10 h : heure 11 h, jour minuit, semaine lundi 12/10, mois 1er/11', ['heure', 'jour', 'semaine', 'mois'].map(k => f(jeudi, { [k]: true })),
            ['2026-10-08T11:00:00.000Z', '2026-10-09T00:00:00.000Z', '2026-10-12T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
        H.v('   un dimanche 23 h 59 : la semaine bascule dans 1 minute ; un lundi 10 h : le lundi suivant', [f(T(2026, 9, 11, 23, 59, 0), { semaine: true }), f(T(2026, 9, 12, 10, 0, 0), { semaine: true })], ['2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z']);
        H.v('   le 31 décembre : le mois bascule au 1er janvier ; le minimum de plusieurs demandes ; rien demandé = jamais', [f(T(2026, 11, 31, 12, 0, 0), { mois: true }), f(jeudi, { heure: true, jour: true, mois: true }), H.prochaineFrontiere(jeudi, {})], ['2027-01-01T00:00:00.000Z', '2026-10-08T11:00:00.000Z', Infinity].map(x => x === Infinity ? null : x));
        H.v('   eviterFrontieres n\'attend pas loin d\'une frontière (≥ 90 s) : 0 ms', await H.eviterFrontieres({ jour: true, semaine: true, mois: true, heure: true }, 0), 0);
    }
    // fail-closed : une clé null (non identifiable) est REFUSÉE, pas laissée passer
    const res2 = { s: null, j: null, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; }, setHeader() {} };
    let p2 = 0; await L.limiteur({ nom: 'y', max: 5, fenetreMs: 60e3, cle: () => null })({ ip: '1.1.1.1' }, res2, () => p2++);
    H.v('clé non calculable => refus fermé (pas de passage)', [p2, res2.s], [0, 503]);
    const docs = await require('../db').col('limites').find().toArray();
    H.vrai(`aucun des ${docs.length} documents de limite n'est né déjà expiré (moniteur TTL)`, docs.length > 0 && docs.every(d => d.expireLe > new Date()));
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

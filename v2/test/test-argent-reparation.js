'use strict';
// MOYENS-B2a — `reparerDebitRembourseSansMouvement` : la fonction du grand livre qui répare un débit « rembourse » SANS mouvement de crédit (état laissé par l'ancien ordre du ledger, avant ce lot).
// Elle écrit le crédit manquant UNE fois, de façon idempotente, après la preuve par le grand livre qu'aucun mouvement n'existe ; elle ne touche jamais un débit réellement rendu.
// Le cas fabriqué a deux faces, que seul l'écart de poche sépare : A) le crédit n'a jamais été rendu (écart 0 : on rend le crédit ET on écrit la trace) ; B) le crédit a été rendu sans sa trace (écart +1 : on écrit la trace SEULE).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const R = require('../argent/reconcilier');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), tard = new Date('2026-10-08T14:00:00Z');
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
const instInit = async () => { const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } }); return p; };
// fabrique l'état hérité : un débit pris puis posé « rembourse » SANS aucun mouvement de remboursement ; `creditRendu` : le crédit a-t-il été rendu quand même (écart +1) ?
async function ancienEtat(p, scanId, { creditRendu = false } = {}) {
    await Lg.debiter(p, { scanId, cleIdempotence: `k-${scanId}`, maintenant: t }, cfg);
    await db.col('mouvements').updateOne({ scanId, type: 'debit' }, { $set: { etat: 'rembourse' } });
    if (creditRendu) await db.col('installations').updateOne({ _id: p.id }, { $inc: { essais: 1 } });
}
const mv = async scanId => db.col('mouvements').find({ scanId, type: 'remboursement' }).toArray();
(async () => {
    await H.ouvrirBac('test-argent-reparation.js'); await M.creerIndex();
    const reparer = (p, scanId, o = {}) => muet(() => Lg.reparerDebitRembourseSansMouvement(p, { scanId, maintenant: tard, ...o }, cfg));

    // A. le crédit n'a jamais été rendu (écart 0)
    {
        const p = await instInit(); await ancienEtat(p, 'ra');
        const av = await R.reconcilier(p, { cfg, maintenant: tard });
        H.v('A0. préalable : le cas fabriqué est listé « débit rembourse sans mouvement », écart 0, essais 2', [av.debitsRembourseSansMouvement.length, av.ecarts.length, (await lire(p)).essais, av.propre], [1, 0, 2, false]);
        const r = await reparer(p, 'ra'); const l = await mv('ra');
        H.v('A1. réparé : le crédit est rendu UNE fois (essais 3) et UN mouvement +1 est écrit (clé rp|…)', [r.repare, r.creditRendu, (await lire(p)).essais, l.map(m => [m.delta, m.poche, m.motif, /^rp\|/.test(m.cleIdempotence)])], [true, true, 3, [[1, 'essai', 'reparation', true]]]);
        const ap = await R.reconcilier(p, { cfg, maintenant: tard });
        H.v('A2. la réconciliation est propre (écart 0, plus rien de listé)', [ap.ecarts.length, ap.debitsRembourseSansMouvement.length, ap.propre], [0, 0, true]);
        const r2 = await reparer(p, 'ra');
        H.v('A3. un second appel ne fait RIEN : rien à réparer, essais 3, un seul mouvement', [r2.repare, r2.raison, (await lire(p)).essais, (await mv('ra')).length], [false, 'rien-a-reparer', 3, 1]);
    }
    // B. le crédit a été rendu sans sa trace (écart +1) : la trace seule
    {
        const p = await instInit(); await ancienEtat(p, 'rb', { creditRendu: true });
        const r = await reparer(p, 'rb'); const l = await mv('rb');
        H.v('B1. écart +1 : la TRACE seule est écrite, aucun crédit de plus (essais 3)', [r.repare, r.creditRendu, (await lire(p)).essais, l.length], [true, false, 3, 1]);
        const ap = await R.reconcilier(p, { cfg, maintenant: tard });
        H.v('B2. réconciliation propre ; second appel sans effet', [ap.propre, (await reparer(p, 'rb')).repare, (await lire(p)).essais, (await mv('rb')).length], [true, false, 3, 1]);
    }
    // C. un débit réellement rendu n'est pas touché
    {
        const p = await instInit(); await Lg.debiter(p, { scanId: 'rc', cleIdempotence: 'k-rc', maintenant: t }, cfg); await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'rc', maintenant: t }, cfg));
        const av = (await mv('rc')).length, r = await reparer(p, 'rc');
        H.v('C. un débit réellement rendu : rien à réparer, essais 3, mouvements inchangés', [r.repare, r.raison, (await lire(p)).essais, (await mv('rc')).length], [false, 'rien-a-reparer', 3, av]);
    }
    // D. deux appels SIMULTANÉS : un seul crédit
    {
        const p = await instInit(); await ancienEtat(p, 'rd');
        const rs = await Promise.all([reparer(p, 'rd'), reparer(p, 'rd'), reparer(p, 'rd')]);
        H.v('D. trois appels simultanés : UN seul réparé, essais 3 (jamais 4 ni 5), un seul mouvement', [rs.filter(r => r.repare).length, (await lire(p)).essais, (await mv('rd')).length], [1, 3, 1]);
    }
    // E. un écart inattendu (ni 0 ni +1) : refus, rien d'écrit
    {
        const p = await instInit(); await ancienEtat(p, 're'); await db.col('installations').updateOne({ _id: p.id }, { $inc: { essais: 2 } });
        const r = await reparer(p, 're');
        H.v('E. écart +2 : refusé (ecart-inattendu), aucun crédit, aucun mouvement', [r.repare, r.raison, (await lire(p)).essais, (await mv('re')).length], [false, 'ecart-inattendu', 4, 0]);
    }
    // F. deux scans ambigus pour le même porteur : l'écart ne s'attribue pas à un scan, refus
    {
        const p = await instInit(); await ancienEtat(p, 'rf1'); await ancienEtat(p, 'rf2');
        const r = await reparer(p, 'rf1');
        H.v('F. deux débits « rembourse » sans mouvement chez le même porteur : refusé (plusieurs-ambigus), rien d\'écrit', [r.repare, r.raison, (await mv('rf1')).length + (await mv('rf2')).length], [false, 'plusieurs-ambigus', 0]);
    }
    // G. une réparation interrompue (marque posée, aucun mouvement) : refus, jamais de second crédit
    {
        const p = await instInit(); await ancienEtat(p, 'rg');
        const d = await db.col('mouvements').findOne({ scanId: 'rg', type: 'debit' }); await db.col('mouvements').updateOne({ _id: d._id }, { $set: { reparation: { le: t, ecart: 0 } } });
        const r = await reparer(p, 'rg');
        H.v('G. marque de réparation sans mouvement : refusé (reparation-interrompue), essais 2, aucun mouvement', [r.repare, r.raison, (await lire(p)).essais, (await mv('rg')).length], [false, 'reparation-interrompue', 2, 0]);
    }
    // H. poche non vérifiable (installation sans dotation connue) : refus
    {
        const p = await inst({ essais: 3 }); await ancienEtat(p, 'rh');
        const r = await reparer(p, 'rh');
        H.v('H. installation sans essaisInitiaux : refusé (poche-non-verifiable), rien d\'écrit', [r.repare, r.raison, (await lire(p)).essais, (await mv('rh')).length], [false, 'poche-non-verifiable', 2, 0]);
    }
    // I. un compte (poche accueil), avec son octroi
    {
        const p = await compte({ solde: { accueil: 25, achete: 0 } });
        await db.col('mouvements').insertOne({ compteId: p.id, le: t, surface: 'scanner', type: 'octroi', delta: 25, poche: 'accueil', motif: 'octroi', scanId: null, etat: 'debite', cleIdempotence: `octroi|${p.id}`, expireLe: new Date('2028-01-01') });
        await Lg.debiter(p, { scanId: 'ri', cleIdempotence: 'k-ri', maintenant: t }, cfg); await db.col('mouvements').updateOne({ scanId: 'ri', type: 'debit' }, { $set: { etat: 'rembourse' } });
        const r = await reparer(p, 'ri');
        H.v('I. compte (accueil) : réparé, solde.accueil 25, un mouvement +1 sur le compte, réconciliation propre', [r.repare, (await lire(p)).solde.accueil, (await mv('ri')).map(m => String(m.compteId) === String(p.id)), (await R.reconcilier(p, { cfg, maintenant: tard })).propre], [true, 25, [true], true]);
    }
    // K. une ligne « rendu-en-cours » de la même poche (son crédit a pu être rendu) : l'écart ne se lit plus, refus
    {
        const p = await instInit(); await ancienEtat(p, 'rk'); await Lg.debiter(p, { scanId: 'rk2', cleIdempotence: 'k-rk2', maintenant: t }, cfg);
        await db.col('mouvements').updateOne({ scanId: 'rk2', type: 'debit' }, { $set: { etat: 'rendu-en-cours' } });
        const r = await reparer(p, 'rk');
        H.v('K. une ligne « rendu-en-cours » de la même poche : refusé (non-resolus-meme-poche), rien d\'écrit', [r.repare, r.raison, (await mv('rk')).length], [false, 'non-resolus-meme-poche', 0]);
    }
    // J. entrées invalides
    {
        const p = await instInit();
        H.v('J. scanId absent : refusé (scan-absent)', (await reparer(p, undefined)).raison, 'scan-absent');
        H.v('   scan sans débit : rien à réparer', (await reparer(p, 'inconnu')).raison, 'rien-a-reparer');
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

'use strict';
// RÉPARER UN DÉBIT PRIS SANS TRACE — le geste de l'opérateur (MOYENS-B2a). Jamais automatique : aucune minuterie, aucune route ne l'appelle (outil : `reparer-debit.js`).
//
// 🔑 TOUR 2 — UN CRÉDIT SE RECONNAÎT PAR SON DÉBIT, PAS PAR UN AGRÉGAT. La preuve lit CE débit :
//   · le CRÉDIT d'un débit est présent quand son identité est sur le document de la poche (`creditsRendus`, posée par la MÊME écriture atomique que le $inc : `ledger.rendrePoche`) ;
//   · sa TRACE est présente quand un mouvement +1 porte `debitId` (index unique), ou une ANCIENNE clé de ce débit (`rl|<clé du débit>`, `rp|<id>`, `…#<id>`) — c'est ainsi que les crédits écrits AVANT ce tour restent reconnus ;
//   · un débit pris par le code d'AVANT ce tour (pas de `priseLe`) sans marqueur ni trace n'a pas de preuve exacte : c'est le SEUL cas où l'écart de poche (reel − attendu, la mesure de `reconcilier`) décide ;
//     partout ailleurs il reste imprimé comme TÉMOIN, il ne décide plus (une anomalie de compensation sur la même poche ne peut plus faire perdre un crédit au client).
// Selon la preuve : ni crédit ni trace ⇒ crédit + trace + `rembourse` ; crédit sans trace ⇒ trace + `rembourse` ; crédit et trace, ligne restée `rendu-en-cours` ⇒ clôture ; jamais un second crédit
// (le marqueur de poche l'interdit, quel que soit le chemin ou le moment). Un débit PRIS depuis moins de `V2_REPARATION_AGE_MIN` minutes (`priseLe`) est tenu par un remboursement vivant : refus.
const L = () => require('./ledger');
const PRISES = ['rembourse', 'rendu-en-cours'];                 // les états d'une unité PRISE dont la trace peut manquer
const ETATS_A_CLORE = ['rendu-en-cours', 'rendu-echoue'];       // une ligne dont le crédit ET la trace sont prouvés se clôt en `rembourse`
const { semaineISO } = require('../../acces');
// la trace de CE débit : `debitId` (index unique), ou l'une des anciennes clés dérivées de lui
const trace = (m, d) => String(m.debitId) === String(d._id) || m.cleIdempotence === `rp|${d._id}` || (typeof d.cleIdempotence === 'string' && m.cleIdempotence === `rl|${d.cleIdempotence}`)
    || (typeof m.cleIdempotence === 'string' && m.cleIdempotence.endsWith(`#${d._id}`));

// La marque de livraison (`scans_en_cours`) de ce scan, en `echec` parce que l'unité n'était pas rendue (O5), est CLOSE `rendu` (issue `repare`) quand toutes les unités du scan sont rendues ; la claim `rb|scan` restée à delta 0 est close.
async function cloreMarque(porteur, scanId, maintenant) {
    const { col, base, codeErr } = L().interne;
    try {
        if (await col('mouvements').countDocuments({ ...base(porteur), type: 'debit', scanId, delta: -1, credit: { $ne: null }, etat: { $ne: 'rembourse' } })) return;
        for (const m of await col('mouvements').find({ ...base(porteur), type: 'remboursement', scanId, delta: 0, cleIdempotence: { $regex: '^rb\\|[^#]*$', $not: /\|fait\|/ } }).toArray())
            await col('mouvements').updateOne({ _id: m._id, cleIdempotence: m.cleIdempotence }, { $set: { cleIdempotence: `${m.cleIdempotence}|fait|repare` } });
        await col('scans_en_cours').updateOne({ _id: scanId, etat: 'echec' }, { $set: { etat: 'rendu', issue: 'repare', closLe: maintenant, expireLe: new Date(new Date(maintenant).getTime() + 7 * 86400e3) } });
    } catch (e) { console.error(`🔴 [v2 reparer] marque de livraison non close (${codeErr(e)})`); }
}
// L'écart de poche (TÉMOIN, ou juge pour un débit d'avant ce tour) : reel − (dotation + somme des deltas). { ecart } ou { raison }.
async function ecartDePoche(porteur, doc, poche) {
    const { col, base } = L().interne;
    let reel, attendu;
    if (porteur.type === 'installation') {
        if (poche === 'essai') { if (!Number.isInteger(doc.essaisInitiaux)) return { raison: 'poche-non-verifiable' }; reel = doc.essais ?? 0; attendu = doc.essaisInitiaux; }
        else if (poche === 'achete') { reel = doc.achete ?? 0; attendu = 0; }
        else return { raison: 'poche-non-verifiable' };
    } else {
        if (poche !== 'accueil' && poche !== 'achete') return { raison: 'poche-non-verifiable' };
        reel = doc.solde?.[poche] ?? 0; attendu = 0;
    }
    const [s] = await col('mouvements').aggregate([{ $match: { ...base(porteur), poche } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray();
    return { ecart: reel - (attendu + (s ? s.s : 0)) };
}

async function reparer(porteur, { scanId, debitId = null, maintenant = new Date(), simuler = false } = {}, cfg) {
    const { col, base, codeErr, rendreUnite, creditPresent, proprietaireDe, expireMouvement, CREDITS_MAX } = L().interne; const { ETATS_RENDU_NON_CONFIRME } = L();
    const refus = (raison, plus = {}) => ({ repare: false, raison, creditRendu: false, ...plus });
    if (!scanId) return refus('scan-absent');
    const ageMs = cfg && cfg.lot && cfg.lot.reparationAgeMs ? cfg.lot.reparationAgeMs : 15 * 60e3;
    const limite = new Date(new Date(maintenant).getTime() - ageMs);
    let cible, doc, horsCandidats = 0;
    try {
        doc = porteur.type === 'compte' ? await col('comptes').findOne({ _id: porteur.id }) : (porteur.type === 'installation' ? await col('installations').findOne({ _id: porteur.id }) : null);
        if (!doc) return refus('porteur-introuvable');
        if (porteur.type === 'installation' && doc.compteId) return refus('installation-liee');
        const debits = await col('mouvements').find({ ...base(porteur), type: 'debit', scanId, delta: -1 }).toArray();
        const traces = await col('mouvements').find({ type: 'remboursement', scanId, delta: 1 }).toArray();
        const cands = [];
        for (const d of debits) {
            if (!d.credit || typeof d.cleIdempotence !== 'string') continue;
            const marq = await creditPresent(porteur, d.credit, d._id);
            const tr = traces.some(m => trace(m, d));
            // `rendu-echoue` (réponse perdue après le crédit) n'est candidat que SI le crédit de CE débit est prouvé (marqueur ou trace) ; sans preuve il reste listé avec son geste
            if (PRISES.includes(d.etat) || (d.etat === 'debite' && marq) || (d.etat === 'rendu-echoue' && (marq || tr))) cands.push({ d, marq, trace: tr, herite: false, mode: 'exact' });
        }
        // les traces ANCIENNES sans clé de débit (la claim `rb|scan` de la 1re unité) : elles couvrent, au plus, autant de débits d'avant ce tour sans preuve propre. Un débit SANS clé d'idempotence (hors candidats) peut porter
        // l'une d'elles : on la lui retire du compte (relecture 3, M-6 i) — sinon elle ferait croire à une trace d'héritage pour un AUTRE débit sans trace
        horsCandidats = debits.filter(d => d.credit && PRISES.includes(d.etat) && typeof d.cleIdempotence !== 'string').length;
        const anonymes = Math.max(0, traces.filter(m => !debits.some(d => trace(m, d))).length - horsCandidats);
        const inconnus = cands.filter(c => !c.d.priseLe && !c.marq && !c.trace);
        for (const c of inconnus) { if (inconnus.length <= anonymes) { c.trace = true; c.herite = true; } else c.mode = 'ecart'; }
        for (const c of cands) {
            const credit = c.marq || c.trace;
            if (c.trace && !c.marq && !c.herite && c.d.priseLe) c.action = 'incoherent';        // une trace sans crédit chez un débit du protocole actuel : jamais deviné
            else if (credit && c.trace) c.action = ETATS_A_CLORE.includes(c.d.etat) ? 'clore' : null;
            else if (credit) c.action = 'trace';
            else c.action = 'credit';
        }
        let cibles = cands.filter(c => c.action && (!debitId || String(c.d._id) === String(debitId)));
        if (!cibles.length) return refus('rien-a-reparer');
        const tousClore = cibles.length > 1 && cibles.every(c => c.action === 'clore');
        if (cibles.length > 1 && !tousClore) return refus('choix-ambigu');
        if (tousClore) {
            if (simuler) return { repare: false, simulation: true, verdict: 'a-clore', raison: null, creditRendu: false, clos: cibles.length, debits: cibles.map(c => c.d._id), ecart: null, preuve: { credit: true, trace: true, mode: 'exacte' } };
            let clos = 0;
            for (const c of cibles) if (await col('mouvements').findOneAndUpdate({ _id: c.d._id, etat: { $in: ETATS_A_CLORE } }, { $set: { etat: 'rembourse', expireLe: expireMouvement(maintenant, cfg) }, $unset: { raisonRendu: '' } })) clos++;
            await cloreMarque(porteur, scanId, maintenant);
            return { repare: true, raison: null, creditRendu: false, clos, ecart: null };
        }
        cible = cibles[0];
        if (cible.action === 'incoherent') return refus('incoherent', { preuve: { credit: cible.marq, trace: cible.trace, mode: 'exacte' } });
        if (cible.action !== 'clore') {
            // le débit est-il tenu par un remboursement VIVANT ? (`priseLe` ; pour un débit d'avant ce tour : la claim du scan ou un mouvement de la poche, plus récents que le délai)
            if (cible.d.priseLe && new Date(cible.d.priseLe) > limite) return refus('prise-recente');
            if (cible.d.reparation && new Date(cible.d.reparation.le) > limite) return refus('reparation-en-cours');
            if (await col('mouvements').countDocuments({ type: 'remboursement', scanId, le: { $gt: limite } })) return refus('mouvement-recent');
            if (await col('mouvements').countDocuments({ ...base(porteur), poche: cible.d.credit.poche, le: { $gt: limite } })) return refus('mouvement-recent');
        }
    } catch (e) { console.error(`❌ [v2 reparer] lecture : ${codeErr(e)}`); return refus('erreur'); }
    const d = cible.d, poche = d.credit.poche;
    // le témoin : l'écart de poche (imprimé toujours quand la poche est vérifiable ; juge seulement pour un débit d'avant ce tour sans preuve propre)
    let temoin = null, action = cible.action;
    try {
        const e = await ecartDePoche(porteur, doc, poche);
        if (e.ecart !== undefined) temoin = e.ecart;
        if (cible.mode === 'ecart') {
            if (e.raison) return refus(e.raison);
            const non = await col('mouvements').countDocuments({ ...base(porteur), type: 'debit', 'credit.poche': poche, etat: { $in: ETATS_RENDU_NON_CONFIRME }, _id: { $ne: d._id } });
            if (non) return refus('non-resolus-meme-poche');
            const tous = await col('mouvements').find({ ...base(porteur), type: 'debit', delta: -1, etat: { $in: PRISES }, scanId: { $exists: true, $ne: null }, cleIdempotence: { $type: 'string' }, credit: { $ne: null } }).toArray();
            const parScan = new Map(); for (const x of tous) parScan.set(String(x.scanId), (parScan.get(String(x.scanId)) || 0) + 1);
            // (les débits SANS clé du scan courant portent une part des traces : ils ne couvrent pas les débits à clé)
            let manque = 0; for (const [s, n] of parScan) manque += Math.max(0, n - Math.max(0, await col('mouvements').countDocuments({ type: 'remboursement', delta: 1, scanId: tous.find(x => String(x.scanId) === s).scanId }) - (s === String(scanId) ? horsCandidats : 0)));
            if (manque !== 1) return refus('plusieurs-ambigus');
            if (e.ecart !== 0 && e.ecart !== 1) return refus('ecart-inattendu', { ecart: e.ecart });
            action = e.ecart === 1 ? 'trace' : 'credit';
        }
        // Preuve EXACTE d'absence de crédit (marqueur absent, aucune trace) — elle ne vaut que si le marqueur peut encore PARLER :
        if (cible.mode === 'exact' && action === 'credit') {
            const prop = proprietaireDe(porteur, d.credit);
            // · poche hebdomadaire : une unité hebdomadaire ne survit pas à sa semaine ; document disparu (TTL) ou semaine passée sans marqueur ⇒ la ligne se CLÔT sans crédit (`semaine-expiree`)
            if (d.credit.poche === 'hebdo') { const h = prop && await col(prop[0]).findOne(prop[1], { projection: { _id: 1 } }); if (!h || semaineISO(new Date(maintenant)) !== d.credit.semaineIso) action = 'expire'; }
            if (action === 'credit') {
                // · installation DÉLIÉE d'un compte : si le crédit a été rendu sur le compte (poche accueil), le marqueur est sur le document du COMPTE — décision humaine, jamais un second crédit
                if (porteur.type === 'installation' && await col('comptes').findOne({ creditsRendus: d._id }, { projection: { _id: 1 } })) return refus('credit-sur-compte-lie', { ecart: temoin });
                // · marqueur PLEIN (les CREDITS_MAX dernières identités du document de poche) : l'identité de ce débit a pu en sortir — l'absence de marqueur ne prouve plus l'absence de crédit : REFUS, jamais un crédit
                const pd = prop && await col(prop[0]).findOne(prop[1], { projection: { creditsRendus: 1 } });
                if (pd && Array.isArray(pd.creditsRendus) && pd.creditsRendus.length >= CREDITS_MAX) return refus('marqueur-sature', { ecart: temoin });
            }
        }
    } catch (e) { console.error(`❌ [v2 reparer] preuve : ${codeErr(e)}`); return refus('erreur'); }
    const preuve = { credit: action !== 'credit', trace: action === 'clore', mode: cible.mode === 'ecart' ? 'ecart (débit d\'avant le tour 2, sans marqueur ni trace)' : 'exacte' };
    if (simuler) return { repare: false, simulation: true, verdict: action === 'clore' ? 'a-clore' : (action === 'expire' ? 'a-expirer' : 'reparable'), raison: null, creditRendu: action === 'credit', ecart: temoin, poche, debits: [d._id], etatDebit: d.etat, reprise: Boolean(d.reparation), action, preuve };
    if (action === 'expire') {
        // la ligne se CLÔT sans crédit : trace de clôture (delta 0, motif `semaine-expiree`, unique par `debitId`), puis l'état
        try { await col('mouvements').insertOne({ ...base(porteur), poche, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 0, motif: 'semaine-expiree', scanId, debitId: d._id, etat: 'rembourse', cleIdempotence: `rp|${d._id}`, expireLe: expireMouvement(maintenant, cfg) }); }
        catch (e) { if (e.code !== 11000) { console.error(`❌ [v2 reparer] clôture hebdo : ${codeErr(e)}`); return refus('erreur'); } }
        const r = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: d.etat }, { $set: { etat: 'rembourse', clotureSansCredit: 'semaine-expiree', expireLe: expireMouvement(maintenant, cfg) }, $unset: { raisonRendu: '' } });
        await cloreMarque(porteur, scanId, maintenant);
        return { repare: Boolean(r), raison: r ? null : 'prise-perdue', creditRendu: false, motif: 'semaine-expiree', ecart: temoin };
    }
    if (action === 'clore') {
        const r = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: { $in: ETATS_A_CLORE } }, { $set: { etat: 'rembourse', expireLe: expireMouvement(maintenant, cfg) }, $unset: { raisonRendu: '' } });
        await cloreMarque(porteur, scanId, maintenant);
        return { repare: Boolean(r), raison: r ? null : 'prise-perdue', creditRendu: false, clos: r ? 1 : 0, ecart: temoin };
    }
    // prise atomique de la marque `reparation` (une marque VIEILLE se reprend sur son horodatage : une seule reprise passe)
    let pris;
    try { pris = await col('mouvements').findOneAndUpdate({ _id: d._id, etat: d.etat, ...(d.reparation ? { 'reparation.le': d.reparation.le } : { reparation: { $exists: false } }) }, { $set: { reparation: { le: maintenant, ...(temoin !== null ? { ecart: temoin } : {}), ...(d.reparation ? { reprise: true } : {}) } } }, { returnDocument: 'before' }); }
    catch (e) { console.error(`❌ [v2 reparer] prise : ${codeErr(e)}`); return refus('erreur'); }
    if (!pris) return refus('prise-perdue');
    let cr = null, creditRendu = false;
    if (action === 'credit') {
        try { cr = await rendreUnite(porteur, d.credit, cfg, maintenant, d._id); }
        catch (e) { console.error(`🔴 [v2 reparer] crédit en erreur (${codeErr(e)}) — le crédit a PEUT-ÊTRE été écrit ; marque laissée, reprise au-delà de ${Math.round(ageMs / 60e3)} min (la preuve est refaite sur le marqueur de la poche)`); return refus('erreur-apres-prise'); }
        if (cr.rendu) creditRendu = true;
        else if (cr.raison === 'poche-deja-compensee') cr = null;          // le crédit de CE débit est déjà sur la poche (un autre chemin vient de l'écrire) : la trace seule
        else {                                                             // un crédit REFUSÉ n'a rien écrit : la marque est débloquée
            try { await col('mouvements').updateOne({ _id: d._id }, d.reparation ? { $set: { reparation: d.reparation } } : { $unset: { reparation: '' } }); } catch (_) { /* la marque restée se reprend au-delà du délai */ }
            return refus(cr.raison || 'credit-non-rendu');
        }
    }
    try {
        await col('mouvements').insertOne({ ...base(cr ? cr.cible : porteur), poche: cr ? cr.pocheRendue : poche, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, motif: 'reparation', scanId, debitId: d._id, etat: 'rembourse', cleIdempotence: `rp|${d._id}`, expireLe: expireMouvement(maintenant, cfg) });
    } catch (e) {
        if (e.code !== 11000) {
            console.error(`🔴 [v2 reparer] ${creditRendu ? 'crédit ÉCRIT mais ' : ''}trace non écrite (${codeErr(e)}) — marque laissée, reprise au-delà de ${Math.round(ageMs / 60e3)} min`);
            return refus('trace-non-ecrite', { creditRendu });
        }                                                                  // 11000 : la trace de CE débit existe déjà (autre chemin) — elle compte
    }
    let etatEcrit = true;
    if (d.etat !== 'rembourse') { try { await col('mouvements').updateOne({ _id: d._id }, { $set: { etat: 'rembourse', expireLe: expireMouvement(maintenant, cfg) }, $unset: { raisonRendu: '' } }); } catch (e) { etatEcrit = false; console.error(`🔴 [v2 reparer] trace écrite, état « rembourse » non écrit (${codeErr(e)}) — un second appel clôt la ligne`); } }
    await cloreMarque(porteur, scanId, maintenant);
    return { repare: true, raison: null, creditRendu, poche, ecart: temoin, ...(etatEcrit ? {} : { etatNonEcrit: true }) };
}
module.exports = { reparer, ecartDePoche };

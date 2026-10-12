'use strict';
// B1b.8 — les LOTS : plusieurs cartes vues sur une annonce, UN crédit par tranche de 10 (max(1, ceil(N/10))), ordre par valeur, supplément tout-ou-rien.
// Ce module n'écrit RIEN dans v2/argent/ : il appelle `coutDuLot`, `debiterSupplement`, `rembourser`, `reserverQuestion` du registre « argent » (B3).
// Le crochet `deps.identifierLot(req)` rend un résultat HÉRITÉ par carte vue : Promise<Array<{ statutHttp, corps }>>. Absent => une seule carte (routes.js).
// 🔑 Invariants qui se lisent ici :
//   · le crochet est appelé APRÈS le premier débit (jamais de lecture sans crédit pris) et reçoit une requête SANS `credit` : il ne peut ni débiter ni rembourser ;
//   · la règle G (B1b.7) juge UNE carte : elle n'est jamais consultée sur un lot (routes.js ne l'appelle que dans la branche à une carte) ;
//   · le supplément passe par `debiterSupplement` — tout ou rien, une ligne `mouvements` par unité. Entre processus, deux requêtes de MÊME Idempotency-Key ne
//     le débitent jamais deux fois : (1) la route est derrière `idempotente('identifier')` (claim Mongo par porteur|route|clé), le jumeau répond DEBIT « en cours » ;
//     (2) même sans ce claim, la clé du DÉBIT INITIAL est unique : seul le gagnant de ce débit atteint le supplément, le perdant reçoit `rejoue` et sort avant tout lot ;
//   · un crochet qui rend UN seul résultat ne fait pas un lot : c'est la branche une-carte (`{ unique }`), avec la règle G, la question réservée et le sans-prix ;
//   · tout débit finit livré ou remboursé ; un lot ENTIÈREMENT introuvable est remboursé, un lot dont une seule carte est lue ne l'est jamais (un crédit de lot couvre
//     jusqu'à 10 cartes : un prix manquant sur l'une n'annule pas la lecture des autres — c'est aussi pourquoi `sans-prix` ne rembourse rien sur un lot, retour-live.js).
const { dansUnScan } = require('../../sources');
const { adapter, codeLangueDe } = require('./adaptateur');
const { fournisseurParDefaut, idsAffirmes, idsACharger } = require('./jumeaux');
const etatChargeur = require('../chargeur/etat');
const { col } = require('../db');
const { facturation: fabriquerFacturation, raisonPublique } = require('../argent/facturation');

const { cartesParScanMax } = require('./cartes-par-scan');   // /reponse et /retour-live n'adressent que les cartes 0 à MAX-1 : au-delà, une question serait sans réponse possible
const journal = (ou, e) => console.error(`❌ [v2 lot] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message : il peut citer une donnée

// La valeur d'une carte pour le classement : la tendance du guide, sinon null (carte sans guide, question, introuvable).
const valeurDe = c => {
    const t = c && c.carte && c.carte.prixGuide ? c.carte.prixGuide.tendance : null;
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
};
// Valeur décroissante, null en dernier, égalité => ordre d'ENTRÉE (le critère final est l'index : le tri est stable par construction, pas par la version de Node).
function ordonnerParValeur(cartes) {
    return [...cartes].sort((a, b) => {
        const va = valeurDe(a), vb = valeurDe(b);
        if (va !== vb) { if (va === null) return 1; if (vb === null) return -1; return vb - va; }
        return a.index - b.index;
    });
}
function compterLot(cartes, cfg) {
    const n = s => cartes.filter(c => c.statut === s).length;
    return { cartesVues: cartes.length, identifiees: n('identifiee'), aTrancher: n('a-trancher'), introuvables: n('introuvable'), lectureLiveMax: cfg.lot.lectureLiveMax };
}
const zoneValide = z => (z && typeof z === 'object' && Number.isInteger(z.photo) && z.photo >= 0 && ['x', 'y', 'w', 'h'].every(k => typeof z[k] === 'number' && z[k] >= 0 && z[k] <= 1)
    ? { photo: z.photo, x: z.x, y: z.y, w: z.w, h: z.h } : null);
const entiers = xs => [...new Set((Array.isArray(xs) ? xs : []).map(c => c && c.idProduct).filter(Number.isInteger))];

/**
 * Tout ce qui suit le premier débit, pour un lot. Rend { erreur: { code, detail?, facturation } } (réponse d'erreur) ou { sortie } (forme de traiterIdentifier).
 * @param p { cfg, deps, catalogue, argent, porteur, entree, annonce, scanId, cleDebit, admin, credit, ip, userId, facturationDe }
 */
async function executerLot(p) {
    const { cfg, deps, catalogue, argent, porteur, entree, annonce, scanId, cleDebit, admin, credit } = p;
    // Rend TOUTES les unités du scan (initiale + supplément). { rendu, cause } — cause en liste publique fermée.
    const rendre = async (motif, o = {}) => {
        if (admin || !credit) return { rendu: false, cause: null };
        try { const r = await argent.rembourser(porteur, credit, motif, { scanId, compteur: 'panne', ...o }); return { rendu: Boolean(r && r.rendu), cause: r && r.rendu ? null : raisonPublique(r && r.raisonNonRembourse) }; }
        catch (e) { journal('remboursement', e); return { rendu: false, cause: 'erreur' }; }
    };
    // Un refus `lot-trop-grand` (taille ou quota) : jusqu'à `cfg.plafonds.lotTropGrand` par jour et par porteur (V2_LOT_TROP_GRAND_JOUR, 10) le crédit initial est rendu ; AU-DELÀ la lecture
    // est FACTURÉE (crédit non rendu, `debite: 1`, raison `plafond-jour` de la liste publique), la réponse restant le refus. Le supplément n'est jamais pris : seul le crédit initial l'est.
    // Un administrateur ne paie rien et ne compte pas. Le compteur est celui du ledger (rendreLeScan), qui garde la claim `rb|scanId` : un rejeu ne compte qu'UN refus.
    const refuserLot = async (motifRembourse, code, detail) => {
        if (admin) return { code, detail, facturation: fabriquerFacturation({ motif: 'administrateur', rembourse: false }) };
        const r = await rendre(motifRembourse, { compteur: 'lot-trop-grand' });
        const facturation = r.rendu ? fabriquerFacturation({ debite: 0, rembourse: true, motif: 'lot' })
            : fabriquerFacturation({ debite: 1, rembourse: false, motif: 'lot', raisonNonRembourse: r.cause ?? 'erreur' });
        return { code, detail, facturation };
    };
    const panne = async (code, dejaRendu = false, o = {}) => {
        const r = dejaRendu ? { rendu: true, cause: null } : await rendre(`panne-${code}`, o);
        return { sortie: { resultat: { issue: 'panne', analyse: null, erreur: { code } }, facturation: p.facturationDe('panne', { admin, rendu: r.rendu, question: false, cause: r.cause }), lecture: null, desaccord: null } };
    };
    // 1. la lecture des cartes — APRÈS le débit, sans crédit dans la requête
    const reqLot = { body: { imageUrls: entree.imageUrls, title: annonce.titre, vintedEtat: entree.vintedEtat, prixVinted: entree.prixVinted, vintedUrl: entree.vintedUrl, versionExtension: entree.versionExtension, userId: p.userId },
                     ip: p.ip, headers: {}, scanIdImpose: scanId };
    let resultats;
    try { resultats = await dansUnScan(async () => deps.identifierLot(reqLot)); }
    catch (e) { journal('crochet', e); return panne('SERVEUR'); }
    if (!Array.isArray(resultats) || resultats.length === 0) {
        console.error(`❌ [v2 lot] le crochet n'a pas rendu de résultats (${Array.isArray(resultats) ? resultats.length : typeof resultats})`);
        return panne('SERVEUR');
    }
    // Un lot de plus de `cfg.lot.cartesMax` cartes (V2_LOT_CARTES_MAX, 20) est REFUSÉ `lot-trop-grand`, jamais tronqué en silence : une carte au-delà serait sans question répondable
    // (`carte` va de 0 à cartesMax - 1). Aucun supplément n'est pris. Même compteur et même facturation que le supplément impayable (voir `refuserLot`).
    if (resultats.length > cartesParScanMax(cfg)) {
        console.warn(`⚠️ [v2 lot] ${resultats.length} résultats pour un maximum de ${cartesParScanMax(cfg)} : lot refusé (lot-trop-grand-taille)`);
        return { erreur: await refuserLot('lot-trop-grand', 'ENTREE', 'lot-trop-grand-taille') };
    }
    // UN résultat n'est pas un lot : il tient lieu de réponse de la chaîne dans la branche UNE-CARTE de routes.js (règle G, question réservée, sans-prix). Rien n'est écrit ici.
    // Un résultat unique NON CONFORME (null, undefined, 0, '' : pas un objet { statutHttp entier, corps }) n'est jamais confié à la branche une-carte, qui rappellerait la VRAIE
    // chaîne (une seconde lecture payante) : même issue que les autres non-conformes du crochet, 500 SERVEUR remboursé.
    if (resultats.length === 1) {
        const r = resultats[0];
        if (!r || typeof r !== 'object' || Array.isArray(r) || !Number.isInteger(r.statutHttp)) { console.error('❌ [v2 lot] le crochet a rendu un résultat unique non conforme'); return panne('SERVEUR'); }
        return { unique: r };
    }
    // 2. le catalogue de l'API pour tous les produits désignés ; une lecture qui TOMBE est une panne, jamais une absence
    const corpsDe = r => (r && r.corps && typeof r.corps === 'object' ? r.corps : {});
    let produits;
    // JUMEAU-V2 : la même garde que la route d'une carte (une version de la colonne pour tout le lot) ; les jumeaux d'une affirmation qui tient dans une question sont chargés avec elle
    const jumeaux = deps.jumeaux || await fournisseurParDefaut(catalogue, etatChargeur.version(), resultats.flatMap(r => idsAffirmes(corpsDe(r))));
    try { produits = await catalogue.lire(resultats.flatMap(r => { const c = corpsDe(r); return [...entiers(c.candidats), ...(c.carte && Number.isInteger(c.carte.idProduct) ? [c.carte.idProduct] : []), ...idsACharger(c, jumeaux)]; })); }
    catch (e) { journal('catalogue', e); return panne('INDISPONIBLE'); }
    // 3. une carte par résultat, dans l'ordre d'ENTRÉE ; une carte illisible devient « introuvable / panne-lecture » (comptée vue : la lecture a eu lieu)
    const adapterFn = deps.adapter || adapter;
    const pannes = [];
    const motifs = [];                                                             // JUMEAU-V2 : le motif de la garde PAR CARTE (interne : écrit dans analyses.cartes[i], jamais servi)
    const cartes = resultats.map((r, i) => {
        let a = null;
        try { a = adapterFn({ statutHttp: r && r.statutHttp, corps: r && r.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false, jumeaux }); } catch (e) { journal('adaptateur', e); }
        motifs[i] = a && typeof a.motif === 'string' ? a.motif : null;
        const c = a && a.issue !== 'panne' && a.analyse && Array.isArray(a.analyse.cartes) ? a.analyse.cartes[0] : null;
        if (!c) { pannes.push(a && a.erreur ? a.erreur.code : 'SERVEUR'); return { index: i, statut: 'introuvable', carte: null, candidats: [], question: null, raison: 'panne-lecture', etat: null, prixLive: null, zone: null }; }
        return { ...c, index: i, zone: zoneValide(corpsDe(r).zone) };
    });
    const lectures = resultats.map(r => ({ codeLangue: codeLangueDe(corpsDe(r)), reverseStrategie: corpsDe(r).reverse && typeof corpsDe(r).reverse.strategie === 'string' ? corpsDe(r).reverse.strategie : null }));
    // aucune carte lue du tout : une panne, pas un « introuvable » ; si TOUTES le sont par la garde des jumeaux (notre colonne), le crédit est rendu dans le compteur DÉDIÉ `jumeaux`, UNE unité par carte
    // (`every`, jamais `some` : une seule carte refusée par la garde ne fait pas rendre tout un lot hors de son plafond ordinaire)
    const toutesParLaGarde = motifs.length === cartes.length && motifs.every(Boolean);
    if (pannes.length === cartes.length) return panne(pannes[0], false, toutesParLaGarde ? { compteur: 'jumeaux', unites: cartes.length } : {});
    const lotInfo = compterLot(cartes, cfg);
    // 4. le supplément : max(1, ceil(N/10)) - 1 unités, TOUT OU RIEN (un administrateur ne paie rien)
    const cout = argent.coutDuLot(cartes.length), supplement = cout - 1;
    if (supplement > 0 && !admin) {
        // entre processus : claim Mongo d'`idempotente` + unicité de la clé du débit initial (seul le gagnant arrive ici) — voir l'en-tête
        let s;
        try { s = await argent.debiterSupplement(porteur, { scanId, unites: supplement, cleIdempotence: `${cleDebit}|supplement` }); }
        catch (e) { journal('supplément', e); return panne('SERVEUR'); }
        if (!s || !s.ok) {
            const code = s && ['QUOTA', 'VERIFICATION', 'EN_RECONCILIATION'].includes(s.code) ? s.code : 'INDISPONIBLE';
            // QUOTA : un lot qu'on ne peut pas payer = un refus `lot-trop-grand`, compté (10 par jour) comme celui de la taille ; les autres codes (VERIFICATION, EN_RECONCILIATION,
            // INDISPONIBLE) ne sont pas des refus de lot : crédit initial rendu SANS compter dans les plafonds, comme avant.
            if (code === 'QUOTA') return { erreur: await refuserLot('lot-trop-grand', 'QUOTA', 'lot-trop-grand') };
            const r = await rendre(`lot-supplement-${code.toLowerCase()}`, { sansPlafond: true });
            const facturation = r.rendu ? fabriquerFacturation({ debite: 0, rembourse: true, motif: 'lot' })
                : fabriquerFacturation({ debite: 1, rembourse: false, motif: 'lot', raisonNonRembourse: r.cause ?? 'erreur' });
            return { erreur: { code, detail: undefined, facturation } };
        }
    }
    // 5. un lot ENTIÈREMENT introuvable est remboursé (toutes ses unités) ; un seul identifié ou une seule question et il ne l'est jamais
    let facturation;
    if (lotInfo.identifiees === 0 && lotInfo.aTrancher === 0) {
        const r = await rendre('introuvable', toutesParLaGarde ? { compteur: 'jumeaux', unites: cartes.length } : {});          // lot entièrement refusé PAR LA GARDE (carte par carte, `every`) : compteur dédié, une unité par carte ; un lot mixte reste jugé au plafond de pannes ordinaire
        facturation = p.facturationDe('introuvable', { admin, rendu: r.rendu, question: false, cause: r.cause });
        if (!admin && !r.rendu) facturation = { ...facturation, debite: cout };          // remboursement refusé : le client a payé TOUT le lot, la facturation le dit
    } else facturation = admin ? fabriquerFacturation({ motif: 'administrateur', rembourse: false }) : fabriquerFacturation({ debite: cout, motif: 'lot' });
    // 6. les questions : une par carte à trancher, `lot: true` (répondre ne coûte rien et ne rend rien), index = position d'entrée
    if (lotInfo.aTrancher > 0 && !admin && credit) {
        const posees = [];
        for (const c of cartes.filter(x => x.statut === 'a-trancher')) {
            let r = null;
            try {
                const choix = c.question.choix.map(x => ({ id: x.id, idProduct: x.idProduct }));
                r = await argent.reserverQuestion(porteur, credit, { scanId, carte: c.index, raison: 'lot', candidats: choix.map(x => x.idProduct), choix, lot: true });
            } catch (e) { journal('question', e); }
            if (r && r.etat === 'en-attente') { posees.push(c.index); continue; }
            // une question qui n'existe pas n'est répondable par personne : tout le lot devient une panne (jamais un a-trancher sans question)
            try { await col('questions_v2').updateMany({ scanId, 'porteur.type': porteur.type, 'porteur.id': porteur.id, lot: true, etat: 'en-attente' },
                { $set: { etat: 'non-remboursee', rembourse: false, raisonNonRembourse: 'lot', regleeLe: new Date() } }); } catch (e) { journal('annulation des questions', e); }
            return panne('SERVEUR', Boolean(r && r.etat === 'remboursee'));
        }
    }
    const analyse = { statut: 'lot', cartes: ordonnerParValeur(cartes), lot: lotInfo, raison: null };
    return { sortie: { resultat: { issue: 'lot', analyse, erreur: null }, facturation, lecture: null, lectures, cartesEntree: cartes, motifs, desaccord: null } };
}

module.exports = { executerLot, ordonnerParValeur, compterLot, valeurDe };

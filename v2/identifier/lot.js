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
//   · tout débit finit livré ou remboursé ; un lot ENTIÈREMENT introuvable est remboursé ; un lot dont AUCUNE carte n'affiche de prix l'est aussi (LOT-SANS-PRIX, 2026-10-24 : lotAfficheUnPrix, qui appelle
//     afficheUnPrix) ; un lot dont UNE carte affiche un prix (guide, repli, ou un candidat de question) reste compté (un crédit de lot couvre jusqu'à 10 cartes : un prix manquant sur l'une n'annule pas
//     la lecture des autres — c'est aussi pourquoi `POST /api/retour-live` `sans-prix` ne rembourse rien sur une carte de lot, retour-live.js : le lot se juge ICI, une fois, sur l'ensemble).
const { dansUnScan } = require('../../sources');
const { adapter, codeLangueDe } = require('./adaptateur');
const { fournisseurParDefaut, idsAffirmes, idsACharger } = require('./jumeaux');
const { idsDeLaGarde } = require('./garde-contradiction');
const { preparer: preparerLD } = require('./langue-decisive-charge');
const etatChargeur = require('../chargeur/etat');
const { col } = require('../db');
const { facturation: fabriquerFacturation, raisonPublique } = require('../argent/facturation');
const { natureDuMotif } = require('../argent/nature-du-motif');
const { afficheUnPrix, avecRepliAnalyse } = require('./prix-repli');       // LOT-SANS-PRIX : la SEULE règle « ce scan affiche-t-il un prix ? » (REPLI-QUOTA), appelée telle quelle

const { imagesDeLaChaine } = require('./photos-recues');   // PHOTOS-MULTIPLES (7d) : les photos reçues avant le scan (octets) à la place des URLs, quand il y en a
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
// `zone.photo` est un index d'`imageUrls`. Quand des photos ont été REÇUES, le lecteur n'a vu que celles-là, en liste compactée (imagesDeLaChaine) : sa `photo` N est sa N-ième image, soit `photosRecues[N].index` dans `imageUrls`.
// Une `photo` hors de cette liste n'est pas devinée : zone sans photo (null).
const zoneValide = (z, entree) => {
    if (!(z && typeof z === 'object' && Number.isInteger(z.photo) && z.photo >= 0 && ['x', 'y', 'w', 'h'].every(k => typeof z[k] === 'number' && z[k] >= 0 && z[k] <= 1))) return null;
    const recues = entree && Array.isArray(entree.photosRecues) && entree.photosRecues.length ? entree.photosRecues : null;
    if (!recues) return { photo: z.photo, x: z.x, y: z.y, w: z.w, h: z.h };
    const p = [...recues].sort((a, b) => a.index - b.index)[z.photo];
    return p ? { photo: p.index, x: z.x, y: z.y, w: z.w, h: z.h } : null;
};
const entiers = xs => [...new Set((Array.isArray(xs) ? xs : []).map(c => c && c.idProduct).filter(Number.isInteger))];

// LOT-SANS-PRIX (décision de l'éditeur, 2026-10-24) : « Un scan qui n'affiche aucun prix ne compte pas dans le quota. » Un lot dont AUCUNE carte n'affiche de prix est rendu en entier ; la règle d'une carte est afficheUnPrix
// (prix-repli.js, la seule), appelée avec ce que la réponse SERT : un `prixGuide` non nul (prixRendu) ou un `prixRepli` servi (repli, calculé par avecRepliAnalyse, la fonction même que la route applique à cette analyse).
// 🔑 Écrite par ce qu'elle AUTORISE : « aucun prix » n'est dit que d'une carte POSITIVEMENT sans prix (un introuvable ; une identifiée dont le prixGuide est exactement null, sans repli, et dont la langue n'est pas lue (prixLive exactement null : aucune lecture en direct dictée) ; une question dont CHAQUE candidat a un
// prixGuide exactement null). Un champ absent, un statut inconnu, une carte illisible, une lecture qui lève : le doute est « un prix est affiché » — le lot reste compté, jamais rendu sur un doute.
const prixServi = p => (p && typeof p === 'object' ? p.prixGuide !== null : true);             // prixGuide undefined (on ne sait pas) : servi
// LOT-SANS-PRIX tour 1 (I1) : une carte dont la réponse sert une instruction de prix EN DIRECT (`prixLive` objet : la langue est lue, adaptateur.js prixLiveDe) peut montrer un prix lu par l'extension sur Cardmarket, que le serveur ne
// verra jamais (retour-live refuse un lot). C'est un prix POSSIBLEMENT affiché : le lot reste compté. Seule la valeur `null` (langue non lue : rien à lire) vaut « aucune instruction » ; tout le reste est un doute.
const instructionEnDirect = c => c.prixLive !== null;
// LOT-SANS-PRIX tour 2 (I2) : une QUESTION n'a pas de `prixLive` tant qu'elle n'est pas tranchée, mais la réponse OUI (routes.js, prixLiveDe) en sert un dès que la langue de la carte est lue. La langue lue de la carte d'entrée i est
// `lectures[i].codeLangue` (ce que l'adaptateur a lu, calculé dans executerLot) : seule la valeur exactement `null` de CETTE carte vaut « langue non lue » ; lectures absentes, trop courtes ou d'une forme inconnue : un doute.
const langueNonLue = (c, lectures) => { const l = Array.isArray(lectures) ? lectures[c.index] : undefined; return Boolean(l) && typeof l === 'object' && l.codeLangue === null; };
function carteAfficheUnPrix(c, lectures) {
    try {
        if (!c || typeof c !== 'object') return true;
        if (c.statut === 'introuvable') return false;                                          // aucune fiche, aucun prix à montrer
        if (c.statut === 'identifiee') return afficheUnPrix({ prixRendu: prixServi(c.carte) || instructionEnDirect(c), repli: avecRepliAnalyse(c).prixRepli ?? null });
        // une question : si l'un de ses candidats montre un prix au client, le lot en affiche un (le candidat est montré avec son prixGuide)
        // M2 : une question sans candidat est un doute. I2 : une question à langue lue (ou dont la lecture est inconnue) recevra une instruction de prix en direct après un OUI : prix possiblement affiché.
        if (c.statut === 'a-trancher') return !Array.isArray(c.candidats) || c.candidats.length === 0 || c.candidats.some(k => afficheUnPrix({ prixRendu: prixServi(k) || !langueNonLue(c, lectures) }));
        return true; // statut inconnu : un prix est supposé affiché
    } catch (_) { return true; } // on ne peut pas conclure : un prix est supposé affiché
}
/** Vrai quand AU MOINS UNE carte du lot affiche un prix (ou qu'on ne peut pas le dire) ; faux seulement si TOUTES sont positivement sans prix. Ne lève jamais. */
function lotAfficheUnPrix(cartes, lectures) {
    if (!Array.isArray(cartes) || cartes.length === 0) return true;
    return cartes.some(c => carteAfficheUnPrix(c, lectures));
}

/**
 * Tout ce qui suit le premier débit, pour un lot. Rend { erreur: { code, detail?, facturation } } (réponse d'erreur) ou { sortie } (forme de traiterIdentifier).
 * @param p { cfg, deps, catalogue, argent, porteur, entree, annonce, scanId, cleDebit, admin, credit, ip, userId, facturationDe }
 */
async function executerLot(p) {
    const { cfg, deps, catalogue, argent, porteur, entree, annonce, scanId, cleDebit, admin, credit } = p;
    // Rend TOUTES les unités du scan (initiale + supplément). { rendu, cause } — cause en liste publique fermée.
    const rendre = async (motif, o = {}) => {
        if (admin || !credit) return { rendu: false, cause: null };
        try { const r = await argent.rembourser(porteur, credit, motif, { scanId, compteur: natureDuMotif(motif), ...o }); return { rendu: Boolean(r && r.rendu), cause: r && r.rendu ? null : raisonPublique(r && r.raisonNonRembourse) }; }
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
        const r = dejaRendu ? { rendu: true, cause: null } : await rendre(`panne-${code}`, o);       // la nature vient du motif `panne-*` (natureDuMotif) : hors plafond
        return { sortie: { resultat: { issue: 'panne', analyse: null, erreur: { code } }, facturation: p.facturationDe('panne', { admin, rendu: r.rendu, question: false, cause: r.cause }), lecture: null, desaccord: null } };
    };
    // 1. la lecture des cartes — APRÈS le débit, sans crédit dans la requête
    const reqLot = { body: { imageUrls: imagesDeLaChaine(entree), title: annonce.titre, vintedEtat: entree.vintedEtat, prixVinted: entree.prixVinted, vintedUrl: entree.vintedUrl, versionExtension: entree.versionExtension, userId: p.userId },
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
    const version0 = etatChargeur.version();                                  // UNE lecture de la version pour tout le lot (m-1) : passée au premier appel ET à preparer
    const jumeaux0 = deps.jumeaux || await fournisseurParDefaut(catalogue, version0, resultats.flatMap(r => idsAffirmes(corpsDe(r))));
    try { produits = await catalogue.lire(resultats.flatMap(r => { const c = corpsDe(r); return [...entiers(c.candidats), ...(c.carte && Number.isInteger(c.carte.idProduct) ? [c.carte.idProduct] : []), ...idsACharger(c, jumeaux0), ...idsDeLaGarde(c)]; })); }
    catch (e) { journal('catalogue', e); return panne('INDISPONIBLE'); }
    // LANGUE-DECISIVE (B1, M2) : comme la route d'une carte, les jumeaux des candidats que la photo pourrait laisser seuls et l'index code × numéro du catalogue entier
    const pr = await preparerLD({ corpsListe: resultats.map(corpsDe), produits, jumeaux: jumeaux0, catalogue, version: version0, deps });
    produits = pr.produits;
    const jumeaux = pr.jumeaux, ctxLD = pr.codeNumeroExiste ? { codeNumeroExiste: pr.codeNumeroExiste } : {};
    // 3. une carte par résultat, dans l'ordre d'ENTRÉE ; une carte illisible devient « introuvable / panne-lecture » (comptée vue : la lecture a eu lieu)
    const adapterFn = deps.adapter || adapter;
    const pannes = [];
    const motifs = [];                                                             // JUMEAU-V2 : le motif de la garde PAR CARTE (interne : écrit dans analyses.cartes[i], jamais servi)
    const cartes = resultats.map((r, i) => {
        let a = null;
        try { a = adapterFn({ statutHttp: r && r.statutHttp, corps: r && r.corps }, { produits, langueInterface: entree.langueInterface, cfg, ficheServie: false, jumeaux, ...ctxLD }); } catch (e) { journal('adaptateur', e); }
        motifs[i] = a && typeof a.motif === 'string' ? a.motif : null;
        const c = a && a.issue !== 'panne' && a.analyse && Array.isArray(a.analyse.cartes) ? a.analyse.cartes[0] : null;
        if (!c) { pannes.push(a && a.erreur ? a.erreur.code : 'SERVEUR'); return { index: i, statut: 'introuvable', carte: null, candidats: [], question: null, raison: 'panne-lecture', etat: null, prixLive: null, zone: null }; }
        return { ...c, index: i, zone: zoneValide(corpsDe(r).zone, entree) };
    });
    const lectures = resultats.map(r => ({ codeLangue: codeLangueDe(corpsDe(r)), reverseStrategie: corpsDe(r).reverse && typeof corpsDe(r).reverse.strategie === 'string' ? corpsDe(r).reverse.strategie : null }));
    // aucune carte lue du tout : une panne, pas un « introuvable » ; si TOUTES le sont par la garde des jumeaux (notre colonne), la nature du remboursement est `jumeaux`, UNE unité par carte
    // (`every`, jamais `some`). PLAFOND-DECLARE : panne, introuvable et garde des jumeaux sont CONSTATÉS par le serveur : rendus sans plafond.
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
    // 5. un lot ENTIÈREMENT introuvable est remboursé (toutes ses unités) ; un lot dont AUCUNE carte n'affiche de prix l'est aussi (LOT-SANS-PRIX) ; une seule carte qui affiche un prix et il reste compté
    let facturation, sansPrixRendu = false;
    if (lotInfo.identifiees === 0 && lotInfo.aTrancher === 0) {
        const r = await rendre('introuvable', toutesParLaGarde ? { compteur: 'jumeaux', unites: cartes.length } : {});          // lot entièrement refusé PAR LA GARDE (carte par carte, `every`) : une unité par carte ; constaté par le serveur, rendu sans plafond (PLAFOND-DECLARE)
        facturation = p.facturationDe('introuvable', { admin, rendu: r.rendu, question: false, cause: r.cause });
        if (!admin && !r.rendu) facturation = { ...facturation, debite: cout };          // remboursement refusé : le client a payé TOUT le lot, la facturation le dit
    } else if (!lotAfficheUnPrix(cartes, lectures)) {
        // LOT-SANS-PRIX : des cartes lues (ou à trancher), mais AUCUN prix affiché par aucune (ni guide, ni repli, ni candidat) : le lot est rendu en entier, par le MÊME chemin que le lot introuvable (`rendre` :
        // la claim `rb|scanId` — une fois par scan —, UN seul passage au plafond, chaque unité à SA poche). Le serveur seul constate qu'aucun prix n'est servi (le client n'a rien déclaré) : le compteur est celui des
        // CONSTATS, celui de `natureDuMotif('sans-prix')` comme pour un lot introuvable, jamais celui des déclarations. Motif de la liste fermée : `sans-prix` (l'unité n'est pas un « introuvable » : les cartes sont lues).
        if (admin) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });
        else {
            const r = await rendre('sans-prix');
            sansPrixRendu = r.rendu;
            facturation = r.rendu ? fabriquerFacturation({ debite: 0, rembourse: true, motif: 'sans-prix' })
                : fabriquerFacturation({ debite: cout, rembourse: false, motif: r.cause === 'plafond-jour' ? 'plafond-jour' : 'sans-prix', raisonNonRembourse: r.cause ?? 'erreur' });          // remboursement refusé : le client a payé TOUT le lot, la facturation le dit
        }
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
            const res = await panne('SERVEUR', Boolean(r && r.etat === 'remboursee') || sansPrixRendu);       // LOT-SANS-PRIX : un lot déjà rendu l'est (jamais « deja-rembourse » servi à un client rendu)
            // UN-CANDIDAT-2 : une fois le client RENDU, les lignes posées finissent dans un état terminal (lotIssue) : sans lui le balayage les rejugeait « analyse-absente » pour toujours (aucune ligne `analyses` n'existe).
            // Si le remboursement n'a PAS eu lieu, aucune décision n'est écrite : le lot reste visible de la réconciliation.
            if (res && res.sortie && res.sortie.facturation && res.sortie.facturation.rembourse) {
                try { await col('questions_v2').updateMany({ scanId, 'porteur.type': porteur.type, 'porteur.id': porteur.id, lot: true, lotIssue: { $exists: false } }, { $set: { lotIssue: { rendu: true, raison: 'reservation-echouee', le: new Date() } } }); }
                catch (e) { journal('décision du lot', e); }
            }
            return res;
        }
        // LOT-SANS-PRIX tour 1 (M1) : le lot est DÉJÀ rendu et toutes ses questions sont posées : la décision est écrite sur ses lignes (`lotIssue`, comme le fait le lot rendu après coup). Chaque réponse (OUI, NON, rejeu) redit alors
        // le remboursement fait (`rembourse: true`, motif `sans-prix`), sans rien débiter ni rendre une seconde fois ; le balayage ne rejuge pas un lot qui porte sa décision. Une écriture qui échoue laisse l'état d'avant (jamais une panne).
        if (sansPrixRendu) {
            try { await col('questions_v2').updateMany({ scanId, 'porteur.type': porteur.type, 'porteur.id': porteur.id, lot: true, lotIssue: { $exists: false } }, { $set: { lotIssue: { rendu: true, raison: 'sans-prix', motif: 'sans-prix', le: new Date() } } }); }
            catch (e) { journal('décision du lot sans prix', e); }
        }
    }
    const analyse = { statut: 'lot', cartes: ordonnerParValeur(cartes), lot: lotInfo, raison: null };
    return { sortie: { resultat: { issue: 'lot', analyse, erreur: null }, facturation, lecture: null, lectures, cartesEntree: cartes, motifs, desaccord: null } };
}

module.exports = { executerLot, ordonnerParValeur, compterLot, valeurDe, lotAfficheUnPrix };

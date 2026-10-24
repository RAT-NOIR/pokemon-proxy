'use strict';
// B1b.5 — POST /api/retour-live (Bearer) : le prix lu en direct par l'extension, et la lecture ratée.
// 🔑 Le prix est écrit par gererRetourLive d'index.js, INCHANGÉ (ses trois gardes, ses énumérations, sa déduction de la grille) : cette fonction ne les recopie pas,
// elle l'appelle avec l'identité v2 (`userId = v2:<type>:<id>`, celle que la chaîne héritée a écrite dans le journal du scan) et traduit sa réponse en forme du contrat 2.
// Ce que le contrat 2 AJOUTE :
//   · `verdictAffiche` et `lectureRatee { cause, definitive }` : listes fermées (400 sinon) ;
//   · une lecture ratée DÉFINITIVE rembourse (motif `sans-prix`), UNE fois par scan (le ledger refuse le second : `deja-rembourse`), sous le compteur des DÉCLARATIONS du client (PLAFOND-DECLARE :
//     un seul compteur par porteur et par jour de Paris avec « aucune », « ne-sait-pas » et l'abandon ; sans compte 1, gratuit 3, Pro 30) ; la réponse porte `declaration` (rendue, ou refusée par
//     `plafond-declarations`) ; une non définitive (un défi Cloudflare) ne rembourse rien ;
//   · REPLI-QUOTA : SAUF si cette même réponse sert un `prixRepli` — un prix est alors AFFICHÉ (prix-repli.js::afficheUnPrix, la seule règle) : le scan reste compté (`debite: 1`, `raisonNonRembourse: "prix-repli"`),
//     aucun remboursement n'est tenté, le plafond des déclarations n'est pas consommé ;
//   · un prix lu plus de 100 fois sous le guide du même produit est écrit `douteux: true` dans le journal : l'extension de la 1.0.5 renvoyait 1,18 € pour 1 180 €.
// Le scan d'un autre porteur n'existe pas : 404 (la route héritée dit 403, qui révélerait son existence).
const mongoose = require('mongoose');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const { fauxRes } = require('./captureres');
const { col } = require('../db');
const { colLue } = require('./catalogue');
const { facturation: fabriquerFacturation, raisonPublique } = require('../argent/facturation');
const { cartesParScanMax } = require('./cartes-par-scan');
const { offreSur, avecOffre } = require('../argent/offre-sur');
const { repliRetourLive, idConfirme, afficheUnPrix, avec: avecRepli } = require('./prix-repli');

const VERDICTS = Object.freeze(['bonne-affaire', 'correct', 'cher', 'aucun']);
const CAUSES = Object.freeze(['defi', 'blocage', 'grille-vide', 'sans-prix', 'sans-offre-reverse', 'onglet']);
const FORME_ID = /^[0-9a-f]{24}$/i;
const RAPPORT_DOUTEUX = 100;                     // « plus de 100 fois sous le guide »
// Les champs que gererRetourLive lit : ces champs-là sont transmis, rien d'autre.
const CHAMPS_PRIX = Object.freeze(['prixLive', 'prixLiveEtat', 'prixLiveCodeLangue', 'prixLiveTendance', 'prixLiveNM', 'originePrix', 'grilleLive', 'grilleNbEtats', 'grilleValeursDistinctes']);
const journalErreur = (ou, e) => console.error(`❌ [v2 retour-live] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);

// LA GARDE du remboursement `sans-prix`, écrite par ce qu'elle AUTORISE : la carte doit être IDENTIFIÉE — affirmée à l'analyse (statut `identifiee`), ou tranchée par une
// réponse (question `repondue` par un candidat, hors lot). Tout le reste bloque : question en attente (son crédit est RÉSERVÉ, il se règle par la réponse ou le balayage),
// abandonnée (déjà rendue), introuvable, lot (B1b.8 en décide), ligne analyses absente — « je ne peux pas conclure » n'est jamais « tout va bien ».
async function carteIdentifiee(porteur, scanId, carte) {
    const an = await col('analyses').findOne({ _id: scanId, porteur: `${porteur.type}:${porteur.id}` }, { projection: { cartes: 1, statut: 1 } });
    const e = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
    if (!e) return false;
    // B1b.8 (ruling 4) : la garde reste FERMÉE sur un lot, pour une carte identifiée comme pour une question. Un crédit de lot couvre jusqu'à 10 cartes : un prix manquant
    // sur l'une n'annule pas la lecture des autres, et rembourser ferait de chaque lot un levier borné par le seul plafond du jour. Seul un lot entièrement introuvable est rendu (lot.js).
    // Écrite par ce qu'elle AUTORISE : seules les analyses à UNE carte (`identifiee`, `a-trancher`) passent ; `lot` et tout statut inconnu bloquent.
    if (!['identifiee', 'a-trancher'].includes(an.statut)) return false;
    if (e.statut === 'identifiee') return true;
    if (e.statut !== 'a-trancher') return false;
    const q = await col('questions_v2').findOne({ _id: `${scanId}:${carte}`, 'porteur.type': porteur.type, 'porteur.id': porteur.id });
    if (q) return q.etat === 'repondue' && q.lot !== true && Boolean(q.reponse) && q.reponse.aucune === false && Number.isInteger(q.reponse.idProduct);
    // pas de question réservée : seul un administrateur (rien débité) est dans ce cas — sa réponse par un candidat est écrite sur la ligne analyses
    return Boolean(porteur.administrateur) && Boolean(e.reponse) && Number.isInteger(e.reponse.idProduct);
}

// La facturation d'une lecture ratée définitive, d'après ce que le ledger a rendu.
function facturationDeLecture(r) {
    if (r.rendu) return fabriquerFacturation({ debite: 0, rembourse: true, motif: 'sans-prix' });
    const raison = raisonPublique(r.raisonNonRembourse);
    if (raison === 'plafond-jour') return fabriquerFacturation({ debite: 1, rembourse: false, motif: 'plafond-jour', raisonNonRembourse: raison });
    if (raison === 'deja-rembourse' || raison === 'aucun-debit') return fabriquerFacturation({ debite: 0, rembourse: false, motif: 'sans-prix', raisonNonRembourse: raison });
    return fabriquerFacturation({ debite: 1, rembourse: false, motif: 'sans-prix', raisonNonRembourse: raison });
}

// PRIX-LISIBLE : le repli du retour de l'extension. La fiche (son `prixGuide`, tel que l'analyse l'a servi) et l'état retenu viennent de la ligne `analyses` de CE porteur ; la décision est celle de prix-repli.js.
// TOUR 1 (M-1) : le produit est CELUI QUE L'ANALYSE A CONFIRMÉ (prix-repli.js::idConfirme : carte identifiée, ou question répondue par un candidat) ; jamais le gagnant du journal ni un candidat : une carte à trancher n'a pas de repli.
async function repliDuRetour(porteur, scanId, carte, b, lr) {
    const an = await col('analyses').findOne({ _id: scanId, porteur: `${porteur.type}:${porteur.id}` }, { projection: { cartes: 1, produits: 1 } });
    const e = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
    const idProduct = idConfirme(e);
    if (idProduct === null) return null;
    const produit = Number.isInteger(idProduct) && Array.isArray(an.produits) ? an.produits.find(p => p && p.idProduct === idProduct) : null;
    return repliRetourLive({ prixGuide: produit ? produit.prixGuide : null, retenu: e.etat ? e.etat.retenu : null, lectureRatee: lr || null,
        originePrix: typeof b.originePrix === 'string' ? b.originePrix.trim().toLowerCase() : null, prixLive: Number(b.prixLive), prixLiveEtat: b.prixLiveEtat });
}

function traiterRetourLive(cfg, deps = {}) {
    return async function traiterRetourLiveV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        let argent;
        try { argent = registre.obtenir('argent'); if (!porteur || typeof deps.gererRetourLive !== 'function') throw new Error('montage incomplet'); }
        catch (e) { journalErreur('montage', e); return repondreErreur(res, 'INDISPONIBLE'); }
        const entreeInvalide = detail => repondreErreur(res, 'ENTREE', undefined, { detail });
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return entreeInvalide('corps');
        if (typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return entreeInvalide('scan-id');
        const carte = b.carte === undefined ? 0 : b.carte;
        if (!Number.isInteger(carte) || carte < 0 || carte >= cartesParScanMax(cfg)) return entreeInvalide('carte');
        if (b.verdictAffiche !== undefined && !VERDICTS.includes(b.verdictAffiche)) return entreeInvalide('verdict-affiche');
        const lr = b.lectureRatee;
        if (lr !== undefined && (!lr || typeof lr !== 'object' || Array.isArray(lr) || !CAUSES.includes(lr.cause) || typeof lr.definitive !== 'boolean')) return entreeInvalide('lecture-ratee');
        const aPrix = b.prixLive !== undefined && b.prixLive !== null;
        if (aPrix === (lr !== undefined)) return entreeInvalide(aPrix ? 'prix-et-lecture-ratee' : 'prix-ou-lecture-ratee');    // l'un ou l'autre, jamais les deux ni aucun
        const scanId = new mongoose.Types.ObjectId(b.scanId);
        const userId = `v2:${porteur.type}:${porteur.id}`;
        const soldeSur = async () => { try { return await argent.solde(porteur); } catch (e) { journalErreur('solde', e); return undefined; } };

        // le scan est-il à CE porteur ? (la ligne du journal hérité porte son userId v2) ; déjà complété => 409, avant tout effet
        let ligne;
        try { ligne = await col('journal_scans').findOne({ _id: scanId }, { projection: { userId: 1, prixLive: 1, idProduct: 1 } }); }
        catch (e) { journalErreur('journal', e); return repondreErreur(res, 'INDISPONIBLE'); }
        if (!ligne || ligne.userId !== userId) return repondreErreur(res, 'CODE_INVALIDE', 'Scan introuvable');
        if (ligne.prixLive != null) return repondreErreur(res, 'CONFLIT', 'Un prix live a déjà été renvoyé pour ce scan');

        let facturation = null, declaration = null;
        // PRIX-LISIBLE : le repli honnête (tendance et moyennes du guide, ou l'offre dans l'état le plus proche), SEULEMENT si la fiche a une donnée de prix ; sa panne ne casse jamais la réponse.
        // REPLI-QUOTA : calculé UNE SEULE FOIS par requête, et c'est CE repli qui décide du remboursement ET qui part dans la réponse (ce que le client voit et ce que le serveur facture ne peuvent pas diverger).
        let repli = null, repliCalcule = false;
        // `strict` (la DÉCISION d'une lecture ratée définitive) : un repli qu'on n'a pas pu calculer n'est pas « aucun repli » — on ne sait pas si un prix est affiché, donc l'erreur remonte (INDISPONIBLE, avant tout
        // remboursement). Sans `strict` (la réponse d'un prix lu, ou d'une lecture non définitive), l'échec reste une absence de repli : aucune décision d'argent n'en dépend.
        const calculerRepli = async ({ strict = false } = {}) => {
            if (repliCalcule) return repli;
            try { repli = await repliDuRetour(porteur, scanId, carte, b, lr); }
            catch (e) { journalErreur('repli', e); if (strict) throw e; repli = null; }
            repliCalcule = true;
            return repli;
        };
        if (aPrix) {
            // 1. le chemin hérité, inchangé : il valide, normalise et écrit (écriture conditionnelle : un second retour est refusé)
            const corps = { userId, scanId: b.scanId };
            for (const k of CHAMPS_PRIX) if (b[k] !== undefined) corps[k] = b[k];
            const fr = fauxRes();
            try { await deps.gererRetourLive({ body: corps, headers: {}, ip: req.ip }, fr); }
            catch (e) { journalErreur('chaîne héritée', e); return repondreErreur(res, 'SERVEUR'); }
            if (!fr.headersSent) return repondreErreur(res, 'SERVEUR');
            if (fr.statut !== 200) {
                const message = fr.corps && typeof fr.corps.error === 'string' ? fr.corps.error : undefined;
                if (fr.statut === 400) return repondreErreur(res, 'ENTREE', message, { detail: 'retour-live' });
                if (fr.statut === 404 || fr.statut === 403) return repondreErreur(res, 'CODE_INVALIDE', 'Scan introuvable');
                if (fr.statut === 409) return repondreErreur(res, 'CONFLIT', message);
                if (fr.statut === 503) return repondreErreur(res, 'INDISPONIBLE');
                return repondreErreur(res, 'SERVEUR');
            }
            // 5. un prix plus de 100 fois sous le guide du même produit est douteux : écrit, marqué, hors de tout verdict
            try {
                const an = await col('analyses').findOne({ _id: scanId, porteur: `${porteur.type}:${porteur.id}` }, { projection: { cartes: 1 } });
                const e = an && Array.isArray(an.cartes) ? an.cartes[carte] : null;
                const idProduct = (e && e.reponse && e.reponse.idProduct) ?? (e && e.idProduct) ?? ligne.idProduct;
                const guide = Number.isInteger(idProduct) ? await colLue('guide_prix').findOne({ idProduct }) : null;
                const reference = guide && Number(guide.trend) > 0 ? Number(guide.trend) : null;
                if (reference && reference / Number(b.prixLive) > RAPPORT_DOUTEUX * (1 + 1e-9))
                    await col('journal_scans').updateOne({ _id: scanId, userId }, { $set: { douteux: true, douteuxGuide: reference } });
            } catch (e) { journalErreur('douteux', e); }
        } else {
            if (lr.definitive) {
                let ok = false;
                try { ok = await carteIdentifiee(porteur, scanId, carte); } catch (e) { journalErreur('garde', e); return repondreErreur(res, 'INDISPONIBLE'); }
                if (!ok) return repondreErreur(res, 'CONFLIT', 'Cette carte n\'est pas identifiée : aucun remboursement sans-prix', { detail: 'carte-non-identifiee' });
            }
            try { await col('journal_scans').updateOne({ _id: scanId, userId, prixLive: null }, { $set: { lectureRatee: { cause: lr.cause, definitive: lr.definitive, le: new Date() } } }); }
            catch (e) { journalErreur('lecture ratée', e); }
            if (lr.definitive) {
                // I1 (relecture REPLI-QUOTA) : « je ne peux pas savoir si un prix est affiché » ne rembourse PAS et ne facture rien de plus : INDISPONIBLE, avant toute écriture de remboursement.
                // L'écriture `lectureRatee` ci-dessus est conditionnée par `prixLive: null` : un nouvel envoi après la panne rend la décision normale, une seule fois. (L'administrateur ne paie rien : pas de calcul.)
                let repliDecide = null;
                if (!porteur.administrateur) { try { repliDecide = await calculerRepli({ strict: true }); } catch (e) { return repondreErreur(res, 'INDISPONIBLE'); } }
                if (porteur.administrateur) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });
                // REPLI-QUOTA (décision de l'éditeur, 2026-10-24) : « Un scan qui AFFICHE un prix (même un repli avec mention) est une analyse rendue, donc il COMPTE dans le quota. Seuls les scans sans aucun
                // prix affiché gardent le remboursement « prix illisible ». » Ici la page n'a rien rendu ; si le serveur sert un repli dans CETTE réponse, un prix est affiché : le scan reste compté, aucun
                // remboursement n'est tenté — donc le plafond des déclarations du jour n'est PAS consommé (il ne l'est que par un remboursement jugé). La règle est afficheUnPrix (prix-repli.js), la même pour tous.
                else if (afficheUnPrix({ repli: repliDecide })) facturation = fabriquerFacturation({ debite: 1, rembourse: false, motif: 'sans-prix', raisonNonRembourse: 'prix-repli' });
                else {
                    let r;
                    // `credit` n'est lu que pour sa présence : le ledger juge sur les DÉBITS enregistrés de ce scan et de ce porteur, jamais sur l'objet présenté
                    // PLAFOND-DECLARE : un prix illisible DÉFINITIF est une DÉCLARATION du client (c'est l'extension qui dit « je n'ai pas pu lire »). Il partage le compteur des déclarations (sans compte 1, gratuit 3,
                    // Pro 30 par jour de Paris) avec « aucune », « ne-sait-pas » et l'abandon ; la réponse dit le jugement dans `declaration`.
                    try { r = await argent.rembourser(porteur, { poche: null }, 'sans-prix', { scanId, compteur: 'sans-prix' }); }
                    catch (e) { journalErreur('remboursement', e); return repondreErreur(res, 'INDISPONIBLE'); }
                    facturation = facturationDeLecture(r);
                    declaration = r.declaration || null;
                }
            }
        }
        const solde = await soldeSur(), offre = await offreSur(porteur, argent);      // OFFRE-QUOTA : relue APRÈS le remboursement `sans-prix` : l'unité rendue se voit
        await calculerRepli();      // PRIX-LISIBLE : déjà calculé pour une lecture ratée définitive (REPLI-QUOTA) ; sinon calculé ici, une fois
        return res.status(200).json({ success: true, facturation, ...(declaration ? { declaration } : {}), ...(solde !== undefined ? { solde } : {}), ...avecOffre(offre), ...avecRepli(repli) });
    };
}

module.exports = { traiterRetourLive, VERDICTS, CAUSES, facturationDeLecture, CHAMPS_PRIX };   // CHAMPS_PRIX : exporté pour que le banc d'abus confronte la garde des clés à tous les champs légitimes

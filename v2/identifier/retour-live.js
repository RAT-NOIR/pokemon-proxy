'use strict';
// B1b.5 — POST /api/retour-live (Bearer) : le prix lu en direct par l'extension, et la lecture ratée.
// 🔑 Le prix est écrit par gererRetourLive d'index.js, INCHANGÉ (ses trois gardes, ses énumérations, sa déduction de la grille) : cette fonction ne les recopie pas,
// elle l'appelle avec l'identité v2 (`userId = v2:<type>:<id>`, celle que la chaîne héritée a écrite dans le journal du scan) et traduit sa réponse en forme du contrat 2.
// Ce que le contrat 2 AJOUTE :
//   · `verdictAffiche` et `lectureRatee { cause, definitive }` : listes fermées (400 sinon) ;
//   · une lecture ratée DÉFINITIVE rembourse (motif `sans-prix`), UNE fois par scan (le ledger refuse le second : `deja-rembourse`), sous le compteur des QUESTIONS
//     (30/jour) ; une non définitive (un défi Cloudflare) ne rembourse rien ;
//   · un prix lu plus de 100 fois sous le guide du même produit est écrit `douteux: true` dans le journal : l'extension de la 1.0.5 renvoyait 1,18 € pour 1 180 €.
// Le scan d'un autre porteur n'existe pas : 404 (la route héritée dit 403, qui révélerait son existence).
const mongoose = require('mongoose');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const { fauxRes } = require('./captureres');
const { col } = require('../db');
const { colLue } = require('./catalogue');
const { facturation: fabriquerFacturation, raisonPublique } = require('../argent/facturation');

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
    if (an.statut === 'lot') return false;
    if (e.statut === 'identifiee') return true;
    if (e.statut !== 'a-trancher') return false;
    const q = await col('questions').findOne({ _id: `${scanId}:${carte}`, 'porteur.type': porteur.type, 'porteur.id': porteur.id });
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
        if (!Number.isInteger(carte) || carte < 0 || carte > 99) return entreeInvalide('carte');
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

        let facturation = null;
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
                if (porteur.administrateur) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });
                else {
                    let r;
                    // `credit` n'est lu que pour sa présence : le ledger juge sur les DÉBITS enregistrés de ce scan et de ce porteur, jamais sur l'objet présenté
                    try { r = await argent.rembourser(porteur, { poche: null }, 'sans-prix', { scanId, compteur: 'question' }); }
                    catch (e) { journalErreur('remboursement', e); return repondreErreur(res, 'INDISPONIBLE'); }
                    facturation = facturationDeLecture(r);
                }
            }
        }
        const solde = await soldeSur();
        return res.status(200).json({ success: true, facturation, ...(solde !== undefined ? { solde } : {}) });
    };
}

module.exports = { traiterRetourLive, VERDICTS, CAUSES };

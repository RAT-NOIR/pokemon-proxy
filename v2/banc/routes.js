'use strict';
// B6.3 — les lignes du banc réel : SEULEMENT ce qui est confirmé, RIEN d'identifiant.
// Écrit par ce qu'il AUTORISE : rien ne s'écrit sans (1) un consentement valide dans la requête (B6.1), (2) une image redressée ET une détection sûre fournies
// par l'appelant (le serveur ne détecte pas la carte : tant qu'elles manquent, rien n'est conservé), (3) le sel V2_BANC_SEL, (4) un stockage dont le bucket
// est celui de V2_BANC_BUCKET ET dont `verifierBucket()` (endpoint UE) a réussi AVANT la première écriture. Tout manque => rien, sans bruit côté client.
// Le document `banc_lignes` n'a que les clés listées dans DOC ; aucun scanId, compteId, installationId, IP, URL, titre, vendeur ne s'y écrit.
// Une écriture ratée ou lente ne touche jamais la réponse : chaque entrée publique ne lève pas et rend la main en TIMEOUT_MS au plus.
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('../db');
const { lireConsentement } = require('./consentement');
const S = require('./stockage');
const { repondreErreur } = require('../erreurs');

const { JOUR_MS, jourUTC, creerBorner, lignesEchues, supprimerObjetPuisLigne, consentementAutorise } = require('./commun');

const TIMEOUT_MS = 2000;
const FORME_ID = /^[0-9a-f]{24}$/i;
const CLES_DOC = Object.freeze(['_id', 'cleR2', 'etat', 'expireLe', 'jetonEmpreinte', 'le', 'source', 'verite', 'versionModele', 'versionTexte']);
const idProduitOk = n => Number.isSafeInteger(n) && n > 0;
const carteOk = c => Number.isInteger(c) && c >= 0 && c <= 99;
const modeleOk = m => (typeof m === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(m) ? m : null);
const ARRET = () => Object.assign(new Error('arrêt'), { code: 'ARRET' });

function creerBanc({ cfg, env = process.env, stockage = null, colFn = n => db.col(n), horloge = () => new Date(), delaiMs = TIMEOUT_MS } = {}) {
    let desactive = false, dit = false, pretP = null;
    const col = () => colFn('banc_lignes');
    // Le journal ne porte JAMAIS de contenu : un nom de cause fixe, ou le code de l'erreur — pas son message (il peut citer une clé, une URL).
    const dire = raison => { if (!dit) { dit = true; console.error(`⚠️ [v2 banc] banc désactivé pour ce processus : ${raison}`); } };
    const echec = (quoi, e) => { if (e && e.code === 'ARRET') return; console.error(`❌ [v2 banc] ${quoi} (${(e && (e.code || e.name)) || 'erreur'})`); };
    const sel = () => (typeof env.V2_BANC_SEL === 'string' && env.V2_BANC_SEL ? env.V2_BANC_SEL : null);
    // LE seul endroit où un scanId se normalise : en minuscules (une ObjectId s'écrit en hexadécimal, /reponse accepte aussi les majuscules).
    const idLigne = (scanId, carte) => crypto.createHash('sha256').update(`${String(scanId).toLowerCase()}|${carte}|${sel()}`).digest('hex');

    // Le stockage n'est rendu qu'après les contrôles d'environnement ET `verifierBucket()` réussi. Un échec désactive le banc pour le processus, dit une fois.
    function pret() {
        if (desactive) return Promise.resolve(null);
        if (!pretP) pretP = (async () => {
            if (!sel()) { desactive = true; dire('V2_BANC_SEL absente'); return null; }
            if (typeof env.V2_BANC_BUCKET !== 'string' || !env.V2_BANC_BUCKET) { desactive = true; dire('V2_BANC_BUCKET absente'); return null; }
            try {
                const s = stockage || S.creerStockageReel(env);
                // écrit par ce qu'on AUTORISE : un stockage qui ne sait pas vérifier son bucket (endpoint UE) n'écrit jamais
                if (!s || typeof s.verifierBucket !== 'function') throw new Error('verifierBucket absent');
                await s.verifierBucket();
                return s;
            } catch { desactive = true; dire('stockage non vérifié (bucket ou endpoint)'); return null; }
        })();
        return pretP;
    }

    // une attente bornée : rejette avec le code DELAI après delaiMs (le travail sous-jacent n'est pas annulé, son résultat est ignoré)
    const borner = creerBorner(delaiMs);
    async function supprimerObjets(ctx, s) {
        const st = s || stockage;
        const cles = ctx.objets.splice(0);
        for (const c of cles) { try { if (st) await st.supprimer(c); } catch { /* meilleur effort : le balayage reprend */ } }
        if (ctx.ligne) { try { await col().deleteOne({ _id: ctx.ligne.id, cleR2: ctx.ligne.cle }); } catch { /* idem */ } }
    }
    // Toute entrée publique passe ici : ne lève jamais, rend la main en delaiMs au plus ; au dépassement, ce qu'elle avait écrit est défait.
    async function borne(travail) {
        const ctx = { stop: false, objets: [], ligne: null, stockage: null };
        let minuteur;
        const delai = new Promise(r => { minuteur = setTimeout(() => { ctx.stop = true; r('delai'); }, delaiMs); if (minuteur.unref) minuteur.unref(); });
        const fait = (async () => {
            try { await travail(ctx); }
            catch (e) { echec('opération ratée', e); try { await supprimerObjets(ctx, ctx.stockage); } catch { /* rien */ } }
            return 'fait';
        })();
        try {
            const r = await Promise.race([fait, delai]);
            if (r === 'delai') { console.error('❌ [v2 banc] délai dépassé, opération abandonnée'); supprimerObjets(ctx, ctx.stockage).catch(() => { }); }
        } catch (e) { echec('opération ratée', e); }
        finally { clearTimeout(minuteur); }
    }

    function nouvelleLigne({ scanId, carte, source, etat, verite, c, versionModele, cleR2 }) {
        // `le` est TRONQUÉ au jour (UTC) : une date à la milliseconde rejoindrait la ligne à analyses.creeLe / mouvements, donc à un porteur.
        // (La date de dernière modification de l'objet R2 garde l'heure : corrélation résiduelle, opérateur seulement, bornée par la rétention de `analyses`.)
        const now = jourUTC(horloge());
        return {
            _id: idLigne(scanId, carte), verite, source, etat, versionModele: modeleOk(versionModele), versionTexte: c.version, le: now,
            jetonEmpreinte: c.jetonEmpreinte, cleR2, expireLe: new Date(now.getTime() + cfg.retention.bancMois * 30.5 * JOUR_MS)
        };
    }
    const identiteOk = o => o && typeof o.scanId === 'string' && o.scanId.length > 0 && o.scanId.length <= 64 && carteOk(o.carte === undefined ? 0 : o.carte);
    const carteDe = o => (o.carte === undefined ? 0 : o.carte);

    // attente → confirmée (réponse ou correction) : l'objet passe de attente/ à son emplacement final ; l'ancien n'est supprimé qu'une fois la ligne à jour.
    async function confirmer(ctx, s, ligne, verite, source) {
        const ancienne = ligne.cleR2;
        if (/\/attente\//.test(String(ancienne))) {
            const buf = await s.lire(ancienne);
            if (ctx.stop) throw ARRET();
            const finale = S.nouvelleCle(false);
            await s.ecrire(finale, buf); ctx.objets.push(finale);
            if (ctx.stop) throw ARRET();
            // La mise à jour est ÉMISE : dès maintenant la copie finale ne se défait plus à l'aveugle (délai, erreur) — Mongo a pu l'appliquer.
            ctx.objets.splice(0);
            let r = null;
            try { r = await col().updateOne({ _id: ligne._id, etat: 'attente', cleR2: ancienne }, { $set: { verite, source, etat: 'confirmee', cleR2: finale } }); }
            catch (e) { echec('confirmation ambiguë', e); }
            const suppr = async (cle, quoi) => { try { await s.supprimer(cle); } catch (e) { echec(quoi, e); } };
            if (r && r.modifiedCount) return suppr(ancienne, 'objet d\'attente non supprimé');          // la ligne porte la copie finale
            if (r) return suppr(finale, 'copie finale non supprimée');                                  // rien modifié : une autre réponse a gagné
            // issue inconnue : la ligne, relue, décide ; si la relecture échoue aussi, on GARDE les deux objets (un orphelin vaut mieux qu'une ligne qui ment)
            let l;
            try { l = await col().findOne({ _id: ligne._id }); } catch (e) { echec('relecture impossible, objets gardés', e); return; }
            if (l && l.cleR2 === finale) return suppr(ancienne, 'objet d\'attente non supprimé');
            if (l && l.cleR2 === ancienne) return suppr(finale, 'copie finale non supprimée');
            echec('issue inconnue, objets gardés', null);
        } else {
            await col().updateOne({ _id: ligne._id }, { $set: { verite, source, etat: 'confirmee' } });
        }
    }

    const api = {
        /** Après un verdict : `affirmee` => ligne confirmée ; `question` => ligne en attente. Toute autre issue (introuvable, panne, refus) => rien. */
        async apresVerdict(o) {
            try {
                if (!o || typeof o !== 'object') return;
                const c = lireConsentement(o.corps, cfg, horloge());
                if (!c.valide) return;
                if (o.issue !== 'affirmee' && o.issue !== 'question') return;
                if (o.detectionSure !== true || !Buffer.isBuffer(o.imageRedressee) || !identiteOk(o)) return;
                if (o.issue === 'affirmee' && !idProduitOk(o.idProduct)) return;
                const carte = carteDe(o), attente = o.issue === 'question';
                await borne(async ctx => {
                    const s = await pret(); if (!s || ctx.stop) return;
                    ctx.stockage = s;
                    let t; try { t = await S.traiterImage(o.imageRedressee); } catch { return; }       // image refusée : rien, sans bruit
                    if (ctx.stop) return;
                    const cle = S.nouvelleCle(attente);
                    await s.ecrire(cle, t.buffer); ctx.objets.push(cle);
                    if (ctx.stop) throw ARRET();
                    const d = nouvelleLigne({ scanId: o.scanId, carte, source: attente ? 'reponse' : 'affirme', etat: attente ? 'attente' : 'confirmee', verite: attente ? null : o.idProduct, c, versionModele: o.versionModele, cleR2: cle });
                    ctx.ligne = { id: d._id, cle };
                    try { await col().insertOne(d); }
                    catch (e) { ctx.ligne = null; if (e && e.code === 11000) { await supprimerObjets(ctx, s); return; } throw e; }   // au plus une ligne par (scanId, carte)
                    if (ctx.stop) throw ARRET();
                    ctx.objets.splice(0); ctx.ligne = null;
                });
            } catch (e) { echec('apresVerdict', e); }
        },
        /** Une réponse par un candidat : attente → confirmée. `aucune` / `ne-sait-pas` : un abandon. */
        async apresReponse(o) {
            try {
                if (!o || typeof o !== 'object') return;
                if (o.choix === 'aucune' || o.choix === 'ne-sait-pas') return api.apresAbandon(o);
                const c = lireConsentement(o.corps, cfg, horloge());
                if (!c.valide || !identiteOk(o) || !idProduitOk(o.idProduct)) return;
                await borne(async ctx => {
                    const s = await pret(); if (!s || ctx.stop) return;
                    ctx.stockage = s;
                    const ligne = await col().findOne({ _id: idLigne(o.scanId, carteDe(o)) });
                    if (!ligne || ligne.etat !== 'attente' || ligne.jetonEmpreinte !== c.jetonEmpreinte) return;
                    await confirmer(ctx, s, ligne, o.idProduct, 'reponse');
                });
            } catch (e) { echec('apresReponse', e); }
        },
        /** Abandon (`aucune`, `ne-sait-pas`) : l'objet d'abord, la ligne ensuite ; seulement une ligne encore en attente. Ne demande pas de consentement : effacer n'est jamais conserver. */
        async apresAbandon(o) {
            try {
                if (!identiteOk(o)) return;
                await borne(async ctx => {
                    const s = await pret(); if (!s || ctx.stop) return;
                    const ligne = await col().findOne({ _id: idLigne(o.scanId, carteDe(o)) });
                    if (!ligne || ligne.etat !== 'attente') return;
                    // la définition COMMUNE « objet puis ligne » (si l'objet ne part pas la ligne reste ; la ligne porte sa cleR2 et reste en attente au moment de partir)
                    await supprimerObjetPuisLigne(s, ligne, col, borner, { etat: 'attente' });
                });
            } catch (e) { echec('apresAbandon', e); }
        },
        /** Correction : seulement sur une ligne EXISTANTE (une image a été conservée pour ce scan), consentement valide ET du même jeton que la ligne. */
        async corriger(o) {
            try {
                if (!o || typeof o !== 'object') return;
                const c = lireConsentement(o.corps, cfg, horloge());
                if (!c.valide || !identiteOk(o) || !idProduitOk(o.idProduct)) return;
                await borne(async ctx => {
                    const s = await pret(); if (!s || ctx.stop) return;
                    ctx.stockage = s;
                    const ligne = await col().findOne({ _id: idLigne(o.scanId, carteDe(o)) });
                    if (!ligne || ligne.jetonEmpreinte !== c.jetonEmpreinte) return;
                    await confirmer(ctx, s, ligne, o.idProduct, 'correction');
                });
            } catch (e) { echec('corriger', e); }
        },
        /** Les lignes en attente depuis plus de 24 h : objet d'abord, ligne ensuite (une suppression d'objet ratée garde la ligne). Rappelée par la purge de B6.4. */
        async balayerAttente(maintenant = horloge()) {
            const bilan = { supprimees: 0, echecs: 0 };
            try {
                // Chaque attente est bornée (delaiMs) : un R2 ou un Mongo qui pend ne bloque pas l'appelant (la purge), et la ligne d'un objet
                // dont la suppression n'a pas abouti est GARDÉE. `le` est tronqué au jour : « plus de 24 h » se lit au jour (jamais avant 24 h réelles).
                const s = await borner(pret()); if (!s) return bilan;
                const vieilles = await lignesEchues(col, maintenant, borner, { attenteSeulement: true });
                for (const l of vieilles) {
                    const r = await supprimerObjetPuisLigne(s, l, col, borner);      // la définition PARTAGÉE : une ligne confirmée entre-temps n'est jamais supprimée
                    if (r === 'supprimee') bilan.supprimees++; else if (r === 'echec') bilan.echecs++;
                }
            } catch (e) { echec('balayerAttente', e); }
            return bilan;
        },
        statistiquesBanc: () => statistiquesBanc(colFn),
        _desactive: () => desactive,
    };
    return api;
}

/** Le biais est écrit : le DÉNOMINATEUR par source (jamais un taux global). Aucune donnée individuelle. */
async function statistiquesBanc(colFn = n => db.col(n)) {
    const rows = await colFn('banc_lignes').aggregate([{ $group: { _id: { source: '$source', etat: '$etat' }, n: { $sum: 1 } } }]).toArray();
    const out = { confirmees: { affirme: 0, reponse: 0, correction: 0 }, attente: 0, total: 0 };
    for (const r of rows) {
        out.total += r.n;
        if (r._id.etat === 'attente') out.attente += r.n;
        else if (r._id.source in out.confirmees) out.confirmees[r._id.source] += r.n;
    }
    return out;
}

/** POST /api/banc/correction { scanId, carte = 0, consentementBanc, idProduct } (Bearer). 200 { success:true } quoi qu'il arrive APRÈS les contrôles : la route ne dit pas si la conservation a eu lieu. */
function traiterCorrection(cfg, banc) {
    return async function traiterCorrectionV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        if (!porteur) return repondreErreur(res, 'INDISPONIBLE');
        const entree = detail => repondreErreur(res, 'ENTREE', undefined, { detail });
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return entree('corps');
        if (typeof b.scanId !== 'string' || !FORME_ID.test(b.scanId)) return entree('scan-id');
        const carte = b.carte === undefined ? 0 : b.carte;
        if (!carteOk(carte)) return entree('carte');
        if (!idProduitOk(b.idProduct)) return entree('id-product');
        let an;
        try { an = await db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(b.scanId), porteur: `${porteur.type}:${porteur.id}` }); }
        catch (e) { echec404('analyses', e); return repondreErreur(res, 'INDISPONIBLE'); }
        if (!an || !Array.isArray(an.cartes) || !an.cartes[carte]) return repondreErreur(res, 'CODE_INVALIDE', 'Scan introuvable');   // l'analyse d'un autre porteur n'existe pas
        // un jeton de consentement égal au jeton d'accès relierait la ligne à l'installation : rien n'est conservé, sans le dire (comme un consentement invalide)
        if (await consentementAutorise(req, cfg)) await banc.corriger({ corps: b, scanId: b.scanId, carte, idProduct: b.idProduct });
        return res.status(200).json({ success: true });
    };
}
const echec404 = (quoi, e) => console.error(`❌ [v2 banc] ${quoi} (${(e && (e.code || e.name)) || 'erreur'})`);

module.exports = { creerBanc, statistiquesBanc, traiterCorrection, TIMEOUT_MS, CLES_DOC };

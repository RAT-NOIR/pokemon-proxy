'use strict';
// Aide des bancs OFFRE-QUOTA (pas un banc : le préfixe _ l'écarte). Les bancs écrits pour les poches de crédits (essai, accueil, hebdo, abonnement, achete) fabriquaient un « solde » de N crédits
// et regardaient ce solde baisser. Le quota quotidien n'a pas de stock, mais l'arithmétique est la même : un porteur à 1000 par jour (le plafond le plus haut que la configuration accepte)
// dont le compteur du jour est déjà à 1000 - N a EXACTEMENT N analyses devant lui. `poserRestant` le fabrique ; `restantDe` le relit. Le jour est celui de Paris, AU MOMENT de l'appel
// (les routes datent avec `new Date()`) : `eviterMinuit` attend si minuit de Paris tombe entre le semis et la requête (même précaution que H.eviterFrontieres pour les frontières UTC).
const db = require('../db'); const Of = require('../argent/offre'); const { lireConfig } = require('../config');
const GRAND = 1000;
const jourCourant = (d = new Date()) => Of.jourDeParis(d);
/** Une configuration où gratuit, sans compte et Pro valent GRAND par jour (le stock de départ d'un banc) ; `o` surcharge. */
const cfgGrand = (o = {}) => lireConfig({ MONGODB_BASE: 'test_scratch', V2_QUOTA_GRATUIT: String(GRAND), V2_QUOTA_SANS_COMPTE: String(GRAND), V2_QUOTA_PRO_PLAFOND: String(GRAND), ...o });
/** Le porteur a désormais exactement `n` analyses devant lui aujourd'hui (compteur du jour = GRAND - n). `cle` : « compte:<id> » ou « installation:<id> ». */
async function poserRestant(cle, n, { limite = GRAND, jour = jourCourant() } = {}) {
    await db.col('quota_jour').updateOne({ porteur: cle, jour }, { $set: { count: limite - n }, $setOnInsert: { expireLe: new Date(Date.now() + 3 * 86400e3) } }, { upsert: true });
}
/** Le compteur du jour (null si aucun). */
async function prisAujourdhui(cle, jour = jourCourant()) { const d = await db.col('quota_jour').findOne({ porteur: cle, jour }); return d ? d.count : null; }
/** Ce qu'il reste au porteur aujourd'hui, par la MÊME fonction que les routes (`offre.restant`). `p` : { type, id }. */
async function restantDe(p, cfg = cfgGrand(), maintenant = new Date()) { return (await Of.offre({ type: p.type, id: p.id, administrateur: false }, cfg, maintenant)).restant; }
/** Si minuit de Paris tombe dans `margeMs`, on l'attend (au plus margeMs + 2 s) : un compteur semé avant minuit ne se lit pas après. */
async function eviterMinuit(margeMs = 240e3) {
    const reste = Of.prochainMinuitParis(new Date()).instant.getTime() - Date.now();
    if (!(reste < margeMs)) return 0;
    console.log(`   minuit de Paris dans ${Math.round(reste / 1000)} s : attente avant de jouer`);
    await new Promise(r => setTimeout(r, reste + 2000));
    return reste + 2000;
}
/** REPLI-QUOTA : la fiche du scan n'a AUCUNE donnée de prix (`prixGuide` null sur chaque produit de la ligne `analyses`) : aucun `prixRepli` ne peut être servi, donc le remboursement « prix illisible »
 *  d'avant s'applique (un scan qui AFFICHE un repli compte, voir prix-repli.js::afficheUnPrix). Les bancs qui éprouvent le REMBOURSEMENT d'une lecture ratée définitive posent cet état avant d'envoyer. */
async function sansDonneeDePrix(scanId) {
    const _id = typeof scanId === 'string' ? new (require('mongoose').Types.ObjectId)(scanId) : scanId;
    const r = await db.col('analyses').updateOne({ _id }, { $set: { 'produits.$[].prixGuide': null } });
    if (!r || r.matchedCount !== 1) throw new Error('sansDonneeDePrix : ligne analyses introuvable');
}
module.exports = { GRAND, jourCourant, cfgGrand, poserRestant, prisAujourdhui, restantDe, eviterMinuit, sansDonneeDePrix };

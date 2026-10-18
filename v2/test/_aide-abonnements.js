'use strict';
// Aide des bancs STRIPE-V2 (pas un banc : le préfixe _ l'écarte). Une configuration d'abonnements COMPLÈTE avec des valeurs de banc (aucune ne ressemble à un vrai secret), un serveur qui monte la
// route de webhook AVANT express.json() comme le fait la v2, des événements signés par l'API du SDK, et des objets Subscription de la forme que Stripe sert.
const express = require('express');
const Stripe = require('../../node_modules/stripe');
const { lireConfig } = require('../config');
const H = require('./_harnais');
const db = require('../db'); const M = require('../modeles'); const pret = require('../pret'); const { verifierIndex } = require('../modeles');

const SECRET = 'whsec_bancfauxbancfaux';
const PRIX = Object.freeze({ proMois: 'price_BANCproMois', proAn: 'price_BANCproAn', fondMois: 'price_BANCfondMois', fondAn: 'price_BANCfondAn' });
const CODE_FONDATEURS = 'FONDATEURS-BANC-2026';
const ENV = Object.freeze({
    MONGODB_BASE: 'test_scratch', V2_ABONNEMENTS: '1', V2_STRIPE_MODE: 'test', V2_STRIPE_CLE: 'sk_test_' + 'BANCfauxBANCfaux', V2_STRIPE_WEBHOOK_SECRET: SECRET, V2_STRIPE_PORTAIL_CONFIG_PRO: 'bpc_BANCpro', V2_STRIPE_PORTAIL_CONFIG_FONDATEURS: 'bpc_BANCfond',
    V2_STRIPE_PRIX_PRO_MOIS: PRIX.proMois, V2_STRIPE_PRIX_PRO_AN: PRIX.proAn, V2_STRIPE_PRIX_FONDATEURS_MOIS: PRIX.fondMois, V2_STRIPE_PRIX_FONDATEURS_AN: PRIX.fondAn,
    V2_FONDATEURS_CODE: CODE_FONDATEURS, V2_FONDATEURS_PLACES: '3', V2_HEBDO: '0'
});
const cfgAbo = (surcharge = {}) => lireConfig({ ...ENV, ...surcharge });

/** Un serveur avec le webhook (corps brut) AVANT le JSON, puis les routes des lots demandés. */
async function serveur(cfg, lots = [require('../transport/monter'), require('../argent/monter')]) {
    const app = express(); app.set('trust proxy', true);
    for (const l of lots) l.enTete(app, cfg);                    // comme V2.monterEnTete : avant express.json()
    app.use(express.json());
    const { assembler } = require('../index');
    pret.armer(() => verifierIndex(Boolean(cfg.abonnements && cfg.abonnements.actif)));      // comme v2/index.js
    app.use(assembler(lots, cfg, {}));
    return H.serveur(app);
}
const signer = (corps, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) => Stripe.webhooks.generateTestHeaderString({ payload: corps, secret, timestamp });
/** Livre un événement signé au webhook (corps brut). */
async function livrer(url, evt, { secret = SECRET, signature, corps, chemin = '/api/webhook-stripe-v2', timestamp } = {}) {
    const texte = corps !== undefined ? corps : JSON.stringify(evt);
    const entetes = { 'content-type': 'application/json' };
    const sig = signature === undefined ? signer(texte, secret, timestamp) : signature;
    if (sig !== null) entetes['stripe-signature'] = sig;
    const r = await fetch(url + chemin, { method: 'POST', headers: entetes, body: texte });
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* corps non JSON */ }
    return { statut: r.status, json };
}
let nEvt = 0;
const evenement = (type, objet, created, extra = {}) => ({ id: `evt_banc${String(++nEvt).padStart(5, '0')}`, object: 'event', type, created, livemode: false, data: { object: objet }, api_version: Stripe.API_VERSION, ...extra });
/** Un objet Subscription de la forme récente (les dates de période sur la ligne). */
function sub({ id = 'sub_banc1', client = 'cus_banc1', statut = 'active', prixId = PRIX.proMois, fin, debut, trialEnd = null, created = null, metadata = {}, cancelAtPeriodEnd = false, cancelAt = null, endedAt = null, formeRecente = true, lookup = null } = {}) {
    const item = { id: 'si_1', price: { id: prixId, ...(lookup ? { lookup_key: lookup } : {}) }, ...(formeRecente ? { current_period_start: debut ?? fin - 2592000, current_period_end: fin } : {}) };
    const o = { id, object: 'subscription', customer: client, status: statut, created: created ?? (fin - 2592000), trial_start: trialEnd ? (created ?? fin - 2592000) : null, trial_end: trialEnd, cancel_at_period_end: cancelAtPeriodEnd,
        cancel_at: cancelAt, ended_at: endedAt, metadata, items: { object: 'list', data: [item] }, discounts: [], livemode: false };
    if (!formeRecente) { o.current_period_start = debut ?? fin - 2592000; o.current_period_end = fin; }
    return o;
}
/** Les quatre prix de la configuration de banc, connus du faux Stripe (montants en centimes, EUR). */
function semerPrix(faux) {
    const defs = [[PRIX.proMois, 499, 'month', 'pro_mois'], [PRIX.proAn, 3900, 'year', 'pro_an'], [PRIX.fondMois, 299, 'month', 'fondateurs_mois'], [PRIX.fondAn, 2900, 'year', 'fondateurs_an']];
    for (const [id, montant, intervalle, cle] of defs) faux.E.prix.push({ id, object: 'price', active: true, currency: 'eur', unit_amount: montant, recurring: { interval: intervalle }, lookup_key: `rm_v2_${cle}` });
}
const maintenantS = () => Math.floor(Date.now() / 1000);
/** Un compte vérifié, sa session (le cookie) : { compte, cookie, id }. */
async function compteConnecte(o = {}) {
    const S = require('../comptes/sessions');
    const n = Math.random().toString(36).slice(2, 10);
    const c = M.nouveauCompte({ email: `abo-${n}@exemple.fr`, emailCle: `abo-${n}@exemple.fr`, motDePasse: {} }); Object.assign(c, { verifie: true, verifieLe: new Date() }, o);
    await db.col('comptes').insertOne(c);
    const s = await S.creerSession(c._id);
    return { id: c._id, compte: c, cookie: `rm_session=${s.token}`, porteur: { type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: false } };
}
const lireCompte = id => db.col('comptes').findOne({ _id: id });
const SITE = { origin: 'https://rat-market.fr', 'x-rat-market': '1' };
/** Une place Fondateurs PRISE par ce compte (ce qu'un abonnement Fondateurs légitime a déjà fait par le Checkout). */
async function placePrise(compteId) { await db.col('abo_places').insertOne({ _id: `place:banc${Math.random().toString(36).slice(2, 9)}`, compteId, etat: 'prise', priseLe: new Date() }); }
const MARGE_S = 48 * 3600;
module.exports = { placePrise, MARGE_S, SECRET, PRIX, CODE_FONDATEURS, ENV, cfgAbo, serveur, signer, livrer, evenement, sub, semerPrix, maintenantS, compteConnecte, lireCompte, SITE };

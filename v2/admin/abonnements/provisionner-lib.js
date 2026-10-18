'use strict';
// LE PROVISIONNEMENT STRIPE (mode TEST seulement dans ce lot) — IDEMPOTENT : relancé, il ne crée RIEN de plus.
//   · deux PRODUITS (Rat-Market Pro, Rat-Market Fondateurs) retrouvés par leur métadonnée `rm_cle` ; quatre PRIX retrouvés par leur `lookup_key` ; l'endpoint de webhook retrouvé par son URL ;
//     la configuration du portail retrouvée par sa métadonnée. On ne touche JAMAIS à un objet qui ne porte pas nos marques : les quatre produits de packs (« Rat-Market — 20, 50, 100, 200 scans »)
//     ne sont ni listés pour modification ni mis à jour — le code n'a aucun chemin qui prenne un produit par son nom ou son rang.
//   · un prix est IMMUABLE chez Stripe : s'il existe avec un autre montant, une autre devise ou un autre intervalle, on s'ARRÊTE et on le dit (jamais de remplacement silencieux).
//   · le SECRET de l'endpoint n'existe qu'à sa création : il est remis à `poserSurRender(nomDeVariable, valeur)` et ne va nulle part ailleurs (ni affiché, ni écrit, ni retourné). Si la pose échoue,
//     l'endpoint qu'on vient de créer est SUPPRIMÉ (il n'a aucun secret conservé) : le prochain passage le recrée proprement.
//   · le fichier local de sortie ne porte que des identifiants non secrets ; il est contrôlé avant l'écriture (aucune forme de clé ni de secret).
const O = require('../../abonnements/offres');
const EVENEMENTS = Object.freeze(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);
const CLE_PORTAIL = 'rat-market-v2';                       // la marque de la configuration UNIQUE du premier jet (retrouvée seulement pour être désactivée) et de l'endpoint
const clePortail = offre => `rat-market-v2-portail-${offre}`;
const NOM_VARIABLE_SECRET = 'V2_STRIPE_WEBHOOK_SECRET';
const FORME_SECRET = /\b(whsec|sk_test|sk_live|rk_test|rk_live)_[A-Za-z0-9]/;
const VARIABLES_PRIX = Object.freeze({ 'rm_v2_pro_mois': 'V2_STRIPE_PRIX_PRO_MOIS', 'rm_v2_pro_an': 'V2_STRIPE_PRIX_PRO_AN', 'rm_v2_fondateurs_mois': 'V2_STRIPE_PRIX_FONDATEURS_MOIS', 'rm_v2_fondateurs_an': 'V2_STRIPE_PRIX_FONDATEURS_AN' });

async function toutLister(fn, params) {                                   // pagination par curseur, bornée
    const sortie = []; let apres = null;
    for (let page = 0; page < 20; page++) {
        const r = await fn({ ...params, limit: 100, ...(apres ? { starting_after: apres } : {}) });
        sortie.push(...r.data);
        if (!r.has_more || !r.data.length) return sortie;
        apres = r.data[r.data.length - 1].id;
    }
    throw new Error('provisionnement : plus de 2000 objets, liste refusée');
}
/** @returns le plan et, si `ecrire`, l'exécution. `trace(msg)` reçoit des lignes SANS valeur secrète. */
async function provisionner({ stripe, site, urlWebhook, versionApi, ecrire = false, avecWebhook = true, poserSurRender, trace = () => { } }) {
    const rapport = { crees: [], retrouves: [], miseAJour: [], secretPose: false, ids: { produits: {}, prix: {}, webhook: null, portail: { pro: null, fondateurs: null } } };
    const marque = (genre, nom) => { (genre === 'cree' ? rapport.crees : genre === 'maj' ? rapport.miseAJour : rapport.retrouves).push(nom); trace(`${genre === 'cree' ? 'créé' : genre === 'maj' ? 'mis à jour' : 'retrouvé'} : ${nom}`); };
    if (!/^https:\/\/[^\s/]+$/.test(site)) throw new Error('provisionnement : site attendu sous la forme https://hôte (sans chemin)');
    if (!/^https:\/\/\S+\/api\/webhook-stripe-v2$/.test(urlWebhook)) throw new Error('provisionnement : l\'URL du webhook doit se terminer par /api/webhook-stripe-v2');
    if (!ecrire) trace('SIMULATION : rien ne sera écrit (relancer avec --ecrire)');

    // ── produits ──
    const produits = await toutLister(p => stripe.products.list(p), { active: true });
    for (const offre of O.OFFRES) {
        const cle = O.cleProduit(offre), trouves = produits.filter(p => p.metadata && p.metadata.rm_cle === cle);
        if (trouves.length > 1) throw new Error(`provisionnement : ${trouves.length} produits portent la marque ${cle} (ambigu, rien n'est touché)`);
        if (trouves.length === 1) {
            rapport.ids.produits[offre] = trouves[0].id; marque('trouve', `produit ${O.CATALOGUE[offre].nom}`);
            if (trouves[0].name !== O.CATALOGUE[offre].nom && ecrire) { await stripe.products.update(trouves[0].id, { name: O.CATALOGUE[offre].nom }); marque('maj', `produit ${offre} (nom)`); }
        } else if (!ecrire) { rapport.ids.produits[offre] = `(à créer : ${O.CATALOGUE[offre].nom})`; trace(`à créer : produit ${O.CATALOGUE[offre].nom}`); }
        else {
            const p = await stripe.products.create({ name: O.CATALOGUE[offre].nom, metadata: { rm_cle: cle, rm_lot: 'stripe-v2' } }, { idempotencyKey: `rm-v2-produit-${offre}` });
            rapport.ids.produits[offre] = p.id; marque('cree', `produit ${O.CATALOGUE[offre].nom}`);
        }
    }
    // ── prix ──
    for (const offre of O.OFFRES) for (const periode of O.PERIODES) {
        const lk = O.lookupKey(offre, periode), attendu = O.CATALOGUE[offre].prix[periode];
        const trouves = (await stripe.prices.list({ lookup_keys: [lk], active: true, limit: 10 })).data;
        if (trouves.length > 1) throw new Error(`provisionnement : ${trouves.length} prix actifs portent la clé ${lk}`);
        if (trouves.length === 1) {
            const p = trouves[0], produitAttendu = rapport.ids.produits[offre];
            const ecartDe = [p.unit_amount !== attendu && 'montant', p.currency !== O.DEVISE && 'devise', !p.recurring || p.recurring.interval !== O.INTERVALLE[periode] || (p.recurring.interval_count ?? 1) !== 1 ? 'intervalle' : null, p.product !== produitAttendu && ecrire && 'produit'].filter(Boolean);
            if (ecartDe.length) throw new Error(`provisionnement : le prix ${lk} existe mais diffère (${ecartDe.join(', ')}) — un prix est immuable, rien n'est modifié ; à traiter à la main`);
            rapport.ids.prix[lk] = p.id; marque('trouve', `prix ${lk}`);
        } else if (!ecrire) { rapport.ids.prix[lk] = '(à créer)'; trace(`à créer : prix ${lk} (${attendu / 100} EUR / ${O.INTERVALLE[periode]})`); }
        else {
            const p = await stripe.prices.create({ product: rapport.ids.produits[offre], currency: O.DEVISE, unit_amount: attendu, recurring: { interval: O.INTERVALLE[periode] }, lookup_key: lk, nickname: `${O.CATALOGUE[offre].nom} — ${periode === 'mois' ? 'mensuel' : 'annuel'}`, metadata: { rm_cle: lk, rm_lot: 'stripe-v2' } }, { idempotencyKey: `rm-v2-prix-${lk}` });
            rapport.ids.prix[lk] = p.id; marque('cree', `prix ${lk}`);
        }
    }
    // ── endpoint de webhook — EN DERNIER : c'est la seule étape qui crée un secret, donc la seule dont un échec en amont ne doit pas laisser de reste ──
    const faireWebhook = async () => {
    const existants =(await toutLister(p => stripe.webhookEndpoints.list(p), {})).filter(e => e.url === urlWebhook);
    if (existants.length > 1) throw new Error('provisionnement : plusieurs endpoints pour la même URL (rien n\'est touché)');
    if (existants.length === 1) {
        const e = existants[0]; rapport.ids.webhook = e.id; marque('trouve', 'endpoint de webhook');
        const memes = e.enabled_events.length === EVENEMENTS.length && EVENEMENTS.every(x => e.enabled_events.includes(x));
        if (!memes && ecrire) { await stripe.webhookEndpoints.update(e.id, { enabled_events: [...EVENEMENTS] }); marque('maj', 'endpoint de webhook (événements)'); }
        if (e.status !== 'enabled' && ecrire) { await stripe.webhookEndpoints.update(e.id, { disabled: false }); marque('maj', 'endpoint de webhook (activé)'); }
        trace('le secret de cet endpoint n\'est plus lisible chez Stripe : il a été posé à sa création (s\'il a été perdu, supprimer l\'endpoint dans le tableau de bord Test et relancer)');
    } else if (!ecrire) { rapport.ids.webhook = '(à créer)'; trace(`à créer : endpoint de webhook ${urlWebhook} (${EVENEMENTS.length} événements)`); }
    else {
        if (typeof poserSurRender !== 'function') throw new Error('provisionnement : poserSurRender est exigé pour créer l\'endpoint (son secret n\'a aucun autre destinataire)');
        const e = await stripe.webhookEndpoints.create({ url: urlWebhook, enabled_events: [...EVENEMENTS], api_version: versionApi, description: 'Rat-Market API v2 — abonnements (Test)', metadata: { rm_cle: CLE_PORTAIL, rm_lot: 'stripe-v2' } });
        rapport.ids.webhook = e.id; marque('cree', 'endpoint de webhook');
        let secret = e.secret; delete e.secret;
        try { if (typeof secret !== 'string' || !secret) throw new Error('Stripe n\'a pas rendu de secret'); await poserSurRender(NOM_VARIABLE_SECRET, secret); rapport.secretPose = true; trace(`secret posé sur le service d'essai (variable ${NOM_VARIABLE_SECRET}, valeur jamais affichée)`); }
        catch (err) {
            // sans secret conservé, l'endpoint est inutilisable : on le retire pour que le prochain passage le recrée proprement
            try { if (typeof stripe.webhookEndpoints.del === 'function') await stripe.webhookEndpoints.del(e.id); else await stripe.webhookEndpoints.update(e.id, { disabled: true }); } catch { /* le message ci-dessous dit déjà de relancer */ }
            rapport.ids.webhook = null; rapport.crees.pop();
            throw new Error(`provisionnement : le secret n'a pas pu être posé (${err && err.name ? err.name : 'erreur'}) — l'endpoint créé a été retiré, relancer`);
        } finally { secret = null; }
    }
    };
    // ── portails clients : UNE configuration PAR OFFRE (C1). Une configuration qui exposerait les deux produits laisserait un abonné Pro passer au prix Fondateurs sans code ni place :
    //    chacune ne propose donc QUE les deux prix (mensuel ↔ annuel) de SON produit. La configuration unique du premier jet (deux produits) est NEUTRALISÉE si elle existe
    //    (changement de plan coupé : Stripe interdit de désactiver la configuration PAR DÉFAUT du compte, que celle-ci est devenue).
    const toutes = await toutLister(p => stripe.billingPortal.configurations.list(p), {});
    for (const ancienne of toutes.filter(c => c.metadata && c.metadata.rm_cle === CLE_PORTAIL && c.active !== false && !(c.features && c.features.subscription_update && c.features.subscription_update.enabled === false))) {
        if (ecrire) { await stripe.billingPortal.configurations.update(ancienne.id, { features: { subscription_update: { enabled: false } } }); marque('maj', 'ancienne configuration unique du portail (deux produits) : changement de plan COUPÉ'); }
        else trace('à neutraliser : l\'ancienne configuration unique du portail (deux produits)');
    }
    rapport.ids.portail = { pro: null, fondateurs: null };
    const prix = lk => rapport.ids.prix[lk];
    for (const offre of O.OFFRES) {
        const cle = clePortail(offre), trouvees = toutes.filter(c => c.metadata && c.metadata.rm_cle === cle);
        if (trouvees.length > 1) throw new Error(`provisionnement : plusieurs configurations de portail ${offre} portent notre marque (rien n'est touché)`);
        const corps = {
            business_profile: { headline: 'Rat-Market — gérer mon abonnement', terms_of_service_url: `${site}/cgv`, privacy_policy_url: `${site}/politique-confidentialite` },
            default_return_url: `${site}/fr/compte`,
            features: {
                subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] } },
                subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations',
                    products: [{ product: rapport.ids.produits[offre], prices: O.PERIODES.map(p => prix(O.lookupKey(offre, p))) }] },     // UN produit : le sien
                payment_method_update: { enabled: true }, invoice_history: { enabled: true },
                customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] }
            }
        };
        if (trouvees.length === 1) {
            rapport.ids.portail[offre] = trouvees[0].id; marque('trouve', `configuration du portail ${offre}`);
            if (ecrire) { await stripe.billingPortal.configurations.update(trouvees[0].id, { ...corps, active: true }); marque('maj', `configuration du portail ${offre} (réalignée)`); }
        } else if (!ecrire) { rapport.ids.portail[offre] = '(à créer)'; trace(`à créer : configuration du portail client ${offre}`); }
        else { const c = await stripe.billingPortal.configurations.create({ ...corps, metadata: { rm_cle: cle, rm_lot: 'stripe-v2' } }); rapport.ids.portail[offre] = c.id; marque('cree', `configuration du portail ${offre}`); }
    }
    if (avecWebhook) await faireWebhook(); else trace('endpoint de webhook : NON TRAITÉ (--sans-webhook)');
    return rapport;
}
/** Le contenu du fichier local : des identifiants, jamais un secret. Contrôlé avant d'être rendu. */
function fichierDeSortie({ rapport, urlWebhook, mode, le }) {
    const variables = { V2_STRIPE_PORTAIL_CONFIG_PRO: rapport.ids.portail.pro, V2_STRIPE_PORTAIL_CONFIG_FONDATEURS: rapport.ids.portail.fondateurs };
    for (const [lk, nom] of Object.entries(VARIABLES_PRIX)) variables[nom] = rapport.ids.prix[lk];
    const o = { mode, creeLe: le, produits: rapport.ids.produits, prix: rapport.ids.prix, webhook: { id: rapport.ids.webhook, url: urlWebhook, evenements: [...EVENEMENTS], variableDuSecret: NOM_VARIABLE_SECRET, secretPoseSurRender: rapport.secretPose },
        portail: { pro: rapport.ids.portail.pro, fondateurs: rapport.ids.portail.fondateurs }, variablesAPoser: variables, avertissement: 'Aucun secret dans ce fichier : le secret du webhook n\'existe que sur le service Render.' };
    const texte = JSON.stringify(o, null, 2);
    if (FORME_SECRET.test(texte)) throw new Error('provisionnement : le fichier de sortie porterait une forme de clé ou de secret — écriture refusée');
    return texte;
}
module.exports = { provisionner, fichierDeSortie, EVENEMENTS, NOM_VARIABLE_SECRET, VARIABLES_PRIX, FORME_SECRET, CLE_PORTAIL };

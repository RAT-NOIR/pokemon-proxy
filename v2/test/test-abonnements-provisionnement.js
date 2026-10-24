'use strict';
// STRIPE-V2 — le script de provisionnement et poserSurRender, sur le faux Stripe et une fausse garde Render. Aucune base, aucun réseau.
//   · idempotent : relancé, il ne crée rien ; la simulation n'écrit rien ; les quatre produits de packs ne sont jamais touchés ;
//   · le secret de l'endpoint va à poserSurRender et nulle part ailleurs (ni sortie, ni fichier) ; échec de la pose → l'endpoint est retiré ;
//   · poserSurRender : un seul service (l'essai), une seule variable, sauvegarde chiffrée, essai à blanc par les noms, relecture ; un diff trop large arrête avant d'écrire.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { creerFauxStripe } = require('./_faux-stripe');
const { provisionner, fichierDeSortie, EVENEMENTS, NOM_VARIABLE_SECRET } = require('../admin/abonnements/provisionner-lib');
const { fabriquer, SERVICE, VARIABLES_PERMISES } = require('../admin/abonnements/poser-sur-render');
const O = require('../abonnements/offres');
const SITE = 'https://rat-market.fr', URL_WH = 'https://rat-market-api-essai.onrender.com/api/webhook-stripe-v2';

(async () => {
    const sortie = []; const trace = m => sortie.push(m);
    const faux = creerFauxStripe();
    // les quatre produits de packs existants : ils ne portent aucune de nos marques
    for (const n of [20, 50, 100, 200]) await faux.products.create({ name: `Rat-Market — ${n} scans`, metadata: { pack: String(n) } });
    await faux.products.create({ name: 'Rat-Market Pro', metadata: {} });       // un produit fait à la main qui porte déjà le NOM d'une de nos offres, sans notre marque : il n'est ni adopté ni modifié
    const packsAvant = JSON.stringify(faux.E.produits);
    faux.E.configs.push({ id: 'bpc_ancienne', active: true, metadata: { rm_cle: 'rat-market-v2' }, features: { subscription_update: { enabled: true, products: [{ product: 'prod_a', prices: ['p1', 'p2'] }, { product: 'prod_b', prices: ['p3', 'p4'] }] } } });   // la configuration unique du premier jet (deux produits : la faille C1)
    faux.E.appels.length = 0;
    const deposes = [];                                                         // ce que poserSurRender a reçu (nom seulement dans les assertions)
    const poser = async (nom, valeur) => { deposes.push({ nom, longueur: valeur.length }); deposes.valeurs = (deposes.valeurs || []).concat(valeur); };
    const ecritures = () => faux.E.appels.filter(a => /\.(create|update|del)$/.test(a.nom)).length;

    // ── 1. SIMULATION : rien n'est écrit ──
    const sim = await provisionner({ stripe: faux, site: SITE, urlWebhook: URL_WH, versionApi: '2026-06-24.dahlia', ecrire: false, poserSurRender: poser, trace });
    H.v('la simulation n\'écrit RIEN (aucune création, aucune mise à jour) et ne pose aucun secret', [ecritures(), deposes.length, sim.crees.length], [0, 0, 0]);
    H.v('   elle dit ce qu\'elle ferait', sortie.filter(l => l.startsWith('à créer')).length >= 8, true);

    // ── 2. LA CRÉATION ──
    const r1 = await provisionner({ stripe: faux, site: SITE, urlWebhook: URL_WH, versionApi: '2026-06-24.dahlia', ecrire: true, poserSurRender: poser, trace });
    H.v('première exécution : 2 produits, 4 prix, 2 configurations de portail (une par offre), 1 endpoint créés', r1.crees.length, 9);
    const prod = faux.E.produits.filter(p => p.metadata && p.metadata.rm_cle);
    H.v('   les produits portent leur marque et leur nom', prod.map(p => [p.metadata.rm_cle, p.name]).sort(), [['rm_v2_fondateurs', 'Rat-Market Fondateurs'], ['rm_v2_pro', 'Rat-Market Pro']]);
    H.v('   les quatre prix : montants EUR exacts, intervalle, clé de recherche', faux.E.prix.map(p => [p.lookup_key, p.unit_amount, p.currency, p.recurring.interval]).sort(),
        [['rm_v2_fondateurs_an', 2900, 'eur', 'year'], ['rm_v2_fondateurs_mois', 299, 'eur', 'month'], ['rm_v2_pro_an', 3900, 'eur', 'year'], ['rm_v2_pro_mois', 499, 'eur', 'month']]);
    H.v('   chaque prix est rattaché au bon produit', faux.E.prix.every(p => faux.E.produits.find(x => x.id === p.product).metadata.rm_cle === `rm_v2_${p.lookup_key.split('_')[2]}`), true);
    const we = faux.E.endpoints[0];
    H.v('   l\'endpoint : l\'URL de la route v2 de l\'essai, les 6 événements exactement, la version d\'API épinglée', [we.url, [...we.enabled_events].sort(), we.api_version], [URL_WH, [...EVENEMENTS].sort(), '2026-06-24.dahlia']);
    H.v('   les 7 événements : les six de la consigne + checkout.session.expired (la réservation d\'une place Fondateurs n\'est rendue que pour SA session)', EVENEMENTS, ['checkout.session.completed', 'checkout.session.expired', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);
    const portails = o => faux.E.configs.find(c => c.metadata && c.metadata.rm_cle === 'rat-market-v2-portail-' + o && c.active);
    const produitDe = o => faux.E.produits.find(p => p.metadata && p.metadata.rm_cle === 'rm_v2_' + o).id;
    for (const o of ['pro', 'fondateurs']) {
        const pc = portails(o), liste = pc ? pc.features.subscription_update.products : [];
        H.v('portail ' + o + ' : LA LISTE DES PRODUITS de la configuration compte UN produit — le sien — et ses deux prix (changement mensuel ↔ annuel seulement)', [liste.length, liste[0] && liste[0].product === produitDe(o), liste[0] && liste[0].prices.length, liste[0] && liste[0].prices.every(p => faux.E.prix.find(y => y.id === p).product === produitDe(o))], [1, true, 2, true]);
        H.v('   résiliation à la fin de la période, CGV et confidentialité, retour au compte', [pc.features.subscription_cancel.mode, pc.business_profile.terms_of_service_url, pc.business_profile.privacy_policy_url, pc.features.subscription_update.default_allowed_updates, pc.default_return_url], ['at_period_end', 'https://rat-market.fr/cgv', 'https://rat-market.fr/politique-confidentialite', ['price'], 'https://rat-market.fr/fr/compte']);
        H.v('   STRIPE-DECISIONS : le portail PERMET D\'AJOUTER OU DE CHANGER LA CARTE (essai sans carte : la carte se pose pendant l\'essai, le premier paiement a lieu à sa fin) et montre l\'historique des factures', [pc.features.payment_method_update, pc.features.invoice_history], [{ enabled: true }, { enabled: true }]);
    }
    H.v('   les deux configurations sont distinctes, et AUCUNE configuration qui permet un changement de plan n\'expose deux produits', [portails('pro').id !== portails('fondateurs').id, faux.E.configs.filter(c => c.active && c.features.subscription_update.enabled !== false && c.features.subscription_update.products.length > 1).length], [true, 0]);
    H.v('   l\'ancienne configuration à deux produits (devenue la configuration par défaut : Stripe ne la laisse pas se désactiver) est NEUTRALISÉE : plus de changement de plan', faux.E.configs.find(c => c.id === 'bpc_ancienne').features.subscription_update.enabled, false);
    H.v('le secret est allé à poserSurRender, sous le nom permis, une fois', [deposes.length, deposes[0].nom, deposes[0].longueur > 8], [1, NOM_VARIABLE_SECRET, true]);
    const secret = deposes.valeurs[0];
    const texteFichier = fichierDeSortie({ rapport: r1, urlWebhook: URL_WH, mode: 'test', le: '2026-10-18T00:00:00.000Z' });
    H.v('   le secret n\'est NI dans la sortie du script, NI dans le fichier écrit, NI dans le rapport', [sortie.some(l => l.includes(secret)), texteFichier.includes(secret), JSON.stringify(r1).includes(secret)], [false, false, false]);
    const fic = JSON.parse(texteFichier);
    H.v('   le fichier : les identifiants (prix, portail, webhook) et les variables à poser, aucun secret', [Object.keys(fic.variablesAPoser).sort(), fic.webhook.secretPoseSurRender, /whsec_|sk_test_|sk_live_|rk_/.test(texteFichier)],
        [['V2_STRIPE_PORTAIL_CONFIG_FONDATEURS', 'V2_STRIPE_PORTAIL_CONFIG_PRO', 'V2_STRIPE_PRIX_FONDATEURS_AN', 'V2_STRIPE_PRIX_FONDATEURS_MOIS', 'V2_STRIPE_PRIX_PRO_AN', 'V2_STRIPE_PRIX_PRO_MOIS'], true, false]);
    H.v('   les quatre produits de packs ET le produit homonyme sans marque sont strictement inchangés (ni créés, ni modifiés, ni archivés : comparaison exacte avant / après, et aucun products.update)', [JSON.stringify(faux.E.produits.filter(p => !(p.metadata && p.metadata.rm_cle))) === packsAvant, faux.E.appels.filter(a => a.nom === 'products.update').length], [true, 0]);

    // ── 3. IDEMPOTENCE ──
    faux.E.appels.length = 0; const immuablesAvant = JSON.stringify([faux.E.produits, faux.E.prix, faux.E.endpoints]);
    const r2 = await provisionner({ stripe: faux, site: SITE, urlWebhook: URL_WH, versionApi: '2026-06-24.dahlia', ecrire: true, poserSurRender: poser, trace });
    const creations = faux.E.appels.filter(a => /\.create$/.test(a.nom));
    H.v('seconde exécution : RIEN n\'est créé, aucun secret reposé', [r2.crees.length, creations.length, deposes.length, r2.retrouves.length], [0, 0, 1, 9]);
    H.v('   le nombre d\'objets est identique (2 produits + 4 packs + 1 produit homonyme sans marque, 4 prix, 1 endpoint, 2 portails + l\'ancienne désactivée)', [faux.E.produits.length, faux.E.prix.length, faux.E.endpoints.length, faux.E.configs.length], [7, 4, 1, 3]);
    H.v('   produits, prix et endpoint sont strictement inchangés (seul le portail est réaligné)', JSON.stringify([faux.E.produits, faux.E.prix, faux.E.endpoints]) === immuablesAvant, true);
    H.v('   les mêmes identifiants sont rendus', JSON.stringify(r2.ids) === JSON.stringify(r1.ids), true);

    // ── 4. UN PRIX QUI DIFFÈRE : arrêt, rien de modifié (un prix est immuable) ──
    const f2 = creerFauxStripe();
    await provisionner({ stripe: f2, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: poser, trace });
    f2.E.prix.find(p => p.lookup_key === 'rm_v2_pro_mois').unit_amount = 599; f2.E.appels.length = 0;
    let msg = null; try { await provisionner({ stripe: f2, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: poser, trace }); } catch (e) { msg = e.message; }
    H.v('un prix existant au mauvais montant : le script s\'arrête en le disant, sans rien modifier', [/rm_v2_pro_mois.*montant/.test(msg || ''), f2.E.appels.filter(a => /\.(update|create|del)$/.test(a.nom)).length], [true, 0]);
    // deux produits qui portent la même marque : ambigu
    const f3 = creerFauxStripe(); await f3.products.create({ name: 'a', metadata: { rm_cle: 'rm_v2_pro' } }); await f3.products.create({ name: 'b', metadata: { rm_cle: 'rm_v2_pro' } });
    let msg3 = null; try { await provisionner({ stripe: f3, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: poser, trace }); } catch (e) { msg3 = e.message; }
    H.v('deux produits à notre marque : ambigu, arrêt avant toute création', [/ambigu/.test(msg3 || ''), f3.E.prix.length], [true, 0]);

    // ── 5. LA POSE SUR RENDER ÉCHOUE : l'endpoint créé est retiré ──
    const f4 = creerFauxStripe(); let msg4 = null;
    try { await provisionner({ stripe: f4, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: async () => { throw Object.assign(new Error('Render HTTP 500 avec whsec_secretquinedoitpassortir'), { name: 'RenderErreur' }); }, trace }); } catch (e) { msg4 = e.message; }
    H.v('poserSurRender échoue : l\'endpoint créé est RETIRÉ (aucun secret conservé), message sans le détail de l\'erreur', [f4.E.endpoints.length, /relancer/.test(msg4 || ''), (msg4 || '').includes('secretquinedoitpassortir')], [0, true, false]);
    const r4 = await provisionner({ stripe: f4, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: poser, trace });
    H.v('   relancé : l\'endpoint est recréé, le secret posé', [f4.E.endpoints.length, r4.secretPose], [1, true]);
    // un endpoint déjà existant mais aux mauvais événements : réaligné
    f4.E.endpoints[0].enabled_events = ['invoice.paid'];
    await provisionner({ stripe: f4, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: poser, trace });
    H.v('un endpoint aux événements incomplets est réaligné sur les 6', [...f4.E.endpoints[0].enabled_events].sort(), [...EVENEMENTS].sort());
    // sans l'endpoint (--sans-webhook) : produits, prix et portail seulement, aucun secret, aucune pose ; puis l'endpoint seul au passage suivant
    const f5 = creerFauxStripe(); const poseCompte = [];
    const r5 = await provisionner({ stripe: f5, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, avecWebhook: false, poserSurRender: async n => { poseCompte.push(n); }, trace });
    H.v('--sans-webhook : produits, prix et portail créés, AUCUN endpoint, aucune pose sur Render', [f5.E.produits.length, f5.E.prix.length, f5.E.configs.length, f5.E.endpoints.length, poseCompte.length, r5.ids.webhook, r5.secretPose], [2, 4, 2, 0, 0, null, false]);
    const fichier5 = JSON.parse(fichierDeSortie({ rapport: r5, urlWebhook: URL_WH, mode: 'test', le: '2026-10-18T00:00:00.000Z' }));
    H.v('   le fichier le dit (webhook sans identifiant, secret non posé)', [fichier5.webhook.id, fichier5.webhook.secretPoseSurRender], [null, false]);
    const r5b = await provisionner({ stripe: f5, site: SITE, urlWebhook: URL_WH, versionApi: 'v', ecrire: true, poserSurRender: async n => { poseCompte.push(n); }, trace });
    H.v('   le passage suivant (avec l\'endpoint) ne crée que l\'endpoint', [r5b.crees, f5.E.produits.length, f5.E.prix.length, f5.E.endpoints.length, poseCompte], [['endpoint de webhook'], 2, 4, 1, [NOM_VARIABLE_SECRET]]);
    // entrées refusées
    let m5 = null; try { await provisionner({ stripe: faux, site: 'http://x', urlWebhook: URL_WH, versionApi: 'v', ecrire: false }); } catch (e) { m5 = e.message; }
    let m6 = null; try { await provisionner({ stripe: faux, site: SITE, urlWebhook: 'https://x.exemple/autre', versionApi: 'v', ecrire: false }); } catch (e) { m6 = e.message; }
    H.v('un site en http ou une URL de webhook qui n\'est pas la route v2 : refusés avant tout appel', [Boolean(m5), Boolean(m6)], [true, true]);

    // ── 6. poserSurRender ──
    const variables = [{ key: 'MONGODB_URI', value: 'mongodb://valeur-secrete-1' }, { key: 'V2_STRIPE_WEBHOOK_SECRET', value: 'ancien-secret-123' }, { key: 'AUTRE', value: 'x' }];
    const journal = []; let etat = variables.map(v => ({ ...v }));
    const garde = {
        lireVariables: async s => { journal.push(['lire', s]); return etat.map(v => ({ ...v })); },
        sauvegarder: (s, v, e) => { journal.push(['sauvegarder', s, v.length, e]); return { fichier: 'sauvegarde.enc', n: v.length }; },
        diffNoms: (a, b) => { const A = new Map(a.map(x => [x.key, x.value])), B = new Map(b.map(x => [x.key, x.value])); return { ajoutes: [...B.keys()].filter(k => !A.has(k)), retires: [...A.keys()].filter(k => !B.has(k)), modifies: [...B.keys()].filter(k => A.has(k) && A.get(k) !== B.get(k)) }; },
        remplacerVariables: async (s, v, o) => { journal.push(['remplacer', s, v.length, o.essaiABlanc, Boolean(o.sauvegarde)]); etat = v.map(x => ({ ...x })); }
    };
    const traces = []; const poserR = fabriquer(garde, m => traces.push(m));
    H.v('la variable permise et le service sont des constantes du fichier', [VARIABLES_PERMISES, SERVICE], [['V2_STRIPE_WEBHOOK_SECRET'], 'essai']);
    const ok = await poserR('V2_STRIPE_WEBHOOK_SECRET', 'whsec_nouveausecret123');
    H.v('pose : lecture, sauvegarde chiffrée, remplacement avec essai à blanc, relecture — toujours sur l\'ESSAI', [journal.map(j => j[0]), journal.every(j => j[1] === 'essai'), journal.find(j => j[0] === 'remplacer').slice(3)], [['lire', 'sauvegarder', 'lire', 'remplacer', 'lire'], true, [true, true]]);
    H.v('   la variable est posée, TOUTES les autres sont intactes', [etat.find(v => v.key === 'V2_STRIPE_WEBHOOK_SECRET').value === 'whsec_nouveausecret123', etat.find(v => v.key === 'MONGODB_URI').value, etat.length], [true, 'mongodb://valeur-secrete-1', 3]);
    H.v('   les traces ne portent que des noms (aucune valeur)', traces.some(t => /valeur-secrete|nouveausecret|ancien-secret/.test(t)), false);
    H.v('   et le retour non plus', JSON.stringify(ok).includes('nouveausecret'), false);
    for (const [nom, v, pourquoi] of [['MONGODB_URI', 'whsec_abcdefgh', 'une variable hors liste'], ['V2_STRIPE_WEBHOOK_SECRET', '', 'une valeur vide'], ['V2_STRIPE_WEBHOOK_SECRET', 'a\nb12345678', 'un saut de ligne'], ['V2_STRIPE_WEBHOOK_SECRET', 12345678, 'une valeur non texte']]) {
        const avant = journal.length; let e = null; try { await poserR(nom, v); } catch (x) { e = x.message; }
        H.v(`   refus : ${pourquoi}, avant tout appel à Render`, [Boolean(e), journal.length - avant], [true, 0]);
    }
    // un diff trop large (une autre variable bouge entre la lecture et l'écriture) : arrêt avant d'écrire
    const gardeLarge = { ...garde, diffNoms: (a, b) => ({ ajoutes: [], retires: [], modifies: ['V2_STRIPE_WEBHOOK_SECRET', 'MONGODB_URI'] }) };
    const avantEcr = journal.filter(j => j[0] === 'remplacer').length; let eL = null;
    try { await fabriquer(gardeLarge)('V2_STRIPE_WEBHOOK_SECRET', 'whsec_encoreunautre1'); } catch (x) { eL = x.message; }
    H.v('un essai à blanc qui toucherait une AUTRE variable : arrêt AVANT d\'écrire, message avec les noms seulement', [/autre chose/.test(eL || ''), journal.filter(j => j[0] === 'remplacer').length - avantEcr, (eL || '').includes('MONGODB')], [true, 0, false]);
    // la relecture qui diffère est vue
    const gardeMenteuse = { ...garde, remplacerVariables: async () => { /* ne remplace rien */ } };
    let eM = null; try { await fabriquer(gardeMenteuse)('V2_STRIPE_WEBHOOK_SECRET', 'whsec_troisiemesecret'); } catch (x) { eM = x.message; }
    H.v('une relecture qui ne retrouve pas ce qui était posé : l\'écart est vu', [/relecture diffère/.test(eM || ''), (eM || '').includes('troisiemesecret')], [true, false]);
    let eV = null; try { await fabriquer({ ...garde, lireVariables: async () => [] })('V2_STRIPE_WEBHOOK_SECRET', 'whsec_quatriemesecret'); } catch (x) { eV = x.message; }
    H.v('aucune variable lue sur l\'essai : on ne remplace pas un ensemble inconnu', /ne remplace pas/.test(eV || ''), true);
    // M5 : le NOMBRE de variables est comparé avant d'écrire (une variable que Render génère ou masque change le compte entre deux lectures)
    let lectures = 0; const journalM5 = [];
    const gardeCompte = { ...garde, lireVariables: async () => { lectures++; const base = etat.map(v => ({ ...v })); return lectures === 2 ? base.slice(0, -1) : base; }, remplacerVariables: async (...a) => { journalM5.push('remplacer'); return garde.remplacerVariables(...a); } };
    let eN = null; try { await fabriquer(gardeCompte)('V2_STRIPE_WEBHOOK_SECRET', 'whsec_cinquiemesecret'); } catch (x) { eN = x.message; }
    H.v('M5 : une seconde lecture qui ne compte plus le même nombre de variables arrête AVANT d\'écrire, sans citer de valeur', [/nombre de variables/.test(eN || ''), journalM5.length, (eN || '').includes('cinquiemesecret')], [true, 0, false]);
    // le code ne contient aucun chemin vers un autre service
    const src = fs.readFileSync(path.join(__dirname, '..', 'admin', 'abonnements', 'poser-sur-render.js'), 'utf8').replace(/\/\/.*$/gm, '');
    H.v('poser-sur-render.js ne nomme qu\'un service, n\'appelle ni déploiement, ni suppression, ni production', [/'production'|'collecteur'|deployer|deploiements|supprimer|\.del\b/.test(src), (src.match(/SERVICE\b/g) || []).length > 3], [false, true]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

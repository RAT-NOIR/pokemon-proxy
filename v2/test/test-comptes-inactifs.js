'use strict';
// BREVO — l'avertissement envoyé 30 jours avant la suppression d'un compte INACTIF (politique de confidentialité v2 : « supprimé après 3 ans sans connexion, avec un avertissement par courriel un mois avant »).
// Ce banc prouve la PASSE d'avertissement (inactifs.js) et le prédicat que la future passe de suppression devra lire (`suppressionPermise`) : UN avertissement par compte, écrit dans le compte (idempotent),
// un compte averti qui se reconnecte n'est pas supprimable, un compte de banc n'est jamais averti, un échec d'envoi ne marque rien et se retente. Base de banc, courrier simulé.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const I = require('../comptes/inactifs');
const { creerCourrierMemoire } = require('../comptes/courrier');

const JOUR = 86400e3;
const plus = (d, jours) => new Date(d.getTime() + jours * JOUR);
const ans = (d, k) => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() + k); return x; };
(async () => {
    await H.ouvrirBac('test-comptes-inactifs.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    H.v('la politique est dans la configuration : 3 ans, 30 jours', [cfg.comptes.inactiviteAns, cfg.comptes.avertissementJours], [3, 30]);
    H.v('   la passe est ÉTEINTE par défaut', cfg.courriels.avertissementsInactifs, false);
    H.v('   V2_AVERTISSEMENTS_INACTIFS=1 l\'allume', lireConfig({ MONGODB_BASE: 'test_scratch', V2_AVERTISSEMENTS_INACTIFS: '1' }).courriels.avertissementsInactifs, true);
    const NOW = new Date('2026-11-10T08:00:00Z');
    let n = 0;
    // un compte confirmé dont l'ÉCHÉANCE (dernière connexion + 3 ans) tombe `dans` jours après NOW
    const faire = async (dans, surcharges = {}) => {
        const i = ++n; const derniere = ans(plus(NOW, dans), -3);
        const c = M.nouveauCompte({ email: `c${i}@exemple.fr`, emailCle: `c${i}@exemple.fr`, motDePasse: null, now: ans(NOW, -5) });
        Object.assign(c, { verifie: true, verifieLe: ans(NOW, -5), derniereConnexionLe: derniere }, surcharges);
        await db.col('comptes').insertOne(c); return c;
    };
    const relire = id => db.col('comptes').findOne({ _id: id });
    const envoyes = []; let panne = null;
    const courrier = { reel: true, async envoyerAvertissement(email, d) { if (panne) throw panne; envoyes.push({ email, ...d }); } };
    const traces = []; const orig = { log: console.log, warn: console.warn, error: console.error };
    const piege = () => { console.warn = console.error = (...a) => traces.push(a.join(' ')); };

    // ---- les prédicats, sur des comptes jamais écrits ----
    const c = (o) => ({ verifie: true, verifieLe: ans(NOW, -4), derniereConnexionLe: null, email: 'x@exemple.fr', abonnement: { actif: false }, ...o });
    H.v('échéance = dernière connexion + 3 ans', I.echeance(c({ derniereConnexionLe: new Date('2023-12-01T10:00:00Z') }), cfg).toISOString(), '2026-12-01T10:00:00.000Z');
    H.v('   jamais connecté : la confirmation de l\'adresse sert de référence', I.echeance(c({ verifieLe: new Date('2023-12-01T10:00:00Z') }), cfg).toISOString(), '2026-12-01T10:00:00.000Z');
    H.v('   la plus récente des deux dates fait foi', I.echeance(c({ verifieLe: new Date('2023-01-01T00:00:00Z'), derniereConnexionLe: new Date('2024-01-01T00:00:00Z') }), cfg).toISOString(), '2027-01-01T00:00:00.000Z');
    H.v('   aucune référence lisible : pas d\'échéance (jamais deviner)', I.echeance(c({ verifieLe: null }), cfg), null);
    H.v('   les comptes de banc : drapeau, et .invalid sans égard à la casse', [I.estBanc({ banc: true, email: 'a@b.fr' }), I.estBanc({ email: 'X@Banc.INVALID' }), I.estBanc({ email: 'a@exemple.fr' }), I.estBanc({ banc: false, email: 'a@exemple.fr' })], [true, true, false, false]);

    // ---- qui est averti ----
    const dans20 = await faire(20);                                                     // fenêtre ouverte (30 j)
    const dans45 = await faire(45);                                                     // trop tôt
    const recent = await faire(900);
    const jamais = await faire(0, { derniereConnexionLe: null, verifieLe: plus(ans(NOW, -3), 10) });   // jamais connecté depuis la confirmation (échéance dans 10 j)
    const depasse = await faire(-200);                                                  // échéance dépassée, jamais averti
    const banc = await faire(-100, { banc: true });
    const invalid = await faire(-100, { email: 'mesure@banc.invalid', emailCle: 'mesure@banc.invalid' });
    const nonConfirme = await faire(-100, { verifie: false, verifieLe: null });
    const abonne = await faire(-100, { abonnement: { actif: true, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: null } });

    const memoire = creerCourrierMemoire();
    const refusMemoire = await I.avertirInactifs({ cfg, courrier: memoire, maintenant: NOW });
    H.v('le pilote MÉMOIRE n\'est jamais autorisé à « avertir » (il marquerait des comptes sans rien envoyer)', [refusMemoire.refuse, memoire.envoyes.length, (await relire(depasse._id)).avertissementSuppression === undefined], ['courrier-non-reel', 0, true]);

    const blanc = await I.avertirInactifs({ cfg, courrier, maintenant: NOW, aBlanc: true });
    H.v('essai à BLANC : compte ce qui partirait, n\'envoie ni ne marque rien', [blanc.aBlanc, blanc.avertis, envoyes.length, (await relire(dans20._id)).avertissementSuppression === undefined], [true, 3, 0, true]);

    piege(); const r1 = await I.avertirInactifs({ cfg, courrier, maintenant: NOW }); Object.assign(console, orig);
    H.v('première passe : avertis = fenêtre ouverte (20 j), jamais connecté (10 j), échéance dépassée', [r1.avertis, r1.echecs, envoyes.map(e => e.email).sort()], [3, 0, [dans20, jamais, depasse].map(x => x.email).sort()]);
    H.v('   ni trop tôt, ni récent, ni banc, ni .invalid, ni non confirmé, ni abonné', [dans45, recent, banc, invalid, nonConfirme, abonne].map(x => envoyes.some(e => e.email === x.email)), [false, false, false, false, false, false]);
    const a20 = (await relire(dans20._id)).avertissementSuppression;
    H.v('le compte porte la date de l\'avertissement ET celle de la suppression prévue : le MOIS D\'AVIS est toujours dû, même si l\'échéance (dans 20 j) est plus proche', [a20.le.toISOString(), a20.prevuLe.toISOString()], [NOW.toISOString(), plus(NOW, 30).toISOString()]);
    const ad = (await relire(depasse._id)).avertissementSuppression;
    H.v('   échéance dépassée : la suppression prévue est dans 30 jours, jamais avant (le mois d\'avis est dû)', ad.prevuLe.toISOString(), plus(NOW, 30).toISOString());
    const mail20 = envoyes.find(e => e.email === dans20.email);
    H.v('   le courriel reçoit la dernière connexion et la date prévue', [mail20.derniereConnexionLe.toISOString(), mail20.suppressionLe.toISOString()], [ans(plus(NOW, 20), -3).toISOString(), plus(NOW, 30).toISOString()]);
    H.v('   aucune trace de verrou laissée sur les comptes avertis', (await relire(dans20._id)).avertissementEnCoursLe === undefined, true);

    // ---- idempotent ----
    const r2 = await I.avertirInactifs({ cfg, courrier, maintenant: plus(NOW, 1) });
    H.v('deuxième passe, le lendemain : UN avertissement par compte, rien de plus', [r2.avertis, envoyes.length], [0, 3]);

    // ---- la suppression future ne lit que cela ----
    const sp = (compte, maintenant) => I.suppressionPermise(compte, cfg, maintenant);
    let dd = await relire(dans20._id);
    H.v('suppressionPermise : pas avant la date prévue (ni à l\'échéance seule, dans 20 j : l\'avis de 30 jours n\'est pas écoulé)', [sp(dd, NOW), sp(dd, plus(NOW, 20)), sp(dd, plus(NOW, 29))], [false, false, false]);
    H.v('   à la date prévue (30 jours d\'avis écoulés ET échéance atteinte) : oui', sp(dd, plus(NOW, 30)), true);
    H.v('   un compte jamais averti n\'est JAMAIS supprimable, même bien après son échéance', [sp(await relire(dans45._id), plus(NOW, 400)), sp(await relire(recent._id), plus(NOW, 4000))], [false, false]);
    H.v('   banc, .invalid, abonné, non confirmé : jamais supprimables par cette règle', [banc, invalid, abonne, nonConfirme].map(x => sp({ ...x, avertissementSuppression: { le: ans(NOW, -1), prevuLe: ans(NOW, -1) } }, NOW)), [false, false, false, false]);
    H.v('   échéance dépassée : pas avant les 30 jours d\'avis, puis oui', [sp(await relire(depasse._id), plus(NOW, 29)), sp(await relire(depasse._id), plus(NOW, 30))], [false, true]);

    // ---- un compte averti qui se reconnecte n'est pas supprimé ----
    await db.col('comptes').updateOne({ _id: dans20._id }, { $set: { derniereConnexionLe: plus(NOW, 5) } });
    dd = await relire(dans20._id);
    H.v('reconnecté 5 jours après l\'avertissement : plus supprimable, même passé la date prévue', [sp(dd, plus(NOW, 30)), sp(dd, plus(NOW, 400))], [false, false]);
    await I.avertirInactifs({ cfg, courrier, maintenant: plus(NOW, 21) });
    H.v('   et la passe ne le réavertit pas (le courriel qui part ce jour-là est celui d\'un autre compte)', envoyes.filter(e => e.email === dans20.email).length, 1);
    const prochain = plus(ans(plus(NOW, 5), 3), -20);       // trois ans après la reconnexion, fenêtre rouverte
    const r3 = await I.avertirInactifs({ cfg, courrier, maintenant: prochain });
    H.v('   trois ans plus tard, un NOUVEAU cycle s\'ouvre pour lui : un nouvel avertissement (deux en tout)', [r3.avertis >= 1, envoyes.filter(e => e.email === dans20.email).length], [true, 2]);
    envoyes.length = 0;

    // ---- un échec d'envoi ne marque rien et se retente ----
    const tomb = await faire(10);
    panne = Object.assign(new Error('Brevo 503 pour tomb@exemple.fr'), { name: 'BrevoStatut503' });
    piege(); const r4 = await I.avertirInactifs({ cfg, courrier, maintenant: NOW }); Object.assign(console, orig);
    const apres = await relire(tomb._id);
    H.v('échec d\'envoi : compté, rien d\'écrit dans le compte, aucun verrou laissé', [r4.avertis, r4.echecs, apres.avertissementSuppression === undefined, apres.avertissementEnCoursLe === undefined], [0, 1, true, true]);
    panne = null;
    const r5 = await I.avertirInactifs({ cfg, courrier, maintenant: plus(NOW, 1) });
    H.v('   la passe suivante le retente : il part, une fois', [r5.avertis, envoyes.map(e => e.email)], [1, [tomb.email]]);
    envoyes.length = 0;

    // ---- plafond atteint : la passe s'arrête, le reste attend demain ----
    const p1 = await faire(5), p2 = await faire(5), p3 = await faire(5);
    let appels = 0;
    const plein = { reel: true, async envoyerAvertissement() { appels++; throw Object.assign(new Error('BrevoPlafond'), { name: 'BrevoPlafond' }); } };
    piege(); const r6 = await I.avertirInactifs({ cfg, courrier: plein, maintenant: NOW }); Object.assign(console, orig);
    H.v('plafond du jour atteint : la passe S\'ARRÊTE au premier refus (1 appel), rien n\'est marqué', [r6.plafond, appels, r6.avertis], [true, 1, 0]);
    H.v('   aucun des trois n\'est marqué', (await Promise.all([p1, p2, p3].map(x => relire(x._id)))).map(x => x.avertissementSuppression === undefined), [true, true, true]);
    const r7 = await I.avertirInactifs({ cfg, courrier, maintenant: plus(NOW, 1) });
    H.v('   le lendemain, ils partent', [r7.avertis, envoyes.length], [3, 3]);
    envoyes.length = 0;

    // ---- borne par passe ----
    for (let i = 0; i < 5; i++) await faire(3);
    const lots = []; for (let i = 0; i < 3; i++) lots.push((await I.avertirInactifs({ cfg, courrier, maintenant: NOW, max: 2 })).avertis);
    H.v('au plus `max` avertissements par passe : 5 comptes, max 2 → 2, 2, 1', lots, [2, 2, 1]);
    envoyes.length = 0;

    // ---- deux passes simultanées : UN seul courriel ----
    const seul = await faire(7);
    const [x, y] = await Promise.all([I.avertirInactifs({ cfg, courrier, maintenant: NOW }), I.avertirInactifs({ cfg, courrier, maintenant: NOW })]);
    H.v('deux passes simultanées sur le même compte : UN seul courriel', [envoyes.filter(e => e.email === seul.email).length, x.avertis + y.avertis], [1, 1]);
    envoyes.length = 0;

    // ---- le verrou du compte : frais = laissé, périmé = repris ----
    const verrouFrais = await faire(4, { avertissementEnCoursLe: new Date(NOW.getTime() - 10 * 60e3) });
    const verrouPerime = await faire(4, { avertissementEnCoursLe: new Date(NOW.getTime() - 3 * 3600e3) });
    await I.avertirInactifs({ cfg, courrier, maintenant: NOW });
    H.v('un verrou de 10 minutes est respecté (un autre processus travaille), celui de 3 heures est repris', [envoyes.some(e => e.email === verrouFrais.email), envoyes.some(e => e.email === verrouPerime.email)], [false, true]);

    // ---- le compte se reconnecte PENDANT la passe : rien ne part ----
    const filant = await faire(2);
    const courrierLent = { reel: true, async envoyerAvertissement() { throw new Error('ne doit pas être appelé'); } };
    await db.col('comptes').updateOne({ _id: filant._id }, { $set: { derniereConnexionLe: plus(NOW, -1) } });    // reconnexion entre la lecture (sélection) et l'écriture : simulée par un changement avant la passe suivante
    const r8 = await I.avertirInactifs({ cfg, courrier: courrierLent, maintenant: NOW });
    H.v('un compte reconnecté avant la passe n\'est plus sélectionné (son échéance a reculé de 3 ans)', [r8.avertis, r8.echecs], [0, 0]);

    // ---- TOUR 1 (R2) : un compte qui porte des crédits ACHETÉS n'est ni concerné ni supprimable (défaut fermé) ----
    const avert = { le: ans(NOW, -1), prevuLe: ans(NOW, -1) };
    const vieux = (solde) => c({ derniereConnexionLe: ans(NOW, -4), solde, avertissementSuppression: avert });
    H.v('R2 : achete > 0 => ni concerné ni supprimable', [I.concerne(vieux({ accueil: 0, achete: 5 })), sp(vieux({ accueil: 0, achete: 5 }), NOW)], [false, false]);
    H.v('   poche illisible (texte, négatif, NaN, objet, booléen) => fermé aussi', [{ achete: 'x' }, { achete: -1 }, { achete: NaN }, { achete: {} }, { achete: true }].map(s => I.concerne(vieux(s)) || sp(vieux(s), NOW)), [false, false, false, false, false]);
    H.v('   achete 0, absent ou solde absent : le compte reste concerné et supprimable (la règle ne devient pas un « jamais »)', [{ achete: 0 }, {}, undefined].map(s => [I.concerne(vieux(s)), sp(vieux(s), NOW)]), [[true, true], [true, true], [true, true]]);
    const achat = await faire(5, { solde: { accueil: 0, achete: 3 } });
    envoyes.length = 0; await I.avertirInactifs({ cfg, courrier, maintenant: NOW });
    H.v('   la passe ne l\'avertit pas non plus (un avertissement promettrait une suppression que la règle refuse)', [envoyes.some(e => e.email === achat.email), (await relire(achat._id)).avertissementSuppression === undefined], [false, true]);

    // ---- TOUR 1 (R3) : un 429 de Brevo ARRÊTE la passe, comme le plafond ----
    const q1 = await faire(5), q2 = await faire(5), q3 = await faire(5);
    let appels429 = 0;
    const trop = { reel: true, async envoyerAvertissement() { appels429++; throw Object.assign(new Error('Brevo 429'), { name: 'BrevoStatut429' }); } };
    piege(); const r429 = await I.avertirInactifs({ cfg, courrier: trop, maintenant: NOW }); Object.assign(console, orig);
    H.v('R3 : 429 de Brevo : la passe S\'ARRÊTE au premier refus (1 appel, pas jusqu\'à 100), rien n\'est marqué, l\'arrêt est dit', [appels429, r429.avertis, r429.arret, (await Promise.all([q1, q2, q3].map(x => relire(x._id)))).every(x => x.avertissementSuppression === undefined)], [1, 0, 'BrevoStatut429', true]);

    // ---- les journaux ne contiennent aucune adresse ----
    H.vrai(`aucun journal des passes (${traces.length} lignes) ne contient une adresse ni le message du pilote`, !traces.join('\n').includes('exemple.fr') && !traces.join('\n').includes('Brevo 503'));
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

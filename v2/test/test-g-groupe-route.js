'use strict';
// Banc G-GROUPE (2) — le branchement dans le complément de mesures (calcul-client-route.js) : la DEMANDE (preparerComplement) et le JUGEMENT (juger), drapeau V2_G_GROUPE éteint puis allumé.
// L'assertion du drapeau ÉTEINT est écrite en PREMIER : la demande de mesures est celle d'avant, octet pour octet (comparée à MC.ensembleFerme, la référence), aucun champ de plus, aucune décision de plus.
// Sans base, sans réseau : index d'empreintes FABRIQUÉ (un pointeur gelé), contexte G fabriqué, mesures fabriquées.
const H = require('./_harnais');
const G = require('../../ratmarket/decision-g');
const MC = require('../identifier/calcul-client');
const R = require('../identifier/calcul-client-route');
const etatEmpreintes = require('../identifier/etat-empreintes');
const { lireConfig } = require('../config');

const SECRET = 'secret-de-banc-' + 'g-groupe-0123456789abcdef';
const cfgDe = env => ({ ...lireConfig({ MONGODB_BASE: 'test_scratch', ...env }), empreinte: { secret: SECRET }, images: { hotesPublics: ['images.banc.test'] } });
const cfgOff = cfgDe({ V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0' });
const cfgOn = cfgDe({ V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0', V2_G_GROUPE: '1' });
const cfgOn50 = cfgDe({ V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0', V2_G_GROUPE: '1', V2_G_GROUPE_ECART: '80' });

// l'index en place : seul `meta` (chargeLe, n, modele) et `index.contexteG` sont lus
// v1 a une impression sans visuel (carte 1 -> 9001) : G veut sa zone clé ; s2 et s3 sont d'autres cartes, loin ; u1/u2/u3/u4/u5 pour un groupe de cinq
const ctx = G.contexte({
    groupe: {}, carte: { v1: [1], s2: [2], s3: [3], u1: [11], u2: [12], u3: [13], u4: [14], u5: [15], a: [21], b: [22] },
    invisibles: { 1: [9001] }, produits: { v1: [[101, 1]], s2: [[102, 1]], s3: [[103, 1]] }
});
etatEmpreintes.installer(Object.freeze({ index: Object.freeze({ contexteG: ctx }), meta: Object.freeze({ chargeLe: new Date('2026-10-31T10:00:00Z'), n: 9, modele: Object.freeze({ sha256: 'x'.repeat(64) }) }) }));
const ligne = (...tete) => { const top = [...tete]; for (const k of ['a', 'b']) top.push([k, 0.2]); return { top, essai: 1 }; };
const cleDe = id => ({ 101: 'v1', 102: 's2', 103: 's3', 111: 'u1', 112: 'u2', 113: 'u3', 114: 'u4', 115: 'u5' }[id] ?? null);
const resultat = ids => ({ issue: 'question', analyse: { cartes: [{ candidats: ids.map(idProduct => ({ idProduct })) }] } });
const z = (inliers, o = {}) => ({ haut: 0.8, illustration: 0.8, bandeau: 0.8, texte: 0.8, bas: 0.8, inliers, ...o });
const prep = (cfg, ids, tete) => R.preparerComplement({ cfg, scanId: 'a'.repeat(24), attente: { ctx, ligne: ligne(...tete) }, corpsChaine: { success: true }, resultat: resultat(ids), maintenant: 1e12, cleDe });
const cles = ms => ms.map(m => (m.type === 'paire' ? `p:${m.a}|${m.b}` : `z:${m.ref}`));

(async () => {
    // ── 1. DRAPEAU ÉTEINT : la demande est celle d'avant
    const ref = MC.ensembleFerme(ctx, ligne(['v1', 0.9], ['s2', 0.5], ['s3', 0.45]));
    H.v('1a. (référence) G demande la seule zone clé de v1', cles(ref.mesures), ['z:v1']);
    const off = prep(cfgOff, [101, 102, 103], [['v1', 0.9], ['s2', 0.5], ['s3', 0.45]]);
    H.v('1b. éteint : la demande publique est exactement celle de l\'ensemble fermé', [cles(off.public.mesures), off.public.references.map(r => r.ref)], [cles(ref.mesures), ref.refs]);
    H.v('1c. éteint : aucun champ `groupe` stocké', Object.prototype.hasOwnProperty.call(off.stocke, 'groupe'), false);
    H.v('1d. éteint : la demande publique n\'a que ses 4 champs d\'avant', Object.keys(off.public).sort(), ['expireDans', 'jeton', 'mesures', 'references']);
    const vide = MC.ensembleFerme(ctx, ligne(['s2', 0.9], ['s3', 0.4]));
    H.v('1e. (référence) G sans mesure à demander', vide.mesures.length, 0);
    H.v('1f. éteint : aucune demande de mesure => pas de complément (null), comme avant', prep(cfgOff, [102, 103], [['s2', 0.9], ['s3', 0.4]]), null);
    H.v('1g. le drapeau et le seuil par défaut de la configuration', [cfgOff.gGroupe, cfgOff.gGroupeEcart, cfgOn.gGroupe, cfgOn50.gGroupeEcart], [false, 50, true, 80]);

    // ── 2. DRAPEAU ALLUMÉ : les zones du groupe s'ajoutent
    const on = prep(cfgOn, [101, 102, 103], [['v1', 0.9], ['s2', 0.5], ['s3', 0.45]]);
    H.v('2a. allumé : la demande de G d\'abord (inchangée), les zones manquantes du groupe ensuite', cles(on.public.mesures), ['z:v1', 'z:s2', 'z:s3']);
    H.v('2b. allumé : les références couvrent tous les visuels du groupe', on.public.references.map(r => r.ref), ['v1', 's2', 's3']);
    H.v('2c. allumé : le groupe est gardé pour le second envoi', on.stocke.groupe, [{ id: 101, cle: 'v1' }, { id: 102, cle: 's2' }, { id: 103, cle: 's3' }]);
    H.v('2d. allumé : le jeton signe la liste ÉTENDUE (ni la liste d\'avant, ni une liste tronquée ne passent)', [
        MC.verifierJeton(on.public.jeton, { scanId: 'a'.repeat(24), mesures: on.stocke.mesures, refs: on.stocke.refs, maintenant: 1e12 }, SECRET),
        MC.verifierJeton(on.public.jeton, { scanId: 'a'.repeat(24), mesures: ref.mesures, refs: on.stocke.refs, maintenant: 1e12 }, SECRET)], [true, false]);
    H.v('2e. allumé : un G qui ne demande rien peut quand même porter le groupe', cles(prep(cfgOn, [102, 103], [['s2', 0.9], ['s3', 0.4]]).public.mesures), ['z:s2', 'z:s3']);
    H.v('2f. allumé : un candidat sans visuel propre connu : la demande est celle d\'avant', cles(prep(cfgOn, [101, 102, 999], [['v1', 0.9], ['s2', 0.5], ['s3', 0.45]]).public.mesures), cles(ref.mesures));
    H.v('2g. allumé : une question à un seul candidat n\'a pas de groupe : la demande est celle d\'avant', cles(prep(cfgOn, [101], [['v1', 0.9], ['s2', 0.5]]).public.mesures), cles(ref.mesures));
    // au-delà du maximum : 9 mesures de G (deux jumeaux) + 5 visuels neufs > 12 : la demande d'avant, pas de groupe
    const ctx9 = G.contexte({ groupe: { j1: 0, j2: 0, j3: 0, u1: 7, u2: 7, u3: 7, u4: 7, u5: 7 }, carte: { j1: [1], j2: [1], j3: [1], u1: [11], u2: [12], u3: [13], u4: [14], u5: [15], a: [21], b: [22] }, invisibles: {}, produits: {} });
    const L9 = { top: [['j1', 0.9], ['j2', 0.88], ['j3', 0.87], ['a', 0.2], ['b', 0.2]], essai: 1 };
    const base9 = MC.ensembleFerme(ctx9, L9);
    const over = R.preparerComplement({ cfg: cfgOn, scanId: 'b'.repeat(24), attente: { ctx: ctx9, ligne: L9 }, corpsChaine: { success: true }, resultat: resultat([111, 112, 113, 114, 115]), maintenant: 1e12, cleDe });
    H.v('2h. (référence) 9 mesures de G', base9.mesures.length, 9);
    H.v('2i. allumé : 9 + 5 visuels > 12 : la demande d\'avant, aucun groupe', [cles(over.public.mesures), Object.prototype.hasOwnProperty.call(over.stocke, 'groupe')], [cles(base9.mesures), false]);
    const tient = R.preparerComplement({ cfg: cfgOn, scanId: 'b'.repeat(24), attente: { ctx: ctx9, ligne: L9 }, corpsChaine: { success: true }, resultat: resultat([111, 112]), maintenant: 1e12, cleDe });
    H.v('2j. allumé : 9 + 2 = 11 <= 12 : le groupe est demandé', [tient.public.mesures.length, tient.stocke.groupe.length], [11, 2]);

    // une demande de G trop grande (ensemble nul : 16 mesures) : éteint, pas de complément ; allumé, le client ne mesure que le groupe
    const ctx16 = G.contexte({ groupe: { j1: 0, j2: 0, j3: 0, j4: 0, u1: 7, u2: 7 }, carte: { j1: [1], j2: [1], j3: [1], j4: [1], u1: [11], u2: [12], a: [21], b: [22] }, invisibles: {}, produits: {} });
    const L16 = { top: [['j1', 0.9], ['j2', 0.88], ['j3', 0.87], ['j4', 0.86], ['a', 0.2], ['b', 0.2]], essai: 1 };
    const prep16 = (cfg, ids) => R.preparerComplement({ cfg, scanId: 'c'.repeat(24), attente: { ctx: ctx16, ligne: L16 }, corpsChaine: { success: true }, resultat: resultat(ids), maintenant: 1e12, cleDe });
    H.v('2k. (référence) quatre jumeaux : 16 mesures pour G, ensemble nul', MC.ensembleFerme(ctx16, L16), null);
    H.v('2l. éteint : ensemble nul => pas de complément, comme avant', prep16(cfgOff, [111, 112]), null);
    const p16 = prep16(cfgOn, [111, 112]);
    H.v('2m. allumé : ensemble nul => le client ne mesure que les zones du groupe', [cles(p16.public.mesures), p16.public.references.map(r => r.ref), p16.stocke.groupe.length], [['z:u1', 'z:u2'], ['u1', 'u2'], 2]);
    H.v('2n. allumé : ensemble nul ET groupe non demandable (candidat sans visuel) => pas de complément', prep16(cfgOn, [111, 999]), null);

    // ── 3. LE JUGEMENT
    const cmDe = (stocke, mesures = stocke.mesures) => ({ ...stocke, mesures, index: { chargeLe: '2026-10-31T10:00:00.000Z', n: 9, modele: 'x'.repeat(64) }, ligne: stocke.ligne });
    const cm = cmDe(on.stocke);
    const bonnes = (...inl) => cm.mesures.map((m, i) => ({ type: 'zones', ref: m.ref, ...z(inl[i]) }));
    const catalogue = { lire: async () => new Map() };
    const j1 = await R.juger({ cm, resultats: bonnes(30, 291, 31), catalogue, gGroupe: true, ecartMin: 100 });
    H.v('3a. allumé : s2 se détache (291 contre 31 et 30) : la tête est 102, aucune promotion', [j1.ordreGroupe && j1.ordreGroupe.change, j1.ordreGroupe && j1.ordreGroupe.tete, Number.isInteger(j1.promouvoir)], [true, 102, false]);
    const j2 = await R.juger({ cm, resultats: bonnes(30, 291, 31), catalogue, gGroupe: false, ecartMin: 100 });
    H.v('3b. éteint : le résultat n\'a AUCUN champ de plus', Object.prototype.hasOwnProperty.call(j2, 'ordreGroupe'), false);
    const j3 = await R.juger({ cm, resultats: bonnes(30, 120, 31), catalogue, gGroupe: true, ecartMin: 100 });
    H.v('3c. l\'avance est insuffisante : pas de tête', [j3.ordreGroupe.change, j3.ordreGroupe.motif], [false, 'ecart-insuffisant']);
    const j4 = await R.juger({ cm, resultats: bonnes(30, 291, 31), catalogue, gGroupe: true, ecartMin: 270 });
    H.v('3d. le seuil de la configuration commande : 270 refuse ce que 100 accepte (avance de 260)', j4.ordreGroupe.change, false);
    const j5 = await R.juger({ cm, resultats: bonnes(30, 291, 31).slice(0, 2), catalogue, gGroupe: true, ecartMin: 100 });
    H.v('3e. des résultats de la mauvaise longueur : rejetés par la validation du contrat, et AUCUN ordre calculé', [j5.issue, Object.prototype.hasOwnProperty.call(j5, 'ordreGroupe')], ['rejetees-forme', false]);
    const j6 = await R.juger({ cm, resultats: bonnes(30, 291, 31).map((r, i) => (i === 1 ? { ...r, inliers: 3000 } : r)), catalogue, gGroupe: true, ecartMin: 100 });
    H.v('3f. un inliers hors contrat : rejeté, aucun ordre', [j6.issue, Object.prototype.hasOwnProperty.call(j6, 'ordreGroupe')], ['rejetees-valeur', false]);
    const cmSansGroupe = cmDe(off.stocke);
    const j7 = await R.juger({ cm: cmSansGroupe, resultats: cmSansGroupe.mesures.map(m => ({ type: 'zones', ref: m.ref, ...z(291) })), catalogue, gGroupe: true, ecartMin: 100 });
    H.v('3g. une demande sans groupe stocké : pas d\'ordre, même allumé', Object.prototype.hasOwnProperty.call(j7, 'ordreGroupe'), false);
    const j8 = await R.juger({ cm, resultats: bonnes(291, 291, 291), catalogue, gGroupe: true, ecartMin: 100 });
    H.v('3h. trois ex aequo : pas de tête', [j8.ordreGroupe.change, j8.ordreGroupe.motif], [false, 'ecart-insuffisant']);

    H.bilan();
})().catch(e => { console.error('❌', e); process.exitCode = 1; });

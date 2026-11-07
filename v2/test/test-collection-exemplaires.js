'use strict';
// L5/L6 — ÉTAT et LANGUE par exemplaire dans « Ma collection » (décision de l'utilisateur, 07/11). Champs ADDITIFS : `etat` (NM, EX, GD, LP, PL, PO) et `langue` (liste fermée) dans le corps du PUT, et
// `exemplaires` dans le GET d'un set — SEULEMENT quand une fiche en porte. Une collection sans ces champs rend une réponse IDENTIQUE À L'OCTET à celle d'avant.
// MODÈLE : la quantité de la fiche (bit + `qte`, inchangée) reste le TOTAL ; `ex` détaille des exemplaires par (fiche, état, langue) ; la somme du détail ≤ le total, le reste est « non précisé ».
//   · écrire une variante (etat et/ou langue) fixe SA quantité (absente : inchangée sur une variante existante, 1 sur une neuve) ; une hausse est prise d'abord sur les exemplaires non précisés, puis ajoute au total ;
//     une baisse retire du total ; { possedee: false, etat/langue } retire la variante ; { possedee: false } seul retire la fiche ET son détail ;
//   · l'octet : chaque entrée de détail est réservée au pire AVANT d'écrire, rendue au retrait (même compteur que le reste) ; une borne par compte (exemplairesParCompte).
// Base EN MÉMOIRE (INT2), aucun réseau. Les données d'un autre compte ne sont jamais lues.
const H = require('./_harnais');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.78.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-exemplaires.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    H.fixerHorlogeMilieu();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler } = v2; const transport = require('../transport/monter');
    const routes = require('../collection/routes'); const F = require('../collection/forme'); const svc = require('../collection/service'); const VB = require('./_visuels-banc');

    async function compte(o = {}) {
        const adresse = `exe${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, o);
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, adresse, token: s.token, cookie: `rm_session=${s.token}` };
    }
    const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': IP(), ...plus });
    const gestionnaireFinal = (err, req, res, next) => { if (res.headersSent) return next(err); return res.status(500).json({ success: false, error: 'Erreur serveur interne' }); };
    async function serveur(cfgX = cfg) {
        const lot = { enTete() { }, routes(r, c, d) { routes.routesCollection(r, c, d); } };
        const app = express(); app.set('trust proxy', true); transport.enTete(app, cfgX); app.use(express.json()); pret.armer(M.verifierIndex);
        app.use(assembler([lot], cfgX, {})); app.use(gestionnaireFinal);
        return H.serveur(app);
    }
    const sv = await serveur();
    const chemin = (slug, cle) => `/api/collection/sets/${encodeURIComponent(slug)}/fiches/${encodeURIComponent(cle)}`;
    const put = (c, slug, cle, corps, sx = sv) => H.appel(sx.url, chemin(slug, cle), { methode: 'PUT', corps, entetes: siteH(c && c.cookie) });
    const putP = (c, id, corps) => H.appel(sv.url, `/api/collection/produits/${id}`, { methode: 'PUT', corps, entetes: siteH(c && c.cookie) });
    const lire = (c, slug) => H.appel(sv.url, `/api/collection/sets/${encodeURIComponent(slug)}`, { entetes: siteH(c && c.cookie) });
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
    const octets = async () => (await raw('compteurs').findOne({ cle: 'collection-octets' })).n;
    const docs = c => raw('collection_fiches').find({ compteId: c.c._id }).toArray();

    VB.installer([VB.doc(1), VB.doc(2), VB.doc(3)], [['Set-E', '10|001', [1]], ['Set-E', '11|002', [2]], ['Set-E', '12|003', [3]]]);

    // ═══════════════ 1. LA FORME DU CORPS (lireCorps) ═══════════════
    const lc = b => routes.lireCorps(b, 99);
    H.v('1. les listes fermées : états NM EX GD LP PL PO', F.ETATS, ['NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
    H.vrai('   les langues : celles du catalogue (identifier/produit.js) plus id et th, sans doublon', (() => { const P = require('../identifier/produit').LANGUES; return P.every(l => F.LANGUES.includes(l)) && F.LANGUES.includes('id') && F.LANGUES.includes('th') && new Set(F.LANGUES).size === F.LANGUES.length; })());
    H.v('   un corps SANS les nouveaux champs : lu exactement comme avant (aucune variante)', [lc({ possedee: true }), lc({ possedee: true, quantite: 2 }), lc({ possedee: false })].map(x => x.variante === true), [false, false, false]);
    H.v('   etat + langue valides : lus', lc({ possedee: true, etat: 'NM', langue: 'fr', quantite: 2 }), { possedee: true, quantite: 2, etat: 'NM', langue: 'fr', variante: true });
    H.v('   etat seul, langue seule : lus (l\'autre non précisé)', [lc({ possedee: true, etat: 'GD' }), lc({ possedee: true, langue: 'ja' })].map(x => [x.etat ?? null, x.langue ?? null, x.variante]), [['GD', null, true], [null, 'ja', true]]);
    H.v('   { possedee: false, etat } : retrait d\'une variante (admis)', lc({ possedee: false, etat: 'NM' }).variante, true);
    for (const [b, d] of [[{ possedee: true, etat: 'XX' }, 'etat'], [{ possedee: true, etat: 'nm' }, 'etat'], [{ possedee: true, etat: null }, 'etat'], [{ possedee: true, etat: 3 }, 'etat'], [{ possedee: true, etat: '' }, 'etat'],
        [{ possedee: true, langue: 'xx' }, 'langue'], [{ possedee: true, langue: 'FR' }, 'langue'], [{ possedee: true, langue: null }, 'langue'], [{ possedee: true, langue: ['fr'] }, 'langue'], [{ possedee: true, langue: '__proto__' }, 'langue'],
        [{ possedee: false, quantite: 2, etat: 'NM' }, 'quantite'], [{ possedee: true, etat: 'NM', quantite: 100 }, 'quantite'], [{ possedee: true, etat: 'NM', autre: 1 }, 'possedee']]) {
        H.v(`   ${JSON.stringify(b)} → refus, detail ${d}`, lc(b).detail, d);
    }

    // ═══════════════ 2. RIEN N'A BOUGÉ SANS LES CHAMPS (octet pour octet) ═══════════════
    const A = await compte();
    await put(A, 'Set-E', '10|001', { possedee: true, quantite: 3 });
    const sansEx = await lire(A, 'Set-E');
    H.v('2. un set sans exemplaires : PAS de champ `exemplaires` — clés et ordre d\'avant', Object.keys(sansEx.json), ['success', 'set', 'possedees', 'quantites', 'cotes', 'majLe']);
    H.v('   ... et le texte est celui d\'avant, à l\'octet', sansEx.texte, JSON.stringify({ success: true, set: 'Set-E', possedees: ['10|001'], quantites: { '10|001': 3 }, cotes: { '10|001': null, '11|002': null, '12|003': null }, majLe: sansEx.json.majLe }));
    H.vrai('   le document stocké ne porte pas de champ `ex`', !('ex' in (await docs(A))[0]));

    // ═══════════════ 3. ÉCRIRE UNE VARIANTE ═══════════════
    const o0 = await octets();
    const v1 = await put(A, 'Set-E', '11|002', { possedee: true, etat: 'NM', langue: 'fr', quantite: 2 });
    H.v('3. variante NM/fr ×2 sur une fiche NEUVE : 200, 2 cochées dans le set (1 + 1), le total de la fiche est 2', [v1.statut, v1.json], [200, { success: true, possedees: 2 }]);
    const g1 = await lire(A, 'Set-E');
    H.v('   GET : la fiche est cochée, `quantites` = le total, `exemplaires` = le détail (champ APRÈS quantites, avant cotes)', [g1.json.possedees, g1.json.quantites, g1.json.exemplaires, Object.keys(g1.json)],
        [['10|001', '11|002'], { '10|001': 3, '11|002': 2 }, { '11|002': [{ etat: 'NM', langue: 'fr', quantite: 2 }] }, ['success', 'set', 'possedees', 'quantites', 'exemplaires', 'cotes', 'majLe']]);
    const m1 = (await docs(A)).find(d => d.set === 'Set-E').majLe; await attendre(15);
    const v1b = await put(A, 'Set-E', '11|002', { possedee: true, etat: 'NM', langue: 'fr', quantite: 2 });
    H.v('   idempotent : le même PUT ne change RIEN (majLe inchangé, octets inchangés)', [v1b.json, (await docs(A)).find(d => d.set === 'Set-E').majLe.getTime() === m1.getTime()], [v1.json, true]);
    const o1 = await octets();
    await put(A, 'Set-E', '11|002', { possedee: true, etat: 'EX', langue: 'en' });
    const g2 = await lire(A, 'Set-E');
    H.v('   seconde variante EX/en (quantité absente = 1) : le total passe à 3, le détail est trié (état, langue)', [g2.json.quantites['11|002'], g2.json.exemplaires['11|002']], [3, [{ etat: 'EX', langue: 'en', quantite: 1 }, { etat: 'NM', langue: 'fr', quantite: 2 }]]);
    H.vrai('   l\'octet : chaque entrée de détail a été RÉSERVÉE (le compteur a monté à chaque nouvelle entrée)', o1 > o0 && (await octets()) > o1);
    await put(A, 'Set-E', '11|002', { possedee: true, etat: 'PO' });
    await put(A, 'Set-E', '11|002', { possedee: true, langue: 'de', quantite: 2 });
    const g4 = await lire(A, 'Set-E');
    H.v('   état seul et langue seule : l\'autre champ est null dans le détail (non précisé)', g4.json.exemplaires['11|002'].filter(e => e.etat === null || e.langue === null), [{ etat: null, langue: 'de', quantite: 2 }, { etat: 'PO', langue: null, quantite: 1 }]);
    H.v('   ... total = 2 + 1 + 1 + 2 = 6', g4.json.quantites['11|002'], 6);
    // quantité absente sur une variante EXISTANTE : inchangée
    await put(A, 'Set-E', '11|002', { possedee: true, etat: 'NM', langue: 'fr' });
    H.v('   quantité absente sur une variante existante : INCHANGÉE (comme pour la fiche)', (await lire(A, 'Set-E')).json.exemplaires['11|002'].find(e => e.etat === 'NM' && e.langue === 'fr').quantite, 2);

    // ═══════════════ 4. LES NON PRÉCISÉS SONT PRIS D'ABORD ═══════════════
    {
        await put(A, 'Set-E', '12|003', { possedee: true, quantite: 5 });                                    // 5 exemplaires non précisés
        await put(A, 'Set-E', '12|003', { possedee: true, etat: 'NM', langue: 'fr', quantite: 2 });
        let g = (await lire(A, 'Set-E')).json;
        H.v('4. 5 non précisés puis NM/fr ×2 : le total reste 5 (les 2 viennent des non précisés), détail 2', [g.quantites['12|003'], g.exemplaires['12|003']], [5, [{ etat: 'NM', langue: 'fr', quantite: 2 }]]);
        await put(A, 'Set-E', '12|003', { possedee: true, etat: 'NM', langue: 'fr', quantite: 8 });
        g = (await lire(A, 'Set-E')).json;
        H.v('   NM/fr passe à 8 : 3 non précisés absorbés, 3 de plus au total → 8', g.quantites['12|003'], 8);
        await put(A, 'Set-E', '12|003', { possedee: true, etat: 'NM', langue: 'fr', quantite: 1 });
        g = (await lire(A, 'Set-E')).json;
        H.v('   NM/fr redescend à 1 : le total baisse de 7 → 1 (on a retiré des exemplaires)', [g.quantites, g.exemplaires['12|003']], [{ '10|001': 3, '11|002': 6 }, [{ etat: 'NM', langue: 'fr', quantite: 1 }]]);
        const plus = await put(A, 'Set-E', '12|003', { possedee: true, quantite: 0 + 1 });
        H.v('   le PUT par fiche avec une quantité ≥ le détail passe (1 ≥ 1)', plus.statut, 200);
        await put(A, 'Set-E', '12|003', { possedee: true, etat: 'EX', langue: 'it', quantite: 4 });
        const trop = await put(A, 'Set-E', '12|003', { possedee: true, quantite: 3 });
        H.v('   le PUT par fiche avec une quantité INFÉRIEURE au détail (3 < 1 + 4) : 409 CONFLIT, detail « exemplaires », rien n\'a bougé', [trop.statut, code(trop), detail(trop), (await lire(A, 'Set-E')).json.quantites['12|003']], [409, 'CONFLIT', 'exemplaires', 5]);
        const ret = await put(A, 'Set-E', '12|003', { possedee: false, etat: 'EX', langue: 'it' });
        g = (await lire(A, 'Set-E')).json;
        H.v('   { possedee:false, etat, langue } retire LA variante (total 5 → 1), les autres restent', [ret.statut, g.quantites['12|003'] ?? 1, g.exemplaires['12|003']], [200, 1, [{ etat: 'NM', langue: 'fr', quantite: 1 }]]);
        const retB = await put(A, 'Set-E', '12|003', { possedee: false, etat: 'EX', langue: 'it' });
        H.v('   ... idempotent (déjà retirée : 200, rien ne change)', [retB.statut, retB.json.possedees], [200, ret.json.possedees]);
        const retDern = await put(A, 'Set-E', '12|003', { possedee: false, etat: 'NM', langue: 'fr' });
        const gd = (await lire(A, 'Set-E')).json;
        H.v('   retirer la dernière variante d\'une fiche sans non précisé : la fiche est décochée, plus de détail', [retDern.statut, gd.possedees.includes('12|003'), gd.exemplaires && gd.exemplaires['12|003']], [200, false, undefined]);
    }

    // ═══════════════ 5. DÉCOCHER LA FICHE EFFACE SON DÉTAIL, ET L'OCTET REVIENT ═══════════════
    {
        const B = await compte();
        const base = await octets();
        await put(B, 'Set-E', '10|001', { possedee: true, etat: 'LP', langue: 'ja', quantite: 2 });
        await put(B, 'Set-E', '10|001', { possedee: true, etat: 'PL', langue: 'ko', quantite: 1 });
        await put(B, 'Set-E', '11|002', { possedee: true, etat: 'GD', langue: 'es', quantite: 1 });
        const plein = await octets();
        H.vrai('5. trois entrées de détail sur deux fiches : le compteur d\'octets a monté', plein > base);
        const dec = await put(B, 'Set-E', '10|001', { possedee: false });
        const g = (await lire(B, 'Set-E')).json;
        H.v('   PUT { possedee:false } : la fiche et SON détail partent, l\'autre fiche garde le sien', [dec.statut, g.possedees, g.exemplaires], [200, ['11|002'], { '11|002': [{ etat: 'GD', langue: 'es', quantite: 1 }] }]);
        await put(B, 'Set-E', '11|002', { possedee: false });
        H.v('   tout décoché : plus aucun document, et le compteur d\'octets est REVENU exactement à sa valeur d\'avant', [(await docs(B)).length, await octets()], [0, base]);
        // la suppression du compte rend ce que le détail occupe
        const C = await compte(); const b0 = await octets();
        await put(C, 'Set-E', '10|001', { possedee: true, etat: 'NM', langue: 'fr', quantite: 3 });
        await svc.supprimerDuCompte(C.c._id, cfg);
        H.v('   la suppression du compte rend le détail : compteur revenu à sa valeur d\'avant', [(await docs(C)).length, await octets()], [0, b0]);
    }

    // ═══════════════ 6. BORNES ═══════════════
    {
        const D = await compte();
        const r = await put(D, 'Set-E', '10|001', { possedee: true, etat: 'NM', langue: 'fr', quantite: 99 });
        const r2 = await put(D, 'Set-E', '10|001', { possedee: true, etat: 'EX', langue: 'fr', quantite: 1 });
        H.v('6. le total d\'une fiche dépasse 99 : 409 CONFLIT, detail « borne-quantite », rien d\'écrit', [r.statut, r2.statut, code(r2), detail(r2), (await lire(D, 'Set-E')).json.quantites['10|001']], [200, 409, 'CONFLIT', 'borne-quantite', 99]);
        const svp = await serveur({ ...cfg, collection: { ...cfg.collection, exemplairesParCompte: 2 } });
        const E2 = await compte();
        const a = await put(E2, 'Set-E', '10|001', { possedee: true, etat: 'NM', langue: 'fr' }, svp), b = await put(E2, 'Set-E', '11|002', { possedee: true, etat: 'EX', langue: 'fr' }, svp), c = await put(E2, 'Set-E', '12|003', { possedee: true, etat: 'GD', langue: 'fr' }, svp);
        H.v('   exemplairesParCompte = 2 : la troisième entrée de détail est refusée (409 « borne-exemplaires »), rien d\'écrit pour cette fiche', [a.statut, b.statut, c.statut, detail(c), (await lire(E2, 'Set-E')).json.possedees], [200, 200, 409, 'borne-exemplaires', ['10|001', '11|002']]);
        const rep = await put(E2, 'Set-E', '10|001', { possedee: true, etat: 'NM', langue: 'fr', quantite: 4 }, svp);
        H.v('   ... changer la quantité d\'une entrée EXISTANTE au plafond passe (rien n\'est ajouté)', rep.statut, 200);
        await svp.fermer();
    }

    // ═══════════════ 7. PAR PRODUIT, HORS CATALOGUE, ISOLEMENT ═══════════════
    {
        const P = await compte();
        const pp = await putP(P, 1, { possedee: true, etat: 'NM', langue: 'fr', quantite: 2 });
        H.v('7. le PUT par PRODUIT porte les mêmes champs : variante écrite sur la fiche résolue', [pp.statut, pp.json.cle, (await lire(P, 'Set-E')).json.exemplaires], [200, '10|001', { '10|001': [{ etat: 'NM', langue: 'fr', quantite: 2 }] }]);
        const hors = await put(P, 'Set-Hors', '99|001', { possedee: true, etat: 'EX', langue: 'en', quantite: 2 });
        const gh = (await lire(P, 'Set-Hors')).json;
        H.v('   une fiche HORS catalogue (clé dans `hors`) porte aussi son détail', [hors.statut, gh.quantites, gh.exemplaires], [200, { '99|001': 2 }, { '99|001': [{ etat: 'EX', langue: 'en', quantite: 2 }] }]);
        const Q = await compte();
        const gq = await lire(Q, 'Set-E');
        H.v('   un AUTRE compte ne voit ni le détail ni le total de P', [gq.json.possedees, 'exemplaires' in gq.json, 'quantites' in gq.json], [[], false, false]);
        await put(Q, 'Set-E', '10|001', { possedee: true, etat: 'PO', langue: 'fr' });
        const gp = (await lire(P, 'Set-E')).json;
        H.v('   ... Q écrit sur la même fiche : le détail de P est INTACT', gp.exemplaires['10|001'], [{ etat: 'NM', langue: 'fr', quantite: 2 }]);
        H.v('   sans session : 401 (aucune écriture de détail possible)', (await H.appel(sv.url, chemin('Set-E', '10|001'), { methode: 'PUT', corps: { possedee: true, etat: 'NM' }, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() } })).statut, 401);
    }
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

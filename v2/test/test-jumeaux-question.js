'use strict';
// Lot JUMEAUX-QUESTION (2026-10-17) — plus de 3 produits avec les jumeaux : une QUESTION de départage à 3 au lieu d'un « introuvable impression-indeterminee », sans jamais affirmer une carte de plus.
// Partie 1 (module pur) : l'adaptateur et la garde réels sur des COPIES ANONYMISÉES des 72 cartes du banc réel (v2/test/fixtures/banc-reel/jumeaux-question.json) ; le groupe de jumeaux est celui de la
//   VRAIE colonne (chargeur/version.js : creerConstructeur + jumeauxDe) bâtie sur la métacarte de la fixture ; l'adaptateur et le filtre de nom sont ceux de la production.
// Partie 2 (la route et l'ARGENT, base en mémoire du banc, chaîne fabriquée) : la facturation est celle d'une question ordinaire.
const fs = require('fs');
const path = require('path');
const H = require('./_harnais');
const { creerConstructeur } = require('../chargeur/version');
const { adapter } = require('../identifier/adaptateur');
const J = require('../identifier/jumeaux');
const { lireConfig } = require('../config');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'banc-reel', 'jumeaux-question.json'), 'utf8')).cartes;
const cfg = lireConfig({});
const nn = x => (x == null ? null : String(x).trim().toLowerCase().replace(/^0+(?=\d)/, ''));
const img = id => ({ cle: `vignettes/${id}.webp`, w: 200, h: 279 });
const brut = (id, meta) => ({ idProduct: id, vignette: img(id), grande: null, visuel: 'du-set', mention: null, idMetacard: meta, numero: '1', rarete: 'Rare', total: '100', variante: null, setNom: 'S', lien: null });

// la VRAIE colonne des jumeaux d'une carte de la fixture : tous les produits de sa métacarte, créneau (expansion, numéro) et langue de tirage
function version(c, en_plus = []) {
    const b = creerConstructeur();
    for (const p of [...c.produits, ...en_plus]) { b.entree(brut(p.id, c.meta)); b.jumeau({ idProduct: p.id, idMetacard: c.meta, idExpansion: p.exp ?? null, numero: nn(p.numero), tirage: p.tirage ?? null }); }
    return b.finir(new Date('2026-10-12T10:00:00.000Z'));
}
const ligne = p => ({ idProduct: p.id, nomCardmarket: p.nom, nomFr: null, set: { slug: `s${p.exp}`, nom: `Set ${p.exp}`, code: p.codeSet }, numero: p.numero == null ? null : String(p.numero), total: '100', langue: 'FR', variante: null, rarete: 'Rare',
    prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/${p.id}.webp`, w: 255, h: 356 } });
const corpsDe = (c, o = {}) => ({ success: true, scanId: 's1', question: null,
    carte: { idProduct: c.tete, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom: c.lu.nom, nomBrut: c.lu.nom, nomConfiance: 'haute', numero: c.lu.numero, total: c.lu.total, setCode: c.lu.setCode, langue: c.lu.langue, ...o.carte },
    etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, candidats: [{ idProduct: c.tete, score: 9 }], classement: [{ idProduct: c.tete, score: 9 }], reverse: { attendue: false, strategie: null }, codeLangue: 2, ...o.corps });
const monde = (c, o = {}) => {
    const v = version(c, o.enPlus || []);
    const produits = new Map([...c.produits, ...(o.enPlus || [])].map(p => [p.id, ligne(p)]));
    for (const id of (o.sansLigne || [])) produits.delete(id);
    return { v, produits, jumeaux: J.fournisseurDe(v), ctx: { produits, langueInterface: 'fr', cfg, jumeaux: J.fournisseurDe(v) } };
};
const ids = r => r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b);

(async () => {
    H.vrai('la fixture porte les 72 cartes du banc réel, dont au moins 10 et 5 cas où la vérité n\'est PAS la tête', FIX.length === 72 && FIX.filter(c => c.verite !== null && c.verite !== c.tete).length === 5);
    const grosses = FIX.filter(c => { const m = monde(c); const r = m.jumeaux(c.tete); return r.conclu && r.ids.length >= 3; });
    H.vrai(`${grosses.length} des 72 cartes ont plus de 3 produits avec leurs jumeaux selon la VRAIE colonne (le reste : groupe réel plus petit que le proxy)`, grosses.length >= 60);

    // ── (a) plus de 3 produits : une question à 3, P parmi les 3 — rouge avant : introuvable
    const raisonsI = []; let questions = 0, introuvables = 0, pAbsent = 0, pas3 = 0, hors = 0;
    for (const c of grosses) {
        const m = monde(c), r = adapter({ statutHttp: 200, corps: corpsDe(c) }, m.ctx);
        if (r.issue === 'question') {
            questions++;
            const cs = ids(r), groupe = new Set([c.tete, ...m.jumeaux(c.tete).ids]);
            if (!cs.includes(c.tete)) pAbsent++;
            if (cs.length > 3) pas3++;
            if (!cs.every(i => groupe.has(i))) hors++;
        } else { introuvables++; raisonsI.push(r.analyse.cartes[0].raison); }
    }
    // TOUR 1 : les 3 cartes dont la tête est contredite par le nom lu (Lucario/Klink, Cresselia/Hop's Zacian ex, Bebe's Search/Celio's Network) ne deviennent plus une question
    H.v(`(a) ${grosses.length} cartes à plus de 3 produits : les autres deviennent une question, les 3 dont la tête est contredite par le nom lu un introuvable photo-illisible`, [questions, introuvables, raisonsI], [grosses.length - 3, 3, ['photo-illisible', 'photo-illisible', 'photo-illisible']]);
    H.v('(a) chaque question a au plus 3 candidats, contient P, et ne contient que des produits du groupe', [pas3, pAbsent, hors], [0, 0, 0]);
    const un = grosses[0], mu = monde(un), ru = adapter({ statutHttp: 200, corps: corpsDe(un) }, mu.ctx);
    H.v('(a) la question est une vraie question de départage : statut a-trancher, question non nulle, jamais une carte identifiée', [ru.analyse.cartes[0].statut, ru.analyse.cartes[0].carte, Boolean(ru.question)], ['a-trancher', null, true]);

    // ── l'ordre : P d'abord, puis (1) le rang de la chaîne, (2) le numéro lu EXACT, (3) le numéro inconnu, (4) l'idProduct
    let N;
    try { N = require('../identifier/jumeaux-nombreux'); } catch { N = null; }
    H.vrai('le module de choix existe (jumeaux-nombreux.js : choisirTrois)', N && typeof N.choisirTrois === 'function');
    if (N) {
        const mk = (id, numero, nom = 'Tropius') => ({ id, nom, numero, codeSet: 'X', exp: 100 + id, tirage: 'intl' });
        const P = mk(50, '7'), prod = [P, mk(10, '9'), mk(11, null), mk(12, '7'), mk(13, '07'), mk(14, '9'), mk(15, '70')];
        const c0 = { lu: { nom: 'Tropius', numero: '7' }, tete: 50, meta: 1, produits: prod };
        const m0 = monde(c0);
        const jum = m0.jumeaux(50).ids;
        const tri = (corps) => N.choisirTrois({ p: 50, jumeaux: jum, corps, produits: m0.produits });
        H.v('ordre sans classement : P, puis les numéros lus EXACTS (07 = 7), par idProduct', tri(corpsDe(c0)), [50, 12, 13]);
        H.v('   le numéro exact passe devant le numéro inconnu, qui passe devant un autre numéro', N.choisirTrois({ p: 50, jumeaux: [10, 11, 14], corps: corpsDe(c0), produits: m0.produits }), [50, 11, 10]);
        H.v('   le rang du classement de la chaîne passe AVANT le numéro lu', tri(corpsDe(c0, { corps: { classement: [{ idProduct: 50 }, { idProduct: 14 }, { idProduct: 10 }] } })), [50, 14, 10]);
        H.v('   sans classement, les candidats du corps tiennent lieu de rang', tri(corpsDe(c0, { corps: { classement: [], candidats: [{ idProduct: 50 }, { idProduct: 15 }] } })), [50, 15, 12]);
        H.v('   aucun numéro lu : l\'idProduct seul décide (jamais un prix)', N.choisirTrois({ p: 50, jumeaux: jum, corps: corpsDe(c0, { carte: { numero: null } }), produits: m0.produits }), [50, 10, 11]);
        H.v('   P est TOUJOURS en premier, même quand un jumeau a un meilleur rang', tri(corpsDe(c0, { corps: { classement: [{ idProduct: 12 }, { idProduct: 50 }] } }))[0], 50);
        H.v('   deux jumeaux seulement : P et eux (jamais complété)', N.choisirTrois({ p: 50, jumeaux: [12, 13], corps: corpsDe(c0), produits: m0.produits }), [50, 12, 13]);
        H.v('   une ligne de catalogue manquante : pas de choix (null), jamais un choix tronqué', N.choisirTrois({ p: 50, jumeaux: [12, 13, 999], corps: corpsDe(c0), produits: m0.produits }), null);
    }

    // ── (b) 2 et 3 produits : inchangé ; (c) sans jumeau : l'affirmation, inchangée
    const ligneB = (id, nom = 'Roaring Moon ex') => ({ id, nom, numero: String(id), codeSet: 'X', exp: id, tirage: 'intl' });
    const petit = { lu: { nom: 'Roaring Moon ex', numero: '700' }, tete: 700, meta: 7, produits: [ligneB(700), ligneB(701), ligneB(702), ligneB(703)] };
    const unPair = (n) => { const c = { ...petit, produits: petit.produits.slice(0, n) }; const m = monde(c); return adapter({ statutHttp: 200, corps: corpsDe(c) }, m.ctx); };
    const r3 = unPair(3), r2 = unPair(2), r1 = unPair(1);
    H.v('(b) P + 2 jumeaux (3 produits) : question à 3, comme avant', [r3.issue, ids(r3)], ['question', [700, 701, 702]]);
    H.v('(b) P + 1 jumeau (2 produits) : question à 2, comme avant', [r2.issue, ids(r2)], ['question', [700, 701]]);
    H.v('(c) sans jumeau : affirmée, comme avant', [r1.issue, r1.analyse.cartes[0].statut, r1.analyse.cartes[0].carte.idProduct], ['affirmee', 'identifiee', 700]);
    const sansColonne = adapter({ statutHttp: 200, corps: corpsDe(petit) }, { produits: monde(petit).produits, langueInterface: 'fr', cfg });
    H.v('(c) sans fournisseur de jumeaux : toujours la PANNE INDISPONIBLE (rien affirmé, rien demandé)', [sansColonne.issue, sansColonne.erreur && sansColonne.erreur.code], ['panne', 'INDISPONIBLE']);
    const toutesAffirmees = FIX.filter(c => { const r = monde(c).jumeaux(c.tete); return r.conclu && r.ids.length === 0; });
    H.vrai(`(c) AUCUNE affirmation nouvelle : sur les 72 cartes, aucune n'est affirmée (il y en a ${toutesAffirmees.length} sans jumeau selon la colonne)`, FIX.every(c => { const m = monde(c); const r = adapter({ statutHttp: 200, corps: corpsDe(c) }, m.ctx); return r.issue !== 'affirmee' || m.jumeaux(c.tete).ids.length === 0; }));

    // ── (e) un candidat au nom contredit n'entre pas dans la question (filtre de CONFIRMATION-SURE)
    {
        const c = { ...petit, produits: [ligneB(700), ligneB(701), ligneB(702), ligneB(703), ligneB(704, 'Charizard VMAX'), ligneB(705)] };
        const m = monde(c);
        const r = adapter({ statutHttp: 200, corps: corpsDe(c, { carte: { numero: '704' } }) }, m.ctx);
        H.v('(e) « Charizard VMAX » porte le numéro lu (704) mais son nom est contredit par « Roaring Moon ex » (confiance haute) : il n\'est PAS montré', [r.issue, ids(r).includes(704), ids(r).includes(700)], ['question', false, true]);
        const bas = adapter({ statutHttp: 200, corps: corpsDe(c, { carte: { numero: '704', nomConfiance: 'basse' } }) }, m.ctx);
        H.v('   nom lu en confiance basse : le veto est désarmé (704 reste candidat, il porte le numéro lu)', [bas.issue, ids(bas).includes(704)], ['question', true]);
        // TOUR 1 (I2) : un seul candidat restant après le filtre => le repli d'avant (jamais une confirmation à 1 candidat dans la voie « plus de 3 jumeaux »)
        const tous = { ...c, produits: [ligneB(700), ligneB(704, 'Charizard VMAX'), ligneB(705, 'Charizard VMAX'), ligneB(706, 'Charizard VMAX'), ligneB(707, 'Charizard VMAX')] };
        const mt = monde(tous), rt = adapter({ statutHttp: 200, corps: corpsDe(tous) }, mt.ctx);
        H.v('   (I2) tous les jumeaux contredits, P compatible : UN seul restant => introuvable impression-indeterminee / jumeaux-trop-nombreux, jamais une question à 1 candidat', [rt.issue, rt.analyse.cartes[0].raison, rt.motif], ['introuvable', 'impression-indeterminee', 'jumeaux-trop-nombreux']);
        // TOUR 1 (I1) : P passe AUSSI par le filtre ; plus aucun candidat => introuvable photo-illisible
        const toutContredit = { ...c, produits: [ligneB(700, 'Klink'), ligneB(704, 'Charizard VMAX'), ligneB(705, 'Charizard VMAX'), ligneB(706, 'Charizard VMAX'), ligneB(707, 'Charizard VMAX')] };
        const mc = monde(toutContredit), rc = adapter({ statutHttp: 200, corps: corpsDe(toutContredit, { carte: { nom: 'Lucario', nomBrut: 'Lucario' } }) }, mc.ctx);
        H.v('   (I1) P ET tous les jumeaux contredits par le nom lu : introuvable photo-illisible, aucun candidat proposé', [rc.issue, rc.analyse.cartes[0].raison, rc.analyse.cartes[0].candidats], ['introuvable', 'photo-illisible', []]);
        const pSeul = { ...c, produits: [ligneB(700, 'Klink'), ligneB(701), ligneB(702), ligneB(703), ligneB(705)] };
        const mp = monde(pSeul), rpp = adapter({ statutHttp: 200, corps: corpsDe(pSeul, { carte: { nom: 'Roaring Moon ex', nomBrut: 'Roaring Moon ex' } }) }, mp.ctx);
        H.v('   (I1) P contredit mais 4 jumeaux compatibles : question à 3 SANS P (jamais proposé)', [rpp.issue, ids(rpp).includes(700), ids(rpp).length], ['question', false, 3]);
        // les cas réels de la fixture : lu « Lucario » (P = Klink) et « Cresselia » (P = Hop's Zacian ex)
        for (const [tete, nom] of [[863808, 'Klink'], [863829, 'Hop\'s Zacian ex']]) {
            const cf = FIX.find(x => x.tete === tete), mf = monde(cf), rf = adapter({ statutHttp: 200, corps: corpsDe(cf) }, mf.ctx);
            H.v(`   (I1) fixture réelle, P = « ${nom} » contredit par « ${cf.lu.nom} » : aucune question ne le propose`, rf.issue === 'question' && ids(rf).includes(tete), false);
            H.v('      issue de ce cas', [rf.issue, rf.analyse.cartes[0].raison], ['introuvable', 'photo-illisible']);
        }
    }

    // ── repli : un jumeau sans ligne au catalogue de l'API => comme avant (introuvable impression-indeterminee, motif jumeaux-trop-nombreux), jamais un choix tronqué
    {
        const m = monde(petit, { sansLigne: [703] }), r = adapter({ statutHttp: 200, corps: corpsDe(petit) }, m.ctx);
        H.v('repli : plus de 3 produits dont un SANS ligne : introuvable impression-indeterminee / jumeaux-trop-nombreux (comme avant)', [r.issue, r.analyse.cartes[0].raison, r.motif], ['introuvable', 'impression-indeterminee', 'jumeaux-trop-nombreux']);
    }
    // ── les compteurs : une question née d'un groupe trop grand est comptée à part
    {
        // TOUR 1 (M2) : un seul journal, au repli. Une question rendue normalement n'écrit RIEN (ni compteur ni ligne de journal)
        const lignes = []; const w = console.warn; console.warn = (...a) => lignes.push(a.join(' '));
        const avant = J.compteurs(); try { unPair(4); } finally { console.warn = w; } const apres = J.compteurs();
        H.v('compteurs : une question à 3 ne compte rien (aucun jumeaux-trop-nombreux)', apres['jumeaux-trop-nombreux'] - avant['jumeaux-trop-nombreux'], 0);
        H.v('   et n\'écrit aucune ligne de journal', lignes, []);
        const l2 = []; console.warn = (...a) => l2.push(a.join(' '));
        try { const m = monde(petit, { sansLigne: [703] }); adapter({ statutHttp: 200, corps: corpsDe(petit) }, m.ctx); } finally { console.warn = w; }
        H.v('   le repli écrit UNE ligne, sans donnée de scan (ni nom lu, ni numéro lu)', [l2.length, /Roaring/.test(l2.join(' '))], [1, false]);
    }
    // ── la route charge les jumeaux d'un groupe trop grand pour une question (jusqu'à la borne), pas au-delà
    {
        const f = J.fournisseurDe(monde({ ...petit, produits: [ligneB(700), ligneB(701), ligneB(702), ligneB(703), ligneB(704)] }).v);
        const aff = { success: true, carte: { idProduct: 700, ambigu: false }, candidats: [{ idProduct: 700 }] };
        H.v('idsACharger : P + 4 jumeaux => les 4 jumeaux sont chargés (le choix des 3 a besoin de leurs lignes)', J.idsACharger(aff, f), [701, 702, 703, 704]);
        H.v('   au-delà de la borne de chargement : rien (repli : introuvable, jamais un chargement sans fin)', J.idsACharger(aff, () => ({ conclu: true, ids: Array.from({ length: J.MAX_CHARGE + 1 }, (_, i) => 1000 + i) })), []);
    }

    // ═════ PARTIE 2 — la route et l'ARGENT (base en mémoire du banc, chaîne fabriquée) ═════
    const mongoose = require('mongoose');
    const db = require('../db'); const M = require('../modeles'); const Jt = require('../comptes/jetons'); const Q = require('./_aide-quota');
    const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
    const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(x => x.cellule === 'occidentale').imageUrl;
    const cfgR = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_SANS_COMPTE: '1000' });
    let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
    let nCle = 0; const cle = () => `banc-jq-${Date.now().toString(36)}-${++nCle}`;
    const raw = n => mongoose.connection.db.collection(n);
    const VB = require('./_visuels-banc'); const VIS = [];
    const [A, B, C, D, E] = [896001, 896002, 896003, 896004, 896005], EXP = 990021;
    const numeros = { [A]: '001', [B]: '002', [C]: '001', [D]: null, [E]: '001' };
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-jumeaux-question.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const n of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(n).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A, B, C, D, E]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990222 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, ...(numeros[id] ? { numero: numeros[id], numeroUrl: `PBL${numeros[id]}` } : {}), codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante: 'normale', idMetacard: 990222 }));
    }
    VB.installer(VIS);
    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null });
    const chaine = async (req, res) => res.json({ success: true, scanId: String(req.scanIdImpose), question: null, carte: { idProduct: A, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false, nomConfiance: 'haute', nomBrut: 'Tropius' },
        etat: ETAT, candidats: [cand(A)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const sv = await (async () => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgR, { jumeaux: id => ({ conclu: true, ids: id === A ? [B, C, D, E] : [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }) }));
        return H.serveur(app);
    })();
    const inst = async () => { const jeton = Jt.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: Jt.empreinte(jeton), essais: 3, libelle: 'banc' }); await db.col('installations').insertOne(i); await Q.poserRestant(`installation:${i._id}`, 3); return { i, jeton }; };
    const ref = n => ({ $ref: `#/components/schemas/${n}` });
    let ecartsContrat = 0;
    const poster = async jeton => {
        const r = await H.appel(sv.url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { origin: cfgR.origines.extension, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
        if (r.json && r.json.success === true) { const vv = valider(r.json, ref('ReponseAnalyse'), SCHEMA); if (!vv.ok) { ecartsContrat++; console.log(`   écart de contrat : ${vv.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
        return r;
    };
    const repondre = async (jeton, b) => {
        const r = await H.appel(sv.url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: { origin: cfgR.origines.extension, ...ip(), authorization: `Bearer ${jeton}` } });
        if (r.json && r.json.success === true) { const vv = valider(r.json, ref('ReponseQuestion'), SCHEMA); if (!vv.ok) { ecartsContrat++; console.log(`   écart de contrat : ${vv.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
        return r;
    };
    const livre = async x => { const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray(); return { essais: await Q.restantDe({ type: 'installation', id: x.i._id }, cfgR), net: mv.reduce((s, m) => s + m.delta, 0), mouvements: mv.length, ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length }; };
    const compteurDe = async (x, type) => (await raw('plafonds').findOne({ porteur: `installation:${x.i._id}`, type }) || {}).count ?? 0;

    const s1 = await inst(); const r1b = await poster(s1.jeton), j1 = r1b.json || {}, c0 = j1.analyse && j1.analyse.cartes[0];
    H.v('(d) la chaîne affirme A, qui a 4 jumeaux (5 produits) : 200, a-trancher, UNE question de départage à 3 — A, puis les deux numéros lus exacts (C, E), jamais B (autre numéro) ni D (inconnu)',
        [r1b.statut, c0 && c0.statut, c0 && c0.candidats.map(x => x.idProduct).sort((a, b) => a - b), c0 && c0.carte], [200, 'a-trancher', [A, C, E], null]);
    H.v('(d) facturation d\'une question ordinaire : RÉSERVÉE { debite:0, reserve:1, rembourse:false, motif:question }, solde 3 -> 2', [j1.facturation, j1.offre && j1.offre.restant], [{ debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null }, 2]);
    H.v('   grand livre : un débit « reserve », aucun remboursement', await livre(s1), { essais: 2, net: -1, mouvements: 1, ouverts: ['reserve'], remboursements: 0 });
    const q1 = await raw('questions_v2').findOne({ _id: `${j1.scanId}:0` });
    H.v('   la question est écrite en attente avec les 3 choix du contrat', [q1 && q1.etat, q1 && q1.choix.map(x => x.idProduct).sort((a, b) => a - b)], ['en-attente', [A, C, E]]);
    const oui = await repondre(s1.jeton, { scanId: j1.scanId, carte: 0, choix: 'b' }), jo = oui.json || {};
    H.v('(d) répondre par un candidat : identifiee, débité UNE fois { debite:1, motif:question } — le seul moyen d\'obtenir une carte', [oui.statut, jo.carte && jo.carte.statut, [A, C, E].includes(jo.carte && jo.carte.carte && jo.carte.carte.idProduct), jo.facturation && jo.facturation.debite, jo.facturation && jo.facturation.rembourse], [200, 'identifiee', true, 1, false]);
    const s2 = await inst(); const r2b = await poster(s2.jeton);
    const non = await repondre(s2.jeton, { scanId: r2b.json.scanId, carte: 0, choix: 'aucune' }), jn = non.json || {};
    H.v('(d) « aucune » = une DÉCLARATION : introuvable, crédit rendu UNE fois, compté au plafond des déclarations (sans compte : 1 par jour)', [jn.carte && jn.carte.statut, jn.facturation && jn.facturation.rembourse, await livre(s2), await compteurDe(s2, 'declare'), await compteurDe(s2, 'jumeaux')], ['introuvable', true, { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, 1, 0]);
    const s3 = await inst(); const r3b = await poster(s3.jeton);
    await raw('plafonds').insertOne({ porteur: `installation:${s3.i._id}`, jour: Q.jourCourant(), type: 'declare', count: cfgR.plafonds.declares.sansCompte, expireLe: new Date(Date.now() + 3 * 86400e3) });
    const nonPlein = await repondre(s3.jeton, { scanId: r3b.json.scanId, carte: 0, choix: 'aucune' }), jp = nonPlein.json || {};
    H.v('(d) CONSÉQUENCE : plafond des déclarations plein (sans compte : 1/jour) => « aucune » ne rend rien et le dit { debite:1, rembourse:false, raisonNonRembourse:plafond-jour } — l\'introuvable d\'avant était rendu sans plafond',
        [jp.facturation && jp.facturation.debite, jp.facturation && jp.facturation.rembourse, jp.facturation && jp.facturation.raisonNonRembourse], [1, false, 'plafond-jour']);
    const s4 = await inst(); const r4b = await poster(s4.jeton);
    const ns = await repondre(s4.jeton, { scanId: r4b.json.scanId, choix: 'ne-sait-pas' }), jns = ns.json || {};
    H.v('(d) « ne-sait-pas » : la carte reste à trancher, crédit rendu une fois', [jns.carte && jns.carte.statut, jns.facturation && jns.facturation.rembourse, (await livre(s4)).remboursements], ['a-trancher', true, 1]);
    H.v('toutes les réponses de la route sont conformes au contrat publié', ecartsContrat, 0);
    // TOUR 1 (M1) : au-delà de 60 jumeaux la route ne charge rien (borne de chargement) : le repli d'avant, au niveau de la ROUTE, remboursé sans plafond, aucune question
    {
        const ids61 = [B, C, D, E, ...Array.from({ length: 57 }, (_, i) => 960000 + i)];
        const mk = n => (async () => {
            const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, nx) => dansUnScan(nx));
            pret.armer(require('../modeles').verifierIndex);
            app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgR, { jumeaux: id => ({ conclu: true, ids: id === A ? n : [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }) }));
            return H.serveur(app);
        })();
        const svG = await mk(ids61), svH = await mk([...ids61, 960900]);
        const posterSur = async (s, jeton) => H.appel(s.url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { origin: cfgR.origines.extension, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
        const xg = await inst(), rg = await posterSur(svG, xg.jeton), jg = rg.json || {};
        H.v('(M1) 61 jumeaux (borne de chargement 60 dépassée) : la route ne charge pas les jumeaux, repli introuvable impression-indeterminee, remboursé, aucune question',
            [jg.analyse && jg.analyse.cartes[0].statut, jg.analyse && jg.analyse.cartes[0].raison, jg.facturation && jg.facturation.rembourse, (await livre(xg)).essais, await raw('questions_v2').countDocuments({ 'porteur.id': xg.i._id, etat: 'en-attente' })], ['introuvable', 'impression-indeterminee', true, 3, 0]);
        const xh = await inst(), rh = await posterSur(svH, xh.jeton), jh = rh.json || {};
        H.v('   62 jumeaux : de même', [jh.analyse && jh.analyse.cartes[0].raison, jh.facturation && jh.facturation.rembourse], ['impression-indeterminee', true]);
        await svG.fermer(); await svH.fermer();
    }
    await sv.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ EXCEPTION', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

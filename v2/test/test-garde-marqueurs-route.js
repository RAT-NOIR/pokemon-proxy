'use strict';
// MARQUEURS P4 — la ROUTE et l'ARGENT : le jumbo par le titre (V2_JUMBO_TITRE) et la garde des groupes (V2_GARDE_MARQUEURS), du débit à la réponse. Base EN MÉMOIRE du banc, aucun réseau, aucun appel payant :
// la chaîne héritée est FABRIQUÉE. Ce que le banc tient : éteints (défaut), la réponse est la même OCTET POUR OCTET et `analyses` ne porte aucun champ nouveau ; allumés, SEULS les cas visés changent, avec le bon argent
// (un sûr redevenu question RÉSERVE son crédit ; une question tranchée par le titre est RÉPONDUE par le Jumbo, débit « debite »). La version d'archive, le catalogue et les marqueurs servis sont ceux du service.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const base = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' };
const cfgOff = lireConfig(base);
const cfgJumbo = lireConfig({ ...base, V2_JUMBO_TITRE: '1' }), cfgGarde = lireConfig({ ...base, V2_GARDE_MARQUEURS: '1' }), cfgDeux = lireConfig({ ...base, V2_JUMBO_TITRE: '1', V2_GARDE_MARQUEURS: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.16.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-marqueurs-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const E = require('../chargeur/etat'); const { creerConstructeur } = require('../chargeur/version'); const VB = require('./_visuels-banc');
const S = 896001, R = 896002, N = 896011, JB = 896012, EXPS = 991001, EXPJ = 991002, METAS = 991101, METAJ = 991102;
let ecartsContrat = 0;

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function poster(url, jeton, titre) {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: titre, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' },
        entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
    if (r.json && r.json.success === true && r.json.contrat === 2) { const v = valider(r.json, ref('ReponseAnalyse'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    return { net: mv.reduce((s, m) => s + m.delta, 0), ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length };
}
const PAYE = { net: -1, ouverts: ['debite'], remboursements: 0 }, RESERVE = { net: -1, ouverts: ['reserve'], remboursements: 0 };
const analyseDe = scanId => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanId) });
const norm = s => String(s).replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
const ids = c0 => c0.candidats.map(c => c.idProduct);

(async () => {
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-garde-marqueurs-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'depense_modele']) await raw(c).deleteMany({});
    for (const [e, code] of [[EXPS, 'PMS'], [EXPJ, 'PMJ']]) await raw('codes_set').insertOne({ idExpansion: e, codeSet: code, apprisLe: new Date() });
    for (const [id, exp, meta, code, numero] of [[S, EXPS, METAS, 'PMS', '11'], [R, EXPS, METAS, 'PMS', '11'], [N, EXPJ, METAJ, 'PMJ', '12'], [JB, EXPJ, METAJ, 'PMJ', '12']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Pikachu', idExpansion: exp, idMetacard: meta });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: exp, numero, numeroUrl: `${code}${numero}`, codeSet: code, nomFr: 'Pikachu', slug: `Pikachu-${code}${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    }
    // l'archive : DEUX groupes de même dessin (même fichier, même métacarte, même numéro, même nom de set) : staff / normale, et jumbo / normale
    const pair = (cle, id, meta, numero, variante) => VB.doc(id, { idMetacard: meta, numero, variante, total: '131', vignette: { cle: `banc/${cle}.webp`, w: 300, h: 420 } });
    const b = creerConstructeur({ marquages: true });
    for (const d of [pair('groupe-s', S, METAS, '11', 'staff'), pair('groupe-s', R, METAS, '11', 'normale'), pair('groupe-j', N, METAJ, '12', 'normale'), pair('groupe-j', JB, METAJ, '12', 'jumbo')]) b.entree(d);
    E.installer(b.finir());

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = 'sur';
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = (id, numero) => ({ idProduct: id, nom: 'Pikachu', numero, set: 'Banc Set', prix: 1, photoUrl: null });
    const enTete = { etat: ETAT, classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 };
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        if (mode === 'question-jumbo') {                                     // la chaîne POSE la question { normale, jumbo } (réserve le crédit)
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [N, JB] });
            return res.json({ success: true, scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, ...enTete, candidats: [cand(N, '12'), cand(JB, '12')], carte: { idProduct: N, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '12', setCode: 'PMJ', total: '131', rarete: null, langue: 'FR', ambigu: true } });
        }
        // la chaîne AFFIRME S (la staff) en lisant les deux produits du groupe parmi ses candidats ; aucun jumeau, aucune paire marquée : seule la garde des groupes peut en faire une question
        return res.json({ success: true, scanId: sid, question: null, ...enTete, candidats: [cand(S, '11'), cand(R, '11')], carte: { idProduct: S, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '11', setCode: 'PMS', total: '131', rarete: null, langue: 'FR', ambigu: false } });
    };
    const monter = async (cfgApp) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), voisinsEmpreinte: async () => ({ ok: false, code: 'muette' }) }));
        return H.serveur(app);
    };
    const scan = async (s, m, titre = null) => { mode = m; const x = await inst(3); const r = await poster(s.url, x.jeton, titre); const j = r.json || {}; return { ...x, r, j, scanId: j.scanId, c0: j.analyse && j.analyse.cartes[0] }; };
    const ligneQ = async scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });
    const sOff = await monter(cfgOff), sJumbo = await monter(cfgJumbo), sGarde = await monter(cfgGarde), sDeux = await monter(cfgDeux);
    H.vrai('0. les configurations : éteintes par défaut, chaque drapeau seul, les deux', !cfgOff.jumboTitre && !cfgOff.gardeMarqueurs && cfgJumbo.jumboTitre && !cfgJumbo.gardeMarqueurs && !cfgGarde.jumboTitre && cfgGarde.gardeMarqueurs && cfgDeux.jumboTitre && cfgDeux.gardeMarqueurs);

    // ── 1. ÉTEINT : le sûr de la chaîne reste un sûr (la staff), la question reste une question ; `analyses` sans champ neuf
    const ref1 = await scan(sOff, 'sur'), refQ = await scan(sOff, 'question-jumbo', 'Pikachu jumbo');
    H.v('1a. éteint : la chaîne affirme S (staff) : identifiee, S, débit « debite » ; avec le groupe { normale, jumbo } et un titre « jumbo » : la QUESTION, crédit réservé', [ref1.c0.statut, ref1.c0.carte.idProduct, await livre(ref1), refQ.c0.statut, ids(refQ.c0), await livre(refQ)], ['identifiee', S, PAYE, 'a-trancher', [N, JB], RESERVE]);
    H.v('1b. les marqueurs sont SERVIS (champ additif) : S porte STAFF, R est prouvé sans marqueur, JB porte JUMBO + NON_LEGAL', [ref1.c0.carte.marqueurs.map(m => m.type), ref1.c0.candidats.length, refQ.c0.candidats.find(c => c.idProduct === JB).marqueurs.map(m => m.type), refQ.c0.candidats.find(c => c.idProduct === N).marqueurs], [['STAFF'], 0, ['JUMBO', 'NON_LEGAL'], []]);
    const off2 = await scan(sJumbo, 'sur'), offQ = await scan(sGarde, 'question-jumbo', 'Pikachu jumbo');
    H.v('1c. un SEUL drapeau allumé ne change pas l\'autre règle : jumbo seul laisse le sûr de la staff (le rival de groupe n\'est pas regardé) ; garde seule laisse la question du titre « jumbo » (le titre n\'est pas lu)', [off2.c0.statut, off2.c0.carte.idProduct, offQ.c0.statut], ['identifiee', S, 'a-trancher']);
    H.v('1d. éteint, `analyses` ne porte AUCUN champ regleMarqueurs ; la réponse est identique octet pour octet à celle du drapeau qui ne s\'applique pas', [Object.keys(await analyseDe(ref1.scanId)).includes('regleMarqueurs'), norm(JSON.stringify(off2.j)) === norm(JSON.stringify(ref1.j))], [false, true]);

    // ── 2. V2_JUMBO_TITRE : le titre « jumbo » sans négation tranche la question { normale, jumbo } en faveur du JUMBO, jamais l'inverse
    {
        const a = await scan(sJumbo, 'question-jumbo', 'Pikachu jumbo promo');
        const q = await ligneQ(a.scanId), an = await analyseDe(a.scanId);
        H.v('2a. titre « jumbo » : identifiee, le produit JUMBO (jamais la normale), facturation affirmée ; le grand livre : question RÉPONDUE par le Jumbo, un débit « debite »', [a.c0.statut, a.c0.carte && a.c0.carte.idProduct, a.j.facturation.motif, await livre(a), q && q.etat, q && q.choix.map(x => x.idProduct)], ['identifiee', JB, 'affirmee', PAYE, 'repondue', [JB]]);
        H.v('   le journal dit pourquoi (règle, issue, terme, produit) ; jamais servi au client', [an.regleMarqueurs && an.regleMarqueurs.regle, an.regleMarqueurs && an.regleMarqueurs.issue, an.regleMarqueurs && an.regleMarqueurs.terme, an.regleMarqueurs && an.regleMarqueurs.produit, JSON.stringify(a.j).includes('regleMarqueurs')], ['jumbo-titre', 'sur', 'jumbo', JB, false]);
        const tout = [];
        for (const t of ['Pikachu 025', 'pas de jumbo', 'not oversized', 'jumbo taille normale', null]) { const x = await scan(sJumbo, 'question-jumbo', t); tout.push([x.c0.statut, ids(x.c0), (await livre(x)).ouverts]); }
        H.v('2b. aucun terme, négation, « taille normale », pas de titre : la QUESTION d\'avant ({normale, jumbo}), crédit réservé — JAMAIS la version normale affirmée sur l\'absence du mot', tout, Array(5).fill(['a-trancher', [N, JB], ['reserve']]));
        const d = await scan(sDeux, 'question-jumbo', 'Pikachu XXL');
        H.v('2c. les deux drapeaux : le titre affirme le Jumbo et la garde des groupes le LAISSE (le critère « jumbo (titre) » est un signal réel de ce qui les sépare)', [d.c0.statut, d.c0.carte && d.c0.carte.idProduct, (await analyseDe(d.scanId)).regleMarqueurs.garde.issue], ['identifiee', JB, 'sur-confirme']);
    }

    // ── 3. V2_GARDE_MARQUEURS : un sûr de la chaîne dont le produit a un rival de groupe aux marqueurs différents redevient une QUESTION (crédit réservé)
    {
        const a = await scan(sGarde, 'sur');
        const an = await analyseDe(a.scanId), q = await ligneQ(a.scanId);
        H.v('3a. la chaîne affirme S (staff), R (normale, même dessin) est connue : la question { S, R }, crédit RÉSERVÉ, une question écrite — plus de sûr', [a.c0.statut, ids(a.c0), await livre(a), q && q.etat, q && q.choix.map(x => x.idProduct).sort()], ['a-trancher', [S, R], RESERVE, 'en-attente', [S, R]]);
        H.v('   le journal : règle, issue « question », le produit, le rival, le retour « question du groupe » ; jamais servi', [an.regleMarqueurs.garde.regle, an.regleMarqueurs.garde.issue, an.regleMarqueurs.garde.produit, an.regleMarqueurs.garde.rivaux, an.regleMarqueurs.garde.retour, JSON.stringify(a.j).includes('regleMarqueurs')], ['garde-marqueurs', 'question', S, [R], 'question-du-groupe', false]);
        const dd = await scan(sDeux, 'sur', 'Pikachu jumbo');
        H.v('3b. avec les deux drapeaux, un titre « jumbo » ne couvre PAS l\'écart d\'un TAMPON (staff / normale) : la garde rend la question', [dd.c0.statut, ids(dd.c0)], ['a-trancher', [S, R]]);
        const sans = await scan(sGarde, 'question-jumbo', 'Pikachu');
        H.v('3c. une QUESTION n\'est jamais touchée par la garde (seulement un sûr)', [sans.c0.statut, ids(sans.c0), await livre(sans)], ['a-trancher', [N, JB], RESERVE]);
    }
    for (const s of [sOff, sJumbo, sGarde, sDeux]) await s.fermer();
    H.v('contrat : toutes les réponses valident le schéma publié', ecartsContrat, 0);
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

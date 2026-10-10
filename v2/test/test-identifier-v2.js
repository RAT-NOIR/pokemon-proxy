'use strict';
// Banc B1b.3 — traiterIdentifier : du débit à la réponse. L'ARGENT RENCONTRE LA CHAÎNE.
// Base : la base EN MÉMOIRE du banc (INT2) — jamais la production, ni la grappe, ni R2. Aucune requête réseau réelle : le serveur ENFANT charge le faux réseau du verrou.
// Trois montages :
//   · DEUX serveurs enfants (index.js réel, faux réseau) : v2 éteinte / v2 allumée — la VRAIE chaîne héritée, hors ligne ;
//   · une app en processus, dont la chaîne héritée est une CHAÎNE FABRIQUÉE (deps.gererIdentifier) : seule façon de produire un verdict FERME (le faux
//     réseau, avec un catalogue fabriqué, ne rend que des questions : la cassette TCGdex a été enregistrée avec le pont `cartes`, absent d'un banc) et
//     de fabriquer chaque ligne de la table de facturation (plafond atteint, exception, produit absent…).
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const { verifierEntree } = require('../identifier/routes'); const { preparerAnnonce } = require('../annonce/verifier');
const { choixPour } = require('../choix');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const charges = require(CHARGES).charges;
const IMAGE = charges.find(c => c.cellule === 'occidentale').imageUrl;      // Tropius PBL 001 : la lecture rejouée par le faux réseau
const IMAGE_INCONNUE = 'https://images1.vinted.net/t/00_rm-b1b3/f800/inconnue.webp';   // aucune lecture enregistrée : le service de lecture « tombe »
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
let nIp = 0;
const ip = () => { nIp++; return { 'x-forwarded-for': `10.7.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0;
const cle = () => `banc-b1b3-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const toutes = [];                                          // toutes les réponses reçues (assertion 13 : CORS sur chacune)
let ecartsContrat = 0, reponsesValidees = 0, tiragesNuls = 0, produitsVus = 0;
// Ruling du 2026-10-10 : Produit.set.tirage est NULLABLE au contrat (null = « on ne sait pas » ; aucune des quatre collections de l'API ne le porte).
// Plus aucun écart à part : la réponse est jugée telle quelle contre ReponseAnalyse. Les null sont seulement comptés (dénominateur).
function validerAnalyse(json) {
    for (const k of json.analyse.cartes) for (const p of [k.carte, ...k.candidats]) if (p) { produitsVus++; if (p.set.tirage === null) tiragesNuls++; }
    return valider(json, ref('ReponseAnalyse'), SCHEMA);
}

async function inst(essais = 3, o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function compte(o = {}) { const c = Object.assign(M.nouveauCompte({ email: `b${++nCle}@x.fr`, emailCle: `b${nCle}@x.fr`, motDePasse: {} }), { verifie: true }, o); await db.col('comptes').insertOne(c); return c; }
function corps(o = {}) {
    return { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o };
}
async function poster(url, jeton, c = corps(), { avecCle = true, cleIdem = cle(), entetes = {}, nom } = {}) {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(avecCle ? { 'idempotency-key': cleIdem } : {}), ...entetes } });
    toutes.push({ nom, statut: r.statut, acao: r.entetes['access-control-allow-origin'] });
    if (r.json && r.json.success === true && r.json.contrat === 2) {      // le banc compte les écarts de contrat (B7a) sur chaque réponse d'analyse
        const v = validerAnalyse(r.json); reponsesValidees++;
        if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); }
    }
    return r;
}
const nMouv = () => raw('mouvements').countDocuments({});
const appelsIA = srv => (srv.lire().match(/lecture rejouée/g) || []).length;
const solde = async id => (await raw('installations').findOne({ _id: id }));

const ID_A = 895789, ID_B = 895790, EXP = 990001;
async function semer(mode) {                                  // 'double' | 'simple' | 'vide' — catalogue FABRIQUÉ (seul l'idProduct vient de la charge)
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    if (mode === 'vide') return;
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante] of (mode === 'double' ? [[ID_A, 'normale'], [ID_B, 'reverse']] : [[ID_A, 'normale']])) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990101, numero: '001', rarete: 'Common', total: '064', variante, setNom: 'Banc Set', lien: null });
    }
}

(async () => {
    // ── 0. la borne de vintedEtat reportée de B1b.1 (unitaire)
    const longue = verifierEntree(corps({ vintedEtat: 'x'.repeat(500) }), cfg);
    H.v('0. vintedEtat est borné à 100 caractères (mineur reporté de B1b.1)', longue.entree && longue.entree.vintedEtat.length, 100);

    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-identifier-v2.js', ecrit: true });
    db.brancher(mongoose.connection.db);                      // préfixe '' : les collections nues de la base EN MÉMOIRE, celles que lit l'enfant
    await M.creerIndex();
    const { demarrer } = require('../../verrou/serveur');
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '' };
    await semer('double');

    // ── 1. SANS contrat 2 : la route héritée répond comme aujourd'hui, octet pour octet (v2 éteinte contre v2 allumée, mêmes requêtes, même base)
    // (la référence d'A0.5 se rejoue sur un catalogue réel de test_scratch ; ici la base est en mémoire et fabriquée : la référence ne se rejoue pas, on compare
    //  DEUX serveurs vivants — v2 éteinte / allumée — sur les mêmes requêtes. Un écart d'un octet, scanId normalisé, échoue.)
    const srvOff = await demarrer(FAUX, { ...base, RM_API_V2: '' });
    const srvOn = await demarrer(FAUX, { ...base, RM_API_V2: '1' });
    if (!await srvOff.attendreMongo() || !await srvOn.attendreMongo()) throw new Error('Mongo non connecté');
    const urlOn = `http://127.0.0.1:${srvOn.port}`;
    const { appeler } = require('../../verrou/serveur');
    const norm = s => s.replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
    const heritee = async (srv, k, image) => { const r = await appeler(srv.port, 'POST', '/api/identifier', { userId: `inchange-${k}`, imageUrls: [image], title: null, vintedEtat: null }, 'jeton-verrou'); return norm(`${r.status} ${r.brut}`); };
    const jeux = [IMAGE, IMAGE_INCONNUE];
    const paires = [];
    for (let k = 0; k < jeux.length; k++) paires.push([await heritee(srvOff, `off${k}`, jeux[k]), await heritee(srvOn, `on${k}`, jeux[k])]);
    H.v(`1. sans contrat 2 : réponses héritées identiques octet pour octet, v2 éteinte / allumée (${paires.length} requêtes comparées)`, paires.filter(([a, b]) => a === b).length, paires.length);
    H.vrai('   la comparaison n\'est pas vide (une réussite ET un refus rendus)', paires.some(([a]) => /"success":true/.test(a)) && paires.some(([a]) => /"success":false/.test(a)));
    srvOff.enfant.kill();

    // ── 2. contrat 2 sans Authorization, ou avec le seul x-jeton public : 401 JETON, aucun appel IA, aucun mouvement
    {
        const m0 = await nMouv(), ia0 = appelsIA(srvOn);
        const a = await poster(urlOn, null, corps(), { nom: '2a' });
        const b = await poster(urlOn, null, corps(), { nom: '2b', entetes: { 'x-jeton': 'jeton-verrou' } });
        await attendre(300);
        H.v('2. sans Authorization / avec le seul x-jeton : 401 JETON (corps v2)', [a.statut, a.json.erreur.code, a.json.success, b.statut, b.json.erreur.code], [401, 'JETON', false, 401, 'JETON']);
        H.v('   aucun mouvement, aucun appel IA', [await nMouv() - m0, appelsIA(srvOn) - ia0], [0, 0]);
    }

    // ── 4. charge ambiguë (la VRAIE chaîne) : a-trancher, 2 candidats, réserve, question en base
    {
        const { i, jeton } = await inst(3);
        const r = await poster(urlOn, jeton, corps({ title: 'Tropius secret 4242 PBL', description: 'Description secrète XYZ-777' }), { nom: '4', entetes: { 'x-forwarded-for': '10.9.9.9' } });
        const j = r.json || {};
        H.v('4. ambiguë : 200, a-trancher, 2 candidats', [r.statut, j.success, j.analyse && j.analyse.statut, j.analyse && j.analyse.cartes[0].candidats.length], [200, true, 'a-trancher', 2]);
        H.v('   facturation réservée { debite:0, reserve:1, motif:question }', [j.facturation.debite, j.facturation.reserve, j.facturation.rembourse, j.facturation.motif], [0, 1, false, 'question']);
        H.v('   solde.total déjà en moins (3 -> 2)', [j.solde.total, j.solde.essai], [2, 2]);
        const q = await raw('questions').findOne({ _id: `${j.scanId}:0` });
        H.v('   question en base : en-attente, choix = choixPour(candidats)', [q && q.etat, q && q.choix], ['en-attente', choixPour([ID_A, ID_B])]);
        // 14. analyses sans texte ni IP ; annonces expurgées
        await attendre(300);
        const an = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
        const t = JSON.stringify(an);
        H.vrai('14. analyses : ni le titre, ni la description, ni l\'IP', an && !/secret 4242|XYZ-777|10\.9\.9\.9/.test(t));
        const ann = await raw('annonces').findOne({ _id: j.scanId });
        const att = preparerAnnonce({ title: 'Tropius secret 4242 PBL', description: 'Description secrète XYZ-777' }, cfg);
        H.v('   annonces : titre et description EXPURGÉS (ceux de preparerAnnonce)', ann && [ann.titre, ann.description], [att.titre, att.description]);
        // 15. journal hérité
        let jl = null; for (let k = 0; k < 30 && !jl; k++) { jl = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) }); if (!jl) await attendre(200); }
        H.v('15. journal_scans : userId v2:installation:<id>', jl && jl.userId, `v2:installation:${i._id}`);
        H.vrai('   ni le jeton ni son empreinte dans la ligne du journal', jl && !JSON.stringify(jl).includes(jeton) && !JSON.stringify(jl).includes(J.empreinte(jeton)));
    }

    // ── 5. panne de lecture : jamais « introuvable », remboursée
    {
        const { i, jeton } = await inst(3);
        const r = await poster(urlOn, jeton, corps({ imageUrls: [IMAGE_INCONNUE] }), { nom: '5' }), j = r.json || {};
        H.v('5. panne de lecture : success:false, IA, motif panne, remboursée', [j.success, j.erreur && j.erreur.code, j.facturation && j.facturation.motif, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.debite], [false, 'IA', 'panne', true, 0]);
        H.v('   solde.essai revenu à 3, et surtout pas un introuvable', [j.solde && j.solde.essai, (await solde(i._id)).essais, j.analyse], [3, 3, undefined]);
    }

    // ── 6. panne du catalogue : INDISPONIBLE, remboursée
    {
        const { i, jeton } = await inst(3);
        srvOn.enfant.send('panne-catalogue'); await attendre(500);
        const r = await poster(urlOn, jeton, corps(), { nom: '6' }), j = r.json || {};
        srvOn.enfant.send('panne-catalogue-off'); await attendre(300);
        H.v('6. panne du catalogue : 503 INDISPONIBLE, motif panne, remboursée', [r.statut, j.erreur && j.erreur.code, j.facturation && j.facturation.motif, j.facturation && j.facturation.rembourse, (await solde(i._id)).essais], [503, 'INDISPONIBLE', 'panne', true, 3]);
    }

    // ── 7. carte absente du catalogue : introuvable / hors-catalogue, remboursée
    {
        await semer('vide');
        const { i, jeton } = await inst(3);
        const r = await poster(urlOn, jeton, corps(), { nom: '7' }), j = r.json || {};
        H.v('7. absente du catalogue : introuvable / hors-catalogue', [j.success, j.analyse && j.analyse.statut, j.analyse && j.analyse.raison], [true, 'introuvable', 'hors-catalogue']);
        H.v('   remboursée : { debite:0, rembourse:true, motif:introuvable }, essai 3', [j.facturation.debite, j.facturation.rembourse, j.facturation.motif, (await solde(i._id)).essais], [0, true, 'introuvable', 3]);
        await semer('double');
    }

    // ── 8. 30 requêtes simultanées, 30 clés, installation à 3 essais : 3 réponses, 27 QUOTA, 3 appels IA
    {
        const { i, jeton } = await inst(3);
        const m0 = await nMouv(), ia0 = appelsIA(srvOn);
        const rs = await Promise.all(Array.from({ length: 30 }, (_, k) => poster(urlOn, jeton, corps(), { nom: `8-${k}` })));
        await attendre(500);
        const ok = rs.filter(r => r.statut === 200 && r.json && r.json.success === true).length, quota = rs.filter(r => r.statut === 429 && r.json && r.json.erreur && r.json.erreur.code === 'QUOTA').length;
        H.v('8. 30 requêtes / 30 clés / 3 essais : 3 success:true, 27 QUOTA (dénominateur 30)', [ok, quota, rs.length], [3, 27, 30]);
        H.v('   appels IA = 3 (aucun appel à la chaîne héritée pour les 27 refus), 3 débits écrits', [appelsIA(srvOn) - ia0, await nMouv() - m0], [3, 3]);
        const q = rs.find(r => r.statut === 429).json;
        H.vrai('   un QUOTA porte le solde et facturation:null', q.facturation === null && q.solde && q.solde.total === 0);
        H.v('   essais à 0', (await solde(i._id)).essais, 0);
    }

    // ── 9. rejeu (même Idempotency-Key) : même corps, Idempotency-Replayed, zéro débit, zéro appel IA de plus
    {
        const { jeton } = await inst(3);
        const k = cle();
        const r1 = await poster(urlOn, jeton, corps(), { cleIdem: k, nom: '9a' });
        const m1 = await nMouv(), ia1 = appelsIA(srvOn);
        const r2 = await poster(urlOn, jeton, corps(), { cleIdem: k, nom: '9b' });
        await attendre(300);
        H.v('9. rejeu : même corps, Idempotency-Replayed: true', [r2.texte === r1.texte, r2.entetes['idempotency-replayed']], [true, 'true']);
        H.v('   zéro débit de plus, zéro appel IA de plus', [await nMouv() - m1, appelsIA(srvOn) - ia1], [0, 0]);
    }

    // ── 10. clé d'idempotence absente : 400 ENTREE, aucun débit
    {
        const { jeton } = await inst(3);
        const m0 = await nMouv(), ia0 = appelsIA(srvOn);
        const r = await poster(urlOn, jeton, corps(), { avecCle: false, nom: '10' });
        H.v('10. clé absente : 400 ENTREE, aucun mouvement, aucun appel IA', [r.statut, r.json.erreur.code, await nMouv() - m0, appelsIA(srvOn) - ia0], [400, 'ENTREE', 0, 0]);
    }

    // ── 11. administrateur (compte avec role, installation liée) : motif administrateur, soldes intacts
    {
        const c = await compte({ role: 'administrateur', solde: { accueil: 25, achete: 0 } });
        const { jeton } = await inst(0, { compteId: c._id });
        const r = await poster(urlOn, jeton, corps(), { nom: '11' }), j = r.json || {};
        H.v('11. administrateur : 200, motif administrateur, rien débité, rien réservé', [r.statut, j.facturation && j.facturation.motif, j.facturation && j.facturation.debite, j.facturation && j.facturation.reserve, j.facturation && j.facturation.rembourse], [200, 'administrateur', 0, 0, false]);
        H.v('   soldes intacts (accueil 25)', [(await raw('comptes').findOne({ _id: c._id })).solde.accueil, j.solde && j.solde.accueil], [25, 25]);
    }

    // ── 12. compte non vérifié, installation liée : 403 VERIFICATION, aucun appel IA
    {
        const c = await compte({ verifie: false, solde: { accueil: 0, achete: 0 } });
        const { jeton } = await inst(0, { compteId: c._id });
        const ia0 = appelsIA(srvOn), m0 = await nMouv();
        const r = await poster(urlOn, jeton, corps(), { nom: '12' }), j = r.json || {};
        await attendre(300);
        H.v('12. compte non vérifié : 403 VERIFICATION, facturation null, aucun appel IA ni mouvement', [r.statut, j.erreur && j.erreur.code, j.facturation, appelsIA(srvOn) - ia0, await nMouv() - m0], [403, 'VERIFICATION', null, 0, 0]);
    }

    // ── 13. CORS de l'extension sur CHAQUE réponse reçue ci-dessus, erreurs comprises
    {
        const sans = toutes.filter(t => t.acao !== ORIGINE);
        H.v(`13. en-têtes CORS de l'extension sur chacune des ${toutes.length} réponses (erreurs 400/401/403/429/503 comprises)`, [sans.length, new Set(toutes.map(t => t.statut)).size >= 5], [0, true]);
        if (sans.length) console.log('   sans CORS :', JSON.stringify(sans.slice(0, 5)));
    }
    srvOn.enfant.kill();

    // ── 3 + table de facturation : la chaîne FABRIQUÉE (verdict ferme), en processus
    {
        const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
        const { dansUnScan } = require('../../sources');
        const { assembler } = require('../index');
        let mode = null;
        const corpsAffirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
            etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
            candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
        const chaineFabriquee = async (req, res) => {
            if (mode === 'affirmee') return res.json({ ...corpsAffirme(ID_A), scanId: String(req.scanIdImpose) });
            if (mode === 'produit-absent') return res.json({ ...corpsAffirme(777777777), scanId: String(req.scanIdImpose) });
            if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
            if (mode === 'ambigue') {                         // le chemin ambigu de la chaîne : elle POSE la question (réserve le crédit)
                await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_A, ID_B] });
                return res.json({ ...corpsAffirme(ID_A), scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...corpsAffirme(ID_A).carte, ambigu: true },
                    candidats: [ID_A, ID_B].map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
            }
            if (mode === 'refus-egalite' || mode === 'refus-egalite-seul') {   // le chemin REFUS de la chaîne : elle tente de rembourser, puis rend 2 candidats (ou 1)
                await req.credit.v2.rembourser(req, 'egalite-parfaite');
                return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'egalite-parfaite', candidats: (mode === 'refus-egalite' ? [ID_A, ID_B] : [ID_A]).map(id => ({ idProduct: id })) });
            }
            if (mode === 'exception') throw new Error('boum');
            throw new Error(`mode inconnu ${mode}`);
        };
        const appFabrique = async (cfgApp, deps = {}) => {
            const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
            pret.armer(require('../modeles').verifierIndex);
            app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { gererIdentifier: chaineFabriquee, ...deps }));
            return H.serveur(app);
        };
        const sv = await appFabrique(cfg);
        const aff = async (m, essais = 3) => { mode = m; const x = await inst(essais); const r = await poster(sv.url, x.jeton, corps(), { nom: `fab-${m}` }); return { ...x, r, j: r.json || {} }; };
        // 3. verdict ferme : forme de CONTRAT-2, affirmee, essai 3 -> 2
        const a = await aff('affirmee');
        const v3 = validerAnalyse(a.j);
        H.v('3. verdict ferme : 200, contrat 2, identifiee, valide contre ReponseAnalyse (0 écart)', [a.r.statut, a.j.contrat, a.j.analyse && a.j.analyse.statut, v3.ok], [200, 2, 'identifiee', true]);
        H.v('   facturation affirmee { debite:1, reserve:0, rembourse:false }, solde.essai 3 -> 2', [a.j.facturation, a.j.solde.essai], [{ debite: 1, reserve: 0, rembourse: false, motif: 'affirmee', raisonNonRembourse: null }, 2]);
        H.v('   le scanId de la réponse est celui de analyses', !!(await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(a.j.scanId) })), true);
        // introuvable remboursé par la chaîne via le pont
        const b = await aff('introuvable');
        H.v('table : introuvable remboursé par la chaîne', [b.j.analyse.statut, b.j.facturation.debite, b.j.facturation.rembourse, b.j.facturation.motif, b.j.solde.essai], ['introuvable', 0, true, 'introuvable', 3]);
        // remboursement refusé : plafond du jour atteint
        mode = 'introuvable'; const pl = await inst(3);
        await raw('plafonds').insertOne({ porteur: `installation:${pl.i._id}`, jour: new Date().toISOString().slice(0, 10), type: 'panne', count: cfg.plafonds.panne, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const c = await poster(sv.url, pl.jeton, corps(), { nom: 'fab-plafond' });
        H.v('table : remboursement refusé (plafond-jour) : motif plafond-jour, non rendu', [c.json.facturation.debite, c.json.facturation.rembourse, c.json.facturation.motif, c.json.facturation.raisonNonRembourse, c.json.solde.essai], [1, false, 'plafond-jour', 'plafond-jour', 2]);
        // exception de la chaîne : panne SERVEUR remboursée
        const d = await aff('exception');
        H.v('table : exception de la chaîne héritée : 500 SERVEUR, panne remboursée', [d.r.statut, d.j.erreur && d.j.erreur.code, d.j.facturation.motif, d.j.facturation.rembourse, d.j.solde.essai], [500, 'SERVEUR', 'panne', true, 3]);
        // produit absent du catalogue de l'API : l'adaptateur refuse d'inventer, remboursée
        const e = await aff('produit-absent');
        H.v('table : produit désigné absent du catalogue de l\'API : panne SERVEUR remboursée', [e.r.statut, e.j.erreur && e.j.erreur.code, e.j.facturation.rembourse, e.j.solde.essai], [500, 'SERVEUR', true, 3]);
        // ── ruling n°2 : une question issue d'un REFUS de la chaîne (egalite-parfaite, ≥ 2 candidats) est réservée comme une ambiguë.
        //    Le solde et les mouvements NETS doivent être IDENTIQUES à ceux du chemin ambigu, à chaque étape : après le scan, après une réponse, après un abandon.
        const argentReg = registre.obtenir('argent');
        const etat = async (x, scanId) => {
            const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
            const ins = await raw('installations').findOne({ _id: x.i._id });
            const q = await raw('questions').findOne({ _id: `${scanId}:0` });
            return { essais: ins.essais, net: mv.reduce((s, m) => s + m.delta, 0), mouvements: mv.length, debitsOuverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), question: q && { etat: q.etat, choix: q.choix } };
        };
        const parcours = async (m, choix) => {
            mode = m; const x = await inst(3); const r = await poster(sv.url, x.jeton, corps(), { nom: `fab-${m}-${choix}` }); const j = r.json || {};
            const porteurX = { type: 'installation', id: x.i._id, compte: null, installation: x.i, surface: 'extension', administrateur: false };
            const apresScan = await etat(x, j.scanId);
            await argentReg.repondreQuestion(porteurX, { scanId: new mongoose.Types.ObjectId(j.scanId), carte: 0, choix });
            return { statut: j.analyse && j.analyse.statut, candidats: j.analyse && j.analyse.cartes[0].candidats.map(c => c.idProduct), facturation: j.facturation, apresScan, apresReponse: await etat(x, j.scanId) };
        };
        const A_rep = await parcours('ambigue', 'a'), R_rep = await parcours('refus-egalite', 'a');
        const A_ab = await parcours('ambigue', 'aucune'), R_ab = await parcours('refus-egalite', 'aucune');
        H.v('ruling 2 : refus egalite-parfaite -> a-trancher à 2 candidats, facturation de l\'ambiguë { debite:0, reserve:1, motif:question }', [R_rep.statut, R_rep.candidats, R_rep.facturation], ['a-trancher', [ID_A, ID_B], { debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null }]);
        H.v('   après le scan : solde et mouvements NETS identiques au chemin ambigu', R_rep.apresScan, A_rep.apresScan);
        H.v('   (valeurs : essais 2, net -1, un débit réservé, question en-attente, choix = choixPour)', R_rep.apresScan, { essais: 2, net: -1, mouvements: 1, debitsOuverts: ['reserve'], question: { etat: 'en-attente', choix: choixPour([ID_A, ID_B]) } });
        H.v('   après une réponse (débité UNE fois) : identique, essais 2, net -1', [R_rep.apresReponse, R_rep.apresReponse.essais, R_rep.apresReponse.net, R_rep.apresReponse.debitsOuverts], [A_rep.apresReponse, 2, -1, ['debite']]);
        H.v('   après un abandon (rendu) : identique, essais 3, net 0', [R_ab.apresReponse, R_ab.apresReponse.essais, R_ab.apresReponse.net], [A_ab.apresReponse, 3, 0]);
        H.vrai('   la facturation est celle de l\'ambiguë, à l\'identique', JSON.stringify(R_rep.facturation) === JSON.stringify(A_rep.facturation));
        // un seul candidat : pas de question possible -> introuvable, et le crédit est RENDU (le remboursement différé n'est jamais perdu)
        mode = 'refus-egalite-seul'; const un = await inst(3); const ru = await poster(sv.url, un.jeton, corps(), { nom: 'fab-refus-seul' });
        H.v('   refus à UN seul candidat : introuvable, crédit rendu (essai 3), motif introuvable', [ru.json.analyse.statut, ru.json.facturation.rembourse, ru.json.facturation.motif, (await solde(un.i._id)).essais], ['introuvable', true, 'introuvable', 3]);
        // ── n°5b : debiter qui LÈVE après avoir pris la poche (l'écriture du mouvement échoue) ne laisse RIEN de pris
        {
            const colOrig = db.col; let armee = true;
            db.col = nom => {
                const c = colOrig(nom);
                if (nom !== 'mouvements' || !armee) return c;
                return new Proxy(c, { get(t, p) { if (p === 'insertOne') return async () => { armee = false; throw new Error('panne simulée : écriture du mouvement'); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
            };
            mode = 'affirmee';
            const y = await inst(3);
            let r;
            try { r = await poster(sv.url, y.jeton, corps(), { nom: 'fab-debit-leve' }); } finally { db.col = colOrig; }
            H.v('5b. l\'écriture du mouvement échoue après la prise de la poche : 503 INDISPONIBLE, la chaîne n\'est pas appelée', [r.statut, r.json.erreur.code, armee], [503, 'INDISPONIBLE', false]);
            H.v('   solde IDENTIQUE à l\'avant (essais 3), aucun mouvement', [(await solde(y.i._id)).essais, await raw('mouvements').countDocuments({ installationId: y.i._id })], [3, 0]);
            const r2 = await poster(sv.url, y.jeton, corps(), { nom: 'fab-debit-apres-panne' });
            H.v('   la panne ne coince rien : la requête suivante réussit et débite une fois', [r2.statut, r2.json.success, (await solde(y.i._id)).essais], [200, true, 2]);
        }
        // QUOTA d'un compte : achat.url
        const cq = await compte({ solde: { accueil: 0, achete: 0 } });          // vérifié : il reste le quota HEBDO, épuisé ici
        await raw('hebdo').insertOne({ compteId: cq._id, semaine: require('../../acces').semaineISO(new Date()), count: cfg.quotas.hebdo, expireLe: new Date(Date.now() + 5 * 86400e3) });
        const iq = await inst(0, { compteId: cq._id });
        const q = await poster(sv.url, iq.jeton, corps(), { nom: 'fab-quota-compte' });
        H.v('table : QUOTA d\'un compte : 429, achat.url, solde, facturation null', [q.statut, q.json.erreur.code, q.json.achat, q.json.facturation, q.json.solde.total], [429, 'QUOTA', { url: 'https://rat-market.fr/fr/compte#recharge' }, null, 0]);
        // lecture du catalogue qui tombe : INDISPONIBLE remboursé
        await sv.fermer();
        const sv2 = await appFabrique(cfg, { catalogue: { lire: async () => { throw new Error('mongo muet'); } } });
        mode = 'affirmee'; const x2 = await inst(3); const f = await poster(sv2.url, x2.jeton, corps(), { nom: 'fab-catalogue-tombe' });
        H.v('table : lecture du catalogue en panne : 503 INDISPONIBLE, remboursée', [f.statut, f.json.erreur.code, f.json.facturation.rembourse, f.json.solde.essai], [503, 'INDISPONIBLE', true, 3]);
        await sv2.fermer();
        // V2_DESCRIPTION_CONSERVEE=0 : rien dans annonces
        const cfg0 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_DESCRIPTION_CONSERVEE: '0' });
        const sv3 = await appFabrique(cfg0);
        mode = 'affirmee'; const x3 = await inst(3); const g = await poster(sv3.url, x3.jeton, corps({ title: 'Titre à ne pas garder' }), { nom: 'fab-sans-annonce' });
        await attendre(300);
        H.v('14. V2_DESCRIPTION_CONSERVEE=0 : aucune ligne dans annonces', [g.statut, await raw('annonces').countDocuments({ _id: g.json.scanId })], [200, 0]);
        await sv3.fermer();
    }
    H.v(`contrat : ${reponsesValidees} réponses d'analyse validées contre ReponseAnalyse, écarts`, ecartsContrat, 0);
    H.v(`   Produit.set.tirage null (nullable au contrat) : ${tiragesNuls} produit(s) sur ${produitsVus} servis, tous validés`, [tiragesNuls, produitsVus].every(n => n > 0) && tiragesNuls === produitsVus, true);

    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

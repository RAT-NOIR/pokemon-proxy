'use strict';
// Banc REPLI-QUOTA (routes) — décision de l'éditeur (2026-10-24) : « Un scan qui AFFICHE un prix (même un repli avec mention) est une analyse rendue, donc il COMPTE dans le quota.
// Seuls les scans sans aucun prix affiché gardent le remboursement « prix illisible ». »
// Par les VRAIES routes v2 (serveur enfant, base en mémoire, faux réseau du verrou) : POST /api/retour-live avec une lecture ratée DÉFINITIVE.
//   · un `prixRepli` est servi dans CETTE réponse  => aucun remboursement, `debite: 1`, `raisonNonRembourse: "prix-repli"`, le plafond des déclarations du jour n'est PAS consommé ;
//   · aucun `prixRepli` n'est servi                => le remboursement `sans-prix` d'avant, plafond compris (`plafond-jour` au-delà) ;
//   · un second envoi rend la même décision ; un lot n'est jamais remboursé au motif d'un prix manquant ; l'administrateur ne paie rien.
// Les fiches semées portent les champs RÉELS du guide de Tauros et d'Arcanin (fixtures/prix-repli-reels.json) : aucune valeur inventée.
const H = require('./_harnais');
const path = require('path'), fs = require('fs');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const VB = require('./_visuels-banc'); const VIS = new Map(); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const REEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prix-repli-reels.json'), 'utf8')).cas;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.8.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-rq-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
let validees = 0, ecarts = 0;

async function inst(essais = 3, o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
const entetes = jeton => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` });
const ID_A = 895789, ID_B = 895790, EXP = 990001;
const G = nom => ({ ...REEL[nom].guide, guideDu: new Date(REEL[nom].guide.guideDu) });
async function semer() {
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante, nom] of [[ID_A, 'normale', 'tauros'], [ID_B, 'reverse', 'arcanin']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, ...G(nom) });
        VIS.set(id, VB.doc(id, { variante }));
    }
}

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true });
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-repli-quota.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const { demarrer } = require('../../verrou/serveur');
    await semer();
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', V2_VISUELS_BANC_FICHIER: VB.fichier([...VIS.values()]) };
    const srv = await demarrer(FAUX, { ...base, RM_API_V2: '1' });
    if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
    const url = `http://127.0.0.1:${srv.port}`;

    const identifier = jeton => H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { ...entetes(jeton), 'idempotency-key': cle() } });
    const repondre = (jeton, scanId, choix) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: { scanId, choix }, entetes: entetes(jeton) });
    const rl = async (jeton, corps, cleIdem) => {
        const r = await H.appel(url, '/api/retour-live', { methode: 'POST', corps, entetes: { ...entetes(jeton), ...(cleIdem ? { 'idempotency-key': cleIdem } : {}) } });
        if (r.json && r.json.success === true) { const v = valider(r.json, ref('ReponseRetourLive'), SCHEMA); validees++; if (!v.ok) { ecarts++; console.log(`   écart retour-live : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
        return r;
    };
    const oid = s => new mongoose.Types.ObjectId(s);
    const journal = async scanId => { for (let k = 0; k < 40; k++) { const l = await raw('journal_scans').findOne({ _id: oid(scanId) }); if (l) return l; await attendre(150); } return null; };
    const LR = scanId => ({ scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
    const essais = id => Q.restantDe({ type: 'installation', id }, cfg);
    const mouv = id => raw('mouvements').find({ installationId: id }).toArray();
    const rembNet = async id => (await mouv(id)).filter(m => m.type === 'remboursement' && m.delta === 1).length;
    const declares = id => raw('plafonds').findOne({ porteur: `installation:${id}`, type: 'declare' });
    // un scan à question, répondu par « a » (Tauros, état retenu null : le cas réel du « prix illisible ») : débité UNE fois
    const scanRepondu = async (o = {}) => {
        const x = await inst(3, o); const r0 = await identifier(x.jeton); const scanId = r0.json.scanId; await journal(scanId);
        await raw('analyses').updateOne({ _id: oid(scanId) }, { $set: { 'cartes.0.etat.retenu': null } });
        const rep = await repondre(x.jeton, scanId, 'a'); if (rep.statut !== 200) throw new Error(`réponse refusée ${rep.statut}`);
        await journal(scanId);
        return { ...x, scanId };
    };
    // la fiche sans AUCUNE donnée de prix : aucun repli possible
    const sansDonneeDePrix = scanId => raw('analyses').updateOne({ _id: oid(scanId) }, { $set: { 'produits.$[].prixGuide': null } });

    // ── R1. lecture ratée définitive ET repli servi : le scan n'est PAS remboursé, il reste compté
    {
        const s = await scanRepondu();
        H.v('R0. avant : le scan répondu « a » est débité (2 analyses restantes sur 3)', await essais(s.i._id), 2);
        const r = await rl(s.jeton, LR(s.scanId)), j = r.json || {}, f = j.facturation || {};
        H.v('R1. repli servi : 200, prixRepli présent (tendance / lecture-ratee), guide réel de Tauros', [r.statut, j.prixRepli && j.prixRepli.repli, j.prixRepli && j.prixRepli.cause, j.prixRepli && j.prixRepli.guide.tendance], [200, 'tendance', 'lecture-ratee', 1.49]);
        H.v('    facturation : debite 1, rembourse false, motif sans-prix, raisonNonRembourse « prix-repli »', [f.debite, f.reserve, f.rembourse, f.motif, f.raisonNonRembourse], [1, 0, false, 'sans-prix', 'prix-repli']);
        H.v('    le quota ne remonte pas (essais 2), l\'offre relue dit 2, aucun remboursement écrit', [await essais(s.i._id), j.offre && j.offre.restant, await rembNet(s.i._id)], [2, 2, 0]);
        H.v('    le plafond des déclarations du jour n\'est PAS consommé : aucun compteur, aucun champ `declaration`', [await declares(s.i._id), 'declaration' in j], [null, false]);
        const l = await raw('journal_scans').findOne({ _id: oid(s.scanId) });
        H.v('    la lecture ratée est écrite comme avant (cause, définitive)', [l.lectureRatee && l.lectureRatee.cause, l.lectureRatee && l.lectureRatee.definitive], ['sans-prix', true]);

        // R2. idempotence : un second envoi rend la même décision (et ne consomme toujours rien)
        const r2 = await rl(s.jeton, LR(s.scanId)), f2 = (r2.json || {}).facturation || {};
        H.v('R2. second envoi : la même décision (prix-repli, non remboursé, debite 1), le même repli, rien consommé', [r2.statut, f2.debite, f2.rembourse, f2.motif, f2.raisonNonRembourse, r2.json.prixRepli && r2.json.prixRepli.cause, await essais(s.i._id), await rembNet(s.i._id), await declares(s.i._id)], [200, 1, false, 'sans-prix', 'prix-repli', 'lecture-ratee', 2, 0, null]);
        // ... et avec une Idempotency-Key : le rejeu rend le même corps
        const t = await scanRepondu(), k = cle();
        const a = await rl(t.jeton, LR(t.scanId), k), b = await rl(t.jeton, LR(t.scanId), k);
        H.v('    avec une Idempotency-Key : le rejeu rend le même corps, marqué Idempotency-Replayed', [a.statut, b.statut, b.texte === a.texte, b.entetes['idempotency-replayed'], a.json.facturation.raisonNonRembourse], [200, 200, true, 'true', 'prix-repli']);
    }

    // ── R3. lecture ratée définitive SANS repli (la fiche n'a aucune donnée de prix) : le remboursement d'avant, plafond compris
    {
        const s = await scanRepondu(); await sansDonneeDePrix(s.scanId);
        const r = await rl(s.jeton, LR(s.scanId)), j = r.json || {}, f = j.facturation || {};
        H.v('R3. sans repli : 200, aucune clé prixRepli, remboursée (debite 0, rembourse true, motif sans-prix, raisonNonRembourse null)', [r.statut, 'prixRepli' in j, f.debite, f.rembourse, f.motif, f.raisonNonRembourse], [200, false, 0, true, 'sans-prix', null]);
        H.v('    l\'unité est rendue (essais 3), le plafond des déclarations compte 1, la réponse dit le jugement', [await essais(s.i._id), (await declares(s.i._id) || {}).count, j.declaration], [3, 1, { rendue: true, raison: null, plafondJour: 1 }]);
        const r2 = await rl(s.jeton, LR(s.scanId)), f2 = (r2.json || {}).facturation || {};
        H.v('    second envoi : AUCUN second crédit (deja-rembourse), comme avant', [r2.statut, f2.rembourse, f2.raisonNonRembourse, await essais(s.i._id), await rembNet(s.i._id)], [200, false, 'deja-rembourse', 3, 1]);
    }

    // ── R4. sans repli, plafond des déclarations ATTEINT : plafond-jour, comme avant ; avec repli, le même plafond atteint ne change rien (prix-repli, compteur intact)
    {
        const u = await scanRepondu(); await sansDonneeDePrix(u.scanId);
        await raw('plafonds').insertOne({ porteur: `installation:${u.i._id}`, jour: Q.jourCourant(), type: 'declare', count: cfg.plafonds.declares.sansCompte, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const r = await rl(u.jeton, LR(u.scanId)), j = r.json || {}, f = j.facturation || {};
        H.v('R4. sans repli, plafond atteint (sans compte : 1) : plafond-jour, debite 1, rembourse false, essais 2, la déclaration dit le refus', [r.statut, f.motif, f.rembourse, f.debite, f.raisonNonRembourse, await essais(u.i._id), j.declaration], [200, 'plafond-jour', false, 1, 'plafond-jour', 2, { rendue: false, raison: 'plafond-declarations', plafondJour: 1 }]);
        const v = await scanRepondu();
        await raw('plafonds').insertOne({ porteur: `installation:${v.i._id}`, jour: Q.jourCourant(), type: 'declare', count: cfg.plafonds.declares.sansCompte, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const rv = await rl(v.jeton, LR(v.scanId)), fv = (rv.json || {}).facturation || {};
        H.v('    avec repli, le même plafond atteint : « prix-repli » (pas « plafond-jour »), pas de champ declaration, compteur inchangé à 1', [rv.statut, fv.motif, fv.raisonNonRembourse, fv.debite, 'declaration' in rv.json, (await declares(v.i._id)).count], [200, 'sans-prix', 'prix-repli', 1, false, 1]);
    }

    // ── R5. un repli ne consomme pas le plafond : deux scans du même porteur, le premier avec repli, le second sans — le second est encore remboursé
    {
        const x = await inst(3);
        const un = async () => { const r0 = await identifier(x.jeton); const scanId = r0.json.scanId; await journal(scanId); await raw('analyses').updateOne({ _id: oid(scanId) }, { $set: { 'cartes.0.etat.retenu': null } }); const rep = await repondre(x.jeton, scanId, 'a'); if (rep.statut !== 200) throw new Error('réponse refusée'); await journal(scanId); return scanId; };
        const premier = await un(), second = await un();
        await sansDonneeDePrix(second);
        const r1 = await rl(x.jeton, LR(premier)), r2 = await rl(x.jeton, LR(second));
        H.v('R5. scan 1 avec repli (compté), scan 2 sans repli (remboursé) : le plafond de 1 n\'avait pas été mangé par le premier', [r1.json.facturation.raisonNonRembourse, r2.json.facturation.rembourse, r2.json.declaration, await essais(x.i._id)], ['prix-repli', true, { rendue: true, raison: null, plafondJour: 1 }, 2]);
    }

    // ── R6. administrateur : rien à rendre, rien à compter — le repli n'y change rien
    {
        const c = Object.assign(M.nouveauCompte({ email: `adm${++nCle}@x.fr`, emailCle: `adm${nCle}@x.fr`, motDePasse: {} }), { verifie: true, role: 'administrateur', solde: { accueil: 25, achete: 0 } });
        await db.col('comptes').insertOne(c);
        const s = await scanRepondu({ compteId: c._id });
        const r = await rl(s.jeton, LR(s.scanId)), f = (r.json || {}).facturation || {};
        H.v('R6. administrateur, repli servi : motif administrateur, rien rendu, compte intact (accueil 25)', [r.statut, f.motif, f.rembourse, f.raisonNonRembourse, r.json.prixRepli && r.json.prixRepli.cause, (await raw('comptes').findOne({ _id: c._id })).solde.accueil], [200, 'administrateur', false, null, 'lecture-ratee', 25]);
    }

    // ── R7. lecture ratée NON définitive : rien ne change (aucune facturation), le repli est servi comme avant
    {
        const s = await scanRepondu();
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, lectureRatee: { cause: 'defi', definitive: false } });
        H.v('R7. non définitive (défi) : facturation null, repli servi, rien rendu, rien consommé', [r.statut, r.json.facturation, r.json.prixRepli && r.json.prixRepli.cause, await essais(s.i._id), await declares(s.i._id)], [200, null, 'lecture-ratee', 2, null]);
        const rd = await rl(s.jeton, LR(s.scanId));
        H.v('    puis définitive sur le même scan, repli servi : non remboursée (prix-repli), la non-définitive n\'a rien consommé', [rd.json.facturation.raisonNonRembourse, rd.json.facturation.debite, await essais(s.i._id)], ['prix-repli', 1, 2]);
    }

    // ── R8. UN LOT : un prix manquant ne rembourse jamais un lot (une carte lue = un lot payé), et un repli sur UNE carte ne change rien — le lot reste compté
    {
        const s = await scanRepondu(); const src = await raw('analyses').findOne({ _id: oid(s.scanId) }); const sid = new mongoose.Types.ObjectId();
        const carteA = { ...src.cartes[0], statut: 'identifiee', idProduct: ID_A, question: null, reponse: undefined }, carteB = { ...carteA, idProduct: ID_B };
        await raw('analyses').insertOne({ ...src, _id: sid, statut: 'lot', cartes: [carteA, carteB] });
        await raw('journal_scans').insertOne({ _id: sid, userId: `v2:installation:${s.i._id}`, route: 'identifier' });
        const e0 = await essais(s.i._id);
        const r0 = await rl(s.jeton, { scanId: String(sid), carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
        const r1 = await rl(s.jeton, { scanId: String(sid), carte: 1, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('R8. lot dont une carte a un repli et l\'autre non : lecture ratée définitive refusée (409 carte-non-identifiee) sur les DEUX, rien rendu, rien consommé',
            [r0.statut, r0.json.erreur && r0.json.erreur.detail, r1.statut, r1.json.erreur && r1.json.erreur.detail, await essais(s.i._id) - e0, await rembNet(s.i._id), await declares(s.i._id)], [409, 'carte-non-identifiee', 409, 'carte-non-identifiee', 0, 0, null]);
    }
    H.v(`contrat : ${validees} réponses retour-live validées contre ReponseRetourLive, écarts`, [ecarts, validees > 0], [0, true]);

    srv.enfant.kill();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });

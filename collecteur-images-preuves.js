// ============================================================
// COLLECTEUR D'IMAGES « prv » (phase 4, 2026-10-26) — écrit les visuels PROUVÉS PAR LEUR LECTURE et VALIDÉS par le coordinateur, et seulement eux. AUCUNE REQUÊTE.
// ============================================================
//   node collecteur-images-preuves.js --plan [--famille=<NOM>]          (lecture seule : les manifestes S8\PHASE4\<FAMILLE>\preuves.json, les validations S8\PHASE4\VALIDATIONS\valide-<FAMILLE>.json, l'état A/B/C,
//                                                                         la base, le cache partagé S8\PHASE4\CACHE -> plan-prv.json, images-prv.json : chaque refus a son motif)
//   node collecteur-images-preuves.js --planche --echantillon=<N>       (planches À REGARDER avant d'écrire)
//   node collecteur-images-preuves.js --compter [--basse-definition]    (lecture seule : le nombre pour --attendu)
//   node lot-additif.js --quoi="PRV : N images" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-preuves.js --ecrire --attendu=N [--basse-definition]
//   node collecteur-images-preuves.js --compter-trous                   (lecture seule : le nombre pour --trous --attendu)
//   node lot-additif.js --quoi="PRV : N trous" --collections=trous_nommes -- node collecteur-images-preuves.js --trous --attendu=N
//   node collecteur-images-preuves.js --retirer                         (à blanc : le retrait exact du lot ; l'écriture passe par retirer-visuels-recolte.js --source=prv)
// (--dossier= --cache= --racine= : bancs seulement. La grammaire, les planches, le compte, le retrait et l'écriture sont CEUX de collecte-cartes/recolte-cli.js, communs aux collecteurs « récolte » ;
//  ce fournisseur n'a ni relevé ni téléchargement — `--releve` et `--telecharger` sont des arguments inconnus : les images sont déjà au cache partagé, rien ne sort du poste.)
//
// Rien n'est écrit sans la validation du coordinateur au MÊME sha256 (P1). Deux règles seulement : `preuve-lue` (l'image porte numéro, total, langue, tampon) et `deux-sources` (la règle d'image de
// production sur deux hôtes indépendants). Un visuel vit sur la FICHE : V1/V2 sur une même image ne s'écrivent que si une source NOMME quel produit est holo (marquage de l'API partagée holo / non holo).
// Code neutre `prv` (source, lot `prv-2026-10`, clé R2 `prv/<set>/<num>-<carte>-<langue>.webp`) : aucun nom de source en public ; l'adresse d'origine et l'hôte restent internes (traçabilité, retrait).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const RC = require('./collecte-cartes/recolte-commun');
const CLI = require('./collecte-cartes/recolte-cli');
const CO = require('./collecte-cartes/comblement');
const PV = require('./collecte-cartes/preuves');

const DOSSIER_PHASE4 = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\PHASE4';
const DOSSIER = path.join(DOSSIER_PHASE4, 'PRV');
const CODE = 'prv';
const SRC = PV.SRC;
const NOM_FAMILLE = /^[A-Za-z0-9_-]+$/;
const DOSSIERS_RESERVES = new Set(['CACHE', 'VALIDATIONS', 'PRV']);
const sha256Texte = b => PV.sha256De(b);

// ── 0. Les familles : un dossier S8\PHASE4\<FAMILLE> qui porte un preuves.json ───────────────────────────────────────────────
function listerFamilles(racine, filtre = null) {
    const noms = fs.readdirSync(racine, { withFileTypes: true })
        .filter(d => d.isDirectory() && NOM_FAMILLE.test(d.name) && !DOSSIERS_RESERVES.has(d.name) && fs.existsSync(path.join(racine, d.name, 'preuves.json'))).map(d => d.name).sort();
    return filtre ? noms.filter(n => n === filtre) : noms;
}
/** Le manifeste (forme vérifiée), les validations (forme vérifiée) et l'empreinte des DEUX fichiers tels qu'ils sont sur le disque. LÈVE, famille nommée, sur un fichier illisible. */
function lireFamille(racine, famille) {
    const fm = path.join(racine, famille, 'preuves.json'), fv = path.join(racine, 'VALIDATIONS', `valide-${famille}.json`);
    let brutM, manifeste, validations = [], brutV = null;
    try { brutM = fs.readFileSync(fm); manifeste = PV.lireManifeste(JSON.parse(brutM.toString('utf8')), famille); }
    catch (e) { throw new Error(`famille ${famille} : manifeste illisible (${fm}) — ${e.message}`); }
    if (fs.existsSync(fv)) {
        try { brutV = fs.readFileSync(fv); validations = PV.lireValidations(JSON.parse(brutV.toString('utf8'))); }
        catch (e) { throw new Error(`famille ${famille} : validations illisibles (${fv}) — ${e.message}`); }
    }
    return { manifeste, validations, empreinte: { manifeste: sha256Texte(brutM), validations: brutV ? sha256Texte(brutV) : 'absent' } };
}

// ── 1. Le PLAN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const cleLigne = l => `${l.carteId}|${l.slugSet}|${l.numeroFiche ?? ''}`;
/**
 * La base (par `lire`, lecture seule), l'état A/B/C, les manifestes et le cache -> les unités et la décision de chacune. Tout ce qui est refusé l'est avec son motif.
 * @param {{dossier: string, cache: string, lire: object, etat: object[], lecteur: object, fichiers?: object, familles?: string[], octetsDeLaSeconde?: Function}} o
 *   `lire` : { lignes(ids), fiches(carteIds, slugs), numeros(ids), sets(slugs) } — chacun rend des documents natifs.
 */
async function construirePlanAvec({ dossier, cache, lire, etat, lecteur, fichiers = null, familles = null }) {
    if (!Array.isArray(etat) || !etat.length) throw new Error('état A/B/C VIDE — un instrument cassé, pas une absence (§41)');
    const noms = familles ?? listerFamilles(dossier);
    if (!noms.length) throw new Error(`aucune famille avec preuves.json dans ${dossier} — rien à planifier`);
    const etatDe = new Map(etat.map(p => [p.idProduct, p]));
    // tour 4 (2) : les produits des sets à position (slugSet `Battle-Academy*`, `*Trainer-Kit*`) — numéro de la ligne, à défaut celui de numeros_cartes ; nom = celui de l'état. Lus une fois, à la demande.
    let positionsCache = null;
    const positionsConnues = async () => {
        if (positionsCache) return positionsCache;
        const ls = lire.positions ? await lire.positions() : [];
        const sans = ls.filter(l => l.numeroFiche == null).map(l => l.idProduct);
        const nums = new Map((sans.length && lire.numeros ? await lire.numeros(sans) : []).map(n => [n.idProduct, n.numero]));
        return (positionsCache = ls.map(l => ({ idProduct: l.idProduct, numero: l.numeroFiche ?? nums.get(l.idProduct) ?? null, nomEn: etatDe.get(l.idProduct)?.name ?? null, slugSet: l.slugSet })));
    };
    const impressionsCache = new Map();
    const impressionsDe = async carteId => {
        if (!impressionsCache.has(carteId)) impressionsCache.set(carteId, lire.impressions ? ((await lire.impressions([carteId]))[0]?.impressions ?? []) : []);
        return impressionsCache.get(carteId);
    };
    const refus = [], unitesBrutes = [], jugements = {}, empreintes = {}, parRegle = {}, entreesParFamille = {}, avertissements = [], trousAuto = [];
    const MOTIFS_ANNEE = ['position-ambigue', 'numero-imprime-hors-carte'];
    for (const famille of noms) {
        const { manifeste, validations, empreinte } = lireFamille(dossier, famille);
        empreintes[famille] = empreinte;
        // tour 1 (6) : le DOSSIER fait foi ; l'écart de nom ne fait pas lever, il est dit (résumé imprimé par la ligne de commande)
        if (manifeste.ecartDeFamille) avertissements.push(`famille « ${famille} » : le manifeste ${manifeste.familleDeclaree == null ? 'ne se déclare pas' : `se déclare « ${manifeste.familleDeclaree} »`} (le dossier fait foi)`);
        entreesParFamille[famille] = manifeste.entrees.length;
        const r = PV.rapprocher({ entrees: manifeste.entrees, validations });
        for (const x of r.refus) refus.push({ famille, ...x });
        const ids = r.appariees.map(a => a.entree.idProduct);
        const lignesDe = new Map();
        for (const l of ids.length ? await lire.lignes(ids) : []) (lignesDe.get(l.idProduct) || lignesDe.set(l.idProduct, []).get(l.idProduct)).push(l);
        const numerosDe = new Map((ids.length ? await lire.numeros(ids) : []).map(n => [n.idProduct, n]));
        const slugs = [...new Set([...lignesDe.values()].flat().map(l => l.slugSet).filter(Boolean))];
        const setsDe = new Map((slugs.length ? await lire.sets(slugs) : []).map(s => [s._id, s]));
        const acceptees = [], produits = new Map();
        for (const a of r.appariees) {
            const e = a.entree, id = e.idProduct, non = (motif, detail) => refus.push({ famille, idProduct: id, motif, ...(detail ? { detail } : {}) });
            const E = etatDe.get(id);
            if (!E) { non('produit-absent-de-letat'); continue; }
            const ls = lignesDe.get(id) ?? [];
            if (!ls.length) { non('produit-sans-ligne', 'aucune ligne cartes_produits'); continue; }
            if (new Set(ls.map(cleLigne)).size > 1) { non('produit-sur-plusieurs-fiches', [...new Set(ls.map(cleLigne))].join(' ; ')); continue; }
            const L = ls[0];
            if (!L.slugSet || L.carteId == null) { non('produit-sans-set'); continue; }
            const set = setsDe.get(L.slugSet);
            if (!set) { non('set-absent', L.slugSet); continue; }
            if ((set.tirage ?? set.region) !== E.langue) { non('tirage-du-set-different', `set ${set.tirage ?? set.region}, état ${E.langue}`); continue; }
            const produit = { idProduct: id, idExpansion: E.idExpansion ?? L.idExpansion ?? null, tirage: E.langue, tamponnee: E.tamponnee ?? null, numero: L.numeroFiche ?? numerosDe.get(id)?.numero ?? null, carteId: L.carteId, slugSet: L.slugSet, slug: L.slug ?? numerosDe.get(id)?.slug ?? null, nomEn: E.name ?? null };
            // tour 4 (2) : pour une position (Battle Academy, Trainer Kit), la règle a besoin de TOUS les produits de ces sets et des impressions de la carte (lecture seule)
            if (PV.setAdmisPourPosition(L.slugSet)) {
                produit.candidatsPosition = await positionsConnues();
                produit.impressions = await impressionsDe(L.carteId);
            }
            // le cache est RELU, jamais cru (P8)
            const c1 = await PV.verifierCache({ entree: e, dossierCache: cache });
            if (!c1.ok) { non(c1.motif, c1.detail); continue; }
            let octets = { a: c1.octets };
            if (e.regle === 'deux-sources') {
                const s = e.seconde, c2 = await PV.verifierCache({ entree: { url: s.url, sha256: s.sha256, fichier: s.fichier }, dossierCache: cache, sansLargeur: true });
                if (!c2.ok) { non(`seconde-${c2.motif}`, c2.detail); continue; }
                octets = { a: c1.octets, b: c2.octets };
            }
            const ev = await PV.evaluerEntree({ entree: e, produit, octets });
            if (!ev.ok) {
                non(ev.motif, ev.motifs ? ev.motifs.join(', ') : undefined);
                // décision du testeur (tour 4) : une année Battle Academy (ou une moitié de kit) qui ne se prouve pas est un TROU nommé `variantes-indiscernables`, jamais un choix
                if (ev.motifs?.some(m => MOTIFS_ANNEE.includes(m)) && !ev.motifs.some(m => m.startsWith('nom-'))) trousAuto.push({ famille, idProduct: id, motif: 'variantes-indiscernables', interroges: [e.hote], date: new Date().toISOString(), detail: `année / moitié non prouvée : ${ev.motifs.join(', ')}` });
                continue;
            }
            parRegle[e.regle] = (parRegle[e.regle] || 0) + 1;
            produits.set(id, produit);
            jugements[e.url] = c1.jugement;
            acceptees.push({ entree: e, validation: a.validation, produit, langue: PV.langueDuProduit(produit), evaluation: ev, collecteLe: c1.collecteLe });
        }
        // les produits de chaque fiche : TOUS (aussi ceux que le manifeste ne cite pas) — une image qui sert deux produits ne s'écrit que si les deux sont prouvés
        const fiches = new Map();
        if (acceptees.length) {
            const carteIds = [...new Set(acceptees.map(a => a.produit.carteId))], slugsA = [...new Set(acceptees.map(a => a.produit.slugSet))];
            const toutes = await lire.fiches(carteIds, slugsA);
            const sansNumero = toutes.filter(l => l.numeroFiche == null).map(l => l.idProduct);
            const nums = new Map((sansNumero.length ? await lire.numeros(sansNumero) : []).map(n => [n.idProduct, n.numero]));
            for (const l of toutes) {
                const k = PV.cleFiche({ carteId: l.carteId, slugSet: l.slugSet, numero: l.numeroFiche ?? nums.get(l.idProduct) ?? null });
                const liste = fiches.get(k) || fiches.set(k, []).get(k);
                if (!liste.includes(l.idProduct)) liste.push(l.idProduct);
            }
        }
        const g = PV.grouperUnites({ acceptees, fiches, famille });
        for (const x of g.refus) refus.push({ famille, ...x });
        unitesBrutes.push(...g.unites);
    }
    const idx = {};
    for (const u of unitesBrutes) idx[u.url] = jugements[u.url];
    if (fichiers) RC.ecrireJson(fichiers.images, idx);
    const decidees = await RC.decider(SRC, unitesBrutes, lecteur, { largeurDe: u => idx[u.url]?.w ?? null });
    const decisions = {};
    for (const u of decidees) { const k = `${u.groupe}:${u.decision.action}`; decisions[k] = (decisions[k] || 0) + 1; }
    const refusParMotif = {};
    // (le motif d'une règle garde son détail — « preuve-lue:numero-different » ; les autres perdent le leur — « entree-mal-formee »)
    for (const r of refus) { const k = /^(preuve-lue|deux-sources):/.test(r.motif) ? r.motif : r.motif.replace(/:.*$/, ''); refusParMotif[k] = (refusParMotif[k] || 0) + 1; }
    const aAjouter = decidees.filter(u => u.decision.action === 'ajouter');
    const resume = { le: new Date().toISOString(), source: SRC.SOURCE, lot: SRC.LOT, familles: noms, entrees: entreesParFamille, parRegle, unitesProuvees: unitesBrutes.length, decisions, aAjouter: aAjouter.length,
        dontRemplacentUneBasseDefinition: aAjouter.filter(u => u.decision.remplace.length).length, refus, refusParMotif, avertissements };
    return { resume, unites: decidees, restes: refus, empreintes, trousAuto };
}

/** Le plan est-il encore celui des fichiers d'entrée ? null si oui, sinon la phrase du refus. Un plan sans empreintes est périmé par défaut (une garde s'écrit par ce qu'elle autorise). */
function planPerime({ plan, dossier }) {
    const emp = plan?.empreintes;
    if (!emp || typeof emp !== 'object' || !Object.keys(emp).length) return 'plan sans empreintes : à refaire (--plan)';
    for (const [famille, e] of Object.entries(emp)) {
        let maintenant;
        try { maintenant = lireFamille(dossier, famille).empreinte; } catch (err) { return `famille ${famille} : ${err.message} — plan périmé`; }
        if (maintenant.manifeste !== e.manifeste) return `famille ${famille} : le manifeste a changé depuis le plan — refaire --plan`;
        if (maintenant.validations !== e.validations) return `famille ${famille} : les validations ont changé depuis le plan — refaire --plan`;
    }
    return null;
}
/** Les trous à écrire : ceux des manifestes des familles du plan, sauf pour les produits qui ont REÇU un visuel validé (une unité du plan les porte). */
function trousDuPlan({ plan, dossier }) {
    const recus = new Set((plan.unites ?? []).flatMap(u => u.produits ?? []));
    const trous = [], ecartes = [], vus = new Set();
    for (const famille of Object.keys(plan.empreintes ?? {})) {
        const duManifeste = lireFamille(dossier, famille).manifeste.trous;
        const auto = (plan.trousAuto ?? []).filter(t => t.famille === famille && !duManifeste.some(x => x?.idProduct === t.idProduct)).map(({ famille: _f, ...t }) => t);
        const r = PV.trousDuManifeste({ trous: [...duManifeste, ...auto], recus, famille });
        for (const t of [...r.trous, ...r.ecartes]) { if (vus.has(t.idProduct)) throw new Error(`trou ${t.idProduct} : présent dans plusieurs familles`); vus.add(t.idProduct); }
        trous.push(...r.trous); ecartes.push(...r.ecartes);
    }
    return { trous, ecartes };
}

// ── 2. La base en lecture seule (le branchement réel du plan) ────────────────────────────────────────────────────────────────
function lireDepuisLaBase(db, prodDb) {
    const par = async (coll, filtre, projection) => coll.find(filtre, { projection }).toArray();
    const lots = async (ids, f) => { const sortie = []; for (let i = 0; i < ids.length; i += 1000) sortie.push(...await f(ids.slice(i, i + 1000))); return sortie; };
    return {
        lignes: ids => lots(ids, lot => par(db.collection('cartes_produits'), { idProduct: { $in: lot } }, { _id: 0, idProduct: 1, carteId: 1, slugSet: 1, slug: 1, numeroFiche: 1, idExpansion: 1 })),
        fiches: (carteIds, slugs) => par(db.collection('cartes_produits'), { carteId: { $in: carteIds }, slugSet: { $in: slugs } }, { _id: 0, idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 }),
        numeros: ids => lots(ids, lot => par(prodDb.collection('numeros_cartes'), { idProduct: { $in: lot } }, { _id: 0, idProduct: 1, numero: 1, slug: 1 })),
        sets: slugs => par(db.collection('sets'), { _id: { $in: slugs } }, { tirage: 1, region: 1 }),
        // tour 4 (2) : tous les produits des sets à position, et les impressions des cartes (le numéro imprimé lu doit en être une)
        positions: () => par(db.collection('cartes_produits'), { slugSet: { $regex: '^Battle-Academy|Trainer-Kit' } }, { _id: 0, idProduct: 1, slugSet: 1, numeroFiche: 1 }),
        impressions: ids => par(db.collection('cartes'), { _id: { $in: ids } }, { impressions: 1 })
    };
}
const contexte = { racine: DOSSIER_PHASE4, familles: null };
async function construirePlan({ db, fichiers }) {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    try {
        const nomEtat = CO.dernierEtat(fs.readdirSync(CO.DOSSIER_COMPTEURS)).fichier;
        const etat = JSON.parse(fs.readFileSync(path.join(CO.DOSSIER_COMPTEURS, nomEtat), 'utf8'));
        const plan = await construirePlanAvec({ dossier: contexte.racine, cache: fichiers.cache, lire: lireDepuisLaBase(db, cx.prod.db), etat, lecteur: RC.lecteurNatif(db), fichiers, familles: contexte.familles });
        plan.resume.etat = nomEtat;
        return plan;
    } finally { await cx.fermer(); }
}

const def = { CODE, SRC, DOSSIER, hoteImages: 'aucun', hotesLibelle: 'aucun hôte (aucune requête)',
    clientDe: () => { throw new Error('prv : aucune requête, jamais de client'); }, maximumReleve: () => { throw new Error('prv : aucun relevé'); }, releve: () => { throw new Error('prv : aucun relevé'); }, construirePlan };

// ── 3. La ligne de commande : écrite par ce qu'elle AUTORISE ─────────────────────────────────────────────────────────────────
const AUTORISES = [/^--plan$/, /^--planche$/, /^--compter$/, /^--compter-trous$/, /^--ecrire$/, /^--trous$/, /^--retirer$/, /^--attendu=\d{1,5}$/, /^--echantillon=\d{1,3}$/, /^--famille=[A-Za-z0-9_-]+$/, /^--dossier=.+$/, /^--cache=.+$/, /^--racine=.+$/, /^--basse-definition$/];
const MODES = ['--plan', '--planche', '--compter', '--compter-trous', '--ecrire', '--trous', '--retirer'];
function verifierArguments(args) {
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return `argument inconnu : ${inconnus.join(' ')} (ce fournisseur ne fait aucune requête : ni --releve ni --telecharger)`;
    const modes = MODES.filter(m => args.includes(m));
    if (modes.length !== 1) return `un seul mode parmi ${MODES.join(', ')}`;
    const mode = modes[0], a = nom => args.some(x => x.startsWith(`--${nom}=`));
    if (['--ecrire', '--trous'].includes(mode) && !a('attendu')) return `${mode} exige --attendu=<N>`;
    if (a('attendu') && !['--ecrire', '--trous'].includes(mode)) return '--attendu ne va qu\'avec --ecrire ou --trous';
    if (a('echantillon') && mode !== '--planche') return '--echantillon ne va qu\'avec --planche';
    if (a('famille') && mode !== '--plan') return '--famille ne va qu\'avec --plan';
    if (args.includes('--basse-definition') && !['--compter', '--planche', '--ecrire'].includes(mode)) return '--basse-definition ne va qu\'avec --compter, --planche ou --ecrire';
    return null;
}
async function principal(args = process.argv.slice(2)) {
    const refus = verifierArguments(args);
    if (refus) { console.error(`❌ ${refus}`); process.exitCode = 2; return; }
    const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
    const mode = MODES.find(m => args.includes(m));
    try {
        // AVANT tout, même avant de lire un fichier : hors lot-additif.js, aucune écriture ne s'ouvre
        if (['--ecrire', '--trous'].includes(mode)) require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);
        contexte.racine = RC.verifierChemin(val('racine') ?? DOSSIER_PHASE4);
        contexte.familles = val('famille') ? listerFamilles(contexte.racine, val('famille')) : null;
        if (contexte.familles && !contexte.familles.length) throw new Error(`famille « ${val('famille')} » : aucun preuves.json dans ${contexte.racine}`);
        const dossier = RC.verifierChemin(val('dossier') ?? path.join(contexte.racine, 'PRV'));
        const cache = RC.verifierChemin(val('cache') ?? path.join(contexte.racine, 'CACHE'));
        const F = CLI.fichiersDe(CODE, dossier, cache);
        if (mode !== '--plan') {
            const plan = RC.lireJson(F.plan, null);
            if (!plan?.unites) throw new Error(`${F.plan} absent : lancer --plan d'abord`);
            const perime = planPerime({ plan, dossier: contexte.racine });
            if (perime) throw new Error(`plan périmé : ${perime}`);
            if (mode === '--compter-trous' || mode === '--trous') return await modeTrous({ mode, plan, racine: contexte.racine, attendu: val('attendu') });
        }
        const transmis = args.filter(a => !/^--(famille|racine)=/.test(a));
        if (!transmis.some(a => a.startsWith('--cache='))) transmis.push(`--cache=${cache}`);
        if (!transmis.some(a => a.startsWith('--dossier='))) transmis.push(`--dossier=${dossier}`);
        await CLI.lancer(def, transmis);
    } catch (e) { console.error('❌', e.message); process.exitCode = 1; }
}
// Les connexions : { db, fermer }. La lecture ne passe QUE par la connexion de lecture seule ; l'écriture par celle de lot-additif.js (la ligne de commande a déjà refusé hors lot).
const connexionsReelles = {
    lecture: async () => {
        const l = await require('./collecte-cartes/ouvrir-lecture').ouvrirLecture();
        if (!l) throw new Error('MONGODB_CARTES_LECTURE_URI absente : --compter-trous ne lit que par la connexion de lecture seule — refus, aucune connexion ouverte');
        return { db: l.cartes.db, fermer: () => l.fermer() };
    },
    ecriture: async () => { const { cartes: cx, fermer } = await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] }); return { db: cx.db, fermer }; }
};
async function modeTrous({ mode, plan, racine, attendu, connexions = connexionsReelles }) {
    const { trous, ecartes } = trousDuPlan({ plan, dossier: racine });
    const complets = trous.map(t => CO.construireTrou({ idProduct: t.idProduct, motif: t.motif, sources: t.sources, preuve: t.preuve, le: t.le }));
    if (mode === '--compter-trous') {
        const c = await connexions.lecture();
        try { const b = await CO.lireBilanTrous(c.db, complets); console.log(`COMPTE TROUS : --attendu=${b.nouveaux + b.changes} (nouveaux ${b.nouveaux}, changés ${b.changes}, inchangés ${b.inchanges}) · trous du manifeste ${complets.length} · écartés (le produit reçoit un visuel validé) ${ecartes.length}`); } finally { await c.fermer(); }
        return;
    }
    const c = await connexions.ecriture();
    try {
        const b = await CO.lireBilanTrous(c.db, complets), reel = b.nouveaux + b.changes;
        if (Number(attendu) !== reel) { console.error(`❌ --attendu=${attendu} mais ${reel} trou(s) à écrire — rien n'est écrit.`); process.exitCode = 2; return; }
        const r = await CO.ecrireTrous(c.db, complets, { le: new Date() });
        console.log(`TROUS : nouveaux ${r.nouveaux} · changés ${r.changes} · inchangés ${r.inchanges} · REQUÊTES 0`);
    } finally { await c.fermer(); }
}

module.exports = { listerFamilles, lireFamille, construirePlanAvec, planPerime, trousDuPlan, modeTrous, lireDepuisLaBase, construirePlan, verifierArguments, principal, def, SRC, CODE, DOSSIER, DOSSIER_PHASE4 };
// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main === module) principal();

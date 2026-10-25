'use strict';
// ============================================================
// LE COMBLEMENT AUTOMATIQUE — le cœur (point 5 du testeur, 25/10) : testable sans base ni réseau (fonctions pures + injection)
// ============================================================
// Chaque jour, après l'import du catalogue : prendre les produits SANS visuel (les plus populaires d'abord), chercher des candidats chez les fournisseurs « récolte » déjà outillés (scx, ppr, pmk, tcs),
// ne poser un visuel que si la règle du 0 faux par l'image (concordance-image.js, `deciderVisuel`) dit `ecrire`, et écrire TOUT LE RESTE en TROU NOMMÉ (motif fermé, sources interrogées, date).
// Rien n'est recopié (§21 bis) : la règle d'image, le tirage, le téléchargement poli, la décision d'écriture, la garde de lot sont CEUX de la production ; ce module les ENCHAÎNE.
//
// DÉCISIONS DU COORDINATEUR (BRIEF-J1, appliquées telles quelles) :
//  R1 population = `classeVisuel === 'MANQUANT'` ET `classeFiche !== 'SANS_LIGNE'` (une fiche existe), triée par popularité (collecte-cartes/popularite.js) ; sans offre en cours et non NEUF = trou `sans-offre` sans recherche ; plafond 200.
//  R2 TIRAGE DU CANDIDAT = ce que la SOURCE dit, jamais ce que NOUS avons déduit (sinon le contrôle se confirme lui-même) : langue = celle de la source, numéro = `numeroSource` avant le « / » (null s'il est absent),
//     codeSet = null (le `groupe` est NOTRE code de table), tampon = celui que la source déclare pour le set.
//  R3 TIRAGE DU PRODUIT : la langue du tirage du set (table énumérée ci-dessous, défaut null = EXCLUT), codeSet et numéro de `numeros_cartes`, tampon = `tamponnee` de l'état. Toute discordance de forme exclut : direction sûre (0 faux).
//  R4 un produit qui n'a de candidat que chez UNE source libre n'est pas téléchargé (trou direct, 0 requête) ; seuls les produits à ≥ 2 sources libres se téléchargent.
//  R5 PAS DE « SCANS CONFORMES » dans cette version : un produit MANQUANT n'a, par définition, aucun visuel au même (set, numéro, langue) — il n'y a donc aucun vrai scan conforme à lui opposer.
//  R6 gagnant d'un `ecrire` = parmi les DEUX sources de la paire retenue (`preuve.paireSources`), celle dont l'original est le plus LARGE ; égalité = l'ordre du registre.
//  R7 trous nommés : collection additive `trous_nommes`, motifs FERMÉS (ci-dessous), jamais un motif hors liste.
//  R8 gardes écrites par ce qu'elles AUTORISENT : STOP absent ET file à l'arrêt (code 0 seulement).
const path = require('path');
const RC = require('./recolte-commun');
const CI = require('./concordance-image');

// ── 0. Le registre des fournisseurs : ajouter une source = UNE ligne ──────────────────────────────────────────────────────────
const FOURNISSEURS = Object.freeze(['collecteur-images-scrydex.js', 'collecteur-images-pokipair.js', 'collecteur-images-packmagik.js', 'collecteur-images-tcgcsv.js'].map(f => path.join(__dirname, '..', f)));
/** Les `def` des fournisseurs, dans l'ordre du registre (cet ordre départage les égalités de largeur, R6). LÈVE sur un module sans `def` ou un code en double. */
function chargerFournisseurs(chemins = FOURNISSEURS, req = require) {
    const sortie = [], vus = new Set();
    for (const c of chemins) {
        const m = req(c), d = m?.def;
        if (!d || typeof d.CODE !== 'string' || !d.CODE || !d.SRC || typeof d.construirePlan !== 'function' || typeof d.clientDe !== 'function' || typeof d.hoteImages !== 'string') throw new Error(`fournisseur ${c} : pas de « def » complet (CODE, SRC, construirePlan, clientDe, hoteImages)`);
        if (vus.has(d.CODE)) throw new Error(`fournisseur ${c} : code « ${d.CODE} » en double`);
        vus.add(d.CODE); sortie.push({ code: d.CODE, def: d });
    }
    if (!sortie.length) throw new Error('aucun fournisseur');
    return sortie;
}

// ── 1. Les motifs FERMÉS et les trous nommés (R7) ─────────────────────────────────────────────────────────────────────────────
// Les cinq motifs de la règle d'image sont CEUX de concordance-image.js (jamais recopiés) ; trois s'y ajoutent ici. `source-bloquee:<code>` est la sixième famille (le code est celui d'un fournisseur).
const MOTIFS = Object.freeze([...CI.MOTIFS_TROU, 'sans-offre', 'sous-le-seuil', 'a-confirmer']);
const motifAdmis = m => typeof m === 'string' && (MOTIFS.includes(m) || /^source-bloquee:[a-z0-9]+$/.test(m));
const INSTRUMENT = 'comblement-nocturne';
/** Un trou nommé : la preuve « quel instrument, quelles sources, quelle date » (§36). LÈVE sur tout ce qui n'est pas dans la forme. */
function construireTrou({ idProduct, motif, sources, preuve = {}, le }) {
    if (!Number.isInteger(idProduct)) throw new Error(`trou : idProduct entier exigé (reçu ${JSON.stringify(idProduct)})`);
    if (!motifAdmis(motif)) throw new Error(`trou ${idProduct} : motif « ${motif} » hors de la liste fermée (${MOTIFS.join(', ')}, source-bloquee:<code>)`);
    if (!Array.isArray(sources)) throw new Error(`trou ${idProduct} : « sources » (les codes interrogés) exigées, même vides`);
    if (!(le instanceof Date) || Number.isNaN(le.getTime())) throw new Error(`trou ${idProduct} : date valide exigée`);
    return { idProduct, motif, sources: [...sources], preuve, le, instrument: INSTRUMENT };
}
/** Écrit les trous dans `trous_nommes` (la base `cartes`, par la connexion de ÉCRITURE de lot-additif.js seulement) : upsert par idProduct, `premierLe` posé à l'insertion seulement. ADDITIF : jamais de suppression. */
async function ecrireTrous(db, trous, { taille = 1000 } = {}) {
    for (const t of trous) { construireTrou(t); }                // TOUT est validé AVANT la première écriture
    let n = 0;
    for (let i = 0; i < trous.length; i += taille) {
        const ops = trous.slice(i, i + taille).map(t => ({ updateOne: { filter: { _id: t.idProduct }, update: { $set: { idProduct: t.idProduct, motif: t.motif, sources: t.sources, le: t.le, instrument: t.instrument, preuve: t.preuve }, $setOnInsert: { premierLe: t.le } }, upsert: true } }));
        await db.collection('trous_nommes').bulkWrite(ops, { ordered: false });
        n += ops.length;
    }
    return n;
}

// ── 2. Les tirages : celui du PRODUIT (R3) et celui du CANDIDAT (R2) ──────────────────────────────────────────────────────────
/** Le tirage d'un set -> la langue de ses cartes. Table ÉNUMÉRÉE ; tout le reste (idth = deux langues, inconnu, absent) = null, qui EXCLUT. */
const LANGUE_DU_TIRAGE = Object.freeze({ intl: 'en', jp: 'ja', 'zh-hans': 'zh-hans', 'zh-hant': 'zh-hant', id: 'id', th: 'th' });
const langueDuTirage = t => (typeof t === 'string' && Object.hasOwn(LANGUE_DU_TIRAGE, t) ? LANGUE_DU_TIRAGE[t] : null);
/** « 024/208 » -> « 024 » ; absent ou vide -> null. */
function reduireNumero(n) {
    if (n == null) return null;
    const s = String(n).split('/')[0].trim();
    return s === '' ? null : s;
}
const tirageProduit = p => ({ langue: langueDuTirage(p?.langue), codeSet: p?.codeSet ?? null, numero: reduireNumero(p?.numero), tampon: p?.tamponnee ?? null });
const tirageCandidat = (def, u) => ({ langue: def.SRC.LANGUE, numero: reduireNumero(u.numeroSource), codeSet: null, tampon: def.SRC.tampon(u.slugSet) ?? null });

// ── 3. R1 : la population ─────────────────────────────────────────────────────────────────────────────────────────────────────
const PLAFOND_PAR_DEFAUT = 200;
const P = require('./popularite');
/**
 * @param {{etat: object[], guide: Map, numeros: Map, neufs: Set<number>, limite?: number}} e
 * @returns {{base: number, cibles: object[], sansOffre: object[], reportes: number}}
 */
function choisirPopulation({ etat, guide, numeros, neufs, limite = PLAFOND_PAR_DEFAUT }) {
    if (!Number.isInteger(limite) || limite < 1) throw new Error(`population : limite entière ≥ 1 exigée (reçu ${limite})`);
    if (!Array.isArray(etat) || !etat.length) throw new Error('population : l\'état A/B/C est VIDE — un instrument cassé, pas une absence (§41)');
    const manquants = etat.filter(p => p.classeVisuel === 'MANQUANT');
    if (!manquants.length) throw new Error(`population : aucun produit MANQUANT sur ${etat.length} — le filtre ne mord sur rien (§41)`);
    const base = manquants.filter(p => p.classeFiche !== 'SANS_LIGNE');
    const decores = base.map(p => ({ idProduct: p.idProduct, name: p.name ?? null, idExpansion: p.idExpansion ?? null, langue: p.langue ?? null, tamponnee: p.tamponnee ?? null, classeFiche: p.classeFiche,
        pop: P.popDe(guide.get(p.idProduct)), codeSet: numeros.get(p.idProduct)?.codeSet ?? null, numero: numeros.get(p.idProduct)?.numero ?? null, neuf: neufs.has(p.idProduct) }));
    const tries = P.trier(decores);
    const aChercher = tries.filter(x => x.pop.offres || x.neuf);
    return { base: base.length, cibles: aChercher.slice(0, limite), sansOffre: tries.filter(x => !(x.pop.offres || x.neuf)), reportes: Math.max(0, aChercher.length - limite) };
}
/** Les produits NEUFS : `dateAdded` du catalogue postérieure au dernier passage réussi. Sans passage précédent, personne n'est dit neuf (rien ne se devine). */
function calculerNeufs(dates, depuis) {
    const s = new Set();
    if (!(depuis instanceof Date) || Number.isNaN(depuis.getTime())) return s;
    for (const [id, d] of dates) { const t = d instanceof Date ? d : (d ? new Date(d) : null); if (t && !Number.isNaN(t.getTime()) && t > depuis) s.add(id); }
    return s;
}

// ── 4. Le regroupement par produit, la classe (0 / 1 / ≥ 2 sources) ──────────────────────────────────────────────────────────
/** Map idProduct -> [{code, unite}] : seules les unités `ajouter` et les produits DE LA POPULATION. Une unité à deux produits compte pour chacun. */
function regrouperUnites(parFournisseur, ids) {
    const g = new Map();
    for (const { code, unites } of parFournisseur) for (const u of unites || []) {
        if (u?.decision?.action !== 'ajouter') continue;
        for (const id of u.produits || []) { if (!ids.has(id)) continue; (g.get(id) || g.set(id, []).get(id)).push({ code, unite: u }); }
    }
    return g;
}
/** Un fournisseur qui propose DEUX adresses pour le même produit est AMBIGU : il est écarté (jamais deviné) et nommé. */
function candidatsDuProduit(entrees) {
    const parCode = new Map();
    for (const e of entrees || []) (parCode.get(e.code) || parCode.set(e.code, []).get(e.code)).push(e);
    const candidats = [], ambigus = [];
    for (const [code, l] of parCode) { if (new Set(l.map(e => e.unite.url)).size > 1) ambigus.push(code); else candidats.push(l[0]); }
    return { candidats, ambigus };
}
/** -> { action: 'telecharger', sources } | { action: 'trou', motif }. Les sources bloquées ne se téléchargent jamais. */
function classerProduit({ candidats, ambigus = [] }, bloques, ordre) {
    const rang = c => ordre.indexOf(c);
    const codes = [...new Set(candidats.map(c => c.code))].sort((a, b) => rang(a) - rang(b));
    const libres = codes.filter(c => !bloques.has(c)), bloquesPresentes = codes.filter(c => bloques.has(c));
    if (libres.length >= 2) return { action: 'telecharger', sources: libres };
    if (bloquesPresentes.length) return { action: 'trou', motif: `source-bloquee:${bloquesPresentes[0]}` };
    if (ambigus.length) return { action: 'trou', motif: 'discordance-image' };
    return { action: 'trou', motif: libres.length === 1 ? 'une-seule-source' : 'aucune-source' };
}
/**
 * Le plan, 0 requête : pour chaque produit de la population, ses candidats et sa classe.
 * @returns {{produits: object[], trousDirects: object[], comptes: object}}
 */
function planifier({ cibles, parFournisseur, ordre, le = new Date() }) {
    const bloques = new Set(parFournisseur.filter(f => f.bloquee).map(f => f.code));
    const g = regrouperUnites(parFournisseur, new Set(cibles.map(c => c.idProduct)));
    const produits = [], trousDirects = [], comptes = { aucune: 0, une: 0, deuxPlus: 0, bloquees: 0 };
    let ambigusN = 0;
    for (const c of cibles) {
        const { candidats, ambigus } = candidatsDuProduit(g.get(c.idProduct) || []);
        const cl = classerProduit({ candidats, ambigus }, bloques, ordre);
        if (cl.action === 'telecharger') {
            comptes.deuxPlus++;
            produits.push({ idProduct: c.idProduct, name: c.name, produit: tirageProduit(c), sources: cl.sources, candidats: candidats.filter(x => cl.sources.includes(x.code)) });
            continue;
        }
        if (cl.motif === 'aucune-source') comptes.aucune++; else if (cl.motif === 'une-seule-source') comptes.une++; else if (cl.motif.startsWith('source-bloquee:')) comptes.bloquees++; else ambigusN++;
        trousDirects.push(construireTrou({ idProduct: c.idProduct, motif: cl.motif, sources: ordre, le, preuve: { candidats: candidats.map(x => x.code), ambigus, bloquees: [...bloques] } }));
    }
    if (ambigusN) comptes.ambigus = ambigusN;
    return { produits, trousDirects, comptes };
}

/** Les unités de chaque fournisseur (plan de SA collecte, 0 requête). Un plan qui échoue ARRÊTE TOUT : un fournisseur muet ne devient jamais « aucune source ». */
async function recolterUnites({ fournisseurs, db, lireReleves, arret, fichiersDe = null }) {
    const sortie = [];
    for (const { code, def } of fournisseurs) {
        const bloquee = Boolean(arret(def.hoteImages));
        let plan;
        try { plan = await def.construirePlan({ db, releves: lireReleves(def), fichiers: fichiersDe ? fichiersDe(def) : undefined }); }
        catch (e) { throw new Error(`${code} : plan en échec (${e.message}) — rien ne se conclut sur un fournisseur qui n'a pas répondu`); }
        sortie.push({ code, bloquee, unites: plan.unites || [] });
    }
    return sortie;
}

// ── 5. Le téléchargement : les seuls produits à ≥ 2 sources libres, fournisseur par fournisseur ───────────────────────────────
/**
 * Le MAXIMUM de requêtes est compté et imprimé AVANT la première (§38). Une source dont l'hôte est arrêté : 0 requête, son client n'est même pas construit.
 * @returns {Promise<object[]>} un rapport par fournisseur effectivement lancé
 */
async function telechargerPlan({ plan, fournisseurs, plafond, fichiersDe, telecharger, arret, maximumImages, indexDe, journal = m => console.log(m) }) {
    const lots = [];
    for (const { code, def } of fournisseurs) {
        const flag = plan.fournisseurs?.find(f => f.code === code)?.bloquee;
        const arrete = flag || arret(def.hoteImages);
        const vues = new Set(), unites = [];
        for (const p of plan.produits) for (const c of p.candidats) if (c.code === code && !vues.has(c.unite.url)) { vues.add(c.unite.url); unites.push(c.unite); }
        lots.push({ code, def, unites, arrete: arrete ? (arrete.motif ?? 'bloquée') : null });
    }
    const maxima = lots.map(l => {
        if (l.arrete) return { code: l.code, total: 0, detail: `⛔ arrêt durable de l'hôte (${l.arrete}) : 0 requête` };
        if (!l.unites.length) return { code: l.code, total: 0, detail: 'rien à télécharger : 0 requête' };
        const F = fichiersDe(l.code);
        const m = maximumImages({ F, hoteImages: l.def.hoteImages, unites: l.unites, indexImages: indexDe(F), plafondTotal: plafond });
        return { code: l.code, total: m.total, detail: m.detail ?? '' };
    });
    journal(`MAXIMUM de ce lancement : ${maxima.reduce((n, m) => n + m.total, 0)} requête(s) au plus, cadence ≥ 6 s par hôte · ${maxima.map(m => `${m.code} ${m.total} (${m.detail})`).join(' · ')} · plafond ${typeof plafond === 'function' ? 'de chaque dossier de cache = son contenu + le budget du lancement' : `total ${plafond} par dossier de cache`}`);
    const rapports = [];
    for (const l of lots) {
        if (l.arrete || !l.unites.length) { if (l.arrete) journal(`${l.code} : ⛔ ${l.arrete} — 0 requête`); continue; }
        const F = fichiersDe(l.code);
        const cli = l.def.clientDe(F, plafond);
        const r = await telecharger({ SRC: l.def.SRC, unites: l.unites, cli, fichier: F.images, hoteImages: l.def.hoteImages, progression: F.progression });
        journal(`${l.code} : TÉLÉCHARGEMENT ${r.etat} · ${r.requetes} requête(s) · adresses ${r.adresses} · ${JSON.stringify(r.parStatut)} · restantes ${r.restantes}${r.motif ? ` · ${r.motif}` : ''}`);
        rapports.push({ code: l.code, ...r });
    }
    return rapports;
}

// ── 6. La décision d'un produit (la règle d'image) et le gagnant (R6) ─────────────────────────────────────────────────────────
function choisirGagnant({ paireSources, candidats, largeurDe, ordre }) {
    if (!Array.isArray(paireSources) || paireSources.length !== 2) throw new Error('gagnant : paire de sources absente de la preuve (paireSources)');
    const deux = paireSources.map(code => {
        const c = candidats.find(x => x.code === code);
        if (!c) throw new Error(`gagnant : la source « ${code} » de la paire n'est pas parmi les candidats`);
        return { ...c, w: Number(largeurDe(c.unite)) || 0 };
    });
    deux.sort((a, b) => (b.w - a.w) || (ordre.indexOf(a.code) - ordre.indexOf(b.code)));
    return { code: deux[0].code, unite: deux[0].unite, largeur: deux[0].w };
}
/**
 * Un produit à ≥ 2 sources, ses images au cache : la décision. `jugement(unite)` = l'entrée de l'index d'images (undefined = jamais téléchargée) ; `octets(code, unite)` = les octets du cache.
 *  - une adresse jamais téléchargée (plafond atteint) : le produit est REPORTÉ (ni trou ni visuel : on ne nomme pas ce qu'on n'a pas regardé) ;
 *  - une source dont l'image est sous le seuil / absente / illisible est RETIRÉE (comptée) ; sous deux sources la règle d'image n'est pas même appelée ;
 *  - `ecrire` sans `paireSources` (règle incomplète) : fermé, `a-confirmer`.
 */
async function jugerProduit({ produit, candidats, defs, jugement, octets, decider = CI.deciderVisuel, ordre }) {
    const lus = []; let petits = 0, autres = 0, manquantes = 0;
    for (const c of candidats) {
        const j = jugement(c.unite);
        if (!j) { manquantes++; continue; }
        if (j.statut === 'trop-petit') { petits++; continue; }
        if (j.statut !== 'ok') { autres++; continue; }
        const buf = octets(c.code, c.unite);
        if (!buf) { autres++; continue; }
        lus.push({ ...c, buf, w: j.w });
    }
    if (manquantes) return { decision: 'reporte', preuve: { manquantes } };
    const retirees = { petits, autres };
    if (new Set(lus.map(l => l.code)).size < 2) return { decision: 'trou', motif: petits ? 'sous-le-seuil' : 'illisible', preuve: { retirees, lues: lus.map(l => l.code) } };
    // R5 : aucun scan conforme (un produit MANQUANT n'en a, par définition, aucun au même set / numéro / langue)
    const r = await decider({ produit, candidats: lus.map(l => ({ source: l.code, buf: l.buf, tirage: tirageCandidat(defs.get(l.code), l.unite) })), scansConformes: [] });
    if (r.decision === 'ecrire') {
        let g;
        try { g = choisirGagnant({ paireSources: r.preuve?.paireSources, candidats: lus, largeurDe: u => lus.find(l => l.unite === u)?.w, ordre }); }
        catch (e) { return { decision: 'a-confirmer', motif: 'a-confirmer', preuve: { ...r.preuve, retirees, erreur: e.message } }; }
        return { decision: 'ecrire', gagnant: g, preuve: { ...r.preuve, retirees } };
    }
    if (r.decision === 'a-confirmer') return { decision: 'a-confirmer', motif: 'a-confirmer', preuve: { ...r.preuve, retirees } };
    return { decision: 'trou', motif: r.motif, preuve: { ...r.preuve, retirees } };
}

/**
 * Les verdicts -> ce qu'on écrit : les unités gagnantes par fournisseur (dédoublonnées, produits réunis) et les trous (directs, jugés, à confirmer, sans offre).
 * Un produit couvert par une unité gagnante (même carte, même numéro) n'a PAS de trou.
 */
function assembler({ verdicts, trousDirects, sansOffre, ordre, le }) {
    const gagnants = {}, parCle = new Map();
    for (const v of verdicts) {
        if (v.decision !== 'ecrire') continue;
        const u = v.gagnant.unite, cle = `${v.gagnant.code}|${u.carteId}|${u.slugSet}|${u.numero}|${u.url}`;
        const deja = parCle.get(cle);
        if (deja) { for (const id of u.produits || []) if (!deja.produits.includes(id)) deja.produits.push(id); continue; }
        const copie = { ...u, produits: [...(u.produits || [])] };
        parCle.set(cle, copie);
        (gagnants[v.gagnant.code] ||= []).push(copie);
    }
    const couverts = new Set([...parCle.values()].flatMap(u => u.produits));
    const trous = [...trousDirects.filter(t => !couverts.has(t.idProduct))];
    const reportes = [];
    for (const v of verdicts) {
        if (v.decision === 'reporte') { reportes.push(v.idProduct); continue; }
        if (v.decision === 'ecrire' || couverts.has(v.idProduct)) continue;
        trous.push(construireTrou({ idProduct: v.idProduct, motif: v.motif, sources: ordre, preuve: v.preuve ?? {}, le }));
    }
    for (const p of sansOffre) trous.push(construireTrou({ idProduct: p.idProduct, motif: 'sans-offre', sources: [], preuve: { raison: 'aucune offre en cours au guide : non cherché' }, le }));
    return { gagnants, trous, reportes };
}

/**
 * L'ÉCRITURE, sous lot-additif.js (la ligne de commande le garantit) : compte d'abord (cache seulement), refuse un `--attendu` faux AVANT tout dépôt, écrit un fournisseur après l'autre,
 * puis les trous — et seulement si tous les visuels sont bien écrits.
 * @param {{gagnants: object, defs: Map, attendu: number, ecrireFournisseur: Function, ecrireTrous: Function, trous: object[]}} e
 */
async function executerEcriture({ gagnants, defs, attendu, ecrireFournisseur, ecrireTrous: poserTrous, trous }) {
    const codes = Object.keys(gagnants);
    const reels = {};
    for (const code of codes) reels[code] = (await ecrireFournisseur(defs.get(code), gagnants[code], { compterSeulement: true })).reel;
    const total = Object.values(reels).reduce((n, x) => n + x, 0);
    if (total !== attendu) return { code: 2, etat: 'refuse-attendu', attendu, reel: total, reels, ecrits: 0, trous: 0 };
    let code = 0, ecrits = 0;
    for (const c of codes) {
        const r = await ecrireFournisseur(defs.get(c), gagnants[c], { attendu: reels[c] });
        if (r.code !== 0) code = 1;
        ecrits += r.reel ?? 0;
    }
    if (code !== 0) return { code, etat: 'visuels-incomplets', attendu, reel: total, reels, ecrits, trous: 0 };
    const n = await poserTrous(trous);
    return { code: 0, etat: 'ecrit', attendu, reel: total, reels, ecrits, trous: n };
}

// ── 7. Les gardes avant tout passage (R8), écrites par ce qu'elles AUTORISENT ─────────────────────────────────────────────────
const ETAT_AGE_MAX_JOURS = 3;
/** L'état A/B/C est un instantané : écrire des trous « sans visuel » depuis un instantané ancien serait affirmer ce qu'on n'a pas relu. Date illisible ou absente = trop vieux. */
function etatTropVieux(dateEtat, maintenant = new Date()) {
    if (!(dateEtat instanceof Date) || Number.isNaN(dateEtat.getTime())) return true;
    return maintenant - dateEtat > ETAT_AGE_MAX_JOURS * 24 * 3600 * 1000;
}
/** Un seul chemin mène à « autorisé » : STOP absent ET file-a-l-arret.js rend EXACTEMENT 0. Tout autre cas (code 1, 2, signal, introuvable, exception) refuse. */
function verifierGardes({ dossier, existe, lancerFileArret }) {
    try {
        if (existe(path.join(dossier, 'STOP'))) return { ok: false, raison: `fichier STOP présent dans ${dossier} : le passage ne fait RIEN (supprimer STOP pour reprendre)` };
    } catch (e) { return { ok: false, raison: `le fichier STOP n'a pas pu être cherché (${e.message}) : je ne sais pas, le passage ne fait RIEN` }; }
    let r;
    try { r = lancerFileArret(); } catch (e) { return { ok: false, raison: `file-a-l-arret.js n'a pas pu être lancé (${e.message}) : je ne sais pas, le passage ne fait RIEN` }; }
    if (!r || r.error || r.status !== 0) return { ok: false, raison: `la file n'est pas à l'arrêt ou l'état est inconnu (file-a-l-arret.js : ${r?.error ? r.error.message : `code ${r?.status ?? 'aucun'}${r?.signal ? `, signal ${r.signal}` : ''}`}) : le passage ne fait RIEN` };
    return { ok: true };
}

// ── 8. La ligne de commande : grammaire écrite par ce qu'elle AUTORISE (argument inconnu -> code 2 avant toute connexion) ───────
const AUTORISES = [/^--plan$/, /^--telecharger$/, /^--decider$/, /^--ecrire$/, /^--nuit$/, /^--a-blanc$/, /^--limite=[1-9]\d{0,3}$/, /^--plafond=[1-9]\d{0,3}$/, /^--attendu=\d{1,5}$/, /^--dossier=.+$/];
const MODES = ['--plan', '--telecharger', '--decider', '--ecrire', '--nuit'];
function verifierArguments(args) {
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return `argument inconnu : ${inconnus.join(' ')}`;
    const modes = MODES.filter(m => args.includes(m));
    if (modes.length !== 1) return `un seul mode parmi ${MODES.join(', ')}`;
    const mode = modes[0], a = nom => args.some(x => x.startsWith(`--${nom}=`));
    if (mode === '--telecharger' && !a('plafond')) return '--telecharger exige --plafond=<N>';
    if (mode === '--ecrire' && !a('attendu')) return '--ecrire exige --attendu=<N>';
    if (a('attendu') && mode !== '--ecrire') return '--attendu ne va qu\'avec --ecrire';
    if (a('plafond') && !['--telecharger', '--nuit'].includes(mode)) return '--plafond ne va qu\'avec --telecharger ou --nuit';
    if (a('limite') && !['--plan', '--nuit'].includes(mode)) return '--limite ne va qu\'avec --plan ou --nuit';
    if (args.includes('--a-blanc') && mode !== '--nuit') return '--a-blanc ne va qu\'avec --nuit';
    return null;
}
const DOSSIER_PAR_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\COMBLEMENT';
const DOSSIER_COMPTEURS = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\COMPTEURS';
/** Le dossier de sorties : celui de `--dossier=` (bancs) ou le dossier par défaut ; jamais un dossier d'apports manuels (RC.verifierChemin lève). */
function dossierDe(args) {
    const x = args.find(a => a.startsWith('--dossier='));
    return RC.verifierChemin(x ? x.slice(10) : DOSSIER_PAR_DEFAUT);
}
/** Le plus récent `etat-abc-*.json` : { fichier, le } (la date lue dans le NOM, AAAA-MM-JJ-HHMM, à défaut le fichier est refusé). */
function dernierEtat(noms) {
    const ok = noms.map(n => ({ n, m: /^etat-abc-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.json$/.exec(n) })).filter(x => x.m);
    if (!ok.length) throw new Error('aucun fichier etat-abc-AAAA-MM-JJ-HHMM.json dans le dossier des compteurs');
    ok.sort((a, b) => (a.n < b.n ? 1 : -1));
    const [, A, M, J, H, Mi] = ok[0].m;
    return { fichier: ok[0].n, le: new Date(Date.UTC(+A, +M - 1, +J, +H, +Mi)) };
}

// ── 9. Le compte rendu de la nuit ─────────────────────────────────────────────────────────────────────────────────────────────
function redigerCompteRendu({ date, aBlanc, etat, population, comptesPlan, rapportsTelechargement = [], bloquees = [], ecrit = null, trous = [], reportes = [], visuels = 0, attendu = null, avertissements = [] }) {
    const parMotif = trous.reduce((m, t) => (m[t.motif] = (m[t.motif] || 0) + 1, m), {});
    const L = [`# Comblement nocturne — ${date}${aBlanc ? ' — À BLANC (rien n\'est écrit)' : ''}`, ''];
    L.push(`- état A/B/C : ${etat?.fichier ?? '?'} (du ${etat?.le ? etat.le.toISOString() : '?'})`);
    L.push(`- population : ${population.base} produits MANQUANT avec fiche · cherchés ${population.cibles} · sans offre (trous directs) ${population.sansOffre} · reportés au-delà du plafond ${population.reportes}`);
    L.push(`- classes des cherchés : ${JSON.stringify(comptesPlan)}`);
    L.push(`- sources bloquées : ${bloquees.length ? bloquees.join(', ') : 'aucune'}`);
    for (const r of rapportsTelechargement) L.push(`- téléchargement ${r.code} : ${r.etat}, ${r.requetes} requête(s), adresses ${r.adresses}, ${JSON.stringify(r.parStatut)}, restantes ${r.restantes}`);
    L.push(`- visuels à écrire : ${visuels}${attendu != null ? ` (--attendu=${attendu})` : ''} · trous nommés : ${trous.length} · reportés (images non téléchargées) : ${reportes.length}`);
    L.push(`- par motif : ${JSON.stringify(parMotif)}`);
    if (ecrit) L.push(`- écriture : ${ecrit}`);
    for (const a of avertissements) L.push(`- ⚠️ ${a}`);
    return `${L.join('\n')}\n`;
}

module.exports = { FOURNISSEURS, chargerFournisseurs, MOTIFS, motifAdmis, INSTRUMENT, construireTrou, ecrireTrous, LANGUE_DU_TIRAGE, langueDuTirage, reduireNumero, tirageProduit, tirageCandidat,
    PLAFOND_PAR_DEFAUT, choisirPopulation, calculerNeufs, regrouperUnites, candidatsDuProduit, classerProduit, planifier, recolterUnites, telechargerPlan, choisirGagnant, jugerProduit, assembler, executerEcriture,
    ETAT_AGE_MAX_JOURS, etatTropVieux, verifierGardes, AUTORISES, MODES, verifierArguments, DOSSIER_PAR_DEFAUT, DOSSIER_COMPTEURS, dossierDe, dernierEtat, redigerCompteRendu };

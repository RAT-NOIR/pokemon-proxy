'use strict';
// LOT PROBABLE (31/10) — MESURE CONTRE LA FONCTION DE PRODUCTION, LECTURE SEULE, 0 $, aucun réseau, aucune écriture. Base d'essai lue par MONGODB_ESSAI_LECTURE_URI (chargée par mesure-banc-reel/lib.js, jamais imprimée).
// Rejoue l'ÉTAT D'AUJOURD'HUI des trois bancs (réglage / tamponnées / ordinaires) par le code de CE dépôt : l'adaptateur, puis la garde des groupes ET le jumbo par le titre ALLUMÉS (garde-marqueurs.js),
// puis la décision PROBABLE de la route (identifier/probable-route.js::consulterProbable), avec l'index d'empreintes, les visuels de l'archive et les vecteurs de photo de l'extension (nav-bancs.json, redressées seulement).
// Ce que le banc ne rejoue pas : la règle G, SUR-PAR-IMAGE, la lecture du tampon (éteintes dans l'état livré) — les sûrs qu'elles ajouteraient ne sont pas comptés.
// Usage : node v2/mesures/mesurer-probable-production.js [sortie.json]
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..'), TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
require(path.join(TRAVAIL, 'atlas', 'garde-secrets'));
const { ouvrir } = require(path.join(TRAVAIL, 'mesure-banc-reel', 'lib'));
const rq = m => require(path.join(RACINE, ...m.split('/')));
const GC = rq('v2/identifier/garde-contradiction'), { preparer } = rq('v2/identifier/langue-decisive-charge');
const { adapter, affirmerParLaRoute, questionDeGroupe } = rq('v2/identifier/adaptateur');
const J = rq('v2/identifier/jumeaux'), LD = rq('v2/identifier/langue-decisive'), DES = rq('v2/identifier/designation');
const { construireProduit } = rq('v2/identifier/produit'), GM = rq('v2/identifier/garde-marqueurs');
let consulterProbable = null;       // absent sur 012940a7 (la copie de référence) : seuls les sûrs se mesurent alors, pour la comparaison avant/après
try { ({ consulterProbable } = rq('v2/identifier/probable-route')); } catch { consulterProbable = null; }
const { creerCatalogue } = rq('v2/identifier/catalogue'), { lireConfig } = rq('v2/config'), dbV2 = rq('v2/db');
const S = rq('v2/chargeur/scellement'), F = rq('v2/chargeur/format'), X = rq('v2/identifier/index-empreintes'), EV = rq('v2/identifier/empreinte-vecteur');
const argv = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const ARCHIVE = path.join(TRAVAIL, 'archives', argv('archive') || 'candidate-2026-10-26.rmv');
// G-GROUPE (--g-groupe) : après PROBABLE, une question qu'il ne désigne pas reçoit la tête de g-groupe.js si TOUTES les gardes de PROBABLE passent (probable-route.js::designerTeteDeGroupe) ; il faut une archive AVEC la colonne des emprunts.
const GGFLAG = process.argv.includes('--g-groupe');
const ECART = Number(argv('ecart') || 50);
const CARTES = path.join(TRAVAIL, 'index-empreintes-essai', 'donnees-nav', 'cartes-bancs');
const CACHE_F = path.join(TRAVAIL, 'g-groupe', 'cache-mesures.json');
const INDEX = path.join(TRAVAIL, 'index-empreintes-essai', 'sortie', 'index-empreintes-2026-10-24.rmei');
const NAV = path.join(TRAVAIL, 'index-empreintes-essai', 'donnees-nav', 'nav-bancs.json');
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const CORR = require(path.join(TRAVAIL, 'mesure-banc-reel', 'corrections-etiquettes.json'));
const CORRESP = require(path.join(TRAVAIL, 'planche-surs', 'correspondance.json'));
const ETIQ54 = new Map(require(path.join(TRAVAIL, 'planche-surs', 'etiquettes-surs.json')).map(e => [e.cas, e.verdict]));
const VERITE_TESTEUR = { S41: 275094 };
const REGLAGE = new Set(require(path.join(TRAVAIL, 'langue-decisive', 'resultats-final.json')).lignes.map(l => l.cle));
const SOIR = new Date('2026-10-17T16:00:00Z');
const RELEVE = new Map(require(path.join(TRAVAIL, 'tampons', 'controle-tampons-2026-10-18.json')).lignes.flatMap(l => l.scans.flatMap(s => s.cartes.map(k => [k.cle, l.idProduct]))));
const F_ORD = path.join(TRAVAIL, 'planche-ordinaires', 'controle-ordinaires.json');
const ORDINAIRES = new Map(fs.existsSync(F_ORD) ? JSON.parse(fs.readFileSync(F_ORD, 'utf8')).lignes.map(l => [l.cle, l.idProduct]) : []);
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const idsDe = choix => (Array.isArray(choix) ? choix : []).map(x => (x && typeof x === 'object') ? (x.idProduct ?? null) : x).filter(Number.isInteger);
const NOMS = Object.keys(DES.REGLES_DESIGNATION), TOUTES = Object.fromEntries(NOMS.map(k => [k, true]));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + ' %' : 'n/a');

(async () => {
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(ARCHIVE), process.env.V2_VISUELS_HMAC)));
    const o = X.ouvrir(fs.readFileSync(INDEX), process.env.V2_VISUELS_HMAC, { modeleAttendu: MODELE }), idx = o.index;
    const etat = { courante: () => ({ index: idx, meta: { modele: MODELE } }) };
    const nav = JSON.parse(fs.readFileSync(NAV, 'utf8')).photos;
    // ── G-GROUPE : l'index et l'archive EN PLACE (comme la route), le fournisseur sans ORB serveur (ce que le client recevrait), et les mesures calculées par les fonctions de pixels de production, gardées dans un cache
    let GGX = null;
    if (GGFLAG) {
        const VE = rq('v2/identifier/voisins-empreinte'), CR = rq('v2/identifier/carte-redressee'), Z = rq('ratmarket/zones'), MC = rq('v2/identifier/calcul-client'), GGm = rq('v2/identifier/g-groupe'), PRO = rq('v2/identifier/probable-route'), G = rq('ratmarket/decision-g');
        rq('v2/identifier/etat-empreintes').installer(Object.freeze({ index: idx, meta: Object.freeze(o.meta) }));
        rq('v2/chargeur/etat').installer(V);
        const cache = fs.existsSync(CACHE_F) ? JSON.parse(fs.readFileSync(CACHE_F, 'utf8')) : {};
        const crypto = require('crypto'), sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
        const DIRS = [path.join(TRAVAIL, 'index-empreintes-essai', 'images'), path.join(TRAVAIL, 'index-empreintes', 'images'), path.join(TRAVAIL, 'modele-visuel-hors-ligne', 'cache-archive', 'img')];
        const lireScan = cle => { for (const d of DIRS) { const p = path.join(d, sha1(cle) + '.webp'); if (fs.existsSync(p)) return fs.readFileSync(p); } return null; };
        // le cache est amorcé par l'extraction du lot (mesures-bancs.json) : mêmes photos, mêmes scans, mêmes fonctions
        try {
            const M0 = JSON.parse(fs.readFileSync(path.join(TRAVAIL, 'g-groupe', 'mesures-bancs.json'), 'utf8'));
            for (const l of M0.lignes) { const sid = l.cle.split(':')[0]; for (const r of (l.resultats || [])) if (r) cache[r.type === 'paire' ? `${sid}|p|${r.a}|${r.b}` : `${sid}|z|${r.ref}`] = r; for (const [k, z] of Object.entries(l.zonesGroupe || {})) if (z) cache[`${sid}|z|${k}`] = z; }
        } catch { /* pas d'amorce : tout se calcule */ }
        GGX = { VE, CR, Z, MC, GG: GGm, PRO, G, cache, lireScan, fournisseur: VE.creerFournisseurEmpreinte({ cfg: { modeleEmpreinte: MODELE }, orbServeur: false }), calculees: 0 };
    }
    console.log(`code mesuré : ${RACINE} · archive ${path.basename(ARCHIVE)} · index ${path.basename(INDEX)} · colonne marquages ${V.colonneMarquages === true} · ordinaires ${ORDINAIRES.size}`);
    const { c, db } = await ouvrir();
    dbV2.brancher(db);
    const cfg0 = lireConfig({});
    const cfg = { ...cfg0, probable: true, empreinteExtension: true, modeleEmpreinte: MODELE };
    const cat = creerCatalogue({ cfg: cfg0, visuels: { entree: id => V.entree(id), tirage: id => V.tirageJumeaux(id), resoudre: async () => null, impressions: async () => [] } });
    await cat.indexCodeNumero(); await cat.indexFamilles();
    const A = await db.collection('analyses').find({}).toArray();
    const JN = new Map((await db.collection('journal_scans').find({}).toArray()).map(j => [String(j._id), j]));
    const Aid = new Set(A.map(a => String(a._id)));
    const orph = [...JN.values()].filter(j => !Aid.has(String(j._id)));
    const jDe = a => { const j = JN.get(String(a._id)); if (j) return j; const t = a.creeLe.getTime(); const cand = orph.filter(o2 => Math.abs(new Date(o2.le).getTime() - t) <= 10000); return cand.length === 1 ? cand[0] : null; };
    let titres = new Map();
    try { const ann = await db.collection('annonces').find({}).project({ titre: 1 }).toArray(); titres = new Map(ann.map(x => [String(x._id), typeof x.titre === 'string' ? x.titre : null])); } catch { titres = new Map(); }
    console.log(`titres lus : ${[...titres.values()].filter(Boolean).length} sur ${titres.size} annonces`);
    const sDe = new Map(Object.entries(CORRESP).map(([s, x]) => [`${x.scanId}:${x.carte}`, s]));
    const corr = new Map(CORR.corrections.map(x => [`${x.scanId}:${x.carte}`, x.nouveau]));
    const VF = new Set(CORR.planche54.varianteFausse);
    const lignesCache = new Map();
    const ligneDe = async id => { if (!lignesCache.has(id)) lignesCache.set(id, (await cat.lire([id])).get(id) || null); return lignesCache.get(id); };
    const memeCreneau = (x, y) => x && y && x.numero != null && x.numero === y.numero && x.set && y.set && x.set.code === y.set.code;
    const lignes = [];
    for (const a of A) for (const [i, k] of a.cartes.entries()) {
        const cle = `${String(a._id)}:${i}`, s = sDe.get(cle) || null, j = jDe(a), e = k.etiquetteAdmin || null;
        let verite = e ? (e.idProduct ?? null) : null;
        if (corr.has(cle)) verite = corr.get(cle);
        if (s && VERITE_TESTEUR[s]) verite = VERITE_TESTEUR[s];
        if (RELEVE.has(cle)) verite = RELEVE.get(cle);
        if (ORDINAIRES.has(cle) && !RELEVE.has(cle) && !REGLAGE.has(cle)) verite = ORDINAIRES.get(cle);
        const surStocke = k.statut === 'identifiee';
        let classeStockee = null;
        if (surStocke) {
            if (s) { const lab = ETIQ54.get(s); classeStockee = VERITE_TESTEUR[s] ? 'faux' : VF.has(s) ? 'variante' : lab === 'juste' ? 'juste' : lab === 'ne-sait-pas' ? 'ne-sait-pas' : 'autre'; }
            else if (Number.isInteger(verite)) classeStockee = k.idProduct === verite ? 'juste' : 'faux';
            else classeStockee = 'non-etiquete';
        }
        const banc = REGLAGE.has(cle) ? 'reglage' : (RELEVE.has(cle) || ORDINAIRES.has(cle) || (e && e.le && new Date(e.le) >= SOIR)) ? 'controle' : 'hors-banc';
        const L = { cle, scanId: String(a._id), s, verite, surStocke, classeStockee, idStocke: k.idProduct ?? null, choixStockes: idsDe(k.question && k.question.choix), banc, famille: banc === 'reglage' ? 'reglage' : RELEVE.has(cle) ? 'tamponnee' : 'ordinaire', titre: titres.get(String(a._id)) ?? null };
        lignes.push(L);
        if (!j) continue;
        const chainAffirmee = j.resultat === 'succes' && j.carteIncertaine === false && Number.isInteger(j.idProduct);
        const unique = j.resultat === 'succes' && j.carteIncertaine === true && Array.isArray(j.candidatsRendus) && j.candidatsRendus.length === 1;
        const W = chainAffirmee ? j.idProduct : unique ? j.candidatsRendus[0] : null;
        const luBloc = { numero: j.numero, total: j.total, setCode: j.setCode, symboleSet: j.symboleSet, attaque: j.attaqueLue, attaqueConfiance: j.attaqueConfiance, carteTcgdexId: j.carteTcgdexId, langue: j.langue, totalHorsTailleDeSet: j.totalHorsTailleDeSet === true };
        const enTete = { etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' }, classement: [], codeLangue: 1 };
        if (W === null && Array.isArray(j.vivierIds) && !surStocke && L.choixStockes.length >= 2 && j.resultat === 'succes') {
            const ids = L.choixStockes;
            const corpsQ = { success: true, carte: { idProduct: ids[0], ambigu: true, numero: j.numero, total: j.total, setCode: j.setCode, tcgdexId: j.carteTcgdexId, langue: j.langue, nom: j.nom, nomBrut: j.nomBrut, nomConfiance: j.nomConfiance }, ...enTete, candidats: ids.map(idProduct => ({ idProduct })), lectureGarde: { ...luBloc, vivierIds: j.vivierIds } };
            const jum0q = await J.fournisseurParDefaut(cat, V, J.idsAffirmes(corpsQ));
            const produits0q = await cat.lire([...ids, ...J.idsACharger(corpsQ, jum0q), ...GC.idsDeLaGarde(corpsQ)]);
            const prq = await preparer({ corpsListe: [corpsQ], produits: produits0q, jumeaux: jum0q, catalogue: cat, version: V, designation: TOUTES });
            L.q = { corps: corpsQ, produits: prq.produits, jum: prq.jumeaux, codeNumeroExiste: prq.codeNumeroExiste };
            continue;
        }
        if (W === null || !Array.isArray(j.vivierIds)) continue;
        const corps = { success: true, carte: { idProduct: W, ambigu: !chainAffirmee, numero: j.numero, total: j.total, setCode: j.setCode, tcgdexId: j.carteTcgdexId, langue: j.langue, nom: j.nom, nomBrut: j.nomBrut, nomConfiance: j.nomConfiance }, ...enTete, candidats: [{ idProduct: W }], lectureGarde: { ...luBloc, vivierIds: j.vivierIds } };
        const jum0 = await J.fournisseurParDefaut(cat, V, J.idsAffirmes(corps));
        const produits0 = await cat.lire([W, ...J.idsACharger(corps, jum0), ...GC.idsDeLaGarde(corps)]);
        const pr2 = await preparer({ corpsListe: [corps], produits: produits0, jumeaux: jum0, catalogue: cat, version: V, designation: TOUTES });
        Object.assign(L, { evaluable: true, W, corps, jum2: pr2.jumeaux, produits2: pr2.produits, codeNumeroExiste2: pr2.codeNumeroExiste });
    }
    const classeDe = async (L, Xp) => {
        if (L.s && Xp === L.idStocke && L.classeStockee) return L.classeStockee;
        if (!Number.isInteger(L.verite)) return L.s && Xp === L.idStocke ? L.classeStockee : 'non-etiquete';
        if (Xp === L.verite) return 'juste';
        return memeCreneau(await ligneDe(Xp), await ligneDe(L.verite)) ? 'variante' : 'faux';
    };
    const ctxRoute = (produits, jumeaux, cne) => ({ produits, langueInterface: 'fr', cfg: cfg0, ficheServie: false, jumeaux, critereA: true, langueDeci: undefined, langueDecisive: { ...LD.REGLES }, codeNumeroExiste: cne, designation: {} });
    const issueDe = r => ({ issue: r.issue, critere: r.critere || null, id: r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null, choix: r.issue === 'question' ? r.analyse.cartes[0].candidats.map(x => x.idProduct) : [] });
    const marqueursDeCtx = ctx => id => (ctx.produits.has(id) ? construireProduit(ctx.produits.get(id), { langueInterface: 'fr', cfg: cfg0 }).marqueurs : undefined);
    const livres = [];
    for (const L of lignes) {
        let ctx = null, corps = null;
        if (L.evaluable) { ctx = ctxRoute(L.produits2, L.jum2, L.codeNumeroExiste2); corps = L.corps; }
        else if (L.q) { ctx = ctxRoute(L.q.produits, L.q.jum, L.q.codeNumeroExiste); corps = L.q.corps; }
        livres.push({ L, ctx, corps, r: ctx ? muet(() => adapter({ statutHttp: 200, corps }, ctx)) : null });
    }
    const VARIANTES = { 'garde des groupes + jumbo par le titre ALLUMÉS (état d\'aujourd\'hui)': { jumboTitre: true, gardeMarqueurs: true }, 'marqueurs éteints (état livré d\'avant)': { jumboTitre: false, gardeMarqueurs: false } };
    const FAMS = ['reglage', 'tamponnee', 'ordinaire'];
    const sortie = {}, detail = {}; let THETA = null;
    // TOUR 1 : le COSINUS MINIMAL du 1er candidat. Passe 1 et 2 : seuil 0 (garde éteinte), on garde le DÉTAIL de chaque probable. Le seuil est CHOISI sur le RÉGLAGE seul (le plus petit qui retire tous les faux du réglage ayant un cosinus),
    // puis la passe « __garde » rejoue la FONCTION DE PRODUCTION avec `probableCosinusMin` = ce seuil, appliqué aux ordinaires et aux tamponnées sans le réajuster.
    const FAMX = ['reglage', 'tamponnee', 'ordinaire'];
    // TOUR 2 : la garde COMBINÉE. (a) un probable exige un cosinus mesuré ; (b) la même chose ET θ. On retient la plus PETITE garde qui donne 0 probable faux sur le RÉGLAGE, appliquée telle quelle aux autres familles.
    function combinee(probables, cpt) {
        const cos = x => typeof x.cosPremier === 'number', pf = (f, p) => probables.filter(x => x.fam === f && p(x));
        const gardes = [{ nom: '(a) vecteur exigé', th: 0, exige: true }, ...[0.3, 0.35, 0.38, 0.4, 0.45].map(th => ({ nom: `(b) vecteur exigé + θ=${th.toFixed(2)}`, th, exige: true }))];
        const retire = (g, x) => (g.exige && !cos(x)) || (g.th > 0 && cos(x) && x.cosPremier < g.th);
        console.log('\nGARDE COMBINÉE (par famille : probables JUSTES perdus / FAUX évités ; faux restants) et réponse directe juste aux ordinaires :');
        let retenue = null;
        for (const g of gardes) {
            const par = FAMX.map(f => `${f} -${pf(f, x => x.juste && retire(g, x)).length}j/+${pf(f, x => !x.juste && retire(g, x)).length}f (reste ${pf(f, x => !x.juste && !retire(g, x)).length}f)`).join(' · ');
            const restantsOrd = pf('ordinaire', x => x.juste && !retire(g, x)).length, directe = cpt.ordinaire.surJuste + restantsOrd;
            console.log(`  ${g.nom.padEnd(28)} ${par} · ORDINAIRES directe ${directe}/${cpt.ordinaire.denom} = ${pct(directe, cpt.ordinaire.denom)}`);
            if (retenue === null && pf('reglage', x => !x.juste && !retire(g, x)).length === 0) retenue = g;
        }
        if (!retenue) { console.log('  AUCUNE garde ne donne 0 faux sur le réglage'); return null; }
        console.log(`  GARDE RETENUE SUR LE RÉGLAGE SEUL : ${retenue.nom} ; faux restants (sans réajustement) : ${JSON.stringify(FAMX.map(f => [f, pf(f, x => !x.juste && !retire(retenue, x)).length]))}`);
        return retenue;
    }
    function courbe(probables) {
        const pf = (f, p) => probables.filter(x => x.fam === f && p(x)), cos = x => typeof x.cosPremier === 'number';
        console.log('\nCOURBE du cosinus minimal du 1er candidat (par famille : probables JUSTES perdus / FAUX évités ; sans cosinus la garde se tait) :');
        for (const th of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) console.log(`  θ=${th.toFixed(2)} ` + FAMX.map(f => `${f} -${pf(f, x => x.juste && cos(x) && x.cosPremier < th).length}j/+${pf(f, x => !x.juste && cos(x) && x.cosPremier < th).length}f`).join(' · '));
        for (const f of FAMX) console.log(`  ${f}: probables ${pf(f, () => true).length} (justes ${pf(f, x => x.juste).length}, faux ${pf(f, x => !x.juste).length}) ; sans cosinus : justes ${pf(f, x => x.juste && !cos(x)).length}, faux ${pf(f, x => !x.juste && !cos(x)).length} ; cosPremier des faux : ${JSON.stringify(pf(f, x => !x.juste).map(x => x.cosPremier === null || x.cosPremier === undefined ? null : +x.cosPremier.toFixed(3)))} ; min des justes ${(() => { const v = pf(f, x => x.juste && cos(x)).map(x => x.cosPremier); return v.length ? Math.min(...v).toFixed(3) : 'n/a'; })()}`);
        const fauxReg = pf('reglage', x => !x.juste && cos(x)), fauxRegSans = pf('reglage', x => !x.juste && !cos(x)).length;
        if (!fauxReg.length) return null;
        const th = Math.floor(Math.max(...fauxReg.map(x => x.cosPremier)) * 100) / 100 + 0.01;
        console.log(`  SEUIL CHOISI SUR LE RÉGLAGE SEUL : ${th.toFixed(2)} (le plus petit à 0,01 près qui retire tous les ${fauxReg.length} faux du réglage ayant un cosinus ; ${fauxRegSans} faux du réglage sans cosinus restent hors de portée)`);
        console.log('  appliqué tel quel : ' + FAMX.map(f => `${f} -${pf(f, x => x.juste && cos(x) && x.cosPremier < th).length} justes perdus / +${pf(f, x => !x.juste && cos(x) && x.cosPremier < th).length} faux évités (faux restants ${pf(f, x => !x.juste && !(cos(x) && x.cosPremier < th)).length})`).join(' · '));
        // gardes 2 à 4 de la relecture, À TITRE INDICATIF (rien de codé)
        const ecart = x => (cos(x) && typeof x.cosSecond === 'number' ? x.cosPremier - x.cosSecond : null);
        const gMin = Math.min(...pf('reglage', x => x.juste && ecart(x) !== null).map(ecart));
        const g = { [`2. écart cosinus 1er-2e >= ${gMin.toFixed(3)} (le plus petit écart d'un juste du réglage)`]: x => ecart(x) !== null && ecart(x) < gMin, '3. au moins 2 champs concordants': x => x.ok < 2, '4. au plus 2 candidats': x => x.nCand > 2 };
        for (const [nomG, retire] of Object.entries(g)) console.log(`  garde ${nomG} : ` + FAMX.map(f => `${f} -${pf(f, x => x.juste && retire(x)).length}j/+${pf(f, x => !x.juste && retire(x)).length}f`).join(' · '));
        return th;
    }
    // G-GROUPE → PROBABLE sur une question que PROBABLE n'a pas désignée : le complément que le client recevrait (fournisseur sans ORB, ensemble fermé + zones du groupe), les mesures calculées par les fonctions de
    // pixels de production, G d'abord (s'il affirme, la question devient un sûr : hors de ce lot), la tête de g-groupe.js, puis les gardes de PROBABLE. Rend { raison } ou { tete, designe }.
    async function teteDeGroupe(L, res, et, trace, corps, ctx) {
        const { VE, CR, Z, MC, GG, PRO, cache } = GGX;
        const scanId = L.cle.split(':')[0], p = nav[scanId], jpg = path.join(CARTES, scanId + '.jpg');
        if (!(p && p.redressee === true && Array.isArray(p.emb))) return { raison: 'photo-non-redressee' };
        if (!fs.existsSync(jpg)) return { raison: 'sans-carte' };
        const carteB64 = fs.readFileSync(jpg).toString('base64');
        const envReq = { empreintes: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: carteB64 }], modeleEmpreinte: MODELE };
        const v = await GGX.fournisseur({ entree: { imageUrls: ['x'], empreintes: VE.lireEnveloppe(envReq, 1) }, scanId });
        if (v.ok) return { raison: 'g-tranche-sans-mesure' };
        if (!v.attente) return { raison: `silence-${v.code}` };
        const { ligne, ctx: ctxG } = v.attente;
        const groupe = GG.groupeDeLaQuestion(et.choix, GG.cleDeLaVersion(V));
        const ens = MC.ensembleFerme(ctxG, ligne);
        const base = ens ? ens.mesures : [];
        const ajout = groupe ? GG.demandeDuGroupe({ groupe, deja: base, max: MC.MESURES_MAX }) : null;
        if (!ajout) return { raison: 'groupe-non-demandable' };
        const demande = [...base, ...ajout], resultats = [];
        let photo = null;
        try {
            for (const m of demande) {
                const k = m.type === 'paire' ? `${scanId}|p|${m.a}|${m.b}` : `${scanId}|z|${m.ref}`;
                if (!(k in cache)) {
                    const sa = GGX.lireScan(m.type === 'paire' ? m.a : m.ref), sb = m.type === 'paire' ? GGX.lireScan(m.b) : null;
                    if (!sa || (m.type === 'paire' && !sb)) { cache[k] = null; }
                    else {
                        if (!photo) { const cr = await CR.valider(carteB64); photo = await Z.photoGrise(cr.data, cr.width, cr.height); }
                        if (m.type === 'paire') { const [ecart, couverture] = await Z.comparerPaire(photo, { cle: m.a, octets: sa }, { cle: m.b, octets: sb }); cache[k] = { type: 'paire', a: m.a, b: m.b, ecart, couverture }; }
                        else { const z = await Z.scoresZones(photo, { cle: m.ref, octets: sa }); cache[k] = { type: 'zones', ref: m.ref, haut: z.haut, illustration: z.illustration, bandeau: z.bandeau, texte: z.texte, bas: z.bas, inliers: z.inliers }; }
                        GGX.calculees++;
                    }
                }
                resultats.push(cache[k]);
            }
        } finally { if (photo) { try { photo.delete(); } catch { /* libérée */ } } }
        if (resultats.some(r => !r)) return { raison: 'mesure-absente' };
        if (base.length) { const dec = MC.deciderAvecResultats(ctxG, ligne, base, resultats.slice(0, base.length)); if (dec.ok && dec.decision && dec.decision.affirme === true) return { raison: 'g-promeut', produit: dec.decision.produit }; }
        const zones = k => resultats.find(r => r.type === 'zones' && r.ref === k) || null;
        const og = GG.ordonnerGroupe({ groupe, zones, ecartMin: ECART });
        if (!og.change) return { raison: `pas-de-tete:${og.motif}` };
        const entree = { versionExtension: '2.0.1', empreintes: { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: null }] } };
        const cosDe = PRO.cosinusDesCandidats({ cfg, entree, ids: et.choix, version: V, etat });
        const cand = res.analyse.cartes[0].candidats.find(x => x && x.idProduct === og.tete);
        const d = PRO.designerTeteDeGroupe({ cfg: { ...cfg, gGroupe: true }, versionExtension: '2.0.1', tete: og.tete, ids: et.choix, version: V, groupeMarqueurs: PRO.estGroupe(trace), cosinus: cosDe ? cosDe(og.tete) : null, prixGuide: cand ? cand.prixGuide : null, garde: rq('v2/identifier/promotion-g').evaluerGarde({ corps, gagnant: og.tete, produits: ctx.produits }) });
        return Number.isInteger(d.idProduct) ? { tete: og.tete, designe: true, ecart: og.ecart } : { raison: `refus:${d.refus}`, tete: og.tete };
    }
    const raisonsG = {}, tetesG = [], raisonParCle = {};
    for (const [nom0, drapeaux0] of [...Object.entries(VARIANTES), ['__garde', null]]) {
        let nom = nom0, drapeaux = drapeaux0;
        if (nom0 === '__garde') { if (THETA === null) break; const premier = Object.keys(VARIANTES)[0]; drapeaux = VARIANTES[premier]; nom = `${premier} + GARDE RETENUE ${THETA.nom} (fonction de production : probableCosinusMin ${THETA.th}, probableVecteurExige ${THETA.exige})`; cfg.probableCosinusMin = THETA.th; cfg.probableVecteurExige = THETA.exige; } else { cfg.probableCosinusMin = 0; cfg.probableVecteurExige = false; }
        const compte = Object.fromEntries(FAMS.map(f => [f, { denom: 0, surJuste: 0, surVariante: 0, surFaux: 0, surAutre: 0, probJuste: 0, probFaux: 0, probFauxHors: 0, questions: 0, questionsAvec: 0, question1: 0, introuvables: 0, probInconnu: 0, gJuste: 0, gFaux: 0, gFauxHors: 0, gInconnu: 0, gPromeut: 0 }]));
        const probFaux = [], probables = [], changes = [], raisons = {}, surs = []; let tracees = 0;
        for (const { L, ctx, corps, r } of livres) {
            if (L.banc === 'hors-banc') continue;
            let res = r, trace = null;
            if (r) {
                const gm = muet(() => GM.consulterMarqueurs({ cfg: drapeaux, titre: L.titre, resultat: r, derniereQuestion: null, corpsChaine: corps, produits: ctx.produits, version: V,
                    affirmer: (id, sur, crit) => affirmerParLaRoute(corps, id, { ...ctx, produits: sur || ctx.produits }, crit), marqueursDe: marqueursDeCtx(ctx),
                    questionDeGroupe: ids => questionDeGroupe(corps, ids, ctx), journal: () => { } }));
                if (gm) { trace = gm.trace; if (gm.resultat) { res = gm.resultat; changes.push(L.cle); } if (gm.trace) tracees++; }
            }
            let et;
            if (!res) et = L.surStocke ? { type: 'sur', id: L.idStocke, classe: L.classeStockee } : L.choixStockes.length ? { type: 'question', choix: L.choixStockes, stocke: true } : { type: 'ne-sait-pas' };
            else { const x = issueDe(res); et = x.issue === 'affirmee' ? { type: 'sur', id: x.id, classe: await classeDe(L, x.id) } : x.issue === 'question' && x.choix.length ? { type: 'question', choix: x.choix } : { type: 'ne-sait-pas' }; }
            const avec = Number.isInteger(L.verite) || (et.type === 'sur' && ['juste', 'faux', 'variante'].includes(et.classe));
            if (!avec) continue;
            const m = compte[L.banc === 'reglage' ? 'reglage' : L.famille]; m.denom++;
            if (et.type === 'sur') { surs.push([L.cle, et.id, et.classe]); if (et.classe === 'juste') m.surJuste++; else if (et.classe === 'variante') m.surVariante++; else if (et.classe === 'faux') m.surFaux++; else m.surAutre++; continue; }
            if (et.type !== 'question') { m.introuvables++; continue; }
            if (et.choix.length < 2) { m.question1++; continue; }
            // PROBABLE : la fonction de la route, avec l'index, l'archive et le vecteur de la photo (redressée seulement)
            let pr = null;
            if (res && !et.stocke && consulterProbable) {
                const p = nav[L.cle.split(':')[0]];
                const entree = { versionExtension: '2.0.1', empreintes: p && p.redressee === true && Array.isArray(p.emb) ? { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: null }] } : null };
                const diag = {};
                pr = muet(() => consulterProbable({ cfg, entree, resultat: res, corpsChaine: corps, produits: ctx.produits, version: V, traceMarqueurs: trace, etat, diag }));
                raisons[diag.raison || 'aucune'] = (raisons[diag.raison || 'aucune'] || 0) + 1;
            }
            m.questions++;
            if (et.choix.includes(L.verite)) m.questionsAvec++;
            if (pr) {
                probables.push({ cle: L.cle, fam: L.banc === 'reglage' ? 'reglage' : L.famille, verite: L.verite, probable: pr.idProduct, juste: pr.idProduct === L.verite, horsCandidats: Number.isInteger(L.verite) && !et.choix.includes(L.verite), ...pr.detail });
                if (!Number.isInteger(L.verite)) m.probInconnu++;
                else if (pr.idProduct === L.verite) m.probJuste++;
                else { m.probFaux++; if (!et.choix.includes(L.verite)) m.probFauxHors++; probFaux.push({ cle: L.cle, fam: L.famille, verite: L.verite, probable: pr.idProduct, choix: et.choix, groupe: !!(trace && trace.garde) }); }
            } else if (GGX && nom0 === '__garde' && res && !et.stocke) {
                // G-GROUPE : la tête du groupe, SEULEMENT sur une question que PROBABLE n'a pas désignée
                let g; try { g = await teteDeGroupe(L, res, et, trace, corps, ctx); } catch (e) { g = { raison: `exception:${String(e && (e.code || e.name))}` }; }
                const kr = g.designe ? 'DESIGNE' : g.raison; raisonsG[kr] = (raisonsG[kr] || 0) + 1; raisonParCle[L.cle] = kr;
                if (g.designe) {
                    const famille = L.banc === 'reglage' ? 'reglage' : L.famille;
                    tetesG.push({ cle: L.cle, fam: famille, verite: L.verite, tete: g.tete, ecart: g.ecart, juste: g.tete === L.verite, horsCandidats: Number.isInteger(L.verite) && !et.choix.includes(L.verite) });
                    if (!Number.isInteger(L.verite)) m.gInconnu++;
                    else if (g.tete === L.verite) m.gJuste++;
                    else { m.gFaux++; if (!et.choix.includes(L.verite)) m.gFauxHors++; }
                } else if (g.raison === 'g-promeut') m.gPromeut++;
            }
        }
        sortie[nom] = compte; detail[nom] = { probFaux, probables, surs };
        console.log(`  (${nom}) d'où vient le cosinus, par QUESTION jugée : ${JSON.stringify(raisons)}`);
        if (nom0 === Object.keys(VARIANTES)[0] && consulterProbable) { courbe(probables); THETA = combinee(probables, compte); }
        console.log(`\n## ${nom} — cartes dont les marqueurs ont changé le résultat : ${changes.length} ; cartes où la fonction a laissé une trace : ${tracees}`);
        const tot = { denom: 0 };
        for (const f of [...FAMS, 'controle']) {
            const x = f === 'controle' ? Object.fromEntries(Object.keys(compte.ordinaire).map(k => [k, compte.tamponnee[k] + compte.ordinaire[k]])) : compte[f];
            const direct = x.surJuste + x.probJuste, plafond = x.surJuste + x.surVariante + x.questionsAvec + x.question1;
            console.log(`  ${f.padEnd(10)} (${x.denom} à vérité) : sûrs justes ${x.surJuste} (+ variantes ${x.surVariante}, FAUX ${x.surFaux}) · probables justes ${x.probJuste} · probables FAUX ${x.probFaux} (dont vérité hors candidats ${x.probFauxHors}) · questions ≥ 2 choix ${x.questions} (vérité dedans ${x.questionsAvec}) → non probables ${x.questions - x.probJuste - x.probFaux - x.probInconnu} · 1 candidat ${x.question1} · introuvables ${x.introuvables}`);
            console.log(`${' '.repeat(14)}RÉPONSE DIRECTE JUSTE = ${direct}/${x.denom} = ${pct(direct, x.denom)} (avec variantes ${pct(direct + x.surVariante, x.denom)}) ; sûrs seuls ${pct(x.surJuste, x.denom)} ; plafond (sûrs + vérité dedans) ${pct(plafond, x.denom)} ; cible 85 % = ${Math.ceil(0.85 * x.denom)} → ${direct - Math.ceil(0.85 * x.denom) >= 0 ? '+' : ''}${direct - Math.ceil(0.85 * x.denom)}`);
        }
        if (probFaux.length) console.log('  probables FAUX :', JSON.stringify(probFaux));
        if (GGX && nom0 === '__garde') {
            console.log(`\n== G-GROUPE → PROBABLE (écart ${ECART}, V2_PROBABLE ET V2_G_GROUPE, gardes de production) — mesures calculées dans cette passe : ${GGX.calculees}`);
            for (const f of [...FAMS, 'controle']) {
                const x = f === 'controle' ? Object.fromEntries(Object.keys(compte.ordinaire).map(k => [k, compte.tamponnee[k] + compte.ordinaire[k]])) : compte[f];
                const direct0 = x.surJuste + x.probJuste, direct1 = direct0 + x.gJuste;
                console.log(`  ${f.padEnd(10)} (${x.denom} à vérité) : sûrs justes ${x.surJuste} · probables justes PROBABLE seul ${x.probJuste} · probables FAUX PROBABLE seul ${x.probFaux} || AVEC G-GROUPE : probables justes ajoutés ${x.gJuste} · probables FAUX ajoutés ${x.gFaux} (dont vérité hors candidats ${x.gFauxHors}) · sans vérité ${x.gInconnu} · (G promeut ${x.gPromeut}) → probables justes ${x.probJuste + x.gJuste}, FAUX ${x.probFaux + x.gFaux} ; réponse directe juste ${direct0}/${x.denom} = ${pct(direct0, x.denom)} → ${direct1}/${x.denom} = ${pct(direct1, x.denom)}`);
            }
            console.log('  pourquoi pas de tête (par question jugée, hors PROBABLE) :', JSON.stringify(raisonsG));
            console.log('  têtes désignées :', JSON.stringify(tetesG));
            console.log('  FAUX par G-GROUPE :', JSON.stringify(tetesG.filter(t => !t.juste && Number.isInteger(t.verite))));
            detail.__gGroupe = { ecart: ECART, tetes: tetesG, raisons: raisonsG, raisonParCle };
            try { fs.mkdirSync(path.dirname(CACHE_F), { recursive: true }); fs.writeFileSync(CACHE_F, JSON.stringify(GGX.cache)); } catch { /* cache facultatif */ }
        }
    }
    fs.writeFileSync(process.argv[2] || path.join(__dirname, 'resultats-probable', 'production.json'), JSON.stringify({ le: new Date().toISOString(), code: RACINE, archive: path.basename(ARCHIVE), index: path.basename(INDEX), compte: sortie, detail }, null, 1));
    await c.close();
})().catch(e => { console.log('ERREUR', e.code || e.name, String(e.message || '').slice(0, 300), String(e.stack || '').split('\n').slice(1, 4).join(' | ')); process.exit(1); });

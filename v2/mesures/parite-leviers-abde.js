'use strict';
// LEVIERS-ABDE (ordre n°17) — TEST DE PARITÉ : la route, drapeau allumé, rejouée HORS LIGNE sur les lignes des trois bancs et de la série, doit rendre les MÊMES issues que la copie du simulateur (scratchpad combi-bloc.js, a+b+d+e, c3,
// s = 0,1, pool trié par c3 : `decisions-simulateur.json`, une décision par ligne non sûre à vérité). LECTURE SEULE (base d'essai lue par MONGODB_ESSAI_LECTURE_URI, jamais imprimée), 0 $, aucun réseau, aucune écriture.
// Ce qui est rejoué est CE QUE LA ROUTE FAIT : l'adaptateur (levier e allumé), la garde des groupes et le jumbo par le titre (garde-marqueurs.js), puis l'ÉTAPE de la route (leviers-abde.js::appliquerLeviers) avec le catalogue réel,
// l'index d'empreintes, l'archive et le vecteur de la photo. Même chaîne que mesures/mesurer-probable-production.js.
// Ce que le banc ne rejoue pas, comme le simulateur : la règle G, SUR-PAR-IMAGE, la lecture du tampon (éteintes dans l'état livré) ; le jumbo par le titre n'a aucune annonce en base (0 titre).
//
// Trois sorties, et le banc échoue (code 1) sur l'une d'elles :
//   (1) UN SÛR NE CHANGE JAMAIS : pour chaque ligne, la route drapeau ÉTEINT et drapeau ALLUMÉ rendent le même sûr (même idProduct), et le drapeau n'en fabrique aucun ;
//   (2) la parité des issues avec le simulateur, ligne à ligne ; chaque écart est ATTRIBUÉ à une cause nommée, par contre-épreuve (la décision d'avant les gardes de la route est comparée à celle du simulateur) ;
//   (3) AUCUN écart non expliqué.
// Usage : node v2/mesures/parite-leviers-abde.js --simulateur=<decisions-simulateur.json> [--archive=candidate-2026-10-31b.rmv] [--sortie=<json>]
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..'), TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
require(path.join(TRAVAIL, 'atlas', 'garde-secrets'));
const { ouvrir } = require(path.join(TRAVAIL, 'mesure-banc-reel', 'lib'));
const rq = m => require(path.join(RACINE, ...m.split('/')));
const { preparer } = rq('v2/identifier/langue-decisive-charge');
const { adapter, affirmerParLaRoute, questionDeGroupe } = rq('v2/identifier/adaptateur');
const J = rq('v2/identifier/jumeaux'), LD = rq('v2/identifier/langue-decisive'), DES = rq('v2/identifier/designation'), GC = rq('v2/identifier/garde-contradiction');
const { construireProduit } = rq('v2/identifier/produit'), GM = rq('v2/identifier/garde-marqueurs');
const LV = rq('v2/identifier/leviers-abde');
const { creerCatalogue } = rq('v2/identifier/catalogue'), { lireConfig } = rq('v2/config'), dbV2 = rq('v2/db');
const S = rq('v2/chargeur/scellement'), F = rq('v2/chargeur/format'), X = rq('v2/identifier/index-empreintes'), EV = rq('v2/identifier/empreinte-vecteur');
const argv = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
if (!argv('simulateur')) { console.log('usage : --simulateur=<decisions-simulateur.json>'); process.exit(2); }
const ARCHIVE = path.join(TRAVAIL, 'archives', argv('archive') || 'candidate-2026-10-31b.rmv');
const NAV = path.join(TRAVAIL, 'index-empreintes-essai', 'donnees-nav', 'nav-bancs.json');
const INDEX = path.join(TRAVAIL, 'index-empreintes-essai', 'sortie', 'index-empreintes-2026-10-24.rmei');
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const NOMS = Object.keys(DES.REGLES_DESIGNATION), TOUTES = Object.fromEntries(NOMS.map(k => [k, true]));
const DRAPEAUX_MARQUEURS = { jumboTitre: true, gardeMarqueurs: true };

let RESULTAT_COUT = null;
(async () => {
    const SIM = new Map(JSON.parse(fs.readFileSync(argv('simulateur'), 'utf8')).map(x => [x.cle, x]));
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(ARCHIVE), process.env.V2_VISUELS_HMAC)));
    const o = X.ouvrir(fs.readFileSync(INDEX), process.env.V2_VISUELS_HMAC, { modeleAttendu: MODELE }), idx = o.index;
    const etat = { courante: () => ({ index: idx, meta: { modele: MODELE } }) };
    const nav = JSON.parse(fs.readFileSync(NAV, 'utf8')).photos;
    const { c, db } = await ouvrir();
    dbV2.brancher(db);
    const cfg0 = lireConfig({});
    const cfgOff = { ...cfg0, probable: true, empreinteExtension: true, modeleEmpreinte: MODELE };
    const cfgOn = { ...cfgOff, leviersAbde: true, leviersEcart: 0.1 };
    const cat = creerCatalogue({ cfg: cfg0, visuels: { entree: id => V.entree(id), tirage: id => V.tirageJumeaux(id), resoudre: async () => null, impressions: async () => [] } });
    await cat.indexCodeNumero(); await cat.indexFamilles();
    const t0 = Date.now(); const alias = await cat.indexAliasFr(); const stats = cat.statsIndexAlias(); console.log(`index d'alias : ${alias.size} noms en ${Date.now() - t0} ms`);
    const A = await db.collection('analyses').find({}).toArray();
    const JN = new Map((await db.collection('journal_scans').find({}).toArray()).map(j => [String(j._id), j]));
    const Aid = new Set(A.map(a => String(a._id)));
    const orph = [...JN.values()].filter(j => !Aid.has(String(j._id)));
    const jDe = a => { const j = JN.get(String(a._id)); if (j) return j; const t = a.creeLe.getTime(); const cand = orph.filter(o2 => Math.abs(new Date(o2.le).getTime() - t) <= 10000); return cand.length === 1 ? cand[0] : null; };
    const empruntDe = id => { try { return typeof V.empruntDe === 'function' && V.empruntDe(id) === true; } catch { return false; } };
    // la version SANS la protection des empruntés : la contre-épreuve de la cause « exclusion des empruntés »
    const versionSansEmprunt = { entree: id => { const e = V.entree(id); return e ? { ...e, mention: null } : e; }, identifiants: () => V.identifiants() };
    const lignesCache = new Map();
    const ctxRoute = (produits, jumeaux, cne, cfg) => ({ produits, langueInterface: 'fr', cfg, ficheServie: false, jumeaux, critereA: true, langueDeci: undefined, langueDecisive: { ...LD.REGLES }, codeNumeroExiste: cne, designation: {} });
    const marqueursDeCtx = ctx => id => (ctx.produits.has(id) ? construireProduit(ctx.produits.get(id), { langueInterface: 'fr', cfg: cfg0 }).marqueurs : undefined);
    const issueDe = r => r ? { issue: r.issue, id: r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null, choix: r.issue === 'question' ? r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b) : [] } : { issue: 'aucune', id: null, choix: [] };
    const entreeDe = cleScan => { const p = nav[cleScan]; return { versionExtension: '2.0.1', empreintes: p && p.redressee === true && Array.isArray(p.emb) ? { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: null }] } : null }; };

    // ── la route, rejouée une fois par configuration (éteinte, allumée) sur chaque carte dont la chaîne a un journal
    const sorties = [];
    const COUT = [];                                                    // un relevé par appel de l'étape : temps mur (base d'essai comprise) et CPU
    let nLignes = 0, nSansJournal = 0;
    for (const a of A) for (const [i] of a.cartes.entries()) {
        const cle = `${String(a._id)}:${i}`, j = jDe(a);
        const sim = SIM.get(cle) || null;
        nLignes++;
        if (!j || !Array.isArray(j.vivierIds)) { nSansJournal++; continue; }
        const chainAffirmee = j.resultat === 'succes' && j.carteIncertaine === false && Number.isInteger(j.idProduct);
        const unique = j.resultat === 'succes' && j.carteIncertaine === true && Array.isArray(j.candidatsRendus) && j.candidatsRendus.length === 1;
        const W = chainAffirmee ? j.idProduct : unique ? j.candidatsRendus[0] : null;
        const k = a.cartes[i];
        const stockes = Array.isArray(k.question && k.question.choix) ? k.question.choix.map(x => (x && typeof x === 'object') ? x.idProduct : x).filter(Number.isInteger) : [];
        const luBloc = { numero: j.numero, total: j.total, setCode: j.setCode, symboleSet: j.symboleSet, attaque: j.attaqueLue, attaqueConfiance: j.attaqueConfiance, carteTcgdexId: j.carteTcgdexId, langue: j.langue, totalHorsTailleDeSet: j.totalHorsTailleDeSet === true };
        const enTete = { etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' }, classement: [], codeLangue: 1 };
        let corps;
        if (W !== null) corps = { success: true, carte: { idProduct: W, ambigu: !chainAffirmee, numero: j.numero, total: j.total, setCode: j.setCode, tcgdexId: j.carteTcgdexId, langue: j.langue, nom: j.nom, nomBrut: j.nomBrut, nomConfiance: j.nomConfiance }, ...enTete, candidats: [{ idProduct: W }], lectureGarde: { ...luBloc, vivierIds: j.vivierIds } };
        else if (k.statut !== 'identifiee' && stockes.length >= 2 && j.resultat === 'succes') corps = { success: true, carte: { idProduct: stockes[0], ambigu: true, numero: j.numero, total: j.total, setCode: j.setCode, tcgdexId: j.carteTcgdexId, langue: j.langue, nom: j.nom, nomBrut: j.nomBrut, nomConfiance: j.nomConfiance }, ...enTete, candidats: stockes.map(idProduct => ({ idProduct })), lectureGarde: { ...luBloc, vivierIds: j.vivierIds } };
        else continue;
        const ids0 = W !== null ? [W] : stockes;
        const jum0 = await J.fournisseurParDefaut(cat, V, J.idsAffirmes(corps));
        const produits0 = await cat.lire([...ids0, ...J.idsACharger(corps, jum0), ...GC.idsDeLaGarde(corps)]);
        const pr = await preparer({ corpsListe: [corps], produits: produits0, jumeaux: jum0, catalogue: cat, version: V, designation: TOUTES });
        const run = async (cfg, avecLeviers) => {
            const ctx = ctxRoute(pr.produits, pr.jumeaux, pr.codeNumeroExiste, cfg);
            // la route pose `leviersE` seulement sous V2_LEVIERS_ABDE ET le niveau probable servi (routes.js) ; les marqueurs passent par la MÊME fonction que la route (appliquerMarqueurs)
            const ctxE = avecLeviers ? { ...ctx, leviersE: true } : ctx;
            let res = muet(() => adapter({ statutHttp: 200, corps }, ctxE)), trace = null;
            const gm = muet(() => GM.appliquerMarqueurs({ cfg: DRAPEAUX_MARQUEURS, titre: null, resultat: res, derniereQuestion: null, c: corps, desaccordG: null, empreinteInfo: null, produits: ctx.produits, version: V, langueInterface: 'fr', jumeaux: ctx.jumeaux, lot: false, journal: () => { } }));
            if (gm) { trace = gm.trace; if (gm.resultat) res = gm.resultat; }
            const avant = issueDe(res), resAvant = res;                 // resAvant : la question de la chaîne AVANT l'étape (la contre-épreuve repart d'elle, jamais de la question déjà refaite)
            let lv = null; const diag = {};
            if (avecLeviers && res.issue === 'question') {
                const t0 = process.hrtime.bigint(), c0 = process.cpuUsage();
                lv = await muet(() => LV.appliquerLeviers({ cfg, entree: entreeDe(cle.split(':')[0]), resultat: res, corpsChaine: corps, produits: ctx.produits, version: V, traceMarqueurs: trace, catalogue: cat, ctxQuestion: { langueInterface: 'fr', cfg, ficheServie: false, jumeaux: ctx.jumeaux }, etat, diag }));
                const c1 = process.cpuUsage(c0);
                COUT.push({ ms: Number(process.hrtime.bigint() - t0) / 1e6, cpuMs: (c1.user + c1.system) / 1000 });
                if (lv && lv.resultat) res = lv.resultat;
            }
            return { res, resAvant, avant, apres: issueDe(res), probable: lv ? lv.probable : null, diag, lv, trace, ctx };
        };
        const off = await run(cfgOff, false), on = await run(cfgOn, true);
        sorties.push({ cle, sim, off, on, corps, produits: pr.produits, jumeaux: pr.jumeaux, cne: pr.codeNumeroExiste });
    }
    console.log(`cartes parcourues ${nLignes} · sans journal ${nSansJournal} · rejouées ${sorties.length} · décisions du simulateur ${SIM.size}`);

    // ═════ (0c) ÉCART AVEC L'ANCIEN SIMULATEUR (--ancien=<decisions-simulateur.json d'avant le tour 1>) : pour chaque probable de l'ancien simulateur que la route NE sert PLUS, la cause. Le but : ne plus régler sur un chiffre que la route ne rend pas.
    if (argv('ancien')) {
        const ANC = JSON.parse(fs.readFileSync(argv('ancien'), 'utf8')), parCause = {};
        const route = new Map(sorties.map(s => [s.cle, s]));
        let total = 0, justes = 0;
        for (const x of ANC) {
            if (x.C3.kind !== 'prob') continue;
            const s = route.get(x.cle), juste = x.C3.id === x.verite;
            const sert = s && s.on.probable && s.on.probable.idProduct === x.C3.id;
            if (sert) continue;
            let cause;
            if (!s) cause = 'ligne non rejouée (question lue du journal)';
            else if (s.on.probable) cause = 'la route désigne un AUTRE produit';
            else if (s.on.resAvant && s.on.resAvant.issue !== 'question') { const b = s.on.resAvant; cause = `la chaîne rend ${b.issue}${b.motif ? ' ' + b.motif : ''}${b.erreur && b.erreur.code ? ' ' + b.erreur.code : ''} (la route ne désigne jamais sur autre chose qu'une question)`; }
            else cause = `garde de la route : ${s.on.diag.raison || 'inconnue'}`;
            const k = parCause[cause] = parCause[cause] || { justes: 0, faux: 0 };
            if (juste) { k.justes++; justes++; } else k.faux++;
            total++;
        }
        console.log(`(0c) ÉCART AVEC L'ANCIEN SIMULATEUR : ${total} probables de l'ancien simulateur ne sont plus servis (dont ${justes} justes) ; par cause : ${JSON.stringify(parCause)}`);
    }
    // ═════ (0b) COÛT : l'index d'alias (construit hors scan) et l'étape par question ; estimation pour 0,15 vCPU = CPU / 0,15 (le temps d'attente de la base ne se divise pas)
    {
        const trie = a => a.slice().sort((x, y) => x - y), q = (a, p) => (a.length ? trie(a)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
        const ms = COUT.map(x => x.ms), cpu = COUT.map(x => x.cpuMs);
        const moy = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
        const r1 = x => (x === null ? null : Math.round(x * 10) / 10);
        const t1 = process.hrtime.bigint(); const pc = rq('v2/identifier/leviers-abde').produitsParCle({ identifiants: () => V.identifiants(), entree: id => V.entree(id) }); const msPC = Math.round(Number(process.hrtime.bigint() - t1) / 1e5) / 10;          // un objet NEUF : le cache par version est contourné, on mesure la vraie construction
        console.log(`(0b) COÛT : index d'alias ${JSON.stringify(stats)} → à 0,15 vCPU ~${stats ? Math.round(stats.msCpu / 0.15) : '?'} ms de CPU étiré (hors scan, au démarrage puis toutes les 6 h)`);
        console.log(`     produitsParCle (première fois par version, ${pc.size} visuels) : ${msPC} ms mur ici → ~${Math.round(msPC / 0.15)} ms à 0,15 vCPU, par version chargée (à préchauffer avec l'archive)`);
        console.log(`     étape par question (${COUT.length} appels, base d'essai distante comprise) : mur moyen ${r1(moy(ms))} ms, p95 ${r1(q(ms, 0.95))} ms, max ${r1(Math.max(...ms))} ms ; CPU moyen ${r1(moy(cpu))} ms, p95 ${r1(q(cpu, 0.95))} ms → CPU à 0,15 vCPU ~${r1(moy(cpu) / 0.15)} ms en moyenne, p95 ~${r1(q(cpu, 0.95) / 0.15)} ms (+ l'attente de la base)`);
        RESULTAT_COUT = { indexAlias: stats, produitsParCleMs: msPC, appels: COUT.length, murMoyenMs: r1(moy(ms)), murP95Ms: r1(q(ms, 0.95)), cpuMoyenMs: r1(moy(cpu)), cpuP95Ms: r1(q(cpu, 0.95)) };
    }
    // ═════ (00) EXAMEN (--examiner=cle1,cle2) : ce que la route sert sur des lignes nommées, et la garde qui a décidé (I3 : même dessin ; marqueurs)
    for (const cle of (argv('examiner') || '').split(',').filter(Boolean)) {
        const s = sorties.find(x => x.cle.startsWith(cle)); if (!s) { console.log(`(00) ${cle} : ligne absente`); continue; }
        const d = s.on.diag, top3 = (d.decision && d.decision.top3) || [], id = d.decision && d.decision.id;
        const PRT = rq('v2/identifier/probable-route');
        const paires = []; for (let i = 0; i < top3.length; i++) for (let j = i + 1; j < top3.length; j++) paires.push(`${top3[i]}~${top3[j]}:${GM.memeDessin(V, top3[i], top3[j], { avecEmprunt: true })}`);
        const ent = x => { const e = V.entree(x); return e ? { grandeCle: e.grande && e.grande.cle, vignetteCle: e.vignette && e.vignette.cle, idMetacard: e.idMetacard, numero: e.numero, setNom: e.setNom, mention: e.mention ?? null, empruntDe: typeof V.empruntDe === 'function' ? V.empruntDe(x) : 'n/a' } : null; };
        console.log(`(00) ${s.cle} : issue route « ${s.on.probable ? 'probable ' + s.on.probable.idProduct : s.on.apres.issue} » · décision de l'étape ${JSON.stringify(d.decision)} · raison ${d.raison} · trace marqueurs ${JSON.stringify(s.on.trace)} · estGroupe(trace) ${PRT.estGroupe(s.on.trace)} · memeDessin par paire du top3 (avecEmprunt) ${paires.join(' ')} · dansUnGroupe(désigné) ${id ? PRT.dansUnGroupe(V, id, top3) : 'n/a'}`);
        for (const x of top3.concat(s.sim && s.sim.verite ? [s.sim.verite] : [])) console.log(`     ${x} ${JSON.stringify(ent(x))}${x === (s.sim && s.sim.verite) ? ' <- vérité' : ''}`);
    }
    // ═════ (0) INFORMATION : le nom lu (confiance haute) contredit-il le probable désigné par la route ? (le filtre de nom de CONFIRMATION-SURE n'est pas dans l'étape : mesuré ici, jamais corrigé)
    {
        const NC = rq('v2/identifier/nom-compatible');
        let probables = 0, contredits = 0, contreditsJustes = 0, contreditsFaux = 0, avecNom = 0, avecLigne = 0;
        for (const s of sorties) {
            if (!s.on.probable) continue;
            probables++;
            if (NC.formesLuesDe(s.corps).length) avecNom++;
            if ((s.on.diag.lignes && s.on.diag.lignes.get(s.on.probable.idProduct)) || s.on.ctx.produits.get(s.on.probable.idProduct)) avecLigne++;
            const formes = NC.formesLuesDe(s.corps), l = (s.on.diag.lignes && s.on.diag.lignes.get(s.on.probable.idProduct)) || s.on.ctx.produits.get(s.on.probable.idProduct) || null;
            if (formes.length && l && !NC.nomCompatible(formes, l)) { contredits++; const sim = s.sim; if (sim && s.on.probable.idProduct === sim.verite) contreditsJustes++; else contreditsFaux++; }
        }
        console.log(`(0) NOM : ${probables} probables de la route · dont ${avecNom} avec un nom lu en confiance haute et ${avecLigne} dont la ligne est lue · le nom contredit le désigné : ${contredits} (justes ${contreditsJustes}, autres ${contreditsFaux})`);
    }
    // ═════ (1) UN SÛR NE CHANGE JAMAIS
    let surs = 0, surChange = 0, surNeuf = 0; const detailSurs = [];
    for (const s of sorties) {
        const a = s.off.apres, b = s.on.apres;
        if (a.issue === 'affirmee') { surs++; if (b.issue !== 'affirmee' || b.id !== a.id) { surChange++; detailSurs.push({ cle: s.cle, avant: a, apres: b }); } }
        else if (b.issue === 'affirmee') { surNeuf++; detailSurs.push({ cle: s.cle, avant: a, apres: b, neuf: true }); }
    }
    console.log(`\n(1) SÛRS : ${surs} sûrs drapeau éteint · changés drapeau allumé ${surChange} · sûrs fabriqués ${surNeuf}`);

    // ═════ (2) la parité des issues avec le simulateur, ligne à ligne
    const classe = (kind, id) => (kind === 'prob' ? `probable ${id}` : kind === 'q' ? 'question' : 'rien');
    const comptes = { rejouees: 0, identiques: 0, ecarts: 0, nonRejouees: 0, questionsMemeEnsemble: 0, questionsAutreEnsemble: 0 };
    const causes = {}, ecartsDetail = [], nonExpliques = [];
    const parBanc = {};
    const compte = (cle, nom) => { causes[nom] = (causes[nom] || 0) + 1; };
    for (const s of sorties) {
        const sim = s.sim; if (!sim) continue;                              // une ligne sans décision du simulateur (sûre, ou sans vérité) : couverte par (1)
        if (sim.etStocke) continue;                                          // question lue du journal par le simulateur, non rejouée
        comptes.rejouees++;
        const S3 = sim.C3, simK = classe(S3.kind, S3.id);
        const R = s.on, rk = R.probable ? `probable ${R.probable.idProduct}` : (R.apres.issue === 'question' ? 'question' : 'rien');
        const pb = parBanc[sim.pop] = parBanc[sim.pop] || { rejouees: 0, identiques: 0, ecarts: 0 }; pb.rejouees++;
        // L'ISSUE comprend la question servie : le probable désigné (s'il y en a un) ET l'ensemble des candidats posés. Quand le simulateur n'a classé qu'un candidat (top3 < 2), la route laisse la question d'avant (inchangée).
        const ensembleSim = Array.isArray(S3.top3) && S3.top3.length >= 2 ? S3.top3.slice().sort((x, y) => x - y).join() : null;
        const ensembleRoute = R.apres.issue === 'question' ? R.apres.choix.join() : null;
        const memeEnsemble = ensembleSim === null ? ensembleRoute === (R.avant.issue === 'question' ? R.avant.choix.join() : null) : ensembleSim === ensembleRoute;
        const memeProbable = S3.kind === 'prob' ? Boolean(R.probable && R.probable.idProduct === S3.id) : !R.probable;
        const memeIssue = memeProbable && memeEnsemble;
        if (memeIssue && S3.kind !== 'prob') comptes.questionsMemeEnsemble++;
        if (memeIssue) { comptes.identiques++; pb.identiques++; continue; }
        comptes.ecarts++; pb.ecarts++;
        // ── l'attribution : la cause se PROUVE par une contre-épreuve, jamais par une coïncidence
        const d = R.diag, decRoute = d.decision || null;
        const memeTop3 = (x, y) => Array.isArray(x) && Array.isArray(y) && (x.length < 2 && y.length < 2 || x.slice().sort((a, b) => a - b).join() === y.slice().sort((a, b) => a - b).join());
        const egaleADuSimulateur = dec => Boolean(dec) && dec.kind === S3.kind && (S3.kind !== 'prob' || dec.id === S3.id) && memeTop3(dec.top3, S3.top3);
        const memeDecision = egaleADuSimulateur(decRoute);
        let cause = null, contreEpreuve = null;
        const ligneE = Boolean(sim.guide);                                    // une ligne « jumeaux-trop-nombreux » de la chaîne : le simulateur part des choix STOCKÉS (aucun), la route des 3 premiers jumeaux
        const brut = R.resAvant || {}, quoi = `${brut.issue}${brut.motif ? ' ' + brut.motif : ''}${brut.erreur && brut.erreur.code ? ' ' + brut.erreur.code : ''}`;
        if (R.apres.issue !== 'question' && R.avant.issue !== 'question') cause = brut.issue === 'panne' ? `panne du rejeu : la chaîne rend ${quoi} (colonne des jumeaux de l'archive)` : `la chaîne rend ${quoi} : la route ne désigne jamais sur un introuvable`;
        else if (R.diag.raison === 'groupe-marqueurs') cause = 'garde des marqueurs : question de GROUPE (jumbo / même dessin)';
        else if (memeDecision && R.diag.raison === 'groupe-donnees') cause = 'I3 : le désigné est de même dessin qu\'un autre des 3';
        else if (memeDecision && R.diag.raison === 'sans-prix') cause = 'I2 : le désigné n\'a pas de prix de guide';
        else if (memeDecision && R.diag.raison === 'sans-ligne') cause = 'garde de repli : un candidat du top 3 sans ligne';
        else if (['non-redressee', 'sans-vecteur'].includes(R.diag.raison) || /^vecteur-/.test(R.diag.raison || '')) cause = `vecteur : ${R.diag.raison} (la route exige un vecteur admis, plausible et redressé)`;
        else if (['catalogue-en-panne', 'sans-catalogue', 'erreur', 'question-impossible'].includes(R.diag.raison)) cause = `panne : ${R.diag.raison}`;
        else if (ligneE) cause = 'e : candidats de base = les 3 premiers jumeaux (la route) contre aucun (le simulateur : choix stockés)';
        else {
            // contre-épreuve de l'exclusion des empruntés : la même étape sur une version où aucun visuel n'est emprunté
            const dc = {}; const lvC = await muet(() => LV.appliquerLeviers({ cfg: cfgOn, entree: entreeDe(s.cle.split(':')[0]), resultat: R.resAvant, corpsChaine: s.corps, produits: s.on.ctx.produits, version: versionSansEmprunt, traceMarqueurs: R.trace, catalogue: cat, ctxQuestion: { langueInterface: 'fr', cfg: cfgOn, ficheServie: false, jumeaux: s.on.ctx.jumeaux }, etat, diag: dc }));
            const decC = dc.decision || null; contreEpreuve = dc;
            const memeC = egaleADuSimulateur(decC);
            if (memeC) cause = 'exclusion des visuels empruntés (cosinus du pool)';
            else if (memeDecision) cause = `garde de la route : ${R.diag.raison}`;
        }
        if (!cause) { cause = 'NON EXPLIQUÉ'; nonExpliques.push(s.cle); }
        compte(s.cle, cause);
        ecartsDetail.push({ cle: s.cle, pop: sim.pop, serie: sim.enSerie, simulateur: simK, route: rk, cause, raison: R.diag.raison || null, decisionRoute: decRoute, decisionSimulateur: { kind: S3.kind, id: S3.id, top3: S3.top3 },
            ...(cause === 'NON EXPLIQUÉ' ? { poolRoute: (R.diag.candidats || []).map(x => ({ id: x.id, cos: x.cos, ok: x.ok, ko: x.ko })), poolSimulateur: S3.detail || null, T: R.diag.T || null, TSimulateur: sim.T || null, contreEpreuve: contreEpreuve ? { raison: contreEpreuve.raison, decision: contreEpreuve.decision, T: contreEpreuve.T, pool: (contreEpreuve.candidats || []).map(x => ({ id: x.id, cos: x.cos, ok: x.ok, ko: x.ko })) } : null } : {}) });
    }
    // les lignes du simulateur que NI la route NI le simulateur ne rejouent (la chaîne n'a pas de corps reconstructible : la question est lue du journal) : comptées à part, jamais dans la parité
    const vus = new Set(sorties.map(s => s.cle));
    const nonRejoueesCles = [...SIM.keys()].filter(k => !vus.has(k));
    comptes.nonRejouees = nonRejoueesCles.length;
    const nrProb = nonRejoueesCles.filter(k => SIM.get(k).C3.kind === 'prob'), nrProbJustes = nrProb.filter(k => SIM.get(k).C3.id === SIM.get(k).verite);
    // ── le tableau « route » : les mêmes dénominateurs que le §8.1 ; les sûrs sont ceux du simulateur (identiques, voir (1)) ; les probables sont ceux de la ROUTE rejouée, et, pour les lignes non rejouées, ceux du simulateur
    let tableauRoute = null;
    try {
        const PA = JSON.parse(fs.readFileSync(argv('partieA') || path.join(path.dirname(argv('simulateur')), 'partieA-sortie.json'), 'utf8')).tab['variante (tri c3)'];
        const parPop = {};
        const ajouter = (pop, serie, f) => { for (const p of serie ? [pop, 'serie'] : [pop]) { parPop[p] = parPop[p] || { pj: 0, pf: 0 }; f(parPop[p]); } };
        const verifie = (sim, id) => (id === sim.verite);
        for (const s of sorties) { const sim = s.sim; if (!sim || sim.etStocke) continue; if (s.on.probable) ajouter(sim.pop, sim.enSerie, x => { if (verifie(sim, s.on.probable.idProduct)) x.pj++; else x.pf++; }); }
        for (const k of nonRejoueesCles) { const sim = SIM.get(k); if (sim.C3.kind === 'prob') ajouter(sim.pop, sim.enSerie, x => { if (verifie(sim, sim.C3.id)) x.pj++; else x.pf++; }); }
        tableauRoute = {};
        for (const p of ['serie', 'reglage', 'ordinaire', 'tamponnee']) { const t = PA[p], r = parPop[p] || { pj: 0, pf: 0 }; tableauRoute[p] = { den: t.den, surJ: t.surJ, surF: t.surF, probJ: r.pj, probF: r.pf, direct: t.surJ + r.pj, simulateurDirect: t.dir, simulateurProbJ: t.probJ, simulateurProbF: t.probF }; }
        console.log('\n    TABLEAU ROUTE (directes = sûrs + probables justes ; pf = probables faux / servis) contre SIMULATEUR :');
        for (const p of ['serie', 'reglage', 'ordinaire', 'tamponnee']) { const t = tableauRoute[p]; console.log(`      ${p.padEnd(10)} route ${t.direct}/${t.den} = ${(100 * t.direct / t.den).toFixed(1)} % · pf ${t.probF}/${t.probJ + t.probF} · sûrs faux ${t.surF}   |   simulateur ${t.simulateurDirect}/${t.den} = ${(100 * t.simulateurDirect / t.den).toFixed(1)} % · pf ${t.simulateurProbF}/${t.simulateurProbJ + t.simulateurProbF}`); }
    } catch (e) { console.log(`    (tableau route non calculé : ${e.message})`); }
    console.log(`\n(2) PARITÉ : lignes du simulateur rejouées ${comptes.rejouees} · identiques ${comptes.identiques} · écarts ${comptes.ecarts} · non rejouées par le simulateur (question lue du journal) ${comptes.nonRejouees} (dont ${nrProb.length} probables du simulateur, ${nrProbJustes.length} justes)`);
    console.log(`    questions : même ensemble de 3 ${comptes.questionsMemeEnsemble} · autre ensemble ${comptes.questionsAutreEnsemble} (parmi les lignes de même issue sans probable)`);
    console.log('    par banc :', JSON.stringify(parBanc));
    console.log('    ÉCARTS PAR CAUSE :', JSON.stringify(causes));
    for (const e of ecartsDetail) console.log(`    - ${e.pop}${e.serie ? '+série' : ''} ${e.cle} simulateur « ${e.simulateur} » route « ${e.route} » : ${e.cause}`);
    console.log('\n(R) RELEVÉ HORS REJEU (non rejoué, ni par la route ici ni par le simulateur) : la règle G (V2_REGLE_G / vecteur), SUR-PAR-IMAGE, la seconde lecture, la lecture du tampon, le titre jumbo (0 annonce en base), le second envoi G-GROUPE. Éteints ou sans fournisseur dans l\'état livré ; ils ne peuvent que PROMOUVOIR un sûr ou réduire une question avant le levier, jamais l\'inverse. Leur effet se lit sur la SÉRIE RÉELLE de l\'essai (déjà mesuré : 1 probable juste par G-GROUPE sur 6ad09190, serie-P2-1101.json).');
    console.log(`\n(3) ÉCARTS NON EXPLIQUÉS : ${nonExpliques.length}`, nonExpliques.length ? JSON.stringify(nonExpliques) : '');
    if (argv('sortie')) fs.writeFileSync(argv('sortie'), JSON.stringify({ le: new Date().toISOString(), indexAlias: stats, cout: RESULTAT_COUT, surs: { surs, surChange, surNeuf, detailSurs }, comptes, parBanc, causes, tableauRoute, nonRejouees: { n: nonRejoueesCles.length, probables: nrProb.length, probablesJustes: nrProbJustes.length }, ecartsDetail, nonExpliques }, null, 1));
    await c.close();
    process.exit(surChange || surNeuf || nonExpliques.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.code || e.name, String(e.message || '').slice(0, 300), String(e.stack || '').split('\n').slice(1, 4).join(' | ')); process.exit(1); });

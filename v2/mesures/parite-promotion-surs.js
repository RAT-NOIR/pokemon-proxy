'use strict';
// DECISION-SURS — PARITÉ route = simulateur, HORS LIGNE (lecture seule, 0 $, aucun réseau payant, aucune écriture). La route est rejouée sur les lignes de la base d'essai (analyses + journal_scans, lues par MONGODB_ESSAI_LECTURE_URI,
// jamais imprimée) avec l'ARCHIVE, l'INDEX d'empreintes et le CATALOGUE réels, DRAPEAU ÉTEINT puis ALLUMÉ, par les fonctions de production : l'adaptateur, la garde des marqueurs, l'étape des leviers (leviers-abde.js) et la décision de la
// promotion (promotion-surs-route.js, qui appelle l'affirmation et la garde des marqueurs une seconde fois). Le simulateur est la mesure (decision.js du banc de mesure) : son dump porte, par ligne probable, la décision de la fonction de production
// (`prodPromo`) sur les entrées du simulateur, déjà confrontée à la règle recopiée de la mesure (S2 ∪ S3 ∪ I(0,2)).
// Sorties, et le banc échoue (code 1) sur l'une d'elles :
//   (1) ÉTEINT : aucune promotion nulle part ; probable, question et sûr IDENTIQUES au rejeu drapeau allumé hors promotion (0 écart) ;
//   (2) ALLUMÉ : un SÛR existant ne change jamais ; les lignes promues sont EXACTEMENT celles du simulateur (mêmes lignes, mêmes produits) — chaque écart est NOMMÉ ; 0 sûr FAUX ;
//   (3) le tableau par population : série, réglage, réglage sans les 137, ordinaires, tamponnées, union.
// Usage : node v2/mesures/parite-promotion-surs.js --dump=<decision-dump-p10.json> --simulateur=<decisions-simulateur-p10.json> [--archive=candidate-2026-10-31b.rmv] [--sortie=<json>]
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..'), TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
require(path.join(TRAVAIL, 'atlas', 'garde-secrets'));
const { ouvrir } = require(path.join(TRAVAIL, 'mesure-banc-reel', 'lib'));
const rq = m => require(path.join(RACINE, ...m.split('/')));
const { preparer } = rq('v2/identifier/langue-decisive-charge');
const { adapter, affirmerParLaRoute } = rq('v2/identifier/adaptateur');
const J = rq('v2/identifier/jumeaux'), LD = rq('v2/identifier/langue-decisive'), DES = rq('v2/identifier/designation'), GC = rq('v2/identifier/garde-contradiction');
const { construireProduit } = rq('v2/identifier/produit'), GM = rq('v2/identifier/garde-marqueurs');
const LV = rq('v2/identifier/leviers-abde'), PSR = rq('v2/identifier/promotion-surs-route');
const { creerCatalogue } = rq('v2/identifier/catalogue'), { lireConfig } = rq('v2/config'), dbV2 = rq('v2/db');
const S = rq('v2/chargeur/scellement'), F = rq('v2/chargeur/format'), X = rq('v2/identifier/index-empreintes'), EV = rq('v2/identifier/empreinte-vecteur');
const argv = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
if (!argv('dump') || !argv('simulateur')) { console.log('usage : --dump=<decision-dump-p10.json> --simulateur=<decisions-simulateur-p10.json>'); process.exit(2); }
const ARCHIVE = path.join(TRAVAIL, 'archives', argv('archive') || 'candidate-2026-10-31b.rmv');
const NAV = path.join(TRAVAIL, 'index-empreintes-essai', 'donnees-nav', 'nav-bancs.json');
const INDEX = path.join(TRAVAIL, 'index-empreintes-essai', 'sortie', 'index-empreintes-2026-10-24.rmei');
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const NOMS = Object.keys(DES.REGLES_DESIGNATION), TOUTES = Object.fromEntries(NOMS.map(k => [k, true]));
const DRAPEAUX_MARQUEURS = { jumboTitre: true, gardeMarqueurs: true };

(async () => {
    const DUMP = JSON.parse(fs.readFileSync(argv('dump'), 'utf8'));
    const SIM = new Map(JSON.parse(fs.readFileSync(argv('simulateur'), 'utf8')).map(x => [x.cle, x]));
    const LIGNE = new Map(DUMP.lignes.map(l => [l.cle, l]));
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(ARCHIVE), process.env.V2_VISUELS_HMAC)));
    const o = X.ouvrir(fs.readFileSync(INDEX), process.env.V2_VISUELS_HMAC, { modeleAttendu: MODELE }), idx = o.index;
    const etat = { courante: () => ({ index: idx, meta: { modele: MODELE } }) };
    const nav = JSON.parse(fs.readFileSync(NAV, 'utf8')).photos;
    const { c, db } = await ouvrir();
    dbV2.brancher(db);
    const cfg0 = lireConfig({});
    const cfgBase = { ...cfg0, probable: true, empreinteExtension: true, modeleEmpreinte: MODELE, leviersAbde: true, leviersEcart: 0.1, leviersUnCandidat: true, gardeMarqueurs: true };
    const cfgEteint = { ...cfgBase, promotionSurs: false }, cfgAllume = { ...cfgBase, promotionSurs: true };
    const cat = creerCatalogue({ cfg: cfg0, visuels: { entree: id => V.entree(id), tirage: id => V.tirageJumeaux(id), resoudre: async () => null, impressions: async () => [] } });
    await cat.indexCodeNumero(); await cat.indexFamilles(); await cat.indexAliasFr();
    const A = await db.collection('analyses').find({}).toArray();
    const JN = new Map((await db.collection('journal_scans').find({}).toArray()).map(j => [String(j._id), j]));
    const Aid = new Set(A.map(a => String(a._id)));
    const orph = [...JN.values()].filter(j => !Aid.has(String(j._id)));
    const jDe = a => { const j = JN.get(String(a._id)); if (j) return j; const t = a.creeLe.getTime(); const cand = orph.filter(o2 => Math.abs(new Date(o2.le).getTime() - t) <= 10000); return cand.length === 1 ? cand[0] : null; };
    const ctxRoute = (produits, jumeaux, cne, cfg) => ({ produits, langueInterface: 'fr', cfg, ficheServie: false, jumeaux, critereA: true, langueDeci: undefined, langueDecisive: { ...LD.REGLES }, codeNumeroExiste: cne, designation: {} });
    const issueDe = r => r ? { issue: r.issue, id: r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null, choix: r.issue === 'question' ? r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b) : [] } : { issue: 'aucune', id: null, choix: [] };
    const entreeDe = cleScan => { const p = nav[cleScan]; return { versionExtension: '2.0.1', empreintes: p && p.redressee === true && Array.isArray(p.emb) ? { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: null }] } : null }; };

    const sorties = [];
    for (const a of A) for (const [i] of a.cartes.entries()) {
        const cle = `${String(a._id)}:${i}`, j = jDe(a);
        if (!j || !Array.isArray(j.vivierIds)) continue;
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
        const jum0 = await J.fournisseurParDefaut(cat, V, J.idsAPreparer(corps));
        const produits0 = await cat.lire([...ids0, ...J.idsACharger(corps, jum0), ...GC.idsDeLaGarde(corps)]);
        const pr = await preparer({ corpsListe: [corps], produits: produits0, jumeaux: jum0, catalogue: cat, version: V, designation: TOUTES });
        // la route, pas à pas, drapeau éteint puis allumé : l'adaptateur, les marqueurs, l'étape des leviers, la décision de la promotion
        const run = async cfg => {
            const ctx = { ...ctxRoute(pr.produits, pr.jumeaux, pr.codeNumeroExiste, cfg), leviersE: true };
            let res = muet(() => adapter({ statutHttp: 200, corps }, ctx)), trace = null;
            const gm = muet(() => GM.appliquerMarqueurs({ cfg: DRAPEAUX_MARQUEURS, titre: null, resultat: res, derniereQuestion: null, c: corps, desaccordG: null, empreinteInfo: null, produits: ctx.produits, version: V, langueInterface: 'fr', jumeaux: ctx.jumeaux, lot: false, journal: () => { } }));
            if (gm) { trace = gm.trace; if (gm.resultat) res = gm.resultat; }
            const avant = issueDe(res);
            let lv = null, probable = null, promo = null;
            const baseN = res.issue === 'question' && res.analyse && res.analyse.cartes[0] && Array.isArray(res.analyse.cartes[0].candidats) ? res.analyse.cartes[0].candidats.length : null, levierE = res.jumeauxEnQuestion === true;
            if (res.issue === 'question') {
                lv = await muet(() => LV.appliquerLeviers({ cfg, entree: entreeDe(cle.split(':')[0]), resultat: res, corpsChaine: corps, produits: ctx.produits, version: V, traceMarqueurs: trace, catalogue: cat, ctxQuestion: { langueInterface: 'fr', cfg, ficheServie: false, jumeaux: ctx.jumeaux }, etat }));
                if (lv && lv.resultat) res = lv.resultat;
                probable = lv ? lv.probable : null;
                if (lv && lv.promotion) {
                    const derniere = res;
                    promo = muet(() => PSR.promouvoirDansLaRoute({ cfg, lv, journal: () => { },
                        affirmer: (id, surcharge, critere) => affirmerParLaRoute(corps, id, { produits: surcharge || ctx.produits, langueInterface: 'fr', cfg, ficheServie: false }, critere),
                        marqueurs: (aff, lignesPromo) => GM.appliquerMarqueurs({ cfg: DRAPEAUX_MARQUEURS, titre: null, resultat: aff, derniereQuestion: derniere, c: corps, desaccordG: null, empreinteInfo: null, produits: lignesPromo, version: V, langueInterface: 'fr', jumeaux: ctx.jumeaux, lot: false, journal: () => { } }) }));
                    if (promo && promo.resultat) { res = promo.resultat; probable = null; }
                }
            }
            return { avant, apres: issueDe(res), probable: probable ? probable.idProduct : null, promotionDecidee: Boolean(lv && lv.promotion), regle: lv && lv.promotion ? lv.promotion.regle : null, promoIssue: promo ? promo.trace.issue : null, baseN, levierE };
        };
        const off = await run(cfgEteint), on = await run(cfgAllume);
        sorties.push({ cle, off, on });
    }
    console.log(`lignes rejouées par la route : ${sorties.length} (sur ${A.reduce((n, a) => n + a.cartes.length, 0)} cartes de la base d'essai) · lignes du dump du simulateur : ${DUMP.lignes.length}`);

    // ═════ (1) ÉTEINT : aucune promotion, aucun changement
    const promotionsEteint = sorties.filter(s => s.off.promotionDecidee || s.off.promoIssue).length;
    // le drapeau éteint doit rendre, ligne à ligne, ce que rend le même rejeu allumé quand la promotion n'est pas décidée : probable et issue identiques
    const diffEteintAllume = sorties.filter(s => !s.on.promotionDecidee && (JSON.stringify(s.off.apres) !== JSON.stringify(s.on.apres) || s.off.probable !== s.on.probable));
    const nonPromuesChangees = sorties.filter(s => s.on.promotionDecidee && s.on.promoIssue !== 'sur' && (JSON.stringify(s.off.apres) !== JSON.stringify(s.on.apres) || s.off.probable !== s.on.probable));
    console.log(`\n(1) ÉTEINT : promotions décidées ${promotionsEteint} · lignes sans promotion qui diffèrent entre éteint et allumé ${diffEteintAllume.length} · promotions refusées par la route dont la réponse a changé ${nonPromuesChangees.length}`);

    // (1b) le drapeau éteint EST l'état d'aujourd'hui : les probables du simulateur (l'état livré) sont ceux que la route éteinte sert
    const probSim = DUMP.lignes.filter(l => l.kind === 'prob');
    const servis = probSim.filter(l => { const s = sorties.find(x => x.cle === l.cle); return s && s.off.probable === l.desine && s.off.apres.issue === 'question'; }).length;
    console.log(`(1b) ÉTEINT = aujourd'hui : probables du simulateur ${probSim.length} · servis à l'identique par la route éteinte ${servis} · sûrs de la route éteinte ${sorties.filter(s => s.off.apres.issue === 'affirmee').length}`);

    // ═════ (2) ALLUMÉ
    let surs = 0, surChange = 0; const promues = [];
    for (const s of sorties) {
        if (s.off.apres.issue === 'affirmee') { surs++; if (s.on.apres.issue !== 'affirmee' || s.on.apres.id !== s.off.apres.id) surChange++; }
        else if (s.on.apres.issue === 'affirmee') promues.push(s);
    }
    console.log(`(2) ALLUMÉ : sûrs existants ${surs} · changés ${surChange} · promotions en sûr ${promues.length}`);
    const attendues = new Map(DUMP.lignes.filter(l => l.kind === 'prob' && l.prodPromo && l.prodPromo.promu).map(l => [l.cle, l.prodPromo.id]));
    const ecarts = [];
    for (const [cle, id] of attendues) {
        const s = sorties.find(x => x.cle === cle), sim = SIM.get(cle);
        const sert = s && s.on.apres.issue === 'affirmee' && s.on.apres.id === id;
        if (!sert) ecarts.push({ cle: cle.slice(0, 8), attendu: id, route: s ? (s.on.probable !== null ? `probable ${s.on.probable}` : JSON.stringify(s.on.apres)) : 'ligne non rejouée', promo: s && s.on.promoIssue, cause: !s ? 'ligne non rejouée par la route (sans journal ou corps non reconstructible)' : s.on.levierE ? 'C1 : question née du levier e (jamais promue)' : s.on.baseN !== null && s.on.baseN < 2 ? 'C1 : question de la chaîne à UN candidat (jamais promue)' : s.on.probable !== id ? 'la route ne désigne pas le même probable que le simulateur' : 'la promotion est décidée mais refusée par la route' });
    }
    const imprevues = promues.filter(s => !attendues.has(s.cle));
    console.log(`    promotions du simulateur : ${attendues.size} · servies par la route ${attendues.size - ecarts.length} · ÉCARTS ${ecarts.length} · promotions de la route sur des lignes que le simulateur ne rejoue pas (sans vérité, NON JUGÉES : à regarder à la main, jamais comptées juste) ${imprevues.length}`);
    const parCause = {}; for (const e of ecarts) parCause[e.cause] = (parCause[e.cause] || 0) + 1;
    console.log('    écarts par cause :', JSON.stringify(parCause));
    const inexpliques = ecarts.filter(e => !/^C1 :/.test(e.cause));
    for (const e of inexpliques) console.log('    écart NON EXPLIQUÉ', JSON.stringify(e));
    for (const s of imprevues) console.log('    imprévue', s.cle.slice(0, 8), JSON.stringify(s.on));
    // ═════ (3) le tableau par population (les lignes promues par la ROUTE jugées contre la vérité)
    const POPS = [['série', l => l.enSerie], ['réglage', l => l.pop === 'reglage'], ['réglage sans 137', l => l.pop === 'reglage' && !l.is137], ['ordinaires', l => l.pop === 'ordinaire'], ['tamponnées', l => l.pop === 'tamponnee'], ['union', () => true]];
    let faux = 0;
    console.log('\n(3) par population — route allumée : sûrs justes GAGNÉS / sûrs FAUX');
    for (const [n, pf] of POPS) {
        let gj = 0, gf = 0;
        for (const s of promues) { const l = LIGNE.get(s.cle); if (!l || !pf(l)) continue; if (s.on.apres.id === l.verite) gj++; else gf++; }
        faux += n === 'union' ? gf : 0;
        console.log(`    ${n.padEnd(18)} +${gj} / ${gf}`);
    }
    if (argv('sortie')) fs.writeFileSync(argv('sortie'), JSON.stringify({ le: new Date().toISOString(), lignes: sorties.length, promotionsEteint, diffEteintAllume: diffEteintAllume.length, surs, surChange, promues: promues.length, attendues: attendues.size, ecarts, imprevues: imprevues.map(s => s.cle), surFaux: faux }, null, 1));
    await c.close();
    process.exit(promotionsEteint || diffEteintAllume.length || nonPromuesChangees.length || surChange || inexpliques.length || faux ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.code || e.name, String(e.message || '').slice(0, 300), String(e.stack || '').split('\n').slice(1, 4).join(' | ')); process.exit(1); });

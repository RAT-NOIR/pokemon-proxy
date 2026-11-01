'use strict';
// JUMEAUX-VERDICTS — REJEU HORS LIGNE : la route (l'adaptateur, les marqueurs, l'étape des leviers, la promotion en sûr), drapeau V2_JUMEAUX_PREPARER_TOUS ÉTEINT puis ALLUMÉ, sur les lignes de la base d'essai (analyses + journal_scans,
// lues par MONGODB_ESSAI_LECTURE_URI, jamais imprimée), avec l'ARCHIVE, l'INDEX d'empreintes et le CATALOGUE réels, par les fonctions de production. LECTURE SEULE, 0 $, aucun réseau payant, aucune écriture.
// Jamais le juge scellé, jamais juge-200, jamais un holdout scellé : seules les lignes de la base d'essai (série neuve, réglage, contrôle déjà ouverts) ; la vérité vient du simulateur (`verite`), absente = « non jugée ».
// Sorties : par état (éteint / allumé) — sûrs (juste / FAUX / non jugé), probables (justes / faux), questions, pannes, introuvables ; puis CHAQUE ligne dont l'issue change, avec sa vérité. Code 1 si un SÛR FAUX NOUVEAU apparaît.
// Usage : node v2/mesures/rejeu-jumeaux-verdicts.js --simulateur=<decisions-simulateur.json> [--archive=candidate-2026-10-31b.rmv] [--sortie=<json>]
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..'), TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
require(path.join(TRAVAIL, 'atlas', 'garde-secrets'));
const { ouvrir } = require(path.join(TRAVAIL, 'mesure-banc-reel', 'lib'));
const rq = m => require(path.join(RACINE, ...m.split('/')));
const { preparer } = rq('v2/identifier/langue-decisive-charge');
const { adapter, affirmerParLaRoute } = rq('v2/identifier/adaptateur');
const J = rq('v2/identifier/jumeaux'), LD = rq('v2/identifier/langue-decisive'), DES = rq('v2/identifier/designation'), GC = rq('v2/identifier/garde-contradiction');
const GM = rq('v2/identifier/garde-marqueurs'), LV = rq('v2/identifier/leviers-abde'), PSR = rq('v2/identifier/promotion-surs-route');
const { creerCatalogue } = rq('v2/identifier/catalogue'), { lireConfig } = rq('v2/config'), dbV2 = rq('v2/db');
const S = rq('v2/chargeur/scellement'), F = rq('v2/chargeur/format'), X = rq('v2/identifier/index-empreintes'), EV = rq('v2/identifier/empreinte-vecteur');
const argv = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const SIMULATEUR = argv('simulateur') || path.join(TRAVAIL, 'kaggle-v2', 'maitre-v4', 'simu', 'decisions-simulateur.json');      // par défaut : le simulateur de la série neuve et des bancs non scellés
const SORTIE = argv('sortie') || path.join(process.env.TEMP || TRAVAIL, 'rejeu-jumeaux-verdicts.json');
const ARCHIVE = path.join(TRAVAIL, 'archives', argv('archive') || 'candidate-2026-10-31b.rmv');
const NAV = path.join(TRAVAIL, 'index-empreintes-essai', 'donnees-nav', 'nav-bancs.json');
const INDEX = path.join(TRAVAIL, 'index-empreintes-essai', 'sortie', 'index-empreintes-2026-10-24.rmei');
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const TOUTES = Object.fromEntries(Object.keys(DES.REGLES_DESIGNATION).map(k => [k, true]));
const DRAPEAUX_MARQUEURS = { jumboTitre: true, gardeMarqueurs: true };

(async () => {
    const SIM = new Map(JSON.parse(fs.readFileSync(SIMULATEUR, 'utf8')).map(x => [x.cle, x]));
    const V = F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(ARCHIVE), process.env.V2_VISUELS_HMAC)));
    const o = X.ouvrir(fs.readFileSync(INDEX), process.env.V2_VISUELS_HMAC, { modeleAttendu: MODELE }), idx = o.index;
    const etat = { courante: () => ({ index: idx, meta: { modele: MODELE } }) };
    const nav = JSON.parse(fs.readFileSync(NAV, 'utf8')).photos;
    const { c, db } = await ouvrir();
    dbV2.brancher(db);
    const cfg0 = lireConfig({});
    const cfgBase = { ...cfg0, probable: true, empreinteExtension: true, modeleEmpreinte: MODELE, leviersAbde: true, leviersEcart: 0.1, leviersUnCandidat: true, gardeMarqueurs: true, promotionSurs: true };
    const cfgEteint = { ...cfgBase, jumeauxPreparerTous: false }, cfgAllume = { ...cfgBase, jumeauxPreparerTous: true };
    const cat = creerCatalogue({ cfg: cfg0, visuels: { entree: id => V.entree(id), tirage: id => V.tirageJumeaux(id), resoudre: async () => null, impressions: async () => [] } });
    await cat.indexCodeNumero(); await cat.indexFamilles(); await cat.indexAliasFr();
    const A = await db.collection('analyses').find({}).toArray();
    const JN = new Map((await db.collection('journal_scans').find({}).toArray()).map(j => [String(j._id), j]));
    const Aid = new Set(A.map(a => String(a._id)));
    const orph = [...JN.values()].filter(j => !Aid.has(String(j._id)));
    const jDe = a => { const j = JN.get(String(a._id)); if (j) return j; const t = a.creeLe.getTime(); const cand = orph.filter(o2 => Math.abs(new Date(o2.le).getTime() - t) <= 10000); return cand.length === 1 ? cand[0] : null; };
    const ctxRoute = (produits, jumeaux, cne, cfg) => ({ produits, langueInterface: 'fr', cfg, ficheServie: false, jumeaux, critereA: true, langueDeci: undefined, langueDecisive: { ...LD.REGLES }, codeNumeroExiste: cne, designation: {}, leviersE: true });
    const issueDe = r => r ? { issue: r.issue, id: r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null, choix: r.issue === 'question' ? r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b) : [], motif: r.issue === 'panne' ? (r.motif || (r.erreur && r.erreur.code) || null) : null } : { issue: 'aucune', id: null, choix: [], motif: null };
    const entreeDe = cleScan => { const p = nav[cleScan]; return { versionExtension: '2.0.1', empreintes: p && p.redressee === true && Array.isArray(p.emb) ? { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: true, carte: null }] } : null }; };

    const sorties = []; let requetes = { eteint: 0, allume: 0 };
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
        // la préparation de la route, éteinte puis allumée (jumeaux.js : idsAffirmes sans option / idsAPreparer + { tous: true } ; langue-decisive-charge.js : tous)
        const route = async tous => {
            const cfg = tous ? cfgAllume : cfgEteint;
            let appels = 0; const compte = { ...cat, plusRecentDansMetacarte: (...a2) => { appels++; return cat.plusRecentDansMetacarte(...a2); } };
            const jum0 = await J.fournisseurParDefaut(compte, V, tous ? J.idsAPreparer(corps) : J.idsAffirmes(corps), tous ? { tous: true } : undefined);
            const produits0 = await cat.lire([...ids0, ...J.idsACharger(corps, jum0), ...GC.idsDeLaGarde(corps)]);
            const pr = await preparer({ corpsListe: [corps], produits: produits0, jumeaux: jum0, catalogue: compte, version: V, designation: TOUTES, tous });
            requetes[tous ? 'allume' : 'eteint'] += appels;
            const ctx = ctxRoute(pr.produits, pr.jumeaux, pr.codeNumeroExiste, cfg);
            let res = muet(() => adapter({ statutHttp: 200, corps }, ctx)), trace = null;
            const gm = muet(() => GM.appliquerMarqueurs({ cfg: DRAPEAUX_MARQUEURS, titre: null, resultat: res, derniereQuestion: null, c: corps, desaccordG: null, empreinteInfo: null, produits: ctx.produits, version: V, langueInterface: 'fr', jumeaux: ctx.jumeaux, lot: false, journal: () => { } }));
            if (gm) { trace = gm.trace; if (gm.resultat) res = gm.resultat; }
            const adaptateur = issueDe(res);
            let lv = null, probable = null;
            if (res.issue === 'question') {
                lv = await muet(() => LV.appliquerLeviers({ cfg, entree: entreeDe(cle.split(':')[0]), resultat: res, corpsChaine: corps, produits: ctx.produits, version: V, traceMarqueurs: trace, catalogue: cat, ctxQuestion: { langueInterface: 'fr', cfg, ficheServie: false, jumeaux: ctx.jumeaux }, etat }));
                if (lv && lv.resultat) res = lv.resultat;
                probable = lv ? lv.probable : null;
                if (lv && lv.promotion) {
                    const derniere = res;
                    const promo = muet(() => PSR.promouvoirDansLaRoute({ cfg, lv, journal: () => { },
                        affirmer: (id, surcharge, critere) => affirmerParLaRoute(corps, id, { produits: surcharge || ctx.produits, langueInterface: 'fr', cfg, ficheServie: false }, critere),
                        marqueurs: (aff, lignesPromo) => GM.appliquerMarqueurs({ cfg: DRAPEAUX_MARQUEURS, titre: null, resultat: aff, derniereQuestion: derniere, c: corps, desaccordG: null, empreinteInfo: null, produits: lignesPromo, version: V, langueInterface: 'fr', jumeaux: ctx.jumeaux, lot: false, journal: () => { } }) }));
                    if (promo && promo.resultat) { res = promo.resultat; probable = null; }
                }
            }
            return { adaptateur, final: issueDe(res), probable: probable ? probable.idProduct : null };
        };
        const off = await route(false), on = await route(true);
        sorties.push({ cle, sim: SIM.get(cle) || null, off, on });
    }
    // ═════ le tableau, par état : sûrs (juste / FAUX / non jugé), probables (justes / faux / non jugé), questions, pannes, introuvables
    const verite = s => (s.sim && Number.isInteger(s.sim.verite) ? s.sim.verite : null);
    const classe = (s, etatK) => {
        const e = s[etatK].final, v = verite(s);
        if (e.issue === 'affirmee') return v === null ? 'sûr non jugé' : e.id === v ? 'sûr juste' : 'SÛR FAUX';
        if (e.issue === 'question') { const p = s[etatK].probable; if (p !== null) return v === null ? 'probable non jugé' : p === v ? 'probable juste' : 'probable faux'; return 'question'; }
        return e.issue === 'panne' ? 'panne' : e.issue;
    };
    const comptes = etatK => { const m = {}; for (const s of sorties) { const k = classe(s, etatK); m[k] = (m[k] || 0) + 1; } return m; };
    const cOff = comptes('off'), cOn = comptes('on');
    console.log(`lignes rejouées par la route : ${sorties.length} (cartes de la base d'essai avec journal) · vérité connue (simulateur) pour ${sorties.filter(s => verite(s) !== null).length}`);
    console.log(`requêtes de verdict : éteint ${requetes.eteint} · allumé ${requetes.allume}`);
    const cles = [...new Set([...Object.keys(cOff), ...Object.keys(cOn)])].sort();
    console.log('\nétat'.padEnd(22) + 'ÉTEINT'.padStart(8) + 'ALLUMÉ'.padStart(8));
    for (const k of cles) console.log(`  ${k.padEnd(20)}${String(cOff[k] || 0).padStart(8)}${String(cOn[k] || 0).padStart(8)}`);
    // ═════ chaque ligne dont l'issue change
    const change = sorties.filter(s => JSON.stringify(s.off.final) !== JSON.stringify(s.on.final) || s.off.probable !== s.on.probable);
    console.log(`\nlignes dont l'issue (ou le probable) change : ${change.length}`);
    for (const s of change) console.log(`  ${s.cle.slice(0, 8)}${s.cle.slice(24)} pop=${s.sim ? s.sim.pop : '?'} série=${s.sim ? s.sim.enSerie : '?'} vérité=${verite(s)} | éteint ${classe(s, 'off')} ${JSON.stringify(s.off.final)} | allumé ${classe(s, 'on')} ${JSON.stringify(s.on.final)}${s.on.probable !== null ? ' probable ' + s.on.probable : ''}`);
    // ═════ un SÛR FAUX NOUVEAU (allumé) arrête
    const surFauxNouveaux = sorties.filter(s => classe(s, 'on') === 'SÛR FAUX' && classe(s, 'off') !== 'SÛR FAUX');
    const surNonJugesNouveaux = sorties.filter(s => classe(s, 'on') === 'sûr non jugé' && classe(s, 'off') !== 'sûr non jugé');
    const surRetires = sorties.filter(s => classe(s, 'off').startsWith('sûr') || classe(s, 'off') === 'SÛR FAUX').filter(s => !classe(s, 'on').toLowerCase().startsWith('sûr'));
    console.log(`\nSÛRS FAUX NOUVEAUX ${surFauxNouveaux.length} · sûrs nouveaux non jugés ${surNonJugesNouveaux.length} · sûrs d'avant qui ne le sont plus ${surRetires.length}`);
    fs.writeFileSync(SORTIE,JSON.stringify({ le: new Date().toISOString(), lignes: sorties.length, requetes, eteint: cOff, allume: cOn, changent: change.map(s => ({ cle: s.cle, pop: s.sim && s.sim.pop, enSerie: s.sim && s.sim.enSerie, verite: verite(s), off: s.off.final, on: s.on.final, probableOn: s.on.probable, classeOff: classe(s, 'off'), classeOn: classe(s, 'on') })), surFauxNouveaux: surFauxNouveaux.map(s => s.cle) }, null, 1));
    await c.close();
    process.exit(surFauxNouveaux.length ? 1 : 0);
})().catch(e => { console.log('ERREUR', e.code || e.name, String(e.message || '').slice(0, 300), String(e.stack || '').split('\n').slice(1, 4).join(' | ')); process.exit(1); });

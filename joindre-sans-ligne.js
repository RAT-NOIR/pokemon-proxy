'use strict';
// ============================================================
// JOINDRE-SANS-LIGNE (agent catalogue, 2026-11-03) — pose les lignes cartes_produits des fiches sans produit dont le produit existe (même set, même numéro, nom concordant).
//   node joindre-sans-ligne.js --simuler [--cache=<lecture.json>]      LECTURE SEULE, aucune base : rejoue collecte-cartes/jointure-sans-ligne.js::jugerJointure sur TOUTES les
//                                                                       appartenances sans ligne du cache de l'audit, écrit liens/plan-jointures.json
//   node joindre-sans-ligne.js --ecrire --attendu=<N> [--plan=<plan-jointures.json>]   SOUS lot-additif.js (LOT_ADDITIF_PID) : relit l'état VIVANT, refuse tout écart, insertOne par lots de 500
// Ligne attendue :
//   node lot-additif.js --quoi="jointures sans ligne : N lignes cartes_produits" --collections=cartes_produits ... -- node joindre-sans-ligne.js --ecrire --attendu=N
// 🔑 Les règles du site sont IMPORTÉES comme detecter-clones.js les importe. Jamais d'upsert : un _id déjà présent est une erreur comptée et le lot s'arrête.
// Une garde s'écrit par ce qu'elle autorise : argument inconnu = refus AVANT toute connexion.
// ============================================================
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/, /^--cache=.+\.json$/, /^--plan=.+\.json$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const simuler = args.includes('--simuler'), ecrire = args.includes('--ecrire');
const attendu = val('attendu') !== undefined ? Number(val('attendu')) : null;
if (inconnus.length || simuler === ecrire || (ecrire && attendu === null) || (simuler && (attendu !== null || val('plan') !== undefined))) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --simuler [--cache=<lecture.json>]  |  --ecrire --attendu=<N> [--plan=<plan-jointures.json>] (exactement un des deux modes). Rien n'a été ouvert.`);
    process.exit(2);
}
if (ecrire && !process.env.LOT_ADDITIF_PID) { console.error('❌ --ecrire refusé hors lot-additif.js (LOT_ADDITIF_PID absent) : sauvegarde, garde et journal passent par le lot. Rien n\'a été ouvert.'); process.exit(2); }

const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { jugerJointure, RAISONS, candidatsDuRefus } = require('./collecte-cartes/jointure-sans-ligne');
const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue';
const DOSSIER_LIENS = path.join(DOSSIER, 'liens');
const LIB_SITE = 'C:/Users/Yung/Desktop/rat-market-site/lib';
const morceaux = (l, n) => { const r = []; for (let i = 0; i < l.length; i += n) r.push(l.slice(i, i + n)); return r; };
const masquer = e => String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');

async function lancerSimulation() {
    const t0 = Date.now();
    const cacheArg = val('cache') || path.join(DOSSIER, 'audit-cache', 'lecture.json');
    const { chargerReglesSite } = require('./collecte-cartes/charger-regles-site');
    const { impressionDuSet, normaliserNumero } = await chargerReglesSite({ lib: LIB_SITE });
    const { expansionsDuSet, tirageDuSet } = await import(require('url').pathToFileURL(`${LIB_SITE}/entreesDuSet.ts`).href);
    const regles = { impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet };
    for (const [k, f] of Object.entries(regles)) if (typeof f !== 'function') throw new Error(`règle du site non importée : ${k}`);
    const lecture = JSON.parse(fs.readFileSync(cacheArg, 'utf8'));
    if (lecture.formatCache !== 2) throw new Error('cache d\'un autre format que 2 : relancer audit-sets.js');
    console.log(`lecture relue du cache (${lecture.le})`);
    const { sets, cartes, lignes, produits } = lecture;
    if (!sets.length || !cartes.length || !produits.length) throw new Error(`population vide (${sets.length} sets, ${cartes.length} cartes, ${produits.length} produits) — une simulation sur zéro n'est pas une mesure`);
    const numeroDe = new Map((lecture.numerosProduits || []).map(n => [n.idProduct, n.numero]));
    // ── publiés, produits par set : la règle d'audit-sets.js:76-83, telle que collecte-cartes/clones.js la recopie (même ordre, mêmes sorties)
    const publies = sets.filter(s => s.nomAffichage !== null && s.nomAffichage !== undefined && String(s.nomAffichage).trim() !== '');
    const setPublie = new Map(publies.map(s => [s._id, s]));
    const setsParExpansion = new Map();
    for (const s of publies) for (const e of [].concat(s.idExpansion ?? [])) (setsParExpansion.get(e) || setsParExpansion.set(e, []).get(e)).push(s);
    const prodsParSet = new Map(publies.map(s => [s._id, []]));
    for (const p of produits) {
        const cands = setsParExpansion.get(p.idExpansion) || [];
        const s = cands.length ? (cands.find(x => x._id === p.setId) || cands[0]) : (p.setId && setPublie.get(p.setId) ? setPublie.get(p.setId) : null);
        if (s) prodsParSet.get(s._id).push({ idProduct: p.idProduct, idExpansion: p.idExpansion, name: p.name, numero: numeroDe.get(p.idProduct) ?? null, slug: null, slugSet: null, sansLigne: !!(p.fiche && p.fiche.classe === 'SANS_LIGNE'), ficheCarteId: p.fiche && p.fiche.carteId != null ? p.fiche.carteId : null, ficheNumero: p.fiche ? p.fiche.numero ?? null : null, ficheSetId: p.fiche ? p.fiche.setId : null });
    }
    const cartesParSet = new Map();
    for (const c of cartes) if (typeof c.nomEn === 'string' && c.nomEn !== '') for (const s of new Set(c.sets || [])) (cartesParSet.get(s) || cartesParSet.set(s, []).get(s)).push(c);
    const lignesParSet = new Map();
    for (const l of lignes) if (l.slugSet) (lignesParSet.get(l.slugSet) || lignesParSet.set(l.slugSet, []).get(l.slugSet)).push({ carteId: l.carteId, idProduct: l.idProduct, numeroFiche: l.numeroFiche ?? null });
    const aEcrire = [], refus = {}, parSet = {}, preuves = {}, refusDetail = [];
    for (const r of RAISONS) refus[r] = 0;
    let auditees = 0, avecLigne = 0, jugees = 0;   // jugées = entrées affichées (carte, numéro) ; avecLigne = refus « déjà couverte »
    for (const s of publies) {
        const membres = (cartesParSet.get(s._id) || []).sort((a, b) => a._id - b._id);
        const prods = prodsParSet.get(s._id);
        if (!membres.length || !prods.length) continue;
        // lignes du set : cartes_produits (slugSet) + produits dont la fiche désigne (carte, set), comme clones.js
        const lignesDuSet = [...(lignesParSet.get(s._id) || [])];
        for (const p of prods) if (p.ficheCarteId !== null && p.ficheSetId === s._id) lignesDuSet.push({ carteId: p.ficheCarteId, idProduct: p.idProduct, numeroFiche: p.ficheNumero ?? null });
        const sansLigne = prods.filter(p => p.sansLigne);
        const cible = { tirage: regles.tirageDuSet(s), expansions: regles.expansionsDuSet(s), deck: s.deck ?? null };
        for (const c of membres) {
            // les ENTRÉES AFFICHÉES de la carte dans ce set, comme audit-sets.js:94-101 : un numéro normalisé par entrée, ou une entrée sans numéro
            const nums = [...new Set((c.impressions || []).filter(i => regles.impressionDuSet(i, cible)).map(i => regles.normaliserNumero(i.numero)).filter(n => n !== null && n !== undefined))];
            const entrees = nums.length ? nums : [null];
            for (const numero of entrees) {
                auditees++;
                jugees++;
                const r = jugerJointure({ carte: c, set: s, produitsSansLigne: sansLigne, produitsDuSet: prods, cartesDuSet: membres, lignesDuSet, regles, numero, nEntreesCarte: entrees.length });
                if (r.refus) {
                    refus[r.refus]++;
                    if (r.refus === 'nom-ambigu' || r.refus === 'nom-inclus-seulement') refusDetail.push({ carteId: c._id, set: s._id, numero, raison: r.refus, nomCarte: c.nomEn, produitsCandidats: candidatsDuRefus(c, sansLigne).map(p => ({ idProduct: p.idProduct, name: p.name, numero: p.numero })) });
                    continue;
                }
                preuves[r.ligne.preuve] = (preuves[r.ligne.preuve] || 0) + 1;
                lignesDuSet.push({ carteId: r.ligne.carteId, idProduct: r.ligne.idProduct, numeroFiche: r.ligne.numeroFiche });
                aEcrire.push({ ...r.ligne, set: s._id, nomEn: c.nomEn });
                parSet[s._id] = (parSet[s._id] || 0) + 1;
            }
        }
    }
    avecLigne = refus['carte-deja-jointe-dans-le-set'];
    const denominateurs = { sets: sets.length, setsPublies: publies.length, cartes: cartes.length, lignes: lignes.length, produits: produits.length, entreesAffichees: auditees, entreesDejaCouvertes: avecLigne, entreesSansLigneJugees: jugees - avecLigne };
    if (jugees !== aEcrire.length + Object.values(refus).reduce((a, b) => a + b, 0)) throw new Error('concordance rompue : jugées ≠ à écrire + refus');
    if (!jugees) throw new Error('aucune entrée jugée : une simulation sur zéro n\'est pas une mesure (§41)');
    console.log(`dénominateurs : ${JSON.stringify(denominateurs)}`);
    // rapprochement avec l'audit du jour : entrées sans produit (causes « produits-sans-ligne… » et « …meme-numero ») contre entrées jugées sans couverture
    try {
        const A = JSON.parse(fs.readFileSync(path.join(DOSSIER, 'AUDIT-SETS.json'), 'utf8'));
        const causes = {}; for (const st of A.sets) for (const it of st.sansProduit.items) causes[it.cause] = (causes[it.cause] || 0) + 1;
        const cibles = (causes['produits-sans-ligne-dans-l-expansion'] || 0) + (causes['produit-sans-ligne-meme-numero'] || 0);
        const restes = Object.fromEntries(Object.entries(refus).filter(([k, v]) => k !== 'carte-deja-jointe-dans-le-set' && v));
        console.log(`RAPPROCHEMENT audit (${A.le || 'date ?'}) : entrées jugées sans couverture ${jugees - avecLigne} · audit sansProduit causes produits-sans-ligne-dans-l-expansion + meme-numero = ${cibles} · toutes causes d'audit ${JSON.stringify(causes)} · à écrire ${aEcrire.length} · reste par raison ${JSON.stringify(restes)}`);
    } catch (e) { console.log(`RAPPROCHEMENT audit impossible : ${String(e.message).slice(0, 120)}`); }
    console.log(`À ÉCRIRE ${aEcrire.length} · par preuve ${JSON.stringify(preuves)} · refus par raison ${JSON.stringify(refus)}`);
    console.log('par set (top 30) :');
    for (const [s, n] of Object.entries(parSet).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 30)) console.log(`   ${s} : ${n}`);
    const dejaDoublon = new Set(), doublons = aEcrire.filter(l => { const k = l._id; if (dejaDoublon.has(k)) return true; dejaDoublon.add(k); return false; });
    if (doublons.length) throw new Error(`${doublons.length} _id en double dans le plan`);
    const parProduit = new Map(); for (const l of aEcrire) parProduit.set(l.idProduct, (parProduit.get(l.idProduct) || 0) + 1);
    const plusieurs = [...parProduit].filter(([, n]) => n > 1).length;
    console.log(`produits visés par plusieurs lignes du plan (même produit dans plusieurs sets exclus : un produit n'a qu'un set) : ${plusieurs}`);
    fs.mkdirSync(DOSSIER_LIENS, { recursive: true });
    const f = autoriser(path.join(DOSSIER_LIENS, 'plan-jointures.json'), [DOSSIER_LIENS]);
    fs.writeFileSync(f, JSON.stringify({ le: new Date().toISOString(), lectureDu: lecture.le, denominateurs, lignes: aEcrire, refus, preuves, parSet }));
    const fd = autoriser(path.join(DOSSIER_LIENS, 'refus-detail.json'), [DOSSIER_LIENS]);
    fs.writeFileSync(fd, JSON.stringify({ le: new Date().toISOString(), lectureDu: lecture.le, n: refusDetail.length, refusDetail }));
    console.log(`refus-detail : ${refusDetail.length} refus (nom-ambigu / nom-inclus-seulement) écrits dans ${fd}`);
    console.log(`SIMULATION (rien d'écrit en base) · écrit ${f} · ${Math.round((Date.now() - t0) / 1000)} s`);
}

async function lancerEcriture() {
    const planArg = val('plan') || path.join(DOSSIER_LIENS, 'plan-jointures.json');
    const plan = JSON.parse(fs.readFileSync(planArg, 'utf8'));
    if (!Array.isArray(plan.lignes) || !plan.lignes.length) throw new Error('plan sans lignes : un zéro n\'est pas une instruction');
    // un idProduct ou un _id deux fois dans le plan : refus AVANT toute connexion
    const vusProd = new Set(), vusId = new Set(), doublons = [];
    for (const l of plan.lignes) { if (vusProd.has(l.idProduct)) doublons.push(`idProduct ${l.idProduct}`); if (vusId.has(l._id)) doublons.push(`_id ${l._id}`); vusProd.add(l.idProduct); vusId.add(l._id); }
    if (doublons.length) { console.error(`❌ REFUS (code 1, rien d'ouvert) : ${doublons.length} doublon(s) dans le plan : ${doublons.slice(0, 10).join(' ; ')}`); process.exitCode = 1; return; }
    const { decisionPerimee } = require('./collecte-cartes/clones');
    const perimee = decisionPerimee(plan.lectureDu);
    if (perimee) { console.error(`❌ REFUS (code 1, rien d'ouvert) : ${perimee}`); process.exitCode = 1; return; }
    if (plan.lignes.length !== attendu) { console.error(`❌ REFUS (code 1, rien d'ouvert) : ${plan.lignes.length} lignes au plan ≠ attendu ${attendu}`); process.exitCode = 1; return; }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: false });
    try {
        const col = cx.cartes.db.collection('cartes_produits');
        const ids = [...new Set(plan.lignes.map(l => l.carteId))], prodIds = [...new Set(plan.lignes.map(l => l.idProduct))];
        const vives = [], vivesProd = [];
        const RAISON = 'une carte ou un produit sans ligne est le cas attendu de ce lot';
        for (const m of morceaux(ids, 500)) vives.push(...await lireMongo(col, { carteId: { $in: m } }, { nom: 'cartes_produits (cartes du plan)', videAutorise: RAISON, projection: { carteId: 1, idProduct: 1, slugSet: 1, idExpansion: 1, numeroFiche: 1 } }));
        for (const m of morceaux(prodIds, 500)) vivesProd.push(...await lireMongo(col, { idProduct: { $in: m } }, { nom: 'cartes_produits (produits du plan)', videAutorise: RAISON, projection: { carteId: 1, idProduct: 1 } }));
        console.log(`état vivant relu : ${vives.length} lignes des ${ids.length} cartes · ${vivesProd.length} lignes des ${prodIds.length} produits`);
        const erreurs = [];
        const produitPris = new Set(vivesProd.map(l => l.idProduct));
        for (const l of plan.lignes) {
            // une carte à plusieurs entrées (numéros) peut recevoir une ligne par entrée : conflit seulement si la ligne vivante couvre CETTE entrée (même numeroFiche, ou l'une des deux sans numeroFiche)
            const cleF = n => (n == null || n === '' ? null : require('./collecte-cartes/jointure').cleNumero(n));
            if (vives.some(v => v.carteId === l.carteId && (v.slugSet === l.slugSet || v.idExpansion === l.idExpansion) && (cleF(v.numeroFiche) === null || cleF(l.numeroFiche) === null || cleF(v.numeroFiche) === cleF(l.numeroFiche)))) erreurs.push(`${l._id} : la carte a désormais une ligne qui couvre cette entrée dans ce set`);
            if (produitPris.has(l.idProduct)) erreurs.push(`${l._id} : le produit a désormais une ligne`);
        }
        if (erreurs.length) {
            console.error(`❌ REFUS (code 1, rien d'écrit) : ${erreurs.length} condition(s) changée(s)`);
            for (const e of erreurs.slice(0, 25)) console.error(`   ${e}`);
            process.exitCode = 1; return;
        }
        // slug / slugSet du produit : numeros_cartes (production, lecture seule) — ils font l'URL Cardmarket et désignent l'entrée d'image (jointure.js:263-275)
        // règle committée collecte-cartes/slug-produit.js : consolider (plusieurs slugs distincts = produit-ambigu) puis slugAPoser (forme autorisée, slugSet-different). Un refus = slug null, compté.
        // Le slugSet de la ligne (celui du set du plan) n'est JAMAIS remplacé par celui de numeros_cartes.
        const { slugAPoser, consolider } = require('./collecte-cartes/slug-produit');
        const parProduit = new Map();
        const NC = cx.prod.db.collection('numeros_cartes');
        for (const m of morceaux(prodIds, 500)) for (const d of await lireMongo(NC, { idProduct: { $in: m } }, { nom: 'numeros_cartes', videAutorise: 'un produit non appris est un cas prévu : slug null', projection: { _id: 0, idProduct: 1, idExpansion: 1, slug: 1, slugSet: 1 } })) (parProduit.get(d.idProduct) || parProduit.set(d.idProduct, []).get(d.idProduct)).push(d);
        const refusSlug = {};
        let slugsPoses = 0;
        const docs = plan.lignes.map(({ set, nomEn, ...l }) => {
            const r = slugAPoser(l, consolider(parProduit.get(l.idProduct)));
            if (r.refus) { refusSlug[r.refus] = (refusSlug[r.refus] || 0) + 1; return { ...l, verifieLe: new Date(l.verifieLe) }; }
            slugsPoses++;
            return { ...l, slug: r.set.slug, verifieLe: new Date(l.verifieLe) };
        });
        console.log(`lignes écrites SANS slug : ${docs.length - slugsPoses} (voulu : le lien viendra d'un apprentissage)`);
        console.log(`slug posé sur ${slugsPoses}/${docs.length} lignes · slug null par raison : ${JSON.stringify(refusSlug)}`);
        let inseres = 0;
        for (const m of morceaux(docs, 500)) {
            try {
                const res = await col.bulkWrite(m.map(document => ({ insertOne: { document } })), { ordered: true });
                inseres += res.insertedCount;
            } catch (e) {
                inseres += (e.result && (e.result.insertedCount ?? e.result.nInserted)) || 0;
                console.error(`❌ ARRÊT : erreur d'écriture (${String(e.message).slice(0, 200)}) · ${inseres} lignes insérées avant l'arrêt — aucun upsert, aucune reprise automatique`);
                process.exitCode = 1; return;
            }
            console.log(`   lot de ${m.length} : ${inseres}/${docs.length} insérées`);
        }
        console.log(`insertedCount ${inseres} (attendu ${attendu})`);
        const relues = await col.countDocuments({ _id: { $in: docs.map(d => d._id) } });
        console.log(`relecture : ${relues}/${docs.length} lignes présentes`);
        if (inseres !== attendu || relues !== docs.length) { console.error('❌ ÉCART entre insertedCount, attendu et relecture'); process.exitCode = 1; return; }
        console.log('ÉCRIT : lignes insérées, relues ✅');
    } finally { await cx.fermer(); }
}

(simuler ? lancerSimulation() : lancerEcriture()).catch(e => { console.error(masquer(e)); process.exitCode = 1; });

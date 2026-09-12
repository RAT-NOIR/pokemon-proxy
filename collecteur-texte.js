// ============================================================
// COLLECTEUR DE TEXTE — Bulbapedia -> base `cartes`, UN SET PAR LANCEMENT
// ============================================================
//   node collecteur-texte.js --set=EXP [--rapport=<dossier>]
//
// Ce qu'il fait, dans l'ordre, et rien d'autre :
//   0. les quatre arrêts durs (garde.js), la table à la main (table-sets.js), le bucket R2 ;
//   1. la page du SET : infobox -> `sets`, wikitext épuré -> R2 ;
//   2. les LIENS de la page du set, filtrés par le motif de titres de la table ;
//   3. le TEXTE de chaque carte, 50 titres par requête, redirections suivies (une page cible = UNE
//      carte) : épuration -> R2 sous pageid/revid, faits -> `cartes` ;
//   4. la JOINTURE n-n avec preuve -> `cartes_produits`, restes -> `restes` ;
//   5. la COMPLÉTUDE : quatre nombres imprimés, restes par type, cinq cartes parsées à côté de leur
//      wikitext épuré, champs nuls par champ. Puis il s'ARRÊTE.
//
// Reprise : l'état est écrit dans `collecte_etat` après chaque unité (page), jamais avant ; au
// redémarrage, les titres déjà traités sont sautés. R2 est idempotent par `pageid/revid`.
// Débit : bulba.js sérialise et espace de 5 s toutes les requêtes, sans exception.
// ⚠️ Un seul set par lancement, et un set NON VÉRIFIÉ dans la table est refusé.

require('dotenv').config();
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const bulba = require('./collecte-cartes/bulba');
const { epurer, faitsDeCarte, faitsDeSet, sectionsSetlist } = require('./collecte-cartes/wikitext');
const { ligne: ligneDeTable, EXPANSIONS_INTL } = require('./collecte-cartes/table-sets');
const { modeles } = require('./collecte-cartes/schemas');
const { joindre, produitsDeLExpansion } = require('./collecte-cartes/jointure');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const VERROU_MS = 10 * 60 * 1000;

let arretDemande = false;
let finirGlobal = null;   // posé dès que le verrou est pris, pour le libérer sur toute erreur
process.on('SIGINT', () => { console.warn('\n⏹️  arrêt demandé : on finit l\'unité en cours, puis on s\'arrête proprement.'); arretDemande = true; });

(async () => {
    const code = arg('set');
    if (!code) { console.error('❌ ARRÊT : --set=<CODE> obligatoire (un seul set par lancement).'); process.exit(1); }
    const L = ligneDeTable(code);
    if (!L) { console.error(`❌ ARRÊT : ${code} n'est pas dans la table à la main (collecte-cartes/table-sets.js).`); process.exit(1); }
    if (!L.verifie) { console.error(`❌ ARRÊT : la ligne ${code} n'est PAS VÉRIFIÉE (titre et motif supposés). On ne collecte pas sur une hypothèse.`); process.exit(1); }
    const dossierRapport = arg('rapport') || path.join(__dirname, 'collecte-cartes', 'rapports');

    const { cartes: cx, prod, fermer } = await ouvrirConnexions();
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    console.log(`📦 R2 : bucket ${process.env.R2_BUCKET_BRUT} joignable.`);

    // ---- verrou : un seul collecteur par set --------------------------------------------
    const slug = L.slugSet;
    const existant = await M.Etat.findById(slug).lean();
    if (existant?.verrou?.depuis && Date.now() - new Date(existant.verrou.depuis).getTime() < VERROU_MS && existant.verrou.pid !== process.pid) {
        console.error(`❌ ARRÊT : un collecteur tient déjà ${slug} (pid ${existant.verrou.pid} sur ${existant.verrou.hote}, depuis ${existant.verrou.depuis}).`);
        await fermer(); process.exit(1);
    }
    await M.Etat.updateOne({ _id: slug }, { $set: { verrou: { pid: process.pid, hote: os.hostname(), depuis: new Date() } }, $setOnInsert: { debute: new Date(), phase: 'set', pages: [], titres: [] } }, { upsert: true });
    const battement = setInterval(() => M.Etat.updateOne({ _id: slug }, { $set: { 'verrou.depuis': new Date() } }).catch(() => { }), 60000);
    const finir = async () => { clearInterval(battement); await M.Etat.updateOne({ _id: slug }, { $unset: { verrou: 1 } }); await fermer(); };
    // Un plantage doit LIBÉRER le verrou : le 2026-09-12, quatre sets plantés sur un `ndex` ou une
    // `retraite` non numérique ont refusé leur propre relance pendant dix minutes. L'unité en cours
    // n'est pas écrite (R2 avant la ligne), donc la reprise est sûre.
    finirGlobal = finir;

    console.log(`\n══ ${L.code} « ${L.nom} » — exp ${L.exp}, ${L.prod} produits, page « ${L.bulba.titre} », attendu ${L.attendu} ══`);
    // L'impression qui rattache une page au set cible : le TIRAGE de la table (japonais par défaut,
    // `intl` pour les sets occidentaux), nom(s) d'expansion, et le deck quand la table en nomme un.
    const TIRAGE = L.bulba.tirage || 'jp';
    const nomsCibles = [].concat(L.bulba.expansion);
    const impressionCible = faits => faits.impressions.find(x => x.tirage === TIRAGE && nomsCibles.includes(x.expansion) && (!L.bulba.deck || x.deck === L.bulba.deck));

    // ---- 1. la page du set -------------------------------------------------------------
    // En --reparser, la page du set est relue depuis R2 elle aussi : zéro requête Bulbapedia.
    const reparser = process.argv.includes('--reparser');
    const setDeja = reparser ? await M.Set.findById(slug).lean() : null;
    let pSet, depotSet;
    if (setDeja?.bulba?.cleR2) {
        pSet = { pageid: setDeja.bulba.pageid, revid: setDeja.bulba.revid, title: setDeja.bulba.titre, content: await r2.lireTexte(process.env.R2_BUCKET_BRUT, setDeja.bulba.cleR2) };
        depotSet = { ecrit: false };
    } else {
        const { pages: pagesSet } = await bulba.revisionsDe([L.bulba.titre]);
        if (!pagesSet.length) { console.error(`❌ page du set introuvable : « ${L.bulba.titre} »`); await finir(); process.exit(1); }
        pSet = pagesSet[0];
        depotSet = await r2.deposerTexte(process.env.R2_BUCKET_BRUT, r2.cleWikitext(pSet.pageid, pSet.revid), epurer(pSet.content));
    }
    const faitsSet = faitsDeSet(pSet.content);
    const cleSet = r2.cleWikitext(pSet.pageid, pSet.revid);
    await M.Set.updateOne({ _id: slug }, {
        $set: {
            code: L.code, idExpansion: [L.exp], nomEn: faitsSet?.nomEn ?? null, nomJa: faitsSet?.nomJa ?? null, nomJaTraduit: faitsSet?.nomJaTraduit ?? null,
            region: TIRAGE === 'jp' ? 'jp' : 'intl', dateSortieJa: faitsSet?.sortieJa ?? null, dateSortieEn: faitsSet?.sortieEn ?? null,
            // Le total imprimé est celui du TIRAGE collecté : `jacards` pour un set japonais, `encards` pour un occidental.
            totalImprime: (TIRAGE === 'jp' ? faitsSet?.cartesJa : faitsSet?.cartesEn) ?? null, cartesEnInfobox: faitsSet?.cartesEn ?? null,
            bulba: { titre: pSet.title, pageid: pSet.pageid, revid: pSet.revid, motifTitres: L.bulba.motifTitres, expansion: L.bulba.expansion, cleR2: cleSet },
            collecteLe: new Date()
        }, $setOnInsert: { version: 1 }
    }, { upsert: true });
    console.log(`1. set : « ${faitsSet?.nomEn} » / ${faitsSet?.nomJa} (${faitsSet?.nomJaTraduit}) — jacards ${faitsSet?.cartesJa}, encards ${faitsSet?.cartesEn}, sortie JP ${faitsSet?.sortieJa} ; R2 ${depotSet.ecrit ? 'écrit' : 'déjà là'} (${cleSet})`);
    if (faitsSet?.cartesJa !== L.attendu) console.warn(`   ⚠️ l'infobox dit ${faitsSet?.cartesJa} cartes, la table attend ${L.attendu}.`);

    // ---- 2. la SETLIST de la page du set : l'autorité de l'appartenance -----------------------
    // Les sections dont le titre est dans `bulba.setlist` (défaut : le nom de l'expansion) ; à
    // défaut, les entrées dont le nom de set reconstruit (« A B ») est ce nom, éventuellement
    // suivi d'un désambiguïsateur numérique. Zéro requête : tout est dans le wikitext déjà lu.
    const etat = await M.Etat.findById(slug).lean();
    let titres = etat.titres?.length ? etat.titres : null;
    const nomsExpansion = [].concat(L.bulba.expansion);
    const nomsSections = L.bulba.setlist === null ? null : (L.bulba.setlist || nomsExpansion);
    const sections = sectionsSetlist(pSet.content);
    let entrees;
    if (L.bulba.setlistMotif) {                                                        // EXS : par motif sur le nom de set reconstruit
        const re = new RegExp(L.bulba.setlistMotif);
        entrees = sections.flatMap(s => s.entrees).filter(e => re.test(e.setReconstruit));
    } else if (nomsSections === null) entrees = sections.flatMap(s => s.entrees);
    else {
        entrees = sections.filter(s => nomsSections.includes(s.titre)).flatMap(s => s.entrees);
        if (!entrees.length) {
            const re = new RegExp(`^(${nomsSections.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})( \\d+)?$`);
            entrees = sections.flatMap(s => s.entrees).filter(e => re.test(e.setReconstruit));
        }
    }
    if (!entrees.length) {
        // Page SANS gabarit Setlist (Intro Pack) : les `{{TCG ID|A|Nom|B}}` se lisent sur tout le
        // wikitext, filtrés par le motif ou les noms — c'est ce que verifier-table.js avait compté.
        const re = L.bulba.setlistMotif ? new RegExp(L.bulba.setlistMotif)
            : new RegExp(`^(${(nomsSections || nomsExpansion).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})( \\d+)?$`);
        entrees = [...pSet.content.matchAll(/\{\{TCG ID\|([^|}]+)\|([^|}]+)(?:\|([^|}]*))?\}\}/g)]
            .map(m => { const a = m[1].trim(), nom = m[2].trim(), b = (m[3] || '').trim() || null; return { titre: b ? `${nom} (${a} ${b})` : `${nom} (${a})`, setReconstruit: b ? `${a} ${b}` : a }; })
            .filter(e => re.test(e.setReconstruit));
        if (entrees.length) console.log(`   (aucune section Setlist : ${entrees.length} entrées TCG ID lues sur tout le wikitext)`);
    }
    if (L.bulba.deck) entrees = entrees.filter(e => e.setReconstruit.startsWith(L.bulba.deck));
    const entreesSetlist = [...new Set([...entrees.map(e => e.titre), ...(L.bulba.titresSupplementaires || [])])];
    // ⚠️ LA TABLE PEUT CHANGER APRÈS UNE COLLECTE, ET L'ÉTAT NE DOIT PAS LA FIGER. Ajouter une
    // section à `setlist` ne produisait RIEN sur un set déjà collecté : `titres` était relu de
    // l'état et la nouvelle section ignorée, EN SILENCE. Mesuré le 2026-09-12 sur PBL. Tout titre
    // que la table désigne aujourd'hui et que l'état ignore est ajouté ; il sera fetché seul, les
    // autres restent « déjà faits ». On ne RETIRE jamais : une page déjà collectée le reste.
    if (titres) {
        const nouveaux = entreesSetlist.filter(t => !titres.includes(t));
        if (nouveaux.length) {
            console.log(`   ⚠️ la table désigne ${nouveaux.length} titre(s) que l'état ignorait — ajoutés : ${nouveaux.slice(0, 5).join(' · ')}${nouveaux.length > 5 ? ' …' : ''}`);
            titres = [...new Set([...titres, ...nouveaux])];
            await M.Etat.updateOne({ _id: slug }, { $set: { titres } });
        }
    }
    if (!titres) {
        if (!entreesSetlist.length) {
            console.error(`❌ ${L.code} : aucune entrée de Setlist pour ${JSON.stringify(nomsSections)}. Sections vues : ${sections.map(s => `« ${s.titre} » ×${s.entrees.length}`).join(' · ')}`);
            await M.Etat.updateOne({ _id: slug }, { $set: { phase: 'setlist-vide', sectionsVues: sections.map(s => ({ titre: s.titre, n: s.entrees.length })) } });
            await finir(); process.exit(1);
        }
        titres = entreesSetlist;
        await M.Etat.updateOne({ _id: slug }, { $set: { titres, phase: 'liens', sectionsVues: sections.map(s => ({ titre: s.titre, n: s.entrees.length })) } });
    }
    console.log(`2. setlist : sections ${sections.map(s => `« ${s.titre} » ×${s.entrees.length}`).join(' · ')} → ${entreesSetlist.length} titres retenus${etat.titres?.length ? ' (repris de l\'état : ' + titres.length + ')' : ''}`);

    // ---- 3. le texte, par lots de 50, reprise par titre ------------------------------------
    const dejaFaits = new Set((etat.pages || []).map(p => p.titre));
    let aFaire = titres.filter(t => !dejaFaits.has(t));
    console.log(`3. texte : ${aFaire.length} titres à traiter, ${dejaFaits.size} déjà faits.`);
    // 🔴 `--reparser` PROMET ZÉRO REQUÊTE, ET IL EN FAISAIT 3 (102 pages refetchées sur EXP,
    // 2026-09-12). Les titres ajoutés par la table sont des ALIAS qui redirigent vers des pages déjà
    // archivées : ils n'étaient pas dans `pages`, donc « à faire ». Un rejeu qui refetche n'est plus
    // un rejeu, et une promesse imprimée qui diffère du comportement est la faute du dépôt.
    // Le nombre écarté s'IMPRIME — on ne remplace pas une requête par un silence.
    if (reparser && aFaire.length) {
        console.log(`   --reparser : ${aFaire.length} titre(s) non archivés sont ÉCARTÉS (zéro requête). Les collecter demande un lancement sans --reparser.`);
        aFaire = [];
    }
    const textesEpures = new Map();       // pageid -> épuré (pour le rapport)
    let ecrites = 0, r2Ecrits = 0, manquants = 0;
    const redirigeDepuisTout = new Map(); // cible -> [sources]

    // ---- LES DÉNOMINATEURS APPARIÉS -------------------------------------------------------
    // 🔑 « Un dénominateur n'est utile que s'il est CONFRONTÉ. » Chacun de ces compteurs n'a de sens
    // qu'en FACE d'un autre, et chaque paire porte son verdict imprimé. Un nombre seul ne dit rien :
    // « 128 impressions » est rassurant, « 128 impressions pour 133 entrées vues » est un défaut.
    const D = {
        entreesExp: 0, impressionsRendues: 0, pagesSansEntree: 0,       // paire 1 — faitsDeCarte()
        jeuVideo: 0, nonRendues: new Map(),
        epure: {},                                                       // paire 2 — epurer()
        champsAGabarit: new Map(), cartesAGabarit: 0                     // paire 3 — le parse rendu
    };
    const compter = faits => {
        D.pagesComptees = (D.pagesComptees || 0) + 1;
        D.entreesExp += faits.entreesVues || 0;
        D.impressionsRendues += (faits.impressions || []).length;
        D.jeuVideo += faits.entreesJeuVideo || 0;
        for (const c of faits.entreesNonRendues || []) D.nonRendues.set(c, (D.nonRendues.get(c) || 0) + 1);
        if (!faits.entreesVues) D.pagesSansEntree++;
        if ((faits.champsAGabarit || []).length) D.cartesAGabarit++;
        for (const c of faits.champsAGabarit || []) D.champsAGabarit.set(c, (D.champsAGabarit.get(c) || 0) + 1);
    };

    // ---- 3 bis. --reparser : rejouer le parseur sur l'archive R2, SANS refetcher ------------
    // C'est l'assurance contre le champ oublié, exercée : un défaut de parse se corrige en
    // relisant l'archive épurée (les faits y sont tous), pas en redemandant les pages.
    if (process.argv.includes('--reparser')) {
        const deja = await M.Carte.find({ sets: slug }).select('_id bulba').lean();
        console.log(`   --reparser : ${deja.length} cartes relues depuis R2, 0 requête Bulbapedia.`);
        for (const c of deja) {
            const epure = await r2.lireTexte(process.env.R2_BUCKET_BRUT, c.bulba.cleR2);
            const faits = faitsDeCarte(epure);
            compter(faits);
            const impCible = impressionCible(faits);
            const { champsNuls, ...champs } = faits;
            await M.Carte.updateOne({ _id: c._id }, { $set: { ...champs, rarete: impCible?.rarete ?? null, champsNuls, reparseLe: new Date() } });
            textesEpures.set(c._id, epure);
        }
        // ⚠️ SEULEMENT les lignes de CE set (et de ses jumelles occidentales) : une carte partagée
        // entre deux sets (Dark Charizard, Rocket Gang ET Pokémon Web) perdait ses lignes de l'autre
        // set à chaque rejeu — H006 est sorti « faux affirmé » de la mesure du pont pour ça, 2026-09-12.
        const expsDeCeSet = [L.exp, ...Object.values(EXPANSIONS_INTL)];
        const idsCartes = deja.map(c => c._id);
        await M.CarteProduit.deleteMany({ carteId: { $in: idsCartes }, idExpansion: { $in: expsDeCeSet } });
        // les liens dénormalisés se recomposent depuis ce qui RESTE en cartes_produits
        for (const id of idsCartes) {
            const restants = (await M.CarteProduit.find({ carteId: id }).select('idProduct').lean()).map(x => x.idProduct);
            await M.Carte.updateOne({ _id: id }, { $set: { 'liens.idProduct': restants, 'liens.idMetacards': [] }, $unset: { 'liens.idMetacard': 1 } });
        }
    }
    for (let i = 0; i < aFaire.length && !arretDemande; i += 50) {
        const lot = aFaire.slice(i, i + 50);
        const { pages, redirections, manquantes } = await bulba.revisionsDe(lot);
        for (const [de, vers] of redirections) { if (!redirigeDepuisTout.has(vers)) redirigeDepuisTout.set(vers, []); redirigeDepuisTout.get(vers).push(de); }
        for (const t of manquantes) {
            manquants++;
            await M.Reste.updateOne({ set: slug, type: 'titre-manquant', detail: t }, { $set: { le: new Date() } }, { upsert: true });
            await M.Etat.updateOne({ _id: slug }, { $push: { pages: { titre: t, pageid: null, revid: null, etat: 'manquant' } } });
        }
        for (const pg of pages) {
            const epure = epurer(pg.content, D.epure);
            const cle = r2.cleWikitext(pg.pageid, pg.revid);
            const depot = await r2.deposerTexte(process.env.R2_BUCKET_BRUT, cle, epure);   // R2 AVANT la ligne
            if (depot.ecrit) r2Ecrits++;
            const faits = faitsDeCarte(pg.content);
            compter(faits);
            const impCible = impressionCible(faits);
            const { champsNuls, ...champs } = faits;
            await M.Carte.updateOne({ _id: pg.pageid }, {
                $set: {
                    ...champs, rarete: impCible?.rarete ?? null, champsNuls,
                    bulba: { titre: pg.title, pageid: pg.pageid, revid: pg.revid, redirigeDepuis: redirigeDepuisTout.get(pg.title) || [], cleR2: cle },
                    collecteLe: new Date()
                },
                $addToSet: { sets: slug }, $setOnInsert: { version: 1, liens: { idProduct: [], idMetacards: [] } }
            }, { upsert: true });
            ecrites++;
            textesEpures.set(pg.pageid, epure);
            // l'état APRÈS l'unité : les titres du lot qui ont mené à cette page (cible + redirigés)
            const titresDeCettePage = [pg.title, ...(redirigeDepuisTout.get(pg.title) || [])].filter(t => lot.includes(t));
            await M.Etat.updateOne({ _id: slug }, {
                $push: { pages: { $each: titresDeCettePage.map(t => ({ titre: t, pageid: pg.pageid, revid: pg.revid, etat: 'ok' })) } },
                $set: { phase: 'texte', derniereRequete: new Date(), requetes: bulba.compteRequetes() }
            });
        }
        console.log(`   lot ${Math.floor(i / 50) + 1} : ${pages.length} pages, ${redirections.size} redirections, ${manquantes.length} manquantes`);
    }
    if (arretDemande) { console.warn('⏹️  arrêté avant la jointure ; relancer reprend au premier titre non traité.'); await finir(); process.exit(0); }

    // ---- 4. la jointure ---------------------------------------------------------------------
    const cartesDuSet = await M.Carte.find({ sets: slug }).lean();
    const produits = await produitsDeLExpansion(prod, L.exp);
    const J = joindre(cartesDuSet, produits, { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, tirage: TIRAGE });
    for (const l of J.lignes) await M.CarteProduit.updateOne({ _id: l._id }, { $set: l }, { upsert: true });
    await M.Reste.deleteMany({ set: slug, type: { $in: ['produit-sans-carte', 'carte-sans-produit', 'produit-vers-plusieurs-cartes'] } });
    if (J.restes.length) await M.Reste.insertMany(J.restes.map(r => ({ ...r, set: slug, le: new Date() })));
    // liens dénormalisés sur la carte : produits joints, et leurs MÉTACARTES distinctes (le champ
    // singulier `idMetacard`, déclaré et jamais rempli, est retiré au passage).
    const metaDe = new Map(produits.map(p => [p.idProduct, p.idMetacard]));
    const parCarte = new Map();
    for (const l of J.lignes) { if (!parCarte.has(l.carteId)) parCarte.set(l.carteId, []); parCarte.get(l.carteId).push(l.idProduct); }
    for (const [carteId, ids] of parCarte) {
        const metas = [...new Set(ids.map(id => metaDe.get(id)).filter(m => m != null))];
        await M.Carte.updateOne({ _id: carteId }, { $addToSet: { 'liens.idProduct': { $each: ids }, 'liens.idMetacards': { $each: metas } }, $unset: { 'liens.idMetacard': 1 } });
    }
    // bonus : les expansions OCCIDENTALES jumelles nommées par ces pages (non comptées dans la
    // complétude). ⚠️ Seulement depuis un set JAPONAIS : sur un set occidental, le « jumeau » serait
    // le japonais, et il est déjà collecté par sa propre ligne de table.
    let intlLignes = 0;
    for (const [nomIntl, idExpIntl] of (TIRAGE === 'jp' ? Object.entries(EXPANSIONS_INTL) : [])) {
        if (!cartesDuSet.some(c => (c.impressions || []).some(i => i.tirage === 'intl' && i.expansion === nomIntl))) continue;
        const prodIntl = await produitsDeLExpansion(prod, idExpIntl);
        const Ji = joindre(cartesDuSet, prodIntl, { idExpansion: idExpIntl, expansionBulba: nomIntl, tirage: 'intl' });
        for (const l of Ji.lignes) await M.CarteProduit.updateOne({ _id: l._id }, { $set: l }, { upsert: true });
        const metaIntl = new Map(prodIntl.map(p => [p.idProduct, p.idMetacard]));
        for (const l of Ji.lignes) await M.Carte.updateOne({ _id: l.carteId }, { $addToSet: { 'liens.idProduct': l.idProduct, ...(metaIntl.get(l.idProduct) != null ? { 'liens.idMetacards': metaIntl.get(l.idProduct) } : {}) } });
        intlLignes += Ji.lignes.length;
        console.log(`   bonus intl « ${nomIntl} » (exp ${idExpIntl}) : ${Ji.lignes.length} lignes sur ${prodIntl.length} produits, ${Ji.restes.length} restes non écrits`);
    }
    await M.Etat.updateOne({ _id: slug }, { $set: { phase: 'jointure' } });

    // ---- 5. complétude ----------------------------------------------------------------------
    const pagesDistinctes = cartesDuSet.length;
    const cartesEcrites = await M.Carte.countDocuments({ sets: slug });
    const restesParType = {};
    for (const r of J.restes) restesParType[r.type] = (restesParType[r.type] || 0) + 1;
    if (manquants) restesParType['titre-manquant'] = manquants;
    const produitsRestes = (restesParType['produit-sans-carte'] || 0);
    // LA DÉFINITION DU CONTRÔLE, corrigée le 2026-09-12 après six faux ❌. La Setlist compte des
    // TIRAGES ; une page compte une CARTE. Sur les e-Card, une carte porte deux numéros (holo 033,
    // non-holo 065) : 128 entrées pour 96 pages est NORMAL, et un contrôle qui crie sur un cas normal
    // sera contourné. La concordance porte donc sur trois égalités qui, elles, n'ont pas de raison
    // d'être fausses : (1) toutes les entrées de la Setlist ont résolu vers une page ; (2) pages
    // distinctes = cartes écrites ; (3) produits = joints + restes. Le rapport tirages / cartes
    // s'imprime à côté, avec le compte des IMPRESSIONS du set portées par les pages, qui doit
    // retrouver les entrées de la Setlist (128 = 128) — c'est lui qui vérifie l'énumération.
    const impressionsDuSet = cartesDuSet.reduce((a, c) => {
        const imps = (c.impressions || []).filter(x => x.tirage === TIRAGE && nomsCibles.includes(x.expansion) && (!L.bulba.deck || x.deck === L.bulba.deck));
        return a + Math.max(1, new Set(imps.map(i => i.numero ?? '')).size);
    }, 0);
    const complet = {
        setlist: entreesSetlist.length, impressions: impressionsDuSet, infobox: (TIRAGE === 'jp' ? faitsSet?.cartesJa : faitsSet?.cartesEn) ?? null, titresLies: titres.length, titresManquants: manquants, pagesDistinctes, cartesEcrites,
        produits: produits.length, produitsJoints: J.compte.produitsJoints, lignesJointure: J.lignes.length, restes: restesParType,
        preuves: J.lignes.reduce((a, l) => (a[l.preuve] = (a[l.preuve] || 0) + 1, a), {}),
        concordance: manquants === 0 && pagesDistinctes === cartesEcrites && produits.length === J.compte.produitsJoints + produitsRestes,
        tiragesParCarte: pagesDistinctes ? +(entreesSetlist.length / pagesDistinctes).toFixed(2) : null,
        verifieLe: new Date()
    };
    await M.Set.updateOne({ _id: slug }, { $set: { complet, entreesSetlist: entreesSetlist.length } });
    await M.Etat.updateOne({ _id: slug }, { $set: { phase: 'verifie', fini: new Date(), requetes: bulba.compteRequetes() } });

    const nuls = {};
    for (const c of cartesDuSet) for (const k of c.champsNuls || []) nuls[k] = (nuls[k] || 0) + 1;

    console.log(`\n════ COMPLÉTUDE ${L.code} — dénominateur : ${produits.length} produits Cardmarket, ${titres.length} titres de Setlist ════`);
    console.log(`   entrées de la Setlist (tirages) : ${entreesSetlist.length}  ·  impressions du set sur les pages : ${impressionsDuSet}${impressionsDuSet !== entreesSetlist.length ? '  ⚠️ diffèrent' : ''}  (infobox ${TIRAGE === 'jp' ? 'jacards' : 'encards'} : ${complet.infobox ?? '—'})`);
    console.log(`   pages distinctes = cartes    : ${pagesDistinctes} = ${cartesEcrites}${entreesSetlist.length !== pagesDistinctes ? `   (${complet.tiragesParCarte} tirage(s) par carte : normal quand une carte porte plusieurs numéros)` : ''}`);
    console.log(`   titres manquants             : ${manquants}`);
    console.log(`   produits = joints + restes   : ${produits.length} = ${J.compte.produitsJoints} + ${produitsRestes}  ${complet.concordance ? '✅ concordants' : '❌ NON concordants'}`);
    console.log(`   lignes de jointure (${TIRAGE})    : ${J.lignes.length}  ·  preuves : ${JSON.stringify(J.lignes.reduce((a, l) => (a[l.preuve] = (a[l.preuve] || 0) + 1, a), {}))}  ·  bonus intl : ${intlLignes}`);
    console.log(`   restes par type              : ${JSON.stringify(restesParType)}`);
    for (const r of J.restes) console.log(`      · ${r.type} : ${r.detail}`);
    console.log(`   champs nuls (sur ${cartesDuSet.length} cartes) : ${JSON.stringify(nuls)}`);
    console.log(`   requêtes Bulbapedia : ${bulba.compteRequetes()} · R2 écrits : ${r2Ecrits + (depotSet.ecrit ? 1 : 0)}`);

    // ---- LES CINQ DÉNOMINATEURS APPARIÉS, chacun avec son VERDICT -----------------------------
    // Aucun de ces nombres ne se lit seul. Chaque ligne dit ce qui est ENTRÉ, ce qui est SORTI, et
    // si l'écart est normal ou non — c'est la seule forme qui aurait attrapé les quatre défauts
    // silencieux du 2026-09-12 (33 cartes muettes, `{{j|151}}`, S04, slug absent).
    const pagesParsees = (D.pagesComptees || 0) > 0;
    const avecDeuxSlugs = J.lignes.filter(l => l.slug && l.slugSet).length;
    const avecAucunSlug = J.lignes.filter(l => !l.slug && !l.slugSet).length;
    const produitsAvecSlug = produits.filter(p => p.slug && p.slugSet).length;
    const verdict = (ok, bon, mauvais) => ok ? `✅ ${bon}` : `❌ ${mauvais}`;
    console.log(`\n──── DÉNOMINATEURS APPARIÉS ${L.code} ────`);
    if (pagesParsees) {
        const nonRendues = [...D.nonRendues.values()].reduce((a, b) => a + b, 0);
        console.log(`   1. faitsDeCarte()  entrées /Expansion vues : ${D.entreesExp}  ·  impressions rendues : ${D.impressionsRendues}  ·  écartées jeu vidéo (gbset) : ${D.jeuVideo}  ·  NON RENDUES : ${nonRendues}`);
        console.log(`      ${verdict(D.pagesSansEntree === 0, `toute page parsée porte au moins une entrée d'expansion`, `${D.pagesSansEntree} page(s) parsée(s) SANS aucune entrée d'expansion — elles n'appartiendront à aucun set`)}`);
        console.log(`      ${verdict(nonRendues === 0, `aucune impression physique perdue par le parseur`, `${nonRendues} entrée(s) d'impression PHYSIQUE non rendues : ${[...D.nonRendues].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `×${n} {${k}}`).join(' · ')}`)}`);
    } else console.log(`   1. faitsDeCarte()  — aucune page parsée ce tour (tout était déjà fait) : rien à confronter.`);
    if (D.epure.pages) {
        console.log(`   2. epurer()        ${D.epure.pages} pages · ${D.epure.gabarits} gabarits vus · ${D.epure.paramsVides} paramètres de PROSE vidés · ${D.epure.octetsAvant} → ${D.epure.octetsApres} octets (${(100 * D.epure.octetsApres / D.epure.octetsAvant).toFixed(1)} %)`);
        console.log(`      ⚠️ ce compteur porte sur la PROSE retirée, pas sur les gabarits restants : il n'aurait PAS vu {{j|151}}. C'est la paire 3 qui le voit.`);
    } else console.log(`   2. epurer()        — non exercé ce tour (lecture depuis R2, texte déjà épuré).`);
    console.log(`   3. gabarits restants  cartes portant un champ à « {{ }} » : ${D.cartesAGabarit} / ${D.pagesComptees || 0} parsées  ·  par chemin : ${JSON.stringify(Object.fromEntries(D.champsAGabarit))}`);
    console.log(`      ${verdict(D.cartesAGabarit === 0, 'aucun gabarit non développé ne part en base', `${D.cartesAGabarit} carte(s) porteraient un gabarit brut jusqu'au HTML du site`)}`);
    console.log(`   4. clé de numéro   produits du catalogue : ${produits.length}  ·  portant un numéro : ${produits.filter(p => p.numero != null && String(p.numero).trim() !== '').length}  ·  lignes prouvées « set+numero » : ${complet.preuves['set+numero'] || 0}`);
    console.log(`      ${verdict(produits.length === J.compte.produitsJoints + produitsRestes, 'produits = joints + restes', 'un produit est compté deux fois ou perdu')}`);
    console.log(`   5. lien Cardmarket lignes de jointure : ${J.lignes.length}  ·  portant slug ET slugSet : ${avecDeuxSlugs}  ·  n'en portant AUCUN : ${avecAucunSlug}  (le catalogue en a ${produitsAvecSlug} / ${produits.length})`);
    console.log(`      ${verdict(avecAucunSlug === 0, 'toute ligne peut fabriquer son URL Cardmarket', `${avecAucunSlug} ligne(s) sans lien — produits appris par un chemin qui n'enregistre pas le slug (CLAUDE.md §6)`)}`);
    await M.Set.updateOne({ _id: slug }, { $set: { denominateurs: {
        pagesParsees: D.pagesComptees || 0, entreesExpansionVues: D.entreesExp, impressionsRendues: D.impressionsRendues,
        pagesSansEntree: D.pagesSansEntree, entreesJeuVideo: D.jeuVideo, entreesNonRendues: Object.fromEntries(D.nonRendues),
        epure: D.epure, cartesAGabarit: D.cartesAGabarit,
        champsAGabarit: Object.fromEntries(D.champsAGabarit),
        lignes: J.lignes.length, lignesAvecSlug: avecDeuxSlugs, lignesSansSlug: avecAucunSlug,
        produitsAvecSlug, produits: produits.length, le: new Date()
    } } });

    // ---- rapport : cinq cartes au hasard, champs à côté du wikitext épuré ---------------------
    fs.mkdirSync(dossierRapport, { recursive: true });
    const cheminRapport = path.join(dossierRapport, `${L.code}-${new Date().toISOString().slice(0, 10)}.md`);
    const tirage = [...cartesDuSet].sort(() => Math.random() - 0.5).slice(0, 5);
    const lignesR = [`# Rapport ${L.code} — ${new Date().toISOString()}`, '', '```json', JSON.stringify({ complet, nuls }, null, 1), '```', ''];
    for (const c of tirage) {
        const { bulba: b, ...reste } = c;
        lignesR.push(`## ${b.titre} (pageid ${b.pageid}, revid ${b.revid})`, '', '```json', JSON.stringify({ ...reste, bulba: b }, null, 1), '```', '', '```wikitext', textesEpures.get(c._id) || '(wikitext non rechargé : page déjà collectée à un lancement précédent — voir R2 ' + b.cleR2 + ')', '```', '');
    }
    fs.writeFileSync(cheminRapport, lignesR.join('\n'), 'utf8');
    console.log(`\n📄 rapport : ${cheminRapport}`);
    console.log('\n⏹️  Un seul set par lancement : arrêt ici, relecture avant le suivant.');
    await finir();
})().catch(async e => { console.error('❌ ERREUR', e); if (finirGlobal) { try { await finirGlobal(); } catch (_) { } } process.exit(1); });

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
const { epurer, faitsDeCarte, faitsDeSet, entreesDeLaSetlist, natureIgnoree } = require('./collecte-cartes/wikitext');
const { ligne: ligneDeTable, EXPANSIONS_INTL } = require('./collecte-cartes/table-sets');
const { modeles } = require('./collecte-cartes/schemas');
const { joindre, produitsDeLExpansion, impressionsDepuisSetlist, cleNumero } = require('./collecte-cartes/jointure');
const { ecrireJointure } = require('./collecte-cartes/ecrire-jointure');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { reporterChampsPoses } = require('./collecte-cartes/impressions-posees');
const { gardeNomSeul } = require('./collecte-cartes/garde-nom-seul');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const VERROU_MS = 10 * 60 * 1000;

let arretDemande = false;
let finirGlobal = null;   // posé dès que le verrou est pris, pour le libérer sur toute erreur
process.on('SIGINT', () => { console.warn('\n⏹️  arrêt demandé : on finit l\'unité en cours, puis on s\'arrête proprement.'); arretDemande = true; });
// SIGTERM comme SIGINT, et AUCUN rendu de verrou dans le gestionnaire : il se rend après l'unité (verrou-source.js).
process.on('SIGTERM', () => { console.warn('\n⏹️  SIGTERM : on finit l\'unité en cours.'); arretDemande = true; });
const surPerte = () => { arretDemande = true; process.exitCode = 1; };
const VERROU_GLOBAL_BULBA_MS = 3 * 60 * 1000;
const ATTENTE_VERROU_MS = 30 * 1000;

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

    // ---- verrous ---------------------------------------------------------------------------
    // 🔴 DEUX VERROUS, ET LE PREMIER MANQUAIT JUSQU'AU 2026-09-14. Le collecteur de texte frappe Bulbapedia
    // comme le collecteur d'images Bulbapedia, et il ne prenait AUCUN verrou global : les deux pouvaient
    // doubler la cadence chez le même serveur (§17). Il prend désormais `bulbapedia/__collecteur__`, le
    // même que collecteur-images-bulba.js. `--reparser` ne sort pas de chez nous : pas de verrou global.
    // Et le verrou de SET passe sur verrou-source.js — l'ancien excluait `pid === process.pid` (pid 52 sur
    // tous les pods Render) et se libérait par `_id` seul : les défauts corrigés dans d9d4767 côté images.
    // 🔴 L'IDENTITÉ DU SET NE PEUT PAS ÊTRE UNE COLONNE FACULTATIVE — mesuré le 2026-09-20. `slug` sert à
    // TROIS choses : le nom du verrou de set, l'`_id` de `collecte_etat`, et le slugSet de repli des
    // produits qui n'en portent pas. Les deux premières doivent exister TOUJOURS ; la troisième doit
    // rester VIDE quand Cardmarket n'a pas de slug, sinon on invente une donnée de la source.
    // L'expansion `AQ` (Aquapolis, 177 produits) n'a de slugSet sur AUCUNE de ses lignes : le verrou
    // s'appelait alors « null », `collecte_etat` recevait un document d'`_id` null, et le lancement
    // suivant s'arrêtait sur « un collecteur tient déjà null ». Un identifiant facultatif n'est pas un
    // identifiant.
    const slug = L.slugSet || L.code;          // l'IDENTITÉ : verrou, `sets._id`, `collecte_etat._id`, `cartes.sets`, `restes.set`
    const slugCardmarket = L.slugSet || null;  // le vrai slug de la SOURCE, ou rien — jamais un substitut
    // 🔑 LE VERROU GLOBAL PROTÈGE UNE PROMESSE FAITE À BULBAPEDIA (1 requête / 5 s) : il n'a de sens que
    // pour un traitement qui SORT de chez nous. `--reparser` relit R2, et une ligne `sansPage` prend ses
    // cartes dans notre propre base — aucun des deux ne frappe Bulbapedia, aucun des deux ne prend le
    // verrou. C'est ce qui permet de collecter ces sets PENDANT que le worker d'images le tient.
    const reparserSeul = process.argv.includes('--reparser') || !!L.bulba.sansPage;
    const verrouGlobal = reparserSeul ? null : fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: VERROU_GLOBAL_BULBA_MS, surInsertion: { phase: 'collecteur' }, surPerte, nom: 'verrou global bulbapedia (texte)' });
    for (let essai = 0; verrouGlobal; essai++) {
        const tenu = await verrouGlobal.prendre();
        if (!tenu) break;
        const msg = `verrou global bulbapedia tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s)`;
        if (!process.argv.includes('--attendre')) { console.error(`❌ ARRÊT : ${msg}. « 1 requête / 5 s, jamais en parallèle » se compte chez Bulbapedia.`); await fermer(); process.exit(1); }
        if (essai === 0) console.log(`⏳ ${msg} — j'attends, ${ATTENTE_VERROU_MS / 1000} s entre deux essais.`);
        if (arretDemande) { await fermer(); process.exit(1); }
        await new Promise(r => setTimeout(r, ATTENTE_VERROU_MS));
    }
    const verrouSet = fabriquerVerrou({ Modele: M.Etat, id: slug, dureeMs: VERROU_MS, surInsertion: { debute: new Date(), phase: 'set', pages: [], titres: [] }, surPerte, nom: `verrou de set texte ${slug}` });
    const tenuSet = await verrouSet.prendre();
    if (tenuSet) {
        console.error(`❌ ARRÊT : un collecteur tient déjà ${slug} (pid ${tenuSet.pid} sur ${tenuSet.hote}, battement il y a ${tenuSet.ageS} s).`);
        if (verrouGlobal) await verrouGlobal.rendre();
        await fermer(); process.exit(1);
    }
    const finir = async () => { await verrouSet.rendre(); if (verrouGlobal) await verrouGlobal.rendre(); await fermer(); };
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

    // ---- 0. LA COLLECTE SANS PAGE : les cartes prises par l'expansion QU'ELLES DÉCLARENT ----
    // 🔑 CE QUE CE CHEMIN RÉPARE. Notre énumération part toujours de la Setlist d'une PAGE DE SET. Des
    // dizaines d'expansions Cardmarket n'ont pas de page à elles — decks, coffrets, starter sets : leurs
    // cartes sont listées, quand elles le sont, sur une page COLLECTIVE (« Terastal Starter Sets (TCG) »)
    // sous une section au nom du deck, ou nulle part. Elles ont donc été classées « irréductibles ».
    // Elles ne le sont pas : nos propres pages, déjà collectées, DÉCLARENT l'expansion dans `jpexpansion=`
    // — 118 noms d'expansion que la table ignore, mesurés le 2026-09-19. L'énumération se retourne : au
    // lieu de demander à un set quelles cartes il contient, on demande aux cartes à quel set elles
    // appartiennent. ZÉRO requête Bulbapedia, zéro page nouvelle, la même jointure ensuite.
    //
    // ⚠️ CE CHEMIN NE COLLECTE AUCUNE CARTE. Il ne voit que ce qui est déjà en base : une carte de ce deck
    // dont aucune page n'a encore été lue restera un « produit-sans-carte », et c'est le bon résultat —
    // un reste nommé, pas un silence. Le contrôle qui le dit est imprimé : combien des numéros Cardmarket
    // sont couverts par les impressions déclarées.
    if (L.bulba.sansPage) {
        const cartesDuSet = await M.Carte.find({ impressions: { $elemMatch: { tirage: TIRAGE, expansion: { $in: nomsCibles } } } }).lean();
        const produits = await produitsDeLExpansion(prod, L.exp);
        console.log(`0. sans page : ${cartesDuSet.length} cartes de la base déclarent ${JSON.stringify(nomsCibles)} en ${TIRAGE} · ${produits.length} produits Cardmarket · 0 requête`);
        let J = joindre(cartesDuSet, produits, { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, tirage: TIRAGE, slugSet: slugCardmarket });
        // `nomSeul` : une expansion SANS AUCUN numéro (Unnumbered Promos) ne se joint que par le nom. La garde bidirectionnelle
        // calibrée (collecte-cartes/garde-nom-seul.js : 21 925 justes, 0 faux) décide ; ce qu'elle refuse reste un produit sans
        // carte, AVEC sa raison — un refus nommé, pas un silence.
        if (L.bulba.nomSeul) {
            const G = gardeNomSeul({ lignes: J.lignes, produits, cartes: cartesDuSet });
            const nomDe = new Map(produits.map(p => [p.idProduct, p.nom]));
            J = { ...J, lignes: G.gardees, restes: [...J.restes, ...G.refusees.map(r => ({ type: 'produit-sans-carte', detail: `${r.idProduct} « ${nomDe.get(r.idProduct)} » n°— — nom seul refusé : ${r.raison}` }))],
                compte: { ...J.compte, produitsJoints: new Set(G.gardees.map(l => l.idProduct)).size } };
            console.log(`   garde du nom seul : ${new Set(G.gardees.map(l => l.idProduct)).size} produits gardés · ${G.refusees.length} refusés (${JSON.stringify(G.refusees.reduce((a, r) => { const k = r.raison.replace(/\d+/g, 'N'); a[k] = (a[k] || 0) + 1; return a; }, {}))})`);
        }
        const ecrit = await ecrireJointure(M, { slug, J, produits });
        // Le set existe pour le site : son nom vient de l'expansion que NOS pages déclarent, pas d'une
        // page de set qu'on n'a pas. `bulba.titre` reste null — on n'invente pas une source.
        await M.Set.updateOne({ _id: slug }, {
            $set: {
                code: L.code, idExpansion: [L.exp], nomEn: TIRAGE === 'intl' ? nomsCibles[0] : null, nomJa: null, nomJaTraduit: null,
                // `tirage` (2026-09-24) : la clé exacte des impressions du set (`zh-hans`, `id`, `th`…) — `region` ne dit que jp/intl
                region: TIRAGE === 'jp' ? 'jp' : 'intl', tirage: TIRAGE, totalImprime: null,
                bulba: { titre: null, expansion: L.bulba.expansion, motifTitres: 'sans page : cartes prises par l\'expansion déclarée sur leurs propres pages' },
                collecteLe: new Date()
            }, $setOnInsert: { version: 1 }
        }, { upsert: true });
        const restesParType = {};
        for (const r of J.restes) restesParType[r.type] = (restesParType[r.type] || 0) + 1;
        const joints = new Set(J.lignes.map(l => l.idProduct)).size;
        await M.Etat.updateOne({ _id: slug }, { $set: { phase: 'jointure', sansPage: true, cartesVues: cartesDuSet.length, joints, restes: restesParType, fin: new Date() } });
        console.log(`   jointure : ${ecrit.lignes} lignes · ${joints}/${produits.length} produits joints (${(joints / (produits.length || 1) * 100).toFixed(1)} %) · ${ecrit.cartes} cartes · restes ${JSON.stringify(restesParType)}`);
        console.log(joints === produits.length ? `   ✅ tous les produits de l'expansion sont joints` : `   ⚠️ ${produits.length - joints} produit(s) sans carte : leur page n'est pas encore en base, ou n'existe pas`);
        await finir(); return;
    }

    // ---- 1. la page du set -------------------------------------------------------------
    // En --reparser, la page du set est relue depuis R2 elle aussi : zéro requête Bulbapedia.
    const reparser = process.argv.includes('--reparser');
    const setDeja = reparser ? await M.Set.findById(slug).lean() : null;
    // UNE condition pour lire la page sur R2 ET pour le dire dans l'état (`lectureSetlist.source`) — §21 bis.
    const pageDuSetSurR2 = !!setDeja?.bulba?.cleR2;
    let pSet, depotSet;
    if (pageDuSetSurR2) {
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
            // `tirage` (2026-09-24) : la clé exacte des impressions du set (`zh-hans`, `id`, `th`…) — `region` ne dit que jp/intl
            region: TIRAGE === 'jp' ? 'jp' : 'intl', tirage: TIRAGE, dateSortieJa: faitsSet?.sortieJa ?? null, dateSortieEn: faitsSet?.sortieEn ?? null,
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
    // La sélection vit dans wikitext.js (`entreesDeLaSetlist`) : verifier-table.js --auto juge une ligne
    // avec la MÊME fonction. Deux définitions de la même règle divergent toujours (§21 bis).
    const nomsSections = L.bulba.setlist === null ? null : (L.bulba.setlist || [].concat(L.bulba.expansion));
    const lecture = entreesDeLaSetlist(pSet.content, L.bulba);
    const { entrees, sections, surToutLeWikitext } = lecture;
    if (surToutLeWikitext && entrees.length) console.log(`   (aucune section Setlist retenue : ${entrees.length} entrées retenues sur ${lecture.lues} références lues sur tout le wikitext)`);
    // LE DÉNOMINATEUR DE L'ÉTAPE, ÉCRIT DANS L'ÉTAT ET PAS SEULEMENT DANS LE LOG (§21 n°7). Jusqu'au 2026-09-15,
    // 1 064 entrées de Setlist étaient écartées sans un mot, et `sectionsVues` n'était écrit qu'à la première collecte.
    const sectionsDuSet = lecture.chemin === 'sections-nommees' ? sections.filter(s => nomsSections.includes(s.titre)) : sections;
    const ignoreesParNature = sectionsDuSet.flatMap(s => s.ignorees).reduce((a, x) => { const k = natureIgnoree(x); a[k] = (a[k] || 0) + 1; return a; }, {});
    const sectionsVues = sections.map(s => ({ titre: s.titre, n: s.entrees.length, ignorees: s.ignorees.length }));
    // `source` et `revid` : la même page ne se lit pas pareil BRUTE (Bulbapedia) et ÉPURÉE (R2, en --reparser) — un
    // rejeu sur l'archive ne dit rien d'une lecture faite sur la brute, et l'état doit dire laquelle a été faite.
    // `horsSet`, `jetonDominant`, `masquees` : null = NON ÉVALUÉ sur ce chemin, jamais « rien » (§8).
    const lectureSetlist = {
        chemin: lecture.chemin, source: pageDuSetSurR2 ? 'r2-epure' : 'bulbapedia', revid: pSet.revid,
        lues: lecture.lues, retenues: entrees.length, horsSet: lecture.horsSet, jetonDominant: lecture.jetonDominant, masquees: lecture.masquees,
        ignorees: ignoreesParNature, le: new Date()
    };
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
            await M.Etat.updateOne({ _id: slug }, { $set: { phase: 'setlist-vide', sectionsVues, lectureSetlist } });
            await finir(); process.exit(1);
        }
        titres = entreesSetlist;
        await M.Etat.updateOne({ _id: slug }, { $set: { titres, phase: 'liens' } });
    }
    // Dans les DEUX branches : une re-collecte réécrit la lecture du parseur d'aujourd'hui.
    await M.Etat.updateOne({ _id: slug }, { $set: { sectionsVues, lectureSetlist } });
    console.log(`2. setlist : sections ${sections.map(s => `« ${s.titre} » ×${s.entrees.length}${s.ignorees.length ? ` (+${s.ignorees.length} ignorée(s))` : ''}`).join(' · ')} → ${entreesSetlist.length} titres retenus${etat.titres?.length ? ' (repris de l\'état : ' + titres.length + ')' : ''}`);
    const listeOuNonEvalue = (nom, xs) => ` · ${nom} ${xs === null ? 'non évalué' : xs.length}${xs?.length ? ' : ' + xs.slice(0, 5).join(' · ') : ''}`;
    console.log(`   lecture (${lecture.chemin}, ${lectureSetlist.source} revid ${pSet.revid}) : ${lecture.lues} lues → ${entrees.length} retenues · ignorées dans les sections du set ${JSON.stringify(ignoreesParNature)}${listeOuNonEvalue('hors set', lecture.horsSet)}${lecture.chemin === 'sections-nommees' ? ` (jeton dominant ${lecture.jetonDominant ? `« ${lecture.jetonDominant} »` : 'aucun : 0 TCG ID dans la section'})` : ''}${listeOuNonEvalue('masquées', lecture.masquees)}`);
    // Une énergie de base ne désigne pas une page par tirage ; une énergie SPÉCIALE, si — la voir ignorée est un trou.
    // Seules les sections DU SET sont regardées : les sections d'un autre set, sur une page fusionnée, sont normales.
    for (const s of sectionsDuSet) for (const brut of s.ignorees.filter(x => natureIgnoree(x) !== 'energie-base')) console.warn(`   ⚠️ entrée ignorée (${natureIgnoree(brut)}), section « ${s.titre} » : ${brut.replace(/\s+/g, ' ').slice(0, 160)}`);

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
        const deja = await M.Carte.find({ sets: slug }).select('_id bulba impressions').lean();
        console.log(`   --reparser : ${deja.length} cartes relues depuis R2, 0 requête Bulbapedia.`);
        for (const c of deja) {
            const epure = await r2.lireTexte(process.env.R2_BUCKET_BRUT, c.bulba.cleR2);
            const faits = faitsDeCarte(epure, c.bulba?.titre);
            compter(faits);
            const impCible = impressionCible(faits);
            const { champsNuls, ...champs } = faits;
            const P = reporterChampsPoses(c.impressions, champs.impressions);   // l'illustrateur par tirage n'est pas au wikitext
            champs.impressions = P.impressions; D.posesReportes = (D.posesReportes || 0) + P.reportes; D.posesPerdus = (D.posesPerdus || 0) + P.perdus;
            await M.Carte.updateOne({ _id: c._id }, { $set: { ...champs, rarete: impCible?.rarete ?? null, champsNuls, reparseLe: new Date() } });
            textesEpures.set(c._id, epure);
        }
        // ⚠️ SEULEMENT les lignes de CE set (et de ses jumelles occidentales) : une carte partagée
        // entre deux sets (Dark Charizard, Rocket Gang ET Pokémon Web) perdait ses lignes de l'autre
        // set à chaque rejeu — H006 est sorti « faux affirmé » de la mesure du pont pour ça, 2026-09-12.
        // 🔴 LES JUMELLES OCCIDENTALES NE S'EFFACENT QUE LÀ OÙ ELLES SE RÉÉCRIVENT (2026-09-24). Le bonus intl plus bas ne
        // rejoint Base Set / Base Set 2 QUE depuis un set japonais ; ce `deleteMany` les effaçait pour TOUT set relu. La relecture
        // de RS et de M-P/CT a ainsi retiré 24 lignes Base Set et Base Set 2 (énergies de base, dresseurs partagés) sans les
        // rendre — restaurées depuis la sauvegarde du lot. La condition d'effacement est celle de la réécriture.
        const expsDeCeSet = [L.exp, ...(TIRAGE === 'jp' ? Object.values(EXPANSIONS_INTL) : [])];
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
            const faits = faitsDeCarte(pg.content, pg.title);
            compter(faits);
            const impCible = impressionCible(faits);
            const { champsNuls, ...champs } = faits;
            // 🔴 une page déjà en base porte des illustrateurs POSÉS APRÈS le parseur : le `$set` du tableau les effaçait
            // (2 179 perdus le 2026-09-24, recollectes de xASC et HSP). Ils se reportent par la clé de l'impression.
            const P = reporterChampsPoses((await M.Carte.findById(pg.pageid).select('impressions').lean())?.impressions, champs.impressions);
            champs.impressions = P.impressions; D.posesReportes = (D.posesReportes || 0) + P.reportes; D.posesPerdus = (D.posesPerdus || 0) + P.perdus;
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
    let cartesDuSet = await M.Carte.find({ sets: slug }).lean();
    // `numerosDepuisSetlist` (tirages chinois, pages « (ATCG) ») : le numéro du set n'est que dans la Setlist. Impressions
    // VIRTUELLES, et une preuve qui le dit (« setlist+numero »). Voir jointure.js. Depuis le 2026-09-24, celles que l'URL
    // Cardmarket confirme sont ÉCRITES sur la carte (poser-impressions-setlist.js) : la virtuelle ne s'ajoute pas en double.
    if (L.bulba.numerosDepuisSetlist) {
        const etatPages = (await M.Etat.findById(slug).select('pages').lean())?.pages || [];
        const V = impressionsDepuisSetlist(entrees, etatPages, { tirage: TIRAGE, expansionBulba: L.bulba.expansion });
        const cleImp = i => `${i.tirage}|${i.expansion}|${cleNumero(String(i.numero ?? ''))}`;
        cartesDuSet = cartesDuSet.map(c => {
            const v = V.parCarte.get(c._id); if (!v) return c;
            const deja = new Set((c.impressions || []).map(cleImp));
            return { ...c, impressions: [...(c.impressions || []), ...v.filter(i => !deja.has(cleImp(i)))] };
        });
        console.log(`   numéros depuis la Setlist : ${entrees.length} entrées → ${V.parCarte.size} cartes, ${[...V.parCarte.values()].flat().length} impressions virtuelles · sans numéro ${V.sansNumero.length} · sans page ${V.sansPage.length}${V.sansPage.length ? ' : ' + V.sansPage.slice(0, 5).join(' · ') : ''}`);
    }
    const produits = await produitsDeLExpansion(prod, L.exp);
    // `slugSet` : le set de la LIGNE, en dernier recours pour les produits qui n'en portent pas —
    // c'est lui qui désigne l'entrée de `cartes.images` (voir `attache` dans jointure.js).
    const J = joindre(cartesDuSet, produits, { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, tirage: TIRAGE, slugSet: slugCardmarket });
    // L'écriture vit dans `ecrire-jointure.js` : la collecte SANS PAGE écrit exactement la même chose,
    // et deux définitions du même geste divergent toujours (§21 bis).
    await ecrireJointure(M, { slug, J, produits });
    // bonus : les expansions OCCIDENTALES jumelles nommées par ces pages (non comptées dans la
    // complétude). ⚠️ Seulement depuis un set JAPONAIS : sur un set occidental, le « jumeau » serait
    // le japonais, et il est déjà collecté par sa propre ligne de table.
    // 🔴 « SOME » PUIS JOINDRE « ALL » — LE DÉFAUT QUI FABRIQUAIT 1 993 LIGNES FAUSSES (2026-09-19).
    // Ce bonus testait qu'AU MOINS UNE carte du set déclare le jumeau occidental, puis joignait TOUTES
    // les cartes du set à ses produits. Les autres n'ont aucune impression dans cette expansion : le
    // repli par nom les prenait quand même (preuve « setlist+nom », « appartenance par la Setlist
    // seule »), et comme le bonus rejoue depuis CHAQUE set japonais dont une page déclare une
    // réimpression, le produit « Bulbasaur-V1-BS44 » a fini rattaché à SEPT cartes « Bulbasaur » —
    // Base Set, Shining Legends, Pokémon GO, SWSH Promo, BW-P, DPt-P, Bulbasaur Deck.
    // 🔑 Le garde d'unicité posé plus tôt aujourd'hui ne pouvait pas l'attraper : il tranche à
    // l'intérieur d'UN appel de `joindre`, et ici chaque collecte prenait le produit de son côté, seule
    // et sans ambiguïté locale. Une ambiguïté répartie sur plusieurs exécutions ne se voit pas d'une
    // exécution. La correction est de ne joindre QUE les cartes qui déclarent réellement le jumeau.
    let intlLignes = 0;
    for (const [nomIntl, idExpIntl] of (TIRAGE === 'jp' ? Object.entries(EXPANSIONS_INTL) : [])) {
        const cartesJumelles = cartesDuSet.filter(c => (c.impressions || []).some(i => i.tirage === 'intl' && i.expansion === nomIntl));
        if (!cartesJumelles.length) continue;
        const prodIntl = await produitsDeLExpansion(prod, idExpIntl);
        const Ji = joindre(cartesJumelles, prodIntl, { idExpansion: idExpIntl, expansionBulba: nomIntl, tirage: 'intl' });
        for (const l of Ji.lignes) await M.CarteProduit.updateOne({ _id: l._id }, { $set: l }, { upsert: true });
        const metaIntl = new Map(prodIntl.map(p => [p.idProduct, p.idMetacard]));
        for (const l of Ji.lignes) await M.Carte.updateOne({ _id: l.carteId }, { $addToSet: { 'liens.idProduct': l.idProduct, ...(metaIntl.get(l.idProduct) != null ? { 'liens.idMetacards': metaIntl.get(l.idProduct) } : {}) } });
        intlLignes += Ji.lignes.length;
        console.log(`   bonus intl « ${nomIntl} » (exp ${idExpIntl}) : ${cartesJumelles.length} cartes sur ${cartesDuSet.length} déclarent ce jumeau → ${Ji.lignes.length} lignes sur ${prodIntl.length} produits, ${Ji.restes.length} restes non écrits`);
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
        console.log(`      illustrateurs posés après le parseur : ${D.posesReportes || 0} impression(s) reportée(s) · ${D.posesPerdus || 0} perdue(s) (clé changée : construire-illustrateurs.js les recalcule)`);
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
    // 6. LE NOM AFFICHÉ — la condition de publication du site. Ce collecteur crée des sets et ne les nomme pas : 151 sets
    // sont restés sans nom, donc sans page, du 19 au 24/09, et rien ne le disait (collecte-cartes/nom-affichage.js).
    const nomAffiche = (await M.Set.findById(slug).select('nomAffichage').lean())?.nomAffichage;
    console.log(`   6. nom affiché     ${verdict(typeof nomAffiche === 'string', `« ${nomAffiche} » : le set est publiable`, 'AUCUN nomAffichage — le set n\'existe pas sur le site : node rapatrier-noms-sets.js (dry-run, puis --ecrire)')}`);
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
    // ⚠️ UN CODE DE SET N'EST PAS UN NOM DE FICHIER (2026-09-19). « M-P/CT », « SV-P/ID » : la barre oblique faisait
    // écrire dans un dossier inexistant, ENOENT, code de sortie 1 — alors que la collecte était FINIE et concordante
    // (127 jointures, 0 reste). La boucle a compté trois échecs et s'est arrêtée sur un rapport, pas sur une donnée.
    const nomFichier = `${String(L.code).replace(/[^A-Za-z0-9.-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.md`;
    const cheminRapport = path.join(dossierRapport, nomFichier);
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

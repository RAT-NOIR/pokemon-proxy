// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Septième principe (scoring.js) : un instrument qui se trompe coûte plus cher qu'un bug.
// Huit erreurs d'instrument sont recensées à ce jour, en deux familles :
//   - FABRIQUER UNE ENTRÉE que le système n'a jamais produite (clé positionnelle,
//     endpoint, identifiant reconstruit, champ lu hors de son moment) ;
//   - LIRE UNE ABSENCE COMME UNE VALEUR CONTRAIRE (`resultat !== 'succes'` sur un journal
//     où le champ n'existait pas encore).
// D'où les règles appliquées ICI :
//   1. ON N'INTERROGE QUE PAR IDENTIFIANT DE SET, jamais par recherche de nom. La
//      recherche par nom nous a induits en erreur trois fois.
//   2. ON NE SE FIE PAS À LA PRÉSENCE D'UN CHAMP `image` : on fait une requête HEAD et on
//      exige un 200 avec un content-type d'image. Un champ n'est pas un octet servi.
//   3. L'APPARIEMENT EST MONTRÉ, PAS AFFIRMÉ. Chaque ligne dit sur quelle PREUVE le set
//      japonais a été apparié, et les cas ambigus sont listés SANS être tranchés.
//
// ⚠️ CE QU'ON N'UTILISE SURTOUT PAS : le champ `setTcgdex` de numeros_cartes. Mesuré le
// 2026-08-15 — nos liens appris pour ces 24 sets pointent vers les JUMEAUX OCCIDENTAUX
// (Pokémon Jungle JP -> `base2`, qui rend 404 en /v2/ja et « Jungle » en /v2/en), et deux
// de nos sets partagent le même identifiant (`ecard3` pour EC4 ET EC5). S'en servir pour
// énumérer des cartes japonaises mesurerait le catalogue anglais.
//
// LECTURE SEULE : aucune écriture, aucune base touchée (cet outil n'ouvre même pas Mongo).
//
// ============================================================================
// CE QUE CET OUTIL MESURE : la reconnaissance par l'illustration est-elle possible ?
// ============================================================================
// Pour chacun des 24 sets de la table close vintage japonaise : combien de cartes TCGdex
// possède-t-il, et combien ont une image RÉELLEMENT SERVIE.
// USAGE : node mesure-images-vintage.js  [--tout]
//   --tout : mesure aussi les sets japonais NON appariés à la table close.
//
// ============================================================================
// ⚠️⚠️ CE QUI RESTE À MESURER SUR LE CHANTIER IMAGE — 2026-08-28
// ============================================================================
// Le verdict du chantier est un GO, et il faut le lire avec sa portée exacte :
// 10 requêtes sur 11 sortent au RANG 1 sur 449 références, 6 sur 6 dans la cellule
// « japonaise vintage sans total ni setCode », où le scoring plaçait la vraie carte
// aux rangs 15 à 23. C'est acquis. Ce qui suit ne l'est pas.
//
// ── 1. RIEN NE TESTE ENCORE L'OCCIDENTAL NI LE MODERNE ──────────────────────
// Les 11 requêtes sont onze photos de cartes JAPONAISES VINTAGE, tirées de cinq sets
// (EXP, EC1, EC2, N3, IPB). Elles ne disent rien de l'anglais, du français, ni d'aucune
// carte postérieure à 2003 — c'est-à-dire de l'essentiel du catalogue.
// ⚠️ BASCULER L'ARCHITECTURE SUR CE SEUL CHIFFRE REMPLACERAIT UN CHEMIN QUI MARCHE PAR
// UN CHEMIN NON MESURÉ. Il faut LE MÊME chiffre sur du moderne avant toute bascule.
//
// Et deux choses changeront EN MÊME TEMPS le jour où on mesurera l'occidental, ce qui
// doit être déclaré en tête de cette mesure-là :
//   · l'ÈRE des cartes (1999-2003 -> 2010-2025) ;
//   · la NATURE DE LA RÉFÉRENCE — les 449 du vintage sont des SCANS Cardmarket, avec
//     grain et brillance ; l'occidental viendra de RENDUS TCGdex, propres et plats.
// Un chiffre plus bas sur l'occidental serait donc indiscernable entre « la méthode ne
// tient pas hors du vintage » et « les rendus ne s'apparient pas ». D'où le témoin
// `pokemon-proxy-labo/temoin-rendu.js`, qui pose la seconde question seule.
//
// ⚠️ ET LA POPULATION À MESURER N'EST PAS « DES ANNONCES OCCIDENTALES AU HASARD ».
// Mesuré ce jour sur les 44 lignes occidentales du journal : le total est lu sur 93,2 %
// d'entre elles (contre 44,4 % en asiatique), le vivier journalisé vaut 1 candidat sur
// 10 lignes sur 13, et il n'y a que 3 échecs — tous `egalite-parfaite`. Un vivier de 1
// n'a RIEN à réordonner : y mesurer l'image mesurerait le néant et rendrait « l'image
// n'apporte rien » là où c'est le PROBLÈME qui n'existe pas. La population qui a un sens
// est celle où un départage existe : `egalite-parfaite`, `carteIncertaine`, ou vivier ≥ 2.
//
// ── 2. LES GROUPES V1/V2 NE SONT TOUJOURS PAS MESURÉS ───────────────────────
// Trois cas serrés ont été rencontrés (Fearow, Machamp, Electrode) : à chaque fois, le
// candidat qui talonne la vraie carte porte LE MÊME DESSIN dans une autre finition.
// Trois cas ne sont pas une mesure. Les groupes durs — même set, même illustration,
// seule la finition change — restent à construire et à passer, ET À DÉCLARER FABRIQUÉS.
// C'est là, et seulement là, que se tranche pour de bon la clause écrite avant l'essai :
//     inliers(bon) ≈ inliers(mauvais) ≈ 0   -> la TECHNIQUE échoue, on a le droit de réessayer
//     inliers(bon) ≫ inliers(mauvais)       -> ça marche
//     inliers(bon) ≈ inliers(mauvais) ≫ 0   -> la MÉTHODE échoue, aucune technique ne les
//                                              séparera, et c'est au reste de la chaîne
//                                              de trancher la finition, pas à l'image.
//
// ── 3. CE QUI EST DÉJÀ SU DU PONT, ET QUI CONTRAINT LA SUITE ────────────────
// Mesuré ce jour sur les 750 codeSet de `numeros_cartes` :
//   · 0 codeSet sur 750 pointe vers DEUX identifiants TCGdex — le pont, là où il existe,
//     est UNIQUE. C'est la bonne nouvelle, et elle n'était pas acquise (côté japonais,
//     EC4 et EC5 partagent `ecard3`).
//   · mais il n'existe que pour 213 sets sur 750, soit 22 626 cartes sur 69 231 (32,7 %).
//     Les 46 605 autres ne sont pas absentes DE TCGdex : elles sont absentes de NOTRE
//     table de correspondance, qui s'apprend carte par carte.
// ⚠️ CONSÉQUENCE POUR TOUTE MESURE D'IMAGE OCCIDENTALE : un candidat sans référence ne
// peut jamais gagner. Mesurer sur un vivier à moitié ponté classerait la vraie carte
// contre un vivier amputé EN NOTRE FAVEUR. Une ligne n'est recevable que si son vivier
// est ponté à ≥ 80 %, et la proportion doit être rendue ligne par ligne.
//
// ============================================================================
// 🔴🔴 RÈGLE DURE — L'INDEX SE CONSTRUIT SUR L'idProduct DU NOM DE FICHIER,
//      JAMAIS SUR LE NOM DE DOSSIER. 2026-08-29
// ============================================================================
// Le nom de dossier est de la DÉCORATION. La clé est dans le fichier.
//
// Ce que l'audit de la collecte a trouvé, et qui interdit de faire autrement :
//   · 41 dossiers portent un nom qui n'est pas le codeSet de leur contenu ;
//   · « CSDC » contient les 183 cartes de CS3DC — CS3DC a un dossier, et il est VIDE ;
//   · « SV4A » mélange deux galeries Cardmarket, « Shiny Treasure ex » (expansion 5519)
//     et « Pikachu Legendary Celebration » (expansion 6348, codeSet CSDC en base) ;
//   · « WCD12 » contient WCD12 ET WCD13 ; « XY10 » contient aussi le MAudino EX Mega
//     Battle Deck (codeSet XYH) ;
//   · Windows interdit le « / » : SV-P/ID est rangé sous « SV-P ID », S-P/CS sous
//     « SVP-P CS ». Ce n'est pas une faute de rangement, c'est le système de fichiers.
//
// ⚠️ ET ÇA A DÉJÀ COÛTÉ, DANS L'AUDIT LUI-MÊME. Mes deux premiers passages cherchaient,
// pour chaque dossier, les produits de son codeSet absents DE CE DOSSIER. CS3DC est donc
// sorti à « 183 manquants » alors que ses 183 fichiers sont sur le disque. Le rapport
// aurait envoyé le testeur réenregistrer 183 pages qu'il possède. La présence se juge sur
// L'ENSEMBLE du disque, par jointure sur l'identifiant, jamais dossier par dossier.
// Même chose au comptage des galeries : par dossier, SV4A paraissait dépasser 300 et
// renversait une hypothèse juste. Par galerie, il ne la dépassait pas.
//
// ============================================================================
// LA COLLECTE DE RÉFÉRENCES — CE QUI EST SU AU 2026-08-29
// ============================================================================
// 69 016 idProducts distincts sur le disque, 67 104 appariés au catalogue, 1 912 fichiers
// dont le produit nous est inconnu — TOUS d'idProduct supérieur à 895 905, notre maximum.
// Ce ne sont pas des images en trop : c'est le catalogue qui est en retard.
//
// 🔴 LE PLAFOND À 300. Quinze galeries s'arrêtent à EXACTEMENT 300 fichiers et 10 pages.
// Sur les 770 galeries du disque, AUCUNE ne dépasse 300, AUCUNE n'a de page 11. Les
// produits manquants de ces quinze sets sont dispersés dans l'alphabet (rang moyen 0,44
// à 0,53), donc ce n'est pas « il a pris le début de la liste ». Et cinq de ces galeries
// s'arrêtent à 300 alors qu'il ne restait qu'entre 1 et 15 cartes à prendre.
// L'explication qui tient est un PLAFOND DE LA GALERIE CARDMARKET, pas une lassitude du
// testeur. Elle n'est pas prouvée — seul l'affichage de la pagination la prouvera.
//
// ============================================================================
// `references_image` — LA COLLECTION QUI DIT CE QU'ON PEUT INDEXER. ADOPTÉE.
// ============================================================================
// Collection DÉDIÉE, clé `idProduct`. ⚠️ PAS un champ de `catalogue_produits` :
// `import-catalogue.js` réécrit cette collection à chaque import et le constat serait
// perdu sans que personne ne s'en aperçoive.
//
//   references_image : { idProduct, etat, constateLe, source }
//      etat = 'indexee'        un vecteur existe
//           | 'absente'        vérifié chez Cardmarket : il n'y a pas d'image.
//                              PROPRIÉTÉ DU PRODUIT.
//           | 'non-collectee'  le set n'a pas été enregistré. PROPRIÉTÉ DE NOTRE TRAVAIL.
//
// Un booléen mentirait : il confondrait « on a vérifié, il n'y en a pas » et « on n'a pas
// regardé ». Ce sont deux choses différentes et une seule se répare.
//
// 🔴🔴 LE RACCOURCI QU'IL NE FAUT PAS PRENDRE, ÉCRIT EN TOUTES LETTRES.
// Le départage par l'image ne se déclenche QUE SI TOUS les candidats du groupe sont
// `indexee`. Un seul candidat en `absente` ou en `non-collectee` -> ABSTENTION.
//
// Il sera tentant, dans six mois, d'écrire ceci en croyant optimiser :
//     « ce candidat n'a pas de vecteur, il ne peut pas gagner de toute façon,
//       donc je le retire du groupe et je départage les autres. »
// C'EST FAUX, ET C'EST FABRIQUER UNE VICTOIRE. Si la carte réelle est justement celle
// qui n'a pas de référence, l'appariement ne peut pas la désigner : il désignera un
// AUTRE candidat, et il le désignera AVEC ASSURANCE, puisque plus rien ne lui fait
// concurrence. Retirer le candidat aveugle ne supprime pas l'incertitude, il supprime
// la trace de l'incertitude. Le score monte, la justesse baisse, et rien dans les
// chiffres ne le montre.
// `absente` et `non-collectee` se valent donc DEVANT LA GARDE. Leur différence sert à la
// liste de travail — retaper ou ne pas retaper — et à rien d'autre.
//
// ⚠️ ET « LE GROUPE » DOIT ÊTRE DÉFINI, SINON LA RÈGLE CHANGE DE PRIX. Mesuré ce jour :
//     groupe = le VIVIER ENTIER du nom ....... 56,4 % des groupes touchés (trafic réel)
//     groupe = (nom, codeSet) ................  7,6 %
//     groupe = idMetacard (Cardmarket) .......  8,4 %
// Le vivier n'est pas le groupe de départage : c'est la présélection, et 58 viviers sur
// 133 y dépassent 50 candidats. Exiger une référence pour chacun des 80 « Arcanine » du
// catalogue reviendrait à exiger la collecte complète pour séparer deux finitions.
// LE GROUPE EST L'ENSEMBLE QUE LE SCORING LAISSE À ÉGALITÉ, au grain de `idMetacard` —
// les tirages d'une même carte. À ce grain la règle stricte coûte moins d'un groupe sur
// dix, et environ un cinquième de ce coût est définitif (produits sans numéro, scellés
// et cartes-codes, qui n'auront jamais d'image). Le reste diminue à mesure que la
// collecte se termine.
const axios = require('axios');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');

const TOUT = process.argv.includes('--tout');
const CONCURRENCE = 12;
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

async function jsonTCGdex(chemin) {
    try { return (await axios.get(`https://api.tcgdex.net/v2/${chemin}`, { timeout: 25000 })).data; }
    catch (e) { return null; }
}

// UNE IMAGE EXISTE QUAND UN OCTET EST SERVI, pas quand un champ est présent.
// TCGdex sert ses assets sous `{image}/{qualite}.{extension}` : on essaie les formes
// documentées dans l'ordre, et la PREMIÈRE qui rend 200 suffit.
const FORMES = ['/high.png', '/low.png', '/high.webp', '/low.webp'];
async function imageServie(base) {
    if (!base) return { ok: false, forme: null, raison: 'aucun champ image' };
    for (const forme of FORMES) {
        try {
            const r = await axios.head(`${base}${forme}`, { timeout: 12000 });
            const ct = String(r.headers['content-type'] || '');
            if (r.status === 200 && ct.startsWith('image/')) return { ok: true, forme, ct };
        } catch (_) { /* forme suivante */ }
    }
    return { ok: false, forme: null, raison: 'aucune forme ne rend 200' };
}

// Petit ordonnanceur : `CONCURRENCE` requêtes en vol, pas plus. Sans lui, un set de 157
// cartes ouvre 157 connexions d'un coup et TCGdex répond 429 — ce qui produirait des
// « images absentes » qui sont en réalité notre propre impatience.
async function enParallele(items, n, travail) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (true) {
            const k = i++;
            if (k >= items.length) return;
            out[k] = await travail(items[k], k);
        }
    }));
    return out;
}

(async () => {
    const setsJa = await jsonTCGdex('ja/sets');
    if (!Array.isArray(setsJa)) { console.error('❌ /v2/ja/sets injoignable.'); process.exit(1); }
    console.log(`espace des sets JAPONAIS chez TCGdex : ${setsJa.length} sets\n`);

    // ─── APPARIEMENT, MONTRÉ ET NON AFFIRMÉ ──────────────────────────────
    // La seule clé numérique disponible des deux côtés est le NOMBRE DE CARTES. Notre
    // table porte `prod` (produits Cardmarket de l'expansion), TCGdex porte
    // `cardCount.total` / `.official`. Ce ne sont pas la même grandeur — d'où l'affichage
    // des candidats plutôt qu'un choix silencieux.
    const nb = s => [s.cardCount?.total, s.cardCount?.official].filter(x => Number.isFinite(x));
    const apparies = [], ambigus = [], sansCandidat = [];
    for (const notre of SETS_VINTAGE_JAPONAIS) {
        const cands = setsJa.filter(s => nb(s).includes(notre.prod));
        if (cands.length === 1) apparies.push({ notre, ja: cands[0], preuve: `cardCount == prod (${notre.prod})` });
        else if (cands.length > 1) ambigus.push({ notre, cands });
        else sansCandidat.push(notre);
    }
    // ⚠️ L'AMBIGUÏTÉ SE LIT DANS LES DEUX SENS, ET LA PREMIÈRE VERSION N'EN VOYAIT QU'UN.
    // Elle demandait « combien de sets japonais ont ce nombre de cartes ? » et déclarait
    // « sans ambiguïté » dès qu'il n'y en avait qu'un. Elle ne demandait jamais « combien
    // de NOS sets tombent sur le MÊME set japonais ? » — d'où deux lignes fausses dans le
    // premier tableau : ROG et DP5c appariés tous les deux à PMCG4 (65 cartes chacun), et
    // MCDP (24) apparié à SMP2 « 名探偵ピカチュウ » (Detective Pikachu), qui n'a rien à voir.
    // Une bijection ne se vérifie pas d'un seul côté.
    const parJa = new Map();
    for (const a of apparies) parJa.set(a.ja.id, [...(parJa.get(a.ja.id) || []), a]);
    const collisions = [...parJa.values()].filter(v => v.length > 1);
    const retenus = apparies.filter(a => (parJa.get(a.ja.id) || []).length === 1);
    for (const groupe of collisions) ambigus.push({ notre: groupe[0].notre, cands: [groupe[0].ja], collision: groupe.map(g => g.notre.code) });

    console.log('═'.repeat(96));
    console.log(`APPARIEMENT DES ${SETS_VINTAGE_JAPONAIS.length} SETS DE LA TABLE CLOSE`);
    console.log('═'.repeat(96));
    console.log(`   appariés en BIJECTION (un seul candidat, et personne d'autre dessus) : ${retenus.length}`);
    console.log(`   AMBIGUS : ${ambigus.length}`);
    for (const a of ambigus) {
        console.log(`      ${String(a.notre.code).padEnd(8)} prod=${String(a.notre.prod).padEnd(4)} "${a.notre.nom}" -> ${a.cands.map(c => `${c.id}(${c.name})`).join(' | ')}` +
            (a.collision ? `   ⚠️ COLLISION : ${a.collision.join(' et ')} visent le même set japonais` : ''));
    }
    console.log(`   SANS CANDIDAT : ${sansCandidat.length}`);
    for (const s of sansCandidat) console.log(`      ${String(s.code).padEnd(8)} prod=${String(s.prod).padEnd(4)} "${s.nom}"`);
    console.log('   ⚠️ Les ambigus et les sans-candidat NE SONT PAS MESURÉS ci-dessous : les');
    console.log('      trancher demanderait un appariement par le nom, et c\'est exactement');
    console.log('      ce que cette mesure s\'interdit.');

    // ─── LA MESURE D'IMAGES ──────────────────────────────────────────────
    const aMesurer = TOUT
        ? setsJa.map(s => ({ notre: null, ja: s, preuve: '--tout' }))
        : retenus;

    console.log('\n' + '═'.repeat(96));
    console.log('COUVERTURE D\'IMAGES, SET PAR SET (HEAD sur l\'asset, pas la présence du champ)');
    console.log('═'.repeat(96));
    console.log(`${'code'.padEnd(8)} ${'set TCGdex'.padEnd(12)} ${'cartes'.padStart(6)} ${'champ img'.padStart(10)} ${'SERVIES'.padStart(8)} ${'couverture'.padStart(11)}   nom`);
    console.log('─'.repeat(96));

    let totalCartes = 0, totalChamp = 0, totalServies = 0;
    const lignes = [];
    for (const { notre, ja, preuve } of aMesurer) {
        const detail = await jsonTCGdex(`ja/sets/${encodeURIComponent(ja.id)}`);
        const cartes = Array.isArray(detail?.cards) ? detail.cards : [];
        const avecChamp = cartes.filter(k => k.image);
        const res = await enParallele(avecChamp, CONCURRENCE, k => imageServie(k.image));
        const servies = res.filter(r => r.ok).length;
        totalCartes += cartes.length; totalChamp += avecChamp.length; totalServies += servies;
        lignes.push({ notre, ja, cartes: cartes.length, champ: avecChamp.length, servies, preuve });
        console.log(
            `${String(notre?.code ?? '—').padEnd(8)} ${String(ja.id).padEnd(12)} ${String(cartes.length).padStart(6)} ` +
            `${String(avecChamp.length).padStart(10)} ${String(servies).padStart(8)} ${pc(servies, cartes.length).padStart(11)}   ${ja.name}`
        );
    }

    console.log('─'.repeat(96));
    console.log(`${'TOTAL'.padEnd(21)} ${String(totalCartes).padStart(6)} ${String(totalChamp).padStart(10)} ${String(totalServies).padStart(8)} ${pc(totalServies, totalCartes).padStart(11)}`);

    console.log('\n' + '═'.repeat(96));
    console.log('CE QUE ÇA DIT DU CHANTIER « RECONNAISSANCE PAR L\'ILLUSTRATION »');
    console.log('═'.repeat(96));
    console.log(`   sets mesurés            : ${lignes.length} / ${SETS_VINTAGE_JAPONAIS.length} de la table close`);
    console.log(`   cartes couvertes        : ${totalServies} / ${totalCartes}  (${pc(totalServies, totalCartes)})`);
    const vides = lignes.filter(l => l.servies === 0);
    const partiels = lignes.filter(l => l.servies > 0 && l.servies < l.cartes);
    console.log(`   sets SANS AUCUNE image  : ${vides.length}${vides.length ? ' -> ' + vides.map(l => l.notre?.code ?? l.ja.id).join(', ') : ''}`);
    console.log(`   sets PARTIELS           : ${partiels.length}${partiels.length ? ' -> ' + partiels.map(l => `${l.notre?.code ?? l.ja.id} (${l.servies}/${l.cartes})`).join(', ') : ''}`);
    console.log('\n   ⚠️ CE CHIFFRE NE COUVRE QUE LES SETS APPARIÉS SANS AMBIGUÏTÉ. Les autres ne');
    console.log('      sont pas « sans images » : ils sont NON MESURÉS. Ne pas les compter comme');
    console.log('      des zéros — ce serait relire une absence comme une valeur contraire, la');
    console.log('      huitième erreur d\'instrument de la semaine.');
})().catch(e => { console.error(e.stack); process.exit(1); });

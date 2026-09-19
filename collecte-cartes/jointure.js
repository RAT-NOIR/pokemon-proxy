// ============================================================
// JOINTURE n-n carte Bulbapedia ↔ produit Cardmarket, AVEC PREUVE PAR LIGNE
// ============================================================
// Une page Bulbapedia est une CARTE, tous tirages fusionnés ; notre unité est le PRODUIT (un
// tirage dans une expansion, parfois plusieurs produits pour un même numéro — V1…V6 de Base Set).
// Aucune correspondance un-pour-un n'est supposée : on écrit une ligne par couple, avec la preuve.
//
//   set NUMÉROTÉ (jpcardno / cardno présent)   -> (idExpansion, numéro) : TOUS les produits de ce
//                                                 numéro s'attachent. Preuve 'set+numero'.
//   set NON NUMÉROTÉ (EXP, PJU… : pas de n°)    -> (idExpansion, nom EN normalisé) ; si le nom
//                                                 Cardmarket porte des attaques entre crochets et
//                                                 qu'elles concordent avec les attaques parsées,
//                                                 preuve 'set+nom+attaques', sinon 'set+nom'.
//   RESTES, listés jamais résolus               -> produit-sans-carte, carte-sans-produit,
//                                                 produit-vers-plusieurs-cartes.
//
// La production (`numeros_cartes`, `catalogue_produits`) est lue sur la connexion `prod`, en
// LECTURE SEULE. Même normalisation de nom que identification-locale.js : toute divergence ferait
// que la jointure et la chaîne ne verraient pas les mêmes candidats.

// ♂ / ♀ : Bulbapedia écrit « Nidoran♂ », Cardmarket « Nidoran [M] ». Les deux se normalisent en
// « nidoranm » / « nidoranf » — le sexe fait partie du nom, ce n'est pas une attaque.
// Apostrophes typographiques (’ ‘ ʼ) et tirets longs (– —) : « Farfetch’d » chez PKMJP, « Farfetch'd »
// chez Bulbapedia, « The Last Cave – Cerulean! » contre « - » ; 1 ligne sur 96 le 2026-09-12, et ça
// revient sur tous les noms à apostrophe. Normalisés AVANT la suppression des signes.
const normaliserNom = n => String(n || '').normalize('NFC').toLowerCase()
    .replace(/[’‘ʼ`´]/g, "'").replace(/[–—‐]/g, '-')
    .replace(/♂/g, 'm').replace(/♀/g, 'f').replace(/[\s\-'.&:!?,]/g, '');
const { ALIAS_CARDMARKET_VERS_BULBAPEDIA } = require('./alias-noms');
const chiffresDuNumero = n => { const m = String(n ?? '').match(/\d+/); return m ? String(parseInt(m[0], 10)) : null; };
// LA CLÉ DE NUMÉRO GARDE SON PRÉFIXE ALPHABÉTIQUE. `chiffresDuNumero` (« S04 » -> « 4 ») joignait les
// 29 produits de la sous-série S d'EC1 aux cartes 001…029 du set principal (Venusaur S04 -> Ekans
// 004), mesuré le 2026-09-12 : 29 jointures fausses, preuve « set+numero ». C'est la classe des
// 1 936 produits à préfixe alphabétique (S, TG, SV, GG, H…) déjà nommée dans sets-vintage-japonais.js.
const cleNumero = n => { const m = String(n ?? '').trim().toUpperCase().match(/^([A-Z-]*)0*(\d+)([A-Z]*)$/); return m ? `${m[1]}${m[2]}${m[3]}` : (String(n ?? '').trim().toUpperCase() || null); };

/**
 * « Alakazam [Damage Swap | Confuse Ray] » -> { nom: 'Alakazam', attaques: ['Damage Swap', 'Confuse Ray'] }
 * « Nidoran [M] [Horn Hazard] »            -> { nom: 'Nidoran♂', attaques: ['Horn Hazard'] }
 * Tous les groupes entre crochets sont lus ; [M] et [F] sont des marques de sexe, le dernier
 * groupe restant porte les attaques.
 */
function decomposerNomCardmarket(name) {
    let s = String(name || '').trim();
    const groupes = [...s.matchAll(/\[([^\]]*)\]/g)].map(m => m[1].trim());
    let nom = s.replace(/\s*\[[^\]]*\]/g, '').trim();
    // Ère DP : « Paras Lv.16 » — le niveau NUMÉRIQUE n'est pas dans le nom Bulbapedia, il sort.
    // ⚠️ « LV.X » RESTE DANS LE NOM : Bulbapedia nomme la carte « Magmortar LV.X », distincte de
    // « Magmortar ». L'avoir retiré a joint 5 produits LV.X à deux cartes (DP2, DP5c, 2026-09-12).
    let niveau = null;
    const lv = nom.match(/\s+(Lv\.\s*\d+)$/i);
    if (lv) { niveau = lv[1]; nom = nom.slice(0, -lv[0].length).trim(); }
    let attaques = [];
    for (const g of groupes) {
        if (g === 'M') nom += '♂';
        else if (g === 'F') nom += '♀';
        else if (/^[A-Z!?]$/.test(g)) nom += ' ' + g;                  // Unown [A] -> « Unown A »
        else attaques = g.split('|').map(x => x.trim()).filter(Boolean);
    }
    return { nom, attaques, niveau };
}

/**
 * Produits d'une expansion, lus une fois, avec leur numéro s'il existe.
 * @returns {Promise<Array<{idProduct, idExpansion, idMetacard, name, nom, attaques, numero}>>}
 */
// 🔴 UNE CARTE-CODE N'EST PAS UNE CARTE — 2026-09-19. Cardmarket vend en « singles » des **Online Code
// Card** / **Live Code Card** : un bout de carton qui porte un code pour le jeu en ligne. Il n'a ni
// numéro, ni illustration, ni page Bulbapedia, et il ne peut par construction NI avoir une fiche NI
// avoir un visuel. Compté au dénominateur, il fabrique un trou permanent et fausse tous les taux.
// ÉNUMÉRÉ, pas deviné : 464 produits dans 22 expansions, dont Pokemon-Products 298 et
// Scarlet-Violet-Products 122 — et tous les autres libellés suspects ouverts un par un (« Capsule
// Énergie Booster », « Pack d'Eau Fraîches », « Collectionneur de Pokémon », « Theme Deck ») sont de
// VRAIES cartes. Dénominateur du chantier : 69 598 - 464 = **69 134**.
const estCarteCode = nom => /\b(online|live)\s+code\s+card\b/i.test(String(nom || ''));

async function produitsDeLExpansion(prod, idExpansion) {
    const CP = prod.db.collection('catalogue_produits');
    const NC = prod.db.collection('numeros_cartes');
    const bruts = await CP.find({ idExpansion }, { projection: { _id: 0, idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } }).toArray();
    const produits = bruts.filter(p => !estCarteCode(p.name));
    if (bruts.length !== produits.length) console.log(`   cartes-code écartées : ${bruts.length - produits.length} (ni fiche ni visuel possibles — ce ne sont pas des cartes)`);
    // `slugSet` autant que `slug` : les DEUX font l'URL Cardmarket
    // (/Pokemon/Products/Singles/<slugSet>/<slug>). N'en porter qu'un ne sert à rien.
    const numeros = await NC.find({ idExpansion }, { projection: { _id: 0, idProduct: 1, numero: 1, slug: 1, slugSet: 1, variante: 1 } }).toArray();
    const parId = new Map(numeros.map(n => [n.idProduct, n]));
    const avecNumero = numeros.filter(n => n.numero != null && String(n.numero).trim() !== '').length;
    const avecSlug = numeros.filter(n => n.slug && n.slugSet).length;
    console.log(`   catalogue exp ${idExpansion} : ${produits.length} produits · ${avecNumero} portent un numéro (le dénominateur de la clé) · ${avecSlug} portent slug ET slugSet`);
    return produits.map(p => {
        const d = decomposerNomCardmarket(p.name);
        const n = parId.get(p.idProduct);
        return { ...p, nom: d.nom, attaques: d.attaques, numero: n?.numero ?? null, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null, variante: n?.variante ?? null };
    });
}

/**
 * LE NUMÉRO PORTÉ PAR LA SETLIST (2026-09-15). Les tirages chinois (pages « (ATCG) ») ne sont PAS déclarés sur les pages de
 * cartes : `Venipede (Transfiguration Mask 115)` redirige vers `Venipede (Twilight Masquerade 115)`, sans impression chinoise.
 * Le numéro n'existe que dans l'entrée de Setlist. On en fait des impressions VIRTUELLES (jamais écrites en base), rattachées
 * à la page par `etat.pages` (titre demandé → pageid), que `joindre` lit comme les autres et nomme « setlist+numero ».
 * @returns {{ parCarte: Map<number, object[]>, sansPage: string[], sansNumero: string[] }}
 */
function impressionsDepuisSetlist(entrees, pages, cible) {
    const pageDe = new Map((pages || []).filter(p => p.pageid != null).map(p => [p.titre, p.pageid]));
    const parCarte = new Map(), sansPage = [], sansNumero = [];
    const noms = [].concat(cible.expansionBulba);
    const jetons = jetonsDeSetlist(entrees, noms);
    for (const e of entrees) {
        const numero = numeroDeSetlist(e, jetons);
        if (numero == null) { sansNumero.push(e.titre); continue; }
        const id = pageDe.get(e.titre);
        if (id == null) { sansPage.push(e.titre); continue; }
        if (!parCarte.has(id)) parCarte.set(id, []);
        parCarte.get(id).push({ tirage: cible.tirage, expansion: noms[0], numero, total: null, deck: null, rarete: null, source: 'setlist' });
    }
    return { parCarte, sansPage, sansNumero };
}

/**
 * Les jetons de set qu'une Setlist reconnaît comme SIENS : les noms de la table, plus le jeton le plus fréquent de ses
 * TCG ID. Une page de promos écrit « S-P Promo » là où la table dit « S-P Promotional cards » ; tout autre jeton est une
 * RÉIMPRESSION listée en passant (« Psyduck (Astral Radiance 28) »), et son numéro appartient à l'autre set.
 * @returns {Set<string>}
 */
function jetonsDeSetlist(entrees, nomsExpansion) {
    const jetons = new Set([].concat(nomsExpansion).filter(Boolean));
    const frequences = new Map();
    for (const e of entrees || []) if (e.forme === 'tcg-id' && e.a) frequences.set(e.a, (frequences.get(e.a) || 0) + 1);
    const dominant = [...frequences].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (dominant) jetons.add(dominant);
    return jetons;
}

/**
 * Le numéro qu'une entrée de Setlist porte POUR CE SET — UNE définition, lue par la jointure ET par la vérification
 * (§21 bis). L'entrée doit désigner ce set : son jeton est un nom de la table ou le jeton dominant de la page.
 * ⚠️ 2026-09-19 : un TCG ID était accepté quel que soit son set. Les pages de promos listent les RÉIMPRESSIONS
 * (« Psyduck (Astral Radiance 28) ») : leur numéro, pris pour celui du promo, a donné 12 produits joints à plusieurs
 * cartes sur S-P/CS — la garde a arrêté la boucle. Un lien reste soumis à la même règle (coquille non devinée).
 * @returns {string|null}
 */
function numeroDeSetlist(e, jetonsOuNoms) {
    if (e.b == null || String(e.b).trim() === '') return null;
    const jetons = jetonsOuNoms instanceof Set ? jetonsOuNoms : new Set([].concat(jetonsOuNoms).filter(Boolean));
    if (!jetons.has(e.a)) return null;
    if (e.forme === 'tcg-id' || e.forme === 'lien') return String(e.b).trim();
    return null;
}

/**
 * Joint les cartes d'un set à ses produits.
 * @param {object[]} cartes   documents `cartes` (avec impressions, attaques, nomEn)
 * @param {object[]} produits sortie de produitsDeLExpansion
 * @param {{idExpansion:number, expansionBulba:string, tirage:'jp'|'intl'}} cible
 * @returns {{lignes: object[], restes: object[], compte: object}}
 */
function joindre(cartes, produits, cible) {
    const lignes = [], restes = [];
    const produitsJoints = new Map();     // idProduct -> [carteId]
    const parNumero = new Map(), parNom = new Map();
    for (const p of produits) {
        const num = p.numero != null && String(p.numero).trim() !== '' ? cleNumero(p.numero) : null;
        if (num) { if (!parNumero.has(num)) parNumero.set(num, []); parNumero.get(num).push(p); }
        const nom = normaliserNom(p.nom);
        if (!parNom.has(nom)) parNom.set(nom, []); parNom.get(nom).push(p);
        // Alias à la main : le produit est aussi indexé sous le nom que Bulbapedia lui donne.
        const alias = ALIAS_CARDMARKET_VERS_BULBAPEDIA[p.nom];
        if (alias) { const k = normaliserNom(alias); if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(p); }
    }
    const attache = (carte, p, preuve, detail) => {
        // `slug` et `slugSet` VOYAGENT AVEC LA LIGNE : ils font l'URL Cardmarket, et le site n'a pas
        // accès à `numeros_cartes` (cluster de production). Sans eux il affichait « idProduct 557669 »
        // en texte nu. Ils n'ont jamais été spécifiés — ce n'était pas un rejeu manqué, c'était une
        // colonne absente.
        // 🔑 ET `slugSet` A UNE SECONDE FONCTION QUI N'EST PAS L'URL : il DÉSIGNE L'ENTRÉE D'IMAGE.
        // `cartes.images` est clé par set (§19) ; une ligne sans `slugSet` ne peut désigner aucune
        // entrée, donc le produit n'a PAS de visuel même quand sa carte en porte un. Mesuré le
        // 2026-09-19 : les 1 787 produits sans `slug` (§6) n'ont pas non plus de `slugSet`, 630
        // d'entre eux ont pourtant une fiche, 474 des 517 cartes visées portent une image — et le
        // compte de visuels était 0. Le set, lui, est connu par CONSTRUCTION : c'est celui de la
        // ligne de table qui a amené la jointure. On le retient en dernier recours.
        // ⚠️ L'URL Cardmarket n'en devient pas constructible pour autant : elle exige `slug` ET
        // `slugSet`, et `slug` reste absent. Le champ sert ici au visuel, pas au lien.
        lignes.push({ _id: `${carte._id}|${p.idProduct}`, carteId: carte._id, idProduct: p.idProduct, idExpansion: cible.idExpansion, tirage: cible.tirage, preuve, detail, slug: p.slug ?? null, slugSet: p.slugSet ?? cible.slugSet ?? null, verifieLe: new Date() });
        if (!produitsJoints.has(p.idProduct)) produitsJoints.set(p.idProduct, []);
        produitsJoints.get(p.idProduct).push(carte._id);
    };
    // 🔴 LE PRÉFIXE DE NUMÉRO D'UN SET DE PROMOS (2026-09-15). Bulbapedia écrit « SWSH002 », Cardmarket « 002 » : la clé
    // garde le préfixe (voir cleNumero, EC1), set+numéro échouait sur tout le set, et le repli par NOM rattachait un produit
    // à toutes les cartes du nom — 56 produits vers plusieurs cartes, ≥ 124 lignes fausses. Même famille que les crochets
    // d'Unown et le ☆ : une écriture différente d'une même donnée. Le préfixe n'est retiré que s'il est COMMUN à toutes
    // les impressions numérotées de la cible ET absent de tous les numéros Cardmarket : EC1, qui mêle « S04 » et « 004 »,
    // n'est pas touché. Le détail de la preuve le nomme.
    // Et la POSITION d'une pièce V-UNION, « SWSH215 (Top Left) » : la parenthèse n'est pas le numéro. Non retirée, la carte
    // retombait sur le nom (« Morpeko ») et prenait les produits ordinaires — 11 produits vers plusieurs cartes au rejeu.
    const sansPosition = n => String(n).trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, '');
    const nomsCibleSet = [].concat(cible.expansionBulba);
    const numerote = n => n != null && String(n).trim() !== '';
    const numsImp = cartes.flatMap(c => (c.impressions || []).filter(i => i.tirage === cible.tirage && nomsCibleSet.includes(i.expansion) && (!cible.deck || i.deck === cible.deck) && numerote(i.numero)).map(i => sansPosition(i.numero)));
    const prefixesImp = new Set(numsImp.map(n => (n.match(/^([A-Z]+)(?=\d)/) || [])[1] ?? null));
    const numsProd = produits.filter(p => numerote(p.numero)).map(p => String(p.numero).trim().toUpperCase());
    // ⚠️ CORRIGÉ le 2026-09-16 : l'exigence « AUCUN numéro Cardmarket ne porte le préfixe » était trop forte. SM Black Star
    // Promos a 305 numéros nus et 5 préfixés (« SM240 » à côté de « 240 », deux produits de la même carte) : 5 exceptions
    // désactivaient le retrait pour tout le set — 3 jointures sur 310, et la concordance restait vraie (§21 n°8).
    // L'impression est donc indexée sous ses DEUX écritures, et chaque produit joint la sienne. La condition qui reste est
    // celle qui protège EC1 : le préfixe doit être COMMUN à toutes les impressions numérotées.
    const prefixeDuSet = numsImp.length && prefixesImp.size === 1 && !prefixesImp.has(null) && numsProd.some(n => /^\d/.test(n)) ? [...prefixesImp][0] : null;
    const clesImpression = n => {
        const nu = sansPosition(n);
        const sansPrefixe = prefixeDuSet ? nu.replace(new RegExp(`^${prefixeDuSet}(?=\\d)`), '') : nu;
        return [...new Set([cleNumero(sansPrefixe), cleNumero(nu)].filter(Boolean))];
    };
    let cartesSansProduit = 0;
    // 🔑 DEUX PASSES, ET L'ORDRE COMPTE (2026-09-16). Le numéro d'abord pour TOUTES les cartes, le nom ensuite : sinon le repli
    // par nom d'une carte lue tôt prend un produit qu'une carte lue plus tard réclamera par son numéro. SVP Black Star Promos :
    // « Miraidon » sans impression (appartenance par la Setlist seule) prenait les produits n°013 et n°092 déjà joints — 7 produits
    // vers plusieurs cartes. Un produit joint par son NUMÉRO n'est plus offert au nom de personne.
    const etatDeCarte = new Map();
    for (const carte of cartes) {
        // L'appartenance au set a DEUX sources : l'impression déclarée sur la page (jpexpansion=…),
        // ou, à défaut, le seul fait que la Setlist du set a lié cette page (cas des énergies de
        // base, dont la page est générique et ne liste pas chaque tirage). La preuve le dit :
        // 'set+…' quand la page le déclare, 'setlist+…' quand seule la liste du set le dit.
        // `expansionBulba` peut être un nom ou une LISTE de noms (EXS = trois Expansion Sheet) ; `deck`
        // restreint à un deck d'un kit (IPB = « Intro Pack » / « Bulbasaur Deck »).
        const nomsCible = [].concat(cible.expansionBulba);
        // TOUTES les impressions de la page dans ce set : une carte e-Card existe en holo ET en
        // non-holo sous DEUX numéros (Venusaur 033 et 065), et les deux produits s'attachent.
        const imps = (carte.impressions || []).filter(i => i.tirage === cible.tirage && nomsCible.includes(i.expansion) && (!cible.deck || i.deck === cible.deck));
        const imp = imps[0] || null;
        const source = imp ? 'set' : 'setlist';
        let trouves = [];
        let preuve = null, detail = null;
        const numeros = [...new Set(imps.filter(i => i.numero != null && String(i.numero).trim() !== '').flatMap(i => clesImpression(i.numero)))];
        if (numeros.length && parNumero.size) {
            trouves = numeros.flatMap(n => parNumero.get(n) || []);
            preuve = imps.every(i => i.source === 'setlist') ? 'setlist+numero' : 'set+numero'; detail = `n°${numeros.join(', ')} dans l'expansion ${cible.idExpansion}${prefixeDuSet ? ` (préfixe « ${prefixeDuSet} » du set : les deux écritures essayées, ${numsProd.filter(n => /^\d/.test(n)).length} numéros Cardmarket nus sur ${numsProd.length})` : ''}`;
        }
        for (const p of trouves) attache(carte, p, preuve, detail);
        etatDeCarte.set(carte, { imp, imps, source, numeros, joint: trouves.length > 0 });
    }
    // PASSE 2 — le repli par NOM, sur les produits qu'aucun NUMÉRO n'a pris.
    const jointsParNumero = new Set(produitsJoints.keys());
    const candidatsParProduit = new Map();
    for (const carte of cartes) {
        const { imp, imps, source, numeros, joint } = etatDeCarte.get(carte);
        if (joint) continue;
        let trouves = [], preuve = null, detail = null;
        // 🔴 PAS DE REPLI PAR NOM QUAND LE NUMÉRO A ÉTÉ ESSAYÉ (2026-09-15). Une carte qui déclare un numéro dans un catalogue
        // numéroté et ne le trouve pas N'EST PAS dans ce catalogue : la rattacher par son nom prend le produit d'une AUTRE carte
        // du même nom. SWSH (56 produits vers plusieurs cartes) et xsv8a « Additionals », un sous-ensemble de numéros (36),
        // avaient tous deux cette forme. Le repli par nom reste pour les cartes sans numéro déclaré et les catalogues sans numéro.
        const numeroEssaye = numeros.length && parNumero.size;
        if (!trouves.length && carte.nomEn && !numeroEssaye) {
            // Énergies : « Basic Fire Energy » chez Bulbapedia, « Fire Energy » chez Cardmarket.
            // LV.X : « Magmortar » + `level=X` chez Bulbapedia, « Magmortar LV.X » chez Cardmarket.
            // ⚠️ NE PAS DOUBLER LE SUFFIXE. Tant que `nomEn` portait l'ESPÈCE (« Mesprit »), il fallait
            // lui rendre son « LV.X » depuis `level=X`. Depuis que `nomEn` est recomposé sur le nom de
            // la carte (« Mesprit LV.X »), l'ajouter une seconde fois fabrique « Mesprit LV.X LV.X » et
            // fait perdre la jointure : 19 lignes des sets DP au rejeu, toutes des LV.X. Mesuré avant.
            const dejaLvX = /lv\.?\s*x\s*$/i.test(String(carte.nomEn || ''));
            const nomJoint = String(carte.nomEn) + (!dejaLvX && String(carte.niveau || '').toUpperCase() === 'X' ? ' LV.X' : '');
            const clesNom = [...new Set([normaliserNom(nomJoint), normaliserNom(nomJoint.replace(/^Basic\s+/i, ''))])];
            // Une carte qui DÉCLARE une impression dans le set SANS numéro (promo non numérotée), dans un catalogue NUMÉROTÉ, ne vise
            // par son nom qu'un produit SANS numéro : XY-P, Greninja [jp:null] prenait Greninja n°073 (8 produits vers plusieurs
            // cartes). ⚠️ PAS les cartes sans impression déclarée (énergies, pages génériques, « setlist+nom ») : le premier jet
            // les incluait et retirait 1 à 44 jointures sur 19 sets sains au rejeu (WCP 5, s8a-G 8, S-P 44) — refusé.
            const impSansNumero = imp && !imps.some(i => numerote(i.numero));
            for (const k of clesNom) {
                trouves = (parNom.get(k) || [])
                    .filter(p => !jointsParNumero.has(p.idProduct))                                  // déjà désigné par un numéro : il n'est pas à prendre
                    .filter(p => !(impSansNumero && parNumero.size) || !numerote(p.numero));
                if (trouves.length) break;
            }
            if (trouves.length) {
                const noms = new Set((carte.attaques || []).map(a => normaliserNom(a.nom)));
                const concordants = trouves.filter(p => p.attaques.length && p.attaques.every(a => noms.has(normaliserNom(a))));
                if (concordants.length && concordants.length < trouves.length) trouves = concordants;
                const avecAttaques = trouves.every(p => p.attaques.length && p.attaques.every(a => noms.has(normaliserNom(a))));
                preuve = `${source}+nom${avecAttaques ? '+attaques' : ''}`;
                detail = `nom « ${carte.nomEn} »${avecAttaques ? ' + attaques ' + trouves[0].attaques.join(' | ') : ''} dans l'expansion ${cible.idExpansion}${imp ? '' : ' (appartenance par la Setlist seule)'}`;
                // 🔴 « setlist+nom » COUPÉ (2026-09-19), ET LUI SEUL. Une carte qui ne DÉCLARE aucune
                // impression dans cette expansion et qui n'a que son nom à offrir ne prouve rien : c'est
                // la clé qui a rattaché « Bulbasaur-V1-BS44 » à sept cartes Bulbasaur. Mesuré sur les
                // 51 560 lignes avant de couper : 2 049 lignes, dont 1 827 (89 %) sur un produit déjà
                // rattaché à plusieurs cartes ; couper coûte 222 produits qui n'avaient que ça.
                // ⚠️ LES AUTRES RESTENT, ET C'EST LE MÊME CHIFFRE QUI LE DIT : « set+nom » (632 lignes)
                // et « set+nom+attaques » (908) sont à 0 % de produits multi-cartes et feraient perdre
                // 1 536 produits. La carte y DÉCLARE l'impression ; seul le numéro manque. On ne coupe
                // pas un repli parce qu'il est un repli, on coupe celui dont on a mesuré les dégâts.
                if (preuve === 'setlist+nom') { trouves = []; preuve = null; detail = null; }
            }
        }
        for (const p of trouves) {
            if (!candidatsParProduit.has(p.idProduct)) candidatsParProduit.set(p.idProduct, []);
            candidatsParProduit.get(p.idProduct).push({ carte, p, preuve, detail, avecAttaques: /\+attaques$/.test(preuve || '') });
        }
    }
    // 🔴 UN NOM QUI DÉSIGNE PLUSIEURS CARTES NE DÉSIGNE RIEN (2026-09-19). Le départage par les attaques se fait par CARTE :
    // il ne voit pas qu'un même produit a été retenu par trois pages « Gengar » (S-P/CS n°148, 3 produits vers plusieurs
    // cartes). Un produit est UNE carte ; l'ambiguïté est donc tranchée ICI, produit par produit, une fois toutes les cartes
    // vues. Les attaques départagent d'abord ; si elles ne laissent pas UN seul candidat, personne ne prend le produit.
    // C'est le §8 pris à l'endroit : plusieurs candidats après restriction, ce n'est pas une désignation.
    for (const [idProduct, liste] of candidatsParProduit) {
        let retenus = liste;
        if (retenus.length > 1) {
            const avec = retenus.filter(c => c.avecAttaques);
            retenus = avec.length === 1 ? avec : retenus;
        }
        if (retenus.length !== 1) {
            restes.push({ type: 'nom-ambigu', idProduct, detail: `${idProduct} « ${liste[0].p.name} » : ${liste.length} cartes du même nom dans l'expansion ${cible.idExpansion} (${liste.map(c => c.carte._id).join(', ')}) — aucune retenue` });
            continue;
        }
        attache(retenus[0].carte, retenus[0].p, retenus[0].preuve, retenus[0].detail);
    }
    const cartesJointes = new Set(lignes.map(l => l.carteId));
    for (const carte of cartes) {
        if (cartesJointes.has(carte._id)) continue;
        const { imp } = etatDeCarte.get(carte);
        restes.push({ type: 'carte-sans-produit', carteId: carte._id, detail: `« ${carte.nomEn ?? carte.bulba?.titre} » n°${imp?.numero ?? '—'} : aucun produit dans l'expansion ${cible.idExpansion}${imp ? '' : ' (page sans impression déclarée pour ce set)'}` });
        cartesSansProduit++;
    }
    for (const p of produits) {
        const c = produitsJoints.get(p.idProduct);
        if (!c) restes.push({ type: 'produit-sans-carte', idProduct: p.idProduct, detail: `${p.idProduct} « ${p.name} » n°${p.numero ?? '—'}` });
        else if (c.length > 1) restes.push({ type: 'produit-vers-plusieurs-cartes', idProduct: p.idProduct, detail: `${p.idProduct} « ${p.name} » -> cartes ${c.join(', ')}` });
    }
    return {
        lignes, restes,
        compte: { cartes: cartes.length, produits: produits.length, lignes: lignes.length, produitsJoints: produitsJoints.size, cartesSansProduit, restes: restes.length, prefixeRetire: prefixeDuSet }
    };
}

module.exports = { joindre, impressionsDepuisSetlist, numeroDeSetlist, jetonsDeSetlist, produitsDeLExpansion, decomposerNomCardmarket, normaliserNom, chiffresDuNumero, cleNumero };

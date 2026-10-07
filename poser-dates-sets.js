// ============================================================
// LES DATES DE SORTIE DES SETS — celle que le site lit, là où elle manque, et jamais inventée
// ============================================================
//   node poser-dates-sets.js --clone=<clone de tcgdex/cards-database>            (mesure seule, c'est le défaut)
//   node poser-dates-sets.js --clone=<…> --ecrire                                  (par lot-additif.js)
//
// 🔴 POURQUOI (testeur, 2026-09-25, PRIORITÉ 0) : le site range un set sans date sous « Date non renseignée », tout en bas du
// catalogue — Destined Rivals, Prismatic Evolutions et les autres y semblaient ABSENTS. Le site lit (lib/cartes.ts:257) :
// région `jp` → `dateSortieJa`, région `intl` → `dateSortieEn` — y compris pour un set chinois, indonésien ou thaï, rangé `intl` :
// ce champ y porte la date DE CE TIRAGE, jamais celle du jumeau. Mesuré le 2026-09-25 : 683 sets publiés, 434 sans date.
// ⚠️ ADDITIF STRICT : un champ déjà rempli n'est jamais réécrit (le filtre d'écriture l'exige), même illisible pour Date.parse
// (« March 9 / May 25, 2024 », 4 sets) — ceux-là sont LISTÉS.
//
// LES RÈGLES, ÉCRITES AVANT LA MESURE :
// • Tirage `intl` : releaseDate de TCGdex (le DÉPÔT public cloné, aucun appel d'API). Le set TCGdex doit être désigné par AU
//   MOINS DEUX clés indépendantes — l'idExpansion Cardmarket que TCGdex écrit (`thirdParty.cardmarket`), le nom anglais exact
//   (celui d'affichage, « EX » en tête toléré, règle du site scripts/tcgdex-clone.mjs), l'abréviation officielle = notre code —
//   et AUCUNE clé ne doit en désigner un autre. Une seule clé : listé, pas écrit. La page Bulbapedia archivée est TÉMOIN :
//   un autre jour → rien d'écrit (« si les sources divergent, on écrit null, jamais l'une des deux », rapatrier-noms-fr.js).
// • Tirages `jp`, `zh-hans`, `zh-hant`, `id`, `th`, `idth` : l'infobox de la page de set Bulbapedia ARCHIVÉE (R2, zéro requête).
//   Une valeur étiquetée (« Japan: … <br> Korea: … », « '''Traditional Chinese''': … ») donne la date de l'étiquette du tirage ;
//   une valeur SANS étiquette n'est prise que si la page est celle de ce tirage (suffixe (ATCG)/(SCTCG) pour le chinois
//   simplifié, (TCTCG) traditionnel, (ITCG) indonésien, (TTCG) thaï ; pour le japonais, une page sans `enrelease`, qui n'est donc
//   pas partagée avec un set occidental). Pour le japonais, TCGdex (data-asia, même code) est TÉMOIN.
// • Jamais : plusieurs séries sans région (EXS), un jour incomplet, un set de réimpressions (aucune page).
//
// LES DÉCISIONS DU TESTEUR (2026-09-25, soir, et 2026-09-26), écrites comme des règles et appliquées ici, jamais à la main en base :
// • 🔑 « ON ARRÊTE DE BLOQUER LÀ-DESSUS » (2026-09-26, après-midi) : LA DATE DONNÉE PAR LA MAJORITÉ DES SOURCES ; À ÉGALITÉ, LA
//   PLUS TÔT (`majorite`). Une source compte une voix par jour qu'elle donne pour CE tirage (une page IDTH donne l'indonésienne
//   et la thaïe ; deux « parties », deux boîtes) ; un jour connu passe avant un mois seul ; un MOIS seul garde sa précision au
//   mois, sans jour inventé (« 2016-11 ») — il suffit pour ranger. Les sources qui votent : la source officielle (une LIGNE
//   relevée à la main, page lue, citée), l'infobox Bulbapedia, TCGdex désigné par deux clés (`pairerIntl`) ; TCGdex désigné par
//   une seule clé reste TÉMOIN (l'identité du set n'est pas établie) et ne vote pas. Les voix contraires sont ÉCRITES avec la date.
//   Elle remplace le rang du matin (officielle > Bulbapedia > TCGdex), qui ne s'applique plus qu'aux dates déjà posées : un set
//   déjà daté n'est jamais réécrit ici.
// • La sortie EN BOUTIQUE (règle du matin, inchangée) : « (General release) », « (Commercial release) » la disent ; « (Early
//   release) », une avant-première, une sortie en salle ne le sont pas et ne votent pas quand une sortie en boutique existe. Une
//   valeur à plusieurs VERSIONS (« Standard versions », « Pikachu version ») ne se lit que pour un set dont la version est nommée
//   ici (VERSION_DU_SET) : la date d'un AUTRE produit n'est pas une voix.
// • Un set « Additionals » prend la date de son set de BASE (même _id sans « -Additionals »), aucune source ne datant cette
//   catégorie Cardmarket ; la source écrite le dit.
// • Une PÉRIODE de distribution (`period`, promos) : la date de rangement est le DÉBUT de la période, quand il est un jour complet ;
//   la période entière s'écrit dans `periodeDistribution` { texte, debut, fin, debutIso } pour que le site l'affiche. Un début au
//   MOIS seul (« November 2016 ») ne fabrique pas de jour : pas de date, la période seule (`debutIso: "2016-11"`), et la raison.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const r2 = require('./collecte-cartes/r2');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CLONE = arg('clone');
// `--pages=<json>` : des pages de set lues HORS de l'archive R2 (sonde revisionsDe, avec pageid et revid), pour les sets qui n'ont
// pas de `bulba.cleR2` — la voie « sans page ». Clé : l'_id du set (`id`), valeur : { page, revid, content }.
const PAGES = new Map(arg('pages') ? JSON.parse(fs.readFileSync(arg('pages'), 'utf8')).filter(x => x.content).map(x => [x.id, x]) : []);
const MOIS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RE_JOUR = new RegExp(`^(${MOIS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`);

/** Un texte de date Bulbapedia → « Month D, YYYY » (le format des 249 dates en base), ou null s'il n'est pas un jour complet. */
const texteNet = texte => String(texte || '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
function jourComplet(texte) {
    const t = texteNet(texte);
    const m = RE_JOUR.exec(t);
    if (!m) return null;
    const j = Number(m[2]), a = Number(m[3]);
    if (j < 1 || j > 31 || a < 1996 || a > 2030) return null;
    return `${m[1]} ${j}, ${a}`;
}
const depuisIso = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${MOIS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null; };

// Étiquettes de région dans une valeur à plusieurs lignes ; une étiquette inconnue ne désigne rien.
const ETIQUETTES = [
    [/^(japan|japanese)$/i, 'jp'], [/^(english|international|north america|united states|usa|europe)$/i, 'intl'],
    [/^(traditional chinese|taiwan|hong kong)$/i, 'zh-hant'], [/^(simplified chinese|china|mainland china)$/i, 'zh-hans'],
    [/^(indonesian|indonesia)$/i, 'id'], [/^(thai|thailand)$/i, 'th'], [/^(korean|korea|south korea)$/i, 'ko']
];
// Une annotation <small>…</small>, un commentaire HTML (même non fermé : « November 22, 2024<!-- ») ne sont pas la date.
const nettoyer = v => String(v || '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<small>[\s\S]*?<\/small>/gi, '').trim();
// La NATURE d'une date, dite par sa parenthèse : la sortie en boutique, ou ce qui la précède (avant-première, salle de cinéma).
// « (Standard versions) », « (Pikachu version) » : la version d'un produit à plusieurs sorties.
// « (Part 1) », « (Part 2) » : les sorties successives d'un même produit en parties — chacune une sortie en boutique, chacune une voix.
const NATURES = [[/^(general|commercial|retail) release$/i, 'boutique'], [/(early release|pre-?release|theatrical release)/i, 'avant'], [/^part \d+$/i, 'partie']];
function natureDe(annotation) {
    const a = String(annotation || '').trim();
    const n = NATURES.find(([re]) => re.test(a));
    if (n) return n[1];
    const v = /^(.+?) versions?$/i.exec(a);
    return v ? `version:${v[1].trim().toLowerCase()}` : null;
}
function parties(valeur) {
    // Une parenthèse dans <small> (« August 3, 2007 <small>(Commercial release)</small> ») dit la nature de la date : elle est
    // gardée comme parenthèse avant que `nettoyer` retire le reste des <small>.
    const brut = String(valeur || '').replace(/<small>\s*(\([^)]*\))\s*<\/small>/gi, ' $1');
    return nettoyer(brut).split(/<br\s*\/?>/i).map(p => p.trim()).filter(Boolean).map(p => {
        // « January 16, 2026 (CSVM1) » : une parenthèse qui porte un CODE de set est une étiquette (comparée au code de la ligne).
        const pc = /^([\s\S]+?)\s*\(([A-Za-z0-9.+-]{2,12})\)$/.exec(p);
        if (pc && /\d/.test(pc[2]) && /[A-Z]/.test(pc[2])) return { etiquette: `code:${pc[2]}`, texte: pc[1] };
        // « March 8, 2024 (Japan) » : une parenthèse qui nomme une RÉGION connue est une étiquette ; une NATURE (« (General
        // release) », « (Standard versions) ») est lue à part ; toute autre (« (Part 1) ») reste dans le texte, qui n'est alors plus
        // un jour complet — rien n'est deviné.
        const pr = /^([\s\S]+?)\s*\(([A-Za-z0-9 .]+)\)$/.exec(p);
        const er = pr && ETIQUETTES.find(([re]) => re.test(pr[2].trim()));
        if (er) return { etiquette: er[1], texte: pr[1] };
        const na = pr && natureDe(pr[2]);
        if (na) return { etiquette: null, texte: pr[1], nature: na, annotation: pr[2].trim() };
        // Une autre parenthèse (« (Journey) », « (Scare) ») : le nom d'un sous-produit — elle ne vote que si TOUTES les valeurs de la
        // clé en portent une (une liste de boîtes), jamais seule (« (tentative) » n'est pas une sortie).
        if (pr && jourComplet(pr[1])) return { etiquette: null, texte: pr[1], nature: 'sous-produit', annotation: pr[2].trim() };
        // « '''Leafeon Box '''/''' Glaceon Box:''' January 11, 2023 » (CSMYC) : une étiquette peut nommer deux boîtes.
        const m = /^(?:'''?)?([A-Za-z][A-Za-z0-9 ./']*?)(?:'''?)?\s*:\s*(?:'''?)?\s*([\s\S]+)$/.exec(p);
        if (!m) return { etiquette: null, texte: p };
        const lib = m[1].replace(/'+/g, '').replace(/\s+/g, ' ').trim();
        const e = ETIQUETTES.find(([re]) => re.test(lib));
        return { etiquette: e ? e[1] : `?${lib}`, texte: m[2] };
    });
}
const SUFFIXE_PAGE = { 'zh-hans': /\((ATCG|SCTCG)\)$/, 'zh-hant': /\(TCTCG\)$/, id: /\(ITCG\)$/, th: /\(TTCG\)$/ };

// LES SOURCES OFFICIELLES, une ligne par set : la page LUE, la phrase citée, le jour qu'elle donne. Relevées à la main (une requête
// par page, espacées), jamais déduites. Elles passent avant toute autre source (règle du testeur, 2026-09-26).
const BLK_WHT = { jour: 'July 18, 2025', url: 'https://press.pokemon.com/en/releases/Pokemon-Reveals-New-Split-Expansion-Launching-Soon-for-the-Pokemon-Tra', citation: 'en boutique le 18 juillet 2025 ; le 17 juillet est la sortie sur Pokémon TCG Live', lu: '2026-09-25' };
const OFFICIELLES = {
    'Black-Bolt': BLK_WHT,
    'White-Flare': BLK_WHT,
    'Champion-Road': { jour: 'May 3, 2018', url: 'https://www.pokemon-card.com/products/sm/sm6b.html', citation: '発売日 2018年5月3日（祝・木）', lu: '2026-09-26' },
    'Thunderclap-Spark': { jour: 'July 6, 2018', url: 'https://www.pokemon-card.com/products/sm/sm7a.html', citation: '発売日 2018年7月6日（金）', lu: '2026-09-26' },
    'Scarlet-Violet-ex-Special-Set': { jour: 'May 19, 2023', url: 'https://www.pokemon-card.com/products/sv/svp1.html', citation: '発売日 2023年5月19日（金）', lu: '2026-09-26' },
    // Une page pour les trois « スターターセットex » (ニャオハ＆ルカリオex, ホゲータ＆デンリュウex, クワッス＆ミミッキュex), un seul jour.
    'ex-Starter-Set-Sprigatito-Lucario-ex': { jour: 'January 20, 2023', url: 'https://www.pokemon-card.com/ex/sva/index.html', citation: '発売日 2023年1月20日（金）', lu: '2026-09-26' },
    'ex-Starter-Set-Quaxly-Mimikyu-ex': { jour: 'January 20, 2023', url: 'https://www.pokemon-card.com/ex/sva/index.html', citation: '発売日 2023年1月20日（金）', lu: '2026-09-26' },
    'Play-Pokemon-Prize-Pack-Series-Three': { jour: 'August 14, 2023', url: 'https://www.pokemon.com/us/pokemon-news/visit-your-local-game-store-to-receive-play-pokemon-prize-packs', citation: 'the Prize Pack Series Three will be available starting August 14, 2023', lu: '2026-09-26' }
};
// ➕ 2026-10-04 (« il reste 35 sets que toi seul peux dater — mois et année suffisent ») : Bulbapedia répond 403 (2026-10-03 et
// 04, 2 requêtes, témoin robots.txt 403 aussi) — les pages de ces sets, jamais archivées chez nous (voie « sans page »), ont été lues
// dans leur COPIE de la Wayback Machine (archive.org, 47 requêtes séquentielles à 5 s), infobox rendue, À L'ŒIL. C'est la source
// Bulbapedia (elle vote comme elle), à la date de sa copie ; la ligne cite la valeur lue. `remplace` : la page archivée chez nous
// est lue, mais sa valeur ne passait pas la règle pour une raison relue ici (dite dans `pourquoi`).
const W = 'http://web.archive.org/web/';
// ➕ 2026-10-05 (demande du site, feu vert du testeur : « date les 38 sets créés ce soir, mois et année suffisent ») : les sets créés par
// creer-sets-sans-page.js n'ont aucune page chez nous. Leurs pages Bulbapedia ont été TROUVÉES par l'API CDX d'archive.org (préfixe
// d'adresse : une énumération des pages archivées, pas un titre deviné — cdx-decouverte.js, 30 requêtes) et LUES dans leur copie (47
// requêtes à 5–10 s). Chaque ligne dit pourquoi la page est CELLE de ce produit ; ce qui ne le prouve pas n'est pas ici : Intro Pack (la
// page ne nomme pas Squirtle), les trois « MEGA Starter Set » 2026 (la page des ex Starter Sets 2026 ne les nomme pas), Premium Trainer
// Box (la page est celle de 2016, pas la VSTAR), Family Pokémon Card Game (la copie est une page de défi Cloudflare).
const RELEVES_SETS_CREES = {
    'SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales': { jour: 'June 1, 2018', url: `${W}20260818123040/https://bulbapedia.bulbagarden.net/wiki/Sun_%26_Moon_Trainer_Kit:_Alolan_Sandslash_%26_Alolan_Ninetales_(TCG)`, citation: 'Release date June 1, 2018 — « It was released on June 1, 2018 »' },
    'Movie-Commemoration-VS-Pack-Auras-Lucario': { jour: 'July 16, 2005', url: `${W}20260704122610/https://bulbapedia.bulbagarden.net/wiki/Movie_Commemoration_VS_Pack:_Aura%27s_Lucario_(TCG)`, citation: 'Release date July 16, 2005 — « first released on July 16, 2005 exclusively to the Pokémon Center stores in Japan »' },
    'Movie-Commemoration-VS-Pack-Sky-Splitting-Deoxys': { jour: 'July 17, 2004', url: `${W}20260820044150/https://bulbapedia.bulbagarden.net/wiki/Movie_Commemoration_VS_Pack:_Sky-Splitting_Deoxys_(TCG)`, citation: 'Release date July 17, 2004 (Japanese-exclusive Half Deck)' },
    'Starter-Set-ex-Marnies-Morpeko-Grimmsnarl-ex': { jour: 'February 21, 2025', url: `${W}20260802171213/https://bulbapedia.bulbagarden.net/wiki/Ex_Starter_Set_Marnie%27s_Morpeko_%26_Grimmsnarl_ex_(TCG)`, citation: 'Release date — Japanese: February 21, 2025 (Traditional Chinese: March 7, 2025)' },
    'Starter-Set-ex-Stevens-Beldum-Metagross-ex': { jour: 'February 21, 2025', url: `${W}20260619184441/https://bulbapedia.bulbagarden.net/wiki/Ex_Starter_Set_Steven%27s_Beldum_%26_Metagross_ex_(TCG)`, citation: 'Release date — Japanese: February 21, 2025 (Traditional Chinese: March 7, 2025)' },
    'ex-Starter-Set-Pikachu-ex-Pawmot': { jour: 'March 24, 2023', url: `${W}20260618045746/https://bulbapedia.bulbagarden.net/wiki/Ex_Starter_Set_Pikachu_ex_%26_Pawmot_(TCG)`, citation: 'Release date — Japanese: March 24, 2023 (Korean: April 22, 2023 ; Traditional Chinese: April 28, 2023)' },
    // le titre du deck redirige vers la page commune des trois ex Starter Sets de janvier 2023 (ses deux voisins sont datés du même jour
    // par pokemon-card.com, plus haut)
    'ex-Starter-Set-Fuecoco-Ampharos-ex': { jour: 'January 20, 2023', url: `${W}20251102162135/https://bulbapedia.bulbagarden.net/wiki/Ex_Starter_Set_Fuecoco_%26_Ampharos_ex_(TCG)`, citation: 'redirige vers « ex Starter Sets (TCG) » — Release date Japanese: January 20, 2023' },
    'Eevee-GX-Starter-Sets': { jour: 'November 23, 2018', url: `${W}20260826235949/https://bulbapedia.bulbagarden.net/wiki/Eevee-GX_Starter_Sets_(TCG)`, citation: 'Release date November 23, 2018 — « a trio of Japanese-exclusive Standard Decks … released on November 23, 2018 »' },
    'V-UNION-Special-Card-Sets': { jour: 'August 20, 2021', url: `${W}20260714034052/https://bulbapedia.bulbagarden.net/wiki/V-UNION_Special_Card_Sets_(TCG)`, citation: 'Release date — Japanese: August 20, 2021' },
    // la page nomme les deux boîtes : Overgrow (茂, Florizarre) et Torrent (激, Tortank), une même sortie, exclusivité chinois simplifié
    'Primordial-Arts-Deck-Building-Gift-Box-Blastoise': { jour: 'November 17, 2023', url: `${W}20260825024441/https://bulbapedia.bulbagarden.net/wiki/Primordial_Arts_Deck_Building_Gift_Boxes_(ATCG)`, citation: 'Release date November 17, 2023 — « Deck Building Box Torrent (卡牌构筑礼盒 洪荒演武 激) », Simplified Chinese-exclusive' },
    'Primordial-Arts-Deck-Building-Gift-Box-Venusaur': { jour: 'November 17, 2023', url: `${W}20260825024441/https://bulbapedia.bulbagarden.net/wiki/Primordial_Arts_Deck_Building_Gift_Boxes_(ATCG)`, citation: 'Release date November 17, 2023 — « Deck Building Box Overgrow (卡牌构筑礼盒 洪荒演武 茂) », Simplified Chinese-exclusive' },
    // deux collections 2018, deux pays : la France (MCD18F ; TCGdex « 2018sm-fr » 2018-06-13, témoin concordant) et les États-Unis (MCD18 ;
    // TCGdex « 2018sm » 2018-10-19)
    'McDonalds-Collection-2018': { periode: { texte: 'June 13 - July 10, 2018 (France)', debut: 'June 13, 2018', fin: 'July 10, 2018', debutIso: '2018-06-13' }, url: `${W}20260618083654/https://bulbapedia.bulbagarden.net/wiki/McDonald%27s_Collection_2018_(TCG)`, citation: 'Release period June 13 - July 10, 2018 (France)' },
    'McDonald-s-Collection-2018-2': { periode: { texte: 'October 16 - November 12, 2018 (US)', debut: 'October 16, 2018', fin: 'November 12, 2018', debutIso: '2018-10-16' }, url: `${W}20260618083654/https://bulbapedia.bulbagarden.net/wiki/McDonald%27s_Collection_2018_(TCG)`, citation: 'Release period October 16 - November 12, 2018 (US)' },
    'McDonalds-Collection-2011': { jour: 'June 17, 2011', url: `${W}20260614221654/https://bulbapedia.bulbagarden.net/wiki/McDonald%27s_Collection_2011_(TCG)`, citation: 'Release date — English: June 17, 2011 (« from 17 June to 7 July, 2011 »)' },
    // la MÊME page donne la sortie japonaise de la collection : « コレクションシート 旅立ちの仲間 Collection Sheet Journey Partners »
    'Collection-Sheet-Journey-Partners': { jour: 'September 18, 2010', url: `${W}20260614221654/https://bulbapedia.bulbagarden.net/wiki/McDonald%27s_Collection_2011_(TCG)`, citation: 'Release date — Japanese: September 18, 2010 (« Japanese: コレクションシート 旅立ちの仲間 Collection Sheet Journey Partners »)' },
    'McDonalds-Collection-25th-Anniversary': { periode: { texte: 'From February 9, 2021', debut: 'February 9, 2021', fin: null, debutIso: '2021-02-09' }, url: `${W}20260813145141/https://bulbapedia.bulbagarden.net/wiki/McDonald%27s_Collection_2021_(TCG)`, citation: 'Release period From February 9, 2021 — « to celebrate Pokémon 25th Anniversary », U.S.' },
    // le titre « PokéPark Forest » redirige vers les PokéPark Premium Files : deux classeurs de 9 cartes, sortis le même jour
    'PokePark-Forest': { jour: 'March 18, 2005', url: `${W}20260908202012/https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9Park_Forest_(TCG)`, citation: 'redirige vers « PokéPark Premium Files (TCG) » — Release date March 18, 2005 (« a special pair of promotional file folders … Each file folder contains 9 exclusive cards »)' },
    // « Sword Shield Starter Decks » de Cardmarket, code sA = « スターターセットV Starter Set V »
    'Sword-Shield-Starter-Decks': { jour: 'November 29, 2019', url: `${W}20260825022048/https://bulbapedia.bulbagarden.net/wiki/V_Starter_Sets_(TCG)`, citation: 'Release date November 29, 2019 — « The V Starter Sets (Japanese: スターターセットV Starter Set V) … five Japanese & Korean Standard Decks »' },
    'DP-Trainer-Kit': { jour: 'September 24, 2007', url: `${W}20260904223627/https://bulbapedia.bulbagarden.net/wiki/Diamond_%26_Pearl_Trainer_Kit_(TCG)`, citation: 'Release date September 24, 2007 — « released in English and European languages only »' },
    // le Gift Box japonais de 2003 : deux demi-decks, Latias ex et Latios ex (« Latias ex and Latios ex differ from their Rulers of the
    // Heavens counterparts by featuring alternate artwork »)
    'Gift-Box-Latias-ex': { jour: 'November 17, 2003', url: `${W}20141028085019/https://bulbapedia.bulbagarden.net/wiki/Latias_%26_Latios_Gift_Set_(TCG)`, citation: 'redirige vers « Gift Box (TCG) » — Release date November 17, 2003 ; la boîte contient les demi-decks Latias ex et Latios ex' },
    'Gift-Box-Latios-ex': { jour: 'November 17, 2003', url: `${W}20141028085019/https://bulbapedia.bulbagarden.net/wiki/Latias_%26_Latios_Gift_Set_(TCG)`, citation: 'redirige vers « Gift Box (TCG) » — Release date November 17, 2003 ; la boîte contient les demi-decks Latias ex et Latios ex' },
    'M-P-Simplified-Chinese-Promos': { periode: { texte: 'August 7, 2026 - present', debut: 'August 7, 2026', fin: null, debutIso: '2026-08-07' }, url: `${W}20260804205126/https://bulbapedia.bulbagarden.net/wiki/M-P_Promotional_cards_(SCTCG)`, citation: 'Release period August 7, 2026 - present (Simplified Chinese M-P promos)' },
    // ➕ 2026-10-06 (testeur : « date ADV-Expansion-Pack, Celebrations et Master-Kit ») : pages trouvées par l'API CDX (préfixe d'adresse,
    // une seule adresse archivée chacune) et lues dans leur copie — 6 requêtes à archive.org, aucune à Bulbapedia
    // ⚠️ la copie de Celebrations date du 31/07/2021, AVANT la sortie : c'est la date ANNONCÉE à ce jour-là (la sortie a eu lieu à cette date)
    'Celebrations': { jour: 'October 8, 2021', url: `${W}20210731122832/https://bulbapedia.bulbagarden.net/wiki/Celebrations_(TCG)`, citation: 'Release date — English: October 8, 2021 (Japanese: October 22, 2021, « 25th Anniversary Collection »)' },
    'ADV-Expansion-Pack': { jour: 'January 31, 2003', url: `${W}20111022084705/http://bulbapedia.bulbagarden.net:80/wiki/ADV_Expansion_Pack_(TCG)`, citation: 'Release date — Japanese: January 31, 2003 (English, EX Ruby & Sapphire: June 18, 2003)' },
    'Master-Kit': { jour: 'July 15, 2005', url: `${W}20110410123512/http://bulbapedia.bulbagarden.net:80/wiki/Master_Kit_(TCG)`, citation: 'Release date July 15, 2005 — « a special deck kit … released in Japan only »' }
};
const RELEVES_BULBAPEDIA = {
    ...RELEVES_SETS_CREES,
    'Space-Time-Creation': { jour: 'November 30, 2006', url: `${W}20260901065003/https://bulbapedia.bulbagarden.net/wiki/Space-Time_Creation_(TCG)`, citation: 'Release date — Japanese: November 30, 2006 (page commune « Diamond & Pearl (TCG) »)' },
    'Entry-Pack-08': { jour: 'November 30, 2007', url: `${W}20260831214743/https://bulbapedia.bulbagarden.net/wiki/Entry_Pack_%2708_(TCG)`, citation: 'Release date November 30, 2007 (Japanese-exclusive)' },
    'Heatran-vs-Regigigas-Deck-Kit': { jour: 'March 14, 2008', url: `${W}20260831214748/https://bulbapedia.bulbagarden.net/wiki/Heatran_vs_Regigigas_Deck_Kit_(TCG)`, citation: 'Release date March 14, 2008 (Japanese-exclusive)' },
    'Magmortar-vs-Electivire-Deck-Kit': { jour: 'October 26, 2007', url: `${W}20260723055242/https://bulbapedia.bulbagarden.net/wiki/Magmortar_vs_Electivire_Deck_Kit_(TCG)`, citation: 'Release date October 26, 2007 (Japanese-exclusive)' },
    'Dialga-LVX-Constructed-Standard-Deck': { jour: 'July 5, 2007', url: `${W}20260831214743/https://bulbapedia.bulbagarden.net/wiki/Dialga_LV.X_Constructed_Standard_Deck_(TCG)`, citation: 'Release date July 5, 2007 (Japanese-exclusive)' },
    'Palkia-LVX-Constructed-Standard-Deck': { jour: 'July 5, 2007', url: `${W}20260831214743/https://bulbapedia.bulbagarden.net/wiki/Palkia_LV.X_Constructed_Standard_Deck_(TCG)`, citation: 'Release date July 5, 2007 (Japanese-exclusive)' },
    'Nivi-City-Gym': { jour: 'April 26, 1998', url: `${W}20260826022011/https://bulbapedia.bulbagarden.net/wiki/Nivi_City_Gym_(TCG)`, citation: 'Release date April 26, 1998 (Japanese-exclusive)' },
    'Kuchiba-City-Gym': { jour: 'July 25, 1998', url: `${W}20260805185541/https://bulbapedia.bulbagarden.net/wiki/Kuchiba_City_Gym_(TCG)`, citation: 'Release date July 25, 1998 (Japanese-exclusive)' },
    'Tamamushi-City-Gym': { jour: 'July 25, 1998', url: `${W}20260731125139/https://bulbapedia.bulbagarden.net/wiki/Tamamushi_City_Gym_(TCG)`, citation: 'Release date July 25, 1998 (Japanese-exclusive)' },
    'Yamabuki-City-Gym': { jour: 'February 26, 1999', url: `${W}20260511084421/https://bulbapedia.bulbagarden.net/wiki/Yamabuki_City_Gym_(TCG)`, citation: 'Release date February 26, 1999 (Japanese-exclusive)' },
    'Guren-Town-Gym': { jour: 'February 26, 1999', url: `${W}20260825183720/https://bulbapedia.bulbagarden.net/wiki/Guren_Town_Gym_(TCG)`, citation: 'Release date February 26, 1999 (Japanese-exclusive)' },
    // deux sorties japonaises, deux voix : la plus tôt à égalité (règle du testeur)
    'ex-Start-Decks': { jours: ['July 7, 2023', 'November 24, 2023'], url: `${W}20260125033233/https://bulbapedia.bulbagarden.net/wiki/Ex_Start_Decks_(TCG)`, citation: 'Release date — Japanese: July 7, 2023 (basic and Random decks), November 24, 2023 (Tera decks)' },
    'Gem-Pack-Vol-1': { jour: 'January 17, 2025', url: `${W}20260722202107/https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._1_(ATCG)`, citation: 'Release date January 17, 2025 (Simplified Chinese)' },
    'Gem-Pack-Vol-4': { jour: 'February 6, 2026', url: `${W}20260720153007/https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._4_(ATCG)`, citation: 'Release date February 6, 2026 (Simplified Chinese)' },
    'Gem-Pack-Vol5': { jour: 'April 24, 2026', url: `${W}20260810102221/https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._5_(ATCG)`, citation: 'Release date April 24, 2026 (Simplified Chinese)' },
    'Gem-Pack-Vol-6': { jour: 'August 7, 2026', url: `${W}20260813035327/https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._6_(ATCG)`, citation: 'Release date August 7, 2026 (Simplified Chinese)' },
    'Tag-Team-Collection': { jour: 'July 10, 2020', remplace: true, url: `${W}20260810072644/https://bulbapedia.bulbagarden.net/wiki/Tag_Team_Collection_(ATCG)`, citation: 'Release date July 10, 2020 — « (Indonesian: Matahari & Bulan: Koleksi TAG TEAM) … exclusively available » in Indonesia', pourquoi: 'la page « (ATCG) » est celle du tirage indonésien (elle le dit) : la règle du suffixe la réservait au chinois' },
    // le début n'a pas d'année : celle de la fin (règle du site, DEMANDE-SERVICE-PRODUITS.md du 2026-10-03, McDonald's Minimum Pack)
    'McDonalds-Collection-2013': { periode: { texte: 'October 13 - November 26, 2013', debut: 'October 13, 2013', fin: 'November 26, 2013', debutIso: '2013-10-13' }, remplace: true, url: 'archive R2 de « McDonald\'s Collection 2013 (TCG) »', citation: 'date=October 13th-November 26th, 2013', pourquoi: 'le début de la période n\'écrit pas son année : c\'est celle de la fin' },
    'W-Promos': { periode: { texte: 'September 1999 - March 2001', debut: 'September 1999', fin: 'March 2001', debutIso: '1999-09' }, url: `${W}20260802004115/https://bulbapedia.bulbagarden.net/wiki/W_Promotional_cards_(TCG)`, citation: 'Release period September 1999 - March 2001' },
    'Collect-151': { jour: 'January 17, 2025', remplace: true, url: 'archive R2 de « Collection 151 (ATCG) »', citation: 'release=January 17, 2025 (Journey)<br>April 18, 2025 (Hope)<br>July 18, 2015 (Scare)<br>October 17, 2025 (Gather)', pourquoi: 'quatre boîtes ; « July 18, 2015 (Scare) » est une COQUILLE (entre avril et octobre 2025, dans une série de 2025) — la plus tôt des vraies sorties est le 17 janvier 2025' }
};
for (const v of Object.values(RELEVES_BULBAPEDIA)) v.lu = '2026-10-04';
// ➕ 2026-10-07 (demande du site : « 51 sets sans date, dont les 11 créés cette nuit : date-les, mois et année suffisent, sous la garde ») :
// pages lues dans leur COPIE Wayback (archive.org seulement, une requête toutes les 10 s ; aucune à Bulbapedia), infobox et phrase de
// sortie relues à l'œil ; chaque ligne dit pourquoi la page est celle de CE produit. DEUX REFUS DU 2026-10-05 TOMBENT À LA RELECTURE : la
// page « Intro Pack » NOMME le deck Squirtle (« the cards in the Squirtle Deck have a black number in a white circle ») — le refus avait été
// écrit sur l'infobox seule ; et la copie du 2026-09-01 de « ex Starter Sets 2026 » NOMME les trois decks (celle de juin ne le faisait pas).
const P = t => `https://bulbapedia.bulbagarden.net/wiki/${t}`;
const RELEVES_2026_10_07 = {
    'Intro-Pack-Squirtle': { jour: 'July 30, 1999', url: `${W}20260802191020/${P('Intro_Pack_(TCG)')}`, citation: 'Release date July 30, 1999 — la page porte les deux Half Decks, Bulbasaur et Squirtle (« the cards in the Squirtle Deck have a black number in a white circle »)' },
    ...Object.fromEntries([['MEGA-Starter-Set-Eevee-ex', 'Eevee ex'], ['MEGA-Starter-Set-Zorua-Zoroark-ex', 'Zorua & Zoroark ex'], ['MEGA-Starter-Set-Sprigatito-Meowscarada-ex', 'Sprigatito & Meowscarada ex']].map(([id, deck]) => [id, {
        jour: 'July 31, 2026', url: `${W}20260901020426/${P('Ex_Starter_Sets_2026_(TCG)')}`, citation: `Release date — Japanese: July 31, 2026 ; « ex Starter Set ${deck} », l'un des trois decks (Eevee ex · Zorua & Zoroark ex · Sprigatito & Meowscarada ex)`,
        pourquoi: 'Cardmarket nomme ces trois decks « MEGA Starter Set … » : les mêmes trois Pokémon ex, un set par deck' }])),
    'Beginning-Set-Plus': { jour: 'August 5, 2011', url: `${W}20260905191819/${P('Beginning_Set_+_(TCG)')}`, citation: 'redirige vers « Beginning Set (TCG) » — Release date … August 5, 2011 (Plus version) ; « An enhanced version of the standard Beginning Set was released on August 5, 2011 as the Beginning Set + (Plus) »' },
    'World-Championships-2023-Yokohama-Deck-Pikachu': { jour: 'July 28, 2023', url: `${W}20260907153056/${P('2023_Pokémon_World_Championships_Yokohama_Deck:_Pikachu_(TCG)')}`, citation: 'Release date — Japanese: July 28, 2023 (« released alongside the Japanese Ruler of the Black Flame expansion on July 28, 2023 »)' },
    'P-Promos': { periode: { texte: 'July 2001 - July 2002', debut: 'July 2001', fin: 'July 2002', debutIso: '2001-07' }, url: `${W}20260513164655/${P('P_Promotional_cards_(TCG)')}`, citation: 'Release period July 2001 - July 2002' },
    'PLAY-Promos': { periode: { texte: 'January 2003 - January 2006', debut: 'January 2003', fin: 'January 2006', debutIso: '2003-01' }, url: `${W}20260131080859/${P('PLAY_Promotional_cards_(TCG)')}`, citation: 'Release period January 2003 - January 2006 (Pokémon Players Club)' },
    'PPP-Promos': { periode: { texte: 'May 2007', debut: 'May 2007', fin: null, debutIso: '2007-05' }, url: `${W}20260804041215/${P('PPP_Promotional_cards_(TCG)')}`, citation: 'Release period May 2007 (Pokémon Players Club)' },
    'Arceus-LVX-Deck-Lightning-Psychic': { jour: 'July 8, 2009', url: `${W}20260704173230/${P('Arceus_LV.X_Deck:_Lightning_&_Psychic_(TCG)')}`, citation: 'Release date July 8, 2009 (Japanese-exclusive Standard Deck)' },
    'Melee-Pokemon-Scramble': { jour: 'July 10, 2009', url: `${W}20260618084242/${P('Melee!_Pokémon_Scramble_(TCG)')}`, citation: 'redirige vers « Pokémon Rumble (TCG) » — Release date English: December 2, 2009, Japanese: July 10, 2009 (« 乱戦！ポケモンスクランブル×ポケモンカードゲーム ») ; set japonais : la date japonaise' },
    'McDonalds-Collection-2019-2': { periode: { texte: 'From October 30, 2019 (France)', debut: 'October 30, 2019', fin: null, debutIso: '2019-10-30' }, url: `${W}20260607144826/${P("McDonald's_Collection_2019_(TCG)")}`,
        citation: 'Release period … From October 30, 2019 (France) — « a separate collection was released in France from October 30, 2019 » : 40 cartes, Non Holofoil et Confetti Holofoil', pourquoi: 'MCD19F : le « F » de MCD18F (France), et 80 produits = les 40 cartes françaises en deux versions' },
    'Master-Strategy-Deck-Building-Sets-Vol-2': { jour: 'July 16, 2026', url: `${W}20260813035340/${P('Master_Strategy_Deck_Building_Sets_(ATCG)')}`, citation: 'Release date January 16, 2026 (CSVM1), July 16, 2026 (CSVM2) — « the second deck sets (CSVM2) … were released on July 16, 2026 »' },
    // créé le 2026-10-07 (creer-sets-sans-page.js, cartes déclarantes)
    'My-First-Battle': { jour: 'September 29, 2023', url: `${W}20260711221239/${P('My_First_Battle_(TCG)')}`, citation: 'Release date September 29, 2023 — « Two versions were released on September 29, 2023, one featuring Pikachu & Bulbasaur and the other Charmander & Squirtle »' },
    'Hanada-City-Gym': { jour: 'April 26, 1998', url: `${W}20260824174546/${P('Hanada_City_Gym_(TCG)')}`, citation: 'Release date April 26, 1998 (Japanese-exclusive Standard Deck, Leaders\' Stadium)' },
    'Best-of-Game-Cards-Promos': { periode: { texte: 'December 2002 - July 2003', debut: 'December 2002', fin: 'July 2003', debutIso: '2002-12' }, url: `${W}20251013115425/${P('Best_of_Game_Cards_(TCG)')}`, citation: '« Best of Game (TCG) » — Release period December 2002 - July 2003 (TCGdex « bog », une clé : 2002-12-01, même mois)' },
    'Trick-or-Trade': { jour: 'September 1, 2022', url: `${W}20260819163945/${P('Trick_or_Trade_2022_(TCG)')}`, citation: '« The 2022 Trick or Trade release is a set of 30 cards … first released on September 1, 2022 in Canada, the U.S. and the UK »',
        pourquoi: 'les 30 produits Cardmarket « Trick or Trade » sont les 30 cartes de 2022 ; les éditions 2023 et 2024 sont des sets à part' },
    ...Object.fromEntries(['30th-Celebration-Simplified-Chinese', '30th-Celebration-IDTH'].map(id => [id, { jour: 'September 16, 2026', remplace: true, url: `${W}20260910024556/${P('30th_Celebration_(TCG)')}`,
        citation: '« Releasing simultaneously worldwide on September 16, 2026 » ; « 30th Celebration is the first set to be released globally on the same day—including in Simplified Chinese »',
        pourquoi: 'la valeur de l\'infobox n\'a pas d\'étiquette de tirage ; le texte de la page dit la sortie mondiale le même jour, et porte les listes chinoise, thaïe et indonésienne' }]))
};
// LES WCD (même demande) : Cardmarket fait UN set par année de championnat ; Bulbapedia, une page par DECK, et chaque page dit « X is one of
// the four <année> World Championships Decks, released … ». La date d'un set WCD-<année> est celle des decks de cette année, lue sur la page
// d'un de ses decks (liste des decks par année : « World Championships Deck (TCG) », copie du 2026-08-10). Depuis 2022, les decks d'une
// année sortent l'année suivante : c'est ce que les pages disent, et c'est ce qui est écrit. Un mois seul reste un mois (dateSortieMois).
const WCD = [[2004, 'Magma_Spirit_(TCG)', '20260830162735', 'November 2004', 'Magma Spirit is one of the four 2004 World Championships Decks, released in November 2004'],
    [2005, 'Queendom_(TCG)', '20260831042743', 'October 31, 2005', 'It is one of the four 2005 World Championships Decks, released on October 31st, 2005'],
    [2006, 'Mewtrick_(TCG)', '20260829043011', 'October 31, 2006', 'Mewtrick is one of the four 2006 World Championships Decks, released on October 31st, 2006'],
    [2007, 'Flyvees_(TCG)', '20260913002058', 'November 19, 2007', 'It is one of the four 2007 World Championships Decks, released on November 19, 2007'],
    [2008, 'Intimidation_(TCG)', '20260913002058', 'November 5, 2008', 'Intimidation is one of the four 2008 World Championships Decks, released on November 5, 2008'],
    [2009, 'Stallgon_(TCG)', '20260913002058', 'October 28, 2009', 'Stallgon is one of the four 2009 World Championships Decks, released on October 28, 2009'],
    [2010, 'LuxChomp_of_the_Spirit_(TCG)', '20260831043111', 'November 2010', 'LuxChomp of the Spirit is one of the four 2010 World Championships Decks, released in November 2010'],
    [2011, 'Megazone_(TCG)', '20260913002058', 'October 2011', 'Megazone is one of the four 2011 World Championships Decks released in October 2011'],
    [2012, 'Pesadelo_Prism_(TCG)', '20260905222332', 'November 2012', 'It is one of the four 2012 World Championships Decks, released in November 2012'],
    [2013, 'Darkrai_Deck_(TCG)', '20260811194027', 'November 4, 2013', 'It is one of the four 2013 World Championships Decks, released on November 4, 2013'],
    [2014, 'Plasma_Power_(TCG)', '20260831042743', 'November 2014', 'It is one of the four 2014 World Championships Decks, released in November 2014'],
    [2015, 'Honorstoise_(TCG)', '20260830005322', 'November 2015', 'It is one of the four 2015 World Championships Decks, released in November 2015 (Punches \'n\' Bites, copie 20260830162637 : idem)'],
    [2016, 'Bebe_Deck_(TCG)', '20260831042743', 'November 2016', 'It is one of the four 2016 World Championships Decks, released in November 2016'],
    [2017, 'Ice_Path_FTW_(TCG)', '20260831042726', 'November 17, 2017', 'It is one of the 2017 World Championships Decks, released November 17, 2017'],
    [2018, 'Victory_Map_(TCG)', '20260830005326', 'November 14, 2018', 'It is one of the 2018 World Championships Decks released November 14, 2018'],
    [2019, 'Mind_Blown_(TCG)', '20260811194032', 'November 22, 2019', 'It is one of the 2019 World Championships Decks released November 22, 2019'],
    [2022, 'Ice_Rider_Palkia_(TCG)', '20260425212914', 'March 3, 2023', 'It is one of the 2022 World Championships Decks released March 3, 2023'],
    [2023, "Mew's_Revenge_(TCG)", '20260905222312', 'March 1, 2024', 'It is one of the 2023 World Championship Decks released March 1, 2024'],
    [2024, 'Ancient_Toolbox_(TCG)', '20260913002058', 'May 16, 2025', 'It is one of the 2024 World Championship Decks released on May 16, 2025'],
    [2025, 'Flutter_Devo_Gardevoir_(TCG)', '20260913002117', 'June 19, 2026', 'It is one of the 2025 World Championship Decks released on June 19, 2026']];
for (const [a, page, copie, quand, phrase] of WCD) RELEVES_2026_10_07[`WCD-${a}`] = { jour: quand, url: `${W}${copie}/${P(page)}`, citation: `« ${phrase} »`, pourquoi: `un set Cardmarket par année : la sortie des decks ${a}` };
for (const [k, v] of Object.entries(RELEVES_2026_10_07)) RELEVES_BULBAPEDIA[k] = { ...v, lu: '2026-10-07' };
// La version qu'un set désigne, quand sa page date plusieurs versions du même produit : le nom Cardmarket la porte (« … Pikachu »),
// ou le set est le produit de base (« Standard »).
const VERSION_DU_SET = { 'Beginning-Set-Pikachu': 'pikachu', 'Beginning-Set': 'standard', 'XY-Beginning-Set': 'standard' };

/**
 * LA MAJORITÉ DES SOURCES, LA PLUS TÔT À ÉGALITÉ (testeur, 2026-09-26, après-midi). Une voix = (source, date) : une source qui
 * donne deux dates pour ce tirage vote pour les deux. Un jour connu passe avant un mois seul ; sans aucun jour, le mois décide.
 * @param {Array<{source: string, iso: string, de?: string}>} votes   iso « AAAA-MM-JJ » ou « AAAA-MM »
 * @returns {{iso, precision: 'jour'|'mois', voix: number, sources: string[], de: string[], egalite: boolean, contre: string[]}|null}
 */
function majorite(votes) {
    const lus = votes.filter(v => /^\d{4}-\d{2}(-\d{2})?$/.test(v.iso || ''));
    if (!lus.length) return null;
    const jours = lus.filter(v => v.iso.length === 10);
    const retenus = jours.length ? jours : lus;
    const parIso = new Map();
    for (const v of retenus) { const g = parIso.get(v.iso) || parIso.set(v.iso, { iso: v.iso, sources: new Set(), de: [] }).get(v.iso); g.sources.add(v.source); if (v.de) g.de.push(v.de); }
    const classes = [...parIso.values()].sort((a, b) => b.sources.size - a.sources.size || a.iso.localeCompare(b.iso));
    const g = classes[0];
    return {
        iso: g.iso, precision: g.iso.length === 10 ? 'jour' : 'mois', voix: g.sources.size, sources: [...g.sources], de: g.de,
        egalite: classes.length > 1 && classes[1].sources.size === g.sources.size,
        contre: [...classes.slice(1).map(c => `${c.iso} (${[...c.sources].join('+')})`), ...(jours.length ? lus.filter(v => v.iso.length === 7).map(v => `${v.iso} (${v.source}, au mois)`) : [])]
    };
}
/** « 2016-11-04 » → « November 4, 2016 » (le format des dates en base) ; « 2016-11 » → « November 2016 », sans jour. */
const texteDeIso = iso => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso || '')); return !m ? null : m[3] ? `${MOIS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : `${MOIS[Number(m[2]) - 1]} ${m[1]}`; };

const MOIS_ISO = Object.fromEntries(MOIS.map((m, i) => [m.toLowerCase(), String(i + 1).padStart(2, '0')]));
/** « November 18, 2022 » → « 2022-11-18 » ; « November 2016 » → « 2016-11 » ; « 2004 » → « 2004 » ; sinon null. La précision de la source, rien de plus. */
function isoPartiel(texte) {
    const t = String(texte || '').replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    let m = /^([A-Za-z]+) (\d{1,2}) (\d{4})$/.exec(t);
    if (m && MOIS_ISO[m[1].toLowerCase()]) return `${m[3]}-${MOIS_ISO[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
    m = /^([A-Za-z]+) (\d{4})$/.exec(t);
    if (m && MOIS_ISO[m[1].toLowerCase()]) return `${m[2]}-${MOIS_ISO[m[1].toLowerCase()]}`;
    return /^\d{4}$/.test(t) ? t : null;
}
/** Une valeur `period` → { texte, debut, fin, jourDebut, debutIso }. « From December 4, 2024 » : un début, pas de fin. */
function periodeDe(brut) {
    const texte = nettoyer(brut).replace(/'''?/g, '').replace(/\s+/g, ' ').trim();
    const m = /^(?:from\s+)?(.+?)(?:\s*[-–—]\s*|\s+to\s+|\s+until\s+)(.+)$/i.exec(texte);
    const debut = (m ? m[1] : texte.replace(/^from\s+/i, '')).trim(), fin = m ? m[2].trim() : null;
    return { texte, debut, fin, jourDebut: jourComplet(debut), debutIso: isoPartiel(debut) };
}

/** La date d'un set depuis son infobox archivée, ou { raison }. */
function dateBulbapedia(texte, set) {
    const ib = /\{\{\s*(\w*Infobox)([\s\S]*?)\n\}\}/.exec(texte);
    if (!ib) return { raison: 'aucune infobox dans la page archivée' };
    const p = {};
    // Une infobox écrite sur UNE ligne (« |release=November 18, 2011 |cards=30 ») : la valeur s'arrête au premier « | » hors
    // gabarit ou lien — 18 decks japonais restaient « pas un jour complet : November 18, 2011 | » (2026-09-25).
    const coupe = v => { let d = 0; for (let i = 0; i < v.length; i++) { const n2 = v.slice(i, i + 2); if (n2 === '{{' || n2 === '[[') { d++; i++; continue; } if (n2 === '}}' || n2 === ']]') { d--; i++; continue; } if (v[i] === '|' && d <= 0) return v.slice(0, i); } return v; };
    for (const m of ib[2].matchAll(/\|\s*([a-z]*(?:release|date|period)[a-z0-9]*)\s*=([^\n]*)/gi)) p[m[1].toLowerCase()] = coupe(m[2]).trim();
    const tir = set.tirage;
    const code = String(set.code || ''), codeNu = code.replace(/C$/, '');
    // La valeur d'une clé qui désigne CE tirage : l'étiquette du tirage ou du CODE du set (Cardmarket suffixe « C » les codes
    // chinois que Bulbapedia écrit sans, §39) ; sinon une valeur unique sans étiquette, seulement si la page est celle du tirage.
    const valeursDuTirage = k => {
        const ps = parties(p[k]);
        const etiq = ps.filter(x => x.etiquette === tir || (tir === 'idth' && ['id', 'th'].includes(x.etiquette)) || x.etiquette === `code:${code}` || x.etiquette === `code:${codeNu}`);
        if (etiq.length) return etiq.map(x => ({ de: `${k}:${x.etiquette}`, brut: x.texte }));
        // Des valeurs étiquetées, aucune de ce tirage : elles datent un AUTRE tirage — sauf si AUCUNE étiquette n'est une région
        // (« Sylveon Box: … », « Series 1: … ») : ce sont les sous-produits de CE set, et chacun vote (majorité, la plus tôt).
        const sousProduits = ps.length > 1 && ps.every(x => /^\?/.test(x.etiquette || '') || (!x.etiquette && x.nature === 'sous-produit'));
        if (!sousProduits && ps.some(x => x.etiquette)) return [];
        // Des valeurs sans étiquette : la sortie en BOUTIQUE vote (« General release », « Part N », ou sans mention), jamais une
        // avant-première ni une salle ; la VERSION d'un autre produit ne vote pas (VERSION_DU_SET nomme celle de ce set).
        let retenues = ps.filter(x => x.nature !== 'avant' && (sousProduits || x.nature !== 'sous-produit'));
        if (retenues.some(x => /^version:/.test(x.nature || ''))) retenues = VERSION_DU_SET[set._id] ? retenues.filter(x => x.nature === `version:${VERSION_DU_SET[set._id]}`) : [];
        if (!retenues.length) return [];
        const sienne = k === 'jarelease' || k === 'enrelease'
            || (tir === 'jp' && !p.enrelease && !/\((ATCG|SCTCG|TCTCG|ITCG|TTCG)\)$/.test(set.bulba.titre || ''))
            || (tir === 'intl' && !p.jarelease && /\(TCG\)$/.test(set.bulba.titre || ''))
            || (SUFFIXE_PAGE[tir] && SUFFIXE_PAGE[tir].test(set.bulba.titre || ''));
        return sienne ? retenues.map(x => ({ de: x.annotation ? `${k} « ${x.annotation} »` : /^\?/.test(x.etiquette || '') ? `${k} « ${x.etiquette.slice(1)} »` : k, brut: x.texte })) : [];
    };
    const candidats = [];
    const cles = tir === 'jp' ? ['jarelease', 'release', 'date'] : tir === 'intl' ? ['enrelease', 'release', 'date'] : ['release', 'date'];
    for (const k of cles) if (p[k]) for (const v of valeursDuTirage(k)) {
        const jour = jourComplet(v.brut), iso = isoPartiel(jour || texteNet(v.brut));
        // un jour ou un mois : la précision de la source ; une année seule, un texte libre ne votent pas
        candidats.push({ ...v, jour, iso: iso && iso.length >= 7 ? iso : null });
    }
    const lisibles = candidats.filter(c => c.iso);
    // Des sorties du MÊME set à plus d'un an d'écart ne sont pas des parties ni des boîtes : une coquille (« July 18, 2015 (Scare) »
    // dans une série de 2025, 151C) — « la plus tôt » la choisirait. Rien n'est écrit, et la raison le dit.
    const annees = lisibles.map(c => Number(c.iso.slice(0, 4)));
    if (annees.length > 1 && Math.max(...annees) - Math.min(...annees) > 1) return { raison: `sorties à plus d'un an d'écart pour ce tirage (coquille probable) : ${lisibles.map(c => `« ${texteNet(c.brut)} »`).join(' / ')}` };
    if (lisibles.length) {
        const jours = [...new Set(lisibles.map(c => c.jour).filter(Boolean))];
        const u = jours.length === 1 && lisibles.every(c => c.jour === jours[0]) ? lisibles[0] : null;
        return { candidats: lisibles.map(c => ({ iso: c.iso, de: c.de, brut: c.brut })), ...(u ? { jour: u.jour, de: u.de, brut: u.brut } : {}) };
    }
    if (candidats.length) return { raison: `ni un jour ni un mois : « ${String(candidats[0].brut).slice(0, 80)} »` };
    if (p.period) {
        // Décision du testeur (2026-09-25) : une période se range à son DÉBUT ; la période entière s'écrit pour l'affichage.
        const v = valeursDuTirage('period');
        if (v.length !== 1) return { raison: `période de distribution qui ne désigne pas ce tirage : « ${p.period.slice(0, 60)} »` };
        const periode = { ...periodeDe(v[0].brut), de: v[0].de };
        return periode.jourDebut ? { periode, raison: null }
            : { periode, raison: `période « ${periode.texte.slice(0, 60)} » : son début (« ${periode.debut} ») n'est pas un jour complet — la période seule est écrite` };
    }
    if (Object.keys(p).length) return { raison: `aucune valeur de ce tirage (${tir}) : ${Object.entries(p).map(([k, v]) => `${k}=« ${v.slice(0, 50)} »`).join(' ; ')}` };
    return { raison: 'aucun paramètre de date dans l\'infobox' };
}

// ── TCGdex : le dépôt cloné, lu au motif comme scripts/tcgdex-clone.mjs du site (on ne l'exécute pas)
const chaine = (src, cle) => { const m = src.match(new RegExp(`^\\s*${cle}:\\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`, 'm')); return m ? m[2] : null; };
function lireSetsTcgdex(racine, dossier) {
    const sets = [];
    for (const serie of fs.readdirSync(path.join(racine, dossier))) {
        const d = path.join(racine, dossier, serie);
        if (!fs.statSync(d).isDirectory()) continue;
        for (const f of fs.readdirSync(d)) {
            if (!f.endsWith('.ts')) continue;
            const src = fs.readFileSync(path.join(d, f), 'utf8');
            const id = chaine(src, 'id'); if (!id) continue;
            const nom = /^\s*name:\s*\{([\s\S]*?)\}/m.exec(src)?.[1] || '';
            sets.push({ id, fichier: `${dossier}/${serie}/${f}`, nomEn: /(?:^|[\s{,])en:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/.exec(nom)?.[2] ?? null,
                releaseDate: chaine(src, 'releaseDate'), abreviation: /abbreviations:\s*\{[\s\S]*?official:\s*(["'])([^"']+)\1/.exec(src)?.[2] ?? null,
                cardmarket: Number(/thirdParty:\s*\{[\s\S]*?cardmarket:\s*(\d+)/.exec(src)?.[1]) || null });
        }
    }
    return sets;
}
const normNom = t => String(t ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** Le set TCGdex d'un de nos sets intl : au moins deux clés d'accord, aucune en désaccord. */
function pairerIntl(tcg, s) {
    const exps = [].concat(s.idExpansion ?? []);
    const k1 = new Set(tcg.filter(t => t.cardmarket && exps.includes(t.cardmarket)).map(t => t.id));
    const noms = [normNom(s.nomAffichage), normNom(String(s.nomAffichage || '').replace(/^EX\s+/i, ''))];
    const k2 = new Set(tcg.filter(t => t.nomEn && noms.includes(normNom(t.nomEn))).map(t => t.id));
    const k3 = new Set(tcg.filter(t => t.abreviation && String(t.abreviation).toUpperCase() === String(s.code || '').toUpperCase()).map(t => t.id));
    const cles = [['idExpansion', k1], ['nom', k2], ['abréviation', k3]].filter(([, k]) => k.size);
    const tous = new Set(cles.flatMap(([, k]) => [...k]));
    if (!cles.length) return { raison: 'aucune clé ne désigne un set TCGdex' };
    if (tous.size > 1) return { raison: `clés en désaccord : ${cles.map(([n, k]) => `${n}→${[...k].join('/')}`).join(' ; ')}` };
    const id = [...tous][0];
    if (cles.length < 2) return { raison: `une seule clé (${cles[0][0]} → ${id})`, id, uneCle: true };
    return { id, par: cles.map(([n]) => n).join('+') };
}

async function principal() {
    const ecrire = process.argv.includes('--ecrire');
    if (!CLONE || !fs.existsSync(path.join(CLONE, 'data'))) { console.error('❌ --clone=<chemin du clone tcgdex/cards-database> requis (git clone --depth 1)'); process.exit(2); }
    const tcgIntl = lireSetsTcgdex(CLONE, 'data'), tcgAsie = lireSetsTcgdex(CLONE, 'data-asia');
    console.log(`TCGdex (clone) : ${tcgIntl.length} sets internationaux (${tcgIntl.filter(t => t.releaseDate).length} datés, ${tcgIntl.filter(t => t.cardmarket).length} avec idExpansion Cardmarket) · ${tcgAsie.length} sets asiatiques (${tcgAsie.filter(t => t.releaseDate).length} datés)`);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const sets = await lireMongo(cx.db.collection('sets'), { nomAffichage: { $type: 'string' } }, { nom: 'sets publiés', projection: { code: 1, region: 1, tirage: 1, nomAffichage: 1, dateSortieJa: 1, dateSortieEn: 1, dateSortieJaSource: 1, dateSortieEnSource: 1, periodeDistribution: 1, dateSortieMois: 1, reimpressions: 1, idExpansion: 1, bulba: 1 } });
    const champDe = s => s.region === 'jp' ? 'dateSortieJa' : s.region === 'intl' ? 'dateSortieEn' : null;
    // « N/A » n'est pas une date (le site l'écrit, DEMANDE du 2026-09-25 : Black Bolt, White Flare) : c'est l'absence écrite en
    // toutes lettres, traitée comme l'absence. Toute AUTRE valeur présente, même illisible, n'est jamais réécrite.
    const ABSENT = [null, '', 'N/A'];
    const sans = sets.filter(s => champDe(s) && ABSENT.includes(s[champDe(s)] ?? null));
    const illisibles = sets.filter(s => champDe(s) && !ABSENT.includes(s[champDe(s)] ?? null) && Number.isNaN(Date.parse(s[champDe(s)])));
    console.log(`« N/A » traités comme absents : ${sets.filter(s => champDe(s) && s[champDe(s)] === 'N/A').map(s => s.code).join(', ') || 'aucun'}`);
    console.log(`DÉNOMINATEUR : ${sets.length} sets publiés · sans date (règle du site) ${sans.length} · date présente mais illisible par Date.parse ${illisibles.length} (non touchées) : ${illisibles.map(s => `${s.code} « ${s[champDe(s)]} »`).join(' · ')}`);
    const decisions = [];
    for (const s of sans) {
        // Un set de réimpressions (Prize Packs, WCD…) n'a pas de tirage propre écrit ; il est occidental par sa région.
        const tirage = s.tirage ?? (s.reimpressions && s.region === 'intl' ? 'intl' : null);
        const d = { id: s._id, code: s.code, tirage, nom: s.nomAffichage, champ: champDe(s) };
        decisions.push(d);
        // Aucune source ne date un Additionals : il prendra la date de son set de base, en seconde passe (la base peut être datée
        // par ce même passage — Black Bolt pour xBLK).
        if (/-Additionals$/.test(s._id)) { d.base = s._id.replace(/-Additionals$/, ''); continue; }
        const off = OFFICIELLES[s._id];
        const o = off ? { iso: isoPartiel(off.jour), de: `officielle:${off.url} (« ${off.citation} », lu le ${off.lu})` } : null;
        // Un set de réimpressions n'a pas de page de SET archivée ; la page du PRODUIT (« Play! Pokémon Prize Pack Series One (TCG) »,
        // « Trick or Trade 2023 (TCG) ») est lue par la sonde et fournie par --pages, avec sa révision.
        if (s.reimpressions && !PAGES.has(s._id) && !o && !RELEVES_BULBAPEDIA[s._id]) { d.raison = `set de réimpressions (${s.reimpressions}) : aucune page du produit fournie (--pages), aucune source officielle relevée`; continue; }
        let b = null;
        if (s.bulba?.cleR2) b = dateBulbapedia(await r2.lireTexte(process.env.R2_BUCKET_BRUT, s.bulba.cleR2), { ...s, tirage });
        else if (PAGES.has(s._id)) {
            // Un set « sans page » : la page de son expansion (déclarée par ses cartes), lue par la sonde et gardée avec sa révision.
            const pg = PAGES.get(s._id);
            b = dateBulbapedia(pg.content, { ...s, tirage, bulba: { ...(s.bulba || {}), titre: pg.page } });
            for (const c of b.candidats || []) c.de = `${c.de} (page « ${pg.page} » rév. ${pg.revid})`;
            if (b.periode) b.periode.de = `${b.periode.de} (page « ${pg.page} » rév. ${pg.revid})`;
        }
        // UNE LIGNE RELEVÉE À LA MAIN (copie Wayback, ou valeur de l'archive relue) : elle tient lieu de page quand il n'y en a pas, ou
        // REMPLACE la lecture de la page quand la règle la refusait pour une raison relue (`pourquoi`, écrit dans la source)
        const rb = RELEVES_BULBAPEDIA[s._id];
        if (rb && (rb.remplace || !(b?.candidats?.length || b?.periode?.debutIso))) {
            const de = `${rb.url} (« ${rb.citation} », lu à l'œil le ${rb.lu}${rb.pourquoi ? ` ; ${rb.pourquoi}` : ''})`;
            b = { candidats: (rb.jours ?? (rb.jour ? [rb.jour] : [])).map(j => ({ iso: isoPartiel(j), de })), raison: 'relevé à la main' };
            if (rb.periode) b.periode = { ...rb.periode, de };
        }
        if (b?.periode) { d.periode = b.periode; d.periodeDejaEcrite = !!s.periodeDistribution; }
        // Un mois déjà écrit (dateSortieMois) n'est jamais réécrit : il n'est pas « attendu » (2026-09-26 soir : « attendu 2, écrit 0 »
        // — s8a-G et PCCP portaient leur mois depuis le matin, le filtre d'écriture les protégeait, l'attendu les comptait encore).
        d.moisDejaEcrit = !!s.dateSortieMois;
        // LES VOIX (majorité, la plus tôt à égalité — testeur, 2026-09-26 après-midi). Le début d'une période vote à sa précision
        // (jour ou mois) : une période se range à son début (décision du 2026-09-25).
        const votes = [];
        if (o) votes.push({ source: 'officielle', ...o });
        for (const c of b?.candidats || []) votes.push({ source: 'bulbapedia', iso: c.iso, de: `bulbapedia:${c.de}` });
        if (!b?.candidats?.length && b?.periode?.debutIso && b.periode.debutIso.length >= 7) votes.push({ source: 'bulbapedia', iso: b.periode.debutIso, de: `bulbapedia:${b.periode.de} (début de la période « ${b.periode.texte} »)` });
        // TCGdex : une voix seulement désigné par deux clés (occidental) ; par une seule (le code japonais, un nom), un témoin.
        const temoins = [];
        if (tirage === 'intl') {
            const p = pairerIntl(tcgIntl, s);
            const ts = p.id ? tcgIntl.find(x => x.id === p.id) : null, it = ts && /^\d{4}-\d{2}-\d{2}$/.test(ts.releaseDate || '') ? ts.releaseDate : null;
            if (it && !p.uneCle) votes.push({ source: 'tcgdex', iso: it, de: `tcgdex:${ts.id}:${p.par}` });
            else if (it) temoins.push(`tcgdex ${ts.id} ${it} (une clé, témoin sans voix)`);
            d.tcgdex = p.raison ?? (it ? null : `${ts?.id ?? '?'} sans releaseDate`);
        } else if (tirage === 'jp') {
            const ta = tcgAsie.find(x => x.id.toLowerCase() === String(s.code || '').toLowerCase()), it = ta && /^\d{4}-\d{2}-\d{2}$/.test(ta.releaseDate || '') ? ta.releaseDate : null;
            if (it) temoins.push(`tcgdex ${ta.id} ${it} (code seul, témoin sans voix)`);
        }
        const r = majorite(votes);
        if (r) {
            const voix = `${r.voix} voix sur ${new Set(votes.map(v => v.source)).size} source(s) (${r.sources.join('+')})${r.egalite ? ', égalité : la plus tôt' : ''}`;
            Object.assign(d, { iso: r.iso, precision: r.precision, jour: r.precision === 'jour' ? texteDeIso(r.iso) : null, mois: r.precision === 'mois' ? texteDeIso(r.iso) : null,
                source: `majorité — ${voix} : ${r.de.join(' | ')}${r.contre.length ? ` · CONTRE : ${r.contre.join(', ')}` : ''} — règle du testeur 2026-09-26 : la majorité des sources, la plus tôt à égalité`,
                temoin: temoins.join(' · ') || '—' }, r.contre.length ? { divergence: true } : {}, r.egalite ? { egalite: true } : {});
            if (r.precision === 'jour') continue;
        }
        if (d.mois) continue;
        d.raison = [`Bulbapedia : ${b ? b.raison : s.bulba?.titre ? `page « ${s.bulba.titre} » non archivée` : 'aucune page (voie sans page)'}`,
            tirage === 'intl' ? `TCGdex : ${d.tcgdex ?? 'sans date'}` : null, temoins.length ? `témoins sans voix : ${temoins.join(' · ')}` : null, 'aucune source officielle relevée'].filter(Boolean).join(' · ');
    }
    // Seconde passe : un Additionals prend la date de son set de base (décision du testeur, 2026-09-25) — celle que ce passage
    // vient de décider, sinon celle déjà en base. Une base sans date laisse l'Additionals sans date, avec la raison.
    for (const d of decisions.filter(x => x.base)) {
        const sBase = sets.find(x => x._id === d.base), dBase = decisions.find(x => x.id === d.base && x.jour);
        if (!sBase) { d.raison = `Additionals : set de base « ${d.base} » absent des sets publiés`; continue; }
        const cb = champDe(sBase), enBase = ABSENT.includes(sBase[cb] ?? null) ? null : sBase[cb];
        const moisBase = dBase ? null : decisions.find(x => x.id === d.base && x.mois)?.mois ?? null;
        const jourBase = dBase?.jour ?? (enBase && jourComplet(enBase)) ?? null;
        if (!jourBase && !moisBase) { d.raison = `Additionals : son set de base « ${d.base} » n'a pas de date${enBase ? ` lisible (« ${enBase} »)` : ''}`; continue; }
        Object.assign(d, { jour: jourBase, mois: jourBase ? null : moisBase, iso: isoPartiel(jourBase || moisBase), precision: jourBase ? 'jour' : 'mois', source: `base:${d.base} (${dBase ? dBase.source : sBase[`${cb}Source`] ?? 'date déjà en base'}) — décision du testeur 2026-09-25 : un Additionals prend la date de son set de base`, temoin: '—' });
    }
    const poses = decisions.filter(d => d.jour), auMois = decisions.filter(d => !d.jour && d.mois), refus = decisions.filter(d => !d.jour && !d.mois);
    const parT = {}; for (const d of decisions) { const g = parT[d.tirage] || (parT[d.tirage] = { n: 0, date: 0, mois: 0 }); g.n++; if (d.jour) g.date++; else if (d.mois) g.mois++; }
    console.log(`\nDATÉS PAR CET OUTIL : ${poses.length} au jour, ${auMois.length} au mois (dont ${auMois.filter(d => d.periode).length} périodes), sur ${decisions.length} · par tirage ${Object.entries(parT).map(([k, g]) => `${k} ${g.date}+${g.mois}/${g.n}`).join(' · ')}`);
    const raisons = {}; for (const d of refus) { const k = d.raison.replace(/«[^»]*»/g, '«…»').replace(/\b\d{4}\b|\d+/g, '#').slice(0, 90); raisons[k] = (raisons[k] || 0) + 1; }
    console.log('RESTENT SANS DATE, par raison :'); for (const [k, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)} · ${k}`);
    for (const d of refus) console.log(`      ${String(d.code).padEnd(9)} ${d.id} : ${d.raison.slice(0, 220)}`);
    const unanimes = poses.filter(d => !d.divergence && /voix/.test(d.source)).length;
    console.log(`majorité : unanimes ${unanimes} · avec voix contraire ${poses.filter(d => d.divergence).length} (dont égalités tranchées par la plus tôt ${poses.filter(d => d.egalite).length}) · Additionals par leur base ${poses.filter(d => d.base).length}`);
    // Les décisions du testeur, imprimées une à une : c'est leur première application.
    const periodes = decisions.filter(d => d.periode);
    console.log(`\nDÉCISIONS DU TESTEUR (2026-09-25 et 2026-09-26) :`);
    for (const id of Object.keys(OFFICIELLES)) { const d = decisions.find(x => x.id === id); console.log(`   source officielle ${id} : ${d ? (d.jour ? `${d.champ} = ${d.jour}` : d.raison ?? d.mois) : 'déjà daté ou non publié'}`); }
    for (const d of [...poses, ...auMois].filter(x => x.divergence || x.egalite)) console.log(`   MAJORITÉ ${String(d.code).padEnd(8)} ${d.champ} = ${d.jour ?? d.mois} · ${d.source.replace(/ — règle du testeur.*$/, '')}`);
    for (const d of auMois.filter(x => !x.periode)) console.log(`   AU MOIS (hors période) ${String(d.code).padEnd(8)} ${d.id} → ${d.mois} · ${d.source.replace(/ — règle du testeur.*$/, '')}`);
    for (const d of decisions.filter(x => x.base)) console.log(`   Additionals ${String(d.code).padEnd(6)} ${d.id} → ${d.jour ? `${d.champ} = ${d.jour} (base ${d.base})` : d.raison}`);
    console.log(`   PÉRIODES : ${periodes.length} lues · ${periodes.filter(d => d.jour).length} datées par leur début · ${periodes.filter(d => !d.jour).length} sans date (début au mois, ou témoin contraire)`);
    for (const d of periodes) console.log(`   période ${String(d.code).padEnd(8)} « ${d.periode.texte} » → début ${d.periode.debut} (${d.periode.debutIso ?? '—'})${d.periode.fin ? ` · fin ${d.periode.fin}` : ''} · ${d.jour ? `${d.champ} = ${d.jour}` : d.raison}`);
    fs.writeFileSync(path.join(__dirname, 'collecte-cartes', 'rapports', 'dates-sets.json'), JSON.stringify(decisions, null, 1));
    let g = 20260925; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log('\n20 TIRÉS AU SORT parmi les datés (graine 20260925) :');
    for (const d of [...poses].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${String(d.code).padEnd(9)} ${d.tirage.padEnd(7)} « ${d.nom} » → ${d.champ} = ${d.jour} · ${d.source} · témoin ${d.temoin}`);
    if (!ecrire) { console.log(`\n   (mesure seule : ${poses.length} dates à poser — relancer avec --ecrire, par lot-additif.js)`); await fermer(); return; }
    let n = 0;
    for (const d of poses) {
        const r = await cx.db.collection('sets').updateOne({ _id: d.id, [d.champ]: { $in: ABSENT } }, { $set: { [d.champ]: d.jour, [`${d.champ}Source`]: d.source, dateSortiePoseeLe: new Date() } });
        n += r.modifiedCount;
    }
    // UN MOIS SEUL, hors période (testeur, 2026-09-26 : « garde la précision au mois sans inventer de jour : c'est suffisant pour
    // ranger ») : jamais dans `dateSortie*`, que le site affiche au jour (`dateFrancaise`) — un champ à part, { iso « 2014-11 », texte }.
    let nm = 0;
    const moisHorsPeriode = auMois.filter(x => !x.periode && !x.moisDejaEcrit);
    for (const d of moisHorsPeriode) {
        const r = await cx.db.collection('sets').updateOne({ _id: d.id, [d.champ]: { $in: ABSENT }, dateSortieMois: { $exists: false } },
            { $set: { dateSortieMois: { iso: d.iso, texte: d.mois, source: d.source, le: new Date() }, dateSortiePoseeLe: new Date() } });
        nm += r.modifiedCount;
    }
    console.log(`   ${nm} dates au mois écrites dans dateSortieMois (attendu ${moisHorsPeriode.length})`);
    // La période entière, pour l'affichage (le site la montre, la date ne sert qu'à ranger) — additive : jamais réécrite.
    let np = 0;
    const periodesNeuves = periodes.filter(d => !d.periodeDejaEcrite);   // une période déjà écrite n'est jamais réécrite : elle n'est pas « attendue »
    for (const d of periodesNeuves) {
        const { texte, debut, fin, debutIso, de } = d.periode;
        const r = await cx.db.collection('sets').updateOne({ _id: d.id, periodeDistribution: { $exists: false } },
            { $set: { periodeDistribution: { texte, debut, fin, debutIso, source: `bulbapedia:${de}`, le: new Date() } } });
        np += r.modifiedCount;
    }
    const relus = await cx.db.collection('sets').countDocuments({ dateSortiePoseeLe: { $exists: true } });
    const relusP = await cx.db.collection('sets').countDocuments({ periodeDistribution: { $exists: true } });
    console.log(`\n   ✅ ${n} dates posées (attendu ${poses.length}) · ${np} périodes écrites (attendu ${periodesNeuves.length} ; ${periodes.length - periodesNeuves.length} déjà en base) · relu : ${relus} sets portent dateSortiePoseeLe, ${relusP} portent periodeDistribution`);
    if (n !== poses.length) console.log(`   🔴 ${poses.length - n} non posées : le champ s'est rempli entre la mesure et l'écriture — à ouvrir`);
    if (np !== periodesNeuves.length) console.log(`   🔴 ${periodesNeuves.length - np} périodes non écrites : le champ s'est rempli entre la mesure et l'écriture — à ouvrir`);
    await fermer();
}

module.exports = { jourComplet, parties, dateBulbapedia, pairerIntl, lireSetsTcgdex, depuisIso, periodeDe, isoPartiel, majorite, texteDeIso, OFFICIELLES };
if (require.main === module) principal().catch(e => { console.error(e); process.exit(1); });

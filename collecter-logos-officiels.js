// ============================================================
// LES LOGOS OFFICIELS (phase 2) — collecte depuis l'ADRESSE EXACTE écrite sur chaque ligne de LISTE-LOGOS-A-CHERCHER.md
// ============================================================
//   node collecter-logos-officiels.js --cache=<dossier>                       (SIMULATION : télécharge à la cadence, compare, n'écrit NI base NI R2)
//   node lot-additif.js --quoi="logos officiels 2026-10" --collections=sets -- node collecter-logos-officiels.js --cache=<dossier> --ecrire
// Décision du testeur (2026-10-08) : « 181 OFFICIEL : collecte depuis l'adresse exacte écrite sur chaque ligne (jamais depuis un fichier Pokécardex,
// jamais d'après un nom de fichier). Cadence lente, source enregistrée, retirable en un lot. » Les OFFICIELS dont la seule source est Bulbapedia (copie
// archive.org) ne se collectent PAS maintenant : ils sont REPORTÉS.
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une ligne OFFICIEL ; un set SÛR (jamais « ? » ni « non identifié » : le set vient de la LIGNE, c'est-à-dire
// du fichier Pokécardex, jamais du nom de fichier du candidat — Bill's nomme mal certains fichiers) ; une URL qui est EXACTEMENT sur la ligne ; un hôte de la
// liste FERMÉE ci-dessous (https, sans identifiants) ; robots.txt relu par hôte ; une requête toutes les 10 s au plus ; redirections suivies seulement dans
// l'hôte ; arrêt au premier défi anti-robot ; le MÊME fichier que celui que la phase 1 a comparé (sha256) ou, sinon, la re-mesure par la MÊME fonction
// (collecte-cartes/mesure-logos.js) au seuil de la phase 1. Tout le reste refuse.
// ÉCRITURE ADDITIVE ET RETIRABLE : l'image dans R2 sous `logos-officiels/<langue>/…` (+ sa vignette), et un champ NEUF `sets.logoOfficiel.<fr|ja>`.
// AUCUN champ existant (`logo`, `logoFr`, `logoCompose`…) n'est lu pour être remplacé ni écrit. `retirer-logos-officiels.js` retire ce lot d'un geste.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { logoCommenceParCode } = require('./poser-nomja-sets');

const LOT = 'logos-officiels-2026-10';
const MENTION = '© Pokémon / The Pokémon Company';
// La liste FERMÉE, lue sur les lignes OFFICIEL de la phase 1 : 65 lignes TCGdex (assets.tcgdex.net), 84 lignes Bill's Archive (billsarchive.com) ; les
// autres (web.archive.org, archives.bulbagarden.net : Bulbapedia) sont reportées. raw.githubusercontent.com (ptcg-assets) : aucune ligne ne porte d'URL
// de ce dépôt (« clone local »), donc il n'est pas dans la liste.
const HOTES_COLLECTE = ['assets.tcgdex.net', 'billsarchive.com'];
const SOURCES = { 'assets.tcgdex.net': 'tcgdex', 'billsarchive.com': 'billsarchive', 'web.archive.org': 'bulbapedia', 'archives.bulbagarden.net': 'bulbapedia' };
const CADENCE_MS = 10000;
const TAILLE_MAX = 5 * 1024 * 1024;
const AGENT = 'rat-market-logos/1.0';
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const hoteDe = u => { try { return new URL(u).hostname; } catch { return null; } };
const sourceDe = u => SOURCES[hoteDe(u)] ?? null;

/** L'URL qu'on s'apprête à demander : sur la ligne, https, sans identifiants, sans requête, hôte de la liste. Rend la RAISON du refus, ou null. */
function verifierUrl(ligne, url) {
    if (typeof url !== 'string' || !url) return 'aucune URL';
    if (!Array.isArray(ligne?.urls) || !ligne.urls.includes(url)) return 'cette URL n\'est pas écrite sur la ligne';
    let u; try { u = new URL(url); } catch { return 'URL illisible'; }
    if (u.protocol !== 'https:') return `protocole ${u.protocol} (https seulement)`;
    if (u.username || u.password) return 'identifiants dans l\'URL';
    if (u.port) return `port ${u.port}`;
    if (u.search || u.hash) return 'paramètres ou ancre dans l\'URL';
    if (!HOTES_COLLECTE.includes(u.hostname)) return `hôte ${u.hostname} hors de la liste fermée (${HOTES_COLLECTE.join(', ')})`;
    return null;
}

/**
 * LA LANGUE D'UN FICHIER, PROUVÉE PAR L'ADRESSE de sa source (ruling du coordinateur, 2026-10-08) — jamais par le texte de la liste :
 * segment de chemin `/fr/` ou `/ja/` chez assets.tcgdex.net, préfixe `jp-` du fichier chez billsarchive.com. Mesuré sur les 149 adresses OFFICIEL de la
 * table : 65 prouvent fr (TCGdex /fr/), 83 prouvent ja (Bill's jp-), 1 ne prouve rien (Bill's `arceus.webp`, sans préfixe). Tout le reste : null.
 */
function langueProuvee(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.hostname === 'assets.tcgdex.net') { const s = u.pathname.split('/').filter(Boolean)[0]; return s === 'fr' ? 'fr' : s === 'ja' ? 'ja' : null; }
    if (u.hostname === 'billsarchive.com') return /^jp-/.test(path.posix.basename(u.pathname)) ? 'ja' : null;
    return null;
}
/** Une ligne va sous `fr` seulement si sa langue est `fr`, sous `ja` seulement si elle est `ja` — ET si l'adresse le prouve. Rend la raison du refus, ou null. */
function refusLangue(ligne, url) {
    if (!['fr', 'ja'].includes(ligne.cible)) return `cible « ${ligne.cible} » inconnue`;
    if (ligne.langue !== ligne.cible) return `langue « ${ligne.langue} » ≠ cible ${ligne.cible} : un logo ne va que sous sa langue`;
    const p = langueProuvee(url);
    if (!p) return `l'adresse ne prouve pas la langue (ni /fr/ ou /ja/ chez TCGdex, ni préfixe jp- chez Bill's) : langue non prouvée`;
    if (p !== ligne.cible) return `l'adresse prouve la langue ${p}, la cible est ${ligne.cible}`;
    return null;
}

/** Le set de la ligne est-il SÛR (jamais « ? » ni « non identifié ») ? Rend { action, raison } si non, sinon null. Une seule définition : planifier ET les routes Bulbapedia (collecte-cartes/logos-bulba.js). */
function refusSetIdentifie(ligne) {
    if (!ligne.set || !ligne.setSur) return { action: 'ecartee', raison: ligne.set ? `set « ${ligne.set} » identifié par le code seulement, non confirmé` : 'set non identifié' };
    return null;
}
/** Le set est-il en base, et son tirage est-il celui du logo ? Rend { action, raison } si non, sinon null. */
function refusSetBase(ligne, setsParId) {
    const s = setsParId.get(ligne.set);
    if (!s) return { action: 'ecartee', raison: `set « ${ligne.set} » absent de la base` };
    const tirage = s.tirage ?? s.region;
    const attendu = ligne.cible === 'fr' ? 'intl' : ligne.cible === 'ja' ? 'jp' : null;
    if (tirage !== attendu) return { action: 'ecartee', raison: `set de tirage ${tirage}, logo ${ligne.cible} (attendu ${attendu})` };
    return null;
}

/** Le plan d'UNE ligne, avant tout téléchargement : collecter / reportee / ecartee / refus. `setsParId` : Map slug → { tirage, region }. */
function planifier(ligne, setsParId) {
    if (ligne.verdict !== 'OFFICIEL') return { action: 'refus', raison: `verdict ${ligne.verdict} : seuls les OFFICIEL se collectent` };
    if (ligne.bulbapediaSeule) return { action: 'reportee', raison: 'Bulbapedia seule (copie archive.org) : reportée, décision du testeur' };
    const rS = refusSetIdentifie(ligne);
    if (rS) return rS;
    if (!ligne.urlChoisie) return { action: 'refus', raison: 'aucune URL de la liste fermée sur la ligne' };
    const rU = verifierUrl(ligne, ligne.urlChoisie);
    if (rU) return { action: 'refus', raison: rU };
    const rL = refusLangue(ligne, ligne.urlChoisie);
    if (rL) return { action: 'ecartee', raison: rL };
    const rB = refusSetBase(ligne, setsParId);
    if (rB) return rB;
    return { action: 'collecter' };
}

// ───────────────────────── LES « À REGARDER » REGARDÉS À L'ŒIL (coordinateur, 2026-10-11)
// 41 lignes étaient restées « À REGARDER » (score sous le seuil, même dessin à l'œil). Le testeur a délégué la décision au coordinateur, qui a REGARDÉ les 41
// paires (LOGOS-A-REGARDER-1.png, -2.png, -3.png ; planche = numéro de la planche, 14 rangées chacune) : MÊME LOGO pour 38, HÉSITATION pour 3.
// LISTE FERMÉE : une entrée par ligne promue. La clé est la ligne de la table (part + fichier) ET le candidat exact regardé (sha256 de la table) ET le set de
// la ligne. Une ligne « À REGARDER » absente d'ici n'est jamais promue. La promotion ne change que le VERDICT : elle ne contourne aucune autre garde de
// planifier/verifierUrl/refusLangue/juger (URL exacte sur la ligne, hôtes fermés, langue prouvée par l'adresse, même fichier que la phase 1 par sha256,
// tirage du set, report des « Bulbapedia seule »).
// LES SETS « ? » (setSur false : le set vient du code Pokécardex, non confirmé) ne sont SÛRS que si `confirmeNomJa` est vrai DANS LA BASE au moment du
// lancement : un set, et un seul, porte un `nomJa` ÉGAL au texte japonais du logo (écrit sur la ligne de LISTE-LOGOS-A-CHERCHER.md), de tirage jp.
// Mesuré en lecture seule le 2026-10-11 : M4 (Ninja-Spinner) et SV10 (The-Glory-of-Team-Rocket) le sont ; Dark-Phantasma, Incandescent-Arcana, VMAX-Rising
// et Champion-Road ont nomJa null → ces quatre lignes restent écartées tant que la base ne le porte pas. Pas de confirmation, pas de promotion.
const REGARDES_2026_10_11 = [
    { part: 'FR', fichier: 'Logo FR/HearthGold et Soulsilver/Heartgold_et_soulsilver.png', planche: 1, set: 'HeartGold-SoulSilver', candidatSha256: '344c66da3ad7d1ff84277af169abb0dbfc3d36f77bc884a8a962fd826f7d5869', raison: 'même dessin à l\'œil (texte, coloris, mise en page), cadrage différent, score 0.903' },
    { part: 'JP', fichier: 'Logo JP/ADV3.png', planche: 1, set: 'Rulers-of-the-Heavens', candidatSha256: 'df9b871acccc2688e43ab4d92c68f0fd5e2346142e5a23f905f4e34edaf1445d', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.647' },
    { part: 'JP', fichier: 'Logo JP/ADV4.png', planche: 1, set: 'Magma-VS-Aqua-Two-Ambitions', candidatSha256: '9efca9f6483353ed943f9d20141b9dbd53f60eca7aecb67bc8711943f198f4fd', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.729' },
    { part: 'JP', fichier: 'Logo JP/BW8B.png', planche: 1, set: 'Thunder-Knuckle', candidatSha256: '27746547d1d9c1ed3eb620faa0267bb2e801358e5095b1a505097c577e86528a', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.68' },
    { part: 'JP', fichier: 'Logo JP/BW8P.png', planche: 1, set: 'Spiral-Force', candidatSha256: 'dc569ea6f5af73b80de251ab3afb214267e3aaa943247d05dfbc156eb056ce47', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.731' },
    { part: 'JP', fichier: 'Logo JP/CP1.png', planche: 1, set: 'Magma-Gang-VS-Aqua-Gang-Double-Crisis', candidatSha256: '8dde64a1ebfbd36227fe2285d35709e2352254b3bcb7c6be18d2478db654ec2b', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.849' },
    { part: 'JP', fichier: 'Logo JP/DP2.png', planche: 1, set: 'Secret-of-the-Lakes', candidatSha256: '833c1d7730680c8d834b16d5c5faed0199aaf0142c4320d390f3b3f8390cd1b0', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.673' },
    { part: 'JP', fichier: 'Logo JP/DP4M.png', planche: 1, set: 'Moonlit-Pursuit', candidatSha256: 'abba82bf882b00c989e2c96eca48725311bab28c314dc5f30a396157347eba12', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.559' },
    { part: 'JP', fichier: 'Logo JP/DP5C.png', planche: 1, set: 'Cry-from-the-Mysterious', candidatSha256: 'e612510a63907c5079d6409392cec88de77ef0f821cdeb47ef2777b491bdc157', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.753' },
    { part: 'JP', fichier: 'Logo JP/DP5T.png', planche: 1, set: 'Temple-of-Anger', candidatSha256: '43ea667e8658d9455fc9ed7f9385b405ba2113627ec0c212fede3b979554865f', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.76' },
    { part: 'JP', fichier: 'Logo JP/M4.png', planche: 1, set: 'Ninja-Spinner', candidatSha256: 'a6ba7c965ee1373efeeb994994aab6eaef5113105c474b3ba2c98feb19366ae4', confirmeNomJa: { set: 'Ninja-Spinner', nomJa: 'ニンジャスピナー' }, raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.888' },
    { part: 'JP', fichier: 'Logo JP/NEO4.png', planche: 1, set: 'Darkness-and-to-Light', candidatSha256: 'b4910f65592be32014f449dc305e8248563a14d2098fb6a40c61e019782266a0', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.889' },
    { part: 'JP', fichier: 'Logo JP/PCG1.png', planche: 1, set: 'Flight-of-Legends', candidatSha256: '5149acdd888ab08e478b165fc7a70fcf558c1e8913fe1e50c1962a1d6b23a8d8', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.772' },
    { part: 'JP', fichier: 'Logo JP/PCG4.png', planche: 2, set: 'Golden-Sky-Silvery-Ocean', candidatSha256: '5a50d700c98655b529aa2cfc45a7b7d8ed364df94a01476d83e71bbb0e1695e4', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.656' },
    { part: 'JP', fichier: 'Logo JP/PCG5.png', planche: 2, set: 'Mirage-Forest', candidatSha256: '836de80a4634ba2574ab0087e73bd53d352080116538045f4fe2ae78019945c8', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.812' },
    { part: 'JP', fichier: 'Logo JP/PCG6.png', planche: 2, set: 'Holon-Research-Tower', candidatSha256: 'badc60760022b9c307f2661ae3bbb95004950802dbcc3e014daa38cb9c93aa5a', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.79' },
    { part: 'JP', fichier: 'Logo JP/PCG8.png', planche: 2, set: 'Miracle-Crystal', candidatSha256: '8ab019f11f4e001f4dc1c1ea2fd54809f7b62c48a169744183bcf20d922ce4b3', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.886' },
    { part: 'JP', fichier: 'Logo JP/PT4.png', planche: 2, set: 'Advent-of-Arceus', candidatSha256: '03525b892fc1f26ced8535b09a8a37066ddfe3ab381e6b648dec005a073c079c', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.803' },
    { part: 'JP', fichier: 'Logo JP/S10A.png', planche: 2, set: 'Dark-Phantasma', candidatSha256: 'cbc964962beef6f64ef97782f8f2e6df264766104316cd1010f6db7412298b13', confirmeNomJa: { set: 'Dark-Phantasma', nomJa: 'ダークファンタズマ' }, raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.858' },
    { part: 'JP', fichier: 'Logo JP/S10D.png', planche: 2, set: 'Time-Gazer', candidatSha256: '3f0ef7fe7c5be0c939a67cae18171af8dda2629ad7272c9ddaaa0508072f1ca5', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.886' },
    { part: 'JP', fichier: 'Logo JP/S11A.png', planche: 2, set: 'Incandescent-Arcana', candidatSha256: '5c930525aea6a1f81c332112b54b527879f1b764ccd580f612f4a5f7cab0b236', confirmeNomJa: { set: 'Incandescent-Arcana', nomJa: '白熱のアルカナ' }, raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.842' },
    { part: 'JP', fichier: 'Logo JP/S1A.png', planche: 2, set: 'VMAX-Rising', candidatSha256: 'a2447f3256ec93e33ab0e8955cb4237b033e13975e3668848c65556c9b4ddd63', confirmeNomJa: { set: 'VMAX-Rising', nomJa: 'VMAXライジング' }, raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.8' },
    { part: 'JP', fichier: 'Logo JP/S1W.png', planche: 2, set: 'Sword', candidatSha256: '5f5bae953016edb14bd1bdf50699759bf8da3728573f0c31c35d09f2f4d8f7fb', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.887' },
    { part: 'JP', fichier: 'Logo JP/S4A.png', planche: 2, set: 'Shiny-Star-V', candidatSha256: '6afb8ccd20977d9462bc14dcffbd70be203ee13500e545d5a507d8566ded81ba', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.773' },
    { part: 'JP', fichier: 'Logo JP/S6H.png', planche: 2, set: 'Silver-Lance', candidatSha256: 'fbca947edd987cf5e1e67c2c30fc59ccd830e21d0c10e1c38602411063cf3630', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.71' },
    { part: 'JP', fichier: 'Logo JP/S6K.png', planche: 2, set: 'Jet-Black-Spirit', candidatSha256: 'f6450fa5da8c69d70fd68715ad35717e2179f8e328c9a342ff1c340f211ed798', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.705' },
    { part: 'JP', fichier: 'Logo JP/SM1M.png', planche: 3, set: 'Collection-Moon', candidatSha256: 'f4691bb766810050f143adada3e9397a663fbeed5370128a8f0f44d7c3b79799', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.861' },
    { part: 'JP', fichier: 'Logo JP/SM2K.png', planche: 3, set: 'Islands-Await-You', candidatSha256: '1c07aced44c86f283f34f2acfd22ed99bc5edeeae23c3dd9074899937424117f', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.851' },
    { part: 'JP', fichier: 'Logo JP/SM2L.png', planche: 3, set: 'Alolan-Moonlight', candidatSha256: '6687bc8dcbfe540fb39df676231b974545b739796f7f3c91b8eba7b9875a75a6', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.705' },
    { part: 'JP', fichier: 'Logo JP/SM5M.png', planche: 3, set: 'Ultra-Moon', candidatSha256: 'b8510a60a7964eeff335546c5f1cbd3205ee61ebf22f225a204d661a58ce50d3', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.883' },
    { part: 'JP', fichier: 'Logo JP/SM6B.png', planche: 3, set: 'Champion-Road', candidatSha256: '4065004c857f65f1f46ee7c9a05c27b250ffa6038f2e136a194a1db2e3bb919e', confirmeNomJa: { set: 'Champion-Road', nomJa: 'チャンピオンロード' }, raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.802' },
    { part: 'JP', fichier: 'Logo JP/SM8.png', planche: 3, set: 'Super-Burst-Impact', candidatSha256: 'c59fc0fc22bf7852b6e73d308aae5c64873515eda9bd69ea134e8647359f86b9', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.88' },
    { part: 'JP', fichier: 'Logo JP/SM9.png', planche: 3, set: 'Tag-Bolt', candidatSha256: 'b4c810f18b31fc3f10649e3179ef1c57815448c3f6a9cf9240463736a3d74826', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.777' },
    { part: 'JP', fichier: 'Logo JP/SV10.png', planche: 3, set: 'The-Glory-of-Team-Rocket', candidatSha256: '9f8f7f832a492e6a54410c4fbfec13276888f98521311acf50f3077a0edf6773', confirmeNomJa: { set: 'The-Glory-of-Team-Rocket', nomJa: 'ロケット団の栄光' }, raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.8' },
    { part: 'JP', fichier: 'Logo JP/SV6A.png', planche: 3, set: 'Night-Wanderer', candidatSha256: '516b3154cae6d43f556125d2f1ffa780c1ee3d6fbc697fa1d7a705f88eb37722', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.867' },
    { part: 'JP', fichier: 'Logo JP/XY1R.png', planche: 3, set: 'Collection-Y', candidatSha256: '99c8eac08db8527c41a418483fc48540a7e4b493f4aeab4703e4fe26b2706a7c', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.304' },
    { part: 'JP', fichier: 'Logo JP/XY5G.png', planche: 3, set: 'Tidal-Storm', candidatSha256: '5958e87d0b7ae9ec4de2b1773f9171376806df4a08b4fc531bfa0d5363028978', raison: 'même dessin à l\'œil (texte, coloris, mise en page), rendu différent (halo, résolution, marges), score 0.88' },
];
// 2026-10-12 — LES TROIS HÉSITATIONS (OR4, SM11B, SV11W) SONT PROMUES, par le coordinateur sur délégation du testeur (« tranche toi-même ») ; SM5P (fichier sans set)
// est promu AVEC un set établi par deux éléments (`etablitSet`). Elles passent toutes les gardes de planifier/juger comme les autres : un set « ? » (SM11B, SV11W)
// n'est écrit que si son nomJa est confirmé en base ; SM5P que si Ultra-Force porte le nomJa du logo ET que le fichier du candidat porte son code ; et Bulbapedia reste reportée.
const RAISON_HESITATION = 'même texte japonais et même dessin ; le fichier de Bill\'s Archive nomme le set ; seule la couleur du rendu diffère (contour / teinte) — tranché par le coordinateur sur délégation du testeur, 2026-10-12';
REGARDES_2026_10_11.push(
    { part: 'JP', fichier: 'Logo JP/OR4.png', planche: 1, set: 'Rocket-Gang', candidatSha256: '3bc3bc6f0943f1243750cf528efc64ba22fd39946ecca4b85a02a8d5a07e62ef', regardePar: 'coordinateur sur délégation du testeur 2026-10-12, planche 1 (hésitation)', raison: RAISON_HESITATION },
    { part: 'JP', fichier: 'Logo JP/SM11B.png', planche: 2, set: 'Dream-League', candidatSha256: '16d093d3695b881a190338352ad11867ba11a31b9e8845b0731718a76b315068', confirmeNomJa: { set: 'Dream-League', nomJa: 'ドリームリーグ' }, regardePar: 'coordinateur sur délégation du testeur 2026-10-12, planche 2 (hésitation)', raison: RAISON_HESITATION },
    { part: 'JP', fichier: 'Logo JP/SV11W.png', planche: 3, set: 'White-Flare-JP', candidatSha256: '14feeb8b34297db018eb2417356528b910d5bf9cccb4939f57e4c04f0a2c46fe', confirmeTcgdexJa: { set: 'White-Flare-JP', code: 'sv11W', nomJa: 'ホワイトフレア' }, regardePar: 'coordinateur sur délégation du testeur 2026-10-12, planche 3 (hésitation)', raison: RAISON_HESITATION },
    { part: 'JP', fichier: 'Logo JP/SM5P.png', planche: 3, set: null, candidatSha256: 'a0c2007da8593f7aa47f020621c067aa274d52de3b38e2035e03ef1efffc0c78', etablitSet: { set: 'Ultra-Force', nomJa: 'ウルトラフォース' }, regardePar: 'coordinateur 2026-10-12, planche 3 (set établi par le code du fichier ET le texte japonais du logo)', raison: 'logo « ウルトラフォース » lu à l\'œil ; le fichier SM5Plus_Logo.png porte le code sm5+ du set Ultra-Force ; ce nomJa n\'est porté que par ce set de tirage jp (poser-nomja-sets.js) — set établi par deux éléments, 2026-10-12' }
);
// Ce que le coordinateur a regardé et NE promeut PAS : rien aujourd'hui (les quatre exclus du 2026-10-11 sont promus ci-dessus).
const EXCLUS_2026_10_11 = [];
/**
 * Promeut UNE ligne « À REGARDER » de la liste fermée, ou dit pourquoi non. Rend { ligne } (copie promue OFFICIEL) ou { raison }. `setsParId` : Map slug → { tirage,
 * region, nomJa } (la base, en lecture). Ne touche à rien d'autre que le verdict, setSur (seulement sur confirmation du nomJa) et bulbapediaSeule (une source
 * Bulbapedia est reportée comme les 32 autres).
 */
function promouvoir(ligne, setsParId, { regardes = REGARDES_2026_10_11, exclus = EXCLUS_2026_10_11, tcgdexJa = null } = {}) {
    if (ligne?.verdict !== 'À REGARDER') return { raison: 'pas une ligne À REGARDER : aucune promotion' };
    const cle = x => x.part === ligne.part && x.fichier === ligne.fichier;
    const e = regardes.find(cle);
    if (!e) { const x = exclus.find(cle); return { raison: x ? `regardée, non promue : ${x.raison}` : 'À REGARDER non listée dans la liste fermée des regardés : non promue' }; }
    if (ligne.set !== e.set) return { raison: `le set de la ligne (${ligne.set}) n'est plus celui qui a été regardé (${e.set})` };
    if (ligne.cache?.sha256 !== e.candidatSha256) return { raison: 'le candidat de la ligne n\'est plus celui qui a été regardé (sha256)' };
    let setSur = ligne.setSur, setId = ligne.set;
    // un set « ? » : confirmé par le nomJa de la base ; un fichier sans set (SM5P) : ÉTABLI par DEUX éléments — le CODE (le fichier du candidat commence par le code du set)
    // ET le texte japonais du logo égal au nomJa d'un set, et d'un seul, de tirage jp
    let c = ligne.set ? e.confirmeNomJa : e.etablitSet;
    if (!ligne.set && (!c || e.set !== null)) return { raison: 'aucun set sur la ligne et aucun établissement par deux éléments dans la liste : non promue' };
    // SECONDE VOIE, à liste fermée (SV11W seule, 2026-10-12) : le nomJa de la base est partagé par 4 sets. Deux éléments indépendants : (1) l'identifiant du set TCGdex ja
    // (cache `ja/__liste__`) est le CODE de NOTRE set, lu en base ; (2) le nom japonais de ce set TCGdex est égal au texte du logo regardé. Jugée sur le cache, 0 requête.
    if (!setSur && ligne.set && e.confirmeTcgdexJa) {
        const t = e.confirmeTcgdexJa;
        if (t.set !== ligne.set) return { raison: 'confirmation TCGdex ja écrite pour un autre set : non promue' };
        const s = setsParId.get(t.set);
        if (!s) return { raison: `set « ${t.set} » absent de la base (confirmation TCGdex ja non établie)` };
        if ((s.tirage ?? s.region) !== 'jp') return { raison: `set « ${t.set} » de tirage ${s.tirage ?? s.region}, pas jp (confirmation TCGdex ja non établie)` };
        if (String(s.code ?? '').toLowerCase() !== t.code.toLowerCase()) return { raison: `le code de la base (${s.code ?? 'null'}) n'est pas « ${t.code} » (confirmation TCGdex ja non établie)` };
        if (!Array.isArray(tcgdexJa) || !tcgdexJa.length) return { raison: 'cache TCGdex ja/__liste__ absent ou vide : confirmation TCGdex ja impossible (je ne sais pas)' };
        const m = tcgdexJa.filter(x => String(x.id).toLowerCase() === t.code.toLowerCase());
        if (m.length !== 1) return { raison: `${m.length} set(s) TCGdex ja d'identifiant « ${t.code} » (un seul attendu) : confirmation TCGdex ja non établie` };
        if (m[0].name !== t.nomJa) return { raison: `TCGdex ja ${m[0].id} se nomme « ${m[0].name} » ≠ texte du logo « ${t.nomJa} » (confirmation TCGdex ja non établie)` };
        setSur = true; c = { ...t, voie: 'tcgdex-ja' };
    }
    if (!setSur || !ligne.set) {
        if (!c || (ligne.set && c.set !== ligne.set)) return { raison: 'set non sûr et aucune confirmation par nomJa dans la liste : non promue' };
        const s = setsParId.get(c.set);
        if (!s || s.nomJa !== c.nomJa) return { raison: `set « ${c.set} » non confirmé : nomJa de la base (${s?.nomJa ?? 'null'}) ≠ texte du logo « ${c.nomJa} » (nomJa non confirmé)` };
        const porteurs = [...setsParId.values()].filter(x => x.nomJa === c.nomJa);
        if (porteurs.length !== 1) return { raison: `nomJa « ${c.nomJa} » porté par ${porteurs.length} sets : ambigu (nomJa non confirmé)` };
        if ((s.tirage ?? s.region) !== 'jp') return { raison: `set « ${c.set} » de tirage ${s.tirage ?? s.region}, pas jp (nomJa non confirmé)` };
        if (!ligne.set && !logoCommenceParCode(ligne.cache?.fichier, s.code)) return { raison: `le fichier du candidat (« ${ligne.cache?.fichier ?? '∅'} ») ne porte pas le code « ${s.code ?? '∅'} » du set « ${c.set} » : set non établi (code non confirmé)` };
        setSur = true; setId = c.set;
    }
    return { ligne: { ...ligne, set: setId, verdict: 'OFFICIEL', setSur, bulbapediaSeule: !!(ligne.bulbapediaSeule || ligne.source === 'bulbapedia'),
        regardePar: e.regardePar ?? `coordinateur 2026-10-11, planche ${e.planche}`, raisonRegarde: e.raison, confirmationSet: c ?? null } };
}

/**
 * Le fichier téléchargé est-il celui de la ligne ? Une image PNG/WebP/JPEG lisible, pas une copie connue de Pokécardex, puis : le MÊME fichier que celui que
 * la phase 1 a comparé (sha256), sinon la re-mesure contre le fichier Pokécardex par la fonction de la phase 1, au seuil de la phase 1.
 */
async function juger(ligne, buf, { pokecardexBuf = null, mesurer = require('./collecte-cartes/mesure-logos').mesurer, sha1Force = null } = {}) {
    if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, raison: 'réponse vide' };
    if (buf.length > TAILLE_MAX) return { ok: false, raison: `fichier de ${buf.length} octets (max ${TAILLE_MAX})` };
    let meta; try { meta = await sharp(buf).metadata(); } catch { return { ok: false, raison: 'ce n\'est pas une image lisible' }; }
    if (!['png', 'webp', 'jpeg'].includes(meta.format)) return { ok: false, raison: `format ${meta.format} (png, webp, jpeg seulement)` };
    if (!(meta.width >= 100 && meta.height >= 20)) return { ok: false, raison: `image de ${meta.width}×${meta.height}, trop petite pour un logo` };
    const base = { w: meta.width, h: meta.height, format: meta.format, octets: buf.length, sha256: sha256(buf), sha1: sha1Force ?? sha1(buf) };
    const { refusCopie } = require('./collecte-cartes/langue-logo');
    const copie = refusCopie(base.sha1, null);
    if (copie) return { ok: false, raison: copie, ...base };
    if (ligne.cache?.sha256 && ligne.cache.sha256 === base.sha256) return { ok: true, via: 'identique-phase-1', corr: null, ...base };
    if (!pokecardexBuf) return { ok: false, raison: 'fichier différent de celui comparé en phase 1 et fichier Pokécardex illisible : pas de re-mesure possible (je ne sais pas)', ...base };
    let m; try { m = await mesurer(ligne.part, buf, pokecardexBuf); } catch (e) { return { ok: false, raison: `re-mesure impossible : ${e.message}`, ...base }; }
    return m.ok ? { ok: true, via: 're-mesure', corr: m.corr, detail: m.detail, ...base } : { ok: false, raison: `re-mesure sous le seuil : ${m.detail}`, corr: m.corr, ...base };
}

/** Deux lignes pour un même (langue, set) : le même fichier ne s'écrit qu'une fois ; deux fichiers différents ne se départagent pas (refus des deux). */
function reduireDoublons(items) {
    const groupes = new Map();
    items.forEach((it, i) => { const k = `${it.ligne.cible}:${it.ligne.set}`; (groupes.get(k) || groupes.set(k, []).get(k)).push(i); });
    const out = items.map(() => ({ action: 'ecrire' }));
    for (const idx of groupes.values()) {
        if (idx.length < 2) continue;
        const premier = items[idx[0]].sha256;
        if (idx.every(i => items[i].sha256 === premier)) idx.slice(1).forEach(i => { out[i] = { action: 'doublon', meme: items[idx[0]].ligne.fichier }; });
        else idx.forEach(i => { out[i] = { action: 'refus', raison: `deux fichiers différents pour ${items[i].ligne.set} (${idx.map(j => items[j].ligne.fichier).join(', ')})` }; });
    }
    return out;
}

// ── robots.txt : les règles du groupe « * » (ou de notre agent), la plus longue règle gagne, Allow à égalité
function regleRobots(texte) {
    const groupes = []; let cur = null, enTete = false;
    for (const brut of String(texte).split(/\r?\n/)) {
        const l = brut.replace(/#.*$/, '').trim(); if (!l) continue;
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l); if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') { if (!cur || !enTete) { cur = { agents: [], regles: [] }; groupes.push(cur); } cur.agents.push(v.toLowerCase()); enTete = true; }
        else if ((k === 'allow' || k === 'disallow') && cur) { cur.regles.push({ allow: k === 'allow', chemin: v }); enTete = false; }
        else enTete = false;
    }
    const nous = groupes.filter(g => g.agents.some(a => a !== '*' && AGENT.toLowerCase().startsWith(a)));
    const utiles = nous.length ? nous : groupes.filter(g => g.agents.includes('*'));
    return utiles.flatMap(g => g.regles);
}
function autorise(regles, chemin) {
    let meilleure = null;
    for (const r of regles) {
        if (r.chemin === '') continue;
        const re = new RegExp('^' + r.chemin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
        if (!re.test(chemin)) continue;
        if (!meilleure || r.chemin.length > meilleure.chemin.length || (r.chemin.length === meilleure.chemin.length && r.allow)) meilleure = r;
    }
    return !meilleure || meilleure.allow;
}
const defi = r => {
    const h = k => (r.headers?.get ? r.headers.get(k) : null) ?? '';
    return !!h('cf-mitigated') || /imperva/i.test(h('x-cdn')) || [403, 429].includes(r.status);
};
class ArretDefi extends Error { constructor(m) { super(m); this.arret = true; } }
// L'arrêt D'UN HÔTE (§75 : arrêt au premier blocage) : erreur réseau, 5xx, robots.txt illisible. Les autres hôtes continuent ; rien n'est redemandé à celui-ci.
class ArretHote extends Error { constructor(hote, m) { super(m); this.arretHote = true; this.hote = hote; } }

/**
 * Le client : UNE requête à la fois et au moins `cadenceMs` entre deux (tous hôtes confondus : plus lent que nécessaire, jamais plus rapide),
 * hôte de la liste fermée, robots.txt lu une fois par hôte AVANT la première image, redirections `manual` suivies seulement dans l'hôte (3 sauts),
 * et au premier défi anti-robot (403, 429, cf-mitigated, Imperva) ARRÊT : plus aucune requête ne part.
 */
function creerClient({ fetch = globalThis.fetch, attendre = ms => new Promise(r => setTimeout(r, ms)), maintenant = Date.now, cadenceMs = CADENCE_MS } = {}) {
    let derniere = null, arret = null;
    const robots = new Map(), arretes = new Map();
    const compte = {};
    const arreter = (hote, raison) => { const e = new ArretHote(hote, `ARRÊT de ${hote} pour ce lancement : ${raison} — plus aucune requête vers cet hôte`); arretes.set(hote, e); return e; };
    async function requete(url, quoi = '') {
        const h = hoteDe(url);
        if (arretes.has(h)) throw arretes.get(h);   // rien n'est redemandé à un hôte arrêté
        if (derniere !== null) { const reste = cadenceMs - (maintenant() - derniere); if (reste > 0) await attendre(reste); }
        derniere = maintenant();
        compte[h] = (compte[h] || 0) + 1;
        let r;
        try { r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': AGENT, Accept: 'image/*,*/*;q=0.5' } }); }
        catch (e) { throw arreter(h, `${quoi}erreur réseau (${e.cause?.code || e.message})`); }
        if (defi(r)) { arret = new ArretDefi(`ARRÊT : ${url} a répondu ${r.status} (défi anti-robot ou limite) — plus aucune requête`); throw arret; }
        if (r.status >= 500) throw arreter(h, `${quoi}HTTP ${r.status}`);
        return r;
    }
    async function regles(hote) {
        if (robots.has(hote)) return robots.get(hote);
        const r = await requete(`https://${hote}/robots.txt`, 'robots.txt : ');
        let reg;
        if (r.status === 404 || r.status === 410) reg = [];
        else if (r.status === 200) reg = regleRobots(await r.text());
        else throw arreter(hote, `robots.txt illisible (HTTP ${r.status}) : je ne sais pas, je ne demande rien`);
        robots.set(hote, reg); return reg;
    }
    async function get(url) {
        if (arret) throw arret;
        let courant = url;
        for (let saut = 0; saut <= 3; saut++) {
            const u = new URL(courant);
            if (u.protocol !== 'https:' || !HOTES_COLLECTE.includes(u.hostname)) throw new Error(`hôte ${u.hostname} hors de la liste fermée`);
            if (arretes.has(u.hostname)) throw arretes.get(u.hostname);
            if (!autorise(await regles(u.hostname), u.pathname)) throw new Error(`robots.txt de ${u.hostname} interdit ${u.pathname}`);
            const r = await requete(courant);
            if ([301, 302, 303, 307, 308].includes(r.status)) {
                const loc = r.headers.get('location'); if (!loc) throw new Error('redirection sans destination');
                const cible = new URL(loc, courant);
                if (cible.protocol !== 'https:' || cible.hostname !== u.hostname) throw new Error(`redirection hors de l'hôte vers ${cible.hostname} : refusée`);
                courant = cible.href; continue;
            }
            const buf = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
            return { status: r.status, buf, type: r.headers.get('content-type'), url: courant };
        }
        throw new Error('trop de redirections');
    }
    return { get, compte, arrete: () => arret, hotesArretes: () => arretes };
}

const contentType = ext => ({ png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg', jpg: 'image/jpeg' })[ext] ?? 'application/octet-stream';
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * L'écriture d'UNE ligne : l'image et sa vignette dans R2, puis `sets.logoOfficiel.<cible>` — un champ NEUF, posé seulement s'il est absent (filtre
 * `$exists: false`). Un logoOfficiel déjà posé n'est jamais remplacé : même fichier → « deja », autre fichier → « refus ». Rien d'autre n'est écrit.
 */
// `lot`, `refusDeLangue` et `ajout` sont réservés aux routes Bulbapedia (collecte-cartes/logos-bulba.js) : leur langue se prouve par la règle des NOMS DE FICHIER
// (langue-logo.js), jamais par l'adresse ; `ajout` = { entree, preuve } est ajouté à l'entrée, il ne remplace aucun champ de base.
async function ecrireLigne({ S, r2, bucket, ligne, set, fichier, le = new Date(), lot = LOT, refusDeLangue = refusLangue, ajout = {} }) {
    const { fabriquerVignette, cleVignette, LARGEUR_VIGNETTE_LOGO } = require('./collecte-cartes/vignette');
    if (!SLUG.test(set)) return { action: 'refus', raison: `identifiant de set « ${set} » non sûr pour une clé R2` };
    if (!['fr', 'ja'].includes(ligne.cible)) return { action: 'refus', raison: `cible « ${ligne.cible} » inconnue` };
    // LA LANGUE (ruling du coordinateur) : la garde est ici AUSSI, sur l'adresse du fichier qu'on s'apprête à écrire — pas seulement dans planifier
    const rL = refusDeLangue(ligne, fichier.url);
    if (rL) return { action: 'refus', raison: rL };
    const champ = `logoOfficiel.${ligne.cible}`;
    const doc = await S.findOne({ _id: set }, { projection: { logoOfficiel: 1 } });
    if (!doc) return { action: 'refus', raison: `set ${set} absent` };
    const deja = doc.logoOfficiel?.[ligne.cible];
    if (deja) return deja.sha256 === fichier.sha256 ? { action: 'deja' } : { action: 'refus', raison: `${set} porte déjà un logoOfficiel.${ligne.cible} différent (${deja.lot}) : rien n'est remplacé` };
    const cleR2 = `logos-officiels/${ligne.cible}/${set}-${fichier.sha256.slice(0, 10)}.${fichier.ext}`;
    const cv = cleVignette(cleR2);
    const vg = await fabriquerVignette(fichier.buf, { largeur: LARGEUR_VIGNETTE_LOGO, qualite: 85 });
    const meta = await sharp(fichier.buf).metadata();
    const d1 = await r2.deposerBinaire(bucket, cleR2, fichier.buf, contentType(fichier.ext));
    const d2 = await r2.deposerBinaire(bucket, cv, vg.buffer, 'image/webp');
    const entree = {
        ...(ajout.entree ?? {}),
        cleR2, w: meta.width, h: meta.height, octets: fichier.buf.length, sha256: fichier.sha256, format: meta.format, langue: ligne.langue,
        source: ligne.source, urlSource: fichier.url, lot, mention: MENTION, le, vignette: { cleR2: cv, w: vg.w, h: vg.h },
        preuve: { urlSource: fichier.url, verifie: fichier.via, corr: fichier.corr ?? null, comparePhase1: ligne.cache?.sha256 === fichier.sha256, fichierPokecardex: ligne.fichier, pokecardexSha256: ligne.pokecardexSha256, setDeLaLigne: ligne.set, scorePhase1: ligne.score ?? null, ...(ligne.regardePar ? { regardePar: ligne.regardePar, raisonRegarde: ligne.raisonRegarde, confirmationSet: ligne.confirmationSet } : {}), ...(ajout.preuve ?? {}) }
    };
    const u = await S.updateOne({ _id: set, [champ]: { $exists: false } }, { $set: { [champ]: entree } });
    if (u.modifiedCount === 1) return { action: 'ecrit', cleR2, vignette: cv };
    // le champ est apparu entre-temps : les objets que CET appel vient de déposer (et eux seuls : un objet déjà là n'est pas à nous) sont retirés, et dits
    const supprimes = [d1.ecrit ? cleR2 : null, d2.ecrit ? cv : null].filter(Boolean);
    if (supprimes.length) await r2.supprimer(bucket, supprimes);
    return { action: 'refus', raison: `${set} : le champ est apparu entre-temps${supprimes.length ? ` ; ${supprimes.length} objet(s) R2 déposé(s) par cet appel retiré(s) : ${supprimes.join(', ')}` : ''}`, supprimes };
}

/** Le retrait du lot (voir retirer-logos-officiels.js) : exactement les entrées `logoOfficiel.*` de CE lot, et leurs objets R2. */
async function retirerLot({ S, r2, bucket, lot, ecrire = false, journal = m => console.log(m) }) {
    if (!lot) throw new Error('retirerLot : lot obligatoire');
    const docs = await S.find({ $or: [{ 'logoOfficiel.fr.lot': lot }, { 'logoOfficiel.ja.lot': lot }] }, { projection: { logoOfficiel: 1 } }).toArray();
    const sets = [], cles = [], parSet = new Map();
    for (const d of docs) {
        const ks = Object.keys(d.logoOfficiel || {}).filter(k => d.logoOfficiel[k]?.lot === lot);
        if (!ks.length) continue;
        sets.push(d._id); parSet.set(d._id, ks);
        for (const k of ks) for (const c of [d.logoOfficiel[k].cleR2, d.logoOfficiel[k].vignette?.cleR2]) if (c) cles.push(c);
    }
    for (const c of cles) if (!/^(vignettes\/)?logos-officiels\//.test(c)) throw new Error(`retirerLot : clé « ${c} » hors du préfixe logos-officiels/ : arrêt`);
    // la liste COMPLÈTE des clés R2 du lot, imprimée AVANT toute modification : un R2 qui échoue après le retrait en base n'en fait perdre aucune
    await journal(`CLÉS R2 DU LOT ${lot} (${cles.length}, ${sets.length} sets : ${sets.join(', ')}) : ${cles.join(' ')}`);
    if (!ecrire) return { sets, cles };
    for (const [id, ks] of parSet) {
        for (const k of ks) await S.updateOne({ _id: id, [`logoOfficiel.${k}.lot`]: lot }, { $unset: { [`logoOfficiel.${k}`]: '' } });
        await S.updateOne({ _id: id, logoOfficiel: {} }, { $unset: { logoOfficiel: '' } });
    }
    if (cles.length) await r2.supprimer(bucket, cles);
    return { sets, cles };
}

module.exports = { REGARDES_2026_10_11, EXCLUS_2026_10_11, promouvoir, LOT, MENTION, HOTES_COLLECTE, CADENCE_MS, sourceDe, verifierUrl, refusSetIdentifie, refusSetBase, planifier, juger, reduireDoublons, creerClient, regleRobots, autorise, ecrireLigne, retirerLot, ArretDefi, ArretHote, langueProuvee, refusLangue };

// ───────────────────────── la ligne de commande
const AUTORISES = [/^--table=.+\.json$/, /^--pokecardex=.+$/, /^--cache=.+$/, /^--rapport=.+\.json$/, /^--ecrire$/];
if (require.main === module) (async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --cache=<dossier> (obligatoire), --table=, --pokecardex=, --rapport=, --ecrire`); process.exit(2); }
    const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ECRIRE = process.argv.includes('--ecrire');
    const cache = arg('cache');
    if (!cache) { console.error('❌ --cache=<dossier> obligatoire : les fichiers téléchargés y sont gardés, et l\'écriture les relit au lieu de redemander'); process.exit(2); }
    const table = JSON.parse(fs.readFileSync(path.resolve(arg('table') || path.join(__dirname, 'collecte-cartes', 'logos-officiels-table.json')), 'utf8'));
    const racine = arg('pokecardex') || path.join(__dirname, '..', 'pokemon-proxy');
    fs.mkdirSync(cache, { recursive: true });
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await ouvrirConnexions({ production: false, buckets: ECRIRE ? ['R2_BUCKET_IMAGES'] : [] });
    const S = cx.cartes.db.collection('sets');
    const sets = new Map((await S.find({}, { projection: { tirage: 1, region: 1, nomJa: 1, code: 1 } }).toArray()).map(s => [s._id, s]));
    if (!sets.size) throw new Error('collection sets vide : base fausse');
    const tcgdexJa = (await cx.cartes.db.collection('tcgdex_sets').findOne({ _id: 'ja/__liste__' }))?.sets ?? null;   // le cache TCGdex ja (0 requête) : la seconde voie de SV11W
    const regardes = table.lignes.filter(l => l.verdict === 'À REGARDER').map(l => ({ l, p: promouvoir(l, sets, { tcgdexJa }) }));
    const officiels = [...table.lignes.filter(l => l.verdict === 'OFFICIEL'), ...regardes.filter(r => r.p.ligne).map(r => r.p.ligne)];
    console.log(`DÉNOMINATEUR : ${table.lignes.length} lignes dans la table · ${officiels.length} OFFICIEL · ${sets.size} sets en base · lot ${LOT}`);
    const verdicts = [...officiels.map(l => ({ l, ...planifier(l, sets) })), ...regardes.filter(r => !r.p.ligne).map(r => ({ l: r.l, action: 'ecartee', raison: r.p.raison }))];
    console.log(`REGARDÉS À L'ŒIL (2026-10-11) : ${regardes.length} À REGARDER · ${regardes.filter(r => r.p.ligne).length} promus OFFICIEL · ${regardes.filter(r => !r.p.ligne).length} non promus`);
    const compte = {}; for (const v of verdicts) compte[v.action] = (compte[v.action] || 0) + 1;
    console.log(`PLAN (avant tout téléchargement) : ${Object.entries(compte).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    const aCollecter = verdicts.filter(v => v.action === 'collecter').map(v => v.l);
    const client = creerClient();
    const rapport = { lot: LOT, le: new Date().toISOString(), lignes: [] };
    const acceptes = [];
    let arretDefi = null;
    const hotesArretes = new Set();
    for (const l of aCollecter) {
        const cle = path.join(cache, sha256(Buffer.from(l.urlChoisie)));
        let buf = null, urlFinale = l.urlChoisie;
        if (fs.existsSync(`${cle}.bin`) && fs.existsSync(`${cle}.json`)) { const j = JSON.parse(fs.readFileSync(`${cle}.json`, 'utf8')); const b = fs.readFileSync(`${cle}.bin`); if (j.url === l.urlChoisie && j.sha256 === sha256(b) && Date.now() - Date.parse(j.le) < 36 * 3600 * 1000) { buf = b; urlFinale = j.urlFinale; } }
        if (!buf) {
            try {
                const r = await client.get(l.urlChoisie);
                if (r.status !== 200) { rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'ecartee', raison: `HTTP ${r.status}` }); console.log(`   ⚪ ${l.fichier} : HTTP ${r.status}`); continue; }
                buf = r.buf; urlFinale = r.url;
                fs.writeFileSync(`${cle}.bin`, buf); fs.writeFileSync(`${cle}.json`, JSON.stringify({ url: l.urlChoisie, urlFinale, sha256: sha256(buf), le: new Date().toISOString() }));
            } catch (e) {
                if (e.arret) { arretDefi = e.message; console.error(`🛑 ${e.message}`); break; }
                if (e.arretHote) { rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'non-tentee', raison: `hôte ${e.hote} arrêté pour ce lancement` }); if (!hotesArretes.has(e.hote)) { hotesArretes.add(e.hote); console.error(`🛑 ${e.message}`); } continue; }
                rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'refus', raison: e.message }); console.log(`   🔴 ${l.fichier} : ${e.message}`); continue;
            }
        }
        const pb = fs.existsSync(path.join(racine, l.fichier)) ? fs.readFileSync(path.join(racine, l.fichier)) : null;
        const pokecardexBuf = pb && sha256(pb) === l.pokecardexSha256 ? pb : null;
        const j = await juger(l, buf, { pokecardexBuf });
        if (!j.ok) { rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'refus', raison: j.raison }); console.log(`   🔴 ${l.fichier} → ${l.set} : ${j.raison}`); continue; }
        acceptes.push({ ligne: l, sha256: j.sha256, fichier: { buf, sha256: j.sha256, ext: j.format === 'jpeg' ? 'jpg' : j.format, url: urlFinale, via: j.via, corr: j.corr } });
    }
    const dd = reduireDoublons(acceptes);
    acceptes.forEach((a, i) => { a.action = dd[i].action; if (dd[i].raison) a.raison = dd[i].raison; if (dd[i].action !== 'ecrire') rapport.lignes.push({ fichier: a.ligne.fichier, set: a.ligne.set, source: a.ligne.source, action: dd[i].action, raison: dd[i].raison ?? `même fichier que ${dd[i].meme}` }); });
    for (const v of verdicts.filter(v => v.action !== 'collecter')) rapport.lignes.push({ fichier: v.l.fichier, set: v.l.set, source: v.l.source, action: v.action, raison: v.raison });
    const aEcrire = acceptes.filter(a => a.action === 'ecrire');
    for (const a of aEcrire) rapport.lignes.push({ fichier: a.ligne.fichier, set: a.ligne.set, source: a.ligne.source, action: 'collectable', via: a.fichier.via, url: a.fichier.url });
    const parSource = {}; for (const a of aEcrire) parSource[a.ligne.source] = (parSource[a.ligne.source] || 0) + 1;
    const ecartees = {}; for (const r of rapport.lignes.filter(r => r.action !== 'collectable')) { const k = `${r.action}: ${String(r.raison).replace(/« [^»]*»/g, '«…»').replace(/\d+/g, 'N').slice(0, 90)}`; ecartees[k] = (ecartees[k] || 0) + 1; }
    rapport.collectables = aEcrire.length; rapport.parSource = parSource; rapport.requetes = client.compte; rapport.arret = arretDefi;
    console.log(`\nSIMULATION : ${aEcrire.length} collectables sur ${officiels.length} OFFICIEL · par source ${JSON.stringify(parSource)} · via ${JSON.stringify(aEcrire.reduce((o, a) => (o[a.fichier.via] = (o[a.fichier.via] || 0) + 1, o), {}))}`);
    console.log('ÉCARTÉES / REPORTÉES / REFUSÉES :'); for (const [k, n] of Object.entries(ecartees).sort((a, b) => b[1] - a[1])) console.log(`   ${n} × ${k}`);
    console.log(`REQUÊTES : ${JSON.stringify(client.compte)}${arretDefi ? ` · ARRÊT : ${arretDefi}` : ''}`);
    if (arg('rapport')) fs.writeFileSync(arg('rapport'), JSON.stringify(rapport, null, 1));
    if (arretDefi) { await cx.fermer(); process.exit(1); }
    if (hotesArretes.size) {
        console.error(`🛑 HÔTE(S) ARRÊTÉ(S) : ${[...hotesArretes].join(', ')} — ${rapport.lignes.filter(r => r.action === 'non-tentee').length} lignes non tentées ; rien n'est écrit. REPRISE : relancer la MÊME commande plus tard (le cache ${cache} garde les fichiers déjà obtenus, seuls les manquants sont redemandés).`);
        await cx.fermer(); process.exit(1);
    }
    if (!ECRIRE) { console.log('(simulation seule — --ecrire sous lot-additif.js ; rien n\'est écrit en base ni sur R2)'); await cx.fermer(); return; }
    const r2 = require('./collecte-cartes/r2'), bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);
    const bilan = {};
    for (const a of aEcrire) { const e = await ecrireLigne({ S, r2, bucket, ligne: a.ligne, set: a.ligne.set, fichier: a.fichier }); bilan[e.action] = (bilan[e.action] || 0) + 1; if (e.action === 'refus') console.log(`   🔴 ${a.ligne.fichier} → ${a.ligne.set} : ${e.raison}`); }
    const relus = await S.countDocuments({ $or: [{ 'logoOfficiel.fr.lot': LOT }, { 'logoOfficiel.ja.lot': LOT }] });
    console.log(`\nÉCRIT : ${JSON.stringify(bilan)} · RELU : ${relus} sets portent un logoOfficiel du lot ${LOT}`);
    await cx.fermer();
    if ((bilan.refus || 0) > 0) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });

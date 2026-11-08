'use strict';
// ============================================================
// LES PREUVES VALIDÉES « prv » (phase 4, 2026-10-26) — le cœur PUR : lire un manifeste, rapprocher ses entrées des validations du coordinateur, décider par règle, former les unités
// ============================================================
// Des agents de recherche trouvent des images de cartes, les téléchargent (client poli, cache PARTAGÉ), les REGARDENT et écrivent ce qu'ils y lisent dans `S8\PHASE4\<FAMILLE>\preuves.json`.
// Le coordinateur regarde chaque image sur planche et VALIDE (`S8\PHASE4\VALIDATIONS\valide-<FAMILLE>.json`). Ce module décide, SANS base ni réseau (seulement le cache disque), quelles entrées
// deviennent des unités d'écriture pour la règle commune de la récolte (recolte-commun.js, source `parUnite`), et lesquelles sont refusées — chaque refus NOMMÉ.
//
// Rien ici n'est recopié (§21 bis) : la clé de numéro est celle de la jointure (`cleNumero`), la langue d'un tirage celle de comblement.js (`langueDuTirage`), la règle d'image celle de
// concordance-image.js (`deciderVisuel`), la lecture d'un cache celle de recolte-hote.js (`lireDuCache`), le jugement d'une image celui de recolte-commun.js (`juger`).
// Écrit par ce qu'il AUTORISE : tout ce qui n'est pas explicitement conforme est REFUSÉ (direction sûre : un visuel absent est honnête, celui d'un autre tirage est un mensonge).
// ⚠️ LIMITE CONNUE (nom traduit, 2026-11-02) : la LANGUE du scan n'est vérifiée que par la saisie du chasseur (`lu.langue`) ; rien, dans ce module, ne la lit sur l'image. Elle est comparée à la langue du tirage du
// produit, jamais à l'image. De même, le nom traduit ne témoigne que par Pokédex + règle (+ PV quand la carte existe) : deux cartes de même espèce et même règle dans un set (« jumeaux ») ne se séparent
// que par le numéro lu — la preuve porte alors `jumeau-dans-le-set`, et le coordinateur le vérifie sur une rognure.
// ⚠️ LIMITE (table croisée, 03/11) : pour un Dresseur / une Énergie japonais sans nomJa, UNE seule autre carte de même nomEn portant ce nomJa suffit (décision du coordinateur) si aucun autre nomEn ne le porte ; la raison :
// numéro, code et total restent exigés et la planche du coordinateur reste la barrière. Une erreur de nomJa dans NOTRE base (une seule carte) passerait donc — la planche est la seule garde.
const crypto = require('crypto');
const fs = require('fs');
const J = require('./jointure');
const CO = require('./comblement');
const CI = require('./concordance-image');
const RC = require('./recolte-commun');
const HOTE = require('./recolte-hote');
const BD = require('./basse-definition');

// ── 0. Le descripteur de source : l'adresse PUBLIQUE est neutre (P6) ────────────────────────────────────────────────────────
const SOURCE = 'prv';
const LOT = 'prv-2026-10';
const LANGUE_PREUVE = 'langue lue sur le scan de la carte (preuve validée), propre à chaque visuel';
const NOMS_INTERDITS = ['pokipair', 'poki', 'tcgcsv', 'scrydex', 'packmagik', 'pokellector', 'pokumon', 'pikaqian', 'cardtrader', 'bulbapedia', 'tcgdex', 'artofpkm', 'pokedata', 'pkmncards', 'cardmarket'];
// `LANGUE` et `TIRAGE` ne servent à rien ici (source `parUnite` : chaque unité porte les siens ; une unité sans langue LÈVE) — ils portent un libellé qui ne peut être pris pour une vraie valeur.
const SRC = RC.fabriquerSource({ SOURCE, LOT, LANGUE: 'par-unite', LANGUE_PREUVE, TIRAGE: 'par-unite', CHAMP_BILAN: 'bilanLotPrv', nomsInterdits: NOMS_INTERDITS, parUnite: true });

// ── 1. P4 : la langue du tirage du produit ───────────────────────────────────────────────────────────────────────────────────
// DÉCISION DU TESTEUR (26/10) : « on ouvre le français pour McDonald's 2018/2019 européens (idExpansion 2361 et 3354) : le produit EST français, c'est son tirage ». Table ÉNUMÉRÉE par idExpansion ENTIER :
// elle l'emporte sur la langue du set pour ces seules expansions ; tout autre idExpansion suit la fonction de production, sans changement.
const EDITIONS_LOCALES = Object.freeze({ 2361: 'fr', 3354: 'fr' });
// ➕ 2026-11-03 (testeur : « pose le tirage des sets indonésiens et thaïs, puis les visuels qu'il débloque ») : le tirage DÉCLARÉ de 14 sets est `idth` — les deux langues, prouvées par la page
// source (§67, 2026-09-26) ; le site admet `id` et `th` sur un set idth (lib/langueDuVisuel.ts). Un tirage à DEUX langues prend donc pour langue du produit celle des siennes qui est LUE sur le scan
// (`langueLue`) ; une langue lue hors des siennes, ou rien de lu, rend null (refus `langue-du-tirage-inconnue`, inchangé). Un tirage à UNE langue ignore la langue lue (table de production, comme avant).
// ⚠️ LIMITE (relecture 03/11) : pour idth, la comparaison « langue lue = langue du produit » devient vide (la seconde dérive de la première) : la langue DÉCLARÉE par le manifeste choisit id ou th. Rien dans le code
// ne lit la langue sur les pixels (même confiance que th / zh-hans, en tête de ce fichier) ; la planche de validation du coordinateur regarde la langue des lots idth — c'est la barrière, et elle est humaine.
function langueDuProduit({ idExpansion, tirage, langueLue } = {}) {
    if (Number.isInteger(idExpansion) && Object.hasOwn(EDITIONS_LOCALES, idExpansion)) return EDITIONS_LOCALES[idExpansion];
    const langues = CO.languesDuTirage(tirage);
    if (langues.length === 1) return langues[0];
    return langues.length > 1 && typeof langueLue === 'string' && langues.includes(langueLue) ? langueLue : null;
}

// ── 2. Petites lectures ──────────────────────────────────────────────────────────────────────────────────────────────────────
// ➕ HD-ZH (2026-11-01) : « remplacement-meme-dessin » — une preuve SANS NOM pour un tirage à écriture non latine (le nom chinois, japonais, coréen ou thaï n'a pas de colonne chez Cardmarket, motifDeNom le refuse).
// Écrite par ce qu'elle AUTORISE (evaluerRemplacementMemeDessin) : elle REMPLACE une entrée déjà servie, jamais ne comble un trou.
const REGLE_MEME_DESSIN = 'remplacement-meme-dessin';
const REGLES = Object.freeze(['preuve-lue', 'deux-sources', REGLE_MEME_DESSIN]);
/** Liste FERMÉE des langues admises par la règle sans nom. Aucune autre, jamais. `ja` en est sorti (la décision de remplacement de cardtrader.js laisse passer une seconde entrée `ja` : il rouvrira avec son durcissement) ; `ko` n'a aucun tirage. */
const LANGUES_NON_LATINES = Object.freeze(['zh-hans', 'zh-hant', 'th']);
/**
 * La langue d'une candidate n'est PAS lue sur l'image par cette règle : elle vient d'une page source qui est une LISTE de ce tirage, confirmée par la planche du coordinateur. Le moyen le DIT (`lu.langueMoyen`)
 * et ne vaut que pour la langue qu'il nomme ; `lu.pageListe` (https) est l'adresse de la liste. Table fermée : un autre tirage n'a pas de moyen admis tant qu'on n'en a pas écrit un.
 */
const MOYENS_DE_LANGUE = Object.freeze({ 'liste-source-zh-hans+planche': 'zh-hans' });
/** Les PLANCHERS de la preuve de même dessin (décision de l'éditeur, mesurés sur les trois sets du lot) : un seuil, un score ou un vide calibrés plus bas ne prouvent rien. */
const SEUIL_PLANCHER = 0.70, SCORE_PLANCHER = 0.80, VIDE_PLANCHER = 0.05;
/** Le moyen par lequel le numéro imprimé a été lu sur la candidate : OCR ou œil du coordinateur. Il s'écrit. */
const MOYENS_DE_LECTURE = Object.freeze(['ocr', 'oeil']);
const HEX64 = /^[0-9a-f]{64}$/;
const texte = s => typeof s === 'string' && s.trim() !== '';
const objet = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const norm = s => (s == null || String(s).trim() === '' ? null : String(s).trim().toLowerCase());
const dateDe = v => { const d = v instanceof Date ? v : (typeof v === 'string' && v ? new Date(v) : null); return d && !Number.isNaN(d.getTime()) ? d : null; };
const urlHttps = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const sha256De = b => crypto.createHash('sha256').update(b).digest('hex');
/** Les deux derniers segments d'un nom d'hôte : « cdn.exemple.com » et « www.exemple.com » sont le même SITE (deux hôtes d'un même opérateur ne sont pas deux sources indépendantes). */
const racineDe = h => String(h ?? '').trim().toLowerCase().split('.').slice(-2).join('.');
const numeroDuProduit = p => { const n = p?.numero == null ? '' : String(p.numero).trim(); return n === '' ? null : n; };
const PREFIXE_ALPHABETIQUE = /^[A-Za-z]+\d/;
// Tour 3 (1) — `tamponnee` de l'état est le champ `reimpressions` du SET (audit-catalogue/etat-api.js), pas toujours un tampon physique : `pps`, `ba20`… en sont ; `metacarte` (poser-par-metacarte.js) dit
// seulement que les fiches ont été jointes par la désignation croisée — AUCUN tampon sur la carte. TABLE FERMÉE valeur -> tampon attendu sur le scan (liste lue sur l'état du 2026-10-26) ; une valeur
// inconnue ne passe jamais (`tampon-inconnu`) : une garde s'écrit par ce qu'elle autorise.
// Tour 4 (2) : le tampon physique de Battle Academy est le MÊME pour 2020, 2022 et 2024 — l'année ne se lit pas sur l'image (elle se prouve autrement : position unique + numéro imprimé de la carte).
const TAMPONS_ATTENDUS = Object.freeze({ metacarte: null, wcd: 'wcd', pps: 'pps', ba24: 'battle-academy', ba22: 'battle-academy', ba20: 'battle-academy', sea: 'sea', pr: 'pr', ppp: 'ppp', boo24: 'boo24', boo: 'boo', boo23: 'boo23', pwc: 'pwc' });
/** @returns {{ok: boolean, valeur: string|null}} ok = false pour une valeur hors de la table (null, undefined et « » = pas de tampon). */
function tamponAttendu(t) {
    if (t == null || t === '') return { ok: true, valeur: null };
    if (typeof t === 'string' && Object.hasOwn(TAMPONS_ATTENDUS, t)) return { ok: true, valeur: TAMPONS_ATTENDUS[t] };
    return { ok: false, valeur: null };
}
/**
 * Tour 3 (2) — la carte imprime « XY150a », le produit Cardmarket porte « 150a » (la jointure de production essaie les deux écritures). Admis SEULEMENT si (a) le numéro lu sans son préfixe alphabétique égale
 * (cleNumero) le numéro du produit, qui COMMENCE par un chiffre, et (b) le slug du produit, témoin indépendant, FINIT par le numéro lu avec son préfixe (insensible à la casse).
 */
// Tour 4 (4) : avec FRONTIÈRE — le caractère qui précède le numéro lu dans le slug n'est pas un chiffre (« …-1XY150a » ne contient pas « XY150a » ; « …XYPRXY150A » oui : « R » n'est pas un chiffre,
// et le préfixe lu « XY » est celui que le slug répète).
const finitParLeNumero = (slug, n) => {
    const s = slug.trim().toLowerCase(), k = n.toLowerCase();
    return s.endsWith(k) && !/\d/.test(s.charAt(s.length - k.length - 1));
};
const numeroSansPrefixeAdmis = (n, np, slug) => PREFIXE_ALPHABETIQUE.test(n) && /^\d/.test(np) && texte(slug) && J.cleNumero(n.replace(/^[A-Za-z]+/, '')) === J.cleNumero(np) && finitParLeNumero(slug, n);
/**
 * ➕ 2026-11-03 — DEMI-LISTES indonésiennes/thaïes (tpc-sets.js : « AS1–AS4 servis par DEMI-LISTES expansionCodes=<code>a|b ; notre numeroFiche porte la lettre »). Le PRODUIT porte « a229 » ; la carte imprime
 * « 229/205 » et le code « AC3a » ; le slug Cardmarket finit par « AC3a229 » (ou « AS3013 » sans la lettre). Table FERMÉE des codes. Admis SEULEMENT si les TROIS témoins concordent : la lettre du numéro du produit,
 * la lettre FINALE du code imprimé lu (même code de base, dans la table), le slug qui finit par <code><lettre ?><chiffres> ; et les chiffres lus = les chiffres du produit (clé de la jointure). Tout le reste = null.
 * @returns {{lettre: string, code: string}|null}
 */
const DEMI_LISTES = Object.freeze(['ac3', 'as1', 'as2', 'as3', 'as4']);
function demiListe(lu, produit, np) {
    const m = /^([ab])(\d+)$/i.exec(String(np ?? '').trim());
    if (!m) return null;
    const lettre = m[1].toLowerCase(), chiffres = m[2];
    const c = norm(lu?.codeSet);
    const mc = c ? /^([a-z0-9]+)([ab])$/.exec(c) : null;
    if (!mc || mc[2] !== lettre || !DEMI_LISTES.includes(mc[1])) return null;
    if (!texte(lu?.numero) || J.cleNumero(String(lu.numero).trim()) !== J.cleNumero(chiffres)) return null;
    const slug = texte(produit?.slug) ? produit.slug.trim().toLowerCase() : null;
    if (!slug || !new RegExp(`(^|-)${echapper(mc[1])}${lettre}?-?0*${echapper(chiffres)}$`).test(slug)) return null;
    return { lettre, code: mc[1] };
}
/** Tour 4 (3) : le numéro en FIN de slug Cardmarket (« …-PPS8MEG-114 » -> « 114 »), frontière non alphanumérique avant ; null si le slug n'en porte pas (« …-CIN71 » : collé à des lettres, ce n'est pas un numéro). */
const numeroFinDeSlug = slug => { const m = /(?:^|[^A-Za-z0-9])(\d+[A-Za-z]*)$/.exec(String(slug ?? '').trim()); return m ? m[1] : null; };
// Tour 4 (5) : la variante nommée d'un produit sans numéro (« Blue Border » / « standard ») se compare à la finition LUE, par table fermée ; une autre valeur de `attendu.variante` (V1, V2…) n'entre pas ici.
const FINITIONS_ATTENDUES = Object.freeze({ 'blue border': 'blue-border', standard: 'standard' });
/** Les seuls sets où une position lue vaut preuve : slugSet `Battle-Academy*` (préfixe) et slugSet contenant `Trainer-Kit`. */
const setAdmisPourPosition = slug => typeof slug === 'string' && (slug.startsWith('Battle-Academy') || slug.includes('Trainer-Kit'));
/**
 * (07/11) DÉCISION DE L'UTILISATEUR — « INTRO PACK SQUIRTLE (38 scans propres, numéro dans un rond seulement) : ADMIS si, dans ce produit, chaque nom n'apparaît qu'une fois (le nom suffit alors à identifier la
 * carte), que le numéro rond concorde avec la liste du produit, et qu'il y a deux sources. Liste fermée. Sinon, en attente. »
 * ARBITRAGE DU COORDINATEUR (07/11) : « chaque nom n'apparaît qu'une fois » se juge PAR CARTE — le nom de LA carte jugée n'apparaît qu'une fois parmi les produits du set ; une carte dont le nom est porté par
 * plusieurs cartes du set (Growlithe n°1 et n°26, Squirtle, Wartortle, les Énergies) reste refusée (« en attente »), car le nom doit suffire à identifier la carte.
 * Table FERMÉE, slugSet exact (jamais un préfixe) -> conditions. Le rond lu (`lu.position`) est le numéro de la liste du produit ; pas de total. Les gardes communes (nom, langue, tampon, contradictions, marques) s'appliquent.
 */
const POSITIONS_RONDES = Object.freeze({ 'Intro-Pack-Squirtle': Object.freeze({ nomUnique: true, deuxSources: true }) });
const positionRonde = slug => typeof slug === 'string' && Object.hasOwn(POSITIONS_RONDES, slug);
/** Combien de produits du set portent le nom de celui-ci ? null si la liste est inconnue (absente, vide, ou un nom manquant) : « je ne sais pas » n'est jamais « tout va bien ». */
function occurrencesDuNomDansLeSet(produit) {
    const noms = produit?.nomsDuSet;
    if (!Array.isArray(noms) || noms.length === 0 || !noms.every(texte) || !texte(produit?.nomEn)) return null;
    const mien = J.decomposerNomCardmarket(produit.nomEn).nom;
    return noms.filter(n => memeNomQueLeProduit(mien, n)).length;
}
/** @returns {string[]} les motifs de refus d'un rond lu pour un set de POSITIONS_RONDES (vide = conforme) */
function motifsDePositionRonde(lu, produit, np, sansTotalAutorise) {
    const regle = POSITIONS_RONDES[produit.slugSet], m = [];
    if (regle.deuxSources && sansTotalAutorise !== true) m.push('position-ronde-source-unique');
    if (!texte(lu.position)) return [...m, 'position-vide'];
    if (np == null) return [...m, 'position-sans-numero-produit'];
    if (regle.nomUnique) {
        const n = occurrencesDuNomDansLeSet(produit);
        if (n === null || n === 0) m.push('noms-du-set-inconnus');
        else if (n !== 1) m.push('nom-non-unique-dans-le-set');
    }
    if (J.cleNumero(String(lu.position).trim()) !== J.cleNumero(np)) m.push('numero-different');
    return m;
}
/** Le nom lu sur le scan est-il celui du produit ? Nom Cardmarket décomposé (avant « [ ») puis `clesNom` de la jointure ; l'un ou l'autre côté vide = non. */
const memeNomQueLeProduit = (lu, nomProduit) => {
    if (!texte(lu) || !texte(nomProduit)) return false;
    // tour 4 (1) : accents tolérés (« Pokégear 3.0 » = « Pokegear 3.0 »)
    const cles = new Set(J.clesNom(SANS_ACCENTS(J.decomposerNomCardmarket(nomProduit).nom)));
    return J.clesNom(SANS_ACCENTS(lu)).some(k => cles.has(k));
};
/** Égalité de deux noms japonais : NFKC, espaces et points médians retirés ; l'un ou l'autre côté vide = non (rien à comparer n'est jamais une concordance). */
const cleJaponaise = s => (texte(s) ? String(s).normalize('NFKC').replace(/[\s・･·]/g, '') : '');
const memeNomJaponais = (lu, nomJa) => cleJaponaise(lu) !== '' && cleJaponaise(lu) === cleJaponaise(nomJa);
/**
 * Tour 4 (1) : le nom lu est exigé PARTOUT. Lu en anglais, il se compare au nom anglais du produit (`nomEn`).
 * Décision du testeur (27/10) : lu en français, il se compare au nom FRANÇAIS du produit (`nomFr`, numeros_cartes) — SEULEMENT si le produit est un tirage français (langue du produit = langue lue) ;
 * jamais au nom anglais. Toute autre langue lue = refus.
 */
const motifDeNom = (lu, produit, langueProduit, drapeaux = []) => {
    if (lu.langue === 'en') return memeNomQueLeProduit(lu.nom, produit?.nomEn) ? null : 'nom-different';
    if (lu.langue === 'fr' && langueProduit === 'fr') return memeNomQueLeProduit(lu.nom, produit?.nomFr) ? null : 'nom-different';
    // a-reste (japonais) : un nom lu en japonais se compare au nom JAPONAIS de la carte désignée par la ligne (`produit.nomJa`, témoin de lecture, jamais écrit en public), SEULEMENT pour un tirage japonais ; jamais au nom anglais.
    // Une carte qui A un nomJa s'en tient là (un nom qui diffère est un désaccord, jamais un repli) ; sans nomJa, le nom traduit se juge par ce qui ne se traduit pas (ci-dessous).
    if (lu.langue === 'ja' && langueProduit === 'ja' && (texte(produit?.nomJa) || !porteUnTemoinTraduit(lu))) return memeNomJaponais(lu.nom, produit?.nomJa) ? null : 'nom-different';
    // ➕ 2026-11-03 : les cartes INDONÉSIENNES impriment le nom ANGLAIS des Pokémon (les Dresseurs sont traduits, « Tukar Pokémon », §75) : un nom lu en indonésien IDENTIQUE au nom anglais du produit témoigne
    // seul, exactement comme l'anglais (même fonction). Thaï, chinois, japonais : autre écriture, jamais ouvert ; un nom indonésien DIFFÉRENT suit la règle traduite ci-dessous (témoins ou refus).
    if (lu.langue === 'id' && langueProduit === 'id' && memeNomQueLeProduit(lu.nom, produit?.nomEn)) return null;
    if (LANGUES_A_NOM_TRADUIT.includes(lu.langue) && lu.langue === langueProduit && porteUnTemoinTraduit(lu)) return motifDeNomTraduit(lu, produit, numeroDuProduit(produit), drapeaux);
    return 'nom-langue-non-anglaise';
};
// ── Le nom TRADUIT (2026-11-02) : chinois, indonésien, thaï, et japonais sans `nomJa` (fiche simple, aucune carte) ─────────────────────────────────────────────
// Un nom traduit ne se compare à rien chez nous. Il se compare par ce qui NE SE TRADUIT PAS : le n° de Pokédex, les PV (en chiffres) et la RÈGLE (ex, V, VMAX, V-UNION, Méga, forme X/Y : lettres latines
// partout) — la règle de tpc.js (§75), dont on RÉUTILISE les fonctions (`dexDuNom`, `reglesDuNom`) : une copie divergerait (§21 bis). Le nom traduit n'est qu'un TÉMOIN EN PLUS : la règle ne s'ouvre que si le
// numéro (déjà comparé par l'appelant) ET le code du set lus concordent avec le produit (slug Cardmarket, ou la ligne `codes_set`). Écrite par ce qu'elle AUTORISE : tout cas imprévu refuse.
const TPC = require('./tpc');
const LANGUES_A_NOM_TRADUIT = Object.freeze(['ja', 'zh-hans', 'zh-hant', 'id', 'th']);
/** Ce que le chasseur saisit en plus du nom : un manifeste qui n'en porte aucun garde exactement le comportement d'avant. */
const CHAMPS_TEMOIN_TRADUIT = Object.freeze(['dex', 'pv', 'regle', 'codeSet']);
const porteUnTemoinTraduit = lu => CHAMPS_TEMOIN_TRADUIT.some(k => lu?.[k] != null && lu[k] !== '');
// Une forme régionale (Alola, Galar, Hisui, Paldea) a le Pokédex de sa forme de base : aucun témoin ne la distingue. Lue d'un côté OU de l'autre, elle REFUSE.
const REGIONAL_PRODUIT = /\b(alolan|galarian|hisuian|paldean)\b/i;
const REGIONAL_LU = /アローラ|ガラル|ヒスイ|パルデア|阿羅拉|阿罗拉|伽勒爾|伽勒尔|洗翠|帕底亞|帕底亚|อโลลา|กาลาร์|ฮิซุย|ปัลเดีย|alola|galar|hisui|paldea/i;
const entierPositif = v => typeof v === 'number' && Number.isInteger(v) && v > 0;
const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Deux decks japonais impriment un autre code que Cardmarket. Table FERMÉE, code Cardmarket → code IMPRIMÉ, dans ce sens seulement ; aucune règle générale (suffixe « v » retiré, inclusion) : ce serait une clé par inclusion.
 *  · mEEv → mEE : planche pl-sb-mEEv-mEZ.png (phase4-b-visuels), 10 cartes MEGA Starter Set Eevee ex (Jolteon 001/019 … Eevee 020/019) portant « mEE » dans la ligne du bas ; Cardmarket : slugSet MEGA-Starter-Set-Eevee-ex, idExpansion 6637, codeSet « mEEv ».
 *  · sKV → sK  : planche pl-sKV.png (phase4-b-visuels), 5 cartes VSTAR Premium Trainer Box (Cherubi 001/030 … Mew 007/030) portant « sK » ; Cardmarket : slugSet Premium-Trainer-Box-VSTAR, idExpansion 4515, codeSet « sKV ».
 * Aucun autre set ne porte « mEE » ou « sK » (univers-expansions.json, table-sets.js, table-sets-auto.json, table-sets-sans-page.json : aucune occurrence, vérifié le 2026-11-02).
 */
const CODES_IMPRIMES_ALIAS = Object.freeze({ mEEv: 'mEE', sKV: 'sK' });
/**
 * (07/11) Cardmarket range PLUSIEURS decks sous un seul code (§53 : sA = cinq decks) ; la carte imprime alors le code de SON deck. Table FERMÉE, code Cardmarket du set (ligne codes_set) → { slugSet exigé,
 * codes imprimés admis, preuve }. Écrite par ce qu'elle AUTORISE (§51) : tout code imprimé différent et absent d'ici reste `code-set-different` ; aucune règle générale (préfixe, inclusion). Chaque entrée est
 * prouvée par une concordance NOM + NUMÉRO lue dans le cache d'audit (lecture.json, produits) le 2026-11-07 ; sans concordance, l'entrée n'entre pas. Le numéro et le nom restent comparés ailleurs.
 *  · sC (VMAX-Starter-Decks, idExpansion 3595) → sC2 : 524115 Professor's Research - Professor Juniper n°17, 524120 Poké Kid n°18, 524125 Hop n°19, 524130 Marnie n°20 = les cartes 017 à 020/021 imprimées « sC2 ».
 *    Les autres decks de 3595 (sC1, sC3…) ne sont PAS prouvés : ils ne sont pas admis.
 *  · T-P (T-Promos, idExpansion 4354) → T : 571134 Slowpoke [Pound | Lazy Headbutt] n°004 = la carte « 004/T » (Slowpoke e-Card, Flegmon T Promotional cards 004).
 */
const CODES_IMPRIMES_ADMIS = Object.freeze({
    sC: Object.freeze({ slugSet: 'VMAX-Starter-Decks', imprimes: Object.freeze([Object.freeze({ code: 'sC2', numeros: Object.freeze(['17', '18', '19', '20']) })]), preuve: 'cache d\'audit 07/11 : 524115/524120/524125/524130 = n°17-20 de VMAX-Starter-Decks, mêmes noms que les cartes sC2 017-020/021' }),
    'T-P': Object.freeze({ slugSet: 'T-Promos', imprimes: Object.freeze([Object.freeze({ code: 'T', numeros: Object.freeze(['004']) })]), preuve: 'cache d\'audit 07/11 : 571134 Slowpoke [Pound | Lazy Headbutt] n°004 de T-Promos = la carte 004/T' })
});
/** Le code du set lu, confronté au slug Cardmarket (`…-svAL005`, `…-MA5-012`) et à la ligne du produit (`codeSet`, codes_set). @returns {string|null} le motif de refus, null si concordant. */
function motifDeCode(lu, produit, np, drapeaux = []) {
    const code = norm(lu.codeSet);
    if (!code) return 'code-set-non-lu';
    if (demiListe(lu, produit, np)) return null;   // (03/11) demi-liste : le code lu « AC3a » EST le code du produit « a229 » — les trois témoins concordent (table fermée, lettre, slug)
    const ligne = norm(produit?.codeSet);
    const n = String(np).trim().toLowerCase().replace(/^0+(?=\d)/, '');
    const slug = texte(produit?.slug) ? produit.slug.trim().toLowerCase() : null;
    // Alias FERMÉ (2026-11-02) : le code imprimé n'est pas celui de Cardmarket. Passe SEULEMENT si le produit porte exactement le code Cardmarket de la paire (ligne codes_set, ou slug quand la ligne est vide).
    const cm = Object.keys(CODES_IMPRIMES_ALIAS).find(k => norm(CODES_IMPRIMES_ALIAS[k]) === code);
    if (cm) {
        const cmN = norm(cm);
        if (ligne === cmN || (!ligne && slug && new RegExp(`(^|-)${echapper(cmN)}-?0*${echapper(n)}$`).test(slug))) { drapeaux.push(`codeAlias:${cm}→${CODES_IMPRIMES_ALIAS[cm]}`); return null; }
    }
    // Table fermée des codes imprimés admis (07/11) : la ligne codes_set du produit est EXACTEMENT le code Cardmarket de l'entrée, son slugSet celui de l'entrée, et le code lu est l'un des imprimés prouvés.
    // Et le NUMÉRO du produit est l'un de ceux que la preuve couvre (comparé par cleNumero de la jointure : 004 = 4).
    const admis = Object.keys(CODES_IMPRIMES_ADMIS).find(k => ligne === norm(k) && produit?.slugSet === CODES_IMPRIMES_ADMIS[k].slugSet && CODES_IMPRIMES_ADMIS[k].imprimes.some(i => norm(i.code) === code && i.numeros.some(x => J.cleNumero(String(x)) === J.cleNumero(String(np)))));
    if (admis) { drapeaux.push(`code-imprime-admis:${CODES_IMPRIMES_ADMIS[admis].imprimes.find(i => norm(i.code) === code).code}`); return null; }
    if (ligne && ligne !== code) return 'code-set-different';
    if (slug && new RegExp(`(^|-)${echapper(code)}-?0*${echapper(n)}$`).test(slug)) return null;
    if (ligne === code) return null;
    // le slug porte un code collé au numéro, et ce n'est pas celui qui est lu : désaccord ; sinon rien ne permet de vérifier
    if (slug && new RegExp(`(^|-)[a-z][a-z0-9.]*-?0*${echapper(n)}$`).test(slug)) return 'code-set-different';
    return 'code-set-non-verifiable';
}
/**
 * DÉCISION 5 DU TESTEUR (2026-11-02) — « STAFF "SVP 006" : ADMIS quand le code imprimé lu concorde avec le numéro ET le code du set du produit, avec deux sources. Liste fermée. »
 * Une promo Black Star imprime « SVP 006 » : le code du set et le numéro, SANS total. Table FERMÉE slugSet du produit -> code IMPRIMÉ ; aucun autre set n'est tolérant, aucune règle générale.
 *   · SV-Black-Star-Promos -> SVP (scans STAFF de Scarlet-Violet-Promos, tampons-0211 / tampons-0211b ; les slugs Cardmarket finissent par « …-SVP006 »).
 */
const CODES_SANS_TOTAL = Object.freeze({ 'SV-Black-Star-Promos': 'SVP' });
/**
 * L'absence de total est tolérée SEULEMENT si : le slugSet du produit est dans la table, le code imprimé lu est EXACTEMENT le code de ce set (casse comprise), le numéro lu et celui du produit sont purement
 * numériques, et le slug du produit (témoin indépendant, `motifDeCode`) finit par ce code et ce numéro. Le numéro lu doit ENSUITE égaler celui du produit : la comparaison ordinaire s'applique toujours.
 * Elle ne vaut que pour la voie à deux sources (`sansTotalAutorise`) : une source seule ne la reçoit jamais.
 */
function sansTotalAdmis(lu, produit, np) {
    const slugSet = produit?.slugSet;
    if (typeof slugSet !== 'string' || !Object.hasOwn(CODES_SANS_TOTAL, slugSet)) return false;
    if (lu?.codeSet !== CODES_SANS_TOTAL[slugSet]) return false;
    if (!/^\d+$/.test(String(lu.numero ?? '').trim()) || !/^\d+$/.test(String(np ?? '').trim())) return false;
    // le slug du produit est un témoin OBLIGATOIRE, indépendant de la ligne codes_set (relecture) : il finit par ce code et ce numéro, frontière avant le code
    const chiffres = String(np).trim().replace(/^0+(?=\d)/, '');
    const slug = typeof produit.slug === 'string' ? produit.slug.trim() : '';
    if (!new RegExp(`(^|-)${echapper(CODES_SANS_TOTAL[slugSet])}-?0*${echapper(chiffres)}$`, 'i').test(slug)) return false;
    return motifDeCode(lu, produit, np) === null;
}
/** La clé de témoin d'un nom : Pokédex unique + règle. null si le nom n'a pas de Pokédex unique (rien ne permet alors de dire que deux produits se ressemblent). */
function cleDuTemoin(nom) {
    const n = texte(nom) ? J.decomposerNomCardmarket(nom).nom : null;
    const d = n ? TPC.dexDuNom(n) : null;
    return d && d.length === 1 ? `${d[0]}|${TPC.reglesDuNom(n)}` : null;
}
/** Un JUMEAU dans le set : un autre produit du même set (autre idProduct, autre numéro) qui partage Pokédex ET règle avec celui-ci. Le numéro reste la clé, mais le coordinateur le vérifie sur une rognure. */
function aUnJumeauDansLeSet(produit, cleDuProduit, np) {
    if (!cleDuProduit || !Array.isArray(produit?.autresDuSet)) return false;
    return produit.autresDuSet.some(a => a && a.idProduct !== produit.idProduct && a.numero != null && J.cleNumero(String(a.numero)) !== J.cleNumero(String(np)) && cleDuTemoin(a.nomEn) === cleDuProduit);
}
// ── La TABLE CROISÉE des noms japonais (2026-11-03) : nomEn <-> nomJa sur TOUTES les cartes à page, pour prouver un nom japonais lu sur un produit sans nomJa par une AUTRE carte de même nomEn ──
// Égalité (jamais inclusion) : nomEn = TOUTES les clés de `clesNom` de la jointure (nom Cardmarket décomposé, sans accents) triées et jointes, donc « Basic X Energy » ≠ « X Energy » (sens sûr : un refus de plus, jamais une
// confusion) ; nomJa par `nomCompare` de tpc.js (NFKC, ponctuation, « ・ » : la normalisation de production).
// DÉCISION DU COORDINATEUR (03/11) : UNE carte source suffit (la table interne en exigeait deux) — raison : l'unicité nomJa -> nomEn sur TOUTES les cartes à page est la barrière, le numéro, le code et le total restent exigés
// par l'appelant, et la planche du coordinateur reste la barrière humaine. Périmètre : Dresseurs et Énergies (un Pokémon garde Pokédex / PV / règle).
const cleNomEnCroisee = nom => (texte(nom) ? J.clesNom(SANS_ACCENTS(J.decomposerNomCardmarket(nom).nom)).sort().join('|') : '');
/** @param {{_id: number, nomEn: string, nomJa: string}[]} cartes  toutes les cartes à page (_id > 0) qui portent un nomJa. @returns {{parNomEn: Map<string, Map<string, number>>, parNomJa: Map<string, Set<string>>}} */
function construireTableJaCroisee(cartes) {
    const parNomEn = new Map(), parNomJa = new Map();
    for (const c of Array.isArray(cartes) ? cartes : []) {
        if (!(c?._id > 0) || !texte(c.nomEn) || !texte(c.nomJa)) continue;
        const en = cleNomEnCroisee(c.nomEn), ja = TPC.nomCompare(c.nomJa);
        if (!en || !ja) continue;
        if (!parNomEn.has(en)) parNomEn.set(en, new Map());
        if (!parNomEn.get(en).has(ja)) parNomEn.get(en).set(ja, c._id);
        if (!parNomJa.has(ja)) parNomJa.set(ja, new Set());
        parNomJa.get(ja).add(en);
    }
    return { parNomEn, parNomJa };
}
/** Le nom japonais lu est le nomJa d'une autre carte de même nomEn, et ce nomJa ne désigne QUE ce nomEn. @returns {{carteId: number}|null} */
function preuveParTableCroisee(nomLu, nomEn, table, carteIdProduit = null) {
    if (!table?.parNomEn || !table?.parNomJa) return null;
    const en = cleNomEnCroisee(nomEn), ja = TPC.nomCompare(nomLu);
    if (!en || !ja) return null;
    const noms = table.parNomEn.get(en);
    if (!noms || !noms.has(ja)) return null;
    const ens = table.parNomJa.get(ja);
    if (!ens || ens.size !== 1 || !ens.has(en)) return null;
    const carteId = noms.get(ja);
    return carteId === carteIdProduit ? null : { carteId };
}
/**
 * (08/11, décision du testeur) LISTE FERMÉE des règles dont la carte n'imprime pas de n° de Pokédex : valeurs de `TPC.reglesDuNom` (V, VMAX, VSTAR seuls ; « VSTAR+ex », « ex », « GX », « Méga »… n'y sont pas).
 * Le code du set et le numéro sont déjà exigés par `motifDeNomTraduit` (motifDeCode en tête, numéro comparé par l'appelant) avant d'arriver ici.
 */
const REGLES_SANS_POKEDEX = Object.freeze(['V', 'VMAX', 'VSTAR']);
/** Dégâts de la base (`cartes.attaques[].degats`, texte du wikitext : « 220 », « 30× », « 120+ ») -> entier ; null = pas de dégâts ; NaN = illisible. */
const degatsDeBase = d => { if (d == null || String(d).trim() === '') return null; const m = /^(\d+)\s*[×x+\-−]?$/i.exec(String(d).trim()); return m ? Number(m[1]) : NaN; };
/**
 * La variante : en place du Pokédex, PV (égaux, base connue) + attaques lues (noms non vides, dégâts entiers ou null) dont la SUITE des dégâts non nuls, dans l'ordre, égale celle de la base.
 * Écrit : un talent / pouvoir VSTAR (sans dégâts) ne compte ni d'un côté ni de l'autre — la base ne range dans `attaques` que les `Cardtext/Attack` (wikitext.js:365), jamais les talents ; seules les attaques à dégâts
 * témoignent. La base doit porter au moins une attaque à dégâts. Les noms d'attaques lus ne sont comparés à rien (pas de traduction devinée) : ils doivent seulement être PRÉSENTS.
 * @returns {string|null|undefined} undefined = variante non ouverte ; null = acceptée (drapeau posé) ; sinon le motif de refus.
 */
function motifSansPokedex(lu, produit, np, nom, nomCarte, drapeaux) {
    if (lu.dex != null) return undefined;
    const regle = TPC.reglesDuNom(lu.nom);
    if (!REGLES_SANS_POKEDEX.includes(regle) || regle !== TPC.reglesDuNom(nom)) return undefined;
    if (lu.regle != null && TPC.reglesDuNom(lu.regle) !== regle) return 'regle-incoherente';
    if (!entierPositif(lu.pv)) return 'pv-non-lu';
    const pv = Number(produit?.pv);
    if (!(Number.isFinite(pv) && pv > 0)) return 'pv-de-base-inconnu';
    if (lu.pv !== pv) return 'pv-different';
    const lues = lu.attaques;
    if (!Array.isArray(lues) || !lues.length || !lues.every(a => a && typeof a === 'object' && texte(a.nom) && (a.degats === null || entierPositif(a.degats)))) return 'attaques-non-lues';
    if (!nomCarte || !Array.isArray(produit?.attaquesCarte)) return 'attaques-de-base-inconnues';
    const base = produit.attaquesCarte.map(a => degatsDeBase(a?.degats));
    if (base.some(Number.isNaN)) return 'attaques-de-base-inconnues';
    const suiteBase = base.filter(d => d !== null), suiteLue = lues.map(a => a.degats).filter(d => d !== null);
    if (!suiteBase.length) return 'attaques-de-base-inconnues';
    if (suiteBase.length !== suiteLue.length || suiteBase.some((d, i) => d !== suiteLue[i])) return 'attaques-differentes';
    drapeaux.push(`temoin-regle-sans-pokedex:${regle}`);
    if (aUnJumeauDansLeSet(produit, cleDuTemoin(nom), np)) drapeaux.push('jumeau-dans-le-set');
    return null;
}
function motifDeNomTraduit(lu, produit, np, drapeaux = []) {
    if (!texte(lu.nom)) return 'nom-different';
    if (np == null) return 'nom-traduit-numero-absent';
    const mc = motifDeCode(lu, produit, np, drapeaux); if (mc) return mc;
    const net = x => (texte(x) ? J.decomposerNomCardmarket(x).nom : null);
    const nomProduit = net(produit?.nomEn), nomCarte = net(produit?.nomEnCarte);
    const nom = nomCarte ?? nomProduit;
    // le nom du PRODUIT et celui de la CARTE disent la même chose (forme régionale, règle) ; sinon la fiche est douteuse
    if (nomProduit && nomCarte && (REGIONAL_PRODUIT.test(nomProduit) !== REGIONAL_PRODUIT.test(nomCarte) || TPC.reglesDuNom(nomProduit) !== TPC.reglesDuNom(nomCarte))) return 'nom-produit-carte-divergent';
    if (REGIONAL_LU.test(String(lu.nom).normalize('NFKC')) || (nomProduit && REGIONAL_PRODUIT.test(nomProduit)) || (nomCarte && REGIONAL_PRODUIT.test(nomCarte))) return 'forme-regionale-non-distinguee';
    // une TABLE de traduction INTERNE (pas une source officielle) : le `nomJa` que portent NOS autres cartes (vraies pages) de même nomEn (tpc.construireTemoinNomJa) — au moins DEUX cartes distinctes qui s'accordent, pour le japonais seul
    const t = produit?.tableJaInterne;
    const tableUtilisable = lu.langue === 'ja' && t && !t.divergent && Array.isArray(t.noms) && t.noms.length === 1;
    if (tableUtilisable && t.cartes >= 2) {
        const lue = TPC.nomCompare(lu.nom);
        if (!(lue !== '' && lue === TPC.nomCompare(t.noms[0]))) return 'nom-different';
        drapeaux.push('table-ja-interne');
        return null;
    }
    // ➕ 2026-11-03 : une table d'UNE seule carte ne suffit pas seule ; elle suffit si le nom lu est le nomJa d'une AUTRE carte de même nomEn ET qu'aucune carte d'un autre nomEn ne le porte (table croisée, construite une fois)
    // Périmètre : Dresseurs et Énergies seulement (catégorie connue non-pokemon, ou catégorie inconnue ET nom sans Pokédex) ; un Pokémon garde ses témoins Pokédex / PV / règle (revue 03/11).
    const horsPokemon = produit?.categorie != null ? produit.categorie !== 'pokemon' : !(nom && TPC.dexDuNom(nom));
    if (tableUtilisable && horsPokemon) {
        const p = preuveParTableCroisee(lu.nom, nom, produit?.tableJaCroisee, produit?.carteId);
        if (p) { drapeaux.push(`nom-ja-par-table-d-un-autre-set:${p.carteId}`); return null; }
    }
    const sansTemoin = tableUtilisable ? 'table-ja-insuffisante' : 'nom-traduit-sans-temoin';
    // sinon seul un Pokémon a de quoi témoigner : un Dresseur ou une Énergie au nom traduit n'a ni Pokédex ni PV
    if (!nom || (produit?.categorie != null && produit.categorie !== 'pokemon')) return sansTemoin;
    const dexNom = TPC.dexDuNom(nom);
    // le ndex de la carte doit être CONFIRMÉ par la table du dépôt (pokedex-dexids.json) : contredit, illisible ou nom absent de la table = refus
    let ndex = null;
    if (produit?.ndex != null && produit.ndex !== '') {
        ndex = Number(produit.ndex);
        if (!entierPositif(ndex) || !dexNom || !dexNom.includes(ndex)) return 'ndex-non-confirme';
    }
    let dex;
    if (ndex != null) dex = ndex;
    else if (!dexNom) return !nomCarte && TPC.nomQualifie(nomProduit) ? 'fiche-simple-nom-qualifie' : sansTemoin;
    else if (dexNom.length !== 1) return 'pokedex-ambigu';
    else dex = dexNom[0];
    // sans carte, la fiche simple n'a que le nom de son produit : il ne porte que l'espèce et sa règle
    if (!nomCarte && !TPC.nomEstEspeceEtRegle(nomProduit)) return 'fiche-simple-nom-qualifie';
    // (08/11) variante V / VMAX / VSTAR : ces cartes n'impriment pas de n° de Pokédex. Ouverte SEULEMENT si lu.dex est absent, que la règle lue (lettres latines) est EXACTEMENT l'une de la liste fermée
    // et qu'elle égale celle du nom du produit ; `undefined` = variante non ouverte, la règle ci-dessous s'applique, inchangée.
    const v = motifSansPokedex(lu, produit, np, nom, nomCarte, drapeaux); if (v !== undefined) return v;
    if (!entierPositif(lu.dex)) return 'pokedex-non-lu';
    if (lu.dex !== dex) return 'pokedex-different';
    if (!entierPositif(lu.pv)) return 'pv-non-lu';
    const pv = Number(produit?.pv);
    const pvCompare = Number.isFinite(pv) && pv > 0;
    if (pvCompare && lu.pv !== pv) return 'pv-different';
    const lue = TPC.reglesDuNom(lu.nom);
    if (lu.regle != null && TPC.reglesDuNom(lu.regle) !== lue) return 'regle-incoherente';
    if (lue !== TPC.reglesDuNom(nom)) return 'regle-differente';
    // acceptée : les marques que la preuve porte (sans carte, le PV lu n'est comparé à rien ; un jumeau dans le set se vérifie au numéro, à l'œil)
    if (!pvCompare) drapeaux.push('pv-non-verifie');
    if (aUnJumeauDansLeSet(produit, cleDuTemoin(nom), np)) drapeaux.push('jumeau-dans-le-set');
    return null;
}
/**
 * Tour 4 (2) — l'ANNÉE d'un set Battle Academy (et la moitié d'un Trainer Kit) ne se lit pas sur l'image : DEUX conditions cumulées. (a) le couple (position, nom normalisé) désigne UN SEUL produit parmi tous les
 * produits des slugSet `Battle-Academy*` / `*Trainer-Kit*` connus de la base — et c'est le produit jugé ; (b) le numéro imprimé lu (et son total, s'il est lu) est une impression de la carte du produit.
 * @returns {string[]} les motifs de refus (vide = conforme)
 */
function motifsDePosition(lu, produit) {
    const m = [], pos = J.cleNumero(String(lu.position).trim());
    const memes = Array.isArray(produit?.candidatsPosition) ? produit.candidatsPosition.filter(c => J.cleNumero(c.numero) === pos && memeNomQueLeProduit(lu.nom, c.nomEn)) : [];
    if (!(memes.length === 1 && memes[0].idProduct === produit.idProduct)) m.push('position-ambigue');
    const n = lu.numero == null ? '' : String(lu.numero).trim(), t = lu.total == null ? '' : String(lu.total).trim();
    const imprimee = n !== '' && Array.isArray(produit?.impressions) && produit.impressions.some(i => i?.numero != null && J.cleNumero(i.numero) === J.cleNumero(n) && (t === '' || Number(i.total) === Number(t)));
    if (!imprimee) m.push('numero-imprime-hors-carte');
    return m;
}
// Un nom de source ne s'écrit jamais en base, pas même dans une marque lue : comparé sans accents ni casse (« Poképédia » = « pokepedia »).
const SANS_ACCENTS = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NOMS_DE_SOURCES = Object.freeze([...NOMS_INTERDITS, 'pokepedia', 'blazingtail', 'breakerz', 'tcgplayer', 'cardmarket']);
const nommeUneSource = m => NOMS_DE_SOURCES.some(n => SANS_ACCENTS(m).includes(n));

// ── 3. Le manifeste et les validations (P1) ──────────────────────────────────────────────────────────────────────────────────
const nombre = v => typeof v === 'number' && Number.isFinite(v);
/** Les champs de la preuve de MÊME DESSIN qui manquent ou sont mal formés (vide = complète) : la clé R2 de l'entrée comparée, le score, le seuil (0 < seuil ≤ 1) et le vide (> 0) calibrés du set. */
function memeDessinManquants(m) {
    if (!objet(m)) return ['memeDessin'];
    const manque = [];
    if (!texte(m.cleR2)) manque.push('cleR2');
    if (!HEX64.test(m.sha256 ?? '')) manque.push('sha256');
    if (!nombre(m.score)) manque.push('score');
    if (!(nombre(m.seuil) && m.seuil > 0 && m.seuil <= 1)) manque.push('seuil');
    if (!(nombre(m.vide) && m.vide > 0)) manque.push('vide');
    return manque;
}
/** -> null si l'entrée a la forme du manifeste, sinon la phrase du refus. Rien n'est corrigé. */
function formeEntree(e) {
    if (!objet(e)) return 'entrée : objet attendu';
    if (!Number.isInteger(e.idProduct) || e.idProduct <= 0) return 'idProduct : entier > 0 attendu';
    if (!REGLES.includes(e.regle)) return `regle « ${e.regle} » hors de ${REGLES.join(' | ')}`;
    if (!urlHttps(e.url)) return 'url : adresse https attendue';
    if (!texte(e.hote)) return 'hote : texte attendu';
    if (!texte(e.fichier)) return 'fichier : chemin attendu';
    if (!HEX64.test(e.sha256 ?? '')) return 'sha256 : 64 caractères hexadécimaux minuscules attendus';
    if (!objet(e.lu)) return 'lu : objet attendu (ce que le scan porte)';
    if (!objet(e.attendu)) return 'attendu : objet attendu (ce que dit le produit)';
    if (!Array.isArray(e.contradictions)) return 'contradictions : tableau attendu (vide si aucune source ne contredit)';
    if (!dateDe(e.luLe)) return 'luLe : date attendue';
    if (e.regle === REGLE_MEME_DESSIN) {
        const manque = memeDessinManquants(e.memeDessin);
        if (manque.length) return `memeDessin : ${manque.join(', ')} exigé(s) pour ${REGLE_MEME_DESSIN} (cleR2 de l'entrée comparée, score, seuil, vide)`;
    }
    if (e.regle === 'deux-sources') {
        const s = e.seconde;
        if (!objet(s) || !urlHttps(s.url) || !texte(s.hote) || !texte(s.fichier) || !HEX64.test(s.sha256 ?? '')) return 'seconde : { url https, hote, fichier, sha256 } exigée pour deux-sources';
    }
    return null;
}
/**
 * Le manifeste d'une famille. LÈVE sur ce qui n'a pas sa forme : un fichier faux n'est jamais « lu au mieux ». `famille` : le nom du DOSSIER, qui fait foi (tour 1, point 6) : une famille que le manifeste
 * déclare autre (ou ne déclare pas) ne fait pas lever — l'écart est rendu (`ecartDeFamille`, `familleDeclaree`) pour être imprimé. Sans nom de dossier, le manifeste doit se nommer.
 */
function lireManifeste(obj, famille = null) {
    if (!objet(obj)) throw new Error(`manifeste${famille ? ` ${famille}` : ''} : objet attendu`);
    const nom = famille ?? obj.famille;
    if (!texte(nom)) throw new Error('manifeste : famille absente (ni nom de dossier, ni champ « famille »)');
    if (!Array.isArray(obj.entrees)) throw new Error(`manifeste ${nom} : « entrees » (tableau) attendu`);
    if (obj.trous !== undefined && !Array.isArray(obj.trous)) throw new Error(`manifeste ${nom} : « trous » (tableau) attendu`);
    return { famille: nom, familleDeclaree: obj.famille ?? null, ecartDeFamille: obj.famille !== nom, le: obj.le ?? null, entrees: obj.entrees, trous: obj.trous ?? [] };
}
/** Les validations du coordinateur. LÈVE sur la moindre entrée mal formée (un fichier de validations est écrit à la main : on ne devine pas ce qu'il voulait dire). */
function lireValidations(arr) {
    if (!Array.isArray(arr)) throw new Error('validations : tableau attendu');
    return arr.map((v, i) => {
        const ou = `validations[${i}]`;
        if (!objet(v)) throw new Error(`${ou} : objet attendu`);
        if (!Number.isInteger(v.idProduct) || v.idProduct <= 0) throw new Error(`${ou} : idProduct entier > 0 attendu`);
        if (!HEX64.test(v.sha256 ?? '')) throw new Error(`${ou} (produit ${v.idProduct}) : sha256 de 64 caractères hexadécimaux minuscules attendu`);
        if (!REGLES.includes(v.regle)) throw new Error(`${ou} (produit ${v.idProduct}) : regle « ${v.regle} » hors de ${REGLES.join(' | ')}`);
        const le = dateDe(v.valideLe);
        if (!le) throw new Error(`${ou} (produit ${v.idProduct}) : valideLe (date) attendue`);
        if (v.par !== 'coordinateur') throw new Error(`${ou} (produit ${v.idProduct}) : « par » doit valoir « coordinateur » (reçu ${JSON.stringify(v.par)}) — seule sa validation autorise une écriture`);
        if (!texte(v.planche)) throw new Error(`${ou} (produit ${v.idProduct}) : planche (le fichier regardé) attendue`);
        return { ...v, valideLe: le };
    });
}
/**
 * P1 — RIEN N'EST ÉCRIT SANS VALIDATION. Une entrée du manifeste n'est appariée que si le coordinateur a validé le MÊME produit, la MÊME règle et le MÊME sha256 (le fichier qu'il a regardé).
 * Tout le reste est refusé avec son motif ; une validation sans entrée est refusée aussi (on ne valide pas un fantôme).
 * @returns {{appariees: {entree: object, validation: object}[], refus: {idProduct: number, motif: string, detail?: string}[]}}
 */
function rapprocher({ entrees, validations }) {
    const refus = [], appariees = [];
    const parId = new Map();
    for (const e of entrees) if (Number.isInteger(e?.idProduct)) (parId.get(e.idProduct) || parId.set(e.idProduct, []).get(e.idProduct)).push(e);
    const vParId = new Map();
    for (const v of validations) (vParId.get(v.idProduct) || vParId.set(v.idProduct, []).get(v.idProduct)).push(v);
    for (const e of entrees) {
        const id = e?.idProduct;
        if (Number.isInteger(id) && parId.get(id).length > 1) { refus.push({ idProduct: id, motif: 'doublon-manifeste' }); continue; }
        const forme = formeEntree(e);
        if (forme) { refus.push({ idProduct: id ?? null, motif: `entree-mal-formee:${forme}` }); continue; }
        const vs = vParId.get(id);
        if (!vs) { refus.push({ idProduct: id, motif: 'sans-validation' }); continue; }
        if (new Set(vs.map(v => `${v.sha256}|${v.regle}`)).size > 1) { refus.push({ idProduct: id, motif: 'validations-contradictoires' }); continue; }
        const v = vs[0];
        if (v.sha256 !== e.sha256) { refus.push({ idProduct: id, motif: 'validation-sha256-different', detail: `manifeste ${e.sha256.slice(0, 12)}…, validé ${v.sha256.slice(0, 12)}…` }); continue; }
        if (v.regle !== e.regle) { refus.push({ idProduct: id, motif: 'validation-regle-differente', detail: `manifeste ${e.regle}, validé ${v.regle}` }); continue; }
        appariees.push({ entree: e, validation: v });
    }
    for (const id of vParId.keys()) if (!parId.has(id)) refus.push({ idProduct: id, motif: 'validation-sans-entree' });
    return { appariees, refus };
}

// ── 4. P2 : la règle « preuve-lue » (source unique) ──────────────────────────────────────────────────────────────────────────
/**
 * L'IMAGE ELLE-MÊME prouve le tirage : numéro ET total lus, langue du texte = langue du tirage du produit, numéro lu = numéro du produit (clé de la jointure), tampon lu = tampon du produit
 * (null ≠ un tampon, dans les deux sens), aucune contradiction, des marques lues. Produit sans numéro : des marques et `attendu.numero` null. TOUTE discordance refuse.
 * @returns {{ok: boolean, motifs: string[]}}
 */
function evaluerPreuveLue({ entree, produit, langueProduit, sansTotalAutorise = false }) {
    const motifs = [], drapeaux = [], lu = entree.lu ?? {};
    const marques = Array.isArray(lu.marques) && lu.marques.length > 0 && lu.marques.every(texte);
    if (!marques) motifs.push('marques-vides');
    else if (lu.marques.some(nommeUneSource)) motifs.push('marque-nomme-une-source');
    if (langueProduit == null) motifs.push('langue-du-tirage-inconnue');
    else if (lu.langue !== langueProduit) motifs.push('langue-differente');
    const np = numeroDuProduit(produit);
    if (lu.position != null) {
        // tour 2 (2) : la POSITION lue sur un symbole (deck, rond Battle Academy, moitié de kit) désigne le produit quand son numéro est une position ; elle remplace le numéro imprimé (qui reste écrit tel quel),
        // le total n'est pas exigé. Liste FERMÉE de sets : ailleurs une position n'a aucune valeur de preuve.
        if (positionRonde(produit?.slugSet)) motifs.push(...motifsDePositionRonde(lu, produit, np, sansTotalAutorise));   // (07/11) numéro dans un rond : liste fermée POSITIONS_RONDES
        else if (!setAdmisPourPosition(produit?.slugSet)) motifs.push('position-hors-liste');
        else if (!texte(lu.position)) motifs.push('position-vide');
        else if (np == null) motifs.push('position-sans-numero-produit');
        else if (J.cleNumero(String(lu.position).trim()) !== J.cleNumero(np)) motifs.push('numero-different');
        else motifs.push(...motifsDePosition(lu, produit));
        const mn = motifDeNom(lu, produit, langueProduit, drapeaux); if (mn) motifs.push(mn);       // tour 4 (1) : le nom, branche position
    } else if (np != null) {
        const n = lu.numero == null ? '' : String(lu.numero).trim(), t = lu.total == null ? '' : String(lu.total).trim();
        // tour 2 (1) : une promo (« XY150a », « SM30a ») n'imprime aucun total — il n'est exigé que pour un numéro purement numérique (+ suffixe) ; un préfixe alphabétique se juge sans total
        const sansTotalTolere = sansTotalAutorise === true && t === '' && sansTotalAdmis(lu, produit, np);   // décision 5 : deux sources + liste fermée
        if (n === '' || (t === '' && !PREFIXE_ALPHABETIQUE.test(n) && !sansTotalTolere)) motifs.push('numero-ou-total-absent');
        else if (J.cleNumero(n) !== J.cleNumero(np) && !numeroSansPrefixeAdmis(n, np, produit?.slug) && !demiListe(lu, produit, np)) motifs.push('numero-different');
        else if (J.cleNumero(n) !== J.cleNumero(np) && demiListe(lu, produit, np)) drapeaux.push(`demi-liste:${demiListe(lu, produit, np).lettre}`);   // (03/11) les trois témoins concordent : dit au coordinateur
        const mn = motifDeNom(lu, produit, langueProduit, drapeaux); if (mn) motifs.push(mn);       // tour 4 (1) : le nom aussi, avec numéro
    } else {
        if (entree.attendu?.numero != null && String(entree.attendu.numero).trim() !== '') motifs.push('numero-attendu-non-null');
        // tour 1 (1) : sans numéro, RIEN d'autre ne relie l'image au produit que son NOM — le nom lu doit être celui du produit (Cardmarket, avant « [ »), par la normalisation de la jointure
        const mn = motifDeNom(lu, produit, langueProduit, drapeaux); if (mn) motifs.push(mn);       // tour 4 (1) : le nom, branche sans numéro
        // tour 4 (3) : et quand le slug du produit porte un numéro en fin (« …-PPS8MEG-114 »), le numéro lu doit être celui-là
        const sn = numeroFinDeSlug(produit?.slug);
        if (sn != null && (lu.numero == null || String(lu.numero).trim() === '' || J.cleNumero(String(lu.numero).trim()) !== J.cleNumero(sn))) motifs.push('numero-different');
    }
    // tour 4 (5) : variante nommée (Blue Border / standard) <-> finition lue
    const vk = typeof entree.attendu?.variante === 'string' ? entree.attendu.variante.trim().toLowerCase() : null;
    if (vk && Object.hasOwn(FINITIONS_ATTENDUES, vk)) {
        if (!texte(lu.finition)) motifs.push('finition-absente');
        else if (norm(lu.finition) !== FINITIONS_ATTENDUES[vk]) motifs.push('finition-different');
    }
    const ta = tamponAttendu(produit?.tamponnee);
    if (!ta.ok) motifs.push('tampon-inconnu');
    else if (norm(lu.tampon) !== norm(ta.valeur)) motifs.push('tampon-different');
    if (!Array.isArray(entree.contradictions) || entree.contradictions.length > 0) motifs.push('contradictions');
    // (les drapeaux — marques de la preuve — ne sortent que d'une preuve ACCEPTÉE et seulement s'il y en a : la forme des résultats d'avant ne bouge pas)
    return { ok: motifs.length === 0, motifs, ...(motifs.length === 0 && drapeaux.length ? { drapeaux } : {}) };
}

// ── 5. P3 : la règle « deux-sources » ────────────────────────────────────────────────────────────────────────────────────────
const tirageDeLecture = lu => ({ langue: lu?.langue ?? null, numero: CO.reduireNumero(lu?.numero), codeSet: null, tampon: lu?.tampon ?? null });
/**
 * Deux sources INDÉPENDANTES : hôte et site différents, sha256 et octets différents, et la règle d'image de production (`deciderVisuel`) rend `ecrire` sur les deux fichiers du cache. Les tirages des
 * candidats sont ceux que dit le MANIFESTE (la lecture de chaque source ; à défaut de lecture propre à la seconde, celle de la première) ; le produit fait foi. Aucune contradiction admise.
 * @param {{a: Buffer, b: Buffer}} octets
 */
async function evaluerDeuxSources({ entree, produit, langueProduit, octets, decider = CI.deciderVisuel }) {
    const non = detail => ({ ok: false, motif: `deux-sources:${detail}` });
    const s = entree.seconde;
    if (!objet(s)) return non('seconde-absente');
    if (norm(s.hote) === norm(entree.hote)) return non('meme-hote');
    if (racineDe(s.hote) === racineDe(entree.hote)) return non('meme-site');
    if (s.sha256 === entree.sha256) return non('meme-sha256');
    if (!Array.isArray(entree.contradictions) || entree.contradictions.length > 0) return non('contradictions');
    if (!Buffer.isBuffer(octets?.a)) return non('premiere-illisible');
    if (!Buffer.isBuffer(octets?.b)) return non('seconde-illisible');
    if (octets.a.equals(octets.b)) return non('memes-octets');
    if (langueProduit == null) return non('langue-du-tirage-inconnue');
    const ta = tamponAttendu(produit?.tamponnee);
    if (!ta.ok) return non('tampon-inconnu');
    // tour 1 (3) : la SECONDE image porte sa propre lecture, jugée comme la première (P2) — la concordance d'image ne prouve que le dessin, jamais le tirage
    if (!objet(s.lu)) return non('seconde-sans-lecture');
    // décision 5 : pour un set de la liste fermée CODES_SANS_TOTAL, la PREMIÈRE lecture (jusqu'ici non jugée par cette voie) est jugée aussi quand elle n'a pas de total — les deux lectures portent code et numéro
    const sansTotal = lu => lu?.total == null || String(lu.total).trim() === '';
    // (07/11) idem pour un rond seul (POSITIONS_RONDES) : la première lecture porte aussi un rond, jugé avec ses conditions (nom unique dans le set, rond = numéro)
    if ((Object.hasOwn(CODES_SANS_TOTAL, produit?.slugSet) && sansTotal(entree.lu)) || (positionRonde(produit?.slugSet) && entree.lu?.position != null)) {
        const l1 = evaluerPreuveLue({ entree: { lu: entree.lu, attendu: entree.attendu, contradictions: entree.contradictions }, produit, langueProduit, sansTotalAutorise: true });
        if (!l1.ok) return non(`premiere-lecture:${l1.motifs[0]}`);
    }
    const l2 = evaluerPreuveLue({ entree: { lu: s.lu, attendu: entree.attendu, contradictions: entree.contradictions }, produit, langueProduit, sansTotalAutorise: true });
    if (!l2.ok) return non(`seconde-lecture:${l2.motifs[0]}`);
    const r = await decider({
        produit: { langue: langueProduit, codeSet: null, numero: CO.reduireNumero(produit?.numero), tampon: ta.valeur },
        candidats: [{ source: entree.hote, buf: octets.a, tirage: tirageDeLecture(entree.lu) }, { source: s.hote, buf: octets.b, tirage: tirageDeLecture(s.lu) }],
        scansConformes: []
    });
    if (r?.decision !== 'ecrire') return non(r?.motif ?? r?.decision ?? 'indecidable');
    return { ok: true, regle: 'deux-sources', preuve: r.preuve };
}

// ── 5 bis. La règle « remplacement-meme-dessin » (HD-ZH, 2026-11-01) ───────────────────────────────────────────────────────────
const LARGEUR_HYPOTHETIQUE = 1e6;
const HEX40 = /^[0-9a-f]{40}$/;
/**
 * I2 — la preuve de même dessin est reliée à l'entrée SERVIE (celle que la base porte), jamais à une déclaration seule. Trois liens, du plus fort au plus faible, le premier qui tient est NOMMÉ :
 *   · `sha256` : les octets comparés ont le sha256 de l'entrée servie ou de son document `images` ;
 *   · `sha1Original` : leur sha1 est celui de l'ORIGINAL que le document a gardé (l'entrée servie est ré-encodée : son sha256 n'est jamais celui de la source) ;
 *   · `urlOriginal` : l'adresse d'origine de l'entrée servie (ou de son document) est celle d'où viennent les octets comparés — le plus faible, écrit tel quel dans la preuve.
 * @returns {'sha256'|'sha1Original'|'urlOriginal'|null}
 */
function lienAvecLEntree(m, entree, doc) {
    if (HEX64.test(m?.sha256 ?? '') && [entree?.sha256, doc?.sha256].includes(m.sha256)) return 'sha256';
    if (HEX40.test(m?.sha1 ?? '') && doc?.sha1Original === m.sha1) return 'sha1Original';
    if (texte(m?.urlOriginal) && [entree?.urlOriginal, doc?.urlOriginal].includes(m.urlOriginal)) return 'urlOriginal';
    return null;
}
/**
 * Un REMPLACEMENT d'une entrée déjà servie, SANS NOM, pour un tirage à écriture non latine. Admise SEULEMENT si TOUT tient :
 *   (a) la langue du tirage du produit est dans LANGUES_NON_LATINES (liste fermée) ;
 *   (b) la carte a, pour ce set et ce numéro, une entrée servie de la MÊME langue connue (`produit.imagesServies`, lue en base par le plan) — celle que la preuve nomme (`memeDessin.cleR2`) —,
 *       ET la décision de remplacement est celle de basse-definition.js (`entreesARemplacer`, appelée telle quelle) : elle doit désigner exactement cette entrée ;
 *   (c) le manifeste porte la preuve de MÊME DESSIN contre cette entrée : sa clé R2, le score, le seuil et le vide calibrés du set ; score ≥ seuil ;
 *   (d) le numéro IMPRIMÉ lu sur la candidate (`lu.numero`, moyen écrit dans `lu.moyen` : ocr | oeil) = le numéro du produit (clé de la jointure) ;
 *   (e) la langue lue = la langue du tirage ;
 *   (f) la largeur RÉELLE de la candidate (mesurée sur ses octets) est réellement supérieure — c'est la décision de (b) : toute largeur au-dessus du seuil face à une basseDefinition, ×1,5 sinon.
 * Le nom n'est jamais lu. Le tampon, les contradictions et les marques gardent leur garde.
 * @param {{entree: object, produit: object, langueProduit: string|null, largeur: number|null}} o
 * @returns {{ok: boolean, motifs: string[]}}
 */
function evaluerRemplacementMemeDessin({ entree, produit, langueProduit, largeur }) {
    const motifs = [], lu = entree.lu ?? {}, m = entree.memeDessin;
    // (a)
    if (langueProduit == null) motifs.push('langue-du-tirage-inconnue');   // (a) tirage
    else if (!LANGUES_NON_LATINES.includes(langueProduit)) motifs.push('langue-hors-liste');
    // (c) la preuve, ses planchers (B1), puis score ≥ seuil
    if (memeDessinManquants(m).length) motifs.push('preuve-absente');
    else {
        if (m.seuil < SEUIL_PLANCHER) motifs.push('seuil-sous-le-plancher');   // (c1)
        if (m.score < SCORE_PLANCHER) motifs.push('score-sous-le-plancher');   // (c2)
        if (m.vide < VIDE_PLANCHER) motifs.push('vide-sous-le-plancher');   // (c3)
        if (!(m.score >= m.seuil)) motifs.push('score-sous-le-seuil');
    }
    // (e) la langue lue = celle du tirage, ET son moyen est dit : la langue n'est pas lue sur l'image, elle vient d'une liste source de ce tirage + la planche
    if (langueProduit != null && lu.langue !== langueProduit) motifs.push('langue-differente');
    else if (langueProduit != null) {
        if (!(typeof lu.langueMoyen === 'string' && Object.hasOwn(MOYENS_DE_LANGUE, lu.langueMoyen) && MOYENS_DE_LANGUE[lu.langueMoyen] === langueProduit)) motifs.push('moyen-de-langue-hors-tirage');   // (e1)
        else if (!(typeof lu.pageListe === 'string' && urlHttps(lu.pageListe))) motifs.push('page-liste-absente');   // (e2)
    }
    // (d)
    const np = numeroDuProduit(produit), n = lu.numero == null ? '' : String(lu.numero).trim();
    if (n === '') motifs.push('numero-lu-absent');
    else if (np == null || J.cleNumero(n) !== J.cleNumero(np)) motifs.push('numero-different');
    if (!MOYENS_DE_LECTURE.includes(lu.moyen)) motifs.push('moyen-de-lecture-absent');
    // (b) et (f)
    const images = Array.isArray(produit?.imagesServies) ? produit.imagesServies.filter(Boolean) : [];
    const nommees = texte(m?.cleR2) && langueProduit != null && np != null
        ? images.filter(i => i.cleR2 === m.cleR2 && i.set === produit.slugSet && J.cleNumero(i.numero) === J.cleNumero(np) && i.langue === langueProduit) : [];
    let lien = null;
    if (nommees.length !== 1) motifs.push('aucune-entree-servie');
    else {
        const documents = produit.documentsServis instanceof Map ? produit.documentsServis : new Map();
        // I2 : la preuve est reliée à l'entrée servie en base
        lien = lienAvecLEntree(m, nommees[0], documents.get(`${nommees[0].source}|${nommees[0].set}|${nommees[0].cleR2}`));
        if (!lien) motifs.push('preuve-non-reliee');   // (i2)
        if (!nombre(largeur) || largeur <= 0) motifs.push('largeur-illisible');
        else {
        const candidate = w => RC.candidatDe(SRC, { slugSet: produit.slugSet, numero: np, langue: langueProduit, tampon: tamponAttendu(produit.tamponnee).valeur ?? undefined },
            { cleR2: SRC.cleR2(produit.slugSet, np, produit.carteId, langueProduit), wOriginal: w, ...BD.marqueDe({ wOriginal: w }) });
        const designees = BD.entreesARemplacer(images, candidate(largeur), { documents });
        if (!designees.includes(nommees[0])) {
            // la largeur est-elle la seule cause ? Rejouée avec une largeur hypothétique immense, la MÊME décision désigne-t-elle l'entrée ?
            motifs.push(BD.entreesARemplacer(images, candidate(LARGEUR_HYPOTHETIQUE), { documents }).includes(nommees[0]) ? 'resolution-insuffisante' : 'remplacement-non-autorise');
        } else if (designees.length !== 1) motifs.push('remplacement-ambigu');
        }
    }
    // les gardes communes à toute preuve lue : marques, tampon, contradictions
    const marques = Array.isArray(lu.marques) && lu.marques.length > 0 && lu.marques.every(texte);
    if (!marques) motifs.push('marques-vides');
    else if (lu.marques.some(nommeUneSource)) motifs.push('marque-nomme-une-source');
    const ta = tamponAttendu(produit?.tamponnee);
    if (!ta.ok) motifs.push('tampon-inconnu');
    else if (norm(lu.tampon) !== norm(ta.valeur)) motifs.push('tampon-different');   // (g) tampon
    if (!Array.isArray(entree.contradictions) || entree.contradictions.length > 0) motifs.push('contradictions');   // (h) contradictions
    return { ok: motifs.length === 0, motifs, lien };
}
/** La largeur RÉELLE de l'original (octets du cache), par le même jugement que la récolte. null si illisible. */
async function largeurDesOctets(buf) {
    if (!Buffer.isBuffer(buf)) return null;
    const j = await RC.juger(SRC, buf);
    return nombre(j?.w) ? j.w : null;
}

/** La décision d'une entrée appariée, par sa règle. @returns {Promise<{ok: boolean, regle?: string, motif?: string, motifs?: string[]}>} */
async function evaluerEntree({ entree, produit, octets, decider }) {
    const langueProduit = langueDuProduit({ ...produit, langueLue: entree.lu?.langue });   // (03/11) la langue lue n'entre en jeu que pour un tirage à deux langues (idth)
    if (entree.regle === REGLE_MEME_DESSIN) {
        const r = evaluerRemplacementMemeDessin({ entree, produit, langueProduit, largeur: await largeurDesOctets(octets?.a) });
        return r.ok ? { ok: true, regle: REGLE_MEME_DESSIN, lien: r.lien } : { ok: false, motif: `${REGLE_MEME_DESSIN}:${r.motifs[0]}`, motifs: r.motifs };
    }
    if (entree.regle === 'preuve-lue') {
        const r = evaluerPreuveLue({ entree, produit, langueProduit });
        return r.ok ? { ok: true, regle: 'preuve-lue', ...(r.drapeaux ? { drapeaux: r.drapeaux } : {}) } : { ok: false, motif: `preuve-lue:${r.motifs[0]}`, motifs: r.motifs };
    }
    if (entree.regle === 'deux-sources') return evaluerDeuxSources({ entree, produit, langueProduit, octets, decider });
    return { ok: false, motif: 'regle-inconnue' };
}

// ── 6. P8 : le cache est RELU, jamais cru ────────────────────────────────────────────────────────────────────────────────────
/**
 * Les octets du cache partagé pour cette adresse, confrontés trois fois : au sha256 du manifeste, à celui que la fiche du cache a écrit au téléchargement, au fichier que l'agent cite. Puis la
 * même chaîne que la récolte (`RC.juger` : image décodable, forme de carte, largeur) : au seuil -> ok ; de 200 px au seuil -> basse définition marquée ; sous 200 -> refus.
 * `sansLargeur` : la seconde image d'une paire n'a pas à tenir la largeur (elle ne s'écrit pas), seulement à être une image.
 */
async function verifierCache({ entree, dossierCache, sansLargeur = false, lireFichier = f => fs.readFileSync(f) }) {
    const non = (motif, detail) => ({ ok: false, motif, ...(detail ? { detail } : {}) });
    const c = HOTE.lireDuCache(dossierCache, entree.url);
    if (!c) return non('cache-absent', entree.url);
    const s = sha256De(c.octets);
    if (s !== entree.sha256) return non('cache-sha256-different', `cache ${s.slice(0, 12)}…, manifeste ${entree.sha256.slice(0, 12)}…`);
    if (c.meta?.sha256 && c.meta.sha256 !== s) return non('cache-altere', 'les octets du cache ne sont plus ceux que la fiche du cache a écrits');
    let f;
    try { f = lireFichier(entree.fichier); } catch (e) { return non('fichier-illisible', `${entree.fichier} : ${e.message}`); }
    if (sha256De(f) !== entree.sha256) return non('fichier-different', 'le fichier cité n\'a pas le sha256 du manifeste');
    const j = await RC.juger(SRC, c.octets);
    if (j.statut === 'illisible') return non('illisible');
    if (!sansLargeur) {
        if (j.statut === 'forme-inattendue') return non('forme-inattendue', `${j.w}x${j.h}`);
        const l = RC.controleLargeur(SRC, j.w);
        if (l.statut === 'trop-petit') return non('trop-petit', `${j.w} px`);
        return { ok: true, octets: c.octets, jugement: { ...j, octets: c.octets.length, sha256: s }, collecteLe: c.meta?.le ?? null, basseDefinition: l.statut === 'basse-definition' };
    }
    return { ok: true, octets: c.octets, jugement: { ...j, octets: c.octets.length, sha256: s }, collecteLe: c.meta?.le ?? null, basseDefinition: false };
}

// ── 7. P5 : les unités ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Un visuel vit sur la FICHE (carte, set, numéro de fiche), pas sur le produit. */
const cleFiche = p => `${p.carteId}|${p.slugSet}|${J.cleNumero(p.numero)}`;
/**
 * Tour 1 (4) — la forme STRUCTURÉE : `{ source, paire: { normale: <idProduct>, holo: <idProduct> } }` (le texte libre `dit` n'est plus lu). La paire doit désigner EXACTEMENT les produits de la fiche, deux
 * entiers distincts : c'est la source qui dit quel produit est holo, jamais l'ordre ni le prix. @returns {{normale: number, holo: number}|null}
 */
function paireNommee(v, tous) {
    if (!objet(v) || !texte(v.source) || !objet(v.paire)) return null;
    const { normale, holo } = v.paire;
    if (!Number.isInteger(normale) || !Number.isInteger(holo) || normale === holo) return null;
    if (tous.length !== 2 || !tous.includes(normale) || !tous.includes(holo)) return null;
    return { normale, holo };
}
const MARQUES_MAX = 12;
/** Les seuls champs lus sur le scan qui s'écrivent (tour 1, point 2) : rien de libre — ni `note`, ni un champ que l'agent aurait ajouté. */
const CHAMPS_LUS = Object.freeze(['nom', 'numero', 'total', 'langue', 'tampon', 'finition', 'position']);
// (le nom TRADUIT : ce que le chasseur a saisi — Pokédex, PV, règle, code du set — s'écrit AUSSI, mais seulement quand il est présent : la forme des preuves existantes ne bouge pas)
const luEnumere = lu => ({ ...Object.fromEntries(CHAMPS_LUS.map(k => [k, typeof lu?.[k] === 'string' || typeof lu?.[k] === 'number' ? lu[k] : null])),
    ...Object.fromEntries(CHAMPS_TEMOIN_TRADUIT.filter(k => typeof lu?.[k] === 'string' || typeof lu?.[k] === 'number').map(k => [k, lu[k]])) });

function preuvesDe(a) {
    const e = a.entree, lu = luEnumere(e.lu), marques = (Array.isArray(e.lu.marques) ? e.lu.marques : []).filter(texte).slice(0, MARQUES_MAX);
    // tour 4 (6) : la preuve de langue (publique) n'écrit aucun texte libre — seulement des champs ÉNUMÉRÉS (numéro, total, position, tampon, finition), jamais les marques
    const champs = [lu.numero != null ? `n° ${lu.numero}${lu.total != null ? `/${lu.total}` : ''}` : null, lu.position != null ? `position ${lu.position}` : null, lu.tampon != null ? `tampon ${lu.tampon}` : null, lu.finition != null ? `finition ${lu.finition}` : null].filter(Boolean);
    return { marques, languePreuve: champs.length ? `lue sur le scan : ${champs.join(' ; ')}` : 'lue sur le scan',
        preuveNeutre: e.regle === 'preuve-lue' ? `preuve lue sur le scan : n° ${lu.numero ?? '—'}/${lu.total ?? '—'}, langue ${lu.langue}`
            : e.regle === REGLE_MEME_DESSIN ? `même dessin que l'image servie (prouvé à l'image), n° ${lu.numero ?? '—'} lu sur le scan (${e.lu.moyen ?? '—'}), langue ${lu.langue} (${e.lu.langueMoyen ?? '—'})`
            : `deux sources indépendantes concordantes à l'image, n° ${lu.numero ?? '—'}, langue ${lu.langue}`,
        // les dates s'écrivent en ISO (texte) : le plan passe par un fichier JSON entre sa construction et l'écriture, une Date n'y survit pas
        // (la preuve de même dessin n'écrit que score, seuil et vide : la clé de l'entrée comparée reste dans le manifeste — elle porte le code d'une autre source)
        preuveLue: { regle: e.regle, lu, marques, luLe: dateDe(e.luLe).toISOString(), valideLe: dateDe(a.validation.valideLe).toISOString(),
            // (nom traduit : les marques de la preuve — pv-non-verifie, jumeau-dans-le-set, table-ja-interne — s'écrivent quand il y en a)
            ...(Array.isArray(a.evaluation?.drapeaux) && a.evaluation.drapeaux.length ? { drapeaux: [...a.evaluation.drapeaux] } : {}),
            // (le moyen de lecture du numéro s'écrit pour cette règle seule : l'énumération des champs lus des autres règles ne bouge pas)
            ...(e.regle === REGLE_MEME_DESSIN ? { lu: { ...lu, moyen: e.lu.moyen, langueMoyen: e.lu.langueMoyen }, memeDessin: { lien: a.evaluation?.lien ?? null, score: e.memeDessin.score, seuil: e.memeDessin.seuil, vide: e.memeDessin.vide } } : {}) } };
}
/**
 * Les entrées acceptées (validées ET décidées `ok`) -> les unités d'écriture, ou des refus nommés.
 *   · un produit SEUL sur sa fiche -> une unité ;
 *   · plusieurs produits sur la fiche (V1/V2) : l'image ne les sépare pas. Tous doivent avoir une entrée acceptée AU MÊME sha256, la fiche doit être une PAIRE, et chaque entrée doit porter
 *     `varianteNommee` (une source qui NOMME quel produit est holo : jamais deviné par le prix ni par l'ordre). Alors l'unité porte le marquage EXISTANT de l'API pour une image partagée holo / non holo
 *     (`partageeHoloNonHolo: true` + `produitsPartages: [ids]`, sur l'entrée ET le document). Sinon : `variantes-indiscernables`.
 * @param {{acceptees: {entree: object, validation: object, produit: object, langue: string}[], fiches: Map<string, number[]>, famille: string}} e  `fiches` : tous les produits de chaque fiche (cleFiche -> idProduct[]).
 */
function grouperUnites({ acceptees, fiches, famille }) {
    const unites = [], refus = [];
    const groupes = new Map();
    for (const a of acceptees) (groupes.get(cleFiche(a.produit)) || groupes.set(cleFiche(a.produit), []).get(cleFiche(a.produit))).push(a);
    const refuser = (membres, motif, detail) => { for (const m of membres) refus.push({ idProduct: m.entree.idProduct, motif, ...(detail ? { detail } : {}) }); };
    for (const [cle, membres] of groupes) {
        const tous = fiches.get(cle);
        if (!Array.isArray(tous) || !tous.length) { refuser(membres, 'fiche-inconnue', cle); continue; }
        membres.sort((x, y) => x.entree.idProduct - y.entree.idProduct);
        const ids = membres.map(m => m.entree.idProduct);
        let partage = null;
        if (tous.length > 1) {
            if (tous.length !== 2) { refuser(membres, 'variantes-indiscernables', `${tous.length} produits sur la fiche : seule une paire holo / non holo est prouvable`); continue; }
            if (!tous.every(id => ids.includes(id))) { refuser(membres, 'variantes-indiscernables', 'un produit de la fiche n\'a pas d\'entrée validée'); continue; }
            if (new Set(membres.map(m => m.entree.sha256)).size > 1) { refuser(membres, 'variantes-indiscernables', 'les entrées de la fiche n\'ont pas le même sha256'); continue; }
            const paires = membres.map(m => paireNommee(m.entree.varianteNommee, tous));
            if (paires.some(x => !x)) { refuser(membres, 'variantes-indiscernables', 'aucune source ne nomme quel produit est holo (varianteNommee.paire { normale, holo } = les deux produits de la fiche)'); continue; }
            if (new Set(paires.map(x => `${x.normale}|${x.holo}`)).size > 1) { refuser(membres, 'variantes-indiscernables', 'les deux entrées ne disent pas la même paire'); continue; }
            if (new Set(membres.map(m => `${m.langue}|${norm(tamponAttendu(m.produit.tamponnee).valeur)}`)).size > 1) { refuser(membres, 'unite-incoherente', 'langue ou tampon différents entre les deux produits d\'une même image'); continue; }
            partage = { partageeHoloNonHolo: true, produitsPartages: [...ids], paire: paires[0] };
        } else if (membres.length !== 1 || tous[0] !== ids[0]) { refuser(membres, 'fiche-inconnue', cle); continue; }
        const m = membres[0], e = m.entree, p = m.produit, pr = preuvesDe(m);
        unites.push({
            carteId: p.carteId, slugSet: p.slugSet, numero: numeroDuProduit(p), produits: [...ids], url: e.url, hote: e.hote, fichier: e.fichier, sha256: e.sha256, regle: e.regle,
            langue: m.langue, tampon: tamponAttendu(p.tamponnee).valeur, tirageAttendu: p.tirage, groupe: famille, idSource: null, carteNom: p.nomEn ?? null, nomSource: e.lu.nom ?? null,
            numeroSource: e.lu.numero != null ? `${e.lu.numero}${e.lu.total != null ? `/${e.lu.total}` : ''}` : null, variante: null,
            languePreuve: pr.languePreuve, preuveNeutre: pr.preuveNeutre,
            // seuls des champs ÉNUMÉRÉS s'écrivent : le marquage de l'API, et la paire structurée (jamais le texte libre ni le nom de la source qui la donne)
            champsEntree: { preuveLue: pr.preuveLue, ...(partage ? { partageeHoloNonHolo: true, produitsPartages: partage.produitsPartages } : {}) },
            champsDocument: { preuveLue: pr.preuveLue, ...(partage ? { partageeHoloNonHolo: true, produitsPartages: partage.produitsPartages, paireHoloNonHolo: partage.paire } : {}) }
        });
    }
    return { unites, refus };
}

// ── 8. P9 : les trous du manifeste ───────────────────────────────────────────────────────────────────────────────────────────
const MOTIFS_DE_TROU = Object.freeze(['aucune-source', 'une-seule-source', 'variantes-indiscernables', 'tirage-different', 'illisible']);
/** `source-bloquee:<hôte>` du manifeste -> la forme fermée de comblement.js (`source-bloquee:[a-z0-9]+`) : l'hôte sans ponctuation. LÈVE si rien ne reste. */
function motifDeTrou(m) {
    if (typeof m === 'string' && MOTIFS_DE_TROU.includes(m)) return m;
    const x = typeof m === 'string' ? /^source-bloquee:(.+)$/.exec(m) : null;
    const code = x ? x[1].toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    if (code) return `source-bloquee:${code}`;
    throw new Error(`trou : motif « ${m} » hors de la liste fermée (${MOTIFS_DE_TROU.join(', ')}, source-bloquee:<hote>)`);
}
/**
 * Les trous nommés d'un manifeste -> les trous de comblement.js. Tout est validé AVANT : un trou mal formé LÈVE (rien n'est écrit à moitié). Un produit qui a REÇU un visuel validé n'a pas de trou.
 * @param {{trous: object[], recus: Set<number>, famille: string}} e
 */
function trousDuManifeste({ trous, recus, famille }) {
    const vus = new Set(), sortie = [], ecartes = [];
    for (const t of trous) {
        if (!objet(t) || !Number.isInteger(t.idProduct) || t.idProduct <= 0) throw new Error(`trou : idProduct entier > 0 attendu (famille ${famille})`);
        if (vus.has(t.idProduct)) throw new Error(`trou ${t.idProduct} : doublon dans le manifeste ${famille}`);
        vus.add(t.idProduct);
        const motif = motifDeTrou(t.motif);
        if (!Array.isArray(t.interroges) || !t.interroges.length || !t.interroges.every(texte)) throw new Error(`trou ${t.idProduct} : « interroges » (les hôtes interrogés, au moins un) exigés`);
        const le = dateDe(t.date);
        if (!le) throw new Error(`trou ${t.idProduct} : date valide exigée`);
        sortie.push({ idProduct: t.idProduct, motif, sources: [...t.interroges], le, preuve: { interroges: [...t.interroges], date: t.date, detail: t.detail ?? '', famille, instrument: 'preuves-validees' } });
    }
    const gardes = [];
    for (const t of sortie) (recus.has(t.idProduct) ? ecartes.push({ idProduct: t.idProduct, motif: 'visuel-recu' }) : gardes.push(t));
    return { trous: gardes, ecartes };
}

module.exports = { POSITIONS_RONDES, CODES_IMPRIMES_ADMIS, CODES_SANS_TOTAL, sansTotalAdmis, SOURCE, LOT, SRC, LANGUE_PREUVE, EDITIONS_LOCALES, REGLES, REGLE_MEME_DESSIN, LANGUES_NON_LATINES, MOYENS_DE_LECTURE, MOYENS_DE_LANGUE, SEUIL_PLANCHER, SCORE_PLANCHER, VIDE_PLANCHER, lienAvecLEntree, evaluerRemplacementMemeDessin, langueDuProduit, formeEntree, lireManifeste, lireValidations, rapprocher, evaluerPreuveLue, evaluerDeuxSources, evaluerEntree,
    verifierCache, setAdmisPourPosition, preuvesDe, motifDeNom, motifDeNomTraduit, REGLES_SANS_POKEDEX, construireTableJaCroisee, preuveParTableCroisee, porteUnTemoinTraduit, CHAMPS_TEMOIN_TRADUIT, LANGUES_A_NOM_TRADUIT, TAMPONS_ATTENDUS, tamponAttendu, cleFiche, grouperUnites, MOTIFS_DE_TROU, motifDeTrou, trousDuManifeste, sha256De, racineDe };

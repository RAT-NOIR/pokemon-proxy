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
const crypto = require('crypto');
const fs = require('fs');
const J = require('./jointure');
const CO = require('./comblement');
const CI = require('./concordance-image');
const RC = require('./recolte-commun');
const HOTE = require('./recolte-hote');

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
function langueDuProduit({ idExpansion, tirage } = {}) {
    if (Number.isInteger(idExpansion) && Object.hasOwn(EDITIONS_LOCALES, idExpansion)) return EDITIONS_LOCALES[idExpansion];
    return CO.langueDuTirage(tirage);
}

// ── 2. Petites lectures ──────────────────────────────────────────────────────────────────────────────────────────────────────
const REGLES = Object.freeze(['preuve-lue', 'deux-sources']);
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
/** Tour 4 (3) : le numéro en FIN de slug Cardmarket (« …-PPS8MEG-114 » -> « 114 »), frontière non alphanumérique avant ; null si le slug n'en porte pas (« …-CIN71 » : collé à des lettres, ce n'est pas un numéro). */
const numeroFinDeSlug = slug => { const m = /(?:^|[^A-Za-z0-9])(\d+[A-Za-z]*)$/.exec(String(slug ?? '').trim()); return m ? m[1] : null; };
// Tour 4 (5) : la variante nommée d'un produit sans numéro (« Blue Border » / « standard ») se compare à la finition LUE, par table fermée ; une autre valeur de `attendu.variante` (V1, V2…) n'entre pas ici.
const FINITIONS_ATTENDUES = Object.freeze({ 'blue border': 'blue-border', standard: 'standard' });
/** Les seuls sets où une position lue vaut preuve : slugSet `Battle-Academy*` (préfixe) et slugSet contenant `Trainer-Kit`. */
const setAdmisPourPosition = slug => typeof slug === 'string' && (slug.startsWith('Battle-Academy') || slug.includes('Trainer-Kit'));
/** Le nom lu sur le scan est-il celui du produit ? Nom Cardmarket décomposé (avant « [ ») puis `clesNom` de la jointure ; l'un ou l'autre côté vide = non. */
const memeNomQueLeProduit = (lu, nomProduit) => {
    if (!texte(lu) || !texte(nomProduit)) return false;
    // tour 4 (1) : accents tolérés (« Pokégear 3.0 » = « Pokegear 3.0 »)
    const cles = new Set(J.clesNom(SANS_ACCENTS(J.decomposerNomCardmarket(nomProduit).nom)));
    return J.clesNom(SANS_ACCENTS(lu)).some(k => cles.has(k));
};
/** Tour 4 (1) : le nom lu est exigé PARTOUT. Il ne se compare qu'en anglais (le nom du produit est le nom anglais ; aucun autre chemin — n° de Pokédex… — n'existe aujourd'hui) : une autre langue lue = refus. */
const motifDeNom = (lu, produit) => (lu.langue !== 'en' ? 'nom-langue-non-anglaise' : (memeNomQueLeProduit(lu.nom, produit?.nomEn) ? null : 'nom-different'));
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
function evaluerPreuveLue({ entree, produit, langueProduit }) {
    const motifs = [], lu = entree.lu ?? {};
    const marques = Array.isArray(lu.marques) && lu.marques.length > 0 && lu.marques.every(texte);
    if (!marques) motifs.push('marques-vides');
    else if (lu.marques.some(nommeUneSource)) motifs.push('marque-nomme-une-source');
    if (langueProduit == null) motifs.push('langue-du-tirage-inconnue');
    else if (lu.langue !== langueProduit) motifs.push('langue-differente');
    const np = numeroDuProduit(produit);
    if (lu.position != null) {
        // tour 2 (2) : la POSITION lue sur un symbole (deck, rond Battle Academy, moitié de kit) désigne le produit quand son numéro est une position ; elle remplace le numéro imprimé (qui reste écrit tel quel),
        // le total n'est pas exigé. Liste FERMÉE de sets : ailleurs une position n'a aucune valeur de preuve.
        if (!setAdmisPourPosition(produit?.slugSet)) motifs.push('position-hors-liste');
        else if (!texte(lu.position)) motifs.push('position-vide');
        else if (np == null) motifs.push('position-sans-numero-produit');
        else if (J.cleNumero(String(lu.position).trim()) !== J.cleNumero(np)) motifs.push('numero-different');
        else motifs.push(...motifsDePosition(lu, produit));
        const mn = motifDeNom(lu, produit); if (mn) motifs.push(mn);       // tour 4 (1) : le nom, branche position
    } else if (np != null) {
        const n = lu.numero == null ? '' : String(lu.numero).trim(), t = lu.total == null ? '' : String(lu.total).trim();
        // tour 2 (1) : une promo (« XY150a », « SM30a ») n'imprime aucun total — il n'est exigé que pour un numéro purement numérique (+ suffixe) ; un préfixe alphabétique se juge sans total
        if (n === '' || (t === '' && !PREFIXE_ALPHABETIQUE.test(n))) motifs.push('numero-ou-total-absent');
        else if (J.cleNumero(n) !== J.cleNumero(np) && !numeroSansPrefixeAdmis(n, np, produit?.slug)) motifs.push('numero-different');
        const mn = motifDeNom(lu, produit); if (mn) motifs.push(mn);       // tour 4 (1) : le nom aussi, avec numéro
    } else {
        if (entree.attendu?.numero != null && String(entree.attendu.numero).trim() !== '') motifs.push('numero-attendu-non-null');
        // tour 1 (1) : sans numéro, RIEN d'autre ne relie l'image au produit que son NOM — le nom lu doit être celui du produit (Cardmarket, avant « [ »), par la normalisation de la jointure
        const mn = motifDeNom(lu, produit); if (mn) motifs.push(mn);       // tour 4 (1) : le nom, branche sans numéro
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
    return { ok: motifs.length === 0, motifs };
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
    const l2 = evaluerPreuveLue({ entree: { lu: s.lu, attendu: entree.attendu, contradictions: entree.contradictions }, produit, langueProduit });
    if (!l2.ok) return non(`seconde-lecture:${l2.motifs[0]}`);
    const r = await decider({
        produit: { langue: langueProduit, codeSet: null, numero: CO.reduireNumero(produit?.numero), tampon: ta.valeur },
        candidats: [{ source: entree.hote, buf: octets.a, tirage: tirageDeLecture(entree.lu) }, { source: s.hote, buf: octets.b, tirage: tirageDeLecture(s.lu) }],
        scansConformes: []
    });
    if (r?.decision !== 'ecrire') return non(r?.motif ?? r?.decision ?? 'indecidable');
    return { ok: true, regle: 'deux-sources', preuve: r.preuve };
}

/** La décision d'une entrée appariée, par sa règle. @returns {Promise<{ok: boolean, regle?: string, motif?: string, motifs?: string[]}>} */
async function evaluerEntree({ entree, produit, octets, decider }) {
    const langueProduit = langueDuProduit(produit);
    if (entree.regle === 'preuve-lue') {
        const r = evaluerPreuveLue({ entree, produit, langueProduit });
        return r.ok ? { ok: true, regle: 'preuve-lue' } : { ok: false, motif: `preuve-lue:${r.motifs[0]}`, motifs: r.motifs };
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
const luEnumere = lu => Object.fromEntries(CHAMPS_LUS.map(k => [k, typeof lu?.[k] === 'string' || typeof lu?.[k] === 'number' ? lu[k] : null]));

function preuvesDe(a) {
    const e = a.entree, lu = luEnumere(e.lu), marques = (Array.isArray(e.lu.marques) ? e.lu.marques : []).filter(texte).slice(0, MARQUES_MAX);
    // tour 4 (6) : la preuve de langue (publique) n'écrit aucun texte libre — seulement des champs ÉNUMÉRÉS (numéro, total, position, tampon, finition), jamais les marques
    const champs = [lu.numero != null ? `n° ${lu.numero}${lu.total != null ? `/${lu.total}` : ''}` : null, lu.position != null ? `position ${lu.position}` : null, lu.tampon != null ? `tampon ${lu.tampon}` : null, lu.finition != null ? `finition ${lu.finition}` : null].filter(Boolean);
    return { marques, languePreuve: champs.length ? `lue sur le scan : ${champs.join(' ; ')}` : 'lue sur le scan',
        preuveNeutre: e.regle === 'preuve-lue' ? `preuve lue sur le scan : n° ${lu.numero ?? '—'}/${lu.total ?? '—'}, langue ${lu.langue}` : `deux sources indépendantes concordantes à l'image, n° ${lu.numero ?? '—'}, langue ${lu.langue}`,
        // les dates s'écrivent en ISO (texte) : le plan passe par un fichier JSON entre sa construction et l'écriture, une Date n'y survit pas
        preuveLue: { regle: e.regle, lu, marques, luLe: dateDe(e.luLe).toISOString(), valideLe: dateDe(a.validation.valideLe).toISOString() } };
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

module.exports = { SOURCE, LOT, SRC, LANGUE_PREUVE, EDITIONS_LOCALES, REGLES, langueDuProduit, formeEntree, lireManifeste, lireValidations, rapprocher, evaluerPreuveLue, evaluerDeuxSources, evaluerEntree,
    verifierCache, setAdmisPourPosition, TAMPONS_ATTENDUS, tamponAttendu, cleFiche, grouperUnites, MOTIFS_DE_TROU, motifDeTrou, trousDuManifeste, sha256De, racineDe };

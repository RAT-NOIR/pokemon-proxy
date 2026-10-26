// ============================================================
// MIROIR OUVERT DU CATALOGUE D'UNE PLACE DE MARCHÉ « tcs » (récolte RECOLTE, 2026-10-24) — Prize Packs et kits Dresseur : l'image du produit
// ============================================================
// Ordre du testeur (24/10) : « Récolte lente de pokipair et tcgcsv : OUI, selon la doctrine. Images seulement (aucun prix), robots.txt lu, 5 s ou plus par hôte, arrêt définitif au premier
// 401, 403, 410, 429 ou défi. »
//
// DEUX hôtes, deux robots.txt, deux décisions :
//   · le miroir de données (JSON, un fichier par groupe) : `User-agent: * Allow: /` — ouvert. On ne lit QUE les listes de produits (jamais `/prices`) : aucun prix n'est demandé ni gardé.
//   · l'hôte des IMAGES du marché : son robots.txt répondait 403 le 24/10. UN 403 est un arrêt définitif (règle du testeur) : s'il se répète, les images sont FERMÉES, aucune image n'est
//     téléchargée, aucun autre hôte et aucune autre taille ne se devine. Le code d'écriture existe quand même (testé sur faux transport) pour le jour où le coordinateur lèverait l'arrêt.
//
// LA PREUVE (doctrine TPC) : set, numéro ET nom. Le set se lit sur le GROUPE du produit (table fermée) ; le numéro et le nom sur le produit lui-même ; ils doivent concorder avec notre produit.
// Un produit qui peut désigner PLUSIEURS de nos produits (une carte réimprimée dans plusieurs séries de Prize Pack, un produit par finition) n'en désigne aucun. Un doute est un trou.
//
// Code neutre : `tcs` (source, lot, clé R2, mention) — le nom de la source n'apparaît jamais en public.
'use strict';
const HOTE = require('./recolte-hote');
const RC = require('./recolte-commun');
const CT = require('./cardtrader');
const J = require('./jointure');

const SOURCE = 'tcs';
const LOT = 'tcs-2026-10';
const LANGUE = 'en';
const LANGUE_PREUVE = 'image de l\'impression exacte (tampon visible) d\'un set déclaré anglais par la source ; set, numéro et nom concordants avec la fiche';
const RACINE_DONNEES = 'tcgcsv.com';
const RACINE_IMAGES = 'tcgplayer.com';
const HOTE_DONNEES = 'tcgcsv.com';
const HOTE_IMAGES = 'tcgplayer-cdn.tcgplayer.com';
/** Les catégories lues : 3 = Pokémon (anglais), 85 = Pokémon Japon (jamais lue ici : les promos asiatiques n'y sont pas, et le tirage serait faux). */
const CATEGORIES = Object.freeze([3]);

/** La forme FERMÉE des chemins : la liste des groupes d'une catégorie, la liste des produits d'un groupe, les images d'un produit. Jamais `/prices`. */
// T4 : le catalogue COMPLET (Pokémon 3 et Pokémon Japon, dont l'identifiant se LIT dans /categories, il ne se devine pas) : la catégorie est un nombre, la liste des catégories admises est portée par l'appelant
// (urlGroupes / urlProduits). Jamais `/prices` : la forme fermée n'a ni ce mot ni aucun autre segment.
const CHEMIN_DONNEES = /^\/(robots\.txt|last-updated\.txt|tcgplayer\/categories|tcgplayer\/\d{1,4}\/groups|tcgplayer\/\d{1,4}\/\d{1,7}\/products)$/;
const CHEMIN_IMAGE = /^\/product\/\d{1,9}_(200w|in_1000x1000)\.jpg$/;
const hotes = () => ({ [HOTE_DONNEES]: { chemin: CHEMIN_DONNEES, racine: RACINE_DONNEES }, [HOTE_IMAGES]: { chemin: new RegExp(`^(/robots\\.txt|${CHEMIN_IMAGE.source.replace(/^\^/, '').replace(/\$$/, '')})$`), racine: RACINE_IMAGES } });
function fabriquerClient(o) { return HOTE.fabriquerClient({ racine: RACINE_DONNEES, hotes: hotes(), ...o }); }
const SRC = RC.fabriquerSource({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE: 'intl', CHAMP_BILAN: 'bilanLotTcs', nomsInterdits: ['tcgcsv', 'tcgplayer'], tampon: slug => CT.tamponDeLaFamille(slug) });

/**
 * LA TABLE FERMÉE des groupes lus (le reste du miroir n'est pas ouvert) : l'identifiant du groupe, le nom que la liste des groupes doit lui donner (garde de LECTURE), la famille et nos sets.
 * Les Prize Packs : UN groupe pour les neuf séries (le marché ne distingue pas la série) ; le kit Sandslash : un groupe pour un set.
 */
const GROUPES = Object.freeze([
    { groupId: 22880, nom: 'Prize Pack Series Cards', famille: 'pp', code: 'PP', slugs: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'].map(n => `Play-Pokemon-Prize-Pack-Series-${n}`) },
    { groupId: 2208, nom: 'SM Trainer Kit: Alolan Sandslash & Alolan Ninetales', famille: 'kit', code: 'TK11', slugs: ['SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales'] }
]);
const groupeDe = id => GROUPES.find(g => g.groupId === id) ?? null;

/** Le miroir de données réduit à ce qu'on lit : AUCUN prix (le miroir n'en porte pas dans cette liste, et on n'ouvre jamais `/prices`), ni texte de carte : { productId, name, imageUrl, groupId, number, rarity }. */
function reduireProduits(texte) {
    const j = JSON.parse(texte);
    if (!j || j.success !== true || !Array.isArray(j.results)) throw new Error('liste de produits illisible (pas {success, results})');
    const val = (p, k) => (p.extendedData || []).find(e => e.name === k)?.value ?? null;
    // idempotente : une liste déjà réduite (`number`, `rarity` à plat) se réduit à elle-même
    return JSON.stringify({ success: true, totalItems: j.totalItems ?? j.results.length, results: j.results.map(p => ({ productId: p.productId, name: p.name, imageUrl: p.imageUrl ?? null, groupId: p.groupId, number: p.number ?? val(p, 'Number'), rarity: p.rarity ?? val(p, 'Rarity') })) });
}
/** La garde de LECTURE de la liste des groupes : chaque groupe de la table existe, sous le nom attendu, dans la catégorie. LÈVE sinon (un nom qui change n'est pas le même groupe). */
function verifierGroupes(texte) {
    const j = JSON.parse(texte);
    if (!j || j.success !== true || !Array.isArray(j.results) || !j.results.length) throw new Error('liste de groupes illisible ou vide');
    const manque = GROUPES.filter(g => !j.results.some(x => x.groupId === g.groupId && x.name === g.nom && x.categoryId === 3));
    if (manque.length) throw new Error(`groupe(s) absent(s) ou renommé(s) : ${manque.map(g => `${g.groupId} « ${g.nom} »`).join(' ; ')}`);
    return { groupes: j.results.length, lus: GROUPES.map(g => g.groupId) };
}

// ── LA LECTURE D'UN PRODUIT ───────────────────────────────────────────────────────────────────────────────────────────────────
const sansFinition = nom => String(nom).replace(/\s*\(Cosmos Holo\)\s*$/i, '');
/** « Houndoom - 096/163 » ou « Houndoom - 096/163 (Cosmos Holo) » -> { nom, numero, total, cosmos } ; tout autre libellé (énergie de série, tampon gauche/droit…) -> null, jamais deviné. */
function produitPrizePack(p) {
    const m = /^(.+?) - (\d{1,3})\/(\d{1,3})(?: \(Cosmos Holo\))?$/.exec(String(p?.name ?? ''));
    if (!m) return null;
    return { productId: p.productId, nom: m[1], numero: J.cleNumero(m[2]), total: Number(m[3]), cosmos: /\(Cosmos Holo\)\s*$/i.test(p.name), url: p.imageUrl ?? null, name: p.name };
}
/** « Hoothoot (1) » + Number « 106/147 » (ou « SM127 ») -> { nom, rang, numero, total } ; un suffixe (demi-deck, #) ou une énergie sans numéro -> null. */
function produitKit(p) {
    const m = /^(.+?) \((\d{1,3})\)$/.exec(String(p?.name ?? ''));
    const n = /^(?:(\d{1,3})\/(\d{1,3})|([A-Z]{1,4})(\d{1,4}))$/.exec(String(p?.number ?? ''));
    if (!m || !n) return null;
    return { productId: p.productId, nom: m[1], rang: Number(m[2]), numero: J.cleNumero(n[1] ?? n[4]), total: n[2] ? Number(n[2]) : null, prefixe: n[3] ?? null, url: p.imageUrl ?? null, name: p.name };
}
/** Notre slug de kit « Piplup-UPR32 », « Stufful-TK11BUS-110 », « Hau-V1-TK11SUM-120 » -> { nom, numero, variante } ; une énergie sans numéro (« Water-Energy-V1-SUM ») -> null. */
function slugDeKit(slug, code) {
    const t = String(slug ?? '').split('-').filter(Boolean);
    let numero = null, variante = null, origine = null;
    const dernier = t[t.length - 1] ?? '', avant = t[t.length - 2] ?? '';
    let m;
    if (/^\d{1,4}$/.test(dernier) && (m = new RegExp(`^${code}([A-Z]*)$`).exec(avant))) { numero = dernier; origine = m[1] || null; t.length -= 2; }
    else if ((m = new RegExp(`^${code}(\\d{1,4})$`).exec(dernier))) { numero = m[1]; t.pop(); }
    else if ((m = /^([A-Z]{2,4})(\d{1,4})$/.exec(dernier)) && !new RegExp(`^${code}`).test(dernier)) { numero = m[2]; origine = m[1]; t.pop(); }
    else return null;
    const v = t.findIndex(x => /^V\d+$/i.test(x));
    if (v >= 0) { variante = t[v]; t.splice(v, 1); }
    return t.length ? { nom: t.join(' '), numero: J.cleNumero(numero), variante, origine } : null;
}
const memeNom = (a, b) => { const ka = J.clesNom(a), kb = J.clesNom(b); return ka.some(k => kb.includes(k)); };
/** Le total imprimé que NOTRE carte déclare pour ce numéro (le témoin : une donnée que la clé nom + numéro n'utilise pas). */
const impressionConfirme = (carte, numero, total, prefixe = null) => (carte?.impressions || []).some(i => i.numero != null && J.cleNumero(i.numero) === `${prefixe ?? ''}${numero}` && (total == null ? true : Number(i.total) === total));
/** L'adresse de l'image PLEINE : la miniature du miroir (`_200w`) devient la taille mesurée le 24/10 (`_in_1000x1000`, 576 × 804 pour un Prize Pack). Rien d'autre ne se devine. */
const urlPleine = url => { const m = /^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/(\d{1,9})_200w\.jpg$/.exec(String(url ?? '')); return m ? `https://${HOTE_IMAGES}/product/${m[1]}_in_1000x1000.jpg` : null; };

// ── LA PREUVE ET LE PLAN ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * LES PRIZE PACKS. Notre produit « Houndoom-PPS1BST-096 » (série par le set, origine par le slug) ; le marché n'a qu'UN produit « Houndoom - 096/163 » pour toutes les séries et ne dit pas la
 * finition de nos V1/V2. Prouvé seulement quand : le nom ET le numéro ET le total imprimé (témoin lu sur NOTRE carte) concordent ; la carte d'origine n'est dans qu'UNE série et qu'UN de nos
 * produits (sinon le tampon de la série ne se prouve pas) ; le marché n'a qu'UN produit à ce nom et ce numéro (ni finition « Cosmos Holo » à côté, ni homonyme).
 * @param {{lignes: Array<{slugSet, carteId, idProduct, slug, carte}>, produits: object[]}} o  `produits` : le contenu du groupe (réduit)
 */
function planifierPrizePacks({ lignes, produits }) {
    const marche = (produits || []).map(produitPrizePack).filter(Boolean);
    const inconnus = (produits || []).length - marche.length;
    const parOrigine = new Map(), restes = [], unites = [];
    const analyses = lignes.map(l => ({ l, s: CT.produitDepuisSlug(l.slug, 'pp') }));
    for (const { l, s } of analyses) if (s && s.numero != null) { const k = `${l.carteId}|${s.code ?? ''}|${J.cleNumero(s.numero)}`; (parOrigine.get(k) || parOrigine.set(k, []).get(k)).push(l); }
    const reste = (l, motif, detail) => restes.push({ carteId: l.carteId, idProduct: l.idProduct, slugSet: l.slugSet, motif, ...(detail ? { detail } : {}) });
    for (const { l, s } of analyses) {
        if (!s || s.numero == null) { reste(l, 'slug-sans-numero'); continue; }
        if (s.variante) { reste(l, 'variantes-non-lues', `${s.variante} : la finition de notre produit ne se lit pas`); continue; }
        const num = J.cleNumero(s.numero), k = `${l.carteId}|${s.code ?? ''}|${num}`, lignesO = parOrigine.get(k);
        if (lignesO.length > 1) { reste(l, new Set(lignesO.map(x => x.slugSet)).size > 1 ? 'plusieurs-series' : 'plusieurs-produits', `${lignesO.length} produits pour la même carte d'origine`); continue; }
        if (!l.carte?.nomEn) { reste(l, 'sans-nom'); continue; }
        const cands = marche.filter(p => p.numero === num && memeNom(p.nom, l.carte.nomEn));
        if (!cands.length) { reste(l, 'absente-de-la-source'); continue; }
        const memeCle = marche.filter(p => p.numero === num && p.total === cands[0].total && memeNom(p.nom, l.carte.nomEn));
        if (memeCle.length > 1) { reste(l, 'finitions-multiples', `${memeCle.length} produits au marché (${memeCle.map(p => p.name).join(' | ')})`); continue; }
        const p = cands[0];
        if (cands.length > 1) { reste(l, 'totaux-multiples', `${cands.length} produits au même nom et numéro`); continue; }
        if (!impressionConfirme(l.carte, num, p.total)) { reste(l, 'total-non-confirme', `le marché dit ${p.numero}/${p.total}, notre carte ne déclare pas ce couple`); continue; }
        if (p.cosmos) { reste(l, 'seule-finition-cosmos', 'le seul produit du marché est la finition Cosmos Holo : notre finition n\'est pas prouvée'); continue; }
        const url = urlPleine(p.url);
        if (!url) { reste(l, 'adresse-hors-forme', p.url); continue; }
        unites.push({ carteId: l.carteId, slugSet: l.slugSet, numero: null, produits: [l.idProduct], slugProduit: l.slug, url, idSource: String(p.productId), groupe: 'PP', carteNom: l.carte.nomEn, nomSource: p.name, numeroSource: `${num}/${p.total}`,
            preuveNeutre: `série par le set ${l.slugSet}, origine n° ${num}/${p.total}, nom « ${p.nom} » = fiche « ${l.carte.nomEn} », total imprimé confirmé par la fiche, une seule série, un seul produit` });
    }
    const parMotif = {};
    for (const r of restes) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { unites, restes, parMotif, base: { produitsMarche: (produits || []).length, lus: marche.length, formesInconnues: inconnus, cosmos: marche.filter(p => p.cosmos).length } };
}
/**
 * LE KIT SANDSLASH. Notre produit « Piplup-UPR32 » ; le marché « Piplup (11) » + Number « 32/156 ». Prouvé seulement quand : nom ET numéro d'origine concordent, le total imprimé est confirmé
 * par NOTRE carte, et il n'y a qu'UN produit de chaque côté (deux copies V1/V2 ↔ « (14) » et « (29) » ne s'apparient pas : rien ne dit laquelle est laquelle).
 */
function planifierKit({ lignes, produits, code }) {
    const marche = (produits || []).map(produitKit).filter(Boolean);
    const restes = [], unites = [];
    const reste = (l, motif, detail) => restes.push({ carteId: l.carteId, idProduct: l.idProduct, slugSet: l.slugSet, motif, ...(detail ? { detail } : {}) });
    const analyses = lignes.map(l => ({ l, s: slugDeKit(l.slug, code) }));
    const effectif = new Map();
    for (const { s } of analyses) if (s) { const k = `${J.normaliserNom(s.nom)}|${s.numero}`; effectif.set(k, (effectif.get(k) || 0) + 1); }
    for (const { l, s } of analyses) {
        if (!s) { reste(l, 'slug-sans-numero'); continue; }
        if (!l.carte?.nomEn) { reste(l, 'sans-nom'); continue; }
        if (effectif.get(`${J.normaliserNom(s.nom)}|${s.numero}`) > 1 || s.variante) { reste(l, 'copies-multiples', 'plusieurs produits de notre côté pour ce nom et ce numéro'); continue; }
        if (!memeNom(s.nom, l.carte.nomEn)) { reste(l, 'nom-produit-different', `« ${s.nom} » sur le produit, « ${l.carte.nomEn} » sur la fiche`); continue; }
        const cands = marche.filter(p => p.numero === s.numero && memeNom(p.nom, s.nom) && (p.prefixe == null || p.prefixe === s.origine));
        if (!cands.length) { reste(l, 'absente-de-la-source'); continue; }
        if (cands.length > 1) { reste(l, 'copies-multiples-source', `${cands.length} produits au marché (${cands.map(p => p.name).join(' | ')})`); continue; }
        const p = cands[0];
        if (!impressionConfirme(l.carte, s.numero, p.total, p.prefixe)) { reste(l, 'total-non-confirme', `le marché dit ${p.numero}/${p.total ?? p.prefixe}`); continue; }
        const url = urlPleine(p.url);
        if (!url) { reste(l, 'adresse-hors-forme', p.url); continue; }
        unites.push({ carteId: l.carteId, slugSet: l.slugSet, numero: null, produits: [l.idProduct], slugProduit: l.slug, url, idSource: String(p.productId), groupe: 'TK11', carteNom: l.carte.nomEn, nomSource: p.name, numeroSource: `${s.numero}/${p.total ?? p.prefixe}`,
            preuveNeutre: `kit ${code}, origine n° ${s.numero}, nom « ${p.nom} » = fiche « ${l.carte.nomEn} », total imprimé confirmé par la fiche, un seul produit de chaque côté` });
    }
    const parMotif = {};
    for (const r of restes) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { unites, restes, parMotif, base: { produitsMarche: (produits || []).length, lus: marche.length } };
}

const urlGroupes = (categorie, admises = CATEGORIES) => { if (!admises.includes(categorie)) throw new Error(`tcs : catégorie ${categorie} hors de la liste fermée`); return `https://${HOTE_DONNEES}/tcgplayer/${categorie}/groups`; };
const urlProduits = (categorie, groupe, admises = CATEGORIES) => {
    if (!admises.includes(categorie)) throw new Error(`tcs : catégorie ${categorie} hors de la liste fermée`);
    if (!Number.isInteger(groupe) || groupe <= 0) throw new Error(`tcs : groupe ${groupe} de la catégorie ${categorie} refusé`);
    return `https://${HOTE_DONNEES}/tcgplayer/${categorie}/${groupe}/products`;
};
const urlCategories = () => `https://${HOTE_DONNEES}/tcgplayer/categories`;
const urlDerniereMaj = () => `https://${HOTE_DONNEES}/last-updated.txt`;

// ── T4 : LES CATÉGORIES ET LA SYNCHRO QUOTIDIENNE CONDITIONNELLE ──────────────────────────────────────────────────────────────
const sansAccent = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
/** La liste des catégories -> { pokemon, japon } LUS par leur nom. Pokémon doit être la 3 ; « Pokémon Japon » doit être UNE seule catégorie : zéro ou plusieurs LÈVE (l'identifiant ne se devine pas). */
function resoudreCategories(texte) {
    const j = JSON.parse(texte);
    if (!j || j.success !== true || !Array.isArray(j.results) || !j.results.length) throw new Error('liste des catégories illisible (pas {success, results})');
    const nommee = (c, re) => re.test(sansAccent(c.name)) || re.test(sansAccent(c.displayName));
    const pokemon = j.results.filter(c => nommee(c, /^pokemon$/i)), japon = j.results.filter(c => nommee(c, /^pokemon japan(ese)?$/i));
    if (pokemon.length !== 1 || pokemon[0].categoryId !== 3) throw new Error(`catégorie Pokémon : ${pokemon.length} trouvée(s) (${pokemon.map(c => c.categoryId).join(', ')}), la 3 est attendue — on ne devine pas`);
    if (japon.length === 0) throw new Error('catégorie Pokémon Japan (Japon) absente de la liste des catégories — on ne devine pas son identifiant');
    if (japon.length > 1) throw new Error(`catégorie Pokémon Japan : plusieurs candidates ambiguës (${japon.map(c => c.categoryId).join(', ')}) — on ne devine pas`);
    return { pokemon: pokemon[0].categoryId, japon: japon[0].categoryId };
}
const jourUTC = d => d.toISOString().slice(0, 10);
/**
 * AVANT toute requête : une synchronisation par jour AU PLUS (jour UTC). Seul un état RÉUSSI ferme le jour (une synchro interrompue se reprend le même jour) ; un « rien de neuf » le ferme aussi
 * (`verifieLe` est posé à chaque vérification réussie).
 */
function synchroDuJour(etat, maintenant = new Date()) {
    const t = Date.parse(etat?.verifieLe ?? '');
    if (etat?.reussie === true && Number.isFinite(t) && jourUTC(new Date(t)) === jourUTC(maintenant)) return { action: 'sauter-jour', raison: `déjà vérifié aujourd'hui (${etat.verifieLe}) : une synchronisation par jour au plus` };
    return { action: 'continuer', raison: etat ? 'nouveau jour ou synchro à reprendre' : 'aucune synchro précédente' };
}
/** `last-updated.txt` lu : synchroniser SEULEMENT s'il est strictement plus récent que celui de la dernière synchro RÉUSSIE. Un texte illisible ne conclut pas : refus. */
function synchroApresLastUpdated(etat, texte) {
    const lu = Date.parse(String(texte ?? '').trim());
    if (!Number.isFinite(lu) || !/^\d{4}-\d{2}-\d{2}/.test(String(texte ?? '').trim())) return { action: 'refuser', raison: `last-updated.txt illisible (${JSON.stringify(String(texte ?? '').slice(0, 60))}) : on ne conclut pas` };
    if (etat?.reussie === true) {
        const avant = Date.parse(etat.lastUpdated ?? '');
        if (Number.isFinite(avant) && !(lu > avant)) return { action: 'rien-de-neuf', raison: `last-updated ${String(texte).trim()} n'est pas plus récent que la dernière synchro réussie (${etat.lastUpdated})`, lastUpdated: String(texte).trim() };
    }
    return { action: 'synchroniser', raison: etat?.reussie === true ? 'last-updated plus récent' : 'aucune synchro réussie', lastUpdated: String(texte).trim() };
}
/** Les groupes à redemander : jamais relevés, ou dont `modifiedOn` (liste des groupes) a changé depuis le relevé. Un groupe inchangé ne se redemande pas. `sansCache` : la réponse du cache est périmée. */
function groupesARedemander({ listes, rel }) {
    const sortie = [];
    for (const [cat, liste] of Object.entries(listes || {})) for (const g of liste) {
        const r = rel?.[g.groupId];
        if (!r?.produits && !(r?.absente === true && r.modifiedOn === g.modifiedOn)) sortie.push({ groupId: g.groupId, categoryId: Number(cat), raison: 'jamais-releve', sansCache: false });
        else if (r.modifiedOn !== g.modifiedOn) sortie.push({ groupId: g.groupId, categoryId: Number(cat), raison: 'modifie', sansCache: true });
    }
    return sortie.sort((a, b) => a.groupId - b.groupId);
}

module.exports = { SOURCE, LOT, LANGUE, LANGUE_PREUVE, SRC, GROUPES, groupeDe, RACINE_DONNEES, RACINE_IMAGES, HOTE_DONNEES, HOTE_IMAGES, CATEGORIES, CHEMIN_DONNEES, CHEMIN_IMAGE, hotes, fabriquerClient, urlGroupes, urlProduits, urlCategories, urlDerniereMaj, resoudreCategories, synchroDuJour, synchroApresLastUpdated, groupesARedemander,
    reduireProduits, verifierGroupes, produitPrizePack, produitKit, slugDeKit, urlPleine, memeNom, impressionConfirme, planifierPrizePacks, planifierKit };

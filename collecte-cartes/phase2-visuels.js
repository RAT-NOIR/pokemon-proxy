// ============================================================
// PHASE 2 (24/10/2026) — retirer 2 visuels faux, marquer 3 images empruntées ; les 33 autres produits de l'ordre du testeur (22 des lots A et B, 11 du lot C) sont ÉCARTÉS, nommés, et jamais écrits
// ============================================================
// Module PUR (ne lit rien, n'écrit rien en dehors des fonctions `ecrire*` qui reçoivent un `db`). L'ordre du testeur (2026-10-24) : « corrige les 17 vrais faux vus à l'œil » et
// « les 10 cas de finition, de format ou de tampon : marque leur image comme empruntée (imageEmprunteeTirage…). Ne les retire pas. » — 27 produits, ceux-là et eux seuls.
//
// 🔴 LE PIÈGE, MESURÉ (plan.md §1) : une entrée de `cartes.images` est clée par (carte, set, numéro) et sert PLUSIEURS produits (V1, V2, V3, reverse, oversized…). L'API décide quel produit
// reçoit quelle entrée (decision.js : `decider`) ; refuser une entrée (`imageEmprunteeTirage`, decision.js:58) la refuse POUR TOUS ses produits, et en retirer une fait perdre leur visuel
// aux produits qui la partagent — ou, quand la carte a d'autres images, leur fait servir une AUTRE impression (`autre-tirage`). Sur les 27 produits, 22 partagent leur entrée avec un produit
// dont le visuel est JUSTE (audit CONFORME) : ils sont ÉCARTÉS ci-dessous. Les 5 autres ont une entrée à eux seuls. Lot C (11 produits désignés faux par le testeur sur la planche des incertains) : les 11 sont écartés.
//
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : `planifier` ne retient une cible que si (1) la carte et UNE SEULE entrée (set, clé, numéro) existent, (2) cette clé n'est portée par aucune autre
// entrée de la base, (3) la décision de l'API ne sert, par cette clé, QUE des produits de la table du lot, (4) aucune ligne n'a cette clé en substitut, (5) la cible n'est pas déjà dans l'état visé.
// Tout le reste est un REFUS NOMMÉ ; une cible refusée n'est jamais écrite.
'use strict';

const LOT = 'phase2-2026-10-24';
const MOTIF_RETRAIT = 'PHASE 2 (24/10/2026, ordre du testeur) : le visuel montre une autre carte ou un autre produit que le produit Cardmarket, vu à l\'oeil (planches faux-*.jpg de l\'audit S8)';

const cible = (idProduct, carteId, set, numero, cleR2, nom) => Object.freeze({ idProduct, carteId, set, numero, cleR2, nom });

/** LOT A — les visuels FAUX retirés : entrée à un seul produit (le produit lui-même), aucun remplacement juste en base. `retirer-visuels.js` (R2 gardé, document `images` à l'état « retire »). */
const RETRAIT = Object.freeze([
    cible(558476, 231941, 'Tag-Bolt', '101', 'artofpkm/372/102.webp', 'Pikachu & Zekrom GX [Full Blitz | Tag Bolt GX]'),
    cible(730130, 270911, 'Play-Pokemon-Prize-Pack-Series-Three', '143', 'pokumon/Play-Pokemon-Prize-Pack-Series-Three/143-270911-en.webp', 'Snorlax [Unfazed Fat | Thumping Snore]')
]);
/** LOT B — les images marquées `imageEmprunteeTirage: true` : entrée à un seul produit. */
const EMPRUNT = Object.freeze([
    cible(293430, 215425, 'Evolutions', '70', 'tcgdex/Evolutions/70-215425.webp', 'Chansey [Scrunch | Double-edge]'),
    cible(756401, 186656, 'Play-Pokemon-Prize-Pack-Series-Four', '182', 'pokumon/Play-Pokemon-Prize-Pack-Series-Four/182-186656-en.webp', 'Pal Pad'),
    cible(864449, 335821, 'Play-Pokemon-Prize-Pack-Series-Eight', null, 'ctr/Play-Pokemon-Prize-Pack-Series-Eight/sn-335821-en.webp', 'Wally\'s Compassion')
]);

// Les ÉCARTÉS : l'entrée qui les sert sert aussi `partageAvec`, dont le visuel est JUSTE à l'audit (CONFORME, distance < 0,2). Le geste ordonné le retirerait à ces produits (retrait),
// ou les ferait sortir de l'archive d'identification (emprunt). Rien n'est écrit ; `reparation` dit la vraie réparation, qui n'est pas au niveau de l'entrée.
const REP_LIGNE = 'ligne cartes_produits à reprendre (mauvaise carte ou mauvais numéro de fiche) : détachement ou rejointure, hors mandat, feu vert nommé';
const REP_PARTAGE = 'ou marquage de partage (produitsPartages + partageeHoloNonHolo), seulement si le testeur le décide ; sinon ligne à reprendre';
// `lot` : A (17 vrais faux), B (10 finition/format/tampon), C (11 désignés faux par le testeur sur la planche des incertains, 2026-10-24). `geste` : celui que le produit appellerait (retrait pour un
// autre dessin ou produit, emprunt pour une autre finition, un autre format ou un autre tampon du MÊME dessin). Pour A et B il est fixé par l'ordre ; pour C il est LU à l'œil sur la planche.
const ec = (idProduct, lot, nom, entree, partageAvec, reparation = REP_LIGNE, geste = lot === 'B' ? 'emprunt' : 'retrait', nature = null) => Object.freeze({
    idProduct, lot, geste, nature, nom, ...entree, partageAvec: Object.freeze(partageAvec), reparation,
    raison: `l'entrée ${entree.set} n°${entree.numero ?? '(sans numéro)'} (${entree.cleR2}) sert aussi ${partageAvec.join(', ')}, dont le visuel est juste : ${geste === 'retrait' ? 'la retirer lui ferait perdre son visuel (ou lui ferait servir une autre impression)' : 'la marquer empruntée le ferait sortir de l\'archive d\'identification'}`
});
const E = (carteId, set, numero, cleR2) => ({ carteId, set, numero, cleR2 });
const ECARTES = Object.freeze([
    ec(523095, 'A', 'Jirachi GX [Psychic Zone | Star Search | Star Shield GX]', E(237806, 'Unified-Minds', '79', 'tcgdex/Unified-Minds/79-237806.webp'), [378870]),
    ec(321171, 'A', 'Garbodor [Trashalanche | Acid Spray]', E(221742, 'Guardians-Rising', '51', 'tcgdex/Guardians-Rising/51-221742.webp'), [297513]),
    ec(463079, 'A', 'Victory Proof (V3, 3e place)', E(246144, 'Sword-Shield-Promos', null, 'artofpkm/397/333.webp'), [463074]),
    ec(463069, 'A', 'Victory Proof (V1, 1re place)', E(246144, 'Sword-Shield-Promos', null, 'artofpkm/397/333.webp'), [463074]),
    ec(824940, 'A', 'Eevee [Boosted Evolution | Reckless Charge] (V2, n° 225)', E(318039, 'Scarlet-Violet-Thai-Promos', '177', 'tpc-asie/Scarlet-Violet-Thai-Promos/177-318039-th.webp'), [824918]),
    ec(311404, 'A', 'M Sharpedo EX [Torpedo Dive]', E(224087, 'XY-Black-Star-Promos', 'XY200', 'tcgdex/XY-Black-Star-Promos/XY200-224087.webp'), [311398, 363915]),
    ec(471679, 'A', 'Champions Festival [Duckboat]', E(181655, 'Sun-Moon-Promos', null, 'artofpkm/324/425.webp'), [468979]),
    ec(471684, 'A', 'Champions Festival [Duckboat]', E(181655, 'Sun-Moon-Promos', null, 'artofpkm/324/425.webp'), [468979]),
    ec(665136, 'A', 'Kirlia [Smack | Magical Shot]', E(223952, 'Burning-Shadows', '92', 'tcgdex/Burning-Shadows/92-223952.webp'), [299494]),
    ec(449138, 'A', 'Choice Band', E(220756, 'Guardians-Rising', '121', 'tcgdex/Guardians-Rising/121-220756.webp'), [297573]),
    ec(450308, 'A', 'Rescue Stretcher', E(221788, 'Guardians-Rising', '130', 'tcgdex/Guardians-Rising/130-221788.webp'), [297582]),
    ec(554185, 'A', 'Pitch\'s Pikachu [Pika Shoot] (V2)', E(192356, 'XY-Promos', null, 'artofpkm/279/326.webp'), [554180]),
    ec(700771, 'A', 'Vivillon [Conversion Powder | Colorful Wind] (Collection X, V2)', E(187856, 'Collection-X', '008', 'artofpkm/285/8.webp'), [564498]),
    ec(471694, 'A', 'Victory Decoration', E(220938, 'Sun-Moon-Promos', null, 'artofpkm/324/442.webp'), [471689]),
    ec(700737, 'A', 'Vivillon [Conversion Powder | Colorful Wind] (XY, V2)', E(187856, 'XY', '17', 'tcgdex/XY/17-187856.webp'), [281354, 700739, 700740, 700742]),
    ec(752306, 'B', 'Charmander [Scratch | Ember] (V2, tampon absent)', E(215763, 'Evolutions', '9', 'tcgdex/Evolutions/9-215763.webp'), [293366], REP_PARTAGE),
    ec(901316, 'B', 'Dark Raichu [Surprise Thunder] (V2, non-holo)', E(22341, 'Legendary-Collection', '7', 'tcgdex/Legendary-Collection/7-22341.webp'), [274772], REP_PARTAGE),
    ec(362873, 'B', 'Dark Raichu [Surprise Thunder] (oversized)', E(22341, 'Legendary-Collection', '7', 'tcgdex/Legendary-Collection/7-22341.webp'), [274772], REP_PARTAGE),
    ec(576708, 'B', 'Eevee [Chain Reaction | Bite] (V2, non-holo)', E(60215, 'Wizards-Black-Star-Promos', '11', 'tcgdex/Wizards-Black-Star-Promos/11-60215.webp'), [275430], REP_PARTAGE),
    ec(901315, 'B', 'Dark Blastoise [Hydrocannon | Rocket Tackle] (V2, non-holo)', E(21370, 'Legendary-Collection', '4', 'tcgdex/Legendary-Collection/4-21370.webp'), [274769], REP_PARTAGE),
    ec(362872, 'B', 'Dark Blastoise [Hydrocannon | Rocket Tackle] (oversized)', E(21370, 'Legendary-Collection', '4', 'tcgdex/Legendary-Collection/4-21370.webp'), [274769], REP_PARTAGE),
    ec(855023, 'B', 'Charizard [Energy Burn | Fire Spin] (V3, non-holo)', E(60348, 'Legendary-Collection', '3', 'tcgdex/Legendary-Collection/3-60348.webp'), [274768], REP_PARTAGE),
    // ── LOT C : les 11 que le testeur a désignés FAUX sur la planche des incertains. Aucun n'a d'entrée à lui seul : tous partagent la leur avec un produit CONFORME.
    ec(311405, 'C', 'M Camerupt EX [Magma Eruption] (autre dessin)', E(224077, 'XY-Black-Star-Promos', 'XY198', 'tcgdex/XY-Black-Star-Promos/XY198-224077.webp'), [311401, 363914], REP_LIGNE, 'retrait', 'dessin'),
    ec(371643, 'C', 'Ultra Ball (League Cup, autre illustration)', E(148517, 'Shining-Legends', '68', 'pokemontcg.io/Shining-Legends/68-148517-en.webp'), [302205], REP_LIGNE, 'retrait', 'dessin'),
    ec(468924, 'C', 'Alolan Vulpix [Beacon | Icy Snow] (autre illustration)', E(221577, 'Guardians-Rising', '21', 'tcgdex/Guardians-Rising/21-221577.webp'), [297485, 319255, 886902], REP_LIGNE, 'retrait', 'dessin'),
    ec(471699, 'C', 'Victory Decoration (3e place)', E(220938, 'Sun-Moon-Promos', null, 'artofpkm/324/442.webp'), [471689], REP_LIGNE, 'retrait', 'dessin'),
    ec(700744, 'C', 'Vivillon [Conversion Powder | Colorful Wind] (V6, Icy Snow Pattern russe)', E(187856, 'XY', '17', 'tcgdex/XY/17-187856.webp'), [281354, 700739, 700740, 700742], REP_LIGNE, 'retrait', 'dessin'),
    ec(280583, 'C', 'Flygon [Sand Guard | Air Slash] (V2, même dessin, finition foil)', E(54018, 'EX-Dragon', '15', 'tcgdex/EX-Dragon/15-54018.webp'), [275892], REP_PARTAGE, 'emprunt', 'finition'),
    ec(362871, 'C', 'Charizard [Energy Burn | Fire Spin] (oversized ; MÊME entrée que 855023 du lot B)', E(60348, 'Legendary-Collection', '3', 'tcgdex/Legendary-Collection/3-60348.webp'), [274768], REP_PARTAGE, 'emprunt', 'format'),
    ec(538823, 'C', 'Snivy [Slam] (V2, holo, tampon 25e anniversaire des deux côtés)', E(115998, 'McDonalds-Collection-25th-Anniversary', '5', 'pokemontcg.io/McDonalds-Collection-25th-Anniversary/5-115998-en.webp'), [538818], REP_PARTAGE, 'emprunt', 'finition'),
    ec(722696, 'C', 'Slowpoke [Spacing Out | Scavenge] (V2, tampon 20e anniversaire)', E(210185, 'Generations', '32', 'tcgdex/Generations/32-210185.webp'), [288470], REP_PARTAGE, 'emprunt', 'tampon'),
    ec(873081, 'C', 'Slowpoke [Spacing Out | Scavenge] (V3, tampon Toys R Us ; MÊME entrée que 722696)', E(210185, 'Generations', '32', 'tcgdex/Generations/32-210185.webp'), [288470], REP_PARTAGE, 'emprunt', 'tampon'),
    ec(858713, 'C', 'Spiritomb [Taunt | Doom Decree] (V2, reverse holo)', E(280557, 'Scarlet-Violet', '129', 'tcgdex/Scarlet-Violet/129-280557.webp'), [702424], REP_PARTAGE, 'emprunt', 'finition')
]);
const TABLES = Object.freeze({ A: RETRAIT, B: EMPRUNT });

const num = n => (n === undefined || n === null || String(n).trim() === '' ? null : String(n).trim());
const cleEntree = x => `${x.carteId}|${x.set}|${num(x.numero) ?? ''}|${x.cleR2}`;

/** Les tables sont-elles saines ? Un produit n'est qu'à un endroit, une entrée n'est visée qu'une fois, un écarté dit pourquoi. LÈVE sinon. */
function verifierTables(t = { RETRAIT, EMPRUNT, ECARTES }) {
    const vus = new Map();
    const noter = (id, ou) => { if (vus.has(id)) throw new Error(`verifierTables : le produit ${id} est à la fois dans ${vus.get(id)} et dans ${ou}`); vus.set(id, ou); };
    for (const [nom, liste] of [['RETRAIT', t.RETRAIT], ['EMPRUNT', t.EMPRUNT], ['ECARTES', t.ECARTES]]) for (const x of liste) noter(x.idProduct, nom);
    const entrees = new Set(), cles = new Set();
    for (const x of [...t.RETRAIT, ...t.EMPRUNT]) {
        if (entrees.has(cleEntree(x)) || cles.has(x.cleR2)) throw new Error(`verifierTables : l'entrée ${x.set} n°${x.numero ?? '-'} (${x.cleR2}) est visée deux fois`);
        entrees.add(cleEntree(x)); cles.add(x.cleR2);
    }
    for (const x of t.ECARTES) if (typeof x.raison !== 'string' || x.raison.length < 20 || !Array.isArray(x.partageAvec) || !x.partageAvec.length) throw new Error(`verifierTables : l'écarté ${x.idProduct} ne dit pas sa raison ni les produits justes qui partagent son entrée`);
}

/** Les produits SERVIS par chaque clé de fichier, d'après la décision de l'API (entrées de `decider`) : Map cleR2 → [idProduct] triés. */
function produitsServisParCle(entrees) {
    const m = new Map();
    for (const e of entrees) { const k = e.grande?.cle; if (!k) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(e.idProduct); }
    return new Map([...m].map(([k, s]) => [k, [...s].sort((a, b) => a - b)]));
}

/**
 * Quelles cibles de la table peut-on écrire SANS toucher à un autre produit ?
 * @param {{lot: 'A'|'B', table: object[], cartes: object[], lignes: object[], entrees: object[]}} o
 *   cartes : documents `cartes` (_id, images) ; lignes : `cartes_produits` (idProduct, visuelSubstitut) ; entrees : la sortie de `decider` sur l'état ACTUEL.
 * @returns {{retenues: object[], refus: {idProduct, raison}[]}}
 */
function planifier({ lot, table, cartes, lignes, entrees }) {
    if (lot !== 'A' && lot !== 'B') throw new Error(`planifier : lot « ${lot} » inconnu (A = retrait, B = emprunt)`);
    if (!Array.isArray(cartes) || !cartes.length) throw new Error('planifier : aucune carte lue — base fausse (un vide parfait n\'est pas « rien à faire »)');
    if (!Array.isArray(lignes) || !Array.isArray(entrees)) throw new Error('planifier : lignes ou entrées de l\'API absentes');
    const parId = new Map(cartes.map(c => [c._id, c]));
    const parCle = new Map();
    for (const c of cartes) for (const m of c.images || []) if (m?.cleR2) { if (!parCle.has(m.cleR2)) parCle.set(m.cleR2, []); parCle.get(m.cleR2).push({ carteId: c._id, m }); }
    const servis = produitsServisParCle(entrees);
    const idsTable = new Set(table.map(x => x.idProduct));
    const visees = new Map();
    for (const x of table) visees.set(x.cleR2, (visees.get(x.cleR2) || 0) + 1);
    const retenues = [], refus = [];
    for (const x of table) {
        const non = raison => refus.push({ idProduct: x.idProduct, raison });
        const c = parId.get(x.carteId);
        if (!c) { non(`carte absente (${x.carteId})`); continue; }
        const memes = (c.images || []).filter(m => m && m.set === x.set && m.cleR2 === x.cleR2 && num(m.numero) === num(x.numero));
        if (!memes.length) { non(`entrée absente de la carte ${x.carteId} (${x.set} n°${x.numero ?? '-'}, ${x.cleR2}) — déjà retirée, ou la table est périmée`); continue; }
        if (memes.length > 1) { non(`plusieurs entrées (${memes.length}) de même (set, clé, numéro) sur la carte ${x.carteId} : indécidable`); continue; }
        const portees = parCle.get(x.cleR2) || [];
        if (portees.length !== 1) { non(`la clé ${x.cleR2} est portée par ${portees.length} entrées (autre set ou autre carte) : retirer ou marquer par clé en toucherait plusieurs`); continue; }
        if (lot === 'B' && memes[0].imageEmprunteeTirage === true) { non('déjà dans l\'état visé : l\'entrée est déjà marquée imageEmprunteeTirage'); continue; }
        const lesServis = servis.get(x.cleR2) || [];
        if (!lesServis.includes(x.idProduct)) { non(`le produit n'est pas servi par cette entrée aujourd'hui (servis : ${lesServis.join(', ') || 'aucun'}) : état inattendu, déjà dans l'état visé ou table périmée`); continue; }
        const horsTable = lesServis.filter(id => !idsTable.has(id));
        if (horsTable.length) { non(`entrée partagée avec ${horsTable.length} produit(s) hors table : ${horsTable.slice(0, 12).join(', ')}${horsTable.length > 12 ? ', …' : ''} — le geste leur ôterait leur visuel ou leur place dans l'archive : RIEN N'EST ÉCRIT`); continue; }
        if (visees.get(x.cleR2) > 1) { non(`l'entrée (${x.cleR2}) est visée deux fois par la table (produits ${table.filter(t => t.cleR2 === x.cleR2).map(t => t.idProduct).join(', ')}) : une table à deux produits pour une entrée n'est pas écrite`); continue; }
        const subst = lignes.filter(l => l.visuelSubstitut?.cleR2 === x.cleR2);
        if (subst.length) { non(`${subst.length} ligne(s) cartes_produits ont cette clé en substitut (produits ${subst.slice(0, 8).map(l => l.idProduct).join(', ')}) : le retrait les détacherait`); continue; }
        retenues.push({ ...x, entree: memes[0] });
    }
    return { retenues, refus };
}

/** L'état APRÈS le geste, en mémoire : un tableau de cartes dont seules celles touchées sont copiées. Ne modifie JAMAIS l'état reçu. */
function appliquer({ cartes }, lot, table) {
    if (lot !== 'A' && lot !== 'B') throw new Error(`appliquer : lot « ${lot} » inconnu`);
    const parCarte = new Map();
    for (const x of table) { if (!parCarte.has(x.carteId)) parCarte.set(x.carteId, []); parCarte.get(x.carteId).push(x); }
    const vise = (m, x) => m && m.set === x.set && m.cleR2 === x.cleR2 && num(m.numero) === num(x.numero);
    return { cartes: cartes.map(c => {
        const xs = parCarte.get(c._id);
        if (!xs) return c;
        const images = lot === 'A' ? (c.images || []).filter(m => !xs.some(x => vise(m, x))) : (c.images || []).map(m => (xs.some(x => vise(m, x)) ? { ...m, imageEmprunteeTirage: true } : m));
        return { ...c, images };
    }) };
}

const signature = e => JSON.stringify([e.visuel, e.grande?.cle, e.vignette?.cle, e.mention, e.variante, e.produitsPartages, e.partageeHoloNonHolo, e.partageeTamponNonSepare, e.tamponNonRepresente, e.basseDefinition]);
/**
 * Ce que le geste fait à ce que l'API sert : produit par produit, avant / après (sorties de `decider`).
 * ok = les cibles sont TOUTES perdues (plus servies) et AUCUN autre produit n'est perdu, changé ou gagné.
 */
function compareEntrees(avant, apres, cibles) {
    const idx = es => { const m = new Map(); for (const e of es) { if (!m.has(e.idProduct)) m.set(e.idProduct, []); m.get(e.idProduct).push(signature(e)); } return m; };
    const a = idx(avant), b = idx(apres), perdus = [], changes = [], gagnes = [];
    for (const [id, s] of a) { if (!b.has(id)) perdus.push(id); else if (JSON.stringify(s) !== JSON.stringify(b.get(id))) changes.push(id); }
    for (const id of b.keys()) if (!a.has(id)) gagnes.push(id);
    const tri = l => l.sort((x, y) => x - y);
    const cs = new Set(cibles);
    const autresPerdus = tri(perdus.filter(id => !cs.has(id))), autresChanges = tri(changes.filter(id => !cs.has(id)));
    const ok = cibles.every(id => perdus.includes(id)) && !autresPerdus.length && !changes.length && !gagnes.length;
    return { perdus: tri(perdus), changes: tri(changes), gagnes: tri(gagnes), autresPerdus, autresChanges, ok };
}

// ── LES ÉCRITURES
const filtreEntree = x => ({ _id: x.carteId, images: { $elemMatch: { set: x.set, cleR2: x.cleR2, numero: num(x.numero) } } });   // `numero: null` retrouve aussi une entrée SANS le champ

/** Lot B : un `$set` positionnel par cible, borné par (carte, set, clé, numéro) ET par « pas déjà marquée ». Jamais le `$set` d'un tableau. */
function operationsEmprunt(table) {
    return table.map(x => {
        const f = filtreEntree(x);
        f.images.$elemMatch.imageEmprunteeTirage = { $ne: true };
        return { coll: 'cartes', filter: f, update: { $set: { 'images.$.imageEmprunteeTirage': true, 'images.$.imageEmprunteeLot': LOT } } };
    });
}
/** L'annulation EXACTE : seulement les entrées que CE lot a marquées (même marque de lot). */
function operationsAnnulation(table) {
    return table.map(x => {
        const f = filtreEntree(x);
        f.images.$elemMatch.imageEmprunteeTirage = true; f.images.$elemMatch.imageEmprunteeLot = LOT;
        return { coll: 'cartes', filter: f, update: { $unset: { 'images.$.imageEmprunteeTirage': '', 'images.$.imageEmprunteeLot': '' } } };
    });
}
async function ecrireOperations(db, ops, { attendu }, quoi) {
    if (!Number.isInteger(attendu) || attendu !== ops.length) throw new Error(`${quoi} : ${ops.length} écritures, attendu ${attendu} — rien n'est écrit`);
    // chaque cible doit exister UNE fois dans l'état de départ (sinon : « absente ou déjà dans l'état visé »), AVANT la première écriture
    for (const o of ops) { const n = await db.collection(o.coll).countDocuments(o.filter); if (n !== 1) throw new Error(`${quoi} : une cible est absente ou déjà dans l'état visé (${n} document(s) correspondent au lieu de 1) — rien n'est écrit`); }
    let modifiees = 0;
    for (const o of ops) modifiees += (await db.collection(o.coll).updateOne(o.filter, o.update)).modifiedCount;
    if (modifiees !== ops.length) throw new Error(`${quoi} : ${modifiees} entrée(s) modifiée(s) sur ${ops.length} attendue(s) — écriture PARTIELLE, à vérifier`);
    return { modifiees };
}
const ecrireEmprunt = (db, ops, o) => ecrireOperations(db, ops, o, 'emprunt');
const annulerEmprunt = (db, ops, o) => ecrireOperations(db, ops, o, 'annulation');

/** Lot A : la ligne de commande de l'OUTIL EXISTANT (retirer-visuels.js) : les clés EXACTES de la table, et 0 substitut attendu (mesuré : aucune ligne ne vise ces clés). */
function commandeRetrait(table) {
    return ['retirer-visuels.js', `--cles=${table.map(x => x.cleR2).join(',')}`, `--motif=${MOTIF_RETRAIT}`, '--ecrire', '--attendu-substituts=0'];
}

/** `--ecrire` ne tourne que SOUS lot-additif.js (sauvegarde, garde avant/après, contrat de l'API, restauration) : il pose LOT_ADDITIF_PID = son pid, et la commande en est l'enfant direct. */
function garderSousLot(env, ppid) {
    if (!env || !env.LOT_ADDITIF_PID || env.LOT_ADDITIF_PID !== String(ppid)) throw new Error('--ecrire refusé hors de lot-additif.js : node lot-additif.js --quoi="PHASE 2 lot X" --collections=… --annonce=<annonce.json> -- node corriger-visuels-phase2.js --lot=X --ecrire --attendu=N (rien n\'est écrit)');
}
/** Avant la première écriture : exactement le lot simulé. Rend le message d'arrêt, ou null. */
function motifDArret({ nbRetenues, nbRefus, attendu }) {
    if (nbRefus) return `${nbRefus} refus au plan — rien n'est écrit`;
    if (!Number.isInteger(attendu) || attendu <= 0) return '--attendu absent — rien n\'est écrit';
    if (nbRetenues !== attendu) return `${nbRetenues} cible(s) retenue(s), attendu ${attendu} — rien n'est écrit`;
    return null;
}

module.exports = { LOT, MOTIF_RETRAIT, RETRAIT, EMPRUNT, ECARTES, TABLES, verifierTables, produitsServisParCle, planifier, appliquer, compareEntrees, operationsEmprunt, operationsAnnulation,
    ecrireEmprunt, annulerEmprunt, commandeRetrait, garderSousLot, motifDArret, cleEntree, num };

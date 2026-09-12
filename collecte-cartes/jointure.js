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
const normaliserNom = n => String(n || '').normalize('NFC').toLowerCase().replace(/♂/g, 'm').replace(/♀/g, 'f').replace(/[\s\-'.&:]/g, '');
const chiffresDuNumero = n => { const m = String(n ?? '').match(/\d+/); return m ? String(parseInt(m[0], 10)) : null; };

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
    let attaques = [];
    for (const g of groupes) {
        if (g === 'M') nom += '♂';
        else if (g === 'F') nom += '♀';
        else attaques = g.split('|').map(x => x.trim()).filter(Boolean);
    }
    return { nom, attaques };
}

/**
 * Produits d'une expansion, lus une fois, avec leur numéro s'il existe.
 * @returns {Promise<Array<{idProduct, idExpansion, idMetacard, name, nom, attaques, numero}>>}
 */
async function produitsDeLExpansion(prod, idExpansion) {
    const CP = prod.db.collection('catalogue_produits');
    const NC = prod.db.collection('numeros_cartes');
    const produits = await CP.find({ idExpansion }, { projection: { _id: 0, idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } }).toArray();
    const numeros = await NC.find({ idExpansion }, { projection: { _id: 0, idProduct: 1, numero: 1, slug: 1, variante: 1 } }).toArray();
    const parId = new Map(numeros.map(n => [n.idProduct, n]));
    return produits.map(p => {
        const d = decomposerNomCardmarket(p.name);
        const n = parId.get(p.idProduct);
        return { ...p, nom: d.nom, attaques: d.attaques, numero: n?.numero ?? null, slug: n?.slug ?? null, variante: n?.variante ?? null };
    });
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
        const num = chiffresDuNumero(p.numero);
        if (num) { if (!parNumero.has(num)) parNumero.set(num, []); parNumero.get(num).push(p); }
        const nom = normaliserNom(p.nom);
        if (!parNom.has(nom)) parNom.set(nom, []); parNom.get(nom).push(p);
    }
    const attache = (carte, p, preuve, detail) => {
        lignes.push({ _id: `${carte._id}|${p.idProduct}`, carteId: carte._id, idProduct: p.idProduct, idExpansion: cible.idExpansion, tirage: cible.tirage, preuve, detail, verifieLe: new Date() });
        if (!produitsJoints.has(p.idProduct)) produitsJoints.set(p.idProduct, []);
        produitsJoints.get(p.idProduct).push(carte._id);
    };
    let cartesSansProduit = 0;
    for (const carte of cartes) {
        // L'appartenance au set a DEUX sources : l'impression déclarée sur la page (jpexpansion=…),
        // ou, à défaut, le seul fait que la Setlist du set a lié cette page (cas des énergies de
        // base, dont la page est générique et ne liste pas chaque tirage). La preuve le dit :
        // 'set+…' quand la page le déclare, 'setlist+…' quand seule la liste du set le dit.
        const imp = (carte.impressions || []).find(i => i.tirage === cible.tirage && i.expansion === cible.expansionBulba);
        const source = imp ? 'set' : 'setlist';
        let trouves = [];
        let preuve = null, detail = null;
        const num = imp ? chiffresDuNumero(imp.numero) : null;
        if (num && parNumero.size) {
            trouves = parNumero.get(num) || [];
            preuve = 'set+numero'; detail = `n°${imp.numero} dans l'expansion ${cible.idExpansion}`;
        }
        if (!trouves.length && carte.nomEn) {
            // Énergies : « Basic Fire Energy » chez Bulbapedia, « Fire Energy » chez Cardmarket.
            const clesNom = [...new Set([normaliserNom(carte.nomEn), normaliserNom(String(carte.nomEn).replace(/^Basic\s+/i, ''))])];
            for (const k of clesNom) { trouves = parNom.get(k) || []; if (trouves.length) break; }
            if (trouves.length) {
                const noms = new Set((carte.attaques || []).map(a => normaliserNom(a.nom)));
                const concordants = trouves.filter(p => p.attaques.length && p.attaques.every(a => noms.has(normaliserNom(a))));
                if (concordants.length && concordants.length < trouves.length) trouves = concordants;
                const avecAttaques = trouves.every(p => p.attaques.length && p.attaques.every(a => noms.has(normaliserNom(a))));
                preuve = `${source}+nom${avecAttaques ? '+attaques' : ''}`;
                detail = `nom « ${carte.nomEn} »${avecAttaques ? ' + attaques ' + trouves[0].attaques.join(' | ') : ''} dans l'expansion ${cible.idExpansion}${imp ? '' : ' (appartenance par la Setlist seule)'}`;
            }
        }
        if (!trouves.length) {
            restes.push({ type: 'carte-sans-produit', carteId: carte._id, detail: `« ${carte.nomEn ?? carte.bulba?.titre} » n°${imp?.numero ?? '—'} : aucun produit dans l'expansion ${cible.idExpansion}${imp ? '' : ' (page sans impression déclarée pour ce set)'}` });
            cartesSansProduit++; continue;
        }
        for (const p of trouves) attache(carte, p, preuve, detail);
    }
    for (const p of produits) {
        const c = produitsJoints.get(p.idProduct);
        if (!c) restes.push({ type: 'produit-sans-carte', idProduct: p.idProduct, detail: `${p.idProduct} « ${p.name} » n°${p.numero ?? '—'}` });
        else if (c.length > 1) restes.push({ type: 'produit-vers-plusieurs-cartes', idProduct: p.idProduct, detail: `${p.idProduct} « ${p.name} » -> cartes ${c.join(', ')}` });
    }
    return {
        lignes, restes,
        compte: { cartes: cartes.length, produits: produits.length, lignes: lignes.length, produitsJoints: produitsJoints.size, cartesSansProduit, restes: restes.length }
    };
}

module.exports = { joindre, produitsDeLExpansion, decomposerNomCardmarket, normaliserNom, chiffresDuNumero };

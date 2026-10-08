// ============================================================
// LE TÉMOIN DU NOM DANS LA JOINTURE DES IMAGES artofpkm — une définition, pour le worker ET le rejeu
// ============================================================
// 🔴 L'AUDIT DU 2026-10-08 : `joindreImages` retient pour candidates les cartes du slug ET du `deck` ; le nom de l'image ne servait
// qu'en départage. Aucune carte hors slug ou d'un autre deck ne pouvait contredire un numéro : 5 visuels d'AUTRES cartes posés
// (Intro Pack 28/25, 28/27, 28/40 — la liste 28 numérote DEUX decks —, Premium Trainer Box ex 538/8 ; le 478/323 est traité plus bas).
// « 0 ambigu ne veut pas dire 0 faux » : le numéro désigne UNE carte, le nom — qui n'entre pas dans la clé — dit si c'est la bonne.
//
// LA RÈGLE, écrite par ce qu'elle AUTORISE à refuser (une contradiction à deux données indépendantes, jamais un seuil) :
//   refus  ⇔  le nom de l'image n'est pas celui de la porteuse (`temoinDuNom` de jointure.js — la fonction de `joindre()`, jamais
//              une copie)  ET  il EST celui d'une AUTRE carte qui déclare le MÊME (tirage, expansion, numéro), de n'importe quel deck,
//              slug ou non  ET  le nom japonais de la source ne concorde pas avec celui de la porteuse (s'il concorde, le nom anglais
//              de la source est faux : カプ・テテフ nommée « Tapu Fini », §54/§55 — un témoin ne vaut que sa donnée).
// DEUXIÈME RÈGLE, pour le numéro SANS CHIFFRE (« SV-P ») où aucun témoin au même numéro n'existe : refus quand le nom anglais ET le
// nom japonais de l'image n'ont RIEN en commun avec la porteuse (478/323 : un Stade sur Teal Mask Ogerpon). CALIBRÉE (§22) : sur 1 096
// entrées artofpkm à numéro sans chiffre, 1 refus, 0 visuel juste perdu. La même règle étendue aux numéros chiffrés (noms disjoints sans
// témoin) refuserait 8 entrées de plus dont 1 juste (Thunderclap Spark 072) : NON câblée, mesure dans le rapport du lot.
// Les cartes hors slug / d'un autre deck sont TÉMOINS, JAMAIS receveuses (comme `peutRecevoir` chez TCGdex, 387a731) : ce module
// ne répond que sur la porteuse qu'on lui soumet.
// ⚪ Le témoin se TAIT quand le nom ne désigne aucune carte au même numéro (écart de forme, traduction) : la jointure passe.
const { temoinDuNom, cleNumero, normaliserNom } = require('./jointure');

const REGLE_NOM = 'nom-contredit-par-une-carte-au-meme-numero';
const REGLE_PLACEHOLDER = 'numero-sans-chiffre-et-noms-disjoints';
const aucunChiffre = n => n != null && String(n).trim() !== '' && !/\d/.test(String(n));
// mots génériques qui ne désignent pas une carte : « Energy », « ex », « Mega »… ne comptent pas comme « mot en commun »
const GENERIQUES = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'energy', 'mega', 'm', 'basic', 'lv', 'x', 'star', 'break', 'prime', 'legend', 'the', 'of', 's', 'and', 'tag', 'team']);
const motsEn = s => new Set(String(s ?? '').toLowerCase().replace(/[^a-z0-9À-ɏ ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !GENERIQUES.has(w)));
const partageUnMot = (a, b) => { const B = motsEn(b); return [...motsEn(a)].some(w => B.has(w)); };
// bigrammes de caractères japonais (hors latin, ponctuation et catégories génériques) : « partagent des kana » = au moins un bigramme commun
const bigrammesJa = s => {
    const t = String(s ?? '').replace(/[A-Za-z0-9\s{}\[\]［］＆&♢☆ー・\-'’?？!！.,:()（）δ]/g, '').replace(/エネルギー|ポケモン|サポート|グッズ|スタジアム/g, '');
    const r = new Set(); for (let i = 0; i + 2 <= t.length; i++) r.add(t.slice(i, i + 2)); return r;
};
const partageDuJa = (a, b) => { const B = bigrammesJa(b), A = bigrammesJa(a); return !A.size || !B.size || [...A].some(x => B.has(x)); };   // rien à comparer = pas de preuve de divergence

/**
 * @param {{ligne: {bulba: {expansion: string|string[], tirage?: string}}, cartes: object[]}} o
 *        `cartes` : TOUTES les cartes qui déclarent l'impression (slug ou non, deck ou non) — `filtreCartesDuSet`.
 * @returns {(im: object, carte: object) => null|{regle: string, raison: string, autres: object[], ja: string}}
 */
function fabriquerTemoinImages({ ligne, cartes }) {
    const tirage = ligne.bulba.tirage || 'jp';
    const expansions = [].concat(ligne.bulba.expansion);
    const dec = c => (c.impressions || []).filter(i => i.tirage === tirage && expansions.includes(i.expansion));
    const concernees = cartes.filter(c => dec(c).length);
    const temoin = temoinDuNom(concernees);
    const numerosDe = c => new Set(dec(c).map(i => cleNumero(i.numero)).filter(Boolean));
    return (im, carte) => {
        if (!im?.nomEn || !carte) return null;
        // NUMÉRO SANS CHIFFRE (« SV-P », placeholder des deux côtés) : le numéro ne désigne rien, aucune carte « au même numéro » ne
        // peut témoigner (478/323 : Stade « Paradise Resort » posé sur Teal Mask Ogerpon, aucun témoin en base). Le nom est alors la
        // seule clé : refus quand les DEUX noms (anglais ET japonais, tous deux présents) n'ont rien en commun. Étroit par construction.
        if (aucunChiffre(im.numero)) {
            if (!im.nomJa || !carte.nomJa) return null;
            if (partageUnMot(im.nomEn, carte.nomEn) || partageDuJa(im.nomJa, carte.nomJa)) return null;
            return { regle: REGLE_PLACEHOLDER, autres: [], ja: 'diverge', raison: `numéro « ${im.numero} » sans chiffre ; l'image s'appelle « ${im.nomEn} » / « ${im.nomJa} », la porteuse ${carte._id} « ${carte.nomEn} » / « ${carte.nomJa} » : aucun mot ni kana en commun` };
        }
        const k = cleNumero(im.numero);
        if (!k) return null;
        const autres = temoin(carte, { nom: im.nomEn, attaques: [] });
        if (!autres) return null;
        const auMemeNumero = autres.filter(a => numerosDe(a).has(k));
        if (!auMemeNumero.length) return null;
        // le nom japonais de la source concorde avec la porteuse : l'anglais est une étiquette fausse, l'image est la bonne
        const jaSource = normaliserNom(im.nomJa), jaCarte = normaliserNom(carte.nomJa);
        if (jaSource && jaCarte && jaSource === jaCarte) return null;
        return { regle: REGLE_NOM, autres: auMemeNumero, ja: jaSource && jaCarte ? 'diverge' : 'absent',
            raison: `l'image s'appelle « ${im.nomEn} » ; la porteuse ${carte._id} s'appelle « ${carte.nomEn} » ; ${auMemeNumero.map(a => `${a._id} « ${a.nomEn} »`).join(', ')} déclare${auMemeNumero.length > 1 ? 'nt' : ''} le même numéro` };
    };
}

/**
 * Sépare les jointures résolues (passe 1) en gardées et contredites. `temoin` null : rien ne change.
 * @param {{im: object, c: object, carteId: *, preuve: string}[]} resolues
 */
function appliquerTemoin(resolues, temoin) {
    if (!temoin) return { gardees: resolues, contredites: [] };
    const gardees = [], contredites = [];
    for (const r of resolues) {
        const verdict = r.preuve && /^correction/.test(r.preuve) ? null : temoin(r.im, r.c);   // une correction LUE À L'ŒIL n'est pas rejugée
        (verdict ? contredites.push({ ...r, verdict }) : gardees.push(r));
    }
    return { gardees, contredites };
}

module.exports = { fabriquerTemoinImages, appliquerTemoin, REGLE_NOM, REGLE_PLACEHOLDER };

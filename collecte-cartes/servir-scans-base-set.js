'use strict';
// ============================================================
// SERVIR LE SCAN UNLIMITED SANS TAMPON À LA PLACE DU SCAN « EDITION 1 » — 48 fiches Base-Set, liste FERMÉE, feu vert NOMMÉ de l'éditeur, 2026-10-27 (après-midi)
// ============================================================
// Les 69 Pokémon de Base-Set (n° 1-69) servaient un scan « Edition 1 » (mesuré le 27/10 au matin, zones recadrées). Pour 48 d'entre eux, un scan SANS tampon est déjà
// archivé (document `images` de la même carte, même numéro, état « ok », écarté par la préséance du scan anglais). Feu vert de l'éditeur, avec sa condition :
// « le scan doit correspondre au tirage du produit. Bordure avec ou sans ombre (Shadowless contre Unlimited) vérifiée à l'image, sinon pas d'écriture ».
// LU À L'IMAGE (27/10, S8\MARQUEURS\base-set-tirages\ombre-1..4.png, p01..p08.png) : les 48 scans candidats portent l'OMBRE portée du cadre d'illustration (Unlimited) et
// aucun tampon ; chaque fiche sert un produit Unlimited (V1, ombre lue sur sa vignette) et un produit Shadowless (V2, étiquette « Shadowless » sur sa vignette, sans ombre).
// Le scan correspond donc au tirage des produits `unlimited` de la ligne ; les produits `shadowless` sont nommés pour que le service ne leur donne pas ce scan comme le leur.
// Les n° 8 et 18 (scan candidat tamponné) et les 19 sans scan candidat ne sont PAS dans la liste : ils gardent leur scan « Edition 1 ».
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE — une fiche n'est servie que si TOUT ceci est vrai :
//   · la carte existe et porte EXACTEMENT une entrée (Base-Set, numéro de la ligne) : celle du scan « Edition 1 » (cleTcgdex), source tcgdex, numéro de la ligne ;
//   · elle ne porte pas déjà le scan candidat (sinon : « déjà servi ») ;
//   · le document `images` du scan servi existe, UN SEUL, source tcgdex, même carte, même numéro, à l'état « ok » ;
//   · le document `images` du scan candidat existe, UN SEUL, source bulbapedia, même carte, Base-Set, même numéro, à l'état « ok », avec sha256, w, h ;
// sinon refus nommé, et rien n'est écrit pour cette fiche.
// ÉCRITURE : `$pull` de l'entrée « Edition 1 », `$push` de l'entrée du scan candidat construite par la règle de la jointure (collecteur-images-bulba.js::entreeBulba, §21 bis),
// et le document « Edition 1 » passe à `etat: 'retire'` avec `retrait` (forme du collecteur du scan anglais) : une recollecte le saute (même adresse, déjà téléchargé) et sa
// jointure ne lit que les documents « ok » ; la jointure du scan candidat ne le saute plus (le numéro n'est plus servi par le scan anglais). Les objets R2 ne sont PAS effacés.
const { entreeBulba } = require('../collecteur-images-bulba');

const SET = 'Base-Set';
const PREUVE = 'scan sans tampon « Edition 1 » et à ombre portée du cadre d\'illustration (tirage Unlimited), lu à l\'image le 2026-10-27 ; le produit Unlimited de la fiche porte la même ombre sur sa vignette ; feu vert nommé de l\'éditeur du 2026-10-27';
const MOTIF_RETRAIT = 'scan « Edition 1 » remplacé par le scan Unlimited sans tampon de la même carte et du même numéro (feu vert nommé de l\'éditeur, 2026-10-27)';

const L = (numero, carteId, nom, cleTcgdex, cleBulba, unlimited, shadowless) => Object.freeze({ numero, carteId, nom, cleTcgdex, cleBulba, unlimited: Object.freeze(unlimited), shadowless: Object.freeze(shadowless) });
const LISTE = Object.freeze([
    L('1', 15295, 'Alakazam', 'tcgdex/Base-Set/1-15295.webp', 'bulbapedia/Base-Set/1-15295.webp', [273696], [660227]),
    L('3', 15374, 'Chansey', 'tcgdex/Base-Set/3-15374.webp', 'bulbapedia/Base-Set/3-15374.webp', [273698], [660225]),
    L('4', 60348, 'Charizard', 'tcgdex/Base-Set/4-60348.webp', 'bulbapedia/Base-Set/4-60348.webp', [273699], [660224]),
    L('5', 15358, 'Clefairy', 'tcgdex/Base-Set/5-15358.webp', 'bulbapedia/Base-Set/5-15358.webp', [273700], [660223]),
    L('6', 15271, 'Gyarados', 'tcgdex/Base-Set/6-15271.webp', 'bulbapedia/Base-Set/6-15271.webp', [273701], [660222]),
    L('7', 15348, 'Hitmonchan', 'tcgdex/Base-Set/7-15348.webp', 'bulbapedia/Base-Set/7-15348.webp', [273702], [660221]),
    L('9', 15278, 'Magneton', 'tcgdex/Base-Set/9-15278.webp', 'bulbapedia/Base-Set/9-15278.webp', [273704], [660219]),
    L('11', 15208, 'Nidoking', 'tcgdex/Base-Set/11-15208.webp', 'bulbapedia/Base-Set/11-15208.webp', [273706], [660217]),
    L('12', 15219, 'Ninetales', 'tcgdex/Base-Set/12-15219.webp', 'bulbapedia/Base-Set/12-15219.webp', [273707], [660216]),
    L('13', 15244, 'Poliwrath', 'tcgdex/Base-Set/13-15244.webp', 'bulbapedia/Base-Set/13-15244.webp', [273708], [660215]),
    L('14', 15276, 'Raichu', 'tcgdex/Base-Set/14-15276.webp', 'bulbapedia/Base-Set/14-15276.webp', [273709], [660214]),
    L('19', 15316, 'Dugtrio', 'tcgdex/Base-Set/19-15316.webp', 'bulbapedia/Base-Set/19-15316.webp', [273714], [660209]),
    L('30', 60377, 'Ivysaur', 'tcgdex/Base-Set/30-60377.webp', 'bulbapedia/Base-Set/30-60377.webp', [273725], [660198]),
    L('31', 15307, 'Jynx', 'tcgdex/Base-Set/31-15307.webp', 'bulbapedia/Base-Set/31-15307.webp', [273726], [660197]),
    L('32', 15294, 'Kadabra', 'tcgdex/Base-Set/32-15294.webp', 'bulbapedia/Base-Set/32-15294.webp', [273727], [660196]),
    L('33', 60457, 'Kakuna', 'tcgdex/Base-Set/33-60457.webp', 'bulbapedia/Base-Set/33-60457.webp', [273728], [660195]),
    L('34', 15343, 'Machoke', 'tcgdex/Base-Set/34-15343.webp', 'bulbapedia/Base-Set/34-15343.webp', [273729], [660194]),
    L('36', 15234, 'Magmar', 'tcgdex/Base-Set/36-15234.webp', 'bulbapedia/Base-Set/36-15234.webp', [273731], [660192]),
    L('37', 15207, 'Nidorino', 'tcgdex/Base-Set/37-15207.webp', 'bulbapedia/Base-Set/37-15207.webp', [273732], [660191]),
    L('38', 15243, 'Poliwhirl', 'tcgdex/Base-Set/38-15243.webp', 'bulbapedia/Base-Set/38-15243.webp', [273733], [660190]),
    L('39', 15376, 'Porygon', 'tcgdex/Base-Set/39-15376.webp', 'bulbapedia/Base-Set/39-15376.webp', [273734], [660189]),
    L('40', 15354, 'Raticate', 'tcgdex/Base-Set/40-15354.webp', 'bulbapedia/Base-Set/40-15354.webp', [273735], [660188]),
    L('41', 15246, 'Seel', 'tcgdex/Base-Set/41-15246.webp', 'bulbapedia/Base-Set/41-15246.webp', [273736], [660187]),
    L('42', 15236, 'Wartortle', 'tcgdex/Base-Set/42-15236.webp', 'bulbapedia/Base-Set/42-15236.webp', [273737], [660186]),
    L('43', 15293, 'Abra', 'tcgdex/Base-Set/43-15293.webp', 'bulbapedia/Base-Set/43-15293.webp', [273738], [660185]),
    L('45', 60299, 'Caterpie', 'tcgdex/Base-Set/45-60299.webp', 'bulbapedia/Base-Set/45-60299.webp', [273740], [660183]),
    L('46', 15215, 'Charmander', 'tcgdex/Base-Set/46-15215.webp', 'bulbapedia/Base-Set/46-15215.webp', [273741, 547241], [660182]),
    L('48', 15367, 'Doduo', 'tcgdex/Base-Set/48-15367.webp', 'bulbapedia/Base-Set/48-15367.webp', [273743], [660180]),
    L('49', 60434, 'Drowzee', 'tcgdex/Base-Set/49-60434.webp', 'bulbapedia/Base-Set/49-60434.webp', [273744], [660179]),
    L('50', 15296, 'Gastly', 'tcgdex/Base-Set/50-15296.webp', 'bulbapedia/Base-Set/50-15296.webp', [273745], [660178]),
    L('52', 15317, 'Machop', 'tcgdex/Base-Set/52-15317.webp', 'bulbapedia/Base-Set/52-15317.webp', [273747], [660176]),
    L('53', 15277, 'Magnemite', 'tcgdex/Base-Set/53-15277.webp', 'bulbapedia/Base-Set/53-15277.webp', [273748], [660175]),
    L('54', 15200, 'Metapod', 'tcgdex/Base-Set/54-15200.webp', 'bulbapedia/Base-Set/54-15200.webp', [273749], [660174]),
    L('55', 15206, 'Nidoran♂', 'tcgdex/Base-Set/55-15206.webp', 'bulbapedia/Base-Set/55-15206.webp', [273750], [660173]),
    L('56', 60178, 'Onix', 'tcgdex/Base-Set/56-60178.webp', 'bulbapedia/Base-Set/56-60178.webp', [273751], [660172]),
    L('57', 15351, 'Pidgey', 'tcgdex/Base-Set/57-15351.webp', 'bulbapedia/Base-Set/57-15351.webp', [273752], [660171]),
    L('58', 15274, 'Pikachu', 'tcgdex/Base-Set/58-15274.webp', 'bulbapedia/Base-Set/58-15274.webp', [273753, 275568, 275586, 362859], [660169, 660170]),
    L('59', 15239, 'Poliwag', 'tcgdex/Base-Set/59-15239.webp', 'bulbapedia/Base-Set/59-15239.webp', [273754], [660168]),
    L('60', 15233, 'Ponyta', 'tcgdex/Base-Set/60-15233.webp', 'bulbapedia/Base-Set/60-15233.webp', [273755], [660167]),
    L('61', 15353, 'Rattata', 'tcgdex/Base-Set/61-15353.webp', 'bulbapedia/Base-Set/61-15353.webp', [273756], [660166]),
    L('62', 15311, 'Sandshrew', 'tcgdex/Base-Set/62-15311.webp', 'bulbapedia/Base-Set/62-15311.webp', [273757], [660165]),
    L('63', 15235, 'Squirtle', 'tcgdex/Base-Set/63-15235.webp', 'bulbapedia/Base-Set/63-15235.webp', [273758, 547246], [660164]),
    L('64', 15249, 'Starmie', 'tcgdex/Base-Set/64-15249.webp', 'bulbapedia/Base-Set/64-15249.webp', [273759], [660163]),
    L('65', 15248, 'Staryu', 'tcgdex/Base-Set/65-15248.webp', 'bulbapedia/Base-Set/65-15248.webp', [273760], [660162]),
    L('66', 15211, 'Tangela', 'tcgdex/Base-Set/66-15211.webp', 'bulbapedia/Base-Set/66-15211.webp', [273761], [660161]),
    L('67', 15279, 'Voltorb', 'tcgdex/Base-Set/67-15279.webp', 'bulbapedia/Base-Set/67-15279.webp', [273762], [660160]),
    L('68', 15218, 'Vulpix', 'tcgdex/Base-Set/68-15218.webp', 'bulbapedia/Base-Set/68-15218.webp', [273763], [660159]),
    L('69', 15201, 'Weedle', 'tcgdex/Base-Set/69-15201.webp', 'bulbapedia/Base-Set/69-15201.webp', [273764], [660158])
]);

const duNumero = (c, numero) => (c?.images || []).filter(i => i && i.set === SET && String(i.numero) === String(numero));
const porte = (c, cle) => (c?.images || []).filter(i => i && i.set === SET && i.cleR2 === cle);

/**
 * Lecture seule. @returns {Promise<{aServir:{entree, servie:object, candidat:object}[], aFinir:{entree}[], refus:{entree, raison:string}[]}>}
 * `aFinir` : une reprise — la carte sert déjà le scan candidat, mais le document « Edition 1 » est encore « ok » (arrêt entre les deux boucles de `servir`).
 */
async function simuler(db, liste = LISTE) {
    const aServir = [], aFinir = [], refus = [];
    for (const entree of liste) {
        const no = raison => refus.push({ entree, raison });
        const carte = await db.collection('cartes').findOne({ _id: entree.carteId });
        if (!carte) { no(`carte absente : ${entree.carteId}`); continue; }
        const aT = porte(carte, entree.cleTcgdex), aB = (carte.images || []).filter(i => i && i.cleR2 === entree.cleBulba);
        if (aT.length && aB.length) { no(`les deux scans : la carte porte ${entree.cleTcgdex} ET ${entree.cleBulba}`); continue; }
        if (!aT.length && aB.length === 1 && aB[0].set === SET) {
            const dT = await db.collection('images').find({ cleR2: entree.cleTcgdex }).toArray();
            if (dT.length === 1 && dT[0].source === 'tcgdex' && dT[0].carteId === entree.carteId && dT[0].etat === 'retire') no('déjà servi : la carte porte le scan candidat, le document « Edition 1 » est retiré');
            else if (dT.length === 1 && dT[0].source === 'tcgdex' && dT[0].carteId === entree.carteId && dT[0].etat === 'ok') aFinir.push({ entree });
            else no(`document servi : ${dT.length} document(s), ${JSON.stringify(dT.map(d => [d.source, d.carteId, d.numero, d.etat]))}`);
            continue;
        }
        const memes = duNumero(carte, entree.numero);
        if (memes.length !== 1) { no(`entrées Base-Set : ${memes.length} au n° ${entree.numero} au lieu d'exactement une`); continue; }
        const servie = memes[0];
        if (servie.cleR2 !== entree.cleTcgdex || servie.source !== 'tcgdex') { no(`entrée servie : ${servie.source} ${servie.cleR2} au lieu de ${entree.cleTcgdex}`); continue; }
        const dT = await db.collection('images').find({ cleR2: entree.cleTcgdex }).toArray();
        if (dT.length !== 1 || dT[0].source !== 'tcgdex' || dT[0].carteId !== entree.carteId || String(dT[0].numero) !== entree.numero || dT[0].etat !== 'ok') { no(`document servi : ${dT.length} document(s), ${JSON.stringify(dT.map(d => [d.source, d.carteId, d.numero, d.etat]))}`); continue; }
        const dB = await db.collection('images').find({ cleR2: entree.cleBulba }).toArray();
        const b = dB[0];
        if (dB.length !== 1 || b.source !== 'bulbapedia' || b.carteId !== entree.carteId || b.set !== SET || String(b.numero) !== entree.numero || b.etat !== 'ok' || !b.sha256 || !b.w || !b.h) { no(`document candidat : ${dB.length} document(s), ${JSON.stringify(dB.map(d => [d.source, d.carteId, d.set, d.numero, d.etat]))}`); continue; }
        aServir.push({ entree, servie, candidat: b });
    }
    return { aServir, aFinir, refus };
}

// La sauvegarde garde les TYPES (une Date reste une Date : `jointeLe`, `telechargeLe`) — même forme que la sauvegarde de lot (EJSON canonique)
const { EJSON } = require('mongodb').BSON;
const ecrireSauvegarde = o => EJSON.stringify(o, null, 1, { relaxed: false });
const lireSauvegarde = texte => EJSON.parse(texte, { relaxed: true });   // relu « relaxed » : les dates redeviennent des Date, les nombres des nombres natifs (pas des Int32)

/** L'annonce des baisses pour lot-additif : aucune — une entrée en remplace une (images du set égal) et la vignette du scan servi est fabriquée dans le même lot. */
function annonce() { return {}; }

/**
 * Écrit le plan, en DEUX boucles (relecture du 27/10) : toutes les cartes d'abord — l'entrée « Edition 1 » est REMPLACÉE EN PLACE par le scan servi, en une seule opération
 * (jamais une carte sans visuel entre un $pull et un $push) — puis seulement les documents « Edition 1 » passent à « retire ». Un arrêt laisse donc au pire des cartes servies
 * dont le document est encore « ok » : la simulation suivante les rend dans `aFinir`, et une relance les termine.
 * La sauvegarde (entrées retirées entières, en EJSON) est écrite AVANT la première écriture et n'écrase jamais un fichier existant. @returns {Promise<number>} fiches terminées
 */
async function servir(db, plan, { sauvegarde, ecrireTexte = (f, t) => require('fs').writeFileSync(f, t), maintenant = new Date() } = {}) {
    if (!sauvegarde) throw new Error('écrire exige une sauvegarde (--sauvegarde=<f>.json) : rien n\'est écrit');
    if (require('fs').existsSync(sauvegarde)) throw new Error(`la sauvegarde ${sauvegarde} existe déjà : rien n'est écrit (choisir un nouveau fichier)`);
    const aFinir = plan.aFinir || [];
    if (!plan.aServir.length && !aFinir.length) return 0;
    ecrireTexte(sauvegarde, ecrireSauvegarde({ le: maintenant, quoi: 'entrées cartes.images « Edition 1 » remplacées en place (servir-scans-base-set.js) ; documents images passés à « retire »',
        lignes: plan.aServir.map(x => ({ carteId: x.entree.carteId, numero: x.entree.numero, cleTcgdex: x.entree.cleTcgdex, cleBulba: x.entree.cleBulba, entreeRetiree: x.servie })),
        reprises: aFinir.map(x => ({ carteId: x.entree.carteId, numero: x.entree.numero, cleTcgdex: x.entree.cleTcgdex })) }));
    for (const { entree: e, candidat } of plan.aServir) {
        const r = await db.collection('cartes').updateOne({ _id: e.carteId, images: { $elemMatch: { set: SET, cleR2: e.cleTcgdex } }, 'images.cleR2': { $ne: e.cleBulba } },
            { $set: { 'images.$[e]': entreeBulba(SET, candidat, maintenant) } }, { arrayFilters: [{ 'e.set': SET, 'e.cleR2': e.cleTcgdex }] });
        if (!r.modifiedCount) throw new Error(`carte ${e.carteId} : entrée ${e.cleTcgdex} introuvable ou scan ${e.cleBulba} déjà présent à l'écriture — arrêt (la simulation suivante dit où l'on en est)`);
    }
    let n = 0;
    for (const { entree: e } of [...plan.aServir, ...aFinir]) {
        const d = await db.collection('images').updateOne({ cleR2: e.cleTcgdex, source: 'tcgdex', etat: 'ok' }, { $set: { etat: 'retire', retrait: { le: maintenant, motif: MOTIF_RETRAIT, etatAvant: 'ok', remplacePar: { source: 'bulbapedia', cleR2: e.cleBulba } } } });
        if (!d.modifiedCount) throw new Error(`carte ${e.carteId} : document ${e.cleTcgdex} introuvable à l'état ok — arrêt (la simulation suivante dit où l'on en est)`);
        n++;
    }
    return n;
}

/**
 * Remet l'entrée « Edition 1 » sauvegardée À SA PLACE (remplacement en place du scan servi) et repasse son document à `ok`. REPRENABLE étape par étape : une carte déjà
 * rendue n'est pas réécrite, un document déjà « ok » non plus ; tout autre état arrête.
 */
async function restaurer(db, sauvegardee, { ecrire = false, attendu } = {}) {
    const lignes = sauvegardee?.lignes;
    if (!Array.isArray(lignes) || !lignes.length) throw new Error('sauvegarde sans ligne : rien à restaurer');
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--restaurer --ecrire exige --attendu=<N> : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== lignes.length) throw new Error(`--attendu=${attendu} mais ${lignes.length} ligne(s) dans la sauvegarde : rien n'est écrit`);
    if (!ecrire) return { lignes: lignes.length };
    for (const l of lignes) {
        const c = await db.collection('cartes').findOne({ _id: l.carteId });
        const aB = porte(c, l.cleBulba).length, aT = porte(c, l.cleTcgdex).length;
        if (aB === 1 && !aT) {
            const r = await db.collection('cartes').updateOne({ _id: l.carteId, images: { $elemMatch: { set: SET, cleR2: l.cleBulba } }, 'images.cleR2': { $ne: l.cleTcgdex } },
                { $set: { 'images.$[e]': l.entreeRetiree } }, { arrayFilters: [{ 'e.set': SET, 'e.cleR2': l.cleBulba }] });
            if (!r.modifiedCount) throw new Error(`carte ${l.carteId} : le remplacement inverse n'a rien écrit — arrêt`);
        } else if (!(aT === 1 && !aB)) throw new Error(`carte ${l.carteId} : état inattendu (scan servi ${aB}, « Edition 1 » ${aT}) — arrêt`);
        const d = await db.collection('images').findOne({ cleR2: l.cleTcgdex, source: 'tcgdex' });
        if (d?.etat === 'retire') {
            const u = await db.collection('images').updateOne({ cleR2: l.cleTcgdex, source: 'tcgdex', etat: 'retire' }, { $set: { etat: 'ok' }, $unset: { retrait: '' } });
            if (!u.modifiedCount) throw new Error(`carte ${l.carteId} : document ${l.cleTcgdex} non rendu — arrêt`);
        } else if (d?.etat !== 'ok') throw new Error(`carte ${l.carteId} : document ${l.cleTcgdex} à l'état « ${d?.etat} » — arrêt`);
    }
    let rendues = 0;
    for (const l of lignes) {
        const c = await db.collection('cartes').findOne({ _id: l.carteId }), d = await db.collection('images').findOne({ cleR2: l.cleTcgdex, source: 'tcgdex' });
        if (porte(c, l.cleTcgdex).length === 1 && !porte(c, l.cleBulba).length && d?.etat === 'ok') rendues++;
    }
    return { lignes: lignes.length, relu: { rendues } };
}

// ── LA LANGUE LUE À L'IMAGE (2026-10-27, après le lot) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// La règle de langue du site (rat-market-site/lib/langueDuVisuel.ts, importée par le contrat de l'API) refuse sur un set international un scan à `langue: null` dont le format
// du fichier source n'est pas dans ses formats audités : 47 produits des 48 fiches ont basculé sur le visuel d'un autre tirage (45) ou sur rien (Porygon, 2). Les 48 scans ont été
// REGARDÉS (S8\MARQUEURS\base-set-tirages\p01..p08.png) : texte anglais sur chacun. La langue lue s'écrit sur le DOCUMENT (la jointure rejouée la reprend : langue-visuel.js
// `langueDeLEntree`) ET sur l'entrée servie. Par ce qu'elle autorise : seulement sur un scan SERVI de la liste, dont la langue est absente, `null` ou déjà « en » ; jamais par-dessus une autre langue.
const LANGUE_LUE = Object.freeze({ langue: 'en', languePreuve: 'texte de la carte lu en anglais à l\'image le 2026-10-27 (scan Unlimited sans tampon, comparé côte à côte avec la vignette du produit)' });
const sansLangueEcrite = v => v === undefined || v === null || v === LANGUE_LUE.langue;

/** Lecture seule. @returns {Promise<{aPoser:{entree, avantDoc, avantEntree}[], deja:{entree}[], refus:{entree, raison}[]}>} */
async function simulerLangue(db, liste = LISTE) {
    const aPoser = [], deja = [], refus = [];
    for (const entree of liste) {
        const no = raison => refus.push({ entree, raison });
        const carte = await db.collection('cartes').findOne({ _id: entree.carteId });
        const servies = porte(carte, entree.cleBulba);
        if (servies.length !== 1 || porte(carte, entree.cleTcgdex).length) { no(`pas servi : la carte porte ${servies.length} entrée(s) du scan candidat`); continue; }
        const docs = await db.collection('images').find({ cleR2: entree.cleBulba }).toArray();
        const d = docs[0];
        if (docs.length !== 1 || d.source !== 'bulbapedia' || d.carteId !== entree.carteId || d.etat !== 'ok') { no(`document candidat : ${docs.length} document(s)`); continue; }
        const e = servies[0];
        if (!sansLangueEcrite(d.langue) || !sansLangueEcrite(e.langue)) { no(`langue déjà écrite : document « ${d.langue} », entrée « ${e.langue} »`); continue; }
        if (d.langue === LANGUE_LUE.langue && e.langue === LANGUE_LUE.langue && d.languePreuve === LANGUE_LUE.languePreuve && e.languePreuve === LANGUE_LUE.languePreuve) { deja.push({ entree }); continue; }
        aPoser.push({ entree, avantDoc: { langue: d.langue, languePreuve: d.languePreuve }, avantEntree: { langue: e.langue, languePreuve: e.languePreuve } });
    }
    return { aPoser, deja, refus };
}

/** Pose la langue lue (document puis entrée) ; sauvegarde des valeurs d'avant écrite AVANT, jamais écrasée. @returns {Promise<number>} */
async function poserLangue(db, plan, { sauvegarde, ecrireTexte = (f, t) => require('fs').writeFileSync(f, t), maintenant = new Date() } = {}) {
    if (!sauvegarde) throw new Error('écrire exige une sauvegarde (--sauvegarde=<f>.json) : rien n\'est écrit');
    if (require('fs').existsSync(sauvegarde)) throw new Error(`la sauvegarde ${sauvegarde} existe déjà : rien n'est écrit (choisir un nouveau fichier)`);
    if (!plan.aPoser.length) return 0;
    ecrireTexte(sauvegarde, ecrireSauvegarde({ le: maintenant, quoi: 'langue lue à l\'image posée sur les scans servis de Base-Set (servir-scans-base-set.js --langue) : valeurs d\'avant',
        lignes: plan.aPoser.map(x => ({ carteId: x.entree.carteId, cleBulba: x.entree.cleBulba, avantDoc: x.avantDoc, avantEntree: x.avantEntree })) }));
    let n = 0;
    for (const { entree: e } of plan.aPoser) {
        const d = await db.collection('images').updateOne({ cleR2: e.cleBulba, source: 'bulbapedia', etat: 'ok' }, { $set: { ...LANGUE_LUE } });
        if (!d.matchedCount) throw new Error(`document ${e.cleBulba} introuvable — arrêt (la simulation suivante dit où l'on en est)`);
        const c = await db.collection('cartes').updateOne({ _id: e.carteId, images: { $elemMatch: { set: SET, cleR2: e.cleBulba } } },
            { $set: { 'images.$[e].langue': LANGUE_LUE.langue, 'images.$[e].languePreuve': LANGUE_LUE.languePreuve } }, { arrayFilters: [{ 'e.set': SET, 'e.cleR2': e.cleBulba }] });
        if (!c.matchedCount) throw new Error(`carte ${e.carteId} : entrée ${e.cleBulba} introuvable — arrêt`);
        n++;
    }
    return n;
}

/** Remet les valeurs d'avant (document et entrée) ; reprenable. */
async function restaurerLangue(db, sauvegardee, { ecrire = false, attendu } = {}) {
    const lignes = sauvegardee?.lignes;
    if (!Array.isArray(lignes) || !lignes.length) throw new Error('sauvegarde sans ligne : rien à restaurer');
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--restaurer --ecrire exige --attendu=<N> : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== lignes.length) throw new Error(`--attendu=${attendu} mais ${lignes.length} ligne(s) dans la sauvegarde : rien n'est écrit`);
    if (!ecrire) return { lignes: lignes.length };
    const remise = (av, prefixe = '') => {
        const $set = {}, $unset = {};
        for (const k of ['langue', 'languePreuve']) (av[k] === undefined ? $unset : $set)[`${prefixe}${k}`] = av[k] === undefined ? '' : av[k];
        return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
    };
    for (const l of lignes) {
        await db.collection('images').updateOne({ cleR2: l.cleBulba, source: 'bulbapedia' }, remise(l.avantDoc));
        await db.collection('cartes').updateOne({ _id: l.carteId, images: { $elemMatch: { set: SET, cleR2: l.cleBulba } } }, remise(l.avantEntree, 'images.$[e].'), { arrayFilters: [{ 'e.set': SET, 'e.cleR2': l.cleBulba }] });
    }
    let rendues = 0;
    for (const l of lignes) {
        const d = await db.collection('images').findOne({ cleR2: l.cleBulba, source: 'bulbapedia' }), e = porte(await db.collection('cartes').findOne({ _id: l.carteId }), l.cleBulba)[0];
        if (d?.langue === l.avantDoc.langue && e?.langue === l.avantEntree.langue) rendues++;
    }
    return { lignes: lignes.length, relu: { rendues } };
}

module.exports = { SET, PREUVE, MOTIF_RETRAIT, LISTE, LANGUE_LUE, simuler, annonce, servir, restaurer, simulerLangue, poserLangue, restaurerLangue, lireSauvegarde, ecrireSauvegarde };

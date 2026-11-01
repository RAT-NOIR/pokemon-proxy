'use strict';
// ============================================================
// PRODUITS QUI MÉLANGENT PLUSIEURS VERSIONS, ET VARIANTES INDISCERNABLES (décisions du testeur du 2026-11-01) — module PUR
// ============================================================
// 1. Un produit Cardmarket qui MÉLANGE deux versions (Guzma BUS 115a : Staff + Championship) n'affirme pas une version : on pose les DEUX marqueurs concrets, le visuel de BASE en
//    EMPRUNTÉ (tampon non représenté) et un libellé voulu de 40 caractères au plus. Les marqueurs sont ceux de la liste fermée du contrat (CONTRAT-MARQUEURS.md §3) ; le libellé est
//    rendu par l'API depuis ses gabarits, il n'est donc écrit que DANS LA PREUVE (la demande d'un libellé « mélange » à l'API reste ouverte).
// 2. Des variantes INDISCERNABLES (WCD Twins 2011, WCD Celio's Network 2008 : V1/V2 sans joueur lisible) : pas de version affirmée, visuel EMPRUNTÉ (carte d'origine, motif « autre tirage »
//    déjà admis par l'API pour les WCD), marqueur FINITION_NON_VISIBLE à côté de WCD{année} et NON_LEGAL.
// Aucune écriture ici : ni base, ni fichier, ni requête. L'écriture est dans poser-melanges.js, sous lot-additif.js.
const MQ = require('./marqueurs-etiquettes');
const IE = require('./images-empruntees');
const { cleNumero } = require('./jointure');

const LOT = 'melanges-2026-11';
const DECISION = "2026-11-01, testeur : un produit qui mélange deux versions n'affirme pas une version (marqueurs concrets + visuel de base EMPRUNTÉ) ; les variantes indiscernables reçoivent un visuel EMPRUNTÉ et FINITION_NON_VISIBLE";

// ── 1. mélanges de tampons ────────────────────────────────────────────────────────────────────────────────────────────
// La liste des tampons lus par produit (`tamponsConnus`) vient du relevé du testeur du 18/10 et des fiches sœurs ; un tampon sans type au contrat (« autre ») ne s'écrit jamais.
const TAMPONS = Object.freeze({ staff: ['STAFF'], league: ['LEAGUE'], championship: ['CHAMPIONSHIP'], prerelease: ['PRERELEASE'], 'staff-prerelease': ['STAFF', 'PRERELEASE'] });
const NOM_FR = Object.freeze({ STAFF: 'Staff', LEAGUE: 'Ligue', CHAMPIONSHIP: 'Championship', PRERELEASE: 'Avant-première' });
const NOM_EN = Object.freeze({ STAFF: 'Staff', LEAGUE: 'League', CHAMPIONSHIP: 'Championship', PRERELEASE: 'Prerelease' });
const MAX_LIBELLE = 40;

/** Le libellé voulu : essayé dans l'ordre, la première forme qui tient en 40 caractères ; null si aucune. */
function libelleMelange(types) {
    const ordre = MQ.ordonner(types.map(type => ({ type }))).map(m => m.type);
    const premier = (noms, formes) => formes.map(f => f(noms)).find(s => s.length <= MAX_LIBELLE) ?? null;
    const fr = premier(ordre.map(t => NOM_FR[t]), [n => `${n.join(' ou ')} selon l'exemplaire`, n => `${n.join(' ou ')} (selon copie)`]);
    const en = premier(ordre.map(t => NOM_EN[t]), [n => `${n.join(' or ')} depending on copy`, n => `${n.join(' or ')} (varies)`]);
    return fr && en ? { fr, en } : null;
}

/**
 * @param {{lignes: object[]}} e  lignes `cartes_produits` portant `prixMelangeTampon`, `tamponsConnus`, `prixMelangeTamponPreuve`
 * Un mélange est retenu si : ≥ 2 tampons connus, tous typés au contrat, et une preuve forte (relevé du testeur, ou ≥ 2 lectures). Tout le reste est un refus nommé.
 */
function planMelangesTampons({ lignes }) {
    const cibles = [], refus = [];
    for (const l of lignes || []) {
        if (l.prixMelangeTampon !== true) continue;
        const no = raison => refus.push({ idProduct: l.idProduct, famille: 'MELANGE_TAMPON', raison });
        const connus = [...new Set(l.tamponsConnus || [])];
        if (connus.length < 2) { no(connus.length ? 'un-seul-tampon-connu' : 'tampons-connus-vides'); continue; }
        if (connus.some(c => !TAMPONS[c])) { no('tampon-sans-type'); continue; }
        const temoins = l.prixMelangeTamponPreuve || [];
        const testeur = temoins.some(t => /relevé du testeur/i.test(t));
        if (!testeur && temoins.length < 2) { no('preuve-unique'); continue; }
        const types = MQ.ordonner([...new Set(connus.flatMap(c => TAMPONS[c]))].map(type => ({ type, params: {} })));
        if (types.length < 2) { no('un-seul-type-au-contrat'); continue; }
        const libelle = libelleMelange(types.map(t => t.type));
        if (!libelle) { no('libelle-trop-long'); continue; }
        const date = (temoins.map(t => /relevé du testeur, (\d{4}-\d{2}-\d{2})/.exec(t)).find(Boolean) || [])[1];
        const lecture = testeur ? `relevé du testeur${date ? ` du ${date}` : ''}` : `${temoins.length} lectures concordantes par numéro et nom`;
        cibles.push({ idProduct: l.idProduct, famille: 'MELANGE_TAMPON', marqueurs: types, libelle,
            preuve: `ce produit mélange plusieurs versions (${lecture}) : tampons ${connus.join(' + ')} ; aucune version n'est affirmée, les deux marqueurs sont posés. Libellé voulu (≤ ${MAX_LIBELLE}) : « ${libelle.fr} »` });
    }
    return { cibles, refus };
}

// ── 2. WCD indiscernables ─────────────────────────────────────────────────────────────────────────────────────────────
// Liste FERMÉE (recherches EN du 2026-11-01 : aucune source n'associe un V1/V2 Cardmarket à un joueur ; la fiche Cardmarket est fermée).
const FINITION_WCD = Object.freeze({ 868202: { slugSet: 'WCD-2011', carteId: 108512 }, 868203: { slugSet: 'WCD-2011', carteId: 108512 }, 869299: { slugSet: 'WCD-2008', carteId: 25184 }, 869300: { slugSet: 'WCD-2008', carteId: 25184 },
    // V3 et V4 de Celio's Network : mêmes carte, set et substitut ; l'entrée (carte, set) les sert de toute façon, elles reçoivent donc le même marqueur (non listées dans la chasse du 01/11)
    869301: { slugSet: 'WCD-2008', carteId: 25184 }, 869302: { slugSet: 'WCD-2008', carteId: 25184 } });
function planFinitionWcd({ lignes }) {
    const cibles = [], refus = [];
    const parId = new Map((lignes || []).map(l => [l.idProduct, l]));
    for (const [k, v] of Object.entries(FINITION_WCD)) {
        const id = Number(k), l = parId.get(id);
        const no = raison => refus.push({ idProduct: id, famille: 'FINITION_WCD', raison });
        if (!l) { no('ligne-absente'); continue; }
        const s = /^WCD-(\d{4})$/.exec(String(l.slugSet ?? ''));
        if (!s || l.slugSet !== v.slugSet || l.carteId !== v.carteId) { no('ligne-differente-de-la-liste'); continue; }
        const annee = Number(s[1]);
        cibles.push({ idProduct: id, famille: 'FINITION_WCD', marqueurs: [{ type: 'WCD', params: { annee } }, { type: 'NON_LEGAL', params: {} }, { type: 'FINITION_NON_VISIBLE', params: {} }],
            preuve: `année ${annee} : expansion du produit (${l.slugSet}, World Championships Decks ${annee}) ; variantes V1/V2 indiscernables : aucune source consultée le 2026-11-01 n'associe l'une ou l'autre à un joueur, aucun joueur ni version n'est affirmé` });
    }
    return { cibles, refus };
}

// ── 3. emprunts de visuel ─────────────────────────────────────────────────────────────────────────────────────────────
// Liste FERMÉE par (carte, set, numéro) : tout ce qui n'y figure pas est hors champ. `origine` = l'UNIQUE entrée de la même carte dont on emprunte le fichier.
//   Guzma BUS 115a : visuel de base = l'entrée 115 (scan non tamponné) ; Lusamine UPR 153a (places de League Challenge 2e/3e, déjà prouvées par marqueurs) : base = l'entrée 153 ;
//   WCD : carte d'origine du deck (motif « autre tirage », admission (B) de l'API).
const LISTE_EMPRUNTS = Object.freeze([
    Object.freeze({ produits: Object.freeze([449623]), carteId: 223420, set: 'Burning-Shadows', numero: '115a', origine: Object.freeze({ set: 'Burning-Shadows', numero: '115', cleR2: 'tcgdex/Burning-Shadows/115-223420.webp' }), tampon: 'Staff ou Championship' }),
    Object.freeze({ produits: Object.freeze([449878, 449883]), carteId: 225372, set: 'Ultra-Prism', numero: '153a', origine: Object.freeze({ set: 'Ultra-Prism', numero: '153', cleR2: 'tcgdex/Ultra-Prism/153-225372.webp' }), tampon: 'League Challenge' }),
    Object.freeze({ produits: Object.freeze([868202, 868203]), carteId: 108512, set: 'WCD-2011', numero: null, origine: Object.freeze({ set: 'Triumphant', numero: '89', cleR2: 'tcgdex/Triumphant/89-108512.webp' }), wcd: true }),
    Object.freeze({ produits: Object.freeze([869299, 869300, 869301, 869302]), carteId: 25184, set: 'WCD-2008', numero: null, origine: Object.freeze({ set: 'EX-Crystal-Guardians', numero: '73', cleR2: 'tcgdex/EX-Crystal-Guardians/73-25184.webp' }), wcd: true }),
]);

const entier = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const numeroDeLigne = l => { const s = l.numeroFiche == null ? '' : String(l.numeroFiche).trim(); return s === '' ? null : s; };
const memeNumero = (a, b) => (a == null && b == null) || (a != null && b != null && cleNumero(a) === cleNumero(b));
const copie = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Une entrée du set couvre-t-elle déjà la cible ? Numéro absent : toute entrée du set. Sinon : même numéro (lettre comprise) ou entrée sans numéro. */
function couverte(images, set, numero) {
    const duSet = (images || []).filter(e => e && e.set === set);
    if (numero == null) return duSet.length > 0;
    return duSet.some(e => e.numero == null || String(e.numero).trim() === '' || cleNumero(e.numero) === cleNumero(numero));
}

function planEmprunts({ lignes, cartes, entrees = LISTE_EMPRUNTS, maintenant = new Date() }) {
    const ajouts = [], deja = [], refus = [];
    for (const e of entrees) {
        const no = (raison, plus = {}) => refus.push({ carteId: e.carteId, set: e.set, numero: e.numero, produits: [...e.produits], raison, ...plus });
        const siennes = e.produits.map(id => (lignes || []).find(l => l.idProduct === id));
        if (siennes.some(l => !l)) { no('ligne-absente'); continue; }
        if (siennes.some(l => l.carteId !== e.carteId || l.slugSet !== e.set)) { no('ligne-differente-de-la-liste'); continue; }
        if (siennes.some(l => !memeNumero(numeroDeLigne(l), e.numero))) { no('numero-fiche-different-de-la-liste'); continue; }
        // un emprunt (carte, set, numéro) sert TOUS les produits de la carte à ce numéro : un frère hors liste le recevrait sans que personne ne l'ait accordé.
        // Réponse de l'API (31/10) : `numero` = `numeroFiche` normalisé, ou, fiche SANS numéro, l'entrée unique de la carte dans le set « elle-même sans numéro » : une entrée numérotée ne sert
        // jamais une ligne sans numéro, une entrée sans numéro ne sert que des lignes sans numéro.
        const freres = [...new Set((lignes || []).filter(l => l.carteId === e.carteId && l.slugSet === e.set && !e.produits.includes(l.idProduct)
            && memeNumero(numeroDeLigne(l), e.numero)).map(l => l.idProduct))].sort((a, b) => a - b);
        if (freres.length) { no(`frere-hors-liste (${freres.join(', ')})`, { freres }); continue; }
        const c = cartes.get(e.carteId);
        if (!c) { no('carte-introuvable'); continue; }
        if (couverte(c.images, e.set, e.numero)) { deja.push({ carteId: e.carteId, set: e.set, numero: e.numero, produits: [...e.produits] }); continue; }
        const trouvees = (c.images || []).filter(i => i && i.set === e.origine.set && i.cleR2 === e.origine.cleR2 && cleNumero(i.numero) === cleNumero(e.origine.numero));
        if (trouvees.length !== 1) { no('origine-absente-ou-ambigue'); continue; }
        const o = trouvees[0];
        if (typeof o.langue !== 'string' || !o.langue.trim() || !entier(o.w) || !entier(o.h)) { no('origine-sans-langue-ou-taille'); continue; }
        const entree = { set: e.set, numero: e.numero, cleR2: o.cleR2, w: o.w, h: o.h };
        if (o.vignette && typeof o.vignette === 'object') entree.vignette = copie(o.vignette);
        Object.assign(entree, { langue: o.langue, languePreuve: e.wcd ? IE.LANGUE_PREUVE_WCD : IE.LANGUE_PREUVE, source: IE.SOURCE, lot: LOT, imageEmprunteeTirage: true });
        if (e.wcd) entree.differenceEmprunt = IE.MOTIF_AUTRE_TIRAGE;
        if (e.tampon) entree.tamponNonRepresente = e.tampon;
        Object.assign(entree, { retirable: true, collecteLe: new Date(maintenant), jointeLe: new Date(maintenant) });
        ajouts.push({ carteId: e.carteId, set: e.set, numero: e.numero, produits: [...e.produits], entree });
    }
    return { ajouts, deja, refus };
}

/** Les écritures : un $push gardé (aucune entrée du set — au même numéro ou sans numéro — n'existe). Jamais le $set d'un tableau. */
function operationsEmprunts(plan) {
    return plan.ajouts.map(a => ({
        coll: 'cartes',
        filter: { _id: a.carteId, images: { $not: { $elemMatch: a.numero == null ? { set: a.set } : { set: a.set, numero: { $in: [a.numero, null] } } } } },
        update: { $push: { images: a.entree } },
    }));
}
const manifeste = plan => ({ lot: LOT, entrees: plan.ajouts.map(a => ({ carteId: a.carteId, set: a.set, numero: a.numero, cleR2: a.entree.cleR2, produits: [...a.produits].sort((x, y) => x - y) })) });
/** Retrait exact : seulement ce que CE lot a posé (même set, clé, source, lot, numéro). */
const operationsRetrait = m => m.entrees.map(o => ({ coll: 'cartes', filter: { _id: o.carteId },
    update: { $pull: { images: { set: o.set, cleR2: o.cleR2, source: IE.SOURCE, lot: LOT, imageEmprunteeTirage: true, numero: o.numero ?? null } } } }));

// ── 4. le numéro de fiche de Guzma ────────────────────────────────────────────────────────────────────────────────────
// `numeroFiche` null → « 115a » quand le PRODUIT porte lui-même ce numéro (slug et numéro appris par Cardmarket) : la jointure « metacarte+freres » ne l'avait pas lu. Un numéro posé n'est jamais écrasé.
const NUMEROS_FICHE = Object.freeze({ 449623: Object.freeze({ numeroFiche: '115a', carteId: 223420, slugSet: 'Burning-Shadows', slug: /^Guzma-V\d+-BUS115a$/ }) });
function planNumeroFiche({ lignes, appris }) {
    const ecrire = [], refus = [];
    for (const [k, v] of Object.entries(NUMEROS_FICHE)) {
        const id = Number(k), l = (lignes || []).find(x => x.idProduct === id);
        const no = raison => refus.push({ idProduct: id, famille: 'NUMERO_FICHE', raison });
        if (!l) { no('ligne-absente'); continue; }
        if (l.carteId !== v.carteId || l.slugSet !== v.slugSet) { no('ligne-differente-de-la-liste'); continue; }
        if (numeroDeLigne(l) != null) { no('numero-deja-pose'); continue; }
        const a = appris?.get(id);
        if (!a) { no('produit-non-appris'); continue; }
        if (!v.slug.test(String(a.slug ?? '')) || cleNumero(a.numero) !== cleNumero(v.numeroFiche)) { no('numero-appris-different'); continue; }
        ecrire.push({ idProduct: id, _id: l._id, numeroFiche: v.numeroFiche, preuve: `numéro ${v.numeroFiche} porté par le produit lui-même (slug « ${a.slug} », numéro appris « ${a.numero} »)` });
    }
    return { ecrire, refus };
}

module.exports = { LOT, DECISION, TAMPONS, FINITION_WCD, LISTE_EMPRUNTS, NUMEROS_FICHE, libelleMelange, planMelangesTampons, planFinitionWcd, planEmprunts, operationsEmprunts, manifeste, operationsRetrait, planNumeroFiche, couverte };

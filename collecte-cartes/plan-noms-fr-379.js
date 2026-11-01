'use strict';
// ============================================================
// NOMS FRANÇAIS DES 379 CARTES POSITIVES SANS CHAMP nomFr — fonctions PURES (aucune base, aucun réseau).
// ============================================================
// Décision de l'utilisateur : ces cartes reçoivent un nom français par les noms FR de TCGdex (données ouvertes) avec DEUX sources concordantes.
//   source 1 : le clone LOCAL de TCGdex, lien carte <-> carte TCGdex PROUVÉ par `prouverLien` (plan-noms-fr-fiches.js, importé, jamais recopié) ;
//   source 2 : la page Poképédia du Pokémon (nom français en titre, « Nom anglais » en champ), lue PAR LA PORTE RÉSEAU (faits seulement : un nom).
// Une carte qui n'a qu'une source reste sans nom ; deux sources qui se contredisent : sans nom, et la contradiction se liste.
// Tout ce qui ne conclut pas BLOQUE et dit pourquoi (on énumère ce qui autorise, jamais ce qui refuse).
//
// La confirmation porte sur l'ESPÈCE (le nom nu) : le suffixe de règle (ex, GX, V…), « Méga » et la forme régionale doivent être les mêmes des deux
// côtés (anglais et français), et sont recopiés du nom TCGdex. Un propriétaire (« Erika's … » / « … d'Erika ») n'a pas de page : non vérifiable.
const { prouverLien, indexClone } = require('./plan-noms-fr-fiches');
const { cle, accents } = require('./nom-fr-cardmarket');

const REGIONS_EN = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' };
const REGIONS_FR = { 'd\'alola': 'alola', 'de galar': 'galar', 'de hisui': 'hisui', 'de paldea': 'paldea' };
const SUFFIXE = /(?:\s+|-)(ex|gx|vmax|vstar|v)$/i;

/** @returns {{base, suffixe, mega, region, proprietaire}} (ordre des clés figé : le banc compare des JSON) */
function decomposerEn(nom) {
    let t = String(nom ?? '').trim();
    const proprietaire = /^.+?'s\s+\S/.test(t);
    let mega = false, region = null, suffixe = null;
    if (/^mega\s+/i.test(t)) { mega = true; t = t.replace(/^mega\s+/i, ''); }
    const r = /^(alolan|galarian|hisuian|paldean)\s+/i.exec(t);
    if (r) { region = REGIONS_EN[r[1].toLowerCase()]; t = t.slice(r[0].length); }
    const s = SUFFIXE.exec(t);
    if (s) { suffixe = s[1].toLowerCase(); t = t.slice(0, s.index); }
    return { base: t.trim(), suffixe, mega, region, proprietaire };
}
function decomposerFr(nom) {
    let t = String(nom ?? '').trim();
    let mega = false, region = null, suffixe = null, proprietaire = false;
    if (/^méga-?\s*/i.test(t)) { mega = true; t = t.replace(/^méga-?\s*/i, ''); }
    const s = SUFFIXE.exec(t);
    if (s) { suffixe = s[1].toLowerCase(); t = t.slice(0, s.index); }
    const r = /\s(d'alola|de galar|de hisui|de paldea)$/i.exec(t);
    if (r) { region = REGIONS_FR[r[1].toLowerCase()]; t = t.slice(0, r.index); }
    else if (/\s(?:d'|de\s|du\s|des\s)\S/i.test(t) || /(?:\s+|-)(?:ex|gx|vmax|vstar|v)\s+(?:d'|de\s)/i.test(String(nom))) {
        proprietaire = true;
        t = t.replace(/(?:\s|^)(?:d'|de\s|du\s|des\s).*$/i, '').replace(SUFFIXE, '');
        // « Rafflesia-ex d'Erika » : le suffixe est avant le propriétaire
        const s2 = SUFFIXE.exec(String(nom).replace(/\s(?:d'|de\s|du\s|des\s).*$/i, ''));
        if (s2) suffixe = s2[1].toLowerCase();
    }
    return { base: t.trim(), suffixe, mega, region, proprietaire };
}

/** Page Poképédia (texte de la porte) -> { titre, anglais } ; null si le texte est vide. */
function lirePage(texte) {
    const t = String(texte ?? '');
    if (!t.trim()) return null;
    const titre = t.split('\n')[0].replace(/\s+—\s+Poképédia\s*$/, '').trim();
    const m = /^Nom anglais\s+(.+)$/m.exec(t);
    return { titre, anglais: m ? m[1].trim() : null };
}
const sansAccents = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const cleGenre = s => cle(s) + (/♀/.test(s) ? '-f' : /♂/.test(s) ? '-m' : '');
function fichierPage(base) {
    const s = sansAccents(String(base).replace(/♀/g, ' f ').replace(/♂/g, ' m ')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${s}.txt`;
}
const urlPage = base => 'https://www.pokepedia.fr/' + encodeURIComponent(String(base).replace(/ /g, '_'));

/** Confirme (ou non) le nom TCGdex d'UN candidat par la page Poképédia de son espèce. */
function confirmer(cand, page) {
    const non = (raison, plus = {}) => ({ carteId: cand.carteId, decision: 'sans-nom', raison, ...plus });
    if (!cand.nomEn || !String(cand.nomEn).trim()) return non('nom-en-absent');
    const en = decomposerEn(cand.nomEn), fr = decomposerFr(cand.nomTcgdex);
    if (en.proprietaire || fr.proprietaire) return non('proprietaire-non-verifiable');
    if (en.suffixe !== fr.suffixe || en.mega !== fr.mega || en.region !== fr.region) return non('forme-contredite', { detail: `${cand.nomEn} / ${cand.nomTcgdex}` });
    if (!page || !page.anglais) return non('seconde-source-absente');
    if (cle(page.titre) !== cle(fr.base) || cleGenre(page.anglais) !== cleGenre(en.base)) {
        return non('sources-contradictoires', { detail: `TCGdex « ${cand.nomTcgdex} » (en « ${cand.nomEn} ») / Poképédia « ${page.titre} » (en « ${page.anglais} »)` });
    }
    const forme = accents(page.titre) >= accents(fr.base) ? page.titre : fr.base;
    let nomFr = String(cand.nomTcgdex).includes(fr.base) ? String(cand.nomTcgdex).replace(fr.base, forme) : cand.nomTcgdex;
    // le séparateur du suffixe suit la convention de NOTRE nom anglais (« Florizarre ex » / « Pinsir-GX »), pas celle de TCGdex
    if (fr.suffixe && en.suffixe) {
        const sep = /-[A-Za-z]+$/.test(String(cand.nomEn).trim()) ? '-' : ' ';
        nomFr = nomFr.replace(SUFFIXE, (_m, s) => sep + s);
    }
    return { carteId: cand.carteId, decision: 'nommer', nomFr, paire: 'tcgdex+pokepedia', identiqueAnglais: cle(nomFr) === cle(cand.nomEn), temoin: cand.temoin, nomTcgdex: cand.nomTcgdex, titrePage: page.titre, anglaisPage: page.anglais };
}

/** Les candidats : positives SANS champ nomFr, lien prouvé avec UNE carte TCGdex (ou plusieurs qui donnent le même fr) portant un fr. */
function planifierCandidats({ cartes, liens, clone }) {
    const ix = indexClone(clone);
    const lignesDe = new Map();
    for (const l of liens) (lignesDe.get(l.carteId) || lignesDe.set(l.carteId, []).get(l.carteId)).push(l);
    const candidats = [], sansNom = [];
    let population = 0;
    for (const c of cartes) {
        if (!(c._id > 0) || c.nomFr !== undefined) continue;                     // la population, et elle seule : positives sans champ
        population++;
        const lignes = lignesDe.get(c._id) || [];
        if (!lignes.length) { sansNom.push({ carteId: c._id, nomEn: c.nomEn ?? null, raison: 'sans-ligne-produit' }); continue; }
        const preuves = lignes.map(l => prouverLien(c, l, ix));
        const valides = preuves.filter(p => p.ok);
        if (!valides.length) { sansNom.push({ carteId: c._id, nomEn: c.nomEn ?? null, raison: 'lien-non-prouve', detail: [...new Set(preuves.map(p => p.raison))].sort().join('+') }); continue; }
        const uniques = new Map(valides.map(p => [p.carteTcgdex, p.tcgdex]));
        const frs = new Map();
        for (const t of uniques.values()) if (t.noms.fr && String(t.noms.fr).trim()) frs.set(cle(t.noms.fr), t.noms.fr);
        const temoin = [...new Set(valides.map(p => p.temoin))].sort().join('+');
        if (!frs.size) { sansNom.push({ carteId: c._id, nomEn: c.nomEn ?? null, raison: 'tcgdex-sans-fr', detail: temoin }); continue; }
        if (frs.size > 1) { sansNom.push({ carteId: c._id, nomEn: c.nomEn ?? null, raison: 'tcgdex-contradictoire', detail: [...frs.values()].join(' / ') }); continue; }
        candidats.push({ carteId: c._id, nomEn: c.nomEn ?? null, nomTcgdex: [...frs.values()][0], temoin, refsTcgdex: [...uniques.keys()] });
    }
    return { candidats, sansNom, population };
}

/** Les espèces dont il faut lire la page (uniques, dans l'ordre) : celles que `confirmer` ira consulter. */
function especesAChercher(candidats) {
    const vues = new Set(), out = [];
    for (const c of candidats) {
        if (!c.nomEn) continue;
        const en = decomposerEn(c.nomEn), fr = decomposerFr(c.nomTcgdex);
        if (en.proprietaire || fr.proprietaire || !fr.base) continue;
        if (!vues.has(fr.base)) { vues.add(fr.base); out.push(fr.base); }
    }
    return out;
}

/**
 * Les opérations d'écriture, PURES. Le filtre s'écrit par ce qu'il AUTORISE : la carte n'a PAS de champ nomFr. Une carte qui a bougé depuis la
 * lecture ne correspond plus : elle n'est pas touchée. Refus (lève) : _id non positif, nom vide, source autre que la paire attendue.
 */
function construireOps({ nommer, le }) {
    return nommer.map(x => {
        if (!(Number.isInteger(x.carteId) && x.carteId > 0)) throw new Error(`construireOps : _id ${x.carteId} non positif (hors du lot)`);
        if (typeof x.nomFr !== 'string' || !x.nomFr.trim()) throw new Error(`construireOps : nom vide pour ${x.carteId}`);
        if (x.paire !== 'tcgdex+pokepedia') throw new Error(`construireOps : ${x.carteId} sans deux sources concordantes (${x.paire})`);
        return { updateOne: { filter: { _id: x.carteId, nomFr: { $exists: false } }, update: { $set: { nomFr: x.nomFr, nomFrSource: x.paire, nomFrLe: le } } } };
    });
}

module.exports = { decomposerEn, decomposerFr, lirePage, fichierPage, urlPage, confirmer, planifierCandidats, especesAChercher, construireOps };

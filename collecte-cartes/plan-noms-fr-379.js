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
const lienParCles = require('./lien-par-cles-210');

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
    return { carteId: cand.carteId, decision: 'nommer', nomFr, paire: 'tcgdex+pokepedia', ...(cand.lien ? { lien: cand.lien } : {}), identiqueAnglais: cle(nomFr) === cle(cand.nomEn), temoin: cand.temoin, nomTcgdex: cand.nomTcgdex, titrePage: page.titre, anglaisPage: page.anglais };
}

// ---------- NIVEAUX du lot des 210 (option `niveaux`, absente = comportement du lot 379) ----------
// 'cles'   : lien carte <-> carte TCGdex par les cles A/B/C (lien-par-cles-210.js), quand l'identifiant produit ne prouve rien.
// 'espece' : le nom de l'ESPÈCE vient des AUTRES cartes TCGdex de même nom anglais (une seule forme française aux accents près), puis la page
//            Poképédia le confirme comme pour les autres. Le suffixe (ex, GX, V…) et « Méga- » se composent depuis NOTRE nom anglais ; une forme
//            régionale ou un propriétaire ne se composent pas.
// Les deux niveaux ne valent que pour une carte de catégorie « pokemon » (un Dresseur n'a pas d'espèce).
const NIVEAUX = ['cles', 'espece'];
const SUFFIXE_FR = { ex: 'ex', gx: 'GX', vmax: 'VMAX', vstar: 'VSTAR', v: 'V' };
const refCarte = t => `${t.famille}|${t.setId}|${t.localId}`;

/** nom anglais nu (clé `cle`) -> Map(clé du nom français nu -> sa forme la plus accentuée), sur les cartes TCGdex dont suffixe/Méga/région concordent. */
function indexEspeces(clone, exclure = new Set()) {
    const m = new Map();
    for (const t of clone.cartes) {
        if (!t.noms || !t.noms.en || !t.noms.fr || exclure.has(refCarte(t))) continue;
        const e = decomposerEn(t.noms.en), f = decomposerFr(t.noms.fr);
        if (e.proprietaire || f.proprietaire || e.region || f.region || e.suffixe !== f.suffixe || e.mega !== f.mega || !e.base || !f.base) continue;
        const k = cle(e.base), g = m.get(k) || m.set(k, new Map()).get(k), kf = cle(f.base);
        if (!g.has(kf) || accents(f.base) > accents(g.get(kf))) g.set(kf, f.base);
    }
    return m;
}
/** -> { ok:true, nomTcgdex } | { ok:false, raison, detail? } */
function nomParEspece(carte, especes) {
    if (!carte.nomEn || !String(carte.nomEn).trim()) return { ok: false, raison: 'nom-en-absent' };
    const e = decomposerEn(carte.nomEn);
    if (e.proprietaire) return { ok: false, raison: 'espece-proprietaire' };
    if (e.region) return { ok: false, raison: 'espece-forme-regionale' };
    const g = especes.get(cle(e.base));
    if (!g || !g.size) return { ok: false, raison: 'espece-inconnue' };
    if (g.size > 1) return { ok: false, raison: 'espece-ambigue', detail: [...g.values()].join(' / ') };
    return { ok: true, nomTcgdex: (e.mega ? 'Méga-' : '') + [...g.values()][0] + (e.suffixe ? ' ' + SUFFIXE_FR[e.suffixe] : '') };
}

/** Les candidats : positives SANS champ nomFr, lien prouvé avec UNE carte TCGdex (ou plusieurs qui donnent le même fr) portant un fr. */
function planifierCandidats({ cartes, liens, clone, niveaux = [] }) {
    for (const n of niveaux) if (!NIVEAUX.includes(n)) throw new Error(`niveau inconnu : ${n} (autorisés : ${NIVEAUX.join(', ')})`);
    const ix = indexClone(clone);
    const ixCles = niveaux.includes('cles') ? lienParCles.indexCles(clone) : null;
    const especes = niveaux.includes('espece') ? indexEspeces(clone) : null;
    const lignesDe = new Map();
    for (const l of liens) (lignesDe.get(l.carteId) || lignesDe.set(l.carteId, []).get(l.carteId)).push(l);
    const candidats = [], sansNom = [];
    let population = 0;
    for (const c of cartes) {
        if (!(c._id > 0) || c.nomFr !== undefined) continue;                     // la population, et elle seule : positives sans champ
        population++;
        const non = (raison, detail) => sansNom.push({ carteId: c._id, nomEn: c.nomEn ?? null, raison, ...(detail !== undefined ? { detail } : {}) });
        const eligible = c.categorie === 'pokemon';
        // dernier recours : le nom de l'espèce ; échoue en nommant sa raison (et rappelle pourquoi le lien carte à carte n'a pas conclu)
        const parEspece = (raison, detail) => {
            if (!(eligible && especes) || raison === 'cles-contredisent-l-id' || /dex-contredit/.test(detail || '')) return non(raison, detail);   // une contradiction d'identité n'est pas contournée par l'espèce
            const r = nomParEspece(c, especes);
            if (r.ok) return candidats.push({ carteId: c._id, nomEn: c.nomEn ?? null, nomTcgdex: r.nomTcgdex, temoin: 'espece', lien: 'espece', refsTcgdex: [] });
            return non(r.raison, r.detail ?? `${raison}${detail ? ' : ' + detail : ''}`);
        };
        const lignes = lignesDe.get(c._id) || [];
        const preuves = lignes.map(l => prouverLien(c, l, ix));
        let valides = preuves.filter(p => p.ok), lien;
        let raison = lignes.length ? 'lien-non-prouve' : 'sans-ligne-produit';
        let detail = lignes.length ? [...new Set(preuves.map(p => p.raison))].sort().join('+') : undefined;
        if (!valides.length && eligible && ixCles && !preuves.some(p => p.raison === 'dex-contredit')) {
            const r = lienParCles.lierParCles(c, lignes, ixCles);
            if (!r.ok) detail = `${detail ? detail + ' ; ' : ''}cles : ${r.raison}${r.detail ? ' (' + r.detail + ')' : ''}`;
            else {
                const t = r.preuves[0].carteTcgdex;
                // l'identifiant produit, quand le clone le connaît, ne doit pas désigner une AUTRE carte que les clés
                if (lignes.some(l => { const cs = ix.parCm.get(l.idProduct); return cs && cs.length && !cs.some(x => refCarte(x) === t); })) { raison = 'cles-contredisent-l-id'; detail = t; }
                else { lien = `cles:${r.cles.join('')}`; valides = r.preuves.map(p => ({ ...p, temoin: lien })); }
            }
        }
        if (!valides.length) { parEspece(raison, detail); continue; }
        const uniques = new Map(valides.map(p => [p.carteTcgdex, p.tcgdex]));
        const frs = new Map();
        for (const t of uniques.values()) if (t.noms.fr && String(t.noms.fr).trim()) frs.set(cle(t.noms.fr), t.noms.fr);
        const temoin = [...new Set(valides.map(p => p.temoin))].sort().join('+');
        if (!frs.size) { parEspece('tcgdex-sans-fr', temoin); continue; }
        if (frs.size > 1) { non('tcgdex-contradictoire', [...frs.values()].join(' / ')); continue; }
        candidats.push({ carteId: c._id, nomEn: c.nomEn ?? null, nomTcgdex: [...frs.values()][0], temoin, ...(lien ? { lien } : {}), refsTcgdex: [...uniques.keys()] });
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
        return { updateOne: { filter: { _id: x.carteId, nomFr: { $exists: false } }, update: { $set: { nomFr: x.nomFr, nomFrSource: x.paire, nomFrLe: le, ...(x.lien ? { nomFrLien: x.lien } : {}) } } } };
    });
}

module.exports = { NIVEAUX, indexEspeces, nomParEspece, decomposerEn, decomposerFr, lirePage, fichierPage, urlPage, confirmer, planifierCandidats, especesAChercher, construireOps };

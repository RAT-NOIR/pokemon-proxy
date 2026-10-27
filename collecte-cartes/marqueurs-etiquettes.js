'use strict';
// ============================================================
// LES MARQUEURS STAFF, WCD (année, joueur) ET LEAGUE (+ PLACE) PAR DEUX SOURCES CONCORDANTES (contrat MARQUEURS v1 de l'API, décision de l'éditeur du 2026-10-27)
// ============================================================
// Source 1, la place de marché de RÉFÉRENCE : l'ÉTIQUETTE de la page du produit (relevé passif du 2026-10-17, lue par OCR : « Staff Version », « WCD 2024 Sakuya Ota · Not Tournament Legal »)
//   ou, pour les « Yellow A », la VIGNETTE du produit (copie locale, lue le 2026-10-27 : tampon et place).
// Source 2, une SECONDE place de marché : le NOM de son produit pour la MÊME carte (« Chi-Yu - 057 (Prerelease) [Staff] », « Flutter Mane - 2024 (Sakuya O.) », « Acerola - 112a/147 (League Challenge) [2nd Place] »).
// La carte se désigne par la clé de PRODUCTION (collecte-cartes/tcgcsv-jointure.js : numéro fort + nom ; WCD : année, numéro d'origine, nom) — jamais par le marqueur, qui est ce qu'on veut prouver.
// Une garde écrite par ce qu'elle AUTORISE : un marqueur n'est posé que si les DEUX sources le disent pour UN seul produit de chaque côté ; tout le reste est un refus NOMMÉ.
// Les preuves ne nomment aucune source par son nom (règle de l'éditeur : « aucun nom de source en public »). Fonctions PURES : ni base, ni fichier, ni requête.
const JT = require('./tcgcsv-jointure');

// L'ordre de la table du §3 du contrat (CONTRAT-MARQUEURS.md v1) et les paramètres de chaque type : la liste est FERMÉE, un type absent n'existe pas.
const ORDRE = Object.freeze(['JUMBO', 'WCD', 'NON_LEGAL', 'EDITION_1', 'SHADOWLESS', 'STAFF', 'PRERELEASE', 'LEAGUE', 'CHAMPIONSHIP', 'PLACE', 'PROFESSOR', 'PLAY_POKEMON', 'TRICK_OR_TRADE', 'BATTLE_ACADEMY',
    'ANNIVERSAIRE_25', 'POKEMON_CENTER', 'GAMESTOP', 'TOYS_R_US', 'KFC', 'INDOMILK', 'ORIGINS', 'SNOWFLAKE', 'COSMO', 'MCDONALDS']);
const PARAMS = Object.freeze({ WCD: { requis: ['annee'], permis: ['annee', 'joueur'] }, PLACE: { requis: ['rang'], permis: ['rang'] } });
const FORME = Object.freeze({
    annee: v => Number.isInteger(v) && v >= 1996 && v <= 2099,
    joueur: v => typeof v === 'string' && /^[\p{L} '.-]{1,24}$/u.test(v) && v.trim() === v,
    rang: v => [1, 2, 3, 4].includes(v)
});
function valide(m) {
    if (!m || !ORDRE.includes(m.type) || !m.params || typeof m.params !== 'object') return false;
    const p = PARAMS[m.type] || { requis: [], permis: [] };
    const cles = Object.keys(m.params);
    return cles.every(k => p.permis.includes(k) && FORME[k](m.params[k])) && p.requis.every(k => cles.includes(k));
}
const ordonner = ms => [...ms].sort((a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type));
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(c => [c, x[c]])) : x));

// ── les étiquettes, regroupées par produit ──────────────────────────────────────────────────────────────────────────────
const parProduit = etiquettes => { const m = new Map(); for (const e of etiquettes || []) (m.get(e.idProduct) || m.set(e.idProduct, []).get(e.idProduct)).push(e); return m; };
const texteDe = es => (es || []).flatMap(e => e.ocr || []).map(String).join(' ').replace(/\s+/g, ' ').trim();
// STAFF : la classe « staff » du détecteur relu le 17/10, ou le MOT « Staff » lu sur l'étiquette (« Staff Stamped », « EUIC 2023 Staff »)
const estStaff = es => (es || []).some(e => e.classe === 'staff' || /\bstaff\b/i.test((e.ocr || []).join(' ')));
const estWcd = es => (es || []).some(e => e.classe === 'wcd' || /\bwc.?d/i.test((e.ocr || []).join(' ')));
// le joueur lu : l'OCR confond « O » et « 0 » (« Sakuya0ta ») ; un nom de joueur ne porte jamais de chiffre ; on compare des LETTRES
const lettres = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/0/g, 'o').toLowerCase().replace(/[^a-z]/g, '');
const memeCarte = (a, b) => a.fort != null && a.fort === b.fort && a.nomCles.some(n => b.nomCles.includes(n));

/** STAFF : étiquette « Staff » sur UN produit de la carte (référence) + UN produit marqué Staff pour la même carte (second marché). */
function planStaff({ etiquettes, cm, groupesDeExp, lusDe, releveLe }) {
    const E = parProduit(etiquettes), cibles = [], refus = [];
    const no = (idProduct, raison, detail) => refus.push({ idProduct, famille: 'STAFF', raison, ...(detail ? { detail } : {}) });
    for (const [id, es] of E) {
        if (!estStaff(es)) continue;
        const p = cm.produits.get(id);
        if (!p) { no(id, 'produit-inconnu'); continue; }
        if (p.lu.fort == null) { no(id, 'sans-numero'); continue; }
        const gs = groupesDeExp.get(p.idExpansion) || [];
        if (!gs.length) { no(id, 'expansion-non-appariee'); continue; }
        const cands = gs.flatMap(g => (lusDe.get(g) || []).filter(t => memeCarte(t, p.lu)));
        if (!cands.length) { no(id, 'carte-absente-du-marche'); continue; }
        const marques = cands.filter(t => t.marqueurs.some(x => /\bstaff\b/.test(x)));
        if (!marques.length) { no(id, 'aucun-produit-marche-marque', cands.map(t => t.nomBrut)); continue; }
        if (marques.length > 1) { no(id, 'plusieurs-produits-marche-marques', marques.map(t => t.nomBrut)); continue; }
        // la référence : un SEUL produit de la même carte (même expansion) porte l'étiquette — sinon elle ne départage rien
        const freres = [...cm.produits.values()].filter(q => q.idExpansion === p.idExpansion && memeCarte(q.lu, p.lu));
        if (freres.filter(q => estStaff(E.get(q.idProduct))).length !== 1) { no(id, 'plusieurs-produits-cm-etiquetes'); continue; }
        cibles.push({ idProduct: id, famille: 'STAFF', marqueurs: [{ type: 'STAFF', params: {} }],
            preuve: `étiquette de la place de marché de référence sur la page du produit (relevé passif du ${releveLe}, lu par OCR) : « ${texteDe(es)} » ; même carte (n° ${p.lu.fort} et nom) chez une seconde place de marché : produit « ${marques[0].nomBrut} »` });
    }
    return { cibles, refus };
}

/** WCD : l'année (set WCD-<aaaa> + code du slug + étiquette) et le JOUEUR (lu sur l'étiquette = joueur du deck du second marché, pour la même carte de la même année). */
function planWcd({ etiquettes, cm, tcgWcd, releveLe }) {
    const E = parProduit(etiquettes), cibles = [], refus = [];
    const no = (idProduct, raison, detail) => refus.push({ idProduct, famille: 'WCD', raison, ...(detail ? { detail } : {}) });
    const tW = (tcgWcd || []).filter(Boolean);
    for (const [id, es] of E) {
        if (!estWcd(es)) continue;
        const p = cm.produits.get(id);
        const s = /^WCD-(\d{4})$/.exec(String(p?.slugSet ?? ''));
        if (!p || !s) continue;                                  // hors set WCD : ce n'est pas un deck de championnat (la classe de l'étiquette ne suffit pas)
        const anneeSet = Number(s[1]);
        const c = JT.lireWcdCm({ idProduct: id, name: p.name, slug: p.slug, slugSet: p.slugSet, codeSet: p.codeSet, idExpansion: p.idExpansion, numero: null });
        if (c.annee == null || !c.numeroWcd) { no(id, 'slug-sans-annee-ou-numero'); continue; }
        const texte = texteDe(es), anneeLue = (/(?:19|20)\d{2}/.exec(texte) || [])[0];
        if (c.annee !== anneeSet || (anneeLue && Number(anneeLue) !== anneeSet)) { no(id, 'annee-discordante', { set: anneeSet, slug: c.annee, etiquette: anneeLue ?? null }); continue; }
        const cands = tW.filter(t => t.annee === anneeSet && t.faible === JT.faibleDe(c.numeroWcd) && t.nomCles[0] === c.nomCles[0]);
        if (!cands.length) { no(id, 'carte-absente-du-marche'); continue; }
        const lu = lettres(texte);
        const joueurs = [...new Set(cands.filter(t => { const j = lettres(t.joueur); return j.length >= 5 && lu.includes(j); }).map(t => t.joueur))];
        if (!joueurs.length) { no(id, 'joueur-non-lu', { etiquette: texte, joueurs: [...new Set(cands.map(t => t.joueur))] }); continue; }
        if (joueurs.length > 1) { no(id, 'plusieurs-joueurs-lus', joueurs); continue; }
        const wcd = { type: 'WCD', params: { annee: anneeSet, joueur: joueurs[0] } };
        if (!valide(wcd)) { no(id, 'joueur-hors-forme', joueurs[0]); continue; }
        const nonLegal = /not\s+tournament\s+legal/i.test(texte);
        const deck = cands.find(t => t.joueur === joueurs[0]);
        cibles.push({ idProduct: id, famille: 'WCD', marqueurs: [wcd, ...(nonLegal ? [{ type: 'NON_LEGAL', params: {} }] : [])],
            preuve: `étiquette de la place de marché de référence sur la page du produit (relevé passif du ${releveLe}, lu par OCR) : « ${texte} » ; set ${p.slugSet} et code « WCD${String(anneeSet).slice(2)} » du produit ; même carte (année ${anneeSet}, n° d'origine ${deck.numeroBrut}, nom) chez une seconde place de marché : deck « ${deck.nomBrut} »` });
    }
    return { cibles, refus };
}

// ── Yellow A : le tampon de la vignette du produit (lu le 27/10) contre le nom du second marché ─────────────────────────────
const PLACES = ['1st', '2nd', '3rd', '4th'];
const TAMPONS_YA = Object.freeze({
    'pokemon-league': { types: () => [{ type: 'LEAGUE', params: {} }], libelle: () => 'Pokémon League', accepte: m => m.includes('pokemon league') },
    'championship-latam': { enAttente: false, types: () => null, libelle: () => 'Championships Latin America', accepte: m => m.some(x => /latin america/.test(x)) },
    'league-cup': { enAttente: true },
    'championship-regional': { enAttente: true }
});
function regleYa(tampon) {
    const lc = /^league-challenge-([1-4])$/.exec(String(tampon ?? ''));
    if (lc) { const n = Number(lc[1]); return { types: () => [{ type: 'LEAGUE', params: {} }, { type: 'PLACE', params: { rang: n } }], libelle: () => `League Challenge, ${n === 1 ? '1re' : `${n}e`} place`, accepte: m => m.includes('league challenge') && m.includes(`${PLACES[n - 1]} place`), place: m => m.includes('league challenge') }; }
    return TAMPONS_YA[tampon] ?? null;
}
const numeroSansZero = s => String(s ?? '').split('/')[0].toLowerCase().replace(/^0+(?=\d)/, '');
/**
 * @param {{produits: {idProduct, carte, numero, tamponProduit}[], cm, groupesDeExp: Map, lusDe: Map, luLe: string}} e
 * La carte du second marché se cherche dans les SEULS groupes appariés à l'expansion du produit (la table mesurée, comme STAFF) : un même nom au même numéro dans un autre set ne témoigne pas (relecture du 27/10).
 */
function planYellowA({ produits, cm, groupesDeExp, lusDe, luLe }) {
    const cibles = [], refus = [];
    const no = (idProduct, raison, detail) => refus.push({ idProduct, famille: 'YELLOW_A', raison, ...(detail ? { detail } : {}) });
    for (const y of produits || []) {
        if (!y.tamponProduit) continue;                          // sans tampon : hors de ce lot (« [] » n'est pas demandé)
        const r = regleYa(y.tamponProduit);
        if (!r) { no(y.idProduct, 'tampon-inconnu', y.tamponProduit); continue; }
        if (r.enAttente) { no(y.idProduct, 'type-en-attente-du-contrat', y.tamponProduit); continue; }
        const p = cm?.produits?.get(y.idProduct);
        if (!p) { no(y.idProduct, 'produit-inconnu'); continue; }
        const gs = groupesDeExp?.get(p.idExpansion) || [];
        if (!gs.length) { no(y.idProduct, 'expansion-non-appariee'); continue; }
        const cles = JT.clesDeNom(y.carte), num = numeroSansZero(y.numero);
        const cands = gs.flatMap(g => lusDe?.get(g) || []).filter(t => t.nomCles.some(n => cles.includes(n)) && numeroSansZero(t.numeroBrut) === num);
        if (!cands.length) { no(y.idProduct, 'carte-absente-du-marche'); continue; }
        // le second marché ne nomme pas toujours le staff : un produit « [Staff] » est un AUTRE produit (la vignette lue ne porte pas « Staff »)
        const bons = cands.filter(t => !t.marqueurs.some(x => /\bstaff\b/.test(x)) && r.accepte(t.marqueurs));
        if (!bons.length) { no(y.idProduct, r.place && cands.some(t => r.place(t.marqueurs)) ? 'place-absente-du-marche' : 'tampon-discordant', cands.map(t => t.nomBrut)); continue; }
        if (bons.length > 1) { no(y.idProduct, 'plusieurs-produits-marche', bons.map(t => t.nomBrut)); continue; }
        const types = r.types();
        if (!types) { no(y.idProduct, 'type-absent-du-contrat', y.tamponProduit); continue; }
        cibles.push({ idProduct: y.idProduct, famille: 'YELLOW_A', marqueurs: types,
            preuve: `vignette du produit sur la place de marché de référence (copie locale, lue le ${luLe}) : tampon « ${r.libelle()} » ; même carte (n° ${y.numero} et nom) chez une seconde place de marché : « ${bons[0].nomBrut} »` });
    }
    return { cibles, refus };
}

/**
 * Le plan d'écriture : une cible par produit (un produit visé par deux familles est refusé), produit présent dans l'export du jour, UNE ligne cartes_produits, champ `marqueurs` ABSENT
 * (une valeur présente, même `[]` ou `null`, n'est jamais écrasée), marqueurs valides au contrat et dans son ordre.
 */
function planifierEcriture({ cibles, lignes, exportIds }) {
    const ecrire = [], refus = [], deja = [];
    const parId = new Map(); for (const l of lignes || []) (parId.get(l.idProduct) || parId.set(l.idProduct, []).get(l.idProduct)).push(l);
    const parCible = new Map(); for (const c of cibles || []) (parCible.get(c.idProduct) || parCible.set(c.idProduct, []).get(c.idProduct)).push(c);
    for (const [id, cs] of parCible) {
        if (cs.length > 1) { refus.push({ idProduct: id, raison: `deux familles visent ce produit (${cs.map(c => c.famille).join(', ')})` }); continue; }
        const c = cs[0];
        if (!exportIds.has(id)) { refus.push({ idProduct: id, famille: c.famille, raison: 'absent du catalogue Cardmarket importé (catalogue_produits)' }); continue; }
        const ls = parId.get(id) || [];
        if (ls.length !== 1) { refus.push({ idProduct: id, famille: c.famille, raison: ls.length ? `${ls.length} lignes cartes_produits — une seule attendue` : 'aucune ligne cartes_produits' }); continue; }
        const l = ls[0], marqueurs = ordonner(c.marqueurs);
        if (l._id === undefined || l._id === null) { refus.push({ idProduct: id, famille: c.famille, raison: 'ligne cartes_produits sans _id' }); continue; }
        if (!marqueurs.length || !marqueurs.every(valide) || new Set(marqueurs.map(m => m.type)).size !== marqueurs.length || marqueurs.length > 4) { refus.push({ idProduct: id, famille: c.famille, raison: `marqueurs invalides au contrat (${JSON.stringify(marqueurs)})` }); continue; }
        if (l.marqueurs !== undefined) {
            if (stable(l.marqueurs) === stable(marqueurs)) deja.push({ idProduct: id, _id: l._id, famille: c.famille });
            else refus.push({ idProduct: id, famille: c.famille, raison: `marqueurs déjà présents (${JSON.stringify(l.marqueurs)}) — on n'écrase jamais` });
            continue;
        }
        ecrire.push({ idProduct: id, _id: l._id, famille: c.famille, marqueurs, marqueursPreuve: c.preuve });
    }
    return { ecrire, refus, deja };
}

module.exports = { ORDRE, valide, ordonner, planStaff, planWcd, planYellowA, planifierEcriture, lettres };

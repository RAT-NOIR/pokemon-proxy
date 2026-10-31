// ============================================================
// FICHES CHINOISES : PREUVE PAR LE SET — le JUGEMENT d'un set et les entrées du planificateur (module PUR hors chargerSources, qui lit des fichiers)
// ============================================================
// Un set n'est ADMIS que si TOUT ce qui suit tient (une garde s'écrit par ce qu'elle autorise : le reste est refusé, nommé) :
//   1. la preuve par le set (preuve-par-set.js) s'applique SANS le numéro Cardmarket (la mesure) ET AVEC (le témoin : le numéro Cardmarket n'est jamais caché à l'écriture) ;
//   2. CALIBRATION : chaque attribution est confrontée au numéro Cardmarket connu du produit — 0 faux, et AUCUNE attribution non jugée (un produit sans numéro Cardmarket ne se calibre pas) ;
//   3. LA CALIBRATION SAIT DIRE NON — quatre contrôles négatifs fabriqués sur CE set, qui doivent tous être refusés ou détectés : une entrée retirée, un produit orphelin, un nom remplacé,
//      deux numéros échangés entre deux cartes (le nom seul ne voit pas cet échange : c'est le numéro Cardmarket en témoin qui le voit). Un contrôle impossible à fabriquer (un set d'un seul nom) = pas admis.
// ⚠️ Les libellés anglais que la source publie (kado) ne servent JAMAIS à traduire : la traduction vient de tables indépendantes (PokeAPI, Wikidata, TCGdex).
const fs = require('fs'), path = require('path');
const { prouverParSet } = require('./preuve-par-set');
const { cleNumero } = require('./jointure');
const TZ = require('./table-zh');
const AHK = require('./anciens-noms-hk');

const SOURCE = 'preuve-par-set';
const groupeGem = n => String(n).slice(0, 2);
/** Les sets de la preuve : 'vise' = un set qu'on voudrait fiche ; 'calibration' = un set connu qui sert à prouver que la règle ne se trompe pas (jamais écrit). */
const CIBLES = [
    { nom: 'Gem Pack Vol. 4 (CBB4C)', exp: 6447, kado: [['Gem Pack Vol. 4', '']], groupeDe: groupeGem, role: 'vise', calibrable: true },
    { nom: 'Gem Pack Vol. 5 (CBB5C)', exp: 6544, kado: [['Gem Pack Vol. 5', '']], groupeDe: groupeGem, role: 'vise', calibrable: true },
    { nom: 'Happy Set Decidueye… (CSVH4C)', exp: 6543, kado: [['Happy Set (Happy Pack)', 'e'], ['Happy Set (Modification Pack)', 'a'], ['Happy Set (Reward Pack)', 'p']], role: 'vise' },
    { nom: '30th Celebration (30C)', exp: 6601, kado: [['30th Celebration (4229)', '']], role: 'vise' },
    { nom: 'Phantasmal Flames (calibration)', exp: 6299, kado: [['Phantasmal Flames', '']], role: 'calibration' },
    { nom: 'Ascended Heroes (calibration)', exp: 6395, kado: [['Ascended Heroes', '']], role: 'calibration' }
];

/** Les attributions confrontées au numéro Cardmarket CONNU du produit : { justes, faux, nonJugees, fauxListe }. */
function confronter(attributions, produits) {
    const par = new Map(produits.map(p => [p.idProduct, p]));
    let justes = 0, faux = 0, nonJugees = 0; const fauxListe = [];
    for (const a of attributions) {
        const p = par.get(a.idProduct);
        const vrai = p && p.numero != null && String(p.numero).trim() !== '' ? cleNumero(String(p.numero)) : null;
        if (vrai == null) { nonJugees++; continue; }
        if (cleNumero(String(a.numero)) === vrai) justes++; else { faux++; fauxListe.push({ idProduct: a.idProduct, regle: a.numero, connu: p.numero }); }
    }
    return { justes, faux, nonJugees, jugees: justes + faux, fauxListe: fauxListe.slice(0, 10) };
}

/**
 * Le jugement d'UN set.
 * @param {{source: Array<{numero:string, nomZh:string}>, produits: Array<{idProduct:number, name:string, numero?:string|null}>, traduire:Function, cleProduit:Function, groupeDe?:Function|null}} o
 * @returns {{admis:boolean, raison:string, motifs:string[], attributions:object[], ambigus:object[], etapes:object, calibration:object, negatifs:object, denominateurs:object}}
 */
function juger({ source, produits, traduire, cleProduit, groupeDe = null }) {
    const arg = (s, p) => ({ source: s, produits: p, traduire, cleProduit, groupeDe });
    const cache = produits.map(p => ({ idProduct: p.idProduct, name: p.name }));
    const r = prouverParSet(arg(source, cache));
    const sortie = (admis, motifs, extra = {}) => ({ admis, raison: admis ? `ADMIS : ${r.raison} ; calibration ${extra.calibration.jugees} jugées, 0 faux ; 4 contrôles négatifs refusés` : motifs.join(' ; '), motifs, attributions: admis ? r.attributions : [], ambigus: admis ? r.ambigus : [], etapes: extra.etapes || {}, calibration: extra.calibration || null, negatifs: extra.negatifs || null, denominateurs: r.denominateurs });
    const etapes = { sansTemoin: { admis: r.admis, raison: r.raison } };
    if (!r.admis) return { ...sortie(false, [`la règle ne s'applique pas (numéros Cardmarket cachés) : ${r.raison}`], { etapes }), discordances: r.discordances };
    const t = prouverParSet(arg(source, produits));
    etapes.avecTemoin = { admis: t.admis, raison: t.raison };
    if (!t.admis) return sortie(false, [`la règle ne s'applique pas AVEC le numéro Cardmarket en témoin : ${t.raison}`], { etapes });
    const motifs = [];
    const calibration = confronter(r.attributions, produits);
    if (!r.attributions.length) motifs.push('aucune attribution (tous les noms sont ambigus) : rien à calibrer');
    if (calibration.nonJugees) motifs.push(`${calibration.nonJugees} attribution(s) sans numéro Cardmarket : non jugées, donc non calibrées`);
    if (calibration.faux) motifs.push(`${calibration.faux} FAUX à la calibration (${JSON.stringify(calibration.fauxListe.slice(0, 3))})`);

    // les contrôles négatifs (chacun DOIT dire non)
    const negatifs = {};
    negatifs.sansUneEntree = prouverParSet(arg(source.slice(1), cache)).admis;
    negatifs.produitOrphelin = prouverParSet(arg(source, cache.concat([{ idProduct: -1, name: 'Zzyzx Orphelin Inconnu' }]))).admis;
    const cles = source.map(e => traduire(e.nomZh));
    const dernier = source.length - 1;
    const iNom = cles.findIndex((c, i) => i !== dernier && c !== cles[dernier]);
    negatifs.nomRemplace = iNom < 0 ? null : prouverParSet(arg(source.map((e, i) => (i === iNom ? { ...e, nomZh: source[dernier].nomZh } : e)), cache)).admis;
    const iA = 0, iB = source.findIndex((e, i) => cles[i] !== cles[iA] && (!groupeDe || groupeDe(String(e.numero)) !== groupeDe(String(source[iA].numero))));
    if (iB < 0) negatifs.echangeDeNumeros = null;
    else {
        const echange = source.map((e, i) => (i === iA ? { ...e, numero: source[iB].numero } : i === iB ? { ...e, numero: source[iA].numero } : e));
        const te = prouverParSet(arg(echange, produits));
        negatifs.echangeDeNumeros = te.admis && confronter(te.attributions, produits).faux === 0;   // vrai = la calibration N'A PAS vu l'échange (elle ne sait pas dire non)
    }
    for (const [nom, v] of Object.entries(negatifs)) {
        if (v === null) motifs.push(`contrôle négatif « ${nom} » impossible à fabriquer sur ce set : une calibration qui ne sait pas dire non n'admet rien`);
        else if (v === true) motifs.push(`contrôle négatif « ${nom} » : la règle l'a ADMIS — elle ne sait pas dire non ici`);
    }
    return sortie(motifs.length === 0, motifs, { etapes, calibration, negatifs });
}

/** Les entrées du planificateur de la voie « deux-sources » (voie-deux-sources.planifierVoie) pour un set ADMIS : la seconde source est la preuve par le set, et le numéro de la concordante est celui de Cardmarket (le témoin). */
function entreesDuSet({ verdict, source, produits, exp, slugSet, etiquette }) {
    const nomParNumero = new Map(source.map(e => [String(e.numero), e.nomZh]));
    const par = new Map(produits.map(p => [p.idProduct, p]));
    return verdict.attributions.map(a => {
        const p = par.get(a.idProduct);
        const nomZh = nomParNumero.get(String(a.numero)) ?? nomParNumero.get(String((a.candidats || [])[0])) ?? null;
        const note = verdict.toleranceMotif ? ` [${verdict.toleranceMotif}]` : '';   // la tolérance d'orthographe est écrite sur CHAQUE fiche du set qu'elle a rendu admis
        return { idProduct: a.idProduct, idExpansion: exp, slugSet, secondeSource: { concordantes: [{ source: SOURCE, ref: `${etiquette}#${a.numero}${note}`, set: slugSet, numero: p ? String(p.numero) : null, nom: nomZh, par: 'set' }], refusees: [] } };
    });
}

/** Les tables et les listes sur disque (aucun réseau) : le même chargement pour la simulation et pour l'écriture (§21 bis). */
function chargerSources(dossier, { variantes = null } = {}) {
    const lire = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    const SETS = Object.fromEntries(fs.readdirSync(path.join(dossier, 'cache', 'sets')).map(f => { const j = lire(path.join(dossier, 'cache', 'sets', f)); return [j.etiquette, j]; }));
    const LABELS = fs.existsSync(path.join(dossier, 'labels.json')) ? lire(path.join(dossier, 'labels.json')) : {};
    const TW = lire(path.join(dossier, 'table-zh-tw.json')).table;
    const POKEAPI = TZ.lireEspecesPokeApi(fs.readFileSync(path.join(dossier, 'pokeapi', 'pokemon_species_names.csv'), 'utf8'));
    const journal = [];
    let ESPECES = POKEAPI;
    const WD = path.join(dossier, 'wikidata', 'especes-zh.json');
    if (fs.existsSync(WD)) {
        const w = TZ.lireEspecesWikidata(lire(WD), { licence: 'CC0', luLe: fs.readFileSync(path.join(dossier, 'wikidata', 'LU-LE.txt'), 'utf8').slice(0, 10), variantes });
        const m = TZ.fusionnerEspeces(POKEAPI.table, w.table, w.contestes);
        ESPECES = { table: m.table, stats: { ...POKEAPI.stats, wikidata: w.stats, fusion: m.stats } };
        journal.push('Wikidata (' + w.meta.licence + ', lu le ' + w.meta.luLe + (variantes ? ', variantes ' + variantes.join('/') : '') + ') : ' + JSON.stringify(w.stats));
    } else journal.push('Wikidata : AUCUN fichier — la table des espèces est PokeAPI seule');
    // ANCIENS NOMS DE HONG KONG (52poke ET zh.wikipedia, concordance par n° de Pokédex — collecte-cartes/anciens-noms-hk.js) : absents de PokeAPI et de Wikidata
    const FHK = path.join(dossier, 'anciens-noms-hk', 'anciens-noms-hk.json');
    if (fs.existsSync(FHK)) {
        const hk = AHK.lireAnciensNomsHk(lire(FHK));
        const m = TZ.fusionnerEspeces(ESPECES.table, hk.table, hk.contestes);
        ESPECES = { table: m.table, stats: { ...ESPECES.stats, anciensNomsHk: hk.stats, fusionHk: m.stats } };
        journal.push('anciens noms de Hong Kong (' + hk.meta.sources.map(s => s.source + ' ' + s.licence + ' lu le ' + s.luLe).join(' + ') + ') : ' + JSON.stringify(hk.stats));
    } else journal.push('anciens noms de Hong Kong : AUCUN fichier — aucune traduction des noms de Hong Kong');
    journal.push('table des espèces PokeAPI (BSD-3-Clause, lue le ' + fs.readFileSync(path.join(dossier, 'pokeapi', 'LU-LE.txt'), 'utf8').slice(0, 10) + ') : ' + JSON.stringify(ESPECES.stats));
    const DEXIDS = lire(path.join(__dirname, '..', 'pokedex-dexids.json'));
    const cleProduit = TZ.fabriquerCleProduit(DEXIDS);
    const traduire = TZ.fabriquerTraducteur({ tableEspeces: ESPECES.table, tableAutres: TW, cleProduit });
    return { SETS, LABELS, TW, ESPECES, DEXIDS, cleProduit, traduire, journal };
}

module.exports = { SOURCE, CIBLES, groupeGem, confronter, juger, entreesDuSet, chargerSources };

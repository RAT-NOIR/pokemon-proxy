// METAL — ÉTAPE 3 : la recherche HORS LIGNE du vrai scan (la carte en métal ELLE-MÊME) dans les sources déjà ouvertes. AUCUNE requête réseau.
// node metal-recherche.js   -> couverture/S7/METAL/recherche.json
// Sources lues sur disque : clone TCGdex (le champ `thirdParty.cardmarket` lie une carte à un idProduct), sitemaps pkmncards en cache (adresse de page + adresse d'image),
// PTCG-database (JSON pkmncards, rien exécuté), liste des sets pokedata (fixture), liste des sets Pokéllector (fixture). pokemontcg.io : voir `pokemontcgio` dans la sortie.
// Une adresse candidate n'est JAMAIS une preuve : le coordinateur regarde, la collecte qui suivra contrôle à l'œil.
'use strict';
const fs = require('fs');
const path = require('path');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { RACINE_METAL } = require('./metal-reperage');
const { retenuPourPlanche } = require('./metal-planches');

const B = 'C:\\Users\\Yung\\rat-market-travail\\catalogue';
const TCGDEX = path.join(B, 'exports', 'tcgdex-clone-2026-09-25', 'data');
const SITEMAPS = path.join(B, 'pkmncards-cache', 'sitemaps');
const PTCGDB = path.join(B, 'sources-externes', 'PTCG-database', 'data_en');
const POKEDATA = path.join(B, 'c-pokedata', 'fixtures', 'pokedata-liste-des-sets.html');
const POKEDATA_JSON = path.join(B, 'c-pokedata', 'collecte-cartes', 'pokedata-sets-anglais.json');
const POKELLECTOR = path.join(B, 'c-pokellector', 'fixtures', 'pokellector', 'liste-sets.html');
// un mot de matière : « gold »/« golden » ENTIERS (pas Goldeen ni Golduck), « metal » hors « Metal Energy », « ultra-premium », « UPC »
const MOT_MATIERE = /(?<![a-z])(?:gold|golden)(?![a-z])|metal(?![a-z]*[- ]energy)|ultra[- ]?premium|(?<![a-z])upc(?![a-z])/i;

const slug = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nomNu = name => String(name ?? '').replace(/\s*\[.*$/, '').trim();

function* fichiers(dossier, filtre) {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        const p = path.join(dossier, e.name);
        if (e.isDirectory()) yield* fichiers(p, filtre); else if (filtre.test(e.name)) yield p;
    }
}

/** Le clone TCGdex : idProduct Cardmarket -> [{ fichier, nom, variantes }]. Une carte sans `thirdParty.cardmarket` n'est pas indexée (l'absence est comptée). */
function indexerTcgdex() {
    const parProduit = new Map(); let fichiersLus = 0, sansLien = 0;
    for (const f of fichiers(TCGDEX, /\.ts$/)) {
        const t = fs.readFileSync(f, 'utf8'); fichiersLus++;
        const ids = [...t.matchAll(/cardmarket:\s*(\d+)/g)].map(m => Number(m[1]));
        if (!ids.length) { sansLien++; continue; }
        const nom = (/name:\s*\{\s*en:\s*"([^"]+)"/.exec(t) || [])[1] ?? null;
        const variantes = [...t.matchAll(/type:\s*'([a-z-]+)'/g)].map(m => m[1]);
        const rel = path.relative(TCGDEX, f);
        for (const id of ids) { if (!parProduit.has(id)) parProduit.set(id, []); parProduit.get(id).push({ fichier: rel, nom, variantes: [...new Set(variantes)] }); }
    }
    return { parProduit, fichiersLus, sansLien };
}

function indexerSitemaps() {
    const entrees = [];
    for (const f of fichiers(SITEMAPS, /^pkmn_card-sitemap\d*\.xml$/)) {
        const x = fs.readFileSync(f, 'utf8');
        for (const bloc of x.split('<url>').slice(1)) {
            const page = (/<loc>(https:\/\/pkmncards\.com\/card\/[^<]+)<\/loc>/.exec(bloc) || [])[1];
            if (page) entrees.push({ page, image: (/<image:loc>([^<]+)<\/image:loc>/.exec(bloc) || [])[1] ?? null });
        }
    }
    return entrees;
}

function indexerPtcgdb() {
    const lus = []; let n = 0;
    for (const f of fichiers(PTCGDB, /\.json$/)) {
        let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
        n++; lus.push({ f: path.relative(PTCGDB, f), name: j.name, set: j.set_full_name, rarity: j.rarity ?? null, url: j.url, img: j.img, number: j.number });
    }
    return { lus, n };
}

function nomsDeSets(fichier, json) {
    if (!fs.existsSync(fichier)) return null;
    const t = fs.readFileSync(fichier, 'utf8');
    const motifs = json ? [].concat(JSON.parse(t).noms || []) : [...t.matchAll(/>([^<>]{3,80})</g)].map(m => m[1].trim());
    return { fichier, noms: motifs.filter(s => MOT_MATIERE.test(s) || /celebrations|151|premium|anniversary/i.test(s)).slice(0, 60), lus: motifs.length };
}

async function main() {
    const { candidats } = JSON.parse(fs.readFileSync(path.join(RACINE_METAL, 'candidats.json'), 'utf8'));
    // les « ciblés » : les propositions « metal » et les douteux à bordure or avec indice de nom ; les 116 « autre matière » sont cherchés par idProduct seulement (TCGdex)
    const liste = candidats.filter(retenuPourPlanche);
    const cibles = liste.filter(c => c.verdict === 'metal' || (c.verdict === 'douteux' && c.classe === 'or'));
    const T = indexerTcgdex(), S = indexerSitemaps(), P = indexerPtcgdb();
    const sorties = [];
    for (const c of liste) {
        const cible = cibles.includes(c), nom = nomNu(c.name), ns = slug(nom);
        const tcg = { lui: T.parProduit.get(c.idProduct) || [], freres: c.freres.flatMap(f => (T.parProduit.get(f) || []).map(x => ({ idProduct: f, ...x }))) };
        const sortie = { idProduct: c.idProduct, name: c.name, verdict: c.verdict, expansion: c.expansion, ciblé: cible, tcgdex: tcg };
        if (cible) {
            const jetons = slug(c.expansion).split('-').filter(w => w.length > 2 && !['the', 'and', 'collection', 'pokemon', 'card'].includes(w));
            const parSitemap = S.filter(e => { const u = e.page.replace('https://pkmncards.com/card/', ''); return u.startsWith(ns + '-') && (MOT_MATIERE.test(u) || jetons.some(j => u.includes(j))); });
            sortie.pkmncards = parSitemap.slice(0, 12);
            sortie.pkmncardsMatiere = parSitemap.filter(e => MOT_MATIERE.test(e.page));
            sortie.ptcgdb = P.lus.filter(x => x.name && slug(x.name) === ns && (MOT_MATIERE.test(`${x.rarity} ${x.set} ${x.url}`) || jetons.some(j => slug(x.set).includes(j)))).slice(0, 12);
        }
        sorties.push(sortie);
    }
    const generalMatiere = {
        pkmncardsSitemaps: S.filter(e => MOT_MATIERE.test(e.page)).slice(0, 60),
        ptcgdb: P.lus.filter(x => MOT_MATIERE.test(`${x.rarity} ${x.set} ${x.url} ${x.name}`)).slice(0, 60),
        // toutes les pages pkmncards de l'ensemble Celebrations : une page de carte en métal y figurerait-elle ? (lecture à l'œil de la liste)
        pkmncardsCelebrations: S.filter(e => /celebrations|25th|anniversary/.test(e.page)).map(e => e.page.replace('https://pkmncards.com/card/', '')),
        raretesPtcgdbMatiere: [...new Set(P.lus.map(x => x.rarity))].filter(r => r && MOT_MATIERE.test(r)),
    };
    const out = {
        date: '2026-10-18', instrument: 'lecture de fichiers locaux, zéro requête réseau',
        sources: { tcgdex: { racine: TCGDEX, fichiersLus: T.fichiersLus, sansLienCardmarket: T.sansLien, produitsIndexes: T.parProduit.size }, pkmncardsSitemaps: { entrees: S.length }, ptcgdb: { fichiersJson: P.n },
            pokedata: nomsDeSets(POKEDATA, false), pokedataJson: nomsDeSets(POKEDATA_JSON, true), pokellector: nomsDeSets(POKELLECTOR, false),
            pokemontcgio: 'aucun cache local de listes de cartes ou de sets (seulement des images sondées au lot PTCGIO-SETS : S7\\PTCGIO-SETS\\img) — non interrogeable hors ligne' },
        generalMatiere, candidats: sorties,
    };
    fs.writeFileSync(autoriser(path.join(RACINE_METAL, 'recherche.json'), [RACINE_METAL]), JSON.stringify(out, null, 1));
    const avecTcg = sorties.filter(s => s.tcgdex.lui.length).length, avecTcgFr = sorties.filter(s => s.tcgdex.freres.length).length;
    console.log(JSON.stringify({ candidats: sorties.length, ciblés: cibles.length, tcgdexLiensCandidat: avecTcg, tcgdexLiensFrere: avecTcgFr, sources: out.sources, matiereSitemaps: generalMatiere.pkmncardsSitemaps.length, matierePtcgdb: generalMatiere.ptcgdb.length }, null, 1));
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { slug, nomNu };

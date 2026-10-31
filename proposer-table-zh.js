// PROPOSITION (lecture seule, rien n'est écrit) d'une table de traduction zh -> clé, PROUVÉE PAR DEUX SOURCES INDÉPENDANTES :
//   source A = le libellé anglais que la source publie sur la page de la carte (labels.json) ;
//   source B = le produit Cardmarket qui porte le MÊME numéro dans le MÊME set (numeros_cartes de production) : son nom, ramené à sa clé par les fonctions de production.
// Un nom n'est proposé que si, pour TOUTES les entrées de la source qui le portent, A et B donnent la même clé. Une contradiction l'écarte.
// ⚠️ B n'est pas indépendante de la règle « carte par carte » : c'est elle. Elle ne sert ici qu'à PROUVER une traduction, jamais à l'écrire en base.
// Usage : node proposer-table-zh.js   (NODE_PATH = node_modules du dépôt principal)
const fs = require('fs'), path = require('path');
const DOSSIER = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET';
require('C:/Users/Yung/Desktop/pokemon-proxy/node_modules/dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { produitsDeLExpansion, cleNumero } = require('./collecte-cartes/jointure');
const TZ = require('./collecte-cartes/table-zh');
const lire = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const SETS = Object.fromEntries(fs.readdirSync(path.join(DOSSIER, 'cache', 'sets')).map(f => { const j = lire(path.join(DOSSIER, 'cache', 'sets', f)); return [j.etiquette, j]; }));
const LABELS = lire(path.join(DOSSIER, 'labels.json'));
const ESPECES = TZ.lireEspecesPokeApi(fs.readFileSync(path.join(DOSSIER, 'pokeapi', 'pokemon_species_names.csv'), 'utf8')).table;
const TW = lire(path.join(DOSSIER, 'table-zh-tw.json')).table;
const cleProduit = TZ.fabriquerCleProduit(lire('C:/Users/Yung/Desktop/pokemon-proxy/pokedex-dexids.json'));
const traduire = TZ.fabriquerTraducteur({ tableEspeces: ESPECES, tableAutres: TW, cleProduit });
const nz = s => String(s).normalize('NFKC').replace(/\s+/g, '');
const LAT = /^[\x20-\x7EÀ-ɏ'’·\-:.&!]+$/;
// (set kado, expansion Cardmarket, numéro source -> numéro Cardmarket) ; Gem Pack : le numéro de la source est un groupe + position, Cardmarket n'a que le groupe
const LIGNES = [
    ['Gem Pack Vol. 4', 6447, n => cleNumero(String(n).slice(0, 2))],
    ['Gem Pack Vol. 5', 6544, n => cleNumero(String(n).slice(0, 2))],
    ['Phantasmal Flames', 6299, n => (/^\d+$/.test(n) ? cleNumero(n) : null)],
    ['Ascended Heroes', 6395, n => (/^\d+$/.test(n) ? cleNumero(n) : null)]
];
(async () => {
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    const preuves = new Map();   // nomZh -> { cles: Set(A), pour: [{set, numero, cleB}], contre: [] }
    try {
        for (const [etiquette, exp, versCM] of LIGNES) {
            const produits = await produitsDeLExpansion(cx.prod, exp);
            const parNumero = new Map();
            for (const p of produits) { const k = cleNumero(p.numero); if (k == null) continue; (parNumero.get(k) || parNumero.set(k, []).get(k)).push(cleProduit(p.name)); }
            for (const e of SETS[etiquette].cartes) {
                if (LAT.test(e.nomZh) || traduire(e.nomZh) != null) continue;   // seuls les noms aujourd'hui INTRADUISIBLES
                const nzom = nz(e.nomZh), a = LABELS[e.nomZh] && LABELS[e.nomZh].en ? cleProduit(LABELS[e.nomZh].en) : null;
                const P = preuves.get(nzom) || preuves.set(nzom, { nomZh: e.nomZh, libelle: LABELS[e.nomZh]?.en ?? null, cleA: a, pour: [], contre: [], sansTemoin: 0 }).get(nzom);
                const num = versCM(e.numero); const clesB = num ? parNumero.get(num) : null;
                if (!clesB || !clesB.length) { P.sansTemoin++; continue; }
                const uniques = [...new Set(clesB)];
                if (a && uniques.length === 1 && uniques[0] === a) P.pour.push(`${etiquette} ${e.numero}`); else P.contre.push(`${etiquette} ${e.numero}: B=${uniques.join('/')} A=${a}`);
            }
        }
    } finally { await cx.fermer(); }
    const acceptees = {}, refusees = [];
    for (const P of preuves.values()) {
        if (P.cleA && P.pour.length && !P.contre.length) acceptees[P.nomZh] = { cle: P.cleA, libelle: P.libelle, sourceA: 'libellé anglais publié par la source', sourceB: 'produit Cardmarket au même numéro/groupe, même clé', temoins: P.pour.length };
        else refusees.push({ nomZh: P.nomZh, libelle: P.libelle, raison: !P.cleA ? 'aucun libellé' : P.contre.length ? 'contradiction ' + P.contre[0] : 'aucun témoin Cardmarket au même numéro' });
    }
    const cat = c => (c[0] === 'D' ? 'espèce' : 'autre');
    const parCat = {}; for (const v of Object.values(acceptees)) parCat[cat(v.cle)] = (parCat[cat(v.cle)] || 0) + 1;
    fs.writeFileSync(path.join(DOSSIER, 'table-proposee.json'), JSON.stringify({ date: new Date().toISOString(), regle: 'deux sources indépendantes : libellé de la source + produit Cardmarket au même numéro ; PROPOSITION, rien d\'écrit', acceptees, refusees }, null, 1));
    console.log(`noms intraduisibles examinés ${preuves.size} · proposés (deux sources d'accord) ${Object.keys(acceptees).length} ${JSON.stringify(parCat)} · refusés/sans preuve ${refusees.length}`);
    console.log('refus :', refusees.slice(0, 12).map(r => `${r.nomZh}(${r.raison})`).join(' ; '));
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });

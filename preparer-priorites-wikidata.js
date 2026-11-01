// PRIORITÉS DE LA RÉCOLTE WIKIDATA (lecture seule, aucune requête réseau, aucune écriture en base) — 2026-10-31
//   node preparer-priorites-wikidata.js [--dossier=<FICHES-SET>] [--env=<.env>]   (NODE_PATH = node_modules du dépôt principal)
// Pour chaque nom INTRADUISIBLE d'espèce des listes de Gem Pack Vol. 4 et 5 (kado, déjà en cache) : le n° de Pokédex se déduit de NOTRE catalogue — les produits Cardmarket du MÊME numéro de groupe
// (« 05 05/15 »), leur nom anglais, pokedex-dexids.json. Ce n° ne sert QU'À L'ORDRE de la récolte (quelles espèces lire d'abord) ; il n'admet rien : c'est le libellé zh de Wikidata pour ce n°, lu
// indépendamment, qui sera comparé au libellé de la source (JALON-GEMPACK.json, champ `concordance`). Un groupe qui contient plusieurs espèces donne toutes ses espèces comme priorités.
// Sortie : <dossier>/wikidata/PRIORITES-GEMPACK.json  { especes: [{ dex, noms, sets }], sansEspece: [...] }
const fs = require('fs'), path = require('path');
const ARGS = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const DOSSIER = ARGS.dossier || 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET';
require('dotenv').config({ path: ARGS.env || 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
const TZ = require('./collecte-cartes/table-zh');
const lire = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const nz = s => String(s).normalize('NFKC').replace(/\s+/g, '');

const CIBLES = [{ nom: 'Gem Pack Vol. 4', exp: 6447 }, { nom: 'Gem Pack Vol. 5', exp: 6544 }];
const groupeGem = n => String(n).slice(0, 2);

async function main() {
    const SETS = Object.fromEntries(fs.readdirSync(path.join(DOSSIER, 'cache', 'sets')).map(f => { const j = lire(path.join(DOSSIER, 'cache', 'sets', f)); return [j.etiquette, j]; }));
    const TW = lire(path.join(DOSSIER, 'table-zh-tw.json')).table;
    const POKEAPI = TZ.lireEspecesPokeApi(fs.readFileSync(path.join(DOSSIER, 'pokeapi', 'pokemon_species_names.csv'), 'utf8'));
    const DEXIDS = lire(path.join(__dirname, 'pokedex-dexids.json'));
    const cleProduit = TZ.fabriquerCleProduit(DEXIDS);
    const traduire = TZ.fabriquerTraducteur({ tableEspeces: POKEAPI.table, tableAutres: TW, cleProduit });
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    const parDex = new Map(), sansEspece = [];
    try {
        for (const c of CIBLES) {
            if (!SETS[c.nom]) throw new Error(`liste kado « ${c.nom} » absente du cache`);
            const source = SETS[c.nom].cartes.map(x => ({ numero: String(x.numero), nomZh: x.nomZh }));
            const produits = await produitsDeLExpansion(cx.prod, c.exp);
            if (!produits.length) throw new Error(`aucun produit pour l'expansion ${c.exp} (grappe fausse ?)`);
            const intr = source.filter(e => traduire(e.nomZh) == null);
            console.log(`${c.nom} : ${source.length} entrées, ${produits.length} produits, ${intr.length} noms intraduisibles`);
            for (const e of intr) {
                const g = groupeGem(e.numero);
                const cles = [...new Set(produits.filter(p => p.numero != null && groupeGem(String(p.numero).replace(/\s+/g, '')) === g || String(p.numero ?? '').startsWith(g)).map(p => cleProduit(p.name)).filter(Boolean))];
                const dex = cles.filter(k => /^D\d+$/.test(k)).map(k => Number(k.slice(1)));
                console.log(`   ${e.numero} « ${e.nomZh} » → groupe ${g} : produits ${JSON.stringify(cles)} → n° ${JSON.stringify(dex)}`);
                if (!dex.length) { sansEspece.push({ set: c.nom, numero: e.numero, nomZh: e.nomZh, cles }); continue; }
                for (const d of dex) { const p = parDex.get(d) || { dex: d, noms: [], sets: [] }; if (!p.noms.includes(nz(e.nomZh))) p.noms.push(nz(e.nomZh)); if (!p.sets.includes(c.nom)) p.sets.push(c.nom); parDex.set(d, p); }
            }
        }
    } finally { await cx.fermer(); }
    const especes = [...parDex.values()].sort((a, b) => a.dex - b.dex);
    fs.mkdirSync(path.join(DOSSIER, 'wikidata'), { recursive: true });
    fs.writeFileSync(path.join(DOSSIER, 'wikidata', 'PRIORITES-GEMPACK.json'), JSON.stringify({ date: new Date().toISOString(), especes, sansEspece }, null, 1));
    console.log(`\n${especes.length} espèce(s) prioritaire(s) : ${especes.map(e => e.dex).join(', ')} · ${sansEspece.length} nom(s) intraduisible(s) sans espèce (Dresseurs, objets)`);
}
main().catch(e => { console.error('❌', e.message); process.exitCode = 1; });

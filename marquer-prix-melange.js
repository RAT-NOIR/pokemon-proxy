// ============================================================
// PRIX-MELANGE — MARQUER LES FICHES CARDMARKET DONT LE PRIX MÉLANGE LA VERSION NORMALE ET UNE VERSION TAMPONNÉE (testeur, 2026-10-17)
// ============================================================
//   node marquer-prix-melange.js [--liste=<fichier.json>]                                   (SIMULATION : lit les sources, imprime les comptes et les sauts, n'écrit rien)
//   node lot-additif.js --quoi="prixMelangeTampon : <N> fiches" --collections=cartes_produits --compte=cartes_produits -- node marquer-prix-melange.js --ecrire --attendu=<N>
//
// Sur la ligne `cartes_produits` de chaque idProduct concerné : `prixMelangeTampon: true`, `tamponsConnus: [...]`, `prixMelangeTamponPreuve: [...]` — et RIEN d'autre.
// Une fiche est concernée si une source de NOS données (clone TCGdex local, index Pokumon en cache) nomme un tampon de la liste fermée pour sa carte, et si Cardmarket n'a qu'UN produit pour cette carte.
// Les règles et leurs preuves vivent dans collecte-cartes/prix-melange.js. JAMAIS de requête réseau : tout vient de fichiers locaux et de la base `cartes`.
// Additif, idempotent. Un produit sans ligne cartes_produits (sans fiche) est listé à part, aucune ligne n'est créée.
const fs = require('fs');
const path = require('path');
const M = require('./collecte-cartes/prix-melange');

const CHEMINS = {
    export: 'C:/Users/Yung/rat-market-travail/catalogue/c-imports-gha/products_singles_6.json',
    clone: 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S4/DATES-CORR-relecture/clone/data',
    pokumon: 'C:/Users/Yung/Desktop/pokemon-proxy/collecte-cartes/rapports/cache-pokumon/index-familles.json',   // le cache de main (non suivi par git) : jamais le réseau
    paires: 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/CM-PASSIF/ADRESSES-64-PAIRES.json',
    // troisième source : le relevé du testeur (COPIE du fichier du testeur, lue seule)
    releve: 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/TAMPONS-RELEVE/tampons-scans-2026-10-18.csv'
};
const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--liste=.+$/, /^--export=.+$/, /^--clone=.+$/, /^--pokumon=.+$/, /^--paires=.+$/, /^--releve=.+$/];

/** Lit les sources locales (rien de réseau) et rend le plan. `cartesDb` : la base `cartes` (lecture seule suffit pour le plan). */
async function construire({ cartesDb, chemins = CHEMINS, log = console.log }) {
    const ex = JSON.parse(fs.readFileSync(chemins.export, 'utf8'));
    const produits = ex.products;
    if (!Array.isArray(produits) || !produits.length) throw new Error(`${chemins.export} : aucun produit — un export vide ne prouve rien`);
    const idsExport = new Set(produits.map(p => p.idProduct));
    log(`DÉNOMINATEUR : ${produits.length} produits à l'export (${chemins.export}, créé le ${ex.createdAt ?? '?'})`);
    const paires = JSON.parse(fs.readFileSync(chemins.paires, 'utf8'));
    const exclus = new Set(paires.flatMap(p => (p.versions || []).map(v => v.idProduct)));
    if (!exclus.size) throw new Error(`${chemins.paires} : aucun idProduct — les 64 paires ne se lisent pas`);
    log(`   64 paires Black Star exclues : ${paires.length} paires, ${exclus.size} produits`);
    const clone = M.lireTemoinsClone(chemins.clone, idsExport);
    log(`   clone TCGdex : ${clone.nSets} sets, ${clone.nCartes} cartes lues → ${clone.temoins.length} cartes à tampon de la liste fermée ; variantes à produit propre (non mélangées) : ${clone.avecProduitPropre} ; sans nom : ${clone.sansNom}`);
    log(`   tampons du clone HORS liste fermée (jamais marqués) : ${JSON.stringify(Object.entries(clone.hors).sort((a, b) => b[1] - a[1]).slice(0, 12))}${Object.keys(clone.hors).length > 12 ? ' …' : ''}`);
    const pk = JSON.parse(fs.readFileSync(chemins.pokumon, 'utf8'));
    if (!Array.isArray(pk.entrees) || !pk.entrees.length) throw new Error(`${chemins.pokumon} : aucune entrée — un index vide ne prouve rien`);
    const poku = M.temoinsPokumon(pk.entrees);
    log(`   index Pokumon (cache du ${pk.le}) : ${pk.entrees.length} entrées → ${poku.temoins.length} à tampon de la liste fermée, ${poku.ecartes.length} écartées`);
    const lignes = await M.lireLignes(cartesDb);
    log(`   cartes_produits : ${lignes.length} lignes · ${lignes.filter(l => l.variante).length} déjà séparées (variante) · ${lignes.filter(l => l.prixMelangeTampon === true).length} déjà marquées`);
    let releve = { temoins: [], ecartes: [], lues: 0, non: 0 };
    if (chemins.releve) {
        releve = M.temoinsReleve(fs.readFileSync(chemins.releve, 'utf8'));
        log(`   relevé du testeur (${chemins.releve}) : ${releve.lues} lignes · ${releve.non} « fiche propre = non » → ${releve.temoins.length} témoins, ${releve.ecartes.length} écartés`);
    }
    const plan = M.construirePlan({ temoins: [...releve.temoins, ...clone.temoins, ...poku.temoins], produits, lignes, exclus, ecartes: [...poku.ecartes, ...releve.ecartes] });
    return { plan, clone, poku, releve, produits: produits.length, lignes: lignes.length, exclus: exclus.size };
}

async function executer({ cartesDb, ecrire = false, attendu, liste = null, chemins = CHEMINS, log = console.log }) {
    const c = await construire({ cartesDb, chemins, log });
    const { plan } = c, k = plan.comptes;
    log(`\n════ FICHES CONCERNÉES : ${k.fiches} (avec ligne cartes_produits) · SANS LIGNE : ${k.sansLigne} (listées à part, rien n'est créé) · SAUTÉES : ${k.sautes} ════`);
    log(`   par tampon ${JSON.stringify(k.parTampon)} · par source ${JSON.stringify(k.parSource)}`);
    if (k.sansLigne) log(`   sans ligne, par tampon ${JSON.stringify(k.sansLigneParTampon)}`);
    log(`   sautés par motif ${JSON.stringify(k.parMotif)}`);
    for (const s of plan.sautes.filter(x => !['prize-pack-produit-distinct', 'jumbo', 'place-de-league', 'pas-anglais'].includes(x.motif)).slice(0, 15)) log(`      ✗ ${s.source} ${s.enregistrement} « ${s.nom} » n° ${s.numero} : ${s.motif}${s.produits ? ' ' + JSON.stringify(s.produits) : ''}`);
    if (liste) {
        fs.mkdirSync(path.dirname(liste), { recursive: true });
        fs.writeFileSync(liste, JSON.stringify({ le: new Date().toISOString(), denominateurs: { produitsExport: c.produits, lignes: c.lignes, paires64: c.exclus, cloneSets: c.clone.nSets, cloneCartes: c.clone.nCartes, pokumonTemoins: c.poku.temoins.length },
            comptes: k, fiches: plan.fiches, sansLigne: plan.sansLigne, sautes: plan.sautes }, null, 1));
        log(`   liste complète → ${liste}`);
    }
    const r = await M.appliquer(cartesDb, plan, { ecrire, attendu });
    if (!ecrire) { log(`\n   (simulation — rien n'est écrit : ${r.aEcrire} ligne(s) le seraient${r.dejaFait ? ' ; TOUT EST DÉJÀ MARQUÉ' : ''} · déjà marquées ${r.deja} · séparées entre-temps ${r.sautees})`); return { ...c, r }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire : tout était déjà marqué (idempotent)' : `✅ écrit : ${r.ecrit} ligne(s) cartes_produits`}`);
    const apres = await construire({ cartesDb, chemins, log: () => {} });
    const verif = await M.appliquer(cartesDb, apres.plan, { ecrire: false });
    const bon = apres.plan.fiches.length === plan.fiches.length && verif.aEcrire === 0;
    log(`   relu : ${verif.deja} ligne(s) portent le marquage, ${verif.aEcrire} restent à marquer${bon ? '' : '  🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'}`);
    if (!bon) process.exitCode = 1;
    return { ...c, r, verif };
}

module.exports = { executer, construire, CHEMINS };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=<N>, --liste=, --export=, --clone=, --pokumon=, --paires=, --releve=`); process.exit(2); }
    const ecrire = process.argv.includes('--ecrire');
    const val = n => process.argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const a = val('attendu'), attendu = a !== undefined ? Number(a) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> (le nombre de fiches lu à la simulation) : rien n\'est écrit'); process.exit(2); }
    const chemins = { ...CHEMINS, ...Object.fromEntries(['export', 'clone', 'pokumon', 'paires', 'releve'].filter(n => val(n)).map(n => [n, val(n)])) };
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try {
            await executer({ cartesDb: cartes.db, ecrire, attendu, chemins, liste: val('liste') ?? path.join(__dirname, 'collecte-cartes', 'rapports', `prix-melange-${new Date().toISOString().slice(0, 10)}.json`) });
        } finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}

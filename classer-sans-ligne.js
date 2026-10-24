// ============================================================
// PHASE 3a, ÉTAPE 1 (suite) — CLASSER les 3 263 produits SANS LIGNE : cause (par l'instrument lancé) et route, par expansion. MESURE SEULE.
// ============================================================
//   node classer-sans-ligne.js --diag=<diag-produits.json> --cache=<dossier> --sortie=<dossier> [--tcgdex=<tcgdex-sl.json>] [--wcd=<wcd-ids.json>]
// Lit la sortie de mesurer-sans-ligne.js (qui a lancé joindre(), la relecture de la Setlist sur l'archive R2, les clés de désignation de la production…)
// et range chaque produit dans UNE cause et UNE route. Une cause se nomme par le résultat d'un instrument (jamais par « jamais enfilé », « sans ligne »).
const fs = require('fs');
const path = require('path');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const DIAG = arg('diag'), CACHE = arg('cache'), SORTIE = arg('sortie'), TCGDEX = arg('tcgdex'), WCD = arg('wcd');
if (!DIAG || !CACHE || !SORTIE) { console.error('usage : --diag= --cache= --sortie= [--tcgdex=] [--wcd=]'); process.exit(2); }
const L = n => JSON.parse(fs.readFileSync(path.join(CACHE, `${n}.json`), 'utf8'));
const d = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
const wcdIds = new Set(WCD ? JSON.parse(fs.readFileSync(WCD, 'utf8')) : []);
const tcg = TCGDEX ? JSON.parse(fs.readFileSync(TCGDEX, 'utf8')) : {};
const arg2 = arg('energies');
const energiesOrigine = arg2 ? JSON.parse(fs.readFileSync(arg2, 'utf8')) : {};
// la table TIRAGES de creer-sets-sans-page.js (preuves de tirage écrites), LUE comme texte : ce fichier est un script qui s'exécute à son chargement
const tiragesProuves = new Set([...fs.readFileSync(path.join(__dirname, 'creer-sets-sans-page.js'), 'utf8').split('const TIRAGES = {')[1].split('\n};')[0].matchAll(/(?:^|[\s,{])(\d{3,5}):\s*\[\s*'/g)].map(m => Number(m[1])));
if (!tiragesProuves.size) throw new Error('TIRAGES illisible');
const etat = new Map(L('collecte_etat_resume').map(e => [e._id, e]));
const nc = new Map(L('numeros_cartes').map(n => [n.idProduct, n]));
if (!d.length || !etat.size || !nc.size) throw new Error('jeu vide');

// ---------------- les causes ----------------
const CAUSES = {
    MS: 'Matière spéciale : produit de la table fermée (carte en métal…), détaché par décision du testeur du 2026-10-17',
    A: 'joindre() REJOUÉ à blanc sur les cartes du set joint ce produit (nom concordant) : la ligne n\'a pas été réécrite depuis l\'arrivée de la carte au set',
    A2: 'joindre() rejoué le joint à une carte d\'un AUTRE NOM : le numéro Cardmarket désigne une autre carte que le nom (jointure fausse, déjà détachée)',
    B1: 'expansion SANS ligne de table : énergie sans numéro',
    B2: 'expansion SANS ligne de table : produit sans numéro appris',
    B3: 'expansion SANS ligne de table : produit numéroté',
    C1: 'ligne de table NON vérifiée : énergie',
    C2: 'ligne de table NON vérifiée : produit',
    D1: 'ligne vérifiée, énergie de base sans numéro Cardmarket (page générique, aucune impression du set)',
    D2: 'ligne vérifiée, produit sans numéro Cardmarket (le nom seul ne désigne pas, \'setlist+nom\' coupé)',
    E0: 'ligne vérifiée SANS Setlist lue (voie « sans page », ou liste de deck) : aucune carte déclarante pour ce produit',
    E1a: 'numéro Cardmarket AU-DELÀ du dernier numéro de la Setlist archivée',
    E1b: 'numéro Cardmarket absent de la Setlist (dans sa plage)',
    E2: 'numéro présent dans la Setlist mais la page de la carte est un LIEN ROUGE (absente chez Bulbapedia)',
    E3: 'numéro présent dans la Setlist, page lue, produit non joint (la carte n\'a pas d\'impression de ce set au bon numéro)'
};
const lv = e => e.lignesTable.find(x => x.verifie);
function cause(e, p) {
    if (p.matiereSpeciale) return 'MS';
    if (p.rejeu) return p.rejeu.every(r => r.nomConcorde) ? 'A' : 'A2';
    if (!lv(e)) { const aucune = !e.lignesTable.length; return aucune ? (p.numero == null ? (p.energie ? 'B1' : 'B2') : 'B3') : (p.energie ? 'C1' : 'C2'); }
    if (p.energie && p.numero == null) return 'D1';
    if (p.numero == null) return 'D2';
    if (!p.setlist) return 'E0';
    if (p.setlist.entrees === 0) return p.setlist.auDela ? 'E1a' : 'E1b';
    if (p.setlist.lues === 0) return 'E2';
    return 'E3';
}

// ---------------- les routes ----------------
const R = { EX: 'ROUTE EXISTANTE', EC: 'ROUTE À ÉCRIRE', IN: 'À INSTRUIRE', PL: 'PLANCHER', HR: 'HORS ROUTE (décision)' };
function route(e, p, c) {
    if (c === 'MS') return [R.HR, 'matière spéciale (matiere-speciale.js) : décision du testeur, ni fiche ni visuel normal'];
    // LE HAPPY SET 6 (CSVH6C) : 144 produits au slugSet « Happy-Set-Trainers-Pokemon », rangés par l'export sous DEUX expansions (6922 : 104, 6328 : 40 — les n°003 à 042).
    // Ils n'appartiennent PAS au set SV-P/CS de 6328 : toute jointure par la ligne SV-P/CS leur donnerait un numéro de promo qui n'est pas le leur (9 jointures fausses au rejeu).
    if (nc.get(p.idProduct)?.slugSet === 'Happy-Set-Trainers-Pokemon') {
        if (p.croise?.carteId) return [R.EX, 'poser-par-metacarte.js (désignation croisée, production) — après création de la ligne CSVH6C'];
        return [R.EC, 'création du set Happy-Set-Trainers-Pokemon (code CSVH6C, exp 6922, zh-hans : preuve « famille » CSVH1C–CSVH5C) + fiche simple ; ligne à DEUX expansions (6922 et 6328) à écrire'];
    }
    if (wcdIds.has(p.idProduct)) return [R.EX, 'poser-wcd.js (clé code d\'origine + numéro, témoin du nom) — garde ATTENDU_SONDE périmée'];
    if (c === 'A') return [R.EX, 'rejeu de joindre() : collecteur-texte.js --set=<code> --reparser (archive R2, 0 requête)'];
    if (p.ks?.carteId) return [R.EC, 'clé « Setlist » (numéro ∧ page-carte lue ∧ nom) : calibrée 0 faux sur 18 318 jointures existantes'];
    if (p.freresCle?.carteId) return [R.EX, 'poser-fiches-par-freres.js (frères de métacarte dans le set, intl)'];
    if (p.croise?.carteId) return [R.EX, 'poser-par-metacarte.js (désignation croisée, production)'];
    if (p.croiseSansTirage?.carteId && (p.croiseSansTirage.freres || 0) >= 2) return [R.EC, 'désignation croisée SANS la clause de tirage, ≥ 2 frères joints (risque mesuré 0,62 % = celui de la clé de production)'];
    if (energiesOrigine[p.idProduct]?.carteId) return [R.EC, 'clé « énergie : code d\'origine + nom » → l\'unique carte de ce nom à impression dans le set d\'origine (candidate, non calibrée)'];
    // LE REPLI POUR L'IDENTIFICATION (ordre du testeur 24/10 : « crée leurs lignes (set, numéro, nom, langue) à partir des données Cardmarket ») : une FICHE SIMPLE
    // (modèle creer-sets-sans-page.js : une carte `_id` négatif par (nom, numéro), impression au tirage et au nom d'expansion du set). Elle ne désigne aucune carte
    // existante, donc ne peut pas désigner la mauvaise ; son défaut est le doublon le jour où la page arrive. Conditions écrites par ce qu'elles autorisent :
    // un tirage connu, et soit une ligne de table VÉRIFIÉE (le set et son tirage existent), soit une expansion de la table TIRAGES (preuve de tirage écrite).
    const tirageConnu = e.langue && e.langue !== 'inconnue';
    const permis = !!lv(e) || tiragesProuves.has(e.exp);
    if (c !== 'A2' && tirageConnu && permis && (p.numero != null || p.energie)) return [R.EC, p.numero != null ? 'fiche simple (Cardmarket : nom, numéro, expansion, tirage) — creer-sets-sans-page.js étendu aux sets à ligne vérifiée' : 'fiche simple d\'énergie sans numéro (une par set et par nom) — creer-sets-sans-page.js étendu'];
    if (c === 'A2') return [R.IN, 'le numéro Cardmarket désigne une autre carte ; aucune clé à témoin indépendant ne désigne la vraie'];
    if (!tirageConnu) return [R.IN, 'tirage inconnu : expansion jamais apprise ou sans preuve de tirage (A-VALIDER)'];
    if (!permis) return [R.IN, c === 'C1' || c === 'C2' ? 'ligne de table non vérifiée : la vérification doit conclure (elle exige des requêtes Bulbapedia)' : 'expansion sans ligne ni preuve de tirage écrite (TIRAGES de creer-sets-sans-page.js) : A-VALIDER'];
    if (p.nMemeNom === 0) return [R.IN, 'aucune carte de ce nom en base et pas de numéro : texte à trouver (TCGdex data-asia, TPC Asie, page Bulbapedia)'];
    const detail = { E2: 'page Bulbapedia absente (lien rouge) ; la clé nom + attaques n\'a pas de témoin indépendant suffisant', E1a: 'la Setlist archivée est plus courte que les numéros Cardmarket : page à relire (requête Bulbapedia, hors de cette mesure)', E1b: 'numéro absent de la Setlist : aucune clé à témoin ne désigne', E3: 'carte présente mais la clé « Setlist » la refuse (nom discordant ou deux entrées)', D2: 'produit sans numéro ; aucune clé à témoin ne le désigne', C2: 'ligne non vérifiée : la vérification doit conclure avant toute jointure', C1: 'ligne non vérifiée', E0: 'voie sans page : aucune carte déclarante' }[c] || 'aucune clé calibrée ne le désigne';
    return [R.IN, detail];
}

// ---------------- boucle ----------------
const tot = { n: 0 }; const parRoute = {}, parCause = {}, parRouteFamille = {}, parCauseFamille = {};
const inc = (o, k, k2 = null) => { if (k2 == null) o[k] = (o[k] || 0) + 1; else { (o[k] = o[k] || {}); o[k][k2] = (o[k][k2] || 0) + 1; } };
const lignes = [];
for (const e of d) {
    const l = lv(e) || e.lignesTable[0] || null;
    const slugs = [...new Set([...e.lignesTable.map(x => x.slugSet), ...e.produits.map(p => nc.get(p.idProduct)?.slugSet)].filter(Boolean))];
    const codes = [...new Set(e.produits.map(p => nc.get(p.idProduct)?.codeSet).filter(Boolean))];
    const c = {}, r = {};
    const ex = { rejeu: 0, ks: 0, freres: 0, croise: 0, cst2: 0, nomAtt: 0, tcgdex: 0, memeNom0: 0, nouveaux: 0 };
    for (const p of e.produits) {
        const k = cause(e, p), rt = route(e, p, k);
        p._cause = k; p._route = rt;
        const kc = p.nouveau ? 'NV-' + k : k;
        c[kc] = (c[kc] || 0) + 1; r[`${rt[0]} · ${rt[1]}`] = (r[`${rt[0]} · ${rt[1]}`] || 0) + 1;
        tot.n++; inc(parRoute, rt[0]); inc(parCause, kc); inc(parRouteFamille, rt[0], e.famille); inc(parCauseFamille, kc, e.famille);
        if (p.rejeu) ex.rejeu++; if (p.ks?.carteId) ex.ks++; if (p.freresCle?.carteId) ex.freres++; if (p.croise?.carteId) ex.croise++; if (p.croiseSansTirage?.carteId && (p.croiseSansTirage.freres || 0) >= 2) ex.cst2++; if (p.nomAttaques?.carteId) ex.nomAtt++; if (tcg[p.idProduct]?.temoinNom) ex.tcgdex++; if (!p.nMemeNom) ex.memeNom0++; if (p.nouveau) ex.nouveaux++;
    }
    const ceSlug = slugs.map(s => etat.get(s)).find(Boolean);
    const sxl = e.rejeuLignes.find(x => x.setlist)?.setlist || null;
    lignes.push({
        exp: e.exp, slugs, codes, famille: e.famille, langue: e.langue, type: e.type, sansLigne: e.sansLigne, total: e.total,
        numerosCartes: { apprisPourLesSL: e.produits.filter(p => p.ncPresent).length, avecNumero: e.produits.filter(p => p.numero != null).length },
        tableDeLignes: e.lignesTable.map(x => `${x.t}:${x.code} ${x.verifie ? 'VÉRIFIÉE' : 'non vérifiée' + (x.raisons?.length ? ' (' + x.raisons.join(' ; ') + ')' : '')}${x.collecte ? ' · collecte ' + x.collecte : ''}`),
        collecteEtat: ceSlug ? { phase: ceSlug.phase, nTitres: ceSlug.nTitres, nPages: ceSlug.nPages, nManquants: ceSlug.nManquants } : null,
        rejeu: e.rejeuLignes.map(x => ({ code: x.code, cartes: x.nCartes, produits: x.nProduits, joints: x.nJoints, nouvellesLignes: x.nouvelles, dontSansLigne: x.nouvellesSL, lignesPerdues: x.perdues })),
        setlist: sxl && { revid: sxl.revid, entrees: sxl.retenues, liensRouges: sxl.nManquants, pages: sxl.nPages, maxNumero: sxl.maxNumero, ignorees: sxl.ignorees },
        causes: c, routes: r, cles: ex
    });
}
console.log(`CLASSÉS : ${tot.n} produits (attendu 3263) dans ${lignes.length} expansions`);
if (tot.n !== 3263) throw new Error('concordance fausse');
const nv = d.flatMap(e => e.produits.filter(p => p.nouveau).map(p => ({ exp: e.exp, p })));
fs.mkdirSync(SORTIE, { recursive: true });
fs.writeFileSync(path.join(SORTIE, 'causes.json'), JSON.stringify({
    le: new Date().toISOString().slice(0, 10), denominateur: tot.n, definitions: { causes: CAUSES },
    parRoute, parCause, parRouteFamille, parCauseFamille, expansions: lignes,
    produits: d.flatMap(e => e.produits.map(p => ({ idProduct: p.idProduct, exp: e.exp, nom: p.name, numero: p.numero, cause: (p.nouveau ? 'NV-' : '') + p._cause, route: p._route[0], voie: p._route[1], energie: p.energie, neuf: !!p.nouveau })))
}));
console.log('routes :', JSON.stringify(parRoute));
console.log('causes :', JSON.stringify(parCause));
console.log('route × famille :', JSON.stringify(parRouteFamille));
module.exports = { lignes, parRoute, parCause, parRouteFamille, parCauseFamille, CAUSES, nv: nv.length };

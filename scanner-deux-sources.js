// ============================================================
// PHASE 3a — la RÈGLE DES DEUX SOURCES, appliquée aux produits SANS LIGNE (mesure seule : copies locales + clone TCGdex local, 0 requête)
// ============================================================
//   node scanner-deux-sources.js --cache=<dossier> --diag=<diag-produits.json> --clone=<clone tcgdex> --sortie=<fichier.json> [--api=<releves-api.json>]
// Pour chaque produit : Cardmarket (export + numeros_cartes) = UNE source ; les autres sont lues dans les relevés indépendants de Cardmarket ET de Bulbapedia :
//   · `images` (hors source « bulbapedia ») : artofpkm, pikaqian, tpc-asie, pokumon, pokemontcg.io, tcgdex… — set (notre slug), numéro, nom ;
//   · `tpc_fiches` : TPC Asie / pokemon-card.com — le dénominateur imprimé (« M-P ») désigne la liste de la ligne TPC du set (tpc-sets.js) ; numéro, nom ;
//   · le clone TCGdex : le set TCGdex est relié à l'expansion Cardmarket (`thirdParty.cardmarket`), l'idProduct ou le numéro local désigne la carte ;
//   · `--api` : des relevés lus à l'API TCGdex (≤ 50 requêtes, 5 s d'intervalle), fichier produit par releve-tcgdex-api.js.
// Le jugement est celui de collecte-cartes/deux-sources.js (pur, liste fermée de sources admises, Bulbapedia refusée par son nom).
const fs = require('fs');
const path = require('path');
const { juger } = require('./collecte-cartes/deux-sources');
const { cleNumero, decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { TABLE_TPC } = require('./collecte-cartes/tpc-sets');
const { lireClone } = require('./poser-cartes-tcgdex');
const { champSur } = require('./collecte-cartes/lecture-sure');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CACHE = arg('cache'), DIAG = arg('diag'), CLONE = arg('clone'), SORTIE = arg('sortie'), API = arg('api');
if (!CACHE || !DIAG || !CLONE || !SORTIE) { console.error('usage : --cache= --diag= --clone= --sortie= [--api=]'); process.exit(2); }
const L = n => JSON.parse(fs.readFileSync(path.join(CACHE, `${n}.json`), 'utf8'));
const DEX = JSON.parse(fs.readFileSync(path.join(__dirname, 'pokedex-dexids.json'), 'utf8'));
const cleDex = s => String(s || '').toLowerCase().replace(/[^a-z0-9δ]+/g, '');

const diag = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
const nc = new Map(L('numeros_cartes').map(n => [n.idProduct, n]));
const cat = new Map(L('catalogue_produits').map(c => [c.idProduct, c]));
const images = L('images_autres'), tpc = L('tpc_fiches');
champSur(images, 'set', { collection: 'images (hors Bulbapedia)' }); champSur(tpc, 'fiche.numero', { collection: 'tpc_fiches' });
const clone = lireClone(CLONE);
console.log(`DÉNOMINATEURS : produits ${diag.reduce((t, e) => t + e.sansLigne, 0)} · images hors Bulbapedia ${images.length} · tpc_fiches ${tpc.length} · clone TCGdex ${clone.cartes.length} cartes / ${clone.sets.size} sets`);
if (!clone.cartes.length) throw new Error('clone vide');

// --- index des relevés
const parSetNum = new Map();   // `${set}|${numero}` -> relevés
const ajouter = (set, numero, r) => { if (!set || numero == null || String(numero).trim() === '') return; const k = `${set}|${cleNumero(String(numero))}`; (parSetNum.get(k) || parSetNum.set(k, []).get(k)).push({ ...r, set, numero }); };
// (PikaQian n'est PAS lu ici : ses images ont été jointes à nos produits par NOTRE chaîne, leur numéro n'est pas indépendant ; ses TUILES sont lues plus bas, calibrées par set)
// 🔴 (D2, 2026-10-24) MESURÉ : sur la collection `images`, le `nomEn` de TOUTES les sources sauf artofpkm est IDENTIQUE au `nomEn` de NOTRE carte joint par `carteId` (tcgdex 21 733/21 733,
// tpc-asie 1 957/1 957, pikaqian 8 793/8 793, pokumon 605/605…) : c'est le nom de notre carte (venu de Bulbapedia), copié à la jointure — pas celui de la source. Seul artofpkm porte
// son propre nom (1 020 noms différents du nôtre, dont « Pi » / « Pidgeot »). Un nom copié de la carte confirme la carte par elle-même : il ne compte donc PAS. Les autres sources se lisent
// là où elles portent LEUR nom : le clone TCGdex, `tpc_fiches` (TPC Asie, pokemon-card.com), les tuiles PikaQian. Pokumon, pokemontcg.io, CardTrader, pkmncards, pokedata, Pokéllector : sans
// nom propre dans nos copies, elles ne confirment rien (et le disent : « nom absent »).
const SOURCE_IMAGES = { artofpkm: 'artofpkm' };
for (const im of images) {
    const s = SOURCE_IMAGES[im.source]; if (!s) continue;
    ajouter(im.set, im.numero, { source: s, nom: im.nomEn ?? (im.titre ? String(im.titre).split(',')[0] : null), ref: `images ${im._id}` });
}
// PikaQian : les TUILES des pages passives et des fiches apprises (nom, numéro), rattachées à nos sets par la table du dépôt, puis CALIBRÉES par set sur les produits déjà joints :
// un set n'est lu que s'il est prouvé (0 conflit, >= 20 accords). Les produits « joints » = ceux qui ont une ligne dans cartes_produits (copie locale).
const { TABLE_PIKAQIAN } = require('./collecte-cartes/pikaqian-sets');
const { relevesPikaqian, calibrer } = require('./collecte-cartes/releves-locaux');
const CATALOGUE = arg('catalogue') || 'C:/Users/Yung/rat-market-travail/catalogue';
const pqR = relevesPikaqian(CATALOGUE, TABLE_PIKAQIAN);
const lignesDe = new Set(L('cartes_produits').map(l => l.idProduct));
const joints = [];
for (const [id, n] of nc) if (lignesDe.has(id) && n.slugSet && n.numero != null && String(n.numero).trim() !== '' && cat.get(id)) joints.push({ idProduct: id, set: n.slugSet, numero: String(n.numero), nom: decomposerNomCardmarket(cat.get(id).name).nom });
const calPq = calibrer(pqR.releves, joints);
console.log(`PIKAQIAN : ${pqR.releves.length} tuiles lues (${pqR.pages} pages ; sans set dans la table : ${pqR.pagesSansSet.join(', ') || 'aucune'}) · produits joints de comparaison ${joints.length} · sets CALIBRÉS ${calPq.calibres.length} / ${Object.keys(calPq.parSet).length} comparés`);
for (const s of ['Scarlet-Violet-Simplified-Chinese-Promos']) console.log(`   ${s} : ${JSON.stringify(calPq.parSet[s] || 'aucun produit joint comparé')}`);
for (const r of pqR.releves) if (calPq.calibres.includes(r.set)) ajouter(r.set, r.numero, { source: 'pikaqian', nom: r.nom, ref: r.ref });
// TPC : la ligne TPC du set désigne (site, langue, code imprimé). (D2) Le nom d'une fiche JAPONAISE reste japonais : la table « nom japonais → nom anglais » de nos cartes vient de Bulbapedia (nomJa), elle
// ne sert PAS ; sans nom lisible ni n° de Pokédex en commun, la fiche ne confirme rien (un trou, jamais une devinette).
const fichesTpc = tpc.map(f => ({ site: f.site, langue: f.langue, idFiche: f.idFiche, url: f.url, fiche: f.fiche }));
// les fiches lues EN LIGNE le 2026-10-24 (releve-tpc-en-ligne.js) : celles qui ne sont pas déjà dans le cache s'ajoutent
if (arg('pcc')) { const J = JSON.parse(fs.readFileSync(arg('pcc'), 'utf8')); const deja = new Set(tpc.map(f => `${f.site}/${f.langue}/${f.idFiche}`)); for (const f of J.fiches) if (!deja.has(`${J.site}/${J.langue}/${f.idFiche}`)) fichesTpc.push({ site: J.site, langue: J.langue, idFiche: f.idFiche, url: f.url, fiche: f }); console.log(`   pokemon-card.com lu en ligne : ${J.fiches.filter(f => !f.cache).length} fiche(s) nouvelle(s) ajoutée(s) au cache local (${J.requetes} requêtes)`); }
for (const f of fichesTpc) {
    const lignes = TABLE_TPC.filter(l => l.site === (f.site === 'tpc-asie' ? 'tpc-asie' : 'pokemon-card-com') && l.langue === f.langue && (f.fiche?.denominateur ?? null) != null && String(l.code) === String(f.fiche.denominateur));
    for (const l of lignes) ajouter(l.slug, f.fiche.numero, { source: f.site === 'tpc-asie' ? 'tpc-asie' : 'pokemon-card-com', nom: f.fiche.nom, dex: f.fiche.dex ? [].concat(f.fiche.dex) : null, ref: f.url ?? `${f.site}/${f.langue}/${f.idFiche}` });
}
// TCGdex (clone) : par idProduct, sinon par (expansion Cardmarket du set TCGdex, numéro local)
const parId = new Map(); for (const c of clone.cartes) for (const id of c.ids) (parId.get(id) || parId.set(id, []).get(id)).push(c);
const expDuDossier = new Map([...clone.sets].map(([d, s]) => [d, s.exp]));
const parExpNum = new Map(); for (const c of clone.cartes) { const e = expDuDossier.get(c.dossier); if (e) (parExpNum.get(`${e}|${cleNumero(c.localId)}`) || parExpNum.set(`${e}|${cleNumero(c.localId)}`, []).get(`${e}|${cleNumero(c.localId)}`)).push(c); }
const releveApi = API ? JSON.parse(fs.readFileSync(API, 'utf8')) : {};

// UNE fonction pour réunir ce que les relevés indépendants disent d'un produit à (set, numéro) : la boucle des 3 263 produits ET l'évaluation des lignes d'un plan s'en servent (§21 bis)
function relevesDe(idProduct, set, numero) {
    const rel = [...(set && numero != null ? parSetNum.get(`${set}|${cleNumero(String(numero))}`) || [] : [])];
    const expP = cat.get(idProduct)?.idExpansion;
    for (const c of parId.get(idProduct) || []) rel.push({ source: 'tcgdex', set: expDuDossier.get(c.dossier) === expP ? set : `exp ${expDuDossier.get(c.dossier)}`, numero: c.localId, nom: c.en, dex: c.dex, ref: c.tcgdexId });
    if (!(parId.get(idProduct) || []).length && numero != null) for (const c of parExpNum.get(`${expP}|${cleNumero(String(numero))}`) || []) rel.push({ source: 'tcgdex', set, numero: c.localId, nom: c.en, dex: c.dex, ref: c.tcgdexId });
    for (const r of releveApi[idProduct] || []) rel.push({ ...r, set: r.set ?? set });
    return rel;
}
// code d'origine → ses expansions (codes_set) → les slugs de set qui portent ces expansions (numeros_cartes.slugSet) : pour juger une ligne à code d'origine (plan WCD / SEA)
const expsDuCode = new Map(); for (const c of L('codes_set')) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
const slugsParExp = new Map(); for (const x of nc.values()) if (x.idExpansion != null && x.slugSet && !/^WCD/.test(x.slugSet)) (slugsParExp.get(x.idExpansion) || slugsParExp.set(x.idExpansion, new Set()).get(x.idExpansion)).add(x.slugSet);
const res = {}; const parSource = {}; let n = 0, ok = 0, okNeufs = 0, neufs = 0;
for (const e of diag) for (const p of e.produits) {
    n++;
    const N = nc.get(p.idProduct); const set = N?.slugSet ?? null;
    const dn = decomposerNomCardmarket(p.name);
    const produit = { set, numero: N?.numero ?? null, nom: dn.nom };
    const rel = relevesDe(p.idProduct, set, produit.numero);
    const dexProduit = DEX[cleDex(dn.nom)] ?? null;
    const j = juger(produit, rel, { dexProduit });
    res[p.idProduct] = { exp: e.exp, set, numero: produit.numero, nom: produit.nom, neuf: !!p.nouveau, ...j };
    if (p.nouveau) neufs++;
    if (j.ok) { ok++; if (p.nouveau) okNeufs++; for (const s of j.sources.filter(x => x !== 'cardmarket')) parSource[s] = (parSource[s] || 0) + 1; }
}
console.log(`PASSENT la règle des deux sources : ${ok} / ${n} (dont neufs ≥ 917000 : ${okNeufs} / ${neufs}) · par source indépendante : ${JSON.stringify(parSource)}`);
// ── LES LIGNES D'UN PLAN (lots 3 et 5 : des données tirées de Bulbapedia) : chaque ligne doit être confirmée par DEUX sources non-Bulbapedia sur (set, numéro de la FICHE, nom).
// Le numéro jugé est celui que la ligne écrirait (`numeroFiche`, sinon le numéro Cardmarket). Cardmarket compte comme une source SEULEMENT si son numéro est ce numéro-là ; sinon il ne
// confirme rien, et il faut deux sources indépendantes. Le plan se passe par `--plans=a.json,b.json` ; le résultat est écrit à côté de SORTIE.
const PLANS = arg('plans') ? arg('plans').split(',') : [];
const planRes = {};
for (const f of PLANS) {
    const P = JSON.parse(fs.readFileSync(f, 'utf8'));
    const nom = path.basename(f).replace(/\.json$/, '');
    const lignes = P.lignes.map(l => {
        const N = nc.get(l.idProduct); const dn = decomposerNomCardmarket(cat.get(l.idProduct)?.name ?? l.nomProduit ?? '');
        // (D1, 2026-10-24) UNE LIGNE À CODE D'ORIGINE (WCD, Southeast-Asia-Promos) : Cardmarket dit, dans le slug, « ce produit est <nom> du tirage d'origine <code> n°<numéro> » (UNE source). Il faut une SECONDE source
        // non-Bulbapedia qui dise que ce tirage d'origine, à ce numéro, porte ce nom : les relevés du set d'origine (artofpkm, TPC, tuiles PikaQian calibrées) et le clone TCGdex (par l'expansion Cardmarket du set d'origine).
        // La carte désignée dans notre base (qui vient de Bulbapedia) n'est PAS une source.
        if (l.origine) {
            const numeroO = l.origine.numero, exps = [...(expsDuCode.get(String(l.origine.code)) || [])];
            const concord = [], vus = [];
            for (const exp of exps) for (const slug of slugsParExp.get(exp) || []) {
                const rel = [...(parSetNum.get(`${slug}|${cleNumero(String(numeroO))}`) || [])];
                for (const c of parExpNum.get(`${exp}|${cleNumero(String(numeroO))}`) || []) rel.push({ source: 'tcgdex', set: slug, numero: c.localId, nom: c.en, dex: c.dex, ref: c.tcgdexId });
                vus.push(...rel.map(r => r.source));
                concord.push(...juger({ set: slug, numero: numeroO, nom: dn.nom }, rel, { dexProduit: DEX[cleDex(dn.nom)] ?? null }).concordantes);
            }
            const indepO = [...new Set(concord.map(c => c.source))];
            return { idProduct: l.idProduct, code: l.code ?? null, set: l.slugSet ?? N?.slugSet ?? null, numeroFiche: `${l.origine.code} n°${numeroO}`, nom: dn.nom, sources: ['cardmarket', ...indepO], ok: indepO.length >= 1,
                concordantes: concord.map(c => `${c.source}:${c.ref ?? ''} (${c.set} n°${c.numero} « ${c.nom ?? ''} »)`).slice(0, 3), cardmarketNumero: N?.numero ?? null, cmConfirme: true, origine: l.origine, relevesVus: [...new Set(vus)] };
        }
        const set = l.slugSet ?? N?.slugSet ?? null;
        const numero = l.numeroFiche ?? N?.numero ?? null;
        const rel = relevesDe(l.idProduct, set, numero);
        const j = juger({ set, numero, nom: dn.nom }, rel, { dexProduit: DEX[cleDex(dn.nom)] ?? null });
        const indep = [...new Set(j.concordantes.map(c => c.source))];
        const cmConfirme = Boolean(N && N.numero != null && numero != null && N.slugSet === set && cleNumero(String(N.numero)) === cleNumero(String(numero)));
        const sources = [...(cmConfirme ? ['cardmarket'] : []), ...indep];
        return { idProduct: l.idProduct, code: l.code ?? null, set, numeroFiche: numero, nom: dn.nom, sources, ok: sources.length >= 2 && indep.length >= 1, concordantes: j.concordantes.map(c => `${c.source}:${c.ref ?? ''}`).slice(0, 3), cardmarketNumero: N?.numero ?? null, cmConfirme };
    });
    const parCode = {}; for (const l of lignes) { const k = (parCode[l.code ?? '?'] ||= { lignes: 0, ok: 0, sources: {} }); k.lignes++; if (l.ok) { k.ok++; for (const s of l.sources) k.sources[s] = (k.sources[s] || 0) + 1; } }
    planRes[nom] = { lignes: lignes.length, ok: lignes.filter(l => l.ok).length, parCode, detail: lignes };
    console.log(`PLAN ${nom} : ${planRes[nom].ok} / ${lignes.length} lignes confirmées par deux sources non-Bulbapedia · ${JSON.stringify(parCode)}`);
}
if (PLANS.length) fs.writeFileSync(SORTIE.replace(/\.json$/, '-plans.json'), JSON.stringify(planRes));
fs.writeFileSync(SORTIE, JSON.stringify(res));
fs.writeFileSync(SORTIE.replace(/\.json$/, '-calibration-pikaqian.json'), JSON.stringify(calPq));

// ============================================================
// AJOUTER UN SET À UNE CARTE QUI Y A DÉJÀ UNE LIGNE — cartes.sets, $addToSet seul, sous lot
// ============================================================
//   node ajouter-set-par-ligne.js --carte=25392 --set=Challenge-from-the-Darkness --code=G2 --produit=605406 --attendu=1            (simulation : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=cartes -- node ajouter-set-par-ligne.js --carte=… --set=… --code=… --produit=… --attendu=1 --ecrire
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une seule carte ; chaque produit nommé (un, ou une liste fermée de 10 au plus) a une ligne `cartes_produits`
// `carte|produit` au `slugSet` EXACT du set, NON détachée (restes `fiche-contredite-par-la-vue`) ; la carte n'est pas déjà membre ; la règle R de production
// (regle-r-fiches.js, jugerRegleR, injectée : jamais de repli) AUTORISE chaque produit ; `--attendu` (obligatoire) = le nombre d'écritures planifiées (1).
// Écriture : UNE opération `$addToSet: { sets: { $each: [slug] } }` par `_id`, jugée par `garderEcritureSite` (liste fermée du site : liens.idProduct[0] et nomEn ne bougent pas).
// `--ecrire` ne tourne que SOUS lot-additif.js, enfant direct. Réversible : `$pull` du slug sur la carte.
const AUTORISES = [/^--carte=\d+$/, /^--set=[^\s,]+$/, /^--code=[^\s,]+$/, /^--produit=\d+$/, /^--produits=\d+(,\d+)*$/, /^--attendu=\d+$/, /^--ecrire$/];
const MAX_PRODUITS = 10;

function lireArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return { erreur: `argument inconnu ou invalide : ${inconnus.join(' ')} — autorisés : --carte=<id> --set=<slug> --code=<code de table> (--produit=<id> | --produits=<id,id…>) --attendu=N [--ecrire]` };
    const un = n => argv.filter(a => a.startsWith(`--${n}=`));
    for (const n of ['carte', 'set', 'code', 'produit', 'produits', 'attendu']) if (un(n).length > 1) return { erreur: `--${n} répété` };
    if (argv.filter(a => a === '--ecrire').length > 1) return { erreur: '--ecrire répété' };
    if (!un('carte').length || !un('set').length || !un('code').length) return { erreur: '--carte, --set et --code sont obligatoires' };
    if (un('produit').length + un('produits').length !== 1) return { erreur: 'exactement un de --produit ou --produits' };
    if (!un('attendu').length) return { erreur: '--attendu=N obligatoire (le nombre d\'écritures regardé en simulation)' };
    const produits = un('produit').length ? [Number(un('produit')[0].slice(10))] : un('produits')[0].slice(11).split(',').map(Number);
    if (produits.length > MAX_PRODUITS) return { erreur: `liste de ${produits.length} produits : ${MAX_PRODUITS} au plus` };
    return { carte: Number(un('carte')[0].slice(8)), set: un('set')[0].slice(6), code: un('code')[0].slice(7), produits, attendu: Number(un('attendu')[0].slice(10)), ecrire: argv.includes('--ecrire') };
}

/**
 * Le cœur, pur. a = { carte, set, produits, attendu } ; monde = { carteDoc, lignes (cartes_produits de la carte pour ces produits), interdits: Set « carte|produit » détachés } ;
 * juger(idProduct, carteDoc) → verdict de la règle R { autorise, regle, cause, raison }.
 */
function planifier(a, { carteDoc, lignes, interdits }, juger) {
    if (typeof juger !== 'function') throw new Error('planifier : règle R absente (juger) — jamais de repli');
    const refus = [];
    const R = m => { refus.push(m); };
    const ids = Array.isArray(a.produits) ? a.produits : [];
    if (!ids.length) R('aucun produit nommé');
    if (new Set(ids).size !== ids.length) R('doublon dans la liste de produits');
    if (!carteDoc) R(`carte ${a.carte} absente de la base`);
    else if ((carteDoc.sets || []).includes(a.set)) R(`la carte ${a.carte} est déjà membre de « ${a.set} » : rien à faire`);
    const decisions = [];
    for (const id of ids) {
        const l = (lignes || []).find(x => x.carteId === a.carte && x.idProduct === id);
        if (!l) { R(`aucune ligne cartes_produits ${a.carte}|${id}`); continue; }
        if (l.slugSet !== a.set) { R(`ligne ${a.carte}|${id} : slugSet ${JSON.stringify(l.slugSet ?? null)} ≠ ${JSON.stringify(a.set)}`); continue; }
        if (interdits && interdits.has(`${a.carte}|${id}`)) { R(`ligne ${a.carte}|${id} détachée (restes)`); continue; }
        if (!carteDoc) continue;
        const j = juger(id, carteDoc);
        decisions.push({ idProduct: id, autorise: !!j?.autorise, regle: j?.regle ?? null, cause: j?.cause, raison: j?.raison });
        if (!j || !j.autorise) R(`règle R refuse le produit ${id} (cause ${j?.cause ?? '?'}) : ${j?.raison ?? 'pas de verdict'}`);
    }
    const operations = refus.length ? [] : [{ updateOne: { filter: { _id: a.carte }, update: { $addToSet: { sets: { $each: [a.set] } } } } }];
    if (a.attendu === undefined || a.attendu === null) R('attendu absent');
    else if (a.attendu !== operations.length && !refus.length) R(`attendu ${a.attendu} différent des ${operations.length} écriture(s) planifiée(s)`);
    if (refus.length) operations.length = 0;
    return { ok: !refus.length, refus, operations, ecritures: operations.length, decisions };
}

/** `--ecrire` ne tourne que SOUS lot-additif.js : il pose LOT_ADDITIF_PID = son pid, et la commande en est l'enfant direct. */
function garderSousLot(env, ppid, commande = 'node lot-additif.js --quoi="…" --collections=cartes -- node ajouter-set-par-ligne.js --carte=… --set=… --code=… --produit=… --attendu=1 --ecrire') {
    if (!env || !env.LOT_ADDITIF_PID || env.LOT_ADDITIF_PID !== String(ppid)) throw new Error(`--ecrire refusé hors de lot-additif.js : ${commande} (rien n'est écrit)`);
}

/** Relecture après écriture : la carte porte le set. */
function releve({ carteDoc }, { set }) {
    const ok = !!carteDoc && (carteDoc.sets || []).includes(set);
    return { ok, detail: `carte ${carteDoc ? carteDoc._id : 'absente'} · sets ${JSON.stringify(carteDoc?.sets ?? null)}` };
}

async function lireMonde(db, a) {
    const { lireInterdits } = require('./collecte-cartes/lignes-detachees');
    const carteDoc = await db.collection('cartes').findOne({ _id: a.carte }, { projection: { nomEn: 1, sets: 1 } });
    const lignes = await db.collection('cartes_produits').find({ carteId: a.carte, idProduct: { $in: a.produits } }).toArray();
    const interdits = await lireInterdits(db.collection('restes'));
    return { carteDoc, lignes, interdits };
}

/** Simulation ou écriture, sur une base injectée. Rend { ok, code, message?, modifiees, plan, lignes[] } ; n'imprime rien. */
async function executer(db, a, juger) {
    const { garderEcritureSite } = require('./collecte-cartes/regle-r-fiches');
    const lignes = [];
    const m = await lireMonde(db, a);
    const plan = planifier(a, m, juger);
    lignes.push(`carte ${a.carte} → « ${a.set} » (code ${a.code}) : produits ${JSON.stringify(a.produits)} · ${m.lignes.length} ligne(s) lue(s) · sets actuels ${JSON.stringify(m.carteDoc?.sets ?? null)}`);
    for (const d of plan.decisions) lignes.push(`   règle R · produit ${d.idProduct} : ${d.autorise ? 'AUTORISE' : 'REFUSE'} ${d.regle ?? '—'} cause ${d.cause} : ${d.raison}`);
    if (!plan.ok) return { ok: false, code: 1, modifiees: 0, plan, lignes, message: `REFUS : ${plan.refus.join(' ; ')} — rien n'est écrit` };
    garderEcritureSite(plan.operations);
    lignes.push(`✓ ${plan.ecritures} écriture(s) planifiée(s) : $addToSet sets ${JSON.stringify(a.set)} sur la carte ${a.carte}`);
    if (!a.ecrire) return { ok: true, code: 0, modifiees: 0, plan, lignes };
    const r = await db.collection('cartes').bulkWrite(plan.operations, { ordered: true });
    if (r.modifiedCount !== 1) return { ok: false, code: 1, modifiees: r.modifiedCount || 0, plan, lignes, message: '🔴 ARRÊT : l\'écriture n\'a rien modifié (la carte porte déjà le set ?)' };
    const rl = releve(await lireMonde(db, a), a);
    lignes.push(`${rl.ok ? '✅' : '🔴'} 1/1 modifiée · RELU : ${rl.detail}`);
    return { ok: rl.ok, code: rl.ok ? 0 : 1, modifiees: 1, plan, lignes, message: rl.ok ? undefined : '🔴 la relecture ne concorde pas' };
}

/** Le verdict de la règle R de production pour (produit, carte) : contexte lu en base, règles du site importées — jamais copiées. */
async function construireJuger({ cartesDb, prodDb, a }) {
    const R = require('./collecte-cartes/regle-r-fiches');
    const { lireMongo } = require('./collecte-cartes/lecture-sure');
    const { ligne } = require('./collecte-cartes/table-sets');
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const L = ligne(a.code);
    if (!L) throw new Error(`code « ${a.code} » absent de la table des sets`);
    if (L.slugSet !== a.set) throw new Error(`le code ${a.code} désigne le set « ${L.slugSet} », pas « ${a.set} »`);
    const bases = await R.lireBases(cartesDb, lireMongo);
    const ctx = R.construireContexte(bases, await R.chargerSite());
    const lecturesExp = await produitsDeLExpansion({ db: prodDb }, L.idExpansion);
    const numDe = new Map(lecturesExp.map(x => [x.idProduct, x.numero]));
    const parId = new Map(bases.cartes.map(c => [c._id, c]));
    return (idProduct) => {
        const p = lecturesExp.find(x => x.idProduct === idProduct);
        if (!p) return { autorise: false, regle: null, cause: 'PRODUIT-ABSENT', raison: `produit ${idProduct} absent de l'expansion ${L.idExpansion}` };
        return R.jugerRegleR(ctx, { L, p, X: parId.get(a.carte), numDe });
    };
}

module.exports = { lireArguments, planifier, garderSousLot, releve, lireMonde, executer, construireJuger };

if (require.main === module) {
    const a = lireArguments(process.argv.slice(2));
    if (a.erreur) { console.error(`❌ ${a.erreur}`); process.exit(2); }
    require('dotenv').config({ quiet: true });
    if (a.ecrire) { try { garderSousLot(process.env, process.ppid); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    (async () => {
        const { ouvrirLecture } = require('./poser-fiches-prouvees');
        const cx = a.ecrire ? await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) : await ouvrirLecture();
        try {
            const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
            const juger = await construireJuger({ cartesDb, prodDb, a });
            const r = await executer(cartesDb, a, juger);
            for (const l of r.lignes) console.log(l);
            if (r.message) console.error(r.message);
            else if (!a.ecrire) console.log('(simulation seule — --ecrire sous lot-additif.js)');
            if (r.code) process.exitCode = r.code;
        } finally { await cx.fermer(); }
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}

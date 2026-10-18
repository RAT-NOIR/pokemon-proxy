// ============================================================
// LE PLAN TAIWAN — les produits Cardmarket de tirage zh-hant sans visuel, et ce que TPC Asie tw peut en couvrir (LECTURE SEULE, ZÉRO REQUÊTE)
// ============================================================
//   node plan-taiwan.js [--attendu=83] [--lecture=<lecture.js>] [--lecture-prod=<lecture-prod.js>]
// Décision du testeur (2026-10-17) : Taïwan ne comble que ce qui MANQUE. « Servi » se lit donc sans remplacement possible : une entrée existante, quelle qu'elle soit
// (basse définition, empruntée, fausse, correcte), SERT son numéro (`dejaServi`, la fonction de la production). Le plan est celui du collecteur (`planifier`, ligne en
// `sansRemplacement`), sur les fiches DÉJÀ en cache (`tpc_fiches`) : aucune requête, aucune écriture.
// Le dénominateur est le CATALOGUE Cardmarket des expansions des sets zh-hant (hors cartes-code), pas ce que nous avons joint : un produit sans fiche n'a pas de carte à imager.
const { ligneTpc } = require('./collecte-cartes/tpc-sets');
const T = require('./collecte-cartes/tpc');

const tirageDe = s => s.tirage ?? s.region;

async function planTaiwan({ db, produitsDuCatalogue, ligneDe = ligneTpc }) {
    const { planifier } = require('./collecteur-images-tpc');
    const sets = (await db.collection('sets').find({}).toArray()).filter(s => tirageDe(s) === 'zh-hant');
    if (!sets.length) throw new Error('aucun set de tirage zh-hant : lecture vide, je ne conclus pas');
    const rows = [];
    for (const s of sets) {
        const lignes = await db.collection('cartes_produits').find({ slugSet: s._id }).toArray();
        const cartes = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }).toArray()).map(c => [c._id, c]));
        const produits = new Set(lignes.map(l => l.idProduct));
        const servis = new Set(), servisParCarte = new Set();
        for (const l of lignes) {
            const c = cartes.get(l.carteId);
            if (T.dejaServi(c, s._id, l.numeroFiche)) servis.add(l.idProduct);
            if ((c?.images || []).some(e => e.set === s._id)) servisParCarte.add(l.idProduct);
        }
        const catalogue = produitsDuCatalogue ? await produitsDuCatalogue(s.idExpansion || []) : null;
        const row = { slug: s._id, catalogue: catalogue ?? produits.size, joints: produits.size, sansFiche: (catalogue ?? produits.size) - produits.size,
            servis: servis.size, sansVisuel: produits.size - servis.size, sansVisuelParCarte: produits.size - servisParCarte.size, ligne: false, fichesEnCache: 0, trous: 0, prouves: 0, restes: {} };
        const L = ligneDe('tpc-asie', s._id);
        if (L && L.langue === 'tw') {
            row.ligne = true;
            const etat = await db.collection('collecte_images_etat').findOne({ _id: `tpc-asie/${s._id}` });
            const ids = etat?.liste?.ids || [];
            const docs = ids.length ? await db.collection('tpc_fiches').find({ _id: { $in: ids.map(i => `tpc-asie/${L.langue}/${i}`) } }).toArray() : [];
            const fiches = docs.map(d => ({ ...d.fiche, idFiche: d.idFiche, urlFiche: d.url }));
            row.fichesEnCache = fiches.length; row.listeComplete = !!etat?.liste?.complete;
            const P = await planifier(db, s._id, { ...L, sansRemplacement: true }, fiches);
            row.trous = P.trous; row.prouves = P.plan.length;
            for (const r of P.restes) row.restes[r.motif] = (row.restes[r.motif] || 0) + 1;
        }
        rows.push(row);
    }
    const somme = k => rows.reduce((n, r) => n + r[k], 0);
    const total = { catalogue: somme('catalogue'), joints: somme('joints'), sansFiche: somme('sansFiche'), servis: somme('servis'), sansVisuel: somme('sansVisuel'), sansVisuelParCarte: somme('sansVisuelParCarte'),
        prouves: somme('prouves'), horsLigne: rows.filter(r => !r.ligne).reduce((n, r) => n + r.sansVisuel, 0) };
    return { sets: rows, total };
}

/** Le rapport lisible, et la comparaison à l'annonce, expliquée dans un sens comme dans l'autre. */
function lignesDuRapport(R, attendu) {
    const t = R.total, out = [];
    out.push(`DÉNOMINATEUR : ${t.catalogue} produits Cardmarket zh-hant (${R.sets.length} sets) · joints à une carte ${t.joints} · sans fiche ${t.sansFiche} · servis ${t.servis} · SANS VISUEL (joints) ${t.sansVisuel}`);
    for (const r of R.sets) out.push(`  ${r.slug} : catalogue ${r.catalogue}, joints ${r.joints}, servis ${r.servis}, sans visuel ${r.sansVisuel}${r.ligne ? `, ligne tw : ${r.fichesEnCache} fiches en cache, ${r.trous} trous, ${r.prouves} prouvés, restes ${JSON.stringify(r.restes)}` : ', AUCUNE ligne TPC tw (rien à demander sans mesure)'}`);
    out.push(`COUVERTS d'après le cache : ${t.prouves} · hors ligne de table : ${t.horsLigne}`);
    if (attendu != null) {
        const d = t.sansVisuel - attendu;
        out.push(d === 0 ? `ANNONCE ${attendu} : concorde avec les ${t.sansVisuel} produits joints sans visuel (règle numéro : \`dejaServi\`)`
            : `ANNONCE ${attendu} : écart de ${d > 0 ? '+' : ''}${d} (${Math.abs(d)} de ${d > 0 ? 'plus' : 'moins'} que l'annonce) ; par la règle « la carte a une entrée dans le set » le compte serait ${t.sansVisuelParCarte} ; produits sans fiche exclus : ${t.sansFiche}`);
    }
    return out;
}
module.exports = { planTaiwan, lignesDuRapport };

if (require.main === module) {
    const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const RACINE = 'C:/Users/Yung/rat-market-travail/catalogue/scratch/';
    (async () => {
        const { ouvrir } = require(arg('lecture') || RACINE + 'lecture.js');
        const prod = await require(arg('lecture-prod') || RACINE + 'lecture-prod.js').ouvrir();
        const cx = await ouvrir();
        const { estCarteCode } = require('./collecte-cartes/jointure');
        const R = await planTaiwan({ db: cx.db, produitsDuCatalogue: async ids => (await prod.db.collection('catalogue_produits').find({ idExpansion: { $in: ids } }, { projection: { name: 1 } }).toArray()).filter(p => !estCarteCode(p.name)).length });
        console.log(lignesDuRapport(R, arg('attendu') != null ? Number(arg('attendu')) : null).join('\n'));
        await cx.client.close(); await prod.client.close();
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}

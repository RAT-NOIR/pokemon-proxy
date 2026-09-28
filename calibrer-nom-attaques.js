// ============================================================
// CALIBRER LA CLÉ NOM + ATTAQUES (collecte-cartes/cle-nom-attaques.js) — LECTURE SEULE, zéro requête
// ============================================================
//   node calibrer-nom-attaques.js
//
// La population dont on connaît la vérité : les produits joints PAR LE NUMÉRO (preuve contenant « numero »), à UNE carte, dont le
// nom Cardmarket porte des crochets ou qui sont des Dresseurs/Énergies sans crochets. Le numéro est caché : la clé cherche dans la
// base ENTIÈRE. Deux mesures par forme de clé, imprimées séparément et jamais additionnées :
//   1. vraie carte PRÉSENTE : unique et juste / unique et FAUSSE / plusieurs (refus) / aucune (silence) ;
//   2. vraie carte RETIRÉE, sur TOUS les produits : la clé se tait-elle ? Une désignation ici est une fiche fausse le jour où le
//      texte du produit n'est pas chez nous — le cas même des Gem Packs, dont aucune carte n'a de page.
//      ⚠️ Rejouée d'abord sur les seules désignations justes, elle rendait « se tait 100 % » par construction (une clé qui ne
//      rend que la vraie carte ne rend rien sans elle) : le risque est dans les produits où la vraie carte avait une RIVALE.
// La désignation est celle de production : `designer()`, la clé ET sa garde (aucune autre carte du nom ne partage une attaque).
// Par population : toutes les jointures, puis les seules jointures CHINOISES (tirage zh-hans), les plus proches des Gem Packs.
require('dotenv').config();
// aucun argument (§54, relecture du 2026-09-28) : un argument inconnu refuse avant toute connexion
if (process.argv.length > 2) { console.error(`❌ argument inconnu : ${process.argv.slice(2).join(' ')} — calibrer-nom-attaques.js n'en prend aucun`); process.exit(2); }
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { indexer, designer, indexerMetacartes, designerCroise } = require('./collecte-cartes/cle-nom-attaques');
const EXPORT = 'products_singles_24092026.json';

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, 'impressions.tirage': 1, 'bulba.titre': 1 } });
    const toutes = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1, slugSet: 1, tirage: 1, preuve: 1 } });
    const lignes = toutes.filter(l => /numero/.test(l.preuve || ''));
    const tirageDuSet = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s.tirage ?? s.region]));
    const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const nomDe = new Map(catalogue.map(p => [p.idProduct, p.name])), metaDe = new Map(catalogue.map(p => [p.idProduct, p.idMetacard ?? null]));
    const parProduit = new Map();
    for (const l of lignes) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, { cartes: new Set(), tirage: l.tirage ?? tirageDuSet.get(l.slugSet) ?? null }).get(l.idProduct)).cartes.add(l.carteId);
    const index = indexer(cartes);
    const pop = [...parProduit].filter(([id, x]) => x.cartes.size === 1 && nomDe.has(id)).map(([id, x]) => ({ id, vrai: [...x.cartes][0], tirage: x.tirage, p: decomposerNomCardmarket(nomDe.get(id)) }));
    console.log(`DÉNOMINATEURS : ${cartes.length} cartes · ${lignes.length} lignes jointes par le numéro · ${parProduit.size} produits · population (une carte, nom au catalogue) ${pop.length}, dont chinoise (zh-hans) ${pop.filter(x => x.tirage === 'zh-hans').length}`);
    for (const [nomPop, P] of [['TOUTES', pop], ['CHINOISES (zh-hans)', pop.filter(x => x.tirage === 'zh-hans')]]) {
        for (const forme of ['egales', 'incluses']) {
            const r = { juste: 0, FAUX: 0, refus: 0, retireeTait: 0, retireeFAUX: 0 }, faux = [], fauxRetiree = [], raisons = {};
            for (const x of P) {
                const d = designer(index, x.p, { forme });
                if (!d.carte) { r.refus++; const k = d.raison.replace(/\(.*\)/, '(…)').replace(/^\d+/, '#'); raisons[k] = (raisons[k] || 0) + 1; }
                else if (d.carte._id === x.vrai) r.juste++;
                else { r.FAUX++; if (faux.length < 10) faux.push(`${x.id} « ${nomDe.get(x.id)} » → ${d.carte._id} « ${d.carte.nomEn} » (vrai ${x.vrai})`); }
                const d2 = designer(index, x.p, { forme, sauf: x.vrai });
                if (d2.carte) { r.retireeFAUX++; if (fauxRetiree.length < 10) fauxRetiree.push(`${x.id} « ${nomDe.get(x.id)} » → ${d2.carte._id} « ${d2.carte.nomEn} » [${(d2.carte.attaques || []).map(a => a.nom).join(' | ')}] (vrai ${x.vrai})`); } else r.retireeTait++;
            }
            const parle = r.juste + r.FAUX;
            console.log(`\n■ ${nomPop} · forme « ${forme} » · ${P.length} produits`);
            console.log(`   vraie carte présente : JUSTE ${r.juste} · FAUX ${r.FAUX} · refus ${r.refus} ${JSON.stringify(raisons)} · précision quand elle parle ${parle ? (100 * r.juste / parle).toFixed(3) : '—'} %`);
            console.log(`   vraie carte RETIRÉE (sur les ${P.length}) : se tait ${r.retireeTait} · désigne une AUTRE carte ${r.retireeFAUX}`);
            for (const f of faux) console.log(`      FAUX : ${f}`);
            for (const f of fauxRetiree) console.log(`      RETIRÉE → : ${f}`);
        }
    }
    // ── LA DÉSIGNATION CROISÉE (celle qu'écrit poser-par-metacarte.js) : métacarte ∧ nom+attaques ∧ tirage déjà imprimé
    const ctx = { index, parMeta: indexerMetacartes(toutes, id => metaDe.get(id)), metacarteDe: id => metaDe.get(id) };
    const carteDe = new Map(cartes.map(c => [c._id, c]));
    const contredites = [];
    for (const [nomPop, P] of [['TOUTES', pop], ['CHINOISES (zh-hans)', pop.filter(x => x.tirage === 'zh-hans')]]) {
        const r = { juste: 0, FAUX: 0, refus: 0, retireeTait: 0, retireeFAUX: 0 }, raisons = {}, retirees = [];
        for (const x of P) {
            const p = { ...x.p, idProduct: x.id };
            const d = designerCroise(ctx, p, { tirage: x.tirage });
            if (!d.carte) { r.refus++; const k = d.raison.replace(/\d+ cartes/, '# cartes').replace(/\(.*\)/, '(…)'); raisons[k] = (raisons[k] || 0) + 1; }
            else if (d.carte._id === x.vrai) r.juste++;
            else { r.FAUX++; if (nomPop === 'TOUTES') contredites.push({ idProduct: x.id, produit: nomDe.get(x.id), jointA: { carteId: x.vrai, titre: carteDe.get(x.vrai)?.bulba?.titre ?? carteDe.get(x.vrai)?.nomEn }, designe: { carteId: d.carte._id, titre: d.carte.bulba?.titre ?? d.carte.nomEn } }); }
            const d2 = designerCroise(ctx, p, { tirage: x.tirage, sauf: x.vrai });
            if (d2.carte) { r.retireeFAUX++; if (retirees.length < 10) retirees.push(`${x.id} « ${nomDe.get(x.id)} » → ${d2.carte._id} (vrai ${x.vrai})`); } else r.retireeTait++;
        }
        console.log(`\n■ ${nomPop} · DÉSIGNATION CROISÉE (métacarte ∧ nom+attaques ∧ tirage déjà imprimé ∧ crochets) · ${P.length} produits`);
        console.log(`   vraie carte présente : JUSTE ${r.juste} · CONTREDIT la jointure ${r.FAUX} · refus ${r.refus} ${JSON.stringify(raisons)}`);
        console.log(`   vraie carte RETIRÉE : se tait ${r.retireeTait} · désigne une AUTRE carte ${r.retireeFAUX}${retirees.length ? `\n      ${retirees.join('\n      ')}` : ''}`);
    }
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `fiches-contredites-cle-croisee-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(fichier, JSON.stringify(contredites, null, 1));
    console.log(`\n   ${contredites.length} jointures par le numéro CONTREDITES par la désignation croisée (à ouvrir une par une) → ${fichier}`);
    for (const c of contredites) console.log(`      ${c.idProduct} « ${c.produit} » : joint à ${c.jointA.carteId} « ${c.jointA.titre} » · la clé croisée désigne ${c.designe.carteId} « ${c.designe.titre} »`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

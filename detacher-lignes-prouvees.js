// ============================================================
// DÉTACHER DES LIGNES DE JOINTURE PROUVÉES FAUSSES — nommées une à une, rejugées au moment d'écrire
// ============================================================
//   node detacher-lignes-prouvees.js --decision=<date> --annonce=<fichier.json>    (simulation : rejuge chaque ligne, écrit l'annonce)
//   node lot-additif.js --quoi="…" --collections=restes --annonce=<fichier.json> -- node detacher-lignes-prouvees.js --decision=<date> --ecrire
//
// UNE LISTE FERMÉE PAR DÉCISION : un outil de détachement ne décide pas ce qui est faux, il applique une décision prise sur une
// preuve. Chaque décision garde sa liste (l'historique se relit) et une exécution n'en applique qu'UNE, nommée.
// · 2026-09-25 (soir) : « détacher uniquement les 3 lignes prouvées (Alolan Sandslash SM18, Volcanion, Exeggutor H10) » et
//   « Aquapolis : détache les 24 homonymes croisés » — Exeggutor H10 est l'un des 24 : 26 lignes en tout.
// · 2026-10-08 : les deux jointures fausses trouvées par l'épreuve de la catégorie (Umbreon ex SV-P143 -> Energy Sticker, Espeon ex
//   SV-P142 -> Double Dragon Energy). ⚠️ Le feu vert disait aussi « retirer l'impression n° 143 d'Energy Sticker » et « le
//   rattachement de Double Dragon Energy à Scarlet-Violet-Promos » : ils sont VRAIS (SV-P 143 et 142/231 chez artofpkm ET TCGdex,
//   produits 761017, 749923, 804761 joints, visuels du set) — ils ne se retirent pas ; seules les deux LIGNES sont fausses.
// 🔑 Et la preuve se REJOUE à l'écriture : si une seule ligne n'est plus contredite par son témoin (la base a bougé depuis la
// mesure), rien n'est écrit. Deux témoins, tous deux indépendants de la clé par le numéro qui a fabriqué la ligne :
//   · `attaques` : les attaques que Cardmarket écrit entre crochets désignent une AUTRE carte (score strictement supérieur) ;
//   · `nom`      : le nom du produit n'est pas le nom de la carte (« Volcanion » joint à Volcanion-EX).
// Les 24 d'Aquapolis ont été écrites le 20/09 par le bonus « jumeau » des sets e-Card japonais, avant que le témoin n'entre
// dans joindre() ; rejoué avec la jointure d'aujourd'hui (2026-09-25), le bonus ne les refait pas (190 lignes justes, 0 croisée).
// Un produit qui garde une autre ligne ne reçoit pas de reste ; un produit qui n'en garde aucune reçoit le reste de sa preuve.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { decomposerNomCardmarket, normaliserNom } = require('./collecte-cartes/jointure');

// `autre` : la carte que le témoin désigne à la place (attaques). Pour Aquapolis, c'est la carte de la ligne juste du même
// produit (slugSet « Aquapolis »), lue en base à l'exécution.
const AQUAPOLIS = ['41765|275087', '42177|275187', '42198|275191', '42499|275161', '42684|275125', '43524|275135', '43556|275137',
    '43558|275139', '48556|275193', '41499|275086', '41938|275165', '42500|275160', '41494|275085', '41517|275092', '41807|275093',
    '41926|275141', '41993|275182', '42269|275117', '42297|275144', '42298|275143', '42497|275159', '42498|275158', '43324|275130',
    '41764|275051'];
const DECISIONS = {
    '2026-09-25': [
        { id: '221206|358427', preuve: 'attaques', autre: 228226, type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'Alolan Sandslash SM18 : les attaques du produit désignent le document 228226 (TCGdex smp-SM127), pas 221206' },
        { id: '213157|553958', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Volcanion » joint à Volcanion-EX (TCGdex désigne deux autres documents Volcanion)' },
        ...AQUAPOLIS.map(id => ({ id, preuve: 'attaques', autre: 'aquapolis', type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'homonyme croisé d\'Aquapolis (bonus jumeau du 20/09) : les attaques désignent la carte de la ligne Aquapolis' }))
    ],
    // le nom + les attaques désignent UNE carte (323164, 323159), mais elle ne porte aucune impression jp SV-P, et les n° 143 et 142
    // du tirage SV-P sont Energy Sticker et Double Dragon Energy chez artofpkm ET TCGdex : la FICHE (set, numéro) n'est pas prouvée,
    // le produit reste non joint, la candidate est écrite dans le reste
    '2026-10-08': [
        { id: '286142|825498', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Umbreon ex [Moon Mirage | Onyx] » (SV-P143) joint par le numéro à Energy Sticker ; nom + attaques désignent 323164 (Umbreon ex, Prismatic Evolutions), qui n\'a pas d\'impression jp SV-P — fiche non prouvée, non joint' },
        { id: '203010|825497', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Espeon ex [Psych Out | Amazez] » (SV-P142) joint par le numéro à Double Dragon Energy ; nom + attaques désignent 323159 (Espeon ex, Prismatic Evolutions), qui n\'a pas d\'impression jp SV-P — fiche non prouvée, non joint' }
    ],
    // Lumineon V [Luminous Sign | Aqua Return] (Premium-Trainer-Box-ex n°008), joint par set+numero à Mareep (262554) ; les attaques
    // entre crochets désignent 267492 « Lumineon V » (qui déclare jp « Premium Trainer Box ex » 008) et le nom n'est pas « Mareep ».
    // Les DEUX témoins indépendants du numéro sont rejoués. La ligne juste 267492|692805 n'est PAS ajoutée ici (autre écriture).
    '2026-10-08b': [
        { id: '262554|692805', preuve: 'attaques+nom', autre: 267492, type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'Lumineon V (Premium Trainer Box ex 008) joint à Mareep par set+numero : les attaques désignent 267492 et le nom n\'est pas Mareep' }
    ],
    // FEU VERT NOMMÉ du testeur (2026-10-08) : les 7 jointures du Garchomp SP Half Deck (produits 676469-676474 et 676476) et la ligne
    // doublon Gastly 339431|860026. Chaque produit du kit est joint par set+numero à une carte d'un AUTRE nom dont aucune attaque
    // n'est celle que Cardmarket écrit entre crochets (preuve 'nom+attaques', rejouée). 676475 (Garchomp LV.X, ligne 154845) n'est
    // PAS nommée : elle ne se détache pas. Eldegoss V 481749 : interdit (voir INTERDITS).
    '2026-10-08c': [
        ...[['158470|676469', 'Magikarp'], ['158471|676470', 'Gyarados'], ['157992|676471', 'Electrike'], ['158472|676472', 'Manectric'],
            ['157993|676473', 'Gible'], ['154852|676474', 'Gabite'], ['158473|676476', 'Swablu']].map(([id, carte]) => ({
            id, preuve: 'nom+attaques', type: 'fiche-contredite-par-le-nom',
            pourquoi: `Garchomp SP Half Deck : le produit est joint par set+numero à ${carte}, d'un autre nom, qui ne porte aucune des attaques écrites par Cardmarket` })),
        { id: '339431|860026', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
            pourquoi: 'produit « Hole-Digging Shovel » joint à Gastly ; la bonne ligne 338279|860026 existe déjà (doublon par setlist+numero)' }
    ],
    // FEU VERT NOMMÉ du testeur (2026-10-08, tour 2) : « détacher Garchomp LV.X 676475, même preuve et même garde que les 7 autres ». Le produit
    // « Garchomp [C] LV.X [Healing Breath | Dragon Rush] » est joint par set+numero à 154845 « Garchomp » (Dragons Exalted 91 ; attaques Jet Headbutt
    // et Sand Tomb, aucune du produit). ⚠️ La preuve 'nom+attaques' des 7 ne s'applique pas à la lettre : le nom décomposé du produit commence par
    // « Garchomp », la règle du préfixe (pensée pour la rareté « Milotic C ») exempte donc 154845. Les DEUX témoins de 'attaques+nom' tiennent :
    // Dragon Rush est une attaque de 71777 « Garchomp C LV.X » (Supreme Victors 145), 1 contre 0 ; le nom n'est pas « Garchomp ». `autre` = 71777,
    // lu en base le 2026-10-08 (aucune carte ne porte « Healing Breath », un Poké-Power). La ligne juste 71777|676475 n'est PAS ajoutée ici.
    '2026-10-08d': [
        { id: '154845|676475', preuve: 'attaques+nom', autre: 71777, type: 'fiche-contredite-par-les-attaques',
            pourquoi: 'Garchomp LV.X (Garchomp SP Half Deck) joint par set+numero à Garchomp (Dragons Exalted 91) : les attaques écrites par Cardmarket désignent 71777 (Garchomp C LV.X) et le nom n\'est pas « Garchomp »' }
    ]
};

// Produits dont aucune ligne ne se détache par cet outil, quelle que soit la décision : la preuve n'est pas apportée.
const INTERDITS = [481749]; // Eldegoss V (V-Starter-Decks) — « on n'y touche pas, preuve à apporter » (feu vert du 2026-10-08)
const estInterdite = id => INTERDITS.includes(Number(String(id).split('|')[1]));

// Le rejeu d'une preuve, PUR (testable sans base). Rend { verdict } : une phrase si le témoin contredit encore la ligne, sinon null.
function jugerLigne(x, nomProduit, notre, autre) {
    if (estInterdite(x.id)) return { verdict: null };
    const d = decomposerNomCardmarket(nomProduit);
    const parAttaques = () => {
        const att = d.attaques.map(normaliserNom).filter(Boolean);
        const score = c => (c?.attaques || []).filter(a => att.includes(normaliserNom(a.nom))).length;
        const [sN, sA] = [score(notre), score(autre)];
        return att.length && autre && sA > sN ? `attaques [${d.attaques.join(' | ')}] : ${x.autre ?? 'autre'} ${sA} contre ${sN}` : null;
    };
    const parNom = () => normaliserNom(d.nom) !== normaliserNom(notre?.nomEn) ? `nom « ${d.nom} » ≠ carte « ${notre?.nomEn} »` : null;
    let verdict;
    if (x.preuve === 'attaques') verdict = parAttaques();
    else if (x.preuve === 'nom') verdict = parNom();
    else if (x.preuve === 'attaques+nom') { const a = parAttaques(), n = parNom(); verdict = a && n ? `${a} ; ${n}` : null; }
    else if (x.preuve === 'nom+attaques') {
        // le nom du produit n'est pas celui de la carte ET aucune des attaques du produit n'est sur la carte (produit sans attaque : refus)
        // le décomposeur laisse la rareté entre crochets dans le nom (« Milotic C ») : le nom de la carte doit être un PRÉFIXE du nom du produit
        const nc = normaliserNom(notre?.nomEn);
        const n = nc && normaliserNom(d.nom).startsWith(nc) ? null : parNom(), att = d.attaques.map(normaliserNom).filter(Boolean);
        const sur = (notre?.attaques || []).filter(a => att.includes(normaliserNom(a.nom))).length;
        verdict = n && att.length && notre && !sur ? `${n} ; aucune des attaques [${d.attaques.join(' | ')}] sur la carte` : null;
    }
    else verdict = null;
    return { verdict };
}

async function main() {
    const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/, /^--decision=\d{4}-\d{2}-\d{2}[a-z]?$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrire = process.argv.includes('--ecrire');
    const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
    const DECISION = process.argv.find(a => a.startsWith('--decision='))?.slice(11);
    const LIGNES = DECISIONS[DECISION];
    if (inconnus.length || ecrire === !!annonce || !LIGNES) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}${DECISION && !LIGNES ? `décision inconnue : ${DECISION} — ` : ''}usage : --decision=<${Object.keys(DECISIONS).join('|')}> --annonce=<fichier.json> (simulation) | --decision=<…> --ecrire`); process.exit(2); }

    const interdites = LIGNES.filter(x => estInterdite(x.id));
    if (interdites.length) { console.error(`❌ ligne(s) interdite(s) (preuve non apportée) : ${interdites.map(x => x.id).join(' ')} — rien n'est lu ni écrit`); process.exit(2); }
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const L = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes');
    const lignes = await L.find({ _id: { $in: LIGNES.map(x => x.id) } }).toArray();
    const parId = new Map(lignes.map(l => [l._id, l]));
    const ids = [...new Set(lignes.map(l => l.idProduct))];
    const nomCat = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const toutes = await L.find({ idProduct: { $in: ids } }).toArray();
    console.log(`\n════ ${LIGNES.length} lignes nommées · ${lignes.length} trouvées en base · ${ids.length} produits · ${toutes.length} lignes de ces produits ════`);
    const fautes = [], plan = [];
    for (const x of LIGNES) {
        const l = parId.get(x.id);
        if (!l) { fautes.push(`${x.id} : absente de la base`); continue; }
        const nom = nomCat.get(l.idProduct);
        if (!nom) { fautes.push(`${x.id} : produit ${l.idProduct} absent du catalogue`); continue; }
        const d = decomposerNomCardmarket(nom);
        const notre = await C.findOne({ _id: l.carteId }, { projection: { nomEn: 1, attaques: 1 } });
        let autreId = x.autre;
        if (autreId === 'aquapolis') autreId = toutes.find(t => t.idProduct === l.idProduct && t.slugSet === 'Aquapolis')?.carteId;
        const autres = toutes.filter(t => t.idProduct === l.idProduct && t._id !== l._id);
        const autre = x.preuve !== 'nom' && autreId != null ? await C.findOne({ _id: autreId }, { projection: { nomEn: 1, attaques: 1 } }) : null;
        const { verdict } = jugerLigne({ ...x, autre: autreId }, nom, notre, autre);
        if (!verdict) fautes.push(`${x.id} « ${nom} » : le(s) témoin(s) ${x.preuve} ne contredi(sen)t plus la ligne (carte jointe « ${notre?.nomEn} », autre ${autreId ?? '—'})`);
        if (verdict) plan.push({ x, l, nom, verdict, autres: autres.length });
        console.log(`   ${verdict ? '✅' : '🔴'} ${x.id} « ${nom} » exp ${l.idExpansion} ${l.slugSet ?? 'slugSet null'} (${l.preuve}) → ${verdict ?? 'NON CONTREDITE'} · le produit garde ${autres.length} autre(s) ligne(s)`);
    }
    if (fautes.length) { console.error(`\n🔴 ${fautes.length} ligne(s) ne se rejugent pas comme à la mesure — RIEN n'est écrit :\n   ${fautes.join('\n   ')}`); await fermer(); process.exitCode = 1; return; }

    // L'annonce : ce que la garde verra, comptée par SA fonction sur les expansions touchées, avant et après le retrait.
    const exps = [...new Set(lignes.map(l => l.idExpansion))];
    const avant = await L.find({ idExpansion: { $in: exps } }).project({ idExpansion: 1, idProduct: 1 }).toArray();
    const retirees = new Set(plan.map(p => p.l._id));
    const cmp = comparer(compterEtat({ cartesProduits: avant }), compterEtat({ cartesProduits: avant.filter(l => !retirees.has(l._id)) }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`   baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'} (un produit qui garde une autre ligne ne fait rien baisser)`);

    if (!ecrire) {
        fs.writeFileSync(path.resolve(annonce), JSON.stringify(baisses, null, 1));
        console.log(`   annonce écrite : ${annonce}\n   (simulation — rien n'est écrit en base)`);
        await fermer(); return;
    }
    const r = await L.deleteMany({ _id: { $in: plan.map(p => p.l._id) } });
    for (const p of plan) await C.updateOne({ _id: p.l.carteId }, { $pull: { 'liens.idProduct': p.l.idProduct } });
    let restes = 0;
    for (const p of plan.filter(p => !p.autres)) {
        restes++;
        await cx.db.collection('restes').updateOne({ set: p.l.slugSet, type: p.x.type, idProduct: p.l.idProduct, carteId: p.l.carteId },
            { $set: { detail: `${p.l.idProduct} « ${p.nom} » : joint par ${p.l.preuve} à ${p.l.carteId} — ${p.x.pourquoi} ; ${p.verdict} ; détachée par detacher-lignes-prouvees.js (feu vert du testeur, décision du ${DECISION})`, le: new Date() } }, { upsert: true });
    }
    const encore = await L.countDocuments({ _id: { $in: plan.map(p => p.l._id) } });
    console.log(`\n   ✅ détachées : ${r.deletedCount} (attendu ${plan.length}) · encore présentes : ${encore} · restes écrits : ${restes} (produits restés sans ligne)`);
    await fermer();
    if (r.deletedCount !== plan.length || encore) process.exitCode = 1;
}
module.exports = { DECISIONS, jugerLigne, estInterdite };
if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exitCode = 1; });

// BANC — retirer-fiches-simples-doublons.js : une fiche simple n'est retirée que si elle est PROUVÉE double d'une vraie carte (lot X30C, 2026-10-13).
//   node test-retirer-fiches-simples-doublons.js
// Pur (la preuve est une fonction de documents) + une base en mémoire pour l'écriture : aucune base de production, aucun réseau.
const { prouver, ecrireRetraits } = require('./retirer-fiches-simples-doublons');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const SLUG = '30th-Celebration-Additionals';
const PARENT = { nom: '30th Celebration', tirage: 'intl', idExpansion: 6601 };
const base = () => ({
    produit: 909373, slug: SLUG, expansionParent: PARENT,
    fiche: { _id: -909373, nomEn: 'Mewtwo', attaques: [{ nom: 'Empower' }, { nom: 'Psydrive' }], ficheSimple: { source: 'x' }, sets: [SLUG],
        impressions: [{ tirage: 'intl', expansion: '30th Celebration Additionals', numero: '063' }], liens: { idProduct: [909373], idMetacards: [465169] } },
    lignesFiche: [{ _id: '-909373|909373', carteId: -909373, idProduct: 909373, preuve: 'fiche-simple' }],
    nImagesDocs: 0,
    parent: { _id: 358695, nomEn: 'Mewtwo', attaques: [{ nom: 'Empower', cout: ['Psychic'] }, { nom: 'Psydrive' }],
        impressions: [{ tirage: 'intl', expansion: '30th Celebration', numero: '063' }, { tirage: 'jp', expansion: '30th Celebration', numero: '054' }],
        liens: { idProduct: [895620, 907670, 909373], idMetacards: [465169] } },
    ligneParent: { _id: '358695|909373', carteId: 358695, idProduct: 909373, preuve: 'set+numero', numeroFiche: '063' },
    catalogue: { idMetacard: 465169, idExpansion: 6767 },
    freres: [{ idProduct: 907670, idMetacard: 465169, idExpansion: 6601, numero: '063' }, { idProduct: 895620, idMetacard: 465169, idExpansion: 6232, numero: '104' }]
});
const avec = f => { const o = base(); f(o); return prouver(o); };
const motif = r => r.refus.map(x => x.split(' ')[0]).join(',');

const bon = prouver(base());
verifier('le cas Mewtwo complet : DOUBLE PROUVÉ, aucun refus', [bon.ok, bon.refus], [true, []]);
verifier('les preuves sont nommées (une par donnée indépendante de la clé)', bon.preuves.map(p => p.nom), ['fiche-simple', 'ligne-du-parent', 'nom', 'attaques', 'metacarte', 'numero']);
verifier('la fiche n\'est pas une fiche simple (pas de ficheSimple) : refus', avec(o => { delete o.fiche.ficheSimple; }).ok, false);
verifier('_id de fiche ≠ −idProduct : refus', avec(o => { o.fiche._id = 5; }).ok, false);
verifier('fiche à deux impressions : refus', avec(o => { o.fiche.impressions.push({ tirage: 'jp', expansion: 'x', numero: '1' }); }).ok, false);
verifier('fiche à deux produits : refus', avec(o => { o.fiche.liens.idProduct.push(1); }).ok, false);
verifier('fiche qui porte une image : refus', avec(o => { o.fiche.images = [{ set: SLUG }]; }).ok, false);
verifier('un document `images` pointe la fiche : refus', avec(o => { o.nImagesDocs = 1; }).ok, false);
verifier('une ligne de la fiche d\'une autre preuve que fiche-simple : refus', avec(o => { o.lignesFiche[0].preuve = 'set+numero'; }).ok, false);
verifier('deux lignes sous la fiche : refus', avec(o => { o.lignesFiche.push({ _id: '-909373|1', carteId: -909373, idProduct: 1, preuve: 'fiche-simple' }); }).ok, false);
verifier('aucune ligne du produit vers le parent : refus (le retrait laisserait le produit sans fiche)', avec(o => { o.ligneParent = null; }).ok, false);
verifier('le parent est lui-même une fiche simple : refus', avec(o => { o.parent.ficheSimple = {}; }).ok, false);
verifier('le parent ne porte pas le produit dans liens.idProduct : refus', avec(o => { o.parent.liens.idProduct = [907670]; }).ok, false);
verifier('nom différent : refus', motif(avec(o => { o.parent.nomEn = 'Mew'; })), 'nom');
verifier('nom égal à la casse, aux accents et à la ponctuation près : passe', avec(o => { o.parent.nomEn = 'MEWTWO'; }).ok, true);
verifier('attaques différentes : refus', motif(avec(o => { o.parent.attaques = [{ nom: 'Empower' }, { nom: 'Barrier' }]; })), 'attaques');
verifier('aucune attaque des deux côtés : refus (un nom seul ne prouve rien)', motif(avec(o => { o.fiche.attaques = []; o.parent.attaques = []; })), 'attaques');
// (sans frère à la même métacarte, le numéro d'origine ne se prouve pas non plus : les deux refus sont nommés)
verifier('métacarte du produit ≠ celle du parent : refus', motif(avec(o => { o.catalogue.idMetacard = 7; })), 'metacarte,numero');
verifier('métacarte absente du catalogue : refus', motif(avec(o => { o.catalogue.idMetacard = null; })), 'metacarte,numero');
verifier('aucun frère du parent (autre produit, expansion du parent) à la même métacarte : refus', motif(avec(o => { o.freres = [{ idProduct: 895620, idMetacard: 465169, idExpansion: 6232, numero: '104' }]; })), 'metacarte,numero');
verifier('un frère à une AUTRE métacarte ne prouve rien : refus', motif(avec(o => { o.freres[0].idMetacard = 8; })), 'metacarte,numero');
verifier('le parent ne déclare pas l\'impression du tirage et du numéro : refus', motif(avec(o => { o.parent.impressions = [{ tirage: 'jp', expansion: '30th Celebration', numero: '063' }]; })), 'numero');
verifier('numéro différent sur l\'impression du parent : refus', motif(avec(o => { o.parent.impressions[0].numero = '064'; })), 'numero');
verifier('le frère du parent porte un autre numéro : refus', motif(avec(o => { o.freres[0].numero = '064'; })), 'numero');
verifier('numéros comparés sans les zéros de tête : passe', avec(o => { o.fiche.impressions[0].numero = '63'; }).ok, true);
verifier('plusieurs refus : tous nommés', motif(avec(o => { o.parent.nomEn = 'Mew'; o.catalogue.idMetacard = 7; })), 'nom,metacarte,numero');

(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_retrait');
        await db.collection('cartes').insertMany([
            { _id: -909373, nomEn: 'Mewtwo', ficheSimple: { source: 'x' } }, { _id: -909374, nomEn: 'Eevee', ficheSimple: { source: 'x' } }, { _id: 358695, nomEn: 'Mewtwo' }, { _id: 5, nomEn: 'Voisine', ficheSimple: { source: 'x' } }]);
        await db.collection('cartes_produits').insertMany([
            { _id: '-909373|909373', carteId: -909373, idProduct: 909373, preuve: 'fiche-simple' }, { _id: '-909374|909374', carteId: -909374, idProduct: 909374, preuve: 'fiche-simple' },
            { _id: '358695|909373', carteId: 358695, idProduct: 909373, preuve: 'set+numero' }, { _id: '5|55', carteId: 5, idProduct: 55, preuve: 'fiche-simple' }]);
        const r = await ecrireRetraits(db, [{ fiche: { _id: -909373 }, lignesFiche: [{ _id: '-909373|909373' }] }]);
        verifier('écriture : une fiche et sa ligne retirées, comptées', r, { lignes: 1, fiches: 1 });
        verifier('la fiche et sa ligne n\'existent plus', [await db.collection('cartes').countDocuments({ _id: -909373 }), await db.collection('cartes_produits').countDocuments({ _id: '-909373|909373' })], [0, 0]);
        verifier('la ligne du parent, la fiche voisine non nommée et sa ligne sont INTACTES', [await db.collection('cartes_produits').countDocuments({ _id: '358695|909373' }), await db.collection('cartes').countDocuments({ _id: { $in: [358695, -909374, 5] } }), await db.collection('cartes_produits').countDocuments({ _id: { $in: ['-909374|909374', '5|55'] } })], [1, 3, 2]);
        verifier('idempotente : rien de plus à retirer', await ecrireRetraits(db, [{ fiche: { _id: -909373 }, lignesFiche: [{ _id: '-909373|909373' }] }]), { lignes: 0, fiches: 0 });
        verifier('une carte qui n\'est pas une fiche simple n\'est JAMAIS supprimée (garde dans le filtre)', (await ecrireRetraits(db, [{ fiche: { _id: 358695 }, lignesFiche: [] }]), await db.collection('cartes').countDocuments({ _id: 358695 })), 1);
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

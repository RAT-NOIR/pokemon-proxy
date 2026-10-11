// ============================================================
// DEUX NUMÉROS CORROMPUS PAR UN COMMENTAIRE HTML — la reprise des lignes déjà écrites (2026-10-11)
// ============================================================
//   node corriger-numeros-commentaires.js                    (simulation : plan, impressions fantômes, annonce de la garde)
//   node lot-additif.js --quoi="numeros corrompus par un commentaire HTML (295618, 294172)" --collections=cartes,images \
//        [--annonce=collecte-cartes/rapports/annonce-corriger-numeros-commentaires.json] -- node corriger-numeros-commentaires.js --ecrire
//
// LA CAUSE (corrigée dans collecte-cartes/wikitext.js, `sansCommentaires`) : le parseur découpait les gabarits au `|` AVANT d'ôter les
// commentaires, d'où `cardno=102<!--` et une impression japonaise fantôme tirée du texte commenté. Ce correctif de parseur ne corrige
// AUCUNE ligne déjà écrite (§23) : cet outil est la seconde moitié.
//
// CE QU'IL ÉCRIT, ET SEULEMENT ÇA : un `numero` égal à la valeur corrompue, remplacé par la valeur que le parseur corrigé lit sur la
// page archivée — dans l'impression intl de la carte, dans `cartes.images[]` du set concerné, dans le document `images` correspondant.
// LISTE FERMÉE de deux cartes. Il REFUSE si l'état en base n'est pas exactement celui attendu, ou si la nouvelle valeur n'est pas un
// numéro propre. Il NE RETIRE PAS les impressions fantômes (une suppression : décision du testeur) ; il les IMPRIME.
// 🔴 Unown « ! » (31891, EX Unseen Forces) a un numéro « suspect » légitime : il n'est pas dans la liste, et ne doit pas y entrer.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const W = require('./collecte-cartes/wikitext');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const CIBLES = Object.freeze([
    { id: 295618, nomEn: 'Oddish', expansion: 'SVP Black Star Promos', set: 'SV-Black-Star-Promos', corrompu: '102<!--' },
    { id: 294172, nomEn: 'Paradise Resort', expansion: 'MEP Black Star Promos', set: 'MEP-Black-Star-Promos', corrompu: '092<!--' }
]);
const NUMERO_PROPRE = /^[A-Za-z]{0,3}\d{1,4}[a-z]?$/;

/**
 * @param {object} cible une entrée de CIBLES
 * @param {{carte: object|null, images: object[], texte: string|null}} etat ce que la base et l'archive disent
 * @returns {{refus: string|null, neuf: string|null, carteApres: object|null, fantomes: object[], images: object[]}}
 */
function planifier(cible, { carte, images, texte }) {
    const non = refus => ({ refus: `carte ${cible.id} : ${refus}`, neuf: null, carteApres: null, fantomes: [], images: [] });
    if (!carte) return non('introuvable en base');
    if (carte.nomEn !== cible.nomEn) return non(`nomEn « ${carte.nomEn} » au lieu de « ${cible.nomEn} »`);
    if (typeof texte !== 'string') return non('page archivée illisible');
    const imp = (carte.impressions || []).filter(i => i && i.tirage === 'intl' && i.expansion === cible.expansion && i.numero === cible.corrompu);
    if (imp.length !== 1) return non(`${imp.length} impression(s) intl « ${cible.expansion} » à numéro « ${cible.corrompu} » au lieu d'exactement 1`);
    const lues = W.faitsDeCarte(texte, null).impressions.filter(i => i.tirage === 'intl' && i.expansion === cible.expansion);
    if (lues.length !== 1) return non(`le parseur corrigé lit ${lues.length} impression(s) intl « ${cible.expansion} » sur la page au lieu d'exactement 1`);
    const neuf = lues[0].numero;
    if (typeof neuf !== 'string' || !NUMERO_PROPRE.test(neuf)) return non(`la valeur lue (« ${neuf} ») n'est pas un numéro propre`);
    if (!cible.corrompu.startsWith(neuf) || cible.corrompu === neuf) return non(`« ${cible.corrompu} » n'est pas « ${neuf} » suivi d'un reste de commentaire`);
    const entrees = (carte.images || []).filter(m => m && m.set === cible.set && m.numero === cible.corrompu);
    if (entrees.length !== 1) return non(`${entrees.length} entrée(s) cartes.images du set « ${cible.set} » à numéro « ${cible.corrompu} » au lieu d'exactement 1`);
    const docs = (images || []).filter(d => d && d.carteId === cible.id && d.set === cible.set && d.numero === cible.corrompu);
    if (docs.length !== 1) return non(`${docs.length} document(s) images du set « ${cible.set} » à numéro « ${cible.corrompu} » au lieu d'exactement 1`);
    const carteApres = {
        ...carte,
        impressions: carte.impressions.map(i => i === imp[0] ? { ...i, numero: neuf } : i),
        images: carte.images.map(m => m === entrees[0] ? { ...m, numero: neuf } : m)
    };
    // les impressions que la base porte et que le parseur corrigé ne lit plus (japonaises fantômes) : imprimées, jamais retirées
    const lisibles = new Set(W.faitsDeCarte(texte, null).impressions.map(i => `${i.tirage}|${i.expansion}`));
    const fantomes = carte.impressions.filter(i => i && !lisibles.has(`${i.tirage}|${i.expansion}`));
    return { refus: null, neuf, carteApres, fantomes, images: docs };
}

/** Les écritures, une par collection, chacune gardée par la valeur corrompue (idempotente : rejouée, elle ne touche plus rien). */
async function appliquer(db, cible, neuf) {
    const r1 = await db.collection('cartes').updateOne(
        { _id: cible.id },
        { $set: { 'impressions.$[i].numero': neuf, 'images.$[m].numero': neuf } },
        { arrayFilters: [{ 'i.tirage': 'intl', 'i.expansion': cible.expansion, 'i.numero': cible.corrompu }, { 'm.set': cible.set, 'm.numero': cible.corrompu }] });
    const r2 = await db.collection('images').updateMany({ carteId: cible.id, set: cible.set, numero: cible.corrompu }, { $set: { numero: neuf } });
    return { cartes: r1.modifiedCount, images: r2.modifiedCount };
}

/**
 * Relecture APRÈS écriture, comparée à l'ATTENDU du lot (pas à l'absence d'un motif) : `numero === neuf` sur l'impression intl, l'entrée
 * cartes.images du set et le document images ; longueurs des tableaux inchangées. @returns {string[]} les écarts (vide = conforme)
 */
function verifierRelu(cible, neuf, avant, relu, docsImages) {
    if (!relu) return ['carte introuvable à la relecture'];
    const ecarts = [];
    if ((relu.impressions || []).length !== (avant.impressions || []).length) ecarts.push(`impressions : ${(avant.impressions || []).length} → ${(relu.impressions || []).length}`);
    if ((relu.images || []).length !== (avant.images || []).length) ecarts.push(`images : ${(avant.images || []).length} → ${(relu.images || []).length}`);
    const imp = (relu.impressions || []).filter(i => i && i.tirage === 'intl' && i.expansion === cible.expansion && (i.numero === neuf || i.numero === cible.corrompu));
    if (imp.length !== 1 || imp[0].numero !== neuf) ecarts.push(`impression intl « ${cible.expansion} » : numero ${JSON.stringify(imp.map(i => i.numero))} au lieu de « ${neuf} »`);
    const ent = (relu.images || []).filter(m => m && m.set === cible.set && (m.numero === neuf || m.numero === cible.corrompu));
    if (ent.length !== 1 || ent[0].numero !== neuf) ecarts.push(`cartes.images du set « ${cible.set} » : numero ${JSON.stringify(ent.map(m => m.numero))} au lieu de « ${neuf} »`);
    const docs = (docsImages || []).filter(d => d && d.set === cible.set && (d.numero === neuf || d.numero === cible.corrompu));
    if (docs.length !== 1 || docs[0].numero !== neuf) ecarts.push(`document images du set « ${cible.set} » : numero ${JSON.stringify(docs.map(d => d.numero))} au lieu de « ${neuf} »`);
    return ecarts;
}

module.exports = { CIBLES, planifier, appliquer, verifierRelu };

if (require.main === module) (async () => {
    const AUTORISES = [/^--ecrire$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — seul --ecrire est autorisé`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const r2 = require('./collecte-cartes/r2');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    let code = 0;
    try {
        await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
        const plans = [];
        for (const cible of CIBLES) {
            const carte = await cx.db.collection('cartes').findOne({ _id: cible.id });
            const images = await cx.db.collection('images').find({ carteId: cible.id }).toArray();
            const texte = carte?.bulba?.cleR2 ? await r2.lireTexte(process.env.R2_BUCKET_BRUT, carte.bulba.cleR2).catch(() => null) : null;
            const p = planifier(cible, { carte, images, texte });
            plans.push({ cible, carte, p });
            if (p.refus) { console.log(`   🔴 REFUS — ${p.refus}`); code = 1; continue; }
            console.log(`   ${cible.id} ${cible.nomEn} : « ${cible.corrompu} » → « ${p.neuf} » (impression intl, cartes.images du set ${cible.set}, ${p.images.length} document images)`);
            for (const f of p.fantomes) console.log(`      ⚠️ impression fantôme NON retirée (décision du testeur) : ${f.tirage} · ${f.expansion} · n° ${f.numero} · total ${f.total}`);
        }
        console.log(`   dénominateur : ${CIBLES.length} cibles, ${plans.filter(x => !x.p.refus).length} planifiées, ${plans.filter(x => x.p.refus).length} refusées`);
        if (code) { console.log('   rien n\'est écrit : un refus arrête tout.'); process.exitCode = code; return; }
        const bonnes = plans.map(x => ({ avant: x.carte, apres: x.p.carteApres }));
        const { baisses, hausses } = comparer(compterEtat({ cartes: bonnes.map(b => b.avant) }), compterEtat({ cartes: bonnes.map(b => b.apres) }));
        const annonce = Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
        const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', 'annonce-corriger-numeros-commentaires.json');
        if (baisses.length) {
            fs.mkdirSync(path.dirname(fichier), { recursive: true });
            fs.writeFileSync(fichier, JSON.stringify(annonce, null, 1));
            console.log(`   baisses de la garde : ${JSON.stringify(annonce)} → annonce écrite : ${fichier} (--annonce=)`);
        } else console.log(`   baisses de la garde : aucune (hausses ${JSON.stringify(hausses)}) → pas de fichier d'annonce`);
        if (!ECRIRE) { console.log('   (simulation — rien n\'est écrit ; voir l\'en-tête pour la commande lot-additif.js)'); return; }
        for (const { cible, p } of plans) {
            const r = await appliquer(cx.db, cible, p.neuf);
            const relu = await cx.db.collection('cartes').findOne({ _id: cible.id }, { projection: { impressions: 1, images: 1 } });
            const docs = await cx.db.collection('images').find({ carteId: cible.id }).toArray();
            const ecarts = verifierRelu(cible, p.neuf, plans.find(x => x.cible === cible).carte, relu, docs);
            console.log(`   ${ecarts.length || r.cartes !== 1 || r.images !== 1 ? '🔴' : '✅'} ${cible.id} : cartes modifiée ${r.cartes}, images modifiés ${r.images} · relu vs attendu « ${p.neuf} » : ${ecarts.length ? ecarts.join(' ; ') : 'conforme'}`);
            if (ecarts.length || r.cartes !== 1 || r.images !== 1) code = 1;
        }
        process.exitCode = code;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });

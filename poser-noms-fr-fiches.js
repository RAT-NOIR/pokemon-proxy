// ============================================================
// NOMS FRANÇAIS DES FICHES : (A) AJOUT aux cartes à _id négatif sans champ nomFr, (B) cartes à nomFr null remplies si le clone TCGdex concorde
// ============================================================
//   node poser-noms-fr-fiches.js [--clone=<racine du clone TCGdex>] [--sortie=<dossier>]          (mesure seule, défaut : AUCUNE écriture)
//   node lot-additif.js --quoi="…" --collections=cartes -- node poser-noms-fr-fiches.js --ecrire --attendu=A:<n>,B:<m> …    (écriture, sous la garde de lot)
//
// 🔑 Le plan vit dans collecte-cartes/plan-noms-fr-fiches.js (fonctions pures, banc test-poser-noms-fr-fiches.js) ; la règle du nom dans
// collecte-cartes/nom-fr-cardmarket.js (la MÊME que rapatrier-noms-fr.js, §21 bis). Cet outil ne fait que lire, brancher et écrire.
//   (A) cartes à _id < 0 SANS champ nomFr -> nom Cardmarket unique ; conflit entre produits -> null (comme rapatrier). Jamais une carte qui a déjà un champ.
//   (B) cartes à nomFr null + nomFrSource 'cardmarket' -> remplies seulement si le fr du clone LOCAL de TCGdex concorde avec un nom en conflit
//       ET que le lien carte <-> carte TCGdex est prouvé par un témoin autre que l'identifiant Cardmarket. Ancienne valeur (null) journalisée.
// Lectures : MONGODB_LECTURE_URI / MONGODB_CARTES_LECTURE_URI (audit-catalogue/lecture-audit.js). Aucun réseau. Les écritures n'utilisent que
// la connexion `cartes` de collecte-cartes/garde.js, et seulement SOUS lot-additif.js (LOT_ADDITIF_PID), jamais seul.
const fs = require('fs');
const path = require('path');

const AUTORISES = [/^--ecrire$/, /^--clone=.+/, /^--lecteur-clone=.+\.js$/, /^--sortie=.+/, /^--attendu=A:\d+,B:\d+$/, /^--exemples=\d{1,3}$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const ecrire = args.includes('--ecrire');
const attendu = val('attendu') ? Object.fromEntries(val('attendu').split(',').map(x => x.split(':')).map(([k, v]) => [k, Number(v)])) : null;
// La ligne de commande est une garde, elle s'écrit par ce qu'elle AUTORISE : tout argument inconnu refuse AVANT toute connexion.
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
if (ecrire && !process.env.LOT_ADDITIF_PID) { console.error('❌ --ecrire ne tourne que SOUS lot-additif.js (sauvegarde, garde, revalidation) : refus. Rien n\'a été écrit.'); process.exit(2); }
if (ecrire && !attendu) { console.error('❌ --ecrire exige --attendu=A:<n>,B:<m> (les comptes de la simulation) : refus. Rien n\'a été écrit.'); process.exit(2); }
if (!ecrire && attendu) { console.error('❌ --attendu ne vaut qu\'avec --ecrire.'); process.exit(2); }

const LECTEUR = val('lecteur-clone') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/champs/clone.js';
const SORTIE = path.resolve(val('sortie') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/noms-fr');
const NB_EXEMPLES = Number(val('exemples') || 15);
const masquer = e => String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');

(async () => {
    const { ouvrirLecture } = require('./audit-catalogue/lecture-audit');
    const { frParProduit } = require('./collecte-cartes/nom-fr-cardmarket');
    const { planifierA, planifierB } = require('./collecte-cartes/plan-noms-fr-fiches');
    const { lireClone, CLONE } = require(LECTEUR);                                        // le lecteur déjà écrit et mesuré : réutilisé, pas recopié
    const clone = lireClone(val('clone') || CLONE);
    if (!clone.cartes.length || !clone.sets.length) throw new Error(`clone vide (${clone.cartes.length} cartes, ${clone.sets.length} sets) : un clone qui ne contient rien ne mesure rien (§41)`);

    const b = await ouvrirLecture();
    let cartes, liens, produits;
    try {
        cartes = await b.cartes.collection('cartes').find({}, { projection: { nomEn: 1, nomFr: 1, nomFrSource: 1, ndex: 1 } }).toArray();
        liens = await b.cartes.collection('cartes_produits').find({}, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1 } }).toArray();
        produits = await b.prod.collection('numeros_cartes').find({}, { projection: { idProduct: 1, nomFr: 1 } }).toArray();
    } finally { await b.fermer(); }
    if (!cartes.length || !liens.length || !produits.length) throw new Error('une lecture est vide : rien ne se mesure (§41)');
    const frDuProduit = frParProduit(produits);

    const nChaine = cartes.filter(c => typeof c.nomFr === 'string').length, nNull = cartes.filter(c => c.nomFr === null).length, nAbsent = cartes.filter(c => c.nomFr === undefined).length;
    console.log(`\n════ DÉNOMINATEUR : ${cartes.length} cartes · nomFr chaîne ${nChaine} · null ${nNull} · champ absent ${nAbsent} (dont négatives ${cartes.filter(c => c.nomFr === undefined && c._id < 0).length}) ════`);
    console.log(`   ${produits.length} produits Cardmarket (${frDuProduit.size} à nomFr) · ${liens.length} lignes · clone TCGdex : ${clone.cartes.length} cartes, ${clone.sets.length} sets`);

    // ---------- (A) ----------
    const A = planifierA({ cartes, liens, frDuProduit });
    const aNom = A.ecrire.filter(x => x.nomFr), aNull = A.ecrire.filter(x => !x.nomFr);
    console.log(`\n════ (A) AJOUT — cartes à _id négatif sans champ nomFr ════`);
    console.log(`   plan : ${A.ecrire.length} cartes  →  ${aNom.length} reçoivent un nom (${A.ecrire.filter(x => x.accentue).length} départagées par les accents) · ${aNull.length} reçoivent null (conflit entre produits)`);
    console.log(`   non touchées : ${A.sansProduitFr} sans aucun produit à nomFr (pas de champ posé) · ${A.dejaNommeesOuNulles} négatives qui ont déjà un champ (chaîne ou null) · ${A.horsLotPositives} positives sans champ (HORS de ce lot)`);
    // pour information, jamais écrit : parmi les conflits de (A), combien le clone TCGdex départagerait ?
    const infoB = planifierB({ cartes: aNull.map(x => ({ ...cartes.find(c => c._id === x.carteId), nomFr: null, nomFrSource: 'cardmarket' })), liens, frDuProduit, clone });
    console.log(`   (pour information, NON écrit : sur ces ${aNull.length} conflits, le clone concorderait pour ${infoB.decisions.filter(d => d.decision === 'remplir').length} ; ils restent à null en (A))`);

    // ---------- (B) ----------
    const B = planifierB({ cartes, liens, frDuProduit, clone });
    const remplir = B.decisions.filter(d => d.decision === 'remplir');
    const restes = B.decisions.filter(d => d.decision !== 'remplir');
    const parRaison = {}; for (const d of restes) parRaison[d.raison] = (parRaison[d.raison] || 0) + 1;
    const parTemoin = {}; for (const d of remplir) parTemoin[d.temoin] = (parTemoin[d.temoin] || 0) + 1;
    console.log(`\n════ (B) cartes à nomFr null (source cardmarket) : ${B.decisions.length} examinées ════`);
    console.log(`   ✅ recevraient un nom : ${remplir.length}   (témoins : ${Object.entries(parTemoin).map(([k, v]) => `${k} ${v}`).join(' · ') || 'aucun'})`);
    console.log(`   ⚪ resteraient à null : ${restes.length}`);
    for (const [k, v] of Object.entries(parRaison).sort((x, y) => y[1] - x[1])) console.log(`      ${String(v).padStart(5)} — ${k}`);
    const parRaisonLien = {}; for (const d of restes.filter(x => x.raison === 'lien-non-prouve')) { const r = [...new Set(d.liens.map(l => l.raison))].sort().join('+'); parRaisonLien[r] = (parRaisonLien[r] || 0) + 1; }
    if (Object.keys(parRaisonLien).length) console.log(`      dont lien non prouvé, par cause des lignes : ${Object.entries(parRaisonLien).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

    const ligne = d => `carte ${d.carteId} « ${d.nomEn} » · conflits : ${d.conflits.map(x => `« ${x} »`).join(' ≠ ')} · TCGdex : ${d.nomTcgdex ? `« ${d.nomTcgdex} »` : '—'} · témoin : ${d.temoin || '—'} · ${d.decision === 'remplir' ? `✅ REMPLIR « ${d.nomFr} »` : `⚪ reste null (${d.raison})`}`;
    const exemples = [...remplir.filter((_, i) => i % Math.max(1, Math.floor(remplir.length / (NB_EXEMPLES - 3))) === 0).slice(0, NB_EXEMPLES - 3), ...restes.filter(d => d.nomTcgdex).slice(0, 3)].slice(0, NB_EXEMPLES);
    console.log(`\n   ${exemples.length} exemples de (B) :`);
    for (const d of exemples) console.log(`      ${ligne(d)}`);

    fs.mkdirSync(SORTIE, { recursive: true });
    const plan = { le: new Date().toISOString(), comptes: { A: A.ecrire.length, A_nom: aNom.length, A_null: aNull.length, B: remplir.length }, A: A.ecrire, B: B.decisions };
    fs.writeFileSync(path.join(SORTIE, ecrire ? 'PLAN-ECRIT.json' : 'PLAN-SIMULATION.json'), JSON.stringify(plan, null, 1), 'utf8');

    // les cas validés par le SEUL nom anglais (pas de recoupement set + numéro) : liste pour relecture à l'œil
    const seul = remplir.filter(d => d.temoin === 'nom-en');
    const tsv = ['_id\tnomEn\tnoms Cardmarket\tnom TCGdex\tset\tnuméro\tnull périmé'].concat(seul.map(d => {
        const [, set, num] = String(d.refsTcgdex[0]).split('|');
        return [d.carteId, d.nomEn, d.conflits.join(' | '), d.nomTcgdex, set, num, d.perime ? 'oui' : 'non'].join('\t');
    }));
    fs.writeFileSync(path.join(SORTIE, 'B-nom-anglais-seul.tsv'), tsv.join('\n') + '\n', 'utf8');
    console.log(`   ${seul.length} remplissages validés par le SEUL nom anglais (dont ${seul.filter(d => d.perime).length} nulls périmés) → B-nom-anglais-seul.tsv`);
    console.log(`   remplissages : ${remplir.filter(d => d.perime).length} nulls périmés (nom unique) · ${remplir.filter(d => !d.perime).length} conflits`);

    if (!ecrire) {
        console.log(`\n   (mesure seule, rien n'est écrit) — pour écrire : lot-additif.js … -- node poser-noms-fr-fiches.js --ecrire --attendu=A:${A.ecrire.length},B:${remplir.length}`);
        return;
    }

    // ---------- ÉCRITURE (sous lot-additif.js) ----------
    if (attendu.A !== A.ecrire.length || attendu.B !== remplir.length) {
        console.error(`❌ comptes différents de la simulation (attendu A:${attendu.A},B:${attendu.B} ; recalculé A:${A.ecrire.length},B:${remplir.length}) : la base a bougé depuis la simulation. Rien n'a été écrit.`);
        process.exitCode = 3; return;
    }
    // invariants relus sur les cartes lues : on n'écrit JAMAIS sur une carte qui a déjà un nom
    const parId = new Map(cartes.map(c => [c._id, c]));
    for (const x of A.ecrire) if (parId.get(x.carteId).nomFr !== undefined || !(x.carteId < 0)) throw new Error(`invariant (A) violé sur la carte ${x.carteId}`);
    for (const d of remplir) { const c = parId.get(d.carteId); if (c.nomFr !== null || c.nomFrSource !== 'cardmarket') throw new Error(`invariant (B) violé sur la carte ${d.carteId}`); }

    // le journal de (B) : chaque _id, ancienne valeur (null), nouvelle valeur — écrit AVANT l'écriture, pour pouvoir revenir en arrière
    const le = new Date();
    const journal = remplir.map(d => ({ _id: d.carteId, ancien: { nomFr: null, nomFrSource: 'cardmarket' }, nouveau: { nomFr: d.nomFr, nomFrSource: d.source }, conflits: d.conflits, nomTcgdex: d.nomTcgdex, temoin: d.temoin }));
    const fJournal = path.join(SORTIE, `JOURNAL-B-${le.toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
    fs.writeFileSync(fJournal, JSON.stringify({ le: le.toISOString(), retour: 'pour revenir en arrière : updateOne({_id}, {$set: {nomFr: null, nomFrSource: "cardmarket"}}) pour chaque entrée', entrees: journal }, null, 1), 'utf8');
    console.log(`\n   journal de (B) : ${fJournal} (${journal.length} entrées, ancienne valeur null)`);

    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false });
    try {
        const C = cx.db.collection('cartes');
        const { opsA, opsB } = require('./collecte-cartes/plan-noms-fr-fiches').construireOps({ ecrireA: A.ecrire, remplirB: remplir, le });
        let mA = 0, mB = 0;
        for (let i = 0; i < opsA.length; i += 500) mA += (await C.bulkWrite(opsA.slice(i, i + 500), { ordered: false })).modifiedCount;
        for (let i = 0; i < opsB.length; i += 500) mB += (await C.bulkWrite(opsB.slice(i, i + 500), { ordered: false })).modifiedCount;
        console.log(`   ÉCRIT : (A) ${mA}/${opsA.length} · (B) ${mB}/${opsB.length}`);
        if (mA !== opsA.length || mB !== opsB.length) { console.error('🔴 un écart entre le plan et ce qui a été modifié : la garde de lot et la relecture tranchent.'); process.exitCode = 4; }
    } finally { await fermer(); }
})().catch(e => { console.error('❌', masquer(e)); process.exit(1); });

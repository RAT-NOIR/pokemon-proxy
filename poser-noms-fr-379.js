// ============================================================
// NOMS FRANÇAIS DES CARTES POSITIVES SANS CHAMP nomFr : clone TCGdex + page Poképédia (lue par la porte réseau), deux sources concordantes
// ============================================================
//   node poser-noms-fr-379.js [--clone=<racine>] [--lecteur-clone=<.js>] [--pages=<dossier>] [--sortie=<dossier>]     (mesure seule, AUCUNE écriture)
//   node lot-additif.js --quoi="…" --collections=cartes -- node poser-noms-fr-379.js --ecrire --attendu=<n> …        (écriture, sous la garde de lot)
//
// Le plan vit dans collecte-cartes/plan-noms-fr-379.js (fonctions pures, banc test-plan-noms-fr-379.js). Les pages Poképédia sont lues AVANT par
// collecter-pokepedia-379.js, qui ne passe que par la porte (collecte-cartes/porte-reseau.js). Cet outil ne fait AUCUN réseau : il lit des fichiers.
// Lectures : MONGODB_CARTES_LECTURE_URI (audit-catalogue/lecture-audit.js). Les écritures n'utilisent que la connexion `cartes` de
// collecte-cartes/garde.js, et seulement SOUS lot-additif.js (LOT_ADDITIF_PID), jamais seul.
const fs = require('fs');
const path = require('path');

const AUTORISES = [/^--ecrire$/, /^--clone=.+/, /^--lecteur-clone=.+\.js$/, /^--pages=.+/, /^--sortie=.+/, /^--attendu=\d+$/, /^--exemples=\d{1,3}$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const ecrire = args.includes('--ecrire');
const attendu = val('attendu') !== undefined ? Number(val('attendu')) : null;
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
if (ecrire && !process.env.LOT_ADDITIF_PID) { console.error('❌ --ecrire ne tourne que SOUS lot-additif.js (sauvegarde, garde, revalidation) : refus. Rien n\'a été écrit.'); process.exit(2); }
if (ecrire && attendu === null) { console.error('❌ --ecrire exige --attendu=<n> (le compte de la simulation) : refus. Rien n\'a été écrit.'); process.exit(2); }
if (!ecrire && attendu !== null) { console.error('❌ --attendu ne vaut qu\'avec --ecrire.'); process.exit(2); }

const LECTEUR = val('lecteur-clone') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/champs/clone.js';
const PAGES = path.resolve(val('pages') || 'C:/Users/Yung/rat-market-travail/catalogue/chasse/porte-sorties/noms-fr-379');
const SORTIE = path.resolve(val('sortie') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/noms-fr');
const NB_EXEMPLES = Number(val('exemples') || 15);
const masquer = e => String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');
const compter = (liste, f) => { const o = {}; for (const x of liste) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };

(async () => {
    const { ouvrirLecture } = require('./audit-catalogue/lecture-audit');
    const M = require('./collecte-cartes/plan-noms-fr-379');
    const { lireClone, CLONE } = require(LECTEUR);
    const clone = lireClone(val('clone') || CLONE);
    if (!clone.cartes.length || !clone.sets.length) throw new Error(`clone vide (${clone.cartes.length} cartes, ${clone.sets.length} sets) : un clone qui ne contient rien ne mesure rien (§41)`);

    const b = await ouvrirLecture();
    let cartes, liens;
    try {
        cartes = await b.cartes.collection('cartes').find({ _id: { $gt: 0 }, nomFr: { $exists: false } }, { projection: { nomEn: 1, nomFr: 1, ndex: 1 } }).toArray();
        liens = await b.cartes.collection('cartes_produits').find({ carteId: { $in: cartes.map(c => c._id) } }, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1 } }).toArray();
    } finally { await b.fermer(); }
    if (!cartes.length) throw new Error('aucune carte positive sans champ nomFr : rien à faire (ou une lecture fausse, §41)');

    const P = M.planifierCandidats({ cartes, liens, clone });
    const especes = M.especesAChercher(P.candidats);
    console.log(`\n════ DÉNOMINATEUR : ${P.population} cartes positives sans champ nomFr · ${liens.length} lignes produit · clone TCGdex ${clone.cartes.length} cartes ════`);
    console.log(`   candidats (lien prouvé + fr TCGdex) : ${P.candidats.length} · sans nom dès la source 1 : ${P.sansNom.length} ${JSON.stringify(compter(P.sansNom, x => x.raison))}`);
    console.log(`   espèces à lire chez la seconde source : ${especes.length}`);

    // seconde source : les pages DÉJÀ lues par la porte (aucun réseau ici)
    const pages = new Map(); let lues = 0;
    for (const e of especes) {
        const f = path.join(PAGES, M.fichierPage(e));
        if (fs.existsSync(f)) { pages.set(e, M.lirePage(fs.readFileSync(f, 'utf8'))); lues++; }
    }
    console.log(`   pages Poképédia présentes : ${lues}/${especes.length}`);
    const decisions = P.candidats.map(c => {
        const fr = M.decomposerFr(c.nomTcgdex);
        return { ...c, ...M.confirmer(c, pages.get(fr.base) || null) };
    });
    const nommer = decisions.filter(d => d.decision === 'nommer');
    const restes = decisions.filter(d => d.decision !== 'nommer');
    const parRaison = compter([...P.sansNom, ...restes], x => x.raison);
    const contradictions = restes.filter(d => d.raison === 'sources-contradictoires' || d.raison === 'forme-contredite' || P.sansNom.find(x => x.carteId === d.carteId && x.raison === 'tcgdex-contradictoire'));
    const contradictoiresTcgdex = P.sansNom.filter(x => x.raison === 'tcgdex-contradictoire');
    console.log(`\n   ✅ nommées (tcgdex+pokepedia) : ${nommer.length} (dont nom identique à l'anglais, confirmé par la page : ${nommer.filter(d => d.identiqueAnglais).length}) · témoins du lien : ${JSON.stringify(compter(nommer, d => d.temoin))}`);
    console.log(`   ⚪ sans nom : ${P.sansNom.length + restes.length} ${JSON.stringify(parRaison)}`);
    console.log(`   🔴 contradictions listées : ${contradictions.length + contradictoiresTcgdex.length}`);
    for (const d of contradictions) console.log(`      carte ${d.carteId} : ${d.raison} — ${d.detail}`);
    for (const d of contradictoiresTcgdex) console.log(`      carte ${d.carteId} : tcgdex-contradictoire — ${d.detail}`);
    const ech = nommer.filter((_, i) => i % Math.max(1, Math.floor(nommer.length / NB_EXEMPLES)) === 0).slice(0, NB_EXEMPLES);
    console.log(`\n   ${ech.length} exemples :`);
    for (const d of ech) console.log(`      carte ${d.carteId} « ${d.nomEn} » → « ${d.nomFr} » · source 1 : clone TCGdex « ${d.nomTcgdex} » (témoin ${d.temoin}) · source 2 : Poképédia « ${d.titrePage} » (en « ${d.anglaisPage} »)`);

    fs.mkdirSync(SORTIE, { recursive: true });
    const le = new Date();
    fs.writeFileSync(path.join(SORTIE, 'CANDIDATS-379.json'), JSON.stringify({ le: le.toISOString(), especes, candidats: P.candidats }, null, 1), 'utf8');
    fs.writeFileSync(path.join(SORTIE, ecrire ? 'PLAN-379-ECRIT.json' : 'PLAN-379.json'), JSON.stringify({ le: le.toISOString(), population: P.population, nommer, restes, sansNom: P.sansNom }, null, 1), 'utf8');

    if (!ecrire) {
        console.log(`\n   (mesure seule, rien n'est écrit) — pour écrire : lot-additif.js … -- node poser-noms-fr-379.js --ecrire --attendu=${nommer.length}`);
        return;
    }

    // ---------- ÉCRITURE (sous lot-additif.js) ----------
    if (attendu !== nommer.length) { console.error(`❌ compte différent de la simulation (attendu ${attendu} ; recalculé ${nommer.length}) : la base ou les pages ont bougé. Rien n'a été écrit.`); process.exitCode = 3; return; }
    const parId = new Map(cartes.map(c => [c._id, c]));
    for (const d of nommer) if (parId.get(d.carteId).nomFr !== undefined || !(d.carteId > 0)) throw new Error(`invariant violé sur la carte ${d.carteId}`);
    const ops = M.construireOps({ nommer, le });
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false });
    try {
        const C = cx.db.collection('cartes');
        let m = 0;
        for (let i = 0; i < ops.length; i += 500) m += (await C.bulkWrite(ops.slice(i, i + 500), { ordered: false })).modifiedCount;
        console.log(`   ÉCRIT : ${m}/${ops.length}`);
        if (m !== ops.length) { console.error('🔴 un écart entre le plan et ce qui a été modifié : la garde de lot et la relecture tranchent.'); process.exitCode = 4; }
    } finally { await fermer(); }
})().catch(e => { console.error('❌', masquer(e)); process.exit(1); });

// ============================================================
// NOMS FRANÇAIS DES CARTES POSITIVES SANS CHAMP nomFr : clone TCGdex + page Poképédia (lue par la porte réseau), deux sources concordantes
// ============================================================
//   node poser-noms-fr-379.js [--clone=<racine>] [--lecteur-clone=<.js>] [--pages=<dossier>] [--sortie=<dossier>]     (mesure seule, AUCUNE écriture)
//   node lot-additif.js --quoi="…" --collections=cartes -- node poser-noms-fr-379.js --ecrire --attendu=<n> …        (écriture, sous la garde de lot)
//
// Le plan vit dans collecte-cartes/plan-noms-fr-379.js (fonctions pures, banc test-plan-noms-fr-379.js). Les pages Poképédia sont lues AVANT par
// collecter-pokepedia-379.js, qui ne passe que par la porte (collecte-cartes/porte-reseau.js). Cet outil ne fait AUCUN réseau : il lit des fichiers.
// Lectures : MONGODB_CARTES_LECTURE_URI (audit-catalogue/lecture-audit.js). Les écritures n'utilisent que la connexion `cartes` de
// collecte-cartes/garde.js ({ cartes: <Connection mongoose>, prod, fermer } : la base native est cartes.db), et seulement SOUS lot-additif.js.
// `principal(argv, deps)` reçoit ses dépendances (banc test-poser-noms-fr-379.js : fausse connexion de la VRAIE forme) et RENDS un code de sortie.
const fs = require('fs');
const path = require('path');

const AUTORISES = [/^--ecrire$/, /^--clone=.+/, /^--lecteur-clone=.+\.js$/, /^--pages=.+/, /^--sortie=.+/, /^--attendu=\d+$/, /^--exemples=\d{1,3}$/];
const masquer = e => String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');
const compter = (liste, f) => { const o = {}; for (const x of liste) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };

/** @returns {Promise<number>} code de sortie (0 ok, 1 erreur, 2 arguments/environnement, 3 comptes différents, 4 écart d'écriture) */
async function principal(argv, deps = {}) {
    const env = deps.env || process.env;
    const log = deps.log || console.log, err = deps.err || console.error;
    const args = argv;
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
    const ecrire = args.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : null;
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    if (ecrire && !env.LOT_ADDITIF_PID) { err('❌ --ecrire ne tourne que SOUS lot-additif.js (sauvegarde, garde, revalidation) : refus. Rien n\'a été écrit.'); return 2; }
    if (ecrire && attendu === null) { err('❌ --ecrire exige --attendu=<n> (le compte de la simulation) : refus. Rien n\'a été écrit.'); return 2; }
    if (!ecrire && attendu !== null) { err('❌ --attendu ne vaut qu\'avec --ecrire.'); return 2; }

    const LECTEUR = val('lecteur-clone') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/champs/clone.js';
    const PAGES = path.resolve(val('pages') || 'C:/Users/Yung/rat-market-travail/catalogue/chasse/porte-sorties/noms-fr-379');
    const SORTIE = path.resolve(val('sortie') || 'C:/Users/Yung/rat-market-travail/catalogue/fiches-riches/noms-fr');
    const NB_EXEMPLES = Number(val('exemples') || 15);
    try {
        const ouvrirLecture = deps.ouvrirLecture || require('./audit-catalogue/lecture-audit').ouvrirLecture;
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
        log(`\n════ DÉNOMINATEUR : ${P.population} cartes positives sans champ nomFr · ${liens.length} lignes produit · clone TCGdex ${clone.cartes.length} cartes ════`);
        log(`   candidats (lien prouvé + fr TCGdex) : ${P.candidats.length} · sans nom dès la source 1 : ${P.sansNom.length} ${JSON.stringify(compter(P.sansNom, x => x.raison))}`);
        log(`   espèces à lire chez la seconde source : ${especes.length}`);

        // seconde source : les pages DÉJÀ lues par la porte (aucun réseau ici)
        const pages = new Map(); let lues = 0;
        for (const e of especes) {
            const f = path.join(PAGES, M.fichierPage(e));
            if (fs.existsSync(f)) { pages.set(e, M.lirePage(fs.readFileSync(f, 'utf8'))); lues++; }
        }
        log(`   pages Poképédia présentes : ${lues}/${especes.length}`);
        const decisions = P.candidats.map(c => {
            const fr = M.decomposerFr(c.nomTcgdex);
            return { ...c, ...M.confirmer(c, pages.get(fr.base) || null) };
        });
        const nommer = decisions.filter(d => d.decision === 'nommer');
        const restes = decisions.filter(d => d.decision !== 'nommer');
        const parRaison = compter([...P.sansNom, ...restes], x => x.raison);
        const contradictions = restes.filter(d => d.raison === 'sources-contradictoires' || d.raison === 'forme-contredite');
        const contradictoiresTcgdex = P.sansNom.filter(x => x.raison === 'tcgdex-contradictoire');
        log(`\n   ✅ nommées (tcgdex+pokepedia) : ${nommer.length} (dont nom identique à l'anglais, confirmé par la page : ${nommer.filter(d => d.identiqueAnglais).length}) · témoins du lien : ${JSON.stringify(compter(nommer, d => d.temoin))}`);
        log(`   ⚪ sans nom : ${P.sansNom.length + restes.length} ${JSON.stringify(parRaison)}`);
        log(`   🔴 contradictions listées : ${contradictions.length + contradictoiresTcgdex.length}`);
        for (const d of contradictions) log(`      carte ${d.carteId} : ${d.raison} — ${d.detail}`);
        for (const d of contradictoiresTcgdex) log(`      carte ${d.carteId} : tcgdex-contradictoire — ${d.detail}`);
        const ech = nommer.filter((_, i) => i % Math.max(1, Math.floor(nommer.length / NB_EXEMPLES)) === 0).slice(0, NB_EXEMPLES);
        log(`\n   ${ech.length} exemples :`);
        for (const d of ech) log(`      carte ${d.carteId} « ${d.nomEn} » → « ${d.nomFr} » · source 1 : clone TCGdex « ${d.nomTcgdex} » (témoin ${d.temoin}) · source 2 : Poképédia « ${d.titrePage} » (en « ${d.anglaisPage} »)`);

        fs.mkdirSync(SORTIE, { recursive: true });
        const le = new Date();
        fs.writeFileSync(path.join(SORTIE, 'CANDIDATS-379.json'), JSON.stringify({ le: le.toISOString(), especes, candidats: P.candidats }, null, 1), 'utf8');
        fs.writeFileSync(path.join(SORTIE, ecrire ? 'PLAN-379-ECRIT.json' : 'PLAN-379.json'), JSON.stringify({ le: le.toISOString(), population: P.population, nommer, restes, sansNom: P.sansNom }, null, 1), 'utf8');

        if (!ecrire) {
            log(`\n   (mesure seule, rien n'est écrit) — pour écrire : lot-additif.js … -- node poser-noms-fr-379.js --ecrire --attendu=${nommer.length}`);
            return 0;
        }

        // ---------- ÉCRITURE (sous lot-additif.js) ----------
        if (attendu !== nommer.length) { err(`❌ compte différent de la simulation (attendu ${attendu} ; recalculé ${nommer.length}) : la base ou les pages ont bougé. Rien n'a été écrit.`); return 3; }
        const parId = new Map(cartes.map(c => [c._id, c]));
        for (const d of nommer) if (parId.get(d.carteId).nomFr !== undefined || !(d.carteId > 0)) throw new Error(`invariant violé sur la carte ${d.carteId}`);
        const ops = M.construireOps({ nommer, le });
        const ouvrirConnexions = deps.ouvrirConnexions || require('./collecte-cartes/garde').ouvrirConnexions;
        const cx = await ouvrirConnexions({ production: false });
        // la VRAIE forme : { cartes: <Connection>, prod, fermer } ; la base native est cx.cartes.db. Toute autre forme est refusée AVANT d'écrire.
        if (!cx || typeof cx.fermer !== 'function' || !cx.cartes || !cx.cartes.db || typeof cx.cartes.db.collection !== 'function') {
            if (cx && typeof cx.fermer === 'function') await cx.fermer();
            throw new Error('ouvrirConnexions n\'a pas rendu la forme { cartes: <Connection>, fermer } : refus, rien n\'est écrit');
        }
        let code = 0;
        try {
            const C = cx.cartes.db.collection('cartes');
            let m = 0;
            for (let i = 0; i < ops.length; i += 500) m += (await C.bulkWrite(ops.slice(i, i + 500), { ordered: false })).modifiedCount;
            log(`   ÉCRIT : ${m}/${ops.length}`);
            if (m !== ops.length) { err('🔴 un écart entre le plan et ce qui a été modifié : la garde de lot et la relecture tranchent.'); code = 4; }
        } finally { await cx.fermer(); }
        return code;
    } catch (e) { err('❌', masquer(e)); return 1; }
}

module.exports = { principal };
if (require.main === module) principal(process.argv.slice(2)).then(c => { process.exitCode = c; });

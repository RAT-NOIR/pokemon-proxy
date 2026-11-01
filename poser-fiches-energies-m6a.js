// ============================================================
// LES FICHES DES ÉNERGIES DE BASE DE 30th Celebration (m6a, « 30th-Celebration-JP », idExpansion 6602) — règle E-CODE (collecte-cartes/regle-e-code.js)
// ============================================================
//   node poser-fiches-energies-m6a.js --tcgdex=<…/tcgdex-clone…/data-asia> [--plan=<fichier>.json]                    (simulation : RIEN n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-fiches-energies-m6a.js --tcgdex=… --attendu=N --ecrire
//
// LE CAS : les 8 produits « Basic <Type> Energy » de m6a (Cardmarket les numérote par CODE : GRA FIR WAT LIG PSY FIG DAR MET) n'ont aucune ligne cartes_produits. Chaque type
// est UNE carte d'énergie de base de notre base qui porte déjà l'impression « 30th Celebration » (sans numéro), et TCGdex a la carte M6a/<code> (nom japonais 基本<type>エネルギー).
// DEUX SOURCES sur le type ET le code : le nom du produit + le numéro appris de Cardmarket, et le clone TCGdex local. 🔴 La clé N'EST PAS l'idProduct : les `thirdParty.cardmarket`
// de M6a désignent les produits du set CHINOIS 30thC (6603) ; un produit que le clone nomme ailleurs qu'à (M6a, même code) est refusé.
// UN SEUL CODE d'écriture avec poser-fiches-svp-energies.js : planifier, operationsEcriture, ecrire, relire et simulerSite sont IMPORTÉS de lui (profil m6a injecté) — la règle
// d'écriture n'est pas recopiée (§21 bis). ADDITIF STRICT : `$addToSet` (liens, sets), `$push` gardé (impression au code), `$setOnInsert` + upsert (ligne). Aucun $unset / $pull / delete.
// PAS DE CALIBRATION : aucun produit « Basic … Energy » de m6a n'a de ligne (0 cas jugeable, cachée ou non). Elle est remplacée par : table fermée vérifiée contre le clone (8/8),
// codes dédoublonnés (multiplicités comptées), carte unique, refus si le clone contredit, simulation du site avec sa règle IMPORTÉE, --attendu.
const fs = require('fs');
const path = require('path');
const S = require('./poser-fiches-svp-energies');
const RC = require('./collecte-cartes/regle-e-code');
const E = require('./collecte-cartes/regle-e-svp');
const R = require('./collecte-cartes/regle-r-fiches');
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');

const ID_EXPANSION = 6602;
const CODE_SET = 'm6a';
const PREUVE = 'tcgdex-m6a-code+type+nom-cardmarket';
const SOURCE_IMPRESSION = 'numero-cardmarket';
if (!SOURCES_POSEES_APRES.includes(SOURCE_IMPRESSION)) throw new Error(`${SOURCE_IMPRESSION} n'est plus une source conservée par impressions-posees.js`);
const C = RC.CONFIG_M6A;

const PROFIL_M6A = Object.freeze({
    outil: 'poser-fiches-energies-m6a',
    expansion: C.expansion, idExpansion: ID_EXPANSION, preuve: PREUVE, route: 'm6a-energies', totalParDefaut: null, sourceNumeroFiche: 'poser-fiches-energies-m6a (2026-11-01)',
    juger: args => RC.juger({ ...args, config: C }),
    verifierSet(setDoc) {
        const tirage = setDoc?.tirage ?? setDoc?.region;
        if (setDoc?.code !== CODE_SET) throw new Error(`le set ${setDoc?._id} n'a pas le code « ${CODE_SET} » (« ${setDoc?.code} »)`);
        if (tirage !== 'jp') throw new Error(`le set ${setDoc?._id} n'est pas japonais (tirage « ${tirage} ») : l'outil ne vaut que pour m6a`);
        const noms = [].concat(setDoc.bulba?.expansion ?? []);
        if (noms.length !== 1 || noms[0] !== C.expansion) throw new Error(`le set ${setDoc._id} n'a pas pour unique nom d'expansion « ${C.expansion} »`);
        if (![].concat(setDoc.idExpansion ?? []).includes(ID_EXPANSION)) throw new Error(`le set ${setDoc._id} n'a pas l'expansion Cardmarket ${ID_EXPANSION}`);
    },
    preuveNumero: (p, j) => `Cardmarket idProduct ${p.idProduct} « ${p.name} » code ${j.numero} (numeros_cartes) ; TCGdex ${j.tcgdex} « ${j.nomJa} » = type ${j.type} (le thirdParty.cardmarket de TCGdex désigne le set chinois : non utilisé)`,
    detail: (p, j) => `m6a « ${p.name} » code ${j.numero} -> carte ${j.carteId} : Cardmarket (nom + numéro appris) et TCGdex ${j.tcgdex} « ${j.nomJa} » concordent sur le type ${j.type} et le code, une seule carte « ${p.name} » porte l'impression ${C.expansion}`
});

/** Le plan : les produits qui partagent un même code ne sont posés ni l'un ni l'autre (multiplicités comptées, jamais un Set). */
function planifier(args) {
    const code = p => (E.typeProduit(p.name) ? String(args.nums.get(p.idProduct) ?? '').trim().toUpperCase() : '');
    const compte = new Map();
    for (const p of args.produits) { const c = code(p); if (c) compte.set(c, (compte.get(c) || 0) + 1); }
    const doubles = args.produits.filter(p => code(p) && compte.get(code(p)) > 1);
    const ids = new Set(doubles.map(p => p.idProduct));
    const plan = S.planifier({ ...args, produits: args.produits.filter(p => !ids.has(p.idProduct)) }, PROFIL_M6A);
    for (const p of doubles) plan.refus.push({ idProduct: p.idProduct, condition: 6, raison: `${compte.get(code(p))} produits portent le code ${code(p)} : on ne choisit pas` });
    return plan;
}

const { verifierAttendu, operationsEcriture, ecrire, parCarteDuPlan } = S;
const relire = (db, plan) => S.relire(db, plan, PROFIL_M6A);
const simulerSite = o => S.simulerSite(o, PROFIL_M6A);

async function executer({ argv, ouvrir, lireClone, chargerSite, log = console.log, err = console.error }) {
    const AUTORISES = [/^--tcgdex=.+$/, /^--attendu=\d+$/, /^--plan=.+\.json$/, /^--ecrire$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrireOk = argv.includes('--ecrire');
    if (!arg('tcgdex')) { err('❌ --tcgdex=<dossier data-asia du clone> obligatoire'); return 2; }
    if (ecrireOk && arg('attendu') === undefined) { err('❌ --ecrire exige --attendu=N (le nombre mesuré en simulation) — rien n\'est écrit'); return 2; }
    const clone = lireClone(arg('tcgdex'));
    const nomJa = code => { if (!/^[A-Z]{1,4}$/.test(code)) return null; const f = path.join(arg('tcgdex'), 'M', C.setTcgdex, `${code}.ts`); return fs.existsSync(f) ? E.nomJaDuTexte(fs.readFileSync(f, 'utf8')) : null; };
    log(`   clone TCGdex : ${clone.nSets} sets, ${clone.nCartes} cartes, ${clone.parProduit.size} idProduct Cardmarket nommés`);
    // la table fermée, confrontée au clone : chaque code est une carte M6a dont le nom japonais donne le type de la table
    const tableKo = Object.entries(C.codes).filter(([code, type]) => E.typeJa(nomJa(code)) !== type);
    log(`   TABLE FERMÉE contre le clone (${C.setTcgdex}/<code>, nom japonais -> type) : ${Object.keys(C.codes).length - tableKo.length}/${Object.keys(C.codes).length} concordent`);
    if (tableKo.length) { err(`❌ la table fermée contredit le clone pour ${tableKo.map(([c]) => c).join(', ')} — rien n'est écrit`); return 1; }
    const { cartes: dbC, prod, fermer } = await ouvrir({ ecriture: ecrireOk });
    try {
        const sets = await dbC.collection('sets').find({ code: CODE_SET }).project({ code: 1, region: 1, tirage: 1, idExpansion: 1, bulba: 1 }).toArray();
        if (sets.length !== 1) { err(`❌ ${sets.length} set(s) de code ${CODE_SET} (il en faut exactement un) — rien n'est écrit`); return 1; }
        const setDoc = sets[0];
        const produits = await prod.collection('catalogue_produits').find({ idExpansion: ID_EXPANSION }).project({ _id: 0, idProduct: 1, name: 1, idMetacard: 1 }).toArray();
        if (!produits.length) { err(`❌ aucun produit pour l'expansion ${ID_EXPANSION} (instrument muet, §41) — rien n'est écrit`); return 1; }
        const ids = produits.map(p => p.idProduct);
        const numRows = await prod.collection('numeros_cartes').find({ idProduct: { $in: ids } }).project({ _id: 0, idProduct: 1, numero: 1, slug: 1 }).toArray();
        const nums = new Map(numRows.map(n => [n.idProduct, n.numero == null ? null : String(n.numero)]));
        const fiches = new Map(produits.map(p => [p.idProduct, { slug: numRows.find(n => n.idProduct === p.idProduct)?.slug ?? null, idMetacard: p.idMetacard ?? null }]));
        const lignes = await dbC.collection('cartes_produits').find({ idProduct: { $in: ids } }).project({ idProduct: 1, carteId: 1, preuve: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1, slug: 1 }).toArray();
        const energies = await dbC.collection('cartes').find({ nomEn: /^Basic \w+ Energy$/, 'impressions.expansion': C.expansion }).project({ nomEn: 1, sets: 1, impressions: 1, liens: 1 }).toArray();
        const avecLigne = new Set(lignes.map(l => l.idProduct));
        const energiesSans = produits.filter(p => E.typeProduit(p.name) && !avecLigne.has(p.idProduct));
        log(`\n■ m6a (${setDoc._id}, exp ${ID_EXPANSION}) · DÉNOMINATEUR ${produits.length} produits, ${avecLigne.size} avec une ligne, ${produits.length - avecLigne.size} sans ligne (dont ${energiesSans.length} « Basic … Energy ») · ${energies.length} cartes « Basic … Energy » portant l'impression « ${C.expansion} »`);
        log(`   CALIBRATION : impossible (${produits.filter(p => E.typeProduit(p.name) && avecLigne.has(p.idProduct)).length} produit(s) « Basic … Energy » déjà joint(s) dans m6a) — remplacée par la table fermée, les codes dédoublonnés, la carte unique et la simulation du site`);

        const plan = planifier({ produits, lignes, nums, fiches, cartes: energies, setDoc, clone, nomJa });
        for (const r of plan.retenus) log(`   + ${r.p.idProduct} « ${r.p.name} » code ${r.numero} (${r.ligne.detail.match(/type (\w+)/)[1]}) · Cardmarket : nom+numéro appris · TCGdex ${C.setTcgdex}/${r.numero} « ${nomJa(r.numero)} » · clone nomme le produit : ${JSON.stringify((clone.parProduit.get(r.p.idProduct) || []).map(x => `${x.setId}/${x.localId}`))} · carte ${r.carteId}${r.impression ? ' (+ impression au code)' : ''}${r.ajouteSet ? ' (+ set)' : ''}`);
        for (const r of plan.refus.filter(x => x.raison !== 'a déjà une ligne' && x.condition !== 0)) log(`   - REFUS ${r.idProduct} (condition ${r.condition}) : ${r.raison}`);
        log(`   PLAN : ${plan.retenus.length} lignes sur ${new Set(plan.retenus.map(r => r.carteId)).size} cartes · ${plan.retenus.filter(r => r.impression).length} impressions à poser · ${plan.retenus.filter(r => r.ajouteSet).length} appartenances (cartes.sets) à ajouter · ${plan.refus.length} refusés (dont ${plan.refus.filter(r => r.raison === 'a déjà une ligne').length} déjà joints, ${plan.refus.filter(r => r.condition === 0).length} hors énergies)`);
        // bidirectionnel : une carte ↔ un code ↔ un produit
        const cartesDuPlan = new Set(plan.retenus.map(r => r.carteId)), codesDuPlan = new Set(plan.retenus.map(r => r.numero));
        if (cartesDuPlan.size !== plan.retenus.length || codesDuPlan.size !== plan.retenus.length) { err('❌ le plan n\'est pas bijectif (produit ↔ code ↔ carte) — rien n\'est écrit'); return 1; }
        if (arg('plan')) fs.writeFileSync(arg('plan'), JSON.stringify({ outil: PROFIL_M6A.outil, preuve: PREUVE, lignes: plan.retenus.map(r => r.ligne), impressions: plan.retenus.filter(r => r.impression).map(r => ({ carteId: r.carteId, ...r.impression })) }, null, 1));

        try { require('./collecte-cartes/matiere-speciale').garderMatiereSpeciale(plan.retenus.map(r => r.p.idProduct), PROFIL_M6A.outil); } catch (e) { err(e.message); return 1; }
        const ctl = R.controlerRepere(energies, parCarteDuPlan(plan));
        log(`   REPÈRES D'ADRESSE : ${ctl.cartes} cartes touchées · repère ET ordre conservés ${ctl.repereConserve}/${ctl.avecRepere} · déplacés ${ctl.deplaces.length} · liens.idProduct vide ${ctl.sansRepere.length}`);
        if (ctl.deplaces.length || ctl.sansRepere.length) { err(`❌ le repère d'adresse de ${ctl.deplaces.length + ctl.sansRepere.length} carte(s) bougerait — rien n'est écrit`); if (ecrireOk) return 1; }
        let siteOk = false;
        try {
            const site = await chargerSite();
            const docs = await dbC.collection('cartes').find({ sets: setDoc._id }).project({ nomEn: 1, sets: 1, impressions: 1, images: 1 }).toArray();
            const voulus = new Set(plan.retenus.map(r => r.carteId)), presents = new Set(docs.map(d => d._id));
            const images = new Map((await dbC.collection('cartes').find({ _id: { $in: [...voulus] } }).project({ images: 1 }).toArray()).map(d => [d._id, d.images || []]));
            for (const c of energies) if (voulus.has(c._id) && !presents.has(c._id)) docs.push({ ...c, images: images.get(c._id) || [] });
            const idsDocs = new Set(docs.map(d => d._id));
            const lignesAvant = await dbC.collection('cartes_produits').find({ idExpansion: ID_EXPANSION }).project({ idProduct: 1, carteId: 1, idExpansion: 1, slug: 1, slugSet: 1, numeroFiche: 1 }).toArray();
            const Sm = simulerSite({ site, setDoc, docs, lignesAvant: lignesAvant.filter(l => idsDocs.has(l.carteId)), plan });
            log(`   SITE (règle importée) : fiches ${Sm.avant.fiches} -> ${Sm.apres.fiches} · visuels servis ${Sm.avant.servis} -> ${Sm.apres.servis} (dont ${Sm.ajouteesServies} des lignes ajoutées) · lignes ajoutées avec fiche ${Sm.ajouteesAvecFiche}/${plan.retenus.length} dont au bon numéro ${Sm.ajouteesAuBonNumero} · PERDUS fiches ${Sm.perdusFiche.length}, visuels ${Sm.perdusServi.length} · produits doublés ${Sm.avant.doubles} -> ${Sm.apres.doubles}`);
            if (Sm.perdusFiche.length || Sm.perdusServi.length || Sm.apres.doubles > Sm.avant.doubles) { err(`❌ la règle du site perdrait ${Sm.perdusFiche.length} fiche(s), ${Sm.perdusServi.length} visuel(s) ou doublerait des produits — rien n'est écrit`); if (ecrireOk) return 1; }
            else if (Sm.ajouteesAvecFiche !== plan.retenus.length || Sm.ajouteesAuBonNumero !== plan.retenus.length) { err(`❌ ${plan.retenus.length - Sm.ajouteesAuBonNumero} ligne(s) n'auraient pas leur fiche au bon numéro sur le site — rien n'est écrit`); if (ecrireOk) return 1; }
            else siteOk = true;
        } catch (e) { err(`❌ la règle du site n'a pas pu être rejouée (${e.message}) — « je ne sais pas » bloque`); if (ecrireOk) return 1; }

        if (!ecrireOk) { log(`\n   (simulation — rien n'est écrit)  ${siteOk ? '' : '⚠️ la simulation du site n\'est pas concluante'}`); return 0; }
        const v = verifierAttendu(plan, Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const r = await ecrire(dbC, plan);
        log(`\n   ÉCRIT : lignes ${r.lignes}/${plan.retenus.length} · impressions ${r.impressions}/${plan.retenus.filter(x => x.impression).length} · cartes modifiées ${r.cartes}`);
        const rel = await relire(dbC, plan);
        const nImp = plan.retenus.filter(x => x.impression).length;
        log(`   RELECTURE : lignes ${rel.lignesOk}/${rel.attendu} · impressions ${rel.impressionsOk}/${nImp} · cartes ${rel.cartesOk}/${parCarteDuPlan(plan).size}`);
        if (rel.lignesOk !== rel.attendu || rel.impressionsOk !== nImp || rel.cartesOk !== parCarteDuPlan(plan).size) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { planifier, verifierAttendu, operationsEcriture, ecrire, relire, simulerSite, executer, PROFIL_M6A, PREUVE, ID_EXPANSION };

if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const { pathToFileURL } = require('url');
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { lireClone } = require('./collecte-cartes/variantes-tcgdex');
        const exporteur = require('./exporter-donnees-logos-site');
        const SITE_LIB = process.env.SITE_LIB || 'C:/Users/Yung/Desktop/rat-market-site/lib';
        const chargerSite = async () => {
            const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
            const [L, I] = await Promise.all([lire('langueDuVisuel.ts'), lire('imageDeLImpression.ts')]);
            const site = { regle: await exporteur.regleDuSite(__dirname, SITE_LIB), fichesDesProduits: exporteur.fichesDesProduits, refusDuVisuel: L.refusDuVisuel, imageDeLImpression: I.imageDeLImpression };
            for (const [k, f] of Object.entries(site)) if (k !== 'regle' && typeof f !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
            return site;
        };
        let cx;
        const code = await executer({ argv: process.argv.slice(2), lireClone, chargerSite, ouvrir: async ({ ecriture }) => {
            cx = await ouvrirConnexions({ production: true, buckets: [], ...(ecriture ? {} : { lectureSeule: true }) });
            return { cartes: cx.cartes.db, prod: cx.prod.db, fermer: async () => cx.fermer() };
        } });
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}

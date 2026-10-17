// node poser-fiches-par-freres.js --codes=GR,BUS,… --export=<export>.json --tcgdex=<…/cards-database/data>                       (simulation : rien n'est écrit)
// node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-fiches-par-freres.js … --attendu=GR:31,… --avec-numero=GR:5,… --ecrire
//
// LES FICHES DES PRODUITS OCCIDENTAUX JAMAIS APPRIS, par « frères de métacarte dans le même set » (collecte-cartes/cle-freres-metacarte.js, lot M2).
// Ces produits ont été ajoutés en lot par Cardmarket (2017-11-01, 2019-01-15, 2019-10-10) : la carte existe chez nous, ses frères (même idMetacard, même
// idExpansion) sont joints, aucun champ de l'export ne nomme leur variante. Le TEXTE de la fiche est juste ; le VISUEL ne l'est que si le scan du numéro est
// celui du produit (§19, §66) : `numeroFiche` n'est posé que par la règle de collecte-cartes/numero-fiche-freres.js (le clone TCGdex dit le tampon).
// Ce qui s'écrit (ADDITIF strict) : la ligne de jointure (`preuve: 'metacarte+freres'`, `$setOnInsert`) et, sur la carte, `$addToSet` de `liens.idProduct`,
// `liens.idMetacards`, `sets` (la liste fermée de regle-r-fiches.js : garderEcritureSite). AUCUNE image, AUCUNE impression (la carte est déjà membre du set).
// GARDES (toutes AVANT la première écriture) :
//  (1) arguments : `--codes` sans doublon, chaque code = UN set intl de la base, `--export` et `--tcgdex` obligatoires, `--attendu=CODE:N` ET
//      `--avec-numero=CODE:M` pour chaque code en écriture ;
//  (2) l'outil REJOUE LA CALIBRATION lui-même (même export, même base, mêmes fonctions : calibration-freres-metacarte.js), imprime ses chiffres, et refuse si
//      une épreuve compte un faux ou si les cas atteints sont sous les minimums — aucun rapport externe n'est lu ;
//  (3) `--attendu` = le nombre de lignes du plan de ce set, `--avec-numero` = le nombre de celles qui portent un numeroFiche (donc un visuel possible) ;
//  (4) la simulation du SITE (règle du site importée) : 0 fiche et 0 visuel perdus, sinon rien ; aucun repère d'adresse (`liens.idProduct[0]`) qui bouge.
// ➕ REPRISE : les lignes déjà posées par cet outil ne comptent ni comme « jointes » ni comme frères (pas de preuve circulaire) ; le plan est donc le même
// après un arrêt, les écritures sont idempotentes, et la relance achève les cartes.
// ➕ LA RELECTURE compte ce que le PLAN attend, ligne par ligne (preuve, numeroFiche) et carte par carte (chaque idProduct dans `liens.idProduct`, le set dans `sets`) :
// SEA-2 attendait une impression par carte alors que 3 cartes n'en recevaient pas, et sortait en code 1 après une écriture correcte. Ici rien n'est attendu
// de ce que le plan ne produit pas (pas d'impression).
require('dotenv').config();
const fs = require('fs');
const { estCarteCode, decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { garderMatiereSpeciale } = require('./collecte-cartes/matiere-speciale');
const K = require('./collecte-cartes/cle-freres-metacarte');
const Cal = require('./collecte-cartes/calibration-freres-metacarte');
const { planDuSet, simulerSet } = require('./collecte-cartes/plan-freres-metacarte');
const R = require('./collecte-cartes/regle-r-fiches');

const PREUVE = K.PREUVE;
const AUTORISES = [/^--codes=[\w.,/-]+$/, /^--export=.+\.json$/, /^--tcgdex=.+$/, /^--attendu=[\w.:,/-]+$/, /^--avec-numero=[\w.:,/-]+$/, /^--ecrire$/];
const compte = lst => { const o = {}; for (const x of lst) o[x] = (o[x] || 0) + 1; return o; };

/**
 * @param {object} o
 * @param {string[]} o.argv
 * @param {()=>Promise<{db: object, fermer: ()=>Promise}>} o.ouvrir  ouvre la base `cartes`
 * @param {(dossier:string)=>object} o.lireClone  variantes-tcgdex.lireClone
 * @param {()=>Promise<object>} o.chargerSite  { regle, fichesDesProduits, refusDuVisuel, imageDeLImpression } — la règle du site, importée
 * @returns {Promise<number>} le code de sortie
 */
async function executer({ argv, ouvrir, lireClone, chargerSite, minimums = Cal.MINIMUMS, log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const CODES = (arg('codes') || '').split(',').filter(Boolean), EXPORT = arg('export'), TCGDEX = arg('tcgdex');
    const ecrire = argv.includes('--ecrire');
    if (!CODES.length || !EXPORT || !TCGDEX) { err('❌ --codes=<CODE>[,…], --export=<fichier>.json et --tcgdex=<dossier data du clone> obligatoires'); return 2; }
    const doublons = CODES.filter((c, i) => CODES.indexOf(c) !== i);
    if (doublons.length) { err(`❌ --codes en doublon : ${[...new Set(doublons)].join(', ')} — rien n'est écrit`); return 2; }
    const lireTable = nom => Object.fromEntries((arg(nom) || '').split(',').filter(Boolean).map(x => { const [c, n] = x.split(':'); return [c, Number(n)]; }));
    const ATTENDUS = lireTable('attendu'), NUMEROTES = lireTable('avec-numero');
    for (const [nom, T] of [['attendu', ATTENDUS], ['avec-numero', NUMEROTES]]) {
        const hors = Object.keys(T).filter(c => !CODES.includes(c));
        if (hors.length) { err(`❌ --${nom} pour un code non demandé : ${hors.join(', ')} — rien n'est écrit`); return 2; }
        if (Object.values(T).some(n => !Number.isInteger(n))) { err(`❌ --${nom} : une valeur n'est pas un entier — rien n'est écrit`); return 2; }
    }
    if (ecrire) {
        const manquants = CODES.filter(c => !Number.isInteger(ATTENDUS[c]) || !Number.isInteger(NUMEROTES[c]));
        if (manquants.length) { err(`❌ --ecrire exige --attendu=CODE:N ET --avec-numero=CODE:M pour chaque code (manque : ${manquants.join(', ')}) — rien n'est écrit`); return 2; }
    }
    const clone = lireClone(TCGDEX);                       // LÈVE sur un clone vide (§41)
    log(`   clone TCGdex : ${clone.nSets} sets, ${clone.nCartes} cartes, ${clone.parProduit.size} idProduct Cardmarket nommés`);

    const { db, fermer } = await ouvrir();
    try {
        // ── les sets demandés : UN set intl par code ──
        const setsDocs = await lireMongo(db.collection('sets'), {}, { nom: 'sets', projection: { code: 1, region: 1, tirage: 1, idExpansion: 1, bulba: 1 } });
        const L = [];
        for (const code of CODES) {
            const c = setsDocs.filter(s => s.code === code);
            if (c.length !== 1) { err(`❌ code ${code} : ${c.length} set(s) de ce code dans la base (${c.map(s => s._id).join(', ')}) — il en faut exactement un, rien n'est écrit`); return 1; }
            const s = c[0], exps = [].concat(s.idExpansion ?? []);
            if ((s.tirage ?? s.region) !== 'intl') { err(`❌ code ${code} (${s._id}) : tirage « ${s.tirage ?? s.region} », l'outil ne vaut que pour l'intl — rien n'est écrit`); return 1; }
            if (!exps.length) { err(`❌ code ${code} (${s._id}) : aucune expansion Cardmarket — rien n'est écrit`); return 1; }
            L.push({ code, slugSet: s._id, exps, doc: s });
        }
        const exp = Cal.chargerExport(EXPORT);
        const lignes = await lireMongo(db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1, preuve: 1, idExpansion: 1 } });
        const cartes = await lireMongo(db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, sets: 1, impressions: 1, images: 1, liens: 1 } });

        // ── (2) la calibration, REJOUÉE ICI ──
        log(`\n════ CALIBRATION rejouée (export ${EXPORT}) ════`);
        const cal = Cal.calibrer({ lignes, cartes, export: exp, sets: setsDocs, ecrits: L.map(x => ({ code: x.code, slugSet: x.slugSet })), log });
        Cal.imprimer(cal, log);
        const v = Cal.verdict(cal, minimums);
        if (!v.ok) {
            log(`   🔴 CALIBRATION INSUFFISANTE : ${v.refus.join(' · ')}`);
            if (ecrire) { err('❌ ARRÊT : la garde de calibration refuse — rien n\'est écrit'); return 1; }
        } else log('   ✅ la calibration passe (0 faux sur A, B\', D-nom, D-frères ; cas atteints >= minimums pour A, B\', D-nom, D-frères ; le 0 faux repose sur A et B\', D ne prouve que « le refus a servi »)');

        // ── le plan, set par set ──
        const metaDe = new Map([...exp].map(([id, e]) => [id, { idMetacard: e.idMetacard, idExpansion: e.idExpansion }]));
        const lignesDuMonde = lignes.filter(l => l.preuve !== PREUVE);           // pas de preuve circulaire, et la reprise rejoue le même plan
        const freres = K.indexerFreres(lignesDuMonde, metaDe);
        const jointsIds = new Set(lignesDuMonde.map(l => l.idProduct));
        const parSet = K.repartirParSet(cartes, new Set(L.map(x => x.slugSet)));
        const aEcrire = [], resume = [], tous = [];
        for (const Li of L) {
            const docs = parSet.get(Li.slugSet) || [];
            const produits = [...exp].filter(([id, e]) => Li.exps.includes(e.idExpansion) && !estCarteCode(e.name)).map(([id, e]) => ({ idProduct: id, name: e.name, ...decomposerNomCardmarket(e.name), idMetacard: e.idMetacard, idExpansion: e.idExpansion }));
            const P = planDuSet({ produits, jointsIds, ctx: { freres, set: K.preparerSet(docs, { slugSet: Li.slugSet }) }, clone, tirage: Li.doc.tirage ?? Li.doc.region, expansions: [].concat(Li.doc.bulba?.expansion ?? []) });
            // ── la simulation du SITE ──
            const site = await chargerSite();
            const ids = new Set(docs.map(d => d._id));
            const lignesAvant = lignesDuMonde.filter(l => Li.exps.includes(l.idExpansion) && ids.has(l.carteId));
            const versAjoutees = retenus => retenus.map(x => ({ idProduct: x.p.idProduct, carteId: x.d.carte._id, idExpansion: x.p.idExpansion, slugSet: Li.slugSet, numeroFiche: x.num.numeroFiche }));
            let S = simulerSet({ site, setDoc: Li.doc, docs, lignesAvant, ajoutees: versAjoutees(P.retenus) });
            // 🔑 UN numeroFiche ABSENT N'EST PAS « AUCUN VISUEL » : la règle du site sert le SEUL scan d'une carte à un produit sans numéro (constaté en réel : MEP,
            // Pikachu n°093). Une ligne dont la règle du numéro refuse le visuel (tampon, carte absente du clone, tampon non nommé…) mais que le site SERVIRAIT quand même
            // n'est pas écrite : la preuve de variante qu'on exige du numéro, on l'exige du visuel que le site en tirerait.
            const servies = new Set(S.ajouteesServies);
            const sansPreuve = P.retenus.filter(x => x.num.numeroFiche == null && servies.has(x.p.idProduct));
            if (sansPreuve.length) {
                for (const x of sansPreuve) P.refus.push({ p: x.p, niveau: 4, raison: `le site servirait à ce produit le scan de la carte ${x.d.carte._id} sans preuve de variante (numéro non posé : ${x.num.motif})` });
                P.retenus = P.retenus.filter(x => !sansPreuve.includes(x));
                S = simulerSet({ site, setDoc: Li.doc, docs, lignesAvant, ajoutees: versAjoutees(P.retenus) });
            }
            const avecNumero = P.retenus.filter(x => x.num.numeroFiche != null);
            const ajoutees = versAjoutees(P.retenus);
            const raisons = compte(P.refus.map(x => x.raison.replace(/\(.*\)/, '(…)').replace(/\d+ frère/, 'N frère').replace(/« [^»]*»/, '« … »')));
            const dec = { statut: compte(P.retenus.map(x => x.num.statut)), motifsSansNumero: compte(P.retenus.filter(x => x.num.numeroFiche == null).map(x => x.num.motif.replace(/\([^)]*\)/, '(…)'))), selonLeCahier: P.retenus.filter(x => x.num.selonLeCahier).length };
            log(`\n■ ${Li.code} (${Li.slugSet}, exp ${Li.exps.join('+')}) · DÉNOMINATEUR ${produits.length} produits du set, ${produits.filter(p => jointsIds.has(p.idProduct)).length} déjà joints, ${produits.length - produits.filter(p => jointsIds.has(p.idProduct)).length} sans ligne · ${P.retenus.length} lignes · ${new Set(P.retenus.map(x => x.d.carte._id)).size} cartes · avec numeroFiche ${avecNumero.length} · sans ${P.retenus.length - avecNumero.length} · ${P.refus.length} refusés`);
            for (const [k, n] of Object.entries(raisons).sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)} refusés · ${k}`);
            log(`      variante (TCGdex) : ${JSON.stringify(dec.statut)} · numéro non posé : ${JSON.stringify(dec.motifsSansNumero)} · que le cahier aurait posé : ${dec.selonLeCahier}`);
            log(`      SITE (règle importée) : fiches ${S.avant.fiches} -> ${S.apres.fiches} · visuels servis ${S.avant.servis} -> ${S.apres.servis} (dont ${S.ajouteesServies.length} des lignes ajoutées) · lignes ajoutées avec fiche ${S.ajouteesAvecFiche}/${ajoutees.length} · PERDUS fiches ${S.perdusFiche.length}, visuels ${S.perdusServi.length} · produits doublés ${S.avant.doubles} -> ${S.apres.doubles}`);
            resume.push({ code: Li.code, lignes: P.retenus.length, cartes: new Set(P.retenus.map(x => x.d.carte._id)).size, avecNumero: avecNumero.length, servis: S.ajouteesServies.length, perdus: S.perdusFiche.length + S.perdusServi.length, refus: P.refus.length });
            tous.push(...P.retenus.map(x => ({ ...x, Li })));
            if (S.perdusFiche.length || S.perdusServi.length) { err(`❌ ${Li.code} : la règle du site perdrait ${S.perdusFiche.length} fiche(s) et ${S.perdusServi.length} visuel(s) (${[...S.perdusFiche, ...S.perdusServi].slice(0, 5).join(', ')}) — rien n'est écrit`); if (ecrire) return 1; }
            if (ecrire && ATTENDUS[Li.code] !== P.retenus.length) { err(`❌ ARRÊT : ${Li.code} rend ${P.retenus.length} lignes, attendu ${ATTENDUS[Li.code] ?? 'non donné'} — rien n'est écrit`); return 1; }
            if (ecrire && NUMEROTES[Li.code] !== avecNumero.length) { err(`❌ ARRÊT : ${Li.code} rend ${avecNumero.length} lignes avec numeroFiche, attendu ${NUMEROTES[Li.code] ?? 'non donné'} — rien n'est écrit`); return 1; }
            aEcrire.push(...P.retenus.map(x => ({ ...x, Li })));
        }
        log(`\n   TOTAL ${aEcrire.length} lignes sur ${new Set(aEcrire.map(x => x.d.carte._id)).size} cartes, ${aEcrire.filter(x => x.num.numeroFiche != null).length} avec numeroFiche${ecrire ? '' : ' — (simulation)'}`);
        log(`   TABLEAU PAR SET : ${resume.map(r => `${r.code}=${r.lignes}/${r.avecNumero}num/${r.servis}servis`).join(' · ')}`);

        // ── le repère d'adresse du site : ni nomEn ni l'ordre de liens.idProduct ne bougent ──
        const parCarte = new Map();
        for (const x of aEcrire) { const w = parCarte.get(x.d.carte._id) || parCarte.set(x.d.carte._id, { ids: [], metas: new Set(), sets: new Set() }).get(x.d.carte._id); w.ids.push(x.p.idProduct); if (x.p.idMetacard != null) w.metas.add(x.p.idMetacard); w.sets.add(x.Li.slugSet); }
        const ctl = R.controlerRepere(cartes, parCarte);
        log(`   REPÈRES D'ADRESSE : ${ctl.cartes} cartes touchées · ${ctl.avecRepere} ont un liens.idProduct · repère ET ordre conservés ${ctl.repereConserve}/${ctl.avecRepere} · déplacés ${ctl.deplaces.length} · liens.idProduct vide ${ctl.sansRepere.length}`);
        if (ctl.deplaces.length || ctl.sansRepere.length) { err(`❌ le repère d'adresse de ${ctl.deplaces.length + ctl.sansRepere.length} carte(s) bougerait (${[...ctl.deplaces, ...ctl.sansRepere].slice(0, 5).join(', ')}) — rien n'est écrit`); if (ecrire) return 1; }
        // 🔴 LOT METAL : les « frères de métacarte » sont exactement le chemin qui donnerait la fiche de la carte normale à un produit en matière spéciale (table fermée) : refus, même à blanc
        try { garderMatiereSpeciale(aEcrire.map(x => x.p.idProduct), 'poser-fiches-par-freres'); } catch (e) { err(e.message); return 1; }
        if (!ecrire || !aEcrire.length) return 0;

        // ── l'écriture, ADDITIVE et idempotente ──
        const le = new Date();
        const ops = R.operationsCartes(parCarte); R.garderEcritureSite(ops);
        await db.collection('cartes_produits').bulkWrite(aEcrire.map(x => ({ updateOne: { filter: { _id: `${x.d.carte._id}|${x.p.idProduct}` }, update: { $setOnInsert: {
            carteId: x.d.carte._id, idProduct: x.p.idProduct, idExpansion: x.p.idExpansion, tirage: 'intl', preuve: PREUVE, slug: null, slugSet: x.Li.slugSet, numeroFiche: x.num.numeroFiche,
            detail: `${x.Li.code} « ${x.p.name} » -> « ${x.d.carte.nomEn} » (${x.d.carte._id}) : ${x.d.freres.length} frères de métacarte ${x.p.idMetacard} dans l'expansion ${x.p.idExpansion} joints à cette seule carte (nom unique dans le set, témoins du nom et des attaques muets) · variante : ${x.num.statut} — ${x.num.motif}${x.num.numeroFiche == null ? ' · fiche SANS numéro (aucun visuel posé)' : ` · numéro ${x.num.numeroFiche}`}`,
            verifieLe: le, route: x.Li.code } }, upsert: true } })), { ordered: false });
        await db.collection('cartes').bulkWrite(ops, { ordered: false });

        // ── la RELECTURE après écriture : ce qui est en base, comparé à ce que le PLAN attend ──
        const relues = await lireMongo(db.collection('cartes_produits'), { _id: { $in: aEcrire.map(x => `${x.d.carte._id}|${x.p.idProduct}`) } }, { nom: 'cartes_produits (relecture)', projection: { preuve: 1, numeroFiche: 1 } });
        const parId = new Map(relues.map(l => [l._id, l]));
        const lignesOk = aEcrire.filter(x => { const l = parId.get(`${x.d.carte._id}|${x.p.idProduct}`); return l && l.preuve === PREUVE && (l.numeroFiche ?? null) === (x.num.numeroFiche ?? null); }).length;
        const cartesRelues = new Map((await lireMongo(db.collection('cartes'), { _id: { $in: [...parCarte.keys()] } }, { nom: 'cartes (relecture)', projection: { sets: 1, liens: 1 } })).map(c => [c._id, c]));
        const cartesOk = [...parCarte].filter(([id, w]) => { const c = cartesRelues.get(id); return c && w.ids.every(i => (c.liens?.idProduct || []).includes(i)) && [...w.sets].every(s => (c.sets || []).includes(s)); }).length;
        log(`\n   RELECTURE : lignes (preuve et numeroFiche du plan) ${lignesOk}/${aEcrire.length} · cartes avec tous leurs idProduct et leur set ${cartesOk}/${parCarte.size}`);
        if (lignesOk !== aEcrire.length || cartesOk !== parCarte.size) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { executer, PREUVE };

if (require.main === module) {
    (async () => {
        const path = require('path');
        const { pathToFileURL } = require('url');
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { lireClone } = require('./collecte-cartes/variantes-tcgdex');
        const exporteur = require('./exporter-donnees-logos-site');
        const SITE_LIB = process.env.SITE_LIB || path.join(__dirname, '..', 'rat-market-site', 'lib');
        const chargerSite = async () => {
            const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
            const [L, I] = await Promise.all([lire('langueDuVisuel.ts'), lire('imageDeLImpression.ts')]);
            const site = { regle: await exporteur.regleDuSite(), fichesDesProduits: exporteur.fichesDesProduits, refusDuVisuel: L.refusDuVisuel, imageDeLImpression: I.imageDeLImpression };
            for (const [k, f] of Object.entries(site)) if (k !== 'regle' && typeof f !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
            return site;
        };
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
        const code = await executer({ argv: process.argv.slice(2), ouvrir: async () => ({ db: cx.db, fermer: async () => { } }), lireClone, chargerSite });
        await fermer();
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}

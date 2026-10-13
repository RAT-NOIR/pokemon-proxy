// node corriger-numeros-sea2.js                (simulation : la preuve est rejouée et imprimée, rien n'est écrit)
// node lot-additif.js --quoi="…" --collections=cartes,cartes_produits [--annonce=annonce-sea2.json] -- node corriger-numeros-sea2.js --ecrire
//
// LES DEUX NUMÉROS FAUX DU LOT SEA-2 (M-P/ID, relecture du 2026-10-13) : Pawmi (860034) et Gastly (860035). La Setlist met deux cartes aux
// n° 17, 18, 19 et aucune aux n° 35-37 ; les slugs Cardmarket disent `Pawmi-M-PID035` et `Gastly-M-PID036`. L'outil SEA-2 a écrit le n° de
// la Setlist (17, 18), en collision avec Squawkabilly ex 017 et Hole-Digging Shovel 018.
// DÉCISION DU TESTEUR (2026-10-13), rejouée ici avant toute écriture (§77 : un feu vert autorise un geste, il ne prouve pas sa prémisse) :
//   a) corriger en 35 et 36 SI la fiche officielle TPC du cache (`tpc_fiches`, M-P indonésien) le confirme — le n° 035 / 036 de la liste
//      porte LE NOM de la carte ou, quand il est traduit, son n° de Pokédex et ses PV (collecte-cartes/tpc.js : planifierTpc, la règle de
//      la production, jamais une copie) ;
//   b) SINON retirer seulement le `numeroFiche` des deux lignes et l'impression « 17 » de Pawmi (les fiches restent).
// LISTE FERMÉE : deux produits, rien d'autre. GARDES (avant la première écriture) : la ligne est celle que SEA-2 a écrite (preuve, slug, numéro
// faux, slugSet), la carte est la bonne, l'impression SEA-2 de Pawmi est unique ; le cache TPC est COMPLET (liste complète, toutes les fiches
// lues) — un cache incomplet ne prouve ni l'absence ni la présence, l'outil s'arrête. ÉCRITURE : le geste minimal sur ces seuls documents —
// `$unset` / `$set` d'UN champ, `$pull` / `$set` positionnel / `$push` ciblés d'UNE impression : jamais un tableau entier. La relecture en base
// compare les numéros par `cleNumero` de la production (« 018 » = « 18 »), à l'ATTENDU de la décision.
// ⚠️ L'impression « 018 » de Gastly (tirage id, source setlist) existait AVANT SEA-2 : elle n'est jamais touchée ; l'outil la dit.
require('dotenv').config();
const { cleNumero } = require('./collecte-cartes/jointure');
const T = require('./collecte-cartes/tpc');

const PREUVE = 'metacarte+setlist';
const SLUGSET = 'M-P-Indonesian-Promos', ETAT = 'tpc-asie/M-P-Indonesian-Promos', SITE = 'tpc-asie', LANGUE = 'id', CODE = 'M-P';
const IMP = { tirage: 'id', expansion: 'M-P Promotional cards', source: 'setlist' };
const LISTE = Object.freeze([
    Object.freeze({ idProduct: 860034, carteId: 342068, nomEn: 'Pawmi', slug: 'Pawmi-M-PID035', numeroFaux: '17', numeroOfficiel: '35', impressionSea2: true }),
    Object.freeze({ idProduct: 860035, carteId: 339431, nomEn: 'Gastly', slug: 'Gastly-M-PID036', numeroFaux: '18', numeroOfficiel: '36', impressionSea2: false })
]);
const AUTORISES = [/^--ecrire$/, /^--restantes$/];
// COURTS2 (option --restantes, décision 8 du testeur, 2026-10-13) : « les impressions thaïes « 017 » et « 018 » de Pawmi et Gastly, et l'impression
// id « 018 » de Gastly : même règle que la voie b) (preuve TPC, sinon on retire le numéro, les fiches restent) ». LISTE FERMÉE : trois impressions,
// toutes de source setlist, antérieures à SEA-2. Pour CHACUNE : la fiche TPC de SA langue à SON numéro (cache complet, planifierTpc — la règle de la
// production, jamais une copie) désigne-t-elle la même carte (n° de Pokédex + PV + set, §75) ? Oui : preuve écrite, rien ne bouge. Non ou pas de
// fiche : l'IMPRESSION part (`$pull` ciblé de cette seule impression, la fiche reste) — sauf si une image est jointe à ce numéro dans ce set :
// elle a été jointe par une preuve, on ne retire jamais une image juste, l'outil s'ARRÊTE et le dit.
const RESTANTES = Object.freeze([
    Object.freeze({ nomEn: 'Pawmi', carteId: 342068, tirage: 'th', langue: 'th', etat: 'tpc-asie/M-P-Thai-Promos', set: 'M-P-Thai-Promos', numero: '017' }),
    Object.freeze({ nomEn: 'Gastly', carteId: 339431, tirage: 'th', langue: 'th', etat: 'tpc-asie/M-P-Thai-Promos', set: 'M-P-Thai-Promos', numero: '018' }),
    Object.freeze({ nomEn: 'Gastly', carteId: 339431, tirage: 'id', langue: 'id', etat: ETAT, set: SLUGSET, numero: '018' })
]);
const estImpR = (i, r) => i && i.tirage === r.tirage && i.expansion === IMP.expansion && i.source === IMP.source && memeNumero(i.numero, r.numero);

/** La liste TPC d'un cache (complète, toutes les fiches lues) ; sinon { erreur } — un cache incomplet ne prouve ni l'absence ni la présence. */
async function lireFichesTpc(db, etatId, langue) {
    const etat = (await db.collection('collecte_images_etat').find({ _id: etatId }).toArray())[0];
    const liste = etat?.liste;
    if (!liste?.complete || liste.code !== CODE || liste.langue !== langue || !Array.isArray(liste.ids) || !liste.ids.length || liste.total !== liste.ids.length) return { erreur: `❌ la liste TPC ${etatId} du cache n'est pas complète (${JSON.stringify({ complete: liste?.complete, total: liste?.total, ids: liste?.ids?.length })}) — l'absence d'une fiche ne se conclurait pas ; rien n'est écrit` };
    const docs = await db.collection('tpc_fiches').find({ _id: { $in: liste.ids.map(i => `${SITE}/${langue}/${i}`) } }).toArray();
    if (docs.length !== liste.ids.length) return { erreur: `❌ ${docs.length} fiches en cache sur ${liste.ids.length} de la liste — rien n'est écrit` };
    return { liste, fiches: docs.map(d => ({ ...d.fiche, idFiche: d.idFiche, urlFiche: d.url })) };
}

async function executerRestantes({ argv, ouvrir, log, err }) {
    const ecrire = argv.includes('--ecrire');
    const { db, fermer } = await ouvrir();
    try {
        const cartes = new Map();
        for (const r of RESTANTES) {
            if (cartes.has(r.carteId)) continue;
            const c = (await db.collection('cartes').find({ _id: r.carteId }).toArray())[0];
            if (!c || c.nomEn !== r.nomEn) { err(`❌ la carte ${r.carteId} n'est pas « ${r.nomEn} » — rien n'est écrit`); return 1; }
            cartes.set(r.carteId, c);
        }
        const caches = new Map();
        for (const [etatId, langue] of [...new Set(RESTANTES.map(r => `${r.etat}|${r.langue}`))].map(s => s.split('|'))) {
            const l = await lireFichesTpc(db, etatId, langue);
            if (l.erreur) { err(l.erreur); return 1; }
            log(`TPC ${etatId} : liste complète ${l.liste.ids.length}/${l.liste.total}, ${l.fiches.length} fiches lues (cache), lue le ${new Date(l.liste.luLe).toISOString().slice(0, 10)}`);
            caches.set(etatId, l.fiches);
        }
        const decisions = [];
        for (const r of RESTANTES) {
            const c = cartes.get(r.carteId);
            const imps = (c.impressions || []).filter(i => estImpR(i, r));
            const fichesAuNumero = caches.get(r.etat).filter(f => memeNumero(f.numero, r.numero));
            const lue = fichesAuNumero.length ? fichesAuNumero.map(f => `fiche TPC ${f.idFiche} « ${f.nom} » (Pokédex ${f.dex ?? '—'}, PV ${f.pv ?? '—'})`).join(' ; ') : `AUCUNE fiche TPC au n° ${r.numero}`;
            if (imps.length > 1) { err(`❌ ${r.nomEn} ${r.tirage} « ${r.numero} » : ${imps.length} impressions de source setlist, attendu 0 ou 1 — rien n'est écrit`); return 1; }
            const { plan, restes } = T.planifierTpc({ trous: [{ carte: c, numeroFiche: r.numero, idProduct: 0 }], fiches: caches.get(r.etat), code: CODE, site: SITE });
            const prouvee = plan.length === 1, motif = restes[0] ? `${restes[0].motif}${restes[0].detail ? ` (${restes[0].detail})` : ''}` : null;
            const images = (c.images || []).filter(e => e && e.set === r.set && memeNumero(e.numero, r.numero));
            const d = { ...r, exact: imps[0]?.numero ?? null, dejaRetiree: imps.length === 0, prouvee, retrait: !prouvee && imps.length === 1 };
            if (imps.length === 0) log(`■ ${r.nomEn} ${r.tirage} « ${r.numero} » : impression DÉJÀ retirée — ${lue}`);
            else if (prouvee) log(`■ ${r.nomEn} ${r.tirage} « ${r.numero} » : ${lue} — PROUVÉE, rien ne bouge : ${plan[0].preuve}`);
            else log(`■ ${r.nomEn} ${r.tirage} « ${r.numero} » : ${lue} — la preuve manque : ${motif} ⇒ RETIRER l'impression (la fiche reste)`);
            if (d.retrait && images.length) { err(`❌ ${r.nomEn} ${r.tirage} « ${r.numero} » : une image est jointe à ce numéro (${images.map(e => e.cleR2).join(', ')}) alors que la preuve manque — elle avait été jointe par une preuve : on ne retire jamais une image juste, RE-VÉRIFIER avant tout ; rien n'est écrit`); return 1; }
            decisions.push(d);
        }
        const aFaire = decisions.filter(d => d.retrait);
        if (!aFaire.length) { err('❌ rien à faire : aucune impression à retirer (prouvées ou déjà retirées)'); return 1; }
        const annonce = {};
        for (const d of aFaire) { const k = `impressions imp:${d.tirage}|${IMP.expansion}`; annonce[k] = (annonce[k] || 0) + 1; }
        log(`   annonce de lot-additif : ${JSON.stringify(annonce)}`);
        const avant = new Map([...cartes].map(([id, c]) => [id, { n: (c.impressions || []).filter(Boolean).length, images: JSON.stringify(c.images ?? null), liens: JSON.stringify(c.liens?.idProduct ?? null), sets: JSON.stringify([...(c.sets || [])].sort()) }]));
        if (!ecrire) { log('(simulation — rien n\'est écrit)'); return 0; }
        for (const d of aFaire) {
            const cond = { tirage: d.tirage, expansion: IMP.expansion, source: IMP.source, numero: d.exact };
            const r = await db.collection('cartes').updateOne({ _id: d.carteId, impressions: { $elemMatch: cond } }, { $pull: { impressions: cond } });
            if (r.modifiedCount !== 1) { err(`❌ ${d.nomEn} ${d.tirage} : l'impression n'a pas été retirée (${r.modifiedCount}) — la base a bougé depuis le plan ; arrêt`); return 1; }
        }
        let faux = 0;
        for (const id of cartes.keys()) {
            const c = (await db.collection('cartes').find({ _id: id }).toArray())[0], a = avant.get(id), e = [];
            const retraits = aFaire.filter(d => d.carteId === id);
            for (const d of decisions.filter(x => x.carteId === id)) {
                const reste = (c.impressions || []).filter(i => estImpR(i, d)).length;
                if (d.retrait && reste !== 0) e.push(`impression ${d.tirage} « ${d.numero} » encore là`);
                if (!d.retrait && !d.dejaRetiree && reste !== 1) e.push(`impression ${d.tirage} « ${d.numero} » : ${reste}, attendu 1 (prouvée, intacte)`);
            }
            const n = (c.impressions || []).filter(Boolean).length;
            if (n !== a.n - retraits.length) e.push(`impressions : ${n}, attendu ${a.n - retraits.length}`);
            if (JSON.stringify(c.images ?? null) !== a.images) e.push('images a changé');
            if (JSON.stringify(c.liens?.idProduct ?? null) !== a.liens) e.push('liens.idProduct a changé');
            if (JSON.stringify([...(c.sets || [])].sort()) !== a.sets) e.push('sets a changé');
            log(`   RELECTURE ${c.nomEn} : ${e.length ? '🔴 ' + e.join(' ; ') : '✅ comme attendu'}`);
            faux += e.length;
        }
        if (faux) { err('❌ la relecture ne retrouve pas l\'état attendu'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}
const memeNumero = (a, b) => a != null && b != null && cleNumero(a) === cleNumero(b);
const estImpSea2 = (i, numero) => i && i.tirage === IMP.tirage && i.expansion === IMP.expansion && i.source === IMP.source && memeNumero(i.numero, numero);

/** Pur : la décision (a ou b) de chaque produit d'après les fiches du cache. fiches : les fiches de la liste filtrée, `{…fiche, idFiche, urlFiche}`. */
function decider({ fiches, cartes }) {
    return LISTE.map(p => {
        const carte = cartes.get(p.carteId);
        const { plan, restes } = T.planifierTpc({ trous: [{ carte, numeroFiche: p.numeroOfficiel, idProduct: p.idProduct }], fiches, code: CODE, site: SITE });
        if (plan.length === 1) return { ...p, voie: 'a', preuve: plan[0].preuve, fiche: plan[0].fiche.idFiche };
        const r = restes[0] || {};
        return { ...p, voie: 'b', motif: r.motif ?? 'inconnu', detail: r.detail ?? null };
    });
}

/**
 * L'ÉTAT DE DÉPART d'un produit, reconnu par ce qu'il AUTORISE (tour 1) : l'état écrit par SEA-2 (rien de fait), ou un état À MOITIÉ corrigé
 * (l'écriture de `cartes_produits` précède celle de `cartes` : un `$pull` en échec laisse la ligne corrigée et l'impression encore là — ou
 * l'inverse après une reprise). Tout autre état refuse. Rend { ligneFaite, impFaite } ou { refus }.
 */
function etatDeDepart(d, ligne, carte) {
    const imps = (carte?.impressions || []).filter(Boolean);
    const nFaux = imps.filter(i => estImpSea2(i, d.numeroFaux)), nOff = imps.filter(i => estImpSea2(i, d.numeroOfficiel));
    const exact = (xs, n) => xs.length === 1 && xs[0].numero === n;
    let ligneFaite;
    if (ligne.numeroFiche === d.numeroFaux) ligneFaite = false;
    else if (d.voie === 'b' && ligne.numeroFiche == null) ligneFaite = true;
    else if (d.voie === 'a' && ligne.numeroFiche != null && ligne.numeroFiche === d.numeroOfficiel) ligneFaite = true;
    else return { refus: `numeroFiche ${JSON.stringify(ligne.numeroFiche)} : ni celui de SEA-2 (« ${d.numeroFaux} ») ni l'état corrigé de la voie ${d.voie}` };
    let impFaite;
    if (d.voie === 'b') {
        if (!d.impressionSea2) impFaite = true;                                   // aucun geste sur les impressions
        else if (exact(nFaux, d.numeroFaux)) impFaite = false;
        else if (nFaux.length === 0) impFaite = true;
        else return { refus: `${nFaux.length} impression(s) id « ${d.numeroFaux} » de source setlist, attendu 1 au numéro exact (ou 0 si déjà retirée)` };
    } else if (d.impressionSea2) {
        if (exact(nFaux, d.numeroFaux) && nOff.length === 0) impFaite = false;
        else if (nFaux.length === 0 && exact(nOff, d.numeroOfficiel)) impFaite = true;
        else return { refus: `impressions id « ${d.numeroFaux} » : ${nFaux.length}, « ${d.numeroOfficiel} » : ${nOff.length} — ni l'état de SEA-2 ni l'état corrigé` };
    } else if (nOff.length === 0) impFaite = false;
    else if (exact(nOff, d.numeroOfficiel)) impFaite = true;
    else return { refus: `${nOff.length} impression(s) id « ${d.numeroOfficiel} » de source setlist, attendu 0 ou 1 au numéro exact` };
    return { ligneFaite, impFaite };
}

/** Les écritures d'une décision : des opérations ciblées, jamais un tableau entier. `etat` : seuls les gestes MANQUANTS s'exécutent. */
function operations(d, etat = { ligneFaite: false, impFaite: false }) {
    const tout = operationsCompletes(d);
    return { cartes_produits: etat.ligneFaite ? [] : tout.cartes_produits, cartes: etat.impFaite ? [] : tout.cartes };
}
function operationsCompletes(d) {
    const ops = { cartes_produits: [], cartes: [] };
    const ligne = { _id: `${d.carteId}|${d.idProduct}`, preuve: PREUVE, numeroFiche: d.numeroFaux, slug: d.slug, slugSet: SLUGSET };
    if (d.voie === 'a') {
        ops.cartes_produits.push({ filtre: ligne, maj: { $set: { numeroFiche: d.numeroOfficiel } } });
        if (d.impressionSea2) ops.cartes.push({ filtre: { _id: d.carteId, impressions: { $elemMatch: { ...IMP, numero: d.numeroFaux } } }, maj: { $set: { 'impressions.$[e].numero': d.numeroOfficiel } }, options: { arrayFilters: [{ 'e.tirage': IMP.tirage, 'e.expansion': IMP.expansion, 'e.source': IMP.source, 'e.numero': d.numeroFaux }] } });
        else ops.cartes.push({ filtre: { _id: d.carteId, impressions: { $not: { $elemMatch: { tirage: IMP.tirage, expansion: IMP.expansion, numero: d.numeroOfficiel } } } }, maj: { $push: { impressions: { ...IMP, numero: d.numeroOfficiel, total: null, deck: null, rarete: null } } } });
    } else {
        ops.cartes_produits.push({ filtre: ligne, maj: { $unset: { numeroFiche: '' } } });
        if (d.impressionSea2) ops.cartes.push({ filtre: { _id: d.carteId, impressions: { $elemMatch: { ...IMP, numero: d.numeroFaux } } }, maj: { $pull: { impressions: { ...IMP, numero: d.numeroFaux } } } });
    }
    return ops;
}

/** La relecture d'un produit en base, à l'ATTENDU de sa décision (numéros par cleNumero). Rend la liste des écarts ([] = juste). */
function ecartsApres(d, ligne, carte, avant) {
    const e = [];
    if (!ligne) return [`ligne ${d.carteId}|${d.idProduct} absente`];
    if (ligne.preuve !== PREUVE || ligne.slug !== d.slug || ligne.slugSet !== SLUGSET) e.push('la ligne a changé de preuve, de slug ou de set');
    const imps = (carte?.impressions || []).filter(Boolean);
    const dont = n => imps.filter(i => estImpSea2(i, n)).length;
    if (d.voie === 'a') {
        if (!memeNumero(ligne.numeroFiche, d.numeroOfficiel)) e.push(`numeroFiche ${JSON.stringify(ligne.numeroFiche)}, attendu ${d.numeroOfficiel}`);
        if (dont(d.numeroOfficiel) !== 1) e.push(`impression id « ${d.numeroOfficiel} » : ${dont(d.numeroOfficiel)}, attendu 1`);
        if (d.impressionSea2 && dont(d.numeroFaux) !== 0) e.push(`impression id « ${d.numeroFaux} » encore là`);
        const attendu = avant.impressions + (d.impressionSea2 ? 0 : 1);
        if (imps.length !== attendu) e.push(`impressions : ${imps.length}, attendu ${attendu}`);
    } else {
        if (ligne.numeroFiche != null) e.push(`numeroFiche encore là : ${JSON.stringify(ligne.numeroFiche)}`);
        if (d.impressionSea2 && dont(d.numeroFaux) !== 0) e.push(`impression id « ${d.numeroFaux} » encore là`);
        const attendu = avant.impressions - (d.impressionSea2 ? 1 : 0);
        if (imps.length !== attendu) e.push(`impressions : ${imps.length}, attendu ${attendu}`);
        if (!d.impressionSea2 && dont(d.numeroFaux) !== avant.dontSetlistId) e.push(`l'impression id « ${d.numeroFaux} » d'avant SEA-2 a bougé (${avant.dontSetlistId} → ${dont(d.numeroFaux)})`);
    }
    if (JSON.stringify(carte?.liens?.idProduct ?? null) !== JSON.stringify(avant.liens)) e.push('liens.idProduct a changé');
    if (JSON.stringify([...(carte?.sets || [])].sort()) !== JSON.stringify(avant.sets)) e.push('sets a changé');
    return e;
}

async function executer({ argv, ouvrir, log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')} — seul --ecrire existe (la liste est fermée : Pawmi 860034 et Gastly 860035)`); return 2; }
    if (argv.includes('--restantes')) return executerRestantes({ argv, ouvrir, log, err });
    const ecrire = argv.includes('--ecrire');
    const { db, fermer } = await ouvrir();
    try {
        // ── l'état trouvé : celui que SEA-2 a écrit, sinon on s'arrête (rien n'est écrit) ──
        const lignes = new Map(), cartes = new Map(), avant = new Map();
        for (const p of LISTE) {
            const ls = await db.collection('cartes_produits').find({ idProduct: p.idProduct }).toArray();
            if (ls.length !== 1) { err(`❌ ${p.nomEn} ${p.idProduct} : ${ls.length} ligne(s) de jointure, attendu 1 — rien n'est écrit`); return 1; }
            const l = ls[0];
            if (l.carteId !== p.carteId || l.preuve !== PREUVE || l.slug !== p.slug || l.slugSet !== SLUGSET) { err(`❌ ${p.nomEn} ${p.idProduct} : la ligne n'est plus celle de SEA-2 (carte ${l.carteId}, preuve ${l.preuve}, slug ${l.slug}, set ${l.slugSet}) — rien n'est écrit`); return 1; }
            const c = (await db.collection('cartes').find({ _id: p.carteId }).toArray())[0];
            if (!c || c.nomEn !== p.nomEn) { err(`❌ la carte ${p.carteId} n'est pas « ${p.nomEn} » — rien n'est écrit`); return 1; }
            lignes.set(p.idProduct, l); cartes.set(p.carteId, c);
        }
        // ── la fiche officielle TPC du cache (M-P indonésien) ──
        const etat = (await db.collection('collecte_images_etat').find({ _id: ETAT }).toArray())[0];
        const liste = etat?.liste;
        if (!liste?.complete || liste.code !== CODE || liste.langue !== LANGUE || !Array.isArray(liste.ids) || !liste.ids.length || liste.total !== liste.ids.length) { err(`❌ la liste TPC ${ETAT} du cache n'est pas complète (${JSON.stringify({ complete: liste?.complete, total: liste?.total, ids: liste?.ids?.length })}) — l'absence d'une fiche ne se conclurait pas ; rien n'est écrit`); return 1; }
        const docs = await db.collection('tpc_fiches').find({ _id: { $in: liste.ids.map(i => `${SITE}/${LANGUE}/${i}`) } }).toArray();
        if (docs.length !== liste.ids.length) { err(`❌ ${docs.length} fiches en cache sur ${liste.ids.length} de la liste — rien n'est écrit`); return 1; }
        const fiches = docs.map(d => ({ ...d.fiche, idFiche: d.idFiche, urlFiche: d.url }));
        const nums = fiches.map(f => cleNumero(f.numero)).filter(Boolean).map(Number).sort((a, b) => a - b);
        log(`TPC ${ETAT} : liste complète ${liste.ids.length}/${liste.total}, ${fiches.length} fiches lues (cache), numéros ${nums[0]}…${nums.at(-1)}, lue le ${new Date(liste.luLe).toISOString().slice(0, 10)}`);
        for (const n of ['17', '18', '19', '35', '36', '37']) log(`   n° ${n} : ${fiches.filter(f => memeNumero(f.numero, n)).map(f => `« ${f.nom} » (fiche ${f.idFiche}, Pokédex ${f.dex ?? '—'}, PV ${f.pv ?? '—'})`).join(' ; ') || 'AUCUNE fiche'}`);
        const decisions = decider({ fiches, cartes });
        for (const d of decisions) log(`■ ${d.nomEn} ${d.idProduct} (${d.slug}) : numeroFiche « ${d.numeroFaux} » → ${d.voie === 'a' ? `a) CORRIGER en ${d.numeroOfficiel} — ${d.preuve}` : `b) RETIRER le numeroFiche${d.impressionSea2 ? ` et l'impression id « ${d.numeroFaux} »` : ''} — la fiche n° ${d.numeroOfficiel} ne se prouve pas : ${d.motif}${d.detail ? ` (${d.detail})` : ''}`}`);
        // l'état de départ de chaque produit : SEA-2 intact, ou à moitié corrigé (un seul geste manquant) — sinon rien n'est écrit
        const etats = new Map();
        for (const d of decisions) {
            const c = cartes.get(d.carteId), e = etatDeDepart(d, lignes.get(d.idProduct), c);
            if (e.refus) { err(`❌ ${d.nomEn} ${d.idProduct} : ${e.refus} — rien n'est écrit`); return 1; }
            etats.set(d.idProduct, e);
            const imps = (c.impressions || []).filter(Boolean).length;
            // l'attendu de la relecture se compte depuis l'état de DÉPART SEA-2, quel que soit l'état trouvé
            const initial = imps + (d.voie === 'b' && d.impressionSea2 && e.impFaite ? 1 : 0) - (d.voie === 'a' && !d.impressionSea2 && e.impFaite ? 1 : 0);
            avant.set(d.idProduct, { impressions: initial, dontSetlistId: (c.impressions || []).filter(i => estImpSea2(i, d.numeroFaux)).length, liens: c.liens?.idProduct ?? null, sets: [...(c.sets || [])].sort() });
            log(`   état trouvé ${d.nomEn} : ligne ${e.ligneFaite ? 'DÉJÀ corrigée' : 'à corriger'} · impression ${d.voie === 'b' && !d.impressionSea2 ? 'sans geste' : e.impFaite ? 'DÉJÀ faite' : 'à faire'}${e.ligneFaite !== e.impFaite && !(d.voie === 'b' && !d.impressionSea2) ? ' — ÉTAT À MOITIÉ CORRIGÉ, seul le geste manquant sera exécuté' : ''}`);
        }
        if (decisions.every(d => etats.get(d.idProduct).ligneFaite && etats.get(d.idProduct).impFaite)) { err('❌ rien à faire : les deux produits sont déjà corrigés (la ligne n\'est plus celle de SEA-2 et l\'impression est dans l\'état attendu)'); return 1; }
        const gastly = cartes.get(339431);
        log(`   (Gastly 339431 : ${(gastly.impressions || []).filter(i => estImpSea2(i, '18')).length} impression(s) id « 018 »/« 18 » de source setlist, écrite(s) AVANT SEA-2 par un outil antérieur (pas par ce lot), au numéro de la Setlist comme l'erreur corrigée ici — jamais touchée(s), à instruire à part)`);
        const annonce = {}; let retraits = 0;
        for (const d of decisions) if (d.voie === 'b' && d.impressionSea2 && !etats.get(d.idProduct).impFaite) retraits++;
        if (retraits) annonce[`impressions imp:${IMP.tirage}|${IMP.expansion}`] = retraits;
        log(`   annonce de lot-additif : ${JSON.stringify(annonce)}`);
        if (!ecrire) { log('(simulation — rien n\'est écrit)'); return 0; }

        // ── l'écriture : le geste minimal, document par document, chaque compte vérifié ──
        for (const d of decisions) {
            const ops = operations(d, etats.get(d.idProduct));
            for (const o of ops.cartes_produits) { const r = await db.collection('cartes_produits').updateOne(o.filtre, o.maj, o.options); if (r.modifiedCount !== 1) { err(`❌ ${d.nomEn} : la ligne n'a pas été modifiée (${r.modifiedCount}) — la base a bougé depuis le plan ; arrêt`); return 1; } }
            for (const o of ops.cartes) { const r = await db.collection('cartes').updateOne(o.filtre, o.maj, o.options); if (r.modifiedCount !== 1) { err(`❌ ${d.nomEn} : la carte n'a pas été modifiée (${r.modifiedCount}) — arrêt`); return 1; } }
        }
        // ── la relecture : ce qui est en base ──
        let faux = 0;
        for (const d of decisions) {
            const l = (await db.collection('cartes_produits').find({ _id: `${d.carteId}|${d.idProduct}` }).toArray())[0];
            const c = (await db.collection('cartes').find({ _id: d.carteId }).toArray())[0];
            const e = ecartsApres(d, l, c, avant.get(d.idProduct));
            log(`   RELECTURE ${d.nomEn} : ${e.length ? '🔴 ' + e.join(' ; ') : `✅ voie ${d.voie}, comme attendu`}`);
            faux += e.length;
        }
        if (faux) { err('❌ la relecture ne retrouve pas l\'état attendu'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { executer, decider, operations, ecartsApres, LISTE, RESTANTES, IMP };

if (require.main === module) {
    (async () => {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        const code = await executer({ argv: process.argv.slice(2), ouvrir: async () => ({ db: cx.db, fermer: async () => { } }) });
        await fermer();
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}

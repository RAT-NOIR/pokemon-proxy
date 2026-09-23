// ============================================================
// L'ILLUSTRATEUR PAR IMPRESSION, CONSTRUIT ICI — TCGdex pour l'international, artofpkm pour le japonais (2026-09-23)
// ============================================================
//   node construire-illustrateurs.js                  (mesure sur le cache, ZÉRO requête)
//   node construire-illustrateurs.js --lire-tcgdex    (complète le cache `tcgdex_sets` : verrou global TCGdex, 2 s, budget imprimé)
//   node construire-illustrateurs.js --ecrire         (écrit `impressions[].illustrateur` + `illustrateurPreuve`, SAUVEGARDE AVANT)
//
// 🔴 POURQUOI : une page Bulbapedia est UN texte avec TOUS ses tirages, réillustrés compris ; `cartes.illustrateur` est
// celui du premier, et 81 % des fiches affichaient un faux (mesure du site). Le premier fichier du site venait du
// wikitext de Bulbapedia et son témoin l'a refusé (20 désaccords sur 1 925, §54). LA FUSION, PAR TIRAGE :
//   · intl : le fichier du site VERSION TCGdex (preuve = identifiant TCGdex), SES SEULES VALEURS PROUVÉES PAR TCGdex —
//     ses compléments « wikitext » sont écartés. TÉMOIN : mon propre appariement TCGdex (numéro, nom en témoin —
//     collecte-cartes/tcgdex-appariement.js, celui du collecteur de scans) ; deux cartes TCGdex différentes → null ;
//   · jp   : artofpkm, qui porte l'illustrateur sur la page de CHAQUE carte de chaque set (le document `images`, joint à
//     sa carte, rapporté à l'impression par la ligne de table de son set), ET le TCGdex japonais du fichier — deux
//     sources : accord, la valeur ; désaccord, null ; une seule, elle.
// `null` là où les sources se TAISENT ou se CONTREDISENT, avec la raison dans `illustrateurPreuve` — le champ absent
// voudrait dire « jamais évalué », et on ne confond pas les deux.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { modeles } = require('./collecte-cartes/schemas');
const { cleNumero } = require('./collecte-cartes/jointure');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS, CADENCE_GRAPHQL_MS } = require('./collecte-cartes/tcgdex');
const { listeEn, cartesEn, fabriquerAppariement } = require('./collecte-cartes/tcgdex-cache');
const { apparierExpansion } = require('./collecte-cartes/tcgdex-appariement');

const cleIll = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s.·・]+/g, '');
const FICHIER_SITE = 'C:/Users/Yung/Desktop/rat-market-site/CORRECTION-ILLUSTRATEURS.json';
const DATE = new Date().toISOString().slice(0, 10);

(async () => {
    const ecrire = process.argv.includes('--ecrire'), lire = process.argv.includes('--lire-tcgdex');
    if (ecrire && lire) throw new Error('--lire-tcgdex et --ecrire se lancent séparément : on mesure ce qu\'on a lu avant de l\'écrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, attaques: 1, impressions: 1 } });
    champSur(cartes, 'impressions', { collection: 'cartes' });
    const parId = new Map(cartes.map(c => [c._id, c]));
    const verdict = new Map();       // `${carteId}|${index}` -> { valeurs: Map(cle -> affichée), preuves: [], silence }
    const noter = (carteId, index, valeur, preuve) => {
        const k = `${carteId}|${index}`; const v = verdict.get(k) || verdict.set(k, { valeurs: new Map(), preuves: [], silences: [] }).get(k);
        if (valeur) { if (!v.valeurs.has(cleIll(valeur))) v.valeurs.set(cleIll(valeur), valeur); v.preuves.push(preuve); } else v.silences.push(preuve);
    };

    // ════ INTERNATIONAL : TCGdex ════
    let client = null, verrou = null;
    if (lire) {
        verrou = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, nom: `verrou global tcgdex` });
        const tenu = await verrou.prendre();
        if (tenu) throw new Error(`verrou global tcgdex tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s) — pas de requête à côté`);
        client = fabriquerClient({ verrou });
    }
    const cacheListe = await cx.db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' });
    const sets = lire ? await listeEn(cx.db, client) : (cacheListe?.sets || []);
    if (!sets.length) console.log('   🔴 liste des sets TCGdex absente du cache : lancer --lire-tcgdex');
    const apparier = fabriquerAppariement(sets);
    const intlParExpansion = new Map();
    for (const c of cartes) for (const i of c.impressions || []) if (i.tirage === 'intl' && i.expansion) intlParExpansion.set(i.expansion, (intlParExpansion.get(i.expansion) || 0) + 1);
    const E = { apparies: [], ambigus: [], sansSet: [] };
    for (const [nom, n] of intlParExpansion) { const a = apparier(nom); if (a?.set) E.apparies.push({ nom, n, set: a.set }); else if (a?.ambigu) E.ambigus.push({ nom, n, ids: a.ambigu }); else E.sansSet.push({ nom, n }); }
    const nImp = l => l.reduce((s, x) => s + x.n, 0);
    console.log(`\n════ INTERNATIONAL : ${intlParExpansion.size} expansions, ${nImp([...intlParExpansion].map(([, n]) => ({ n })))} impressions intl · ${sets.length} sets TCGdex en cache ════`);
    console.log(`   appariées à un set TCGdex : ${E.apparies.length} (${nImp(E.apparies)} impressions) · nom ambigu : ${E.ambigus.length} (${nImp(E.ambigus)}) · aucun set de ce nom : ${E.sansSet.length} (${nImp(E.sansSet)})`);
    console.log(`   sans set, les plus grosses : ${E.sansSet.sort((a, b) => b.n - a.n).slice(0, 12).map(x => `${x.nom} (${x.n})`).join(' · ')}`);
    const variantes = E.apparies.filter(x => apparier(x.nom)?.variante);
    if (variantes.length) console.log(`   appariées par la variante « sans EX » (à LIRE, §31) : ${variantes.map(x => `${x.nom} → ${x.set.id} « ${x.set.name} »`).join(' · ')}`);
    const idsVoulus = [...new Set(E.apparies.map(x => x.set.id))];
    const enCache = new Set((await cx.db.collection('tcgdex_sets').find({ _id: { $in: idsVoulus.map(id => `en/${id}`) } }, { projection: { _id: 1 } }).toArray()).map(d => d._id.slice(3)));
    const aLire = idsVoulus.filter(id => !enCache.has(id));
    const pages = aLire.reduce((s, id) => s + Math.max(1, Math.ceil((sets.find(x => x.id === id)?.cardCount?.total ?? 100) / 100)), 0);
    console.log(`   sets TCGdex voulus : ${idsVoulus.length} · en cache : ${enCache.size} · à lire : ${aLire.length} ≈ ${pages} requêtes GraphQL à ${CADENCE_GRAPHQL_MS / 1000} s ≈ ${Math.round(pages * CADENCE_GRAPHQL_MS / 60000)} min${lire ? '' : ' (--lire-tcgdex)'}`);
    if (lire) {
        // Le verrou se rend TOUJOURS, panne comprise : le 503 du 2026-09-23 l'avait laissé tenu par un mort pendant 3 min.
        try {
            for (const [n, id] of aLire.entries()) {
                if (!await verrou.tient()) throw new Error('verrou global tcgdex perdu : arrêt');
                const { cartes: lus } = await cartesEn(cx.db, client, id);
                if (n % 20 === 0 || n === aLire.length - 1) console.log(`      ${n + 1}/${aLire.length} ${id} : ${lus.length} cartes · requêtes ${client.compteRequetes()}`);
            }
            console.log(`   ✅ lu : ${aLire.length} sets, ${client.compteRequetes()} requêtes`);
        } finally { await verrou.rendre(); }
    }
    const tcgDe = new Map((await cx.db.collection('tcgdex_sets').find({ _id: { $in: idsVoulus.map(id => `en/${id}`) } }).toArray()).map(d => [d._id.slice(3), d.cartes]));
    // 🔑 DEPUIS LA VERSION TCGdex DU FICHIER DU SITE (2026-09-23), CE QUI SUIT EST UN TÉMOIN, PLUS UNE SOURCE : le site a
    // apparié par l'IDENTIFIANT TCGdex, moi par le NUMÉRO avec le nom en témoin. Même source, deux appariements
    // indépendants : s'ils rendent deux illustrateurs pour une impression, l'un des deux a pris la mauvaise carte.
    const temoinIntl = new Map();   // `${carteId}|${index}` -> { valeur, id }
    const I = { reponses: 0, sansIllustrateur: 0, motifs: {} };
    for (const { nom, set } of E.apparies) {
        const tcg = tcgDe.get(set.id);
        if (!tcg) continue;
        const concernees = cartes.filter(c => (c.impressions || []).some(i => i.tirage === 'intl' && i.expansion === nom));
        for (const r of apparierExpansion(nom, concernees, tcg)) {
            if (!r.tcg) { I.motifs[r.motif] = (I.motifs[r.motif] || 0) + 1; continue; }
            if (!r.tcg.illustrator) { I.sansIllustrateur++; continue; }
            I.reponses++; temoinIntl.set(`${r.carte._id}|${r.index}`, { valeur: r.tcg.illustrator, id: r.tcg.id });
        }
    }
    console.log(`   TÉMOIN (mon appariement TCGdex) : ${I.reponses} réponses · carte trouvée sans illustrateur : ${I.sansIllustrateur} · refus : ${JSON.stringify(I.motifs)}`);

    // ════ LE FICHIER DU SITE, VERSION TCGdex : la source pour l'international, un second témoin pour le japonais ════
    // On n'en garde QUE les valeurs prouvées par un identifiant TCGdex. Ses compléments « wikitext Bulbapedia » sont la
    // source que son propre témoin a refusée (20 désaccords sur 1 925, §54) : ils restent `null`.
    const F = JSON.parse(require('fs').readFileSync(FICHIER_SITE, 'utf8'));
    const S = { lues: F.corrections.length, tcgdex: 0, wikitext: 0, nul: 0, sansImpression: 0 };
    const siteJa = new Map();    // témoin japonais : `${carteId}|${index}` -> valeur TCGdex ja
    for (const f of F.corrections) {
        const c = parId.get(f.carte);
        const idx = (c?.impressions || []).map((i, n) => [i, n]).filter(([i]) => i.tirage === f.tirage && i.expansion === f.expansion && (i.numero ?? null) === (f.numero ?? null)).map(([, n]) => n);
        if (!idx.length) { S.sansImpression++; continue; }
        if (f.illustrateur == null) { S.nul++; if (f.tirage === 'intl') for (const n of idx) noter(f.carte, n, null, `fichier TCGdex du site : ${f.preuve}`); continue; }
        if (/wikitext/i.test(f.preuve) || !/^TCGdex [\w.+-]+-\S+$/.test(f.preuve)) { S.wikitext++; for (const n of idx) noter(f.carte, n, null, `valeur du site écartée (preuve non TCGdex : ${f.preuve.slice(0, 80)})`); continue; }
        S.tcgdex++;
        for (const n of idx) {
            if (f.tirage === 'intl') noter(f.carte, n, f.illustrateur, `${f.preuve} (fichier du site du ${F.genereLe.slice(0, 10)})`);
            else siteJa.set(`${f.carte}|${n}`, { valeur: f.illustrateur, preuve: f.preuve });
        }
    }
    console.log(`\n════ FICHIER DU SITE : ${S.lues} lignes (${F.source.slice(0, 60)}…) ════`);
    console.log(`   prouvées par un identifiant TCGdex : ${S.tcgdex} · compléments wikitext écartés : ${S.wikitext} · null : ${S.nul} · impression introuvable : ${S.sansImpression}`);

    // ════ JAPONAIS : artofpkm ════
    const parSlug = new Map();
    for (const L of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (L.slugSet && L.bulba?.expansion && !parSlug.has(L.slugSet)) parSlug.set(L.slugSet, L);
    const ims = await lireMongo(cx.db.collection('images'), { source: 'artofpkm', etat: 'ok', carteId: { $ne: null } }, { nom: 'images artofpkm jointes', projection: { carteId: 1, set: 1, numero: 1, illustrateur: 1 } });
    const J = { images: ims.length, sansNom: 0, sansLigne: 0, pasJp: 0, introuvable: 0, ambigue: 0, notees: 0 };
    for (const im of ims) {
        const L = parSlug.get(im.set); const c = parId.get(im.carteId);
        if (!L || !c) { J.sansLigne++; continue; }
        if ((L.bulba.tirage || 'jp') !== 'jp') { J.pasJp++; continue; }
        const noms = [].concat(L.bulba.expansion);
        const cands = (c.impressions || []).map((i, index) => ({ i, index })).filter(({ i }) => i.tirage === 'jp' && noms.includes(i.expansion) && (!L.bulba.deck || i.deck === L.bulba.deck) && (im.numero ? cleNumero(i.numero) === cleNumero(im.numero) : true));
        if (!cands.length) { J.introuvable++; continue; }
        const signatures = new Set(cands.map(({ i }) => `${i.expansion}|${i.deck || ''}|${cleNumero(i.numero)}`));
        if (signatures.size > 1) { J.ambigue++; continue; }            // deux tirages distincts : l'image ne dit pas lequel
        if (!im.illustrateur) { J.sansNom++; for (const { index } of cands) noter(c._id, index, null, `artofpkm ${im.set} n°${im.numero ?? '—'} ne porte pas d'illustrateur`); continue; }
        J.notees++;
        for (const { index } of cands) noter(c._id, index, im.illustrateur, `artofpkm ${im.set} n°${im.numero ?? '—'}`);
    }
    console.log(`\n════ JAPONAIS : ${J.images} images artofpkm jointes ════`);
    console.log(`   rapportées à une impression : ${J.notees} · sans illustrateur : ${J.sansNom} · set sans ligne/carte : ${J.sansLigne} · ligne non jp : ${J.pasJp} · impression introuvable : ${J.introuvable} · plusieurs tirages possibles : ${J.ambigue}`);

    // ════ LE VERDICT, IMPRESSION PAR IMPRESSION ════
    const T = { impressions: 0, nom: 0, contradiction: 0, silence: 0, parTirage: {}, jaAccord: 0, jaDesaccord: 0, intlAccord: 0, intlDesaccord: 0 };
    const aEcrire = new Map();   // carteId -> { `impressions.N.illustrateur`: v, ... }
    const contradictions = [];
    for (const c of cartes) (c.impressions || []).forEach((i, index) => {
        T.impressions++;
        const t = T.parTirage[i.tirage || '?'] || (T.parTirage[i.tirage || '?'] = { total: 0, nom: 0 });
        t.total++;
        const k = `${c._id}|${index}`;
        const v = verdict.get(k) || { valeurs: new Map(), preuves: [], silences: [] };
        // jp : le TCGdex japonais du site est une SECONDE source — accord, il confirme ; désaccord, rien ne tranche.
        const ja = siteJa.get(k);
        if (ja) {
            if (v.valeurs.size) (v.valeurs.has(cleIll(ja.valeur)) ? T.jaAccord++ : T.jaDesaccord++);
            if (!v.valeurs.has(cleIll(ja.valeur))) v.valeurs.set(cleIll(ja.valeur), ja.valeur);
            v.preuves.push(`${ja.preuve} (fichier du site)`);
        }
        // intl : mon appariement TCGdex est le TÉMOIN du fichier — une autre carte TCGdex, un autre illustrateur : null.
        const tem = temoinIntl.get(k);
        const contre = tem && v.valeurs.size === 1 && !v.valeurs.has(cleIll(tem.valeur));
        if (tem && v.valeurs.size === 1) (contre ? T.intlDesaccord++ : T.intlAccord++);
        let valeur = null, preuve;
        if (v.valeurs.size === 1 && !contre) { valeur = [...v.valeurs.values()][0]; preuve = [...new Set(v.preuves)].join(' ; '); T.nom++; t.nom++; }
        else if (v.valeurs.size > 1 || contre) {
            const vals = contre ? [`${[...v.valeurs.values()][0]} (${v.preuves[0]})`, `${tem.valeur} (TCGdex ${tem.id}, appariement par le numéro)`] : [...v.valeurs.values()];
            preuve = `les sources se contredisent : ${vals.join(' / ')}`; T.contradiction++; contradictions.push(`${c._id} « ${c.nomEn} » ${i.tirage} ${i.expansion} ${i.numero} : ${preuve}`);
        }
        else { preuve = v.silences[0] || `aucune source interrogée ne porte ce tirage (${i.tirage} ${i.expansion})`; T.silence++; }
        if (i.illustrateur === valeur && i.illustrateurPreuve === preuve) return;
        const s = aEcrire.get(c._id) || aEcrire.set(c._id, {}).get(c._id);
        s[`impressions.${index}.illustrateur`] = valeur; s[`impressions.${index}.illustrateurPreuve`] = preuve;
    });
    const pc = (n, d) => `${n} / ${d} = ${(100 * n / (d || 1)).toFixed(1)} %`;
    console.log(`\n════ COUVERTURE : ${T.impressions} impressions ════`);
    console.log(`   illustrateur établi : ${pc(T.nom, T.impressions)} · contradictions : ${T.contradiction} · silence : ${T.silence}`);
    for (const [tir, x] of Object.entries(T.parTirage).sort((a, b) => b[1].total - a[1].total)) console.log(`      ${tir.padEnd(8)} ${pc(x.nom, x.total)}`);
    console.log(`   ⚖️ jp, artofpkm contre TCGdex ja du site : ${T.jaAccord} accords · ${T.jaDesaccord} désaccords (→ null)`);
    console.log(`   ⚖️ intl, fichier du site contre mon appariement TCGdex : ${T.intlAccord} accords · ${T.intlDesaccord} désaccords (→ null)`);
    for (const x of contradictions.slice(0, 12)) console.log(`   ⚠️ ${x}`);
    const dossier = require('path').join(__dirname, 'collecte-cartes', 'rapports');   // rapports : jamais versionnés
    require('fs').mkdirSync(dossier, { recursive: true });
    require('fs').writeFileSync(require('path').join(dossier, 'illustrateurs-contradictions.json'), JSON.stringify(contradictions, null, 1));

    console.log(`\n   à écrire : ${aEcrire.size} cartes`);
    if (!ecrire) { console.log('   (mesure seule — --ecrire après la sauvegarde réelle de `cartes`)'); await fermer(); return; }
    const r = await cx.db.collection('cartes').bulkWrite([...aEcrire].map(([id, s]) => ({ updateOne: { filter: { _id: id }, update: { $set: s } } })), { ordered: false });
    const relu = await cx.db.collection('cartes').aggregate([{ $unwind: '$impressions' }, { $group: { _id: { $cond: [{ $eq: [{ $type: '$impressions.illustrateur' }, 'missing'] }, 'absent', { $cond: [{ $eq: ['$impressions.illustrateur', null] }, 'null', 'nom'] }] }, n: { $sum: 1 } } }]).toArray();
    console.log(`   ✅ ${r.modifiedCount} cartes modifiées · RELU : ${relu.map(x => `${x._id} ${x.n}`).join(' · ')} (${DATE})`);
    await fermer();
})().catch(e => { console.error(e.message); process.exit(1); });

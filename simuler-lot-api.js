// ============================================================
// PHASE 3a — SIMULATION D'UN LOT PAR LA VRAIE `decider` DE L'API, LE TÉMOIN DU NOM, ET LA PLANCHE (lecture seule)
// ============================================================
//   node lancer-a-blanc.js simuler-lot-api.js --nom=lot2 --plans=<a>.json,<b>.json --sortie=<dossier> [--api=<dossier de l'API>]
//
// Un « plan » est le fichier que les outils d'écriture produisent avec `--plan=` (poser-wcd, poser-reimpressions, poser-fiches-par-freres,
// poser-fiches-par-setlist, poser-par-metacarte) : { lignes: [{_id, carteId, idProduct, idExpansion, numeroFiche, slug, slugSet, …}], cartesSets: [{carteId, set}], impressions: [{carteId, imp}] }.
// Rien n'est écrit en base : l'état « avant » est lu par les utilisateurs de LECTURE SEULE (garde.js remplacée par a-blanc-precharge.js), l'état « après » est fabriqué EN MÉMOIRE
// (lignes ajoutées si leur _id n'existe pas — `$setOnInsert`/upsert —, set ajouté à `cartes.sets`, impression ajoutée si absente), puis la chaîne de l'API est REJOUÉE :
//   · `garde-contrat-api.js::verifierContrat` (la même fonction que lot-additif.js) : refus nouveaux, persistants, résolus, produits sans entrée après ;
//   · `contratDesSets` sur les mêmes sets touchés, avant et après : les produits qui GAGNENT une entrée (donc une ligne ET un visuel) et ceux qui en PERDENT une.
// 🔑 La `decider` n'est jamais recopiée : `chargerApi` l'importe du dossier de l'API (comme la garde de lot).
// Le TÉMOIN DU NOM est celui de la production (`jointure.js::temoinDuNom`), rejoué sur chaque ligne du plan ; la PLANCHE met face à face le nom Cardmarket et la fiche posée.
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const GC = require('./collecte-cartes/garde-contrat-api');
const J = require('./collecte-cartes/jointure');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { appliquerPlans } = require('./collecte-cartes/appliquer-plan');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const AUTORISES = [/^--nom=[\w-]+$/, /^--plans=.+\.json(,.+\.json)*$/, /^--sortie=.+$/, /^--api=.+$/, /^--confirmation=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }

const cellule = s => String(s ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

(async () => {
    const NOM = arg('nom'), PLANS = arg('plans').split(','), SORTIE = arg('sortie');
    if (!NOM || !PLANS[0] || !SORTIE) { console.error('❌ --nom, --plans et --sortie obligatoires'); process.exit(2); }
    const plans = PLANS.map(f => ({ f, ...JSON.parse(fs.readFileSync(f, 'utf8')) }));
    // `--confirmation=` : la sortie de `scanner-deux-sources.js --plans=` (par plan, par produit : les sources qui concordent) — une colonne de la planche, jamais un filtre
    const CONF = arg('confirmation') ? JSON.parse(fs.readFileSync(arg('confirmation'), 'utf8')) : null;
    const confDe = (f, idProduct) => CONF?.[path.basename(f).replace(/\.json$/, '')]?.detail?.find(d => d.idProduct === idProduct) ?? null;
    for (const p of plans) if (!Array.isArray(p.lignes) || !p.lignes.length) { console.error(`❌ plan vide ou illisible : ${p.f} — une comparaison sur du vide ne mesure rien`); process.exit(1); }
    const api = await GC.chargerApi({ dossier: arg('api') || undefined });
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true });
    try {
        // ── l'état « avant » : lu UNE fois, avec les projections réunies du site et de l'API (comme lot-additif.js::etatDeLaBase)
        const [cartes, cartesProduits, sets] = await Promise.all([
            cx.db.collection('cartes').find({}).project({ ...api.projectionsEtat.cartes }).toArray(),
            cx.db.collection('cartes_produits').find({}).project({ ...api.projectionsEtat.cartesProduits }).toArray(),
            cx.db.collection('sets').find({}).toArray()]);
        for (const [n, l] of [['cartes', cartes], ['cartes_produits', cartesProduits], ['sets', sets]]) if (!l.length) throw new Error(`« ${n} » est VIDE : une simulation sur du vide ne mesure rien (§41)`);
        console.log(`   état avant : ${cartes.length} cartes · ${cartesProduits.length} lignes · ${sets.length} sets`);
        const avant = { cartes, cartesProduits, sets };

        // ── l'état « après », en mémoire
        // (PHASE 3a-SUITE) UNE définition de « l'état après » : collecte-cartes/appliquer-plan.js (banc test-appliquer-plan.js), aussi utilisée par simuler-abc.js
        const { cartes: cartesApres, cartesProduits: lignesApres, ajoutees, dejaLa, carteAbsente } = appliquerPlans({ cartes, cartesProduits }, plans);
        const apres = { cartes: cartesApres, cartesProduits: lignesApres, sets };
        console.log(`   plan : ${plans.map(p => `${path.basename(p.f)} ${p.lignes.length}`).join(' · ')} → ${ajoutees.length} lignes ajoutées, ${dejaLa.length} déjà présentes (non touchées), ${carteAbsente} carte(s) absente(s) de la base`);
        if (carteAbsente) throw new Error(`${carteAbsente} ligne(s) du plan visent une carte absente de la base : le plan ne correspond pas à l'état lu`);

        // ── le verdict de l'API (la même fonction que lot-additif.js), puis le détail par produit
        const v = await GC.verifierContrat({ api, avant, apres });
        const A = GC.projeterEtat(api, avant), B = GC.projeterEtat(api, apres);
        const slugs = GC.setsTouchesContrat({ avant: A, apres: B });
        // la `decider` est enveloppée SANS être modifiée : on garde ses entrées (la NATURE du visuel — du-set, substitut, autre-tirage — est dans l'entrée, pas dans le jugement de lireEntree)
        let dernieres = null;
        const apiCapture = { ...api, decider: async (a) => { const r = await api.decider(a); dernieres = new Map(r.entrees.map(e => [e.idProduct, e])); return r; } };
        const mA = await GC.contratDesSets({ api: apiCapture, sets: A.sets, docs: A.cartes, lignes: A.cartesProduits, slugs }); const eA = dernieres || new Map();
        const mB = await GC.contratDesSets({ api: apiCapture, sets: B.sets, docs: B.cartes, lignes: B.cartesProduits, slugs }); const eB = dernieres || new Map();
        const avecEntree = (m, id) => { const j = m.get(id); return Boolean(j) && !j.sansEntree; };
        // seules les lignes NOUVELLES comptent (une ligne déjà en base est une reprise idempotente : l'outil la rend, l'écriture ne la change pas)
        const idsAjoutees = new Set(ajoutees.map(a => String(a._id)));
        const nouvelles = p => p.lignes.filter(l => idsAjoutees.has(String(l._id)));
        const produitsPlan = [...new Set(plans.flatMap(p => nouvelles(p).map(l => l.idProduct)))];
        const ligneAvant = new Set(cartesProduits.map(l => l.idProduct));
        const sansLigneAvant = produitsPlan.filter(id => !ligneAvant.has(id));
        const gagnentLigne = sansLigneAvant.length;
        const gagnentEntree = produitsPlan.filter(id => avecEntree(mB, id) && !avecEntree(mA, id));
        const entreesGagneesHorsPlan = [...mB.keys()].filter(id => avecEntree(mB, id) && !avecEntree(mA, id) && !produitsPlan.includes(id));
        const refusPlan = produitsPlan.filter(id => mB.get(id) && !mB.get(id).ok).map(id => ({ idProduct: id, motif: mB.get(id).motif }));
        console.log(`   ${GC.ligneContrat(v)}`);
        console.log(`   produits du plan ${produitsPlan.length} (sans ligne avant : ${gagnentLigne}) · GAGNENT une entrée de l'API (ligne ET visuel) : ${gagnentEntree.length} · entrées gagnées hors plan : ${entreesGagneesHorsPlan.length} · refusés par lireEntree dans le plan : ${refusPlan.length}`);
        console.log(`   entrées avant ${v.entreesAvant} → après ${v.entreesApres} · refus NOUVEAUX ${v.nouveaux.length} · persistants ${v.persistants.length} · sans entrée après ${v.disparus.length}`);

        // ── le témoin du nom (celui de la production) + la planche
        const ids = produitsPlan;
        const cat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), { idProduct: { $in: ids } }, { nom: 'catalogue_produits (plan)', projection: { idProduct: 1, name: 1, idExpansion: 1 } })).map(p => [p.idProduct, p]));
        const nc = new Map((await lireMongo(prod.db.collection('numeros_cartes'), { idProduct: { $in: ids } }, { nom: 'numeros_cartes (plan)', projection: { idProduct: 1, numero: 1, slugSet: 1 } })).map(p => [p.idProduct, p]));
        const idsCartes = [...new Set(plans.flatMap(p => p.lignes.map(l => l.carteId)))];
        const cartesPlan = new Map((await cx.db.collection('cartes').find({ _id: { $in: idsCartes } }).project({ nomEn: 1, niveau: 1, attaques: 1, sets: 1, impressions: 1, images: 1 }).toArray()).map(c => [c._id, c]));
        for (const p of plans) for (const c of p.cartes || []) if (!cartesPlan.has(c._id)) cartesPlan.set(c._id, c);       // les fiches simples du plan : leur nom est celui du produit (le témoin du nom est alors une tautologie — la vraie garde est l'absence d'une carte de ce nom dans le set, dans l'outil)
        const setsParExp = new Map(); for (const s of sets) for (const x of [].concat(s.idExpansion ?? [])) (setsParExp.get(x) || setsParExp.set(x, []).get(x)).push(s);
        const setsDeLigne = l => { const u = new Map(); for (const s of setsParExp.get(l.idExpansion) || []) u.set(s._id, s); if (l.slugSet && !u.has(l.slugSet)) { const s = sets.find(z => z._id === l.slugSet); if (s) u.set(s._id, s); } return [...u.values()]; };
        const lesSlugs = [...new Set(plans.flatMap(p => p.lignes.flatMap(l => setsDeLigne(l).map(s => s._id))))];
        const cartesDesSets = await cx.db.collection('cartes').find({ sets: { $in: lesSlugs } }).project({ nomEn: 1, niveau: 1, attaques: 1, sets: 1 }).toArray();
        const parSet = new Map(); for (const c of cartesDesSets) for (const s of c.sets || []) (parSet.get(s) || parSet.set(s, []).get(s)).push(c);
        const temoins = new Map();
        const temoinDe = (slug, exp) => { const k = `${slug}|${exp}`; if (!temoins.has(k)) temoins.set(k, J.temoinDuNom(parSet.get(slug) || [], exp)); return temoins.get(k); };

        const sortie = { nom: NOM, le: new Date().toISOString().slice(0, 10), plans: plans.map(p => ({ fichier: path.basename(p.f), outil: p.outil, lignes: p.lignes.length, nouvelles: p.lignes.filter(l => idsAjoutees.has(String(l._id))).length, dejaPresentes: p.lignes.filter(l => !idsAjoutees.has(String(l._id))).length })), lignesAjoutees: ajoutees.length, lignesDejaPresentes: dejaLa.length, produitsDuPlan: produitsPlan.length, produitsSansLigneAvant: gagnentLigne,
            produitsQuiGagnentUneEntree: gagnentEntree.length, entreesGagneesHorsPlan: entreesGagneesHorsPlan.length, refusDansLePlan: refusPlan, refusNouveaux: v.nouveaux, refusPersistants: v.persistants.length, refusResolus: v.resolus.length, sansEntreeApres: v.disparus, entreesAvant: v.entreesAvant, entreesApres: v.entreesApres, setsRejoues: v.slugs.length };
        const rangs = []; const temoin = { concorde: 0, formeSilencieux: 0, contredit: 0, carteSansNom: 0 }; const contredits = [], formes = [];
        for (const p of plans) for (const l of nouvelles(p)) {
            const c = cartesPlan.get(l.carteId), prodNom = cat.get(l.idProduct)?.name ?? l.nomProduit ?? null, d = J.decomposerNomCardmarket(prodNom || '');
            const setsL = setsDeLigne(l); const slug = l.slugSet || setsL[0]?._id || null;
            let etat;
            if (!c || !c.nomEn) { etat = 'carte sans nom'; temoin.carteSansNom++; }
            else {
                const kp = J.clesNom(d.nom), kc = J.clesNom(J.nomJointDe(c));
                if (kp.some(k => kc.includes(k))) { etat = 'concorde'; temoin.concorde++; }
                else {
                    const autres = setsL.map(s => temoinDe(s._id, l.idExpansion)(c, { nom: d.nom, attaques: d.attaques })).find(x => x) || null;
                    if (autres) { etat = `CONTREDIT (désigne aussi ${autres.slice(0, 2).map(x => `${x._id} « ${x.nomEn} »`).join(', ')})`; temoin.contredit++; contredits.push({ idProduct: l.idProduct, carteId: l.carteId, nomProduit: prodNom, nomCarte: c.nomEn }); }
                    else { etat = 'forme (témoin muet)'; temoin.formeSilencieux++; formes.push({ idProduct: l.idProduct, carteId: l.carteId, nomProduit: prodNom, nomCarte: c.nomEn }); }
                }
            }
            // numéro de la fiche : celui de la ligne, sinon l'impression de la carte dans le tirage du set
            let numFiche = l.numeroFiche ?? null;
            if (numFiche == null && c) { const noms = setsL.flatMap(s => [].concat(s.bulba?.expansion ?? [])); const imp = (c.impressions || []).find(i => noms.includes(i.expansion) && (!setsL[0]?.tirage || i.tirage === setsL[0].tirage)) || (c.impressions || []).find(i => noms.includes(i.expansion)); numFiche = imp?.numero ?? null; }
            const img = (c?.images || []).find(m => setsL.some(s => s._id === m.set) && (!numFiche || m.numero == null || J.cleNumero(m.numero) === J.cleNumero(numFiche)));
            const ent = mB.get(l.idProduct);
            const nat = eB.get(l.idProduct)?.visuel ?? null;           // du-set | substitut | autre-tirage (choisirVisuel, la fonction partagée avec le site)
            const visuel = nat ? `${nat}${img ? ` (${img.set}, ${img.source ?? '?'}, ${img.w}×${img.h})` : ` — la carte n'a pas d'image à ce set (images : ${[...new Set((c?.images || []).map(m => m.set))].slice(0, 3).join(', ') || 'aucune'})`}` : (img ? `image au set mais pas d'entrée (${img.set})` : '—');
            const cf = confDe(p.f, l.idProduct);
            rangs.push({ deuxSources: cf ? (cf.ok ? `${cf.sources.join(' + ')} (${cf.concordantes.join(' ; ') || 'n° Cardmarket'})` : 'NON CONFIRMÉE') : null, nouvelle: idsAjoutees.has(String(l._id)), idProduct: l.idProduct, nomProduit: prodNom, numCm: nc.get(l.idProduct)?.numero ?? null, carteId: l.carteId, nomCarte: c?.nomEn ?? null, numFiche, set: slug, code: l.code ?? p.outil, preuve: l.preuve, temoin: etat, visuel, entreeApi: Boolean(ent && !ent.sansEntree && ent.ok) });
        }
        sortie.temoinDuNom = { ...temoin, total: rangs.length, contredits, formes };
        const natures = {}; for (const r of rangs) { const k = r.visuel.split(' ')[0]; natures[k] = (natures[k] || 0) + 1; }
        sortie.naturesDuVisuel = natures;
        sortie.parCode = {};
        for (const r of rangs) { const k = (sortie.parCode[r.code] ||= { lignes: 0, entreeApi: 0, 'du-set': 0, substitut: 0, 'autre-tirage': 0 }); k.lignes++; const nat = eB.get(r.idProduct)?.visuel; if (r.entreeApi && nat) { k.entreeApi++; k[nat] = (k[nat] || 0) + 1; } }
        sortie.lignes = rangs;
        sortie.entreesGagneesParNature = gagnentEntree.reduce((a, id) => { const k = eB.get(id)?.visuel ?? '?'; a[k] = (a[k] || 0) + 1; return a; }, {});
        console.log(`   nature du visuel des entrées gagnées : ${JSON.stringify(sortie.entreesGagneesParNature)}`);
        console.log(`   par code : ${JSON.stringify(sortie.parCode)}`);
        fs.mkdirSync(SORTIE, { recursive: true });
        fs.writeFileSync(path.join(SORTIE, `simulation-${NOM}.json`), JSON.stringify(sortie, null, 1));
        const md = [];
        md.push(`# Planche — ${NOM} (${rangs.length} lignes, ${produitsPlan.length} produits)`, '', `Plans : ${sortie.plans.map(p => `\`${p.fichier}\` (${p.outil} : ${p.lignes} lignes au plan, ${p.nouvelles} nouvelles, ${p.dejaPresentes} déjà en base)`).join(' · ')}. Rien n'est écrit : état lu en lecture seule, lignes ajoutées EN MÉMOIRE, chaîne de l'API rejouée (\`garde-contrat-api.js\`, \`decider\` importée).`, '',
            `- **API** : ${GC.ligneContrat(v)}`, `- produits du plan **${produitsPlan.length}**, dont sans ligne avant **${gagnentLigne}** ; produits qui **gagnent une entrée de l'API (ligne ET visuel) : ${gagnentEntree.length}** ; entrées gagnées hors plan ${entreesGagneesHorsPlan.length} ; entrées ${v.entreesAvant} → ${v.entreesApres}`,
            `- nature du visuel des entrées gagnées (\`decider\`) : ${Object.entries(sortie.entreesGagneesParNature).map(([k, n]) => `${k} ${n}`).join(' · ') || 'aucune'}`,
            `- refus **nouveaux ${v.nouveaux.length}** · produits perdus (sans entrée après) **${v.disparus.length}** · refus de \`lireEntree\` dans le plan ${refusPlan.length}`,
            `- **témoin du nom** (\`temoinDuNom\` de la production) : concorde ${temoin.concorde} · forme, témoin muet ${temoin.formeSilencieux} · **CONTREDIT ${temoin.contredit}** · carte sans nom ${temoin.carteSansNom} (sur ${rangs.length})`, '',
            ...(CONF ? ['- **règle des deux sources** : colonne « deux sources » = les sources NON-Bulbapedia qui concordent sur (set, n° de la fiche, nom) ; Cardmarket n\'y compte que si son numéro est celui de la fiche.', ''] : []),
            `| idProduct | nom Cardmarket | n° CM | → carte | nom de la fiche | n° fiche | set | preuve | témoin | visuel |${CONF ? ' deux sources |' : ''}`, `|---|---|---|---|---|---|---|---|---|---|${CONF ? '---|' : ''}`);
        for (const r of rangs) md.push(`| ${r.idProduct} | ${cellule(r.nomProduit)} | ${cellule(r.numCm)} | ${r.carteId} | ${cellule(r.nomCarte)} | ${cellule(r.numFiche)} | ${cellule(r.set)} | ${cellule(r.preuve)} | ${cellule(r.temoin)} | ${cellule(r.visuel)} |${CONF ? ` ${cellule(r.deuxSources)} |` : ''}`);
        fs.writeFileSync(path.join(SORTIE, `planche-${NOM}.md`), md.join('\n') + '\n');
        console.log(`   témoin du nom : concorde ${temoin.concorde} · forme ${temoin.formeSilencieux} · CONTREDIT ${temoin.contredit} · sans nom ${temoin.carteSansNom} (sur ${rangs.length})`);
        console.log(`   écrits : simulation-${NOM}.json, planche-${NOM}.md dans ${SORTIE}`);
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });

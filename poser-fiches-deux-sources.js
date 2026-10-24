// ============================================================
// LES FICHES SIMPLES CONFIRMÉES PAR DEUX SOURCES (PHASE 3a, décision du testeur du 2026-10-24)
// ============================================================
//   node poser-fiches-deux-sources.js --liste=<deux-sources.json> --exp=6328,6230 [--plan=<fichier>.json]                                   (simulation : rien n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-fiches-deux-sources.js --liste=… --exp=… --attendu=<lignes> --ecrire
//
// « Une fiche simple (set, numéro, nom, langue), y compris dans un set qui a déjà une ligne de table, n'est permise que si AU MOINS DEUX sources concordent sur le set, le numéro et le nom.
//   Cardmarket compte pour UNE ; la seconde est indépendante ; aucune donnée Bulbapedia ne compte. Sinon : à instruire. » La liste est la sortie de `scanner-deux-sources.js` (collecte-cartes/
// deux-sources.js : jugement pur, liste fermée de sources admises) : chaque produit y porte `ok` ET les sources qui concordent, avec leur référence — elles sont ÉCRITES sur la fiche.
// Ce que l'outil refuse, avant toute écriture, et NOMME :
//   · un produit non confirmé (`ok` faux), ou hors des expansions demandées ; un produit en matière spéciale (table fermée) ; un produit qui a DÉJÀ une ligne ;
//   · un set absent de la base, ou qui ne porte pas l'expansion du produit, ou sans nom d'expansion (la fiche n'aurait pas d'impression lisible) ;
//   · 🔑 un produit dont le NOM est celui d'une VRAIE carte (une page) du même set : la fiche ferait doublon avec elle, c'est une jointure qui manque, pas une fiche à poser.
// Ce qui s'écrit (ADDITIF, idempotent, `$setOnInsert`) : la carte d'abord (identifiant NÉGATIF = −le plus petit idProduct du groupe, comme creer-sets-sans-page.js), puis la ligne
// (`preuve: 'fiche-simple'`, la marque de source du §73), avec `numeroFiche` = le numéro Cardmarket, confirmé par la seconde source. AUCUNE image, AUCUNE page inventée.
// `--attendu=<n>` = le nombre de lignes du plan ; `--plan=<f>.json` = les lignes et cartes que le lancement poserait (simulation de l'API, planche).
require('dotenv').config();
const fs = require('fs');
const { garderMatiereSpeciale, estMatiereSpeciale } = require('./collecte-cartes/matiere-speciale');
const { decomposerNomCardmarket, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
const { rejouer } = require('./collecte-cartes/deux-sources');

const AUTORISES = [/^--liste=.+\.json$/, /^--exp=\d+(,\d+)*$/, /^--neufs$/, /^--attendu=\d+$/, /^--plan=.+\.json$/, /^--ecrire$/];
const nuNom = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9δ]+/g, '');
const nuNum = n => { const s = String(n ?? '').trim(); return s ? s.replace(/^0+(?=\d)/, '').toUpperCase() : null; };

/**
 * @param {object} o
 * @param {string[]} o.argv
 * @param {()=>Promise<{db: object, fermer: ()=>Promise}>} o.ouvrir  ouvre la base `cartes`
 * @param {(ids:number[])=>Promise<Map<number,{name:string, idMetacard:number|null}>>} o.catalogue  le catalogue Cardmarket des produits demandés
 * @param {(f:string)=>object} [o.lireListe]
 * @returns {Promise<number>} le code de sortie
 */
async function executer({ argv, ouvrir, catalogue, lireListe = f => JSON.parse(fs.readFileSync(f, 'utf8')), log = console.log, err = console.error }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { err(`❌ argument inconnu : ${inconnus.join(' ')}`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire');
    const EXPS = (arg('exp') || '').split(',').filter(Boolean).map(Number);
    if (!arg('liste') || !EXPS.length) { err('❌ --liste=<deux-sources.json> et --exp=<idExpansion>[,…] obligatoires'); return 2; }
    if (EXPS.length !== new Set(EXPS).size) { err('❌ --exp en doublon — rien n\'est écrit'); return 2; }
    const ATTENDU = arg('attendu') == null ? null : Number(arg('attendu'));
    if (ecrire && ATTENDU == null) { err('❌ --ecrire exige --attendu=<lignes> — rien n\'est écrit'); return 2; }
    let liste; try { liste = lireListe(arg('liste')); } catch (e) { err(`❌ liste illisible (${e.message}) — rien n'est écrit`); return 2; }
    const entrees = Object.entries(liste).map(([id, d]) => ({ idProduct: Number(id), ...d }));
    if (!entrees.length || !entrees.every(e => Number.isInteger(e.idProduct) && typeof e.ok === 'boolean' && Array.isArray(e.sources))) { err('❌ la liste n\'a pas la forme de scanner-deux-sources.js (idProduct → { ok, sources, concordantes, set, numero, nom, exp }) — rien n\'est écrit'); return 2; }

    const { db, fermer } = await ouvrir();
    try {
        // `--neufs` : seulement les produits NEUFS de la liste (`neuf` : idProduct >= 917000, ajoutés après l'export du 24/09) — le lot 1, celui dont l'API a besoin
        const choisis = entrees.filter(e => EXPS.includes(e.exp) && (!argv.includes('--neufs') || e.neuf === true));
        log(`   DÉNOMINATEUR : ${entrees.length} produits dans la liste · ${choisis.length} dans les expansions ${EXPS.join(', ')} · confirmés par deux sources ${choisis.filter(e => e.ok).length}`);
        const refus = [];
        const nonConfirmes = choisis.filter(e => !e.ok); for (const e of nonConfirmes) refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `non confirmé par deux sources (${e.raison || 'raison non écrite'})` });
        let candidats = choisis.filter(e => e.ok);
        const speciaux = candidats.filter(e => estMatiereSpeciale(e.idProduct));
        try { garderMatiereSpeciale(candidats.map(e => e.idProduct), 'poser-fiches-deux-sources'); } catch (er) { err(er.message); return 1; }
        void speciaux;
        const lignes = await db.collection('cartes_produits').find({ idProduct: { $in: candidats.map(e => e.idProduct) } }).toArray();
        const dejaJoints = new Set(lignes.map(l => l.idProduct));
        for (const e of candidats.filter(e => dejaJoints.has(e.idProduct))) refus.push({ idProduct: e.idProduct, nom: e.nom, motif: 'a déjà une ligne (aucun produit qui a une ligne n\'est touché)' });
        candidats = candidats.filter(e => !dejaJoints.has(e.idProduct));
        const cat = await catalogue(candidats.map(e => e.idProduct));
        const sets = new Map((await db.collection('sets').find({ _id: { $in: [...new Set(candidats.map(e => e.set))] } }).toArray()).map(s => [s._id, s]));
        const cartesDuSet = new Map();
        for (const slug of sets.keys()) cartesDuSet.set(slug, await db.collection('cartes').find({ sets: slug }).toArray());
        const groupes = new Map();
        for (const e of candidats) {
            const s = sets.get(e.set);
            if (!s) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `le set « ${e.set} » n'existe pas dans la base` }); continue; }
            if (!([].concat(s.idExpansion ?? [])).includes(e.exp)) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `le set ${s._id} ne porte pas l'expansion ${e.exp}` }); continue; }
            const nomExp = [].concat(s.bulba?.expansion ?? [])[0] ?? null;
            if (!nomExp) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `le set ${s._id} n'a pas de bulba.expansion : la fiche n'aurait pas d'impression lisible` }); continue; }
            const c = cat.get(e.idProduct);
            if (!c) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: 'produit absent du catalogue' }); continue; }
            if (e.numero == null || String(e.numero).trim() === '') { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: 'sans numéro Cardmarket : une fiche simple sans numéro ne se confirme pas' }); continue; }
            // (D3, 2026-10-24) L'OUTIL REJOUE LA CONFIRMATION, il ne se fie pas au `ok` du fichier : le nom de la liste est celui du catalogue, et les concordantes écrites sont relues
            // (au moins une ; chaque source admise et non exclue — Bulbapedia comprise ; set et numéro du produit ; nom du produit). Une garde s'écrit par ce qu'elle AUTORISE.
            const nomCatalogue = decomposerNomCardmarket(c.name).nom;
            if (e.nom !== nomCatalogue) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `le nom de la liste (« ${e.nom} ») n'est pas celui du catalogue (« ${nomCatalogue} ») : la liste ne décrit pas ce produit` }); continue; }
            const rej = rejouer({ set: e.set, numero: e.numero, nom: nomCatalogue }, e.concordantes);
            if (!rej.ok) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `confirmation non rejouée : ${rej.motifs.join(' ; ')}` }); continue; }
            // (PHASE 3a-SUITE) le MÊME nom sous deux écritures est le même nom : « Lightning Energy » (Cardmarket) = « Basic Lightning Energy » (Bulbapedia), la clé de la jointure (clesNom) — l'égalité de la forme
            // normalisée seule laissait 12 énergies de BW-Promos recevoir une fiche simple en DOUBLON de leur vraie carte (vu par la simulation du lot, banc : énergie)
            const clesProduit = clesNom(e.nom);
            const memeNom = (cartesDuSet.get(e.set) || []).filter(x => !x.ficheSimple && (nuNom(x.nomEn) === nuNom(e.nom) || clesNom(nomJointDe(x)).some(k => clesProduit.includes(k))));
            if (memeNom.length) { refus.push({ idProduct: e.idProduct, nom: e.nom, motif: `une vraie carte de ce nom est déjà dans le set (${memeNom.slice(0, 3).map(x => x._id).join(', ')}) : c'est une jointure qui manque, pas une fiche à poser` }); continue; }
            const k = `${e.set}|${nuNom(e.nom)}|${nuNum(e.numero)}`;
            const g = groupes.get(k) || groupes.set(k, { slug: e.set, set: s, exp: e.exp, tirage: s.tirage ?? s.region, nomExp, nom: e.nom, numero: String(e.numero), attaques: decomposerNomCardmarket(c.name).attaques, produits: [], metas: new Set(), sources: new Map() }).get(k);
            g.produits.push({ idProduct: e.idProduct, name: c.name, numero: e.numero });
            if (c.idMetacard != null) g.metas.add(c.idMetacard);
            for (const x of e.concordantes || []) g.sources.set(`${x.source}|${x.ref ?? ''}`, x);
        }
        // l'identifiant d'une fiche simple : −le plus petit idProduct du groupe ; une fiche déjà là (reprise) reçoit seulement ses produits
        const existantes = new Map();
        for (const g of groupes.values()) for (const x of cartesDuSet.get(g.slug) || []) if (x.ficheSimple && nuNom(x.nomEn) === nuNom(g.nom) && nuNum(x.impressions?.[0]?.numero) === nuNum(g.numero)) existantes.set(`${g.slug}|${nuNom(g.nom)}|${nuNum(g.numero)}`, x._id);
        for (const [k, g] of groupes) {
            g.id = existantes.get(k) ?? -Math.min(...g.produits.map(p => p.idProduct));
            g.existante = existantes.has(k);
            if (!g.existante && (await db.collection('cartes').find({ _id: g.id }).toArray()).length) { err(`❌ fiche simple ${g.id} : identifiant déjà pris par une autre carte — rien n'est écrit`); return 1; }
        }
        const plan = [...groupes.values()];
        const nLignes = plan.reduce((t, g) => t + g.produits.length, 0);
        for (const g of plan) log(`   + ${g.slug} n°${g.numero} « ${g.nom} » → fiche simple ${g.id}${g.existante ? ' (déjà là)' : ''} · ${g.produits.length} produit(s) · sources : cardmarket + ${[...new Set([...g.sources.values()].map(x => x.source))].join(', ')}`);
        // les refus de CONFIRMATION se disent un à un, en entier (ils sont rares et c'est le motif qui compte) ; les autres se comptent
        for (const r of refus.filter(r => /^(confirmation non rejouée|le nom de la liste)/.test(r.motif))) log(`   ✗ ${r.idProduct} « ${r.nom} » : ${r.motif}`);
        const parMotif = {}; for (const r of refus) { const m = r.motif.replace(/\(.*\)/, '(…)').replace(/« [^»]*»/, '« … »'); parMotif[m] = (parMotif[m] || 0) + 1; }
        log(`   ${nLignes} lignes sur ${plan.length} fiches simples · refusés ${refus.length}${Object.keys(parMotif).length ? ' : ' + Object.entries(parMotif).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n} × ${m}`).join(' · ') : ''}${ecrire ? '' : ' — (simulation)'}`);
        const sourceTexte = g => `deux sources concordantes sur (set, n°, nom) : Cardmarket (export, numéro appris) + ${[...g.sources.values()].map(x => `${x.source} ${x.ref ?? ''}`.trim()).join(' ; ')} — règle du testeur, 2026-10-24 (aucune donnée Bulbapedia)`;
        const carteDe = g => ({ _id: g.id, nomEn: g.nom, sets: [g.slug], attaques: g.attaques.map(nom => ({ nom })),
            impressions: [{ tirage: g.tirage, expansion: g.nomExp, numero: g.numero, source: 'cardmarket', illustrateur: null, illustrateurPreuve: 'fiche simple : aucune page de carte chez nous, Cardmarket ne nomme pas l\'illustrateur' }],
            liens: { idProduct: g.produits.map(p => p.idProduct), idMetacards: [...g.metas] } });
        if (arg('plan')) fs.writeFileSync(arg('plan'), JSON.stringify({ outil: 'poser-fiches-deux-sources', cartes: plan.filter(g => !g.existante).map(carteDe), cartesSets: plan.map(g => ({ carteId: g.id, set: g.slug })),
            lignes: plan.flatMap(g => g.produits.map(p => ({ _id: `${g.id}|${p.idProduct}`, carteId: g.id, idProduct: p.idProduct, idExpansion: g.exp, tirage: g.tirage, preuve: 'fiche-simple', slug: null, slugSet: g.slug, numeroFiche: g.numero, code: g.slug, nomProduit: p.name, nomCarte: g.nom, sourcesTexte: sourceTexte(g) }))), refus }));
        if (!ecrire || !nLignes) return 0;
        if (ATTENDU !== nLignes) { err(`❌ ARRÊT : le plan rend ${nLignes} lignes, attendu ${ATTENDU} — rien n'est écrit`); return 1; }

        // ── l'écriture, ADDITIVE et idempotente : la carte d'abord, la ligne ensuite ──
        const le = new Date();
        for (const g of plan) {
            const ids = g.produits.map(p => p.idProduct), metas = [...g.metas];
            if (g.existante) await db.collection('cartes').updateOne({ _id: g.id, ficheSimple: { $exists: true } }, { $addToSet: { 'liens.idProduct': { $each: ids }, 'liens.idMetacards': { $each: metas }, sets: g.slug } });
            else await db.collection('cartes').updateOne({ _id: g.id }, { $setOnInsert: { ...Object.fromEntries(Object.entries(carteDe(g)).filter(([k]) => k !== '_id')),
                ficheSimple: { le, source: sourceTexte(g), motif: 'aucune page de carte chez nous pour ce produit — fiche simple confirmée par deux sources, à enrichir (la page réelle la remplacera ; ses lignes cartes_produits seront repointées)' } } }, { upsert: true });
            await db.collection('cartes_produits').bulkWrite(g.produits.map(p => ({ updateOne: { filter: { _id: `${g.id}|${p.idProduct}` }, update: { $setOnInsert: {
                carteId: g.id, idProduct: p.idProduct, idExpansion: g.exp, tirage: g.tirage, preuve: 'fiche-simple', slug: null, slugSet: g.slug, numeroFiche: g.numero,
                detail: `fiche simple : « ${p.name} » n°${p.numero} — ${sourceTexte(g)}`, verifieLe: le, route: `deux-sources:${g.exp}` } }, upsert: true } })), { ordered: false });
        }
        // ── la RELECTURE en base : ce qui est écrit, pas ce que les écritures ont rendu ──
        const ids = plan.flatMap(g => g.produits.map(p => `${g.id}|${p.idProduct}`));
        const relues = await db.collection('cartes_produits').find({ _id: { $in: ids } }).toArray();
        const lignesOk = relues.filter(l => l.preuve === 'fiche-simple' && l.numeroFiche != null).length;
        const cartesRelues = await db.collection('cartes').find({ _id: { $in: plan.map(g => g.id) } }).toArray();
        const cartesOk = plan.filter(g => { const c = cartesRelues.find(x => x._id === g.id); return c && c.ficheSimple && (c.sets || []).includes(g.slug) && g.produits.every(p => (c.liens?.idProduct || []).includes(p.idProduct)); }).length;
        log(`   RELECTURE : lignes ${lignesOk}/${ids.length} · fiches simples avec leurs produits et leur set ${cartesOk}/${plan.length}`);
        if (lignesOk !== ids.length || cartesOk !== plan.length) { err('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); return 1; }
        log('   ✅ écrit et relu');
        return 0;
    } finally { await fermer(); }
}

module.exports = { executer };

if (require.main === module) {
    (async () => {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
        const code = await executer({
            argv: process.argv.slice(2),
            ouvrir: async () => ({ db: cx.db, fermer: async () => { } }),
            catalogue: async ids => new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }).project({ idProduct: 1, name: 1, idMetacard: 1 }).toArray()).map(p => [p.idProduct, { name: p.name, idMetacard: p.idMetacard ?? null }]))
        });
        await fermer();
        process.exit(code);
    })().catch(e => { console.error(e); process.exit(1); });
}

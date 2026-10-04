// ============================================================
// LES PAGES UTILES DE LA PROCHAINE PASSE — seulement les pages Cardmarket qui portent un produit à apprendre (testeur, 2026-09-27)
// ============================================================
//   node generer-pages-utiles.js --liste=LISTE-SEUL-CARDMARKET-<date>.json --journal=<rat-market-journal-*.json>   (lecture seule)
// 🔴 LE CAS (journal 1.9) : 223 pages, 6 912 produits reçus, 6 476 déjà exacts (94 %) — la passe relit du connu, et c'est ce qui coûte
// les 1015 de Cardmarket. On ne visite plus une expansion : on visite une PAGE, celle où le produit à apprendre se trouve.
// 🔑 LA PAGE SE CALCULE, ET LE CALCUL SE CALIBRE AVANT DE SERVIR : une liste Cardmarket triée par nom (`sortBy=name_asc`, 30 par
// page, sans `perSite`) range les produits de l'expansion dans l'ordre de leur nom ; la page d'un produit est son rang / 30. Le rang
// dépend de QUI est dans la liste (un produit sans offre n'y est pas) : trois univers sont confrontés aux pages RÉELLEMENT VUES par
// les journaux (ids par page), et le meilleur sert. Les écarts sont d'une page, en bord de page : la MARGE (pages voisines ajoutées
// quand le produit est à moins de N rangs d'un bord) se choisit sur la même calibration, rappel et coût imprimés.
// Sortie : PAGES-UTILES-<date>.json (lu par generer-cibles-userscript.js) et .md (la liste, dans l'ordre de valeur).
// 🔴 2026-09-28, journal 1.10 : la liste du 27/09 envoyait à la page 11 de Sun-Moon-Promos — 0 vignette, et le testeur a tourné entre
// les pages 10 et 11. UNE LISTE CARDMARKET NE MONTRE QUE 300 PRODUITS (10 pages de 30) : le plafond était écrit au §67 (« totaux
// plafonnés à 300 ») et cet outil, écrit après, ne l'appliquait pas. 19 pages sur 256 étaient hors d'atteinte. Un produit au-delà du
// rang 300 se lit dans la liste triée par nom DÉCROISSANT (`name_desc`, page comptée depuis la fin : calibrée sur les 56 pages
// décroissantes ANGLAISES du journal, 89,9 % à la page calculée) ; au-delà de 300 dans les DEUX sens (liste de plus de 600), par la
// RECHERCHE de son nom dans l'expansion (`searchString`).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
//   [--guide=price_guide_<jjmmaa>.json]  un guide des prix Cardmarket plus récent que celui de la base (30/08) : un produit sans offre
//                                        n'est pas dans les listes, et le guide de la base est trop vieux pour le dire (testeur, 2026-09-28)
//   [--en-tete=<idExpansion,…>]           ces expansions EN TÊTE de la liste (testeur, 2026-10-04 : « les 42 expansions sans région, 1 423
//                                        produits jamais appris : en tête de ma prochaine liste ») — chacun de leurs produits de l'export
//                                        ABSENT de numeros_cartes est une cible ; sans slugSet appris, la page est celle du FILTRE
//                                        (`Singles?idCategory=51&idExpansion=N`, que l'userscript lit déjà : il apprend le slug sur les cartes)
const AUTORISES = [/^--liste=.+\.json$/, /^--journal=.+\.json(,.+\.json)*$/, /^--export=.+\.json$/, /^--marge=\d+$/, /^--guide=.+\.json$/, /^--en-tete=\d+(,\d+)*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const LISTE_F = arg('liste'), JOURNAUX = (arg('journal') || '').split(',').filter(Boolean), EXPORT = arg('export') || 'products_singles_24092026.json';
if (!LISTE_F || !JOURNAUX.length) { console.error('❌ --liste=<LISTE-SEUL-CARDMARKET-*.json> et --journal=<journal(s)> requis'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');

const { pagesDuRang, PAR_PAGE, PAGES_MAX } = require('./collecte-cartes/pages-du-rang');   // 30 par page, 10 pages au plus
const cmpNom = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.idProduct - b.idProduct;
const param = (u, k) => { const m = new RegExp(`[?&]${k}=([^&]*)`).exec(u); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; };
const urlPage = (slugSet, idExpansion, tri, site) => `/en/Pokemon/Products/Singles/${slugSet}?searchMode=v2&idCategory=51&idExpansion=${idExpansion}&idRarity=0&sortBy=${tri}${site > 1 ? `&site=${site}` : ''}`;
const urlRecherche = (slugSet, idExpansion, nom) => `/en/Pokemon/Products/Singles/${slugSet}?searchMode=v2&idCategory=51&idExpansion=${idExpansion}&searchString=${encodeURIComponent(nom)}&idRarity=0&sortBy=name_asc`;
// sans slugSet appris : le chemin s'arrête à « Singles », le filtre d'expansion fait la liste (l'userscript lit le slug sur les cartes)
const cheminListe = slugSet => slugSet ? `/en/Pokemon/Products/Singles/${slugSet}` : '/en/Pokemon/Products/Singles';
const urlPageOuFiltre = (slugSet, idExpansion, tri, site) => `${cheminListe(slugSet)}?searchMode=v2&idCategory=51&idExpansion=${idExpansion}&idRarity=0&sortBy=${tri}${site > 1 ? `&site=${site}` : ''}`;
const urlRechercheOuFiltre = (slugSet, idExpansion, nom) => `${cheminListe(slugSet)}?searchMode=v2&idCategory=51&idExpansion=${idExpansion}&searchString=${encodeURIComponent(nom)}&idRarity=0&sortBy=name_asc`;
const EN_TETE = new Set((arg('en-tete') || '').split(',').filter(Boolean).map(Number));
// La page d'un rang (croissant, décroissant, ou `principale: null` → recherche par le nom) : collecte-cartes/pages-du-rang.js.

let offreRecente = null, dateGuide = null;   // posés par --guide : l'offre au guide le plus récent décide de l'ORDRE (pages sûres d'abord)
(async () => {
    const L = JSON.parse(fs.readFileSync(LISTE_F, 'utf8'));
    const tous = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const parExp = new Map(); for (const p of tous) (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
    const { prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const guide = await lireMongo(prod.db.collection('guide_prix'), {}, { nom: 'guide_prix', projection: { idProduct: 1, low: 1 } });
    // --en-tete : ce que numeros_cartes connaît déjà de ces expansions (un produit appris n'est pas une cible ; un slugSet appris fait l'URL)
    const appris = EN_TETE.size ? await prod.db.collection('numeros_cartes').find({ idExpansion: { $in: [...EN_TETE] } }, { projection: { idProduct: 1, idExpansion: 1, slugSet: 1 } }).toArray() : [];
    await fermer();
    const auGuide = new Set(guide.map(g => g.idProduct)), avecOffre = new Set(guide.filter(g => g.low > 0).map(g => g.idProduct));
    // les univers candidats : qui est DANS une liste Cardmarket triée par nom
    const UNIVERS = {
        'tous les produits de l\'export': () => true,
        'avec une offre au guide (30/08)': p => avecOffre.has(p.idProduct),
        'avec une offre, ou absents du guide (produits postérieurs au 30/08)': p => avecOffre.has(p.idProduct) || !auGuide.has(p.idProduct)
    };
    if (arg('guide')) {
        const G = JSON.parse(fs.readFileSync(path.resolve(__dirname, arg('guide')), 'utf8'));
        const lignes = G.priceGuides;
        if (!Array.isArray(lignes) || !lignes.length) throw new Error(`${arg('guide')} : pas de « priceGuides » lisible`);
        // une offre normale OU holo : un produit qui n'a que des offres holo est quand même dans la liste
        const offreFichier = new Set(lignes.filter(g => g.low > 0 || g['low-holo'] > 0).map(g => g.idProduct));
        console.log(`guide ${arg('guide')} (${G.createdAt}) : ${lignes.length} lignes, ${offreFichier.size} avec une offre`);
        UNIVERS[`avec une offre au guide ${G.createdAt?.slice(0, 10)}`] = p => offreFichier.has(p.idProduct);
        offreRecente = offreFichier; dateGuide = G.createdAt?.slice(0, 10);
    }
    const rangs = new Map();   // univers -> idExpansion -> Map(idProduct -> rang)
    for (const [nom, dedans] of Object.entries(UNIVERS)) {
        const m = new Map();
        for (const [e, ps] of parExp) m.set(e, new Map(ps.filter(dedans).sort(cmpNom).map((p, i) => [p.idProduct, i])));
        rangs.set(nom, m);
    }
    // ── LA CALIBRATION : les pages triées par nom (croissant ET décroissant) des journaux, leurs ids. Une page de recherche, ou avec
    // `perSite`, n'en est pas une : elle ne suit pas la pagination par 30.
    const vues = [];
    for (const f of JOURNAUX) {
        const J = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const e of J.journal || []) {
            const tri = param(e.url, 'sortBy');
            // /en/ seulement : l'userscript 1.11 n'accepte que les pages anglaises (le tri /fr/ suit peut-être le nom français — relecture
            // du 2026-09-28 : 85,6 % à la page calculée en /fr/ contre 96,6 % en /en/)
            if (!/^\/en\//.test(e.url || '')) continue;
            if (!e.exp || !Array.isArray(e.ids) || !e.ids.length || !['name_asc', 'name_desc'].includes(tri) || param(e.url, 'perSite') || param(e.url, 'searchString')) continue;
            vues.push({ exp: e.exp, tri, site: Number(param(e.url, 'site') || 1), ids: e.ids });
        }
    }
    const nTri = t => vues.filter(v => v.tri === t);
    console.log(`DÉNOMINATEUR : ${JOURNAUX.length} journal(aux) · ${vues.length} pages triées par nom (sans perSite ni recherche) avec ids — croissant ${nTri('name_asc').length} (${nTri('name_asc').reduce((a, v) => a + v.ids.length, 0)} produits), décroissant ${nTri('name_desc').length} (${nTri('name_desc').reduce((a, v) => a + v.ids.length, 0)} produits)`);
    const calib = {};
    const MARGES = [0, 1, 2, 3, 5];
    for (const [nom] of Object.entries(UNIVERS)) {
        const R = rangs.get(nom);
        const c = { n: 0, juste: 0, horsUnivers: 0, parMarge: MARGES.map(m => ({ m, ok: 0 })), parTri: {} };
        for (const t of ['name_asc', 'name_desc']) c.parTri[t] = { n: 0, juste: 0, parMarge: MARGES.map(m => ({ m, ok: 0 })) };
        for (const v of vues) {
            const rg = R.get(v.exp), T = c.parTri[v.tri];
            for (const id of v.ids) {
                const r = rg?.get(id);
                if (r == null) { c.horsUnivers++; continue; }
                const x = v.tri === 'name_asc' ? r : rg.size - 1 - r;   // le rang dans l'ordre de la page
                const p = Math.floor(x / PAR_PAGE) + 1, pos = x % PAR_PAGE;
                c.n++; T.n++; if (p === v.site) { c.juste++; T.juste++; }
                MARGES.forEach((m, i) => { const pages = new Set([p]); if (pos < m) pages.add(p - 1); if (pos >= PAR_PAGE - m) pages.add(p + 1); if (pages.has(v.site)) { c.parMarge[i].ok++; T.parMarge[i].ok++; } });
            }
        }
        const rappels = (pm, n) => pm.map(x => ({ marge: x.m, rappel: n ? +(x.ok / n).toFixed(4) : 0 }));
        calib[nom] = { n: c.n, juste: c.juste, horsUnivers: c.horsUnivers, taux: c.n ? c.juste / c.n : 0, parMarge: rappels(c.parMarge, c.n),
            parTri: Object.fromEntries(Object.entries(c.parTri).map(([t, T]) => [t, { n: T.n, juste: T.juste, taux: T.n ? T.juste / T.n : 0, parMarge: rappels(T.parMarge, T.n) }])) };
        const k = calib[nom], pc = x => `${(100 * x).toFixed(1)} %`;
        console.log(`   ${nom} : ${k.juste}/${k.n} à la page calculée (${pc(k.taux)} ; croissant ${pc(k.parTri.name_asc.taux)} sur ${k.parTri.name_asc.n}, décroissant ${pc(k.parTri.name_desc.taux)} sur ${k.parTri.name_desc.n}) · vus hors univers ${k.horsUnivers} · rappel par marge ${k.parMarge.map(x => `${x.marge}:${(100 * x.rappel).toFixed(1)}%`).join(' ')}`);
    }
    const [meilleur] = Object.entries(calib).sort((a, b) => b[1].taux - a[1].taux);
    const R = rangs.get(meilleur[0]);
    const marge = arg('marge') != null ? Number(arg('marge')) : (meilleur[1].parMarge.find(x => x.rappel >= 0.99)?.marge ?? 3);
    console.log(`→ univers retenu : « ${meilleur[0]} » · marge ${marge} (rappel ${(100 * (meilleur[1].parMarge.find(x => x.marge === marge)?.rappel ?? 0)).toFixed(1)} % sur la calibration)`);

    // ── LES CIBLES : jamais appris + appris sans slug (la liste de apprendre-par-tcgdex.js) — TOUS, avec ou sans offre.
    // 🔴 Mesuré le 2026-09-28 (guide du 27/09) : 1 002 des produits VUS dans des listes triées par nom n'ont aucune offre — « sans offre
    // = invisible » (journal 1.8, sur des listes à filtres) ne tient pas ici. Un produit sans offre reste une cible, marqué comme tel.
    const cibles = [...(L.pourTaPasse?.produits || []).map(p => ({ ...p, k: 'jamais appris' })), ...(L.invisibles?.produits || []).map(p => ({ ...p, k: 'jamais appris (sans offre au 30/08)' })),
        ...(L.sansSlug?.produits || []).map(p => ({ ...p, k: p.visibleDansLesListes ? 'slug vide' : 'slug vide (sans offre au 30/08)' }))];
    // --en-tete : les produits de l'EXPORT de ces expansions absents de numeros_cartes (une cible de la liste déjà présente n'est pas doublée)
    if (EN_TETE.size) {
        const dejaAppris = new Set(appris.map(a => a.idProduct)), dejaCible = new Set(cibles.map(c => c.idProduct));
        const slugDe = new Map(); for (const a of appris) if (a.slugSet && !slugDe.has(a.idExpansion)) slugDe.set(a.idExpansion, a.slugSet);
        let n = 0;
        for (const e of EN_TETE) for (const p of parExp.get(e) || []) {
            if (dejaAppris.has(p.idProduct)) continue;
            if (dejaCible.has(p.idProduct)) { const c = cibles.find(c => c.idProduct === p.idProduct); c.enTete = true; continue; }
            cibles.push({ idProduct: p.idProduct, idExpansion: e, slugSet: slugDe.get(e) ?? null, nom: p.name, k: 'jamais appris (en tête)', enTete: true }); n++;
        }
        const absentes = [...EN_TETE].filter(e => !parExp.has(e));
        console.log(`EN TÊTE : ${EN_TETE.size} expansions · ${n} cibles ajoutées depuis l'export (${appris.length} produits déjà appris écartés) · ${[...EN_TETE].filter(e => slugDe.has(e)).length} avec un slugSet appris, ${[...EN_TETE].filter(e => !slugDe.has(e)).length} par l'URL du FILTRE${absentes.length ? ` · 🔴 absentes de l'export ${EXPORT} : ${absentes.join(', ')}` : ''}`);
    }
    // la recherche se fait sur le nom NU (« Houndoom », pas « Houndoom [Call to Muster | Pitch-Black Fangs] ») : les crochets et le « | »
    // sont la désambiguïsation de Cardmarket, rien ne dit que sa recherche les lit ; le nom nu rend tous les produits de ce nom dans
    // l'expansion, la cible parmi eux (leur nombre est imprimé : au-delà de 30, la recherche a plus d'une page)
    const nomNu = s => String(s || '').split(' [')[0].trim();
    const nomExport = new Map(tous.map(p => [p.idProduct, nomNu(p.name)]));
    const nomComplet = new Map(tous.map(p => [p.idProduct, String(p.name || '').toLowerCase()]));
    const pages = new Map(), sansPage = [];
    for (const c of cibles) {
        const rg = R.get(c.idExpansion), r = rg?.get(c.idProduct);
        // une cible EN TÊTE sans slugSet passe par l'URL du filtre ; les autres exigent toujours leur slugSet
        if (r == null || (!c.slugSet && !c.enTete)) { sansPage.push({ ...c, raison: !c.slugSet && !c.enTete ? 'expansion sans slugSet appris : l\'URL de sa liste est inconnue' : 'hors de l\'univers retenu (pas dans les listes)' }); continue; }
        const pl = pagesDuRang(r, rg.size, marge);
        const nom = nomExport.get(c.idProduct);
        if (!pl.principale && !nom) { sansPage.push({ ...c, raison: `rang ${r + 1} sur ${rg.size} : au-delà de 300 dans les deux sens, et pas de nom au catalogue pour la recherche` }); continue; }
        // les pages de la cible : la principale (sa page calculée, ou la recherche par son nom), puis les voisines de marge
        const entrees = [pl.principale ? { ...pl.principale, principale: true } : { tri: 'recherche', site: 1, q: nom, principale: true },
            ...pl.pages.filter(t => !(pl.principale && t.tri === pl.principale.tri && t.site === pl.principale.site)).map(t => ({ ...t, principale: false }))];
        const offre = offreRecente ? offreRecente.has(c.idProduct) : null;
        for (const t of entrees) {
            const k = t.tri === 'recherche' ? `${c.idExpansion}|recherche|${t.q.toLowerCase()}` : `${c.idExpansion}|${t.tri}|${t.site}`;
            const x = pages.get(k) || pages.set(k, { idExpansion: c.idExpansion, code: c.code ?? null, slugSet: c.slugSet, tri: t.tri, site: t.site, recherche: t.q ?? null,
                url: t.tri === 'recherche' ? urlRechercheOuFiltre(c.slugSet, c.idExpansion, t.q) : urlPageOuFiltre(c.slugSet, c.idExpansion, t.tri, t.site), cibles: [], valeur: 0, voisine: !t.principale, enTete: !!c.enTete,
                // la recherche de Cardmarket rend les noms qui CONTIENNENT le texte (« Miraidon » rend aussi « Miraidon ex ») : on compte ainsi
                ...(t.tri === 'recherche' ? { produitsAuNom: [...rg.keys()].filter(id => (nomComplet.get(id) || '').includes(t.q.toLowerCase())).length } : {}) }).get(k);
            x.cibles.push({ idProduct: c.idProduct, nom: c.nom, k: c.k, prixTendance: c.prixTendance ?? null, rang: r + 1, produitsDansLaListe: rg.size,
                pageCalculee: pl.principale ? `${pl.principale.tri} ${pl.principale.site}` : 'recherche', ...(offreRecente ? { offre } : {}) });
            if (t.principale) { x.voisine = false; x.valeur += c.prixTendance || 0; if (offre) x.sure = true; }
        }
    }
    // ordre : d'abord les pages SÛRES (une cible au moins a une offre au guide le plus récent : elle est dans la liste), puis les autres ;
    // dans chaque groupe les pages de LISTE (jusqu'à 30 cibles chacune) avant les RECHERCHES (en général une cible : 62 le 28/09, presque
    // toutes dans une seule expansion de 774 produits) ; puis expansions par valeur totale, le tri croissant page après page, le décroissant
    for (const x of pages.values()) x.sure = offreRecente ? !!x.sure : null;
    // la valeur d'une expansion se compte SÉPARÉMENT pour ses pages de liste et pour ses recherches (relecture du 2026-09-28 : les 62
    // recherches de mC la mettaient en tête des pages de liste avec deux pages à 3 € et 2 €)
    const groupe = x => `${x.idExpansion}|${x.tri === 'recherche'}`;
    const valeurExp = new Map(); for (const x of pages.values()) valeurExp.set(groupe(x), (valeurExp.get(groupe(x)) || 0) + x.valeur);
    const nExpansions = new Set([...pages.values()].map(x => x.idExpansion)).size;
    const RANG_TRI = { name_asc: 0, name_desc: 1, recherche: 2 };
    // --en-tete d'abord (demande du testeur), puis l'ordre d'avant
    const liste = [...pages.values()].sort((a, b) => ((b.enTete ? 1 : 0) - (a.enTete ? 1 : 0)) || ((b.sure ? 1 : 0) - (a.sure ? 1 : 0)) || ((a.tri === 'recherche') - (b.tri === 'recherche'))
        || (valeurExp.get(groupe(b)) - valeurExp.get(groupe(a))) || a.idExpansion - b.idExpansion
        || RANG_TRI[a.tri] - RANG_TRI[b.tri] || a.site - b.site || String(a.recherche).localeCompare(String(b.recherche)));
    // la garde du plafond, écrite par ce qu'elle AUTORISE : une page de liste entre 1 et 10, ou une recherche — rien d'autre ne sort
    const horsPlafond = liste.filter(x => !(x.tri === 'recherche' ? x.recherche && x.site === 1 : ['name_asc', 'name_desc'].includes(x.tri) && x.site >= 1 && x.site <= PAGES_MAX));
    if (horsPlafond.length) throw new Error(`${horsPlafond.length} page(s) hors de ce que Cardmarket montre (tri inconnu, ou au-delà de la page ${PAGES_MAX}) : ${horsPlafond.slice(0, 3).map(x => x.url).join(' ; ')}`);
    liste.forEach((x, i) => { x.ordre = i + 1; });
    const date = new Date().toISOString().slice(0, 10);
    const sortie = { genere: new Date().toISOString(), liste: path.basename(LISTE_F), journaux: JOURNAUX.map(f => path.basename(f)), parPage: PAR_PAGE, univers: meilleur[0], marge, calibration: calib,
        cibles: cibles.length, pagesUtiles: liste.length, expansions: nExpansions, sansPage, pages: liste };
    fs.writeFileSync(path.join(__dirname, `PAGES-UTILES-${date}.json`), JSON.stringify(sortie, null, 1));
    const md = [`# Pages utiles de la prochaine passe — ${date}`, '', `${cibles.length} produits à apprendre (${cibles.filter(c => c.k === 'jamais appris').length} jamais appris, ${cibles.filter(c => c.k === 'slug vide').length} au slug vide), visibles dans les listes → **${liste.length} pages** sur ${nExpansions} expansions (tri par nom, 30 par page ; page calculée, calibrée à ${(100 * meilleur[1].taux).toFixed(1)} % sur ${meilleur[1].n} produits vus ; marge ${marge}). ${sansPage.length} cibles sans page (raison dans le .json).`, '',
        offreRecente ? `D'abord les ${liste.filter(x => x.sure).length} pages SÛRES (une cible au moins a une offre au guide du ${dateGuide}), puis les ${liste.filter(x => !x.sure).length} dont aucune cible n'a d'offre.` : '', '',
        `Cardmarket ne montre que 300 produits par liste (10 pages) : au-delà, la page se lit dans le tri par nom DÉCROISSANT (« ↓ »), et au milieu d'une liste de plus de 600, par la RECHERCHE du nom (« 🔍 »).`, '',
        '| # | sûre | expansion | page | cibles | valeur (€) | lien |', '|---|---|---|---|---|---|---|',
        ...liste.map(x => `| ${x.ordre} | ${x.sure === null ? '' : x.sure ? 'oui' : 'non'} | ${x.enTete ? '⭐ ' : ''}${x.code ?? ''} ${x.slugSet ?? `(filtre ${x.idExpansion})`} | ${x.tri === 'recherche' ? `🔍 « ${x.recherche} »${x.produitsAuNom > PAR_PAGE ? ` (${x.produitsAuNom} produits à ce nom : plus d'une page)` : ''}` : `${x.tri === 'name_desc' ? '↓ ' : ''}${x.site}`}${x.voisine ? ' (voisine)' : ''} | ${x.cibles.length} | ${Math.round(x.valeur)} | https://www.cardmarket.com${x.url} |`)];
    fs.writeFileSync(path.join(__dirname, `PAGES-UTILES-${date}.md`), md.join('\n'));
    if (offreRecente) console.log(`\n   pages SÛRES (une cible avec offre au guide du ${dateGuide}) : ${liste.filter(x => x.sure).length} · pages dont aucune cible n'a d'offre : ${liste.filter(x => !x.sure).length}`);
    const parTri = liste.reduce((o, x) => (o[x.tri] = (o[x.tri] || 0) + 1, o), {});
    console.log(`\n✅ ${cibles.length} cibles → ${liste.length} pages utiles sur ${nExpansions} expansions (${liste.filter(x => x.voisine).length} voisines de marge ; par tri ${JSON.stringify(parTri)}) · ${sansPage.length} sans page (${JSON.stringify(sansPage.reduce((o, s) => (o[s.raison] = (o[s.raison] || 0) + 1, o), {}))})`);
    for (const x of liste.slice(0, 10)) console.log(`   ${String(x.ordre).padStart(3)}. ${x.code ?? ''} ${x.slugSet} ${x.tri === 'recherche' ? `🔍 « ${x.recherche} »` : `${x.tri === 'name_desc' ? '↓' : ''}p.${x.site}`} — ${x.cibles.length} cible(s), ${Math.round(x.valeur)} €`);
    console.log(`écrit : PAGES-UTILES-${date}.json, PAGES-UTILES-${date}.md`);
})().catch(e => { console.error(e); process.exit(1); });

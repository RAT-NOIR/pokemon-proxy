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
require('dotenv').config();
const fs = require('fs');
const path = require('path');
//   [--guide=price_guide_<jjmmaa>.json]  un guide des prix Cardmarket plus récent que celui de la base (30/08) : un produit sans offre
//                                        n'est pas dans les listes, et le guide de la base est trop vieux pour le dire (testeur, 2026-09-28)
const AUTORISES = [/^--liste=.+\.json$/, /^--journal=.+\.json(,.+\.json)*$/, /^--export=.+\.json$/, /^--marge=\d+$/, /^--guide=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const LISTE_F = arg('liste'), JOURNAUX = (arg('journal') || '').split(',').filter(Boolean), EXPORT = arg('export') || 'products_singles_24092026.json';
if (!LISTE_F || !JOURNAUX.length) { console.error('❌ --liste=<LISTE-SEUL-CARDMARKET-*.json> et --journal=<journal(s)> requis'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');

const PAR_PAGE = 30;
const cmpNom = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.idProduct - b.idProduct;
const param = (u, k) => { const m = new RegExp(`[?&]${k}=([^&]*)`).exec(u); return m ? decodeURIComponent(m[1]) : null; };
const urlPage = (slugSet, idExpansion, site) => `/en/Pokemon/Products/Singles/${slugSet}?searchMode=v2&idCategory=51&idExpansion=${idExpansion}&idRarity=0&sortBy=name_asc${site > 1 ? `&site=${site}` : ''}`;

let offreRecente = null, dateGuide = null;   // posés par --guide : l'offre au guide le plus récent décide de l'ORDRE (pages sûres d'abord)
(async () => {
    const L = JSON.parse(fs.readFileSync(LISTE_F, 'utf8'));
    const tous = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const parExp = new Map(); for (const p of tous) (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
    const { prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const guide = await lireMongo(prod.db.collection('guide_prix'), {}, { nom: 'guide_prix', projection: { idProduct: 1, low: 1 } });
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
    // ── LA CALIBRATION : les pages triées par nom des journaux, leurs ids
    const vues = [];
    for (const f of JOURNAUX) {
        const J = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const e of J.journal || []) {
            if (!e.exp || !Array.isArray(e.ids) || !e.ids.length || !/sortBy=name_asc/.test(e.url) || param(e.url, 'perSite')) continue;
            vues.push({ exp: e.exp, site: Number(param(e.url, 'site') || 1), ids: e.ids });
        }
    }
    console.log(`DÉNOMINATEUR : ${JOURNAUX.length} journal(aux) · ${vues.length} pages triées par nom (sans perSite) avec ids · ${vues.reduce((a, v) => a + v.ids.length, 0)} produits vus`);
    const calib = {};
    for (const [nom] of Object.entries(UNIVERS)) {
        const R = rangs.get(nom);
        let n = 0, juste = 0, horsUnivers = 0;
        const parMarge = [0, 1, 2, 3, 5].map(m => ({ m, rappel: 0 }));
        for (const v of vues) for (const id of v.ids) {
            const r = R.get(v.exp)?.get(id);
            if (r == null) { horsUnivers++; continue; }
            n++;
            const p = Math.floor(r / PAR_PAGE) + 1, pos = r % PAR_PAGE;
            if (p === v.site) juste++;
            for (const x of parMarge) { const pages = new Set([p]); if (pos < x.m) pages.add(p - 1); if (pos >= PAR_PAGE - x.m) pages.add(p + 1); if (pages.has(v.site)) x.rappel++; }
        }
        calib[nom] = { n, juste, horsUnivers, taux: n ? juste / n : 0, parMarge: parMarge.map(x => ({ marge: x.m, rappel: n ? +(x.rappel / n).toFixed(4) : 0 })) };
        console.log(`   ${nom} : ${juste}/${n} à la page calculée (${(100 * juste / (n || 1)).toFixed(1)} %) · vus hors univers ${horsUnivers} · rappel par marge ${calib[nom].parMarge.map(x => `${x.marge}:${(100 * x.rappel).toFixed(1)}%`).join(' ')}`);
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
    const pages = new Map(), sansPage = [];
    for (const c of cibles) {
        const r = R.get(c.idExpansion)?.get(c.idProduct);
        if (r == null || !c.slugSet) { sansPage.push({ ...c, raison: !c.slugSet ? 'expansion sans slugSet appris : l\'URL de sa liste est inconnue' : 'hors de l\'univers retenu (pas dans les listes)' }); continue; }
        const p = Math.floor(r / PAR_PAGE) + 1, pos = r % PAR_PAGE;
        const ps = [p]; if (pos < marge && p > 1) ps.push(p - 1); if (pos >= PAR_PAGE - marge) ps.push(p + 1);
        for (const s of ps) {
            const k = `${c.idExpansion}|${s}`;
            const x = pages.get(k) || pages.set(k, { idExpansion: c.idExpansion, code: c.code ?? null, slugSet: c.slugSet, site: s, url: urlPage(c.slugSet, c.idExpansion, s), cibles: [], valeur: 0, voisine: s !== p }).get(k);
            const offre = offreRecente ? offreRecente.has(c.idProduct) : null;
            x.cibles.push({ idProduct: c.idProduct, nom: c.nom, k: c.k, prixTendance: c.prixTendance ?? null, rang: r + 1, pageCalculee: p, ...(offreRecente ? { offre } : {}) });
            if (s === p) { x.voisine = false; x.valeur += c.prixTendance || 0; if (offre) x.sure = true; }
        }
    }
    // ordre : d'abord les pages SÛRES (une cible au moins a une offre au guide le plus récent : elle est dans la liste), puis les autres ;
    // dans chaque groupe, expansions par valeur totale, puis pages croissantes (une passe suit l'expansion page après page)
    for (const x of pages.values()) x.sure = offreRecente ? !!x.sure : null;
    const valeurExp = new Map(); for (const x of pages.values()) valeurExp.set(x.idExpansion, (valeurExp.get(x.idExpansion) || 0) + x.valeur);
    const liste = [...pages.values()].sort((a, b) => ((b.sure ? 1 : 0) - (a.sure ? 1 : 0)) || (valeurExp.get(b.idExpansion) - valeurExp.get(a.idExpansion)) || a.idExpansion - b.idExpansion || a.site - b.site);
    liste.forEach((x, i) => { x.ordre = i + 1; });
    const date = new Date().toISOString().slice(0, 10);
    const sortie = { genere: new Date().toISOString(), liste: path.basename(LISTE_F), journaux: JOURNAUX.map(f => path.basename(f)), parPage: PAR_PAGE, univers: meilleur[0], marge, calibration: calib,
        cibles: cibles.length, pagesUtiles: liste.length, expansions: valeurExp.size, sansPage, pages: liste };
    fs.writeFileSync(path.join(__dirname, `PAGES-UTILES-${date}.json`), JSON.stringify(sortie, null, 1));
    const md = [`# Pages utiles de la prochaine passe — ${date}`, '', `${cibles.length} produits à apprendre (${cibles.filter(c => c.k === 'jamais appris').length} jamais appris, ${cibles.filter(c => c.k === 'slug vide').length} au slug vide), visibles dans les listes → **${liste.length} pages** sur ${valeurExp.size} expansions (tri par nom, 30 par page ; page calculée, calibrée à ${(100 * meilleur[1].taux).toFixed(1)} % sur ${meilleur[1].n} produits vus ; marge ${marge}). ${sansPage.length} cibles sans page (raison dans le .json).`, '',
        offreRecente ? `D'abord les ${liste.filter(x => x.sure).length} pages SÛRES (une cible au moins a une offre au guide du ${dateGuide}), puis les ${liste.filter(x => !x.sure).length} dont aucune cible n'a d'offre.` : '', '',
        '| # | sûre | expansion | page | cibles | valeur (€) | lien |', '|---|---|---|---|---|---|---|',
        ...liste.map(x => `| ${x.ordre} | ${x.sure === null ? '' : x.sure ? 'oui' : 'non'} | ${x.code ?? ''} ${x.slugSet} | ${x.site}${x.voisine ? ' (voisine)' : ''} | ${x.cibles.length} | ${Math.round(x.valeur)} | https://www.cardmarket.com${x.url} |`)];
    fs.writeFileSync(path.join(__dirname, `PAGES-UTILES-${date}.md`), md.join('\n'));
    if (offreRecente) console.log(`\n   pages SÛRES (une cible avec offre au guide du ${dateGuide}) : ${liste.filter(x => x.sure).length} · pages dont aucune cible n'a d'offre : ${liste.filter(x => !x.sure).length}`);
    console.log(`\n✅ ${cibles.length} cibles → ${liste.length} pages utiles sur ${valeurExp.size} expansions (${liste.filter(x => x.voisine).length} voisines de marge) · ${sansPage.length} sans page (${JSON.stringify(sansPage.reduce((o, s) => (o[s.raison] = (o[s.raison] || 0) + 1, o), {}))})`);
    for (const x of liste.slice(0, 10)) console.log(`   ${String(x.ordre).padStart(3)}. ${x.code ?? ''} ${x.slugSet} p.${x.site} — ${x.cibles.length} cible(s), ${Math.round(x.valeur)} €`);
    console.log(`écrit : PAGES-UTILES-${date}.json, PAGES-UTILES-${date}.md`);
})().catch(e => { console.error(e); process.exit(1); });

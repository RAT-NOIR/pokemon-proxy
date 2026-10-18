// plan-cardtrader.js — énumérer (sitemaps) puis apparier (plan), SANS image et SANS écriture en base. Voir collecte-cartes/cardtrader.js.
//   node plan-cardtrader.js --sonder=<url> --cache=<dossier> --plafond=<n>       (une adresse, pour lire la forme d'un fichier)
//   node plan-cardtrader.js --enumerer --cache=<dossier> --plafond=<n>           (robots.txt, sitemaps ; écrit enumeration.json à côté du cache)
//   node plan-cardtrader.js --plan --cache=<dossier>                             (0 requête ; lit la base en LECTURE SEULE ; écrit plan.json et echantillon.json)
// Le plafond est un TOTAL pour le dossier de cache : les réponses déjà en cache le consomment (une réponse en cache n'est jamais redemandée).
// À lancer depuis le dépôt principal (le .env s'y lit) avec le chemin de ce fichier.
'use strict';
const fs = require('fs');
const path = require('path');
const CT = require('./collecte-cartes/cardtrader');

const AUTORISES = [/^--sonder=https:\/\/www\.cardtrader\.com\/\S*$/, /^--enumerer$/, /^--plan$/, /^--cache=.+$/, /^--plafond=\d{1,3}$/, /^--sortie=.+$/];
const args = process.argv.slice(2);
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const nbCache = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^[0-9a-f]{16}-.*\.json$/.test(f)).length : 0);
const UTILE = /prize-pack|world-championship-decks|battle-academy/i;
const LOCALE = 'en-US';
const CADENCE_S = 6;

function client(dossier, plafondTotal) {
    const deja = nbCache(dossier);
    if (plafondTotal - deja < 1) {
        // tout doit venir du cache : un client au plafond d'une requête, qui lèvera si une réponse manque
        return { cli: CT.fabriquerClient({ dossierCache: dossier, plafond: 1 }), deja, interdit: true };
    }
    return { cli: CT.fabriquerClient({ dossierCache: dossier, plafond: plafondTotal - deja }), deja, interdit: false };
}

async function enumerer({ dossier, plafondTotal }) {
    const { cli, deja } = client(dossier, plafondTotal);
    await cli.initialiserRobots();
    const declares = CT.sitemapsDesRobots(cli.texteRobots());
    const base = `https://${CT.HOTE}/sitemaps/${LOCALE}/`;
    const voulus = ['blueprint_products.xml.gz'].map(n => base + n);
    for (const v of voulus) if (!declares.includes(v)) throw new Error(`robots.txt ne déclare pas ${v} — on ne devine pas d'adresse de sitemap`);
    const lus = [];
    const entrees = [];
    for (const idx of voulus) {
        const r = await cli.lire(idx);
        if (r.status !== 200) throw new Error(`${idx} : HTTP ${r.status}`);
        const index = CT.lireSitemap(r.texte);
        if (index.type !== 'index') throw new Error(`${idx} n'est pas un index de sitemaps`);
        for (const f of index.entrees) {
            if (!CT.hoteOk(f.loc)) throw new Error(`sitemap hors hôte refusé : ${f.loc}`);
            const rf = await cli.lire(f.loc);
            if (rf.status !== 200) throw new Error(`${f.loc} : HTTP ${rf.status}`);
            const s = CT.lireSitemap(rf.texte);
            if (s.type !== 'urlset' || !s.entrees.length) throw new Error(`${f.loc} : urlset vide ou illisible (${s.type}, ${s.entrees.length}) — un vide n'est pas une réponse`);
            lus.push({ url: f.loc, entrees: s.entrees.length, cache: rf.cache });
            for (const e of s.entrees) entrees.push(e);
        }
    }
    // le tri : tout ce qui n'est pas une adresse de page de carte est compté, jamais ignoré en silence
    const retenus = [], utilesNonLus = [];
    let cartes = 0;
    for (const e of entrees) {
        if (!/\/en-US\/cards\//.test(e.loc)) continue;
        cartes++;
        if (!UTILE.test(e.loc)) continue;
        const b = CT.blueprintDepuisPage(e.loc);
        if (b) retenus.push(b); else utilesNonLus.push(e.loc);
    }
    const compte = (l, k) => l.reduce((m, b) => (m[k(b)] = (m[k(b)] || 0) + 1, m), {});
    const doc = {
        le: new Date().toISOString(), locale: LOCALE, declares: declares.length, fichiers: lus,
        entreesLues: entrees.length, adressesDeCartes: cartes, retenues: retenus.length, scelles: retenus.filter(b => b.type === 'scelle').length,
        utilesNonLus: utilesNonLus.length, exemplesNonLus: utilesNonLus.slice(0, 15),
        entreesAvecImage: entrees.filter(e => e.images.length).length,
        parFamille: compte(retenus.filter(b => !b.type), b => `${b.famille}${b.annee ? '-' + b.annee : ''}`),
        requetes: { ceRun: cli.requetes(), dejaEnCache: deja, plafondTotal },
        blueprints: retenus
    };
    return doc;
}

// ── le plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SLUGS = /^(WCD-\d{4}|Play-Pokemon-Prize-Pack-Series-[A-Za-z]+|Battle-Academy-\d{4})$/;
const SERIES = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9 };
function familleDeSlugSet(s) {
    let m;
    if ((m = /^WCD-(\d{4})$/.exec(s))) return { famille: 'wcd', annee: m[1], serie: null, groupe: `WCD ${m[1]}` };
    if ((m = /^Play-Pokemon-Prize-Pack-Series-([A-Za-z]+)$/.exec(s))) return { famille: 'pp', annee: null, serie: m[1], groupe: `PP S${SERIES[m[1]] ?? m[1]}` };
    if ((m = /^Battle-Academy-(\d{4})$/.exec(s))) return { famille: 'ba', annee: m[1], serie: null, groupe: `BA ${m[1]}` };
    return null;
}
function prng(graine) { let a = graine >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function plan({ enumeration }) {
    require('dotenv').config();
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { estCarteCode } = require('./collecte-cartes/jointure');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    try {
        const appris = await prod.db.collection('numeros_cartes').find({ slugSet: { $regex: '^(WCD-|Play-Pokemon-Prize-Pack-Series-|Battle-Academy-)' } }, { projection: { idProduct: 1, slug: 1, slugSet: 1, numero: 1, variante: 1 } }).toArray();
        const ciblees = appris.filter(p => SLUGS.test(p.slugSet));
        // dénominateur : lecture non vide, et la regex doit mordre (WCD, PP, BA présents)
        const fam = { wcd: 0, pp: 0, ba: 0 };
        for (const p of ciblees) fam[familleDeSlugSet(p.slugSet).famille]++;
        if (!fam.wcd || !fam.pp || !fam.ba) throw new Error(`lecture vide d'une famille : ${JSON.stringify(fam)} — une clé fausse (§41)`);
        const ids = ciblees.map(p => p.idProduct);
        const noms = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
        const nonCode = ciblees.filter(p => !estCarteCode(noms.get(p.idProduct) || p.slug || ''));
        const cartesCode = ciblees.length - nonCode.length;
        const liens = await cx.db.collection('cartes_produits').find({ idProduct: { $in: nonCode.map(p => p.idProduct) } }, { projection: { idProduct: 1, carteId: 1, slugSet: 1, preuve: 1 } }).toArray();
        const carteIds = [...new Set(liens.map(l => l.carteId))];
        const docs = await cx.db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { nomEn: 1, impressions: 1, images: 1 } }).toArray();
        const carte = new Map(docs.map(c => [c._id, c]));
        const sets = await cx.db.collection('sets').find({}, { projection: { region: 1 } }).toArray();
        if (!sets.length) throw new Error('table des sets vide : le tri du scan du jumeau ne peut pas conclure');
        const regionDe = new Map(sets.map(s => [s._id, s.region]));
        const slugParProduit = new Map(nonCode.map(p => [p.idProduct, p.slugSet]));
        const imagesParCarte = new Map(docs.map(c => [c._id, c.images || []]));
        const servis = CT.produitsServis({ liens, imagesParCarte, regionDe, slugParProduit });
        const liensDe = new Map();
        for (const l of liens) (liensDe.get(l.idProduct) || liensDe.set(l.idProduct, []).get(l.idProduct)).push(l);

        const nonServis = nonCode.filter(p => !servis.has(p.idProduct));
        const fabriquer = p => {
            const f = familleDeSlugSet(p.slugSet);
            const ls = liensDe.get(p.idProduct) || [];
            const c = ls.length === 1 ? carte.get(ls[0].carteId) : null;      // plusieurs cartes pour un produit : aucune ne témoigne
            return { idProduct: p.idProduct, famille: f.famille, annee: f.annee, serie: f.serie, groupe: f.groupe, slugSet: p.slugSet, slug: p.slug, numeroCM: p.numero ?? null, variante: p.variante ?? null,
                carteId: ls.length === 1 ? ls[0].carteId : null, carteNom: c?.nomEn ?? null, impressions: c ? (c.impressions || []).map(i => ({ numero: i.numero, total: i.total })) : null, liens: ls.length };
        };
        const produits = nonServis.map(fabriquer);
        const tousProduits = nonCode.map(fabriquer);        // le contexte des origines : servis ou non
        const blueprints = enumeration.blueprints;
        const res = CT.apparier(produits, blueprints, tousProduits);
        // les introuvables s'ouvrent (§22) : le même numéro, la même année, chez CardTrader — pour lire la cause à l'œil
        const parNumero = new Map();
        for (const b of blueprints.filter(b => !b.type && b.numero != null)) { const k = `${b.famille}|${b.famille === 'pp' ? '' : b.annee}|${b.numero}`; (parNumero.get(k) || parNumero.set(k, []).get(k)).push(b.slug); }
        res.forEach((r, i) => {
            if (r.statut !== 'introuvable') return;
            const s = CT.produitDepuisSlug(produits[i].slug, produits[i].famille);
            if (s?.numero != null) r.indice = (parNumero.get(`${produits[i].famille}|${produits[i].famille === 'pp' ? '' : produits[i].annee}|${s.numero}`) || []).slice(0, 3);
        });
        const parId = new Map(blueprints.map(b => [b.id, b]));

        // ── deux lectures de ce que l'appariement N'A PAS tranché, chiffrées plutôt que passées sous silence ──
        const cleOrigine = p => { const s = CT.produitDepuisSlug(p.slug, p.famille); return s ? `${p.famille}|${p.famille === 'pp' ? p.serie : p.annee ?? ''}|${CT.norm(p.carteNom ?? s.nom).replace(/ /g, '')}|${s.code ?? ''}|${s.numero ?? ''}` : null; };
        const effectifs = new Map();
        for (const p of tousProduits) { const k = cleOrigine(p); if (k) effectifs.set(k, (effectifs.get(k) || 0) + 1); }
        const pairesParBlueprint = new Map();
        res.forEach((r, i) => { if (r.statut === 'apparie') { const k = `${r.blueprint.id}|${produits[i].famille === 'pp' ? produits[i].serie : produits[i].annee ?? ''}`; (pairesParBlueprint.get(k) || pairesParBlueprint.set(k, []).get(k)).push(i); } });
        const lectures = { permutation: 0, ambiguSansPermutation: 0, reserveVariantes: 0, partageEntreSeries: 0 };
        res.forEach((r, i) => {
            if (r.statut === 'ambigu' && r.cause !== 'origine') {
                // autant de produits (V1, V2, V3…) que de candidats : une bijection existe peut-être, mais rien dans nos données ne dit LEQUEL est lequel
                const k = cleOrigine(produits[i]);
                if (k && effectifs.get(k) === r.candidats.length) { r.permutation = true; lectures.permutation++; } else lectures.ambiguSansPermutation++;
            }
            if (r.statut === 'apparie') {
                const k = `${r.blueprint.id}|${produits[i].famille === 'pp' ? produits[i].serie : produits[i].annee ?? ''}`;
                if (pairesParBlueprint.get(k).length > 1) { r.reserve = 'variantes-un-blueprint'; lectures.reserveVariantes++; }
            }
        });
        const seriesParBlueprint = new Map();
        res.forEach((r, i) => { if (r.statut === 'apparie' && produits[i].famille === 'pp') (seriesParBlueprint.get(r.blueprint.id) || seriesParBlueprint.set(r.blueprint.id, new Set()).get(r.blueprint.id)).add(produits[i].serie); });
        lectures.partageEntreSeries = [...seriesParBlueprint.values()].filter(s => s.size > 1).length;
        const tableau = {};
        const ligne = g => tableau[g] || (tableau[g] = { famille: null, produits: 0, apparie: 0, ambigu: 0, introuvable: 0, refuseTemoin: 0, causes: {}, temoin: {}, avecVariante: 0 });
        res.forEach((r, i) => {
            const p = produits[i], t = ligne(p.groupe);
            t.famille = p.famille; t.produits++;
            if (p.variante) t.avecVariante++;
            const k = r.statut === 'refuse-temoin' ? 'refuseTemoin' : r.statut;
            t[k]++;
            if (r.cause) t.causes[`${r.statut}:${r.cause}`] = (t.causes[`${r.statut}:${r.cause}`] || 0) + 1;
            if (r.statut === 'apparie' || r.statut === 'refuse-temoin') t.temoin[r.temoin] = (t.temoin[r.temoin] || 0) + 1;
            if (r.statut === 'apparie') t.cles = { ...(t.cles || {}), [r.cle]: ((t.cles || {})[r.cle] || 0) + 1 };
        });
        const parFamille = {};
        for (const t of Object.values(tableau)) {
            const f = parFamille[t.famille] || (parFamille[t.famille] = { produits: 0, apparie: 0, ambigu: 0, introuvable: 0, refuseTemoin: 0 });
            for (const k of ['produits', 'apparie', 'ambigu', 'introuvable', 'refuseTemoin']) f[k] += t[k];
        }
        const apparies = res.filter(r => r.statut === 'apparie');
        const blueprintsAppariees = new Set(apparies.map(r => r.blueprint.id));
        const candidatsAmbigus = new Set(res.filter(r => r.statut === 'ambigu').flatMap(r => r.candidats));
        const partages = new Map();
        for (const r of apparies) partages.set(r.blueprint.id, (partages.get(r.blueprint.id) || 0) + 1);
        const nPartages = [...partages.values()].filter(n => n > 1).length;
        const requetesCollecte = { pagesBlueprint: blueprintsAppariees.size, images: blueprintsAppariees.size, total: 2 * blueprintsAppariees.size };
        const parSerieCroisee = {};
        const doc = {
            le: new Date().toISOString(),
            denominateurs: {
                numerosCartesCibles: ciblees.length, cartesCodeRetirees: cartesCode, produits: nonCode.length, servisDeja: servis.size, nonServis: nonServis.length,
                liensParProduit: { zero: nonServis.filter(p => !(liensDe.get(p.idProduct) || []).length).length, un: nonServis.filter(p => (liensDe.get(p.idProduct) || []).length === 1).length, plusieurs: nonServis.filter(p => (liensDe.get(p.idProduct) || []).length > 1).length },
                blueprintsLus: blueprints.length, blueprintsSingles: blueprints.filter(b => !b.type).length
            },
            parFamille, tableau, lectures,
            collecte: { ...requetesCollecte, secondes: requetesCollecte.total * CADENCE_S, heures: +(requetesCollecte.total * CADENCE_S / 3600).toFixed(2), blueprintsPartagesParPlusieursProduits: nPartages, blueprintsCandidatsDesAmbigus: candidatsAmbigus.size,
                note: 'L\'adresse de l\'image N\'EST PAS dans le sitemap (aucune balise image:loc) et le nom du fichier diffère du slug de la page (311538 : image « …2019-world-championships-promo-henry-brand… », page « …wcd-2019-henry-brand-071-236… ») : il faut lire la page HTML de chaque blueprint (1 requête) puis l\'image (1 requête).' },
            produits: produits.map((p, i) => ({ idProduct: p.idProduct, groupe: p.groupe, slug: p.slug, numeroCM: p.numeroCM, variante: p.variante, liens: p.liens, ...res[i], blueprint: res[i].blueprint ? res[i].blueprint.id : undefined, blueprintSlug: res[i].blueprint ? res[i].blueprint.slug : undefined, blueprintFinition: res[i].blueprint ? res[i].blueprint.finition : undefined }))
        };
        void parSerieCroisee;
        // l'échantillon : 12 appariements, 4 par famille, graine fixe
        const alea = prng(20261018);
        const echant = [];
        for (const f of ['wcd', 'pp', 'ba']) {
            const l = doc.produits.filter(x => x.statut === 'apparie' && x.groupe.startsWith(f === 'wcd' ? 'WCD' : f === 'pp' ? 'PP' : 'BA'));
            const pris = [];
            const copie = [...l];
            while (pris.length < 4 && copie.length) pris.push(copie.splice(Math.floor(alea() * copie.length), 1)[0]);
            for (const x of pris) echant.push({ famille: f, groupe: x.groupe, idProduct: x.idProduct, slugCardmarket: x.slug, blueprint: x.blueprint, pageCardTrader: `https://www.cardtrader.com/en-US/cards/${x.blueprint}-${x.blueprintSlug}`, adresseImage: null, temoin: x.temoin, preuve: x.preuve });
        }
        return { doc, echant };
    } finally { await fermer(); }
}

module.exports = { enumerer, plan, familleDeSlugSet, prng, UTILE, nbCache };

if (require.main === module) (async () => {
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`arguments refusés : ${inconnus.join(' ')} — aucune requête`); process.exitCode = 2; return; }
    const dossier = val('cache');
    if (!dossier) { console.error('--cache=<dossier> obligatoire'); process.exitCode = 2; return; }
    const sortie = val('sortie') || path.dirname(path.resolve(dossier));
    fs.mkdirSync(sortie, { recursive: true });
    if (val('sonder')) {
        const p = Number(val('plafond'));
        if (!p) { console.error('--plafond=<n> obligatoire'); process.exitCode = 2; return; }
        const { cli } = client(dossier, p);
        await cli.initialiserRobots();
        const r = await cli.lire(val('sonder'));
        console.log(`requêtes ce run : ${cli.requetes()} · HTTP ${r.status} ${r.type} cache=${r.cache} ${r.texte.length} caractères\n${r.texte.slice(0, 3000)}`);
        return;
    }
    if (args.includes('--enumerer')) {
        const p = Number(val('plafond'));
        if (!p) { console.error('--plafond=<n> obligatoire'); process.exitCode = 2; return; }
        const doc = await enumerer({ dossier, plafondTotal: p });
        fs.writeFileSync(path.join(sortie, 'enumeration.json'), JSON.stringify(doc, null, 1));
        const { blueprints, ...resume } = doc;
        console.log(JSON.stringify(resume, null, 1));
        return;
    }
    if (args.includes('--plan')) {
        const f = path.join(sortie, 'enumeration.json');
        if (!fs.existsSync(f)) { console.error(`${f} absent : lancer --enumerer d'abord`); process.exitCode = 2; return; }
        const enumeration = JSON.parse(fs.readFileSync(f, 'utf8'));
        const { doc, echant } = await plan({ enumeration });
        fs.writeFileSync(path.join(sortie, 'plan.json'), JSON.stringify(doc, null, 1));
        fs.writeFileSync(path.join(sortie, 'echantillon.json'), JSON.stringify(echant, null, 1));
        const { produits, ...resume } = doc;
        console.log(JSON.stringify(resume, null, 1));
        return;
    }
    console.error('un mode est obligatoire : --sonder, --enumerer ou --plan'); process.exitCode = 2;
})().catch(e => { console.error(`ÉCHEC : ${e.message}`); process.exitCode = 1; });

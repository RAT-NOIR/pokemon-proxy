// ============================================================
// AUDIT DE L'OCCIDENTAL — chaque carte sans visuel SERVI sur la page réelle d'un set international publié, dans UNE case
// ============================================================
//   node audit-occidental.mjs [--http-neuf] [--sets=Shining-Legends,EX-Holon-Phantoms]
//
// 🔴 LA DEMANDE (testeur, 2026-09-26 soir) : « Je vois encore des sets internationaux sans images et sans logo, et le worker
// ne tourne pas. Tu dis qu'il n'y a plus rien à collecter : c'est contradictoire. » L'alimentateur compte par SET et sur la
// BASE (`images.set`) ; le site sert par FICHE, à travers sa garde de langue. Ce qui manque se mesure là où l'utilisateur
// regarde : la page, toutes ses pages de 50.
//
// LECTURE SEULE : base `cartes`, archive R2 des pages de cartes (lecture), caches des sources (`tcgdex_sets`, `infosListe`
// Bulbapedia, documents `images` en échec) ; RÉSEAU : notre site seulement (cache 6 h, `--http-neuf` relit). AUCUNE requête
// à une source : ce qu'un cache ne tranche pas est « à confirmer », jamais c).
// UNE case par carte, dans cet ordre (la première qui s'applique) :
//   a-revalidation : la base porte une image que la garde du site ADMET pour cette fiche — la page est en retard
//   a-langue       : la base porte une image de langue NON TRANCHÉE, refusée par la garde (format non audité)
//   b-tcgdex       : TCGdex (cache) déclare le scan anglais de cette impression
//   b-bulbapedia   : la page de carte nomme un fichier présent sur l'archive Bulbagarden, ≥ seuil, pas au format japonais
//   b-a-confirmer  : une source nomme le fichier, sa présence n'a jamais été demandée (set TCGdex jamais lu, imageinfo absente)
//   c              : aucune source — la preuve de CHAQUE source interrogée, écrite
// Une image JAPONAISE prouvée (langue `ja`) n'est pas « l'image en base » d'une fiche occidentale : c'est l'autre tirage ;
// la fiche passe aux cases b/c, et la ligne le dit.
// Sorties : AUDIT-OCCIDENTAL.md (lecture), audit-occidental.json (une ligne par carte : la file et les preuves s'en servent).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const R = 'C:/Users/Yung/Desktop/pokemon-proxy', S = 'C:/Users/Yung/Desktop/rat-market-site', SITE = 'https://rat-market.fr';
const require = createRequire(`${R}/package.json`);
process.chdir(R);
require('dotenv').config({ path: `${R}/.env` });
const AUTORISES = [/^--http-neuf$/, /^--sets=[^\s]+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --http-neuf, --sets=A,B`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const site = async f => import(pathToFileURL(`${S}/lib/${f}`).href);
const { fichesDuDocument } = await site('impressionsDuSet.ts');
const { imageDeLImpression, normaliserNumero } = await site('imageDeLImpression.ts');
const { visuelAdmisPourLaRegion, formatDuFichierSource, FORMATS_ANGLAIS_AUDITES } = await site('langueDuVisuel.ts');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const { ligne } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');
const { fabriquerAppariement, setDeLaLigne } = require('./collecte-cartes/tcgdex-cache');
const { planifier } = require('./collecteur-images-tcgdex');
const { estDuSet } = require('./collecte-cartes/tcgdex');
const { estTentee } = require('./collecte-cartes/manque-reel');   // la règle de production, pas une copie
// le collecteur TCGdex (chargé ici) pose un écouteur SIGINT pour l'arrêt propre du worker : sans celui-ci, Ctrl+C n'arrêterait plus l'audit
process.on('SIGINT', () => { console.error('\n⛔ audit interrompu (Ctrl+C) — rien d\'écrit'); process.exit(130); });
const { resoudreSet } = require('./collecteur-images-bulba');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');

const HTTP_CACHE = `${R}/audit-occidental-http.json`;
const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
await r2.verifierBucket(process.env.R2_BUCKET_BRUT);   // la production l'appelle toujours d'abord (§52 : sans lui, 39 lectures « illisibles »)
const M = modeles(cx), db = cx.db;

// ── la population : les sets PUBLIÉS dont le tirage est occidental (`tirage ?? region`, CONTRAT-SITE : jamais `region` seule)
const tousSets = await db.collection('sets').find({}).toArray();
const voulus = arg('sets')?.split(',');
const population = tousSets.filter(s => typeof s.nomAffichage === 'string' && (s.tirage ?? s.region) === 'intl' && (!voulus || voulus.includes(s._id) || voulus.includes(s.code)));
console.log(`DÉNOMINATEUR : ${tousSets.length} sets en base · ${tousSets.filter(s => typeof s.nomAffichage === 'string').length} publiés · ${population.length} publiés au tirage occidental`);
if (!population.length) throw new Error('aucun set occidental publié — la population est vide, je ne conclus rien');

// ── HTTP : toutes les pages de chaque set, telles que le site les sert
const cache = fs.existsSync(HTTP_CACHE) ? JSON.parse(fs.readFileSync(HTTP_CACHE, 'utf8')) : {};
// une redirection lue sans sa destination (cache antérieur au 2026-09-26 19:30) se relit : c'est la destination qui dit où la fiche est servie
// une page en ÉCHEC (code ni 200 ni redirection, ou une page 2..N illisible) se relit aussi : garder un échec six heures, c'est le compter six heures
const frais = e => e && !process.argv.includes('--http-neuf') && Date.now() - e.le < 6 * 3600 * 1000 && !(/^3\d\d$/.test(String(e.code)) && !e.redirige)
    && (e.code === 200 || /^3\d\d$/.test(String(e.code))) && !(e.cartes || []).some(c => c.erreurPage);
let requetes = 0;
async function lire(url) {
    for (let essai = 0; essai < 2; essai++) {
        try { requetes++; const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(45000) }); return { code: r.status, texte: r.status === 200 ? await r.text() : null, location: r.headers.get('location') }; }
        catch (e) { if (essai) return { code: `erreur ${e.name}`, texte: null }; await new Promise(r => setTimeout(r, 3000)); }
    }
}
function lirePage(t) {
    const cartes = [];
    for (const m of t.matchAll(/<a class="group block[^"]*" href="(\/fr\/sets\/[^"]+)">([\s\S]*?)<\/a>/g)) {
        const inner = m[2];
        const numero = (/<span class="text-zinc-400">([^<]*)<!-- --> · <\/span>/.exec(inner) || [])[1] ?? null;
        cartes.push({ href: decodeURIComponent(m[1]), numero, sans: /Visuel non disponible/.test(inner), img: /<img\b/.test(inner) });
    }
    return cartes;
}
async function pagesDuSet(slug) {
    if (frais(cache[slug])) return cache[slug];
    const p1 = await lire(`${SITE}/fr/sets/${encodeURIComponent(slug)}`);
    if (!p1.texte) return (cache[slug] = { code: p1.code, le: Date.now(), cartes: [], ...(p1.location ? { redirige: p1.location } : {}) });
    const t1 = p1.texte, nu = t1.replace(/<!-- -->/g, '');   // React sépare les morceaux de texte par <!-- --> ; la légende de vignette, elle, le garde
    const total = Number((/(\d+) cartes? au catalogue/.exec(nu) || [])[1] ?? NaN);
    const phrase = /(\d+) sur (\d+) sans visuel/.exec(nu);
    if (!Number.isFinite(total)) throw new Error(`${slug} : « N cartes au catalogue » introuvable sur la page — la page a changé de forme, le nombre de pages ne se lit plus`);
    const cartes = lirePage(t1);
    const nPages = Number.isFinite(total) ? Math.max(1, Math.ceil(total / 50)) : 1;
    for (let p = 2; p <= nPages; p++) {
        const r = await lire(`${SITE}/fr/sets/${encodeURIComponent(slug)}/page/${p}`);
        if (!r.texte) { cartes.push({ erreurPage: p, code: r.code }); continue; }
        cartes.push(...lirePage(r.texte));
    }
    return (cache[slug] = { code: p1.code, le: Date.now(), total, sansAnnonce: phrase ? Number(phrase[1]) : 0, nPages, cartes });
}
for (let i = 0; i < population.length; i += 3) await Promise.all(population.slice(i, i + 3).map(s => pagesDuSet(s._id)));
fs.writeFileSync(HTTP_CACHE, JSON.stringify(cache));

// ── la base : les fiches de chaque set, comme le site les calcule (fichesDuDocument, clé `set.region`)
const liste = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets || [];
const listeLue = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }, { projection: { lu: 1 } }))?.lu;
if (!liste.length) throw new Error('liste TCGdex absente du cache — la case TCGdex ne peut pas se juger');
const apparier = fabriquerAppariement(liste);
const slugDe = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// \ud83d\udd11 LES SETS QUE TCGdex PORTE SOUS UN AUTRE D\u00c9COUPAGE (2026-09-26, soir). La production (`setDeLaLigne`) apparie par l'\u00c9GALIT\u00c9
// du nom et ne les voit pas : Bulbapedia \u00e9crit \u00ab Platinum: Arceus \u00bb, TCGdex \u00ab Arceus \u00bb ; un Trainer Kit est UNE expansion chez
// Bulbapedia et DEUX demi-decks chez TCGdex ; le Shiny Vault de Hidden Fates est un set TCGdex \u00e0 part. Premi\u00e8re version de
// l'audit : ces cartes rang\u00e9es en c) avec \u00ab aucun set TCGdex ne s'appelle \u2026 \u00bb \u2014 le \u00a730, un vide d'orthographe pris pour une
// absence. Chaque id est LU dans la liste \u00e9num\u00e9r\u00e9e (220 sets, en cache), jamais suppos\u00e9 ; `idsAbsentsDeLaListe` le v\u00e9rifie.
const AUTRES_TCGDEX = {
    'Platinum: Arceus': ['pl4'],
    'Hidden Fates': ['sma'],
    'EX Trainer Kit': ['tk-ex-latia', 'tk-ex-latio'],
    'HS Trainer Kit': ['tk-hs-r', 'tk-hs-g'],
    'Black & White Trainer Kit': ['tk-bw-e', 'tk-bw-z'],
    'XY Trainer Kit': ['tk-xy-n', 'tk-xy-sy'],
    'XY Trainer Kit: Bisharp & Wigglytuff': ['tk-xy-b', 'tk-xy-w'],
    'XY Trainer Kit: Latias & Latios': ['tk-xy-latia', 'tk-xy-latio'],
    'XY Trainer Kit: Pikachu Libre & Suicune': ['tk-xy-p', 'tk-xy-su'],
    'Sun & Moon Trainer Kit: Lycanroc & Alolan Raichu': ['tk-sm-l', 'tk-sm-r']
};
const idsListe = new Set(liste.map(s => s.id));
const idsAbsentsDeLaListe = Object.values(AUTRES_TCGDEX).flat().filter(id => !idsListe.has(id));
if (idsAbsentsDeLaListe.length) throw new Error(`AUTRES_TCGDEX nomme des sets absents de la liste TCGdex : ${idsAbsentsDeLaListe.join(', ')}`);
// Les sets de r\u00e9impressions SANS ligne de table (WCD, SEA) : \u00ab une page de carte d\u00e9clare-t-elle ce tirage ? \u00bb se pose sur TOUTE la
// base, par le mot que BULBAPEDIA emploie \u2014 jamais celui de Cardmarket (\u00a730 : \u00ab WCD-2010 \u00bb n'est pas un titre Bulbapedia). Ce n'est
// une preuve que si le compte est Z\u00c9RO ; sinon la case est \u00ab \u00e0 confirmer \u00bb.
const FAMILLES_SANS_LIGNE = [{ re: /^WCD\d/, mot: 'World Championships' }, { re: /^SEA$/, mot: 'Southeast Asia' }];
const nbCartesBase = await db.collection('cartes').countDocuments({});
for (const F of FAMILLES_SANS_LIGNE) {
    F.intl = await db.collection('cartes').countDocuments({ impressions: { $elemMatch: { tirage: 'intl', expansion: new RegExp(F.mot, 'i') } } });
    F.tous = await db.collection('cartes').countDocuments({ 'impressions.expansion': new RegExp(F.mot, 'i') });
    const mots = F.mot.toLowerCase().split(/\s+/);
    F.tcgdex = liste.filter(s => mots.some(m => s.name.toLowerCase().includes(m))).map(s => s.id);
    F.preuveBulba = `Bulbapedia : ${F.intl} des ${nbCartesBase} pages de carte archiv\u00e9es d\u00e9clare(nt) une impression occidentale \u00ab ${F.mot} \u00bb (${F.tous} tous tirages confondus)`;
    F.preuveTcgdex = `TCGdex : ${F.tcgdex.length ? `\u00ab ${F.mot} \u00bb : ${F.tcgdex.join(', ')}` : `aucun des ${liste.length} sets de la liste \u00e9num\u00e9r\u00e9e ne porte ${mots.map(m => `\u00ab ${m} \u00bb`).join(' ni ')} dans son nom`}`;
}
const familleDe = set => FAMILLES_SANS_LIGNE.find(F => F.re.test(set.code)) || null;
const nomNu = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const numNu = n => normaliserNumero(n);
const setsServisAilleurs = [];

const lignes = [], parSet = [];
for (const set of population) {
    const slug = set._id, H = cache[slug];
    // Une page qui REDIRIGE vers un autre set (les Additionals → « <parent>#additionals ») n'a pas de fiche à elle : ses lignes
    // renvoient aux fiches du parent (« mêmes cartes, mêmes numéros »), dont les visuels se comptent sur la page du parent.
    // Toute autre redirection ARRÊTE l'audit : je ne sais pas où ses fiches sont servies.
    if (/^3\d\d$/.test(String(H?.code))) {
        if (!/^\/fr\/sets\/[^/#?]+#/.test(H.redirige || '')) throw new Error(`${slug} : HTTP ${H.code} vers « ${H.redirige} » — redirection que je ne sais pas lire`);
        const n = await db.collection('cartes').countDocuments({ sets: slug });
        setsServisAilleurs.push({ slug, code: set.code, redirige: H.redirige, cartes: n });
        parSet.push({ slug, code: set.code, nom: set.nomAffichage, http: H.code, redirige: H.redirige, fiches: 0, cartesPage: 0, sansVisuel: 0, orphelinesPage: 0, orphelinesSans: 0, absentesDeLaPage: 0, servieMaisPasEnBase: 0, compte: {}, logo: !!set.logo, logoRefus: set.logoRefus ?? null, servieAilleurs: true });
        continue;
    }
    const exps = new Set([].concat(set.bulba?.expansion ?? []));
    const PROJ = { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, images: 1 };
    const docs = await db.collection('cartes').find({ sets: slug }, { projection: PROJ }).toArray();
    const fiches = [];
    for (const d of docs) {
        if (!d.nomEn) continue;
        const fs_ = fichesDuDocument((d.impressions ?? []).filter(i => i.tirage === set.region && exps.has(i.expansion)));
        const imgsSet = (d.images ?? []).filter(m => m.set === slug);
        for (const f of fs_) {
            const admis = imageDeLImpression(imgsSet.filter(m => visuelAdmisPourLaRegion(m, set.region)), f.numero);
            const toute = imageDeLImpression(imgsSet, f.numero);
            fiches.push({ carteId: d._id, nomEn: d.nomEn, numero: f.numero, admis, toute });
        }
    }
    // appariement page ↔ fiche : par numéro, puis par le nom quand un numéro en porte plusieurs
    const parNum = new Map(); for (const f of fiches) { const k = normaliserNumero(f.numero) ?? '∅'; (parNum.get(k) || parNum.set(k, []).get(k)).push(f); }
    const httpCartes = (H?.cartes || []).filter(c => c.href);
    const vues = new Set(), orphelinesPage = [];
    const servie = new Map();   // fiche → servie sur la page ?
    for (const c of httpCartes) {
        const cands = (parNum.get(normaliserNumero(c.numero) ?? '∅') || []).filter(f => !vues.has(f));
        let f = cands.length === 1 ? cands[0] : cands.find(x => c.href.endsWith(`-${slugDe(x.nomEn)}`)) || null;
        if (!f) { orphelinesPage.push(c); continue; }
        vues.add(f); servie.set(f, !c.sans);
    }
    // Une vignette dont le lien finit par l'idProduct est une fiche PRODUIT (réimpressions — Prize Packs, WCD, Battle Academy… —
    // et produits sans numéro). Elle se désigne par `cartes_produits`, jamais par le nom : PPS1 porte deux « Altaria » (482089,
    // 687666). Première version : 2 517 vignettes « sans fiche », dont 2 477 de ces sets — l'appariement par le nom ne mord pas.
    const idDe = c => Number((/-(\d{4,})$/.exec(c.href) || [])[1]) || null;
    const parId = new Map();
    const idsOrph = orphelinesPage.map(idDe).filter(Boolean);
    if (idsOrph.length) for (const p of await db.collection('cartes_produits').find({ idProduct: { $in: idsOrph } }, { projection: { idProduct: 1, carteId: 1, numeroFiche: 1, 'visuelSubstitut.cleR2': 1 } }).toArray())
        (parId.get(p.idProduct) || parId.set(p.idProduct, []).get(p.idProduct)).push(p);
    const docsParId = new Map(docs.map(d => [d._id, d]));
    const fichesProduit = [], couvertes = new Set(), orphelinesRestantes = [];
    let avecSubstitut = null;   // les cartes de CE set dont un produit porte un visuel de substitution (lu une fois, au besoin)
    // 🔴 L'id du lien n'est PAS le produit de ce set : c'est `liens.idProduct[0]` de la CARTE (site, lib/cartes.ts,
    // slugCarteDansSet), tous sets confondus — « air-balloon-869792 » sur PPS1 est un produit d'Ascended Heroes. Il ne sert
    // qu'à désigner la CARTE ; la fiche est la sienne dans CE set (numéro nul pour une réimpression), et le substitut se lit
    // sur les produits de la carte DANS ce set.
    for (const c of orphelinesPage) {
        const id = idDe(c), ps = id ? parId.get(id) : null;
        if (!ps || ps.length !== 1) { orphelinesRestantes.push({ href: c.href, sans: c.sans, motif: !id ? 'lien sans idProduct' : !ps ? 'idProduct absent de cartes_produits' : `idProduct porté par ${ps.length} lignes` }); continue; }
        const carteId = ps[0].carteId;
        let f = fiches.find(g => g.carteId === carteId && !vues.has(g) && !couvertes.has(g));
        if (f) couvertes.add(f);
        else {
            const d = docsParId.get(carteId) ?? await db.collection('cartes').findOne({ _id: carteId }, { projection: PROJ });
            if (!d) { orphelinesRestantes.push({ href: c.href, sans: c.sans, motif: `carte ${carteId} absente de la base` }); continue; }
            const imgsSet = (d.images ?? []).filter(m => m.set === slug);
            f = { carteId: d._id, nomEn: d.nomEn, numero: null, admis: imageDeLImpression(imgsSet.filter(m => visuelAdmisPourLaRegion(m, set.region)), null), toute: imageDeLImpression(imgsSet, null) };
        }
        f.idProduct = id;
        f.substitut = (avecSubstitut ??= new Set((await db.collection('cartes_produits').find({ slugSet: slug, 'visuelSubstitut.cleR2': { $type: 'string' } }, { projection: { carteId: 1 } }).toArray()).map(p => p.carteId))).has(carteId);
        fichesProduit.push(f); servie.set(f, !c.sans);
    }
    const absentesDeLaPage = fiches.filter(f => !vues.has(f) && !couvertes.has(f));
    const sansVisuel = [...fiches.filter(f => vues.has(f) && !servie.get(f)), ...fichesProduit.filter(f => !servie.get(f))];
    const servieMaisPasEnBase = [...fiches.filter(f => vues.has(f)), ...fichesProduit].filter(f => servie.get(f) && !f.admis).length;
    // ── les sources, seulement si une fiche en a besoin
    const L = ligne(set.code);
    const besoin = sansVisuel.filter(f => !f.admis && !(f.toute && f.toute.langue !== 'ja'));
    let P = null, tcgMotif = null, Rb = null, bulbaMotif = null, infos = new Map(), echecsTcg = new Map();
    let tcgAlt = [], altLus = [], altNonLus = [], sansLigne = null;
    if (besoin.length) {
        if (!L) { sansLigne = familleDe(set); tcgMotif = sansLigne?.preuveTcgdex ?? null; bulbaMotif = sansLigne?.preuveBulba ?? null; }
        else {
            const d = setDeLaLigne(L, apparier);
            if (!d.set) tcgMotif = `TCGdex : ${d.motif} (liste énumérée, ${liste.length} sets, lue le ${listeLue ? new Date(listeLue).toISOString().slice(0, 10) : '?'})`;
            else {
                P = await planifier(M, db, null, L, d.set);
                if (!P) tcgMotif = `TCGdex ${d.set.id} « ${d.set.name} » (${d.set.cardCount ?? '?'} cartes) : cartes jamais lues (cache vide)`;
            }
            const altIds = [...new Set([].concat(L.bulba?.expansion || []).flatMap(n => AUTRES_TCGDEX[n] || []))];
            if (altIds.length) {
                const lus = await db.collection('tcgdex_sets').find({ _id: { $in: altIds.map(id => `en/${id}`) } }, { projection: { cartes: 1 } }).toArray();
                altLus = lus.filter(x => x.cartes?.length).map(x => x._id.slice(3));
                altNonLus = altIds.filter(id => !altLus.includes(id));
                tcgAlt = lus.flatMap(x => (x.cartes || []).filter(c => estDuSet(x._id.slice(3), c)));
            }
            if (sourceDe(L.code)) bulbaMotif = 'set servi par artofpkm (japonais)';
            else if (!L.bulba?.expansion) bulbaMotif = 'Bulbapedia : la ligne ne nomme aucune expansion — aucune page de carte ne déclare ce tirage';
            else {
                Rb = await resoudreSet(M, L);
                const e = await db.collection('collecte_images_etat').findOne({ _id: `bulbapedia/${slug}` }, { projection: { infosListe: 1 } });
                infos = new Map((e?.infosListe || []).map(x => [x.fichier, x]));
            }
            for (const im of await db.collection('images').find({ source: 'tcgdex', set: slug, etat: { $in: ['echec', 'trop-petit'] } }, { projection: { carteId: 1, numero: 1, etat: 1, erreur: 1, wOriginal: 1, urlOriginal: 1 } }).toArray())
                echecsTcg.set(`${im.carteId}|${normaliserNumero(im.numero)}`, im);
        }
    }
    const cle = (id, n) => `${id}|${normaliserNumero(n)}`;
    const tcgPlan = new Map((P?.plan || []).map(p => [cle(p.carte._id, p.numero), p]));
    const tcgReste = new Map((P?.restes || []).map(p => [cle(p.carteId, p.numero), p]));
    const bPlan = new Map((Rb?.plan || []).map(p => [cle(p.carteId, p.numero), p]));
    const bAutre = new Map((Rb?.autres || []).map(p => [cle(p.carteId, p.numero), p]));
    // l'autre découpage TCGdex : la carte se désigne par le numéro ET le nom (témoin) ; deux candidats au même nom ne désignent rien
    const altDe = f => {
        if (!tcgAlt.length) return null;
        const n = numNu(f.numero);
        if (!n) return { motif: `fiche sans numéro (TCGdex ${altLus.join(', ')})` };
        const cands = tcgAlt.filter(t => numNu(t.localId) === n), memeNom = cands.filter(t => nomNu(t.name) === nomNu(f.nomEn));
        if (memeNom.length === 1) return { t: memeNom[0] };
        if (memeNom.length > 1) return { motif: `n°${f.numero} au même nom dans ${memeNom.map(t => t.id).join(', ')} : ne désigne rien`, ambigu: true, avecImage: memeNom.some(t => t.image) };
        return { motif: cands.length ? `n°${f.numero} chez TCGdex : ${cands.map(t => `${t.id} « ${t.name} »`).join(', ')} — le nom contredit` : `n°${f.numero} absent de ${altLus.join(', ')}` };
    };
    const tcgSansImage = f => (P?.tcg || []).filter(t => !t.image && numNu(t.localId) === numNu(f.numero)).map(t => t.id);
    // 🔴 revue du 2026-09-26 : le collecteur Bulbapedia refuse le SET entier quand la largeur MÉDIANE de son plan est sous le seuil
    // (collecteur-images-bulba.js:158-168, mêmes entrées : `R.plan` et le cache `infosListe`). Un fichier assez large dans un set
    // refusé ne sera jamais collecté par cette route : ce n'est pas un b).
    const largeursB = (Rb?.plan || []).map(p => infos.get(p.fichier)?.w).filter(Boolean).sort((a, b) => a - b);
    const medianeB = largeursB[Math.floor(largeursB.length / 2)] ?? null;
    const setBulbaRefuse = !!Rb && largeursB.length > 0 && medianeB < LARGEUR_MIN;
    const compte = {};
    for (const f of sansVisuel) {
        const k = cle(f.carteId, f.numero);
        let cas, detail = '', preuves = [], horsRoute = false, tcgdexVerif = [];
        if (f.admis) { cas = 'a-revalidation'; detail = `base : ${f.admis.cleR2}`; }
        else if (f.toute && f.toute.langue !== 'ja') { cas = 'a-langue'; detail = `${f.toute.cleR2} · langue ${f.toute.langue ?? 'null'} · format ${formatDuFichierSource(f.toute.languePreuve) ?? 'inconnu'}${tcgPlan.has(k) ? ' · TCGdex a aussi le scan anglais' : ''}`; }
        else {
            const jp = f.toute?.langue === 'ja' ? `image en base JAPONAISE prouvée (${f.toute.cleR2}) — l'autre tirage · ` : '';
            const t = tcgPlan.get(k), b = bPlan.get(k), inf = b ? infos.get(b.fichier) : null;
            const alt = t ? null : altDe(f);
            const bLangue = inf && !inf.absent ? langueDuVisuel({ source: 'bulbapedia', wOriginal: inf.w, hOriginal: inf.h }) : null;
            // 🔴 revue du 2026-09-26 : une impression du plan DÉJÀ tentée avec un verdict (404, trop-petit) n'est pas un b) — la
            // production ne la redemandera pas (manque-reel.js, `estTentee`) ; un échec PASSAGER l'est : le manque la reprend
            const et = t ? echecsTcg.get(k) : null, definitif = !!et && estTentee(et);
            if (t && !definitif) { cas = 'b-tcgdex'; detail = `${jp}${t.tcg.id} ${t.tcg.image}/high.png${et ? ` — échec passager (${et.erreur}) : dans le manque réel, repris au plus une fois par clé et 3 fois par version` : ''}`; }
            else if (alt?.t?.image) { cas = 'b-tcgdex'; horsRoute = true; detail = `${jp}${alt.t.id} ${alt.t.image}/high.png — set TCGdex d'un autre découpage : la production ne l'apparie pas encore`; }
            else if (!t && !alt?.t && altNonLus.length) { cas = 'b-a-confirmer'; detail = `${jp}TCGdex porte ${altNonLus.join(', ')} (liste énumérée) : cartes jamais lues`; }
            // TCGdex a UNE image pour ce numéro et ce nom, mais sous plusieurs cartes : la source existe, la désignation reste à faire
            else if (alt?.ambigu && alt.avecImage) { cas = 'b-a-confirmer'; detail = `${jp}${alt.motif} — une image existe chez TCGdex, la désignation reste à faire`; }
            // une galerie compagnon jamais lue : le reste est NON MESURÉ (collecteur-images-tcgdex.js), jamais une absence
            else if (/NON MESURÉ/.test(tcgReste.get(k)?.motif || '')) { cas = 'b-a-confirmer'; detail = `${jp}TCGdex : ${tcgReste.get(k).motif}`; }
            else if (b && inf && !inf.absent && inf.w >= LARGEUR_MIN && bLangue?.langue !== 'ja' && !setBulbaRefuse) {
                cas = 'b-bulbapedia'; const fmt = `${inf.w}×${inf.h}`;
                detail = `${jp}${b.fichier} ${fmt} — ${FORMATS_ANGLAIS_AUDITES.has(fmt) ? 'format audité anglais : sera servi' : 'format NON audité : tombera en a-langue tant que le site ne l\'a pas regardé'}`;
            }
            else if (b && !inf) { cas = 'b-a-confirmer'; detail = `${jp}Bulbapedia nomme ${b.fichier}, imageinfo jamais demandée`; }
            else if (!P && tcgMotif && /jamais lues/.test(tcgMotif)) { cas = 'b-a-confirmer'; detail = `${jp}${tcgMotif}`; }
            else if (!L && (!sansLigne || sansLigne.intl || sansLigne.tcgdex.length)) { cas = 'b-a-confirmer'; detail = sansLigne ? `${sansLigne.preuveBulba} · ${sansLigne.preuveTcgdex}` : `aucune ligne de table pour ${set.code} : aucune source interrogée`; }
            else {
                cas = 'c';
                const r = tcgReste.get(k), e = echecsTcg.get(k);
                if (alt?.t) tcgdexVerif = [alt.t.id];
                else if (r?.motif === 'tcgdex-sans-image') tcgdexVerif = tcgSansImage(f);
                preuves.push(e ? `TCGdex : ${e.etat === 'trop-petit' ? `fichier ${e.wOriginal} px < ${LARGEUR_MIN}` : `téléchargement en échec (${e.erreur})`} — ${e.urlOriginal}`
                    : alt ? `TCGdex (${altLus.join(', ')}) : ${alt.t ? `${alt.t.id} sans image dans l'API` : alt.motif}`
                    : r ? `TCGdex : ${r.motif}${r.detail ? ` (${r.detail})` : ''}` : tcgMotif ? tcgMotif : 'TCGdex : impression non appariée');
                const a = bAutre.get(k);
                preuves.push(bulbaMotif ? bulbaMotif
                    : b ? (inf?.absent ? `Bulbapedia : ${b.fichier} nommé par la page, ABSENT de l'archive (imageinfo)` : bLangue?.langue === 'ja' ? `Bulbapedia : ${b.fichier} ${inf.w}×${inf.h}, format du scanner JAPONAIS` : inf?.w >= LARGEUR_MIN && setBulbaRefuse ? `Bulbapedia : ${b.fichier} ${inf.w} px, mais le SET est refusé sur sa médiane (${medianeB} px < ${LARGEUR_MIN}, ${largeursB.length} fichiers mesurés)` : `Bulbapedia : ${b.fichier} ${inf.w} px < ${LARGEUR_MIN}`)
                    : a ? `Bulbapedia : page de carte, aucun fichier pour ce tirage (${a.classe}${a.candidats?.length ? ` ; fichiers du set : ${a.candidats.slice(0, 3).join(', ')}` : ''})`
                    : Rb ? 'Bulbapedia : la page de la carte ne déclare pas cette impression (ou aucun wikitext archivé)' : 'Bulbapedia : non résolu');
                detail = jp.replace(/ · $/, '');
            }
        }
        compte[cas] = (compte[cas] || 0) + 1;
        lignes.push({ set: slug, code: set.code, nomSet: set.nomAffichage, carteId: f.carteId, nomEn: f.nomEn, numero: f.numero, cas, detail, preuves,
            ...(f.idProduct ? { idProduct: f.idProduct, substitut: f.substitut } : {}), ...(horsRoute ? { horsRoute } : {}), ...(tcgdexVerif.length ? { tcgdexVerif } : {}) });
    }
    parSet.push({ slug, code: set.code, nom: set.nomAffichage, http: H?.code, pages: H?.nPages, total: H?.total, sansAnnonce: H?.sansAnnonce ?? null, fiches: fiches.length, fichesProduit: fichesProduit.length, cartesPage: httpCartes.length, sansVisuel: sansVisuel.length,
        orphelinesPage: orphelinesRestantes.length, orphelinesSans: orphelinesRestantes.filter(c => c.sans).length, orphelines: orphelinesRestantes.slice(0, 8), absentesDeLaPage: absentesDeLaPage.length, servieMaisPasEnBase, compte, logo: !!set.logo, logoRefus: set.logoRefus ?? null,
        erreursPages: (H?.cartes || []).filter(c => c.erreurPage).map(c => `page ${c.erreurPage} : ${c.code}`) });
    process.stdout.write(`\r${parSet.length}/${population.length} sets · ${lignes.length} cartes sans visuel · ${requetes} requêtes HTTP   `);
}
console.log();

// ── totaux
const tot = {}; for (const l of lignes) tot[l.cas] = (tot[l.cas] || 0) + 1;
const somme = k => parSet.reduce((s, x) => s + (x[k] || 0), 0);
console.log(`\nPAGES : ${parSet.length} sets, ${somme('cartesPage')} cartes lues sur les pages (${somme('fiches')} fiches calculées en base) · ${somme('sansVisuel')} sans visuel servi · annoncé par les pages : ${somme('sansAnnonce')}`);
console.log(`   fiches PRODUIT (lien à idProduct, via cartes_produits) : ${somme('fichesProduit')} · cartes de la page sans fiche en base : ${somme('orphelinesPage')} (dont sans visuel ${somme('orphelinesSans')}) · fiches en base absentes de la page : ${somme('absentesDeLaPage')} · servies sans image admise en base : ${somme('servieMaisPasEnBase')}`);
console.log(`   sets servis par une autre page (redirection) : ${setsServisAilleurs.length} — ${setsServisAilleurs.map(s => `${s.code} → ${s.redirige}`).join(', ')}`);
// 🔑 LA RÉCONCILIATION : ce que les pages ANNONCENT sans visuel = ce que j'ai classé + ce que je n'ai pas su apparier. Un écart ARRÊTE.
const annonce = somme('sansAnnonce'), classe = somme('sansVisuel'), nonApparie = somme('orphelinesSans');
// 🔴 revue du 2026-09-26 : une page 1 en échec annonce 0 et classe 0 — l'égalité devient une TAUTOLOGIE pour ce set (§21 n°8).
// Un set dont une page n'a pas été lue rend la réconciliation NON CONCLUANTE, et il se nomme.
const enEchec = parSet.filter(s => !s.servieAilleurs && (s.http !== 200 || s.erreursPages?.length));
if (enEchec.length) console.log(`🔴 PAGES NON LUES : ${enEchec.length} set(s) — ${enEchec.map(s => `${s.code} (${s.http !== 200 ? `page 1 : ${s.http}` : s.erreursPages.join(', ')})`).join(' · ')}`);
console.log(`RÉCONCILIATION : annoncé par les pages ${annonce} = classé ${classe} + vignettes sans fiche ${nonApparie} → ${enEchec.length ? `🔴 NON CONCLUANTE (${enEchec.length} set(s) aux pages non lues)` : annonce === classe + nonApparie ? '✅' : `🔴 ÉCART ${annonce - classe - nonApparie}`}`);
console.log(`CASES : ${JSON.stringify(tot)} · dont b-tcgdex hors route de production ${lignes.filter(l => l.horsRoute).length} · fiches produit à substitut ${lignes.filter(l => l.substitut).length}`);
const pire = [...parSet].sort((a, b) => b.sansVisuel - a.sansVisuel).slice(0, 20);
console.log('\n20 sets occidentaux les plus touchés :');
for (const s of pire) console.log(`   ${s.code.padEnd(8)} ${s.slug.padEnd(34)} ${String(s.sansVisuel).padStart(4)}/${String(s.fiches).padStart(4)} sans visuel · page ${s.http} « ${s.sansAnnonce} sans visuel » · ${JSON.stringify(s.compte)}${s.absentesDeLaPage ? ` · ${s.absentesDeLaPage} fiches absentes de la page` : ''}`);
fs.writeFileSync(`${R}/audit-occidental.json`, JSON.stringify({ genere: new Date().toISOString(), requetesHttp: requetes, totaux: tot, reconciliation: { annonce, classe, nonApparie, pagesNonLues: enEchec.map(s => s.code) }, setsServisAilleurs, sets: parSet, cartes: lignes }, null, 1));
console.log(`\nécrit : audit-occidental.json · requêtes HTTP (notre site) ${requetes} · requêtes aux sources : 0`);
await fermer();

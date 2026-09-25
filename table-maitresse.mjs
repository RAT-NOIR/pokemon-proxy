// ============================================================
// LA TABLE MAÎTRESSE — une ligne par EXPANSION de l'export Cardmarket, relançable, écrite dans TABLE-MAITRESSE.md
// ============================================================
//   node table-maitresse.mjs [--export=products_singles_24092026.json] [--http-neuf]
//
// 🔴 POURQUOI (testeur, 2026-09-25) : des sets ENTIERS et récents manquaient pendant qu'on mesurait par produit. Un taux
// global de 78 % cache une expansion à 0 % : l'unité de travail est l'EXPANSION, et la table se lit par le haut.
//
// LECTURE SEULE en base (production `test` en lecture, `cartes`) ; RÉSEAU : notre propre site, rat-market.fr — la liste
// /fr/sets une fois, et la page /fr/sets/<set> de chaque set publié, en cache 6 h (table-maitresse-http.json) pour ne pas
// marteler le site à chaque fin de lot (`--http-neuf` force la relecture).
// « Servi » = la règle du SITE importée telle quelle (lib/*.ts), comme t-tableau et mesurer-taux-servis.mjs du site.
//
// VERDICT : VERTE = set publié, page en 200, présent dans /fr/sets, logo posé (ou sans source légale), et AUCUN produit
// manquant BLOQUANT. Ne bloquent pas, et sont marqués « sans source légale » : les visuels des tirages chinois, indonésien et
// thaï (§42, §56 : CGU TPC Asie, pokemon.cn ; TCGdex japonais seul) ; les fiches dont la Setlist ne liste que des liens rouges
// (§43 : aucune page chez Bulbapedia) ; les versions V1/V2 inégales (§7 : Cardmarket ne dit pas laquelle manque).
// TRI : manquants bloquants × récence (année − 1995), les rouges d'abord.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const R = 'C:/Users/Yung/Desktop/pokemon-proxy', S = 'C:/Users/Yung/Desktop/rat-market-site', SITE = 'https://rat-market.fr';
const require = createRequire(`${R}/package.json`);
process.chdir(R);
require('dotenv').config({ path: `${R}/.env` });
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const EXPORT = arg('export') || 'products_singles_24092026.json';
const HTTP_CACHE = `${R}/table-maitresse-http.json`, ETAT = `${R}/table-maitresse.json`, SORTIE = `${R}/TABLE-MAITRESSE.md`;
const site = async f => import(pathToFileURL(`${S}/lib/${f}`).href);
const { produitsDeLaFiche, slugPorteUnNumero } = await site('cardmarket.ts');
const { fichesDuDocument } = await site('impressionsDuSet.ts');
const { imageDeLImpression } = await site('imageDeLImpression.ts');
const { visuelAdmisPourLaRegion } = await site('langueDuVisuel.ts');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');
const estCarteCode = nom => /\b(online|live)\s+code\s+card\b/i.test(String(nom || ''));   // mesure-catalogue.js:24

// ── l'export : produits (hors cartes-code) et année par expansion
const ex = JSON.parse(fs.readFileSync(`${R}/${EXPORT}`, 'utf8'));
const produits = ex.products.filter(p => !estCarteCode(p.name));
const parExp = new Map();
for (const p of produits) {
    const e = parExp.get(p.idExpansion) || parExp.set(p.idExpansion, { idExpansion: p.idExpansion, produits: [], annee: null }).get(p.idExpansion);
    e.produits.push(p.idProduct);
    const y = /^(\d{4})-/.exec(p.dateAdded || '')?.[1];
    if (y && y !== '0000' && (!e.annee || Number(y) < e.annee)) e.annee = Number(y);
}
const dates = [...parExp.values()].filter(e => e.annee).sort((a, b) => a.idExpansion - b.idExpansion);
for (const e of parExp.values()) if (!e.annee) {
    let best = null; for (const d of dates) if (!best || Math.abs(d.idExpansion - e.idExpansion) < Math.abs(best.idExpansion - e.idExpansion)) best = d;
    e.annee = best?.annee ?? 2010; e.anneeEstimee = true;
}

const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
const NC = new Map((await prod.db.collection('numeros_cartes').find({}, { projection: { idProduct: 1, slugSet: 1, slug: 1, codeSet: 1, idExpansion: 1 } }).toArray()).map(n => [n.idProduct, n]));
const regionCodes = new Map((await prod.db.collection('codes_set').find({}, { projection: { codeSet: 1, region: 1 } }).toArray()).map(c => [c.codeSet, c.region]));
const setsDocs = await cx.db.collection('sets').find({}).toArray();
const sets = new Map(setsDocs.map(s => [s._id, { ...s, publie: typeof s.nomAffichage === 'string', exps: new Set([].concat(s.bulba?.expansion ?? [])) }]));
const docs = new Map(); for await (const d of cx.db.collection('cartes').find({}, { projection: { sets: 1, impressions: 1, images: 1, nomEn: 1 } })) docs.set(d._id, d);
const lignesJ = await cx.db.collection('cartes_produits').find({}, { projection: { carteId: 1, slugSet: 1, slug: 1, idProduct: 1 } }).toArray();
const resteDe = new Map(); for (const r of await cx.db.collection('restes').find({ idProduct: { $ne: null } }, { projection: { idProduct: 1, type: 1, set: 1 } }).toArray()) if (!resteDe.has(r.idProduct)) resteDe.set(r.idProduct, r);
const etats = new Map((await cx.db.collection('collecte_etat').find({}, { projection: { pages: 1 } }).toArray()).map(e => [String(e._id), e]));
const alerte = await cx.db.collection('collecte_images_etat').findOne({ _id: 'alerte/file-vide', active: true });
const fileEtat = await cx.db.collection('file_images').aggregate([{ $group: { _id: '$etat', n: { $sum: 1 } } }]).toArray();
const toutes = [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE];
const lignesDeExp = new Map(); for (const l of toutes) if (l.exp != null) (lignesDeExp.get(l.exp) || lignesDeExp.set(l.exp, []).get(l.exp)).push(l);

// ── la boucle de service du site (celle de t-tableau.mjs, clé `set.region` : le site d'aujourd'hui)
const groupes = new Map(); for (const p of lignesJ) { const k = `${p.carteId}|${p.slugSet}`; (groupes.get(k) || groupes.set(k, []).get(k)).push(p); }
const fiche = new Map(), visuel = new Set(), pourquoi = new Map();
for (const [k, ps] of groupes) {
    const [carteId, slugSet] = k.split('|'); const set = sets.get(slugSet);
    const note = m => { for (const p of ps) if (!fiche.has(p.idProduct) && !pourquoi.has(p.idProduct)) pourquoi.set(p.idProduct, m); };
    if (!set) { note(/^WCD/.test(slugSet) ? 'WCD joint, set absent de la base' : slugSet === 'null' ? 'ligne sans slugSet' : 'set absent de la base'); continue; }
    if (!set.publie) { note('set non publié (sans nomAffichage)'); continue; }
    const d = docs.get(Number(carteId));
    if (!d || !d.nomEn || !(d.sets ?? []).includes(slugSet)) { note(!d?.nomEn ? 'carte sans nomEn' : 'set absent de cartes.sets'); continue; }
    const fs_ = fichesDuDocument((d.impressions ?? []).filter(i => i.tirage === set.region && set.exps.has(i.expansion)));
    const numeros = fs_.map(f => f.numero);
    const images = (d.images ?? []).filter(m => m.set === slugSet && visuelAdmisPourLaRegion(m, set.region));
    for (const [rang, f] of fs_.entries()) {
        const v = !!imageDeLImpression(images, f.numero)?.cleR2;
        for (const p of produitsDeLaFiche(ps, rang, numeros, set.code)) { if (!fiche.has(p.idProduct)) fiche.set(p.idProduct, { carteId: Number(carteId), slugSet, numero: f.numero }); if (v) visuel.add(p.idProduct); }
    }
    for (const p of ps) {
        if (fiche.has(p.idProduct) || pourquoi.has(p.idProduct)) continue;
        pourquoi.set(p.idProduct, !p.slug ? 'slug Cardmarket vide' : numeros.length <= 1 ? 'numéro du slug ≠ fiche unique'
            : !slugPorteUnNumero(p.slug) ? (/-V\d+$/i.test(p.slug) ? 'SANS SOURCE : versions V1/V2 inégales' : 'slug sans numéro, plusieurs fiches') : 'numéro du slug ≠ toute fiche');
    }
}
const attaches = new Set(lignesJ.map(l => l.idProduct));
const causeFiche = (idp, idExp) => {
    if (attaches.has(idp)) return pourquoi.get(idp) || 'joint, non servi';
    if (!NC.has(idp)) return 'jamais appris (passe Tampermonkey)';
    const ls = lignesDeExp.get(idExp) || [];
    if (!ls.length) return 'aucune ligne de table';
    const adm = ls.find(l => l.verifie);
    if (!adm) { const L = ls.find(l => l.verif) || ls[0]; const r = L.verif?.raisons?.[0] || 'jamais jugée'; return `ligne refusée : ${r.replace(/\d+(\/\d+)?/g, '#').slice(0, 50)}`; }
    if (!etats.has(adm.slugSet)) return 'ligne admise jamais collectée';
    const r = resteDe.get(idp);
    if (!r) return 'collecté, reste non écrit';
    if (r.type === 'produit-sans-carte') {
        const pages = etats.get(r.set)?.pages || [], manq = pages.filter(x => x?.etat === 'manquant').length;
        return !pages.length ? 'sans carte (voie sans page)' : manq ? 'SANS SOURCE : Setlist en liens rouges' : 'Setlist lue, numéro sans carte';
    }
    return `reste « ${r.type} »`;
};
const causeVisuel = (idp) => {
    const f = fiche.get(idp), d = docs.get(f.carteId), set = sets.get(f.slugSet), tir = set.tirage ?? set.region;
    const ims = (d.images ?? []).filter(m => m.set === f.slugSet);
    if (!ims.length) {
        if (/^zh/.test(tir) || ['id', 'th', 'idth'].includes(tir)) return `SANS SOURCE LÉGALE : visuel ${tir}`;
        if (tir === 'jp') return sourceDe(set.code) ? 'jp : artofpkm n\'a pas ce numéro, ou pas encore collecté' : 'jp : aucune source artofpkm';
        return 'intl : aucune image collectée';
    }
    const admis = ims.filter(m => visuelAdmisPourLaRegion(m, set.region));
    if (!admis.length) return ims[0].langue === 'ja' ? 'scan japonais refusé sur set intl' : 'image refusée par le site (langue/format)';
    return 'images du set, aucune au numéro de la fiche';
};

// ── HTTP : la liste /fr/sets une fois, les pages en cache 6 h
const cache = fs.existsSync(HTTP_CACHE) ? JSON.parse(fs.readFileSync(HTTP_CACHE, 'utf8')) : {};
const frais = e => e && !process.argv.includes('--http-neuf') && Date.now() - e.le < 6 * 3600 * 1000;
async function statut(url) {
    try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) }); return { code: r.status, texte: r.status === 200 && /\/fr\/sets$/.test(url) ? await r.text() : null }; }
    catch (e) { return { code: `erreur ${e.name}` }; }
}
const L0 = await statut(`${SITE}/fr/sets`);
const dansListe = new Set([...(L0.texte || '').matchAll(/href="\/fr\/sets\/([^"/?#]+)"/g)].map(m => decodeURIComponent(m[1])));
const catalogue = (await statut(`${SITE}/fr/catalogue`)).code;
let requetes = 2;
const publies = [...sets.values()].filter(s => s.publie).map(s => s._id);
const aLire = publies.filter(slug => !frais(cache[slug]));
for (let i = 0; i < aLire.length; i += 3) {
    await Promise.all(aLire.slice(i, i + 3).map(async slug => { cache[slug] = { code: (await statut(`${SITE}/fr/sets/${encodeURIComponent(slug)}`)).code, le: Date.now() }; requetes++; }));
}
fs.writeFileSync(HTTP_CACHE, JSON.stringify(cache));

// ── une ligne par expansion
const TIRAGE = { jp: 'JP', intl: 'INTL', 'zh-hans': 'ZH-S', 'zh-hant': 'ZH-T', id: 'ID', th: 'TH', idth: 'ID/TH' };
const LOGO_SANS_SOURCE = /jumeau international|aucun `setlogo`|COUPLE|introuvable|nom du jumeau/;
const lignes = [], CAUSES_PRODUITS = {};   // idProduct → [idExpansion, cause] : relu par les sondes, pour qu'elles lisent ce que la table lit
for (const e of parExp.values()) {
    const ls = lignesDeExp.get(e.idExpansion) || [];
    const L = ls.find(l => l.verifie) || ls[0] || null;
    const ncs = e.produits.map(id => NC.get(id)).filter(Boolean);
    const slug = L?.slugSet || ncs.find(n => n.slugSet)?.slugSet || null;
    const set = slug ? sets.get(slug) : null;
    const tirage = L?.bulba?.tirage || set?.tirage || (regionCodes.get(ncs.find(n => n.codeSet)?.codeSet) === 'japonais' ? 'jp' : regionCodes.get(ncs.find(n => n.codeSet)?.codeSet) === 'occidental' ? 'intl' : null);
    const nf = e.produits.filter(id => fiche.has(id)).length, nv = e.produits.filter(id => visuel.has(id)).length;
    const causes = new Map();
    for (const id of e.produits) {
        const c = !fiche.has(id) ? `fiche : ${causeFiche(id, e.idExpansion)}` : !visuel.has(id) ? `visuel : ${causeVisuel(id)}` : null;
        if (c) { causes.set(c, (causes.get(c) || 0) + 1); CAUSES_PRODUITS[id] = [e.idExpansion, c]; }
    }
    const bloquants = [...causes].filter(([c]) => !/SANS SOURCE/.test(c)).reduce((s, [, n]) => s + n, 0);
    const sansSource = [...causes].filter(([c]) => /SANS SOURCE/.test(c)).reduce((s, [, n]) => s + n, 0);
    const logo = !set ? '—' : set.logo && !set.logoGenerique ? 'oui' : set.logoGenerique ? 'générique' : LOGO_SANS_SOURCE.test(set.logoRefus?.motif || '') ? 'sans source' : 'à chercher';
    const page = set?.publie ? cache[slug]?.code ?? '?' : '—';
    const problemesSet = !slug ? 'expansion jamais apprise (nom inconnu)' : !set ? 'set absent de la base' : !set.publie ? 'set non publié' : page !== 200 ? `page du site en ${page}` : !dansListe.has(slug) ? 'absent de /fr/sets' : logo === 'à chercher' ? 'logo à chercher' : null;
    // Une expansion dont TOUT le manque est sans source légale (Setlist en liens rouges, visuels chinois…) n'a ni page ni set à
    // exiger : elle n'est ni verte ni rouge, elle est « sans source » — comptée à part, jamais dans le haut de la table.
    const toutSansSource = !bloquants && sansSource > 0 && sansSource === e.produits.length;
    const verte = !toutSansSource && !problemesSet && !bloquants;
    const top = [...causes].filter(([c]) => !/SANS SOURCE/.test(c)).sort((a, b) => b[1] - a[1])[0];
    lignes.push({
        idExpansion: e.idExpansion, code: L?.code ?? ncs.find(n => n.codeSet)?.codeSet ?? '—', slug, nom: set?.nomAffichage || (slug ? slug.replace(/-/g, ' ') : `(expansion ${e.idExpansion} jamais apprise)`),
        annee: e.annee, anneeEstimee: !!e.anneeEstimee, region: TIRAGE[tirage] || tirage || '?', produits: e.produits.length,
        set: !set ? 'non' : set.publie ? 'oui' : 'non publié', page, liste: set?.publie ? (dansListe.has(slug) ? 'oui' : 'NON') : '—', logo,
        fiche: Math.round(1000 * nf / e.produits.length) / 10, visuel: Math.round(1000 * nv / e.produits.length) / 10,
        bloquants, sansSource, verte, toutSansSource, score: toutSansSource ? 0 : (bloquants || (problemesSet ? e.produits.length : 0)) * Math.max(1, e.annee - 1995),
        cause: problemesSet || (top ? `${top[0]} (${top[1]})` : sansSource ? `restes sans source légale (${sansSource})` : '—')
    });
}
const rangStatut = l => l.verte ? 2 : l.toutSansSource ? 1 : 0;
lignes.sort((a, b) => rangStatut(a) - rangStatut(b) || b.score - a.score || b.produits - a.produits);
const vertes = lignes.filter(l => l.verte).length, grises = lignes.filter(l => l.toutSansSource).length;
const avant = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, 'utf8')) : null;
const evol = avant ? `${vertes - avant.vertes >= 0 ? '+' : ''}${vertes - avant.vertes} depuis le ${new Date(avant.le).toISOString().slice(0, 16).replace('T', ' ')} UTC (${avant.vertes})` : 'première mesure';
fs.writeFileSync(ETAT, JSON.stringify({ le: Date.now(), vertes, rouges: lignes.length - vertes, parExp: Object.fromEntries(lignes.map(l => [l.idExpansion, l.verte])) }));
const fileTxt = fileEtat.map(x => `${x._id}×${x.n}`).join(' · ');
const md = [];
md.push('# Table maîtresse — une ligne par expansion Cardmarket', '');
md.push(`Mesurée le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · export \`${EXPORT}\` : ${ex.products.length} produits − ${ex.products.length - produits.length} cartes-code = **${produits.length} produits, ${parExp.size} expansions**. Règles de service du site importées (${S}). HTTP : /fr/sets (${dansListe.size} sets listés), /fr/catalogue → ${catalogue}, ${publies.length} pages de set (${requetes} requêtes ce passage, cache 6 h).`, '');
md.push(`**Vertes : ${vertes} / ${parExp.size}** (${evol}) · rouges ${parExp.size - vertes - grises} · entièrement sans source légale ${grises}. File d'images : ${fileTxt}${alerte ? ` · 🔴 ALERTE FILE VIDE depuis ${new Date(alerte.depuis).toISOString()}` : ''}.`, '');
md.push('Verte = set publié, page en 200, présent dans /fr/sets, logo posé ou sans source légale, et aucun produit manquant bloquant. Ne bloquent pas (« sans source légale ») : visuels chinois, indonésiens, thaïs ; fiches en liens rouges de Setlist ; versions V1/V2 inégales. Tri : manquants bloquants × (année − 1995). « ~ » : année estimée par l\'expansion Cardmarket voisine.', '');
md.push('| # | idExp | code | expansion | année | région | produits | set | page | /fr/sets | logo | % fiche | % visuel | bloquants | sans source | cause du manque |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const expTotales = new Set(ex.products.map(p => p.idExpansion));
const codeSeul = [...expTotales].filter(id => !parExp.has(id));
md.push(`L'export compte **${expTotales.size} expansions** ; ${codeSeul.length} ne contiennent que des cartes-code (hors périmètre : ni fiche ni visuel possibles) : ${codeSeul.map(id => `${id} (${ex.products.filter(p => p.idExpansion === id).length} p., « ${ex.products.find(p => p.idExpansion === id)?.name} »)`).join(' · ') || 'aucune'}.`, '');
lignes.forEach((l, i) => md.push(`| ${i + 1} | ${l.idExpansion} | ${l.code} | ${l.verte ? '🟢' : l.toutSansSource ? '⚪' : '🔴'} ${l.nom} | ${l.anneeEstimee ? '~' : ''}${l.annee} | ${l.region} | ${l.produits} | ${l.set} | ${l.page} | ${l.liste} | ${l.logo} | ${l.fiche} | ${l.visuel} | ${l.bloquants} | ${l.sansSource || ''} | ${String(l.cause).replace(/\|/g, '/')} |`));
fs.writeFileSync(SORTIE, md.join('\n') + '\n');
fs.writeFileSync(`${R}/table-maitresse-produits.json`, JSON.stringify(CAUSES_PRODUITS));
console.log(`TABLE-MAITRESSE.md : ${lignes.length} expansions · vertes ${vertes} (${evol}) · /fr/catalogue ${catalogue} · /fr/sets ${dansListe.size} sets · requêtes HTTP ${requetes}`);
console.log(`sans source légale (entièrement) : ${grises}`);
console.log(`20 premières rouges :\n${lignes.filter(l => !l.verte && !l.toutSansSource).slice(0, 20).map((l, i) => `${String(i + 1).padStart(2)}. ${l.idExpansion} ${l.code} « ${l.nom} » ${l.anneeEstimee ? '~' : ''}${l.annee} ${l.region} · ${l.produits} p · fiche ${l.fiche} % · visuel ${l.visuel} % · bloquants ${l.bloquants} · ${l.cause}`).join('\n')}`);
await fermer();

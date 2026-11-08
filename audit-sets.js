'use strict';
// ============================================================
// AUDIT-SETS — LECTURE SEULE (agent catalogue, 2026-11-03). Pendant PAR SET de trous-outils/mesure-trous.js.
//   node audit-sets.js [--depuis-cache] [--sans-cache] [--avant=<AUDIT-SETS.json>]
// Une seule lecture de la base (≈ 13 min : mesurer() rejoue la chaîne de l'API), puis tous les calculs en mémoire (audit-catalogue/audit-sets.js, module pur).
// Cache de la lecture : rat-market-travail/catalogue/audit-cache/lecture.json ; --depuis-cache le relit (itérer sans refaire les 13 min).
// Écrit : rat-market-travail/catalogue/AUDIT-SETS.json et AUDIT-SETS.md (garde d'écriture : cette racine seule). Compare à l'AUDIT-SETS.json précédent
// (ou à --avant=) ; l'ancien est conservé en AUDIT-SETS.precedent.json. Ne s'exécute pas sans les règles du site ; une règle absente LÈVE.
// 🔑 Importé : mesurer() (classes de fiche et de visuel), lecture-audit, popularite, charger-regles-site (impressionDuSet, normaliserNumero) ; du site
//    (rat-market-site/lib, import() direct) : entreesDuSet.ts (expansionsDuSet, tirageDuSet, editionLocaleDuSet), imageDeLImpression.ts, langueDuVisuel.ts
//    (visuelAdmisPourLaRegion), annexes.ts (annexeDuSet) — toutes exportées ; une fonction absente LÈVE. Injectées dans le module pur.
// ⚠️ MODULES CHARGÉS HORS DÉPÔT (non suivis par git) : trous-outils/jumeaux-regle.js et trous-outils/faux-trous-f3.js (rat-market-travail/catalogue), et les .ts du site.
//    Non importables : calculerEntreesDuSet (asynchrone, lit la base) — les « entrées affichées » sont donc une approximation en mémoire (carte, numéro normalisé).
// Cache : format 2 (images avec cleR2/langue/languePreuve/w/h, restes par idProduct) ; un cache d'un autre format est refusé.
// ============================================================
const fs = require('fs');
const path = require('path');
const { autoriser } = require('./collecte-cartes/garde-ecriture');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue';
const DOSSIER_CACHE = path.join(DOSSIER, 'audit-cache');
const OUTILS = 'C:/Users/Yung/rat-market-travail/catalogue/trous-outils';

const args = process.argv.slice(2);
const inconnu = args.filter(a => !['--depuis-cache', '--sans-cache', '--sans-ecriture'].includes(a) && !/^--(avant|set)=.+$/.test(a));
if (inconnu.length) { console.error(`argument inconnu : ${inconnu.join(' ')} (une ligne de commande est une garde : rien ne s'ouvre sur un drapeau non reconnu)`); process.exit(2); }
const depuisCache = args.includes('--depuis-cache'), sansCache = args.includes('--sans-cache');
const sansEcriture = args.includes('--sans-ecriture');   // imprime les comptes, n'écrit ni AUDIT-SETS.json/.md ni .precedent ni le cache (rejouer depuis une copie de travail)
const avantArg = (args.find(a => a.startsWith('--avant=')) || '').slice(8) || null;

const sortie = nom => autoriser(path.join(DOSSIER, nom), [DOSSIER]);
const lireJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

async function lireBase() {
    const { chargerApi } = require('./audit-catalogue/etat-api');
    const { mesurer } = require('./audit-catalogue/compteurs-abc');
    const { ouvrirLecture } = require('./audit-catalogue/lecture-audit');
    const { popDe } = require('./collecte-cartes/popularite');
    const t0 = Date.now();
    const api = await chargerApi();
    const { produits, donnees } = await mesurer({ api, avecTemoin: false, log: () => { } });
    console.log(`mesure des produits faite en ${Math.round((Date.now() - t0) / 1000)} s : ${produits.length} produits`);
    const b = await ouvrirLecture();
    let sets, cartes, lignes, guide, trous, restes;
    try {
        const lire = async (db, col, proj, filtre = {}) => { const d = await db.collection(col).find(filtre, { projection: proj }).toArray(); if (!d.length) throw new Error(`${col} : lecture vide (clé fausse ?)`); return d; };
        sets = await lire(b.cartes, 'sets', { code: 1, nomAffichage: 1, tirage: 1, region: 1, totalImprime: 1, idExpansion: 1, type: 1, deck: 1, editionLocale: 1, 'bulba.expansion': 1 });
        cartes = await lire(b.cartes, 'cartes', { nomEn: 1, pv: 1, 'attaques.nom': 1, sets: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.deck': 1, 'impressions.numero': 1, 'impressions.total': 1,
            'images.set': 1, 'images.numero': 1, 'images.cleR2': 1, 'images.langue': 1, 'images.languePreuve': 1, 'images.w': 1, 'images.h': 1 });
        lignes = await lire(b.cartes, 'cartes_produits', { carteId: 1, idProduct: 1, slugSet: 1, numeroFiche: 1 });
        guide = await lire(b.prod, 'guide_prix', { idProduct: 1, low: 1, lowHolo: 1, avg1: 1, avg7: 1, avg30: 1, trend: 1, guideDu: 1 });
        trous = await lire(b.cartes, 'trous_nommes', {});
        restes = await lire(b.cartes, 'restes', {});
    } finally { await b.fermer(); }
    const guideDe = new Map();
    for (const g of guide) { const a = guideDe.get(g.idProduct); if (!a || String(g.guideDu) > String(a.guideDu)) guideDe.set(g.idProduct, g); }
    const offresParExpansion = {};
    for (const p of produits) if (popDe(guideDe.get(p.idProduct))?.offres === true) offresParExpansion[p.idExpansion] = (offresParExpansion[p.idExpansion] || 0) + 1;
    const trousNommes = {};
    for (const t of trous) if (t.resolu !== true && t.idProduct != null) trousNommes[t.idProduct] = t.motif;
    // les restes NON résolus (resoluLe absent), un type par idProduct (comme mesure-trous.js : restesDe)
    const restesParProduit = {};
    for (const r of restes) if (r.idProduct != null && !r.resoluLe && !restesParProduit[r.idProduct]) restesParProduit[r.idProduct] = r.type;
    return {
        formatCache: 2,
        le: new Date().toISOString(),
        sets: sets.map(s => ({ _id: s._id, code: s.code ?? null, nomAffichage: s.nomAffichage ?? null, tirage: s.tirage ?? null, region: s.region ?? null, totalImprime: s.totalImprime ?? null, idExpansion: s.idExpansion ?? [], type: s.type ?? null, deck: s.deck ?? null, editionLocale: s.editionLocale ?? null, bulba: { expansion: s.bulba?.expansion ?? null } })),
        cartes: cartes.map(c => ({ _id: c._id, nomEn: c.nomEn ?? null, pv: c.pv ?? null, attaques: (c.attaques || []).map(a => a.nom), sets: c.sets || [], impressions: (c.impressions || []).map(i => ({ tirage: i.tirage ?? null, expansion: i.expansion ?? null, deck: i.deck ?? null, numero: i.numero ?? null, total: i.total ?? null })), images: (c.images || []).map(i => ({ set: i.set ?? null, numero: i.numero ?? null, cleR2: i.cleR2 ?? '', langue: i.langue ?? null, languePreuve: i.languePreuve ?? null, w: i.w ?? null, h: i.h ?? null })) })),
        lignes: lignes.map(l => ({ carteId: l.carteId, idProduct: l.idProduct, slugSet: l.slugSet ?? null, numeroFiche: l.numeroFiche ?? null })),
        produits: produits.map(p => ({ idProduct: p.idProduct, idExpansion: p.idExpansion, name: p.name, setId: p.setId ?? null, fiche: { classe: p.fiche.classe, motifs: p.fiche.motifs || [], carteId: p.fiche.carteId ?? null, numero: p.fiche.numero ?? null, setId: p.fiche.setId ?? null }, visuel: { classe: p.visuel.classe, motifs: p.visuel.motifs || [] } })),
        numerosProduits: donnees.nc.map(n => ({ idProduct: n.idProduct, numero: n.numero ?? null })),
        offresParExpansion, trousNommes, restesParProduit,
    };
}

(async () => {
    const t0 = Date.now();
    const A = require('./audit-catalogue/audit-sets');
    const { chargerReglesSite } = require('./collecte-cartes/charger-regles-site');
    const { impressionDuSet, normaliserNumero } = await chargerReglesSite({ lib: 'C:/Users/Yung/Desktop/rat-market-site/lib' });
    const { memeCodeSaufFin } = require(`${OUTILS}/jumeaux-regle`);
    const { exclure } = require(`${OUTILS}/faux-trous-f3`);
    // les annexes (« Yellow A ») : le site les range dans le set de leur carte parente (lib/annexes.ts) — importées, jamais recopiées ; une fonction absente lève
    const site = async f => import(require('url').pathToFileURL(`C:/Users/Yung/Desktop/rat-market-site/lib/${f}`).href);
    const [{ annexeDuSet }, { expansionsDuSet, tirageDuSet, editionLocaleDuSet }, { imageDeLImpression }, { visuelAdmisPourLaRegion }, { estAdditionals }] = await Promise.all([site('annexes.ts'), site('entreesDuSet.ts'), site('imageDeLImpression.ts'), site('langueDuVisuel.ts'), site('additionals.ts')]);
    for (const [k, f] of Object.entries({ estAdditionals, annexeDuSet, expansionsDuSet, tirageDuSet, editionLocaleDuSet, imageDeLImpression, visuelAdmisPourLaRegion })) if (typeof f !== 'function') throw new Error(`règle du site non importée : ${k}`);
    const regles = { impressionDuSet, normaliserNumero, memeCodeSaufFin, exclure: s => exclure(s), estAdditionals, annexeDuSet, expansionsDuSet, tirageDuSet, editionLocaleDuSet, imageDeLImpression, visuelAdmisPourLaRegion };

    const cache = autoriser(path.join(DOSSIER_CACHE, 'lecture.json'), [DOSSIER]);
    let lecture;
    if (depuisCache) { lecture = lireJson(cache); if (lecture.formatCache !== 2) throw new Error('cache d\'un autre format que 2 : relancer sans --depuis-cache'); console.log(`lecture relue du cache (${lecture.le})`); }
    else {
        lecture = await lireBase();
        if (!sansCache && !sansEcriture) { fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, JSON.stringify(lecture)); console.log(`cache écrit : ${cache}`); }
    }
    const audit = A.auditer(lecture, regles);
    audit.le = new Date().toISOString(); audit.lectureDu = lecture.le;

    // ── la mesure de référence : --avant, sinon l'AUDIT-SETS.json présent (conservé en .precedent avant d'être remplacé)
    const jsonSortie = sortie('AUDIT-SETS.json'), mdSortie = sortie('AUDIT-SETS.md'), prec = sortie('AUDIT-SETS.precedent.json');
    let avant = null;
    if (avantArg) avant = lireJson(avantArg);
    else if (fs.existsSync(jsonSortie)) { avant = lireJson(jsonSortie); if (!sansEcriture) fs.copyFileSync(jsonSortie, prec); }
    const ec = A.ecart(avant, audit);
    audit.ecart = ec;
    if (!sansEcriture) { fs.writeFileSync(jsonSortie, JSON.stringify(audit)); fs.writeFileSync(mdSortie, A.formaterMd(audit, ec)); }
    const T = audit.totaux, D = audit.denominateurs;
    console.log(`dénominateurs : ${JSON.stringify(D)}`);
    console.log(`sets à 100 % ${T.sets100} · troués ${T.setsTroues} · trous ${T.trous} : ` + A.TYPES.map(t => `${A.TITRES[t]} ${T[t]}`).join(' · '));
    for (const t of A.TYPES) console.log(`  ${t} : ${JSON.stringify(audit.parCause[t])}`);
    console.log(`EXCLUS du compte (imprimés à part, jamais disparus) : ${audit.exclus.total} · par cause ${JSON.stringify(audit.exclus.parCause)} · sur ${Object.keys(audit.exclus.parSet).length} sets`);
    console.log('10 sets les plus touchés par expansion-declaree-sans-impression :');
    for (const x of A.suspectsExpansion(audit)) console.log(`  ${x.set} ${x.n} · déclarée ${JSON.stringify(x.expansionsDeclarees)} · ` + x.exemples.map(e => `${e.nom} → ${e.plusProche ? `${e.plusProche.tirage}/« ${e.plusProche.expansion} »/${e.plusProche.numero}` : 'aucune'}`).join(' ; '));
    for (const id of args.filter(a => a.startsWith('--set=')).map(a => a.slice(6))) {   // détail par set demandé : trous, causes, exclusions
        const s = audit.sets.find(x => x.set === id);
        console.log(s ? `  [${id}] trous ${s.trous} · causes ${JSON.stringify(s.causes)} · exclus ${JSON.stringify(s.exclusParCause || {})}` : `  [${id}] absent des sets publiés`);
    }
    if (ec) console.log(`écart contre ${ec.avantLe} : ${JSON.stringify(ec.totaux)} · passés à 100 % ${ec.setsPassesA100.length}${ec.memeDenominateur ? '' : ' ⚠️ dénominateur différent'}`);
    console.log(sansEcriture ? `--sans-ecriture : rien d'écrit · ${Math.round((Date.now() - t0) / 1000)} s` : `écrit ${jsonSortie} et ${mdSortie} · ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });

// ============================================================
// LOT TAMPONNEES — l'image du tirage normal, empruntée, pour l'affichage seulement (module : collecte-cartes/images-empruntees.js)
// ============================================================
//   node poser-images-empruntees.js [--sortie=<dossier>] [--site-lib=<lib du site>]            (SIMULATION, par défaut : plan par set, règle du site rejouée avant/après, garde de lot, manifeste, annonce — lecture seule)
//   node lot-additif.js --quoi="TAMPONNEES : …" --collections=cartes [--annonce=<annonce.json>] -- node poser-images-empruntees.js --attendu=<N> --ecrire
//   node poser-images-empruntees.js --retirer [--ecrire --attendu=<N>]                           (le retrait EXACT, d'après manifeste.json)
// Écrit : un $push gardé d'UNE entrée dans cartes.images, par (carte, set, numéro). Aucun document `images`, aucune autre collection.
// La décision (testeur, 2026-10-17 soir) : l'image du tirage normal (cartes_produits.visuelSubstitut) est permise POUR L'AFFICHAGE SEULEMENT, marquée `imageEmprunteeTirage: true`. WCD : jamais —
// sauf, depuis le 27/10 (testeur), les produits de la liste fermée collecte-cartes/origines-wcd.json (visuel de la carte d'origine, motif « autre tirage »).
// La règle du SITE est importée de sa lib (lecture seule), jamais recopiée. Un produit perdu, ou une image déjà servie qui change : ARRÊT.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const E = require('./collecte-cartes/images-empruntees');

const DEFAUT_SORTIE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/TAMPONNEES';
const DEFAUT_SITE_LIB = 'C:/Users/Yung/Desktop/rat-market-site/lib';
const AUTORISES = [/^--ecrire$/, /^--retirer$/, /^--attendu=\d+$/, /^--sortie=.+$/, /^--site-lib=.+$/, /^--sets=[\w,.-]+$/];
const val = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

async function lireEtat(dbCartes) {
    // PHASE 3b : les sets à liste fermée de produits (Southeast-Asia-Promos : 3 produits) sont LUS avec le périmètre ; seuls leurs produits listés sont jamais écrits (collecte-cartes/images-empruntees.js)
    const sets = await dbCartes.collection('sets').find({ _id: { $in: [...E.SETS_LUS] } }, { projection: { complet: 0, denominateurs: 0, entreesSetlist: 0 } }).toArray();
    E.verifierPerimetre(sets.map(s => s._id)); E.verifierBornes(sets.map(s => s._id));
    const exps = [...new Set(sets.flatMap(s => [].concat(s.idExpansion ?? [])))];
    const proj = { idProduct: 1, carteId: 1, slugSet: 1, idExpansion: 1, numeroFiche: 1, slug: 1, detail: 1, visuelSubstitut: 1 };
    const lignes = await dbCartes.collection('cartes_produits').find({ $or: [{ idExpansion: { $in: exps } }, { slugSet: /^wcd/i }] }, { projection: { ...proj, preuve: 1, origine: 1 } }).toArray();
    const cartesDocs = await dbCartes.collection('cartes').find({ sets: { $in: [...E.SETS_LUS] } }, { projection: { impressions: 1, images: 1, nomEn: 1, sets: 1 } }).toArray();
    // les cartes des substituts (la même carte porte l'image d'origine) : déjà dans cartesDocs quand elle est du périmètre ; sinon lues à part
    // 27/10 : et les cartes des WCD de la liste fermée (une ligne WCD ne pose jamais le set dans cartes.sets : la carte d'origine n'est pas lue par `sets`)
    const manque = [...new Set(lignes.filter(l => l.carteId > 0 && ((E.dansLePerimetre(l.slugSet) && l.visuelSubstitut?.cleR2) || E.origineWCD(l.slugSet, l.idProduct))).map(l => l.carteId))].filter(id => !cartesDocs.some(c => c._id === id));
    if (manque.length) cartesDocs.push(...await dbCartes.collection('cartes').find({ _id: { $in: manque } }, { projection: { impressions: 1, images: 1, nomEn: 1, sets: 1 } }).toArray());
    // Trick or Trade 2024 : le set d'origine se lit sur la ligne du premier produit d'origine cité, ou sur le nom de set entre parenthèses (égalité exacte avec nomAffichage / nomEn)
    const idsOrigine = [...new Set(lignes.filter(l => E.derivableDeLOrigine(l.slugSet, l.idProduct) && !l.visuelSubstitut?.cleR2).map(l => E.origineDeLaLigne(l).idProduct).filter(x => Number.isInteger(x)))];
    const produits = new Map((await dbCartes.collection('cartes_produits').find({ idProduct: { $in: idsOrigine } }, { projection: { idProduct: 1, slugSet: 1 } }).toArray()).map(p => [p.idProduct, { slugSet: p.slugSet }]));
    const setsParNom = new Map(), setsParNomAffichage = new Map();
    const range = (m, nom, id) => { if (!m.has(nom)) m.set(nom, []); m.get(nom).push(id); };
    for (const s of await dbCartes.collection('sets').find({}, { projection: { nomAffichage: 1, nomEn: 1 } }).toArray()) {
        if (typeof s.nomAffichage === 'string' && s.nomAffichage) range(setsParNomAffichage, s.nomAffichage, s._id);
        for (const nom of new Set([s.nomAffichage, s.nomEn].filter(x => typeof x === 'string' && x))) range(setsParNom, nom, s._id);
    }
    return { sets, lignes, cartesDocs, cartes: new Map(cartesDocs.map(c => [c._id, c])), produits, setsParNom, setsParNomAffichage };
}

async function ouvrirLecture() {
    require('dotenv').config({ quiet: true });
    if (!process.env.MONGODB_CARTES_LECTURE_URI) { console.error('❌ MONGODB_CARTES_LECTURE_URI absente'); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const a = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI);
    await a.connect();
    const dbCartes = a.db('cartes');
    if (!(await dbCartes.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('base cartes vide : grappe fausse ?');
    return { dbCartes, fermer: () => a.close() };
}

const melange = (liste, graine) => { const a = [...liste]; let s = graine; const alea = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

(async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — usage : [--retirer] [--ecrire --attendu=<N>] [--sortie=…] [--site-lib=…]`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire'), RETIRER = process.argv.includes('--retirer');
    const ATTENDU = Number(val('attendu'));
    if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=<N> (le nombre que la simulation a rendu)'); process.exit(2); }
    if (ECRIRE) { try { E.garderSousLot(process.env, process.ppid); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    // PHASE 3b : `--sets=<slug>[,…]` restreint le PLAN (et donc l'écriture) à ces sets ; sans lui, tout le périmètre comme avant. Vérifié avant toute connexion.
    const SELECTION = val('sets') === null ? null : val('sets').split(',');
    if (SELECTION !== null) { try { E.verifierSelection(SELECTION); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    // TOUR 1 (D4.2) : l'ÉCRITURE ne part jamais sur « tout le périmètre » par défaut : la sélection se nomme, comme à la simulation (le manifeste la porte, l'écriture la compare)
    if (ECRIRE && SELECTION === null) { console.error('❌ --ecrire exige --sets=<slug>[,…] explicite (la même sélection que la simulation) — rien n\'est écrit'); process.exit(2); }
    const SORTIE = val('sortie') || DEFAUT_SORTIE, SITE_LIB = val('site-lib') || DEFAUT_SITE_LIB;
    fs.mkdirSync(SORTIE, { recursive: true });
    const fichier = n => path.join(SORTIE, n);

    let cx;
    if (ECRIRE) { const { ouvrirConnexions } = require('./collecte-cartes/garde'); require('dotenv').config({ quiet: true }); const o = await ouvrirConnexions({ production: true, buckets: [] }); cx = { dbCartes: o.cartes.db, fermer: o.fermer }; }
    else cx = await ouvrirLecture();
    try {
        const etat = await lireEtat(cx.dbCartes);
        console.log(`DÉNOMINATEUR : périmètre ${E.PERIMETRE.length} sets + ${Object.keys(E.SETS_BORNES).length} set à liste fermée (${Object.entries(E.SETS_BORNES).map(([s, l]) => `${s} : ${l.join(', ')}`).join(' ; ')}), tous présents en base (${etat.sets.map(s => s._id).join(', ')}) · ${etat.lignes.length} lignes cartes_produits (expansions lues + WCD) · ${etat.cartesDocs.length} cartes`);
        if (!etat.lignes.length || !etat.cartesDocs.length) throw new Error('population de lecture vide : sonde cassée');

        // ── le retrait exact
        if (RETIRER) {
            const figes = fs.readdirSync(SORTIE).filter(f => /^manifeste-ecrit-.+\.json$/.test(f)).sort();   // le manifeste figé à l'écriture prime
            const m = JSON.parse(fs.readFileSync(fichier(figes.length ? figes[figes.length - 1] : 'manifeste.json'), 'utf8'));
            if (ECRIRE && !E.memeSelection(m, SELECTION)) { console.error(`❌ ARRÊT : la sélection du manifeste (${JSON.stringify(m.sets ?? null)}) n'est pas celle du jour (${SELECTION.join(',')}) — rien n'est retiré`); process.exitCode = 1; return; }
            const ops = E.operationsDeRetrait(m);
            const apres = E.retirer({ cartes: etat.cartes }, m);
            const garde = require('./collecte-cartes/garde-lot');
            const cmp = garde.comparer(garde.compterEtat({ cartes: etat.cartesDocs, cartesProduits: etat.lignes }), garde.compterEtat({ cartes: etat.cartesDocs.map(c => apres.cartes.get(c._id) || c), cartesProduits: etat.lignes }));
            const annonce = Object.fromEntries(cmp.baisses.filter(b => !b.autorisee).map(b => [b.cle, b.baisse]));
            garde.validerAnnonces(annonce);
            fs.writeFileSync(fichier('annonce-retrait.json'), JSON.stringify(annonce, null, 1));
            console.log(`RETRAIT : ${ops.length} écritures ($pull borné par set + clé + source + lot) · annonce-retrait.json : ${JSON.stringify(annonce)}`);
            if (!ECRIRE) { console.log('(simulation du retrait — sous lot-additif.js : --retirer --attendu=N --ecrire, --annonce=annonce-retrait.json)'); return; }
            if (ops.length !== ATTENDU) { console.error(`❌ ARRÊT : ${ops.length} écritures, attendu ${ATTENDU} — rien n'est retiré`); process.exitCode = 1; return; }
            let touches = 0;
            for (const o of ops) touches += (await cx.dbCartes.collection(o.coll).updateOne(o.filter, o.update, o.options || {})).modifiedCount;
            // un retrait partiel (une entrée déjà remplacée ou retirée) n'est pas un succès complet : ✅ seulement si tout est retiré
            console.log(`${touches === ops.length ? '✅' : '⚠️ retrait PARTIEL —'} retirées ${touches}/${ops.length}${touches === ops.length ? '' : ' (les autres étaient déjà absentes ou ont changé : à vérifier)'}`);
            if (touches !== ops.length) process.exitCode = 1;
            return;
        }

        const plan = E.planifier(etat, { sets: SELECTION });
        const ops = E.operationsVersMongo(plan);
        if (SELECTION) console.log(`SÉLECTION --sets=${SELECTION.join(',')} : ${plan.horsSelection} ligne(s) des autres sets lues et NON planifiées`);
        const manifeste = E.manifeste(plan, { sets: SELECTION });
        console.log(`PLAN : ${plan.ajouts.length} entrées à poser (${plan.ajouts.reduce((s, a) => s + a.produits.length, 0)} produits) · déjà ${plan.deja.length} · sans substitut ${plan.sansSubstitut.length} · sans carte ${plan.sansCarte.length} · refus ${plan.refus.length} · WCD refusés ${plan.refusWCD.length} · hors périmètre ${plan.horsPerimetre} · hors liste fermée ${plan.horsListe} · ÉCRITURES ${ops.length}`);
        console.log('PAR SET :');
        for (const [s, c] of Object.entries(plan.parSet).sort()) console.log(`   ${s} : ${JSON.stringify(c)}`);
        for (const r of plan.refus) console.log(`   ✗ REFUS carte ${r.carteId} ${r.set} n°${r.numero ?? '∅'} (produits ${r.produits.join(',')}) : ${r.raison}`);
        if (plan.refus.length && !ECRIRE) process.exitCode = 1;   // PHASE 3b : une simulation qui porte un refus ne rend pas 0 (--ecrire s'arrête de toute façon : motifDArret)

        const apres = E.appliquer(etat, plan);
        const cartesApres = etat.cartesDocs.map(c => apres.cartes.get(c._id) || c);

        // ── la règle du SITE, avant / après
        const H = require('./collecte-cartes/h-fix-site');
        const R = await H.chargerRegle({ racine: __dirname, siteLib: SITE_LIB });
        const av = H.servir(R, { sets: etat.sets, cartes: etat.cartesDocs, lignes: etat.lignes });
        const ap = H.servir(R, { sets: etat.sets, cartes: cartesApres, lignes: etat.lignes });
        const dif = H.diff(av, ap);
        const T = await import(pathToFileURL(path.join(SITE_LIB, 'tamponNonRepresente.ts')).href);
        if (typeof T.mentionDuVisuelEmprunte !== 'function' || typeof T.imageServieDe !== 'function') throw new Error('mentionDuVisuelEmprunte absente du site : règle introuvable');
        const perdus = dif.filter(d => d.nature.startsWith('PRODUIT PERDU') || d.nature === 'produit sorti de la sortie');
        const gagnes = dif.filter(d => d.nature === 'produit gagné une fiche');
        const visuelGagne = dif.filter(d => d.nature === 'visuel changé' && d.a.cleR2 == null && d.b.cleR2);
        const visuelChange = dif.filter(d => d.nature === 'visuel changé' && d.a.cleR2 != null);
        const fichesChangees = dif.filter(d => d.nature.startsWith('fiche changée'));
        const emprunte = (cartes, k, cleR2) => { const e = (cartes.get(k.carteId)?.images || []).find(x => x.set === k.set && x.cleR2 === cleR2 && x.imageEmprunteeTirage === true); return e || null; };
        const cartesApresMap = new Map(cartesApres.map(c => [c._id, c]));
        const mentions = {}, mentionsReelles = {}, mentionsSiCorrectif = {};
        const parSetSite = {};
        const compte = (o, m) => { const c = m ?? '(aucune)'; o[c] = (o[c] || 0) + 1; };
        for (const [k, b] of ap) {
            if (!E.dansLePerimetre(b.set) && !E.setBorne(b.set)) continue;
            const s = (parSetSite[b.set] ||= { produits: 0, avecFiche: 0, visuelAvant: 0, visuelApres: 0, empruntes: 0 });
            const a = av.get(k);
            s.produits++; if (b.fiche) s.avecFiche++; if (a?.cleR2) s.visuelAvant++; if (b.cleR2) s.visuelApres++;
            const e = b.cleR2 ? emprunte(cartesApresMap, b, b.cleR2) : null;
            if (e) {
                s.empruntes++; const m = T.mentionDuVisuelEmprunte(e); mentions[m] = (mentions[m] || 0) + 1;
                // la VRAIE chaîne du site : imageServieDe sur toutes les images de la carte, avec l'adresse que la grille donne (…/<cleR2 servie>)
                const r = E.mentionServie({ images: cartesApresMap.get(b.carteId)?.images, cleR2: b.cleR2, set: b.set, imageServieDe: T.imageServieDe, mentionDuVisuelEmprunte: T.mentionDuVisuelEmprunte });
                compte(mentionsReelles, r.reelle); compte(mentionsSiCorrectif, r.siCorrectif);
                s.mentionReelle = (s.mentionReelle || 0) + (r.reelle ? 1 : 0); s.mentionSiCorrectif = (s.mentionSiCorrectif || 0) + (r.siCorrectif ? 1 : 0);
            }
        }
        const nat = {}; for (const d of dif) nat[d.nature] = (nat[d.nature] || 0) + 1;
        console.log(`SITE (lib ${SITE_LIB}) : ${av.size} produits rejoués · ${dif.length} différences ${JSON.stringify(nat)} · gagnés (fiche) ${gagnes.length} · visuels GAGNÉS ${visuelGagne.length} · visuels déjà servis qui CHANGENT ${visuelChange.length} · fiches changées ${fichesChangees.length} · perdus ${perdus.length}`);
        console.log('SITE PAR SET (produits avec fiche / visuel avant → après / servis par une emprunt) :');
        for (const [s, c] of Object.entries(parSetSite).sort()) console.log(`   ${s} : ${JSON.stringify(c)}`);
        console.log(`MENTIONS de l'entrée posée (mentionDuVisuelEmprunte sur l'entrée) : ${JSON.stringify(mentions)}`);
        console.log(`MENTIONS RÉELLEMENT SERVIES (imageServieDe du site AVEC le set de la fiche, comme lib/cartes.ts) : ${JSON.stringify(mentionsReelles)}`);
        console.log(`MENTIONS SI le site cherchait d'abord dans le set : ${JSON.stringify(mentionsSiCorrectif)}`);
        // TOUR 1 (D4.1) : l'ordre est « affichée avec la mention » — chaque produit du plan doit être servi PAR SA FICHE avec la mention, mesuré par la règle du site rejouée ; sinon ARRÊT
        const apParProduit = new Map();
        for (const [k, b] of ap) { const m = /\|(\d+)\|(\d+)$/.exec(k); if (m) apParProduit.set(`${m[2]}|${m[1]}`, b); }
        const mentionDe = (carteId, set, id) => { const b = apParProduit.get(`${carteId}|${id}`); if (!b || !b.cleR2) return null; return E.mentionServie({ images: cartesApresMap.get(carteId)?.images, cleR2: b.cleR2, set, imageServieDe: T.imageServieDe, mentionDuVisuelEmprunte: T.mentionDuVisuelEmprunte }).reelle; };
        const sansMention = E.produitsSansMention(plan, mentionDe);
        const nPlan = plan.ajouts.reduce((s, a) => s + a.produits.length, 0);
        const enAttente = E.produitsMentionEnAttente(plan);
        console.log(`mention en attente du site (autre tirage) : ${enAttente.length} produits`);
        console.log(`MENTION SERVIE PAR LA FICHE, produits du plan : ${nPlan - sansMention.length}/${nPlan}${sansMention.length ? ` — SANS mention : ${sansMention.join(', ')}` : ''}`);
        if (sansMention.length) { console.error('🔴 ARRÊT : des produits du plan seraient servis SANS la mention (« affichée avec la mention ») — rien n\'est écrit.'); process.exitCode = 1; return; }

        // ── PHASE 3b : la décision de l'API (chaîne importée, jamais recopiée) AVANT / APRÈS, sur la base entière. Une image empruntée n'est JAMAIS servie à l'identification (decision.js : refusDeRepli
        // « image-empruntee ») : les produits du plan qui étaient servis par un AUTRE tirage sortent de l'archive, et c'est l'ordre du testeur. Tout autre produit qui bouge ARRÊTE.
        const horsChamp = E.produitsHorsChamp(plan);
        if (horsChamp.length) { console.error(`🔴 ARRÊT : le plan touche des produits hors du champ (${horsChamp.join(', ')}) — rien n'est écrit.`); process.exitCode = 1; return; }
        if (!ECRIRE && plan.ajouts.length) {
            const GC = require('./collecte-cartes/garde-contrat-api'), PV = require('./collecte-cartes/phase2-visuels');
            const api = await GC.chargerApi();
            const { jugerLecture } = require('./collecte-cartes/base-banc');
            const jl = jugerLecture(process.env, 'cartes'); if (!jl.ok) throw new Error(jl.raison);
            const eApi = await require('./collecte-cartes/phase2-lecture').lireEtat({ uri: jl.uri, dbName: 'cartes', projectionsCartes: api.projectionsEtat.cartes, projectionsLignes: api.projectionsEtat.cartesProduits });
            const decider = async s => { const I = api.interneur(); return api.decider({ sets: s.sets.map(x => api.compacterSet(x, I)), docs: s.cartes.map(d => api.compacterCarte(d, I)), lignes: s.cartesProduits.map(l => api.compacterLigne(l, I)), metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false }); };
            const avantApi = await decider(eApi);
            const ap2 = E.appliquer({ cartes: new Map(eApi.cartes.map(c => [c._id, c])) }, plan);
            const etatApresApi = { ...eApi, cartes: eApi.cartes.map(c => ap2.cartes.get(c._id) || c) };
            const apresApi = await decider(etatApresApi);
            const idsPlan = plan.ajouts.flatMap(a => a.produits);
            const cmpApi = PV.compareEntrees(avantApi.entrees, apresApi.entrees, idsPlan);
            const nature = (r, id) => r.entrees.find(x => x.idProduct === id)?.visuel ?? 'non servi';
            console.log(`API (decider, base entière) : produits servis ${new Set(avantApi.entrees.map(x => x.idProduct)).size} → ${new Set(apresApi.entrees.map(x => x.idProduct)).size} · refus « image-empruntee » ${avantApi.denominateurs.repliRefuse.parFamille['image-empruntee']} → ${apresApi.denominateurs.repliRefuse.parFamille['image-empruntee']} · produits du plan ${idsPlan.length}`);
            for (const id of idsPlan.slice(0, 30)) console.log(`   ${id} : ${nature(avantApi, id)} → ${nature(apresApi, id)}`);
            console.log(`API : perdus ${cmpApi.perdus.length} (tous du plan : ${cmpApi.perdus.every(i => idsPlan.includes(i))}) · AUTRES produits perdus ${cmpApi.autresPerdus.length} · produits changés ${cmpApi.changes.length} · gagnés ${cmpApi.gagnes.length}`);
            const ctApi = await GC.verifierContrat({ api, avant: { sets: eApi.sets, cartes: eApi.cartes, cartesProduits: eApi.cartesProduits }, apres: { sets: etatApresApi.sets, cartes: etatApresApi.cartes, cartesProduits: etatApresApi.cartesProduits } });
            console.log(`${GC.ligneContrat(ctApi)} · CONTRAT : ${ctApi.nouveaux.length ? `🔴 ${ctApi.nouveaux.length} refus nouveau(x)` : '✅ zéro refus nouveau'}`);
            const vApi = E.verdictApi({ cmp: cmpApi, idsPlan, contratNouveaux: ctApi.nouveaux.length, apres: apresApi.entrees });
            if (!vApi.ok) { console.error(`🔴 ARRÊT : l'API perd ou change un produit HORS du plan, ou le contrat refuse une entrée (${vApi.raisons.join(' ; ')}) — rien n'est écrit.`); process.exitCode = 1; return; }
        }

        // ── la garde de lot sur l'état simulé
        const garde = require('./collecte-cartes/garde-lot');
        const cmp = garde.comparer(garde.compterEtat({ cartes: etat.cartesDocs, cartesProduits: etat.lignes }), garde.compterEtat({ cartes: cartesApres, cartesProduits: etat.lignes }));
        const annonce = Object.fromEntries(cmp.baisses.filter(b => !b.autorisee).map(b => [b.cle, b.baisse]));
        console.log(`GARDE DE LOT (simulée) : ${cmp.baisses.length} baisse(s), ${cmp.nonAutorisees.length} non autorisée(s) · hausses ${JSON.stringify(cmp.hausses)} · annonce : ${JSON.stringify(annonce)}`);

        // ── dix cibles tirées au hasard (graine fixe : la même simulation rend les mêmes dix)
        const nomDe = id => etat.cartes.get(id)?.nomEn ?? id;
        const echantillon = melange(plan.ajouts, 20261018).slice(0, 10).map(a => ({ carteId: a.carteId, nom: nomDe(a.carteId), set: a.set, numero: a.numero, produits: a.produits, cleR2: a.entree.cleR2, tamponNonRepresente: a.entree.tamponNonRepresente ?? null, mention: T.mentionDuVisuelEmprunte(a.entree) }));

        const sortie = { date: new Date().toISOString().slice(0, 10), siteLib: SITE_LIB, plan: { ajouts: plan.ajouts.map(a => ({ carteId: a.carteId, set: a.set, numero: a.numero, produits: a.produits, cleR2: a.entree.cleR2 })), deja: plan.deja, sansSubstitut: plan.sansSubstitut.length, sansCarte: plan.sansCarte.length, refus: plan.refus, refusWCD: plan.refusWCD.length, parSet: plan.parSet }, site: { natures: nat, parSet: parSetSite, mentions, mentionsReelles, mentionsSiCorrectif, perdus: perdus.length, visuelsGagnes: visuelGagne.length, visuelsChanges: visuelChange.length, fichesChangees: fichesChangees.length }, garde: { baisses: cmp.baisses.length, nonAutorisees: cmp.nonAutorisees.length, hausses: cmp.hausses, annonce }, echantillon };

        if (ECRIRE) {
            const simule = fs.existsSync(fichier('manifeste.json')) ? fs.readFileSync(fichier('manifeste.json'), 'utf8') : null;
            if (simule !== null && !E.memeSelection(JSON.parse(simule), SELECTION)) { console.error(`❌ ARRÊT : la sélection de la simulation (${JSON.stringify(JSON.parse(simule).sets ?? null)}) n'est pas celle du jour (${SELECTION.join(',')}) — relancer la simulation avec les mêmes --sets — rien n'est écrit`); process.exitCode = 1; return; }
            if (simule === null || JSON.stringify(JSON.parse(simule)) !== JSON.stringify(manifeste)) { console.error('❌ ARRÊT : le lot d\'aujourd\'hui n\'est pas celui de la simulation (manifeste.json) : relancer la simulation et relire son diff — rien n\'est écrit'); process.exitCode = 1; return; }
        } else {
            const existant = fs.existsSync(fichier('manifeste.json')) ? JSON.parse(fs.readFileSync(fichier('manifeste.json'), 'utf8')) : null;
            const d = E.decisionManifeste(existant, manifeste);
            if (!d.ecrire) console.log(`⚠️ manifeste.json, diff.json et diff.md NON réécrits : ${d.raison}`);
            else {
                fs.writeFileSync(fichier('diff.json'), JSON.stringify(sortie, null, 1));
                fs.writeFileSync(fichier('manifeste.json'), JSON.stringify(manifeste, null, 1));
                if (Object.keys(annonce).length) fs.writeFileSync(fichier('annonce.json'), JSON.stringify(annonce, null, 1));
                else if (fs.existsSync(fichier('annonce.json'))) fs.rmSync(fichier('annonce.json'));
                fs.writeFileSync(fichier('echantillon.json'), JSON.stringify(echantillon, null, 1));
            }
        }

        if (perdus.length || visuelChange.length || fichesChangees.length) { console.error('🔴 ARRÊT : le lot perd un produit, change une image déjà servie, ou change une fiche.'); process.exitCode = 1; return; }
        if (!ECRIRE) { console.log(`(simulation — fichiers dans ${SORTIE} ; écriture : lot-additif.js … -- node poser-images-empruntees.js ${SELECTION ? `--sets=${SELECTION.join(',')} ` : '--sets=<obligatoire> '}--sortie=${SORTIE} --attendu=${ops.length} --ecrire)`); return; }

        // ── l'écriture : exactement le lot simulé
        const arret = E.motifDArret({ nbOperations: ops.length, nbRefus: plan.refus.length, attendu: ATTENDU });
        if (arret) { console.error(`❌ ARRÊT : ${arret}`); process.exitCode = 1; return; }
        fs.copyFileSync(fichier('manifeste.json'), fichier(`manifeste-ecrit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));   // figé avant la première écriture : `--retirer` le préfère
        let touches = 0;
        for (const o of ops) touches += (await cx.dbCartes.collection(o.coll).updateOne(o.filter, o.update, o.options || {})).modifiedCount;
        const relu = E.planifier(await lireEtat(cx.dbCartes), { sets: SELECTION });
        console.log(`${touches === ops.length && relu.ajouts.length === 0 ? '✅' : '🔴'} écrites ${touches}/${ops.length} · relu : plan restant ${relu.ajouts.length} (0 attendu)`);
        if (touches !== ops.length || relu.ajouts.length) process.exitCode = 1;
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });

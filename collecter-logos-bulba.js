// ============================================================
// LES LOGOS OFFICIELS « BULBAPEDIA SEULE » — route A (zéro requête) et route B (inerte jusqu'à la sonde du 15/10)
// ============================================================
//   node collecter-logos-bulba.js                                  (SIMULATION des deux routes : lit la base et NOTRE R2, AUCUNE requête, n'écrit rien)
//   node lot-additif.js --quoi="logos officiels Bulbapedia, route A" --collections=sets -- node collecter-logos-bulba.js --route=A --ecrire
//   node lot-additif.js --quoi="logos officiels Bulbapedia, route B" --collections=sets -- node collecter-logos-bulba.js --route=B --cache=<dossier> --pokecardex=<racine> --ecrire
// Route B : refuse de partir sans le feu vert de la sonde (collecte-cartes/logos-bulba.js : feuVertSonde) ; la simulation ne fait JAMAIS de requête.
// Tout est dans collecte-cartes/logos-bulba.js (testé : test-logos-bulba.js) ; ce fichier ne fait que brancher la base, R2, le verrou global et le client existant.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTORISES = [/^--route=(A|B)$/, /^--cache=.+$/, /^--pokecardex=.+$/, /^--rapport=.+\.json$/, /^--ecrire$/];
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const dodo = ms => new Promise(r => setTimeout(r, ms));

if (require.main === module) (async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --route=A|B, --cache=, --pokecardex=, --rapport=, --ecrire`); process.exit(2); }
    const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ECRIRE = process.argv.includes('--ecrire');
    const ROUTE = arg('route') ?? null;
    if (ECRIRE && !ROUTE) { console.error('❌ --ecrire exige --route=A ou --route=B (une route à la fois)'); process.exit(2); }
    if (ECRIRE && ROUTE === 'B' && !arg('cache')) { console.error('❌ --route=B --ecrire exige --cache=<dossier> : un fichier obtenu ne se redemande pas'); process.exit(2); }

    const B = require('./collecte-cartes/logos-bulba');
    const E = require('./collecte-cartes/bulba-espacement');
    const bulba = require('./collecte-cartes/bulba');
    const r2 = require('./collecte-cartes/r2');
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'logos-officiels-table.json'), 'utf8'));
    const cx = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES', 'R2_BUCKET_BRUT'] });
    const bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);   // l'archive des pages (lecture seule) : seconde preuve du set, route A
    const S = cx.cartes.db.collection('sets');
    const docs = await S.find({}, { projection: { tirage: 1, region: 1, code: 1, nomJa: 1, nomEn: 1, nomAffichage: 1, nomJaTraduit: 1, 'bulba.titre': 1, 'bulba.cleR2': 1, logo: 1, logoOfficiel: 1 } }).toArray();
    if (!docs.length) throw new Error('collection sets vide : base fausse');
    const setsParId = new Map(docs.map(d => [d._id, d]));
    const tcgdexJa = (await cx.cartes.db.collection('tcgdex_sets').findOne({ _id: 'ja/__liste__' }))?.sets ?? null;
    const { lignes, nonPromues } = B.candidats(table, setsParId, { tcgdexJa });
    console.log(`DÉNOMINATEUR : ${table.lignes.length} lignes dans la table · ${lignes.length} candidats Bulbapedia (OFFICIEL + À REGARDER promus) · ${nonPromues.length} À REGARDER Bulbapedia non promus · ${docs.length} sets en base · lot ${B.LOT_BULBA}`);
    for (const n of nonPromues) console.log(`   ⚪ ${n.ligne.fichier} : ${n.raison}`);

    const A = await B.collecterA({ lignes, setsParId, lireOctets: cle => r2.lireBinaire(bucket, cle), lirePage: cle => r2.lireTexte(process.env.R2_BUCKET_BRUT, cle), S, r2, bucket, ecrire: ECRIRE && ROUTE === 'A' });
    const ligneDe = x => `${x.ligne.cible} ${x.ligne.set ?? '∅'} (${x.ligne.fichier})`;
    console.log(`\nROUTE A (zéro requête) : ${A.parRoute.A.length} à poser (octets déjà chez nous) · ${A.deja.length} déjà posés au même sha256 · ${A.doublons.length} doublons · ${A.parRoute.B.length} pour la route B · ${A.refus.length} refusés/écartés`);
    for (const it of A.parRoute.A) console.log(`   ✅ A  ${ligneDe(it)} ← sets.logo « ${it.logo.fichier} » (${it.logo.cleR2}) · ${it.d.preuve}${it.confirmationPage ? ` · SET CONFIRMÉ : ${it.confirmationPage}` : ''}`);
    for (const x of A.deja) console.log(`   ♻️  deja ${ligneDe(x)}`);
    for (const x of A.doublons) console.log(`   ♻️  doublon ${ligneDe(x)} = ${x.meme}`);
    for (const x of A.parRoute.B) console.log(`   ⏭️  B  ${ligneDe(x)} : ${x.raison}`);
    for (const x of A.refus) console.log(`   🔴 ${x.action} ${ligneDe(x)} : ${x.raison}`);
    if (ECRIRE && ROUTE === 'A') {
        const relus = await S.countDocuments({ 'logoOfficiel.ja.lot': B.LOT_BULBA });
        console.log(`\nÉCRIT (route A) : ${A.ecrits.length} sets · ${A.copiesR2} copies R2→R2 (image + vignette) · RELU : ${relus} sets portent un logoOfficiel du lot ${B.LOT_BULBA}`);
        if (A.refus.some(x => x.action === 'refus' && /champ est apparu|présente déjà|porte déjà/.test(x.raison))) process.exitCode = 1;
    }

    // ── route B : le plan (sans réseau) et la garde
    const planB = A.parRoute.B.map(x => ({ ligne: x.ligne, set: x.ligne.set, url: x.plan.url, nom: x.plan.nom }));
    const etatCol = cx.cartes.db.collection('collecte_images_etat');
    const etat = await etatCol.findOne({ _id: E.ID_ETAT });
    const fv = B.feuVertSonde(etat, Date.now());
    console.log(`\nROUTE B (inerte, plafond ${B.PLAFOND_REQUETES} requêtes) : ${planB.length} fichiers seraient demandés à archives.bulbagarden.net (+1 robots.txt), à ${bulba.DELAI_MS / 1000} s d'écart ≈ ${Math.ceil((planB.length + 1) * bulba.DELAI_MS / 60000)} min · FEU VERT DE LA SONDE : ${fv.ok ? 'OUI' : `NON — ${fv.raison}`}`);
    for (const p of planB) console.log(`   → ${p.set} : ${p.url}`);

    if (arg('rapport')) fs.writeFileSync(arg('rapport'), JSON.stringify({ lot: B.LOT_BULBA, le: new Date().toISOString(), A: A.parRoute.A.map(i => ({ set: i.set, fichier: i.ligne.fichier, logo: i.logo.fichier })), deja: A.deja.map(ligneDe), B: planB.map(p => ({ set: p.set, url: p.url })), refus: A.refus.map(x => ({ ligne: ligneDe(x), action: x.action, raison: x.raison })), feuVert: fv }, null, 1));

    if (!(ECRIRE && ROUTE === 'B')) {
        if (!ECRIRE) console.log('\n(simulation seule : rien n\'est écrit en base ni sur R2, aucune requête réseau)');
        await cx.fermer(); return;
    }

    // ── route B, écriture : le feu vert d'abord, puis le verrou global, puis le client existant
    if (!fv.ok) { console.error(`🛑 route B refusée : ${fv.raison}. Lancer d'abord : node sonde-bulba.js --je-confirme-une-seule-requete --noter (après ${new Date(B.SONDE_APRES_MS).toISOString()})`); await cx.fermer(); process.exit(1); }
    if (!planB.length) { console.log('rien à demander.'); await cx.fermer(); return; }
    const cache = path.resolve(arg('cache')); fs.mkdirSync(cache, { recursive: true });
    const racine = arg('pokecardex') || path.join(__dirname, '..', 'pokemon-proxy');
    const { modeles } = require('./collecte-cartes/schemas');
    const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
    const M = modeles(cx.cartes);
    let verrouPerdu = false;
    const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: 'bulbapedia/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'logos' }, surPerte: () => { verrouPerdu = true; }, nom: 'verrou global bulbapedia (logos officiels)' });
    let bilan = null;
    try {
        // tout le câblage (plafond, feu vert relu après la prise du verrou et avant chaque requête, attente bornée, pause après robots.txt, arrêt = DEFI écrit)
        // est dans collecte-cartes/logos-bulba.js : lancerRouteB, testé par test-logos-bulba-cablage.js
        const clientRobots = E.fabriquerClientDirect(fetch, 'https://archives.bulbagarden.net/robots.txt');
        const pokecardexDe = async ligne => { const f = path.join(racine, ligne.fichier); if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f); return sha256(b) === ligne.pokecardexSha256 ? b : null; };
        console.log(`PLAFOND : ${B.PLAFOND_REQUETES} requêtes au plus (robots.txt + fichiers) pour ${planB.length} fichiers.`);
        const r = await B.lancerRouteB({ plan: planB, etatCol, verrou, lireRobotsBrut: clientRobots, telecharger: url => bulba.telecharger(url), cache, pokecardexDe, estPerdu: () => verrouPerdu, journal: m => console.log(m) });
        console.log(`\nROUTE B : ${r.fichiers.length} fichiers obtenus · ${r.refus.length} refusés · requêtes comptées ${r.requetes}/${B.PLAFOND_REQUETES} · requêtes réseau réelles de la file bulba.js (sauts compris) : ${bulba.compteRequetes()}${r.arret ? ` · ARRÊT : ${r.arret}` : ''}`);
        for (const x of r.refus) console.log(`   🔴 ${ligneDe(x)} : ${x.raison}`);
        bilan = { ecrits: 0, deja: 0, refus: 0 };
        const dd = M_reduire(r.fichiers);
        for (let i = 0; i < r.fichiers.length; i++) {
            const f = r.fichiers[i];
            if (dd[i].action !== 'ecrire') { console.log(`   ♻️  ${dd[i].action} ${ligneDe(f)}`); continue; }
            const setDoc = await S.findOne({ _id: f.set }, { projection: { tirage: 1, region: 1, code: 1, nomEn: 1, nomAffichage: 1, nomJaTraduit: 1, 'bulba.titre': 1 } });
            const e = await B.ecrireB({ S, r2, bucket, item: f, setDoc });
            bilan[e.action === 'ecrit' ? 'ecrits' : e.action === 'deja' ? 'deja' : 'refus']++;
            if (e.action === 'refus') console.log(`   🔴 ${ligneDe(f)} : ${e.raison}`);
        }
        console.log(`ÉCRIT (route B) : ${JSON.stringify(bilan)} · RELU : ${await S.countDocuments({ 'logoOfficiel.ja.lot': B.LOT_BULBA })} sets portent un logoOfficiel du lot ${B.LOT_BULBA}`);
        if (r.arret || bilan.refus) process.exitCode = 1;
    } finally { await verrou.rendre(); console.log('🔓 verrou rendu.'); await cx.fermer(); }
})().catch(e => { console.error(e); process.exit(1); });

function M_reduire(fichiers) { return require('./collecter-logos-officiels').reduireDoublons(fichiers.map(f => ({ ligne: f.ligne, sha256: f.sha256 }))); }

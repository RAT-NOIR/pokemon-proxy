'use strict';
// ============================================================
// CALIBRATION de collecte-cartes/concordance-image.js — LECTURE SEULE
// ============================================================
// Lit la base `cartes` (find / aggregate uniquement : AUCUNE écriture) et les objets R2 de NOS visuels (bucket R2_BUCKET_IMAGES, lecture).
// Aucune requête vers un site tiers. Cache local et sortie : C:\Users\Yung\rat-market-travail\catalogue\couverture\S8\CONCORDANCE\
//
// CLASSES (clé d'un visuel = carteId + set + numero ; la collection `images` porte plusieurs documents par clé quand plusieurs sources ont collecté) :
//   positif                  : même (carteId, set, numero), deux SOURCES différentes, sha256 différents (une copie octet pour octet ne prouve rien)
//   negatif-ordinaire        : deux cartes différentes (carteId différent) du même set
//   negatif-dur-illustration : même carteId, autre set, illustrateurs lus DIFFÉRENTS (réimpression réillustrée)
//   negatif-dur-meme-dessin  : même carteId, autre set, MÊME illustrateur — proxy de « même illustration, autre tirage » : l'image ne PEUT PAS trancher.
//                              Limite de l'instrument, mesurée à part, jamais réglée par seuil. (Même illustrateur ≠ preuve du même dessin : c'est un proxy.)
// Usage : node calibrer-concordance.js [--n=300] [--graine=20261025]
require('dotenv').config({ path: 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\.env' });   // le worktree n'a pas de .env ; lecture seule
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const C = require('./collecte-cartes/concordance-image');

const SORTIE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\CONCORDANCE';
const CACHE = path.join(SORTIE, 'cache');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const N = arg('n', 300), GRAINE = arg('graine', 20261025);
const rnd = (() => { let x = GRAINE >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; })();
const jetons = (s) => new Set(String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9぀-鿿]+/).filter(Boolean));
const choisir = (t) => t[Math.floor(rnd() * t.length)];
const melanger = (t) => { const a = [...t]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function image(doc) {
    const f = path.join(CACHE, doc.cleR2.replace(/[\\/:*?"<>|]/g, '_'));
    if (fs.existsSync(f)) return fs.readFileSync(f);
    const buf = await r2.lireBinaire(process.env.R2_BUCKET_IMAGES, doc.cleR2);
    fs.writeFileSync(f, buf);
    return buf;
}
async function enParallele(items, k, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: k }, async () => { while (i < items.length) { const m = i++; out[m] = await fn(items[m], m); } }));
    return out;
}

(async () => {
    fs.mkdirSync(CACHE, { recursive: true });
    const { cartes, fermer } = await ouvrirConnexions({ buckets: ['R2_BUCKET_IMAGES'], production: false, lectureSeule: true });
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
    const docs = await cartes.db.collection('images').find(
        { etat: 'ok', carteId: { $type: 'number' }, cleR2: { $type: 'string' }, sha256: { $type: 'string' }, set: { $type: 'string' } },
        { projection: { source: 1, carteId: 1, set: 1, numero: 1, cleR2: 1, sha256: 1, illustrateur: 1, langue: 1, w: 1, h: 1 } }).toArray();
    console.log(`documents images lisibles (etat ok, carteId, set, cleR2, sha256) : ${docs.length}`);

    // ── constitution des paires ──
    const parCle = new Map(), parSet = new Map(), parCarte = new Map();
    for (const d of docs) {
        const k = `${d.carteId}|${d.set}|${d.numero ?? ''}`;
        (parCle.get(k) || parCle.set(k, []).get(k)).push(d);
        (parSet.get(d.set) || parSet.set(d.set, []).get(d.set)).push(d);
        (parCarte.get(d.carteId) || parCarte.set(d.carteId, []).get(d.carteId)).push(d);
    }
    // l'illustrateur d'un visuel peut être porté par l'autre source de la même clé (carteId, set, numero) : on le lui prête (même impression, donc même illustrateur)
    // ET, faute de mieux sur `images` (l'illustrateur n'y est porté que par artofpkm), par les IMPRESSIONS de la carte : numéro identique, un seul illustrateur lu (sinon ambigu : rien)
    const nn = (x) => String(x ?? '').replace(/^0+(?=\d)/, '').toLowerCase();
    const parId = new Map();
    for await (const c of cartes.db.collection('cartes').find({ 'impressions.illustrateur': { $type: 'string' } }, { projection: { 'impressions.numero': 1, 'impressions.illustrateur': 1 } })) parId.set(c._id, c.impressions || []);
    let illustrateursPretes = 0;
    for (const g of parCle.values()) { const i = g.find(d => d.illustrateur)?.illustrateur; if (i) for (const d of g) if (!d.illustrateur) { d.illustrateur = i; illustrateursPretes++; } }
    for (const d of docs) {
        if (d.illustrateur || d.numero == null) continue;
        const ills = new Set((parId.get(d.carteId) || []).filter(i => i.illustrateur && nn(i.numero) === nn(d.numero)).map(i => i.illustrateur));
        if (ills.size === 1) { d.illustrateur = [...ills][0]; illustrateursPretes++; }
    }
    await fermer();
    const denominateurs = { documents: docs.length, cles: parCle.size, illustrateursPretes, documentsAvecIllustrateur: docs.filter(d => d.illustrateur).length };
    const positifs = []; let copiesIdentiques = 0, groupesMultiSources = 0;
    const cles = melanger([...parCle.values()]);
    for (const g of cles) {
        const sources = new Set(g.map(d => d.source)); if (sources.size < 2) continue; groupesMultiSources++;
        const a = choisir(g), autres = g.filter(d => d.source !== a.source); const b = choisir(autres);
        if (a.sha256 === b.sha256) { copiesIdentiques++; continue; }
        if (positifs.length < N) positifs.push({ a, b, classe: 'positif' });
    }
    denominateurs.groupesMultiSources = groupesMultiSources; denominateurs.copiesIdentiquesEcartees = copiesIdentiques;
    const ordinaires = [];
    const sets = melanger([...parSet.keys()]);
    for (let t = 0; ordinaires.length < N && t < N * 50; t++) {
        const s = parSet.get(sets[t % sets.length]); if (s.length < 2) continue;
        const a = choisir(s), b = choisir(s);
        // négatifs INTER-SOURCES, comme l'usage réel (deux sources qui doivent concorder) : deux scans artofpkm de cartes différentes partagent cadre et gabarit, ce qui gonfle ORB sans rapport avec la règle
        if (a.carteId !== b.carteId && a.sha256 !== b.sha256 && a.source !== b.source) ordinaires.push({ a, b, classe: 'negatif-ordinaire' });
    }
    const dursIll = [], dursMeme = [];
    const multi = melanger([...parCarte.values()].filter(g => new Set(g.map(d => d.set)).size >= 2));
    denominateurs.cartesMultiSets = multi.length;
    for (const g of multi) {
        const avecIll = g.filter(d => d.illustrateur);
        for (let t = 0; t < 12 && (dursIll.length < N || dursMeme.length < N); t++) {
            if (avecIll.length < 2) break;
            const a = choisir(avecIll), b = choisir(avecIll);
            if (a.set === b.set || a.sha256 === b.sha256 || a.source === b.source) continue;   // inter-sources, voir plus haut
            // les sources écrivent l'illustrateur à leur façon (« Mitsuhiro Arita » / « Arita Mitsuhiro » / « 5ban Graphics ») : même = mêmes jetons ; DIFFÉRENT seulement si AUCUN jeton commun ; entre les deux = ambigu, écarté
            const ta = jetons(a.illustrateur), tb = jetons(b.illustrateur);
            const commun = [...ta].filter(x => tb.has(x)).length;
            const meme = ta.size === tb.size && commun === ta.size;
            const different = commun === 0;
            if (meme && dursMeme.length < N) { dursMeme.push({ a, b, classe: 'negatif-dur-meme-dessin' }); break; }
            if (different && dursIll.length < N) { dursIll.push({ a, b, classe: 'negatif-dur-illustration' }); break; }
        }
    }
    const paires = [...positifs, ...ordinaires, ...dursIll, ...dursMeme];
    const effectifs = { positif: positifs.length, 'negatif-ordinaire': ordinaires.length, 'negatif-dur-illustration': dursIll.length, 'negatif-dur-meme-dessin': dursMeme.length };
    console.log('dénominateurs :', JSON.stringify(denominateurs));
    console.log('paires retenues par classe :', JSON.stringify(effectifs));
    for (const [c, n] of Object.entries(effectifs)) if (n === 0) throw new Error(`classe vide : ${c} — un zéro sur une population non vide se vérifie (clé, filtre, champ) avant d'être cru`);

    // ── mesure ──
    const t0 = Date.now(); let fait = 0;
    const mesures = await enParallele(paires, 6, async (p) => {
        let r;
        try {
            const [ba, bb] = await Promise.all([image(p.a), image(p.b)]);
            const m = await C.concordent(ba, bb, { phashMax: 64, inliersMin: 0, exiger: 'les-deux' });   // seuils grands ouverts : on veut les distributions brutes
            r = { classe: p.classe, a: p.a._id || p.a.cleR2, b: p.b._id || p.b.cleR2, srcA: p.a.source, srcB: p.b.source, setA: p.a.set, setB: p.b.set, illA: p.a.illustrateur ?? null, illB: p.b.illustrateur ?? null, phash: m.phash, inliers: m.inliers, nul: m.concorde === null };
        } catch (e) { r = { classe: p.classe, a: p.a.cleR2, b: p.b.cleR2, nul: true, erreur: e.message }; }
        if (++fait % 100 === 0) console.log(`  ${fait}/${paires.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
        return r;
    });

    // ── analyse ──
    const classes = Object.keys(effectifs);
    const par = Object.fromEntries(classes.map(c => [c, mesures.filter(m => m.classe === c)]));
    const quant = (t, q) => { if (!t.length) return null; const s = [...t].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const distrib = {};
    for (const c of classes) {
        const ok = par[c].filter(m => !m.nul), ph = ok.map(m => m.phash), inl = ok.map(m => m.inliers);
        distrib[c] = { paires: par[c].length, illisibles: par[c].length - ok.length,
            phash: { min: Math.min(...ph), p10: quant(ph, .1), p50: quant(ph, .5), p90: quant(ph, .9), max: Math.max(...ph) },
            inliers: { min: Math.min(...inl), p10: quant(inl, .1), p50: quant(inl, .5), p90: quant(inl, .9), max: Math.max(...inl) } };
    }
    const accepte = (m, S) => !m.nul && (S.exiger === 'phash' ? m.phash <= S.phashMax : S.exiger === 'orb' ? m.inliers >= S.inliersMin : (m.phash <= S.phashMax && m.inliers >= S.inliersMin));
    const grille = [];
    for (const exiger of ['les-deux', 'phash', 'orb'])
        for (let phashMax = 0; phashMax <= 24; phashMax += (exiger === 'orb' ? 100 : 1))
            for (const inliersMin of (exiger === 'phash' ? [0] : [6, 8, 10, 12, 15, 20, 25, 30, 40, 60]))
                if (exiger !== 'orb' || phashMax === 0) {
                    const S = { exiger, phashMax: exiger === 'orb' ? 64 : phashMax, inliersMin };
                    const faux = Object.fromEntries(classes.filter(c => c !== 'positif').map(c => [c, par[c].filter(m => accepte(m, S)).length]));
                    const vraisAcceptes = par.positif.filter(m => accepte(m, S)).length;
                    grille.push({ ...S, vraisAcceptes, vraisPerdus: par.positif.length - vraisAcceptes, faux });
                }
    // retenue : 0 faux sur les négatifs ordinaires ET durs-illustration (le dur-meme-dessin est une limite, jamais un critère de réglage), recall maximal ; à égalité, la configuration la plus STRICTE
    const sansFaux = grille.filter(g => g.faux['negatif-ordinaire'] === 0 && g.faux['negatif-dur-illustration'] === 0);
    sansFaux.sort((x, y) => y.vraisAcceptes - x.vraisAcceptes || x.phashMax - y.phashMax || y.inliersMin - x.inliersMin);
    const retenue = sansFaux[0] || null;
    // marge : plus petite distance/plus grand inlier des négatifs — le seuil retenu doit en être éloigné pour ne pas coller à l'échantillon
    const negatifsRegles = [...par['negatif-ordinaire'], ...par['negatif-dur-illustration']].filter(m => !m.nul);
    const marge = { phashMinNegatifs: Math.min(...negatifsRegles.map(m => m.phash)), inliersMaxNegatifs: Math.max(...negatifsRegles.map(m => m.inliers)) };
    const limite = retenue ? { paires: par['negatif-dur-meme-dessin'].length, acceptesAuSeuilRetenu: par['negatif-dur-meme-dessin'].filter(m => accepte(m, retenue)).length } : null;

    const sortie = { date: new Date().toISOString(), graine: GRAINE, n: N, denominateurs, effectifs, distrib, marge, retenue, limiteMemeDessinAutreTirage: limite, grille,
        positifsLesPlusLoin: [...par.positif].filter(m => !m.nul).sort((x, y) => y.phash - x.phash).slice(0, 15),
        faussesAlertes: retenue ? mesures.filter(m => m.classe !== 'positif' && m.classe !== 'negatif-dur-meme-dessin' && accepte(m, retenue)) : [] };
    fs.writeFileSync(path.join(SORTIE, 'calibration.json'), JSON.stringify(sortie, null, 1), 'utf8');

    fs.writeFileSync(path.join(SORTIE, 'mesures.json'), JSON.stringify(mesures), 'utf8');
    console.log('\n=== DISTRIBUTIONS (pHash : distance de Hamming ; inliers ORB) ===');
    for (const c of classes) console.log(`${c.padEnd(26)} n=${distrib[c].paires} illisibles=${distrib[c].illisibles}  pHash ${JSON.stringify(distrib[c].phash)}  inliers ${JSON.stringify(distrib[c].inliers)}`);
    console.log('marge négatifs réglants :', JSON.stringify(marge));
    console.log('\n=== SEUIL RETENU ===', JSON.stringify(retenue));
    console.log('limite « même dessin, autre tirage » au seuil retenu :', JSON.stringify(limite));
    console.log('\n=== quelques seuils (faux acceptés par classe négative ; vrais perdus sur', par.positif.length, 'positifs) ===');
    for (const g of grille.filter(g => (g.exiger === 'les-deux' && [6, 8, 10, 12, 14].includes(g.phashMax) && [12, 20, 30].includes(g.inliersMin)) || (g.exiger === 'phash' && [4, 8, 12].includes(g.phashMax)) || (g.exiger === 'orb' && [12, 20, 30, 60].includes(g.inliersMin))))
        console.log(`${g.exiger.padEnd(8)} phash<=${String(g.phashMax).padStart(2)} inl>=${String(g.inliersMin).padStart(2)} | perdus ${String(g.vraisPerdus).padStart(3)} | faux ${JSON.stringify(g.faux)}`);
    console.log('\nécrit :', path.join(SORTIE, 'calibration.json'));
    process.exit(0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });

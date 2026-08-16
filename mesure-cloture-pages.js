// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE (voir le septième principe, scoring.js)
// ============================================================================
// On APPELLE la chaîne, on ne la réimplémente pas. Tout ce qui est écarté est compté et
// nommé. Les divergences avec la production sont déclarées en tête de sortie.
// La vérité est rattachée par IDENTITÉ COMPLÈTE via banc-seaux.js — jamais par `nom` ni
// par `nom|numéro`, clés qui ont déjà contaminé le banc quatre fois.
// LECTURE SEULE : aucune écriture, aucun réseau, aucune installation.
//
// ============================================================================
// TROIS QUESTIONS, ET L'UNITÉ DE COÛT EST LA PAGE DE GALERIE
// ============================================================================
// A. La population mesurable est celle des lignes dont le groupe d'ÉGALITÉ compte AU
//    MOINS DEUX membres. Un groupe d'un seul membre veut dire que le scoring A tranché :
//    il n'y a rien à départager, et un embedding n'y changerait rien.
// B. Le coût se compte en PAGES DE GALERIE CHARGÉES, pas en produits. C'est le
//    chargement de page qui coûte du temps humain et qui expose à Cloudflare.
// C. Les lignes à groupe d'UN membre relèvent d'autres chantiers : on les sépare par
//    cause, et pour `aucun-candidat` on demande où est la vérité.
// USAGE : node mesure-cloture-pages.js --base=<nom> [--parPage=20]
process.env.MONGODB_BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] || '';
if (!process.env.MONGODB_BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
require('dotenv').config();
const mongoose = require('mongoose');
const SCORING = require('./scoring');
const { sontExAequo } = SCORING;
const SEAUX = require('./banc-seaux');
const { EXPANSIONS_VINTAGE, SETS_VINTAGE_JAPONAIS, setCodeCompatibleVintage } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets } = require('./index');

// ⚠️ CARTES PAR PAGE : ESTIMÉ, PAS MESURÉ. Je n'ai jamais chargé une galerie Cardmarket
// (elles refusent mes requêtes). Le diagnostic console compte les `a.galleryBox img` de
// la page et donnera le chiffre réel ; en attendant on encadre 20 et 30.
const PAR_PAGE = Number(process.argv.find(a => a.startsWith('--parPage='))?.split('=')[1]) || 20;
const PAGES = (produits, n) => Math.ceil(produits / n);

const codeParExp = new Map(SETS_VINTAGE_JAPONAIS.filter(s => s.exp != null).map(s => [s.exp, s.code]));
const prodParCode = new Map(SETS_VINTAGE_JAPONAIS.map(s => [s.code, s.prod]));
const ASIAT = ['JP', 'ZH', 'KR'];

(async () => {
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.db.databaseName !== process.env.MONGODB_BASE) { console.error('❌ mauvaise base.'); process.exit(1); }
    const db = mongoose.connection.db;
    const J = db.collection('journal_scans'), CAT = db.collection('catalogue_produits');

    console.log('⚠️ DIVERGENCES DÉCLARÉES : `expansionsAttendues` passé VIDE (absent des lignes');
    console.log('   de refus) ; `photos[0]` null (sans effet, comparaison d\'images retirée) ;');
    console.log('   `numeroBrutPourScoring` comme en production.');
    console.log(`⚠️ CARTES PAR PAGE = ${PAR_PAGE} — ESTIMÉ, jamais mesuré. Le diagnostic console tranchera.\n`);

    const refus = (await J.find({ route: 'identifier', motifEchec: { $ne: null } }).sort({ le: 1 }).toArray())
        .filter(l => ASIAT.includes(String(l.langue || '').toUpperCase()) && l.nom);

    const lignes = [], ecartees = [];
    for (const l of refus) {
        const vivier = await trouverProduitsLocaux(l.nom);
        if (!vivier.length) { ecartees.push({ l, raison: 'vivier par le nom VIDE' }); continue; }
        const compat = setCodeCompatibleVintage(l.setCode, SCORING);
        const dedans = vivier.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
        const effectif = (compat.compatible && dedans.length) ? dedans : vivier;
        const estDexLigne = l.estDex === true || (l.numero != null && l.total == null);
        const cardInfo = { name: l.nom, number: estDexLigne ? null : l.numero, total: l.total, setCode: l.setCode, language: l.langue, rarete: l.rarete, rareteElevee: false };
        let r;
        try {
            const cs = await lireCodeSets(effectif.map(p => p.idExpansion));
            r = await scorerCandidatsLocal(effectif, cardInfo, null, [], cs, { numeroBrutPourScoring: l.numero });
        } catch (e) { ecartees.push({ l, raison: `scoring en erreur : ${e.message}` }); continue; }
        if (!r.scores?.length) { ecartees.push({ l, raison: 'aucun score' }); continue; }
        const tete = r.scores[0].score;
        const exaequo = r.scores.filter(s => sontExAequo(s.score, tete));
        const sets = new Set();
        let hors = 0;
        for (const s of exaequo) { const c = codeParExp.get(Number(s.candidat.idExpansion)); if (c) sets.add(c); else hors++; }
        lignes.push({ l, taille: exaequo.length, sets, hors, exaequo });
    }
    console.log(`refus asiatiques nommés : ${refus.length}   ·   écartées : ${ecartees.length}`);
    for (const e of ecartees) console.log(`   ÉCARTÉE "${e.l.nom}" n°${e.l.numero ?? '—'} : ${e.raison}`);

    // ── A. LA POPULATION MESURABLE ──────────────────────────────────────
    const mesurables = lignes.filter(x => x.taille >= 2);
    const singletons = lignes.filter(x => x.taille < 2);
    console.log(`\n   groupe d'égalité ≥ 2 (MESURABLES) : ${mesurables.length}`);
    console.log(`   groupe d'égalité = 1 (rien à départager) : ${singletons.length}`);

    // ── C. LES SINGLETONS, PAR CAUSE ────────────────────────────────────
    console.log('\n' + '═'.repeat(88));
    console.log('LES SINGLETONS — 21 % DES REFUS QUE CE CHANTIER VISAIT, ET CE N\'EST PAS DE L\'AMBIGUÏTÉ');
    console.log('═'.repeat(88));
    const parCause = new Map();
    for (const x of singletons) parCause.set(x.l.motifEchec, [...(parCause.get(x.l.motifEchec) || []), x]);
    for (const [cause, lot] of parCause) {
        console.log(`\n── ${cause} : ${lot.length} ligne(s)`);
        for (const x of lot) {
            console.log(`   "${x.l.nom}" n°${x.l.numero ?? '—'}  gagnant unique ${x.exaequo[0].candidat.idProduct} ` +
                `(${[...x.sets][0] ?? 'hors périmètre'})`);
        }
        if (cause === 'erreur-serveur') console.log('   -> C\'EST UN BUG. Il se répare, il ne coûte rien, et aucune image ne l\'aiderait.');
        if (cause === 'egalite-parfaite') {
            console.log('   -> ⚠️ CONTRADICTION : la production a refusé POUR ÉGALITÉ, et mon rejeu n\'en');
            console.log('      trouve aucune. Soit ma reproduction diverge (expansionsAttendues vide),');
            console.log('      soit le vivier de production n\'était pas celui-ci. À ne PAS compter');
            console.log('      comme « rien à départager » tant que ce n\'est pas tranché.');
        }
    }

    // ── C bis. LES `aucun-candidat` : où est la vérité ? ────────────────
    const sansCandidat = singletons.filter(x => x.l.motifEchec === 'aucun-candidat');
    if (sansCandidat.length) {
        console.log('\n' + '═'.repeat(88));
        console.log('POUR LES `aucun-candidat` : LA VÉRITÉ EST-ELLE AU CATALOGUE, ET DANS LA TABLE CLOSE ?');
        console.log('═'.repeat(88));
        // ⚠️ Vérité rattachée par IDENTITÉ COMPLÈTE via banc-seaux — jamais par le nom.
        let verites = [];
        try { verites = require('./banc-verites.json').verites || []; }
        catch (_) { console.log('   ⚠️ banc-verites.json illisible : aucune vérité rattachable, on ne conclut pas.'); }
        const { lignes: numerotees } = SEAUX.numeroter(refus);
        const { parIdentite } = SEAUX.rattacherVerites(numerotees, verites);
        for (const x of sansCandidat) {
            const v = parIdentite.get(SEAUX.identiteDe(x.l));
            if (!v || v.idProduct == null) { console.log(`   "${x.l.nom}" n°${x.l.numero ?? '—'} : AUCUNE vérité saisie -> on ne conclut pas.`); continue; }
            const p = await CAT.findOne({ idProduct: Number(v.idProduct) });
            if (!p) { console.log(`   "${x.l.nom}" : vérité ${v.idProduct} ABSENTE DU CATALOGUE -> chantier « catalogue incomplet ».`); continue; }
            const dansTable = EXPANSIONS_VINTAGE.has(Number(p.idExpansion));
            console.log(`   "${x.l.nom}" n°${x.l.numero ?? '—'} : vérité ${v.idProduct} exp=${p.idExpansion} ` +
                `"${String(p.name).split('[')[0].trim()}" -> ${dansTable ? 'DANS la table close' : '⚠️ HORS table close -> chantier « admission de sets »'}`);
        }
    }

    // ── B. LA COURBE, EN PAGES ──────────────────────────────────────────
    const glouton = (lot) => {
        const choisis = new Set();
        const closes = () => lot.filter(x => [...x.sets].every(k => choisis.has(k))).length;
        const pts = [{ etape: 0, set: '—', prod: 0, closes: closes() }];
        let cumul = 0;
        while (closes() < lot.length) {
            const rest = lot.filter(x => ![...x.sets].every(k => choisis.has(k)));
            const cands = new Set(rest.flatMap(x => [...x.sets]).filter(c => !choisis.has(c)));
            if (!cands.size) break;
            let best = null, gain = -1, cout = Infinity;
            for (const c of cands) {
                const t = new Set([...choisis, c]);
                const g = lot.filter(x => [...x.sets].every(k => t.has(k))).length;
                const p = prodParCode.get(c) ?? 9999;
                if (g > gain || (g === gain && p < cout)) { best = c; gain = g; cout = p; }
            }
            choisis.add(best); cumul += prodParCode.get(best) ?? 0;
            pts.push({ etape: pts.length, set: best, prod: cumul, closes: closes() });
        }
        return pts;
    };

    console.log('\n' + '═'.repeat(88));
    console.log(`COURBE DE COLLECTE — dénominateur : ${mesurables.length} LIGNES MESURABLES (groupe ≥ 2)`);
    console.log('═'.repeat(88));
    const pts = glouton(mesurables);
    console.log(`   ${'sets'.padStart(5)} ${'produits'.padStart(9)} ${'pages@20'.padStart(9)} ${'pages@30'.padStart(9)} ${'CLOSES'.padStart(7)} ${'%'.padStart(5)} ${'pages/ligne'.padStart(12)}   dernier set`);
    for (const p of pts) {
        const pct = Math.round(100 * p.closes / mesurables.length);
        const pg = PAGES(p.prod, 20);
        console.log(`   ${String(p.etape).padStart(5)} ${String(p.prod).padStart(9)} ${String(pg).padStart(9)} ${String(PAGES(p.prod, 30)).padStart(9)} ` +
            `${String(p.closes).padStart(7)} ${String(pct).padStart(4)}% ${(p.closes ? (pg / p.closes).toFixed(1) : '—').padStart(12)}   ${p.set}`);
    }

    // Y a-t-il un COUDE ? Le coût marginal par ligne close, étape par étape.
    console.log('\n   COÛT MARGINAL — pages ajoutées par ligne nouvellement close :');
    let plat = true;
    const marges = [];
    for (let i = 1; i < pts.length; i++) {
        const dPages = PAGES(pts[i].prod, 20) - PAGES(pts[i - 1].prod, 20);
        const dClose = pts[i].closes - pts[i - 1].closes;
        marges.push({ set: pts[i].set, dPages, dClose, ratio: dClose ? dPages / dClose : Infinity });
    }
    for (const m of marges) console.log(`      +${String(m.dPages).padStart(2)} page(s) -> +${m.dClose} ligne(s)   ${m.dClose ? `${m.ratio.toFixed(1)} p/l` : 'AUCUNE'}   (${m.set})`);
    const finis = marges.filter(m => Number.isFinite(m.ratio)).map(m => m.ratio);
    if (finis.length > 2) {
        const debut = finis.slice(0, Math.ceil(finis.length / 3)).reduce((a, b) => a + b, 0) / Math.ceil(finis.length / 3);
        const fin = finis.slice(-Math.ceil(finis.length / 3)).reduce((a, b) => a + b, 0) / Math.ceil(finis.length / 3);
        plat = (fin / debut) < 2;
        console.log(`\n   premier tiers : ${debut.toFixed(1)} pages/ligne   ·   dernier tiers : ${fin.toFixed(1)} pages/ligne`);
        console.log(`   -> ${plat ? 'AUCUN COUDE : le coût par ligne est constant. La décision est BINAIRE, tout ou rien.'
            : 'COUDE PRÉSENT : un segment initial est nettement moins cher, il peut s\'attaquer seul.'}`);
    }
    await mongoose.connection.close();
})().catch(e => { console.error(e.stack); process.exit(1); });

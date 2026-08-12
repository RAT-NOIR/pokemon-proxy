// ============================================================================
// LE TAUX DE RETOUR, ET LA CALIBRATION DE K — mesure seule, lecture seule
// ============================================================================
// USAGE : node mesure-retours-live.js --base=<nom> --depuis=<AAAA-MM-JJ>
//
// DEUX QUESTIONS, ET LA PREMIÈRE COMMANDE LA SECONDE :
//   1. COMBIEN DE RETOURS SE PERDENT ? L'extension lit le prix live après coup et tire
//      sans attendre : une partie des retours n'arrivera jamais. On veut le taux, pas
//      une supposition — un taux de 10 % et un taux de 80 % ne décrivent pas le même
//      instrument, et le second rendrait la calibration très lente.
//   2. DE COMBIEN LE GUIDE S'ÉCARTE-T-IL DU RÉEL ? C'est le rapport prixLive/prixGuide,
//      sur le même idProduct : deux mesures du même objet.
//
// ⚠️⚠️ K SE LIT DANS LA QUEUE HAUTE, JAMAIS DANS LA MÉDIANE.
// Le guide Cardmarket est une TENDANCE GLOBALE — ni par état, ni par langue. Le prix live
// est un PLANCHER FILTRÉ. Un plancher est presque toujours sous une tendance : la masse
// des rapports sera donc inférieure à 1, et cette masse est STRUCTURELLE — elle mesure
// une différence de définition, pas une incertitude.
// Calibrer K sur la médiane reviendrait à prendre cet écart de définition pour une marge
// de sécurité, et le seuil serait beaucoup trop serré : la règle de la fourchette
// annoncerait des verdicts sûrs qui ne le sont pas.
// Ce qui intéresse K, c'est le cas RARE où le plancher réel DÉPASSE la tendance — carte
// recherchée, offre rare, guide en retard. C'est le seul cas où un candidat vaut plus
// cher que son guide ne le laisse croire, donc le seul contre lequel il faut se protéger.
// D'où les quantiles hauts ci-dessous, et l'absence volontaire de moyenne.
//
// ⚠️ STRATIFIÉ PAR ÉTAT ET PAR LANGUE, parce qu'un K unique serait trop lâche sur du NM et
// trop serré sur du GD. Les strates sont affichées même quand elles sont petites : une
// strate à trois lignes ne se calibre pas, et il vaut mieux le voir que l'ignorer.
require('dotenv').config();
const mongoose = require('mongoose');

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
const DEPUIS = process.argv.find(a => a.startsWith('--depuis='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire. La base de production s\'appelle « test ».'); process.exit(1); }
if (!DEPUIS) {
    console.error('❌ --depuis=<AAAA-MM-JJ> obligatoire.');
    console.error('   Les lignes ANTÉRIEURES au déploiement de `scanId` ne pouvaient pas recevoir de');
    console.error('   retour : les compter au dénominateur inventerait un taux de perte de 100 %.');
    process.exit(1);
}
const debut = new Date(`${DEPUIS}T00:00:00Z`);
if (isNaN(debut)) { console.error(`❌ date illisible : « ${DEPUIS} »`); process.exit(1); }

const q = (a, p) => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(p * (t.length - 1)))]; };
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const lignes = await c.collection('journal_scans')
        .find({ route: 'identifier', resultat: 'succes', le: { $gte: debut } }).toArray();

    console.log(`base : ${BASE}   ·   depuis : ${debut.toISOString().slice(0, 10)}`);
    console.log(`\n══ 1. LE TAUX DE RETOUR ══`);
    // Un scanId est émis pour CHAQUE scan abouti : le dénominateur est donc le nombre de
    // ces lignes. Pas de compteur séparé — il divergerait, et on saurait moins de choses.
    const emis = lignes.length;
    const recus = lignes.filter(l => l.prixLive != null).length;
    console.log(`   scanId émis (scans aboutis)   : ${emis}`);
    console.log(`   retours reçus (prixLive écrit): ${recus}   (${pc(recus, emis)})`);
    console.log(`   PERDUS                        : ${emis - recus}   (${pc(emis - recus, emis)})`);
    if (!emis) {
        console.log('\n   ⚠️ aucune ligne sur la période — rien à conclure, ni dans un sens ni dans l\'autre.');
        await c.close(); return;
    }

    // Délai entre le scan et son retour : dit si les pertes sont des retours LENTS ou des
    // retours ABSENTS. Deux problèmes différents, deux correctifs différents.
    const delais = lignes.filter(l => l.retourLe && l.le).map(l => (new Date(l.retourLe) - new Date(l.le)) / 1000);
    if (delais.length) {
        console.log(`   délai scan -> retour (s)      : médiane ${q(delais, .5)?.toFixed(1)} · q90 ${q(delais, .9)?.toFixed(1)} · max ${Math.max(...delais).toFixed(1)}`);
    }

    console.log(`\n══ 2. LE RAPPORT prixLive / prixGuide ══`);
    const paires = lignes
        .filter(l => Number.isFinite(l.prixLive) && Number.isFinite(l.prixGuideRetenu) && l.prixGuideRetenu > 0)
        .map(l => ({ r: l.prixLive / l.prixGuideRetenu, etat: l.prixLiveEtat || '(sans état)', langue: l.prixLiveCodeLangue ?? '(sans langue)', nom: l.nom, id: l.idProduct, live: l.prixLive, guide: l.prixGuideRetenu }));
    console.log(`   paires exploitables : ${paires.length} / ${recus} retour(s)`);
    const sansGuide = lignes.filter(l => Number.isFinite(l.prixLive) && !Number.isFinite(l.prixGuideRetenu)).length;
    if (sansGuide) console.log(`   ⚠️ ${sansGuide} retour(s) SANS prix guide retenu — inexploitables, à diagnostiquer`);

    if (paires.length < 30) {
        console.log(`\n   ⚠️ ÉCHANTILLON INSUFFISANT POUR CALIBRER K.`);
        console.log(`      ${paires.length} paire(s). Un quantile à 95 % sur moins de 30 points est décidé par`);
        console.log(`      un ou deux cas ; il bougerait du simple au double au scan suivant.`);
        console.log(`      On affiche quand même la distribution — pour la regarder, pas pour en tirer un seuil.`);
    }
    if (paires.length) {
        const r = paires.map(p => p.r);
        console.log(`\n   distribution du rapport (1 = le live vaut exactement le guide) :`);
        console.log(`      min ${q(r, 0).toFixed(2)} · médiane ${q(r, .5).toFixed(2)} · q75 ${q(r, .75).toFixed(2)}`);
        console.log(`      q90 ${q(r, .9).toFixed(2)} · q95 ${q(r, .95).toFixed(2)} · q99 ${q(r, .99).toFixed(2)} · MAX ${q(r, 1).toFixed(2)}`);
        const au = r.filter(x => x > 1).length;
        console.log(`\n   ⚠️ LA SEULE PART QUI INTÉRESSE K : ${au}/${r.length} (${pc(au, r.length)}) ont un live AU-DESSUS du guide.`);
        console.log(`      La médiane décrit l'écart de définition tendance/plancher, PAS une incertitude.`);
        console.log(`      K se lit sur q95 ou q99, jamais au centre.`);

        const parStrate = new Map();
        for (const p of paires) {
            const k = `${p.etat} · langue ${p.langue}`;
            if (!parStrate.has(k)) parStrate.set(k, []);
            parStrate.get(k).push(p.r);
        }
        console.log(`\n   par strate (état · langue) :`);
        for (const [k, v] of [...parStrate].sort((a, b) => b[1].length - a[1].length)) {
            console.log(`      ${k.padEnd(28)} n=${String(v.length).padStart(4)}  médiane ${q(v, .5).toFixed(2)}  q95 ${q(v, .95).toFixed(2)}  max ${q(v, 1).toFixed(2)}`
                + (v.length < 30 ? '   ⚠️ trop peu pour calibrer' : ''));
        }

        const hauts = paires.filter(p => p.r > 1).sort((a, b) => b.r - a.r).slice(0, 10);
        if (hauts.length) {
            console.log(`\n   les rapports les plus hauts — c'est CONTRE eux que K protège :`);
            for (const p of hauts) {
                console.log(`      ×${p.r.toFixed(2).padStart(6)}  "${String(p.nom).padEnd(20)}" ${p.id}  guide ${p.guide.toFixed(2)} € -> live ${p.live.toFixed(2)} €  (${p.etat})`);
            }
        }
    }
    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });

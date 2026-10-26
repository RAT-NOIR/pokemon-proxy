'use strict';
// CACHE-ZONES — ce que coûtent les deux caches de ratmarket/zones.js (_scans, _paires), mesuré sur des scans et des photos RÉELS (fixtures du labo, lues en lecture seule ; aucun réseau, aucune base, aucun modèle payant).
//   node v2/mesures/mesurer-cache-zones.js entree [--sans-instrument] [--sortie=f.json]
//       → la mémoire PAR ENTRÉE de _scans et de _paires (RSS, tas JS, externe, WASM), tailles de cache grandes (200), relevé après gc toutes les 8 entrées.
//   node v2/mesures/mesurer-cache-zones.js serie [--taille=32,16,8,4] [--serie=mixte|reel|dracaufeu] [--lignes=N] [--graine=20261026] [--sortie=f.json]
//       → la même SUITE de lignes (ordre fixé par la graine), rejouée une fois par taille (CACHE_SCANS = CACHE_PAIRES = taille, en processus neuf) : RSS final et crête, temps par ligne (p50, p95), taux de réussite des deux caches,
//         et l'EMPREINTE de toutes les sorties (mesures de zones, de paires, décision de la règle G) — elle doit être la même à chaque taille : le cache ne fait que mémoriser.
// Une « ligne » est un scan : la photo redressée de l'essai de la fixture, les mesures que la décision du labo a demandées, puis la décision de ratmarket/decision-g.js rejouée avec ces mesures (comme ratmarket/test-zones.js, dont la boucle est reprise).
// ⚠️ Instrument : l'option sans --sans-instrument arme _embind-vivants (mémoire WASM) ; il retient des enveloppes embind jusqu'au relevé suivant et GONFLE le RSS (rapport FUITE-INLIERS) : les RSS se lisent avec --sans-instrument.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const mode = process.argv[2];
const LABO = 'C:/Users/Yung/Desktop/labo-embedding';
const FIX = `${LABO}/rm/fixtures-g`;
const mo = x => +(x / 1048576).toFixed(2);
const quantile = (xs, q) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };

// ── le PARENT de la série : une exécution par taille, en processus neuf
if (mode === 'serie' && !process.argv.includes('--enfant')) {
    const tailles = arg('taille', '32,16,8,4').split(',').map(Number);
    const sorties = [];
    for (const t of tailles) {
        console.log(`── taille ${t}`);
        const r = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2), '--enfant', `--t=${t}`],
            { env: { ...process.env, RM_CACHE_SCANS: String(t), RM_CACHE_PAIRES: String(t) }, encoding: 'utf8', maxBuffer: 1 << 28 });
        process.stdout.write((r.stdout || '').split('\n').filter(l => !l.startsWith('@@')).join('\n'));
        if (r.status !== 0) { console.log(r.stderr); process.exit(1); }
        sorties.push(JSON.parse(r.stdout.split('\n').find(l => l.startsWith('@@')).slice(2)));
    }
    const ref = sorties[0];
    console.log('\ntaille | RSS final (Mo) | crête (Mo) | p50 (ms) | p95 (ms) | réussite scans | réussite paires | empreinte des sorties');
    for (const s of sorties) console.log(`${String(s.taille).padStart(6)} | ${String(s.rssFinalMo).padStart(14)} | ${String(s.rssCreteMo).padStart(10)} | ${String(s.p50).padStart(8)} | ${String(s.p95).padStart(8)} | ${(100 * s.scansHits / s.scansAppels).toFixed(1).padStart(13)} % | ${(100 * s.pairesHits / s.pairesAppels).toFixed(1).padStart(14)} % | ${s.empreinte.slice(0, 16)}${s.empreinte === ref.empreinte ? '' : '  🔴 DIFFÈRE'}`);
    let diff = 0;
    for (const s of sorties) { const n = s.empreintesLignes.filter((h, i) => h !== ref.empreintesLignes[i]).length; if (n) { diff += n; console.log(`🔴 taille ${s.taille} : ${n} ligne(s) de sortie différente(s) de la taille ${ref.taille}`); } }
    console.log(diff ? `🔴 ${diff} lignes différentes` : `✅ sorties IDENTIQUES à chaque taille (${ref.lignes} lignes, ${ref.mesures} mesures, empreinte ${ref.empreinte.slice(0, 16)})`);
    if (arg('sortie', null)) fs.writeFileSync(arg('sortie'), JSON.stringify(sorties.map(s => ({ ...s, empreintesLignes: undefined })), null, 1));
    process.exit(diff ? 1 : 0);
}

if (!global.gc) { const r = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status); }
const SANS_INSTRUMENT = process.argv.includes('--sans-instrument');
const V = SANS_INSTRUMENT || mode === 'serie' ? { octetsWasm: () => 0, vivants: () => ({ n: -1 }) } : require('../test/_embind-vivants').armer();   // AVANT tout require d'opencv
require('../reglage-sharp').appliquer(require('sharp'), process.env);   // V2_SHARP_CACHE=false|true|memoire:<Mo> rejoue le réglage de l'API v2 (non posé : sharp inchangé)
const Z = require('../../ratmarket/zones'), G = require('../../ratmarket/decision-g');

// ── des sources et des photos RÉELLES (en lecture seule)
const source = f => ({ cle: f, chemin: `${LABO}/cache-visuels/img/${f}` });
const charger = jeu => ({ F: JSON.parse(fs.readFileSync(`${FIX}/${jeu}.json`, 'utf8')), R: new Map(JSON.parse(fs.readFileSync(`${LABO}/rm/requetes/${jeu}.json`, 'utf8')).requetes.map(r => [r.id, r])) });
async function photoDe(sharp, jeu, R, l) {
    const e = l.essai > 0 ? l.essai : (l.nEssais > 1 ? 1 : null);
    if (e === null) return null;
    const { data, info } = await sharp(`${LABO}/rm/requetes/${jeu}/${R.get(l.id).essais[e]}`).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    return Z.photoGrise(data, info.width, info.height);
}
function instantane(etiquette, extra = {}) {
    global.gc(); global.gc();
    const m = process.memoryUsage();
    return { etiquette, rssMo: mo(m.rss), tasMo: mo(m.heapUsed), externeMo: mo(m.external), arrayBuffersMo: mo(m.arrayBuffers), wasmMo: mo(V.octetsWasm() || 0), enScans: Z._scans.size, enPaires: Z._paires.size, ...extra };
}
/** Moindres carrés à deux variables (y ≈ c + a·x1 + b·x2) → [a, b] : la part du RSS due aux paires, une fois retirée celle des scans qui s'accumulent en même temps. */
function regression2(x1, x2, y) {
    const n = y.length, m = v => v.reduce((a, b) => a + b, 0) / n, m1 = m(x1), m2 = m(x2), my = m(y);
    let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
    for (let i = 0; i < n; i++) { const a = x1[i] - m1, b = x2[i] - m2, c = y[i] - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; }
    const det = s11 * s22 - s12 * s12;
    return [(s22 * s1y - s12 * s2y) / det, (s11 * s2y - s12 * s1y) / det];
}
const pente = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } return sxy / sxx; };

(async () => {
    const { sharp } = await Z.outils();
    if (mode === 'entree') {
        if (Z.CACHE_SCANS < 200 || Z.CACHE_PAIRES < 200) { const r = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { env: { ...process.env, RM_CACHE_SCANS: '200', RM_CACHE_PAIRES: '200' }, stdio: 'inherit' }); process.exit(r.status); }
        const sortie = { sansInstrument: SANS_INSTRUMENT };
        // 1. SCANS : N scans réels distincts, un par un, relevé toutes les 8 entrées (après chauffe : un premier scan charge opencv, les modules, le tas)
        const reel = charger('reel');
        const fichiers = []; for (const l of reel.F.lignes) for (const k of [...Object.keys(l.zones), ...Object.keys(l.paires).flatMap(p => p.split('|'))]) if (!fichiers.includes(k)) fichiers.push(k);
        const n = Math.min(40, fichiers.length);
        await Z.scan(source(fichiers[0]));
        const base = instantane('base (1 scan, opencv chargé)');
        const rel = [base];
        for (let i = 1; i < n; i++) { await Z.scan(source(fichiers[i])); if (i % 8 === 0 || i === n - 1) rel.push(instantane(`${Z._scans.size} scans`)); }
        const xs = rel.map(r => r.enScans);
        sortie.scans = { releves: rel, parEntreeMo: {} };
        for (const c of ['rssMo', 'tasMo', 'externeMo', 'wasmMo']) sortie.scans.parEntreeMo[c] = +pente(xs, rel.map(r => r[c])).toFixed(3);
        console.log('SCANS', JSON.stringify(sortie.scans.parEntreeMo));
        for (const r of rel) console.log('  ', JSON.stringify(r));
        // 2. PAIRES : les paires distinctes de « dracaufeu » puis de « reel » (les scans restent en cache : leur borne est 200, seules les paires s'ajoutent). Seules les entrées NON NULLES pèsent (une paire non alignée est cachée comme `null`).
        const dr = charger('dracaufeu');
        const rels = [], vues = new Set(); let nonNulles = 0, nulles = 0;
        for (const { jeu, c, l } of [...dr.F.lignes.map(l => ({ jeu: 'dracaufeu', c: dr, l })), ...reel.F.lignes.map(l => ({ jeu: 'reel', c: reel, l }))]) {
            const photo = await photoDe(sharp, jeu, c.R, l); if (!photo) continue;
            try {
                for (const k of Object.keys(l.paires)) {
                    if (vues.has(k)) continue; vues.add(k); const [a, b] = k.split('|');
                    await Z.comparerPaire(photo, source(a), source(b));
                    const P = Z._paires.get(`${a}|${b}`); if (P) nonNulles++; else nulles++;
                    if (vues.size % 16 === 0) rels.push(instantane(`${Z._paires.size} paires`, { nonNulles, nulles }));
                }
            } finally { photo.delete(); }
        }
        rels.push(instantane(`${Z._paires.size} paires`, { nonNulles, nulles }));
        const xp = rels.map(r => r.nonNulles);
        sortie.paires = { releves: rels, parEntreeNonNulleMo: {} };
        // les scans s'accumulent AUSSI pendant cette phase (borne 200) : la pente brute les mélange aux paires. Régression à deux variables (scans en cache, paires non nulles) → [par scan, par paire].
        const xs1 = rels.map(r => r.enScans);
        for (const c of ['rssMo', 'tasMo', 'externeMo', 'arrayBuffersMo', 'wasmMo']) {
            const ys = rels.map(r => r[c]), [parScan, parPaire] = regression2(xs1, xp, ys);
            sortie.paires.parEntreeNonNulleMo[c] = +parPaire.toFixed(3); (sortie.paires.parScanMemePhaseMo ||= {})[c] = +parScan.toFixed(3);
        }
        console.log('PAIRES (par entrée non nulle, régression à deux variables)', JSON.stringify(sortie.paires.parEntreeNonNulleMo), '· par scan dans la même phase', JSON.stringify(sortie.paires.parScanMemePhaseMo), `non nulles ${nonNulles}, nulles ${nulles}, scans en cache ${Z._scans.size}`);
        for (const r of rels) console.log('  ', JSON.stringify(r));
        if (arg('sortie', null)) fs.writeFileSync(arg('sortie'), JSON.stringify(sortie, null, 1));
        process.exit(0);
    }
    if (mode === 'serie') {
        const nom = arg('serie', 'mixte'), seed = Number(arg('graine', 20261026)), borne = Number(arg('lignes', 0));
        const ctx = G.contexte(JSON.parse(fs.readFileSync(`${FIX}/contexte.json`, 'utf8')));
        // la suite : « reel » dans l'ordre de la fixture (les photos du testeur) ; « mixte » = reel puis 250 lignes d'« auto » tirées à la graine ; « dracaufeu » = la famille entière (forte réutilisation)
        const pool = (jeu, lignes) => lignes.map(l => ({ jeu, l }));
        const chg = { reel: charger('reel'), dracaufeu: charger('dracaufeu') };
        let suite = [];
        if (nom === 'reel') suite = pool('reel', chg.reel.F.lignes);
        else if (nom === 'dracaufeu') suite = pool('dracaufeu', chg.dracaufeu.F.lignes);
        else {
            chg.auto = charger('auto');
            const r = graine(seed), idx = chg.auto.F.lignes.map((_, i) => i);
            for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
            suite = [...pool('reel', chg.reel.F.lignes), ...pool('auto', idx.slice(0, 250).map(i => chg.auto.F.lignes[i]))];
        }
        if (borne) suite = suite.slice(0, borne);
        let scansAppels = 0, scansHits = 0, pairesAppels = 0, pairesHits = 0;
        const aScans = Z._scans.has.bind(Z._scans), aPaires = Z._paires.has.bind(Z._paires);
        Z._scans.has = k => { const r = aScans(k); scansAppels++; if (r) scansHits++; return r; };
        Z._paires.has = k => { const r = aPaires(k); pairesAppels++; if (r) pairesHits++; return r; };
        const durees = [], empreintesLignes = [], tout = crypto.createHash('sha1'); let rssCrete = 0, mesures = 0;
        for (const { jeu, l } of suite) {
            const { F, R } = chg[jeu];
            const t0 = process.hrtime.bigint();
            const photo = await photoDe(sharp, jeu, R, l);
            const js = { zones: {}, paires: {} };
            const fichier = k => { const x = F.fichierDe[k]; if (!x) throw new Error(`fichier inconnu pour ${k}`); return x; };
            const mz = async f => { js.zones[f] = await Z.scoresZones(photo, source(f)); mesures++; return js.zones[f]; };
            const mp = async (a, b) => { js.paires[`${a}|${b}`] = await Z.comparerPaire(photo, source(a), source(b)); mesures++; return js.paires[`${a}|${b}`]; };
            for (const f of Object.keys(l.zones)) await mz(f);
            for (const k of Object.keys(l.paires)) { const [a, b] = k.split('|'); await mp(a, b); }
            let d = null;
            for (let tour = 0; tour < 12 && !d; tour++) {
                let manque = null;
                const mesuresG = {
                    comparerPaire: (a, b) => { const k = `${fichier(a)}|${fichier(b)}`; if (js.paires[k]) return js.paires[k]; manque = ['paire', fichier(a), fichier(b)]; throw new Error('manque'); },
                    scoresZones: v => { const f = fichier(v); if (js.zones[f]) return js.zones[f]; manque = ['zones', f]; throw new Error('manque'); }
                };
                try { d = G.decider(ctx, l, l.nEssais, mesuresG, F.seuils); }
                catch (err) { if (!manque) throw err; if (!photo) throw new Error(`${l.id} : mesure sans photo`); if (manque[0] === 'paire') await mp(manque[1], manque[2]); else await mz(manque[1]); }
            }
            if (photo) photo.delete();
            durees.push(Number(process.hrtime.bigint() - t0) / 1e6);
            rssCrete = Math.max(rssCrete, process.memoryUsage().rss);
            const h = crypto.createHash('sha1').update(JSON.stringify({ id: l.id, zones: js.zones, paires: js.paires, decision: d })).digest('hex');   // les nombres tels que JSON les écrit (17 chiffres) : aucune tolérance
            empreintesLignes.push(h); tout.update(h);
        }
        global.gc(); global.gc();
        const out = { taille: Number(arg('t', Z.CACHE_SCANS)), cacheScans: Z.CACHE_SCANS, cachePaires: Z.CACHE_PAIRES, serie: nom, lignes: suite.length, mesures, rssFinalMo: mo(process.memoryUsage().rss), rssCreteMo: mo(rssCrete), tasMo: mo(process.memoryUsage().heapUsed),
            p50: +quantile(durees, 0.5).toFixed(0), p95: +quantile(durees, 0.95).toFixed(0), moyenne: +(durees.reduce((a, b) => a + b, 0) / durees.length).toFixed(0), scansAppels, scansHits, pairesAppels, pairesHits, empreinte: tout.digest('hex'), empreintesLignes };
        console.log(`   ${suite.length} lignes (${nom}), ${mesures} mesures · RSS final ${out.rssFinalMo} Mo, crête ${out.rssCreteMo} Mo · p50 ${out.p50} ms, p95 ${out.p95} ms · réussite scans ${scansHits}/${scansAppels}, paires ${pairesHits}/${pairesAppels}`);
        console.log('@@' + JSON.stringify(out));
        process.exit(0);
    }
    console.error('usage : entree | serie'); process.exit(2);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });

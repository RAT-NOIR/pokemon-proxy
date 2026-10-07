// LE BANC DE LA GARDE DES ZONES PORTÉE (ratmarket/zones.js, OpenCV.js) contre pokemon-proxy-labo/rm/garde_zones.py — sur les appels
// RÉELS des bancs : chaque mesure que la décision du labo a demandée (fixtures-g, rm/exporter_fixtures_g.py) est refaite ici, sur la même
// photo redressée et les mêmes scans, puis la règle G (ratmarket/decision-g.js) décide avec CES mesures.
//   node ratmarket/test-zones.js [--jeux=reel,dracaufeu,auto] [--limite=N]
// Ce qui doit tenir : la même DÉCISION sur chaque requête, et 0 faux affirmé. Les écarts numériques s'impriment (médiane, 95e centile, max)
// avec ce qui compte vraiment : combien de mesures passent de l'autre côté d'un SEUIL de la règle (tau_bas, tau_haut, inliers_min,
// marge_zone, masque nul) — un écart qui ne franchit aucun seuil ne change aucune décision.
// Une mesure que la décision portée demande et que le labo n'a jamais demandée (le chemin diverge) est faite ici, et comptée.
'use strict';
const fs = require('fs'), path = require('path');
const Z = require('./zones'), G = require('./decision-g');
const LABO = 'C:/Users/Yung/Desktop/labo-embedding';
const FIX = `${LABO}/rm/fixtures-g`;
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const jeux = arg('jeux', 'reel,dracaufeu,auto').split(','), limite = Number(arg('limite', 0));
let echecs = 0, faites = 0;
const verif = (cond, quoi) => { faites++; if (!cond) echecs++; console.log(`${cond ? '✅' : '🔴'} ${quoi}`); };
const quantile = (xs, q) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const f4 = x => Number.isFinite(x) ? x.toFixed(4) : '—';

(async () => {
    const { sharp } = await Z.outils();
    const ctx = G.contexte(JSON.parse(fs.readFileSync(`${FIX}/contexte.json`, 'utf8')));
    for (const jeu of jeux) {
        const F = JSON.parse(fs.readFileSync(`${FIX}/${jeu}.json`, 'utf8')), S = F.seuils;
        const R = new Map(JSON.parse(fs.readFileSync(`${LABO}/rm/requetes/${jeu}.json`, 'utf8')).requetes.map(r => [r.id, r]));
        const source = f => ({ cle: f, chemin: `${LABO}/cache-visuels/img/${f}` });
        const ecZ = { haut: [], illustration: [], bandeau: [], texte: [], bas: [] }, ecInl = [], ecD = [], ecCouv = [];
        let inlEgaux = 0, nZ = 0, nP = 0, seuilZ = 0, seuilP = 0, horsLabo = 0, pareil = 0, aff = 0, faux = 0, affLabo = 0, n = 0;
        const ecarts = [], franchis = [];
        const t0 = Date.now();
        const lignes = limite ? F.lignes.slice(0, limite) : F.lignes;
        for (const l of lignes) {
            n++;
            const e = l.essai > 0 ? l.essai : (l.nEssais > 1 ? 1 : null);
            const fichier = k => { const x = F.fichierDe[k]; if (!x) throw new Error(`fichier inconnu pour ${k}`); return x; };
            const js = { zones: {}, paires: {} };
            let photo = null;
            if (e !== null) {
                const { data, info } = await sharp(`${LABO}/rm/requetes/${jeu}/${R.get(l.id).essais[e]}`).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
                photo = await Z.photoGrise(data, info.width, info.height);
            }
            const mesurerZones = async f => { js.zones[f] = await Z.scoresZones(photo, source(f)); return js.zones[f]; };
            const mesurerPaire = async (fa, fb) => { js.paires[`${fa}|${fb}`] = await Z.comparerPaire(photo, source(fa), source(fb)); return js.paires[`${fa}|${fb}`]; };
            // 1. les mesures du labo, refaites
            for (const [f, P] of Object.entries(l.zones)) {
                const J = await mesurerZones(f); nZ++;
                for (const z of Object.keys(ecZ)) ecZ[z].push(Math.abs(J[z] - P[z]));
                ecInl.push(Math.abs(J.inliers - P.inliers)); if (J.inliers === P.inliers) inlEgaux++;
                const cote = x => [x.bas >= S.tau_bas, x.haut >= S.tau_haut, x.inliers >= S.inliers_min].join();
                if (cote(J) !== cote(P)) { seuilZ++; franchis.push(`${l.id} zones ${f} : labo bas ${f4(P.bas)} haut ${f4(P.haut)} ${P.inliers} pts · API bas ${f4(J.bas)} haut ${f4(J.haut)} ${J.inliers} pts`); }
            }
            for (const [k, P] of Object.entries(l.paires)) {
                const [fa, fb] = k.split('|'); const J = await mesurerPaire(fa, fb); nP++;
                ecD.push(Math.abs(J[0] - P[0])); ecCouv.push(Math.abs(J[1] - P[1]));
                const cote = x => [x[1] === 0, x[0] >= S.marge_zone, x[0] <= -S.marge_zone].join();
                if (cote(J) !== cote(P)) { seuilP++; franchis.push(`${l.id} paire ${k} : labo ${f4(P[0])} (masque ${f4(P[1])}) · API ${f4(J[0])} (masque ${f4(J[1])})`); }
            }
            // 2. la décision avec les mesures de l'API ; une mesure hors du chemin du labo est faite à la demande, puis la décision est rejouée
            let d = null;
            for (let tour = 0; tour < 12 && !d; tour++) {
                let manque = null;
                const mesures = {
                    comparerPaire: (a, b) => { const k = `${fichier(a)}|${fichier(b)}`; if (js.paires[k]) return js.paires[k]; manque = ['paire', fichier(a), fichier(b)]; throw new Error('manque'); },
                    scoresZones: v => { const f = fichier(v); if (js.zones[f]) return js.zones[f]; manque = ['zones', f]; throw new Error('manque'); }
                };
                try { d = G.decider(ctx, l, l.nEssais, mesures, S); }
                catch (err) {
                    if (!manque) throw err;
                    if (!photo) throw new Error(`${l.id} : mesure demandée sans photo redressée`);
                    horsLabo++;
                    if (manque[0] === 'paire') await mesurerPaire(manque[1], manque[2]); else await mesurerZones(manque[1]);
                }
            }
            if (photo) photo.delete();
            if (!d) { ecarts.push(`${l.id} : la décision n'a pas abouti`); continue; }
            const L = l.decision;
            const ok = d.affirme === L.affirme && (d.produit ?? null) === (L.produit ?? null)
                && JSON.stringify(d.reponseCommune ?? null) === JSON.stringify(L.reponseCommune ?? null) && JSON.stringify(d.question ?? null) === JSON.stringify(L.question ?? null);
            if (ok) pareil++; else ecarts.push(`${l.id} : labo « ${L.raison} » (${L.affirme ? 'affirmé ' + L.produit : 'non'}) · API « ${d.raison} » (${d.affirme ? 'affirmé ' + d.produit : 'non'})`);
            const j = G.juger(d, l.verite);
            if (d.affirme) aff++; if (j === 'FAUX' || j === 'commune-FAUSSE') faux++; if (L.affirme) affLabo++;
            if (n % 200 === 0) console.log(`   … ${jeu} ${n}/${lignes.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        }
        const s = (Date.now() - t0) / 1000;
        console.log(`\n${jeu} : ${lignes.length} requêtes, ${nZ} mesures de zones et ${nP} de paires refaites (${s.toFixed(0)} s, ${(1000 * s / Math.max(1, nZ + nP)).toFixed(0)} ms par mesure)`);
        for (const z of Object.keys(ecZ)) console.log(`   écart ${z.padEnd(12)} médiane ${f4(quantile(ecZ[z], 0.5))} · 95e ${f4(quantile(ecZ[z], 0.95))} · max ${f4(Math.max(...ecZ[z], 0))}`);
        console.log(`   inliers identiques ${inlEgaux}/${nZ} · écart 95e ${quantile(ecInl, 0.95)} · max ${Math.max(...ecInl, 0)}`);
        console.log(`   écart paire (a − b)  médiane ${f4(quantile(ecD, 0.5))} · 95e ${f4(quantile(ecD, 0.95))} · max ${f4(Math.max(...ecD, 0))} · masque max ${f4(Math.max(...ecCouv, 0))}`);
        console.log(`   mesures de l'autre côté d'un seuil : zones ${seuilZ}/${nZ} · paires ${seuilP}/${nP} · mesures hors du chemin du labo ${horsLabo}`);
        for (const x of franchis.slice(0, 10)) console.log(`   ⚠️ ${x}`);
        console.log(`   décisions identiques ${pareil}/${lignes.length} · affirmés API ${aff} (labo ${affLabo}) · faux API ${faux}`);
        for (const x of ecarts.slice(0, 10)) console.log(`   🔴 ${x}`);
        verif(pareil === lignes.length, `${jeu} : avec les mesures de l'API, la règle rend les décisions du labo (${pareil}/${lignes.length})`);
        verif(faux === 0, `${jeu} : 0 faux affirmé avec les mesures de l'API (${aff} affirmés, labo ${affLabo})`);
        verif(Z._scans.size <= Z.CACHE_SCANS && Z._paires.size <= Z.CACHE_PAIRES,
              `${jeu} : caches bornés pour un serveur de 512 Mo (scans ${Z._scans.size}/${Z.CACHE_SCANS}, paires ${Z._paires.size}/${Z.CACHE_PAIRES})`);
    }
    console.log(`\n${echecs ? `🔴 ${echecs} échec(s)` : '✅ tout passe'} sur ${faites} vérifications`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error('🔴', e); process.exit(2); });

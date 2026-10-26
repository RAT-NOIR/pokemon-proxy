'use strict';
// LOT CACHE-ZONES — les deux caches de ratmarket/zones.js (scans, paires) se règlent par RM_CACHE_SCANS et RM_CACHE_PAIRES ; le DÉFAUT reste 32 et 32. Vide, non entier ou < 1 : le chargement LÈVE (même forme que RM_IDENTITE_MAX).
// Et V2_SHARP_CACHE règle le cache de libvips (sharp.cache) : non posé, sharp n'est PAS touché (comportement actuel inchangé).
// Les bornes se lisent au chargement : chaque cas tourne dans un processus ENFANT (enfant-cache-zones.js) sous l'environnement voulu, avec des scans fabriqués (graine fixe).
// Les mutants (hors suite) : node v2/mesures/muter-cache-zones.js.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const H = require('./_harnais');
const RS = require(process.env.CACHE_ZONES_REGLAGE || '../reglage-sharp');   // CACHE_ZONES_REGLAGE et CACHE_ZONES_INDEX : réservés au lanceur de mutants
const racine = path.join(__dirname, '..', '..');
const ENFANT = path.join(__dirname, 'enfant-cache-zones.js');
// CACHE_ZONES_MODULE (réservé au lanceur de mutants) : le zones.js à juger, passé tel quel à l'enfant.

function enfant(env, args = []) {
    const e = { ...process.env }; delete e.RM_CACHE_SCANS; delete e.RM_CACHE_PAIRES;
    const r = spawnSync(process.execPath, [ENFANT, ...args], { env: { ...e, ...env }, encoding: 'utf8', timeout: 120000 });
    const lignes = (r.stdout || '').trim().split('\n').filter(Boolean);
    let json = null; try { json = JSON.parse(lignes[lignes.length - 1]); } catch { /* le chargement a levé */ }
    return { statut: r.status, json, stderr: r.stderr || '' };
}

(async () => {
    // 1. le défaut ne change pas
    const d = enfant({});
    H.v('1. défaut inchangé : 32 scans, 32 paires', d.json && [d.json.CACHE_SCANS, d.json.CACHE_PAIRES], [32, 32]);

    // 2. les réglages sont lus (et indépendants l'un de l'autre)
    const a = enfant({ RM_CACHE_SCANS: '4', RM_CACHE_PAIRES: '3' });
    H.v('2a. RM_CACHE_SCANS=4 et RM_CACHE_PAIRES=3 sont lus', a.json && [a.json.CACHE_SCANS, a.json.CACHE_PAIRES], [4, 3]);
    const b = enfant({ RM_CACHE_SCANS: '8' });
    H.v('2b. RM_CACHE_SCANS seul : 8 scans, paires inchangées (32)', b.json && [b.json.CACHE_SCANS, b.json.CACHE_PAIRES], [8, 32]);
    const c = enfant({ RM_CACHE_PAIRES: '16' });
    H.v('2c. RM_CACHE_PAIRES seul : 16 paires, scans inchangés (32)', c.json && [c.json.CACHE_SCANS, c.json.CACHE_PAIRES], [32, 16]);
    const e1 = enfant({ RM_CACHE_SCANS: ' 5 ', RM_CACHE_PAIRES: '1' });
    H.v('2d. espaces autour tolérés, 1 est la borne basse admise pour les paires', e1.json && [e1.json.CACHE_SCANS, e1.json.CACHE_PAIRES], [5, 1]);
    const e2 = enfant({ RM_CACHE_SCANS: '2' });
    H.v('2e. 2 est la borne basse admise pour les scans (comparerPaire en tient deux à la fois)', e2.json && e2.json.CACHE_SCANS, 2);
    const e3 = enfant({ RM_CACHE_SCANS: '1' });
    H.vrai('2f. RM_CACHE_SCANS=1 est REFUSÉ (mesuré : le second scan évince le premier et comparerPaire plante sur un Mat libéré) et le message dit « ≥ 2 »', e3.statut !== 0 && e3.json === null && e3.stderr.includes('RM_CACHE_SCANS') && e3.stderr.includes('≥ 2'));

    // 3. la borne est RESPECTÉE (pas seulement lue) : éviction du moins récemment servi
    const r = enfant({ RM_CACHE_SCANS: '4', RM_CACHE_PAIRES: '3' }, ['--remplir']);
    H.v('3a. 6 scans sous une borne de 4 : les 4 derniers restent, les plus anciens sont partis', r.json && r.json.scansApres6, ['s2', 's3', 's4', 's5']);
    H.v('3b. s2 servi puis s6 chargé : s3 (le moins récemment servi) part, pas s2', r.json && r.json.scansApres7, ['s4', 's5', 's2', 's6']);
    H.v('3c. 5 paires sous une borne de 3 : les 3 dernières restent', r.json && r.json.paires && r.json.paires.length, 3);
    H.vrai('3d. les scans restent bornés pendant les comparaisons de paires', r.json && r.json.scansFin <= 4);

    // 4. valeurs refusées : le chargement LÈVE et nomme la variable
    for (const nom of ['RM_CACHE_SCANS', 'RM_CACHE_PAIRES']) {
        for (const v of ['', '   ', '0', '-3', '2.5', 'abc', '1e1', '4 Mo', 'NaN', '99999999999999999999']) {
            const x = enfant({ [nom]: v });
            H.vrai(`4. ${nom}=${JSON.stringify(v)} : le chargement lève (statut ${x.statut}) et nomme la variable`, x.statut !== 0 && x.json === null && x.stderr.includes(nom));
        }
    }

    // 5. V2_SHARP_CACHE : lecture
    const lire = v => { try { return RS.lireSharpCache(v === undefined ? {} : { V2_SHARP_CACHE: v }); } catch (e) { return 'LEVE:' + e.message.includes('V2_SHARP_CACHE'); } };
    H.v('5a. non posé : null (rien à faire)', lire(undefined), null);
    H.v('5b. « false » : le cache libvips est désactivé', lire('false'), false);
    H.v('5c. « true » : réglage explicite par défaut', lire('true'), true);
    H.v('5d. « memoire:20 » : 20 Mo de cache d\'opérations', lire('memoire:20'), { memory: 20 });
    H.v('5e. « memoire:0 » : 0 Mo admis (équivaut à pas de cache mémoire)', lire('memoire:0'), { memory: 0 });
    for (const v of ['', '  ', 'non', '0', 'memoire:', 'memoire:-1', 'memoire:2.5', 'memoire:abc', 'False']) H.v(`5f. V2_SHARP_CACHE=${JSON.stringify(v)} : refusé, la variable est nommée`, lire(v), 'LEVE:true');

    // 6. V2_SHARP_CACHE : application sur un faux sharp
    const appels = [];
    const faux = { cache: (...x) => { appels.push(x); return {}; } };
    RS.appliquer(faux, {});
    H.v('6a. non posé : sharp.cache n\'est jamais appelé', appels.length, 0);
    RS.appliquer(faux, { V2_SHARP_CACHE: 'false' });
    H.v('6b. « false » : sharp.cache(false)', appels, [[false]]);
    appels.length = 0; RS.appliquer(faux, { V2_SHARP_CACHE: 'memoire:20' });
    H.v('6c. « memoire:20 » : sharp.cache({ memory: 20 })', appels, [[{ memory: 20 }]]);
    appels.length = 0; RS.appliquer(faux, { V2_SHARP_CACHE: 'true' });
    H.v('6d. « true » : sharp.cache(true)', appels, [[true]]);
    // le vrai sharp accepte ce qu'on lui passe, et le cache libvips se lit
    const sharp = require('sharp');
    const avant = sharp.cache();
    RS.appliquer(sharp, { V2_SHARP_CACHE: 'memoire:7' });
    const apres = sharp.cache();
    sharp.cache({ memory: avant.memory.max, files: avant.files.max, items: avant.items.max });
    H.v('6e. vrai sharp : memoire:7 règle bien le plafond mémoire de libvips', apres.memory.max, 7);

    // 7. le réglage est branché au démarrage de l'API v2
    const src = fs.readFileSync(process.env.CACHE_ZONES_INDEX || path.join(racine, 'v2', 'index.js'), 'utf8');
    H.vrai('7. v2/index.js applique le réglage de sharp au chargement', /require\('\.\/reglage-sharp'\)\.appliquer\(\s*require\('sharp'\)\s*,\s*process\.env\s*\)/.test(src));
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

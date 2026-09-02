// ============================================================================
// LES 66 VÉRITÉS, REJOUÉES SUR LE CHEMIN DE PRODUCTION — 2026-08-30
// ============================================================================
// Le 41/44 de la cellule vient du LABO : il lisait les fichiers de référence directement
// sur le disque, et il décrivait une photo REDRESSÉE. La production fait deux choses
// différentes, et les deux tirent dans le même sens — VERS LE BAS :
//   · elle relit les vecteurs depuis Mongo (ce qui vient de coûter une soirée : `.lean()`
//     rendait un Binary, `n` valait NaN, et l'appariement rendait 0 partout) ;
//   · elle ne redresse PAS la photo : elle décrit l'image Vinted brute, carte posée sur
//     une table, dans un coin du cadre.
// Aucun de ces deux écarts n'a jamais été mesuré. C'est l'objet de ce fichier.
//
// ON APPELLE LE CODE DE PRODUCTION, ON NE LE RÉIMPLÉMENTE PAS : `chargerVecteurs`,
// `decrire`, `inliers` et `departager` viennent tous de departage-image.js. Le seul calcul
// propre à ce fichier est le CLASSEMENT — trois lignes — parce que `departager` rend un
// gagnant et non un rang, et qu'on a besoin du rang de la VRAIE carte.
//
// ════════════════════════════════════════════════════════════════════════════
// 🔑 L'ATTENDU, ÉCRIT AVANT DE LANCER. Ces bornes sont celles du testeur.
// ════════════════════════════════════════════════════════════════════════════
//   cellule ≥ 41/44      -> le labo tenait. On continue.
//   cellule 35 à 40      -> le chemin de production COÛTE. Il faudra savoir lequel des
//                           deux écarts le cause AVANT de toucher à quoi que ce soit.
//   cellule < 35         -> le 41/44 était un chiffre de laboratoire, et la décision de
//                           brancher se rediscute.
//
// ════════════════════════════════════════════════════════════════════════════
// 🔑 DEUXIÈME RÉGIME, AJOUTÉ LE 2026-09-02 — « SANS INJECTION »
//     L'ATTENDU EST ÉCRIT ICI, AVANT LE PREMIER LANCEMENT. Ne pas le relire après.
// ════════════════════════════════════════════════════════════════════════════
// CE QUI A ÉTÉ TROUVÉ. La ligne « si la vraie carte n'est pas dans le vivier, on l'y met »
// (plus bas, dans la boucle) GARANTIT une condition que la production n'a jamais. Le
// 42/44 répondait donc à :
//     « LA VÉRITÉ ÉTANT DANS LE VIVIER, l'image la classe-t-elle première ? »
// et la production pose une autre question :
//     « un prix juste sort-il ? » — qui INCLUT le cas où le vivier ne contient pas la vérité.
//
// ⚠️ L'ANCIENNE MESURE NE DEVIENT PAS FAUSSE. Elle isole le DÉPARTAGE en neutralisant le
// vivier, ce qui est exactement ce qu'on voulait quand on réglait ORB à 150 points : à ce
// moment-là, mélanger les deux défauts aurait empêché de régler quoi que ce soit. Les deux
// régimes sont donc gardés CÔTE À CÔTE et nommés distinctement :
//     « vivier COMPLÉTÉ »  -> pouvoir de discrimination de l'image, vivier neutralisé ;
//     « vivier RÉEL »      -> ce que la production peut livrer, tout compris.
//
// LES BORNES, sur la cellule, en « vivier RÉEL » :
//   ≥ 40/44   -> l'injection ne portait presque rien. L'objection tombe, le 42/44 tient.
//   35 – 39   -> l'injection portait un poids réel. L'image reste forte, mais SEULE la
//                borne basse de Wilson décide (voir ci-dessous).
//   30 – 34   -> défaut de vivier et défaut de départage sont du même ordre. La condition
//                « vivier non truqué » devient décisive et l'image n'est pas prête.
//   < 30      -> 🔑 LE DÉFAUT DE VIVIER DOMINE. Ce n'est pas un échec de l'image : c'est un
//                RÉSULTAT, et il réoriente le chantier — collecter passe avant départager.
//
// 🔑 LE SEUL CHIFFRE QUI DÉCIDE DE LA PROMOTION, et il n'est pas un effectif :
//     la BORNE BASSE de Wilson 95 % en « vivier RÉEL » doit dépasser 81,5 %,
//     borne HAUTE de `perimetre-vintage-suggestion` (10/16), la classe faible la mieux
//     mesurée. C'est la condition 1 de la règle de promotion (voir index.js, en tête de
//     NIVEAU_RESERVE). « 12 lignes » a été RETIRÉ de cette règle : un seuil en effectif et
//     un seuil en intervalle ne se traduisent pas l'un dans l'autre.
//
// ⚠️ CE QUE CE RÉGIME NE CORRIGE PAS, et il faut le dire avec le résultat :
//   · les 11 cartes du chantier sont toujours dans les 44 — le jeu les absorbe ;
//   · 64 des 68 vérités viennent du seau « lot », une population CHOISIE, pas le trafic ;
//   · `departager` reçoit toujours un classement à `score: 0` partout, quand la production
//     lui passe les vrais scores.
// Aucun de ces trois ne se règle en neutralisant l'injection. Ils bornent la conclusion.
//
// ⚠️ ET LE CHIFFRE SEUL NE DÉCIDE DE RIEN SANS SON TÉMOIN. « L'image fait 41/44 » ne dit
// pas qu'elle apporte quelque chose : il faut le rang 1 du SCORING sur LES MÊMES lignes.
// Les deux sont rendus côte à côte, et c'est D+ / D− qui tranche — pas le taux brut.
// `rangScoring` vient de comparaison-66.json : il a été mesuré une fois, il ne dépend pas
// du réglage de l'image, et le recalculer ici rouvrirait un instrument déjà fermé.
//
// ⚠️ LA PHOTO : on tente le TÉLÉCHARGEMENT, comme la production. Les annonces Vinted
// disparaissent ; une URL morte n'est PAS un échec de l'image. On se replie alors sur la
// copie brute que le labo avait téléchargée (photos-66/), et on COMPTE les deux cas
// séparément. Mélanger « la photo a disparu » et « l'image s'est trompée » ferait porter
// au résultat la durée de vie des annonces.
//
// USAGE : node mesure-justesse-production.js [--sans-redressement]
// LECTURE SEULE : aucune écriture en base, aucun fichier déplacé.
// ============================================================================
process.env.MONGODB_BASE = process.env.MONGODB_BASE || 'test';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const sharp = require('sharp');
const I = require('./departage-image');
const { trouverProduitsLocaux } = require('./index');

const LABO = 'C:\\Users\\Yung\\Desktop\\labo-embedding';
const PHOTOS = path.join(LABO, 'photos-66');
const JEU = path.join(LABO, 'justesse-66-150.json');
const SCORING = path.join(LABO, 'comparaison-66.json');
const AVEC_REDRESSEMENT = !process.argv.includes('--sans-redressement');

const med = a => { if (!a.length) return NaN; const v = [...a].sort((x, y) => x - y); return v[v.length >> 1]; };
const C = (a, b) => { let r = 1; for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; };
const signes = (a, b) => {
    const n = a + b; if (!n) return 1;
    let s = 0; for (let i = 0; i <= Math.min(a, b); i++) s += C(n, i);
    return Math.min(1, 2 * s / Math.pow(2, n));
};
// Wilson 95 % — parce qu'un taux sans intervalle laisse croire à une précision qu'il n'a pas.
const wilson = (k, n) => {
    if (!n) return [NaN, NaN];
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const e = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, c - e) * 100, Math.min(1, c + e) * 100];
};

// ── LE REDRESSEMENT, RECOPIÉ DU LABO (justesse-66.js:99-119) ────────────────
// ⚠️ COPIE, et marquée comme telle : la fonction n'est pas exportée, et c'est justement
// l'objet de la comparaison. Elle n'est PAS du code de service — si le redressement doit
// entrer en production un jour, ce sera par un module partagé, pas par cette copie.
async function detecterCarte(buf) {
    const L = 200;
    const { data: dx } = await sharp(buf).removeAlpha().greyscale().resize(L, L, { fit: 'fill' })
        .convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1] }).raw().toBuffer({ resolveWithObject: true });
    const { data: dy } = await sharp(buf).removeAlpha().greyscale().resize(L, L, { fit: 'fill' })
        .convolve({ width: 3, height: 3, kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1] }).raw().toBuffer({ resolveWithObject: true });
    const g = new Float64Array(L * L);
    for (let i = 0; i < L * L; i++) g[i] = Math.hypot(dx[i], dy[i]);
    const projX = new Float64Array(L), projY = new Float64Array(L);
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) { projX[x] += g[y * L + x]; projY[y] += g[y * L + x]; }
    const borne = proj => {
        const seuil = med([...proj]) * 1.15;
        let a = 0, b = L - 1;
        while (a < L && proj[a] < seuil) a++;
        while (b > a && proj[b] < seuil) b--;
        return (b - a) < L * 0.25 ? null : [a / L, (b + 1) / L];
    };
    const bx = borne(projX), by = borne(projY);
    if (!bx || !by) return null;
    return { x0: bx[0], x1: bx[1], y0: by[0], y1: by[1] };
}
async function redresser(buf) {
    const f = await detecterCarte(buf);
    if (!f) return null;
    const m = await sharp(buf).metadata();
    return sharp(buf).extract({
        left: Math.round(f.x0 * m.width), top: Math.round(f.y0 * m.height),
        width: Math.max(1, Math.round((f.x1 - f.x0) * m.width)),
        height: Math.max(1, Math.round((f.y1 - f.y0) * m.height))
    }).png().toBuffer();
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_BASE });
    const { cv } = await I.outils();
    const jeu = JSON.parse(fs.readFileSync(JEU, 'utf8'));
    const scoring = new Map(JSON.parse(fs.readFileSync(SCORING, 'utf8')).map(l => [l.cle, l]));
    const indexee = await I.ReferenceImage.countDocuments({ etat: 'indexee', pts: I.N_POINTS });

    console.log('═'.repeat(104));
    console.log(`LES 66 VÉRITÉS SUR LE CHEMIN DE PRODUCTION — ORB ${I.N_POINTS} pts · ${indexee} vecteurs en base`);
    console.log('═'.repeat(104));
    console.log('⚠️ LES 11 DU CHANTIER SONT DEDANS : ce jeu les absorbe, il ne les confirme pas.');
    console.log('⚠️ Vecteurs RELUS DE MONGO et photo TÉLÉCHARGÉE — les deux écarts avec le labo.\n');

    const lignes = [];
    let telecharge = 0, replis = 0, mortes = 0, redrRates = 0;
    for (const l of jeu) {
        // 1. La photo, comme la production la prend.
        let buf = null;
        try {
            const r = await fetch(l.imageUrl, { signal: AbortSignal.timeout(12000) });
            if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); telecharge++; }
        } catch (_) { }
        if (!buf) {
            const local = path.join(PHOTOS, `${l.idVrai}_${l.cle}.jpg`);
            if (fs.existsSync(local)) { buf = fs.readFileSync(local); replis++; }
            else { mortes++; console.log(`   ${l.cle} 🔴 photo perdue (URL morte, aucune copie locale) — ligne écartée et comptée`); continue; }
        }

        // 2. LE VIVIER, RECALCULÉ — et c'est un CHANGEMENT D'INSTRUMENT du 2026-08-30.
        // ⚠️ CE FICHIER LISAIT `l.vivier` DEPUIS LE JSON DU LABO — un instantané pris avant
        // l'import du catalogue. La mesure était donc AVEUGLE à tout produit ajouté depuis :
        // elle a rendu « abstention 16 % » après l'import, quand le vivier réel donne 23 %.
        // La prévision annoncée (23 %) était juste ; c'est l'instrument qui ne pouvait pas
        // la contredire ni la confirmer. Un chiffre stable parce que sa source est figée
        // ressemble à un chiffre stable parce que rien n'a bougé.
        // 🔑 ON APPELLE DONC `trouverProduitsLocaux`, comme la production. Le vivier suit le
        // catalogue, et un import se voit immédiatement dans la mesure.
        // ⚠️ CONSÉQUENCE À DÉCLARER : les résultats d'avant cette date portent sur un vivier
        // plus petit. Ils ne sont pas comparables ligne à ligne avec ceux d'après — le
        // classement se fait sur plus de candidats, donc la tâche est plus dure.
        let ids;
        try {
            ids = (await trouverProduitsLocaux(l.nom)).map(p => p.idProduct).filter(x => x != null);
        } catch (_) { ids = (l.vivier || []).filter(x => x != null); }
        if (!ids.length) ids = (l.vivier || []).filter(x => x != null);
        // ════════════════════════════════════════════════════════════════════
        // LE VIVIER RÉEL, GARDÉ À PART — 2026-09-02
        // ════════════════════════════════════════════════════════════════════
        // ⚠️ `idsReels` EST LE VIVIER TEL QUE LA CHAÎNE LE PRODUIT, sans retouche. Il est
        // capturé AVANT la complétion ci-dessous, et c'est lui qui décrit la production.
        // `veriteDansVivier` est la mesure que le journal ne pouvait pas rendre (`vivierIds`
        // manquait sur 32 refus sur 35) : elle sépare le défaut de VIVIER du défaut de
        // DÉPARTAGE, et aucun signal en aval ne rattrape le premier.
        const idsReels = [...ids];
        const veriteDansVivier = idsReels.includes(l.idVrai);
        // La vraie carte doit être dans le vivier, sinon la ligne ne mesure rien.
        // ⚠️ CETTE LIGNE NE MESURE PLUS LA PRODUCTION, ET C'EST ASSUMÉ : elle neutralise le
        // vivier pour isoler le pouvoir de discrimination de l'image. Le régime « vivier
        // RÉEL », lui, ne la subit pas. Les deux sont rendus côte à côte.
        if (!ids.includes(l.idVrai)) ids = [...new Set([...ids, l.idVrai])];
        const vect = await I.chargerVecteurs(ids);
        const couverture = ids.length ? vect.size / ids.length : 0;
        // La couverture de la garde sur le vivier RÉEL — c'est elle que la production voit.
        const couvertureReelle = idsReels.length
            ? idsReels.filter(id => vect.has(id)).length / idsReels.length : 0;

        // 3. Le classement, dans les deux régimes.
        // ⚠️ `surIds` EST LE PARAMÈTRE QUI SÉPARE LES DEUX RÉGIMES, et il n'y a qu'UNE
        // fonction de classement : deux copies « qui se ressemblent » divergeraient au
        // premier réglage changé, et la comparaison ne vaudrait plus rien.
        const classe = async (image, surIds) => {
            if (!image) return null;
            const q = await I.decrire(image);
            if (!q.n) return null;
            const s = [];
            for (const id of surIds) { const v = vect.get(id); if (v) s.push({ id, n: I.inliers(cv, q, v) }); }
            s.sort((a, b) => b.n - a.n);
            const rang = s.findIndex(x => x.id === l.idVrai) + 1;
            const vrai = s.find(x => x.id === l.idVrai)?.n ?? 0;
            const faux = s.find(x => x.id !== l.idVrai)?.n ?? 0;
            return { rang: rang || null, vrai, faux, n: s.length };
        };
        const brut = await classe(buf, ids);
        // MÊME PHOTO, MÊMES VECTEURS, MÊME FONCTION — seul le vivier change. Une variable.
        // Si la vérité n'est pas dans `idsReels`, `rang` vaut null : l'image ne PEUT PAS la
        // désigner, et c'est exactement ce que la production subit.
        const brutReel = await classe(buf, idsReels);
        let redr = null;
        if (AVEC_REDRESSEMENT) {
            const rb = await redresser(buf);
            if (!rb) redrRates++;
            else redr = await classe(rb);
        }

        // 4. Et le verdict de `departager()` lui-même, de bout en bout.
        const avis = await I.departager({
            imageUrl: l.imageUrl, langue: l.langue,
            total: l.total, classement: ids.map(id => ({ idProduct: id, score: 0 }))
        });

        lignes.push({
            ...l, brut, brutReel, redr, couverture, couvertureReelle,
            idsReels, veriteDansVivier,
            statut: avis.champs.imageStatut, s: scoring.get(l.cle)
        });
    }

    console.log(`\n   photos téléchargées ${telecharge} · repli sur copie locale ${replis} · perdues ${mortes}` +
        `${redrRates ? ` · redressements ratés ${redrRates}` : ''}`);
    console.log(`   ⚠️ Un repli n'invalide pas la ligne : les octets sont ceux de la même annonce.`);
    console.log(`      Il dit seulement que la MESURE n'a pas testé le téléchargement sur cette ligne.\n`);

    // ── LE TABLEAU QUI DÉCIDE ───────────────────────────────────────────────
    console.log('═'.repeat(104));
    console.log('LE RÉSULTAT — image contre scoring, sur les MÊMES lignes');
    console.log('═'.repeat(104));
    console.log(`   ${'population'.padEnd(24)} ${'n'.padStart(3)} ${'IMAGE'.padStart(6)} ${'SCORING'.padStart(8)} ` +
        `${'D+'.padStart(3)} ${'D−'.padStart(3)} ${'p'.padStart(8)}   Wilson 95 % (image)`);
    const groupes = [
        ['TOUT LE JEU', () => true],
        ['LA CELLULE', l => l.ere === 'cellule'],
        ['asiatique hors cellule', l => l.ere === 'asiatique'],
        ['OCCIDENTAL', l => l.ere === 'OCCIDENTAL']
    ];
    const res = {};
    for (const [titre, f] of groupes) {
        const g = lignes.filter(f).filter(l => l.s);
        if (!g.length) continue;
        const i1 = g.filter(l => l.brut?.rang === 1).length;
        const s1 = g.filter(l => l.s.rangScoring === 1).length;
        const dP = g.filter(l => l.brut?.rang === 1 && l.s.rangScoring !== 1).length;
        const dM = g.filter(l => l.brut?.rang !== 1 && l.s.rangScoring === 1).length;
        const [lo, hi] = wilson(i1, g.length);
        res[titre] = { n: g.length, i1, s1, dP, dM };
        console.log(`   ${titre.padEnd(24)} ${String(g.length).padStart(3)} ${String(i1).padStart(6)} ${String(s1).padStart(8)} ` +
            `${String(dP).padStart(3)} ${String(dM).padStart(3)} ${signes(dP, dM).toFixed(4).padStart(8)}   ${lo.toFixed(0)} – ${hi.toFixed(0)} %`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // LES DEUX RÉGIMES CÔTE À CÔTE — vivier COMPLÉTÉ contre vivier RÉEL
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ Ils ne répondent pas à la même question, et les confondre ferait lire un pouvoir
    // de discrimination comme une promesse de livraison :
    //   COMPLÉTÉ -> « la vérité étant dans le vivier, l'image la classe-t-elle première ? »
    //   RÉEL     -> « un prix juste sort-il ? », défaut de vivier COMPRIS.
    console.log('\n' + '═'.repeat(104));
    console.log('LES DEUX RÉGIMES — la vérité est-elle dans le vivier, ou l\'y a-t-on mise ?');
    console.log('═'.repeat(104));
    console.log(`   ${'population'.padEnd(24)} ${'n'.padStart(3)} ${'COMPLÉTÉ'.padStart(9)} ${'RÉEL'.padStart(9)} ` +
        `${'vérité∉vivier'.padStart(14)}   Wilson 95 % (RÉEL)`);
    const resReel = {};
    for (const [titre, f] of groupes) {
        const g = lignes.filter(f).filter(l => l.s);
        if (!g.length) continue;
        const i1 = g.filter(l => l.brut?.rang === 1).length;
        const i1r = g.filter(l => l.brutReel?.rang === 1).length;
        const hors = g.filter(l => !l.veriteDansVivier).length;
        const [lo, hi] = wilson(i1r, g.length);
        resReel[titre] = { n: g.length, i1, i1r, hors, lo, hi };
        console.log(`   ${titre.padEnd(24)} ${String(g.length).padStart(3)} ${String(i1).padStart(9)} ${String(i1r).padStart(9)} ` +
            `${String(hors).padStart(14)}   ${lo.toFixed(1)} – ${hi.toFixed(1)} %`);
    }

    // 🔑 LE CHIFFRE QUI DÉCIDE, comparé au plancher écrit dans la règle de promotion.
    const PLANCHER = 81.5;   // borne HAUTE de Wilson sur perimetre-vintage-suggestion, 10/16
    const cr = resReel['LA CELLULE'];
    if (cr) {
        console.log('\n   ── CONTRE LES BORNES ÉCRITES AVANT DE LANCER (régime RÉEL) ──');
        const v = cr.i1r >= 40 ? '✅ ≥ 40/44 — l\'injection ne portait presque rien, l\'objection tombe'
            : cr.i1r >= 35 ? '⚠️ 35–39 — l\'injection portait un poids réel ; seule la borne basse décide'
                : cr.i1r >= 30 ? '🔴 30–34 — vivier et départage du même ordre ; l\'image n\'est pas prête'
                    : '🔴🔴 < 30 — LE DÉFAUT DE VIVIER DOMINE. Résultat, pas échec : collecter passe avant départager.';
        console.log(`   cellule, vivier RÉEL : ${cr.i1r}/${cr.n}   ${v}`);
        console.log(`   vérité ABSENTE du vivier réel : ${cr.hors}/${cr.n} — aucun départage ne les rattrape.`);
        console.log(`\n   🔑 LE SEUL CHIFFRE QUI DÉCIDE DE LA PROMOTION :`);
        console.log(`      borne basse Wilson (RÉEL) = ${cr.lo.toFixed(1)} %   contre plancher ${PLANCHER} %`);
        console.log(`      -> ${cr.lo > PLANCHER ? '✅ DISJOINT — la condition 1 de la règle est satisfaite'
            : '❌ NON DISJOINT — la condition 1 n\'est PAS satisfaite. Aucune promotion.'}`);
        console.log(`      ⚠️ Ce fichier ne promeut RIEN : il rend le chiffre. La table vit dans index.js.`);
        // Combien de succès faudrait-il, à n constant, pour franchir le plancher ?
        for (let k = cr.i1r; k <= cr.n; k++) {
            if (wilson(k, cr.n)[0] > PLANCHER) { console.log(`      il faudrait ${k}/${cr.n} pour franchir le plancher à n constant.`); break; }
        }
    }

    // ── LA LECTURE CONTRE LES BORNES ÉCRITES D'AVANCE ───────────────────────
    const c = res['LA CELLULE'];
    console.log('\n   ── CONTRE LES BORNES ÉCRITES AVANT DE LANCER ──');
    if (c) {
        const verdict = c.i1 >= 41 ? '✅ ≥ 41/44 — LE LABO TENAIT, on continue'
            : c.i1 >= 35 ? '⚠️ 35–40 — LE CHEMIN DE PRODUCTION COÛTE. Trouver LEQUEL des deux écarts,\n      avant de toucher à quoi que ce soit.'
                : '🔴 < 35 — le 41/44 était un chiffre de laboratoire. La décision de brancher se rediscute.';
        console.log(`   cellule : ${c.i1}/${c.n}   ${verdict}`);
        console.log(`   ⚠️ et le témoin : le scoring fait ${c.s1}/${c.n} sur les mêmes lignes.`);
        console.log(`      D+ ${c.dP} · D− ${c.dM} — c'est ÇA qui dit si l'image apporte, pas le taux brut.`);
    }

    // ── LE REDRESSEMENT, TRANCHÉ ────────────────────────────────────────────
    if (AVEC_REDRESSEMENT) {
        console.log('\n' + '═'.repeat(104));
        console.log('LE REDRESSEMENT — brut contre redressé, sur les MÊMES photos');
        console.log('═'.repeat(104));
        for (const [titre, f] of groupes) {
            const g = lignes.filter(f).filter(l => l.brut && l.redr);
            if (!g.length) continue;
            const r1b = g.filter(l => l.brut.rang === 1).length;
            const r1r = g.filter(l => l.redr.rang === 1).length;
            const gagne = g.filter(l => l.redr.rang === 1 && l.brut.rang !== 1).length;
            const perd = g.filter(l => l.brut.rang === 1 && l.redr.rang !== 1).length;
            console.log(`   ${titre.padEnd(24)} n=${String(g.length).padStart(3)} · rang 1 brut ${String(r1b).padStart(2)} · redressé ${String(r1r).padStart(2)} ` +
                `· gagnées ${gagne} · perdues ${perd} · p = ${signes(gagne, perd).toFixed(3)}`);
            console.log(`      inliers médians de la VRAIE carte : brut ${med(g.map(l => l.brut.vrai))} · redressé ${med(g.map(l => l.redr.vrai))}`);
            console.log(`      inliers médians du meilleur FAUX  : brut ${med(g.map(l => l.brut.faux))} · redressé ${med(g.map(l => l.redr.faux))}`);
        }
        console.log(`\n   ⚠️ Si le redressement gagne nettement, l'ajouter au chemin de production est un`);
        console.log(`      CHANTIER À PART : +2 décodages sharp et une convolution par scan, un mode`);
        console.log(`      d'échec de plus (détection ratée), et une décision à prendre sur ce qu'on fait`);
        console.log(`      quand elle rate — la production n'a pas le droit d'écarter une carte.`);
    }

    // ── LA COUVERTURE DE LA GARDE, sur ce jeu ───────────────────────────────
    // ════════════════════════════════════════════════════════════════════════
    // 🔑 CE QUE LA GARDE COÛTE VRAIMENT — le chiffre qui gouverne ce que l'utilisateur voit
    // ════════════════════════════════════════════════════════════════════════
    // Les tableaux ci-dessus disent la justesse QUAND l'image tranche. Ils ne disent pas à
    // QUELLE FRÉQUENCE elle tranche. La garde exige un vecteur pour TOUS les candidats du
    // groupe : une seule carte non collectée dans un vivier de 60 fait abstenir.
    // ⚠️ J'AVAIS ESTIMÉ CE COÛT À 7,6–8,4 % DES GROUPES, sur le trafic du journal. Ce jeu-ci
    // le mesure sur les viviers RÉELS des 66 vérités, index quasi complet. Si les deux
    // divergent, c'est l'estimation qui était fausse, pas la mesure.
    console.log('\n' + '═'.repeat(104));
    console.log('CE QUE LA GARDE COÛTE — combien de fois elle tranche, et non plus si elle a raison');
    console.log('═'.repeat(104));
    console.log(`   ${'population'.padEnd(24)} ${'n'.padStart(3)} ${'complets'.padStart(9)} ${'abstient'.padStart(9)}   dont rang 1 par l'image`);
    for (const [titre, f] of groupes) {
        const g = lignes.filter(f);
        if (!g.length) continue;
        const ok = g.filter(l => l.couverture >= 1);
        const abst = g.length - ok.length;
        // Ce qu'on PERD réellement : les lignes que l'image aurait gagnées et où elle se tait.
        const perduesUtiles = g.filter(l => l.couverture < 1 && l.brut?.rang === 1 && l.s && l.s.rangScoring !== 1).length;
        console.log(`   ${titre.padEnd(24)} ${String(g.length).padStart(3)} ${String(ok.length).padStart(9)} ` +
            `${String(abst).padStart(9)}   ${ok.filter(l => l.brut?.rang === 1).length}/${ok.length}` +
            `${perduesUtiles ? `   🔴 ${perduesUtiles} D+ perdu(s) par la garde` : ''}`);
    }
    // ════════════════════════════════════════════════════════════════════════
    // 🔑 LA LISTE DE COLLECTE QUI VAUT — les sets classés par D+ DÉBLOQUÉS
    // ════════════════════════════════════════════════════════════════════════
    // Ce n'est PAS la liste des sets par produits manquants. Un set de 140 trous qui
    // n'apparaît dans aucun vivier de cellule ne débloque rien ; un set d'UN trou qui
    // bloque quatre viviers vaut quatre D+.
    //
    // ⚠️ DEUX COLONNES, ET LA CONFUSION COÛTERAIT DU TRAVAIL POUR RIEN :
    //   « participe » — le set bloque cette ligne, MAIS d'autres sets la bloquent aussi.
    //                   La collecter seul ne débloque RIEN.
    //   « débloque »  — le set est le SEUL à bloquer cette ligne. Le collecter la libère.
    // On trie sur « débloque ». Additionner les « participe » ferait promettre des gains
    // qui ne viendront qu'une fois TOUS les sets concernés terminés.
    const perdues = lignes.filter(l => l.couverture < 1 && l.brut?.rang === 1 && l.s && l.s.rangScoring !== 1);
    const parSet = new Map();
    for (const l of perdues) {
        const ids = (l.vivier || []).filter(x => x != null);
        const vect = await I.chargerVecteurs(ids);
        const sans = ids.filter(i => !vect.has(i));
        const prods = await mongoose.connection.collection('catalogue_produits')
            .find({ idProduct: { $in: sans } }, { projection: { idProduct: 1, idExpansion: 1 } }).toArray();
        const exps = [...new Set(prods.map(p => Number(p.idExpansion)))];
        const codes = new Set();
        for (const e of exps) {
            const c = await mongoose.connection.collection('codes_set').findOne({ idExpansion: e });
            codes.add(c?.codeSet ?? `exp${e}`);
        }
        for (const c of codes) {
            if (!parSet.has(c)) parSet.set(c, { participe: 0, debloque: 0, cartes: new Set() });
            parSet.get(c).participe++;
            if (codes.size === 1) parSet.get(c).debloque++;
        }
        for (const p of prods) {
            const c = [...codes][0];
            if (codes.size === 1) parSet.get(c).cartes.add(p.idProduct);
        }
    }
    console.log('\n' + '═'.repeat(104));
    console.log('LA LISTE DE COLLECTE QUI VAUT — sets classés par D+ DÉBLOQUÉS, pas par produits manquants');
    console.log('═'.repeat(104));
    if (!parSet.size) console.log('   (aucune ligne perdue par la garde — rien à débloquer)');
    else {
        console.log(`   ${'codeSet'.padEnd(12)} ${'débloque'.padStart(8)} ${'participe'.padStart(9)}   cartes à collecter pour ça`);
        for (const [c, v] of [...parSet.entries()].sort((a, b) => b[1].debloque - a[1].debloque || b[1].participe - a[1].participe)) {
            console.log(`   ${c.padEnd(12)} ${String(v.debloque).padStart(8)} ${String(v.participe).padStart(9)}   ` +
                `${v.cartes.size ? [...v.cartes].slice(0, 8).join(', ') : '—'}`);
        }
        const seuls = [...parSet.values()].reduce((s, v) => s + v.debloque, 0);
        console.log(`\n   🔑 ${seuls} D+ débloqués en collectant les sets ci-dessus SÉPARÉMENT.`);
        console.log(`      Les ${perdues.length - seuls} autres lignes sont bloquées par PLUSIEURS sets à la fois :`);
        console.log(`      elles ne se libèrent qu'une fois tous leurs bloqueurs terminés.`);
    }

    const manquants = lignes.map(l => Math.round((1 - l.couverture) * (l.vivier?.length ?? 0)));
    console.log(`\n   candidats sans vecteur, par vivier : médiane ${med(manquants.filter(x => x > 0))} ` +
        `· maximum ${Math.max(...manquants)}`);
    console.log(`   ⚠️ UN SEUL candidat non collecté dans un vivier de 60 suffit à faire abstenir.`);
    console.log(`      C'est la règle voulue — retirer le candidat aveugle fabriquerait une victoire —`);
    console.log(`      mais son COÛT se paie sur la collecte, pas sur le code.`);

    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error(e.stack); process.exit(1); });

'use strict';
// LOT MEMOIRE-G — AUCUN objet C++ d'OpenCV.js ne survit à un appel, ni sur le chemin nominal, ni sur un chemin d'ERREUR.
// OpenCV.js ne libère rien tout seul : un Mat, un vecteur, un DMatchVector sans `.delete()` reste en mémoire jusqu'à la mort du processus. La mémoire de la règle G croît de ce que ces oublis cumulent.
// Le banc COMPTE les objets embind vivants (_embind-vivants.js) — une mesure exacte, pas une impression de RSS — sur les trois modules qui touchent OpenCV dans le serveur :
//   · ratmarket/zones.js (la garde des zones de la règle G : scoresZones, comparerPaire, photoGrise) ;
//   · departage-image.js (decrire, inliers : la piste de PLAN-API §1.2, « mm.get(i) n'est jamais libéré ») ;
//   · v2/identifier/seconde-lecture-image.js (redresser).
// Puis il FAIT ÉCHOUER chaque appel OpenCV de chaque scénario, l'un après l'autre (injection de faute au k-ième appel de chaque fonction) : après l'échec, plus rien ne doit rester.
// Images FABRIQUÉES (rectangles pseudo-aléatoires, graine fixe) : aucun fichier, aucun réseau, aucune base. Les bancs de données RÉELLES sont dans v2/mesures/mesurer-memoire-g.js.
const V = require('./_embind-vivants').armer();       // AVANT tout require d'opencv
const H = require('./_harnais');
const sharp = require('sharp');
const Z = require('../../ratmarket/zones');
const D = require('../../departage-image');
const SL = require('../identifier/seconde-lecture-image');

const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
// une « carte » : fond gris, 260 rectangles de gris pseudo-aléatoires (des coins nets : ORB en trouve des centaines)
function fabriquer(seed, l = 420, h = 587, { modif = 0, dx = 0, dy = 0 } = {}) {
    const r = graine(seed), b = Buffer.alloc(l * h * 3, 128), rects = [];
    for (let k = 0; k < 260; k++) rects.push({ x: Math.floor(r() * (l - 20)), y: Math.floor(r() * (h - 20)), w: 8 + Math.floor(r() * 70), h: 8 + Math.floor(r() * 70), c: Math.floor(r() * 256) });
    // la variante : les modif rectangles du BAS changent de gris (deux « impressions » d'un même dessin qui ne diffèrent que par le bas)
    const bas = [...rects.keys()].sort((a, c) => rects[c].y - rects[a].y).slice(0, modif);
    for (const i of bas) rects[i].c = (rects[i].c + 97) % 256;
    for (const q of rects) for (let y = Math.max(0, q.y + dy); y < Math.min(h, q.y + dy + q.h); y++) for (let x = Math.max(0, q.x + dx); x < Math.min(l, q.x + dx + q.w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = q.c; }
    return b;
}
const png = (buf, l = 420, h = 587) => sharp(buf, { raw: { width: l, height: h, channels: 3 } }).png().toBuffer();
const source = (cle, octets) => ({ cle, octets });

// ── l'injection de faute : chaque fonction OpenCV appelée est comptée ; la k-ième d'une fonction nommée LÈVE
const FONCTIONS = ['matFromArray', 'cvtColor', 'resize', 'GaussianBlur', 'Sobel', 'magnitude', 'findHomography', 'warpPerspective', 'dilate', 'getPerspectiveTransform'];
const METHODES = [['ORB', 'detectAndCompute'], ['BFMatcher', 'match'], ['BFMatcher', 'knnMatch'], ['Mat', 'convertTo'], ['Mat', 'copyTo']];
function instrumenter(cv) {
    const etat = { compte: {}, echec: null }, restes = [];
    const envelopper = (hote, nom, etiquette) => {
        const orig = hote[nom]; if (typeof orig !== 'function') return;
        const enveloppe = function (...a) {
            etat.compte[etiquette] = (etat.compte[etiquette] || 0) + 1;
            if (etat.echec && etat.echec.nom === etiquette && etat.compte[etiquette] === etat.echec.k) throw new Error(`échec injecté : ${etiquette} #${etat.echec.k}`);
            return orig.apply(this, a);
        };
        Object.assign(enveloppe, orig);                           // embind retrouve sa table de surcharges par `hote[nom].overloadTable` : l'enveloppe doit la porter
        hote[nom] = enveloppe;
        restes.push(() => { hote[nom] = orig; });
    };
    for (const f of FONCTIONS) envelopper(cv, f, f);
    for (const [c, m] of METHODES) envelopper(cv[c].prototype, m, `${c}.${m}`);
    envelopper(cv.Mat, 'ones', 'Mat.ones');
    return { etat, rendre: () => restes.forEach(f => f()), remettre: () => { etat.compte = {}; etat.echec = null; } };
}
// vide les caches de zones (leurs Mat sont libérés par ce banc comme le fait l'éviction) : ce qui reste vivant ensuite est une FUITE
function viderCaches() {
    for (const s of Z._scans.values()) for (const k of ['mat', 'd', 'grad']) { try { if (s[k] && !s[k].isDeleted()) s[k].delete(); } catch { /* déjà libéré */ } }
    Z._scans.clear(); Z._paires.clear();
}
const nomsVivants = () => { const v = V.vivants(); return v.n ? `${v.n} ${JSON.stringify(v.par)}` : '0'; };

(async () => {
    // ── les images
    const A = fabriquer(11), Adecalee = fabriquer(11, 420, 587, { dx: 4, dy: 3 }), B = fabriquer(11, 420, 587, { modif: 6 });
    const octA = await png(A), octB = await png(B), octAdec = await png(Adecalee);

    // ═══ 1. departage-image.js : decrire + inliers (la piste de PLAN-API §1.2) ═══
    const rq = await D.decrire(octAdec), rf = await D.decrire(octA);   // 1er appel : OpenCV s'instancie
    H.vrai('1a. OpenCV est instancié et la mémoire WASM est mesurable', V.octetsWasm() > 0);
    H.vrai('1b. decrire rend des descripteurs (plus de 100 points sur la carte fabriquée)', rq.n > 100 && rf.n > 100);
    console.log(`   decrire : ${rq.n} et ${rf.n} points`);
    H.v('1c. après UN decrire + UN inliers, aucun objet C++ ne reste vivant', await (async () => { const { cv } = await D.outils(); D.inliers(cv, rq, rf); return nomsVivants(); })(), '0');
    const { cv } = await D.outils();
    const attendu = D.inliers(cv, rq, rf);
    H.vrai(`1d. inliers sépare une carte de sa copie décalée (${attendu} points d'appui, au moins 12)`, attendu >= 12);
    const octets0 = V.octetsWasm();
    for (let i = 0; i < 300; i++) { const a = await D.decrire(octAdec); const b = await D.decrire(octA); if (D.inliers(cv, a, b) !== attendu) throw new Error('inliers instable'); }
    H.v('1e. après 300 decrire x2 + 300 inliers, aucun objet C++ vivant (une fuite par appel cumule des centaines de DMatchVector)', nomsVivants(), '0');
    H.v('1f. la mémoire WASM n\'a pas grandi sur ces 300 tours', V.octetsWasm(), octets0);
    V.purger();                                                          // une fuite constatée ci-dessus ne se recompte pas dans les sections suivantes

    // ═══ 2. zones.js nominal : seuls les caches bornés gardent des objets (3 Mat par scan : image, descripteurs, gradient) ═══
    const photo = await Z.photoGrise(Adecalee, 420, 587);
    const scans = []; for (let i = 0; i < 40; i++) scans.push(source(`banc/s${i}.png`, await png(fabriquer(100 + i))));
    const zA = await Z.scoresZones(photo, source('banc/A.png', octA));
    H.vrai(`2a. la garde des zones aligne la carte décalée sur son scan (${zA.inliers} points d'appui, au moins 40 : la zone clé peut confirmer)`, zA.inliers >= 40);
    const pAB = await Z.comparerPaire(photo, source('banc/A.png', octA), source('banc/B.png', octB));
    H.vrai(`2b. comparerPaire voit la différence du bas (masque ${pAB[1].toFixed(3)} > 0)`, pAB[1] > 0);
    for (let tour = 0; tour < 3; tour++) for (const s of scans) { await Z.scoresZones(photo, s); }
    const caches = Z._scans.size;
    H.v('2c. le cache des scans est borné (32) après 120 mesures sur 40 scans différents', caches, Z.CACHE_SCANS);
    H.v('2d. objets vivants = 3 Mat par scan en cache, rien d\'autre (photo de ce banc comprise : +1)', V.vivants().n, 3 * caches + 1);
    photo.delete();
    viderCaches();
    H.v('2e. caches vidés : plus aucun objet vivant', nomsVivants(), '0');

    // ═══ 3. LES CHEMINS D'ERREUR : chaque appel OpenCV, l'un après l'autre, échoue ; il ne doit rien rester ═══
    const I = instrumenter(cv);
    // chaque scénario est joué en DEUX temps : à blanc (on compte les appels OpenCV), puis une fois par (fonction, k) avec l'échec injecté
    const scenarios = [
        ['scoresZones (scan inconnu : lecture, ORB, gradient ; alignement ; gradient aligné)', async () => { const p = await Z.photoGrise(Adecalee, 420, 587); try { return await Z.scoresZones(p, source('e/A.png', octA)); } finally { p.delete(); } }],
        ['comparerPaire (deux scans inconnus : carte des différences, alignement de la photo)', async () => { const p = await Z.photoGrise(Adecalee, 420, 587); try { return await Z.comparerPaire(p, source('e/A.png', octA), source('e/B.png', octB)); } finally { p.delete(); } }],
        ['photoGrise (conversion en gris, redimensionnement)', async () => { const p = await Z.photoGrise(Adecalee, 420, 587); p.delete(); }],
        ['decrire + inliers (departage-image)', async () => { const a = await D.decrire(octAdec), b = await D.decrire(octA); return D.inliers(cv, a, b); }],
        ['redresser (seconde lecture : transformation de perspective)', async () => SL.redresser(octA, { W: 420, quad: [{ x: 5, y: 5 }, { x: 410, y: 8 }, { x: 412, y: 575 }, { x: 3, y: 580 }] }, { largeur: 200 })],
    ];
    const fautes = [];
    for (const [nom, jouer] of scenarios) {
        viderCaches(); I.remettre();
        await jouer();                                                  // à blanc : compte les appels
        const compte = { ...I.etat.compte };
        viderCaches();
        let essais = 0, fuites = 0;
        for (const [fn, n] of Object.entries(compte)) for (let k = 1; k <= n; k++) {
            I.remettre(); I.etat.echec = { nom: fn, k };
            let leve = false;
            try { await jouer(); } catch (e) { leve = /échec injecté/.test(String(e && e.message)); }
            I.remettre();
            viderCaches();
            essais++;
            const reste = V.vivants();
            if (reste.n) { fuites++; fautes.push(`${nom} — ${fn} #${k} : ${reste.n} objet(s) vivant(s) ${JSON.stringify(reste.par)}`); V.purger(); }
            void leve;       // l'échec injecté peut être absorbé par le module lui-même (inliers : findHomography) : seule la FUITE se juge
        }
        H.v(`3. ${nom} : ${essais} échecs injectés (un par appel OpenCV du scénario), 0 objet C++ resté vivant`, fuites, 0);
    }
    for (const f of fautes.slice(0, 12)) console.log(`   ⚠️ ${f}`);
    if (fautes.length > 12) console.log(`   … et ${fautes.length - 12} autres`);
    I.rendre();

    // ═══ 4. un appel qui réussit après des échecs : mêmes résultats qu'avant (la libération ne change aucune mesure) ═══
    viderCaches();
    const p2 = await Z.photoGrise(Adecalee, 420, 587);
    const zA2 = await Z.scoresZones(p2, source('banc/A.png', octA));
    const pAB2 = await Z.comparerPaire(p2, source('banc/A.png', octA), source('banc/B.png', octB));
    p2.delete(); viderCaches();
    H.v('4a. scoresZones rend les MÊMES nombres avant et après les échecs injectés', zA2, zA);
    H.v('4b. comparerPaire rend les MÊMES nombres avant et après les échecs injectés', pAB2, pAB);
    H.v('4c. inliers rend le même nombre de points d\'appui', D.inliers(cv, await D.decrire(octAdec), await D.decrire(octA)), attendu);
    // 🔑 L'IDENTITÉ AVEC LE CODE D'AVANT LE LOT : ces nombres ont été relevés sur le code de c7280b8e/342dc544 (sans aucune libération sur les chemins d'erreur, `mm.get(i)` non libéré), mêmes images fabriquées,
    // Node 24 ET Node 22. Libérer plus tôt ou plus tard ne change aucune mesure : un seul chiffre qui bouge ici est une règle de décision qui a bougé.
    H.v('4e. scoresZones : exactement les nombres du code d\'avant le lot', zA, { haut: 0.9977567817414347, illustration: 0.9984413457579513, bandeau: 0.9991050650570561, texte: 0.9995612078385215, bas: 0.9732252763474945, inliers: 300 });
    H.v('4f. comparerPaire : exactement les nombres du code d\'avant le lot', pAB, [0.47884313176678384, 0.0065212091662603605]);
    H.v('4g. decrire et inliers : 150 points chacun, 107 points d\'appui, comme avant le lot', [rq.n, rf.n, attendu], [150, 150, 107]);
    H.v('4d. fin de banc : aucun objet C++ vivant', nomsVivants(), '0');
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

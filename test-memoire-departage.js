'use strict';
// ============================================================
// LOT V1-MEMOIRE (2026-10-25) — AUCUN objet C++ d'OpenCV.js ne survit à un appel de departage-image.js, erreur comprise
// ============================================================
// LA FUITE (§15 : RSS 163 → 1 215 Mo en 120 000 appels) : `inliers()` appelle `mm.get(i)` — qui rend un NOUVEAU DMatchVector (objet C++ copié) à chaque tour — et ne le libère jamais ; `decrire()` crée un
// masque vide (`new cv.Mat()`) qu'il ne libère pas non plus ; et un appel OpenCV qui LÈVE laisse vivants les objets créés avant lui. OpenCV.js ne libère rien tout seul (ni GC ni FinalizationRegistry).
// Ce banc COMPTE les objets embind vivants (mesure exacte, pas un RSS), puis FAIT ÉCHOUER chaque appel OpenCV de decrire() et d'inliers(), un par un : après chaque échec il ne doit rien rester.
// Recopié de v2/test/_embind-vivants.js et test-memoire-g.js (branche api-v2, commit 2006b1be) — main n'a pas le dossier v2/test. Images FABRIQUÉES (graine fixe) : aucun fichier, aucun réseau, aucune base.

// ── le compteur d'objets embind vivants : à armer AVANT de charger opencv. embind fabrique chaque objet par Object.create(prototype, { $$: … }) ; un objet VALEUR (KeyPoint, DMatch…) est un objet JS simple.
const tous = new Set(), memoires = [];
{
    const creer = Object.create;
    Object.create = function (proto, props) {
        const o = creer.call(Object, proto, props);
        if (props && Object.prototype.hasOwnProperty.call(props, '$$')) tous.add(o);
        return o;
    };
    const instancier = WebAssembly.instantiate;
    WebAssembly.instantiate = async function (...a) {
        const r = await instancier.apply(WebAssembly, a);
        const inst = r && r.instance ? r.instance : r;
        if (inst && inst.exports) for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) memoires.push(v);
        return r;
    };
}
function vivants() {
    const par = {}; let n = 0;
    for (const o of [...tous]) {
        let libere = true;
        try { libere = o.isDeleted(); } catch { libere = true; }
        if (libere) { tous.delete(o); continue; }
        const nom = (o.$$ && o.$$.ptrType && o.$$.ptrType.registeredClass && o.$$.ptrType.registeredClass.name) || (o.constructor && o.constructor.name) || '?';
        par[nom] = (par[nom] || 0) + 1; n++;
    }
    return { n, par };
}
const octetsWasm = () => (memoires.length ? memoires[0].buffer.byteLength : null);
function purger() { for (const o of [...tous]) { try { if (!o.isDeleted()) o.delete(); } catch { /* déjà libéré */ } tous.delete(o); } }
const nomsVivants = () => { const v = vivants(); return v.n ? `${v.n} ${JSON.stringify(v.par)}` : '0'; };

const sharp = require('sharp');
const D = require('./departage-image');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);

const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
// une « carte » : fond gris, 260 rectangles de gris pseudo-aléatoires (des coins nets : ORB en trouve des centaines)
function fabriquer(seed, l = 420, h = 587, { dx = 0, dy = 0 } = {}) {
    const r = graine(seed), b = Buffer.alloc(l * h * 3, 128), rects = [];
    for (let k = 0; k < 260; k++) rects.push({ x: Math.floor(r() * (l - 20)), y: Math.floor(r() * (h - 20)), w: 8 + Math.floor(r() * 70), h: 8 + Math.floor(r() * 70), c: Math.floor(r() * 256) });
    for (const q of rects) for (let y = Math.max(0, q.y + dy); y < Math.min(h, q.y + dy + q.h); y++) for (let x = Math.max(0, q.x + dx); x < Math.min(l, q.x + dx + q.w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = q.c; }
    return b;
}
const png = (buf, l = 420, h = 587) => sharp(buf, { raw: { width: l, height: h, channels: 3 } }).png().toBuffer();

// ── l'injection de faute : chaque fonction OpenCV appelée est comptée ; la k-ième d'une fonction nommée LÈVE
const FONCTIONS = ['matFromArray', 'findHomography'];
const METHODES = [['ORB', 'detectAndCompute'], ['BFMatcher', 'knnMatch']];
function instrumenter(cv) {
    const etat = { compte: {}, echec: null }, restes = [];
    const envelopper = (hote, nom, etiquette) => {
        const orig = hote[nom]; if (typeof orig !== 'function') throw new Error(`instrumentation impossible : ${etiquette} n'existe pas`);
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
    return { etat, rendre: () => restes.forEach(f => f()), remettre: () => { etat.compte = {}; etat.echec = null; } };
}

(async () => {
    const A = fabriquer(11), Adecalee = fabriquer(11, 420, 587, { dx: 4, dy: 3 });
    const octA = await png(A), octAdec = await png(Adecalee);

    // ═══ 1. le chemin nominal ═══
    const rq = await D.decrire(octAdec), rf = await D.decrire(octA);   // 1er appel : OpenCV s'instancie
    vrai('1a. OpenCV est instancié et la mémoire WASM est mesurable', octetsWasm() > 0);
    vrai('1b. decrire rend des descripteurs (plus de 100 points sur la carte fabriquée)', rq.n > 100 && rf.n > 100);
    console.log(`   decrire : ${rq.n} et ${rf.n} points`);
    const { cv } = await D.outils();
    v('1c. après UN decrire x2 + UN inliers, aucun objet C++ ne reste vivant', (() => { D.inliers(cv, rq, rf); return nomsVivants(); })(), '0');
    const attendu = D.inliers(cv, rq, rf);
    vrai(`1d. inliers sépare une carte de sa copie décalée (${attendu} points d'appui, au moins 12)`, attendu >= 12);
    const octets0 = octetsWasm();
    for (let i = 0; i < 200; i++) { const a = await D.decrire(octAdec); const b = await D.decrire(octA); if (D.inliers(cv, a, b) !== attendu) throw new Error('inliers instable'); }
    v('1e. après 200 decrire x2 + 200 inliers, aucun objet C++ vivant (une fuite par appel cumule des centaines de DMatchVector)', nomsVivants(), '0');
    v('1f. la mémoire WASM n\'a pas grandi sur ces 200 tours', octetsWasm(), octets0);
    purger();                                                          // une fuite constatée ci-dessus ne se recompte pas dans la section suivante

    // ═══ 2. LES CHEMINS D'ERREUR : chaque appel OpenCV, l'un après l'autre, échoue ; il ne doit rien rester ═══
    const I = instrumenter(cv);
    const scenarios = [
        ['decrire (ORB.detectAndCompute)', async () => D.decrire(octAdec)],
        ['inliers (knnMatch, matFromArray x2, findHomography)', async () => D.inliers(cv, rq, rf)],
        ['decrire x2 + inliers', async () => { const a = await D.decrire(octAdec), b = await D.decrire(octA); return D.inliers(cv, a, b); }]
    ];
    const fautes = [];
    for (const [nom, jouer] of scenarios) {
        I.remettre();
        await jouer();                                                  // à blanc : compte les appels OpenCV
        const compte = { ...I.etat.compte };
        let essais = 0, fuites = 0;
        for (const [fn, n] of Object.entries(compte)) for (let k = 1; k <= n; k++) {
            I.remettre(); I.etat.echec = { nom: fn, k };
            try { await jouer(); } catch (e) { void e; }                // l'échec injecté peut être absorbé par inliers lui-même (findHomography) : seule la FUITE se juge
            I.remettre();
            essais++;
            const reste = vivants();
            if (reste.n) { fuites++; fautes.push(`${nom} — ${fn} #${k} : ${reste.n} objet(s) vivant(s) ${JSON.stringify(reste.par)}`); purger(); }
        }
        vrai(`2. ${nom} : ${essais} échecs injectés (un par appel OpenCV du scénario)`, essais > 0);
        v(`2. ${nom} : 0 objet C++ resté vivant`, fuites, 0);
    }
    for (const f of fautes.slice(0, 12)) console.log(`   ⚠️ ${f}`);
    if (fautes.length > 12) console.log(`   … et ${fautes.length - 12} autres`);
    I.rendre();

    // ═══ 3. la libération ne change aucune mesure ═══
    v('3a. inliers rend le même nombre de points d\'appui après les échecs injectés', D.inliers(cv, await D.decrire(octAdec), await D.decrire(octA)), attendu);
    // 🔑 ces nombres ont été relevés sur le code de main AVANT ce lot (aucune libération de mm.get(i), du masque de decrire, ni sur les chemins d'erreur), mêmes images fabriquées : un chiffre qui bouge = une règle qui a bougé.
    v('3b. decrire et inliers : 150 points chacun, 107 points d\'appui, comme avant le lot', [rq.n, rf.n, attendu], [150, 150, 107]);
    v('3c. fin de banc : aucun objet C++ vivant', nomsVivants(), '0');

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });

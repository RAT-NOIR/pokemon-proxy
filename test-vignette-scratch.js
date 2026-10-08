// node test-vignette-scratch.js — `assurerVignettes` DE BOUT EN BOUT : 3 cartes réelles de EX Holon Phantoms (lues dans `cartes`,
// jamais modifiées) copiées dans test_scratch sous des collections à lui, vignettes fabriquées depuis l'original R2 et déposées sur R2
// (clés `vignettes/…`, idempotentes : les mêmes que le rattrapage posera), relues ; puis les collections retirées.
require('dotenv').config();
const mongoose = require('mongoose');
const sharp = require('sharp');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const r2 = require('./collecte-cartes/r2');
const { assurerVignettes, cleVignette } = require('./collecte-cartes/vignette');
const CARTES = 'banc_vignettes_cartes', IMAGES = 'banc_vignettes_images', SLUG = 'EX-Holon-Phantoms', JUMEAU = 'banc-jumeau-EX-Holon-Phantoms';
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

(async () => {
    // BASE DE BANC (2026-10-08) : l'ÉCRITURE (les collections `banc_vignettes_*`) va à la base de banc ; les cartes RÉELLES à copier sont LUES dans
    // `cartes` par une FAÇADE à liste fermée (find, count… ; tout le reste lève).
    // STOCKAGE (2026-10-08, tour 3) : AUCUNE requête R2. Le module r2 est remplacé par un FAUX STOCKAGE en mémoire (Map clé -> binaire) : les
    // originaux y sont fabriqués aux proportions des vraies entrées, `assurerVignettes` y dépose ses vignettes, et le banc relit la clé demandée.
    const banc = await ouvrirBanc();
    banc.appliquer();
    const cxCartes = await banc.connexionCartes(mongoose, 'cartes');
    const source = { db: cxCartes.db }, fermer = () => cxCartes.close();
    const bucket = 'bucket-du-banc';   // un nom : le faux stockage ne s'adresse à aucun bucket réel
    const magasin = new Map();
    const fauxStockage = {
        verifierBucket: async () => 'faux-stockage',
        existe: async (b, k) => magasin.has(k),
        deposerBinaire: async (b, k, buf) => { if (magasin.has(k)) return { ecrit: false, cle: k }; magasin.set(k, buf); return { ecrit: true, cle: k }; },
        deposerTexte: async (b, k, t) => { if (magasin.has(k)) return { ecrit: false, cle: k }; magasin.set(k, Buffer.from(t, 'utf8')); return { ecrit: true, cle: k }; },
        lireBinaire: async (b, k) => { if (!magasin.has(k)) throw new Error(`faux stockage : clé inconnue ${k}`); return magasin.get(k); },
        lireTexte: async (b, k) => (await fauxStockage.lireBinaire(b, k)).toString('utf8'),
        listerPrefixe: async (b, p) => [...magasin.keys()].filter(k => k.startsWith(p)),
        supprimer: async (b, ks) => { ks.forEach(k => magasin.delete(k)); return ks.length; }
    };
    Object.assign(r2, fauxStockage);   // vignette.js relit `require('./r2')` à chaque appel : il voit le faux stockage
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') throw new Error('je n\'écris que dans test_scratch');
    for (const n of [CARTES, IMAGES]) if ((await cx.db.listCollections({ name: n }).toArray()).length) throw new Error(`test_scratch porte déjà ${n}`);
    try {
        const cartes = await source.db.collection('cartes').find({ sets: SLUG, 'images.set': SLUG }).limit(3).toArray();
        const cles = cartes.flatMap(c => c.images.filter(e => e.set === SLUG).map(e => e.cleR2));
        const images = await source.db.collection('images').find({ cleR2: { $in: cles } }).toArray();
        verifier('dénominateur : 3 cartes de HP, chacune avec son image, et leurs documents `images`', [cartes.length, cles.length >= 3, images.length], [3, true, cles.length]);
        // les ORIGINAUX du faux stockage : une image unie aux proportions de chaque vraie entrée (w × h lus sur la carte)
        for (const c of cartes) for (const e of c.images) {
            if (typeof e.cleR2 !== 'string' || magasin.has(e.cleR2)) continue;
            const w = 600, h = Math.max(1, Math.round(w * (e.h || 825) / (e.w || 600)));
            magasin.set(e.cleR2, await sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 40, b: 40 } } }).png().toBuffer());
        }
        const originauxSeme = magasin.size;
        // une carte porte DÉJÀ sa vignette sur son document `images` (cas d'une jointure qui a réécrit l'entrée) : elle doit être reprise
        const dejaFaite = cles[0];
        // une image partagée par DEUX sets sur la même carte (un set et ses Additionals, xA) : l'écriture par arrayFilters les vignette
        // toutes deux, donc les DEUX sets se revalident — même quand on ne demande que le premier (revue du 2026-09-27, MINEUR 8)
        const jumelle = cles[1];
        await cx.db.collection(CARTES).insertMany(cartes.map(c => {
            const images = c.images.map(e => { const { vignette, ...x } = e; return x; });
            const e = images.find(x => x.set === SLUG && x.cleR2 === jumelle);
            return { ...c, images: e ? [...images, { ...e, set: JUMEAU }] : images };
        }));
        await cx.db.collection(IMAGES).insertMany(images.map(i => { const { vignette, ...x } = i; return i.cleR2 === dejaFaite ? { ...x, vignette: { cleR2: cleVignette(dejaFaite), w: 200, h: 275 } } : x; }));
        const R = await assurerVignettes(cx.db, { bucket, slug: SLUG, noms: { cartes: CARTES, images: IMAGES }, parallele: 2 });
        if (R.echecs.length) console.log(`   échecs : ${JSON.stringify(R.echecs)}`);
        verifier('bilan : toutes les entrées (la jumelle comprise), une reprise du document, les autres fabriquées (ou déjà sur R2), 0 échec, LES DEUX sets',
            [R.entrees, R.depuisDocument, R.fabriquees + R.deja, R.echecs.length, [...R.sets].sort()], [cles.length + 1, 1, cles.length - 1, 0, [JUMEAU, SLUG].sort()]);
        const ej = (await cx.db.collection(CARTES).findOne({ 'images.set': JUMEAU })).images.find(e => e.set === JUMEAU);
        verifier('l\'entrée jumelle porte la vignette de son image', ej.vignette?.cleR2, cleVignette(jumelle));
        const relues = await cx.db.collection(CARTES).find({}).toArray();
        const entrees = relues.flatMap(c => c.images.filter(e => e.set === SLUG));
        const bonnes = entrees.filter(e => e.vignette && e.vignette.cleR2 !== e.cleR2 && e.vignette.w <= 400 && Math.abs(e.vignette.w / e.vignette.h - e.w / e.h) / (e.w / e.h) <= 0.05);
        verifier('chaque entrée porte une vignette que le site ADMET (clé à elle, ≤ 400 px, proportion à 5 %)', bonnes.length, entrees.length);
        const autre = entrees.find(e => e.cleR2 !== dejaFaite);
        const fichier = await sharp(await r2.lireBinaire(bucket, autre.vignette.cleR2)).metadata();
        verifier('le fichier déposé sur R2 est relu : WebP, aux dimensions écrites', [fichier.format, fichier.width, fichier.height], ['webp', autre.vignette.w, autre.vignette.h]);
        const doc = await cx.db.collection(IMAGES).findOne({ cleR2: autre.cleR2 });
        verifier('la vignette est écrite AUSSI sur le document `images` (une jointure qui réécrit l\'entrée la reprendra)', doc.vignette?.cleR2, autre.vignette.cleR2);
        const R2bis = await assurerVignettes(cx.db, { bucket, slug: SLUG, noms: { cartes: CARTES, images: IMAGES } });
        verifier('relancé : plus rien à faire (idempotent)', [R2bis.entrees, R2bis.fabriquees], [0, 0]);
        const demandees = [...new Set(cles.filter(k => k !== dejaFaite))].map(cleVignette);
        verifier('faux stockage : chaque vignette est déposée sous la clé `vignettes/…` demandée, et rien d\'autre n\'y a été écrit', [demandees.every(k => magasin.has(k) && k.startsWith('vignettes/')), magasin.size - originauxSeme], [true, demandees.length]);
    } finally {
        for (const n of [CARTES, IMAGES]) await cx.db.collection(n).drop().catch(() => {});
        const reste = (await cx.db.listCollections().toArray()).map(c => c.name).filter(n => n.startsWith('banc_vignettes'));
        console.log(`   nettoyé : ${reste.length ? `ENCORE PRÉSENTE(S) ${reste.join(', ')}` : `${CARTES} et ${IMAGES} retirées de test_scratch`}`);
        await cx.close(); await fermer();
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

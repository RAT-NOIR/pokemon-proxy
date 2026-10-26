// ============================================================
// CALIBRATION DE LA 5e VOIE — rejouée sur des produits DÉJÀ JOINTS, vérité connue, ligne cachée (V5, 2026-10-26) — LECTURE SEULE
// ============================================================
//   node lancer-a-blanc.js calibrer-voie-deux-sources.js [--echantillon=N] [--graine=N] [--sortie=<f>.json]
// Pour chaque produit joint à une VRAIE carte (la ligne dit la vérité) : on CACHE sa ligne, on fabrique l'entrée que la voie recevrait (une seconde source d'ORACLE qui concorde sur (set, numéro, nom) — c'est
// la partie « indépendante » qu'on ne rejoue pas ici : on mesure ce que la voie fait de ce qu'elle reçoit), et on compare la carte désignée à la vérité.
//   · variante 1 « ligne cachée » : la carte garde ses impressions ;
//   · variante 2 « ligne + impression cachées » : on retire aussi à la vraie carte son impression (tirage, expansion du set, numéro) — la situation de A1 (la carte n'a pas d'impression numérotée dans le set).
// FAUX = la voie propose une ligne dont la carte n'est PAS celle de la ligne cachée. 0 exigé : sinon la voie n'est pas proposée.
// La mesure imprime son dénominateur, et ouvre à la main chaque faux (une ligne « vérité » posée par une clé faible — set+nom, setlist+nom — peut elle-même être fausse : §67).
const fs = require('fs');
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const V = require('./collecte-cartes/voie-deux-sources');
const T = require('./poser-fiches-voie-deux-sources');
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ECH = arg('echantillon') ? Number(arg('echantillon')) : null, GRAINE = Number(arg('graine') || 20261026), SORTIE = arg('sortie');
const FORTES = new Set(['set+numero', 'setlist+numero', 'wcd+origine+numero']);   // les preuves qui ne passent pas par le nom seul

function aleatoire(g) { let s = g >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

(async () => {
    const cx = await T.ouvrirLecture();
    try {
        const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
        const L = await T.lire({ cartesDb, prodDb, expansions: [] });
        const cat = await prodDb.collection('catalogue_produits').find({}, { projection: { _id: 0, idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } }).toArray();
        if (!cat.length) throw new Error('catalogue vide');
        const numeros = new Map((await prodDb.collection('numeros_cartes').find({}, { projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1 } }).toArray()).map(n => [n.idProduct, n]));
        const catDe = new Map(cat.map(c => [c.idProduct, c]));
        const produitDe = id => { const c = catDe.get(id); if (!c) return null; const d = decomposerNomCardmarket(c.name), n = numeros.get(id); return { ...c, nom: d.nom, attaques: d.attaques, numero: n?.numero ?? null, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null }; };
        const cartesParId = new Map(L.cartes.map(c => [c._id, c]));
        // LA POPULATION : une ligne vers une VRAIE carte (identifiant positif, pas une fiche simple), un produit du catalogue qui a un numéro, un set connu
        const pop = L.lignes.filter(l => {
            const c = cartesParId.get(l.carteId), p = produitDe(l.idProduct);
            return c && !c.ficheSimple && l.carteId > 0 && p && p.numero != null && String(p.numero).trim() !== '' && L.sets.has(l.slugSet);
        });
        console.log(`DÉNOMINATEURS : lignes ${L.lignes.length} · cartes ${L.cartes.length} · sets ${L.sets.size} · produits du catalogue ${cat.length} · population (ligne vers une vraie carte, produit numéroté, set connu) ${pop.length}`);
        if (!pop.length) throw new Error('population vide : une calibration sur zéro ligne ne mesure rien');
        const rnd = aleatoire(GRAINE);
        const melange = pop.map(x => [rnd(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        const echantillon = ECH ? melange.slice(0, ECH) : melange;
        console.log(`   échantillon : ${echantillon.length} (graine ${GRAINE})`);
        const bilan = {};
        const faux = [];
        for (const variante of [1, 2]) {
            const B = bilan[variante] = { juges: 0, propose: 0, juste: 0, faux: 0, fauxFortes: 0, refus: {}, parPreuve: {} };
            const TAILLE = 2500;
            for (let i = 0; i < echantillon.length; i += TAILLE) {
                const lot = echantillon.slice(i, i + TAILLE);
                const cache = new Set(lot.map(l => l._id));
                const lignes = L.lignes.filter(l => !cache.has(l._id));
                // variante 2 : la vraie carte perd son impression (tirage, expansion, numéro) dans le set de la ligne
                const cartes = variante === 2 ? L.cartes.map(c => c) : L.cartes;
                if (variante === 2) {
                    const idx = new Map(cartes.map((c, k) => [c._id, k]));
                    for (const l of lot) {
                        const s = L.sets.get(l.slugSet), p = produitDe(l.idProduct), k = idx.get(l.carteId), c = cartes[k];
                        const exps = [].concat(s.bulba?.expansion ?? []), t = s.tirage ?? s.region;
                        const impr = (c.impressions || []).filter(im => !(im && im.tirage === t && exps.includes(im.expansion) && String(im.numero ?? '').replace(/^0+/, '').toLowerCase() === String(p.numero).replace(/^0+/, '').toLowerCase()));
                        cartes[k] = { ...c, impressions: impr };
                    }
                }
                const produits = new Map();
                const entrees = [];
                const dePreuve = new Map(lot.map(l => [l.idProduct, l]));
                for (const l of lot) {
                    const p = produitDe(l.idProduct);
                    (produits.get(p.idExpansion) || produits.set(p.idExpansion, []).get(p.idExpansion)).push(p);
                    entrees.push({ idProduct: l.idProduct, idExpansion: p.idExpansion, slugSet: l.slugSet, secondeSource: { concordantes: [{ source: 'artofpkm', ref: 'oracle', set: l.slugSet, numero: String(p.numero), nom: p.nom, par: 'nom' }], refusees: [] } });
                }
                const plan = V.planifierVoie({ entrees, lecture: { cartes, sets: L.sets, produits, NC: L.NC, lignes } });
                B.juges += entrees.length;
                for (const l of plan.lignes) {
                    B.propose++;
                    const v = dePreuve.get(l.idProduct);
                    const preuve = v.preuve ?? '?';
                    const pp = (B.parPreuve[preuve] ||= { propose: 0, faux: 0 }); pp.propose++;
                    if (l.carteId === v.carteId) B.juste++;
                    else { B.faux++; pp.faux++; if (FORTES.has(preuve)) B.fauxFortes++; faux.push({ variante, idProduct: l.idProduct, nom: produitDe(l.idProduct).name, set: l.slugSet, numero: produitDe(l.idProduct).numero, carteProposee: l.carteId, carteVerite: v.carteId, preuveVerite: preuve }); }
                }
                for (const r of plan.refus) { const c = r.raison.replace(/\(.*?\)/g, '(…)').replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#').slice(0, 90); B.refus[c] = (B.refus[c] || 0) + 1; }
                process.stdout.write(`   variante ${variante} · ${Math.min(i + TAILLE, echantillon.length)}/${echantillon.length}\r`);
            }
            console.log(`\n══ VARIANTE ${variante} (${variante === 1 ? 'ligne cachée' : 'ligne + impression cachées'}) : jugés ${B.juges} · lignes proposées ${B.propose} (${(100 * B.propose / B.juges).toFixed(1)} %) · justes ${B.juste} · FAUX ${B.faux} (dont sur preuve forte ${B.fauxFortes})`);
            console.log(`   par preuve de la vérité : ${JSON.stringify(B.parPreuve)}`);
            for (const [c, n] of Object.entries(B.refus).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`      ${String(n).padStart(6)} · refus : ${c}`);
        }
        for (const f of faux.slice(0, 40)) console.log(`   FAUX v${f.variante} ${f.idProduct} « ${f.nom} » ${f.set} n°${f.numero} : propose ${f.carteProposee}, vérité ${f.carteVerite} (${f.preuveVerite})`);
        if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify({ bilan, faux }, null, 1));
    } finally { await cx.fermer(); }
})().catch(e => { console.error('ERREUR', e.stack || e.message); process.exit(1); });

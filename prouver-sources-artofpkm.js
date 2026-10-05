// ============================================================
// PROUVER UNE SOURCE artofpkm PAR LA SOURCE ELLE-MÊME — le critère du 2026-09-25 (sources-sets.js, « paires douteuses PROUVÉES »)
// ============================================================
//   node prouver-sources-artofpkm.js <CODE>=<idArtofpkm>[,<CODE>=<id>…]
// Pour chaque paire : la liste artofpkm lue (toutes pages), puis 3 pages de carte DISTINCTES — premier rang numéroté, milieu, 80 % (un
// rang sans numéro imprimé se déplace de 10 rangs au plus, vers l'avant au rang 0, vers l'arrière ailleurs : une Énergie de base ne se
// JUGE pas, elle ne compte ni pour ni contre) ; le NUMÉRO
// imprimé de chaque page doit désigner chez nous une carte du set (impression du tirage de la ligne, même numéro par cleNumero) au
// MÊME nom (nomImage) — 3 sur 3, sinon la paire est refusée. Rien n'est écrit en base : le verdict s'imprime, la ligne de
// sources-sets.js s'écrit à la main avec sa preuve. AUCUNE image téléchargée (le worker est le seul collecteur d'images).
// Débit : collecte-cartes/artofpkm.js (1 requête / 5 s, sérialisée), sous le verrou GLOBAL artofpkm/__collecteur__ (§17).
require('dotenv').config();
const AUTORISES = [/^[\w.+-]+=\d+(,[\w.+-]+=\d+)*$/];
const args = process.argv.slice(2);
if (args.length !== 1 || !AUTORISES.some(r => r.test(args[0]))) { console.error('❌ usage : node prouver-sources-artofpkm.js CODE=idArtofpkm[,CODE=id…] — rien n\'est lancé'); process.exit(2); }
const paires = args[0].split(',').map(x => { const [code, id] = x.split('='); return { code, id: Number(id) }; });

(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
    const { ligne: ligneDuCode, TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
    // le CODE de la table, ou à défaut le slugSet (le code du document `sets` n'est pas toujours celui de la ligne)
    const ligne = c => ligneDuCode(c) || [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE].find(l => l.slugSet === c) || null;
    const { cleNumero, normaliserNom } = require('./collecte-cartes/jointure');
    const src = require('./collecte-cartes/artofpkm');
    const nomImage = n => normaliserNom(String(n ?? '').replace(/[\[\]]/g, ' '));   // la clé de collecteur-images.js
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    const v = fabriquerVerrou({ Modele: M.EtatImages, id: 'artofpkm/__collecteur__', dureeMs: 3 * 60 * 1000, surInsertion: { phase: 'preuve-source' }, nom: 'verrou global artofpkm' });
    const tenu = await v.prendre();
    if (tenu) { console.error(`❌ verrou global artofpkm tenu par pid ${tenu.pid} sur ${tenu.hote} (battement il y a ${tenu.ageS} s) : aucune requête`); await fermer(); process.exit(1); }
    const verdicts = [];
    try {
        for (const { code, id } of paires) {
            const L = ligne(code);
            if (!L) { verdicts.push({ code, id, ok: false, raison: 'absent de la table' }); continue; }
            const TIRAGE = L.bulba?.tirage || 'jp', noms = [].concat(L.bulba?.expansion ?? []);
            const cartes = await cx.db.collection('cartes').find({ impressions: { $elemMatch: { tirage: TIRAGE, expansion: { $in: noms }, ...(L.bulba?.deck ? { deck: L.bulba.deck } : {}) } } }, { projection: { nomEn: 1, impressions: 1 } }).toArray();
            const parNumero = new Map();
            for (const c of cartes) for (const i of c.impressions.filter(i => i.tirage === TIRAGE && noms.includes(i.expansion) && (!L.bulba?.deck || i.deck === L.bulba.deck))) {
                const k = cleNumero(i.numero); if (!k) continue;
                (parNumero.get(k) || parNumero.set(k, []).get(k)).push(c);
            }
            console.log(`\n══ ${code} « ${L.nom} » ↔ artofpkm ${id} · ${cartes.length} cartes déclarent ${JSON.stringify(noms)}${L.bulba?.deck ? ` (deck ${L.bulba.deck})` : ''} en ${TIRAGE} · ${parNumero.size} numéros`);
            const entrees = await src.listerSet(id);
            if (!entrees.length) { verdicts.push({ code, id, ok: false, raison: 'liste artofpkm vide' }); continue; }
            if (src.releveComplet(entrees.pages) !== true) { verdicts.push({ code, id, ok: false, raison: `liste artofpkm incomplète (${entrees.cadresNonLus} cadres non lus, ou un lot suivant vide)` }); continue; }
            // Trois entrées DISTINCTES (relecture du 2026-10-06 : sur une liste courte, les trois rangs retombaient sur la même carte et
            // « 3/3 » ne prouvait qu'une) ; le rang 0 avance au lieu de reculer (une Énergie sans numéro en tête refusait la paire) ; et
            // chaque page sous le set SOURCE de l'entrée (une sous-section de kit est un set à part : /sets/643/card/1 sous la liste 206).
            const preuves = [], prises = new Set();
            for (const frac of [0, 0.5, 0.8]) {
                const pas = frac === 0 ? 1 : -1;
                let rang = Math.min(entrees.length - 1, Math.floor(frac * (entrees.length - 1))), page = null, e = null;
                for (let essai = 0; essai <= 10 && rang >= 0 && rang < entrees.length; essai++, rang += pas) {
                    e = entrees[rang]; page = null;
                    if (prises.has(src.cleEntree(e))) continue;
                    page = await src.pageCarte(e.sourceSetId ?? id, e.n);
                    if (page.numero) break;
                }
                if (!page?.numero) { preuves.push({ juge: false, detail: `rang ${Math.floor(frac * 100)} % : aucune entrée neuve à numéro imprimé à 10 rangs` }); continue; }
                prises.add(src.cleEntree(e));
                const cands = parNumero.get(cleNumero(page.numero)) || [];
                const memes = cands.filter(c => nomImage(c.nomEn) === nomImage(page.nomEn));
                preuves.push({ juge: true, ok: memes.length === 1 && cands.length >= 1, detail: `n°${page.numero}${page.total ? '/' + page.total : ''} « ${page.nomEn} » (${page.nomJa ?? '—'}) → chez nous ${cands.length ? cands.map(c => `« ${c.nomEn} »`).join(', ') : 'AUCUNE carte à ce numéro'}` });
            }
            const juges = preuves.filter(p => p.juge), ok = juges.length === 3 && juges.every(p => p.ok);
            for (const p of preuves) console.log(`   ${p.juge ? (p.ok ? '✅' : '❌') : '·'} ${p.detail}`);
            console.log(`   → ${ok ? `PROUVÉE 3/3` : `REFUSÉE (${juges.filter(p => p.ok).length}/${juges.length} jugés)`} · liste ${entrees.length} entrées`);
            verdicts.push({ code, id, ok, entrees: entrees.length, preuves: preuves.map(p => p.detail) });
        }
    } finally { await v.rendre(); }
    console.log(`\nVERDICTS : ${verdicts.filter(x => x.ok).length} prouvées sur ${verdicts.length} · requêtes artofpkm ${src.compteRequetes()}`);
    for (const x of verdicts) console.log(`   ${x.ok ? '✅' : '❌'} ${x.code} → ${x.id}${x.raison ? ` : ${x.raison}` : ''}${x.ok ? ` · « 3/3 : ${x.preuves.map(p => p.replace(/ \(.*?\) → .*$/, '')).join(', ')} »` : ''}`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });

// ============================================================
// LES FICHES QUI MÉLANGENT PLUSIEURS IMPRESSIONS — la mesure, sur tout le catalogue (2026-10-06, demande du testeur)
// ============================================================
//   node mesurer-fiches-melangees.js [--set=<slug>] [--exemples=N] [--json=<fichier>]
//
// 🔴 LE CAS DU TESTEUR : Ectoplasma et Mimiqui GX dans Tag Team Collection (AC3, indonésien). La carte n'a AUCUNE impression dans ce
// set ; le site en fait donc UNE fiche sans numéro (fichesDuDocument([])), et la règle « une fiche sans numéro garde ses produits »
// (produitsDeLaFiche) y range les QUATRE produits Cardmarket du set : a053 (RR), a228 (SR), a229 (SR alternative, 950 €) et a277 — quatre
// « Voir sur Cardmarket » sur une carte. La règle ne vaut que pour UN produit, ou plusieurs au MÊME numéro.
//
// CE QUE LA MESURE RECOPIE DU SITE (le motif en tête du catalogue : une sonde lit ce que lit la production) :
//   · les fiches d'un document dans un set = ses impressions (tirage du set ET expansion du set), une par numéro distinct
//     (lib/impressionsDuSet.ts, fichesDuDocument ; le tirage est `set.tirage ?? set.region`, CONTRAT-SITE.md) ;
//   · le numéro d'un produit pour le placer = `numeroFiche` de la ligne de jointure, comparé par numeroComparable (lib/cardmarket.ts :
//     majuscules, ponctuation ôtée, zéros de tête ôtés SEULEMENT en tête — « a53 » et « a053 » ne se rejoignent PAS) ;
//   · un set entier repasse « une fiche par document » dès qu'UN de ses documents a plusieurs fiches ET une image du set sans numéro
//     (documentAmbigu) : la correction ne doit jamais fabriquer ce cas.
// LES CLASSES, PAR (document × set) :
//   A  fiche SANS numéro (aucune impression dans le set) et produits à ≥ 2 numéros distincts → plusieurs liens sur une carte : LE DÉFAUT
//   B  fiche(s) numérotée(s) et produits dont le numéro n'est aucune fiche → produits montrés NULLE PART (« sans-fiche »)
//   ok le reste (un seul numéro, ou numéros tous couverts)
// Dénominateurs imprimés : lignes de jointure, couples (document × set), sets.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');


// lib/cardmarket.ts:23, mot pour mot
const numeroComparable = n => String(n ?? '').trim().split(/[\s(]/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
// lib/imageDeLImpression.ts:31, mot pour mot (null pour vide)
const normaliserNumero = n => { if (n === null || n === undefined) return null; const s = String(n).trim().toUpperCase().replace(/^0+(?=\d)/, ''); return s === '' ? null : s; };

async function mesurer({ cx, prod, seul = null }) {
    const sets = await cx.db.collection('sets').find(seul ? { _id: seul } : {}, { projection: { nomAffichage: 1, region: 1, tirage: 1, idExpansion: 1, 'bulba.expansion': 1, code: 1 } }).toArray();
    if (!sets.length) throw new Error(`aucun set${seul ? ` « ${seul} »` : ''} en base`);
    const setDeSlug = new Map(sets.map(s => [s._id, s]));
    const lignes = await cx.db.collection('cartes_produits').find(seul ? { slugSet: seul } : {}, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1, preuve: 1, detail: 1, tirage: 1, slug: 1 } }).toArray();
    const totalLignes = await cx.db.collection('cartes_produits').estimatedDocumentCount();
    if (!lignes.length) throw new Error('0 ligne de jointure lue : clé fausse ?');
    // le couple (document × set) : la ligne porte son set (slugSet) ; un set que `sets` ne connaît pas n'a pas de page
    const couples = new Map();
    let sansSet = 0;
    for (const l of lignes) {
        if (!setDeSlug.has(l.slugSet)) { sansSet++; continue; }
        const k = `${l.carteId}|${l.slugSet}`;
        (couples.get(k) || couples.set(k, []).get(k)).push(l);
    }
    const ids = [...new Set([...couples.keys()].map(k => Number(k.split('|')[0])))];
    const cartes = new Map();
    for (let i = 0; i < ids.length; i += 2000) {
        for (const c of await cx.db.collection('cartes').find({ _id: { $in: ids.slice(i, i + 2000) } }, { projection: { nomEn: 1, impressions: 1, 'images.set': 1, 'images.numero': 1 } }).toArray()) cartes.set(c._id, c);
    }
    const idProduits = [...new Set(lignes.map(l => l.idProduct))];
    const NC = new Map(), CAT = new Map();
    for (let i = 0; i < idProduits.length; i += 5000) {
        const tr = idProduits.slice(i, i + 5000);
        for (const n of await prod.db.collection('numeros_cartes').find({ idProduct: { $in: tr } }, { projection: { idProduct: 1, numero: 1, numeroUrl: 1, slug: 1, codeSet: 1 } }).toArray()) NC.set(n.idProduct, n);
        for (const n of await prod.db.collection('catalogue_produits').find({ idProduct: { $in: tr } }, { projection: { idProduct: 1, idMetacard: 1, name: 1 } }).toArray()) CAT.set(n.idProduct, n);
    }

    const res = { A: [], B: [], ok: 0, documentAbsent: 0 };
    for (const [k, ls] of couples) {
        const [cid, slugSet] = [Number(k.split('|')[0]), k.split('|').slice(1).join('|')];
        const s = setDeSlug.get(slugSet), c = cartes.get(cid);
        if (!c) { res.documentAbsent++; continue; }
        const tirage = s.tirage ?? s.region;
        const expansions = [].concat(s.bulba?.expansion ?? []);
        const imps = (c.impressions || []).filter(i => i.tirage === tirage && expansions.includes(i.expansion));
        const fiches = [...new Set(imps.map(i => normaliserNumero(i.numero) ?? ''))];
        const numerotees = fiches.filter(f => f !== '');
        const produits = ls.map(l => ({ idProduct: l.idProduct, slug: l.slug, numeroFiche: l.numeroFiche ?? null, ncNumero: NC.get(l.idProduct)?.numero ?? null,
                                         metacarte: CAT.get(l.idProduct)?.idMetacard ?? null, nom: CAT.get(l.idProduct)?.name ?? null, preuve: l.preuve, detail: l.detail ?? null }));
        const nums = [...new Set(produits.map(p => numeroComparable(p.numeroFiche ?? p.ncNumero)).filter(Boolean))];
        const imagesSansNumero = (c.images || []).filter(m => m.set === slugSet && normaliserNumero(m.numero) === null).length;
        const ligne = { carteId: cid, nomEn: c.nomEn, set: slugSet, nomSet: s.nomAffichage ?? null, publie: typeof s.nomAffichage === 'string', tirage, expansion: expansions[0] ?? null,
                        fiches: numerotees, numeros: nums, imagesSansNumero, produits };
        if (!numerotees.length) {
            if (nums.length >= 2) res.A.push(ligne); else res.ok++;
        } else {
            const couverts = new Set(numerotees.map(numeroComparable));
            const horsFiche = produits.filter(p => p.numeroFiche && !couverts.has(numeroComparable(p.numeroFiche)));
            if (horsFiche.length) res.B.push({ ...ligne, horsFiche: horsFiche.map(p => p.idProduct) }); else res.ok++;
        }
    }
    return { res, denominateurs: { lignes: lignes.length, totalLignes, sansSet, couples: couples.size, sets: sets.length } };
}

if (require.main === module) (async () => {
    // les arguments ne se lisent qu'en programme principal : poser-impressions-par-numero.js importe `mesurer` avec SES arguments
    const AUTORISES = [/^--set=.+$/, /^--exemples=\d+$/, /^--json=.+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
    const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || null;
    const SEUL = arg('set'), NEX = Number(arg('exemples') || 5), JSON_SORTIE = arg('json');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: [] });
    const { res, denominateurs: d } = await mesurer({ cx, prod, seul: SEUL });
    console.log(`\n════ DÉNOMINATEUR : ${d.lignes} lignes de jointure lues (sur ${d.totalLignes}) · ${d.sansSet} sans set en base · ${d.couples} couples (document × set) · ${d.sets} sets ════`);
    const resume = (nom, t) => {
        const pub = t.filter(x => x.publie);
        const produits = t.reduce((s, x) => s + x.produits.length, 0);
        const metaUne = t.filter(x => new Set(x.produits.map(p => p.metacarte)).size === 1 && x.produits.every(p => p.metacarte != null)).length;
        const ambRisque = t.filter(x => x.imagesSansNumero > 0).length;
        console.log(`\n${nom} : ${t.length} couples (${pub.length} sur des sets publiés) · ${produits} produits · ${new Set(t.map(x => x.set)).size} sets`);
        console.log(`   une seule métacarte Cardmarket pour tous les produits du couple : ${metaUne}/${t.length}`);
        console.log(`   une image du set SANS numéro sur le document (la correction ferait basculer le set entier) : ${ambRisque}/${t.length}`);
        const parSet = {}; for (const x of t) parSet[x.set] = (parSet[x.set] || 0) + 1;
        console.log(`   par set : ${Object.entries(parSet).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
        const parPreuve = {}; for (const x of t) for (const p of x.produits) parPreuve[p.preuve] = (parPreuve[p.preuve] || 0) + 1;
        console.log(`   preuves des lignes : ${Object.entries(parPreuve).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
        for (const x of t.slice(0, NEX)) console.log(`   ex. ${x.set} · ${x.carteId} « ${x.nomEn} » · fiches [${x.fiches.join(', ')}] · numéros des produits [${x.numeros.join(', ')}] · ${x.produits.map(p => `${p.idProduct}:${p.numeroFiche ?? '∅'}/${p.ncNumero ?? '∅'}`).join(' ')}`);
    };
    resume('A — fiche SANS numéro, produits à ≥ 2 numéros (plusieurs liens sur une carte)', res.A);
    resume('B — fiches numérotées, produits dont le numéro n\'est aucune fiche (montrés nulle part)', res.B);
    console.log(`\nok : ${res.ok} couples · document absent de \`cartes\` : ${res.documentAbsent}`);
    if (JSON_SORTIE) require('fs').writeFileSync(JSON_SORTIE, JSON.stringify(res, null, 1));
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });

module.exports = { mesurer, numeroComparable, normaliserNumero };

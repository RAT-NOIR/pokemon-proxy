// CALIBRATION (LECTURE SEULE) du rattachement Gem Pack sur la VÉRITÉ CONNUE : les produits qui ont DÉJÀ une fiche (posée par la métacarte, sans aucun numéro de liste).
// On CACHE ce que la clé du rattachement n'utilise pas — la ligne cartes_produits du produit ET l'appartenance de sa carte au set — puis on rejoue `planifierRattachement` : la carte qu'elle désigne
// doit être EXACTEMENT celle de la fiche connue. Cible : 0 faux ; les refus (silences) sont comptés à part, ils ne coûtent rien.
//   node ecrire-gempack-rattachement.js … est l'outil ; celui-ci ne fait que le mesurer.   Usage : node calibrer-gempack-rattachement.js [--sortie=<f>.json]   (lanceur avec le .env de main)
const fs = require('fs');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const LG = require('./collecte-cartes/listes-gempack');
const RG = require('./collecte-cartes/rattachement-gempack');
const E = require('./ecrire-fiches-preuve-set');
const V5 = require('./poser-fiches-voie-deux-sources');
const sortie = (process.argv.find(a => a.startsWith('--sortie=')) || '').slice(9) || null;

(async () => {
    const base = FPS.chargerSources('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET');
    const cx = await V5.ouvrirLecture();
    try {
        const exps = LG.SETS.map(s => s.exp);
        const lecture = await V5.lire({ cartesDb: cx.cartes.db, prodDb: cx.prod.db, expansions: exps });
        const { cibles, SETSL } = LG.preparerListes({ produitsDe: exp => lecture.produits.get(exp) || [], base });
        const { verdicts } = E.jugerTout({ sources: { ...base, SETS: { ...base.SETS, ...SETSL } }, lecture, cibles });
        const { entrees } = E.entreesDesSetsAdmis({ verdicts, lecture });
        const ligneDe = new Map(lecture.lignes.map(l => [l.idProduct, l]));
        const connus = entrees.filter(e => ligneDe.has(e.idProduct) && ligneDe.get(e.idProduct).preuve === 'metacarte+nom+attaques');
        const slugs = new Set(connus.map(e => e.slugSet)), idsConnus = new Set(connus.map(e => e.idProduct));
        const cartesVraies = new Set(connus.map(e => ligneDe.get(e.idProduct).carteId));
        // le monde SANS ce qu'on veut retrouver : ni les lignes, ni l'appartenance des cartes aux sets Gem Pack
        const cachee = { ...lecture, lignes: lecture.lignes.filter(l => !idsConnus.has(l.idProduct)),
            cartes: lecture.cartes.map(c => (cartesVraies.has(c._id) ? { ...c, sets: (c.sets || []).filter(s => !slugs.has(s)) } : c)) };
        const p = RG.planifierRattachement({ entrees: connus, lecture: cachee, expansionDe: RG.nomExpansionGemPack });
        let justes = 0, faux = 0; const fauxListe = [];
        for (const l of p.lignes) { const vrai = ligneDe.get(l.idProduct).carteId; if (vrai === l.carteId) justes++; else { faux++; fauxListe.push({ idProduct: l.idProduct, rattache: l.carteId, connue: vrai }); } }
        const refusParMotif = p.denominateurs.refusParMotif;
        const r = { le: new Date().toISOString(), produitsDeVeriteConnue: connus.length, rattaches: p.lignes.length, justes, faux, fauxListe: fauxListe.slice(0, 10), silences: connus.length - p.lignes.length, refusParMotif, denominateurs: p.denominateurs };
        console.log(`CALIBRATION DU RATTACHEMENT (vérité = ${connus.length} produits déjà fichés par la métacarte, lignes ET appartenance cachées) : rattachés ${r.rattaches} → JUSTES ${justes}, FAUX ${faux} · silences ${r.silences} ${JSON.stringify(refusParMotif)}`);
        if (sortie) fs.writeFileSync(sortie, JSON.stringify(r, null, 1));
        if (faux) { console.error('❌ FAUX à la calibration : la règle ne se tait pas là où elle devrait'); process.exitCode = 3; }
        if (!connus.length) { console.error('❌ aucune vérité connue : une calibration sur zéro ne prouve rien'); process.exitCode = 3; }
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });

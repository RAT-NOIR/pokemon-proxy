// ============================================================
// RETIRER LES 33 IMPRESSIONS TIRÉES DE TEXTE EN COMMENTAIRE HTML — liste fermée, identifiées par leur CONTENU (R7, 2026-10-12)
// ============================================================
//   node retirer-impressions-commentees.js [--annonce=<fichier.json>]     (MESURE, par défaut : rien n'est écrit ; --annonce écrit le fichier)
//   node lot-additif.js --quoi="retrait de 33 impressions tirees de texte commente (R7)" --collections=cartes \
//        --annonce=collecte-cartes/rapports/annonce-impressions-commentees.json -- node retirer-impressions-commentees.js --ecrire
//
// DÉCISION DU TESTEUR (2026-10-12) : « Les 33 impressions issues de texte commenté : si ce n'est pas encore fait, supprime-les sous la
// garde, et ferme la cause dans l'extracteur. » La cause est fermée : `sansCommentaires` en tête de `gabarits()` et de `entreesDeLaSetlist`
// (collecte-cartes/wikitext.js, 7c1b2ac), et — trouvé à la relecture de ce lot — dans tirage-image.js, qui lisait encore le wikitext brut.
// Ce correctif ne corrige AUCUNE ligne déjà écrite (§23) : cet outil est la seconde moitié.
// LISTE FERMÉE : 22 cartes, 33 impressions (2 japonaises fantômes — Oddish 295618, Paradise Resort 294172 — et 31 « Delta Reign » de
// Storm Emeralda aux numéros XXX/000 et aux totaux « 103--> »). Chaque impression est identifiée par son CONTENU EXACT
// (tirage, expansion, deck, numero, total, rarete), jamais par sa position. L'outil REFUSE (et n'écrit rien) si, pour une seule carte :
//   · elle est introuvable, ou son nomEn n'est pas celui de la liste, ou sa page archivée est illisible ;
//   · une impression listée n'est pas présente EXACTEMENT autant de fois que la liste le dit ;
//   · le parseur d'AUJOURD'HUI, rejoué sur la page archivée, LIT une des impressions listées (elle ne serait alors plus un fantôme).
// Il ne touche qu'à `cartes.impressions` : ni `sets`, ni `images`, ni `cartes_produits` (mesuré le 2026-10-12 : aucune image, aucune ligne
// de jointure n'appartient à ces impressions — leurs images et lignes sont celles des vraies impressions Storm Emeralda / Promos).
// L'annonce est calculée par compterEtat, la fonction même de la garde de lot : elle ne peut pas diverger de ce qu'elle juge.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const W = require('./collecte-cartes/wikitext');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const imp = (tirage, expansion, numero, total, rarete) => Object.freeze({ tirage, expansion, deck: null, numero, total, rarete });
const DR = (numero, total, rarete) => imp('intl', 'Delta Reign', numero, total, rarete);
const c = (id, nomEn, ...impressions) => Object.freeze({ id, nomEn, impressions: Object.freeze(impressions) });
const CIBLES = Object.freeze([
    c(352499, 'Bubbly Water Energy', DR('000', '000-->', 'Ultra Rare')),
    c(353243, 'Nitro Fire Energy', DR('000', '000-->', 'Ultra Rare')),
    c(349755, 'Growing Grass Energy', DR('000', '000-->', 'Ultra Rare')),
    c(294172, 'Paradise Resort', imp('jp', 'M-P Promotional cards', null, null, null)),
    c(295618, 'Oddish', imp('jp', 'SV-P Promotional cards', '???', 'SV-P-->', null)),
    c(358758, 'Mega Malamar ex', DR('XXX', '103-->', 'Ultra Rare')),
    c(359040, 'Wishiwashi ex', DR('120', '103-->', 'Ultra Rare')),
    c(359371, 'Heat Rotom ex', DR('119', '103-->', 'Ultra Rare')),
    c(359373, 'Mega Golurk ex', DR('XXX', '103-->', 'Ultra Rare'), DR('XXX', '103-->', 'Special Illustration Rare')),
    c(359372, 'Raikou ex', DR('000', '103-->', 'Double Rare'), DR('000', '103-->', 'Ultra Rare')),
    c(359039, 'Mega Golisopod ex', DR('XXX', '103-->', 'Ultra Rare'), DR('XXX', '103-->', 'Special Illustration Rare')),
    c(358136, 'Mega Rayquaza ex', DR('XXX', '103-->', 'Ultra Rare'), DR('XXX', '103-->', 'Special Illustration Rare'), DR('XXX', '103-->', 'Mega Hyper Rare')),
    c(358139, 'Talonflame ex', DR('000', '000-->', 'Double Rare'), DR('000', '000-->', 'Ultra Rare')),
    c(358142, 'Mega Rayquaza Cap', DR('000', '000-->', 'Uncommon')),
    c(358141, 'Adventuring Lantern', DR('000', '000-->', 'Uncommon'), DR('000', '000-->', 'Ultra Rare')),
    c(358146, 'Zinnia\'s Trust', DR('131', '103-->', 'Ultra Rare'), DR('140', '103-->', 'Special Illustration Rare')),
    c(359043, 'Custom Vest', DR('000', '000-->', 'Uncommon'), DR('000', '000-->', 'Ultra Rare')),
    c(359041, 'Delicious Onigiri', DR('000', '000-->', 'Uncommon')),
    c(359044, 'Aarune', DR('125', '103-->', 'Ultra Rare'), DR('139', '103-->', 'Special Illustration Rare')),
    c(359375, 'Legendary Lava Tube', DR('000', '000 (Left Half) 000/000 (Right Half)-->', 'Uncommon')),
    c(359377, 'Tate & Liza\'s Training', DR('000', '000-->', 'Uncommon'), DR('000', '000-->', 'Ultra Rare')),
    c(359416, 'Azurill', DR('080', '103-->', 'Common'))
]);
const FICHIER_ANNONCE = path.join('collecte-cartes', 'rapports', 'annonce-impressions-commentees.json');

// Le contenu EXACT d'une impression : six champs, null et absent confondus (le parseur écrit `deck: null`).
const CHAMPS = ['tirage', 'expansion', 'deck', 'numero', 'total', 'rarete'];
const nul = v => v === undefined ? null : v;
const memeContenu = (a, b) => !!a && !!b && CHAMPS.every(k => nul(a[k]) === nul(b[k]));
const cleLue = i => CHAMPS.map(k => nul(i[k])).join('|');

/**
 * @param {object} cible une entrée de CIBLES
 * @param {{carte: object|null, texte: string|null}} etat ce que la base et l'archive disent
 * @returns {{refus: string|null, carteApres: object|null, retirees: number, relues: number}}
 */
function planifier(cible, { carte, texte }) {
    const non = refus => ({ refus: `carte ${cible.id} : ${refus}`, carteApres: null, retirees: 0, relues: 0 });
    if (!carte) return non('introuvable en base');
    if (carte.nomEn !== cible.nomEn) return non(`nomEn « ${carte.nomEn} » au lieu de « ${cible.nomEn} »`);
    if (typeof texte !== 'string') return non('page archivée illisible (la prémisse « le parseur ne lit plus ces impressions » ne se rejoue pas)');
    const lues = new Set(W.faitsDeCarte(texte, carte.bulba?.titre ?? null).impressions.map(cleLue));
    const relues = cible.impressions.filter(s => lues.has(cleLue(s)));
    if (relues.length) return non(`le parseur d'aujourd'hui lit ${relues.length} des impressions listées sur la page archivée (${relues.map(cleLue).join(' ; ')}) : elles ne sont pas des fantômes`);
    // chaque impression listée doit être présente EXACTEMENT autant de fois que la liste la porte (identiques comprises)
    for (const s of new Set(cible.impressions.map(cleLue))) {
        const attendu = cible.impressions.filter(x => cleLue(x) === s).length;
        const presentes = (carte.impressions || []).filter(i => memeContenu(i, cible.impressions.find(x => cleLue(x) === s))).length;
        if (presentes !== attendu) return non(`${presentes} impression(s) « ${s} » au lieu de ${attendu} : l'état diffère de la liste`);
    }
    const restantes = (carte.impressions || []).filter(i => !cible.impressions.some(s => memeContenu(i, s)));
    return { refus: null, carteApres: { ...carte, impressions: restantes }, retirees: (carte.impressions || []).length - restantes.length, relues: relues.length };
}

/** L'annonce de la garde : `impressions` et `illustrateurs` par (tirage|expansion), comptés par compterEtat avant / après le retrait de la liste. */
function annonceDe(cartes) {
    const parId = new Map(CIBLES.map(x => [x.id, x]));
    const apres = cartes.map(carte => {
        const cible = parId.get(carte._id);
        return cible ? { ...carte, impressions: (carte.impressions || []).filter(i => !cible.impressions.some(s => memeContenu(i, s))) } : carte;
    });
    const { baisses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }));
    return Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
}
/** Une impression ne porte qu'un NOM d'expansion : le site revalide TOUS les sets de la carte (setsTouches). On imprime cette union. */
const setsARevalider = cartes => [...new Set(cartes.filter(x => CIBLES.some(t => t.id === x._id)).flatMap(x => x.sets || []))].sort();

/** L'écriture : UN `$pull` par carte, par contenu exact de chaque impression listée ; jamais une position. @returns {Promise<number>} documents modifiés */
async function appliquer(db, cible) {
    const ou = cible.impressions.map(s => Object.fromEntries(CHAMPS.map(k => [k, nul(s[k])])));
    const r = await db.collection('cartes').updateOne({ _id: cible.id }, { $pull: { impressions: { $or: ou } } });
    return r.modifiedCount;
}

/** Relecture APRÈS écriture, comparée à l'ATTENDU du lot (`carteApres` du plan). @returns {string[]} les écarts (vide = conforme) */
function verifierRelu(cible, avant, relu) {
    if (!relu) return [`carte ${cible.id} introuvable à la relecture`];
    const ecarts = [];
    const restes = (relu.impressions || []).filter(i => cible.impressions.some(s => memeContenu(i, s)));
    if (restes.length) ecarts.push(`${restes.length} impression(s) listée(s) encore présente(s)`);
    const attendues = (avant.impressions || []).filter(i => !cible.impressions.some(s => memeContenu(i, s)));
    if (JSON.stringify((relu.impressions || [])) !== JSON.stringify(attendues)) ecarts.push(`les impressions restantes ne sont pas celles attendues (${(relu.impressions || []).length} relues pour ${attendues.length})`);
    return ecarts;
}

module.exports = { CIBLES, planifier, annonceDe, setsARevalider, appliquer, verifierRelu, FICHIER_ANNONCE, memeContenu };

if (require.main === module) (async () => {
    const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --annonce=<fichier.json>, --ecrire`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const fichierAnnonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const r2 = require('./collecte-cartes/r2');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    let code = 0;
    try {
        await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
        const plans = [];
        for (const cible of CIBLES) {
            const carte = await cx.db.collection('cartes').findOne({ _id: cible.id });
            const texte = carte?.bulba?.cleR2 ? await r2.lireTexte(process.env.R2_BUCKET_BRUT, carte.bulba.cleR2).catch(() => null) : null;
            const p = planifier(cible, { carte, texte });
            plans.push({ cible, carte, p });
            if (p.refus) { console.log(`   🔴 REFUS — ${p.refus}`); code = 1; continue; }
            console.log(`   ${cible.id} ${cible.nomEn} : ${p.retirees} impression(s) à retirer sur ${(carte.impressions || []).length} (${cible.impressions.map(i => `${i.tirage} ${i.expansion} ${i.numero ?? '∅'}/${i.total ?? '∅'}`).join(' ; ')})`);
        }
        const attendues = CIBLES.reduce((a, x) => a + x.impressions.length, 0), retirees = plans.reduce((a, x) => a + x.p.retirees, 0);
        console.log(`   dénominateur : ${CIBLES.length} cibles, ${plans.filter(x => x.carte).length} trouvées, ${plans.filter(x => x.p.refus).length} refusée(s) · impressions : ${attendues} listées, ${retirees} à retirer`);
        if (code) { console.log('   rien n\'est écrit : un refus arrête tout.'); process.exitCode = code; return; }
        const cartes = plans.map(x => x.carte);
        const annonce = annonceDe(cartes);
        console.log(`   annonce de la garde (--annonce=) : ${JSON.stringify(annonce)}`);
        console.log(`   sets à revalider (union des sets des ${CIBLES.length} cartes, ce que lot-additif.js calcule) : ${setsARevalider(cartes).join(' · ')}`);
        if (fichierAnnonce) { fs.mkdirSync(path.dirname(path.resolve(fichierAnnonce)), { recursive: true }); fs.writeFileSync(path.resolve(fichierAnnonce), JSON.stringify(annonce, null, 1)); console.log(`   annonce écrite : ${fichierAnnonce}`); }
        if (!ECRIRE) { console.log('   (mesure — rien n\'est écrit ; voir l\'en-tête pour la commande lot-additif.js)'); return; }
        for (const { cible, carte, p } of plans) {
            const n = await appliquer(cx.db, cible);
            const relu = await cx.db.collection('cartes').findOne({ _id: cible.id });
            const ecarts = verifierRelu(cible, carte, relu);
            console.log(`   ${ecarts.length || n !== 1 ? '🔴' : '✅'} ${cible.id} : modifiée ${n} (attendu 1), ${p.retirees} retirée(s) · relu : ${ecarts.length ? ecarts.join(' ; ') : 'conforme'}`);
            if (ecarts.length || n !== 1) code = 1;
        }
        process.exitCode = code;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exit(1); });

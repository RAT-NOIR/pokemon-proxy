// ============================================================
// UNE IMPRESSION PAR NUMÉRO CARDMARKET — la correction des fiches qui mélangent plusieurs impressions (2026-10-06)
// ============================================================
//   node poser-impressions-par-numero.js [--set=<slug>]          (simulation : classes, refus motivés, contrôle de la règle du site)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-impressions-par-numero.js --ecrire
//
// LA DEMANDE (testeur) : « une fiche sans numéro garde ses produits » ne vaut que pour UN produit, ou plusieurs au MÊME numéro. Plusieurs
// numéros différents = plusieurs impressions : une impression par numéro, chaque produit sur sa fiche. La mesure (mesurer-fiches-melangees.js,
// la même fonction) range les couples (document × set) en A (fiche sans numéro, produits à ≥ 2 numéros) et B (produits dont le numéro
// n'est aucune fiche : montrés nulle part).
// CE QUI EST ÉCRIT, ET SEULEMENT ÇA — deux sources par numéro, sinon rien (0 faux affirmé) :
//   · le numéro CARDMARKET du produit (`numeroFiche` de la ligne, sinon le numéro appris de Cardmarket, numeros_cartes.numero) ;
//   · confirmé par une source INDÉPENDANTE : la Setlist de Bulbapedia qui range cette carte à ce numéro (le `detail` d'une ligne
//     « setlist+numero » / « set+numero »), la POSITION dans la liste imprimée d'un deck Battle Academy (« deck+section+position » :
//     n° Cardmarket = position lue sur la page du produit), ou une ENTRÉE de la Setlist archivée au nom de la carte et à ce numéro
//     (un lien rouge compte : c'est la Setlist qui parle, pas la page de carte).
// UN COUPLE N'EST TOUCHÉ QUE SI : chaque produit y reçoit un numéro confirmé (sinon un produit qui s'affiche aujourd'hui ne
// s'afficherait plus nulle part) ; le document n'a aucune image de ce set SANS numéro (le site repasserait le set ENTIER en « une fiche
// par document », documentAmbigu) ; le document n'a pas d'impression sans numéro dans ce set.
// L'IMPRESSION ÉCRITE : tirage et expansion du set (ceux que le site apparie), `numero` = le numeroFiche (le site compare par
// numeroComparable : « a53 » ≠ « a053 » — l'impression porte EXACTEMENT ce que la ligne dit), `rarete` = celle de l'entrée de Setlist
// quand une seule entrée de la page porte ce nom et ce numéro (Cardmarket ne nous donne pas la rareté : aucune requête), sinon null ;
// `source: 'numero-cardmarket'` (la marque de conservation, impressions-posees.js) et `preuveNumero` (la seconde source, en clair).
// Les lignes sans `numeroFiche` le reçoivent (un champ absent posé : additif), pour que le site place le produit par le champ.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const W = require('./collecte-cartes/wikitext');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { mesurer, numeroComparable, normaliserNumero } = require('./mesurer-fiches-melangees');
const TIRAGES = new Set(['jp', 'intl', 'zh-hans', 'zh-hant', 'id', 'th', 'idth', 'ko']);

const AUTORISES = [/^--ecrire$/, /^--set=.+$/, /^--completer-numero-fiche$/, /^--retirer-expansion-nulle$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire, --set=<slug>, --completer-numero-fiche, --retirer-expansion-nulle`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire');
const COMPLETER = process.argv.includes('--completer-numero-fiche');
const RETIRER_NULLE = process.argv.includes('--retirer-expansion-nulle');

/**
 * --retirer-expansion-nulle : défait la seule part fautive du premier lot (2026-10-06, 06:47 UTC) — les impressions « numero-cardmarket »
 * écrites avec `expansion: null` pour les sets Battle Academy, que le site aurait montrées dans tout set sans nom d'expansion. Ne retire
 * QUE ces impressions-là (source ET expansion nulle), rien que cet outil n'ait posé. La simulation écrit l'annonce exacte de la baisse
 * (par la fonction de la garde) pour lot-additif.js --annonce=.
 */
async function retirerExpansionNulle({ cx, ecrire }) {
    const filtreImp = { source: 'numero-cardmarket', expansion: null };
    const cartes = await cx.db.collection('cartes').find({ impressions: { $elemMatch: filtreImp } }, { projection: { impressions: 1, sets: 1 } }).toArray();
    const sans = c => ({ ...c, impressions: c.impressions.filter(i => !(i && i.source === 'numero-cardmarket' && i.expansion == null)) });
    const n = cartes.reduce((s, c) => s + c.impressions.length - sans(c).impressions.length, 0);
    const { baisses, hausses } = comparer(compterEtat({ cartes }), compterEtat({ cartes: cartes.map(sans) }));
    const annonce = Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
    const fichier = require('path').join(__dirname, 'collecte-cartes', 'rapports', `annonce-retirer-expansion-nulle-${new Date().toISOString().slice(0, 10)}.json`);
    require('fs').mkdirSync(require('path').dirname(fichier), { recursive: true });
    require('fs').writeFileSync(fichier, JSON.stringify(annonce, null, 1));
    console.log(`\n════ ${n} impressions « numero-cardmarket » à expansion NULLE sur ${cartes.length} cartes · baisses annoncées ${JSON.stringify(annonce)} · hausses ${JSON.stringify(hausses)} → ${fichier}`);
    if (!ecrire) { console.log('   (simulation — lot-additif.js --annonce=<ce fichier> … -- node poser-impressions-par-numero.js --retirer-expansion-nulle --ecrire)'); return 0; }
    const r = await cx.db.collection('cartes').updateMany({ impressions: { $elemMatch: filtreImp } }, { $pull: { impressions: filtreImp } });
    const reste = await cx.db.collection('cartes').countDocuments({ impressions: { $elemMatch: filtreImp } });
    console.log(`   ✅ cartes modifiées : ${r.modifiedCount}/${cartes.length} · relu : ${reste} carte(s) en portent encore`);
    return r.modifiedCount === cartes.length && reste === 0 ? 0 : 1;
}
const SEUL = (process.argv.find(a => a.startsWith('--set=')) || '').slice(6) || null;

/** « a053 », « A53 », « 053/205 » → « A53 » ; la comparaison des DEUX sources ignore les zéros de tête après le préfixe. */
const cleSource = n => numeroComparable(String(n ?? '').split('/')[0]).replace(/^([A-Z]*)0+(\d)/, '$1$2');
const chiffres = n => (/(\d+)/.exec(String(n ?? '')) || [])[1]?.replace(/^0+(?=\d)/, '') ?? null;
const nomPlat = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const RARETE = /^(C|U|R|RR|RRR|SR|HR|UR|AR|SAR|SSR|CHR|CSR|PR|TR|K|A|S|IR|SIR|MUR|BWR|ACE|Promo|Common|Uncommon|Rare)$/;

/** Les entrées de la Setlist archivée d'un set : nom de la carte, numéro (chiffres), rareté (dernier positionnel s'il en a la forme). */
async function setlistDuSet(set) {
    const cle = set.bulba?.cleR2 || (set.bulba?.pageid && set.bulba?.revid ? r2.cleWikitext(set.bulba.pageid, set.bulba.revid) : null);
    if (!cle) return { entrees: [], raison: 'aucune page archivée' };
    let texte;
    try { texte = await r2.lireTexte(process.env.R2_BUCKET_BRUT, cle); } catch (e) { return { entrees: [], raison: `archive illisible (${e.name})` }; }
    const entrees = [];
    for (const g of W.gabarits(texte)) {
        if (!/^Setlist\/\w*entry$/i.test(g.nom)) continue;
        const e = W.entreeDeSetlist(g.brut);
        if (!e?.titre) continue;
        const m = /^(.*) \(([^()]*?)\s*([A-Za-z]*\d+[A-Za-z]*)\)$/.exec(e.titre);
        if (!m) continue;
        const derniers = g.positionnels.filter(p => p.trim() !== '');
        const r = derniers.length ? derniers[derniers.length - 1].trim() : '';
        entrees.push({ nom: nomPlat(m[1]), numero: chiffres(m[3]), rarete: RARETE.test(r) ? r : null, titre: e.titre });
    }
    // (relecture du 2026-10-06) une page à PLUSIEURS sections (Set A / Set B, deux moitiés renumérotées) : les chiffres seuls ne disent
    // pas de quelle section est l'entrée — ni la confirmation par l'entrée, ni la rareté n'y sont prises
    const sections = W.sectionsSetlist(texte).filter(s => s.entrees.length).length;
    return { entrees, raison: null, sections };
}

/** La seconde source d'un produit : rend { numero, preuve } ou { refus }. */
function confirmer(p, nomCarte, setlist) {
    const numero = p.numeroFiche ?? p.ncNumero;
    if (!numero) return { refus: 'aucun numéro Cardmarket' };
    if (p.preuve === 'setlist+numero' || p.preuve === 'set+numero') {
        const nums = ((/^n°([^ ]+(?:, [^ ]+)*) dans/.exec(p.detail || '') || [])[1] || '').split(', ').filter(Boolean).map(cleSource);
        if (nums.includes(cleSource(numero))) return { numero, preuve: `Setlist de Bulbapedia (${p.detail})` };
        return { refus: `numéro ${numero} absent de la Setlist de la ligne (${p.detail})` };
    }
    if (p.preuve === 'deck+section+position') {
        const m = /n°([A-Za-z0-9]+) → deck « ([^»]+) », position (\d+)/.exec(p.detail || '');
        if (m && cleSource(m[1]) === cleSource(numero) && chiffres(m[1]) === m[3]) return { numero, preuve: `position ${m[3]} dans la liste imprimée du ${m[2]} (Bulbapedia)` };
        return { refus: `position du deck non lue ou différente du numéro ${numero} (${(p.detail || '').slice(0, 80)})` };
    }
    // toute autre preuve : une entrée de la Setlist archivée, au nom de la carte et à ce numéro, UNE seule — sur une page à une section
    if ((setlist.sections ?? 0) > 1) return { refus: `la page porte ${setlist.sections} sections de Setlist : les chiffres ne disent pas laquelle` };
    const n = chiffres(numero);
    const ents = setlist.entrees.filter(e => e.nom === nomPlat(nomCarte) && e.numero === n);
    if (ents.length === 1) return { numero, preuve: `entrée de Setlist « ${ents[0].titre} » (Bulbapedia, archive)` };
    return { refus: ents.length ? `${ents.length} entrées de Setlist à ce nom et ce numéro` : `aucune entrée de Setlist « ${nomCarte} » n°${n}${setlist.raison ? ` (${setlist.raison})` : ''}` };
}

function rareteDe(setlist, nomCarte, numero) {
    if ((setlist.sections ?? 0) > 1) return null;
    const ents = setlist.entrees.filter(e => e.nom === nomPlat(nomCarte) && e.numero === chiffres(numero));
    return ents.length === 1 ? ents[0].rarete : null;
}

/**
 * --completer-numero-fiche : la moitié que le premier lot n'a pas écrite (260 lignes à `numeroFiche: null`). Tirée de la BASE, donc
 * rejouable sans rien changer deux fois : une ligne de jointure dont `numeroFiche` est nul ou absent, dont la carte porte une impression
 * `numero-cardmarket` dans le set de la ligne (tirage et expansion du set), et dont le numéro CARDMARKET du produit (numeros_cartes.numero)
 * est, au sens du site (numeroComparable), le numéro de cette impression — qui a été écrite depuis ce même numéro, confirmé par sa seconde
 * source. Elle reçoit ce numéro, tel que l'impression le porte. Rien d'autre n'est touché.
 */
async function completerNumeroFiche({ cx, prod, ecrire }) {
    const sets = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const cartes = await cx.db.collection('cartes').find({ 'impressions.source': 'numero-cardmarket' }, { projection: { impressions: 1 } }).toArray();
    const lignes = await cx.db.collection('cartes_produits').find({ carteId: { $in: cartes.map(c => c._id) }, numeroFiche: null }, { projection: { carteId: 1, idProduct: 1, slugSet: 1 } }).toArray();
    const NC = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, numero: 1 } }).toArray()).map(n => [n.idProduct, n.numero]));
    const parCarte = new Map(cartes.map(c => [c._id, c]));
    console.log(`\n════ DÉNOMINATEUR : ${cartes.length} cartes portent une impression « numero-cardmarket » · ${lignes.length} de leurs lignes de jointure ont numeroFiche nul ou absent ════`);
    const aPoser = [], causes = {};
    for (const l of lignes) {
        const s = sets.get(l.slugSet);
        if (!s) { causes['set absent'] = (causes['set absent'] || 0) + 1; continue; }
        const tirage = s.tirage ?? s.region, exps = [].concat(s.bulba?.expansion ?? []);
        const imps = (parCarte.get(l.carteId).impressions || []).filter(i => i.source === 'numero-cardmarket' && i.tirage === tirage && exps.includes(i.expansion));
        if (!imps.length) { causes['aucune impression « numero-cardmarket » dans CE set (ligne d\'un autre set de la carte)'] = (causes['aucune impression « numero-cardmarket » dans CE set (ligne d\'un autre set de la carte)'] || 0) + 1; continue; }
        const nc = NC.get(l.idProduct);
        const imp = imps.filter(i => nc != null && numeroComparable(i.numero) === numeroComparable(nc));
        if (imp.length !== 1) { causes[`${imp.length} impression(s) au numéro Cardmarket du produit`] = (causes[`${imp.length} impression(s) au numéro Cardmarket du produit`] || 0) + 1; continue; }
        aPoser.push({ carteId: l.carteId, idProduct: l.idProduct, numeroFiche: imp[0].numero, set: l.slugSet });
    }
    for (const [c, n] of Object.entries(causes)) console.log(`   ${String(n).padStart(5)} · non touchée : ${c}`);
    const parSet = {}; for (const a of aPoser) parSet[a.set] = (parSet[a.set] || 0) + 1;
    console.log(`   🔑 ${aPoser.length} numeroFiche à poser · ${Object.entries(parSet).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
    if (!ecrire) { console.log('   (simulation — --ecrire les pose, sous lot-additif.js)'); return 0; }
    let n = 0;
    for (const a of aPoser) n += (await cx.db.collection('cartes_produits').updateOne({ carteId: a.carteId, idProduct: a.idProduct, numeroFiche: null }, { $set: { numeroFiche: a.numeroFiche, numeroFicheSource: 'poser-impressions-par-numero (2026-10-06)' } })).modifiedCount;
    let reste = 0;      // relu sur TOUT l'ensemble, par paquets (relecture : un `slice(0, 1000)` rendait la relecture vraie au-delà)
    for (let i = 0; i < aPoser.length; i += 500)
        reste += await cx.db.collection('cartes_produits').countDocuments({ $or: aPoser.slice(i, i + 500).map(a => ({ carteId: a.carteId, idProduct: a.idProduct, numeroFiche: null })) });
    console.log(`   ✅ numeroFiche posés : ${n}/${aPoser.length} · relu : ${reste} encore nul(s)`);
    return n === aPoser.length && reste === 0 ? 0 : 1;
}

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: ['R2_BUCKET_BRUT'] });
    if (COMPLETER) { const code = await completerNumeroFiche({ cx, prod, ecrire: ECRIRE }); await fermer(); process.exit(code); }
    if (RETIRER_NULLE) { const code = await retirerExpansionNulle({ cx, ecrire: ECRIRE }); await fermer(); process.exit(code); }
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const { res, denominateurs: d } = await mesurer({ cx, prod, seul: SEUL });
    console.log(`\n════ DÉNOMINATEUR : ${d.couples} couples (document × set) sur ${d.lignes} lignes de jointure · A ${res.A.length} · B ${res.B.length} ════`);
    const sets = new Map((await cx.db.collection('sets').find({ _id: { $in: [...new Set([...res.A, ...res.B].map(x => x.set))] } }, { projection: { bulba: 1 } }).toArray()).map(s => [s._id, s]));
    const setlists = new Map();
    for (const slug of sets.keys()) setlists.set(slug, await setlistDuSet(sets.get(slug)));
    const cartesDoc = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set([...res.A, ...res.B].map(x => x.carteId))] } }, { projection: { nomEn: 1, impressions: 1, images: 1, sets: 1 } }).toArray()).map(c => [c._id, c]));

    const issues = {}, aPoser = new Map(), numerosFiche = [], corriges = [], candidats = [], groupesRefuses = new Set();
    const note = (cause, ex) => { (issues[cause] || (issues[cause] = { n: 0, ex: [] })).n++; if (issues[cause].ex.length < 3) issues[cause].ex.push(ex); };
    for (const [classe, liste] of [['A', res.A], ['B', res.B]]) for (const x of liste) {
        const c = cartesDoc.get(x.carteId), setlist = setlists.get(x.set);
        const ex = `${x.set} · ${x.carteId} « ${x.nomEn} » [${x.numeros.join(', ')}]`;
        // 🔴 UN SET SANS NOM D'EXPANSION NE PORTE PAS D'IMPRESSION (2026-10-06, le premier lot) : le site rapproche une impression d'un set
        // par `bulba.expansion` ; nul des deux côtés, l'impression s'affiche dans TOUT set sans nom de la carte (Battle Academy 2020/2022/2024,
        // WCD, Professor Program, Trick or Trade) — 118 impressions écrites ainsi, retirées une heure plus tard (--retirer-expansion-nulle).
        // (relecture du 2026-10-06) LE GROUPE : le site montre une impression dans TOUT set de la carte au même tirage et au même nom
        // d'expansion (un set et ses Additionals). Les couples d'un groupe se corrigent ENSEMBLE ou pas du tout — sinon le couple refusé
        // perdrait sa fiche sans numéro (ses produits rangés nulle part).
        const groupe = `${x.carteId}|${x.tirage}|${x.expansion}`;
        const refuser = (cause, detail = ex) => { note(`${classe} · refusé : ${cause}`, detail); groupesRefuses.add(groupe); };
        // une garde s'écrit par ce qu'elle autorise : un tirage connu et un NOM d'expansion
        if (typeof x.expansion !== 'string' || !x.expansion) { refuser('le set n\'a pas de nom d\'expansion (une impression s\'y afficherait dans tous les sets sans nom)'); continue; }
        if (!TIRAGES.has(x.tirage)) { refuser(`tirage « ${x.tirage} » inconnu`); continue; }
        if (x.imagesSansNumero > 0) { refuser('une image du set sans numéro sur le document (le set entier basculerait)'); continue; }
        const impsSet = (c.impressions || []).filter(i => i.tirage === x.tirage && i.expansion === x.expansion);
        if (impsSet.some(i => i.numero == null || String(i.numero).trim() === '')) { refuser('une impression SANS numéro dans ce set'); continue; }
        const concernes = classe === 'A' ? x.produits : x.produits.filter(p => x.horsFiche.includes(p.idProduct));
        const conf = concernes.map(p => ({ p, ...confirmer(p, x.nomEn, setlist) }));
        const refuses = conf.filter(k => k.refus);
        if (refuses.length) { refuser(`${refuses.length === conf.length ? 'aucun' : 'pas tous les'} produits confirmés par une seconde source — ${refuses[0].refus.replace(/\d+/g, '#').slice(0, 90)}`, `${ex} · ${refuses[0].refus.slice(0, 160)}`); continue; }
        // (relecture) un numéro qui ne diffère d'une impression existante QUE par l'écriture (« a053 » contre « A53 ») ferait deux fiches
        const parSource = new Map(impsSet.map(i => [cleSource(i.numero), numeroComparable(i.numero)]));
        const ecrit = conf.find(k => parSource.has(cleSource(k.numero)) && parSource.get(cleSource(k.numero)) !== numeroComparable(k.numero));
        if (ecrit) { refuser(`le numéro ${ecrit.numero} s'écrit autrement qu'une impression existante de ce set`); continue; }
        // les numéros à créer : ceux qu'aucune impression du set ne porte déjà (au sens du site)
        const deja = new Set(impsSet.map(i => numeroComparable(i.numero)));
        const nouvelles = [], vus = new Set();
        for (const k of conf) {
            const cleSite = numeroComparable(k.numero);
            if (deja.has(cleSite) || vus.has(cleSite)) continue;
            vus.add(cleSite);
            nouvelles.push({ tirage: x.tirage, expansion: x.expansion, numero: String(k.numero), total: null, deck: null, rarete: rareteDe(setlist, x.nomEn, k.numero),
                             source: 'numero-cardmarket', preuveNumero: `Cardmarket idProduct ${k.p.idProduct} ; ${k.preuve}` });
        }
        // (relecture) une image du set qui ne retrouverait plus aucune fiche ne s'afficherait plus : le couple est refusé
        const fichesImg = new Set([...impsSet, ...nouvelles].map(i => normaliserNumero(i.numero)));
        const orpheline = (c.images || []).find(m => m.set === x.set && normaliserNumero(m.numero) !== null && !fichesImg.has(normaliserNumero(m.numero)));
        if (orpheline) { refuser(`l'image n°${orpheline.numero} du set ne retrouverait aucune fiche`); continue; }
        candidats.push({ groupe, x, classe, nouvelles, nf: conf.filter(k => k.p.numeroFiche == null || k.p.numeroFiche === '').map(k => ({ carteId: x.carteId, idProduct: k.p.idProduct, numeroFiche: String(k.numero) })) });
    }
    // un groupe dont UN couple est refusé ne reçoit rien ; les impressions d'un groupe se dédoublonnent au sens du site
    for (const k of candidats) {
        if (groupesRefuses.has(k.groupe)) { note(`${k.classe} · refusé : un autre set du même groupe (même carte, tirage, expansion) est refusé`, `${k.x.set} · ${k.x.carteId} « ${k.x.nomEn} »`); continue; }
        const dejaPosees = new Set((aPoser.get(k.x.carteId) || []).filter(i => i.tirage === k.x.tirage && i.expansion === k.x.expansion).map(i => numeroComparable(i.numero)));
        const nouvelles = k.nouvelles.filter(n => !dejaPosees.has(numeroComparable(n.numero)));
        if (nouvelles.length) (aPoser.get(k.x.carteId) || aPoser.set(k.x.carteId, []).get(k.x.carteId)).push(...nouvelles);
        numerosFiche.push(...k.nf);
        corriges.push({ ...k.x, classe: k.classe, nouvelles: nouvelles.map(n => `${n.numero}${n.rarete ? ` (${n.rarete})` : ''}`) });
        note(`${k.classe} · À CORRIGER : chaque produit sur sa fiche`, `${k.x.set} · ${k.x.carteId} « ${k.x.nomEn} » → impressions ${nouvelles.map(n => `${n.numero}${n.rarete ? `/${n.rarete}` : ''}`).join(', ') || '(déjà là)'}`);
    }
    for (const [cause, { n, ex }] of Object.entries(issues).sort((a, b) => a[0].localeCompare(b[0]) || b[1].n - a[1].n)) {
        console.log(`\n${String(n).padStart(5)} · ${cause}`);
        for (const e of ex) console.log(`        ${e}`);
    }
    const nImp = [...aPoser.values()].flat().length;
    const avecRarete = [...aPoser.values()].flat().filter(i => i.rarete).length;
    console.log(`\n   🔑 ${corriges.length} couples corrigés (A ${corriges.filter(x => x.classe === 'A').length}, B ${corriges.filter(x => x.classe === 'B').length}) · ${nImp} impressions à poser sur ${aPoser.size} cartes (${avecRarete} avec la rareté de la Setlist) · ${numerosFiche.length} numeroFiche à poser sur des lignes qui n'en ont pas`);
    const parSet = {}; for (const x of corriges) parSet[x.set] = (parSet[x.set] || 0) + 1;
    console.log(`   par set : ${Object.entries(parSet).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}`);

    // LA RÈGLE DU SITE, REJOUÉE SUR TOUS LES SETS DES CARTES TOUCHÉES (relecture du 2026-10-06 : pas seulement les couples corrigés —
    // une impression posée pour un set s'affiche dans tout set de la carte au même tirage et au même nom d'expansion). Après l'écriture,
    // chaque produit de ces sets trouve EXACTEMENT une fiche par son numeroFiche ; un numeroFiche nul sur un document à plusieurs fiches
    // (le site lirait le slug), une image qui ne retrouve aucune fiche, une impression en double : tout arrête.
    const nfDe = new Map(numerosFiche.map(n => [`${n.carteId}|${n.idProduct}`, n.numeroFiche]));
    const setsTous = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const lignesTouchees = await cx.db.collection('cartes_produits').find({ carteId: { $in: [...aPoser.keys()] } }, { projection: { carteId: 1, idProduct: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
    let vus = 0; const ko = [];
    for (const [id, imps] of aPoser) {
        const c = cartesDoc.get(id);
        const slugs = [...new Set([...(c.sets || []), ...lignesTouchees.filter(l => l.carteId === id).map(l => l.slugSet)])];
        for (const slug of slugs) {
            const s = setsTous.get(slug); if (!s) continue;
            const tirage = s.tirage ?? s.region, exps = [].concat(s.bulba?.expansion ?? null);
            if (!imps.some(i => i.tirage === tirage && exps.includes(i.expansion))) continue;
            vus++;
            const toutes = [...(c.impressions || []), ...imps].filter(i => i.tirage === tirage && exps.includes(i.expansion));
            const comptes = new Map(); for (const i of toutes) comptes.set(numeroComparable(i.numero), (comptes.get(numeroComparable(i.numero)) || 0) + 1);
            for (const [k, n] of comptes) if (n > 1) ko.push(`${slug} ${id} : impression n°${k} ×${n}`);
            for (const p of lignesTouchees.filter(l => l.carteId === id && l.slugSet === slug)) {
                const nf = p.numeroFiche ?? nfDe.get(`${id}|${p.idProduct}`) ?? null;
                if (nf == null || nf === '') { if (comptes.size > 1) ko.push(`${slug} ${id} : produit ${p.idProduct} sans numeroFiche, ${comptes.size} fiches`); }
                else if (!comptes.has(numeroComparable(nf))) ko.push(`${slug} ${id} : produit ${p.idProduct} numeroFiche ${nf} hors des fiches`);
            }
            const fi = new Set(toutes.map(i => normaliserNumero(i.numero)));
            for (const m of (c.images || []).filter(m => m.set === slug && normaliserNumero(m.numero) !== null && !fi.has(normaliserNumero(m.numero)))) ko.push(`${slug} ${id} : image n°${m.numero} orpheline`);
        }
    }
    console.log(`   règle du site rejouée sur ${vus} sets des ${aPoser.size} cartes touchées : ${ko.length ? `🔴 ${ko.length} défaut(s) — ${ko.slice(0, 5).join(' ; ')}` : 'chaque produit a exactement une fiche, aucune image orpheline, aucun doublon'}`);
    if (ko.length) { console.error('🔴 ARRÊT : la règle du site rejouée trouve un défaut.'); await fermer(); process.exit(1); }

    const touchees = [...aPoser.keys()].map(id => cartesDoc.get(id));
    const cmp = comparer(compterEtat({ cartes: touchees }), compterEtat({ cartes: touchees.map(c => ({ ...c, impressions: [...(c.impressions || []), ...aPoser.get(c._id)] })) }));
    console.log(`   garde (simulée) : baisses ${cmp.baisses.length} · hausses ${JSON.stringify(cmp.hausses)}`);
    if (cmp.baisses.length) { console.error('🔴 ARRÊT : un ajout ne doit rien faire baisser.'); await fermer(); process.exit(1); }
    if (JSON_SORTIE()) require('fs').writeFileSync(JSON_SORTIE(), JSON.stringify({ corriges, issues }, null, 1));
    if (!ECRIRE) { console.log('\n   (simulation — --ecrire pose les impressions et les numeroFiche manquants, sous lot-additif.js)'); await fermer(); return; }

    let nc = 0, nl = 0;
    for (const [id, imps] of aPoser) nc += (await cx.db.collection('cartes').updateOne({ _id: id }, { $push: { impressions: { $each: imps } } })).modifiedCount;
    // un numeroFiche ne se pose QUE là où il n'y en a pas : absent OU null (`numeroFiche: null` attrape les deux). 🔴 Le premier lot
    // (2026-10-06, 06:47 UTC) filtrait `$exists: false` : 2 lignes sur 262 — les 260 autres portaient `numeroFiche: null`, écrit par
    // poser-numero-fiche.js. Jamais une valeur remplacée : un numeroFiche non nul ne passe pas le filtre.
    for (const n of numerosFiche) nl += (await cx.db.collection('cartes_produits').updateOne({ carteId: n.carteId, idProduct: n.idProduct, numeroFiche: { $in: [null, ''] } }, { $set: { numeroFiche: n.numeroFiche, numeroFicheSource: 'poser-impressions-par-numero (2026-10-06)' } })).modifiedCount;
    const relues = await cx.db.collection('cartes').aggregate([{ $match: { _id: { $in: [...aPoser.keys()] } } }, { $unwind: '$impressions' }, { $match: { 'impressions.source': 'numero-cardmarket' } }, { $count: 'n' }]).toArray();
    console.log(`\n   ✅ cartes écrites : ${nc}/${aPoser.size} · impressions « numero-cardmarket » relues : ${relues[0]?.n ?? 0} (attendu ≥ ${nImp}) · numeroFiche posés : ${nl}/${numerosFiche.length}`);
    await fermer();
    if (nc !== aPoser.size || (relues[0]?.n ?? 0) < nImp || nl !== numerosFiche.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });

function JSON_SORTIE() { return process.env.RM_JSON_SORTIE || null; }

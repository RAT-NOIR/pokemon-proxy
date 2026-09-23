// ============================================================
// LES TROIS NOMBRES DU CHANTIER — fiches, visuels, écart
// ============================================================
//   node mesure-catalogue.js [--par-set] [--tout]
//
// L'unité de mesure du catalogue d'images : sur les produits Cardmarket, combien ont une FICHE
// (une carte leur est jointe) et combien ont un VISUEL (la carte porte une image DE CE SET).
//
// 🔑 LE DÉNOMINATEUR EST 69 134, PAS 69 598. Cardmarket vend en « singles » des **Online Code Card**
// et **Live Code Card** : un carton qui porte un code pour le jeu en ligne. Ni numéro, ni
// illustration, ni page Bulbapedia — ni fiche ni visuel POSSIBLES. Les compter, c'est inscrire au
// dénominateur un trou qui ne se comblera jamais et faire mentir tous les taux.
// ÉNUMÉRÉ, pas deviné (2026-09-19) : 464 produits, 22 expansions ; et tous les autres libellés
// suspects ont été ouverts un par un — « Capsule Énergie Booster », « Pack d'Eau Fraîches »,
// « Collectionneur de Pokémon », « Némélios (Theme Deck) » sont de VRAIES cartes.
// `--tout` rend la mesure sur les 69 598 bruts, pour comparer avec les rapports d'avant.
//
// ⚠️ La file d'images ÉCRIT pendant la mesure si elle tourne : l'outil le dit lui-même, parce qu'une
// mesure prise sur une base qui bouge est un instantané, pas un dénominateur (CLAUDE.md §25).

require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const estCarteCode = nom => /\b(online|live)\s+code\s+card\b/i.test(String(nom || ''));

(async () => {
    const tout = process.argv.includes('--tout');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });

    const produits = await prod.db.collection('numeros_cartes')
        .find({}, { projection: { idProduct: 1, slugSet: 1, nom: 1, nomFr: 1, nomEn: 1, slug: 1 } }).toArray();
    const libelle = p => p.nom || p.nomFr || p.nomEn || p.slug || '';
    const cartons = produits.filter(p => estCarteCode(libelle(p)));
    const retenus = tout ? produits : produits.filter(p => !estCarteCode(libelle(p)));
    const slugParProduit = new Map(retenus.map(p => [p.idProduct, p.slugSet]));
    const total = slugParProduit.size;

    const liens = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1 } }).toArray();
    const avecImages = await cx.db.collection('cartes').find({ 'images.0': { $exists: true } }, { projection: { images: 1 } }).toArray();
    const setsParCarte = new Map(avecImages.map(c => [c._id, new Set((c.images || []).map(i => i.set))]));
    // 🔴 LE SCAN DU JUMEAU (2026-09-23, DEMANDE-VISUELS-JAPONAIS.md du site). Bulbapedia publie le scan de l'impression
    // JAPONAISE sous le nom de fichier ANGLAIS tant que l'anglais n'a pas été scanné (« PinsirEvolvingSkies1.jpg » =
    // Eevee Heroes). Le wikitext ne le dit pas ; les DIMENSIONS du fichier source, si : 868×1212 et 748×1044 sont les deux
    // formats des scans japonais (ceux d'artofpkm), validés à l'œil par le site (9/9) et ici (4/4, dont 2 que sa liste
    // n'avait pas). Lues dans NOTRE cache `imageinfo` (collecte_images_etat.infosListe) : zéro requête. Un format non
    // regardé n'est pas classé — on préfère rater un japonais que refuser un anglais.
    // ⚠️ Un tel visuel n'est pas celui du tirage du set : il est compté À PART, jamais comme visuel du set.
    const FORMATS_JAPONAIS = new Set(['868×1212', '748×1044']);
    const sets = await cx.db.collection('sets').find({}, { projection: { region: 1 } }).toArray();
    const regionDe = new Map(sets.map(s => [s._id, s.region]));
    const dimsDe = new Map();
    const fichierNu = f => decodeURIComponent(String(f || '').split('/').pop()).replace(/^File:/, '').replace(/_/g, ' ').trim();
    for (const e of await cx.db.collection('collecte_images_etat').find({ _id: /^bulbapedia\//, infosListe: { $exists: true } }, { projection: { infosListe: 1 } }).toArray())
        for (const i of e.infosListe || []) if (i.fichier && i.w) dimsDe.set(fichierNu(i.fichier), `${i.w}×${i.h}`);
    // Un cache ou une table des sets VIDES ne rendraient pas zéro jumeau : ils rendraient « tout est du bon tirage » (§41,
    // le plein fabriqué). Ils lèvent.
    if (!dimsDe.size || !sets.length) throw new Error(`lecture vide : ${dimsDe.size} dimensions en cache, ${sets.length} sets — le tri des visuels du jumeau ne peut pas conclure`);
    const scanDuJumeau = i => /^bulbapedia\//.test(i.cleR2 || '') && regionDe.get(i.set) !== 'jp' && FORMATS_JAPONAIS.has(dimsDe.get(fichierNu(i.urlOriginal)));
    // les sets où la carte a AU MOINS UN visuel du bon tirage
    const setsBonTirage = new Map(avecImages.map(c => [c._id, new Set((c.images || []).filter(i => !scanDuJumeau(i)).map(i => i.set))]));

    const fiches = new Set(), visuels = new Set(), visuelsJumeau = new Set();
    const parSet = new Map();
    const de = s => parSet.get(s) || (parSet.set(s, { produits: 0, fiches: 0, visuels: 0 }), parSet.get(s));
    for (const [, s] of slugParProduit) de(s || '(sans slugSet)').produits++;
    for (const l of liens) {
        if (!slugParProduit.has(l.idProduct)) continue;          // carte-code, ou produit hors catalogue
        const s = slugParProduit.get(l.idProduct) || l.slugSet;
        if (!fiches.has(l.idProduct)) { fiches.add(l.idProduct); de(s || '(sans slugSet)').fiches++; }
        if (visuels.has(l.idProduct)) continue;
        const sets = setsParCarte.get(l.carteId);
        if (!sets || !(sets.has(l.slugSet) || sets.has(s))) continue;
        const bons = setsBonTirage.get(l.carteId);
        if (bons.has(l.slugSet) || bons.has(s)) { visuels.add(l.idProduct); visuelsJumeau.delete(l.idProduct); de(s || '(sans slugSet)').visuels++; }
        else visuelsJumeau.add(l.idProduct);
    }
    const pc = n => `${n} = ${(n / total * 100).toFixed(1)} %`;
    console.log(`\n════ DÉNOMINATEUR : ${total} produits Cardmarket${tout ? ' (BRUT, cartes-code comprises)' : ` (${produits.length} lignes − ${cartons.length} cartes-code)`} ════`);
    console.log(`   FICHES  : ${pc(fiches.size)}`);
    console.log(`   VISUELS : ${pc(visuels.size)}  (du tirage du set)`);
    console.log(`   🔴 + ${visuelsJumeau.size} produits dont le SEUL visuel est le scan japonais du jumeau (Bulbapedia, fichier ${[...FORMATS_JAPONAIS].join(' / ')}) — pas comptés comme visuels · cache imageinfo : ${dimsDe.size} fichiers`);
    console.log(`   ÉCART   : ${total - visuels.size} sans visuel du bon tirage, dont ${fiches.size - visuels.size} qui ont une fiche`);

    const enCours = await cx.db.collection('file_images').countDocuments({ etat: 'en-cours' });
    const attente = await cx.db.collection('file_images').countDocuments({ etat: 'attente' });
    console.log(`   file d'images : ${enCours} en cours · ${attente} en attente — ${enCours ? '🔴 LA FILE ÉCRIT : instantané, pas dénominateur' : 'à l\'arrêt'}`);

    // ════ LE FILET QUI MANQUAIT — un contrôle TRANSVERSAL, après coup ════
    // 🔑 Un produit Cardmarket est UNE carte. Cette propriété est vraie de la BASE ENTIÈRE, jamais
    // d'une exécution : chaque collecte prend son produit de son côté, seule et sans ambiguïté locale,
    // et toutes nos gardes d'unicité sont à l'intérieur d'un appel. Une ambiguïté répartie sur
    // plusieurs exécutions ne se voit pas d'une exécution — il faut donc la chercher APRÈS, sur le
    // tout. 1 993 lignes fausses ont vécu des semaines parce que personne ne posait cette question.
    // Elle est désormais posée à CHAQUE mesure, et elle coûte une agrégation.
    const multi = await cx.db.collection('cartes_produits').aggregate([
        { $group: { _id: '$idProduct', cartes: { $addToSet: '$carteId' } } },
        { $match: { 'cartes.1': { $exists: true } } }, { $count: 'n' }
    ]).toArray();
    const n = multi[0]?.n || 0;
    console.log(`   ⚖️ contrôle transversal : ${n} produit(s) rattaché(s) à PLUSIEURS cartes ${n ? '— 🔴 autant de fiches qui montrent un lien, un illustrateur ou un visuel d\'une autre carte (node detacher-jointures-fausses.js)' : '✅'}`);

    // ⚠️ LES DEUX AUTRES UNICITÉS DU DÉPÔT, contrôlées ICI et plus seulement promises (§32).
    // Chacune a sa garde locale — l'une dans le collecteur d'images, l'autre dans rapatrier-noms-sets.js
    // — et une garde locale ne voit jamais ce qu'une AUTRE exécution a écrit.
    //   · une IMAGE par (carte, set, NUMÉRO) — et le NUMÉRO n'était pas dans la première version de ce
    //     contrôle, qui a crié sur 684 couples parfaitement normaux. Lus un par un : les 684 portent
    //     DEUX NUMÉROS DIFFÉRENTS dans le même set — « Super Rod » Paldea-Evolved n°188 ET n°276,
    //     « Slowbro » Pitch-Black n°030 et n°090. Un set moderne réimprime ses cartes en secrète et en
    //     illustration rare : deux tirages, deux visuels, et c'est le §19 lui-même (« une image
    //     appartient à un TIRAGE ») qu'une clé sans numéro trahissait. ⚠️ Un contrôle qui crie sur un
    //     cas normal est contourné le jour où il a raison (§25) : il fallait corriger la clé, pas la
    //     tolérance.
    //   · un `nomAffichage` DISTINCT par set : deux sets au même nom à l'écran ne se distinguent plus,
    //     et le départage (§26) tourne set par set, donc il ne peut pas voir la collision d'ensemble.
    const imgDoublons = await cx.db.collection('cartes').aggregate([
        { $unwind: '$images' }, { $group: { _id: { c: '$_id', s: '$images.set', n: '$images.numero' }, k: { $sum: 1 } } },
        { $match: { k: { $gt: 1 } } }, { $count: 'n' }
    ]).toArray();
    const ni = imgDoublons[0]?.n || 0;
    const nomsDoublons = await cx.db.collection('sets').aggregate([
        { $match: { nomAffichage: { $nin: [null, ''] } } },
        { $group: { _id: '$nomAffichage', sets: { $addToSet: '$_id' } } },
        { $match: { 'sets.1': { $exists: true } } }
    ]).toArray();
    console.log(`   ⚖️ une image par (carte, set, n°) : ${ni} triplet(s) en double ${ni ? '— 🔴 le visuel affiché dépend de l\'ordre de lecture' : '✅'}`);
    //   · AUCUN FICHIER `artofpkm/` SOUS UN SET NON JAPONAIS (2026-09-23). artofpkm ne sert que le japonais : un tel fichier
    //     sous un set intl, chinois, indonésien ou thaï est le scan d'un autre tirage (§19). Mesuré à 0 ce jour-là — le
    //     contrôle est pour la collecte de demain. Son DÉNOMINATEUR s'imprime : lu sur zéro entrée, il ne prouverait rien.
    const artofpkm = { jp: 0, autre: 0, inconnu: 0 }, exemples = [];
    for (const c of avecImages) for (const i of c.images || []) {
        if (!/^artofpkm\//.test(i.cleR2 || '')) continue;
        const r = regionDe.get(i.set);
        if (r === 'jp') artofpkm.jp++;
        else { artofpkm[r ? 'autre' : 'inconnu']++; if (exemples.length < 3) exemples.push(`${c._id} sous ${i.set}`); }
    }
    const nArt = artofpkm.autre + artofpkm.inconnu;
    console.log(`   ⚖️ artofpkm/ sous un set non jp : ${nArt} sur ${artofpkm.jp + nArt} entrées artofpkm/ lues ${!(artofpkm.jp + nArt) ? '— 🔴 AUCUNE entrée lue : le contrôle ne peut pas conclure' : nArt ? `— 🔴 ${artofpkm.autre} sous un set d'une autre région, ${artofpkm.inconnu} sous un set inconnu (${exemples.join(' · ')})` : '✅'}`);
    console.log(`   ⚖️ un nomAffichage par set     : ${nomsDoublons.length} nom(s) porté(s) par plusieurs sets ${nomsDoublons.length ? `— 🔴 ${nomsDoublons.slice(0, 3).map(x => `« ${x._id} » (${x.sets.join(', ')})`).join(' · ')}` : '✅'}`);

    if (process.argv.includes('--par-set')) {
        console.log(`\n   les 30 sets au plus gros écart (fiche sans visuel) :`);
        for (const [s, c] of [...parSet].sort((a, b) => (b[1].fiches - b[1].visuels) - (a[1].fiches - a[1].visuels)).slice(0, 30))
            console.log(`      ${String(c.fiches - c.visuels).padStart(5)} · ${s.padEnd(40)} ${c.produits} produits · ${c.fiches} fiches · ${c.visuels} visuels`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

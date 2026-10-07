// ============================================================
// LES DONNÉES DES LOGOS COMPOSÉS, POUR LE SITE — le site compose, le serveur fournit (décision du testeur, 2026-10-07)
// ============================================================
//   node exporter-donnees-logos-site.js        → donnees-site/logos-composes-donnees.json (LECTURE SEULE : aucune base écrite)
//
// La demande (testeur) : « pour chaque deck WCD, le fichier du logo officiel de son année (Logo FR\WCD, année lue sur le logo) ; pour les
// logos partagés (Intro Pack, Gift Box, paires SP, demi-decks DPt), le fichier du vrai logo ; pour chaque set de promos, POP et McDonald's,
// la liste des 3 cartes les plus chères selon le guide des prix, parmi celles qui ont un visuel ». Le site lit les fichiers sur ce poste.
// 🔴 LES WCD : ces vingt fichiers sont, octet pour octet, ceux que le testeur a fait retirer le 2026-10-04 comme copies de Pokécardex
// (`LOGOS_COPIES`, collecte-cartes/langue-logo.js). Chaque ligne le porte (`copiePokecardex`) : les employer est une décision du testeur.
// LES VEDETTES : un produit du set (ligne `cartes_produits` de l'expansion du set), dont la carte a un VISUEL dans ce set (entrée
// `cartes.images` du set, au numéro de la fiche, ou le seul visuel de la carte dans le set : `visuelDuProduit`), classé par `trend` du
// dernier guide (guide_prix_meta), sinon `avg` (le champ retenu est écrit) ; un produit sans prix positif n'entre pas. Une carte n'apparaît
// qu'une fois (son produit le plus cher).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { LOGOS_COPIES } = require('./collecte-cartes/langue-logo');
const { cleNumero } = require('./collecte-cartes/jointure');

// l'année LUE sur chaque logo (planche du 2026-10-07) — jamais déduite du numéro du fichier
const WCD = [[2004, 76], [2005, 77], [2006, 78], [2007, 79], [2008, 80], [2009, 81], [2010, 82], [2011, 83], [2012, 84], [2013, 85], [2014, 86], [2015, 87], [2016, 88], [2017, 89], [2018, 90], [2019, 91], [2022, 92], [2023, 93], [2024, 94], [2025, 95]];
// les vrais logos partagés (table des logos apportés, lue à l'œil le 2026-10-07 : collecte-cartes/logos-apport-manuel-lus.json)
const PARTAGES = { 'Dialga-DPt-Half-Deck': 'EPDIA', 'Giratina-DPt-Half-Deck': 'EPGIR', 'Palkia-DPt-Half-Deck': 'EPPAL', 'Chimchar-DPt-Half-Deck': 'GBCHIM', 'Pikachu-DPt-Half-Deck': 'GBPIKA',
    'Piplup-DPt-Half-Deck': 'GBPIPL', 'Turtwig-DPt-Half-Deck': 'GBTURT', 'Gift-Box-Latias-ex': 'GBLAHD', 'Gift-Box-Latios-ex': 'GBLOHD', 'Intro-Pack-Bulbasaur': 'IPB', 'Intro-Pack-Squirtle': 'IPS',
    'Charizard-SP-Half-Deck': 'SPCHA', 'Garchomp-SP-Half-Deck': 'SPGAR', 'Gallade-SP-Half-Deck': 'SPGAL', 'Infernape-SP-Half-Deck': 'SPINF' };
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');

// Le visuel d'un produit dans un set : celui de SON numéro. (Relecture du 2026-10-07 : `ims[0]` donnait, à une carte à plusieurs visuels
// dans le set, le visuel d'un AUTRE numéro — un visuel d'un autre tirage, le mensonge que le chantier interdit.) Un visuel AU numéro de la
// fiche, s'il est seul ; sinon le seul visuel de la carte dans le set, s'il ne porte pas un autre numéro ; sinon aucun.
function visuelDuProduit(images, set, numeroFiche) {
    const duSet = (images || []).filter(i => i?.set === set && i.cleR2);
    if (numeroFiche != null) {
        const au = duSet.filter(i => i.numero != null && cleNumero(i.numero) === cleNumero(numeroFiche));
        if (au.length) return au.length === 1 ? au[0] : null;
    }
    return duSet.length === 1 && (numeroFiche == null || duSet[0].numero == null) ? duSet[0] : null;
}
// le prix d'un produit : `trend`, sinon `avg` — un prix nul ou négatif n'est pas un prix ; le champ retenu est dit
function prixDe(p) {
    for (const champ of ['trend', 'avg']) if (typeof p?.[champ] === 'number' && p[champ] > 0) return { valeur: p[champ], champ };
    return null;
}
// (décision de l'éditeur, 2026-10-07, soir) aucune illustration qui porte un texte ou un tampon (Worlds, avant-première, Pokémon Center…) :
// le site regarde chaque illustration ; ici, un produit dont le NOM ou le slug Cardmarket nomme un tampon est écarté d'avance — écarter à
// tort ne coûte qu'un rang (la suivante prend la place), garder à tort coûte une bande refusée. « City » seul n'en est pas un (Lumiose City).
const TAMPON = /\b(pre-?release|staff|worlds?|world championships?|championships?|pok[eé]mon center|league|stamp(ed)?|winners?|finalist|top ?\d+|regionals?|nationals?|city championships?|battle road|e-league|premier challenge|tournament)\b/i;
const tamponProbable = (nomProduit, slug) => TAMPON.test(`${nomProduit ?? ''} ${String(slug ?? '').replace(/-/g, ' ')}`);
// Le visuel de la MÊME carte dans un AUTRE tirage, pour un set sans visuel du sien (testeur, 2026-10-07 : « propose la même carte dans un
// autre tirage, en le disant ») : jamais le set lui-même, jamais un scan japonais pour un set qui ne l'est pas (la garde du site) ; le même
// tirage d'abord, puis la même région, puis la source (TCGdex, artofpkm, Bulbapedia), puis le set par ordre alphabétique — une règle, jamais l'œil.
const RANG_SOURCE = { tcgdex: 0, artofpkm: 1, bulbapedia: 2 };
function visuelAutreTirage(images, set, setsBase) {
    const tir = set.tirage ?? set.region;
    const c = (images || []).filter(m => m && m.cleR2 && m.set !== set._id && !(tir !== 'jp' && m.langue === 'ja'));
    const rang = m => { const s = setsBase.get(m.set); const t = s ? (s.tirage ?? s.region) : null; return [t === tir ? 0 : 1, s && s.region === set.region ? 0 : 1, RANG_SOURCE[m.source] ?? 3, m.set]; };
    // (relecture) départage STABLE jusqu'au bout : le set, puis le numéro (le plus bas : l'impression de base avant une secrète), puis la clé
    const nNum = m => Number((/(\d+)/.exec(String(m.numero ?? '')) || [])[1] ?? 1e9);
    c.sort((a, b) => { const x = rang(a), y = rang(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return String(x[3]).localeCompare(String(y[3])) || nNum(a) - nNum(b) || String(a.cleR2).localeCompare(String(b.cleR2)); });
    return c[0] ?? null;
}
module.exports = { visuelDuProduit, prixDe, tamponProbable, visuelAutreTirage };
if (require.main === module) (async () => {
    const sharp = require('sharp');
    const fichier = async rel => { const b = fs.readFileSync(path.join(__dirname, rel)); const m = await sharp(b).metadata(); return { fichier: rel.replace(/\\/g, '/'), cheminAbsolu: path.join(__dirname, rel), sha1: sha1(b), w: m.width, h: m.height }; };
    const copies = new Map([...LOGOS_COPIES]);
    const wcd = [];
    for (const [annee, n] of WCD) {
        const f = await fichier(`Logo FR/WCD/jap_0${n}.png`);
        wcd.push({ set: `WCD-${annee}`, annee, anneeLueSurLeLogo: true, ...f, copiePokecardex: copies.has(f.sha1), refus: copies.has(f.sha1) ? 'logo COPIÉ de Pokécardex, retiré (décision du testeur, 2026-10-04) — son emploi est une décision du testeur' : null });
    }
    // (2026-10-07, soir) le DECK CHAMPION de l'année et sa vedette (wcd-decks-champions.js, pages de decks en copie Wayback) — le portrait
    // du site, en attendant un logo officiel des Mondiaux de source légale. Les fichiers Pokécardex ci-dessus ne s'emploient pas (éditeur).
    const CH = path.join(__dirname, 'collecte-cartes', 'wcd-decks-champions.json');
    const champions = fs.existsSync(CH) ? new Map(JSON.parse(fs.readFileSync(CH, 'utf8')).annees.map(a => [a.annee, a])) : new Map();
    for (const w of wcd) { const c = champions.get(w.annee); w.deckChampion = c?.deckChampion ?? null; if (!w.deckChampion) w.deckChampionRaison = c?.raison ?? 'année non lue'; }
    const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes/logos-apport-manuel-lus.json'), 'utf8'));
    const lus = new Map((Array.isArray(T) ? T : T.lignes).filter(l => l.dossier === 'Deck JP').map(l => [l.fichier.replace(/\.png$/i, ''), l]));
    const partages = [];
    for (const [set, code] of Object.entries(PARTAGES)) {
        const l = lus.get(code); if (!l) throw new Error(`${code} absent de la table des logos lus`);
        const f = await fichier(`apport-manuel/Deck JP/${code}.png`);
        if (f.sha1 !== l.sha1) throw new Error(`${code} : sha1 ${f.sha1} ≠ table ${l.sha1}`);
        partages.push({ set, ...f, lu: l.lu, partageAvec: Object.entries(PARTAGES).filter(([s, c]) => s !== set && lus.get(c)?.sha1 === l.sha1).map(([s]) => s) });
    }
    // les vedettes — v2 (décisions de l'éditeur, 2026-10-07, soir : le CLASSEMENT LONG, des cartes POKÉMON seulement, aucun tampon)
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const meta = await prod.db.collection('guide_prix_meta').findOne({ _id: 'dernier' });
    const setsBase = new Map((await cx.db.collection('sets').find({}, { projection: { idExpansion: 1, nomAffichage: 1, 'logoCompose.famille': 1, tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s]));
    const familles = [...setsBase.values()].filter(s => typeof s.nomAffichage === 'string' && (['promos', 'pop', 'mcdonalds'].includes(s.logoCompose?.famille) || /(-Promos$|^POP-Series-|McDonald)/.test(s._id)));
    if (!familles.length) throw new Error('aucun set promos/POP/McDonald\'s : base fausse');
    // les 41 « autres » : ceux que le site attend (lib/logos-composes.json, `enAttente`, raison « liste des cartes phares du serveur absente »)
    const SITE = path.join(__dirname, '..', 'rat-market-site', 'lib', 'logos-composes.json');
    // (2026-10-07, soir) le site RÉGÉNÈRE ce fichier en lisant notre classement : ses raisons changent (« aucune carte montrable dans les N
    // du serveur… »). La liste des « autres » se garde donc d'un export à l'autre : ceux de l'export précédent, plus tout set en attente dont
    // la raison cite le serveur.
    const SORTIE_PREC = path.join(__dirname, 'donnees-site', 'logos-composes-donnees.json');
    const precedents = fs.existsSync(SORTIE_PREC) ? Object.entries(JSON.parse(fs.readFileSync(SORTIE_PREC, 'utf8')).vedettes || {}).filter(([, v]) => v.autres === true || v.famille === 'autres').map(([k]) => k) : [];
    const enAttente = [...new Set([...precedents, ...Object.entries(JSON.parse(fs.readFileSync(SITE, 'utf8')).enAttente || {}).filter(([, v]) => /serveur/.test(v.raison || '')).map(([k]) => k)])];
    if (!enAttente.length) throw new Error(`${SITE} et ${SORTIE_PREC} : aucun set « autres » — clé fausse ?`);
    const autres = enAttente.filter(id => setsBase.has(id) && !familles.some(s => s._id === id)).map(id => setsBase.get(id));
    const absents = enAttente.filter(id => !setsBase.has(id));
    const N_CLASSEMENT = 15;
    const vedettes = {}, exclusTotal = { 'dresseur ou énergie': 0, 'catégorie inconnue (fiche simple)': 0, 'tampon dans le nom': 0, 'sans prix': 0, 'aucun visuel': 0 };
    for (const s of [...familles, ...autres].sort((a, b) => a._id.localeCompare(b._id))) {
        const exps = [].concat(s.idExpansion ?? []);
        const lignes = await cx.db.collection('cartes_produits').find({ $or: [{ slugSet: s._id }, { idExpansion: { $in: exps } }] }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slug: 1, visuelSubstitut: 1 } }).toArray();
        const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1, categorie: 1 } }).toArray()).map(c => [c._id, c]));
        const prix = new Map((await prod.db.collection('guide_prix').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, trend: 1, avg: 1, guideDu: 1 } }).toArray()).map(p => [p.idProduct, p]));
        const noms = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
        const cands = [], exclus = Object.fromEntries(Object.keys(exclusTotal).map(k => [k, 0]));
        let sansVisuelSur = 0;
        for (const l of lignes) {
            const c = cartes.get(l.carteId); if (!c) continue;
            // une garde s'écrit par ce qu'elle autorise : la catégorie « pokemon » lue sur la page de la carte, rien d'autre
            if (c.categorie !== 'pokemon') { exclus[c.categorie ? 'dresseur ou énergie' : 'catégorie inconnue (fiche simple)']++; continue; }
            if (tamponProbable(noms.get(l.idProduct), l.slug)) { exclus['tampon dans le nom']++; continue; }
            const p = prix.get(l.idProduct), v = prixDe(p);
            if (!v) { exclus['sans prix']++; continue; }
            let im = visuelDuProduit(c.images, s._id, l.numeroFiche), visuel = 'du-set', mention = null;
            if (!im && (c.images || []).some(i => i?.set === s._id && i.cleR2)) sansVisuelSur++;
            // (relecture) un visuel qui n'est pas celui du set porte TOUJOURS sa mention
            if (!im && l.visuelSubstitut?.cleR2) { im = l.visuelSubstitut; visuel = 'substitut'; mention = l.visuelSubstitut.mention ?? `Visuel de la carte d'origine (${setsBase.get(l.visuelSubstitut.set)?.nomAffichage ?? l.visuelSubstitut.set ?? '?'}) — pas celui de ce produit`; }
            if (!im && !(c.images || []).some(i => i?.set === s._id && i.cleR2)) {
                const a = visuelAutreTirage(c.images, s, setsBase);
                if (a) { im = a; visuel = 'autre-tirage'; mention = `Visuel de la même carte dans un autre tirage (${setsBase.get(a.set)?.nomAffichage ?? a.set}${a.numero ? ` n°${a.numero}` : ''}) — pas celui de ce set`; }
            }
            if (!im) { exclus['aucun visuel']++; continue; }
            cands.push({ idProduct: l.idProduct, produit: noms.get(l.idProduct) ?? null, carteId: l.carteId, carte: c.nomEn, numero: l.numeroFiche ?? (visuel === 'du-set' ? im.numero : null) ?? null,
                prix: { valeur: v.valeur, champ: v.champ, trend: p.trend ?? null, avg: p.avg ?? null, guideDu: p.guideDu ?? meta?.guideDu ?? null },
                visuel, mention, image: { cleR2: im.cleR2, vignette: im.vignette?.cleR2 ?? null, langue: im.langue ?? null, set: im.set ?? s._id, numero: im.numero ?? null, source: im.source ?? null } });
        }
        cands.sort((a, b) => b.prix.valeur - a.prix.valeur || a.idProduct - b.idProduct);
        const vus = new Set(), classement = [];
        for (const c of cands) { if (vus.has(c.carteId)) continue; vus.add(c.carteId); classement.push({ rang: classement.length + 1, ...c }); if (classement.length === N_CLASSEMENT) break; }
        for (const [k, n] of Object.entries(exclus)) exclusTotal[k] += n;
        vedettes[s._id] = { famille: s.logoCompose?.famille ?? (autres.includes(s) ? 'autres' : null), autres: autres.includes(s), nom: s.nomAffichage, tirage: s.tirage ?? s.region, produitsLus: lignes.length, pokemonClasses: cands.length,
            visuelNonDesigne: sansVisuelSur, exclus, classement,
            // top3 (compatibilité) : les 3 premières du classement dont le visuel est CELUI DE CE SET
            top3: classement.filter(c => c.visuel === 'du-set').slice(0, 3) };
    }
    console.log(`AUTRES (site) : ${enAttente.length} attendus (${precedents.length} de l'export précédent) · ${autres.length} classés · ${absents.length} absents de la base${absents.length ? ` (${absents.join(', ')})` : ''} · exclus en tout ${JSON.stringify(exclusTotal)}`);
    await fermer();
    const sortie = { genere: new Date().toISOString(), par: 'exporter-donnees-logos-site.js', guideDesPrix: meta ? { fichier: meta.fichier, guideDu: meta.guideDu } : null, wcd, logosPartages: partages, vedettes };
    fs.mkdirSync(path.join(__dirname, 'donnees-site'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'donnees-site', 'logos-composes-donnees.json'), JSON.stringify(sortie, null, 1));
    const v = Object.entries(vedettes);
    const parVisuel = c => c.reduce((o, x) => (o[x.visuel] = (o[x.visuel] || 0) + 1, o), {});
    console.log(`WCD ${wcd.length} (copies Pokécardex ${wcd.filter(x => x.copiePokecardex).length}) · logos partagés ${partages.length} · sets classés ${v.length} : ≥ 10 Pokémon ${v.filter(([, x]) => x.classement.length >= 10).length}, ≥ 3 ${v.filter(([, x]) => x.classement.length >= 3).length}, aucun ${v.filter(([, x]) => !x.classement.length).map(([k]) => k).join(', ') || '—'}`);
    console.log(`   visuels du classement : ${JSON.stringify(parVisuel(v.flatMap(([, x]) => x.classement)))} · top3 du set complets ${v.filter(([, x]) => x.top3.length === 3).length}`);
    for (const [k, x] of v.slice(0, 6)) console.log(`   ${k} : ${x.classement.slice(0, 5).map(t => `${t.carte} n°${t.numero ?? '—'} ${t.prix.valeur} € (${t.visuel})`).join(' · ')}`);
    console.log('→ donnees-site/logos-composes-donnees.json');
})().catch(e => { console.error(e); process.exit(1); });

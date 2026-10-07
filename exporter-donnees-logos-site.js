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
module.exports = { visuelDuProduit, prixDe };
if (require.main === module) (async () => {
    const sharp = require('sharp');
    const fichier = async rel => { const b = fs.readFileSync(path.join(__dirname, rel)); const m = await sharp(b).metadata(); return { fichier: rel.replace(/\\/g, '/'), cheminAbsolu: path.join(__dirname, rel), sha1: sha1(b), w: m.width, h: m.height }; };
    const copies = new Map([...LOGOS_COPIES]);
    const wcd = [];
    for (const [annee, n] of WCD) {
        const f = await fichier(`Logo FR/WCD/jap_0${n}.png`);
        wcd.push({ set: `WCD-${annee}`, annee, anneeLueSurLeLogo: true, ...f, copiePokecardex: copies.has(f.sha1), refus: copies.has(f.sha1) ? 'logo COPIÉ de Pokécardex, retiré (décision du testeur, 2026-10-04) — son emploi est une décision du testeur' : null });
    }
    const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes/logos-apport-manuel-lus.json'), 'utf8'));
    const lus = new Map((Array.isArray(T) ? T : T.lignes).filter(l => l.dossier === 'Deck JP').map(l => [l.fichier.replace(/\.png$/i, ''), l]));
    const partages = [];
    for (const [set, code] of Object.entries(PARTAGES)) {
        const l = lus.get(code); if (!l) throw new Error(`${code} absent de la table des logos lus`);
        const f = await fichier(`apport-manuel/Deck JP/${code}.png`);
        if (f.sha1 !== l.sha1) throw new Error(`${code} : sha1 ${f.sha1} ≠ table ${l.sha1}`);
        partages.push({ set, ...f, lu: l.lu, partageAvec: Object.entries(PARTAGES).filter(([s, c]) => s !== set && lus.get(c)?.sha1 === l.sha1).map(([s]) => s) });
    }
    // les vedettes
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const meta = await prod.db.collection('guide_prix_meta').findOne({ _id: 'dernier' });
    const sets = await cx.db.collection('sets').find({ $or: [{ 'logoCompose.famille': { $in: ['promos', 'pop', 'mcdonalds'] } }, { _id: /(-Promos$|^POP-Series-|McDonald)/ }], nomAffichage: { $type: 'string' } }, { projection: { idExpansion: 1, nomAffichage: 1, 'logoCompose.famille': 1, tirage: 1, region: 1 } }).toArray();
    if (!sets.length) throw new Error('aucun set promos/POP/McDonald\'s : base fausse');
    const vedettes = {};
    for (const s of sets.sort((a, b) => a._id.localeCompare(b._id))) {
        const exps = [].concat(s.idExpansion ?? []);
        const lignes = await cx.db.collection('cartes_produits').find({ $or: [{ slugSet: s._id }, { idExpansion: { $in: exps } }] }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1, slug: 1 } }).toArray();
        const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
        const prix = new Map((await prod.db.collection('guide_prix').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, trend: 1, avg: 1, guideDu: 1 } }).toArray()).map(p => [p.idProduct, p]));
        const noms = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
        const cands = []; let sansVisuelSur = 0;
        for (const l of lignes) {
            const c = cartes.get(l.carteId); if (!c) continue;
            const im = visuelDuProduit(c.images, s._id, l.numeroFiche), p = prix.get(l.idProduct), v = prixDe(p);
            if (!im && (c.images || []).some(i => i?.set === s._id && i.cleR2)) sansVisuelSur++;
            if (!im || !v) continue;
            cands.push({ idProduct: l.idProduct, produit: noms.get(l.idProduct) ?? null, carteId: l.carteId, carte: c.nomEn, numero: l.numeroFiche ?? im.numero ?? null, prix: { valeur: v.valeur, champ: v.champ, trend: p.trend ?? null, avg: p.avg ?? null, guideDu: p.guideDu ?? meta?.guideDu ?? null }, image: { cleR2: im.cleR2, vignette: im.vignette?.cleR2 ?? null, langue: im.langue ?? null } });
        }
        cands.sort((a, b) => b.prix.valeur - a.prix.valeur);
        const vus = new Set(), top = [];
        for (const c of cands) { if (vus.has(c.carteId)) continue; vus.add(c.carteId); top.push(c); if (top.length === 3) break; }
        vedettes[s._id] = { famille: s.logoCompose?.famille ?? null, nom: s.nomAffichage, tirage: s.tirage ?? s.region, produitsLus: lignes.length, avecVisuelEtPrix: cands.length, visuelNonDesigne: sansVisuelSur, top3: top };
    }
    await fermer();
    const sortie = { genere: new Date().toISOString(), par: 'exporter-donnees-logos-site.js', guideDesPrix: meta ? { fichier: meta.fichier, guideDu: meta.guideDu } : null, wcd, logosPartages: partages, vedettes };
    fs.mkdirSync(path.join(__dirname, 'donnees-site'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'donnees-site', 'logos-composes-donnees.json'), JSON.stringify(sortie, null, 1));
    const v = Object.entries(vedettes);
    console.log(`WCD ${wcd.length} (copies Pokécardex ${wcd.filter(x => x.copiePokecardex).length}) · logos partagés ${partages.length} · sets à vedettes ${v.length} : 3 vedettes ${v.filter(([, x]) => x.top3.length === 3).length}, moins de 3 ${v.filter(([, x]) => x.top3.length < 3).map(([k, x]) => `${k} (${x.top3.length})`).join(', ') || 'aucun'}`);
    for (const [k, x] of v.slice(0, 6)) console.log(`   ${k} : ${x.top3.map(t => `${t.carte} n°${t.numero ?? '—'} ${t.prix.valeur} € (${t.prix.champ})`).join(' · ')}`);
    console.log('→ donnees-site/logos-composes-donnees.json');
})().catch(e => { console.error(e); process.exit(1); });

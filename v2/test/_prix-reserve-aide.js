'use strict';
// Aide des bancs PRO-PRIX-RESERVE (pas un banc : le préfixe _ l'écarte). Partagée par test-offre-prix-reserve-pro.js, test-offre-prix-reserve-pro-mesures.js et le cas du scanner.
// 🔑 D'OÙ VIENT CHAQUE VALEUR. EXACT : aucun PRIX et aucun identifiant de produit ne sont saisis ici ; ce qui n'est pas réel est listé en dernier, avec sa nature (structurel, non-prix) :
//   · les GUIDES de Tauros et d'Arcanin (trend, low, avg7, avg30, guideDu), le prix lu 7,67 d'Arcanin (origine « tendance »), les noms, numéros et sets :
//     `v2/test/fixtures/prix-repli-reels.json` (« rm_essai, lecture seule, extrait le 2026-10-24 ») ;
//   · les idProduct 273844 (Tauros-JU47, idExpansion 1525) et 371545 (Arcanine-G-Lv60-V2-SV15, idExpansion 1564) : `cartes.cartes_produits` de la grappe `cartes`, lus avec l'outil MCP mongodb-lecture le 2026-11-09 ;
//   · les six produits SANS guide (273830 Butterfree-JU33, 273854 Nidoran-F-JU57, 273837 Nidorina-JU40, 273804 Nidoqueen-V1-JU7, 273855 Oddish-JU58, 273856 Paras-JU59, idExpansion 1525, numeroFiche = leur numéro) :
//     `cartes.cartes_produits`, même lecture. Leur nom est celui de leur slug ; aucune ligne `guide_prix` n'est semée pour eux (c'est ce qui fait « sans guide ») ;
//   · le prix lu en direct dans un état pire (`prixLive` de l'etat-proche) et la grille lue : DÉRIVÉS du guide réel de Tauros (low et trend), jamais saisis ;
//   · `idMetacard` : la table `catalogue_produits` n'est pas lisible par la lecture MCP (grappe `cartes` seule) : clé STRUCTURELLE = l'idProduct lui-même (unique, sans autre sens) ;
//   · NON RÉELS, ni prix ni identifiant de produit : le total imprimé est écrit sur 3 chiffres (064 : la forme du visuel d'archive) ; `rarete` « Common » et `variante` « normale » : les défauts du harnais existant `_visuels-banc.js` ;
//     `quotaMensuel` et `restant` de l'abonnement (100) : champs de structure que la décision n'utilise pas ; `restant: 5` de l'offre inconnue : champ de structure ; le nom des produits sans guide vient de leur slug.
const path = require('path'), fs = require('fs');
const M = require('../modeles'); const J = require('../comptes/jetons');
const REEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prix-repli-reels.json'), 'utf8')).cas;
const guideDe = nom => ({ ...REEL[nom].guide, guideDu: new Date(REEL[nom].guide.guideDu) });
const sansGuide = (id, exp, code, numero, slug, nom) => ({ id, exp, code, numero, total: REEL.tauros.produit.total, slug, slugSet: REEL.tauros.produit.set.slug, setNom: REEL.tauros.produit.set.nom, name: nom, nom, nomFr: nom, guide: null });
const META = {
    tauros: { id: 273844, exp: 1525, code: REEL.tauros.produit.set.code, numero: REEL.tauros.produit.numero, total: REEL.tauros.produit.total, slug: 'Tauros-JU47', slugSet: REEL.tauros.produit.set.slug, setNom: REEL.tauros.produit.set.nom, name: REEL.tauros.produit.nomCardmarket, nom: REEL.tauros.produit.nom, nomFr: REEL.tauros.produit.nom, guide: 'tauros' },
    arcanin: { id: 371545, exp: 1564, code: REEL.arcanin.produit.set.code, numero: REEL.arcanin.produit.numero, total: REEL.arcanin.produit.total, slug: 'Arcanine-G-Lv60-V2-SV15', slugSet: REEL.arcanin.produit.set.slug, setNom: REEL.arcanin.produit.set.nom, name: REEL.arcanin.produit.nomCardmarket, nom: REEL.arcanin.produit.nom, nomFr: REEL.arcanin.produit.nom, guide: 'arcanin' }
};
const SANS = [sansGuide(273830, 1525, 'JU', '33', 'Butterfree-JU33', 'Butterfree'), sansGuide(273854, 1525, 'JU', '57', 'Nidoran-F-JU57', 'Nidoran F'), sansGuide(273837, 1525, 'JU', '40', 'Nidorina-JU40', 'Nidorina'),
    sansGuide(273804, 1525, 'JU', '7', 'Nidoqueen-V1-JU7', 'Nidoqueen'), sansGuide(273855, 1525, 'JU', '58', 'Oddish-JU58', 'Oddish'), sansGuide(273856, 1525, 'JU', '59', 'Paras-JU59', 'Paras')];
const TOUS = [META.tauros, META.arcanin, ...SANS];
const parId = Object.fromEntries(TOUS.map(m => [m.id, m]));
// les valeurs DÉRIVÉES du guide réel de Tauros
const LU = { pire: REEL.tauros.guide.low, grille: { NM: REEL.tauros.guide.trend, GD: REEL.tauros.guide.low }, tendanceArcanin: REEL.arcanin.journal.prixLive };

/** Sème catalogue, numéros, codes de set et guides (réels) ; pousse les visuels dans `VIS`. `raw` : (nom) => collection brute. */
async function semer(raw, VB, VIS, metas = TOUS) {
    for (const m of metas) {
        await raw('codes_set').updateOne({ idExpansion: m.exp }, { $set: { idExpansion: m.exp, codeSet: m.code, apprisLe: new Date() } }, { upsert: true });
        await raw('catalogue_produits').insertOne({ idProduct: m.id, name: m.name, idExpansion: m.exp, idMetacard: m.id });
        await raw('numeros_cartes').insertOne({ idProduct: m.id, idExpansion: m.exp, numero: m.numero, numeroUrl: m.code + m.numero, codeSet: m.code, nomFr: m.nomFr, slug: m.slug, slugSet: m.slugSet, source: 'cardmarket', certitude: 'exacte' });
        if (m.guide) await raw('guide_prix').insertOne({ idProduct: m.id, ...guideDe(m.guide) });
        VIS.push(VB.doc(m.id, { idMetacard: m.id, numero: m.numero, total: m.total.padStart(3, '0'), setNom: m.setNom }));      // le total imprimé est écrit sur 3 chiffres, comme le visuel d'archive et la lecture de la chaîne (64 -> 064)
    }
}
// ce que la chaîne héritée fabriquée rend pour un produit
const carteCorps = (m, ambigu) => ({ idProduct: m.id, nomProduit: m.nom, nom: m.nom, numero: m.numero, total: m.total.padStart(3, '0'), setCode: m.code, rarete: null, langue: 'FR', ambigu });
const etatDe = e => ({ estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: e.retenu });
const cand = m => ({ idProduct: m.id, nom: m.nom, numero: m.numero, set: m.setNom, prix: null, photoUrl: null });      // prix et photo : STRUCTURELLEMENT nuls (aucun prix saisi ; la chaîne fabriquée n'en donne pas)
const reverse = { attendue: false, motif: null, etat: 'aucun-motif', strategie: null };
const aff = (m, e) => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(m, false), etat: etatDe(e), candidats: [cand(m)], classement: [], guidePrix: {}, reverse, codeLangue: e.codeLangue } });
const qst = (ms, e) => ({ statutHttp: 200, corps: { success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ms[0], true), etat: etatDe(e), candidats: ms.map(cand), classement: [], guidePrix: {}, reverse, codeLangue: e.codeLangue } });

// ── L'ORACLE du gratuit, écrit ICI (jamais la fonction de la production) : le prix par état et par langue part ; le repli `tendance` à fourchette est DÉGRADÉ en repli général (F1) ; le repli général reste.
const general = r => Boolean(r) && r.repli === 'tendance' && r.offre === null && !('fourchette' in r);
const gratuitRepli = r => {
    if (general(r)) return r;
    if (r && r.repli === 'tendance' && r.offre === null && 'fourchette' in r && r.guide) { const o = { ...r }; delete o.fourchette; return o; }
    return null;
};
const gratuitDe = c => { const o = { ...c }; if ('prixRepli' in o) { const r = gratuitRepli(o.prixRepli); if (r) o.prixRepli = r; else delete o.prixRepli; } if (o.prixLive) o.prixLive = null; return o; };
const aDuPrixParEtat = c => Boolean(c.prixLive) || Boolean(c.prixRepli && !general(c.prixRepli));

// ── les porteurs : sans compte, gratuit, expiré, offre illisible, offre inconnue, Pro (un compte vérifié et son installation liée)
const futur = new Date(Date.now() + 40 * 86400e3), passe = new Date(Date.now() - 3600e3);
const abo = jusquAu => ({ actif: true, quotaMensuel: 100, moisCle: '2026-11', restant: 100, jusquAu });
const enPanne = new Set(), offreInconnue = new Set();
let nMail = 0;
async function porteurDe(raw, genre) {
    const jeton = J.genererJeton(); let compte = null;
    if (genre !== 'sans') {
        const a = `prp${++nMail}.${Date.now().toString(36)}@exemple.fr`;
        compte = Object.assign(M.nouveauCompte({ email: a, emailCle: a, motDePasse: {} }), { verifie: true }, genre === 'pro' ? { abonnement: abo(futur) } : genre === 'expire' ? { abonnement: abo(passe) } : {});
        await raw('comptes').insertOne(compte);
    }
    const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compte ? { compteId: compte._id, lieeLe: new Date() } : {});
    await raw('installations').insertOne(i);
    if (genre === 'panne') enPanne.add(String(compte._id));
    if (genre === 'inconnue') offreInconnue.add(String(compte._id));
    return { genre, jeton, compte, i, userId: compte ? `v2:compte:${compte._id}` : `v2:installation:${i._id}`, cleQuota: compte ? `compte:${compte._id}` : `installation:${i._id}` };
}
/** Arme l'offre en panne (genre `panne`) et l'offre inconnue (genre `inconnue`) sur le registre « argent » que les routes lisent. */
function armerOffres(argent) {
    const orig = argent.offre.bind(argent);
    argent.offre = async p => {
        if (p && enPanne.has(String(p.id))) throw Object.assign(new Error('lecture de l\'offre en panne (banc)'), { code: 'PANNE_BANC' });
        if (p && offreInconnue.has(String(p.id))) return { nom: 'inconnue', restant: 5, remiseAZero: null };
        return orig(p);
    };
}
const GENRES = ['sans', 'gratuit', 'expire', 'panne', 'inconnue', 'pro'];
const LIBRES = GENRES.filter(g => g !== 'pro');
module.exports = { REEL, META, SANS, TOUS, parId, LU, semer, carteCorps, etatDe, cand, aff, qst, general, gratuitRepli, gratuitDe, aDuPrixParEtat, futur, passe, abo, porteurDe, armerOffres, enPanne, offreInconnue, GENRES, LIBRES };

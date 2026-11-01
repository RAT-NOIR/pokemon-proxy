'use strict';
// ============================================================
// PLANIFIER LES NOMS FRANÇAIS DES FICHES — fonctions PURES (aucune base, aucun réseau) ; l'outil poser-noms-fr-fiches.js les alimente.
// ============================================================
// (A) AJOUT : cartes à _id NÉGATIF (fiches simples) SANS champ `nomFr`. Règle de rapatrier-noms-fr.js (module nom-fr-cardmarket.js, une seule
//     copie) appliquée à elles SEULES. Une carte qui a un champ nomFr (chaîne OU null) n'est jamais dans le plan.
// (B) cartes à `nomFr: null` ET `nomFrSource: 'cardmarket'` (leurs produits donnaient des noms différents). Remplie seulement si le clone LOCAL de
//     TCGdex (`fr`) concorde avec l'UN des noms Cardmarket en conflit, et que le lien carte <-> carte TCGdex est PROUVÉ par un témoin qui n'est PAS
//     la clé (l'identifiant Cardmarket du produit, que le clone attache parfois à plusieurs cartes : coffrets tk-*).
//
// Le témoin d'un lien (par ligne carte-produit) :
//   · le clone désigne UNE SEULE carte pour cet identifiant (deux cartes TCGdex pour un même lien ne valent rien : 'lien-multiple') ;
//   · le n° de Pokédex ne contredit pas ('dex-contredit') ;
//   · et soit le nom ANGLAIS du clone égale notre nomEn (clés `cle`), soit le set Cardmarket (idExpansion de la ligne) ET le numéro de fiche
//     égalent ceux du clone. Sinon 'non-prouve'.
// Tout ce qui ne conclut pas BLOQUE (reste null) et dit pourquoi : on énumère ce qui autorise, jamais ce qui refuse.
const { cle, accents, decider, grouperParCarte } = require('./nom-fr-cardmarket');

const nonVide = x => x !== null && x !== undefined && String(x).trim() !== '';
const sansZeros = s => String(s ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

/** (A) */
function planifierA({ cartes, liens, frDuProduit }) {
    const parCarte = grouperParCarte(liens, frDuProduit);
    const ecrire = [];
    let horsLotPositives = 0, dejaNommeesOuNulles = 0, sansProduitFr = 0;
    for (const c of cartes) {
        if (c.nomFr !== undefined) { if (c._id < 0) dejaNommeesOuNulles++; continue; }   // un champ présent (chaîne ou null) : jamais touché
        if (!(c._id < 0)) { horsLotPositives++; continue; }                               // les cartes positives sont hors de ce lot
        const groupes = parCarte.get(c._id);
        if (!groupes) { sansProduitFr++; continue; }                                      // rien à écrire : `null` garde son sens de « produits contradictoires »
        const d = decider(groupes);
        ecrire.push({ carteId: c._id, nomFr: d.nomFr, conflit: d.conflit, accentue: d.accentue, source: 'cardmarket', formes: d.groupes.map(g => g.forme) });
    }
    return { ecrire, horsLotPositives, dejaNommeesOuNulles, sansProduitFr };
}

/** index du clone : identifiant Cardmarket -> cartes TCGdex ; (famille|set) -> identifiant d'expansion Cardmarket. */
function indexClone(clone) {
    const parCm = new Map(), setCm = new Map();
    for (const c of clone.cartes) for (const id of c.cardmarket) (parCm.get(id) || parCm.set(id, []).get(id)).push(c);
    for (const s of clone.sets) if (s.cardmarket) setCm.set(`${s.famille}|${s.id}`, s.cardmarket);
    return { parCm, setCm };
}

/** Le lien d'UNE ligne (carte, produit) avec le clone. -> { ok, raison, temoin, carteTcgdex } */
function prouverLien(carte, ligne, ix) {
    const cs = ix.parCm.get(ligne.idProduct);
    if (!cs || !cs.length) return { ok: false, raison: 'id-absent-du-clone' };
    if (cs.length > 1) return { ok: false, raison: 'lien-multiple' };
    const t = cs[0];
    const ref = `${t.famille}|${t.setId}|${t.localId}`;
    const dx = [].concat(carte.ndex ?? []).map(Number).filter(Boolean);
    if (dx.length && t.dex && t.dex.length && !dx.some(x => t.dex.includes(x))) return { ok: false, raison: 'dex-contredit', carteTcgdex: ref };
    if (nonVide(t.noms.en) && nonVide(carte.nomEn) && cle(t.noms.en) === cle(carte.nomEn)) return { ok: true, temoin: 'nom-en', carteTcgdex: ref, tcgdex: t };
    const exp = ix.setCm.get(`${t.famille}|${t.setId}`);
    if (exp && nonVide(ligne.idExpansion) && Number(ligne.idExpansion) === Number(exp) && nonVide(ligne.numeroFiche) && sansZeros(ligne.numeroFiche) === sansZeros(t.localId))
        return { ok: true, temoin: 'set+numero', carteTcgdex: ref, tcgdex: t };
    return { ok: false, raison: 'non-prouve', carteTcgdex: ref };
}

/** (B) */
function planifierB({ cartes, liens, frDuProduit, clone }) {
    const ix = indexClone(clone);
    const parCarte = grouperParCarte(liens, frDuProduit);
    const lignesDe = new Map();
    for (const l of liens) (lignesDe.get(l.carteId) || lignesDe.set(l.carteId, []).get(l.carteId)).push(l);
    const decisions = [];
    for (const c of cartes) {
        if (!(c.nomFr === null && c.nomFrSource === 'cardmarket')) continue;               // la population de (B), et elle seule
        const base = { carteId: c._id, nomEn: c.nomEn, ancien: null, source: 'cardmarket+tcgdex', conflits: [], nomTcgdex: null, temoin: null, nomFr: null, liens: [] };
        const rester = (raison, plus = {}) => decisions.push({ ...base, ...plus, decision: 'reste-null', raison });
        const groupes = parCarte.get(c._id);
        const d = groupes ? decider(groupes) : null;
        if (!d) { rester('sans-produit-fr'); continue; }                                  // plus aucun produit à nomFr : rien à arbitrer
        // « null périmé » : les produits concordent désormais (un seul nom Cardmarket). Même règle que pour un conflit : ce nom unique doit
        // CONCORDER avec le fr du clone par un lien prouvé, sinon la carte reste à null (ruling du coordinateur, 2026-11-01).
        base.conflits = d.groupes.map(g => g.forme);
        base.perime = !d.conflit;
        const preuves = (lignesDe.get(c._id) || []).map(l => ({ idProduct: l.idProduct, ...prouverLien(c, l, ix) }));
        base.liens = preuves.map(({ tcgdex, ...p }) => p);
        const valides = preuves.filter(p => p.ok);
        if (!valides.length) { rester('lien-non-prouve', { liens: base.liens, conflits: base.conflits }); continue; }
        const uniques = new Map(valides.map(p => [p.carteTcgdex, p.tcgdex]));
        const frs = new Map();
        for (const t of uniques.values()) if (nonVide(t.noms.fr)) frs.set(cle(t.noms.fr), t.noms.fr);
        const temoin = [...new Set(valides.map(p => p.temoin))].sort().join('+');
        if (!frs.size) { rester('tcgdex-sans-fr', { liens: base.liens, conflits: base.conflits, temoin }); continue; }
        if (frs.size > 1) { rester('tcgdex-contradictoire', { liens: base.liens, conflits: base.conflits, temoin, nomTcgdex: [...frs.values()].join(' / ') }); continue; }
        const [[kT, nomT]] = [...frs];
        const plus = { liens: base.liens, conflits: base.conflits, temoin, nomTcgdex: nomT, refsTcgdex: [...uniques.keys()] };
        if (nonVide(c.nomEn) && kT === cle(c.nomEn)) { rester('tcgdex-non-traduit', plus); continue; }   // le « fr » du clone est l'anglais : pas du français
        const g = d.groupes.find(x => x.cle === kT);
        if (!g) { rester('aucune-concordance', plus); continue; }
        // même nom aux accents près que le groupe Cardmarket : la forme la plus accentuée, à égalité celle de Cardmarket (cohérence avec (A))
        const nomFr = accents(nomT) > accents(g.forme) ? nomT : g.forme;
        decisions.push({ ...base, ...plus, decision: 'remplir', raison: 'concorde', nomFr });
    }
    return { decisions };
}

module.exports = { planifierA, planifierB, prouverLien, indexClone };

// ============================================================
// UNE FICHE PROUVÉE — le jugement d'UN produit désigné à une carte, par DEUX éléments indépendants et le témoin du nom (lot CAND-FICHES, 2026-10-17)
// ============================================================
// Pourquoi ce module existe : `joindre()` ne produit pas la ligne de ces produits (numéro à suffixe « 143a », numéro d'une autre extension de la carte
// « S01 » = 001/029 du Pokémon-e Starter Deck, [FB] collé au nom, produit sans numéro dont le nom est porté par deux produits, lien rouge de la Setlist).
// Une désignation par le nom seul serait la clé que le CLAUDE.md refuse ; ici la clé est le NOM + LES ATTAQUES (cle-nom-attaques.js, calibrée) et le
// TÉMOIN est ce que la clé n'a pas utilisé : la métacarte Cardmarket, le niveau, et — selon la voie — le numéro que la CARTE déclare elle-même, ou la Setlist.
// ÉCRIT PAR CE QU'ELLE AUTORISE (en tête du CLAUDE.md) : quatre voies nommées, tout le reste est refusé et dit sa cause ; un doute est un refus.
const { clesNom, nomJointDe, temoinDuNom } = require('./jointure');
const { indexer, candidats } = require('./cle-nom-attaques');

const VOIES = ['impression-numero', 'impression-equivalente', 'setlist', 'impression-du-tirage'];

/** Numéro comparable : minuscules, zéros de tête ôtés, SUFFIXE GARDÉ (« 143a » n'est pas « 143 »). */
const nu = n => String(n ?? '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
const chiffresDuNiveau = n => { const m = /(\d+)/.exec(String(n ?? '')); return m ? m[1] : null; };

/** Distance d'édition de Levenshtein (insertion, suppression, substitution), insensible à la casse. */
function distance(a, b) {
    a = String(a).toLowerCase(); b = String(b).toLowerCase();
    let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prec = cur;
    }
    return prec[b.length];
}

/** Le produit tel que decomposerNomCardmarket le lit, + les variantes où un groupe de 2-3 majuscules (« [FB] ») est le SUFFIXE du nom de la carte (« Drifblim FB »). */
function variantesDuProduit(p) {
    const base = { ...p };
    const groupes = [...String(p.name || '').matchAll(/\[([A-Z]{2,3})\]/g)].map(m => m[1]);
    return [base, ...groupes.map(g => ({ ...p, nom: `${p.nom} ${g}`, suffixe: g }))];
}

/** « Nom (Jeton N) » → { nom, jeton, num } — la forme que lit la règle R (regle-r-fiches.js) pour les titres de la Setlist. */
const parseTitre = t => { const m = /^(.*) \(([^()]*) ([^\s()]+)\)\s*$/.exec(String(t)); return m ? { nom: m[1], jeton: m[2], num: m[3] } : { nom: String(t), jeton: null, num: null }; };

/**
 * @param {object} o
 * @param {object} o.entree   { idProduct, carteId, voie, tirage, expansionImpression?, prefixe?, total? }
 * @param {object} o.produit  { idProduct, idMetacard, name, nom, attaques, niveau, numero, idExpansion }
 * @param {object} o.carte    document `cartes` (nomEn, niveau, attaques, impressions, liens)
 * @param {object[]} o.cartesDuSet     les cartes du set de la ligne (le témoin du nom de joindre())
 * @param {object[]} o.cartesPourCle   les cartes sur lesquelles la clé nom + attaques cherche (la base)
 * @param {{pages: object[]}|null} o.etatSetlist  `collecte_etat` du set, pour la voie « setlist »
 * @returns {{ ok: boolean, temoins: string[], refus: string[] }}
 */
function prouver({ entree, produit, carte, cartesDuSet = [], cartesPourCle = [], etatSetlist = null }) {
    // (`produit` est réassigné par ⓪ : une COPIE avec l'attaque corrigée, jamais le document lu)
    const temoins = [], refus = [];
    if (!VOIES.includes(entree.voie)) return { ok: false, temoins, refus: [`voie « ${entree.voie} » inconnue : la liste des voies est fermée (${VOIES.join(', ')})`] };
    if (!carte || carte._id !== entree.carteId) return { ok: false, temoins, refus: [`la carte lue (${carte?._id}) n'est pas celle de la décision (${entree.carteId})`] };

    // ⓪ FAUTES DE FRAPPE de Cardmarket, DÉCLARÉES par la décision (« Hyptnotic Gaze ») : la même attaque à UNE lettre près, présente des deux côtés — jamais devinée
    for (const [mal, bien] of entree.fautesDeFrappe || []) {
        const aLaFaute = (produit.attaques || []).includes(mal), laCarteLaPorte = (carte.attaques || []).some(a => a.nom === bien);
        if (!aLaFaute || !laCarteLaPorte || distance(mal, bien) > 1) { refus.push(`faute de frappe déclarée « ${mal} » → « ${bien} » non vérifiée (le produit la porte : ${aLaFaute} ; la carte porte « ${bien} » : ${laCarteLaPorte} ; distance ${distance(mal, bien)})`); continue; }
        produit = { ...produit, attaques: produit.attaques.map(a => (a === mal ? bien : a)) };
        temoins.push(`faute de frappe de Cardmarket « ${mal} » = « ${bien} » (distance d'édition 1, l'autre côté la porte telle quelle)`);
    }
    if (refus.length) return { ok: false, temoins, refus };

    // ① NOM + ATTAQUES (la clé) : la carte est parmi les candidates de l'une des variantes du nom du produit
    const index = indexer(cartesPourCle);
    let variante = null, cands = [];
    for (const v of variantesDuProduit(produit)) {
        const c = candidats(index, v, { forme: 'incluses' });
        if (c.some(x => x._id === carte._id)) { variante = v; cands = c; break; }
    }
    if (!variante) refus.push(`nom + attaques : « ${produit.name} » ne désigne pas la carte ${carte._id} « ${carte.nomEn} » (attaques ${JSON.stringify((carte.attaques || []).map(a => a.nom))})`);
    else temoins.push(`nom + attaques : « ${variante.nom} » [${(variante.attaques || []).join(' | ')}] ⊇ attaques de la carte ${JSON.stringify((carte.attaques || []).map(a => a.nom))}${variante.suffixe ? ` (le groupe [${variante.suffixe}] est le suffixe du nom)` : ''}`);

    // ② MÉTACARTE (Cardmarket l'a construite, la clé ne l'a pas lue)
    if (!(carte.liens?.idMetacards || []).includes(produit.idMetacard)) refus.push(`métacarte : celle du produit (${produit.idMetacard}) n'est pas parmi celles de la carte (${JSON.stringify(carte.liens?.idMetacards || [])})`);
    else temoins.push(`métacarte Cardmarket ${produit.idMetacard} déjà portée par la carte`);

    // ③ NIVEAU, quand les deux le portent
    const nP = chiffresDuNiveau(produit.niveau), nC = chiffresDuNiveau(carte.niveau);
    if (nP && nC) { if (nP !== nC) refus.push(`niveau : ${produit.niveau} contredit le niveau ${carte.niveau} de la carte`); else temoins.push(`niveau ${nC} = niveau de la carte`); }

    // ④ LE TÉMOIN DU NOM DE PRODUCTION (joindre().temoinDuNom) : il ne doit pas contredire
    if (variante) {
        const jeu = [...new Map([...cartesDuSet, carte].map(c => [c._id, c])).values()];
        const contre = temoinDuNom(jeu, produit.idExpansion)(carte, variante);
        if (contre) refus.push(`témoin du nom de joindre() : le nom du produit désigne ${contre.slice(0, 2).map(c => `${c._id} « ${c.nomEn} »`).join(', ')} plus que la carte`);
        else temoins.push('témoin du nom de joindre() : ne contredit pas');
    }

    // ⑤ LA VOIE : ce que la carte ou la Setlist déclare, indépendamment du nom
    const impressions = c => (c.impressions || []).filter(i => i && i.tirage === entree.tirage);
    const voie = {
        'impression-numero': c => impressions(c).filter(i => nu(i.numero) !== '' && nu(i.numero) === nu(produit.numero)),
        'impression-equivalente': c => {
            const m = new RegExp(`^${entree.prefixe ?? 'S'}0*(\\d+)$`, 'i').exec(String(produit.numero ?? '').trim());
            if (!m) return [];
            return impressions(c).filter(i => i.expansion === entree.expansionImpression && String(Number(i.numero)) === m[1] && (!entree.total || i.total === entree.total));
        },
        'impression-du-tirage': c => (String(produit.numero ?? '').trim() === '' ? impressions(c).filter(i => i.expansion === entree.expansionImpression) : []),
    };
    if (entree.voie === 'setlist') {
        const pages = etatSetlist?.pages;
        if (!Array.isArray(pages) || !pages.length) refus.push('Setlist : aucune Setlist lue pour ce set (collecte_etat.pages vide ou absent)');
        else {
            const cles = new Set(clesNom(nomJointDe(carte)));
            const nomCarte = e => clesNom(e.nom).some(k => cles.has(k)) || (variante && clesNom(e.nom).some(k => clesNom(variante.nom).includes(k)));
            const entrees = pages.map(pg => ({ ...parseTitre(pg.titre), titre: pg.titre, etat: pg.etat, pageid: pg.pageid }));
            const aCeNumero = entrees.filter(e => e.num != null && nu(e.num) === nu(produit.numero));
            const nommees = aCeNumero.filter(nomCarte);
            if (!nommees.length) refus.push(`Setlist : aucune entrée au n°${produit.numero} qui nomme la carte (${aCeNumero.slice(0, 3).map(e => e.titre).join(' / ') || 'aucune entrée à ce numéro'})`);
            else if (nommees.some(e => e.etat === 'ok')) {
                const autres = nommees.filter(e => e.etat === 'ok' && e.pageid !== carte._id);
                if (autres.length) refus.push(`Setlist : l'entrée « ${autres[0].titre} » est la page ${autres[0].pageid}, pas la carte ${carte._id}`);
                else temoins.push(`Setlist : « ${nommees.find(e => e.etat === 'ok').titre} » est la page de la carte (pageid ${carte._id})`);
            } else if (nommees.every(e => e.etat === 'manquant')) {
                const reelles = entrees.filter(e => e.etat === 'ok' && nomCarte(e));
                if (reelles.length) refus.push(`Setlist : lien rouge au n°${produit.numero}, mais une page réelle du même nom existe ailleurs (« ${reelles[0].titre} »)`);
                else if (cands.length !== 1) refus.push(`Setlist : lien rouge, mais nom + attaques désignent ${cands.length} cartes`);
                else temoins.push(`Setlist : « ${nommees[0].titre} » est un lien rouge au bon nom et au bon numéro, sans page réelle de ce nom, et la carte est la seule candidate`);
            } else refus.push(`Setlist : états mêlés au n°${produit.numero} (${nommees.map(e => e.etat).join(', ')})`);
        }
    } else {
        const f = voie[entree.voie];
        const mienne = f(carte);
        if (!mienne.length) refus.push(`${entree.voie} : la carte ne déclare aucune impression qui corresponde au produit (numéro ${produit.numero ?? '—'}, tirage ${entree.tirage}${entree.expansionImpression ? `, extension « ${entree.expansionImpression} »` : ''})`);
        else {
            const concurrentes = cands.filter(c => c._id !== carte._id && f(c).length);
            if (concurrentes.length) refus.push(`${entree.voie} : ${concurrentes.length} autre(s) candidate(s) satisfont la même voie (${concurrentes.slice(0, 3).map(c => c._id).join(', ')}) — un doute est un refus`);
            else temoins.push(`${entree.voie} : la carte déclare elle-même ${mienne.map(i => `« ${i.expansion} » n°${i.numero ?? '—'}${i.total ? `/${i.total}` : ''}`).join(', ')}, et elle est la seule candidate à le faire`);
        }
    }
    return { ok: refus.length === 0, temoins, refus };
}

module.exports = { prouver, VOIES, variantesDuProduit, parseTitre, nu };

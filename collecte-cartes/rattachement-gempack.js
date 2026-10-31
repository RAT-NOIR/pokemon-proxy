// ============================================================
// GEM PACK : LE RATTACHEMENT DES RÉIMPRESSIONS AU SET (décision de l'éditeur, 2026-10-31) — module PUR (aucune base, aucun réseau)
// ============================================================
// Quand la preuve par le set admet un Gem Pack, ses produits désignent des cartes qui existent déjà au catalogue (réimpressions d'autres sets) mais qui ne sont pas MEMBRES du set Gem Pack (`cartes.sets`) ni
// n'y portent d'impression : le planificateur de production (voie-deux-sources.planifierVoie) les refuse, justement, d'une seule phrase « la carte N n'est pas dans le set S (cartes.sets) ».
// CE MODULE n'invente aucune preuve : il ne lève QUE ce refus-là, et seulement quand l'association produit <-> carte <-> numéro de groupe est UNIQUE ET PROUVÉE. Concrètement :
//   · le refus doit être SEULE cause (tout autre refus — nom, attaques, métacarte, témoin du nom — reste un refus) ;
//   · le groupe (set, numéro Cardmarket) désigne UNE carte, et cette carte n'est désignée que par CE groupe ; ses produits déjà fichés pointent la MÊME carte ;
//   · un groupe se pose ENTIER ou pas du tout (un produit refusé pour une autre raison refuse son groupe) ;
//   · l'appartenance est SIMULÉE sur une copie, puis TOUTES les preuves de production rejouent (nom + attaques, métacarte, témoin du nom, impression au numéro Cardmarket) : ce qui ne passe pas reste refusé.
// LES VARIANTES : les produits d'un groupe (V1…V7) portent le même nom, la même métacarte, le même numéro de groupe. Le numéro posé est CELUI QUE CARDMARKET DONNE (le groupe) ; le RANG dans le groupe (« 03/07 ») ne
// se devine jamais — chaque produit d'un groupe de plusieurs reçoit un trou nommé « variantes-indiscernables » (écrit comme les restes). Un produit seul de son groupe est « unique » (rang sans objet, aucun trou).
// `variantes: 'refuser'` refuse en plus tout groupe de plusieurs produits (la lecture la plus stricte de la décision).
const V = require('./voie-deux-sources');
const { cleNumero } = require('./jointure');

const k = n => cleNumero(String(n ?? ''));
const RE_MEMBRE = /^deux-sources : la carte (\d+) n'est pas dans le set (\S+) \(cartes\.sets\)$/;
const RE_DEJA = /^le produit a déjà \d+ ligne\(s\)/;
const MOTIF_VARIANTES = 'variantes-indiscernables';

/**
 * @param {{entrees: object[], lecture: object, le?: Date, variantes?: 'groupe'|'refuser', planifier?: Function}} o   `entrees` : celles du planificateur (entreesDesSetsAdmis) ; `lecture` : celle de poser-fiches-voie-deux-sources.lire
 * @returns {{lignes: object[], impressions: object[], R: object, detail: object[], ajoutsSets: Map<number,string[]>, trous: object[], refus: object[], denominateurs: object}}
 */
function planifierRattachement({ entrees, lecture: lectureRecue, le = new Date(), variantes = 'groupe', planifier = V.planifierVoie, expansionDe = null }) {
    // LE NOM D'EXPANSION de l'impression : un set Gem Pack n'en porte pas (`bulba.expansion` null : pas de page Bulbapedia) et la production refuse alors toute impression (« le set n'a pas UN nom d'expansion »).
    // `expansionDe(set)` le donne, sur une COPIE de la lecture (le set réel ne bouge pas) ; il ne remplace JAMAIS un nom que le set porte déjà. Il est dit dans le plan (`expansionsNommees`).
    const expansionsNommees = {};
    const lecture = !expansionDe ? lectureRecue : { ...lectureRecue, sets: new Map([...lectureRecue.sets].map(([id, s]) => {
        if (typeof s.bulba?.expansion === 'string' && s.bulba.expansion) return [id, s];
        const nom = expansionDe(s);
        if (typeof nom !== 'string' || !nom) return [id, s];
        expansionsNommees[id] = nom;
        return [id, { ...s, bulba: { ...(s.bulba || {}), expansion: nom } }];
    })) };
    const numeroDe = new Map(); for (const prods of lecture.produits.values()) for (const p of prods) numeroDe.set(p.idProduct, p.numero ?? null);
    const idsDuSet = new Map();            // `${slug}|${groupe}` -> tous les produits du catalogue de ce groupe (le dénominateur des variantes)
    for (const prods of lecture.produits.values()) for (const p of prods) { const kk = `${p.slugSet}|${k(p.numero)}`; (idsDuSet.get(kk) || idsDuSet.set(kk, []).get(kk)).push(p.idProduct); }
    const ligneDe = new Map((lecture.lignes || []).map(l => [l.idProduct, l]));
    const refus = [], parEntree = new Map(entrees.map(e => [e.idProduct, e]));
    const refuser = (idProduct, categorie, raison) => refus.push({ idProduct, categorie, raison });

    // 1. la voie ordinaire : tout ce qu'elle POSE reste posé tel quel ; tout ce qu'elle refuse se trie
    const r1 = planifier({ entrees, lecture, le });
    const candidats = [];                  // refusés pour la SEULE raison de l'appartenance
    const dejaFichees = new Set();
    for (const r of r1.refus) {
        if (RE_DEJA.test(r.raison)) { dejaFichees.add(r.idProduct); continue; }
        const parts = String(r.raison).split(' ; '), m = parts.length === 1 ? RE_MEMBRE.exec(parts[0]) : null;
        if (!m) { refuser(r.idProduct, 'preuves', r.raison); continue; }
        const e = parEntree.get(r.idProduct);
        candidats.push({ idProduct: r.idProduct, carteId: Number(m[1]), slug: m[2], groupe: k(numeroDe.get(r.idProduct)), entree: e });
    }
    const dejaPoses = new Set(r1.lignes.map(l => l.idProduct));

    // 2. LES GARDES D'UNICITÉ, par groupe (set, numéro Cardmarket)
    const groupes = new Map();
    for (const c of candidats) { const kk = `${c.slug}|${c.groupe}`; (groupes.get(kk) || groupes.set(kk, []).get(kk)).push(c); }
    const refuserGroupe = (cs, raison) => { for (const c of cs) refuser(c.idProduct, 'rattachement', raison); cs.length = 0; };
    const cartesParGroupe = new Map();     // carteId -> groupes qui la désignent
    for (const [kk, cs] of groupes) { for (const id of new Set(cs.map(c => c.carteId))) (cartesParGroupe.get(`${cs[0].slug}|${id}`) || cartesParGroupe.set(`${cs[0].slug}|${id}`, new Set()).get(`${cs[0].slug}|${id}`)).add(kk); }
    for (const [kk, cs] of groupes) {
        const ids = [...new Set(cs.map(c => c.carteId))];
        if (ids.length !== 1) { refuserGroupe(cs, `le groupe ${cs[0].groupe} désigne ${ids.length} cartes différentes (${ids.join(', ')}) : une association ambiguë est un refus`); continue; }
        const dessinent = cartesParGroupe.get(`${cs[0].slug}|${ids[0]}`);
        if (dessinent.size > 1) { refuserGroupe(cs, `la carte ${ids[0]} est désignée par plusieurs groupes du set (${[...dessinent].map(x => x.split('|')[1]).join(', ')}) : une carte, deux groupes — aucun n'est prouvé`); continue; }
        // les autres produits de ce groupe : déjà fichés (même carte exigée), ou refusés pour une autre raison (refus du groupe), ou posés par la voie ordinaire
        const tous = (idsDuSet.get(kk) || []).filter(id => parEntree.has(id) || ligneDe.has(id));
        const autreCarte = tous.find(id => ligneDe.has(id) && ligneDe.get(id).carteId !== ids[0]);
        if (autreCarte != null) { refuserGroupe(cs, `le produit ${autreCarte} du groupe ${cs[0].groupe} porte déjà la fiche d'une autre carte (${ligneDe.get(autreCarte).carteId}) : le groupe est incohérent`); continue; }
        if (variantes === 'refuser' && tous.length > 1) { refuserGroupe(cs, `variantes indiscernables : le groupe ${cs[0].groupe} compte ${tous.length} produits de même nom (lecture stricte : aucun rattachement)`); continue; }
    }
    // « UN GROUPE SE POSE ENTIER OU PAS DU TOUT » : un produit du groupe refusé pour une AUTRE raison (preuves) ou par une garde ci-dessus refuse le groupe — évalué APRÈS toutes les gardes, sur l'état final des refus
    for (const [kk, cs] of groupes) if (cs.length) {
        const tous = (idsDuSet.get(kk) || []).filter(id => parEntree.has(id) || ligneDe.has(id));
        const mauvais = refus.find(r => (r.categorie === 'preuves' || r.categorie === 'rattachement') && tous.includes(r.idProduct) && !cs.some(c => c.idProduct === r.idProduct));
        if (mauvais) refuserGroupe(cs, `le produit ${mauvais.idProduct} du groupe ${cs[0].groupe} est refusé (${mauvais.raison.slice(0, 90)}) : un groupe se pose entier ou pas du tout`);
    }
    let retenus = [...groupes.values()].flat();

    // 3. L'APPARTENANCE SIMULÉE SUR UNE COPIE, puis TOUTES les preuves de production rejouent — jusqu'à ce que plus aucun groupe ne bouge
    let r2 = { lignes: [], impressions: [], refus: [], R: { aPoser: new Map(), groupes: new Map(), refus: [] }, detail: [] };
    for (let tour = 0; tour < 4 && retenus.length; tour++) {
        const ajouts = new Map(); for (const c of retenus) (ajouts.get(c.carteId) || ajouts.set(c.carteId, new Set()).get(c.carteId)).add(c.slug);
        const lecture2 = { ...lecture, cartes: lecture.cartes.map(c => (ajouts.has(c._id) ? { ...c, sets: [...new Set([...(c.sets || []), ...ajouts.get(c._id)])] } : c)) };
        r2 = planifier({ entrees: retenus.map(c => c.entree), lecture: lecture2, le });
        const refusees = new Set(r2.refus.map(r => r.idProduct));
        if (!refusees.size) break;
        const groupesTouches = new Set(retenus.filter(c => refusees.has(c.idProduct)).map(c => `${c.slug}|${c.groupe}`));
        for (const r of r2.refus) refuser(r.idProduct, 'preuves-apres-appartenance', r.raison);
        for (const c of retenus.filter(c => !refusees.has(c.idProduct) && groupesTouches.has(`${c.slug}|${c.groupe}`))) refuser(c.idProduct, 'rattachement', `un autre produit du groupe ${c.groupe} est refusé après l'appartenance : un groupe se pose entier ou pas du tout`);
        retenus = retenus.filter(c => !groupesTouches.has(`${c.slug}|${c.groupe}`));
        r2 = { lignes: [], impressions: [], refus: [], R: { aPoser: new Map(), groupes: new Map(), refus: [] }, detail: [] };
    }
    if (retenus.length === 0) r2 = { lignes: [], impressions: [], refus: [], R: { aPoser: new Map(), groupes: new Map(), refus: [] }, detail: [] };
    const ajoutsSets = new Map();
    for (const c of retenus) if (r2.lignes.some(l => l.idProduct === c.idProduct)) { const a = ajoutsSets.get(c.carteId) || []; if (!a.includes(c.slug)) a.push(c.slug); ajoutsSets.set(c.carteId, a); }

    // 4. LES LIGNES : celles de la voie ordinaire + celles que le rattachement rend posables ; les trous « variantes indiscernables »
    const lignes = [...r1.lignes, ...r2.lignes].sort((a, b) => a.idProduct - b.idProduct);
    const impressions = [...r1.impressions, ...r2.impressions];
    const trous = [], rattaches = new Set(r2.lignes.map(l => l.idProduct));
    let uniques = 0, indiscernables = 0;
    for (const l of lignes) {
        const nb = (idsDuSet.get(`${l.slugSet}|${k(l.numeroFiche)}`) || []).length;
        if (nb > 1) { indiscernables++; trous.push({ idProduct: l.idProduct, motif: MOTIF_VARIANTES, groupe: String(l.numeroFiche), slugSet: l.slugSet, produitsDuGroupe: nb, preuve: { rang: 'indiscernable', groupe: String(l.numeroFiche), produitsDuGroupe: nb, raison: 'les produits du groupe portent le même nom, la même métacarte et le même numéro de groupe ; aucune source indépendante ne nomme leur finition' } }); }
        else uniques++;
    }
    const refusParMotif = {};
    for (const r of refus) { const c = r.raison.replace(/\(.*?\)/g, '(…)').replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#').slice(0, 120); refusParMotif[c] = (refusParMotif[c] || 0) + 1; }
    const denominateurs = { produits: entrees.length, dejaFichees: dejaFichees.size, aRattacher: candidats.length, fiches: lignes.length, uniques, variantesIndiscernables: indiscernables, refuses: refus.length, refusParMotif };
    return { lignes, impressions, R: r2.R.aPoser.size || r1.R.aPoser.size ? { aPoser: new Map([...r1.R.aPoser, ...r2.R.aPoser]), groupes: new Map([...r1.R.groupes, ...r2.R.groupes]), refus: [...r1.R.refus, ...r2.R.refus] } : r2.R, detail: [...r1.detail, ...r2.detail], ajoutsSets, expansionsNommees, trous, refus: refus.sort((a, b) => a.idProduct - b.idProduct), denominateurs, rattaches: [...rattaches].sort((a, b) => a - b), dejaPoses: [...dejaPoses] };
}

/** « Gem Pack Vol 4 » (nom d'affichage tiré de Cardmarket) -> « Gem Pack Vol. 4 », la forme des impressions Gem Pack déjà au catalogue (Vol. 1 et Vol. 2). Tout autre nom : null (rien ne se devine). */
function nomExpansionGemPack(set) {
    const m = /^Gem Pack Vol ?(\d{1,2})$/.exec(String(set?.nomAffichage ?? '').trim());
    return m ? `Gem Pack Vol. ${Number(m[1])}` : null;
}

module.exports = { planifierRattachement, nomExpansionGemPack, MOTIF_VARIANTES };

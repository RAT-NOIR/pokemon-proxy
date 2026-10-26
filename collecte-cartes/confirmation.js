// ============================================================
// LE MARQUEUR DE CONFIRMATION PAR DEUX SOURCES SUR UNE LIGNE cartes_produits (B1, 2026-10-26) — PUR
// ============================================================
// Une ligne dont la fiche repose sur une preuve faible (`set+nom`, `setlist+nom`) est « douteuse » (audit-catalogue/classement.js). Quand une seconde source INDÉPENDANTE de Cardmarket et de Bulbapedia
// nomme le même (set, numéro, nom), la ligne peut porter `confirmation` : un champ ADDITIF, jamais une modification de `preuve` ni d'un autre champ.
//     confirmation: { sources: ['cardmarket', 'tcgdex'], valeurs: { set, numero, nom }, carteId, concordantes: [{ source, ref, set, numero, nom, par }], le, instrument }
// Les `concordantes` sont ECRITES pour que la règle de production (deux-sources.js::rejouer) les REJOUE à chaque lecture, contre la ligne et le produit D'AUJOURD'HUI : une confirmation n'est jamais un
// « ok » écrit une fois. Une garde s'écrit par ce qu'elle AUTORISE : tout ce qui n'est pas explicitement concordant est ignoré, sans exception levée.
// 🔑 Ce module IMPORTE la règle de production (rejouer, nomLisible, SOURCES_ADMISES) et cleNumero ; il ne les recopie pas.
const { rejouer, nomLisible } = require('./deux-sources');
const { cleNumero } = require('./jointure');

const CHAMP = 'confirmation';
const INSTRUMENT = 'poser-confirmations.js (B1) — rejeu de collecte-cartes/deux-sources.js::rejouer';
const CLASSE_CONFIRMEE = 'confirmee-deux-sources';
const CONFIRMATION_IGNOREE = 'confirmation-ignoree';

// Décision du testeur (2026-10-26) : une carte sans aucune marque de set (énergie de base générique, promo chinoise à jointure virtuelle) a réellement ce visuel ; ce n'est pas un faux.
// LISTE FERMÉE : tout autre cas reste refusé `carte-sans-impression-du-set`.
const MARQUE_GENERIQUE = 'visuel générique, sans marque de set';
const CAS_GENERIQUES = ['energie-de-base', 'promo-chinoise-jointure-virtuelle'];

const dedoublonner =xs => [...new Set(xs)];

/** Construit la valeur du champ. `produit` : { set, numero, nom } tels que Cardmarket les dit (slug appris, numéro appris, nom sans crochets). `concordantes` : celles de juger(). */
function construire({ carteId, produit, concordantes, le, instrument = INSTRUMENT, generique }) {
    const cc = (concordantes || []).map(c => ({ source: c.source, ref: c.ref ?? null, set: c.set, numero: c.numero, nom: c.nom ?? null, par: c.par ?? 'nom' }));
    const conf = { sources: ['cardmarket', ...dedoublonner(cc.map(c => c.source))], valeurs: { set: produit.set, numero: String(produit.numero), nom: produit.nom }, carteId, concordantes: cc, le, instrument };
    if (generique !== undefined) {
        if (!CAS_GENERIQUES.includes(generique)) throw new Error(`cas générique inconnu « ${generique} » (liste fermée : ${CAS_GENERIQUES.join(', ')})`);
        Object.assign(conf, { generique: true, marque: MARQUE_GENERIQUE, cas: generique });
    }
    return conf;
}

/**
 * La confirmation concorde-t-elle avec la ligne ACTUELLE ? @param ctx { ligne: {carteId, numeroFiche?, slugSet?}, produit: {set, numero, nom} (Cardmarket, aujourd'hui), ficheNumero?: numéro de la fiche servie }
 * @returns {{ ok: boolean, motifs: string[] }} — ne lève jamais.
 */
function confirmationConcorde(conf, { ligne, produit, ficheNumero } = {}) {
    const motifs = [];
    const refus = m => { motifs.push(m); return { ok: false, motifs }; };
    if (!conf || typeof conf !== 'object' || Array.isArray(conf)) return refus('pas de confirmation lisible');
    if (!produit || produit.set == null || produit.numero == null || produit.nom == null) return refus('produit actuel illisible : je ne peux pas conclure');
    if (!ligne || typeof ligne !== 'object') return refus('ligne illisible : je ne peux pas conclure');
    const { sources, valeurs, concordantes } = conf;
    if (!Array.isArray(sources) || !sources.includes('cardmarket')) return refus('sources sans Cardmarket');
    if (!Array.isArray(concordantes) || !concordantes.length) return refus('aucune concordante écrite');
    const independantes = sources.filter(s => s !== 'cardmarket');
    if (!independantes.length) return refus('aucune source indépendante de Cardmarket');
    // les sources nommées sont EXACTEMENT celles que les concordantes portent : une source revendiquée sans relevé n'est pas une source
    const portees = dedoublonner(concordantes.map(c => c?.source));
    if (portees.length !== independantes.length || independantes.some(s => !portees.includes(s))) return refus(`sources déclarées (${independantes.join(', ')}) ≠ sources des concordantes (${portees.join(', ')})`);
    // [REJEU-DEBUT] la règle de production rejoue chaque concordante contre le produit d'AUJOURD'HUI (source admise, set, numéro, nom)
    const r = rejouer({ set: produit.set, numero: produit.numero, nom: produit.nom }, concordantes);
    if (!r.ok) return refus(`rejeu des deux sources : ${r.motifs.join(' ; ')}`);
    // [REJEU-FIN]
    // [CONCORDE-DEBUT] la confirmation désigne ENCORE cette ligne : mêmes valeurs écrites que le produit et la ligne d'aujourd'hui
    if (!valeurs || typeof valeurs !== 'object') return refus('valeurs absentes');
    if (valeurs.set !== produit.set) return refus(`set confirmé « ${valeurs.set} » ≠ set du produit « ${produit.set} »`);
    if (cleNumero(String(valeurs.numero)) !== cleNumero(String(produit.numero))) return refus(`numéro confirmé ${valeurs.numero} ≠ numéro du produit ${produit.numero}`);
    if (valeurs.nom !== produit.nom) return refus(`nom confirmé « ${valeurs.nom} » ≠ nom du produit « ${produit.nom} »`);
    if (conf.carteId == null || conf.carteId !== ligne.carteId) return refus(`carte confirmée ${conf.carteId} ≠ carte de la ligne ${ligne.carteId}`);
    if (ligne.numeroFiche != null && String(ligne.numeroFiche).trim() !== '' && cleNumero(String(ligne.numeroFiche)) !== cleNumero(String(valeurs.numero))) return refus(`numeroFiche de la ligne ${ligne.numeroFiche} ≠ numéro confirmé ${valeurs.numero}`);
    if (ligne.slugSet != null && ligne.slugSet !== valeurs.set) return refus(`set de la ligne « ${ligne.slugSet} » ≠ set confirmé « ${valeurs.set} »`);
    if (ficheNumero != null && String(ficheNumero).trim() !== '' && cleNumero(String(ficheNumero)) !== cleNumero(String(valeurs.numero))) return refus(`fiche servie au numéro ${ficheNumero} ≠ numéro confirmé ${valeurs.numero}`);
    // [CONCORDE-FIN]
    // [GENERIQUE-DEBUT] une confirmation générique n'est valide que si marque et cas sont EXACTEMENT ceux de la liste fermée
    if (conf.generique !== undefined || conf.marque !== undefined || conf.cas !== undefined) {
        if (conf.generique !== true || conf.marque !== MARQUE_GENERIQUE || !CAS_GENERIQUES.includes(conf.cas)) return refus('confirmation générique mal formée (marque ou cas hors de la liste fermée)');
    }
    // [GENERIQUE-FIN]
    return { ok: true, motifs };
}

/**
 * Ce que `classerFiche` reçoit : null si la ligne ne porte aucune confirmation (rien à lire, rien à compter) ; sinon { concorde } — le verdict REJOUÉ, jamais un « ok » écrit.
 * @param {object|undefined} ligne la ligne cartes_produits de la fiche servie (champs bruts : confirmation, carteId, numeroFiche, slugSet)
 */
function pourClasser(ligne, { produit, ficheNumero } = {}) {
    if (!ligne || ligne[CHAMP] === undefined || ligne[CHAMP] === null) return null;
    const concorde = confirmationConcorde(ligne[CHAMP], { ligne, produit, ficheNumero }).ok === true;
    return { concorde, generique: concorde && ligne[CHAMP].generique === true };
}

// une finition en plus du même nom (« Water Energy Pokeball Holo ») n'est pas un autre nom (même tolérance que le scan AB : la finition ne se lit pas dans le nom de la carte)
const FINITION = /^(\s*(pok[eé]\s?ball|master\s?ball|ultra\s?ball|great\s?ball|love\s?ball|quick\s?ball|dusk\s?ball|friend\s?ball|ball|holo|reverse)\s*)+$/i;
/**
 * Les relevés LISIBLES qui disent un AUTRE nom au même (set, numéro) : `juger` de production ne détecte aucune contradiction (une 2e source qui concorde suffit), un tel désaccord arrête la pose.
 * @param {Array<{source, raison}>} refusees  les `refusees` de juger() ; seul « nom discordant » (donc même set et même numéro) peut être une contradiction.
 */
function contradictions(refusees) {
    return (refusees || []).filter(r => {
        const m = /^nom discordant \(« (.*?) » \/ « (.*?) »\)$/.exec(String(r?.raison ?? ''));
        if (!m) return false;
        const [, lu, notre] = m;
        if (!nomLisible(lu)) return false;
        return !(lu.toLowerCase().startsWith(notre.toLowerCase()) && FINITION.test(lu.slice(notre.length)));
    });
}

module.exports = { MARQUE_GENERIQUE, CAS_GENERIQUES, CHAMP, INSTRUMENT, CLASSE_CONFIRMEE, CONFIRMATION_IGNOREE, construire, confirmationConcorde, pourClasser, contradictions };

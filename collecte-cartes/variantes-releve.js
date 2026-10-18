// ============================================================
// TAMPONS-RELEVE B (2026-10-18) — LES MARQUES DES PRODUITS TAMPONNÉS DU RELEVÉ DU TESTEUR : `cartes_produits.variante` (+ `variantePreuve`), et la fin du « tampon non représenté » quand la séparation est prouvée
// ============================================================
// 🔑 DÉCISION DU TESTEUR (relevé du 2026-10-18, 40 cartes vérifiées carte en main) : « les 30 lignes « oui » : vérifie que leur visuel montre bien la version tamponnée (sinon tamponNonRepresente…), et que la variante est posée
// quand elle est connue. » Ce module traite les 13 V2 tamponnés servis par le scan NORMAL de la carte, sur le modèle des 61 paires Black Star (variante-staff.js), avec le VOCABULAIRE FERMÉ de l'API (coordinateur, 2026-10-18) :
//   staff, prerelease, league, championship, toys-r-us, gamestop, kfc, indomilk, professor, cosmo, place-1…place-4, plus l'existant normale / jumbo. `variante` = UN jeton ou une COMBINAISON jointe par « + », dans l'ordre de cette liste.
//   Ni « enseigne » ni « autre » : une marque que ni le relevé (colonne + titre de l'annonce, vérifiés par le testeur) ni l'étiquette Cardmarket lue ne nomme n'existe pas (un doute est un trou).
// ÉCRIT PAR CE QU'IL AUTORISE :
//   · le V2 (le produit du testeur) reçoit sa variante + sa preuve, si sa ligne n'en porte pas une AUTRE ;
//   · le frère V1 reçoit « normale » SEULEMENT s'il figure dans la LISTE FERMÉE des V1 REGARDÉS À L'ŒIL par le coordinateur le 2026-10-18 (vignette Cardmarket en pleine résolution : aucun tampon, aucune étiquette) et que le relevé
//     ne le désigne pas. Ni l'ancienneté (dateAdded vaut « 0000-00-00 » sur 9 V1 : une sentinelle n'est JAMAIS une preuve, elle ne sert qu'à CONTREDIRE quand les deux dates sont réelles) ni l'absence d'étiquette OCR
//     (rappel ≈ 38 %) ne prouvent une version normale ;
//   · les frères que le coordinateur a lus à l'œil (FICHES[].freres : « 2ND PLACE », « Cosmo Holo Box Set Promo »…) reçoivent leur variante avec cette preuve ; les autres frères ne reçoivent rien ;
//   · l'entrée `cartes.images` servie et son document `images` reçoivent `partageeTamponNonSepare: false` + `tamponNonRepresente` SEULEMENT si la séparation est prouvée des deux côtés ET qu'aucun autre produit ne
//     partage la fiche (sinon un produit non séparé serait servi par une entrée qui dit « séparé »). Jamais de `produitsPartages` (l'API juge incohérente une liste qui ne contient pas tous les produits servis).
// Aucune requête réseau. Idempotent. Le reste est un refus NOMMÉ.
const { cleNumero } = require('./jointure');

const JETONS = Object.freeze(['staff', 'prerelease', 'league', 'championship', 'toys-r-us', 'gamestop', 'kfc', 'indomilk', 'professor', 'cosmo', 'snowflake', 'place-1', 'place-2', 'place-3', 'place-4']);
const SEULS = Object.freeze(['normale', 'jumbo']);
const AFFICHAGE = Object.freeze({ staff: 'Staff', prerelease: 'Prerelease', league: 'League', championship: 'Championship', 'toys-r-us': 'Toys "R" Us', gamestop: 'GameStop', kfc: 'KFC', indomilk: 'Indomilk',
    professor: 'Professor', cosmo: 'Cosmo', snowflake: 'Snowflake', 'place-1': '1re place', 'place-2': '2e place', 'place-3': '3e place', 'place-4': '4e place' });
const DATE_RELEVE = '2026-10-18', DATE_OCR = '2026-10-17';

/** Une variante est valide si c'est normale | jumbo, ou 1 à n jetons de la liste fermée, sans doublon, dans l'ordre de la liste. */
function varianteValide(v) {
    if (typeof v !== 'string') return false;
    if (SEULS.includes(v)) return true;
    const t = v.split('+');
    if (!t.length || t.some(x => !JETONS.includes(x))) return false;
    return t.every((x, i) => i === 0 || JETONS.indexOf(t[i - 1]) < JETONS.indexOf(x));
}
/** Le libellé de `tamponNonRepresente` pour une variante (RULING PROPOSÉ au testeur) : les marques en clair jointes par « + » ; plusieurs tampons distincts sur une même entrée : « / ». */
const libelleTampon = v => { if (!varianteValide(v) || SEULS.includes(v)) throw new Error(`libellé : « ${v} » n'est pas une variante tamponnée`); return v.split('+').map(x => AFFICHAGE[x]).join(' + '); };

/** La colonne `stamp` du relevé -> jetons, pour les colonnes qui nomment une marque de la liste. « Autre » ne nomme rien : seul le titre ou l'étiquette peut. */
const COLONNES = Object.freeze({ 'Staff': ['staff'], 'Prerelease': ['prerelease'], 'Staff + Prerelease': ['staff', 'prerelease'], 'League': ['league'], 'Championship': ['championship'], 'Staff + Championship': ['staff', 'championship'], 'Autre': [] });
/**
 * LA TABLE FERMÉE des 13 (idProduct du testeur). `corrobore` : mots de l'URL de l'annonce qui doivent y figurer (le titre confirme la colonne). `ajouts` : marques que la colonne ne nomme pas et que le TITRE de l'annonce
 * nomme (le mot doit figurer dans l'URL). `reserve` : ce que le titre dit et que la table NE retient PAS (colonne ou étiquette Cardmarket qui ne le confirment pas : un doute est un trou).
 */
const FICHES = Object.freeze([
    { id: 275574, colonne: 'Staff + Prerelease', corrobore: ['prerelease'], ajouts: [] },
    { id: 882904, colonne: 'Staff + Prerelease', corrobore: ['pre-release', 'staff'], ajouts: [] },
    { id: 449213, colonne: 'Staff + Championship', corrobore: ['staff', 'championship'], ajouts: [] },
    { id: 882908, colonne: 'Prerelease', corrobore: ['prerelease'], ajouts: [] },
    { id: 882889, colonne: 'Prerelease', corrobore: ['prerelease'], ajouts: [] },
    { id: 275575, colonne: 'Prerelease', corrobore: ['prerelease'], ajouts: [] },
    // Kricketot : « Snowflake Stamp » (flocon, calendrier de l'Avent) n'est PAS « cosmo » (le motif holo Cosmos). L'étiquette Cardmarket lue ne dit pas « Cosmos » : snowflake seul ; cosmo viendrait du titre seul.
    { id: 882210, colonne: 'Autre', corrobore: [], ajouts: [{ jeton: 'snowflake', mot: 'flocon' }], reserve: 'prerelease et cosmo (titre seul ; la colonne dit Autre et l\'étiquette Cardmarket lue dit « Snowflake Stamp Countdown Calendar Promo », sans Cosmos)' },
    { id: 449653, colonne: 'Championship', corrobore: ['championships'], ajouts: [], reserve: 'staff (titre seul ; la colonne ne le nomme pas, contrairement à Tropius)' },
    { id: 371590, colonne: 'League', corrobore: ['stamp'], ajouts: [] },
    { id: 708073, colonne: 'Autre', corrobore: [], ajouts: [{ jeton: 'toys-r-us', mot: 'toysrus' }] },
    // Ogerpon : 800148 « Cosmo Holo Box Set Promo » = cosmo (vignette regardée). 771357 « EB Games Promo » : aucun jeton ; 786105 « Cosmo Holo Twilight Masquerade Stamped Promo » : tampon de logo d'extension sans jeton sûr :
    // ni l'un ni l'autre ne reçoit rien, donc la fiche n'est PAS entièrement séparée et son entrée d'image ne reçoit pas de marque.
    { id: 771356, colonne: 'Autre', corrobore: [], ajouts: [{ jeton: 'gamestop', mot: 'gamestop' }], freres: [{ id: 800148, variante: 'cosmo', etiquette: 'Cosmo Holo Box Set Promo' }], sansJeton: { 771357: 'EB Games Promo', 786105: 'Cosmo Holo Twilight Masquerade Stamped Promo' } },
    { id: 359285, colonne: 'Autre', corrobore: [], ajouts: [{ jeton: 'toys-r-us', mot: 'toys-r-us' }, { jeton: 'cosmo', mot: 'cosmo' }] },
    // Frosmoth : la vignette Cardmarket de 450593 dit « 1ST PLACE » (League Challenge), pas « 2e place » comme le relevé et le titre de l'annonce : la vignette fait foi pour la marque, le conflit est SIGNALÉ dans la preuve.
    // Les frères, lus à l'œil : 450598 « 2ND PLACE », 450603 « 3RD PLACE », 450608 « 4TH PLACE » -> la fiche est entièrement séparée (V1 normale + 4 places).
    { id: 450593, colonne: 'League', corrobore: ['2ieme-place'], ajouts: [{ jeton: 'place-1', vignette: '1ST PLACE' }], conflit: 'le relevé du testeur disait 2e place pour ce produit ; décision du testeur du 2026-10-18 : la vignette fait foi (1re place), l\'annonce de l\'utilisateur correspond à 450598 (2e place)',
        freres: [{ id: 450598, variante: 'league+place-2', etiquette: '2ND PLACE' }, { id: 450603, variante: 'league+place-3', etiquette: '3RD PLACE' }, { id: 450608, variante: 'league+place-4', etiquette: '4TH PLACE' }] }
]);

/** Les V1 REGARDÉS À L'ŒIL par le coordinateur le 2026-10-18 (vignette Cardmarket en pleine résolution : aucun tampon, aucune étiquette). LISTE FERMÉE : hors d'elle, aucun « normale ». */
const NORMALES_VUES = Object.freeze(new Set([274061, 277806, 281026, 278344, 277333, 274145, 277715, 280131, 279780, 311922, 769198, 299511, 436454]));
const PREUVE_NORMALE = 'vignette Cardmarket regardée par le coordinateur le 2026-10-18 : aucun tampon ni étiquette';
/** Une date de catalogue est RÉELLE si elle se lit et n'est pas la sentinelle « 0000-00-00 » de Cardmarket. Une date non réelle ne prouve rien. */
const dateReelle = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return !!m && Number(m[1]) >= 1996 && Number(m[2]) >= 1 && Number(m[3]) >= 1 && !Number.isNaN(Date.parse(String(s).replace(' ', 'T'))); };

/** Ce que dit une étiquette OCR de Cardmarket, par une table fermée de motifs. Une étiquette qui nomme une marque que nos jetons n'ont pas CONTREDIT le relevé : refus. */
const MOTIFS_ETIQUETTE = Object.freeze([[/game\s*stop/i, 'gamestop'], [/snowflake/i, 'snowflake'], [/cosmo/i, 'cosmo'], [/pre-?rel|rerel/i, 'prerelease'], [/staff/i, 'staff'], [/toys/i, 'toys-r-us']]);
const jetonsDeEtiquette = txt => MOTIFS_ETIQUETTE.filter(([re]) => re.test(String(txt ?? ''))).map(([, j]) => j);

/** Le CSV du testeur en lignes {url, idProduct, stamp, propre} ; entête et lignes vérifiées, rien de deviné. */
function lireCsv(texte) {
    const lignes = String(texte ?? '').split(/\r?\n/).filter(l => l.trim() !== '');
    const entete = (lignes[0] || '').trim().replace(/^﻿/, '');
    if (entete !== 'annonce_vinted;idProduct;stamp;fiche_cardmarket_propre') throw new Error(`relevé : entête inattendue « ${entete} »`);
    return lignes.slice(1).map(l => {
        const c = l.split(';').map(x => x.trim().replace(/^"|"$/g, ''));
        if (c.length < 4 || !Number.isInteger(Number(c[1]))) throw new Error(`relevé : ligne illisible « ${l.slice(0, 80)} »`);
        return { url: c[0], idProduct: Number(c[1]), stamp: c[2], propre: c[3] };
    });
}

/**
 * Les fiches à traiter, depuis le CSV du testeur (lignes {idProduct, stamp, url, propre}) et la TABLE FERMÉE. Tout désaccord LÈVE : la colonne doit être celle de la table, le mot doit figurer dans l'URL.
 * @returns {Array<{idProduct, jetons: string[], variante: string, colonne: string, url: string, reserve: string|null}>}
 */
function listeDesFiches(lignesCsv, table = FICHES) {
    const parId = new Map(lignesCsv.map(l => [l.idProduct, l]));
    return table.map(t => {
        const l = parId.get(t.id);
        if (!l) throw new Error(`fiche ${t.id} : absente du relevé du testeur — rien n'est écrit`);
        if (l.propre !== 'oui') throw new Error(`fiche ${t.id} : « fiche propre » vaut « ${l.propre} » au relevé, la partie B ne traite que les « oui »`);
        if (l.stamp !== t.colonne) throw new Error(`fiche ${t.id} : la colonne du relevé est « ${l.stamp} », la table dit « ${t.colonne} » — rien n'est écrit`);
        const url = String(l.url).toLowerCase();
        for (const m of [...t.corrobore, ...t.ajouts.map(a => a.mot).filter(Boolean)]) if (!url.includes(m)) throw new Error(`fiche ${t.id} : le mot « ${m} » ne figure pas dans l'URL de l'annonce — rien n'est écrit`);
        const base = COLONNES[t.colonne];
        if (!base) throw new Error(`fiche ${t.id} : colonne « ${t.colonne} » hors table`);
        const jetons = [...new Set([...base, ...t.ajouts.map(a => a.jeton)])].sort((a, b) => JETONS.indexOf(a) - JETONS.indexOf(b));
        if (!jetons.length) throw new Error(`fiche ${t.id} : aucune marque nommée (colonne « ${t.colonne} » sans titre qui la précise) : un doute est un trou`);
        const variante = jetons.join('+');
        if (!varianteValide(variante)) throw new Error(`fiche ${t.id} : variante « ${variante} » hors vocabulaire fermé`);
        const freres = (t.freres || []).map(x => { if (!varianteValide(x.variante) || SEULS.includes(x.variante)) throw new Error(`fiche ${t.id} : frère ${x.id} : variante « ${x.variante} » hors vocabulaire tamponné`); return { ...x }; });
        return { idProduct: t.id, jetons, variante, colonne: t.colonne, url: l.url, reserve: t.reserve ?? null, vignettes: t.ajouts.filter(a => a.vignette).map(a => a.vignette), conflit: t.conflit ?? null, freres, sansJeton: t.sansJeton ?? {} };
    });
}

/**
 * LES CORRECTIONS (feu vert du testeur, DEMANDE-API-VISUELS.md ~22:00 UTC, mot pour mot : « Doublade MEP 067 (877546) et Delphox MEP 074 (884752) : OUI, corrige-les en tamponnés (variante prerelease).
 * Le relevé de l'utilisateur fait foi. »). LISTE FERMÉE DE 2 ; la condition est que la valeur d'avant soit EXACTEMENT « normale » (la séparation du 17/10 a supposé V1 = normale). Leur V2 (staff) ne bouge pas,
 * ni leur entrée d'image (`tamponNonRepresente: "Staff"` : le coordinateur regarde le scan d'abord).
 */
const CORRECTIONS = Object.freeze([{ id: 877546, de: 'normale', vers: 'prerelease', nom: 'Doublade MEP 067', mot: 'prerelease' }, { id: 884752, de: 'normale', vers: 'prerelease', nom: 'Delphox MEP 074', mot: 'prerelease' }]);
function listeDesCorrections(lignesCsv, table = CORRECTIONS) {
    const parId = new Map(lignesCsv.map(l => [l.idProduct, l]));
    return table.map(t => {
        const l = parId.get(t.id);
        if (!l) throw new Error(`correction ${t.id} : absente du relevé du testeur — rien n'est écrit`);
        if (l.propre !== 'oui' || l.stamp !== 'Autre') throw new Error(`correction ${t.id} : le relevé dit « ${l.stamp} » / propre « ${l.propre} », la table attend « Autre » / « oui » — rien n'est écrit`);
        if (!String(l.url).toLowerCase().includes(t.mot)) throw new Error(`correction ${t.id} : le mot « ${t.mot} » ne figure pas dans l'URL de l'annonce — rien n'est écrit`);
        if (!varianteValide(t.vers)) throw new Error(`correction ${t.id} : variante « ${t.vers} » hors vocabulaire`);
        return { idProduct: t.id, de: t.de, vers: t.vers, nom: t.nom, preuve: `relevé du testeur, ${DATE_RELEVE} (annonce ${l.url}, colonne « ${l.stamp} ») et feu vert du testeur du ${DATE_RELEVE} (« le relevé de l'utilisateur fait foi ») : ce produit est le tamponné ${t.vers} ; remplace « ${t.de} » posée le 2026-10-17 par supposition V1 = normale` };
    });
}

/**
 * LES CORRECTIONS VUES (B2, décision du testeur du 2026-10-18, mot pour mot : « Les 18 V1 de MEP marqués « normale » : OUI, corrige-les en prerelease, mais carte par carte, SEULEMENT là où le scan ou la vignette
 * Cardmarket montre bien le logo de prérelease. »). LISTE FERMÉE DE 18 ; la preuve n'est PAS le CSV du testeur (ces ids n'y sont pas) mais la vignette Cardmarket regardée par le coordinateur (zoom ×3).
 * Même condition que CORRECTIONS : la valeur d'avant doit être exactement « normale » ; en plus, le set et le numéro de fiche de la ligne doivent être ceux de la table.
 */
const SET_MEP = 'MEP-Black-Star-Promos';
const vue = (id, numero, nom, logo, zoomSeul = false) => Object.freeze({ id, de: 'normale', vers: 'prerelease', nom, set: SET_MEP, numero, logo, ...(zoomSeul ? { zoomSeul: true } : {}) });
const CORRECTIONS_VUES = Object.freeze([
    vue(851043, '001', 'Meganium', 'MEGA EVOLUTION'), vue(851045, '002', 'Inteleon', 'MEGA EVOLUTION'), vue(851047, '003', 'Alakazam', 'MEGA EVOLUTION'), vue(851049, '004', 'Lunatone', 'MEGA EVOLUTION'),
    vue(857390, '014', 'Ceruledge', 'PHANTASMAL FLAMES'), vue(857393, '015', 'Zacian', 'PHANTASMAL FLAMES'), vue(857396, '016', 'Flygon', 'PHANTASMAL FLAMES'), vue(857400, '017', 'Toxtricity', 'PHANTASMAL FLAMES'),
    vue(877543, '064', 'Serperior', 'PERFECT ORDER'), vue(877544, '065', 'Barbaracle', 'PERFECT ORDER'), vue(877545, '066', 'Tyrantrum', 'PERFECT ORDER'),
    vue(884754, '075', 'Ampharos', 'CHAOS RISING'), vue(884756, '076', 'Crobat', 'CHAOS RISING'), vue(884758, '077', 'Goodra', 'CHAOS RISING'),
    vue(894261, '082', 'Miraidon', 'PITCH BLACK'), vue(894262, '083', 'Slowbro', 'PITCH BLACK'), vue(894263, '084', 'Dhelmise', 'PITCH BLACK', true), vue(894264, '085', 'Bastiodon', 'PITCH BLACK')
]);
function listeDesCorrectionsVues(table = CORRECTIONS_VUES) {
    const vus = new Set(), communs = new Set(CORRECTIONS.map(c => c.id));
    return table.map(t => {
        if (vus.has(t.id)) throw new Error(`correction vue ${t.id} : id en double — rien n'est écrit`);
        vus.add(t.id);
        if (communs.has(t.id)) throw new Error(`correction vue ${t.id} : figure aussi dans CORRECTIONS — rien n'est écrit`);
        if (typeof t.set !== 'string' || !t.set.trim()) throw new Error(`correction vue ${t.id} : sans set — rien n'est écrit`);
        if (t.numero == null || !String(t.numero).trim()) throw new Error(`correction vue ${t.id} : sans numero — rien n'est écrit`);
        if (!varianteValide(t.vers)) throw new Error(`correction vue ${t.id} : variante « ${t.vers} » hors vocabulaire`);
        return { idProduct: t.id, de: t.de, vers: t.vers, nom: t.nom, set: t.set, numero: t.numero,
            preuve: `vignette Cardmarket regardée par le coordinateur le ${DATE_RELEVE} (zoom ×3) : logo de prérelease « ${t.logo} » visible${t.zoomSeul ? ' ; visible au zoom seulement' : ''} ; feu vert du testeur du ${DATE_RELEVE} (« corrige-les en prerelease, carte par carte, SEULEMENT là où le scan ou la vignette Cardmarket montre bien le logo de prérelease ») ; remplace « ${t.de} » posée le 2026-10-17 par supposition V1 = normale` };
    });
}

const preuveV2 = (f, etiquette) => `relevé du testeur, ${DATE_RELEVE} (annonce ${f.url}, colonne « ${f.colonne} »)${etiquette ? ` ; étiquette Cardmarket lue : « ${etiquette} » (OCR ${DATE_OCR})` : ''}`
    + (f.vignettes?.length ? ` ; étiquette lue sur la vignette Cardmarket (${f.vignettes.join(', ')}), regardée par le coordinateur le ${DATE_RELEVE}` : '') + (f.conflit ? ` ; ${f.conflit}` : '');
const preuveFrere = x => `vignette Cardmarket regardée par le coordinateur le ${DATE_RELEVE} : « ${x.etiquette} »`;

const nf = l => cleNumero(l.numeroFiche);

/**
 * LE PLAN. @param {{cartesDb, fiches: object[], dates: Map<number,string>, idsReleve: Set<number>, etiquettes: Map<number,string>}} o
 * @returns {{items: object[], refus: object[], comptes: object}}
 */
async function construirePlan({ cartesDb, fiches, dates, idsReleve, etiquettes, corrections = [], normalesVues = NORMALES_VUES }) {
    const ids = fiches.map(f => f.idProduct);
    const l2 = await cartesDb.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
    const carteIds = [...new Set(l2.map(l => l.carteId))];
    const voisines = carteIds.length ? await cartesDb.collection('cartes_produits').find({ carteId: { $in: carteIds } }).toArray() : [];
    const cartes = carteIds.length ? await cartesDb.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { images: 1 } }).toArray() : [];
    const parCarte = new Map(cartes.map(c => [c._id, c]));
    const items = [], refus = [];
    for (const f of fiches) {
        const non = motif => refus.push({ idProduct: f.idProduct, variante: f.variante, motif });
        const etiq = etiquettes.get(f.idProduct) ?? null;
        const lus = jetonsDeEtiquette(etiq);
        if (lus.some(j => !f.jetons.includes(j))) { non(`etiquette-contredit : « ${etiq} » nomme ${lus.join('+')}`); continue; }
        const lignes2 = l2.filter(l => l.idProduct === f.idProduct);
        if (lignes2.length !== 1) { non(lignes2.length ? 'lignes-multiples' : 'produit-sans-ligne'); continue; }
        const L2 = lignes2[0];
        if (L2.variante != null && L2.variante !== f.variante) { non(`variante-contraire : ${L2.variante}`); continue; }
        const freres = voisines.filter(l => l.carteId === L2.carteId && l.slugSet === L2.slugSet && l.idProduct !== f.idProduct && L2.numeroFiche != null && l.numeroFiche != null && nf(l) === nf(L2));
        const item = { idProduct: f.idProduct, variante: f.variante, jetons: f.jetons, reserve: f.reserve, carteId: L2.carteId, set: L2.slugSet, numero: L2.numeroFiche, freres: freres.map(l => l.idProduct),
            v2: { _id: L2._id, avant: L2.variante ?? null, variante: f.variante, preuve: preuveV2(f, etiq), deja: L2.variante === f.variante && !!L2.variantePreuve }, v1: null, v1Motif: null, entree: null, entreeMotif: null, doc: null };
        // les frères lus à l'œil (variante + preuve « vignette regardée »)
        const vus = new Set((f.freres || []).map(x => x.id));
        item.freresVus = []; item.freresVusRefus = [];
        for (const x of f.freres || []) {
            const Lx = freres.find(l => l.idProduct === x.id);
            if (!Lx) item.freresVusRefus.push(`${x.id} : absent de la fiche`);
            else if (Lx.variante != null && Lx.variante !== x.variante) item.freresVusRefus.push(`${x.id} : variante-contraire ${Lx.variante}`);
            else item.freresVus.push({ _id: Lx._id, idProduct: x.id, avant: Lx.variante ?? null, variante: x.variante, preuve: preuveFrere(x), deja: Lx.variante === x.variante && !!Lx.variantePreuve });
        }
        // V1 : un V1 REGARDÉ (liste fermée), jamais déduit d'une date ; deux dates RÉELLES peuvent seulement le CONTREDIRE (une sentinelle « 0000-00-00 » ou une date illisible ne prouve ni ne contredit)
        const candV1 = freres.filter(l => normalesVues.has(l.idProduct) && !vus.has(l.idProduct));
        if (!freres.length) item.v1Motif = 'aucun-frere';
        else if (candV1.length !== 1) item.v1Motif = candV1.length ? 'plusieurs-v1-dans-la-liste' : 'aucun-frere-dans-la-liste-des-v1-vus';
        else {
            const L1 = candV1[0], id1 = L1.idProduct, d1 = dates.get(id1), d2 = dates.get(f.idProduct);
            if (idsReleve.has(id1)) item.v1Motif = 'designe-par-le-releve';
            else if (etiquettes.has(id1)) item.v1Motif = `etiquette-lue-sur-la-vignette : ${etiquettes.get(id1)}`;
            else if (L1.variante != null && L1.variante !== 'normale') item.v1Motif = `variante-contraire : ${L1.variante}`;
            else if (dateReelle(d1) && dateReelle(d2) && !(new Date(d1) < new Date(d2))) item.v1Motif = 'date-contredit';
            else item.v1 = { _id: L1._id, idProduct: id1, avant: L1.variante ?? null, preuve: PREUVE_NORMALE, deja: L1.variante === 'normale' && L1.variantePreuve === PREUVE_NORMALE };
        }
        // l'entrée servie : seulement si la séparation est prouvée des deux côtés ET qu'aucun autre produit ne partage la fiche
        const autres = freres.filter(l => !(item.v1 && l.idProduct === item.v1.idProduct) && !item.freresVus.some(x => x.idProduct === l.idProduct)).map(l => l.idProduct);
        item.autres = autres;
        if (!item.v1) item.entreeMotif = `v1-non-prouve : ${item.v1Motif}`;
        else if (autres.length) item.entreeMotif = `autres-produits-sur-la-fiche : ${autres.join('+')}`;
        else {
            const c = parCarte.get(L2.carteId);
            const es = (c?.images || []).filter(e => e && e.set === L2.slugSet && e.numero != null && cleNumero(e.numero) === nf(L2));
            if (es.length !== 1) item.entreeMotif = es.length ? 'entree-ambigue' : 'entree-introuvable';
            else {
                // plusieurs tampons DISTINCTS sur la même entrée (Frosmoth : 4 places) : leurs libellés joints par « / » (ruling proposé)
                const e = es[0], cible = [...new Set([f.variante, ...item.freresVus.map(x => x.variante)])].map(libelleTampon).join(' / ');
                if (e.partageeTamponNonSepare === true || e.produitsPartages !== undefined || e.partageeHoloNonHolo === true) item.entreeMotif = 'entree-deja-marquee';
                else if (e.tamponNonRepresente !== undefined && e.tamponNonRepresente !== cible) item.entreeMotif = `tampon-inattendu : ${e.tamponNonRepresente}`;
                else item.entree = { carteId: c._id, set: e.set, cleR2: e.cleR2, avant: { partageeTamponNonSepare: e.partageeTamponNonSepare ?? null, tamponNonRepresente: e.tamponNonRepresente ?? null }, cible, deja: e.partageeTamponNonSepare === false && e.tamponNonRepresente === cible };
            }
        }
        items.push(item);
    }
    // les documents `images` de ces entrées : ceux qui ne servent QUE cette entrée
    const cles = [...new Set(items.filter(i => i.entree).map(i => i.entree.cleR2))];
    const docs = cles.length ? await cartesDb.collection('images').find({ cleR2: { $in: cles } }).toArray() : [];
    const portees = cles.length ? await cartesDb.collection('cartes').find({ 'images.cleR2': { $in: cles } }, { projection: { images: 1 } }).toArray() : [];
    for (const i of items.filter(x => x.entree)) {
        const e = i.entree, memes = docs.filter(d => d.cleR2 === e.cleR2);
        const autres = portees.flatMap(x => (x.images || []).filter(m => m && m.cleR2 === e.cleR2).map(m => ({ c: x._id, s: m.set }))).filter(m => !(m.c === e.carteId && m.s === e.set));
        if (!memes.length) i.docMotif = 'document-absent';
        else if (memes.length > 1 || autres.length || memes[0].set !== e.set || memes[0].carteId !== e.carteId) i.docMotif = 'document-partage';
        else {
            const d = memes[0];
            if (d.partageeTamponNonSepare === true || d.produitsPartages !== undefined) i.docMotif = 'document-deja-marque';
            else i.doc = { _id: d._id, avant: { partageeTamponNonSepare: d.partageeTamponNonSepare ?? null, tamponNonRepresente: d.tamponNonRepresente ?? null }, deja: d.partageeTamponNonSepare === false && d.tamponNonRepresente === e.cible };
        }
    }
    // les corrections de liste fermée : « normale » -> variante tamponnée, SEULEMENT si la valeur d'avant est exactement celle de la table
    const corr = [];
    if (corrections.length) {
        const lc = await cartesDb.collection('cartes_produits').find({ idProduct: { $in: corrections.map(c => c.idProduct) } }).toArray();
        const cc = await cartesDb.collection('cartes').find({ _id: { $in: [...new Set(lc.map(l => l.carteId))] } }, { projection: { images: 1 } }).toArray();
        for (const c of corrections) {
            const non = motif => refus.push({ idProduct: c.idProduct, variante: c.vers, motif: `correction : ${motif}` });
            const ls = lc.filter(l => l.idProduct === c.idProduct);
            if (ls.length !== 1) { non(ls.length ? 'lignes-multiples' : 'produit-sans-ligne'); continue; }
            const L = ls[0], deja = L.variante === c.vers && !!L.variantePreuve;
            if (c.set != null && L.slugSet !== c.set) { non(`set-different : ${L.slugSet}`); continue; }
            if (c.numero != null && cleNumero(L.numeroFiche) !== cleNumero(c.numero)) { non(`numero-different : ${L.numeroFiche}`); continue; }
            if (!deja && L.variante !== c.de) { non(`valeur-d-avant-inattendue : ${L.variante ?? 'absente'}`); continue; }
            // l'entrée d'image : NON modifiée, seulement listée pour le coordinateur
            const imgs = (cc.find(x => x._id === L.carteId)?.images || []).filter(e => e && e.set === L.slugSet && e.numero != null && cleNumero(e.numero) === nf(L));
            corr.push({ idProduct: c.idProduct, nom: c.nom, set: L.slugSet, _id: L._id, avant: L.variante ?? null, avantPreuve: L.variantePreuve ?? null, vers: c.vers, preuve: c.preuve, deja,
                entreesNonModifiees: imgs.map(e => ({ set: e.set, cleR2: e.cleR2, source: e.source ?? null, tamponNonRepresente: e.tamponNonRepresente ?? null, partageeTamponNonSepare: e.partageeTamponNonSepare ?? null })) });
        }
    }
    const parMotif = {}; for (const r of refus) { const k = r.motif.split(' : ')[0]; parMotif[k] = (parMotif[k] || 0) + 1; }
    const comptes = { fiches: fiches.length, corrections: corr.length, items: items.length, refus: refus.length, parMotif, v2: items.length, v1: items.filter(i => i.v1).length, entrees: items.filter(i => i.entree).length, documents: items.filter(i => i.doc).length,
        entreesNonEcrites: items.filter(i => !i.entree).length };
    return { items, corrections: corr, refus, comptes };
}

const verifierAttendu = (attendu, n) => { if (attendu !== undefined && attendu !== null && attendu !== n) throw new Error(`--attendu=${attendu} mais ${n} fiche(s)/correction(s) prouvée(s) : rien n'est écrit`); };

/** Ce que l'écriture change, champ par champ (pour la sauvegarde ET le comptage). */
function operations(plan) {
    const lignes = [], entrees = [], docs = [];
    for (const i of plan.items) {
        if (!i.v2.deja) lignes.push({ _id: i.v2._id, idProduct: i.idProduct, avant: i.v2.avant, ecrit: { variante: i.v2.variante, variantePreuve: i.v2.preuve } });
        if (i.v1 && !i.v1.deja) lignes.push({ _id: i.v1._id, idProduct: i.v1.idProduct, avant: i.v1.avant, ecrit: { variante: 'normale', variantePreuve: i.v1.preuve } });
        for (const x of i.freresVus || []) if (!x.deja) lignes.push({ _id: x._id, idProduct: x.idProduct, avant: x.avant, ecrit: { variante: x.variante, variantePreuve: x.preuve } });
        if (i.entree && !i.entree.deja) entrees.push({ carteId: i.entree.carteId, set: i.entree.set, cleR2: i.entree.cleR2, avant: i.entree.avant, ecrit: { partageeTamponNonSepare: false, tamponNonRepresente: i.entree.cible } });
        if (i.doc && !i.doc.deja) docs.push({ _id: i.doc._id, cleR2: i.entree.cleR2, avant: i.doc.avant, ecrit: { partageeTamponNonSepare: false, tamponNonRepresente: i.entree.cible } });
    }
    for (const c of plan.corrections || []) if (!c.deja) lignes.push({ _id: c._id, idProduct: c.idProduct, avant: c.avant, avantPreuve: c.avantPreuve, correction: true, ecrit: { variante: c.vers, variantePreuve: c.preuve } });
    return { lignes, entrees, docs };
}

/**
 * Pose les champs. `ecrire: false` : l'essai à blanc rend les comptes. `attendu` OBLIGATOIRE à l'écriture, refuse AVANT toute écriture. La SAUVEGARDE (`sauvegarder(objet)`) est appelée AVANT la première écriture.
 * Additif sauf pour une ligne déjà marquée (jamais réécrite : refus au plan) ; idempotent.
 */
async function appliquer(cartesDb, plan, { ecrire = false, attendu, sauvegarder = null } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre de fiches lu à l\'essai à blanc) : rien n\'est écrit');
    verifierAttendu(attendu, plan.items.length + (plan.corrections || []).length);
    const op = operations(plan);
    const r = { fiches: plan.items.length, corrections: (plan.corrections || []).length, lignes: op.lignes.length, entrees: op.entrees.length, documents: op.docs.length, dejaFait: !op.lignes.length && !op.entrees.length && !op.docs.length };
    if (!ecrire) return r;
    if (typeof sauvegarder !== 'function') throw new Error('l\'écriture exige une sauvegarde préalable (sauvegarder) : rien n\'est écrit');
    if (!r.dejaFait) await sauvegarder({ le: new Date().toISOString(), ...op });
    for (const l of op.lignes) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: l._id }, { $set: l.ecrit });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne cartes_produits introuvable ou inchangée : ${l._id} — arrêt (rejouer : idempotent)`);
    }
    for (const e of op.entrees) {
        const set = Object.fromEntries(Object.entries(e.ecrit).map(([k, v]) => [`images.$[e].${k}`, v]));
        const res = await cartesDb.collection('cartes').updateOne({ _id: e.carteId }, { $set: set }, { arrayFilters: [{ 'e.set': e.set, 'e.cleR2': e.cleR2 }] });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`entrée introuvable ou inchangée : carte ${e.carteId}, ${e.set}, ${e.cleR2} — arrêt (rejouer : idempotent)`);
    }
    for (const d of op.docs) {
        const res = await cartesDb.collection('images').updateOne({ _id: d._id }, { $set: d.ecrit });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`document images introuvable ou inchangé : ${d._id} — arrêt (rejouer : idempotent)`);
    }
    return r;
}

/**
 * Restaure depuis une sauvegarde : chaque champ retrouve sa valeur d'AVANT (absente = `$unset`), SEULEMENT s'il porte encore la valeur écrite par ce lot ; un champ changé depuis est laissé et listé.
 * `ecrire: false` : compte seulement.
 */
async function restaurer(cartesDb, sauvegarde, { ecrire = false, attendu } = {}) {
    const total = sauvegarde.lignes.length + sauvegarde.entrees.length + sauvegarde.docs.length;
    if (attendu !== undefined && attendu !== null && attendu !== total) throw new Error(`--attendu=${attendu} mais la sauvegarde contient ${total} opération(s) : rien n'est restauré`);
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> : rien n\'est restauré');
    const r = { total, restaurees: 0, changeesDepuis: [] };
    const inverse = (avant, ecrit, pre = '') => { const set = {}, unset = {}; for (const k of Object.keys(ecrit)) { if (avant[k] === null || avant[k] === undefined) unset[pre + k] = ''; else set[pre + k] = avant[k]; } return { set, unset }; };
    const maj = async (col, filtre, avant, ecrit, actuel, options, pre, nom) => {
        if (!actuel || Object.keys(ecrit).some(k => JSON.stringify(actuel[k] ?? null) !== JSON.stringify(ecrit[k]))) { r.changeesDepuis.push(nom); return; }
        if (!ecrire) { r.restaurees++; return; }
        const { set, unset } = inverse(avant, ecrit, pre);
        const upd = {}; if (Object.keys(set).length) upd.$set = set; if (Object.keys(unset).length) upd.$unset = unset;
        const res = await cartesDb.collection(col).updateOne(filtre, upd, options);
        if (!res.matchedCount) throw new Error(`restauration : ${nom} introuvable — arrêt`);
        r.restaurees++;
    };
    for (const l of sauvegarde.lignes) {
        const cur = (await cartesDb.collection('cartes_produits').find({ idProduct: l.idProduct }).toArray()).find(x => x._id === l._id);
        await maj('cartes_produits', { _id: l._id }, { variante: l.avant, variantePreuve: l.avantPreuve ?? null }, l.ecrit, cur, undefined, '', `ligne ${l._id}`);
    }
    for (const e of sauvegarde.entrees) {
        const c = (await cartesDb.collection('cartes').find({ _id: { $in: [e.carteId] } }, { projection: { images: 1 } }).toArray())[0];
        const cur = (c?.images || []).find(x => x && x.set === e.set && x.cleR2 === e.cleR2);
        await maj('cartes', { _id: e.carteId }, e.avant, e.ecrit, cur, { arrayFilters: [{ 'e.set': e.set, 'e.cleR2': e.cleR2 }] }, 'images.$[e].', `entrée ${e.carteId} ${e.set}`);
    }
    for (const d of sauvegarde.docs) {
        const cur = (await cartesDb.collection('images').find({ cleR2: { $in: [d.cleR2] } }).toArray()).find(x => x._id === d._id);
        await maj('images', { _id: d._id }, d.avant, d.ecrit, cur, undefined, '', `document ${d._id}`);
    }
    return r;
}

module.exports = { JETONS, SEULS, AFFICHAGE, COLONNES, FICHES, DATE_RELEVE, lireCsv, NORMALES_VUES, PREUVE_NORMALE, dateReelle, CORRECTIONS, listeDesCorrections, CORRECTIONS_VUES, listeDesCorrectionsVues, varianteValide, libelleTampon, jetonsDeEtiquette, listeDesFiches, construirePlan, operations, appliquer, restaurer };

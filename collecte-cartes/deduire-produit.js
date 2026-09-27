// ============================================================
// UN PRODUIT CARDMARKET SANS IMAGE : son lien et son titre, et l'idProduct DÉDUIT — une définition, pour l'outil du journal
// (apprendre-journal.js), la migration (migrer-deductions-journal.js) et le serveur (/api/apprendre-lot, /api/apprendre) — §21 bis
// ============================================================
// 🔴 LE CAS (testeur, 2026-09-26, journal 1.8) : l'userscript lit l'idProduct dans l'URL de l'IMAGE de la vignette. Une vignette
// « cardImageNotAvailable » n'en a pas, et le produit était ÉCARTÉ — alors que son LIEN porte le slug (« /Sun-Moon/Shiinotic-V2-SUM17 »)
// et son TITRE le numéro (« Lampignon (SUM 17) »). 218 produits dans un seul journal.
// 🔑 TOUT EST LU CHEZ CARDMARKET SAUF L'idProduct, et lui seul se déduit :
//   · l'EXPANSION : le slugSet du lien, porté par nos produits déjà appris d'UNE seule expansion (l'appelant la résout) ;
//   · le PRODUIT : parmi les produits de cette expansion SANS slug appris, hors ceux du lot en cours, celui dont le nom anglais
//     s'écrit comme la tête du slug (Cardmarket fabrique le slug depuis le nom) — UN seul ;
//   · le NUMÉRO : celui du titre, dont les chiffres doivent être ceux que `numeroDepuisSlug` (scoring.js, la règle du serveur, jamais
//     une copie) tire du slug — `comparerNumeros` (scoring.js) : « PHF 17P » et « PHF17P » (→ 17) concordent.
// 🔴 ET UNE DÉDUCTION NE DOIT JAMAIS POUVOIR VOLER LE SLUG D'UN AUTRE PRODUIT (relecture par sous-agent, 2026-09-26 soir : trois cas
// reproduits avec le vrai module — un lien V1 dont le frère appris porte déjà V1, un lien V3 pour une famille de deux, un lien V2
// pour un seul produit : les trois étaient attribués). Refusent donc, AVANT tout le reste :
//   · un slug déjà porté par un produit appris — de l'expansion OU D'AILLEURS (`slugsPortes`, seconde relecture : la garde globale ne
//     vivait que dans l'outil et la migration, la route ne voyait que les lignes de l'expansion ; une ligne apprise d'un produit
//     absent du catalogue a `idExpansion: null` et lui échappait) ;
//   · une expansion dont le CATALOGUE EST PROUVÉ EN RETARD (`horsCatalogue`, seconde relecture) : une ligne apprise de l'expansion
//     porte un idProduct que le catalogue n'a pas — le vrai produit de la vignette peut y manquer aussi, et le seul homonyme non
//     appris serait pris (« Pikachu-SVI200 » attribué au n°25) ;
//   · un lien SANS variante quand plusieurs produits portent ce nom ;
//   · un lien AVEC variante Vk quand un frère appris porte déjà Vk, quand k dépasse la taille de la famille, ou quand un frère appris
//     porte un slug SANS variante (seconde relecture : « Pikachu-SMP081 » appris quand il était seul, lien « Pikachu-V1-SMP081 » —
//     c'est lui, renommé, et la vignette partait vers l'autre produit) ;
//   · des frères appris à d'autres numéros, sauf si leurs variantes, avec celle du lien, font exactement V1…Vn.
// Une déduction n'est JAMAIS « exacte » : `certitude: 'deduite'`, `source: 'cardmarket-deduit'`, `preuveDeduction`. Une vraie lecture
// (l'idProduct de l'image, ou l'extension) la réécrit toujours et retire les marques de déduction (`majLectureExacte`).
const { decomposerNomCardmarket, cleNumero, estCarteCode } = require('./jointure');
const { numeroDepuisSlug, comparerNumeros } = require('../scoring');

const plat = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/δ/g, ' ').replace(/['’.]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
// 🔴 SECONDE RELECTURE (2026-09-26, nuit) : `-(V\d+)-` exigeait un tiret APRÈS la variante. « Mewtwo-V-UNION-V3 » (la variante en FIN
// de slug, sans code de set derrière) rendait null, et avec une famille d'un produit la vignette était déduite. La variante est un
// JETON entier « Vk », où qu'il soit après le premier : suivi d'un tiret ou de la fin. « Pikachu-V-SWSH061 » (le « V » d'une carte V)
// n'en est pas une. C'est la SEULE définition : l'userscript n'envoie plus la sienne et le serveur recalcule (`normaliserCarte`).
const varianteDuSlug = slug => ((String(slug || '').match(/-(V\d+)(?=-|$)/i) || [])[1] || '').toUpperCase() || null;

/** Le lien et le titre d'une vignette → { href, slugSet, slug, variante, nomFr, code, numero } (la lecture de l'userscript, sans l'image). */
function lireVignette({ href, titre }) {
    const morceaux = String(href || '').split('/').filter(Boolean);
    const slug = (morceaux[morceaux.length - 1] || '').split('?')[0] || null;
    const slugSet = morceaux[morceaux.length - 2] || null;
    const t = String(titre || '').trim();
    const m = t.match(/\(([^)\s]+)\s+([^)\s]+)\)\s*$/);   // userscript-apprentissage.js, lecture du numéro du titre
    return { href: href ?? null, slugSet, slug, variante: varianteDuSlug(slug), nomFr: t.replace(/\s*\([^)]*\)\s*$/, '').trim() || null, code: m ? m[1] : null, numero: m ? m[2] : null };
}

/** La tête du slug : sans la variante « V2 » ni le jeton final « CODE+numéro ». Le jeton final part s'il est le code SUIVI d'un chiffre
 *  (au plus une lettre entre les deux : « AC3a272 »), ou le code suivi EXACTEMENT du numéro du titre (les Énergies de base :
 *  « CSVH3CFIG », titre « (CSVH3C FIG) ») ; « Professor-Shoji » sous le code « sH » garde son « Shoji ». */
function teteDuSlug(slug, code, numero = null) {
    const jetons = String(slug || '').split('-').filter(Boolean);
    const c = String(code || '').replace(/[^A-Za-z0-9]/g, '');
    const dernier = (jetons[jetons.length - 1] || '').replace(/[^A-Za-z0-9]/g, '');
    const n = String(numero || '').replace(/[^A-Za-z0-9]/g, '');
    if (c && jetons.length > 1 && (new RegExp(`^${c}[A-Za-z]?\\d`, 'i').test(dernier) || (n && dernier.toLowerCase() === `${c}${n}`.toLowerCase()))) jetons.pop();
    return jetons.filter(j => !/^V\d+$/i.test(j)).join('-').toLowerCase();
}

const cleDuSlug = (slugSet, slug) => `${slugSet}|${slug}`;
// « une ligne apprise de l'expansion » : son idExpansion, OU son slugSet (une ligne lue d'un produit absent du catalogue a
// `idExpansion: null`). UNE définition pour les outils qui lisent un tableau (apprendre-journal.js, migrer-deductions-journal.js) ;
// `lecteursMongo` en porte la forme requête, `{ $or: [{ idExpansion: e }, { slugSet: s }] }` — la même règle, relue ici en face.
const apprisDeLExpansion = (n, e, s) => (e != null && n.idExpansion === e) || (s != null && n.slugSet === s);

/**
 * Les vignettes sans image d'un JOURNAL exporté par l'userscript (apprendre-journal.js) : `detailEcartees` (1.8 : seule une image
 * « cardImageNotAvailable » vaut « sans image », toute autre image illisible reste de côté, comme dans l'userscript) ET
 * `detailSansImage` (1.9 : envoyées par leur lien — seconde relecture du 2026-09-26 : l'outil ne lisait que la première liste, et un
 * journal 1.9 ne lui aurait rien donné). Dédoublonnées par lien ; chaque source COMPTÉE à part.
 * @returns {{ pages: number, vignettes: object[], comptes: { detailEcartees: number, detailSansImage: number, autresImages: number, doublons: number } }}
 */
function vignettesDuJournal(journal) {
    const pages = Array.isArray(journal?.journal) ? journal.journal : [];
    const vues = new Map(), comptes = { detailEcartees: 0, detailSansImage: 0, autresImages: 0, doublons: 0, sansLien: 0 };
    const prendre = (e, origine) => {
        if (!e?.href) { comptes.sansLien++; return; }   // une vignette sans lien ne se déduit pas — mais elle se COMPTE
        if (origine === 'detailEcartees' && !(e.image || []).some(a => /cardImageNotAvailable/i.test(String(a)))) { comptes.autresImages++; return; }
        if (vues.has(e.href)) { comptes.doublons++; return; }
        comptes[origine]++;
        vues.set(e.href, { ...lireVignette(e), sansImage: true, origine });
    };
    for (const p of pages) {
        for (const e of p.detailEcartees || []) prendre(e, 'detailEcartees');
        for (const e of p.detailSansImage || []) prendre(e, 'detailSansImage');
    }
    return { pages: pages.length, vignettes: [...vues.values()], comptes };
}

/**
 * @param {object} v  lireVignette(…) (ou { slug, slugSet, code, numero }) — une `variante` passée ici est IGNORÉE : elle se relit du slug
 * @param {{ produits: {idProduct: number, name: string}[], appris: Map<number, {slug?: string, numero?: string}>, exclus?: Set<number>,
 *           slugsPortes: {has: (cle: string) => boolean}, horsCatalogue: number[] }} ctx
 *        `produits` : ceux de l'expansion (catalogue, hors cartes-code) ; `appris` : leurs lignes numeros_cartes ; `exclus` : les
 *        idProduct du lot en cours (lus avec leur image) — jamais candidats ; `slugsPortes` : les clés « slugSet|slug » que porte
 *        DÉJÀ un produit appris, toutes expansions ; `horsCatalogue` : les idProduct appris de l'expansion ABSENTS du catalogue.
 *        Les deux derniers sont OBLIGATOIRES : une garde qu'on oublie de passer ne doit pas se taire (§51).
 * @returns {{ idProduct: number|null, raison: string|null, exhaustion: boolean }}
 */
function deduireProduit(v, { produits, appris, exclus = new Set(), slugsPortes, horsCatalogue }) {
    const manque = [typeof slugsPortes?.has !== 'function' && 'slugsPortes', !Array.isArray(horsCatalogue) && 'horsCatalogue'].filter(Boolean);
    if (manque.length) throw new TypeError(`deduireProduit : contexte sans ${manque.join(' ni ')} — les gardes globales ne se sautent pas en silence`);
    const non = raison => ({ idProduct: null, raison, exhaustion: false });
    if (!v.slug || !v.slugSet) return non('lien sans slug');
    const porteur = [...appris].find(([, n]) => n?.slug === v.slug);
    if (porteur) return non(`le slug est déjà celui du produit ${porteur[0]}`);
    // (les parties variables d'une raison vont entre « » : la route agrège les raisons en les masquant, un slug nu ferait une clé par carte)
    if (slugsPortes.has(cleDuSlug(v.slugSet, v.slug))) return non(`le slug « ${v.slugSet}/${v.slug} » est déjà porté par un produit appris (toutes expansions)`);
    if (horsCatalogue.length) return non(`catalogue en retard pour cette expansion : ${horsCatalogue.length} produit(s) appris absent(s) du catalogue (« ${horsCatalogue.slice(0, 3).join(', ')}${horsCatalogue.length > 3 ? '…' : ''} ») — le vrai produit peut y manquer aussi`);
    const tete = teteDuSlug(v.slug, v.code, v.numero);
    const famille = produits.filter(p => plat(decomposerNomCardmarket(p.name).nom) === tete);
    if (!famille.length) return non(`aucun produit au nom « ${tete} »`);
    const freresAppris = famille.filter(p => appris.get(p.idProduct)?.slug).map(p => appris.get(p.idProduct));
    const variante = varianteDuSlug(v.slug);
    if (!variante && famille.length > 1) return non(`lien sans variante, ${famille.length} produits au nom « ${tete} »`);
    if (variante) {
        const k = Number(variante.slice(1));
        // 🔴 TROISIÈME RELECTURE (2026-09-26, nuit) : Cardmarket ne numérote V1…Vn que quand PLUSIEURS produits portent le nom, et le
        // rang n'était confronté à la famille que pour le LIEN. Or « Vk ⇒ au moins k produits du nom au catalogue » est faux en base
        // (505 slugs à variante dans une famille d'un produit, 487 rangs au-delà de leur famille) : le catalogue n'a pas toutes les
        // variantes, et le produit présent peut être celui d'une AUTRE. La famille doit pouvoir porter TOUS les rangs connus.
        if (!(k >= 1) || k > famille.length) return non(`variante ${variante} au-delà de la famille (${famille.length} produit(s) au nom « ${tete} »)`);
        if (famille.length < 2) return non(`lien à variante ${variante} et un seul produit au nom « ${tete} » au catalogue : la famille est incomplète, ses variantes ne se désignent pas`);
        const rangs = freresAppris.map(n => Number((varianteDuSlug(n.slug) || '').slice(1))).filter(r => r >= 1);
        if (rangs.some(r => r > famille.length)) return non(`la famille « ${tete} » est incomplète au catalogue : un frère appris porte « V${Math.max(...rangs)} » pour ${famille.length} produit(s)`);
        const sansVariante = freresAppris.filter(n => !varianteDuSlug(n.slug));
        if (sansVariante.length) return non(`la famille « ${tete} » mélange un lien à variante (V#) et un slug appris SANS variante (« ${sansVariante.map(n => n.slug).join(', ')} ») : ce produit a peut-être été renommé`);
        if (freresAppris.some(n => varianteDuSlug(n.slug) === variante)) return non(`la variante ${variante} est déjà portée par un frère appris`);
    }
    const cands = famille.filter(p => !appris.get(p.idProduct)?.slug && !exclus.has(p.idProduct));
    if (cands.length !== 1) return non(`${cands.length} produits non appris au nom « ${tete} »`);
    const numeroDuSlug = numeroDepuisSlug(v.slug, v.code);
    if (v.numero && numeroDuSlug != null && !comparerNumeros(v.numero, numeroDuSlug)) return non(`titre n°« ${v.numero} » ≠ numéro du slug « ${numeroDuSlug} »`);
    // Le numéro que le candidat porte DÉJÀ (sa ligne sans slug : tcgdex, cardmarket d'avant le slug) est le seul témoin en base d'un
    // numéro que la clé (le nom) n'a pas utilisé : le titre doit le dire EXACTEMENT, et le slug au moins par ses chiffres (chacun a
    // son cas de banc où il refuse SEUL : M2 et M3).
    const existe = appris.get(cands[0].idProduct);
    if (existe?.numero && v.numero && comparerNumeros(v.numero, existe.numero) !== 'exact') return non(`la ligne existante dit n°« ${existe.numero} », le titre n°« ${v.numero} »`);
    if (existe?.numero && numeroDuSlug != null && !comparerNumeros(existe.numero, numeroDuSlug)) return non(`la ligne existante dit n°« ${existe.numero} », le slug n°« ${numeroDuSlug} »`);
    let exhaustion = false;
    if (v.numero && freresAppris.some(n => n.numero && cleNumero(n.numero) !== cleNumero(v.numero))) {
        const variantes = freresAppris.map(n => varianteDuSlug(n.slug));
        const attendues = famille.map((_, i) => `V${i + 1}`);
        exhaustion = !!variante && !variantes.includes(null) && new Set(variantes).size === variantes.length && variantes.length === famille.length - 1 && [...variantes, variante].sort().join() === attendues.sort().join();
        if (!exhaustion) return non(`le nom porte d'autres numéros déjà appris (« ${[...new Set(freresAppris.map(n => n.numero))].join(', ')} ») et les variantes ne s'épuisent pas`);
    }
    return { idProduct: cands[0].idProduct, raison: null, exhaustion };
}

const LECTEURS_DU_LOT = ['expansionsDuSlugSet', 'produitsDe', 'apprisDe', 'slugsPortes', 'idsApprisDeLExpansion', 'idsAuCatalogue'];
/**
 * Un LOT de vignettes sans idProduct : les lecteurs sont injectés, pour que la route, l'outil du journal et le banc appellent la
 * même fonction (le serveur lit Mongo — `lecteursMongo` —, l'outil l'export et une lecture de numeros_cartes, le banc des tableaux).
 * @param {{slug: string, slugSet: string, codeSet?: string, numero?: string}[]} cartes
 * @param {{ expansionsDuSlugSet: (s: string) => Promise<number[]>, produitsDe: (e: number) => Promise<{idProduct: number, name: string}[]>,
 *           apprisDe: (ids: number[]) => Promise<Map<number, object>>, slugsPortes: (paires: [string, string][]) => Promise<Set<string>>,
 *           idsApprisDeLExpansion: (e: number, slugSet: string) => Promise<number[]>, idsAuCatalogue: (ids: number[]) => Promise<Set<number>>,
 *           exclus?: Set<number> }} deps  `produitsDe` peut rendre le catalogue BRUT : les cartes-code sont retirées ici (estCarteCode).
 * @returns {Promise<{ deduites: {carte, idProduct, idExpansion, exhaustion, numeroUrl}[], refus: {carte, raison}[], expansionsParSlugSet: Map<string, number[]> }>}
 */
async function deduireLot(cartes, deps) {
    const manque = LECTEURS_DU_LOT.filter(k => typeof deps?.[k] !== 'function');
    if (manque.length) throw new TypeError(`deduireLot : lecteur(s) manquant(s) ${manque.join(', ')} — les gardes ne se sautent pas en silence`);
    const deduites = [], refus = [], expansionsParSlugSet = new Map();
    const exclus = deps.exclus || new Set();
    const parSet = new Map(); for (const c of cartes) (parSet.get(c.slugSet) || parSet.set(c.slugSet, []).get(c.slugSet)).push(c);
    for (const [slugSet, cs] of parSet) {
        const exps = [...new Set((await deps.expansionsDuSlugSet(slugSet)).filter(x => x != null))];
        expansionsParSlugSet.set(slugSet, exps);
        if (exps.length !== 1) { for (const c of cs) refus.push({ carte: c, raison: `slugSet « ${slugSet} » porté par ${exps.length} expansions apprises` }); continue; }
        const produits = (await deps.produitsDe(exps[0])).filter(p => !estCarteCode(p.name));
        const appris = await deps.apprisDe(produits.map(p => p.idProduct));
        const slugsPortes = await deps.slugsPortes(cs.map(c => [c.slugSet, c.slug]));
        const idsAppris = [...new Set(await deps.idsApprisDeLExpansion(exps[0], slugSet))];
        const presents = idsAppris.length ? await deps.idsAuCatalogue(idsAppris) : new Set();
        const horsCatalogue = idsAppris.filter(id => !presents.has(id)).sort((a, b) => a - b);
        for (const c of cs) {
            const v = { slug: c.slug, slugSet: c.slugSet, code: c.codeSet ?? null, numero: c.numero ?? null };
            const d = deduireProduit(v, { produits, appris, exclus, slugsPortes, horsCatalogue });
            if (d.idProduct) deduites.push({ carte: c, idProduct: d.idProduct, idExpansion: exps[0], exhaustion: d.exhaustion, numeroUrl: numeroDepuisSlug(c.slug, c.codeSet) });
            else refus.push({ carte: c, raison: d.raison });
        }
    }
    // deux vignettes qui désignent le même produit : aucune ne le prend
    const n = new Map(); for (const d of deduites) n.set(d.idProduct, (n.get(d.idProduct) || 0) + 1);
    const gardees = deduites.filter(d => n.get(d.idProduct) === 1);
    for (const d of deduites.filter(x => n.get(x.idProduct) > 1)) refus.push({ carte: d.carte, raison: `${n.get(d.idProduct)} vignettes désignent le produit ${d.idProduct}` });
    return { deduites: gardees, refus, expansionsParSlugSet };
}

/**
 * L'ÉCRITURE d'une déduction, une définition pour la route et l'outil (§21 bis) — sur une collection du PILOTE MongoDB (la route passe
 * `NumeroCarte.collection`, le banc une collection de test_scratch) :
 *   · aucune ligne : `$setOnInsert` d'une ligne neuve, `source: 'cardmarket-deduit'`, `certitude: 'deduite'` ;
 *   · une ligne SANS slug : ses champs VIDES seulement, et elle devient `certitude: 'deduite'` (quelle que soit sa source) — pour
 *     qu'une vraie lecture puisse la réécrire ; son numéro, s'il existe, a déjà été vérifié égal à celui du titre ;
 *   · une ligne AVEC slug : rien (le filtre d'écriture le garantit aussi, entre la lecture et l'écriture).
 * 🔴 SECONDE RELECTURE : une exception au milieu laissait des lignes écrites pendant que la route répondait « 0 déduite ». Chaque ligne
 * est UNE écriture (atomique) ; la fonction ne lève plus : elle s'arrête à la première erreur et dit exactement ce qui a été écrit
 * (`ecrites`), ce qui ne l'a pas été faute d'effet (`sansEffet`, avec sa raison), l'erreur, et ce qui n'a pas été tenté.
 * 🔴 ET LA LIGNE DIT CE QUE LA DÉDUCTION Y A MIS (`champsDeduits`, et sur une ligne complétée `certitudeAvantDeduction`) : une vraie
 * lecture ne retirait que « les champs du lien » en bloc, et effaçait avec eux un `nomFr` LU avant la déduction (Palafin ex 805545,
 * `cardmarket`, nomFr « Superdofin-ex », sans slug — relecture par sous-agent). Elle ne retire plus que ce que la déduction a écrit.
 * @returns {Promise<{ inserees: number, completees: number, ecrites: object[], sansEffet: {d, raison}[], erreur: {idProduct, message}|null, nonTentees: object[] }>}
 */
async function appliquerDeductions(deduites, collection, { origine = 'vignette sans image (userscript 1.9)', le = new Date() } = {}) {
    let inserees = 0, completees = 0;
    const ecrites = [], sansEffet = [];
    for (let i = 0; i < deduites.length; i++) {
        const d = deduites[i];
        try {
            const c = d.carte, numero = c.numero != null ? String(c.numero) : null;
            const champs = { slug: c.slug, slugSet: c.slugSet, numeroUrl: d.numeroUrl != null ? String(d.numeroUrl) : null, nomFr: c.nomFr || null, variante: varianteDuSlug(c.slug) };
            const preuveDeduction = `${origine} : lien …/${c.slugSet}/${c.slug}, titre n°${numero ?? '—'} ; idProduct DÉDUIT : seul produit non appris de l'expansion ${d.idExpansion} au nom du slug${d.exhaustion ? ', seule variante que ses frères appris ne portent pas' : ''} · collecte-cartes/deduire-produit.js`;
            const existe = await collection.findOne({ idProduct: d.idProduct }, { projection: { slug: 1, numero: 1, numeroUrl: 1, nomFr: 1, variante: 1, slugSet: 1, codeSet: 1, certitude: 1 } });
            if (!existe) {
                const ecrits = { numero, codeSet: c.codeSet || null, ...champs };
                const w = await collection.updateOne({ idProduct: d.idProduct }, { $setOnInsert: { idProduct: d.idProduct, idExpansion: d.idExpansion, ...ecrits,
                    // une ligne INSÉRÉE doit tout ce qu'elle porte à la déduction, nuls compris (`variante: null` est écrit aussi)
                    source: 'cardmarket-deduit', certitude: 'deduite', preuveDeduction, champsDeduits: Object.keys(ecrits), apprisLe: le } }, { upsert: true });
                if (w.upsertedCount) { inserees++; ecrites.push({ ...d, ecriture: 'inseree' }); } else sansEffet.push({ d, raison: 'une ligne est apparue entre la lecture et l\'écriture' });
            } else if (!existe.slug) {
                const vides = Object.fromEntries(Object.entries({ ...champs, numero, codeSet: c.codeSet || null }).filter(([k, val]) => val != null && (existe[k] == null || existe[k] === '')));
                const w = await collection.updateOne({ idProduct: d.idProduct, slug: { $in: [null, ''] } }, { $set: { ...vides, certitude: 'deduite', preuveDeduction, deduitLe: le,
                    champsDeduits: Object.keys(vides), certitudeAvantDeduction: existe.certitude ?? null } });
                if (w.modifiedCount) { completees++; ecrites.push({ ...d, ecriture: 'completee' }); } else sansEffet.push({ d, raison: 'la ligne a reçu un slug entre la lecture et l\'écriture' });
            } else sansEffet.push({ d, raison: `la ligne porte déjà le slug « ${existe.slug} »` });
        } catch (e) {
            return { inserees, completees, ecrites, sansEffet, erreur: { idProduct: d.idProduct, message: e.message }, nonTentees: deduites.slice(i + 1) };
        }
    }
    return { inserees, completees, ecrites, sansEffet, erreur: null, nonTentees: [] };
}

// ── LE PENDANT : UNE VRAIE LECTURE (l'idProduct de l'image, ou l'extension) — /api/apprendre-lot et /api/apprendre, une définition
/** Une ligne existante se réécrit par une vraie lecture si elle n'est pas `cardmarket`, OU si elle porte une déduction. */
// (écrit par ce qu'il AUTORISE, §51 — revue du 2026-09-27 : seule une ligne LUE chez Cardmarket, exacte ou d'avant le champ, est gardée)
const estLueChezCardmarket = e => !!e && e.source === 'cardmarket' && (e.certitude == null || e.certitude === 'exacte');
const aReecrireParLecture = existant => !estLueChezCardmarket(existant);
const estDeduite = existant => !!existant && (existant.certitude === 'deduite' || existant.source === 'cardmarket-deduit');
// Les champs qu'une déduction tire du LIEN et du TITRE d'une vignette dont l'idProduct n'était pas lu : sur une ligne déduite, une vraie
// lecture qui ne les relit pas les RETIRE — un slug ne se garde que s'il est LU (seconde relecture : /api/apprendre, qui ne lit que le
// numéro et le code, rendait « exacte » une ligne qui gardait le slug déduit).
const CHAMPS_DU_LIEN = ['slug', 'slugSet', 'variante', 'numeroUrl', 'nomFr'];
/** Ce que la déduction a écrit sur une ligne : `champsDeduits` quand elle le dit (depuis la relecture par sous-agent) ; à défaut, une
 *  ligne INSÉRÉE par la déduction (`cardmarket-deduit` : les 171 du journal) doit tout au lien et au titre ; une ligne complétée d'avant
 *  ce champ (aucune en base le 2026-09-26, mesuré) doit à coup sûr à la déduction son slug et ce qui en dérive (variante, numeroUrl) —
 *  elle n'était complétée que faute de slug —, mais pas son slugSet ni son nomFr, qu'une vraie lecture a pu poser avant. */
const champsDeduitsDe = existant => Array.isArray(existant?.champsDeduits) ? existant.champsDeduits
    : existant?.source === 'cardmarket-deduit' ? [...CHAMPS_DU_LIEN, 'codeSet'] : ['slug', 'variante', 'numeroUrl'];
/**
 * La mise à jour d'une vraie lecture : les champs LUS, `cardmarket` / `exacte`, et les marques de déduction RETIRÉES
 * (`preuveDeduction`, `deduitLe`, `preuveJournal`, `champsDeduits`, `certitudeAvantDeduction`). Un champ `undefined` n'est pas lu : il
 * n'est pas écrit (le pilote écrirait null) — sauf, sur une ligne déduite (`existant`), un champ que la DÉDUCTION a écrit
 * (`champsDeduitsDe`), qui est retiré : un slug ne se garde que s'il est LU, et un nomFr lu AVANT la déduction ne se perd pas.
 * Écrite par le PILOTE (`NumeroCarte.collection`) : le schéma strict de mongoose AVALAIT les `$unset` de `deduitLe` et `preuveJournal`
 * (seconde relecture, reproduit sur test_scratch).
 */
function majLectureExacte(c, { idExpansion, codeSet, existant = null, le = null } = {}) {
    const lus = {
        idProduct: Number(c.idProduct), idExpansion,
        numero: c.numero === undefined ? undefined : (c.numero != null ? String(c.numero) : null),
        numeroUrl: c.numeroUrl === undefined ? undefined : (c.numeroUrl != null ? String(c.numeroUrl) : null),
        codeSet,
        nomFr: c.nomFr === undefined ? undefined : (c.nomFr || null),
        variante: c.variante === undefined ? undefined : (c.variante || null),
        slug: c.slug === undefined ? undefined : (c.slug || null),
        slugSet: c.slugSet === undefined ? undefined : (c.slugSet || null)
    };
    const $set = Object.fromEntries(Object.entries(lus).filter(([, v]) => v !== undefined));
    $set.source = 'cardmarket'; $set.certitude = 'exacte';
    if (le) $set.apprisLe = le;
    const $unset = { preuveDeduction: '', deduitLe: '', preuveJournal: '', champsDeduits: '', certitudeAvantDeduction: '' };
    if (estDeduite(existant)) {
        for (const k of champsDeduitsDe(existant)) if ([...CHAMPS_DU_LIEN, 'codeSet'].includes(k) && !(k in $set)) $unset[k] = '';
        // 🔴 TROISIÈME RELECTURE (2026-09-26, nuit) : la vraie lecture du produit déduit réécrivait la ligne EN SILENCE — la précision
        // de la déduction ne se mesurait nulle part. La ligne garde ce que la déduction avait dit et ce que la lecture dit ; chaque
        // champ n'est jugé que s'il est LU des deux côtés (/api/apprendre ne lit pas le slug).
        // un slug LU absent (null : vignette sans lien) ne juge rien — il ne contredit pas la déduction (revue du 2026-09-27)
        const jugeSlug = $set.slug != null && existant.slug != null, jugeNum = $set.numero != null && existant.numero != null;
        const slugOk = !jugeSlug || ($set.slug === existant.slug && ($set.slugSet === undefined || existant.slugSet == null || $set.slugSet === existant.slugSet));
        const numOk = !jugeNum || cleNumero($set.numero) === cleNumero(existant.numero);
        $set.deductionRelue = { le: le || new Date(), slugDeduit: existant.slug ?? null, numeroDeduit: existant.numero ?? null,
            slugLu: $set.slug ?? null, numeroLu: $set.numero ?? null, juge: [jugeSlug && 'slug', jugeNum && 'numero'].filter(Boolean), concorde: slugOk && numOk };
    }
    return { $set, $unset };
}

/**
 * /api/apprendre (l'extension lit en direct UN idProduct, son numéro et son code) — la même règle que le lot : une ligne `cardmarket`
 * EXACTE se confirme ou refuse ; toute autre (heuristique, tcgdex, DÉDUITE même `cardmarket`) est réécrite par `majLectureExacte`.
 * @returns {Promise<{dejaExacte?: true, refuse?: string, existant?: object, ecrit?: true, reecritDeduite?: boolean}>}
 */
async function apprendreUneLecture({ idProduct, idExpansion, numero, codeSet }, { numeros, le = new Date() }) {
    // Le pilote ne caste rien : les casts que mongoose faisait sont écrits ici (relecture par sous-agent). `idExpansion` absent n'est
    // pas écrit (mongoose le taisait ; le pilote écrirait null) ; « » et null valent null (et non 0) ; un nombre illisible n'est pas
    // écrit. `codeSet` est une chaîne (0 → « 0 », comme le cast String de mongoose). Un numéro qui n'est ni chaîne ni nombre LÈVE —
    // mongoose levait un CastError, et la route répond « erreur serveur » sans rien écrire.
    if (typeof numero !== 'string' && typeof numero !== 'number') throw new TypeError(`apprendreUneLecture : numéro de type ${typeof numero}`);
    const exp = idExpansion === undefined ? undefined : (idExpansion === null || idExpansion === '') ? null : (Number.isFinite(Number(idExpansion)) ? Number(idExpansion) : undefined);
    codeSet = codeSet == null ? codeSet : String(codeSet);
    const existant = await numeros.findOne({ idProduct }, { projection: { source: 1, certitude: 1, numero: 1, codeSet: 1, idExpansion: 1, champsDeduits: 1, slug: 1, slugSet: 1 } });
    if (existant && !aReecrireParLecture(existant)) {
        const identique = String(existant.numero ?? '') === String(numero)
            && String(existant.codeSet ?? '') === String(codeSet ?? '')
            && (exp == null || existant.idExpansion == null || Number(existant.idExpansion) === exp);
        return identique ? { dejaExacte: true } : { refuse: 'ligne-exacte-existante', existant };
    }
    const maj = majLectureExacte({ idProduct, numero: String(numero) }, { idExpansion: exp, codeSet, existant, le });
    await numeros.updateOne({ idProduct }, maj, { upsert: true });
    return { ecrit: true, reecritDeduite: estDeduite(existant), ...(maj.$set.deductionRelue ? { deductionRelue: maj.$set.deductionRelue } : {}) };
}

// ── LE LOT DE L'USERSCRIPT — /api/apprendre-lot, une définition pour la route ET le banc (test-deduction-ecritures-scratch.js)
// 🔴 SECONDE RELECTURE : la route écrivait par mongoose ce que le banc écrivait par le pilote, et sa branche « lot sans aucune carte lue »
// n'était exercée par personne. Tout le lot vit ici, sur des collections du PILOTE ; la route ne garde que ses gardes d'entrée (userId,
// Mongo prêt, lot non vide) et `memoriserCodeSet` (codes_set, injecté).
const chaine = x => (typeof x === 'string' ? x : (typeof x === 'number' && Number.isFinite(x) ? String(x) : null));
/** Une carte du client, NORMALISÉE : le client ne décide ni du numeroUrl ni de la variante (tous deux relus du slug, une seule règle),
 *  et le pilote ne caste rien — un champ qui n'est pas une chaîne n'entre pas (mongoose aurait levé un CastError). */
function normaliserCarte(brute) {
    const c = brute && typeof brute === 'object' ? brute : {};
    const id = (typeof c.idProduct === 'number' || typeof c.idProduct === 'string') ? Number(c.idProduct) : NaN;
    const slug = (chaine(c.slug) || '').split('?')[0] || null;
    const codeSet = chaine(c.codeSet) || null;
    return { idProduct: Number.isInteger(id) && id > 0 ? id : null, numero: chaine(c.numero) || null, codeSet, nomFr: chaine(c.nomFr) || null,
        slug, slugSet: chaine(c.slugSet) || null, numeroUrl: numeroDepuisSlug(slug, codeSet), variante: varianteDuSlug(slug), sansImage: c.sansImage === true };
}

/** Les lecteurs de la déduction sur Mongo (pilote) : ceux de la route, et ceux que le banc exerce. */
function lecteursMongo({ numeros, catalogue }) {
    return {
        expansionsDuSlugSet: s => numeros.distinct('idExpansion', { slugSet: s, idExpansion: { $ne: null } }),
        produitsDe: e => catalogue.find({ idExpansion: e }, { projection: { _id: 0, idProduct: 1, name: 1 } }).toArray(),
        apprisDe: async ids => new Map((await numeros.find({ idProduct: { $in: ids } }, { projection: { _id: 0, idProduct: 1, slug: 1, numero: 1 } }).toArray()).map(d => [d.idProduct, d])),
        slugsPortes: async paires => {
            const cles = new Set(paires.map(([s, g]) => cleDuSlug(s, g)));
            const docs = await numeros.find({ slugSet: { $in: [...new Set(paires.map(p => p[0]))] }, slug: { $in: [...new Set(paires.map(p => p[1]))] } }, { projection: { _id: 0, slug: 1, slugSet: 1 } }).toArray();
            return new Set(docs.map(d => cleDuSlug(d.slugSet, d.slug)).filter(k => cles.has(k)));
        },
        // « les lignes apprises de l'expansion » : son idExpansion, OU son slugSet — une ligne lue d'un produit absent du catalogue est
        // écrite `idExpansion: null` (la route le lit au catalogue) et n'est reconnaissable que par son slugSet.
        idsApprisDeLExpansion: (e, s) => numeros.distinct('idProduct', { $or: [{ idExpansion: e }, { slugSet: s }] }),
        idsAuCatalogue: async ids => new Set(await catalogue.distinct('idProduct', { idProduct: { $in: ids } }))
    };
}

/** La COUVERTURE d'une expansion (renvoyée au client). */
async function couvertureDe(idExpansion, { numeros, catalogue }) {
    const idsExp = (await catalogue.find({ idExpansion: Number(idExpansion) }, { projection: { _id: 0, idProduct: 1 } }).toArray()).map(x => x.idProduct);
    const avecNumero = idsExp.length ? await numeros.countDocuments({ idProduct: { $in: idsExp }, numero: { $type: 'string', $ne: '' } }) : 0;
    const appris = idsExp.length ? await numeros.countDocuments({ idProduct: { $in: idsExp } }) : 0;
    return { produits: idsExp.length, avecNumero, appris, pourcent: idsExp.length ? Math.round(100 * avecNumero / idsExp.length) : null };
}

/** Les vignettes sans image d'un lot : la déduction, son écriture, et un compte rendu EXACT. Ne lève jamais : un échec se dit
 *  (`erreur`), il ne fait pas tomber les cartes lues. `deduites` et `idsDeduits` ne comptent que ce qui a été ÉCRIT. */
async function deduireEtEcrire(sansId, exclus, { numeros, catalogue, decoderCodeSet, journal = console, le = new Date(), expansionsDuSlugSet = null }) {
    const res = { deduites: 0, nonDeduites: 0, raisons: {}, idsDeduits: [], ecritures: null, erreur: null };
    if (!sansId.length) return res;
    const compter = raison => { const k = String(raison).replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#'); res.raisons[k] = (res.raisons[k] || 0) + 1; };
    let r;
    try {
        const cartesSans = sansId.map(c => ({ ...c, codeSet: decoderCodeSet(c.codeSet) || null }));
        const lecteurs = lecteursMongo({ numeros, catalogue });
        r = await deduireLot(cartesSans, { ...lecteurs, ...(expansionsDuSlugSet ? { expansionsDuSlugSet } : {}), exclus });
    } catch (e) {
        journal.error(`❌ [apprendre-lot] déduction des ${sansId.length} vignette(s) sans image : ${e.message} (rien d'écrit)`);
        res.nonDeduites = sansId.length; res.raisons = { 'erreur du serveur pendant la déduction (rien d\'écrit)': sansId.length };
        res.erreur = 'déduction impossible (voir la console du serveur) — rien n\'a été écrit';
        return res;
    }
    const w = await appliquerDeductions(r.deduites, numeros, { le });
    for (const x of r.refus) compter(x.raison);
    for (const x of w.sansEffet) compter(x.raison);
    if (w.erreur) { compter('erreur du serveur à l\'écriture'); for (let i = 0; i < w.nonTentees.length; i++) compter('non tentée : l\'écriture s\'est arrêtée sur une erreur'); }
    res.deduites = w.ecrites.length;
    res.nonDeduites = sansId.length - res.deduites;
    res.idsDeduits = w.ecrites.map(d => ({ idProduct: d.idProduct, slug: d.carte.slug, slugSet: d.carte.slugSet }));
    res.ecritures = { inserees: w.inserees, completees: w.completees };
    if (w.erreur) {
        res.erreur = `écriture interrompue au produit ${w.erreur.idProduct} : ${res.deduites} ligne(s) écrite(s), ${w.nonTentees.length} non tentée(s) (voir la console du serveur)`;
        journal.error(`❌ [apprendre-lot] ${res.erreur} — ${w.erreur.message}`);
    }
    journal.log(`🖼️ [apprendre-lot] ${sansId.length} vignette(s) sans image : ${res.deduites} déduite(s) et écrite(s) (${w.inserees} insérées, ${w.completees} complétées), ${res.nonDeduites} non déduite(s) ${JSON.stringify(res.raisons)}`);
    return res;
}

/**
 * /api/apprendre-lot, APRÈS ses gardes d'entrée. Règle de priorité des cartes LUES (avec leur idProduct) :
 *  - déjà `cardmarket` exacte -> INTACTE (seuls ses champs vides slug/slugSet/nomFr/variante sont complétés) ;
 *  - heuristique, tcgdex, sans source, ou DÉDUITE -> réécrite par `majLectureExacte` (la vraie lecture fait foi) ;
 *  - absente -> insérée.
 * Puis les vignettes sans image (déduction), leurs idProduct du lot EXCLUS des candidats. L'EXPANSION de la réponse vient du catalogue
 * des cartes lues ; à défaut (lot fait seulement de vignettes sans image, ou de produits absents du catalogue), du SLUGSET de la page —
 * seconde relecture : une page de sans-image toutes refusées n'avait pas d'expansion et n'était jamais « parcourue ».
 * @returns {Promise<object>} le corps de la réponse (sans `success`)
 */
async function apprendreLot(cartesBrutes, { numeros, catalogue, decoderCodeSet, memoriserCodeSet, journal = console, userId = '?', le = new Date() }) {
    const manque = Object.entries({ numeros, catalogue, decoderCodeSet, memoriserCodeSet }).filter(([, v]) => !v).map(([k]) => k);
    if (manque.length) throw new TypeError(`apprendreLot : ${manque.join(', ')} manquant(s)`);
    const cartes = cartesBrutes.map(normaliserCarte);
    let numeroUrlRecalcules = 0, variantesRecalculees = 0;
    cartesBrutes.forEach((b, i) => {
        if (String(cartes[i].numeroUrl ?? '') !== String(b?.numeroUrl ?? '')) numeroUrlRecalcules++;
        if (b && b.variante !== undefined && String(cartes[i].variante ?? '') !== String(b.variante ?? '')) variantesRecalculees++;
    });
    if (numeroUrlRecalcules || variantesRecalculees) journal.log(`🔧 [apprendre-lot] ${numeroUrlRecalcules}/${cartes.length} numeroUrl et ${variantesRecalculees} variante(s) envoyée(s) recalculés depuis le slug — la règle du serveur fait foi.`);

    // Lisibles = un idProduct ET (un numéro, titre ou URL, OU un slug) ; sans image = pas d'idProduct, un lien de produit et la marque.
    const lisibles = cartes.filter(c => c.idProduct && (c.numero || c.numeroUrl || c.slug));
    // les sans-image ont leur propre compte (déduites / non déduites) : les compter ici faisait dire au panneau « appris par leur slug »
    // pour des vignettes refusées (troisième relecture)
    const sansNumero = cartes.filter(c => !c.sansImage && !(c.numero || c.numeroUrl)).length;
    const sansId = cartes.filter(c => !c.idProduct && c.sansImage && c.slug && c.slugSet);
    const ignorees = cartes.length - lisibles.length - sansId.length;
    const ids = [...new Set(lisibles.map(c => c.idProduct))];

    // L'idExpansion est LU PAR CARTE au catalogue (2026-09-06) ; un idProduct inconnu du catalogue garde `null`.
    const expParId = new Map();
    if (ids.length) for (const r of await catalogue.find({ idProduct: { $in: ids } }, { projection: { _id: 0, idProduct: 1, idExpansion: 1 } }).toArray()) if (r.idExpansion != null) expParId.set(Number(r.idProduct), Number(r.idExpansion));
    const expCatalogue = [...new Set(expParId.values())];
    if (expCatalogue.length > 1) journal.warn(`⚠️ [apprendre-lot] userId=${userId} : lot sur ${expCatalogue.length} expansions (${expCatalogue.join(', ')}) — chaque carte garde la sienne.`);

    let nouvelles = 0, ameliorees = 0, dejaExactes = 0, completees = 0;
    const deductionsRelues = { confirmees: 0, contredites: [] };
    if (ids.length) {
        const existants = await numeros.find({ idProduct: { $in: ids } }, { projection: { _id: 0, idProduct: 1, source: 1, certitude: 1, slug: 1, slugSet: 1, nomFr: 1, variante: 1, champsDeduits: 1, numero: 1 } }).toArray();
        const existantParId = new Map(existants.map(d => [d.idProduct, d]));
        const aEcrire = [], aCompleter = [];
        for (const c of lisibles) {
            const ex = existantParId.get(c.idProduct);
            if (!ex) { aEcrire.push(c); nouvelles++; }
            else if (aReecrireParLecture(ex)) { aEcrire.push(c); ameliorees++; }
            else {
                // 🔑 2026-09-24 : « INTACT » NE VEUT PAS DIRE « INCOMPLET À VIE » — les champs VIDES d'une ligne exacte se complètent.
                dejaExactes++;
                const manquants = {};
                for (const champ of ['slug', 'slugSet', 'nomFr', 'variante']) if (!ex[champ] && c[champ]) manquants[champ] = c[champ];
                if (Object.keys(manquants).length) aCompleter.push({ id: c.idProduct, manquants });
            }
        }
        if (aCompleter.length) {
            // Le filtre porte la source ET la certitude : une ligne devenue autre chose entre la lecture et l'écriture n'est pas touchée.
            // (par ce qu'il AUTORISE, §51 : une ligne LUE — la même règle que `estLueChezCardmarket` ; `null` couvre aussi le champ absent)
            await numeros.bulkWrite(aCompleter.map(({ id, manquants }) => ({ updateOne: { filter: { idProduct: id, source: 'cardmarket', certitude: { $in: [null, 'exacte'] } }, update: { $set: manquants } } })), { ordered: false });
        }
        completees = aCompleter.length;
        if (aEcrire.length) {
            const majs = aEcrire.map(c => majLectureExacte(c, { idExpansion: expParId.get(c.idProduct) ?? null, codeSet: decoderCodeSet(c.codeSet) || null, existant: existantParId.get(c.idProduct) || null }));
            await numeros.bulkWrite(aEcrire.map((c, i) => ({ updateOne: { filter: { idProduct: c.idProduct }, update: majs[i], upsert: true } })), { ordered: false });
            // la précision de la déduction, relue par les vraies lectures de ce lot (écrite aussi sur chaque ligne : `deductionRelue`)
            majs.forEach((m, i) => { const r = m.$set.deductionRelue; if (!r) return; if (r.concorde) deductionsRelues.confirmees++; else deductionsRelues.contredites.push({ idProduct: aEcrire[i].idProduct, deduit: { slug: r.slugDeduit, numero: r.numeroDeduit }, lu: { slug: r.slugLu, numero: r.numeroLu } }); });
            if (deductionsRelues.contredites.length) journal.warn(`⚠️ [apprendre-lot] userId=${userId} : ${deductionsRelues.contredites.length} ligne(s) DÉDUITE(S) contredite(s) par la vraie lecture du MÊME produit (réécrites par la lecture) : ${JSON.stringify(deductionsRelues.contredites)}`);
            // Le code de set, PAR EXPANSION : le premier code porté par une carte de chaque expansion du lot.
            const codeParExp = new Map();
            for (const c of aEcrire) { const e = expParId.get(c.idProduct); if (e != null && c.codeSet && !codeParExp.has(e)) codeParExp.set(e, c.codeSet); }
            for (const [e, cs] of codeParExp) await memoriserCodeSet(e, cs);
        }
    }

    // 🔴 RELECTURE PAR SOUS-AGENT : une carte LUE avec son image qui porte le slugSet|slug d'une ligne DÉDUITE d'un AUTRE produit prouve
    // cette déduction fausse — un slug désigne une seule page produit chez Cardmarket. C'est le risque résiduel du point 5 réalisé
    // (un produit neuf, absent du catalogue, dont le slug a été attribué au seul homonyme non appris) : sans cela, deux lignes porteraient
    // le même slug et la ligne fausse garderait le numéro de l'autre. On la DIT (réponse `deductionsContredites`, console) ; défaire la
    // ligne déduite est un DÉTACHEMENT, et un détachement attend le feu vert du testeur.
    const deductionsContredites = [];
    const luesAvecSlug = lisibles.filter(c => c.slug && c.slugSet);
    if (luesAvecSlug.length) {
        const lecteurDe = new Map(luesAvecSlug.map(c => [cleDuSlug(c.slugSet, c.slug), c.idProduct]));
        const docs = await numeros.find({ certitude: 'deduite', slugSet: { $in: [...new Set(luesAvecSlug.map(c => c.slugSet))] }, slug: { $in: [...new Set(luesAvecSlug.map(c => c.slug))] } },
            { projection: { _id: 0, idProduct: 1, slug: 1, slugSet: 1 } }).toArray();
        for (const d of docs) { const par = lecteurDe.get(cleDuSlug(d.slugSet, d.slug)); if (par != null && par !== d.idProduct) deductionsContredites.push({ idProduct: d.idProduct, par, slug: `${d.slugSet}/${d.slug}` }); }
        if (deductionsContredites.length) journal.warn(`⚠️ [apprendre-lot] userId=${userId} : ${deductionsContredites.length} déduction(s) CONTREDITE(S) par une vraie lecture (même slug, autre produit) — à détacher sur feu vert : ${JSON.stringify(deductionsContredites)}`);
    }

    // Les vignettes sans image, APRÈS l'écriture des cartes lues — leurs idProduct exclus des candidats. L'expansion d'un slugSet n'est
    // lue qu'une fois (elle sert aussi à la réponse).
    const lecteurs = lecteursMongo({ numeros, catalogue });
    const memo = new Map();
    const expansionsDuSlugSet = async s => { if (!memo.has(s)) memo.set(s, [...new Set((await lecteurs.expansionsDuSlugSet(s)).filter(x => x != null))]); return memo.get(s); };
    // exclus : TOUT idProduct lu sur la page, écrit ou non (une carte à idProduct sans numéro ni slug est ignorée, mais elle est là :
    // une vignette sans image n'est pas elle — troisième relecture)
    const deduction = await deduireEtEcrire(sansId, new Set(cartes.filter(c => c.idProduct).map(c => c.idProduct)), { numeros, catalogue, decoderCodeSet, journal, le, expansionsDuSlugSet });

    let idExpansions = expCatalogue;
    if (!idExpansions.length) {
        const parSlugSet = [];
        for (const s of new Set(cartes.filter(c => c.slugSet && (c.idProduct || c.sansImage)).map(c => c.slugSet))) { const x = await expansionsDuSlugSet(s); if (x.length === 1) parSlugSet.push(x[0]); }
        idExpansions = [...new Set(parSlugSet)];
    }
    const idExpansion = idExpansions.length === 1 ? idExpansions[0] : null;
    // COUVERTURE DE L'EXPANSION : sans elle, l'utilisateur qui tourne les pages d'une galerie ne sait pas quand il a fini.
    const couverture = idExpansion != null ? await couvertureDe(idExpansion, { numeros, catalogue }) : null;
    journal.log(`🧠 [apprendre-lot] userId=${userId} ${nouvelles} nouv. / ${ameliorees} améliorées / ${dejaExactes} déjà exactes${completees ? ` dont ${completees} complétées (slug…)` : ''} (exp ${idExpansion ?? (idExpansions.length ? idExpansions.join('/') : '?')})`
        + (couverture ? ` — couverture ${couverture.avecNumero}/${couverture.produits} (${couverture.pourcent} %)` : ''));
    // `idExpansions`, `completees`, `deduites`/`nonDeduites`/`raisonsNonDeduites`/`erreurDeduction` : ADDITIFS (2026-09-06, 09-24, 09-26).
    // `idsDeduits` : ADDITIF (seconde relecture du 2026-09-26) — les produits DÉDUITS ET ÉCRITS, pour que l'userscript marque ses cibles.
    // `deductionsContredites` : ADDITIF (relecture par sous-agent) — les lignes déduites qu'une carte lue de ce lot prouve fausses.
    // `deductionsRelues` : ADDITIF (troisième relecture) — les lignes déduites que la vraie lecture du MÊME produit confirme ou contredit.
    return { recus: cartes.length, nouvelles, ameliorees, dejaExactes, completees, sansNumero, ignorees, idExpansion, idExpansions, couverture,
        deduites: deduction.deduites, nonDeduites: deduction.nonDeduites, raisonsNonDeduites: deduction.raisons, erreurDeduction: deduction.erreur, idsDeduits: deduction.idsDeduits,
        deductionsContredites, deductionsRelues };
}

module.exports = { lireVignette, vignettesDuJournal, teteDuSlug, deduireProduit, deduireLot, appliquerDeductions, aReecrireParLecture, majLectureExacte, apprendreUneLecture,
    apprendreLot, normaliserCarte, lecteursMongo, couvertureDe, plat, varianteDuSlug, cleDuSlug, apprisDeLExpansion, CHAMPS_DU_LIEN };

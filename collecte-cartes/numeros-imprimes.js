// ============================================================
// LE NUMÉRO IMPRIMÉ DES WCD ET DES PRIZE PACKS — afficher « n/total » TEL QU'IMPRIMÉ, preuve LUE sur la carte (décision du testeur, 2026-11-08)
// ============================================================
// Un deck WCD ou un Prize Pack réimprime une carte d'un autre tirage et IMPRIME le numéro de cette carte d'origine (« 113/131 »), sans mention du set de
// réimpression (10 scans lus à l'œil : INSTRUCTION.md § 3). Le site ne l'affiche pas : ces sets n'ont aucune impression sous leur nom (`bulba.expansion` nul
// ou synthétique), donc une fiche sans numéro. Le geste est celui de fiches-multi.js (sa relecture est réutilisée), dans un ordre SÛR À L'ARRÊT :
//   1. cartes.impressions : une impression par numéro d'origine distinct, `source: 'origine-lue'` (marque de conservation, impressions-posees.js, §59),
//      numéro et total TELS QU'IMPRIMÉS (lus), `preuveNumero` en clair (qui a lu, quand, quel scan, quel slug) ;
//   2. cartes_produits.numeroFiche (seulement s'il est absent ou nul) — APRÈS l'impression : un numeroFiche sans fiche fait disparaître le produit ;
//   3. sets.bulba.expansion (null -> `reimpressions/<slug>`), EN DERNIER (c'est l'interrupteur) et JAMAIS une valeur nulle (incident du 2026-10-06 :
//      une impression à expansion nulle s'affiche dans tout set sans nom) — `exigerNom` lève sur nul, vide, « null » ou non synthétique.
//   Un arrêt entre deux écritures laisse donc un état que le rejeu achève (« set seul » : cartes déjà faites, expansion encore vide).
//
// 🔑 LES MARQUEURS N'EXIGENT AUCUNE ÉCRITURE : l'API les DÉRIVE du slugSet (pokemon-proxy-api-v2/v2/identifier/marqueurs.js:147 `WCD-<aaaa>` -> WCD + NON_LEGAL,
// :148 `Play-Pokemon-Prize-Pack-Series-<X>` -> PLAY_POKEMON) ; le contrat est CONTRAT-MARQUEURS.md (v1.1, §4.1). Pour un WCD, le bandeau « NOT TOURNAMENT LEGAL »
// des scans est celui du VENDEUR, pas une marque de la carte : `marque` y vaut null (ou 'WCD'). Pour un Prize Pack, le tampon Play! Pokémon est lu : 'tampon' exigé.
//
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une lecture n'est retenue que si elle passe TOUTES les gardes de `jugerLecture` (clés connues seulement, `doute`
// vide) ; sinon elle est refusée et NOMMÉE. L'écriture est PAR CARTE : une carte s'écrit si TOUTES ses lignes du set sont lues, sans refus, avec la concordance à
// trois ; une carte non lue reste dans l'état actuel. Une carte multi-origine ne s'écrit que si ses images du set portent toutes un `numero` (sinon le site
// repasserait le set en « une fiche par document », documentAmbigu, lib/impressionsDuSet.ts:101). Puis la règle du site (importée) est rejouée sur le set ENTIER
// avant/après : la moindre perte (fiche, visuel), bascule, produit doublé / déplacé sur une autre carte ou hors de la fiche de son numéro bloque le set.
const { cleNumero } = require('./jointure');
const { decoderOrigine } = require('./set-partiel');
const { numeroComparable } = require('./numero-fiche');
const { estNomSynthetique, nomsBulbapedia } = require('./nom-synthetique');
const { lireInterdits, idLigne } = require('./lignes-detachees');
const FM = require('./fiches-multi');

const SOURCE = 'origine-lue';
/** La liste FERMÉE des familles de sets (le slug est ancré : « WCD-2009-x » n'en est pas), avec les marques de lecture admises. */
const FAMILLES = [
    { re: /^WCD-\d{4}$/, marques: [null, 'WCD'] },
    { re: /^Play-Pokemon-Prize-Pack-Series-[A-Za-z]+$/, marques: ['tampon'] }
];
const familleDe = slug => (typeof slug === 'string' ? FAMILLES.find(f => f.re.test(slug)) || null : null);
/** Les produits sans origine par construction (INSTRUCTION § 5.8) : jamais lus, jamais comptés dans la complétude d'une carte. */
const PREUVES_HORS_PERIMETRE = ['metacarte+nom+attaques'];
const CHAMPS = ['idProduct', 'carteId', 'set', 'numeroLu', 'cleR2', 'luPar', 'luLe'];
/** Les SEULES clés d'une lecture : tout le reste est refusé (garde par autorisation). */
const CLES_AUTORISEES = [...CHAMPS, 'totalLu', 'marque', 'produits', 'doute'];
const vide = v => v == null || String(v).trim() === '';
const compter = (o, k) => { o[k] = (o[k] || 0) + 1; };
const cle = (carteId, idProduct) => `${carteId}|${idProduct}`;

/** Le nom d'expansion écrit sur le set : jamais nul, vide ou « null », et TOUJOURS synthétique (qu'aucune page de carte n'écrit). */
function exigerNom(nom) {
    if (typeof nom !== 'string' || nom.trim() === '' || /^null$/i.test(nom.trim()) || !estNomSynthetique(nom))
        throw new Error(`le nom d'expansion à écrire sur le set est invalide (${JSON.stringify(nom)}) : jamais nul, vide ni « null », toujours « reimpressions/<slug> » — arrêt`);
    return nom;
}

/** Un numéro imprimé : « 113 », « 097 », « SM104 », « 7a » ; jamais vide, « null », ni « DPBP#… ». */
const numeroValide = s => typeof s === 'string' && /^[A-Za-z]{0,5}\d{1,4}[A-Za-z]?$/.test(s) && !/DPBP/i.test(s) && !/^(null|undefined|nan)$/i.test(s);
const totalValide = s => s === null || (typeof s === 'string' && /^\d{1,4}$/.test(s));
const texte = v => (v == null ? null : String(v).trim());
/** Deux numéros donnent-ils la même fiche pour le site (cleNumero OU numeroComparable) ? */
const clesDe = n => [cleNumero(n), numeroComparable(n)].filter(Boolean);
const numerosSeRecouvrent = (a, b) => clesDe(a).some(k => clesDe(b).includes(k));

/**
 * Une lecture peut couvrir PLUSIEURS produits (`produits: [idProduct, …]`, avec ou sans `idProduct`) : une lecture par produit en sort, `produits` retiré.
 * Une entrée qui n'est pas un objet, ou sans aucun produit, passe telle quelle (elle sera refusée par jugerLecture).
 */
function developper(lectures) {
    const out = [];
    for (const x of lectures) {
        if (!x || typeof x !== 'object' || Array.isArray(x)) { out.push(x); continue; }
        const { produits, ...reste } = x;
        if (produits !== undefined && !Array.isArray(produits)) { out.push(x); continue; }   // `produits` mal formé : refusé tel quel
        const ids = new Set();
        if (x.idProduct != null) ids.add(x.idProduct);
        for (const p of produits || []) ids.add(p && typeof p === 'object' ? p.idProduct : p);
        if (!ids.size) { out.push(x); continue; }
        for (const id of ids) out.push({ ...reste, idProduct: id });
    }
    return out;
}

/**
 * Pur. Le verdict sur UNE lecture (un produit). `carte` : le document de la carte (ou undefined), `ligne` : la ligne cartes_produits (carte|produit) ou undefined,
 * `interdits` : le Set « carte|produit » des lignes détachées par le testeur, `expsDuCode` : Map code d'origine -> Set des noms d'expansion de ce code.
 * Rend { ok: true, numero, total, origine } ou { ok: false, cause, detail }.
 */
function jugerLecture({ lecture: x, set, carte, ligne, interdits, expsDuCode }) {
    const refus = (cause, detail) => ({ ok: false, cause, detail });
    if (!x || typeof x !== 'object' || Array.isArray(x)) return refus('lecture-incomplete', 'entrée qui n\'est pas un objet');
    const inconnues = Object.keys(x).filter(k => !CLES_AUTORISEES.includes(k));
    if (inconnues.length) return refus('cle-inconnue', `clé(s) non autorisée(s) : ${inconnues.join(', ')} (autorisées : ${CLES_AUTORISEES.join(', ')})`);
    if (!vide(x.doute)) return refus('doute-non-leve', `le lecteur a noté un doute : « ${x.doute} » — un doute est un trou`);
    for (const k of CHAMPS) if (vide(x[k])) return refus('lecture-incomplete', `champ « ${k} » absent ou vide`);
    if (!('totalLu' in x) || x.totalLu === undefined) return refus('lecture-incomplete', 'champ « totalLu » absent (null si la carte n\'imprime pas de total)');
    const fam = familleDe(set?._id);
    if (!fam) return refus('set-hors-liste', `« ${set?._id} » n'est pas un set WCD-<aaaa> ni Play-Pokemon-Prize-Pack-Series-<X>`);
    const marque = x.marque === undefined ? null : x.marque;
    if (!fam.marques.includes(marque)) return refus('marque-incoherente', `la lecture dit ${JSON.stringify(x.marque)}, le set ${set._id} admet ${JSON.stringify(fam.marques)}`);
    const numero = texte(x.numeroLu), total = x.totalLu == null ? null : texte(x.totalLu);
    if (!numeroValide(numero)) return refus('numero-invalide', `numéro lu « ${numero} » : ni vide, ni « null », ni « DPBP#… », ni une forme de numéro imprimé`);
    if (!totalValide(total)) return refus('total-invalide', `total lu « ${total} » : un nombre, ou null`);
    if (!carte || !(carte.sets || []).includes(set._id)) return refus('carte-hors-set', `la carte ${x.carteId} n'est pas une carte de ${set._id}`);
    if (interdits.has(idLigne(x.carteId, x.idProduct))) return refus('ligne-detachee', `la ligne ${idLigne(x.carteId, x.idProduct)} a été détachée par le testeur (fiche-contredite-par-la-vue) : jamais reposée`);
    if (!ligne) return refus('ligne-absente', `aucune ligne ${idLigne(x.carteId, x.idProduct)} dans ${set._id} : l'outil ne crée aucune ligne`);
    if (ligne.slugSet !== set._id) return refus('ligne-hors-du-set', `la ligne porte le slugSet « ${ligne.slugSet} »`);
    const d = decoderOrigine(ligne.slug, set.code);
    if (!d) return refus('origine-non-decodee', `le slug « ${ligne.slug} » ne porte pas de code et de numéro d'origine sous « ${set.code} »`);
    // la concordance à TROIS : le numéro LU = le numéro du slug = le numéro de l'impression d'origine (dans l'EXPANSION du code du slug) de la carte, total compris
    if (cleNumero(numero) !== cleNumero(d.num)) return refus('numero-lu-contredit-slug', `lu ${numero}, le slug « ${ligne.slug} » dit ${d.code} n°${d.num}`);
    const exps = expsDuCode?.get(d.code);
    if (!exps || !exps.size) return refus('code-origine-inconnu', `le code d'origine « ${d.code} » ne désigne aucune expansion connue : l'impression d'origine ne peut pas être identifiée`);
    const tirage = set.tirage ?? set.region;
    const origines = (carte.impressions || []).filter(i => i && i.tirage === tirage && exps.has(i.expansion) && !vide(i.numero)).map(i => {
        const [n, t] = String(i.numero).split('/');
        return { numero: n.trim(), total: i.total != null ? String(i.total).trim() : (t != null ? t.trim() : null), expansion: i.expansion };
    }).filter(o => cleNumero(o.numero) === cleNumero(d.num));
    if (!origines.length) return refus('slug-sans-impression-d-origine', `le slug dit ${d.code} n°${d.num} : aucune impression de la carte ${x.carteId} dans ${[...exps].join(' / ')} ne porte ce numéro`);
    if (!origines.some(o => cleNumero(o.total ?? '') === cleNumero(total ?? ''))) return refus('total-discordant', `total lu ${total ?? 'aucun'}, les impressions d'origine au n°${d.num} disent ${origines.map(o => o.total ?? 'aucun').join(' / ')}`);
    if (!(carte.images || []).some(m => m && m.set === set._id && m.cleR2 === x.cleR2)) return refus('cle-r2-absente', `le scan « ${x.cleR2} » n'est pas dans les images de la carte ${x.carteId} pour ${set._id}`);
    return { ok: true, numero, total, origine: d };
}

/** La simulation du site sur un état (docs, lignes) : les produits sur une fiche, les produits dont le visuel est servi. */
function evaluer(deps, set, docs, lignes) {
    const F = deps.fichesDesProduits(deps.regle, set, docs, lignes), tir = set.tirage ?? set.region, parId = new Map(docs.map(d => [d._id, d]));
    const servi = new Set();
    for (const l of lignes) {
        const f = F.fiche.get(l.idProduct);
        if (!f || f.carteId !== l.carteId) continue;
        const entrees = (parId.get(l.carteId)?.images || []).filter(e => e && e.set === set._id && e.cleR2);
        if (deps.imageDeLImpression(entrees.filter(e => deps.refusDuVisuel(e, tir) === null), f.numero) !== null) servi.add(l.idProduct);
    }
    return { F, servi };
}

/** Code d'origine -> noms d'expansion Bulbapedia (non synthétiques) des sets de ce code, au tirage donné. */
async function expansionsDesCodes(db, tirage) {
    const m = new Map();
    for (const s of await db.collection('sets').find({}).toArray()) {
        if (!s.code || (s.tirage ?? s.region) !== tirage) continue;
        const noms = nomsBulbapedia(s);
        if (!noms.length) continue;
        if (!m.has(s.code)) m.set(s.code, new Set());
        for (const n of noms) m.get(s.code).add(n);
    }
    return m;
}

/** La simulation d'UN set : jugement des lectures, plans par carte, puis la règle du site sur le set entier. */
async function analyserSet({ db, deps, slug, lectures, interdits }) {
    const S = { slug, statut: 'ok', lectures: lectures.length, refus: [], parCause: {}, aEcrire: 0, nImpressions: 0, deja: 0, dejaIds: [], dejaLues: 0, sansLecture: 0, setSeul: false, plans: [], docs: 0, lignes: 0 };
    const refuser = (cause, detail, extra = {}) => { S.refus.push({ cause, detail, ...extra }); compter(S.parCause, cause); };
    if (!familleDe(slug)) {   // la base n'est même pas ouverte pour un set hors de la liste fermée
        S.statut = 'hors-liste';
        for (const x of lectures) refuser('set-hors-liste', `« ${slug} » n'est pas un set WCD-<aaaa> ni Play-Pokemon-Prize-Pack-Series-<X>`, { idProduct: x?.idProduct });
        return S;
    }
    const L = await FM.lireSet(db, slug);
    if (!L) { S.statut = 'absent'; return S; }
    const { set, docs, lignes } = L, nom = FM.expansionDe(slug), { regle } = deps, tirage = set.tirage ?? set.region;
    S.nom = nom; S.docs = docs.length; S.lignes = lignes.length; S.L = L;
    const expsDuCode = await expansionsDesCodes(db, tirage);
    const carteDe = new Map(docs.map(d => [d._id, d]));
    const ligneDe = new Map(lignes.map(l => [cle(l.carteId, l.idProduct), l]));

    // ── 1. chaque lecture est jugée (clé = carte|produit : une ligne d'une autre carte n'hérite jamais d'une lecture) ; deux lectures de la même ligne se refusent toutes les deux ──
    const parLigne = new Map();
    for (const x of lectures) { const k = cle(x?.carteId, x?.idProduct); (parLigne.get(k) || parLigne.set(k, []).get(k)).push(x); }
    const retenues = new Map(), vues = new Set(), carteRefusee = new Set();
    for (const [k, xs] of parLigne) {
        vues.add(k);
        if (xs.length > 1) { for (const x of xs) refuser('lecture-en-double', `la ligne ${k} est lue ${xs.length} fois`, { idProduct: x?.idProduct, carteId: x?.carteId }); carteRefusee.add(xs[0]?.carteId); continue; }
        const x = xs[0];
        const j = jugerLecture({ lecture: x, set, carte: carteDe.get(x?.carteId), ligne: ligneDe.get(k), interdits, expsDuCode });
        if (!j.ok) { refuser(j.cause, j.detail, { idProduct: x?.idProduct, carteId: x?.carteId }); carteRefusee.add(x?.carteId); continue; }
        retenues.set(k, { x, j });
    }
    const carteDesLectures = new Set(lectures.map(x => x?.carteId));
    const refuserCarte = (cause, detail, carteId) => { refuser(cause, detail, { carteId }); carteRefusee.add(carteId); };

    // ── 2. un plan par carte du set : une carte s'écrit si TOUTES ses lignes sont lues et retenues ; sinon elle reste dans l'état actuel ──
    const parCarte = new Map();
    for (const l of lignes) (parCarte.get(l.carteId) || parCarte.set(l.carteId, []).get(l.carteId)).push(l);
    for (const [carteId, ls] of [...parCarte].sort((a, b) => a[0] - b[0])) {
        const carte = carteDe.get(carteId), perim = ls.filter(l => !PREUVES_HORS_PERIMETRE.includes(l.preuve));
        if (!perim.length) continue;
        const existantes = (carte.impressions || []).filter(i => i && i.expansion === nom);
        const sansNumeroFiche = perim.filter(l => vide(l.numeroFiche));
        if (!carteDesLectures.has(carteId)) {
            if (existantes.length && !sansNumeroFiche.length) { S.deja++; S.dejaIds.push(carteId); }   // écrite par ailleurs (lot MULTI), fiches posées
            else S.sansLecture++;                                                                       // reste dans l'état actuel
            continue;
        }
        if (carteRefusee.has(carteId)) continue;   // une lecture refusée : déjà nommée plus haut
        const manque = perim.filter(l => !vues.has(cle(l.carteId, l.idProduct)));
        if (manque.length) { refuserCarte('ligne-sans-lecture', `carte ${carteId} « ${carte.nomEn} » : ${manque.length} ligne(s) sans lecture (${manque.map(l => l.idProduct).slice(0, 5).join(', ')})`, carteId); continue; }
        // les origines distinctes de la carte (par cleNumero) : même total, même code d'origine
        const groupes = new Map();
        for (const l of perim) {
            const { x, j } = retenues.get(cle(l.carteId, l.idProduct)), k = cleNumero(j.numero);
            if (!groupes.has(k)) groupes.set(k, { numero: j.numero, total: j.total, codes: new Set(), lectures: [], lignes: [] });
            const g = groupes.get(k); g.codes.add(j.origine.code); g.lectures.push(x); g.lignes.push(l);
            if (g.total !== j.total) g.totalIncoherent = true;
        }
        const gs = [...groupes.values()];
        const incoherent = gs.find(g => g.totalIncoherent || g.codes.size > 1);
        if (incoherent) { refuserCarte(incoherent.codes.size > 1 ? 'deux-origines-meme-numero' : 'total-lu-incoherent', `carte ${carteId} : le n°${incoherent.numero} est lu avec des totaux ou des codes d'origine différents (${[...incoherent.codes].join('/')})`, carteId); continue; }
        let recouvre = null;
        for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) if (numerosSeRecouvrent(gs[i].numero, gs[j].numero)) recouvre = [gs[i].numero, gs[j].numero];
        if (recouvre) { refuserCarte('deux-origines-meme-numero', `carte ${carteId} : ${recouvre.join(' et ')} donnent le même numéro de fiche`, carteId); continue; }
        if (gs.length > 1) {   // une carte multi-origine : ses images du set portent toutes un numero (sinon documentAmbigu)
            const sansNum = (carte.images || []).filter(m => m && m.set === set._id && numeroComparable(m.numero) === '');
            if (sansNum.length) { refuserCarte('images-sans-numero', `carte ${carteId} « ${carte.nomEn} » : ${gs.length} origines et ${sansNum.length} image(s) du set sans numero (documentAmbigu)`, carteId); continue; }
        }
        // l'ordre des impressions : celui de liens.idProduct de la carte, puis le plus petit idProduct
        const position = id => { const i = (carte.liens?.idProduct || []).indexOf(id); return i < 0 ? Infinity : i; };
        const rang = g => [Math.min(...g.lignes.map(l => position(l.idProduct))), Math.min(...g.lignes.map(l => l.idProduct))];
        gs.sort((a, b) => { const p = rang(a), q = rang(b); return (p[0] === q[0] ? 0 : p[0] < q[0] ? -1 : 1) || p[1] - q[1]; });
        const impressions = gs.map(g => {
            const x = g.lectures[0], l0 = g.lignes[0];
            return { tirage, expansion: nom, deck: null, numero: g.numero, total: g.total, rarete: null, source: SOURCE,
                preuveNumero: `numéro et total lus sur le scan ${x.cleR2} par ${x.luPar} le ${x.luLe} ; slug ${l0.slug} -> tirage d'origine ${[...g.codes][0]} n°${g.numero}` };
        });
        // un numeroFiche '' (chaîne vide) : le filtre `numeroFiche: null` ne le voit pas, l'écriture échouerait à mi-set -> refus nommé
        const nfVides = perim.filter(l => l.numeroFiche != null && String(l.numeroFiche).trim() === '');
        if (nfVides.length) { refuserCarte('numeroFiche-vide', `carte ${carteId} : ${nfVides.length} ligne(s) avec un numeroFiche vide ('') que le filtre d'écriture ne voit pas (${nfVides.map(l => l._id).slice(0, 3).join(', ')})`, carteId); continue; }
        const numeros = new Map();
        let contredit = null;
        for (const g of gs) for (const l of g.lignes) {
            if (vide(l.numeroFiche)) numeros.set(l._id, g.numero);
            else if (numeroComparable(l.numeroFiche) !== numeroComparable(g.numero)) contredit = `${l._id} : numeroFiche « ${l.numeroFiche} » ≠ le numéro lu ${g.numero}`;
        }
        if (contredit) { refuserCarte('numeroFiche-contredit', contredit, carteId); continue; }
        const produitOrigine = new Map(gs.flatMap(g => g.lignes.map(l => [l.idProduct, g.numero])));
        if (existantes.length) {
            const memes = existantes.length === impressions.length && existantes.every(e => e.source === SOURCE) && impressions.every(p => existantes.some(e => numeroComparable(e.numero) === numeroComparable(p.numero)));
            if (memes && !numeros.size) { S.deja++; S.dejaIds.push(carteId); S.dejaLues++; continue; }
            // l'impression est posée (arrêt entre l'impression et les numeroFiche) : le rejeu ACHÈVE les numeroFiche, sans réécrire l'impression
            if (memes) { S.plans.push({ carteId, impressions: [], numeros, produitOrigine }); continue; }
            refuserCarte('etat-partiel', `carte ${carteId} : ${existantes.length} impression(s) « ${nom} » déjà là (autre source ou autres numéros) : l'état ne se lit ni comme fait ni comme à faire`, carteId);
            continue;
        }
        S.plans.push({ carteId, impressions, numeros, produitOrigine });
    }

    // ── 3. rien à écrire, ou « set seul » (cartes déjà faites, expansion encore vide : un arrêt entre les deux ne bloque jamais le set) ──
    const posee = set.bulba?.expansion;
    const bloque = (statut, detail) => { S.statut = statut; S.detail = detail; S.aEcrireBrut = S.aEcrire; S.aEcrire = 0; S.nImpressionsBrut = S.nImpressions; S.nImpressions = 0; S.setSeul = false; return S; };
    if (!S.plans.length) {
        if (S.dejaLues > 0 && vide(posee)) S.setSeul = true;
        else { S.statut = 'rien'; return S; }
    }
    S.aEcrire = S.plans.length; S.nImpressions = S.plans.reduce((n, p) => n + p.impressions.length, 0);
    if (!vide(posee) && posee !== nom) return bloque('refuse-expansion-posee', `bulba.expansion vaut déjà ${JSON.stringify(posee)} : jamais écrasée`);
    const attendus = new Set([...S.plans.map(p => p.carteId), ...S.dejaIds, ...docs.map(d => d._id)]);
    const declarants = (await db.collection('cartes').find({ 'impressions.expansion': nom }, { projection: { _id: 1 } }).toArray()).map(c => c._id).filter(id => !attendus.has(id));
    if (declarants.length) return bloque('refuse-nom-declare', `${declarants.length} carte(s) étrangère(s) au set déclarent déjà « ${nom} » (${declarants.slice(0, 5).join(', ')})`);
    S.nom = exigerNom(nom);

    // ── 4. la règle du site (importée) rejouée sur le set entier, avant / après ──
    const avant = evaluer(deps, set, docs, lignes);
    S.servisAvant = avant.F.fiche.size; S.doublesAvant = avant.F.doubles; S.visuelsAvant = avant.servi.size;
    const numeros = new Map(S.plans.flatMap(p => [...p.numeros]));
    const docs2 = docs.map(d => { const p = S.plans.find(x => x.carteId === d._id); return p ? { ...d, impressions: [...(d.impressions || []), ...structuredClone(p.impressions)] } : d; });
    const lignes2 = lignes.map(l => (numeros.has(l._id) ? { ...l, numeroFiche: numeros.get(l._id) } : l));
    const set2 = { ...set, bulba: { ...(set.bulba || {}), expansion: nom } };
    const apres = evaluer(deps, set2, docs2, lignes2);
    S.servisApres = apres.F.fiche.size; S.doublesApres = apres.F.doubles; S.visuelsApres = apres.servi.size;
    S.parImpressionAvant = FM.parImpressionDe(regle, set, docs); S.parImpressionApres = FM.parImpressionDe(regle, set2, docs2);
    S.perdus = [...avant.F.fiche.keys()].filter(id => !apres.F.fiche.has(id)).length;
    S.perdusVisuels = [...avant.servi].filter(id => !apres.servi.has(id)).length;
    S.autreCarte = [...avant.F.fiche].filter(([id, f]) => apres.F.fiche.has(id) && apres.F.fiche.get(id).carteId !== f.carteId).length;
    S.surLaBonneFiche = 0; S.mauvaiseFiche = 0;
    for (const p of S.plans) for (const [idProduct, num] of p.produitOrigine) {
        const f = apres.F.fiche.get(idProduct);
        if (f && f.carteId === p.carteId && numeroComparable(f.numero) === numeroComparable(num)) S.surLaBonneFiche++; else S.mauvaiseFiche++;
    }
    const bascule = S.parImpressionAvant && !S.parImpressionApres;
    if (bascule || S.perdus || S.perdusVisuels || S.doublesApres > S.doublesAvant || S.autreCarte || S.mauvaiseFiche)
        return bloque('refuse-simulation', `la règle du site rejouée : ${bascule ? 'documentAmbigu — le set BASCULERAIT de « une fiche par impression » à « une fiche par document » ; ' : ''}`
            + `${S.perdus} produit(s) perdu(s), ${S.perdusVisuels} visuel(s) perdu(s), doubles ${S.doublesAvant}→${S.doublesApres}, ${S.autreCarte} sur la fiche d'une autre carte, ${S.mauvaiseFiche} produit(s) hors de la fiche de leur numéro lu`);
    return S;
}

/**
 * L'écriture d'UN set accepté, dans l'ordre SÛR À L'ARRÊT : (1) l'impression d'une carte, (2) ses numeroFiche, (3) le nom du set en dernier. LÈVE au premier compte qui ne colle pas.
 * (fiches-multi.js garde son propre ordre : numeroFiche puis impression ; ses appelants ne changent pas.)
 */
async function ecrireSet(db, S) {
    const nom = exigerNom(S.nom);
    for (const p of S.plans) {
        if (p.impressions.length) {   // (un plan sans impression = le rejeu d'une carte dont l'impression est déjà posée : ses numeroFiche seuls)
            const r = await db.collection('cartes').updateOne({ _id: p.carteId, 'impressions.expansion': { $ne: nom } }, { $push: { impressions: { $each: p.impressions } } });
            if (r.modifiedCount !== 1) throw new Error(`la carte ${p.carteId} n'a pas reçu ses impressions (modifiées : ${r.modifiedCount}) — arrêt`);
        }
        for (const [id, num] of p.numeros) {
            const q = await db.collection('cartes_produits').updateOne({ _id: id, numeroFiche: null }, { $set: { numeroFiche: num } });
            if (q.modifiedCount !== 1) throw new Error(`la ligne ${id} n'a pas reçu son numeroFiche (modifiées : ${q.modifiedCount}) — la base a bougé depuis la simulation ; arrêt`);
        }
    }
    if (vide(S.L.set.bulba?.expansion)) {
        const r = await db.collection('sets').updateOne({ _id: S.slug, 'bulba.expansion': null }, { $set: { 'bulba.expansion': nom } });
        if (r.modifiedCount !== 1) throw new Error(`le set ${S.slug} n'a pas reçu bulba.expansion (modifiés : ${r.modifiedCount}) — arrêt`);
    }
}

/** Les arguments de la ligne de commande : tout ce qui n'est pas autorisé est refusé AVANT toute connexion (aucune --force). */
function analyserArgs(argv) {
    const AUTORISES = [/^--lectures=.+\.json$/, /^--attendu=\d+$/, /^--ecrire$/, /^--lecture-via-ecriture$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return { erreur: `argument inconnu : ${inconnus.join(' ')} — usage : --lectures=<fichier>.json [--attendu=N] [--ecrire]` };
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const lectures = arg('lectures'), ecrire = argv.includes('--ecrire'), attendu = arg('attendu') == null ? null : Number(arg('attendu'));
    if (!lectures) return { erreur: '--lectures=<fichier>.json obligatoire (le tableau des lectures de scan)' };
    if (ecrire && attendu == null) return { erreur: '--ecrire exige --attendu=N (le nombre d\'impressions de la simulation)' };
    return { lectures, attendu, ecrire, viaEcriture: argv.includes('--lecture-via-ecriture') };
}

/**
 * UNE SEULE racine pour la règle du site : le dossier RACINE_SITE (défaut : celui de l'outil, qui tourne depuis main) dont le voisin `rat-market-site` porte la
 * règle ET les modules lib (imageDeLImpression, langueDuVisuel). SITE_LIB n'est plus une seconde source : posée, elle doit désigner exactement ce même dossier lib.
 */
function racinesDuSite(env, dirname, path = require('path')) {
    const racine = env.RACINE_SITE || dirname, lib = path.join(racine, '..', 'rat-market-site', 'lib');
    if (env.SITE_LIB && path.resolve(env.SITE_LIB) !== path.resolve(lib))
        return { erreur: `SITE_LIB (${env.SITE_LIB}) diverge de la racine ${racine} (lib attendue : ${lib}) : une seule racine du site, rien n'est fait` };
    return { racine, lib };
}

/**
 * L'outil. `lectures` : le tableau des lectures (une lecture peut couvrir plusieurs produits). `attendu` : le nombre d'IMPRESSIONS à écrire de la simulation (exigé par --ecrire).
 * Codes : 0 ok · 1 refus (set absent, attendu qui ne colle pas, rien à faire, restes illisibles, écriture arrêtée) · 2 usage.
 */
async function executer({ db, deps, lectures: brutes, attendu = null, ecrire = false, log = console.log, err = console.error }) {
    const rapport = { sets: [], totalAEcrire: 0, totalImpressions: 0, totalSetsSeuls: 0, ecarts: [], erreur: null, denominateur: {} };
    if (!Array.isArray(brutes) || !brutes.length) { err('❌ aucune lecture : --lectures doit être un tableau non vide'); return { code: 2, rapport }; }
    if (ecrire && !Number.isInteger(attendu)) { err('❌ --ecrire exige --attendu=N (le nombre d\'impressions de la simulation)'); return { code: 2, rapport }; }
    let interdits;
    try { interdits = await lireInterdits(db.collection('restes')); }
    catch (e) { err(`❌ je ne peux pas lire les restes « fiche-contredite-par-la-vue » (${String(e.message).slice(0, 120)}) : je ne peux pas conclure, rien n'est écrit`); return { code: 1, rapport }; }
    const lectures = developper(brutes);
    const parSet = new Map();
    for (const x of lectures) { const k = x?.set ?? '(sans set)'; (parSet.get(k) || parSet.set(k, []).get(k)).push(x); }
    for (const [slug, ls] of parSet) rapport.sets.push(await analyserSet({ db, deps, slug, lectures: ls, interdits }));
    rapport.denominateur = { lecturesBrutes: brutes.length, lectures: lectures.length, sets: rapport.sets.length, lignesDesSets: rapport.sets.reduce((n, s) => n + s.lignes, 0), cartesDesSets: rapport.sets.reduce((n, s) => n + s.docs, 0) };
    log(`DÉNOMINATEUR : ${brutes.length} lecture(s) développée(s) en ${lectures.length} ligne(s) lue(s), sur ${rapport.sets.length} set(s) · ${rapport.denominateur.cartesDesSets} cartes et ${rapport.denominateur.lignesDesSets} lignes dans ces sets · ${interdits.size} ligne(s) détachée(s) connue(s)`);
    let absent = false;
    for (const S of rapport.sets) {
        if (S.statut === 'absent') { absent = true; err(`❌ le set « ${S.slug} » n'existe pas`); continue; }
        log(`\n── ${S.slug} : ${S.lectures} ligne(s) lue(s), ${S.docs} cartes, ${S.lignes} lignes · statut ${S.statut}${S.detail ? ` — ${S.detail}` : ''}`);
        if (S.statut !== 'hors-liste') log(`   cartes à écrire ${S.aEcrire}${S.aEcrireBrut != null ? ` (${S.aEcrireBrut} prêtes, retenues avec le set)` : ''} · impressions ${S.nImpressions} · déjà faites ${S.deja} · non lues (état actuel) ${S.sansLecture}${S.setSeul ? ' · SET SEUL (cartes faites, expansion à poser)' : ''}`);
        for (const [c, n] of Object.entries(S.parCause)) log(`   refus ×${n} [${c}]`);
        for (const r of S.refus.slice(0, 40)) log(`      ${r.cause} · produit ${r.idProduct ?? '-'} carte ${r.carteId ?? '-'} : ${r.detail}`);
        if (S.servisApres != null) {
            log(`   la règle du site (importée) : produits servis ${S.servisAvant} → ${S.servisApres} · visuels servis ${S.visuelsAvant} → ${S.visuelsApres} · perdus ${S.perdus} fiche(s), ${S.perdusVisuels} visuel(s) · doublés ${S.doublesAvant} → ${S.doublesApres} · sur la fiche d'une autre carte ${S.autreCarte} · sur la fiche de leur numéro lu ${S.surLaBonneFiche} (hors place ${S.mauvaiseFiche})`);
            log(`   documentAmbigu (site, tout ou rien par set) : « une fiche par impression » ${S.parImpressionAvant} → ${S.parImpressionApres}`);
        }
        for (const p of S.plans) log(`   + carte ${p.carteId} : ${p.impressions.map(i => `${i.numero}${i.total ? '/' + i.total : ''}`).join(' + ')} (${p.numeros.size} ligne(s) reçoivent numeroFiche)`);
        rapport.totalAEcrire += S.aEcrire; rapport.totalImpressions += S.nImpressions; if (S.setSeul && S.statut === 'ok') rapport.totalSetsSeuls++;
    }
    const refuses = rapport.sets.filter(S => !['ok', 'rien', 'absent'].includes(S.statut));
    log(`\nTOTAL : ${rapport.totalImpressions} impression(s) sur ${rapport.totalAEcrire} carte(s), ${rapport.totalSetsSeuls} set(s) à nommer seuls, ${rapport.sets.filter(S => S.statut === 'ok').length} set(s) acceptés, ${refuses.length} set(s) bloqués (${refuses.map(S => `${S.slug}: ${S.statut}`).join(' ; ') || 'aucun'})`);
    if (absent) return { code: 1, rapport };
    if (attendu != null && attendu !== rapport.totalImpressions) { err(`❌ ${rapport.totalImpressions} impression(s) à écrire, ${attendu} attendue(s) (--attendu=${attendu}) : le plan diffère, RIEN ne s'écrit`); return { code: 1, rapport }; }
    if (!rapport.totalAEcrire && !rapport.totalSetsSeuls) {
        if (rapport.sets.some(S => S.deja)) { log('déjà fait : rien à écrire'); return { code: 0, rapport }; }
        err('❌ aucune impression à écrire'); return { code: 1, rapport };
    }
    if (!ecrire) { log(`(simulation — rien n'est écrit ; relancer avec --attendu=${rapport.totalImpressions} --ecrire, sous lot-additif.js --collections=cartes,cartes_produits,sets)`); return { code: 0, rapport }; }
    try {
        for (const S of rapport.sets.filter(x => x.statut === 'ok' && (x.aEcrire || x.setSeul))) {
            await FM.rafraichirAvant(db, S);
            await ecrireSet(db, S);
            const ecarts = await FM.relire(db, deps, S);
            rapport.ecarts.push(...ecarts);
            log(`   ${S.slug} : écrit · RELECTURE ${ecarts.length ? '🔴 ' + ecarts.join(' ; ') : '✅ comme attendu'}`);
            if (ecarts.length) break;
        }
    } catch (e) { rapport.erreur = e.message; err(`❌ ${e.message}`); return { code: 1, rapport }; }
    if (rapport.ecarts.length) { err('❌ la relecture ne retrouve pas l\'état attendu'); return { code: 1, rapport }; }
    log(`✅ écrit et relu : ${rapport.totalImpressions} impression(s)`);
    return { code: 0, rapport };
}

module.exports = { SOURCE, FAMILLES, familleDe, exigerNom, developper, jugerLecture, numerosSeRecouvrent, analyserSet, ecrireSet, analyserArgs, racinesDuSite, executer };

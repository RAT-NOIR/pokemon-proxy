// ============================================================
// pokedata — visuels pleine taille (728×1000) pour ce qui NOUS MANQUE (lot POKEDATA, 2026-10-17) — module PUR : aucune requête, aucune base, aucune écriture
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : la source est ROUVERTE. Les visuels appartiennent à The Pokémon Company ; on ne les prend que pour ce qui nous manque, retirables à la
// demande. Hôte d'images : pokemoncardimages.pokedata.io (robots.txt en 404 : permis), pleine taille seulement — /images/<nom du set>/<numéro>.webp, JAMAIS le suffixe _240w.
// Pages : www.pokedata.io, seulement la liste des sets et les pages de set de la table fermée ci-dessous. Aucune API, aucun prix, aucune page en série.
// Le mot « pokedata » n'apparaît jamais dans un champ que le site ou l'API lisent : la clé R2 est neutre (pdt/…), la mention est celle de l'éditeur ; `source` (`pdt`) et `lot` (`pdt-2026-10`) sont neutres AUSSI (le site LIT `source`, lireDonnee.ts) ; seul `urlOriginal` nomme l'hôte :
// champ INTERNE de traçabilité (celui qui retire le lot en a besoin).
//
// 🔴 CE QUE LA SONDE DU 2026-10-17 A APPRIS (4 requêtes, fixtures/pokedata-*.html) : la LISTE des sets est rendue côté serveur (694 sets dans __NEXT_DATA__ : id, name, code,
// language, release_date) ; une PAGE de set est une coquille rendue côté client — son HTML ne porte ni cartes, ni numéros, ni adresses d'image (pageProps vide). Les cartes arrivent
// d'un appel de l'application, que la décision du testeur exclut (« sans API »). Ce module ne devine donc rien : il lit des RELEVÉS déposés (schéma 1, voir lireReleves) et dit
// pourquoi il refuse. Chaque règle s'écrit par ce qu'elle AUTORISE.
const fs = require('fs');
const path = require('path');
const { cleNumero, normaliserNom } = require('./jointure');
const T = require('./tpc');
const { estDosDeCarte } = require('./hotes-images-ptcgio');

const SOURCE = 'pdt';
const LOT = 'pdt-2026-10';
const MENTION = T.MENTION;
const HOTE_PAGES = 'www.pokedata.io';
const HOTE_IMAGES = 'pokemoncardimages.pokedata.io';
const PREFIXE_CHEMIN = '/images/';
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const CADENCE_MS = 6000;               // le plancher imposé est 5 s (les deux transports le relèvent) ; 6 s est la cadence de la sonde
const CADENCE_MIN_MS = 5000;
const LARGEUR_ATTENDUE = 728;
const PLUS_GRANDE = 1.5;               // « nettement plus grande » : au moins 1,5 fois la largeur de l'original en place (une équivalente ne remplace jamais une image correcte)
const DOSSIER_CACHE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pokedata-cache';
const DOSSIER_LOT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\POKEDATA-LOT';

// La table des sets UTILES : nom du set dans la liste de la source (langue ENGLISH, vérifié par le banc contre la liste réelle) -> les slugSet qui sont nos trous possibles.
// FERMÉE : un set absent de cette table n'est jamais demandé. Les noms sont ceux de la liste, casse et apostrophes comprises.
const SETS_UTILES = Object.freeze({
    'Trick or Trade 2024': ['Trick-or-Trade-2024'], 'Trick or Trade 2023': ['Trick-or-Trade-2023'], 'Trick or Trade 2022': ['Trick-or-Trade'],
    "Mcdonald's Dragon Discovery": ['McDonalds-Collection-2024'], "McDonald's Promos 2023": ['McDonalds-Match-Battle-2023'], "Mcdonald's Promos 2022": ['McDonalds-Collection-2022'],
    "Mcdonald's 25th Anniversary": ['McDonalds-Collection-25th-Anniversary'], "McDonald's Promos 2019": ['McDonalds-Collection-2019', 'McDonalds-Collection-2019-2'],
    "McDonald's Promos 2018": ['McDonalds-Collection-2018', 'McDonald-s-Collection-2018-2'], "McDonald's Promos 2017": ['McDonalds-Collection-2017'], "McDonald's Promos 2016": ['McDonalds-Collection-2016'],
    "McDonald's Promos 2015": ['McDonalds-Collection-2015'], "McDonald's Promos 2014": ['McDonalds-Collection-2014'], "McDonald's Promos 2012": ['McDonalds-Collection-2012'], "McDonald's Promos 2011": ['McDonalds-Collection-2011'],
    'Unseen Forces': ['EX-Unseen-Forces'], 'HeartGold SoulSilver': ['HeartGold-SoulSilver'], '30th Celebration': ['30th-Celebration'], 'Celebrations': ['Celebrations']      // (réservés par Pokéllector, nom vu sur la liste)
});
// Les pages à ouvrir à la main pour le relevé passif au clic : 10 au plus, les plus gros trous d'abord (produits sans visuel au 2026-10-17 : 2019 : 80, 2018 : 51, ToT 2024 : 34, Unseen Forces : 26, Dragon Discovery : 15, 2014 : 12, 2015 : 10, ToT 2023 : 10, 2023 : 8, 2017 : 4).
const PAGES_A_OUVRIR = Object.freeze(["McDonald's Promos 2019", "McDonald's Promos 2018", 'Trick or Trade 2024', 'Unseen Forces', "Mcdonald's Dragon Discovery", "McDonald's Promos 2014", "McDonald's Promos 2015", 'Trick or Trade 2023', "McDonald's Promos 2023", "McDonald's Promos 2017"]
    .map(n => `https://www.pokedata.io/set/${encodeURIComponent(n).replace(/%20/g, '+').replace(/'/g, '%27')}`));
// ➕ CORRECTION 2 (décision du testeur, 2026-10-18) : la CONSTRUCTION directe des adresses est ABANDONNÉE (les noms de set de la source diffèrent des nôtres) : aucune adresse ne se fabrique, elles viennent toutes d'un relevé. La liste FERMÉE des sets anglais de la source (183, lus dans la liste réelle) :
// une adresse d'image n'est valable que sous l'un d'eux. Le fichier est généré depuis la fixture de la sonde ; le banc compare les deux.
const SETS_ANGLAIS = Object.freeze([...require('./pokedata-sets-anglais.json').noms]);
const nomsDuSlug = slug => Object.keys(SETS_UTILES).filter(n => SETS_UTILES[n].includes(slug));
const nomNorm = normaliserNom;

// ── les adresses ────────────────────────────────────────────────────────────────────────────────────────────────────────
const enc = nom => nom.replace(/ /g, '+');
/** Le nom de set lu dans un segment de chemin (« + » = espace ; seuls %27 et %26 sont décodés), ou null. */
function nomDeSegment(seg, table = SETS_ANGLAIS) {
    if (typeof seg !== 'string' || !seg || !/^(?:[A-Za-z0-9+'.!*()~-]|%[0-9A-Fa-f]{2})+$/.test(seg)) return null;
    let nom; try { nom = decodeURIComponent(seg.replace(/\+/g, ' ')); } catch { return null; }
    return table.includes(nom) ? nom : null;
}
/** Le segment d'un nom de set dans une adresse : espaces -> « + », le reste encodé (l'apostrophe reste brute). */
const segmentDeSet = nom => encodeURIComponent(nom).replace(/%20/g, '+');
const NOMS_UTILES = Object.keys(SETS_UTILES);
/** Une adresse d'IMAGE valable : https, l'hôte d'images seul, sans port/identifiants/paramètres/ancre, /images/<set de la table>/<numéro>.webp, jamais _240w. */
function urlImageValide(url) {
    if (typeof url !== 'string' || !url || /\.\.|\\|_240w/i.test(url)) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_IMAGES || u.port || u.username || u.password || u.search || u.hash) return false;
    if (!u.pathname.startsWith(PREFIXE_CHEMIN)) return false;
    const m = /^([^/]+)\/([A-Za-z0-9-]{1,12})\.webp$/.exec(u.pathname.slice(PREFIXE_CHEMIN.length));
    return !!m && nomDeSegment(m[1]) !== null;
}
/** Une adresse de PAGE valable : https, www.pokedata.io, UNIQUEMENT la liste des sets, une page de set de la table, ou robots.txt. */
function urlPageValide(url) {
    if (typeof url !== 'string' || !url || /\.\.|\\/.test(url)) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_PAGES || u.port || u.username || u.password || u.search || u.hash) return false;
    if (u.pathname === '/sets/' || u.pathname === '/robots.txt') return true;
    const m = /^\/set\/([^/]+)$/.exec(u.pathname);
    return !!m && nomDeSegment(m[1], NOMS_UTILES) !== null;
}
const urlPageDuSet = nom => (Object.hasOwn(SETS_UTILES, nom) ? `https://${HOTE_PAGES}/set/${enc(nom).replace(/'/g, '%27')}` : null);

// ── la liste des sets et les pages de set ───────────────────────────────────────────────────────────────────────────────
function lireNextData(html) {
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html ?? ''));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
}
/** La liste des sets (rendue côté serveur). LÈVE si la structure attendue manque ou est vide : un vide n'est jamais un résultat. */
function lireListeDesSets(html) {
    const j = lireNextData(html);
    if (!j) throw new Error('liste des sets : pas de __NEXT_DATA__ lisible — la structure de la page a changé ou la page est un défi');
    const arr = j?.props?.pageProps?.setInfoArr;
    if (!Array.isArray(arr) || !arr.length) throw new Error('liste des sets : setInfoArr absent ou vide — une clé fausse, pas une absence');
    return arr.map(s => ({ id: s.id, name: s.name, code: s.code ?? null, language: s.language, releaseDate: s.release_date ?? null, series: s.series ?? null }));
}
/** Les relevés déposés (schéma 1) : releve--*.json = { schema: 1, set: <nom du set>, complet: bool, cartes: [{ numero, nom, img }] }. Jamais d'écriture. */
function lireReleves(dossier = path.join(DOSSIER_CACHE, 'releves')) {
    const cartes = [], ignores = [];
    let fichiers = 0, douteuses = 0;
    if (!fs.existsSync(dossier)) return { cartes, ignores, fichiers, douteuses };
    for (const f of fs.readdirSync(dossier).filter(x => /^releve--.*\.json$/.test(x)).sort()) {
        let o; try { o = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); } catch { ignores.push({ fichier: f, motif: 'illisible' }); continue; }
        if (o?.schema !== 1 || !Array.isArray(o.cartes)) { ignores.push({ fichier: f, motif: 'schéma inconnu' }); continue; }
        if (!Object.hasOwn(SETS_UTILES, o.set)) { ignores.push({ fichier: f, motif: `set « ${o.set} » hors de la table` }); continue; }
        fichiers++;
        for (const c of o.cartes) {
            if (c.numeroDoute === true) { douteuses++; continue; }          // un numéro qui contredit le nom de fichier de l'image : jamais utilisé pour apparier
            cartes.push({ set: o.set, numero: String(c.numero ?? ''), nom: c.nom ?? null, img: c.img, releveComplet: o.complet === true, fichier: f });
        }
    }
    return { cartes, ignores, fichiers, douteuses };
}

// ── l'appariement ────────────────────────────────────────────────────────────────────────────────────────────────────────
const REFUS_PAR_DEFAUT = e => (String(e?.langue ?? '').trim().toLowerCase() === 'ja' ? 'langue:ja' : null);
/** Le numéro d'origine d'un slug Cardmarket SANS numéro de fiche : le dernier segment, s'il est numérique (« …-BOO24PAF-037 » -> 037). « MCD145 » n'est jamais lu (MCD14 + 5). */
function numeroDuSlug(slug) {
    if (typeof slug !== 'string') return null;
    const segs = slug.split('-');
    return segs.length > 1 && /^\d+$/.test(segs.at(-1)) ? segs.at(-1) : null;
}
const baseNumero = n => { const k = cleNumero(n); return k == null ? null : k.replace(/(\d)[A-Z]+$/, '$1'); };
// 🔑 POKEDATA-SUITE (2026-10-18) — le « nom » d'une carte relevée est le TEXTE ALTERNATIF de l'image : « Nom [Variante] Numéro » (« Potion 95 », « Potion Reverse Holo 95 », « Gengar Cosmos Holo 057 »).
// Le comparer tel quel à notre fiche fabriquait le refus (326 « nom-contredit »). Avant comparaison : (a) le DERNIER mot égal au numéro relevé part (zéros de tête et suffixe r tolérés), (b) puis une mention
// de variante FINALE d'une liste FERMÉE. Rien d'autre ne part : « Gold Star », « δ », « ex », « LV.X » font partie du nom ou désignent une autre carte — s'ils contredisent, la carte reste un reste.
const MENTIONS_DE_VARIANTE = Object.freeze(['Reverse Holo', 'Cosmos Holo', 'Holo']);          // la plus longue d'abord
const sansZeros = s => String(s).toLowerCase().replace(/^0+(?=\d)/, '');
function nomDepouille(nom, numero) {
    if (typeof nom !== 'string') return nom ?? null;
    let mots = nom.trim().split(/\s+/);
    const dernier = mots.length > 1 ? sansZeros(mots.at(-1)) : null;
    const num = numero == null ? null : sansZeros(numero), numSansR = num != null ? num.replace(/^(\d+)r$/, '$1') : null;
    if (dernier != null && num != null && (dernier === num || dernier === numSansR)) mots = mots.slice(0, -1);
    const reste = mots.join(' ');
    for (const m of MENTIONS_DE_VARIANTE) {
        if (reste.length > m.length && reste.toLowerCase().endsWith(` ${m.toLowerCase()}`)) return reste.slice(0, -(m.length + 1)).trim();
    }
    return reste;
}
/** Une image REVERSE : un nom de fichier « <chiffres>r.webp » (« 95r.webp ») ; « 037a » n'en est pas une. */
const estReverse = c => /^\d+r$/i.test(String(c?.img ?? '').split('/').pop().replace(/\.webp$/i, ''));
// comparaison insensible aux ACCENTS des deux côtés (décomposition NFD, marques diacritiques retirées) : « Poke Ball » = « Poké Ball » — et rien d'autre
const sansAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const nomComparable = s => nomNorm(sansAccents(s));
function nomOk(c, t) {
    if (!c.nom) return false;
    const fiche = nomComparable(t.carte.nomEn);
    return nomComparable(c.nom) === fiche || nomComparable(nomDepouille(c.nom, c.numero)) === fiche;
}
/** Pourquoi une entrée ADMISE par la règle du site peut quand même être remplacée (doctrine du testeur), ou null : une image correcte n'est jamais remplacée par une équivalente. */
function raisonDeRemplacement(e, largeurAttendue) {
    if (e?.basseDefinition === true) return 'basse-definition';
    if (e?.imageEmprunteeTirage === true) return 'empruntee';
    if (typeof e?.wOriginal === 'number' && e.wOriginal > 0 && largeurAttendue >= PLUS_GRANDE * e.wOriginal) return 'plus-grande';
    return null;
}

/**
 * @param {{trous: object[], cartes: object[], noms?: Map, refus?: Function, largeurAttendue?: number}} o
 *   trous : { idProduct, carteId, slugSet, numeroFiche, slugProduit, carte:{_id,nomEn,images} } ; cartes : les cartes RELEVÉES ({set, numero, nom, img}) ;
 *   noms : Map(slugSet -> Map(nomNormalisé -> Set(carteId))) = les fiches du set chez nous (exigé pour lire une lettre de la source).
 * @returns {{plan: object[], remplacements: object[], restes: object[]}}
 */
function apparier({ trous, cartes, noms = new Map(), refus = REFUS_PAR_DEFAUT, largeurAttendue = LARGEUR_ATTENDUE }) {
    const restes = [];
    const reste = (t, motif, detail) => restes.push({ idProduct: t.idProduct, carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, numero: t.numeroFiche ?? null, motif, ...(detail ? { detail } : {}) });
    const resolus = [];
    for (const t of trous) {
        const duSet = cartes.filter(c => nomsDuSlug(t.slugSet).includes(c.set));
        if (!duSet.length) { reste(t, 'set-non-releve'); continue; }
        const numFiche = t.numeroFiche != null && String(t.numeroFiche).trim() !== '' ? t.numeroFiche : null;
        const numeroRef = numFiche ?? numeroDuSlug(t.slugProduit);
        if (numeroRef == null) { reste(t, 'sans-numero'); continue; }
        const cle = cleNumero(numeroRef), base = baseNumero(numeroRef);
        const parBase = duSet.filter(c => baseNumero(c.numero) === base);
        if (!parBase.length) { reste(t, 'numero-absent-du-releve'); continue; }
        // une reverse (…r.webp) n'est JAMAIS retenue quand l'image normale du même numéro est relevée ; si seule la reverse existe : reste « seulement-reverse »
        const normales = parBase.filter(c => !estReverse(c));
        if (!normales.length) {
            const rev = parBase.filter(c => nomOk(c, t));
            if (rev.length) { reste(t, 'seulement-reverse', `seules des reverses relevées (${rev.map(c => c.numero).join(', ')})`); continue; }
        }
        const avecNom = normales.filter(c => nomOk(c, t));
        if (!avecNom.length) { reste(t, 'nom-contredit', `relevé ${parBase.map(c => `« ${c.nom} » n°${c.numero}`).join(', ')}, fiche « ${t.carte.nomEn} »`); continue; }
        if (new Set(avecNom.map(c => c.img)).size > 1) { reste(t, 'numero-ambigu', `${new Set(avecNom.map(c => c.img)).size} images pour la base ${base} et le nom « ${t.carte.nomEn} »`); continue; }
        const choisie = avecNom[0];
        const exact = cleNumero(choisie.numero) === cle;
        let correspondance = null;
        if (!exact) {
            // une LETTRE de la source (« 037a ») ne se devine pas : base du numéro + nom, et le nom doit être unique chez nous dans le set
            const chezNous = noms.get(t.slugSet)?.get(nomNorm(t.carte.nomEn));
            if (!chezNous || chezNous.size !== 1 || !chezNous.has(t.carte._id)) { reste(t, 'nom-non-unique', `la lettre « ${choisie.numero} » ne se lit que si le nom est unique chez nous (${chezNous?.size ?? '?'} fiche(s))`); continue; }
            correspondance = { relevee: choisie.numero, fiche: cle, preuve: `base du numéro ${base} = celui ${numFiche != null ? 'de la fiche' : 'du slug'} ; nom « ${choisie.nom} » concordant ; une seule carte relevée à cette base avec ce nom` };
        }
        if (!urlImageValide(choisie.img)) { reste(t, 'adresse-hors-regle', 'adresse du relevé hors des règles'); continue; }
        // ── la doctrine : ajout, remplacement, ou rien ──
        const auNumero = (t.carte.images || []).filter(e => e && e.set === t.slugSet && (e.numero == null || cleNumero(e.numero) === cle));
        const jugees = auNumero.map(e => ({ e, motif: refus(e, t.slugSet) }));
        const admises = jugees.filter(x => x.motif === null).map(x => x.e);
        let genre = 'ajout', motifRemplacement = null, aRetirer = [];
        if (admises.length) {
            const raisons = admises.map(e => raisonDeRemplacement(e, largeurAttendue));
            if (raisons.some(r => r === null)) { reste(t, 'deja-servi'); continue; }
            genre = 'remplacement'; motifRemplacement = raisons[0]; aRetirer = [...admises, ...jugees.filter(x => x.motif !== null).map(x => x.e)];
        } else if (jugees.length) { genre = 'remplacement'; motifRemplacement = 'entree-refusee'; aRetirer = jugees.map(x => x.e); }
        resolus.push({ t, card: choisie, genre, motifRemplacement, correspondance, voie: `set+${numFiche != null ? 'numero' : 'numero-du-slug'}${exact ? '' : '+lettre'}+nom`, aRetirer,
            preuve: `${choisie.set} n°${choisie.numero} = ${numFiche != null ? 'le numéro de la fiche' : `le numéro d'origine du slug (${numeroRef})`} ; nom relevé « ${choisie.nom} » = « ${t.carte.nomEn} »` });
    }
    // ── une FICHE = (carte, numéro) a une seule image ; une image sert une seule fiche ──
    const cleGroupe = t => `${t.carte._id}|${t.numeroFiche == null ? '∅' : cleNumero(t.numeroFiche)}`;
    const groupes = new Map();
    for (const r of resolus) (groupes.get(cleGroupe(r.t)) || groupes.set(cleGroupe(r.t), []).get(cleGroupe(r.t))).push(r);
    for (const [k, g] of [...groupes]) if (new Set(g.map(r => r.card.img)).size > 1) { for (const r of g) reste(r.t, 'deux-images-une-fiche'); groupes.delete(k); }
    const parImg = new Map();
    for (const [k, g] of groupes) (parImg.get(g[0].card.img) || parImg.set(g[0].card.img, new Set()).get(g[0].card.img)).add(k);
    for (const [, ks] of parImg) if (ks.size > 1) for (const k of ks) { for (const r of groupes.get(k) || []) reste(r.t, 'carte-pour-deux-fiches'); groupes.delete(k); }
    const plan = [], remplacements = [];
    for (const g of groupes.values()) {
        const { t, card, voie, preuve, genre, motifRemplacement, correspondance, aRetirer } = g[0];
        const unite = { carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, slugSet: t.slugSet, numero: t.numeroFiche ?? null, produits: g.map(r => r.t.idProduct), ligne: card.set, numeroReleve: card.numero, url: card.img, voie, preuve, genre, releve: card.fichier ?? null,
            ...(correspondance ? { correspondance } : {}) };
        if (genre === 'ajout') { plan.push(unite); continue; }
        const refusees = [...new Map(aRetirer.map(e => [e.cleR2, { cleR2: e.cleR2 ?? null, source: e.source ?? null, numero: e.numero ?? null, langue: e.langue ?? null }])).values()];
        remplacements.push({ ...unite, motifRemplacement, refusees });
        for (const r of g) reste(r.t, 'remplacement-prepare', `${motifRemplacement} : ${refusees.map(e => `${e.cleR2} [${e.source}]`).join(' ; ')} — modification, feu vert du testeur requis`);
    }
    return { plan, remplacements, restes };
}

// ── clé R2, traçabilité, langue, retrait ───────────────────────────────────────────────────────────────────────────────
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';
/** La clé R2 NEUVE : neutre, sans le nom de la source. */
const cleR2 = (slugSet, numero, carteId) => `pdt/${slugSet}/${cleNum(numero)}-${carteId}-en.webp`;
const idImage = (slugSet, carteId, numero) => `pdt/${slugSet}/${carteId}/${cleNum(numero)}/en`;
/** UNE fonction écrit la traçabilité (le module commun collecte-cartes/tracabilite.js la remplacera à la fusion). */
function tracer({ url, le = new Date() }) {
    if (!urlImageValide(url)) throw new Error('tracer : adresse d\'origine hors des règles — rien ne se trace sans adresse valable');
    return { source: SOURCE, urlOriginal: url, collecteLe: le, retirable: true, lot: LOT };
}
/** La langue : déclarée par la source (set anglais de la liste) et portée par `langueSource` ; la preuve ne nomme jamais l'hôte. */
function langueDe(url, langueSource) {
    if (!urlImageValide(url)) return { langue: null, preuve: 'adresse d\'origine hors des règles : sans règle de langue' };
    return langueSource === 'en'
        ? { langue: 'en', preuve: 'visuel pleine taille d\'un set déclaré anglais par la source, rangé sous un set au tirage occidental' }
        : { langue: null, preuve: 'langue de la source non déclarée : sans règle' };
}
const duLot = e => e?.source === SOURCE && e.lot === LOT;
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot, et leurs clés R2 (vignettes comprises). */
function planRetrait(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(duLot);
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = { SOURCE, LOT, MENTION, HOTE_PAGES, HOTE_IMAGES, PREFIXE_CHEMIN, UA, CADENCE_MS, CADENCE_MIN_MS, LARGEUR_ATTENDUE, PLUS_GRANDE, DOSSIER_CACHE, DOSSIER_LOT, SETS_UTILES, REFUS_PAR_DEFAUT,
    PAGES_A_OUVRIR, SETS_ANGLAIS, segmentDeSet, nomDepouille, estReverse,
    nomsDuSlug, nomNorm, nomDeSegment, urlImageValide, urlPageValide, urlPageDuSet, lireNextData, lireListeDesSets, lireReleves, numeroDuSlug, baseNumero, raisonDeRemplacement,
    apparier, cleNum, cleR2, idImage, tracer, langueDe, duLot, planRetrait, estDosDeCarte };

// ============================================================
// LES PRODUITS D'UN SET DE DECKS RÉIMPRIMÉS (Battle Academy) — la carte d'origine lue dans la liste de deck de la page du produit
// ============================================================
// 🔑 LA FORME (mesurée le 2026-09-26) : Battle Academy 2020, 2022, 2024 réimpriment des cartes d'autres sets dans trois decks. Aucune
// page de CARTE ne déclare ce tirage (0 impression « Battle Academy » sur 15 550 cartes) : la jointure du collecteur, qui lit les
// impressions, ne peut rien. La page du PRODUIT, elle, liste chaque deck (`{{halfdecklist/header|title=Cinderace Deck}}`) et chaque
// carte par son tirage d'ORIGINE (`{{TCG ID|Fusion Strike|Sizzlipede|46}}`). Cardmarket numérote par deck et position (« C01 »,
// « P60 », « DAR05 ») : la LETTRE désigne le deck, la position n'existe pas chez Bulbapedia.
// La clé est donc (deck, nom) : le préfixe du numéro → la section de la page (appariement MESURÉ sur les noms de Pokémon, jamais
// deviné), puis le nom du produit parmi les cartes de CETTE section. Le nom étant DANS la clé, il ne peut plus être témoin : les
// témoins sont les ATTAQUES (Cardmarket les écrit entre crochets) et, quand le slug le porte, le NUMÉRO D'ORIGINE
// (« Kangaskhan-V1-DRM55 » : l'entrée retenue doit être le n°55).
// 🔑 ET L'ORDRE IMPRIMÉ, QUAND LA PAGE LE DONNE (même jour) : « The Cinderace and Pikachu decks also have an order printed on their
// cards » — une seconde liste, du même titre, une ligne par POSITION (1…60), énergies comprises. Sa position EST le numéro Cardmarket
// (C01 = position 1 = Sizzlipede). La clé devient alors (deck, position), et le NOM redevient un témoin : il n'est plus dans la clé.
// Les decks sans ordre imprimé (Eevee, Mewtwo, Darkrai : Cardmarket les numérote « EVE », « MWT », « DAR ») gardent la clé (deck, nom).
const { sectionsSetlist, gabarits, natureIgnoree } = require('./wikitext');
const { cleNumero, nomJointDe, clesNom, cleAttaque } = require('./jointure');

const POSITION = /^\d{1,2}$/;
const positionDe = brut => { const p = gabarits(String(brut))[0]?.positionnels?.[0]; return p != null && POSITION.test(String(p).trim()) ? Number(p) : null; };
/**
 * Les decks d'une page, regroupés par TITRE : leurs entrées (toutes les listes du même titre), et, si une de ces listes est l'ordre
 * imprimé — chaque ligne, énergies ignorées comprises, porte une position 1…60 —, la table position → entrée (ou énergie ignorée).
 */
function decksDeLaPage(texte) {
    const parTitre = new Map();
    for (const s of sectionsSetlist(texte, { listesDeDeck: true }).filter(s => s.titre && (s.entrees.length || s.ignorees.length))) {
        const d = parTitre.get(s.titre) || parTitre.set(s.titre, { titre: s.titre, entrees: [], ignorees: 0, ordre: null }).get(s.titre);
        const lignes = [...s.entrees.map(e => [POSITION.test(String(e.rang ?? '').trim()) ? Number(e.rang) : null, { entree: e }]), ...s.ignorees.map(b => [positionDe(b), { ignoree: natureIgnoree(b) }])];
        if (lignes.length && lignes.every(([p]) => p != null) && new Set(lignes.map(([p]) => p)).size === lignes.length) {
            if (d.ordre) throw new Error(`deux ordres imprimés pour « ${s.titre} » : on ne choisit pas`);
            d.ordre = new Map(lignes);
        }
        d.entrees.push(...s.entrees); d.ignorees += s.ignorees.length;
    }
    return [...parTitre.values()];
}

/** Le préfixe de deck d'un numéro Cardmarket : ses lettres de tête (« C01 » → C, « EVE » → EVE, « DAR05 » → DAR), sinon null. */
const prefixeDe = numero => (/^([A-Z]+)/.exec(String(numero ?? '').trim().toUpperCase()) || [])[1] ?? null;

const communes = (p, c) => { const s = new Set((c.attaques || []).map(a => cleAttaque(a.nom))); return (p.attaques || []).filter(a => s.has(cleAttaque(a))).length; };
const nomDesigne = (p, c) => { const kc = clesNom(nomJointDe(c)); return clesNom(p.nom).some(k => kc.includes(k)); };
// L'ÉCART DE FORME : Cardmarket écrit « Boss's Orders - Giovanni » pour « Boss's Orders » (Rebel Clash 154). Le nom du produit
// COMMENCE par celui de la carte, suivi d'un complément. Il ne vaut que si ce nom ne désigne AUCUNE autre carte du deck (la règle du
// témoin de la jointure, temoinDuNom) : « Hop » à la place de Potion n'est pas une forme, c'est un désaccord.
// Par MOTS entiers : `normaliserNom` retire les espaces, et « hop » serait le début de « hoppip ».
const mots = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const nomCommencePar = (p, c) => { const mc = mots(nomJointDe(c)), mp = mots(p.nom); return mc.length > 0 && mp.length > mc.length && mc.every((w, i) => mp[i] === w); };

/**
 * PRÉFIXE → DECK, MESURÉ : pour chaque préfixe, combien de ses produits Pokémon (ceux qui portent des attaques) ont leur nom parmi
 * les cartes de chaque deck. Un préfixe est apparié quand son meilleur deck couvre au moins 60 % de ses Pokémon et que le second
 * n'en couvre pas le quart ; deux préfixes ne prennent jamais le même deck. Les Dresseurs ne votent pas : Switch est dans les trois.
 * @returns {{ prefixes: Object<string,string>, matrice: Object<string,{total:number, parDeck:Object<string,number>, retenu:string|null, raison:string|null}> }}
 */
function mesurerPrefixes(decks, produits, carteDe) {
    const cartesDuDeck = new Map(decks.map(d => [d.titre, [...new Map(d.entrees.map(e => carteDe(e)).filter(Boolean).map(c => [c._id, c])).values()]]));
    const matrice = {};
    for (const p of produits) {
        const L = prefixeDe(p.numero);
        if (!L || !(p.attaques || []).length) continue;
        const m = matrice[L] || (matrice[L] = { total: 0, parDeck: Object.fromEntries(decks.map(d => [d.titre, 0])), retenu: null, raison: null });
        m.total++;
        for (const d of decks) if (cartesDuDeck.get(d.titre).some(c => nomDesigne(p, c))) m.parDeck[d.titre]++;
    }
    const prefixes = {}, pris = new Map();
    for (const [L, m] of Object.entries(matrice)) {
        const tri = Object.entries(m.parDeck).sort((a, b) => b[1] - a[1]);
        const [d1, n1] = tri[0] || [null, 0], n2 = tri[1]?.[1] ?? 0;
        if (!d1 || n1 < 0.6 * m.total) { m.raison = `meilleur deck ${n1}/${m.total} sous 60 %`; continue; }
        if (n2 > 0.25 * n1) { m.raison = `second deck ${n2} contre ${n1} : la lettre ne sépare pas les decks`; continue; }
        if (pris.has(d1)) { m.raison = `deck « ${d1} » déjà pris par ${pris.get(d1)}`; delete prefixes[pris.get(d1)]; matrice[pris.get(d1)].retenu = null; matrice[pris.get(d1)].raison = `deck « ${d1} » disputé avec ${L}`; continue; }
        prefixes[L] = d1; pris.set(d1, L); m.retenu = d1;
    }
    return { prefixes, matrice };
}

/** Le numéro d'origine que porte un slug de réimpression (« Kangaskhan-V1-DRM55 » → DRM, 55), jamais le code du set lui-même. */
function origineDuSlug(slug, codeDuSet) {
    const m = /-([A-Z][A-Z0-9]*?)(\d+)$/.exec(String(slug || '').replace(/-V\d+(?=-|$)/, ''));
    if (!m || m[1].startsWith(String(codeDuSet).replace(/\d+$/, '')) || /^BA\d/.test(m[1] + m[2])) return null;
    return { code: m[1], numero: m[2] };
}

/**
 * Joint chaque produit à UNE carte de SON deck. Causes nommées : sans préfixe, préfixe sans deck mesuré, aucun candidat (énergies
 * de base : la liste ne cite pas de page de tirage), ambigu, attaques discordantes, numéro d'origine discordant.
 */
function joindreParDeck({ decks, produits, carteDe, prefixes, codeDuSet }) {
    const causes = { sansPrefixe: [], prefixeSansDeck: [], sansCandidat: [], ambigu: [], attaquesDiscordantes: [], origineDiscordante: [], nomDiscordant: [], positionAbsente: [] };
    const resolus = [];
    for (const p of produits) {
        const L = prefixeDe(p.numero);
        if (!L) { causes.sansPrefixe.push(p); continue; }
        const titre = prefixes[L], deck = titre && decks.find(d => d.titre === titre);
        if (!deck) { causes.prefixeSansDeck.push(p); continue; }
        // LA POSITION, quand le deck a son ordre imprimé et que le numéro Cardmarket en porte une (« C01 ») : elle seule désigne,
        // et le nom JUGE — il n'est pas dans la clé. Une énergie de base à cette position n'a pas de page : aucun candidat.
        const pos = deck.ordre ? /^[A-Z]+0*(\d{1,2})$/.exec(String(p.numero).trim().toUpperCase())?.[1] : null;
        if (pos != null) {
            const x = deck.ordre.get(Number(pos));
            if (!x) { causes.positionAbsente.push(p); continue; }
            if (x.ignoree) { causes.sansCandidat.push({ ...p, raisonSans: `position ${pos} : ${x.ignoree}` }); continue; }
            const c = carteDe(x.entree);
            if (!c) { causes.sansCandidat.push({ ...p, raisonSans: `position ${pos} : « ${x.entree.titre} » absente de la base` }); continue; }
            const autres = [...new Map(deck.entrees.map(e => carteDe(e)).filter(k => k && k._id !== c._id && nomDesigne(p, k)).map(k => [k._id, k])).values()];
            const forme = !nomDesigne(p, c) && !autres.length && nomCommencePar(p, c);
            if (!nomDesigne(p, c) && !forme) { causes.nomDiscordant.push({ p, carte: c, entree: x.entree.titre, autres: autres.map(k => k.nomEn) }); continue; }
            if ((p.attaques || []).length && (c.attaques || []).length && communes(p, c) === 0) { causes.attaquesDiscordantes.push({ p, carte: c, entree: x.entree.titre }); continue; }
            const o = origineDuSlug(p.slug, codeDuSet);
            if (o && x.entree.b != null && cleNumero(o.numero) !== cleNumero(x.entree.b)) { causes.origineDiscordante.push({ p, entree: x.entree.titre, origine: o }); continue; }
            resolus.push({ p, carte: c, entree: x.entree, deck: titre, cle: 'position', temoins: [forme ? `nom : écart de forme (« ${p.nom} » commence par « ${c.nomEn} », aucune autre carte du deck)` : `nom ✅`,(p.attaques || []).length && (c.attaques || []).length ? `attaques ${communes(p, c)}/${p.attaques.length}` : 'sans attaque', o ? `origine du slug ${o.code}${o.numero} = n°${x.entree.b}` : null].filter(Boolean) });
            continue;
        }
        const parCarte = new Map();
        for (const e of deck.entrees) { const c = carteDe(e); if (c && nomDesigne(p, c) && !parCarte.has(c._id)) parCarte.set(c._id, { c, e }); }
        let choix = [...parCarte.values()], forme = false;
        if (!choix.length) {
            // Aucun nom exact dans le deck : l'écart de forme (« Boss's Orders - Ghetsis »), s'il désigne UNE seule carte du deck.
            const f = new Map();
            for (const e of deck.entrees) { const c = carteDe(e); if (c && nomCommencePar(p, c) && !f.has(c._id)) f.set(c._id, { c, e }); }
            if (f.size === 1) { choix = [...f.values()]; forme = true; }
        }
        if (!choix.length) { causes.sansCandidat.push(p); continue; }
        if (choix.length > 1) {
            const n = choix.map(x => communes(p, x.c)), max = Math.max(...n);
            const meilleurs = choix.filter((x, i) => n[i] === max);
            if (max === 0 || meilleurs.length !== 1) { causes.ambigu.push({ p, candidats: choix.map(x => x.e.titre) }); continue; }
            choix = meilleurs;
        }
        const { c, e } = choix[0];
        if ((p.attaques || []).length && (c.attaques || []).length && communes(p, c) === 0) { causes.attaquesDiscordantes.push({ p, carte: c, entree: e.titre }); continue; }
        const o = origineDuSlug(p.slug, codeDuSet);
        if (o && e.b != null && cleNumero(o.numero) !== cleNumero(e.b)) { causes.origineDiscordante.push({ p, entree: e.titre, origine: o }); continue; }
        resolus.push({ p, carte: c, entree: e, deck: titre, cle: 'nom', temoins: [forme ? `écart de forme (« ${p.nom} » commence par « ${c.nomEn} », seule carte du deck)` : null,(p.attaques || []).length && (c.attaques || []).length ? `attaques ${communes(p, c)}/${p.attaques.length}` : 'sans attaque', o ? `origine du slug ${o.code}${o.numero} = n°${e.b}` : null].filter(Boolean) });
    }
    return { resolus, causes };
}

module.exports = { decksDeLaPage, prefixeDe, mesurerPrefixes, joindreParDeck, origineDuSlug };

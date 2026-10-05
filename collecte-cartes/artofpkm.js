// ============================================================
// THE ART OF POKÉMON (artofpkm.com) — la SOURCE D'IMAGES du japonais, toutes ères
// ============================================================
// Relevé du 2026-09-12 (SPEC-COLLECTE-IMAGES.md §1) : Rails rendu serveur, 419 sets PMCG→MEGA.
//   /sets/{id}/cards   : une entrée par carte —
//        <a data-lightbox-title="NOM, SET" data-lightbox-url="/sets/{id}/card/{n}"
//           href="https://cdn.artofpkm.com/{clé}"><img src="https://cdn.artofpkm.com/{clé-vignette}">
//        `href` est l'ORIGINAL (WebP 593×834 mesuré), `img src` la vignette 286×400.
//   /sets/{id}/card/{n} : <div class="italic">001/055</div> · <h1>Nom</h1><h3 class="ja">Nom JA</h3>
//        · « Illus. <a href="/illustrators/…"><span>Nom</span></a> » · <a href="/rarities/…">…
//        <span class="font-bold">Common (Old Back)</span></a> · en-tête du set <div class="font-bold">
//        SET</div><div class="ja …">SET JA</div>.
//
// ⚠️ LE SILENCE N'EST PAS UNE LICENCE. Le site ne revendique rien et n'interdit rien ; la demande
// à PKMJP est envoyée par le testeur (formulaire « Feedback » : https://forms.gle/3C8dBYCxbtMYHh3JA,
// X @pkm_jp). Si la réponse est non : `collecteur-images.js --arreter-et-effacer`.
//
// DÉBIT : une requête toutes les 5 s, jamais en parallèle, file propre à cet hôte (indépendante de
// celle de Bulbapedia — les deux collecteurs ne tournent jamais en même temps sur un même set, et
// chacun tient sa cadence sur SON hôte). Un seul réessai sur 5xx / réseau, après 30 s.

const axios = require('axios');
const crypto = require('crypto');

const BASE = 'https://www.artofpkm.com/';
const UA = 'rat-market-collecte/0.1 (https://rat-market.fr ; collecte images, contact via le site) axios';
const DELAI_MS = 5000;
const TAILLE_PAGE = 100;   // /sets/{id}/cards : 100 entrées par page, mesuré sur 4 listes le 2026-09-13

let _derniere = 0, _file = Promise.resolve(), _compte = 0;
const dodo = ms => new Promise(r => setTimeout(r, ms));
const decode = s => String(s || '').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&eacute;/g, 'é').replace(/&nbsp;/g, ' ');

/** Requête sérialisée et espacée de 5 s. `bin` : arraybuffer ; `range` : en-tête Range. */
function requete(url, { bin = false, range = null } = {}) {
    const tache = _file.then(async () => {
        for (let essai = 0; essai < 2; essai++) {
            const attente = _derniere + DELAI_MS - Date.now();
            if (attente > 0) await dodo(attente);
            _derniere = Date.now(); _compte++;
            try {
                const r = await axios.get(url, { headers: { 'User-Agent': UA, ...(range ? { Range: range } : {}) }, timeout: 60000, responseType: bin ? 'arraybuffer' : 'text', validateStatus: s => s < 500 });
                if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status} sur ${url}`), { status: r.status, definitif: true });
                return r;
            } catch (e) {
                if (e.definitif || essai === 1) throw e;
                console.warn(`   ↻ ${e.code || e.message} sur ${url} — un seul réessai dans 30 s`);
                await dodo(30000);
            }
        }
    });
    _file = tache.catch(() => { });
    return tache;
}
const compteRequetes = () => _compte;

/**
 * Les entrées d'un set, TOUTES PAGES.
 *
 * 🔴 LE SEPTIÈME ÉCHEC SILENCIEUX (CLAUDE.md §21), 2026-09-13. Quatre listes sur les 30 relues des 28
 * sets s'arrêtaient à n = 1…100 EXACTEMENT, sans un trou : Base Expansion Pack (EC1), Darkness and to
 * Light (N4), Pokémon Card★VS (VS), Secret of the Lakes (DP2) — trois de ces sets ont plus de cartes
 * (113, 142, 123). La liste s'arrêtait à « Aipom » ; Ambipom, son évolution, manquait. Le lien « page
 * suivante » était cherché par deux motifs devinés, aucun ne matchait, et la boucle rendait 100 entrées
 * comme un set complet. Un compte tronqué à une valeur RONDE est plausible : c'est ce qui l'a caché.
 *
 * LA RÈGLE, SANS DEVINER LE BALISAGE : une page PLEINE (autant d'entrées que la première) appelle la
 * page suivante par `?page=N` ; on s'arrête dès qu'une page n'apporte AUCUN n nouveau (un serveur qui
 * ignore le paramètre rend la page 1 : 0 nouvelle, arrêt, UNE requête perdue). Chaque page imprime son
 * compte : un paramètre ignoré se VOIT, il ne se devine pas.
 */
// 🔴 LE SITE A CHANGÉ DE GABARIT (constaté le 2026-10-05, date de la refonte inconnue) — et le lecteur rendait ZÉRO entrée pour TOUS les
// sets, sans erreur : l'original est passé de `href` à `data-lightbox-src`, `href` pointe la page de la carte, l'ordre des attributs a
// changé ; les lots suivants se chargent par des cadres dont l'adresse porte d'autres paramètres (`card_batches?direction=asc&amp;…
// &amp;offset=100&amp;sort=number`) et des SOUS-SECTIONS (`subset=625`). Le collecteur a refusé ces sets (« liste vide », garde du
// 2026-10-05) au lieu de les déclarer vérifiés, et l'audit les a rangés « liste vide chez artofpkm » : la sonde fabriquait le défaut.
// Les deux gabarits se lisent ci-dessous ; une entrée sans original reconnaissable est COMPTÉE et dite, jamais avalée.
// `(?:^|\s)` : le PREMIER attribut d'une balise suit `<a ` et n'a pas d'espace devant lui dans la chaîne capturée (le titre de l'ancien
// gabarit, premier attribut, sortait vide — trouvé par le banc le 2026-10-06)
const attribut = (s, nom) => { const m = s.match(new RegExp(`(?:^|\\s)${nom}="([^"]*)"`)); return m ? m[1] : null; };
const ORIGINAL = /^https:\/\/cdn\.artofpkm\.com\/[a-z0-9]+$/;

/** Les entrées d'UNE page de liste (les deux gabarits) et ses cadres de lots suivants — pur, testé sur des extraits réels. */
function lireListe(html) {
    const entrees = [];
    let sansOriginal = 0;
    for (const m of String(html).matchAll(/<a\s([^>]*data-lightbox-url="\/sets\/(\d+)\/card\/(\d+)"[^>]*)>([\s\S]*?)<\/a>/g)) {
        const a = m[1];
        const original = [attribut(a, 'data-lightbox-src'), attribut(a, 'href')].find(u => ORIGINAL.test(u || ''));
        if (!original) { sansOriginal++; continue; }
        const vignette = (m[4].match(/<img[^>]*\s(?:src|data-src)="([^"]+)"/) || [])[1] || null;
        entrees.push({ titre: decode(attribut(a, 'data-lightbox-title') || ''), sourceSetId: Number(m[2]), n: Number(m[3]), original, cleCdn: original.split('/').pop(), vignette });
    }
    const cadres = [...String(html).matchAll(/<turbo-frame[^>]*\ssrc="\/(sets\/\d+\/card_batches\?[^"]+)"/g)].map(m => decode(m[1]));
    return { entrees, cadres, sansOriginal };
}

// 🔴 UNE SOUS-SECTION EST UN SET À PART (relu le 2026-10-06). Un kit à deux decks (206, Leafeon vs Metagross Expert Deck) n'a AUCUNE
// carte à sa racine ; ses deux decks se chargent par des cadres `subset=642` / `subset=643`, et leurs liens pointent
// `/sets/643/card/1` — un AUTRE identifiant de set, les mêmes n que le premier deck. La clé d'une entrée est donc (sourceSetId, n) :
// par n seul, le second deck était jeté comme « déjà vu », et sa page demandée sous l'id du parent rendait 404 (ou une autre carte).
// Mesuré avant de changer : sur les 27 969 entrées des 346 listes en base, 0 porte un sourceSetId différent de sa liste.
const cleEntree = e => `${e.sourceSetId}/${e.n}`;

/** Le parcours d'une liste, lot après lot — pur : `lire(chemin)` rend le HTML d'une page (testé sans requête). */
async function parcourirListe(id, lire, { maxLots = 60, journal = console.log } = {}) {
    const entrees = [];
    const vuesN = new Set();
    // ⚠️ La taille de page est celle OBSERVÉE (4 listes arrêtées à 100 pile), pas celle de la page 1 : sinon
    // un set de 48 cartes, page « pleine » par définition, demanderait une page 2 pour rien.
    const taillePage = TAILLE_PAGE;
    // Le relevé page par page VOYAGE avec la liste (`entrees.pages`) : l'appelant l'écrit dans l'état. Le
    // 2026-09-14, la preuve de la page 2 n'existait que dans le log Render — un compte qui décide et ne vit
    // que dans un log n'est pas une mesure.
    // ✅ RÉSOLU LE 2026-09-15, MESURÉ : le serveur IGNORE `?page=2` — « page 2 : 100 entrées lues, 0 nouvelles » sur
    // sv4a (360 cartes), s4a (330), s8b (285), s12a. La suite se charge par un CADRE TURBO en fin de lot :
    // `<turbo-frame id="card_batch_100" src="/sets/506/card_batches?offset=100">`. On suit ce cadre, lot après lot ;
    // arrêt quand un lot n'apporte aucun n nouveau, ou quand il n'y a plus de cadre. Chaque lot imprime son compte.
    const releve = [];
    Object.defineProperty(entrees, 'pages', { value: releve, enumerable: false });
    // une FILE de cadres (le lot suivant ET les sous-sections), chacun lu une fois ; un cadre qui n'apporte aucun n nouveau n'ouvre pas
    // les siens (un serveur qui ignorerait un paramètre rendrait la même page : 0 nouvelle, arrêt de cette branche) ; 60 lots au plus
    const file = [`sets/${id}/cards`], vus = new Set(file);
    let sansOriginal = 0;
    for (let lot = 1; file.length && lot <= maxLots; lot++) {
        const chemin = file.shift();
        const L = lireListe(await lire(chemin));
        let nouvelles = 0;
        for (const e of L.entrees) { if (vuesN.has(cleEntree(e))) continue; vuesN.add(cleEntree(e)); nouvelles++; entrees.push(e); }
        sansOriginal += L.sansOriginal;
        // la page RACINE ouvre toujours ses cadres : un kit à deux decks n'y montre AUCUNE carte, seulement ses sous-sections
        const suites = (nouvelles || lot === 1) ? L.cadres.filter(c => !vus.has(c)) : [];
        for (const c of suites) { vus.add(c); file.push(c); }
        releve.push({ lot, chemin, lues: L.entrees.length, nouvelles, sansOriginal: L.sansOriginal, suites });
        journal(`   liste ${id} lot ${lot} (${chemin}) : ${L.entrees.length} entrées lues, ${nouvelles} nouvelles (cumul ${entrees.length})${L.sansOriginal ? ` · ⚠️ ${L.sansOriginal} lien(s) sans original reconnaissable` : ''}${suites.length ? ` → ${suites.length} cadre(s) à suivre` : ' · pas de lot suivant'}`);
    }
    // Les cadres NON LUS voyagent avec la liste, comme le relevé : l'appelant refuse une liste tronquée au lieu de la « vérifier ».
    Object.defineProperty(entrees, 'cadresNonLus', { value: file.length, enumerable: false });
    if (file.length) journal(`   ⚠️ liste ${id} : arrêt à ${maxLots} lots, ${file.length} cadre(s) non lus — la liste est INCOMPLÈTE`);
    if (sansOriginal) journal(`   ⚠️ liste ${id} : ${sansOriginal} lien(s) de carte sans original reconnaissable — gabarit à relire`);
    if (entrees.length && entrees.length % taillePage === 0) journal(`   ⚠️ liste ${id} : ${entrees.length} entrées, un multiple de ${taillePage} — un compte rond se vérifie (§21 n°7)`);
    return entrees;
}
const listerSet = id => parcourirListe(id, async chemin => (await requete(`${BASE}${chemin}`)).data);

/** La liste est-elle COMPLÈTE, relu dans son RELEVÉ — la seule trace qui survit au passage par l'état Mongo (`cadresNonLus`, propriété non
 *  énumérable, s'y perd). true : chaque cadre ouvert a été lu et chaque lot suivant a apporté des cartes ; false : un cadre non lu, ou un
 *  lot suivant SANS RIEN DE NOUVEAU — vide (page anti-robot) ou répété (un serveur qui ignore le paramètre rend la page 1) : la page
 *  précédente annonçait une suite, et la branche s'est arrêtée sans la lire ; null : pas un relevé de lots (inconnu).
 *  La forme du 2026-09-15 (`suite`, un cadre par lot) reste lue : complète si le dernier lot n'a pas de suite. */
function releveComplet(releve) {
    if (!Array.isArray(releve) || !releve.length || !releve.every(p => p && 'lot' in p)) return null;
    if (!releve.some(p => 'suites' in p)) return releve.at(-1).suite === null;
    const lus = new Set(releve.map(p => p.chemin));
    const nonLus = releve.flatMap(p => p.suites || []).filter(c => !lus.has(c));
    const steriles = releve.filter(p => p.lot > 1 && !p.nouvelles);
    return !nonLus.length && !steriles.length;
}

/** Les faits de la page d'une carte, les DEUX gabarits (voir lireListe) — pur, testé sur des extraits réels.
 *  Nouveau gabarit : le numéro n'est plus dans `div.italic`, il ouvre le <title> (« 001/187 Budew | The Art of Pokémon ») ; le nom
 *  japonais est un h2 ; l'illustrateur un lien direct ; l'original l'image de la galerie (index 0) ; le set le lien de retour. La RARETÉ
 *  n'y figure plus : null, jamais devinée (elle ne sert qu'au dernier départage des sets Gym). */
function lirePageCarte(html) {
    html = String(html);
    const prendre = re => { const m = html.match(re); return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : null; };
    const premier = (...res) => { for (const re of res) { const v = prendre(re); if (v) return v; } return null; };
    let numTot = prendre(/<div class="italic">([^<]+)<\/div>/);
    // le numéro du <title> doit porter un CHIFFRE : « Pikachu/Raichu LEGEND » n'est pas un numéro sur un total
    if (!numTot) { const t = prendre(/<title>([^<]+)<\/title>/); const m = t && t.match(/^\s*([A-Za-z-]*\d+[A-Za-z]*\/\S+)\s/); numTot = m ? m[1] : null; }
    const [numero, total] = numTot ? numTot.split('/').map(s => s.trim()) : [null, null];
    // L'image de la GALERIE d'abord (nouveau gabarit) : une page de carte peut porter des tuiles d'AUTRES cartes, rendues par le composant
    // de la liste — l'ancien sélecteur, essayé en premier, aurait pris la première d'entre elles (relecture du 2026-10-06).
    const galerie = (html.match(/<img[^>]*data-gallery-overlay-index-param="0"[^>]*>/) || [])[0];
    const original = (galerie && ORIGINAL.test(attribut(galerie, 'src') || '') ? attribut(galerie, 'src') : null)
        || (!galerie && (html.match(/<img class="w-full card-cut card-ratio[^"]*"[^>]*src="(https:\/\/cdn\.artofpkm\.com\/[a-z0-9]+)"/) || [])[1]) || null;
    return {
        numero: numero || null, total: total || null,
        nomEn: prendre(/<h1[^>]*>([^<]+)<\/h1>/),
        nomJa: premier(/<h3 class="ja[^"]*"[^>]*>([^<]+)<\/h3>/, /<h2 class="ja[^"]*"[^>]*>([^<]+)<\/h2>/),
        illustrateur: premier(/Illus\.\s*<\/span>\s*<a[^>]*href="\/illustrators\/[^"]*"[^>]*>\s*<span>([^<]+)<\/span>/, /Illus\.\s*<span[^>]*>\s*<a[^>]*href="\/illustrators\/[^"]*"[^>]*>([^<]+)<\/a>/),
        rarete: prendre(/href="\/rarities\/\d+"[^>]*>[\s\S]*?<span class="font-bold">([^<]+)<\/span>/),
        setNomSource: premier(/<div class="font-bold">([^<]+)<\/div><div class="ja[^"]*">/, /<a[^>]*href="\/sets\/\d+"[^>]*><svg[\s\S]*?<\/svg>([^<]+)<\/a>/),
        setNomJa: prendre(/<div class="font-bold">[^<]+<\/div><div class="ja[^"]*">([^<]+)<\/div>/),
        original: original || null
    };
}
async function pageCarte(id, n) { return lirePageCarte((await requete(`${BASE}sets/${id}/card/${n}`)).data); }

/** Dimensions d'une image depuis ses premiers octets (WebP, PNG, JPEG). */
function dimensions(buf) {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { fmt: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const c = buf.toString('ascii', 12, 16);
        if (c === 'VP8X') return { fmt: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
        if (c === 'VP8 ') return { fmt: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
        if (c === 'VP8L') { const b = buf.readUInt32LE(21); return { fmt: 'webp', w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i < buf.length - 9) {
            if (buf[i] !== 0xff) { i++; continue; }
            const m = buf[i + 1];
            if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { fmt: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
            i += 2 + buf.readUInt16BE(i + 2);
        }
        return { fmt: 'jpeg', w: null, h: null };
    }
    return { fmt: 'inconnu', w: null, h: null };
}

/** MESURE avant collecte : 64 Ko seulement, dimensions lues dans l'en-tête. */
async function enTeteImage(url) {
    const r = await requete(url, { bin: true, range: 'bytes=0-65535' });
    const buf = Buffer.from(r.data);
    const total = Number((r.headers['content-range'] || '').split('/')[1]) || Number(r.headers['content-length']) || null;
    return { ...dimensions(buf), octets: total, type: r.headers['content-type'] || null };
}

/** L'original entier : octets, sha256, dimensions, type. */
async function telecharger(url) {
    const r = await requete(url, { bin: true });
    const buf = Buffer.from(r.data);
    return { buffer: buf, octets: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), ...dimensions(buf), type: r.headers['content-type'] || null };
}

module.exports = { listerSet, parcourirListe, releveComplet, cleEntree, pageCarte, lireListe, lirePageCarte, enTeteImage, telecharger, dimensions, compteRequetes, BASE, UA };

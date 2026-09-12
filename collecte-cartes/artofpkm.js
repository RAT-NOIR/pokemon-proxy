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

/** Les entrées d'un set (toutes pages si `?page=` existe). */
async function listerSet(id) {
    const entrees = [];
    let url = `${BASE}sets/${id}/cards`;
    const vues = new Set();
    while (url && !vues.has(url)) {
        vues.add(url);
        const html = (await requete(url)).data;
        const re = /<a [^>]*data-lightbox-title="([^"]*)"[^>]*data-lightbox-url="\/sets\/(\d+)\/card\/(\d+)"[^>]*href="(https:\/\/cdn\.artofpkm\.com\/[a-z0-9]+)"[^>]*>\s*<img[^>]*(?:src|data-src)="([^"]+)"/g;
        for (const m of html.matchAll(re)) entrees.push({ titre: decode(m[1]), sourceSetId: Number(m[2]), n: Number(m[3]), original: m[4], cleCdn: m[4].split('/').pop(), vignette: m[5] });
        const suivant = html.match(/<a[^>]*rel="next"[^>]*href="([^"]+)"/) || html.match(/href="([^"]*[?&]page=\d+[^"]*)"[^>]*>\s*(?:Next|Suivant|›|&raquo;)/i);
        url = suivant ? new URL(decode(suivant[1]), BASE).href : null;
    }
    return entrees;
}

/** Les faits de la page d'une carte. */
async function pageCarte(id, n) {
    const html = (await requete(`${BASE}sets/${id}/card/${n}`)).data;
    const prendre = re => { const m = html.match(re); return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : null; };
    const numTot = prendre(/<div class="italic">([^<]+)<\/div>/);
    const [numero, total] = numTot ? numTot.split('/').map(s => s.trim()) : [null, null];
    return {
        numero: numero || null, total: total || null,
        nomEn: prendre(/<h1[^>]*>([^<]+)<\/h1>/),
        nomJa: prendre(/<h3 class="ja[^"]*"[^>]*>([^<]+)<\/h3>/),
        illustrateur: prendre(/Illus\.\s*<\/span>\s*<a[^>]*href="\/illustrators\/[^"]*"[^>]*>\s*<span>([^<]+)<\/span>/),
        rarete: prendre(/href="\/rarities\/\d+"[^>]*>[\s\S]*?<span class="font-bold">([^<]+)<\/span>/),
        setNomSource: prendre(/<div class="font-bold">([^<]+)<\/div><div class="ja[^"]*">/),
        setNomJa: prendre(/<div class="font-bold">[^<]+<\/div><div class="ja[^"]*">([^<]+)<\/div>/),
        original: (html.match(/<img class="w-full card-cut card-ratio[^"]*"[^>]*src="(https:\/\/cdn\.artofpkm\.com\/[a-z0-9]+)"/) || [])[1] || null
    };
}

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

module.exports = { listerSet, pageCarte, enTeteImage, telecharger, dimensions, compteRequetes, BASE, UA };

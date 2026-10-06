// ============================================================
// LES LOGOS COMPOSÉS — un logo commun + une étiquette propre au set (planche PROPOSITION-3 validée par le testeur le 2026-10-04)
// ============================================================
// 🔑 LA DEMANDE : POP « POP Série 1…9 » · Battle Academy : logo officiel + édition et ses decks · TOUTES les séries promos : logo de la
// série + ÉTOILE NOIRE derrière + « PROMOS » · McDonald's : logo McDonald's Collection + « Promo » et l'année. Le gabarit Pokécardex n'a
// inspiré que la mise en page — aucun de ses fichiers n'est repris. Validé tel quel, plus une correction : le fond BLANC du logo de l'ère
// Wizards (pokemontcglogooldpng.png) devient transparent (`transparentiserFond`).
// 🔑 LE SITE LIT `sets.logoCompose` (rat-market-site lib/visuelSet.ts) : après `logoFr`, avant `logo` ; preuve exigée (ici `region`,
// celle du set par construction) ; et un fichier porté par deux sets est GÉNÉRIQUE, donc refusé — chaque logo composé doit être UNIQUE
// (même logo de série = étiquette qui distingue, sinon le plan refuse).
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : la table COMPOSITIONS ÉNUMÈRE les sets ; un set qu'elle ne nomme pas ne reçoit rien, quel
// que soit son nom. Un set qui a déjà un logo PROPRE (non générique) ou déjà un logoCompose est GARDÉ, et le plan le dit.
// LES LANGUES : un logo de série est ANGLAIS (preuve « set occidental » de son set de tête) ; il ne va que sur un set occidental. Un set
// d'un autre tirage (svIba japonais, promos indonésiennes, thaïes, chinoises) reçoit l'étiquette — et l'étoile pour une série promo —
// SANS logo de série : la règle de langue des logos (langue-logo.js) l'interdirait, comme pour les visuels de cartes.
const crypto = require('crypto');
const sharp = require('sharp');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const L = 480;

// les LOGOS COMMUNS qui ne sont pas un logo de set en base : fichiers déposés sur R2 (logos/composes/sources/), empreinte vérifiée
const SOURCES = {
    pop: { fichier: 'pop9/logo.png (ptcg-assets)', sha1: '468cfd745dc7a8f9c73e5f5cb8701fc4824d5c55', cle: 'logos/composes/sources/pop-468cfd745d.png' },
    mcdonalds: { fichier: 'mcd14/logo.png (ptcg-assets) — logo McDonald\'s Collection', sha1: '8e87ff264e631834e8a44248675c594e6e36252b', cle: 'logos/composes/sources/mcdonalds-collection-8e87ff264e.png' },
    'battle-academy': { fichier: 'Pokemon_TCG_Battle_Academy_Logo.png (archives.bulbagarden.net)', sha1: '663a027a8b7f1c2e20b3f769312ba2f9e8cc41c2', cle: 'logos/composes/sources/battle-academy-663a027a8b.png' }
};

const promoSerie = (tete, sous) => ({ famille: 'promos', logo: { serie: tete }, etoile: true, etiquette: 'PROMOS', ...(sous ? { sous } : {}) });
const promoAsie = sous => ({ famille: 'promos', logo: null, etoile: true, etiquette: 'PROMOS', sous });
// (2026-10-07) la TABLE ÉTENDUE : les 272 sets publiés sans logo propre que la table à la main ne nomme pas, un par ligne, écrits par
// generer-logos-composes-etendus.js (ses règles dans son en-tête) et relus au commit. Lue sans repli : un fichier absent est une panne.
const ETENDUES = require('./logos-composes-etendus.json').compositions;
// (relecture) un fichier présent mais tronqué — sans `compositions`, ou vide — ferait perdre 272 sets au plan SANS une erreur
if (!ETENDUES || typeof ETENDUES !== 'object' || !Object.keys(ETENDUES).length) throw new Error('logos-composes-etendus.json : `compositions` absent ou vide — table étendue illisible');
const A_LA_MAIN = {
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`POP-Series-${n}`, { famille: 'pop', logo: { source: 'pop' }, etiquette: `POP Série ${n}` }])),
    'Battle-Academy-2020': { famille: 'battle-academy', logo: { source: 'battle-academy' }, etiquette: 'Édition 2020', sous: 'Dracaufeu-GX · Raichu-GX · Mewtwo-GX' },
    'Battle-Academy-2022': { famille: 'battle-academy', logo: { source: 'battle-academy' }, etiquette: 'Édition 2022', sous: 'Pikachu V · Pyrobut V · Évoli V' },
    'Battle-Academy-2024': { famille: 'battle-academy', logo: { source: 'battle-academy' }, etiquette: 'Édition 2024', sous: 'Carmadura-ex · Darkrai-ex · Pikachu-ex' },
    'Scarlet-Violet-Battle-Academy': { famille: 'battle-academy', logo: null, etiquette: 'Battle Academy', sous: 'Écarlate et Violet · Japon' },
    ...Object.fromEntries([2012, 2013, 2014, 2015, 2016, 2017, 2019, 2022].map(a => [`McDonalds-Collection-${a}`, { famille: 'mcdonalds', logo: { source: 'mcdonalds' }, etiquette: `Promo ${a}` }])),
    'McDonalds-Match-Battle-2023': { famille: 'mcdonalds', logo: { source: 'mcdonalds' }, etiquette: 'Promo 2023', sous: 'Match Battle' },
    // les séries promos OCCIDENTALES : le logo du set de tête de la série (sa preuve en base : « set occidental »)
    'Wizards-Black-Star-Promos': promoSerie('Base-Set'),
    'W-Promos': promoSerie('Base-Set', 'W Promotional cards'),   // même série que WP : l'étiquette les distingue
    'Nintendo-Black-Star-Promos': promoSerie('EX-Ruby-Sapphire'),
    'DP-Black-Star-Promos': promoSerie('Diamond-Pearl'),
    'HGSS-Black-Star-Promos': promoSerie('HeartGold-SoulSilver'),
    'BW-Black-Star-Promos': promoSerie('Black-White'),
    'XY-Black-Star-Promos': promoSerie('XY'),
    'SM-Black-Star-Promos': promoSerie('Sun-Moon'),
    'SWSH-Black-Star-Promos': promoSerie('Sword-Shield'),
    'SV-Black-Star-Promos': promoSerie('Scarlet-Violet'),
    'MEP-Black-Star-Promos': promoSerie('Mega-Evolution'),
    // séries promos d'AUTRES tirages : l'étoile et « PROMOS », la série et la langue en sous-titre, sans logo de série (anglais)
    'Southeast-Asia-Promos': promoAsie('Asie du Sud-Est'),
    'M-P-Indonesian-Promos': promoAsie('Méga-Évolution · indonésien'),
    'M-P-Thai-Promos': promoAsie('Méga-Évolution · thaï'),
    'M-P-Traditional-Chinese-Promos': promoAsie('Méga-Évolution · chinois traditionnel'),
    'Scarlet-Violet-Indonesian-Promos': promoAsie('Écarlate et Violet · indonésien'),
    'Scarlet-Violet-Thai-Promos': promoAsie('Écarlate et Violet · thaï'),
    'Sun-Moon-Indonesian-Promos': promoAsie('Soleil et Lune · indonésien'),
    'Sword-Shield-Indonesian-Promos': promoAsie('Épée et Bouclier · indonésien'),
    'Sword-Shield-Thai-Promos': promoAsie('Épée et Bouclier · thaï')
};
// la table à la main l'emporte sur l'étendue (le générateur ne liste pas ses sets, mais une régénération ne la remplace jamais)
const COMPOSITIONS = { ...ETENDUES, ...A_LA_MAIN };

/** Le logo d'un set est-il générique ? Le marquage du serveur, ou un sha1 porté par des sets de deux pages (la règle du site). */
function generiquesDe(sets) {
    const pages = new Map();
    for (const s of sets) for (const ch of ['logo', 'logoFr', 'logoCompose']) {
        const h = s[ch]?.sha1?.trim().toLowerCase(); if (!h) continue;
        (pages.get(h) || pages.set(h, new Set()).get(h)).add(s.bulba?.pageid != null ? `page:${s.bulba.pageid}` : `set:${s._id}`);
    }
    return new Set([...pages].filter(([, p]) => p.size > 1).map(([h]) => h));
}
const aUneImage = im => !!im && typeof im.cleR2 === 'string' && im.cleR2.length > 0;

/**
 * Le PLAN : une ligne par set de COMPOSITIONS — action 'ecrire' (aucun logo, ou logo générique), 'garde-logo-propre', 'garde-deja-compose',
 * ou 'refus' (set absent, set de tête sans logo occidental, logo de série sur un set non occidental). Fonction pure.
 */
function planifier(sets, compositions = COMPOSITIONS) {
    const parSlug = new Map(sets.map(s => [s._id, s]));
    const gen = generiquesDe(sets);
    const out = [];
    for (const [slug, c] of Object.entries(compositions)) {
        const s = parSlug.get(slug);
        const base = { slug, ...c };
        if (!s) { out.push({ ...base, action: 'refus', raison: 'set absent de la base' }); continue; }
        base.region = s.region ?? null; base.tirage = s.tirage ?? s.region ?? null;
        if (!['intl', 'jp'].includes(base.region)) { out.push({ ...base, action: 'refus', raison: `region « ${base.region} » inconnue` }); continue; }
        if (aUneImage(s.logoCompose)) { out.push({ ...base, action: 'garde-deja-compose', raison: `logoCompose déjà posé (${s.logoCompose.cleR2})` }); continue; }
        const propre = aUneImage(s.logo) && s.logo.logoGenerique !== true && !(s.logo.sha1 && gen.has(String(s.logo.sha1).toLowerCase()));
        if (propre) { out.push({ ...base, action: 'garde-logo-propre', raison: `logo propre au set (${s.logo.cleR2})` }); continue; }
        if (c.logo?.serie) {
            if (base.tirage !== 'intl') { out.push({ ...base, action: 'refus', raison: `logo de série ANGLAIS sur un tirage « ${base.tirage} »` }); continue; }
            const t = parSlug.get(c.logo.serie);
            if (!aUneImage(t?.logo) || !/set occidental/.test(String(t.logo.preuve ?? ''))) { out.push({ ...base, action: 'refus', raison: `set de tête ${c.logo.serie} sans logo occidental prouvé` }); continue; }
            base.logoCle = t.logo.cleR2;
        } else if (c.logo?.source) {
            if (!SOURCES[c.logo.source]) { out.push({ ...base, action: 'refus', raison: `source « ${c.logo.source} » inconnue` }); continue; }
            if (base.tirage !== 'intl') { out.push({ ...base, action: 'refus', raison: `logo commun anglais sur un tirage « ${base.tirage} »` }); continue; }
            base.logoCle = SOURCES[c.logo.source].cle;
        } else base.logoCle = null;
        out.push({ ...base, action: 'ecrire', raison: aUneImage(s.logo) ? 'logo actuel GÉNÉRIQUE' : 'aucun logo' });
    }
    return out;
}

/** Deux lignes à écrire qui composeraient le MÊME logo seraient génériques pour le site : le plan les nomme. */
function collisions(plan) {
    const parCle = new Map();
    for (const p of plan.filter(p => p.action === 'ecrire')) { const k = JSON.stringify([p.logoCle, !!p.etoile, p.etiquette, p.sous ?? null]); (parCle.get(k) || parCle.set(k, []).get(k)).push(p.slug); }
    return [...parCle.values()].filter(v => v.length > 1);
}

/** Le fond d'un logo est-il un aplat BLANC opaque (les quatre coins) ? */
async function fondBlancOpaque(buf) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    return [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]].every(([x, y]) => { const [r, g, b, a] = px(x, y); return a > 200 && Math.min(r, g, b) > 230; });
}

/**
 * Le fond blanc devient transparent : remplissage depuis les BORDS (un blanc enfermé dans le dessin reste), puis un liseré adouci —
 * un pixel clair qui touche le fond prend une transparence proportionnelle à sa clarté (l'anticrénelage du blanc d'origine).
 */
async function transparentiserFond(buf, { seuil = 225, liseré = 170 } = {}) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, n = W * H;
    const clair = i => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const fond = new Uint8Array(n), pile = [];
    for (let x = 0; x < W; x++) { pile.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { pile.push(y * W, y * W + W - 1); }
    while (pile.length) {
        const i = pile.pop();
        if (fond[i] || clair(i) < seuil) continue;
        fond[i] = 1;
        const x = i % W, y = (i - x) / W;
        if (x > 0) pile.push(i - 1); if (x < W - 1) pile.push(i + 1); if (y > 0) pile.push(i - W); if (y < H - 1) pile.push(i + W);
    }
    for (let i = 0; i < n; i++) {
        if (fond[i]) { data[i * 4 + 3] = 0; continue; }
        const c = clair(i); if (c < liseré) continue;
        const x = i % W, y = (i - x) / W;
        const voisin = (x > 0 && fond[i - 1]) || (x < W - 1 && fond[i + 1]) || (y > 0 && fond[i - W]) || (y < H - 1 && fond[i + W]);
        if (voisin) data[i * 4 + 3] = Math.min(data[i * 4 + 3], Math.round(255 * (255 - c) / (255 - liseré)));
    }
    return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

// ── LE RENDU : celui de la planche validée (PROPOSITION-3), à l'identique ──────────────────────────────────────────────────────────
// (2026-10-07) au-delà de 22 caractères — 175 des 272 sets sans logo, jusqu'à 61 — l'étiquette passe sur DEUX lignes, coupées à l'espace
// qui équilibre le mieux, la taille réduite pour tenir dans la largeur. Une étiquette de 22 caractères au plus rend le SVG d'avant au
// caractère près (banc : le rendu validé ne bouge pas).
function lignesEtiquette(texte, max = 22) {
    if (texte.length <= max) return [texte];
    let mieux = null;
    for (let i = texte.indexOf(' '); i > 0; i = texte.indexOf(' ', i + 1)) {
        const l = [texte.slice(0, i), texte.slice(i + 1)];
        if (/&$/.test(l[0])) continue;      // (relecture) jamais une ligne qui finit sur « & » : la coupe se fait avant
        if (!mieux || Math.max(...l.map(x => x.length)) < Math.max(...mieux.map(x => x.length))) mieux = l;
    }
    // (relecture) une étiquette longue SANS espace déborderait en silence sur une ligne : elle lève
    if (!mieux) throw new Error(`étiquette « ${texte} » : ${texte.length} caractères sans espace où couper`);
    return mieux;
}
function svgEtiquette(texte, sous, { largeur = 400, haut = sous ? 84 : 66 } = {}) {
    const lignes = lignesEtiquette(texte);
    if (lignes.length === 2) {
        const f = Math.min(24, Math.floor((largeur - 48) / (0.62 * Math.max(...lignes.map(l => l.length)))));
        // (relecture) sous 14 px, l'étiquette ne se lit plus : on lève plutôt que de rendre un logo illisible
        if (f < 14) throw new Error(`étiquette « ${texte} » : ${f} px sur deux lignes — trop longue pour ${largeur} px`);
        const lh = Math.round(f * 1.18), h = Math.max(haut, 18 + f + lh + (sous ? 30 : 0) + 20);
        const y1 = Math.round((h - (f + lh + (sous ? 30 : 0))) / 2 + f * 0.85), y2 = y1 + lh;
        return { haut: h, largeur, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${h}">
      <rect x="0" y="0" width="${largeur}" height="${h}" rx="16" fill="#151922" stroke="#e8b23a" stroke-width="2"/>
      <rect x="0" y="0" width="9" height="${h}" rx="4" fill="#e8b23a"/>
      ${lignes.map((l, i) => `<text x="${largeur / 2}" y="${i ? y2 : y1}" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${f}" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${esc(l)}</text>`).join('\n      ')}
      ${sous ? `<text x="${largeur / 2}" y="${y2 + 28}" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="17" fill="#e8b23a" text-anchor="middle">${esc(sous)}</text>` : ''}
      <text x="${largeur - 12}" y="${h - 7}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#7d8696" text-anchor="end">RAT-MARKET</text></svg>` };
    }
    const t = texte.length > 22 ? 24 : 30;
    const y = sous ? 36 : haut / 2 + t / 3;
    return { haut, largeur, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${haut}">
      <rect x="0" y="0" width="${largeur}" height="${haut}" rx="16" fill="#151922" stroke="#e8b23a" stroke-width="2"/>
      <rect x="0" y="0" width="9" height="${haut}" rx="4" fill="#e8b23a"/>
      <text x="${largeur / 2}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${t}" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${esc(texte)}</text>
      ${sous ? `<text x="${largeur / 2}" y="${y + 28}" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="17" fill="#e8b23a" text-anchor="middle">${esc(sous)}</text>` : ''}
      <text x="${largeur - 12}" y="${haut - 7}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#7d8696" text-anchor="end">RAT-MARKET</text></svg>` };
}
const svgEtoile = d => { const c = d / 2, R1 = d / 2, R2 = d * 0.21; const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R2 : R1; p.push(`${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`); } return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><polygon points="${p.join(' ')}" fill="#0b0c0f" stroke="#e8b23a" stroke-width="3" stroke-linejoin="round"/></svg>`; };
async function luminanceEncre(png) {
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let s = 0, n = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++; }
    return n ? s / n : 255;
}
/** Compose le PNG d'une ligne du plan. `logo` : le buffer du logo commun, ou null (étiquette, et l'étoile pour une série promo). */
async function composer({ logo, etiquette, sous, etoile = false, maxLogoH = 190 }) {
    const lab = svgEtiquette(etiquette, sous);
    if (!logo && !etoile) {   // étiquette seule (svIba : le logo officiel est anglais)
        const e = svgEtiquette(etiquette, sous, { largeur: 440, haut: 120 });
        return sharp(Buffer.from(e.svg)).png().toBuffer();
    }
    const calques = [];
    let top = 0, hZone = 0, lg = null, sombre = false;
    if (logo) {
        if (await fondBlancOpaque(logo)) logo = await transparentiserFond(logo);
        lg = await sharp(logo).trim().resize({ width: etoile ? 290 : 400, height: etoile ? 150 : maxLogoH, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
        sombre = !etoile && await luminanceEncre(lg.data) < 90;
        hZone = lg.info.height;
    }
    if (etoile) {
        // sans logo de série (autre tirage), l'étoile seule, à la taille d'une étoile derrière un logo moyen
        const d = lg ? Math.round(Math.min(Math.max(lg.info.width * 0.95, lg.info.height * 1.7, 200), 300)) : 220;
        calques.push({ input: Buffer.from(svgEtoile(d)), left: Math.round((L - d) / 2), top: 0 });
        if (lg) top = Math.round((d - lg.info.height) / 2) - 8;
        hZone = d;
    }
    if (lg) {
        if (sombre) calques.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lg.info.width + 40}" height="${lg.info.height + 24}"><rect width="100%" height="100%" rx="18" fill="#f5f6f8"/></svg>`), left: Math.round((L - lg.info.width) / 2) - 20, top: 0 });
        calques.push({ input: lg.data, left: Math.round((L - lg.info.width) / 2), top: top + (sombre ? 12 : 0) });
    }
    const yLab = hZone + (sombre ? 24 : 0) + 10;
    calques.push({ input: Buffer.from(lab.svg), left: Math.round((L - lab.largeur) / 2), top: yLab });
    return sharp({ create: { width: L, height: yLab + lab.haut + 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(calques).png().toBuffer();
}

const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');
const cleDe = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.-]+/g, '-').replace(/-+/g, '-');

module.exports = { COMPOSITIONS, A_LA_MAIN, SOURCES, planifier, collisions, composer, transparentiserFond, fondBlancOpaque, generiquesDe, sha1, cleDe, lignesEtiquette, svgEtiquette };

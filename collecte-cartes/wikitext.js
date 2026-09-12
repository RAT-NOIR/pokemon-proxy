// ============================================================
// WIKITEXT — parseur de gabarits, ÉPURATION, extraction des FAITS
// ============================================================
// Ce qu'on garde et ce qu'on jette est une décision de conformité, pas de commodité (licence
// CC BY-NC-SA du texte de Bulbapedia, site commercial de notre côté) :
//   · FAITS, gardés : numéro, total, dates, noms EN/JA, illustrateur, PV, type, stade, rareté,
//     n° Pokédex, NOMS d'attaques, coûts, dégâts, faiblesse, résistance, retraite, appartenance au set.
//   · TEXTE, jeté AVANT toute écriture : effets d'attaque (`effect`), traductions Bulbapedia
//     (`jtrans`), textes de Pokédex (`dex`, `jdex`, `transdex`), textes de dresseur (`text`, `jtext`,
//     `rule`), et TOUTE la prose hors gabarits (paragraphes, sections, trivia).
// L'épuration s'applique au wikitext AVANT son dépôt sur R2 : l'archive « brute » ne contient donc
// jamais le texte protégé. Les faits restent reparsables depuis elle.
//
// Le parseur est volontairement simple : gabarits de premier niveau, paramètres séparés au `|` de
// premier niveau (les `{{…}}` et `[[…]]` imbriqués sont respectés), valeurs gardées BRUTES. Les
// aides `plat()` et `nomDePage()` en tirent une valeur lisible quand on en a besoin.

const PARAMS_TEXTE = new Set(['effect', 'jtrans', 'dex', 'jdex', 'transdex', 'text', 'jtext', 'rule', 'jrule', 'trivia', 'jgroup']);

/**
 * Gabarits de premier niveau d'un wikitext.
 * @returns {Array<{nom: string, params: object, positionnels: string[], brut: string, debut: number, fin: number}>}
 */
function gabarits(texte) {
    const out = [];
    let i = 0;
    const n = texte.length;
    while (i < n) {
        if (texte.startsWith('{{', i)) {
            const fin = finDeGabarit(texte, i);
            if (fin < 0) break;
            out.push(analyserGabarit(texte.slice(i, fin), i, fin));
            i = fin;
        } else i++;
    }
    return out;
}

// Rend l'index juste APRÈS le `}}` fermant du gabarit ouvert en `debut`, ou -1.
function finDeGabarit(texte, debut) {
    let prof = 0, i = debut;
    while (i < texte.length) {
        if (texte.startsWith('{{', i)) { prof++; i += 2; continue; }
        if (texte.startsWith('}}', i)) { prof--; i += 2; if (prof === 0) return i; continue; }
        i++;
    }
    return -1;
}

// Découpe `{{nom|a|b=c}}` en nom + paramètres, au `|` de premier niveau seulement.
function analyserGabarit(brut, debut, fin) {
    const corps = brut.slice(2, -2);
    const morceaux = [];
    let prof = 0, crochets = 0, courant = '';
    for (let i = 0; i < corps.length; i++) {
        if (corps.startsWith('{{', i)) { prof++; courant += '{{'; i++; continue; }
        if (corps.startsWith('}}', i)) { prof--; courant += '}}'; i++; continue; }
        if (corps.startsWith('[[', i)) { crochets++; courant += '[['; i++; continue; }
        if (corps.startsWith(']]', i)) { crochets--; courant += ']]'; i++; continue; }
        if (corps[i] === '|' && prof === 0 && crochets === 0) { morceaux.push(courant); courant = ''; continue; }
        courant += corps[i];
    }
    morceaux.push(courant);
    const nom = morceaux.shift().trim();
    const params = {}, positionnels = [];
    for (const m of morceaux) {
        const eq = m.indexOf('=');
        // Un `=` à l'intérieur d'un gabarit imbriqué n'est pas un séparateur : on ne prend que
        // ceux qui précèdent toute accolade.
        const premiereAccolade = m.indexOf('{{');
        if (eq >= 0 && (premiereAccolade < 0 || eq < premiereAccolade)) params[m.slice(0, eq).trim()] = m.slice(eq + 1).trim();
        else positionnels.push(m.trim());
    }
    return { nom, params, positionnels, brut, debut, fin };
}

/** Recompose un gabarit à partir de ses paramètres (pour l'épuration). Un paramètre par ligne. */
function recomposer(g) {
    const lignes = [g.nom, ...g.positionnels.map(p => p), ...Object.entries(g.params).map(([k, v]) => `${k}=${v}`)];
    return '{{' + lignes.join('\n|') + '\n}}';
}

/**
 * ÉPURATION : ne garde que les gabarits de premier niveau, avec les paramètres de TEXTE vidés.
 * Toute prose hors gabarits disparaît. Idempotente : épurer(épurer(x)) === épurer(x).
 */
function epurer(texte) {
    return gabarits(texte).map(g => {
        const copie = { ...g, params: { ...g.params } };
        for (const k of Object.keys(copie.params)) {
            if (PARAMS_TEXTE.has(k.toLowerCase())) copie.params[k] = '';
        }
        return recomposer(copie);
    }).join('\n');
}

// ---- aides de lecture des valeurs ------------------------------------------

/** `{{TCG|Base Set}}` -> Base Set ; `{{TCG|X|Affiché}}` -> X (le nom de PAGE, pas l'affichage). */
function nomDePage(valeur) {
    if (!valeur) return null;
    const m = String(valeur).match(/\{\{\s*(?:TCG|tcg)\s*\|([^|}]+)/);
    if (m) return m[1].trim();
    return plat(valeur) || null;
}

/** Valeur lisible : gabarits d'affichage remplacés par leur argument, liens et balises retirés. */
function plat(valeur) {
    if (valeur == null) return '';
    let s = String(valeur);
    s = s.replace(/\{\{\s*(?:rar|e|ct|tt)\s*\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1');
    s = s.replace(/\{\{\s*TCG\s*\|([^|}]+)(?:\|([^}]*))?\}\}/g, (_, a, b) => (b || a).trim());
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
    s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/'''|''/g, '');
    return s.replace(/\s+/g, ' ').trim();
}

/** Coût d'attaque `{{e|Lightning}}{{e|Colorless}}` -> ['Lightning', 'Colorless']. */
function coutEnergie(valeur) {
    return [...String(valeur || '').matchAll(/\{\{\s*e\s*\|([^|}]+)/g)].map(m => m[1].trim());
}

/** Illustrateur depuis une légende « … Illus. [[Nom]] » (ou `illustrator=` s'il existe). */
function illustrateurDe(g) {
    if (g.params.illustrator) return plat(g.params.illustrator) || null;
    const m = String(g.params.caption || '').match(/Illus\.\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
    return m ? m[1].trim() : null;
}

/** `58/102` -> { numero: '58', total: '102' } ; `13` -> { numero: '13', total: null } ; vide -> nuls. */
function numeroTotal(valeur) {
    const s = plat(valeur);
    if (!s) return { numero: null, total: null };
    const m = s.match(/^([^/]+?)(?:\s*\/\s*(.+))?$/);
    return { numero: m ? m[1].trim() : s, total: m && m[2] ? m[2].trim() : null };
}

// ---- extraction ---------------------------------------------------------------

// Noms RÉELS des infobox, relevés sur les 102 pages d'EXP le 2026-09-12 : les dresseurs et les
// énergies ne s'appellent pas « TrainercardInfobox » mais « TCGTrainerCardInfobox » /
// « TCGEnergyCardInfobox », et leurs impressions sont IMBRIQUÉES dans un `/ReleaseInfo|releases=`.
const CATEGORIE_PAR_INFOBOX = {
    'PokémoncardInfobox': 'pokemon',
    'TCGTrainerCardInfobox': 'dresseur', 'TrainercardInfobox': 'dresseur',
    'TCGEnergyCardInfobox': 'energie', 'EnergycardInfobox': 'energie'
};

/** Toutes les entrées `…Infobox/Expansion`, au premier niveau OU imbriquées dans un `/ReleaseInfo`. */
function entreesExpansion(gs) {
    const out = [];
    for (const g of gs) {
        if (/Infobox\/Expansion$/.test(g.nom)) out.push(g);
        else if (/Infobox\/ReleaseInfo$/.test(g.nom) && g.params.releases) out.push(...gabarits(g.params.releases).filter(x => /Infobox\/Expansion$/.test(x.nom)));
    }
    return out;
}

/**
 * Les FAITS d'une page de carte. Rend aussi `champsNuls` pour le compte de la relecture.
 */
function faitsDeCarte(texte) {
    const gs = gabarits(texte);
    const infobox = gs.find(g => CATEGORIE_PAR_INFOBOX[g.nom]);
    const impressions = entreesExpansion(gs).flatMap(g => {
        const out = [];
        if (g.params.expansion) {
            const { numero, total } = numeroTotal(g.params.cardno);
            out.push({ tirage: 'intl', expansion: nomDePage(g.params.expansion), deck: plat(g.params.deck) || null, numero, total, rarete: plat(g.params.rarity) || null });
        }
        if (g.params.jpexpansion || g.params.jpdeckkit) {
            const { numero, total } = numeroTotal(g.params.jpcardno);
            out.push({
                tirage: 'jp', expansion: nomDePage(g.params.jpexpansion || g.params.jpdeckkit),
                deck: plat(g.params.jpdeck || g.params.jphalfdeck) || null, numero, total, rarete: plat(g.params.jprarity) || null
            });
        }
        return out;
    });
    // Une page porte parfois PLUSIEURS blocs « Card text » (tirage initial, réimpression au texte
    // différent) : les attaques strictement identiques sont fusionnées, les autres gardées — une
    // réimpression à 20 dégâts au lieu de 10 est un fait, pas un doublon.
    const vues = new Set();
    const attaques = gs.filter(g => g.nom === 'Cardtext/Attack').map(g => ({
        nom: plat(g.params.name) || null,
        nomJa: plat(g.params.jname) || null,
        cout: coutEnergie(g.params.cost),
        degats: plat(g.params.damage) || null
    })).filter(a => { const k = JSON.stringify(a); if (vues.has(k)) return false; vues.add(k); return true; });
    const carddex = gs.find(g => g.nom === 'Carddex');
    const p = infobox?.params || {};
    const carte = {
        categorie: infobox ? CATEGORIE_PAR_INFOBOX[infobox.nom] : null,
        nomEn: plat(p.cardname) || null,
        nomJa: plat(p.jname) || null,
        type: plat(p.type) || null,
        pv: p.hp != null && plat(p.hp) !== '' ? Number(plat(p.hp)) || plat(p.hp) : null,
        stade: plat(p.evostage) || null,
        ndex: carddex && plat(carddex.params.ndex) ? parseInt(plat(carddex.params.ndex), 10) : null,
        illustrateur: infobox ? illustrateurDe(infobox) : null,
        faiblesse: plat(p.weakness) || null,
        resistance: plat(p.resistance) || null,
        retraite: p.retreatcost != null && plat(p.retreatcost) !== '' ? Number(plat(p.retreatcost)) : null,
        attaques,
        impressions
    };
    const attendus = carte.categorie === 'pokemon'
        ? ['nomEn', 'nomJa', 'type', 'pv', 'stade', 'ndex', 'illustrateur', 'attaques']
        : ['nomEn', 'nomJa', 'illustrateur'];
    carte.champsNuls = attendus.filter(k => carte[k] == null || (Array.isArray(carte[k]) && carte[k].length === 0));
    return carte;
}

/** Les FAITS d'une page de set (`TCGExpansionInfobox`). */
function faitsDeSet(texte) {
    const g = gabarits(texte).find(x => x.nom === 'TCGExpansionInfobox');
    if (!g) return null;
    const p = g.params;
    const entier = v => { const s = plat(v); const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; };
    return {
        nomEn: plat(p.setname) || null,
        nomJa: plat(p.jasetname) || null,
        nomJaTraduit: plat(p.transsetname) || null,
        cartesEn: entier(p.encards),
        cartesJa: entier(p.jacards),
        sortieEn: plat(p.enrelease) || null,
        sortieJa: plat(p.jarelease) || null
    };
}

module.exports = { gabarits, epurer, faitsDeCarte, faitsDeSet, plat, nomDePage, numeroTotal, PARAMS_TEXTE };

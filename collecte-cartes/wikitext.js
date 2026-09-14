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
/**
 * @param {object} [stats] rempli si fourni : ce que l'épuration a VU et ce qu'elle a FAIT.
 * ⚠️ SANS CE COMPTE, UN GABARIT A FUI JUSQU'AU HTML DU SITE (`{{j|151}}`, 2026-09-12). Une étape qui
 * transforme doit dire ce qu'elle a transformé, sinon personne ne voit ce qu'elle laisse passer.
 */
function epurer(texte, stats = null) {
    const gs = gabarits(texte);
    let vides = 0;
    const sortie = gs.map(g => {
        const copie = { ...g, params: { ...g.params } };
        for (const k of Object.keys(copie.params)) {
            if (PARAMS_TEXTE.has(k.toLowerCase()) && String(copie.params[k]).trim() !== '') { copie.params[k] = ''; vides++; }
        }
        return recomposer(copie);
    }).join('\n');
    if (stats) {
        stats.gabarits = (stats.gabarits || 0) + gs.length;
        stats.paramsVides = (stats.paramsVides || 0) + vides;
        stats.octetsAvant = (stats.octetsAvant || 0) + texte.length;
        stats.octetsApres = (stats.octetsApres || 0) + sortie.length;
        stats.pages = (stats.pages || 0) + 1;
    }
    return sortie;
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
    // `j` : le gabarit d'insertion de japonais — `{{j|151}}` dans « ポケモンカード{{j|151}} ».
    s = s.replace(/\{\{\s*(?:rar|e|ct|tt|j)\s*\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1');
    s = s.replace(/\{\{\s*TCG\s*\|([^|}]+)(?:\|([^}]*))?\}\}/g, (_, a, b) => (b || a).trim());
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
    s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/'''|''/g, '');
    // 🔴 LE FILET, ET IL EXISTE PARCE QU'UN GABARIT A FUI JUSQU'AU HTML DU SITE (2026-09-12).
    // `{{j|151}}` est sorti de la collecte, s'est écrit en base et s'est affiché tel quel sur une
    // fiche : aucune étape ne regardait le CONTENU de ce qu'elle comptait (CLAUDE.md §22). Tout
    // gabarit d'affichage inconnu est désormais réduit à son dernier argument — la convention des
    // modèles de présentation — et `contientGabarit` permet de les COMPTER avant de les servir.
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, dedans) => {
        const args = String(dedans).split('|').map(x => x.trim()).filter(Boolean);
        return args.length > 1 ? args[args.length - 1] : '';
    });
    return s.replace(/\s+/g, ' ').trim();
}

/** Un champ porte-t-il encore un gabarit non développé ? À vérifier AVANT de servir une donnée. */
const contientGabarit = v => /\{\{|\}\}/.test(String(v ?? ''));

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

// 🔴 LE CHAMP « JAPONAIS » N'EST PAS TOUJOURS JAPONAIS — mesuré le 2026-09-14 sur les 2 981 pages archivées.
// `jpexpansion=` porte parfois une impression d'une AUTRE langue d'Asie, sous son propre gabarit :
// `{{ATCG|Gem Pack Vol. 1}} (Simplified Chinese)` (Quaxly, Fuecoco de Paldea Evolved), et même trois à
// la fois : `{{TCTCG|SV-P Promotional cards}} (Traditional Chinese)<br>{{ITCG|…}} (Indonesian)<br>{{TTCG|…}} (Thai)`.
// `nomDePage` ne reconnaît que `{{TCG|}}` : le reste tombait dans le filet de `plat` et s'écrivait en
// base comme une impression `tirage: 'jp'` nommée « Gem Pack Vol. 1 (Simplified Chinese) ». 3 pages sur
// 2 981 aujourd'hui — et 20 expansions chinoises de Cardmarket sont rangées « japonais » : à l'échelle
// du japonais moderne, ce défaut aurait fabriqué des tirages japonais faux.
// SEUL `{{TCG|}}` EST JAPONAIS. Chaque autre gabarit rend son tirage, que tous les consommateurs
// ignorent (ils filtrent `tirage === 'jp'` ou `'intl'`, jamais « pas jp ») ; un gabarit inconnu rend
// `tirage: 'inconnu'`, visible au lieu d'être deviné.
const TIRAGE_PAR_GABARIT = { TCG: 'jp', ATCG: 'zh-hans', TCTCG: 'zh-hant', ITCG: 'id', TTCG: 'th', KTCG: 'ko' };

/** Les impressions d'un champ `jpexpansion` / `jpdeckkit` : une par gabarit d'expansion, chacune avec SON tirage. */
function impressionsDuChampAsiatique(g) {
    const valeur = String(g.params.jpexpansion || g.params.jpdeckkit);
    const gabs = [...valeur.matchAll(/\{\{\s*([A-Za-z]*TCG)\s*\|([^|}]+)/g)];
    const base = { deck: plat(g.params.jpdeck || g.params.jphalfdeck) || null, rarete: plat(g.params.jprarity) || null, ...numeroTotal(g.params.jpcardno) };
    // Sans gabarit, OU seulement des {{TCG}} : l'ancien comportement à l'identique, un seul tirage
    // japonais. ⚠️ Premier jet découpant tout champ à plusieurs gabarits : les 3 pages « Entry Pack '08 »
    // (deux {{TCG}} dans le champ) passaient de 3 impressions AVEC deck à 6 SANS deck — vu en rejouant les
    // 2 981 pages contre la base avant tout commit.
    if (gabs.every(m => m[1].toUpperCase() === 'TCG')) return [{ tirage: 'jp', expansion: nomDePage(valeur), ...base }];
    // Plusieurs gabarits dans un champ : le numéro, la rareté et le deck ne disent pas à QUEL tirage ils
    // appartiennent — nuls plutôt que devinés.
    const seul = gabs.length === 1;
    return gabs.map(m => ({
        tirage: TIRAGE_PAR_GABARIT[m[1].toUpperCase()] || 'inconnu',
        expansion: m[2].trim(),
        deck: seul ? base.deck : null, numero: seul ? base.numero : null, total: seul ? base.total : null, rarete: seul ? base.rarete : null
    }));
}

/** Toutes les entrées `…Infobox/Expansion`, au premier niveau OU imbriquées dans un `/ReleaseInfo`. */
function entreesExpansion(gs) {
    const out = [];
    for (const g of gs) {
        if (/Infobox\/Expansion$/.test(g.nom)) out.push(g);
        else if (/Infobox\/ReleaseInfo$/.test(g.nom) && g.params.releases) out.push(...gabarits(g.params.releases).filter(x => /Infobox\/Expansion$/.test(x.nom)));
    }
    return out;
}

/** Chemins (`impressions.expansion`, `attaques.nom`…) dont la valeur porte encore `{{ }}`. */
function cheminsAGabarit(valeur, prefixe = '', vus = new Set()) {
    if (typeof valeur === 'string') return contientGabarit(valeur) ? [prefixe] : [];
    if (Array.isArray(valeur)) return valeur.flatMap(v => cheminsAGabarit(v, prefixe, vus));
    if (valeur && typeof valeur === 'object') {
        return Object.entries(valeur).flatMap(([k, v]) => cheminsAGabarit(v, prefixe ? `${prefixe}.${k}` : k, vus));
    }
    return [];
}

/**
 * Les FAITS d'une page de carte. Rend aussi `champsNuls` pour le compte de la relecture.
 */
function faitsDeCarte(texte) {
    const gs = gabarits(texte);
    const infobox = gs.find(g => CATEGORIE_PAR_INFOBOX[g.nom]);
    // LE DÉNOMINATEUR DE CETTE FONCTION : combien d'entrées d'expansion la page PORTE, contre
    // combien d'impressions on en TIRE. Les 33 cartes muettes du premier jet (dresseurs et énergies,
    // dont les entrées sont imbriquées dans un `/ReleaseInfo`) se seraient vues à ce seul rapport.
    const entreesVues = entreesExpansion(gs);
    // Une entrée qui ne rend rien n'est pas forcément une entrée PERDUE, et confondre les deux rend
    // le contrôle inutilisable. Deux familles, comptées SÉPARÉMENT :
    //   · jeu vidéo (`gbset`, `gb2set`) — le TCG Game Boy de 1998. Ce ne sont pas des impressions
    //     physiques, on ne les veut pas, et elles sont majoritaires (17 sur 21 sur EXP).
    //   · tout le reste — une impression physique que le parseur ne rend PAS. Celle-là est un manque.
    const entreesJeuVideo = [], entreesNonRendues = [];
    const impressions = entreesVues.flatMap(g => {
        const out = [];
        if (g.params.expansion) {
            const { numero, total } = numeroTotal(g.params.cardno);
            out.push({ tirage: 'intl', expansion: nomDePage(g.params.expansion), deck: plat(g.params.deck) || null, numero, total, rarete: plat(g.params.rarity) || null });
        }
        if (g.params.jpexpansion || g.params.jpdeckkit) out.push(...impressionsDuChampAsiatique(g));
        if (!out.length) {
            const cles = Object.keys(g.params).filter(k => String(g.params[k]).trim() !== '');
            (cles.some(k => /^gb2?set/.test(k)) ? entreesJeuVideo : entreesNonRendues).push(cles.sort().join(','));
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
        // Ère DP : le niveau est un champ, pas un morceau du nom — « Magmortar » avec `level=X` est
        // la carte que Cardmarket nomme « Magmortar LV.X ». La jointure reconstruit le nom depuis les deux.
        niveau: plat(p.level) || null,
        type: plat(p.type) || null,
        pv: p.hp != null && plat(p.hp) !== '' ? Number(plat(p.hp)) || plat(p.hp) : null,
        stade: plat(p.evostage) || null,
        // `ndex` peut porter « ??? » ou un texte (cartes sans espèce) : un non-nombre est un null, pas un NaN.
        ndex: (() => { const n = carddex ? parseInt(plat(carddex.params.ndex), 10) : NaN; return Number.isFinite(n) ? n : null; })(),
        illustrateur: infobox ? illustrateurDe(infobox) : null,
        faiblesse: plat(p.weakness) || null,
        resistance: plat(p.resistance) || null,
        // « ? » ou un texte sur une carte de vending : un non-nombre est un null, pas un NaN (même faute que ndex).
        retraite: (() => { const n = Number(plat(p.retreatcost)); return plat(p.retreatcost) !== '' && Number.isFinite(n) ? n : null; })(),
        attaques,
        impressions,
        // à CONFRONTER à impressions.length, jamais à lire seuls
        entreesVues: entreesVues.length, entreesJeuVideo: entreesJeuVideo.length, entreesNonRendues
    };
    const attendus = carte.categorie === 'pokemon'
        ? ['nomEn', 'nomJa', 'type', 'pv', 'stade', 'ndex', 'illustrateur', 'attaques']
        : ['nomEn', 'nomJa', 'illustrateur'];
    carte.champsNuls = attendus.filter(k => carte[k] == null || (Array.isArray(carte[k]) && carte[k].length === 0));
    // Un champ qui porte encore un gabarit non développé est une donnée INVALIDE, pas une donnée
    // manquante : elle passerait tous les contrôles de présence, et `champsNuls` ne la voit pas.
    // 🔴 LE PARCOURS EST RÉCURSIF, ET C'EST LE POINT. Le 2026-09-12, `{{j|151}}` est arrivé jusqu'au
    // HTML du site dans `impressions[].expansion` — un champ IMBRIQUÉ. Un contrôle qui ne regarde
    // que le premier niveau aurait dit « aucun gabarit » et aurait eu tort sur le seul cas réel.
    carte.champsAGabarit = cheminsAGabarit(carte);
    return carte;
}

/** Les FAITS d'une page de set (`TCGExpansionInfobox`). Sur un set japonais SANS jumeau, le compte est `cards`. */
function faitsDeSet(texte) {
    const g = gabarits(texte).find(x => x.nom === 'TCGExpansionInfobox');
    if (!g) return null;
    const p = g.params;
    const entier = v => { const s = plat(v); const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; };
    // UN SET JAPONAIS SANS JUMEAU OCCIDENTAL N'A PAS DE `jasetname` : son nom japonais est dans
    // `setname`, parce que c'est le seul nom qu'il ait. Mesuré le 2026-09-12 sur Pokémon VS
    // (« ポケモンカード★VS ») et Pokémon Web (« ポケモンカード★web »), qui sortaient avec `nomJa`
    // nul et le japonais rangé dans `nomEn`. `alt` porte alors l'abréviation latine s'il y en a une.
    const japonais = s => /[぀-ヿ一-鿿]/.test(String(s || ''));
    const setnameEstJa = !plat(p.jasetname) && japonais(plat(p.setname));
    return {
        nomEn: setnameEstJa ? (plat(p.alt) || null) : (plat(p.setname) || null),
        nomJa: plat(p.jasetname) || (setnameEstJa ? plat(p.setname) : null),
        nomJaTraduit: plat(p.transsetname) || null,
        cartesEn: entier(p.encards),
        cartesJa: entier(p.jacards) ?? entier(p.cards),
        sortieEn: plat(p.enrelease) || null,
        sortieJa: plat(p.jarelease) ?? plat(p.release) ?? null
    };
}

/**
 * LES SECTIONS DE LA SETLIST — l'autorité pour l'appartenance d'une carte à un set.
 *
 * Relevé le 2026-09-12 : Bulbapedia FUSIONNE un set japonais et son jumeau occidental sur une seule
 * page (« Expansion Pack (TCG) » redirige vers « Base Set (TCG) »), et la page porte alors PLUSIEURS
 * listes, chacune ouverte par `{{Setlist/…header|title=…}}`. La liste japonaise énumère ses cartes
 * par `{{TCG ID|A|Nom|B}}`, dont le titre de page se reconstruit `Nom (A B)` — pour un set sans
 * numéros, A et B sont les morceaux du NOM DU SET (« Expansion » + « Pack », « Mystery of the » +
 * « Fossils »), pour un set numéroté A est le set et B le numéro. Ces titres sont des redirections
 * vers la page de la carte (souvent celle du tirage occidental), que `revisionsDe` suit.
 *
 * 🔴 LE HUITIÈME ÉCHEC SILENCIEUX (CLAUDE.md §21), 2026-09-15. Seul `{{TCG ID|A|Nom|B}}` était lu ; toute
 * autre entrée faisait `continue`, SANS UN MOT. Or Bulbapedia écrit une carte à SUFFIXE (V, VMAX, VSTAR, ex,
 * GX, EX, ☆, Prism Star) par un LIEN — `[[Kyurem V (Lost Abyss 29)|Kyurem]]{{TCGV}}` — ou par un TCG ID à
 * 4 paramètres — `{{TCG ID|MEGA Dream ex|Yanmega ex|3|Yanmega}}{{ex}}`. Perdues, sur l'archive R2 des 54 sets
 * collectés : 684 cartes au bloc 1 (+53 pour BXY, par le repli ; produits joints 76,8 % au lieu de ~100 %), 318
 * aux dix sets occidentaux, 9 au vintage — qui n'a presque pas de suffixes : 97,6 %, et c'est ce chiffre qui l'a
 * caché. Ce que la section NE lit PAS (énergies, `natureIgnoree`) est désormais COMPTÉ dans `ignorees` : une
 * entrée ne disparaît plus, elle se voit.
 *
 * @returns {Array<{titre: string, entrees: Array<{titre: string, a: string, nom: string, b: string|null, setReconstruit: string}>, ignorees: string[]}>}
 */
function sectionsSetlist(texte) {
    const sections = [];
    let courante = null;
    for (const g of gabarits(texte)) {
        if (/^Setlist\/\w*header$/i.test(g.nom)) { courante = { titre: plat(g.params.title) || '', entrees: [], ignorees: [] }; sections.push(courante); continue; }
        if (/^Setlist\/\w*footer$/i.test(g.nom)) { courante = null; continue; }
        if (/^Setlist\/\w*entry$/i.test(g.nom)) {
            if (!courante) { courante = { titre: '', entrees: [], ignorees: [] }; sections.push(courante); }
            const e = entreeDeSetlist(g.brut);
            if (e) courante.entrees.push(e); else courante.ignorees.push(g.brut);
        }
    }
    return sections;
}

// La référence d'une carte : `{{TCG ID|A|Nom|B}}`, avec ou sans 4e paramètre d'affichage. UNE définition pour
// la Setlist, le repli sur tout le wikitext et verifier-table.js (§21 bis).
const RE_TCG_ID = /\{\{TCG ID\|([^|}]+)\|([^|}]+)(?:\|([^|}]*))?(?:\|[^}]*)?\}\}/;
// Un lien vers la page d'une carte : `[[Nom (Set N)|affichage]]` — la DERNIÈRE parenthèse est le tirage.
const RE_LIEN_CARTE = /\[\[([^\]|]+) \(([^()\]|]+)\)(?:\|[^\]]*)?\]\]/;
// ⚠️ UN LIEN À PARENTHÈSE N'EST PAS FORCÉMENT UN TIRAGE : `[[Dark Pokémon (TCG)|Dark]]`, `[[Grass Energy (TCG)]]`
// (la cible développée de `{{TCG|…}}`), `{{OBP|…|Special}}`. Ces qualificatifs de page ne désignent jamais un set.
// La liste est courte et vieillira : le filet est le compteur `horsSet` de `entreesDeLaSetlist`, pas elle.
const QUALIFICATIF_NON_TIRAGE = /^(TCG|Pokémon|Special|Basic)$/i;

/** Un TCG ID dont une capture contient `{{` (paramètre imbriqué, `{{tt|58|holo}}`) ne se lit pas : ignoré. */
function tcgIdLisible(m) { return m && ![m[1], m[2], m[3]].some(x => x && x.includes('{{')) ? m : null; }
function premierLienDeTirage(brut) {
    for (const l of String(brut).matchAll(new RegExp(RE_LIEN_CARTE.source, 'g'))) if (!QUALIFICATIF_NON_TIRAGE.test(l[2].trim())) return l;
    return null;
}
function entreeDeTcgId(t) {
    const a = t[1].trim(), nom = t[2].trim(), b = (t[3] || '').trim() || null;
    return { titre: b ? `${nom} (${a} ${b})` : `${nom} (${a})`, a, nom, b, setReconstruit: b ? `${a} ${b}` : a };
}
/** Pour un lien, `a` et `b` sont INDICATIFS (« Pokémon Card 151 » sans numéro donne b = 151) : seuls `titre` et
 *  `setReconstruit` (la parenthèse entière) sont lus en aval. */
function entreeDeLien(l) {
    const nom = l[1].trim(), parenthese = l[2].trim();
    const m = parenthese.match(/^(.+) ([A-Z]{0,3}\d+[a-z]?)$/);   // « Lost Abyss 29 », « Brilliant Stars TG13 »
    return { titre: `${nom} (${parenthese})`, a: m ? m[1] : parenthese, nom, b: m ? m[2] : null, setReconstruit: parenthese };
}

/**
 * L'entrée d'une ligne de Setlist, ou null si elle ne désigne aucune page de carte. La PREMIÈRE référence du
 * gabarit gagne — c'est la colonne du nom ; une référence de la colonne des notes vient après.
 */
function entreeDeSetlist(brut) {
    const t = tcgIdLisible(RE_TCG_ID.exec(brut)), l = premierLienDeTirage(brut);
    if (t && (!l || t.index <= l.index)) return entreeDeTcgId(t);
    return l ? entreeDeLien(l) : null;
}

/** Ce qu'est une entrée IGNORÉE. Une énergie SPÉCIALE a un tirage et un produit : elle ne se range pas avec les
 *  énergies de base, qui ne désignent pas une page par tirage. */
function natureIgnoree(brut) {
    const s = String(brut);
    if (/\{\{OBP\|[^|}]*Energy\|Basic\}\}/i.test(s) || /\{\{TCG\|(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy\}\}/.test(s)) return 'energie-base';
    if (/\{\{(?:OBP|TCG)\|[^|}]*Energy[|}]/.test(s)) return 'energie-speciale';
    return 'autre';
}

/**
 * LES ENTRÉES D'UN SET dans la page de set, selon sa ligne de table (`L.bulba`). Une seule définition,
 * utilisée par collecteur-texte.js (ce qu'on collecte) ET par verifier-table.js --auto (ce qu'on admet) :
 * une vérification qui sélectionne autrement que le collecteur vérifie autre chose (§21 bis).
 * Ordre : `setlistMotif` (EXS) · sections nommées par `setlist` (défaut : l'expansion) · à défaut, le
 * nom de set reconstruit (« A B ») suivi d'un désambiguïsateur · page SANS gabarit Setlist (Intro Pack) :
 * les `{{TCG ID}}` de tout le wikitext. Puis le filtre `deck`.
 * @returns {{entrees: Array, sections: Array, surToutLeWikitext: boolean}}
 */
function entreesDeLaSetlist(texte, b) {
    const echapper = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nomsExpansion = [].concat(b.expansion);
    const nomsSections = b.setlist === null ? null : (b.setlist || nomsExpansion);
    const sections = sectionsSetlist(texte);
    // `chemin` et `lues` : le dénominateur de CHAQUE chemin (§21) — ce qui a été lu avant le filtre de nom.
    let entrees, surToutLeWikitext = false, chemin, lues, horsSet = [];
    if (b.setlistMotif) {
        const re = new RegExp(b.setlistMotif);
        const toutes = sections.flatMap(s => s.entrees);
        entrees = toutes.filter(e => re.test(e.setReconstruit)); chemin = 'motif'; lues = toutes.length;
    } else if (nomsSections === null) { entrees = sections.flatMap(s => s.entrees); chemin = 'toutes-sections'; lues = entrees.length; }
    else {
        entrees = sections.filter(s => nomsSections.includes(s.titre)).flatMap(s => s.entrees); chemin = 'sections-nommees'; lues = entrees.length;
        // HORS SET : une entrée d'une section retenue dont le tirage ne commence par aucun nom attendu. Ce n'est pas
        // un refus — la section fait autorité — c'est un signal imprimé : un lien générique qui passerait la garde
        // des qualificatifs, ou un renvoi vers un autre set, se VOIT ici.
        // Le jeton de set d'une entrée (sa parenthèse sans le numéro) peut différer des noms de la table : VS écrit
        // « (VS 1) » dans une section « Pokémon Card★VS ». Le jeton DOMINANT de la section vaut donc nom — le même
        // principe que le motif dérivé de verifier-table.js (le jeton entre parenthèses le plus fréquent).
        const jeton = e => e.setReconstruit.replace(/ [A-Z]{0,3}\d+[a-z]?$/, '');
        const frequences = entrees.reduce((m, e) => m.set(jeton(e), (m.get(jeton(e)) || 0) + 1), new Map());
        const dominant = [...frequences].sort((x, y) => y[1] - x[1])[0]?.[0];
        const debut = new RegExp(`^(${[...new Set([...nomsSections, ...nomsExpansion, ...(dominant ? [dominant] : [])])].map(echapper).join('|')})( |$)`);
        horsSet = entrees.filter(e => !debut.test(e.setReconstruit)).map(e => e.titre);
        if (!entrees.length) {
            const re = new RegExp(`^(${nomsSections.map(echapper).join('|')})( \\d+)?$`);
            const toutes = sections.flatMap(s => s.entrees);
            entrees = toutes.filter(e => re.test(e.setReconstruit)); chemin = 'set-reconstruit'; lues = toutes.length;
        }
    }
    if (!entrees.length) {
        const re = b.setlistMotif ? new RegExp(b.setlistMotif) : new RegExp(`^(${(nomsSections || nomsExpansion).map(echapper).join('|')})( \\d+)?$`);
        // Symétrie avec les sections (§21 bis) : TCG ID lisibles ET liens de tirage, sous le même filtre de nom.
        const candidats = [
            ...[...String(texte).matchAll(new RegExp(RE_TCG_ID.source, 'g'))].filter(tcgIdLisible).map(entreeDeTcgId),
            ...[...String(texte).matchAll(new RegExp(RE_LIEN_CARTE.source, 'g'))].filter(l => !QUALIFICATIF_NON_TIRAGE.test(l[2].trim())).map(entreeDeLien)
        ];
        entrees = candidats.filter(e => re.test(e.setReconstruit)); chemin = 'tout-le-wikitext'; lues = candidats.length; horsSet = [];
        surToutLeWikitext = true;
    }
    if (b.deck) entrees = entrees.filter(e => e.setReconstruit.startsWith(b.deck));
    return { entrees, sections, surToutLeWikitext, chemin, lues, horsSet };
}

module.exports = { gabarits, epurer, faitsDeCarte, faitsDeSet, sectionsSetlist, entreeDeSetlist, entreesDeLaSetlist, natureIgnoree, RE_TCG_ID, tcgIdLisible, plat, nomDePage, numeroTotal, contientGabarit, cheminsAGabarit, PARAMS_TEXTE };

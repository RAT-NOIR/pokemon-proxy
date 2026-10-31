// ============================================================
// LISTES DE GEM PACK ET DE SETS CHINOIS : DEUX SOURCES DE LISTES + LA SOURCE DÉJÀ EN CACHE, CROISÉES — module PUR (aucun réseau, aucune base)
// ============================================================
// Les pages de liste donnent, pour un set chinois, le lien que les produits Cardmarket n'ont pas : un NOM ANGLAIS par numéro de carte.
//   · SC (liste détaillée) : « 01 01/07 Ponyta (Fire) » = groupe (un Pokémon), rang dans le groupe, total du groupe ; finition ; adresse de l'original. Seule la section « Card List » est lue
//     (la section « Exclusives » REPÈTE des cartes de la liste : la lire fabriquerait des doublons de (groupe, rang)).
//   · PC (liste visuelle) : un ordre d'images et leur rareté. Ses NUMÉROS de fichier sont fautifs (8:8, 12:05, 183a, « 176 double ») : on les NOMME, on ne s'en sert pas — seul l'ORDRE et la rareté témoignent.
//   · ppr (relevé déjà en cache) : « 01 01/07 », nom, finition, rareté — sert à CONFIRMER, jamais seul.
// ⚠️ Rien ici ne choisit une variante au hasard : les produits Cardmarket d'un groupe (V1…Vn) ne portent AUCUN attribut de finition ; sans témoin indépendant, `prouverParSet`/`prouverVariantes` rendent « variantes indiscernables ».
// ⚠️ La traduction n'existe pas ici : les noms sont déjà anglais (le traducteur de table-zh.js les ramène à une clé par `cleProduit`).
const { normaliserNom } = require('./jointure');

const attr = (s, nom) => { const m = new RegExp(`\\b${nom}="([^"]*)"`, 'i').exec(s); return m ? m[1] : null; };
const sansBalises = s => String(s).replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const pad2 = n => String(n).padStart(2, '0');

/** Finition (texte de SC) -> classe. Écrit par ce qu'elle reconnaît : le reste est null, nommé en anomalie. */
function classeFinition(texte) {
    const s = String(texte ?? '').trim();
    if (!s) return null;
    if (/master ?ball/i.test(s)) return 'masterball';
    if (/pok[eé] ?ball/i.test(s)) return 'pokeball';
    if (/stamp/i.test(s)) return 'tampon';
    if (/3-?star|illustration/i.test(s)) return 'ir';
    if (/shattered glass|\bstar\b|glitter/i.test(s)) return 'brillant1';
    if (/rotary|windmill|kaleido/i.test(s)) return 'brillant2';
    if (/^(fire|water|grass|lightning|psychic|fighting|darkness|metal|colorless|dragon|fairy)$/i.test(s)) return 'energie';
    return null;
}
/** Rareté (texte d'une des trois sources) -> classe C / U / R / DR / TR. « double » tout court (texte tronqué) ne se devine pas : null. */
function classeRarete(texte) {
    const s = String(texte ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');      // « double rare », « double-rare », « doublerare » (data-category du second gabarit)
    if (s === 'common') return 'C';
    if (s === 'uncommon') return 'U';
    if (s === 'rare') return 'R';
    if (s === 'doublerare') return 'DR';
    if (s === 'triplerare' || s === 'artrare' || s === 'exclusiveartrare') return 'TR';
    return null;
}
const RARETE_DE_CLASSE = { energie: 'C', pokeball: 'C', brillant1: 'U', brillant2: 'U', masterball: 'R', tampon: 'DR', ir: 'TR' };
const rareteDeLaClasse = c => RARETE_DE_CLASSE[c] ?? null;
const CLASSE_PPR = { 'energy-reverse': 'energie', 'pokeball-reverse': 'pokeball', 'glitter-foil': 'brillant1', 'prismatic-foil': 'brillant2', 'masterball-reverse': 'masterball', gem: 'tampon', 'full-art': 'ir' };

/** SC : la section « Card List » seule. Lève si elle est introuvable (une lecture vide n'est pas « zéro carte »). */
function lireSimplifiedCollector(html) {
    const h2 = [...String(html).matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(m => ({ i: m.index, fin: m.index + m[0].length, texte: sansBalises(m[1]) }));
    const iCL = h2.findIndex(x => /Card List\s*$/i.test(x.texte));
    if (iCL < 0) throw new Error('lireSimplifiedCollector : section « Card List » introuvable — page non reconnue, rien n\'est lu');
    const section = String(html).slice(h2[iCL].fin, iCL + 1 < h2.length ? h2[iCL + 1].i : undefined);
    const anomalies = [], cartes = [];
    const titres = [...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(m => ({ i: m.index, fin: m.index + m[0].length, texte: sansBalises(m[1]) }));
    if (!titres.length) throw new Error('lireSimplifiedCollector : aucun groupe (<h3>) dans « Card List »');
    for (let k = 0; k < titres.length; k++) {
        const hm = /^(.*?)\s*\((\d{1,3})\)$/.exec(titres[k].texte);
        if (!hm) { anomalies.push({ type: 'titre-illisible', texte: titres[k].texte }); continue; }
        const groupe = pad2(hm[2]), nomGroupe = hm[1].trim();
        const bloc = section.slice(titres[k].fin, k + 1 < titres.length ? titres[k + 1].i : undefined);
        const figures = [...bloc.matchAll(/<figure\b[^>]*>\s*<img\b([^>]*)>([\s\S]*?)<\/figure>/g)];
        const lignes = figures.map((f, pos) => {
            const img = f[1], alt = attr(img, 'alt') ?? '';
            const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(f[2]);
            const legende = cap ? sansBalises(cap[1]) : null;
            const lm = legende ? /^(\d{1,3})\s+(\d{1,3})\s*[\/-]\s*(\d{1,3})\b\s*(?:\/\s*)?(.*)$/.exec(legende) : null;
            const nom = (lm && lm[4].trim()) || nomGroupe;
            // la finition : « (Fire) » dans l'alt, sinon le reste de l'alt après le nom (« Gem Pack Vol. 4 Chatot star »)
            const pm = /\(([^)]+)\)/.exec(alt);
            let finitionTexte = pm ? pm[1] : null;
            if (!finitionTexte) { const reste = alt.replace(/^Gem Pack Vol\.? ?\d+\s*/i, '').replace(/^\d{1,3} \d{1,3}[\/-]\d{1,3}\s*/, '').replace(nom, '').replace(/\s+from Gem Pack.*$/i, '').trim(); finitionTexte = reste || null; }
            const srcset = (attr(img, 'data-brsrcset') ?? attr(img, 'srcset') ?? '').split(',').map(x => x.trim().split(/\s+/)).filter(x => x[0]).map(x => ({ url: x[0], w: parseInt(x[1], 10) || 0 }));
            const original = srcset.sort((a, b) => b.w - a.w)[0] ?? null;
            const classe = classeFinition(finitionTexte);
            return { groupe, nomGroupe, nom, rangDeclare: !!lm, rangLegende: lm ? Number(lm[2]) : null, total: lm ? Number(lm[3]) : null, classe, finitionTexte, legende, alt, position: pos + 1, urlMiniature: attr(img, 'data-breeze') ?? attr(img, 'src'), urlOriginal: original ? original.url : null, largeurAnnoncee: original ? original.w : null };
        });
        const totalGroupe = lignes.find(l => l.total)?.total ?? lignes.length;
        if (lignes.length !== totalGroupe) anomalies.push({ type: 'groupe-incomplet', groupe, attendu: totalGroupe, lues: lignes.length });
        for (const l of lignes) {
            const rang = l.rangLegende ?? l.position;
            if (l.rangLegende != null && l.rangLegende !== l.position && lignes.length === totalGroupe) anomalies.push({ type: 'rang-different-de-la-position', groupe, rang: l.rangLegende, position: l.position });
            if (l.classe == null) anomalies.push({ type: 'finition-inconnue', groupe, rang, texte: l.finitionTexte });
            if (l.rangDeclare && normaliserNom(l.nom) !== normaliserNom(nomGroupe)) anomalies.push({ type: 'nom-legende-different', groupe, rang, groupeNom: nomGroupe, legende: l.nom });
            cartes.push({ groupe, rang, total: l.total ?? totalGroupe, nom: l.nom, nomGroupe, classe: l.classe, rangDeclare: l.rangDeclare, finitionTexte: l.finitionTexte, urlMiniature: l.urlMiniature, urlOriginal: l.urlOriginal, largeurAnnoncee: l.largeurAnnoncee, alt: l.alt });
        }
    }
    const cles = new Map(); for (const c of cartes) cles.set(c.groupe + '/' + c.rang, (cles.get(c.groupe + '/' + c.rang) || 0) + 1);
    for (const [k, n] of cles) if (n > 1) anomalies.push({ type: 'doublon', cle: k, fois: n });
    return { cartes, anomalies };
}

/** PC : l'ORDRE des cartes et leur rareté. Les numéros de fichier fautifs sont nommés en anomalies, jamais corrigés. Lève si aucune carte. */
function lirePokeCottage(html) {
    const cartes = [], anomalies = [];
    for (const m of String(html).matchAll(/<a class="card ([^"]*)"([^>]*)>\s*<img\b([^>]*)>/g)) {
        const img = m[3], alt = attr(img, 'alt') ?? '', src = attr(img, 'src') ?? attr(img, 'data-src') ?? '';
        const categorie = attr(m[2], 'data-category');
        const am = /^\((\d+)\s+([^)]*)\)\s*Pok[eé]mon card/i.exec(alt) || [null, null, alt];   // le texte alternatif varie d'un volume à l'autre (« Common 01 Pokemon card… », « … 01 01/15 Pokemon card… »)
        if (!/^https:\/\/images\.squarespace-cdn\.com\//.test(src) || !(categorie || /Pok[eé]mon card/i.test(alt))) continue;     // pas une carte de la liste
        const fichierNom = (() => { try { return decodeURIComponent(src.split('/').pop().split('?')[0]); } catch { return src.split('/').pop().split('?')[0]; } })();
        const gr = /(?:Card-List-|Card\+|Card )(\d+):(\d+)(?:_|\.)/.exec(fichierNom);
        const nn = !gr && /(?:Card-List-|Card\+|Card )(\d+)([a-z]?)(?:_|\.|$)/i.exec(fichierNom);
        const position = cartes.length + 1;
        const raretes = [categorie, am[2]].filter(Boolean);
        const classe = raretes.map(classeRarete).find(x => x) ?? null;
        const c = { position, classe, rareteTexte: am[2], categorie, src, fichier: gr ? `${gr[1]}:${gr[2]}` : nn ? nn[1] + nn[2] : null, groupeFichier: gr ? Number(gr[1]) : null, rangFichier: gr ? Number(gr[2]) : null, numeroFichier: nn ? Number(nn[1]) : null };
        if (classe == null) anomalies.push({ type: 'rarete-inconnue', position, texte: am[2], fichier: fichierNom });
        if (nn && nn[2]) anomalies.push({ type: 'numero-suffixe', position, fichier: fichierNom });
        if (!gr && !nn) anomalies.push({ type: 'fichier-illisible', position, fichier: fichierNom });
        cartes.push(c);
    }
    // SECOND GABARIT (galerie « pc-set-card-gallery-card », ex. Gem Pack Vol. 6) : nom, « 01 01/07 » et rareté sont dans la page
    if (!cartes.length) for (const m of String(html).matchAll(/<article class="pc-set-card-gallery-card"([^>]*)>([\s\S]*?)<\/article>/g)) {
        const corps = m[2], src = attr(/<img\b([^>]*)>/.exec(corps)?.[1] ?? '', 'src') ?? '';
        const nom = /pc-set-card-gallery-name">([^<]*)</.exec(corps)?.[1]?.trim() ?? null, num = /pc-set-card-gallery-number">\s*(\d{1,3})\s+(\d{1,3})\/(\d{1,3})\s*</.exec(corps);
        const categorie = attr(m[1], 'data-category'), position = cartes.length + 1, classe = classeRarete(categorie);
        if (!/^https:\/\/pokecottagecdn\.com\//.test(src) || !nom || !num) { anomalies.push({ type: 'carte-illisible', position }); continue; }
        if (classe == null) anomalies.push({ type: 'rarete-inconnue', position, texte: categorie });
        cartes.push({ position, classe, rareteTexte: categorie, categorie, src, fichier: null, groupe: pad2(num[1]), rang: Number(num[2]), total: Number(num[3]), nom });
    }
    if (!cartes.length) throw new Error('lirePokeCottage : aucune carte lue — page non reconnue, rien n\'est lu');
    // les numéros « g:r » d'un même groupe doivent se suivre 1, 2, 3… ; un saut (8:8 après 8:6) ou un début à autre chose que 1 est nommé
    const attendu = new Map();
    for (const c of cartes) {
        if (c.groupeFichier == null) continue;
        const prochain = (attendu.get(c.groupeFichier) ?? 0) + 1;
        if (c.rangFichier !== prochain) anomalies.push({ type: 'rang-hors-sequence', position: c.position, fichier: c.fichier, attendu: prochain });
        attendu.set(c.groupeFichier, c.rangFichier);
    }
    return { cartes, anomalies };
}

/** ppr : le relevé en cache (releves-ppr.json[code]) ramené à des cartes de groupe. Les tuiles d'un set « simple » (sans groupe) sont ignorées et comptées. */
function lirePpr(releve) {
    const cartes = []; let sansGroupe = 0;
    for (const t of (releve && releve.tuiles) || []) {
        if (t.groupe == null || t.rang == null) { sansGroupe++; continue; }
        cartes.push({ groupe: pad2(Number(t.groupe)), rang: Number(t.rang), total: t.total ?? null, nom: t.nom ?? null, classe: CLASSE_PPR[t.variante] ?? null, varianteTexte: t.variante ?? null, rarete: classeRarete(t.rarete), cachee: !!t.cachee });
    }
    return { cartes, sansGroupe };
}

/**
 * LE CROISEMENT À TROIS SOURCES. SC porte la structure ; PC doit la confirmer par l'ordre et la rareté ; ppr par le nom, la finition et la rareté de chaque carte qu'il a lue.
 * @param {{sc:{cartes:object[], anomalies?:object[]}, pc?:{cartes:object[]}|null, ppr?:{cartes:object[]}|null, attendu?:number, produitsParGroupe?:Map|object|null}} o   attendu = nombre de produits Cardmarket du set ;
 *   produitsParGroupe = { '1': { noms:Set<cleNom(nom)>, effectif } } (produits Cardmarket par numéro de groupe, sans zéro de tête) — ce qui rend un désaccord de ppr corroboré, donc une réserve ;
 *   cleNom = la clé de comparaison des noms (défaut : normaliserNom ; la production donne la clé d'espèce de table-zh.fabriquerCleProduit, la MÊME que la preuve par le set) — `produitsParGroupe.noms` doit être construit avec elle
 * @returns {{ok:boolean, discordances:object[], reserves:object[], couverture:{sc:number,pc:number,ppr:number}, cartes:object[]}}
 */
function croiserSources({ sc, pc = null, ppr = null, attendu = undefined, produitsParGroupe = null, cleNom = normaliserNom }) {
    const discordances = [], reserves = [];
    const ord = (a, b) => Number(a.groupe) - Number(b.groupe) || a.rang - b.rang;
    const scCartes = [...sc.cartes].sort(ord);
    // le titre d'un groupe est une étiquette (« Eevee »), la LÉGENDE de chaque carte porte son nom (« Eevee VMAX ») : leur différence est notée, pas bloquante ; toute autre anomalie de SC bloque
    for (const a of sc.anomalies || []) { if (a.type === 'nom-legende-different') reserves.push({ ...a, type: 'sc-nom-legende' }); else discordances.push({ ...a, type: 'sc-anomalie', anomalie: a.type }); }
    if (!scCartes.length) discordances.push({ type: 'sc-vide' });
    const parCle = new Map(scCartes.map(c => [c.groupe + '/' + c.rang, c]));
    if (parCle.size !== scCartes.length) discordances.push({ type: 'sc-doublon' });
    if (attendu !== undefined && scCartes.length !== attendu) discordances.push({ type: 'effectif-attendu', attendu, sc: scCartes.length });
    const confPpr = new Set(), orphelins = [], reclames = new Set();
    // LES RÉSERVES : un désaccord de ppr ou de PC (sources qui ne font que CONFIRMER) n'est non bloquant que s'il est CORROBORÉ par une donnée indépendante de lui — les produits Cardmarket du groupe
    // (noms, effectif) ou la rareté de PC. Sans `produitsParGroupe`, tout désaccord bloque. Une réserve est ÉCRITE, et la carte concernée n'est pas comptée comme confirmée par ppr.
    const norm0 = g => String(g).replace(/^0+/, '');
    const prod = g => (produitsParGroupe ? (produitsParGroupe instanceof Map ? produitsParGroupe.get(norm0(g)) : produitsParGroupe[norm0(g)]) ?? null : null);
    const dissent = (type, d, corrobore) => { if (corrobore) reserves.push({ type, ...d }); else discordances.push({ type: d.dur ?? type, ...d }); };
    let couvPc = 0; const confPc = new Set();
    if (pc) {
        if (pc.cartes.length !== scCartes.length) discordances.push({ type: 'effectif-pc', sc: scCartes.length, pc: pc.cartes.length });
        else scCartes.forEach((c, i) => {
            const p = pc.cartes[i], attendue = rareteDeLaClasse(c.classe);
            // un PC qui porte l'identité de ses cartes (second gabarit) est confronté au nom et au rang de SC, à la MÊME position
            if (p.nom != null && cleNom(p.nom) !== cleNom(c.nom)) {
                // un nom de PC qui ne se ramène pas à la même clé n'est une réserve que si les produits Cardmarket du groupe portent la clé de SC et PAS celle de PC
                const pr = prod(c.groupe);
                if (pr && pr.noms.has(cleNom(c.nom)) && !pr.noms.has(cleNom(p.nom))) reserves.push({ type: 'nom-pc-dissident', groupe: c.groupe, rang: c.rang, sc: c.nom, pc: p.nom });
                else discordances.push({ type: 'nom-pc', groupe: c.groupe, rang: c.rang, sc: c.nom, pc: p.nom });
            }
            if (p.groupe != null && (p.groupe !== c.groupe || p.rang !== c.rang)) discordances.push({ type: 'rang-pc', position: i + 1, sc: `${c.groupe}/${c.rang}`, pc: `${p.groupe}/${p.rang}` });
            if (p.classe == null) return;                                     // texte illisible : non informatif (compté hors couverture), jamais une contradiction ni une confirmation
            couvPc++;
            if (attendue != null && p.classe !== attendue) discordances.push({ type: 'rarete-pc', groupe: c.groupe, rang: c.rang, sc: attendue, pc: p.classe });
            else confPc.add(c.groupe + '/' + c.rang);
        });
    }
    if (ppr) for (const p of ppr.cartes) {
        const c = parCle.get(p.groupe + '/' + p.rang);
        if (!c) { orphelins.push(p); continue; }
        reclames.add(c.groupe + '/' + c.rang);
        let bon = true;
        const pr = prod(c.groupe), cle = c.groupe + '/' + c.rang;
        if (p.nom != null && cleNom(p.nom) !== cleNom(c.nom)) { bon = false; dissent('nom-ppr-dissident', { dur: 'nom', groupe: c.groupe, rang: c.rang, sc: c.nom, ppr: p.nom }, !!pr && pr.noms.has(cleNom(c.nom)) && !pr.noms.has(cleNom(p.nom))); }
        if (p.total != null && c.total != null && p.total !== c.total) { bon = false; dissent('total-ppr-dissident', { dur: 'total', groupe: c.groupe, rang: c.rang, sc: c.total, ppr: p.total }, !!pr && pr.effectif === c.total); }
        if (p.classe != null && c.classe != null && p.classe !== c.classe) { bon = false; dissent('finition-ppr-dissidente', { dur: 'finition', groupe: c.groupe, rang: c.rang, sc: c.classe, ppr: p.classe }, !!pr && p.rarete != null && p.rarete === rareteDeLaClasse(c.classe) && confPc.has(cle)); }
        if (p.rarete != null && rareteDeLaClasse(c.classe) != null && p.rarete !== rareteDeLaClasse(c.classe)) { bon = false; dissent('rarete-ppr-dissidente', { dur: 'rarete-ppr', groupe: c.groupe, rang: c.rang, sc: rareteDeLaClasse(c.classe), ppr: p.rarete }, !!pr && confPc.has(cle)); }
        if (bon) confPpr.add(cle);
    }
    // un orphelin de ppr est une FAUTE DE NUMÉROTATION de ppr s'il désigne, par son nom, son rang, sa finition et son total, UN SEUL emplacement de SC que ppr n'a réclamé par aucune autre tuile (« 29 07/07 Flutter Mane » pour le groupe 28)
    for (const p of orphelins) {
        const libres = scCartes.filter(c => !reclames.has(c.groupe + '/' + c.rang) && c.rang === p.rang && cleNom(c.nom) === cleNom(p.nom ?? '') && (p.classe == null || c.classe == null || c.classe === p.classe) && (p.total == null || c.total == null || c.total === p.total));
        if (produitsParGroupe && libres.length === 1) { reserves.push({ type: 'ppr-numero-fautif', ppr: `${p.groupe}/${p.rang}`, sc: `${libres[0].groupe}/${libres[0].rang}`, nom: p.nom }); reclames.add(libres[0].groupe + '/' + libres[0].rang); }
        else discordances.push({ type: 'orphelin-ppr', groupe: p.groupe, rang: p.rang, nom: p.nom });
    }
    const cartes = scCartes.map(c => ({ groupe: c.groupe, rang: c.rang, total: c.total, nom: c.nom, classe: c.classe, rarete: rareteDeLaClasse(c.classe), rangDeclare: c.rangDeclare, confirmations: { pc: confPc.has(c.groupe + '/' + c.rang), ppr: confPpr.has(c.groupe + '/' + c.rang) }, urlOriginal: c.urlOriginal ?? null, urlMiniature: c.urlMiniature ?? null }));
    return { ok: discordances.length === 0, discordances, reserves, couverture: { sc: scCartes.length, pc: couvPc, ppr: confPpr.size }, cartes };
}

/** La liste au format de la preuve par le set (collecte-cartes/preuve-par-set.js) : numéro = groupe + rang, `nomZh` porte ici le nom ANGLAIS (le traducteur le ramène à une clé). LÈVE si le croisement n'est pas ok. */
function listeDuSet(croisement) {
    if (!croisement || !croisement.ok) throw new Error('listeDuSet : le croisement des sources n\'est pas ok — aucune liste n\'est rendue');
    return croisement.cartes.map(c => ({ numero: c.groupe + pad2(c.rang), nomZh: c.nom }));
}

/**
 * LES VARIANTES, VARIANTE PAR VARIANTE. Les produits Cardmarket d'un groupe (V1…Vn) portent le même nom, la même métacarte : rien ne dit quel V est quelle finition.
 * Une attribution (produit -> rang de la source) n'est rendue que si un TÉMOIN INDÉPENDANT (`temoinVariante(produit) -> rang entier | null`) range TOUS les produits du groupe sur des rangs
 * DISTINCTS qui sont exactement ceux de la source. Sans témoin, ou au moindre doute : « variantes indiscernables », le groupe ne reçoit RIEN. Jamais l'ordre des V, ni un prix.
 */
function prouverVariantes({ croisement, produits, temoinVariante = null }) {
    const norm = n => String(n ?? '').replace(/^0+/, '');
    const parGroupeSource = new Map();
    for (const c of croisement.cartes) (parGroupeSource.get(norm(c.groupe)) || parGroupeSource.set(norm(c.groupe), []).get(norm(c.groupe))).push(c);
    const parGroupeProduit = new Map();
    for (const p of produits) { const k = p.numero == null ? '' : norm(p.numero); (parGroupeProduit.get(k) || parGroupeProduit.set(k, []).get(k)).push(p); }
    const attributions = [], indiscernables = [];
    const refuser = (prods, groupe, detail) => { for (const p of prods) indiscernables.push({ idProduct: p.idProduct, groupe, motif: 'variantes indiscernables', detail }); };
    for (const [k, prods] of parGroupeProduit) {
        const src = parGroupeSource.get(k), groupe = k === '' ? null : k.padStart(2, '0');
        if (!src) { refuser(prods, groupe, 'groupe absent de la source'); continue; }
        if (src.length !== prods.length) { refuser(prods, groupe, `effectif différent (source ${src.length}, produits ${prods.length})`); continue; }
        if (typeof temoinVariante !== 'function') { refuser(prods, groupe, 'aucun témoin indépendant du côté Cardmarket (nom, métacarte et numéro identiques pour toutes les variantes)'); continue; }
        const rangs = prods.map(p => temoinVariante(p));
        if (rangs.some(r => !Number.isInteger(r))) { refuser(prods, groupe, 'témoin incomplet'); continue; }
        if (new Set(rangs).size !== rangs.length) { refuser(prods, groupe, 'témoin ambigu (deux variantes au même rang)'); continue; }
        const rangsSource = new Set(src.map(c => c.rang));
        if (rangs.some(r => !rangsSource.has(r))) { refuser(prods, groupe, 'témoin hors des rangs de la source'); continue; }
        const parRang = new Map(src.map(c => [c.rang, c]));
        prods.forEach((p, i) => attributions.push({ idProduct: p.idProduct, groupe: parRang.get(rangs[i]).groupe, rang: rangs[i], classe: parRang.get(rangs[i]).classe }));
    }
    attributions.sort((a, b) => a.idProduct - b.idProduct); indiscernables.sort((a, b) => a.idProduct - b.idProduct);
    return { attributions, indiscernables, resume: `${indiscernables.length} produits sans variante prouvée (variantes indiscernables) sur ${produits.length} produits ; ${attributions.length} attribués variante par variante` };
}

module.exports = { classeFinition, classeRarete, rareteDeLaClasse, lireSimplifiedCollector, lirePokeCottage, lirePpr, croiserSources, listeDuSet, prouverVariantes };

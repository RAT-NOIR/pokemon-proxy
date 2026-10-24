'use strict';
// node audit-catalogue/lancer-livrable.js — LE LIVRABLE du brief (point 6), second passage (seuils.md du coordinateur) :
//   AUDIT-CATALOGUE.md (global, par famille, par set) · audit-produits.json (un enregistrement par produit) · planches\ (les 100 PROBABLEMENT FAUX les plus sûrs, les INCERTAIN, 20 par classe).
// Entrées : etat-produits.json (lancer-etat.js), comparaisons.json (lancer-comparaison.js), mesure-sets.json. LECTURE SEULE ; sorties dans S8\AUDIT\ seulement.
const fs = require('fs');
const crypto = require('crypto');
const C = require('./classement');
const { lireJson, ecrireJson, sortie } = require('./ecrire');
const { rendrePlanches } = require('./rendu-planche');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');
const { ouvrirR2Lecture } = require('./lecture-r2');

const CLASSES = ['MANQUANT', 'EMPRUNTE', 'BASSE_DEFINITION', 'CONFORME', 'INCERTAIN', 'PROBABLEMENT_FAUX', 'INVERIFIABLE'];
const CLASSES_FICHE = ['FICHE_OK', 'FICHE_DOUTEUSE', 'LIGNE_SANS_FICHE', 'SANS_LIGNE'];
const FAMILLES = ['occidental', 'japonais', 'chinois', 'asie-du-sud-est', 'inconnue'];
const nb = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1).replace('.', ',')} %` : '—');
const vir = x => String(x).replace('.', ',');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const graine = g => { let t = g >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
function tirer(liste, n, g) { const a = [...liste], r = graine(g); for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a.slice(0, n); }
const compter = (xs, cle) => { const m = new Map(); for (const x of xs) for (const k of [].concat(cle(x))) m.set(k, (m.get(k) || 0) + 1); return m; };
const md = (entetes, lignes) => [`| ${entetes.join(' | ')} |`, `|${entetes.map(() => '---').join('|')}|`, ...lignes.map(l => `| ${l.join(' | ')} |`)].join('\n');

(async () => {
    const t0 = Date.now();
    const etat = lireJson('etat-produits.json'), comp = new Map(lireJson('comparaisons.json').paires.map(e => [e.idProduct, e]));
    const mesSets = lireJson('mesure-sets.json'), setDe = new Map(mesSets.lignesSet.map(l => [l.idExpansion, l]));
    const sansSet = etat.filter(p => !setDe.has(p.idExpansion));
    if (sansSet.length) throw new Error(`${sansSet.length} produits dont l'expansion n'est pas dans mesure-sets.json (clé fausse, §41)`);
    if (etat.filter(p => p.visuel.entree).length !== comp.size) throw new Error(`produits servis (${etat.filter(p => p.visuel.entree).length}) ≠ paires de comparaisons.json (${comp.size}) : les deux fichiers ne viennent pas du même état`);

    // ── LES ENREGISTREMENTS : fiche, visuel, comparaison, motifs
    const R = etat.map(p => {
        const s = setDe.get(p.idExpansion), c = comp.get(p.idProduct), servi = Boolean(p.visuel.entree);
        const cc = servi ? C.classerComparaison({ comparaison: { comparable: c.comparable, motif: c.motif }, distance: c.distance, nom: p.name }) : null;
        const classeVisuel = C.classerFinal({ classe: p.visuel.classe, comparaison: servi ? { comparable: c.comparable, motif: c.motif } : null, distance: servi ? c.distance : null, nom: p.name });
        // L3 : la classe de comparaison écrite par lancer-comparaison.js (sur la distance BRUTE) doit être celle que ce livrable recalcule — sinon les deux fichiers ne viennent pas du même calcul
        if (servi && c.classeComparaison !== cc.classe) throw new Error(`produit ${p.idProduct} : classe de comparaison ${c.classeComparaison} (comparaisons.json) ≠ ${cc.classe} (recalculée) : relancer lancer-comparaison.js`);
        // les motifs FINAUX (une définition, testée) : `format` DÈS QUE le nom correspond — servi ou non, y compris MANQUANT (L1) ; la finition ne se lit que sur une comparaison CONFORME
        const { motifs, finitionRaisons: finition } = C.motifsFinaux({ motifs: p.visuel.motifs, nom: p.name, comparaison: cc, classeVisuel, finition: p.visuel.finition });
        return { idProduct: p.idProduct, idExpansion: p.idExpansion, set: p.setId, nom: p.name, famille: s.famille, langue: s.langue, type: s.type || 'non-type', tamponnee: s.tamponnee || null,
            classeFiche: p.fiche.classe, motifsFiche: p.fiche.motifs, infosFiche: p.fiche.infos || [],
            classeVisuel, classeComparaison: cc ? cc.classe : null, distance: servi && c.comparable ? c.distance : null, motifsVisuel: motifs, finitionRaisons: finition,
            _servi: servi, _cle: p.visuel.entree?.vignette?.cle || null, _copie: p.copieLocale, _ncc: c?.ncc ?? null, _couleur: c?.couleur ?? null };
    });
    const N = R.length;
    // M4 : le livrable AFFIRME « aucun produit à plusieurs entrées » (mesuré : 0) et LÈVE sinon — le cas est traité (contradictoire / doublon), mais sa présence change ce que les comptes disent
    const aPlusieurs = etat.filter(p => p.visuel.plusieursEntrees);
    if (aPlusieurs.length) throw new Error(`${aPlusieurs.length} produits à plusieurs entrées de decider (ex. ${aPlusieurs.slice(0, 5).map(p => p.idProduct).join(', ')}) : le livrable affirme plusieursEntrees == 0, à revoir avant de le publier`);
    console.log(`DÉNOMINATEUR : ${N} produits · servis ${R.filter(r => r._servi).length} · comparables ${R.filter(r => r.distance !== null).length}`);
    // LES VERDICTS À L'ŒIL des PROBABLEMENT FAUX (coordinateur, lecture des planches faux-01 à faux-05) : le fichier est la SOURCE de la phase 2, jamais la classe seule (M2 : ~49 % de faux positifs à d ≥ 0,65)
    const V = lireJson('verdicts-faux-55.json');
    const verdict = new Map();
    const poser = (ids, classe, sous = null) => { for (const id of ids) { if (verdict.has(id)) throw new Error(`verdicts-faux-55.json : ${id} classé deux fois`); verdict.set(id, { classe, sous }); } };
    poser(V['dessin-ou-produit-different'], 'dessin-ou-produit-different');
    for (const [sous, ids] of Object.entries(V['finition-format-tampon'])) poser(ids, 'finition-format-tampon', sous);
    poser(V.incertain, 'incertain'); poser(V['meme-dessin'], 'meme-dessin');
    const idsFaux = new Set(R.filter(r => r.classeVisuel === 'PROBABLEMENT_FAUX').map(r => r.idProduct));
    const horsFaux = [...verdict.keys()].filter(id => !idsFaux.has(id)), sansVerdict = [...idsFaux].filter(id => !verdict.has(id));
    if (horsFaux.length || sansVerdict.length) throw new Error(`verdicts-faux-55.json ne correspond plus aux PROBABLEMENT FAUX : ${horsFaux.length} verdicts hors de la classe (${horsFaux.slice(0, 5)}), ${sansVerdict.length} produits de la classe sans verdict (${sansVerdict.slice(0, 5)}) — les seuils ou les distances ont bougé depuis la lecture à l'œil`);
    const parVerdict = compter([...verdict.values()], v => v.classe);
    for (const [k, v] of Object.entries(V._comptes)) if (k !== 'total' && (parVerdict.get(k) || 0) !== v) throw new Error(`verdicts-faux-55.json : ${k} compte ${parVerdict.get(k) || 0}, le fichier annonce ${v}`);
    for (const r of R) r.verdictOeil = verdict.get(r.idProduct) || null;
    const sortieJ = R.map(({ _servi, _cle, _copie, _ncc, _couleur, ...r }) => r);
    ecrireJson('audit-produits.json', sortieJ);

    // ── LES COMPTES
    const parVisuel = compter(R, r => r.classeVisuel), parFiche = compter(R, r => r.classeFiche);
    const n = (m, k) => m.get(k) || 0;
    const servis = R.filter(r => r._servi);
    const cmpServis = compter(servis, r => r.classeComparaison);
    const motifsManquant = compter(R.filter(r => r.classeVisuel === 'MANQUANT'), r => r.motifsVisuel.filter(m => m !== C.MOTIF_EMPRUNT_REFUSE));
    const refuseFam = compter(R.filter(r => r.motifsVisuel.includes(C.MOTIF_EMPRUNT_REFUSE)), r => { const m = r.motifsVisuel.find(x => /^repli-refuse:/.test(x)); if (!m) throw new Error(`produit ${r.idProduct} : motif ${C.MOTIF_EMPRUNT_REFUSE} sans motif repli-refuse:<famille> (${r.motifsVisuel.join(', ')}) — incohérence de classement`); return m.slice('repli-refuse:'.length); });
    const formats = R.filter(r => r.motifsVisuel.includes('format'));
    const inverif = compter(R.filter(r => r.classeVisuel === 'INVERIFIABLE'), r => (r.motifsVisuel.includes('format') ? 'format' : r.motifsVisuel[r.motifsVisuel.length - 1] || 'inconnu'));
    const conformes = R.filter(r => r.classeVisuel === 'CONFORME');
    const fin = R.filter(r => r.finitionRaisons.length);
    const finConf = fin.filter(r => r.classeVisuel === 'CONFORME');
    const raisonsFin = compter(finConf, r => r.finitionRaisons);
    const anciennes = R.filter(r => r.infosFiche.includes('sans-numero-set-numerote'));
    const nouvelle = R.filter(r => r.motifsFiche.includes('sans-numero'));
    const motifsFiche = compter(R.filter(r => r.classeFiche === 'FICHE_DOUTEUSE'), r => r.motifsFiche);
    const absentes = mesSets.lignesSet.filter(l => l.absente), incompletes = mesSets.lignesSet.filter(l => l.incomplete);
    console.log('visuels', JSON.stringify(Object.fromEntries(parVisuel)), 'fiches', JSON.stringify(Object.fromEntries(parFiche)));

    // ── tableaux croisés
    const ventiler = (xs, cle) => { const m = new Map(); for (const r of xs) { const k = cle(r), e = m.get(k) || []; e.push(r); m.set(k, e); } return m; };
    const ligneClasses = (xs) => [nb(xs.length), ...CLASSES_FICHE.map(c => nb(xs.filter(r => r.classeFiche === c).length)), ...CLASSES.map(c => nb(xs.filter(r => r.classeVisuel === c).length))];
    const entetesClasses = ['Produits', 'Fiche OK', 'Douteuse', 'Ligne sans fiche', 'Sans ligne', 'Manquant', 'Emprunté', 'Basse déf.', 'Conforme', 'Incertain', 'Prob. faux', 'Invérifiable'];
    const finParFamille = FAMILLES.map(f => [f, nb(conformes.filter(r => r.famille === f).length), nb(finConf.filter(r => r.famille === f).length), pct(finConf.filter(r => r.famille === f).length, conformes.filter(r => r.famille === f).length)]);
    const refuseParFamille = [...refuseFam].map(([f, k]) => [f, nb(k)]);

    // ── LES PLANCHES
    const idx = indexerDisque();
    let r2 = null;
    const cheminNous = async (cle) => {
        const f = sortie(`cache-nos-vignettes/${sha1(cle)}.webp`);
        if (!fs.existsSync(f)) { r2 = r2 || await ouvrirR2Lecture(); fs.writeFileSync(f, await r2.lire(cle)); }
        return f;
    };
    const cellule = async (r, titre) => ({ nous: r._cle ? await cheminNous(r._cle) : null, cm: idx.get(r.idProduct) || null, absentNous: r._servi ? 'vignette illisible' : (r.classeVisuel === 'MANQUANT' ? 'aucun visuel servi' : 'aucun visuel'),
        absentCm: 'pas de copie locale Cardmarket', titre, droite: r.distance !== null ? `ncc ${r._ncc.toFixed(2)} · couleur ${r._couleur.toFixed(2)}` : (r._servi ? 'non comparé' : ''), bas: `${r.idProduct} · ${r.nom}`,
        bas2: `${r.verdictOeil ? `ŒIL : ${r.verdictOeil.sous || r.verdictOeil.classe} · ` : ''}${r.set || `exp ${r.idExpansion}`} · ${r.motifsVisuel.slice(0, 3).join(', ')}` });
    const planches = {};
    // 1. les 100 PROBABLEMENT FAUX les plus sûrs : distance décroissante, exclusions de format retirées (déjà INVÉRIFIABLES)
    const faux = R.filter(r => r.classeVisuel === 'PROBABLEMENT_FAUX').sort((a, b) => b.distance - a.distance || a.idProduct - b.idProduct);
    const faux100 = faux.slice(0, 100);
    let cs = []; for (const [i, r] of faux100.entries()) cs.push(await cellule(r, `#${i + 1} FAUX d = ${r.distance.toFixed(3)}`));
    planches.faux = { total: faux.length, montres: faux100.length, fichiers: await rendrePlanches(cs, { prefixe: 'faux', dossier: 'planches' }) };
    // 2. TOUS les INCERTAIN s'il y en a moins de 300, sinon un échantillon de 120
    const incertains = R.filter(r => r.classeVisuel === 'INCERTAIN').sort((a, b) => a.distance - b.distance);
    const montresInc = incertains.length < 300 ? incertains : tirer(incertains, 120, 20261024).sort((a, b) => a.distance - b.distance);
    cs = []; for (const [i, r] of montresInc.entries()) cs.push(await cellule(r, `#${i + 1} INCERTAIN d = ${r.distance.toFixed(3)}`));
    planches.incertain = { total: incertains.length, montres: montresInc.length, regle: incertains.length < 300 ? 'tous' : 'échantillon de 120', fichiers: await rendrePlanches(cs, { prefixe: 'incertain', dossier: 'planches' }) };
    // 3. un échantillon de 20 par classe
    planches.echantillons = {};
    for (const classe of CLASSES) {
        const pop = R.filter(r => r.classeVisuel === classe), ech = tirer(pop, 20, 7000 + CLASSES.indexOf(classe));
        cs = []; for (const [i, r] of ech.entries()) cs.push(await cellule(r, `${classe.slice(0, 5)} #${i + 1}${r.distance !== null ? `  d = ${r.distance.toFixed(3)}` : ''}`));
        planches.echantillons[classe] = { total: pop.length, montres: ech.length, fichiers: await rendrePlanches(cs, { prefixe: `echantillon-${classe.toLowerCase()}`, dossier: 'planches' }) };
    }
    console.log('planches :', JSON.stringify(Object.fromEntries(Object.entries(planches).map(([k, v]) => [k, k === 'echantillons' ? Object.fromEntries(Object.entries(v).map(([c, x]) => [c, x.fichiers.length])) : v.fichiers.length]))));

    // ── LE DOCUMENT
    const L = [];
    const S = '\n';
    L.push('# Audit du catalogue Rat-Market — fiches, visuels, sets', '');
    L.push(`Produit le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC par \`audit-catalogue/lancer-livrable.js\` (branche \`c-audit\`). Lecture seule : bases par les utilisateurs de lecture, R2 en GetObject, aucune requête Cardmarket.`, '');
    L.push(`**Dénominateur : ${nb(N)} produits** = les ${nb(74925)} de l'export Cardmarket du 23/10 (\`catalogue_produits\`) − ${nb(1264)} cartes-code (\`estCarteCode\`, celui de mesure-catalogue.js), dans ${nb(mesSets.expansionsHorsCartesCode)} expansions. ` +
        `La fiche est celle que la règle du site attribue (\`fichesDesProduits\`, appelée par \`decider\` de l'API) ; le visuel est celui que l'API construirait (\`decider\` puis \`lireEntree\`, sur les 778 sets, API du dossier \`pokemon-proxy-api-v2\`).`, '');
    L.push('## Définitions et seuils', '');
    L.push(md(['Visuel', 'Règle'], [
        ['MANQUANT', 'aucune entrée servie par l\'API (sans ligne, sans fiche du site, aucun visuel, repli refusé, partage incohérent…)'],
        ['EMPRUNTÉ', 'le visuel servi est un `substitut` ou un `autre-tirage` (ou l\'image porte `imageEmprunteeTirage`)'],
        ['BASSE DÉFINITION', '`basseDefinition: true`'],
        ['CONFORME', `distance < ${vir(C.SEUILS.conforme)} : « même illustration » (PAS « même impression », voir la limite)`],
        ['INCERTAIN', `${vir(C.SEUILS.conforme)} ≤ distance < ${vir(C.SEUILS.incertain)} : une planche pour le testeur`],
        ['PROBABLEMENT FAUX', `distance ≥ ${vir(C.SEUILS.incertain)}, hors exclusions de format`],
        ['INVÉRIFIABLE', 'pas de copie locale Cardmarket, copie ou vignette qui n\'est pas au format portrait, aplat, et le FORMAT (nom contenant `LEGEND`, `V-UNION`, `BREAK` ou `Oversized`, quelle que soit la distance ; motif `format`)']]), '');
    L.push('La classe principale suit l\'ordre MANQUANT > EMPRUNTÉ > BASSE DÉFINITION > comparaison ; un produit EMPRUNTÉ ou en basse définition est AUSSI comparé, la comparaison est dans `audit-produits.json` (`classeComparaison`, `distance`) et ci-dessous. ' +
        'Distance : 1 − max(corrélation normalisée du centre de l\'illustration, 0), recalage ±5/±4 colonnes ; 0 = même dessin. Les seuils sont les constantes `SEUILS` de `classement.js`, lues par le coordinateur sur `calibration-200.json`.', '');

    L.push('## 1. Global', '');
    L.push('### 1.1 Sets', '');
    L.push(`L'export compte ${nb(mesSets.expansionsExport)} expansions ; ${mesSets.exSeulementCartesCode.length} ne contiennent que des cartes-code. Les ${nb(mesSets.expansionsHorsCartesCode)} autres : **${absentes.length} ABSENTES** (aucun set, ${nb(absentes.reduce((s, l) => s + l.produits, 0))} produits), **${incompletes.length} INCOMPLÈTES** (un set, des produits sans ligne : ${nb(incompletes.reduce((s, l) => s + l.sansLigne, 0))} sans ligne sur ${nb(incompletes.reduce((s, l) => s + l.produits, 0))}).`, '');
    L.push(md(['Famille', 'Expansions', 'Produits', 'Sans ligne', 'Incomplètes', 'Absentes'], FAMILLES.map(f => { const ls = mesSets.lignesSet.filter(l => l.famille === f); return [f, nb(ls.length), nb(ls.reduce((s, l) => s + l.produits, 0)), nb(ls.reduce((s, l) => s + l.sansLigne, 0)), nb(ls.filter(l => l.incomplete).length), nb(ls.filter(l => l.absente).length)]; })), '');
    L.push('Absentes : ' + absentes.map(l => `${l.idExpansion} ${l.codeSet || '—'} (${l.produits} p.)`).join(' · '), '');

    L.push('### 1.2 Fiches', '');
    L.push(md(['Classe', 'Produits', 'Part', 'Définition'], [
        ['FICHE_OK', nb(n(parFiche, 'FICHE_OK')), pct(n(parFiche, 'FICHE_OK'), N), 'une fiche du site, sans motif'],
        ['FICHE_DOUTEUSE', nb(n(parFiche, 'FICHE_DOUTEUSE')), pct(n(parFiche, 'FICHE_DOUTEUSE'), N), 'une fiche, avec au moins un motif (ci-dessous)'],
        ['LIGNE_SANS_FICHE', nb(n(parFiche, 'LIGNE_SANS_FICHE')), pct(n(parFiche, 'LIGNE_SANS_FICHE'), N), 'une ligne, mais la règle du site n\'attribue aucune fiche (dont 4 produits joints à deux cartes : `plusieurs-cartes`)'],
        ['SANS_LIGNE', nb(n(parFiche, 'SANS_LIGNE')), pct(n(parFiche, 'SANS_LIGNE'), N), `aucune ligne cartes_produits (dont ${nb(R.filter(r => r.classeFiche === 'SANS_LIGNE' && r.idProduct >= 917000).length)} récents, idProduct ≥ 917000)`]]), '');
    L.push('Motifs des fiches douteuses (non exclusifs) :', '');
    L.push(md(['Motif', 'Produits', 'Définition'], [
        ['`preuve-nom-seul`', nb(n(motifsFiche, 'preuve-nom-seul')), 'la seule preuve de la ligne est `set+nom` ou `setlist+nom` (confirmé : rien d\'autre n\'est « faible »)'],
        ['`sans-numero` (resserrée)', nb(n(motifsFiche, 'sans-numero')), 'la CONJONCTION : le set a au moins une fiche numérotée ET le numéro du produit est connu (`numeros_cartes.numero` ou `numeroFiche` d\'une ligne) alors que la fiche n\'en porte pas (décision du coordinateur, M1 : une fiche « n° ? » d\'un set sans aucune fiche numérotée — Gem Packs, Half Decks — n\'est pas douteuse)'],
        ['`contredite-par-le-nom`', nb(n(motifsFiche, 'contredite-par-le-nom')), 'le témoin du nom (`temoinDuNom`) désigne une autre carte du set ; contrôle : il en contredit 97,2 % sur 600 fiches fabriquées fausses, et se tait sur 600 vraies'],
        ['`plusieurs-cartes`', nb(R.filter(r => r.motifsFiche.includes('plusieurs-cartes')).length), 'le produit est joint à plusieurs cartes (rangé en LIGNE_SANS_FICHE : la règle ne le sert à aucune fiche)']]), '');
    L.push(`L'ANCIENNE définition de \`sans-numero\` (le set a des fiches numérotées, sans exiger le numéro du produit), à titre informatif : **${nb(anciennes.length)}** produits (champ \`infosFiche\`) ; la conjonction retenue en garde **${nb(nouvelle.length)}** comme motif.`, '');

    L.push('### 1.3 Visuels', '');
    L.push('> **LIMITE, À LIRE AVANT LES CHIFFRES.** L\'empreinte juge l\'ILLUSTRATION. Elle ne voit PAS la finition (holo, non-holo, reverse, cosmos) ni un tampon hors de la fenêtre centrale. Paires vues : Machamp National Championships 449903 à 0,42 ; Lucario ex Oversized 845430 à 0,128 ; Slowpoke Toys R Us 873081 à 0,577 ; Charizard non-holo 855023 à 0,666. ' +
        '**CONFORME veut dire « même illustration », pas « même impression ».** Les produits CONFORME dont le nom, le set, la variante ou l\'image portent une finition ou un tampon sont marqués `finition-ou-tampon-non-verifie` et comptés à part (tableau plus bas). Pas de détecteur de tampon dans ce passage.', '');
    L.push(md(['Classe', 'Produits', 'Part'], CLASSES.map(c => [c, nb(n(parVisuel, c)), pct(n(parVisuel, c), N)])), '');
    L.push(`Comparaison de TOUS les produits servis (${nb(servis.length)} ; la classe principale n'est pas remplacée pour les EMPRUNTÉ et BASSE DÉFINITION) : ` + ['CONFORME', 'INCERTAIN', 'PROBABLEMENT_FAUX', 'INVERIFIABLE'].map(c => `${c} ${nb(n(cmpServis, c))}`).join(' · ') + '.', '');
    L.push(md(['Classe principale', 'Servis', 'Conforme', 'Incertain', 'Prob. faux', 'Invérifiable'], ['A_COMPARER (devenue CONFORME/INCERTAIN/FAUX/INVÉRIF.)', 'EMPRUNTE', 'BASSE_DEFINITION'].map(c => {
        const xs = servis.filter(r => (c.startsWith('A_') ? !['EMPRUNTE', 'BASSE_DEFINITION'].includes(r.classeVisuel) : r.classeVisuel === c));
        return [c, nb(xs.length), ...['CONFORME', 'INCERTAIN', 'PROBABLEMENT_FAUX', 'INVERIFIABLE'].map(k => nb(xs.filter(r => r.classeComparaison === k).length))]; })), '');
    L.push('**MANQUANT par motif** (dénominateur ' + nb(n(parVisuel, 'MANQUANT')) + ') : ' + [...motifsManquant].map(([k, v]) => `${k} ${nb(v)}`).join(' · '), '');
    L.push(`**Sous-motif \`emprunt-refuse-par-api\`** : ${nb(R.filter(r => r.motifsVisuel.includes(C.MOTIF_EMPRUNT_REFUSE)).length)} produits restent MANQUANT parce que l'API refuse d'en servir le visuel emprunté (repli-réimpressions). Par famille : ${refuseParFamille.map(x => `${x[0]} ${x[1]}`).join(' · ')}.`, '');
    L.push(`**Format** (\`LEGEND\`, \`V-UNION\`, \`BREAK\`, \`Oversized\`) : ${nb(formats.length)} produits portent le motif \`format\` dès que leur nom correspond (dont ${nb(formats.filter(r => r._servi).length)} servis, ${nb(formats.filter(r => !r._servi).length)} MANQUANT sans visuel servi) ; INVÉRIFIABLE par le format : ${nb(R.filter(r => r.classeVisuel === 'INVERIFIABLE' && r.motifsVisuel.includes('format')).length)}.`, '');
    L.push('**INVÉRIFIABLE par motif** (dénominateur ' + nb(n(parVisuel, 'INVERIFIABLE')) + ') : ' + [...inverif].map(([k, v]) => `${k} ${nb(v)}`).join(' · '), '');
    L.push(`**\`finition-ou-tampon-non-verifie\`** : ${nb(finConf.length)} des ${nb(conformes.length)} CONFORME (${pct(finConf.length, conformes.length)}) ; ${nb(fin.length - finConf.length)} autres produits servis, EMPRUNTÉ ou en basse définition, à comparaison CONFORME, le portent aussi. Raisons (non exclusives, sur les CONFORME) : ${[...raisonsFin].map(([k, v]) => `${k} ${nb(v)}`).join(' · ')}.`, '');
    L.push(md(['Famille', 'CONFORME', 'dont finition-ou-tampon', 'Part'], finParFamille), '');

    L.push('### 1.4 Verdicts à l\'œil des 55 PROBABLEMENT FAUX', '');
    L.push(`Le coordinateur a lu à l'œil les planches \`faux-01\` à \`faux-05\` (${V._lu}). Fichier : \`verdicts-faux-55.json\`, repris dans \`audit-produits.json\` (champ \`verdictOeil\`).`, '');
    const sousFin = compter([...verdict.values()].filter(v => v.classe === 'finition-format-tampon'), v => v.sous);
    L.push(md(['Verdict', 'Produits', 'Sens'], [
        ['dessin ou produit différent', nb(n(parVerdict, 'dessin-ou-produit-different')), V._classes['dessin-ou-produit-different']],
        ['finition, format ou tampon', nb(n(parVerdict, 'finition-format-tampon')), `${V._classes['finition-format-tampon']} — ${[...sousFin].map(([k, v]) => `${k} ${v}`).join(', ')}`],
        ['même dessin', nb(n(parVerdict, 'meme-dessin')), V._classes['meme-dessin']],
        ['incertain', nb(n(parVerdict, 'incertain')), V._classes.incertain]]), '');
    L.push(`**Faux positifs de l'empreinte à d ≥ ${vir(C.SEUILS.incertain)} (M2) : ${nb(n(parVerdict, 'meme-dessin'))} sur ${nb(verdict.size)} (${pct(n(parVerdict, 'meme-dessin'), verdict.size)}) sont le MÊME dessin** (cartes dorées, shiny, scans plats). ` +
        '**La phase 2 consomme `verdicts-faux-55.json`, jamais la classe PROBABLEMENT_FAUX seule** : la moitié de la classe n\'est pas fausse. Les 17 « dessin ou produit différent » sont les faux à haute confiance ; les 10 « finition, format ou tampon » se traitent par la règle des emprunts.', '');
    L.push('Dessin ou produit différent : ' + V['dessin-ou-produit-different'].join(', ') + '.', '');

    L.push('## 2. Par famille', '');
    L.push('### 2.1 Famille (langue du tirage du set : `tirage ?? region`)', '');
    const vf = ventiler(R, r => r.famille);
    L.push(md(['Famille', ...entetesClasses], FAMILLES.filter(f => vf.has(f)).map(f => [f, ...ligneClasses(vf.get(f))])), '');
    L.push('### 2.2 Famille × type de set', '');
    const rows = [];
    for (const f of FAMILLES) for (const t of ['extension', 'promo', 'deck', 'non-type']) { const xs = R.filter(r => r.famille === f && r.type === t); if (xs.length) rows.push([f, t === 'non-type' ? 'non typé' : t, ...ligneClasses(xs)]); }
    L.push(md(['Famille', 'Type', ...entetesClasses], rows), '');
    L.push('### 2.3 Tamponnées (sets à `reimpressions` : WCD, Prize Packs, Battle Academy, Trick or Trade…) et ordinaires', '');
    const rows2 = [];
    for (const f of FAMILLES) { const t = R.filter(r => r.famille === f && r.tamponnee), o = R.filter(r => r.famille === f && !r.tamponnee); if (t.length) rows2.push([f, 'tamponnée', ...ligneClasses(t)]); if (o.length) rows2.push([f, 'ordinaire', ...ligneClasses(o)]); }
    L.push(md(['Famille', 'Nature', ...entetesClasses], rows2), '');
    L.push('Par réimpression : ' + [...compter(R.filter(r => r.tamponnee), r => r.tamponnee)].map(([k, v]) => `${k} ${nb(v)}`).join(' · '), '');

    L.push('## 3. Par set (une ligne par expansion Cardmarket, triée par famille puis par produits à traiter : manquant + incertain + prob. faux)', '');
    const parExp = ventiler(R, r => r.idExpansion);
    const lignesSets = mesSets.lignesSet.map(l => { const xs = parExp.get(l.idExpansion) || []; const traiter = xs.filter(r => ['MANQUANT', 'INCERTAIN', 'PROBABLEMENT_FAUX'].includes(r.classeVisuel)).length; return { l, xs, traiter }; })
        .sort((a, b) => FAMILLES.indexOf(a.l.famille) - FAMILLES.indexOf(b.l.famille) || b.traiter - a.traiter || b.xs.length - a.xs.length);
    L.push(md(['idExp', 'Code', 'Set', 'Langue', 'Type', ...entetesClasses], lignesSets.map(({ l, xs }) => [l.idExpansion, l.codeSet || '—', String(l.nom || `(expansion ${l.idExpansion} sans set)`).replace(/\|/g, '/'), l.langue, (l.tamponnee ? `tamponnée ${l.tamponnee}` : (l.type || '—')), ...ligneClasses(xs)])), '');

    L.push('## 4. Planches (S8\\AUDIT\\planches\\, 12 paires par planche, à gauche notre vignette, à droite la copie locale Cardmarket)', '');
    L.push(`- **Les 100 PROBABLEMENT FAUX les plus sûrs** (distance décroissante, exclusions de format retirées) : \`faux-01.jpg\` à \`faux-${String(planches.faux.fichiers.length).padStart(2, '0')}.jpg\` — ${planches.faux.montres} montrés sur ${nb(planches.faux.total)}.`);
    L.push(`- **INCERTAIN** : \`incertain-01.jpg\` à \`incertain-${String(planches.incertain.fichiers.length).padStart(2, '0')}.jpg\` — ${planches.incertain.regle} (${planches.incertain.montres} montrés sur ${nb(planches.incertain.total)} ; la règle : tous s'il y en a moins de 300).`);
    for (const c of CLASSES) L.push(`- **Échantillon de 20, ${c}** : \`echantillon-${c.toLowerCase()}-01.jpg\`… — ${planches.echantillons[c].montres} sur ${nb(planches.echantillons[c].total)}${['MANQUANT', 'INVERIFIABLE'].includes(c) ? ' (un côté peut être absent : la case le dit)' : ''}.`);
    L.push('', '`audit-produits.json` : un enregistrement par produit — `idProduct`, `idExpansion`, `set`, `famille`, `type`, `classeFiche`, `motifsFiche`, `infosFiche`, `classeVisuel`, `classeComparaison`, `distance`, `motifsVisuel`, `finitionRaisons`, `verdictOeil` (les 55 PROBABLEMENT FAUX lus à l\'œil, sinon null).', '');

    L.push('## 5. Limites', '');
    L.push('- L\'empreinte du centre ne voit ni la finition ni les tampons (voir le cadre en 1.3). Les cartes en paysage, les V-UNION, les LEGEND et les surdimensionnées ne se jugent pas : INVÉRIFIABLE, motif `format`.');
    L.push('- « Visuel servi » = ce que l\'API construit aujourd\'hui ; les 4 familles de repli (WCD, Prize Packs, tamponnées nommées, 30th) sont MANQUANT avec le sous-motif, jamais EMPRUNTÉ.');
    L.push('- La planche de calibration (`calibration-200.json`) répartit les 200 paires 121 / 22 / 57 avec les constantes 0,55 et 0,65 ; `seuils.md` écrivait 120 / 31 / 49 (les rangs 144 à 151, de 0,654 à 0,674, sont ≥ 0,65). Les 3 dessins différents de la bande et les 13 de ≥ 0,65 nommés par le coordinateur tombent dans les bonnes classes (test-second-passage.js).');
    L.push('- La relecture indépendante de `c-audit` 32b86816 est APPROUVÉE avec réserves ; M1, M3, M4, L1, L3, L7 sont corrigés dans cette version (voir le journal du commit). **M2** : à d ≥ 0,65 environ 49 % de faux positifs (section 1.4) — la classe seule ne se consomme pas.');
    L.push('- **L8 (vérifié, juste, non corrigé)** : 651752 et 651753 (Darkness Energy, Metal Energy) sont rangés par Cardmarket dans l\'expansion 6697 (Unnumbered Energies, aucun set chez nous) mais leur ligne porte l\'expansion 1566 et le set HeartGold-SoulSilver (preuve `setlist+nom`, donc fiche douteuse « nom seul ») ; 742991 (Geeta, slug `Geeta-V4-OBF188`) est rangé dans l\'expansion 2107 (Promos) mais sa ligne est dans Obsidian Flames (expansion 5385, `set+numero`). Le produit a changé d\'expansion chez Cardmarket ; la règle de l\'API joint par la ligne, donc le set de la fiche n\'est pas dans les sets de l\'expansion du catalogue.');
    L.push('- **L2 — constantes figées dans le texte** : des nombres du document sont écrits en dur dans `lancer-livrable.js` (les 74 925 produits de l\'export et les 1 264 cartes-code, « 778 sets », « 97,2 % sur 600 fiches fabriquées », « 121 / 22 / 57 » de la planche, les 4 produits à deux cartes) ; ils sont justes à la date du produit et ne se recalculent pas.');
    L.push('- **L4 — garde de cohérence** : le livrable vérifie que les produits servis et les paires de `comparaisons.json` ont le MÊME COMPTE, pas les mêmes clés (idProduct par idProduct) ; la classe de comparaison écrite et recalculée est, elle, comparée produit par produit.');
    L.push('- **L5 — variables de lecture** : la garde `collecte-cartes/variables-requises.js` n\'est pas reprise ; `lecture-audit.js` vérifie seulement la présence des deux URI de lecture et qu\'aucune base n\'est vide.');
    L.push('- **L6 — couverture des tests** : `assembler`, `rejouerApi`, `mesurerSets`, `controlerTemoin` et les agrégats du livrable (tableaux croisés, comptes par famille) ne sont pas testés ; ce sont les fonctions pures (`classement.js`, `rapprochement.js`, `empreinte.js`, `stratifier.js`, `juger`, `enregistrer`, `motifManquant`) qui le sont, plus les gardes qui lèvent à l\'exécution.');
    L.push('- Cette version n\'a pas été relue par un second agent (consigne : aucun sous-agent).');
    fs.writeFileSync(sortie('AUDIT-CATALOGUE.md'), L.join(S) + S);
    ecrireJson('resume-livrable.json', { le: new Date().toISOString(), denominateur: N, visuels: Object.fromEntries(parVisuel), fiches: Object.fromEntries(parFiche), comparaisonServis: Object.fromEntries(cmpServis), motifsManquant: Object.fromEntries(motifsManquant), empruntRefuse: Object.fromEntries(refuseFam),
        format: formats.length, formatInverifiable: R.filter(r => r.classeVisuel === 'INVERIFIABLE' && r.motifsVisuel.includes('format')).length, inverifiable: Object.fromEntries(inverif), finition: { conformes: conformes.length, concernes: finConf.length, autres: fin.length - finConf.length, parFamille: finParFamille, raisons: Object.fromEntries(raisonsFin) },
        sansNumero: { ancienne: anciennes.length, resserree: nouvelle.length }, motifsFiche: Object.fromEntries(motifsFiche), planches: { faux: planches.faux, incertain: planches.incertain, echantillons: planches.echantillons } }, { indent: 1 });
    console.log(`✅ AUDIT-CATALOGUE.md, audit-produits.json, planches\\ · ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });

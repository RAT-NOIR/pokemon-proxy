'use strict';
// MARQUE-EMPRUNT / VERDICTS — un emprunt jugé « juste » est VÉRIFIÉ (empruntDe → false, la règle d'image s'en sert) ; « exclu » sort de l'identification ; null, aucune ligne ou aucun fichier : l'emprunt reste non vérifié
// (empruntDe → true, la règle se tait : défaut fermé) ; un fichier illisible ou un verdict inconnu fait LEVER la construction. Pas de base, pas de réseau.
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./_harnais');
const V = require('../chargeur/verdicts-emprunts'); const { regleEmbarquee } = require('../chargeur/regle-site'); const { calculer } = require('../chargeur/calcul');
const { principal } = require('../migrations/construire-fichier-visuels');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verdicts-'));
const ecrire = (nom, contenu) => { const p = path.join(dossier, nom); fs.writeFileSync(p, typeof contenu === 'string' ? contenu : JSON.stringify(contenu)); return p; };

(async () => {
    // ── 1. le fichier : écrit par ce qu'il autorise
    const j = V.jugerVerdicts([{ idProduct: 1, verdict: 'juste', preuve: 'p' }, { idProduct: 2, verdict: 'exclu', comparaisons: 3 }, { idProduct: 3, verdict: null }, { idProduct: 1, verdict: 'juste' }]);
    H.v('1a. trois verdicts (juste, exclu, null) admis ; un doublon IDENTIQUE est admis', [j.ok, [...j.verdicts], j.comptes], [true, [[1, 'juste'], [2, 'exclu'], [3, null]], { lignes: 4, juste: 1, exclu: 1, sansVerdict: 1 }]);
    const motif = x => { const r = V.jugerVerdicts(x); return r.ok ? 'ADMIS' : r.raison; };
    H.v('1b. verdict inconnu (« retrait », « Juste », 1, texte vide) : refusé', ['retrait', 'Juste', 1, ''].map(v => /verdict inconnu/.test(motif([{ idProduct: 1, verdict: v }]))), [true, true, true, true]);
    H.v('1c. `verdict` ABSENT (null admis, absent non) : refusé', /absent/.test(motif([{ idProduct: 1 }])), true);
    H.v('1d. idProduct non entier > 0 (0, -1, 1.5, "7", null) : refusé', [0, -1, 1.5, '7', null].map(id => /idProduct/.test(motif([{ idProduct: id, verdict: 'juste' }]))), Array(5).fill(true));
    H.v('1e. un produit avec deux verdicts DIFFÉRENTS : refusé ; une ligne qui n\'est pas un objet : refusé ; autre chose qu\'un tableau : refusé', [/deux verdicts/.test(motif([{ idProduct: 1, verdict: 'juste' }, { idProduct: 1, verdict: 'exclu' }])), /objet/.test(motif([5])), /tableau/.test(motif({ a: 1 }))], [true, true, true]);
    H.v('1f. le fichier : tableau, ou objet { lignes } ; introuvable, vide, JSON illisible : refusés avec leur raison, sans lever',
        [V.lireFichierVerdicts(ecrire('a.json', [{ idProduct: 5, verdict: 'juste' }])).ok, V.lireFichierVerdicts(ecrire('b.json', { lignes: [{ idProduct: 5, verdict: null }] })).ok,
            V.lireFichierVerdicts(path.join(dossier, 'absent.json')).raison, V.lireFichierVerdicts(ecrire('vide.json', '')).raison, V.lireFichierVerdicts(ecrire('x.json', '{pas du json')).raison, V.lireFichierVerdicts('').raison],
        [true, true, 'le fichier est introuvable ou illisible', 'le fichier est vide', 'le fichier n\'est pas du JSON lisible', 'aucun fichier nommé']);

    // ── 2. la construction : la ligne de commande refuse AVANT toute lecture de source
    const sortie = path.join(dossier, 'sortie.rmv'); const messages = []; const muet = async f => { const e = console.error; console.error = m => messages.push(String(m)); try { return await f(); } finally { console.error = e; } };
    const code = async argv => muet(() => principal(['node', 'x', `--vers=${sortie}`, ...argv], {}, {}));
    H.v('2a. --verdicts-emprunts sans « = », ou fichier illisible, ou verdict inconnu : code 1, aucune archive écrite', [await code(['--verdicts-emprunts']), await code([`--verdicts-emprunts=${path.join(dossier, 'absent.json')}`]),
        await code([`--verdicts-emprunts=${ecrire('mauvais.json', [{ idProduct: 1, verdict: 'retrait' }])}`]), fs.existsSync(sortie), messages.map(m => /--verdicts-emprunts/.test(m) && /(forme est|fichier refusé)/.test(m))], [1, 1, 1, false, [true, true, true]]);

    // ── 3. le calcul : juste → vérifié (false), exclu → hors identification, null / absent → emprunt non vérifié (true)
    const regle = await regleEmbarquee();
    const set = { _id: 'Set-A', idExpansion: 100, code: 'SETA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } };
    const setB = { _id: 'Set-B', idExpansion: 200, code: 'SETB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } };
    const im = (setId, numero, n) => ({ set: setId, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `vignettes/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const carte = (id, numero, images) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' }], images });
    // 4001 du set · 4002, 4003, 4004, 4005 : visuel d'un autre tirage (emprunts)
    const docs = [carte(40, '020', [im('Set-A', '020', 'c40')]), ...[41, 42, 43, 44].map(id => carte(id, `0${id - 20}`, [im('Set-B', `0${id - 20}`, `c${id}`)]))];
    const lignes = docs.map((d, i) => ({ idProduct: 4001 + i, carteId: d._id, idExpansion: 100, numeroFiche: d.impressions[0].numero, slug: `P${4001 + i}-X`, slugSet: 'Set-A' }));
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const calc = verdicts => calculer({ sets: [set, setB], docs, lignes, metacarte, regle, ...(verdicts ? { verdictsEmprunts: verdicts } : {}) });
    const etatsDe = c => [4001, 4002, 4003, 4004, 4005].map(id => c.version.empruntDe(id));
    const sans = await calc();
    H.v('3a. SANS fichier : les quatre emprunts restent non vérifiés (true), le produit du set est propre (false) — le comportement d\'avant', [etatsDe(sans), sans.version.comptes.emprunts], [[false, true, true, true, true], 4]);
    const avec = await calc(new Map([[4002, 'juste'], [4003, 'exclu'], [4004, null]]));
    H.v('3b. 4002 « juste » : vérifié (false), AVEC son entrée ; 4003 « exclu » : plus d\'entrée (null) ; 4004 verdict null et 4005 sans ligne : emprunts non vérifiés (true)', [etatsDe(avec), !!avec.version.entree(4002), !!avec.version.entree(4003), avec.version.comptes.emprunts], [[false, false, null, true, true], true, false, 2]);
    H.v('3c. les compteurs de la construction : 1 emprunt vérifié, 1 exclu par verdict, le dénominateur (décidés − vérifiés = 3) et la colonne (moins l exclu = 2)', [avec.comptes.empruntsVerifies, avec.comptes.empruntsExclusParVerdict, avec.comptes.empruntsProduits, avec.comptes.empruntsColonne], [1, 1, 3, 2]);
    const surDuSet = await calc(new Map([[4001, 'juste'], [9999, 'juste']]));
    H.v('3d. un verdict « juste » sur un produit qui n\'est pas un emprunt, ou sur un produit absent du jeu : sans effet (compté à part, jamais de levée muette)', [etatsDe(surDuSet), surDuSet.comptes.empruntsVerifies, surDuSet.comptes.verdictsSansEmprunt], [[false, true, true, true, true], 0, 2]);
    const avecExclusions = await calculer({ sets: [set, setB], docs, lignes, metacarte, regle, exclusions: new Map([[4005, 'en-attente']]), verdictsEmprunts: new Map([[4003, 'exclu'], [4005, 'exclu']]) });
    H.v('3e. exclusions explicites ET verdicts « exclu » se cumulent (le motif explicite de 4005 est gardé) : 4003 et 4005 sans entrée', [avecExclusions.version.entree(4003), avecExclusions.version.entree(4005), avecExclusions.comptes.exclusParMotif], [null, null, { 'visuel-faux': 1, 'en-attente': 1, 'entree-partagee-autre-dessin': 0, 'entree-partagee-autre-impression': 0 }]);
    const tout = await calc(new Map([[4002, 'juste'], [4003, 'juste'], [4004, 'juste'], [4005, 'juste']]));
    H.v('3f. tout vérifié : la colonne est vide mais PRÉSENTE (empruntDe false, jamais null)', [etatsDe(tout), tout.version.comptes.emprunts], [[false, false, false, false, false], 0]);

    fs.rmSync(dossier, { recursive: true, force: true });
    H.bilan();
})().catch(x => { console.error('❌', x); process.exit(1); });

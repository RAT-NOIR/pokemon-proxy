// Mutants du banc de la CHASSE NOCTURNE : chaque mutant casse UNE garde de collecte-cartes/chasse-nocturne.js (ou de la grammaire du comblement) ; test-chasse-nocturne.js doit ÉCHOUER.
// Un mutant qui survit = une garde que rien ne garde.
//   node mutants-chasse-nocturne.js            (sortie : tués / survivants)
// Le module est réécrit SUR PLACE, le temps d'un essai, puis RESTAURÉ (try/finally + contrôle final de l'identité du texte) : ne pas le lancer pendant que le comblement ou la chasse tourne.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const BANC = 'test-chasse-nocturne.js';
const GROUPES = [
    { module: 'collecte-cartes/chasse-nocturne.js', mutants: [
        ['collection : l\'inclusion d\'un nom suffit', "const egaux = (a, b) => a.length > 0 && a.length === b.length && a.every((m, i) => m === b[i]);", "const egaux = (a, b) => a.length > 0 && a.every(m => b.includes(m));"],
        ['collection : le tirage de l\'index ne borne plus les sets', "const admis = tous.filter(s => !tirages || tirages.includes(s.tirage));", "const admis = tous;"],
        ['collection : un préfixe de code seul fait preuve (inclusion)', "&& egaux(nomM, slugM.slice(codeSet.length))) trouves.set(s, 'code+nom');", "&& true) trouves.set(s, 'code+nom');"],
        ['collection : le jumeau d\'un autre tirage non troué est ignoré', "if (trou && tous.length > 1) return", "if (false) return"],
        ['collection : un set connu mais non troué est accepté', "if (trou && !tous.some(s => trou.has(s.set)))", "if (false)"],
        ['site : cinq erreurs de suite ne l\'arrêtent pas', "if (erreursDeSuite >= ERREURS_DE_SUITE_MAX) {", "if (false) {"],
        ['site : les items appariés sur le seul numéro ne sont plus comptés', "if (nomTemoin !== 'concordant') stats.surNumeroSeul++;", ""],
        ['plan : un plan périmé est accepté', "|| maintenant.getTime() - t > heures * 3600000", "|| false"],
        ['collection : un code d\'une lettre fait preuve', "codeSet.join('').length >= 2 && prefixe(codeSet, slugM)", "prefixe(codeSet, slugM)"],
        ['item : deux produits au même numéro acceptés', "if (ids.size > 1) return { ok: false, raison: 'variantes' };\n        const t = temoinDuNom", "if (false) return { ok: false, raison: 'variantes' };\n        const t = temoinDuNom"],
        ['item : le nom qui contredit le numéro est accepté', "return { refus: 'nom-contredit' };", "return { nomTemoin: 'concordant' };"],
        ['item : numéro comparé sans la clé de la jointure', "J.cleNumero(n) === cle", "String(n) === cle"],
        ['items : un produit revendiqué deux fois est gardé', "if (l.length === 1) retenus.push(l[0]);", "if (l.length >= 1) retenus.push(l[0]);"],
        ['items : le JSON-LD répété par le flux double les items (w-tcs 07/11)', "if (vus.has(cleItem)) continue;", "if (false) continue;"],
        ['items : la clé de dédoublonnage ne porte plus que l\'url (deux numéros à la même url fusionnent)', "const cleItem = `${m[1]}|${m[3]}|${m[2]}`;", "const cleItem = `${m[3]}`;"],
        ['entrée : la marque « nom-seul » n\'est plus posée', "...(via === 'nom' ? { appariement: 'nom-seul' } : {}),", ""],
        ['entrée : la marque « nom-seul » est posée sur toute entrée', "...(via === 'nom' ? { appariement: 'nom-seul' } : {}),", "appariement: 'nom-seul',"],
        ['site : les appariées sur le nom seul ne sont plus comptées', "if (via === 'nom') stats.surNomSeul++;", ""],
        ['pagination : le « & » échappé \\u0026 du flux n\'est plus décodé (w-tcs 07/11)', ".test(String(html).replace(/\\\\u0026/gi, '&').replace(/&amp;/g, '&'));", ".test(String(html));"],
        ['reprise : une page cachée par une autre version de l\'extraction est reprise', "p.v !== VERSION_EXTRACTION", "false"],
        ['numéro du titre : le total lettré (H28/H32) n\'est plus lu', "\\/\\s*([A-Za-z]{0,4}\\d+)\\s*\\)/.exec(t);", "\\/\\s*(\\d+)\\s*\\)/.exec(t);"],
        ['image : le plancher de 200 px baisse', "LARGEUR_PLANCHER = 200", "LARGEUR_PLANCHER = 100"],
        ['image : le seuil de basse définition baisse', "const LARGEUR_SERVIE = 350,", "const LARGEUR_SERVIE = 300,"],
        ['filigrane : le site déclaré est servi', "site && site.filigrane === true ?", "false ?"],
        ['cadence : le plancher de 5 s retiré', "Math.max(CADENCE_MIN_MS, ", "Math.max(0, "],
        ['fermeture : le 429 ne ferme plus', "[401, 403, 410, 429]", "[401, 403, 410]"],
        ['fermeture : l\'arrêt de la porte ne ferme plus', "e.arret || e.defi ||", "e.defi ||"],
        ['reprise : l\'image déjà obtenue est redemandée', "if (!imageDejaObtenue(registre, item.image)) {", "if (true) {"],
        ['reprise : la page récente est redemandée', "age <= PAGE_TTL_JOURS * 86400000", "age <= 0"],
        ['reprise : la page de plus de 7 jours n\'expire jamais', "age <= PAGE_TTL_JOURS * 86400000", "age <= Infinity"],
        ['pagination : une page suivante supposée', "const pageSuivante = (html, param, n) => new RegExp(", "const pageSuivante = (html, param, n) => true || new RegExp("],
        ['budget : le plafond de requêtes ignoré', "if (stats.requetes >= budget) {", "if (false) {"],
        ['cadence : l\'attente entre deux requêtes d\'un hôte supprimée', "if (attente > 0) await pause(attente);", ""],
        ['hôte : le premier 403 ne ferme rien', "if (hoteAFermer(e)) {", "if (false) {"],
        ['hôte d\'image non déclaré accepté', "if (!hotesImages.has(h)) {", "if (false) {"],
        ['produit déjà préparé retéléchargé', "if (dejaCouverts.has(produit.idProduct)) {", "if (false) {"],
        ['lecture : le placeholder compte comme une image', "const vide = !img || (cfg.placeholder && img.includes(cfg.placeholder));", "const vide = !img;"],
        ['entrée : la basse définition n\'est plus notée', "basseDefinition: Boolean(definition?.basseDefinition)", "basseDefinition: false"],
        ['entrée : la lecture est annoncée faite', "regle: 'a-lire', url: image.url", "regle: 'preuve-lue', url: image.url"],
        ['famille : le deuxième hôte ne compte pas', "hotes.get(e.idProduct).size >= 2", "false"],
        // 07/11 nuit : w-scx (grille par set, énumération par code) et w-srb (lignes par set)
        ['w-scx grille : la même carte lue par variante double les items', "if (vus.has(id)) continue;", "if (false) continue;"],
        ['w-scx grille : une carte d\'un autre set (id hors du code de l\'adresse) est gardée', "if (attendu && compacte(codeId) !== attendu) continue;", ""],
        ['w-scx grille : l\'image reste la vignette (pas de « large »)', "if (src && cfg.pleine) src = src.replace(cfg.pleine[0], cfg.pleine[1]);\n            sortie.push({ position: sortie.length + 1", "if (false) src = src.replace(cfg.pleine[0], cfg.pleine[1]);\n            sortie.push({ position: sortie.length + 1"],
        ['w-scx grille : une ancre sans numéro ni nom est une entrée', "if (!numero && !nom) continue;\n            let src = attributs(", "if (false) continue;\n            let src = attributs("],
        ['w-srb : le code lu sur la ligne ne compte plus (page d\'un autre set acceptée)', "i.codeSet == null || compacte(i.codeSet) === compacte(set.code)", "true"],
        ['w-srb : un second champ chiffré est pris pour un code, plus pour un total', "if (/^\\d+$/.test(tete[2])) total = tete[2]; else codeSet = tete[2];", "codeSet = tete[2];"],
        ['site : le plancher propre au site (255 px) est ignoré', "if (site.largeurMin && obj.w < site.largeurMin)", "if (false)"],
        ['image : une image Cardmarket d\'un hôte déclaré est téléchargée', "if (/cardmarket/i.test(h || '')) {", "if (false) {"],
        ['par code : le tirage du set n\'est pas contrôlé (un set id demandé au site jp)', "if (tiragesAdmis && !tiragesAdmis.includes(s.tirage)) {", "if (false) {"],
        ['par code : un code composite (S-P/TH) est demandé tel quel', "if (!CODE_SIMPLE.test(String(s.code ?? ''))) {", "if (false) {"]
    ] },
    { module: 'collecte-cartes/comblement.js', mutants: [
        ['gardes : --chasse hors des modes gardés', "'--ecrire', '--nuit', '--chasse']);", "'--ecrire', '--nuit']);"],
        ['grammaire : --chasse inconnu', "/^--nuit$/, /^--chasse$/,", "/^--nuit$/,"],
        ['grammaire : --limite admis avec n\'importe quel mode', "if (a('limite') && !['--plan', '--nuit'].includes(mode))", "if (false)"],
        ['grammaire : --plafond admis avec n\'importe quel mode', "if (a('plafond') && !['--telecharger', '--nuit', '--chasse'].includes(mode))", "if (false)"]
    ] }
];
let tues = 0, total = 0;
const survivants = [];
for (const G of GROUPES) {
    const fichier = path.join(__dirname, G.module);
    const original = fs.readFileSync(fichier, 'utf8');
    const texte = original.replace(/\r\n/g, '\n');                   // les motifs s'écrivent avec « \n » ; la restauration rend l'original octet pour octet
    try {
        for (const [nom, de, vers] of G.mutants) {
            total++;
            const n = texte.split(de).length - 1;
            if (n !== 1) { console.log(`❌ motif ${n === 0 ? 'introuvable' : `présent ${n} fois (une occurrence unique est exigée)`} pour « ${nom} » (${G.module})`); process.exitCode = 2; continue; }
            fs.writeFileSync(fichier, texte.replace(de, vers));
            // une SyntaxError n'est pas un « tué » : le module muté doit d'abord se compiler
            const syn = spawnSync(process.execPath, ['--check', fichier], { cwd: __dirname, encoding: 'utf8', timeout: 60000 });
            if (syn.status !== 0) { console.log(`❌ le mutant « ${nom} » ne compile pas : ${String(syn.stderr).split('\n').find(l => /Error/.test(l)) ?? ''}`); process.exitCode = 2; continue; }
            const r = spawnSync(process.execPath, [BANC], { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
            if (r.status !== 0) tues++; else survivants.push(`${G.module} : ${nom}`);
        }
    } finally { fs.writeFileSync(fichier, original); }
    if (fs.readFileSync(fichier, 'utf8') !== original) { console.error(`🔴 ${G.module} n'est PAS restauré`); process.exitCode = 3; }
}
console.log(`mutants : ${tues} tués sur ${total}${survivants.length ? ` · SURVIVANTS :\n   ${survivants.join('\n   ')}` : ''}`);
if (survivants.length && !process.exitCode) process.exitCode = 1;

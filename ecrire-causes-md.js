// ============================================================
// PHASE 3a, ÉTAPE 1 — écrit S8\PHASE3A\causes.md depuis causes.json (la sortie de classer-sans-ligne.js). Lecture/écriture de FICHIERS locaux seulement.
// ============================================================
//   node ecrire-causes-md.js --causes=<causes.json> --sortie=<causes.md>
const fs = require('fs');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CAUSES = arg('causes'), SORTIE = arg('sortie');
if (!CAUSES || !SORTIE) { console.error('usage : --causes= --sortie='); process.exit(2); }
const j = JSON.parse(fs.readFileSync(CAUSES, 'utf8'));
const FAM = ['occidental', 'japonais', 'chinois', 'asie-du-sud-est', 'inconnue'];
const cell = (o, a, b) => (o[a] && o[a][b]) || 0;
const somme = o => Object.values(o).reduce((t, x) => t + x, 0);
const out = [];
const w = s => out.push(s);

w(`# PHASE 3a, étape 1 — les ${j.denominateur} produits Cardmarket SANS LIGNE : cause et route, par expansion`);
w('');
w(`Mesure du ${j.le}, **aucune écriture en base**, aucune requête Cardmarket / Bulbapedia / PikaQian / Pokécardex. Lecture seule (utilisateurs Atlas de lecture), archive R2 relue en lecture d'objets, clone TCGdex local du 2026-09-25.`);
w(`Définition contrôlée : un produit est SANS_LIGNE s'il n'a aucune ligne \`cartes_produits\` — **3 263 sur 73 661 produits audités, 261 expansions** ; les 70 398 autres en ont une (les deux comptes sont recoupés par \`mesurer-sans-ligne.js\`, qui lève sinon).`);
w('');
w('## 1. Synthèse');
w('');
w('### Produits par route et par famille');
w('');
w(`| route | ${FAM.join(' | ')} | total |`);
w(`|---|${FAM.map(() => '---:').join('|')}|---:|`);
for (const r of ['ROUTE EXISTANTE', 'ROUTE À ÉCRIRE', 'À INSTRUIRE', 'PLANCHER', 'HORS ROUTE (décision)']) {
    const o = j.parRouteFamille[r] || {};
    w(`| ${r} | ${FAM.map(f => o[f] || 0).join(' | ')} | ${somme(o)} |`);
}
w(`| **total** | ${FAM.map(f => Object.values(j.parRouteFamille).reduce((t, o) => t + (o[f] || 0), 0)).join(' | ')} | ${j.denominateur} |`);
w('');
w('**PLANCHER : 0.** Le plancher se prouve par « aucune page chez AUCUNE source nommée » ; aucun produit n\'a été interrogé chez toutes les sources (Bulbapedia live, TCGdex data-asia, TPC Asie, pokemon-card.com ne l\'ont pas été ici). Un produit « sans carte de ce nom en base » est un trou de NOTRE base, pas un fait du monde.');
w('');
w('### Détail par voie (route · voie)');
w('');
const voies = {};
for (const p of j.produits) { const k = `${p.route} · ${p.voie}`; (voies[k] = voies[k] || { n: 0, f: {} }).n++; }
w('| route · voie | produits |');
w('|---|---:|');
for (const [k, v] of Object.entries(voies).sort((a, b) => b[1].n - a[1].n)) w(`| ${k} | ${v.n} |`);
w('');
w('@@LEGENDE@@');
w('');
w('### Produits par cause et par famille');
w('');
w(`| cause | définition (instrument) | ${FAM.join(' | ')} | total |`);
w(`|---|---|${FAM.map(() => '---:').join('|')}|---:|`);
for (const [k, o] of Object.entries(j.parCauseFamille).sort((a, b) => somme(b[1]) - somme(a[1]))) {
    const base = k.replace(/^NV-/, '');
    w(`| ${k} | ${(k.startsWith('NV-') ? '(produit neuf ≥ 917000) ' : '') + (j.definitions.causes[base] || '')} | ${FAM.map(f => o[f] || 0).join(' | ')} | ${somme(o)} |`);
}
w('');

w('## 2. Les expansions les plus grosses (37 premières, ' + j.expansions.slice().sort((a, b) => b.sansLigne - a.sansLigne).slice(0, 37).reduce((t, e) => t + e.sansLigne, 0) + ' produits)');
w('');
const tri = j.expansions.slice().sort((a, b) => b.sansLigne - a.sansLigne || a.exp - b.exp);
const top = tri.slice(0, 37), reste = tri.slice(37);
const sl = e => e.slugs[0] || '(aucun set)';
// libellés COURTS des voies (la légende est imprimée une fois, au §1)
const COURT = [
    [/^ROUTE EXISTANTE · rejeu/, 'EXIST/rejeu'], [/^ROUTE EXISTANTE · poser-par-metacarte.*CSVH6C/, 'EXIST/croisée(après ligne CSVH6C)'], [/^ROUTE EXISTANTE · poser-par-metacarte/, 'EXIST/croisée'],
    [/^ROUTE EXISTANTE · poser-fiches-par-freres/, 'EXIST/frères'], [/^ROUTE EXISTANTE · poser-wcd/, 'EXIST/wcd'],
    [/^ROUTE À ÉCRIRE · clé « Setlist »/, 'ÉCRIRE/clé-Setlist'], [/^ROUTE À ÉCRIRE · désignation croisée SANS/, 'ÉCRIRE/croisée-sans-clause'], [/^ROUTE À ÉCRIRE · clé « énergie/, 'ÉCRIRE/énergie-origine'],
    [/^ROUTE À ÉCRIRE · création du set Happy/, 'ÉCRIRE/Happy6'], [/^ROUTE À ÉCRIRE · fiche simple d'énergie/, 'ÉCRIRE/fiche-énergie'], [/^ROUTE À ÉCRIRE · fiche simple/, 'ÉCRIRE/fiche-simple'],
    [/^HORS ROUTE/, 'HORS/matière-spéciale'], [/^À INSTRUIRE · ligne de table non vérifiée/, 'INSTRUIRE/ligne-non-vérifiée'], [/^À INSTRUIRE · produit sans numéro/, 'INSTRUIRE/sans-numéro'],
    [/^À INSTRUIRE · expansion sans ligne/, 'INSTRUIRE/tirage-non-prouvé'], [/^À INSTRUIRE · tirage inconnu/, 'INSTRUIRE/expansion-non-apprise'], [/^À INSTRUIRE · aucune carte de ce nom/, 'INSTRUIRE/texte-absent'],
    [/^À INSTRUIRE · le numéro Cardmarket désigne/, 'INSTRUIRE/numéro-faux'], [/^À INSTRUIRE · la Setlist archivée/, 'INSTRUIRE/Setlist-à-relire'], [/^À INSTRUIRE/, 'INSTRUIRE/autre']
];
const court = s => { for (const [re, t] of COURT) if (re.test(s)) return t; return s.slice(0, 40); };
const resume = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${court(k)} ${v}`).join(' · ');
const resumeC = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
for (const e of top) {
    w(`### ${e.exp} · ${sl(e)} · ${e.famille}/${e.langue} · ${e.sansLigne} sans ligne sur ${e.total}`);
    w('');
    w(`- **présence en \`numeros_cartes\`** : ${e.numerosCartes.apprisPourLesSL}/${e.sansLigne} appris, ${e.numerosCartes.avecNumero} avec numéro · codes ${e.codes.join(', ') || '—'}`);
    w(`- **ligne de table** : ${e.tableDeLignes.join(' ; ') || 'AUCUNE (ni main, ni auto, ni sans page)'}`);
    w(`- **\`collecte_etat\`** : ${e.collecteEtat ? `phase ${e.collecteEtat.phase}, ${e.collecteEtat.nTitres} titres, ${e.collecteEtat.nPages} pages lues, ${e.collecteEtat.nManquants} manquantes (liens rouges)` : 'aucun document'}`);
    if (e.setlist) w(`- **Setlist relue sur R2** (rev ${e.setlist.revid}) : ${e.setlist.entrees} entrées, ${e.setlist.liensRouges} pages manquantes, numéro maximum ${e.setlist.maxNumero}${Object.keys(e.setlist.ignorees || {}).length ? ', entrées ignorées ' + JSON.stringify(e.setlist.ignorees) : ''}`);
    if (e.rejeu.length) w(`- **joindre() rejoué à blanc** : ${e.rejeu.map(r => `${r.code} ${r.cartes} cartes / ${r.produits} produits → ${r.joints} joints ; lignes nouvelles ${r.nouvellesLignes} (dont ${r.dontSansLigne} de ces produits) ; lignes écrites que le rejeu perdrait ${r.lignesPerdues}`).join(' ; ')}`);
    w(`- **CAUSE** (instrument lancé) : ${resumeC(e.causes)}`);
    w(`- **ROUTE** : ${resume(e.routes)}`);
    w(`- clés qui désignent (produits) : rejeu ${e.cles.rejeu} · Setlist ${e.cles.ks} · frères ${e.cles.freres} · croisée production ${e.cles.croise} · croisée sans clause (≥2 frères) ${e.cles.cst2} · nom+attaques seul ${e.cles.nomAtt} · TCGdex nomme le produit ${e.cles.tcgdex} · aucune carte de ce nom en base ${e.cles.memeNom0}`);
    w('');
}

w(`## 3. Le reste (${reste.length} expansions, ${reste.reduce((t, e) => t + e.sansLigne, 0)} produits), groupé par forme`);
w('');
const dom = e => Object.entries(e.causes).sort((a, b) => b[1] - a[1])[0][0];
const domR = e => Object.entries(e.routes).sort((a, b) => b[1] - a[1])[0][0];
const groupes = {};
for (const e of reste) { const k = `${dom(e)} → ${domR(e)}`; (groupes[k] = groupes[k] || []).push(e); }
for (const [k, es] of Object.entries(groupes).sort((a, b) => b[1].reduce((t, e) => t + e.sansLigne, 0) - a[1].reduce((t, e) => t + e.sansLigne, 0))) {
    const n = es.reduce((t, e) => t + e.sansLigne, 0);
    const [c] = k.split(' → ');
    w(`### ${k} — ${es.length} expansions, ${n} produits`);
    w('');
    w(`Cause : ${j.definitions.causes[c.replace(/^NV-/, '')] || c}.`);
    w('');
    w(es.map(e => `${e.exp} ${sl(e).slice(0, 34)} (${e.sansLigne}/${e.total}${e.numerosCartes.apprisPourLesSL < e.sansLigne ? ', ' + (e.sansLigne - e.numerosCartes.apprisPourLesSL) + ' non appris' : ''})`).join(' · '));
    w('');
}
// sections rédigées à la main (instruments lancés, forme à part, lots, limites), injectées : `--avant` juste avant le §2, `--apres` à la fin
const lire = f => f ? fs.readFileSync(f, 'utf8') : '';
const iDeux = out.findIndex(l => l.startsWith('## 2.'));
if (arg('avant') && iDeux >= 0) out.splice(iDeux, 0, lire(arg('avant')), '');
if (arg('apres')) out.push('', lire(arg('apres')));
const legende = 'Légende des voies abrégées (§2) : ' + COURT.slice(0, -1).map(([re, t]) => `\`${t}\``).join(' ') + ' — le sens complet est dans le tableau ci-dessus.';
fs.writeFileSync(SORTIE, out.join('\n').replace('@@LEGENDE@@', legende));
console.log(`écrit ${SORTIE} · ${out.length} lignes · ${top.length} grosses + ${reste.length} autres`);

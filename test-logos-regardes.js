// Banc PUR (aucune base, aucun réseau) de la promotion des 41 « À REGARDER » regardés à l'œil par le coordinateur le 2026-10-11.
//   node test-logos-regardes.js
const M = require('./collecter-logos-officiels');
const table = require('./collecte-cartes/logos-officiels-table.json');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const reg = table.lignes.filter(l => l.verdict === 'À REGARDER');
const ligne = code => reg.find(l => l.fichier.endsWith(`/${code}.png`));
// la base de lecture : tous les sets de la table en jp / intl ; nomJa posé seulement là où la base le porte (M4 et SV10, mesuré le 2026-10-11)
const sets = new Map();
for (const l of table.lignes) if (l.set) sets.set(l.set, { _id: l.set, tirage: l.cible === 'fr' ? 'intl' : 'jp', nomJa: null });
sets.get('Ninja-Spinner').nomJa = 'ニンジャスピナー';
sets.get('The-Glory-of-Team-Rocket').nomJa = 'ロケット団の栄光';
const plan = l => { const p = M.promouvoir(l, sets); return p.ligne ? M.planifier(p.ligne, sets) : { action: 'ecartee', raison: p.raison }; };

(async () => {
    verifier('la liste fermée existe : 37 entrées, toutes À REGARDER dans la table', [Array.isArray(M.REGARDES_2026_10_11), M.REGARDES_2026_10_11?.length, M.REGARDES_2026_10_11?.every(e => reg.some(l => l.part === e.part && l.fichier === e.fichier))], [true, 37, true]);
    verifier('chaque entrée porte planche, raison et le sha256 du candidat regardé', M.REGARDES_2026_10_11.every(e => [1, 2, 3].includes(e.planche) && e.raison && /^[0-9a-f]{64}$/.test(e.candidatSha256)), true);

    // 1. une ligne promue passe le verdict
    const a = M.promouvoir(ligne('ADV3'), sets);
    verifier('ADV3 : promue OFFICIEL', [a.ligne?.verdict, a.ligne?.regardePar], ['OFFICIEL', 'coordinateur 2026-10-11, planche 1']);
    verifier('ADV3 : planifier → collecter', plan(ligne('ADV3')).action, 'collecter');
    verifier('HeartGold (FR, TCGdex) : collecter', plan(reg[0]).action, 'collecter');

    // 2. une ligne non listée reste refusée
    const inconnue = { ...ligne('ADV3'), fichier: 'Logo JP/ZZZ9.png' };
    verifier('ligne À REGARDER non listée : jamais promue', M.promouvoir(inconnue, sets).ligne, undefined);
    verifier('ligne non listée : planifier refuse', M.planifier(inconnue, sets).action, 'refus');
    // la promotion ne s'applique qu'aux « À REGARDER » : une ligne d'un autre verdict n'est pas promue
    verifier('un REFUSÉ homonyme n\'est pas promu', M.promouvoir({ ...ligne('ADV3'), verdict: 'AUTRE' }, sets).ligne, undefined);
    // le candidat n'est plus celui qu'on a regardé → pas de promotion
    verifier('candidat différent de celui regardé (sha256) : pas promue', M.promouvoir({ ...ligne('ADV3'), cache: { ...ligne('ADV3').cache, sha256: 'f'.repeat(64) } }, sets).ligne, undefined);
    // le set de la ligne a changé → pas promue
    verifier('set différent de celui regardé : pas promue', M.promouvoir({ ...ligne('ADV3'), set: 'Autre-Set' }, sets).ligne, undefined);

    // 3. une hésitation reste refusée (OR4, SM11B, SV11W : couleur nettement différente) — et SM5P : set non identifié, rien à confirmer
    for (const c of ['OR4', 'SM11B', 'SV11W', 'SM5P']) verifier(`${c} : jamais promue`, [M.promouvoir(ligne(c), sets).ligne, plan(ligne(c)).action], [undefined, 'ecartee']);
    verifier('les hésitations sont nommées dans EXCLUS_2026_10_11', M.EXCLUS_2026_10_11.map(e => e.fichier.replace(/^Logo JP\//, '')).sort(), ['OR4.png', 'SM11B.png', 'SM5P.png', 'SV11W.png']);

    // 4. un set « ? » sans nomJa confirmé reste écarté ; avec nomJa ÉGAL (un seul set), il passe
    verifier('S10A (nomJa null en base) : écartée', plan(ligne('S10A')).action, 'ecartee');
    verifier('S10A : la raison dit nomJa', /nomJa/.test(plan(ligne('S10A')).raison), true);
    for (const c of ['S11A', 'S1A']) verifier(`${c} (nomJa null) : écartée`, plan(ligne(c)).action, 'ecartee');
    verifier('M4 (nomJa égal au texte du logo, un seul set) : collecter', plan(ligne('M4')).action, 'collecter');
    const deux = new Map(sets); deux.set('Ninja-Spinner-bis', { _id: 'Ninja-Spinner-bis', tirage: 'jp', nomJa: 'ニンジャスピナー' });
    verifier('M4 : deux sets portent le même nomJa → écartée', M.promouvoir(ligne('M4'), deux).ligne, undefined);
    const faux = new Map(sets); faux.set('Ninja-Spinner', { _id: 'Ninja-Spinner', tirage: 'jp', nomJa: 'ニンジャスピナー2' });
    verifier('M4 : nomJa différent (pas égal) → écartée', M.promouvoir(ligne('M4'), faux).ligne, undefined);
    const intl = new Map(sets); intl.set('Ninja-Spinner', { _id: 'Ninja-Spinner', tirage: 'intl', nomJa: 'ニンジャスピナー' });
    verifier('M4 : set de tirage intl → écartée (le tirage du set reste gardé)', plan2(ligne('M4'), intl), 'ecartee');
    function plan2(l, s) { const p = M.promouvoir(l, s); return p.ligne ? M.planifier(p.ligne, s).action : 'ecartee'; }

    // 5. Bulbapedia : promues mais REPORTÉES (jamais collectées maintenant)
    for (const c of ['NEO4', 'SM8', 'SV6A', 'SV10']) verifier(`${c} (Bulbapedia) : reportée`, plan(ligne(c)).action, 'reportee');
    verifier('SM6B (Bulbapedia, nomJa null) : écartée ou reportée, jamais collectée', ['ecartee', 'reportee'].includes(plan(ligne('SM6B')).action), true);

    // 6. la promotion ne lève AUCUNE autre garde
    verifier('URL non écrite sur la ligne : refus', plan2b({ ...ligne('ADV3'), urlChoisie: 'https://billsarchive.com/autre.webp' }), 'refus');
    verifier('hôte hors liste : refus', plan2b({ ...ligne('ADV3'), urls: ['https://exemple.org/x.webp'], urlChoisie: 'https://exemple.org/x.webp' }), 'refus');
    verifier('langue non prouvée par l\'adresse : écartée', plan2b({ ...ligne('ADV3'), urls: ['https://billsarchive.com/assets/logos/japanese/sans-prefixe.webp'], urlChoisie: 'https://billsarchive.com/assets/logos/japanese/sans-prefixe.webp' }), 'ecartee');
    verifier('set de tirage intl pour un logo ja : écartée', M.planifier(M.promouvoir(ligne('ADV3'), sets).ligne, new Map([...sets, ['Rulers-of-the-Heavens', { _id: 'Rulers-of-the-Heavens', tirage: 'intl' }]])).action, 'ecartee');
    function plan2b(l) { const p = M.promouvoir(l, sets); return p.ligne ? M.planifier(p.ligne, sets).action : 'non-promue'; }
    verifier('(note) une URL modifiée garde le candidat regardé : la ligne promue la refuse', plan2b({ ...ligne('ADV3'), urlChoisie: 'https://billsarchive.com/autre.webp' }) !== 'collecter', true);
    // le juge de fichier est inchangé : un fichier différent sans Pokécardex lisible ne passe pas
    const sharp = require('sharp');
    const buf = await sharp({ create: { width: 300, height: 80, channels: 4, background: '#fff' } }).png().toBuffer();
    const pj = M.promouvoir(ligne('ADV3'), sets).ligne;
    const j = await M.juger(pj, buf, { pokecardexBuf: null });
    verifier('juger : fichier différent du comparé, sans re-mesure possible : refus', j.ok, false);

    // 7. la table entière : combien se collectent, combien se reportent
    const tous = table.lignes.filter(l => l.verdict === 'À REGARDER').map(l => plan(l));
    const compte = {}; tous.forEach(p => compte[p.action] = (compte[p.action] || 0) + 1);
    verifier('les 41 À REGARDER : 29 collecter · 4 reportée · 8 écartée', compte, { collecter: 29, reportee: 4, ecartee: 8 });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();

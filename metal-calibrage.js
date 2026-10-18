// METAL — calibrage du détecteur sur des vignettes RÉELLES (lecture seule) : la paire fondatrice 580162 (métal) / 576772 (normale), et 20 paires normales connues (les paires Staff/Normale de STAFF-DETECT :
// deux produits de la même carte, même cadre, seule l'étiquette change — le détecteur doit dire « normal » pour les deux côtés et ne rien proposer).
// node metal-calibrage.js
'use strict';
const fs = require('fs');
const D = require('./collecte-cartes/metal-detect');
const { indexerDisque } = require('./collecte-cartes/staff-detect-io');
const { lireImage } = require('./metal-reperage');

(async () => {
    const disque = indexerDisque();
    const emp = async id => D.empreinte(await lireImage(disque.get(id)));
    const metal = await emp(580162), normale = await emp(576772);
    const v = D.verdictMatiere(metal, [normale]);
    console.log('580162 (métal) contre 576772 :', JSON.stringify(v), 'bordure', JSON.stringify({ V: +metal.borderV.toFixed(2), S: +metal.borderS.toFixed(2), H: Math.round(metal.borderH) }));
    console.log('576772 (normale) contre 580162 :', JSON.stringify(D.verdictMatiere(normale, [metal])));
    const verdicts = JSON.parse(fs.readFileSync('C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\STAFF-DETECT\\verdicts-64-paires.json', 'utf8'));
    const paires = (verdicts.verdicts || verdicts).filter(p => Number.isInteger(p.idV1) && Number.isInteger(p.idV2) && disque.get(p.idV1) && disque.get(p.idV2)).slice(0, 20);
    let faux = 0, douteux = 0, lues = 0;
    for (const p of paires) {
        const a = await emp(p.idV1), b = await emp(p.idV2);
        for (const [x, y] of [[a, b], [b, a]]) { lues++; const r = D.verdictMatiere(x, [y]); if (r.verdict === 'metal' || r.verdict === 'autre-matiere') { faux++; console.log('  propose', r.verdict, 'pour la paire', p.idV1, p.idV2); } else if (r.verdict === 'douteux') douteux++; }
    }
    console.log(`paires normales connues : ${paires.length} paires, ${lues} produits jugés, ${faux} proposés « metal » ou « autre-matiere » à tort (attendu 0), ${douteux} « douteux » sans frère clair (score 0 : jamais dessinés en planche)`);
    process.exit(v.verdict === 'metal' && faux === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

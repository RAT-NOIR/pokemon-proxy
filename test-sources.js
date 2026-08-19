// ============================================================
// TESTS — « rien trouvé » et « pas pu chercher » sont deux états
// ============================================================
// CE QU'IL VÉRIFIE, ET QUI NE SE DÉDUIT PAS DU CODE :
//   1. `interrogerSource` rend bien DEUX états, et retient le NOM de la source tombée ;
//   2. le contexte est propre à un scan — deux scans concurrents ne se contaminent pas
//      (c'est la raison d'être de l'AsyncLocalStorage, et un compteur de module aurait
//      passé toutes les autres assertions) ;
//   3. la CLAUSE 3 se déclenche : un refus d'absence prononcé alors qu'une source est
//      tombée sort en 'echec-technique', pas en 'refus-delibere' ;
//   4. et qu'elle ne se déclenche PAS ailleurs : hors panne, et sur les motifs qui
//      n'affirment aucune absence.
//
// ⚠️ `champsDeRefus` VIENT D'index.js, JAMAIS RECOPIÉE. C'est la fonction que les cinq
// sorties de la route appellent ; en réécrire une ici ne testerait que la copie. C'est
// l'erreur qui a tué la production le 4 août.
//
// USAGE : node test-sources.js   (aucun réseau ; index.js ouvre sa connexion Mongo au
//         chargement, comme pour toutes les suites qui l'importent)
const { interrogerSource, dansUnScan, sourcesTombees, pannesHorsContexte } = require('./sources');
const { champsDeRefus, REFUS_D_ABSENCE } = require('./index');

let echecs = 0;
function verifier(libelle, obtenu, attendu) {
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) { echecs++; console.log(`  ❌ ${libelle} : obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`); }
    else console.log(`  ✅ ${libelle}`);
}

const tombe = () => { throw new Error('connexion perdue (simulée)'); };

(async () => {
    console.log('--- 1. DEUX ÉTATS, JAMAIS UN ---');
    await dansUnScan(async () => {
        const bon = await interrogerSource('catalogue/nom', async () => [{ idProduct: 1 }]);
        verifier('source qui répond -> panne false', bon.panne, false);
        verifier('  ... et sa liste passe telle quelle', bon.liste.length, 1);
        verifier('  ... rien de retenu', sourcesTombees(), []);

        const vide = await interrogerSource('catalogue/nom', async () => []);
        verifier('source qui répond RIEN -> panne false', vide.panne, false);
        verifier('  ... une absence RÉELLE ne compte pas comme panne', sourcesTombees(), []);

        const ko = await interrogerSource('catalogue/numero-partout', tombe);
        verifier('source qui lève -> panne true', ko.panne, true);
        verifier('  ... liste vide quand même (l\'aval ne casse pas)', ko.liste, []);
        verifier('  ... et le NOM est retenu', sourcesTombees(), ['catalogue/numero-partout']);

        await interrogerSource('catalogue/numero-partout', tombe);
        verifier('deux fois la même source -> un seul nom', sourcesTombees(), ['catalogue/numero-partout']);
        await interrogerSource('tcgdex/expansions', tombe);
        verifier('une seconde source -> deux noms', sourcesTombees().length, 2);
    });

    console.log('\n--- 2. UN CONTEXTE PAR SCAN — deux scans ne se contaminent pas ---');
    // ⚠️ L'ASSERTION QUI JUSTIFIE L'AsyncLocalStorage. Un compteur de module aurait passé
    // tout le reste et échoué ici : les deux scans s'entrelacent sur leurs `await`, comme
    // deux requêtes concurrentes sur Render.
    {
        let vuA = null, vuB = null;
        const a = dansUnScan(async () => {
            await interrogerSource('catalogue/nom', tombe);
            await new Promise(r => setTimeout(r, 20));   // laisse B s'exécuter au milieu
            vuA = sourcesTombees();
        });
        const b = dansUnScan(async () => {
            await new Promise(r => setTimeout(r, 5));
            vuB = sourcesTombees();
        });
        await Promise.all([a, b]);
        verifier('le scan qui a subi la panne la voit', vuA, ['catalogue/nom']);
        verifier('le scan concurrent ne la voit PAS', vuB, []);
    }
    verifier('hors de tout scan, rien à mesurer', sourcesTombees(), []);

    console.log('\n--- 2 bis. UNE PANNE HORS CONTEXTE EST BRUYANTE ---');
    // ⚠️ L'ASSERTION QUI MANQUAIT. Les autres testent toutes le cas où le store EXISTE.
    // Aucune ne testait son absence — or c'est là que `getStore()?.add()` avalait la
    // panne en silence, réintroduisant le défaut que ce module ferme.
    {
        const avant = pannesHorsContexte();
        const cris = [];
        const vrai = console.error;
        console.error = (...a) => { cris.push(a.join(' ')); };
        const r = await interrogerSource('catalogue/nom', tombe);   // hors de tout dansUnScan
        console.error = vrai;
        verifier('l\'appelant n\'est PAS trompé : panne remontée quand même', r.panne, true);
        verifier('et il sait qu\'elle n\'a pas été retenue', r.horsContexte, true);
        verifier('le compteur de pannes hors contexte monte', pannesHorsContexte() - avant, 1);
        verifier('un cri DISTINCT est émis', cris.some(l => l.includes('[panne-hors-contexte]')), true);
        verifier('  ... en plus du cri ordinaire', cris.some(l => l.includes('[source-injoignable]')), true);
        // Et le contraire : dans un contexte, aucun cri « hors contexte ».
        const cris2 = [];
        console.error = (...a) => { cris2.push(a.join(' ')); };
        const dedans = await dansUnScan(async () => interrogerSource('catalogue/nom', tombe));
        console.error = vrai;
        verifier('dans un contexte, aucun cri « hors contexte »',
            cris2.some(l => l.includes('[panne-hors-contexte]')), false);
        verifier('  ... et horsContexte vaut false', dedans.horsContexte, false);
        verifier('  ... et le compteur ne bouge plus', pannesHorsContexte() - avant, 1);
    }

    console.log('\n--- 3. LA CLAUSE 3 — un refus d\'absence non constatée ---');
    verifier('les motifs d\'absence sont bien deux', [...REFUS_D_ABSENCE].sort(),
        ['aucun-candidat', 'carte-introuvable']);
    await dansUnScan(async () => {
        verifier('sans panne, « carte-introuvable » reste un refus délibéré',
            champsDeRefus('carte-introuvable', true).natureRefus, 'refus-delibere');
        await interrogerSource('catalogue/nom', tombe);
        const r = champsDeRefus('carte-introuvable', true);
        verifier('AVEC panne, il devient un échec technique', r.natureRefus, 'echec-technique');
        verifier('  ... mais le MOTIF ne bouge pas', r.motifRefus, 'carte-introuvable');
        verifier('  ... et `rembourse` garde sa valeur réelle', r.rembourse, true);
        verifier('« aucun-candidat » est requalifié aussi',
            champsDeRefus('aucun-candidat', true).natureRefus, 'echec-technique');
    });

    console.log('\n--- 4. ET NULLE PART AILLEURS ---');
    await dansUnScan(async () => {
        await interrogerSource('catalogue/nom', tombe);
        // Une égalité parfaite AFFIRME qu'on a trouvé plusieurs candidats : une panne
        // ailleurs ne la rend pas fausse. La requalifier diluerait le seul motif dont la
        // mesure est propre.
        verifier('« egalite-parfaite » n\'est PAS requalifié',
            champsDeRefus('egalite-parfaite', true).natureRefus, 'refus-delibere');
        verifier('« numero-illisible » non plus',
            champsDeRefus('numero-illisible', true).natureRefus, 'refus-delibere');
        verifier('un motif déjà technique le reste',
            champsDeRefus('tcgdex-injoignable', true).natureRefus, 'echec-technique');
    });

    console.log(`\n${echecs === 0 ? '✅ tout passe' : `❌ ${echecs} échec(s)`}`);
    process.exit(echecs === 0 ? 0 : 1);
})().catch(e => { console.error(e.stack); process.exit(1); });

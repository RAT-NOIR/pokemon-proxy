// ============================================================
// LA COLLECTE MASSIVE DU TEXTE — les lignes automatiques de la table, PAR BLOCS DE VINGT
// ============================================================
//   node collecte-massive.js [--bloc=20] [--blocs=N]
//
// Pour chaque bloc, dans l'ordre de table-sets-auto.json (japonais d'abord, le plus de produits d'abord) :
//   1. VÉRIFICATION du bloc s'il en reste à vérifier (`verifier-table.js --auto`, 2 requêtes) ;
//   2. TEXTE de chaque ligne admise et pas encore collectée : `collecteur-texte.js --set=CODE --attendre`,
//      un processus par set (un plantage ne tue pas la suite), un journal par set ;
//   3. un POINT toutes les cinq collectes, et un bilan par bloc, dans le journal de la collecte.
// Arrêts : SIGINT/SIGTERM (le set en cours finit) ; TROIS ÉCHECS CONSÉCUTIFS — une série d'échecs n'est
// pas une suite de sets malchanceux, c'est une source en panne (Bulbapedia a répondu 503 à tout le monde
// le 2026-09-14) : continuer ne ferait que brûler la table.
// Les IMAGES ne sont PAS lancées ici : les sets japonais attendent leur table set → artofpkm, les
// occidentaux l'endroit où tournera collecteur-images-bulba.js. Le journal les liste « en attente ».
//
// Débit et verrous : ceux de collecteur-texte.js (bulbapedia/__collecteur__, 1 requête / 5 s).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const TAILLE = Number(arg('bloc') || 20);
const MAX_BLOCS = Number(arg('blocs') || Infinity);
const DOSSIER = path.join(__dirname, 'collecte-cartes', 'rapports', 'massive');
fs.mkdirSync(DOSSIER, { recursive: true });
const JOURNAL = path.join(DOSSIER, `collecte-massive-${new Date().toISOString().slice(0, 10)}.log`);
const dire = s => { const l = `${new Date().toISOString().slice(0, 19)}Z ${s}`; console.log(l); fs.appendFileSync(JOURNAL, l + '\n'); };

let arretDemande = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dire(`⏹️  ${sig} : le set en cours finit, puis arrêt.`); arretDemande = true; });

const lireTable = () => { delete require.cache[require.resolve('./collecte-cartes/table-sets')]; return require('./collecte-cartes/table-sets'); };
const lancer = (args, fichier) => {
    const fd = fs.openSync(fichier, 'a');
    try { return spawnSync(process.execPath, args, { cwd: __dirname, stdio: ['ignore', fd, fd] }).status; } finally { fs.closeSync(fd); }
};

(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const etatDe = slug => cx.db.collection('collecte_etat').findOne({ _id: slug }, { projection: { phase: 1 } });
    const setDe = slug => cx.db.collection('sets').findOne({ _id: slug }, { projection: { complet: 1 } });

    let collectes = 0, echecsSuite = 0, blocs = 0;
    const bilanTotal = { ok: 0, nonConcordant: 0, echec: 0, dejaFait: 0 };
    dire(`══ COLLECTE MASSIVE — blocs de ${TAILLE}, journal ${path.relative(__dirname, JOURNAL)} ══`);
    while (!arretDemande && blocs < MAX_BLOCS) {
        let { TABLE_AUTO } = lireTable();
        const reste = TABLE_AUTO.filter(l => !l.collecte);
        if (!reste.length) { dire('toutes les lignes automatiques sont traitées.'); break; }
        // 1. vérifier les lignes du prochain bloc qui ne l'ont pas été
        const prochain = TABLE_AUTO.filter(l => !l.verif).slice(0, TAILLE);
        if (prochain.length) {
            const st = lancer(['collecte-cartes/verifier-table.js', '--auto', `--bloc=${TAILLE}`], path.join(DOSSIER, `verification.log`));
            if (st !== 0) { echecsSuite++; dire(`❌ vérification du bloc en échec (code ${st}) — ${echecsSuite} échec(s) de suite`); if (echecsSuite >= 3) break; await new Promise(r => setTimeout(r, 10 * 60 * 1000)); continue; }
            ({ TABLE_AUTO } = lireTable());
        }
        const bloc = TABLE_AUTO.filter(l => l.verif && !l.collecte).slice(0, TAILLE);
        blocs++;
        const b = { ok: 0, nonConcordant: 0, echec: 0, aRegarder: 0, dejaFait: 0, imagesEnAttente: { jp: 0, intl: 0 } };
        dire(`── bloc ${blocs} : ${bloc.length} lignes (${bloc.filter(l => l.verifie).length} admises, ${bloc.filter(l => !l.verifie).length} à regarder) ──`);
        for (const l of bloc) {
            if (arretDemande) break;
            if (!l.verifie) { b.aRegarder++; l.collecte = { le: new Date().toISOString(), etat: 'a-regarder', raisons: l.verif.raisons }; continue; }
            const e0 = await etatDe(l.slugSet);
            let etat;
            if (e0?.phase === 'verifie') { etat = 'deja-fait'; b.dejaFait++; }
            else {
                const st = lancer(['collecteur-texte.js', `--set=${l.code}`, '--attendre'], path.join(DOSSIER, `texte-${l.code.replace(/[^A-Za-z0-9.-]/g, '_')}.log`));
                const e1 = await etatDe(l.slugSet);
                const s1 = await setDe(l.slugSet);
                const concorde = s1?.complet?.concordance ?? s1?.complet?.concordant ?? null;
                if (st === 0 && e1?.phase === 'verifie') { etat = concorde === false ? 'non-concordant' : 'ok'; etat === 'ok' ? b.ok++ : b.nonConcordant++; echecsSuite = 0; }
                else { etat = `echec-${st}-${e1?.phase ?? 'sans-etat'}`; b.echec++; echecsSuite++; }
                collectes++;
                dire(`   ${l.code.padEnd(10)} ${etat.padEnd(16)} ${String(l.attendu).padStart(4)} produits · ${l.bulba.tirage} · « ${l.bulba.titre} »`);
            }
            l.collecte = { le: new Date().toISOString(), etat };
            b.imagesEnAttente[l.bulba.tirage === 'intl' ? 'intl' : 'jp']++;
            // Le fichier est relu à chaque tour : on n'écrit que CE champ, ligne par ligne, depuis la relecture.
            const frais = lireTable().TABLE_AUTO;
            const cible = frais.find(x => x.code === l.code);
            if (cible) { cible.collecte = l.collecte; fs.writeFileSync(lireTable().FICHIER_AUTO, JSON.stringify(frais, null, 1)); }
            if (collectes && collectes % 5 === 0 && etat !== 'deja-fait') dire(`📍 POINT après ${collectes} collectes : bloc ${blocs} — ${JSON.stringify(b)}`);
            if (echecsSuite >= 3) { dire(`⛔ TROIS ÉCHECS DE SUITE — arrêt : une source en panne ne se contourne pas en brûlant la table.`); break; }
        }
        for (const k of ['ok', 'nonConcordant', 'echec', 'dejaFait']) bilanTotal[k] += b[k];
        dire(`══ BILAN bloc ${blocs} : ${JSON.stringify(b)} · cumul ${JSON.stringify(bilanTotal)} ══`);
        if (echecsSuite >= 3) break;
    }
    await fermer();
    process.exit(echecsSuite >= 3 ? 1 : 0);
})().catch(e => { dire(`❌ ERREUR ${e.stack || e}`); process.exit(2); });

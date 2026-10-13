'use strict';
// MOYENS-B2a tour 1 (I-4) — l'OUTIL en ligne de commande de la réparation (`v2/argent/reparer-debit.js`), à côté de `reconcilier.js` (même garde de connexion).
// Il ne tourne ICI que sur la base en mémoire du banc (jamais la production). SIMULATION par défaut ; `--executer` écrit, après une sauvegarde LOCALE du débit et des mouvements du scan.
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawnSync } = require('child_process'); const { ObjectId } = require('mongoose').Types;
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger');
const { inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
(async () => {
    const prefixe = await H.ouvrirBac('test-argent-reparer-outil.js'); await M.creerIndex();
    const cli = path.join(__dirname, '..', 'argent', 'reparer-debit.js');
    const lance = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
    const base = [`--base=test_scratch`, `--prefixe=${prefixe}`];
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'reparer-banc-'));
    const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
    const scanId = new ObjectId(); await Lg.debiter(p, { scanId, cleIdempotence: 'k-outil', maintenant: t }, cfg);
    await db.col('mouvements').updateOne({ scanId, type: 'debit' }, { $set: { etat: 'rembourse' } });                // l'ancien état : « rembourse », ni crédit ni trace
    const args = [...base, `--porteur=installation:${p.id}`, `--scan=${scanId}`];
    const etat = async () => [(await lire(p)).essais, await db.col('mouvements').countDocuments({ scanId, type: 'remboursement', delta: 1 })];

    // 1. SIMULATION par défaut : imprime la preuve et le verdict, n'écrit RIEN
    const r1 = lance(...args);
    H.v('1. simulation (défaut) : code 0, « SIMULATION », verdict « reparable », écart 0, débit et mouvements du scan imprimés', [r1.status, /SIMULATION/.test(r1.stdout), /reparable/.test(r1.stdout), /écart de poche \(témoin\) : 0/.test(r1.stdout), /rembourse/.test(r1.stdout)], [0, true, true, true, true]);
    H.v('   (N-10) l\'outil dit son délai effectif, et la preuve lit le DÉBIT (crédit absent de la poche, trace absente)', [/délai d'attente effectif : 15 min/.test(r1.stdout), /crédit de CE débit ABSENT de la poche, trace absente/.test(r1.stdout)], [true, true]);
    H.v('   rien n\'est écrit : essais 2, aucun mouvement +1, aucun fichier de sauvegarde', [await etat(), fs.readdirSync(dossier).length], [[2, 0], 0]);
    // 2. --executer exige un dossier de sauvegarde NOMMÉ
    const r2 = lance(...args, '--executer');
    H.v('2. --executer sans --sauvegarde=<dossier> : refusé (code 2), rien d\'écrit', [r2.status, /--sauvegarde/.test(r2.stderr + r2.stdout), await etat()], [2, true, [2, 0]]);
    // 3. --executer : sauvegarde d'abord, réparation une fois, réconciliation avant/après, une ligne de journal
    const r3 = lance(...args, '--executer', `--sauvegarde=${dossier}`);
    const fichiers = fs.readdirSync(dossier); const sauv = fichiers.find(f => f.startsWith('sauvegarde-')); const journal = fichiers.find(f => f === 'journal-reparations.jsonl');
    const contenu = sauv ? JSON.parse(fs.readFileSync(path.join(dossier, sauv), 'utf8')) : null;
    H.v('3. --executer : code 0, essais 3, UN mouvement +1', [r3.status, await etat()], [0, [3, 1]]);
    H.v('   sauvegarde LOCALE du débit et des mouvements du scan (fichier), une ligne de journal', [Boolean(sauv), contenu && contenu.debits.length, contenu && Array.isArray(contenu.mouvements), Boolean(journal) && fs.readFileSync(path.join(dossier, journal), 'utf8').trim().split('\n').length], [true, 1, true, 1]);
    H.v('   la réconciliation est imprimée AVANT (non propre) et APRÈS (propre)', [/avant.*propre : non/is.test(r3.stdout), /après.*propre : oui/is.test(r3.stdout)], [true, true]);
    // N-4 : la sauvegarde est écrite AVANT l'écriture (aucune ligne `rp|` dedans, solde d'AVANT) et porte le solde du porteur
    H.v('   (N-4) la sauvegarde est celle d\'AVANT : aucun mouvement `rp|…`, 1 mouvement de débit, solde du porteur 2 essais (avant la réparation), clé `marque` présente',
        [contenu && !contenu.mouvements.some(m => /^rp\|/.test(m.cleIdempotence || '')), contenu && contenu.mouvements.length, contenu && contenu.porteurDoc && contenu.porteurDoc.essais, contenu && 'marque' in contenu], [true, 1, 2, true]);
    // 4. second passage : ne fait rien, n'écrit ni sauvegarde ni journal
    const r4 = lance(...args, '--executer', `--sauvegarde=${dossier}`);
    H.v('4. second passage : code 3 (refus : rien-a-reparer), essais 3, un seul mouvement, aucun fichier de plus', [r4.status, /rien-a-reparer/.test(r4.stdout + r4.stderr), await etat(), fs.readdirSync(dossier).length], [3, true, [3, 1], 2]);
    // 5. la production et les bases inconnues sont refusées AVANT toute connexion / avant toute opération
    const r5 = lance('--base=test', `--porteur=installation:${p.id}`, `--scan=${scanId}`, '--executer', `--sauvegarde=${dossier}`);
    H.v('5. --base=test (production) sans --confirmer-production : refusé, code 1, aucune base ouverte', [r5.status, /confirmer-production/.test(r5.stderr + r5.stdout), /Base :/.test(r5.stdout)], [1, true, false]);
    const r6 = lance('--base=inconnue', `--porteur=installation:${p.id}`, `--scan=${scanId}`);
    H.v('   une base inconnue : refusée (code 1)', [r6.status, /ne sais pas/.test(r6.stderr)], [1, true]);
    // 6. entrées invalides : refus clair, avant toute connexion
    const r7 = lance(...base, `--porteur=installation:${p.id}`, '--scan=zzz');
    H.v('6. scanId invalide (texte non ObjectId) : refus clair, code 2', [r7.status, /scan/i.test(r7.stderr)], [2, true]);
    const r8 = lance(...base, '--porteur=compte:pas-un-id', `--scan=${scanId}`);
    H.v('   porteur invalide : refus clair, code 2', [r8.status, /porteur/i.test(r8.stderr)], [2, true]);
    // N-2 : un porteur inexistant est un refus propre (code 3, « porteur-introuvable »), pas un TypeError
    const r9 = lance(...base, `--porteur=installation:${'0'.repeat(32)}`, `--scan=${scanId}`);
    H.v('7. (N-2) porteur inexistant : code 3, « porteur-introuvable », aucune trace de TypeError', [r9.status, /porteur-introuvable/.test(r9.stdout), /TypeError/.test(r9.stdout + r9.stderr)], [3, true, false]);
    // N-3 : un refus APRÈS la prise de la marque peut avoir écrit le crédit — le texte ne dit pas « rien d'écrit »
    const { texteDeRefus } = require('../argent/reparer-debit');
    const tt = texteDeRefus({ raison: 'trace-non-ecrite', creditRendu: true }, 15, 'journal.jsonl'), te = texteDeRefus({ raison: 'erreur-apres-prise', creditRendu: false }, 15, 'journal.jsonl'), tr = texteDeRefus({ raison: 'rien-a-reparer' }, 15, 'j');
    H.v('8. (N-3) `trace-non-ecrite` : « le crédit A ÉTÉ écrit », `erreur-apres-prise` : « a PEUT-ÊTRE été écrit », jamais « rien n\'a été écrit » ; un refus avant la prise : « rien n\'a été écrit »',
        [/A ÉTÉ écrit/.test(tt) && !/rien n'a été écrit/.test(tt), /PEUT-ÊTRE/.test(te) && !/rien n'a été écrit/.test(te), /rien n'a été écrit/.test(tr)], [true, true, true]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

// BANC — le mongod en mémoire d'un banc efface son dossier à la fin, même en cas d'échec (collecte-cartes/base-banc.js, lot BANC-NET).
// Décision du testeur (2026-10-13) : « chaque test qui lance un mongod en mémoire efface son dossier à la fin, même en cas d'échec, et un test le vérifie. »
//   node test-banc-nettoyage.js      (lance de VRAIS mongod, un à la fois : ~0,2 Go d'écriture chacun, dans un dossier temporaire PRIVÉ de ce banc)
//
// 🔑 TOUT ce que ce banc fabrique vit sous UNE racine privée (os.tmpdir()/rat-banc-test-<aléa>) : les enfants reçoivent TEMP/TMP = cette racine, donc
// os.tmpdir() y pointe pour eux et mongodb-memory-server y crée ses dossiers. Aucun dossier d'un autre agent n'est vu, donc aucun ne peut être effacé.
// Le banc n'efface QUE cette racine, à la fin, après avoir retiré chaque jonction qu'il a fabriquée par `cmd /c rmdir` (non récursif).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RACINE_DEPOT = __dirname;
const BASE_BANC = path.join(RACINE_DEPOT, 'collecte-cartes', 'base-banc.js');
const NODE_PATH_DEFAUT = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\node_modules';   // les modules du dépôt, sans jonction (brief du lot)

let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const pause = ms => new Promise(r => setTimeout(r, ms));
async function attendre(condition, ms = 8000) {
    const fin = Date.now() + ms;
    for (; ;) { if (condition()) return true; if (Date.now() > fin) return false; await pause(100); }
}

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-banc-test-'));
const TMP_ENFANTS = path.join(RACINE, 'tmp');            // le os.tmpdir() des enfants
const SCRIPTS = path.join(RACINE, 'scripts');            // les petits scripts enfants
fs.mkdirSync(TMP_ENFANTS); fs.mkdirSync(SCRIPTS);
const jonctions = [];                                    // chaque jonction fabriquée ici, retirée à la fin par rmdir non récursif

const envEnfant = () => {
    const e = { ...process.env, TEMP: TMP_ENFANTS, TMP: TMP_ENFANTS };
    if (!e.NODE_PATH) e.NODE_PATH = NODE_PATH_DEFAUT;
    return e;
};
const contenuTmp = () => fs.readdirSync(TMP_ENFANTS);

// ── un enfant : ouvre un vrai banc, imprime le dossier créé (le seul nouveau sous son tmp), puis fait l'ACTION.
const ACTIONS = {
    arreter: `await banc.arreter();`,
    exception: `setTimeout(() => { throw new Error('exception voulue'); }, 50); await new Promise(() => { });`,
    rejet: `Promise.reject(new Error('rejet voulu')); await new Promise(() => { });`,
    exit: `process.exit(3);`,
    fin: ``,                                              // fin naturelle de la boucle d'événements, sans arreter()
    attendre: `await new Promise(() => { });`           // pour être tué
};
function ecrireEnfant(nom, action) {
    const f = path.join(SCRIPTS, `${nom}.js`);
    fs.writeFileSync(f, `const fs = require('fs'), os = require('os');
const { ouvrirBanc } = require(${JSON.stringify(BASE_BANC)});
(async () => {
    const avant = new Set(fs.readdirSync(os.tmpdir()));
    const banc = await ouvrirBanc();
    const neufs = fs.readdirSync(os.tmpdir()).filter(n => !avant.has(n) && /^(mongo-mem-|rat-banc-mongod-)/.test(n));
    console.log('DOSSIER ' + (neufs.length === 1 ? os.tmpdir() + require('path').sep + neufs[0] : 'AMBIGU:' + neufs.join('|')));
    console.log('EXISTE ' + (neufs.length === 1 && fs.existsSync(os.tmpdir() + require('path').sep + neufs[0])));
    ${action}
})();
`);
    return f;
}
function lancer(script) {
    const c = spawn(process.execPath, [script], { env: envEnfant(), stdio: ['ignore', 'pipe', 'pipe'] });
    const r = { sortie: '', erreur: '', code: null, fini: false, enfant: c };
    c.stdout.on('data', d => { r.sortie += d; });
    c.stderr.on('data', d => { r.erreur += d; });
    c.on('exit', code => { r.code = code; r.fini = true; });
    return r;
}
const dossierDe = r => { const m = /^DOSSIER (.+)$/m.exec(r.sortie); return m && !m[1].startsWith('AMBIGU') ? m[1].trim() : null; };
const libreC = () => { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-PSDrive C).Free'], { encoding: 'utf8' }); return Number(String(r.stdout).trim()) / 2 ** 30; };

async function cas(nom, action, { codeAttendu, tuer = false }) {
    console.log(`\n── cas ${nom}`);
    const libre = libreC();
    if (libre < 20) { console.log(`  🛑 ARRÊT : ${libre.toFixed(1)} Go libres sur C: (< 20 Go)`); ko++; throw new Error('espace disque insuffisant'); }
    const r = lancer(ecrireEnfant(nom, action));
    const vu = await attendre(() => /EXISTE/.test(r.sortie) || r.fini, 90000);
    const dossier = dossierDe(r);
    verifier(`${nom} : l'enfant a ouvert un banc et dit son dossier`, [vu, dossier !== null, /EXISTE true/.test(r.sortie)], [true, true, true]);
    if (tuer) {
        const meurt = new Promise(res => r.enfant.once('exit', res));
        r.enfant.kill();   // TerminateProcess : aucun code de l'enfant ne s'exécute
        await meurt;
        verifier(`${nom} : l'enfant est mort sans rien exécuter, son dossier est ENCORE là (arrêt brutal)`, dossier ? fs.existsSync(dossier) : null, true);
        return { r, dossier };
    }
    const fini = await attendre(() => r.fini, 60000);
    if (!fini) { try { r.enfant.kill(); } catch (_) { } }
    verifier(`${nom} : l'enfant se termine`, fini, true);
    verifier(`${nom} : son code de sortie est celui du banc`, r.code, codeAttendu);
    const parti = dossier ? await attendre(() => !fs.existsSync(dossier), 8000) : false;
    verifier(`${nom} : le dossier de données n'existe plus`, [parti, dossier ? fs.existsSync(dossier) : null], [true, false]);
    if (!parti && r.erreur) console.log('     stderr enfant :', r.erreur.slice(0, 400));
    return { r, dossier };
}

// ── fabrication pour « le balayage dit NON »
const { balayerOrphelins, PREFIXE_BANC, FICHIER_MARQUE, contenuMarque } = (() => {
    try { const m = require(BASE_BANC); return { balayerOrphelins: m.balayerOrphelins, PREFIXE_BANC: m.PREFIXE_BANC, FICHIER_MARQUE: m.FICHIER_MARQUE, contenuMarque: m.contenuMarque }; }
    catch (e) { console.log('  (base-banc ne se charge pas :', e.message, ')'); return {}; }
})();
const nbFichiers = d => { let n = 0; const marche = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { n++; if (e.isDirectory()) marche(path.join(p, e.name)); } }; marche(d); return n; };
function pidMort() { const r = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' }); return r.pid; }

async function balayage() {
    console.log('\n── le balayage ne touche que SES dossiers orphelins');
    if (typeof balayerOrphelins !== 'function' || !PREFIXE_BANC) { verifier('balayerOrphelins / PREFIXE_BANC / FICHIER_MARQUE / contenuMarque sont exportés', false, true); return; }
    const racine = path.join(RACINE, 'balayage'); fs.mkdirSync(racine);
    const fab = (nom, { marque, fichiers = ['x.wt'] } = {}) => {
        const d = path.join(racine, nom); fs.mkdirSync(d);
        for (const f of fichiers) fs.writeFileSync(path.join(d, f), 'donnée');
        if (marque !== undefined) fs.writeFileSync(path.join(d, FICHIER_MARQUE), marque);
        return d;
    };
    const mort = pidMort();
    const cible = path.join(RACINE, 'cible-jonction'); fs.mkdirSync(cible);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(cible, `precieux-${i}.txt`), 'à ne pas toucher');
    const avantCible = nbFichiers(cible);

    const etranger = fab('mongo-mem-etranger');
    const sansMarque = fab(PREFIXE_BANC + 'sansmarque');
    const vivant = fab(PREFIXE_BANC + 'vivant', { marque: contenuMarque(process.pid) });
    const illisible = fab(PREFIXE_BANC + 'illisible', { marque: '{ pas du json' });
    const autreModule = fab(PREFIXE_BANC + 'autremodule', { marque: JSON.stringify({ module: 'autre', version: 1, pid: mort, heure: new Date().toISOString() }) });
    const pidTexte = fab(PREFIXE_BANC + 'pidtexte', { marque: JSON.stringify({ ...JSON.parse(contenuMarque(mort)), pid: String(mort) }) });
    const avecJonction = fab(PREFIXE_BANC + 'jonction', { marque: contenuMarque(mort) });
    const j = path.join(avecJonction, 'piege');
    const mk = spawnSync('cmd.exe', ['/c', 'mklink', '/J', j, cible], { encoding: 'utf8' });
    if (mk.status === 0) jonctions.push(j);
    verifier('la jonction de contrôle a été fabriquée', mk.status, 0);
    // la jonction placée en tête : le dossier au bon préfixe est lui-même une jonction vers un dossier marqué
    const vraiDossier = path.join(RACINE, 'vrai-dossier'); fs.mkdirSync(vraiDossier);
    fs.writeFileSync(path.join(vraiDossier, FICHIER_MARQUE), contenuMarque(mort)); fs.writeFileSync(path.join(vraiDossier, 'a.wt'), 'a');
    const jTete = path.join(racine, PREFIXE_BANC + 'jonctiontete');
    const mk2 = spawnSync('cmd.exe', ['/c', 'mklink', '/J', jTete, vraiDossier], { encoding: 'utf8' });
    if (mk2.status === 0) jonctions.push(jTete);
    verifier('la jonction de tête a été fabriquée', mk2.status, 0);
    const fichierSeul = path.join(racine, PREFIXE_BANC + 'fichier'); fs.writeFileSync(fichierSeul, 'je suis un fichier');
    // le témoin POSITIF : un orphelin marqué, PID mort, sans jonction
    const orphelin = fab(PREFIXE_BANC + 'orphelin', { marque: contenuMarque(mort), fichiers: ['a.wt', 'b.wt'] });
    fs.mkdirSync(path.join(orphelin, 'db')); fs.writeFileSync(path.join(orphelin, 'db', 'c.wt'), 'c');

    const dits = [];
    const res = balayerOrphelins({ racine, log: m => dits.push(m) });
    verifier('l\'orphelin marqué, PID mort, sans jonction : effacé', fs.existsSync(orphelin), false);
    verifier('mongo-mem-<x> d\'un autre agent : intact', fs.existsSync(path.join(etranger, 'x.wt')), true);
    verifier('bon préfixe SANS marqueur : intact', fs.existsSync(path.join(sansMarque, 'x.wt')), true);
    verifier('bon préfixe, PID d\'un processus VIVANT : intact', fs.existsSync(path.join(vivant, 'x.wt')), true);
    verifier('marqueur illisible : intact', fs.existsSync(path.join(illisible, 'x.wt')), true);
    verifier('marqueur d\'un autre module : intact', fs.existsSync(path.join(autreModule, 'x.wt')), true);
    verifier('marqueur dont le PID n\'est pas un entier : intact', fs.existsSync(path.join(pidTexte, 'x.wt')), true);
    verifier('dossier contenant une jonction : rien n\'est effacé dedans', [fs.existsSync(path.join(avecJonction, 'x.wt')), fs.existsSync(j)], [true, true]);
    verifier('la cible de la jonction a le même nombre de fichiers avant et après', nbFichiers(cible), avantCible);
    verifier('le dossier au bon préfixe qui est lui-même une jonction : intact, sa cible aussi', [fs.existsSync(path.join(vraiDossier, 'a.wt')), fs.existsSync(jTete)], [true, true]);
    verifier('un FICHIER au bon préfixe : intact', fs.existsSync(fichierSeul), true);
    verifier('le refus est DIT (message avec le chemin du dossier à jonction)', dits.some(m => m.includes(avecJonction)), true);
    verifier('le balayage rend ce qu\'il a effacé et ce qu\'il a refusé', [res.effaces.length, res.refuses.length > 0], [1, true]);
    verifier('un second balayage ne trouve plus rien à effacer', balayerOrphelins({ racine, log: () => { } }).effaces.length, 0);
}

// ── au moins une exécution réelle d'un appelant existant ne laisse aucun dossier
async function appelantReel() {
    console.log('\n── un appelant existant (test-poser-impressions-energies.js) ne laisse rien derrière lui');
    const libre = libreC(); if (libre < 20) { console.log(`  🛑 ARRÊT : ${libre.toFixed(1)} Go libres`); ko++; return; }
    const avant = contenuTmp();
    const r = lancer(path.join(RACINE_DEPOT, 'test-poser-impressions-energies.js'));
    const fini = await attendre(() => r.fini, 120000);
    if (!fini) { try { r.enfant.kill(); } catch (_) { } }
    verifier('l\'appelant se termine, code 0', [fini, r.code], [true, 0]);
    if (r.code !== 0) console.log(r.sortie.slice(-600), r.erreur.slice(-400));
    const propre = await attendre(() => contenuTmp().length === avant.length, 8000);
    verifier('aucun dossier nouveau dans le tmp de l\'appelant', [propre, contenuTmp()], [true, avant]);
}

// ── retrait de tout ce que ce banc a fabriqué
function retirerRacine() {
    for (const j of jonctions) { try { if (fs.existsSync(j)) spawnSync('cmd.exe', ['/c', 'rmdir', j]); } catch (_) { } }
    const restes = [];
    const cherche = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isSymbolicLink()) restes.push(q); else if (e.isDirectory()) cherche(q); } };
    try { cherche(RACINE); } catch (_) { }
    if (restes.length) { console.log('  ⚠️ jonction restante, la racine n\'est PAS effacée :', restes.join(', ')); return; }
    for (let i = 0; i < 40; i++) { try { fs.rmSync(RACINE, { recursive: true, force: true }); } catch (_) { } if (!fs.existsSync(RACINE)) return; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
    console.log('  ⚠️ la racine privée n\'a pas pu être effacée :', RACINE);
}

(async () => {
    try {
        console.log(`racine privée : ${RACINE}\nespace libre sur C: : ${libreC().toFixed(1)} Go`);
        await cas('a-fin-normale', ACTIONS.arreter, { codeAttendu: 0 });
        await cas('b-exception', ACTIONS.exception, { codeAttendu: 1 });
        await cas('c-promesse-rejetee', ACTIONS.rejet, { codeAttendu: 1 });
        await cas('d-process-exit', ACTIONS.exit, { codeAttendu: 3 });
        await cas('e-fin-naturelle', ACTIONS.fin, { codeAttendu: 0 });
        // f : arrêt brutal, puis un NOUVEL ouvrirBanc balaie le dossier orphelin
        const { dossier } = await cas('f-tue', ACTIONS.attendre, { tuer: true });
        if (dossier) {
            const r2 = await cas('f2-nouveau-banc-balaie', ACTIONS.arreter, { codeAttendu: 0 });
            const parti = await attendre(() => !fs.existsSync(dossier), 8000);
            verifier('f : l\'orphelin du processus tué a été balayé par le banc suivant', [parti, fs.existsSync(dossier)], [true, false]);
            if (!parti) console.log('     stderr :', r2.r.erreur.slice(0, 400));
        }
        await balayage();
        await appelantReel();
    } catch (e) {
        ko++; console.log('  ❌ le banc lui-même a levé :', e && e.message);
    } finally {
        retirerRacine();
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();

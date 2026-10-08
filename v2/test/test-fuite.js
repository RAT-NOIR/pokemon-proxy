'use strict';
// FUITE : après un banc, terminé normalement OU par exception OU par process.exit OU par signal, aucune collection de son préfixe
// ne doit rester dans test_scratch (y compris celles qu'une écriture ou un index tardif recréerait), et son CODE DE SORTIE doit
// rester honnête (un banc rouge ne sort jamais en 0). Chaque cas est un vrai processus enfant.
const path = require('path');
const { spawn } = require('child_process');
const H = require('./_harnais');
const db = require('../db');

// INT2 : ASYNCHRONE, jamais spawnSync. La base de banc est un mongod en mémoire dont la sortie passe par un tube LU par ce processus : un parent
// bloqué par spawnSync ne vide plus le tube, mongod (qui journalise les 16 index de l'enfant) se bloque à son tour, et l'enfant expire (mesuré : 21 échecs sur 32).
// Même contrat que spawnSync : { status, stdout }, timeout 30 s => tué (status null).
const lancer = (args, delaiMs = 30000) => new Promise(resolve => {
    const e = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    e.stdout.on('data', d => { stdout += d; }); e.stderr.on('data', d => { stderr += d; });   // stderr GARDÉ : il sert au diagnostic (imprimé quand un cas échoue)
    const minuteur = setTimeout(() => e.kill(), delaiMs);
    e.on('close', (status) => { clearTimeout(minuteur); resolve({ status, stdout, stderr }); });
});

const noms = async (prefixe) => (await db.base().listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => n.startsWith(prefixe));
// mode -> code de sortie attendu de l'enfant
const CAS = { normal: 0, exception: 1, exit: 1, 'exit-puis-zero': 1, 'non-attrapee': 1, rejet: 1, sigint: 1, sigterm: 1, tardif: 0, 'mongo-muet': 1, 'double-sigint': 1 };
const MUETS = ['mongo-muet', 'double-sigint'];   // le nettoyage de l'enfant ne répond jamais : il ne peut pas vider, c'est le parent qui nettoie

(async () => {
    await H.ouvrirBac('test-fuite.js');
    for (const [mode, codeAttendu] of Object.entries(CAS)) {
        const debut = Date.now();
        const r = await lancer([path.join(__dirname, 'fuite-enfant.js'), mode]);
        const m = /PREFIXE=(rm_t[0-9a-z]+_)/.exec(r.stdout || '');
        H.vrai(`${mode} : l'enfant a annoncé son préfixe`, m);
        H.v(`${mode} : code de sortie de l'enfant`, r.status, codeAttendu);
        if (r.status !== codeAttendu) console.log(`   ↳ stderr de l'enfant (${mode}) : ${String(r.stderr).slice(-600)}`);
        if (mode === 'double-sigint') H.vrai('double-sigint : sortie immédiate (< 10 s, pas le délai de 600 s)', Date.now() - debut < 10000);
        if (!m) continue;
        await new Promise(res => setTimeout(res, 1500));           // laisse tout travail tardif de l'enfant se poser
        const restantes = await noms(m[1]);
        if (MUETS.includes(mode)) { for (const n of restantes) await db.base().collection(n).drop(); }
        else H.v(`${mode} : collections restantes sous le préfixe de l'enfant`, restantes.length, 0);
    }
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

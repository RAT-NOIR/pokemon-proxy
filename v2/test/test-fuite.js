'use strict';
// FUITE : après un banc, terminé normalement OU par exception OU par process.exit, aucune collection de son préfixe ne doit rester
// dans test_scratch (y compris celles qu'une écriture ou un index tardif recréerait). Chaque cas est un vrai processus enfant.
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./_harnais');
const db = require('../db');

const compter = async (prefixe) => (await db.base().listCollections({}, { nameOnly: true }).toArray()).filter(c => c.name.startsWith(prefixe)).length;

(async () => {
    await H.ouvrirBac('test-fuite.js');
    for (const mode of ['normal', 'exception', 'exit', 'tardif']) {
        const r = spawnSync(process.execPath, [path.join(__dirname, 'fuite-enfant.js'), mode], { encoding: 'utf8' });
        const m = /PREFIXE=(rm_t[0-9a-z]+_)/.exec(r.stdout || '');
        H.vrai(`${mode} : l'enfant a annoncé son préfixe`, m);
        if (!m) continue;
        await new Promise(res => setTimeout(res, 1500));           // laisse tout travail tardif de l'enfant se poser
        H.v(`${mode} : collections restantes sous le préfixe de l'enfant`, await compter(m[1]), 0);
    }
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

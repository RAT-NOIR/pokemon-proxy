'use strict';
// LOT FUITE-BANCS : une base de banc en mémoire ne laisse JAMAIS son dossier `mongo-mem-*` derrière elle (incident du 2026-10-13 : 478 dossiers, 85,7 Go).
// Tout est compté dans une RACINE PRIVÉE que ce banc crée lui-même (TEMP/TMP des enfants y sont pointés) : jamais dans le vrai %TEMP%, où d'autres agents travaillent.
//   node v2/test/test-fuite-banc.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { v, vrai, bilan } = require('./_harnais');
const B = require('../../collecte-cartes/base-banc');

const BORNE_TAILLE = 30 * 1048576;       // octets : bornes annoncée d'un dossier de banc après écriture et transaction (mesuré 5,7 Mo ; avant l'option : 200,7 Mo)
const ENFANT = path.join(__dirname, '_enfant-fuite-banc.js');
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-fuite-banc-'));   // la racine privée : seule chose que ce banc supprime
const mongoMem = (r) => fs.readdirSync(r).filter(n => /^mongo-mem-/.test(n));
const vivant = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

// lance un enfant avec TEMP/TMP dans `rac` ; rend { code, signal, stdout, stderr }. `surPret(child, ligne)` peut tuer l'enfant par son PID.
function lancer(action, rac, surPret) {
    return new Promise(resolve => {
        const env = { ...process.env, TEMP: rac, TMP: rac, TMPDIR: rac };
        const c = spawn(process.execPath, [ENFANT, action], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', pret = false;
        c.stdout.on('data', d => { stdout += d; if (!pret && /PRET /.test(stdout) && surPret) { pret = true; surPret(c, /PRET (.*)/.exec(stdout)[1]); } });
        c.stderr.on('data', d => { stderr += d; });
        const garde = setTimeout(() => c.kill(), 120000);
        c.on('close', (code, signal) => { clearTimeout(garde); resolve({ code, signal, stdout, stderr }); });
    });
}
async function cas(nom, action, codeAttendu) {
    const rac = fs.mkdtempSync(path.join(racine, 'r-'));
    const r = await lancer(action, rac);
    v(`${nom} : l'enfant a démarré une base`, /PRET |ECHEC-DEMARRAGE/.test(r.stdout), true);
    if (codeAttendu !== undefined) v(`${nom} : code de sortie`, r.code, codeAttendu);
    v(`${nom} : 0 dossier mongo-mem dans la racine privée`, mongoMem(rac), []);
    return { rac, r };
}

// ── un fs réel dont on peut fausser lstat / rmSync (injection : aucune vraie jonction n'est créée)
function fabrique(tmp, nom = 'mongo-mem-abc123') {
    fs.mkdirSync(tmp, { recursive: true });
    const d = path.join(tmp, nom); fs.mkdirSync(path.join(d, 'journal'), { recursive: true });
    fs.writeFileSync(path.join(d, 'a.wt'), 'a'); fs.writeFileSync(path.join(d, 'journal', 'log'), 'b');
    return d;
}
function appeler(chemin, opts) {
    if (typeof B.retirerDossierBanc !== 'function') return { retire: 'FONCTION ABSENTE', raison: '' };
    return B.retirerDossierBanc(chemin, { ecrire: () => { }, dormir: () => { }, ...opts });
}

(async () => {
    try {
        // ═══ 1. LES SORTIES RÉELLES (enfants, base en mémoire) ═══
        await cas('(a) banc qui réussit et appelle arreter()', 'reussit', 0);
        await cas('(b) exception non rattrapée', 'leve', 1);
        await cas('(b) process.exit(1)', 'exit1', 1);
        await cas('SIGTERM (émis dans le processus : Windows ne délivre pas SIGTERM)', 'sigterm', 143);
        await cas('SIGINT (émis dans le processus)', 'sigint', 130);
        await cas('SIGHUP (émis dans le processus)', 'sighup', 129);
        await cas('(d) mongod qui ne démarre pas', 'demarrage-impossible', 0);
        {
            const { r } = await cas('taille', 'taille', 0);
            const m = /TAILLE (\d+)/.exec(r.stdout);
            v('taille d\'un dossier après écriture et transaction : mesurée', Boolean(m), true);
            vrai(`taille d'un dossier (${m ? (Number(m[1]) / 1048576).toFixed(1) : '?'} Mo) au plus égale à la borne annoncée (${BORNE_TAILLE / 1048576} Mo)`, m && Number(m[1]) <= BORNE_TAILLE);
        }

        // ═══ 2. (c) LA MISE À MORT : aucun code du processus ne s'exécute — le coût est MESURÉ, pas nié ═══
        {
            const rac = fs.mkdtempSync(path.join(racine, 'r-'));
            let pidMongod = 0;
            const r = await lancer('tue', rac, (c, ligne) => { pidMongod = Number(ligne.split(' ').pop()) || 0; setTimeout(() => c.kill(), 300); });
            v('(c) processus tué : l\'enfant est mort sans passer par son nettoyage', r.code === 0 && !r.signal, false);
            vrai('(c) le PID de mongod est connu (jamais 0 : process.kill(0) vise le groupe)', pidMongod > 1);
            for (let i = 0; pidMongod > 1 && i < 40 && vivant(pidMongod); i++) await attendre(500);     // le tueur de mongodb-memory-server arrête mongod
            if (pidMongod > 1 && vivant(pidMongod)) process.kill(pidMongod);                             // un PID que ce banc a lancé (petit-enfant), et lui seul
            await attendre(800);
            v('(c) processus tué : 1 dossier reste (sortie par mise à mort : hors de portée du processus lui-même)', mongoMem(rac).length, 1);
        }

        // ═══ 3. LA SUPPRESSION EST ÉCRITE PAR CE QU'ELLE AUTORISE (fs injecté, aucune vraie jonction) ═══
        const tmpA = path.join(racine, 'tmp-pur');
        {
            const d = fabrique(tmpA, 'mongo-mem-ok');
            const r = appeler(d, { tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('autorisé (noté, préfixe, parent, sans reparse, mongod arrêté) : retiré', [r.retire, fs.existsSync(d)], [true, false]);
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-lien');
            const reel = fs.lstatSync;
            const faux = { ...fs, lstatSync: (p, ...a) => { const s = reel(p, ...a); if (path.basename(p) === 'log') s.isSymbolicLink = () => true; return s; } };
            const r = appeler(d, { fs: faux, tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('une entrée qui est un point de reparse (lstat injecté) : le dossier N\'EST PAS supprimé', [r.retire, fs.existsSync(path.join(d, 'a.wt'))], [false, true]);
            vrai('... et la raison le dit', /reparse|lien|jonction/i.test(r.raison));
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-racinelien');
            const reel = fs.lstatSync;
            const faux = { ...fs, lstatSync: (p, ...a) => { const s = reel(p, ...a); if (p === d) s.isSymbolicLink = () => true; return s; } };
            const r = appeler(d, { fs: faux, tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('la RACINE du dossier est un point de reparse : pas supprimé', [r.retire, fs.existsSync(d)], [false, true]);
        }
        {
            const d = fabrique(tmpA, 'autre-prefixe-xyz');
            const r = appeler(d, { tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('un nom qui ne commence pas par mongo-mem- (même noté) : jamais touché', [r.retire, fs.existsSync(d)], [false, true]);
        }
        {
            const sous = path.join(tmpA, 'sous'); const d = fabrique(sous, 'mongo-mem-profond');
            const r = appeler(d, { tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('un parent qui n\'est pas le dossier temporaire (même noté) : jamais touché', [r.retire, fs.existsSync(d)], [false, true]);
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-pasnote');
            const r = appeler(d, { tmp: tmpA, notes: new Set(), mongodArrete: true });
            v('un dossier mongo-mem-* que CE processus n\'a pas créé (non noté) : jamais touché', [r.retire, fs.existsSync(d)], [false, true]);
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-vivant');
            const r = appeler(d, { tmp: tmpA, notes: new Set([d]), mongodArrete: false });
            v('mongod pas arrêté : le dossier reste', [r.retire, fs.existsSync(d)], [false, true]);
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-ebusy');
            let essais = 0;
            const faux = { ...fs, rmSync: () => { if (++essais > 50) throw new Error('GARDE DU BANC : boucle sans fin'); const e = new Error('verrou'); e.code = 'EBUSY'; throw e; } };
            const r = appeler(d, { fs: faux, tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('verrou passager permanent (EBUSY) : réessai BORNÉ à 5 tentatives, puis abandon', [r.retire, essais, r.tentatives], [false, 5, 5]);
            vrai('... et la ligne dit pourquoi le dossier reste', /EBUSY/.test(r.raison));
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-ebusy2');
            let essais = 0; const reel = fs.rmSync;
            const faux = { ...fs, rmSync: (...a) => { if (++essais < 3) { const e = new Error('verrou'); e.code = 'EPERM'; throw e; } return reel(...a); } };
            const r = appeler(d, { fs: faux, tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('verrou passager (EPERM deux fois) : réessai, puis retiré', [r.retire, essais, fs.existsSync(d)], [true, 3, false]);
        }
        {
            const d = fabrique(tmpA, 'mongo-mem-autreerreur');
            let essais = 0;
            const faux = { ...fs, rmSync: () => { essais++; const e = new Error('disque'); e.code = 'EIO'; throw e; } };
            const r = appeler(d, { fs: faux, tmp: tmpA, notes: new Set([d]), mongodArrete: true });
            v('une erreur qui n\'est pas un verrou passager : aucun réessai', [r.retire, essais], [false, 1]);
        }
    } finally {
        // seule suppression de ce banc : sa propre racine privée (créée plus haut, sous le dossier temporaire)
        if (path.dirname(racine) === os.tmpdir() && path.basename(racine).startsWith('rm-fuite-banc-')) {
            try { fs.rmSync(racine, { recursive: true, force: true }); } catch (e) { console.log(`racine privée conservée : ${e.code}`); }
        }
    }
    bilan();
})();

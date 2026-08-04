// Démarrage d'un vrai serveur sur un port libre, et appels HTTP dessus.
// Mutualisé entre l'extracteur (mode enregistrement) et le verrou (mode rejeu) : deux
// copies de ce code auraient divergé, et on a déjà donné.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');

function portLibre() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
        s.on('error', reject);
    });
}

function attendrePort(port, timeoutMs = 30000) {
    const debut = Date.now();
    return new Promise((resolve, reject) => {
        const essai = () => {
            const s = net.connect(port, '127.0.0.1');
            s.on('connect', () => { s.destroy(); resolve(); });
            s.on('error', () => {
                s.destroy();
                if (Date.now() - debut > timeoutMs) reject(new Error('le serveur n\'a pas démarré à temps'));
                else setTimeout(essai, 250);
            });
        };
        essai();
    });
}

function appeler(port, methode, chemin, corps, jeton) {
    return new Promise(resolve => {
        const donnees = corps == null ? null : Buffer.from(JSON.stringify(corps));
        const req = http.request({
            host: '127.0.0.1', port, path: chemin, method: methode,
            headers: {
                ...(jeton ? { 'x-jeton': jeton } : {}),
                ...(donnees ? { 'content-type': 'application/json', 'content-length': donnees.length } : {})
            }
        }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(b); } catch (_) { }
                resolve({ status: res.statusCode, json, brut: b });
            });
        });
        req.on('error', e => resolve({ status: 0, json: null, brut: e.message }));
        if (donnees) req.write(donnees);
        req.end();
    });
}

/**
 * Démarre index.js avec un module préchargé, sur test_scratch.
 * @param {string} prechargement  chemin du module -r (faux-reseau ou enregistreur)
 * @param {object} env            variables supplémentaires
 * @returns {{enfant, port, lire: () => string, attendreMongo: () => Promise<boolean>}}
 */
async function demarrer(prechargement, env = {}) {
    const port = await portLibre();
    const enfant = spawn(process.execPath, ['-r', prechargement, 'index.js'], {
        cwd: RACINE,
        env: {
            ...process.env,
            // index.js s'ARRÊTE de lui-même si la base connectée n'est pas celle-ci.
            MONGODB_BASE: 'test_scratch',
            PORT: String(port),
            STRIPE_SECRET_KEY: '',
            ...env
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let sortie = '';
    enfant.stdout.on('data', d => { sortie += d.toString(); });
    enfant.stderr.on('data', d => { sortie += d.toString(); });

    await attendrePort(port);

    return {
        enfant, port,
        lire: () => sortie,
        attendreMongo: async () => {
            for (let i = 0; i < 40; i++) {
                const p = await appeler(port, 'GET', '/ping', null, null);
                if (p.json?.mongo === true) return true;
                await new Promise(r => setTimeout(r, 250));
            }
            return false;
        }
    };
}

module.exports = { portLibre, attendrePort, appeler, demarrer, RACINE };

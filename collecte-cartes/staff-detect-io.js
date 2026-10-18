// Lecture SEULE des vignettes Cardmarket du testeur + OCR local (RapidOCR du labo, aucun réseau). Rien n'est écrit dans le dossier source.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');

const RACINE = 'C:\\Users\\Yung\\Desktop\\CARDMARKET IMAGE';
const EST_CARTE = /^(\d+)\.(jpe?g|png|webp)$/i;
const DELAI_OCR_MS = 120000;
const { autoriser } = require('./garde-ecriture');
const LARGEUR = 256, HAUTEUR = 360;
const PYTHON_OCR = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy-labo\\.venv-ocr\\Scripts\\python.exe';
const SERVEUR_OCR = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy-labo\\ocr-serveur.py';

// Même règle que ecrire-descripteurs.js : premier fichier trouvé par idProduct.
function indexerDisque(racine = RACINE) {
    const m = new Map();
    (function marche(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) marche(p);
            else { const x = EST_CARTE.exec(e.name); if (x && !m.has(Number(x[1]))) m.set(Number(x[1]), p); }
        }
    })(racine);
    return m;
}

async function charger(fichier) {
    const { data, info } = await sharp(fichier).removeAlpha().resize({ width: LARGEUR, height: HAUTEUR, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
}

// Recadrage de la bande du bas (sur l'image d'origine), agrandi, écrit dans un fichier TEMPORAIRE hors dossier source.
async function recadrerBande(fichier, sortie, bande = 0.2) {
    sortie = autoriser(sortie);
    const m = await sharp(fichier).metadata();
    const top = Math.floor(m.height * (1 - bande));
    await sharp(fichier).extract({ left: 0, top, width: m.width, height: m.height - top }).resize({ width: m.width * 3 }).png().toFile(sortie);
}

// Recadrage SERRÉ sur la pastille (bbox du détecteur), agrandi : l'OCR ne lit que le texte de l'étiquette, pas celui de la carte.
async function recadrerPastille(fichier, bbox, sortie) {
    sortie = autoriser(sortie);
    const D = require('./staff-detect');
    const m = await sharp(fichier).metadata();
    const r = D.rectanglePastille(bbox, LARGEUR, HAUTEUR, m.width, m.height, 0.08);
    await sharp(fichier).extract(r).resize({ width: Math.max(600, r.width * 3) }).png().toFile(sortie);
}

function lancerOcr() {
    const p = spawn(PYTHON_OCR, [SERVEUR_OCR], { stdio: ['pipe', 'pipe', 'pipe'] });
    let tampon = '', attente = new Map(), n = 0;
    p.stdout.on('data', d => {
        tampon += d.toString('utf8');
        let i;
        while ((i = tampon.indexOf('\n')) >= 0) {
            const l = tampon.slice(0, i).trim(); tampon = tampon.slice(i + 1);
            if (!l.startsWith('{')) continue;
            try { const r = JSON.parse(l); const f = attente.get(r.id); if (f) { attente.delete(r.id); f(r); } } catch (e) { /* ligne non JSON */ }
        }
    });
    p.stderr.on('data', () => { });
    return {
        lire(chemin) {
            return new Promise(res => {
                const id = ++n;
                const minuteur = setTimeout(() => { if (attente.delete(id)) res({ id, erreur: 'delai OCR depasse', lignes: [] }); }, DELAI_OCR_MS);
                attente.set(id, r => { clearTimeout(minuteur); res(r); });
                p.stdin.write(JSON.stringify({ id, chemin }) + '\n');
            });
        },
        fermer() { try { p.stdin.end(); } catch (e) { /* déjà fermé */ } },
        pid: p.pid,
    };
}

module.exports = { RACINE, indexerDisque, charger, recadrerBande, recadrerPastille, lancerOcr, LARGEUR, HAUTEUR };

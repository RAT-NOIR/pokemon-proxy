'use strict';
// Préchargement (-r) du serveur ENFANT de test-scanner-routes.js : le faux réseau du verrou, plus UNE chose — une image transmise à l'IA en data-URL (le scanner du site)
// est rejouée comme la photo de la charge « occidentale » (Tropius PBL 001). Aucun appel sortant. Le log dit seulement la taille de ce qui a été transmis, jamais l'image.
require('../../verrou/faux-reseau.js');
const axios = require('axios');
const reel = axios.post;
const cible = require(process.env.VERROU_CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
axios.post = async function (url, corps, ...suite) {
    if (String(url).includes('openrouter.ai')) {
        const p = ((corps && corps.messages && corps.messages[0] && corps.messages[0].content) || []).find(x => x.type === 'image_url');
        if (p && typeof p.image_url.url === 'string' && p.image_url.url.startsWith('data:')) {
            console.log(`🎛️ [faux-reseau-scanner] data-URL transmis à l'IA (${p.image_url.url.length} caractères)`);
            p.image_url = { ...p.image_url, url: cible };
        }
    }
    return reel.call(this, url, corps, ...suite);
};

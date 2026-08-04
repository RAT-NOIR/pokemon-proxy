// ============================================================
// L'ENREGISTREUR — préchargé pendant l'EXTRACTION, jamais pendant le verrou
// ============================================================
// Il fait la moitié du travail du faux réseau, à l'envers : la lecture IA est rejouée
// (donc l'extraction ne coûte rien en appels payants), mais les appels TCGdex partent
// POUR DE VRAI et leurs réponses sont capturées.
//
// POURQUOI ENREGISTRER PLUTÔT QUE RENDRE TCGdex MUET, comme je l'avais fait d'abord.
// Muet, la route s'arrête à « carte introuvable » ligne 2769 — mesuré sur les deux
// premières charges : ZÉRO des 65 lignes du journal pouvait atteindre le code à protéger.
// Le choix ne restreignait pas le verrou, il l'empêchait de servir. Avec l'enregistrement,
// toute ligne QUI A ABOUTI en production traverse la chaîne entière.
//
// MÊME RÈGLE QUE POUR LES CHARGES : ce qui est rejoué est ENREGISTRÉ, jamais écrit à la
// main. Une réponse TCGdex rédigée par nous serait le stub qu'on a déjà payé deux fois.

const axios = require('axios');
const fs = require('fs');

const CHARGES = process.env.VERROU_CHARGES;
const SORTIE = process.env.VERROU_ENREGISTRER;
if (!CHARGES || !SORTIE) {
    console.error('❌ [enregistreur] VERROU_CHARGES et VERROU_ENREGISTRER sont requis.');
    process.exit(1);
}
const donnees = JSON.parse(fs.readFileSync(CHARGES, 'utf8'));
const parImage = new Map(donnees.charges.map(c => [c.imageUrl, c.lecture]));

// URL -> réponse. On ne garde que `data` : le reste (en-têtes, socket) ne sert à rien à
// la chaîne et ferait grossir le fichier pour rien.
const capture = {};

const getOriginal = axios.get.bind(axios);

axios.post = async function (url, corps) {
    if (String(url).includes('openrouter.ai')) {
        const contenu = corps?.messages?.[0]?.content ?? [];
        const image = contenu.find(p => p.type === 'image_url')?.image_url?.url;
        const lecture = parImage.get(image);
        if (!lecture) throw new Error(`[enregistreur] aucune lecture pour ${image}`);
        return { data: { choices: [{ message: { content: JSON.stringify(lecture) } }] } };
    }
    throw new Error(`[enregistreur] POST non prévu vers ${url}`);
};

axios.get = async function (url, options) {
    if (!String(url).includes('api.tcgdex.net')) {
        throw new Error(`[enregistreur] GET non prévu vers ${url}`);
    }
    try {
        const r = await getOriginal(url, options);
        capture[url] = { statut: r.status, data: r.data };
        return r;
    } catch (e) {
        // ⚠️ LES ÉCHECS SONT ENREGISTRÉS AUSSI, et c'est important : un 404 de TCGdex est
        // une RÉPONSE de la chaîne, pas une panne. `/v2/en/cards/E4-055` rend 404 et c'est
        // ce 404 qui fait basculer sur le repli local. Ne pas le capturer rendrait le rejeu
        // différent de la réalité — exactement le genre d'écart qu'on traque.
        capture[url] = { statut: e.response?.status ?? 0, erreur: e.message, data: e.response?.data ?? null };
        throw e;
    }
};

// Écrit à la sortie du processus : le serveur est tué par l'extracteur quand il a fini.
function vider() {
    try {
        fs.writeFileSync(SORTIE, JSON.stringify({
            enregistreLe: new Date().toISOString(),
            nb: Object.keys(capture).length,
            reponses: capture
        }, null, 2), 'utf8');
        console.log(`🎬 [enregistreur] ${Object.keys(capture).length} réponse(s) TCGdex écrites.`);
    } catch (e) { console.error(`❌ [enregistreur] écriture impossible : ${e.message}`); }
}
process.on('SIGTERM', () => { vider(); process.exit(0); });
process.on('SIGINT', () => { vider(); process.exit(0); });
// Windows : SIGTERM n'est pas toujours délivré. L'extracteur demande donc aussi un vidage
// explicite par un message IPC avant de tuer le processus.
process.on('message', m => { if (m === 'vider') { vider(); process.send?.('vide'); } });

console.log('🎬 [enregistreur] armé : IA rejouée, TCGdex RÉEL et capturé.');

// ============================================================
// LE FAUX RÉSEAU — préchargé AVANT index.js, absent de la production
// ============================================================
// POURQUOI UN PRÉCHARGEMENT ET PAS UN DRAPEAU DANS index.js. Un `if (process.env.TEST)`
// dans le code de production est une branche qui part en production. Elle peut s'activer
// par erreur de configuration, et elle fait mentir la lecture du code : on ne voit plus
// ce qui tourne vraiment chez l'utilisateur.
// Ici, RIEN de ce fichier n'existe pour Render. Le verrou lance
// `node -r ./verrou/faux-reseau.js index.js` : le module est chargé, il patche l'instance
// axios du cache de require, puis index.js démarre et reçoit un axios déjà instrumenté.
//
// TROIS RÈGLES :
//   1. POST vers OpenRouter -> rejoue une lecture ENREGISTRÉE, sans un centime dépensé
//   2. GET  vers TCGdex     -> rejoue une réponse ENREGISTRÉE (voir verrou/enregistreur.js)
//   3. TOUT LE RESTE        -> lève. Un appel sortant non prévu doit faire échouer le
//                              verrou, jamais passer inaperçu.
//
// ════════════════════════════════════════════════════════════════════════════
// LE BÉNÉFICE QU'ON N'AVAIT PAS VU : DÉTECTEUR DE CHANGEMENT DE COMPORTEMENT
// ════════════════════════════════════════════════════════════════════════════
// Une URL TCGdex NON ENREGISTRÉE ne veut pas dire « le cache est incomplet ». Elle veut
// dire QUE LA CHAÎNE DEMANDE MAINTENANT AUTRE CHOSE À TCGdex qu'au moment de
// l'enregistrement — une route en plus, une langue en plus, un identifiant construit
// autrement. C'est un CHANGEMENT DE COMPORTEMENT, et il est presque toujours involontaire :
// personne ne se dit « je vais ajouter un appel réseau », ça arrive en modifiant une
// fonction en amont.
// Ce cas mérite donc mieux qu'une exception brute. Il est tracé sur une ligne dédiée que
// le verrou reconnaît et rapporte À PART, avec l'URL exacte et les deux lectures possibles.

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CHARGES = process.env.VERROU_CHARGES;
if (!CHARGES) {
    console.error('❌ [faux-reseau] VERROU_CHARGES absent — refus de démarrer sans charges.');
    process.exit(1);
}
const donnees = JSON.parse(fs.readFileSync(CHARGES, 'utf8'));

// Clé = l'URL d'image de l'annonce, telle qu'enregistrée au journal. C'est ce qui permet
// de rendre LA lecture qui correspond à LA photo, sur un serveur qui reçoit les charges à
// la suite. Déterministe, et sans inventer de marqueur artificiel.
const parImage = new Map(donnees.charges.map(c => [c.imageUrl, c.lecture]));

// Les réponses TCGdex enregistrées. Absentes = le verrou le dira ; il ne fabrique rien.
const FICHIER_TCGDEX = path.join(__dirname, 'tcgdex.json');
let tcgdex = {};
if (fs.existsSync(FICHIER_TCGDEX)) {
    tcgdex = JSON.parse(fs.readFileSync(FICHIER_TCGDEX, 'utf8')).reponses || {};
}

axios.post = async function (url, corps) {
    if (String(url).includes('openrouter.ai')) {
        const contenu = corps?.messages?.[0]?.content ?? [];
        const image = contenu.find(p => p.type === 'image_url')?.image_url?.url;
        const lecture = parImage.get(image);
        if (!lecture) {
            throw new Error(`[faux-reseau] aucune lecture enregistrée pour l'image ${image}`);
        }
        console.log(`🎛️ [faux-reseau] lecture rejouée pour ${String(image).slice(0, 60)}`);
        // La forme EXACTE d'une réponse OpenRouter. getCardIdFromAI la parse vraiment :
        // nettoyage des ```json, JSON.parse, défauts de nomConfiance, drapeau
        // numeroIllisible — tout s'exécute. C'est du code de production couvert pour de bon.
        return { data: { choices: [{ message: { content: JSON.stringify(lecture) } }] } };
    }
    throw new Error(`[faux-reseau] POST non prévu vers ${url}`);
};

axios.get = async function (url) {
    const u = String(url);
    if (!u.includes('api.tcgdex.net')) {
        throw new Error(`[faux-reseau] GET non prévu vers ${u}`);
    }
    const enreg = tcgdex[u];
    if (!enreg) {
        // ⚠️ LA LIGNE QUE LE VERROU RECONNAÎT. Voir le bloc en tête de fichier : ce n'est
        // pas un trou de cache, c'est un changement de comportement de la chaîne.
        console.log(`🔔 [faux-reseau] URL-TCGDEX-NON-ENREGISTREE ${u}`);
        const e = new Error(`URL TCGdex non enregistrée : ${u}`);
        e.code = 'ENOTFOUND';
        throw e;
    }
    if (enreg.statut >= 400 || enreg.erreur) {
        // Un 404 enregistré doit rester un 404 : c'est lui qui fait basculer la chaîne sur
        // le repli local. Le rejouer en succès changerait le chemin exercé.
        const e = new Error(enreg.erreur || `Request failed with status code ${enreg.statut}`);
        e.response = { status: enreg.statut, data: enreg.data ?? null };
        throw e;
    }
    return { status: enreg.statut, data: enreg.data };
};

console.log(`🎛️ [faux-reseau] armé : ${parImage.size} lecture(s), ${Object.keys(tcgdex).length} réponse(s) TCGdex, tout autre appel lève.`);

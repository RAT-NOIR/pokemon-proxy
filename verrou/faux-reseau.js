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
// Le code de production n'a pas une ligne de test dedans.
//
// CE QU'IL FAIT, EN TROIS RÈGLES :
//   1. POST vers OpenRouter  -> rejoue une lecture ENREGISTRÉE, sans un centime dépensé
//   2. GET  vers TCGdex      -> échoue comme un réseau coupé (voir plus bas, c'est voulu)
//   3. TOUT LE RESTE         -> lève. Un appel sortant qu'on n'avait pas prévu doit faire
//                               échouer le verrou, jamais passer inaperçu.
//
// ⚠️ POURQUOI TCGdex ÉCHOUE AU LIEU D'ÊTRE REJOUÉ. C'est une limite ASSUMÉE de cette
// version, pas un oubli. Rejouer TCGdex demanderait d'enregistrer ses réponses, et l'étage
// TCGdex -> nomExact -> catalogue est précisément celui qu'U4 doit couvrir en appelant les
// vraies API. Ce que le verrou exerce ici, c'est la chaîne QUAND TCGdex EST MUET — un état
// de production réel et fréquent (les e-Series japonaises y sont absentes), et le chemin
// qui menait au plantage d'aujourd'hui. Le jour où on voudra plus, on enregistrera les
// réponses TCGdex par la même mécanique que les charges : extraites, jamais écrites.

const axios = require('axios');
const fs = require('fs');

const CHARGES = process.env.VERROU_CHARGES;
if (!CHARGES) {
    console.error('❌ [faux-reseau] VERROU_CHARGES absent — refus de démarrer sans charges.');
    process.exit(1);
}
const donnees = JSON.parse(fs.readFileSync(CHARGES, 'utf8'));

// Clé = l'URL d'image de l'annonce, telle qu'enregistrée au journal. C'est ce qui permet
// de rendre LA lecture qui correspond à LA photo, sur un serveur qui reçoit les trois
// charges à la suite. Déterministe, et sans inventer de marqueur artificiel.
const parImage = new Map(donnees.charges.map(c => [c.imageUrl, c.lecture]));

const postOriginal = axios.post.bind(axios);
const getOriginal = axios.get.bind(axios);

axios.post = async function (url, corps, options) {
    if (String(url).includes('openrouter.ai')) {
        // On retrouve la photo dans le corps réellement envoyé : c'est le même objet que
        // celui que la production enverrait, donc on teste bien le chemin d'appel.
        const contenu = corps?.messages?.[0]?.content ?? [];
        const image = contenu.find(p => p.type === 'image_url')?.image_url?.url;
        const lecture = parImage.get(image);
        if (!lecture) {
            throw new Error(`[faux-reseau] aucune lecture enregistrée pour l'image ${image}`);
        }
        console.log(`🎛️ [faux-reseau] lecture rejouée pour ${String(image).slice(0, 60)}`);
        // La forme EXACTE d'une réponse OpenRouter. getCardIdFromAI la parse vraiment :
        // le nettoyage des ```json, le JSON.parse, les défauts de nomConfiance, le drapeau
        // numeroIllisible — tout s'exécute. C'est du code de production couvert pour de bon.
        return { data: { choices: [{ message: { content: JSON.stringify(lecture) } }] } };
    }
    throw new Error(`[faux-reseau] POST non prévu vers ${url}`);
};

axios.get = async function (url, options) {
    if (String(url).includes('api.tcgdex.net')) {
        const e = new Error('connect ECONNREFUSED (faux-reseau : TCGdex volontairement muet)');
        e.code = 'ECONNREFUSED';
        throw e;
    }
    throw new Error(`[faux-reseau] GET non prévu vers ${url}`);
};

console.log(`🎛️ [faux-reseau] armé : ${parImage.size} lecture(s), TCGdex muet, tout autre appel lève.`);

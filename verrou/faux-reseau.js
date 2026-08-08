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

// ════════════════════════════════════════════════════════════════════════════
// TROIS ÉTATS DE L'ENREGISTREMENT, ET ILS NE DOIVENT PAS SE RESSEMBLER
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ LE DÉFAUT QUE ÇA CORRIGE. La version précédente faisait `tcgdex = {}` quand le
// fichier était absent, ET `tcgdex = {}` quand il existait mais ne contenait rien. Les
// deux produisaient la même sortie : toutes les URL « non enregistrées », donc un verdict
// « la chaîne demande autre chose à TCGdex » — un diagnostic FAUX, puisque la vraie cause
// était qu'il n'y avait aucun enregistrement du tout.
// UN FICHIER VIDE QUI PASSE POUR UN CACHE LÉGITIME est exactement la famille de défaut
// qu'on traque : un contenant présent, un contenu absent, et rien qui distingue les deux.
// Les trois états sont donc nommés, et le verrou les lit sur cette ligne.
const FICHIER_TCGDEX = path.join(__dirname, 'tcgdex.json');
let tcgdex = {}, etatTcgdex = 'ABSENT', couvertes = [];
if (fs.existsSync(FICHIER_TCGDEX)) {
    let brut = null;
    // ⚠️ LE BOM EST RETIRÉ AVANT L'ANALYSE. Sur Windows, tout outil qui touche ce fichier
    // (`Out-File -Encoding utf8` de PowerShell 5.1 en tête) y ajoute un BOM que JSON.parse
    // refuse. Sans ce nettoyage, un fichier parfaitement valide est déclaré CORROMPU et on
    // part chercher une panne inexistante — vu à l'instant en testant l'état « vide ».
    try { brut = JSON.parse(fs.readFileSync(FICHIER_TCGDEX, 'utf8').replace(/^﻿/, '')); }
    catch (e) { etatTcgdex = 'ILLISIBLE'; }
    if (brut) {
        tcgdex = brut.reponses || {};
        couvertes = brut.chargesCouvertes || [];
        etatTcgdex = Object.keys(tcgdex).length === 0 ? 'VIDE' : 'PRESENT';
    }
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

// ⚠️ SORTIR PROPREMENT POUR QUE LA COUVERTURE SOIT ÉCRITE. V8 ne dépose le fichier
// NODE_V8_COVERAGE qu'à une sortie NORMALE. Le verrou tue le serveur avec SIGTERM, que
// Node traite par défaut en terminant sans rien écrire : le dossier restait VIDE, et le
// cliquet fusionnait zéro couverture tout en annonçant « le cliquet tient ». Un contrôle
// qui mesure le vide sans le dire est exactement ce qu'on traque.
// Le handler vit ICI, dans le préchargement de test — pas une ligne dans index.js.
// ⚠️ PAR IPC, PAS PAR SIGNAL. Sur Windows, SIGTERM envoyé à un autre processus n'est PAS
// délivrable : `child.kill()` appelle TerminateProcess et la sortie n'est jamais propre,
// handler ou pas. Mesuré — le dossier restait vide après avoir posé les handlers.
// Le message IPC, lui, passe : c'est déjà comme ça que l'enregistreur vide sa cassette.
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { console.log(`🎛️ [faux-reseau] ${sig} — sortie propre.`); process.exit(0); });
}
process.on('message', m => {
    if (m !== 'arret') return;
    console.log('🎛️ [faux-reseau] arrêt demandé — sortie propre pour que la couverture soit écrite.');
    process.exit(0);
});

// La ligne que le verrou lit pour connaître l'état. Format stable, volontairement.
console.log(`🎛️ [faux-reseau] armé : ${parImage.size} lecture(s), TCGDEX-${etatTcgdex}` +
    ` ${Object.keys(tcgdex).length} réponse(s), ${couvertes.length} charge(s) couverte(s).`);
console.log(`🎛️ [faux-reseau] CHARGES-COUVERTES ${JSON.stringify(couvertes)}`);

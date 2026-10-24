'use strict';
// Préchargement (-r) du serveur ENFANT du banc ETAT-TITRE : le faux réseau du verrou (OpenRouter rejoué par photo, TCGdex enregistré, tout le reste lève), PUIS un faux MODÈLE qui
//   · ENREGISTRE chaque requête au modèle (genre « identification » ou « etat », photos, corps entier) dans le fichier BANC_ET_REQUETES (une ligne JSON par appel) ;
//   · RECOPIE dans son état un mot de ce qu'il reçoit (« neuf », « excellent état », « abîmé », « usée ») : c'est le défaut de l'ancienne chaîne, où le titre de l'annonce partait avec l'estimation de
//     l'état. Une chaîne qui lui donne le titre rend un état qui varie avec le titre ; une chaîne qui ne le lui donne pas rend l'état de la lecture rejouée, quel que soit le titre ;
//   · fait tomber l'appel d'ÉTAT (et lui seul) sur une photo dont l'adresse contient « panne-etat » : une panne du fournisseur (ECONNRESET), l'identification de la même photo répond.
// Le genre se reconnaît au texte : la consigne d'identification commence par « Identifie cette carte ». Aucun appel sortant : le faux réseau du verrou lève sur tout le reste.
require('../../verrou/faux-reseau.js');
const axios = require('axios');
const fs = require('fs');
const vrai = axios.post;
const FICHIER = process.env.BANC_ET_REQUETES;
const MOTS = [['abîmé', 'PL'], ['usée', 'LP'], ['excellent état', 'EX'], ['neuf', 'NM']];

axios.post = async function (url, corps, config) {
    if (!String(url).includes('openrouter.ai')) return vrai.apply(this, arguments);
    const contenu = corps && corps.messages && corps.messages[0] && corps.messages[0].content ? corps.messages[0].content : [];
    const texte = contenu.filter(p => p.type === 'text').map(p => p.text).join('\n');
    const images = contenu.filter(p => p.type === 'image_url').map(p => p.image_url.url);
    const genre = /Identifie cette carte/.test(texte) ? 'identification' : 'etat';
    if (FICHIER) fs.appendFileSync(FICHIER, JSON.stringify({ genre, images, corps: JSON.stringify(corps), avecSignal: Boolean(config && config.signal), debut: Date.now() }) + '\n');
    // une photo « lente » : chaque appel met 900 ms à répondre (le banc du parallélisme : deux appels qui partent ensemble répondent ensemble, deux appels en file mettent le double)
    if (images.some(u => /lent/.test(u))) await new Promise(r => setTimeout(r, 900));
    // C3 : une photo dont SEUL l'appel d'état traîne (3 500 ms) ; l'identification de la même photo répond tout de suite
    if (genre === 'etat' && images.some(u => /etat-bloque/.test(u))) await new Promise(r => setTimeout(r, 3500));
    if (genre === 'etat' && images.some(u => /panne-etat/.test(u))) { const e = new Error('read ECONNRESET'); e.code = 'ECONNRESET'; throw e; }
    const r = await vrai.call(this, url, corps, config);
    const lecture = JSON.parse(r.data.choices[0].message.content);
    // l'identification ne lit que le titre (la consigne d'identification porte des mots d'état en toutes lettres) ; l'estimation de l'état lit TOUT ce qu'elle reçoit
    const lu = (genre === 'identification' ? texte.slice(texte.lastIndexOf("Titre de l'annonce (contexte) :")) : texte).toLowerCase();
    const trouve = MOTS.find(([m]) => lu.includes(m));
    if (trouve) { lecture.etatEstime = trouve[1]; lecture.etatConfiance = 'haute'; lecture.defautsVus = [trouve[0]]; }
    return { data: { choices: [{ message: { content: JSON.stringify(lecture) } }] } };
};

// GARDE STATIQUE d'un userscript PASSIF (lot CVIPER) — ÉCRITE PAR CE QU'ELLE AUTORISE (CLAUDE.md, en tête des règles de sécurité).
// Rend la liste des violations d'un texte de userscript ; vide = tout ce que le script contient est dans l'ensemble admis.
// Aucune lecture de réseau, aucun fichier : un texte entre, une liste sort. Le jeton est lu par esprima (commentaires et chaînes séparés EXACTEMENT, regex comprises),
// jamais par une regex sur le texte brut (ce qui effaçait « (//hôte » comme un commentaire).
//   · EN-TÊTE : liste FERMÉE de directives, chacune une fois, avec sa valeur admise. Toute autre (@require, @resource, @icon, @updateURL, @downloadURL, @unwrap…) échoue.
//   · CORPS : chaînes sans hôte ni URL hors 127.0.0.1 (formes scheme://, //hôte, hôte.tld, url( ), pas de gabarit `…`, CSS à propriétés admises, écritures de propriétés
//     d'un petit ensemble fermé, accès indexé réduit à un identifiant ou un nombre, méthodes appelées et `new` d'un ensemble fermé, createElement de div, button, canvas.
const esprima = require('esprima');

const MATCH = 'https://collectorviper.livejournal.com/*';
const HOTES_ADMIS = Object.freeze(['collectorviper.livejournal.com', 'recepteur-collectorviper.js']);   // chaînes à points admises dans le code (garde de lieu, commande affichée)
const PREFIXE_LOCAL = 'http://127.0.0.1:';
const PREFIXE_PNG = 'data:image/png;base64,';
const sansHote = v => !/\/\/|:\/\//.test(v) && !(v.match(/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || []).some(h => /[A-Za-z]/.test(h.split('.').pop()));

const ENTETE_ADMIS = Object.freeze({
    name: v => v === 'Rat-Market — Relevé passif Collectorviper',
    namespace: v => v === 'rat-market',
    version: v => v === '1.0',
    description: v => v !== '' && sansHote(v),
    match: v => v === MATCH,
    grant: v => v === 'GM_xmlhttpRequest',
    connect: v => v === '127.0.0.1',
    'run-at': v => v === 'document-idle',
    noframes: v => v === ''
});
const CSS_OK = Object.freeze(['position', 'bottom', 'right', 'z-index', 'background', 'color', 'font', 'padding', 'border', 'border-radius', 'box-shadow', 'width', 'margin-bottom', 'margin-top', 'min-height', 'line-height', 'white-space', 'cursor', 'font-weight', 'font-size']);
const ECRITURES_OK = Object.freeze(['textContent', 'cssText', 'disabled', 'opacity', 'width', 'height', 'color', 'etat', 'raison']);   // etat et raison : champs d'un objet local du script
const METHODES_OK = Object.freeze(['createElement', 'appendChild', 'addEventListener', 'getContext', 'drawImage', 'toDataURL', 'querySelector', 'querySelectorAll', 'closest', 'slice', 'call', 'forEach', 'push', 'join', 'then', 'charAt', 'indexOf', 'test', 'replace', 'trim', 'toISOString', 'floor', 'random', 'max', 'stringify', 'parse', 'resolve']);
const APPELS_NUS_OK = Object.freeze(['GM_xmlhttpRequest', 'resoudre', 'rejeter', 'Number', 'String', 'Boolean']);
const NEW_OK = Object.freeze(['Promise', 'Date']);
const ELEMENTS_OK = Object.freeze(['div', 'button', 'canvas']);
const IDENTIFIANTS_REFUSES = new Set(['window', 'self', 'top', 'parent', 'frames', 'globalThis', 'unsafeWindow', 'GM', 'GM_info', 'eval', 'Function', 'fetch', 'XMLHttpRequest', 'xmlHttpRequest', 'sendBeacon', 'Audio', 'Worker', 'SharedWorker', 'EventSource', 'WebSocket', 'Request', 'Image', 'Option', 'importScripts', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'Reflect', 'Proxy', 'constructor', '__proto__', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'setAttribute', 'setAttributeNS', 'crossOrigin', 'referrerPolicy', 'srcset', 'cookie', 'open', 'write', 'assign', 'replaceState', 'pushState', 'postMessage', 'submit', 'click', 'dispatchEvent', 'focus', 'scrollTo', 'scrollBy', 'scrollIntoView', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'toBlob', 'createObjectURL', 'FileReader', 'createImageBitmap', 'decode', 'href']);
const CHAINES_REFUSEES = /^(fetch|src|srcset|href|sendBeacon|XMLHttpRequest|Worker|Audio|crossOrigin|innerHTML)$/;

function violationsEntete(entete) {
    const v = [], vues = [];
    for (const ligne of entete.split(/\r?\n/)) {
        const d = /^\/\/\s*@(\S+)(?:\s+(.*?))?\s*$/.exec(ligne);
        if (!d) { v.push(`en-tête : ligne qui n'est pas une directive « ${ligne.slice(0, 80)} »`); continue; }
        const [, cle, valeur = ''] = d;
        if (!Object.prototype.hasOwnProperty.call(ENTETE_ADMIS, cle)) { v.push(`en-tête : directive @${cle} hors de la liste fermée`); continue; }
        if (vues.includes(cle)) v.push(`en-tête : @${cle} écrite deux fois`);
        vues.push(cle);
        if (!ENTETE_ADMIS[cle](valeur)) v.push(`en-tête : valeur « ${valeur.slice(0, 80)} » non admise pour @${cle}`);
    }
    for (const cle of ['name', 'version', 'match', 'grant', 'connect']) if (!vues.includes(cle)) v.push(`en-tête : @${cle} absente`);
    return v;
}

function violationsChaine(brut) {
    const v = [];
    if (brut === PREFIXE_PNG) return v;
    const s = brut.split(PREFIXE_LOCAL).join('');
    if (/\/\/|:\/\/|url\(|image-set|@import|[<>]|javascript:|data:/i.test(s)) v.push(`chaîne « ${brut.slice(0, 60)} » : URL, balise ou fonction de chargement`);
    for (const h of s.match(/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || []) if (/[A-Za-z]/.test(h.split('.').pop()) && !HOTES_ADMIS.includes(h)) v.push(`chaîne « ${brut.slice(0, 60)} » : hôte ou fichier « ${h} » hors de la liste admise`);
    if (CHAINES_REFUSEES.test(s)) v.push(`chaîne « ${s} » : nom d'API de chargement`);
    if (/^[a-z-]+:[^ ]/.test(s)) {
        for (const decl of s.split(';').filter(Boolean)) {
            const d = /^([a-z-]+):(.*)$/.exec(decl);
            if (!d || !CSS_OK.includes(d[1]) || !/^[#a-z0-9 ,.%()-]+$/i.test(d[2]) || /url|image-set|expression/i.test(d[2])) v.push(`CSS « ${decl.slice(0, 60)} » : propriété ou valeur hors de la liste admise`);
        }
    }
    return v;
}

function violations(src) {
    const m = /^\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/.exec(src);
    if (!m) return ['en-tête ==UserScript== absent'];
    const v = violationsEntete(m[1]);
    let T;
    try { T = esprima.tokenize(src.slice(m[0].length)); } catch (e) { return [...v, `corps illisible par le lecteur de jetons : ${e.message}`]; }
    let nbGM = 0;
    for (let i = 0; i < T.length; i++) {
        const t = T[i], p = T[i - 1], n = T[i + 1], val = x => (x ? x.value : undefined);
        if (t.type === 'Template') v.push('gabarit de chaîne (backticks) : non admis');
        else if (t.type === 'String') v.push(...violationsChaine(t.value.slice(1, -1)));
        else if (t.type === 'Identifier') {
            if (IDENTIFIANTS_REFUSES.has(t.value)) v.push(`identifiant « ${t.value} » refusé`);
            if (t.value === 'prototype' && !(T[i - 2] && T[i - 2].type === 'Identifier' && T[i - 2].value === 'Array')) v.push('prototype : seulement Array.prototype');
            if (/^GM/.test(t.value)) { if (t.value === 'GM_xmlhttpRequest') nbGM++; else v.push(`identifiant « ${t.value} » : seul GM_xmlhttpRequest est admis`); }
            const apresPoint = p && p.type === 'Punctuator' && p.value === '.';
            if (apresPoint && n && n.type === 'Punctuator' && ['=', '+=', '-=', '*=', '/='].includes(n.value) && !ECRITURES_OK.includes(t.value)) v.push(`écriture de la propriété « .${t.value} » hors de la liste admise`);
            if (apresPoint && n && n.value === '(' && !METHODES_OK.includes(t.value)) v.push(`méthode « .${t.value}( » hors de la liste admise`);
            if (!apresPoint && n && n.value === '(' && !(p && p.type === 'Keyword' && (p.value === 'function' || p.value === 'new')) && !APPELS_NUS_OK.includes(t.value)) {
                const declaree = T.some((x, j) => j > 0 && T[j - 1].type === 'Keyword' && T[j - 1].value === 'function' && x.type === 'Identifier' && x.value === t.value);
                if (!declaree) v.push(`appel « ${t.value}( » : ni fonction déclarée ici ni appel admis`);
            }
            if (!apresPoint && ['location', 'document'].includes(t.value) && n && n.type === 'Punctuator' && n.value === '=') v.push(`affectation de « ${t.value} »`);
            if (t.value === 'createElement' && !(T[i + 1] && T[i + 1].value === '(' && T[i + 2] && T[i + 2].type === 'String' && ELEMENTS_OK.includes(T[i + 2].value.slice(1, -1)))) v.push('createElement : seulement un littéral parmi ' + ELEMENTS_OK.join(', '));
        } else if (t.type === 'Keyword' && t.value === 'new') {
            if (!(n && n.type === 'Identifier' && NEW_OK.includes(n.value))) v.push(`new ${val(n)} : seuls ${NEW_OK.join(', ')} sont admis`);
        } else if (t.type === 'Punctuator' && t.value === '[') {
            const membre = p && (p.type === 'Identifier' || (p.type === 'Punctuator' && (p.value === ')' || p.value === ']')));
            if (membre && !(n && (n.type === 'Identifier' || n.type === 'Numeric') && T[i + 2] && T[i + 2].value === ']')) v.push('accès indexé [..] : seulement un identifiant ou un nombre seul');
        }
    }
    if (nbGM !== 1) v.push(`GM_xmlhttpRequest apparaît ${nbGM} fois dans le code : une seule, l'envoi local`);
    return v;
}

module.exports = { violations, violationsEntete, violationsChaine, MATCH, ENTETE_ADMIS, METHODES_OK, ECRITURES_OK, CSS_OK, ELEMENTS_OK };

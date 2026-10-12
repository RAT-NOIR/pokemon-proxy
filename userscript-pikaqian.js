// ==UserScript==
// @name         Rat-Market — Apprentissage passif PikaQian
// @namespace    rat-market
// @version      1.0
// @description  Un bouton « Apprendre cette page » sur les pages de set que TU ouvres. Au clic seulement, envoie l'adresse et le HTML de la page au récepteur LOCAL (127.0.0.1). Ne navigue jamais, ne clique rien, ne télécharge rien.
// @match        https://pikaqian.com/sets/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

// ============================================================
// PASSIF PAR CONSTRUCTION (décision du testeur, 2026-10-12)
// ============================================================
// « Un bouton sur les pages de set que J'OUVRE MOI-MÊME, aucune navigation automatique. »
// · Au chargement, ce script ne fait qu'AJOUTER un bouton à la page. Aucune requête ne part.
// · Au clic, et SEULEMENT au clic : une requête, vers le récepteur local (recepteur-pikaqian.js, 127.0.0.1), avec deux choses — l'adresse de la page
//   (sans requête ni ancre) et son HTML tel que le navigateur l'a. Ni cookie, ni stockage, ni en-tête du site.
// · Aucune requête vers pikaqian.com ni vers aucun autre hôte (@connect 127.0.0.1 seulement). Aucune image téléchargée.
// · Le script ne navigue jamais, ne clique rien, n'ouvre aucune fenêtre, ne programme aucune action différée.
// Ce que la page ouverte porte en dehors de ses tuiles (les adresses officielles, rares) est lu PAR LE RÉCEPTEUR, avec les fonctions de la production.
// Le test statique (test-userscript-pikaqian.js) refuse toute adresse autre que 127.0.0.1 dans ce fichier.
(function () {
    'use strict';
    var RECEPTEUR = 'http://127.0.0.1:8765/apprendre';
    var PAGE_DE_SET = /^\/sets\/[a-z0-9][a-z0-9.-]{0,30}$/;

    var panneau = document.createElement('div');
    panneau.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:340px;font:13px/1.4 sans-serif;color:#111;background:#fff;border:1px solid #888;border-radius:6px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    var bouton = document.createElement('button');
    bouton.textContent = 'Apprendre cette page';
    bouton.style.cssText = 'cursor:pointer;padding:4px 10px';
    var etat = document.createElement('div');
    etat.style.cssText = 'margin-top:6px;white-space:pre-wrap';
    etat.textContent = 'Rien n\'est envoyé tant que tu ne cliques pas.';
    panneau.appendChild(bouton);
    panneau.appendChild(etat);
    document.body.appendChild(panneau);

    bouton.addEventListener('click', function () {
        if (!PAGE_DE_SET.test(location.pathname)) {
            etat.textContent = 'Cette page n\'est pas la page d\'un set (/sets/<code>) : rien n\'est envoyé.';
            return;
        }
        var url = location.origin + location.pathname;
        var html = document.documentElement.outerHTML;
        bouton.disabled = true;
        etat.textContent = 'Envoi au récepteur local…';
        GM_xmlhttpRequest({
            method: 'POST',
            url: RECEPTEUR,
            headers: { 'Content-Type': 'application/json', 'Origin': location.origin },
            data: JSON.stringify({ url: url, html: html }),
            anonymous: true,
            timeout: 30000,
            onload: function (r) {
                bouton.disabled = false;
                var j = null;
                try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
                if (j && j.ok) {
                    etat.textContent = 'Appris : ' + j.code + '\n' + j.tuilesLues + ' tuiles lues, ' + j.tuilesAuCode + ' au code du set\n' +
                        j.officielles + ' adresse(s) officielle(s) déclarée(s) par la page\nfichier ' + j.fichier;
                } else {
                    etat.textContent = 'Refusé (HTTP ' + r.status + ') : ' + ((j && j.motif) || 'réponse illisible du récepteur');
                }
            },
            onerror: function () {
                bouton.disabled = false;
                etat.textContent = 'Le récepteur ne répond pas : lance-le sur ce poste (voir le mode d\'emploi), puis recommence.';
            },
            ontimeout: function () {
                bouton.disabled = false;
                etat.textContent = 'Le récepteur ne répond pas (délai dépassé) : vérifie qu\'il tourne, puis recommence.';
            }
        });
    });
})();

/*
 * kit/v1/theme.js - puts the person's choice of day or night on the page
 * before it is drawn, so the page never flashes in the other one.
 * Serves: "On every page" (the look). Must not change: it only reads one
 * word ("day" or "night") from this browser and sets one attribute; it is
 * loaded without "defer", before the page body, and holds nothing else.
 */
(function () {
  'use strict';
  try {
    var t = localStorage.getItem('dame.theme');
    if (t === 'day' || t === 'night') { document.documentElement.setAttribute('data-theme', t); }
  } catch (e) { /* no stored choice: the device decides */ }
})();

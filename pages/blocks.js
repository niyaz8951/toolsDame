/*
 * pages/blocks.js - the building blocks page: puts a title and the code under
 * each example, and makes the few moving examples move.
 * Serves: contract 4 (Tool kit). Must not change: the code shown is read from
 * the example itself, so what is shown and what is copied can never differ;
 * it is written to the page as text.
 */
(function () {
  'use strict';

  // Tidy the example's own markup: no blank first line, no common indent.
  function tidy(html) {
    var lines = html.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
    var indent = Math.min.apply(null, lines.filter(function (l) { return l.trim(); }).map(function (l) { return l.match(/^ */)[0].length; }));
    return lines.map(function (l) { return l.slice(indent); }).join('\n');
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-block]'), function (card) {
    var demo = card.querySelector('.hub-block-demo');
    var code = tidy(demo.innerHTML);
    var title = document.createElement('h2');
    title.textContent = card.getAttribute('data-block');
    card.insertBefore(title, card.firstChild);

    var pre = document.createElement('pre');
    pre.className = 'hub-pre';
    pre.textContent = code;
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'dame-btn dame-btn-small';
    copy.textContent = 'Copy the code';
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(code).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy the code'; }, 2000);
      }, function () { copy.textContent = 'Select the code and copy it'; });
    });
    demo.insertAdjacentElement('afterend', pre);
    pre.insertAdjacentElement('afterend', copy);
  });

  // The moving examples.
  Array.prototype.forEach.call(document.querySelectorAll('.dame-toggle button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(b.parentNode.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    });
  });
  var bar = document.querySelector('#bar span');
  if (bar) { bar.style.width = '40%'; }
})();

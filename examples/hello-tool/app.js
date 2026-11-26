/*
 * examples/hello-tool/app.js - the example tool's code.
 * Serves: contract 4 (Tool kit). Must not change: everything the tool knows
 * about the user comes from Dame.ready(); data would go through Dame.table.
 * No address, key or network call.
 */
(function () {
  'use strict';

  var KW_PER_TR = 3.5168525;
  var BTU_PER_KW = 3412.142;

  function $(id) { return document.getElementById(id); }

  Dame.ready().then(function (me) {
    $('who').textContent = 'Hello, ' + me.name + '. Your level on this tool: ' + me.level + '.';
  });

  function show(kw, from) {
    if (from !== 'kw') { $('kw').value = kw ? +kw.toFixed(2) : ''; }
    if (from !== 'tr') { $('tr').value = kw ? +(kw / KW_PER_TR).toFixed(2) : ''; }
    if (from !== 'btu') { $('btu').value = kw ? Math.round(kw * BTU_PER_KW) : ''; }
  }

  $('kw').addEventListener('input', function () { show(parseFloat($('kw').value) || 0, 'kw'); });
  $('tr').addEventListener('input', function () { show((parseFloat($('tr').value) || 0) * KW_PER_TR, 'tr'); });
  $('btu').addEventListener('input', function () { show((parseFloat($('btu').value) || 0) / BTU_PER_KW, 'btu'); });

  $('toast').addEventListener('click', function () { Dame.toast('A message from the tool.'); });

  $('save').addEventListener('click', function () {
    Dame.table('notes').add({ text: 'hello' }).then(function () {
      $('saved').textContent = 'Saved.';
    }, function (err) {
      $('saved').textContent = err.message;
    });
  });
})();

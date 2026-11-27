/*
 * pages/admin-tool-sheet.js - the Data part of a tool's admin page: each table
 * of the tool drawn like a sheet, columns added and removed there, and the
 * form for a new table.
 * Serves: contract 5 (Data). Part of admin/tool.html, loaded before
 * pages/admin-tool.js, which calls init() once and then showTables() and
 * dataForm(). Must not change: saved rows are never read or shown here (the
 * grid is drawn from the column list alone); every change goes through the
 * dame_table_* functions, which check the person's level again.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  // Given by the page: { space, tool, act, load, copy, tables(), setTables(list), typeWords }.
  var c = null;

  function $(id) { return document.getElementById(id); }

  var TYPES = [['text', 'Text (short)'], ['longtext', 'Text (long)'], ['number', 'Number'], ['date', 'Date'],
    ['bool', 'Yes or no'], ['choice', 'One of a list'], ['person', 'A person'], ['json', 'Structured data (json)']];

  // One line of the column form: name, type and, for "one of a list", the choices.
  function columnLine() {
    var line = ui.el('div', 'hub-two hub-colline');
    var name = ui.el('input', 'dame-input');
    name.type = 'text';
    name.maxLength = 41;
    name.autocomplete = 'off';
    name.placeholder = 'column name, for example status';
    name.setAttribute('aria-label', 'Column name');
    var type = ui.el('select', 'dame-input');
    type.setAttribute('aria-label', 'Column type');
    TYPES.forEach(function (t) { var o = ui.el('option', null, t[1]); o.value = t[0]; type.appendChild(o); });
    var choices = ui.el('input', 'dame-input');
    choices.type = 'text';
    choices.placeholder = 'the choices, with commas: open, won, lost';
    choices.setAttribute('aria-label', 'Choices');
    choices.hidden = true;
    type.addEventListener('change', function () { choices.hidden = type.value !== 'choice'; });
    line.appendChild(name);
    line.appendChild(type);
    line.appendChild(choices);
    line.read = function () {
      if (!name.value.trim()) { return null; }
      var col = { name: name.value.trim(), type: type.value };
      if (type.value === 'choice') { col.choices = choices.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
      return col;
    };
    return line;
  }

  // ---- each table drawn like a sheet: a column per field, two made-up example rows.
  // Saved rows are never read here: the grid is built from the column list alone.

  var SHARING_WORDS = { team: 'Team: everyone with the tool sees all rows', private: 'Private: each person sees only his own rows',
    reference: 'Reference: everyone reads, only managers change' };
  var STANDARD = [['id', 'Number of the row'], ['owner', 'Who added it'], ['created_at', 'When it was added'],
    ['updated_at', 'When it was last changed'], ['updated_by', 'Who changed it last']];
  var showStandard = false;   // the five columns the site fills, hidden until asked for
  var lastChange = null;      // { table, kind: 'added' | 'removed', column } after a change from the grid

  function letter(i) {
    var s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) { s = String.fromCharCode(65 + (i - 1) % 26) + s; }
    return s;
  }

  function plainDay(addDays) {
    var d = new Date();
    d.setDate(d.getDate() + addDays);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // A made-up value for row 1 or 2 of a column, by its type. Never a saved value.
  function example(c, row) {
    switch (c.type) {
      case 'number': return row ? '3.5' : '12';
      case 'date': return plainDay(row ? 7 : 0);
      case 'bool': return row ? 'No' : 'Yes';
      case 'choice': return (c.choices && c.choices[Math.min(row, c.choices.length - 1)]) || 'one of the list';
      case 'person': return row ? 'A colleague' : 'You';
      case 'longtext': return row ? 'Another longer note' : 'A longer note, many lines';
      case 'json': return '{ ... }';
      default: return row ? 'More text' : 'Some text';
    }
  }

  // The grid itself. o.columns: the table's own columns; o.onRemove(c) and o.onAdd(): buttons in the head (optional).
  function grid(o) {
    var wrap = ui.el('div', 'hub-grid-wrap');
    var table = ui.el('table', 'hub-grid');
    var cols = o.columns.map(function (c) { return { c: c, own: true }; });
    if (o.standard) { STANDARD.forEach(function (s) { cols.push({ c: { name: s[0], type: s[1] }, own: false }); }); }
    table.setAttribute('aria-label', o.label);

    var head = ui.el('thead');
    var letters = ui.el('tr', 'hub-grid-letters');
    letters.appendChild(ui.el('th', 'hub-grid-corner'));
    cols.forEach(function (x, i) { letters.appendChild(ui.el('th', x.own ? '' : 'is-site', letter(i))); });
    if (o.onAdd) { letters.appendChild(ui.el('th', 'hub-grid-plus')); }
    head.appendChild(letters);

    var names = ui.el('tr', 'hub-grid-names');
    names.appendChild(ui.el('th', 'hub-grid-corner'));
    cols.forEach(function (x) {
      var th = ui.el('th', x.own ? '' : 'is-site');
      th.scope = 'col';
      var top = ui.el('div', 'hub-grid-name');
      top.appendChild(ui.el('span', null, x.c.name));
      if (x.own && o.onRemove) {
        var rm = ui.el('button', 'hub-grid-x', '×');
        rm.type = 'button';
        rm.title = 'Remove the column ' + x.c.name;
        rm.setAttribute('aria-label', 'Remove the column ' + x.c.name);
        if (o.removing === x.c.name) { rm.classList.add('is-on'); }
        rm.addEventListener('click', function () { o.onRemove(x.c); });
        top.appendChild(rm);
      }
      th.appendChild(top);
      var kind = x.own ? (c.typeWords[x.c.type] || x.c.type) : 'Filled by the site';
      var sub = ui.el('div', 'hub-grid-type', kind);
      if (x.c.type === 'choice' && x.c.choices) {
        sub.textContent = 'One of: ' + x.c.choices.join(', ');
        sub.title = sub.textContent;
      }
      if (!x.own) { sub.title = x.c.type; }
      th.appendChild(sub);
      names.appendChild(th);
    });
    if (o.onAdd) {
      var plusCell = ui.el('th', 'hub-grid-plus');
      var plus = ui.el('button', 'dame-btn hub-small' + (o.adding ? ' is-on' : ''), '+ Column');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'Add a column to ' + o.label);
      plus.addEventListener('click', o.onAdd);
      plusCell.appendChild(plus);
      names.appendChild(plusCell);
    }
    head.appendChild(names);
    table.appendChild(head);

    var body = ui.el('tbody');
    [0, 1].forEach(function (row) {
      var tr = ui.el('tr');
      tr.appendChild(ui.el('th', 'hub-grid-corner', String(row + 1)));
      cols.forEach(function (x) {
        var v = x.own ? example(x.c, row)
          : x.c.name === 'id' ? (row ? 'e7d2...' : 'a41f...')
          : /_at$/.test(x.c.name) ? plainDay(0) : 'You';
        tr.appendChild(ui.el('td', x.own ? '' : 'is-site', v));
      });
      if (o.onAdd) { tr.appendChild(ui.el('td', 'hub-grid-plus')); }
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function aiChangeText(change) {
    return change.kind === 'added'
      ? 'I added the column ' + change.column + ' to the table ' + change.table + ' of this tool on the DAME site. Add it to the list of tables in the page (the block with id="dame-tables"), give it a field in the form and a column in the list, and give me the complete index.html again, in one code block, still following every rule of the starter kit.'
      : 'I removed the column ' + change.column + ' from the table ' + change.table + ' of this tool on the DAME site; what was saved in it is gone. Take it out of the list of tables in the page (the block with id="dame-tables"), out of the form, the list and every Dame.table(\'' + change.table + '\') call, and give me the complete index.html again, in one code block, still following every rule of the starter kit. Until then the page cannot save rows in ' + change.table + '.';
  }

  // One change from a grid; on success the page reloads and the table shows what to tell the AI.
  async function gridChange(name, args, done, change) {
    ui.say($('msg'), '');
    try {
      await api.rpc(name, args);
    } catch (err) {
      ui.sayError($('msg'), err);
      $('msg').scrollIntoView({ block: 'nearest' });
      return false;
    }
    lastChange = change;
    await c.load().catch(function () {});
    ui.say($('msg'), done, 'ok');
    $('msg').scrollIntoView({ block: 'nearest' });
    return true;
  }

  function tableBlock(t) {
    var box = ui.el('div', 'hub-block');
    var mode = null;      // null, 'add' or the name of the column being removed
    box.setAttribute('data-table', t.name);
    var title = ui.el('h3', null, t.name + ' ');
    var share = ui.el('span', 'hub-pill', t.sharing);
    share.title = SHARING_WORDS[t.sharing] || '';
    title.appendChild(share);
    title.appendChild(ui.el('span', 'hub-pill', t.rows + (t.rows === 1 ? ' row' : ' rows')));
    title.appendChild(ui.el('span', 'hub-pill', t.preview_rows + ' in the preview'));
    box.appendChild(title);
    box.appendChild(ui.el('p', 'dame-muted hub-grid-note', 'How one row is saved. The grey rows are made-up examples; the ' +
      t.rows + (t.rows === 1 ? ' saved row is' : ' saved rows are') + ' never shown here.'));
    var place = ui.el('div');
    var panel = ui.el('div', 'hub-grid-panel');
    box.appendChild(place);
    box.appendChild(panel);

    function draw() {
      ui.clear(place).appendChild(grid({
        label: t.name, columns: t.columns, standard: showStandard, adding: mode === 'add', removing: mode !== 'add' ? mode : null,
        onAdd: function () { mode = mode === 'add' ? null : 'add'; draw(); },
        onRemove: function (c) { mode = mode === c.name ? null : c.name; draw(); }
      }));
      ui.clear(panel);
      if (lastChange && lastChange.table === t.name && !mode) {
        panel.appendChild(ui.el('p', 'hub-ok', lastChange.kind === 'added'
          ? 'The column ' + lastChange.column + ' is in the table. The tool\'s page does not use it yet: give the AI this request, then upload the new page.'
          : 'The column ' + lastChange.column + ' is removed. The tool\'s page must stop using it, or saving in ' + t.name + ' is refused: give the AI this request, then upload the new page.'));
        var ask = ui.el('button', 'dame-btn dame-btn-primary hub-small', 'Copy the request for the AI');
        ask.type = 'button';
        var change = lastChange;
        ask.addEventListener('click', function () { c.copy(aiChangeText(change), ask, 'Copied. Paste it into the AI.'); });
        panel.appendChild(ask);
      }
      if (mode === 'add') {
        panel.appendChild(ui.el('p', 'hub-sub', 'New column in ' + t.name));
        var line = columnLine();
        panel.appendChild(line);
        var row = ui.el('div', 'dame-row');
        var add = ui.el('button', 'dame-btn dame-btn-primary hub-small', 'Add this column');
        add.type = 'button';
        add.addEventListener('click', async function () {
          var col = line.read();
          if (!col) { ui.say($('msg'), 'Type the name of the new column first.', 'warn'); return; }
          add.disabled = true;
          var ok = await gridChange('dame_table_add_column', { p_space: c.space, p_tool: c.tool, p_table: t.name, p_column: col },
            'The column ' + col.name + ' is added to ' + t.name + '.', { table: t.name, kind: 'added', column: col.name });
          if (!ok) { add.disabled = false; }
        });
        var cancel = ui.el('button', 'dame-btn hub-small', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { mode = null; draw(); });
        row.appendChild(add);
        row.appendChild(cancel);
        panel.appendChild(row);
        line.querySelector('input').focus();
      } else if (mode) {
        var name = mode;
        panel.appendChild(ui.el('p', 'hub-warn', 'Remove the column ' + name + ' from ' + t.name + '? ' +
          (t.rows ? 'The ' + t.rows + (t.rows === 1 ? ' row stays' : ' rows stay') + '; only what is saved in ' + name + ' is deleted, for good. ' : '') +
          'If the tool\'s page still uses this column, it cannot save rows in ' + t.name + ' until the page is updated.'));
        var confirm = ui.el('div', 'dame-row hub-colremove');
        var typed = ui.el('input', 'dame-input hub-grow');
        typed.type = 'text';
        typed.maxLength = 41;
        typed.autocomplete = 'off';
        typed.placeholder = 'To remove, type ' + name;
        typed.setAttribute('aria-label', 'To remove, type ' + name);
        var go = ui.el('button', 'dame-btn hub-small hub-danger', 'Remove the column');
        go.type = 'button';
        go.disabled = true;
        typed.addEventListener('input', function () { go.disabled = typed.value !== name; });
        go.addEventListener('click', async function () {
          go.disabled = true;
          var ok = await gridChange('dame_table_drop_column', { p_space: c.space, p_tool: c.tool, p_table: t.name, p_column: name, p_confirm: typed.value },
            'The column ' + name + ' is removed from ' + t.name + '.', { table: t.name, kind: 'removed', column: name });
          if (!ok) { go.disabled = typed.value !== name; }
        });
        var keep = ui.el('button', 'dame-btn hub-small', 'Keep it');
        keep.type = 'button';
        keep.addEventListener('click', function () { mode = null; draw(); });
        confirm.appendChild(typed);
        confirm.appendChild(go);
        confirm.appendChild(keep);
        panel.appendChild(confirm);
        typed.focus();
      }
    }
    draw();
    box.appendChild(ui.typedDelete(t.name, 'Delete table and its ' + t.rows + (t.rows === 1 ? ' row' : ' rows'), function (typed) {
      c.act('dame_table_drop', { p_space: c.space, p_tool: c.tool, p_table: t.name, p_confirm: typed }, 'The table ' + t.name + ' and its rows are deleted.');
    }));
    return box;
  }

  async function showTables() {
    c.setTables(await api.rpc('dame_tables_list', { p_space: c.space, p_tool: c.tool }) || []);
    drawTables();
  }

  // Draws the tables from the list already loaded (also when the five site columns are shown or hidden).
  function drawTables() {
    var box = ui.clear($('data-tables'));
    c.tables().forEach(function (t) { box.appendChild(tableBlock(t)); });
    $('data-empty').hidden = c.tables().length > 0;
    $('grid-site').hidden = !c.tables().length;
    $('grid-site').textContent = showStandard ? 'Hide the five columns the site fills' : 'Show the five columns the site fills';
  }

  // The new table, drawn as it is typed.
  function newGrid() {
    var cols = Array.prototype.map.call($('tb-columns').children, function (l) { return l.read(); }).filter(Boolean);
    var box = ui.clear($('tb-grid'));
    if (!cols.length) { box.appendChild(ui.el('p', 'dame-muted', 'Type a column name above and the table is drawn here.')); return; }
    box.appendChild(ui.el('p', 'hub-sub', 'This is how ' + ($('tb-name').value.trim() || 'the new table') + ' will look'));
    box.appendChild(grid({ label: $('tb-name').value.trim() || 'the new table', columns: cols, standard: showStandard }));
  }

  function dataForm() {
    $('tb-columns').appendChild(columnLine());
    $('tb-columns').appendChild(columnLine());
    $('form-table').addEventListener('input', newGrid);
    $('form-table').addEventListener('change', newGrid);
    $('tb-more').addEventListener('click', newGrid);
    newGrid();
    $('grid-site').addEventListener('click', function () {
      showStandard = !showStandard;
      lastChange = null;
      drawTables();
      newGrid();
    });
    $('tb-more').addEventListener('click', function () { $('tb-columns').appendChild(columnLine()); });
    $('form-table').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var cols = Array.prototype.map.call($('tb-columns').children, function (l) { return l.read(); }).filter(Boolean);
      var name = $('tb-name').value.trim();
      var before = c.tables().length;
      await c.act('dame_table_create', { p_space: c.space, p_tool: c.tool, p_name: name, p_sharing: $('tb-sharing').value, p_columns: cols },
        'The table ' + name + ' is made. A tool reaches it with Dame.table(\'' + name + '\').');
      if (c.tables().length > before) {
        $('tb-name').value = '';
        ui.clear($('tb-columns'));
        $('tb-columns').appendChild(columnLine());
        $('tb-columns').appendChild(columnLine());
        newGrid();
      }
    });
  }

  window.DameToolSheet = Object.freeze({
    init: function (context) { c = context; },
    showTables: showTables,
    dataForm: dataForm
  });
})();

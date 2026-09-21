(function () {
  var app = window.effractor;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('horizon-dialog'), value = $('horizon-value');
  app.onChange(function () {
    var doc = app.state.doc;
    $('horizon').disabled = !doc;
    $('horizon').textContent = doc ? 'Horizon ' + doc.horizon.toLocaleString('en', { maximumSignificantDigits: 12 }) + ' ' + doc.time_unit + ' ▾' : 'Horizon —';
  });
  $('horizon').addEventListener('click', function () {
    value.value = app.state.doc.horizon;
    $('horizon-unit').textContent = '(' + app.state.doc.time_unit + ')';
    $('horizon-error').textContent = '';
    dialog.showModal(); value.focus(); value.select();
  });
  $('horizon-close').addEventListener('click', function () { dialog.close(); });
  $('horizon-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var edit = window.effractorEdit.setHorizon(app.state.doc, value.value);
    if (!edit) { $('horizon-error').textContent = 'Enter a finite duration'; return; }
    if (edit.doc.horizon === app.state.doc.horizon) { dialog.close(); return; }
    edit.select = app.state.selected; edit.parent = app.state.parent;
    try {
      if (await app.applyEdit(edit)) { dialog.close(); app.say('horizon changed · Ctrl+Z undoes'); }
      else $('horizon-error').textContent = document.getElementById('note').textContent;
    } catch (error) { $('horizon-error').textContent = error.message; app.say(error.message); }
  });
})();

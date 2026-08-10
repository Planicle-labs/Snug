(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initializeSizeGuide() {
    var root = document.getElementById('snug-widget-root');
    if (!root) return;

    var productId = (root.getAttribute('data-product-id') || '').replace(/^gid:\/\/shopify\/Product\//, '');
    var apiKey = root.getAttribute('data-api-key');
    var workerUrl = (root.getAttribute('data-worker-url') || 'https://snug-worker.workers.dev').replace(/\/$/, '');
    if (!productId || !apiKey) return;

    fetch(workerUrl + '/v1/product/' + encodeURIComponent(productId) + '/size-guide', {
      headers: { 'Accept': 'application/json', 'X-Snug-Key': apiKey }
    })
      .then(function (response) { return response.ok ? response.json() : { enabled: false }; })
      .then(function (guide) {
        if (!guide || !guide.enabled || !Array.isArray(guide.rows) || !guide.rows.length) return;
        renderGuide(root, guide);
      })
      .catch(function () { /* A size guide is optional, so fail silently. */ });
  }

  function renderGuide(root, guide) {
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'snug-size-guide-trigger';
    trigger.textContent = 'Size guide';
    root.appendChild(trigger);

    var overlay = document.createElement('div');
    overlay.className = 'snug-size-guide-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<section class="snug-size-guide-dialog" role="dialog" aria-modal="true" aria-label="' + escapeHtml(guide.title) + ' size guide">' +
      '<button type="button" class="snug-size-guide-close" aria-label="Close size guide">×</button>' +
      '<p class="snug-size-guide-kicker">' + escapeHtml(guide.title) + '</p>' +
      '<h2>Size guide</h2>' +
      '<div class="snug-size-guide-unit" role="group" aria-label="Measurement unit"><button type="button" data-unit="cm" class="is-selected">CM</button><button type="button" data-unit="in">IN</button></div>' +
      '<div class="snug-size-guide-table-wrap"></div>' +
      '<p class="snug-size-guide-note">Measurements can vary by up to 1 cm.</p>' +
      '</section>';
    document.body.appendChild(overlay);

    var tableWrap = overlay.querySelector('.snug-size-guide-table-wrap');
    var closeButton = overlay.querySelector('.snug-size-guide-close');
    var lastFocused = null;

    function measurement(value, unit) {
      if (value === null || value === undefined) return '—';
      return unit === 'in' ? (Number(value) / 2.54).toFixed(1) : Number(value).toFixed(Number(value) % 1 ? 1 : 0);
    }

    function renderTable(unit) {
      var hasShoulder = guide.rows.some(function (row) { return row.shoulder !== null && row.shoulder !== undefined; });
      var header = '<tr><th scope="col">Measure</th>' + guide.rows.map(function (row) { return '<th scope="col">' + escapeHtml(row.size) + '</th>'; }).join('') + '</tr>';
      var measurements = [['Chest', 'chest'], ['Length', 'length']];
      if (hasShoulder) measurements.push(['Shoulder', 'shoulder']);
      var body = measurements.map(function (item) {
        return '<tr><th scope="row">' + item[0] + '</th>' + guide.rows.map(function (row) { return '<td>' + measurement(row[item[1]], unit) + '</td>'; }).join('') + '</tr>';
      }).join('');
      tableWrap.innerHTML = '<table><thead>' + header + '</thead><tbody>' + body + '</tbody></table>';
    }

    function closeGuide() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      if (lastFocused) lastFocused.focus();
    }

    trigger.addEventListener('click', function () {
      lastFocused = document.activeElement;
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      closeButton.focus();
    });
    closeButton.addEventListener('click', closeGuide);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeGuide(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && overlay.classList.contains('is-open')) closeGuide(); });
    overlay.querySelectorAll('[data-unit]').forEach(function (button) {
      button.addEventListener('click', function () {
        overlay.querySelectorAll('[data-unit]').forEach(function (control) { control.classList.remove('is-selected'); });
        button.classList.add('is-selected');
        renderTable(button.getAttribute('data-unit'));
      });
    });
    renderTable('cm');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeSizeGuide);
  else initializeSizeGuide();
}());

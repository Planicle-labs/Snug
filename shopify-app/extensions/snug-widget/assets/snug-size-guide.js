(function () {
  'use strict';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initializeSizeGuide() {
    var rootEls = document.querySelectorAll('.snug-widget-wrapper');
    if (!rootEls || !rootEls.length) {
      var singleRoot = document.getElementById('snug-widget-root');
      if (singleRoot) rootEls = [singleRoot];
      else return;
    }

    for (var i = 0; i < rootEls.length; i++) {
      setupSizeGuideInstance(rootEls[i]);
    }
  }

  function setupSizeGuideInstance(root) {
    if (!root || root.hasAttribute('data-snug-guide-initialized')) return;
    root.setAttribute('data-snug-guide-initialized', 'true');

    var productId = (root.getAttribute('data-product-id') || '').replace(/^gid:\/\/shopify\/Product\//, '');
    if (!productId || productId === 'null' || productId === 'undefined') {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
        productId = String(window.ShopifyAnalytics.meta.product.id);
      } else if (window.__st && window.__st.rid) {
        productId = String(window.__st.rid);
      }
    }

    var apiKey = root.getAttribute('data-api-key');
    var shopDomain = root.getAttribute('data-shop-domain') || window.location.hostname;
    var workerUrl = (root.getAttribute('data-worker-url') || 'https://snug-worker.planicle-labs.workers.dev').replace(/\/$/, '');
    if (!productId || !apiKey) return;

    var headers = { 'Accept': 'application/json', 'X-Snug-Key': apiKey };
    if (shopDomain) headers['X-Shop-Domain'] = shopDomain;

    fetch(workerUrl + '/v1/product/' + encodeURIComponent(productId) + '/size-guide', {
      headers: headers
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
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'snug-size-guide-overlay');
    root.appendChild(trigger);

    var overlay = document.getElementById('snug-size-guide-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'snug-size-guide-overlay';
      overlay.className = 'snug-size-guide-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlay);
    }

    var guideTitle = guide.title || 'Product';
    overlay.innerHTML = '<section class="snug-size-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="snug-size-guide-title" tabindex="-1">' +
      '<button type="button" class="snug-size-guide-close" aria-label="Close size guide dialog">×</button>' +
      '<p class="snug-size-guide-kicker">' + escapeHtml(guideTitle) + '</p>' +
      '<h2 id="snug-size-guide-title">Size guide</h2>' +
      '<div class="snug-size-guide-unit" role="group" aria-label="Measurement unit">' +
      '<button type="button" data-unit="cm" class="is-selected" aria-pressed="true">CM</button>' +
      '<button type="button" data-unit="in" aria-pressed="false">IN</button>' +
      '</div>' +
      '<div class="snug-size-guide-table-wrap"></div>' +
      '<p class="snug-size-guide-note">Measurements can vary by up to 1 cm (0.4 in).</p>' +
      '</section>';

    var dialog = overlay.querySelector('.snug-size-guide-dialog');
    var tableWrap = overlay.querySelector('.snug-size-guide-table-wrap');
    var closeButton = overlay.querySelector('.snug-size-guide-close');
    var noteEl = overlay.querySelector('.snug-size-guide-note');
    var lastFocused = null;
    var currentUnit = 'cm';

    function measurement(value, unit) {
      if (value === null || value === undefined || value === '') return '—';
      var num = Number(value);
      if (isNaN(num)) return '—';
      if (unit === 'in') {
        return (num / 2.54).toFixed(1);
      }
      return num % 1 !== 0 ? num.toFixed(1) : num.toFixed(0);
    }

    function renderTable(unit) {
      currentUnit = unit;
      var hasShoulder = guide.rows.some(function (row) { return row.shoulder !== null && row.shoulder !== undefined; });
      var header = '<tr><th scope="col">Measurement (' + unit.toUpperCase() + ')</th>' +
        guide.rows.map(function (row) { return '<th scope="col">' + escapeHtml(row.size) + '</th>'; }).join('') +
        '</tr>';

      var measurements = [['Chest', 'chest'], ['Length', 'length']];
      if (hasShoulder) measurements.push(['Shoulder', 'shoulder']);

      var body = measurements.map(function (item) {
        return '<tr><th scope="row">' + item[0] + '</th>' +
          guide.rows.map(function (row) { return '<td>' + measurement(row[item[1]], unit) + '</td>'; }).join('') +
          '</tr>';
      }).join('');

      tableWrap.innerHTML = '<table><thead>' + header + '</thead><tbody>' + body + '</tbody></table>';

      if (noteEl) {
        noteEl.textContent = unit === 'in'
          ? 'Measurements can vary by up to 0.4 in (1 cm).'
          : 'Measurements can vary by up to 1 cm (0.4 in).';
      }
    }

    function getFocusableElements() {
      if (!overlay) return [];
      var nodes = overlay.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      return Array.prototype.filter.call(nodes, function (node) {
        return node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement;
      });
    }

    function handleKeyNavigation(event) {
      if (!overlay.classList.contains('is-open')) return;

      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        closeGuide();
        return;
      }

      if (event.key === 'Tab' || event.keyCode === 9) {
        var focusables = getFocusableElements();
        if (!focusables.length) return;

        var firstEl = focusables[0];
        var lastEl = focusables[focusables.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === firstEl || document.activeElement === dialog) {
            event.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            event.preventDefault();
            firstEl.focus();
          }
        }
      }
    }

    function openGuide() {
      lastFocused = document.activeElement;
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      trigger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyNavigation);

      if (closeButton) {
        closeButton.focus();
      }
    }

    function closeGuide() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyNavigation);

      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
    }

    trigger.addEventListener('click', openGuide);
    closeButton.addEventListener('click', closeGuide);

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeGuide();
    });

    var unitButtons = overlay.querySelectorAll('[data-unit]');
    unitButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var selectedUnit = button.getAttribute('data-unit');
        unitButtons.forEach(function (control) {
          var isCurrent = control === button;
          control.classList.toggle('is-selected', isCurrent);
          control.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
        });
        renderTable(selectedUnit);
      });
    });

    renderTable('cm');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSizeGuide);
  } else {
    initializeSizeGuide();
  }
}());


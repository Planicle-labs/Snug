(function () {
  'use strict';

  var BRANDS = [
    { v: 'snitch', l: 'Snitch' },
    { v: 'bewakoof', l: 'Bewakoof' },
    { v: 'zara', l: 'Zara' },
    { v: 'hm', l: 'H&M' },
    { v: 'levis', l: "Levi's" },
    { v: 'nike', l: 'Nike' },
    { v: 'uniqlo', l: 'Uniqlo' },
    { v: 'roadster', l: 'Roadster' },
    { v: 'adidas', l: 'Adidas' },
    { v: 'gap', l: 'Gap' },
    { v: 'lululemon', l: 'Lululemon' },
    { v: 'under_armour', l: 'Under Armour' },
    { v: 'ralph_lauren', l: 'Ralph Lauren' }
  ];

  var GARMENTS = [
    { v: 'tshirt', l: 'T-Shirt / Top' },
    { v: 'shirt', l: 'Button-Down Shirt' },
    { v: 'polo', l: 'Polo Shirt' },
    { v: 'hoodie', l: 'Hoodie / Sweatshirt' },
    { v: 'jacket', l: 'Jacket / Coat' },
    { v: 'pants', l: 'Pants / Trousers' },
    { v: 'jeans', l: 'Jeans' },
    { v: 'shorts', l: 'Shorts' }
  ];

  var SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

  function initSnugWidget() {
    var rootEls = document.querySelectorAll('.snug-widget-wrapper');
    if (!rootEls || !rootEls.length) {
      var singleRoot = document.getElementById('snug-widget-root');
      if (singleRoot) rootEls = [singleRoot];
      else return;
    }

    for (var r = 0; r < rootEls.length; r++) {
      setupWidgetInstance(rootEls[r]);
    }
  }

  function setupWidgetInstance(rootEl) {
    if (!rootEl || rootEl.hasAttribute('data-snug-initialized')) return;
    rootEl.setAttribute('data-snug-initialized', 'true');

    var productId = rootEl.getAttribute('data-product-id');
    if (!productId || productId === 'null' || productId === 'undefined') {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
        productId = String(window.ShopifyAnalytics.meta.product.id);
      } else {
        var hiddenInput = document.querySelector('form[action*="/cart/add"] input[name="product-id"]');
        if (hiddenInput && hiddenInput.value) {
          productId = String(hiddenInput.value);
        }
      }
    }

    var shopDomain = rootEl.getAttribute('data-shop-domain') || window.location.hostname;
    var apiKey = rootEl.getAttribute('data-api-key');
    var workerUrl = (rootEl.getAttribute('data-worker-url') || 'https://snug-worker.planicle-labs.workers.dev').replace(/\/$/, '');
    var triggerBtn = rootEl.querySelector('.snug-trigger-btn');

    var widgetConfig = {
      position: 'below_add_to_cart',
      button_text: 'Find Your Perfect Fit',
      button_color: '#008060',
      button_text_color: '#ffffff',
      modal_position: 'center',
      show_confidence: true,
      show_reasoning: true
    };

    var mappedGarmentType = 'tshirt';
    var cleanProductId = productId ? String(productId).replace(/^gid:\/\/shopify\/Product\//, '') : '';
    var lastFocusedElement = null;

    // DB-backed reference coverage (brand x garment x sizes) from
    // GET /v1/reference-options. Reference dropdowns are built exclusively
    // from this data so shoppers can only select combos that resolve in
    // /v1/size. Null until loaded; the trigger stays hidden without it.
    var referenceCoverage = null;
    var REFERENCE_COVERAGE_CACHE_KEY = 'snug-reference-coverage';
    var REFERENCE_COVERAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    function isValidReferenceCoverage(obj) {
      if (!obj || typeof obj !== 'object' || !(obj.brands instanceof Array) || !obj.brands.length) return false;
      for (var i = 0; i < obj.brands.length; i++) {
        var b = obj.brands[i];
        if (!b || typeof b.slug !== 'string' || !b.slug || !(b.garments instanceof Array) || !b.garments.length) return false;
        for (var j = 0; j < b.garments.length; j++) {
          var g = b.garments[j];
          if (!g || typeof g.garment !== 'string' || !g.garment || !(g.sizes instanceof Array) || !g.sizes.length) return false;
        }
      }
      return true;
    }

    function readCachedReferenceCoverage() {
      try {
        if (!window.localStorage) return null;
        var raw = window.localStorage.getItem(REFERENCE_COVERAGE_CACHE_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || !isValidReferenceCoverage(parsed.coverage)) return null;
        if (typeof parsed.cachedAt !== 'number' || (Date.now() - parsed.cachedAt) > REFERENCE_COVERAGE_CACHE_TTL_MS) return null;
        return parsed.coverage;
      } catch (e) {
        return null;
      }
    }

    function writeCachedReferenceCoverage(coverage) {
      try {
        if (window.localStorage) window.localStorage.setItem(REFERENCE_COVERAGE_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), coverage: coverage }));
      } catch (e) {
        /* private mode: in-memory only */
      }
    }

    function findCoverageBrand(slug) {
      if (!referenceCoverage) return null;
      for (var i = 0; i < referenceCoverage.brands.length; i++) {
        if (referenceCoverage.brands[i].slug === slug) return referenceCoverage.brands[i];
      }
      return null;
    }

    function findCoverageGarment(brand, garment) {
      if (!brand || !(brand.garments instanceof Array)) return null;
      for (var i = 0; i < brand.garments.length; i++) {
        if (brand.garments[i].garment === garment) return brand.garments[i];
      }
      return null;
    }

    function setSelectOptions(select, placeholder, options) {
      if (!select) return;
      var html = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
      for (var i = 0; i < options.length; i++) {
        html += '<option value="' + esc(options[i].v) + '">' + esc(options[i].l) + '</option>';
      }
      select.innerHTML = html;
    }

    function populateGarmentSelect(brandSlug, preferredGarment) {
      if (!modalOverlay) return null;
      var garmentSelect = modalOverlay.querySelector('#snug-ref-garment');
      if (!garmentSelect) return null;
      var brand = findCoverageBrand(brandSlug);
      if (!brand) {
        setSelectOptions(garmentSelect, 'Select brand first...', []);
        return null;
      }
      var garmentOpts = brand.garments.map(function (g) { return { v: g.garment, l: g.label || g.garment }; });
      setSelectOptions(garmentSelect, 'Select garment...', garmentOpts);
      var chosen = findCoverageGarment(brand, preferredGarment) ? preferredGarment
        : (brand.garments.length ? brand.garments[0].garment : '');
      if (chosen) garmentSelect.value = chosen;
      return garmentSelect.value || null;
    }

    function populateSizeSelect(brandSlug, garmentValue) {
      if (!modalOverlay) return;
      var sizeSelect = modalOverlay.querySelector('#snug-ref-size');
      if (!sizeSelect) return;
      var garment = findCoverageGarment(findCoverageBrand(brandSlug), garmentValue);
      if (!garment) {
        setSelectOptions(sizeSelect, 'Select garment first...', []);
        return;
      }
      var sizeOpts = garment.sizes.map(function (s) { return { v: s, l: s }; });
      setSelectOptions(sizeSelect, 'Select size...', sizeOpts);
    }

    function applyReferenceCoverage() {
      if (!referenceCoverage || !modalOverlay) return;
      var brandSelect = modalOverlay.querySelector('#snug-ref-brand');
      var garmentSelect = modalOverlay.querySelector('#snug-ref-garment');
      var sizeSelect = modalOverlay.querySelector('#snug-ref-size');
      if (!brandSelect || !garmentSelect || !sizeSelect) return;
      var brandOpts = referenceCoverage.brands.map(function (b) { return { v: b.slug, l: b.name }; });
      var previousBrand = brandSelect.value;
      setSelectOptions(brandSelect, 'Select brand...', brandOpts);
      if (findCoverageBrand(previousBrand)) brandSelect.value = previousBrand;
      populateGarmentSelect(brandSelect.value, garmentSelect.value || mappedGarmentType);
      populateSizeSelect(brandSelect.value, garmentSelect.value);
      if (!brandSelect.hasAttribute('data-snug-cascade-bound')) {
        brandSelect.setAttribute('data-snug-cascade-bound', 'true');
        brandSelect.addEventListener('change', function () {
          var chosenGarment = populateGarmentSelect(brandSelect.value, mappedGarmentType);
          populateSizeSelect(brandSelect.value, chosenGarment);
        });
      }
      if (!garmentSelect.hasAttribute('data-snug-cascade-bound')) {
        garmentSelect.setAttribute('data-snug-cascade-bound', 'true');
        garmentSelect.addEventListener('change', function () {
          populateSizeSelect(brandSelect.value, garmentSelect.value);
        });
      }
    }

    function hideWidgetButton() {
      if (triggerBtn) triggerBtn.style.display = 'none';
    }

    fetchConfigAndMapping();

    function fetchConfigAndMapping() {
      var headers = { 'Accept': 'application/json' };
      if (apiKey) headers['X-Snug-Key'] = apiKey;

      var cachedCoverage = readCachedReferenceCoverage();
      if (cachedCoverage) {
        referenceCoverage = cachedCoverage;
      }

      var configPromise = fetch(workerUrl + '/v1/config', { headers: headers })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });

      var mappingPromise = cleanProductId
        ? fetch(workerUrl + '/v1/product/' + encodeURIComponent(cleanProductId), { headers: headers })
            .then(function (res) { return res.ok ? res.json() : { mapped: false }; })
            .catch(function () { return { mapped: false }; })
        : Promise.resolve({ mapped: true });

      // If coverage is cached, do not block widget rendering on the reference-options fetch
      var coveragePromise = (!referenceCoverage)
        ? fetch(workerUrl + '/v1/reference-options', { headers: headers })
            .then(function (res) { return res.ok ? res.json() : null; })
            .catch(function () { return null; })
        : Promise.resolve(null);

      if (referenceCoverage) {
        fetch(workerUrl + '/v1/reference-options', { headers: headers })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (coverageData) {
            if (isValidReferenceCoverage(coverageData)) {
              referenceCoverage = coverageData;
              writeCachedReferenceCoverage(coverageData);
              applyReferenceCoverage();
            }
          })
          .catch(function () {});
      }

      Promise.all([configPromise, mappingPromise, coveragePromise]).then(function (results) {
        var remoteConfig = results[0];
        var mappingData = results[1];
        var coverageData = results[2];

        if (coverageData && isValidReferenceCoverage(coverageData)) {
          referenceCoverage = coverageData;
          writeCachedReferenceCoverage(coverageData);
        } else if (!referenceCoverage) {
          referenceCoverage = readCachedReferenceCoverage();
        }

        // Fail closed: without DB-backed reference options the widget cannot
        // offer any valid selection, so keep the trigger hidden.
        if (!referenceCoverage) {
          hideWidgetButton();
          return;
        }
        applyReferenceCoverage();

        if (remoteConfig) {
          widgetConfig = Object.assign(widgetConfig, remoteConfig);
        }

        // If product was explicitly looked up and is unmapped or inactive, do not display button
        if (cleanProductId && mappingData && (mappingData.mapped === false || mappingData.is_active === false)) {
          if (triggerBtn) triggerBtn.style.display = 'none';
          return;
        }

        if (mappingData && mappingData.mapped && mappingData.is_active !== false) {
          if (mappingData.garment_type) mappedGarmentType = mappingData.garment_type;
        }

        applyWidgetStyles();
        relocateWidget(rootEl, widgetConfig.position);
        showWidgetButton();
        observeThemeChanges(rootEl, widgetConfig.position);
      }).catch(function () {
        // Fallback for offline or connection failure: only show the trigger
        // when cached DB-backed reference options are available.
        referenceCoverage = readCachedReferenceCoverage();
        if (!referenceCoverage) {
          hideWidgetButton();
          return;
        }
        applyReferenceCoverage();
        applyWidgetStyles();
        relocateWidget(rootEl, widgetConfig.position);
        showWidgetButton();
        observeThemeChanges(rootEl, widgetConfig.position);
      });
    }

    function formatColor(color, fallback) {
      if (!color) return fallback || '';
      var trimmed = String(color).trim();
      if (!trimmed.startsWith('#') && /^[0-9a-fA-F]{3,6}$/.test(trimmed)) {
        return '#' + trimmed;
      }
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : (fallback || '');
    }

    function applyWidgetStyles() {
      if (!triggerBtn) return;
      var bg = formatColor(widgetConfig.button_color, '#008060');
      var textCol = formatColor(widgetConfig.button_text_color, '#ffffff');
      triggerBtn.style.backgroundColor = bg;
      triggerBtn.style.color = textCol;

      var span = triggerBtn.querySelector('.snug-btn-label') || triggerBtn.querySelector('span');
      if (span && widgetConfig.button_text) {
        span.textContent = widgetConfig.button_text;
      }
    }

    function relocateWidget(el, position) {
      if (!position || position === 'as_placed' || !el) return;

      var selectorsMap = {
        below_size_selector: [
          '.product-form__input--variant-picker',
          '.product-form__input--pill',
          'variant-selects',
          'variant-radios',
          '[data-option-selector]',
          '.variant-picker',
          '.product__variants',
          '.product-form__variants',
          '.product-variant-selector',
          'fieldset.product-form__input',
          '.product-form__input'
        ],
        below_add_to_cart: [
          '.product-form__buttons',
          '.product-form__submit',
          'button[name="add"]',
          '.shopify-payment-button',
          '.product-form__cart-submit',
          '.product-form',
          'form[action*="/cart/add"]'
        ],
        below_price: [
          '.price',
          '.product__price',
          '.product-price',
          '[data-product-price]',
          '.price--large',
          '.price__regular'
        ]
      };

      var candidates = selectorsMap[position] || [];

      for (var i = 0; i < candidates.length; i++) {
        var targetNode = document.querySelector(candidates[i]);
        if (targetNode) {
          var container = targetNode.closest('.product-form__buttons') ||
                          targetNode.closest('.product-form') ||
                          targetNode.closest('form[action*="/cart/add"]') ||
                          targetNode;
          if (container && container.parentNode && container !== el && !container.contains(el)) {
            container.parentNode.insertBefore(el, container.nextSibling);
            return;
          }
        }
      }

      // Fallback: If no match from candidates, find any product form or main product area
      var generalForm = document.querySelector('.product-form, form[action*="/cart/add"], .product__info-container, .product-single__meta');
      if (generalForm && generalForm.parentNode && generalForm !== el && !generalForm.contains(el)) {
        generalForm.parentNode.insertBefore(el, generalForm.nextSibling);
      }
    }

    function observeThemeChanges(el, position) {
      if (!position || position === 'as_placed' || !window.MutationObserver) return;

      var debounceTimer = null;
      var observer = new MutationObserver(function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          if (!document.body.contains(el)) return;
          relocateWidget(el, position);
        }, 150);
      });

      var formContainer = document.querySelector('.product-form, form[action*="/cart/add"], .product__info-container, main');
      if (formContainer) {
        observer.observe(formContainer, { childList: true, subtree: false });
      }

      // Also listen to Shopify theme variant change events
      document.addEventListener('variant:change', function () {
        setTimeout(function () { relocateWidget(el, position); }, 50);
      });
    }

    function showWidgetButton() {
      if (triggerBtn) {
        triggerBtn.style.display = 'inline-flex';
        triggerBtn.setAttribute('aria-haspopup', 'dialog');
        triggerBtn.setAttribute('aria-expanded', 'false');
        triggerBtn.setAttribute('aria-controls', 'snug-modal-overlay');
      }
    }

    // Modal management (Shared singleton overlay)
    var modalOverlay = document.getElementById('snug-modal-overlay');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'snug-modal-overlay';
      modalOverlay.className = 'snug-modal-overlay';
      modalOverlay.setAttribute('role', 'presentation');
      modalOverlay.setAttribute('aria-hidden', 'true');
      modalOverlay.innerHTML = buildModalMarkup();
      document.body.appendChild(modalOverlay);
    }

    var closeBtn = modalOverlay.querySelector('.snug-modal-close');
    var fitForm = modalOverlay.querySelector('#snug-fit-form');
    var resultArea = modalOverlay.querySelector('#snug-result-area');
    var modalDialog = modalOverlay.querySelector('.snug-modal-content');

    function buildModalMarkup() {
      var brandOpts = '<option value="">Select brand...</option>' +
        BRANDS.map(function (b) { return '<option value="' + b.v + '">' + b.l + '</option>'; }).join('');

      var garmentOpts = GARMENTS.map(function (g) {
        return '<option value="' + g.v + '">' + g.l + '</option>';
      }).join('');

      var sizeOpts = '<option value="">Select size...</option>' +
        SIZES.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');

      return '<div class="snug-modal-content" role="dialog" aria-modal="true" aria-labelledby="snug-modal-title" tabindex="-1">' +
        '<button type="button" class="snug-modal-close" aria-label="Close fit recommendation dialog">&times;</button>' +
        '<div class="snug-modal-header">' +
        '<h3 id="snug-modal-title" class="snug-modal-title">Find Your Perfect Fit</h3>' +
        '<p class="snug-modal-subtitle">Tell us what fits you best in other brands</p>' +
        '</div>' +
        '<form id="snug-fit-form">' +
        '<div class="snug-form-group">' +
        '<label class="snug-label" for="snug-ref-brand">Brand You Own</label>' +
        '<select id="snug-ref-brand" class="snug-select" required aria-required="true">' + brandOpts + '</select>' +
        '</div>' +
        '<div class="snug-form-group">' +
        '<label class="snug-label" for="snug-ref-garment">Garment Type</label>' +
        '<select id="snug-ref-garment" class="snug-select" required aria-required="true">' + garmentOpts + '</select>' +
        '</div>' +
        '<div class="snug-form-group">' +
        '<label class="snug-label" for="snug-ref-size">Your Size</label>' +
        '<select id="snug-ref-size" class="snug-select" required aria-required="true">' + sizeOpts + '</select>' +
        '</div>' +
        '<button type="submit" class="snug-submit-btn">Calculate My Size</button>' +
        '</form>' +
        '<div id="snug-result-area" aria-live="polite" aria-atomic="true"></div>' +
        '</div>';
    }

    function getFocusableElements() {
      if (!modalOverlay) return [];
      var nodes = modalOverlay.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      return Array.prototype.filter.call(nodes, function (node) {
        return node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement;
      });
    }

    function handleKeyNavigation(e) {
      if (!modalOverlay.classList.contains('snug-active')) return;

      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        closeModal();
        return;
      }

      if (e.key === 'Tab' || e.keyCode === 9) {
        var focusables = getFocusableElements();
        if (!focusables.length) return;

        var firstEl = focusables[0];
        var lastEl = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl || document.activeElement === modalDialog) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    }

    function openModal() {
      lastFocusedElement = document.activeElement;

      var brandSelect = modalOverlay.querySelector('#snug-ref-brand');
      var gSelect = modalOverlay.querySelector('#snug-ref-garment');
      if (referenceCoverage && brandSelect && gSelect) {
        if (!findCoverageBrand(brandSelect.value)) {
          brandSelect.value = referenceCoverage.brands.length ? referenceCoverage.brands[0].slug : '';
        }
        var chosenGarment = populateGarmentSelect(brandSelect.value, gSelect.value || mappedGarmentType);
        populateSizeSelect(brandSelect.value, chosenGarment);
      } else if (gSelect && mappedGarmentType) {
        gSelect.value = mappedGarmentType;
      }

      if (widgetConfig.modal_position === 'bottom_left') {
        modalOverlay.classList.add('snug-modal-bottom-left');
      } else {
        modalOverlay.classList.remove('snug-modal-bottom-left');
      }

      modalOverlay.classList.add('snug-active');
      modalOverlay.setAttribute('aria-hidden', 'false');

      if (triggerBtn) {
        triggerBtn.setAttribute('aria-expanded', 'true');
      }

      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyNavigation);

      var brandSelect = modalOverlay.querySelector('#snug-ref-brand');
      if (brandSelect) {
        setTimeout(function () { brandSelect.focus(); }, 60);
      } else if (closeBtn) {
        closeBtn.focus();
      }
    }

    function closeModal() {
      modalOverlay.classList.remove('snug-active');
      modalOverlay.setAttribute('aria-hidden', 'true');

      if (triggerBtn) {
        triggerBtn.setAttribute('aria-expanded', 'false');
      }

      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyNavigation);

      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
    }

    if (triggerBtn && !triggerBtn.hasAttribute('data-snug-bound')) {
      triggerBtn.setAttribute('data-snug-bound', 'true');
      triggerBtn.addEventListener('click', openModal);
    }

    if (closeBtn && !closeBtn.hasAttribute('data-snug-bound')) {
      closeBtn.setAttribute('data-snug-bound', 'true');
      closeBtn.addEventListener('click', closeModal);
    }

    if (modalOverlay && !modalOverlay.hasAttribute('data-snug-bound')) {
      modalOverlay.setAttribute('data-snug-bound', 'true');
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closeModal();
      });
    }

    var predictionCache = {};

    if (fitForm && !fitForm.hasAttribute('data-snug-bound')) {
      fitForm.setAttribute('data-snug-bound', 'true');
      fitForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var refBrand = modalOverlay.querySelector('#snug-ref-brand').value;
        var refGarment = modalOverlay.querySelector('#snug-ref-garment').value;
        var refSize = modalOverlay.querySelector('#snug-ref-size').value;

        if (!refBrand || !refGarment || !refSize) return;

        var cacheKey = refBrand + ':' + refGarment + ':' + refSize + ':' + cleanProductId;
        if (predictionCache[cacheKey]) {
          renderResult(predictionCache[cacheKey]);
          return;
        }

        renderLoading();

        var headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };
        if (apiKey) headers['X-Snug-Key'] = apiKey;
        if (shopDomain) headers['X-Shop-Domain'] = shopDomain;

        fetch(workerUrl + '/v1/size', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            ref_brand: refBrand,
            ref_garment: refGarment,
            ref_size: refSize,
            shopify_product_id: cleanProductId
          })
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().catch(function () { return {}; }).then(function (errData) {
                var message = errData && errData.message;
                if (res.status === 429) {
                  throw { message: message || 'Monthly recommendation limit reached for this store.' };
                }
                if (res.status === 404) {
                  throw { message: message || 'No size chart matching the selected reference brand was found. Please try another reference brand or check the size guide.' };
                }
                if (res.status === 422) {
                  throw { message: message || 'Sizing data is currently unavailable for this product configuration.' };
                }
                throw { message: message || 'Could not calculate size recommendation. Please try again.' };
              });
            }
            return res.json();
          })
          .then(function (data) {
            predictionCache[cacheKey] = data;
            renderResult(data);
          })
          .catch(function (err) {
            var msg = (err && typeof err.message === 'string' && err.message)
              ? err.message
              : 'Unable to calculate recommendation right now. Please check your connection and try again.';
            renderError(msg);
          });
      });
    }

    function renderLoading() {
      resultArea.innerHTML = '<div style="text-align:center; padding: 24px 12px;" role="status" aria-label="Loading size recommendation">' +
        '<div class="snug-loading-spinner" aria-hidden="true"></div>' +
        '<p style="font-size:13px; font-weight:600; color:#374151; margin-top:12px;">Calculating fit recommendation...</p>' +
        '</div>';
    }

    function renderError(msg) {
      resultArea.innerHTML = '<div class="snug-error-card" role="alert">' +
        '<div class="snug-error-title">Notice</div>' +
        '<div class="snug-error-desc">' + esc(msg) + '</div>' +
        '</div>';
    }

    function renderResult(data) {
      var isBoundary = data.is_boundary_case === true || (data.suggested_sizes && data.suggested_sizes.length > 1);
      var showReasoning = widgetConfig.show_reasoning !== false;

      if (isBoundary) {
        var sizes = data.suggested_sizes || [data.predicted_size || 'M', data.adjacent_size || 'L'];
        var sSnug = sizes[0] || 'M';
        var sRelaxed = sizes[1] || 'L';

        resultArea.innerHTML = '<div class="snug-result-card">' +
          '<div class="snug-boundary-heading">You sit right between two sizes!</div>' +
          '<div class="snug-boundary-subtext">Choose your preferred fit style:</div>' +
          '<div class="snug-boundary-container" id="snug-boundary-selector" role="group" aria-label="Fit style selection">' +
          '<button type="button" class="snug-boundary-option snug-selected" data-fit="snug" aria-pressed="true">' +
          '<span class="snug-fit-size">' + esc(sSnug) + '</span>' +
          '<span class="snug-fit-type">Snug Fit</span>' +
          '</button>' +
          '<button type="button" class="snug-boundary-option" data-fit="relaxed" aria-pressed="false">' +
          '<span class="snug-fit-size">' + esc(sRelaxed) + '</span>' +
          '<span class="snug-fit-type">Relaxed Fit</span>' +
          '</button>' +
          '</div>' +
          '<div class="snug-fit-guidance" id="snug-fit-guidance" aria-live="polite">Selected <strong>' + esc(sSnug) + '</strong> for a snug, form-fitting look.</div>' +
          '</div>';

        var opts = resultArea.querySelectorAll('.snug-boundary-option');
        var guidance = resultArea.querySelector('#snug-fit-guidance');

        function selectFitOption(clickedOption) {
          for (var j = 0; j < opts.length; j++) {
            opts[j].classList.remove('snug-selected');
            opts[j].setAttribute('aria-pressed', 'false');
          }
          clickedOption.classList.add('snug-selected');
          clickedOption.setAttribute('aria-pressed', 'true');

          var isSnug = clickedOption.getAttribute('data-fit') === 'snug';
          if (guidance) {
            guidance.innerHTML = isSnug
              ? 'Selected <strong>' + esc(sSnug) + '</strong> for a snug, form-fitting look.'
              : 'Selected <strong>' + esc(sRelaxed) + '</strong> for a relaxed, comfortable fit.';
          }
        }

        for (var i = 0; i < opts.length; i++) {
          opts[i].addEventListener('click', function () {
            selectFitOption(this);
          });
        }
      } else {
        var size = data.predicted_size || 'M';
        var reasoningHtml = (showReasoning && data.reasoning)
          ? '<p style="font-size:12px; color:#4b5563; margin: 0 0 8px 0;">' + esc(data.reasoning) + '</p>'
          : '';

        resultArea.innerHTML = '<div class="snug-result-card">' +
          '<p style="font-size: 13px; font-weight: 600; color: #6b7280; margin: 0;">Recommended Size for You</p>' +
          '<div class="snug-size-badge" aria-label="Recommended size: ' + esc(size) + '">' + esc(size) + '</div>' +
          reasoningHtml +
          '</div>';
      }
    }

    function esc(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSnugWidget);
  } else {
    initSnugWidget();
  }
})();


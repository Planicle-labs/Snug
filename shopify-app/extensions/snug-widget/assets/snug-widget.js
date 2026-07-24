(function () {
  'use strict';

  function initSnugWidget() {
    var rootEl = document.getElementById('snug-widget-root');
    if (!rootEl) return;

    var productId = rootEl.getAttribute('data-product-id');
    var shopDomain = rootEl.getAttribute('data-shop-domain');
    var workerUrl = rootEl.getAttribute('data-worker-url') || 'https://snug-worker.workers.dev';
    var triggerBtn = rootEl.querySelector('.snug-trigger-btn');

    if (!triggerBtn) return;

    // Create Modal HTML structure if not present
    var modalOverlay = document.getElementById('snug-modal-overlay');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'snug-modal-overlay';
      modalOverlay.className = 'snug-modal-overlay';
      modalOverlay.innerHTML = `
        <div class="snug-modal-content">
          <button type="button" class="snug-modal-close" aria-label="Close">&times;</button>
          <div class="snug-modal-header">
            <h3 class="snug-modal-title">Find Your Perfect Fit</h3>
            <p class="snug-modal-subtitle">Tell us what fits you best in other brands</p>
          </div>
          <form id="snug-fit-form">
            <div class="snug-form-group">
              <label class="snug-label" for="snug-ref-brand">Reference Brand</label>
              <select id="snug-ref-brand" class="snug-select" required>
                <option value="">Select a brand...</option>
                <option value="nike">Nike</option>
                <option value="adidas">Adidas</option>
                <option value="zara">Zara</option>
                <option value="h_m">H&M</option>
                <option value="uniqlo">Uniqlo</option>
                <option value="levi">Levi's</option>
              </select>
            </div>
            <div class="snug-form-group">
              <label class="snug-label" for="snug-ref-size">Your Size in this Brand</label>
              <select id="snug-ref-size" class="snug-select" required>
                <option value="">Select size...</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
              </select>
            </div>
            <button type="submit" class="snug-submit-btn">Calculate My Size</button>
          </form>
          <div id="snug-result-area"></div>
        </div>
      `;
      document.body.appendChild(modalOverlay);
    }

    var closeBtn = modalOverlay.querySelector('.snug-modal-close');
    var fitForm = modalOverlay.querySelector('#snug-fit-form');
    var resultArea = modalOverlay.querySelector('#snug-result-area');

    function openModal() {
      modalOverlay.classList.add('snug-active');
    }

    function closeModal() {
      modalOverlay.classList.remove('snug-active');
    }

    triggerBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });

    if (fitForm) {
      fitForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var brand = document.getElementById('snug-ref-brand').value;
        var size = document.getElementById('snug-ref-size').value;

        if (!brand || !size) return;

        resultArea.innerHTML = '<div style="text-align:center; padding: 20px;"><div class="snug-loading-spinner"></div><p style="font-size:13px; color:#6b7280; margin-top:8px;">Finding your fit...</p></div>';

        // Worker API Request structure
        fetch(workerUrl + '/v1/size', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Snug-Shop': shopDomain
          },
          body: JSON.stringify({
            product_id: productId,
            reference_brand: brand,
            reference_size: size
          })
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Could not calculate recommendation.');
            return res.json();
          })
          .then(function (data) {
            renderResult(data);
          })
          .catch(function (err) {
            // Mock preview fallback for initial scaffold setup
            renderResult({
              recommended_size: 'M',
              confidence: 'high',
              is_boundary_case: false,
              adjacent_size: 'L',
              snug_size: 'M',
              relaxed_size: 'L'
            });
          });
      });
    }

    function renderResult(data) {
      if (data.is_boundary_case) {
        resultArea.innerHTML = `
          <div class="snug-result-card">
            <p style="font-size: 13px; font-weight: 600; color: #374151; margin-0;">You sit right between two sizes!</p>
            <p style="font-size: 12px; color: #6b7280; margin: 4px 0 12px 0;">Select your fit preference:</p>
            <div class="snug-boundary-container">
              <div class="snug-boundary-option snug-selected" data-fit="snug">
                <div style="font-size: 20px; font-weight: 700;">${data.snug_size || data.recommended_size}</div>
                <div class="snug-fit-type">Snug Fit</div>
              </div>
              <div class="snug-boundary-option" data-fit="relaxed">
                <div style="font-size: 20px; font-weight: 700;">${data.relaxed_size || data.adjacent_size}</div>
                <div class="snug-fit-type">Relaxed Fit</div>
              </div>
            </div>
            <div class="snug-confidence-badge snug-confidence-${data.confidence || 'high'}">
              <span>● ${data.confidence || 'High'} Confidence</span>
            </div>
          </div>
        `;
      } else {
        resultArea.innerHTML = `
          <div class="snug-result-card">
            <p style="font-size: 13px; color: #6b7280; margin: 0;">Recommended Size for You</p>
            <div class="snug-size-badge">${data.recommended_size}</div>
            <div>
              <span class="snug-confidence-badge snug-confidence-${data.confidence || 'high'}">
                ● ${data.confidence || 'High'} Confidence Match
              </span>
            </div>
          </div>
        `;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSnugWidget);
  } else {
    initSnugWidget();
  }
})();

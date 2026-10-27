/**
 * app.js — navigation, screen state, validation, and event wiring.
 *
 * This file calls API.* for data and UI.* for drawing. It does not build SQL
 * and it does not know how the rows are stored.
 *
 * The cart total is a preview. Checkout sends SKUs and quantities only.
 * The server prices the sale. The confirmation shows that result.
 */
'use strict';

const App = (function () {
  const STATE_NAMES = {
    TX: 'Texas',
    GA: 'Georgia',
    NY: 'New York',
    CO: 'Colorado',
    FL: 'Florida',
    CA: 'California',
    IL: 'Illinois',
    WA: 'Washington',
    AZ: 'Arizona',
    NC: 'North Carolina'
  };

  const state = {
    stores: [],
    products: [],
    accounts: [],
    inventory: [],
    counts: [],
    countsPending: true,
    countsMessage: '',
    cart: [],
    checkingOut: false,
    reportId: '',
    reportReady: false,
    feed: [],
    simRunning: false,
    simController: null
  };

  let inventoryRequest = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return UI.escapeHtml(value);
  }

  // Same cent rounding as api.js, so the preview matches the receipt.
  function toCents(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100);
  }

  function fromCents(cents) {
    return cents / 100;
  }

  function lineTotal(unitPrice, amount) {
    return fromCents(Math.round(toCents(unitPrice) * Number(amount)));
  }

  function roundQty(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  }

  function localDateInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localDateTimeInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${localDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function isPositiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0;
  }

  function isPositiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  async function callApi(fn) {
    try {
      const result = await fn();
      if (result && result.sql) UI.logSql(result.sql, result.ms);
      return result;
    } catch (err) {
      if (err && err.sql) UI.logSql(err.sql, err.ms);
      throw err;
    }
  }

  function selectedStore() {
    const id = Number(el('store-select').value);
    return state.stores.find((store) => store.store_id === id) || null;
  }

  function selectedProduct() {
    const sku = el('product-select').value;
    return state.products.find((product) => product.sku === sku) || null;
  }

  function payMethod() {
    return el('pay-card').checked ? 'card' : 'cash';
  }

  function maskAccount(number) {
    const text = String(number || '');
    return `••••${text.slice(-4)}`;
  }

  function unitPrice(product, store) {
    if (!product) return 0;
    if (store && product.prices_by_state && product.prices_by_state[store.state] != null) {
      return product.prices_by_state[store.state];
    }
    return product.price;
  }

  function stockFor(sku) {
    return state.inventory.find((row) => row.sku === sku) || null;
  }

  function reservedAmount(sku) {
    const line = state.cart.find((item) => item.sku === sku);
    if (!line) return 0;
    return line.sold_by_weight ? line.weight : line.quantity;
  }

  function previewTotals() {
    const store = selectedStore();
    const rate = store && Number.isFinite(Number(store.tax_rate)) ? Number(store.tax_rate) : null;
    let taxableCents = 0;
    let exemptCents = 0;
    state.cart.forEach((line) => {
      const cents = toCents(line.line_total);
      if (line.tax_treatment === 'taxable') taxableCents += cents;
      else exemptCents += cents;
    });
    const subtotalCents = taxableCents + exemptCents;
    const taxCents = rate == null ? null : Math.round(taxableCents * rate);
    return {
      subtotal: fromCents(subtotalCents),
      taxable: fromCents(taxableCents),
      exempt: fromCents(exemptCents),
      tax: taxCents == null ? null : fromCents(taxCents),
      tax_rate: rate,
      total: taxCents == null ? fromCents(subtotalCents) : fromCents(subtotalCents + taxCents)
    };
  }

  function decorateColumns(columns) {
    return (columns || []).map((column) => {
      const copy = {
        key: column.key,
        label: column.label,
        align: column.align
      };
      if (column.format === 'money') copy.format = UI.formatMoney;
      else if (column.format === 'percent') copy.format = UI.formatPercent;
      else if (column.format === 'number') copy.format = UI.formatNumber;
      else if (typeof column.format === 'function') copy.format = column.format;
      return copy;
    });
  }

  // ----- reference data ---------------------------------------------------

  function fillStoreSelect() {
    const select = el('store-select');
    const current = select.value;
    const options = ['<option value="">Select a store</option>'].concat(state.stores.map((store) => (
      `<option value="${store.store_id}">${escapeHtml(store.store_name)} — ${escapeHtml(store.address)} (${escapeHtml(store.state)})</option>`
    )));
    select.innerHTML = options.join('');
    const stillThere = state.stores.some((store) => String(store.store_id) === current);
    select.value = stillThere ? current : '';
    if (!stillThere && state.cart.length) {
      state.cart = [];
      UI.toast('Cart cleared because the selected store is no longer available.', 'info');
    }
    renderStoreMeta();
  }

  function fillProductSelect() {
    const select = el('product-select');
    const current = select.value;
    const query = el('product-search').value.trim().toLowerCase();
    const products = state.products.filter((product) => {
      if (!query) return true;
      return product.sku.toLowerCase().includes(query) || product.product_name.toLowerCase().includes(query);
    });
    if (!products.length) {
      select.innerHTML = '<option value="">No matching products</option>';
    } else {
      select.innerHTML = products.map((product) => (
        `<option value="${escapeHtml(product.sku)}">${escapeHtml(product.sku)} — ${escapeHtml(product.product_name)}</option>`
      )).join('');
    }
    const stillThere = products.some((product) => product.sku === current);
    if (stillThere) select.value = current;
    else if (products.length === 1) select.value = products[0].sku;
    else select.value = products[0] ? products[0].sku : '';
    // A search that still contains the previous product should keep it selected.
    if (stillThere) select.value = current;
    renderProductMeta();
  }

  function fillAccountSelect() {
    const select = el('account-select');
    const current = select.value;
    const options = ['<option value="">Choose an account</option>'].concat(state.accounts.map((account) => (
      `<option value="${account.account_id}">${escapeHtml(account.account_holder_name)} — ${maskAccount(account.account_number)} — ${UI.formatMoney(account.account_balance)}</option>`
    )));
    select.innerHTML = options.join('');
    const stillThere = state.accounts.some((account) => String(account.account_id) === current);
    select.value = stillThere ? current : '';
    renderAccountHint();
  }

  function renderCounts() {
    const list = el('admin-counts');
    if (state.countsPending || !state.counts.length) {
      list.innerHTML = `<li>${escapeHtml(state.countsMessage || 'Row counts have not loaded.')}</li>`;
      return;
    }
    list.innerHTML = state.counts.map((row) => (
      `<li><span class="font-medium">${escapeHtml(row.table)}</span>: ${row.rows} row${row.rows === 1 ? '' : 's'}</li>`
    )).join('');
  }

  function repriceCart() {
    const store = selectedStore();
    if (!store) return;
    state.cart.forEach((line) => {
      const product = state.products.find((item) => item.sku === line.sku);
      if (!product) return;
      line.product_name = product.product_name;
      line.tax_treatment = product.tax_treatment;
      line.sold_by_weight = product.sold_by_weight;
      line.unit_price = unitPrice(product, store);
      const amount = line.sold_by_weight ? line.weight : line.quantity;
      line.line_total = lineTotal(line.unit_price, amount);
    });
  }

  async function loadInventory() {
    const request = ++inventoryRequest;
    const store = selectedStore();
    if (!store) {
      state.inventory = [];
      renderProductMeta();
      return;
    }
    try {
      const result = await callApi(() => API.getInventory(store.store_id));
      if (request !== inventoryRequest) return;
      state.inventory = result.data;
      renderProductMeta();
    } catch (err) {
      if (request !== inventoryRequest) return;
      state.inventory = [];
      UI.toast(err.message || 'Inventory lookup failed.', 'error');
    }
  }

  async function reloadReference() {
    await callApi(() => API.health());
    const [stores, products, accounts, counts] = await Promise.all([
      callApi(() => API.getStores()),
      callApi(() => API.getProducts()),
      callApi(() => API.getBankAccounts()),
      callApi(() => API.getRowCounts())
    ]);
    state.stores = stores.data;
    syncStoreLimit();
    state.products = products.data;
    state.accounts = accounts.data;
    state.counts = counts.data.counts || [];
    state.countsPending = Boolean(counts.data.pending);
    state.countsMessage = counts.data.message || '';
    const skus = new Set(state.products.map((product) => product.sku));
    const before = state.cart.length;
    state.cart = state.cart.filter((line) => skus.has(line.sku));
    fillStoreSelect();
    fillProductSelect();
    fillAccountSelect();
    renderCounts();
    repriceCart();
    renderCart();
    await loadInventory();
    if (before && state.cart.length !== before) {
      UI.toast('Some cart items were removed because those products are gone.', 'info');
    }
  }

  // ----- front desk -------------------------------------------------------

  function renderStoreMeta() {
    const store = selectedStore();
    const meta = el('store-meta');
    if (!store) {
      meta.textContent = 'Choose a store. Tax comes from that store\'s state. The product price is the unit price in PostgreSQL.';
      return;
    }
    const name = STATE_NAMES[store.state] || store.state;
    const rate = store.tax_rate == null ? 'tax rate unavailable' : `tax rate ${UI.formatPercent(store.tax_rate)}`;
    meta.textContent = `${store.address} · ${name} · ${rate}`;
  }

  function renderProductMeta() {
    const product = selectedProduct();
    const meta = el('product-meta');
    const byWeight = Boolean(product && product.sold_by_weight);
    el('weight-field').classList.toggle('hidden', !byWeight);
    el('qty-field').classList.toggle('hidden', byWeight && Boolean(product));
    if (!product) {
      meta.textContent = 'Search, or pick a product from the list.';
      return;
    }
    const store = selectedStore();
    const price = unitPrice(product, store);
    const parts = [
      product.category,
      product.tax_treatment === 'taxable' ? 'Taxable' : 'Tax exempt',
      product.sold_by_weight ? `${UI.formatMoney(price)} per lb` : UI.formatMoney(price)
    ];
    const stock = stockFor(product.sku);
    if (!store) parts.push('Select a store to see stock');
    else if (!stock) parts.push('Not stocked at this store');
    else if (product.sold_by_weight) parts.push(`In stock: ${stock.available_quantity} lb · aisle ${stock.aisle_number}`);
    else parts.push(`In stock: ${stock.available_quantity} · aisle ${stock.aisle_number}`);
    meta.textContent = parts.join(' · ');
  }

  function renderTotals() {
    const panel = el('totals-panel');
    if (!state.cart.length) {
      panel.innerHTML = '<p class="text-slate-500">Add items to see subtotal, tax, and total.</p>';
      return;
    }
    const store = selectedStore();
    const totals = previewTotals();
    const rateKnown = totals.tax_rate != null;
    const rateLabel = !store
      ? 'select a store'
      : rateKnown
        ? `${store.state} ${UI.formatPercent(totals.tax_rate)}`
        : 'rate unavailable';
    const taxValue = rateKnown ? UI.formatMoney(totals.tax) : '—';
    const totalLabel = rateKnown ? 'Total' : 'Total before tax';
    panel.innerHTML = `
      <div class="flex justify-between gap-3"><dt>Subtotal</dt><dd>${UI.formatMoney(totals.subtotal)}</dd></div>
      <div class="flex justify-between gap-3"><dt>Taxable</dt><dd>${UI.formatMoney(totals.taxable)}</dd></div>
      <div class="flex justify-between gap-3"><dt>Tax-exempt</dt><dd>${UI.formatMoney(totals.exempt)}</dd></div>
      <div class="flex justify-between gap-3"><dt>Tax (${escapeHtml(rateLabel)})</dt><dd>${escapeHtml(taxValue)}</dd></div>
      <div class="flex justify-between gap-3 border-t border-slate-200 pt-2 text-base font-semibold"><dt>${totalLabel}</dt><dd>${UI.formatMoney(totals.total)}</dd></div>`;
  }

  function renderCart() {
    UI.showError('checkout-error', '');
    const body = el('cart-body');
    if (!state.cart.length) {
      body.innerHTML = '<tr><td colspan="7" class="px-2 py-3 text-slate-500">Cart is empty. Add a product, or use Add 10–20 random items.</td></tr>';
    } else {
      body.innerHTML = state.cart.map((line, index) => {
        const measure = line.sold_by_weight ? `${Number(line.weight).toFixed(2)} lb` : String(line.quantity);
        const unit = line.sold_by_weight ? `${UI.formatMoney(line.unit_price)}/lb` : UI.formatMoney(line.unit_price);
        return `<tr class="border-t border-slate-100">
          <td class="px-2 py-2">${index + 1}</td>
          <td class="px-2 py-2">${escapeHtml(line.sku)}</td>
          <td class="px-2 py-2">${escapeHtml(line.product_name)}</td>
          <td class="px-2 py-2">${escapeHtml(measure)}</td>
          <td class="px-2 py-2 text-right">${unit}</td>
          <td class="px-2 py-2 text-right">${UI.formatMoney(line.line_total)}</td>
          <td class="px-2 py-2 text-right">
            <button type="button" class="text-sm font-medium text-red-700 underline decoration-red-200" data-remove-sku="${escapeHtml(line.sku)}">Remove</button>
          </td>
        </tr>`;
      }).join('');
    }
    renderTotals();
    renderAccountHint();
  }

  function renderAccountHint() {
    const balance = el('account-balance');
    const warning = el('account-warning');
    warning.classList.add('hidden');
    warning.textContent = '';
    if (payMethod() !== 'card') {
      balance.textContent = '';
      return;
    }
    const account = state.accounts.find((item) => String(item.account_id) === el('account-select').value);
    if (!account) {
      balance.textContent = 'Choose the account that will be charged.';
      return;
    }
    balance.textContent = `Available balance: ${UI.formatMoney(account.account_balance)}`;
    if (!state.cart.length) return;
    const total = previewTotals().total;
    if (toCents(account.account_balance) < toCents(total)) {
      warning.textContent = `This sale is ${UI.formatMoney(total)}. The balance does not cover it. Checkout cannot record a decline until the payment endpoint exists.`;
      warning.classList.remove('hidden');
    }
  }

  function addLine(product, quantity, weight) {
    const store = selectedStore();
    const price = unitPrice(product, store);
    const existing = state.cart.find((line) => line.sku === product.sku);
    if (existing) {
      if (product.sold_by_weight) existing.weight = roundQty(existing.weight + weight);
      else existing.quantity += quantity;
      const amount = existing.sold_by_weight ? existing.weight : existing.quantity;
      existing.line_total = lineTotal(existing.unit_price, amount);
      return;
    }
    const amount = product.sold_by_weight ? weight : quantity;
    state.cart.push({
      sku: product.sku,
      product_name: product.product_name,
      tax_treatment: product.tax_treatment,
      sold_by_weight: product.sold_by_weight,
      quantity: product.sold_by_weight ? null : quantity,
      weight: product.sold_by_weight ? weight : null,
      unit_price: price,
      line_total: lineTotal(price, amount)
    });
  }

  function onAddItem(event) {
    if (event) event.preventDefault();
    UI.showError('add-error', '');
    const store = selectedStore();
    const product = selectedProduct();
    if (!store) {
      UI.showError('add-error', 'Add to cart failed: choose a store first. Stock and tax depend on the store.');
      return;
    }
    if (!product) {
      UI.showError('add-error', 'Add to cart failed: choose a product.');
      return;
    }
    const stock = stockFor(product.sku);
    if (!stock) {
      UI.showError('add-error', `Add to cart failed: ${product.product_name} is not stocked at ${store.store_name}.`);
      return;
    }
    const already = reservedAmount(product.sku);
    if (product.sold_by_weight) {
      if (!isPositiveNumber(el('weight-input').value)) {
        UI.showError('add-error', `Add to cart failed: ${product.product_name} is sold by weight. Enter a weight greater than 0.`);
        return;
      }
      const weight = roundQty(el('weight-input').value);
      if (already + weight > stock.available_quantity + 1e-9) {
        UI.showError('add-error', `Add to cart failed: ${product.product_name} has ${stock.available_quantity} lb at this store, and the cart already holds ${already} lb.`);
        return;
      }
      addLine(product, null, weight);
    } else {
      if (!isPositiveInt(el('qty-input').value)) {
        UI.showError('add-error', `Add to cart failed: quantity for ${product.product_name} must be a positive whole number.`);
        return;
      }
      const quantity = Number(el('qty-input').value);
      if (already + quantity > stock.available_quantity) {
        UI.showError('add-error', `Add to cart failed: ${product.product_name} has ${stock.available_quantity} left at this store, and the cart already holds ${already}.`);
        return;
      }
      addLine(product, quantity, null);
    }
    renderCart();
  }

  function onRandomItems() {
    UI.showError('add-error', '');
    const store = selectedStore();
    if (!store) {
      UI.showError('add-error', 'Random items failed: choose a store first.');
      return;
    }
    if (!state.products.length) {
      UI.showError('add-error', 'Random items failed: the product list has not loaded.');
      return;
    }
    const wanted = 10 + Math.floor(Math.random() * 11);
    const candidates = state.products.filter((product) => {
      const stock = stockFor(product.sku);
      if (!stock || stock.available_quantity <= 0) return false;
      const already = reservedAmount(product.sku);
      if (product.sold_by_weight) return stock.available_quantity - already >= 0.25;
      return stock.available_quantity - already >= 1;
    });
    if (!candidates.length) {
      UI.showError('add-error', 'Random items failed: nothing else is in stock at this store.');
      return;
    }
    const pool = candidates.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
    const picked = pool.slice(0, Math.min(wanted, pool.length));
    picked.forEach((product) => {
      const stock = stockFor(product.sku);
      const already = reservedAmount(product.sku);
      if (product.sold_by_weight) {
        const room = stock.available_quantity - already;
        const steps = Math.max(1, Math.floor(Math.min(room, 2) / 0.25));
        const weight = roundQty((1 + Math.floor(Math.random() * steps)) * 0.25);
        addLine(product, null, Math.min(weight, roundQty(room)));
      } else {
        const room = stock.available_quantity - already;
        const quantity = 1 + Math.floor(Math.random() * Math.min(2, room));
        addLine(product, quantity, null);
      }
    });
    renderCart();
    if (picked.length < 10) {
      UI.toast(`Only ${picked.length} products had stock left, so the cart was filled with those.`, 'info');
    } else {
      UI.toast(`Added ${picked.length} random items.`, 'success');
    }
  }

  function validateCheckout() {
    const problems = [];
    if (!selectedStore()) problems.push('Choose a store.');
    if (!state.cart.length) problems.push('The cart is empty.');
    state.cart.forEach((line) => {
      if (line.sold_by_weight) {
        if (!isPositiveNumber(line.weight)) {
          problems.push(`${line.product_name}: weight must be a number greater than 0.`);
        }
      } else if (!isPositiveInt(line.quantity)) {
        problems.push(`${line.product_name}: quantity must be a positive whole number.`);
      }
    });
    if (payMethod() === 'card' && !el('account-select').value) {
      problems.push('Card is selected, but no bank account is chosen.');
    }
    return problems;
  }

  async function onCheckout(event) {
    event.preventDefault();
    UI.showError('checkout-error', '');
    if (state.simRunning) {
      UI.showError('checkout-error', 'Checkout did not run: a simulation is in progress. Press Stop first.');
      return;
    }
    if (state.checkingOut) return;
    const problems = validateCheckout();
    if (problems.length) {
      UI.showError('checkout-error', `Checkout failed before the server call: ${problems.join(' ')}`);
      return;
    }
    const store = selectedStore();
    const method = payMethod();
    const payload = {
      store_id: store.store_id,
      payment_method: method,
      account_id: method === 'card' ? Number(el('account-select').value) : null,
      items: state.cart.map((line) => (
        line.sold_by_weight
          ? { sku: line.sku, weight: line.weight }
          : { sku: line.sku, quantity: line.quantity }
      ))
    };
    state.checkingOut = true;
    el('checkout-btn').disabled = true;
    el('checkout-btn').textContent = 'Checking out…';
    clearReceipt();
    let presented = false;
    try {
      const result = await callApi(() => API.checkout(payload));
      const data = result.data;
      let heldError = '';
      if (data.saved === true && data.payment_status === 'approved') {
        renderReceipt(data, result.ms, method);
        presented = true;
        state.cart = [];
        renderCart();
        const receiptLabel = data.receipt_id == null ? 'Sale approved.' : `Sale approved. Receipt ${data.receipt_id}.`;
        UI.toast(`${receiptLabel} Transaction time ${result.ms} ms.`, 'success');
      } else if (data.saved === false) {
        renderReceipt(data, result.ms, method);
        presented = true;
        renderCart();
        const reason = typeof data.message === 'string' && data.message
          ? data.message
          : 'Payment was not approved.';
        UI.toast(`Payment declined. ${reason}. No receipt was saved. Transaction time ${result.ms} ms.`, 'error');
      } else {
        heldError = typeof data.message === 'string' && data.message
          ? data.message
          : 'Checkout returned an unexpected response.';
        UI.toast(heldError, 'error');
      }
      await reloadReference();
      if (heldError) UI.showError('checkout-error', heldError);
    } catch (err) {
      if (!presented) clearReceipt();
      UI.showError('checkout-error', err.message || 'Checkout failed.');
      UI.toast(err.message || 'Checkout failed.', 'error');
    } finally {
      state.checkingOut = false;
      el('checkout-btn').disabled = false;
      el('checkout-btn').textContent = 'Checkout';
    }
  }

  function clearReceipt() {
    const view = el('receipt-view');
    view.classList.add('hidden');
    view.innerHTML = '';
  }

  function methodLabel(method) {
    if (method === 'cash') return 'Cash';
    if (method === 'card') return 'Card';
    return method ? String(method) : '';
  }

  function receiptHtml(data, ms, paymentMethod) {
    if (!data || typeof data.saved !== 'boolean') {
      return '<p class="text-sm text-slate-600">This result does not include a checkout receipt.</p>';
    }
    const timing = ms == null ? '' : `<p class="mt-2 text-sm text-slate-600">Transaction time: ${ms} ms</p>`;
    const method = methodLabel(paymentMethod);
    if (data.saved === false) {
      const reason = typeof data.message === 'string' && data.message
        ? data.message
        : 'Payment was not approved.';
      return `
        <h3 class="text-sm font-semibold text-slate-800">Checkout</h3>
        <p class="mt-2 rounded-md px-3 py-2 text-sm font-semibold bg-red-50 text-red-800 border border-red-200">Payment declined</p>
        <p class="mt-2 text-sm text-red-800">${escapeHtml(reason)}. No receipt was saved, and the cart was kept.</p>
        <dl class="mt-3 space-y-1 text-sm">
          <div class="flex justify-between gap-3"><dt>Payment method</dt><dd>${escapeHtml(method)}</dd></div>
        </dl>
        ${timing}`;
    }
    const approved = data.payment_status === 'approved';
    const statusClass = approved
      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
      : 'bg-slate-50 text-slate-800 border border-slate-200';
    const statusText = approved ? 'Purchase approved' : escapeHtml(data.payment_status || 'Saved');
    const store = selectedStore();
    const storeRow = store
      ? `<div class="flex justify-between gap-3"><dt>Store</dt><dd class="text-right">${escapeHtml(store.store_name || '')}</dd></div>`
      : '';
    const lookup = data.receipt_id == null
      ? ''
      : `<button type="button" data-lookup-receipt="${escapeHtml(data.receipt_id)}" class="mt-3 text-sm font-medium text-emerald-800 underline">Open this receipt in Back Office</button>`;
    return `
      <h3 class="text-sm font-semibold text-slate-800">Receipt</h3>
      <p class="mt-2 rounded-md px-3 py-2 text-sm font-semibold ${statusClass}">${statusText}</p>
      <dl class="mt-3 space-y-1 text-sm">
        <div class="flex justify-between gap-3"><dt>Receipt ID</dt><dd class="font-medium">${escapeHtml(data.receipt_id)}</dd></div>
        ${storeRow}
        <div class="flex justify-between gap-3"><dt>Payment method</dt><dd>${escapeHtml(method)}</dd></div>
        <div class="flex justify-between gap-3"><dt>Subtotal</dt><dd>${UI.formatMoney(data.subtotal)}</dd></div>
        <div class="flex justify-between gap-3"><dt>Tax</dt><dd>${UI.formatMoney(data.tax)}</dd></div>
        <div class="flex justify-between gap-3 font-semibold"><dt>Total</dt><dd>${UI.formatMoney(data.total)}</dd></div>
      </dl>
      ${timing}
      ${lookup}`;
  }

  function renderReceipt(data, ms, paymentMethod) {
    const view = el('receipt-view');
    view.classList.remove('hidden');
    view.innerHTML = receiptHtml(data, ms, paymentMethod);
    view.scrollIntoView({ block: 'nearest' });
  }

  // ----- back office ------------------------------------------------------

  function selectReport(reportId) {
    state.reportId = reportId;
    document.querySelectorAll('.report-card').forEach((button) => {
      const on = button.getAttribute('data-report') === reportId;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.classList.toggle('border-emerald-600', on);
      button.classList.toggle('bg-emerald-50', on);
      button.classList.toggle('border-slate-200', !on);
      button.classList.toggle('bg-white', !on);
    });
    el('report-prompt').classList.toggle('hidden', Boolean(reportId));
    el('params-dates').classList.toggle('hidden', reportId !== 'sales-by-store');
    el('params-limit').classList.toggle('hidden', reportId !== 'top-products');
    el('params-threshold').classList.toggle('hidden', reportId !== 'low-stock');
    el('params-receipt').classList.toggle('hidden', reportId !== 'receipt-lookup');
    UI.showError('report-error', '');
  }

  function reportParams() {
    if (state.reportId === 'sales-by-store') {
      const start = el('report-start').value;
      const end = el('report-end').value;
      if (!start || !end) {
        return { error: 'Report did not run: choose both a start date and an end date.' };
      }
      if (start > end) {
        return { error: 'Report did not run: the start date is after the end date.' };
      }
      return { params: { start_date: start, end_date: end } };
    }
    if (state.reportId === 'top-products') {
      const limit = Number(el('report-limit').value);
      if (![10, 25, 50, 100].includes(limit)) {
        return { error: 'Report did not run: choose a limit of 10, 25, 50, or 100.' };
      }
      return { params: { limit } };
    }
    if (state.reportId === 'receipt-lookup') {
      const raw = el('report-receipt-id').value.trim();
      if (!isPositiveInt(raw)) {
        return { error: 'Report did not run: enter a receipt ID that is a positive whole number.' };
      }
      return { params: { receipt_id: Number(raw) } };
    }
    return { params: {} };
  }

  function paintReport(result) {
    const data = result.data;
    const notice = data.notice ? ` · ${data.notice}` : '';
    el('report-meta').textContent = `${data.title}${notice} · query ${result.ms} ms`;
    const detail = el('receipt-detail');
    if (data.receipt) {
      detail.classList.remove('hidden');
      detail.innerHTML = `<div class="bg-white border border-slate-200 rounded-lg p-4">${receiptHtml(data.receipt, null)}</div>`;
    } else {
      detail.classList.add('hidden');
      detail.innerHTML = '';
    }
    UI.renderTable(el('report-table'), {
      columns: decorateColumns(data.columns),
      rows: data.rows || [],
      emptyMessage: data.emptyMessage || 'No rows matched this report.'
    });
    state.reportReady = true;
    el('export-csv-btn').disabled = false;
  }

  async function executeReport() {
    UI.showError('report-error', '');
    if (!state.reportId) {
      UI.showError('report-error', 'Report did not run: choose a report first.');
      return;
    }
    const built = reportParams();
    if (built.error) {
      UI.showError('report-error', built.error);
      return;
    }
    el('run-report-btn').disabled = true;
    try {
      const result = await callApi(() => API.runReport(state.reportId, built.params));
      paintReport(result);
    } catch (err) {
      state.reportReady = false;
      el('export-csv-btn').disabled = true;
      el('report-meta').textContent = '';
      el('receipt-detail').classList.add('hidden');
      UI.clearTable(el('report-table'));
      UI.showError('report-error', err.message || 'The report failed.');
      UI.toast(err.message || 'The report failed.', 'error');
    } finally {
      el('run-report-btn').disabled = false;
    }
  }

  function openLookup(receiptId) {
    UI.showSection('back-office');
    selectReport('receipt-lookup');
    el('report-receipt-id').value = String(receiptId);
    executeReport();
  }

  // ----- simulation -------------------------------------------------------

  function setSimRunning(running) {
    state.simRunning = running;
    el('sim-run-btn').disabled = running;
    el('sim-run-btn').textContent = running ? 'Running…' : 'Run Simulation';
    ['sim-customers', 'sim-stores', 'sim-concurrency'].forEach((id) => {
      el(id).disabled = running;
    });
    const stop = el('stop-btn');
    stop.classList.toggle('bg-red-700', running);
    stop.classList.toggle('text-white', running);
    stop.classList.toggle('border-red-700', running);
    stop.classList.toggle('hover:bg-red-800', running);
    stop.classList.toggle('bg-white', !running);
    stop.classList.toggle('text-slate-800', !running);
    stop.classList.toggle('border-slate-300', !running);
  }

  function renderProgress(event) {
    const total = event.total || 0;
    const processed = event.processed || 0;
    const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    el('sim-progress-bar').style.width = `${pct}%`;
    el('sim-progress').setAttribute('aria-valuenow', String(pct));
    el('sim-progress-count').textContent = total ? `${processed} / ${total}` : '';
    el('sim-created').textContent = String(event.receiptsCreated || 0);
    el('sim-approved').textContent = String(event.approved || 0);
    el('sim-declined').textContent = String(event.declined || 0);
    el('sim-revenue').textContent = UI.formatMoney(event.revenue || 0);
  }

  function syncStoreLimit() {
    const input = el('sim-stores');
    const count = state.stores.length;
    if (count > 0) input.max = String(count);
    else input.removeAttribute('max');
  }

  function wholeNumber(raw) {
    if (typeof raw === 'string' && raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }

  function renderFeed() {
    const list = el('sim-feed');
    if (!state.feed.length) {
      list.innerHTML = '<li>No receipts yet.</li>';
      return;
    }
    list.innerHTML = state.feed.map((item) => {
      const parts = [
        item.receipt_id == null ? 'Receipt id missing' : `Receipt ${item.receipt_id}`
      ];
      if (item.store_id != null) parts.push(`Store ${item.store_id}`);
      if (item.payment_method) parts.push(item.payment_method);
      if (item.status) parts.push(item.status);
      if (item.total != null) parts.push(UI.formatMoney(item.total));
      if (item.selection_count != null) parts.push(`${item.selection_count} selections`);
      if (item.execution_ms != null) parts.push(`${item.execution_ms} ms`);
      return `<li class="text-slate-700">${escapeHtml(parts.join(' · '))}</li>`;
    }).join('');
  }

  function showSimulationResult(data) {
    const summary = data.summary;
    const transactions = Array.isArray(data.transactions) ? data.transactions : [];
    renderProgress({
      processed: summary.requested,
      total: summary.requested,
      receiptsCreated: summary.approved,
      approved: summary.approved,
      declined: summary.declined,
      revenue: summary.total_sales
    });
    el('sim-progress-label').textContent = 'Finished';
    el('sim-summary').textContent = `Finished. Elapsed time ${summary.total_elapsed_ms} ms. Average transaction time ${summary.average_ms} ms (min ${summary.min_ms} ms, max ${summary.max_ms} ms). Failed ${summary.failed}.`;
    state.feed = transactions
      .filter((item) => item.status === 'approved')
      .slice()
      .reverse();
    renderFeed();
    UI.toast(`Finished. Elapsed ${summary.total_elapsed_ms} ms. Average ${summary.average_ms} ms. Failed ${summary.failed}.`, 'success');
  }

  async function onRunSimulation(event) {
    event.preventDefault();
    UI.showError('sim-error', '');
    if (state.simRunning) return;
    const transactionCount = wholeNumber(el('sim-customers').value);
    const storeCount = wholeNumber(el('sim-stores').value);
    const concurrency = wholeNumber(el('sim-concurrency').value);
    const storeMax = state.stores.length;
    if (transactionCount == null || transactionCount < 1 || transactionCount > 100) {
      UI.showError('sim-error', 'Simulation did not start: customers / receipts must be a whole number from 1 to 100.');
      return;
    }
    if (storeMax < 1) {
      UI.showError('sim-error', 'Simulation did not start: the store list has not loaded, so stores involved cannot be checked.');
      return;
    }
    if (storeCount == null || storeCount < 1 || storeCount > storeMax) {
      UI.showError('sim-error', `Simulation did not start: stores involved must be a whole number from 1 to ${storeMax}.`);
      return;
    }
    if (storeCount > transactionCount) {
      UI.showError('sim-error', 'Simulation did not start: stores involved cannot be greater than the number of customers / receipts. Each transaction is one store purchase.');
      return;
    }
    if (concurrency == null || concurrency < 1 || concurrency > 10) {
      UI.showError('sim-error', 'Simulation did not start: concurrent connections must be a whole number from 1 to 10.');
      return;
    }
    if (concurrency > transactionCount) {
      UI.showError('sim-error', 'Simulation did not start: concurrent connections cannot be greater than the number of customers / receipts.');
      return;
    }
    state.feed = [];
    renderFeed();
    el('sim-summary').textContent = '';
    el('sim-progress-label').textContent = 'Running';
    renderProgress({
      processed: 0,
      total: transactionCount,
      receiptsCreated: 0,
      approved: 0,
      declined: 0,
      revenue: 0
    });
    state.simController = new AbortController();
    setSimRunning(true);
    try {
      const result = await callApi(() => API.runSimulation({
        transaction_count: transactionCount,
        store_count: storeCount,
        concurrency
      }, state.simController.signal));
      showSimulationResult(result.data);
      try {
        await reloadReference();
      } catch (err) {
        UI.toast(err.message || 'Simulation finished, but the screen could not refresh store data.', 'error');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        el('sim-progress-label').textContent = 'Stopped';
        UI.toast('Stopped waiting. The server can still finish this simulation.', 'info');
      } else {
        el('sim-progress-label').textContent = 'Not run';
        UI.showError('sim-error', err.message || 'Simulation failed.');
        UI.toast(err.message || 'Simulation failed.', 'error');
      }
    } finally {
      state.simController = null;
      setSimRunning(false);
    }
  }

  function onStop() {
    if (!state.simController) {
      UI.toast('Nothing is running to cancel.', 'info');
      return;
    }
    state.simController.abort();
    UI.toast('Stopped waiting. The server can still finish this simulation.', 'info');
  }

  async function onActivity(event) {
    event.preventDefault();
    UI.showError('activity-error', '');
    const preset = document.querySelector('input[name="activity-preset"]:checked').value;
    const range = { preset };
    if (preset === 'custom') {
      range.start = el('activity-start').value;
      range.end = el('activity-end').value;
      if (!range.start || !range.end) {
        UI.showError('activity-error', 'Recent activity failed before the server call: choose both a start and an end.');
        return;
      }
      if (range.start > range.end) {
        UI.showError('activity-error', 'Recent activity failed before the server call: the start is after the end.');
        return;
      }
    }
    try {
      const result = await callApi(() => API.getRecentActivity(range));
      const rows = result.data.rows || [];
      el('activity-meta').textContent = `Query ${result.ms} ms · ${new Date(result.data.start).toLocaleString()} to ${new Date(result.data.end).toLocaleString()}`;
      UI.renderTable(el('activity-table'), {
        columns: [
          { key: 'at_ms', label: 'When', format: UI.formatWhen },
          { key: 'table', label: 'Table' },
          { key: 'action', label: 'Action' },
          { key: 'record', label: 'Record' },
          { key: 'detail', label: 'Details' }
        ],
        rows,
        emptyMessage: 'No rows were inserted or updated in this interval.'
      });
    } catch (err) {
      UI.showError('activity-error', err.message || 'Recent activity failed.');
      UI.toast(err.message || 'Recent activity failed.', 'error');
    }
  }

  // ----- admin ------------------------------------------------------------

  function countFor(tableName) {
    const row = state.counts.find((item) => item.table === tableName);
    return row ? row.rows : 0;
  }

  function blockIfSimRunning() {
    if (!state.simRunning) return false;
    UI.toast('A simulation is running. Press Stop before changing tables or checking out.', 'info');
    return true;
  }

  async function onCreateTables() {
    if (blockIfSimRunning()) return;
    const button = el('btn-create-tables');
    button.disabled = true;
    try {
      const result = await callApi(() => API.createTables());
      UI.toast(result.data.message, 'success');
      await reloadReference();
    } catch (err) {
      UI.toast(err.message || 'Create tables failed.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function onInitLookups() {
    if (blockIfSimRunning()) return;
    const ok = await UI.confirm({
      title: 'Initialize lookup tables?',
      message: 'This runs the seed script. It inserts StateTax, Store, Product, Inventory, and BankAccount. It does not delete or replace rows that are already there. If a seed key already exists, the request fails and this run is rolled back. Receipt, ReceiptItem, and Payment are not changed.',
      confirmLabel: 'Run seed script'
    });
    if (!ok) return;
    const button = el('btn-init-lookups');
    button.disabled = true;
    try {
      const result = await callApi(() => API.initLookupTables());
      UI.toast(result.data.message, 'success');
      await reloadReference();
    } catch (err) {
      UI.toast(err.message || 'Initialize lookup tables failed.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function onResetTransactions() {
    if (blockIfSimRunning()) return;
    try {
      await callApi(() => API.resetTransactionTables());
    } catch (err) {
      UI.toast(err.message || 'Reset transaction tables is not connected yet. Nothing was deleted.', 'info');
    }
  }

  function deleteWarning(tableName) {
    const notes = {
      StateTax: 'Stores reference these states, so the delete fails while any store still uses one. No other table is changed.',
      Store: 'Inventory rows for these stores are deleted too, because inventory cascades from the store. The delete fails if any receipt still points at a store.',
      Product: 'Inventory rows for these products are deleted too, because inventory cascades from the product. The delete fails if any receipt line still points at a product.',
      Inventory: 'Only inventory rows are deleted. Stores, products, receipts, and bank balances stay as they are. Stock is not archived.',
      Receipt: 'Payments for these receipts are deleted too, because payment cascades from the receipt. The delete fails if receipt lines still exist, because receipt lines do not cascade.',
      ReceiptItem: 'Only receipt lines are deleted. Receipts, payments, and stock stay as they are.',
      Payment: 'Only payment rows are deleted. Receipts and bank balances stay as they are.',
      BankAccount: 'The delete fails if any payment still points at an account. Balances are not archived.'
    };
    return notes[tableName] || 'Rows in other tables are not updated unless a foreign key cascades.';
  }

  async function onBrowse() {
    const tableName = el('admin-table-select').value;
    const limit = Number(el('admin-row-limit').value);
    const button = el('btn-browse');
    button.disabled = true;
    try {
      const result = await callApi(() => API.browseTable(tableName, limit));
      const shown = result.data.rows.length;
      el('admin-meta').textContent = `${tableName}: ${shown} row${shown === 1 ? '' : 's'} returned (limit ${limit}) · ${result.ms} ms`;
      UI.renderTable(el('admin-table'), {
        columns: decorateColumns(result.data.columns),
        rows: result.data.rows,
        emptyMessage: `${tableName} has no rows.`
      });
    } catch (err) {
      el('admin-meta').textContent = '';
      UI.toast(err.message || 'Browse failed.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function onDeleteRows() {
    if (blockIfSimRunning()) return;
    const tableName = el('admin-table-select').value;
    const known = !state.countsPending;
    const total = countFor(tableName);
    if (known && !total) {
      UI.toast(`${tableName} has no rows to delete.`, 'info');
      return;
    }
    const countText = known
      ? `This deletes all ${total} row${total === 1 ? '' : 's'} in ${tableName}.`
      : `This deletes every row in ${tableName}. A row count is not available.`;
    const ok = await UI.confirm({
      title: `Delete all rows in ${tableName}?`,
      message: `${countText} ${deleteWarning(tableName)} This cannot be undone.`,
      confirmLabel: 'Delete rows'
    });
    if (!ok) return;
    const button = el('btn-delete-rows');
    button.disabled = true;
    try {
      const result = await callApi(() => API.deleteAllRows(tableName));
      UI.toast(result.data.message, 'success');
      el('admin-meta').textContent = result.data.message;
      UI.clearTable(el('admin-table'));
      await reloadReference();
    } catch (err) {
      UI.toast(err.message || 'Delete failed.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  // ----- wiring -----------------------------------------------------------

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach((button) => {
      button.addEventListener('click', () => {
        UI.showSection(button.getAttribute('data-section'));
      });
    });

    el('stop-btn').addEventListener('click', onStop);
    el('store-select').addEventListener('change', async () => {
      if (state.cart.length) {
        state.cart = [];
        UI.toast('Cart cleared because the store changed. Tax depends on the store\'s state.', 'info');
      }
      renderStoreMeta();
      renderCart();
      await loadInventory();
    });
    el('product-search').addEventListener('input', fillProductSelect);
    el('product-select').addEventListener('change', renderProductMeta);
    el('add-form').addEventListener('submit', onAddItem);
    el('random-items-btn').addEventListener('click', onRandomItems);
    el('clear-cart-btn').addEventListener('click', () => {
      state.cart = [];
      UI.showError('add-error', '');
      UI.showError('checkout-error', '');
      renderCart();
    });
    el('cart-body').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-sku]');
      if (!button) return;
      const sku = button.getAttribute('data-remove-sku');
      state.cart = state.cart.filter((line) => line.sku !== sku);
      renderCart();
    });
    el('pay-cash').addEventListener('change', () => {
      el('account-field').classList.add('hidden');
      renderAccountHint();
    });
    el('pay-card').addEventListener('change', () => {
      el('account-field').classList.remove('hidden');
      renderAccountHint();
    });
    el('account-select').addEventListener('change', renderAccountHint);
    el('pay-form').addEventListener('submit', onCheckout);
    el('receipt-view').addEventListener('click', (event) => {
      const button = event.target.closest('[data-lookup-receipt]');
      if (!button) return;
      openLookup(button.getAttribute('data-lookup-receipt'));
    });
    el('receipt-detail').addEventListener('click', (event) => {
      const button = event.target.closest('[data-lookup-receipt]');
      if (!button) return;
      openLookup(button.getAttribute('data-lookup-receipt'));
    });

    el('report-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-report]');
      if (!button) return;
      selectReport(button.getAttribute('data-report'));
    });
    el('report-form').addEventListener('submit', (event) => {
      event.preventDefault();
      executeReport();
    });
    el('export-csv-btn').addEventListener('click', () => {
      if (!state.reportReady) {
        UI.toast('Nothing to export yet. Run the report first.', 'info');
        return;
      }
      UI.exportTable(el('report-table'), `${state.reportId || 'report'}.csv`);
    });

    el('sim-form').addEventListener('submit', onRunSimulation);
    document.querySelectorAll('input[name="activity-preset"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const custom = document.querySelector('input[name="activity-preset"]:checked').value === 'custom';
        el('activity-custom').classList.toggle('hidden', !custom);
        if (custom && !el('activity-start').value) {
          const end = new Date();
          const start = new Date(Date.now() - 60 * 60 * 1000);
          el('activity-start').value = localDateTimeInput(start);
          el('activity-end').value = localDateTimeInput(end);
        }
      });
    });
    el('activity-form').addEventListener('submit', onActivity);

    el('btn-create-tables').addEventListener('click', onCreateTables);
    el('btn-init-lookups').addEventListener('click', onInitLookups);
    el('btn-reset-tx').addEventListener('click', onResetTransactions);
    el('btn-browse').addEventListener('click', onBrowse);
    el('btn-delete-rows').addEventListener('click', onDeleteRows);
  }

  function setDefaultDates() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    el('report-start').value = localDateInput(start);
    el('report-end').value = localDateInput(end);
  }

  async function init() {
    UI.init();
    UI.showSection('front-desk');
    bindEvents();
    setDefaultDates();
    renderCart();
    renderStoreMeta();
    try {
      await reloadReference();
    } catch (err) {
      const select = el('store-select');
      if (select && select.options.length === 1) {
        select.innerHTML = '<option value="">Stores could not be loaded</option>';
      }
      if (!state.countsMessage) {
        state.countsPending = true;
        state.countsMessage = err.message || 'Row counts did not load because the backend is unavailable.';
        renderCounts();
      }
      UI.toast(err.message || 'The page could not load data from PostgreSQL.', 'error');
    }
  }

  return { init };
})();

globalThis.App = App;
App.init();

const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const cart = new Map();
const products = [];
const customers = [];
const transactions = [];
const $ = (selector) => document.querySelector(selector);
const productGrid = $('#product-grid');
const cartItems = $('#cart-items');
const state = {
  category: 'Semua',
  search: '',
  orderType: 'Dine in',
  paymentMethod: 'Tunai',
  sort: 'popular',
  customer: { id: null, name: 'Umum', phone: '' },
  settings: { storeName: 'Ruang Rasa', outletName: 'Outlet Surabaya', taxRate: '10', qrisImage: '' },
  cashierState: { activeShift: null, cashiers: [], recentShifts: [] },
  currentPage: 'kasir',
  editingProductId: null,
  editingCustomerId: null,
  lastTransaction: null,
};
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || `Permintaan gagal (${response.status}).`);
  return result;
}

function cashierInitials(name) {
  return String(name || 'Kasir').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toLocaleUpperCase('id-ID');
}

function renderCashierProfile() {
  const shift = state.cashierState.activeShift;
  const profileButton = $('#profile-button');
  if (!shift) {
    $('#profile-avatar').textContent = '—';
    $('#profile-name').textContent = 'Tidak ada kasir aktif';
    $('#profile-shift').textContent = 'Mulai shift untuk berjualan';
    profileButton.setAttribute('aria-label', 'Mulai shift kasir');
    $('.welcome-row .eyebrow').innerHTML = 'SILAKAN MULAI SHIFT <span aria-hidden="true">✦</span>';
    renderCheckoutAvailability();
    return;
  }
  $('#profile-avatar').textContent = cashierInitials(shift.cashier.name);
  $('#profile-name').textContent = shift.cashier.name;
  $('#profile-shift').textContent = shift.cashier.phone ? `${shift.cashier.phone} · ${shift.name}` : `Lengkapi nomor HP · ${shift.name}`;
  profileButton.setAttribute('aria-label', `Kasir aktif ${shift.cashier.name}, ${shift.name}. Kelola kasir dan shift.`);
  $('.welcome-row .eyebrow').innerHTML = `SELAMAT DATANG, ${escapeHtml(shift.cashier.name)} <span aria-hidden="true">✦</span>`;
  renderCheckoutAvailability();
}

function renderCheckoutAvailability() {
  const checkoutButton = $('#checkout-button');
  const hint = $('#checkout-hint');
  const activeShift = state.cashierState.activeShift;
  checkoutButton.disabled = cart.size === 0;
  hint.hidden = cart.size === 0 || Boolean(activeShift?.cashier.phone);
  hint.textContent = activeShift
    ? 'Lengkapi nomor HP kasir di profil untuk melanjutkan pembayaran.'
    : 'Mulai shift dan lengkapi data kasir melalui profil untuk melanjutkan pembayaran.';
}

function renderCashierModal() {
  const shift = state.cashierState.activeShift;
  const card = $('#cashier-active-card');
  card.classList.toggle('is-inactive', !shift);
  card.innerHTML = shift
    ? `<span class="cashier-active-avatar">${escapeHtml(cashierInitials(shift.cashier.name))}</span><span class="cashier-active-copy"><strong>${escapeHtml(shift.cashier.name)}</strong><small>${escapeHtml(shift.cashier.phone)} · ${escapeHtml(shift.name)} · Mulai ${formatDate(shift.startedAt, true)}</small></span><span class="cashier-active-badge">SHIFT AKTIF</span>`
    : '<span class="cashier-active-avatar">—</span><span class="cashier-active-copy"><strong>Belum ada shift aktif</strong><small>Isi data kasir untuk memulai shift.</small></span>';
  $('#cashier-name-input').value = shift?.cashier.name || '';
  $('#cashier-phone-input').value = shift?.cashier.phone || '';
  if (shift && [...$('#cashier-shift-input').options].some((option) => option.value === shift.name)) {
    $('#cashier-shift-input').value = shift.name;
  }
  $('#save-cashier').disabled = !shift;
  $('#end-shift').disabled = !shift;
  $('#start-shift').textContent = shift ? 'Mulai shift / ganti kasir →' : 'Mulai shift →';
  const history = state.cashierState.recentShifts || [];
  $('#shift-history-list').innerHTML = history.length
    ? `<div class="shift-history-list">${history.slice(0, 6).map((item) => `<div class="shift-history-row"><span><strong>${escapeHtml(item.cashier.name)}</strong> · ${escapeHtml(item.name)}</span><span>${formatDate(item.startedAt, true)}${item.active ? ' · Aktif' : ''}</span></div>`).join('')}</div>`
    : '<p class="shift-history-empty">Belum ada riwayat pergantian shift.</p>';
}

async function refreshCashierState() {
  state.cashierState = await api('/api/shift');
  renderCashierProfile();
  renderCashierModal();
  return state.cashierState;
}

function formatPrice(amount) {
  return currency.format(Number(amount) || 0).replace(/\u00a0/g, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('toast-error', isError);
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
}

function showError(target, message) {
  target.textContent = message;
  target.hidden = false;
}

function subtotalAmount() {
  return [...cart.entries()].reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + (product ? product.price * quantity : 0);
  }, 0);
}

function taxAmount(subtotal = subtotalAmount()) {
  return Math.round(subtotal * (Number(state.settings.taxRate) || 0) / 100);
}

function totalAmount() {
  const subtotal = subtotalAmount();
  return subtotal + taxAmount(subtotal);
}

function renderCategories() {
  const categories = [...new Set(products.filter((product) => product.active).map((product) => product.category))].sort((a, b) => a.localeCompare(b, 'id'));
  if (state.category !== 'Semua' && !categories.includes(state.category)) state.category = 'Semua';
  $('#category-list').innerHTML = [
    `<button class="category-chip ${state.category === 'Semua' ? 'is-selected' : ''}" type="button" data-category="Semua">Semua menu <span>${String(products.filter((product) => product.active).length).padStart(2, '0')}</span></button>`,
    ...categories.map((category) => `<button class="category-chip ${state.category === category ? 'is-selected' : ''}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`),
  ].join('');
}

function renderProducts() {
  renderCategories();
  const query = state.search.trim().toLocaleLowerCase('id-ID');
  const filtered = products.filter((product) => {
    const matchesCategory = state.category === 'Semua' || product.category === state.category;
    const matchesSearch = `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase('id-ID').includes(query);
    return product.active && matchesCategory && matchesSearch;
  });
  if (state.sort === 'price') filtered.sort((a, b) => a.price - b.price);
  if (state.sort === 'popular') filtered.sort((a, b) => products.indexOf(a) - products.indexOf(b));

  productGrid.innerHTML = filtered.map((product) => `
    <article class="product-card">
      <div class="product-art" style="--art-bg:${escapeHtml(product.color)}">
        <span class="product-badge">${escapeHtml(product.badge)}</span>
        <span class="product-emoji" aria-hidden="true">${escapeHtml(product.emoji)}</span>
        <button class="add-product" type="button" data-add="${escapeHtml(product.id)}" aria-label="Tambah ${escapeHtml(product.name)}" ${product.stock <= 0 ? 'disabled' : ''}>+</button>
      </div>
      <div class="product-info">
        <h4>${escapeHtml(product.name)}</h4>
        <p>${escapeHtml(product.description || product.category)}</p>
        <div class="product-price-row"><strong class="product-price">${formatPrice(product.price)}</strong><span class="product-stock ${product.stock <= 3 ? 'stock-low' : ''}">Stok ${product.stock}</span></div>
      </div>
    </article>
  `).join('');
  $('#empty-state').hidden = filtered.length > 0;
  $('#result-count').textContent = `${filtered.length} produk`;
}

function renderCart() {
  for (const [id] of cart) {
    if (!products.some((product) => product.id === id && product.active)) cart.delete(id);
  }
  const entries = [...cart.entries()];
  const itemCount = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  $('#cart-count').textContent = String(itemCount);
  renderCheckoutAvailability();
  cartItems.innerHTML = entries.length === 0
    ? '<div class="cart-empty"><span class="empty-bag" aria-hidden="true">＋</span><strong>Belum ada pesanan</strong><span>Pilih menu untuk memulai transaksi.</span></div>'
    : entries.map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return `
        <article class="cart-item">
          <span class="cart-item-art" style="--art-bg:${escapeHtml(product.color)}" aria-hidden="true">${escapeHtml(product.emoji)}</span>
          <div class="cart-item-details"><strong>${escapeHtml(product.name)}</strong><small>${formatPrice(product.price)} / item</small></div>
          <div class="cart-item-trailing">
            <strong>${formatPrice(product.price * quantity)}</strong>
            <div class="quantity-control" aria-label="Jumlah ${escapeHtml(product.name)}">
              <button type="button" data-quantity="${escapeHtml(id)}" data-change="-1" aria-label="Kurangi ${escapeHtml(product.name)}">−</button>
              <span>${quantity}</span>
              <button type="button" data-quantity="${escapeHtml(id)}" data-change="1" aria-label="Tambah ${escapeHtml(product.name)}" ${quantity >= product.stock ? 'disabled' : ''}>+</button>
            </div>
          </div>
        </article>`;
    }).join('');
  const subtotal = subtotalAmount();
  $('#subtotal').textContent = formatPrice(subtotal);
  $('#tax').textContent = formatPrice(taxAmount(subtotal));
  $('#total').textContent = formatPrice(subtotal + taxAmount(subtotal));
  $('#payment-total').textContent = formatPrice(subtotal + taxAmount(subtotal));
  $('.bill-summary > div:nth-child(2) span').innerHTML = `Pajak <small>(${Number(state.settings.taxRate) || 0}%)</small>`;
}

function renderCustomer() {
  $('#customer-name').innerHTML = `${escapeHtml(state.customer.name)} <span class="meta-chevron">⌄</span>`;
}

function renderQris() {
  const image = $('#qris-image');
  image.hidden = !state.settings.qrisImage;
  $('#qris-placeholder').hidden = Boolean(state.settings.qrisImage);
  $('#qris-upload-label').textContent = state.settings.qrisImage ? 'Ganti QRIS merchant' : 'Pasang QRIS merchant';
  $('#qris-instruction').textContent = state.settings.qrisImage
    ? 'Pastikan pembayaran berhasil di aplikasi merchant sebelum dikonfirmasi.'
    : 'Kode belum tersedia. Unggah gambar QRIS merchant sebelum menerima pembayaran.';
  if (state.settings.qrisImage) image.src = state.settings.qrisImage;
  else image.removeAttribute('src');
}

function renderCustomerSuggestions() {
  $('#customer-suggestions').innerHTML = customers.map((customer) =>
    `<option value="${escapeHtml(customer.name)}" label="${escapeHtml(customer.phone || '')}"></option>`,
  ).join('');
}

function renderSalesSummary(dashboard) {
  $('#transaction-count').innerHTML = `${dashboard.transactionsToday} <span>pesanan</span>`;
  $('#sales-total').textContent = formatPrice(dashboard.salesToday);
  $('#history-nav-count').textContent = String(dashboard.totalTransactions);
}

async function refreshProducts() {
  products.splice(0, products.length, ...await api('/api/products'));
  renderProducts();
  renderCart();
}

async function refreshCustomers() {
  customers.splice(0, customers.length, ...await api('/api/customers'));
  renderCustomerSuggestions();
}

async function refreshTransactions(query = '') {
  transactions.splice(0, transactions.length, ...await api(`/api/transactions?q=${encodeURIComponent(query)}`));
  $('#history-nav-count').textContent = String(transactions.length);
  return transactions;
}

function setConnection(connected) {
  const status = $('.connection-status');
  status.innerHTML = connected
    ? '<span></span> Database lokal aktif'
    : '<span></span> Database tidak terhubung';
  status.classList.toggle('connection-offline', !connected);
}

async function loadApp() {
  try {
    const [loadedProducts, loadedCustomers, loadedTransactions, settings, dashboard, cashierState] = await Promise.all([
      api('/api/products'),
      api('/api/customers'),
      api('/api/transactions'),
      api('/api/settings'),
      api('/api/dashboard'),
      api('/api/shift'),
    ]);
    products.splice(0, products.length, ...loadedProducts);
    customers.splice(0, customers.length, ...loadedCustomers);
    transactions.splice(0, transactions.length, ...loadedTransactions);
    Object.assign(state.settings, settings);
    state.cashierState = cashierState;
    setConnection(true);
    $('#app-error').hidden = true;
    $('#today-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
    $('#breadcrumb-store').textContent = state.settings.storeName;
    $('#store-switcher-name').textContent = state.settings.storeName;
    $('#store-switcher-outlet').textContent = state.settings.outletName;
    renderProducts();
    renderCart();
    renderCustomer();
    renderQris();
    renderCustomerSuggestions();
    renderSalesSummary(dashboard);
    renderCashierProfile();
  } catch (error) {
    console.error('Aplikasi gagal memuat data dari database lokal.', error);
    setConnection(false);
    $('#app-error').hidden = false;
    $('#app-error').textContent = `Database lokal belum dapat diakses: ${error.message} Pastikan server dijalankan dengan npm start.`;
  }
}

async function loadDashboard() {
  const dashboard = await api('/api/dashboard');
  renderSalesSummary(dashboard);
  const maxSales = Math.max(1, ...dashboard.dailySales.map((day) => Number(day.sales)));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const day = dashboard.dailySales.find((row) => row.day === key);
    return { key, date, sales: Number(day?.sales) || 0, transactions: Number(day?.transactions) || 0 };
  });
  $('#management-content').innerHTML = `
    <div class="management-heading"><div><p class="eyebrow">PERFORMA TOKO</p><h2>Ringkasan usaha</h2><p>Gambaran operasional toko dari transaksi yang tersimpan.</p></div><span class="local-data-badge">● Database lokal tersambung</span></div>
    <div class="metric-grid">
      <article class="metric-card"><span class="metric-icon">↗</span><small>Penjualan hari ini</small><strong>${formatPrice(dashboard.salesToday)}</strong><span>${dashboard.transactionsToday} transaksi hari ini</span></article>
      <article class="metric-card"><span class="metric-icon">▦</span><small>Produk aktif</small><strong>${dashboard.productCount}</strong><span>${dashboard.stockUnits} unit stok tersedia</span></article>
      <article class="metric-card"><span class="metric-icon">♙</span><small>Pelanggan terdaftar</small><strong>${dashboard.customerCount}</strong><span>Data tersimpan di SQLite</span></article>
      <article class="metric-card"><span class="metric-icon">◷</span><small>Semua transaksi</small><strong>${dashboard.totalTransactions}</strong><span>Riwayat di database lokal</span></article>
    </div>
    <div class="dashboard-grid">
      <section class="management-card"><div class="card-title-row"><div><h3>Penjualan 7 hari</h3><p>Ringkasan transaksi harian</p></div></div><div class="sales-chart" role="img" aria-label="Grafik batang penjualan tujuh hari">${days.map((day) => `<div class="chart-column" title="${formatDate(day.key)}: ${formatPrice(day.sales)}"><div class="chart-track"><span style="height:${Math.max(day.sales ? 9 : 3, day.sales / maxSales * 100)}%"></span></div><small>${new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(day.date)}</small><strong>${day.sales ? formatPrice(day.sales) : '—'}</strong></div>`).join('')}</div></section>
      <section class="management-card"><div class="card-title-row"><div><h3>Transaksi terbaru</h3><p>Pesanan yang terakhir diselesaikan</p></div><button class="inline-link" type="button" data-open-page="history">Semua transaksi →</button></div>${dashboard.recentTransactions.length ? `<div class="recent-list">${dashboard.recentTransactions.map((transaction) => `<button type="button" class="recent-row" data-receipt="${escapeHtml(transaction.receiptNumber)}"><span class="recent-avatar">${escapeHtml((transaction.customer.name || 'U').charAt(0))}</span><span><strong>${escapeHtml(transaction.customer.name)}</strong><small>${escapeHtml(transaction.receiptNumber)} · ${formatDate(transaction.createdAt, true)}</small></span><b>${formatPrice(transaction.total)}</b></button>`).join('')}</div>` : '<p class="management-empty">Belum ada transaksi pada database ini.</p>'}</section>
    </div>`;
}

function renderProductManagement(query = '') {
  const filtered = products.filter((product) => `${product.name} ${product.category} ${product.description}`.toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID')));
  $('#management-content').innerHTML = `
    <div class="management-heading"><div><p class="eyebrow">KATALOG MENU</p><h2>Kelola produk</h2><p>Tambah menu, atur harga dan stok, atau arsipkan produk.</p></div><button class="primary-action" type="button" data-add-product>＋ Tambah produk</button></div>
    <div class="management-toolbar"><label class="management-search"><span>⌕</span><input id="management-search" type="search" value="${escapeHtml(query)}" placeholder="Cari nama atau kategori..."></label><span class="table-count">${filtered.length} produk</span></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUK</th><th>KATEGORI</th><th>HARGA</th><th>STOK</th><th>STATUS</th><th></th></tr></thead><tbody>
      ${filtered.map((product) => `<tr><td><span class="table-product"><span class="table-product-icon" style="--art-bg:${escapeHtml(product.color)}">${escapeHtml(product.emoji)}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || '—')}</small></span></span></td><td>${escapeHtml(product.category)}</td><td><strong>${formatPrice(product.price)}</strong></td><td><span class="${product.stock <= 3 ? 'stock-low' : ''}">${product.stock}</span></td><td><span class="status-pill ${product.active ? 'status-active' : 'status-archived'}">${product.active ? 'Aktif' : 'Diarsipkan'}</span></td><td><div class="row-actions"><button type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>${product.active ? `<button type="button" class="danger-action" data-archive-product="${escapeHtml(product.id)}">Arsipkan</button>` : `<button type="button" data-restore-product="${escapeHtml(product.id)}">Pulihkan</button>`}</div></td></tr>`).join('')}
      ${filtered.length ? '' : '<tr><td colspan="6" class="table-empty">Produk tidak ditemukan.</td></tr>'}
    </tbody></table></div>`;
}

function renderCustomerManagement(query = '') {
  const filtered = customers.filter((customer) => `${customer.name} ${customer.phone}`.toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID')));
  $('#management-content').innerHTML = `
    <div class="management-heading"><div><p class="eyebrow">DATA PELANGGAN</p><h2>Pelanggan</h2><p>Informasi kontak dan ringkasan pembelian pelanggan tersimpan.</p></div><button class="primary-action" type="button" data-add-customer>＋ Tambah pelanggan</button></div>
    <div class="management-toolbar"><label class="management-search"><span>⌕</span><input id="management-search" type="search" value="${escapeHtml(query)}" placeholder="Cari nama atau nomor telepon..."></label><span class="table-count">${filtered.length} pelanggan</span></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>PELANGGAN</th><th>TRANSAKSI</th><th>TOTAL PEMBELIAN</th><th>PEMBELIAN TERAKHIR</th><th></th></tr></thead><tbody>
      ${filtered.map((customer) => `<tr><td><span class="table-product"><span class="history-customer-avatar">${escapeHtml(customer.name.charAt(0).toLocaleUpperCase('id-ID'))}</span><span><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.phone || 'Tanpa nomor telepon')}</small></span></span></td><td>${customer.transaction_count}</td><td><strong>${formatPrice(customer.total_spent)}</strong></td><td>${formatDate(customer.last_purchase)}</td><td><div class="row-actions"><button type="button" data-edit-customer="${escapeHtml(customer.id)}">Edit</button><button type="button" data-customer-history="${escapeHtml(customer.id)}">Riwayat</button><button type="button" class="danger-action" data-delete-customer="${escapeHtml(customer.id)}">Hapus</button></div></td></tr>`).join('')}
      ${filtered.length ? '' : '<tr><td colspan="5" class="table-empty">Belum ada pelanggan. Tambahkan pelanggan atau catat transaksi baru.</td></tr>'}
    </tbody></table></div>`;
}

function renderHistoryView(query = '') {
  const matching = transactions.filter((transaction) => {
    const terms = `${transaction.customer.name} ${transaction.customer.phone} ${transaction.receiptNumber} ${transaction.items.map((item) => item.name).join(' ')}`;
    return terms.toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID'));
  });
  $('#management-content').innerHTML = `
    <div class="management-heading"><div><p class="eyebrow">TRANSAKSI TOKO</p><h2>Riwayat pembelian</h2><p>Daftar transaksi yang tersimpan pada database SQLite lokal.</p></div><button class="secondary-action" type="button" data-refresh-history>↻ Muat ulang</button></div>
    <div class="management-toolbar"><label class="management-search"><span>⌕</span><input id="management-search" type="search" value="${escapeHtml(query)}" placeholder="Cari pelanggan, nomor transaksi, atau produk..."></label><span class="table-count">${matching.length} transaksi</span></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>TRANSAKSI</th><th>PELANGGAN</th><th>KASIR / SHIFT</th><th>ITEM</th><th>PEMBAYARAN</th><th>TOTAL</th><th>WAKTU</th><th>CETAK</th></tr></thead><tbody>
      ${matching.map((transaction) => `<tr><td><strong>${escapeHtml(transaction.receiptNumber)}</strong></td><td>${escapeHtml(transaction.customer.name)}<small class="table-subtext">${escapeHtml(transaction.customer.phone || '')}</small></td><td>${escapeHtml(transaction.cashier?.name || 'Kasir lama')}<small class="table-subtext">${escapeHtml(transaction.cashier?.phone || '')} · ${escapeHtml(transaction.shift?.name || '—')}</small></td><td>${transaction.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity}`).join('<br>')}</td><td><span class="status-pill status-active">${escapeHtml(transaction.method)}</span><small class="table-subtext">${escapeHtml(transaction.orderType)}</small></td><td><strong>${formatPrice(transaction.total)}</strong></td><td>${formatDate(transaction.createdAt, true)}</td><td><div class="row-actions"><button type="button" data-print-receipt="${escapeHtml(transaction.id)}">Struk</button><button type="button" data-print-kitchen="${escapeHtml(transaction.id)}">Dapur</button></div></td></tr>`).join('')}
      ${matching.length ? '' : '<tr><td colspan="8" class="table-empty">Belum ada transaksi yang cocok.</td></tr>'}
    </tbody></table></div>`;
}

function renderSettings() {
  $('#management-content').innerHTML = `
    <div class="management-heading"><div><p class="eyebrow">KONFIGURASI TOKO</p><h2>Pengaturan</h2><p>Atur identitas outlet, pajak transaksi, dan gambar QRIS merchant.</p></div><span class="local-data-badge">SQLite lokal</span></div>
    <form id="settings-form" class="settings-layout">
      <section class="management-card settings-card"><h3>Profil usaha</h3><p>Informasi ini ditampilkan pada identitas kasir.</p>
        <label class="customer-field">Nama usaha<input name="storeName" required maxlength="80" value="${escapeHtml(state.settings.storeName)}"></label>
        <label class="customer-field">Nama outlet<input name="outletName" required maxlength="80" value="${escapeHtml(state.settings.outletName)}"></label>
        <label class="customer-field">Pajak penjualan (%)<input name="taxRate" type="number" min="0" max="100" step="1" required value="${escapeHtml(state.settings.taxRate)}"></label>
      </section>
      <section class="management-card settings-card"><h3>Pembayaran QRIS</h3><p>Unggah QRIS statis resmi merchant. Pastikan mutasi dana di aplikasi penyedia sebelum menyelesaikan pembayaran.</p>
        <div class="settings-qris-preview">${state.settings.qrisImage ? `<img src="${state.settings.qrisImage}" alt="QRIS merchant aktif">` : '<span>▦</span><small>QRIS belum diunggah</small>'}</div>
        <label class="qris-upload-button settings-qris-upload" for="settings-qris-upload">↑ <span>Pilih gambar QRIS</span></label>
        <input id="settings-qris-upload" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp">
        <button class="text-danger-button" type="button" data-remove-qris ${state.settings.qrisImage ? '' : 'disabled'}>Hapus gambar QRIS</button>
      </section>
      <div class="settings-footer"><p>Data tersimpan pada <code>data/ruang-kasir.sqlite</code> di komputer ini.</p><button class="primary-action" type="submit">Simpan pengaturan →</button></div>
    </form>`;
}

function renderHelp() {
  $('#management-content').innerHTML = `
    <div class="management-heading"><div><p class="eyebrow">PANDUAN PENGGUNA</p><h2>Pusat bantuan</h2><p>Langkah singkat untuk menjalankan kasir dan mengelola data secara lokal.</p></div></div>
    <div class="help-grid">
      <article class="management-card help-card"><span>01</span><h3>Kelola katalog</h3><p>Buka menu Produk, tekan Tambah produk, lalu isi nama, kategori, harga, dan stok. Perubahan tersimpan langsung ke SQLite lokal.</p><button type="button" data-open-page="products">Buka produk →</button></article>
      <article class="management-card help-card"><span>02</span><h3>Catat pelanggan</h3><p>Tambahkan nama dan nomor telepon saat membuat pesanan. Riwayat pembelian bisa dicari berdasarkan identitas pelanggan.</p><button type="button" data-open-page="customers">Buka pelanggan →</button></article>
      <article class="management-card help-card"><span>03</span><h3>Pembayaran QRIS</h3><p>Unggah gambar QRIS resmi pada menu Pengaturan. Tampilkan QR saat checkout, lalu konfirmasi setelah dana dipastikan masuk.</p><button type="button" data-open-page="settings">Atur pembayaran →</button></article>
      <article class="management-card help-card"><span>04</span><h3>Data dan cadangan</h3><p>SQLite berada di folder data. Gunakan tombol ekspor/backup sistem operasi saat aplikasi berhenti, dan simpan salinan di tempat aman.</p><p class="help-command"><code>npm start</code> · <code>http://127.0.0.1:3000</code></p></article>
    </div>
    <div class="help-notice"><strong>Catatan penggunaan lokal</strong><p>Aplikasi ini hanya tersedia pada komputer tempat server dijalankan. QRIS belum tersambung ke penyedia pembayaran, autentikasi pengguna, atau sinkronisasi multi-perangkat.</p></div>`;
}

async function setPage(page) {
  state.currentPage = page;
  const isCashier = page === 'kasir';
  $('.catalog-panel').hidden = !isCashier;
  $('.order-panel').hidden = !isCashier;
  $('#management-view').hidden = isCashier;
  $('.workspace').classList.toggle('management-mode', !isCashier);
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.page === page);
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const pageNames = { kasir: 'Kasir', dashboard: 'Ringkasan', products: 'Produk', customers: 'Pelanggan', history: 'Riwayat pembelian', settings: 'Pengaturan', help: 'Pusat bantuan' };
  $('#page-title').textContent = pageNames[page] || 'Kasir';
  $('#breadcrumb-section').textContent = pageNames[page] || 'Kasir';
  if (isCashier) return;
  $('#management-content').innerHTML = '<p class="loading-state">Memuat data dari database lokal…</p>';
  try {
    if (page === 'dashboard') await loadDashboard();
    if (page === 'products') renderProductManagement();
    if (page === 'customers') {
      await refreshCustomers();
      renderCustomerManagement();
    }
    if (page === 'history') {
      await refreshTransactions();
      renderHistoryView();
    }
    if (page === 'settings') {
      Object.assign(state.settings, await api('/api/settings'));
      renderQris();
      renderSettings();
    }
    if (page === 'help') renderHelp();
  } catch (error) {
    console.error(`Gagal membuka halaman ${page}.`, error);
    $('#management-content').innerHTML = `<div class="management-error"><strong>Data tidak dapat dimuat.</strong><p>${escapeHtml(error.message)}</p><button type="button" data-retry-page="${escapeHtml(page)}">Coba lagi</button></div>`;
  }
  $('#sidebar').classList.remove('is-open');
  $('.mobile-menu-button').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openProductForm(product = null) {
  state.editingProductId = product?.id || null;
  const form = $('#product-form');
  form.reset();
  form.elements.name.value = product?.name || '';
  form.elements.category.value = product?.category || '';
  form.elements.description.value = product?.description || '';
  form.elements.price.value = product?.price ?? '';
  form.elements.emoji.value = product?.emoji || '🍽️';
  form.elements.color.value = product?.color || '#edf2e8';
  form.elements.badge.value = product?.badge || 'MENU';
  form.elements.stock.value = product?.stock ?? 0;
  $('#product-form-title').textContent = product ? 'Edit produk' : 'Tambah produk';
  $('#save-product').innerHTML = `${product ? 'Simpan perubahan' : 'Simpan produk'} <span aria-hidden="true">→</span>`;
  $('#product-error').hidden = true;
  $('#product-categories').innerHTML = [...new Set(products.map((item) => item.category))].map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
  $('#product-modal').hidden = false;
  form.elements.name.focus();
}

function closeProductForm() {
  $('#product-modal').hidden = true;
  if (state.currentPage === 'products') $('[data-add-product]')?.focus();
}

function openCustomerForm(customer = null) {
  const isEditing = Boolean(customer?.id);
  state.editingCustomerId = isEditing ? customer.id : null;
  $('#customer-input').value = customer?.name || (state.customer.name === 'Umum' ? '' : state.customer.name);
  $('#customer-phone-input').value = customer?.phone || state.customer.phone;
  $('#customer-title').textContent = isEditing ? 'Edit pelanggan' : 'Pilih pelanggan';
  $('#save-customer').innerHTML = `${isEditing ? 'Simpan perubahan' : 'Simpan pelanggan'} <span aria-hidden="true">→</span>`;
  $('#select-guest').hidden = isEditing;
  $('#customer-modal').hidden = false;
  $('#customer-input').focus();
}

function closeCustomerForm() {
  $('#customer-modal').hidden = true;
  $('#customer-button').focus();
}

async function saveCustomer(event) {
  event?.preventDefault();
  const input = { name: $('#customer-input').value.trim(), phone: $('#customer-phone-input').value.trim() };
  if (!input.name) {
    $('#customer-input').focus();
    showToast('Masukkan nama pelanggan terlebih dahulu.', true);
    return;
  }
  try {
    const customer = await api(state.editingCustomerId ? `/api/customers/${encodeURIComponent(state.editingCustomerId)}` : '/api/customers', {
      method: state.editingCustomerId ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    });
    await refreshCustomers();
    if (state.currentPage === 'customers') renderCustomerManagement($('#management-search')?.value || '');
    if (state.currentPage === 'history') renderHistoryView($('#management-search')?.value || '');
    state.customer = { id: customer.id, name: customer.name, phone: customer.phone };
    renderCustomer();
    $('#customer-modal').hidden = true;
    showToast(state.editingCustomerId ? 'Data pelanggan berhasil diperbarui.' : 'Pelanggan berhasil disimpan.');
    state.editingCustomerId = null;
  } catch (error) {
    showToast(error.message, true);
  }
}

function openPaymentModal() {
  if (!state.cashierState.activeShift || !state.cashierState.activeShift.cashier.phone) {
    showToast('Mulai shift dan lengkapi data kasir sebelum menerima pembayaran.', true);
    renderCashierModal();
    $('#cashier-modal').hidden = false;
    return;
  }
  if (cart.size === 0) return showToast('Pilih menu sebelum melanjutkan pembayaran.');
  $('#payment-total').textContent = formatPrice(totalAmount());
  $('#cash-amount-input').value = '';
  $('#payment-modal').hidden = false;
  updatePaymentForm();
  if (state.paymentMethod === 'Tunai') $('#cash-amount-input').focus();
}

function updatePaymentForm() {
  const cashMethod = state.paymentMethod === 'Tunai';
  const qrisMethod = state.paymentMethod === 'QRIS';
  $('.cash-amount').hidden = !cashMethod;
  $('#change-row').hidden = !cashMethod;
  $('#qris-panel').hidden = !qrisMethod;
  $('#cash-amount-input').required = cashMethod;
  $('#payment-error').hidden = true;
  $('#confirm-payment').disabled = qrisMethod && !state.settings.qrisImage;
  const received = Number($('#cash-amount-input').value) || 0;
  $('#change-amount').textContent = formatPrice(Math.max(0, received - totalAmount()));
}

async function handleQrisUpload(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showToast('Pilih gambar QRIS PNG, JPG, atau WebP.', true);
    return;
  }
  if (file.size > 1024 * 1024) {
    showToast('Ukuran gambar QRIS maksimal 1 MB.', true);
    return;
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsDataURL(file);
    });
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...state.settings, qrisImage: dataUrl }),
    });
    renderQris();
    updatePaymentForm();
    if (state.currentPage === 'settings') renderSettings();
    showToast('Gambar QRIS tersimpan di database lokal.');
  } catch (error) {
    console.error('QRIS gagal disimpan.', error);
    showToast(error.message, true);
  }
}

async function completePayment() {
  const method = state.paymentMethod;
  const received = Number($('#cash-amount-input').value) || 0;
  if (method === 'Tunai' && received < totalAmount()) {
    showError($('#payment-error'), 'Jumlah uang yang diterima belum mencukupi.');
    $('#cash-amount-input').focus();
    return;
  }
  if (method === 'QRIS' && !state.settings.qrisImage) {
    showError($('#payment-error'), 'Unggah QRIS merchant sebelum mengonfirmasi pembayaran.');
    return;
  }
  $('#confirm-payment').disabled = true;
  try {
    const transaction = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
        method,
        cashReceived: received,
        customerId: state.customer.id,
        orderType: state.orderType,
        note: $('#order-note-input').value.trim(),
      }),
    });
    state.lastTransaction = transaction;
    $('#receipt-number').textContent = transaction.receiptNumber;
    $('#receipt-total').textContent = formatPrice(transaction.total);
    $('#success-message').textContent = method === 'QRIS'
      ? 'Pastikan dana sudah masuk ke akun merchant sebelum pesanan diserahkan.'
      : `Pembayaran ${method.toLocaleLowerCase('id-ID')} berhasil dicatat.`;
    $('#payment-modal').hidden = true;
    $('#success-modal').hidden = false;
    cart.clear();
    state.customer = { id: null, name: 'Umum', phone: '' };
    $('#order-note-input').value = '';
    renderCustomer();
    await Promise.all([refreshProducts(), refreshTransactions()]);
    const dashboard = await api('/api/dashboard');
    renderSalesSummary(dashboard);
    await refreshCashierState();
  } catch (error) {
    console.error('Transaksi gagal disimpan.', error);
    showError($('#payment-error'), error.message);
    $('#confirm-payment').disabled = method === 'QRIS' && !state.settings.qrisImage;
  }
}

function printTransaction(transaction, mode) {
  if (!transaction || !['receipt', 'kitchen'].includes(mode)) {
    showToast('Data transaksi untuk dicetak tidak tersedia.', true);
    return;
  }
  const isKitchen = mode === 'kitchen';
  const customer = transaction.customer || { name: 'Umum', phone: '' };
  const settings = state.settings;
  const itemLines = transaction.items.map((item) => isKitchen
    ? `<li class="print-kitchen-item"><strong>${item.quantity}<span>×</span></strong><span>${escapeHtml(item.name)}</span></li>`
    : `<li class="print-receipt-item"><span>${escapeHtml(item.name)}<small>${item.quantity} × ${formatPrice(item.price)}</small></span><strong>${formatPrice(item.lineTotal)}</strong></li>`,
  ).join('');
  const note = transaction.note
    ? `<div class="${isKitchen ? 'print-kitchen-note' : 'print-receipt-note'}"><strong>CATATAN</strong><span>${escapeHtml(transaction.note)}</span></div>`
    : '';

  $('#print-area').innerHTML = isKitchen ? `
    <article class="print-ticket print-kitchen-ticket">
      <header class="print-header"><strong>${escapeHtml(settings.storeName)}</strong><span>${escapeHtml(settings.outletName)}</span><h1>SLIP DAPUR</h1></header>
      <div class="print-order-type">${escapeHtml(transaction.orderType || 'Dine in')}</div>
      <div class="print-ticket-meta"><span>No. pesanan</span><strong>${escapeHtml(transaction.receiptNumber)}</strong><span>Waktu</span><strong>${formatDate(transaction.createdAt, true)}</strong><span>Kasir</span><strong>${escapeHtml(transaction.cashier?.name || 'Kasir lama')}</strong><span>Shift</span><strong>${escapeHtml(transaction.shift?.name || '—')}</strong></div>
      <div class="print-kitchen-customer"><small>NAMA PELANGGAN</small><strong>${escapeHtml(customer.name || 'Umum')}</strong>${customer.phone ? `<span>${escapeHtml(customer.phone)}</span>` : ''}</div>
      <div class="print-divider"></div><p class="print-item-heading">DAFTAR PESANAN · ${transaction.items.reduce((sum, item) => sum + item.quantity, 0)} ITEM</p>
      <ul class="print-item-list">${itemLines}</ul>${note}
      <footer class="print-footer">Mohon siapkan pesanan ini.<br><strong>${escapeHtml(transaction.receiptNumber)}</strong></footer>
    </article>
  ` : `
    <article class="print-ticket print-customer-receipt">
      <header class="print-header"><strong>${escapeHtml(settings.storeName)}</strong><span>${escapeHtml(settings.outletName)}</span><p>BUKTI PEMBAYARAN</p></header>
      <div class="print-divider"></div>
      <div class="print-ticket-meta"><span>No. transaksi</span><strong>${escapeHtml(transaction.receiptNumber)}</strong><span>Tanggal</span><strong>${formatDate(transaction.createdAt, true)}</strong><span>Kasir</span><strong>${escapeHtml(transaction.cashier?.name || 'Kasir lama')}</strong>${transaction.cashier?.phone ? `<span>HP kasir</span><strong>${escapeHtml(transaction.cashier.phone)}</strong>` : ''}<span>Shift</span><strong>${escapeHtml(transaction.shift?.name || '—')}</strong></div>
      <div class="print-receipt-customer"><span>Pelanggan</span><strong>${escapeHtml(customer.name || 'Umum')}</strong>${customer.phone ? `<small>${escapeHtml(customer.phone)}</small>` : ''}<span>Tipe pesanan</span><strong>${escapeHtml(transaction.orderType || 'Dine in')}</strong></div>
      <div class="print-divider"></div><ul class="print-item-list">${itemLines}</ul>
      <div class="print-divider"></div>
      <div class="print-money-row"><span>Subtotal</span><strong>${formatPrice(transaction.subtotal)}</strong></div>
      <div class="print-money-row"><span>Pajak (${Number(transaction.taxRate ?? settings.taxRate) || 0}%)</span><strong>${formatPrice(transaction.tax)}</strong></div>
      <div class="print-money-row print-total-row"><span>TOTAL</span><strong>${formatPrice(transaction.total)}</strong></div>
      <div class="print-payment-meta"><div><span>Metode pembayaran</span><strong>${escapeHtml(transaction.method)}</strong></div>${transaction.method === 'Tunai' ? `<div><span>Uang diterima</span><strong>${formatPrice(transaction.cashReceived)}</strong></div><div><span>Kembalian</span><strong>${formatPrice(transaction.change)}</strong></div>` : ''}</div>
      ${note}<footer class="print-footer">Terima kasih sudah berkunjung!<br>Sampai jumpa kembali ♡</footer>
    </article>
  `;
  $('#print-area').hidden = false;
  document.body.dataset.printMode = mode;
  window.print();
}

function resetPrintMode() {
  delete document.body.dataset.printMode;
  $('#print-area').hidden = true;
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form).entries());
  input.price = Number(input.price);
  input.stock = Number(input.stock);
  $('#save-product').disabled = true;
  $('#product-error').hidden = true;
  try {
    await api(state.editingProductId ? `/api/products/${encodeURIComponent(state.editingProductId)}` : '/api/products', {
      method: state.editingProductId ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    });
    await refreshProducts();
    renderProductManagement($('#management-search')?.value || '');
    closeProductForm();
    showToast(state.editingProductId ? 'Produk berhasil diperbarui.' : 'Produk baru berhasil ditambahkan.');
  } catch (error) {
    showError($('#product-error'), error.message);
  } finally {
    $('#save-product').disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        ...state.settings,
        storeName: form.get('storeName'),
        outletName: form.get('outletName'),
        taxRate: Number(form.get('taxRate')),
      }),
    });
    $('#breadcrumb-store').textContent = state.settings.storeName;
    $('#store-switcher-name').textContent = state.settings.storeName;
    $('#store-switcher-outlet').textContent = state.settings.outletName;
    renderQris();
    renderCart();
    renderSettings();
    showToast('Pengaturan berhasil disimpan ke database.');
  } catch (error) {
    showToast(error.message, true);
  }
}

function openHistoryModal() {
  $('#history-search-input').value = '';
  $('#history-modal').hidden = false;
  $('#history-search-input').focus();
  renderHistoryModal('');
}

function renderHistoryModal(query) {
  const matching = transactions.filter((transaction) =>
    `${transaction.customer.name} ${transaction.customer.phone} ${transaction.cashier?.name || ''} ${transaction.cashier?.phone || ''} ${transaction.shift?.name || ''} ${transaction.receiptNumber} ${transaction.items.map((item) => item.name).join(' ')}`.toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID')),
  );
  $('#history-summary').innerHTML = `<span><strong>${matching.length}</strong> transaksi</span><span><strong>${new Set(matching.map((item) => item.customer.name)).size}</strong> pelanggan</span><span><strong>${formatPrice(matching.reduce((sum, item) => sum + item.total, 0))}</strong> total penjualan</span>`;
  $('#history-empty').hidden = matching.length > 0;
  $('#history-list').hidden = matching.length === 0;
  $('#history-list').innerHTML = matching.map((transaction) => `<article class="history-card"><div class="history-card-top"><div class="history-customer-avatar">${escapeHtml((transaction.customer.name || 'U').charAt(0))}</div><div class="history-customer"><strong>${escapeHtml(transaction.customer.name)}</strong><small>${escapeHtml(transaction.customer.phone || 'Pelanggan umum')}</small></div><div class="history-total"><strong>${formatPrice(transaction.total)}</strong><small>${escapeHtml(transaction.method)}</small></div></div><div class="history-card-details"><span>${escapeHtml(transaction.receiptNumber)} · ${formatDate(transaction.createdAt, true)}</span><span>${escapeHtml(transaction.orderType)}</span></div><div class="history-card-details"><span>Kasir: ${escapeHtml(transaction.cashier?.name || 'Kasir lama')}${transaction.cashier?.phone ? ` · ${escapeHtml(transaction.cashier.phone)}` : ''}</span><span>${escapeHtml(transaction.shift?.name || '—')}</span></div><p class="history-items">${transaction.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity}`).join(', ')}</p></article>`).join('');
}

productGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]');
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.add);
  if (!product || product.stock <= (cart.get(product.id) || 0)) {
    showToast('Stok produk tidak mencukupi.', true);
    return;
  }
  cart.set(product.id, (cart.get(product.id) || 0) + 1);
  renderCart();
});
cartItems.addEventListener('click', (event) => {
  const button = event.target.closest('[data-quantity]');
  if (!button) return;
  const id = button.dataset.quantity;
  const next = (cart.get(id) || 0) + Number(button.dataset.change);
  if (next < 1) cart.delete(id);
  else if (next <= products.find((item) => item.id === id).stock) cart.set(id, next);
  else return showToast('Stok produk tidak mencukupi.', true);
  renderCart();
});
$('#category-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  state.category = button.dataset.category;
  renderProducts();
});
$('#product-search').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderProducts();
});
$('#product-search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.currentTarget.value = '';
    state.search = '';
    renderProducts();
  }
});
$('#sort-button').addEventListener('click', (event) => {
  state.sort = state.sort === 'popular' ? 'price' : 'popular';
  event.currentTarget.innerHTML = `<span aria-hidden="true">☷</span> ${state.sort === 'popular' ? 'Populer' : 'Harga terendah'} <span class="filter-chevron" aria-hidden="true">⌄</span>`;
  renderProducts();
});
$('#view-all').addEventListener('click', () => {
  state.category = 'Semua';
  state.search = '';
  $('#product-search').value = '';
  renderProducts();
});
$('.segmented-control').addEventListener('click', (event) => {
  const button = event.target.closest('[data-order-type]');
  if (!button) return;
  state.orderType = button.dataset.orderType;
  $('.segmented-control').querySelector('.is-selected').classList.remove('is-selected');
  button.classList.add('is-selected');
});
$('#clear-cart').addEventListener('click', () => {
  if (cart.size === 0) return showToast('Pesanan masih kosong.');
  cart.clear();
  renderCart();
  showToast('Semua menu dihapus dari pesanan.');
});
$('#customer-button').addEventListener('click', () => openCustomerForm());
$('#customer-name').addEventListener('click', () => openCustomerForm());
$('#customer-input').addEventListener('input', (event) => {
  const match = customers.find((customer) => customer.name.toLocaleLowerCase('id-ID') === event.target.value.trim().toLocaleLowerCase('id-ID'));
  if (match) $('#customer-phone-input').value = match.phone;
});
$('#customer-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') saveCustomer(event); });
$('#save-customer').addEventListener('click', saveCustomer);
$('#select-guest').addEventListener('click', () => {
  state.customer = { id: null, name: 'Umum', phone: '' };
  renderCustomer();
  $('#customer-modal').hidden = true;
});
$('#close-customer').addEventListener('click', closeCustomerForm);
$('#customer-modal').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeCustomerForm(); });
$('#history-search-input').addEventListener('input', (event) => renderHistoryModal(event.target.value));
$('#close-history').addEventListener('click', () => { $('#history-modal').hidden = true; });
$('#history-modal').addEventListener('click', (event) => { if (event.target === event.currentTarget) $('#history-modal').hidden = true; });
$('#checkout-button').addEventListener('click', openPaymentModal);
$('#profile-button').addEventListener('click', () => {
  renderCashierModal();
  $('#cashier-modal').hidden = false;
  $('#cashier-name-input').focus();
});
$('#close-cashier').addEventListener('click', () => { $('#cashier-modal').hidden = true; });
$('#cashier-modal').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) $('#cashier-modal').hidden = true;
});
$('#cashier-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#start-shift');
  const activeShift = state.cashierState.activeShift;
  if (activeShift && !window.confirm(`Akhiri ${activeShift.name} (${activeShift.cashier.name}) dan mulai shift baru?`)) return;
  button.disabled = true;
  try {
    await api('/api/shifts', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#cashier-name-input').value,
        phone: $('#cashier-phone-input').value,
        shiftName: $('#cashier-shift-input').value,
      }),
    });
    await refreshCashierState();
    renderCart();
    showToast(activeShift ? 'Pergantian kasir dan shift berhasil disimpan.' : 'Shift berhasil dimulai.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('#save-cashier').addEventListener('click', async () => {
  const shift = state.cashierState.activeShift;
  if (!shift) return;
  const button = $('#save-cashier');
  button.disabled = true;
  try {
    await api(`/api/cashiers/${encodeURIComponent(shift.cashier.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: $('#cashier-name-input').value, phone: $('#cashier-phone-input').value }),
    });
    await refreshCashierState();
    showToast('Profil kasir berhasil diperbarui.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('#end-shift').addEventListener('click', async () => {
  const shift = state.cashierState.activeShift;
  if (!shift || !window.confirm(`Akhiri ${shift.name} untuk ${shift.cashier.name}? Transaksi baru memerlukan shift aktif.`)) return;
  const button = $('#end-shift');
  button.disabled = true;
  try {
    await api('/api/shifts/close', { method: 'POST', body: JSON.stringify({}) });
    await refreshCashierState();
    renderCart();
    showToast('Shift berakhir. Mulai shift baru sebelum memproses transaksi.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('#cash-amount-input').addEventListener('input', updatePaymentForm);
$('#close-payment').addEventListener('click', () => { $('#payment-modal').hidden = true; });
$('#payment-modal').addEventListener('click', (event) => { if (event.target === event.currentTarget) $('#payment-modal').hidden = true; });
$('#confirm-payment').addEventListener('click', completePayment);
$('#new-order').addEventListener('click', () => { $('#success-modal').hidden = true; $('#product-search').focus(); });
$('#success-modal').addEventListener('click', (event) => { if (event.target === event.currentTarget) $('#success-modal').hidden = true; });
$('#print-receipt').addEventListener('click', () => printTransaction(state.lastTransaction, 'receipt'));
$('#print-kitchen').addEventListener('click', () => printTransaction(state.lastTransaction, 'kitchen'));
window.addEventListener('afterprint', resetPrintMode);
document.querySelectorAll('input[name="payment-method"]').forEach((input) => input.addEventListener('change', (event) => {
  state.paymentMethod = event.currentTarget.value;
  document.querySelectorAll('.payment-option').forEach((option) => option.classList.toggle('is-selected', option.contains(event.currentTarget)));
  updatePaymentForm();
}));
$('.notification-button').addEventListener('click', () => {
  const lowStock = products.filter((product) => product.active && product.stock <= 3);
  showToast(lowStock.length
    ? `Stok menipis: ${lowStock.map((product) => `${product.name} (${product.stock})`).join(', ')}.`
    : 'Tidak ada notifikasi stok menipis.');
});
$('#qris-upload').addEventListener('change', handleQrisUpload);
document.addEventListener('change', (event) => {
  if (event.target.id === 'settings-qris-upload') handleQrisUpload(event);
});
$('#product-form').addEventListener('submit', saveProduct);
$('#close-product').addEventListener('click', closeProductForm);
$('#product-modal').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeProductForm(); });
document.addEventListener('submit', (event) => {
  if (event.target.id === 'settings-form') saveSettings(event);
});

document.addEventListener('click', async (event) => {
  const receiptPrint = event.target.closest('[data-print-receipt]');
  const kitchenPrint = event.target.closest('[data-print-kitchen]');
  if (receiptPrint || kitchenPrint) {
    const transactionId = (receiptPrint || kitchenPrint).dataset.printReceipt || kitchenPrint.dataset.printKitchen;
    try {
      const transaction = await api(`/api/transactions/${encodeURIComponent(transactionId)}`);
      printTransaction(transaction, receiptPrint ? 'receipt' : 'kitchen');
    } catch (error) {
      showToast(error.message, true);
    }
    return;
  }
  const pageButton = event.target.closest('[data-page]');
  const pageLink = event.target.closest('[data-page-link]');
  const openPage = event.target.closest('[data-open-page]');
  if (pageButton || pageLink || openPage) {
    event.preventDefault();
    await setPage((pageButton || pageLink || openPage).dataset.page || (pageButton || pageLink || openPage).dataset.pageLink || (pageButton || pageLink || openPage).dataset.openPage);
    return;
  }
  if (event.target.closest('[data-add-product]')) return openProductForm();
  const editProduct = event.target.closest('[data-edit-product]');
  if (editProduct) return openProductForm(products.find((item) => item.id === editProduct.dataset.editProduct));
  const archiveProduct = event.target.closest('[data-archive-product]');
  const restoreProduct = event.target.closest('[data-restore-product]');
  if (archiveProduct || restoreProduct) {
    const id = (archiveProduct || restoreProduct).dataset.archiveProduct || restoreProduct.dataset.restoreProduct;
    const product = products.find((item) => item.id === id);
    if (archiveProduct && !window.confirm(`Arsipkan "${product.name}"? Produk tidak akan tersedia pada kasir, tetapi riwayat transaksi tetap tersimpan.`)) return;
    try {
      if (archiveProduct) await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      else await api(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ...product, active: true }) });
      await refreshProducts();
      renderProductManagement($('#management-search')?.value || '');
      showToast(archiveProduct ? 'Produk berhasil diarsipkan.' : 'Produk berhasil dipulihkan.');
    } catch (error) { showToast(error.message, true); }
    return;
  }
  if (event.target.closest('[data-add-customer]')) return openCustomerForm({ name: '', phone: '' });
  const editCustomer = event.target.closest('[data-edit-customer]');
  if (editCustomer) return openCustomerForm(customers.find((item) => item.id === editCustomer.dataset.editCustomer));
  const deleteCustomer = event.target.closest('[data-delete-customer]');
  if (deleteCustomer) {
    const customer = customers.find((item) => item.id === deleteCustomer.dataset.deleteCustomer);
    if (!window.confirm(`Hapus data pelanggan "${customer.name}"? Transaksi lama akan tetap tersimpan.`)) return;
    try {
      await api(`/api/customers/${encodeURIComponent(customer.id)}`, { method: 'DELETE' });
      if (state.customer.id === customer.id) {
        state.customer = { id: null, name: 'Umum', phone: '' };
        renderCustomer();
      }
      await refreshCustomers();
      renderCustomerManagement($('#management-search')?.value || '');
      showToast('Data pelanggan berhasil dihapus.');
    } catch (error) { showToast(error.message, true); }
    return;
  }
  const customerHistory = event.target.closest('[data-customer-history]');
  if (customerHistory) {
    const customer = customers.find((item) => item.id === customerHistory.dataset.customerHistory);
    await setPage('history');
    $('#management-search').value = customer.name;
    renderHistoryView(customer.name);
    return;
  }
  if (event.target.closest('[data-refresh-history]')) {
    await refreshTransactions();
    renderHistoryView($('#management-search')?.value || '');
    return;
  }
  const receipt = event.target.closest('[data-receipt]');
  if (receipt) {
    await setPage('history');
    $('#management-search').value = receipt.dataset.receipt;
    renderHistoryView(receipt.dataset.receipt);
    return;
  }
  if (event.target.closest('[data-remove-qris]')) {
    if (!window.confirm('Hapus gambar QRIS merchant dari database?')) return;
    try {
      state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...state.settings, qrisImage: '' }) });
      renderSettings();
      renderQris();
      showToast('Gambar QRIS dihapus.');
    } catch (error) { showToast(error.message, true); }
  }
  const retry = event.target.closest('[data-retry-page]');
  if (retry) await setPage(retry.dataset.retryPage);
});

document.addEventListener('input', (event) => {
  if (event.target.id !== 'management-search') return;
  const query = event.target.value;
  if (state.currentPage === 'products') renderProductManagement(query);
  if (state.currentPage === 'customers') renderCustomerManagement(query);
  if (state.currentPage === 'history') renderHistoryView(query);
  const refreshedSearch = $('#management-search');
  if (refreshedSearch) {
    refreshedSearch.focus();
    refreshedSearch.setSelectionRange(query.length, query.length);
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('#product-search').focus();
  }
  if (event.key === 'Escape') {
    if (!$('#payment-modal').hidden) $('#payment-modal').hidden = true;
    if (!$('#success-modal').hidden) $('#success-modal').hidden = true;
    if (!$('#customer-modal').hidden) $('#customer-modal').hidden = true;
    if (!$('#history-modal').hidden) $('#history-modal').hidden = true;
    if (!$('#product-modal').hidden) closeProductForm();
  }
});

const mobileMenuButton = $('.mobile-menu-button');
mobileMenuButton.addEventListener('click', () => {
  const isOpen = mobileMenuButton.getAttribute('aria-expanded') === 'true';
  mobileMenuButton.setAttribute('aria-expanded', String(!isOpen));
  mobileMenuButton.setAttribute('aria-label', isOpen ? 'Buka navigasi' : 'Tutup navigasi');
  $('#sidebar').classList.toggle('is-open', !isOpen);
});
document.addEventListener('click', (event) => {
  if (!$('#sidebar').contains(event.target) && !mobileMenuButton.contains(event.target)) {
    $('#sidebar').classList.remove('is-open');
    mobileMenuButton.setAttribute('aria-expanded', 'false');
    mobileMenuButton.setAttribute('aria-label', 'Buka navigasi');
  }
});

loadApp();

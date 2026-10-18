import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dataDirectory = resolve(root, 'data');
mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(resolve(dataDirectory, 'ruang-kasir.sqlite'));
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK (price >= 0),
    emoji TEXT NOT NULL DEFAULT '🍽️',
    color TEXT NOT NULL DEFAULT '#edf2e8',
    badge TEXT NOT NULL DEFAULT 'MENU',
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique
    ON customers(phone) WHERE phone <> '';

  CREATE TABLE IF NOT EXISTS cashiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS cashiers_phone_unique
    ON cashiers(phone) WHERE phone <> '';

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    cashier_id TEXT NOT NULL REFERENCES cashiers(id) ON DELETE RESTRICT,
    shift_name TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    cashier_phone TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX IF NOT EXISTS shifts_started_at ON shifts(started_at);

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    receipt_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL DEFAULT 'Umum',
    customer_phone TEXT NOT NULL DEFAULT '',
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
    tax INTEGER NOT NULL CHECK (tax >= 0),
    tax_rate INTEGER NOT NULL DEFAULT 10,
    cashier_id TEXT REFERENCES cashiers(id) ON DELETE SET NULL,
    shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL,
    cashier_name TEXT NOT NULL DEFAULT 'Nadia Putri',
    cashier_phone TEXT NOT NULL DEFAULT '',
    shift_name TEXT NOT NULL DEFAULT 'Shift pagi',
    total INTEGER NOT NULL CHECK (total >= 0),
    payment_method TEXT NOT NULL,
    cash_received INTEGER NOT NULL DEFAULT 0,
    change_amount INTEGER NOT NULL DEFAULT 0,
    order_type TEXT NOT NULL DEFAULT 'Dine in',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS transactions_created_at ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS transactions_customer_id ON transactions(customer_id);

  CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    product_id TEXT,
    product_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
const transactionColumns = new Set(database.prepare('PRAGMA table_info(transactions)').all().map((column) => column.name));
if (!transactionColumns.has('tax_rate')) {
  database.exec('ALTER TABLE transactions ADD COLUMN tax_rate INTEGER NOT NULL DEFAULT 10');
}
const transactionCashierMigrations = {
  cashier_id: "TEXT REFERENCES cashiers(id) ON DELETE SET NULL",
  shift_id: "TEXT REFERENCES shifts(id) ON DELETE SET NULL",
  cashier_name: "TEXT NOT NULL DEFAULT 'Nadia Putri'",
  cashier_phone: "TEXT NOT NULL DEFAULT ''",
  shift_name: "TEXT NOT NULL DEFAULT 'Shift pagi'",
};
for (const [column, definition] of Object.entries(transactionCashierMigrations)) {
  if (!transactionColumns.has(column)) database.exec(`ALTER TABLE transactions ADD COLUMN ${column} ${definition}`);
}

const seedProducts = [
  ['aren-latte', 'Aren Latte', 'Kopi', 'Espresso · Susu · Gula aren', 28000, '🥤', '#f2dfcb', 'TERLARIS', 18],
  ['kopi-susu', 'Kopi Susu Tetangga', 'Kopi', 'Espresso · Susu segar', 24000, '☕', '#eadbc9', 'FAVORIT', 12],
  ['butterscotch', 'Butterscotch Latte', 'Kopi', 'Espresso · Butterscotch', 32000, '🥛', '#f5e2bd', 'BARU', 9],
  ['matcha', 'Matcha Cloud', 'Non-kopi', 'Matcha · Susu oat · Cream', 30000, '🍵', '#dce9cf', 'FAVORIT', 14],
  ['cokelat', 'Cokelat Senja', 'Non-kopi', 'Cokelat premium · Susu', 27000, '🍫', '#eddbd1', 'HIT', 11],
  ['croissant', 'Croissant Butter', 'Makanan', 'Pastry butter · Panggang', 22000, '🥐', '#f4e2c4', 'FRESH', 7],
  ['chicken-sandwich', 'Chicken Sandwich', 'Makanan', 'Ayam · Selada · Saus spesial', 35000, '🥪', '#e6ead6', 'FAVORIT', 8],
  ['pisang-goreng', 'Pisang Goreng Madu', 'Camilan', 'Pisang · Madu · Wijen', 20000, '🍌', '#f5e8bd', 'MANIS', 10],
];
const insertSeedProduct = database.prepare(`
  INSERT OR IGNORE INTO products (id, name, category, description, price, emoji, color, badge, stock)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const product of seedProducts) insertSeedProduct.run(...product);

const defaultSettings = {
  storeName: 'Ruang Rasa',
  outletName: 'Outlet Surabaya',
  taxRate: '10',
  qrisImage: '',
};
const putSetting = database.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) putSetting.run(key, value);

const activeShiftSetting = database.prepare("SELECT value FROM settings WHERE key='activeShiftId'").get();
const activeShift = activeShiftSetting
  ? database.prepare('SELECT id FROM shifts WHERE id=? AND ended_at IS NULL').get(activeShiftSetting.value)
  : null;
const shiftCount = Number(database.prepare('SELECT COUNT(*) AS count FROM shifts').get().count);
if (!activeShift && shiftCount === 0) {
  const existingCashier = database.prepare("SELECT * FROM cashiers WHERE name='Nadia Putri' ORDER BY created_at LIMIT 1").get();
  const cashierId = existingCashier?.id || randomUUID();
  if (!existingCashier) database.prepare("INSERT INTO cashiers (id,name,phone) VALUES (?,'Nadia Putri','')").run(cashierId);
  const shiftId = randomUUID();
  const startedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO shifts (id,cashier_id,shift_name,cashier_name,cashier_phone,started_at)
    VALUES (?,?,'Shift pagi','Nadia Putri','',?)
  `).run(shiftId, cashierId, startedAt);
  database.prepare("INSERT INTO settings (key,value) VALUES ('activeShiftId',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(shiftId);
} else if (!activeShift && activeShiftSetting?.value) {
  database.prepare("UPDATE settings SET value='' WHERE key='activeShiftId'").run();
}

const statements = {
  allProducts: database.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE'),
  allProductsIncludingInactive: database.prepare('SELECT * FROM products ORDER BY active DESC, name COLLATE NOCASE'),
  productById: database.prepare('SELECT * FROM products WHERE id = ?'),
  allCustomers: database.prepare(`
    SELECT c.id, c.name, c.phone, c.created_at,
      COUNT(t.id) AS transaction_count,
      COALESCE(SUM(t.total), 0) AS total_spent,
      MAX(t.created_at) AS last_purchase
    FROM customers c LEFT JOIN transactions t ON t.customer_id = c.id
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `),
  customerById: database.prepare('SELECT * FROM customers WHERE id = ?'),
  customerByPhone: database.prepare('SELECT * FROM customers WHERE phone = ? AND phone <> \'\''),
  customerByName: database.prepare('SELECT * FROM customers WHERE name = ? COLLATE NOCASE AND phone = \'\''),
  allCashiers: database.prepare(`
    SELECT c.id, c.name, c.phone, c.created_at,
      COUNT(t.id) AS transaction_count,
      COALESCE(SUM(t.total), 0) AS total_sales
    FROM cashiers c LEFT JOIN transactions t ON t.cashier_id = c.id
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `),
  cashierById: database.prepare('SELECT * FROM cashiers WHERE id=?'),
  cashierByPhone: database.prepare('SELECT * FROM cashiers WHERE phone=? AND phone<>\'\''),
  currentShift: database.prepare(`
    SELECT s.*, c.name AS current_name, c.phone AS current_phone
    FROM settings setting JOIN shifts s ON s.id=setting.value
    JOIN cashiers c ON c.id=s.cashier_id
    WHERE setting.key='activeShiftId' AND s.ended_at IS NULL
  `),
  recentShifts: database.prepare(`
    SELECT * FROM shifts ORDER BY started_at DESC LIMIT 30
  `),
  allTransactions: database.prepare(`
    SELECT * FROM transactions
    WHERE (? = '' OR lower(customer_name || ' ' || customer_phone || ' ' || cashier_name || ' ' || cashier_phone || ' ' || shift_name || ' ' || receipt_number) LIKE ?)
    ORDER BY created_at DESC
  `),
  transactionById: database.prepare('SELECT * FROM transactions WHERE id = ? OR receipt_number = ?'),
  transactionItems: database.prepare('SELECT * FROM transaction_items WHERE transaction_id = ? ORDER BY id'),
  getSettings: database.prepare('SELECT key, value FROM settings'),
  getSetting: database.prepare('SELECT value FROM settings WHERE key = ?'),
};

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 2_000_000) {
        rejectBody(Object.assign(new Error('Ukuran data melebihi batas 2 MB.'), { status: 413 }));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        rejectBody(Object.assign(new Error('Format JSON tidak valid.'), { status: 400 }));
      }
    });
    request.on('error', rejectBody);
  });
}

function requiredText(value, label, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw Object.assign(new Error(`${label} wajib diisi dan maksimal ${maxLength} karakter.`), { status: 400 });
  }
  return value.trim();
}

function optionalText(value, label, maxLength = 500) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw Object.assign(new Error(`${label} maksimal ${maxLength} karakter.`), { status: 400 });
  }
  return value.trim();
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw Object.assign(new Error(`${label} harus berupa bilangan bulat nol atau lebih.`), { status: 400 });
  }
  return number;
}

function serializeProduct(product) {
  return { ...product, price: Number(product.price), stock: Number(product.stock), active: Boolean(product.active) };
}

function getSettings() {
  return Object.fromEntries(statements.getSettings.all().map(({ key, value }) => [key, value]));
}

function serializeShift(shift) {
  if (!shift) return null;
  const cashierName = shift.current_name || shift.cashier_name;
  const cashierPhone = shift.current_phone ?? shift.cashier_phone;
  return {
    id: shift.id,
    cashier: { id: shift.cashier_id, name: cashierName, phone: cashierPhone },
    name: shift.shift_name,
    startedAt: shift.started_at,
    endedAt: shift.ended_at,
    active: !shift.ended_at,
  };
}

function getCashierState() {
  return {
    activeShift: serializeShift(statements.currentShift.get()),
    cashiers: statements.allCashiers.all().map((cashier) => ({
      ...cashier,
      transaction_count: Number(cashier.transaction_count),
      total_sales: Number(cashier.total_sales),
    })),
    recentShifts: statements.recentShifts.all().map(serializeShift),
  };
}

function upsertCashier(input, existingId = '') {
  const name = requiredText(input.name, 'Nama kasir', 80);
  const phone = requiredText(input.phone, 'Nomor HP kasir', 24);
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15 || !/^\+?[0-9\s().-]+$/.test(phone)) {
    throw Object.assign(new Error('Nomor HP kasir harus berisi 8 sampai 15 digit yang valid.'), { status: 400 });
  }
  if (existingId) {
    const existing = statements.cashierById.get(existingId);
    if (!existing) throw Object.assign(new Error('Data kasir tidak ditemukan.'), { status: 404 });
    const phoneMatch = phone ? statements.cashierByPhone.get(phone) : null;
    if (phoneMatch && phoneMatch.id !== existingId) {
      throw Object.assign(new Error('Nomor HP sudah digunakan kasir lain.'), { status: 409 });
    }
    database.prepare('UPDATE cashiers SET name=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, phone, existingId);
    return statements.cashierById.get(existingId);
  }
  const existing = phone ? statements.cashierByPhone.get(phone) : null;
  if (existing) {
    database.prepare('UPDATE cashiers SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, existing.id);
    return statements.cashierById.get(existing.id);
  }
  const id = randomUUID();
  database.prepare('INSERT INTO cashiers (id,name,phone) VALUES (?,?,?)').run(id, name, phone);
  return statements.cashierById.get(id);
}

function startShift(input) {
  const shiftName = requiredText(input.shiftName, 'Nama shift', 40);
  const startedAt = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    const cashier = upsertCashier(input);
    const previousShift = statements.currentShift.get();
    if (previousShift) {
      database.prepare('UPDATE shifts SET ended_at=? WHERE id=? AND ended_at IS NULL').run(startedAt, previousShift.id);
    }
    const shiftId = randomUUID();
    database.prepare(`
      INSERT INTO shifts (id,cashier_id,shift_name,cashier_name,cashier_phone,started_at)
      VALUES (?,?,?,?,?,?)
    `).run(shiftId, cashier.id, shiftName, cashier.name, cashier.phone, startedAt);
    database.prepare("INSERT INTO settings (key,value) VALUES ('activeShiftId',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(shiftId);
    database.exec('COMMIT');
    return serializeShift(statements.currentShift.get());
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function updateActiveCashier(input, id) {
  const cashier = upsertCashier(input, id);
  const activeShift = statements.currentShift.get();
  if (activeShift?.cashier_id === id) {
    database.prepare('UPDATE shifts SET cashier_name=?,cashier_phone=? WHERE id=?').run(cashier.name, cashier.phone, activeShift.id);
  }
  return { cashier, activeShift: serializeShift(statements.currentShift.get()) };
}

function closeActiveShift() {
  const activeShift = statements.currentShift.get();
  if (!activeShift) throw Object.assign(new Error('Tidak ada shift aktif yang dapat diakhiri.'), { status: 409 });
  const endedAt = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('UPDATE shifts SET ended_at=? WHERE id=? AND ended_at IS NULL').run(endedAt, activeShift.id);
    database.prepare("UPDATE settings SET value='' WHERE key='activeShiftId'").run();
    database.exec('COMMIT');
    return serializeShift(database.prepare('SELECT * FROM shifts WHERE id=?').get(activeShift.id));
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function serializeTransaction(transaction) {
  const items = statements.transactionItems.all(transaction.id).map((item) => ({
    productId: item.product_id,
    name: item.product_name,
    price: Number(item.unit_price),
    quantity: Number(item.quantity),
    lineTotal: Number(item.line_total),
  }));
  return {
    id: transaction.id,
    receiptNumber: transaction.receipt_number,
    customer: { id: transaction.customer_id, name: transaction.customer_name, phone: transaction.customer_phone },
    subtotal: Number(transaction.subtotal),
    tax: Number(transaction.tax),
    taxRate: Number(transaction.tax_rate),
    cashier: {
      id: transaction.cashier_id,
      name: transaction.cashier_name,
      phone: transaction.cashier_phone,
    },
    shift: { id: transaction.shift_id, name: transaction.shift_name },
    total: Number(transaction.total),
    method: transaction.payment_method,
    cashReceived: Number(transaction.cash_received),
    change: Number(transaction.change_amount),
    orderType: transaction.order_type,
    note: transaction.note,
    createdAt: transaction.created_at,
    items,
  };
}

function saveProduct(input, id = randomUUID()) {
  const product = {
    id,
    name: requiredText(input.name, 'Nama produk', 100),
    category: requiredText(input.category, 'Kategori', 60),
    description: optionalText(input.description, 'Deskripsi', 250),
    price: nonnegativeInteger(input.price, 'Harga'),
    emoji: optionalText(input.emoji || '🍽️', 'Ikon', 16),
    color: /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color : '#edf2e8',
    badge: optionalText(input.badge || 'MENU', 'Label', 24).toLocaleUpperCase('id-ID'),
    stock: nonnegativeInteger(input.stock ?? 0, 'Stok'),
  };
  const existing = statements.productById.get(id);
  if (existing) {
    database.prepare(`
      UPDATE products SET name=?, category=?, description=?, price=?, emoji=?, color=?, badge=?, stock=?,
      active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(product.name, product.category, product.description, product.price, product.emoji, product.color, product.badge, product.stock, id);
  } else {
    database.prepare(`
      INSERT INTO products (id,name,category,description,price,emoji,color,badge,stock)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(product.id, product.name, product.category, product.description, product.price, product.emoji, product.color, product.badge, product.stock);
  }
  return serializeProduct(statements.productById.get(id));
}

function saveCustomer(input, id = randomUUID()) {
  const name = requiredText(input.name, 'Nama pelanggan', 80);
  const phone = optionalText(input.phone, 'Nomor telepon', 24);
  if (id !== null) {
    const existing = statements.customerById.get(id);
    if (existing) {
      const phoneMatch = phone ? statements.customerByPhone.get(phone) : null;
      if (phoneMatch && phoneMatch.id !== id) {
        throw Object.assign(new Error('Nomor telepon sudah digunakan pelanggan lain.'), { status: 409 });
      }
      database.prepare('UPDATE customers SET name=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, phone, id);
      return statements.customerById.get(id);
    }
  }
  const existing = phone ? statements.customerByPhone.get(phone) : statements.customerByName.get(name);
  if (existing) {
    database.prepare('UPDATE customers SET name=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, phone, existing.id);
    return statements.customerById.get(existing.id);
  }
  const customerId = id || randomUUID();
  database.prepare('INSERT INTO customers (id,name,phone) VALUES (?,?,?)').run(customerId, name, phone);
  return statements.customerById.get(customerId);
}

function createTransaction(input) {
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) {
    throw Object.assign(new Error('Pesanan harus memiliki 1 sampai 100 item.'), { status: 400 });
  }
  const allowedMethods = new Set(['Tunai', 'QRIS', 'Kartu debit']);
  const method = requiredText(input.method, 'Metode pembayaran', 30);
  if (!allowedMethods.has(method)) throw Object.assign(new Error('Metode pembayaran tidak valid.'), { status: 400 });
  const orderType = input.orderType === 'Take away' ? 'Take away' : 'Dine in';
  const customer = input.customerId ? statements.customerById.get(input.customerId) : null;
  if (input.customerId && !customer) throw Object.assign(new Error('Pelanggan tidak ditemukan.'), { status: 404 });
  const taxRate = Number(statements.getSetting.get('taxRate')?.value || 0);

  database.exec('BEGIN IMMEDIATE');
  try {
    const activeShift = statements.currentShift.get();
    if (!activeShift) {
      throw Object.assign(new Error('Tidak ada kasir aktif. Mulai shift sebelum membuat transaksi.'), { status: 409 });
    }
    if (!activeShift.cashier_phone || activeShift.cashier_phone.replace(/\D/g, '').length < 8) {
      throw Object.assign(new Error('Lengkapi nomor HP kasir sebelum membuat transaksi.'), { status: 409 });
    }
    const items = input.items.map((requestedItem) => {
      const productId = requiredText(requestedItem.productId, 'Produk', 100);
      const quantity = nonnegativeInteger(requestedItem.quantity, 'Jumlah');
      if (quantity < 1) throw Object.assign(new Error('Jumlah item minimal satu.'), { status: 400 });
      const product = statements.productById.get(productId);
      if (!product || !product.active) throw Object.assign(new Error(`Produk ${productId} tidak tersedia.`), { status: 409 });
      if (product.stock < quantity) throw Object.assign(new Error(`Stok ${product.name} tidak mencukupi.`), { status: 409 });
      return { product, quantity, lineTotal: Number(product.price) * quantity };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const tax = Math.round(subtotal * taxRate / 100);
    const total = subtotal + tax;
    const cashReceived = method === 'Tunai' ? nonnegativeInteger(input.cashReceived, 'Uang diterima') : total;
    if (method === 'Tunai' && cashReceived < total) {
      throw Object.assign(new Error('Jumlah uang tunai belum mencukupi.'), { status: 400 });
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const datePart = createdAt.slice(0, 10).replaceAll('-', '');
    const receiptNumber = `RR-${datePart}-${id.slice(0, 6).toUpperCase()}`;
    const customerName = customer?.name || 'Umum';
    const customerPhone = customer?.phone || '';
    const note = optionalText(input.note, 'Catatan', 100);
    database.prepare(`
      INSERT INTO transactions
      (id,receipt_number,customer_id,customer_name,customer_phone,subtotal,tax,tax_rate,cashier_id,shift_id,cashier_name,cashier_phone,shift_name,total,payment_method,cash_received,change_amount,order_type,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, receiptNumber, customer?.id || null, customerName, customerPhone, subtotal, tax, taxRate,
      activeShift.cashier_id, activeShift.id, activeShift.cashier_name, activeShift.cashier_phone, activeShift.shift_name,
      total, method, cashReceived, cashReceived - total, orderType, note, createdAt,
    );
    const addItem = database.prepare(`
      INSERT INTO transaction_items (transaction_id,product_id,product_name,unit_price,quantity,line_total)
      VALUES (?,?,?,?,?,?)
    `);
    const reduceStock = database.prepare('UPDATE products SET stock=stock-?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock>=?');
    for (const item of items) {
      addItem.run(id, item.product.id, item.product.name, item.product.price, item.quantity, item.lineTotal);
      const result = reduceStock.run(item.quantity, item.product.id, item.quantity);
      if (Number(result.changes) !== 1) throw Object.assign(new Error(`Stok ${item.product.name} berubah. Muat ulang produk dan coba lagi.`), { status: 409 });
    }
    database.exec('COMMIT');
    return serializeTransaction(statements.transactionById.get(id, receiptNumber));
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/health' && method === 'GET') {
    return json(response, 200, { status: 'ok', database: 'SQLite', file: 'data/ruang-kasir.sqlite' });
  }
  if (path === '/api/shift' && method === 'GET') return json(response, 200, getCashierState());
  if (path === '/api/shifts' && method === 'POST') return json(response, 201, startShift(await readBody(request)));
  if (path === '/api/shifts/close' && method === 'POST') return json(response, 200, closeActiveShift());
  const cashierRoute = path.match(/^\/api\/cashiers\/([^/]+)$/);
  if (cashierRoute && method === 'PUT') {
    const id = decodeURIComponent(cashierRoute[1]);
    return json(response, 200, updateActiveCashier(await readBody(request), id));
  }

  if (path === '/api/products' && method === 'GET') {
    return json(response, 200, statements.allProductsIncludingInactive.all().map(serializeProduct));
  }
  if (path === '/api/products' && method === 'POST') {
    return json(response, 201, saveProduct(await readBody(request)));
  }
  const productRoute = path.match(/^\/api\/products\/([^/]+)$/);
  if (productRoute && method === 'PUT') {
    const id = decodeURIComponent(productRoute[1]);
    if (!statements.productById.get(id)) return json(response, 404, { error: 'Produk tidak ditemukan.' });
    return json(response, 200, saveProduct(await readBody(request), id));
  }
  if (productRoute && method === 'DELETE') {
    const id = decodeURIComponent(productRoute[1]);
    const result = database.prepare('UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=? AND active=1').run(id);
    if (Number(result.changes) !== 1) return json(response, 404, { error: 'Produk tidak ditemukan atau sudah diarsipkan.' });
    return json(response, 200, { success: true });
  }

  if (path === '/api/customers' && method === 'GET') return json(response, 200, statements.allCustomers.all());
  if (path === '/api/customers' && method === 'POST') return json(response, 201, saveCustomer(await readBody(request)));
  const customerRoute = path.match(/^\/api\/customers\/([^/]+)$/);
  if (customerRoute && method === 'PUT') {
    const id = decodeURIComponent(customerRoute[1]);
    if (!statements.customerById.get(id)) return json(response, 404, { error: 'Pelanggan tidak ditemukan.' });
    return json(response, 200, saveCustomer(await readBody(request), id));
  }
  if (customerRoute && method === 'DELETE') {
    const id = decodeURIComponent(customerRoute[1]);
    const result = database.prepare('DELETE FROM customers WHERE id=?').run(id);
    if (Number(result.changes) !== 1) return json(response, 404, { error: 'Pelanggan tidak ditemukan.' });
    return json(response, 200, { success: true });
  }

  if (path === '/api/transactions' && method === 'GET') {
    const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase('id-ID');
    const pattern = query ? `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%` : '';
    const transactions = statements.allTransactions.all(query ? query : '', pattern).map(serializeTransaction);
    return json(response, 200, transactions);
  }
  if (path === '/api/transactions' && method === 'POST') return json(response, 201, createTransaction(await readBody(request)));
  const transactionRoute = path.match(/^\/api\/transactions\/([^/]+)$/);
  if (transactionRoute && method === 'GET') {
    const key = decodeURIComponent(transactionRoute[1]);
    const transaction = statements.transactionById.get(key, key);
    if (!transaction) return json(response, 404, { error: 'Transaksi tidak ditemukan.' });
    return json(response, 200, serializeTransaction(transaction));
  }
  if (path === '/api/dashboard' && method === 'GET') {
    const today = database.prepare(`
      SELECT COUNT(*) AS transaction_count, COALESCE(SUM(total), 0) AS sales_total
      FROM transactions WHERE date(created_at, 'localtime') = date('now', 'localtime')
    `).get();
    const products = database.prepare('SELECT COUNT(*) AS product_count, COALESCE(SUM(stock), 0) AS units_in_stock FROM products WHERE active=1').get();
    const customers = database.prepare('SELECT COUNT(*) AS customer_count FROM customers').get();
    const allTransactions = database.prepare('SELECT COUNT(*) AS transaction_count FROM transactions').get();
    const recent = database.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 6').all().map(serializeTransaction);
    const daily = database.prepare(`
      SELECT date(created_at, 'localtime') AS day, COUNT(*) AS transactions, SUM(total) AS sales
      FROM transactions WHERE created_at >= datetime('now', '-6 days')
      GROUP BY date(created_at, 'localtime') ORDER BY day
    `).all();
    return json(response, 200, {
      transactionsToday: Number(today.transaction_count),
      salesToday: Number(today.sales_total),
      productCount: Number(products.product_count),
      stockUnits: Number(products.units_in_stock),
      customerCount: Number(customers.customer_count),
      totalTransactions: Number(allTransactions.transaction_count),
      recentTransactions: recent,
      dailySales: daily,
    });
  }
  if (path === '/api/settings' && method === 'GET') return json(response, 200, getSettings());
  if (path === '/api/settings' && method === 'PUT') {
    const input = await readBody(request);
    const settings = {
      storeName: requiredText(input.storeName, 'Nama usaha', 80),
      outletName: requiredText(input.outletName, 'Nama outlet', 80),
      taxRate: String(nonnegativeInteger(input.taxRate, 'Pajak')),
      qrisImage: optionalText(input.qrisImage, 'Gambar QRIS', 1_500_000),
    };
    if (Number(settings.taxRate) > 100) return json(response, 400, { error: 'Pajak tidak boleh lebih dari 100%.' });
    if (settings.qrisImage && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(settings.qrisImage)) {
      return json(response, 400, { error: 'Format QRIS tidak valid.' });
    }
    const saveSetting = database.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [key, value] of Object.entries(settings)) saveSetting.run(key, value);
    return json(response, 200, settings);
  }

  return json(response, 404, { error: 'Endpoint tidak ditemukan.' });
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const target = resolve(root, `.${requestedPath}`);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }
  if (!existsSync(target)) {
    response.writeHead(404);
    return response.end('Not found');
  }
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
  createReadStream(target).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      serveStatic(response, url.pathname);
    } else {
      json(response, 405, { error: 'Metode HTTP tidak diizinkan.' });
    }
  } catch (error) {
    console.error(`${request.method} ${request.url}:`, error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Terjadi kesalahan pada server lokal.' });
    else response.destroy(error);
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`Ruang Kasir berjalan di http://127.0.0.1:${port}`);
  console.log(`Database SQLite: ${resolve(dataDirectory, 'ruang-kasir.sqlite')}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);

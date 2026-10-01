/**
 * Task 65 (owner, 2026-10-01): the Shop was empty ("Nothing here yet"), and no
 * layout can sell from an empty shelf. These are ScanGym's own starter
 * products: real PDFs that ship with the app in server/data/shop-starter/.
 *
 * Idempotent: a product is matched by (creator_handle 'scangym', title). New ones
 * are inserted; existing ones only get their file path refreshed (the container
 * path can change between deploys). Prices, status and sales are never touched
 * after the first insert, so the owner can edit or hide them in the database.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../middleware/db');

const DIR = path.join(__dirname, '..', 'data', 'shop-starter');
const HANDLE = 'scangym';

async function seedStarterProducts() {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf8')); }
  catch (e) { console.warn('[shop-starter] no product list:', e.message); return 0; }
  let added = 0;
  for (const p of list) {
    const filePath = path.join(DIR, p.file);
    if (!fs.existsSync(filePath)) continue;
    const size = fs.statSync(filePath).size;
    const upd = await pool.query(
      `UPDATE shop_products SET file_path = $1, file_size = $2 WHERE creator_handle = $3 AND title = $4`,
      [filePath, size, HANDLE, p.title]
    );
    if (upd.rowCount) continue;
    await pool.query(
      `INSERT INTO shop_products (creator_handle, title, description, category, price_pence, currency,
         file_path, file_name, file_size, content_type)
       VALUES ($1, $2, $3, $4, $5, 'GBP', $6, $7, $8, 'application/pdf')`,
      [HANDLE, p.title, p.description, p.category, p.pricePence, filePath, p.file, size]
    );
    added++;
  }
  if (added) console.log(`[shop-starter] added ${added} starter products`);
  return added;
}

module.exports = { seedStarterProducts, DIR };

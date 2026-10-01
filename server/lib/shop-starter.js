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
    // Task 65 (10/10 pass): a real cover per product (frontend/public/img/shop/{slug}.webp);
    // only filled when empty, so an owner-set cover is never overwritten.
    const cover = p.slug ? `/img/shop/${p.slug}.webp` : null;
    const upd = await pool.query(
      `UPDATE shop_products SET file_path = $1, file_size = $2,
         cover_image_url = COALESCE(NULLIF(cover_image_url, ''), $5)
       WHERE creator_handle = $3 AND title = $4`,
      [filePath, size, HANDLE, p.title, cover]
    );
    if (upd.rowCount) continue;
    await pool.query(
      `INSERT INTO shop_products (creator_handle, title, description, category, price_pence, currency,
         file_path, file_name, file_size, content_type, cover_image_url)
       VALUES ($1, $2, $3, $4, $5, 'GBP', $6, $7, $8, 'application/pdf', $9)`,
      [HANDLE, p.title, p.description, p.category, p.pricePence, filePath, p.file, size, cover]
    );
    added++;
  }
  if (added) console.log(`[shop-starter] added ${added} starter products`);
  return added;
}

module.exports = { seedStarterProducts, DIR };

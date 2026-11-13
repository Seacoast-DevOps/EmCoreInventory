import { randomInt } from 'node:crypto'

export function newCode(db) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (;;) {
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('')
    if (!db.prepare('SELECT 1 FROM inventory_items WHERE code=?').get(code) && (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='tracking_codes'").get() || !db.prepare('SELECT 1 FROM tracking_codes WHERE code=?').get(code))) return code
  }
}

export function migrateInventory(db) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const columns = db.prepare('PRAGMA table_info(inventory_items)').all().map(c => c.name)
    for (const [name, type] of [['code', 'TEXT'], ['status', "TEXT NOT NULL DEFAULT 'available'"], ['received_at', 'TEXT'], ['external_source', 'TEXT'], ['external_id', 'TEXT']]) {
      if (!columns.includes(name)) db.exec(`ALTER TABLE inventory_items ADD COLUMN ${name} ${type}`)
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_code ON inventory_items(code);
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_external_reference ON inventory_items(external_source,external_id);
      CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY, incident_number TEXT, reason TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incident_items(incident_id INTEGER NOT NULL REFERENCES incidents(id), item_id TEXT NOT NULL REFERENCES inventory_items(id), PRIMARY KEY(incident_id,item_id));`)
    const now = new Date().toISOString()
    for (const item of db.prepare('SELECT * FROM inventory_items WHERE code IS NULL').all()) {
      const code = newCode(db)
      db.prepare('UPDATE inventory_items SET code=? WHERE id=?').run(code, item.id)
      db.prepare('INSERT INTO inventory_events(item_id,action,to_box,details,created_at) VALUES(?,?,?,?,?)')
        .run(item.id, 'registered', item.box_id, JSON.stringify({ code, legacyId: item.id, note: 'Tracking code assigned to existing stock; original intake date unknown.' }), now)
    }
    db.exec("UPDATE inventory_items SET received_at=NULL WHERE id IN (SELECT item_id FROM inventory_events WHERE action='registered')")
    // Keep the public identity immutable and enforce its format on every write.
    db.exec(`CREATE TRIGGER IF NOT EXISTS item_code_insert BEFORE INSERT ON inventory_items
      WHEN NEW.code IS NULL OR length(NEW.code)!=8 OR NEW.code GLOB '*[^A-Z0-9]*'
      BEGIN SELECT RAISE(ABORT,'An eight-character uppercase alphanumeric code is required'); END;
      CREATE TRIGGER IF NOT EXISTS item_code_update BEFORE UPDATE OF code ON inventory_items
      WHEN NEW.code IS NOT OLD.code BEGIN SELECT RAISE(ABORT,'Tracking codes cannot change'); END;`)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

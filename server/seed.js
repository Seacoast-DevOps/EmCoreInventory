export function seedInventory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_boxes(id TEXT PRIMARY KEY, location TEXT NOT NULL, name TEXT NOT NULL, sealed INTEGER NOT NULL DEFAULT 0, seal TEXT, transparent INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS inventory_items(id TEXT PRIMARY KEY, box_id TEXT NOT NULL REFERENCES inventory_boxes(id), medication TEXT NOT NULL, presentation TEXT NOT NULL, verified_at TEXT);
 CREATE TABLE IF NOT EXISTS inventory_events(id INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES inventory_items(id), action TEXT NOT NULL, from_box TEXT, to_box TEXT, details TEXT, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS inventory_seeds(version INTEGER PRIMARY KEY);`);
  if (db.prepare("SELECT 1 FROM inventory_seeds WHERE version=1").get()) return;
  const box = db.prepare("INSERT INTO inventory_boxes VALUES(?,?,?,?,?,?)");
  const item = db.prepare("INSERT INTO inventory_items VALUES(?,?,?,?,NULL)");
  let sequence = 0;
  function stock(id, location, name, sealed, transparent, meds) {
    box.run(
      id,
      location,
      name,
      sealed ? 1 : 0,
      sealed ? "12345678" : null,
      transparent ? 1 : 0,
    );
    for (const [medication, presentation, count] of meds)
      for (let i = 0; i < count; i++)
        item.run(
          "EM-" + String(++sequence).padStart(4, "0"),
          id,
          medication,
          presentation,
        );
  }
  const narcotics = [
    ["Fentanyl", "Vial", 5],
    ["Versed (midazolam)", "Vial", 5],
    ["Ketamine", "Vial", 1],
  ];
  const als = [
    ["Naloxone", "2 mg · Prefilled syringe", 2],
    ["Epinephrine", "1:10,000 · Prefilled syringe", 8],
    ["Metoprolol", "5 mg · Vial", 2],
    ["Norepinephrine", "8 mg in 250 mL · Premixed bag", 1],
  ];
  const out = [
    ["Aspirin", "324 mg · Pack", 1],
    ["Ondansetron (Zofran)", "4 mg · IV vial", 2],
    ["Ondansetron (Zofran)", "4 mg · ODT", 2],
    ["Dexamethasone", "10 mg · Vial", 2],
  ];
  db.exec("BEGIN");
  try {
    for (const unit of [42, 43, 44]) {
      stock(
        "unit-" + unit + "-narcotic",
        "Unit " + unit,
        "Transparent narcotic box",
        true,
        true,
        narcotics,
      );
      stock(
        "unit-" + unit + "-pelican",
        "Unit " + unit,
        "Pelican box",
        false,
        false,
        als,
      );
      stock(
        "unit-" + unit + "-out",
        "Unit " + unit,
        "Out of Box drug box",
        false,
        false,
        out,
      );
    }
    stock(
      "storage-bls",
      "Storage Room - BLS Cabinet",
      "BLS Cabinet",
      false,
      false,
      [
        ["Aspirin", "324 mg · Pack", 6],
        ["Naloxone", "2 mg · Prefilled syringe", 6],
      ],
    );
    stock(
      "storage-narcotic",
      "Storage Room - Narcotic Cabinet",
      "Narcotic Cabinet",
      false,
      false,
      [
        ["Fentanyl", "Vial", 10],
        ["Versed (midazolam)", "Vial", 10],
        ["Ketamine", "Vial", 4],
      ],
    );
    stock(
      "storage-als",
      "Storage Room - ALS Cabinet",
      "ALS Cabinet",
      false,
      false,
      [...als, ...out.slice(1)],
    );
    db.prepare("INSERT INTO inventory_seeds VALUES(1)").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

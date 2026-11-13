import { randomUUID } from 'node:crypto'
import { definitionLabel } from '../shared/catalog-options.js'
import { itemRequirements, requireWitness } from './catalog.js'

export const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const addColumn = (db, table, name, type) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`) }
const sourceUrl = 'https://www.maine.gov/ems/sites/maine.gov.ems/files/inline-files/2025-MEMS-Formulary-v4-Print-Version-20260311.pdf'

export function migrateWorkflows(db) {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [table, fields] of Object.entries({
      drug_definitions: { check_interval_hours: 'REAL NOT NULL DEFAULT 24', source_note: 'TEXT', source_url: 'TEXT' },
      inventory_boxes: { check_interval_hours: 'REAL NOT NULL DEFAULT 24', icon: "TEXT NOT NULL DEFAULT 'box'", kind: "TEXT NOT NULL DEFAULT 'Drug box'", stock_revision: 'INTEGER NOT NULL DEFAULT 0' },
      inventory_items: { amount_total: 'REAL', remaining_amount: 'REAL' },
      incidents: { status: "TEXT NOT NULL DEFAULT 'completed'", revision: 'INTEGER NOT NULL DEFAULT 1', payload: 'TEXT', updated_at: 'TEXT', client_key: 'TEXT' },
    })) for (const [name, type] of Object.entries(fields)) addColumn(db, table, name, type)
    db.exec(`CREATE TABLE IF NOT EXISTS tracking_codes(code TEXT PRIMARY KEY, item_id TEXT NOT NULL UNIQUE, issued_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incident_allocations(incident_id INTEGER NOT NULL REFERENCES incidents(id), item_id TEXT NOT NULL REFERENCES inventory_items(id), given REAL NOT NULL, wasted REAL NOT NULL, PRIMARY KEY(incident_id,item_id));
      CREATE TABLE IF NOT EXISTS incident_versions(id INTEGER PRIMARY KEY, incident_id INTEGER NOT NULL REFERENCES incidents(id), revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drug_checks(id TEXT PRIMARY KEY, box_id TEXT NOT NULL REFERENCES inventory_boxes(id), status TEXT NOT NULL, kind TEXT NOT NULL, item_ids TEXT NOT NULL, checked_ids TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_draft_check ON drug_checks(box_id) WHERE status='draft';`)
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS incident_client_key ON incidents(client_key) WHERE client_key IS NOT NULL')
    addColumn(db,'drug_checks','stock_revision','INTEGER NOT NULL DEFAULT 0')
    db.prepare('INSERT OR IGNORE INTO tracking_codes SELECT code,id,? FROM inventory_items').run(new Date().toISOString())
    db.exec(`CREATE TRIGGER IF NOT EXISTS retain_tracking_codes BEFORE DELETE ON tracking_codes BEGIN SELECT RAISE(ABORT,'Tracking code history is permanent'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_tracking_registry BEFORE UPDATE ON tracking_codes BEGIN SELECT RAISE(ABORT,'Tracking code history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS register_tracking_code AFTER INSERT ON inventory_items BEGIN INSERT INTO tracking_codes VALUES(NEW.code,NEW.id,COALESCE(NEW.received_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))); END;`)
    if (!db.prepare('SELECT 1 FROM inventory_seeds WHERE version=3').get()) {
      // Stocking defaults, not treatment doses. Alternate supplied presentations are recorded in provenance.
      const profiles = [
        ['Fentanyl', '', 50, 'mcg', 'mL', 100, 'Vial', true],
        ['Versed (midazolam)', '', 5, 'mg', 'mL', 5, 'Vial', true],
        ['Ketamine', '', 100, 'mg', 'mL', 500, 'Vial', true],
        ['Naloxone', '', 1, 'mg', 'mL', 2, 'Prefilled syringe'],
        ['Epinephrine', '', 0.1, 'mg', 'mL', 1, 'Prefilled syringe'],
        ['Metoprolol', '', 1, 'mg', 'mL', 5, 'Vial'],
        ['Norepinephrine', '', 0.032, 'mg', 'mL', 8, 'Premixed bag'],
        ['Aspirin', '', 324, 'mg', 'pack', 324, 'Pack'],
        ['Ondansetron (Zofran)', 'IV', 2, 'mg', 'mL', 4, 'Vial'],
        ['Ondansetron (Zofran)', 'ODT', 4, 'mg', 'tablet', 4, 'ODT'],
        ['Dexamethasone', '', 10, 'mg', 'mL', 10, 'Vial'],
        ['Dextrose 10%', '', 0.1, 'g', 'mL', 25, 'Premixed bag'],
      ]
      const now = new Date().toISOString()
      for (const [name, match, concentration, unit, basis, maximum, form, narcotic] of profiles) {
        let profile = db.prepare('SELECT * FROM drug_definitions WHERE name=? AND concentration_value=? AND amount_unit=? AND max_amount=? AND form=?').get(name, concentration, unit, maximum, form)
        const id = profile?.id || randomUUID()
        const note = name.includes('midazolam') ? 'Maine EMS formulary lists 5 mg/mL in 1 mL and 1 mg/mL in 5 mL. This profile uses the 5 mg/mL option; confirm the supplied label.' : 'Stock profile from the Maine EMS March 11, 2026 formulary and the requested container contents. Confirm the supplied label; this is not a patient dose limit.'
        if (!profile) db.prepare('INSERT INTO drug_definitions(id,name,concentration_value,amount_unit,concentration_basis,max_amount,form,source_note,source_url) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, concentration, unit, basis, maximum, form, note, sourceUrl)
        if (narcotic) db.prepare('INSERT OR IGNORE INTO definition_tags VALUES(?,?)').run(id, 'narcotic')
        const definition = { id, name, concentrationValue: concentration, amountUnit: unit, concentrationBasis: basis, maxAmount: maximum, form }
        const items = db.prepare('SELECT * FROM inventory_items WHERE definition_id IS NULL AND medication=?').all(name).filter(item => !match || item.presentation.includes(match))
        for (const item of items) {
          db.prepare('UPDATE inventory_items SET definition_id=?,definition_snapshot=?,presentation=?,amount_total=?,remaining_amount=? WHERE id=?').run(id, JSON.stringify(definition), definitionLabel(definition).split(' — ').slice(1).join(' — '), maximum, ['available','opened'].includes(item.status) ? maximum : 0, item.id)
          db.prepare('INSERT INTO inventory_events(item_id,action,from_box,to_box,details,created_at) VALUES(?,?,?,?,?,?)').run(item.id, 'standardized', item.box_id, item.box_id, JSON.stringify({ previousPresentation: item.presentation, definition, sourceUrl, note }), now)
        }
        for (const box of db.prepare("SELECT box_id,count(*) count FROM inventory_items WHERE definition_id=? AND status IN ('available','opened') GROUP BY box_id").all(id)) db.prepare('INSERT OR IGNORE INTO par_levels VALUES(?,?,?)').run(id, box.box_id, box.count)
      }
      db.exec("UPDATE inventory_boxes SET icon=CASE WHEN location LIKE 'Unit %' THEN 'truck' WHEN name LIKE '%Narcotic%' THEN 'lock' ELSE 'cabinet' END, kind=CASE WHEN name LIKE '%Cabinet%' THEN 'Cabinet' WHEN name LIKE '%narcotic%' THEN 'Narcotic box' ELSE 'Drug box' END")
      db.prepare('INSERT INTO inventory_seeds VALUES(3)').run()
    }
    db.exec('UPDATE inventory_items SET amount_total=(SELECT max_amount FROM drug_definitions WHERE id=definition_id),remaining_amount=CASE WHEN status IN (\'available\',\'opened\') THEN (SELECT max_amount FROM drug_definitions WHERE id=definition_id) ELSE 0 END WHERE amount_total IS NULL AND definition_id IS NOT NULL')
    for (const legacy of db.prepare('SELECT * FROM incidents WHERE payload IS NULL').all()) {
      const rows = db.prepare('SELECT i.* FROM incident_items ii JOIN inventory_items i ON i.id=ii.item_id WHERE incident_id=?').all(legacy.id)
      const payload = { incidentNumber: legacy.incident_number || '', reason: legacy.reason, notes: legacy.notes, witness: '', items: rows.map(item => ({ id: item.id, boxId: item.box_id, given: legacy.reason === 'used' ? item.amount_total || 0 : 0, wasted: ['used','opened'].includes(legacy.reason) ? 0 : item.amount_total || 0 })) }
      db.prepare('UPDATE incidents SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(payload), legacy.created_at, legacy.id)
      for (const item of payload.items) db.prepare('INSERT OR IGNORE INTO incident_allocations VALUES(?,?,?,?)').run(legacy.id, item.id, item.given, item.wasted)
      db.prepare("INSERT INTO incident_versions(incident_id,revision,status,payload,created_at) VALUES(?,1,'completed',?,?)").run(legacy.id, JSON.stringify(payload), legacy.created_at)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function checkSnapshot(db, now = Date.now()) {
  return db.prepare('SELECT * FROM inventory_boxes WHERE id!=\'unassigned\'').all().map(box => {
    const items = db.prepare("SELECT i.id,d.check_interval_hours FROM inventory_items i LEFT JOIN drug_definitions d ON d.id=i.definition_id WHERE box_id=? AND status IN ('available','opened')").all(box.id)
    const draft = db.prepare("SELECT * FROM drug_checks WHERE box_id=? AND status='draft'").get(box.id)
    const last = db.prepare("SELECT * FROM drug_checks WHERE box_id=? AND status='complete' ORDER BY completed_at DESC,rowid DESC LIMIT 1").get(box.id)
    const intervals = [box.check_interval_hours, ...items.map(item => item.check_interval_hours)].filter(hours => hours > 0)
    const hours = intervals.length ? Math.min(...intervals) : 0
    const dueAt = last && hours ? new Date(Date.parse(last.completed_at) + hours * 3600000).toISOString() : null
    const unchanged = last && last.stock_revision === box.stock_revision && JSON.stringify(JSON.parse(last.item_ids).sort()) === JSON.stringify(items.map(item => item.id).sort())
    const checked = draft ? JSON.parse(draft.checked_ids) : []
    const complete = !draft && last && unchanged && (!dueAt || Date.parse(dueAt) > now)
    return { boxId: box.id, status: complete ? 'complete' : draft && (checked.length || draft.revision > 1) ? 'draft' : 'not_done', stale: Boolean(draft && draft.stock_revision !== box.stock_revision), checkedIds: complete ? JSON.parse(last.checked_ids) : checked, total: items.length, draft: draft ? { ...draft, itemIds: JSON.parse(draft.item_ids), checkedIds: checked } : null, lastCompletedAt: last?.completed_at || null, dueAt, overdue: Boolean(dueAt && Date.parse(dueAt) <= now), intervalHours: hours }
  })
}

export function saveCheck(db, path, body, now, event) {
  const box = db.prepare('SELECT * FROM inventory_boxes WHERE id=?').get(body.boxId)
  if (!box || box.id==='unassigned') fail(400, 'Assign stock to a container before starting a check')
  let draft = db.prepare("SELECT * FROM drug_checks WHERE box_id=? AND status='draft'").get(box.id)
  const currentIds = db.prepare("SELECT id FROM inventory_items WHERE box_id=? AND status IN ('available','opened') ORDER BY id").all(box.id).map(item => item.id)
  if (path === '/api/checks/start') {
    if (!['scheduled','reset','adhoc'].includes(body.kind)) fail(400, 'Choose a check type')
    if (draft && body.kind === 'scheduled') return
    if (draft) db.prepare("UPDATE drug_checks SET status='superseded',updated_at=? WHERE id=?").run(now, draft.id)
    db.prepare("INSERT INTO drug_checks(id,box_id,status,kind,item_ids,checked_ids,created_at,updated_at,stock_revision) VALUES(?,?,'draft',?,?,?, ?,?,?)").run(randomUUID(), box.id, body.kind, JSON.stringify(currentIds), '[]', now, now, box.stock_revision)
    return
  }
  if (!draft) fail(409, 'Start a check before verifying items')
  if (body.revision !== draft.revision) fail(409, 'This check changed in another session. Reload before saving.')
  const ids = JSON.parse(draft.item_ids), checked = new Set(JSON.parse(draft.checked_ids))
  if (draft.stock_revision !== box.stock_revision || JSON.stringify([...ids].sort()) !== JSON.stringify([...currentIds].sort())) fail(409, 'Container stock changed. Reset this check to include the current items.')
  if (path === '/api/checks/verify') {
    if (!ids.includes(body.itemId) || typeof body.verified !== 'boolean') fail(400, 'Choose an item in this check')
    if (body.verified) checked.add(body.itemId); else checked.delete(body.itemId)
    event(body.itemId, 'check_verified', box.id, box.id, { checkId: draft.id, verified: body.verified }, now)
  }
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 1000)) fail(400, 'Check notes must be 1,000 characters or fewer')
  const complete = path === '/api/checks/complete'
  if (complete && ids.some(id => !checked.has(id))) fail(400, 'Verify every item before completing the check')
  db.prepare('UPDATE drug_checks SET checked_ids=?,notes=?,status=?,revision=revision+1,updated_at=?,completed_at=? WHERE id=?').run(JSON.stringify([...checked]), body.notes ?? draft.notes, complete ? 'complete' : 'draft', now, complete ? now : null, draft.id)
  if (complete) for (const id of ids) event(id, 'check_completed', box.id, box.id, { checkId: draft.id, kind: draft.kind }, now)
}

export function incidentRecord(db, id) {
  const incident = db.prepare('SELECT * FROM incidents WHERE id=?').get(id)
  if (!incident) fail(404, 'Incident not found')
  const rows = db.prepare('SELECT i.*,a.given,a.wasted FROM incident_items ii JOIN inventory_items i ON i.id=ii.item_id LEFT JOIN incident_allocations a ON a.incident_id=ii.incident_id AND a.item_id=ii.item_id WHERE ii.incident_id=?').all(id)
  const payload = incident.payload ? JSON.parse(incident.payload) : { incidentNumber: incident.incident_number || '', reason: incident.reason, notes: incident.notes, witness: '', items: rows.map(item => ({ id: item.id, boxId: item.box_id, given: item.given ?? '', wasted: item.wasted ?? '' })) }
  const versions=db.prepare('SELECT * FROM incident_versions WHERE incident_id=? ORDER BY revision DESC,id DESC').all(id)
  const allIds = [...new Set([...payload.items.map(item => item.id), ...rows.map(item => item.id),...versions.flatMap(version=>JSON.parse(version.payload).items.map(item=>item.id))])]
  return { incident, payload, allocations: db.prepare('SELECT * FROM incident_allocations WHERE incident_id=?').all(id), items: allIds.map(id => db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id)).filter(Boolean).map(item => ({ ...item, requirements: itemRequirements(db, item.definition_id) })), versions }
}

export function saveIncident(db, body, draftOnly, helpers, now) {
  const { event, breakSeals, incidentReasons } = helpers
  let previous = null
  if (body.clientKey !== undefined && (typeof body.clientKey !== 'string' || body.clientKey.length > 100 || !body.clientKey)) fail(400,'Invalid incident client key')
  if (!body.id && body.clientKey && db.prepare('SELECT 1 FROM incidents WHERE client_key=?').get(body.clientKey)) fail(409,'This incident has already been saved. Open it from Saved incidents to continue.')
  if (body.id !== undefined) {
    if (!Number.isInteger(body.id) || body.id < 1) fail(400,'Choose a valid incident')
    previous = db.prepare('SELECT * FROM incidents WHERE id=?').get(body.id)
    if (!previous) fail(404, 'Incident not found')
    if (previous.revision !== body.revision) fail(409, 'This incident changed elsewhere. Reload it before editing.')
    if (previous.status === 'completed') fail(409, 'Reopen this incident before editing it')
  }
  if (!Array.isArray(body.items) || body.items.length > 100 || new Set(body.items.map(item => item?.id)).size !== body.items.length) fail(400, 'Choose up to 100 different items')
  if (typeof body.notes !== 'string' && body.notes !== undefined) fail(400, 'Enter valid notes')
  if (body.witness !== undefined && (typeof body.witness !== 'string' || body.witness.length > 100)) fail(400,'Witness name / ID must be 100 characters or fewer')
  if (body.reason !== undefined && typeof body.reason !== 'string') fail(400,'Choose a valid reason')
  if ((body.notes || '').length > 1000 || (body.incidentNumber || '').length > 60 || typeof (body.incidentNumber || '') !== 'string') fail(400, 'Incident number or notes are too long')
  const reason = incidentReasons.find(reason => reason.value === body.reason)
  if (!draftOnly && (!reason || !body.items.length)) fail(400, 'Choose items and a reason before completing the incident')
  if (!draftOnly && reason.value === 'used' && !body.incidentNumber?.trim()) fail(400, 'Enter the incident number for used medication')
  if (!draftOnly && reason.value === 'other' && !body.notes?.trim()) fail(400, 'Explain the disposal reason')
  const old = previous ? db.prepare('SELECT * FROM incident_allocations WHERE incident_id=?').all(previous.id) : []
  if (body.correctionNote !== undefined && (typeof body.correctionNote !== 'string' || body.correctionNote.length > 500)) fail(400, 'Correction reason must be 500 characters or fewer')
  if (!draftOnly && previous && db.prepare("SELECT 1 FROM incident_versions WHERE incident_id=? AND status='completed'").get(previous.id) && !body.correctionNote?.trim()) fail(400, 'Enter a correction reason for the reopened incident')
  const validated = body.items.map(entry => {
    const item = typeof entry?.id === 'string' ? db.prepare('SELECT * FROM inventory_items WHERE id=?').get(entry.id) : null
    if (!item) fail(400, 'An incident item no longer exists')
    const allocation = old.find(row => row.item_id === item.id)
    if (!allocation && (!['available','opened'].includes(item.status) || entry.boxId !== item.box_id)) fail(409, 'An item is unavailable or moved. Remove it and select it again.')
    if (draftOnly) return { item, given: entry.given ?? '', wasted: entry.wasted ?? '' }
    const available = item.remaining_amount == null ? null : item.remaining_amount + (allocation?.given || 0) + (allocation?.wasted || 0)
    if (reason.value !== 'opened' && available == null) fail(400, 'Complete the drug profile before recording quantities for ' + item.code)
    const given = reason.value === 'opened' ? 0 : entry.given === undefined || entry.given === '' ? (reason.value === 'used' ? available : 0) : Number(entry.given)
    const wasted = reason.value === 'opened' ? 0 : entry.wasted === undefined || entry.wasted === '' ? (reason.value === 'used' ? 0 : available) : Number(entry.wasted)
    if (!Number.isFinite(given) || !Number.isFinite(wasted) || given < 0 || wasted < 0 || given + wasted > available + 1e-8 || (reason.value !== 'opened' && given + wasted <= 0)) fail(400, 'Given plus wasted must be positive and cannot exceed the vial balance for ' + item.code)
    if (reason.value !== 'used' && given > 0) fail(400, 'Medication given is only valid for Used Medication')
    if (!['used','opened'].includes(reason.value) && Math.abs(wasted-available)>1e-8) fail(400,'Disposal must account for the full remaining vial amount. Use Used Medication for partial-use entries.')
    const rules = itemRequirements(db, item.definition_id)
    requireWitness(body, rules, [reason.value === 'used' ? (given < item.amount_total - 1e-8 || wasted > 0 ? 'partial' : 'entire') : reason.value === 'opened' ? 'opening' : 'disposal', ...(wasted > 0 ? ['disposal'] : [])])
    return { item, given, wasted }
  })
  if (!draftOnly) {
    for (const allocation of old) {
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(allocation.item_id)
      requireWitness(body, itemRequirements(db, item.definition_id), [allocation.given > 0 ? allocation.given < item.amount_total || allocation.wasted > 0 ? 'partial' : 'entire' : 'disposal'])
    }
    for (const allocation of old.filter(row => !validated.some(entry => entry.item.id === row.item_id))) {
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(allocation.item_id)
      requireWitness(body, itemRequirements(db, item.definition_id), ['partial','disposal'])
      if (item.remaining_amount + allocation.given + allocation.wasted > item.amount_total + 1e-8) fail(409, 'This vial changed after the incident. Review its record before correcting it.')
    }
    breakSeals(validated.filter(entry => { const before=old.find(row=>row.item_id===entry.item.id); return !before || entry.given+entry.wasted > before.given+before.wasted+1e-8 && entry.item.remaining_amount>0 }).map(entry => db.prepare('SELECT * FROM inventory_boxes WHERE id=?').get(entry.item.box_id)), body.brokenSeals, now, body)
  }
  const payload = { incidentNumber: body.incidentNumber || '', reason: body.reason || '', notes: body.notes || '', witness: body.witness || '', witnessSignoff:body.witnessSignoff||null, correctionNote: body.correctionNote || '', items: validated.map(entry => ({ id: entry.item.id, boxId: entry.item.box_id, given: entry.given, wasted: entry.wasted })) }
  const status = draftOnly ? (old.length ? 'reopened' : 'draft') : 'completed'
  let id = previous?.id, revision = (previous?.revision || 0) + 1
  if (previous) db.prepare('UPDATE incidents SET incident_number=?,reason=?,notes=?,payload=?,status=?,revision=?,updated_at=? WHERE id=?').run(payload.incidentNumber, payload.reason, payload.notes, JSON.stringify(payload), status, revision, now, id)
  else id = Number(db.prepare('INSERT INTO incidents(incident_number,reason,notes,created_at,payload,status,revision,updated_at,client_key) VALUES(?,?,?,?,?,?,?,?,?)').run(payload.incidentNumber, payload.reason, payload.notes, now, JSON.stringify(payload), status, revision, now,body.clientKey||null).lastInsertRowid)
  db.prepare('INSERT INTO incident_versions(incident_id,revision,status,payload,created_at) VALUES(?,?,?,?,?)').run(id, revision, status, JSON.stringify(payload), now)
  if (!draftOnly) {
    const affected = [...new Set([...old.map(row => row.item_id), ...validated.map(entry => entry.item.id)])]
    for (const itemId of affected) {
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(itemId)
      const before = old.find(row => row.item_id === itemId), after = validated.find(entry => entry.item.id === itemId)
      const difference = (after ? after.given + after.wasted : 0) - (before ? before.given + before.wasted : 0)
      const remaining = item.remaining_amount == null ? null : Math.max(0, Number((item.remaining_amount - difference).toFixed(9)))
      const newStatus = remaining === 0 ? (after?.given > 0 ? 'used' : 'disposed') : 'opened'
      db.prepare('UPDATE inventory_items SET remaining_amount=?,status=?,was_opened=1,verified_at=NULL WHERE id=?').run(remaining, newStatus, itemId)
      if (difference !== 0 || !before) db.prepare('UPDATE inventory_boxes SET stock_revision=stock_revision+1 WHERE id=?').run(item.box_id)
      event(itemId, old.length ? 'incident_corrected' : after?.given > 0 ? 'medication_used' : reason.status, item.box_id, null, { incidentId: id, incidentNumber: payload.incidentNumber, revision, reason: reason.label, given: after?.given || 0, wasted: after?.wasted || 0, previousGiven: before?.given || 0, previousWasted: before?.wasted || 0, remaining, unit: JSON.parse(item.definition_snapshot || '{}').amountUnit || '', witness: payload.witness, correctionNote: payload.correctionNote, notes: payload.notes }, now)
    }
    db.prepare('DELETE FROM incident_allocations WHERE incident_id=?').run(id)
    db.prepare('DELETE FROM incident_items WHERE incident_id=?').run(id)
    for (const entry of validated) {
      db.prepare('INSERT INTO incident_allocations VALUES(?,?,?,?)').run(id, entry.item.id, entry.given, entry.wasted)
      db.prepare('INSERT INTO incident_items VALUES(?,?)').run(id, entry.item.id)
    }
  }
  return { id, revision }
}

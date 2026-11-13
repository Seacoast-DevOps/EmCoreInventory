import {requireAuthenticatedWitness} from './witness.js'
import { validMedicationRules } from './permissions.js'
import { medicationPermitted } from '../shared/access-rules.js'
import { randomUUID } from 'node:crypto'
import { amountUnits, concentrationBases, medicationForms, witnessOptions } from '../shared/catalog-options.js'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9

export function migrateCatalog(db) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS medication_tags(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, requirements TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drug_definitions(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, concentration_value REAL NOT NULL CHECK(concentration_value>0), amount_unit TEXT NOT NULL, concentration_basis TEXT NOT NULL, max_amount REAL NOT NULL CHECK(max_amount>0), form TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS definition_unique ON drug_definitions(name,concentration_value,amount_unit,concentration_basis,max_amount,form);
      CREATE TABLE IF NOT EXISTS definition_tags(definition_id TEXT NOT NULL REFERENCES drug_definitions(id), tag_id TEXT NOT NULL REFERENCES medication_tags(id), PRIMARY KEY(definition_id,tag_id));
      CREATE TABLE IF NOT EXISTS par_levels(definition_id TEXT NOT NULL REFERENCES drug_definitions(id), box_id TEXT NOT NULL REFERENCES inventory_boxes(id), target INTEGER NOT NULL CHECK(target>=0), PRIMARY KEY(definition_id,box_id));
      CREATE TABLE IF NOT EXISTS settings_events(id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);`)
    const columns = db.prepare('PRAGMA table_info(inventory_items)').all().map(column => column.name)
    if (!columns.includes('definition_id')) db.exec('ALTER TABLE inventory_items ADD COLUMN definition_id TEXT REFERENCES drug_definitions(id)')
    if (!columns.includes('definition_snapshot')) db.exec('ALTER TABLE inventory_items ADD COLUMN definition_snapshot TEXT')
    if (!db.prepare('SELECT 1 FROM inventory_seeds WHERE version=2').get()) {
      db.prepare('INSERT INTO medication_tags VALUES(?,?,?)').run('narcotic', 'Narcotic', JSON.stringify(['entire','partial','replacement','resealed']))
      db.prepare('INSERT INTO inventory_seeds VALUES(2)').run()
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function catalogSnapshot(db,context) {
  const tags = db.prepare('SELECT * FROM medication_tags ORDER BY name').all().map(tag => ({ ...tag, requirements: JSON.parse(tag.requirements) }))
  const links = db.prepare('SELECT * FROM definition_tags').all()
  const definitions = db.prepare('SELECT * FROM drug_definitions ORDER BY name,concentration_value').all().map(drug => ({
    id: drug.id, name: drug.name, medicationClassId:drug.medication_class_id, accessRules:JSON.parse(drug.access_rules||'{}'), checkIntervalHours: drug.check_interval_hours, sourceNote: drug.source_note, sourceUrl: drug.source_url, concentrationValue: drug.concentration_value, amountUnit: drug.amount_unit,
    concentrationBasis: drug.concentration_basis, maxAmount: drug.max_amount, form: drug.form,
    hasStock: Boolean(db.prepare('SELECT 1 FROM inventory_items WHERE definition_id=? LIMIT 1').get(drug.id)),
    tagIds: links.filter(link => link.definition_id === drug.id).map(link => link.tag_id),
  }))
  const visibleDefinitions=context&&!context.permissions['definitions.view']?definitions.filter(drug=>medicationPermitted(context.profile,drug,'view')):definitions
  const parLevels = db.prepare('SELECT * FROM par_levels').all().map(par => ({ definitionId: par.definition_id, boxId: par.box_id, target: par.target }))
  return { tags, definitions:visibleDefinitions, parLevels }
}

export function saveSetting(db, path, body, now) {
  if (body.id !== undefined && (typeof body.id !== 'string' || body.id.length > 80)) fail(400, 'Invalid settings ID')
  const id = body.id || randomUUID()
  if (!validName(body.name)) fail(400, 'Enter a name of 1 to 100 characters')
  if (path === '/api/tags') {
    if (!Array.isArray(body.requirements) || body.requirements.some(id => !witnessOptions.some(option => option.id === id))) fail(400, 'Choose valid witness requirements')
    if (body.id && !db.prepare('SELECT 1 FROM medication_tags WHERE id=?').get(id)) fail(404, 'Tag not found')
    if (db.prepare('SELECT 1 FROM medication_tags WHERE name=? COLLATE NOCASE AND id!=?').get(body.name.trim(), id)) fail(409, 'A tag with that name already exists')
    db.prepare('INSERT INTO medication_tags VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,requirements=excluded.requirements')
      .run(id, body.name.trim(), JSON.stringify([...new Set(body.requirements)]))
  } else {
    if(body.medicationClassId && (typeof body.medicationClassId!=='string'||!db.prepare('SELECT 1 FROM medication_classes WHERE id=?').get(body.medicationClassId)))fail(400,'Choose a valid medication class')
    if(body.accessRules!==undefined&&!validMedicationRules(body.accessRules))fail(400,'Choose valid medication access rules')
    const interval = body.checkIntervalHours ?? 24
    if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 0 || interval > 8760) fail(400,'Check interval must be between 0 and 8,760 hours')
    if (!positive(body.concentrationValue) || !positive(body.maxAmount)) fail(400, 'Concentration and maximum amount must be positive numbers')
    if (!amountUnits.includes(body.amountUnit) || !concentrationBases.includes(body.concentrationBasis) || !medicationForms.includes(body.form)) fail(400, 'Choose valid units and presentation')
    if (!Array.isArray(body.tagIds) || new Set(body.tagIds).size !== body.tagIds.length || body.tagIds.some(tag => typeof tag !== 'string' || !db.prepare('SELECT 1 FROM medication_tags WHERE id=?').get(tag))) fail(400, 'Choose valid medication tags')
    if (!Array.isArray(body.parTargets) || body.parTargets.length > 100 || new Set(body.parTargets.map(par => par?.boxId)).size !== body.parTargets.length) fail(400, 'Enter one par target per container')
    for (const par of body.parTargets) {
      if (!par || typeof par.boxId !== 'string' || !db.prepare('SELECT 1 FROM inventory_boxes WHERE id=?').get(par.boxId) || !Number.isInteger(par.target) || par.target < 0 || par.target > 10000) fail(400, 'Par quantities must be whole numbers from 0 to 10,000 in a valid container')
    }
    if (body.id && !db.prepare('SELECT 1 FROM drug_definitions WHERE id=?').get(id)) fail(404, 'Drug definition not found')
    const previous = db.prepare('SELECT * FROM drug_definitions WHERE id=?').get(id)
    if (previous && db.prepare('SELECT 1 FROM inventory_items WHERE definition_id=? LIMIT 1').get(id) &&
      (previous.name !== body.name.trim() || previous.concentration_value !== body.concentrationValue || previous.amount_unit !== body.amountUnit || previous.concentration_basis !== body.concentrationBasis || previous.max_amount !== body.maxAmount || previous.form !== body.form)) {
      fail(409, 'This definition already has stock. Add a new definition for a different drug, concentration, amount, or presentation. Tags and par targets can still be edited.')
    }
    const duplicate = db.prepare('SELECT 1 FROM drug_definitions WHERE name=? COLLATE NOCASE AND concentration_value=? AND amount_unit=? AND concentration_basis=? AND max_amount=? AND form=? AND id!=?')
      .get(body.name.trim(), body.concentrationValue, body.amountUnit, body.concentrationBasis, body.maxAmount, body.form, id)
    if (duplicate) fail(409, 'That drug and presentation already exist. Edit the existing definition.')
    db.prepare(`INSERT INTO drug_definitions(id,name,concentration_value,amount_unit,concentration_basis,max_amount,form,check_interval_hours) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,concentration_value=excluded.concentration_value,amount_unit=excluded.amount_unit,concentration_basis=excluded.concentration_basis,max_amount=excluded.max_amount,form=excluded.form,check_interval_hours=excluded.check_interval_hours`)
      .run(id, body.name.trim(), body.concentrationValue, body.amountUnit, body.concentrationBasis, body.maxAmount, body.form, interval)
    db.prepare('UPDATE drug_definitions SET medication_class_id=?,access_rules=? WHERE id=?').run(body.medicationClassId||null,JSON.stringify(body.accessRules||{}),id)
    db.prepare('DELETE FROM definition_tags WHERE definition_id=?').run(id)
    for (const tag of body.tagIds) db.prepare('INSERT INTO definition_tags VALUES(?,?)').run(id, tag)
    db.prepare('DELETE FROM par_levels WHERE definition_id=?').run(id)
    for (const par of body.parTargets) db.prepare('INSERT INTO par_levels VALUES(?,?,?)').run(id, par.boxId, par.target)
  }
  db.prepare('INSERT INTO settings_events(entity_id,action,details,created_at) VALUES(?,?,?,?)').run(id, path === '/api/tags' ? 'tag_saved' : 'definition_saved', JSON.stringify(body), now)
}

export function itemRequirements(db, definitionId) {
  if (!definitionId) return []
  return [...new Set(db.prepare('SELECT requirements FROM medication_tags JOIN definition_tags ON tag_id=medication_tags.id WHERE definition_id=?').all(definitionId).flatMap(tag => JSON.parse(tag.requirements)))]
}

export function requireWitness(body, requirements, actions) {
  const needed = requirements.filter(rule => actions.includes(rule))
  if (needed.length) requireAuthenticatedWitness(body)
}

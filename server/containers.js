import { randomUUID } from 'node:crypto'
import { fail } from './workflows.js'
import { itemRequirements, requireWitness } from './catalog.js'

export function saveContainer(db, body, now, { breakSeals, event }) {
  for (const field of ['name','location']) if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 100) fail(400, 'Enter a container name and storage area')
  if (!['box','cabinet','truck','lock','medical'].includes(body.icon) || !['Drug box','Cabinet','Narcotic box','Pelican box'].includes(body.kind)) fail(400, 'Choose a valid container type and icon')
  if (typeof body.checkIntervalHours !== 'number' || !Number.isFinite(body.checkIntervalHours) || body.checkIntervalHours < 0 || body.checkIntervalHours > 8760) fail(400, 'Check interval must be from 0 to 8,760 hours')
  if (typeof body.sealed !== 'boolean' || typeof body.transparent !== 'boolean') fail(400, 'Choose sealed and transparent states')
  if (body.sealed && (typeof body.seal !== 'string' || !body.seal.trim() || body.seal.length > 40)) fail(400, 'A sealed container requires a seal number')
  const old = body.id ? db.prepare('SELECT * FROM inventory_boxes WHERE id=?').get(body.id) : null
  if (body.id && !old) fail(404, 'Container not found')
  const id = old?.id || randomUUID()
  const contents = old ? db.prepare("SELECT * FROM inventory_items WHERE box_id=? AND status IN ('available','opened')").all(id) : []
  if (old?.sealed && (!body.sealed || old.seal !== body.seal.trim())) breakSeals([old], body.brokenSeals, now, body)
  if (body.sealed && (!old?.sealed || old.seal !== body.seal.trim())) requireWitness(body, contents.flatMap(item => itemRequirements(db, item.definition_id)), ['resealed'])
  db.prepare(`INSERT INTO inventory_boxes(id,location,name,sealed,seal,transparent,check_interval_hours,icon,kind) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET location=excluded.location,name=excluded.name,sealed=excluded.sealed,seal=excluded.seal,transparent=excluded.transparent,check_interval_hours=excluded.check_interval_hours,icon=excluded.icon,kind=excluded.kind`)
    .run(id, body.location.trim(), body.name.trim(), Number(body.sealed), body.sealed ? body.seal.trim() : old?.seal || null, Number(body.transparent), body.checkIntervalHours, body.icon, body.kind)
  for (const item of contents) event(item.id, body.sealed && (!old?.sealed || old.seal !== body.seal.trim()) ? 'container_resealed' : 'container_updated', id, id, { containerName: body.name.trim(), location: body.location.trim(), seal: body.sealed ? body.seal.trim() : null, witness: body.witness?.trim() || null, checkIntervalHours: body.checkIntervalHours }, now)
  if (old && (Boolean(old.sealed)!==body.sealed || body.sealed && old.seal!==body.seal.trim())) db.prepare('UPDATE inventory_boxes SET stock_revision=stock_revision+1 WHERE id=?').run(id)
  db.prepare('INSERT INTO settings_events(entity_id,action,details,created_at) VALUES(?,?,?,?)').run(id, 'container_saved', JSON.stringify(body), now)
}

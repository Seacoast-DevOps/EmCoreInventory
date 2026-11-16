import {policyResources} from '../shared/access-rules.js'
import {randomUUID} from 'node:crypto'
import {matrixRoles,storageAllowed,needsPartner} from '../shared/matrix-rules.js'
import {requireAuthenticatedWitness} from './witness.js'
import {requireWitness,itemRequirements} from './catalog.js'
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
const add=(db,table,name,type)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type)}
export function migrateMatrix(db){
 add(db,'drug_definitions','minimum_license',"TEXT NOT NULL DEFAULT 'Paramedic'")
 add(db,'drug_definitions','is_narcotic','INTEGER NOT NULL DEFAULT 0')
 add(db,'inventory_boxes','allowed_roles',"TEXT NOT NULL DEFAULT '"+JSON.stringify(matrixRoles)+"'")
 db.exec("CREATE TABLE IF NOT EXISTS discrepancies(id TEXT PRIMARY KEY,box_id TEXT NOT NULL REFERENCES inventory_boxes(id),item_id TEXT REFERENCES inventory_items(id),notes TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',reported_by TEXT NOT NULL,reported_at TEXT NOT NULL,approved_by TEXT,approved_at TEXT,resolution TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1)")
 if(!db.prepare('SELECT 1 FROM inventory_seeds WHERE version=5').get()){
  db.exec("UPDATE drug_definitions SET is_narcotic=1 WHERE id IN (SELECT definition_id FROM definition_tags WHERE tag_id='narcotic')")
  for(const table of ['access_profiles','access_rules']){const column=table==='access_profiles'?'tags':'rule';db.exec("UPDATE "+table+" SET "+column+"=replace("+column+",'\"Service Admin\"','\"Company Admin\"')")}
  for(const resource of policyResources){
   const customized=db.prepare("SELECT 1 FROM settings_events WHERE action='access_rule_saved' AND json_extract(details,'$.resource')=?").get(resource.id)
   if(!customized)db.prepare('UPDATE access_rules SET rule=? WHERE resource=?').run(JSON.stringify(resource.defaultRule),resource.id)
  }
  db.prepare('INSERT INTO inventory_seeds VALUES(5)').run()
 }
}
export function authorizeStorage(db,context,id){if(typeof id!=='string')fail(400,'Choose a storage container');const box=db.prepare('SELECT * FROM inventory_boxes WHERE id=?').get(id);if(!box)fail(404,'Storage container not found');if(!storageAllowed(context.profile,box))fail(403,'Your role cannot access '+box.location+' — '+box.name);return box}
export function discrepancies(db,context){return db.prepare('SELECT d.*,b.location,b.name container_name,i.code,i.medication FROM discrepancies d JOIN inventory_boxes b ON b.id=d.box_id LEFT JOIN inventory_items i ON i.id=d.item_id ORDER BY reported_at DESC').all().filter(d=>storageAllowed(context.profile,db.prepare('SELECT * FROM inventory_boxes WHERE id=?').get(d.box_id)))}
export function saveDiscrepancy(db,path,body,context,now,event){
 if(path.endsWith('/approve')){
  const row=db.prepare('SELECT * FROM discrepancies WHERE id=?').get(body.id)
  if(!row)fail(404,'Discrepancy not found');authorizeStorage(db,context,row.box_id)
  if(row.status!=='open'||row.revision!==body.revision)fail(409,'This discrepancy changed. Refresh before approving.')
  if(typeof body.resolution!=='string'||!body.resolution.trim()||body.resolution.length>1000)fail(400,'Enter an approval / resolution note')
  db.prepare("UPDATE discrepancies SET status='approved',approved_by=?,approved_at=?,resolution=?,revision=revision+1 WHERE id=?").run(context.actor,now,body.resolution.trim(),row.id)
  if(row.item_id)event(row.item_id,'discrepancy_approved',row.box_id,row.box_id,{discrepancyId:row.id,resolution:body.resolution.trim()},now)
 }else{
  authorizeStorage(db,context,body.boxId)
  if(typeof body.notes!=='string'||!body.notes.trim()||body.notes.length>1000)fail(400,'Describe the discrepancy in up to 1,000 characters')
  let item=null;if(body.itemCode){item=db.prepare('SELECT * FROM inventory_items WHERE code=? AND box_id=?').get(String(body.itemCode).trim().toUpperCase(),body.boxId);if(!item)fail(400,'That item code does not belong to this container')}
  const id=randomUUID();db.prepare('INSERT INTO discrepancies(id,box_id,item_id,notes,reported_by,reported_at) VALUES(?,?,?,?,?,?)').run(id,body.boxId,item?.id||null,body.notes.trim(),context.actor,now)
  if(item)event(item.id,'discrepancy_reported',body.boxId,body.boxId,{discrepancyId:id,notes:body.notes.trim()},now)
 }
 db.prepare('INSERT INTO settings_events(entity_id,action,details,created_at) VALUES(?,?,?,?)').run(body.id||body.boxId,path.endsWith('/approve')?'discrepancy_approved':'discrepancy_reported',JSON.stringify(body),now)
}
export function saveSeal(db,body,context,now,event,breakSeals){
 const box=authorizeStorage(db,context,body.boxId)
 if(box.id==='unassigned')fail(400,'Unassigned has no physical seal')
 if(!['break','reseal'].includes(body.action))fail(400,'Choose break or reseal')
 if(body.incidentNumber!==undefined&&(typeof body.incidentNumber!=='string'||body.incidentNumber.length>60))fail(400,'Invalid incident number')
 if(body.action==='break'){if(!box.sealed)fail(409,'This container is already unsealed');breakSeals([box],body.brokenSeals,now,body)}
 else{
  if(box.sealed)fail(409,'Break the current seal before resealing')
  if(typeof body.seal!=='string'||!body.seal.trim()||body.seal.length>40)fail(400,'Enter the new physical seal number')
  if(needsPartner(context.profile))requireAuthenticatedWitness(body)
  const items=db.prepare("SELECT * FROM inventory_items WHERE box_id=? AND status IN ('available','opened')").all(box.id)
  requireWitness(body,items.flatMap(item=>itemRequirements(db,item.definition_id)),['resealed'])
  db.prepare('UPDATE inventory_boxes SET sealed=1,seal=?,stock_revision=stock_revision+1 WHERE id=?').run(body.seal.trim(),box.id)
  for(const item of items)event(item.id,'container_resealed',box.id,box.id,{seal:body.seal.trim(),incidentNumber:body.incidentNumber||'',witness:body.witness||null},now)
 }
 db.prepare('INSERT INTO settings_events(entity_id,action,details,created_at) VALUES(?,?,?,?)').run(box.id,body.action==='break'?'seal_broken':'container_resealed',JSON.stringify(body),now)
}
export function purgeOperational(db){
 const order=['inventory_events','incident_allocations','incident_items','incident_versions','incidents','drug_checks','discrepancies','definition_tags','par_levels','inventory_items','inventory_batches','drug_definitions','medication_tags','medication_classes','inventory_boxes','tracking_codes','witness_signoffs','access_profiles','access_rules','settings_events','access_audit','inventory_seeds']
 const triggers=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('tracking_codes','witness_signoffs')").all()
 for(const t of triggers)db.exec('DROP TRIGGER "'+t.name.replaceAll('"','""')+'"')
 for(const name of order)if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))db.exec('DELETE FROM '+name)
}


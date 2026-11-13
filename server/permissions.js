import { randomUUID } from 'node:crypto'
import { accessTags, defaultProfiles, policyResources, medicationActions, permitted, medicationPermitted } from '../shared/access-rules.js'
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
const add=(db,table,name,type)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)}
export function migratePermissions(db){
 db.exec('BEGIN IMMEDIATE')
 try{
  db.exec(`CREATE TABLE IF NOT EXISTS medication_classes(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,description TEXT NOT NULL DEFAULT '');
   CREATE TABLE IF NOT EXISTS access_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,tags TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS access_rules(resource TEXT PRIMARY KEY,rule TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS access_audit(id INTEGER PRIMARY KEY,actor_profile TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS inventory_batches(id TEXT PRIMARY KEY,definition_id TEXT NOT NULL REFERENCES drug_definitions(id),lot_number TEXT NOT NULL,expires_on TEXT NOT NULL,quantity INTEGER NOT NULL,created_at TEXT NOT NULL);`)
  for(const [name,type] of Object.entries({medication_class_id:'TEXT REFERENCES medication_classes(id)',access_rules:"TEXT NOT NULL DEFAULT '{}'"}))add(db,'drug_definitions',name,type)
  for(const [name,type] of Object.entries({batch_id:'TEXT REFERENCES inventory_batches(id)',lot_number:'TEXT',expires_on:'TEXT',was_opened:'INTEGER NOT NULL DEFAULT 0'}))add(db,'inventory_items',name,type)
  add(db,'inventory_events','actor_profile','TEXT');add(db,'settings_events','actor_profile','TEXT');add(db,'inventory_events','actor_user_id','TEXT');add(db,'settings_events','actor_user_id','TEXT')
  if(!db.prepare('SELECT 1 FROM inventory_seeds WHERE version=4').get()){
   for(const profile of defaultProfiles)db.prepare('INSERT INTO access_profiles VALUES(?,?,?)').run(profile.id,profile.name,JSON.stringify(profile.tags))
   for(const resource of policyResources)db.prepare('INSERT INTO access_rules VALUES(?,?)').run(resource.id,JSON.stringify(resource.defaultRule))
   db.prepare("INSERT OR IGNORE INTO inventory_boxes(id,location,name,sealed,transparent,check_interval_hours,icon,kind) VALUES('unassigned','Unassigned','Unassigned stock',0,0,0,'box','Drug box')").run()
   db.exec("UPDATE inventory_items SET was_opened=1 WHERE status='opened'")
   db.prepare('INSERT INTO inventory_seeds VALUES(4)').run()
  }
  db.exec('COMMIT')
 }catch(error){db.exec('ROLLBACK');throw error}
}
export function accessContext(db,profileId='service-admin',user=null){
 const row=db.prepare('SELECT * FROM access_profiles WHERE id=?').get(profileId)
 if(!row)fail(403,'Unknown access-preview profile')
 const profile=user?{id:user.id,name:user.name,tags:user.tags}:{id:row.id,name:row.name,tags:JSON.parse(row.tags)}
 const rules=Object.fromEntries(db.prepare('SELECT * FROM access_rules').all().map(rule=>[rule.resource,JSON.parse(rule.rule)]))
 return {...(user?{user:{id:user.id,username:user.username,name:user.name,serviceId:user.serviceId,serviceName:user.serviceName},actor:user.actor}:{}),profile,rules,permissions:Object.fromEntries(policyResources.map(resource=>[resource.id,permitted(profile,rules,resource.id)]))}
}
export function accessSnapshot(db,context){return {...context,tags:accessTags,resources:policyResources,medicationActions,profiles:db.prepare('SELECT * FROM access_profiles ORDER BY name').all().map(profile=>({...profile,tags:JSON.parse(profile.tags)}))}}
export function authorize(context,resource){if(!context.permissions[resource])fail(403,'Your account cannot '+(policyResources.find(item=>item.id===resource)?.label.toLowerCase()||resource))}
export function authorizeMedication(context,drug,action){if(!medicationPermitted(context.profile,drug,action))fail(403,'Medication policy does not allow '+action+' for '+(drug?.name||drug?.medication||'this drug'))}
export function drugForItem(db,item){return item?.definition_id?db.prepare('SELECT * FROM drug_definitions WHERE id=?').get(item.definition_id):item}
function tagsValid(tags){return Array.isArray(tags)&&new Set(tags).size===tags.length&&tags.every(tag=>accessTags.some(option=>option.id===tag))}
export function validMedicationRules(rules){return rules&&typeof rules==='object'&&!Array.isArray(rules)&&Object.entries(rules).every(([action,rule])=>medicationActions.includes(action)&&rule&&tagsValid(rule.anyTags)&&tagsValid(rule.allTags))}
export function saveAccess(db,path,body,now){
 if(path==='/api/classes'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof (body.description??'')!=='string'||(body.description||'').length>500)fail(400,'Enter a class name and description of up to 500 characters')
  const id=body.id||randomUUID()
  if(body.id&&!db.prepare('SELECT 1 FROM medication_classes WHERE id=?').get(id))fail(404,'Medication class not found')
  if(db.prepare('SELECT 1 FROM medication_classes WHERE name=? COLLATE NOCASE AND id!=?').get(body.name.trim(),id))fail(409,'That medication class already exists')
  db.prepare('INSERT INTO medication_classes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description').run(id,body.name.trim(),body.description||'')
 }else if(path==='/api/access/profiles'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||!tagsValid(body.tags))fail(400,'Enter a profile name and valid access tags')
  const id=body.id||randomUUID()
  if(body.id&&!db.prepare('SELECT 1 FROM access_profiles WHERE id=?').get(id))fail(404,'Profile not found')
  if(id==='service-admin'&&(!body.tags.includes('Service Admin')||body.tags.includes('Read Only')))fail(400,'Keep the built-in recovery profile as a Service Admin without Read Only')
  db.prepare('INSERT INTO access_profiles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,tags=excluded.tags').run(id,body.name.trim(),JSON.stringify(body.tags))
 }else{
  if(!policyResources.some(resource=>resource.id===body.resource)||!body.rule||!tagsValid(body.rule.anyTags)||!tagsValid(body.rule.allTags))fail(400,'Choose a resource and valid policy tags')
  if(['policies.edit','policies.view'].includes(body.resource)&&(!body.rule.anyTags.includes('Service Admin')||body.rule.allTags.length))fail(400,'Policy management must remain accessible to Service Admin for recovery')
  db.prepare('UPDATE access_rules SET rule=? WHERE resource=?').run(JSON.stringify(body.rule),body.resource)
 }
 db.prepare('INSERT INTO settings_events(entity_id,action,details,created_at) VALUES(?,?,?,?)').run(body.id||body.resource||body.name,path==='/api/classes'?'class_saved':path==='/api/access/profiles'?'access_profile_saved':'access_rule_saved',JSON.stringify(body),now)
}
export function logs(db,query,identityDb=db,serviceId='primary'){
 const type=query.get('type')||'all',q=(query.get('q')||'').slice(0,200).toLowerCase(),offset=Math.max(0,Math.min(100000,Number(query.get('offset'))||0)),limit=100
 const union=`SELECT 'item' kind,e.id,e.action,e.details,e.created_at,COALESCE(e.actor_profile,'Migration / legacy') actor,i.code,i.medication subject FROM inventory_events e JOIN inventory_items i ON i.id=e.item_id
 UNION ALL SELECT 'settings',id,action,details,created_at,COALESCE(actor_profile,'Migration / legacy'),'',entity_id FROM settings_events
 UNION ALL SELECT 'access',id,action,details,created_at,actor_profile,'','Application' FROM access_audit`
 const identity=identityDb.prepare('SELECT * FROM identity_audit WHERE service_id=?').all(serviceId).map(e=>({kind:'access',id:e.id,action:e.action,details:e.details,created_at:e.created_at,actor:e.actor,code:'',subject:'Users / services'}))
 const entries=[...db.prepare(union).all(),...identity].filter(e=>(type==='all'||e.kind===type)&&[e.action,e.details,e.actor,e.code,e.subject].join(' ').toLowerCase().includes(q)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id)
 return {entries:entries.slice(offset,offset+limit),total:entries.length,hasMore:offset+limit<entries.length}
}

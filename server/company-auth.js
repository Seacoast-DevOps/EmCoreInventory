import {createHash} from 'node:crypto'
import {licenseLevels,licenseOf,defaultTags,isSeacoast,companyAdmin} from '../shared/matrix-rules.js'
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
const hash=value=>createHash('sha256').update(value).digest('hex')
const add=(db,table,name,type)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type)}
export function migrateCompanies(db){
 add(db,'services','active','INTEGER NOT NULL DEFAULT 1');add(db,'services','internal','INTEGER NOT NULL DEFAULT 0')
 add(db,'users','platform_role',"TEXT NOT NULL DEFAULT ''");add(db,'users','license_level',"TEXT NOT NULL DEFAULT 'Driver'")
 db.exec('CREATE TABLE IF NOT EXISTS company_migrations(version INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS company_tombstones(id TEXT PRIMARY KEY,name TEXT NOT NULL,deleted_at TEXT NOT NULL,actor_id TEXT NOT NULL)')
 db.prepare("INSERT OR IGNORE INTO services(id,name,details,active,internal) VALUES('platform','Seacoast administration','{}',1,1)").run()
 if(!db.prepare('SELECT 1 FROM company_migrations WHERE version=1').get()){
  db.exec('BEGIN IMMEDIATE');try{
   for(const u of db.prepare('SELECT id FROM users').all()){
    const ms=db.prepare('SELECT * FROM service_memberships WHERE user_id=?').all(u.id)
    db.prepare('UPDATE users SET license_level=? WHERE id=?').run(licenseOf({tags:ms.flatMap(m=>JSON.parse(m.tags))}),u.id)
    for(const m of ms)db.prepare('UPDATE service_memberships SET tags=? WHERE user_id=? AND service_id=?').run(JSON.stringify(JSON.parse(m.tags).map(t=>t==='Service Admin'?'Company Admin':t)),u.id,m.service_id)
   }
   const founder=db.prepare("SELECT actor_id FROM identity_audit WHERE action='Initial administrator created' ORDER BY id LIMIT 1").get()
   if(founder?.actor_id)db.prepare("UPDATE users SET platform_role='Seacoast Admin' WHERE id=?").run(founder.actor_id)
   db.prepare('INSERT INTO company_migrations VALUES(1)').run();db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
 }
}
export function effectiveUser(row){
 const base=row.tags?JSON.parse(row.tags):defaultTags(row.license_level||'Driver','Company Admin')
 const tags=[...new Set([...base.filter(t=>!licenseLevels.includes(t)&&t!=='Seacoast Admin'),row.license_level||'Driver',...(row.platform_role==='Seacoast Admin'?['Seacoast Admin']:[])])]
 return {...row,tags,licenseLevel:row.license_level||'Driver',platformRole:row.platform_role||'',actor:row.name+' (@'+row.username+')',platformOnly:row.serviceId==='platform'}
}
export function readSession(db,req){
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('emcore_session='))?.slice(15)
 if(!token||!/^[a-f0-9]{64}$/.test(token))fail(401,'Sign in to continue')
 const row=db.prepare("SELECT u.id,u.username,u.name,u.platform_role,u.license_level,m.tags,m.active memberActive,s.service_id serviceId,s.expires_at,c.name serviceName,c.active companyActive,c.internal FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN services c ON c.id=s.service_id LEFT JOIN service_memberships m ON m.user_id=u.id AND m.service_id=s.service_id WHERE s.token_hash=?").get(hash(token))
 if(!row||row.expires_at<=Date.now()||row.platform_role!=='Seacoast Admin'&&(!row.memberActive||!row.companyActive||row.internal))fail(401,'Session expired or company/account deactivated. Sign in again.')
 return {...effectiveUser(row),tokenHash:hash(token)}
}
export function canSelectCompany(db,user,id){
 const s=typeof id==='string'?db.prepare('SELECT * FROM services WHERE id=?').get(id):null
 return Boolean(s&&(isSeacoast(user)||s.active&&!s.internal&&db.prepare('SELECT 1 FROM service_memberships WHERE user_id=? AND service_id=? AND active=1').get(user.id,id)))
}
export function validateAccount(db,user,body){
 if(!Array.isArray(body.tags))fail(400,'Choose account tags')
 if(body.tags.includes('Seacoast Admin'))fail(403,'Assign platform access separately')
 if(body.tags.filter(t=>licenseLevels.includes(t)).length>1)fail(400,'Choose one clinical license level')
 const license=body.licenseLevel||licenseOf({tags:body.tags})
 if(!licenseLevels.includes(license))fail(400,'Choose a clinical license level')
 body.tags=[...new Set([...body.tags.filter(t=>!licenseLevels.includes(t)).map(t=>t==='Service Admin'?'Company Admin':t),license])]
 if(body.tags.includes('Supervisor')&&body.tags.includes('Company Admin'))fail(400,'Choose one organization role')
 const previous=body.id?db.prepare('SELECT * FROM users WHERE id=?').get(body.id):null
 if(!isSeacoast(user)&&(body.platformAdmin||previous?.platform_role==='Seacoast Admin'))fail(403,'Only Seacoast Admin can manage platform administrators')
 if(body.platformAdmin!==undefined&&typeof body.platformAdmin!=='boolean')fail(400,'Invalid platform access')
 if(previous?.platform_role==='Seacoast Admin'&&body.platformAdmin===false&&db.prepare("SELECT count(*) n FROM users WHERE platform_role='Seacoast Admin'").get().n===1)fail(400,'Keep at least one Seacoast Admin')
 body.licenseLevel=license
}
export function persistAccount(db,id,body){db.prepare('UPDATE users SET license_level=?,platform_role=COALESCE(?,platform_role) WHERE id=?').run(body.licenseLevel,body.platformAdmin===undefined?null:body.platformAdmin?'Seacoast Admin':'',id)}
export function companyList(db,user){
 const rows=isSeacoast(user)?db.prepare('SELECT * FROM services WHERE internal=0 ORDER BY name').all():db.prepare('SELECT s.* FROM services s JOIN service_memberships m ON m.service_id=s.id WHERE m.user_id=? AND m.active=1 AND s.active=1 AND s.internal=0 ORDER BY s.name').all(user.id)
 return {services:rows.map(s=>({id:s.id,name:s.name,active:Boolean(s.active),...(companyAdmin(user)&&(isSeacoast(user)||s.id===user.serviceId)?JSON.parse(s.details):{})})),deletedCompanies:isSeacoast(user)?db.prepare('SELECT * FROM company_tombstones ORDER BY deleted_at DESC').all():[]}
}


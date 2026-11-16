export const licenseLevels=['Driver','EMT','AEMT','Paramedic']
export const organizationRoles=['User','Supervisor','Company Admin']
export const matrixRoles=[...licenseLevels,'Supervisor','Company Admin','Seacoast Admin']
export const managementRoles=['Supervisor','Company Admin','Seacoast Admin']
export function licenseOf(profile){return profile?.licenseLevel||licenseLevels.filter(level=>profile?.tags?.includes(level)).at(-1)||'Driver'}
export function isSeacoast(profile){return profile?.platformRole==='Seacoast Admin'||profile?.tags?.includes('Seacoast Admin')}
export function companyAdmin(profile){return !profile?.tags?.includes('Read Only')&&(isSeacoast(profile)||profile?.tags?.some(t=>['Company Admin','Service Admin'].includes(t)))}
export function matrixRole(profile){if(isSeacoast(profile))return 'Seacoast Admin';if(profile?.tags?.some(t=>['Company Admin','Service Admin'].includes(t)))return 'Company Admin';if(profile?.tags?.includes('Supervisor'))return 'Supervisor';return licenseOf(profile)}
const all=matrixRoles, clinical=matrixRoles.filter(role=>role!=='Driver'), receiving=['Paramedic',...managementRoles]
export const workflowMatrix=[
 ['companies.create','Create a company',['Seacoast Admin']],
 ['policies.edit','Edit company permissions',['Seacoast Admin']],
 ['companies.edit','Edit company contact information',['Company Admin','Seacoast Admin']],
 ['companies.delete','Hard delete a company',['Seacoast Admin']],
 ['companies.activate','Deactivate / reactivate a company',['Seacoast Admin']],
 ['companies.contacts','Manage company admin contacts',['Company Admin','Seacoast Admin']],
 ['containers.edit','Manage company locations',managementRoles],
 ['definitions.edit','Manage medication formulary',managementRoles],
 ['definitions.view','View medication formulary',all],
 ['discrepancies.approve','Approve discrepancies',managementRoles],
 ['stock.create','Add an individual medication item',receiving],
 ['checks.verify','Check / verify an individual item',all],
 ['medications.administer.nonNarcotic','Administer non-narcotic medication',clinical],
 ['medications.administer.narcotic','Administer narcotic medication',receiving],
 ['medications.waste.nonNarcotic','Waste partial non-narcotic medication',clinical],
 ['medications.waste.narcotic','Waste partial narcotic medication',receiving],
 ['medications.witness','Witness partial medication use / waste',all],
 ['inventory.transfer','Transfer between authorized storage locations',clinical],
 ['checks.start','Routine / daily inventory',all],
 ['seals.break','Break a seal',all],
 ['seals.reseal','Reseal a container',all],
].map(([id,label,roles])=>({id,label,roles}))
export function matrixAllowed(profile,resource){
 if(!profile)return false
 if(profile.tags?.includes('Read Only')&&!resource.endsWith('.view'))return false
 let key=resource
 if(resource==='medications.administer'||resource==='medications.waste')key=resource+'.nonNarcotic'
 if(['definitions.create','tags.edit','classes.edit'].includes(resource))key='definitions.edit'
 if(resource==='policies.view')return managementRoles.includes(matrixRole(profile))
 if(resource==='containers.view'||resource==='tags.view'||resource==='logs.view')return managementRoles.includes(matrixRole(profile))
 if(['checks.save','checks.complete','checks.reset','checks.adhoc'].includes(resource))key='checks.start'
 if(resource.startsWith('incidents.'))return resource.endsWith('.view')||matrixRole(profile)!=='Driver'
 const rule=workflowMatrix.find(row=>row.id===key)
 if(rule)return rule.roles.includes(matrixRole(profile))
 return ['home.view','inventory.view','stock.view','records.view','classes.view','discrepancies.view','discrepancies.report','users.view','services.view','account.view'].includes(resource)
}
export function medicationMatrixAllowed(profile,drug,action){
 if(!['administer','waste'].includes(action))return true
 if(!matrixAllowed(profile,'medications.'+action))return false
 const narcotic=Boolean(drug?.isNarcotic??drug?.is_narcotic)
 if(narcotic&&licenseOf(profile)!=='Paramedic')return false
 const minimum=drug?.minimumLicense||drug?.minimum_license||'Paramedic'
 return licenseLevels.indexOf(licenseOf(profile))>=licenseLevels.indexOf(minimum)&&licenseOf(profile)!=='Driver'
}
export function storageAllowed(profile,box){
 if(!box)return false
 const roles=box.allowedRoles||(typeof box.allowed_roles==='string'?JSON.parse(box.allowed_roles):matrixRoles)
 return roles.includes(matrixRole(profile))
}
export function needsPartner(profile){return licenseOf(profile)==='Driver'}
export function defaultTags(license='Driver',role='User'){
 const tags=[license,'User','Can Check','Can Witness']
 if(license!=='Driver'||role!=='User')tags.push('Can Create','Can Edit','Can Administer','Can Waste','Can Transfer')
 if(role!=='User')tags.push(role)
 return [...new Set(tags)]
}


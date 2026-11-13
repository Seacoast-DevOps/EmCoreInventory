import { useEffect, useState } from 'react'
import { request } from './api.js'
import { medicationPermitted } from '../shared/access-rules.js'
import { AccessContext } from './access-state.js'
import Login from './Login.jsx'
export function AccessProvider({children}){
 const [access,setAccess]=useState(null),[status,setStatus]=useState(null),[error,setError]=useState('')
 async function refresh(){try{const current=await request('auth/status');setStatus(current);setAccess(current.user?await request('access'):null);setError('')}catch(error){setError(error.message)}}
 useEffect(()=>{Promise.resolve().then(refresh);const expired=()=>{setAccess(null);setStatus({user:null,setupRequired:false})};window.addEventListener('emcore-session-expired',expired);return()=>window.removeEventListener('emcore-session-expired',expired)},[])
 async function logout(){try{await request('auth/logout',{})}finally{setAccess(null);await refresh()}}
 async function selectService(serviceId){if(!serviceId)return;await request('auth/service',{serviceId});await refresh()}
 const isAdmin=Boolean(access?.profile.tags.includes('Service Admin')&&!access?.profile.tags.includes('Read Only'))
 const value={access,error,refresh,logout,selectService,isAdmin,profileId:access?access.user.id+':'+access.user.serviceId:'signed-out',can:resource=>resource==='account.view'?true:['users.view','services.view'].includes(resource)?isAdmin:Boolean(access?.permissions[resource]),canDrug:(drug,action)=>Boolean(access)&&medicationPermitted(access.profile,drug,action)}
 return <AccessContext.Provider value={value}>{!status?<main className="login-page"><p role="status">{error||'Connecting…'}</p>{error&&<button onClick={refresh}>Retry</button>}</main>:!status.user?<Login setupRequired={status.setupRequired} onSignedIn={refresh}/>:children}</AccessContext.Provider>
}

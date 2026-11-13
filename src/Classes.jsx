import { useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { useAccess } from './access-state.js'
import { request,useInventory } from './api.js'
import { ClearInput,ClearTextarea } from './FormControls.jsx'
import Modal from './Modal.jsx'
export default function Classes(){
 const {data,setData,error,reload}=useInventory(),{can}=useAccess(),[editing,setEditing]=useState(null),[name,setName]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState('')
 function edit(item){setEditing(item);setName(item.name||'');setDescription(item.description||'');setFailure('')}
 async function save(event){event.preventDefault();setBusy(true);try{setData(await request('classes',{...(editing.id?{id:editing.id}:{}),name,description}));setEditing(null)}catch(error){setFailure(error.message)}finally{setBusy(false)}}
 if(!data)return <p>{error||'Loading classes…'}{error&&<button onClick={reload}>Retry</button>}</p>
 return <section><button className="action-primary" disabled={!can('classes.edit')} onClick={()=>edit({})}><Plus size={18}/> Add medication class</button><div className="settings-list classes-list">{!data.classes.length&&<p>No medication classes yet.</p>}{data.classes.map(item=><article key={item.id} className="settings-card"><div className="settings-card-heading"><h2>{item.name}</h2><button className="icon-button" disabled={!can('classes.edit')} aria-label={'Edit class '+item.name} onClick={()=>edit(item)}><Pencil size={18}/></button></div><p>{item.description}</p></article>)}</div>{editing&&<Modal title={editing.id?'Edit medication class':'Add medication class'} busy={busy} onClose={()=>setEditing(null)}><form className="form-stack" onSubmit={save}><label>Class name<ClearInput clearLabel="Class name" className="form-control" maxLength={100} required value={name} onChange={event=>setName(event.target.value)}/></label><label>Description<ClearTextarea clearLabel="Class description" className="form-control" maxLength={500} value={description} onChange={event=>setDescription(event.target.value)}/></label>{failure&&<p role="alert" className="error-note">{failure}</p>}<div className="dialog-actions"><button type="button" className="cancel-button" onClick={()=>setEditing(null)}>Cancel</button><button className="action-primary" disabled={busy}>Save class</button></div></form></Modal>}</section>
}

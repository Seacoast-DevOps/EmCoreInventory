import { ClearInput, SearchSelect } from './FormControls.jsx'
import { useState } from 'react'
import { Plus, Pencil, Package, Truck, LockKeyhole, BriefcaseMedical, Archive } from 'lucide-react'
import { useInventory, request, confirmedSeals } from './api.js'
import { useAccess } from './access-state.js'
import Modal, { SealQuestion } from './Modal.jsx'

const icons = { box:Package, truck:Truck, lock:LockKeyhole, medical:BriefcaseMedical, cabinet:Archive }
function ContainerEditor({ box, data, onSaved, onClose }) {
  const [name,setName] = useState(box?.name || ''), [location,setLocation] = useState(box?.location || ''), [kind,setKind] = useState(box?.kind || 'Drug box'), [icon,setIcon] = useState(box?.icon || 'box')
  const [sealed,setSealed] = useState(Boolean(box?.sealed)), [seal,setSeal] = useState(box?.seal || ''), [transparent,setTransparent] = useState(Boolean(box?.transparent)), [hours,setHours] = useState(box?.check_interval_hours ?? 24)
  const [witnessNeeded,setWitnessNeeded] = useState(false), [broken,setBroken] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true);setError('')
    try { onSaved(await request('containers',{...(box?{id:box.id}:{}),name,location,kind,icon,sealed,seal,transparent,checkIntervalHours:Number(hours),brokenSeals:broken?confirmedSeals(broken):[]}));onClose() }
    catch(error){if(error.sealedBoxes)setBroken(error.sealedBoxes);else setError(error.message);if(error.witnessRequired)setWitnessNeeded(true)}finally{setBusy(false)}
  }
  const Preview=icons[icon]||Package
  return <Modal title={broken?'Confirm broken seal':box?'Edit container':'New container / storage'} busy={busy} onClose={onClose}><form className="form-stack" onSubmit={save}>{broken?<SealQuestion boxes={broken}/>:<>
    <label>Storage area / unit<ClearInput clearLabel="Storage area / unit" aria-label="Storage area / unit" className="form-control" list="storage-areas" maxLength={100} required value={location} onChange={event=>setLocation(event.target.value)}/><datalist id="storage-areas">{[...new Set(data.boxes.filter(box=>box.id!=='unassigned').map(box=>box.location))].map(location=><option key={location}>{location}</option>)}</datalist></label>
    <label>Container name<ClearInput clearLabel="Container name" className="form-control" maxLength={100} required value={name} onChange={event=>setName(event.target.value)}/></label>
    <label>Type<SearchSelect clearLabel="Type" aria-label="Container type" className="form-select" value={kind} onChange={event=>setKind(event.target.value)}>{['Drug box','Cabinet','Narcotic box','Pelican box'].map(kind=><option key={kind}>{kind}</option>)}</SearchSelect></label>
    <div className="container-icon-preview"><Preview size={42}/><span>{kind}</span></div><label>Icon<SearchSelect clearLabel="Icon" aria-label="Container icon" className="form-select" value={icon} onChange={event=>setIcon(event.target.value)}>{Object.keys(icons).map(icon=><option key={icon}>{icon}</option>)}</SearchSelect></label>
    <label>Check every (hours)<ClearInput clearLabel="Check every (hours)" className="form-control" type="number" step="any" min="0" max="8760" required value={hours} onChange={event=>setHours(event.target.value)}/></label><p className="field-help">0 = manual checks. A shorter drug-type interval makes this container due sooner.</p>
    <label className="settings-check"><ClearInput type="checkbox" checked={transparent} onChange={event=>setTransparent(event.target.checked)}/><span>Transparent container</span></label>
    <label className="settings-check"><ClearInput type="checkbox" checked={sealed} onChange={event=>setSealed(event.target.checked)}/><span>Sealed</span></label>{sealed&&<label>Seal number<ClearInput clearLabel="Seal number" className="form-control" maxLength={40} required value={seal} onChange={event=>setSeal(event.target.value)}/></label>}
  </>}{witnessNeeded&&<p className="policy-note">A second user will sign in to witness this seal change when you save.</p>}{error&&<p className="error-note" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="cancel-button" disabled={busy} onClick={onClose}>Cancel</button><button className="action-primary" disabled={busy}>{busy?'Saving…':broken?'Confirm and save':'Save container'}</button></div></form></Modal>
}

export default function ContainerDesigner(){
  const {can}=useAccess()
  const {data,setData,error,reload}=useInventory(), [editing,setEditing]=useState(null), [notice,setNotice]=useState('')
  if(!data)return <section className="card"><p>{error||'Loading…'}</p>{error&&<button onClick={reload}>Retry</button>}</section>
  return <section><button className="action-primary" disabled={!can('containers.edit')} onClick={()=>setEditing({})}><Plus size={18}/> New container / storage</button><p role="status" className="inventory-status">{notice}</p>{[...new Set(data.boxes.map(box=>box.location))].map(location=><section className="designer-area" key={location}><h2>{location}</h2>{data.boxes.filter(box=>box.location===location).map(box=>{const Icon=icons[box.icon]||Package;return <article key={box.id} className="designer-box"><Icon size={26}/><span><strong>{box.name}</strong><small>{box.kind} · {box.sealed?'Sealed '+box.seal:'Unsealed'} · {box.check_interval_hours?box.check_interval_hours+'h checks':'Manual checks'}</small></span><button className="icon-button" disabled={!can('containers.edit')} aria-label={'Edit '+box.location+' '+box.name} onClick={()=>setEditing(box)}><Pencil size={18}/></button></article>})}</section>)}{editing&&<ContainerEditor box={editing.id?editing:null} data={data} onClose={()=>setEditing(null)} onSaved={result=>{setData(result);setNotice('Container saved.')}}/>}</section>
}

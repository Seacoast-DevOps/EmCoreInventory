import { ClearInput } from './FormControls.jsx'
import { useEffect, useRef, useState } from 'react'
import { Truck, ShieldPlus, LockKeyhole, LockKeyholeOpen, BriefcaseMedical, ChevronLeft, ChevronRight, ChevronDown, Package, Search, Archive, Check } from 'lucide-react'

function AreaIcon({ location, icon, ...props }) {
  const Icon = icon === 'cabinet' ? Archive : icon === 'box' ? Package : icon === 'medical' ? BriefcaseMedical : icon === 'lock' ? LockKeyhole : location.startsWith('Unit') ? Truck : location.includes('Narcotic') ? LockKeyhole : location.includes('BLS') ? ShieldPlus : BriefcaseMedical
  return <Icon {...props} />
}

export function StorageCarousel({ data, location, onChange }) {
  const track = useRef(null)
  const drag = useRef(null)
  const suppressClick = useRef(false)
  const locations = [...new Set(data.boxes.map(box => box.location))]
  const scrollBusy=useRef(false),scrollTimer=useRef(null)
  useEffect(()=>{if(!scrollBusy.current){const area=[...new Set(data.boxes.map(box=>box.location))].indexOf(location);const card=track.current?.children[area];if(card)track.current.scrollTo({left:card.offsetLeft,behavior:'instant'})}},[location,data.boxes])
  useEffect(()=>()=>clearTimeout(scrollTimer.current),[])
  const index = Math.max(0, locations.indexOf(location))
  function jump(next) {
    next = Math.max(0, Math.min(locations.length - 1, next))
    const element = track.current.children[next]
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    track.current.scrollTo({ left: element.offsetLeft, behavior: reduced ? 'instant' : 'smooth' })
    scrollBusy.current=true
    clearTimeout(scrollTimer.current);scrollTimer.current=setTimeout(()=>{scrollBusy.current=false},200)
    onChange(locations[next])
  }
  function scrolled() {
    scrollBusy.current=true;clearTimeout(scrollTimer.current);scrollTimer.current=setTimeout(()=>{scrollBusy.current=false},150)
    const cards = [...track.current.children]
    const offset = track.current.scrollLeft
    const nearest = cards.reduce((best, card, i) => Math.abs(card.offsetLeft - offset) < Math.abs(cards[best].offsetLeft - offset) ? i : best, 0)
    onChange(locations[nearest])
  }
  function pointerDown(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    suppressClick.current = false
    drag.current = { start: event.clientX, left: track.current.scrollLeft, moved: false }
    track.current.style.scrollSnapType = 'none'
  }
  function pointerMove(event) {
    if (!drag.current) return
    const delta = event.clientX - drag.current.start
    if (Math.abs(delta) > 8) {
      drag.current.moved = true
      track.current.setPointerCapture(event.pointerId)
      event.preventDefault()
      track.current.scrollLeft = drag.current.left - delta
    }
  }
  function pointerUp() {
    if (!drag.current) return
    suppressClick.current = drag.current.moved
    drag.current = null
    track.current.style.scrollSnapType = 'x mandatory'
    const cards = [...track.current.children]
    const nearest = cards.reduce((best, card, i) => Math.abs(card.offsetLeft - track.current.scrollLeft) < Math.abs(cards[best].offsetLeft - track.current.scrollLeft) ? i : best, 0)
    if (suppressClick.current) jump(nearest)
  }
  return <section className="storage-carousel" aria-label="Storage areas" aria-roledescription="carousel">
    <div className="carousel-toolbar"><span>{index + 1} / {locations.length}</span><div><button aria-label="Previous storage area" disabled={index === 0} onClick={() => jump(index - 1)}><ChevronLeft size={22}/></button><button aria-label="Next storage area" disabled={index === locations.length - 1} onClick={() => jump(index + 1)}><ChevronRight size={22}/></button></div></div>
    <div className="storage-track" ref={track} onScroll={scrolled} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onDragStart={event => event.preventDefault()} onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() } }} onKeyDown={event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); jump(index + (event.key === 'ArrowRight' ? 1 : -1)) } }}>
      {locations.map((area, i) => {
        const ids = data.boxes.filter(box => box.location === area).map(box => box.id)
        const count = data.items.filter(item => ids.includes(item.box_id)).length
        return <button key={area} className={'storage-slide ' + (location === area ? 'selected' : '')} aria-label={area} aria-pressed={location === area} onClick={() => jump(i)}>
          <span className="area-icon"><AreaIcon location={area} icon={data.boxes.find(box => box.location === area)?.icon} size={30}/></span><span><strong>{area.replace('Storage Room - ', '')}</strong><small>{area.startsWith('Unit') ? 'Unit inventory' : 'Storage Room'} · {count} items</small></span>
        </button>
      })}
    </div>
    <div className="carousel-dots">{locations.map((area, i) => <button key={area} className={area === location ? 'selected' : ''} aria-label={'Show ' + area} aria-current={area === location ? 'true' : undefined} onClick={() => jump(i)}><span/></button>)}</div>
  </section>
}

export default function StorageBrowser({ data, location, onLocationChange, renderItem, searchable = false, showChecks = false, renderCheckControls, allowUnassigned = false }) {
  const [query, setQuery] = useState(''), [showCompleted, setShowCompleted] = useState(false)
  const browserData=allowUnassigned?data:{...data,boxes:data.boxes.filter(box=>box.id!=='unassigned'),items:data.items.filter(item=>item.box_id!=='unassigned')}
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = item => terms.every(term => [item.medication, item.presentation, item.code, ...(item.tagNames || [])].join(' ').toLowerCase().includes(term))
  const visibleBoxes = browserData.boxes.filter(box => box.location === location && (!showChecks || showCompleted || data.checks?.find(check => check.boxId === box.id)?.status !== 'complete') && (!terms.length || data.items.some(item => item.box_id === box.id && matches(item))))
  return <><StorageCarousel data={browserData} location={location} onChange={onLocationChange}/>
    {searchable && <div className="medication-search"><label className="field-label" htmlFor="medication-search">Search {location}</label><div><Search size={19} aria-hidden="true"/><ClearInput id="medication-search" type="search" value={query} placeholder="Name, strength, code, or tag" onChange={event => setQuery(event.target.value)}/></div></div>}
    <h2 className="storage-list-title">{location}</h2>{showChecks && <label className="settings-check completed-toggle"><ClearInput type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)}/><span><Check size={17}/> Show completed checks</span></label>}
    {!visibleBoxes.length && <p role="status" className="empty-settings">{showChecks && !terms.length ? 'No checks due here. Enable Show completed checks to see finished containers.' : 'No matching medications in ' + location + '.'}</p>}
    {visibleBoxes.map(box => {
      const check = data.checks?.find(check => check.boxId === box.id)
      const allItems = data.items.filter(item => item.box_id === box.id)
      const items = allItems.filter(matches)
      return <details className="inventory-box" key={box.id} name="storage-containers">
        <summary><Package size={20} aria-hidden="true"/><span><strong>{box.name}</strong><small>{terms.length ? `${items.length} matching / ${allItems.length} items` : showChecks ? `${items.length} items · ${check?.checkedIds.length || 0} verified` : `${items.length} items`}</small>{showChecks && <small className={'check-state ' + (check?.status || 'not_done')}>{box.id==='unassigned'?'Unassigned · transfer to a container':check?.status === 'complete' ? <><Check size={14}/> Complete</> : check?.status === 'draft' ? 'Draft · ' + check.checkedIds.length + '/' + check.total : check?.overdue ? 'Not done · Overdue' : 'Not done'}</small>}</span><span className={'seal-badge ' + (box.sealed ? 'sealed' : 'unsealed')}>{box.sealed ? <LockKeyhole size={15}/> : <LockKeyholeOpen size={15}/>} {box.sealed ? 'Sealed' : 'Unsealed'}</span><ChevronDown className="box-chevron" size={17}/></summary>
        <div className="box-body">{showChecks && renderCheckControls?.(box,check)}{box.seal && <p className="seal-description">{box.sealed ? 'Seal' : 'Broken seal'} <strong>{box.seal}</strong></p>}
          <ul className="item-list">{items.map(item => <li key={item.id}>{renderItem(item, box)}</li>)}</ul>
          {!items.length && <p className="empty-box">This container is empty.</p>}
        </div>
      </details>
    })}
  </>
}

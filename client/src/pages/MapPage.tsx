import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Pencil, Save } from 'lucide-react';
import { SEVERITY_RANK, type MapConfig, type MapMarker } from '@shared/types.ts';
import { useTagValues } from '../hooks/useTags.ts';
import { api } from '../lib/api.ts';
import { formatValue, uid } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useAlarms } from '../stores/alarms.ts';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

const ICONS: Record<string, string> = { site: '📍', home: '🏠', pump: '⛽', tank: '🛢️', sensor: '📡', factory: '🏭' };
const STATUS_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', info: '#64748b', ok: '#22c55e' } as const;

function markerIcon(m: MapMarker, status: keyof typeof STATUS_COLOR, unacked: boolean) {
  return L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 38],
    popupAnchor: [0, -34],
    html: `<div class="map-marker ${unacked ? 'blink' : ''}" style="border-color:${STATUS_COLOR[status]};box-shadow:0 0 0 4px ${STATUS_COLOR[status]}55"><span>${ICONS[m.icon ?? 'site'] ?? '📍'}</span></div>`,
  });
}

/** GIS overview: sites coloured by their worst active alarm, popups with live values and display links. */
export function MapPage() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(undefined);
  const layer = useRef<L.LayerGroup>(undefined);
  const [cfg, setCfg] = useState<MapConfig | null>(null);
  const [edit, setEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canEdit = useHasRole('engineer');
  const alarms = useAlarms((s) => s.list);
  const tags = useProject((s) => s.tags);
  const revision = useProject((s) => s.revision);
  const allTags = useMemo(() => (cfg?.markers ?? []).flatMap((m) => m.tags ?? []), [cfg]);
  const get = useTagValues(allTags);

  useEffect(() => {
    if (!dirty) api.get<MapConfig>('/map').then(setCfg).catch(errorToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // create map once
  useEffect(() => {
    if (!cfg || map.current) return;
    const m = L.map(host.current!, { zoomControl: true }).setView(cfg.center, cfg.zoom);
    L.tileLayer(cfg.tileUrl ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: cfg.attribution ?? '© OpenStreetMap', maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); m.remove(); map.current = undefined; };
  }, [cfg]);

  // add marker on click in edit mode
  useEffect(() => {
    const m = map.current;
    if (!m || !edit) return;
    const onClick = async (e: L.LeafletMouseEvent) => {
      const name = await useUi.getState().prompt('Marker name:', 'New site');
      if (!name) return;
      setCfg((c) => c && { ...c, markers: [...c.markers, { id: uid('m'), name, lat: Number(e.latlng.lat.toFixed(5)), lng: Number(e.latlng.lng.toFixed(5)), icon: 'site' }] });
      setDirty(true);
    };
    m.on('click', onClick);
    return () => { m.off('click', onClick); };
  }, [edit, cfg]);

  // build markers when the configuration or edit mode changes
  const markers = useRef(new Map<string, { marker: L.Marker; values: HTMLElement; status: string; mk: MapMarker }>());
  useEffect(() => {
    const lg = layer.current;
    if (!lg || !cfg) return;
    lg.clearLayers();
    markers.current.clear();
    for (const mk of cfg.markers) {
      const marker = L.marker([mk.lat, mk.lng], { icon: markerIcon(mk, 'ok', false), draggable: edit }).addTo(lg);
      const popup = document.createElement('div');
      popup.className = 'map-popup';
      const title = document.createElement('h4');
      title.textContent = mk.name;
      const values = document.createElement('div');
      popup.append(title, values);
      const addButton = (text: string, onClick: () => void, cls = '') => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = cls;
        btn.onclick = onClick;
        popup.appendChild(btn);
      };
      if (mk.display) addButton('Open display', () => navigate('view', mk.display!));
      if (mk.path) addButton('Faceplate', () => useUi.getState().openFaceplate(mk.path!));
      if (edit) addButton('Delete', () => { setCfg((c) => c && { ...c, markers: c.markers.filter((x) => x.id !== mk.id) }); setDirty(true); }, 'danger');
      marker.bindPopup(popup);
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        setCfg((c) => c && { ...c, markers: c.markers.map((x) => (x.id === mk.id ? { ...x, lat: Number(ll.lat.toFixed(5)), lng: Number(ll.lng.toFixed(5)) } : x)) });
        setDirty(true);
      });
      markers.current.set(mk.id, { marker, values, status: '', mk });
    }
  }, [cfg, edit]);

  // update status colours and popup values in place (keeps open popups open)
  useEffect(() => {
    for (const entry of markers.current.values()) {
      const { mk } = entry;
      const mine = mk.path ? alarms.filter((a) => a.tag.startsWith(mk.path!) && !a.shelvedUntil) : [];
      const worst = [...mine].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
      const unacked = mine.some((a) => a.state === 'active-unacked');
      const status = `${worst?.severity ?? 'ok'}:${unacked}`;
      if (status !== entry.status) {
        entry.status = status;
        entry.marker.setIcon(markerIcon(mk, worst ? worst.severity : 'ok', unacked));
      }
      const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
      entry.values.innerHTML = `<div class="muted">${mine.length ? `${mine.length} active alarm(s)` : 'No active alarms'}</div><table>${(mk.tags ?? [])
        .map((t) => `<tr><td>${esc(t.split('/').slice(-2).join(' / '))}</td><td><b>${esc(formatValue(get(t)?.value, tags.get(t)))}</b></td></tr>`).join('')}</table>`;
    }
  }, [cfg, edit, alarms, get, tags]);

  const save = async () => {
    if (!cfg || !map.current) return;
    const c = map.current.getCenter();
    try {
      await api.put('/map', { ...cfg, center: [Number(c.lat.toFixed(4)), Number(c.lng.toFixed(4))], zoom: map.current.getZoom() });
      setDirty(false);
      toast('Map saved to project.yaml', 'success');
    } catch (err) { errorToast(err); }
  };

  return (
    <div className="page">
      <main className="content">
        <div className="content-head">
          <h2><MapPin size={18} /> Map</h2>
          <span className="muted small">{cfg?.markers.length ?? 0} sites · colour = worst active alarm</span>
          <span className="spacer" />
          {edit && <span className="muted small">Click the map to add a site · drag markers to move</span>}
          {edit && <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={14} /> Save</button>}
          {canEdit && <button className={edit ? 'active' : ''} onClick={() => setEdit(!edit)}><Pencil size={14} /> {edit ? 'Done' : 'Edit'}</button>}
        </div>
        <div className="content-body"><div ref={host} className="map-host" /></div>
      </main>
    </div>
  );
}

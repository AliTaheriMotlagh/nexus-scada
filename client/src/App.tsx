import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Bell, Box, Cpu, FileCode2, FlaskConical, LineChart, LogIn, LogOut, Map, Menu, Monitor, Moon, PanelLeftOpen, PanelRightOpen, PencilRuler, Settings2, Sun, Tags, Wrench, X,
} from 'lucide-react';
import type { Role, SessionUser } from '@shared/types.ts';
import { AlarmBar } from './components/AlarmBar.tsx';
import { FaceplateHost } from './components/FaceplateHost.tsx';
import { LoginDialog } from './components/LoginDialog.tsx';
import { DialogHost, ToastHost } from './components/Overlays.tsx';
import { TagDatalist } from './components/TagPicker.tsx';
import { api } from './lib/api.ts';
import { runtime } from './lib/hub.ts';
import { navigate, useRoute } from './lib/router.ts';
import { AlarmsPage } from './pages/AlarmsPage.tsx';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { DesignPage } from './pages/DesignPage.tsx';
import { DevicesPage } from './pages/DevicesPage.tsx';
import { MapPage } from './pages/MapPage.tsx';
import { RecipesPage } from './pages/RecipesPage.tsx';
import { ScenesPage } from './pages/ScenesPage.tsx';
import { ScriptsPage } from './pages/ScriptsPage.tsx';
import { SystemPage } from './pages/SystemPage.tsx';
import { TagsPage } from './pages/TagsPage.tsx';
import { TrendsPage } from './pages/TrendsPage.tsx';
import { ViewPage } from './pages/ViewPage.tsx';
import { useAlarms } from './stores/alarms.ts';
import { useProject } from './stores/project.ts';
import { hasRole, useSession } from './stores/session.ts';
import { useUi } from './stores/ui.ts';

interface NavItem { id: string; label: string; icon: ReactNode; role: Role; page: () => ReactNode; drawers?: ('left' | 'right')[] }

const NAV: NavItem[] = [
  { id: 'view', label: 'Runtime', icon: <Monitor size={17} />, role: 'viewer', page: () => <ViewPage /> , drawers: ['left'] },
  { id: 'scenes', label: '3D', icon: <Box size={17} />, role: 'viewer', page: () => <ScenesPage /> , drawers: ['left', 'right'] },
  { id: 'alarms', label: 'Alarms', icon: <Bell size={17} />, role: 'viewer', page: () => <AlarmsPage /> },
  { id: 'trends', label: 'Trends', icon: <LineChart size={17} />, role: 'viewer', page: () => <TrendsPage /> , drawers: ['left'] },
  { id: 'map', label: 'Map', icon: <Map size={17} />, role: 'viewer', page: () => <MapPage /> },
  { id: 'tags', label: 'Tags', icon: <Tags size={17} />, role: 'viewer', page: () => <TagsPage /> , drawers: ['left'] },
  { id: 'devices', label: 'Devices', icon: <Cpu size={17} />, role: 'viewer', page: () => <DevicesPage /> },
  { id: 'recipes', label: 'Recipes', icon: <FlaskConical size={17} />, role: 'viewer', page: () => <RecipesPage /> },
  { id: 'design', label: 'Designer', icon: <PencilRuler size={17} />, role: 'engineer', page: () => <DesignPage /> , drawers: ['left', 'right'] },
  { id: 'scripts', label: 'Scripts', icon: <FileCode2 size={17} />, role: 'engineer', page: () => <ScriptsPage /> , drawers: ['left'] },
  { id: 'config', label: 'Config', icon: <Settings2 size={17} />, role: 'engineer', page: () => <ConfigPage /> , drawers: ['right'] },
  { id: 'system', label: 'System', icon: <Wrench size={17} />, role: 'engineer', page: () => <SystemPage /> },
];

function useConnectionState() {
  return useSyncExternalStore((cb) => runtime.onState(cb), () => runtime.state);
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="clock mono">{now.toLocaleTimeString()}</span>;
}

function NavDrawer({ onClose, role }: { onClose: () => void; role: Role | null }) {
  const route = useRoute();
  const project = useProject((s) => s.info?.name);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <nav className="nav-drawer" aria-label="Main">
        <div className="nav-drawer-head"><span>{project}</span><button className="icon-btn" onClick={onClose} aria-label="Close menu"><X size={18} /></button></div>
        {NAV.filter((n) => hasRole(n.role, role)).map((n) => (
          <button key={n.id} className={`nav-drawer-item ${route.page === n.id || (!route.page && n.id === 'view') ? 'active' : ''}`}
            onClick={() => { navigate(n.id); onClose(); }}>
            {n.icon}<span>{n.label}</span>
          </button>
        ))}
        <div className="nav-drawer-foot">
          <button onClick={() => useUi.getState().toggleTheme()}><Sun size={15} /> Toggle theme</button>
        </div>
      </nav>
    </>
  );
}

function Header() {
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const user = useSession((s) => s.user);
  const anon = useSession((s) => s.anonymousRole);
  const project = useProject((s) => s.info?.name);
  const demo = useProject((s) => s.info?.demo);
  const theme = useUi((s) => s.theme);
  const conn = useConnectionState();
  const unacked = useAlarms((s) => s.list.filter((a) => a.state !== 'active-acked' && !a.shelvedUntil).length);
  const role = user?.role ?? anon;
  const logout = () => {
    useSession.getState().logout();
    void runtime.start();
    void useProject.getState().refresh().catch(() => undefined);
  };
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
      {menu && <NavDrawer onClose={() => setMenu(false)} role={role} />}
      <div className="brand" onClick={() => navigate('view')}>
        <img src="/favicon.svg" alt="" width={24} height={24} />
        <span>Nexus<span className="brand-light">SCADA</span></span>
      </div>
      <nav className="nav">
        {NAV.filter((n) => hasRole(n.role, role)).map((n) => (
          <button key={n.id} className={`nav-btn ${route.page === n.id || (!route.page && n.id === 'view') ? 'active' : ''}`} onClick={() => navigate(n.id)} title={n.label}>
            {n.icon}<span className="nav-label">{n.label}</span>
            {n.id === 'alarms' && unacked > 0 && <span className="badge blink">{unacked}</span>}
          </button>
        ))}
      </nav>
      <span className="spacer" />
      <span className="project-name">{project}</span>
      {demo && <span className="demo-badge" title="Public demo: operate freely; saving scripts, graphics and configuration is disabled. Sign in as admin/admin, engineer/engineer or operator/operator.">PUBLIC DEMO</span>}
      <span className={`conn conn-${conn}`} title={`Runtime link: ${conn}`}><i /><span className="conn-text">{conn}</span></span>
      <Clock />
      <button className="icon-btn hide-phone" onClick={() => useUi.getState().toggleTheme()} title="Toggle theme">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      {user
        ? <button className="user-btn" onClick={logout} title="Sign out"><span className="avatar">{user.username[0].toUpperCase()}</span><span className="user-name">{user.username}<small> {user.role}</small></span><LogOut size={14} /></button>
        : <button className="user-btn" onClick={() => useSession.getState().openLogin(true)}><LogIn size={14} /><span className="user-name">Sign in</span></button>}
    </header>
  );
}

let booted = false;

export function App() {
  const route = useRoute();
  const user = useSession((s) => s.user);
  const anon = useSession((s) => s.anonymousRole);
  const loaded = useProject((s) => s.loaded);
  const [bootError, setBootError] = useState('');
  const role = user?.role ?? anon;

  // boot: restore session, connect the hub, load the project model (once, even under StrictMode)
  useEffect(() => {
    if (booted) return;
    booted = true;
    (async () => {
      try {
        const info = await fetch('/api/info').then((r) => r.json());
        useSession.getState().setAnonymousRole(info.anonymousRole ?? null);
        if (useSession.getState().token) {
          const me = await api.get<SessionUser | null>('/auth/me').catch(() => null);
          if (me && me.username !== 'anonymous') useSession.getState().setSession(useSession.getState().token, me);
          else useSession.getState().logout();
        }
        void runtime.start();
        if (hasRole('viewer')) await useProject.getState().refresh();
        else useSession.getState().openLogin(true);
      } catch (err) {
        setBootError((err as Error).message);
      }
    })();
  }, []);

  // reload the project model whenever the identity changes
  useEffect(() => {
    if (role) void useProject.getState().refresh().catch(() => undefined);
  }, [user, role]);

  const item = NAV.find((n) => n.id === (route.page || 'view')) ?? NAV[0];
  const allowed = hasRole(item.role, role);
  const drawer = useUi((s) => s.drawer);
  useEffect(() => { useUi.getState().setDrawer(null); }, [route.page]);

  return (
    <div className={`app page-${item.id}`}>
      <Header />
      <div className="main">
        {bootError && <div className="boot-error">Cannot reach the server: {bootError}</div>}
        {!bootError && !role && <div className="boot-error">Sign in to continue.</div>}
        {!bootError && role && !loaded && <div className="loading">Loading project…</div>}
        {!bootError && role && loaded && (allowed ? item.page() : <div className="boot-error">You need the “{item.role}” role for this page. <button onClick={() => useSession.getState().openLogin(true)}>Sign in</button></div>)}
      </div>
      {role && loaded && allowed && item.drawers?.map((side) => (
        <button key={side} className={`drawer-fab ${side} ${item.id === 'design' ? 'wide-bp' : ''} ${drawer === side ? 'active' : ''}`}
          aria-label={side === 'left' ? 'Toggle navigator' : 'Toggle properties'}
          onClick={() => useUi.getState().setDrawer(drawer === side ? null : side)}>
          {side === 'left' ? <PanelLeftOpen size={20} /> : <PanelRightOpen size={20} />}
        </button>
      ))}
      {role && <AlarmBar />}
      <FaceplateHost />
      <TagDatalist />
      <LoginDialog />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

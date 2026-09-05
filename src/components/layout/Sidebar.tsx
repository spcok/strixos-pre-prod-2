import React, { useState, useEffect } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useAuth } from '../../lib/auth';
import { 
  LayoutDashboard, ClipboardList, ShieldAlert,
  CalendarDays, Apple, Syringe, Activity, BriefcaseMedical, AlertTriangle, 
  Wrench, Users, Clock, CalendarHeart, FileBadge, FileWarning, 
  BarChart3, Settings, ChevronDown, 
  Utensils, LogOut, MapPin, ArrowRightLeft,
  Ticket, QrCode, Skull, Maximize, Minimize, X,
  RotateCcw, FileSpreadsheet
} from 'lucide-react';

import logoImg from '../../assets/logo.png';

export interface SidebarProps {
  isOpen?: boolean;
  onMobileClose?: () => void;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  return isMobile;
}

function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine);
    }
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  return isOnline;
}

async function hardResetApp() {
  const confirmed = window.confirm(
    'Reset App & Purge Cache?\n\nThis will clear all offline storage, cached files, and session cookies, then reinstall the latest version from the server.'
  );
  if (!confirmed) return;

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }

    localStorage.clear();
    sessionStorage.clear();

    if (window.indexedDB && indexedDB.databases) {
      try {
        const databases = await indexedDB.databases();
        await Promise.all(
          databases.map((db) => {
            if (db.name) {
              return new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
                req.onblocked = () => resolve(false);
              });
            }
            return Promise.resolve();
          })
        );
      } catch (e) {
        console.warn('Could not clear IndexedDB:', e);
      }
    }

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname}`;
    }

    window.location.replace(`${window.location.origin}/?reinstall=${Date.now()}`);
  } catch (error) {
    console.error('Error executing hard reset:', error);
    window.location.reload();
  }
}

interface NavItem {
  name: string;
  to: string;
  icon: React.ElementType;
  requiredPermission?: string;
}

interface NavGroupData {
  title: string;
  icon: React.ElementType;
  requireDesktop?: boolean;
  requireOnline?: boolean;
  items: NavItem[];
}

const navGroups: NavGroupData[] = [
  {
    title: 'Husbandry',
    icon: Apple,
    requireDesktop: false,
    requireOnline: false,
    items: [
      { name: 'Daily Logs', to: '/husbandry/daily-logs', icon: ClipboardList, requiredPermission: 'husbandry:read' },
      { name: 'Daily Rounds', to: '/husbandry/rounds', icon: CalendarDays, requiredPermission: 'husbandry:read' },
      { name: 'Import Sheets', to: '/husbandry/import', icon: FileSpreadsheet, requiredPermission: 'husbandry:write' },
      { name: 'Feeding Schedule', to: '/husbandry/feeding', icon: Utensils, requiredPermission: 'husbandry:read' },
      { name: 'Compliance Audit', to: '/husbandry/missing-records', icon: ShieldAlert, requiredPermission: 'husbandry:read' },
    ]
  },
  {
    title: 'Clinical',
    icon: BriefcaseMedical,
    requireDesktop: true,
    requireOnline: false,
    items: [
      { name: 'Medical Records', to: '/clinical/records', icon: BriefcaseMedical, requiredPermission: 'clinical:read' },
      { name: 'Medications', to: '/clinical/medications', icon: Syringe, requiredPermission: 'clinical:read' },
      { name: 'Isolation/Quarantine', to: '/clinical/isolation', icon: Activity, requiredPermission: 'clinical:read' },
      { name: 'Mortality Ledger', to: '/clinical/mortality', icon: Skull, requiredPermission: 'clinical:read' },
    ]
  },
  {
    title: 'Logistics',
    icon: ArrowRightLeft,
    requireDesktop: true,
    requireOnline: false,
    items: [
      { name: 'Internal Movements', to: '/logistics/internal-movements', icon: MapPin, requiredPermission: 'transfers:read' },
      { name: 'External Transfers', to: '/logistics/external-transfers', icon: ArrowRightLeft, requiredPermission: 'transfers:read' },
    ]
  },
  {
    title: 'Vouchers',
    icon: Ticket,
    requireDesktop: false,
    requireOnline: false,
    items: [
      { name: 'Voucher Directory', to: '/logistics/vouchers', icon: QrCode, requiredPermission: 'vouchers:read' },
    ]
  },
  {
    title: 'Safety & Ops',
    icon: ShieldAlert,
    requireDesktop: true,
    requireOnline: false,
    items: [
      { name: 'Safety Drills', to: '/safety/drills', icon: FileWarning, requiredPermission: 'safety:read' },
      { name: 'Incident Reports', to: '/safety/incidents', icon: AlertTriangle, requiredPermission: 'safety:read' },
      { name: 'First Aid', to: '/safety/first-aid', icon: BriefcaseMedical, requiredPermission: 'safety:read' },
      { name: 'Maintenance Requests', to: '/safety/maintenance', icon: Wrench, requiredPermission: 'safety:read' },
    ]
  },
  {
    title: 'Staff Hub',
    icon: Users,
    requireDesktop: true,
    requireOnline: false,
    items: [
      { name: 'Staff Rota', to: '/staff/rota', icon: CalendarHeart, requiredPermission: 'rota:view' },
      { name: 'My Shifts', to: '/staff/shifts', icon: Clock, requiredPermission: 'timesheet:self' },
      { name: 'Leave Requests', to: '/staff/leave', icon: CalendarDays, requiredPermission: 'hr:read' },
      { name: 'Timesheets', to: '/staff/timesheets', icon: FileBadge, requiredPermission: 'timesheet:self' },
    ]
  }
];

function NavGroup({ 
  group, 
  isOpen, 
  showDivider, 
  onMobileClose 
}: { 
  group: NavGroupData; 
  isOpen: boolean; 
  showDivider: boolean; 
  onMobileClose?: () => void; 
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const location = useLocation();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const isOnline = useNetworkStatus();

  if (group.requireDesktop && isMobile) return null;
  if (group.requireOnline && !isOnline) return null;

  const filteredItems = group.items.filter(item => {
    if (!item.requiredPermission) return true;

    if (item.requiredPermission === 'vouchers:read') {
      return hasPermission('vouchers:read') || hasPermission('vouchers:scan') || hasPermission('vouchers:manage');
    }

    if (item.requiredPermission === 'transfers:read') {
      return hasPermission('transfers:read') || hasPermission('logistics:read');
    }

    if (item.requiredPermission === 'rota:view') {
      return hasPermission('rota:view') || hasPermission('hr:read');
    }

    return hasPermission(item.requiredPermission);
  });

  if (filteredItems.length === 0) return null;

  const isActive = filteredItems.some(item => location.pathname.startsWith(item.to));

  return (
    <div className="mb-2">
      {showDivider && <div className="h-px bg-slate-800/50 mx-4 my-4" />}
      
      <button 
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        title={!isOpen ? group.title : undefined}
        className={`w-full flex items-center ${isOpen ? 'justify-between px-3' : 'justify-center px-0'} py-2 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors group cursor-pointer`}
      >
        <div className="flex items-center gap-3">
          <group.icon size={16} className={`shrink-0 ${isActive ? 'text-emerald-500' : 'group-hover:text-slate-300'}`} />
          {isOpen && <span>{group.title}</span>}
        </div>
        {isOpen && (
          <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
        )}
      </button>

      {isExpanded && isOpen && (
        <div className="mt-1 space-y-1">
          {filteredItems.map(item => {
            const isItemActive = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.name}
                to={item.to}
                onClick={() => onMobileClose?.()}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all ml-7 ${
                  isItemActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <item.icon size={16} className={isItemActive ? 'text-emerald-400' : 'text-slate-500'} />
                {item.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ isOpen = true, onMobileClose }: SidebarProps) {
  const { session, logout, profile } = useAuth();
  const location = useLocation();
  const isOnline = useNetworkStatus();
  const isMobile = useIsMobile();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const docEl = document.documentElement as any;
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      } else {
        const doc = document as any;
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle unavailable:', err);
    }
  };

  return (
    <aside className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 font-sans select-none ${isOpen ? 'w-64' : 'w-20'}`}>
      
      {/* BRANDING HEADER */}
      <div className={`p-4 flex items-center justify-between h-20 shrink-0 border-b border-slate-800/80 ${isOpen ? 'px-5' : 'justify-center'}`}>
        <div className="flex items-center gap-3">
          <img 
            src={logoImg} 
            alt="StrixOS Logo" 
            className="w-11 h-11 object-contain shrink-0" 
          />
          {isOpen && (
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-black text-white tracking-tighter truncate">
                Strix<span className="text-emerald-500">OS</span>
              </h1>
              <p className="text-[9px] font-black text-emerald-500/80 uppercase tracking-widest truncate">Avian Management</p>
            </div>
          )}
        </div>

        {isMobile && onMobileClose && isOpen && (
          <button 
            type="button"
            onClick={onMobileClose} 
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Offline Alert Indicator */}
      {!isOnline && isOpen && (
        <div className="mx-4 mt-4 flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest animate-pulse">
          <ShieldAlert size={14} />
          Offline Mode
        </div>
      )}
      {!isOnline && !isOpen && (
        <div className="mx-auto mt-4 w-8 h-8 flex items-center justify-center bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl animate-pulse" title="Offline Mode Active">
          <ShieldAlert size={14} />
        </div>
      )}

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
        <Link
          to="/"
          onClick={() => onMobileClose?.()}
          title={!isOpen ? "Dashboard" : undefined}
          className={`flex items-center ${isOpen ? 'gap-3 px-3' : 'justify-center px-0'} py-2.5 mb-4 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors group [&.active]:bg-emerald-500/10 [&.active]:text-emerald-400`}
          activeOptions={{ exact: true }}
        >
          <LayoutDashboard size={18} className="shrink-0 transition-colors group-[&.active]:text-emerald-400" />
          {isOpen && <span>Dashboard</span>}
        </Link>
        
        {navGroups.map((group, index) => (
          <NavGroup 
            key={group.title} 
            group={group} 
            isOpen={isOpen} 
            showDivider={index !== 0} 
            onMobileClose={onMobileClose}
          />
        ))}

        <div className="h-px bg-slate-800/50 mx-4 my-4" />

        {/* Reports: Desktop Only */}
        {!isMobile && (
          <Link
            to="/reports"
            onClick={() => onMobileClose?.()}
            title={!isOpen ? "Reports" : undefined}
            className={`flex items-center ${isOpen ? 'gap-3 px-3' : 'justify-center px-0'} py-2.5 mb-2 rounded-xl text-sm font-bold transition-all ${
              location.pathname === '/reports'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <BarChart3 size={18} className="shrink-0" />
            {isOpen && <span>Reports</span>}
          </Link>
        )}

        {/* Settings: Desktop Only */}
        {!isMobile && (
          <Link
            to="/settings"
            onClick={() => onMobileClose?.()}
            title={!isOpen ? "Settings" : undefined}
            className={`flex items-center ${isOpen ? 'gap-3 px-3' : 'justify-center px-0'} py-2.5 mb-2 rounded-xl text-sm font-bold transition-all ${
              location.pathname.startsWith('/settings')
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Settings size={18} className="shrink-0" />
            {isOpen && <span>Settings</span>}
          </Link>
        )}
      </nav>

      {/* FOOTER & SYSTEM CONTROLS */}
      <div className="p-4 border-t border-slate-800/80 shrink-0 space-y-1">
        
        <button 
          type="button"
          onClick={toggleFullscreen}
          className={`w-full flex items-center ${isOpen ? 'gap-3 px-3' : 'justify-center px-0'} py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors group cursor-pointer`}
          title={!isOpen ? (isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen") : undefined}
        >
          {isFullscreen ? (
            <Minimize size={18} className="shrink-0 text-emerald-400" />
          ) : (
            <Maximize size={18} className="shrink-0 group-hover:text-slate-300" />
          )}
          {isOpen && <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>}
        </button>

        {/* RESET & REINSTALL BUTTON */}
        <button 
          type="button"
          onClick={hardResetApp}
          className={`w-full flex items-center ${isOpen ? 'gap-3 px-3' : 'justify-center px-0'} py-2.5 mb-2 rounded-xl text-sm font-bold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/20 transition-colors cursor-pointer group`}
          title={!isOpen ? "Reset & Reinstall" : undefined}
        >
          <RotateCcw size={18} className="shrink-0 group-hover:-rotate-45 transition-transform" />
          {isOpen && <span>Reset &amp; Reinstall</span>}
        </button>

        {session && (
          <>
            <div className={`flex items-center gap-3 pt-2 mb-3 border-t border-slate-800/60 ${isOpen ? 'px-2' : 'justify-center'}`}>
              <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white font-black text-lg shadow-inner shrink-0">
                {profile?.name?.charAt(0) || 'U'}
              </div>
              {isOpen && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{profile?.name || 'Loading...'}</p>
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest truncate">{profile?.role?.replace('_', ' ') || 'USER'}</p>
                </div>
              )}
            </div>

            <button 
              type="button"
              onClick={() => logout(false)}
              title={!isOpen ? "Sign Out" : undefined}
              className={`w-full flex items-center ${isOpen ? 'gap-3 px-3' : 'justify-center px-0'} py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors group cursor-pointer`}
            >
              <LogOut size={16} className="shrink-0 group-hover:-translate-x-1 transition-transform" />
              {isOpen && <span>Secure Logout</span>}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
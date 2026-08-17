import React, { useState, useEffect } from 'react';
import { createRootRouteWithContext, Outlet, useLocation, Navigate } from '@tanstack/react-router';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../lib/auth';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { LoginScreen } from '../components/auth/LoginScreen';
import { supabase } from '../lib/supabase';
import { toast, Toaster } from 'sonner';

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => (
    <AuthProvider>
      <AuthGuard />
      <Toaster position="top-center" richColors theme="light" />
    </AuthProvider>
  ),
});

// ------------------------------------------------------------------
// GLOBAL REALTIME MULTIPLEXER (NETWORKED PC STANDARD)
// ------------------------------------------------------------------
function GlobalSyncEngine() {
  const queryClient = useQueryClient();
  const { session } = useAuth();

  useEffect(() => {
    if (!session) return; 

    console.log('[Sync Engine] Initializing Global Realtime Multiplexer...');

    const channel = supabase.channel('strix-global-multiplexer')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        const table = payload.table;
        
        const tableToKeyMap: Record<string, string[]> = {
          'daily_logs': ['daily_logs'],
          'animals': ['animals'],
          'users': ['internal_users', 'userProfile'],
          'rbac_matrix': ['rbac_matrix', 'rbac_permissions'],
          'role_permissions': ['role_permissions'],
          'external_directory': ['external_directory'],
          'safety_drills': ['safety_drills'],
          'shifts': ['shifts_data'],
          'timesheets': ['timesheets', 'my_active_shift', 'active_timesheets_rollcall'],
          'isolation_logs': ['isolation_logs_complete']
        };

        const keysToInvalidate = tableToKeyMap[table];
        if (keysToInvalidate) {
          keysToInvalidate.forEach(key => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }
      })
      .subscribe();

    return () => {
      console.log('[Sync Engine] Terminating Global Multiplexer...');
      supabase.removeChannel(channel);
    };
  }, [queryClient, session]);

  return null;
}

// ------------------------------------------------------------------
// ROUTE GATEKEEPER & ACCESS DEFLECTOR (GRANULAR V2)
// ------------------------------------------------------------------
function RouteGatekeeper({ children }: { children: React.ReactNode }) {
  const { hasPermission, profile, isLocked, isLoading } = useAuth();
  const location = useLocation();

  const path = location.pathname;
  
  // Exact mapping of physical routes to V2 granular permissions
  const routePermissions: Record<string, string> = {
    '/clinical': 'clinical:read',
    '/logistics/vouchers': 'vouchers:scan',
    '/logistics/internal-movements': 'transfers:read',
    '/logistics/external-transfers': 'transfers:read',
    '/safety': 'safety:read', 
    '/staff/rota': 'rota:view',
    '/staff/shifts': 'shifts:manage',
    '/staff/leave': 'timesheet:self',
    '/staff/timesheets': 'timesheet:self',
    '/staff/missing-records': 'timesheet:self',
    '/settings/rbac': 'admin:settings',
    '/settings/directory': 'admin:users',
  };

  // Sort by length descending ensures specific sub-paths match before broad parent paths
  const requiredPerm = Object.entries(routePermissions)
    .sort(([a], [b]) => b.length - a.length)
    .find(([routePrefix]) => path.startsWith(routePrefix))?.[1];

  const isDenied = !isLoading && profile && !isLocked && requiredPerm && !hasPermission(requiredPerm);

  useEffect(() => {
    if (isDenied) {
      console.warn(`[Route Gatekeeper] Access denied for path: ${path}. Missing perm: ${requiredPerm}`);
      toast.error('Unauthorized Access: You do not have permission to view this module.');
    }
  }, [isDenied, path, requiredPerm]);

  if (isDenied) {
    return <Navigate to="/" replace={true} />;
  }

  return <>{children}</>;
}

// ------------------------------------------------------------------
// LAYOUT GATEKEEPER (NATIVE APP DRAWER ARCHITECTURE)
// ------------------------------------------------------------------
function AuthGuard() {
  const { session, isLoading } = useAuth();
  // Changed default to true so desktop starts expanded
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); 
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0B0E] flex items-center justify-center">
        <div className="animate-pulse text-emerald-500 font-black tracking-widest uppercase">
          Initializing Engine...
        </div>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  // Toggle handler for the Header hamburger menu
  const toggleSidebar = () => {
    setIsSidebarOpen(prev => !prev);
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden">
      <GlobalSyncEngine />
      
      {/* DESKTOP UI: Permanent Sidebar (Accepts the state boolean) */}
      <div className="hidden md:flex h-full z-20">
        <Sidebar isOpen={isSidebarOpen} /> 
      </div>
      
      {/* MOBILE UI: Slide-Out Drawer Overlay */}
      <div className={`md:hidden fixed inset-0 z-50 transition-all duration-300 ${isSidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
         <div 
           className={`absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0'}`}
           onClick={() => setIsSidebarOpen(false)} // Close on tap outside
         />
         <div className={`absolute top-0 left-0 h-full w-[280px] bg-slate-900 shadow-2xl transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <Sidebar isOpen={true} onMobileClose={() => setIsSidebarOpen(false)} />
         </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex flex-col flex-1 overflow-hidden transition-all duration-300">
        {/* Pass the toggle function to the Header */}
        <Header onMenuClick={toggleSidebar} />
        
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 custom-scrollbar">
          <RouteGatekeeper>
            <Outlet />
          </RouteGatekeeper>
        </main>
      </div>
    </div>
  );
}
import React, { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { 
  ShieldCheck, CheckSquare, Square, Loader2, 
  Info, Sparkles, ShieldAlert 
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const rbacMatrixOptions = queryOptions({
  queryKey: ['rbac_matrix'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('rbac_matrix')
      .select('*');
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 15,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/rbac')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(rbacMatrixOptions);
    }
  },
  component: RBACMatrixPage,
});

const PERMISSION_REGISTRY = [
  {
    module: 'Husbandry & Animal Care',
    actions: [
      { key: 'husbandry:read', label: 'View Daily Logs, Rounds & Feeding Charts' },
      { key: 'husbandry:write', label: 'Submit Daily Logs, Weights & Food Intakes' },
      { key: 'animal:manage', label: 'Create & Edit Animal Profiles, Mobs & Census' },
    ]
  },
  {
    module: 'Clinical & Veterinary',
    actions: [
      { key: 'clinical:read', label: 'View Medical History, Quarantine & MAR Charts' },
      { key: 'clinical:write', label: 'Administer Daily Medications & Log Health Checks' },
      { key: 'clinical:vet', label: 'Issue Prescriptions & Official Vet Sign-Offs' },
    ]
  },
  {
    module: 'Logistics & Movements',
    actions: [
      { key: 'transfers:read', label: 'View Internal Movements & Transfer Records' },
      { key: 'transfers:write', label: 'Request Enclosure Changes & Relocations' },
      { key: 'transfers:approve', label: 'Authorize External Transfers & Dispositions' },
      { key: 'transfers:delete', label: 'Archive / Soft-Delete Movement & Transfer Logs' },
    ]
  },
  {
    module: 'Ticketing & Gate (Vouchers)',
    actions: [
      { key: 'vouchers:scan', label: 'Scan & Validate Digital QR Tickets via Scanner' },
      { key: 'vouchers:manage', label: 'Issue Vouchers, View Purchaser PII & Overrides' },
    ]
  },
  {
    module: 'Safety, Drills & Compliance',
    actions: [
      { key: 'safety:read', label: 'View Incident Reports, Drills & Maintenance' },
      { key: 'safety:write', label: 'Submit Incidents, Log First Aid & Record Drills' },
      { key: 'maintenance:manage', label: 'Assign, Update & Resolve Maintenance Tickets' },
    ]
  },
  {
    module: 'Staffing, Rota & Absences',
    actions: [
      { key: 'rota:view', label: 'View Public Staff Schedule & Calendar' },
      { key: 'rota:manage', label: 'Assign Daily Shift Areas & Roster Overrides' },
      { key: 'shifts:manage', label: 'Access 90-Day Shift Pattern Generator & Deletion' },
      { key: 'leave:manage', label: 'Review, Formally Approve or Reject Leave Requests' },
      { key: 'timesheet:self', label: 'Clock In / Clock Out (Self Timesheet Only)' },
      { key: 'timesheet:manage', label: 'Review & Formally Approve Staff Timesheets' },
      { key: 'hr:sensitive', label: 'View Private HR Medical Disclosures & Contacts' },
    ]
  },
  {
    module: 'Reports & Audits',
    actions: [
      { key: 'reports:view', label: 'View Live Operational Data Previews' },
      { key: 'reports:export', label: 'Compile & Export ZLA Inspection Packs & .DOCX' },
    ]
  },
  {
    module: 'System Administration',
    actions: [
      { key: 'admin:users', label: 'Provision, Suspend & Modify Staff User Accounts' },
      { key: 'admin:system', label: 'Edit ZLA Profile, Taxonomies & System Settings' },
      { key: 'telemetry:manage', label: 'View Engine Health & Purge Central Error Telemetry' },
    ]
  }
];

const ROLE_DISPLAY_ORDER = ['ADMIN', 'DIRECTOR', 'SENIOR_KEEPER', 'KEEPER', 'VOLUNTEER'];

export function RBACMatrixPage() {
  const queryClient = useQueryClient();
  const { profile, hasPermission } = useAuth();

  const isDirectorOrAdmin = ['DIRECTOR', 'ADMIN'].includes(profile?.role || '') || hasPermission('admin:system');

  const { data: matrix = [], isLoading } = useQuery(rbacMatrixOptions);

  const updateMutation = useMutation({
    mutationFn: async ({ role, permissions }: { role: string, permissions: string[] }) => {
      const { error } = await supabase
        .from('rbac_matrix')
        .update({ permissions })
        .eq('role', role);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rbac_matrix'] });
      queryClient.invalidateQueries({ queryKey: ['rbac_permissions'] });
      toast.success(`Updated permissions for ${variables.role.replace(/_/g, ' ')}.`);
    },
    onError: (err: any) => {
      toast.error(`Failed to update permissions: ${err.message}`);
    }
  });

  const togglePermission = (role: string, currentPerms: string[], permKey: string) => {
    const updated = currentPerms.includes(permKey)
      ? currentPerms.filter(p => p !== permKey)
      : [...currentPerms, permKey];
      
    updateMutation.mutate({ role, permissions: updated });
  };

  const displayRoles = useMemo(() => {
    return [...matrix].sort((a, b) => {
      const idxA = ROLE_DISPLAY_ORDER.indexOf(a.role);
      const idxB = ROLE_DISPLAY_ORDER.indexOf(b.role);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });
  }, [matrix]);

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'DIRECTOR': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'SENIOR_KEEPER': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'KEEPER': return 'bg-blue-50 text-blue-700 border-blue-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  if (!isDirectorOrAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <ShieldAlert size={48} className="mb-4 opacity-20 text-slate-500" />
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Restricted Access</h2>
        <p className="text-xs font-medium text-slate-500 mt-1 max-w-sm text-center">
          Only System Administrators and Directors can modify the global Role-Based Access Control matrix.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-300 relative">
      
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 pb-1">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
            <ShieldCheck size={16} className="text-slate-700" /> Role-Based Access Control (RBAC)
          </h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
            Configure live granular capabilities across all 5 operational system tiers
          </p>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 shrink-0">
          <Sparkles size={12} className="text-emerald-600" />
          <span>Hot-Swaps Active Sessions</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative">
        {isLoading ? (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-slate-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Loading Permission Matrix...</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50/30">
            <table className="w-full text-left whitespace-nowrap border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-900 sticky top-0 z-20 backdrop-blur-md">
                <tr>
                  <th className="px-5 py-3.5 w-[380px] min-w-[280px] text-[10px] font-black uppercase tracking-widest text-slate-500 border-r border-slate-200 bg-slate-50">
                    Module Capability / Permission Key
                  </th>
                  {displayRoles.map(r => (
                    <th key={r.role} className="px-4 py-3.5 text-center min-w-[130px] bg-slate-50">
                      <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border shadow-sm inline-block ${getRoleBadgeClass(r.role)}`}>
                        {r.role.replace(/_/g, ' ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {PERMISSION_REGISTRY.map((moduleGroup, gIdx) => (
                  <React.Fragment key={gIdx}>
                    <tr className="bg-slate-50/80 sticky z-10">
                      <td 
                        colSpan={displayRoles.length + 1} 
                        className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-slate-100/70 border-y border-slate-200"
                      >
                        {moduleGroup.module}
                      </td>
                    </tr>

                    {moduleGroup.actions.map((action, aIdx) => (
                      <tr key={aIdx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3 border-r border-slate-200">
                          <p className="font-bold text-slate-900 text-xs leading-snug">{action.label}</p>
                          <p className="text-[9px] font-mono font-bold text-slate-400 tracking-wide mt-0.5">{action.key}</p>
                        </td>

                        {displayRoles.map(r => {
                          const hasPerm = (r.permissions || []).includes(action.key);
                          const isRoot = r.role === 'ADMIN' || r.role === 'DIRECTOR';
                          const isProcessing = updateMutation.isPending && updateMutation.variables?.role === r.role;

                          return (
                            <td key={r.role} className="px-4 py-3 text-center border-l border-slate-100">
                              <button 
                                onClick={() => togglePermission(r.role, r.permissions || [], action.key)}
                                disabled={isRoot || isProcessing}
                                className={`inline-flex items-center justify-center p-1.5 rounded-xl transition-all ${
                                  isRoot 
                                    ? 'opacity-40 cursor-not-allowed bg-slate-50' 
                                    : 'hover:bg-slate-100 active:scale-95 cursor-pointer'
                                }`}
                                title={isRoot ? `${r.role} possesses permanent root bypass` : `Toggle ${action.key}`}
                              >
                                {isProcessing ? (
                                  <Loader2 size={18} className="animate-spin text-slate-400" />
                                ) : hasPerm || isRoot ? (
                                  <CheckSquare size={18} className="text-emerald-600" />
                                ) : (
                                  <Square size={18} className="text-slate-300 hover:text-slate-400" />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-start gap-3 shadow-inner shrink-0">
        <div className="p-2 bg-white rounded-xl border border-slate-200 text-slate-600 shrink-0 shadow-sm">
          <Info size={16} />
        </div>
        <div>
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">
            Root Level Security Protocol
          </h4>
          <p className="text-[11px] font-medium text-slate-600 mt-0.5 leading-relaxed">
            Mutations to this matrix immediately invalidate client query caches across active staff sessions. <strong>ADMIN</strong> and <strong>DIRECTOR</strong> roles maintain root access and cannot have core privileges revoked.
          </p>
        </div>
      </div>

    </div>
  );
}

export default RBACMatrixPage;
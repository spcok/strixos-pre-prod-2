import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { format, parseISO, formatISO } from 'date-fns';
import { toast } from 'sonner';
import { 
  ShieldAlert, Plus, Loader2, Clock, AlertTriangle, 
  CheckCircle2, X, Search, AlertOctagon, Flame, CheckCircle, XCircle
} from 'lucide-react';
import { SafetyDrill } from '../types';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const safetyDrillsOptions = queryOptions({
  queryKey: ['safety_drills'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('safety_drills')
      .select('*')
      .eq('is_deleted', false)
      .order('drill_date', { ascending: false });
    if (error) throw error;
    return (data || []) as SafetyDrill[];
  },
  staleTime: 1000 * 60 * 15,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/safety/drills')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await queryClient.ensureQueryData(safetyDrillsOptions);
    }
  },
  component: SafetyDrillsPage,
});

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

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
export function SafetyDrillsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'SIMULATION' | 'LIVE'>('ALL');

  useEffect(() => {
    const channel = supabase.channel('safety-drills-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_drills' }, () => {
        queryClient.invalidateQueries({ queryKey: ['safety_drills'] });
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: drills = [], isLoading } = useQuery(safetyDrillsOptions);

  const filteredDrills = useMemo(() => {
    let result = drills;

    if (activeTab === 'SIMULATION') {
      result = result.filter(d => d.is_simulation);
    } else if (activeTab === 'LIVE') {
      result = result.filter(d => !d.is_simulation);
    }

    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      result = result.filter(d => 
        (d.drill_type || '').toLowerCase().includes(lower) ||
        (d.scenario_description || '').toLowerCase().includes(lower) ||
        (d.areas_involved || '').toLowerCase().includes(lower) ||
        (d.issues_observed || '').toLowerCase().includes(lower) ||
        (d.corrective_actions || '').toLowerCase().includes(lower)
      );
    }

    return result;
  }, [drills, searchQuery, activeTab]);

  const rowVirtualizer = useVirtualizer({
    count: filteredDrills.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 220 : 90,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(280px, 2fr) minmax(180px, 1.2fr) minmax(200px, 1.3fr) minmax(260px, 1.8fr) minmax(110px, 0.7fr)";

  const tabs = [
    { id: 'ALL', label: 'All Audits' },
    { id: 'SIMULATION', label: 'Simulations' },
    { id: 'LIVE', label: 'Live Incidents' }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Safety Drills
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Emergency Simulation & Response Audits
           </p>
        </div>
        
        {hasPermission('safety:write') && (
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-amber-400" />
            <span>Log Simulation</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search drill types, scenarios, areas..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS (Pill Design) --- */}
      <div className="grid grid-cols-3 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
              activeTab === tab.id 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* --- BLOCK D: CHAMELEON DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-amber-500" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Drill Records...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Drill Type & Scenario</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date & Duration</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Areas & Roll Call</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Observed Issues & Actions</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Status</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredDrills.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <ShieldAlert size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No safety drills found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search terms or filter tabs.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const drill = filteredDrills[virtualRow.index];
                  const isDangerous = (drill.drill_type || '').toLowerCase().includes('dangerous') || (drill.drill_type || '').toLowerCase().includes('red');
                  const isFire = (drill.drill_type || '').toLowerCase().includes('fire');

                  return (
                    <div 
                      key={drill.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Drill Type & Scenario */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1.5 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Scenario</div>}
                        <div className="space-y-1.5 w-full">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border ${
                              isDangerous ? 'bg-rose-50 text-rose-700 border-rose-200' :
                              isFire ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              'bg-indigo-50 text-indigo-700 border-indigo-200'
                            }`}>
                              {isDangerous ? <AlertOctagon size={10} /> : isFire ? <Flame size={10} /> : <AlertTriangle size={10} />}
                              {drill.drill_type}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border ${
                              drill.is_simulation ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-rose-100 text-rose-800 border-rose-300 font-black animate-pulse'
                            }`}>
                              {drill.is_simulation ? 'Simulation' : 'Live Incident'}
                            </span>
                          </div>
                          <p className="text-xs lg:text-sm font-bold text-slate-900 line-clamp-2 leading-snug" title={drill.scenario_description}>
                            {drill.scenario_description}
                          </p>
                        </div>
                      </div>

                      {/* 2. Date & Duration */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Timing</div>}
                        <div className="flex flex-col gap-1 w-full">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <Clock size={12} className="text-slate-400 shrink-0" />
                            {drill.drill_date ? format(new Date(drill.drill_date), 'dd MMM yyyy HH:mm') : '--'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500">
                            Duration: <span className="text-slate-900 font-black">{drill.duration_seconds}s</span> ({Math.round(drill.duration_seconds / 60)} min)
                          </span>
                        </div>
                      </div>

                      {/* 3. Areas & Roll Call */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Location & Roll Call</div>}
                        <div className="space-y-1.5 w-full">
                          <p className="text-xs font-bold text-slate-800 line-clamp-1" title={drill.areas_involved}>
                            {drill.areas_involved || 'All site areas'}
                          </p>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border w-fit ${
                            drill.roll_call_completed 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {drill.roll_call_completed ? <CheckCircle size={10} /> : <XCircle size={10} />}
                            Roll Call: {drill.roll_call_completed ? 'Cleared' : 'Incomplete'}
                          </span>
                        </div>
                      </div>

                      {/* 4. Observed Issues & Corrective Actions */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Audit Notes</div>}
                        <div className="space-y-1 w-full pr-2">
                          {drill.issues_observed && (
                            <p className="text-[11px] font-medium text-slate-600 line-clamp-1" title={drill.issues_observed}>
                              <span className="font-bold text-slate-900">Issue:</span> {drill.issues_observed}
                            </p>
                          )}
                          {drill.corrective_actions && (
                            <p className="text-[11px] font-medium text-amber-800 line-clamp-1" title={drill.corrective_actions}>
                              <span className="font-bold text-amber-900">Action:</span> {drill.corrective_actions}
                            </p>
                          )}
                          {!drill.issues_observed && !drill.corrective_actions && (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No issues logged</span>
                          )}
                        </div>
                      </div>

                      {/* 5. Status */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100' : 'items-center justify-end'}`}>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200">
                          <CheckCircle2 size={10} className="text-emerald-600" />
                          {drill.status || 'COMPLETED'}
                        </span>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && <DrillModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------
// 4. TANSTACK FORM MODAL
// ------------------------------------------------------------------
function DrillModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const payloadToSubmit = {
        ...payload,
        drill_date: formatISO(parseISO(payload.drill_date)),
      };
      
      const { error } = await supabase.from('safety_drills').insert([payloadToSubmit]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safety_drills'] });
      toast.success('Safety drill logged successfully.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save drill.')
  });

  const form = useForm({
    defaultValues: { 
      drill_date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      drill_type: 'Code Red - Dangerous Animal Escape', 
      scenario_description: '', 
      areas_involved: '',
      duration_seconds: 0,
      roll_call_completed: true,
      issues_observed: '',
      corrective_actions: '',
      status: 'COMPLETED',
      is_simulation: true
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync(value);
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl relative my-auto animate-in zoom-in-95 duration-200">
        
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0 rounded-t-2xl">
          <div>
            <h3 className="font-black text-slate-900 uppercase tracking-tight text-base lg:text-lg">
              Log Safety Simulation
            </h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Emergency response & audit entry</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="safety-drill-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-5">
            {errorMsg && <div className="p-4 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="drill_type" children={(field) => (
                <div>
                  <label className={labelClass}>Drill Type *</label>
                  <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                    <option value="Code Red - Dangerous Animal Escape">Code Red - Dangerous Animal Escape</option>
                    <option value="Code Green - Non-Dangerous Animal Escape">Code Green - Non-Dangerous Animal Escape</option>
                    <option value="Fire Evacuation">Fire Evacuation</option>
                    <option value="First Aid / Medical Emergency">First Aid / Medical Emergency</option>
                    <option value="Intruder / Lockdown">Intruder / Lockdown</option>
                  </select>
                </div>
              )} />
              <form.Field name="drill_date" children={(field) => (
                <div>
                  <label className={labelClass}>Date & Time *</label>
                  <input type="datetime-local" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )} />
            </div>

            <form.Field name="scenario_description" children={(field) => (
              <div>
                <label className={labelClass}>Scenario Description *</label>
                <input required placeholder="Briefly describe the simulated event..." value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <form.Field name="areas_involved" children={(field) => (
                <div className="md:col-span-2">
                  <label className={labelClass}>Areas Involved *</label>
                  <input required placeholder="e.g. Aviary A, Main Walkway" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )} />
              <form.Field name="duration_seconds" children={(field) => (
                <div>
                  <label className={labelClass}>Duration (Seconds) *</label>
                  <input type="number" required min="0" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(Number(e.target.value))} className={inputClass} />
                </div>
              )} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <form.Field name="roll_call_completed" children={(field) => (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={field.state.value} onChange={e => field.handleChange(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                  <div>
                    <span className="block text-xs font-bold text-slate-900">Roll Call Cleared</span>
                    <span className="block text-[10px] font-medium text-slate-500">All staff & visitors accounted for</span>
                  </div>
                </label>
              )} />
              <form.Field name="is_simulation" children={(field) => (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={field.state.value} onChange={e => field.handleChange(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                  <div>
                    <span className="block text-xs font-bold text-slate-900">Simulation Exercise</span>
                    <span className="block text-[10px] font-medium text-slate-500">Uncheck if live emergency incident</span>
                  </div>
                </label>
              )} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="issues_observed" children={(field) => (
                <div>
                  <label className={labelClass}>Issues Observed</label>
                  <textarea placeholder="Any bottlenecks or equipment failures observed?" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} h-20 resize-none`} />
                </div>
              )} />
              <form.Field name="corrective_actions" children={(field) => (
                <div>
                  <label className={labelClass}>Corrective Actions</label>
                  <textarea placeholder="Recommended procedural adjustments..." value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} h-20 resize-none`} />
                </div>
              )} />
            </div>
          </form>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button 
                type="submit" 
                form="safety-drill-form"
                disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {(isSubmitting || saveMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>Save Report</span>
              </button>
            )}
          </form.Subscribe>
        </div>

      </div>
    </div>
  );
}

export default SafetyDrillsPage;
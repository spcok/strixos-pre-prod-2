import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRight, Search, MapPin, Loader2, Trash2, Calendar, Users, User, ArrowLeftRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

// Helper to get formatted dates
const getLocalDateString = (dateObj = new Date()) => {
  return dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
};

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS (14-Day Failover)
// ------------------------------------------------------------------
const getMovementsOptions = (startDate: string, endDate: string) => queryOptions({
  queryKey: ['internal_movements', startDate, endDate],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('internal_movements')
      .select('id, movement_date, from_location, to_location, reason, notes, animals(id, name, species, ring_number, profile_image_url, record_type)')
      .eq('is_deleted', false)
      .gte('movement_date', `${startDate}T00:00:00Z`)
      .lte('movement_date', `${endDate}T23:59:59.999Z`)
      .order('movement_date', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 14,
  networkMode: 'offlineFirst',
  meta: { persist: true },
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/logistics/internal-movements')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      const today = getLocalDateString(new Date());
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const thirtyDaysAgo = getLocalDateString(d);
      // @ts-ignore
      await queryClient.ensureQueryData(getMovementsOptions(thirtyDaysAgo, today));
    }
  },
  component: InternalMovementsPage,
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
export function InternalMovementsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const [globalFilter, setGlobalFilter] = useState('');
  
  // Date Filtering State (Default: Last 30 Days)
  const [endDate, setEndDate] = useState<string>(getLocalDateString(new Date()));
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return getLocalDateString(d);
  });

  // 1. Data Fetching via Strict Options
  const { data: movements = [], isLoading } = useQuery(getMovementsOptions(startDate, endDate));

  // 2. Realtime Cache Sync
  useEffect(() => {
    const channel = supabase
      .channel('internal-movements-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_movements' }, () => {
        queryClient.invalidateQueries({ queryKey: ['internal_movements'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // 3. Soft Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('internal_movements')
        .update({ is_deleted: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal_movements'] });
      toast.success('Movement record deleted successfully.');
    },
    onError: (err: any) => {
      toast.error(`Deletion failed: ${err.message}`);
    }
  });

  // 4. Filtering Engine
  const filteredMovements = useMemo(() => {
    if (!globalFilter) return movements;
    const q = globalFilter.toLowerCase();
    return movements.filter((m: any) => 
      (m.animals?.name || '').toLowerCase().includes(q) ||
      (m.animals?.species || '').toLowerCase().includes(q) ||
      (m.animals?.ring_number || '').toLowerCase().includes(q) ||
      (m.from_location || '').toLowerCase().includes(q) ||
      (m.to_location || '').toLowerCase().includes(q) ||
      (m.reason || '').toLowerCase().includes(q)
    );
  }, [movements, globalFilter]);

  // 5. Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredMovements.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 180 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(240px, 1.8fr) minmax(280px, 2.2fr) minmax(200px, 1.5fr) minmax(90px, 0.6fr)";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Internal Movements
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Logistical tracking of on-site entity relocations
           </p>
        </div>
      </div>

      {/* --- BLOCK B: CONTROL DECK (Search + Date Range) --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search by animal, location, reason..." 
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>

        {/* Date Range Selectors */}
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
          <div className="flex items-center bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full sm:w-auto">
            <div className="flex items-center gap-1.5 px-2 py-0.5 border-r border-slate-100">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">From</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
                className="bg-transparent border-none text-[10px] lg:text-xs font-bold text-slate-700 focus:outline-none focus:ring-0 py-1 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">To</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
                className="bg-transparent border-none text-[10px] lg:text-xs font-bold text-slate-700 focus:outline-none focus:ring-0 py-1 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* --- BLOCK D: CHAMELEON DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-slate-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Querying Matrix...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Animal & ID</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Relocation Path</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date & Reason</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Actions</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredMovements.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <ArrowLeftRight size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No movements found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your date range or search terms.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const m = filteredMovements[virtualRow.index];
                  const animal = m.animals || {};
                  const isGroup = animal.record_type === 'GROUP';

                  return (
                    <div 
                      key={m.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Identity Block */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Animal</div>}
                        <div className="flex items-center gap-3 min-w-0 py-1">
                          <div className={`w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm overflow-hidden ${!animal.profile_image_url ? (isGroup ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-200') : 'border-slate-200'}`}>
                            {animal.profile_image_url ? (
                              <img src={animal.profile_image_url} alt={animal.name} className="w-full h-full object-cover" />
                            ) : (
                              isGroup ? <Users size={16} /> : <User size={16} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={animal.name || 'Unknown'}>{animal.name || 'Unknown Animal'}</h3>
                            <div className="flex items-center gap-1.5 text-[9px] lg:text-[10px] text-slate-500 truncate mt-0.5">
                              {animal.ring_number && <span className="font-bold text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
                              {animal.ring_number && animal.species && <span>•</span>}
                              {animal.species && <span className="italic truncate">{animal.species}</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 2. Relocation Path (From -> To) */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1.5 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Relocation Path</div>}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-700">
                          <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                            <MapPin size={12} className="text-slate-400 shrink-0"/>
                            <span className="text-slate-600 truncate max-w-[140px]" title={m.from_location || 'Unassigned'}>{m.from_location || 'Unassigned'}</span>
                          </div>
                          
                          <ArrowRight size={14} className="text-slate-400 shrink-0" />
                          
                          <div className="flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                            <MapPin size={12} className="text-emerald-600 shrink-0"/>
                            <span className="text-emerald-800 font-bold truncate max-w-[140px]" title={m.to_location || 'Unassigned'}>{m.to_location || 'Unassigned'}</span>
                          </div>
                        </div>
                      </div>

                      {/* 3. Date & Reason */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Date & Reason</div>}
                        <div className="space-y-1 w-full">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[9px] lg:text-[10px] font-black text-slate-600 uppercase tracking-widest w-fit">
                            <Calendar size={12} /> {m.movement_date ? format(parseISO(m.movement_date), 'dd MMM yyyy') : '--'}
                          </span>
                          {m.reason && (
                            <p className="text-xs font-semibold text-slate-800 line-clamp-1" title={m.reason}>
                              {m.reason}
                            </p>
                          )}
                          {m.notes && (
                            <p className="text-[10px] font-medium text-slate-500 line-clamp-1" title={m.notes}>
                              {m.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 4. Action */}
                      <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100' : 'items-center justify-end'}`}>
                        {hasPermission('logistics:delete') && (
                          <button 
                            onClick={() => {
                              if (window.confirm("Are you sure you want to delete this movement record?")) {
                                deleteMutation.mutate(m.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                            title="Delete Record"
                          >
                            {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

export default InternalMovementsPage;
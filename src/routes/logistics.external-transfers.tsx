import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRightLeft, Search, Loader2, MapPin, Trash2, Calendar, Users, User, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';

// Helper to get formatted dates
const getLocalDateString = (dateObj = new Date()) => {
  return dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
};

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS (14-Day Failover)
// ------------------------------------------------------------------
const getExternalTransfersOptions = (startDate: string, endDate: string) => queryOptions({
  queryKey: ['external_transfers', startDate, endDate],
  queryFn: async () => {
    const startISO = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    const endISO = new Date(`${endDate}T23:59:59.999Z`).toISOString();

    const { data, error } = await supabase
      .from('external_transfers')
      .select(`
        *,
        animals (
          id,
          name,
          species,
          ring_number,
          microchip_id,
          profile_image_url,
          record_type
        )
      `)
      .eq('is_deleted', false)
      .gte('transfer_date', startISO)
      .lte('transfer_date', endISO)
      .order('transfer_date', { ascending: false });

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
export const Route = createFileRoute('/logistics/external-transfers')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      const today = getLocalDateString(new Date());
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const thirtyDaysAgo = getLocalDateString(d);
      // @ts-ignore
      await queryClient.ensureQueryData(getExternalTransfersOptions(thirtyDaysAgo, today));
    }
  },
  component: ExternalTransfersPage,
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
export function ExternalTransfersPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  
  // Custom Date Filters (Default to last 30 days)
  const [endDate, setEndDate] = useState<string>(getLocalDateString(new Date()));
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return getLocalDateString(d);
  });

  // Real-time synchronization
  useEffect(() => {
    const channel = supabase.channel('external-transfers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_transfers' }, () => {
        queryClient.invalidateQueries({ queryKey: ['external_transfers'] });
      }).subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Fetch Data
  const { data: transfers = [], isLoading } = useQuery(getExternalTransfersOptions(startDate, endDate));

  // Soft Delete Action
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('external_transfers')
        .update({ is_deleted: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Transfer record securely deleted.');
      queryClient.invalidateQueries({ queryKey: ['external_transfers'] });
    },
    onError: (err: any) => {
      toast.error(`Failed to delete record: ${err.message}`);
    }
  });

  // Client-Side Search and Tab Filters
  const filteredTransfers = useMemo(() => {
    let result = transfers;

    if (activeTab !== 'ALL') {
      result = result.filter((t: any) => t.transfer_type === activeTab);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((t: any) => {
        const animalName = (t.animals?.name || '').toLowerCase();
        const speciesName = (t.animals?.species || '').toLowerCase();
        const ringNumber = (t.animals?.ring_number || '').toLowerCase();
        const entityName = (t.entity_name || '').toLowerCase();
        const type = (t.transfer_type || '').toLowerCase();
        const reason = (t.reason || '').toLowerCase();
        
        return animalName.includes(query) || 
               speciesName.includes(query) || 
               ringNumber.includes(query) ||
               entityName.includes(query) ||
               reason.includes(query) ||
               type.includes(query);
      });
    }

    return result;
  }, [transfers, searchQuery, activeTab]);

  // Virtualizer Setup
  const rowVirtualizer = useVirtualizer({
    count: filteredTransfers.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 180 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(240px, 1.8fr) minmax(130px, 1fr) minmax(240px, 1.8fr) minmax(200px, 1.5fr) minmax(70px, 0.5fr)";

  const tabs = [
    { id: 'ALL', label: 'All Transfers' },
    { id: 'IN', label: 'Acquisitions (IN)' },
    { id: 'OUT', label: 'Dispositions (OUT)' }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             External Transfers
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Logistics, Acquisitions & Dispositions
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
            placeholder="Search animals, entities, reasons..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
              <Loader2 className="animate-spin text-slate-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Transfers...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Animal & Identification</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Type</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Entity / Destination</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date & Reason</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Actions</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredTransfers.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <ArrowRightLeft size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No transfers found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your date range, search terms, or type filter.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const t = filteredTransfers[virtualRow.index];
                  const animal = t.animals || {};
                  const isGroup = animal.record_type === 'GROUP';
                  const isOut = t.transfer_type === 'OUT';

                  return (
                    <div 
                      key={t.id} 
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
                            <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={animal.name || 'Unknown Animal'}>{animal.name || 'Unknown Animal'}</h3>
                            <div className="flex items-center gap-1.5 text-[9px] lg:text-[10px] text-slate-500 truncate mt-0.5">
                              {animal.ring_number && <span className="font-bold text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
                              {animal.ring_number && animal.species && <span>•</span>}
                              {animal.species && <span className="italic truncate">{animal.species}</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 2. Transfer Type Badge */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Type</div>}
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] lg:text-[10px] font-black uppercase tracking-widest border w-fit ${
                          isOut ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        }`}>
                          {isOut ? <ArrowUpRight size={12} className="text-amber-600 shrink-0" /> : <ArrowDownLeft size={12} className="text-emerald-600 shrink-0" />}
                          TRANSFER {t.transfer_type}
                        </span>
                      </div>

                      {/* 3. Entity / Destination (Text Wrapping Enabled) */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Entity / Destination</div>}
                        <div className="flex items-start gap-1.5 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 w-full max-w-full">
                          <MapPin size={12} className="text-slate-400 shrink-0 mt-0.5"/>
                          <span className="text-xs font-bold text-slate-700 whitespace-normal break-words leading-tight" title={t.entity_name || 'Not Specified'}>
                            {t.entity_name || 'Not Specified'}
                          </span>
                        </div>
                      </div>

                      {/* 4. Date & Reason */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Date & Reason</div>}
                        <div className="space-y-1 w-full">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[9px] lg:text-[10px] font-black text-slate-600 uppercase tracking-widest w-fit">
                            <Calendar size={12} /> {t.transfer_date ? format(parseISO(t.transfer_date), 'dd MMM yyyy') : '--'}
                          </span>
                          {t.reason && (
                            <p className="text-xs font-semibold text-slate-800 line-clamp-1" title={t.reason}>
                              {t.reason}
                            </p>
                          )}
                          {t.notes && (
                            <p className="text-[10px] font-medium text-slate-500 line-clamp-1" title={t.notes}>
                              {t.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 5. Actions */}
                      <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100' : 'items-center justify-end'}`}>
                        {hasPermission('logistics:delete') && (
                          <button 
                            onClick={() => {
                              if (window.confirm("Are you sure you want to delete this transfer log?")) {
                                deleteMutation.mutate(t.id);
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

export default ExternalTransfersPage;
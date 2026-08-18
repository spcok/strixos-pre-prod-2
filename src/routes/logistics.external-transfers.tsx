import React, { useState, useMemo, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Search, Loader2, MapPin, Trash2, Calendar } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

// ------------------------------------------------------------------
// ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/logistics/external-transfers')({
  component: ExternalTransfersPage,
});

// ------------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------------
export function ExternalTransfersPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Custom Date Filters (Default to last 30 days)
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

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

  // Fetch Logic (Aligned to V3 Schema: entity_name)
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['external_transfers', startDate, endDate],
    queryFn: async () => {
      const startISO = new Date(`${startDate}T00:00:00.000Z`).toISOString();
      const endISO = new Date(`${endDate}T23:59:59.999Z`).toISOString();

      const { data, error } = await supabase
        .from('external_transfers')
        .select(`
          *,
          animals (
            name,
            species,
            ring_number,
            microchip_id
          )
        `)
        .eq('is_deleted', false)
        .gte('transfer_date', startISO)
        .lte('transfer_date', endISO)
        .order('transfer_date', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

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

  // Client-Side Search Filters
  const filteredTransfers = useMemo(() => {
    if (!searchQuery.trim()) return transfers;
    const query = searchQuery.toLowerCase();
    
    return transfers.filter((t: any) => {
      const animalName = (t.animals?.name || '').toLowerCase();
      const speciesName = (t.animals?.species || '').toLowerCase();
      const entityName = (t.entity_name || '').toLowerCase(); // MAPPED CORRECTLY
      const type = (t.transfer_type || '').toLowerCase();
      
      return animalName.includes(query) || 
             speciesName.includes(query) || 
             entityName.includes(query) ||
             type.includes(query);
    });
  }, [transfers, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto space-y-4 md:space-y-6 pb-20 font-sans animate-in fade-in duration-500">
      
      {/* HEADER & CONTROLS */}
      <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 border border-indigo-100 shadow-inner">
            <ArrowRightLeft size={24} />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              External Transfers
            </h1>
            <p className="text-[10px] font-black text-slate-500 mt-0.5 uppercase tracking-widest">Logistics & Acquisitions</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:w-auto">
          {/* Date Range Selector */}
          <div className="flex items-center gap-2 w-full sm:w-auto bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <Calendar size={14} className="text-slate-400 shrink-0" />
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent border-none focus:ring-0 p-0 text-slate-700"
              />
              <span className="text-slate-300">to</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent border-none focus:ring-0 p-0 text-slate-700"
              />
            </div>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search animals, entities..." 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm" 
            />
          </div>
        </div>
      </div>

      {/* DATA GRID */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px] relative">
        {isLoading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 bg-white p-6 rounded-2xl shadow-2xl border border-slate-100">
              <Loader2 className="animate-spin text-indigo-600" size={32} />
              <span className="text-sm font-black text-slate-900 tracking-widest uppercase">Syncing Manifest...</span>
            </div>
          </div>
        )}

        {/* TABLE HEADER (Desktop) */}
        <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Transfer Date</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Animal & Species</div>
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-center">Type</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Entity / Destination</div>
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Actions</div>
        </div>

        {/* TABLE BODY */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
          {filteredTransfers.length === 0 && !isLoading ? (
             <div className="flex flex-col items-center justify-center py-24 text-slate-400">
               <ArrowRightLeft size={48} className="opacity-20 mb-4" />
               <p className="text-lg font-black text-slate-500 tracking-tight">No Transfers Found</p>
               <p className="text-xs font-bold mt-1">Try expanding the date range.</p>
             </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTransfers.map((t: any) => {
                const isOut = t.transfer_type === 'OUT';
                
                return (
                  <div key={t.id} className="flex flex-col lg:grid lg:grid-cols-12 gap-2 lg:gap-4 p-4 lg:px-6 lg:py-4 hover:bg-slate-50 transition-colors bg-white">
                    
                    {/* MOBILE HEADER: Date & Type */}
                    <div className="flex items-center justify-between lg:hidden mb-2">
                      <span className="text-xs font-black text-slate-700 flex items-center gap-1.5"><Calendar size={12}/> {t.transfer_date ? format(parseISO(t.transfer_date), 'dd MMM yyyy') : '--'}</span>
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${isOut ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {t.transfer_type}
                      </span>
                    </div>

                    {/* Date (Desktop) */}
                    <div className="hidden lg:flex flex-col justify-center col-span-2">
                      <span className="text-sm font-black text-slate-900">{t.transfer_date ? format(parseISO(t.transfer_date), 'dd MMM yyyy') : '--'}</span>
                      <span className="text-[10px] font-bold text-slate-400 mt-0.5">{t.transfer_date ? format(parseISO(t.transfer_date), 'HH:mm') : '--'}</span>
                    </div>

                    {/* Animal Info */}
                    <div className="flex flex-col justify-center col-span-3">
                      <span className="text-sm font-black text-slate-900 truncate" title={t.animals?.name || 'Unknown'}>{t.animals?.name || 'Unknown Animal'}</span>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500 truncate">
                         <span className="font-bold uppercase tracking-widest">{t.animals?.ring_number || t.animals?.microchip_id || t.animal_id?.substring(0,8) || '--'}</span>
                         <span>•</span>
                         <span className="italic truncate">{t.animals?.species || 'Unknown Species'}</span>
                      </div>
                    </div>

                    {/* Type (Desktop) */}
                    <div className="hidden lg:flex items-center justify-center col-span-2">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border ${isOut ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                        TRANSFER {t.transfer_type}
                      </span>
                    </div>

                    {/* Entity / Destination (Properly aligned to schema) */}
                    <div className="flex flex-col justify-center col-span-3 pt-2 lg:pt-0 border-t border-slate-100 lg:border-none">
                       <span className="text-xs font-bold text-slate-400 uppercase tracking-widest lg:hidden mb-1">Entity / Destination:</span>
                       <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                         <MapPin size={14} className="text-slate-400 shrink-0"/> 
                         {t.entity_name || 'Not Specified'}
                       </span>
                       {t.reason && (
                         <span className="text-[10px] font-bold text-slate-500 mt-1 truncate" title={t.reason}>
                           Reason: {t.reason}
                         </span>
                       )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end col-span-2 pt-2 lg:pt-0 mt-2 lg:mt-0">
                      <button
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this transfer log?")) {
                            deleteMutation.mutate(t.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-colors"
                        title="Delete Record"
                      >
                        {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExternalTransfersPage;
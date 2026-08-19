import React, { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { 
  Skull, Search, Calendar, FileText, AlertTriangle, 
  ChevronLeft, ChevronRight, Loader2, BookOpen
} from 'lucide-react';
import { format } from 'date-fns';

// ------------------------------------------------------------------
// ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/clinical/mortality')({
  component: MortalityLedger,
});

// ------------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------------
export function MortalityLedger() {
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Fetch the Death Logs
  const { data: deathLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['death_logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('death_logs')
        .select('*')
        .order('date_of_death', { ascending: false });
      if (error) throw error;
      return data;
    },
    meta: { persist: true }
  });

  // 2. Fetch the Animals (including ARCHIVED) to stitch the data
  const { data: animals = [], isLoading: loadingAnimals } = useQuery({
    queryKey: ['animals', 'all'], // Needs a unique key to ensure it pulls archived animals too
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('id, name, species, ring_number, microchip_id');
      if (error) throw error;
      return data;
    },
    meta: { persist: true }
  });

  // 3. Fetch Staff to map the "Logged By" UUIDs
  const { data: staff = [], isLoading: loadingStaff } = useQuery({
    queryKey: ['staff_directory'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, name, role');
      if (error) throw error;
      return data;
    },
    meta: { persist: true }
  });

  const isLoading = loadingLogs || loadingAnimals || loadingStaff;

  // 4. Stitch and Filter Data
  const ledgerData = useMemo(() => {
    let stitched = deathLogs.map((log: any) => {
      const animal = animals.find((a: any) => a.id === log.animal_id);
      const logger = staff.find((s: any) => s.id === log.logged_by);
      return {
        ...log,
        animalName: animal?.name || 'Unknown Animal',
        animalSpecies: animal?.species || 'Unknown Species',
        animalId: animal?.ring_number || animal?.microchip_id || animal?.id.substring(0,8),
        loggedByName: logger?.name || 'System'
      };
    });

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      stitched = stitched.filter((row: any) => 
        row.animalName.toLowerCase().includes(query) ||
        row.animalSpecies.toLowerCase().includes(query) ||
        (row.cause_of_death && row.cause_of_death.toLowerCase().includes(query))
      );
    }

    return stitched;
  }, [deathLogs, animals, staff, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto space-y-4 md:space-y-6 pb-20 font-sans animate-in fade-in duration-500">
      
      {/* HEADER */}
      <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-100 text-slate-700 rounded-xl flex items-center justify-center shrink-0 border border-slate-200 shadow-inner">
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              Mortality Ledger
            </h1>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-0.5">ZLA Clinical Post-Mortem Records</p>
          </div>
        </div>
        
        <div className="relative w-full md:w-72 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input 
            type="text" 
            placeholder="Search by animal or cause..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-all shadow-sm" 
          />
        </div>
      </div>

      {/* DATA GRID */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px] relative">
        
        {isLoading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 bg-white p-6 rounded-2xl shadow-2xl border border-slate-100">
              <Loader2 className="animate-spin text-slate-600" size={32} />
              <span className="text-sm font-black text-slate-900 tracking-widest uppercase">Syncing Ledger...</span>
            </div>
          </div>
        )}

        {/* TABLE HEADER (Desktop) */}
        <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Date</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Animal ID & Species</div>
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Manner</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Cause of Death</div>
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Authorizing Vet/Staff</div>
        </div>

        {/* TABLE BODY */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
          {ledgerData.length === 0 && !isLoading ? (
             <div className="flex flex-col items-center justify-center py-24 text-slate-400">
               <BookOpen size={48} className="opacity-20 mb-4" />
               <p className="text-lg font-black text-slate-500 tracking-tight">Ledger is Empty</p>
               <p className="text-xs font-bold mt-1">No mortality records found in the database.</p>
             </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {ledgerData.map((row: any) => (
                <div key={row.id} className="flex flex-col lg:grid lg:grid-cols-12 gap-2 lg:gap-4 p-4 lg:px-6 lg:py-4 hover:bg-slate-50 transition-colors bg-white">
                  
                  {/* MOBILE HEADER: Date & Manner */}
                  <div className="flex items-center justify-between lg:hidden mb-2">
                    <span className="text-xs font-black text-slate-700 flex items-center gap-1.5"><Calendar size={12}/> {format(new Date(row.date_of_death), 'dd MMM yyyy')}</span>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${row.manner_of_death === 'Euthanasia' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                      {row.manner_of_death}
                    </span>
                  </div>

                  {/* Date (Desktop) */}
                  <div className="hidden lg:flex flex-col justify-center col-span-2">
                    <span className="text-sm font-black text-slate-900">{format(new Date(row.date_of_death), 'dd MMM yyyy')}</span>
                    <span className="text-[10px] font-bold text-slate-400 mt-0.5">{format(new Date(row.date_of_death), 'HH:mm')}</span>
                  </div>

                  {/* Animal Info */}
                  <div className="flex flex-col justify-center col-span-3">
                    <span className="text-sm font-black text-slate-900 truncate" title={row.animalName}>{row.animalName}</span>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500 truncate">
                       <span className="font-bold uppercase tracking-widest">{row.animalId}</span>
                       <span>•</span>
                       <span className="italic truncate">{row.animalSpecies}</span>
                    </div>
                  </div>

                  {/* Manner (Desktop) */}
                  <div className="hidden lg:flex items-center col-span-2">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border ${row.manner_of_death === 'Euthanasia' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                      {row.manner_of_death}
                    </span>
                  </div>

                  {/* Cause & Notes */}
                  <div className="flex flex-col justify-center col-span-3 pt-2 lg:pt-0 border-t border-slate-100 lg:border-none">
                     <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                       <AlertTriangle size={12} className={row.cause_of_death ? "text-rose-500" : "text-slate-300"}/> 
                       {row.cause_of_death || 'Pending Post-Mortem'}
                     </span>
                     {row.necropsy_notes && (
                       <span className="text-[10px] font-medium text-slate-500 mt-1 line-clamp-2 leading-relaxed" title={row.necropsy_notes}>
                         {row.necropsy_notes}
                       </span>
                     )}
                  </div>

                  {/* Logged By */}
                  <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-center col-span-2 pt-2 lg:pt-0 mt-2 lg:mt-0">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest lg:hidden">Logged By:</span>
                    <span className="text-xs font-bold text-slate-700 text-right">{row.loggedByName}</span>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MortalityLedger;
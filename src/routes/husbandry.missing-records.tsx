import React, { useState, useMemo, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, flexRender, ColumnDef, getSortedRowModel, getFilteredRowModel, SortingState } from '@tanstack/react-table';
import { AlertTriangle, Calendar, ChevronLeft, ChevronRight, Loader2, Search, ArrowUpDown, Plus, ShieldAlert } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Animal } from '../types';

import { FeedModal } from '../components/husbandry/FeedModal';
import { WeightModal } from '../components/husbandry/WeightModal';
import { TemperatureModal } from '../components/husbandry/TemperatureModal';

export const Route = createFileRoute('/staff/missing-records')({
  component: MissingHusbandryRecords,
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

const getLocalDateString = (d = new Date()) => {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const getSafeISOStart = (dateString: string) => new Date(`${dateString}T00:00:00`).toISOString();
const getSafeISOEnd = (dateString: string) => new Date(`${dateString}T23:59:59.999`).toISOString();

// ------------------------------------------------------------------
// COMPLIANCE ENGINE
// ------------------------------------------------------------------
// This defines what constitutes a "missing" record for your facility.
const COMPLIANCE_RULES = {
  WEIGHT_CADENCE_DAYS: 7, // Flag if not weighed in 7 days
  REQUIRES_DAILY_TEMP: ['EXOTIC', 'AQUATIC', 'INVERT'], // Categories needing daily temps
};

function MissingHusbandryRecords() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  
  // DATE STATE
  const [activeDate, setActiveDate] = useState<string>(getLocalDateString());
  const [inputDate, setInputDate] = useState<string>(getLocalDateString());
  
  // FILTERS
  const [activeTab, setActiveTab] = useState('ALL');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  
  // MODALS
  const [feedModalState, setFeedModalState] = useState<{ isOpen: boolean; animalId: string | null }>({ isOpen: false, animalId: null });
  const [weightModalState, setWeightModalState] = useState<{ isOpen: boolean; animalId: string | null }>({ isOpen: false, animalId: null });
  const [tempModalState, setTempModalState] = useState<{ isOpen: boolean; animal: Animal | null }>({ isOpen: false, animal: null });

  // ------------------------------------------------------------------
  // DATA FETCHING
  // ------------------------------------------------------------------
  const { data: animals = [], isLoading: loadingAnimals } = useQuery({
    queryKey: ['animals', 'compliance'],
    queryFn: async () => {
      const { data, error } = await supabase.from('animals').select('*').neq('status', 'ARCHIVED').order('name');
      if (error) throw error;
      return data as Animal[];
    },
    meta: { persist: true }
  });

  // Fetch feeds for the selected day
  const { data: dayFeeds = [], isLoading: loadingFeeds } = useQuery({
    queryKey: ['feed_logs', 'compliance', activeDate],
    queryFn: async () => {
      const start = getSafeISOStart(activeDate);
      const end = getSafeISOEnd(activeDate);
      const { data, error } = await supabase.from('feed_logs').select('animal_id').gte('recorded_at', start).lte('recorded_at', end);
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    meta: { persist: true }
  });

  // Fetch temps for the selected day
  const { data: dayTemps = [], isLoading: loadingTemps } = useQuery({
    queryKey: ['temperature_logs', 'compliance', activeDate],
    queryFn: async () => {
      const start = getSafeISOStart(activeDate);
      const end = getSafeISOEnd(activeDate);
      const { data, error } = await supabase.from('temperature_logs').select('animal_id').gte('recorded_at', start).lte('recorded_at', end);
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    meta: { persist: true }
  });

  // Fetch weights for the last X days to check compliance cadence
  const { data: recentWeights = [], isLoading: loadingWeights } = useQuery({
    queryKey: ['weight_logs', 'compliance', activeDate],
    queryFn: async () => {
      const targetDate = new Date(`${activeDate}T12:00:00`);
      const cutoffDate = subDays(targetDate, COMPLIANCE_RULES.WEIGHT_CADENCE_DAYS);
      const { data, error } = await supabase.from('weight_logs').select('animal_id').gte('recorded_at', cutoffDate.toISOString()).lte('recorded_at', getSafeISOEnd(activeDate));
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    meta: { persist: true }
  });

  const isLoading = loadingAnimals || loadingFeeds || loadingTemps || loadingWeights;

  const updateDate = (newDate: string) => {
    if (newDate && newDate.length === 10) {
      setActiveDate(newDate);
      setInputDate(newDate);
    } else {
      setInputDate(activeDate);
    }
  };

  const shiftDate = (days: number) => {
    const parts = activeDate.split('-');
    if (parts.length !== 3) return;
    const [y, m, d] = parts.map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    dateObj.setDate(dateObj.getDate() + days);
    updateDate(getLocalDateString(dateObj));
  };

  // ------------------------------------------------------------------
  // AUDIT ENGINE LOGIC
  // ------------------------------------------------------------------
  const complianceData = useMemo(() => {
    // 1. Create Sets for fast O(1) lookups
    const fedAnimalIds = new Set(dayFeeds.map(f => f.animal_id));
    const tempedAnimalIds = new Set(dayTemps.map(t => t.animal_id));
    const weighedAnimalIds = new Set(recentWeights.map(w => w.animal_id));

    // 2. Map through animals and identify gaps
    let auditList = animals.map(animal => {
      const gaps = [];

      // Check Feed Gap (Assuming all animals need daily feeds. Can add logic later if snakes fast, etc.)
      if (!fedAnimalIds.has(animal.id)) gaps.push('FEED');

      // Check Temp Gap (Only for specific categories)
      if (animal.category && COMPLIANCE_RULES.REQUIRES_DAILY_TEMP.includes(animal.category)) {
        if (!animal.ambient_temp_only && !tempedAnimalIds.has(animal.id)) {
           gaps.push('TEMP');
        }
      }

      // Check Weight Gap (Hasn't been weighed in the compliance window)
      if (!weighedAnimalIds.has(animal.id)) gaps.push('WEIGHT');

      return {
        ...animal,
        gaps,
        isCompliant: gaps.length === 0
      };
    });

    // 3. Filter out compliant animals (We only want to see problems on this screen)
    let nonCompliantList = auditList.filter(a => !a.isCompliant);

    // 4. Apply UI Filters
    if (activeTab !== 'ALL') {
      nonCompliantList = nonCompliantList.filter(a => a.category === activeTab);
    }

    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      nonCompliantList = nonCompliantList.filter(a => 
        a.name.toLowerCase().includes(q) || 
        (a.species && a.species.toLowerCase().includes(q)) ||
        (a.ring_number && a.ring_number.toLowerCase().includes(q))
      );
    }

    return nonCompliantList;
  }, [animals, dayFeeds, dayTemps, recentWeights, activeTab, globalFilter]);

  const categories = useMemo(() => Array.from(new Set(animals.map(a => a.category).filter(Boolean))).sort(), [animals]);
  const tabs = ['ALL', ...categories];

  // ------------------------------------------------------------------
  // TABLE COLUMNS
  // ------------------------------------------------------------------
  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      accessorKey: 'name',
      header: 'Animal Details',
      cell: (info) => {
        const animal = info.row.original;
        return (
          <div className="flex flex-col justify-center min-w-0 py-1">
            <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={animal.name}>{animal.name}</h3>
            <div className="flex items-center gap-1.5 text-[9px] lg:text-[10px] text-slate-500 truncate mt-0.5">
              {animal.ring_number && <span className="font-bold text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
              {animal.ring_number && animal.species && <span>•</span>}
              {animal.species && <span className="italic truncate">{animal.species}</span>}
            </div>
          </div>
        );
      }
    },
    {
      id: 'missing_feed',
      header: 'Feed Status',
      cell: (info) => {
        const hasGap = info.row.original.gaps.includes('FEED');
        if (!hasGap) return <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center">Logged</div>;
        return (
          <button onClick={() => setFeedModalState({ isOpen: true, animalId: info.row.original.id })} className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors shadow-sm">
            <AlertTriangle size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Missing</span>
          </button>
        );
      }
    },
    {
      id: 'missing_weight',
      header: `${COMPLIANCE_RULES.WEIGHT_CADENCE_DAYS}-Day Weight`,
      cell: (info) => {
        const hasGap = info.row.original.gaps.includes('WEIGHT');
        if (!hasGap) return <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center">Compliant</div>;
        return (
          <button onClick={() => setWeightModalState({ isOpen: true, animalId: info.row.original.id })} className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors shadow-sm">
            <AlertTriangle size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Overdue</span>
          </button>
        );
      }
    },
    {
      id: 'missing_temp',
      header: 'Temp Status',
      cell: (info) => {
        const animal = info.row.original;
        const requiresTemp = animal.category && COMPLIANCE_RULES.REQUIRES_DAILY_TEMP.includes(animal.category) && !animal.ambient_temp_only;
        if (!requiresTemp) return <div className="text-[10px] font-bold text-slate-200 uppercase tracking-widest text-center">N/A</div>;
        
        const hasGap = animal.gaps.includes('TEMP');
        if (!hasGap) return <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center">Logged</div>;
        
        return (
          <button onClick={() => setTempModalState({ isOpen: true, animal: animal })} className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors shadow-sm">
            <AlertTriangle size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Missing</span>
          </button>
        );
      }
    }
  ], []); 

  const table = useReactTable({
    data: complianceData,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tableGridCols = "minmax(180px, 2fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr)";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-500 font-sans">
      
      {/* HEADER */}
      <div className="flex justify-between items-center w-full portrait:flex landscape:hidden lg:landscape:flex">
        <div className="shrink-0 pr-4">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
             <ShieldAlert className="text-rose-600" /> Compliance Audit
           </h1>
        </div>
      </div>

      {/* CONTROLS */}
      <div className="flex flex-col sm:flex-row gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex">
        
        <div className="relative w-full lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Filter non-compliant animals..." 
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center justify-end gap-2 w-full lg:w-auto">
          {activeDate !== getLocalDateString() && (
            <button 
              onClick={() => updateDate(getLocalDateString())} 
              className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-colors shadow-sm border border-rose-200 shrink-0"
            >
              <Calendar size={14} /> Today
            </button>
          )}
          <div className="flex items-center justify-between bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full lg:w-auto min-w-0">
            <button onClick={() => shiftDate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95 shrink-0"><ChevronLeft size={16} /></button>
            <div className="flex-1 lg:flex-none relative flex justify-center border-l border-r border-slate-100 px-2 min-w-[130px]">
              <input 
                type="date" 
                value={inputDate}
                onChange={(e) => setInputDate(e.target.value)}
                onBlur={(e) => updateDate(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && updateDate(e.currentTarget.value)}
                className="bg-transparent border-none text-[10px] lg:text-xs font-bold text-slate-700 focus:outline-none focus:ring-0 py-1 cursor-pointer w-full text-center"
              />
            </div>
            <button onClick={() => shiftDate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95 shrink-0"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* CATEGORY TABS */}
      <div className="grid grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm ${
              activeTab === tab 
                ? 'bg-rose-600 text-white border border-rose-700 shadow-rose-600/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* MAIN DATA GRID */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        
        {/* SUMMARY BAR */}
        <div className="px-5 py-3 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between shrink-0">
          <span className="text-xs font-bold text-rose-800">
            {isLoading ? 'Scanning records...' : `${complianceData.length} records require attention`}
          </span>
          <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">
            Audit Date: {format(new Date(`${activeDate}T12:00:00`), 'dd MMM yyyy')}
          </span>
        </div>

        {isLoading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-rose-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Running compliance engine...</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            {table.getHeaderGroups().map(headerGroup => (
              <React.Fragment key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => (
                  <div 
                    key={header.id} 
                    className={`px-5 py-4 flex items-center gap-2 cursor-pointer hover:bg-slate-200/50 transition-colors ${
                      index === 0 ? 'justify-start text-left' : 'justify-center text-center'
                    }`} 
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: <ArrowUpDown size={12} className="text-rose-500" />, desc: <ArrowUpDown size={12} className="text-rose-500 rotate-180" /> }[header.column.getIsSorted() as string] ?? null}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div className="p-3 lg:p-0">
            {table.getRowModel().rows.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-emerald-600 flex flex-col items-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4 border border-emerald-200 shadow-sm">
                  <ShieldAlert size={32} className="text-emerald-500" />
                </div>
                <p className="text-lg font-black tracking-tight mb-1">100% Compliant</p>
                <p className="text-xs font-bold opacity-80">No missing records found for this date.</p>
              </div>
            ) : (
              <div className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-slate-100">
                {table.getRowModel().rows.map(row => (
                  <div 
                    key={row.id} 
                    className="grid grid-cols-1 lg:grid border border-rose-100 lg:border-none rounded-xl lg:rounded-none bg-white p-3 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-2 lg:gap-0"
                    style={{ gridTemplateColumns: isMobile ? '1fr' : tableGridCols }}
                  >
                    {row.getVisibleCells().map((cell, index) => (
                      <div 
                        key={cell.id} 
                        className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col' : 'items-center justify-center'}`}
                      >
                        {isMobile && index !== 0 && (
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 text-center w-full">
                            {flexRender(cell.column.columnDef.header, cell.getContext())}
                          </div>
                        )}
                        <div className={`w-full ${index !== 0 && !isMobile ? 'flex justify-center' : ''}`}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RESOLUTION MODALS */}
      {feedModalState.isOpen && feedModalState.animalId && (
        <FeedModal isOpen={feedModalState.isOpen} animalId={feedModalState.animalId} selectedDate={activeDate} onClose={() => setFeedModalState({ isOpen: false, animalId: null })} />
      )}
      {weightModalState.isOpen && weightModalState.animalId && (
        <WeightModal isOpen={weightModalState.isOpen} animalId={weightModalState.animalId} selectedDate={activeDate} onClose={() => setWeightModalState({ isOpen: false, animalId: null })} />
      )}
      {tempModalState.isOpen && tempModalState.animal && (
        <TemperatureModal isOpen={tempModalState.isOpen} animalId={tempModalState.animal.id} ambientOnly={tempModalState.animal.ambient_temp_only || false} selectedDate={activeDate} onClose={() => setTempModalState({ isOpen: false, animal: null })} />
      )}
    </div>
  );
}

export default MissingHusbandryRecords;
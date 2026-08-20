import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, flexRender, ColumnDef, getSortedRowModel, getFilteredRowModel, SortingState } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Scale, ChevronLeft, ChevronRight, Loader2, Search, Apple, CheckCircle2, Users, User, ArrowUpDown, ThermometerSun, Plus, Calendar, Droplets } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Animal } from '../types';

import { FeedModal } from '../components/husbandry/FeedModal';
import { WeightModal } from '../components/husbandry/WeightModal';
import { TemperatureModal } from '../components/husbandry/TemperatureModal';
import DailyLogFormModal from '../components/animals/DailyLogFormModal'; 

export const Route = createFileRoute('/husbandry/daily-logs')({
  component: HusbandryLogs,
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

const isValidDateString = (dateString: string) => {
  if (!dateString || dateString.length !== 10) return false;
  const d = new Date(dateString);
  return d instanceof Date && !isNaN(d.getTime());
};

const getSafeISOStart = (dateString: string) => {
  if (!isValidDateString(dateString)) return new Date().toISOString();
  return new Date(`${dateString}T00:00:00`).toISOString();
};

const getSafeISOEnd = (dateString: string) => {
  if (!isValidDateString(dateString)) return new Date().toISOString();
  return new Date(`${dateString}T23:59:59.999`).toISOString();
};

const GRAMS_PER_OZ = 28.349523125;

export const formatWeightDisplay = (grams: number | null | undefined, unit: string) => {
  if (!grams) return null;
  if (unit === 'kg') return `${(grams / 1000).toFixed(3)}kg`;
  if (unit === 'lb') {
    const totalOunces = grams / GRAMS_PER_OZ;
    let totalOzInt = Math.floor(totalOunces);
    let e = Math.round((totalOunces - totalOzInt) * 8);
    if (e >= 8) { totalOzInt += 1; e = 0; }
    const lb = Math.floor(totalOzInt / 16);
    const oz = totalOzInt % 16;
    let str = '';
    if (lb > 0) str += `${lb}lb `;
    if (oz > 0 || e > 0) str += `${oz}`;
    if (e > 0) str += ` ${e}/8`;
    if (oz > 0 || e > 0) str += 'oz';
    return str.trim() || '0lb';
  }
  if (unit === 'oz') {
    const totalOunces = grams / GRAMS_PER_OZ;
    let totalOzInt = Math.floor(totalOunces);
    let e = Math.round((totalOunces - totalOzInt) * 8);
    if (e >= 8) { totalOzInt += 1; e = 0; }
    let str = `${totalOzInt}`;
    if (e > 0) str += ` ${e}/8`;
    return `${str}oz`;
  }
  return `${Math.round(grams)}g`;
};

// ============================================================================
// ISOLATED CELL COMPONENTS
// ============================================================================
const FeedCell = ({ animal, logs, onOpenModal }: { animal: any, logs: any[], onOpenModal: (data: any) => void }) => {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {logs.map((log: any) => {
        const timeStr = log.recorded_at ? new Date(log.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
        
        const qty = log.quantity_offered ?? log.amount_offered ?? log.amount ?? log.quantity ?? '';
        const rawUnit = log.quantity_unit ?? log.unit ?? '';
        const unit = rawUnit.toLowerCase().includes('whole') ? 'x' : rawUnit;
        const food = log.food_item ?? log.food_type ?? log.feed_details ?? log.food ?? 'Feed';

        let qtyStr = qty ? `${qty}${unit} ${food}` : food;
        if (timeStr) qtyStr += ` @ ${timeStr}`;

        return (
          <button
            key={log.id}
            onClick={() => onOpenModal({ isOpen: true, animalId: animal.id, initialData: log })}
            className="flex items-center justify-center text-center text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200 w-full shadow-sm hover:bg-emerald-100 transition-colors gap-2"
          >
            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
            <span className="text-xs font-semibold whitespace-normal break-words leading-tight">
              {qtyStr}
            </span>
          </button>
        );
      })}

      <button
        onClick={() => onOpenModal({ isOpen: true, animalId: animal.id })}
        className={`flex items-center justify-center text-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium active:scale-95 w-full shadow-sm transition-colors ${
          logs.length > 0 
            ? 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200 border-dashed'
            : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
        }`}
      >
        {logs.length > 0 ? <Plus size={14} /> : <Apple size={14} />}
        {logs.length > 0 ? 'Add Feed' : 'Log Feed'}
      </button>
    </div>
  );
};

const WeightCell = ({ animal, log, onOpenModal }: { animal: any, log: any, onOpenModal: (data: any) => void }) => {
  const targetUnit = animal.weight_unit || 'g';

  if (log) {
    return (
       <button
        onClick={() => onOpenModal({ isOpen: true, animalId: animal.id, initialData: log })}
        className="flex items-center justify-center text-center text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200 w-full shadow-sm hover:bg-emerald-100 transition-colors gap-2"
      >
        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold whitespace-normal break-words leading-tight">
          {formatWeightDisplay(log.weight_grams, targetUnit)}
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={() => onOpenModal({ isOpen: true, animalId: animal.id })}
      className="flex items-center justify-center text-center gap-1.5 bg-white text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium active:scale-95 w-full shadow-sm transition-colors"
    >
      <Scale size={14} className="text-slate-400 shrink-0" /> Log Weight
    </button>
  );
};

const TempCell = ({ animal, log, onOpenModal }: { animal: any, log: any, onOpenModal: (data: any) => void }) => {
  if (log) {
    let tempStr = 'Temped';
    if (log.temp_ambient) tempStr = `${log.temp_ambient}°C Amb`;
    else if (log.temp_basking && log.temp_cool) tempStr = `${log.temp_basking}°C / ${log.temp_cool}°C`;
    else if (log.temp_basking) tempStr = `${log.temp_basking}°C Bask`;

    return (
       <button
        onClick={() => onOpenModal({ isOpen: true, animal: animal, initialData: log })}
        className="flex items-center justify-center text-center text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200 w-full shadow-sm hover:bg-emerald-100 transition-colors gap-2"
      >
        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold whitespace-normal break-words leading-tight">
          {tempStr}
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={() => onOpenModal({ isOpen: true, animal: animal })}
      className="flex items-center justify-center text-center gap-1.5 bg-white text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium active:scale-95 w-full shadow-sm transition-colors"
    >
      <ThermometerSun size={14} className="text-slate-400 shrink-0" /> Log Temp
    </button>
  );
};

const MistCell = ({ animal, log, activeDate, onOpenModal }: { animal: any, log: any, activeDate: string, onOpenModal: (data: any) => void }) => {
  if (log) {
    const level = log.mist_level ? log.mist_level.charAt(0).toUpperCase() + log.mist_level.slice(1).toLowerCase() : 'Logged';
    const ampm = log.am_pm ? log.am_pm.toUpperCase() : '';
    const mistStr = `${level} Mist ${ampm}`.trim();

    return (
       <button
        onClick={() => onOpenModal({ isOpen: true, animal: animal, initialData: log })}
        className="flex items-center justify-center text-center text-cyan-700 bg-cyan-50 px-3 py-2 rounded-lg border border-cyan-200 w-full shadow-sm hover:bg-cyan-100 transition-colors gap-2"
      >
        <CheckCircle2 size={14} className="text-cyan-500 shrink-0" />
        <span className="text-xs font-semibold whitespace-normal break-words leading-tight">
          {mistStr}
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={() => onOpenModal({ isOpen: true, animal: animal, initialData: { log_date: activeDate } })}
      className="flex items-center justify-center text-center gap-1.5 bg-white text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium active:scale-95 w-full shadow-sm transition-colors"
    >
      <Droplets size={14} className="text-slate-400 shrink-0" /> Log Mist
    </button>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function HusbandryLogs() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);
  
  const [activeDate, setActiveDate] = useState<string>(getLocalDateString());
  const [inputDate, setInputDate] = useState<string>(getLocalDateString());
  
  const [activeTab, setActiveTab] = useState('ALL');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  
  const [feedModalState, setFeedModalState] = useState<{ isOpen: boolean; animalId: string | null; initialData?: any }>({ isOpen: false, animalId: null, initialData: undefined });
  const [weightModalState, setWeightModalState] = useState<{ isOpen: boolean; animalId: string | null; initialData?: any }>({ isOpen: false, animalId: null, initialData: undefined });
  const [tempModalState, setTempModalState] = useState<{ isOpen: boolean; animal: Animal | null; initialData?: any }>({ isOpen: false, animal: null, initialData: undefined });
  const [mistModalState, setMistModalState] = useState<{ isOpen: boolean; animal: Animal | null; initialData?: any }>({ isOpen: false, animal: null, initialData: undefined });

  // 1. OFFLINE-FIRST QUERIES WITH 14-DAY RETENTION
  const { data: animals = [], isLoading: loadingAnimals } = useQuery({
    queryKey: ['animals', 'husbandry'],
    queryFn: async () => {
      const { data, error } = await supabase.from('animals').select('*').order('name');
      if (error) throw error;
      return data as Animal[];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  // HOTFIX: Query keys aligned exactly to Modal invalidation signatures
  const { data: feedLogs = [], isLoading: loadingFeeds } = useQuery({
    queryKey: ['feeds', activeDate],
    queryFn: async () => {
      const start = getSafeISOStart(activeDate);
      const end = getSafeISOEnd(activeDate);
      const { data, error } = await supabase.from('feed_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: weightLogs = [], isLoading: loadingWeights } = useQuery({
    queryKey: ['weights', activeDate],
    queryFn: async () => {
      const start = getSafeISOStart(activeDate);
      const end = getSafeISOEnd(activeDate);
      const { data, error } = await supabase.from('weight_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: tempLogs = [], isLoading: loadingTemps } = useQuery({
    queryKey: ['temperatures', activeDate],
    queryFn: async () => {
      const start = getSafeISOStart(activeDate);
      const end = getSafeISOEnd(activeDate);
      const { data, error } = await supabase.from('temperature_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: mistLogs = [], isLoading: loadingMists } = useQuery({
    queryKey: ['mist_logs', activeDate],
    queryFn: async () => {
      const start = getSafeISOStart(activeDate);
      const end = getSafeISOEnd(activeDate);
      const { data, error } = await supabase.from('mist_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const isLoading = loadingAnimals || loadingFeeds || loadingWeights || loadingTemps || loadingMists;

  // 2. REALTIME CACHE INVALIDATION
  useEffect(() => {
    const channel = supabase.channel('daily-logs-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_logs' }, () => queryClient.invalidateQueries({ queryKey: ['feeds'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weight_logs' }, () => queryClient.invalidateQueries({ queryKey: ['weights'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'temperature_logs' }, () => queryClient.invalidateQueries({ queryKey: ['temperatures'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mist_logs' }, () => queryClient.invalidateQueries({ queryKey: ['mist_logs'] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // 3. DATE HANDLERS
  const updateDate = (newDate: string) => {
    if (isValidDateString(newDate)) {
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
    const dateObj = new Date(y, m - 1, d, 12, 0, 0); // Noon anchor prevents DST bugs
    dateObj.setDate(dateObj.getDate() + days);
    
    const newDateString = getLocalDateString(dateObj);
    updateDate(newDateString);
  };

  const jumpToToday = () => {
    updateDate(getLocalDateString());
  };

  // 4. O(1) PERFORMANCE ENGINE
  const getFeedLogsForAnimal = (animalId: string) => {
    return feedLogs.filter(log => log.animal_id === animalId);
  };

  const weightStatus = useMemo(() => {
    const map = new Map();
    weightLogs.forEach(log => {
      if (!map.has(log.animal_id)) map.set(log.animal_id, log); 
    });
    return map;
  }, [weightLogs]);

  const tempStatus = useMemo(() => {
    const map = new Map();
    tempLogs.forEach(log => {
      if (!map.has(log.animal_id)) map.set(log.animal_id, log); 
    });
    return map;
  }, [tempLogs]);

  const mistStatus = useMemo(() => {
    const map = new Map();
    mistLogs.forEach(log => {
      if (!map.has(log.animal_id)) map.set(log.animal_id, log); 
    });
    return map;
  }, [mistLogs]);

  const tableData = useMemo(() => {
    let filtered = animals.filter(a => a.status !== 'ARCHIVED');
    
    if (activeTab !== 'ALL') {
      filtered = filtered.filter(a => a.category === activeTab);
    }

    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      filtered = filtered.filter(a => 
        a.name.toLowerCase().includes(q) || 
        (a.species && a.species.toLowerCase().includes(q)) ||
        (a.ring_number && a.ring_number.toLowerCase().includes(q))
      );
    }

    return filtered.map(animal => ({
      ...animal,
      feedLogs: getFeedLogsForAnimal(animal.id),
      weightLog: weightStatus.get(animal.id),
      tempLog: tempStatus.get(animal.id),
      mistLog: mistStatus.get(animal.id),
    }));
  }, [animals, activeTab, globalFilter, feedLogs, weightStatus, tempStatus, mistStatus]);

  const categories = useMemo(() => Array.from(new Set(animals.map(a => a.category).filter(Boolean))).sort(), [animals]);
  const tabs = ['ALL', ...categories];

  // 5. TANSTACK TABLE SETUP
  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      accessorKey: 'name',
      header: 'Animal',
      cell: (info) => {
        const animal = info.row.original;
        const isGroup = animal.record_type === 'GROUP';
        
        return (
          <div className="flex items-center gap-3 min-w-0 py-1">
            <div className={`w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm overflow-hidden ${!animal.profile_image_url ? (isGroup ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-200') : 'border-slate-200'}`}>
              {animal.profile_image_url ? (
                <img src={animal.profile_image_url} alt={animal.name} className="w-full h-full object-cover" />
              ) : (
                isGroup ? <Users size={16} /> : <User size={16} />
              )}
            </div>

            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={animal.name}>{animal.name}</h3>
              <div className="flex items-center gap-1.5 text-[9px] lg:text-[10px] text-slate-500 truncate mt-0.5">
                {animal.ring_number && <span className="font-bold text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
                {animal.ring_number && animal.species && <span>•</span>}
                {animal.species && <span className="italic truncate">{animal.species}</span>}
              </div>
            </div>
          </div>
        );
      }
    },
    {
      id: 'feed',
      header: 'Feed Log',
      cell: (info) => <FeedCell animal={info.row.original} logs={info.row.original.feedLogs || []} onOpenModal={setFeedModalState} />
    },
    {
      id: 'weight',
      header: 'Weight Log',
      cell: (info) => <WeightCell animal={info.row.original} log={info.row.original.weightLog} onOpenModal={setWeightModalState} />
    },
    {
      id: 'temp',
      header: 'Temp Log',
      cell: (info) => <TempCell animal={info.row.original} log={info.row.original.tempLog} onOpenModal={setTempModalState} />
    },
    {
      id: 'mist',
      header: 'Mist Log',
      cell: (info) => <MistCell animal={info.row.original} log={info.row.original.mistLog} activeDate={activeDate} onOpenModal={setMistModalState} />
    }
  ], [activeDate]); 

  // Dynamically control whether the Mist Log column is visible
  const columnVisibility = useMemo(() => {
    return {
      mist: activeTab === 'EXOTIC'
    };
  }, [activeTab]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { globalFilter, sorting, columnVisibility },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { rows } = table.getRowModel();

  // 6. VIRTUALIZER SETUP (MOBILE OPTIMIZED)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => isMobile ? 180 : 80, // Expands row height for mobile stacked layout
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  const visibleColsCount = table.getVisibleLeafColumns().length;
  const tableGridCols = visibleColsCount === 5 
    ? "minmax(180px, 1.5fr) minmax(130px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr)"
    : "minmax(200px, 2fr) minmax(140px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr)";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-500">
      
      <div className="flex justify-between items-center w-full portrait:flex landscape:hidden lg:landscape:flex">
        <div className="shrink-0 pr-4">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight">Daily Logs</h1>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex">
        
        <div className="relative w-full lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search animals..." 
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center justify-end gap-2 w-full lg:w-auto">
          {activeDate !== getLocalDateString() && (
            <button 
              onClick={jumpToToday} 
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl text-[10px] lg:text-xs font-semibold transition-colors shadow-sm border border-emerald-200"
            >
              <Calendar size={14} /> Today
            </button>
          )}
          <div className="flex items-center justify-between bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full lg:w-auto">
            <button onClick={() => shiftDate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95"><ChevronLeft size={16} /></button>
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
            <button onClick={() => shiftDate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm ${
              activeTab === tab 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-emerald-500" size={24} />
              <span className="text-sm font-bold text-slate-700">Loading logs...</span>
            </div>
          </div>
        )}

        {/* VIRTUALIZED SCROLL CONTAINER */}
        <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* DESKTOP HEADER */}
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
                    {{ asc: <ArrowUpDown size={12} className="text-emerald-500" />, desc: <ArrowUpDown size={12} className="text-emerald-500 rotate-180" /> }[header.column.getIsSorted() as string] ?? null}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div className="p-3 lg:p-0">
            {rows.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <Search size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No animals found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search or category filters.</p>
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualItems.map(virtualRow => {
                  const row = rows[virtualRow.index];
                  return (
                    <div 
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-2 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
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
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {feedModalState.isOpen && feedModalState.animalId && (
        <FeedModal isOpen={feedModalState.isOpen} animalId={feedModalState.animalId} initialData={feedModalState.initialData} selectedDate={activeDate} onClose={() => setFeedModalState({ isOpen: false, animalId: null, initialData: undefined })} />
      )}
      {weightModalState.isOpen && weightModalState.animalId && (
        <WeightModal isOpen={weightModalState.isOpen} animalId={weightModalState.animalId} initialData={weightModalState.initialData} selectedDate={activeDate} onClose={() => setWeightModalState({ isOpen: false, animalId: null, initialData: undefined })} />
      )}
      {tempModalState.isOpen && tempModalState.animal && (
        <TemperatureModal isOpen={tempModalState.isOpen} animalId={tempModalState.animal.id} ambientOnly={tempModalState.animal.ambient_temp_only || false} initialData={tempModalState.initialData} selectedDate={activeDate} onClose={() => setTempModalState({ isOpen: false, animal: null, initialData: undefined })} />
      )}
      {mistModalState.isOpen && mistModalState.animal && (
        <DailyLogFormModal 
          isOpen={mistModalState.isOpen} 
          animal={mistModalState.animal} 
          mode="MISTING" 
          initialLogData={mistModalState.initialData} 
          onClose={() => setMistModalState({ isOpen: false, animal: null, initialData: undefined })} 
        />
      )}
    </div>
  );
}

export default HusbandryLogs;
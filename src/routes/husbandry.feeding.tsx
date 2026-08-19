import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Trash2, Loader2, Utensils, Calendar as CalIcon, Filter, Search } from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Animal, FeedingSchedule as FeedingScheduleType } from '../types';
import { feedingService } from '../services/feedingService';
import { FeedingScheduleModal } from '../components/husbandry/FeedingScheduleModal';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const getAnimalsOptions = () => queryOptions({
  queryKey: ['animals', 'dashboard'],
  queryFn: async () => {
    const { data, error } = await supabase.from('animals').select('*').eq('archived', false);
    if (error) throw error;
    return data as Animal[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const getSchedulesOptions = () => queryOptions({
  queryKey: ['feeding_schedules'],
  queryFn: async () => {
    const maxDateStr = format(addDays(new Date(), 360), 'yyyy-MM-dd');
    const { data, error } = await supabase
      .from('feeding_schedules')
      .select('*')
      .eq('is_deleted', false)
      .lte('scheduled_date', maxDateStr);
    if (error) throw error;
    return data as FeedingScheduleType[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/husbandry/feeding')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      await Promise.all([
        queryClient.ensureQueryData(getAnimalsOptions()),
        queryClient.ensureQueryData(getSchedulesOptions())
      ]);
    }
  },
  component: FeedingSchedulePage,
});

const getLocalDateString = () => format(new Date(), 'yyyy-MM-dd');

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
export function FeedingSchedulePage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  
  const [activeTab, setActiveTab] = useState<string>('EXOTIC');
  const categories = ['OWL', 'RAPTOR', 'MAMMAL', 'EXOTIC'];

  const [filterAnimalId, setFilterAnimalId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewLayout, setViewLayout] = useState<'individual' | 'grouped'>('individual');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  useEffect(() => {
    const channel = supabase
      .channel('feeding-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feeding_schedules' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: animals = [], isLoading: loadingAnimals } = useQuery(getAnimalsOptions());
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery(getSchedulesOptions());

  const deleteSingleMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      if (!user?.id) throw new Error('Unauthorized');
      await feedingService.deleteSchedule(scheduleId, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      toast.success('Schedule deleted.');
    },
    onError: (err: any) => {
      toast.error(`Deletion failed: ${err.message}`);
    }
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (scheduleIds: string[]) => {
      if (!user?.id) throw new Error('Unauthorized');
      await Promise.all(scheduleIds.map(id => feedingService.deleteSchedule(id, user.id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      toast.success('Schedules deleted.');
    },
    onError: (err: any) => {
      toast.error(`Group deletion failed: ${err.message}`);
    }
  });

  const upcomingSchedules = useMemo(() => 
    [...schedules].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
  [schedules]);

  const displayedSchedules = useMemo(() => {
    let filtered = upcomingSchedules.filter(s => {
      const animal = animals.find(a => a.id === s.animal_id);
      return (animal?.category || '').toUpperCase() === activeTab;
    });

    if (filterAnimalId !== 'ALL') {
      filtered = filtered.filter(s => s.animal_id === filterAnimalId);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => {
        const animal = animals.find(a => a.id === s.animal_id);
        const matchName = animal?.name?.toLowerCase().includes(q);
        const matchSpecies = animal?.species?.toLowerCase().includes(q);
        const matchFood = s.food_type?.toLowerCase().includes(q);
        return matchName || matchSpecies || matchFood;
      });
    }
    return filtered;
  }, [upcomingSchedules, filterAnimalId, searchQuery, animals, activeTab]);

  const groupedSchedules = useMemo(() => {
    const groups = new Map();
    displayedSchedules.forEach(schedule => {
      const isNotRequired = schedule.notes === 'FAST DAY / NOT REQUIRED';
      const supplementKey = schedule.supplements || 'none';
      const key = `${schedule.animal_id}_${schedule.food_type}_${schedule.quantity}_${supplementKey}_${isNotRequired}`;
      
      if (!groups.has(key)) {
        groups.set(key, { 
          ...schedule, count: 1, end_date: schedule.scheduled_date, start_date: schedule.scheduled_date, child_ids: [schedule.id],
          feed_not_required: isNotRequired
        });
      } else {
        const existing = groups.get(key);
        existing.count += 1;
        if (schedule.scheduled_date > existing.end_date) existing.end_date = schedule.scheduled_date;
        if (schedule.scheduled_date < existing.start_date) existing.start_date = schedule.scheduled_date;
        existing.child_ids.push(schedule.id);
      }
    });
    return Array.from(groups.values());
  }, [displayedSchedules]);

  const activeList = viewLayout === 'individual' ? displayedSchedules : groupedSchedules;

  const rowVirtualizer = useVirtualizer({
    count: activeList.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 120 : 64, // Dynamic estimation eliminates blank spaces
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  // Responsive CSS Grid 
  const tableGridCols = "minmax(140px, 1.2fr) minmax(180px, 1.5fr) minmax(250px, 2fr) minmax(80px, 0.5fr)";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: THE HEADER RIBBON --- */}
      <div className="flex justify-between items-center w-full mb-1 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight">Feeding Schedules</h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-medium">Dietary management & kitchen prep routines</p>
        </div>
        
        {/* Tier 2 RBAC: Write Action Gate */}
        {hasPermission('husbandry:write') && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={16} className="text-emerald-400" />
            <span>Add Schedule</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: THE CONTROL DECK (Search + Animal Dropdown + Toggles) --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        {/* Real-time Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input 
            type="text" 
            placeholder="Search animal, diet item, or species..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        {/* Animal Dropdown Filter */}
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm shrink-0 w-full sm:w-auto">
          <Filter size={14} className="text-slate-400 shrink-0" />
          <select 
            value={filterAnimalId} 
            onChange={(e) => setFilterAnimalId(e.target.value)}
            className="bg-transparent text-[10px] lg:text-xs font-bold text-slate-700 uppercase tracking-wider border-none focus:ring-0 cursor-pointer outline-none py-0.5 pr-2 w-full sm:w-48 truncate"
          >
            <option value="ALL">All Animals ({animals.length})</option>
            {animals.filter(a => (a.category || '').toUpperCase() === activeTab).map(a => (
              <option key={a.id} value={a.id!}>{a.name} ({a.species})</option>
            ))}
          </select>
        </div>

        {/* View Layout Toggles */}
        <div className="bg-slate-200/60 p-1 rounded-xl flex border border-slate-200/80 shrink-0 w-full sm:w-auto">
          <button onClick={() => setViewLayout('individual')} className={`flex-1 sm:flex-none px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewLayout === 'individual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Individual</button>
          <button onClick={() => setViewLayout('grouped')} className={`flex-1 sm:flex-none px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewLayout === 'grouped' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Grouped</button>
        </div>
      </div>

      {/* --- BLOCK C: THE CATEGORY TABS --- */}
      <div className="grid grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => { setActiveTab(cat); setFilterAnimalId('ALL'); }}
            className={`px-1 lg:px-6 py-2 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
              activeTab === cat 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* --- MAIN DATA VIEW (CSS Grid Matrix & Chameleon Cards) --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 relative overflow-hidden mt-1">
        
        <div className="p-4 bg-slate-50/80 border-b border-slate-100 flex justify-between items-center">
          <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
            <Utensils size={14} className="text-emerald-600"/> Active Kitchen Diets ({activeList.length})
          </h4>
        </div>

        <div ref={scrollParentRef} className="flex-1 overflow-x-auto overflow-y-auto relative custom-scrollbar w-full">
          {loadingSchedules && (
            <div className="absolute inset-0 z-20 bg-white/60 backdrop-blur-sm flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 bg-white p-4 rounded-2xl shadow-xl border border-slate-100">
                <Loader2 className="animate-spin text-emerald-600 w-8 h-8" />
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Syncing Kitchen Schedules...</span>
              </div>
            </div>
          )}

          <div className="min-w-[300px] lg:min-w-[800px] w-full">
            {/* CSS GRID HEADER (Desktop Only) */}
            <div className="hidden lg:grid border-b border-slate-200 bg-slate-50/80 text-[9px] lg:text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
              <div className="px-5 py-4 flex items-center justify-start text-left">Date / Window</div>
              <div className="px-5 py-4 flex items-center justify-start text-left">Animal</div>
              <div className="px-5 py-4 flex items-center justify-start text-left">Diet Specifics & Ration</div>
              <div className="px-5 py-4 flex items-center justify-end text-right">Action</div>
            </div>

            {/* BODY */}
            <div className="divide-y divide-slate-100 bg-white">
              {!loadingSchedules && activeList.length === 0 ? (
                <div className="p-16 flex justify-center text-center">
                   <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No active feeding schedules in this view.<br/><span className="text-[10px] mt-1 font-bold">Click 'Add Schedule' above.</span></p>
                </div>
              ) : (
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                  {virtualItems.map((virtualRow) => {
                    const item = activeList[virtualRow.index];
                    
                    if (viewLayout === 'individual') {
                      const schedule = item as FeedingScheduleType;
                      const animal = animals.find(a => a.id === schedule.animal_id);
                      const dateObj = parseISO(schedule.scheduled_date);
                      const isToday = schedule.scheduled_date === getLocalDateString();
                      const isNotRequired = schedule.notes === 'FAST DAY / NOT REQUIRED';

                      return (
                        <div 
                          key={schedule.id} 
                          ref={rowVirtualizer.measureElement} 
                          data-index={virtualRow.index} 
                          className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border-b border-slate-100 hover:bg-slate-50 transition-colors group p-3 lg:p-0"
                          style={{ gridTemplateColumns: isMobile ? '1fr' : tableGridCols, transform: `translateY(${virtualRow.start}px)` }}
                        >
                          {/* Date */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col mb-2' : 'items-center justify-start'}`}>
                            {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date</div>}
                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest w-fit ${isToday ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                              <CalIcon size={12}/> {format(dateObj, 'd MMM yyyy')}
                            </div>
                          </div>

                          {/* Animal */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col mb-2' : 'items-center justify-start'}`}>
                            {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Animal</div>}
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 uppercase tracking-tight truncate">{animal?.name || 'Unknown'}</p>
                              <span className="text-[10px] text-slate-400 font-bold block truncate">{animal?.species}</span>
                            </div>
                          </div>

                          {/* Diet */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col mb-3' : 'items-center justify-start'}`}>
                            {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Diet Specifics</div>}
                            <div className="w-full">
                            {isNotRequired ? (
                              <span className="inline-block px-2.5 py-1 rounded bg-rose-50 border border-rose-100 text-[10px] lg:text-xs font-black text-rose-600 uppercase tracking-widest">FAST DAY • NOT REQUIRED</span>
                            ) : (
                              <div>
                                <p className="text-[11px] lg:text-xs font-black text-emerald-700 uppercase tracking-widest">{schedule.quantity}x {schedule.food_type}</p>
                                {schedule.supplements && <span className="inline-block mt-1 px-2 py-0.5 rounded text-[9px] bg-amber-50 border border-amber-200 text-amber-800 font-bold uppercase tracking-widest">+ {schedule.supplements}</span>}
                              </div>
                            )}
                            </div>
                          </div>

                          {/* Action */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'justify-end' : 'items-center justify-end'}`}>
                            {hasPermission('husbandry:delete') && (
                              <button
                                onClick={() => deleteSingleMutation.mutate(schedule.id!)}
                                disabled={deleteSingleMutation.isPending}
                                className={`p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50 ${isMobile ? '' : 'opacity-0 group-hover:opacity-100'}`}
                                title="Delete Schedule"
                              >
                                {deleteSingleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    } else {
                      const group = item as any;
                      const animal = animals.find(a => a.id === group.animal_id);
                      const startDateObj = parseISO(group.start_date);
                      const endDateObj = parseISO(group.end_date);

                      return (
                        <div 
                          key={virtualRow.index} 
                          ref={rowVirtualizer.measureElement} 
                          data-index={virtualRow.index} 
                          className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border-b border-slate-100 hover:bg-slate-50 transition-colors group p-3 lg:p-0"
                          style={{ gridTemplateColumns: isMobile ? '1fr' : tableGridCols, transform: `translateY(${virtualRow.start}px)` }}
                        >
                          {/* Date */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col mb-2' : 'items-center justify-start'}`}>
                            {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date Window</div>}
                            <div className="flex flex-col gap-1 w-fit">
                              <span className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest">
                                From: {format(startDateObj, 'd MMM')}
                              </span>
                              {group.count > 1 && (
                                <span className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest">
                                  Until: {format(endDateObj, 'd MMM')}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Animal */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col mb-2' : 'items-center justify-start'}`}>
                            {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Animal</div>}
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 uppercase tracking-tight truncate">{animal?.name || 'Unknown'}</p>
                              <span className="text-[10px] text-slate-400 font-bold block truncate">{animal?.species}</span>
                            </div>
                          </div>

                          {/* Diet */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'flex-col mb-3' : 'items-center justify-start'}`}>
                            {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Diet Specifics</div>}
                            <div className="w-full">
                            {group.feed_not_required ? (
                              <span className="inline-block px-2.5 py-1 rounded bg-rose-50 border border-rose-100 text-[10px] lg:text-xs font-black text-rose-600 uppercase tracking-widest">FAST DAY • NOT REQUIRED ({group.count} days)</span>
                            ) : (
                              <div>
                                <p className="text-[11px] lg:text-xs font-black text-emerald-700 uppercase tracking-widest">
                                  {group.quantity}x {group.food_type} <span className="text-slate-400 font-medium">({group.count} feeds)</span>
                                </p>
                                {group.supplements && <span className="inline-block mt-1 px-2 py-0.5 rounded text-[9px] bg-amber-50 border border-amber-200 text-amber-800 font-bold uppercase tracking-widest">+ {group.supplements}</span>}
                              </div>
                            )}
                            </div>
                          </div>

                          {/* Action */}
                          <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'justify-end' : 'items-center justify-end'}`}>
                            {hasPermission('husbandry:delete') && (
                              <button
                                onClick={() => deleteGroupMutation.mutate(group.child_ids)}
                                disabled={deleteGroupMutation.isPending}
                                className={`p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50 ${isMobile ? '' : 'opacity-0 group-hover:opacity-100'}`}
                                title="Delete entire interval group"
                              >
                                {deleteGroupMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Standalone Schedule Modal Component */}
      <FeedingScheduleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        activeCategory={activeTab}
      />

    </div>
  );
}

export default FeedingSchedulePage;
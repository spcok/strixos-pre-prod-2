import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual'; 
import { 
  CheckCircle2, AlertCircle, Droplets, Lock, HeartPulse, 
  ChevronLeft, ChevronRight, Loader2, Edit3, X, Save, Search, Users, User, ChevronDown
} from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { dailyRoundsService } from '../services/dailyRoundsService';
import { Animal, DailyRound } from '../types';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const getAnimalsOptions = () => queryOptions({
  queryKey: ['animals', 'dashboard'],
  queryFn: async () => {
    const { data, error } = await supabase.from('animals').select('*').order('name');
    if (error) throw error;
    return data as Animal[];
  },
  staleTime: 0,
  gcTime: 1209600000,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const getRoundsOptions = (date: string, shift: 'MORNING' | 'AFTERNOON') => queryOptions({
  queryKey: ['rounds', date, shift],
  queryFn: () => dailyRoundsService.getRoundsByDateAndShift(date, shift),
  staleTime: 0,
  gcTime: 1209600000,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE DEFINITION
// ------------------------------------------------------------------
export const Route = createFileRoute('/husbandry/rounds')({
  loader: async ({ context: { queryClient } }) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const shift = new Date().getHours() < 12 ? 'MORNING' : 'AFTERNOON';
    
    queryClient.prefetchQuery(getAnimalsOptions());
    queryClient.prefetchQuery(getRoundsOptions(today, shift));
  },
  component: DailyRounds
});

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768); 
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  return isMobile;
}

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
function DailyRounds() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  
  // -- Local State --
  const [activeDate, setActiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [inputDate, setInputDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [activeShift, setActiveShift] = useState<'MORNING' | 'AFTERNOON'>(
    new Date().getHours() < 12 ? 'MORNING' : 'AFTERNOON'
  );
  
  // -- Unified Control Deck State --
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [draftRounds, setDraftRounds] = useState<Record<string, Partial<DailyRound>>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<{type: 'success' | 'error', message: string} | null>(null);
  
  // -- Modal State --
  const [noteModalState, setNoteModalState] = useState<{
    isOpen: boolean;
    animal: Animal | null;
    round: DailyRound | null;
    currentNote: string;
  }>({
    isOpen: false,
    animal: null,
    round: null,
    currentNote: ''
  });

  const parentRef = useRef<HTMLDivElement>(null);

  const { data: animals = [], isLoading: loadingAnimals } = useQuery(getAnimalsOptions());
  const { data: rounds = [], isLoading: loadingRounds } = useQuery(getRoundsOptions(activeDate, activeShift));

  const isLoading = loadingAnimals || loadingRounds;

  const categories = useMemo(() => Array.from(new Set(animals.map(a => a.category).filter(Boolean))).sort(), [animals]);
  const tabs = ['ALL', ...categories];

  const displayAnimals = useMemo(() => {
    let filtered = animals.filter(a => a.status !== 'ARCHIVED');
    if (activeTab !== 'ALL') {
      filtered = filtered.filter(a => a.category === activeTab);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a => 
        a.name.toLowerCase().includes(q) || 
        a.species?.toLowerCase().includes(q) ||
        a.ring_number?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [animals, activeTab, searchQuery]);

  // ==========================================
  // BULLETPROOF DYNAMIC VIRTUALIZER
  // ==========================================
  const virtualizer = useVirtualizer({
    count: displayAnimals.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => isMobile ? 110 : 70, 
    overscan: 5,
  });

  useEffect(() => {
    const channel = supabase.channel('rounds_sync')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'daily_rounds',
        filter: `date=eq.${activeDate}` // 🚨 SCHEMA FIX: Corrected from record_date to date
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['rounds', activeDate, activeShift] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeDate, activeShift, queryClient]);

  const handleDateChange = (newDate: string) => {
    setActiveDate(newDate);
    setInputDate(newDate);
    setDraftRounds({});
    setHasUnsavedChanges(false);
    setSubmissionStatus(null);
  };

  const shiftDate = (days: number) => {
    const newDate = format(addDays(parseISO(activeDate), days), 'yyyy-MM-dd');
    handleDateChange(newDate);
  };

  const handleToggle = (animalId: string, field: keyof DailyRound) => {
    setDraftRounds(prev => {
      const existingDraft = prev[animalId];
      const dbRound = rounds.find(r => r.animal_id === animalId);
      
      const currentState = existingDraft?.[field] !== undefined 
        ? existingDraft[field] 
        : (dbRound?.[field] ?? (field === 'is_alive' ? true : false));

      const newState = !currentState;

      return {
        ...prev,
        [animalId]: {
          ...prev[animalId],
          animal_id: animalId,
          [field]: newState
        }
      };
    });
    setHasUnsavedChanges(true);
    setSubmissionStatus(null);
  };

  const handleSubmit = async () => {
    if (!user) return setSubmissionStatus({ type: 'error', message: 'You must be logged in to submit rounds.' });

    try {
      setIsSubmitting(true);
      setSubmissionStatus(null);

      const roundsToSubmit: Partial<DailyRound>[] = Object.values(draftRounds).map(draft => {
        const dbRound = rounds.find(r => r.animal_id === draft.animal_id);
        const isEdit = !!dbRound?.id;
        
        return {
          id: dbRound?.id,
          animal_id: draft.animal_id,
          date: activeDate,             // 🚨 SCHEMA FIX: Corrected from record_date to date
          shift: activeShift,
          is_alive: draft.is_alive !== undefined ? draft.is_alive : (dbRound?.is_alive ?? true),
          water_checked: draft.water_checked !== undefined ? draft.water_checked : (dbRound?.water_checked ?? false),
          locks_secured: draft.locks_secured !== undefined ? draft.locks_secured : (dbRound?.locks_secured ?? false),
          animal_issue_note: draft.animal_issue_note !== undefined ? draft.animal_issue_note : dbRound?.animal_issue_note,
          
          status: 'COMPLETED',          // 🚨 SCHEMA FIX: Status is NOT NULL
          completed_by: user.id,        // 🚨 SCHEMA FIX: Mapped to completed_by
          created_by: isEdit ? dbRound.created_by : user.id,
          modified_by: isEdit ? user.id : null,
        };
      });

      await dailyRoundsService.bulkUpsertRounds(roundsToSubmit);
      
      setDraftRounds({});
      setHasUnsavedChanges(false);
      setSubmissionStatus({ type: 'success', message: 'Rounds successfully saved.' });
      
    } catch (error) {
      console.error("Error submitting rounds:", error);
      setSubmissionStatus({ type: 'error', message: 'Failed to save rounds. They will sync when online.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // 🚨 LAYOUT FIX: Removed max-w constraints. It now expands fluidly into __root.tsx's space
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-500 w-full">
      
      {/* Block A: Header Ribbon */}
      <div className="flex justify-between items-center w-full mb-1 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight">Daily Rounds</h1>
        </div>
      </div>

      {/* Block B: Control Deck */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search animals..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 sm:ml-auto w-full sm:w-auto">
          <div className="flex items-center justify-between bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full sm:w-auto shrink-0">
            <button onClick={() => shiftDate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95"><ChevronLeft size={16} /></button>
            <div className="flex-1 sm:flex-none relative flex justify-center border-l border-r border-slate-100 px-2 min-w-[120px]">
              <input 
                type="date" 
                value={inputDate}
                onChange={(e) => setInputDate(e.target.value)}
                onBlur={(e) => handleDateChange(e.target.value)}
                className="text-[10px] lg:text-xs font-black text-slate-700 uppercase tracking-widest bg-transparent border-none focus:ring-0 text-center py-1 cursor-pointer w-full"
              />
            </div>
            <button onClick={() => shiftDate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95"><ChevronRight size={16} /></button>
          </div>

          <div className="flex bg-slate-200/50 p-1 rounded-xl w-full sm:w-auto shrink-0">
            <button
              onClick={() => setActiveShift('MORNING')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all ${
                activeShift === 'MORNING' 
                  ? 'bg-white text-emerald-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              AM Shift
            </button>
            <button
              onClick={() => setActiveShift('AFTERNOON')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all ${
                activeShift === 'AFTERNOON' 
                  ? 'bg-white text-emerald-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              PM Shift
            </button>
          </div>
        </div>
      </div>

      {/* Block C: Category Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden min-h-0">
        <div className="flex border-b border-slate-100 bg-slate-50 shrink-0 overflow-x-auto custom-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 lg:px-6 py-3 lg:py-4 text-[10px] lg:text-[11px] font-black uppercase tracking-widest transition-all border-b-2 whitespace-nowrap ${
                activeTab === tab ? 'border-emerald-500 text-emerald-600 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-100/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Block D: Data List */}
        <div className="flex-1 overflow-hidden relative bg-white">
          
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <Loader2 className="animate-spin text-emerald-500 mb-4" size={32} />
              <p className="text-slate-500 font-medium animate-pulse text-sm">Syncing offline queue...</p>
            </div>
          )}

          <div ref={parentRef} className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar">
            
            {displayAnimals.length === 0 && !isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
                <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center mb-4 border border-slate-200">
                  <Search size={24} className="text-slate-400" />
                </div>
                <p className="font-bold text-slate-700 mb-1">No collections found</p>
                <p className="text-xs">Adjust your search or filters.</p>
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const animal = displayAnimals[virtualItem.index];
                  const dbRound = rounds.find(r => r.animal_id === animal.id);
                  const draft = draftRounds[animal.id];
                  const mergedRound = draft ? { ...dbRound, ...draft } : dbRound;

                  const isGroup = animal.record_type === 'GROUP';
                  const isAlive = mergedRound?.is_alive !== undefined ? mergedRound.is_alive : true;
                  const waterChecked = mergedRound?.water_checked !== undefined ? mergedRound.water_checked : false;
                  const locksSecured = mergedRound?.locks_secured !== undefined ? mergedRound.locks_secured : false;
                  const hasNote = !!mergedRound?.animal_issue_note;

                  return (
                    <div
                      key={animal.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      className="absolute top-0 left-0 w-full border-b border-slate-100 hover:bg-slate-50/50 transition-colors box-border"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <div className="w-full px-4 py-2 lg:py-2.5 flex flex-col lg:flex-row gap-3 lg:gap-4 lg:items-center">
                        
                        {/* UNIFIED IDENTITY BLOCK (Scaled to match Dashboard) */}
                        <div className="flex items-center gap-1.5 lg:gap-3 w-full lg:w-[35%] shrink-0 min-w-0">
                          <div className="relative shrink-0">
                            {animal.profile_image_url ? (
                              <img src={animal.profile_image_url} className="w-8 h-8 lg:w-10 lg:h-10 rounded-full object-cover shrink-0 shadow-sm border border-slate-200 mt-0.5" alt="" />
                            ) : (
                              <div className={`p-2 lg:p-2.5 rounded-full shrink-0 shadow-sm mt-0.5 ${isGroup ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                                {isGroup ? <Users size={14} className="lg:w-4 lg:h-4" /> : <User size={14} className="lg:w-4 lg:h-4" />}
                              </div>
                            )}
                            {isGroup && (
                              <div className="absolute -bottom-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 bg-blue-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                <Users size={8} className="text-white" />
                              </div>
                            )}
                          </div>
                          
                          <div className="flex flex-col min-w-0 flex-1 ml-2 lg:ml-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-[11px] md:text-[12px] lg:text-[13px] truncate">{animal.name}</span>
                              {hasNote && <AlertCircle size={12} className="text-amber-500 shrink-0 lg:w-3.5 lg:h-3.5" />}
                            </div>
                            <div className="flex items-center gap-1.5 text-[9px] md:text-[10px] lg:text-[11px] text-slate-500 truncate mt-0.5">
                              {animal.ring_number && <span className="font-black text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
                              {animal.ring_number && animal.species && <span>•</span>}
                              {animal.species && <span className="italic truncate" title={animal.species}>{animal.species}</span>}
                            </div>
                          </div>
                        </div>

                        {/* PROPORTIONAL ACTIONS BLOCK */}
                        <div className="grid grid-cols-2 lg:flex lg:flex-row flex-1 gap-2 lg:gap-3 lg:justify-end">
                          <button
                            onClick={() => handleToggle(animal.id, 'is_alive')}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all lg:w-[130px] ${
                              isAlive 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                                : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            }`}
                          >
                            {isAlive ? <HeartPulse size={12} className="shrink-0 lg:w-3.5 lg:h-3.5" /> : <AlertCircle size={12} className="shrink-0 lg:w-3.5 lg:h-3.5" />}
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{isAlive ? 'Visual: OK' : 'Visual: ISSUE'}</span>
                          </button>

                          <button
                            onClick={() => handleToggle(animal.id, 'water_checked')}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all lg:w-[130px] ${
                              waterChecked 
                                ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' 
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Droplets size={12} className={`shrink-0 lg:w-3.5 lg:h-3.5 ${!waterChecked ? 'text-slate-400' : ''}`} />
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{waterChecked ? 'Water: OK' : 'Check Water'}</span>
                          </button>

                          <button
                            onClick={() => handleToggle(animal.id, 'locks_secured')}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all lg:w-[130px] ${
                              locksSecured 
                                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' 
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Lock size={12} className={`shrink-0 lg:w-3.5 lg:h-3.5 ${!locksSecured ? 'text-slate-400' : ''}`} />
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{locksSecured ? 'Locks: OK' : 'Check Locks'}</span>
                          </button>

                          <button
                            onClick={() => setNoteModalState({ isOpen: true, animal, round: mergedRound as DailyRound, currentNote: mergedRound?.animal_issue_note || '' })}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all lg:w-[120px] ${
                              hasNote 
                                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' 
                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {hasNote ? <AlertCircle size={12} className="shrink-0 lg:w-3.5 lg:h-3.5" /> : <Edit3 size={12} className="shrink-0 lg:w-3.5 lg:h-3.5 text-slate-400" />}
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{hasNote ? 'Note Logged' : 'Add Note'}</span>
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* --- FIXED BOTTOM SUBMIT BAR --- */}
          <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur p-3 md:p-4 flex items-center justify-between z-20 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
            <div className="flex-1 min-w-0 pr-4">
               {hasUnsavedChanges ? (
                 <div className="flex items-center gap-2 text-amber-600">
                   <AlertCircle size={16} className="shrink-0" />
                   <span className="text-[10px] md:text-xs font-bold truncate">Unsaved checks detected</span>
                 </div>
               ) : submissionStatus ? (
                 <div className={`flex items-center gap-2 ${submissionStatus.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                   <CheckCircle2 size={16} className="shrink-0" />
                   <span className="text-[10px] md:text-xs font-bold truncate">{submissionStatus.message}</span>
                 </div>
               ) : (
                 <span className="text-[10px] md:text-xs text-slate-500 truncate block">All checks synced to database.</span>
               )}
            </div>
            
            <button
              onClick={handleSubmit}
              disabled={!hasUnsavedChanges || isSubmitting}
              className={`px-6 py-2.5 lg:py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shrink-0 shadow-sm ${
                hasUnsavedChanges && !isSubmitting
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white hover:shadow-md active:scale-95'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Submit Rounds
            </button>
          </div>
        </div>
      </div>

      {/* --- NOTE MODAL --- */}
      {noteModalState.isOpen && noteModalState.animal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl border border-slate-100 flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="font-bold text-slate-900 text-sm tracking-tight">{noteModalState.animal.name}</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">Round Issue Note</p>
              </div>
              <button 
                onClick={() => setNoteModalState({ isOpen: false, animal: null, round: null, currentNote: '' })}
                className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4">
              <textarea
                value={noteModalState.currentNote}
                onChange={(e) => setNoteModalState(prev => ({ ...prev, currentNote: e.target.value }))}
                placeholder="Enter details about broken locks, empty water, or animal condition..."
                className="w-full h-32 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none resize-none shadow-inner"
              />
            </div>
            
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-2">
              <button
                onClick={() => setNoteModalState({ isOpen: false, animal: null, round: null, currentNote: '' })}
                className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-widest rounded-xl transition-colors shadow-sm active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const animalId = noteModalState.animal!.id;
                  const trimmed = noteModalState.currentNote.trim();
                  
                  setDraftRounds(prev => {
                    const existingDraft = prev[animalId];
                    const dbRound = rounds.find(r => r.animal_id === animalId);
                    const merged = existingDraft ? { ...dbRound, ...existingDraft } : dbRound;

                    return {
                      ...prev,
                      [animalId]: {
                        ...prev[animalId],
                        animal_id: animalId,
                        is_alive: merged?.is_alive !== undefined ? merged.is_alive : true,
                        water_checked: merged?.water_checked !== undefined ? merged.water_checked : false,
                        locks_secured: merged?.locks_secured !== undefined ? merged.locks_secured : false,
                        animal_issue_note: trimmed
                      }
                    };
                  });
                  setHasUnsavedChanges(true);
                  setSubmissionStatus(null);
                  setNoteModalState({ isOpen: false, animal: null, round: null, currentNote: '' });
                }}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-95"
              >
                <Save size={16} />
                Save Draft Note
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
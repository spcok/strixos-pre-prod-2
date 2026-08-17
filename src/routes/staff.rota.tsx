import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Calendar as CalendarIcon, Loader2, ChevronLeft, ChevronRight, Search, Plus, Umbrella, Trash2, Clock, MapPin } from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, parseISO } from 'date-fns';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { rotaService } from '../services/rotaService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const getRotaOptions = (start: string, end: string) => queryOptions({
  queryKey: ['rota_matrix', start, end],
  queryFn: () => rotaService.getRotaData(start, end),
  staleTime: 1000 * 60 * 15,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION (Pre-fetching)
// ------------------------------------------------------------------
export const Route = createFileRoute('/staff/rota')({
  loader: async ({ context: { queryClient } }) => {
    const today = new Date();
    const start = startOfWeek(today, { weekStartsOn: 1 });
    const end = endOfWeek(today, { weekStartsOn: 1 });
    const queryBufferStart = format(addDays(start, -14), 'yyyy-MM-dd');
    const queryBufferEnd = format(addDays(end, 14), 'yyyy-MM-dd');
    
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(getRotaOptions(queryBufferStart, queryBufferEnd));
  },
  component: RotaPage,
});

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
export function RotaPage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const isManager = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.role === 'HR';

  const [view, setView] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [baseDate, setBaseDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [modalState, setModalState] = useState<'NONE' | 'SHIFT' | 'LEAVE'>('NONE');

  const dateRange = useMemo(() => {
    if (view === 'DAILY') return { start: baseDate, end: baseDate };
    if (view === 'WEEKLY') return { start: startOfWeek(baseDate, { weekStartsOn: 1 }), end: endOfWeek(baseDate, { weekStartsOn: 1 }) };
    return { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
  }, [view, baseDate]);

  const matrixDays = useMemo(() => eachDayOfInterval(dateRange), [dateRange]);
  
  const monthlyGridDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(baseDate), end: endOfMonth(baseDate) });
  }, [baseDate]);

  const queryBufferStart = format(addDays(dateRange.start, -14), 'yyyy-MM-dd');
  const queryBufferEnd = format(addDays(dateRange.end, 14), 'yyyy-MM-dd');

  // ------------------------------------------------------------------
  // SUPABASE REALTIME CACHE INVALIDATION
  // ------------------------------------------------------------------
  useEffect(() => {
    const shiftsChannel = supabase.channel('shifts-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      }).subscribe();
      
    const leaveChannel = supabase.channel('leave-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      }).subscribe();

    return () => {
      supabase.removeChannel(shiftsChannel);
      supabase.removeChannel(leaveChannel);
    };
  }, [queryClient]);

  const { data, isLoading } = useQuery(getRotaOptions(queryBufferStart, queryBufferEnd));

  const { shiftMap, leaveMap } = useMemo(() => {
    if (!data) return { shiftMap: {}, leaveMap: {} };
    const sMap: Record<string, any> = {};
    const lMap: Record<string, any> = {};

    data.shifts.forEach((s: any) => {
      const dateKey = s.start_time.split('T')[0];
      sMap[`${s.user_id}_${dateKey}`] = s;
    });

    data.leave.forEach((l: any) => {
      eachDayOfInterval({ start: parseISO(l.start_date), end: parseISO(l.end_date) }).forEach(d => {
        lMap[`${l.user_id}_${format(d, 'yyyy-MM-dd')}`] = l;
      });
    });

    return { shiftMap: sMap, leaveMap: lMap };
  }, [data]);

  const filteredStaff = useMemo(() => {
    if (!data?.staff) return [];
    
    let visibleStaff = data.staff.filter((s: any) => {
      if (!s.is_deleted && s.is_active !== false) return true;
      
      return matrixDays.some(date => {
        const lookupKey = `${s.id}_${format(date, 'yyyy-MM-dd')}`;
        return shiftMap[lookupKey] || leaveMap[lookupKey];
      });
    });

    if (!searchQuery.trim()) return visibleStaff;
    
    const query = searchQuery.toLowerCase();
    return visibleStaff.filter((s: any) => 
      (s.name || '').toLowerCase().includes(query) || 
      (s.role || '').toLowerCase().includes(query)
    );
  }, [data?.staff, searchQuery, matrixDays, shiftMap, leaveMap]);

  const handlePrev = () => {
    if (view === 'DAILY') setBaseDate(addDays(baseDate, -1));
    if (view === 'WEEKLY') setBaseDate(addDays(baseDate, -7));
    if (view === 'MONTHLY') setBaseDate(addDays(startOfMonth(baseDate), -1));
  };

  const handleNext = () => {
    if (view === 'DAILY') setBaseDate(addDays(baseDate, 1));
    if (view === 'WEEKLY') setBaseDate(addDays(baseDate, 7));
    if (view === 'MONTHLY') setBaseDate(addDays(endOfMonth(baseDate), 1));
  };

  // ------------------------------------------------------------------
  // 4. VIRTUALIZER ENGINE (DOM PROTECTION)
  // ------------------------------------------------------------------
  const rowVirtualizer = useVirtualizer({
    count: filteredStaff.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 64, 
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-4 md:space-y-6 pb-20 font-sans">
      
      {/* MOBILE OPTIMIZED HEADER */}
      <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        
        {/* TOP ROW (Mobile): Title & Search */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 w-full xl:w-auto">
          <h1 className="text-lg md:text-xl font-black uppercase tracking-tight flex items-center gap-2 md:gap-3 shrink-0">
            <CalendarIcon className="text-indigo-600 w-5 h-5 md:w-6 md:h-6" /> Staff Rota
          </h1>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Filter by name..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 md:py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm" 
            />
          </div>
        </div>
        
        {/* BOTTOM ROW (Mobile/Tablet): Controls with Flex/Truncate Protection */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 w-full xl:w-auto min-w-0">
          
          {/* Toggles & Dates Container */}
          <div className="flex flex-row items-center gap-2 w-full md:flex-1 justify-between min-w-0">
            
            {/* View Toggles - D/W/M ON TABLET AND MOBILE */}
            <div className="bg-slate-100 p-1 rounded-xl flex shrink-0">
              {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(v => (
                <button 
                  key={v} 
                  onClick={() => setView(v)} 
                  className={`px-3 md:px-4 py-1.5 md:py-1.5 text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${view === v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <span className="lg:hidden">{v.substring(0, 1)}</span>
                  <span className="hidden lg:inline">{v.substring(0, 1) + v.substring(1).toLowerCase()}</span>
                </button>
              ))}
            </div>

            {/* Date Selector */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm flex-1 min-w-0 justify-between">
               <button onClick={handlePrev} className="p-2 md:p-2.5 hover:bg-slate-50 border-r border-slate-200 text-slate-600 shrink-0"><ChevronLeft size={16}/></button>
               <span className="px-1 md:px-2 text-[10px] md:text-[11px] font-black uppercase tracking-widest text-slate-700 truncate min-w-0 flex-1 text-center">
                  {view === 'DAILY' ? format(baseDate, 'dd MMM yyyy') : view === 'WEEKLY' ? `W/C ${format(dateRange.start, 'dd MMM')}` : format(baseDate, 'MMM yyyy')}
               </span>
               <button onClick={handleNext} className="p-2 md:p-2.5 hover:bg-slate-50 border-l border-slate-200 text-slate-600 shrink-0"><ChevronRight size={16}/></button>
            </div>
          </div>

          {/* Action Buttons */}
          {isManager && (
            <div className="grid grid-cols-2 md:flex gap-2 md:pl-3 md:border-l md:border-slate-200 mt-2 md:mt-0 w-full md:w-auto shrink-0">
              <button onClick={() => setModalState('SHIFT')} className="w-full flex items-center justify-center gap-1.5 px-2 md:px-3 py-2.5 md:py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-[9px] md:text-[10px] uppercase tracking-widest rounded-xl transition-all border border-indigo-200 shadow-sm whitespace-nowrap">
                <Plus size={14} /> Add Shift
              </button>
              <button onClick={() => setModalState('LEAVE')} className="w-full flex items-center justify-center gap-1.5 px-2 md:px-3 py-2.5 md:py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-[9px] md:text-[10px] uppercase tracking-widest rounded-xl transition-all border border-rose-200 shadow-sm whitespace-nowrap">
                <Umbrella size={14} /> Absence
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm h-[calc(100vh-16rem)] min-h-[600px] flex flex-col relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
          </div>
        )}
        
        {view === 'MONTHLY' ? (
          <div className="flex-1 flex flex-col bg-slate-50 min-h-0">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-white shadow-sm shrink-0">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="py-2 md:py-3 text-center text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-100 last:border-0">{day}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 flex-1 auto-rows-max overflow-y-auto content-start">
              {monthlyGridDays.map((date, i) => {
                const dateKey = format(date, 'yyyy-MM-dd');
                const isToday = isSameDay(date, new Date());
                
                const workingStaff = filteredStaff.filter(s => shiftMap[`${s.id}_${dateKey}`]);
                const absentStaff = filteredStaff.filter(s => leaveMap[`${s.id}_${dateKey}`]);

                let colStartClass = '';
                if (i === 0) {
                   const jsDay = date.getDay();
                   const cssCol = jsDay === 0 ? 7 : jsDay;
                   const classes = ['col-start-1', 'col-start-2', 'col-start-3', 'col-start-4', 'col-start-5', 'col-start-6', 'col-start-7'];
                   colStartClass = classes[cssCol - 1];
                }

                return (
                  <div key={i} className={`border-r border-b border-slate-200 p-1.5 flex flex-col gap-1 min-h-[100px] bg-white ${colStartClass} ${isToday ? 'ring-2 ring-inset ring-indigo-500 bg-indigo-50/10' : ''}`}>
                    <div className={`text-right text-[10px] font-black ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>
                      {format(date, 'd')}
                    </div>
                    
                    <div className="flex-1 flex flex-wrap content-start gap-1 pr-1">
                      {absentStaff.map(staff => (
                        <div key={staff.id} className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-rose-700 bg-rose-50 border-rose-200" title={`${staff.name} - Absent`}>
                          {staff.name.split(' ')[0]} (Abs)
                        </div>
                      ))}
                      
                      {workingStaff.map(staff => (
                        <div key={staff.id} className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-indigo-700 bg-indigo-50 border-indigo-200 shadow-sm">
                          {staff.name.split(' ')[0]}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Header Row */}
            <div className="flex border-b border-slate-200 bg-slate-50 shadow-sm shrink-0">
              {/* STAFF COLUMN OPTIMIZED WIDTH (md:w-36 instead of w-64) */}
              <div className="w-24 sm:w-28 md:w-36 lg:w-56 p-2 md:p-3 lg:p-4 border-r border-slate-200 flex items-center shrink-0 min-w-0">
                <span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate w-full">Staff Member</span>
              </div>
              <div className="flex-1 flex min-w-0">
                {matrixDays.map(date => {
                  const isToday = isSameDay(date, new Date());
                  return (
                    <div key={date.toString()} className={`flex-1 p-2 md:p-3 text-center border-r border-slate-200 last:border-0 min-w-[70px] ${isToday ? 'bg-indigo-50 border-b-2 border-b-indigo-500' : ''}`}>
                      <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>{format(date, 'EEE')}</p>
                      <p className={`text-xs md:text-sm font-black mt-0.5 ${isToday ? 'text-indigo-900' : 'text-slate-700'}`}>{format(date, 'd MMM')}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Virtualized Matrix Body */}
            <div ref={scrollParentRef} className="flex-1 overflow-auto custom-scrollbar relative">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${paddingTop}px)` }}>
                  {virtualItems.map((virtualRow) => {
                    const staff = filteredStaff[virtualRow.index];
                    return (
                      <div key={staff.id} className="flex border-b border-slate-100 hover:bg-slate-50/50 transition-colors h-16 group" style={{ height: `${virtualRow.size}px` }}>
                        
                        {/* STAFF COLUMN OPTIMIZED WIDTH & TEXT SCALING */}
                        <div className="w-24 sm:w-28 md:w-36 lg:w-56 p-2 md:p-3 lg:p-4 border-r border-slate-200 flex flex-col justify-center bg-white shrink-0 min-w-0">
                           <div className="flex items-center gap-1.5 md:gap-2 min-w-0 w-full">
                             <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${staff.is_active === false ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                             <p className="text-[10px] md:text-xs lg:text-sm font-bold text-slate-900 truncate flex-1 min-w-0">{staff.name}</p>
                           </div>
                           <p className="text-[8px] md:text-[9px] lg:text-[10px] text-slate-400 font-mono mt-0.5 uppercase ml-3 md:ml-3.5 truncate w-full">{staff.role.replace('_', ' ')}</p>
                        </div>
                        
                        {/* Shifts Cells */}
                        <div className="flex-1 flex min-w-0">
                           {matrixDays.map(date => {
                             const dateKey = format(date, 'yyyy-MM-dd');
                             const shift = shiftMap[`${staff.id}_${dateKey}`];
                             const leave = leaveMap[`${staff.id}_${dateKey}`];

                             return (
                               <div key={date.toString()} className="flex-1 border-r border-slate-100 last:border-0 p-1 md:p-1.5 relative group/cell min-w-[70px] flex items-center justify-center">
                                  {leave ? (
                                    <div className="w-full h-full rounded-lg bg-rose-50 border border-rose-200 flex flex-col items-center justify-center p-1 text-center min-w-0">
                                      <span className="text-rose-700 font-black text-[8px] md:text-[9px] uppercase tracking-widest leading-none truncate w-full">{leave.leave_type.substring(0,3)}</span>
                                      <span className="text-rose-400 font-bold text-[7px] md:text-[8px] uppercase leading-none mt-0.5 truncate w-full">{leave.status === 'APPROVED' ? 'Apprv' : leave.status}</span>
                                    </div>
                                  ) : shift ? (
                                  <div className="w-full p-2 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center relative group/cell hover:border-indigo-300 hover:shadow-md transition-all min-w-0">
                                    <span className="text-[10px] font-black text-slate-900 tracking-tight flex items-center justify-center gap-1 truncate w-full">
                                      <Clock size={10} className="text-slate-400 shrink-0" /> <span className="truncate">Working</span>
                                    </span>
                                    {shift.assigned_area && (
                                      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1 w-full flex justify-center items-center gap-1 truncate">
                                        <MapPin size={8} className="shrink-0"/> <span className="truncate">{shift.assigned_area}</span>
                                      </span>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {modalState === 'SHIFT' && <ShiftModal onClose={() => setModalState('NONE')} staff={data?.staff || []} />}
      {modalState === 'LEAVE' && <LeaveModal onClose={() => setModalState('NONE')} staff={data?.staff || []} />}
    </div>
  );
}

// ============================================================================
// MODAL: ADD AD-HOC SHIFT (TANSTACK FORM)
// ============================================================================
function ShiftModal({ onClose, staff }: { onClose: () => void, staff: any[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => rotaService.saveShift(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save shift.')
  });

  const form = useForm({
    defaultValues: {
      user_id: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      start_time: '09:00',
      end_time: '17:00',
      assigned_area: '',
      notes: ''
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync({
        user_id: value.user_id,
        start_time: `${value.date}T${value.start_time}:00Z`,
        end_time: `${value.date}T${value.end_time}:00Z`,
        assigned_area: value.assigned_area,
        notes: value.notes,
        status: 'SCHEDULED'
      });
    }
  });

  const inputClass = "w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-slate-50 p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2"><Clock size={16} className="text-indigo-600"/> Add Ad-Hoc Shift</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900 rounded-lg"><Trash2 size={16}/></button>
        </div>
        
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="p-6 space-y-5">
          {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}
          
          <form.Field name="user_id">
            {(field) => (
              <div>
                <label className={labelClass}>Staff Member</label>
                <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                  <option value="">Select Staff...</option>
                  {/* ENTERPRISE FIX: Prevent assigning new shifts to deleted staff */}
                  {staff
                    .filter((s: any) => !s.is_deleted && s.is_active !== false)
                    .map((s: any) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
                </select>
              </div>
            )}
          </form.Field>

          <form.Field name="date">
            {(field) => (
              <div>
                <label className={labelClass}>Shift Date</label>
                <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )}
          </form.Field>

          {/* Hidden Time Fields since it's only one shift */}
          <div className="hidden">
            <form.Field name="start_time">
              {(field) => (
                <input type="hidden" value={field.state.value} />
              )}
            </form.Field>
            <form.Field name="end_time">
              {(field) => (
                 <input type="hidden" value={field.state.value} />
              )}
            </form.Field>
          </div>

          <form.Field name="assigned_area">
            {(field) => (
              <div>
                <label className={labelClass}>Assigned Area (Optional)</label>
                <input type="text" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. Birds of Prey Section" className={inputClass} />
              </div>
            )}
          </form.Field>

          <form.Field name="notes">
            {(field) => (
              <div>
                <label className={labelClass}>Shift Notes (Optional)</label>
                <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none`} placeholder="Specific instructions for this shift..." />
              </div>
            )}
          </form.Field>

          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-5 py-2 text-xs font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-100 rounded-xl">Cancel</button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <button type="submit" disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} className="px-6 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-500 disabled:opacity-50 shadow-sm flex items-center gap-2">
                  {(isSubmitting || saveMutation.isPending) && <Loader2 size={14} className="animate-spin"/>} Save Shift
                </button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// MODAL: LOG ABSENCE (TANSTACK FORM)
// ============================================================================
function LeaveModal({ onClose, staff }: { onClose: () => void, staff: any[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => rotaService.saveLeave(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save absence.')
  });

  const form = useForm({
    defaultValues: {
      user_id: '',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
      leave_type: 'ANNUAL_LEAVE',
      reason: ''
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync({
        user_id: value.user_id,
        start_date: value.start_date,
        end_date: value.end_date,
        leave_type: value.leave_type,
        reason: value.reason,
        status: 'APPROVED'
      });
    }
  });

  const inputClass = "w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all shadow-sm";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-slate-50 p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2"><Umbrella size={16} className="text-rose-600"/> Log Absence</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900 rounded-lg"><Trash2 size={16}/></button>
        </div>
        
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="p-6 space-y-5">
          {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}
          
          <form.Field name="user_id">
            {(field) => (
              <div>
                <label className={labelClass}>Staff Member</label>
                <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                  <option value="">Select Staff...</option>
                  {/* ENTERPRISE FIX: Prevent assigning new leave to deleted staff */}
                  {staff
                    .filter((s: any) => !s.is_deleted && s.is_active !== false)
                    .map((s: any) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
                </select>
              </div>
            )}
          </form.Field>

          <div className="grid grid-cols-2 gap-4">
            <form.Field name="start_date">
              {(field) => (
                <div>
                  <label className={labelClass}>Start Date</label>
                  <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )}
            </form.Field>
            <form.Field name="end_date">
              {(field) => (
                <div>
                  <label className={labelClass}>End Date</label>
                  <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )}
            </form.Field>
          </div>

          <form.Field name="leave_type">
            {(field) => (
              <div>
                <label className={labelClass}>Absence Type</label>
                <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                  <option value="ANNUAL_LEAVE">Annual Leave (Holiday)</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="UNPAID">Unpaid Leave</option>
                  <option value="TRAINING">External Training</option>
                </select>
              </div>
            )}
          </form.Field>

          <form.Field name="reason">
            {(field) => (
              <div>
                <label className={labelClass}>Reason / Notes</label>
                <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none`} placeholder="Optional notes..." />
              </div>
            )}
          </form.Field>

          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-5 py-2 text-xs font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-100 rounded-xl">Cancel</button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <button type="submit" disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} className="px-6 py-2 bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-rose-500 disabled:opacity-50 shadow-sm flex items-center gap-2">
                  {(isSubmitting || saveMutation.isPending) && <Loader2 size={14} className="animate-spin"/>} Save Absence
                </button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </div>
  );
}
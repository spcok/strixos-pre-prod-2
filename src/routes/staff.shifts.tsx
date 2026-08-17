import React, { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

export const Route = createFileRoute('/staff/shifts')({
  component: ShiftsModule,
});

export function ShiftsModule() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'INDIVIDUAL' | 'GROUPED'>('INDIVIDUAL');
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  
  // In-app confirmation states to bypass iframe dialog blocking
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmWipeId, setConfirmWipeId] = useState<string | null>(null);
  const [confirmGlobalWipe, setConfirmGlobalWipe] = useState(false);

  // ------------------------------------------------------------------
  // 1. DATA FETCHING (Online-First with 14-Day Offline Failover)
  // ------------------------------------------------------------------
  const { data: shifts = [], isLoading: loadingShifts } = useQuery({
    queryKey: ['shifts_data'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*, users:user_id(id, name, role)')
        .order('start_time', { ascending: true });
      
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst'
  });

  const { data: staffMembers = [] } = useQuery({
    queryKey: ['staff_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, role')
        .order('name');
      
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst'
  });

  // ------------------------------------------------------------------
  // 2. HARD DELETION MUTATIONS (With Exact Count Tracing)
  // ------------------------------------------------------------------
  const deleteIndividualShift = useMutation({
    mutationFn: async (shiftId: string) => {
      const { error, count } = await supabase
        .from('shifts')
        .delete({ count: 'exact' })
        .eq('id', shiftId);

      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("0 rows deleted. The record may not exist, or an RLS policy is blocking the DELETE command.");
      return true;
    },
    onSuccess: () => {
      toast.success('Shift permanently deleted.');
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
    },
    onError: (err: Error) => {
      toast.error(`Delete Failed: ${err.message}`);
      setConfirmDeleteId(null);
    }
  });

  const wipeFutureShifts = useMutation({
    mutationFn: async (userId: string) => {
      const rightNow = new Date().toISOString();
      const { error, count } = await supabase
        .from('shifts')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .gt('start_time', rightNow);

      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("0 shifts were deleted. Either no future shifts exist for this user, or RLS blocked the bulk command.");
      return count;
    },
    onSuccess: (count) => {
      toast.success(`${count} future shifts permanently destroyed.`);
      setConfirmWipeId(null);
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
    },
    onError: (err: Error) => {
      toast.error(`Bulk Delete Failed: ${err.message}`);
      setConfirmWipeId(null);
    }
  });

  const wipeGlobalFutureMutation = useMutation({
    mutationFn: async () => {
      const rightNow = new Date().toISOString();
      const { error, count } = await supabase
        .from('shifts')
        .delete({ count: 'exact' })
        .gt('start_time', rightNow);
        
      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("0 shifts deleted. RLS policy block.");
      return count;
    },
    onSuccess: (count) => {
      toast.success(`Global Wipe Complete: ${count} shifts destroyed.`);
      setConfirmGlobalWipe(false);
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
    },
    onError: (err: Error) => {
      toast.error(`Global Wipe Failed: ${err.message}`);
      setConfirmGlobalWipe(false);
    }
  });

  // ------------------------------------------------------------------
  // 3. UI COMPUTATIONS
  // ------------------------------------------------------------------
  const groupedByKeeper = useMemo(() => {
    const map = new Map<string, { user: any, shifts: any[] }>();
    shifts.forEach(shift => {
      const uid = shift.user_id;
      if (!map.has(uid)) map.set(uid, { user: shift.users, shifts: [] });
      map.get(uid)?.shifts.push(shift);
    });
    return Array.from(map.values()).sort((a, b) => (a.user?.name || '').localeCompare(b.user?.name || ''));
  }, [shifts]);

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans bg-gray-50 min-h-screen">
      
      {/* HEADER */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Matrix</h1>
          <p className="text-sm text-gray-500 mt-1">StrixOS Scheduling & Deployment</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button 
            onClick={() => {
              if (confirmGlobalWipe) {
                wipeGlobalFutureMutation.mutate();
              } else {
                setConfirmGlobalWipe(true);
                setTimeout(() => setConfirmGlobalWipe(false), 4000);
              }
            }}
            disabled={wipeGlobalFutureMutation.isPending}
            className="px-5 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {wipeGlobalFutureMutation.isPending 
              ? 'Purging...' 
              : confirmGlobalWipe 
                ? 'Click again to confirm Global Purge' 
                : 'Global Purge'}
          </button>
          <select 
            className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 outline-none"
            value={viewMode} 
            onChange={(e) => setViewMode(e.target.value as 'INDIVIDUAL' | 'GROUPED')}
          >
            <option value="INDIVIDUAL">Individual Ledger</option>
            <option value="GROUPED">Grouped by Keeper</option>
          </select>
          <button 
            onClick={() => setIsGeneratorOpen(true)}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors"
          >
            + Generate Pattern
          </button>
        </div>
      </div>

      {/* VIEW: INDIVIDUAL */}
      {viewMode === 'INDIVIDUAL' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {loadingShifts ? (
            <div className="p-10 text-center text-gray-500">Syncing database...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="p-4 font-semibold">Date</th>
                    <th className="p-4 font-semibold">Time</th>
                    <th className="p-4 font-semibold">Keeper</th>
                    <th className="p-4 font-semibold">Assignment / Notes</th>
                    <th className="p-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shifts.map((shift) => {
                    const startObj = new Date(shift.start_time);
                    const endObj = new Date(shift.end_time);
                    return (
                      <tr key={shift.id} className="hover:bg-gray-50">
                        <td className="p-4 font-medium text-gray-900">{startObj.toLocaleDateString()}</td>
                        <td className="p-4 text-gray-600">{startObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {endObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                        <td className="p-4">
                          <p className="font-semibold text-gray-900">{shift.users?.name || 'Unknown'}</p>
                          <p className="text-xs text-gray-500">{shift.users?.role || 'Staff'}</p>
                        </td>
                        <td className="p-4">
                          <span className="font-semibold text-gray-800">{shift.assigned_area || 'General Duties'}</span>
                          {shift.notes && <p className="text-xs text-gray-500 mt-1">{shift.notes}</p>}
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => {
                              if (confirmDeleteId === shift.id) {
                                deleteIndividualShift.mutate(shift.id);
                              } else {
                                setConfirmDeleteId(shift.id);
                                setTimeout(() => setConfirmDeleteId(null), 3000);
                              }
                            }}
                            disabled={deleteIndividualShift.isPending}
                            className={`${confirmDeleteId === shift.id ? 'text-red-800 font-bold' : 'text-red-500 hover:text-red-700 font-medium'} disabled:opacity-50`}
                          >
                            {deleteIndividualShift.isPending && deleteIndividualShift.variables === shift.id 
                              ? 'Deleting...' 
                              : confirmDeleteId === shift.id 
                                ? 'Confirm Delete' 
                                : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW: GROUPED */}
      {viewMode === 'GROUPED' && (
        <div className="space-y-6">
          {loadingShifts ? (
            <div className="p-10 text-center text-gray-500 bg-white rounded-xl border border-gray-200">Syncing database...</div>
          ) : (
            groupedByKeeper.map(({ user, shifts: staffShifts }) => (
              <div key={user?.id || 'unknown'} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{user?.name || 'Unknown Keeper'}</h3>
                    <p className="text-sm text-gray-500">{staffShifts.length} scheduled shifts</p>
                  </div>
                  <button 
                    onClick={() => {
                      if (confirmWipeId === user.id) {
                        wipeFutureShifts.mutate(user.id);
                      } else {
                        setConfirmWipeId(user.id);
                        setTimeout(() => setConfirmWipeId(null), 3000);
                      }
                    }}
                    disabled={wipeFutureShifts.isPending}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {wipeFutureShifts.isPending && wipeFutureShifts.variables === user.id 
                      ? 'Wiping...' 
                      : confirmWipeId === user.id 
                        ? 'Click again to Confirm Wipe' 
                        : 'Wipe Future Shifts'}
                  </button>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-white sticky top-0 border-b border-gray-200 shadow-sm">
                      <tr>
                        <th className="p-3 font-semibold text-gray-600">Date</th>
                        <th className="p-3 font-semibold text-gray-600">Time</th>
                        <th className="p-3 font-semibold text-gray-600">Assignment</th>
                        <th className="p-3 font-semibold text-gray-600 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {staffShifts.map((shift) => {
                        const startObj = new Date(shift.start_time);
                        const endObj = new Date(shift.end_time);
                        return (
                          <tr key={shift.id} className="hover:bg-gray-50">
                            <td className="p-3 font-medium text-gray-900">{startObj.toLocaleDateString()}</td>
                            <td className="p-3 text-gray-600">{startObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {endObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                            <td className="p-3">
                              <span className="font-semibold text-gray-800">{shift.assigned_area || 'General Duties'}</span>
                            </td>
                            <td className="p-3 text-right">
                              <button 
                                onClick={() => {
                                  if (confirmDeleteId === shift.id) {
                                    deleteIndividualShift.mutate(shift.id);
                                  } else {
                                    setConfirmDeleteId(shift.id);
                                    setTimeout(() => setConfirmDeleteId(null), 3000);
                                  }
                                }}
                                disabled={deleteIndividualShift.isPending}
                                className={`${confirmDeleteId === shift.id ? 'text-red-800 font-bold' : 'text-red-500 hover:text-red-700 font-medium'} disabled:opacity-50`}
                              >
                                {deleteIndividualShift.isPending && deleteIndividualShift.variables === shift.id 
                                  ? 'Deleting...' 
                                  : confirmDeleteId === shift.id 
                                    ? 'Confirm' 
                                    : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* GENERATOR MODAL */}
      {isGeneratorOpen && (
        <ShiftGeneratorModal 
          staffMembers={staffMembers} 
          onClose={() => setIsGeneratorOpen(false)} 
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 4. GENERATOR MODAL
// ------------------------------------------------------------------
function ShiftGeneratorModal({ staffMembers, onClose }: { staffMembers: any[], onClose: () => void }) {
  const queryClient = useQueryClient();
  
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');

  const insertMutation = useMutation({
    mutationFn: async (payloads: any[]) => {
      const { data, error } = await supabase.from('shifts').insert(payloads).select();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
      toast.success('Pattern successfully generated and saved.');
      onClose();
    },
    onError: (err: Error) => toast.error(`Generation Failed: ${err.message}`)
  });

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();

    if (!userId || !startDate || !endDate) return toast.error("Please fill out the staff member and date ranges.");
    if (selectedDays.length === 0) return toast.error("Please select at least one working day.");

    const startObj = new Date(startDate);
    const endObj = new Date(endDate);
    
    const diffTime = Math.abs(endObj.getTime() - startObj.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    if (diffDays > 90) return toast.error("Maximum generation span is 3 months (90 days).");
    if (endObj < startObj) return toast.error("End date cannot be before start date.");

    const payloads = [];
    let current = new Date(startObj);

    while (current <= endObj) {
      if (selectedDays.includes(current.getDay())) {
        const dateString = current.toISOString().split('T')[0];
        const startLocalIso = new Date(`${dateString}T${startTime}:00`).toISOString();
        const endLocalIso = new Date(`${dateString}T${endTime}:00`).toISOString();

        payloads.push({
          user_id: userId,
          start_time: startLocalIso,
          end_time: endLocalIso,
          assigned_area: area || null,
          notes: notes || null,
          status: 'SCHEDULED'
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (payloads.length === 0) return toast.error("No valid days found within that date range.");
    
    insertMutation.mutate(payloads);
  };

  const toggleDay = (dayIndex: number) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex]
    );
  };

  const DAYS = [{label: 'Sun', val: 0}, {label: 'Mon', val: 1}, {label: 'Tue', val: 2}, {label: 'Wed', val: 3}, {label: 'Thu', val: 4}, {label: 'Fri', val: 5}, {label: 'Sat', val: 6}];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h2 className="font-bold text-gray-900 text-lg">Generate 3-Month Pattern</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 font-bold text-xl">&times;</button>
        </div>
        
        <form onSubmit={handleGenerate} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Target Keeper</label>
            <select required value={userId} onChange={e => setUserId(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">Select Staff Member...</option>
              {staffMembers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Start Date</label>
              <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">End Date (Max 90 days)</label>
              <input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-2">Days of the Week</label>
            <div className="flex justify-between gap-1">
              {DAYS.map(day => (
                <button 
                  key={day.val}
                  type="button"
                  onClick={() => toggleDay(day.val)}
                  className={`flex-1 py-2 rounded border text-sm font-bold transition-colors ${selectedDays.includes(day.val) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Start Time</label>
              <input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">End Time</label>
              <input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Assigned Area (Optional)</label>
            <input type="text" value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Flight Yard" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Notes (Optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full p-2 border border-gray-300 rounded-lg text-sm resize-none" />
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-gray-200">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={insertMutation.isPending} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg disabled:opacity-50">
              {insertMutation.isPending ? 'Generating...' : 'Save Matrix'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
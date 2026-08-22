import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Utensils, Calendar, X, Loader2, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { FeedingSchedule, Animal, ScheduleStatus } from '../../types';

interface FeedingScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  animal?: Animal | null;
  animalId?: string;
  initialData?: FeedingSchedule | null;
}

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 'Monday' },
  { label: 'Tue', value: 'Tuesday' },
  { label: 'Wed', value: 'Wednesday' },
  { label: 'Thu', value: 'Thursday' },
  { label: 'Fri', value: 'Friday' },
  { label: 'Sat', value: 'Saturday' },
  { label: 'Sun', value: 'Sunday' },
];

export function FeedingScheduleModal({
  isOpen,
  onClose,
  animal,
  animalId,
  initialData,
}: FeedingScheduleModalProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const targetAnimalId = animal?.id || animalId || initialData?.animal_id || '';

  const [form, setForm] = useState({
    animal_id: targetAnimalId,
    food_type: initialData?.food_type || 'Day-Old Chick',
    quantity: initialData?.quantity ?? 1,
    quantity_unit: initialData?.quantity_unit || 'item',
    scheduled_date: initialData?.scheduled_date || format(new Date(), 'yyyy-MM-dd'),
    schedule_mode: (initialData?.schedule_mode as 'DAILY' | 'CUSTOM_DAYS' | 'WEEKLY') || 'DAILY',
    selected_days: Array.isArray(initialData?.selected_days) ? initialData.selected_days : [] as string[],
    supplements: initialData?.supplements || '',
    presentation_method: initialData?.presentation_method || 'Bowl / Dish',
    notes: initialData?.notes || '',
    calci_dust: Boolean(initialData?.calci_dust ?? initialData?.requires_calcidust ?? false),
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        animal_id: initialData.animal_id,
        food_type: initialData.food_type || 'Day-Old Chick',
        quantity: initialData.quantity ?? 1,
        quantity_unit: initialData.quantity_unit || 'item',
        scheduled_date: initialData.scheduled_date || format(new Date(), 'yyyy-MM-dd'),
        schedule_mode: (initialData.schedule_mode as 'DAILY' | 'CUSTOM_DAYS' | 'WEEKLY') || 'DAILY',
        selected_days: Array.isArray(initialData.selected_days) ? initialData.selected_days : [],
        supplements: initialData.supplements || '',
        presentation_method: initialData.presentation_method || 'Bowl / Dish',
        notes: initialData.notes || '',
        calci_dust: Boolean(initialData.calci_dust ?? initialData.requires_calcidust ?? false),
      });
    } else if (targetAnimalId) {
      setForm(prev => ({ ...prev, animal_id: targetAnimalId }));
    }
  }, [initialData, targetAnimalId]);

  const toggleDay = (day: string) => {
    setForm(prev => {
      const exists = prev.selected_days.includes(day);
      return {
        ...prev,
        selected_days: exists
          ? prev.selected_days.filter(d => d !== day)
          : [...prev.selected_days, day]
      };
    });
  };

  const scheduleMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const record = {
        animal_id: payload.animal_id,
        food_type: payload.food_type,
        quantity: payload.quantity,
        quantity_unit: payload.quantity_unit,
        scheduled_date: payload.scheduled_date,
        status: 'PENDING' as ScheduleStatus,
        schedule_mode: payload.schedule_mode,
        selected_days: payload.schedule_mode === 'CUSTOM_DAYS' ? payload.selected_days : null,
        supplements: payload.supplements || null,
        presentation_method: payload.presentation_method || null,
        notes: payload.notes || null,
        calci_dust: payload.calci_dust,
        requires_calcidust: payload.calci_dust,
        is_deleted: false,
        created_by: user?.id || null
      };

      if (initialData?.id) {
        const { data, error } = await supabase
          .from('feeding_schedules')
          .update(record)
          .eq('id', initialData.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('feeding_schedules')
          .insert([record])
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      toast.success(initialData?.id ? 'Feeding schedule updated.' : 'Feeding schedule item created.');
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      queryClient.invalidateQueries({ queryKey: ['daily_logs'] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(`Failed to save schedule: ${err.message}`);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.animal_id) {
      return toast.error('Animal ID is required to schedule feeding.');
    }
    scheduleMutation.mutate(form);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] font-sans">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs flex items-center gap-2">
            <Utensils size={15} className="text-slate-700" />
            {initialData ? 'Edit Feeding Schedule' : 'Create Feeding Schedule'}
            {animal?.name && <span className="text-emerald-600">— {animal.name}</span>}
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs font-medium">
          
          {/* Schedule Frequency Mode */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              Schedule Recurrence
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['DAILY', 'CUSTOM_DAYS', 'WEEKLY'] as const).map(mode => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => setForm(prev => ({ ...prev, schedule_mode: mode }))}
                  className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                    form.schedule_mode === mode
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {mode.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Day selection when in CUSTOM_DAYS mode */}
          {form.schedule_mode === 'CUSTOM_DAYS' && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
              <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">
                Select Feeding Days
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS_OF_WEEK.map(d => {
                  const isSelected = form.selected_days.includes(d.value);
                  return (
                    <button
                      type="button"
                      key={d.value}
                      onClick={() => toggleDay(d.value)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                        isSelected
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Scheduled Date *
              </label>
              <input
                type="date"
                required
                value={form.scheduled_date}
                onChange={(e) => setForm(prev => ({ ...prev, scheduled_date: e.target.value }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Quantity *
              </label>
              <input
                type="number"
                min="0.1"
                step="any"
                required
                value={form.quantity}
                onChange={(e) => setForm(prev => ({ ...prev, quantity: parseFloat(e.target.value) || 1 }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Food Type *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Day-Old Chick / Quail / Mice"
                value={form.food_type}
                onChange={(e) => setForm(prev => ({ ...prev, food_type: e.target.value }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Unit
              </label>
              <input
                type="text"
                placeholder="item / g / whole"
                value={form.quantity_unit}
                onChange={(e) => setForm(prev => ({ ...prev, quantity_unit: e.target.value }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Supplements (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Avipro / Nutrobal"
                value={form.supplements}
                onChange={(e) => setForm(prev => ({ ...prev, supplements: e.target.value }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Presentation Method
              </label>
              <input
                type="text"
                placeholder="e.g. Hand feed / Glove / Scatter"
                value={form.presentation_method}
                onChange={(e) => setForm(prev => ({ ...prev, presentation_method: e.target.value }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>
          </div>

          {/* CalciDust Toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="calci_dust_modal"
              checked={form.calci_dust}
              onChange={(e) => setForm(prev => ({ ...prev, calci_dust: e.target.checked }))}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4 cursor-pointer"
            />
            <label htmlFor="calci_dust_modal" className="text-xs font-bold text-slate-700 cursor-pointer flex items-center gap-1">
              <Sparkles size={13} className="text-amber-500" />
              Requires CalciDust / Nutritional Calcium Supplement
            </label>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              Husbandry / Diet Notes
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Remove head from chick, dust thorax..."
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl uppercase tracking-widest"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={scheduleMutation.isPending}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {scheduleMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              <span>Save Schedule</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FeedingScheduleModal;
import React, { useEffect, useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { X, Save, Loader2, Scale, Clock, UserCheck } from 'lucide-react';
import { toast } from 'sonner'; 
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { weightService } from '../../services/weightService'; 
import { Animal } from '../../types';

const extractErrorText = (errors: any): string | null => {
  if (!errors) return null;
  const errArray = Array.isArray(errors) ? errors : [errors];
  if (errArray.length === 0) return null;
  
  const messages = errArray.map((e: any) => {
    if (typeof e === 'string') return e;
    if (e && typeof e.message === 'string') return e.message;
    return null;
  }).filter(Boolean);
  
  return messages.length > 0 ? messages.join(', ') : null;
};

const FieldError = ({ meta }: { meta: any }) => {
  if (!meta?.errors || meta.errors.length === 0) return null;
  const text = extractErrorText(meta.errors);
  if (!text) return null;
  return <p className="text-[11px] text-rose-500 mt-1 font-bold">{text}</p>;
};

const formatLocalDatetime = (dateString?: string) => {
  const d = dateString ? new Date(dateString) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const getDefaultDateTime = (selectedDate?: string) => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const localTimeStr = now.toISOString().slice(11, 16);
  return selectedDate ? `${selectedDate}T${localTimeStr}` : now.toISOString().slice(0, 16);
};

const GRAMS_PER_OZ = 28.349523125;

const toGrams = (values: any, unit: string) => {
  const safeUnit = (unit || 'g').toLowerCase().trim();
  if (safeUnit === 'lb') {
    const totalOz = (values.weight_lb || 0) * 16 + (values.weight_oz || 0) + (values.weight_eighths || 0) / 8;
    return Math.round(totalOz * GRAMS_PER_OZ);
  }
  if (safeUnit === 'oz') {
    const totalOz = (values.weight_oz || 0) + (values.weight_eighths || 0) / 8;
    return Math.round(totalOz * GRAMS_PER_OZ);
  }
  if (safeUnit === 'kg') return Math.round((values.weight_kg || 0) * 1000);
  return Math.round(values.weight_g || 0);
};

const fromGrams = (grams: number | null | undefined, unit: string) => {
  if (!grams) return { weight_g: undefined, weight_kg: undefined, weight_lb: undefined, weight_oz: undefined, weight_eighths: undefined };
  
  let weight_lb = 0, weight_oz = 0, weight_eighths = 0;
  const weight_g = Math.round(grams);
  const weight_kg = Number((grams / 1000).toFixed(3));
  
  const totalOunces = grams / GRAMS_PER_OZ;
  let totalOzInt = Math.floor(totalOunces);
  let e = Math.round((totalOunces - totalOzInt) * 8);
  
  if (e >= 8) {
    totalOzInt += 1;
    e = 0;
  }
  
  const safeUnit = (unit || 'g').toLowerCase().trim();
  if (safeUnit === 'lb') {
    weight_lb = Math.floor(totalOzInt / 16);
    weight_oz = totalOzInt % 16;
    weight_eighths = e;
  } else if (safeUnit === 'oz') {
    weight_oz = totalOzInt;
    weight_eighths = e;
  }
  
  return { weight_g, weight_kg, weight_lb, weight_oz, weight_eighths };
};

const weightSchema = z.object({
  weight_g: z.number().min(0).optional(),
  weight_kg: z.number().min(0).optional(),
  weight_lb: z.number().min(0).optional(),
  weight_oz: z.number().min(0).max(15, 'Max 15').optional(),
  weight_eighths: z.number().min(0).max(7, 'Max 7').optional(),
  am_pm: z.enum(['AM', 'PM']),
  has_cast: z.boolean().default(false),
  recorded_by: z.string().uuid("ZLA COMPLIANCE: An active staff member must be selected."),
  recorded_at: z.string().min(1, 'Date and time required'),
}).refine((data) => {
  return toGrams(data, 'lb') > 0 || toGrams(data, 'oz') > 0 || toGrams(data, 'g') > 0 || toGrams(data, 'kg') > 0;
}, {
  message: "Total calculated weight must be greater than 0"
});

type WeightFormValues = z.infer<typeof weightSchema>;

interface WeightModalProps { 
  isOpen: boolean; 
  onClose: () => void; 
  animalId: string; 
  initialData?: any; 
  selectedDate?: string;
}

export function WeightModal({ isOpen, onClose, animalId, initialData, selectedDate }: WeightModalProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const { data: activeStaff = [] } = useQuery({
    queryKey: ['active-staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, initials')
        .eq('is_active', true)
        .eq('is_deleted', false)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const animalUnit = useMemo(() => {
    const cachedAnimals = queryClient.getQueryData<Animal[]>(['animals', 'dashboard']) || [];
    const animal = cachedAnimals.find(a => a.id === animalId);
    return animal?.preferred_weight_unit || animal?.weight_unit || 'g'; 
  }, [queryClient, animalId]);

  const insertWeightMutation = useMutation({
    mutationFn: async (values: WeightFormValues) => {
      const payload = {
        id: initialData?.id || crypto.randomUUID(), 
        animal_id: animalId,
        recorded_by: values.recorded_by,
        recorded_at: new Date(values.recorded_at).toISOString(),
        created_by: profile?.id,
        weight_grams: toGrams(values, animalUnit),
        am_pm: values.am_pm,
        has_cast: values.has_cast,
      };
      return await weightService.insertWeightLog(payload);
    },
    onSuccess: () => {
      toast.success(initialData ? 'Bio-weight updated successfully' : 'Bio-weight logged successfully');
      queryClient.invalidateQueries({ queryKey: ['weights'] });
      queryClient.invalidateQueries({ queryKey: ['strict_logs'] });
      onClose();
    },
    onError: (error: any) => toast.error(`Failed to log weight: ${error.message}`),
  });

  const form = useForm<WeightFormValues>({
    defaultValues: {
      ...fromGrams(initialData?.weight_grams, animalUnit),
      am_pm: initialData?.am_pm || (new Date().getHours() < 12 ? 'AM' : 'PM'),
      has_cast: initialData?.has_cast || false,
      recorded_by: initialData?.recorded_by || (initialData as any)?.weighed_by || profile?.id || '',
      recorded_at: initialData?.recorded_at ? formatLocalDatetime(initialData.recorded_at) : getDefaultDateTime(selectedDate),
    },
    validators: { onSubmit: weightSchema },
    onSubmit: async ({ value }) => insertWeightMutation.mutate(value),
  });

  useEffect(() => {
    if (isOpen && !initialData) {
      form.reset();
      form.setFieldValue('am_pm', new Date().getHours() < 12 ? 'AM' : 'PM');
      form.setFieldValue('recorded_at', getDefaultDateTime(selectedDate));
      if (profile?.id) {
        form.setFieldValue('recorded_by', profile.id);
      }
    }
  }, [isOpen, form, initialData, selectedDate, profile?.id]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200/80">
        
        {/* Header Bar */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center font-black shadow-sm shrink-0">
              <Scale size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">
                {initialData ? 'Edit Bio-Weight' : 'Log Bio-Weight'}
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Unit Protocol: <span className="text-emerald-600 font-mono font-black">{animalUnit.toUpperCase()}</span>
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="p-6 space-y-5">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Conducted By */}
            <form.Field name="recorded_by">
              {(field) => (
                <div className="space-y-1">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Conducted By *
                  </label>
                  <select
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 cursor-pointer transition-all"
                  >
                    <option value="" disabled>-- Select Keeper --</option>
                    {activeStaff.map((staff: any) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} ({staff.initials || '?'})
                      </option>
                    ))}
                  </select>
                  <FieldError meta={field.state.meta} />
                </div>
              )}
            </form.Field>

            {/* Date & Time */}
            <form.Field name="recorded_at">
              {(field) => (
                <div className="space-y-1">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                  <FieldError meta={field.state.meta} />
                </div>
              )}
            </form.Field>
          </div>

          {/* Unit-Sensitive Numeric Input Grid */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
              Measured Bio-Weight ({animalUnit})
            </label>
             
            {animalUnit === 'lb' && (
              <div className="grid grid-cols-3 gap-3">
                <form.Field name="weight_lb">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-slate-50 pl-3 pr-8 py-3 border border-slate-200 rounded-2xl text-xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center transition-all" 
                        placeholder="0" 
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs uppercase">lb</span>
                      <FieldError meta={field.state.meta} />
                    </div>
                  )}
                </form.Field>

                <form.Field name="weight_oz">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        max="15" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-slate-50 pl-3 pr-8 py-3 border border-slate-200 rounded-2xl text-xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center transition-all" 
                        placeholder="0" 
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs uppercase">oz</span>
                      <FieldError meta={field.state.meta} />
                    </div>
                  )}
                </form.Field>

                <form.Field name="weight_eighths">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        max="7" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-slate-50 pl-3 pr-8 py-3 border border-slate-200 rounded-2xl text-xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center transition-all" 
                        placeholder="0" 
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-black text-[10px]">1/8</span>
                      <FieldError meta={field.state.meta} />
                    </div>
                  )}
                </form.Field>
              </div>
            )}

            {animalUnit === 'oz' && (
              <div className="grid grid-cols-2 gap-3">
                <form.Field name="weight_oz">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-slate-50 pl-3 pr-10 py-3 border border-slate-200 rounded-2xl text-xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center transition-all" 
                        placeholder="0" 
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs uppercase">oz</span>
                      <FieldError meta={field.state.meta} />
                    </div>
                  )}
                </form.Field>

                <form.Field name="weight_eighths">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        max="7" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-slate-50 pl-3 pr-10 py-3 border border-slate-200 rounded-2xl text-xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center transition-all" 
                        placeholder="0" 
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">1/8</span>
                      <FieldError meta={field.state.meta} />
                    </div>
                  )}
                </form.Field>
              </div>
            )}

            {animalUnit === 'g' && (
              <form.Field name="weight_g">
                {(field) => (
                  <div className="relative">
                    <input 
                      type="number" 
                      step="1" 
                      value={field.state.value ?? ''} 
                      onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                      className="w-full bg-slate-50 pl-4 pr-10 py-3 border border-slate-200 rounded-2xl text-2xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all" 
                      placeholder="0" 
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm uppercase">g</span>
                    <FieldError meta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            )}
             
            {animalUnit === 'kg' && (
              <form.Field name="weight_kg">
                {(field) => (
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.001" 
                      value={field.state.value ?? ''} 
                      onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                      className="w-full bg-slate-50 pl-4 pr-10 py-3 border border-slate-200 rounded-2xl text-2xl font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all" 
                      placeholder="0.000" 
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm uppercase">kg</span>
                    <FieldError meta={field.state.meta} />
                  </div>
                )}
              </form.Field>
            )}
             
            <form.Subscribe
              selector={(state) => state.errorMap}
              children={(errorMap) => {
                const text = extractErrorText(errorMap?.onSubmit);
                if (!text) return null;
                return (
                  <div className="pt-1">
                    <p className="text-xs text-rose-500 font-bold">{text}</p>
                  </div>
                );
              }}
            />
          </div>

          {/* AM / PM Shift Selection */}
          <form.Field name="am_pm">
            {(field) => (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Shift Window
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => field.handleChange('AM')}
                    className={`flex-1 py-3 text-center rounded-2xl border-2 font-black text-xs uppercase tracking-widest transition-all cursor-pointer ${
                      field.state.value === 'AM'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    }`}
                  >
                    AM Weight
                  </button>
                  <button
                    type="button"
                    onClick={() => field.handleChange('PM')}
                    className={`flex-1 py-3 text-center rounded-2xl border-2 font-black text-xs uppercase tracking-widest transition-all cursor-pointer ${
                      field.state.value === 'PM'
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    }`}
                  >
                    PM Weight
                  </button>
                </div>
              </div>
            )}
          </form.Field>

          {/* Cast Pellet Checkbox */}
          <form.Field name="has_cast">
            {(field) => (
              <label className="flex items-center gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl cursor-pointer hover:bg-slate-100/80 transition-colors">
                <input
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                />
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Bird has cast pellet prior to weighing
                </span>
              </label>
            )}
          </form.Field>

          {/* Action Buttons */}
          <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-5 py-2.5 bg-slate-100 text-slate-700 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <form.Subscribe
              selector={(state) => [state.isSubmitting]}
              children={([isSubmitting]) => (
                <button 
                  type="submit" 
                  disabled={insertWeightMutation.isPending || isSubmitting} 
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {insertWeightMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 
                  {initialData ? 'Update Weight' : 'Log Bio-Weight'}
                </button>
              )}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

export default WeightModal;
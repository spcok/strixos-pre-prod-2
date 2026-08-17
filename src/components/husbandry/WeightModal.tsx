import React, { useEffect, useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { X, Save, Loader2, Scale } from 'lucide-react';
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
  if (unit === 'lb') return Math.round((((values.weight_lb || 0) * 16) + (values.weight_oz || 0) + ((values.weight_eighths || 0) / 8)) * GRAMS_PER_OZ);
  if (unit === 'oz') return Math.round(((values.weight_oz || 0) + ((values.weight_eighths || 0) / 8)) * GRAMS_PER_OZ);
  if (unit === 'kg') return Math.round((values.weight_kg || 0) * 1000);
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
  if (e >= 8) { totalOzInt += 1; e = 0; }
  
  if (unit === 'lb') {
    weight_lb = Math.floor(totalOzInt / 16);
    weight_oz = totalOzInt % 16;
    weight_eighths = e;
  } else if (unit === 'oz') {
    weight_oz = totalOzInt;
    weight_eighths = e;
  }
  return { weight_g, weight_kg, weight_lb, weight_oz, weight_eighths };
};

// --- UNIFIED INPUT COMPONENTS ---
function FormInput({ field, label, type = 'text', placeholder, hasError, rightAddon, max, step }: { field: any; label: string; type?: string; placeholder?: string; hasError?: boolean; rightAddon?: React.ReactNode; max?: string; step?: string }) {
  const baseClasses = `w-full p-2.5 bg-slate-50 border rounded-xl outline-none text-sm md:text-xs font-bold text-slate-800 transition-all focus:bg-white focus:ring-4 ${
    hasError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/5'
  }`;

  return (
    <div className="flex flex-col gap-1 w-full relative">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{label}</label>
      <div className="relative w-full">
        <input
          type={type === 'number' ? 'number' : type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={step}
          max={max}
          value={field.state.value ?? ''}
          onBlur={field.handleBlur}
          onChange={(e) => {
            if (type === 'number') field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value));
            else field.handleChange(e.target.value);
          }}
          placeholder={placeholder}
          className={baseClasses}
          style={rightAddon ? { paddingRight: '2.5rem' } : undefined}
        />
        {rightAddon && <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">{rightAddon}</div>}
      </div>
    </div>
  );
}

function FormSelect({ field, label, options, placeholder, hasError }: { field: any; label: string; options: { value: string | number, label: string }[], placeholder?: string; hasError?: boolean }) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{label}</label>
      <select
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        className={`w-full p-2.5 bg-slate-50 border rounded-xl outline-none text-sm md:text-xs font-bold text-slate-800 transition-all focus:bg-white focus:ring-4 cursor-pointer appearance-none ${
          hasError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/5'
        }`}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((opt, i) => (
          <option key={i} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

const weightSchema = z.object({
  weight_g: z.number().min(0).optional(),
  weight_kg: z.number().min(0).optional(),
  weight_lb: z.number().min(0).optional(),
  weight_oz: z.number().min(0).max(15).optional(),
  weight_eighths: z.number().min(0).max(7).optional(),
  am_pm: z.enum(['AM', 'PM']),
  has_cast: z.boolean().default(false),
  recorded_by: z.string().uuid("ZLA COMPLIANCE: An active staff member must be selected."),
  recorded_at: z.string().min(1, 'Date and time required'),
}).refine((data) => (toGrams(data, 'lb') > 0 || toGrams(data, 'oz') > 0 || toGrams(data, 'g') > 0 || toGrams(data, 'kg') > 0), {
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
      const { data, error } = await supabase.from('users').select('id, name, initials').eq('is_active', true).eq('is_deleted', false);
      if (error) throw error;
      return data || [];
    },
    staleTime: 0, gcTime: 1209600000, networkMode: 'offlineFirst', meta: { persist: true }
  });

  const animal = useMemo(() => {
    const cachedAnimals = queryClient.getQueryData<Animal[]>(['animals', 'dashboard']) || [];
    return cachedAnimals.find(a => a.id === animalId);
  }, [queryClient, animalId]);
  
  const animalUnit = animal?.weight_unit || 'g'; 

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
      toast.success(initialData ? 'Weight updated successfully' : 'Weight logged successfully');
      queryClient.invalidateQueries({ queryKey: ['weights'] });
      onClose();
    },
    onError: (error) => toast.error(`Failed to log weight: ${error.message}`),
  });

  const form = useForm<WeightFormValues>({
    defaultValues: {
      ...fromGrams(initialData?.weight_grams, animalUnit),
      am_pm: initialData?.am_pm || (new Date().getHours() < 12 ? 'AM' : 'PM'),
      has_cast: initialData?.has_cast || false,
      recorded_by: initialData?.recorded_by || '',
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
    }
  }, [isOpen, form, initialData, selectedDate]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center p-0 md:p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white w-full h-[100dvh] md:h-auto md:max-h-[90vh] md:max-w-xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col border-0 md:border md:border-slate-200 relative">
        
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-50">
              <Scale size={18} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-black text-slate-900 uppercase tracking-widest leading-tight">
                {initialData ? 'Edit Weight' : 'Log Weight'}
              </h2>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider leading-tight">
                {animal?.name || 'Unknown Animal'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="p-5 overflow-y-auto custom-scrollbar bg-white flex-1 relative space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form.Field name="recorded_at">{(field) => <FormInput field={field} label="Date & Time" type="datetime-local" />}</form.Field>
            <form.Field name="recorded_by">
              {(field) => (
                <FormSelect 
                  field={field} 
                  label="Conducted By *" 
                  placeholder="-- Select Keeper --"
                  options={activeStaff.map((s: any) => ({ value: s.id, label: `${s.name} (${s.initials || '?'})` }))} 
                />
              )}
            </form.Field>
          </div>

          <hr className="border-slate-100" />

          {/* BIO-WEIGHT SECTION */}
          <div className="space-y-4">
             {animalUnit === 'lb' && (
               <div className="grid grid-cols-3 gap-3">
                 <form.Field name="weight_lb">{(field) => <FormInput field={field} label="Lbs" type="number" rightAddon={<span className="text-slate-400 font-bold text-xs">lb</span>} />}</form.Field>
                 <form.Field name="weight_oz">{(field) => <FormInput field={field} label="Oz" type="number" max="15" rightAddon={<span className="text-slate-400 font-bold text-xs">oz</span>} />}</form.Field>
                 <form.Field name="weight_eighths">{(field) => <FormSelect field={field} label="Eighths" options={[0,1,2,3,4,5,6,7].map(n => ({ value: n.toString(), label: `${n}/8` }))} />}</form.Field>
               </div>
             )}

             {animalUnit === 'oz' && (
               <div className="grid grid-cols-2 gap-3">
                 <form.Field name="weight_oz">{(field) => <FormInput field={field} label="Ounces (Oz)" type="number" rightAddon={<span className="text-slate-400 font-bold text-xs">oz</span>} />}</form.Field>
                 <form.Field name="weight_eighths">{(field) => <FormSelect field={field} label="Eighths" options={[0,1,2,3,4,5,6,7].map(n => ({ value: n.toString(), label: `${n}/8` }))} />}</form.Field>
               </div>
             )}

             {animalUnit === 'g' && (
               <form.Field name="weight_g">{(field) => <FormInput field={field} label="Mass (Grams)" type="number" rightAddon={<span className="text-slate-400 font-bold text-xs">g</span>} />}</form.Field>
             )}
             
             {animalUnit === 'kg' && (
               <form.Field name="weight_kg">{(field) => <FormInput field={field} label="Mass (Kilograms)" type="number" step="0.01" rightAddon={<span className="text-slate-400 font-bold text-xs">kg</span>} />}</form.Field>
             )}
             
             <form.Subscribe selector={(state) => state.errorMap} children={(errorMap) => {
                const text = extractErrorText(errorMap?.onSubmit);
                return text ? <div className="pt-1"><p className="text-xs text-rose-500 font-bold">{text}</p></div> : null;
             }} />
          </div>

          <form.Field name="am_pm">
            {(field) => (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Time of Day</label>
                <div className="flex bg-slate-100 p-1.5 rounded-xl gap-1">
                  {['AM', 'PM'].map(time => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => field.handleChange(time as 'AM'|'PM')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                        field.state.value === time 
                          ? `bg-emerald-600 text-white shadow-md scale-100` 
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 scale-95'
                      }`}
                    >
                      {time} Weight
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form.Field>

          <form.Field name="has_cast">
            {(field) => (
              <label className="flex items-center gap-2 cursor-pointer group/toggle w-fit pt-2">
                <input type="checkbox" checked={Boolean(field.state.value)} onChange={(e) => field.handleChange(e.target.checked)} className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer" />
                <span className="text-sm font-bold text-slate-500 group-hover/toggle:text-slate-800 transition-colors">Bird has cast pellet</span>
              </label>
            )}
          </form.Field>

        </form>

        {/* FOOTER */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end bg-white gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.isSubmitting]}>
            {([isSubmitting]) => (
              <button
                onClick={form.handleSubmit}
                disabled={insertWeightMutation.isPending}
                className="flex items-center justify-center gap-2 px-8 py-2.5 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-md disabled:opacity-50 bg-emerald-600 hover:bg-emerald-500"
              >
                {(isSubmitting || insertWeightMutation.isPending) ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {initialData ? 'Update Weight' : 'Log Weight'}
              </button>
            )}
          </form.Subscribe>
        </div>

      </div>
    </div>
  );
}
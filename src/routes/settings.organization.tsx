import React, { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { Building, Loader2, Save, Globe, Mail, Phone, MapPin, FileCheck, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { ImageUploader } from '../components/ui/ImageUploader';
import { OrganizationProfile } from '../types';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const orgSettingsOptions = queryOptions({
  queryKey: ['org_settings'],
  queryFn: async () => {
    const { data, error } = await supabase.from('organization_profile').select('*').single();
    if (error && error.code !== 'PGRST116') throw error; 
    return (data || {}) as Partial<OrganizationProfile>;
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/organization')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(orgSettingsOptions);
  },
  component: OrgProfilePage,
});

// ------------------------------------------------------------------
// 2. MAIN COMPONENT
// ------------------------------------------------------------------
export function OrgProfilePage() {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  const { data: settings = {}, isLoading } = useQuery(orgSettingsOptions);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const idToUpsert = settings.id || undefined; 
      
      const upsertPayload = idToUpsert 
        ? { id: idToUpsert, ...payload } 
        : { ...payload };

      const { data, error } = await supabase
        .from('organization_profile')
        .upsert(upsertPayload) 
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org_settings'] });
      toast.success('Organisation profile saved successfully.');
    },
    onError: (err: any) => {
      toast.error(`Save failed: ${err.message || 'Could not update organisation profile.'}`);
    }
  });

  const form = useForm({
    defaultValues: {
      org_name: settings.org_name || '',
      logo_url: settings.logo_url || '',
      contact_email: settings.contact_email || '',
      contact_phone: settings.contact_phone || '',
      address: settings.address || '',
      license_number: settings.license_number || '',
      website: settings.website || '',
      adoptionurl: settings.adoptionurl || '',
    },
    onSubmit: async ({ value }) => {
      await saveMutation.mutateAsync(value);
    }
  });

  const handleLogoUpload = async (fileOrUrl: string | Blob | null) => {
    if (fileOrUrl instanceof Blob) {
      if (!navigator.onLine) {
        toast.error('Cannot upload logo assets while offline.');
        return;
      }
      setIsUploading(true);
      try {
        const fileExt = fileOrUrl.type.split('/')[1] || 'jpeg';
        const filePath = `logos/primary-logo.${fileExt}`;
        
        const fileToUpload = new File([fileOrUrl], `primary-logo.${fileExt}`, {
          type: fileOrUrl.type || 'image/jpeg',
        });

        const { data: files } = await supabase.storage.from('koa-attachments').list('logos');
        if (files && files.length > 0) {
          await supabase.storage.from('koa-attachments').remove(files.map(f => `logos/${f.name}`));
        }

        const { error: uploadError } = await supabase.storage.from('koa-attachments').upload(filePath, fileToUpload, { 
          upsert: true,
          contentType: fileToUpload.type,
          cacheControl: '3600'
        });
        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('koa-attachments').getPublicUrl(filePath);
        form.setFieldValue('logo_url', `${data.publicUrl}?t=${Date.now()}`);
        toast.success('Logo asset uploaded.');
      } catch (err: any) {
        toast.error(`Upload failed: ${err.message}`);
      } finally {
        setIsUploading(false);
      }
    } else if (fileOrUrl === null) {
      form.setFieldValue('logo_url', '');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-slate-400 gap-3">
        <Loader2 className="animate-spin text-slate-600" size={28} />
        <span className="text-xs font-black uppercase tracking-widest text-slate-600">Loading Organisation Profile...</span>
      </div>
    );
  }

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";
  const sectionTitleClass = "text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-4 pb-2 border-b border-slate-100";

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-300 relative">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 pb-1">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">
            Organisation Profile & ZLA Metadata
          </h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
            Licensing numbers, letterhead branding, address & public portal endpoints
          </p>
        </div>

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <button 
              type="submit" 
              form="org-profile-form"
              disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending || isUploading}
              className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0 w-full sm:w-auto"
            >
              {(isSubmitting || saveMutation.isPending) ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} className="text-emerald-400" />
              )}
              <span>Save Changes</span>
            </button>
          )}
        </form.Subscribe>
      </div>

      {/* Form Container */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
        <form 
          id="org-profile-form" 
          onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} 
          className="space-y-5"
        >
          {/* Card 1: Branding & Identity */}
          <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
            <h4 className={sectionTitleClass}>
              <Building size={15} className="text-slate-500" /> Brand Identity & Zoo Licensing
            </h4>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Logo Column */}
              <div className="lg:col-span-4 flex flex-col gap-2">
                <label className={labelClass}>Official Zoo Letterhead Logo</label>
                <form.Subscribe selector={(state) => state.values.logo_url} children={(url) => (
                  <div className="w-full relative">
                    {isUploading && (
                      <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm border border-slate-200 border-dashed rounded-2xl flex flex-col items-center justify-center text-slate-800 font-black text-xs uppercase tracking-widest gap-2">
                        <Loader2 className="animate-spin text-slate-800" size={22} /> Uploading Asset...
                      </div>
                    )}
                    <ImageUploader value={url} onChange={handleLogoUpload} requireCrop={true} />
                  </div>
                )} />
                <span className="text-[10px] font-medium text-slate-400 leading-snug mt-1">
                  Square or horizontal PNG/JPEG with transparent background recommended.
                </span>
              </div>

              {/* Identity Fields */}
              <div className="lg:col-span-8 space-y-4">
                <form.Field name="org_name" children={(field) => (
                  <div>
                    <label className={labelClass}>Registered Facility / Academy Name *</label>
                    <input 
                      required 
                      placeholder="e.g. Kent Owl Academy" 
                      value={field.state.value} 
                      onBlur={field.handleBlur} 
                      onChange={(e) => field.handleChange(e.target.value)} 
                      className={inputClass} 
                    />
                  </div>
                )} />

                <form.Field name="license_number" children={(field) => (
                  <div>
                    <label className={labelClass}>Official Zoo Licensing Act (ZLA) Number *</label>
                    <div className="relative">
                      <FileCheck className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input 
                        required 
                        placeholder="e.g. ZOO/2026/0491-KOA" 
                        value={field.state.value} 
                        onBlur={field.handleBlur} 
                        onChange={(e) => field.handleChange(e.target.value)} 
                        className={`${inputClass} pl-9 font-mono tracking-wide`} 
                      />
                    </div>
                  </div>
                )} />
              </div>
            </div>
          </div>

          {/* Card 2: Contact & Statutory Location */}
          <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
            <h4 className={sectionTitleClass}>
              <MapPin size={15} className="text-slate-500" /> Operational Headquarters & Public Channels
            </h4>

            <form.Field name="address" children={(field) => (
              <div>
                <label className={labelClass}>Headquarters Physical Address *</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 text-slate-400" size={14} />
                  <textarea 
                    required 
                    rows={3} 
                    placeholder="Full physical site address including post code..." 
                    value={field.state.value} 
                    onBlur={field.handleBlur} 
                    onChange={(e) => field.handleChange(e.target.value)} 
                    className={`${inputClass} pl-9 py-2.5 resize-none h-20`} 
                  />
                </div>
              </div>
            )} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="contact_email" children={(field) => (
                <div>
                  <label className={labelClass}>Administrative Contact Email *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      type="email" 
                      required 
                      placeholder="admin@kentowlacademy.com" 
                      value={field.state.value} 
                      onBlur={field.handleBlur} 
                      onChange={(e) => field.handleChange(e.target.value)} 
                      className={`${inputClass} pl-9`} 
                    />
                  </div>
                </div>
              )} />

              <form.Field name="contact_phone" children={(field) => (
                <div>
                  <label className={labelClass}>Emergency & Bookings Phone Number *</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      type="tel" 
                      required 
                      placeholder="07535471588" 
                      value={field.state.value} 
                      onBlur={field.handleBlur} 
                      onChange={(e) => field.handleChange(e.target.value)} 
                      className={`${inputClass} pl-9`} 
                    />
                  </div>
                </div>
              )} />

              <form.Field name="website" children={(field) => (
                <div>
                  <label className={labelClass}>Official Public Website</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      type="url" 
                      placeholder="https://www.kentowlacademy.com" 
                      value={field.state.value} 
                      onBlur={field.handleBlur} 
                      onChange={(e) => field.handleChange(e.target.value)} 
                      className={`${inputClass} pl-9`} 
                    />
                  </div>
                </div>
              )} />

              <form.Field name="adoptionurl" children={(field) => (
                <div>
                  <label className={labelClass}>Animal Adoption Portal URL</label>
                  <div className="relative">
                    <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      type="url" 
                      placeholder="https://www.kentowlacademy.com/adoptions" 
                      value={field.state.value} 
                      onBlur={field.handleBlur} 
                      onChange={(e) => field.handleChange(e.target.value)} 
                      className={`${inputClass} pl-9`} 
                    />
                  </div>
                </div>
              )} />
            </div>
          </div>
        </form>
      </div>

    </div>
  );
}

export default OrgProfilePage;
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Phone, Plus, Trash2, Mail, MapPin, X, Loader2, 
  Search, Briefcase, Edit2, AlertTriangle, Building, CheckCircle2 
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { ExternalContact } from '../types';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const directoryOptions = queryOptions({
  queryKey: ['external_directory'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('external_directory')
      .select('*')
      .eq('is_deleted', false)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []) as ExternalContact[];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/directory')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(directoryOptions);
  },
  component: DirectoryPage,
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

const CATEGORY_TABS = ['ALL', 'VETERINARY', 'CONTRACTORS', 'SUPPLIERS', 'AUTHORITIES'] as const;

// ------------------------------------------------------------------
// 2. MAIN COMPONENT
// ------------------------------------------------------------------
export function DirectoryPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [modalState, setModalState] = useState<{ isOpen: boolean; contactToEdit?: ExternalContact | null }>({
    isOpen: false,
    contactToEdit: null,
  });

  // Supabase Realtime Sync
  useEffect(() => {
    const channel = supabase
      .channel('directory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_directory' }, () => {
        queryClient.invalidateQueries({ queryKey: ['external_directory'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: contacts = [], isLoading } = useQuery(directoryOptions);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('external_directory').update({ is_deleted: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external_directory'] });
      toast.success('Contact removed from directory.');
    },
    onError: (err: any) => toast.error(`Failed to delete: ${err.message}`)
  });

  const filteredContacts = useMemo(() => {
    let result = contacts;

    if (selectedCategory !== 'ALL') {
      result = result.filter((c) => {
        const role = (c.role || '').toLowerCase();
        if (selectedCategory === 'VETERINARY') return role.includes('vet');
        if (selectedCategory === 'CONTRACTORS') return role.includes('contract') || role.includes('repair') || role.includes('electric') || role.includes('plumb') || role.includes('build');
        if (selectedCategory === 'SUPPLIERS') return role.includes('suppl') || role.includes('feed') || role.includes('food') || role.includes('meat');
        if (selectedCategory === 'AUTHORITIES') return role.includes('zla') || role.includes('council') || role.includes('defra') || role.includes('gov') || role.includes('inspector');
        return true;
      });
    }

    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      result = result.filter(c => 
        (c.name || '').toLowerCase().includes(lower) ||
        (c.role || '').toLowerCase().includes(lower) ||
        (c.phone || '').toLowerCase().includes(lower) ||
        (c.email || '').toLowerCase().includes(lower) ||
        (c.address || '').toLowerCase().includes(lower)
      );
    }

    return result;
  }, [contacts, selectedCategory, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredContacts.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 180 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(220px, 1.5fr) minmax(160px, 1.1fr) minmax(200px, 1.4fr) minmax(240px, 1.6fr) minmax(90px, 0.6fr)";

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-300 relative">
      
      {/* --- CONTROLS BAR --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0">
        <div className="relative flex-1 min-w-[200px] w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input 
            type="text" 
            placeholder="Search contacts, roles, phone, address..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all shadow-sm placeholder:text-slate-400" 
          />
        </div>

        <button 
          onClick={() => setModalState({ isOpen: true, contactToEdit: null })} 
          className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0 w-full sm:w-auto"
        >
          <Plus size={14} className="text-blue-400" />
          <span>Add Contact</span>
        </button>
      </div>

      {/* --- CATEGORY PILL TABS --- */}
      <div className="flex gap-1.5 w-full shrink-0 overflow-x-auto pb-1 custom-scrollbar">
        {CATEGORY_TABS.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 ${
              selectedCategory === cat 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* --- DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-slate-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing External Directory...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Contact & Specialty</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Phone Number</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Email Address</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Physical Location</div>
            <div className="px-5 py-3.5 flex items-center justify-end text-right">Actions</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredContacts.length === 0 && !isLoading ? (
              <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center h-full">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-3 border border-slate-200 shadow-sm">
                  <Briefcase size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No directory contacts found</p>
                <p className="text-[10px] font-medium text-slate-400">Try adjusting your search query or category filter.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const contact = filteredContacts[virtualRow.index];

                  return (
                    <div 
                      key={contact.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Contact & Role */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Contact</div>}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0 shadow-sm">
                            <Briefcase size={14} className="text-slate-500" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs lg:text-sm font-bold text-slate-900 truncate" title={contact.name}>
                              {contact.name}
                            </h4>
                            <span className="inline-block text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.2 rounded uppercase tracking-widest mt-0.5 truncate max-w-full">
                              {contact.role || 'General'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 2. Phone */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Phone</div>}
                        {contact.phone ? (
                          <a 
                            href={`tel:${contact.phone}`} 
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-blue-600 transition-colors truncate"
                          >
                            <Phone size={12} className="text-blue-500 shrink-0" />
                            <span>{contact.phone}</span>
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">No phone</span>
                        )}
                      </div>

                      {/* 3. Email */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Email</div>}
                        {contact.email ? (
                          <a 
                            href={`mailto:${contact.email}`} 
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 transition-colors truncate max-w-full" 
                            title={contact.email}
                          >
                            <Mail size={12} className="text-blue-500 shrink-0" />
                            <span className="truncate">{contact.email}</span>
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">No email</span>
                        )}
                      </div>

                      {/* 4. Address */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Location</div>}
                        {contact.address ? (
                          <div className="flex items-start gap-1.5 text-xs font-medium text-slate-600 leading-snug truncate max-w-full" title={contact.address}>
                            <MapPin size={12} className="text-slate-400 shrink-0 mt-0.5" />
                            <span className="truncate">{contact.address}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">No address logged</span>
                        )}
                      </div>

                      {/* 5. Actions */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => setModalState({ isOpen: true, contactToEdit: contact })} 
                            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                            title="Edit Contact"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => { 
                              if (window.confirm(`Delete ${contact.name} from directory?`)) {
                                deleteMutation.mutate(contact.id); 
                              }
                            }} 
                            disabled={deleteMutation.isPending}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors disabled:opacity-50"
                            title="Delete Contact"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {modalState.isOpen && (
        <ContactModal 
          contactToEdit={modalState.contactToEdit}
          onClose={() => setModalState({ isOpen: false, contactToEdit: null })} 
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 3. UNIFIED CONTACT MODAL (CREATE & EDIT)
// ------------------------------------------------------------------
function ContactModal({ contactToEdit, onClose }: { contactToEdit?: ExternalContact | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isEditing = !!contactToEdit;

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (isEditing && contactToEdit?.id) {
        const { error } = await supabase
          .from('external_directory')
          .update(payload)
          .eq('id', contactToEdit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('external_directory')
          .insert([{ ...payload, is_deleted: false }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external_directory'] });
      toast.success(isEditing ? 'Contact updated.' : 'Contact saved.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save contact.')
  });

  const form = useForm({
    defaultValues: { 
      name: contactToEdit?.name || '', 
      role: contactToEdit?.role || '', 
      phone: contactToEdit?.phone || '', 
      email: contactToEdit?.email || '', 
      address: contactToEdit?.address || '' 
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync(value);
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center rounded-t-2xl">
          <div>
            <h3 className="font-black text-slate-900 uppercase tracking-tight text-base flex items-center gap-2">
              {isEditing ? <Edit2 size={16} className="text-slate-700" /> : <Plus size={16} className="text-slate-700" />}
              {isEditing ? 'Edit Directory Contact' : 'New Directory Entry'}
            </h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
              Veterinary, contractor, or supplier record
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="contact-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-4">
            {errorMsg && (
              <div className="p-3.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200 flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            
            <form.Field name="name" children={(field) => (
              <div>
                <label className={labelClass}>Entity / Company Name *</label>
                <input required placeholder="e.g. Lordington Avian Veterinary Practice" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />

            <form.Field name="role" children={(field) => (
              <div>
                <label className={labelClass}>Specialty / Classification *</label>
                <input required placeholder="e.g. Avian Veterinarian, Electrician, Meat Supplier" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <form.Field name="phone" children={(field) => (
                <div>
                  <label className={labelClass}>Phone Number</label>
                  <input type="tel" placeholder="+44 7000 000000" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )} />
              <form.Field name="email" children={(field) => (
                <div>
                  <label className={labelClass}>Email Address</label>
                  <input type="email" placeholder="contact@example.com" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )} />
            </div>

            <form.Field name="address" children={(field) => (
              <div>
                <label className={labelClass}>Physical Location / Address</label>
                <textarea placeholder="Unit number, street, city, postcode..." value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} h-20 resize-none`} />
              </div>
            )} />
          </form>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button 
                type="submit" 
                form="contact-form"
                disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {(isSubmitting || saveMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{isEditing ? 'Save Changes' : 'Add Contact'}</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

export default DirectoryPage;
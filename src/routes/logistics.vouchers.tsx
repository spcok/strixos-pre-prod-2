import React, { useState, useEffect, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';
import { 
  Ticket, QrCode, Search, CheckCircle2, 
  XCircle, Clock, Loader2, Calendar, MoreVertical, 
  Ban, Plus, Trash2, ShieldAlert
} from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

export const Route = createFileRoute('/logistics/vouchers')({
  component: VouchersDashboard,
});

type Voucher = {
  id: string; 
  voucher_code: string; 
  experience_type: string;
  purchaser_name: string;
  purchaser_email: string;
  participants: number;
  guests: number;
  status: 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  purchase_date: string;
  redeemed_at: string | null;
  transaction_id: string;
};

// COMPREHENSIVE KOA EXPERIENCES
const EXPERIENCE_OPTIONS = [
  "Owl Encounter",
  "Meet the Meerkats",
  "Owl and Meerkat Encounter",
  "Junior Keeper",
  "Kids Encounter",
  "Half Day Photo Session",
  "Full Day Photo Workshop",
  "Snake Encounter",
  "Eagle Encounter",
  "Raptor Experience",
  "Skunk Encounter",
  "Ferret Encounter",
  "Lizard Encounter",
  "Tawny Frogmouth",
  "Owl Meet and Greet",
  "Adoption Meet and Greet",
  "Christmas Sale - Owl Encounter"
];

function VouchersDashboard() {
  const { session, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  
  // SECURE LAYER: Does this user have management privileges to view PII?
  const isManager = hasPermission('vouchers:manage');

  const [manualCode, setManualCode] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'>('ACTIVE');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isScannerPaused, setIsScannerPaused] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Issue Voucher Modal State (Supports a multi-item cart)
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueForm, setIssueForm] = useState({
    customerName: '',
    customerEmail: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    transactionId: '',
    experiences: [{ id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0], participants: 1, guests: 0 }]
  });

  // Directory Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [experienceFilter, setExperienceFilter] = useState('');

  // Unmissable Flash States
  const [successFlash, setSuccessFlash] = useState<{ show: boolean, voucherCode: string, participants: number, guests: number }>({ show: false, voucherCode: '', participants: 0, guests: 0 });
  const [errorFlash, setErrorFlash] = useState<{ show: boolean, message: string }>({ show: false, message: '' });

  // Network State Listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Realtime Multiplexer (SECURE LAYER: Only connect if Manager)
  useEffect(() => {
    if (!isOnline || !isManager) return;

    const voucherChannel = supabase
      .channel('vouchers-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vouchers' },
        (payload) => {
          queryClient.setQueryData(['vouchers'], (oldData: Voucher[] | undefined) => {
            if (!oldData) return [];
            
            if (payload.eventType === 'INSERT') {
              if (oldData.some(v => v.id === payload.new.id)) return oldData;
              toast.success(`New Ticket Issued: ${payload.new.purchaser_name}`, { position: 'bottom-right' });
              return [payload.new as Voucher, ...oldData];
            }
            if (payload.eventType === 'UPDATE') {
              return oldData.map(v => v.id === payload.new.id ? (payload.new as Voucher) : v);
            }
            if (payload.eventType === 'DELETE') {
              return oldData.filter(v => v.id !== payload.old.id);
            }
            return oldData;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(voucherChannel); 
    };
  }, [isOnline, queryClient, isManager]);

  // SECURE LAYER: Do not fetch PII if user is not a manager
  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['vouchers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vouchers')
        .select('*')
        .order('purchase_date', { ascending: false })
        .limit(500); 
      
      if (error) throw error;
      return data as Voucher[];
    },
    enabled: isOnline && isManager,
    staleTime: 1000 * 60 * 60 * 24, 
    gcTime: 1000 * 60 * 60 * 48, 
  });

  // --- MUTATIONS ---

  const issueMutation = useMutation({
    mutationFn: async (payload: typeof issueForm) => {
      const { data, error } = await supabase.functions.invoke('issue-manual-voucher', {
        body: payload,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Vouchers Issued & Emailed Successfully!`);
      setIsIssueModalOpen(false);
      setIssueForm({ 
        customerName: '', 
        customerEmail: '', 
        purchaseDate: new Date().toISOString().split('T')[0],
        transactionId: '',
        experiences: [{ id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0], participants: 1, guests: 0 }]
      });
    },
    onError: (error: any) => {
      toast.error(`Failed to issue voucher: ${error.message}`);
    }
  });

  const redeemMutation = useMutation({
    mutationFn: async ({ code, type }: { code: string, type: 'UUID' | 'MANUAL' }) => {
      if (!session?.user.id) throw new Error("Authentication required");

      const { data: voucher, error: fetchError } = await supabase
        .from('vouchers')
        .select('*')
        .eq(type === 'UUID' ? 'id' : 'voucher_code', code)
        .single();

      if (fetchError || !voucher) throw new Error(`VOUCHER NOT FOUND. Code: ${code}`);
      if (voucher.status === 'REDEEMED') throw new Error(`ALREADY REDEEMED. Used on ${new Date(voucher.redeemed_at!).toLocaleString()}`);
      if (voucher.status === 'CANCELLED') throw new Error("TICKET CANCELLED. This voucher is void.");
      if (voucher.status === 'EXPIRED') throw new Error("TICKET EXPIRED. This voucher is no longer valid.");

      const { error: updateError } = await supabase
        .from('vouchers')
        .update({ 
          status: 'REDEEMED', 
          redeemed_at: new Date().toISOString(),
          redeemed_by: session.user.id
        })
        .eq('id', voucher.id);

      if (updateError) throw updateError;
      return voucher as Voucher;
    },
    onSuccess: (redeemedVoucher) => {
      const audio = new Audio('/success-chime.mp3'); 
      audio.play().catch(() => {});
      
      setSuccessFlash({ 
        show: true, 
        voucherCode: redeemedVoucher.voucher_code, 
        participants: redeemedVoucher.participants,
        guests: redeemedVoucher.guests
      });
      
      setTimeout(() => setSuccessFlash({ show: false, voucherCode: '', participants: 0, guests: 0 }), 3000); 
      
      if (isManager) {
        queryClient.setQueryData(['vouchers'], (oldData: Voucher[] | undefined) => {
          if (!oldData) return [];
          return oldData.map(v => v.id === redeemedVoucher.id ? redeemedVoucher : v);
        });
      }

      setManualCode('');
      setIsScannerPaused(true);
      setTimeout(() => setIsScannerPaused(false), 1200);
    },
    onError: (error: any) => {
      const audio = new Audio('/error-buzzer.mp3'); 
      audio.play().catch(() => {});

      setErrorFlash({ show: true, message: error.message });
      setTimeout(() => setErrorFlash({ show: false, message: '' }), 4000); 

      setIsScannerPaused(true);
      setTimeout(() => setIsScannerPaused(false), 2000);
    }
  });

  const statusOverrideMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string, newStatus: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' }) => {
      const { error } = await supabase.from('vouchers').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      return { id, newStatus };
    },
    onSuccess: ({ id, newStatus }) => {
      toast.success(`Voucher status updated to ${newStatus}`);
      queryClient.setQueryData(['vouchers'], (oldData: Voucher[] | undefined) => {
        if (!oldData) return [];
        return oldData.map(v => v.id === id ? { ...v, status: newStatus } : v);
      });
      setOpenMenuId(null); 
    },
    onError: (error: any) => toast.error(`Failed to update status: ${error.message}`)
  });

  // --- HANDLERS ---

  const handleScan = (detectedCodes: { rawValue: string }[]) => {
    if (isScannerPaused || redeemMutation.isPending || detectedCodes.length === 0) return;
    const scannedCode = detectedCodes[0].rawValue.trim();
    if (!scannedCode) return;
    const isUUID = scannedCode.length === 36 && scannedCode.includes('-');
    redeemMutation.mutate({ code: scannedCode, type: isUUID ? 'UUID' : 'MANUAL' });
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    redeemMutation.mutate({ code: manualCode.trim().toUpperCase(), type: 'MANUAL' });
  };

  const handleIssueSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueForm.customerName || !issueForm.customerEmail || !issueForm.purchaseDate || issueForm.experiences.length === 0) {
      return toast.error("Please fill in all required fields and add at least one experience.");
    }
    issueMutation.mutate(issueForm);
  };

  const updateExperience = (id: string, field: string, value: any) => {
    setIssueForm(prev => ({
      ...prev,
      experiences: prev.experiences.map(exp => exp.id === id ? { ...exp, [field]: value } : exp)
    }));
  };

  const removeExperience = (id: string) => {
    setIssueForm(prev => ({
      ...prev,
      experiences: prev.experiences.filter(exp => exp.id !== id)
    }));
  };

  const addExperience = () => {
    setIssueForm(prev => ({
      ...prev,
      experiences: [...prev.experiences, { id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0], participants: 1, guests: 0 }]
    }));
  };

  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
      const matchesStatus = filterStatus === 'ALL' || v.status === filterStatus;
      
      const vDate = new Date(v.purchase_date);
      vDate.setHours(0, 0, 0, 0); 
      
      const start = startDate ? new Date(startDate) : null;
      if (start) start.setHours(0, 0, 0, 0);
      
      const end = endDate ? new Date(endDate) : null;
      if (end) end.setHours(23, 59, 59, 999);

      const matchesDate = (!start || vDate >= start) && (!end || vDate <= end);
      const matchesExperience = !experienceFilter || v.experience_type.toLowerCase().includes(experienceFilter.toLowerCase());
      
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        v.purchaser_name.toLowerCase().includes(searchLower) ||
        v.purchaser_email.toLowerCase().includes(searchLower) ||
        v.voucher_code.toLowerCase().includes(searchLower) ||
        (v.transaction_id && v.transaction_id.toLowerCase().includes(searchLower));

      return matchesStatus && matchesDate && matchesExperience && matchesSearch;
    });
  }, [vouchers, filterStatus, startDate, endDate, experienceFilter, searchQuery]);

  if (!isOnline) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <XCircle size={64} className="text-rose-500 mb-4" />
        <h1 className="text-2xl font-black text-slate-900 uppercase tracking-widest mb-2">NETWORK REQUIRED</h1>
        <p className="text-slate-600 max-w-md">
          Voucher redemption is strictly disabled while offline to prevent double-spending and ensure financial integrity. Please reconnect the iPad to Wi-Fi.
        </p>
      </div>
    );
  }

  // --- MODALS ---
  const issueModalContent = isIssueModalOpen && (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 max-h-[90vh]">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h2 className="font-black text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">
            <Plus size={16} className="text-emerald-600"/> Issue Vouchers (Cart)
          </h2>
          <button onClick={() => setIsIssueModalOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors"><XCircle size={20} /></button>
        </div>
        
        <form onSubmit={handleIssueSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
            
            {/* Customer & Transaction Meta */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Customer Name</label>
                <input type="text" required value={issueForm.customerName} onChange={e => setIssueForm({...issueForm, customerName: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Customer Email</label>
                <input type="email" required value={issueForm.customerEmail} onChange={e => setIssueForm({...issueForm, customerEmail: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Purchase Date</label>
                <input type="date" required value={issueForm.purchaseDate} onChange={e => setIssueForm({...issueForm, purchaseDate: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Transaction ID (Optional)</label>
                <input type="text" value={issueForm.transactionId} onChange={e => setIssueForm({...issueForm, transactionId: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              </div>
            </div>

            {/* Experience Cart Builder */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-800">Experiences Cart</h3>
                <button type="button" onClick={addExperience} className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                  <Plus size={12}/> Add Item
                </button>
              </div>

              <div className="space-y-3">
                {issueForm.experiences.map((exp, index) => (
                  <div key={exp.id} className="grid grid-cols-12 gap-3 items-end bg-white border border-slate-200 p-3 rounded-xl relative group">
                    <div className="col-span-12 md:col-span-6">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Experience Type</label>
                      <select required value={exp.itemName} onChange={e => updateExperience(exp.id, 'itemName', e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
                        {EXPERIENCE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div className="col-span-5 md:col-span-2">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Parts.</label>
                      <input type="number" min="1" required value={exp.participants} onChange={e => updateExperience(exp.id, 'participants', parseInt(e.target.value) || 1)} className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div className="col-span-5 md:col-span-2">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Guests</label>
                      <input type="number" min="0" required value={exp.guests} onChange={e => updateExperience(exp.id, 'guests', parseInt(e.target.value) || 0)} className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div className="col-span-2 md:col-span-2 flex justify-end pb-1">
                      {issueForm.experiences.length > 1 && (
                        <button type="button" onClick={() => removeExperience(exp.id)} className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
          
          <div className="p-5 flex justify-end gap-3 border-t border-slate-100 bg-slate-50 shrink-0">
            <button type="button" onClick={() => setIsIssueModalOpen(false)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors uppercase tracking-widest">Cancel</button>
            <button type="submit" disabled={issueMutation.isPending || issueForm.experiences.length === 0} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2 uppercase tracking-widest">
              {issueMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />}
              {issueMutation.isPending ? 'Generating Cart...' : 'Issue All Tickets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 relative" onClick={() => setOpenMenuId(null)}>
      
      {/* 🟢 UNMISSABLE SUCCESS FLASH */}
      {successFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-emerald-500 text-white p-8 md:p-12 shadow-2xl rounded-2xl flex flex-col items-center justify-center border-b-8 border-emerald-700 w-full max-w-2xl mx-4">
            <CheckCircle2 className="w-24 h-24 mb-4 animate-bounce" />
            <h2 className="text-4xl md:text-5xl font-black uppercase tracking-widest text-center">Valid & Redeemed</h2>
            <p className="text-xl md:text-2xl font-bold mt-4 opacity-90 text-center">
              Code: {successFlash.voucherCode}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <div className="bg-emerald-700 px-8 py-3 rounded-full text-2xl font-black flex items-center gap-2 shadow-inner">
                <Calendar className="w-7 h-7"/> {successFlash.participants} Participants
              </div>
              {successFlash.guests > 0 && (
                 <div className="bg-emerald-600 px-8 py-3 rounded-full text-2xl font-black flex items-center gap-2 border-2 border-emerald-400 shadow-inner">
                   + {successFlash.guests} Guests
                 </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🔴 UNMISSABLE ERROR FLASH */}
      {errorFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-rose-600 text-white p-8 md:p-12 shadow-2xl rounded-2xl flex flex-col items-center justify-center border-b-8 border-rose-800 w-full max-w-2xl mx-4">
            <XCircle className="w-24 h-24 mb-4 animate-pulse" />
            <h2 className="text-4xl md:text-5xl font-black uppercase tracking-widest text-center">Redemption Failed</h2>
            <div className="mt-6 bg-rose-800/50 border border-rose-400 p-6 rounded-xl w-full">
              <p className="text-lg md:text-xl font-bold text-center leading-relaxed">
                {errorFlash.message}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* RENDER MODAL */}
      {isIssueModalOpen && createPortal(issueModalContent, document.body)}

      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-3">
            <Ticket className="text-emerald-600" size={28} />
            Ticketing & Redemption
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">Scan or manually validate KOA Voucher codes for admission.</p>
        </div>
        {isManager && (
          <button 
            onClick={() => setIsIssueModalOpen(true)}
            className="group flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0"
          >
            <Plus size={16} className="group-hover:scale-110 transition-transform"/> Issue Voucher
          </button>
        )}
      </div>

      {/* DYNAMIC GRID: Adapts based on user permissions */}
      <div className={`grid grid-cols-1 gap-6 ${isManager ? 'lg:grid-cols-12' : 'max-w-2xl mx-auto'}`}>
        
        {/* LEFT COLUMN: THE REDEMPTION CONSOLE */}
        <div className={`${isManager ? 'lg:col-span-4' : 'col-span-1'} space-y-6`}>
          
          {/* SEAMLESS CAMERA SCANNER WIDGET */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between z-10 relative">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                <QrCode size={16} className="text-indigo-600"/> Auto-Scanner
              </h2>
              {isScannerPaused && (
                 <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                   Ready in 1s...
                 </span>
              )}
            </div>
            
            <div className={`w-full bg-slate-900 relative overflow-hidden flex items-center justify-center ${isManager ? 'h-56 md:h-64 lg:h-auto lg:aspect-square max-h-[350px]' : 'aspect-square'}`}>
                <Scanner 
                    onScan={handleScan}
                    paused={isScannerPaused || redeemMutation.isPending}
                    formats={['qr_code']} 
                    components={{ audio: false, onOff: false, torch: true }}
                    styles={{ container: { width: '100%', height: '100%' }, video: { objectFit: 'cover' } }}
                />
                {(isScannerPaused || redeemMutation.isPending) && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-20 transition-all">
                        <Loader2 size={48} className="text-white animate-spin" />
                    </div>
                )}
            </div>
          </div>

          {/* MANUAL ENTRY WIDGET */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                <Search size={16} className="text-amber-600"/> Manual Validation
              </h2>
            </div>
            <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Validate Code Directly</label>
                <input
                  type="text"
                  placeholder="e.g. KOA-X7M9-P2B4"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-black text-slate-800 placeholder:text-slate-300 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none uppercase tracking-widest"
                />
              </div>
              <button 
                type="submit" 
                disabled={!manualCode.trim() || redeemMutation.isPending}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {redeemMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Validate Code
              </button>
            </form>
          </div>

          {!isManager && (
             <div className="flex items-center justify-center gap-2 text-slate-400 p-4">
               <ShieldAlert size={14} />
               <span className="text-[10px] font-black uppercase tracking-widest">Customer Directory Access Restricted</span>
             </div>
          )}

        </div>

        {/* RIGHT COLUMN: RECENT VOUCHERS DASHBOARD (SECURE LAYER: Manager Only) */}
        {isManager && (
          <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[850px] lg:h-[700px]">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-3">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2 mb-2 md:mb-0">
                <Clock size={16} className="text-emerald-600"/> Voucher Directory
              </h2>
              <div className="flex flex-wrap bg-white rounded-lg p-1 border border-slate-200 shadow-sm gap-1 w-full md:w-auto">
                {['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'ALL'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status as any)}
                    className={`flex-1 md:flex-none px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-colors ${filterStatus === status ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* FILTERS SECTION */}
            <div className="p-4 border-b border-slate-100 bg-white grid grid-cols-1 md:grid-cols-4 gap-3 shrink-0">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Search Directory</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input 
                    type="text" 
                    placeholder="Search Name, Email, Code or Txn ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 text-sm border-slate-200 rounded-lg p-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Start Date</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-sm border-slate-200 rounded-lg p-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">End Date</label>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-sm border-slate-200 rounded-lg p-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-0 pb-20">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                  <Loader2 size={32} className="animate-spin" />
                  <span className="text-xs font-bold uppercase tracking-widest">Syncing with Registry...</span>
                </div>
              ) : filteredVouchers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 p-8">
                  <Ticket size={48} className="opacity-20" />
                  <span className="text-xs font-bold uppercase tracking-widest">No Vouchers Found</span>
                  {searchQuery && <span className="text-sm text-slate-500 mt-2 text-center">No results for "{searchQuery}"</span>}
                </div>
              ) : (
                <>
                  {/* 📱 MOBILE LAYOUT (Cards) 📱 */}
                  <div className="md:hidden flex flex-col p-4 gap-4">
                    {filteredVouchers.map((v) => (
                        <div key={v.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm relative">
                          <div className="flex justify-between items-start mb-3">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded">{v.voucher_code}</span>
                              {v.status === 'ACTIVE' ? (
                                  <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-800">Active</span>
                                ) : v.status === 'REDEEMED' ? (
                                  <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600">Redeemed</span>
                                ) : v.status === 'EXPIRED' ? (
                                  <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800">Expired</span>
                                ) : (
                                  <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-rose-100 text-rose-800">Cancelled</span>
                                )}
                          </div>
                          <div className="mb-2">
                            <p className="text-sm font-bold text-slate-900">{v.purchaser_name}</p>
                            <p className="text-[10px] text-slate-500 font-medium">{v.purchaser_email} • {new Date(v.purchase_date).toLocaleDateString()}</p>
                          </div>
                          <div className="mb-3 flex flex-wrap gap-2">
                            <span className="text-xs font-bold text-slate-700 bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded">{v.experience_type}</span>
                            <span className="text-[10px] font-medium text-slate-500 flex items-center gap-1"><Calendar size={10}/> {v.participants} P / {v.guests} G</span>
                          </div>
                          
                          {/* MOBILE MENU */}
                          {hasPermission('vouchers:manage') && v.status !== 'REDEEMED' && (
                              <div className="absolute bottom-4 right-4 text-left" onClick={(e) => e.stopPropagation()}>
                                <button 
                                  onClick={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                                  className="p-1.5 bg-slate-100 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                  <MoreVertical size={16} />
                                </button>
                                
                                {openMenuId === v.id && (
                                  <div className="absolute bottom-10 right-0 mt-2 w-40 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                                    <div className="p-1 flex flex-col gap-1">
                                        {v.status !== 'ACTIVE' && (
                                          <button 
                                            onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'ACTIVE' })}
                                            className="w-full text-left px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg flex items-center gap-2"
                                          >
                                            <CheckCircle2 size={14}/> Reactivate
                                          </button>
                                        )}
                                        {v.status !== 'EXPIRED' && (
                                          <button 
                                            onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'EXPIRED' })}
                                            className="w-full text-left px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 rounded-lg flex items-center gap-2"
                                          >
                                            <Clock size={14}/> Mark Expired
                                          </button>
                                        )}
                                        {v.status !== 'CANCELLED' && (
                                          <button 
                                            onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'CANCELLED' })}
                                            className="w-full text-left px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-lg flex items-center gap-2"
                                          >
                                            <Ban size={14}/> Cancel Ticket
                                          </button>
                                        )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                    ))}
                  </div>

                  {/* 💻 DESKTOP LAYOUT (Table) 💻 */}
                  <div className="hidden md:block">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Purchaser</th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Experience</th>
                          <th className="py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Status</th>
                          <th className="py-3 px-4 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredVouchers.map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded">{v.voucher_code}</span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-900">{v.purchaser_name}</span>
                                <span className="text-[10px] text-slate-500 font-medium">{v.purchaser_email}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700 bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded w-fit">{v.experience_type}</span>
                                <span className="text-[10px] font-medium text-slate-500 mt-1 flex items-center gap-1"><Calendar size={10}/> {v.participants} Pct / {v.guests} Gst</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {v.status === 'ACTIVE' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-800">
                                  Active
                                </span>
                              ) : v.status === 'REDEEMED' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600">
                                  Redeemed
                                </span>
                              ) : v.status === 'EXPIRED' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-800">
                                  Expired
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-rose-100 text-rose-800">
                                  Cancelled
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right relative">
                              {/* MANUAL OVERRIDE MENU */}
                              {hasPermission('vouchers:manage') && v.status !== 'REDEEMED' && (
                                <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                                    <button 
                                      onClick={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                      <MoreVertical size={16} />
                                    </button>
                                    
                                    {openMenuId === v.id && (
                                      <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                                        <div className="p-2 border-b border-slate-100 bg-slate-50">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Manual Override</p>
                                        </div>
                                        <div className="p-1 flex flex-col gap-1">
                                            {v.status !== 'ACTIVE' && (
                                              <button 
                                                onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'ACTIVE' })}
                                                className="w-full text-left px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg flex items-center gap-2"
                                              >
                                                <CheckCircle2 size={14}/> Reactivate
                                              </button>
                                            )}
                                            {v.status !== 'EXPIRED' && (
                                              <button 
                                                onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'EXPIRED' })}
                                                className="w-full text-left px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 rounded-lg flex items-center gap-2"
                                              >
                                                <Clock size={14}/> Mark Expired
                                              </button>
                                            )}
                                            {v.status !== 'CANCELLED' && (
                                              <button 
                                                onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'CANCELLED' })}
                                                className="w-full text-left px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-lg flex items-center gap-2"
                                              >
                                                <Ban size={14}/> Cancel Ticket
                                              </button>
                                            )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
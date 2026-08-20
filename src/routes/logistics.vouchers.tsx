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
  Ban, Plus, Trash2, ShieldAlert, WifiOff
} from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

export const Route = createFileRoute('/logistics/vouchers')({
  component: VouchersDashboard,
});

type Voucher = {
  id: string; 
  voucher_code: string; 
  experience_type: string;
  item_name?: string;
  purchaser_name: string;
  purchaser_email: string;
  participants: number;
  guests: number;
  status: 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  purchase_date: string;
  redeemed_at: string | null;
  transaction_id: string;
};

// ------------------------------------------------------------------
// UPDATED KOA EXPERIENCE OPTIONS (Full Alignment)
// ------------------------------------------------------------------
const EXPERIENCE_OPTIONS = [
  "The Owl Experience",
  "The Owl Encounter",
  "The Owl and Meerkat Experience",
  "Meet the Meerkats",
  "Junior Keeper's Experience",
  "The Children's experience",
  "Static Owl and Animal Workshop",
  "Full Day Owl and Animal Workshop",
  "Photo Workshop",
  "Full Day Photo Workshop",
  "The Big Snake Experience",
  "The Eagle Experience",
  "The Raptor Experience",
  "Skunk Meet and Greet",
  "Ferret Meet and Greet",
  "Lizard Meet and Greet",
  "Owl Meet and Greet",
  "Tawny Frogmouth Meet and Greet",
  "American Kestrel Meet and Greet",
  "Tenrec Meet and Greet",
  "Snake Meet and Greet",
  "Christmas Sale - Owl Encounter",
  "Adoption Meet and Greet"
];

const STATUS_TABS = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'ALL'] as const;

function VouchersDashboard() {
  const { session, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  
  const isManager = hasPermission('vouchers:manage');

  const [manualCode, setManualCode] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'>('ACTIVE');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isScannerPaused, setIsScannerPaused] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Issue Voucher Modal State
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

  // Flash Alerts
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

  // Realtime Multiplexer
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

  // Fetch Vouchers (Manager only)
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
    onSuccess: () => {
      toast.success('Vouchers issued and emailed successfully.');
      setIsIssueModalOpen(false);
      setIssueForm({ 
        customerName: '', 
        customerEmail: '', 
        purchaseDate: new Date().toISOString().split('T')[0],
        transactionId: '',
        experiences: [{ id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0], participants: 1, guests: 0 }]
      });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
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
      
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        v.purchaser_name?.toLowerCase().includes(searchLower) ||
        v.purchaser_email?.toLowerCase().includes(searchLower) ||
        v.voucher_code?.toLowerCase().includes(searchLower) ||
        v.experience_type?.toLowerCase().includes(searchLower) ||
        v.item_name?.toLowerCase().includes(searchLower) ||
        (v.transaction_id && v.transaction_id.toLowerCase().includes(searchLower));

      return matchesStatus && matchesDate && matchesSearch;
    });
  }, [vouchers, filterStatus, startDate, endDate, searchQuery]);

  if (!isOnline) {
    return (
      <div className="bg-rose-50 border-2 border-rose-300 p-8 rounded-2xl shadow-sm flex flex-col items-center justify-center min-h-[50vh] text-center max-w-2xl mx-auto my-12">
        <WifiOff size={48} className="text-rose-600 mb-4" />
        <h1 className="text-xl font-black text-rose-900 uppercase tracking-widest mb-2">Network Required</h1>
        <p className="text-sm font-medium text-rose-700 max-w-md">
          Voucher redemption is strictly disabled while offline to prevent double-spending and ensure financial integrity. Please reconnect to Wi-Fi.
        </p>
      </div>
    );
  }

  // --- MODAL PORTAL ---
  const issueModalContent = isIssueModalOpen && (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 max-h-[90vh]">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm">Issue Experience Voucher</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Manual provision & automated email dispatch</p>
          </div>
          <button onClick={() => setIsIssueModalOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100"><XCircle size={20} /></button>
        </div>
        
        <form onSubmit={handleIssueSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
            
            {/* Customer & Transaction Meta */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Customer Name *</label>
                <input type="text" required value={issueForm.customerName} onChange={e => setIssueForm({...issueForm, customerName: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Customer Email *</label>
                <input type="email" required value={issueForm.customerEmail} onChange={e => setIssueForm({...issueForm, customerEmail: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Purchase Date *</label>
                <input type="date" required value={issueForm.purchaseDate} onChange={e => setIssueForm({...issueForm, purchaseDate: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Transaction ID (Optional)</label>
                <input type="text" placeholder="e.g. MANUAL-12345" value={issueForm.transactionId} onChange={e => setIssueForm({...issueForm, transactionId: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" />
              </div>
            </div>

            {/* Experience Cart Builder */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-800">Experience Items</h3>
                <button type="button" onClick={addExperience} className="text-[10px] font-black uppercase tracking-widest text-slate-900 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                  <Plus size={12}/> Add Item
                </button>
              </div>

              <div className="space-y-3">
                {issueForm.experiences.map((exp) => (
                  <div key={exp.id} className="grid grid-cols-12 gap-3 items-end bg-white border border-slate-200 p-3.5 rounded-xl shadow-sm">
                    <div className="col-span-12 md:col-span-6">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Experience Type</label>
                      <select required value={exp.itemName} onChange={e => updateExperience(exp.id, 'itemName', e.target.value)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none">
                        {EXPERIENCE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div className="col-span-5 md:col-span-2">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Parts.</label>
                      <input type="number" min="1" required value={exp.participants} onChange={e => updateExperience(exp.id, 'participants', parseInt(e.target.value) || 1)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" />
                    </div>
                    <div className="col-span-5 md:col-span-2">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Guests</label>
                      <input type="number" min="0" required value={exp.guests} onChange={e => updateExperience(exp.id, 'guests', parseInt(e.target.value) || 0)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" />
                    </div>
                    <div className="col-span-2 md:col-span-2 flex justify-end pb-0.5">
                      {issueForm.experiences.length > 1 && (
                        <button type="button" onClick={() => removeExperience(exp.id)} className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors">
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
            <button type="button" onClick={() => setIsIssueModalOpen(false)} className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors uppercase tracking-widest">Cancel</button>
            <button type="submit" disabled={issueMutation.isPending || issueForm.experiences.length === 0} className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black rounded-xl disabled:opacity-50 transition-colors flex items-center gap-2 uppercase tracking-widest shadow-sm active:scale-95">
              {issueMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />}
              {issueMutation.isPending ? 'Issuing...' : 'Issue All Tickets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full" onClick={() => setOpenMenuId(null)}>
      
      {/* 🟢 SUCCESS FLASH */}
      {successFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-emerald-500 text-white p-8 md:p-12 shadow-2xl rounded-2xl flex flex-col items-center justify-center border-b-8 border-emerald-700 w-full max-w-2xl mx-4">
            <CheckCircle2 className="w-24 h-24 mb-4 animate-bounce" />
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-widest text-center">Valid & Redeemed</h2>
            <p className="text-lg md:text-2xl font-bold mt-4 opacity-90 text-center">
              Code: {successFlash.voucherCode}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <div className="bg-emerald-700 px-8 py-3 rounded-full text-xl md:text-2xl font-black flex items-center gap-2 shadow-inner">
                <Calendar className="w-6 h-6"/> {successFlash.participants} Participants
              </div>
              {successFlash.guests > 0 && (
                 <div className="bg-emerald-600 px-8 py-3 rounded-full text-xl md:text-2xl font-black flex items-center gap-2 border-2 border-emerald-400 shadow-inner">
                    + {successFlash.guests} Guests
                 </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🔴 ERROR FLASH */}
      {errorFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-rose-600 text-white p-8 md:p-12 shadow-2xl rounded-2xl flex flex-col items-center justify-center border-b-8 border-rose-800 w-full max-w-2xl mx-4">
            <XCircle className="w-24 h-24 mb-4 animate-pulse" />
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-widest text-center">Redemption Failed</h2>
            <div className="mt-6 bg-rose-800/50 border border-rose-400 p-6 rounded-xl w-full">
              <p className="text-base md:text-xl font-bold text-center leading-relaxed">
                {errorFlash.message}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* RENDER MODAL PORTAL */}
      {isIssueModalOpen && createPortal(issueModalContent, document.body)}

      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Ticketing & Redemption
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Validate & Dispatch Official Digital Vouchers
           </p>
        </div>
        
        {isManager && (
          <button 
            onClick={() => setIsIssueModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Issue Voucher</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: MAIN CONTENT GRID --- */}
      <div className={`grid grid-cols-1 gap-6 flex-1 min-h-0 ${isManager ? 'lg:grid-cols-12' : 'max-w-xl mx-auto w-full'}`}>
        
        {/* LEFT COLUMN: SCANNER & MANUAL ENTRY */}
        <div className={`${isManager ? 'lg:col-span-4' : 'col-span-1'} space-y-4 flex flex-col shrink-0`}>
          
          {/* CAMERA SCANNER WIDGET */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                <QrCode size={16} className="text-slate-700"/> Camera Scanner
              </h2>
              {isScannerPaused && (
                 <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                    Ready in 1s...
                 </span>
              )}
            </div>
            
            <div className={`w-full bg-slate-900 relative overflow-hidden flex items-center justify-center ${isManager ? 'h-48 md:h-56' : 'aspect-square max-h-[360px]'}`}>
                <Scanner 
                    onScan={handleScan}
                    paused={isScannerPaused || redeemMutation.isPending}
                    formats={['qr_code']} 
                    components={{ audio: false, onOff: false, torch: true }}
                    styles={{ container: { width: '100%', height: '100%' }, video: { objectFit: 'cover' } }}
                />
                {(isScannerPaused || redeemMutation.isPending) && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-20 transition-all">
                        <Loader2 size={36} className="text-white animate-spin" />
                    </div>
                )}
            </div>
          </div>

          {/* MANUAL ENTRY WIDGET */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                <Search size={16} className="text-slate-700"/> Manual Validation
              </h2>
            </div>
            <form onSubmit={handleManualSubmit} className="p-4 space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Enter Voucher Code</label>
                <input
                  type="text"
                  placeholder="e.g. OE2008260100-A1B2"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-black text-slate-800 placeholder:text-slate-300 focus:ring-2 focus:ring-slate-900 outline-none uppercase tracking-widest"
                />
              </div>
              <button 
                type="submit" 
                disabled={!manualCode.trim() || redeemMutation.isPending}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm active:scale-95"
              >
                {redeemMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Validate Code
              </button>
            </form>
          </div>

          {!isManager && (
             <div className="flex items-center justify-center gap-2 text-slate-400 p-3 bg-slate-50 rounded-xl border border-slate-200">
               <ShieldAlert size={14} />
               <span className="text-[10px] font-black uppercase tracking-widest">Customer Directory Access Restricted</span>
             </div>
          )}
        </div>

        {/* RIGHT COLUMN: VOUCHER DIRECTORY (Manager only) */}
        {isManager && (
          <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
            
            {/* DIRECTORY CONTROL DECK */}
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/80 flex flex-col gap-3 shrink-0">
              
              {/* STATUS PILL TABS */}
              <div className="flex flex-wrap gap-1.5 w-full">
                {STATUS_TABS.map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`px-3 py-1.5 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-widest transition-all shadow-sm ${
                      filterStatus === status 
                        ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                        : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              {/* SEARCH & DATE FILTERS */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-6 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                  <input 
                    type="text" 
                    placeholder="Search name, email, code or txn..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full text-xs bg-white border border-slate-200 rounded-xl py-1.5 px-2.5 font-bold text-slate-700 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full text-xs bg-white border border-slate-200 rounded-xl py-1.5 px-2.5 font-bold text-slate-700 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* DIRECTORY LIST */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-0 bg-slate-50/30">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-slate-400 gap-3">
                  <Loader2 size={28} className="animate-spin text-slate-600" />
                  <span className="text-xs font-black uppercase tracking-widest text-slate-600">Syncing Registry...</span>
                </div>
              ) : filteredVouchers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-slate-400 gap-2 p-8">
                  <Ticket size={40} className="opacity-20" />
                  <span className="text-xs font-black uppercase tracking-widest">No Vouchers Found</span>
                  {searchQuery && <span className="text-xs text-slate-500">No results matching "{searchQuery}"</span>}
                </div>
              ) : (
                <>
                  {/* MOBILE VIEW (Stacked Cards) */}
                  <div className="md:hidden flex flex-col p-3 gap-3">
                    {filteredVouchers.map((v) => (
                      <div key={v.id} className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm relative">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{v.voucher_code}</span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border ${
                            v.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            v.status === 'REDEEMED' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                            v.status === 'EXPIRED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {v.status}
                          </span>
                        </div>
                        <div className="mb-2">
                          <p className="text-xs font-bold text-slate-900">{v.purchaser_name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{v.purchaser_email} • {new Date(v.purchase_date).toLocaleDateString()}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">{v.experience_type}</span>
                          <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1"><Calendar size={10}/> {v.participants}P / {v.guests}G</span>
                        </div>
                        
                        {/* Status Override */}
                        {hasPermission('vouchers:manage') && v.status !== 'REDEEMED' && (
                          <div className="absolute bottom-3 right-3 text-left" onClick={(e) => e.stopPropagation()}>
                            <button 
                              onClick={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                            >
                              <MoreVertical size={14} />
                            </button>
                            {openMenuId === v.id && (
                              <div className="absolute bottom-8 right-0 w-36 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden p-1">
                                {v.status !== 'ACTIVE' && (
                                  <button onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'ACTIVE' })} className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg flex items-center gap-1.5">
                                    <CheckCircle2 size={12}/> Reactivate
                                  </button>
                                )}
                                {v.status !== 'EXPIRED' && (
                                  <button onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'EXPIRED' })} className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-amber-700 hover:bg-amber-50 rounded-lg flex items-center gap-1.5">
                                    <Clock size={12}/> Mark Expired
                                  </button>
                                )}
                                {v.status !== 'CANCELLED' && (
                                  <button onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'CANCELLED' })} className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-50 rounded-lg flex items-center gap-1.5">
                                    <Ban size={12}/> Cancel Ticket
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* DESKTOP VIEW (Table) */}
                  <div className="hidden md:block">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 sticky top-0 z-10 backdrop-blur-md">
                          <th className="py-3 px-4">Code</th>
                          <th className="py-3 px-4">Purchaser</th>
                          <th className="py-3 px-4">Experience</th>
                          <th className="py-3 px-4 text-center">Status</th>
                          <th className="py-3 px-4 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {filteredVouchers.map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{v.voucher_code}</span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-900">{v.purchaser_name}</span>
                                <span className="text-[10px] text-slate-500 font-medium">{v.purchaser_email}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 w-fit">{v.experience_type}</span>
                                <span className="text-[10px] font-medium text-slate-500 mt-0.5 flex items-center gap-1"><Calendar size={10}/> {v.participants}P / {v.guests}G</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${
                                v.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                v.status === 'REDEEMED' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                                v.status === 'EXPIRED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-rose-50 text-rose-700 border-rose-200'
                              }`}>
                                {v.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right relative">
                              {hasPermission('vouchers:manage') && v.status !== 'REDEEMED' && (
                                <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                                  <button 
                                    onClick={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                                  >
                                    <MoreVertical size={14} />
                                  </button>
                                  
                                  {openMenuId === v.id && (
                                    <div className="absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden p-1">
                                      {v.status !== 'ACTIVE' && (
                                        <button onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'ACTIVE' })} className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg flex items-center gap-1.5">
                                          <CheckCircle2 size={12}/> Reactivate
                                        </button>
                                      )}
                                      {v.status !== 'EXPIRED' && (
                                        <button onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'EXPIRED' })} className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-amber-700 hover:bg-amber-50 rounded-lg flex items-center gap-1.5">
                                          <Clock size={12}/> Mark Expired
                                        </button>
                                      )}
                                      {v.status !== 'CANCELLED' && (
                                        <button onClick={() => statusOverrideMutation.mutate({ id: v.id, newStatus: 'CANCELLED' })} className="w-full text-left px-2.5 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-50 rounded-lg flex items-center gap-1.5">
                                          <Ban size={12}/> Cancel Ticket
                                        </button>
                                      )}
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

export default VouchersDashboard;
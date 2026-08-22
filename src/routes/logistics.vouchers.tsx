import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Ticket, QrCode, Search, CheckCircle2, 
  XCircle, Clock, Loader2, Calendar, MoreVertical, 
  Ban, Plus, Trash2, WifiOff, X
} from 'lucide-react';
import { toast } from 'sonner';
import { Scanner } from '@yudiel/react-qr-scanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Voucher } from '../types';

const vouchersOptions = queryOptions({
  queryKey: ['vouchers'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .order('purchase_date', { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data || []) as Voucher[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/logistics/vouchers')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(vouchersOptions);
    }
  },
  component: VouchersDashboard,
});

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

const STATUS_TABS = ['ALL', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED'] as const;

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

export function VouchersDashboard() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const isManager = hasPermission('vouchers:manage') || ['DIRECTOR', 'ADMIN', 'MANAGER'].includes(profile?.role || '');

  const [activeViewTab, setActiveViewTab] = useState<'SCANNER' | 'DIRECTORY'>('SCANNER');
  const [manualCode, setManualCode] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'>('ACTIVE');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isScannerPaused, setIsScannerPaused] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueForm, setIssueForm] = useState({
    customerName: '',
    customerEmail: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    transactionId: '',
    experiences: [{ id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0], participants: 1, guests: 0 }]
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [successFlash, setSuccessFlash] = useState<{ show: boolean; voucherCode: string; participants: number; guests: number }>({ show: false, voucherCode: '', participants: 0, guests: 0 });
  const [errorFlash, setErrorFlash] = useState<{ show: boolean; message: string }>({ show: false, message: '' });

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

  useEffect(() => {
    if (!isOnline) return;

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
              toast.success(`New Ticket Issued: ${payload.new.purchaser_name}`);
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
  }, [isOnline, queryClient]);

  const { data: vouchers = [], isLoading } = useQuery(vouchersOptions);

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
    mutationFn: async ({ code, type }: { code: string; type: 'UUID' | 'MANUAL' }) => {
      if (!user?.id) throw new Error("Authentication required");

      const { data: voucher, error: fetchError } = await supabase
        .from('vouchers')
        .select('*')
        .eq(type === 'UUID' ? 'id' : 'voucher_code', code)
        .single();

      if (fetchError || !voucher) throw new Error(`VOUCHER NOT FOUND: ${code}`);
      if (voucher.status === 'REDEEMED') throw new Error(`ALREADY REDEEMED on ${new Date(voucher.redeemed_at!).toLocaleString('en-GB')}`);
      if (voucher.status === 'CANCELLED') throw new Error("TICKET CANCELLED. This voucher is void.");
      if (voucher.status === 'EXPIRED') throw new Error("TICKET EXPIRED. This voucher is no longer valid.");

      const { error: updateError } = await supabase
        .from('vouchers')
        .update({ 
          status: 'REDEEMED', 
          redeemed_at: new Date().toISOString(),
          redeemed_by: user.id
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
      
      setTimeout(() => setSuccessFlash({ show: false, voucherCode: '', participants: 0, guests: 0 }), 3500); 
      
      queryClient.setQueryData(['vouchers'], (oldData: Voucher[] | undefined) => {
        if (!oldData) return [];
        return oldData.map(v => v.id === redeemedVoucher.id ? { ...v, status: 'REDEEMED', redeemed_at: new Date().toISOString() } : v);
      });

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
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' }) => {
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

  const handleScan = (detectedCodes: any[]) => {
    if (isScannerPaused || redeemMutation.isPending || !detectedCodes || detectedCodes.length === 0) return;
    const rawVal = detectedCodes[0]?.rawValue || detectedCodes[0]?.value || '';
    const scannedCode = String(rawVal).trim();
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
      
      const vDate = new Date(v.purchase_date || '');
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

  const rowVirtualizer = useVirtualizer({
    count: filteredVouchers.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => (isMobile ? 120 : 64),
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(180px, 1.3fr) minmax(200px, 1.5fr) minmax(260px, 2fr) minmax(130px, 0.9fr) minmax(110px, 0.8fr) minmax(60px, 0.4fr)";

  if (!isOnline) {
    return (
      <div className="bg-rose-50 border border-rose-200 p-8 rounded-2xl shadow-sm flex flex-col items-center justify-center min-h-[50vh] text-center max-w-xl mx-auto my-12">
        <WifiOff size={40} className="text-rose-600 mb-3" />
        <h2 className="text-base font-black text-rose-900 uppercase tracking-widest mb-1">Network Connection Required</h2>
        <p className="text-xs font-medium text-rose-700 max-w-md leading-relaxed">
          Voucher check-in and redemption require a live server connection to prevent ticket duplication. Please reconnect to Wi-Fi.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 animate-in fade-in duration-300 w-full font-sans" onClick={() => setOpenMenuId(null)}>
      
      {/* SUCCESS FLASH */}
      {successFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-emerald-600 text-white p-8 md:p-12 shadow-2xl rounded-2xl flex flex-col items-center justify-center border-b-8 border-emerald-800 w-full max-w-xl mx-auto">
            <CheckCircle2 className="w-20 h-20 mb-3 animate-bounce" />
            <h2 className="text-2xl md:text-4xl font-black uppercase tracking-widest text-center">Ticket Valid & Redeemed</h2>
            <p className="text-sm md:text-lg font-mono font-bold mt-2 opacity-90 text-center bg-emerald-700/60 px-4 py-1.5 rounded-lg border border-emerald-500">
              {successFlash.voucherCode}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <div className="bg-emerald-800 px-6 py-2.5 rounded-full text-sm md:text-base font-black flex items-center gap-2 shadow-inner">
                <Calendar className="w-4 h-4"/> {successFlash.participants} Participant{successFlash.participants > 1 ? 's' : ''}
              </div>
              {successFlash.guests > 0 && (
                <div className="bg-emerald-700 px-6 py-2.5 rounded-full text-sm md:text-base font-black flex items-center gap-2 border border-emerald-400 shadow-inner">
                  + {successFlash.guests} Guest{successFlash.guests > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ERROR FLASH */}
      {errorFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-rose-600 text-white p-8 md:p-10 shadow-2xl rounded-2xl flex flex-col items-center justify-center border-b-8 border-rose-800 w-full max-w-xl mx-auto">
            <XCircle className="w-20 h-20 mb-3 animate-pulse" />
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-widest text-center">Validation Failed</h2>
            <div className="mt-4 bg-rose-900/60 border border-rose-400 p-4 rounded-xl w-full text-center">
              <p className="text-xs md:text-sm font-bold leading-relaxed">{errorFlash.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="flex justify-between items-start w-full shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1">
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
            className="hidden lg:flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Issue Voucher</span>
          </button>
        )}
      </div>

      {/* VIEW TABS */}
      <div className="flex gap-2 w-full shrink-0">
        <button
          onClick={() => setActiveViewTab('SCANNER')}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-2 ${
            activeViewTab === 'SCANNER'
              ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
              : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
          }`}
        >
          <QrCode size={15} className={activeViewTab === 'SCANNER' ? 'text-emerald-400' : 'text-slate-400'} />
          <span>Scan & Validate</span>
        </button>

        {isManager && (
          <button
            onClick={() => setActiveViewTab('DIRECTORY')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-2 ${
              activeViewTab === 'DIRECTORY'
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            <Ticket size={15} className={activeViewTab === 'DIRECTORY' ? 'text-indigo-400' : 'text-slate-400'} />
            <span>Voucher Directory</span>
            <span className="ml-1 px-2 py-0.5 rounded-full text-[9px] bg-slate-200 text-slate-700 font-bold">
              {vouchers.length}
            </span>
          </button>
        )}
      </div>

      {/* SCANNER VIEW */}
      {activeViewTab === 'SCANNER' && (
        <div className="flex-1 flex flex-col justify-start items-center min-h-0 overflow-y-auto custom-scrollbar p-1">
          <div 
            className="w-full space-y-3 my-auto flex flex-col items-center"
            style={{ maxWidth: 'clamp(320px, 85vw, 480px)' }}
          >
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden w-full flex flex-col">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                  <QrCode size={14} className="text-slate-700"/> Camera QR Scanner
                </h2>
                {isScannerPaused && (
                  <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                    Ready...
                  </span>
                )}
              </div>
              
              <div className="p-3 sm:p-4 bg-slate-50/40 flex items-center justify-center">
                <div 
                  className="aspect-square rounded-2xl overflow-hidden bg-slate-900 relative shadow-inner flex items-center justify-center border-2 border-slate-200"
                  style={{
                    width: 'clamp(230px, 60vw, 360px)',
                    height: 'clamp(230px, 60vw, 360px)'
                  }}
                >
                  <Scanner 
                    onScan={handleScan}
                    paused={isScannerPaused || redeemMutation.isPending}
                    formats={['qr_code']} 
                    components={{ onOff: false, torch: true }}
                    styles={{ 
                      container: { width: '100%', height: '100%' }, 
                      video: { objectFit: 'cover', width: '100%', height: '100%' } 
                    }}
                  />
                  {(isScannerPaused || redeemMutation.isPending) && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-20">
                      <Loader2 size={32} className="text-white animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden w-full flex flex-col">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                  <Search size={14} className="text-slate-700"/> Manual Validation
                </h2>
              </div>
              <form onSubmit={handleManualSubmit} className="p-4 space-y-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                    Enter Voucher Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. OE2008260100-A1B2"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-black text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 outline-none uppercase tracking-widest shadow-sm"
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={!manualCode.trim() || redeemMutation.isPending}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm active:scale-95"
                >
                  {redeemMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>Validate Code</span>
                </button>
              </form>
            </div>

          </div>
        </div>
      )}

      {/* DIRECTORY VIEW */}
      {activeViewTab === 'DIRECTORY' && isManager && (
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-0">
          
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/80 flex flex-col gap-3 shrink-0">
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

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-6 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                <input 
                  type="text" 
                  placeholder="Search name, email, code or txn..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={(e) => setStartDate(e.target.value)} 
                  className="w-full text-xs bg-white border border-slate-200 rounded-xl py-2 px-2.5 font-bold text-slate-700 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={(e) => setEndDate(e.target.value)} 
                  className="w-full text-xs bg-white border border-slate-200 rounded-xl py-2 px-2.5 font-bold text-slate-700 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
            </div>
          </div>

          <div ref={scrollParentRef} className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
            <div 
              className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md min-w-[960px]" 
              style={{ gridTemplateColumns: tableGridCols }}
            >
              <div className="px-5 py-3.5 flex items-center justify-start text-left">Code</div>
              <div className="px-5 py-3.5 flex items-center justify-start text-left">Purchaser Details</div>
              <div className="px-5 py-3.5 flex items-center justify-start text-left">Experience & Allocation</div>
              <div className="px-5 py-3.5 flex items-center justify-start text-left">Purchase Date</div>
              <div className="px-5 py-3.5 flex items-center justify-start text-left">Status</div>
              <div className="px-5 py-3.5 flex items-center justify-end text-right"></div>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
                <Loader2 size={24} className="animate-spin text-slate-600" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-600">Syncing Registry...</span>
              </div>
            ) : filteredVouchers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2 p-8">
                <Ticket size={36} className="opacity-20" />
                <span className="text-xs font-black uppercase tracking-widest">No Vouchers Found</span>
              </div>
            ) : (
              <div 
                className="p-3 lg:p-0 min-w-full lg:min-w-[960px]"
                style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
              >
                {virtualItems.map((virtualRow) => {
                  const v = filteredVouchers[virtualRow.index];

                  return (
                    <div 
                      key={v.id} 
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute top-0 left-0 w-full transition-colors box-border"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className="lg:hidden p-1.5">
                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 hover:border-slate-300 transition-all">
                          <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                                {v.voucher_code}
                              </span>
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${
                                v.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                v.status === 'REDEEMED' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                                v.status === 'EXPIRED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-rose-50 text-rose-700 border-rose-200'
                              }`}>
                                {v.status}
                              </span>
                            </div>

                            {v.status !== 'REDEEMED' && (
                              <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                                <button 
                                  onClick={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                  <MoreVertical size={15} />
                                </button>
                                
                                {openMenuId === v.id && (
                                  <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden p-1">
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

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Purchaser</span>
                              <p className="font-bold text-slate-900 truncate">{v.purchaser_name}</p>
                              <p className="text-[11px] text-slate-500 truncate">{v.purchaser_email}</p>
                            </div>

                            <div className="space-y-0.5">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Experience</span>
                              <p className="font-bold text-slate-800 truncate" title={v.item_name || v.experience_type}>
                                {v.item_name || v.experience_type}
                              </p>
                              <p className="text-[11px] font-medium text-slate-500">
                                {v.participants} Participant{v.participants > 1 ? 's' : ''} {v.guests > 0 ? `• ${v.guests} Guest${v.guests > 1 ? 's' : ''}` : ''}
                              </p>
                            </div>

                            <div className="space-y-0.5 sm:col-span-2 md:col-span-1">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Purchase Date</span>
                              <p className="font-bold text-slate-700 flex items-center gap-1.5">
                                <Calendar size={13} className="text-slate-400"/> {new Date(v.purchase_date || '').toLocaleDateString('en-GB')}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div 
                        className="hidden lg:grid border-b border-slate-100 bg-white hover:bg-slate-50/80 transition-colors"
                        style={{ gridTemplateColumns: tableGridCols }}
                      >
                        <div className="px-5 py-3.5 flex items-center justify-start min-w-0">
                          <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                            {v.voucher_code}
                          </span>
                        </div>

                        <div className="px-5 py-3.5 flex flex-col justify-center min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{v.purchaser_name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{v.purchaser_email}</p>
                        </div>

                        <div className="px-5 py-3.5 flex flex-col justify-center min-w-0">
                          <span className="text-xs font-bold text-slate-800 truncate block" title={v.item_name || v.experience_type}>
                            {v.item_name || v.experience_type}
                          </span>
                          <span className="text-[10px] font-medium text-slate-500 flex items-center gap-1">
                            {v.participants} Participant{v.participants > 1 ? 's' : ''} {v.guests > 0 ? `• ${v.guests} Guest${v.guests > 1 ? 's' : ''}` : ''}
                          </span>
                        </div>

                        <div className="px-5 py-3.5 flex items-center justify-start min-w-0">
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                            <Calendar size={12} className="text-slate-400 shrink-0"/> {new Date(v.purchase_date || '').toLocaleDateString('en-GB')}
                          </span>
                        </div>

                        <div className="px-5 py-3.5 flex items-center justify-start min-w-0">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${
                            v.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            v.status === 'REDEEMED' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                            v.status === 'EXPIRED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {v.status}
                          </span>
                        </div>

                        <div className="px-5 py-3.5 flex items-center justify-end min-w-0">
                          {v.status !== 'REDEEMED' && (
                            <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                              <button 
                                onClick={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <MoreVertical size={14} />
                              </button>
                              
                              {openMenuId === v.id && (
                                <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden p-1">
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

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: ISSUE VOUCHER */}
      {isIssueModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div>
                <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm">Issue Experience Voucher</h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Manual provision & automated email dispatch</p>
              </div>
              <button onClick={() => setIsIssueModalOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
            </div>
            
            <form onSubmit={handleIssueSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
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
      )}

    </div>
  );
}

export default VouchersDashboard;
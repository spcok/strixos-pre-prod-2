import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  AlertTriangle, CheckCircle2, Calendar, Search, 
  Utensils, Scale, Eye, HeartPulse, 
  Download, Loader2, ArrowRight, WifiOff 
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { reportExportService } from '../services/reportExportService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const missingRecordsDataOptions = queryOptions({
  queryKey: ['missing_records_pool'],
  queryFn: async () => {
    const [animalsRes, logsRes, schedulesRes, prescriptionsRes] = await Promise.all([
      supabase
        .from('animals')
        .select('*')
        .neq('status', 'ARCHIVED')
        .neq('status', 'DECEASED')
        .order('name', { ascending: true }),
      supabase
        .from('daily_logs')
        .select('*')
        .order('log_date', { ascending: false }),
      supabase
        .from('feeding_schedules')
        .select('*')
        .eq('is_deleted', false),
      supabase
        .from('prescriptions')
        .select('*')
        .eq('status', 'ACTIVE')
    ]);

    if (animalsRes.error) throw animalsRes.error;

    return {
      animals: animalsRes.data || [],
      logs: logsRes.data || [],
      schedules: schedulesRes.data || [],
      prescriptions: prescriptionsRes.data || []
    };
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// @ts-ignore
export const Route = createFileRoute('/husbandry/missing-records')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(missingRecordsDataOptions);
    }
  },
  component: MissingRecordsPage,
});

const CATEGORY_TABS = ['ALL', 'OWL', 'RAPTOR', 'MAMMAL', 'EXOTIC'] as const;

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

export function MissingRecordsPage() {
  const queryClient = useQueryClient();
  const { profile, user } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'ALL' | 'OBSERVATION' | 'FEEDING' | 'WEIGHT' | 'MEDICATION'>('ALL');
  const [isExporting, setIsExporting] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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

  // Supabase Realtime Listener
  useEffect(() => {
    if (!isOnline) return;
    const channel = supabase
      .channel('missing-records-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['missing_records_pool'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOnline, queryClient]);

  const { data: db, isLoading } = useQuery(missingRecordsDataOptions);

  // ------------------------------------------------------------------
  // AUDIT ENGINE
  // ------------------------------------------------------------------
  const auditedAnimals = useMemo(() => {
    if (!db) return [];

    const targetDateStr = selectedDate;
    const targetDateObj = parseISO(targetDateStr);

    return db.animals.map((animal: any) => {
      // 1. Observation Logs
      const logsForDay = db.logs.filter((l: any) => {
        if (l.animal_id !== animal.id) return false;
        const logDate = l.log_date ? l.log_date.split('T')[0] : '';
        return logDate === targetDateStr;
      });

      const hasObservation = logsForDay.some((l: any) => l.log_type === 'OBSERVATION');

      // 2. Feeding Logs
      const hasFeedLog = logsForDay.some((l: any) => l.log_type === 'FEEDING');
      const scheduledFeeds = db.schedules.filter(
        (s: any) => s.animal_id === animal.id && s.scheduled_date === targetDateStr
      );
      const isFastingDay = scheduledFeeds.some(
        (s: any) => s.notes === 'FAST DAY / NOT REQUIRED' || s.food_type === 'NOT REQUIRED'
      );
      const isFeedRequired = scheduledFeeds.length > 0 && !isFastingDay;
      const missingFeed = isFeedRequired && !hasFeedLog;

      // 3. Weight Logs (7-day window)
      const recentWeightLogs = db.logs.filter((l: any) => {
        if (l.animal_id !== animal.id || l.log_type !== 'WEIGHT' || !l.log_date) return false;
        const logTime = new Date(l.log_date).getTime();
        const targetTime = targetDateObj.getTime();
        const diffDays = Math.abs((targetTime - logTime) / (1000 * 60 * 60 * 24));
        return diffDays <= 7;
      });
      const missingWeight = recentWeightLogs.length === 0;

      // 4. Prescriptions
      const activeMeds = db.prescriptions.filter((p: any) => p.animal_id === animal.id);
      const hasMedLog = logsForDay.some((l: any) => l.log_type === 'MEDICATION' || l.log_type === 'CLINICAL');
      const missingMed = activeMeds.length > 0 && !hasMedLog;

      const missingCount =
        (!hasObservation ? 1 : 0) +
        (missingFeed ? 1 : 0) +
        (missingWeight ? 1 : 0) +
        (missingMed ? 1 : 0);

      return {
        ...animal,
        hasObservation,
        missingObservation: !hasObservation,
        hasFeedLog,
        isFeedRequired,
        isFastingDay,
        missingFeed,
        missingWeight,
        activeMedsCount: activeMeds.length,
        missingMed,
        missingCount,
        isFullyCompliant: missingCount === 0
      };
    });
  }, [db, selectedDate]);

  // Filtered List
  const filteredList = useMemo(() => {
    return auditedAnimals.filter((animal: any) => {
      const inCategory = selectedCategory === 'ALL' || animal.category === selectedCategory;

      const matchesSearch =
        !searchQuery.trim() ||
        animal.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        animal.species?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        animal.ring_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        animal.enclosure?.toLowerCase().includes(searchQuery.toLowerCase());

      let matchesType = true;
      if (filterType === 'OBSERVATION') matchesType = animal.missingObservation;
      if (filterType === 'FEEDING') matchesType = animal.missingFeed;
      if (filterType === 'WEIGHT') matchesType = animal.missingWeight;
      if (filterType === 'MEDICATION') matchesType = animal.missingMed;

      return inCategory && matchesSearch && matchesType && animal.missingCount > 0;
    });
  }, [auditedAnimals, selectedCategory, searchQuery, filterType]);

  // Stats Breakdown
  const stats = useMemo(() => {
    const totalAnimals = auditedAnimals.length;
    const compliantAnimals = auditedAnimals.filter((a: any) => a.isFullyCompliant).length;
    const missingObservations = auditedAnimals.filter((a: any) => a.missingObservation).length;
    const missingFeeds = auditedAnimals.filter((a: any) => a.missingFeed).length;
    const missingWeights = auditedAnimals.filter((a: any) => a.missingWeight).length;
    const missingMeds = auditedAnimals.filter((a: any) => a.missingMed).length;

    const compliancePercent = totalAnimals > 0 ? Math.round((compliantAnimals / totalAnimals) * 100) : 100;

    return {
      totalAnimals,
      compliantAnimals,
      missingObservations,
      missingFeeds,
      missingWeights,
      missingMeds,
      compliancePercent
    };
  }, [auditedAnimals]);

  const rowVirtualizer = useVirtualizer({
    count: filteredList.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => (isMobile ? 190 : 72),
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(220px, 1.6fr) minmax(130px, 0.9fr) minmax(280px, 2fr) minmax(130px, 0.9fr)";

  const handleExportAudit = async () => {
    if (!isOnline) {
      toast.error('Exporting compliance reports requires an active network connection.');
      return;
    }

    setIsExporting(true);
    try {
      const headers = ['Animal Name', 'Species', 'Category', 'Enclosure', 'Missing Protocols'];
      const exportRows = filteredList.map((a: any) => {
        const issues = [];
        if (a.missingObservation) issues.push('Daily Observation');
        if (a.missingFeed) issues.push('Scheduled Feed');
        if (a.missingWeight) issues.push('Weekly Weight Record');
        if (a.missingMed) issues.push('Active Medication Administration');

        return [
          a.name,
          a.species || '-',
          a.category || '-',
          a.enclosure || '-',
          issues.join(', ') || 'Fully Compliant'
        ];
      });

      await reportExportService.exportSingleReport(
        {
          title: `Husbandry Non-Compliance Audit - ${format(parseISO(selectedDate), 'dd MMM yyyy')}`,
          dateRange: `Audit Date: ${format(parseISO(selectedDate), 'dd MMM yyyy')}`,
          generatorName: profile?.name || user?.email || 'Compliance Officer',
          columns: headers,
          data: exportRows
        },
        'missing_records_audit'
      );
      toast.success('Audit report exported successfully.');
    } catch (err: any) {
      toast.error(`Export failed: ${err.message || 'Error compiling audit document'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-4 animate-in fade-in duration-300 w-full font-sans">
      
      {/* HEADER RIBBON */}
      <div className="flex justify-between items-start w-full mb-1 shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1">
          <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2.5">
            <AlertTriangle className="text-amber-600" size={22} />
            Missing Records & Non-Compliance Audit
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
            Statutory Zoo Licensing Act (ZLA) Daily Protocol & Observation Verification
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200">
              <WifiOff size={12} /> Offline
            </span>
          )}
          <button
            onClick={handleExportAudit}
            disabled={isExporting || isLoading || filteredList.length === 0}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} className="text-emerald-400" />}
            <span>Export Audit .DOCX</span>
          </button>
        </div>
      </div>

      {/* STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Daily Compliance</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-black ${stats.compliancePercent >= 90 ? 'text-emerald-600' : stats.compliancePercent >= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
              {stats.compliancePercent}%
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              {stats.compliantAnimals}/{stats.totalAnimals}
            </span>
          </div>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'OBSERVATION' ? 'ALL' : 'OBSERVATION')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-sm flex flex-col justify-between ${
            filterType === 'OBSERVATION' ? 'bg-slate-900 text-white border-slate-800' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${filterType === 'OBSERVATION' ? 'text-slate-300' : 'text-slate-400'}`}>
              Observations
            </span>
            <Eye size={13} className={filterType === 'OBSERVATION' ? 'text-emerald-400' : 'text-slate-400'} />
          </div>
          <p className="text-xl font-black mt-2">{stats.missingObservations}</p>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'FEEDING' ? 'ALL' : 'FEEDING')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-sm flex flex-col justify-between ${
            filterType === 'FEEDING' ? 'bg-slate-900 text-white border-slate-800' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${filterType === 'FEEDING' ? 'text-slate-300' : 'text-slate-400'}`}>
              Feed Logs
            </span>
            <Utensils size={13} className={filterType === 'FEEDING' ? 'text-amber-400' : 'text-slate-400'} />
          </div>
          <p className="text-xl font-black mt-2">{stats.missingFeeds}</p>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'WEIGHT' ? 'ALL' : 'WEIGHT')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-sm flex flex-col justify-between ${
            filterType === 'WEIGHT' ? 'bg-slate-900 text-white border-slate-800' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${filterType === 'WEIGHT' ? 'text-slate-300' : 'text-slate-400'}`}>
              7-Day Weights
            </span>
            <Scale size={13} className={filterType === 'WEIGHT' ? 'text-blue-400' : 'text-slate-400'} />
          </div>
          <p className="text-xl font-black mt-2">{stats.missingWeights}</p>
        </div>

        <div 
          onClick={() => setFilterType(filterType === 'MEDICATION' ? 'ALL' : 'MEDICATION')}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-sm flex flex-col justify-between ${
            filterType === 'MEDICATION' ? 'bg-slate-900 text-white border-slate-800' : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${filterType === 'MEDICATION' ? 'text-slate-300' : 'text-slate-400'}`}>
              Clinical MARs
            </span>
            <HeartPulse size={13} className={filterType === 'MEDICATION' ? 'text-rose-400' : 'text-slate-400'} />
          </div>
          <p className="text-xl font-black mt-2">{stats.missingMeds}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl shadow-sm flex flex-col justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-amber-800">Total Flagged</span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-900">{filteredList.length}</span>
            <span className="text-[10px] font-bold text-amber-700">Animals</span>
          </div>
        </div>
      </div>

      {/* FILTER & DATE CONTROLS */}
      <div className="bg-slate-50/90 p-3 rounded-2xl border border-slate-200 shadow-inner flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="flex items-center bg-white rounded-xl px-3 py-1.5 border border-slate-200 shadow-sm gap-2">
            <Calendar size={13} className="text-slate-400 shrink-0" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 border-none outline-none cursor-pointer p-0"
            />
          </div>

          <div className="flex gap-1 overflow-x-auto custom-scrollbar">
            {CATEGORY_TABS.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                    : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
          <input
            type="text"
            placeholder="Search name, ring, enclosure..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none shadow-sm"
          />
        </div>
      </div>

      {/* AUDIT RESULTS GRID */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-20 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-slate-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Auditing Statutory Husbandry Records...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
          <div 
            className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md min-w-[800px]"
            style={{ gridTemplateColumns: tableGridCols }}
          >
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Animal & Species</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Enclosure</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Outstanding Protocols</div>
            <div className="px-5 py-3.5 flex items-center justify-end text-right">Direct Action</div>
          </div>

          {filteredList.length === 0 && !isLoading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center h-full">
              <div className="w-14 h-14 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-center mb-3 shadow-sm">
                <CheckCircle2 size={28} className="text-emerald-600" />
              </div>
              <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Full Protocol Compliance</h3>
              <p className="text-xs font-medium text-slate-500 mt-1 max-w-sm">
                All daily observations, scheduled feeds, and active medical logs for this date have been logged in accordance with ZLA standards.
              </p>
            </div>
          ) : (
            <div 
              className="p-3 lg:p-0 min-w-full lg:min-w-[800px]"
              style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
            >
              {virtualItems.map((virtualRow) => {
                const animal = filteredList[virtualRow.index];

                return (
                  <div
                    key={animal.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute top-0 left-0 w-full transition-colors box-border"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {/* Mobile / Tablet Card */}
                    <div className="lg:hidden p-1.5">
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                          <div>
                            <h4 className="font-black text-slate-900 text-sm">{animal.name}</h4>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{animal.species}</p>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200">
                            {animal.enclosure || 'No Enclosure'}
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Missing Requirements:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {animal.missingObservation && (
                              <span className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                                <Eye size={11} /> Observation Log
                              </span>
                            )}
                            {animal.missingFeed && (
                              <span className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                                <Utensils size={11} /> Scheduled Feed
                              </span>
                            )}
                            {animal.missingWeight && (
                              <span className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                                <Scale size={11} /> Weekly Weight
                              </span>
                            )}
                            {animal.missingMed && (
                              <span className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                                <HeartPulse size={11} /> Active Medication
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex justify-end">
                          <Link
                            to={'/husbandry/daily-logs' as any}
                            search={{ animalId: animal.id } as any}
                            className="text-xs font-black uppercase tracking-widest text-slate-900 hover:text-slate-700 flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl transition-all"
                          >
                            <span>Log Protocols</span>
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                    </div>

                    {/* Desktop Row */}
                    <div 
                      className="hidden lg:grid border-b border-slate-100 bg-white hover:bg-slate-50/80 transition-colors"
                      style={{ gridTemplateColumns: tableGridCols }}
                    >
                      <div className="px-5 py-3.5 flex flex-col justify-center min-w-0">
                        <h4 className="text-xs font-bold text-slate-900 truncate">{animal.name}</h4>
                        <p className="text-[10px] text-slate-400 font-medium truncate">{animal.species}</p>
                      </div>

                      <div className="px-5 py-3.5 flex items-center justify-start min-w-0">
                        <span className="text-xs font-bold text-slate-700">{animal.enclosure || '-'}</span>
                      </div>

                      <div className="px-5 py-3.5 flex items-center gap-1.5 flex-wrap min-w-0">
                        {animal.missingObservation && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                            <Eye size={10} /> Observation
                          </span>
                        )}
                        {animal.missingFeed && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                            <Utensils size={10} /> Feed Log
                          </span>
                        )}
                        {animal.missingWeight && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                            <Scale size={10} /> Weight (7d)
                          </span>
                        )}
                        {animal.missingMed && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                            <HeartPulse size={10} /> Medical MAR
                          </span>
                        )}
                      </div>

                      <div className="px-5 py-3.5 flex items-center justify-end min-w-0">
                        <Link
                          to={'/husbandry/daily-logs' as any}
                          search={{ animalId: animal.id } as any}
                          className="text-[10px] font-black uppercase tracking-widest text-slate-900 hover:text-white hover:bg-slate-900 border border-slate-200 px-3 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1"
                        >
                          <span>Log Now</span>
                          <ArrowRight size={12} />
                        </Link>
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
  );
}

export default MissingRecordsPage;
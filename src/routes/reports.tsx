import React, { useState, useMemo, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, queryOptions, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { reportExportService } from '../services/reportExportService';
import { 
  CalendarDays, ListOrdered, AlertTriangle, ArrowRightLeft, 
  Download, Loader2, FileText, ChevronRight, Eye, Filter, WifiOff, 
  Scale, Utensils, Wrench, HeartPulse, Archive, CalendarClock 
} from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';

// ------------------------------------------------------------------
// 1. DATA FETCHER (Unified Pre-Fetch Pool)
// ------------------------------------------------------------------
const reportDataOptions = queryOptions({
  queryKey: ['report_data'],
  queryFn: async () => {
    const [animals, logs, internal, external, incidents, maintenance, firstAid, schedules] = await Promise.all([
      supabase.from('animals').select('*'),
      supabase.from('daily_logs').select('*, animals(name)'),
      supabase.from('internal_movements').select('*, animals(name, species)'),
      supabase.from('external_transfers').select('*, animals(name, species)'),
      supabase.from('incidents').select('*'),
      supabase.from('maintenance_tickets').select('*'),
      supabase.from('first_aid_logs').select('*'),
      supabase.from('feeding_schedules').select('*') // Added to pull future feed dates
    ]);
    return {
      animals: animals.data || [],
      logs: logs.data || [],
      internal: internal.data || [],
      external: external.data || [],
      incidents: incidents.data || [],
      maintenance: maintenance.data || [],
      firstAid: firstAid.data || [],
      schedules: schedules.data || []
    };
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/reports')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(reportDataOptions);
  },
  component: ReportsDashboard,
});

// ------------------------------------------------------------------
// 2. REPORT DEFINITIONS
// ------------------------------------------------------------------
const REPORTS = [
  { id: 'husbandry', title: 'Daily Husbandry Logs', description: 'Export daily observation records.', icon: CalendarDays, columns: ['Date', 'Animal', 'Log Type', 'Notes', 'Staff'] },
  { id: 'weekly_feed', title: 'Weekly Feed Chart', description: 'Log of nutritional intake & feed methods.', icon: Utensils, columns: ['Date', 'Animal', 'Feed Details', 'Quantity', 'Notes'] },
  { id: 'feed_tick_sheet', title: 'Feeding Tick Sheet', description: 'Printable weekly calendar for physical sign-offs.', icon: CalendarClock, columns: ['Animal', 'Category', 'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'] },
  { id: 'weekly_weight', title: 'Weekly Weight Chart', description: 'Tracking of animal masses and anomalies.', icon: Scale, columns: ['Date', 'Animal', 'Weight', 'Unit', 'Notes'] },
  { id: 'internal_movements', title: 'Internal Movements', description: 'Log of enclosure changes.', icon: ArrowRightLeft, columns: ['Date', 'Animal', 'Species', 'From', 'To', 'Reason'] },
  { id: 'external_movements', title: 'External Transfers', description: 'Acquisitions, loans, and dispositions.', icon: ArrowRightLeft, columns: ['Date', 'Animal', 'Transfer Type', 'Origin/Destination', 'Auth By'] },
  { id: 'census', title: 'Annual Census (Section 9)', description: 'Complete site inventory.', icon: ListOrdered, columns: ['Name', 'Species', 'Category', 'Sex', 'Status'] },
  { id: 'incidents', title: 'Safety Incidents', description: 'Operational and safety incident log.', icon: AlertTriangle, columns: ['Date', 'Category', 'Severity', 'Description', 'Reported By'] },
  { id: 'first_aid', title: 'First Aid Report', description: 'Medical interventions for staff/public.', icon: HeartPulse, columns: ['Date', 'Person Type', 'Injury', 'Treatment', 'Administered By'] },
  { id: 'maintenance', title: 'Site Maintenance', description: 'Facility repair and upkeep log.', icon: Wrench, columns: ['Date', 'Location', 'Issue', 'Priority', 'Status'] },
  { id: 'inspection_pack', title: 'ZLA Inspection Pack', description: 'Auto-generates a .zip containing all statutory requirements.', icon: Archive, columns: ['Included Document', 'Description'] }
];

// ------------------------------------------------------------------
// 3. MAIN COMPONENT (UNIFIED FULL-WIDTH LAYOUT)
// ------------------------------------------------------------------
export function ReportsDashboard() {
  const { user, profile } = useAuth();
  const [activeReportId, setActiveReportId] = useState('husbandry');
  
  // Default to today for tick sheets, but allow scanning back/forward
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd')); 
  const [endDate, setEndDate] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [selectedCategory, setSelectedCategory] = useState<string>('EXOTIC');
  const [isGenerating, setIsGenerating] = useState(false);
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

  const { data: db, isLoading } = useQuery(reportDataOptions);
  const activeReport = REPORTS.find(r => r.id === activeReportId)!;

  // ------------------------------------------------------------------
  // DATA TRANSFORMATION ENGINE
  // ------------------------------------------------------------------
  const getTransformedData = (reportId: string) => {
    if (!db) return [];

    const filterByDateAndCategory = (items: any[], dateField: string) => {
      return items.filter(item => {
        const itemDate = item[dateField] ? item[dateField].split('T')[0] : null;
        const animal = db.animals.find((a: any) => a.id === item.animal_id);
        const inDateRange = itemDate ? itemDate >= startDate && itemDate <= endDate : true;
        const inCategory = selectedCategory === 'ALL' ? true : animal?.category === selectedCategory;
        return inDateRange && inCategory;
      });
    };

    switch (reportId) {
      case 'husbandry':
        return filterByDateAndCategory(db.logs.filter((l: any) => l.log_type === 'OBSERVATION'), 'log_date')
          .map((l: any) => [format(parseISO(l.log_date), 'dd MMM yyyy HH:mm'), `${l.animals?.name || 'Unknown'}`, l.log_type, l.notes || '-', l.created_by?.substring(0, 8) || 'Unknown']);
      
      case 'weekly_feed':
        return filterByDateAndCategory(db.logs.filter((l: any) => l.log_type === 'FEEDING'), 'log_date')
          .map((l: any) => {
            const meals = l.feed_details?.meals?.map((m: any) => m.food_item).join(', ') || 'Standard Diet';
            const qty = l.feed_details?.meals?.map((m: any) => m.quantity_offered || m.quantity).join(', ') || '-';
            return [format(parseISO(l.log_date), 'dd MMM yyyy'), l.animals?.name || 'Unknown', meals, qty, l.notes || '-'];
          });
      
      case 'feed_tick_sheet': {
        // Automatically calculates a 7-day rolling window from the chosen start date
        const start = parseISO(startDate);
        const days = Array.from({length: 7}).map((_, i) => addDays(start, i));

        const targetAnimals = selectedCategory === 'ALL'
          ? db.animals.filter((a: any) => a.status !== 'ARCHIVED')
          : db.animals.filter((a: any) => a.category === selectedCategory && a.status !== 'ARCHIVED');

        return targetAnimals.map((animal: any) => {
          const animalSchedules = db.schedules.filter((s: any) => s.animal_id === animal.id && !s.is_deleted);
          const row = [animal.name, animal.category || '-'];

          days.forEach(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            // Fetch ALL scheduled items for this specific animal on this specific day
            const schedulesForDay = animalSchedules.filter((s: any) => s.scheduled_date === dayStr);

            if (schedulesForDay.length > 0) {
              const isFasting = schedulesForDay.some((s: any) => s.notes === 'FAST DAY / NOT REQUIRED' || s.food_type === 'NOT REQUIRED');
              
              if (isFasting) {
                row.push('FAST');
              } else {
                // Map over all feeds and stitch them together (e.g. "2x Mice & 1x Calcidust")
                const combinedFeeds = schedulesForDay.map((s: any) => {
                  const qty = s.quantity || '';
                  const unit = (s.quantity_unit === 'item' || s.quantity_unit === 'whole_item') ? 'x' : (s.quantity_unit || '');
                  
                  let itemString = `${qty}${unit} ${s.food_type || 'Diet'}`.trim();
                  
                  // Bulletproof Calcidust Detection (Checking boolean flags or text contents)
                  const needsCalci = s.calci_dust === true || 
                                     s.requires_calcidust === true || 
                                     (s.supplements && s.supplements.toLowerCase().includes('calci'));
                  
                  if (needsCalci) {
                    itemString += ' (+Calci)';
                  }
                  
                  return itemString;
                }).join(' & ');

                row.push(`[ ] ${combinedFeeds}`);
              }
            } else {
               row.push('-');
            }
          });
          return row;
        });
      }

      case 'weekly_weight':
         return filterByDateAndCategory(db.logs.filter((l: any) => l.log_type === 'WEIGHT'), 'log_date')
          .map((l: any) => [format(parseISO(l.log_date), 'dd MMM yyyy'), l.animals?.name || 'Unknown', l.weight_grams, 'g', l.notes || '-']);
      
      case 'internal_movements':
         return filterByDateAndCategory(db.internal, 'movement_date')
          .map((m: any) => [format(parseISO(m.movement_date), 'dd MMM yyyy'), m.animals?.name || 'Unknown', m.animals?.species || '-', m.from_enclosure, m.to_enclosure, m.reason || '-']);
      
      case 'external_movements':
         return filterByDateAndCategory(db.external, 'transfer_date')
          .map((m: any) => [format(parseISO(m.transfer_date), 'dd MMM yyyy'), m.animals?.name || 'Unknown', m.transfer_type, m.entity_name, m.reason || '-']);
      
      case 'census':
         return db.animals.filter((a: any) => a.status !== 'ARCHIVED' && (selectedCategory === 'ALL' || a.category === selectedCategory))
          .map((a: any) => [a.name, a.species || '-', a.category || '-', a.gender || '-', a.status || '-']);
      
      case 'incidents':
         return filterByDateAndCategory(db.incidents, 'incident_date')
          .map((i: any) => [format(parseISO(i.incident_date), 'dd MMM yyyy'), i.category, i.severity, i.description, i.reported_by?.substring(0,8) || '-']);
      
      case 'first_aid':
         return filterByDateAndCategory(db.firstAid, 'incident_date')
          .map((f: any) => [format(parseISO(f.incident_date), 'dd MMM yyyy'), f.person_type, f.injury_type, f.treatment_provided, f.administered_by?.substring(0,8) || '-']);
      
      case 'maintenance':
         return filterByDateAndCategory(db.maintenance, 'reported_date')
          .map((m: any) => [format(parseISO(m.reported_date), 'dd MMM yyyy'), m.location, m.issue_description, m.priority, m.status]);
      
      case 'inspection_pack':
         return [
           ['Husbandry Logs', 'Complete daily logs for all animals'],
           ['Internal Movements', 'Complete log of enclosure changes'],
           ['External Transfers', 'Acquisitions, loans, and dispositions'],
           ['Site Census', 'Current animal inventory']
         ];
      
      default:
        return [];
    }
  };

  const reportData = useMemo(() => getTransformedData(activeReportId), [db, activeReportId, startDate, endDate, selectedCategory]);

  // ------------------------------------------------------------------
  // EXPORT HANDLER
  // ------------------------------------------------------------------
  const handleExport = async () => {
    if (!isOnline) {
      alert("Compliance exports require an active internet connection to securely fetch the latest data and letterheads.");
      return;
    }

    setIsGenerating(true);
    try {
      const basePayload = {
        generatorName: profile?.name || user?.email || "System Administrator",
        dateRange: activeReportId === 'feed_tick_sheet' 
          ? `Week Commencing ${format(new Date(startDate), 'dd MMM yyyy')}` 
          : `${format(new Date(startDate), 'dd MMM yyyy')} to ${format(new Date(endDate), 'dd MMM yyyy')}`
      };

      if (activeReportId === 'inspection_pack') {
        const packReports = [
          { filenameId: 'Husbandry', payload: { ...basePayload, title: 'Husbandry Logs', columns: REPORTS.find(r => r.id === 'husbandry')!.columns, data: getTransformedData('husbandry') } },
          { filenameId: 'Internal_Movements', payload: { ...basePayload, title: 'Internal Movements', columns: REPORTS.find(r => r.id === 'internal_movements')!.columns, data: getTransformedData('internal_movements') } },
          { filenameId: 'External_Transfers', payload: { ...basePayload, title: 'External Transfers', columns: REPORTS.find(r => r.id === 'external_movements')!.columns, data: getTransformedData('external_movements') } },
          { filenameId: 'Census', payload: { ...basePayload, title: 'Site Census', columns: REPORTS.find(r => r.id === 'census')!.columns, data: getTransformedData('census') } },
        ];
        await reportExportService.generateInspectionPackZip(packReports);
      } else {
        
        // Dynamically insert the exact dates into the column headers for the Tick Sheet
        let dynamicColumns = activeReport.columns;
        if (activeReportId === 'feed_tick_sheet') {
           const start = parseISO(startDate);
           dynamicColumns = ['Animal', 'Category', ...Array.from({length: 7}).map((_, i) => format(addDays(start, i), 'EEE dd MMM'))];
        }

        await reportExportService.exportSingleReport({
          ...basePayload,
          title: activeReport.title,
          columns: dynamicColumns,
          data: reportData
        }, activeReportId);
      }
    } catch (error) {
      console.error("Export Failed:", error);
      alert("Failed to generate report export.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    // Changed to full width with standard edge padding to maximize grid real-estate
    <div className="w-full px-4 lg:px-6 space-y-4 md:space-y-6 pb-20 font-sans animate-in fade-in duration-500">
      
      {/* HEADER & CONTROLS */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col xl:flex-row xl:items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
            <activeReport.icon className="text-blue-600" size={24} /> {activeReport.title}
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-2">{activeReport.description}</p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          {activeReportId !== 'census' && activeReportId !== 'inspection_pack' && (
            <>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                  {activeReportId === 'feed_tick_sheet' ? 'Week Starting' : 'Start Date'}
                </label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
              </div>
              
              {/* Hide the End Date for Tick Sheets as it relies on a strict 7-day rolling window */}
              {activeReportId !== 'feed_tick_sheet' && (
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">End Date</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
                </div>
              )}
            </>
          )}
          
          <div>
             <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Category</label>
             <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[140px]">
               <option value="ALL">All Categories</option>
               <option value="EXOTIC">Exotic</option>
               <option value="MAMMAL">Mammal</option>
               <option value="BIRD">Bird</option>
               <option value="RAPTOR">Raptor</option>
               <option value="OWL">Owl</option>
             </select>
          </div>

          <button
            onClick={handleExport}
            disabled={isGenerating || isLoading || reportData.length === 0 || !isOnline}
            className={`text-white px-6 py-2.5 rounded-xl transition-colors text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-sm disabled:opacity-50 h-[42px] ${activeReportId === 'inspection_pack' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : activeReportId === 'inspection_pack' ? <Archive size={16} /> : <Download size={16} />}
            {activeReportId === 'inspection_pack' ? 'Compile .ZIP' : 'Export .DOCX'}
          </button>
        </div>
      </div>

      {/* FULL-WIDTH SPREAD: 1 Col Sidebar / 4 Col Data Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[500px]">
        
        {/* Sidebar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden h-[600px] lg:col-span-1">
           <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <FileText size={14} /> Available Reports
              </h2>
           </div>
           <nav className="flex-grow p-4 space-y-2 overflow-y-auto custom-scrollbar pb-24">
            {REPORTS.map((report) => (
              <button
                key={report.id}
                onClick={() => setActiveReportId(report.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group border ${
                  activeReportId === report.id 
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md' 
                    : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <report.icon size={16} className={`shrink-0 ${activeReportId === report.id ? 'text-white' : 'text-slate-400 group-hover:text-blue-500'}`} />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-left truncate">
                    {report.title}
                  </span>
                </div>
                {activeReportId === report.id && <ChevronRight className="w-4 h-4 text-blue-200 shrink-0 ml-2" />}
              </button>
            ))}
          </nav>
        </div>

        {/* Data Preview Panel (Expanded for 7-day grids) */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[600px] overflow-hidden relative">
           {isLoading && (
              <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-blue-600 w-8 h-8" />
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Generating Preview...</span>
              </div>
           )}
           <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Eye size={14} /> Data Preview ({reportData.length} Records)
              </h2>
              {!isOnline && <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1"><WifiOff size={12}/> Offline Mode</span>}
           </div>

           <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50/30 p-4">
              {reportData.length === 0 && !isLoading ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
                   <Filter size={32} className="opacity-20" />
                   <p className="text-sm font-bold">No records found for these parameters.</p>
                </div>
              ) : (
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-slate-100/50 sticky top-0 z-10 rounded-t-xl">
                    <tr>
                      {/* Dynamic Header injection so the user preview matches the generated export */}
                      {(activeReportId === 'feed_tick_sheet' 
                        ? ['Animal', 'Category', ...Array.from({length: 7}).map((_, i) => format(addDays(parseISO(startDate), i), 'EEE dd MMM'))]
                        : activeReport.columns
                      ).map((col, idx) => (
                        <th key={idx} className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-200">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.slice(0, 100).map((row: any, rIdx: number) => (
                      <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                        {row.map((cell: any, cIdx: number) => (
                          <td key={cIdx} className="px-4 py-3 text-xs font-medium text-slate-700">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {reportData.length > 100 && (
                 <div className="p-4 text-center text-xs font-bold text-slate-400 uppercase tracking-widest border-t border-slate-100">
                   Preview limited to 100 rows. Export to view all {reportData.length} records.
                 </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
}

export default ReportsDashboard;
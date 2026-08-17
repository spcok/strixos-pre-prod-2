import React, { useRef, useState, useMemo, useTransition } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Animal } from '../../types';
import { 
  X, Download, Info, Loader2, Globe, RefreshCw, 
  LayoutTemplate, Sun, Moon, Sparkles, Droplets, 
  Image as ImageIcon, Edit2, Save, Calendar 
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { toJpeg } from 'html-to-image';

// --- IUCN BADGE ASSET IMPORTS ---
import imgCR from '../../assets/Critically endangered.png';
import imgDD from '../../assets/Data Deficient.png';
import imgEN from '../../assets/Endangered.png';
import imgEW from '../../assets/extinct in the wild.png';
import imgEX from '../../assets/extinct.png';
import imgLC from '../../assets/Least Concerned.png';
import imgNT from '../../assets/Near Threatened.png';
import imgNE from '../../assets/Not Evaluated.png';
import imgVU from '../../assets/Vulnerable.png';

interface SignGeneratorProps {
  animal: Animal;
  onClose: () => void;
}

const getIUCNBadgeImage = (status?: string) => {
  if (!status) return imgNE;
  const s = status.toUpperCase();
  if (s.includes('CRITICAL')) return imgCR;
  if (s.includes('DATA')) return imgDD;
  if (s.includes('WILD')) return imgEW;
  if (s.includes('ENDANGERED')) return imgEN; 
  if (s.includes('EXTINCT')) return imgEX; 
  if (s.includes('LEAST') || s.includes('LC')) return imgLC;
  if (s.includes('NEAR') || s.includes('NT')) return imgNT;
  if (s.includes('VULNERABLE') || s.includes('VU')) return imgVU;
  return imgNE;
};

const EditTextArea = ({ value, onChange, className = "" }: { value: string, onChange: (val: string) => void, className?: string }) => (
  <textarea 
    value={value} 
    onChange={(e) => onChange(e.target.value)} 
    className={`w-full bg-amber-50/50 border border-amber-200 rounded-lg p-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 resize-none custom-scrollbar ${className}`}
  />
);

const EditInput = ({ value, onChange, className = "" }: { value: string, onChange: (val: string) => void, className?: string }) => (
  <input 
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full bg-amber-50/50 border border-amber-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 ${className}`}
  />
);

const DEFAULT_STATS = { lifespanWild: '', lifespanCaptivity: '', wingspan: '', weight: '' };

export function SignGenerator({ animal, onClose }: SignGeneratorProps) {
  const signRef = useRef<HTMLDivElement>(null);
  const [mapLayout, setMapLayout] = useState<'side' | 'bottom' | 'card'>('bottom');
  const [isExporting, setIsExporting] = useState(false);
  
  // Custom display name for shared enclosures (e.g. "Dawn & Dusk")
  const [customName, setCustomName] = useState(animal.name);
  
  // Org Profile for Logo and URL
  const { data: orgProfile } = useQuery({
    queryKey: ['org_settings'],
    queryFn: async () => {
      const { data } = await supabase.from('organization_profile').select('*').single();
      return data;
    },
    staleTime: 1000 * 60 * 60,
    networkMode: 'offlineFirst',
  });
  
  const [content, setContent] = useState({
      dietText: '', 
      habitatText: '', 
      didYouKnowText: '', 
      speciesBrief: '', 
      wildOrigin: '', 
      ...DEFAULT_STATS
  });
  
  const [isPending, startTransition] = useTransition();
  const [isEditingText, setIsEditingText] = useState(true);

  const fetchContent = () => {
      if (!navigator.onLine) {
          toast.error("Offline: AI Signage Generation requires an internet connection.");
          return;
      }
      
      startTransition(async () => {
          try {
              const { data, error } = await supabase.functions.invoke('generate-signage', {
                body: { species: animal.species }
              });

              if (error) throw new Error(error.message);
              if (!data) throw new Error("No data returned from AI engine.");

              setContent({ 
                  dietText: data.diet?.join('\n') || '',
                  habitatText: data.habitat?.join('\n') || '',
                  didYouKnowText: data.didYouKnow?.join('\n') || '',
                  speciesBrief: data.brief || '',
                  wildOrigin: data.wildOrigin || '',
                  lifespanWild: data.lifespanWild || '',
                  lifespanCaptivity: data.lifespanCaptivity || '',
                  wingspan: data.wingspan || '',
                  weight: data.weight || ''
              });
              
              toast.success("AI Content Generated!");
          } catch (error: any) {
              console.error("SignGenerator Error:", error);
              toast.error(`Generation Failed: ${error.message}`);
          }
      });
  };

  const handleDownload = async () => {
    if (!signRef.current) return;
    setIsExporting(true);
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    try {
      const dataUrl = await toJpeg(signRef.current, { 
        quality: 0.95,
        pixelRatio: 3, 
        backgroundColor: '#ffffff',
        style: {
          transform: 'none', 
        }
      });
      
      const link = document.createElement('a');
      link.download = `KOA_${customName.replace(/\s+/g, '_')}_Sign.jpg`;
      link.href = dataUrl;
      link.click();
      toast.success('Sign downloaded successfully');
    } catch (err) {
      console.error("Export Error:", err);
      toast.error('Failed to generate image. Ensure all photos are fully loaded.');
    } finally {
      setIsExporting(false);
    }
  };

  const formatDate = (date?: any) => {
      if (!date) return 'Unknown';
      const dateStr = String(date);
      if (dateStr.startsWith('1900-01-01')) return 'Unknown';
      return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getAge = (dob?: any) => {
      if (!dob) return 'Unknown';
      const dobStr = String(dob);
      if (dobStr.startsWith('1900-01-01')) return 'Unknown';
      const age = new Date().getFullYear() - new Date(dob).getFullYear();
      if (age < 1) return '< 1 year';
      return `${age} years`;
  };

  const getArrivalYear = (date?: any) => {
      if (!date) return 'Unknown';
      const dateStr = String(date);
      if (dateStr.startsWith('1900-01-01')) return 'Unknown';
      return new Date(date).getFullYear();
  };

  const dynamicDimensionLabel = useMemo(() => {
      const s = (animal.species || '').toLowerCase();
      const c = animal.category || '';
      if (s.includes('spider') || s.includes('tarantula') || s.includes('scorpion') || s.includes('millipede')) return 'LEG SPAN';
      if (c.toUpperCase() === 'MAMMAL' || c.toUpperCase() === 'EXOTIC' || s.includes('snake') || s.includes('lizard') || s.includes('frog') || s.includes('toad') || s.includes('monitor') || s.includes('iguana')) return 'LENGTH';
      return 'WINGSPAN';
  }, [animal.species, animal.category]);

  const theme = useMemo(() => {
      if (animal.is_venomous || animal.hazard_rating === 'HIGH') {
          return { bg: 'bg-rose-500', text: 'text-rose-500', textDark: 'text-rose-700', containerBg: 'bg-rose-50', border: 'border-rose-200' };
      }
      if (animal.hazard_rating === 'MEDIUM') {
          return { bg: 'bg-orange-500', text: 'text-orange-500', textDark: 'text-orange-700', containerBg: 'bg-orange-50', border: 'border-orange-200' };
      }
      return { bg: 'bg-[#10b981]', text: 'text-[#10b981]', textDark: 'text-emerald-800', containerBg: 'bg-[#f0fdf4]', border: 'border-emerald-200' };
  }, [animal.hazard_rating, animal.is_venomous]);

  const adoptionUrl = orgProfile?.adoptionurl || 'https://kentowlacademy.com';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(adoptionUrl)}&color=ffffff&bgcolor=10b981`;

  const containerStyle = useMemo(() => {
      if (mapLayout === 'card') return { width: '800px', height: '600px', minWidth: '800px', minHeight: '600px' };
      return { width: '794px', height: '1123px', minWidth: '794px', minHeight: '1123px' }; 
  }, [mapLayout]);

  const isHighRisk = animal.hazard_rating === 'HIGH' || animal.is_venomous;

  const renderBullets = (text: string, limit?: number) => {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const visibleLines = limit ? lines.slice(0, limit) : lines;
    if (visibleLines.length === 0) return <li>Content pending...</li>;
    return visibleLines.map((line, i) => <li key={i}>{line}</li>);
  };

  const renderBriefBullets = (text: string) => {
    if (!text) return <li>Content pending...</li>;
    const items = text.split(/(?:\n|\.\s+)/).filter(l => l.trim().length > 0);
    return items.map((item, i) => (
      <li key={i} className="mb-1">{item.trim()}{item.trim().endsWith('.') ? '' : '.'}</li>
    ));
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.style.display = 'none';
    e.currentTarget.parentElement?.classList.add('bg-slate-100', 'flex', 'items-center', 'justify-center');
  };

  const InputLabel = ({ children }: { children: React.ReactNode }) => <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{children}</label>;

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[100] flex flex-col p-4 font-sans">
      
      {/* HEADER BAR */}
      <div className="flex flex-wrap justify-between items-center bg-white p-4 rounded-xl shadow-lg gap-4 shrink-0 mb-4">
          <div className="flex items-center gap-4">
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 uppercase tracking-tight">
                  <LayoutTemplate className="text-emerald-600"/> Signage Studio
              </h2>
              <div className="h-6 w-px bg-slate-200"></div>
              
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button onClick={() => setMapLayout('side')} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all ${mapLayout === 'side' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Portrait A4</button>
                <button onClick={() => setMapLayout('bottom')} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all ${mapLayout === 'bottom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Landscape A4</button>
                <button onClick={() => setMapLayout('card')} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all ${mapLayout === 'card' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>Registry Card</button>
              </div>

              <button onClick={fetchContent} disabled={isPending} className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg font-black hover:bg-purple-100 transition-colors text-[10px] uppercase tracking-widest disabled:opacity-50">
                  {isPending ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
                  Auto-Fill via AI
              </button>
          </div>
          <div className="flex items-center gap-3">
              <button onClick={() => setIsEditingText(!isEditingText)} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-colors text-[10px] uppercase tracking-widest border-2 ${isEditingText ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}>
                  {isEditingText ? <Save size={14}/> : <Edit2 size={14}/>}
                  {isEditingText ? "Preview Mode" : "Manual Edit Mode"}
              </button>
              <button onClick={handleDownload} disabled={isExporting} className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-black hover:bg-emerald-500 transition-all shadow-md active:scale-scale-95 text-[10px] uppercase tracking-widest disabled:opacity-50">
                  {isExporting ? <Loader2 size={16} className="animate-spin"/> : <Download size={16}/>} 
                  {isExporting ? 'Processing...' : 'Download (.JPG)'}
              </button>
              <button onClick={onClose} className="p-2.5 text-slate-400 hover:text-slate-800 transition-colors bg-slate-100 hover:bg-slate-200 rounded-lg"><X size={18}/></button>
          </div>
      </div>

      {/* SPLIT SCREEN WORKSPACE */}
      <div className="flex flex-1 min-h-0 gap-4">
        
        {/* LEFT PANE: EDITOR */}
        <div className="w-[400px] bg-white rounded-xl shadow-lg flex flex-col overflow-hidden shrink-0 border border-slate-200">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2 shrink-0">
            <Edit2 size={16} className="text-blue-600" />
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Content Editor</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
            
            <div>
              <InputLabel>Display Name(s)</InputLabel>
              <input 
                value={customName} 
                onChange={(e) => setCustomName(e.target.value)} 
                className="w-full bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm font-black focus:ring-2 focus:ring-blue-500 outline-none text-blue-900" 
                placeholder="e.g. Dawn & Dusk"
              />
            </div>

            <div>
              <InputLabel>Species Brief (Paragraph)</InputLabel>
              <textarea value={content.speciesBrief} onChange={(e) => setContent(p => ({...p, speciesBrief: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" />
            </div>
            
            <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-6">
              <div>
                <InputLabel>Natural Habitat</InputLabel>
                <input value={content.wildOrigin} onChange={(e) => setContent(p => ({...p, wildOrigin: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <InputLabel>Wild Lifespan</InputLabel>
                <input value={content.lifespanWild} onChange={(e) => setContent(p => ({...p, lifespanWild: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <InputLabel>Captive Lifespan</InputLabel>
                <input value={content.lifespanCaptivity} onChange={(e) => setContent(p => ({...p, lifespanCaptivity: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <InputLabel>{dynamicDimensionLabel}</InputLabel>
                <input value={content.wingspan} onChange={(e) => setContent(p => ({...p, wingspan: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="col-span-2">
                <InputLabel>Average Weight</InputLabel>
                <input value={content.weight} onChange={(e) => setContent(p => ({...p, weight: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            <div>
              <InputLabel>Diet (One point per line)</InputLabel>
              <textarea value={content.dietText} onChange={(e) => setContent(p => ({...p, dietText: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" />
            </div>
            <div>
              <InputLabel>Habitat (One point per line)</InputLabel>
              <textarea value={content.habitatText} onChange={(e) => setContent(p => ({...p, habitatText: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" />
            </div>
            <div>
              <InputLabel>Did You Know? (One point per line)</InputLabel>
              <textarea value={content.didYouKnowText} onChange={(e) => setContent(p => ({...p, didYouKnowText: e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" />
            </div>

          </div>
        </div>

        {/* RIGHT PANE: LIVE PREVIEW CANVAS */}
        <div className="flex-1 bg-slate-800/80 rounded-xl overflow-auto flex items-start justify-center p-8 custom-scrollbar border border-slate-700 shadow-inner">
            <div 
              ref={signRef} 
              className={`bg-white relative shadow-2xl flex flex-col overflow-hidden shrink-0 origin-top transform-gpu ${mapLayout === 'card' ? 'border-2 border-black' : ''}`} 
              style={containerStyle}
            >
                
                {mapLayout === 'card' ? (
                    <div className="p-8 h-full flex flex-col relative bg-white pt-10">
                        <div className={`absolute top-0 left-0 right-0 h-6 ${theme.bg}`}></div>
                        
                        {/* FULL HEIGHT 2-COLUMN GRID (Top to Bottom) */}
                        <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 pb-2">
                            
                            {/* LEFT COLUMN: Names -> Brief -> Stats */}
                            <div className="col-span-6 flex flex-col gap-3 min-h-0">
                                
                                {/* TEXT HEADER: Now safely isolated in the left column */}
                                <div className="shrink-0 mb-1">
                                    <h1 className="text-5xl font-black text-slate-900 uppercase tracking-tighter mb-1 flex items-center gap-4 flex-wrap leading-none">
                                        {customName}
                                        {isHighRisk && <span className="bg-rose-500 text-white text-xs px-2 py-1 rounded tracking-widest align-middle font-bold shadow-sm">HIGH RISK</span>}
                                    </h1>
                                    <h2 className={`text-2xl font-bold uppercase tracking-wide mt-1 ${theme.text}`}>{animal.species}</h2>
                                    <p className="text-lg font-serif italic text-slate-400 mt-0 leading-tight">{animal.latin_name}</p>
                                </div>
                                
                                {/* SPECIES BRIEF: Now slides up directly beneath the text */}
                                <div className={`${theme.containerBg} border ${theme.border} p-4 rounded-xl relative flex-1 min-h-0 flex flex-col`}>
                                    <h3 className={`text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5 shrink-0 ${theme.textDark}`}>
                                        <Sparkles size={12}/> SPECIES BRIEF
                                    </h3>
                                    <ul className={`list-disc list-outside pl-4 text-sm font-bold leading-relaxed ${theme.textDark} opacity-90 overflow-hidden`}>
                                        {renderBriefBullets(content.speciesBrief)}
                                    </ul>
                                </div>
                                
                                {/* STATS BLOCK */}
                                <div className="flex flex-col gap-2.5 mt-auto shrink-0">
                                    <div className="grid grid-cols-2 gap-x-4">
                                        <div>
                                            <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">DATE OF BIRTH</h4>
                                            <p className="font-black text-slate-800 text-base">{formatDate(animal.date_of_birth)}</p>
                                        </div>
                                        <div>
                                            <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">GENDER</h4>
                                            <p className="font-black text-slate-800 uppercase text-base">{animal.gender}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">NATURAL HABITAT</h4>
                                        <p className="font-black text-slate-800 text-sm truncate">{content.wildOrigin || 'Pending...'}</p>
                                    </div>
                                    {(animal.category === 'MAMMAL' || animal.category === 'EXOTIC') ? (
                                        <div>
                                            <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">HAZARD CLASS</h4>
                                            <div className="flex items-center gap-2">
                                                <p className={`font-black text-sm uppercase ${animal.hazard_rating === 'HIGH' ? 'text-rose-600' : animal.hazard_rating === 'MEDIUM' ? 'text-amber-600' : 'text-slate-800'}`}>{animal.hazard_rating}</p>
                                                {animal.is_venomous && <span className="bg-rose-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider">VENOMOUS</span>}
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">CHIP/RING</h4>
                                            <p className="font-black text-slate-800 font-mono text-sm">{animal.microchip_id || animal.ring_number || 'N/A'}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* RIGHT COLUMN: Photo/Badge -> Map -> Temps */}
                            <div className="col-span-6 flex flex-col h-full gap-4 min-h-0">
                                
                                {/* HEADER IMAGES: Isolated vertically from the text */}
                                <div className="flex items-center justify-end gap-5 shrink-0">
                                    <div className="w-56 aspect-[4/3] rounded-xl overflow-hidden border-2 border-slate-200 shadow-lg bg-slate-100 shrink-0 relative flex items-center justify-center">
                                        <ImageIcon size={32} className="text-slate-300 absolute" />
                                        <img src={animal.profile_image_url || ''} alt={animal.name} className="w-full h-full object-cover object-center relative z-10" crossOrigin="anonymous" onError={handleImageError}/>
                                    </div>
                                    <div className="shrink-0">
                                        <img 
                                          src={getIUCNBadgeImage(animal.red_list_status)} 
                                          alt="IUCN Status" 
                                          className="h-24 w-auto object-contain drop-shadow-sm" 
                                        />
                                    </div>
                                </div>
                                
                                {/* MAP */}
                                <div className="flex-1 flex flex-col min-h-0">
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-0.5 shrink-0">NATIVE RANGE</h3>
                                    <div className="flex-1 w-full bg-slate-50 rounded-xl border border-slate-100 overflow-hidden flex items-center justify-center relative min-h-0">
                                          {animal.distribution_map_url ? (
                                              <img src={animal.distribution_map_url} alt="Range Map" className="w-full h-full object-contain p-2" crossOrigin="anonymous" onError={handleImageError}/>
                                          ) : (
                                              <div className="flex flex-col items-center justify-center text-slate-300">
                                                  <Globe size={32} className="mb-1"/><span className="text-[8px] font-black uppercase">No Map Data</span>
                                              </div>
                                          )}
                                    </div>
                                </div>
                                
                                {/* TEMPS */}
                                <div className="flex flex-col gap-3 shrink-0">
                                    <div className="flex gap-3">
                                        <div className="flex-1 bg-orange-500 text-white p-4 rounded-xl shadow-lg flex items-center gap-4">
                                            <Sun size={32} className="shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-black opacity-90 uppercase tracking-widest whitespace-nowrap">DAY TARGET</p>
                                                <p className="text-4xl font-black leading-none mt-1">{animal.target_day_temp_c || '?'}°C</p>
                                            </div>
                                        </div>
                                        <div className="flex-1 bg-emerald-600 text-white p-4 rounded-xl shadow-lg flex items-center gap-4">
                                            <Moon size={32} className="shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-black opacity-90 uppercase tracking-widest whitespace-nowrap">NIGHT TARGET</p>
                                                <p className="text-4xl font-black leading-none mt-1">{animal.target_night_temp_c || '?'}°C</p>
                                            </div>
                                        </div>
                                    </div>
                                    {(animal.target_humidity_min_percent || animal.target_humidity_max_percent) && (
                                        <div className="bg-cyan-600 text-white p-4 rounded-xl shadow-lg flex items-center gap-4">
                                            <Droplets size={32} className="shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-black opacity-90 uppercase tracking-widest whitespace-nowrap">HUMIDITY RANGE</p>
                                                <p className="text-4xl font-black leading-none mt-1">{animal.target_humidity_min_percent || '?'}-{animal.target_humidity_max_percent || '?'}%</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* STANDARD PORTRAIT/LANDSCAPE LAYOUT HEADER */}
                        <div className="h-28 bg-[#1e293b] flex items-center justify-between px-10 text-white shrink-0">
                            <h1 className="text-3xl font-black uppercase tracking-[0.2em]">{orgProfile?.org_name || 'KENT OWL ACADEMY'}</h1>
                            {orgProfile?.logo_url ? <img src={orgProfile.logo_url} alt="Logo" className="h-20 w-auto object-contain bg-white rounded-xl p-2 shadow-lg" crossOrigin="anonymous" onError={handleImageError} /> : <div className="h-16 w-16 bg-white rounded-xl flex items-center justify-center text-slate-900 font-bold text-2xl">KOA</div>}
                        </div>
                        
                        {/* INCREASED gap-6 to gap-8 TO GIVE MORE DEFINITION BETWEEN LEFT & RIGHT COLUMNS */}
                        <div className="flex-1 min-h-0 py-8 pl-5 pr-8 grid grid-cols-12 gap-8 overflow-hidden">
                            
                            {/* LEFT COLUMN - INCREASED VERTICAL GAPS FOR DEFINITION */}
                            <div className={`col-span-5 flex flex-col min-h-0 ${mapLayout === 'bottom' ? 'gap-4' : 'gap-5'}`}>
                                <div className="aspect-[4/3] w-full rounded-[1.5rem] overflow-hidden border-4 border-[#1e293b] shadow-xl relative shrink-0 flex items-center justify-center bg-slate-100">
                                  <ImageIcon size={32} className="text-slate-300 absolute z-0" />
                                  <img src={animal.profile_image_url || ''} alt={animal.name} className="w-full h-full object-cover object-center relative z-10" crossOrigin="anonymous" onError={handleImageError}/>
                                </div>
                                <div className="bg-[#1e293b] rounded-2xl p-4 flex items-center justify-between shadow-lg text-white shrink-0">
                                  <span className="text-xs font-black uppercase tracking-[0.25em] pl-2">STATUS</span>
                                  
                                  <div className="origin-right">
                                    <img 
                                        src={getIUCNBadgeImage(animal.red_list_status)} 
                                        alt="IUCN Status" 
                                        className="h-12 w-auto object-contain drop-shadow-sm" 
                                    />
                                  </div>
                                </div>
                                
                                {mapLayout === 'side' ? (
                                    <div className="bg-slate-50 rounded-2xl p-4 border-2 border-slate-200 shadow-sm flex flex-col items-center flex-1 min-h-0">
                                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] w-full text-left mb-2 pl-1 shrink-0">NATIVE RANGE</h3>
                                        <div className="rounded-xl overflow-hidden border border-slate-200 w-full bg-white relative flex items-center justify-center flex-1 min-h-0">
                                          {animal.distribution_map_url ? <img src={animal.distribution_map_url} alt="Range Map" className="w-full h-full object-contain" crossOrigin="anonymous" onError={handleImageError}/> : <div className="w-full h-full flex items-center justify-center text-slate-300"><Globe size={48} /></div>}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm shrink-0">
                                            <div className="flex items-center gap-3 border-b border-slate-200 pb-2"><div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 shrink-0"><Info size={16}/></div><div><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">DOB</p><p className="font-bold text-slate-800 text-sm">{formatDate(animal.date_of_birth)}</p></div></div>
                                            <div className="flex items-center gap-3 border-b border-slate-200 pb-2"><div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 shrink-0"><Info size={16}/></div><div><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">GENDER</p><p className="font-bold text-slate-800 text-sm uppercase">{animal.gender}</p></div></div>
                                            <div className="flex items-center gap-3"><div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 shrink-0"><Calendar size={16}/></div><div><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">ARRIVED</p><p className="font-bold text-slate-800 text-sm">{getArrivalYear(animal.acquisition_date)}</p></div></div>
                                        </div>
                                        {/* INCREASED INNER GAP FROM gap-2 to gap-3 FOR CLEANER READ */}
                                        <div className="grid grid-cols-1 gap-3 bg-[#f0fdf4] p-3 rounded-xl border border-emerald-100 flex-1 min-h-0 content-start overflow-auto no-scrollbar mb-6">
                                            <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center"><p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">WILD LIFESPAN</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.lifespanWild || '-'}</p></div>
                                            <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center"><p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">CAPTIVE LIFESPAN</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.lifespanCaptivity || '-'}</p></div>
                                            <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center"><p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">{dynamicDimensionLabel}</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.wingspan || '-'}</p></div>
                                            <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center"><p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">WEIGHT</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.weight || '-'}</p></div>
                                        </div>
                                    </>
                                )}
                            </div>
                            
                            {/* RIGHT COLUMN - INCREASED VERTICAL GAPS FOR DEFINITION */}
                            <div className={`col-span-7 flex flex-col min-h-0 ${mapLayout === 'bottom' ? 'gap-6' : 'gap-8'}`}>
                                <div className="shrink-0">
                                    <h2 className="text-[4rem] font-black text-[#1e293b] uppercase leading-[0.8] tracking-tight mb-2">{customName}</h2>
                                    <h3 className="text-2xl font-bold text-[#10b981] uppercase tracking-wider">{animal.species}</h3>
                                    <p className="text-lg text-slate-400 font-serif italic mt-1 mb-4">{animal.latin_name}</p>
                                    <div className="h-1.5 w-32 bg-[#10b981] mb-2 rounded-full"></div>
                                    
                                    {mapLayout === 'side' && (
                                        <>
                                            <div className="flex gap-8 mb-6 mt-6 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                                <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200"><Info size={20}/></div><div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">DOB</p><p className="font-bold text-slate-800">{formatDate(animal.date_of_birth)}</p></div></div>
                                                <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200"><Info size={20}/></div><div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">GENDER</p><p className="font-bold text-slate-800 uppercase">{animal.gender}</p></div></div>
                                                <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200"><Calendar size={20}/></div><div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">ARRIVED</p><p className="font-bold text-slate-800">{getArrivalYear(animal.acquisition_date)}</p></div></div>
                                            </div>
                                            <div className="grid grid-cols-4 gap-2 bg-[#f0fdf4] p-3 rounded-xl border border-emerald-100">
                                                <div className="text-center"><p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">WILD LIFESPAN</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.lifespanWild || '-'}</p></div>
                                                <div className="text-center border-l border-emerald-200"><p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">CAPTIVE LIFESPAN</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.lifespanCaptivity || '-'}</p></div>
                                                <div className="text-center border-l border-emerald-200"><p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">{dynamicDimensionLabel}</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.wingspan || '-'}</p></div>
                                                <div className="text-center border-l border-emerald-200"><p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">WEIGHT</p><p className="text-sm font-bold text-slate-800 leading-tight">{content.weight || '-'}</p></div>
                                            </div>
                                        </>
                                    )}
                                </div>
                                
                                {/* DYNAMIC TEXT BLOCKS */}
                                <div className="flex flex-col gap-3 flex-1 min-h-0 justify-between overflow-hidden">
                                    <div className="flex-1 min-h-0 flex flex-col">
                                      <h4 className="text-xs font-black text-[#1e293b] uppercase tracking-widest mb-1.5 border-b border-slate-200 pb-1 shrink-0">DIET</h4>
                                      <ul className="list-disc list-outside pl-4 text-sm text-slate-700 space-y-1 font-medium leading-snug marker:text-[#10b981] overflow-hidden">
                                        {renderBullets(content.dietText)}
                                      </ul>
                                    </div>
                                    <div className="flex-1 min-h-0 flex flex-col">
                                      <h4 className="text-xs font-black text-[#1e293b] uppercase tracking-widest mb-1.5 border-b border-slate-200 pb-1 shrink-0">HABITAT</h4>
                                      <ul className="list-disc list-outside pl-4 text-sm text-slate-700 space-y-1 font-medium leading-snug marker:text-[#10b981] overflow-hidden">
                                        {renderBullets(content.habitatText)}
                                      </ul>
                                    </div>
                                    <div className="flex-1 min-h-0 flex flex-col">
                                      <h4 className="text-xs font-black text-[#1e293b] uppercase tracking-widest mb-1.5 border-b border-slate-200 pb-1 shrink-0">DID YOU KNOW?</h4>
                                      <ul className="list-disc list-outside pl-4 text-sm text-slate-700 space-y-1 font-medium leading-snug marker:text-[#10b981] overflow-hidden">
                                        {renderBullets(content.didYouKnowText)}
                                      </ul>
                                    </div>
                                </div>
                                
                                {mapLayout === 'bottom' && (
                                  <div className="h-56 bg-slate-50 rounded-2xl p-3 border-2 border-slate-200 shadow-sm shrink-0 flex flex-col mt-auto">
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] w-full text-left mb-1 pl-1 shrink-0">NATIVE RANGE</h3>
                                    <div className="rounded-xl overflow-hidden border border-slate-200 w-full bg-white relative flex items-center justify-center flex-1 min-h-0">
                                      {animal.distribution_map_url ? <img src={animal.distribution_map_url} alt="Range Map" className="w-full h-full object-contain" crossOrigin="anonymous" onError={handleImageError}/> : <div className="w-full h-full flex items-center justify-center text-slate-300"><Globe size={32} /></div>}
                                    </div>
                                  </div>
                                )}
                            </div>
                        </div>
                        
                        {/* FOOTER BAR */}
                        <div className="h-28 bg-[#10b981] flex items-center justify-between px-10 text-white relative overflow-hidden shrink-0">
                          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #fff 2px, transparent 2.5px)', backgroundSize: '24px 24px' }}></div>
                          <div className="relative z-10 max-w-[70%]">
                            <h2 className="text-2xl font-black uppercase italic tracking-wide mb-1 shadow-black drop-shadow-sm">ADOPT {customName} TODAY!</h2>
                            <p className="text-xs font-medium opacity-95 leading-snug">Scan the code to adopt {customName}. Your support helps provide food, care, and enrichment for our collection.</p>
                          </div>
                          <div className="relative z-10 bg-white p-1.5 rounded-xl shadow-2xl shrink-0 flex items-center justify-center">
                            <ImageIcon size={24} className="text-slate-300 absolute z-0" />
                            <img src={qrCodeUrl} alt="Adoption QR" className="w-20 h-20 relative z-10" crossOrigin="anonymous" onError={handleImageError}/>
                          </div>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}

export default SignGenerator;
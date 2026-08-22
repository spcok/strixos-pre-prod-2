import React, { useState, useRef } from 'react';
import { Animal } from '../../types';
import { 
  Download, Printer, FileText, Sparkles, MapPin, 
  ShieldAlert, Heart, Calendar, Scale, Thermometer, Droplets
} from 'lucide-react';
import { IUCNBadge } from './IUCNBadge';

interface SignGeneratorProps {
  animal: Animal;
  onClose?: () => void;
}

export function SignGenerator({ animal, onClose }: SignGeneratorProps) {
  const [template, setTemplate] = useState<'ENCLOSURE' | 'HANDHELD' | 'EDUCATIONAL'>('ENCLOSURE');
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const minHum = animal.target_humidity_min_percent ?? 40;
  const maxHum = animal.target_humidity_max_percent ?? animal.target_humidity_min_percent ?? 60;

  return (
    <div className="space-y-4 font-sans max-w-4xl mx-auto">
      {/* Control Ribbon */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2">
          <FileText className="text-slate-700" size={18} />
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">
            Enclosure Sign & Specimen Card Generator
          </h3>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {(['ENCLOSURE', 'HANDHELD', 'EDUCATIONAL'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTemplate(t)}
                className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  template === t ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
          >
            <Printer size={14} className="text-emerald-400" />
            <span>Print Sign</span>
          </button>
        </div>
      </div>

      {/* Printable Preview Canvas */}
      <div 
        ref={printRef}
        className="bg-white border-2 border-slate-900 rounded-3xl p-8 shadow-xl max-w-2xl mx-auto flex flex-col justify-between min-h-[480px] print:m-0 print:border-none print:shadow-none"
      >
        <div>
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 inline-block mb-1">
                {animal.category || 'Avian Specimen'}
              </span>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">{animal.name}</h1>
              <p className="text-sm font-bold text-slate-500 italic mt-0.5">{animal.latin_name || animal.scientific_name || animal.species}</p>
            </div>
            {animal.red_list_status && (
              <IUCNBadge status={animal.red_list_status} />
            )}
          </div>

          {/* Core Specimen Metrics Grid */}
          <div className="grid grid-cols-3 gap-3 my-6 text-center">
            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Specimen ID</span>
              <span className="text-sm font-mono font-bold text-slate-900">{animal.ring_number || animal.microchip_number || 'Registered'}</span>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Location</span>
              <span className="text-sm font-bold text-slate-900">{animal.location || animal.enclosure || 'Enclosure'}</span>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Sex</span>
              <span className="text-sm font-bold text-slate-900">{animal.gender || 'Unknown'}</span>
            </div>
          </div>

          {/* Environmental Requirements */}
          <div className="grid grid-cols-2 gap-3 mb-4 text-xs font-medium">
            <div className="p-3 bg-purple-50 rounded-2xl border border-purple-100 flex items-center gap-2.5">
              <Thermometer size={20} className="text-purple-600 shrink-0" />
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-purple-700 block">Target Thermal Zone</span>
                <span className="font-bold text-slate-800">{animal.target_day_temp_c ? `${animal.target_day_temp_c}°C Day` : 'Ambient Conditions'}</span>
              </div>
            </div>

            <div className="p-3 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-2.5">
              <Droplets size={20} className="text-blue-600 shrink-0" />
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-blue-700 block">Target Humidity</span>
                <span className="font-bold text-slate-800">{minHum}% – {maxHum}%</span>
              </div>
            </div>
          </div>

          {/* Husbandry Notes */}
          {(animal.description || animal.special_requirements || animal.critical_husbandry_notes) && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 leading-relaxed font-medium">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                Husbandry Notes & Protocol
              </span>
              {animal.critical_husbandry_notes || animal.special_requirements || animal.description}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-slate-400">
          <span>StrixOS Avian Management System</span>
          <span>Kent Owl Academy Statutory ZLA Registry</span>
        </div>
      </div>
    </div>
  );
}

export default SignGenerator;
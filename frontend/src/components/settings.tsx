// Settings.tsx
import { useState, useEffect } from "react";

export type UserSettings = {
  difficulty: string;
  frequency: string;
  specificGroups: string;
  specificSounds: string;
};

type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: UserSettings;
  onSave: (newSettings: UserSettings) => void;
};

export default function Settings({ isOpen, onClose, currentSettings, onSave }: SettingsProps) {
  // Local state so we only apply changes if they click "Save"
  const [localSettings, setLocalSettings] = useState<UserSettings>(currentSettings);

  // Reset local state to match current settings whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(currentSettings);
    }
  }, [isOpen, currentSettings]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleChange = (field: keyof UserSettings, value: string) => {
    setLocalSettings((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-lg font-bold text-slate-800">Quiz Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col gap-5">
          
          {/* Difficulty */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Difficulty</label>
            <select 
              value={localSettings.difficulty}
              onChange={(e) => handleChange("difficulty", e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:bg-white text-sm text-slate-700 font-medium"
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>

          {/* Frequency */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Frequency (Questions)</label>
            <select 
              value={localSettings.frequency}
              onChange={(e) => handleChange("frequency", e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:bg-white text-sm text-slate-700 font-medium"
            >
              <option value="3-5">3 - 5</option>
              <option value="5-10">5 - 10</option>
              <option value="10-15">10 - 15</option>
            </select>
          </div>

          {/* Specific Groups */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Specific Groups <span className="text-gray-400 font-normal">(Optional)</span></label>
            <select 
              value={localSettings.specificGroups}
              onChange={(e) => handleChange("specificGroups", e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:bg-white text-sm text-slate-700 font-medium"
            >
              <option value="">None Selected</option>
              <option value="Fricatives">Fricatives</option>
              <option value="Vowels">Vowels</option>
              <option value="Plosives">Plosives</option>
            </select>
          </div>

          {/* Specific Sounds */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Specific Sounds <span className="text-gray-400 font-normal">(Optional)</span></label>
            <select 
              value={localSettings.specificSounds}
              onChange={(e) => handleChange("specificSounds", e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:bg-white text-sm text-slate-700 font-medium"
            >
              <option value="">None Selected</option>
              <option value="/s/">/s/</option>
              <option value="/ae/">/ae/</option>
              <option value="/f/">/f/</option>
            </select>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="px-6 py-2 bg-[#0b0f19] text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
          >
            Save Settings
          </button>
        </div>

      </div>
    </div>
  );
}
// Settings.tsx
import { useState, useEffect } from "react";

export type UserSettings = {
  type: "Lecture" | "Cochlear";
  difficulty: string;
  frequency: string;
  cochlearAssessmentMode: "multiple-choice" | "fill-in-the-blanks" | "both";
  specificGroups: string;
  specificSounds: string;
};

type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: UserSettings;
  isDarkMode: boolean;
  onSave: (newSettings: UserSettings) => void;
};

export default function Settings({
  isOpen,
  onClose,
  currentSettings,
  isDarkMode,
  onSave,
}: SettingsProps) {
  // Local state so we only apply changes if they click "Save"
  const [localSettings, setLocalSettings] = useState<UserSettings>(currentSettings);
  const [shouldRender, setShouldRender] = useState(isOpen);

  // Reset local state to match current settings whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(currentSettings);
      setShouldRender(true);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRender(false);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, currentSettings]);

  if (!shouldRender) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleChange = (field: keyof UserSettings, value: string) => {
    setLocalSettings((prev) => ({ ...prev, [field]: value }));
  };

  const isCochlear = localSettings.type === "Cochlear";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm ${
        isOpen ? "animate-popup-overlay-in" : "animate-popup-overlay-out"
      }`}
    >
      <div
        className={`w-full max-w-md overflow-hidden rounded-xl shadow-xl ${
          isOpen ? "animate-popup-panel-in" : "animate-popup-panel-out"
        } ${
          isDarkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-800"
        }`}
      >

        {/* Modal Header */}
        <div
          className={`flex items-center justify-between border-b px-6 py-4 ${
            isDarkMode ? "border-slate-800 bg-slate-950/70" : "border-gray-100 bg-gray-50/50"
          }`}
        >
          <h2 className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>Echolearn Settings</h2>
          <button
            onClick={onClose}
            className={`transition-colors ${isDarkMode ? "text-slate-500 hover:text-slate-200" : "text-gray-400 hover:text-gray-600"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col gap-5">

          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <label className={`text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["Lecture", "Cochlear"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleChange("type", t)}
                  className={`py-2.5 px-4 rounded-lg border text-sm font-semibold transition-all ${
                    localSettings.type === t
                      ? "bg-[#0b0f19] text-white border-[#0b0f19]"
                      : isDarkMode
                      ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500"
                      : "bg-gray-50 text-slate-700 border-gray-200 hover:border-slate-400"
                  }`}
                >
                  {t === "Lecture" ? "Lecture" : "Cochlear / Hearing"}
                </button>
              ))}
            </div>
            <p className={`mt-0.5 text-xs ${isDarkMode ? "text-slate-400" : "text-gray-400"}`}>
              {isCochlear
                ? "Targets phonetically difficult words for hearing rehabilitation."
                : "Asks comprehension questions about topics covered in the video."}
            </p>
          </div>

          {/* Difficulty */}
          <div className="flex flex-col gap-1.5">
            <label className={`text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>Difficulty</label>
            <select
              value={localSettings.difficulty}
              onChange={(e) => handleChange("difficulty", e.target.value)}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-800 ${
                isDarkMode
                  ? "border-slate-700 bg-slate-800 text-slate-100 focus:bg-slate-800"
                  : "border-gray-200 bg-gray-50 text-slate-700 focus:bg-white"
              }`}
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>

          {/* Frequency */}
          <div className="flex flex-col gap-1.5">
            <label className={`text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>Frequency (Questions)</label>
            <select
              value={localSettings.frequency}
              onChange={(e) => handleChange("frequency", e.target.value)}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-800 ${
                isDarkMode
                  ? "border-slate-700 bg-slate-800 text-slate-100 focus:bg-slate-800"
                  : "border-gray-200 bg-gray-50 text-slate-700 focus:bg-white"
              }`}
            >
              <option value="3-5">3 - 5</option>
              <option value="5-10">5 - 10</option>
              <option value="10-15">10 - 15</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={`text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
              Assessment Style
            </label>
            <select
              value={localSettings.cochlearAssessmentMode}
              onChange={(e) => handleChange("cochlearAssessmentMode", e.target.value)}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-800 ${
                isDarkMode
                  ? "border-slate-700 bg-slate-800 text-slate-100 focus:bg-slate-800"
                  : "border-gray-200 bg-gray-50 text-slate-700 focus:bg-white"
              }`}
            >
              <option value="multiple-choice">Multiple choice</option>
              <option value="fill-in-the-blanks">Fill in the blanks</option>
              <option value="both">Both</option>
            </select>
            <p className={`mt-0.5 text-xs ${isDarkMode ? "text-slate-400" : "text-gray-400"}`}>
              {isCochlear
                ? "Choose whether cochlear practice uses recognition, recall, or a mix of both."
                : "Choose whether lecture questions use multiple choice, fill in the blanks, or a balanced mix."}
            </p>
          </div>

          {/* Cochlear-only options */}
          {isCochlear && (
            <>
              {/* Specific Groups */}
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                  Specific Groups <span className={`${isDarkMode ? "text-slate-400" : "text-gray-400"} font-normal`}>(Optional)</span>
                </label>
                <select
                  value={localSettings.specificGroups}
                  onChange={(e) => handleChange("specificGroups", e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-800 ${
                    isDarkMode
                      ? "border-slate-700 bg-slate-800 text-slate-100 focus:bg-slate-800"
                      : "border-gray-200 bg-gray-50 text-slate-700 focus:bg-white"
                  }`}
                >
                  <option value="">None Selected</option>
                  <option value="Fricatives">Fricatives</option>
                  <option value="Vowels">Vowels</option>
                  <option value="Plosives">Plosives</option>
                </select>
              </div>

              {/* Specific Sounds */}
              <div className="flex flex-col gap-1.5">
                <label className={`text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                  Specific Sounds <span className={`${isDarkMode ? "text-slate-400" : "text-gray-400"} font-normal`}>(Optional)</span>
                </label>
                <select
                  value={localSettings.specificSounds}
                  onChange={(e) => handleChange("specificSounds", e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-800 ${
                    isDarkMode
                      ? "border-slate-700 bg-slate-800 text-slate-100 focus:bg-slate-800"
                      : "border-gray-200 bg-gray-50 text-slate-700 focus:bg-white"
                  }`}
                >
                  <option value="">None Selected</option>
                  <option value="/s/">/s/</option>
                  <option value="/ae/">/ae/</option>
                  <option value="/f/">/f/</option>
                </select>
              </div>
            </>
          )}

        </div>

        {/* Modal Footer */}
        <div
          className={`flex justify-end gap-3 border-t px-6 py-4 ${
            isDarkMode ? "border-slate-800 bg-slate-950/70" : "border-gray-100 bg-gray-50/50"
          }`}
        >
          <button
            onClick={onClose}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              isDarkMode ? "text-slate-400 hover:text-slate-100" : "text-slate-600 hover:text-slate-900"
            }`}
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

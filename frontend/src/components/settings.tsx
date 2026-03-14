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
  onSave: (newSettings: UserSettings) => void;
};

export default function Settings({ isOpen, onClose, currentSettings, onSave }: SettingsProps) {
  const [localSettings, setLocalSettings] = useState<UserSettings>(currentSettings);
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(currentSettings);
      setShouldRender(true);
      return;
    }
    const id = window.setTimeout(() => setShouldRender(false), 200);
    return () => window.clearTimeout(id);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E2E0DB] bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E0DB] px-6 py-4">
          <h2 className="font-semibold text-[#1C1B18]">Settings</h2>
          <button onClick={onClose} className="p-1.5 text-[#B8B5AF] transition-colors hover:text-[#1C1B18]">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 p-6">

          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1C1B18]">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {(["Lecture", "Cochlear"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleChange("type", t)}
                  className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                    localSettings.type === t
                      ? "border-[#D4500A] bg-[#D4500A] text-white"
                      : "border-[#E2E0DB] bg-[#F7F6F2] text-[#1C1B18] hover:border-[#D4D2CC]"
                  }`}
                >
                  {t === "Lecture" ? "Lecture" : "Cochlear / Hearing"}
                </button>
              ))}
            </div>
            <p className="text-xs text-[#7A7570]">
              {isCochlear
                ? "Targets phonetically difficult words for hearing rehabilitation."
                : "Asks comprehension questions about topics covered in the video."}
            </p>
          </div>

          {/* Difficulty */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1C1B18]">Difficulty</label>
            <select
              value={localSettings.difficulty}
              onChange={(e) => handleChange("difficulty", e.target.value)}
              className="w-full rounded-lg border border-[#E2E0DB] bg-[#F7F6F2] px-3 py-2.5 text-sm text-[#1C1B18] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>

          {/* Frequency */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1C1B18]">Frequency (Questions)</label>
            <select
              value={localSettings.frequency}
              onChange={(e) => handleChange("frequency", e.target.value)}
              className="w-full rounded-lg border border-[#E2E0DB] bg-[#F7F6F2] px-3 py-2.5 text-sm text-[#1C1B18] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
            >
              <option value="3-5">3 – 5</option>
              <option value="5-10">5 – 10</option>
              <option value="10-15">10 – 15</option>
            </select>
          </div>

          {/* Cochlear-only */}
          {isCochlear && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#1C1B18]">Assessment Style</label>
                <select
                  value={localSettings.cochlearAssessmentMode}
                  onChange={(e) => handleChange("cochlearAssessmentMode", e.target.value)}
                  className="w-full rounded-lg border border-[#E2E0DB] bg-[#F7F6F2] px-3 py-2.5 text-sm text-[#1C1B18] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
                >
                  <option value="multiple-choice">Multiple choice</option>
                  <option value="fill-in-the-blanks">Fill in the blanks</option>
                  <option value="both">Both</option>
                </select>
                <p className="text-xs text-[#7A7570]">
                  Choose whether cochlear practice uses recognition, recall, or a mix.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#1C1B18]">
                  Specific Groups{" "}
                  <span className="font-normal text-[#B8B5AF]">(Optional)</span>
                </label>
                <select
                  value={localSettings.specificGroups}
                  onChange={(e) => handleChange("specificGroups", e.target.value)}
                  className="w-full rounded-lg border border-[#E2E0DB] bg-[#F7F6F2] px-3 py-2.5 text-sm text-[#1C1B18] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
                >
                  <option value="">None Selected</option>
                  <option value="Fricatives">Fricatives</option>
                  <option value="Vowels">Vowels</option>
                  <option value="Plosives">Plosives</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#1C1B18]">
                  Specific Sounds{" "}
                  <span className="font-normal text-[#B8B5AF]">(Optional)</span>
                </label>
                <select
                  value={localSettings.specificSounds}
                  onChange={(e) => handleChange("specificSounds", e.target.value)}
                  className="w-full rounded-lg border border-[#E2E0DB] bg-[#F7F6F2] px-3 py-2.5 text-sm text-[#1C1B18] focus:border-[#D4500A] focus:outline-none focus:ring-2 focus:ring-[#D4500A]/20"
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

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[#E2E0DB] px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#7A7570] transition-colors hover:text-[#1C1B18]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-[#D4500A] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#B83D07]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

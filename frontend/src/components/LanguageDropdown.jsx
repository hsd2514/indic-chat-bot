import React from "react";

function LanguageDropdown({ language, setLanguage, LANGUAGES }) {
  return (
    <select
      className="select select-bordered select-sm max-w-xs bg-base-100 text-black font-semibold"
      value={language}
      onChange={e => setLanguage(e.target.value)}
    >
      {LANGUAGES.map(lang => (
        <option key={lang.code} value={lang.code}>
          {lang.name}
        </option>
      ))}
    </select>
  );
}

export default LanguageDropdown;

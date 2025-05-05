import LanguageDropdown from "./LanguageDropdown";

function Navbar({ language, setLanguage, LANGUAGES, t }) {
  return (
    <div className="navbar bg-primary text-primary-content rounded-t-box px-4 py-2 w-full fixed top-0 left-0 z-30">
      <div className="w-full max-w-2xl mx-auto flex justify-between items-center">
        <span className="text-lg font-bold">{t("Indic Chat Bot")}</span>
        <LanguageDropdown
          language={language}
          setLanguage={setLanguage}
          LANGUAGES={LANGUAGES}
        />
      </div>
    </div>
  );
}

export default Navbar;

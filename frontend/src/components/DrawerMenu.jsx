import LanguageDropdown from "./LanguageDropdown";

function DrawerMenu({ t }) {
  return (
    <div className="drawer-side lg:hidden">
      <label htmlFor="nav-drawer" className="drawer-overlay"></label>
      <ul className="menu p-4 w-60 min-h-full bg-base-100 text-base-content">
        <li className="menu-title">{t("Menu")}</li>
        <li>
          <span className="text-black font-semibold">{t("Indic Chat Bot")}</span>
        </li>
        {/* Add more menu items here if needed */}
      </ul>
    </div>
  );
}

export default DrawerMenu;

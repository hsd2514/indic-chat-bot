import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ScreenSharePanel component handles screen sharing functionality and displays the preview
 */
function ScreenSharePanel({ 
  isScreenSharing,
  toggleScreenSharing,
  currentScreenshot,
  isConnected
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full border-l border-base-300">
      <div className="p-4 border-b border-base-300">
        <h3 className="font-medium text-lg mb-2">{t('Screen Sharing')}</h3>
        <button
          type="button"
          className={`btn w-full ${isScreenSharing ? "btn-error" : "btn-info"}`}
          onClick={toggleScreenSharing}
          disabled={!isConnected}
        >
          {isScreenSharing ? (
            <>
              {/* Stop Screen Share Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t("Stop Screen Sharing")}
            </>
          ) : (
            <>
              {/* Screen Share Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {t("Start Screen Sharing")}
            </>
          )}
        </button>
      </div>
      
      {/* Preview Area */}
      <div className="flex-1 p-4 overflow-auto">
        {isScreenSharing && currentScreenshot ? (
          <div>
            <div className="text-xs text-center mb-2 text-base-content/70">{t('Live Screen Preview')}</div>
            <img 
              src={currentScreenshot} 
              alt={t('Screen share')}
              className="w-full object-contain rounded border border-base-300"
            />
            <p className="text-xs mt-2 text-center text-base-content/70">
              {t('This screenshot will be shared when you send a message')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-base-content/50">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p>{t('No screen being shared')}</p>
            <p className="text-xs mt-2">
              {isConnected 
                ? t('Click "Start Screen Sharing" to share your screen') 
                : t('Connect to enable screen sharing')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ScreenSharePanel;

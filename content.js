

let isWatchingShorts = false;
let startTime = null;
let intervalId = null;
let currentTabId = null;
let limitReached = false;

// НОВОЕ: Отслеживание активности пользователя
let lastUserActivity = Date.now();
let videoLoopCount = 0;
let lastVideoUrl = '';
let inactivityCheckInterval = null;

// Подавление TrustedScriptURL ошибок
(function() {
    'use strict';
    
    if (typeof window === 'undefined') return;
    
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.error = function(...args) {
        const message = String(args.join(' '));
        if (message.includes('TrustedScriptURL') || 
            message.includes('Failed to set the \'src\' property')) {
            return;
        }
        originalError.apply(console, args);
    };
    
    console.warn = function(...args) {
        const message = String(args.join(' '));
        if (message.includes('TrustedScriptURL') || 
            message.includes('Failed to set the \'src\' property')) {
            return;
        }
        originalWarn.apply(console, args);
    };
    
    const errorHandler = function(event) {
        const message = event.message || String(event.error || '');
        if (message.includes('TrustedScriptURL') || 
            message.includes('Failed to set the \'src\' property')) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return false;
        }
    };
    
    window.addEventListener('error', errorHandler, true);
    
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const message = String(reason?.message || reason || '');
        if (message.includes('TrustedScriptURL') || 
            message.includes('Failed to set the \'src\' property')) {
            event.preventDefault();
            return false;
        }
    }, true);
})();


// Получаем ID вкладки
chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
    if (chrome.runtime.lastError) {
        console.warn('⚠️ Ошибка получения Tab ID:', chrome.runtime.lastError.message);
        return;
    }
    
    if (response && response.tabId) {
        currentTabId = response.tabId;
        console.log('✅ Tab ID получен:', currentTabId);
    } else {
        console.warn('⚠️ Не удалось получить Tab ID');
    }
});

// НОВОЕ: Обработчик сообщений от background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Получено сообщение:', message.type);
    
    switch (message.type) {
        case 'PAUSE_TRACKING':
            console.log('⏸️ Получен сигнал паузы');
        // Пауза всегда должна работать, независимо от popup
        if (isWatchingShorts) {
            stopTracking();
        }
        sendResponse({ success: true });
        break;
            
        case 'CHECK_STATE':
            console.log('🔍 Проверка состояния');
            // Проверяем, нужно ли начать отслеживание
            setTimeout(() => {
                monitorShorts();
            }, 100);
            sendResponse({ success: true });
            break;
    }
    
    return true;
});

// НОВОЕ: Добавим функцию для проверки, активен ли popup
function checkIfPopupOpen(callback) {
    chrome.runtime.sendMessage({ type: 'IS_POPUP_OPEN' }, (response) => {
        if (chrome.runtime.lastError) {
            callback(false);
            return;
        }
        callback(response ? response.popupOpen : false);
    });
}

// НОВОЕ: Отслеживание активности пользователя
function setupActivityTracking() {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    
    events.forEach(eventType => {
        document.addEventListener(eventType, () => {
            lastUserActivity = Date.now();
            videoLoopCount = 0; // Сбрасываем счетчик повторов при активности
        }, { passive: true, capture: true });
    });
    
    console.log('👆 Отслеживание активности пользователя включено');
}

// НОВОЕ: Проверка неактивности
function checkInactivity() {
    const now = Date.now();
    const timeSinceActivity = now - lastUserActivity;
    
    // Если нет активности более 2 минут (120000 мс)
    if (timeSinceActivity > 120000 && isWatchingShorts) {
        console.log('😴 Пользователь неактивен более 2 минут, останавливаем отслеживание');
        stopTracking();
        return true;
    }
    
    return false;
}

// НОВОЕ: Отслеживание повторов видео
function trackVideoLoop() {
    const video = document.querySelector('video');
    if (!video) return;
    
    const currentUrl = window.location.href;
    
    // Проверяем, повторилось ли видео
    if (video.currentTime < 2 && video.duration > 0) {
        if (currentUrl === lastVideoUrl) {
            videoLoopCount++;
            console.log('🔄 Видео повторилось:', videoLoopCount, 'раз');
            
            // Если видео повторилось 2 раза без активности пользователя
            const timeSinceActivity = Date.now() - lastUserActivity;
            if (videoLoopCount >= 2 && timeSinceActivity > 10000) { // 10 секунд без активности
                console.log('⚠️ Видео повторилось 2 раза без активности, останавливаем');
                stopTracking();
            }
        } else {
            lastVideoUrl = currentUrl;
            videoLoopCount = 0;
        }
    }
}

function checkIfOnShortsPage() {
    const url = window.location.href;
    
    // СТРОГАЯ проверка URL - только прямые ссылки на Shorts
    const isExactShortsUrl = 
        url.includes('/shorts/') || 
        url.includes('youtube.com/shorts') && 
        (url.includes('/shorts') || url.includes('/shorts/'));
    
    // Проверяем pathname
    const pathname = window.location.pathname;
    const isShortsPathname = pathname.startsWith('/shorts/');
    
    // ДОПОЛНИТЕЛЬНО: проверяем, что это не главная страница
    const isHomePage = pathname === '/' || pathname === '' || pathname === '/feed/subscriptions' || 
                      pathname === '/feed/explore' || pathname === '/feed/trending';
    
    // Если это главная страница - точно НЕ Shorts
    if (isHomePage) {
        console.log('ℹ️ Это главная страница YouTube, не Shorts');
        return false;
    }
    
    // Проверяем DOM элементы, но только если URL соответствует
    if (isExactShortsUrl || isShortsPathname) {
        const hasShortsPlayer = document.querySelector('ytd-shorts, [is-shorts], #shorts-container') !== null;
        return hasShortsPlayer;
    }
    
    return false;
}

function isVideoPlaying() {
    const video = document.querySelector('video');
    if (!video) return false;
    
    return !video.paused && !video.ended && video.readyState > 2;
}

// НОВОЕ: Проверка, что окно активно
function isWindowActive() {
    // Проверяем visibility API
    if (document.hidden) {
        return false;
    }
    
    // Проверяем, что окно в фокусе
    if (!document.hasFocus()) {
        return false;
    }
    
    return true;
}

function checkLimitBeforeStart(callback) {
    chrome.runtime.sendMessage({
        type: 'CHECK_LIMIT'
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Ошибка проверки лимита:', chrome.runtime.lastError);
            callback(false);
            return;
        }
        
        if (response && response.limitReached) {
            console.log('🚫 Лимит уже достигнут!');
            limitReached = true;
            
             if (checkIfOnShortsPage() && response.redirectUrl) {
        console.log('🚫 Попытка открыть Shorts при достигнутом лимите, редирект');
        // Проверяем, что мы не уже на видео для редиректа
        if (!window.location.href.includes(response.redirectUrl)) {
            window.location.href = response.redirectUrl;  // <-- РЕДИРЕКТ ЗДЕСЬ!
        }
    }
            
            callback(true);
        } else {
            limitReached = false;
            callback(false);
        }
    });
}

function startTracking() {
    // НОВОЕ: Проверяем, что окно активно
    if (!isWindowActive()) {
        console.log('⏸️ Окно неактивно, не начинаем отслеживание');
        return;
    }
    
    checkLimitBeforeStart((isLimitReached) => {
        if (isLimitReached) {
            console.log('🚫 Отслеживание не начато - лимит исчерпан');
            return;
        }
        
        if (!isWatchingShorts) {
            isWatchingShorts = true;
            startTime = Date.now();
            lastUserActivity = Date.now(); // Сбрасываем при старте
            videoLoopCount = 0;
            lastVideoUrl = window.location.href;
            
            console.log('🎬 Начали отслеживание Shorts');
            
            chrome.runtime.sendMessage({
                type: 'SHORTS_START',
                tabId: currentTabId,
                timestamp: startTime,
                url: window.location.href
            });
            
            // Heartbeat каждую секунду
            intervalId = setInterval(() => {
                sendHeartbeat();
                trackVideoLoop(); // Проверяем повторы
            }, 1000);
            
            // НОВОЕ: Проверка неактивности каждые 10 секунд
            inactivityCheckInterval = setInterval(() => {
                checkInactivity();
            }, 10000);
            
            sendHeartbeat();
        }
    });
}

function stopTracking() {
    // НОВОЕ: Проверяем, открыт ли popup
    checkIfPopupOpen((isPopupOpen) => {
        if (isPopupOpen) {
            console.log('ℹ️ Popup открыт, но останавливаем отслеживание из-за паузы');
        }
        
        if (isWatchingShorts) {
            isWatchingShorts = false;
            const endTime = Date.now();
            
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            
            if (inactivityCheckInterval) {
                clearInterval(inactivityCheckInterval);
                inactivityCheckInterval = null;
            }
            
            const timeSpent = Math.floor((endTime - startTime) / 1000);
            
            chrome.runtime.sendMessage({
                type: 'SHORTS_END',
                tabId: currentTabId,
                startTime: startTime,
                endTime: endTime,
                timeSpent: timeSpent,
                url: window.location.href
            });
            
            console.log('⏹️ Остановили отслеживание Shorts, время:', timeSpent, 'секунд');
            startTime = null;
            videoLoopCount = 0;
        }
    });
}

function sendHeartbeat() {
    if (isWatchingShorts && startTime) {
        const currentTime = Date.now();
        const timeSpent = Math.floor((currentTime - startTime) / 1000);
        
        console.log('💓 Heartbeat:', timeSpent, 'сек');
        
        chrome.runtime.sendMessage({
            type: 'SHORTS_HEARTBEAT',
            tabId: currentTabId,
            timeSpent: timeSpent,
            url: window.location.href
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Ошибка отправки heartbeat:', chrome.runtime.lastError);
                return;
            }
            
            if (response && response.shouldRedirect) {
                console.log('🚫 Получен сигнал редиректа от background');
                stopTracking();
                
                if (response.redirectUrl && checkIfOnShortsPage()) {
                     if (!window.location.href.includes(response.redirectUrl)) {
                        window.location.href = response.redirectUrl;
                     }
                }
            }
        });
        
        // ИСПРАВЛЕНО: Убрано, чтобы не создавать конфликт данных
        // Popup сам запрашивает актуальные данные каждую секунду
    }
}

function monitorShorts() {
    const currentlyOnShorts = checkIfOnShortsPage();
    const videoPlaying = isVideoPlaying();
    const windowActive = isWindowActive();
    
    if (currentlyOnShorts) {
        console.log('🔍 Мониторинг Shorts:', {
            onShortsPage: currentlyOnShorts,
            videoPlaying: videoPlaying,
            windowActive: windowActive,
            isTracking: isWatchingShorts
        });
    }
    
    // Убираем асинхронную проверку popup из условий остановки
    if (!windowActive && isWatchingShorts) {
        // Проверяем popup только для логики смены вкладки
        checkIfPopupOpen((isPopupOpen) => {
            if (!isPopupOpen) {
                console.log('⏸️ Окно неактивно, останавливаем отслеживание');
                stopTracking();
            }
        });
        return;
    }
    
    if (currentlyOnShorts && !isWatchingShorts) {
        checkLimitBeforeStart((isLimitReached) => {
            if (isLimitReached) {
                return;
            }
            
            if (videoPlaying && windowActive && !isWatchingShorts) {
                console.log('✅ Условия для начала отслеживания выполнены');
                startTracking();
            }
        });
    } else if ((!currentlyOnShorts || !videoPlaying) && isWatchingShorts) {
        // ИСПРАВЛЕНО: Останавливаем ВСЕГДА если видео на паузе или не на шортс
        console.log('⏹️ Видео на паузе или не на шортс, останавливаем отслеживание');
        stopTracking();
    }
}

let lastUrl = window.location.href;

function checkUrlChange() {
    try {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            console.log('🌐 URL изменился:', currentUrl);
            
            // Сбрасываем счетчик повторов при смене URL
            videoLoopCount = 0;
            lastVideoUrl = currentUrl;
            
            if (currentUrl.includes('/shorts/')) {
                checkLimitBeforeStart((isLimitReached) => {
                    if (!isLimitReached) {
                        monitorShorts();
                    }
                });
            } else {
                monitorShorts();
            }
        }
    } catch (e) {
        // Игнорируем ошибки
    }
}

let videoListeners = new WeakSet();
function setupVideoListeners() {
    try {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            if (videoListeners.has(video)) return;
            
            try {
                video.addEventListener('play', () => {
                    console.log('▶️ Видео начало играть');
                    lastUserActivity = Date.now();
                    monitorShorts();
                }, { passive: true, once: false });
                
                video.addEventListener('pause', () => {
                    console.log('⏸️ Видео приостановлено');
                    monitorShorts();
                }, { passive: true, once: false });
                
                video.addEventListener('ended', () => {
                    console.log('🏁 Видео закончилось');
                    monitorShorts();
                }, { passive: true, once: false });
                
                video.addEventListener('loadeddata', () => {
                    monitorShorts();
                }, { passive: true, once: false });
                
                videoListeners.add(video);
            } catch (error) {
                // Игнорируем ошибки
            }
        });
    } catch (error) {
        // Игнорируем ошибки
    }
}

function init() {
    console.log('🚀 Shorts Limiter запущен на YouTube');
    console.log('📍 Текущий URL:', window.location.href);
    
    // НОВОЕ: Настройка отслеживания активности
    setupActivityTracking();
    
    setupVideoListeners();
    
    console.log('⚡ Немедленная проверка при загрузке');
    monitorShorts();
    
    setTimeout(() => {
        console.log('⏰ Проверка через 500ms');
        monitorShorts();
        setupVideoListeners();
    }, 500);
    
    setTimeout(() => {
        console.log('⏰ Проверка через 1 секунду');
        monitorShorts();
        setupVideoListeners();
    }, 1000);
    
    const monitorInterval = setInterval(() => {
        monitorShorts();
        setupVideoListeners();
    }, 1000);
    
    const urlCheckInterval = setInterval(checkUrlChange, 1000);
    
    // НОВОЕ: Отслеживание visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.log('👁️ Страница скрыта');
            // Проверяем, открыт ли popup
            checkIfPopupOpen((isPopupOpen) => {
                if (!isPopupOpen && isWatchingShorts) {
                    stopTracking();
                }
            });
        } else {
            console.log('👁️ Страница видима');
            setTimeout(monitorShorts, 500);
        }
    }, { passive: true });
    
    // НОВОЕ: Отслеживание фокуса окна
    window.addEventListener('blur', () => {
        console.log('🔇 Окно потеряло фокус');
        // Проверяем, открыт ли popup
        checkIfPopupOpen((isPopupOpen) => {
            if (!isPopupOpen && isWatchingShorts) {
                stopTracking();
            }
        });
    }, { passive: true });
    
    window.addEventListener('focus', () => {
        console.log('🔊 Окно получило фокус');
        setTimeout(monitorShorts, 500);
    }, { passive: true });
    
    window.addEventListener('beforeunload', () => {
        if (isWatchingShorts) {
            stopTracking();
        }
        clearInterval(monitorInterval);
        clearInterval(urlCheckInterval);
    }, { passive: true });
    
    let lastPopState = Date.now();
    window.addEventListener('popstate', () => {
        const now = Date.now();
        if (now - lastPopState > 100) {
            lastPopState = now;
            setTimeout(() => {
                checkUrlChange();
                setupVideoListeners();
            }, 200);
        }
    }, { passive: true });
    
    try {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            originalPushState.apply(history, args);
            setTimeout(() => {
                checkUrlChange();
                setupVideoListeners();
            }, 200);
        };
        
        history.replaceState = function(...args) {
            originalReplaceState.apply(history, args);
            setTimeout(() => {
                checkUrlChange();
                setupVideoListeners();
            }, 200);
        };
    } catch (error) {
        // Игнорируем ошибки
    }
}

console.log('🔧 Попытка инициализации, readyState:', document.readyState);

if (document.readyState === 'loading') {
    console.log('⏳ DOM еще загружается, ждем DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', () => {
        console.log('✅ DOMContentLoaded сработал');
        init();
    });
} else {
    console.log('✅ DOM уже готов, запускаем init() немедленно');
    init();
    
    setTimeout(() => {
        console.log('🔄 Повторная проверка через 100ms');
        monitorShorts();
        setupVideoListeners();
    }, 100);
}

// НОВОЕ: Реинициализация при активации вкладки
function checkAndReinit() {
    // Проверяем, инициализирован ли уже мониторинг
    const monitorIntervalExists = typeof monitorInterval !== 'undefined';
    
    if (window.location.href.includes('youtube.com') && !monitorIntervalExists) {
        console.log('🔄 Обнаружена вкладка YouTube без инициализации, запускаем...');
        init();
    }
}

// Проверяем при загрузке
if (window.location.href.includes('youtube.com')) {
    console.log('🔍 Проверяем инициализацию на YouTube');
    setTimeout(checkAndReinit, 1000);
}

// НОВОЕ: Слушаем сообщения от background о проверке состояния
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_STATE') {
        console.log('🔍 Получен запрос на проверку состояния');
        checkAndReinit();
        sendResponse({ success: true });
    }
    return true;
});
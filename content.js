let isTracking = false;
let startTime = null;
let intervalId = null;
let currentTabId = null;
let lastUrl = window.location.href;
let limitReached = false;
let redirectUrl = null;

// Получаем ID вкладки
chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
    if (chrome.runtime.lastError) {
        return;
    }
    
    if (response && response.tabId) {
        currentTabId = response.tabId;
        console.log('✅ Tab ID получен:', currentTabId);
    }
});

// Проверяем, находимся ли на странице шортсов
function checkIfOnShortsPage() {
    try {
        const url = window.location.href;
        return url.includes('/shorts/');
    } catch (error) {
        return false;
    }
}

// Проверяем, играет ли видео
function isVideoPlaying() {
    // Ищем кнопку с title="Приостановить (K)" - это значит видео ИГРАЕТ
    const pauseButton = document.querySelector('.yt-spec-button-shape-next.yt-spec-button-shape-next--tonal.yt-spec-button-shape-next--overlay-dark.yt-spec-button-shape-next--size-l.yt-spec-button-shape-next--icon-button.yt-spec-button-shape-next--enable-drop-shadow-experiment[title="Приостановить (K)"]');
    
    // Если нашли кнопку "Приостановить" - видео играет
    if (pauseButton) {
        return true;
    }
    
    // Ищем кнопку с title="Воспроизвести (K)" - это значит видео НА ПАУЗЕ
    const playButton = document.querySelector('.yt-spec-button-shape-next.yt-spec-button-shape-next--tonal.yt-spec-button-shape-next--overlay-dark.yt-spec-button-shape-next--size-l.yt-spec-button-shape-next--icon-button.yt-spec-button-shape-next--enable-drop-shadow-experiment[title="Воспроизвести (K)"]');
    
    // Если нашли кнопку "Воспроизвести" - видео на паузе
    if (playButton) {
        return false;
    }
    
    // Если ни одна кнопка не найдена, пробуем найти любую кнопку управления
    const anyButton = document.querySelector('.yt-spec-button-shape-next.yt-spec-button-shape-next--tonal.yt-spec-button-shape-next--overlay-dark.yt-spec-button-shape-next--size-l.yt-spec-button-shape-next--icon-button.yt-spec-button-shape-next--enable-drop-shadow-experiment');
    
    if (anyButton) {
        const title = anyButton.getAttribute('title') || '';
        return title === 'Приостановить (K)';
    }
    
    return false; // По умолчанию считаем, что видео не играет
}

// Проверяем лимит перед началом отслеживания
function checkLimitBeforeStart(callback) {
    chrome.runtime.sendMessage({
        type: 'CHECK_LIMIT'
    }, (response) => {
        if (chrome.runtime.lastError) {
            callback(false);
            return;
        }
        
        if (response && response.limitReached) {
            console.log('🚫 Лимит уже достигнут!');
            limitReached = true;
            redirectUrl = response.redirectUrl;
            
            // Если мы на шортсах и есть URL для редиректа
            if (checkIfOnShortsPage() && redirectUrl) {
                console.log('🚫 Попытка открыть Shorts при достигнутом лимите, редирект');
                if (!window.location.href.includes(redirectUrl)) {
                    window.location.href = redirectUrl;
                }
            }
            
            callback(true);
        } else {
            limitReached = false;
            redirectUrl = null;
            callback(false);
        }
    });
}

// Начинаем отслеживание времени
function startTracking() {
    if (isTracking || !checkIfOnShortsPage()) return;
    
    // Проверяем лимит перед стартом
    checkLimitBeforeStart((isLimitReached) => {
        if (isLimitReached) {
            console.log('🚫 Отслеживание не начато - лимит исчерпан');
            return;
        }
        
        isTracking = true;
        startTime = Date.now();
        
        console.log('🎬 Начинаем отслеживание (видео играет)');
        
        chrome.runtime.sendMessage({
            type: 'SHORTS_START',
            tabId: currentTabId,
            timestamp: startTime,
            url: window.location.href
        });
        
        // Heartbeat каждую секунду
        intervalId = setInterval(sendHeartbeat, 1000);
    });
}

// Останавливаем отслеживание времени
function stopTracking() {
    if (!isTracking) return;
    
    isTracking = false;
    const endTime = Date.now();
    
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    
    const timeSpent = Math.floor((endTime - startTime) / 1000);
    
    console.log('⏹️ Останавливаем отслеживание, время:', timeSpent, 'сек');
    
    chrome.runtime.sendMessage({
        type: 'SHORTS_END',
        tabId: currentTabId,
        startTime: startTime,
        endTime: endTime,
        timeSpent: timeSpent,
        url: window.location.href
    });
    
    startTime = null;
}

// Отправляем heartbeat каждую секунду
function sendHeartbeat() {
    if (isTracking && startTime) {
        const currentTime = Date.now();
        const timeSpent = Math.floor((currentTime - startTime) / 1000);
        
        chrome.runtime.sendMessage({
            type: 'SHORTS_HEARTBEAT',
            tabId: currentTabId,
            timeSpent: timeSpent,
            url: window.location.href
        }, (response) => {
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
    }
}

// Основная функция проверки состояния
function checkVideoState() {
    // Если не на шортсах - останавливаем
    if (!checkIfOnShortsPage()) {
        if (isTracking) {
            console.log('🚫 Не на шортсах, останавливаем');
            stopTracking();
        }
        return;
    }
    
    const videoPlaying = isVideoPlaying();
    console.log('🔍 Проверка: на шортсах, видео играет?', videoPlaying, 'отслеживаем?', isTracking);
    
    // Если видео играет и мы еще не отслеживаем
    if (videoPlaying && !isTracking) {
        console.log('▶️ Видео играет, начинаем отслеживание');
        startTracking();
    } 
    // Если видео на паузе и мы отслеживаем
    else if (!videoPlaying && isTracking) {
        console.log('⏸️ Видео на паузе, останавливаем');
        stopTracking();
    }
}

// Создаем наблюдатель за кнопкой управления
let buttonObserver = null;

function setupButtonObserver() {
    try {
        // Очищаем предыдущего наблюдателя
        if (buttonObserver) {
            buttonObserver.disconnect();
            buttonObserver = null;
        }
        
        // Ищем кнопку управления
        const button = document.querySelector('.yt-spec-button-shape-next.yt-spec-button-shape-next--tonal.yt-spec-button-shape-next--overlay-dark.yt-spec-button-shape-next--size-l.yt-spec-button-shape-next--icon-button.yt-spec-button-shape-next--enable-drop-shadow-experiment');
        
        if (!button) {
            console.log('🔍 Кнопка управления не найдена, пробую через 500мс');
            setTimeout(setupButtonObserver, 500);
            return;
        }
        
        console.log('✅ Найдена кнопка управления, title:', button.getAttribute('title'));
        
        // Создаем наблюдатель за изменениями title кнопки
        buttonObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
                    const newTitle = button.getAttribute('title') || '';
                    console.log('🔄 Изменен title кнопки:', newTitle);
                    checkVideoState();
                }
            });
        });
        
        // Начинаем наблюдение за атрибутом title
        buttonObserver.observe(button, {
            attributes: true,
            attributeFilter: ['title']
        });
        
        // Проверяем начальное состояние
        setTimeout(() => {
            checkVideoState();
        }, 300);
        
    } catch (error) {
        console.warn('⚠️ Ошибка в setupButtonObserver:', error);
        setTimeout(setupButtonObserver, 1000);
    }
}

// Проверка изменения URL
function checkUrlChange() {
    try {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            console.log('🌐 URL изменился:', currentUrl);
            lastUrl = currentUrl;
            
            // Проверяем лимит при каждом изменении URL
            checkLimitBeforeStart((isLimitReached) => {
                if (isLimitReached && checkIfOnShortsPage() && redirectUrl) {
                    // Лимит достигнут и мы на шортсах - делаем редирект
                    if (!window.location.href.includes(redirectUrl)) {
                        window.location.href = redirectUrl;
                    }
                } else {
                    // Проверяем состояние видео
                    setTimeout(() => {
                        checkVideoState();
                        // Переинициализируем наблюдатель для нового шортса
                        if (currentUrl.includes('/shorts/')) {
                            setTimeout(setupButtonObserver, 500);
                        }
                    }, 300);
                }
            });
        }
    } catch (e) {
        // Игнорируем ошибки
    }
}

// Инициализация
function init() {
    console.log('🚀 YouTube Shorts Limiter запущен');
    console.log('📍 Текущий URL:', window.location.href);
    
    // Начинаем с проверки лимита
    checkLimitBeforeStart((isLimitReached) => {
        if (isLimitReached && checkIfOnShortsPage() && redirectUrl) {
            // Немедленный редирект если лимит достигнут
            if (!window.location.href.includes(redirectUrl)) {
                window.location.href = redirectUrl;
                return;
            }
        }
        
        // Инициализируем наблюдение за кнопкой
        setupButtonObserver();
        
        // Проверяем изменение URL каждую секунду
        const urlCheckInterval = setInterval(checkUrlChange, 1000);
        
        // Проверяем состояние видео каждые 2 секунды
        const stateCheckInterval = setInterval(checkVideoState, 2000);
        
        // Останавливаем при скрытии страницы
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('👁️ Страница скрыта, останавливаем отслеживание');
                if (isTracking) {
                    stopTracking();
                }
            } else {
                console.log('👁️ Страница видима, проверяем состояние');
                setTimeout(checkVideoState, 500);
            }
        });
        
        // Останавливаем при потере фокуса окна
        window.addEventListener('blur', () => {
            console.log('🔇 Окно потеряло фокус, останавливаем отслеживание');
            if (isTracking) {
                stopTracking();
            }
        });
        
        window.addEventListener('focus', () => {
            console.log('🔊 Окно получило фокус, проверяем состояние');
            setTimeout(checkVideoState, 500);
        });
        
        // Останавливаем при закрытии вкладки
        window.addEventListener('beforeunload', () => {
            if (isTracking) {
                stopTracking();
            }
            clearInterval(urlCheckInterval);
            clearInterval(stateCheckInterval);
        });
        
        // Отслеживаем изменения истории
        window.addEventListener('popstate', () => {
            setTimeout(() => {
                checkUrlChange();
            }, 200);
        });
        
        // Перехватываем pushState/replaceState для SPA-навигации
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            originalPushState.apply(history, args);
            setTimeout(() => {
                checkUrlChange();
            }, 200);
        };
        
        history.replaceState = function(...args) {
            originalReplaceState.apply(history, args);
            setTimeout(() => {
                checkUrlChange();
            }, 200);
        };
    });
}

// Обработчик сообщений от background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Получено сообщение:', message.type);
    
    switch (message.type) {
        case 'PAUSE_TRACKING':
            console.log('⏸️ Получен сигнал паузы');
            if (isTracking) {
                stopTracking();
            }
            sendResponse({ success: true });
            break;
            
        case 'CHECK_STATE':
            console.log('🔍 Проверка состояния по запросу');
            checkVideoState();
            sendResponse({ success: true });
            break;
            
        case 'REINITIALIZE':
            console.log('🔄 Переинициализация по запросу');
            setTimeout(init, 100);
            sendResponse({ success: true });
            break;
            
        case 'LIMIT_REACHED':
            console.log('🚫 Получено уведомление о достижении лимита');
            limitReached = true;
            redirectUrl = message.redirectUrl;
            
            if (checkIfOnShortsPage() && redirectUrl) {
                if (!window.location.href.includes(redirectUrl)) {
                    window.location.href = redirectUrl;
                }
            }
            sendResponse({ success: true });
            break;
    }
    
    return true;
});

// Запускаем при загрузке страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
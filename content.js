let isTracking = false;
let startTime = null;
let intervalId = null;
let currentTabId = null;
let lastUrl = window.location.href;
let limitReached = false;
let redirectUrl = null;
let lastProgressValue = -1;
let lastProgressUpdate = Date.now();
let progressStuckTimer = null;
let windowHasFocus = true; 
let popupOpen = false;

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

// Проверяем, играет ли видео по прогресс-бару
function isVideoPlaying() {
    // Находим элемент прогресс-бара
    const progressBar = document.querySelector('div[role="slider"].ytPlayerProgressBarDragContainer');
    
    if (!progressBar) {
        return false;
    }
    
    // Получаем текущее значение прогресса
    const currentValue = parseInt(progressBar.getAttribute('aria-valuenow') || '0');
    const now = Date.now();
    
    // Если значение изменилось с момента последней проверки
    if (currentValue !== lastProgressValue) {
        lastProgressValue = currentValue;
        lastProgressUpdate = now;
        
        // Сбрасываем таймер "застрявшего" прогресса
        clearTimeout(progressStuckTimer);
        
        // Видео явно играет, если значение прогресса меняется
        return true;
    }
    
    // Если значение не менялось какое-то время
    const timeSinceLastUpdate = now - lastProgressUpdate;
    
    // Видео считается играющим, если последнее обновление было меньше 1.5 секунд назад
    // НЕ ЗАВИСИМО от windowHasFocus или popupOpen
    if (timeSinceLastUpdate < 1500) {
        return true;
    }
    
    return false;
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
    
    // Очищаем таймер застрявшего прогресса
    clearTimeout(progressStuckTimer);
    progressStuckTimer = null;
    
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

// Функция для проверки "застрял" ли прогресс
function checkProgressStuck() {
    if (!isTracking || !checkIfOnShortsPage()) return;
    
    const now = Date.now();
    const timeSinceLastUpdate = now - lastProgressUpdate;
    
    // Если прогресс не обновлялся более 1.5 секунд - видео на паузе
    if (timeSinceLastUpdate > 1500) {
        console.log('⏸️ Прогресс не обновляется', timeSinceLastUpdate, 'мс - видео на паузе');
        stopTracking();
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
    
    console.log('🔍 Проверка состояния:', {
        videoPlaying: videoPlaying,
        isTracking: isTracking,
        windowHasFocus: windowHasFocus,
        popupOpen: popupOpen
    });

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
    
    // Если видео играет, устанавливаем таймер для проверки "застрявшего" прогресса
    if (videoPlaying && isTracking) {
        clearTimeout(progressStuckTimer);
        progressStuckTimer = setTimeout(checkProgressStuck, 1600);
    }
}

// Создаем наблюдатель за прогресс-баром
let progressObserver = null;

function setupProgressObserver() {
    try {
        // Очищаем предыдущего наблюдателя
        if (progressObserver) {
            progressObserver.disconnect();
            progressObserver = null;
        }
        
        // Ищем прогресс-бар
        const progressBar = document.querySelector('div[role="slider"].ytPlayerProgressBarDragContainer');
        
        if (!progressBar) {
            console.log('🔍 Прогресс-бар не найден, пробую через 500мс');
            setTimeout(setupProgressObserver, 500);
            return;
        }
        
        // Получаем начальное значение
        const initialValue = parseInt(progressBar.getAttribute('aria-valuenow') || '0');
        lastProgressValue = initialValue;
        lastProgressUpdate = Date.now();
        
        console.log('✅ Найден прогресс-бар, начальное значение:', initialValue, '%');
        
        // Создаем наблюдатель за изменениями aria-valuenow
        progressObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'aria-valuenow') {
                    const newValue = parseInt(mutation.target.getAttribute('aria-valuenow') || '0');
                    checkVideoState();
                }
            });
        });
        
        // Начинаем наблюдение за атрибутом aria-valuenow
        progressObserver.observe(progressBar, {
            attributes: true,
            attributeFilter: ['aria-valuenow']
        });
        
        // Проверяем начальное состояние
        setTimeout(() => {
            checkVideoState();
        }, 300);
        
    } catch (error) {
        console.warn('⚠️ Ошибка в setupProgressObserver:', error);
        setTimeout(setupProgressObserver, 1000);
    }
}

// Проверка изменения URL
function checkUrlChange() {
    try {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            console.log('🌐 URL изменился:', currentUrl);
            lastUrl = currentUrl;
            
            // Сбрасываем значения прогресса при смене URL
            lastProgressValue = -1;
            lastProgressUpdate = Date.now();
            clearTimeout(progressStuckTimer);
            progressStuckTimer = null;
            
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
                            setTimeout(setupProgressObserver, 500);
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
        
        // Инициализируем наблюдение за прогресс-баром
        setupProgressObserver();
        
        // Проверяем изменение URL каждую секунду
        const urlCheckInterval = setInterval(checkUrlChange, 1000);
        
        // Проверяем состояние видео каждые 1 секунды
        const stateCheckInterval = setInterval(checkVideoState, 1000);
        
        // Останавливаем при скрытии страницы
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('👁️ Страница скрыта (не видна), останавливаем отслеживание');
                // Страница полностью скрыта (например, переключились на другую вкладку)
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
            console.log('🔇 Окно потеряло фокус, popup открыт?', popupOpen);
            windowHasFocus = false;
            
            // Если открыт popup - НЕ останавливаем отслеживание
            if (!popupOpen && isTracking) {
                console.log('⏸️ Окно потеряло фокус (не popup), останавливаем отслеживание');
                stopTracking();
            }
            // Если открыт popup - просто обновляем переменную, но продолжаем
        });

        window.addEventListener('focus', () => {
            console.log('🔊 Окно получило фокус');
            windowHasFocus = true;
            // При получении фокуса проверяем состояние видео
            setTimeout(checkVideoState, 500);
        });
        
        // Также проверяем состояние окна при загрузке
        windowHasFocus = document.hasFocus();
        console.log('🎯 Начальное состояние фокуса окна:', windowHasFocus ? 'в фокусе' : 'не в фокусе');
        
        // Останавливаем при закрытии вкладки
        window.addEventListener('beforeunload', () => {
            if (isTracking) {
                stopTracking();
            }
            clearInterval(urlCheckInterval);
            clearInterval(stateCheckInterval);
            clearTimeout(progressStuckTimer);
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

        case 'POPUP_STATUS':
            console.log('📊 Получен статус popup:', message.isOpen ? 'открыт' : 'закрыт');
            popupOpen = message.isOpen;
            
            // Если popup открыт, но окно потеряло фокус - продолжаем отслеживание
            if (popupOpen && !windowHasFocus) {
                console.log('📊 Popup открыт, продолжаем отслеживание');
                // Видео продолжает играть, просто фокус на popup
                if (isTracking) {
                    // Не делаем ничего - продолжаем отслеживание
                }
            } else if (!popupOpen && !windowHasFocus) {
                // Popup закрыт и окно не в фокусе - возможно видео на паузе
                checkVideoState();
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
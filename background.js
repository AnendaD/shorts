function logRedirect(tabId, reason, fromFunction) {
    const entry = {
        time: new Date().toISOString(),
        tabId: tabId,
        reason: reason,
        from: fromFunction,
        stack: new Error().stack
    };
    redirectLog.push(entry);
    console.log('📝 Лог редиректа:', entry);
}
// Хранилище активной сессии
let activeSession = null;
let activeTabId = null;

// Отслеживание открытия popup
let popupOpen = false;
let popupWindowId = null;

// Инициализация
chrome.runtime.onInstalled.addListener(() => {
    console.log('🔧 Расширение установлено/обновлено');
    
    chrome.storage.local.get(['userSettings', 'stats'], (result) => {
        if (!result.userSettings) {
            chrome.storage.local.set({
                userSettings: {
                    dailyLimit: 30 * 60,
                    redirectVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                }
            });
            console.log('🆕 Созданы настройки по умолчанию');
        }
        
        if (!result.stats) {
            resetDailyStats();
        } else {
            checkAndResetDailyStats();
        }
        
        chrome.alarms.create('dailyReset', { periodInMinutes: 24 * 60 });
        console.log('⏰ Установлен ежедневный сброс');
    });
});

// Обработчик сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Получено сообщение:', message.type, 'от вкладки', sender.tab?.id);
    
    switch (message.type) {
        case 'GET_TAB_ID':
            sendResponse({ tabId: sender.tab.id });
            break;
            
        case 'SHORTS_START':
            handleShortsStart(message, sender.tab.id);
            sendResponse({ success: true });
            break;
            
        case 'SHORTS_HEARTBEAT':
            handleShortsHeartbeat(message, sender.tab.id, sendResponse);
            return true;
            
        case 'SHORTS_END':
            handleShortsEnd(message, sender.tab.id);
            sendResponse({ success: true });
            break;
            
        case 'GET_CURRENT_STATS':
            chrome.storage.local.get(['stats', 'userSettings'], (result) => {
                sendResponse({
                    stats: result.stats || { dailyTime: 0 },
                    settings: result.userSettings || { dailyLimit: 30 * 60 }
                });
            });
            return true;

        case 'MANUAL_RESET':
            activeSession = null;
            activeTabId = null;
            console.log('Ручной сброс статистики');
            sendResponse({ success: true });
            break;
            
        case 'CHECK_LIMIT':
            checkLimitAndRespond(sender.tab.id, sendResponse);
            return true;
            
        // Обработка сообщений от popup
        case 'POPUP_OPENED':
            popupOpen = true;
            popupWindowId = sender.windowId;
            console.log('📊 Popup открыт, ID окна:', popupWindowId);
            
            // ОТПРАВЛЯЕМ ВСЕМ ВКЛАДКАМ YOUTUBE
            chrome.tabs.query({url: "*://*.youtube.com/*"}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'POPUP_STATUS',
                        isOpen: true
                    }).catch(() => {});
                });
            });
            
            sendResponse({ success: true });
            break;
            
        case 'POPUP_CLOSED':
            popupOpen = false;
            popupWindowId = null;
            console.log('📊 Popup закрыт');

            // ОТПРАВЛЯЕМ ВСЕМ ВКЛАДКАМ YOUTUBE
            chrome.tabs.query({url: "*://*.youtube.com/*"}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'POPUP_STATUS',
                        isOpen: false
                    }).catch(() => {});
                });
            });

            sendResponse({ success: true });
            break;
            
        case 'IS_POPUP_OPEN':
            sendResponse({ popupOpen: popupOpen });
            return true;

        case 'AUTH_STATUS_CHANGED':
        // Обновляем статус авторизации
        chrome.tabs.query({url: "*://*.youtube.com/*"}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'AUTH_STATUS_CHANGED'
                }).catch(() => {});
            });
        });
        break;
    }
    
    return true;
});

function handleShortsStart(message, tabId) {
    // Проверяем лимит
    chrome.storage.local.get(['stats', 'userSettings'], (result) => {
        const stats = result.stats || { dailyTime: 0 };
        const settings = result.userSettings || { dailyLimit: 30 * 60 };
        
        if (stats.dailyTime >= settings.dailyLimit) {
            console.log('🚫 Лимит уже исчерпан при старте!');
            handleLimitExceeded(settings.redirectVideoUrl, tabId);
            return;
        }
        
        // Останавливаем предыдущую сессию если была
        if (activeSession && activeTabId !== tabId) {
            console.log('⏹️ Останавливаем сессию на вкладке', activeTabId);
            const oldTime = activeSession.lastSavedTime || 0;
            if (oldTime > 0) {
                // Не сохраняем, т.к. уже сохранено через heartbeat
            }
            activeSession = null;
        }
        
        // Создаем новую сессию
        activeSession = {
            startTime: message.timestamp,
            lastUpdate: Date.now(),
            url: message.url,
            timeSpent: 0,
            lastSavedTime: 0
        };
        activeTabId = tabId;
        
        console.log('🟢 Начата сессия для вкладки', tabId, {
            startTime: new Date(message.timestamp).toLocaleTimeString(),
            url: message.url
        });
    });
}

function handleShortsHeartbeat(message, tabId, sendResponse) {
    // Проверяем, что это активная вкладка
    if (activeTabId !== tabId) {
        console.log('⚠️ Heartbeat от неактивной вкладки', tabId, 'игнорируем');
        sendResponse({ shouldRedirect: false });
        return;
    }
    
    const session = activeSession;
    
    chrome.storage.local.get(['stats', 'userSettings'], (result) => {
        const stats = result.stats || { dailyTime: 0 };
        const settings = result.userSettings || { dailyLimit: 30 * 60 };
        
        if (stats.dailyTime >= settings.dailyLimit) {
            console.log('🚫 Лимит достигнут, редирект...');
            handleLimitExceeded(settings.redirectVideoUrl, tabId);
            sendResponse({ shouldRedirect: true, redirectUrl: settings.redirectVideoUrl });
            return;
        }
        
        if (session) {
            const now = Date.now();
            const currentTimeSpent = message.timeSpent || Math.floor((now - session.startTime) / 1000);
            const lastSavedTime = session.lastSavedTime || 0;
            
            const timeIncrement = currentTimeSpent - lastSavedTime;
            
            session.lastUpdate = now;
            session.timeSpent = currentTimeSpent;
            
            if (timeIncrement >= 1) {
                const newDailyTime = stats.dailyTime + timeIncrement;
                
                if (newDailyTime >= settings.dailyLimit) {
                    const remainingTime = settings.dailyLimit - stats.dailyTime;
                    if (remainingTime > 0) {
                        updateStats(remainingTime);
                    }
                    
                    console.log('🚨 Лимит достигнут после обновления!');
                    handleLimitExceeded(settings.redirectVideoUrl, tabId);
                    sendResponse({ shouldRedirect: true, redirectUrl: settings.redirectVideoUrl });
                    return;
                } else {
                    updateStats(timeIncrement);
                    session.lastSavedTime = currentTimeSpent;
                }
            }
            
            sendResponse({ shouldRedirect: false });
        } else {
            console.warn('⚠️ Heartbeat получен для несуществующей сессии:', tabId);
            sendResponse({ shouldRedirect: false });
        }
    });
}

function handleShortsEnd(message, tabId) {
    // Только если это активная вкладка
    if (activeTabId !== tabId) {
        console.log('⚠️ End от неактивной вкладки', tabId, 'игнорируем');
        return;
    }
    
    const session = activeSession;
    if (session) {
        const totalTimeSpent = message.timeSpent || 
                              Math.floor((Date.now() - session.startTime) / 1000);
        const lastSavedTime = session.lastSavedTime || 0;
        
        const remainingTime = totalTimeSpent - lastSavedTime;
        
        if (remainingTime > 0) {
            chrome.storage.local.get(['stats', 'userSettings'], (result) => {
                const stats = result.stats || { dailyTime: 0 };
                const settings = result.userSettings || { dailyLimit: 30 * 60 };
                
                const newDailyTime = stats.dailyTime + remainingTime;
                
                if (newDailyTime > settings.dailyLimit) {
                    const timeToSave = settings.dailyLimit - stats.dailyTime;
                    if (timeToSave > 0) {
                        updateStats(timeToSave);
                    }
                } else {
                    updateStats(remainingTime);
                }
                
                console.log('🔴 Завершена сессия для вкладки', tabId);
            });
        }
        
        activeSession = null;
        activeTabId = null;
    }
}

function updateStats(timeSpent) {
    if (!timeSpent || timeSpent <= 0) return;
    
    chrome.storage.local.get(['stats', 'userSettings'], (result) => {
        const stats = result.stats || { dailyTime: 0, history: [], lastResetDate: '' };
        const settings = result.userSettings || { dailyLimit: 30 * 60 };
        
        let newDailyTime = (stats.dailyTime || 0) + timeSpent;
        
        if (newDailyTime > settings.dailyLimit) {
            newDailyTime = settings.dailyLimit;
        }
        
        const updatedStats = {
            ...stats,
            dailyTime: newDailyTime,
            lastUpdated: Date.now()
        };
        
        chrome.storage.local.set({ stats: updatedStats }, () => {
            console.log('📊 Обновлена статистика:', newDailyTime, 'секунд');
            
            chrome.runtime.sendMessage({
                type: 'STATS_UPDATED',
                dailyTime: newDailyTime
            }).catch(() => {});
        });
    });
}

function handleLimitExceeded(redirectUrl, tabId) {
    console.log('🚫 Лимит исчерпан, перенаправляем вкладку', tabId);
    
    // Редиректим только указанную вкладку
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
            console.log('Вкладка уже закрыта');
            return;
        }
        
        if (tab.url.includes('/shorts/')) {
            const finalUrl = redirectUrl || "https://www.youtube.com";
            chrome.tabs.update(tabId, { url: finalUrl });
            
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-48.png',
                title: 'Лимит Shorts исчерпан!',
                message: 'Вы достигли дневного лимита. Перенаправляем на выбранное видео.'
            });
        }
    });
}

function checkLimitAndRespond(tabId, sendResponse) {
    chrome.storage.local.get(['stats', 'userSettings'], (result) => {
        const stats = result.stats || { dailyTime: 0 };
        const settings = result.userSettings || { dailyLimit: 30 * 60 };
        
        const limitReached = stats.dailyTime >= settings.dailyLimit;
        
        sendResponse({ 
            limitReached: limitReached,
            redirectUrl: limitReached ? settings.redirectVideoUrl : null
        });
    });
}

function resetDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    chrome.storage.local.set({
        stats: {
            dailyTime: 0,
            lastResetDate: today,
            history: [],
            lastUpdated: Date.now()
        }
    });
    console.log('🔄 Статистика сброшена на', today);
}

function checkAndResetDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    
    chrome.storage.local.get(['stats'], (result) => {
        const stats = result.stats || {};
        
        if (stats.lastResetDate !== today) {
            console.log('📅 Обнаружен новый день, сбрасываем статистику');
            
            const history = stats.history || [];
            if (stats.dailyTime > 0) {
                history.push({
                    date: stats.lastResetDate,
                    timeSpent: stats.dailyTime
                });
                
                if (history.length > 30) history.shift();
            }
            
            chrome.storage.local.set({
                stats: {
                    dailyTime: 0,
                    lastResetDate: today,
                    history: history,
                    lastUpdated: Date.now()
                }
            }, () => {
                chrome.runtime.sendMessage({
                    type: 'DAILY_RESET'
                }).catch(() => {});
            });
        }
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dailyReset') {
        console.log('⏰ Сработал ежедневный сброс');
        checkAndResetDailyStats();
    }
});

// Отслеживание закрытия вкладки
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeTabId === tabId && activeSession) {
        const timeSpent = Math.floor((Date.now() - activeSession.startTime) / 1000);
        const remaining = timeSpent - (activeSession.lastSavedTime || 0);
        
        if (remaining > 0) {
            updateStats(remaining);
        }
        
        activeSession = null;
        activeTabId = null;
        console.log('🗑️ Активная вкладка закрыта, сессия удалена:', tabId);
    }
});

// Отслеживание смены активной вкладки
chrome.tabs.onActivated.addListener((activeInfo) => {
    
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab.url) return;
        
        // Если это popup расширения - НЕ останавливаем отслеживание
        if (tab.url.startsWith('chrome-extension://') && (tab.url.includes('/popup.html') || tab.url.includes('/popup'))) {
            console.log('📊 Активирован popup, НЕ останавливаем отслеживание');
            return;
        }
        
        // Если была активная сессия на другой вкладке - останавливаем ТОЛЬКО если popup не открыт
        if (activeSession && activeTabId && activeTabId !== activeInfo.tabId && !popupOpen) {
            console.log('⏸️ Пауза сессии на вкладке', activeTabId, '(смена вкладки)');
            chrome.tabs.sendMessage(activeTabId, { type: 'PAUSE_TRACKING' }).catch(() => {});
        }
        
        // Уведомляем новую активную вкладку
        if (tab.url.includes('youtube.com')) {
            console.log('📺 Активирован YouTube:', tab.url);
            
            // ИСПРАВЛЕНО: Добавляем повторные попытки отправки
            const sendCheckState = (attempt = 0) => {
                chrome.tabs.sendMessage(activeInfo.tabId, { type: 'CHECK_STATE' })
                    .then(() => {
                        console.log('✅ CHECK_STATE отправлен успешно');
                    })
                    .catch((error) => {
                        console.warn(`⚠️ Ошибка отправки CHECK_STATE (попытка ${attempt + 1}):`, error.message);
                        
                        // Пробуем снова через 500ms, максимум 3 попытки
                        if (attempt < 2) {
                            setTimeout(() => sendCheckState(attempt + 1), 500);
                        } else {
                            // Если content script не отвечает, возможно он не загружен
                            // Пытаемся загрузить его программно
                            console.log('🔄 Content script не отвечает, пытаемся загрузить...');
                            chrome.scripting.executeScript({
                                target: { tabId: activeInfo.tabId },
                                files: ['content.js']
                            }).then(() => {
                                console.log('✅ Content script загружен');
                                // Даем время на инициализацию
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(activeInfo.tabId, { type: 'CHECK_STATE' })
                                        .catch(() => {});
                                }, 1000);
                            }).catch((err) => {
                                console.error('❌ Ошибка загрузки content script:', err);
                            });
                        }
                    });
            };
            
            sendCheckState();
        }
    });
});

// Отслеживание изменений окна (сворачивание/разворачивание)
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        console.log('🪟 Окно Chrome свернуто или потеряло фокус');
        
        // Окно потеряло фокус - останавливаем активную сессию
        // НО проверяем, не переключились ли мы на другой приложение или действительно свернули
        if (activeSession && activeTabId && !popupOpen) {
            // Даем небольшую задержку, чтобы понять ситуацию
            setTimeout(() => {
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                    if (!tabs[0] || !tabs[0].url) return;
                    
                    const currentTab = tabs[0];
                    const isPopup = currentTab.url && 
                                   currentTab.url.startsWith('chrome-extension://') && 
                                   (currentTab.url.includes('/popup.html') || currentTab.url.includes('popup'));
                    
                    if (isPopup) {
                        console.log('📊 Активирован popup в отдельном окне, НЕ останавливаем отслеживание');
                        // Не делаем ничего - пользователь открыл popup
                    } else if (!currentTab.url.includes('youtube.com')) {
                        console.log('🔀 Переключились на другую вкладку/приложение, пауза');
                        chrome.tabs.sendMessage(activeTabId, { type: 'PAUSE_TRACKING' }).catch(() => {});
                    }
                    // Если переключились на YouTube вкладку - ничего не делаем
                });
            }, 100); // Небольшая задержка для стабилизации
        }
    } else {
        console.log('🪟 Окно Chrome получило фокус, ID:', windowId);
        
        // Проверяем, не popup ли это
        chrome.windows.get(windowId, { populate: true }, (window) => {
            if (chrome.runtime.lastError) return;
            
            const isPopupWindow = window.tabs?.some(tab => 
                tab.url?.startsWith('chrome-extension://') && 
                (tab.url.includes('/popup.html') || tab.url.includes('popup'))
            );
            
            if (isPopupWindow) {
                console.log('📊 Окно с popup получило фокус, игнорируем');
                return;
            }
            
            // Небольшая задержка перед проверкой
            setTimeout(() => {
                chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
                    if (!tabs[0] || !tabs[0].url) return;
                    
                    const currentTab = tabs[0];
                    if (currentTab.url.includes('youtube.com')) {
                        console.log('📺 Окно с YouTube получило фокус, проверяем состояние');
                        chrome.tabs.sendMessage(currentTab.id, { type: 'CHECK_STATE' }).catch(() => {});
                    }
                });
            }, 50);
        });
    }
});
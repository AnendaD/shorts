document.addEventListener('DOMContentLoaded', () => {
    console.log('Popup loaded');
    
    // Сообщаем background скрипту, что popup открыт
    chrome.runtime.sendMessage({ 
        type: 'POPUP_OPENED',
        windowId: chrome.windows.WINDOW_ID_CURRENT
    }).catch(() => {});
    
    // Инициализируем прогресс-бар с нулевым значением сразу
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.style.display = 'block';
        progressBar.style.height = '100%';
    }
    
    // Инициализация
    initializePopup();
    
    // Слушаем сообщения из фонового скрипта
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Message received in popup:', message.type);
        
        switch (message.type) {
            case 'STATS_UPDATED':
                updateStatsFromMessage(message);
                break;
                
            case 'DAILY_RESET':
                updateStats(true); // Принудительное обновление
                showNotification('🎉 Новый день! Счетчик сброшен.');
                break;
        }
        return true;
    });
    
    // Кнопки
    document.getElementById('settingsBtn').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
    
    document.getElementById('resetToday').addEventListener('click', () => {
        if (confirm('Сбросить статистику за сегодня?')) {
            chrome.storage.local.get(['stats'], (result) => {
                const stats = result.stats || {};
                stats.dailyTime = 0;
                stats.lastUpdated = Date.now();
                
                chrome.storage.local.set({ stats }, () => {
                    updateStats(true); // Принудительное обновление
                    showNotification('Статистика сброшена!');
                    
                    // Отправляем сообщение фоновому скрипту
                    chrome.runtime.sendMessage({
                        type: 'MANUAL_RESET'
                    });
                });
            });
        }
    });
    
    // Запрашиваем обновление у фонового скрипта
    requestStatsUpdate();
});

let updateInterval = null;
let currentStats = {
    dailyTime: 0,
    dailyLimit: 30 * 60
};
let isInitialized = false;

function initializePopup() {
    // Добавляем иконку в заголовок
    const title = document.querySelector('h1');
    if (title && !title.textContent.includes('⏱️')) {
        title.textContent = '⏱️ ' + title.textContent;
    }
    
    // Запрашиваем начальные данные - всегда принудительное обновление при инициализации
    updateStats(true);
    
    // ИСПРАВЛЕНО: Запускаем периодическое обновление каждую секунду
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        updateStats(true);
    }, 1000); // Изменено с 1500 на 1000
    
    // Обновляем при возвращении на вкладку
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateStats(true);
        }
    });
    
    // Обновляем при фокусе окна
    window.addEventListener('focus', () => {
        updateStats(true);
    });
}

function updateStats(forceUpdate = false) {
    chrome.storage.local.get(['stats', 'userSettings'], (result) => {
        if (chrome.runtime.lastError) {
            console.error('Storage error:', chrome.runtime.lastError);
            return;
        }
        
        const stats = result.stats || { dailyTime: 0, lastUpdated: Date.now() };
        const settings = result.userSettings || { dailyLimit: 30 * 60 };
        
        // Сохраняем текущие значения для сравнения
        const oldTime = currentStats.dailyTime;
        const oldLimit = currentStats.dailyLimit;
        currentStats.dailyTime = stats.dailyTime || 0;
        currentStats.dailyLimit = settings.dailyLimit || 30 * 60;
        
        // Обновляем если данные изменились, лимит изменился, принудительное обновление или первая инициализация
        if (forceUpdate || oldTime !== currentStats.dailyTime || oldLimit !== currentStats.dailyLimit || !isInitialized) {
            console.log('Updating UI:', {
                dailyTime: currentStats.dailyTime,
                dailyLimit: currentStats.dailyLimit,
                forceUpdate: forceUpdate
            });
            updateUI(stats, settings);
            isInitialized = true;
        }
    });
}

function updateStatsFromMessage(message) {
    if (message.dailyTime !== undefined) {
        currentStats.dailyTime = message.dailyTime;
        updateUI({
            dailyTime: message.dailyTime,
            lastUpdated: Date.now()
        }, {
            dailyLimit: currentStats.dailyLimit
        });
    }
}

function updateLiveTime(timeSpent) {
    requestStatsUpdate();
}

function updateUI(stats, settings) {
    const totalSeconds = stats.dailyTime || 0;
    const dailyLimit = settings.dailyLimit || 30 * 60;
    
    console.log('updateUI called:', { totalSeconds, dailyLimit });
    
    const activeIndicator = document.getElementById('activeIndicator');
    if (activeIndicator) {
        const timeSinceUpdate = Date.now() - (stats.lastUpdated || 0);
        activeIndicator.style.display = timeSinceUpdate < 10000 ? 'inline-block' : 'none';
        activeIndicator.style.background = timeSinceUpdate < 5000 ? '#4CAF50' : 
                                         timeSinceUpdate < 10000 ? '#FFA500' : '#FF4757';
    }
    // Форматируем время
    updateTimeDisplay(totalSeconds);
    
    // Обновляем прогресс бар - ВСЕГДА, даже если значение 0
    updateProgressBar(totalSeconds, dailyLimit);
    
    // Обновляем график
    updateChart(stats.history || []);
    
    // Показываем предупреждение
    showWarningIfNeeded(totalSeconds, dailyLimit);
}

function updateTimeDisplay(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    let timeText = '';
    if (hours > 0) {
        timeText = `${hours}ч ${minutes}м`;
    } else if (minutes > 0) {
        timeText = `${minutes}м ${seconds}с`;
    } else {
        timeText = `${seconds}с`;
    }
    
    const timeElement = document.getElementById('todayTime');
    if (timeElement) {
        const oldText = timeElement.textContent;
        timeElement.textContent = timeText;
        
        // Анимация обновления только если значение изменилось
        if (oldText !== timeText) {
            timeElement.style.transform = 'scale(1.1)';
            setTimeout(() => {
                timeElement.style.transform = 'scale(1)';
            }, 200);
        }
    }
}

function updateProgressBar(totalSeconds, dailyLimit) {
    const progressBar = document.getElementById('progressBar');
    if (!progressBar) {
        console.error('Progress bar element not found!');
        return;
    }
    
    // Защита от деления на ноль
    if (!dailyLimit || dailyLimit <= 0) {
        dailyLimit = 30 * 60; // Значение по умолчанию
    }
    
    const percentage = Math.min((totalSeconds / dailyLimit) * 100, 100);
    
    console.log('Updating progress bar:', {
        totalSeconds: totalSeconds,
        dailyLimit: dailyLimit,
        percentage: percentage.toFixed(2) + '%'
    });
    
    // Убеждаемся, что прогресс бар виден и правильно настроен
    progressBar.style.cssText = `
        display: block !important;
        height: 100% !important;
        min-width: ${percentage > 0 ? '2px' : '0px'} !important;
        max-width: 100% !important;
        width: ${percentage}% !important;
        transition: width 0.3s ease, background-color 0.3s ease !important;
        border-radius: 6px !important;
        box-sizing: border-box !important;
    `;
    
    // Изменяем цвет в зависимости от процента
    if (percentage >= 90) {
        progressBar.style.background = 'linear-gradient(90deg, #FF0000, #FF6347)';
        progressBar.classList.add('danger');
        progressBar.classList.remove('warning');
    } else if (percentage >= 70) {
        progressBar.style.background = 'linear-gradient(90deg, #FFA500, #FF6347)';
        progressBar.classList.add('warning');
        progressBar.classList.remove('danger');
    } else {
        progressBar.style.background = 'linear-gradient(90deg, #4CAF50, #8BC34A)';
        progressBar.classList.remove('warning', 'danger');
    }
    
    // Обновляем текст лимита
    const limitElement = document.getElementById('dailyLimit');
    if (limitElement) {
        const limitMinutes = Math.floor(dailyLimit / 60);
        limitElement.textContent = limitMinutes;
        
        // Подсвечиваем если лимит почти достигнут
        if (percentage > 80) {
            limitElement.style.color = '#FF4757';
            limitElement.style.fontWeight = 'bold';
        } else {
            limitElement.style.color = '#666';
            limitElement.style.fontWeight = 'normal';
        }
    }
}

function updateChart(history) {
    const chart = document.getElementById('chart');
    if (!chart) return;
    
    // Безопасная очистка содержимого
    while (chart.firstChild) {
        chart.removeChild(chart.firstChild);
    }
    
    // Берем последние 7 дней
    const last7Days = history.slice(-7);
    
    if (last7Days.length === 0) {
        const noDataDiv = document.createElement('div');
        noDataDiv.className = 'no-data';
        noDataDiv.style.cssText = 'text-align: center; color: #666; padding: 20px;';
        noDataDiv.textContent = 'Нет данных за последние 7 дней';
        chart.appendChild(noDataDiv);
        return;
    }
    
    // Находим максимальное значение для масштабирования
    const maxTime = Math.max(...last7Days.map(h => h.timeSpent), 1);
    
    // Создаем бары для каждого дня
    last7Days.forEach((day, index) => {
        const barContainer = document.createElement('div');
        barContainer.className = 'chart-bar-container';
        barContainer.style.display = 'flex';
        barContainer.style.flexDirection = 'column';
        barContainer.style.alignItems = 'center';
        barContainer.style.width = '40px';
        
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.style.width = '20px';
        bar.style.minHeight = '5px';
        bar.style.background = index === last7Days.length - 1 ? 
            'linear-gradient(to top, #667eea, #764ba2)' : 
            'linear-gradient(to top, #a78bfa, #8b5cf6)';
        bar.style.borderRadius = '10px 10px 0 0';
        bar.style.transition = 'height 0.5s ease';
        bar.style.marginBottom = '5px';
        
        const height = (day.timeSpent / maxTime) * 120;
        bar.style.height = `${height}px`;
        
        // Подсказка при наведении
        const minutes = Math.floor(day.timeSpent / 60);
        const seconds = day.timeSpent % 60;
        bar.title = `${minutes}м ${seconds}с`;
        
        const label = document.createElement('div');
        label.className = 'chart-label';
        label.style.fontSize = '0.8em';
        label.style.color = '#666';
        label.style.fontWeight = '500';
        
        // Форматируем дату
        const date = new Date(day.date);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        let labelText;
        if (date.toDateString() === today.toDateString()) {
            labelText = 'Сегодня';
        } else if (date.toDateString() === yesterday.toDateString()) {
            labelText = 'Вчера';
        } else {
            const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
            labelText = dayNames[date.getDay()];
        }
        
        label.textContent = labelText;
        
        barContainer.appendChild(bar);
        barContainer.appendChild(label);
        chart.appendChild(barContainer);
    });
}

function showWarningIfNeeded(totalSeconds, dailyLimit) {
    const percentage = (totalSeconds / dailyLimit) * 100;
    
    // Показываем предупреждение только один раз за сессию для каждого уровня
    if (percentage > 90 && !window.warning90Shown) {
        showNotification('🚨 Внимание! Лимит Shorts почти исчерпан!');
        window.warning90Shown = true;
    } else if (percentage > 70 && !window.warning70Shown) {
        showNotification('⚠️ Вы использовали более 70% лимита');
        window.warning70Shown = true;
    } else if (percentage > 50 && !window.warning50Shown) {
        showNotification('📊 Вы на полпути к лимиту');
        window.warning50Shown = true;
    }
}

function requestStatsUpdate() {
    // Запрашиваем актуальные данные у фонового скрипта
    chrome.runtime.sendMessage({
        type: 'GET_CURRENT_STATS'
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error getting stats:', chrome.runtime.lastError);
            // Если ошибка, используем данные из storage напрямую
            updateStats(true);
            return;
        }
        
        if (response && response.stats) {
            // Обновляем текущие значения
            currentStats.dailyTime = response.stats.dailyTime || 0;
            currentStats.dailyLimit = response.settings?.dailyLimit || 30 * 60;
            
            updateUI(response.stats, response.settings || { dailyLimit: 30 * 60 });
        } else {
            // Если ответ пустой, используем данные из storage
            updateStats(true);
        }
    });
}

function showNotification(message) {
    // Создаем уведомление
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        animation: slideIn 0.3s ease;
        font-size: 14px;
        max-width: 250px;
        word-wrap: break-word;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Добавляем CSS анимации
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
    }
    
    .progress-bar.warning {
        animation: pulse 1s infinite;
    }
    
    .progress-bar.danger {
        animation: pulse 0.5s infinite;
    }
    
    #todayTime {
        transition: transform 0.2s ease;
    }
`;
document.head.appendChild(style);

// Чистим интервал при закрытии попапа и сообщаем об этом
window.addEventListener('pagehide', () => {
    // Сообщаем background скрипту, что popup закрыт
    chrome.runtime.sendMessage({ 
        type: 'POPUP_CLOSED' 
    }).catch(() => {});
    
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
});

// Также при видимости
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Сообщаем background скрипту, что popup скрыт (но не закрыт полностью)
        chrome.runtime.sendMessage({ 
            type: 'POPUP_CLOSED' 
        }).catch(() => {});
    } else {
        // Сообщаем background скрипту, что popup снова виден
        chrome.runtime.sendMessage({ 
            type: 'POPUP_OPENED',
            windowId: chrome.windows.WINDOW_ID_CURRENT
        }).catch(() => {});
    }
});
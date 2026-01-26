let lastUpdateTime = 0;
const UPDATE_INTERVAL_MS = 10 * 60 * 1000; // 10 минут
let lastChartUpdate = 0;
const CHART_UPDATE_INTERVAL_MS = 10 * 60 * 1000; // 10 минут для графика

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
    dailyLimit: 30 * 60,
    historyLength: 0
};
let isInitialized = false;
let cachedExtendedStats = {
    weekTime: 0,
    monthTime: 0,
    weekHistoryLength: 0,
    monthHistoryLength: 0
};

function initializePopup() {
    // Добавляем иконку в заголовок
    const title = document.querySelector('h1');
    if (title && !title.textContent.includes('⏱️')) {
        title.textContent = '⏱️ ' + title.textContent;
    }
    
    // Запрашиваем начальные данные - всегда принудительное обновление при инициализации
    updateStats(true);
    
    // Запускаем периодическое обновление каждые 10 минут
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        updateStats(true);
    }, UPDATE_INTERVAL_MS);
    
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
    // Проверяем время с последнего обновления
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTime;
    
    // Если не принудительное обновление и прошло меньше 10 минут - пропускаем
    if (!forceUpdate && timeSinceLastUpdate < UPDATE_INTERVAL_MS) {
        console.log('Skipping update, too soon:', timeSinceLastUpdate, 'ms');
        return;
    }
    
    chrome.storage.local.get(['stats', 'userSettings'], (result) => {
        if (chrome.runtime.lastError) {
            console.error('Storage error:', chrome.runtime.lastError);
            return;
        }
        
        const stats = result.stats || { dailyTime: 0, lastUpdated: Date.now(), history: [] };
        const settings = result.userSettings || { dailyLimit: 30 * 60 };
        
        // Обновляем время последнего обновления
        lastUpdateTime = now;
        
        // Сохраняем текущие значения для сравнения
        const oldTime = currentStats.dailyTime;
        const oldLimit = currentStats.dailyLimit;
        const oldHistoryLength = currentStats.historyLength || 0;
        
        currentStats.dailyTime = stats.dailyTime || 0;
        currentStats.dailyLimit = settings.dailyLimit || 30 * 60;
        currentStats.historyLength = stats.history?.length || 0;
        
        console.log('Storage data:', {
            dailyTime: stats.dailyTime,
            historyLength: stats.history?.length,
            forceUpdate: forceUpdate,
            historyChanged: oldHistoryLength !== currentStats.historyLength
        });
        
        // Обновляем если данные изменились, лимит изменился, принудительное обновление или первая инициализация
        if (forceUpdate || 
            oldTime !== currentStats.dailyTime || 
            oldLimit !== currentStats.dailyLimit || 
            oldHistoryLength !== currentStats.historyLength || 
            !isInitialized) {
            
            console.log('Updating UI (reason):', {
                timeChanged: oldTime !== currentStats.dailyTime,
                limitChanged: oldLimit !== currentStats.dailyLimit,
                historyChanged: oldHistoryLength !== currentStats.historyLength,
                forceUpdate: forceUpdate,
                notInitialized: !isInitialized
            });
            
            updateUI(stats, settings);
            isInitialized = true;
        }
    });
}

function updateStatsFromMessage(message) {
    if (message.dailyTime !== undefined) {
        currentStats.dailyTime = message.dailyTime;
        // Принудительное обновление при сообщении
        updateStats(true);
    }
}

function updateUI(stats, settings) {
    const totalSeconds = stats.dailyTime || 0;
    const dailyLimit = settings.dailyLimit || 30 * 60;
    
    console.log('updateUI called:', { 
        totalSeconds, 
        dailyLimit,
        historyLength: stats.history?.length || 0 
    });
    
    const activeIndicator = document.getElementById('activeIndicator');
    if (activeIndicator) {
        const timeSinceUpdate = Date.now() - (stats.lastUpdated || 0);
        activeIndicator.style.display = timeSinceUpdate < 10000 ? 'inline-block' : 'none';
        activeIndicator.style.background = timeSinceUpdate < 5000 ? '#4CAF50' : 
                                         timeSinceUpdate < 10000 ? '#FFA500' : '#FF4757';
    }
    
    // Форматируем время
    updateTimeDisplay(totalSeconds);
    
    // Обновляем прогресс бар
    updateProgressBar(totalSeconds, dailyLimit);
    
    // Обновляем расширенную статистику
    updateExtendedStats(stats.history || []);
    
    // Обновляем столбчатую диаграмму (с учетом интервала в 10 минут)
    const now = Date.now();
    if (now - lastChartUpdate >= CHART_UPDATE_INTERVAL_MS || !isInitialized) {
        updateChart(stats.history || [], dailyLimit);
        lastChartUpdate = now;
    }
    
    // Показываем предупреждение
    showWarningIfNeeded(totalSeconds, dailyLimit);
}

function updateExtendedStats(history) {
    // Рассчитываем время за 7 дней
    const last7Days = history.slice(-7);
    const weekSeconds = last7Days.reduce((sum, day) => sum + (day.timeSpent || 0), 0);
    
    // Рассчитываем время за 30 дней
    const last30Days = history.slice(-30);
    const monthSeconds = last30Days.reduce((sum, day) => sum + (day.timeSpent || 0), 0);
    
    // Кэшируем значения чтобы избежать мигания
    const shouldUpdate = 
        weekSeconds !== cachedExtendedStats.weekTime ||
        monthSeconds !== cachedExtendedStats.monthTime ||
        last7Days.length !== cachedExtendedStats.weekHistoryLength ||
        last30Days.length !== cachedExtendedStats.monthHistoryLength;
    
    if (shouldUpdate) {
        const weekHours = Math.floor(weekSeconds / 3600);
        const weekMinutes = Math.floor((weekSeconds % 3600) / 60);
        
        const monthHours = Math.floor(monthSeconds / 3600);
        const monthMinutes = Math.floor((monthSeconds % 3600) / 60);
        
        // Обновляем отображение
        const weekElement = document.getElementById('weekTime');
        const monthElement = document.getElementById('monthTime');
        
        if (weekElement) {
            weekElement.textContent = weekHours > 0 ? 
                `${weekHours}ч ${weekMinutes}м` : 
                weekMinutes > 0 ? `${weekMinutes}м` : '0м';
        }
        
        if (monthElement) {
            monthElement.textContent = monthHours > 0 ? 
                `${monthHours}ч ${monthMinutes}м` : 
                monthMinutes > 0 ? `${monthMinutes}м` : '0м';
        }
        
        // Обновляем кэш
        cachedExtendedStats = {
            weekTime: weekSeconds,
            monthTime: monthSeconds,
            weekHistoryLength: last7Days.length,
            monthHistoryLength: last30Days.length
        };
        
        console.log('Extended stats updated:', cachedExtendedStats);
    }
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

function updateChart(history, dailyLimit = 30 * 60) {
    const chartContainer = document.getElementById('chartContainer');
    const dayLabelsContainer = document.getElementById('dayLabels');
    
    if (!chartContainer || !dayLabelsContainer) {
        console.error('Chart containers not found!');
        return;
    }
    
    // Очищаем график и подписи
    chartContainer.innerHTML = '';
    dayLabelsContainer.innerHTML = '';
    
    // Получаем данные за последние 7 дней
    const last7Days = getLast7DaysData(history);
    
    if (last7Days.length === 0) {
        const noDataDiv = document.createElement('div');
        noDataDiv.className = 'no-data';
        noDataDiv.textContent = 'Нет данных за последние 7 дней';
        chartContainer.appendChild(noDataDiv);
        return;
    }
    
    // Находим максимальное значение для масштабирования
    const maxTime = Math.max(...last7Days.map(d => d.timeSpent), dailyLimit, 1);
    
    // Создаем метки на оси Y
    createYAxisMarkers(chartContainer, maxTime);
    
    // Создаем столбцы
    last7Days.forEach((day, index) => {
        // Контейнер для столбца
        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container';
        
        // Столбец
        const bar = document.createElement('div');
        bar.className = 'bar';
        
        // Высота столбца в процентах
        const heightPercent = (day.timeSpent / maxTime) * 100;
        bar.style.height = `${heightPercent}%`;
        
        // Подсказка при наведении
        const tooltip = document.createElement('div');
        tooltip.className = 'bar-tooltip';
        tooltip.textContent = formatTime(day.timeSpent);
        
        barContainer.appendChild(bar);
        barContainer.appendChild(tooltip);
        chartContainer.appendChild(barContainer);
        
        // Создаем подпись дня
        const dayLabel = document.createElement('div');
        dayLabel.className = 'day-label';
        dayLabel.textContent = day.dayNumber;
        dayLabelsContainer.appendChild(dayLabel);
    });
}

function getLast7DaysData(history) {
    const today = new Date();
    const result = [];
    
    // Создаем массив последних 7 дней включая сегодня
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayNumber = date.getDate();
        
        // Ищем данные для этой даты
        const dayData = history.find(h => h.date === dateStr);
        
        result.push({
            date: dateStr,
            dayNumber: dayNumber,
            timeSpent: dayData ? dayData.timeSpent : 0
        });
    }
    
    return result;
}

function createYAxisMarkers(container, maxTime) {
    // Рассчитываем шаги для меток
    let step;
    let markerCount;
    
    if (maxTime <= 60) { // До 1 минуты
        step = 15; // 15 секунд
        markerCount = Math.ceil(maxTime / step);
    } else if (maxTime <= 300) { // До 5 минут
        step = 60; // 1 минута
        markerCount = Math.ceil(maxTime / step);
    } else if (maxTime <= 1800) { // До 30 минут
        step = 300; // 5 минут
        markerCount = Math.ceil(maxTime / step);
    } else { // Более 30 минут
        step = 600; // 10 минут
        markerCount = Math.ceil(maxTime / step);
    }
    
    // Ограничиваем количество меток
    markerCount = Math.min(markerCount, 5);
    
    // Создаем контейнер для меток оси Y
    const yAxisMarkers = document.createElement('div');
    yAxisMarkers.className = 'y-axis-markers';
    
    // Добавляем метки
    for (let i = 0; i <= markerCount; i++) {
        const timeValue = i * step;
        if (timeValue > maxTime) continue;
        
        const markerLine = document.createElement('div');
        markerLine.className = 'y-marker-line';
        const bottomPercent = (timeValue / maxTime) * 100;
        markerLine.style.cssText = `
            bottom: ${bottomPercent}%;
            background: ${i === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.1)'};
        `;
        yAxisMarkers.appendChild(markerLine);
        
        const markerLabel = document.createElement('div');
        markerLabel.className = 'y-marker-label';
        markerLabel.style.cssText = `
            bottom: ${bottomPercent}%;
        `;
        markerLabel.textContent = formatShortTime(timeValue);
        yAxisMarkers.appendChild(markerLabel);
    }
    
    container.appendChild(yAxisMarkers);
}

function formatShortTime(seconds) {
    if (seconds < 60) {
        return `${seconds}с`;
    } else {
        const minutes = Math.floor(seconds / 60);
        return `${minutes}м`;
    }
}

function formatTime(seconds) {
    if (seconds < 60) {
        return `${seconds} секунд`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${minutes}м ${secs}с` : `${minutes} минут`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}ч ${minutes}м` : `${hours} часов`;
    }
}

function showWarningIfNeeded(totalSeconds, dailyLimit) {
    const percentage = (totalSeconds / dailyLimit) * 100;
    
    // Показываем предупреждение только один раз за сессию для каждого уровня
    if (percentage > 90 && percentage < 100 && !window.warning90Shown) {
        showNotification('🚨 Внимание! Лимит Shorts почти исчерпан!');
        window.warning90Shown = true;
    } else if (percentage > 70 && percentage <90 && !window.warning70Shown) {
        showNotification('⚠️ Вы использовали более 70% лимита');
        window.warning70Shown = true;
    } else if (percentage > 50 && percentage <70 && !window.warning50Shown) {
        showNotification('📊 Лимит наполовину исчерпан');
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
            currentStats.historyLength = response.stats.history?.length || 0;
            
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
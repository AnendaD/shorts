document.addEventListener('DOMContentLoaded', () => {
    // Загружаем настройки
    loadSettings();
    
    // Обновляем статистику
    updateStats();
    
    // Событие для слайдера
    const slider = document.getElementById('dailyLimitSlider');
    const sliderValue = document.getElementById('dailyLimitValue');
    
    slider.addEventListener('input', () => {
        sliderValue.textContent = slider.value;
    });
    
    // Кнопка тестирования
    document.getElementById('testRedirect').addEventListener('click', () => {
        const urlInput = document.getElementById('redirectUrl');
        if (urlInput.value) {
            chrome.tabs.create({ url: urlInput.value });
            showStatus('Тестовое перенаправление выполнено!', 'success');
        } else {
            showStatus('Введите ссылку на видео для тестирования', 'error');
        }
    });
    
    // Кнопка сброса статистики
    document.getElementById('resetStats').addEventListener('click', () => {
        if (confirm('Вы уверены? Вся статистика будет удалена безвозвратно!')) {
            chrome.storage.local.set({
                stats: {
                    dailyTime: 0,
                    lastResetDate: new Date().toISOString().split('T')[0],
                    history: []
                }
            }, () => {
                showStatus('Статистика сброшена!', 'success');
                updateStats();
            });
        }
    });
    
    // Сохранение настроек
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
    
    // Отмена
    document.getElementById('cancelBtn').addEventListener('click', () => {
        loadSettings(); // Перезагружаем исходные значения
        showStatus('Изменения отменены', 'error');
    });
});

function loadSettings() {
    chrome.storage.local.get(['userSettings'], (result) => {
        const settings = result.userSettings || {};
        
        // Устанавливаем значения полей
        const slider = document.getElementById('dailyLimitSlider');
        const sliderValue = document.getElementById('dailyLimitValue');
        const urlInput = document.getElementById('redirectUrl');
        
        if (settings.dailyLimit) {
            const minutes = settings.dailyLimit / 60;
            slider.value = minutes;
            sliderValue.textContent = minutes;
        }
        
        if (settings.redirectVideoUrl) {
            urlInput.value = settings.redirectVideoUrl;
        }
    });
}

function saveSettings() {
    const slider = document.getElementById('dailyLimitSlider');
    const urlInput = document.getElementById('redirectUrl');
    
    const dailyLimit = parseInt(slider.value) * 60; // Конвертируем в секунды
    const redirectUrl = urlInput.value;
    
    // Валидация URL
    if (redirectUrl && !redirectUrl.includes('youtube.com/watch')) {
        showStatus('Введите корректную ссылку на YouTube видео', 'error');
        return;
    }
    
    chrome.storage.local.get(['userSettings'], (result) => {
        const currentSettings = result.userSettings || {};
        
        const newSettings = {
            ...currentSettings,
            dailyLimit: dailyLimit,
            redirectVideoUrl: redirectUrl || "https://www.youtube.com"
        };
        
        chrome.storage.local.set({ userSettings: newSettings }, () => {
            showStatus('Настройки сохранены!', 'success');
            
            // Обновляем статистику
            updateStats();
        });
    });
}

function updateStats() {
    chrome.storage.local.get(['stats'], (result) => {
        const stats = result.stats || {};
        const history = stats.history || [];
        
        // Время сегодня
        const todayMinutes = Math.floor(stats.dailyTime / 60);
        const todaySeconds = stats.dailyTime % 60;
        document.getElementById('statsToday').textContent = 
            `${todayMinutes} мин ${todaySeconds} сек`;
        
        // Дней отслеживания
        const uniqueDays = [...new Set(history.map(h => h.date))];
        document.getElementById('statsDays').textContent = uniqueDays.length;
        
        // Среднее в день
        if (history.length > 0) {
            const totalTime = history.reduce((sum, day) => sum + day.timeSpent, 0);
            const averageMinutes = Math.floor(totalTime / history.length / 60);
            document.getElementById('statsAverage').textContent = 
                `${averageMinutes} минут`;
        } else {
            document.getElementById('statsAverage').textContent = '0 минут';
        }
    });
}

function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    
    // Автоматически скрываем через 3 секунды
    setTimeout(() => {
        statusElement.textContent = '';
        statusElement.className = 'status-message';
    }, 3000);
}
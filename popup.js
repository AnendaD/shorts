// popup.js - ФИНАЛЬНАЯ ВЕРСИЯ БЕЗ RELOAD
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Popup загружен');
    
    try {
        if (typeof authManager === 'undefined') {
            console.error('❌ authManager не загружен!');
            return;
        }
        
        await authManager.init();
        await checkAuthStatus();
        setupAuthButtons();
        
        if (authManager.isLoggedIn || hasSkippedAuth()) {
            await loadMainContent();
        }
        
        // ДОБАВЛЕНО: Слушаем изменения настроек
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes.userSettings) {
                console.log('⚙️ Настройки изменены, обновляем интерфейс');
                
                // Обновляем лимит
                loadSettings();
                
                // Обновляем график с новым масштабом
                updateChart();
                
                // Обновляем прогресс бар
                updateStats();
            }
        });
        
        console.log('✅ Popup полностью инициализирован');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации popup:', error);
    }
});

async function checkAuthStatus() {
    const userSection = document.getElementById('userSection');
    const authSection = document.getElementById('authSection');
    const mainContent = document.getElementById('mainContent');
    
    if (!userSection || !authSection || !mainContent) {
        console.error('❌ Не найдены необходимые элементы DOM');
        return;
    }
    
    if (authManager.isLoggedIn) {
        console.log('✅ Пользователь авторизован - показываем контент');
        
        userSection.style.display = 'block';
        authSection.style.display = 'none';
        mainContent.style.display = 'block';
        
        const email = authManager.getUserEmail();
        const emailEl = document.getElementById('userEmail');
        if (emailEl) {
            emailEl.textContent = email || 'Авторизован';
        }
        
        const syncStatusEl = document.getElementById('syncStatus');
        if (syncStatusEl) {
            syncStatusEl.textContent = '🟢 Синхронизация включена';
        }
        
    } else if (hasSkippedAuth()) {
        console.log('⏭️ Авторизация пропущена - показываем контент');
        
        userSection.style.display = 'none';
        authSection.style.display = 'none';
        mainContent.style.display = 'block';
        
        const syncStatusEl = document.getElementById('syncStatus');
        if (syncStatusEl) {
            syncStatusEl.textContent = '🔴 Локальный режим';
        }
        
    } else {
        console.log('🔒 Требуется авторизация - показываем форму');
        
        userSection.style.display = 'none';
        authSection.style.display = 'block';
        mainContent.style.display = 'none';
    }
}

function hasSkippedAuth() {
    try {
        const skipped = localStorage.getItem('auth_skipped');
        return skipped === 'true';
    } catch (error) {
        console.error('Ошибка чтения localStorage:', error);
        return false;
    }
}

function setupAuthButtons() {
    const signInBtn = document.getElementById('signInBtn');
    const signUpBtn = document.getElementById('signUpBtn');
    const skipAuthBtn = document.getElementById('skipAuthBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const syncBtn = document.getElementById('syncBtn');
    
    if (signInBtn) {
        signInBtn.addEventListener('click', () => openAuthWindow('login'));
    }
    
    if (signUpBtn) {
        signUpBtn.addEventListener('click', () => openAuthWindow('register'));
    }
    
    if (skipAuthBtn) {
        skipAuthBtn.addEventListener('click', async () => {
            console.log('⏭️ Пропуск авторизации');
            try {
                localStorage.setItem('auth_skipped', 'true');
                
                // Скрываем форму авторизации и показываем контент
                const authSection = document.getElementById('authSection');
                const mainContent = document.getElementById('mainContent');
                
                if (authSection) authSection.style.display = 'none';
                if (mainContent) mainContent.style.display = 'block';
                
                await loadMainContent();
                
            } catch (error) {
                console.error('Ошибка при пропуске авторизации:', error);
            }
        });
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            console.log('👋 Выход из аккаунта');
            try {
                await authManager.logout();
                localStorage.removeItem('auth_skipped');
                
                // Скрываем контент и показываем форму авторизации
                const userSection = document.getElementById('userSection');
                const mainContent = document.getElementById('mainContent');
                const authSection = document.getElementById('authSection');
                
                if (userSection) userSection.style.display = 'none';
                if (mainContent) mainContent.style.display = 'none';
                if (authSection) authSection.style.display = 'block';
                
                console.log('✅ Выход выполнен');
                
            } catch (error) {
                console.error('Ошибка при выходе:', error);
            }
        });
    }
    
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (!authManager.isLoggedIn) {
                openAuthWindow('login');
            } else {
                await syncData();
            }
        });
    }
}

function openAuthWindow(mode) {
    const url = chrome.runtime.getURL(`auth.html${mode === 'register' ? '?mode=register' : ''}`);
    
    chrome.windows.create({
        url: url,
        type: 'popup',
        width: 450,
        height: 650,
        focused: true
    }, (authWindow) => {
        console.log('🪟 Открыто окно авторизации');
        
        const checkClosed = setInterval(() => {
            chrome.windows.get(authWindow.id, () => {
                if (chrome.runtime.lastError) {
                    clearInterval(checkClosed);
                    console.log('🪟 Окно авторизации закрыто');
                    
                    // Обновляем состояние после закрытия окна
                    setTimeout(async () => {
                        await authManager.init();
                        
                        // Проверяем новый статус авторизации
                        if (authManager.isLoggedIn) {
                            console.log('✅ Успешная авторизация!');
                            
                            // Скрываем форму авторизации
                            const authSection = document.getElementById('authSection');
                            if (authSection) authSection.style.display = 'none';
                            
                            // Показываем секцию пользователя и контент
                            const userSection = document.getElementById('userSection');
                            const mainContent = document.getElementById('mainContent');
                            
                            if (userSection) {
                                userSection.style.display = 'block';
                                const emailEl = document.getElementById('userEmail');
                                if (emailEl) {
                                    emailEl.textContent = authManager.getUserEmail() || 'Авторизован';
                                }
                            }
                            
                            if (mainContent) mainContent.style.display = 'block';
                            
                            // Загружаем контент
                            await loadMainContent();
                            
                        } else if (hasSkippedAuth()) {
                            console.log('⏭️ Авторизация пропущена');
                            
                            // Скрываем форму авторизации
                            const authSection = document.getElementById('authSection');
                            if (authSection) authSection.style.display = 'none';
                            
                            // Показываем контент
                            const mainContent = document.getElementById('mainContent');
                            if (mainContent) mainContent.style.display = 'block';
                            
                            // Загружаем контент
                            await loadMainContent();
                        }
                    }, 500);
                }
            });
        }, 1000);
    });
}

async function loadMainContent() {
    console.log('📊 Загрузка основного контента');
    
    try {
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) {
            console.error('❌ mainContent не найден');
            return;
        }
        
        if (mainContent.style.display !== 'block') {
            mainContent.style.display = 'block';
        }
        
        await loadSettings();
        await updateStats();
        await updateChart();
        setupMainButtons();
        
        // Периодическое обновление статистики
        setInterval(async () => {
            try {
                await updateStats();
            } catch (error) {
                console.error('Ошибка обновления статистики:', error);
            }
        }, 5000);
        
        console.log('✅ Контент загружен');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки контента:', error);
    }
}

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['userSettings'], (result) => {
            try {
                const settings = result.userSettings || { dailyLimit: 1800 };
                const limitMinutes = Math.floor(settings.dailyLimit / 60);
                
                const dailyLimitEl = document.getElementById('dailyLimit');
                if (dailyLimitEl) {
                    dailyLimitEl.textContent = limitMinutes;
                }
                
                resolve();
            } catch (error) {
                console.error('Ошибка загрузки настроек:', error);
                resolve();
            }
        });
    });
}

async function updateStats() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['stats', 'userSettings'], (result) => {
            try {
                const stats = result.stats || { dailyTime: 0, history: [] };
                const settings = result.userSettings || { dailyLimit: 1800 };
                
                const todayMinutes = Math.floor(stats.dailyTime / 60);
                const todaySeconds = stats.dailyTime % 60;
                
                const todayTimeEl = document.getElementById('todayTime');
                if (todayTimeEl) {
                    todayTimeEl.textContent = `${todayMinutes}м ${todaySeconds}с`;
                }
                
                const progress = (stats.dailyTime / settings.dailyLimit) * 100;
                const progressBar = document.getElementById('progressBar');
                if (progressBar) {
                    progressBar.style.width = `${Math.min(progress, 100)}%`;
                    
                    if (progress < 50) {
                        progressBar.style.backgroundColor = '#4CAF50';
                    } else if (progress < 80) {
                        progressBar.style.backgroundColor = '#FFA726';
                    } else {
                        progressBar.style.backgroundColor = '#F44336';
                    }
                }
                
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const activeTab = tabs[0];
                    const indicator = document.getElementById('activeIndicator');
                    
                    if (indicator && activeTab && activeTab.url && activeTab.url.includes('youtube.com/shorts')) {
                        indicator.style.display = 'inline-block';
                    } else if (indicator) {
                        indicator.style.display = 'none';
                    }
                });
                
                const history = stats.history || [];
                const now = new Date();
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                
                const weekTime = history
                    .filter(day => new Date(day.date) >= weekAgo)
                    .reduce((sum, day) => sum + day.timeSpent, 0);
                
                const monthTime = history
                    .filter(day => new Date(day.date) >= monthAgo)
                    .reduce((sum, day) => sum + day.timeSpent, 0);
                
                const weekTimeEl = document.getElementById('weekTime');
                if (weekTimeEl) {
                    weekTimeEl.textContent = 
                        `${Math.floor(weekTime / 3600)}ч ${Math.floor((weekTime % 3600) / 60)}м`;
                }
                
                const monthTimeEl = document.getElementById('monthTime');
                if (monthTimeEl) {
                    monthTimeEl.textContent = 
                        `${Math.floor(monthTime / 3600)}ч ${Math.floor((monthTime % 3600) / 60)}м`;
                }
                
                resolve();
            } catch (error) {
                console.error('Ошибка обновления статистики:', error);
                resolve();
            }
        });
    });
}

async function updateChart() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['stats', 'userSettings'], (result) => {
            try {
                const stats = result.stats || { history: [] };
                const settings = result.userSettings || { dailyLimit: 1800 };
                const history = stats.history || [];
                
                // Получаем лимит в минутах для масштабирования
                const dailyLimitMinutes = Math.floor(settings.dailyLimit / 60);
                
                const days = [];
                const now = new Date();
                
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                    const dateStr = date.toISOString().split('T')[0];
                    
                    const dayData = history.find(h => h.date === dateStr);
                    const timeMinutes = dayData ? Math.floor(dayData.timeSpent / 60) : 0;
                    
                    days.push({
                        label: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][date.getDay()],
                        time: timeMinutes
                    });
                }
                
                // ИСПРАВЛЕНО: используем максимум между лимитом и максимальным значением
                // Это позволяет видеть когда лимит превышен, но масштаб остается относительно лимита
                const maxTimeInData = Math.max(...days.map(d => d.time), 0);
                const maxTime = Math.max(dailyLimitMinutes, maxTimeInData, 1);
                
                const chartContainer = document.getElementById('chartContainer');
                if (chartContainer) {
                    chartContainer.innerHTML = '';
                    
                    days.forEach(day => {
                        const bar = document.createElement('div');
                        bar.className = 'bar';
                        
                        const height = (day.time / maxTime) * 100;
                        bar.style.height = `${height}%`;
                        bar.title = `${day.label}: ${day.time} минут (лимит: ${dailyLimitMinutes} мин)`;
                        
                        // Меняем цвет бара если превышен лимит
                        if (day.time > dailyLimitMinutes) {
                            bar.style.background = 'linear-gradient(to top, #ff4757, #ff6348)';
                        }
                        
                        chartContainer.appendChild(bar);
                    });
                }
                
                const labelsContainer = document.getElementById('dayLabels');
                if (labelsContainer) {
                    labelsContainer.innerHTML = '';
                    
                    days.forEach(day => {
                        const label = document.createElement('div');
                        label.className = 'label';
                        label.textContent = day.label;
                        labelsContainer.appendChild(label);
                    });
                }
                
                resolve();
            } catch (error) {
                console.error('Ошибка обновления графика:', error);
                resolve();
            }
        });
    });
}

function setupMainButtons() {
    const settingsBtn = document.getElementById('settingsBtn');
    const resetTodayBtn = document.getElementById('resetToday');
    
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }
    
    if (resetTodayBtn) {
        resetTodayBtn.addEventListener('click', () => {
            if (confirm('Сбросить статистику за сегодня?')) {
                chrome.storage.local.get(['stats'], (result) => {
                    const stats = result.stats || {};
                    stats.dailyTime = 0;
                    
                    chrome.storage.local.set({ stats }, () => {
                        updateStats();
                        console.log('✅ Статистика сброшена');
                    });
                });
            }
        });
    }
}

async function syncData() {
    if (!authManager.isLoggedIn) {
        return;
    }
    
    try {
        const syncStatusEl = document.getElementById('syncStatus');
        if (syncStatusEl) {
            syncStatusEl.textContent = '🔄 Синхронизация...';
            
            // TODO: Реализовать синхронизацию с сервером
            
            setTimeout(() => {
                syncStatusEl.textContent = '🟢 Синхронизация включена';
            }, 1000);
        }
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
    }
}
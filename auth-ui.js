// auth-ui.js
document.addEventListener('DOMContentLoaded', async () => {
    console.log('UI авторизации загружен');
    
    // Инициализируем менеджер авторизации
    await authManager.init();
    
    // Табы входа/регистрации
    const tabs = document.querySelectorAll('.tab');
    const forms = document.querySelectorAll('.form');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Активируем выбранную вкладку
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Показываем выбранную форму
            forms.forEach(form => {
                form.classList.remove('active');
                if (form.id === `${tabName}Form`) {
                    form.classList.add('active');
                }
            });
        });
    });
    
    // Кнопка входа
    document.getElementById('loginBtn').addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        if (!email || !password) {
            showStatus('Заполните все поля', 'error');
            return;
        }
        
        showStatus('Вход...', 'info');
        
        const result = await authManager.login(email, password);
        
        if (result.success) {
            showStatus('Вход выполнен успешно!', 'success');
            
            // Закрываем окно через 1 секунду
            setTimeout(() => {
                window.close();
            }, 1000);
        } else {
            showStatus(`Ошибка: ${result.error}`, 'error');
        }
    });
    
    // Кнопка регистрации
    document.getElementById('registerBtn').addEventListener('click', async () => {
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const acceptTerms = document.getElementById('acceptTerms').checked;
        
        if (!email || !password || !confirmPassword) {
            showStatus('Заполните все поля', 'error');
            return;
        }
        
        if (password !== confirmPassword) {
            showStatus('Пароли не совпадают', 'error');
            return;
        }
        
        if (!acceptTerms) {
            showStatus('Примите условия использования', 'error');
            return;
        }
        
        showStatus('Регистрация...', 'info');
        
        const result = await authManager.register(email, password);
        
        if (result.success) {
            showStatus('Регистрация успешна! Входим...', 'success');
            
            // Закрываем окно через 1 секунду
            setTimeout(() => {
                window.close();
            }, 1000);
        } else {
            showStatus(`Ошибка: ${result.error}`, 'error');
        }
    });
    
    // Кнопка пропуска
    document.getElementById('skipAuth').addEventListener('click', () => {
        showStatus('Продолжаем без авторизации', 'info');
        
        // Сохраняем флаг пропуска в localStorage
        localStorage.setItem('auth_skipped', 'true');
        
        setTimeout(() => {
            window.close();
        }, 800);
    });
    
    // Enter для быстрого входа
    document.getElementById('loginPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('loginBtn').click();
        }
    });
    
    // Проверка email при вводе
    document.getElementById('loginEmail').addEventListener('blur', validateEmail);
    document.getElementById('registerEmail').addEventListener('blur', validateEmail);
    
    function validateEmail(e) {
        const email = e.target.value;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (email && !emailRegex.test(email)) {
            showStatus('Введите корректный email', 'error');
            e.target.style.borderColor = '#ff4757';
        } else {
            e.target.style.borderColor = '#e0e0e0';
        }
    }
});

function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    
    // Автоматически скрываем через 5 секунд для ошибок, 3 секунды для успеха
    const timeout = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
        if (statusElement.textContent === message) {
            statusElement.textContent = '';
            statusElement.className = 'status-message';
        }
    }, timeout);
}
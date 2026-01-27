// auth.js - Модуль авторизации
const AUTH_SERVICE_URL = 'http://localhost:8080'; // URL вашего gRPC сервиса
const APP_ID = 1; // ID вашего приложения в SSO системе

class AuthManager {
    constructor() {
        this.accessToken = null;
        this.refreshToken = null;
        this.userId = null;
        this.isLoggedIn = false;
        this.isAdmin = false;
    }

    async init() {
        console.log('🔐 Инициализация менеджера авторизации');
        
        // Загружаем сохраненные токены
        await this.loadTokens();
        
        if (this.accessToken && this.refreshToken) {
            // Проверяем валидность access токена
            const isValid = await this.validateToken();
            if (!isValid) {
                // Пробуем обновить токены
                const refreshed = await this.refreshTokens();
                if (!refreshed) {
                    await this.clearTokens();
                }
            }
        }
    }

    async loadTokens() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['auth_tokens'], (result) => {
                const tokens = result.auth_tokens || {};
                this.accessToken = tokens.access_token;
                this.refreshToken = tokens.refresh_token;
                this.userId = tokens.user_id;
                this.isLoggedIn = !!this.accessToken;
                console.log('📥 Токены загружены:', { 
                    hasAccessToken: !!this.accessToken,
                    hasRefreshToken: !!this.refreshToken,
                    userId: this.userId 
                });
                resolve();
            });
        });
    }

    async saveTokens(tokens) {
        return new Promise((resolve) => {
            chrome.storage.local.set({
                auth_tokens: {
                    access_token: tokens.accessToken,
                    refresh_token: tokens.refreshToken,
                    user_id: tokens.userId
                }
            }, () => {
                this.accessToken = tokens.accessToken;
                this.refreshToken = tokens.refreshToken;
                this.userId = tokens.userId;
                this.isLoggedIn = true;
                console.log('💾 Токены сохранены');
                resolve();
            });
        });
    }

    async clearTokens() {
        return new Promise((resolve) => {
            chrome.storage.local.remove(['auth_tokens'], () => {
                this.accessToken = null;
                this.refreshToken = null;
                this.userId = null;
                this.isLoggedIn = false;
                this.isAdmin = false;
                console.log('🗑️ Токены очищены');
                resolve();
            });
        });
    }

    async login(email, password) {
        try {
            console.log('🔐 Попытка входа:', email);
            
            const response = await this.makeRequest('login', {
                email: email,
                password: password,
                appId: APP_ID
            });

            if (response.error) {
                throw new Error(response.error);
            }

            if (!response.token || !response.refreshToken) {
                throw new Error('Некорректный ответ от сервера');
            }

            await this.saveTokens({
                accessToken: response.token,
                refreshToken: response.refreshToken,
                userId: response.userId
            });

            return { success: true, user: { id: response.userId, email: email } };
        } catch (error) {
            console.error('❌ Ошибка входа:', error.message);
            return { success: false, error: error.message };
        }
    }

    async register(email, password) {
        try {
            console.log('📝 Попытка регистрации:', email);
            
            const response = await this.makeRequest('register', {
                email: email,
                password: password
            });

            if (response.error) {
                throw new Error(response.error);
            }

            // После регистрации автоматически логинимся
            return await this.login(email, password);
        } catch (error) {
            console.error('❌ Ошибка регистрации:', error.message);
            return { success: false, error: error.message };
        }
    }

    async refreshTokens() {
        try {
            console.log('🔄 Попытка обновления токенов');
            
            if (!this.refreshToken) {
                throw new Error('Нет refresh токена');
            }

            const response = await this.makeRequest('refresh', {
                refreshToken: this.refreshToken
            });

            if (response.error) {
                throw new Error(response.error);
            }

            await this.saveTokens({
                accessToken: response.token,
                refreshToken: response.refreshToken,
                userId: this.userId
            });

            console.log('✅ Токены обновлены');
            return true;
        } catch (error) {
            console.error('❌ Ошибка обновления токенов:', error.message);
            return false;
        }
    }

    async logout() {
        try {
            if (this.refreshToken) {
                await this.makeRequest('logout', {
                    refreshToken: this.refreshToken
                });
            }
        } catch (error) {
            console.error('❌ Ошибка выхода:', error.message);
        } finally {
            await this.clearTokens();
            console.log('👋 Пользователь вышел');
        }
    }

    async checkAdminStatus() {
        try {
            if (!this.userId) return false;

            const response = await this.makeRequest('isAdmin', {}, {
                Authorization: `Bearer ${this.accessToken}`
            });

            this.isAdmin = response.isAdmin;
            return this.isAdmin;
        } catch (error) {
            console.error('❌ Ошибка проверки прав админа:', error.message);
            return false;
        }
    }

    async validateToken() {
        // Упрощенная проверка - только проверяем expiration из payload
        if (!this.accessToken) return false;

        try {
            // Декодируем JWT токен (без проверки подписи)
            const payload = JSON.parse(atob(this.accessToken.split('.')[1]));
            const expiration = payload.exp * 1000; // Конвертируем в миллисекунды
            
            // Проверяем срок действия (оставляем 5 минут запаса)
            const isValid = Date.now() < (expiration - 5 * 60 * 1000);
            console.log('✅ Проверка токена:', { 
                isValid, 
                expires: new Date(expiration),
                now: new Date() 
            });
            
            return isValid;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error);
            return false;
        }
    }

    async makeRequest(endpoint, data, customHeaders = {}) {
        try {
            console.log(`📡 Отправляем запрос на ${endpoint}:`, data);
            
            const headers = {
                'Content-Type': 'application/json',
                ...customHeaders
            };

            const response = await fetch(`${AUTH_SERVICE_URL}/api/${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ HTTP ошибка ${response.status}:`, errorText);
                
                // Парсим JSON если возможно
                try {
                    const errorJson = JSON.parse(errorText);
                    throw new Error(errorJson.error || errorText);
                } catch {
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
            }

            const result = await response.json();
            console.log(`✅ Ответ от ${endpoint}:`, result);
            
            return result;
        } catch (error) {
            console.error(`❌ Ошибка при запросе ${endpoint}:`, error);
            throw error;
        }
    }

    getAuthHeaders() {
        return this.accessToken ? {
            'Authorization': `Bearer ${this.accessToken}`
        } : {};
    }
}

// Создаем глобальный экземпляр менеджера авторизации
const authManager = new AuthManager();

// Экспортируем для использования в других файлах
window.authManager = authManager;

// Добавляем метод для извлечения email из токена
AuthManager.prototype.getUserEmail = function() {
    try {
        if (!this.accessToken) return null;
        const payload = JSON.parse(atob(this.accessToken.split('.')[1]));
        return payload.email || null;
    } catch (error) {
        console.error('Ошибка декодирования токена:', error);
        return null;
    }
};
// Проверяем все открытые вкладки YouTube при запуске расширения
chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
    
    tabs.forEach(tab => {        
        // Проверяем, загружен ли content script
        chrome.tabs.sendMessage(tab.id, { type: 'PING' })
            .then(() => {
                console.log(`✅ Content script на вкладке ${tab.id} активен`);
            })
            .catch(() => {
                console.log(`⚠️ Content script на вкладке ${tab.id} не отвечает, загружаем...`);
                
                // Загружаем content script
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                }).then(() => {
                    console.log(`✅ Content script загружен на вкладку ${tab.id}`);
                    
                    // Даем время на инициализацию
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tab.id, { type: 'CHECK_STATE' })
                            .catch(() => {});
                    }, 1000);
                }).catch(err => {
                    console.error(`❌ Ошибка загрузки на вкладку ${tab.id}:`, err);
                });
            });
    });
});

// Мониторим новые вкладки YouTube
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com')) {
        console.log(`🆕 Загружена новая вкладка YouTube: ${tab.url}`);
        
        // Даем время на загрузку
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { type: 'CHECK_STATE' })
                .catch(() => {
                    // Если не отвечает, загружаем content script
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['content.js']
                    }).then(() => {
                        console.log(`✅ Content script загружен в новую вкладку ${tabId}`);
                    });
                });
        }, 500);
    }
});
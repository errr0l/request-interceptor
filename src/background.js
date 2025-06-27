let panelWindow = null;
let monitoring = false, pattern = "";
let requestBody = null;

chrome.browserAction.onClicked.addListener((tab) => {
    if (panelWindow) {
        // 如果已经有打开的窗口，则仅聚焦
        chrome.windows.update(panelWindow.id, { focused: true });
    }
    else {
        // 创建新窗口显示 panel.html
        chrome.windows.create({
            url: chrome.runtime.getURL('panel.html'),
            type: 'popup',
            width: 450,
            height: 700
        }, (win) => {
            panelWindow = win;
            // 监听窗口关闭事件，清除 panelWindow 引用
            chrome.windows.onRemoved.addListener(function listener(windowId) {
                if (windowId === panelWindow.id) {
                    panelWindow = null;
                    chrome.windows.onRemoved.removeListener(listener);
                }
            });
        });
    }
});

// onBeforeRequest 监听器
function beforeRequestListener(details) {
    if (details.method === 'POST') {
        if (details.requestBody.formData) {
            details.requestBody.data = {};
            for (const [key, value] of Object.entries(details.requestBody.formData)) {
                details.requestBody.data[key] = value.join(', ');
            }
        }
        else if (details.requestBody.raw) {
            try {
                const decoder = new TextDecoder('utf-8');
                details.requestBody.data = JSON.parse(decoder.decode(details.requestBody.raw[0].bytes));
            }
            catch (e) {
                console.error('Failed to parse request body:', e);
                details.requestBody.data = { error: '无法解析的请求体' };
            }
        }
        else {
            details.requestBody.data = { error: '未知类型的请求体' };
        }
        requestBody = details.requestBody.data;
    }
    return {};
}

// onSendHeaders 监听器
function sendHeadersListener(details) {

    const headers = {};

    for (const item of details.requestHeaders) {
        headers[item.name] = item.value;
    }
    const item = {
        url: details.url,
        method: details.method,
        headers: headers,
        timestamp: Date.now(),
        body: requestBody
    };
    requestBody = null;
    chrome.runtime.sendMessage({ type: "NEW_REQUEST_LOG", data: item });
}

function updateWebRequestListeners() {
    // 移除旧监听器
    chrome.webRequest.onBeforeRequest.removeListener(beforeRequestListener);
    chrome.webRequest.onSendHeaders.removeListener(sendHeadersListener);

    // 若为停止监听动作，则中断执行
    if (!monitoring) return;

    // 设置监听模式，并添加新的监听器
    const urls = [pattern];

    chrome.webRequest.onBeforeRequest.addListener(
        beforeRequestListener,
        { urls },
        ["requestBody"]
    );

    chrome.webRequest.onSendHeaders.addListener(
        sendHeadersListener,
        { urls },
        ["requestHeaders"]
    );
}

// 处理来自面板的消息
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CONTROL") {
        monitoring = message.monitoring;
        pattern = message.pattern;
        updateWebRequestListeners();
    }
});
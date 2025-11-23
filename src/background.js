let panelWindow = null;
let monitoring = false, pattern = "";
let requestBody = null;
let interceptionMode = null;
// 键值对的形式，如：{ 'GET': 1, 'POST': 1 }
let methodSettings = null;
let allowedMethodCount = 0;
const INTERCEPTION_MODE_BLOCKING = "2";

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
            height: screen.availHeight
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

function shouldCancelRequest(details) {
    const url = details.url;
    if (pattern) {
        const regexPattern = pattern
            .replace(/\*/g, '[^ ]*')  // * 匹配除空格外的任何字符
            .replace(/\?/g, '.');     // ? 匹配单个字符
    
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(url)) {
            return true;
        }
    }
}

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
            let _data;
            try {
                const decoder = new TextDecoder('utf-8');
                _data = decoder.decode(details.requestBody.raw[0].bytes);
                details.requestBody.data = JSON.parse(_data);
            }
            catch (e) {
                console.log('Failed to parse request body:', e);
                details.requestBody.data = { error: '无法解析的请求体', rawText: _data };
            }
        }
        else {
            details.requestBody.data = { error: '未知类型的请求体' };
        }
        requestBody = details.requestBody.data;
    }
    return {};
}

// onBeforeSendHeaders 监听器
function beforeSendHeadersListener(details) {
    // 如果可能的话，过滤指定方法
    const method = details.method;
    // 不指定时，默认处理所有方法；
    // 如果指定方法时，则检查当前方法是否在methodSettings中，存在就处理；
    // 注意，不处理的请求，会正常请求服务器，但不会拦截数据到插件面板
    if (allowedMethodCount === 0 || method in methodSettings) {
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

        // 若匹配命中的话，则取消请求
        if (shouldCancelRequest(details)) {
            return { cancel: true };  // 取消请求
        }
    }
}

function updateWebRequestListeners() {
    // 移除旧监听器
    chrome.webRequest.onBeforeRequest.removeListener(beforeRequestListener);
    chrome.webRequest.onBeforeSendHeaders.removeListener(beforeSendHeadersListener);

    // 若为停止监听动作，则中断执行
    if (!monitoring) return;

    // 设置监听模式，并添加新的监听器
    const urls = [pattern];

    chrome.webRequest.onBeforeRequest.addListener(
        beforeRequestListener,
        { urls },
        ["requestBody"]
    );
    const options = ["requestHeaders"];
    if (interceptionMode === INTERCEPTION_MODE_BLOCKING) {
        options.push("blocking");
    }
    chrome.webRequest.onBeforeSendHeaders.addListener(
        beforeSendHeadersListener,
        { urls },
        options
    );
}

// 处理来自面板的消息
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CONTROL") {
        monitoring = message.monitoring;
        pattern = message.pattern;
        interceptionMode = message.interceptionMode;
        const methods = message.methods || [];
        allowedMethodCount = methods.length;
        const _methodSettings = {};
        if (methods.length) {
            for (const item of methods) {
                _methodSettings[item] = 1;
            }
        }
        methodSettings = _methodSettings;
        updateWebRequestListeners();
    }
});
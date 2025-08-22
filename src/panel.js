const logDiv = document.getElementById("log");
const controlBtn = document.getElementById("control");
const clearBtn = document.getElementById("clear");
const exportCurlBtn = document.getElementById("export-curl");
const exportPowershellBtn = document.getElementById("export-powershell");
const patternInput = document.getElementById("url-pattern");
const patternExpDiv = document.getElementById('url-pattern-exp');
const setFilenameBtn = document.getElementById('set-filename');
const activityPatternDiv = document.getElementById("activity-pattern");
const syncConfigBtn = document.getElementById("sync-config");
const radios = document.querySelectorAll('input[name="mode"]');

let setFilenameBtnTextContent;
const DEFAULT_PATTERN = "<all_urls>";
const logs = [];

let monitoring = false;
let timer = null, fetching = false;
let filename = "";

const defaultPatternConfig = {
    "url_pattern": "*://*/*.example.com/*,*://*.example.com/api/*,*://*.example.com/*,*://*/api/*",
    "activity_pattern": "/claimItemExplore,/claim/explore/item"
};
const configStr = localStorage.getItem("config");
let mode = localStorage.getItem("mode") || "1";
const urlPattrn = localStorage.getItem("url-pattern") || "";
const config = Object.assign({}, defaultPatternConfig, configStr ? JSON.parse(configStr) : {});

// 监听事件
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "NEW_REQUEST_LOG") {
        logs.unshift(message.data);
        if (logs.length > 100) logs.pop();
        if (timer) {
            return;
        }
        timer = setTimeout(() => {
            render();
            timer = null;
        }, 1500);
    }
    else {
        console.log(message);
    }
});
controlBtn.onclick = () => {
    monitoring = !monitoring;
    controlBtn.textContent = monitoring ? "停止监听" : "开始监听";

    const pattern = patternInput.value.trim();

    chrome.runtime.sendMessage({
        type: "CONTROL",
        monitoring: monitoring,
        pattern: pattern || DEFAULT_PATTERN
    });
}
clearBtn.onclick = () => {
    logs.length = 0;
    render();
}

exportCurlBtn.onclick = () => {
    let logs = filterIfNecessary();
    const content = makeFileContent(logs, 'curl');
    downloadTextFile(content, filename || "requests.txt");
}

exportPowershellBtn.onclick = () => {
    let logs = filterIfNecessary();
    const content = makeFileContent(logs, 'powershell');
    downloadTextFile(content, filename || "requests_ps.txt");
}

patternExpDiv.onclick = (ev) => {
    let target = ev.target;
    if (target.tagName === "SPAN") {
        const textContent = target.textContent;
        patternInput.value = textContent;
        localStorage.setItem("url-pattern", textContent);
    }
}

logDiv.addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName !== 'SPAN') {
        return;
    }
    if (target.className.includes("btn-copy")) {
        const index = +target.getAttribute("data-index");
        const type = target.getAttribute("data-type");
        const log = logs[index];
        const maker = makers[type];
        const content = maker(log)
        copy(content);
    }
});

setFilenameBtn.addEventListener('click', () => {
    const _filename = window.prompt("请输入文件名");
    if (_filename) {
        if (!_filename.endsWith(".txt")) {
            _filename += ".txt";
        }
        filename = _filename;
        if (!setFilenameBtnTextContent) {
            setFilenameBtnTextContent = setFilenameBtn.textContent;
        }
        setFilenameBtn.textContent = `${setFilenameBtnTextContent}[${_filename.length > 10 ? _filename.slice(0, 10) : _filename}]`;
    }
});

syncConfigBtn.addEventListener("click", async () => {
    if (fetching) {
        return;
    }
    fetching = true;
    await syncConfig();
    fetching = false;
});

function filterIfNecessary() {
    let _logs = logs;
    // const checked = document.querySelector('input[name=mode]:checked');
    // const filter = logFilters[checked.value];
    const filter = logFilters[mode];
    filter && (_logs = filter(_logs));
    return _logs;
}

// 目前仅支持两种模式
const excluded = ['Content-Length', 'Accept-Encoding', "Connection"];
const makers = {
    'curl': ({ method, url, headers, body }) => {
        let content = `curl -X ${method} '${url}' \\\n`;
        if (headers) {
            for (const key in headers) {
                // 排除字段
                if (excluded.includes(key)) {
                    continue;
                }
                content += `  -H '${key}: ${headers[key]}' \\\n`;
            }
        }
        if (body) {
            const contentType = headers['Content-Type'];
            if (contentType.includes('json')) {
                content += `  --data-raw '${JSON.stringify(body)}'`;
            }
            else if (contentType.includes('x-www-form-urlencoded')) {
                const formData = new URLSearchParams(body).toString();
                content += `  --data-raw '${formData}'`;
            }
        }
        return content;
    },
    'powershell': ({ method, url, headers, body }) => {
        let content = `Invoke-WebRequest -UseBasicParsing -Uri "${url}" -Method ${method} \`\n`;
        if (headers) {
            content += "  -Headers @{\n";
            for (const key in headers) {
                if (excluded.includes(key)) {
                    continue;
                }
                content += `    "${key}"="${headers[key]}"\n`;
            }
            content += "  } \`\n";
        }
        if (body) {
            const contentType = headers['Content-Type'];
            if (contentType.includes('json')) {
                content += `  -Body '${JSON.stringify(body)}'`;
            }
            else if (contentType.includes('x-www-form-urlencoded')) {
                const formData = new URLSearchParams(body).toString();
                content += `  -Body '${formData}'`;
            }
        }
        return content;
    }
};

/**
 * 生成文件内容
 * @param {Array<Object>} logs 日志
 * @param {String} type 类型；curl；powershell
 */
function makeFileContent(logs, type) {
    let content = "";
    const maker = makers[type];
    for (const item of logs) {
        content += maker(item);
        content += "\n";
    }
    return content;
}

// ===== 工具函数：下载文本文件 =====
function downloadTextFile(text, filename) {
    if (!text) {
        return window.alert('无数据');
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    window.alert('成功.');
}

// 过滤器
const logFilters = {
    // pqt专用
    '1': (logs) => {
        // 目前来说，都是post请求，且每种接口只取一次
        const matched = {};
        const _logs = logs.filter(log => {
            if (log.method !== "POST" || matched[log.url]) {
                return false;
            }
            // '/sexual_dating/claimItemExplore', '/quiz_dating/claim/explore/item', '/girl-watch/claim/explore/item'
            for (const item of config['activity_pattern'].split(",")) {
                if (log.url.includes(item)) {
                    matched[log.url] = 1;
                    return true;
                }
            }
            return false;
        });
        if (!_logs.length || _logs.length === 1) {
            return _logs;
        }
        // 默认情况下，新数据排前;
        const latest = _logs[0];
        const field = "X-QOOKIA-PACK";
        const xQookiaPack = latest.headers[field];
        // 将最新请求的x-qookia-pack字段值应用于其他请求
        for (const item of _logs) {
            if (item === latest) {
                continue;
            }
            item.headers[field] = xQookiaPack;
        }
        return _logs;
    }
};

function createLogItemHtml(item, i) {
    let html = `<div class="log-item">`;
    html += `<strong>时间: </strong> ${new Date(item.timestamp).toLocaleString()}<br>`;
    html += `<strong>URL: </strong> ${item.url}<br>`;
    html += `<strong>方法: </strong> ${item.method}<br>`;
    html += `<strong>操作: </strong> <span class="btn-copy" data-type="curl" data-index="${i}">复制为curl</span> <span class="btn-copy" data-type="powershell" data-index="${i}">复制为PowerShell</span>`;
    html += "<br>";

    if (item.headers) {
        html += `<strong>请求头:</strong><pre>`;
        for (let key in item.headers) {
            html += `${key}: ${item.headers[key]}\n`;
        }
        html += `</pre>`;
    }

    if (item.body) {
        html += `<strong>请求体:</strong><pre>`;
        for (let key in item.body) {
            html += `${key}: ${item.body[key]}\n`;
        }
        html += `</pre>`;
    }
    html += `</div>`;
    return html;
}

function render() {
    if (logs.length === 0) {
        logDiv.innerHTML = "无数据";
        return;
    }
    let html = `<div class="count">数量：${logs.length}</div>`;
    for (let i=0; i<logs.length; i++) {
        const item = logs[i];
        html += createLogItemHtml(item, i);
    }

    logDiv.innerHTML = html;
}

function copy(content) {
    if (content) {
        navigator.clipboard.writeText(content);
        window.alert("复制成功");
    }
}

async function syncConfig() {
    const url = "https://raw.githubusercontent.com/errr0l/request-interceptor/refs/heads/master/src/config.json";
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), 5000); // 5秒超时
    // 尝试获取配置文件
    return fetch(url, {
        signal: controller.signal
    })
    .then(response => response.text())
    .then(configStr => {
        try {
            const _config = JSON.parse(configStr);
            Object.assign(config, _config);
            updateNode(_config);
            localStorage.setItem("config", configStr);
        }
        catch (error) {
            console.error(error);
            window.alert("同步失败：" + error.message);
        }
    })
    .catch(error => {
        console.log('请求失败:', error.message);
        window.alert("同步失败：" + error.message);
    })
    .finally(() => {
        clearTimeout(timer);
    });
}

function updateNode(config) {
    if (mode === "1") {
        activityPatternDiv.innerText = config["activity_pattern"];
    }
    let patternExpDivHtml = "";
    for (const item of config["url_pattern"].split(",")) {
        patternExpDivHtml += `<span>${item}</span>、`;
    }
    patternExpDiv.innerHTML = patternExpDivHtml.slice(0, -1);
}

// 初始化
function init() {
    updateNode(config);
    radios.forEach((radio) => {
        radio.addEventListener('click', (event) => {
            const target = event.target;
            const value = target.value;
            if (value === "2") {
                activityPatternDiv.innerText = "";
            }
            else {
                activityPatternDiv.innerText = config['activity_pattern'];
            }
            localStorage.setItem("mode", value);
            // 更新全局变量
            mode = value;
        });
    });
    radios[(+mode - 1)].checked = true;
    if (urlPattrn) {
        patternInput.value = urlPattrn;
    }
}

init();
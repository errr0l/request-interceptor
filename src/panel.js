const logDiv = document.getElementById("log");
const controlBtn = document.getElementById("control");
const clearBtn = document.getElementById("clear");
const exportCurlBtn = document.getElementById("export-curl");
const exportPowershellBtn = document.getElementById("export-powershell");
const patternInput = document.getElementById("url-pattern");

const DEFAULT_PATTERN = "<all_urls>";
const logs = [];

let monitoring = false;

// 监听事件
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "NEW_REQUEST_LOG") {
        logs.unshift(message.data);
        if (logs.length > 100) logs.pop();
        render();
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
    downloadTextFile(content, "requests.txt");
}

exportPowershellBtn.onclick = () => {
    let logs = filterIfNecessary();
    const content = makeFileContent(logs, 'powershell');
    downloadTextFile(content, "requests_ps.txt");
}

function filterIfNecessary() {
    let _logs = logs;
    const checked = document.querySelector('input[name=mode]:checked');
    const filter = logFilters[checked.value];
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
        content += "\n\n";
        // 按需设置分隔符；
        if (item.splitor) {
            content += item.splitor;
            content += "\n\n";
        }
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
        const _logs = logs.filter(log => {
            // 目前来说，都是post请求
            if (log.method !== "POST") {
                return false;
            }
            // '/sexual_dating/claimItemExplore', '/quiz_dating/claim/explore/item', '/girl-watch/claim/explore/item'
            for (const item of ['/claimItemExplore', '/claim/explore/item']) {
                if (log.url.includes(item)) {
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
        // 取得最后一个
        const last = _logs[_logs.length - 1];
        const field = "X-QOOKIA-PACK";
        const xQookiaPack = latest.headers[field];
        // 将最新请求的x-qookia-pack字段值应用于其他请求
        for (const item of _logs) {
            // 设置分隔符
            if (item !== last) {
                item.splitor = "&&";
            }
            if (item === latest) {
                continue;
            }
            item.headers[field] = xQookiaPack;
        }
        return _logs;
    }
};


function render() {
    if (logs.length === 0) {
        logDiv.innerHTML = "暂无数据.";
        return;
    }
    let output = `<div>数量：${logs.length}</div>`;
    for (const item of logs) {
        output += `<div class="log-item">`;
        output += `<strong>时间: </strong> ${new Date(item.timestamp).toLocaleString()}<br>`;
        output += `<strong>URL: </strong> ${item.url}<br>`;
        output += `<strong>方法: </strong> ${item.method}<br>`;

        if (item.headers) {
            output += `<strong>请求头:</strong><pre>`;
            for (let key in item.headers) {
                output += `${key}: ${item.headers[key]}\n`;
            }
            output += `</pre>`;
        }

        if (item.body) {
            output += `<strong>请求体:</strong><pre>`;
            for (let key in item.body) {
                output += `${key}: ${item.body[key]}\n`;
            }
            output += `</pre>`;
        }
        output += `</div>`;
    }

    logDiv.innerHTML = output;
}
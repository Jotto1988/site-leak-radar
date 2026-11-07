// 1. Setup Footprint & Leak Scanner
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    const url = new URL(currentTab.url);
    const domain = url.hostname.replace(/^www\./, '');

    // Configure Dorks
    document.getElementById('btn-github').href = `https://github.com/search?q=%22${domain}%22&type=code`;
    document.getElementById('btn-subdomains').href = `https://crt.sh/?q=%25.${domain}`;

    // Request Leaks
    chrome.tabs.sendMessage(currentTab.id, { action: "getLeaks" }, function(response) {
        const container = document.getElementById('leak-container');
        if (chrome.runtime.lastError || !response || response.leaks.length === 0) {
            container.innerHTML = '<div class="no-leaks">No obvious secrets found in DOM.</div>';
            return;
        }

        container.innerHTML = '';
        response.leaks.forEach(leak => {
            const div = document.createElement('div');
            div.className = 'leak-item';
            div.innerHTML = `<strong>${leak.type}:</strong><br>${leak.value}`;
            container.appendChild(div);
        });
    });
});

// 2. Header Manager Logic
const headersContainer = document.getElementById('headers-container');

function createRow(index, active = false, name = "", value = "") {
    const row = document.createElement('div');
    row.className = 'header-row';
    row.innerHTML = `
        <input type="checkbox" id="cb-${index}" title="Toggle Header" ${active ? 'checked' : ''}>
        <input type="text" id="name-${index}" placeholder="Header-Name" value="${name}">
        <input type="text" id="val-${index}" placeholder="Value" value="${value}">
    `;
    headersContainer.appendChild(row);
}

// Load existing headers from Chrome storage
chrome.storage.local.get(['customHeaders'], (result) => {
    const saved = result.customHeaders || [];
    for (let i = 0; i < 5; i++) {
        const data = saved[i] || { active: false, name: "", value: "" };
        createRow(i, data.active, data.name, data.value);
    }
});

// Save headers and trigger background update
document.getElementById('save-headers').addEventListener('click', () => {
    const customHeaders = [];
    for (let i = 0; i < 5; i++) {
        customHeaders.push({
            active: document.getElementById(`cb-${i}`).checked,
            name: document.getElementById(`name-${i}`).value.trim(),
            value: document.getElementById(`val-${i}`).value.trim()
        });
    }
    
    chrome.storage.local.set({ customHeaders }, () => {
        const status = document.getElementById('save-status');
        status.innerText = "Headers saved and applied globally!";
        setTimeout(() => status.innerText = "", 2500);
    });
});

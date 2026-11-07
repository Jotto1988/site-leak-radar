// 1. Setup Footprint & Leak Scanner
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    const url = new URL(currentTab.url);
    const domain = url.hostname.replace(/^www\./, '');

    document.getElementById('btn-github').href = `https://github.com/search?q=%22${domain}%22&type=code`;
    document.getElementById('btn-subdomains').href = `https://crt.sh/?q=%25.${domain}`;

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

chrome.storage.local.get(['customHeaders'], (result) => {
    const saved = result.customHeaders || [];
    for (let i = 0; i < 5; i++) {
        const data = saved[i] || { active: false, name: "", value: "" };
        createRow(i, data.active, data.name, data.value);
    }
});

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

// 3. Bulk Scope Resolver Logic
document.getElementById('btn-resolve').addEventListener('click', async () => {
    const input = document.getElementById('scope-input').value;
    const domains = input.split('\n').map(d => d.trim()).filter(d => d.length > 0);
    
    if (domains.length === 0) return;

    const statusEl = document.getElementById('resolve-status');
    const csvBtn = document.getElementById('btn-download-csv');
    
    statusEl.innerText = `Resolving 0 / ${domains.length}... (Keep this popup open)`;
    csvBtn.style.display = 'none';

    // Retrieve active headers to attach directly to fetch requests
    const { customHeaders } = await chrome.storage.local.get(['customHeaders']);
    const activeHeaders = (customHeaders || []).filter(h => h.active && h.name && h.value);
    let fetchHeaders = {};
    activeHeaders.forEach(h => fetchHeaders[h.name] = h.value);

    let results = [];

    for (let i = 0; i < domains.length; i++) {
        let target = domains[i];
        if (!target.startsWith('http')) target = 'https://' + target;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6-second timeout
            
            // Using GET over HEAD because many WAFs block HEAD requests outright
            const response = await fetch(target, { 
                method: 'GET',
                headers: fetchHeaders,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            results.push({ domain: domains[i], resolved_url: response.url, status: response.status });
        } catch (error) {
            results.push({ domain: domains[i], resolved_url: target, status: 'Timeout/Error' });
        }
        
        statusEl.innerText = `Resolving ${i + 1} / ${domains.length}...`;
    }

    statusEl.innerText = `Finished resolving ${domains.length} targets.`;
    
    // Prepare CSV Content
    let csvContent = "data:text/csv;charset=utf-8,Original Domain,Resolved URL,Status Code\n";
    results.forEach(r => {
        csvContent += `${r.domain},${r.resolved_url},${r.status}\n`;
    });
    
    // Setup Download Button
    csvBtn.style.display = 'block';
    csvBtn.onclick = () => {
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "live_scope_results.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
});

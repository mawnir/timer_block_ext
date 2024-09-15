function extractDomain(url) {
    try {
        // Remove leading "@" if present
        url = url.replace(/^@/, '');
        // Add protocol if not present
        if (!/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
        }
        const domain = new URL(url).hostname;
        return domain.replace(/^www\./, '');
    } catch (error) {
        console.error("Invalid URL:", url);
        return null;
    }
}

function updateLists() {
    browser.storage.local.get(['blockedSites', 'siteTimeLimits']).then((result) => {
        updateBlockedList(result.blockedSites || []);
        updateTimeLimitList(result.siteTimeLimits || {});
    });
}

function updateBlockedList(blockedSites) {
    const blockedList = document.getElementById('blockedList');
    blockedList.innerHTML = '';

    if (blockedSites.length === 0) {
        blockedList.innerHTML = '<p class="empty-message">No sites blocked yet.</p>';
    } else {
        const template = document.getElementById('blockedSiteTemplate');
        blockedSites.forEach(site => {
            const element = template.content.cloneNode(true);
            element.querySelector('.site-name').textContent = site;
            element.querySelector('.convert-btn').onclick = () => convertToTimeLimit(site);
            element.querySelector('.remove-btn').onclick = () => removeSite(site);
            blockedList.appendChild(element);
        });
    }
}

function convertToTimeLimit(site) {
    const timeLimit = prompt(`Enter time limit for ${site} in minutes:`);
    if (timeLimit && !isNaN(timeLimit) && parseInt(timeLimit) > 0) {
        removeSite(site);
        addTimeLimit(site, parseInt(timeLimit));
    } else if (timeLimit !== null) {
        alert("Please enter a valid number of minutes.");
    }
}

function updateTimeLimitList(siteTimeLimits) {
    const timeLimitList = document.getElementById('timeLimitList');
    timeLimitList.innerHTML = '';

    if (Object.keys(siteTimeLimits).length === 0) {
        timeLimitList.innerHTML = '<p class="empty-message">No time limits set yet.</p>';
    } else {
        const template = document.getElementById('timeLimitSiteTemplate');
        Object.entries(siteTimeLimits).forEach(([site, limit]) => {
            const element = template.content.cloneNode(true);
            element.querySelector('.site-name').textContent = site;
            const input = element.querySelector('.time-limit-input');
            input.value = limit;
            input.onchange = () => updateTimeLimit(site, input.value);
            element.querySelector('.remove-btn').onclick = () => removeTimeLimit(site);
            timeLimitList.appendChild(element);
        });
    }
}

function addSite(site, timeLimit, shouldBlock) {
    const domain = extractDomain(site);
    if (!domain) {
        alert("Invalid website format. Please enter a valid domain.");
        return;
    }

    if (shouldBlock) {
        browser.storage.local.get('blockedSites').then((result) => {
            const blockedSites = result.blockedSites || [];
            if (!blockedSites.includes(domain)) {
                blockedSites.push(domain);
                browser.storage.local.set({ blockedSites }).then(() => {
                    updateLists();
                    browser.runtime.sendMessage({ action: "updateBlockedSites" });
                });
            }
        });
    } else if (timeLimit && timeLimit > 0) {
        addTimeLimit(domain, timeLimit);
    }
}

function removeSite(site) {
    browser.storage.local.get('blockedSites').then((result) => {
        const blockedSites = result.blockedSites || [];
        const index = blockedSites.indexOf(site);
        if (index > -1) {
            blockedSites.splice(index, 1);
            browser.storage.local.set({ blockedSites }).then(() => {
                updateLists();
                browser.runtime.sendMessage({ action: "updateBlockedSites" });
            });
        }
    });
}

function addTimeLimit(site, limit) {
    browser.storage.local.get('siteTimeLimits').then((result) => {
        const siteTimeLimits = result.siteTimeLimits || {};
        siteTimeLimits[site] = parseInt(limit);
        browser.storage.local.set({ siteTimeLimits }).then(() => {
            updateLists();
            browser.runtime.sendMessage({ action: "updateTimeLimits" });
        });
    });
}

function updateTimeLimit(site, limit) {
    if (limit && limit > 0) {
        addTimeLimit(site, limit);
    } else {
        removeTimeLimit(site);
    }
}

function removeTimeLimit(site) {
    browser.storage.local.get('siteTimeLimits').then((result) => {
        const siteTimeLimits = result.siteTimeLimits || {};
        delete siteTimeLimits[site];
        browser.storage.local.set({ siteTimeLimits }).then(() => {
            updateLists();
            browser.runtime.sendMessage({
                action: "updateTimeLimits",
                removedSite: site  // Add this line
            });
        });
    });
}

function resetForm() {
    document.getElementById('websiteInput').value = '';
    document.getElementById('timeLimitInput').value = '';
    document.getElementById('timeLimitInput').disabled = false;
    document.getElementById('blockCheckbox').checked = false;
}

// Event listener for when the popup is loaded
document.addEventListener('DOMContentLoaded', function () {
    console.log("Popup loaded"); // Debug log
    updateLists();

    const addButton = document.getElementById('addButton');
    const blockCheckbox = document.getElementById('blockCheckbox');
    const timeLimitInput = document.getElementById('timeLimitInput');
    const extensionToggle = document.getElementById('extensionToggle');

    if (addButton) {
        addButton.addEventListener('click', function () {
            let website = document.getElementById('websiteInput').value;
            let timeLimit = timeLimitInput.value;
            let shouldBlock = blockCheckbox.checked;

            if (website) {
                if (!shouldBlock && (!timeLimit || timeLimit <= 0)) {
                    alert("Please either set a time limit or check the 'Block site entirely' box.");
                } else {
                    addSite(website, timeLimit, shouldBlock);
                    resetForm(); // Use the new resetForm function
                }
            } else {
                alert("Please enter a website.");
            }
        });
    } else {
        console.error("Add button not found"); // Debug log
    }

    // Add event listener for the checkbox
    if (blockCheckbox) {
        blockCheckbox.addEventListener('change', function () {
            timeLimitInput.disabled = this.checked;
        });
    }

    // Load the current state of the extension
    browser.storage.local.get('extensionEnabled').then((result) => {
        extensionToggle.checked = result.extensionEnabled !== false; // Default to true if not set
    });

    // Handle toggle changes
    extensionToggle.addEventListener('change', function () {
        const isEnabled = this.checked;
        browser.storage.local.set({ extensionEnabled: isEnabled });
        browser.runtime.sendMessage({ action: "updateExtensionState", isEnabled: isEnabled });
    });

    const settingsLink = document.getElementById('settingsLink');
    if (settingsLink) {
        settingsLink.addEventListener('click', function (e) {
            e.preventDefault();
            // Replace this line
            // browser.runtime.openOptionsPage();
            // With this
            browser.tabs.create({ url: "settings.html" });
        });
    }
});
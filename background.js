console.log("Background script loaded");

let blockedSites = [];
const blockedPage = browser.runtime.getURL("blocked.html");
let siteTimers = {};
let siteTimeLimits = {};
let lastResetDate = new Date().setHours(1, 0, 0, 0);
let blockSchedule = { start: '09:00', end: '17:00' };
let siteSchedules = {};

let activeTabs = new Set();
let lastActiveTime = {};

let extensionEnabled = true;

// Add this function to check if the extension is enabled
function isExtensionEnabled() {
    return extensionEnabled;
}

function handleTabActivated(activeInfo) {
    const { tabId } = activeInfo;
    activeTabs.add(tabId);
    const currentTime = Date.now();

    // Update time for previously active tab
    activeTabs.forEach(id => {
        if (id !== tabId && lastActiveTime[id]) {
            const domain = tabDomains[id];
            if (domain && siteTimers[domain]) {
                siteTimers[domain].totalTime += currentTime - lastActiveTime[id];
            }
        }
    });

    // Set last active time for current tab
    lastActiveTime[tabId] = currentTime;

    // Start timer for current tab
    browser.tabs.get(tabId).then(tab => {
        if (tab.url) {
            updateTimer(tabId, tab.url);
        }
    }).catch(error => {
        console.log(`Error getting tab ${tabId}:`, error);
    });
}

function handleTabRemoved(tabId, removeInfo) {
    const domain = tabDomains[tabId];
    if (domain && siteTimers[domain]) {
        const currentTime = Date.now();
        if (lastActiveTime[tabId]) {
            siteTimers[domain].totalTime += currentTime - lastActiveTime[tabId];
        }
        console.log(`Tab closed for ${domain}. Total time: ${siteTimers[domain].totalTime / 60000} minutes`);
    }
    activeTabs.delete(tabId);
    delete lastActiveTime[tabId];
    delete tabDomains[tabId];
}

let tabDomains = {};

// Add this new function to check if the content script has been injected
function isContentScriptInjected(tabId) {
    return browser.tabs.sendMessage(tabId, { action: "ping" })
        .then(() => true)
        .catch(() => false);
}

// Modify the injectContentScript function
function injectContentScript(tabId, retryCount = 0) {
    console.log(`Attempting to inject content script into tab ${tabId} (Attempt ${retryCount + 1})`);
    return browser.tabs.executeScript(tabId, { file: "content.js", runAt: "document_start" })
        .then(() => {
            console.log(`Content script injected into tab ${tabId}`);
            // Add a longer delay before pinging the content script
            return new Promise(resolve => setTimeout(resolve, 500));
        })
        .then(() => browser.tabs.sendMessage(tabId, { action: "ping" }))
        .then(() => {
            console.log(`Content script responded in tab ${tabId}`);
            return true;
        })
        .catch(error => {
            console.log(`Error injecting or pinging content script in tab ${tabId}:`, error);
            if (error.message.includes("Missing host permission") || error.message.includes("No tab with id")) {
                console.log(`Skipping content script injection for tab ${tabId} due to permission or tab issues`);
                return false;
            }
            // If the error is due to the content script not being ready, we'll try again after a longer delay
            if (error.message.includes("Could not establish connection") && retryCount < 3) {
                console.log(`Retrying content script injection for tab ${tabId} (Attempt ${retryCount + 2})`);
                return new Promise(resolve => setTimeout(resolve, 1000))
                    .then(() => injectContentScript(tabId, retryCount + 1));
            }
            console.log(`Failed to inject content script into tab ${tabId} after ${retryCount + 1} attempts`);
            return false;
        });
}

// Modify the updateTimer function
function updateTimer(tabId, url) {
    if (!isExtensionEnabled()) {
        return Promise.resolve(); // Don't update timers if the extension is disabled
    }

    const domain = new URL(url).hostname.replace(/^www\./, '');
    tabDomains[tabId] = domain;

    if (!siteTimers[domain]) {
        siteTimers[domain] = { totalTime: 0 };
    }

    const timeSpentMinutes = Math.floor(siteTimers[domain].totalTime / 60000);

    if (siteTimeLimits[domain] && timeSpentMinutes >= siteTimeLimits[domain]) {
        return browser.tabs.update(tabId, { url: blockedPage });
    }

    return browser.tabs.get(tabId)
        .then(tab => {
            if (browser.runtime.lastError) {
                console.log(`Tab ${tabId} no longer exists`);
                return Promise.resolve();
            }

            return injectContentScript(tabId)
                .then(injected => {
                    if (injected && siteTimeLimits[domain]) {
                        return browser.tabs.sendMessage(tabId, {
                            action: "updateTimer",
                            domain: domain,
                            time: timeSpentMinutes,
                            limit: siteTimeLimits[domain]
                        }).catch(error => {
                            console.log(`Error sending message to tab ${tabId}: ${error}`);
                        });
                    } else if (injected) {
                        return browser.tabs.sendMessage(tabId, { action: "hideTimer" })
                            .catch(error => {
                                console.log(`Error sending message to tab ${tabId}: ${error}`);
                            });
                    }
                    // If injection failed, we'll still continue without throwing an error
                    return Promise.resolve();
                });
        })
        .then(() => {
            console.log(`Timer updated for tab ${tabId}`);
            // Update the timer state even if we couldn't inject the content script
            siteTimers[domain].totalTime = timeSpentMinutes * 60000;
        })
        .catch(error => {
            console.log(`Error updating timer for tab ${tabId}:`, error);
            return Promise.resolve(); // Resolve the promise to continue execution
        });
}

function updateAllTimers() {
    const currentTime = Date.now();
    activeTabs.forEach(tabId => {
        if (lastActiveTime[tabId]) {
            const domain = tabDomains[tabId];
            if (domain && siteTimers[domain]) {
                siteTimers[domain].totalTime += currentTime - lastActiveTime[tabId];
                lastActiveTime[tabId] = currentTime;
                console.log(`Updated timer for ${domain}. Total time: ${siteTimers[domain].totalTime / 60000} minutes`);
            }
        }
    });
}

// Add these listeners
browser.tabs.onActivated.addListener(handleTabActivated);
browser.tabs.onRemoved.addListener(handleTabRemoved);
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        updateTimer(tabId, tab.url);
    }
});

// Update all timers every minute
setInterval(updateAllTimers, 60000);

function isWithinBlockingHours(domain) {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    console.log(`Checking blocking hours for ${domain} at ${now.toLocaleTimeString()}`);
    console.log("Current siteSchedules:", siteSchedules);

    // Check for exact domain match first, then try subdomain matching
    let schedules = siteSchedules[domain];
    if (!schedules) {
        // Try to find a matching subdomain
        const matchingKey = Object.keys(siteSchedules).find(key => domain.endsWith(key));
        if (matchingKey) {
            schedules = siteSchedules[matchingKey];
            console.log(`Found matching schedule for subdomain: ${matchingKey}`);
        }
    }

    // If no site-specific schedule, use the default block schedule
    if (!schedules) {
        schedules = { morning: blockSchedule, afternoon: blockSchedule };
        console.log(`Using default block schedule for ${domain}:`, blockSchedule);
    }

    console.log(`Schedules for ${domain}:`, schedules);

    function isWithinSchedule(schedule) {
        if (!schedule || !schedule.start || !schedule.end) {
            console.log("Invalid schedule:", schedule);
            return false;
        }
        const [startHour, startMinute] = schedule.start.split(':').map(Number);
        const [endHour, endMinute] = schedule.end.split(':').map(Number);
        const scheduleStart = startHour * 60 + startMinute;
        const scheduleEnd = endHour * 60 + endMinute;

        console.log(`Schedule: ${schedule.start} - ${schedule.end}`);
        console.log(`Current time: ${Math.floor(currentTime / 60)}:${currentTime % 60}`);

        if (scheduleEnd > scheduleStart) {
            return currentTime >= scheduleStart && currentTime < scheduleEnd;
        } else {
            // Handle schedules that cross midnight
            return currentTime >= scheduleStart || currentTime < scheduleEnd;
        }
    }

    const isWithinMorning = isWithinSchedule(schedules.morning);
    const isWithinAfternoon = isWithinSchedule(schedules.afternoon);

    console.log(`Is ${domain} within blocking hours: Morning: ${isWithinMorning}, Afternoon: ${isWithinAfternoon}`);

    return isWithinMorning || isWithinAfternoon;
}

function redirectToBlockedPage(requestDetails) {
    if (!isExtensionEnabled()) {
        console.log("Extension is disabled. Not blocking.");
        return {};
    }

    console.log("Attempting to redirect:", requestDetails.url);
    const domain = new URL(requestDetails.url).hostname.replace(/^www\./, '');
    console.log("Domain:", domain);

    console.log("Current blocked sites:", blockedSites);
    console.log("Current site time limits:", siteTimeLimits);
    console.log("Current block schedule:", blockSchedule);
    console.log("Current site schedules:", siteSchedules);

    if (!isWithinBlockingHours(domain)) {
        console.log("Outside blocking hours for this site. Not blocking.");
        return {};
    }

    // Check if the domain is in the blockedSites list
    const isBlocked = blockedSites.some(site =>
        site === domain || domain.endsWith(`.${site}`)
    );

    if (isBlocked) {
        console.log(`Site ${domain} is blocked. Redirecting...`);
        return { redirectUrl: blockedPage };
    }

    // Check if the domain has a time limit
    const domainParts = domain.split('.');
    for (let i = 0; i < domainParts.length; i++) {
        const checkDomain = domainParts.slice(i).join('.');
        if (siteTimeLimits[checkDomain]) {
            const timeSpentMinutes = Math.floor((siteTimers[checkDomain]?.totalTime || 0) / 60000);
            console.log(`Time spent on ${checkDomain}: ${timeSpentMinutes} minutes`);
            console.log(`Time limit for ${checkDomain}: ${siteTimeLimits[checkDomain]} minutes`);
            if (timeSpentMinutes >= siteTimeLimits[checkDomain]) {
                console.log("Time limit exceeded. Redirecting...");
                return { redirectUrl: blockedPage };
            }
        }
    }

    // If the site has a specific schedule, it should be blocked during the scheduled times
    if (siteSchedules[domain]) {
        console.log(`Site ${domain} has a specific schedule and is within blocking hours. Redirecting...`);
        return { redirectUrl: blockedPage };
    }

    console.log(`Not blocking this request for ${domain}.`);
    return {};
}

function updateBlockedSites() {
    console.log("Updating blocked sites...");
    return browser.storage.local.get('blockedSites').then((result) => {
        blockedSites = result.blockedSites || [];
        console.log("Updated blocked sites:", blockedSites);
    });
}

function updateTimeLimits() {
    browser.storage.local.get('siteTimeLimits').then((result) => {
        siteTimeLimits = result.siteTimeLimits || {};
        console.log("Updated site time limits:", siteTimeLimits);
    });
}

function updateBlockSchedule() {
    console.log("updateBlockSchedule function called");
    return browser.storage.local.get('blockSchedule').then((result) => {
        console.log("Retrieved blockSchedule from storage:", result.blockSchedule);
        blockSchedule = result.blockSchedule || { start: '09:00', end: '17:00' };
        console.log("Updated block schedule:", blockSchedule);
    }).catch(error => {
        console.error("Error updating block schedule:", error);
    });
}

function updateSiteSchedules() {
    console.log("updateSiteSchedules function called");
    return browser.storage.local.get('siteSchedules').then((result) => {
        console.log("Retrieved siteSchedules from storage:", result.siteSchedules);
        siteSchedules = result.siteSchedules || {};
        console.log("Updated site schedules:", siteSchedules);
    }).catch(error => {
        console.error("Error updating site schedules:", error);
    });
}

// Add this function to log current state
function logCurrentState() {
    console.log("Current blocked sites:", blockedSites);
    console.log("Current site time limits:", siteTimeLimits);
    console.log("Current block schedule:", blockSchedule);
    console.log("Current site schedules:", siteSchedules);
    console.log("Current time:", new Date().toLocaleTimeString());
    logTimerState();
}

// Add this function to log timer state
function logTimerState() {
    console.log("Current timer state:");
    for (const [domain, timer] of Object.entries(siteTimers)) {
        console.log(`${domain}: ${timer.totalTime / 60000} minutes`);
    }
}

// Call this function after each update
function updateAll() {
    updateBlockedSites();
    updateTimeLimits();
    updateBlockSchedule();
    updateSiteSchedules();
    logCurrentState();
}

// Modify the existing message listener
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background script received message:", message);
    if (message.action === "updateExtensionState") {
        extensionEnabled = message.isEnabled;
        console.log("Extension enabled state updated:", extensionEnabled);
    } else if (message.action === "updateBlockedSites") {
        updateBlockedSites();
    } else if (message.action === "updateTimeLimits") {
        updateTimeLimits();
    } else if (message.action === "updateBlockSchedule") {
        console.log("Updating block schedule with:", message.schedule);
        updateBlockSchedule();
    } else if (message.action === "updateSiteSchedules") {
        console.log("Updating site schedules");
        updateSiteSchedules().then(() => {
            console.log("Site schedules updated successfully");
        });
    } else if (message.action === "updateAll") {
        updateAll();
    } else if (message.action === "getTime") {
        if (isExtensionEnabled()) {
            updateAllTimers(); // Update all timers before sending the current time
            if (sender.tab) {
                updateTimer(sender.tab.id, sender.tab.url);
            } else {
                console.log("Sender tab information not available");
            }
        }
    } else {
        console.log("Unknown message action:", message.action);
    }
    logCurrentState();
    // Send a response back to the sender
    sendResponse({ status: "Message received and processed" });
    // Return true to indicate that the response will be sent asynchronously
    return true;
});

// Modify the initial setup
function initialSetup() {
    console.log("Performing initial setup...");
    browser.storage.local.get(['extensionEnabled', 'siteSchedules', 'blockedSites', 'siteTimeLimits', 'blockSchedule']).then((result) => {
        extensionEnabled = result.extensionEnabled !== false; // Default to true if not set
        siteSchedules = result.siteSchedules || {};
        blockedSites = result.blockedSites || [];
        siteTimeLimits = result.siteTimeLimits || {};
        blockSchedule = result.blockSchedule || { start: '09:00', end: '17:00' };
        console.log("Extension enabled:", extensionEnabled);
        console.log("Initial site schedules:", siteSchedules);
        console.log("Initial blocked sites:", blockedSites);
        console.log("Initial site time limits:", siteTimeLimits);
        console.log("Initial block schedule:", blockSchedule);
        updateAll();

        // Set up the web request listener
        browser.webRequest.onBeforeRequest.addListener(
            redirectToBlockedPage,
            { urls: ["<all_urls>"] },
            ["blocking"]
        );
    });
}

initialSetup();

function testBlocking(url) {
    const details = { url: url };
    const result = redirectToBlockedPage(details);
    console.log("Test blocking result:", result);
}
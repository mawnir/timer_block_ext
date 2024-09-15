if (!window.hasRun) {
    window.hasRun = true;

    let timerElement = null;

    function createTimerElement() {
        if (!timerElement) {
            timerElement = document.createElement('div');
            timerElement.style.position = 'fixed';
            timerElement.style.top = '10px';
            timerElement.style.right = '10px';
            timerElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            timerElement.style.color = 'white';
            timerElement.style.padding = '5px 10px';
            timerElement.style.borderRadius = '5px';
            timerElement.style.zIndex = '9999';
            document.body.appendChild(timerElement);
        }
    }

    function updateTimerDisplay(time, limit) {
        createTimerElement();
        timerElement.textContent = `Time: ${time}/${limit} minutes`;
        timerElement.style.display = 'block';
    }

    function hideTimer() {
        if (timerElement) {
            timerElement.style.display = 'none';
        }
    }

    // Modify the listener for messages from the background script
    browser.runtime.onMessage.addListener((message) => {
        if (message.action === "updateTimer") {
            updateTimerDisplay(message.time, message.limit);
        } else if (message.action === "hideTimer") {
            hideTimer();
        } else if (message.action === "ping") {
            return Promise.resolve({ pong: true });
        }
    });

    // Request the time from the background script
    browser.runtime.sendMessage({ action: "getTime" });

    // Update timer every minute
    setInterval(() => {
        browser.runtime.sendMessage({ action: "getTime" });
    }, 60000);
}
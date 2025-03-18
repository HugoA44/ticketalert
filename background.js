let monitoringInterval = null;
let monitoredTabId = null;
let monitoredUrl = null;
let isSelectingElement = false;

// Fonction pour envoyer une notification
async function sendNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: title,
      message: message,
      priority: 2,
      requireInteraction: true
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification:', error);
  }
}

// Fonction pour injecter le script de sélection
async function injectSelectionScript() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('Aucun onglet actif trouvé');
    }
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        // Fonction pour générer un sélecteur CSS unique
        function generateSelector(element) {
          if (element.id) {
            return '#' + element.id;
          }
          
          if (element.className) {
            const classes = Array.from(element.classList).join('.');
            return '.' + classes;
          }

          let path = [];
          while (element && element.nodeType === Node.ELEMENT_NODE) {
            let selector = element.nodeName.toLowerCase();
            if (element.id) {
              selector += '#' + element.id;
              path.unshift(selector);
              break;
            }
            let sib = element, nth = 1;
            while (sib = sib.previousElementSibling) {
              if (sib.nodeName.toLowerCase() === selector) nth++;
            }
            if (nth !== 1) selector += ":nth-of-type("+nth+")";
            path.unshift(selector);
            element = element.parentNode;
          }
          return path.join(' > ');
        }

        // Ajouter le style pour le mode sélection
        const style = document.createElement('style');
        style.setAttribute('data-ticketalert', 'true');
        style.textContent = `
          .ticketalert-selection-mode * {
            cursor: pointer !important;
          }
          .ticketalert-selection-mode *:hover {
            outline: 2px solid #2196F3 !important;
          }
          .ticketalert-selection-mode *:active {
            outline: 2px solid #f44336 !important;
          }
        `;
        document.head.appendChild(style);

        // Ajouter la classe au body
        document.body.classList.add('ticketalert-selection-mode');

        // Gérer les clics
        const clickHandler = function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const selector = generateSelector(e.target);
          const text = e.target.textContent.trim();
          
          // Sauvegarder le sélecteur et le texte dans le stockage local
          chrome.storage.local.set({ 
            selectedSelector: selector,
            selectedText: text,
            selectionComplete: true
          }, () => {
            // Nettoyer
            document.body.classList.remove('ticketalert-selection-mode');
            style.remove();
            document.removeEventListener('click', clickHandler, true);
          });
        };

        document.addEventListener('click', clickHandler, true);
      }
    });
  } catch (error) {
    console.error('Erreur lors de l\'injection du script:', error);
    chrome.storage.local.set({ 
      selectionError: 'Impossible d\'accéder à la page. Assurez-vous d\'être sur une page web.'
    });
  }
}

// Fonction pour nettoyer le mode sélection
async function cleanupSelectionMode() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('Aucun onglet actif trouvé');
    }
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        document.body.classList.remove('ticketalert-selection-mode');
        const style = document.querySelector('style[data-ticketalert]');
        if (style) style.remove();
      }
    });
  } catch (error) {
    console.error('Erreur lors du nettoyage:', error);
  }
}

// Fonction pour vérifier le contenu de la page
async function checkPageContent(selector, expectedText) {
  try {
    // Vérifier si nous avons un onglet enregistré
    if (!monitoredTabId || !monitoredUrl) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('Aucun onglet actif trouvé');
      }
      monitoredTabId = tab.id;
      monitoredUrl = tab.url;
    }

    // Rafraîchir la page
    await chrome.tabs.reload(monitoredTabId);

    // Attendre un peu que la page se charge
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Vérifier si l'onglet existe toujours et est sur la bonne URL
    const tab = await chrome.tabs.get(monitoredTabId);
    if (tab.url !== monitoredUrl) {
      stopMonitoring();
      await sendNotification(
        'TicketAlert - Erreur',
        'La page surveillée a changé. Surveillance arrêtée.'
      );
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: monitoredTabId },
      function: (selector, expectedText) => {
        const element = document.querySelector(selector);
        if (!element) return { error: 'Élément non trouvé' };
        return { 
          text: element.textContent.trim(),
          matches: element.textContent.trim() === expectedText
        };
      },
      args: [selector, expectedText]
    });

    const result = results[0].result;
    
    if (result.error) {
      await sendNotification(
        'TicketAlert - Erreur',
        'Élément non trouvé sur la page. Vérifiez le sélecteur CSS.'
      );
      stopMonitoring();
      return;
    }

    if (!result.matches) {
      await sendNotification(
        'TicketAlert - Changement détecté!',
        `Le texte a changé!\nAncienne valeur: "${expectedText}"\nNouvelle valeur: "${result.text}"`
      );
      stopMonitoring();
    }
  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
    await sendNotification(
      'TicketAlert - Erreur',
      'Une erreur est survenue pendant la surveillance.'
    );
    stopMonitoring();
  }
}

// Démarrer la surveillance
async function startMonitoring(selector, text, interval) {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  try {
    // Réinitialiser les variables de surveillance
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('Aucun onglet actif trouvé');
    }
    monitoredTabId = tab.id;
    monitoredUrl = tab.url;

    // Notification de démarrage
    await sendNotification(
      'TicketAlert - Surveillance démarrée',
      `Surveillance active pour le texte "${text}"\nIntervalle: ${interval} secondes`
    );

    // Démarrer la surveillance
    monitoringInterval = setInterval(() => {
      checkPageContent(selector, text);
    }, interval * 1000);

    // Première vérification immédiate
    checkPageContent(selector, text);
  } catch (error) {
    console.error('Erreur lors du démarrage de la surveillance:', error);
    await sendNotification(
      'TicketAlert - Erreur',
      'Impossible de démarrer la surveillance. Assurez-vous d\'être sur une page web.'
    );
  }
}

// Arrêter la surveillance
async function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  monitoredTabId = null;
  monitoredUrl = null;
  chrome.storage.local.set({ isMonitoring: false });
}

// Écouter les messages du popup et du script injecté
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMonitoring') {
    const { selector, text, interval } = request.data;
    startMonitoring(selector, text, interval);
  } else if (request.action === 'stopMonitoring') {
    stopMonitoring();
  } else if (request.action === 'startElementSelection') {
    isSelectingElement = true;
    // Réinitialiser les états de sélection
    chrome.storage.local.set({ 
      selectedSelector: null,
      selectionComplete: false,
      selectionError: null
    }, () => {
      injectSelectionScript();
    });
  } else if (request.action === 'stopElementSelection') {
    isSelectingElement = false;
    cleanupSelectionMode();
  } else if (request.action === 'openSelectorWindow') {
    // Ouvrir une fenêtre séparée pour la sélection
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 400,
      height: 300
    });
  }
});

// Nettoyer lors de la désinstallation/mise à jour
chrome.runtime.onInstalled.addListener(() => {
  stopMonitoring();
});

// Arrêter la surveillance si l'onglet est fermé
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === monitoredTabId) {
    stopMonitoring();
  }
});
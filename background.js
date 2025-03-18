let monitoringIntervals = {};
let monitoredTabs = {};
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
          
          // Envoyer le sélecteur et le texte au background script
          chrome.runtime.sendMessage({
            action: 'elementSelected',
            selector: selector,
            text: text
          });

          // Nettoyer
          document.body.classList.remove('ticketalert-selection-mode');
          style.remove();
          document.removeEventListener('click', clickHandler, true);
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
async function checkPageContent(tabId, url, selector, expectedText) {
  try {
    console.log('Vérification de la page:', { tabId, url, selector, expectedText });
    
    // Vérifier si l'onglet existe toujours
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      console.log('L\'onglet n\'existe plus');
      stopMonitoring(tabId);
      await sendNotification(
        'TicketAlert - Erreur',
        'La page surveillée a changé. Surveillance arrêtée.'
      );
      return;
    }

    // Rafraîchir la page
    await chrome.tabs.reload(tabId);

    // Attendre un peu que la page se charge
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Exécution du script de vérification');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: (selector, expectedText) => {
        console.log('Recherche de l\'élément avec le sélecteur:', selector);
        const element = document.querySelector(selector);
        if (!element) {
          console.log('Élément non trouvé');
          return { error: 'Élément non trouvé' };
        }
        const text = element.textContent.trim();
        console.log('Texte trouvé:', text);
        return { 
          text: text,
          matches: text === expectedText
        };
      },
      args: [selector, expectedText]
    });

    console.log('Résultats de la vérification:', results);
    const result = results[0].result;
    
    if (result.error) {
      console.log('Erreur:', result.error);
      await sendNotification(
        'TicketAlert - Erreur',
        'Élément non trouvé sur la page. Vérifiez le sélecteur CSS.'
      );
      stopMonitoring(tabId);
      return;
    }

    if (!result.matches) {
      console.log('Changement détecté:', { expected: expectedText, found: result.text });
      await sendNotification(
        'TicketAlert - Changement détecté!',
        `Le texte a changé!\nAncienne valeur: "${expectedText}"\nNouvelle valeur: "${result.text}"`
      );
      stopMonitoring(tabId);
    }
  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
    await sendNotification(
      'TicketAlert - Erreur',
      'Une erreur est survenue pendant la surveillance.'
    );
    stopMonitoring(tabId);
  }
}

// Démarrer la surveillance
async function startMonitoring(tabId, url, selector, text, interval) {
  console.log('Démarrage de la surveillance:', { tabId, url, selector, text, interval });
  
  if (monitoringIntervals[tabId]) {
    clearInterval(monitoringIntervals[tabId]);
  }

  try {
    // Notification de démarrage
    await sendNotification(
      'TicketAlert - Surveillance démarrée',
      `Surveillance active pour le texte "${text}"\nIntervalle: ${interval} secondes`
    );

    // Démarrer la surveillance
    monitoringIntervals[tabId] = setInterval(() => {
      checkPageContent(tabId, url, selector, text);
    }, interval * 1000);

    // Première vérification immédiate
    await checkPageContent(tabId, url, selector, text);
  } catch (error) {
    console.error('Erreur lors du démarrage de la surveillance:', error);
    await sendNotification(
      'TicketAlert - Erreur',
      'Impossible de démarrer la surveillance. Assurez-vous d\'être sur une page web.'
    );
  }
}

// Arrêter la surveillance
async function stopMonitoring(tabId) {
  if (monitoringIntervals[tabId]) {
    clearInterval(monitoringIntervals[tabId]);
    delete monitoringIntervals[tabId];
  }
  delete monitoredTabs[tabId];
}

// Écouter les messages du popup et du script injecté
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMonitoring') {
    const { selector, text, interval, url } = request.data;
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0].id;
      monitoredTabs[tabId] = url;
      startMonitoring(tabId, url, selector, text, interval);
    });
  } else if (request.action === 'stopMonitoring') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0].id;
      stopMonitoring(tabId);
    });
  } else if (request.action === 'startElementSelection') {
    isSelectingElement = true;
    injectSelectionScript();
  } else if (request.action === 'stopElementSelection') {
    isSelectingElement = false;
    cleanupSelectionMode();
  } else if (request.action === 'elementSelected') {
    // Sauvegarder la sélection dans le stockage local
    chrome.storage.local.set({
      lastSelection: {
        selector: request.selector,
        text: request.text
      }
    });
  } else if (request.action === 'openSelectorWindow') {
    // Ouvrir une fenêtre séparée pour la sélection
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 400,
      height: 300
    });
  } else if (request.action === 'getLastSelection') {
    // Récupérer la dernière sélection
    chrome.storage.local.get(['lastSelection'], (result) => {
      if (result.lastSelection) {
        sendResponse(result.lastSelection);
        // Nettoyer la sélection temporaire
        chrome.storage.local.remove('lastSelection');
      }
    });
    return true; // Indique que nous allons appeler sendResponse de manière asynchrone
  }
});

// Nettoyer lors de la désinstallation/mise à jour
chrome.runtime.onInstalled.addListener(() => {
  Object.keys(monitoringIntervals).forEach(tabId => stopMonitoring(tabId));
});

// Arrêter la surveillance si l'onglet est fermé
chrome.tabs.onRemoved.addListener((tabId) => {
  if (monitoringIntervals[tabId]) {
    stopMonitoring(tabId);
  }
});
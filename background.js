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
        // Fonction pour obtenir une empreinte unique de l'élément
        function getElementFingerprint(element) {
          // Créer une copie de l'élément pour le nettoyer
          const clone = element.cloneNode(true);
          
          // Supprimer tous les éléments avec la classe ticketalert-
          const ticketAlertElements = clone.querySelectorAll('[class^="ticketalert-"]');
          ticketAlertElements.forEach(el => el.remove());
          
          // Obtenir le texte nettoyé
          const cleanText = element.textContent.replace(/\s+/g, ' ').trim();
          
          // Obtenir le chemin XPath relatif
          function getXPath(node) {
            const parts = [];
            while (node && node.nodeType === Node.ELEMENT_NODE) {
              let siblings = Array.from(node.parentNode.children).filter(
                child => child.nodeName === node.nodeName
              );
              
              if (siblings.length > 1) {
                let index = siblings.indexOf(node) + 1;
                parts.unshift(`${node.nodeName.toLowerCase()}[${index}]`);
              } else {
                parts.unshift(node.nodeName.toLowerCase());
              }
              node = node.parentNode;
            }
            return parts.join('/');
          }

          // Créer une empreinte basée sur plusieurs caractéristiques
          return {
            // Texte exact (pour la comparaison précise)
            text: cleanText,
            // Chemin XPath pour la localisation
            xpath: getXPath(element),
            // Classes stables (filtrer les classes générées dynamiquement)
            classes: Array.from(element.classList)
              .filter(c => !c.startsWith('ticketalert-') && !c.match(/css-[a-z0-9]+/)),
            // Type d'élément
            tagName: element.tagName.toLowerCase(),
            // Attributs stables
            attributes: {
              id: element.id,
              href: element.getAttribute('href'),
              src: element.getAttribute('src'),
              type: element.getAttribute('type'),
              role: element.getAttribute('role'),
              'aria-label': element.getAttribute('aria-label')
            }
          };
        }

        // Ajouter le style pour le mode sélection et surveillance
        const style = document.createElement('style');
        style.setAttribute('data-ticketalert', 'true');
        style.textContent = `
          .ticketalert-selection-mode * {
            cursor: pointer !important;
          }
          .ticketalert-selection-mode *:hover {
            outline: 2px solid rgba(33, 150, 243, 0.5) !important;
            outline-offset: 2px !important;
            transition: outline 0.2s ease-in-out !important;
            box-shadow: 0 0 15px rgba(33, 150, 243, 0.3) !important;
          }
          .ticketalert-selection-mode *:active {
            outline: 2px solid rgba(244, 67, 54, 0.7) !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 20px rgba(244, 67, 54, 0.4) !important;
          }
          .ticketalert-monitored {
            position: relative !important;
          }
          .ticketalert-monitored::before {
            content: '';
            position: absolute;
            inset: -4px;
            border: 2px solid #4CAF50;
            border-radius: 4px;
            animation: ticketalert-pulse 2s infinite;
            pointer-events: none;
            z-index: 9999;
          }
          .ticketalert-badge {
            position: absolute;
            top: -10px;
            right: -10px;
            background: #4CAF50;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: ticketalert-badge-appear 0.3s ease-out;
          }
          @keyframes ticketalert-pulse {
            0% {
              box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);
            }
            70% {
              box-shadow: 0 0 0 10px rgba(76, 175, 80, 0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(76, 175, 80, 0);
            }
          }
          @keyframes ticketalert-badge-appear {
            from {
              transform: scale(0.8);
              opacity: 0;
            }
            to {
              transform: scale(1);
              opacity: 1;
            }
          }
        `;
        document.head.appendChild(style);

        // Ajouter la classe au body
        document.body.classList.add('ticketalert-selection-mode');

        // Gérer les clics
        const clickHandler = function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const fingerprint = getElementFingerprint(e.target);
          
          // Nettoyer les anciennes surveillances
          const oldMonitored = document.querySelector('.ticketalert-monitored');
          if (oldMonitored) {
            oldMonitored.classList.remove('ticketalert-monitored');
            const oldBadge = document.querySelector('.ticketalert-badge');
            if (oldBadge) oldBadge.remove();
          }

          // Ajouter l'indication visuelle
          e.target.classList.add('ticketalert-monitored');
          const badge = document.createElement('div');
          badge.className = 'ticketalert-badge';
          badge.textContent = 'Surveillé';
          e.target.appendChild(badge);
          
          // Envoyer l'empreinte au background script
          chrome.runtime.sendMessage({
            action: 'elementSelected',
            fingerprint: fingerprint
          });

          // Nettoyer le mode sélection
          document.body.classList.remove('ticketalert-selection-mode');
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
async function checkPageContent(tabId, url, fingerprint) {
  try {
    console.log('Vérification de la page:', { tabId, url, fingerprint });
    
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

    // Vérifier l'élément avant le rafraîchissement
    const preCheckResults = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: (fingerprint) => {
        // Fonction pour comparer deux empreintes
        function compareFingerprints(fp1, fp2) {
          // Comparer le texte
          if (fp1.text !== fp2.text) return false;
          
          // Comparer le tagName
          if (fp1.tagName !== fp2.tagName) return false;
          
          // Comparer les classes (l'ordre n'est pas important)
          const classes1 = new Set(fp1.classes);
          const classes2 = new Set(fp2.classes);
          if (classes1.size !== classes2.size) return false;
          for (const cls of classes1) {
            if (!classes2.has(cls)) return false;
          }
          
          // Comparer les attributs non-nuls et non-vides
          const normalizeValue = v => (!v || v === '') ? null : v;
          const attrs1 = Object.entries(fp1.attributes)
            .filter(([_, v]) => normalizeValue(v) !== null)
            .map(([k, v]) => [k, normalizeValue(v)]);
          const attrs2 = Object.entries(fp2.attributes)
            .filter(([_, v]) => normalizeValue(v) !== null)
            .map(([k, v]) => [k, normalizeValue(v)]);
          
          if (attrs1.length !== attrs2.length) return false;
          for (const [key, value] of attrs1) {
            if (normalizeValue(fp2.attributes[key]) !== value) return false;
          }
          
          return true;
        }

        // Fonction pour obtenir une empreinte
        function getElementFingerprint(element) {
          const clone = element.cloneNode(true);
          const ticketAlertElements = clone.querySelectorAll('[class^="ticketalert-"]');
          ticketAlertElements.forEach(el => el.remove());
          const cleanText = element.textContent.replace(/\s+/g, ' ').trim();
          
          // Obtenir le chemin XPath relatif
          function getXPath(node) {
            const parts = [];
            while (node && node.nodeType === Node.ELEMENT_NODE) {
              let siblings = Array.from(node.parentNode.children).filter(
                child => child.nodeName === node.nodeName
              );
              
              if (siblings.length > 1) {
                let index = siblings.indexOf(node) + 1;
                parts.unshift(`${node.nodeName.toLowerCase()}[${index}]`);
              } else {
                parts.unshift(node.nodeName.toLowerCase());
              }
              node = node.parentNode;
            }
            return parts.join('/');
          }

          return {
            text: cleanText,
            xpath: getXPath(element),
            classes: Array.from(element.classList)
              .filter(c => !c.startsWith('ticketalert-') && !c.match(/css-[a-z0-9]+/)),
            tagName: element.tagName.toLowerCase(),
            attributes: {
              id: element.id || null,
              href: element.getAttribute('href'),
              src: element.getAttribute('src'),
              type: element.getAttribute('type'),
              role: element.getAttribute('role'),
              'aria-label': element.getAttribute('aria-label')
            }
          };
        }

        // Fonction pour trouver l'élément correspondant
        function findMatchingElement(fingerprint) {
          // Essayer d'abord par XPath
          try {
            const xpathResult = document.evaluate(
              '//' + fingerprint.xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            const element = xpathResult.singleNodeValue;
            if (element && element.textContent.replace(/\s+/g, ' ').trim() === fingerprint.text) {
              return element;
            }
          } catch (e) {
            console.log('Erreur XPath:', e);
          }

          // Si XPath échoue, chercher par texte et type d'élément
          const elements = Array.from(document.getElementsByTagName(fingerprint.tagName));
          return elements.find(element => {
            const elementText = element.textContent.replace(/\s+/g, ' ').trim();
            if (elementText !== fingerprint.text) return false;

            // Vérifier les attributs stables
            for (const [key, value] of Object.entries(fingerprint.attributes)) {
              if (value && element.getAttribute(key) !== value) return false;
            }

            // Vérifier les classes stables
            const elementClasses = Array.from(element.classList)
              .filter(c => !c.match(/css-[a-z0-9]+/));
            const hasAllStableClasses = fingerprint.classes.every(c => 
              elementClasses.includes(c)
            );

            return hasAllStableClasses;
          });
        }

        // Trouver l'élément
        const element = findMatchingElement(fingerprint);
        if (!element) {
          return { error: 'Élément non trouvé' };
        }

        // Obtenir l'empreinte actuelle
        const currentFingerprint = getElementFingerprint(element);

        // Réappliquer le style de surveillance
        const style = document.createElement('style');
        style.setAttribute('data-ticketalert', 'true');
        style.textContent = `
          .ticketalert-monitored {
            position: relative !important;
          }
          .ticketalert-monitored::before {
            content: '';
            position: absolute;
            inset: -4px;
            border: 2px solid #4CAF50;
            border-radius: 4px;
            animation: ticketalert-pulse 2s infinite;
            pointer-events: none;
            z-index: 9999;
          }
          .ticketalert-badge {
            position: absolute;
            top: -10px;
            right: -10px;
            background: #4CAF50;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 10000;
          }
          @keyframes ticketalert-pulse {
            0% {
              box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);
            }
            70% {
              box-shadow: 0 0 0 10px rgba(76, 175, 80, 0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(76, 175, 80, 0);
            }
          }
        `;
        document.head.appendChild(style);

        // Appliquer le style à l'élément
        element.classList.add('ticketalert-monitored');
        const badge = document.createElement('div');
        badge.className = 'ticketalert-badge';
        badge.textContent = 'Surveillé';
        element.appendChild(badge);

        return { 
          fingerprint: currentFingerprint,
          matches: compareFingerprints(currentFingerprint, fingerprint),
          error: null
        };
      },
      args: [fingerprint]
    });

    if (!preCheckResults || !preCheckResults[0] || !preCheckResults[0].result) {
      throw new Error('Résultat de vérification invalide');
    }

    const preCheckResult = preCheckResults[0].result;
    
    if (preCheckResult.error || !preCheckResult.matches) {
      // Si un changement est détecté, envoyer une notification
      await sendNotification(
        'TicketAlert - Changement détecté !',
        preCheckResult.error ? 
          'L\'élément surveillé n\'est plus présent - La page a peut-être changé ou la billetterie est ouverte !' :
          'Le contenu de l\'élément surveillé a changé !'
      );
      stopMonitoring(tabId);
      return;
    }

    // Rafraîchir la page seulement si aucun changement n'a été détecté
    await chrome.tabs.reload(tabId);

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
async function startMonitoring(tabId, url, fingerprint, interval) {
  console.log('Démarrage de la surveillance:', { tabId, url, fingerprint, interval });
  
  if (monitoringIntervals[tabId]) {
    clearInterval(monitoringIntervals[tabId]);
  }

  try {
    // Notification de démarrage
    await sendNotification(
      'TicketAlert - Surveillance démarrée',
      'La surveillance est active pour l\'élément sélectionné.'
    );

    // Première vérification immédiate
    await checkPageContent(tabId, url, fingerprint);
    
    // Démarrer la surveillance périodique avec l'intervalle personnalisé
    monitoringIntervals[tabId] = setInterval(() => {
      checkPageContent(tabId, url, fingerprint);
    }, interval * 1000); // Convertir les secondes en millisecondes

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

  // Notifier la popup que la surveillance est arrêtée
  try {
    chrome.runtime.sendMessage({ action: 'monitoringStopped' });
  } catch (error) {
    console.log('Popup non disponible pour la notification');
  }
}

// Écouter les messages du popup et du script injecté
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMonitoring') {
    const { fingerprint, url, interval } = request.data;
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0].id;
      monitoredTabs[tabId] = {
        url: url,
        fingerprint: fingerprint,
        interval: interval
      };
      startMonitoring(tabId, url, fingerprint, interval);
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
        fingerprint: request.fingerprint
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
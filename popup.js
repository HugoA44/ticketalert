document.addEventListener('DOMContentLoaded', () => {
  const selectButton = document.getElementById('selectElement');
  const toggleButton = document.getElementById('toggleMonitoring');
  const statusDiv = document.getElementById('status');
  const selectorHelp = document.getElementById('selectorHelp');
  const selectionDisplay = document.getElementById('selectionDisplay');
  const selectionText = document.getElementById('selectionText');
  const clearSelection = document.getElementById('clearSelection');
  const refreshInterval = document.getElementById('refreshInterval');
  let isSelecting = false;

  // Fonction pour mettre à jour l'affichage de la sélection
  function updateSelectionDisplay(fingerprint) {
    if (fingerprint) {
      selectionText.textContent = fingerprint.text;
      selectionDisplay.classList.add('visible');
    } else {
      selectionText.textContent = '';
      selectionDisplay.classList.remove('visible');
    }
  }

  // Fonction pour vérifier la sélection
  function checkSelection() {
    chrome.storage.local.get(['lastSelection'], (result) => {
      if (result.lastSelection) {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const currentUrl = tabs[0].url;
          
          // Sauvegarder le sélecteur pour cette URL
          chrome.storage.local.get(['monitoredUrls'], (urlResult) => {
            const monitoredUrls = urlResult.monitoredUrls || {};
            monitoredUrls[currentUrl] = {
              ...monitoredUrls[currentUrl],
              fingerprint: result.lastSelection.fingerprint,
              isMonitoring: false
            };
            
            // Sauvegarder dans le stockage
            chrome.storage.local.set({ monitoredUrls }, () => {
              // Nettoyer la sélection temporaire
              chrome.storage.local.remove('lastSelection');
              isSelecting = false;
              selectButton.textContent = 'Sélectionner un élément';
              selectButton.classList.remove('active');
              selectorHelp.classList.remove('visible');
              updateSelectionDisplay(result.lastSelection.fingerprint);
            });
          });
        });
      }
    });
  }

  // Vérifier la sélection toutes les 100ms
  const selectionInterval = setInterval(checkSelection, 100);

  // Nettoyer l'intervalle quand la fenêtre est fermée
  window.addEventListener('unload', () => {
    clearInterval(selectionInterval);
  });

  // Obtenir l'URL actuelle et mettre à jour l'interface
  function updateInterface() {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const currentUrl = tabs[0].url;
      
      chrome.storage.local.get(['monitoredUrls'], (result) => {
        const monitoredUrls = result.monitoredUrls || {};
        const urlData = monitoredUrls[currentUrl];

        // Mettre à jour l'affichage de la sélection
        if (urlData?.fingerprint) {
          updateSelectionDisplay(urlData.fingerprint);
        } else {
          updateSelectionDisplay(null);
        }

        // Mettre à jour le statut
        if (urlData?.isMonitoring) {
          statusDiv.textContent = 'Surveillance active';
          statusDiv.classList.remove('inactive');
          statusDiv.classList.add('active');
          toggleButton.textContent = 'Arrêter la surveillance';
        } else {
          statusDiv.textContent = 'Surveillance inactive';
          statusDiv.classList.add('inactive');
          statusDiv.classList.remove('active');
          toggleButton.textContent = 'Démarrer la surveillance';
        }
      });
    });
  }

  // Mettre à jour l'interface au chargement
  updateInterface();

  // Gérer la sélection d'élément
  selectButton.addEventListener('click', async () => {
    if (!isSelecting) {
      isSelecting = true;
      selectButton.textContent = 'Annuler';
      selectButton.classList.add('active');
      selectorHelp.classList.add('visible');
      
      chrome.runtime.sendMessage({ action: 'startElementSelection' });
    } else {
      isSelecting = false;
      selectButton.textContent = 'Sélectionner un élément';
      selectButton.classList.remove('active');
      selectorHelp.classList.remove('visible');
      
      chrome.runtime.sendMessage({ action: 'stopElementSelection' });
    }
  });

  // Gérer la suppression de la sélection
  clearSelection.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const currentUrl = tabs[0].url;
      
      chrome.storage.local.get(['monitoredUrls'], (result) => {
        const monitoredUrls = result.monitoredUrls || {};
        
        // Si la surveillance est active, l'arrêter d'abord
        if (monitoredUrls[currentUrl]?.isMonitoring) {
          chrome.runtime.sendMessage({ action: 'stopMonitoring' });
        }

        // Supprimer la sélection pour cette URL
        delete monitoredUrls[currentUrl];
        
        chrome.storage.local.set({ monitoredUrls }, () => {
          updateInterface();
        });
      });
    });
  });

  // Gérer le démarrage/arrêt de la surveillance
  toggleButton.addEventListener('click', async () => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const currentUrl = tabs[0].url;
      
      chrome.storage.local.get(['monitoredUrls'], (result) => {
        const monitoredUrls = result.monitoredUrls || {};
        const urlData = monitoredUrls[currentUrl];

        if (!urlData?.fingerprint) {
          alert('Veuillez d\'abord sélectionner un élément à surveiller');
          return;
        }

        if (!urlData.isMonitoring) {
          // Démarrer la surveillance
          chrome.runtime.sendMessage({
            action: 'startMonitoring',
            data: { 
              fingerprint: urlData.fingerprint,
              url: currentUrl,
              interval: parseInt(refreshInterval.value, 10)
            }
          });

          // Mettre à jour le stockage
          monitoredUrls[currentUrl] = {
            ...monitoredUrls[currentUrl],
            isMonitoring: true,
            interval: parseInt(refreshInterval.value, 10)
          };

          chrome.storage.local.set({ monitoredUrls }, () => {
            updateInterface();
          });
        } else {
          // Arrêter la surveillance
          chrome.runtime.sendMessage({ action: 'stopMonitoring' });

          // Mettre à jour le stockage
          monitoredUrls[currentUrl] = {
            ...monitoredUrls[currentUrl],
            isMonitoring: false
          };

          chrome.storage.local.set({ monitoredUrls }, () => {
            updateInterface();
          });
        }
      });
    });
  });

  // Écouter les messages du background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'monitoringStopped') {
      // Mettre à jour l'interface quand la surveillance est arrêtée
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const currentUrl = tabs[0].url;
        
        chrome.storage.local.get(['monitoredUrls'], (result) => {
          const monitoredUrls = result.monitoredUrls || {};
          if (monitoredUrls[currentUrl]) {
            monitoredUrls[currentUrl].isMonitoring = false;
            chrome.storage.local.set({ monitoredUrls }, () => {
              updateInterface();
            });
          }
        });
      });
    }
  });
});